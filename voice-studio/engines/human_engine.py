"""Mode 6 - Ultra Human. The new flagship voice.

Goal: beat a fixed single-vendor voice (the GPT-4o-style competitor) on the
three things people actually judge - realism, stability, and speed - without
ever charging the operator and without ever failing to speak.

Strategy: this is not a single model, it is a quality ladder. Each caller gets
the best voice their setup can actually deliver, decided per request:

  1. Fish Audio S2.1 Pro   - free cloud, highest-ranked open-weights model on
                             the blind Speech Arena. Works on phones and on
                             machines with no GPU. Chosen first when a key is
                             present because it is both the best sounding and
                             the least load on the operator's server.
  2. Chatterbox            - local, MIT, preferred over ElevenLabs in 63.75% of
                             blind tests, native emotion tags, very stable on
                             long text. Chosen when there is no Fish key or the
                             cloud is unreachable.
  3. Kokoro                - proven local CPU fallback already in this project.
  4. Edge / Piper          - last-resort voices that are always available.

Every tier gets the same prosody conditioning (contractions, natural pauses,
paralinguistic tags), so even the fallback sounds materially more human than it
did before. Tags are stripped automatically for engines that cannot read them.

The ladder is what produces stability. A single model, however good, has a bad
day: the cloud rate-limits, the weights are missing, a caller is on a weak CPU.
Ultra Human degrades one rung instead of failing.
"""
from __future__ import annotations

import os
import time
from typing import Dict, List, Optional

from . import cpu_profile, prosody
from .base import Availability, TTSEngine, TTSResult, clean_text

# Preference order. Override with HUMAN_ORDER=chatterbox,fish,kokoro
#
# v0.0.51 - kokoro moved to the front. The old order led with fish and
# chatterbox, which need a local GPU; on a CPU-only deployment the ladder spent
# two failing rungs before reaching the engine that was always going to serve
# the audio. cpu_profile filters the final list either way, so an operator who
# DOES have a GPU can set VOICE_CPU_ONLY=0 and get the old behaviour back.
_DEFAULT_ORDER = ["kokoro", "edge", "piper", "chatterbox", "fish"]

# Engines that understand bracket emotion tags natively.
_TAG_AWARE = {"fish", "chatterbox"}

# Short cooldown after a tier fails, so one broken rung does not get retried on
# every single request while a caller is waiting.
_COOLDOWN = float(os.environ.get("HUMAN_COOLDOWN_SEC", "20"))


def _order() -> List[str]:
    raw = (os.environ.get("HUMAN_ORDER") or "").strip()
    if not raw:
        return cpu_profile.filter_order(_DEFAULT_ORDER)
    picked = [p.strip().lower() for p in raw.replace(",", " ").split() if p.strip()]
    # An explicit HUMAN_ORDER is still filtered: naming an engine cannot
    # conjure a GPU, and silently obeying it would reintroduce the exact
    # latency tax this release removes.
    return cpu_profile.filter_order(picked or _DEFAULT_ORDER)


def _level() -> float:
    """How expressive to be. 0 = flat, 1 = very animated."""
    try:
        return max(0.0, min(1.0, float(os.environ.get("HUMAN_EXPRESSIVENESS", "0.5"))))
    except ValueError:
        return 0.5


class HumanEngine(TTSEngine):
    id = "human"
    title = "Ultra Human (best available)"
    description = (
        "The most human-sounding option. Uses Fish Audio S2.1 Pro (free cloud, "
        "top-ranked open-weights voice) when available, Chatterbox locally "
        "otherwise, and always applies natural pacing, contractions and emotion "
        "cues. Never fails to speak - it steps down a tier instead."
    )

    def __init__(self, registry: Dict[str, TTSEngine]):
        # Same pattern as BestEngine: hold the sibling engines, never re-create.
        self._registry = registry
        self._blocked: Dict[str, float] = {}

    # ------------------------------------------------------------------
    def _candidates(self) -> List[str]:
        now = time.monotonic()
        out = []
        for eid in _order():
            eng = self._registry.get(eid)
            if eng is None:
                continue
            until = self._blocked.get(eid, 0.0)
            if until > now:
                continue
            try:
                if eng.availability_cached().ok:
                    out.append(eid)
            except Exception:
                continue
        return out

    def availability(self) -> Availability:
        ready = self._candidates()
        if not ready:
            return Availability(
                ok=False, cpu=True, quality=5,
                reason="No underlying voice is ready yet",
                setup="Set FISH_API_KEY for the free cloud voice, or "
                      "pip install chatterbox-tts for the local one")
        top = ready[0]
        eng = self._registry[top]
        needs_net = top in ("fish", "edge", "magpie")
        return Availability(
            ok=True, cpu=(top not in ("fish", "magpie")),
            needs_network=needs_net, needs_key=(top == "fish"), quality=5,
            reason="Ready - currently using " + eng.title +
                   " (" + str(len(ready)) + " voice tiers available).")

    def voices(self, lang: str = "en") -> List[Dict]:
        """Expose the active tier's voices so the picker stays meaningful."""
        ready = self._candidates()
        if not ready:
            return []
        try:
            return self._registry[ready[0]].voices(lang)
        except Exception:
            return []

    def warmup(self) -> None:
        for eid in self._candidates():
            fn = getattr(self._registry.get(eid), "warmup", None)
            if callable(fn):
                try:
                    fn()
                except Exception:
                    pass

    # ------------------------------------------------------------------
    def synthesize(self, text: str, *, voice: Optional[str] = None, lang: str = "en",
                   rate: float = 1.0, pitch: float = 0.0) -> TTSResult:
        base = clean_text(text)
        if not base:
            raise RuntimeError("Nothing to speak")

        candidates = self._candidates()
        if not candidates:
            raise RuntimeError(
                "No voice engine is ready. Set FISH_API_KEY or install chatterbox-tts.")

        level = _level()
        errors: List[str] = []

        for eid in candidates:
            eng = self._registry[eid]
            # Only send bracket tags to engines that can actually read them,
            # otherwise the caller literally hears "bracket laugh bracket".
            spoken = prosody.humanize(base, tags=(eid in _TAG_AWARE), level=level)
            try:
                res = eng.synthesize(spoken, voice=voice, lang=lang,
                                     rate=rate, pitch=pitch)
                if res and res.audio:
                    res.detail = ("ultra-human via " + eng.title +
                                  ((" / " + res.detail) if res.detail else ""))
                    return res
                errors.append(eid + ": empty audio")
            except Exception as exc:
                errors.append(eid + ": " + str(exc)[:120])
                # Bench this tier briefly so the next caller skips it.
                self._blocked[eid] = time.monotonic() + _COOLDOWN

        raise RuntimeError("All Ultra Human tiers failed -> " + "; ".join(errors))
