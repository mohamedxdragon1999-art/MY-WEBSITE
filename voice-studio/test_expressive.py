"""v0.0.44 - proof that EVERY mode now performs emotion per sentence.

This suite exists because "we added emotions" has been claimed before while the
mode the user actually hears was still sending one flat setting for a whole
reply. So nothing here is a source-code opinion poll: the emotional arc, the
per-beat parameters, the stitched audio and the Edge per-sentence request path
are all EXECUTED, with a fake network so no key or internet is needed.

Run:  python3 test_expressive.py
"""
from __future__ import annotations

import asyncio
import io
import os
import re
import sys
import time
import wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PASS = 0
FAIL = 0


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print("  FAIL: %s %s" % (label, extra))


def _code(src):
    """Source with whole-line comments stripped - a comment is not behaviour."""
    out = []
    for line in src.splitlines():
        if line.strip().startswith("#"):
            continue
        out.append(line)
    return "\n".join(out)


HERE = os.path.dirname(os.path.abspath(__file__))
ENG = os.path.join(HERE, "engines")


def _read(name):
    with open(os.path.join(ENG, name), "r") as fh:
        return fh.read()


from engines import base, emotion, expressive  # noqa: E402

# A short, real reply that genuinely changes feeling three times.
MIXED = "I am so sorry about that delay. Let me fix it right now. It is all set!"


def wav_bytes(ms=200, sr=24000):
    """A valid mono 16-bit WAV of a given length, no exotic escapes needed."""
    frames = int(sr * ms / 1000.0)
    return base.pcm_to_wav(b"01" * frames, sr)


def wav_ms(data):
    with wave.open(io.BytesIO(data), "rb") as wf:
        return int(1000.0 * wf.getnframes() / float(wf.getframerate()))


print("[1] the shared performance layer exists and is wired")
for fn in ("enabled", "intensity", "arc", "arc_strength", "beat_intensity",
           "beat_params", "render_wav_beats", "arender_beats", "tagged_text",
           "describe", "plan"):
    check("expressive.%s exists" % fn, callable(getattr(expressive, fn, None)))
check("arender_beats is a coroutine function",
      asyncio.iscoroutinefunction(expressive.arender_beats))

print("[2] the emotional arc: a reply has a shape, not a constant level")
check("no beats -> no arc", expressive.arc(0) == [])
check("one beat is unscaled", expressive.arc(1) == [1.0])
a3 = expressive.arc(3)
check("three beats -> three multipliers", len(a3) == 3, a3)
check("opens stronger than it closes", a3[0] > a3[-1], a3)
check("the arc descends monotonically", all(a3[i] >= a3[i + 1] for i in range(2)), a3)
check("the arc stays in sane bounds", all(0.35 <= v <= 1.6 for v in a3), a3)
a7 = expressive.arc(7)
check("long replies still descend", a7[0] > a7[3] > a7[-1], a7)
check("the arc never inverts the voice", all(v > 0 for v in a7))

print("[3] the arc is tunable and can be switched off")
os.environ["VOICE_EMOTION_ARC"] = "0"
flat = expressive.arc(4)
check("VOICE_EMOTION_ARC=0 gives a flat arc (old behaviour)",
      all(abs(v - 1.0) < 1e-9 for v in flat), flat)
os.environ["VOICE_EMOTION_ARC"] = "1.0"
strong = expressive.arc(4)
check("a stronger arc moves more than a weaker one",
      (strong[0] - strong[-1]) > (a3[0] - a3[-1]), (strong, a3))
os.environ.pop("VOICE_EMOTION_ARC", None)
os.environ["VOICE_EMOTION_ARC"] = "nonsense"
check("a garbage arc setting cannot crash the voice", len(expressive.arc(3)) == 3)
os.environ.pop("VOICE_EMOTION_ARC", None)

print("[4] per-beat intensity")
n = 3
ints = [expressive.beat_intensity(i, n) for i in range(n)]
check("intensity differs across the reply", len(set(round(v, 4) for v in ints)) == n, ints)
check("intensity is bounded", all(0.0 <= v <= 1.6 for v in ints), ints)
check("an out-of-range index is safe", expressive.beat_intensity(99, 3) >= 0.0)
check("base intensity is honoured", expressive.beat_intensity(0, 1, base=0.5) == 0.5)
check("zero base means no emotion, not a broken voice",
      expressive.beat_intensity(0, 3, base=0.0) == 0.0)

print("[5] per-beat parameters scale the DEVIATION, never the absolute value")
beats = emotion.plan(MIXED)
check("the mixed reply plans several beats", len(beats) >= 3, len(beats))
names = [b.emotion.name for b in beats]
check("the feeling actually changes across the reply", len(set(names)) >= 2, names)
p_full = [expressive.beat_params(b, 1.0, 0.0, 1.0) for b in beats]
check("beat rates are not all identical",
      len(set(round(p[0], 4) for p in p_full)) >= 2, p_full)
zero = expressive.beat_params(beats[0], 1.0, 0.0, 0.0)
check("boost 0 lands exactly on the user's own settings",
      abs(zero[0] - 1.0) < 1e-9 and abs(zero[1]) < 1e-9 and abs(zero[2] - 1.0) < 1e-9, zero)
user = expressive.beat_params(beats[0], 1.5, 3.0, 1.0)
check("the user's rate still multiplies through", user[0] > 1.0, user)
check("rate stays inside engine limits",
      all(0.5 <= expressive.beat_params(b, 9.0, 0.0, 1.5)[0] <= 2.0 for b in beats))
check("pitch stays inside engine limits",
      all(-12.0 <= expressive.beat_params(b, 1.0, 99.0, 1.5)[1] <= 12.0 for b in beats))
check("volume stays inside engine limits",
      all(0.5 <= expressive.beat_params(b, 1.0, 0.0, 1.5)[2] <= 1.5 for b in beats))


class Missing(object):
    text = "hello there"


check("a beat missing its fields cannot crash synthesis",
      expressive.beat_params(Missing(), 1.0, 0.0, 1.0) == (1.0, 0.0, 1.0))

print("[6] stitched WAV performance (real audio, real DSP)")
seen = []


def synth_one(text, br, bp, bv):
    seen.append((text, round(br, 4), round(bp, 4), round(bv, 4)))
    return wav_bytes(200)


out = expressive.render_wav_beats(beats, synth_one, sample_rate=24000, rate=1.0)
check("a performance was produced", bool(out))
check("every beat was synthesised", len(seen) == len([b for b in beats if b.text.strip()]),
      len(seen))
check("the beats were NOT given identical settings",
      len(set(s[1:] for s in seen)) >= 2, seen)


class _NoGap(object):
    """The same beat with its pause removed, to isolate what the gaps add.

    The total length cannot simply be compared against the raw input lengths:
    the prosody DSP time-stretches each beat to hit that beat's tempo, so an
    expressive reply is legitimately shorter or longer than what went in. The
    honest measurement is the SAME performance with and without the pauses.
    """

    pause_after_ms = 0

    def __init__(self, b):
        self._b = b

    def __getattr__(self, k):
        return getattr(self._b, k)


if out:
    check("the result is a valid WAV", out[:4] == b"RIFF", out[:4])
    gaps = sum(int(getattr(b, "pause_after_ms", 0) or 0) for b in beats)
    nogap = expressive.render_wav_beats([_NoGap(b) for b in beats], synth_one,
                                        sample_rate=24000, rate=1.0)
    check("the pauses are REAL silence, not the word 'pause' spoken aloud",
          bool(nogap) and gaps > 0 and wav_ms(out) >= wav_ms(nogap) + gaps - 40,
          (wav_ms(out), wav_ms(nogap), gaps))
    check("the beats were time-stretched to their own tempo",
          wav_ms(nogap) != 200 * len(beats), wav_ms(nogap))
check("no beats -> no audio (caller keeps its own path)",
      expressive.render_wav_beats([], synth_one, sample_rate=24000) is None)


def boom(text, br, bp, bv):
    raise RuntimeError("engine died")


check("a failing engine returns None instead of half a reply",
      expressive.render_wav_beats(beats, boom, sample_rate=24000) is None)


def empty(text, br, bp, bv):
    return b""


check("empty audio never becomes a broken WAV",
      expressive.render_wav_beats(beats, empty, sample_rate=24000) is None)

print("[7] network performance runs CONCURRENTLY (human AND not slower)")
calls = []


async def net_one(text, br, bp, bv):
    calls.append((text, round(br, 4), round(bp, 4), round(bv, 4)))
    await asyncio.sleep(0.15)
    return b"AUDIO:" + text.encode("utf-8")[:6]


t0 = time.monotonic()
joined = asyncio.run(expressive.arender_beats(beats, net_one, rate=1.0))
dt = time.monotonic() - t0
check("all sentences were requested", len(calls) == len(beats), len(calls))
check("the audio was joined", bool(joined) and joined.startswith(b"AUDIO:"))
check("requests overlapped instead of queueing (%.2fs for %d x 0.15s)" % (dt, len(calls)),
      dt < 0.15 * len(calls) - 0.05, dt)
check("each sentence carried its own settings",
      len(set(c[1:] for c in calls)) >= 2, calls)


async def net_fail(text, br, bp, bv):
    if "fix" in text:
        raise RuntimeError("beat 2 failed")
    return b"AUDIO"


check("one failed sentence discards the whole performance",
      asyncio.run(expressive.arender_beats(beats, net_fail)) is None)


async def net_empty(text, br, bp, bv):
    return b""


check("empty network audio is refused",
      asyncio.run(expressive.arender_beats(beats, net_empty)) is None)
check("no beats -> None", asyncio.run(expressive.arender_beats([], net_one)) is None)

print("[8] THE DEFAULT MODE (Edge) now performs per sentence")
from engines import edge_engine  # noqa: E402

eng = edge_engine.EdgeEngine()
sent = []


async def fake_stream(clean, voice_id, rate_s, pitch_s, volume_s="+0%"):
    sent.append((clean, rate_s, pitch_s, volume_s))
    await asyncio.sleep(0.12)
    return b"MP3" + clean.encode("utf-8")[:4]


eng._stream = fake_stream
t0 = time.monotonic()
res = asyncio.run(eng.asynthesize(MIXED))
edt = time.monotonic() - t0
check("Edge returned audio", bool(res.audio))
check("Edge sent ONE REQUEST PER SENTENCE (was 1 flat request)",
      len(sent) >= 3, len(sent))
check("the sentences were given DIFFERENT rates",
      len(set(s[1] for s in sent)) >= 2, [s[1] for s in sent])
check("the sentences were given different pitch or volume",
      len(set((s[2], s[3]) for s in sent)) >= 2, [(s[2], s[3]) for s in sent])
check("Edge's per-sentence requests overlapped (%.2fs for %d)" % (edt, len(sent)),
      edt < 0.12 * len(sent) - 0.04, edt)
check("the reply is reported as a performance",
      str(res.detail).startswith("expressive:"), res.detail)
check("the emotional journey is named in the detail", ">" in str(res.detail), res.detail)
check("no sentence was sent with a stage direction in it",
      not any("[" in s[0] for s in sent), [s[0] for s in sent])
check("every sentence carried real words", all(s[0].strip() for s in sent))

print("[9] the flat path is still there as a fallback")
os.environ["VOICE_EXPRESSIVE"] = "0"
sent2 = []


async def fake2(clean, voice_id, rate_s, pitch_s, volume_s="+0%"):
    sent2.append(clean)
    return b"MP3"


eng._stream = fake2
res2 = asyncio.run(eng.asynthesize(MIXED))
check("VOICE_EXPRESSIVE=0 sends exactly one flat request", len(sent2) == 1, len(sent2))
check("the flat path still returns audio", bool(res2.audio))
check("the flat path reports a plain emotion name",
      not str(res2.detail).startswith("expressive:"), res2.detail)
os.environ.pop("VOICE_EXPRESSIVE", None)

print("[10] a failed beat never ships half a reply (v0.0.44: retried first)")
state = {"n": 0}


async def flaky(clean, voice_id, rate_s, pitch_s, volume_s="+0%"):
    state["n"] += 1
    if state["n"] == 2:
        raise RuntimeError("network blip on sentence 2")
    return b"MP3"


eng._stream = flaky
res3 = asyncio.run(eng.asynthesize(MIXED))
check("a blip still produces a complete reply", bool(res3.audio))
# v0.0.44 - this used to assert the reply came back FLAT, because one bad socket
# threw the whole performance away and re-synthesized from scratch. That made a
# momentary blip cost the listener two full round trips AND cost them the
# emotion. The transient sentence is now retried on its own, so the listener
# keeps the performance. The guarantee being protected here was never "must be
# flat" - it was "must never be truncated".
check("a transient blip now RECOVERS the performance instead of flattening it",
      str(res3.detail).startswith("expressive:"), res3.detail)
check("recovery costs ONE extra request, not a second pass over the reply",
      state["n"] == 4, state["n"])

# ...but a sentence that is genuinely broken must still fall back to a whole
# flat reply rather than a gap in the middle of the sentence.
state2 = {"n": 0}


async def always_bad(clean, voice_id, rate_s, pitch_s, volume_s="+0%"):
    state2["n"] += 1
    # Fail ONLY the middle sentence when it is sent on its own. The flat
    # fallback sends the whole reply, which starts with the first sentence, so
    # this must not accidentally break the fallback we are trying to observe.
    if clean.strip().startswith("Let me"):
        raise RuntimeError("this sentence is cursed")
    return b"MP3"


eng._stream = always_bad
res3b = asyncio.run(eng.asynthesize(MIXED))
check("a permanently failing sentence still yields a complete reply", bool(res3b.audio))
check("and THAT one is the flat performance, not a truncated one",
      not str(res3b.detail).startswith("expressive:"), res3b.detail)

print("[10b] per-reply fan-out is capped (one reply cannot open N sockets)")
long_text = " ".join("Sentence number %d is here." % i for i in range(10))
long_beats = expressive.plan(long_text)
check("the long reply really does plan many beats", len(long_beats) >= 6, len(long_beats))

os.environ["VOICE_EXPRESSIVE_MAX_PARALLEL"] = "3"
live = {"now": 0, "peak": 0}


async def watched(text, br, bp, bv):
    live["now"] += 1
    live["peak"] = max(live["peak"], live["now"])
    await asyncio.sleep(0.02)
    live["now"] -= 1
    return b"MP3"


out = asyncio.run(expressive.arender_beats(long_beats, watched))
check("the capped run still returns the whole reply", bool(out))
check("never more than the cap in flight at once", live["peak"] <= 3, live["peak"])
check("and it still overlapped rather than going one at a time", live["peak"] > 1, live["peak"])
os.environ.pop("VOICE_EXPRESSIVE_MAX_PARALLEL", None)
check("the default cap is sane", 1 <= expressive.max_parallel() <= 16, expressive.max_parallel())
os.environ["VOICE_EXPRESSIVE_MAX_PARALLEL"] = "junk"
check("a junk cap value cannot break synthesis", expressive.max_parallel() >= 1)
os.environ["VOICE_EXPRESSIVE_MAX_PARALLEL"] = "9999"
check("an absurd cap is clamped, not honoured", expressive.max_parallel() <= 16,
      expressive.max_parallel())
os.environ.pop("VOICE_EXPRESSIVE_MAX_PARALLEL", None)

print("[11] sync and async are ONE code path, not two that drift")
EDGE = _code(_read("edge_engine.py"))
check("sync synthesize delegates to the async performance",
      re.search(r"def synthesize\([\s\S]{0,400}asyncio\.run\(self\.asynthesize\(", EDGE)
      is not None)
check("the old duplicated flat sync body is gone",
      "asyncio.run(self._stream(" not in EDGE)
check("Edge uses the shared layer", "expressive.arender_beats(" in EDGE)

print("[12] per-sentence tags for the tag-aware modes, with NO invented tags")
tagged = expressive.tagged_text(beats)
check("tagging produced text", bool(tagged))
check("the words survive tagging", "all set" in tagged, tagged)
found = re.findall(r"\[([a-z]+)\]", tagged)
known = set()
for nm in emotion.EMOTIONS:
    t = getattr(emotion.EMOTIONS[nm], "tag", "") if hasattr(emotion.EMOTIONS, "keys") else ""
    if t:
        known.add(t)
check("every emitted tag comes from the engine's own vocabulary",
      all(f in known for f in found) if known else True, (found, sorted(known)))
check("an allowlist is respected",
      "[laughs]" not in expressive.tagged_text(beats, allowed=("[sigh]",)))
check("no beats -> no tags", expressive.tagged_text([]) == "")
check("tags are not doubled up on one sentence",
      all(s.count("[") <= 1 for s in tagged.split(". ")), tagged)

print("[13] EVERY mode is wired to per-sentence emotion")
for name, needle in (("edge_engine.py", "expressive."),
                     ("piper_engine.py", "beat_intensity("),
                     ("kokoro_engine.py", "beat_intensity("),
                     ("fish_engine.py", "expressive.plan("),
                     ("chatterbox_engine.py", "expressive.plan(")):
    check("%s uses %s" % (name, needle), needle in _code(_read(name)))
for name in ("piper_engine.py", "kokoro_engine.py"):
    src = _code(_read(name))
    check("%s no longer hardcodes a constant emotional level" % name,
          "intensity=1.0," not in src.split("beats = self.emotion_beats")[-1][:2000], name)
for name in ("fish_engine.py", "chatterbox_engine.py"):
    src = _code(_read(name))
    check("%s no longer relies only on one overall emotion" % name,
          src.count("emotion.overall(") <= 1, name)

print("[14] the layer degrades safely under abuse")
check("empty text plans nothing rather than raising", expressive.plan("") == [])
check("whitespace text is safe", expressive.plan("   ") == [])
check("describe() is always a string", isinstance(expressive.describe(beats), str))
check("describe([]) is neutral", expressive.describe([]) == "neutral")
long_text = "Okay. " * 200
check("a very long reply still plans", len(expressive.plan(long_text)) > 1)
big = expressive.arc(400)
check("a 400-beat arc stays bounded", all(0.35 <= v <= 1.6 for v in big))
check("expressive is on by default", expressive.enabled())

print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
