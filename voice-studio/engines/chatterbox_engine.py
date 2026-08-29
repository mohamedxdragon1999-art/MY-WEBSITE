"""Chatterbox (Resemble AI) - the local-CPU half of the Ultra Human mode.

Why this model
--------------
Chatterbox is the strongest "sounds like a person" open model that can actually
run without a GPU:

  * In Resemble's blind A/B evaluation, listeners preferred Chatterbox over
    ElevenLabs 63.75% of the time. Independent reviewers report comparable
    smoothness and notably better stability on long text, where other open
    models drift or degrade.
  * Native paralinguistic tags - [laugh], [sigh], [chuckle], [cough] - so
    emotion is a first-class input, not a hack.
  * MIT licensed. Genuinely usable commercially, unlike OpenRAIL-M models such
    as Supertonic which carry commercial restrictions.
  * Nano (110M) runs 3x faster than real time on 8 CPU cores; Turbo (350M) is
    the higher-quality sibling. Both distilled the token-to-mel decoder from 10
    steps down to 1, which is where the speed comes from.

So: Turbo when there is headroom, Nano when there is not, and both beat the
robotic browser fallback by a wide margin.

Honest note on latency: Resemble advertises sub-200ms, but that figure is for a
modern GPU. On CPU expect real-time-ish rather than instant, which is why the
Ultra Human mode prefers the free Fish cloud when a key is present and falls
back to Chatterbox locally.

Env:
  CHATTERBOX_MODEL  - "nano" (default, CPU-friendly) or "turbo"
  CHATTERBOX_DEVICE - "cpu" (default) or "cuda"
  CHATTERBOX_REF    - optional path to a 5s reference clip for voice cloning
  CHATTERBOX_EXAG   - expressiveness 0..1 (default 0.5)
"""
from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Dict, List, Optional

from . import prosody
from .base import Availability, TTSEngine, TTSResult, clean_text, float_to_wav

_VARIANT = (os.environ.get("CHATTERBOX_MODEL") or "nano").strip().lower()
_DEVICE = (os.environ.get("CHATTERBOX_DEVICE") or "cpu").strip().lower()

# Approximate RAM each variant needs on CPU without swapping. The full
# (non-distilled) 0.5B-Llama-backbone model wants 8-16GB on GPU - it is
# deliberately NOT a CPU default, and the guard below refuses it on small boxes.
_RAM_NEEDED_GB = {"nano": 2.5, "turbo": 5.0, "full": 9.0}


def _total_ram_gb() -> float:
    """Total RAM without requiring psutil. Returns 0.0 if it cannot be read."""
    try:
        with open("/proc/meminfo", "r") as fh:
            for line in fh:
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) / (1024.0 * 1024.0)
    except Exception:
        pass
    try:
        return (os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")) / (1024.0 ** 3)
    except Exception:
        return 0.0


def _ram_verdict():
    """(ok, message). Refuses a variant that would thrash a small server."""
    need = _RAM_NEEDED_GB.get(_VARIANT, 5.0)
    have = _total_ram_gb()
    if have <= 0:
        return True, ""  # unknown - do not block, just proceed
    if have < need:
        return False, ("CHATTERBOX_MODEL=" + _VARIANT + " needs about " +
                       str(need) + "GB RAM but this machine has " +
                       str(round(have, 1)) + "GB")
    return True, ""


def _apply_thread_cap() -> None:
    """Cap torch threads. Without this every concurrent request grabs every
    core, and 5 callers on an 8-core box run slower than 5 in a queue."""
    raw = os.environ.get("CHATTERBOX_THREADS", "").strip()
    try:
        n = int(raw) if raw else max(1, min(8, (os.cpu_count() or 4)))
    except ValueError:
        n = max(1, min(8, (os.cpu_count() or 4)))
    try:
        import torch
        torch.set_num_threads(max(1, n))
    except Exception:
        pass
_REF = (os.environ.get("CHATTERBOX_REF") or "").strip()
_MODELS_DIR = Path(__file__).resolve().parent.parent / "models" / "chatterbox"

_MODEL = None
_LOAD_LOCK = threading.Lock()

_VOICES = {
    "en": [
        {"id": "default", "label": "Chatterbox default (natural)", "gender": "neutral"},
        {"id": "warm", "label": "Warm + expressive", "gender": "neutral"},
        {"id": "calm", "label": "Calm + steady", "gender": "neutral"},
    ],
}

# Expressiveness presets mapped onto Chatterbox's exaggeration parameter.
_EXAG = {"default": 0.5, "warm": 0.7, "calm": 0.35}


def _exaggeration(voice: Optional[str]) -> float:
    env = os.environ.get("CHATTERBOX_EXAG")
    if env:
        try:
            return max(0.0, min(1.0, float(env)))
        except ValueError:
            pass
    return _EXAG.get((voice or "default"), 0.5)


def _import_tts():
    """Import lazily. Resemble has renamed the entry point across releases, so
    try the known names rather than pinning to one that may not exist."""
    try:
        from chatterbox.tts import ChatterboxTTS  # type: ignore
        return ChatterboxTTS
    except Exception:
        pass
    from chatterbox import ChatterboxTTS  # type: ignore
    return ChatterboxTTS


def _get_model():
    global _MODEL
    if _MODEL is None:
        with _LOAD_LOCK:
            if _MODEL is None:  # double-checked: only the first caller loads
                ok, why = _ram_verdict()
                if not ok:
                    raise RuntimeError(why + ". Use CHATTERBOX_MODEL=nano.")
                _apply_thread_cap()
                ChatterboxTTS = _import_tts()
                _MODEL = ChatterboxTTS.from_pretrained(device=_DEVICE)
    return _MODEL


class ChatterboxEngine(TTSEngine):
    # Chatterbox performs bracket tags like [sigh] as real breath/emotion.
    tag_aware = True
    id = "chatterbox"
    title = "Chatterbox (local, human-like)"
    description = (
        "Resemble AI's MIT-licensed model. Beat ElevenLabs in 63.75% of blind "
        "listening tests. Native [laugh]/[sigh] tags, very stable on long text, "
        "runs on CPU (Nano is 3x real-time on 8 cores)."
    )

    def availability(self) -> Availability:
        ok, why = _ram_verdict()
        if not ok:
            return Availability(
                ok=False, cpu=True, quality=5, reason=why,
                setup="Set CHATTERBOX_MODEL=nano (110M, ~2.5GB RAM, 3x real-time on CPU)")
        try:
            _import_tts()
        except Exception:
            return Availability(
                ok=False, cpu=True, quality=5,
                reason="chatterbox-tts not installed",
                setup="pip install chatterbox-tts  (first run downloads weights)")
        return Availability(
            ok=True, cpu=(_DEVICE == "cpu"), needs_network=False, needs_key=False,
            quality=5,
            reason="Ready (" + _VARIANT + " on " + _DEVICE + ", offline, MIT licensed).")

    def warmup(self) -> None:
        """Load weights in the background so the first caller isn't the one who
        pays the model-load cost. Safe no-op when the package is absent."""
        try:
            _get_model()
        except Exception:
            pass

    def voices(self, lang: str = "en") -> List[Dict]:
        return [dict(v, lang=lang) for v in _VOICES.get(lang[:2], _VOICES["en"])]

    def synthesize(self, text: str, *, voice: Optional[str] = None, lang: str = "en",
                   rate: float = 1.0, pitch: float = 0.0) -> TTSResult:
        model = _get_model()
        # Shared humanization layer keeps the tags in (tag_aware = True).
        spoken = self.prepare(text)

        # Emotion drives Chatterbox's exaggeration knob: an excited line is
        # performed harder, a serious one is reined in. Plus the one tag that
        # produces the actual SOUND of a sigh or a chuckle.
        exag = _exaggeration(voice)
        try:
            from . import emotion, expressive
            emo = emotion.overall(text)
            if emo.name in ("excited", "happy"):
                exag = min(1.0, exag + 0.18)
            elif emo.name in ("serious", "calm", "apologetic", "empathetic"):
                exag = max(0.0, exag - 0.12)

            # v0.0.40 - PER-SENTENCE EMOTION, not one tag for the whole reply.
            # A support answer routinely moves from apology to reassurance to
            # good news. Sending a single tag for all of it performs the first
            # feeling over the last two. Each sentence now carries its own tag,
            # drawn from exactly the same vetted vocabulary as before - never an
            # invented one, because a tag a model does not know gets read out
            # loud, which is the bug from v0.0.20.
            beats = expressive.plan(text) if expressive.enabled() else []
            if len(beats) > 1:
                tagged = expressive.tagged_text(beats)
                if tagged:
                    spoken = self.prepare(tagged)
            elif emo.tag and not spoken.startswith("["):
                spoken = "[" + emo.tag + "] " + spoken
        except Exception:
            pass

        kwargs: Dict = {"exaggeration": exag}
        ref = _REF or None
        if ref and Path(ref).exists():
            kwargs["audio_prompt_path"] = ref

        wav = model.generate(spoken, **kwargs)
        sr = int(getattr(model, "sr", 24000) or 24000)

        # generate() returns a torch tensor in most builds; fall back gracefully.
        try:
            samples = wav.squeeze().detach().cpu().numpy()
        except AttributeError:
            samples = wav

        return TTSResult(audio=float_to_wav(samples, sr), mime="audio/wav",
                         engine=self.id, voice=(voice or "default"),
                         sample_rate=sr, detail=_VARIANT)
