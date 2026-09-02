"""Mode 3 - Kokoro TTS (kokoro-onnx).

Kokoro-82M is a small, open-weight neural TTS that punches far above its size
for naturalness. Via the ONNX runtime it runs comfortably on the user's CPU
(no GPU) and fully offline once weights are present. This is the top-quality
local-CPU option and a great default for a customer-service agent.

Weights (downloaded once, see README):
  models/kokoro/kokoro-v1.0.onnx        (~310 MB)
  models/kokoro/voices-v1.0.bin         (voice styles)
From https://github.com/thewh1teagle/kokoro-onnx releases.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Dict, List, Optional

from . import cpu_profile, voice_fx
from .base import (Availability, TTSEngine, TTSResult, clean_text, concat_wav,
                   float_to_wav, silence_wav)

_MODELS_DIR = Path(__file__).resolve().parent.parent / "models" / "kokoro"
_ONNX = _MODELS_DIR / "kokoro-v1.0.onnx"
#: v0.0.51 - optional int8-quantised weights. Roughly a quarter of the size and
#: measurably faster on CPU, at a quality cost most listeners do not notice on
#: an 82M model. Entirely opt-in: we use it only if the operator downloaded it.
#: Set VOICE_KOKORO_INT8=0 to ignore it even when present.
_ONNX_INT8 = _MODELS_DIR / "kokoro-v1.0.int8.onnx"
_VOICES_BIN = _MODELS_DIR / "voices-v1.0.bin"


def _model_path() -> Optional[Path]:
    """Which weights file to load, or None if we have none.

    Prefers int8 when it exists and has not been disabled, otherwise the
    standard fp32 weights.
    """
    prefer_int8 = (os.environ.get("VOICE_KOKORO_INT8") or "1").strip().lower() not in (
        "0", "false", "no", "off",
    )
    if prefer_int8 and _ONNX_INT8.exists():
        return _ONNX_INT8
    if _ONNX.exists():
        return _ONNX
    return None

# Kokoro voice ids. Prefix: a=American, b=British; f=female, m=male.
_VOICES = {
    "en": [
        {"id": "af_heart", "label": "Heart (US female, warm)", "gender": "female"},
        {"id": "af_bella", "label": "Bella (US female)", "gender": "female"},
        {"id": "am_michael", "label": "Michael (US male)", "gender": "male"},
        {"id": "am_adam", "label": "Adam (US male)", "gender": "male"},
        {"id": "bf_emma", "label": "Emma (British female)", "gender": "female"},
        {"id": "bm_george", "label": "George (British male)", "gender": "male"},
    ],
}
_DEFAULT = {"en": "af_heart"}
_LANG_CODE = {"en": "en-us", "en-gb": "en-gb"}

_KOKORO = None  # cached model (loading is expensive)
_LOAD_LOCK = threading.Lock()  # prevent 50 concurrent first-hits all loading the 310MB model


def _apply_cpu_threads() -> None:
    """Bound ONNX Runtime's thread pool BEFORE the session is created.

    ORT reads these on session construction and otherwise grabs every core it
    can see. On a box that is also serving HTTP and WebSockets, one synthesis
    taking all cores means the SECOND concurrent caller waits for the first,
    and the event loop itself gets starved. We only set these if the operator
    has not already chosen a value.
    """
    try:
        threads = str(cpu_profile.worker_threads())
        for var in ("OMP_NUM_THREADS", "ORT_NUM_THREADS"):
            if not (os.environ.get(var) or "").strip():
                os.environ[var] = threads
    except Exception:
        # Tuning is an optimisation, never a reason to lose the voice.
        pass


def _get_model():
    global _KOKORO
    if _KOKORO is None:
        with _LOAD_LOCK:
            if _KOKORO is None:  # double-checked: only the first caller loads it
                _apply_cpu_threads()
                from kokoro_onnx import Kokoro
                path = _model_path() or _ONNX
                _KOKORO = Kokoro(str(path), str(_VOICES_BIN))
    return _KOKORO


def _create(model, text: str, *, voice: str, speed: float, lang: str):
    """model.create(), but never handed a long string.

    Kokoro's real-time factor gets WORSE on longer input instead of amortising
    down (measured 0.51 -> 0.69 going from short to extended text on CPU), so
    synthesising in short pieces is free speed. It also improves time-to-first
    audio, which is what a caller actually experiences as "fast".

    Correctness first: if the text is already short, or numpy is unavailable to
    stitch the pieces back together, we fall back to one whole-string call.
    """
    pieces = cpu_profile.split_for_cpu(text)
    if len(pieces) <= 1:
        return model.create(text, voice=voice, speed=speed, lang=lang)
    try:
        import numpy as _np
    except Exception:
        return model.create(text, voice=voice, speed=speed, lang=lang)

    parts = []
    sr_out = 24000
    for piece in pieces:
        samples, sr = model.create(piece, voice=voice, speed=speed, lang=lang)
        sr_out = sr
        if samples is not None and len(samples):
            parts.append(samples)
    if not parts:
        return model.create(text, voice=voice, speed=speed, lang=lang)
    if len(parts) == 1:
        return parts[0], sr_out
    return _np.concatenate(parts), sr_out


class KokoroEngine(TTSEngine):
    id = "kokoro"
    title = "Kokoro TTS"
    description = "Open-weight 82M neural voice. High quality, runs on CPU (ONNX), fully offline. Great default."

    def availability(self) -> Availability:
        try:
            import kokoro_onnx  # noqa: F401
        except Exception:
            return Availability(ok=False, cpu=True, quality=5,
                                reason="kokoro-onnx not installed",
                                setup="pip install kokoro-onnx soundfile  (then download weights, see README)")
        if not (_model_path() and _VOICES_BIN.exists()):
            return Availability(ok=False, cpu=True, quality=5,
                                reason="Kokoro weights missing in models/kokoro/",
                                setup="Download kokoro-v1.0.onnx + voices-v1.0.bin into models/kokoro/ (see README)")
        return Availability(ok=True, cpu=True, needs_network=False, needs_key=False, quality=5,
                            reason="Ready (high-quality, runs on CPU, offline).")

    def warmup(self) -> None:
        """Load the 310 MB model once in the background so the FIRST real request
        isn't slow. Safe no-op if weights/lib are missing."""
        try:
            if _model_path() and _VOICES_BIN.exists():
                _get_model()
        except Exception:
            pass

    def voices(self, lang: str = "en") -> List[Dict]:
        return [dict(v, lang=lang) for v in _VOICES.get(lang[:2], _VOICES["en"])]

    def synthesize(self, text: str, *, voice: Optional[str] = None, lang: str = "en",
                   rate: float = 1.0, pitch: float = 0.0) -> TTSResult:
        model = _get_model()
        voice_id = voice or _DEFAULT.get(lang[:2], _DEFAULT["en"])
        lang_code = _LANG_CODE.get(lang, "en-us")

        # PER-SENTENCE PERFORMANCE.
        # Kokoro gives us raw samples, so we can do what a person does: deliver
        # each sentence with its own speed and leave REAL silence between them,
        # instead of speaking one flat paragraph (the classic robot tell) or
        # pronouncing the word "pause".
        # v0.0.35 - same flat-voice bug as Pocket TTS: this was
        # `if len(beats) > 1:`, so a ONE-SENTENCE reply skipped the whole
        # prosody chain and was delivered with tempo only. Kokoro has no pitch
        # control either, so a short answer had no terminal contour, no
        # declination and no emotional pitch offset at all.
        beats = self.emotion_beats(text)
        if beats:
            chunks: List[bytes] = []
            sr_out = 24000
            from . import expressive as _expr
            for _i, b in enumerate(beats):
                spoken = self.prepare(b.text)
                if not spoken:
                    continue
                sp = max(0.5, min(2.0, float(rate) * float(b.rate)))
                samples, sr = _create(model, spoken, voice=voice_id, speed=sp, lang=lang_code)
                sr_out = sr
                # Real prosody. Kokoro exposes no pitch control, so up to v6.2
                # a rising question was faked by speaking faster - a tempo
                # trick, not intonation. Now the waveform itself is reshaped:
                # terminal rise/fall, declination, emphasis, and the micro
                # instability that stops a voice sounding mechanical.
                piece = float_to_wav(samples, sr)
                piece = voice_fx.render(
                    piece,
                    contour=getattr(b, "contour", "fall"),
                    emphasis=getattr(b, "emphasis", ()),
                    text=b.text,
                    pitch_st=float(getattr(b, "pitch", 0.0)),
                    emotion=b.emotion.name,
                    # v0.0.40 - THE EMOTIONAL ARC. Hardcoded 1.0 meant every
                    # sentence was performed at an identical emotional strength,
                    # so a reply had a level but never a direction. A person
                    # opens a little stronger and settles as the thought closes.
                    intensity=_expr.beat_intensity(_i, len(beats)),
                )
                chunks.append(piece)
                # v0.0.35 - the "breathe inside the sentence" gap was appended
                # AFTER the sentence, so it was never inside anything: it just
                # added up to 150ms on top of pause_after_ms and made every
                # sentence drag. Removed rather than left as a comment that
                # claims something the code does not do.
                if b.pause_after_ms:
                    chunks.append(silence_wav(b.pause_after_ms, sr))
            if chunks:
                return TTSResult(audio=concat_wav(chunks), mime="audio/wav",
                                 engine=self.id, voice=voice_id, sample_rate=sr_out,
                                 detail="expressive")

        e_rate, _e_pitch, _e_vol, e_name = self.emotion_params(text, rate, pitch)
        speed = max(0.5, min(2.0, float(e_rate)))
        samples, sr = _create(model, self.prepare(text), voice=voice_id, speed=speed, lang=lang_code)
        return TTSResult(audio=float_to_wav(samples, sr), mime="audio/wav",
                         engine=self.id, voice=voice_id, sample_rate=sr, detail=e_name)
