"""THE ONE SHARED EMOTIONAL PERFORMANCE LAYER, USED BY EVERY MODE.

WHY THIS FILE EXISTS
--------------------
Before v0.0.40 emotion was not a property of the product, it was a property of
two engines. A survey of the eight engines found:

    piper       per-sentence emotion plan + full prosody DSP   <- expressive
    kokoro      per-sentence emotion plan + full prosody DSP   <- expressive
    fish        ONE flat emotion for the whole reply
    chatterbox  ONE flat emotion for the whole reply
    edge        ONE flat emotion for the whole reply   <- AND THIS IS THE DEFAULT
    magpie      no emotion at all
    best        no emotion of its own
    human       no emotion of its own

That is why "I don't think there is emotions at all" was a fair description.
The modes most people actually hear were the ones with the least expression, and
a single rate/pitch/volume applied to an entire reply is precisely the classic
robot tell: nothing moves *within* what the agent says.

WHAT A HUMAN ACTUALLY DOES
--------------------------
A person does not deliver three sentences at one emotional setting. They open at
a slightly higher energy, carry the middle, and settle at the end - and each
sentence gets its own tempo, pitch centre, loudness and terminal contour. Two
things therefore live here:

  1. PER-BEAT PARAMETERS - every sentence is performed on its own terms.
  2. AN EMOTIONAL ARC - the intensity itself changes across the reply, so a
     reply has a shape instead of a constant level. This is the piece that was
     missing even from the two engines that already had per-beat emotion.

HOW ENGINES USE IT
------------------
Engines differ in what they can be told, so there are two entry points:

  * render_wav_beats(...)  - for engines that hand back raw WAV per sentence.
    Each sentence is synthesised, then run through the prosody DSP with that
    beat's contour/emphasis/pitch, then joined with REAL silence between beats.

  * arender_beats(...)     - for network engines that accept prosody settings
    directly (Edge, Magpie). Each sentence becomes its own request with its own
    rate/pitch/volume, and the requests run CONCURRENTLY, so a three-sentence
    performance costs about the same wall-clock time as one flat request. This
    is the rare upgrade that makes the voice both more human AND not slower.

Everything degrades safely: if planning fails, or a beat comes back empty, the
helpers return None and the calling engine keeps its original single-shot path.
Emotion is an enhancement and must never be a reason to lose the voice.
"""
from __future__ import annotations

import asyncio
import os
from typing import Callable, List, Optional, Sequence, Tuple

from . import emotion, voice_fx
from .base import concat_wav, silence_wav


def _fl(name: str, default: float, lo: float, hi: float) -> float:
    try:
        v = float(os.environ.get(name, "") or default)
    except Exception:
        v = default
    return max(lo, min(hi, v))


def enabled() -> bool:
    """Set VOICE_EXPRESSIVE=0 to fall back to flat single-shot delivery."""
    return os.environ.get("VOICE_EXPRESSIVE", "1") != "0"


def intensity() -> float:
    """How strongly emotion is applied overall (shared with the older knob)."""
    return _fl("VOICE_EMOTION_INTENSITY", 0.75, 0.0, 1.5)


def arc_strength() -> float:
    """How much the intensity is allowed to move across one reply."""
    return _fl("VOICE_EMOTION_ARC", 0.35, 0.0, 1.0)


def opening_breath_ms() -> int:
    """A soft inhale before a heavy reply. Set VOICE_BREATH_MS=0 to disable.

    voice_fx.prepend_breath() has existed since v0.0.41 and was never called by
    anything except its own test - written, shipped, and completely inert.

    It is deliberately NOT applied to every sentence. A person inhales before
    they start speaking, not between every clause of one thought, and a breath
    on all of them would sound asthmatic. It is also only used for the heavy
    emotions, where drawing breath before bad news is exactly what a person
    does; on a cheerful confirmation it would read as reluctance.
    """
    return int(_fl("VOICE_BREATH_MS", 150.0, 0.0, 400.0))


def plan(text: str, *, level: float = -1.0):
    """The per-sentence performance plan, or [] if planning is unavailable."""
    try:
        return emotion.plan(text, level=level)
    except Exception:
        return []


def arc(count: int) -> List[float]:
    """Intensity multiplier per beat: open a little stronger, settle at the end.

    A flat list of 1.0s would be the old behaviour. The shape is deliberately
    gentle - this is the difference between a reply that has a direction and one
    that is merely loud.
    """
    if count <= 0:
        return []
    if count == 1:
        return [1.0]
    s = arc_strength()
    out: List[float] = []
    for i in range(count):
        pos = i / float(count - 1)          # 0.0 at the first beat, 1.0 at the last
        shape = 1.0 + s * (0.45 - 0.85 * pos)
        out.append(max(0.35, min(1.6, shape)))
    return out


def beat_intensity(index: int, count: int, base: Optional[float] = None) -> float:
    b = intensity() if base is None else float(base)
    shape = arc(count)
    m = shape[index] if 0 <= index < len(shape) else 1.0
    return max(0.0, min(1.6, b * m))


def beat_params(beat, rate: float = 1.0, pitch: float = 0.0,
                boost: float = 1.0) -> Tuple[float, float, float]:
    """The user's settings combined with this beat's emotion.

    The emotional DEVIATION from neutral is what gets scaled, never the absolute
    value - so turning expressiveness down lands on a normal voice rather than on
    a whisper or a chipmunk.
    """
    er = float(getattr(beat, "rate", 1.0) or 1.0)
    ep = float(getattr(beat, "pitch", 0.0) or 0.0)
    ev = float(getattr(beat, "volume", 1.0) or 1.0)
    er = 1.0 + (er - 1.0) * boost
    ep = ep * boost
    ev = 1.0 + (ev - 1.0) * boost
    return (
        max(0.5, min(2.0, float(rate) * er)),
        max(-12.0, min(12.0, float(pitch) + ep)),
        max(0.5, min(1.5, ev)),
    )


def render_wav_beats(
    beats,
    synth_one: Callable[[str, float, float, float], bytes],
    *,
    sample_rate: int,
    rate: float = 1.0,
    pitch: float = 0.0,
    fx: bool = True,
    pitch_via_fx: bool = True,
    seed: int = 0,
    prepare: Optional[Callable[[str], str]] = None,
) -> Optional[bytes]:
    """Perform a plan with a WAV-returning engine.

    synth_one(text, rate, pitch, volume) -> WAV bytes for ONE sentence.

    pitch_via_fx: True for engines with no pitch control of their own (Piper),
    where the pitch movement has to be applied to the rendered waveform. False
    for engines that were already told the pitch, so it is not applied twice.
    """
    if not beats:
        return None
    chunks: List[bytes] = []
    n = len(beats)
    for i, b in enumerate(beats):
        raw = (getattr(b, "text", "") or "").strip()
        spoken = prepare(raw) if prepare is not None else raw
        if not spoken:
            continue
        boost = beat_intensity(i, n)
        br, bp, bv = beat_params(b, rate, pitch, boost)
        try:
            wav = synth_one(spoken, br, bp, bv)
        except Exception:
            return None
        if not wav:
            continue
        if fx:
            emo_name = getattr(getattr(b, "emotion", None), "name", "neutral")
            try:
                wav = voice_fx.render(
                    wav,
                    contour=getattr(b, "contour", "fall") or "fall",
                    emphasis=getattr(b, "emphasis", ()) or (),
                    text=raw,
                    pitch_st=(bp if pitch_via_fx else 0.0),
                    emotion=emo_name,
                    intensity=boost,
                    seed=seed + i,
                    # v0.0.47 - the planner has always computed these micro-pauses
                    # at commas and nothing ever rendered them. Passed explicitly
                    # because these beats have been through _smooth(), so they are
                    # better than what render() would re-derive from the raw text.
                    clause_gaps=getattr(b, "clause_gaps", ()) or (),
                )
            except Exception:
                pass
            # An inhale belongs at the START of the turn only - see
            # opening_breath_ms() for why not on every sentence.
            if i == 0 and emo_name in voice_fx._HEAVY:
                bms = opening_breath_ms()
                if bms > 0:
                    try:
                        wav = voice_fx.prepend_breath(wav, ms=bms)
                    except Exception:
                        pass
        chunks.append(wav)
        gap = int(getattr(b, "pause_after_ms", 0) or 0)
        if gap > 0:
            try:
                chunks.append(silence_wav(gap, sample_rate))
            except Exception:
                pass
    if not chunks:
        return None
    try:
        return concat_wav(chunks)
    except Exception:
        return None


def max_parallel() -> int:
    """How many sentence requests may be in flight for ONE reply.

    FOUND IN THE v0.0.41 AUDIT: this used to be unbounded. Per-sentence
    synthesis is what makes the voice expressive, but firing every sentence at
    once means a 10-sentence reply opens 10 sockets, and 50 concurrent callers
    open ~500 - which gets a shared TTS endpoint to rate-limit or reset the
    connection, turning an expression upgrade into an outage. A small cap keeps
    nearly all of the latency win (the first few sentences are what the listener
    is waiting for) while bounding the fan-out.
    """
    try:
        v = int(float(os.environ.get("VOICE_EXPRESSIVE_MAX_PARALLEL", "4") or 4))
    except Exception:
        v = 4
    return max(1, min(16, v))


async def arender_beats(
    beats,
    asynth_one,
    *,
    rate: float = 1.0,
    pitch: float = 0.0,
    concurrent: bool = True,
    joiner: Optional[Callable[[List[bytes]], bytes]] = None,
) -> Optional[bytes]:
    """Perform a plan with a network engine, one request per sentence.

    asynth_one(text, rate, pitch, volume) -> encoded audio bytes for ONE
    sentence. Requests overlap in time (bounded by `max_parallel`), which is what
    keeps a real performance from costing N times the latency of a flat one.

    A single failed sentence is RETRIED once on its own before giving up, because
    the alternative - re-synthesizing the whole reply flat - makes the listener
    wait for two full attempts. Only if that retry also fails do we return None,
    since half a reply is worse than a flat one.
    """
    if not beats:
        return None
    jobs: List[Tuple[str, float, float, float]] = []
    n = len(beats)
    for i, b in enumerate(beats):
        t = (getattr(b, "text", "") or "").strip()
        if not t:
            continue
        boost = beat_intensity(i, n)
        br, bp, bv = beat_params(b, rate, pitch, boost)
        jobs.append((t, br, bp, bv))
    if not jobs:
        return None
    if concurrent and len(jobs) > 1:
        sem = asyncio.Semaphore(min(max_parallel(), len(jobs)))

        async def _one(job):
            async with sem:
                return await asynth_one(*job)

        results = list(await asyncio.gather(
            *[_one(job) for job in jobs],
            return_exceptions=True,
        ))
    else:
        results = []
        for job in jobs:
            try:
                results.append(await asynth_one(*job))
            except Exception as exc:  # noqa: BLE001
                results.append(exc)
    # Retry ONLY the sentences that failed. One flaky socket should cost one
    # extra sentence, not a second pass over the entire reply.
    for i, r in enumerate(results):
        if isinstance(r, BaseException) or not r:
            try:
                results[i] = await asynth_one(*jobs[i])
            except Exception as exc:  # noqa: BLE001
                results[i] = exc
    parts: List[bytes] = []
    for r in results:
        if isinstance(r, BaseException) or not r:
            return None
        parts.append(r)
    if joiner is not None:
        try:
            return joiner(parts)
        except Exception:
            return None
    return b"".join(parts)


def tagged_text(beats, allowed: Optional[Sequence[str]] = None) -> str:
    """Rebuild the reply with per-sentence emotion tags for tag-aware engines.

    Only tags the engine actually supports are ever emitted. Inventing tags a
    model does not know is worse than sending none, because the model reads them
    out loud - which is exactly the 'it says the word sigh' bug from v0.0.20.
    """
    if not beats:
        return ""
    ok = set(allowed or ())
    out: List[str] = []
    for b in beats:
        t = (getattr(b, "text", "") or "").strip()
        if not t:
            continue
        tag = ""
        try:
            tag = emotion.tag_for(t) or ""
        except Exception:
            tag = ""
        tag = tag.strip()
        if tag and (not ok or tag in ok):
            out.append(tag + " " + t)
        else:
            out.append(t)
    return " ".join(out).strip()


def describe(beats) -> str:
    """A short human-readable label of the performance, for the UI/detail field."""
    if not beats:
        return "neutral"
    names: List[str] = []
    for b in beats:
        nm = getattr(getattr(b, "emotion", None), "name", "") or ""
        if nm and (not names or names[-1] != nm):
            names.append(nm)
    if not names:
        return "neutral"
    return "expressive:" + ">".join(names[:4])
