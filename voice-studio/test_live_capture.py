"""v0.0.44 - the live capture readout, and the REAL turn limit behind it.

The report was: "i see it writes one line from the word capturing and if the
user talked more than this line i see that the first line in the capturing
disappeared but it is still write it i do not know if this is problem or not."

That observation was exactly right on both counts:
  1. The DISPLAY was capped. The captured text was rendered as
     `shown.slice(-64)` inside the single-line, centre-aligned status element,
     so the start of a longer sentence scrolled out of view.
  2. Nothing was LOST. The full transcript stayed in _finalBuf / _liveCommitted
     and the whole string was sent to the brain. "but it is still write it" was
     the correct read.

While confirming that, a genuine limit turned up: MAX_TURN_WAIT_MS was 20s and
it is a HARD cut - past the deadline the turn is submitted even mid-sentence.
That one really did truncate long speech, and the audio ring buffer (600 chunks
= 60s) has to stay larger than it or the START of the audio would be dropped.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

JS = open(os.path.join(HERE, "static", "app.js")).read()
HTML = open(os.path.join(HERE, "static", "index.html")).read()
CSS = open(os.path.join(HERE, "static", "styles.css")).read()
SRV = open(os.path.join(HERE, "server.py")).read()

# The fix is DOCUMENTED in a comment that quotes the old broken expression, so
# a naive substring search finds it in prose and reports a false failure. Only
# executable lines may be searched for removed code.
CODE = "\n".join(
    ln for ln in JS.splitlines() if not ln.lstrip().startswith("//")
)

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


def num(pattern, src):
    m = re.search(pattern, src)
    return int(m.group(1)) if m else -1


# --- [1] the truncating display is gone -------------------------------------
print("[1] the 64-character display cap is gone")
check("no transcript is rendered via slice(-64)",
      "shown.slice(-64)" not in CODE)
check("no slice(-64) truncation survives in executable code at all",
      "slice(-64)" not in CODE)
check("the transcript no longer rides inside the status string",
      'setStatus("Listening\\u2026 \\u201c"' not in CODE)
check("the removal is documented, not silently dropped",
      "slice(-64)" in JS)

# --- [2] a real readout exists and is wired up ------------------------------
print("[2] the full-text readout exists end to end")
check("setLiveText helper is defined", "function setLiveText(" in JS)
check("the readout container exists in the markup", 'id="liveCap"' in HTML)
check("the readout text node exists in the markup", 'id="liveCapText"' in HTML)
check("it starts hidden so it never shows an empty box",
      re.search(r'id="liveCap"[^>]*hidden', HTML) is not None)
check("the helper reads both elements it needs",
      '$("liveCap")' in JS and '$("liveCapText")' in JS)
# v0.0.44 - this used to assert `JS.count("setLiveText(shown)") == 2`, which
# pinned a VARIABLE NAME rather than behaviour. The browser path now draws the
# readout from `display`, built from what was actually KEPT, because `shown`
# there also contains words still awaiting the echo test - showing those would
# print the agent's own leaked voice into your transcript.
check("both capture paths feed the readout",
      len(re.findall(r'setStatus\("Listening[^)]*\);\s*setLiveText\(', JS)) == 2)
check("the model path feeds it", "setLiveText(shown)" in JS)
check("the browser path shows only what survived the echo test",
      "setLiveText(display)" in JS)
check("text is assigned whole, never sliced",
      "out.textContent = text;" in JS)

# --- [3] it must WRAP and SCROLL, not clip ----------------------------------
print("[3] the readout wraps and scrolls instead of clipping")
check("a livecap rule exists", ".livecap{" in CSS)
check("long text wraps rather than being cut",
      "white-space:pre-wrap" in CSS.split(".livecap-text")[-1])
check("very long words cannot overflow the box",
      "word-break:break-word" in CSS)
check("the box scrolls when it fills",
      "overflow-y:auto" in CSS.split(".livecap{")[-1].split("}")[0])
check("the box is height-bounded so it cannot eat the page",
      "max-height" in CSS.split(".livecap{")[-1].split("}")[0])
check("the readout follows the newest words",
      "box.scrollTop = box.scrollHeight" in JS)
check("the readout is left aligned, unlike the centred status line",
      "text-align:left" in CSS.split(".livecap{")[-1].split("}")[0])

# --- [4] it hides itself when empty and clears between turns ---------------
print("[4] empty state and per-turn cleanup")
check("an empty string hides the box", "box.hidden = !text" in JS)
check("an empty string also clears the old words",
      'out.textContent = ""' in JS)
check("null/undefined is tolerated", '(t || "")' in JS)
check("the readout is cleared when a turn is submitted",
      JS.count('setLiveText("")') >= 2)
check("clearing rides along with the existing buffer reset",
      '_lastInterim = ""; _turnDeadline = 0; setLiveText("")' in JS)
check("the helper is defined before the capture code uses it",
      JS.index("function setLiveText(") < JS.index("setLiveText(shown)"))
check("a missing element cannot throw", "if (!box || !out) return;" in JS)

# --- [5] THE REAL LIMIT: the hard turn deadline ----------------------------
print("[5] the real limit - talking longer than the deadline")
turn_ms = num(r"MAX_TURN_WAIT_MS = (\d+)", JS)
check("the hard turn ceiling still exists", turn_ms > 0)
check("it is no longer the old 20s cut", turn_ms != 20000)
check("a long, detailed complaint now fits (>=40s)", turn_ms >= 40000)
check("but a stuck mic still cannot hang the turn forever", turn_ms <= 90000)

# --- [6] the audio buffer must outlive the deadline ------------------------
print("[6] the audio ring buffer outlives the turn deadline")
ring = num(r"_chunks\.length > (\d+)\) _chunks\.splice", JS)
check("the ring buffer is still bounded (memory safety)", ring > 0)
check("the ring buffer was raised from 600", ring > 600)
# 100ms per recorder slice -> chunks * 100 = milliseconds retained.
check("retained audio outlasts the turn deadline", ring * 100 > turn_ms)
check("the recorder still slices at 100ms", "_recorder.start(100)" in JS)
check("the speculative window cap is unchanged",
      num(r"LIVE_MAX_CHUNKS = (\d+)", JS) == 400)
check("the speculative cap stays below the ring buffer",
      num(r"LIVE_MAX_CHUNKS = (\d+)", JS) < ring)

# --- [7] nothing already-working was broken -------------------------------
print("[7] the surrounding capture logic is untouched")
check("the status line still reports listening", 'setStatus("Listening' in JS)
check("barge-in suppression still runs on the FULL text, not the display",
      "_BACKCHANNEL.test(shown)" in JS)
check("the full transcript still drives endpointing",
      "_scheduleEndpoint();" in JS)
check("the model still outranks the browser",
      "Math.ceil(bw / 2)" not in JS)
check("we still never transcribe our own voice",
      "if (state.speaking) return;" in JS)
check("the abbreviation-safe splitter is still wired in",
      "split_keeping_abbreviations" in open(
          os.path.join(HERE, "engines", "base.py")).read())

# --- [8] version ----------------------------------------------------------
print("[8] version")
check("version bumped to 0.0.51", 'VERSION = "0.0.51"' in SRV)

print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
if fails:
    print("failures: " + "; ".join(fails))
sys.exit(1 if FAIL else 0)
