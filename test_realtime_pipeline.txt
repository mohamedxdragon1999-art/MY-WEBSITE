"""Tests for the v49 realtime pipeline.

Run: python3 test_realtime_pipeline.py

These are behaviour tests, not coverage theatre. Each one encodes a specific
failure the v48 pipeline actually had, so a regression is caught as the symptom
the user would report, not as a stack trace.
"""
import asyncio
import math
import sys

import endpointing as ep
from audio_frames import (SAMPLE_RATE, FRAME_SAMPLES, PcmStream,
                          float32_to_pcm16, pcm16_to_wav, frame_stats)
from asr_stream import IncrementalTranscriber, agreed_prefix, strip_overlap
from realtime import Deps, RealtimeSession, SentenceChunker

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


# ---------------------------------------------------------------------------
section("endpointing: lexical cues")

p_done, _ = ep.lexical_completion("yes")
p_dangle, _ = ep.lexical_completion("my account number is")
p_filler, _ = ep.lexical_completion("um")
p_q, _ = ep.lexical_completion("what time do you close")
p_frag, _ = ep.lexical_completion("my")

check("'yes' reads as finished", p_done > 0.85, p_done)
check("trailing 'is' reads as unfinished", p_dangle < 0.15, p_dangle)
check("pure filler is never a turn", p_filler < 0.05, p_filler)
check("a question hands over the floor", p_q > 0.7, p_q)
check("one-word fragment is doubtful", p_frag < 0.5, p_frag)

# THE v48 LADDER BUG: only one rule could ever fire. Three independent
# "keep waiting" signals must beat one of them.
p_one, _ = ep.lexical_completion("so the thing is")
p_three, _ = ep.lexical_completion("um so like the thing is")
check("evidence accumulates (3 cues < 1 cue)", p_three < p_one,
      (p_three, p_one))

check("fillers are counted, not silently dropped",
      ep.hesitation_ratio("um so uh yeah") > 0.4,
      ep.hesitation_ratio("um so uh yeah"))
# A filler takes its attached punctuation with it: dropping "um," must not
# leave an orphan comma at the head of the sentence.
check("strip_fillers keeps real words",
      ep.strip_fillers("um, cancel my order uh please") == "cancel my order please",
      ep.strip_fillers("um, cancel my order uh please"))
check("strip_fillers survives pure punctuation",
      ep.strip_fillers("- ... um hello") == "- ... hello",
      ep.strip_fillers("- ... um hello"))
check("backchannel detected", ep.is_backchannel("mhm") and ep.is_backchannel("yeah"))
check("real sentence is not a backchannel",
      not ep.is_backchannel("yeah I want to cancel"))


# ---------------------------------------------------------------------------
section("endpointing: prosody + fusion")

falling = ep.Prosody(f0_slope=-4.0, energy_ratio=0.4, final_lengthening=1.5, voiced=False)
mid = ep.Prosody(f0_slope=0.2, energy_ratio=1.3, final_lengthening=1.0, voiced=True)

pf, _ = ep.prosodic_completion(falling)
pm, _ = ep.prosodic_completion(mid)
pn, _ = ep.prosodic_completion(None)

check("falling+decaying reads as finished", pf > 0.85, pf)
check("still voiced reads as unfinished", pm < 0.1, pm)
check("absent prosody is exactly no information", abs(pn - 0.5) < 1e-9, pn)
check("fusing with 0.5 is a no-op",
      abs(ep.fuse(0.8, 0.5) - 0.8) < 1e-9, ep.fuse(0.8, 0.5))

# The headline claim: prosody lets a confident turn go FASTER without the words
# changing at all.
bare = ep.required_silence_ms(ep.fuse(*[ep.lexical_completion("okay that works")[0], 0.5]))
with_pros = ep.required_silence_ms(ep.fuse(ep.lexical_completion("okay that works")[0], pf))
check("prosody shortens the wait", with_pros < bare, (with_pros, bare))
check("a finished turn waits near the floor", with_pros < 320, with_pros)

# ...and an unfinished one is allowed to exceed the normal ceiling.
open_ms = ep.required_silence_ms(0.05)
check("unfinished turns get open-turn patience",
      open_ms > ep.MAX_SILENCE_MS, open_ms)
check("required silence is monotonic in confidence",
      all(ep.required_silence_ms(p / 20.0) >= ep.required_silence_ms((p + 1) / 20.0)
          for p in range(20)))


# ---------------------------------------------------------------------------
section("endpointing: TurnDetector")

det = ep.TurnDetector()
det.begin_turn()
d = det.update("my account number is", silence_ms=900, prosody=mid)
check("does not cut off a dangling clause at 900ms", not d.end_of_turn, d.to_dict())

d = det.update("yes that is correct.", silence_ms=300, prosody=falling)
check("answers a confident turn at 300ms", d.end_of_turn, d.to_dict())

d = det.update("mhm", silence_ms=50, prosody=falling, agent_speaking=True)
check("backchannel never steals the floor", (not d.end_of_turn) and d.backchannel)

d = det.update("still going", silence_ms=10, prosody=mid, elapsed_ms=99999)
check("hard deadline always fires", d.end_of_turn, d.reason)

# Adaptive patience from observed mistakes.
d2 = ep.TurnDetector()
before = d2.update("okay sure", silence_ms=0, prosody=falling).required_ms
for _ in range(3):
    d2.note_interruption()
after = d2.update("okay sure", silence_ms=0, prosody=falling).required_ms
check("being cut off makes it more patient", after > before, (before, after))


# ---------------------------------------------------------------------------
section("audio: PCM buffer, slicing, VAD")


def tone(ms, freq=220.0, amp=0.3):
    n = int(SAMPLE_RATE * ms / 1000.0)
    return float32_to_pcm16(
        [amp * math.sin(2 * math.pi * freq * i / SAMPLE_RATE) for i in range(n)])


def silence(ms):
    return b"\x00\x00" * int(SAMPLE_RATE * ms / 1000.0)


st = PcmStream()
st.append(tone(500))
check("duration tracked", abs(st.duration_ms - 500) < 25, st.duration_ms)
check("tone is voiced", st.is_voiced(), st.silence_ms)
st.append(silence(400))
check("silence accumulates", st.silence_ms >= 350, st.silence_ms)
check("not voiced during silence", not st.is_voiced())

# The carry-buffer fix: odd chunk sizes must not lose analysis frames.
st2 = PcmStream()
odd = FRAME_SAMPLES * 2 + 137           # deliberately not a frame multiple
blob = silence(1000)
for i in range(0, len(blob), odd * 2):
    st2.append(blob[i:i + odd * 2])
check("odd-sized chunks do not drift the VAD clock",
      st2.silence_ms >= 960, st2.silence_ms)

# Slicing: ANY byte range is a valid clip. This is the property WebM lacked.
st3 = PcmStream()
st3.append(tone(2000))
mid_wav = pcm16_to_wav(st3.slice_pcm(SAMPLE_RATE // 2, SAMPLE_RATE))
check("a mid-stream slice is a valid WAV", mid_wav[:4] == b"RIFF" and len(mid_wav) > 44)

st3.advance_commit(SAMPLE_RATE)          # 1s settled
pend, start = st3.pending_pcm(overlap_ms=240)
expect = int(SAMPLE_RATE * 1.24)         # 1s remaining + 240ms replayed context
check("pending window is bounded, not the whole utterance",
      abs(len(pend) // 2 - expect) < 400, len(pend) // 2)
check("overlap rewinds into committed audio",
      start < SAMPLE_RATE, start)

# Clipping protection.
loud = float32_to_pcm16([5.0, -5.0, float("nan")])
check("over-driven samples clamp instead of wrapping",
      loud == b"\xff\x7f\x01\x80\x00\x00", loud)


# ---------------------------------------------------------------------------
section("incremental ASR")

check("agreement commits the shared prefix",
      agreed_prefix(["cancel my order please", "cancel my order now"], holdback=0)
      == "cancel my order",
      agreed_prefix(["cancel my order please", "cancel my order now"], holdback=0))
check("holdback drops the unsettled tail",
      agreed_prefix(["cancel my order", "cancel my order"], holdback=1)
      == "cancel my")
check("disagreement at word 1 commits nothing",
      agreed_prefix(["hello there", "yellow there"], holdback=0) == "")
check("case and punctuation are not disagreement",
      agreed_prefix(["Okay, sure thing", "okay sure thing"], holdback=0)
      == "okay sure thing",
      agreed_prefix(["Okay, sure thing", "okay sure thing"], holdback=0))

check("overlap words are removed once",
      strip_overlap("my order today", "cancel my order") == "today",
      strip_overlap("my order today", "cancel my order"))
check("no overlap leaves text intact",
      strip_overlap("brand new words", "cancel my order") == "brand new words")


async def test_incremental():
    stream = PcmStream()
    script = [
        "i would like",
        "i would like to cancel",
        "i would like to cancel my order",
    ]
    calls = {"n": 0, "bytes": []}

    async def fake_asr(wav):
        i = min(calls["n"], len(script) - 1)
        calls["n"] += 1
        calls["bytes"].append(len(wav))
        return {"text": script[i], "engine": "fake"}

    # max_pending_ms is deliberately small here so the structural bound is
    # exercised in a short test rather than only after six seconds of speech.
    inc = IncrementalTranscriber(stream, fake_asr, agree_passes=2, holdback=1,
                                 max_pending_ms=1200.0)
    for _ in range(6):
        stream.append(tone(400))
        await inc.tick()

    committed_ok = inc.committed.startswith("i would")
    check("partials commit stable words", committed_ok, inc.committed)
    # THE BIG ONE: v48's window grew without bound. Ours must not.
    biggest = max(calls["bytes"])
    cap = 1200.0 / 1000.0 * SAMPLE_RATE * 2 + 4096      # window + WAV header
    check("per-tick payload is structurally bounded",
          biggest <= cap, (calls["bytes"], cap))
    check("the bound engaged rather than being luck",
          inc.forced_commits >= 1, inc.stats())

    async def final_asr(wav):
        return {"text": "my order today", "engine": "fake-final"}

    inc._transcribe = final_asr
    out = await inc.flush()
    check("flush produces a whole transcript",
          "cancel" in out.committed or "order" in out.committed, out.committed)
    check("flush does not duplicate overlap words",
          out.committed.count("my order") <= 1, out.committed)


asyncio.run(test_incremental())


# ---------------------------------------------------------------------------
section("streaming TTS chunker")

c = SentenceChunker()
out = []
for tok in ["Sure", ",", " I can", " help", " with that", ".", " Let me", " pull it up", "."]:
    out += c.push(tok)
rest = c.drain()
check("first chunk is emitted early, at a clause boundary",
      out and len(out[0]) <= 90, out[:1])
check("first chunk is speakable, not a word fragment",
      out and out[0].strip().endswith((",", ".", "!", "?")), out[:1])
all_text = " ".join(out + ([rest] if rest else []))
check("no text is lost by chunking",
      "pull it up" in all_text and "help with that" in all_text, all_text)

long_c = SentenceChunker()
blob = long_c.push("word " * 200)
check("a run-on reply is still cut into speakable pieces", len(blob) >= 2, len(blob))
check("forced cuts never split a word",
      all(not x.endswith("wor") for x in blob))


# ---------------------------------------------------------------------------
section("realtime session end-to-end")


def make_session(reply_tokens=None, on_synth=None, slow_reply=False):
    events = []
    audio_out = []

    async def send_json(p):
        events.append(p)

    async def send_bytes(b):
        audio_out.append(b)

    async def transcribe(wav):
        return {"text": "i want to cancel my order", "engine": "fake"}

    async def stream_reply(text, history):
        for t in (reply_tokens or ["Sure", ", done", "."]):
            if slow_reply:
                await asyncio.sleep(0.05)
            yield t

    async def synth(text):
        if on_synth:
            on_synth(text)
        await asyncio.sleep(0.01)
        return {"audio": b"RIFF-fake-audio", "mime": "audio/wav"}

    sess = RealtimeSession(send_json, send_bytes,
                           Deps(transcribe, stream_reply, synth))
    return sess, events, audio_out


async def test_turn():
    sess, events, audio = make_session()
    await sess.on_audio(tone(600))
    await sess.asr_tick()
    await sess.on_audio(silence(500))
    d = await sess.tick()

    kinds = [e["t"] for e in events]
    check("a partial reached the client", "partial" in kinds, kinds)
    check("the turn ended", "final" in kinds, kinds)
    check("audio was streamed back", len(audio) >= 1, len(audio))
    check("latency breakdown is reported", "done" in kinds, kinds)
    done = [e for e in events if e["t"] == "done"]
    check("first_audio precedes total",
          done and done[0]["first_audio_ms"] <= done[0]["total_ms"], done)
    check("history has both sides", len(sess.history) == 2, sess.history)


asyncio.run(test_turn())


async def test_barge_in():
    spoken = []
    sess, events, audio = make_session(
        reply_tokens=["One. ", "Two. ", "Three. ", "Four. ", "Five. "],
        on_synth=spoken.append, slow_reply=True)

    async def talk_over():
        await asyncio.sleep(0.06)
        for _ in range(20):
            await sess.on_audio(tone(30))
            await asyncio.sleep(0.005)

    await sess.on_audio(tone(400))
    await sess.asr_tick()
    await sess.on_audio(silence(500))
    await asyncio.gather(sess.tick(), talk_over())

    kinds = [e["t"] for e in events]
    check("barge-in interrupted the agent", "interrupt" in kinds, kinds)
    check("generation actually stopped early", len(spoken) < 5, spoken)
    said = " ".join(m["content"] for m in sess.history if m["role"] == "assistant")
    check("history records only what was SPOKEN",
          "Five" not in said, said)

    # The bug that would have made barge-in fatal: the endpointing loop must
    # survive the cancellation.
    sess2, ev2, _ = make_session()
    await sess2.on_audio(tone(400))
    await sess2.asr_tick()
    await sess2.on_audio(silence(500))
    await sess2.tick()
    await sess2.interrupt("test")
    await sess2.on_audio(tone(400))
    await sess2.asr_tick()
    await sess2.on_audio(silence(500))
    await sess2.tick()
    check("a second turn still works after an interrupt",
          [e["t"] for e in ev2].count("final") == 2,
          [e["t"] for e in ev2])


asyncio.run(test_barge_in())


async def test_preemptive():
    """The speculation must be REUSED, not recomputed, when the words match."""
    gen_calls = {"n": 0}
    events = []

    async def send_json(p):
        events.append(p)

    async def send_bytes(b):
        pass

    async def transcribe(wav):
        return {"text": "cancel my order", "engine": "fake"}

    async def stream_reply(text, history):
        gen_calls["n"] += 1
        yield "Done."

    async def synth(text):
        return {"audio": b"aud", "mime": "audio/wav"}

    sess = RealtimeSession(send_json, send_bytes,
                           Deps(transcribe, stream_reply, synth))
    sess._begin_preempt("cancel my order")
    await asyncio.sleep(0.02)
    check("speculation started before the turn ended", gen_calls["n"] == 1)

    await sess.commit_turn("um, cancel my order")
    check("filler-only difference still reuses the speculation",
          gen_calls["n"] == 1, gen_calls["n"])
    check("the answer was still spoken",
          any(e["t"] == "speak" for e in events))


asyncio.run(test_preemptive())


print("\n" + "=" * 64)
print("passed: %d   failed: %d" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
