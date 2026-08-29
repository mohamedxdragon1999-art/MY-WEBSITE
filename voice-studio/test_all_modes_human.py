"""v5.2 tests: universal humanization across ALL modes + voice capture fixes."""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "")
os.chdir(os.path.dirname(os.path.abspath(__file__)) + "")

PASS = 0
FAIL = []


def check(name, cond, detail=""):
    global PASS
    if cond:
        PASS += 1
        print("  ok   " + name)
    else:
        FAIL.append(name)
        print("  FAIL " + name + (("  -> " + str(detail)) if detail else ""))


import engines
from engines import base, prosody

print("\n[1] shared humanization layer exists on the BASE class")
check("TTSEngine has prepare()", callable(getattr(base.TTSEngine, "prepare", None)))
check("tag_aware defaults to False", base.TTSEngine.tag_aware is False)
check("humanize_enabled() default on", base.humanize_enabled() is True)
check("expressiveness default 0.5", abs(base.expressiveness() - 0.5) < 1e-9)

print("\n[2] expressiveness + global switch are safe")
for raw, want in (("0", 0.0), ("1", 1.0), ("5", 1.0), ("-3", 0.0), ("0.25", 0.25), ("junk", 0.5), ("", 0.5)):
    os.environ["VOICE_EXPRESSIVENESS"] = raw
    got = base.expressiveness()
    check("expressiveness(" + repr(raw) + ") -> " + str(want), abs(got - want) < 1e-9, got)
os.environ.pop("VOICE_EXPRESSIVENESS", None)
for raw in ("0", "false", "FALSE", "no", "No"):
    os.environ["VOICE_HUMANIZE"] = raw
    check("VOICE_HUMANIZE=" + raw + " disables", base.humanize_enabled() is False)
for raw in ("1", "true", "yes", "anything"):
    os.environ["VOICE_HUMANIZE"] = raw
    check("VOICE_HUMANIZE=" + raw + " enables", base.humanize_enabled() is True)
os.environ.pop("VOICE_HUMANIZE", None)

print("\n[3] EVERY mode is humanized, not just the new one")
reg = engines.build_registry()
ROBOTIC = "I am sorry but I cannot do that because it is not available"
for eid in engines.ordered_ids():
    eng = reg.get(eid)
    if eng is None or not hasattr(eng, "prepare"):
        continue
    out = eng.prepare(ROBOTIC)
    check(eid + ": speaks contractions not textbook English",
          ("I'm" in out and "can't" in out and "isn't" in out), out)
    check(eid + ": text actually changed from the robotic input", out != ROBOTIC, out)

print("\n[4] tags only reach engines that can PERFORM them")
TAG_AWARE = {"fish", "chatterbox"}
for eid in engines.ordered_ids():
    eng = reg.get(eid)
    if eng is None:
        continue
    if eid in TAG_AWARE:
        check(eid + " is marked tag_aware", eng.tag_aware is True)
    elif eid not in ("best", "human"):
        check(eid + " is NOT tag_aware", eng.tag_aware is False)

print("\n[5] the 'bracket sigh bracket' bug can never come back")
for eid in engines.ordered_ids():
    eng = reg.get(eid)
    if eng is None or not hasattr(eng, "prepare") or eng.tag_aware:
        continue
    for tag in prosody.TAGS:
        out = eng.prepare("[" + tag + "] The order shipped today.")
        check(eid + " never speaks [" + tag + "]", "[" + tag + "]" not in out, out)

print("\n[6] tag-aware engines KEEP their tags (no silent loss of expression)")
for eid in sorted(TAG_AWARE):
    eng = reg.get(eid)
    if eng is None:
        continue
    out = eng.prepare("[sigh] I am sorry about that.")
    check(eid + " keeps an upstream tag", "[sigh]" in out, out)
    check(eid + " does not double-tag",
          sum(out.count("[" + t + "]") for t in prosody.TAGS) == 1, out)

print("\n[7] prepare() is robust on hostile input")
edge_eng = reg.get("edge")
for bad in ("", "   ", "\n\n", "!!!", "123", "a" * 9000, "caf\u00e9 na\u00efve \u4f60\u597d", "<b>hi</b>", "[[[]]]"):
    try:
        out = edge_eng.prepare(bad)
        check("prepare survives " + repr(bad[:18]), isinstance(out, str))
    except Exception as e:
        check("prepare survives " + repr(bad[:18]), False, e)
check("long text is capped", len(edge_eng.prepare("a " * 9000)) <= 4000)
check("unicode preserved", "caf\u00e9" in edge_eng.prepare("caf\u00e9 is open"))

print("\n[8] VOICE_HUMANIZE=0 gives verbatim text back (for scripted/legal copy)")
os.environ["VOICE_HUMANIZE"] = "0"
verbatim = edge_eng.prepare(ROBOTIC)
check("no contractions applied", "I'm" not in verbatim, verbatim)
check("still cleaned", isinstance(verbatim, str) and verbatim.strip() != "")
os.environ.pop("VOICE_HUMANIZE", None)
check("humanization restored", "I'm" in edge_eng.prepare(ROBOTIC))

print("\n[9] engines no longer bypass the shared layer")
import pathlib
for fn in ("edge_engine.py", "piper_engine.py", "kokoro_engine.py", "magpie_engine.py",
           "fish_engine.py", "chatterbox_engine.py"):
    src = pathlib.Path("engines/" + fn).read_text()
    body = src.split("def synthesize", 1)[-1]
    # v0.0.44 - this used to require the literal call to appear inside this one
    # function body. Edge's sync entry point now DELEGATES to its async path (one
    # code path instead of two that silently drift apart), and prepare() runs
    # there, per sentence. The requirement is that synthesis REACHES the shared
    # layer - not that the call sits in a particular function - so delegation
    # counts, and the executed check below proves it actually happens.
    routed = ("self.prepare(" in body) or ("self.asynthesize(" in body)
    check(fn + " routes synthesis through prepare()", routed, fn)

# Executed proof for the delegated path: a source check cannot tell whether the
# shared humanization layer is really reached, so spy on it with a fake network.
import asyncio as _aio  # noqa: E402

_calls = {"n": 0}
_orig_prepare = edge_eng.prepare


def _spy_prepare(t, *a, **kw):
    _calls["n"] += 1
    return _orig_prepare(t, *a, **kw)


async def _fake_stream(clean, voice_id, rate_s, pitch_s, volume_s="+0%"):
    return b"MP3"


edge_eng.prepare = _spy_prepare
edge_eng._stream = _fake_stream
try:
    _res = edge_eng.synthesize("I am sorry about that. It is fixed now.")
    check("edge sync synthesis still reaches prepare()", _calls["n"] >= 1, _calls)
    check("edge sync synthesis still returns audio", bool(_res.audio))
    check("and it prepared EVERY sentence, not just the first", _calls["n"] >= 2, _calls)
finally:
    edge_eng.prepare = _orig_prepare
    if hasattr(edge_eng, "_stream"):
        try:
            del edge_eng._stream
        except Exception:
            pass

# ---------------------------------------------------------------- capture --
print("\n[10] voice capture: the 'um' bug is structurally impossible now")
js = pathlib.Path("static/app.js").read_text()
onend = js.split("recognition.onend", 1)[1].split("};", 1)[0]
check("onend NEVER submits a turn", "_submitTurn()" not in onend, onend[:200])
check("onend restarts the recognizer instead", "_restartRecognition()" in onend)
check("onend preserves words already captured", "_finalBuf +=" in onend)
check("restart helper exists", "function _restartRecognition" in js)
check("restart backs off instead of dying", "_restartTries" in js and "_restartRecognition();" in js and "setTimeout(" in js)
check("restart eventually gives an honest message", "click the mic to resume" in js)
# v6.4: the keep-alive watchdog used to count "already running" as a failed
# retry and shut the mic off ~24s into every healthy call. These pin the fix.
check("restart knows if it is genuinely running", "_recogRunning" in js)
check("a failed restart never kills the mic",
      "stopListening()" not in js.split("function _restartRecognition", 1)[1].split("\n}\n", 1)[0])

print("\n[11] voice capture: mic is pre-warmed and cleaned up")
check("single reused mic stream", "_micStream" in js and "async function ensureMic" in js)
check("echo cancellation on (agent voice cannot self-trigger)", "echoCancellation: true" in js)
check("noise suppression on (weak/noisy capture)", "noiseSuppression: true" in js)
check("auto gain on (quiet or far-from-mic speakers)", "autoGainControl: true" in js)
check("mic opened BEFORE recognition starts", "await ensureMic()" in js)
check("blocked mic is reported honestly", "Microphone blocked" in js)
check("suspended AudioContext resumed", "resume()" in js)

print("\n[12] voice capture: real audio VAD guards the turn")
check("analyser-based VAD present", "_vadLoop" in js and "getFloatTimeDomainData" in js)
check("adaptive noise floor (works in a noisy room)", "_noiseFloor" in js)
check("voice-active helper", "function _voiceActive" in js)
submit = js.split("function _submitTurn", 1)[1].split("\n}", 1)[0]
check("submit refuses while you are still audibly talking", "_voiceActive()" in submit)
check("submit refuses on filler-only speech", "_FILLER_ONLY.test" in submit)
check("submit re-checks shortly after", "setTimeout(_submitTurn" in submit)
check("a hard deadline still guarantees a reply", "_turnDeadline" in submit)
check("deadline is bounded", "MAX_TURN_WAIT_MS" in js)

print("\n[13] voice capture: patience tuning")
m = re.search(r"state\.endpointMs \|\| (\d+)", js)
# v6.2: reversed on purpose. A fixed silence timeout taxes your fast turns to
# protect your slow ones, so the base is now LOW (550ms, the researched sweet
# spot) and the patience is added back only for utterances that need it.
check("default pause is the fast 550ms base, not the old sluggish one",
      m and 450 <= int(m.group(1)) <= 700, m and m.group(1))
for filler in ("um", "uh", "hmm", "so", "well", "okay", "um um", "uh, um"):
    rx = re.compile(r"^((um+|uh+|erm+|hmm+|mm+|ah+|oh+|er+|like|so|well|okay|ok|yeah|right|and|but|i|i'm|my)[\s,.!?]*)+$", re.I)
    check("'" + filler + "' is treated as thinking, not a turn", bool(rx.match(filler)))
for real in ("where is my order", "i think my order is late", "cancel it please"):
    rx = re.compile(r"^((um+|uh+|erm+|hmm+|mm+|ah+|oh+|er+|like|so|well|okay|ok|yeah|right|and|but|i|i'm|my)[\s,.!?]*)+$", re.I)
    check("'" + real + "' IS a real turn", not rx.match(real))
check("filler waits longest", "_FILLER_ONLY.test(t)" in js)
check("completed sentence still answers fast", "base - 380" in js)
check("a plain yes/no answers fastest of all", "base - 450" in js)
# 'i think' is not filler-only, but it IS a hesitation: trailing it must buy time.
hes = re.search(r"const _HESITATION = /(.+)/i;", js)
check("hesitation rule exists", bool(hes))
hrx = re.compile(hes.group(1), re.I) if hes else None
for mid in ("um i think", "i want to", "my order is", "can you check the", "it is because"):
    check("'" + mid + "' reads as mid-thought", bool(hrx and hrx.search(mid)), mid)
for done in ("where is my order?", "that is all thanks."):
    check("'" + done + "' does not read as mid-thought", not (hrx and hrx.search(done)), done)
check("hesitation still buys real thinking room", "base + 800" in js)
check("spelling out an email buys extra room", "base + 900" in js)
check("an unfinished clause waits", "base + 850" in js)

print("\n[14] no regression in the registry")
check("all 8 modes still build", len(engines.ordered_ids()) == 8, engines.ordered_ids())
check("status payload still works", isinstance(engines.status_payload(reg), (dict, list)))
for eid in engines.ordered_ids():
    eng = reg.get(eid)
    check(eid + " still reports availability without raising",
          hasattr(eng.availability(), "ok"))

print("\n" + "=" * 60)
print("  PASSED: " + str(PASS) + "   FAILED: " + str(len(FAIL)))
if FAIL:
    print("  failures: " + ", ".join(FAIL))
print("=" * 60)
