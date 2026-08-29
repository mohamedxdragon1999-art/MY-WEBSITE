"""Fully-free, CPU-only speech recognition - streaming first.

WHY THIS FILE EXISTS
--------------------
Up to v51 the "fast" recogniser was `stt.py`, which calls a CLOUD endpoint
(NVIDIA Parakeet NIM). It is genuinely fast, but it has three properties that
are fatal for the product this is supposed to be:

  1. It needs an API key. With no key, `/api/stt` falls through to
     faster-whisper - which `requirements.txt` ships COMMENTED OUT. So a
     default install has no server-side recogniser at all, and the realtime
     socket's `transcribe` callable returns nothing. The call connects, the
     transcript stays empty, and the agent never answers. That is the largest
     single cause of "the call feature is fully broken".
  2. It needs the internet, on every single turn. A call is the one place where
     a 200ms network hiccup is not a glitch, it is a silence.
  3. It is REQUEST/RESPONSE. Even at zero network cost, you cannot get a
     partial out of it without sending audio again, which is why v49-v51 had to
     re-upload a rolling window every 320ms.

THE ARCHITECTURAL POINT: STREAMING BEATS FAST
---------------------------------------------
The re-upload loop in `asr_stream.py` is a very good solution to the wrong
problem. It exists only because the recogniser is stateless. A STREAMING
recogniser keeps its own decoder state, so audio is fed in once, forward only,
and the transcript is available at any instant for free:

    stateless (v51)   cost per tick = O(window)   partial latency = round trip
    streaming (v52)   cost per tick = O(new 20ms) partial latency ~ 0

That is why this is not "a faster model". A streaming transducer running on a
CPU beats a cloud Parakeet call for CONVERSATION, despite Parakeet being the
faster model in a benchmark, because the benchmark measures throughput and a
call is bounded by latency.

THE LADDER (all free, all CPU, best first)
------------------------------------------
  1. sherpa-onnx streaming zipformer transducer  (Apache-2.0, k2-fsa)
       True frame-synchronous streaming with a built-in neural endpointer.
       ~0.05-0.1x real time on one CPU core, so a 4-core box serves many
       concurrent callers. This is the best fully-free CPU option that exists:
       it is the only one in this list that is streaming, permissively
       licensed, and CPU-native at the same time.
  2. sherpa-onnx offline (non-streaming) model    (Apache-2.0)
       Same runtime, batch decode. Used when only an offline model is present.
  3. faster-whisper, int8 quantised               (MIT wrapper / MIT weights)
       Highest accuracy of the four, but non-streaming and ~20-30x slower than
       (1) per turn on CPU. Good fallback, poor primary.
  4. vosk                                        (Apache-2.0)
       Streaming, tiny (~50 MB), lower accuracy. The "it must work on a
       potato" tier.

Every tier is optional. Nothing here can raise at import time, and the whole
module degrades to `available() == False`, at which point the caller falls back
to the cloud recogniser and then to the browser - exactly as before. Adding a
local brain must never be able to remove a working remote one.

STDLIB ONLY at import time. Heavy imports happen inside the builders.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from audio_frames import SAMPLE_RATE

log = logging.getLogger("voice.asr.local")

MODELS_DIR = Path(os.environ.get("VOICE_ASR_MODEL_DIR")
                  or (Path(__file__).parent / "models" / "asr"))


def _env_flag(name: str, default: bool) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw not in ("0", "false", "no", "off")


def _threads() -> int:
    """CPU threads for inference.

    Deliberately NOT every core. ONNX Runtime will happily take all of them,
    and when it does, one recognition starves the asyncio event loop that is
    feeding audio to every OTHER caller. Leaving a core free is the difference
    between "slower under load" and "falls over under load".
    """
    raw = (os.environ.get("VOICE_ASR_THREADS") or "").strip()
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return max(1, (os.cpu_count() or 2) - 1)


def _find(*names: str) -> Optional[Path]:
    """Locate a model directory by any of several conventional names."""
    if not MODELS_DIR.is_dir():
        return None
    for n in names:
        p = MODELS_DIR / n
        if p.is_dir():
            return p
    # Fall back to a prefix match so an unpacked upstream tarball with a version
    # suffix in its folder name is still found without the user renaming it.
    for child in sorted(MODELS_DIR.iterdir()):
        if not child.is_dir():
            continue
        for n in names:
            if child.name.startswith(n):
                return child
    return None


def _one(d: Path, *patterns: str) -> Optional[str]:
    for pat in patterns:
        hits = sorted(d.glob(pat))
        if hits:
            return str(hits[0])
    return None


# ---------------------------------------------------------------------------
# Tier 1 + 2: sherpa-onnx
# ---------------------------------------------------------------------------

class _SherpaStreaming:
    """One streaming decoder instance. Wraps sherpa-onnx OnlineRecognizer.

    Thread-safety: sherpa streams are not safe for concurrent use, and one
    instance belongs to exactly one call, so a plain lock is sufficient and
    contention is zero in practice.
    """

    kind = "sherpa-streaming"

    def __init__(self, recognizer) -> None:
        self._rec = recognizer
        self._stream = recognizer.create_stream()
        self._lock = threading.Lock()
        self._committed = ""
        self._segment = 0

    def accept(self, pcm: bytes) -> None:
        """Feed raw int16 mono PCM at SAMPLE_RATE. Forward only, never replayed."""
        if not pcm:
            return
        import numpy as np

        samples = np.frombuffer(pcm, dtype="<i2").astype("float32") / 32768.0
        if not samples.size:
            return
        with self._lock:
            self._stream.accept_waveform(SAMPLE_RATE, samples)
            while self._rec.is_ready(self._stream):
                self._rec.decode_stream(self._stream)

    def result(self) -> Tuple[str, str]:
        """(committed, tail).

        sherpa's own endpointer segments the audio for us. Text from a CLOSED
        segment can never be revised, so it is genuinely committed - which is
        strictly better evidence than the LocalAgreement heuristic in
        `asr_stream.py`, because that heuristic is inferring stability from
        repeated guesses whereas this is the decoder telling us directly.
        """
        with self._lock:
            tail = (self._rec.get_result(self._stream) or "").strip()
            if self._rec.is_endpoint(self._stream):
                if tail:
                    self._committed = (self._committed + " " + tail).strip()
                self._rec.reset(self._stream)
                self._segment += 1
                tail = ""
            return self._committed, tail

    def finalize(self) -> str:
        """Flush the decoder and return the whole utterance."""
        with self._lock:
            import numpy as np

            # Tail padding. A transducer needs a little right context to emit
            # its final tokens; without it the last word of every turn is
            # routinely dropped. 0.35s of silence is the cheapest possible fix
            # and it is why "it loses the last word" does not happen here.
            self._stream.accept_waveform(
                SAMPLE_RATE, np.zeros(int(SAMPLE_RATE * 0.35), dtype="float32"))
            self._stream.input_finished()
            while self._rec.is_ready(self._stream):
                self._rec.decode_stream(self._stream)
            tail = (self._rec.get_result(self._stream) or "").strip()
            text = (self._committed + " " + tail).strip()
            return text

    def reset(self) -> None:
        with self._lock:
            self._committed = ""
            self._stream = self._rec.create_stream()


class _SherpaFactory:
    """Loads the model ONCE and hands out cheap per-call streams.

    Loading is the expensive part (hundreds of ms and tens of MB). Doing it per
    call would make the first turn of every call slow and would multiply memory
    by the number of concurrent callers, which is how a voice server runs out of
    RAM at exactly the moment it gets popular.
    """

    def __init__(self) -> None:
        self._rec = None
        self._tried = False
        self._name = ""
        self._lock = threading.Lock()

    @property
    def name(self) -> str:
        return self._name

    def _load(self):
        import sherpa_onnx

        d = _find("streaming-zipformer", "sherpa-streaming",
                  "icefall-asr-streaming", "sherpa-onnx-streaming")
        if d is None:
            return None

        tokens = _one(d, "tokens.txt")
        encoder = _one(d, "encoder*.int8.onnx", "encoder*.onnx")
        decoder = _one(d, "decoder*.int8.onnx", "decoder*.onnx")
        joiner = _one(d, "joiner*.int8.onnx", "joiner*.onnx")
        if not (tokens and encoder and decoder and joiner):
            log.warning("sherpa streaming dir %s is missing model files", d)
            return None

        rec = sherpa_onnx.OnlineRecognizer.from_transducer(
            tokens=tokens,
            encoder=encoder,
            decoder=decoder,
            joiner=joiner,
            num_threads=_threads(),
            sample_rate=SAMPLE_RATE,
            feature_dim=80,
            decoding_method=os.environ.get("VOICE_ASR_DECODING") or "greedy_search",
            provider="cpu",
            # The neural endpointer. These three rules are OR-ed by sherpa:
            #   rule1: trailing silence with NO text yet -> caller never spoke
            #   rule2: trailing silence AFTER text       -> the real end of turn
            #   rule3: hard ceiling on one utterance
            # rule2 is deliberately SHORT (0.6s). It does not decide the turn on
            # its own - `endpointing.TurnDetector` fuses it with lexical and
            # prosodic evidence - so being eager here buys latency without
            # buying interruptions.
            enable_endpoint_detection=True,
            rule1_min_trailing_silence=2.4,
            rule2_min_trailing_silence=0.6,
            rule3_min_utterance_length=25.0,
            hotwords_file=os.environ.get("VOICE_ASR_HOTWORDS_FILE") or "",
            hotwords_score=1.5,
        )
        self._name = "sherpa-streaming:" + d.name
        log.info("local streaming ASR ready: %s (%d threads)", self._name, _threads())
        return rec

    def ready(self) -> bool:
        with self._lock:
            if self._tried:
                return self._rec is not None
            self._tried = True
            try:
                self._rec = self._load()
            except Exception as exc:                       # noqa: BLE001
                # Never fatal. A missing model or an ABI mismatch must degrade
                # to the cloud/browser path, not take the website down.
                log.info("local streaming ASR unavailable: %s: %s",
                         type(exc).__name__, exc)
                self._rec = None
            return self._rec is not None

    def make(self) -> Optional[_SherpaStreaming]:
        if not self.ready():
            return None
        try:
            return _SherpaStreaming(self._rec)
        except Exception as exc:                           # noqa: BLE001
            log.warning("could not create ASR stream: %s", exc)
            return None


STREAMING = _SherpaFactory()


# ---------------------------------------------------------------------------
# Tier 3 + 4: batch recognisers, for the HTTP /api/stt route and as a fallback
# ---------------------------------------------------------------------------

class _BatchLadder:
    """Offline WAV -> text, trying each free CPU engine once.

    Only ONE engine is ever selected, on first use, and then reused. Retrying a
    failed engine on every request is how a broken optional dependency turns
    into a per-turn timeout.
    """

    def __init__(self) -> None:
        self._fn = None
        self._name = ""
        self._tried = False
        self._lock = threading.Lock()

    # -- individual engines ------------------------------------------------
    def _try_sherpa_offline(self):
        import sherpa_onnx

        d = _find("offline-zipformer", "sherpa-offline", "sherpa-onnx-offline",
                  "nemo-parakeet", "parakeet")
        if d is None:
            return None
        tokens = _one(d, "tokens.txt")
        if not tokens:
            return None

        enc = _one(d, "encoder*.int8.onnx", "encoder*.onnx")
        dec = _one(d, "decoder*.int8.onnx", "decoder*.onnx")
        joi = _one(d, "joiner*.int8.onnx", "joiner*.onnx")
        if enc and dec and joi:
            rec = sherpa_onnx.OfflineRecognizer.from_transducer(
                tokens=tokens, encoder=enc, decoder=dec, joiner=joi,
                num_threads=_threads(), sample_rate=SAMPLE_RATE,
                feature_dim=80, provider="cpu")
        else:
            model = _one(d, "model*.int8.onnx", "model*.onnx")
            if not model:
                return None
            rec = sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
                tokens=tokens, model=model, num_threads=_threads(),
                sample_rate=SAMPLE_RATE, feature_dim=80, provider="cpu")

        def run(wav: bytes) -> str:
            import numpy as np

            samples, rate = _wav_to_float(wav)
            st = rec.create_stream()
            st.accept_waveform(rate, samples)
            rec.decode_stream(st)
            return (st.result.text or "").strip()

        return run, "sherpa-offline:" + d.name

    def _try_faster_whisper(self):
        from faster_whisper import WhisperModel

        size = (os.environ.get("WHISPER_MODEL") or "base.en").strip()
        # int8 on CPU is not a quality compromise worth worrying about here -
        # it is ~4x faster and the WER difference on conversational English is
        # within noise. On a CPU-only box, float32 Whisper is simply too slow to
        # be inside a phone call at all.
        model = WhisperModel(size, device="cpu", compute_type="int8",
                             cpu_threads=_threads())

        def run(wav: bytes) -> str:
            import io

            segments, _info = model.transcribe(
                io.BytesIO(wav),
                language=None,
                beam_size=1,              # greedy: this is a latency budget
                vad_filter=True,
                condition_on_previous_text=False,
            )
            return " ".join(s.text for s in segments).strip()

        return run, "faster-whisper:" + size

    def _try_vosk(self):
        import json as _json

        from vosk import KaldiRecognizer, Model, SetLogLevel

        d = _find("vosk", "vosk-model")
        if d is None:
            return None
        SetLogLevel(-1)
        model = Model(str(d))

        def run(wav: bytes) -> str:
            pcm, rate = _wav_to_pcm(wav)
            rec = KaldiRecognizer(model, rate)
            rec.AcceptWaveform(pcm)
            return (_json.loads(rec.FinalResult()).get("text") or "").strip()

        return run, "vosk:" + d.name

    # -- selection ---------------------------------------------------------
    def _select(self):
        for builder in (self._try_sherpa_offline,
                        self._try_faster_whisper,
                        self._try_vosk):
            try:
                got = builder()
            except Exception as exc:                       # noqa: BLE001
                log.debug("batch ASR %s unavailable: %s",
                          builder.__name__, exc)
                continue
            if got:
                fn, name = got
                log.info("local batch ASR ready: %s", name)
                return fn, name
        return None, ""

    def ready(self) -> bool:
        with self._lock:
            if not self._tried:
                self._tried = True
                self._fn, self._name = self._select()
            return self._fn is not None

    @property
    def name(self) -> str:
        return self._name

    async def transcribe(self, wav: bytes) -> Dict[str, object]:
        if not wav or not self.ready():
            return {"text": "", "engine": ""}
        loop = asyncio.get_event_loop()
        try:
            # Inference is CPU-bound C code that releases the GIL, so a thread
            # is the right executor: it keeps the event loop free to keep
            # accepting audio frames from every other caller.
            text = await loop.run_in_executor(None, self._fn, wav)
        except Exception as exc:                            # noqa: BLE001
            log.warning("local batch ASR failed: %s: %s", type(exc).__name__, exc)
            return {"text": "", "engine": ""}
        return {"text": text or "", "engine": self._name}


BATCH = _BatchLadder()


# ---------------------------------------------------------------------------
# WAV helpers (stdlib)
# ---------------------------------------------------------------------------

def _wav_to_pcm(wav: bytes) -> Tuple[bytes, int]:
    """Decode a WAV container to 16-bit mono PCM.

    Implemented WITHOUT `audioop` on purpose. `audioop` was removed from the
    standard library in Python 3.13 (PEP 594). It is importable on some boxes
    only because the `audioop-lts` backport happens to be installed, so code
    that reaches for it works on the developer's machine and then raises
    ModuleNotFoundError on a clean 3.13 deployment - a failure that would land
    on the caller as silence, mid-call, with a stack trace nobody sees. numpy
    is already a hard requirement of this project, so using it here removes the
    dependency instead of merely guarding it.
    """
    import io
    import wave

    import numpy as np

    with wave.open(io.BytesIO(wav), "rb") as w:
        rate = w.getframerate()
        chans = w.getnchannels()
        width = w.getsampwidth()
        raw = w.readframes(w.getnframes())

    if width == 2:
        a = np.frombuffer(raw, dtype="<i2")
    elif width == 1:
        # WAV 8-bit is UNSIGNED. Reading it as signed shifts everything by a
        # half scale and yields loud noise rather than quiet speech.
        a = (np.frombuffer(raw, dtype=np.uint8).astype(np.int16) - 128) * 256
    elif width == 4:
        a = (np.frombuffer(raw, dtype="<i4") >> 16).astype(np.int16)
    elif width == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        a = (b[:, 1].astype(np.int16)
             | (b[:, 2].astype(np.int8).astype(np.int16) << 8))
    else:
        raise ValueError(f"unsupported WAV sample width: {width}")

    if chans > 1:
        usable = (a.size // chans) * chans
        a = a[:usable].reshape(-1, chans).mean(axis=1).astype(np.int16)

    return a.tobytes(), rate


def _wav_to_float(wav: bytes):
    import numpy as np

    pcm, rate = _wav_to_pcm(wav)
    return np.frombuffer(pcm, dtype="<i2").astype("float32") / 32768.0, rate


# ---------------------------------------------------------------------------
# Public surface
# ---------------------------------------------------------------------------

def streaming_enabled() -> bool:
    return _env_flag("VOICE_LOCAL_STREAMING_ASR", True)


def streaming_available() -> bool:
    return streaming_enabled() and STREAMING.ready()


def make_stream() -> Optional[_SherpaStreaming]:
    if not streaming_enabled():
        return None
    return STREAMING.make()


def batch_available() -> bool:
    return BATCH.ready()


async def transcribe(wav: bytes) -> Dict[str, object]:
    return await BATCH.transcribe(wav)


def status() -> Dict[str, object]:
    """What is actually loaded. Surfaced on /api/stt-status so a deployment can
    be diagnosed from the browser instead of by reading server logs."""
    return {
        "streaming": streaming_available(),
        "streaming_engine": STREAMING.name,
        "batch": batch_available(),
        "batch_engine": BATCH.name,
        "threads": _threads(),
        "model_dir": str(MODELS_DIR),
    }


__all__ = [
    "streaming_available", "streaming_enabled", "make_stream",
    "batch_available", "transcribe", "status", "MODELS_DIR",
]