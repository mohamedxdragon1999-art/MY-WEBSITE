"""v7.3 - brain instructions and emotion detection, tested by EXECUTION.

The emotion bug fixed in this version (a short cue shadowing a longer, more
specific one) was invisible to string-matching tests: the table looked fine and
the function returned the wrong answer. So this suite calls detect() for real.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import brain                                    # noqa: E402
from engines import emotion, prosody            # noqa: E402

PASS = 0
FAIL = 0
fails = []


def check(label, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        fails.append(label)


P = brain.SYSTEM_PROMPT

print("[1] the brain knows its input came from a microphone")
check("misheard-word handling is instructed", "MISHEARD WORDS" in P)
for phrase in ("garbled", "do NOT confidently answer", "invent details",
               "one short, natural clarifier"):
    check("instructs: " + phrase, phrase in P)
# It must not leak machine vocabulary into a phone call.
for leak in ("transcript", "speech recognition"):
    check("forbids saying '%s' out loud" % leak, leak in P)
check("but is told not to be pedantic about one doubtful word",
      "do not be pedantic" in P)

print("\n[2] real phone-call turn-taking is instructed")
check("turn-taking section exists", "TURN-TAKING" in P)
for phrase in ("mm-hm", "NOT a new question", "do NOT restart from",
               "Never repeat a sentence", "still thinking"):
    check("instructs: " + phrase, phrase in P)

print("\n[3] read-back and dead-air instructions")
check("read-back section exists", "READ-BACK" in P)
check("spells ambiguous letters", "m for Mike" in P)
check("confirms in the same breath", "is that right?" in P)
check("waiting out loud beats silence", "WAITING" in P)
check("explains why silence is bad on a call", "dropped" in P)

print("\n[4] the stage-direction ban survived the additions")
# v6.1's most important rule. Adding sections must never dilute it.
check("stage directions still banned", "never write stage directions" in P)
check("still explains every character is read aloud", "read aloud verbatim" in P)
check("speed rule still present", "SPEED:" in P)
check("emotion rule still present", "EMOTION:" in P)
check("numbers rule still present", "NUMBERS:" in P)
check("no markdown rule still present", "Never use markdown" in P)

print("\n[5] the prompt is still a sane size for every request")
# The system prompt is sent on EVERY turn, so bloat costs latency and tokens.
# v0.0.44 raised this: the caller reported being asked to clarify things that
# had been heard correctly, and asked for spoken read-back of details like an
# email address or phone number. Both needed explicit rules. The ceiling exists
# to stop the prompt bloating into latency, so it moves deliberately, not freely.
check("prompt is under 8000 chars", len(P) < 8000)
check("over-clarifying is explicitly forbidden", "DO NOT OVER-CLARIFY" in P)
check("exact details get read back and confirmed", "IMPORTANT DETAILS" in P)
check("read-back is spelled out", "spelled out" in P)
check("a confirmed detail is never asked for twice", "NEVER ask for it again" in P)
check("prompt actually grew this version", len(P) > 4000)

print("\n[6] THE BUG: a short cue must not shadow a longer one")
# "i can't" is an apologetic cue and appears FIRST in _CUES; "can't wait" is an
# excited cue further down. Before v7.3 the enthusiastic line was spoken sadly.
check("'I can't wait to help!' is excited, not apologetic",
      emotion.detect("I can't wait to help!").name == "excited")
check("'I can't do that' is still apologetic",
      emotion.detect("I can't do that").name == "apologetic")

print("\n[7] emotion detection still gets the ordinary cases right")
CASES = [
    ("I'm sorry, something went wrong", "apologetic"),
    ("Great news, you're all set", "happy"),
    ("Let me check that for you", "thinking"),
    ("I understand, that must be frustrating", "empathetic"),
    ("Congratulations, that's fantastic", "excited"),
    ("This is important, please note", "serious"),
    ("Don't worry, I'll take care of it", "reassuring"),
    ("Thanks, good morning", "warm"),
    ("Which one did you mean?", "curious"),
]
for text, want in CASES:
    got = emotion.detect(text).name
    check("%r -> %s" % (text[:34], want), got == want)
    if got != want:
        print("    got %s" % got)

check("empty text is neutral", emotion.detect("").name == "neutral")
check("None is safe", emotion.detect(None).name == "neutral")
check("a plain question falls back to curious",
      emotion.detect("what time is the appointment?").name == "curious")

print("\n[8] detection is deterministic and total")
# Same input must always give the same voice: a reply that sounds different on
# a retry is a worse experience than one that is consistently plain.
for text, _ in CASES:
    check("stable: %r" % text[:26],
          emotion.detect(text).name == emotion.detect(text).name)
for name in emotion.EMOTIONS:
    check("every emotion is a real Emotion: " + name,
          hasattr(emotion.EMOTIONS[name], "rate"))

print("\n[9] every tag we can emit is one a real engine supports")
# Inventing tags is worse than having none: an unsupported tag is either
# ignored or READ ALOUD, which is the v6.1 "it said the word sigh" bug.
for name, emo in emotion.EMOTIONS.items():
    if getattr(emo, "tag", ""):
        check("%s uses a supported tag (%s)" % (name, emo.tag),
              emo.tag in prosody.TAGS)

print("\n[10] the emotion layer never leaks a tag into a non-tag engine")
spoken = prosody.humanize("Great news, you're all set!", tags=False)
check("no bracket tags survive for plain engines", "[" not in spoken)
check("the words themselves survive", "all set" in spoken.lower())

print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
if fails:
    print("failures: " + "; ".join(fails))
sys.exit(1 if FAIL else 0)
