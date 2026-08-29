"""v0.0.51 - CPU-only deployment policy.

This release makes the product honest about the hardware it actually runs on.
Before v51 two routers listed GPU-only engines AHEAD of the one engine that can
serve audio on a CPU box, so every request paid for failing attempts first.

What is verified here:
  1. cpu_profile classification and env switches
  2. filter_order safety (dedupe, order preservation, NEVER empty)
  3. split_for_cpu correctness (no torn words, respects the cap, lossless)
  4. thread bounding
  5. that the three routers are actually wired to the policy, at source level

Stdlib only, so it runs anywhere - including a box with no fastapi installed.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engines import cpu_profile  # noqa: E402

PASSED = 0
FAILED = 0
_failures = []


def check(label, cond, extra=""):
    global PASSED, FAILED
    if cond:
        PASSED += 1
    else:
        FAILED += 1
        _failures.append(label + (("  -> " + str(extra)) if extra else ""))
        print("FAIL " + label + (("  -> " + str(extra)) if extra else ""))


def section(name):
    print("\n== " + name + " ==")


class Env:
    """Temporarily set env vars, restoring exactly what was there before."""

    def __init__(self, **kw):
        self.kw = kw
        self.old = {}

    def __enter__(self):
        for k, v in self.kw.items():
            self.old[k] = os.environ.get(k)
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        return self

    def __exit__(self, *a):
        for k, v in self.old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        return False


def read(path):
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), path),
              "r", encoding="utf-8") as fh:
        return fh.read()


# --------------------------------------------------------------------------
section("defaults")

with Env(VOICE_CPU_ONLY=None, VOICE_ALLOW_NONCOMMERCIAL=None):
    check("CPU-only is ON by default", cpu_profile.enabled() is True)
    check("non-commercial engines OFF by default",
          cpu_profile.allow_non_commercial() is False)
    blocked = cpu_profile.blocked_engines()
    check("fish blocked by default", "fish" in blocked, sorted(blocked))
    check("chatterbox blocked by default", "chatterbox" in blocked, sorted(blocked))
    for eid in ("kokoro", "edge", "piper", "magpie"):
        check("%s allowed by default" % eid, cpu_profile.is_allowed(eid))
    for eid in ("best", "human"):
        check("router %s is never blocked" % eid, cpu_profile.is_allowed(eid))

    check("empty engine id is not allowed", cpu_profile.is_allowed("") is False)
    check("is_allowed is case-insensitive", cpu_profile.is_allowed("  KOKORO ") is True)
    check("blocked id is case-insensitive", cpu_profile.is_allowed("Fish") is False)


# --------------------------------------------------------------------------
section("env switches")

with Env(VOICE_CPU_ONLY="0", VOICE_ALLOW_NONCOMMERCIAL=None):
    check("VOICE_CPU_ONLY=0 re-enables chatterbox", cpu_profile.is_allowed("chatterbox"))
    check("fish STILL blocked on licence grounds alone",
          cpu_profile.is_allowed("fish") is False,
          "licence block must be independent of the GPU block")

with Env(VOICE_CPU_ONLY="0", VOICE_ALLOW_NONCOMMERCIAL="1"):
    check("both switches off => fish allowed", cpu_profile.is_allowed("fish"))

with Env(VOICE_CPU_ONLY="1", VOICE_ALLOW_NONCOMMERCIAL="1"):
    check("licence waiver does not grant a GPU",
          cpu_profile.is_allowed("fish") is False)

with Env(VOICE_CPU_ONLY="banana"):
    check("junk env falls back to the safe default", cpu_profile.enabled() is True)

for truthy in ("1", "true", "TRUE", "yes", "on"):
    with Env(VOICE_CPU_ONLY=truthy):
        check("env %r parses truthy" % truthy, cpu_profile.enabled() is True)
for falsy in ("0", "false", "FALSE", "no", "off"):
    with Env(VOICE_CPU_ONLY=falsy):
        check("env %r parses falsy" % falsy, cpu_profile.enabled() is False)


# --------------------------------------------------------------------------
section("block_reason is actionable")

with Env(VOICE_CPU_ONLY=None, VOICE_ALLOW_NONCOMMERCIAL=None):
    r_fish = cpu_profile.block_reason("fish")
    r_chat = cpu_profile.block_reason("chatterbox")
    check("fish reason mentions the GPU", "GPU" in r_fish, r_fish)
    check("fish reason mentions the licence", "non-commercial" in r_fish, r_fish)
    check("fish reason names the env var", "VOICE_CPU_ONLY" in r_fish, r_fish)
    check("chatterbox reason mentions the GPU", "GPU" in r_chat, r_chat)
    check("chatterbox reason omits the licence",
          "non-commercial" not in r_chat, r_chat)
    check("allowed engine has no reason", cpu_profile.block_reason("kokoro") == "")


# --------------------------------------------------------------------------
section("filter_order safety")

with Env(VOICE_CPU_ONLY=None, VOICE_ALLOW_NONCOMMERCIAL=None):
    old_ladder = ["human", "fish", "chatterbox", "kokoro", "edge", "piper", "magpie"]
    got = cpu_profile.filter_order(old_ladder)
    check("v48 ladder loses fish", "fish" not in got, got)
    check("v48 ladder loses chatterbox", "chatterbox" not in got, got)
    check("v48 ladder keeps kokoro", "kokoro" in got, got)
    check("relative order preserved", got.index("kokoro") < got.index("edge"), got)
    check("router survives filtering", "human" in got, got)

    check("duplicates are removed",
          cpu_profile.filter_order(["kokoro", "kokoro", "edge"]) == ["kokoro", "edge"])
    check("blank entries are ignored",
          cpu_profile.filter_order(["", "  ", "kokoro"]) == ["kokoro"])
    check("whitespace is trimmed",
          cpu_profile.filter_order(["  kokoro "]) == ["kokoro"])

    # The single most important guarantee: we would rather speak with a worse
    # voice than not speak at all.
    fallback = cpu_profile.filter_order(["fish", "chatterbox"])
    check("all-blocked ladder does NOT come back empty", len(fallback) > 0, fallback)
    check("all-blocked ladder falls back to CPU-safe engines",
          fallback[0] == "kokoro", fallback)
    check("empty input does not come back empty",
          len(cpu_profile.filter_order([])) > 0)
    check("None input is survivable", len(cpu_profile.filter_order(None)) > 0)

    pref = cpu_profile.preferred_order()
    check("preferred order leads with kokoro", pref[0] == "kokoro", pref)
    check("preferred order contains no blocked engine",
          not (set(pref) & cpu_profile.blocked_engines()), pref)


# --------------------------------------------------------------------------
section("split_for_cpu")

with Env(VOICE_CPU_CHUNK_CHARS=None):
    cap = cpu_profile.max_synth_chars()
    check("default chunk cap is 180", cap == 180, cap)

    check("empty text -> no pieces", cpu_profile.split_for_cpu("") == [])
    check("whitespace -> no pieces", cpu_profile.split_for_cpu("   ") == [])
    check("short text passes through unchanged",
          cpu_profile.split_for_cpu("Hello there.") == ["Hello there."])

    long_text = " ".join(["word"] * 200)
    pieces = cpu_profile.split_for_cpu(long_text)
    check("long text is split", len(pieces) > 1, len(pieces))
    check("every piece is within the cap",
          all(len(p) <= cap for p in pieces), [len(p) for p in pieces])
    check("no piece is empty", all(p.strip() for p in pieces))
    # Lossless: splitting must not drop or duplicate a single word.
    check("split is lossless",
          " ".join(pieces).split() == long_text.split(),
          "%d vs %d words" % (len(" ".join(pieces).split()), len(long_text.split())))
    check("no word is torn in half",
          all(w == "word" for w in " ".join(pieces).split()))

    # Pathological input must terminate rather than loop forever.
    monster = "x" * 1000
    mono = cpu_profile.split_for_cpu(monster)
    check("single huge token still terminates", len(mono) > 1, len(mono))
    check("huge token pieces respect the cap", all(len(p) <= cap for p in mono))
    check("huge token is not corrupted", "".join(mono) == monster)

    exact = "a" * cap
    check("text exactly at the cap is not split",
          cpu_profile.split_for_cpu(exact) == [exact])

with Env(VOICE_CPU_CHUNK_CHARS="60"):
    check("cap is configurable", cpu_profile.max_synth_chars() == 60)
    small = cpu_profile.split_for_cpu(" ".join(["word"] * 100))
    check("smaller cap yields more pieces", len(small) > 5, len(small))
    check("smaller cap is respected", all(len(p) <= 60 for p in small))

with Env(VOICE_CPU_CHUNK_CHARS="5"):
    check("absurdly small cap is clamped up", cpu_profile.max_synth_chars() == 60)
with Env(VOICE_CPU_CHUNK_CHARS="99999"):
    check("absurdly large cap is clamped down", cpu_profile.max_synth_chars() == 400)
with Env(VOICE_CPU_CHUNK_CHARS="not-a-number"):
    check("junk cap falls back to default", cpu_profile.max_synth_chars() == 180)

check("explicit limit argument overrides env",
      all(len(p) <= 40 for p in cpu_profile.split_for_cpu(" ".join(["ab"] * 100), 40)))


# --------------------------------------------------------------------------
section("thread bounding")

with Env(VOICE_CPU_THREADS=None):
    t = cpu_profile.worker_threads()
    check("thread count is at least 1", t >= 1, t)
    check("thread count leaves headroom",
          t <= max(1, (os.cpu_count() or 1) - 1) or (os.cpu_count() or 1) <= 2, t)

with Env(VOICE_CPU_THREADS="3"):
    check("explicit thread count is honoured", cpu_profile.worker_threads() == 3)
with Env(VOICE_CPU_THREADS="0"):
    check("zero threads falls back to auto", cpu_profile.worker_threads() >= 1)
with Env(VOICE_CPU_THREADS="junk"):
    check("junk thread count falls back to auto", cpu_profile.worker_threads() >= 1)


# --------------------------------------------------------------------------
section("describe()")

d = cpu_profile.describe()
for key in ("cpu_only", "allow_non_commercial", "blocked", "preferred_order",
            "max_synth_chars", "worker_threads"):
    check("describe() exposes %s" % key, key in d, sorted(d))
check("describe() blocked list is sorted", d["blocked"] == sorted(d["blocked"]))


# --------------------------------------------------------------------------
section("routers are actually wired to the policy")

srv = read("server.py")
check("server imports cpu_profile", "from engines import cpu_profile" in srv)
check("server builds the ladder through the filter",
      "_FALLBACK_ORDER = cpu_profile.filter_order(" in srv)
check("server no longer hardcodes the GPU-first ladder",
      '_FALLBACK_ORDER = ["human", "fish", "chatterbox"' not in srv)

hum = read("engines/human_engine.py")
check("human_engine imports cpu_profile", "cpu_profile" in hum)
check("human_engine leads with kokoro",
      '_DEFAULT_ORDER = ["kokoro"' in hum)
check("human_engine filters its ladder",
      "cpu_profile.filter_order" in hum)
check("human_engine filters an explicit HUMAN_ORDER too",
      hum.count("cpu_profile.filter_order") >= 2,
      hum.count("cpu_profile.filter_order"))

best = read("engines/best_engine.py")
check("best_engine filters its ladder", "cpu_profile.filter_order" in best)
check("best_engine leads with kokoro", '["kokoro", "edge", "piper", "magpie"]' in best)

kok = read("engines/kokoro_engine.py")
check("kokoro uses the chunked create helper", "def _create(" in kok)
check("kokoro beats path uses _create", "_create(model, spoken" in kok)
check("kokoro single-shot path uses _create", "_create(model, self.prepare(text)" in kok)
check("kokoro no longer calls model.create directly in synthesize",
      "model.create(spoken" not in kok)
check("kokoro supports int8 weights", "_ONNX_INT8" in kok)
check("kokoro resolves weights via _model_path", "def _model_path(" in kok)
check("kokoro bounds its thread pool", "_apply_cpu_threads" in kok)
check("kokoro availability uses _model_path", "_model_path() and _VOICES_BIN.exists()" in kok)


# --------------------------------------------------------------------------
section("live ladders contain nothing unusable")

import engines.best_engine as _best  # noqa: E402
import engines.human_engine as _human  # noqa: E402

blocked_now = cpu_profile.blocked_engines()
check("best_engine priority has no blocked engine",
      not (set(_best._PRIORITY) & blocked_now), _best._PRIORITY)
check("best_engine priority leads with kokoro",
      _best._PRIORITY and _best._PRIORITY[0] == "kokoro", _best._PRIORITY)
check("human_engine order has no blocked engine",
      not (set(_human._order()) & blocked_now), _human._order())
check("human_engine order leads with kokoro",
      _human._order()[0] == "kokoro", _human._order())

with Env(HUMAN_ORDER="fish,chatterbox"):
    forced = _human._order()
    check("HUMAN_ORDER cannot force a GPU engine onto a CPU box",
          not (set(forced) & blocked_now), forced)
    check("forced-but-filtered order still speaks", len(forced) > 0, forced)

with Env(HUMAN_ORDER="piper,kokoro"):
    check("a valid HUMAN_ORDER is still respected",
          _human._order() == ["piper", "kokoro"], _human._order())


# --------------------------------------------------------------------------
section("version")

check("version bumped to 0.0.51", 'VERSION = "0.0.51"' in srv)


# --------------------------------------------------------------------------
section("v51 audit: the client-supplied mode was bypassing the policy")

# The original v51 filtered _FALLBACK_ORDER but NOT the requested mode, which
# is client-supplied. {"mode": "fish"} therefore still put a GPU-only,
# non-commercially-licensed engine at the head of the chain.
check("http dispatch uses the filtered helper",
      "candidates = _candidates(req.mode)" in srv)
check("realtime dispatch uses the filtered helper",
      "for eid in _candidates(mode):" in srv)
check("the unfiltered prepend is gone (http)",
      "[req.mode] + [m for m in _FALLBACK_ORDER" not in srv)
check("the unfiltered prepend is gone (realtime)",
      "[mode] + [e for e in _FALLBACK_ORDER" not in srv)
check("blocked mode is dropped, not merely demoted",
      "fish" not in cpu_profile.filter_order(["fish", "kokoro", "edge"]))
check("asking for fish still yields a working ladder",
      cpu_profile.filter_order(["fish", "kokoro", "edge"])[0] == "kokoro")
check("asking for chatterbox is dropped too",
      "chatterbox" not in cpu_profile.filter_order(["chatterbox", "kokoro"]))
check("requested engine is never attempted twice",
      cpu_profile.filter_order(["kokoro", "kokoro", "edge"]) == ["kokoro", "edge"])
check("an all-blocked request still returns a usable ladder",
      len(cpu_profile.filter_order(["fish", "chatterbox"])) > 0)
check("health exposes the active policy",
      '"cpu_profile": cpu_profile.describe()' in srv)


# --------------------------------------------------------------------------
section("v51 audit: blocked engines must not be advertised as ready")

# A blocked engine reporting ok=True would appear in the mode picker, and the
# moment a user selected it we would be back to attempting an impossible one.
from engines import build_registry, status_payload  # noqa: E402

_rows = {e["id"]: e for e in status_payload(build_registry())}
check("fish is still listed (operator can see why)", "fish" in _rows)
check("chatterbox is still listed", "chatterbox" in _rows)
check("fish is never advertised as ready",
      _rows["fish"]["availability"]["ok"] is False)
check("chatterbox is never advertised as ready",
      _rows["chatterbox"]["availability"]["ok"] is False)
check("fish explains the block",
      "Disabled here" in _rows["fish"]["availability"]["reason"],
      _rows["fish"]["availability"]["reason"])
check("fish names the licence problem too",
      "non-commercial" in _rows["fish"]["availability"]["reason"],
      _rows["fish"]["availability"]["reason"])
check("chatterbox explains the GPU requirement",
      "GPU" in _rows["chatterbox"]["availability"]["reason"],
      _rows["chatterbox"]["availability"]["reason"])
check("kokoro is NOT blocked by policy",
      "Disabled here" not in _rows["kokoro"]["availability"]["reason"],
      _rows["kokoro"]["availability"]["reason"])
check("piper is NOT blocked by policy",
      "Disabled here" not in _rows["piper"]["availability"]["reason"])
check("routers are NOT blocked by policy",
      "Disabled here" not in _rows["human"]["availability"]["reason"])


# --------------------------------------------------------------------------
section("v51 audit: splitting must not invent sentence endings")

# A neural TTS renders each piece as a complete utterance. Cutting at an
# arbitrary space drops a falling, sentence-final intonation into the MIDDLE
# of a sentence, so one sentence audibly becomes two. Prefer clause boundaries.
_para = ("The refund was processed on Tuesday, and the money should appear in "
         "your account within three working days; if it has not arrived by "
         "Friday, please call us back and we will escalate it immediately.")
_pieces = cpu_profile.split_for_cpu(_para)
check("long text is actually split", len(_pieces) > 1, len(_pieces))
check("first cut lands on a clause boundary",
      _pieces[0].rstrip()[-1] in ",;:", _pieces[0][-30:])
check("every piece respects the cap",
      all(len(p) <= cpu_profile.max_synth_chars() for p in _pieces),
      [len(p) for p in _pieces])
check("splitting is lossless", " ".join(_pieces) == _para)
check("no piece is a stub fragment",
      all(len(p.split()) >= 2 for p in _pieces),
      [len(p.split()) for p in _pieces])

# Text with no punctuation at all must still split, on whitespace.
_nopunct = " ".join("word%d" % i for i in range(60))
_np_pieces = cpu_profile.split_for_cpu(_nopunct)
check("punctuation-free text still splits", len(_np_pieces) > 1)
check("punctuation-free split is lossless", " ".join(_np_pieces) == _nopunct)
check("punctuation-free split tears no word",
      all(w.startswith("word") for p in _np_pieces for w in p.split()))

# A clause boundary that appears too early must NOT be used, or we emit stubs.
_early = "Yes, " + ("alpha beta gamma delta " * 20).strip()
_e_pieces = cpu_profile.split_for_cpu(_early)
check("an over-early clause cut is ignored",
      len(_e_pieces[0]) > cpu_profile.max_synth_chars() // 3,
      len(_e_pieces[0]))
check("early-clause split is lossless", " ".join(_e_pieces) == _early)


print("\n" + "=" * 46)
if _failures:
    print("failures:")
    for f in _failures:
        print("  - " + f)
print("PASSED: %d   FAILED: %d" % (PASSED, FAILED))
sys.exit(1 if FAILED else 0)
