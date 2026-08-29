"""v7.1 - FUNCTIONAL proof that word capture no longer commits wrong words.

Every other suite in this project reads the source and pattern-matches it.
This one actually EXECUTES the capture algorithm in node and checks what it
produces, because the v6.7 bug was a behaviour bug: the code looked correct
and did the wrong thing.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

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
JS = open(os.path.join(HERE, "static", "app.js"), encoding="utf-8").read()


def extract(name, src):
    """Pull one top-level function out of app.js by brace matching."""
    i = src.index("function " + name + "(")
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[i:j + 1]
    raise ValueError(name)


normword = re.search(r"const _normWord = [^;]+;", JS).group(0)
countwords = re.search(r"const _countWords = [^;]+;", JS).group(0)
stable = extract("_stablePrefix", JS)
holdback = int(re.search(r"LIVE_HOLDBACK_WORDS = (\d+)", JS).group(1))
passes = int(re.search(r"LIVE_AGREE_PASSES = (\d+)", JS).group(1))

CASES = [
    # (label, hypotheses, holdback, expected stable prefix)
    ("identical hypotheses commit all but the held-back tail",
     ["i want to book a flight", "i want to book a flight",
      "i want to book a flight"], 2, "i want to book"),

    # THE REPORTED BUG. Two truncated windows cut at the same point produce
    # the SAME wrong final word. Pairwise agreement called that confirmation.
    # The holdback is what stops it becoming permanent.
    ("a repeated wrong trailing word is NOT committed",
     ["i want to buy a", "i want to buy a", "i want to buy a"], 2,
     "i want to"),

    ("disagreement stops the prefix at the first conflict",
     ["i want to book a flight", "i want to cook a flight",
      "i want to book a flight"], 0, "i want to"),

    ("one dissenting pass blocks the word (3-way, not 2-way)",
     ["call me tomorrow", "call me tomorrow", "call me today"], 0,
     "call me"),

    ("case and punctuation differences are not disagreements",
     ["Hello, there friend", "hello there friend", "HELLO there friend"], 0,
     "HELLO there friend"),

    ("holdback larger than the agreed run commits nothing",
     ["yes ok", "yes ok", "yes ok"], 5, ""),

    ("empty hypotheses are safe", ["", "", ""], 2, ""),

    ("a shorter later pass cannot invent words",
     ["i would like a refund please", "i would like", "i would like a"], 0,
     "i would like"),

    ("whitespace noise does not shift alignment",
     ["  book   a   table ", "book a table", "book a table"], 0,
     "book a table"),
]

harness = [normword, countwords, stable, "const OUT = [];"]
for label, hyps, hb, _exp in CASES:
    harness.append("OUT.push(_stablePrefix(%s, %d));"
                   % (json.dumps(hyps), hb))
harness.append("console.log(JSON.stringify(OUT));")

with tempfile.TemporaryDirectory() as td:
    p = os.path.join(td, "h.js")
    with open(p, "w", encoding="utf-8") as f:
        f.write("\n".join(harness))
    proc = subprocess.run(["node", p], capture_output=True, text=True)

print("[1] the algorithm actually runs")
check("node executed the extracted capture code", proc.returncode == 0)
if proc.returncode != 0:
    print(proc.stderr[:800])
    print("\nPASSED: %d FAILED: %d" % (PASS, FAIL + 1))
    sys.exit(1)

got = json.loads(proc.stdout.strip().splitlines()[-1])
check("every case produced a result", len(got) == len(CASES))

print("\n[2] behaviour, executed - not pattern matched")
for (label, hyps, hb, exp), actual in zip(CASES, got):
    check(label + " -> %r" % exp, actual == exp)
    if actual != exp:
        print("    expected %r got %r  from %r" % (exp, actual, hyps))

print("\n[3] the shipped settings are the safe ones")
check("holdback is at least 1 word", holdback >= 1)
check("holdback is not so large it stalls commits", holdback <= 4)
check("agreement needs 3+ passes", passes >= 3)

# With N passes at LIVE_MS apart, a word is only committed after it has been
# seen in N windows - that is the latency price of being right. Keep it sane.
live_ms = int(re.search(r"LIVE_MS = (\d+)", JS).group(1))
check("confirmation delay stays under 2.5s", live_ms * passes <= 2500)

print("\n[4] the corrupt-audio bug cannot come back")
check("no header+tail splice anywhere", "[_chunks[0]].concat" not in JS)
check("no sliding tail constant", "LIVE_TAIL_CHUNKS" not in JS)
win = extract("_liveWindowBlob", JS)
check("the uploaded window is a true prefix", "_chunks.slice(0)" in win)
check("oversized turns stop speculating", "_liveOverflow" in win)

print("\n[5] v7.2 - it cannot transcribe its own voice")
tick = extract("_liveTick", JS)
check("live capture pauses while the agent speaks",
      "state.speaking" in tick and "return" in tick)
# The guard must be an early bail, BEFORE any upload work is scheduled.
check("the speaking guard runs before the window is built",
      tick.index("state.speaking") < tick.index("_liveWindowBlob"))
check("barge-in is not broken: the VAD loop is independent of it",
      "state.speaking" not in extract("_vadLoop", JS))

print("\n[6] v7.2 - audio fidelity is high enough to tell consonants apart")
bitrate = int(re.search(r"audioBitsPerSecond: (\d+)", JS).group(1))
check("opus bitrate is at least 64kbps", bitrate >= 64000)
check("bitrate is not wastefully high", bitrate <= 128000)
mic = extract("ensureMic", JS)
for want in ("echoCancellation: true", "noiseSuppression: true",
             "autoGainControl: true", "channelCount: 1", "sampleRate: 16000"):
    check("mic asks for " + want, want in mic)

print("\n[7] v0.0.32 - the browser recogniser may never override the model")
best = extract("_bestTranscript", JS)
# The length heuristic swapped in a DIFFERENT engine's words on terse speech.
check("length-based browser override is gone",
      "Math.ceil(bw / 2)" not in best and "bw >= 3" not in best)
check("browser text used only when the model returned nothing",
      "if (!m) return b;" in best)
check("model text always wins when present", best.rstrip().endswith("return m;\n}")
      or "return m;" in best.split("if (!m) return b;")[1])
check("the fix is explained in the source", "v0.0.32" in best)

print("\n[8] v0.0.32 - two budgets: guesses are impatient, the final pass is not")
final_ms = int(re.search(r"TURBO_FINAL_WAIT_MS = (\d+)", JS).group(1))
live_ms_wait = int(re.search(r"LIVE_WAIT_MS = (\d+)", JS).group(1))
turbo_ms = int(re.search(r"TURBO_WAIT_MS = (\d+)", JS).group(1))
# v0.0.44 - THESE TWO ASSERTIONS WERE ENCODING THE LATENCY BUG.
# They demanded the final pass be VERY patient (>= 7s) and more patient than a
# speculative one. Patience in the abort ceiling is harmless; the bug was that
# _submitTurn AWAITED that ceiling before showing a single word or asking the
# brain anything, so a slow upload became 4-7 seconds of visible dead air and
# the agent looked like it was stalling on purpose. Waiting is now decoupled
# from the ceiling: the caller is answered when DISPATCH_BUDGET_MS expires, and
# the ceiling only kills a hung socket. So the contract asserted here is the
# PERCEIVED wait, not the timeout value.
dispatch_ms = int(re.search(r"DISPATCH_BUDGET_MS = (\d+)", JS).group(1))
check("the caller's perceived wait for a transcript is short", dispatch_ms <= 900)
check("but long enough that fast ASR normally still wins the race", dispatch_ms >= 300)
check("the final pass still cannot hang a call forever", final_ms <= 15000)
check("the abort ceiling is longer than the wait the caller feels",
      final_ms > dispatch_ms)
check("a late transcript is corrected on screen instead of being lost",
      "function _lateCorrect" in JS)
check("the correction never re-speaks the answer",
      "speakText" not in JS[JS.index("function _lateCorrect"):
                            JS.index("function _dispatchTurn")])
check("dispatch does not await the model before answering",
      "_raceBudget(asrPromise" in JS)
check("live guesses stay impatient", live_ms_wait <= 2500)
check("transcribe accepts a per-call budget",
      "async function _turboTranscribe(blob, waitMs)" in JS)
check("budget is applied to the abort timer",
      "ctrl.abort(), waitMs || TURBO_WAIT_MS" in JS)
check("the authoritative pass uses the patient budget",
      "_turboTranscribe(audio, TURBO_FINAL_WAIT_MS)" in JS)
check("the live loop uses the impatient budget",
      "_turboTranscribe(blob, LIVE_WAIT_MS)" in JS)

print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
if fails:
    print("failures: " + "; ".join(fails))
sys.exit(1 if FAIL else 0)
