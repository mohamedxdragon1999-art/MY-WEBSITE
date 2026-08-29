"""Common TTS engine interface + audio helpers.

Every engine returns a `TTSResult` (raw audio bytes + mime). Engines are sync;
the server runs them in a threadpool. Availability is introspectable so the UI
can honestly show which modes are ready and what setup each needs.

No third-party imports at module load (only numpy, which is light) so the whole
registry can be imported and introspected even when TTS backends aren't installed.
"""
from __future__ import annotations

import io
import os
import re
import time
import wave
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from . import speakable


@dataclass
class TTSResult:
    audio: bytes
    mime: str            # "audio/wav" | "audio/mpeg"
    engine: str
    voice: str
    sample_rate: int = 24000
    detail: str = ""


@dataclass
class Availability:
    ok: bool
    reason: str = ""
    needs_network: bool = False
    needs_key: bool = False
    cpu: bool = True            # True = runs on the user's CPU (no GPU needed)
    quality: int = 3           # 1..5 subjective naturalness
    setup: str = ""

    def to_dict(self) -> Dict:
        return {
            "ok": self.ok,
            "reason": self.reason,
            "needs_network": self.needs_network,
            "needs_key": self.needs_key,
            "cpu": self.cpu,
            "quality": self.quality,
            "setup": self.setup,
        }


class TTSEngine:
    id: str = "base"
    title: str = "Base"
    description: str = ""

    # True only for engines that can actually PERFORM bracket tags like [sigh].
    # For every other engine those tags must be removed, or the voice literally
    # reads out "bracket sigh bracket".
    tag_aware: bool = False

    _av_cache = None  # (timestamp, Availability)

    def prepare(self, text: str, *, limit: int = 4000) -> str:
        """Every engine runs its text through here, so EVERY mode gets the same
        human treatment - not just the Ultra Human mode.

        Neural voices sound robotic mostly because the TEXT is robotic. Written
        English ('I am not able to do that') is not spoken English ('I'm not
        able to do that'), and no amount of model quality fixes that. So we
        apply contractions, natural pacing and breath points to all of them,
        and add performable tags only where the engine understands them.
        """
        from . import prosody

        if not humanize_enabled():
            return clean_text(text, limit=limit)
        try:
            level = expressiveness()
            already_tagged = prosody.has_tags(text)

            if self.tag_aware and already_tagged:
                # An upstream layer already chose the performance tags. We must
                # humanize the WORDS without re-tagging (which would double up)
                # and without stripping (humanize(tags=False) removes them), so
                # humanize the spans between tags and stitch the tags back in.
                out, last = [], 0
                for m in prosody._TAG_RE.finditer(text):
                    out.append(prosody.humanize(text[last:m.start()], tags=False,
                                                level=level, contractions=True, pacing=True))
                    out.append(m.group(0))
                    last = m.end()
                out.append(prosody.humanize(text[last:], tags=False,
                                            level=level, contractions=True, pacing=True))
                spoken = " ".join(part for part in out if part.strip())
            else:
                spoken = prosody.humanize(
                    text,
                    tags=self.tag_aware,
                    level=level,
                    contractions=True,
                    pacing=True,
                )
                if not self.tag_aware:
                    spoken = prosody.strip_tags(spoken)
            return clean_text(spoken, limit=limit)
        except Exception:
            # Humanization is an enhancement, never a reason to lose the voice.
            return clean_text(text, limit=limit)

    def emotion_params(self, text: str, rate: float = 1.0, pitch: float = 0.0):
        """Turn the MEANING of a line into real acoustic settings.

        Every mode calls this, so emotion is no longer a property of one
        premium engine - it is how the whole product speaks. Returns
        (rate, pitch, volume, emotion_name), already combined with whatever
        speed/pitch the user chose in Settings.

        This is the difference between saying the word "sigh" and actually
        sounding sorry: an apology comes back slower, lower and softer, while
        good news comes back faster, higher and brighter.
        """
        try:
            from . import emotion
            emo = emotion.overall(text)
            return (
                max(0.5, min(2.0, float(rate) * emo.rate)),
                max(-12.0, min(12.0, float(pitch) + emo.pitch)),
                max(0.5, min(1.5, emo.volume)),
                emo.name,
            )
        except Exception:
            # Emotion is an enhancement; never a reason to lose the voice.
            return (float(rate), float(pitch), 1.0, "neutral")

    def emotion_beats(self, text: str):
        """Per-sentence performance plan, for engines that can stitch audio.

        A single rate for a whole paragraph is the classic robot tell. This
        lets an engine deliver each sentence with its own tone and put REAL
        silence between them instead of pronouncing the word "pause".
        """
        try:
            from . import emotion
            return emotion.plan(text)
        except Exception:
            return []

    def availability(self) -> Availability:
        raise NotImplementedError

    def availability_cached(self, ttl: float = 5.0) -> Availability:
        """availability() memoized for a few seconds. Availability does import
        probes and filesystem stats; caching keeps hot paths (every /api/tts and
        /api/engines call) cheap under load without hiding real state changes."""
        now = time.monotonic()
        cached = self._av_cache
        if cached is not None and (now - cached[0]) < ttl:
            return cached[1]
        av = self.availability()
        self._av_cache = (now, av)
        return av

    def voices(self, lang: str = "en") -> List[Dict]:
        """Return [{id, label, lang, gender}] for the given language."""
        return []

    def synthesize(self, text: str, *, voice: Optional[str] = None,
                   lang: str = "en", rate: float = 1.0, pitch: float = 0.0) -> TTSResult:
        raise NotImplementedError


# ----------------------------- humanization config -----------------------

def humanize_enabled() -> bool:
    """Global off-switch. Set VOICE_HUMANIZE=0 to send text through verbatim
    (useful when a script must be read exactly as written, e.g. legal copy)."""
    return os.environ.get("VOICE_HUMANIZE", "1").strip().lower() not in ("0", "false", "no")


def expressiveness() -> float:
    """0.0 = flat and literal, 1.0 = very expressive. Clamped for safety."""
    try:
        val = float(os.environ.get("VOICE_EXPRESSIVENESS", "0.5"))
    except (TypeError, ValueError):
        return 0.5
    return max(0.0, min(1.0, val))


# ----------------------------- text helpers -----------------------------

_MD = re.compile(r"[*_`#>|]")
_LINK = re.compile(r"\[(.*?)\]\(.*?\)")
_WS = re.compile(r"\s+")


def clean_text(text: str, limit: int = 4000) -> str:
    """Normalize text for natural speech: strip markdown, collapse whitespace,
    keep sentence punctuation (drives natural prosody/pauses in neural TTS)."""
    t = _LINK.sub(r"\1", text or "")
    t = _MD.sub("", t)
    t = _WS.sub(" ", t).strip()
    # v0.0.32b - MODELS WRITE FOR THE EYE, ENGINES SPEAK FOR THE EAR.
    # Until now every engine was handed raw text, so callers heard "dollar
    # forty five point nine nine", "three MINUS five days" and a phone number
    # made of minus signs. This is the single cheapest sound-quality win in the
    # whole pipeline: no model change, no extra latency, just saying the words
    # the way a person would. Runs here because clean_text is the one function
    # every engine already calls.
    t = speakable.normalize(t)
    return t[:limit]


_SENT = re.compile(r"(?<=[.!?\u061f\u060c])\s+")


def split_sentences(text: str, max_len: int = 240) -> List[str]:
    """Split into speakable chunks (sentence-aware) to reduce latency / memory."""
    text = clean_text(text)
    if not text:
        return []
    parts: List[str] = []
    # Splitting on a protected copy stops "Dr. Smith" and "2.5" from being torn
    # into separate utterances, each with its own falling pitch and pause.
    for sent in speakable.split_keeping_abbreviations(text, _SENT):
        sent = sent.strip()
        if not sent:
            continue
        while len(sent) > max_len:
            cut = sent.rfind(" ", 0, max_len)
            cut = cut if cut > 0 else max_len
            parts.append(sent[:cut].strip())
            sent = sent[cut:].strip()
        if sent:
            parts.append(sent)
    return parts


# ----------------------------- audio helpers -----------------------------

def float_to_wav(samples, sample_rate: int, channels: int = 1) -> bytes:
    """Convert a float32/float64 numpy array in [-1, 1] to 16-bit PCM WAV bytes."""
    import numpy as np
    arr = np.asarray(samples, dtype=np.float32)
    arr = np.clip(arr, -1.0, 1.0)
    pcm = (arr * 32767.0).astype("<i2").tobytes()
    return pcm_to_wav(pcm, sample_rate, channels=channels, sampwidth=2)


def pcm_to_wav(pcm: bytes, sample_rate: int, channels: int = 1, sampwidth: int = 2) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sampwidth)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return buf.getvalue()


def concat_wav(chunks: List[bytes]) -> Optional[bytes]:
    """Concatenate multiple mono WAV byte-blobs that share format."""
    chunks = [c for c in chunks if c]
    if not chunks:
        return None
    if len(chunks) == 1:
        return chunks[0]
    params = None
    frames = []
    for c in chunks:
        with wave.open(io.BytesIO(c), "rb") as wf:
            if params is None:
                params = wf.getparams()
            frames.append(wf.readframes(wf.getnframes()))
    out = io.BytesIO()
    with wave.open(out, "wb") as wf:
        wf.setnchannels(params.nchannels)
        wf.setsampwidth(params.sampwidth)
        wf.setframerate(params.framerate)
        wf.writeframes(b"".join(frames))
    return out.getvalue()


def volume_to_percent(volume: float) -> str:
    """1.0 -> '+0%', 0.95 -> '-5%' (edge-tts style volume string)."""
    pct = int(round((float(volume) - 1.0) * 100))
    pct = max(-50, min(50, pct))
    return f"{pct:+d}%"


def silence_wav(ms: int, sample_rate: int = 24000) -> bytes:
    """A real silent WAV, used to put honest pauses between sentences."""
    frames = max(0, int(sample_rate * (max(0, int(ms)) / 1000.0)))
    return pcm_to_wav(b"\x00\x00" * frames, sample_rate)


def rate_to_percent(rate: float) -> str:
    """1.0 -> '+0%', 1.2 -> '+20%', 0.9 -> '-10%' (edge-tts style)."""
    pct = int(round((float(rate) - 1.0) * 100))
    pct = max(-50, min(50, pct))
    return f"{pct:+d}%"


def pitch_to_hz(pitch: float) -> str:
    """Semitone-ish pitch offset -> edge-tts Hz string, clamped."""
    hz = int(round(float(pitch) * 10))
    hz = max(-50, min(50, hz))
    return f"{hz:+d}Hz"
