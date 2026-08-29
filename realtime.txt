"""Full-duplex realtime voice session over one WebSocket.

WHY A SOCKET AND NOT MORE HTTP
------------------------------
v48 ran the whole conversation over discrete HTTP requests: POST /api/stt for
every 700ms partial, POST /api/reply, POST /api/tts per sentence. Each one pays
connection setup and a fresh server task, and - critically - each one is a
REQUEST/RESPONSE, so nothing reaches the caller until the whole stage finishes.
That shape has a floor you cannot optimise past:

    time-to-first-audio  >=  upload + full ASR + full LLM + full TTS

A socket lets the four stages OVERLAP, which is where the order of magnitude
lives:

    audio streams up WHILE it is being spoken
      -> ASR commits words WHILE the caller is still talking
        -> the LLM starts generating on committed words BEFORE the turn ends
          -> TTS starts on the first clause BEFORE the LLM has finished
            -> audio streams down WHILE it is still being synthesised

The caller hears the first syllable while the model is still writing sentence
two. That is how the sub-500ms stacks do it; it is not a faster model, it is
this pipeline shape.

It also gives us what HTTP fundamentally cannot: a way for the SERVER to
interrupt itself. Barge-in over HTTP means the client abandons a response it is
already downloading - the tokens were still generated and paid for. Over a
socket we stop generating, stop synthesising and stop spending the moment the
caller speaks.

PROTOCOL
--------
Client -> server:
  binary frame           raw int16 mono 16 kHz PCM (the microphone)
  {"t":"start", ...}     begin a session (voice/mode/history/sensitivity)
  {"t":"prosody", ...}   browser-side pitch/energy, fused with the server's
  {"t":"text", ...}      typed message (skips ASR entirely)
  {"t":"barge"}          client-side VAD detected the caller talking over us
  {"t":"stop"}           end the session

Server -> client:
  {"t":"partial", ...}   live words, split into committed vs provisional
  {"t":"eot", ...}       we believe the turn ended, with the probability and why
  {"t":"final", ...}     authoritative transcript
  {"t":"token", ...}     reply text as it is generated
  {"t":"speak", ...}     an audio chunk follows as the next binary frame
  binary frame           the audio for the preceding "speak"
  {"t":"interrupt"}      stop playback, the caller is talking
  {"t":"done", ...}      turn complete, with the latency breakdown
  {"t":"error", ...}

Everything external is dependency-injected, so a whole conversation can be unit
tested with fake ASR/brain/TTS and no network.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Dict, List, Optional, Tuple

import asr_local
import endpointing
from asr_stream import IncrementalTranscriber, Partial, words_of
from intake import Intake
from audio_frames import SAMPLE_RATE, PcmStream
from endpointing import TurnDetector
from pacing import Pacer

# How often the endpointer re-evaluates. 40ms is two audio frames: fast enough
# that our decision latency is invisible next to the ~120ms floor, cheap enough
# that a hundred concurrent sessions costs nothing.
TICK_MS = 40

# How often we ask the recogniser for a partial. This is no longer a latency
# knob - committed words are what the brain speculates on and the final flush is
# what we answer with - so it is purely a cost/stability knob now.
ASR_TICK_MS = 320

# A caller must be voiced for this long before it counts as barge-in. Without
# it, a cough or a door closing stops the agent mid-sentence.
BARGE_MS = 220.0

# Recognition cadence when a LOCAL STREAMING recogniser is in use. The 320ms
# figure above exists because a stateless recogniser has to be re-sent a rolling
# window, so each pass costs O(window) plus a network round trip - polling it
# faster just burns money. A streaming decoder has already consumed the audio by
# the time we ask, so `result()` is a state read costing microseconds. Polling it
# at 80ms is essentially free and it is what turns "the words appear in chunks a
# third of a second behind me" into "the words appear as I say them".
LOCAL_ASR_TICK_MS = 80

# Minimum words before preemptive generation is worth starting.
PREEMPT_MIN_WORDS = 2

# How long the brain may take before we cover the silence with a thinking sound.
FILLER_AFTER_MS = 700.0


# ---------------------------------------------------------------------------
# Sentence chunking for streaming TTS
# ---------------------------------------------------------------------------

_CLAUSE_END = re.compile(r"([.!?]+[\"')\]]*(?:\s|$))|([,;:](?:\s|$))")
_SENT_END = re.compile(r"([.!?]+[\"')\]]*)(\s|$)")

# The first chunk may be much shorter than the rest. Time-to-first-audio is the
# number the caller actually feels and it is bounded by how long the first chunk
# takes to synthesise, so we cut the first one at the earliest natural boundary
# and let later chunks be long - long chunks sound BETTER, because the vocoder
# gets more context to shape prosody across.
FIRST_CHUNK_MIN_CHARS = 12
FIRST_CHUNK_MAX_CHARS = 90
CHUNK_MIN_CHARS = 60
CHUNK_MAX_CHARS = 240

# How many chunks may be synthesising AHEAD of the one being sent.
#
# THE LATENCY BUG THIS FIXES. `_answer` used to `await speak(chunk)` for every
# chunk, which serialised the whole reply: chunk N+1's synthesis did not even
# BEGIN until chunk N had been synthesised and sent. On CPU TTS a chunk takes
# roughly 0.2-0.5x its own duration to synthesise, so every gap between clauses
# was real dead air the caller could hear, and the total reply took the SUM of
# all synthesis times instead of overlapping them with playback.
#
# With a prefetch window, chunk N+1 synthesises while the client is still
# playing chunk N, so after the first chunk the audio should arrive faster than
# it can be consumed and playback becomes continuous.
#
# Why 2 and not more: each in-flight chunk costs a CPU worker, and on a busy box
# a deep window would steal cores from the FIRST chunk of other calls - which is
# the only latency a caller actually feels. 2 is enough to keep the pipe full
# because playback of a chunk always takes longer than synthesis of the next.
SYNTH_PREFETCH = max(1, int(os.environ.get("VOICE_SYNTH_PREFETCH", "2") or 2))


class SentenceChunker:
    """Accumulates LLM tokens and emits speakable chunks as early as is safe.

    "As early as is safe" is the entire design problem. Cut too early and the
    voice performs a fragment with the wrong intonation - "I can" spoken as a
    complete sentence sounds nothing like "I can help with that". Cut too late
    and the streaming advantage is gone. So the FIRST chunk cuts at the earliest
    clause boundary (a comma will do) because the caller is sitting in silence
    and speed dominates; every chunk after that waits for a real sentence
    boundary, because audio is already playing by then and quality dominates.
    """

    def __init__(self,
                 first_min: int = FIRST_CHUNK_MIN_CHARS,
                 first_max: int = FIRST_CHUNK_MAX_CHARS,
                 min_chars: int = CHUNK_MIN_CHARS,
                 max_chars: int = CHUNK_MAX_CHARS) -> None:
        self.first_min = int(first_min)
        self.first_max = int(first_max)
        self.min_chars = int(min_chars)
        self.max_chars = int(max_chars)
        self._buf = ""
        self._emitted = 0

    def push(self, token: str) -> List[str]:
        """Add generated text; return zero or more chunks ready to speak."""
        if not token:
            return []
        self._buf += token
        out: List[str] = []
        while True:
            chunk = self._take()
            if not chunk:
                break
            out.append(chunk)
        return out

    def _take(self) -> str:
        buf = self._buf
        if not buf.strip():
            return ""
        first = self._emitted == 0
        lo = self.first_min if first else self.min_chars
        hi = self.first_max if first else self.max_chars

        if len(buf.strip()) < lo:
            return ""

        # A sentence boundary is always acceptable; a clause boundary only for
        # the first chunk.
        pattern = _CLAUSE_END if first else _SENT_END
        cut = -1
        for m in pattern.finditer(buf):
            if m.end() >= lo:
                cut = m.end()
                break
        if cut < 0 or cut > hi:
            # No boundary in range. Force a cut only past the hard ceiling, and
            # do it at a word gap so a word is never split in half.
            if len(buf) <= hi:
                return ""
            sp = buf.rfind(" ", lo, hi)
            cut = sp if sp > lo else hi

        chunk = buf[:cut].strip()
        if not chunk:
            return ""
        self._buf = buf[cut:]
        self._emitted += 1
        return chunk

    def drain(self) -> str:
        """Whatever is left when generation finishes."""
        rest = self._buf.strip()
        self._buf = ""
        if rest:
            self._emitted += 1
        return rest


# ---------------------------------------------------------------------------
# Local streaming recogniser adapter
# ---------------------------------------------------------------------------


class _LocalStreamAdapter:
    """Makes a streaming recogniser look exactly like IncrementalTranscriber.

    WHY AN ADAPTER instead of branching inside the session: `RealtimeSession`
    touches the recogniser in eight places (tick, asr_tick, commit_turn,
    reset...). Adding `if self.streaming:` to each one would double the number of
    states the session can be in, and the interesting bugs in this file have all
    been state bugs. Conforming to the existing interface instead means the
    session keeps exactly one code path and the streaming engine is swappable.

    The behavioural difference is where COMMITMENT comes from:
      IncrementalTranscriber  infers stability by re-transcribing and comparing
                              (LocalAgreement) - a heuristic over guesses.
      this adapter            asks the decoder, which segments on its own neural
                              endpointer - ground truth from the model.
    So this is both cheaper AND more accurate, which is unusual and is the whole
    reason streaming is the right call.
    """

    def __init__(self, stream: PcmStream, recognizer: Any) -> None:
        self.stream = stream
        self._rec = recognizer
        self.committed = ""
        self.tail = ""
        self.engine = getattr(recognizer, "kind", "local-streaming")
        self.passes = 0
        self.wasted_passes = 0
        self.forced_commits = 0
        self._last_text = ""

    def accept(self, pcm: bytes) -> None:
        """Feed audio forward-only, as it arrives."""
        self._rec.accept(pcm)

    async def tick(self) -> Optional[Partial]:
        self.passes += 1
        loop = asyncio.get_event_loop()
        # Decoding happens in accept(); this is a cheap state read. It still goes
        # to a thread because sherpa's endpoint check can trigger a final decode,
        # and blocking the event loop stalls audio intake for every other caller.
        try:
            committed, tail = await loop.run_in_executor(None, self._rec.result)
        except Exception:
            # A decoder fault must never end a live call. None just means "no new
            # words this tick": the next tick retries, and if the decoder is
            # truly dead the endpointer still closes the turn and the batch
            # fallback in server._transcribe answers the caller instead.
            self.wasted_passes += 1
            return None
        changed = committed != self.committed
        self.committed = committed
        self.tail = tail
        text = (committed + " " + tail).strip()
        if text == self._last_text and not changed:
            return None
        self._last_text = text
        return Partial(committed=committed, tail=tail, changed=changed,
                       engine=self.engine)

    async def flush(self) -> Partial:
        loop = asyncio.get_event_loop()
        try:
            text = await loop.run_in_executor(None, self._rec.finalize)
        except Exception:
            # commit_turn() awaits this on the critical path and does NOT catch,
            # so raising here would drop the caller's whole sentence. Degrade to
            # the words already decoded instead.
            self.forced_commits += 1
            text = (self.committed + " " + self.tail).strip()
        self.committed = text
        self.tail = ""
        return Partial(committed=text, tail="", changed=bool(text),
                       engine=self.engine)

    def reset(self) -> None:
        self.committed = ""
        self.tail = ""
        self._last_text = ""
        try:
            self._rec.reset()
        except Exception:
            pass
        # Keep the PcmStream commit pointer in step. The stream is still the
        # source of truth for silence/prosody even though it is no longer the
        # source of audio for recognition, and a stale pointer makes
        # `pending_pcm` grow without bound over a long call.
        self.stream.advance_commit(self.stream.total_samples)

    def stats(self) -> Dict:
        return {
            "passes": self.passes,
            "wasted": self.wasted_passes,
            "forced": self.forced_commits,
            "committed_words": len(words_of(self.committed)),
            "engine": self.engine,
        }


# ---------------------------------------------------------------------------
# Dependencies (injected, so a session is testable with no network)
# ---------------------------------------------------------------------------


@dataclass
class Deps:
    """Everything the session needs from the outside world.

    transcribe(wav_bytes)        -> {"text": str, "engine": str}
    stream_reply(text, history)  -> async iterator of token strings
    synth(text)                  -> {"audio": bytes, "mime": str}

    Each may be sync or async; the session awaits whatever is awaitable.
    """
    transcribe: Callable[..., Any]
    stream_reply: Callable[..., Any]
    synth: Callable[..., Any]
    # Optional factory returning a fresh streaming recogniser for this call.
    # When present the session streams instead of re-uploading windows. Optional
    # so that every existing test and every deployment without a local model
    # keeps working unchanged - adding local ears must never remove remote ones.
    streaming: Optional[Callable[[], Any]] = None


@dataclass
class TurnMetrics:
    """Per-turn latency breakdown, reported to the client so the numbers live in
    the product instead of being trapped in a server log."""
    t0: float = 0.0
    final_at: float = 0.0
    first_token_at: float = 0.0
    first_audio_at: float = 0.0
    done_at: float = 0.0

    def _ms(self, t: float) -> int:
        return int((t - self.t0) * 1000) if (t and self.t0) else 0

    def to_dict(self) -> Dict:
        return {
            "asr_ms": self._ms(self.final_at),
            "first_token_ms": self._ms(self.first_token_at),
            "first_audio_ms": self._ms(self.first_audio_at),
            "total_ms": self._ms(self.done_at),
        }


async def _maybe_await(value):
    if asyncio.iscoroutine(value) or isinstance(value, asyncio.Future):
        return await value
    return value


class RealtimeSession:
    """One caller. Owns the audio buffer, the endpointer and the reply pipeline."""

    def __init__(self,
                 send_json: Callable[[Dict], Any],
                 send_bytes: Callable[[bytes], Any],
                 deps: Deps,
                 *,
                 sensitivity: float = 1.0,
                 history: Optional[List[Dict]] = None,
                 preemptive: bool = True) -> None:
        self._send_json = send_json
        self._send_bytes = send_bytes
        self.deps = deps

        self.stream = PcmStream(SAMPLE_RATE)

        # Prefer a local streaming recogniser; fall back to the window-resend
        # transcriber. Both satisfy the same interface, so nothing below cares.
        self._local_stream = None
        maker = getattr(deps, "streaming", None)
        if maker is not None:
            try:
                rec = maker()
            except Exception:
                rec = None
            if rec is not None:
                self._local_stream = rec
        if self._local_stream is not None:
            self.asr: Any = _LocalStreamAdapter(self.stream, self._local_stream)
            self._asr_tick_ms = LOCAL_ASR_TICK_MS
        else:
            self.asr = IncrementalTranscriber(self.stream, self._transcribe)
            self._asr_tick_ms = ASR_TICK_MS

        self.detector = TurnDetector(sensitivity=sensitivity)
        # Human pacing. Seeded per session so two callers do not get identical
        # pause patterns, but a single session replays deterministically in tests.
        self.pacer = Pacer(seed=id(self) & 0xFFFF)
        self.history: List[Dict] = list(history or [])
        self.preemptive = bool(preemptive)

        # Caller details captured across the whole call. Lives on the session
        # because a caller gives their surname forty seconds after their first
        # name, and any per-turn scheme loses that.
        self.intake = Intake()

        self.closed = False
        self.speaking = False           # are we playing audio at the caller?
        self.turn_open = False
        self.turns = 0
        self.metrics = TurnMetrics()

        self._turn_started = 0.0
        self._client_prosody: Optional[endpointing.Prosody] = None
        self._voiced_run_ms = 0.0
        self._last_sent_partial = ""
        self._speak_task: Optional[asyncio.Task] = None
        self._answering = False
        self._last_answer_at = 0.0

        # Preemptive generation: start thinking on committed words before the
        # turn ends. Cancelled for free if the caller keeps talking.
        self._preempt: Optional[asyncio.Task] = None
        self._preempt_key = ""

    # -- plumbing ----------------------------------------------------------
    async def _emit(self, **payload) -> None:
        if self.closed:
            return
        try:
            await _maybe_await(self._send_json(payload))
        except Exception:
            self.closed = True

    async def _emit_audio(self, data: bytes) -> None:
        if self.closed or not data:
            return
        try:
            await _maybe_await(self._send_bytes(data))
        except Exception:
            self.closed = True

    async def _transcribe(self, wav: bytes) -> Dict[str, object]:
        got = await _maybe_await(self.deps.transcribe(wav))
        return got or {}

    # -- ingest ------------------------------------------------------------
    async def on_audio(self, pcm: bytes) -> None:
        """A frame of microphone PCM arrived."""
        if self.closed or not pcm:
            return
        self.stream.append(pcm)
        if self._local_stream is not None:
            # Forward-only feed. Note this happens even while WE are speaking:
            # the decoder needs a continuous signal, and any echo that leaks in
            # is discarded at the end of the turn by _discard_echo().
            try:
                self.asr.accept(pcm)
            except Exception:
                pass

        if self.stream.is_voiced():
            self._voiced_run_ms += 1000.0 * (len(pcm) // 2) / SAMPLE_RATE
            if not self.turn_open:
                self.turn_open = True
                self._turn_started = time.perf_counter()
                self.detector.begin_turn()
            # BARGE-IN. Sustained voice while we are talking means the caller
            # wants the floor. v48 could only do this client-side, so the server
            # kept generating and paying for a reply nobody would ever hear.
            if self.speaking and self._voiced_run_ms >= BARGE_MS:
                await self.interrupt("barge-in")
        else:
            self._voiced_run_ms = 0.0

    def on_prosody(self, payload: Dict) -> None:
        """Browser-measured pitch/energy. Optional: the server computes its own
        from the same PCM, but the browser sees the pre-resample signal and can
        run a real pitch tracker per user, which the server cannot afford to do
        for everyone at once."""
        try:
            self._client_prosody = endpointing.Prosody(
                f0_slope=float(payload.get("f0_slope", 0.0)),
                energy_ratio=float(payload.get("energy_ratio", 1.0)),
                final_lengthening=float(payload.get("final_lengthening", 1.0)),
                voiced=bool(payload.get("voiced", False)),
            )
        except (TypeError, ValueError):
            self._client_prosody = None

    def _prosody(self) -> endpointing.Prosody:
        """Best available prosody: the browser's if it sent any, else ours.

        We never average them. They are estimates of the same thing from
        different signals, and averaging two estimates of one quantity just
        blurs the better one.
        """
        if self._client_prosody is not None:
            return self._client_prosody
        return self.stream.prosody()

    # -- the endpointing loop ---------------------------------------------
    async def tick(self) -> Optional[endpointing.Decision]:
        """Re-evaluate whether the turn has ended. Called every TICK_MS."""
        if self.closed or self._answering or not self.turn_open:
            return None

        text = (self.asr.committed + " " + self.asr.tail).strip()
        if not text:
            return None

        elapsed = (time.perf_counter() - self._turn_started) * 1000.0
        d = self.detector.update(
            text=text,
            silence_ms=self.stream.silence_ms,
            prosody=self._prosody(),
            agent_speaking=self.speaking,
            elapsed_ms=elapsed,
        )

        # A backchannel while we are speaking is an acknowledgement, not a
        # turn. Drop the audio and keep going - answering "mhm" mid-sentence is
        # what makes an agent feel like it is not listening.
        if d.backchannel:
            self.asr.reset()
            self.turn_open = False
            return d

        if d.end_of_turn:
            await self._emit(t="eot", p=round(d.p_complete, 3), reason=d.reason)
            await self.commit_turn()
        return d

    async def asr_tick(self) -> None:
        """Run one incremental recognition pass and push partials to the client."""
        if self.closed or self._answering or not self.turn_open:
            return
        # Do not transcribe our own voice. Browser echo cancellation is good but
        # not perfect, and whatever leaks in comes back as words the caller
        # never said. Barge-in still works: on_audio watches energy directly and
        # does not depend on this path.
        if self.speaking:
            return
        part = await self.asr.tick()
        if part is None:
            return
        if part.text and part.text != self._last_sent_partial:
            self._last_sent_partial = part.text
            await self._emit(t="partial", committed=part.committed,
                             tail=part.tail, text=part.text)
        if part.changed and self.preemptive:
            self._begin_preempt(part.committed)

    # -- preemptive generation --------------------------------------------
    def _begin_preempt(self, text: str) -> None:
        """Start generating on committed words, before the turn is over.

        Only the BRAIN runs early. Nothing is ever SPOKEN until the turn is
        genuinely committed, so a wrong speculation is silent and invisible - it
        costs tokens, never a wrong word out loud.

        The cache key ignores hesitation noise, so "um, cancel it" and "cancel
        it" reuse one speculation instead of paying for two.
        """
        clean = endpointing.strip_fillers(text)
        key = " ".join(endpointing.tokenize(clean))
        if len(key.split()) < PREEMPT_MIN_WORDS:
            return
        if key == self._preempt_key:
            return
        self._cancel_preempt()
        self._preempt_key = key
        self._preempt = asyncio.ensure_future(self._collect_reply(text))

    def _cancel_preempt(self) -> None:
        if self._preempt and not self._preempt.done():
            self._preempt.cancel()
        self._preempt = None
        self._preempt_key = ""

    async def _collect_reply(self, text: str) -> List[str]:
        """Buffer a whole speculative reply. Never emitted directly."""
        out: List[str] = []
        try:
            it = self.deps.stream_reply(text, list(self.history))
            async for tok in it:
                if tok:
                    out.append(tok)
        except asyncio.CancelledError:
            raise
        except Exception:
            return out
        return out

    # -- committing a turn -------------------------------------------------
    async def commit_turn(self, text: Optional[str] = None) -> None:
        """The caller has finished. Produce and speak an answer."""
        if self.closed or self._answering:
            return
        self._answering = True
        self.turn_open = False
        self.metrics = TurnMetrics(t0=time.perf_counter())
        try:
            if text is None:
                final = await self.asr.flush()
                said = final.committed.strip()
            else:
                said = (text or "").strip()
            self.metrics.final_at = time.perf_counter()

            if not said:
                self.asr.reset()
                return

            await self._emit(t="final", text=said,
                             hesitation=round(endpointing.hesitation_ratio(said), 3))
            self.turns += 1
            self.history.append({"role": "user", "content": said})
            self.asr.reset()

            # Capture the facts the business needs from this utterance. Wrapped
            # because intake is a nicety and a live call is not: no regex in
            # here is allowed to be the reason a caller gets hung up on.
            try:
                got = self.intake.observe(said)
            except Exception:                              # noqa: BLE001
                got = []
            if got:
                await self._emit(
                    t="intake", changed=got,
                    fields={k: v.value for k, v in self.intake.slots.items()
                            if v.value},
                    missing=self.intake.missing(),
                    complete=self.intake.complete())

            # Reuse the speculation if it was about these same words.
            key = " ".join(endpointing.tokenize(endpointing.strip_fillers(said)))
            reuse = None
            if self._preempt and self._preempt_key == key:
                reuse = self._preempt
                self._preempt = None
                self._preempt_key = ""
            else:
                self._cancel_preempt()

            self._speak_task = asyncio.ensure_future(self._answer(said, reuse))
            # gather(return_exceptions=True), NOT a bare await.
            #
            # HIDDEN BUG THIS FIXES: a bare `await self._speak_task` re-raises
            # the child's CancelledError in THIS coroutine. commit_turn is
            # called from tick(), which is called from the endpointing loop -
            # so the very first barge-in would cancel the speak task, propagate
            # CancelledError up through tick(), and silently kill the loop that
            # detects the ends of turns. The call would stay connected and
            # never answer again. gather() surfaces the cancellation as a
            # RESULT instead of an exception, which is exactly what we want:
            # being interrupted is a normal outcome here, not a failure.
            await asyncio.gather(self._speak_task, return_exceptions=True)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._emit(t="error", message=str(exc)[:200])
        finally:
            self._answering = False
            self._last_answer_at = time.perf_counter()
            self._speak_task = None

    def _feel(self, text: str) -> Tuple[float, float]:
        """Read (arousal, valence) from text for the pacing model.

        WHY THIS EXISTS: pacing.plan() takes arousal/valence and scales its
        pauses by them - an excited speaker compresses gaps, bad news opens them
        up. Those inputs were being read with `getattr(self, "_arousal", 0.0)`
        and nothing ever SET them, so every multiplier silently evaluated at
        neutral and the emotional half of the pacing model was dead code. This is
        the missing producer.

        Never raises: sentiment is a nicety, and a lexicon miss must not be able
        to interrupt a live phone call.
        """
        if not text:
            return (0.0, 0.0)
        try:
            from engines import sentiment as _sent
            r = _sent.read(text)
            return (float(r.arousal), float(r.valence))
        except Exception:
            return (0.0, 0.0)

    async def _answer(self, said: str, reuse: Optional[asyncio.Task]) -> None:
        """Generate and speak, overlapping the two as much as possible."""
        chunker = SentenceChunker()
        spoken: List[str] = []
        seq = 0
        prev_chunk = ""
        self.speaking = True
        self.pacer.start_turn()

        # BUG FIX: clear the voiced run before we start talking.
        #
        # `_voiced_run_ms` accumulates in on_audio and is only zeroed on a
        # SILENT frame. The caller has just finished speaking, so at this instant
        # it holds their whole final run - typically far above BARGE_MS. The very
        # first audio frame that arrives after `self.speaking = True` then
        # satisfied `self.speaking and self._voiced_run_ms >= BARGE_MS` and
        # instantly barged the agent out of its own opening word. It presented as
        # the agent starting to answer and immediately falling silent, which is
        # indistinguishable from a crash from the caller's side.
        self._voiced_run_ms = 0.0

        # How the CALLER sounds is a property of the turn, so read it once here
        # rather than per chunk. An upset caller gets more room to breathe for
        # the whole reply, which is the single most human-sounding rule we have.
        self._caller_valence = self._feel(said)[1]

        async def speak(chunk: str, is_last: bool = False,
                        task: Optional[asyncio.Future] = None) -> None:
            """Send one chunk's audio, awaiting a synthesis already in flight.

            `task` is the prefetched synthesis for this chunk. Pacing and
            sequence numbers are still computed HERE, in emission order, so
            prefetching cannot reorder speech or corrupt the pause model.
            """
            nonlocal seq, prev_chunk
            if not chunk or self.closed:
                return

            # Plan the silence that belongs in FRONT of this clause, then send it
            # as metadata rather than as audio. The client schedules it on the
            # audio clock, so the pause costs no synthesis time and a barge-in
            # during it cancels instantly. See pacing.py for the rules.
            # How WE sound changes clause by clause, so this is read per chunk.
            self._arousal, self._valence = self._feel(chunk)

            pause = self.pacer.plan(
                chunk,
                prev_text=prev_chunk,
                is_first=(seq == 0),
                is_last=is_last,
                arousal=float(getattr(self, "_arousal", 0.0)),
                valence=float(getattr(self, "_valence", 0.0)),
                caller_valence=float(getattr(self, "_caller_valence", 0.0)),
            )

            # A TTS engine that RAISES is at least as likely as one that returns
            # nothing: a missing model file, a dead subprocess, a network engine
            # timing out. Uncaught, that exception escaped the speak task and
            # ended the turn mid-sentence with no error frame at all - from the
            # caller's side the agent simply stopped talking. Treat a crash
            # exactly like a failed synthesis.
            #
            # CancelledError is deliberately re-raised: barge-in works by
            # cancelling this task, so swallowing it would break interruption.
            try:
                got = await (task if task is not None
                             else _maybe_await(self.deps.synth(chunk)))
            except asyncio.CancelledError:
                raise
            except Exception as exc:                       # noqa: BLE001
                got = None
                self._synth_error = str(exc)
            audio = got.get("audio") if isinstance(got, dict) else None
            if not audio:
                # BUG FIX: never fail silently.
                #
                # `server._synth` returns None when every engine in the ladder
                # fails, and this function used to just `return`. The caller then
                # heard nothing at all, the client showed no error, and the
                # session looked healthy - dead air is the single worst failure
                # mode a phone system can have, because nobody can tell it apart
                # from a dropped call. Reporting it lets the UI say so and lets
                # the widget fall back to browser speech synthesis.
                await self._emit(t="error", code="synth_failed",
                                 message="speech synthesis unavailable",
                                 text=chunk)
                prev_chunk = chunk
                return

            mime = (got.get("mime") if isinstance(got, dict) else "") or "audio/wav"
            if not self.metrics.first_audio_at:
                self.metrics.first_audio_at = time.perf_counter()
            seq += 1
            await self._emit(t="speak", seq=seq, mime=mime,
                             bytes=len(audio), text=chunk,
                             **pause.as_meta())
            await self._emit_audio(audio)
            prev_chunk = chunk

        # -- synthesis pipeline -------------------------------------------
        # Ordered prefetch. `pipe()` starts synthesis immediately and only
        # blocks once the window is full; `speak()` then drains in FIFO order.
        pending: List[Tuple[str, bool, asyncio.Future]] = []

        async def _synth_one(text: str):
            return await _maybe_await(self.deps.synth(text))

        def _cancel_pending() -> None:
            """Drop prefetched audio the caller will never hear.

            Prefetching means a barge-in can leave synthesis running for text
            that is now cancelled. Left alone those tasks would keep burning
            CPU during the caller's next sentence - starving the turn that
            actually matters - and would log 'exception was never retrieved'.
            """
            while pending:
                _c, _l, t = pending.pop(0)
                if not t.done():
                    t.cancel()

        async def pipe(chunk: str, is_last: bool = False) -> None:
            if not chunk or self.closed:
                return
            pending.append((chunk, is_last, asyncio.ensure_future(_synth_one(chunk))))
            while len(pending) > SYNTH_PREFETCH:
                c, last, t = pending.pop(0)
                await speak(c, last, t)

        async def pipe_flush() -> None:
            while pending:
                c, last, t = pending.pop(0)
                await speak(c, last, t)

        try:
            if reuse is not None:
                # The speculation already ran. Its tokens are in hand, so we go
                # straight to synthesis - this is the fastest possible turn.
                toks = await reuse
                self.metrics.first_token_at = time.perf_counter()
                for tok in toks:
                    for chunk in chunker.push(tok):
                        spoken.append(chunk)
                        await pipe(chunk)
                        if self.closed or not self.speaking:
                            return
            else:
                it = self.deps.stream_reply(said, list(self.history[:-1]))
                async for tok in it:
                    if not tok:
                        continue
                    if not self.metrics.first_token_at:
                        self.metrics.first_token_at = time.perf_counter()
                        # Cover REAL dead air only. Gated on measured elapsed
                        # time, so a fast turn never gets padded with a fake
                        # "let me see" - which would make a good reply worse.
                        waited = (self.metrics.first_token_at
                                  - self.metrics.t0) * 1000.0
                        filler = self.pacer.should_fill(
                            waited, threshold_ms=FILLER_AFTER_MS)
                        if filler:
                            await speak(filler)
                    await self._emit(t="token", text=tok)
                    for chunk in chunker.push(tok):
                        spoken.append(chunk)
                        await pipe(chunk)
                        if self.closed or not self.speaking:
                            return

            rest = chunker.drain()
            if rest:
                spoken.append(rest)
                await pipe(rest, is_last=True)
            await pipe_flush()
        except asyncio.CancelledError:
            _cancel_pending()
            # Interrupted mid-answer. Keep whatever was actually SPOKEN in the
            # history and discard the rest: the caller never heard it, so the
            # model must not believe it did. Getting this wrong is why
            # interrupted agents then reference things they never said.
            if spoken:
                self.history.append({"role": "assistant",
                                     "content": " ".join(spoken).strip()})
            raise
        finally:
            _cancel_pending()
            self.speaking = False
            self.metrics.done_at = time.perf_counter()

        full = " ".join(spoken).strip()
        if full:
            self.history.append({"role": "assistant", "content": full})

        # Discard everything the microphone picked up while we were talking.
        # Only on a CLEAN finish - see _discard_echo for why an interrupted turn
        # must keep its audio.
        self._discard_echo()

        await self._emit(t="done", pause_ms=self.pacer.spent_ms,
                         pacing=";".join(self.pacer.trace[:12]),
                         **self.metrics.to_dict())

    def _discard_echo(self) -> None:
        """Throw away audio captured while the agent was speaking.

        THE BUG THIS FIXES - the agent answering its own words.

        `asr_tick` refuses to transcribe while `self.speaking`, which looks like
        it solves echo. It does not: `on_audio` keeps appending to the PcmStream
        the whole time, and `asr.reset()` is called BEFORE `_answer` starts. So
        every sample recorded during the agent's reply - including whatever of
        the agent's own voice leaked past the browser's echo canceller, plus the
        caller's "mm-hm" and any room noise - was still sitting un-consumed in
        the buffer when the reply ended. The next recognition pass swallowed all
        of it and attributed it to the caller. The observable result is an agent
        that answers a question nobody asked, or repeats/argues with itself,
        getting worse the longer the call runs because the contamination
        compounds turn over turn.

        Resetting HERE, at the moment the agent stops speaking, is what makes the
        commit point mean "the caller's next word".

        Deliberately NOT called on the interrupted path: during a barge-in the
        audio recorded while we were speaking IS the caller talking over us, and
        it is the most important audio in the call. Discarding it would make
        every interruption lose the sentence that caused it - which would be a
        worse bug than the one being fixed.
        """
        try:
            self.asr.reset()
        except Exception:
            pass
        self._last_sent_partial = ""
        self._voiced_run_ms = 0.0
        self.turn_open = False

    # -- interruption ------------------------------------------------------
    async def interrupt(self, reason: str = "barge-in") -> None:
        """Stop talking immediately and hand the floor back."""
        if not self.speaking and not self._speak_task:
            return
        self.speaking = False
        task = self._speak_task
        self._speak_task = None
        if task and not task.done():
            task.cancel()
            # Same reasoning as in commit_turn: await the cancellation without
            # letting it propagate into whichever loop called interrupt().
            await asyncio.gather(task, return_exceptions=True)
        # Being interrupted right after we committed is ground truth that we
        # ended the turn too early. It is a free training signal and we use it
        # to become permanently more patient with this caller.
        if self._last_answer_at and (time.perf_counter() - self._last_answer_at) < 1.5:
            self.detector.note_interruption()
        self._answering = False
        await self._emit(t="interrupt", reason=reason)

    # -- control messages --------------------------------------------------
    async def on_message(self, msg: Dict) -> None:
        # Anything that is not a dict is a client bug, a proxy mangling frames,
        # or someone poking the socket by hand. Previously `msg.get` raised
        # AttributeError, and that escaped the receive loop and dropped a LIVE
        # CALL over one stray frame. Ignoring the frame keeps the caller
        # connected, which is always the better trade on a phone line.
        if not isinstance(msg, dict):
            return
        t = str(msg.get("t") or "")
        if t == "prosody":
            self.on_prosody(msg)
        elif t == "barge":
            await self.interrupt("client-vad")
        elif t == "text":
            await self.interrupt("typed")
            await self.commit_turn(str(msg.get("text") or ""))
        elif t == "stop":
            await self.close()
        elif t == "reset":
            self.history = []
            self.asr.reset()
            self.turn_open = False
        elif t == "start":
            # BUG FIX: the client has always sent {"t":"start"} on connect and
            # the server has always ignored it, so a caller-supplied voice,
            # history or sensitivity was silently dropped and every call ran on
            # defaults regardless of what the widget was configured with.
            hist = msg.get("history")
            if isinstance(hist, list):
                self.history = [h for h in hist if isinstance(h, dict)]
            try:
                sens = float(msg.get("sensitivity") or 0.0)
            except (TypeError, ValueError):
                sens = 0.0
            if 0.5 <= sens <= 2.0:
                self.detector.sensitivity = sens
        elif t == "eos":
            # The browser's VAD saw end-of-speech. It measures the pre-resample
            # signal with hardware echo cancellation applied, so it is both
            # earlier and cleaner than our energy gate. Treated as EVIDENCE, fed
            # to the endpointer - never as a command, because a client that
            # mis-detects must not be able to cut the caller off mid-sentence.
            if self.turn_open and not self.speaking:
                await self.tick()

    async def close(self) -> None:
        self.closed = True
        self._cancel_preempt()
        if self._speak_task and not self._speak_task.done():
            self._speak_task.cancel()

    # -- the driver --------------------------------------------------------
    async def run_loops(self) -> None:
        """Background cadence: endpointing at TICK_MS, recognition at ASR_TICK_MS.

        Two independent clocks on purpose. Endpointing must be fast and is
        nearly free; recognition is a network call and must not be. Tying them
        together is what forced v48 to choose one compromise interval (700ms)
        that was simultaneously too slow to endpoint on and too fast to
        transcribe with.
        """
        async def endpoint_loop():
            while not self.closed:
                await asyncio.sleep(TICK_MS / 1000.0)
                try:
                    await self.tick()
                except asyncio.CancelledError:
                    raise
                except Exception:
                    pass

        async def recog_loop():
            while not self.closed:
                await asyncio.sleep(self._asr_tick_ms / 1000.0)
                try:
                    await self.asr_tick()
                except asyncio.CancelledError:
                    raise
                except Exception:
                    pass

        await asyncio.gather(endpoint_loop(), recog_loop(),
                             return_exceptions=True)


__all__ = [
    "RealtimeSession", "Deps", "SentenceChunker", "TurnMetrics",
    "TICK_MS", "ASR_TICK_MS", "LOCAL_ASR_TICK_MS", "BARGE_MS",
    "FILLER_AFTER_MS",
]
