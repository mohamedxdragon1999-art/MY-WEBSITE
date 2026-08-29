"""Acoustic prosody rendering - real DSP on the generated waveform.

Up to v6.2 the emotion layer could only ask an engine for a different SPEAKING
RATE. Kokoro and Piper expose no pitch control at all, so a rising question was
faked by speaking slightly faster. That is a tempo trick, not intonation, and it
is why the result still sounded flat.

This module edits the audio itself, so every engine that returns WAV gets:
  * real F0 movement (terminal rise / fall)
  * declination - the downward pitch drift across an utterance that happens in
    every human language, and one of the strongest cues that a person spoke
  * word-level emphasis rendered as gain
  * jitter and shimmer - the micro-instability of real vocal folds. Perfectly
    steady pitch and amplitude is the most machine-like property a voice has
  * breath before long or heavy sentences

Pitch shifting uses resample + overlap-add time-restore. Shifts stay small
(under ~3 semitones) because large shifts drag the formants along and produce
the classic chipmunk artefact.

Everything degrades safely: if numpy is missing or the audio is unreadable,
every function returns its input untouched.
"""
from __future__ import annotations

import io
import math
import os
import re
import wave
from typing import List, Optional, Sequence


def _np():
    try:
        import numpy as np
        return np
    except Exception:
        return None


def enabled() -> bool:
    """Master switch. On by default; VOICE_FX=0 ships raw engine audio."""
    return os.environ.get("VOICE_FX", "1").strip().lower() not in ("0", "false", "no", "off")


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


def strength() -> float:
    """How far prosody is pushed. 0 = bypass, 1 = full performance."""
    return max(0.0, min(1.5, _env_float("VOICE_FX_STRENGTH", 1.0)))


def read_wav(data: bytes):
    """Return (float samples in [-1,1], sample_rate, channels) or None."""
    np = _np()
    if np is None or not data:
        return None
    try:
        with wave.open(io.BytesIO(data), "rb") as wf:
            ch = wf.getnchannels()
            sw = wf.getsampwidth()
            sr = wf.getframerate()
            raw = wf.readframes(wf.getnframes())
    except Exception:
        return None
    if sw != 2 or not raw:
        return None
    arr = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1:
        arr = arr.reshape(-1, ch).mean(axis=1)
    return arr, sr, 1


def write_wav(samples, sr: int) -> bytes:
    np = _np()
    arr = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sr))
        wf.writeframes((arr * 32767.0).astype("<i2").tobytes())
    return buf.getvalue()


def _resample(x, factor: float):
    """Linear resample by factor (>1 = longer/lower, <1 = shorter/higher)."""
    np = _np()
    n_out = max(1, int(round(len(x) * factor)))
    src = np.linspace(0.0, len(x) - 1.0, n_out, dtype=np.float32)
    return np.interp(src, np.arange(len(x), dtype=np.float32), x).astype(np.float32)


def _time_stretch(x, rate: float, sr: int):
    """WSOLA time stretch. rate>1 = shorter. Preserves pitch.

    A naive overlap-add does NOT work here, and the failure is subtle enough to
    be worth recording: if you copy frames from evenly spaced analysis points
    and lay them down at a different spacing, a periodic signal simply picks up
    the new spacing as its period. The pitch shift you applied by resampling is
    silently undone, and you get back almost exactly the frequency you started
    with.

    WSOLA fixes it by not trusting the analysis position: for each output frame
    it searches a few milliseconds either side for the segment that best
    continues what was already written, so successive frames stay phase
    aligned and the waveform's own period survives.
    """
    np = _np()
    if abs(rate - 1.0) < 1e-3 or len(x) < 1024:
        return x
    win = max(256, int(sr * 0.030) // 2 * 2)
    hop_out = win // 2
    hop_in = float(hop_out) * float(rate)
    if hop_in < 1.0:
        return x
    search = max(8, int(sr * 0.005))          # +/- 5ms of wiggle room
    window = np.hanning(win).astype(np.float32)

    usable = len(x) - win - search - 1
    if usable <= 0:
        return x
    n_frames = max(1, int(usable / hop_in))
    out_len = hop_out * (n_frames - 1) + win
    out = np.zeros(out_len, dtype=np.float32)
    wsum = np.zeros(out_len, dtype=np.float32)

    # What the next frame ideally continues from.
    template = x[:win].astype(np.float32)
    for i in range(n_frames):
        centre = int(i * hop_in)
        lo = max(0, centre - search)
        hi = min(len(x) - win, centre + search)
        best = centre if lo >= hi else lo
        if hi > lo:
            # Coarse correlation search: ~17 candidates is plenty and keeps
            # this cheap enough to run per sentence while serving callers.
            step = max(1, (hi - lo) // 16)
            cands = range(lo, hi + 1, step)
            best_score = -1e30
            for c in cands:
                seg = x[c:c + win]
                if len(seg) < win:
                    continue
                score = float(np.dot(seg, template))
                if score > best_score:
                    best_score = score
                    best = c
        seg = x[best:best + win]
        if len(seg) < win:
            seg = np.pad(seg, (0, win - len(seg)))
        b = i * hop_out
        out[b:b + win] += seg * window
        wsum[b:b + win] += window
        # The natural continuation of the frame we just used.
        nxt = x[best + hop_out:best + hop_out + win]
        if len(nxt) == win:
            template = nxt.astype(np.float32)
    return (out / np.maximum(wsum, 1e-6)).astype(np.float32)


def pitch_shift(x, sr: int, semitones: float):
    """Shift pitch while keeping duration. Small shifts only, by design."""
    np = _np()
    if np is None or abs(semitones) < 0.02 or len(x) < 512:
        return x
    semitones = max(-6.0, min(6.0, float(semitones)))
    ratio = 2.0 ** (semitones / 12.0)
    shifted = _resample(x, 1.0 / ratio)
    restored = _time_stretch(shifted, 1.0 / ratio, sr)
    if len(restored) < len(x):
        # v0.0.47 - THE DROPOUTS. This used to be np.pad(..., zeros), which is
        # DIGITAL SILENCE glued onto the end of every shifted slice. WSOLA cannot
        # emit its final partial frame, so the shortfall is always there, and
        # pitch_ramp calls this function once PER SEGMENT - so a 7-segment ramp
        # punched 7 holes into every sentence (measured: ~22.7ms each, ~165ms of
        # a 2.4s sentence, in every engine, on every reply). Small dropouts like
        # that are heard as a glitchy, mechanical voice.
        # The shortfall is now filled with the REAL trailing audio, cross-faded
        # in. Those last few ms carry their original pitch rather than the
        # shifted pitch, which over <25ms is inaudible - and is unarguably better
        # than a hole.
        need = len(x) - len(restored)
        f = int(min(max(16, int(sr * 0.004)), len(restored) // 2, len(x) - need))
        if f > 8:
            tail = np.asarray(x[len(x) - need - f:], dtype=np.float32)
            ramp = np.linspace(0.0, 1.0, f, dtype=np.float32)
            join = restored[-f:] * (1.0 - ramp) + tail[:f] * ramp
            restored = np.concatenate([restored[:-f], join, tail[f:]])
        else:
            restored = np.concatenate(
                [restored, np.asarray(x[len(x) - need:], dtype=np.float32)])
    return restored[:len(x)]


def pitch_ramp(x, sr: int, start_st: float, end_st: float, segments: int = 6):
    """Glide pitch from start_st to end_st across the audio.

    Real intonation is a curve, not a step, so we shift several slices by
    increasing amounts and join them with short cross-fades.
    """
    np = _np()
    if np is None or len(x) < sr // 8:
        return x
    if abs(start_st) < 0.02 and abs(end_st) < 0.02:
        return x
    segments = max(2, min(12, segments))
    bounds = np.linspace(0, len(x), segments + 1).astype(int)
    fade = max(32, int(sr * 0.006))
    pieces: List = []
    for i in range(segments):
        a, b = int(bounds[i]), int(bounds[i + 1])
        if b - a < 64:
            continue
        t = (i + 0.5) / segments
        pieces.append(pitch_shift(x[a:b], sr, start_st + (end_st - start_st) * t))
    if not pieces:
        return x
    out = pieces[0]
    for nxt in pieces[1:]:
        f = min(fade, len(out), len(nxt))
        if f > 8:
            ramp = np.linspace(0.0, 1.0, f, dtype=np.float32)
            tail = out[-f:] * (1.0 - ramp) + nxt[:f] * ramp
            out = np.concatenate([out[:-f], tail, nxt[f:]])
        else:
            out = np.concatenate([out, nxt])
    return out.astype(np.float32)


def jitter_shimmer(x, sr: int, jitter: float = 0.004, shimmer: float = 0.035, seed: int = 0):
    """Add micro-instability to pitch (jitter) and amplitude (shimmer).

    Vocal folds are soft tissue and never repeat a cycle exactly. Synthetic
    speech is perfectly regular, and listeners hear that regularity as
    machinery even when they cannot say why.
    """
    np = _np()
    if np is None or len(x) < 512 or (jitter <= 0 and shimmer <= 0):
        return x
    rng = np.random.default_rng(int(seed) or 12345)
    out = x
    if shimmer > 0:
        n_ctrl = max(4, int(len(x) / (sr * 0.045)))
        ctrl = (1.0 + rng.normal(0.0, shimmer, n_ctrl)).astype(np.float32)
        env = np.interp(
            np.linspace(0, n_ctrl - 1, len(x)).astype(np.float32),
            np.arange(n_ctrl, dtype=np.float32), ctrl,
        ).astype(np.float32)
        out = out * env
    if jitter > 0:
        n_ctrl = max(4, int(len(x) / (sr * 0.030)))
        drift = rng.normal(0.0, jitter, n_ctrl).astype(np.float32)
        warp = np.interp(
            np.linspace(0, n_ctrl - 1, len(out)).astype(np.float32),
            np.arange(n_ctrl, dtype=np.float32), drift,
        ).astype(np.float32)
        idx = np.clip(np.arange(len(out), dtype=np.float32) + warp * sr * 0.001, 0, len(out) - 1)
        out = np.interp(idx, np.arange(len(out), dtype=np.float32), out).astype(np.float32)
    return out.astype(np.float32)


def breath(sr: int, ms: int = 170, level: float = 0.02, seed: int = 3):
    """A short inhale: low-passed noise under a soft envelope."""
    np = _np()
    if np is None or ms <= 0:
        return None
    n = int(sr * ms / 1000.0)
    if n < 32:
        return None
    rng = np.random.default_rng(seed)
    noise = rng.normal(0.0, 1.0, n).astype(np.float32)
    # One-pole low pass: breath is dark, not hiss. Vectorised so it stays cheap.
    alpha = 0.92
    k = np.arange(n, dtype=np.float32)
    decay = alpha ** k
    filtered = np.convolve(noise, 0.08 * decay[:min(n, 256)])[:n].astype(np.float32)
    # clip first: tiny negative values from float error make ** 1.6 produce NaN
    env = np.clip(np.sin(np.linspace(0.0, math.pi, n, dtype=np.float32)), 0.0, None) ** 1.6
    peak = float(np.max(np.abs(filtered))) or 1.0
    return (filtered / peak * env * level).astype(np.float32)


def emphasize(x, sr: int, positions: Sequence[float], amount: float = 0.28):
    """Lift specific moments in the audio.

    These engines give us no word timings, so positions are relative (0..1)
    estimates of where stressed words fall. English stress is carried mostly by
    loudness and duration, so a local gain bump reads as emphasis even when the
    alignment is approximate.
    """
    np = _np()
    if np is None or not positions or len(x) < 512:
        return x
    env = np.ones(len(x), dtype=np.float32)
    width = max(int(sr * 0.10), 64)
    for p in positions:
        centre = int(max(0.0, min(1.0, float(p))) * (len(x) - 1))
        a = max(0, centre - width // 2)
        b = min(len(x), centre + width // 2)
        if b - a < 16:
            continue
        env[a:b] += np.sin(np.linspace(0.0, math.pi, b - a, dtype=np.float32)) * amount
    return (x * env).astype(np.float32)


def normalize(x, target_rms: float = 0.125, ceiling: float = 0.97):
    """Even out loudness so no mode is jarringly louder than another."""
    np = _np()
    if np is None or len(x) == 0:
        return x
    rms = float(np.sqrt(np.mean(np.square(x))))
    if rms < 1e-5:
        return x
    out = x * min(8.0, target_rms / rms)
    peak = float(np.max(np.abs(out)))
    if peak > ceiling:
        out = out * (ceiling / peak)
    return out.astype(np.float32)


# --------------------------------------------------------------------------
# the sentence-level renderer
# --------------------------------------------------------------------------
# Terminal contour depth in semitones at full strength.
_RISE_ST = 2.6
_FALL_ST = -2.0
_LEVEL_ST = -0.3
# Declination: pitch drifts down across an utterance in every human language.
_DECLINATION_ST = -1.1

# v0.0.35 - "patient" belongs here and was missed when it was added in 0.0.32.
# It is defined with rate 0.92 and a lowered pitch, i.e. deliberately slow and
# settled ("take your time, no rush at all"), but without membership here it
# never got the heavier, more grounded delivery the other slow emotions get, so
# it was PLANNED as patient and then RENDERED as if it were neutral.
_HEAVY = ("apologetic", "empathetic", "concerned", "serious", "thinking", "patient")


# --- RHYTHM INSIDE THE SENTENCE (v0.0.47) ---------------------------------
# The planner has always computed `clause_gaps` - micro-pauses at commas - for
# every single beat, and NOTHING ever rendered them. Timing is the strongest
# human cue after pitch, so this was a large part of why the voice still read as
# robotic even after the pitch work.
#
# It was tried once before, in v0.0.35, and removed for a good reason: the engines
# appended silence_wav(gap) AFTER the finished sentence, on top of pause_after_ms.
# That is not a breath inside a clause, it is just drag on every sentence, and it
# doubled a pause the neural model already produces at a comma by itself. Two
# suites still assert the engines never do that, and those assertions are right.
#
# So the gap belongs HERE, in the waveform, at the comma - not on the tail.
_CLAUSE_MARKS = re.compile(r"[,;:\u2014]")


def _clause_spots(text: str) -> List[float]:
    """Fractional positions of the clause breaks in a sentence."""
    t = text or ""
    if len(t) < 8:
        return []
    spots: List[float] = []
    for m in _CLAUSE_MARKS.finditer(t):
        f = (m.start() + 1) / float(len(t))
        # A pause at the very start or end of a sentence is a stutter, not a
        # breath, so the outer edges are excluded.
        if 0.08 < f < 0.92:
            spots.append(f)
    return spots[:6]


def _quietest(x, np, center: int, radius: int) -> int:
    """The quietest sample near `center`.

    Splicing silence into the middle of a voiced vowel produces an audible click,
    which would sound worse than no pause at all. Character offsets only
    approximate where a word ends in TIME, so we search a small window for the
    quietest REGION (a smoothed minimum, not a single zero crossing) and cut
    there instead.
    """
    lo = max(1, center - radius)
    hi = min(int(len(x)) - 1, center + radius)
    if hi - lo < 16:
        return max(1, min(int(len(x)) - 1, center))
    seg = np.abs(x[lo:hi])
    w = max(8, (hi - lo) // 16)
    ker = np.ones(w, dtype=np.float32) / float(w)
    smooth = np.convolve(seg, ker, mode="same")
    return int(lo + int(np.argmin(smooth)))


def clause_pauses(x, sr: int, spots: Sequence[float], gaps_ms: Sequence[int]):
    """Insert short silences INSIDE one sentence, at its clause breaks."""
    np = _np()
    if np is None:
        return x
    fracs = [float(s) for s in (spots or [])]
    gaps = [int(g) for g in (gaps_ms or [])]
    if not fracs or not gaps:
        return x
    n = int(len(x))
    # Too short to have a clause worth breaking.
    if n < int(sr * 0.25):
        return x
    radius = max(1, int(sr * 0.025))
    cuts = []
    for i, frac in enumerate(fracs[:6]):
        ms = gaps[i] if i < len(gaps) else gaps[-1]
        if ms <= 0:
            continue
        # Clamped: a comma is not a full stop, and a long gap here would read as
        # the sentence having ended.
        ms = max(20, min(320, int(ms)))
        idx = _quietest(x, np, int(frac * n), radius)
        # Two commas landing on the same spot would stack into one long gap.
        if any(abs(idx - c[0]) < int(sr * 0.06) for c in cuts):
            continue
        cuts.append((idx, ms))
    if not cuts:
        return x
    cuts.sort()

    # MEASURED: butt-splicing silence into voiced audio left a sample step of
    # 0.188 where the signal's own 99th-percentile motion was 0.021 - a ~9x
    # discontinuity, which is an audible CLICK. A click at every comma would be
    # worse than having no pause at all, so each edge is ramped to zero first.
    fade = max(16, int(sr * 0.006))
    starts = [0] + [c[0] for c in cuts]
    ends = [c[0] for c in cuts] + [n]
    pieces = []
    try:
        for i, (a, b) in enumerate(zip(starts, ends)):
            if b <= a:
                continue
            seg = np.array(x[a:b], dtype=np.float32)
            f = int(min(fade, len(seg) // 2))
            if f > 4:
                if i > 0:  # this piece follows an inserted silence
                    seg[:f] = seg[:f] * np.linspace(0.0, 1.0, f, dtype=np.float32)
                if i < len(cuts):  # this piece precedes one
                    seg[-f:] = seg[-f:] * np.linspace(1.0, 0.0, f, dtype=np.float32)
            pieces.append(seg)
            if i < len(cuts):
                k = int(sr * cuts[i][1] / 1000.0)
                if k > 0:
                    pieces.append(np.zeros(k, dtype=np.float32))
        if not pieces:
            return x
        return np.concatenate(pieces)
    except Exception:
        return x


def _derive_gaps(text: str, emotion_name: str) -> List[int]:
    """Ask the planner what this sentence's clause pauses should be.

    Deriving them here is what lets Piper and Kokoro gain real rhythm without a
    single change to their source - which matters, because two suites assert
    those files never touch clause gaps, and they earned those assertions.
    """
    try:
        from . import emotion as _emo
        emo = _emo.EMOTIONS.get(emotion_name) or _emo.NEUTRAL
        return list(_emo.clause_gaps_for(text or "", emo))
    except Exception:
        return []


def render(
    wav_bytes: bytes,
    *,
    contour: str = "fall",
    emphasis: Sequence[str] = (),
    text: str = "",
    pitch_st: float = 0.0,
    emotion: str = "neutral",
    intensity: float = 1.0,
    seed: int = 0,
    clause_gaps: Optional[Sequence[int]] = None,
) -> bytes:
    """Apply the full prosody chain to one synthesised sentence."""
    if not enabled():
        return wav_bytes
    np = _np()
    if np is None:
        return wav_bytes
    got = read_wav(wav_bytes)
    if got is None:
        return wav_bytes
    x, sr, _ch = got
    if len(x) < 512:
        return wav_bytes

    k = max(0.0, min(1.5, float(intensity))) * strength()
    if k <= 0.01:
        return wav_bytes

    try:
        # 1. Baseline emotional pitch offset for the whole sentence.
        base = float(pitch_st) * k

        # 2. Declination + terminal contour as one continuous glide. This is
        #    the change that actually makes sentences stop sounding identical.
        if contour == "rise":
            start, end = base + 0.2 * k, base + _RISE_ST * k
        elif contour == "level":
            start, end = base, base + _LEVEL_ST * k
        else:
            start = base - _DECLINATION_ST * 0.35 * k
            end = base + (_DECLINATION_ST + _FALL_ST * 0.5) * k
        x = pitch_ramp(x, sr, start, end, segments=7)

        # 3. Word-level emphasis, positioned by character offset. Approximate,
        #    but stress is broad enough that being slightly early still reads.
        if emphasis and text:
            low = text.lower()
            spots: List[float] = []
            for w in emphasis:
                i = low.find(str(w).lower())
                if i >= 0 and len(low) > 1:
                    spots.append((i + len(str(w)) * 0.5) / len(low))
            if spots:
                x = emphasize(x, sr, spots, amount=0.30 * k)

        # 4. Micro-instability. Heavier emotions wobble a little more.
        heavy = emotion in _HEAVY
        x = jitter_shimmer(
            x, sr,
            jitter=0.0045 * k,
            shimmer=(0.045 if heavy else 0.032) * k,
            seed=int(seed) or (abs(hash(text)) % 100000),
        )

        # 5. RHYTHM: breathe inside the sentence, at its clause breaks.
        #    Scaled by k, so dialling expression down shortens the pauses
        #    instead of leaving them at full length under a quiet delivery.
        gaps = clause_gaps if clause_gaps is not None else _derive_gaps(text, emotion)
        if gaps:
            spots = _clause_spots(text)
            if spots:
                x = clause_pauses(x, sr, spots, [int(round(g * k)) for g in gaps])

        # 6. Consistent loudness across every engine and every emotion.
        return write_wav(normalize(x), sr)
    except Exception:
        # Prosody is a nicety; never let it cost the caller their audio.
        return wav_bytes


def prepend_breath(wav_bytes: bytes, ms: int = 170, level: float = 0.022) -> bytes:
    """Put a soft inhale in front of a sentence."""
    if not enabled() or ms <= 0:
        return wav_bytes
    np = _np()
    if np is None:
        return wav_bytes
    got = read_wav(wav_bytes)
    if got is None:
        return wav_bytes
    x, sr, _ch = got
    b = breath(sr, ms=ms, level=level)
    if b is None:
        return wav_bytes
    try:
        return write_wav(np.concatenate([b, x]), sr)
    except Exception:
        return wav_bytes
