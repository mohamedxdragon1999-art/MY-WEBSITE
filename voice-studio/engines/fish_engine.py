"""Fish Audio S2.1 Pro - free cloud tier of the Ultra Human mode.

WHAT "FREE" ACTUALLY MEANS (verified against Fish's own docs, not marketing)
---------------------------------------------------------------------------
There are two different things called "free" at Fish Audio and they are easy to
confuse:

  1. The website PLAN free tier - 8,000 credits/month, ~7 minutes of audio,
     500 characters per generation. That IS tightly limited. Not what we use.
  2. The API MODEL `s2.1-pro-free` - listed at $0.00 per million UTF-8 bytes in
     the official pricing table, same endpoint as the paid model, no hard
     character cap, subject to a Fair Use Policy. This is what we use.

The real catches, stated plainly so nobody is surprised in production:
  * No SLA and no latency guarantee. It can be slow or briefly unavailable.
  * Requests may be RETAINED for model improvement. Do not send personal data,
    order numbers, card details or anything a customer would not want kept.
    Set FISH_PRIVACY_STRICT=1 to hard-disable this engine on sensitive traffic.
  * Products above ~$1M ARR are asked to contact Fish before relying on it.

Because of the no-SLA caveat this engine is designed to fail FAST and hand off
to the local tier rather than make a caller wait. That is why the timeout is
short and retries are capped.
"""
from __future__ import annotations

import os
import time
from typing import Dict, List, Optional

from . import prosody
from .base import Availability, TTSEngine, TTSResult, clean_text

_URL = os.environ.get("FISH_URL", "https://api.fish.audio/v1/tts")
_MODEL = os.environ.get("FISH_MODEL", "s2.1-pro-free")
_VOICE_ENV = os.environ.get("FISH_VOICE", "").strip()

# Short on purpose: a caller waiting in silence is worse than a slightly less
# good local voice. If Fish has not answered in this long, we move on.
try:
    _TIMEOUT = max(3.0, float(os.environ.get("FISH_TIMEOUT", "12")))
except ValueError:
    _TIMEOUT = 12.0

try:
    _RETRIES = max(0, min(3, int(os.environ.get("FISH_RETRIES", "1"))))
except ValueError:
    _RETRIES = 1

# Fair-use safety valve. Stay well-behaved automatically instead of getting the
# key throttled or banned. 0 disables the local limiter.
try:
    _MAX_RPM = max(0, int(os.environ.get("FISH_MAX_RPM", "120")))
except ValueError:
    _MAX_RPM = 120

_VOICES = {
    "en": [
        {"id": "default", "label": "Fish S2.1 Pro (natural)", "gender": "neutral"},
        {"id": "warm-support", "label": "Warm support agent", "gender": "neutral"},
        {"id": "calm-professional", "label": "Calm professional", "gender": "neutral"},
    ],
}

# Tone steering sent as an inline natural-language instruction. Fish S2.1
# accepts free-form descriptions, not a fixed enum, which is the whole reason
# it can out-act a fixed-voice competitor.
_TONE = {
    "warm-support": "[warm, friendly customer support tone]",
    "calm-professional": "[calm, professional, reassuring tone]",
}

_recent: List[float] = []   # timestamps, for the local fair-use limiter
_cooldown_until = 0.0       # set when Fish rate-limits us


def api_key() -> str:
    return (os.environ.get("FISH_API_KEY") or "").strip()


def privacy_blocked() -> bool:
    """Strict mode refuses to send any text to a tier that may retain it."""
    return (os.environ.get("FISH_PRIVACY_STRICT", "") or "").strip() in ("1", "true", "yes")


def _rate_ok() -> bool:
    """Local fair-use guard so we never hammer a free service."""
    if _MAX_RPM <= 0:
        return True
    now = time.monotonic()
    cutoff = now - 60.0
    while _recent and _recent[0] < cutoff:
        _recent.pop(0)
    return len(_recent) < _MAX_RPM


class FishEngine(TTSEngine):
    # Fish performs bracket tags like [sigh] as real breath/emotion.
    tag_aware = True
    id = "fish"
    title = "Fish Audio S2.1 Pro (free cloud)"
    description = (
        "Top-ranked open-weights voice on the blind Speech Arena. Genuinely "
        "$0 via the s2.1-pro-free model - no hard cap, fair use. Reads inline "
        "emotion tags. No SLA, and requests may be retained by Fish, so avoid "
        "sending personal data."
    )

    def availability(self) -> Availability:
        if privacy_blocked():
            return Availability(
                ok=False, needs_network=True, needs_key=True, cpu=False, quality=5,
                reason="Disabled by FISH_PRIVACY_STRICT (cloud tier may retain requests)",
                setup="Unset FISH_PRIVACY_STRICT to allow the free cloud voice")
        try:
            import httpx  # noqa: F401
        except Exception:
            return Availability(
                ok=False, needs_network=True, needs_key=True, cpu=False, quality=5,
                reason="httpx not installed", setup="pip install httpx")
        if not api_key():
            return Availability(
                ok=False, needs_network=True, needs_key=True, cpu=False, quality=5,
                reason="No FISH_API_KEY",
                setup="Free key at https://fish.audio - no credit card. Put "
                      "FISH_API_KEY=... in your .env")
        if time.monotonic() < _cooldown_until:
            return Availability(
                ok=False, needs_network=True, needs_key=True, cpu=False, quality=5,
                reason="Rate-limited by Fish, cooling down",
                setup="Recovers automatically")
        return Availability(
            ok=True, needs_network=True, needs_key=True, cpu=False, quality=5,
            reason="Ready (" + _MODEL + ", free tier, no SLA).")

    def voices(self, lang: str = "en") -> List[Dict]:
        return [dict(v, lang=lang) for v in _VOICES.get(lang[:2], _VOICES["en"])]

    def _payload(self, text: str, voice: Optional[str], rate: float) -> Dict:
        body: Dict = {"text": text, "format": "mp3", "latency": "balanced"}
        ref = _VOICE_ENV or ""
        if ref and ref not in _TONE and ref != "default":
            body["reference_id"] = ref
        # Emotion shapes the delivery speed here too: Fish understands tags for
        # the SOUND of a sigh, but an apology is also genuinely slower.
        try:
            from . import emotion
            emo = emotion.overall(text)
            rate = float(rate) * emo.rate
        except Exception:
            pass
        if rate and abs(rate - 1.0) > 0.01:
            body["speed"] = max(0.5, min(2.0, float(rate)))
        return body

    def synthesize(self, text: str, *, voice: Optional[str] = None, lang: str = "en",
                   rate: float = 1.0, pitch: float = 0.0) -> TTSResult:
        global _cooldown_until

        if privacy_blocked():
            raise RuntimeError("Fish disabled by FISH_PRIVACY_STRICT")
        key = api_key()
        if not key:
            raise RuntimeError("No FISH_API_KEY set")
        if time.monotonic() < _cooldown_until:
            raise RuntimeError("Fish is cooling down after a rate limit")
        if not _rate_ok():
            raise RuntimeError("Local fair-use limit reached (FISH_MAX_RPM)")

        import httpx

        # Shared humanization layer keeps the tags (tag_aware = True) and honours
        # VOICE_EXPRESSIVENESS, so every mode is tuned from one place.
        spoken = self.prepare(text)

        # v0.0.40 - PER-SENTENCE EMOTION. Fish performs bracket tags as real
        # breath and feeling, but it was only ever handed ONE tag for an entire
        # reply, so an answer that moves from apology to reassurance was
        # performed at a single emotional setting. Each sentence now carries its
        # own tag, drawn from exactly the same vetted vocabulary as before: no
        # invented tags, because a tag the model does not recognise gets spoken
        # out loud, which is the v0.0.20 bug.
        try:
            from . import expressive
            if expressive.enabled():
                _beats = expressive.plan(text)
                if len(_beats) > 1:
                    _tagged = expressive.tagged_text(_beats)
                    if _tagged:
                        spoken = self.prepare(_tagged)
        except Exception:
            pass
        tone = _TONE.get(voice or "", "")
        if tone:
            spoken = tone + " " + spoken

        headers = {
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "model": _MODEL,
        }
        body = self._payload(spoken, voice, rate)

        last = ""
        for attempt in range(_RETRIES + 1):
            try:
                _recent.append(time.monotonic())
                with httpx.Client(timeout=_TIMEOUT) as client:
                    resp = client.post(_URL, headers=headers, json=body)

                if resp.status_code == 429:
                    # Back off hard - this is a free service, do not fight it.
                    _cooldown_until = time.monotonic() + 30.0
                    raise RuntimeError("Fish rate limit (429) - backing off 30s")
                if resp.status_code in (401, 403):
                    raise RuntimeError("Fish rejected the API key (" +
                                       str(resp.status_code) + ")")
                if resp.status_code >= 400:
                    raise RuntimeError("Fish HTTP " + str(resp.status_code) + ": " +
                                       resp.text[:160])

                audio = resp.content
                if not audio:
                    raise RuntimeError("Fish returned empty audio")

                mime = resp.headers.get("content-type", "audio/mpeg").split(";")[0].strip()
                return TTSResult(audio=audio, mime=mime or "audio/mpeg",
                                 engine=self.id, voice=(voice or "default"),
                                 sample_rate=44100, detail=_MODEL)

            except Exception as exc:
                last = str(exc)
                # Never retry a key/auth problem or a rate limit - retrying is
                # both useless and rude.
                if "key" in last.lower() or "429" in last or "rate limit" in last.lower():
                    break
                if attempt < _RETRIES:
                    time.sleep(0.35 * (attempt + 1))
                    continue

        raise RuntimeError("Fish synthesis failed: " + (last or "unknown error"))
