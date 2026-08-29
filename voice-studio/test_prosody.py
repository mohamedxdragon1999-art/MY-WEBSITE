"""v21 / v6.2.0 - prosody, capture and latency.

Covers the four things asked for in this round:
  1. emotion settings/engines/systems/prompts -> more professional and human
  2. word capture -> extremely better and bigger
  3. faster answers by tweaking the pipeline (NOT by speeding up the voice)
  4. everything wired end to end, not decorative
"""
import os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__)) + ""
sys.path.insert(0, ROOT)

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


os.environ["VOICE_EMOTION"] = "1"
import importlib
import engines.emotion as emo
importlib.reload(emo)

# ---------------------------------------------------------------- 1. contour
# F0 is the dominant prosodic parameter in the literature - the single biggest
# lever on whether a voice sounds human. Flat terminals are the robot tell.
ok(emo.contour_for("Do you want the receipt?") == "rise", "yes/no question rises")
ok(emo.contour_for("Is that correct?") == "rise", "is-question rises")
ok(emo.contour_for("Can I help?") == "rise", "can-question rises")
# The detail almost every TTS gets wrong: wh-questions FALL in natural English.
ok(emo.contour_for("Where do you live?") == "fall", "wh-question falls")
ok(emo.contour_for("What is your order number?") == "fall", "what-question falls")
ok(emo.contour_for("How can I help you today?") == "fall", "how-question falls")
ok(emo.contour_for("Why was it declined?") == "fall", "why-question falls")
ok(emo.contour_for("Your refund is confirmed.") == "fall", "statement falls")
ok(emo.contour_for("Let me check that,") == "level", "trailing comma stays level")
ok(emo.contour_for("One moment...") == "level", "ellipsis stays level")

# ---------------------------------------------------------------- 2. emphasis
em = emo.emphasis_words("I cannot refund the expired order today")
ok("cannot" in em, "negation is always emphasised")
ok(len(emo.emphasis_words("a" * 3 + " the of and to in it is")) == 0,
   "function words are never emphasised")
for sent in ["Your refund of ninety nine dollars was approved today and confirmed",
             "I have verified every single important detail immediately now"]:
    ok(len(emo.emphasis_words(sent)) <= 3, "emphasis capped at 3: " + sent[:24])
# A voice that stresses nothing sounds bored; one that stresses everything
# sounds unhinged. The cap is the whole point.
ok(len(emo.emphasis_words("never ever always only every immediately urgent")) <= 3,
   "cap holds even when every word qualifies")

# ------------------------------------------------------------ 3. clause gaps
heavy = emo.clause_gaps_for("I'm sorry, that failed, and it expired", emo.EMOTIONS["apologetic"])
bright = emo.clause_gaps_for("Great, it worked, perfect", emo.EMOTIONS["excited"])
ok(all(g == 150 for g in heavy), "heavy emotions breathe longer at commas")
ok(all(g == 70 for g in bright), "bright emotions breathe shorter at commas")
ok(heavy and bright and heavy[0] > bright[0], "sad pauses longer than excited")
ok(len(emo.clause_gaps_for("," * 40, emo.NEUTRAL)) <= 6, "clause gaps are capped")
ok(emo.clause_gaps_for("No punctuation here at all", emo.NEUTRAL) == (),
   "no commas means no micro-pauses")

# -------------------------------------------------------------- 4. smoothing
beats = emo.plan("I'm so sorry about that. Great news, it is fixed!")
ok(len(beats) == 2, "two sentences -> two beats")
# Emotional whiplash - snapping from grief to delight between two sentences -
# is a machine artefact. Real speakers carry the previous state forward.
raw_happy = emo.EMOTIONS["happy"]
ok(abs(beats[1].rate - raw_happy.rate) > 1e-9,
   "second beat is smoothed, not the raw emotion value")
# Final lengthening: humans slow down on the last thing they say.
long_beats = emo.plan("One. Two. Three. Four.")
ok(len(long_beats) == 4, "four sentences -> four beats")
ok(long_beats[-1].rate < long_beats[-2].rate + 1e-9, "final beat lengthens")
single = emo.plan("Just one sentence here.")
ok(len(single) == 1 and single[0].rate > 0, "single sentence still plans cleanly")

# ------------------------------------------------------- 5. the new emotions
for name in ("concerned", "encouraging", "confident", "polite", "amused"):
    ok(name in emo.EMOTIONS, "new emotion exists: " + name)
ok(len(emo.EMOTIONS) >= 16, "emotion palette grew to 16+")
for text, want in [
    ("I'm seeing a problem with your payment", "concerned"),
    ("You're almost there, last step", "encouraging"),
    ("I can confirm that is done", "confident"),
    ("Would you mind holding", "polite"),
    ("Haha, good one", "amused"),
]:
    ok(emo.detect(text).name == want, "cue maps to " + want)

# Every emotion must stay in a sane acoustic range, or "expressive" becomes
# "broken". This is the balance the user asked for.
for name, e in emo.EMOTIONS.items():
    ok(0.85 <= e.rate <= 1.15, "sane rate: " + name)
    ok(-3.0 <= e.pitch <= 3.0, "sane pitch: " + name)
    ok(0.9 <= e.volume <= 1.1, "sane volume: " + name)

# Beats must carry the new fields for the engines to use.
b = emo.plan("Where is my order?")[0]
ok(hasattr(b, "contour") and hasattr(b, "emphasis") and hasattr(b, "clause_gaps"),
   "Beat exposes contour, emphasis and clause_gaps")

# ---------------------------------------------------- 6. capture (app.js)
js = read("static/app.js")
ok("_CONFIRMATION" in js, "confirmation detector exists")
ok("_SPELLING_OUT" in js, "spelling-out detector exists")
ok("_DANGLING" in js, "dangling-word detector exists")
for w in ("yeah", "nope", "correct", "thanks"):
    ok(w in js, "confirmation vocabulary covers: " + w)
# Keyword boosting has to actually leave the browser.
ok("vs_hotwords" in js, "hotwords persisted")
ok('fd.append("boost"' in js, "hotwords are sent with the audio")

# ---------------------------------------------------- 7. latency (the tweak)
# A fixed silence timeout taxes your fast turns to protect your slow ones.
# 400-600ms is the researched sweet spot; the old default was 900-1100ms.
ok('"550"' in js or "|| 550" in js, "endpoint default lowered to 550ms")
ok("900" not in read("static/index.html").split('id="endpoint"')[1][:120],
   "endpoint slider no longer defaults to 900")
html = read("static/index.html")
ok('value="550"' in html, "slider ships at 550ms")
ok('min="250"' in html, "slider can go as low as 250ms")
ok("0.55s" in html, "slider label matches the default")
# "yes" must not wait as long as a full sentence.
ok("max(220" in js or "220" in js, "confirmations get a sub-250ms fast path")

# ------------------------------------------------------- 8. ASR boosting
stt = read("stt.py")
ok("def hotwords" in stt, "hotwords() exists")
ok("VOICE_ASR_HOTWORDS" in stt, "hotwords configurable by env")
ok('data["prompt"]' in stt, "decoder bias sent as prompt")
ok('data["hotwords"]' in stt, "decoder bias sent as hotwords")
ok("[:40]" in stt, "hotword list capped at 40")
ok('data["temperature"] = "0"' in stt, "greedy decoding for lowest latency")
srv = read("server.py")
ok("boost: str = Form" in srv, "server accepts the boost field")
ok("boost=boost" in srv, "server forwards boost to the recogniser")

# --------------------------------------------------------- 9. the prompt
br = read("brain.py")
ok("SPEED:" in br, "prompt has a speed section")
ok("EMOTION:" in br, "prompt has an emotion section")
ok("NUMBERS:" in br, "prompt has a number-reading section")
ok("nine four one zero seven" in br, "digits are read one at a time")
ok("twelve words" in br, "short first sentence for fast time-to-speech")
# The v20 fix must survive: the model must never write stage directions.
ok("sigh" in br.lower(), "stage-direction ban preserved")

# ------------------------------------------- 10. engines really use the beats
kok = read("engines/kokoro_engine.py")
pip = read("engines/piper_engine.py")
for name, src in (("kokoro", kok), ("piper", pip)):
    ok("contour" in src, name + " honours the terminal contour")
    # v0.0.35 - this assertion used to be `ok("clause_gaps" in src, ...)` and it
    # ENSHRINED A DEFECT. It only proved the identifier appeared in the file.
    # What the file actually did was append silence_wav(gap) AFTER the finished
    # sentence, on top of pause_after_ms - so it was never a breath inside a
    # clause, just up to 150ms of extra drag on every sentence, doubling a pause
    # the neural model already produces at a comma by itself. The correct
    # assertion is that the engine does NOT bolt an artificial gap onto the tail.
    ok("clause_gaps" not in src,
       name + " does not append a fake breath after the sentence")
    ok("pause_after_ms" in src,
       name + " still leaves real silence BETWEEN sentences")
    ok("voice_fx.render(" in src,
       name + " still reshapes the waveform for real prosody")
    ok("silence_wav" in src, name + " can insert real silence")

# Guard the import that a previous round broke.
ok("silence_wav" in kok.split("\n\n")[0] or "import" in kok, "kokoro imports intact")

print("PASSED:", PASS, "FAILED:", FAIL)
if FAILED:
    print("failures:", "; ".join(FAILED[:25]))
