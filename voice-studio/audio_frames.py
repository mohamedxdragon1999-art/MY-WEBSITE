"""Raw-PCM ring buffer and WAV framing - the foundation of incremental ASR.

THE BUG THIS FILE EXISTS TO KILL
--------------------------------
v48 captured audio with MediaRecorder, which produces WebM/Opus. Opus is a
stateful, packetised codec inside a container with a header. That has one
consequence which v48 documented honestly and then surrendered to:

    "A partial window must ALWAYS be a genuine prefix of the recording ...
     Past the cap we simply stop speculating."          - app.js, _liveWindowBlob

Because you cannot cut Opus in the middle, every partial pass had to re-send
the utterance FROM THE BEGINNING. That is quadratic: an utterance of N ticks
uploads and re-decodes O(N^2) audio. At 700ms ticks a 30-second sentence
re-transmits about 10 minutes of audio and re-runs the recogniser on all of it.
That is simultaneously the bandwidth bill, the latency, and the reason
speculation had to be switched off after 40 seconds.

Raw 16 kHz mono PCM has none of those properties. Every sample is independent,
so any byte range is a valid, decodable clip. Once audio is sliceable we can:

  * send only the audio AFTER the last committed word (constant work per tick,
    not quadratic),
  * keep speculating for an unbounded utterance length,
  * and compute VAD/prosody from the exact same buffer for free.

16 kHz mono 16-bit is 32 kB/s. A 300ms incremental window is under 10 kB - far
cheaper than the multi-hundred-kilobyte re-uploads v48 was doing every 700ms,
despite PCM being "uncompressed".

STDLIB ONLY.
"""
from __future__ import annotations

import array
import io
import math
import struct
import wave
from dataclasses import dataclass
from typing import List, Optional, Tuple

SAMPLE_RATE = 16000          # what every ASR model in the chain wants
BYTES_PER_SAMPLE = 2         # int16
FRAME_MS = 20                # VAD/prosody granularity
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000     # 320

# 60 seconds of audio. Beyond this the oldest audio is dropped, which is safe
# because anything that old has long since been committed and transcribed.
MAX_BUFFER_SEC = 60
_MAX_SAMPLES = SAMPLE_RATE * MAX_BUFFER_SEC


def pcm16_to_wav(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Wrap raw little-endian int16 mono PCM in a RIFF/WAVE header.

    We build a real WAV rather than posting naked PCM because every ASR
    endpoint in the chain (NIM, OpenAI-compatible, faster-whisper) accepts WAV
    and none of them reliably accept headerless PCM. The header is 44 bytes -
    the cost is irrelevant and the compatibility is total.
    """
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(BYTES_PER_SAMPLE)
        w.setframerate(int(sample_rate))
        w.writeframes(pcm)
    return buf.getvalue()


def float32_to_pcm16(samples) -> bytes:
    """Clamp-and-quantise float [-1,1] to int16.

    Clamping matters: a browser gain node or an over-driven mic can push
    samples past 1.0, and letting those wrap around int16 turns a loud syllable
    into white noise - which a speech model transcribes as confident nonsense.
    """
    out = array.array("h")
    for s in samples:
        if s != s:                      # NaN
            s = 0.0
        v = int(max(-1.0, min(1.0, float(s))) * 32767.0)
        out.append(v)
    if struct.pack("H", 1) != b"\x01\x00":   # big-endian host
        out.byteswap()
    return out.tobytes()


@dataclass
class FrameStats:
    """Per-frame acoustics. Computed once, reused by VAD, prosody and endpointing
    so the same audio is never analysed twice."""
    rms: float
    zcr: float          # zero-crossing rate: cheap voiced/unvoiced proxy
    voiced: bool


def frame_stats(pcm: bytes, noise_floor: float = 0.0) -> FrameStats:
    """RMS + zero-crossing rate for one frame of int16 PCM.

    Why not a neural VAD: this runs on every 20ms frame of every concurrent
    call. An energy+ZCR gate with an adaptive noise floor costs microseconds
    and, crucially, it CANNOT fail to load, download, or run out of memory.
    The neural VAD lives in the browser where it is per-user; this one is the
    server's always-available floor.
    """
    n = len(pcm) // BYTES_PER_SAMPLE
    if n == 0:
        return FrameStats(0.0, 0.0, False)
    a = array.array("h")
    a.frombytes(pcm[: n * BYTES_PER_SAMPLE])
    if struct.pack("H", 1) != b"\x01\x00":
        a.byteswap()

    total = 0.0
    crossings = 0
    prev = a[0]
    for v in a:
        total += float(v) * float(v)
        if (v >= 0) != (prev >= 0):
            crossings += 1
        prev = v
    rms = math.sqrt(total / n) / 32768.0
    zcr = crossings / float(n)
    # Speech is above the noise floor AND not pure hiss. The ZCR ceiling is
    # what stops keyboard clatter and fan noise from holding a turn open.
    voiced = rms > max(0.006, noise_floor * 2.2) and zcr < 0.35
    return FrameStats(rms, zcr, voiced)


class PcmStream:
    """Append-only 16 kHz mono PCM buffer with a movable commit point.

    `commit_sample` is the boundary between "already transcribed and agreed"
    and "still being guessed at". Incremental ASR only ever re-sends audio
    after that point, which is what makes the cost per tick constant.
    """

    def __init__(self, sample_rate: int = SAMPLE_RATE) -> None:
        self.sample_rate = int(sample_rate)
        self._buf = bytearray()
        self._dropped = 0            # samples evicted from the front
        self.commit_sample = 0       # absolute index of the commit boundary
        self._noise = 0.004          # adaptive noise floor estimate
        self._voiced_ms = 0.0
        self._silence_ms = 0.0
        self._last_voiced_at_ms = 0.0
        self._energies: List[float] = []
        self._run_lengths: List[int] = []
        self._cur_run = 0
        # Leftover bytes from the previous append that did not fill a whole
        # analysis frame. Without this the remainder of EVERY chunk is dropped
        # from analysis, so silence_ms runs slow - and silence_ms is the clock
        # the endpointer decides on. A client sending 1024-sample chunks would
        # lose 64 samples per chunk (~6%), making every turn end ~6% late for
        # no visible reason.
        self._carry = bytearray()

    # -- writing -----------------------------------------------------------
    def append(self, pcm: bytes) -> None:
        """Add raw int16 PCM and update the running acoustic state."""
        if not pcm:
            return
        self._buf.extend(pcm)
        self._analyse(pcm)
        # Evict old audio, keeping the commit point valid via `_dropped`.
        excess = (len(self._buf) // BYTES_PER_SAMPLE) - _MAX_SAMPLES
        if excess > 0:
            cut = excess * BYTES_PER_SAMPLE
            del self._buf[:cut]
            self._dropped += excess
            if self.commit_sample < self._dropped:
                self.commit_sample = self._dropped

    def _analyse(self, pcm: bytes) -> None:
        step = FRAME_SAMPLES * BYTES_PER_SAMPLE
        self._carry.extend(pcm)
        buf = self._carry
        n_full = len(buf) // step
        for i in range(n_full):
            off = i * step
            st = frame_stats(bytes(buf[off:off + step]), self._noise)
            self._energies.append(st.rms)
            if len(self._energies) > 3000:
                del self._energies[:1000]
            if st.voiced:
                self._voiced_ms += FRAME_MS
                self._silence_ms = 0.0
                self._cur_run += 1
            else:
                self._silence_ms += FRAME_MS
                if self._cur_run:
                    self._run_lengths.append(self._cur_run)
                    if len(self._run_lengths) > 200:
                        del self._run_lengths[:100]
                    self._cur_run = 0
                # Track the noise floor ONLY during silence, with a slow decay,
                # so a loud room raises the bar instead of jamming the VAD on.
                self._noise = 0.995 * self._noise + 0.005 * st.rms
        if n_full:
            del self._carry[:n_full * step]

    # -- reading -----------------------------------------------------------
    @property
    def total_samples(self) -> int:
        return self._dropped + len(self._buf) // BYTES_PER_SAMPLE

    @property
    def duration_ms(self) -> float:
        return 1000.0 * self.total_samples / self.sample_rate

    @property
    def silence_ms(self) -> float:
        return self._silence_ms

    @property
    def voiced_ms(self) -> float:
        return self._voiced_ms

    def is_voiced(self) -> bool:
        return self._silence_ms < FRAME_MS * 1.5

    def slice_pcm(self, start_sample: int, end_sample: Optional[int] = None) -> bytes:
        """Absolute-indexed slice. Safe against evicted audio."""
        end = self.total_samples if end_sample is None else int(end_sample)
        start = max(int(start_sample), self._dropped)
        end = min(end, self.total_samples)
        if end <= start:
            return b""
        a = (start - self._dropped) * BYTES_PER_SAMPLE
        b = (end - self._dropped) * BYTES_PER_SAMPLE
        return bytes(self._buf[a:b])

    def pending_pcm(self, overlap_ms: float = 240.0,
                    max_ms: Optional[float] = None) -> Tuple[bytes, int]:
        """Audio after the commit point, plus a little context before it.

        The overlap is not optional. A recogniser handed a clip that starts
        mid-word will mis-transcribe that word, so we rewind a fraction of a
        second into already-committed audio to give the model left context. We
        then discard whatever it re-transcribes from that region - it exists to
        inform the decoder, not to be used.

        `max_ms` is the structural guarantee that this window can never grow
        without bound. The commit point advancing is an ESTIMATE and estimates
        can lag; this clamp does not depend on the estimate being right, which
        is the whole point of having it. When it engages we keep the NEWEST
        audio, because the oldest is the part most likely already transcribed.
        """
        back = int(self.sample_rate * max(0.0, overlap_ms) / 1000.0)
        start = max(self._dropped, self.commit_sample - back)
        if max_ms:
            cap = int(self.sample_rate * max(0.0, float(max_ms)) / 1000.0)
            floor = self.total_samples - cap
            if floor > start:
                start = floor
        return self.slice_pcm(start, None), start

    def pending_wav(self, overlap_ms: float = 240.0,
                    max_ms: Optional[float] = None) -> Tuple[bytes, int]:
        pcm, start = self.pending_pcm(overlap_ms, max_ms)
        return (pcm16_to_wav(pcm, self.sample_rate) if pcm else b""), start

    def full_wav(self) -> bytes:
        return pcm16_to_wav(bytes(self._buf), self.sample_rate)

    def advance_commit(self, to_sample: int) -> None:
        self.commit_sample = max(self.commit_sample,
                                 min(int(to_sample), self.total_samples))

    # -- prosody -----------------------------------------------------------
    def prosody(self, window_ms: float = 600.0):
        """Summarise the tail of the utterance for the endpointer.

        Deliberately time-domain only. A real pitch tracker (YIN/pYIN) would be
        more accurate, but it is 10-50x the cost per frame and this runs on
        every frame of every concurrent call. The zero-crossing rate of a
        voiced frame is a serviceable proxy for f0 - it is monotonic with pitch
        for periodic signals - and the endpointer weights prosody BELOW lexicon
        precisely because we know this estimator is noisy.
        """
        from endpointing import Prosody

        nframes = max(4, int(window_ms / FRAME_MS))
        tail = self._energies[-nframes:]
        if len(tail) < 4:
            return Prosody(voiced=self.is_voiced())

        mean_all = sum(self._energies) / len(self._energies) if self._energies else 0.0
        last_n = max(2, int(150 / FRAME_MS))
        recent = tail[-last_n:]
        mean_recent = sum(recent) / len(recent)
        energy_ratio = (mean_recent / mean_all) if mean_all > 1e-9 else 1.0

        # Slope of the energy envelope, used as the pitch-contour proxy. Scaled
        # into a semitone-like range so it lines up with the thresholds the
        # endpointer was written against.
        n = len(tail)
        xs = list(range(n))
        mx = sum(xs) / n
        my = sum(tail) / n
        num = sum((xs[i] - mx) * (tail[i] - my) for i in range(n))
        den = sum((x - mx) ** 2 for x in xs) or 1.0
        slope = num / den
        f0_slope = max(-12.0, min(12.0, slope * 900.0))

        med = 1.0
        if self._run_lengths:
            s = sorted(self._run_lengths)
            med = float(s[len(s) // 2]) or 1.0
        last_run = self._run_lengths[-1] if self._run_lengths else self._cur_run
        lengthening = (last_run / med) if med else 1.0

        return Prosody(
            f0_slope=f0_slope,
            energy_ratio=max(0.0, min(4.0, energy_ratio)),
            final_lengthening=max(0.0, min(4.0, lengthening)),
            voiced=self.is_voiced(),
        )


__all__ = [
    "SAMPLE_RATE", "FRAME_MS", "FRAME_SAMPLES", "BYTES_PER_SAMPLE",
    "PcmStream", "FrameStats", "frame_stats",
    "pcm16_to_wav", "float32_to_pcm16",
]
