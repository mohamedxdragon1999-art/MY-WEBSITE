"""v23 / v6.4.0 - the call-mode and capture-pipeline fixes.

These pin three reported failures:
  1. "Microphone stopped unexpectedly" - the keep-alive watchdog was killing
     healthy calls after ~24 seconds.
  2. The pipeline being strictly serial (capture THEN transcribe THEN think).
  3. Capture quality being poor because the good transcript was thrown away.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__)) + ""
PASS = FAIL = 0
FAILED = []


def ok(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        FAILED.append(label)


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


js = read("static/app.js")

print("[1] the watchdog no longer kills healthy calls")
ok("_recogRunning" in js, "recognizer tracks whether it is actually running")
ok("recognition.onstart" in js, "onstart handler exists")
ok(re.search(r"onstart\s*=\s*\(\)\s*=>\s*\{\s*_recogRunning\s*=\s*true", js),
   "onstart marks the recognizer live")
ok("_recogRunning = false" in js, "onend marks the recognizer dead")
ok("InvalidStateError" in js, "already-running is recognised by name")
# The core regression: _ensureAlive must bail out when healthy.
alive = js[js.index("function _ensureAlive"):]
alive = alive[:alive.index("\n}") + 2]
ok("_recogRunning" in alive, "the watchdog checks the running flag")
ok("return" in alive.split("_recogRunning")[1][:40], "the watchdog returns early when healthy")
# And the restart path must not count 'already running' as a failure.
restart = js[js.index("function _restartRecognition"):]
restart = restart[:restart.index("\n}\n") + 3]
ok("if (_recogRunning)" in restart, "restart is a true no-op when already running")
ok("_restartTries = 0" in restart, "the retry counter is reset on success")
ok("stopListening()" not in restart, "a failed restart never shuts the microphone off")
ok("state.inCall" in restart, "a call is treated differently from idle listening")

print("[2] the pipeline overlaps instead of stacking")
ok("_pendingAsr" in js, "speculative transcription state exists")
ok("function _beginEarlyTranscribe" in js, "early transcription entry point exists")
ok("function _snapshotAudio" in js, "audio can be copied without consuming it")
snap = js[js.index("function _snapshotAudio"):]
snap = snap[:snap.index("\n}") + 2]
ok("_chunks = []" not in snap, "the snapshot does NOT clear the recording buffer")
ok("_earlyTimer" in js, "early transcription is scheduled on a pause")
sched = js[js.index("function _scheduleEndpoint"):]
sched = sched[:sched.index("\n}") + 2]
ok("_beginEarlyTranscribe" in sched, "the pause kicks off transcription")
ok("_endpointTimer" in sched, "the pause still schedules the real turn end")

print("[3] the speculative result is used only when it is valid")
submit = js[js.index("function _submitTurn"):]
submit = submit[:submit.index("\n}\n") + 3]
ok("_pendingAsr.n === _chunks.length" in submit,
   "the early result is used only if no new audio arrived")
ok("_pendingAsr = null" in submit, "the speculation is consumed exactly once")
# v0.0.44 - the choice between transcripts moved OUT of _submitTurn into
# _dispatchTurn, so that answering the caller no longer has to wait for the
# model. The guarantee is unchanged: the browser transcript is still the safety
# net - it is just consulted in the dispatcher now.
ok("_dispatchTurn" in submit, "the turn is handed to the dispatcher")
disp = js[js.index("function _dispatchTurn"):]
disp = disp[:disp.index("\n}\n") + 3]
ok("_bestTranscript" in disp, "the browser transcript is still the safety net")
# v0.0.44: turns no longer call handleUserText directly. They go through
# _answer(), which is the single choke point that drops the agent's own voice
# before it can be attributed to the caller. The guarantee is unchanged - every
# path answers - but the function that does it is now the guarded one.
ok("_answer(" in disp, "every dispatch path answers the caller")
ans = js[js.index("function _answer("):]
ans = ans[:ans.index("\n}\n") + 3]
ok("handleUserText" in ans, "the choke point really does answer the caller")
ok("_looksLikeEchoIn" in ans, "and it drops our own voice before answering")
ok("_raceBudget" in disp, "the wait for the better transcript is bounded")
# v0.0.44 - the answering paths now live across _submitTurn AND _dispatchTurn,
# so count them together. The guarantee is "no path drops the turn silently",
# not "they all live in one function".
ok((submit + disp).count("_answer(") >= 3, "every path still answers the caller")

print("[4] stale speculation is thrown away")
ok("function _dropEarlyTranscribe" in js, "there is a way to discard speculation")
ok(js.count("_dropEarlyTranscribe") >= 4, "it is actually called, not dead code")
stop = js[js.index("function stopListening"):]
stop = stop[:stop.index("\n}") + 2]
ok("_dropEarlyTranscribe" in stop, "stopping listening discards speculation")

print("[5] capture quality")
# v7.2 - assert a FLOOR, not the exact old value, so improving fidelity passes.
ok(int(re.search(r"audioBitsPerSecond: (\d+)", js).group(1)) >= 64000,
   "bitrate raised so consonants survive")
ok("audioBitsPerSecond: 32000" not in js, "the starved 32kbps setting is gone")
m = re.search(r"const TURBO_WAIT_MS = (\d+)", js)
ok(m is not None, "the ASR ceiling is defined")
ok(m and int(m.group(1)) >= 2500,
   "the ceiling no longer discards the good transcript early (got %s)" % (m and m.group(1)))

print("[6] nothing else regressed")
ok("echoCancellation: true" in js, "echo cancellation still on")
ok("MAX_TURN_WAIT_MS" in js, "the hard turn ceiling still exists")
ok("_BACKCHANNEL" in js, "backchannel suppression still present")
ok("recognition.continuous = true" in js, "the recognizer still runs continuously")
ok("onend must never end a turn" in js, "the onend fix from v5.2 is intact")

print()
print("PASSED:", PASS, "FAILED:", FAIL)
if FAILED:
    print("failures:", "; ".join(FAILED[:25]))
