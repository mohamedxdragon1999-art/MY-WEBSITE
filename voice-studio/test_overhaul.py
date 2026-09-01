"""Tests for the v52 overhaul.

Run: python3 test_overhaul.py

Every check here encodes a bug that was ACTUALLY PRESENT in v51, written as the
symptom a caller would report rather than as an assertion about internals. The
headline one is the first section: the call feature was not slow, it was
permanently muted after the first interruption.

No network, no models, no audio hardware required.
"""
import asyncio
import os
import re
import sys

import pacing
from pacing import Pacer, plan_all
from asr_stream import IncrementalTranscriber, Partial
from audio_frames import SAMPLE_RATE, PcmStream
from realtime import (Deps, RealtimeSession, _LocalStreamAdapter,
                      ASR_TICK_MS, LOCAL_ASR_TICK_MS, FILLER_AFTER_MS)

HERE = os.path.dirname(os.path.abspath(__file__))
PASS = 0
FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok   " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (("  -> " + str(detail)) if detail else ""))


def section(t):
    print("\n== " + t + " " + "=" * max(0, 60 - len(t)))


def read(rel):
    with open(os.path.join(HERE, rel), "r", encoding="utf-8") as fh:
        return fh.read()


def frames(n, level=0.25):
    """n frames of 20ms voiced-ish PCM."""
    import struct
    out = []
    for f in range(n):
        buf = bytearray()
        for i in range(320):
            v = int(level * 32767 * (1 if (i // 8) % 2 else -1))
            buf += struct.pack("<h", v)
        out.append(bytes(buf))
    return out


# ===========================================================================
section("THE BROKEN CALL: sticky barge flag (client)")

rt_js = read(os.path.join("static", "realtime.js"))

# v51: bargeSent was set true on barge-in and cleared ONLY inside src.onended.
# _stopPlayback() nulled onended before stopping, so onended never ran, so
# bargeSent stayed true forever and _onAudio dropped every subsequent frame.
# The call stayed "connected" and the agent never heard another word.
# The teardown path is what used to strand the flag, so assert the reset lives
# in the SAME block as the epoch bump rather than anywhere in the file.
_stop = rt_js[rt_js.index("this.epoch++"):][:1500]
check("barge flag is cleared on the playback-stop path (not only in onended)",
      re.search(r"bargeSent\s*=\s*false", _stop) is not None)
check("voiced-run counter is reset alongside it",
      re.search(r"voicedRun\s*=\s*0", _stop) is not None)
check("an epoch counter exists to invalidate stale audio callbacks",
      "this.epoch" in rt_js)
check("_stopPlayback bumps the epoch BEFORE stopping sources",
      re.search(r"_stopPlayback\s*\([^)]*\)\s*\{\s*(?:.|\n){0,200}?this\.epoch\s*\+\+",
                rt_js) is not None)
check("stale audio callbacks are rejected by epoch comparison",
      re.search(r"epoch\s*!==\s*this\.epoch", rt_js) is not None)
check("playback stop ramps gain instead of hard-cutting (no click)",
      "linearRampToValueAtTime" in rt_js or "setTargetAtTime" in rt_js)
check("client sends an end-of-speech hint",
      '"eos"' in rt_js or "'eos'" in rt_js or 't:"eos"' in rt_js)
check("client honours server pause_ms when scheduling chunks",
      "pause_ms" in rt_js)


# ===========================================================================
section("CAPTURE QUALITY: resampler continuity (worklet)")

w_js = read(os.path.join("static", "capture-worklet.js"))

# v51 read ch[i] and ch[i+1] with i clamped at 0, so at every render-block
# boundary the interpolation silently became sample-and-hold. At 48kHz that is
# hundreds of step discontinuities per second - broadband noise exactly where
# fricatives live, which is why "s" and "f" were being lost.
check("worklet keeps the last sample of the previous block",
      "this.prev" in w_js)
check("previous sample is used for the left interpolation tap",
      re.search(r"i\s*<\s*0\s*\?\s*this\.prev", w_js) is not None)
check("prev is stored BEFORE the position counter is rebased",
      w_js.index("this.prev = ch[ch.length - 1]") < w_js.index("this.pos -= ch.length")
      if ("this.prev = ch[ch.length - 1]" in w_js and "this.pos -= ch.length" in w_js)
      else False)
check("a DC-blocking high-pass runs before level detection",
      "hpY" in w_js and "hpX" in w_js)
check("loop cannot read past the end of the block",
      "i + 1 >= ch.length" in w_js)


# ===========================================================================
section("SPEED: local streaming ASR is polled far more often")

check("local streaming tick is much faster than the cloud tick",
      LOCAL_ASR_TICK_MS < ASR_TICK_MS / 2, (LOCAL_ASR_TICK_MS, ASR_TICK_MS))
check("local tick is a whole number of 20ms audio frames",
      LOCAL_ASR_TICK_MS % 20 == 0, LOCAL_ASR_TICK_MS)

rt_py = read("realtime.py")
check("the recognition loop uses the per-session tick, not the constant",
      "self._asr_tick_ms / 1000.0" in rt_py)


class FakeRec:
    """Stands in for a sherpa-onnx OnlineRecognizer."""
    kind = "fake-streaming"

    def __init__(self):
        self.fed = 0
        self.reset_calls = 0
        self._text = ""

    def accept(self, pcm):
        self.fed += len(pcm)
        self._text = "hello there"

    def result(self):
        return ("hello", "there")

    def finalize(self):
        return "hello there"

    def reset(self):
        self.reset_calls += 1
        self._text = ""


async def adapter_parity():
    stream = PcmStream(SAMPLE_RATE)
    rec = FakeRec()
    ad = _LocalStreamAdapter(stream, rec)

    # Interface parity with IncrementalTranscriber: the session is written
    # against one interface, so a missing member is a runtime crash mid-call.
    for attr in ("accept", "tick", "flush", "reset", "committed", "tail", "stats"):
        check("adapter exposes ." + attr, hasattr(ad, attr))

    for f in frames(5):
        stream.append(f)
        ad.accept(f)
    check("audio is fed forward once, not re-uploaded", rec.fed == 5 * 640, rec.fed)

    p = await ad.tick()
    check("tick returns a Partial", isinstance(p, Partial), type(p))
    check("committed text is exposed", ad.committed == "hello", ad.committed)
    check("provisional tail is exposed", ad.tail == "there", ad.tail)
    check("first tick counts as changed", p.changed)

    p2 = await ad.tick()
    check("an unchanged tick sends nothing (no wasted websocket frame)",
          p2 is None, p2)
    check("passes are counted for observability", ad.passes >= 2, ad.passes)

    fp = await ad.flush()
    check("flush finalises the segment", fp.committed == "hello there", fp.committed)
    check("flush clears the provisional tail", ad.tail == "")
    check("flush does not move the shared pointer (reset owns that)",
          stream.commit_sample == 0, stream.commit_sample)

    ad.reset()
    check("reset clears text", ad.committed == "" and ad.tail == "")
    check("reset propagates to the recogniser", rec.reset_calls == 1)
    check("reset advances the shared commit point so echo is skipped",
          stream.commit_sample == stream.total_samples,
          (stream.commit_sample, stream.total_samples))
    check("stats are exposed for the metrics endpoint",
          ad.stats().get("engine") == "fake-streaming", ad.stats())

    # A recogniser that throws must not take the call down.
    class Boom(FakeRec):
        def result(self):
            raise RuntimeError("decoder exploded")

    bad = _LocalStreamAdapter(PcmStream(SAMPLE_RATE), Boom())
    got = await bad.tick()
    check("a throwing recogniser yields None instead of raising", got is None)
    check("the decoder fault is counted", bad.wasted_passes == 1, bad.wasted_passes)

    # commit_turn() awaits flush() WITHOUT catching, so flush must never raise:
    # if it did, one decoder hiccup would drop the caller's whole sentence.
    class BoomFinal(FakeRec):
        def finalize(self):
            raise RuntimeError("finalize exploded")

    bf = _LocalStreamAdapter(PcmStream(SAMPLE_RATE), BoomFinal())
    bf.committed = "i need"
    bf.tail = "help"
    fp2 = await bf.flush()
    check("a failing finalize degrades to the decoded words, not an exception",
          fp2.committed == "i need help", fp2.committed)

    class BoomReset(FakeRec):
        def reset(self):
            raise RuntimeError("reset exploded")

    br = _LocalStreamAdapter(PcmStream(SAMPLE_RATE), BoomReset())
    br.reset()
    check("a failing reset still clears local state", br.committed == "")


asyncio.run(adapter_parity())


# ===========================================================================
section("HUMANITY: pacing decides when to pause, and why")

pc = Pacer(seed=7)
pc.start_turn()

# Nothing before the first word - a human does not pause before starting.
first = pc.plan("Hello there.", prev_text="", is_first=True)
check("no pause before the very first clause", first.ms == 0, first.ms)

pc2 = Pacer(seed=7)
pc2.start_turn()
pc2.plan("Sure.", is_first=True)
sent = pc2.plan("That will be ready tomorrow.", prev_text="Sure.")
check("a sentence boundary earns a real pause", sent.ms > 0, sent.ms)
check("the pause carries a reason", bool(sent.reason), sent.reason)

# Bad news gets more room than neutral text; a direct answer gets less.
bad = plan_all(["I checked your account.", "Unfortunately the refund was declined."],
               seed=3)
neutral = plan_all(["I checked your account.", "The refund was processed."], seed=3)
check("bad news is delivered with a longer pause",
      sum(p.ms for p in bad) > sum(p.ms for p in neutral),
      (sum(p.ms for p in bad), sum(p.ms for p in neutral)))

direct = plan_all(["Are we open Sunday?", "Yes."], seed=3)
check("a direct answer is NOT padded",
      sum(p.ms for p in direct) < sum(p.ms for p in neutral),
      (sum(p.ms for p in direct), sum(p.ms for p in neutral)))

# The budget is the safety rail: pauses must never add up to dead air.
many = ["First point here."] * 40
pc3 = Pacer(seed=11)
pc3.start_turn()
total = sum(pc3.plan(t, prev_text="x.", is_first=(i == 0)).ms
            for i, t in enumerate(many))
check("total silence per turn is capped",
      total <= pacing.MAX_TURN_PAUSE_MS, total)
check("no single pause is absurd",
      all(p.ms <= pacing.MAX_PAUSE_MS for p in bad + neutral))
check("spent_ms tracks the budget", pc3.spent_ms == total, (pc3.spent_ms, total))
check("a trace is recorded for observability", len(pc3.trace) > 0)

# Jitter: two callers must not hesitate in identical places.
a = [p.ms for p in plan_all(["One thing.", "Another thing.", "A third thing."], seed=1)]
b = [p.ms for p in plan_all(["One thing.", "Another thing.", "A third thing."], seed=2)]
check("pauses are jittered per session", a != b, (a, b))

# as_meta must stay off the wire when there is no pause.
check("zero pause adds nothing to the frame", first.as_meta() == {}, first.as_meta())
check("a real pause is put on the wire", "pause_ms" in sent.as_meta(), sent.as_meta())

# Filler timing.
pc4 = Pacer(seed=5)
pc4.start_turn()
check("no filler when the reply came back fast",
      pc4.should_fill(120.0) is None)
_fill = pc4.should_fill(FILLER_AFTER_MS + 400.0)
check("a filler covers genuine dead air", isinstance(_fill, str) and _fill, _fill)
check("the filler is a short human phrase",
      _fill and 0 < len(_fill) < 40, _fill)
# Repeated fillers are the most irritating failure mode of voice agents.
check("at most one filler per turn",
      pc4.should_fill(FILLER_AFTER_MS + 900.0) is None)
pc4.start_turn()
check("the next turn may fill again",
      pc4.should_fill(FILLER_AFTER_MS + 400.0) is not None)

# Backchannels: only on a genuinely long caller turn, and rate limited.
pc5 = Pacer(seed=5)
pc5.start_turn()
check("no backchannel on a short caller turn",
      pc5.backchannel(caller_ms=900.0) is None)
check("a backchannel on a long caller turn",
      pc5.backchannel(caller_ms=6000.0) is not None)
check("backchannels are rate limited across turns",
      pc5.backchannel(caller_ms=6000.0) is None)
pc6 = Pacer(seed=5)
pc6.start_turn()
check("an upset caller gets an empathetic backchannel",
      pc6.backchannel(caller_ms=6000.0, caller_valence=-0.8)
      in pacing.EMPATHY_BACKCHANNELS)


# ===========================================================================
section("EMOTION: caller feeling changes the pacing")

upset = plan_all(["I understand.", "Let me fix that for you."],
                 caller_valence=-0.8, seed=4)
happy = plan_all(["I understand.", "Let me fix that for you."],
                 caller_valence=0.8, seed=4)
check("an upset caller is given more room than a happy one",
      sum(p.ms for p in upset) >= sum(p.ms for p in happy),
      (sum(p.ms for p in upset), sum(p.ms for p in happy)))

check("session reads sentiment into arousal/valence", "_feel" in rt_py)
check("caller valence is read once per turn", "_caller_valence = self._feel(said)" in rt_py)
check("our own tone is read per chunk",
      "self._arousal, self._valence = self._feel(chunk)" in rt_py)


class _S:
    pass


check("_feel never raises on junk input",
      RealtimeSession._feel(_S(), None) == (0.0, 0.0))


# ===========================================================================
section("ECHO: the agent must not transcribe its own voice")

check("a dedicated echo-discard step exists", "_discard_echo" in rt_py)
# It must run on the CLEAN finish path...
clean_tail = rt_py[rt_py.index("full = \" \".join(spoken).strip()"):]
check("echo is discarded after a completed reply",
      "self._discard_echo()" in clean_tail[:1600])
# ...and must NOT run on the interrupted path, where the audio is a real turn.
intr = rt_py[rt_py.index("async def interrupt"):]
intr = intr[:intr.index("async def on_message")]
check("echo is NOT discarded when the caller barged in",
      "_discard_echo" not in intr)


async def echo_clears():
    stream = PcmStream(SAMPLE_RATE)
    sess = RealtimeSession.__new__(RealtimeSession)
    sess.stream = stream
    sess.asr = _LocalStreamAdapter(stream, FakeRec())
    sess._last_sent_partial = "stale text"
    sess._voiced_run_ms = 999.0
    sess.turn_open = True
    for f in frames(6):
        stream.append(f)
        sess.asr.accept(f)
    sess._discard_echo()
    check("echo discard skips the audio recorded while speaking",
          stream.commit_sample == stream.total_samples,
          (stream.commit_sample, stream.total_samples))
    check("echo discard clears the stale partial", sess._last_sent_partial == "")
    check("echo discard clears the voiced run", sess._voiced_run_ms == 0.0)
    check("echo discard closes the turn", sess.turn_open is False)


asyncio.run(echo_clears())


# ===========================================================================
section("FAILURE VISIBILITY: silent synth no longer means dead air")

sent_frames = []


async def run_turn(synth_result, said="what are your hours"):
    sent_frames.clear()

    async def send_json(obj):
        sent_frames.append(obj)

    async def send_bytes(b):
        sent_frames.append({"t": "_audio", "n": len(b)})

    async def transcribe(wav):
        return {"text": said}

    async def stream_reply(text, hist):
        for tok in ["We are open ", "nine to five. ", "Anything else?"]:
            yield tok

    async def synth(text):
        return synth_result

    deps = Deps(transcribe=transcribe, stream_reply=stream_reply, synth=synth)
    sess = RealtimeSession(send_json, send_bytes, deps)
    await sess.commit_turn(said)
    if sess._speak_task:
        await asyncio.gather(sess._speak_task, return_exceptions=True)
    return sess


s = asyncio.run(run_turn(None))
errs = [f for f in sent_frames if f.get("t") == "error"]
check("failed synthesis emits an error instead of silence", len(errs) > 0)
check("the error is machine-readable",
      errs and errs[0].get("code") == "synth_failed",
      errs[0] if errs else None)
check("the undelivered text is included so the client can show it",
      errs and errs[0].get("text"))

s2 = asyncio.run(run_turn({"audio": b"RIFFxxxx", "mime": "audio/wav"}))
speaks = [f for f in sent_frames if f.get("t") == "speak"]
dones = [f for f in sent_frames if f.get("t") == "done"]
check("a working turn still speaks", len(speaks) > 0, len(speaks))
check("audio follows each speak frame",
      len([f for f in sent_frames if f.get("t") == "_audio"]) == len(speaks))
check("the turn completes", len(dones) == 1, len(dones))
check("done reports total pause time", "pause_ms" in (dones[0] if dones else {}))
check("done reports the pacing trace", "pacing" in (dones[0] if dones else {}))
check("later chunks carry pause metadata",
      any("pause_ms" in f for f in speaks[1:]) or len(speaks) < 2)
check("the reply is remembered in history",
      any(m.get("role") == "assistant" for m in s2.history))


# ===========================================================================
section("PROTOCOL: start and eos are no longer ignored")


async def protocol():
    async def send_json(obj):
        pass

    async def send_bytes(b):
        pass

    async def transcribe(wav):
        return {"text": ""}

    async def stream_reply(text, hist):
        yield "ok"

    async def synth(text):
        return {"audio": b"RIFF", "mime": "audio/wav"}

    deps = Deps(transcribe=transcribe, stream_reply=stream_reply, synth=synth)
    sess = RealtimeSession(send_json, send_bytes, deps)

    base = sess.detector.sensitivity
    await sess.on_message({"t": "start",
                           "history": [{"role": "user", "content": "hi"},
                                       {"role": "assistant", "content": "hello"}],
                           "sensitivity": 1.6})
    check("start applies supplied history", len(sess.history) == 2, sess.history)
    check("start applies sensitivity",
          abs(sess.detector.sensitivity - 1.6) < 1e-9, sess.detector.sensitivity)

    await sess.on_message({"t": "start", "sensitivity": 99.0})
    check("absurd sensitivity is clamped, not obeyed",
          sess.detector.sensitivity <= 2.0, sess.detector.sensitivity)
    await sess.on_message({"t": "start", "sensitivity": 0.0})
    check("zero sensitivity is ignored (would deafen the endpointer)",
          sess.detector.sensitivity > 0)
    await sess.on_message({"t": "start", "history": "not-a-list"})
    check("malformed history is ignored, not fatal", len(sess.history) == 2)

    # eos is a hint. With no speech buffered it must NOT invent a turn.
    before = len(sess.history)
    await sess.on_message({"t": "eos", "silence_ms": 300})
    check("eos on silence does not fabricate a turn",
          len(sess.history) == before, sess.history)
    await sess.close()


asyncio.run(protocol())


# ===========================================================================
section("NO REGRESSION: the cloud path still works untouched")

check("streaming dep defaults to None", Deps(1, 2, 3).streaming is None)


async def cloud_fallback():
    calls = []

    async def send_json(obj):
        pass

    async def send_bytes(b):
        pass

    async def transcribe(wav):
        calls.append(len(wav))
        return {"text": "hello"}

    async def stream_reply(text, hist):
        yield "hi"

    async def synth(text):
        return {"audio": b"RIFF", "mime": "audio/wav"}

    # No streaming factory -> must use the stateless IncrementalTranscriber.
    d = Deps(transcribe=transcribe, stream_reply=stream_reply, synth=synth)
    s = RealtimeSession(send_json, send_bytes, d)
    check("without a local model the cloud transcriber is used",
          isinstance(s.asr, IncrementalTranscriber), type(s.asr))
    check("and the slower cloud tick is used",
          s._asr_tick_ms == ASR_TICK_MS, s._asr_tick_ms)

    # A streaming factory that BLOWS UP must degrade, not break the call.
    def bad_factory():
        raise RuntimeError("no model on disk")

    d2 = Deps(transcribe=transcribe, stream_reply=stream_reply, synth=synth,
              streaming=bad_factory)
    s2 = RealtimeSession(send_json, send_bytes, d2)
    check("a broken local model falls back to the cloud path",
          isinstance(s2.asr, IncrementalTranscriber), type(s2.asr))

    d3 = Deps(transcribe=transcribe, stream_reply=stream_reply, synth=synth,
              streaming=lambda: FakeRec())
    s3 = RealtimeSession(send_json, send_bytes, d3)
    check("a working local model is preferred",
          isinstance(s3.asr, _LocalStreamAdapter), type(s3.asr))
    check("and the fast local tick is used",
          s3._asr_tick_ms == LOCAL_ASR_TICK_MS, s3._asr_tick_ms)

    # Audio must reach the local decoder as it arrives.
    for f in frames(3):
        await s3.on_audio(f)
    check("frames are streamed into the local decoder on arrival",
          s3._local_stream.fed == 3 * 640, s3._local_stream.fed)


asyncio.run(cloud_fallback())


# ===========================================================================
section("DEPLOYABILITY: a fresh install can hear and speak")

setup = read("setup_voices.py")
for flag in ("--asr", "--tts", "--all", "--check"):
    check("setup_voices supports " + flag, '"' + flag + '"' in setup)
check("setup_voices installs a streaming ASR model", "ASR_ARCHIVES" in setup)
check("setup_voices installs Silero VAD", "SILERO_FILES" in setup)
check("archive extraction guards against tar path traversal",
      "_safe_members" in setup)

srv = read("server.py")
check("a voice health endpoint exists", "/api/voice-status" in srv)
check("health endpoint reports whether we can hear", "can_hear" in srv)
check("health endpoint reports whether we can speak", "can_speak" in srv)
check("health endpoint uses the real availability API", "eng.availability()" in srv)
check("health endpoint uses the real stt api", "fast_stt.enabled()" in srv)
# Scope this to the realtime handler. `fast_stt.transcribe(` also appears far
# earlier in the unrelated HTTP /api/stt route, so comparing whole-file indexes
# was measuring the wrong call site and could never pass however correct the
# code was. My assertion was broken, not the wiring.
_ws_tr = srv[srv.index("async def _transcribe(wav: bytes):"):][:2200]
check("local recognition is tried before the cloud",
      "asr_local" in _ws_tr
      and _ws_tr.index("asr_local") < _ws_tr.index("fast_stt.transcribe("))
check("streaming recogniser is injected into the session",
      "streaming=_streaming" in srv)
check("the catch-all static mount is still declared last",
      srv.rindex('app.mount("/"') > srv.rindex("/api/voice-status"))

# The hint text must name flags that actually exist, or it is a lie.
for flag in re.findall(r"setup_voices\.py (--[a-z]+)", srv):
    check("health hint recommends a real flag: " + flag, '"' + flag + '"' in setup)


# ===========================================================================
print("\n" + "=" * 64)
print("PASSED: %d   FAILED: %d" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
