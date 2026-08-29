"""v0.0.44 - Pocket TTS (Piper) correctness, and emotion depth in ALL modes.

These are not source greps where execution is possible. The two worst bugs
found this round were both invisible to reading:

  * `if len(beats) > 1:` looked like a harmless optimisation. It meant a
    ONE-SENTENCE reply skipped the entire prosody chain - and short replies are
    what a support agent mostly says.
  * `detect("I am really sorry about that delay.")` returned NEUTRAL, because a
    literal cue cannot see an adverb wedged between "am" and "sorry".

So the emotion assertions below CALL detect()/plan(), and the piper synthesis
assertions drive `_synth_wav` with fake piper objects that imitate each real
piper-tts API generation, including the one that silently returns a generator.
"""
import io
import os
import re
import sys
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from engines import emotion, piper_engine, prosody, voice_fx  # noqa: E402

PIPER_SRC = open(os.path.join(HERE, "engines", "piper_engine.py")).read()
KOKORO_SRC = open(os.path.join(HERE, "engines", "kokoro_engine.py")).read()
SRV = open(os.path.join(HERE, "server.py")).read()


def _code(src):
    """Executable lines only - the fixes are documented in comments that quote
    the old broken expressions, and a naive search finds those quotes."""
    return "\n".join(
        ln for ln in src.splitlines() if not ln.lstrip().startswith("#")
    )


PIPER = _code(PIPER_SRC)
KOKORO = _code(KOKORO_SRC)

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


def _fresh_wav(sr=22050):
    buf = io.BytesIO()
    wf = wave.open(buf, "wb")
    wf.setnchannels(1)
    wf.setsampwidth(2)
    wf.setframerate(sr)
    return buf, wf


FRAME = b"\x01\x02" * 400


class _Cfg:
    def __init__(self, sr):
        self.sample_rate = sr


class ModernVoice:
    """piper-tts >= 1.3: synthesize_wav writes, synthesize is a generator."""
    def __init__(self, sr=16000):
        self.config = _Cfg(sr)
        self.used = None

    def synthesize_wav(self, text, wf, syn_config=None):
        self.used = "synthesize_wav"
        wf.writeframes(FRAME)

    def synthesize(self, text, wf=None, **kw):
        raise AssertionError("the generator API must not be used as a writer")


class GeneratorOnlyVoice:
    """The dangerous one: no writer, and synthesize() returns a generator.

    This is the shape that produced SILENT audio with no error at all.
    """
    class Chunk:
        def __init__(self, raw):
            self.audio_int16_bytes = raw

    def __init__(self, sr=22050):
        self.config = _Cfg(sr)

    def synthesize(self, text, wf=None, **kw):
        if "length_scale" in kw:
            raise TypeError("unexpected keyword argument 'length_scale'")
        return (self.Chunk(FRAME) for _ in range(3))


class LegacyVoice:
    """piper-tts 1.2.x: synthesize(text, wav, length_scale=...) writes."""
    def __init__(self, sr=22050):
        self.config = _Cfg(sr)
        self.scale = None

    def synthesize(self, text, wf=None, **kw):
        self.scale = kw.get("length_scale")
        wf.writeframes(FRAME)


class UselessVoice:
    def __init__(self):
        self.config = _Cfg(22050)


def _frames(buf):
    buf.seek(0)
    with wave.open(buf, "rb") as r:
        return r.getnframes()


# --- [1] the flat-voice bug: short replies were skipping all prosody --------
print("[1] one-sentence replies get a full performance")
check("piper no longer gates prosody on sentence count",
      "len(beats) > 1" not in PIPER)
check("kokoro no longer gates prosody on sentence count",
      "len(beats) > 1" not in KOKORO)
check("piper enters the expressive path for any beat", "if beats:" in PIPER)
check("kokoro enters the expressive path for any beat", "if beats:" in KOKORO)

for line in ("Sure, one moment.", "That's all sorted.", "Shall I refund it?"):
    beats = emotion.plan(line)
    check("a single sentence still yields a beat: %r" % line, len(beats) == 1)
    b = beats[0]
    check("it carries a terminal contour: %r" % line,
          b.contour in ("rise", "fall", "level"))
    check("it carries a real rate: %r" % line, 0.5 <= b.rate <= 2.0)

q = emotion.plan("Shall I refund it?")[0]
check("a lone yes/no question still rises", q.contour == "rise")
check("a lone statement still falls",
      emotion.plan("That's all sorted.")[0].contour == "fall")
check("a lone sentence gets no trailing silence",
      emotion.plan("That's all sorted.")[0].pause_after_ms == 0)

# --- [2] THE ADVERB BLIND SPOT (all modes) ---------------------------------
print("[2] emotion survives an adverb - this reaches every mode")
APOLOGIES = (
    "I am really sorry about that delay.",
    "I'm very sorry about this.",
    "We are truly sorry for the mix-up.",
    "I am so sorry.",
    "Sorry about the wait.",
)
for line in APOLOGIES:
    check("heard as an apology: %r" % line,
          emotion.detect(line).name == "apologetic")
check("the plain literal form still works",
      emotion.detect("I am sorry.").name == "apologetic")
check("an apology is slower than neutral",
      emotion.EMOTIONS["apologetic"].rate < 1.0)
check("an apology is pitched below neutral",
      emotion.EMOTIONS["apologetic"].pitch < 0.0)

# The v7.3 bug this change could plausibly reintroduce.
check("'I can't wait to help!' is still EXCITED, not apologetic",
      emotion.detect("I can't wait to help!").name == "excited")
check("'I really can't wait!' is still excited",
      emotion.detect("I really can't wait!").name == "excited")
# The comment in emotion.py deliberately QUOTES the wildcard it refuses to use,
# so this must search executable lines only. Same trap as v0.0.34.
check("the gap is a closed adverb list, never a wildcard",
      "(?:\\s+\\w+)*" not in _code(
          open(os.path.join(HERE, "engines", "emotion.py")).read()))
check("the refusal to use a wildcard is documented",
      "(?:\\s+\\w+)*" in open(
          os.path.join(HERE, "engines", "emotion.py")).read())
check("intensifiers are declared", len(emotion._INTENSIFIERS) >= 10)
check("patterns are cached for speed", isinstance(emotion._FLEX_CACHE, dict))
emotion.detect("I am really sorry about that.")
check("the cache actually fills", len(emotion._FLEX_CACHE) > 0)

OTHERS = (
    ("Take your time, no rush at all.", "patient"),
    ("Thanks so much for waiting.", "grateful"),
    ("Let me check that for you.", "thinking"),
    ("Don't worry, I can help.", "reassuring"),
    ("I do understand how frustrating that is.", "empathetic"),
)
for line, want in OTHERS:
    check("%s still detected" % want, emotion.detect(line).name == want)

# --- [3] patient is finally rendered as the slow emotion it is -------------
print("[3] planned emotion == rendered emotion")
check("patient is treated as a heavy/slow delivery",
      "patient" in voice_fx._HEAVY)
check("patient really is defined slow", emotion.EMOTIONS["patient"].rate < 1.0)
for name in voice_fx._HEAVY:
    check("heavy emotion %s exists and is not faster than neutral" % name,
          name in emotion.EMOTIONS and emotion.EMOTIONS[name].rate <= 1.0)
check("no fast emotion was mislabelled heavy",
      "excited" not in voice_fx._HEAVY and "happy" not in voice_fx._HEAVY)

# --- [4] Pocket TTS sample rate ------------------------------------------
print("[4] Pocket TTS uses the voice's real sample rate")
check("_voice_sr exists", hasattr(piper_engine, "_voice_sr"))
check("a 16kHz voice is reported as 16kHz",
      piper_engine._voice_sr(ModernVoice(16000)) == 16000)
check("a 22.05kHz voice is reported as 22050",
      piper_engine._voice_sr(LegacyVoice(22050)) == 22050)
check("a nonsense rate falls back to a sane default",
      piper_engine._voice_sr(ModernVoice(0)) == 22050)
check("a voice with no config cannot crash synthesis",
      piper_engine._voice_sr(object()) == 22050)
check("the expressive path no longer hardcodes 22050",
      "silence_wav(gap, 22050)" not in PIPER
      and "sample_rate=22050" not in PIPER)
check("silence is generated at the voice's rate",
      "silence_wav(b.pause_after_ms, sr)" in PIPER)

# --- [5] the silent-audio landmine: piper API drift ----------------------
print("[5] synthesis works on every piper-tts generation")
check("_synth_wav exists", hasattr(piper_engine, "_synth_wav"))

buf, wf = _fresh_wav()
mv = ModernVoice()
piper_engine._synth_wav(mv, "hello there", wf, 1.0)
wf.close()
check("modern piper writes audio", _frames(buf) > 0)
check("modern piper uses the writer, not the generator",
      mv.used == "synthesize_wav")

buf, wf = _fresh_wav()
piper_engine._synth_wav(GeneratorOnlyVoice(), "hello there", wf, 1.0)
wf.close()
check("a generator-returning piper no longer yields SILENCE",
      _frames(buf) > 0)

buf, wf = _fresh_wav()
lv = LegacyVoice()
piper_engine._synth_wav(lv, "hello there", wf, 1.25)
wf.close()
check("legacy piper writes audio", _frames(buf) > 0)
check("legacy piper still receives the speed", lv.scale is not None)
check("speed is clamped to a safe range", 0.5 <= (lv.scale or 1) <= 2.0)

buf, wf = _fresh_wav()
lv2 = LegacyVoice()
piper_engine._synth_wav(lv2, "x", wf, 99.0)
wf.close()
check("an absurd length_scale is clamped, not passed through",
      (lv2.scale or 0) <= 2.0)

buf, wf = _fresh_wav()
try:
    piper_engine._synth_wav(UselessVoice(), "hello", wf, 1.0)
    raised = False
except Exception:
    raised = True
wf.close()
check("an unusable piper build fails loudly instead of going silent", raised)
check("no bare synthesize(text, wav) retry survives",
      "pv.synthesize(spoken, swf)" not in PIPER)
check("prepare() is not called twice per utterance",
      PIPER.count("self.prepare(text)") <= 1)

# --- [6] the fake intra-sentence breath is gone -------------------------
print("[6] the clause gap no longer inflates every pause")
check("piper does not append a clause gap after the sentence",
      "clause_gaps" not in PIPER)
check("kokoro does not append a clause gap after the sentence",
      "clause_gaps" not in KOKORO)
check("the real inter-sentence pause is still applied (piper)",
      "b.pause_after_ms" in PIPER)
check("the real inter-sentence pause is still applied (kokoro)",
      "b.pause_after_ms" in KOKORO)
check("the planner still reports clause gaps for engines that can use them",
      len(emotion.plan("First, we check it, then we fix it.")[0].clause_gaps) > 0)

# --- [7] the prosody chain is still reached in both engines -------------
print("[7] prosody chain intact")
for label, src in (("piper", PIPER), ("kokoro", KOKORO)):
    check("%s renders through voice_fx" % label, "voice_fx.render(" in src)
    check("%s passes the emotion through" % label, "emotion=" in src)
    check("%s passes the contour through" % label, "contour=" in src)
    check("%s passes the pitch offset through" % label, "pitch_st=" in src)
check("the piper fallback path is also rendered now",
      PIPER.count("voice_fx.render(") >= 2)
check("tags are still only added for engines that understand them",
      "[laugh]" not in PIPER and "[sigh]" not in PIPER)
for t in prosody.TAGS:
    check("tag %r is a bare name, still not invented syntax" % t,
          "[" not in t and "]" not in t)

# --- [8] speed: detection must stay cheap ------------------------------
print("[8] the emotion fix costs effectively nothing")
import time  # noqa: E402
sample = "I am really sorry about that delay and the confusion it caused."
t0 = time.perf_counter()
for _ in range(500):
    emotion.detect(sample)
per_ms = (time.perf_counter() - t0) / 500 * 1000
check("detect() stays under 1ms per sentence (was ~0.04ms)", per_ms < 1.0)

t0 = time.perf_counter()
for _ in range(200):
    emotion.plan("I am really sorry. Let me check that now. It is fixed.")
plan_ms = (time.perf_counter() - t0) / 200 * 1000
check("plan() of a 3-sentence reply stays under 5ms", plan_ms < 5.0)

# --- [9] version -----------------------------------------------------
print("[9] version")
check("version bumped to 0.0.51", 'VERSION = "0.0.51"' in SRV)

print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
if fails:
    print("failures: " + "; ".join(fails))
sys.exit(1 if FAIL else 0)
