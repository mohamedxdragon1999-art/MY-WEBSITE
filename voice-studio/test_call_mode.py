"""v19 call-mode tests: the mic must stay open until the user ends the call.

All assertions are static reads of the shipped front-end source, because the
sandbox has no browser mic. They verify STRUCTURE (that the code cannot fall
back into walkie-talkie behaviour), which is exactly the class of bug we fixed.
"""
import re, sys, os

ROOT = os.path.dirname(os.path.abspath(__file__)) + ""
js = open(os.path.join(ROOT, "static/app.js")).read()
html = open(os.path.join(ROOT, "static/index.html")).read()
css = open(os.path.join(ROOT, "static/styles.css")).read()

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


print("[1] the line opens and closes only on the user's command")
check("call state exists", "inCall: false" in js)
check("startCall exists", "async function startCall()" in js)
check("endCall exists", "function endCall()" in js)
check("one control toggles the call", "function toggleCall()" in js)
check("call button wired", "callBtn" in js and "callBtn" in html)
check("start call opens the mic first", re.search(r"async function startCall\(\)[\s\S]{0,200}await ensureMic\(\)", js) is not None)
check("blocked mic does not fake a call", re.search(r"if \(!micOk\)[\s\S]{0,160}return;", js) is not None)

print("\n[2] THE core guarantee: turns never close the microphone")
# The old design stopped listening on every turn. That must be impossible now.
sub = js[js.index("function _submitTurn"):]
sub = sub[:sub.index("\nfunction ", 10)]
check("submitting a turn does NOT unconditionally stop the mic",
      "stopListening();" not in sub.replace("if (!state.inCall) stopListening();", ""))
check("in a call, submitting a turn keeps the mic open",
      "if (!state.inCall) stopListening();" in sub)
check("after replying, a call does not reopen the mic (it never closed)",
      "if (state.inCall) { _ensureAlive(); return; }" in js)

print("\n[3] watchdog: Chrome killing the recognizer cannot end the call")
check("watchdog exists", "function _ensureAlive()" in js)
check("watchdog runs on an interval", "setInterval(_ensureAlive" in js)
m = re.search(r"setInterval\(_ensureAlive, (\d+)\)", js)
check("watchdog interval is responsive", m and int(m.group(1)) <= 5000, m and m.group(1))
check("watchdog restarts a dead recognizer", "_restartRecognition()" in js)
check("watchdog restarts a fully stopped mic",
      re.search(r"_ensureAlive\(\)[\s\S]{0,220}startListening\(\)", js) is not None)
check("watchdog is cleared when the call ends", "clearInterval(_aliveTimer)" in js)
check("transient errors do not hang up", "if (state.inCall && err !== \"not-allowed\"" in js)
check("only permission failure ends the call", "if (state.inCall) endCall();" in js)
check("returning to the tab revives the line", "visibilitychange" in js)

print("\n[4] barge-in vs backchannel: 'mm-hmm' must not cut the agent off")
check("backchannel rule exists", "_BACKCHANNEL" in js)
bc = re.search(r"const _BACKCHANNEL = /(.+)/i;", js)
check("backchannel rule is a regex", bool(bc))
rx = re.compile(bc.group(1), re.I) if bc else None
for noise in ("mm", "mhm", "uh huh", "uh-huh", "yeah", "yep", "ok", "okay",
              "right", "i see", "got it", "go on", "sure", "exactly"):
    check("'" + noise + "' does NOT interrupt the agent", bool(rx and rx.match(noise)), noise)
for real in ("stop", "no that is wrong", "cancel my order",
             "actually i meant the other one", "wait i have a question"):
    check("'" + real + "' DOES interrupt the agent", not (rx and rx.match(real)), real)
check("real words stop the agent immediately",
      re.search(r"if \(state\.speaking && shown\)[\s\S]{0,420}stopSpeaking\(\)", js) is not None)
check("backchannel is dropped, not queued as a question",
      re.search(r"_BACKCHANNEL\.test\(shown\)[\s\S]{0,160}return;", js) is not None)

print("\n[5] mute: silence without dropping the line")
check("mute exists", "function toggleMute()" in js)
check("mute keeps the stream (track disable, not stop)",
      "t.enabled = !state.muted" in js)
check("mute never stops tracks (that would re-prompt for permission)",
      "getAudioTracks().forEach((t) => { t.enabled" in js)
check("muted audio is not transcribed", "if (state.muted) return;" in js)
check("muted audio does not drive the VAD", "if (!state.muted && rms >" in js)
check("mute is only possible during a call",
      re.search(r"function toggleMute\(\)[\s\S]{0,80}if \(!state\.inCall\) return;", js) is not None)
check("mute button in the page", 'id="muteBtn"' in html)

print("\n[6] mic release and hygiene")
check("releaseMic exists", "function releaseMic()" in js)
check("ending a call stops the tracks", "getTracks().forEach((t) => t.stop())" in js)
check("ending a call closes the audio context", "_audioCtx.close()" in js)
check("ending a call releases the mic",
      re.search(r"function endCall\(\)[\s\S]{0,700}releaseMic\(\)", js) is not None)
check("ending a call stops the agent talking",
      re.search(r"function endCall\(\)[\s\S]{0,700}stopSpeaking\(\)", js) is not None)
check("closing the tab releases the mic", "beforeunload" in js)

print("\n[7] call feedback: timer and live input meter")
check("call timer element", 'id="callTimer"' in html)
check("timer ticks", "setInterval(_syncCallUi" in js)
check("timer formats mm:ss", "_fmtDuration" in js and "padStart(2" in js)
check("input meter element", 'id="micLevel"' in html)
check("meter is driven by real audio", "micLevel" in js and "style.width" in js)
check("meter is clamped to 100%", "Math.min(100" in js)
check("meter reads zero while muted", "state.muted ? 0 :" in js)
check("meter styled", ".level" in css and ".levelwrap" in css)
check("call button styled", "button.call" in css)
check("active call is visually distinct", ".danger" in css and "in-call" in css)
check("push-to-talk hidden during a call (line already open)",
      "body.in-call .mic" in css)
check("reduced motion respected", "prefers-reduced-motion" in css)

print("\n[8] no regressions in the capture fixes")
check("onend still never submits a turn",
      re.search(r"recognition\.onend[\s\S]{0,700}_submitTurn", js) is None)
check("filler rule still present", "_FILLER_ONLY" in js)
check("VAD still gates the turn", "_voiceActive()" in js)
check("hard turn deadline still present", "MAX_TURN_WAIT_MS" in js)
check("mic still pre-warmed", "function ensureMic" in js)
check("noise suppression still requested", "noiseSuppression" in js)
check("auto gain still requested", "autoGainControl" in js)
check("echo cancellation still on (agent cannot hear itself)",
      "echoCancellation" in js)

print("\n" + "=" * 60)
print("  PASSED: " + str(PASS) + "   FAILED: " + str(len(FAIL)))
if FAIL:
    print("  failures: " + ", ".join(FAIL))
print("=" * 60)
sys.exit(1 if FAIL else 0)
