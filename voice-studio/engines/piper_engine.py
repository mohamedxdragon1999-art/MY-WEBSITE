"""Mode 2 - "Pocket TTS": Piper (rhasspy/piper).

Piper is a fast, fully-LOCAL neural TTS built for low-power / "pocket" devices.
It runs entirely on the user's CPU (no GPU, no internet, no key) once a small
voice model (.onnx + .onnx.json) is present. This is the best pick when you need
offline, private, low-latency speech on modest hardware.

Models are downloaded once from https://huggingface.co/rhasspy/piper-voices
into voice-studio/models/piper/. See README for exact commands.
"""
from __future__ import annotations

import io
import threading
import wave
from pathlib import Path
from typing import Dict, List, Optional

from . import voice_fx
from .base import Availability, TTSEngine, TTSResult, clean_text, concat_wav, silence_wav

# Loading a Piper voice off disk takes a noticeable moment; doing it on EVERY
# request made replies slow. Cache each loaded voice (thread-safe) so it's paid
# only once, then reused for every synth.
_VOICE_CACHE: Dict[str, object] = {}
_VOICE_LOCK = threading.Lock()


def _load_voice(stem: str, mp):
    v = _VOICE_CACHE.get(stem)
    if v is None:
        with _VOICE_LOCK:
            v = _VOICE_CACHE.get(stem)
            if v is None:
                from piper import PiperVoice
                v = PiperVoice.load(str(mp))
                _VOICE_CACHE[stem] = v
    return v

_MODELS_DIR = Path(__file__).resolve().parent.parent / "models" / "piper"

# Friendly voice -> expected model filename stem (user downloads these once).
_VOICES = {
    "en": [
        {"id": "en_US-amy-medium", "label": "Amy (US female)", "gender": "female"},
        {"id": "en_US-lessac-medium", "label": "Lessac (US neutral)", "gender": "male"},
        {"id": "en_US-ryan-high", "label": "Ryan (US male, high-q)", "gender": "male"},
        {"id": "en_GB-alan-medium", "label": "Alan (British male)", "gender": "male"},
    ],
}
_DEFAULT = {"en": "en_US-amy-medium"}


def _model_path(stem: str) -> Optional[Path]:
    onnx = _MODELS_DIR / f"{stem}.onnx"
    cfg = _MODELS_DIR / f"{stem}.onnx.json"
    if onnx.exists() and cfg.exists():
        return onnx
    return None


def _installed_models() -> List[str]:
    if not _MODELS_DIR.exists():
        return []
    return sorted(p.stem for p in _MODELS_DIR.glob("*.onnx") if (p.parent / f"{p.name}.json").exists())


def _voice_sr(pv, default: int = 22050) -> int:
    """The voice's REAL sample rate.

    v0.0.35 - this used to be hardcoded to 22050 in the expressive path while
    the fallback path correctly read it from the model. Piper's low and x_low
    voices run at 16000 Hz, so with one of those installed the silence gaps
    were generated at 22050 and concatenated onto 16000 Hz speech, and the
    result was declared 22050 to the browser: every gap the wrong length and
    the whole reply played back at the wrong pitch and speed.
    """
    try:
        sr = int(getattr(getattr(pv, "config", None), "sample_rate", 0) or 0)
        return sr if sr >= 8000 else default
    except Exception:
        return default


def _synth_wav(pv, text: str, wf, length_scale: float) -> None:
    """Write one utterance into an open wave file, on ANY piper-tts version.

    v0.0.35 - SILENT-AUDIO LANDMINE. requirements pins `piper-tts>=1.2.0`,
    which is unbounded, and the API moved: in piper-tts 1.3+ `synthesize()`
    became a GENERATOR of audio chunks and the wav writer is `synthesize_wav`,
    with speed carried in a `SynthesisConfig` instead of a `length_scale`
    kwarg. The old code called `synthesize(text, wav, length_scale=...)`,
    caught the resulting TypeError, and retried `synthesize(text, wav)` - which
    on 1.3+ silently returns a generator, writes NOTHING, and yields an empty
    wav. No exception, no error in the log, just a voice that never speaks.
    So we try the modern API first and only then fall back, and if we are
    handed a generator we consume it ourselves.
    """
    ls = max(0.5, min(2.0, float(length_scale)))

    # 1. Modern API (piper-tts >= 1.3): synthesize_wav + SynthesisConfig.
    writer = getattr(pv, "synthesize_wav", None)
    if callable(writer):
        try:
            from piper import SynthesisConfig  # type: ignore
            writer(text, wf, syn_config=SynthesisConfig(length_scale=ls))
            return
        except Exception:
            pass
        try:
            writer(text, wf)
            return
        except Exception:
            pass

    # 2. Legacy API (piper-tts 1.2.x): synthesize(text, wav, length_scale=...).
    for kwargs in ({"length_scale": ls}, {}):
        try:
            out = pv.synthesize(text, wf, **kwargs)
        except TypeError:
            continue
        # 3. A generator means nothing was written - drain it ourselves.
        if out is not None and hasattr(out, "__iter__") and not isinstance(out, (bytes, bytearray)):
            wrote = False
            for chunk in out:
                raw = getattr(chunk, "audio_int16_bytes", None)
                if raw is None:
                    raw = bytes(chunk) if isinstance(chunk, (bytes, bytearray)) else None
                if raw:
                    wf.writeframes(raw)
                    wrote = True
            if not wrote:
                raise RuntimeError("piper produced no audio")
        return

    raise RuntimeError("this piper-tts version exposes no usable synthesis call")


class PiperEngine(TTSEngine):
    id = "piper"
    title = "Pocket TTS (Piper)"
    description = "Fully offline, local-CPU neural TTS for low-power devices. Private, fast, no key, no internet."

    def availability(self) -> Availability:
        try:
            import piper  # noqa: F401
        except Exception:
            return Availability(ok=False, cpu=True, quality=3,
                                reason="piper-tts not installed",
                                setup="pip install piper-tts  (then download a voice model, see README)")
        if not _installed_models():
            return Availability(ok=False, cpu=True, quality=3,
                                reason="No Piper voice model found in models/piper/",
                                setup="python -m piper.download_voices en_US-amy-medium --data-dir models/piper")
        return Availability(ok=True, cpu=True, needs_network=False, needs_key=False, quality=3,
                            reason="Ready (100% offline, runs on CPU).")

    def warmup(self) -> None:
        """Preload the default (or first installed) voice so the FIRST real
        request isn't slow. Safe to call in the background at startup."""
        try:
            stem = _DEFAULT.get("en")
            mp = _model_path(stem)
            if mp is None:
                installed = _installed_models()
                if not installed:
                    return
                stem = installed[0]
                mp = _model_path(stem)
            _load_voice(stem, mp)
        except Exception:
            pass

    def voices(self, lang: str = "en") -> List[Dict]:
        installed = set(_installed_models())
        out = []
        for v in _VOICES.get(lang, _VOICES["en"]):
            out.append(dict(v, lang=lang, ready=v["id"] in installed))
        # also surface any other installed models
        for stem in installed:
            if not any(stem == v["id"] for row in _VOICES.values() for v in row):
                out.append({"id": stem, "label": stem, "lang": lang, "gender": "?", "ready": True})
        return out

    def synthesize(self, text: str, *, voice: Optional[str] = None, lang: str = "en",
                   rate: float = 1.0, pitch: float = 0.0) -> TTSResult:
        stem = voice or _DEFAULT.get(lang, _DEFAULT["en"])
        mp = _model_path(stem)
        if mp is None:
            # fall back to any installed model
            installed = _installed_models()
            if not installed:
                raise RuntimeError("No Piper voice model installed. See README setup.")
            stem = installed[0]
            mp = _model_path(stem)
        pv = _load_voice(stem, mp)  # cached: loaded once, reused every call

        # PER-SENTENCE PERFORMANCE: each sentence gets its own delivery speed
        # and a real silent gap, so even this small offline voice stops sounding
        # like one flat block of text.
        sr = _voice_sr(pv)

        # v0.0.35 - THE FLAT-VOICE BUG, AND IT WAS THE COMMON CASE.
        # This used to read `if len(beats) > 1:`, so the entire expressive path
        # - pitch contour, terminal rise on questions, declination, emphasis,
        # emotional pitch offset, micro-instability - ran ONLY when a reply had
        # two or more sentences. A one-sentence answer fell through to a path
        # whose sole expressive control is tempo, and Piper has no pitch control
        # at all, so short replies came out completely flat. Short replies are
        # the majority in a support call, and the brain is instructed to give
        # exactly that. One sentence deserves a performance too; it just does
        # not need silence after it.
        beats = self.emotion_beats(text)
        if beats:
            chunks: List[bytes] = []
            from . import expressive as _expr
            for _i, b in enumerate(beats):
                spoken = self.prepare(b.text)
                if not spoken:
                    continue
                sp = max(0.5, min(2.0, float(rate) * float(b.rate)))
                ls = 1.0 / sp
                sbuf = io.BytesIO()
                with wave.open(sbuf, "wb") as swf:
                    swf.setnchannels(1)
                    swf.setsampwidth(2)
                    swf.setframerate(sr)
                    _synth_wav(pv, spoken, swf, ls)
                # Piper has no pitch control either, so the terminal rise/fall
                # used to be carried by tempo. It is now carried by actual F0
                # movement applied to the rendered waveform.
                piece = voice_fx.render(
                    sbuf.getvalue(),
                    contour=getattr(b, "contour", "fall"),
                    emphasis=getattr(b, "emphasis", ()),
                    text=b.text,
                    pitch_st=float(getattr(b, "pitch", 0.0)),
                    emotion=b.emotion.name,
                    # v0.0.40 - THE EMOTIONAL ARC. This was hardcoded to 1.0, so
                    # every sentence in a reply was performed at exactly the same
                    # emotional strength. People do not do that: they open a
                    # little stronger and settle as they finish a thought. The
                    # reply now has a shape instead of a constant level.
                    intensity=_expr.beat_intensity(_i, len(beats)),
                )
                chunks.append(piece)
                # v0.0.35 - the clause gap used to be appended HERE, after the
                # whole sentence, with a comment claiming it made the voice
                # breathe inside the sentence. It did no such thing: it simply
                # added up to 150ms on top of pause_after_ms, so every sentence
                # dragged. A gap that is not inside the clause is not a breath.
                if b.pause_after_ms:
                    chunks.append(silence_wav(b.pause_after_ms, sr))
            if chunks:
                return TTSResult(audio=concat_wav(chunks), mime="audio/wav",
                                 engine=self.id, voice=stem, sample_rate=sr,
                                 detail="expressive")

        # Last resort: only reached when emotion planning is disabled or fails.
        # v0.0.35 - prepare() is no longer called twice (it runs contractions,
        # pacing and tag handling, so calling it per retry was wasted work), and
        # the result still gets the prosody chain instead of being left bare.
        e_rate, _e_pitch, _e_vol, e_name = self.emotion_params(text, rate, pitch)
        length_scale = 1.0 / max(0.5, min(2.0, float(e_rate)))  # slower speech = larger scale
        spoken = self.prepare(text)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sr)
            _synth_wav(pv, spoken, wf, length_scale)
        audio = voice_fx.render(buf.getvalue(), contour="fall", text=text,
                                emotion=e_name, intensity=1.0)
        return TTSResult(audio=audio, mime="audio/wav", engine=self.id, voice=stem,
                         sample_rate=sr, detail=e_name)
