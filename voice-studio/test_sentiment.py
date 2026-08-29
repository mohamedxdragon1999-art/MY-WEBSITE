"""Tests for the v50 sentiment -> emotion layer.

These lock in the three behaviours that were actually requested:
  1. sad content is delivered a bit sadly,
  2. good content is delivered a bit happily,
  3. boring content is delivered NORMALLY - not bored.

(3) is the one that is easy to get wrong and hard to notice, so it gets the
most tests. A "bored" delivery is an active choice (slower, lower, quieter);
neutral is the absence of one. They are different sounds.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engines import emotion, sentiment  # noqa: E402

PASSED = 0
FAILED = 0
_failures = []


def check(label, cond, extra=""):
    global PASSED, FAILED
    if cond:
        PASSED += 1
    else:
        FAILED += 1
        _failures.append(label + (("  -> " + str(extra)) if extra else ""))


def section(name):
    print("\n== " + name + " " + "=" * max(0, 56 - len(name)))


# ---------------------------------------------------------------------------
section("lexicon and polarity")

check("positive word reads positive", sentiment.read("this is wonderful").valence > 0.3)
check("negative word reads negative", sentiment.read("this is terrible").valence < -0.3)
check("unknown words read exactly zero",
      sentiment.read("the widget is on the shelf").valence == 0.0)
check("empty text is neutral", sentiment.read("").confidence == 0.0)
check("whitespace is neutral", sentiment.read("   ").confidence == 0.0)
check("none-safe", sentiment.read(None).confidence == 0.0)

# The gap that only showed up by running the scorer.
check("'bad' is in the lexicon", sentiment.read("that is bad").valence < -0.3)
check("'good' is in the lexicon", sentiment.read("that is good").valence > 0.3)

# ---------------------------------------------------------------------------
section("negation")

r_good = sentiment.read("this is good")
r_notgood = sentiment.read("this is not good")
check("negation flips sign", r_good.valence > 0 and r_notgood.valence < 0,
      (r_good.valence, r_notgood.valence))
check("negation is damped, not mirrored",
      abs(r_notgood.valence) < abs(r_good.valence),
      (r_good.valence, r_notgood.valence))
check("'not bad' is mildly positive", sentiment.read("that is not bad").valence > 0)
check("contraction negators work", sentiment.read("it isn't working").valence < 0)
check("cannot negates", sentiment.read("we cannot fix this").valence < 0)
# Negation must not reach across a whole sentence.
check("negation window is bounded",
      sentiment.read("not really sure about any of that, it was wonderful").valence > 0)

# ---------------------------------------------------------------------------
section("intensifiers and diminishers")

base = sentiment.read("this is good").valence
strong = sentiment.read("this is very good").valence
weak = sentiment.read("this is slightly good").valence
check("intensifier raises magnitude", strong > base, (base, strong))
check("diminisher lowers magnitude", weak < base, (base, weak))
check("intensifier works on negatives",
      sentiment.read("this is extremely bad").valence
      < sentiment.read("this is bad").valence)
check("valence stays in range",
      -1.0 <= sentiment.read("absolutely extremely terrible").valence <= 1.0)

# ---------------------------------------------------------------------------
section("contrast: what comes after 'but' is what is meant")

r = sentiment.read("it was late and broken, but it is fixed and working now")
check("post-contrast clause dominates", r.valence > 0, r.valence)
r2 = sentiment.read("the price is great, but the service was terrible")
check("negative after contrast dominates", r2.valence < 0, r2.valence)
check("no contrast marker still works",
      sentiment.read("the service was terrible").valence < 0)

# ---------------------------------------------------------------------------
section("arousal")

check("exclamation raises arousal",
      sentiment.read("this is great!!").arousal
      > sentiment.read("this is great").arousal)
check("shouting raises arousal",
      sentiment.read("THIS IS COMPLETELY BROKEN").arousal
      > sentiment.read("this is completely broken").arousal)
check("arousal stays in range",
      0.0 <= sentiment.read("AMAZING!!! INCREDIBLE!!!").arousal <= 1.0)
check("punctuation alone invents no valence",
      sentiment.read("your order number is 5512!").valence == 0.0)

# ---------------------------------------------------------------------------
section("REQUIREMENT: boring text stays normal, never bored")

BORING = [
    "Your order number is 5512 and it ships on Tuesday.",
    "The account balance is 240 dollars.",
    "The meeting is at 3pm in room 4.",
    "Please enter the code shown on your screen.",
    "Your reference is AB-99120.",
    "The office is open from nine until five.",
    "There are twelve items in the basket.",
    "The file is 4 megabytes.",
]
for t in BORING:
    check("boring -> neutral: " + t[:34], sentiment.emotion_name(t) == "neutral",
          sentiment.describe(t))
    check("boring -> untouched voice: " + t[:28],
          emotion.detect(t).name == "neutral", emotion.detect(t).name)

# Neutral must be an genuinely untouched voice, not a slowed-down one.
n = emotion.EMOTIONS["neutral"]
check("neutral rate is exactly 1.0", n.rate == 1.0, n.rate)
check("neutral pitch is exactly 0", n.pitch == 0.0, n.pitch)
check("neutral volume is exactly 1.0", n.volume == 1.0, n.volume)

# My first version of this test asserted that no returnable emotion may be
# slow AND low AND quiet at once. That was WRONG, and running it proved it:
# "empathetic" is exactly that (0.93, -1.0, 0.97), and it should be - people
# do slow down and soften for bad news. Softness is not boredom.
#
# The real requirement is not about the acoustics of any single emotion, it is
# about WHEN a soft one is allowed to be chosen: never on unremarkable text.
# That is what actually distinguishes an empathetic agent from a bored one.
SOFT = ("empathetic", "concerned", "serious", "apologetic", "calm", "patient")
for t in BORING:
    check("boring never gets a soft delivery: " + t[:24],
          sentiment.emotion_name(t) not in SOFT, sentiment.emotion_name(t))

# A soft emotion may only be reached with genuinely negative valence.
for v in range(0, 11):
    nm = sentiment.name_for(sentiment.Reading(v / 10.0, 0.4, 1.0, 3))
    check("non-negative valence never sounds down (v=%.1f)" % (v / 10.0),
          nm not in SOFT, nm)

# The emotion table must not contain a bored-sounding option at all.
check("no 'bored' emotion exists", "bored" not in emotion.EMOTIONS)
check("no 'bored' name is reachable",
      all(sentiment.name_for(sentiment.Reading(v / 10.0, a / 10.0, 1.0, 3)) != "bored"
          for v in range(-10, 11) for a in range(0, 11)))

# ---------------------------------------------------------------------------
section("REQUIREMENT: sad content sounds a bit sad")

SAD = [
    "The refund was rejected and the money is gone.",
    "Your data was lost and we cannot recover it.",
    "The payment failed again.",
    "Your account has been suspended.",
    "The service was slow and unhelpful.",
]
SAD_OK = ("empathetic", "concerned", "serious", "apologetic", "calm", "patient")
for t in SAD:
    nm = emotion.detect(t).name
    check("sad -> softer delivery: " + t[:32], nm in SAD_OK, nm)
    check("sad is not cheerful: " + t[:32],
          nm not in ("happy", "excited", "amused"), nm)

# "a bit" - mild bad news must not get the heaviest emotion.
mild = emotion.detect("There is a slight delay on the delivery.").name
heavy = emotion.detect("Your data was lost and we cannot recover it.").name
check("mild bad news is gentler than severe", mild != heavy, (mild, heavy))
check("severe bad news slows down", emotion.EMOTIONS[heavy].rate < 1.0)

# ---------------------------------------------------------------------------
section("REQUIREMENT: good content sounds a bit happy")

GOOD = [
    "Everything is working and your refund was approved.",
    "Your upgrade completed successfully.",
    "The issue is resolved and your account is active.",
]
for t in GOOD:
    nm = emotion.detect(t).name
    check("good -> brighter delivery: " + t[:30],
          nm in ("warm", "happy", "excited", "encouraging", "confident",
                 "reassuring", "grateful"), nm)
    check("good is not gloomy: " + t[:30],
          nm not in ("empathetic", "apologetic", "concerned"), nm)

# Graded: stronger good news must not be quieter than milder good news.
mild_g = emotion.EMOTIONS[sentiment.name_for(sentiment.Reading(0.25, 0.3, 1.0, 2))]
strong_g = emotion.EMOTIONS[sentiment.name_for(sentiment.Reading(0.75, 0.8, 1.0, 3))]
check("stronger positive is more energetic", strong_g.rate >= mild_g.rate,
      (mild_g.name, strong_g.name))
check("mild positive is not full excitement", mild_g.name != "excited", mild_g.name)

# ---------------------------------------------------------------------------
section("graded selection across the whole range")

check("very strong + loud -> excited",
      sentiment.name_for(sentiment.Reading(0.9, 0.9, 1.0, 3)) == "excited")
check("strong calm positive is not excited",
      sentiment.name_for(sentiment.Reading(0.9, 0.1, 1.0, 3)) != "excited")
check("clear positive -> happy",
      sentiment.name_for(sentiment.Reading(0.5, 0.4, 1.0, 3)) == "happy")
check("mild positive -> warm",
      sentiment.name_for(sentiment.Reading(0.25, 0.3, 1.0, 3)) == "warm")
check("mild negative -> serious",
      sentiment.name_for(sentiment.Reading(-0.2, 0.3, 1.0, 3)) == "serious")
check("clear negative -> concerned",
      sentiment.name_for(sentiment.Reading(-0.4, 0.4, 1.0, 3)) == "concerned")
check("strong negative -> empathetic",
      sentiment.name_for(sentiment.Reading(-0.8, 0.5, 1.0, 3)) == "empathetic")
check("dead centre -> neutral",
      sentiment.name_for(sentiment.Reading(0.0, 0.0, 1.0, 3)) == "neutral")

# Low confidence must always win, at any valence.
for v in (-0.9, -0.5, 0.0, 0.5, 0.9):
    check("low confidence -> neutral (v=%.1f)" % v,
          sentiment.name_for(sentiment.Reading(v, 0.5, 0.05, 1)) == "neutral")

# ---------------------------------------------------------------------------
section("cues keep priority over the statistical read")

# The hand-tuned cue list is high precision and must not be overruled.
check("'i'm sorry' stays apologetic",
      emotion.detect("I'm sorry about that.").name == "apologetic")
check("'let me check' stays thinking",
      emotion.detect("Let me check that for you.").name == "thinking")
check("'congratulations' stays excited",
      emotion.detect("Congratulations!").name == "excited")
check("'take your time' stays patient",
      emotion.detect("Take your time.").name == "patient")

# ---------------------------------------------------------------------------
section("determinism and safety")

for t in ["the refund failed", "wonderful news", "order 12 ships today"]:
    a = sentiment.read(t)
    b = sentiment.read(t)
    check("deterministic: " + t[:26],
          (a.valence, a.arousal, a.confidence) == (b.valence, b.arousal, b.confidence))

check("every returned name is a real emotion",
      all(sentiment.name_for(sentiment.Reading(v / 10.0, a / 10.0, 1.0, 3))
          in emotion.EMOTIONS
          for v in range(-10, 11) for a in range(0, 11)))

# Long and adversarial inputs must not explode.
check("long text is handled", sentiment.read("terrible " * 2000).valence < 0)
check("punctuation soup is safe", sentiment.read("!!!???...***").confidence == 0.0)
check("unicode is safe", sentiment.read("caf\u00e9 \u2014 great \u2764").valence > 0)
check("numbers only is neutral", sentiment.emotion_name("1 2 3 4 5") == "neutral")

# The planner must still work end to end with the new layer underneath.
beats = emotion.plan("The payment failed. We have now fixed it and refunded you.")
check("planner still returns beats", len(beats) == 2, len(beats))
check("planner beats carry emotion", all(b.emotion.name in emotion.EMOTIONS for b in beats))
check("describe() works", isinstance(
    emotion.describe("The payment failed. It is fixed now."), str))

# ---------------------------------------------------------------------------
print("\n" + "=" * 60)
for f in _failures:
    print("  FAIL " + f)
print("PASSED: %d   FAILED: %d" % (PASSED, FAILED))
sys.exit(1 if FAILED else 0)
