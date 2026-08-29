#!/usr/bin/env python3
"""v0.0.44 - the agent was transcribing its own voice and posting it as your turn.

The user reported: "it is hearing what the ai told me and repeating it again in
the chat". There were TWO leaks and the v7.2 fix only closed one of them.

This suite does NOT just grep for identifiers. It extracts the real functions
from static/app.js by brace matching and EXECUTES them under node, because a
grep would happily pass on a function that is subtly wrong.
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = open(os.path.join(HERE, "static", "app.js"), encoding="utf-8").read()

PASS = 0
FAIL = 0
FAILURES = []


def check(label, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        FAILURES.append(label)


def _code(src):
    """Strip whole-line comments.

    Learned the hard way twice: a forbidden-string assertion that does not strip
    comments will trip over the comment that DOCUMENTS the bug being fixed.
    """
    out = []
    for line in src.splitlines():
        s = line.lstrip()
        if s.startswith("//"):
            continue
        out.append(line)
    return "\n".join(out)


CODE = _code(APP)


def extract(name):
    """Pull one top-level function out of app.js by counting braces."""
    m = re.search(r"function\s+" + re.escape(name) + r"\s*\(", APP)
    if not m:
        return None
    i = APP.index("{", m.end() - 1)
    depth = 0
    for j in range(i, len(APP)):
        c = APP[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return APP[m.start():j + 1]
    return None


# ---------------------------------------------------------------------------
# [1] the functions exist and are extractable
# ---------------------------------------------------------------------------
# v0.0.44: _looksLikeEcho now delegates to _looksLikeEchoIn so the async turn
# paths can test against a SNAPSHOT of what the agent said, taken before the
# turn resets the live buffer. The harness needs both halves to run.
NAMES = ("_normKey", "_noteAgentSpeech", "_forgetAgentSpeech", "_looksLikeEcho",
         "_looksLikeEchoIn")
SRCS = {}
for n in NAMES:
    s = extract(n)
    SRCS[n] = s
    check("[1] %s is defined in app.js" % n, bool(s))

if not all(SRCS.values()):
    print("\n".join("failures: " + f for f in FAILURES))
    print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
    sys.exit(1)


# ---------------------------------------------------------------------------
# [2] EXECUTE the echo test under node
# ---------------------------------------------------------------------------
# Each case: (agent sentences already spoken, what the mic reported, expect echo)
CASES = [
    # The exact reported failure: the agent's own reply coming back in.
    (["I have processed your refund of forty five dollars."],
     "I have processed your refund of forty five dollars", True),
    # Partial leak - only some of the sentence gets through the speakers.
    (["Your order will arrive in three to five business days."],
     "arrive in three to five business days", True),
    # Recognised with different casing and punctuation.
    (["Shall I send the replacement today?"],
     "shall i send the replacement today", True),
    # A genuine interruption must NOT be mistaken for echo.
    (["I have processed your refund of forty five dollars."],
     "no I wanted a replacement instead", False),
    # The most important barge-ins are single words. They must always cut in.
    (["Let me walk you through the returns policy step by step."],
     "stop", False),
    (["Let me walk you through the returns policy step by step."],
     "wait", False),
    # ...but a single word the agent JUST said is a leak.
    (["Let me walk you through the returns policy step by step."],
     "returns", True),
    # Nothing spoken yet: there cannot be an echo.
    ([], "I have processed your refund of forty five dollars", False),
    # Empty / junk input must never be called echo.
    (["Anything at all."], "", False),
    (["Anything at all."], "   ", False),
    # A question of yours that happens to share small words is not echo.
    (["Your subscription renews on the fourth of March each year."],
     "can you cancel my subscription please", False),
]

HARNESS = """
let _agentSaid = "";
%s
%s
%s
%s
const cases = %s;
const out = [];
for (const c of cases) {
  _forgetAgentSpeech();
  for (const s of c[0]) _noteAgentSpeech(s);
  out.push({ echo: _looksLikeEcho(c[1]), said: _agentSaid });
}
console.log(JSON.stringify(out));
""" % (SRCS["_normKey"], SRCS["_noteAgentSpeech"], SRCS["_forgetAgentSpeech"],
       SRCS["_looksLikeEcho"] + "\n" + SRCS["_looksLikeEchoIn"],
       json.dumps([[c[0], c[1]] for c in CASES]))

HPATH = os.path.join(HERE, "_echo_harness.js")
results = None
try:
    with open(HPATH, "w", encoding="utf-8") as fh:
        fh.write(HARNESS)
    proc = subprocess.run(["node", HPATH], capture_output=True, text=True, timeout=60)
    check("[2] the echo harness runs under node", proc.returncode == 0)
    if proc.returncode != 0:
        FAILURES.append("[2] node stderr: " + (proc.stderr or "")[:300])
    else:
        results = json.loads(proc.stdout.strip().splitlines()[-1])
except Exception as exc:  # pragma: no cover - environment problem
    check("[2] the echo harness runs under node", False)
    FAILURES.append("[2] harness error: %r" % (exc,))
finally:
    try:
        os.remove(HPATH)
    except OSError:
        pass

if results:
    check("[2] every case produced a verdict", len(results) == len(CASES))
    for (said, heard, want), got in zip(CASES, results):
        check("[2] %r heard while we said %r -> echo=%s"
              % (heard[:44], (said[0][:28] if said else "nothing"), want),
              got["echo"] is want)

    # Forgetting must genuinely clear the record, or a caller who later repeats
    # the agent's wording on purpose would be silently ignored.
    check("[2] _forgetAgentSpeech clears the record",
          results[7]["said"] == "")
    check("[2] _noteAgentSpeech records normalised words",
          "refund" in results[0]["said"] and "$" not in results[0]["said"])


# ---------------------------------------------------------------------------
# [3] LEAK ONE: the browser recogniser must not commit words before judging them
# ---------------------------------------------------------------------------
RES = re.search(r"recognition\.onresult\s*=\s*\(ev\)\s*=>\s*\{(.*?)\n  \};", CODE, re.S)
check("[3] the onresult handler is present", bool(RES))
BODY = RES.group(1) if RES else ""

# THE BUG: `if (ev.results[i].isFinal) _finalBuf += ...` inside the read loop
# committed the agent's own words to the user's turn before anything checked
# whether they were the user's at all.
check("[3] finals are not committed inside the read loop",
      "isFinal) _finalBuf" not in BODY and "isFinal) { _finalBuf" not in BODY)
check("[3] finals from this event are held in a local first",
      re.search(r"isFinal\)\s*fresh\s*\+=", BODY) is not None)
check("[3] the echo test runs while the agent is speaking",
      "_rejectEcho(" in BODY)
REJ = extract("_rejectEcho") or ""
check("[3] _rejectEcho consults the echo test", "_looksLikeEcho(" in REJ)
check("[3] rejecting echo never strands real words already captured",
      "_scheduleEndpoint()" in REJ)
# The echo test must see THIS EVENT only. Run on the whole accumulated turn,
# real words said earlier would dilute the overlap and let the leak through.
check("[3] the echo test is fed this event's words, not the whole turn",
      "_rejectEcho(fresh, interim)" in BODY)
check("[3] barge-in still stops playback for real words",
      "stopSpeaking()" in BODY)

# Order matters: echo must be rejected BEFORE anything is committed or playback
# is stopped, otherwise our own voice still interrupts us mid-sentence.
i_echo = BODY.find("_rejectEcho(")
i_stop = BODY.find("stopSpeaking()")
i_commit = BODY.find("_finalBuf +=")
check("[3] echo is rejected before playback is stopped",
      i_echo >= 0 and i_stop >= 0 and i_echo < i_stop)
check("[3] echo is rejected before any word is committed",
      i_echo >= 0 and i_commit >= 0 and i_echo < i_commit)

# Backchannel suppression is judged on the WHOLE accumulated turn, not on this
# event alone. My first attempt at this fix judged the event only, which would
# have discarded a "yeah" while leaving real words said a moment earlier
# stranded in the buffer with nothing left to submit them - a turn that is heard
# and then never answered. Clearing the buffer is correct only because reaching
# that branch means the entire turn is noise.
check("[3] a backchannel is still suppressed rather than sent",
      "_BACKCHANNEL.test(shown)" in BODY)
check("[3] the backchannel verdict is taken on the whole turn",
      re.search(r"const shown = \(_finalBuf \+ \" \" \+ fresh", BODY) is not None)
check("[3] the display is drawn from what was actually kept",
      "const display = (_finalBuf" in BODY)


# ---------------------------------------------------------------------------
# [4] LEAK TWO: the uploaded audio must not contain the agent's voice
# ---------------------------------------------------------------------------
REC = re.search(r"_recorder\.ondataavailable\s*=\s*\(e\)\s*=>\s*\{(.*?)\n  \};", CODE, re.S)
check("[4] the recorder data handler is present", bool(REC))
RBODY = REC.group(1) if REC else ""
check("[4] chunks recorded during playback are dropped",
      "if (state.speaking) return;" in RBODY)
# The guard is worthless if it sits after the push.
g = RBODY.find("if (state.speaking) return;")
p = RBODY.find("_chunks.push(")
check("[4] the playback guard runs before the chunk is stored",
      g >= 0 and p >= 0 and g < p)
check("[4] the memory cap on long calls is still enforced",
      "_chunks.splice(" in RBODY)

# The model-path guard from v7.2 must still be there; this release adds to it,
# it does not replace it.
check("[4] the live model tick is still gated on playback",
      CODE.count("if (state.speaking) return;") >= 2)


# ---------------------------------------------------------------------------
# [5] the record of our own speech is kept and cleared in the right places
# ---------------------------------------------------------------------------
check("[5] our words are recorded as they are queued to speak",
      "_noteAgentSpeech(sentence)" in CODE)
check("[5] the record is cleared when your turn is submitted",
      "_forgetAgentSpeech()" in CODE)
check("[5] the record is bounded so a long call cannot grow it forever",
      "slice(-700)" in CODE)

SUB = re.search(r"function _submitTurn\(\)\s*\{(.*?)\n\}", CODE, re.S)
check("[5] _submitTurn is present", bool(SUB))
if SUB:
    check("[5] the record is cleared inside _submitTurn",
          "_forgetAgentSpeech()" in SUB.group(1))


# ---------------------------------------------------------------------------
# [6] the browser fallback voice admits it cannot do emotion
# ---------------------------------------------------------------------------
# "i do not think there is emotions at all" is the expected outcome when this
# path is the one speaking: it has no pitch contour, no emphasis and no emotion
# rendering whatsoever. The UI must say so rather than look broken.
check("[6] the fallback voice is labelled as having no emotion support",
      "no emotion support" in CODE)
check("[6] the label still names what is speaking",
      "browser fallback voice" in CODE)

SRV = open(os.path.join(HERE, "server.py"), encoding="utf-8").read()
check("[6] version bumped", 'VERSION = "0.0.51"' in SRV)


if FAILURES:
    print("failures: " + "; ".join(FAILURES))
print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
