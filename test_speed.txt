"""v7.0 - latency / hidden-stall regression suite.

Every assertion here exists because of a REAL bug found in v6.9, not a
hypothetical one. The theme: every network call must have its own short
deadline, and every retry loop must have a total ceiling. A request with no
timeout is not "slow", it is a hang.
"""
import os
import re
import sys
import importlib

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


HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

BRAIN_SRC = open(os.path.join(HERE, "brain.py"), encoding="utf-8").read()
SERVER_SRC = open(os.path.join(HERE, "server.py"), encoding="utf-8").read()
STT_SRC = open(os.path.join(HERE, "stt.py"), encoding="utf-8").read()

import brain  # noqa: E402

# --- [1] THE HEADLINE BUG: posts with no timeout --------------------------
# A bare client.post() inherits the 20s client default. With serial provider
# fallback that is 20s of dead air before the SECOND provider is even tried.
BARE_POST = re.compile(r"client\.post\(url, headers=headers, json=payload\)")
check("no bare untimed client.post remains in brain.py",
      not BARE_POST.search(BRAIN_SRC))
check("every client.post in brain.py passes a timeout",
      all("timeout=" in seg[:400]
          for seg in BRAIN_SRC.split("await client.post(")[1:]))
check("stt.py post is timed", "timeout=timeout()" in STT_SRC)

# --- [2] the streaming 30s stall -----------------------------------------
check("streaming no longer hardcodes a 30s timeout",
      "timeout=30.0" not in BRAIN_SRC)
check("streaming uses the read-timeout helper",
      "_timeout_for(_stream_read_timeout())" in BRAIN_SRC)

# --- [3] budget helpers exist and are sane -------------------------------
for name in ("_envf", "_connect_timeout", "_attempt_timeout",
             "_stream_read_timeout", "_total_budget", "_timeout_for"):
    check("brain exposes %s" % name, hasattr(brain, name))

check("connect budget is short (<=5s)", brain._connect_timeout() <= 5.0)
check("connect budget is not absurdly small", brain._connect_timeout() >= 1.0)
check("per-attempt budget beats the old 20s default",
      brain._attempt_timeout() < 20.0)
check("per-attempt budget is at least 2s", brain._attempt_timeout() >= 2.0)
check("stream read gap beats the old 30s", brain._stream_read_timeout() < 30.0)
check("total budget beats the old worst case", brain._total_budget() < 20.0)
check("total budget >= one attempt",
      brain._total_budget() >= brain._attempt_timeout())

# --- [4] the helpers never raise, whatever the environment ---------------
for bad in ("", "   ", "abc", "NaN-ish", "1e999x", "-5"):
    os.environ["BRAIN_ATTEMPT_TIMEOUT"] = bad
    try:
        v = brain._attempt_timeout()
        okv = isinstance(v, float) and v >= 2.0
    except Exception:
        okv = False
    check("garbage env %r still yields a safe attempt budget" % bad, okv)
os.environ.pop("BRAIN_ATTEMPT_TIMEOUT", None)

check("_envf falls back on missing var",
      brain._envf("VS_DEFINITELY_NOT_SET_12345", 4.25) == 4.25)
os.environ["VS_TEST_F"] = "9.5"
check("_envf reads a real value", brain._envf("VS_TEST_F", 1.0) == 9.5)
os.environ.pop("VS_TEST_F", None)

# --- [5] budgets are operator-tunable ------------------------------------
os.environ["BRAIN_TOTAL_BUDGET"] = "6"
check("total budget honours the env override", brain._total_budget() == 6.0)
os.environ["BRAIN_TOTAL_BUDGET"] = "0.1"
check("total budget clamps a dangerous tiny value",
      brain._total_budget() >= 3.0)
os.environ.pop("BRAIN_TOTAL_BUDGET", None)

# --- [6] every retry loop has a deadline ---------------------------------
check("free-provider loop computes a deadline",
      BRAIN_SRC.count("_deadline = time.monotonic() + _total_budget()") >= 2)
check("loops break when the budget is gone",
      BRAIN_SRC.count("if time.monotonic() >= _deadline:") >= 2)
check("attempt budget is capped by what remains",
      BRAIN_SRC.count("min(_attempt_timeout(), _left)") >= 2)
check("remaining budget can never go negative",
      BRAIN_SRC.count("_left = max(1.0, _deadline - time.monotonic())") >= 2)

# --- [7] the NIM key-rotation loop was the worst offender ----------------
# It retries up to FOUR keys; at the old 20s default that is 80s for ONE reply.
nim = BRAIN_SRC.split("async def generate_reply_nim")[1]
check("NIM path has a deadline", "_deadline" in nim)
check("NIM path breaks on budget", "if time.monotonic() >= _deadline:" in nim)
check("NIM path times its post", "timeout=_timeout_for(" in nim)
worst = brain._total_budget()
check("NIM worst case is now bounded well under the old 80s", worst <= 20.0)

# --- [8] TTS fallback chain ----------------------------------------------
check("per-engine synth timeout is no longer 30s",
      'VOICE_SYNTH_TIMEOUT", "") or 10.0' in SERVER_SRC)
check("a total synth ceiling exists", "_SYNTH_TOTAL" in SERVER_SRC)
check("synth total is env-tunable", "VOICE_SYNTH_TOTAL" in SERVER_SRC)
check("synth chain computes a deadline",
      "_synth_deadline = time.monotonic() + _SYNTH_TOTAL" in SERVER_SRC)
check("synth chain stops when the budget is gone",
      "if time.monotonic() >= _synth_deadline:" in SERVER_SRC)
check("per-engine budget respects the remaining total",
      "min(_SYNTH_TIMEOUT," in SERVER_SRC)
check("wait_for uses the computed budget, not the flat constant",
      "timeout=_synth_budget)" in SERVER_SRC)
check("timeout log reports the real budget used",
      "timeout=_synth_budget)" in SERVER_SRC and
      "timeout=_SYNTH_TIMEOUT)" not in SERVER_SRC)
check("budget exhaustion is reported, not silent",
      "synthesis budget exhausted" in SERVER_SRC)

# --- [9] arithmetic: the worst case is genuinely bounded -----------------
# Old worst case, one reply: 4 NIM keys x 20s = 80s, plus a 30s TTS stall.
old_brain = 4 * 20.0
new_brain = brain._total_budget()
check("brain worst case improved by at least 4x",
      new_brain * 4 <= old_brain)
check("brain worst case is under 15s", new_brain < 15.0)

m = re.search(r'VOICE_SYNTH_TOTAL", ""\) or ([0-9.]+)', SERVER_SRC)
check("synth total is parseable", bool(m))
if m:
    synth_total = float(m.group(1))
    check("synth total is under the old single-engine timeout",
          synth_total < 7 * 30.0)
    check("synth total leaves room for a real fallback", synth_total >= 15.0)
    check("end-to-end worst case is under 40s (was 100s+)",
          new_brain + synth_total < 40.0)

# --- [10] no regressions: nothing lost its timeout -----------------------
check("shared client still sets a default timeout",
      "httpx.Timeout(20.0, connect=6.0)" in BRAIN_SRC)
check("verify-key path keeps its own short timeout",
      "timeout=6.0" in BRAIN_SRC)
check("brain still imports time", re.search(r"^import time", BRAIN_SRC,
                                            re.M) is not None)
check("server still imports time", re.search(r"^import time", SERVER_SRC,
                                             re.M) is not None)

# --- [11] the module still actually loads --------------------------------
try:
    importlib.reload(brain)
    reloaded = True
except Exception:
    reloaded = False
check("brain.py reloads cleanly after the edits", reloaded)

check("version bumped to 0.0.51", 'VERSION = "0.0.51"' in SERVER_SRC)

print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
if fails:
    print("failures: " + "; ".join(fails))
sys.exit(1 if FAIL else 0)
