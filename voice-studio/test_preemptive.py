#!/usr/bin/env python3
"""v6.5 - preemptive brain generation.

The technique the leading voice agents use (LiveKit enables it by default,
Pipecat has it as a requested feature): start the LLM DURING the pause, before
the turn is confirmed, because the LLM is 60-70% of voice-agent latency.

The safety rule that makes it acceptable: only the BRAIN runs early. TTS never
runs on a guess, so a wrong speculation is silent - it costs tokens, never a
wrong word out loud.
"""
import os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__)) + ""
if not os.path.isdir(ROOT):
    ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

PASS = FAIL = 0
fails = []


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok   " + name)
    else:
        FAIL += 1
        fails.append(name)
        print("  FAIL " + name + ((" | " + str(extra)[:200]) if extra else ""))


js = open("static/app.js", encoding="utf-8").read()


def body_of(fn):
    """Crude but effective: text from a function decl to the next top-level }."""
    i = js.find("function " + fn)
    if i < 0:
        return ""
    return js[i:].split("\n}\n", 1)[0]


print("\n[1] the brain runs during the pause, not after it")
check("preemptive brain helper exists", "function _beginEarlyReply" in js)
check("there is a pending-reply slot", "_pendingReply" in js)
check("feature is on by default", re.search(r"PREEMPTIVE_BRAIN\s*=\s*true", js) is not None)
check("it is started from the early timer, not the endpoint timer",
      "_beginEarlyReply" in body_of("_scheduleEndpoint"))
check("it hits the one-shot reply endpoint", '"/api/reply"' in body_of("_beginEarlyReply"))
check("speculation is chained onto the speculative transcript",
      "_bestTranscript" in body_of("_scheduleEndpoint"))

print("\n[2] SAFETY: a guess is never spoken")
early = body_of("_beginEarlyReply")
check("early reply never calls speak", "speakText" not in early, early[:160])
check("early reply never calls the TTS endpoint", "/api/tts" not in early)
check("early reply never enqueues audio", "enqueueSpeak" not in early)
check("early reply never touches the transcript UI", "addMsg" not in early)

print("\n[3] the guess is only used when the words actually match")
check("a normalised key is used for matching", "function _normKey" in js)
check("matching is case-insensitive", "toLowerCase" in body_of("_normKey"))
check("punctuation cannot break a match", "replace" in body_of("_normKey"))
check("consumer compares keys before using the guess",
      "_pendingReply.key === _normKey(text)" in js)
check("the guess is consumed exactly once",
      js.count("_pendingReply = null") >= 2)
check("a mismatch falls through to the normal path", "if (!reply && state.backend)" in js)

print("\n[4] stale speculation is thrown away")
check("drop helper clears the pending reply too",
      "_pendingReply = null" in body_of("_dropEarlyTranscribe"))
check("muted callers never speculate", "state.muted" in early)
check("one-word noise never speculates", "< 2" in early)
check("the same words are not asked twice", "_pendingReply.key === key" in js)
check("a failed speculation resolves quietly", ".catch(() =>" in early)

print("\n[5] the speculative request is a faithful copy of the real one")
body = body_of("_replyBody")
check("shared body builder exists", "function _replyBody" in js)
check("carries the language", "lang" in body)
check("carries the NIM key when the user supplied one", "hasNimBrain()" in body)
check("carries the chosen NIM model", "state.nimModel" in body)
check("history window matches the committed path (8)", "slice(-8)" in body)
check("history includes the turn being guessed at",
      "role: \"user\"" in body or "role: 'user'" in body)

print("\n[6] nothing from v6.4 regressed")
check("speculative transcription still present", "function _beginEarlyTranscribe" in js)
check("watchdog fix still present", "_recogRunning" in js)
check("restart still never kills the mic",
      "stopListening()" not in body_of("_restartRecognition"))
check("turbo ASR ceiling still raised", re.search(r"TURBO_WAIT_MS\s*=\s*(\d+)", js)
      and int(re.search(r"TURBO_WAIT_MS\s*=\s*(\d+)", js).group(1)) >= 2500)
# v7.2 - was pinned to 48000, which is the value that lost consonant detail.
# Assert a FLOOR, not an exact number, so raising fidelity is never a failure.
_br = int(re.search(r"audioBitsPerSecond: (\d+)", js).group(1))
check("capture bitrate is at least 64k", _br >= 64000)
check("call mode still keeps the mic open", "continuous = true" in js)
check("barge-in still cuts speech", "stopSpeaking()" in js)

srv = open("server.py", encoding="utf-8").read()
check("version bumped to 0.0.51", 'VERSION = "0.0.51"' in srv)

print("\n[7] v6.6 - the mic never gets blamed while it is still recovering")
restart = body_of("_restartRecognition")
check("the scary message is no longer printed the instant the counter trips",
      "_restartTries === 8 && !state.inCall" not in js)
check("it waits before judging", re.search(r"_restartTries === 8[\s\S]{0,400}setTimeout", js) is not None)
check("a recovered recognizer stays silent",
      re.search(r"_restartTries === 8[\s\S]{0,400}_recogRunning", js) is not None)
check("it tries to re-acquire the device first",
      re.search(r"_restartTries === 8[\s\S]{0,600}ensureMic", js) is not None)
check("self-healing restarts instead of asking the user to click",
      re.search(r"_restartTries === 8[\s\S]{0,700}_restartRecognition\(\)", js) is not None)
check("the message is still there as a genuine last resort",
      "click the mic to resume" in js)
check("a call still never shows it", re.search(r"if \(!state\.inCall\)[\s\S]{0,120}click the mic to resume", js) is not None)

print("\n[8] v6.6 - the pause before we answer is in the researched range")
m = re.search(r"endpointMs: parseInt\([^)]*\|\| \"(\d+)\"", js) or re.search(r"state\.endpointMs \|\| (\d+)", js)
check("base pause is between 400 and 600ms", m and 400 <= int(m.group(1)) <= 600, m and m.group(1))
html = open("static/index.html", encoding="utf-8").read()
check("the shipped slider matches the code default", 'value="550"' in html)
check("the slider label matches too", "0.55s" in html)
check("no stale 700ms default left in the JS", "|| 700" not in js)
check("patience is still added back for hesitation", "_HESITATION" in js)
check("the hard turn deadline still exists", "MAX_TURN_WAIT_MS" in js)

print("\n[9] v6.7 - words are committed WHILE you speak, not after you stop")
tick = body_of("_liveTick")
win = body_of("_liveWindowBlob")
agree = body_of("_stablePrefix")
check("a live capture loop exists", "_startLiveCapture" in js and "setInterval(_liveTick" in js)
check("it re-examines the audio faster than once a second",
      re.search(r"LIVE_MS = (\d+)", js) and int(re.search(r"LIVE_MS = (\d+)", js).group(1)) <= 1000)
check("the recogniser runs during the turn", "_turboTranscribe" in tick)
check("committed words go straight to the brain", "_beginEarlyReply" in tick)
check("the loop starts when recording starts", "_startLiveCapture()" in body_of("_startRecorder"))
check("the loop stops when recording stops", "_stopLiveCapture()" in body_of("_stopRecorder"))

print("\n[10] v6.7 - SAFETY: fast must not mean wrong")
check("a word must survive several passes before it is committed",
      "_stablePrefix(_liveHyps" in tick)
check("agreement now needs THREE passes, not two (v7.1)",
      re.search(r"LIVE_AGREE_PASSES = (\d+)", js) and
      int(re.search(r"LIVE_AGREE_PASSES = (\d+)", js).group(1)) >= 3)
check("the unstable trailing words are never committed (v7.1)",
      "LIVE_HOLDBACK_WORDS" in tick or "LIVE_HOLDBACK_WORDS" in agree)
check("the holdback actually drops words",
      "out.length - (holdback" in agree)
check("a contradicting hypothesis stops speculation instead of doubling down",
      ".indexOf(_normKey(_liveCommitted)) === 0" in tick)
check("agreement compares word by word", "_normWord" in agree and "break" in agree)
check("comparison ignores case and punctuation",
      "toLowerCase" in js and "replace(/[^a-z0-9']/g" in js)
check("committed text only ever grows, never retracts",
      "_countWords(stable) > _countWords(_liveCommitted)" in tick)
check("the unsettled tail is kept separate from committed words",
      "_liveTail" in tick and "_liveCommitted" in tick)

print("\n[11] v6.7 - the runaway-latency trap is avoided")
# v7.1: the window is bounded by ABANDONING speculation past a cap, not by
# splicing a mid-stream tail onto the header. Splicing produced undecodable
# audio and therefore confidently wrong words - the bug the user reported.
check("the work is bounded by a hard cap", "LIVE_MAX_CHUNKS" in win)
check("the cap is a real ceiling",
      re.search(r"LIVE_MAX_CHUNKS = (\d+)", js) and
      int(re.search(r"LIVE_MAX_CHUNKS = (\d+)", js).group(1)) <= 600)
check("past the cap we stop guessing instead of sending broken audio",
      "_liveOverflow = true" in win and "return null" in win)
check("the window is ALWAYS a real prefix of the recording (v7.1)",
      "_chunks.slice(0)" in win)
check("the header is never spliced onto a mid-stream tail again",
      "[_chunks[0]].concat" not in js)
check("no sliding-window splice remains anywhere",
      "LIVE_TAIL_CHUNKS" not in js)
check("two passes can never overlap", "_liveBusy" in tick)
check("the busy flag is always released", "finally" in tick and "_liveBusy = false" in tick)
check("a failed partial is swallowed, not fatal", "catch" in tick)

print("\n[12] v6.7 - state is reset cleanly between turns")
check("taking the turn audio resets the live state", "_resetLiveCapture()" in body_of("_takeTurnAudio"))
check("stopping capture resets too", "_resetLiveCapture()" in body_of("_stopLiveCapture"))
check("committed words survive an empty final pass", "_liveCommitted" in body_of("_bestTranscript"))
check("muted callers are never transcribed", "state.muted" in tick)

print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
if fails:
    print("failures: " + "; ".join(fails))
sys.exit(1 if FAIL else 0)
