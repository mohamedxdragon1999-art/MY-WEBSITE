#!/usr/bin/env python3
"""EXECUTE every turn-dispatch path in node. No structural assertions here.

WHY THIS SUITE EXISTS
---------------------
The turn dispatch path has now broken twice in a row, and both times the whole
suite of structural assertions passed while the app could not answer a caller:

  * v0.0.44: _submitTurn awaited the speech model before displaying a single
    word, so the transcript appeared 4-7 seconds late.
  * v0.0.44: lowering the abort ceiling to 2500ms silently removed ALL capture
    for anyone whose browser recogniser yields nothing, because in that case the
    server ASR is the only source of words and it was being killed early.

Both were reachable only by RUNNING the code. "The function contains the string
_bestTranscript" cannot tell you whether a caller ever gets answered. So this
suite extracts the real functions from static/app.js, runs them in node against
fake timers/promises, and asserts on OBSERVED BEHAVIOUR: did the caller get
answered, with which words, and how long did it take.

The guarantee under test, in one line:
    NO PATH MAY EVER LEAVE THE CALLER UNANSWERED.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

PASS = 0
FAIL = 0
failures = []


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok   %s" % label)
    else:
        FAIL += 1
        failures.append(label)
        print("  FAIL %s %s" % (label, extra))


HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "static", "app.js")
with open(APP, "r", encoding="utf-8") as fh:
    JS = fh.read()


def extract(name):
    """Pull one top-level function out of app.js by name."""
    needle = "function %s(" % name
    i = JS.index(needle)
    j = JS.index("\n}\n", i) + 3
    return JS[i:j]


def const_of(name):
    import re
    return int(re.search(r"%s = (\d+)" % name, JS).group(1))


DISPATCH_BUDGET_MS = const_of("DISPATCH_BUDGET_MS")
FINAL_MS = const_of("TURBO_FINAL_WAIT_MS")

print("\n[1] the real functions can be lifted out of app.js")
fns = {}
for name in ("_raceBudget", "_lateCorrect", "_dispatchTurn", "_bestTranscript",
             "_normKey", "_answer", "_looksLikeEchoIn"):
    try:
        fns[name] = extract(name)
        check("extracted %s" % name, True)
    except ValueError:
        check("extracted %s" % name, False, "not found in app.js")

if FAIL:
    print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
    sys.exit(1)

HARNESS = r"""
'use strict';
// ---- fakes -----------------------------------------------------------------
let _liveCommitted = "";
let answered = [];
let answeredAt = [];
let T0 = 0;
let _lastUserBubble = null;
const DISPATCH_BUDGET_MS = __BUDGET__;
// Call mode keeps the microphone open, which is the condition under which the
// agent can hear itself - so the echo scenarios below run with inCall true.
const state = { inCall: true };
function setStatus() {}

function handleUserText(text) {
  // The real one ignores empty text; reproducing that is essential, because
  // "handleUserText was called with an empty string" IS the silent-failure bug.
  text = (text || "").trim();
  if (!text) return;
  answered.push(text);
  answeredAt.push(Date.now() - T0);
  _lastUserBubble = { textContent: text, title: "" };
}

__FNS__

function later(ms, value, reject) {
  return new Promise((res, rej) =>
    setTimeout(() => (reject ? rej(new Error("asr failed")) : res(value)), ms));
}

function reset(live) {
  answered = []; answeredAt = []; _lastUserBubble = null;
  _liveCommitted = live || "";
  T0 = Date.now();
}

const out = {};

async function scenario(name, live, heard, promise, waitMs, echoRef) {
  reset(live);
  _dispatchTurn(promise, heard, echoRef || "");
  await new Promise((r) => setTimeout(r, waitMs));
  out[name] = {
    answered: answered.slice(),
    at: answeredAt.slice(),
    bubble: _lastUserBubble ? _lastUserBubble.textContent : null,
    title: _lastUserBubble ? _lastUserBubble.title : null,
  };
}

(async () => {
  // A) model lands fast -> model wording is used
  await scenario("fast", "", "browser words", later(40, "model words"), 400);

  // B) model is slow -> caller answered immediately, corrected later
  await scenario("slow", "", "browser words", later(1500, "model words"), 2200);

  // C) model rejects, browser text exists
  await scenario("reject", "", "browser words", later(60, null, true), 500);

  // D) model returns empty, browser text exists
  await scenario("empty", "", "browser words", later(60, ""), 500);

  // E) THE v0.0.44 REGRESSION: browser gave nothing, model is the only source
  await scenario("asr_only", "", "", later(900, "model only words"), 1500);

  // F) browser gave nothing AND model gave nothing -> live text must save us
  await scenario("live_rescue", "live words", "", later(80, ""), 600);

  // G) browser gave nothing AND model rejected -> live text must save us
  await scenario("live_rescue_reject", "live words", "", later(80, null, true), 600);

  // H) no promise at all (turbo unavailable)
  await scenario("no_promise", "", "browser words", null, 200);

  // I) no browser text, SLOW model, but live text exists -> must not wait
  await scenario("live_fast", "live words", "", later(1500, "model words"), 2200);

  // ---- CALL MODE ECHO: the agent hearing ITSELF ---------------------------
  // _agentSaid holds normalised text, so the reference is lower case.
  const SAID = "is that okay shall i book the appointment for tuesday";

  // J) the server model transcribed our own voice (browser heard nothing)
  await scenario("echo_model", "", "",
    later(80, "Is that okay, shall I book the appointment for Tuesday?"), 500, SAID);

  // K) the browser transcript itself is our own voice
  await scenario("echo_browser", "", "is that okay shall i book the appointment",
    later(60, ""), 500, SAID);

  // L) live text is our own voice and the model gave nothing
  await scenario("echo_live", "is that okay shall i book the appointment", "",
    later(60, ""), 500, SAID);

  // M) a REAL turn while echo memory exists must still get through
  await scenario("not_echo", "", "i want to change my flight to friday",
    later(60, "i want to change my flight to friday"), 500, SAID);

  // N) a real barge-in of a couple of words must not be swallowed
  await scenario("barge_in", "", "no stop", later(60, "no stop"), 500, SAID);

  // O) the late correction must not paste our own voice in either
  await scenario("echo_late", "", "i want to change my flight",
    later(1500, "is that okay shall i book the appointment"), 2200, SAID);

  console.log(JSON.stringify(out));
})();
"""

harness = HARNESS.replace("__FNS__", "\n".join(fns[k] for k in (
    "_normKey", "_looksLikeEchoIn", "_bestTranscript", "_raceBudget",
    "_lateCorrect", "_answer", "_dispatchTurn")))
harness = harness.replace("__BUDGET__", str(DISPATCH_BUDGET_MS))

path = os.path.join(tempfile.gettempdir(), "_vs_dispatch_harness.js")
with open(path, "w", encoding="utf-8") as fh:
    fh.write(harness)

print("\n[2] the harness runs under node")
try:
    proc = subprocess.run(["node", path], capture_output=True, text=True, timeout=90)
except (OSError, subprocess.TimeoutExpired) as exc:
    check("node executed the dispatch paths", False, str(exc))
    print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
    sys.exit(1)

check("node executed the dispatch paths", proc.returncode == 0,
      (proc.stderr or "")[-400:])
if proc.returncode != 0:
    print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
    sys.exit(1)

try:
    R = json.loads(proc.stdout.strip().splitlines()[-1])
except (ValueError, IndexError) as exc:
    check("the harness produced results", False, str(exc))
    print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
    sys.exit(1)
check("the harness produced results", True)

print("\n[3] THE ONE RULE: no path leaves the caller unanswered")
for name in ("fast", "slow", "reject", "empty", "asr_only",
             "live_rescue", "live_rescue_reject", "no_promise", "live_fast"):
    got = R.get(name, {}).get("answered", [])
    check("%-18s answered the caller" % name, len(got) >= 1, got)

print("\n[4] a fast model still decides the wording (accuracy unchanged)")
check("fast model text wins", R["fast"]["answered"] == ["model words"],
      R["fast"]["answered"])
check("and it is answered promptly", R["fast"]["at"][0] < DISPATCH_BUDGET_MS,
      R["fast"]["at"])

print("\n[5] a slow model no longer stalls the conversation")
check("answered from the words we already had",
      R["slow"]["answered"][0] == "browser words", R["slow"]["answered"])
check("answered at roughly the budget, not the model's latency",
      R["slow"]["at"][0] < DISPATCH_BUDGET_MS + 400, R["slow"]["at"])
check("the caller is answered exactly once", len(R["slow"]["answered"]) == 1,
      R["slow"]["answered"])
check("the transcript is corrected afterwards",
      R["slow"]["bubble"] == "model words", R["slow"]["bubble"])
check("and the correction is marked as such",
      bool(R["slow"]["title"]), R["slow"]["title"])

print("\n[6] failures fall back instead of going silent")
check("a rejected model keeps the browser words",
      R["reject"]["answered"] == ["browser words"], R["reject"]["answered"])
check("an empty model result keeps the browser words",
      R["empty"]["answered"] == ["browser words"], R["empty"]["answered"])
check("no upload available still answers",
      R["no_promise"]["answered"] == ["browser words"], R["no_promise"]["answered"])

print("\n[7] THE v0.0.44 REGRESSION: the ASR-only path")
# This is the exact failure the user reported as "it became not able to hear me
# or capture any words at all": no browser transcript, so the server ASR is the
# only source - and it must be allowed to finish.
check("words appear when the model is the ONLY source",
      R["asr_only"]["answered"] == ["model only words"], R["asr_only"]["answered"])
check("the abort ceiling cannot kill that path", FINAL_MS >= 6000, FINAL_MS)
check("the ceiling is still bounded", FINAL_MS <= 15000, FINAL_MS)
check("the ceiling is far longer than the perceived wait",
      FINAL_MS > DISPATCH_BUDGET_MS * 4, (FINAL_MS, DISPATCH_BUDGET_MS))

print("\n[8] never silent: live text rescues a total model failure")
check("empty model + no browser text -> live words are used",
      R["live_rescue"]["answered"] == ["live words"], R["live_rescue"]["answered"])
check("rejected model + no browser text -> live words are used",
      R["live_rescue_reject"]["answered"] == ["live words"],
      R["live_rescue_reject"]["answered"])

print("\n[8b] a slow model does not stall the turn when live text exists")
# The other half of the report: "too slow in capturing the words said". If the
# browser produced no final transcript we used to sit through the entire upload.
check("answered from live words instead of waiting for the upload",
      R["live_fast"]["answered"] == ["live words"], R["live_fast"]["answered"])
check("and answered at the budget, not the model's latency",
      R["live_fast"]["at"][0] < DISPATCH_BUDGET_MS + 400, R["live_fast"]["at"])
check("the model still corrects the wording afterwards",
      R["live_fast"]["bubble"] == "model words", R["live_fast"]["bubble"])
check("still answered exactly once", len(R["live_fast"]["answered"]) == 1,
      R["live_fast"]["answered"])

print("\n[8c] CALL MODE: the agent must never be quoted as the caller")
# Reported symptom: "in the call mode it is repeating what it said again like if
# it said that is it okay it writes again as if i am the one who told it".
# In call mode the microphone never closes, so the agent's own sentence reaches
# the recogniser AND the server ASR. Only the browser path was being filtered.
check("the model transcribing our own voice is dropped",
      R["echo_model"]["answered"] == [], R["echo_model"]["answered"])
check("the browser transcript of our own voice is dropped",
      R["echo_browser"]["answered"] == [], R["echo_browser"]["answered"])
check("live text of our own voice is dropped",
      R["echo_live"]["answered"] == [], R["echo_live"]["answered"])
check("a late correction never pastes our own voice in",
      R["echo_late"]["bubble"] == "i want to change my flight",
      R["echo_late"]["bubble"])

print("\n[8d] but the echo guard must not swallow real speech")
check("a genuine turn still reaches the brain",
      R["not_echo"]["answered"] == ["i want to change my flight to friday"],
      R["not_echo"]["answered"])
check("a short real barge-in still reaches the brain",
      R["barge_in"]["answered"] == ["no stop"], R["barge_in"]["answered"])

print("\n[9] the perceived wait is a real number, not a claim")
check("budget is short enough to feel immediate", DISPATCH_BUDGET_MS <= 900,
      DISPATCH_BUDGET_MS)
check("budget is long enough for fast ASR to win normally",
      DISPATCH_BUDGET_MS >= 300, DISPATCH_BUDGET_MS)

try:
    os.remove(path)
except OSError:
    pass

print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
if failures:
    print("failures: " + "; ".join(failures))
sys.exit(1 if FAIL else 0)
