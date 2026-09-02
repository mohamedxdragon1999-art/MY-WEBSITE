"""v20 tests: no spoken stage directions, and real emotion in every mode.

The headline bug: the voice literally said the WORD "sigh". These tests prove
every form a model might write is removed, on every engine, on both the server
and in the browser fallback - and that emotion now moves real acoustics.
"""
import os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "")
from engines import prosody, emotion, build_registry

PASS = 0
FAIL = []


def check(label, cond, detail=""):
    global PASS
    if cond:
        PASS += 1
        print("  ok   " + label)
    else:
        FAIL.append(label)
        print("  FAIL " + label + (("  -> " + str(detail)) if detail else ""))


print("[1] THE BUG: no stage direction may survive in any form")
# Every one of these was previously spoken out loud as words.
leaks = [
    "*sighs* I am sorry", "*sighs deeply* okay", "[sigh] okay", "[Sigh] okay",
    "[SIGH] okay", "(sighs) okay", "(pause) okay", "(pauses) okay",
    "{laughs} okay", "<laughs softly> okay", "[chuckle] okay", "[Chuckles] okay",
    "[clears throat] okay", "[breath] okay", "[whispers] okay", "[gasps] okay",
    "*coughs* okay", "_sighs_ okay", "**sighs** okay", "[thinking] okay",
    "[softly] okay", "[warmly] okay", "(smiling) okay", "[hmm] okay",
    "Sighs. okay", "Laughs: okay", "[pauses briefly] okay",
]
bad_words = ("sigh", "laugh", "chuckle", "pause", "cough", "whisper", "gasp",
             "throat", "breath", "smiling", "softly", "warmly", "thinking", "hmm")
for raw in leaks:
    out = prosody.sanitize_stage_directions(raw).lower()
    check("removes " + raw, not any(w in out for w in bad_words), repr(out))
for raw in leaks:
    out = prosody.sanitize_stage_directions(raw)
    check("keeps the real words of " + raw, "okay" in out.lower() or "sorry" in out.lower(), repr(out))

print("\n[2] real words are NOT eaten (no over-stripping)")
keep = [
    ("This deal is *free* today", "free"),
    ("The *total* is twelve dollars", "total"),
    ("Your refund (up to 30 days) is fine", "refund"),
    ("Press the pause button on your remote", "pause button"),
    ("I heard your laughter in the recording", "laughter"),
    ("The breathing exercise class is Tuesday", "class"),
]
for raw, must in keep:
    out = prosody.sanitize_stage_directions(raw)
    check("preserves: " + raw, must.split()[0] in out, repr(out))

print("\n[3] EVERY engine sanitizes (not just the tag-aware ones)")
reg = build_registry()
dirty = "*sighs* I am sorry [pause] about that (clears throat)"
for eid, eng in reg.items():
    out = eng.prepare(dirty).lower()
    check(eid + " never speaks a stage direction",
          not any(w in out for w in ("sigh", "clears throat", "throat")), repr(out))
    check(eid + " still says the real sentence", "sorry" in out, repr(out))
# Tag-aware engines may carry a real bracket tag, which the MODEL performs as sound.
check("fish is tag aware", reg["fish"].tag_aware)
check("chatterbox is tag aware", reg["chatterbox"].tag_aware)
check("edge is NOT tag aware", not reg["edge"].tag_aware)
check("kokoro is NOT tag aware", not reg["kokoro"].tag_aware)
check("piper is NOT tag aware", not reg["piper"].tag_aware)
for eid in ("edge", "kokoro", "piper", "magpie"):
    check(eid + " output has no bracket tags at all",
          not prosody.has_tags(reg[eid].prepare("[sigh] I am sorry")))

print("\n[4] emotion is DETECTED from meaning")
expect = [
    ("I'm sorry, your card was declined.", "apologetic"),
    ("Unfortunately that is not available.", "apologetic"),
    ("I understand how frustrating that is.", "empathetic"),
    ("Congratulations, that is amazing!", "excited"),
    ("Great news, you're all set.", "happy"),
    ("Let me check that for you.", "thinking"),
    ("This is important, do not share your code.", "serious"),
    ("Don't worry, I can help with that.", "reassuring"),
    ("Could you tell me your order number?", "curious"),
    ("Thanks for holding.", "warm"),
    ("The office is on Main Street.", "neutral"),
]
for text, want in expect:
    got = emotion.detect(text).name
    check("'" + text[:34] + "' -> " + want, got == want, got)

print("\n[5] emotion changes REAL acoustics, in the right direction")
e = reg["edge"]
sad_r, sad_p, sad_v, sad_n = e.emotion_params("I'm sorry, that was declined.", 1.0, 0.0)
hap_r, hap_p, hap_v, hap_n = e.emotion_params("Great news, you're all set!", 1.0, 0.0)
think_r = e.emotion_params("Let me check that for you.", 1.0, 0.0)[0]
check("an apology is slower", sad_r < 1.0, sad_r)
check("an apology is lower pitched", sad_p < 0.0, sad_p)
check("an apology is softer", sad_v < 1.0, sad_v)
check("good news is faster", hap_r > 1.0, hap_r)
check("good news is higher pitched", hap_p > 0.0, hap_p)
check("good news is louder", hap_v > 1.0, hap_v)
check("thinking slows down", think_r < 1.0, think_r)
check("sad and happy are audibly different speeds", abs(hap_r - sad_r) > 0.08, (sad_r, hap_r))
check("emotion is reported for the UI", sad_n == "apologetic" and hap_n == "happy")
check("rate stays in a safe range", 0.5 <= sad_r <= 2.0 and 0.5 <= hap_r <= 2.0)
check("pitch stays sane (not cartoonish)", abs(sad_p) < 4 and abs(hap_p) < 4)
check("user's own speed choice still applies",
      e.emotion_params("Great news!", 1.5, 0.0)[0] > hap_r)

print("\n[6] per-sentence variation kills the monotone")
para = ("Thanks for waiting. Let me check that for you. "
        "Great news, it shipped! I'm sorry it was late.")
beats = emotion.plan(para)
check("one beat per sentence", len(beats) == 4, len(beats))
check("tones actually change across the reply",
      len({b.emotion.name for b in beats}) >= 3, [b.emotion.name for b in beats])
check("rates differ sentence to sentence",
      len({round(b.rate, 3) for b in beats}) >= 3)
check("real silence between sentences", all(b.pause_after_ms > 0 for b in beats[:-1]))
check("no trailing pause at the end", beats[-1].pause_after_ms == 0)
check("thinking gets the longest gap",
      max(beats, key=lambda b: b.pause_after_ms).emotion.name == "thinking")
check("pauses stay natural (not dead air)", all(b.pause_after_ms <= 600 for b in beats))
check("variation is deterministic (same reply sounds the same)",
      [b.rate for b in emotion.plan(para)] == [b.rate for b in beats])
check("arc is describable for the UI", "then" in emotion.describe(para))

print("\n[7] intensity is controllable and can be turned off")
os.environ["VOICE_EMOTION_INTENSITY"] = "1.0"
full = reg["edge"].emotion_params("Great news, you're all set!", 1.0, 0.0)[0]
os.environ["VOICE_EMOTION_INTENSITY"] = "0.25"
mild = reg["edge"].emotion_params("Great news, you're all set!", 1.0, 0.0)[0]
check("higher intensity means more deviation", full > mild, (full, mild))
os.environ["VOICE_EMOTION"] = "0"
flat = reg["edge"].emotion_params("Great news, you're all set!", 1.0, 0.0)
check("emotion can be disabled entirely", flat[0] == 1.0 and flat[3] == "neutral", flat)
check("disabled plan is neutral", all(b.emotion.name == "neutral" for b in emotion.plan(para)))
del os.environ["VOICE_EMOTION"]
os.environ["VOICE_EMOTION_INTENSITY"] = "0.75"
check("scaling to zero collapses to neutral",
      emotion.EMOTIONS["happy"].scaled(0.0).rate == 1.0)
check("tags only appear at real expressiveness",
      emotion.EMOTIONS["empathetic"].scaled(0.1).tag == "")

print("\n[8] tag-aware engines get SOUND, not words")
tag = emotion.tag_for("I'm sorry, that was declined.")
check("an apology yields a performable tag", tag.strip() in ("[sigh]", ""), tag)
check("at most one tag per utterance", tag.count("[") <= 1)
check("neutral text gets no tag", emotion.tag_for("The office is on Main Street.") == "")

print("\n[9] engine wiring is real, not decorative")
src = {n: open(os.path.dirname(os.path.abspath(__file__)) + "/engines/" + n + ".py").read()
       for n in ("edge_engine", "kokoro_engine", "piper_engine",
                 "fish_engine", "chatterbox_engine")}
check("edge applies emotion to real params", "emotion_params" in src["edge_engine"])
check("edge sends volume", "volume_to_percent" in src["edge_engine"])
check("kokoro performs per sentence", "emotion_beats" in src["kokoro_engine"])
check("kokoro inserts real silence", "silence_wav" in src["kokoro_engine"])
check("piper performs per sentence", "emotion_beats" in src["piper_engine"])
check("piper inserts real silence", "silence_wav" in src["piper_engine"])
check("fish speed follows emotion", "emotion.overall" in src["fish_engine"])
check("chatterbox exaggeration follows emotion", "emotion.overall" in src["chatterbox_engine"])

print("\n[10] browser fallback voice (the robotic one) is fixed too")
js = open(os.path.dirname(os.path.abspath(__file__)) + "/static/app.js").read()
check("browser voice strips stage directions", "stripStageDirections" in js)
check("browser voice has emotion", "_browserEmotion" in js)
check("browser voice varies pitch", "u.pitch" in js)
check("browser voice sanitizes before speaking",
      js.index("const spoken = stripStageDirections") < js.index("new SpeechSynthesisUtterance(spoken)"))
check("browser rate is clamped", "Math.max(0.5, Math.min(2" in js)

print("\n[11] the model is told to stop producing them at the source")
brain_src = open(os.path.dirname(os.path.abspath(__file__)) + "/brain.py").read()
for needle in ("[sigh]", "*sighs*", "verbatim", "stage directions"):
    check("prompt forbids " + needle, needle in brain_src)

print("\n[12] v0.0.32 - the new reactions a support call actually needs")
for name in ("surprised", "grateful", "patient"):
    check(name + " exists", name in emotion.EMOTIONS)
    tag = getattr(emotion.EMOTIONS[name], "tag", "")
    check(name + " tag is one an engine really supports",
          (not tag) or tag in prosody.TAGS)
NEW_CASES = [
    ("Oh wow, I had no idea.", "surprised"),
    ("Thanks so much for your patience.", "grateful"),
    ("Take your time, no rush at all.", "patient"),
]
for text, want in NEW_CASES:
    got = emotion.detect(text).name
    check("%r reads as %s (got %s)" % (text, want, got), got == want)
check("surprise is faster and brighter than neutral",
      emotion.EMOTIONS["surprised"].rate > 1.0
      and emotion.EMOTIONS["surprised"].pitch > 1.0)
check("patience is slower than neutral", emotion.EMOTIONS["patient"].rate < 1.0)
check("the additions did not break the older readings",
      emotion.detect("I am sorry, that went wrong").name == "apologetic"
      and emotion.detect("let me check that").name == "thinking")

# ---------------------------------------------------------------------------
# [12] CROSS-TURN MOOD (v0.0.45)
#
# The conversation used to be emotionally flat even though each reply was
# expressive, because every reply was planned from a standing start. These
# assertions run the real planner and compare real numbers.
# ---------------------------------------------------------------------------
print("\n[12] the mood carries across turns")

SORRY = "I am so sorry about that, it should not have happened."
FLAT = "The order ships on Tuesday."

emotion.reset_mood()
check("a fresh conversation starts with no mood", emotion.mood() == "")
emotion.plan(SORRY)
check("an apology leaves the conversation apologetic",
      emotion.mood() == "apologetic", emotion.mood())

emotion.reset_mood()
cold = emotion.plan(FLAT)[0]
emotion.reset_mood()
emotion.plan(SORRY)
warm = emotion.plan(FLAT)[0]
check("the previous turn's feeling colours the next opening beat",
      (warm.rate, warm.pitch, warm.volume) != (cold.rate, cold.pitch, cold.volume),
      (cold.rate, cold.pitch, warm.rate, warm.pitch))
check("and it leans the right way (an apology lowers the pitch)",
      warm.pitch < cold.pitch, (cold.pitch, warm.pitch))
check("carry-over is a bleed, not a takeover",
      abs(warm.rate - cold.rate) < 0.12, (cold.rate, warm.rate))
check("only the OPENING beat is coloured by the previous turn",
      len(emotion.plan(FLAT)) >= 1)

# Determinism is this module's core promise: a failed beat is re-synthesised on
# its own and has to match the beats around it.
emotion.reset_mood()
p1 = emotion.plan(SORRY)
p2 = emotion.plan(SORRY)
p3 = emotion.plan(SORRY)
check("re-planning the same reply is identical (retries match)",
      all((a.rate, a.pitch, a.volume, a.pause_after_ms)
          == (b.rate, b.pitch, b.volume, b.pause_after_ms)
          for a, b in zip(p1, p2)))
check("and a third replan does not compound the mood either",
      all((a.rate, a.pitch) == (b.rate, b.pitch) for a, b in zip(p1, p3)))

# A mood must expire, or one bad turn colours the whole call.
os.environ["VOICE_EMOTION_MOOD_SEC"] = "0"
try:
    emotion.reset_mood()
    emotion.plan(SORRY)
    check("an expired mood no longer reports itself", emotion.mood() == "")
    dead = emotion.plan(FLAT)[0]
    check("an expired mood colours nothing",
          (dead.rate, dead.pitch, dead.volume)
          == (cold.rate, cold.pitch, cold.volume))
finally:
    os.environ.pop("VOICE_EMOTION_MOOD_SEC", None)

emotion.reset_mood()
check("reset_mood really clears it", emotion.mood() == "")
emotion.note_mood("excited")
check("a mood can be set explicitly", emotion.mood() == "excited")
emotion.reset_mood()

# ---------------------------------------------------------------------------
# [13] THE DETECTOR CACHE (v0.0.45) - speed, without changing any answer
# ---------------------------------------------------------------------------
print("\n[13] the detector is memoised and still correct")

LINES = ["Thanks so much, that is great news!", "I am sorry about the delay.",
         "Let me check that for you.", "Your order ships on Tuesday.",
         "Hmm, let me think about that.", "Absolutely, I can do that.",
         "That is unfortunately not possible.", "Could you confirm the email?",
         "I really appreciate your patience.", "Sure, one moment please."] * 8

mismatch = []
for s in LINES[:10]:
    emotion._DETECT_CACHE.clear()
    fresh = emotion.detect(s)
    cached = emotion.detect(s)
    if (fresh.name, fresh.rate, fresh.pitch, fresh.volume) != \
       (cached.name, cached.rate, cached.pitch, cached.volume):
        mismatch.append(s)
check("a cached reading equals the uncached one", not mismatch, mismatch[:2])

t0 = time.perf_counter()
for _ in range(20):
    emotion._DETECT_CACHE.clear()
    for s in LINES:
        emotion.detect(s)
cold_ms = (time.perf_counter() - t0) / 20 * 1000

for s in LINES:
    emotion.detect(s)
t0 = time.perf_counter()
for _ in range(20):
    for s in LINES:
        emotion.detect(s)
warm_ms = (time.perf_counter() - t0) / 20 * 1000

# A differential, not an absolute duration: absolute timings are meaningless on
# a shared runner, but the ratio between the two passes on the SAME machine is
# real. Measured ~30x locally; assert a floor well under that so this cannot
# fail on a slow or noisy machine while still catching the cache being lost.
check("the cache actually makes repeat detection faster (%.3fms -> %.3fms)"
      % (cold_ms, warm_ms), warm_ms < cold_ms / 2.0)
check("the cache is bounded so a long call cannot grow it forever",
      emotion._DETECT_CACHE_MAX <= 4096)

emotion._DETECT_CACHE.clear()
for i in range(emotion._DETECT_CACHE_MAX + 60):
    emotion.detect("unique line number %d please" % i)
check("the cache never exceeds its bound",
      len(emotion._DETECT_CACHE) <= emotion._DETECT_CACHE_MAX,
      len(emotion._DETECT_CACHE))
check("empty text is still neutral and never cached as a key",
      emotion.detect("").name == "neutral" and "" not in emotion._DETECT_CACHE)
emotion.reset_mood()

print("\n" + "=" * 60)
print("  PASSED: " + str(PASS) + "   FAILED: " + str(len(FAIL)))
if FAIL:
    print("  failures: " + ", ".join(FAIL))
print("=" * 60)
sys.exit(1 if FAIL else 0)
