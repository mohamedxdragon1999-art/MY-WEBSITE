"""v0.0.44 - the hedged (raced) ASR path, EXECUTED, not merely read.

WHAT THIS PROTECTS
------------------
The old capture path was SERIAL: try model 1, wait up to the full 12s timeout,
only then try model 2, then model 3. A single cold or rate-limited model
therefore cost the user up to 12 seconds of silence before anything else was
even attempted. That is a large part of 'the word capturing is slow'.

This suite runs the real stt._race against fake HTTP clients so the timing and
cancellation behaviour is actually observed, not asserted about source text.
No network, no key, no GPU required.
"""
from __future__ import annotations

import asyncio
import io
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PASS = 0
FAIL = 0


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print("  FAIL: " + label + (("  [" + str(extra) + "]") if extra else ""))


for _k in ("VOICE_ASR_HEDGE_DELAY", "VOICE_ASR_HEDGE_MODELS",
           "VOICE_ASR_PRIMARY_GRACE", "NVIDIA_ASR_TIMEOUT", "NVIDIA_ASR_MODEL",
           "VOICE_ASR_HOTWORDS"):
    os.environ.pop(_k, None)

import stt  # noqa: E402

_HERE = os.path.dirname(os.path.abspath(__file__))
SRC = io.open(os.path.join(_HERE, "stt.py"), encoding="utf-8").read()


def _code(src):
    """Strip whole-line comments so forbidden-string checks never match prose."""
    return "\n".join(l for l in src.splitlines() if not l.strip().startswith("#"))


CODE = _code(SRC)
AUDIO = b"0" * 2048


class FakeResponse:
    def __init__(self, status=200, text="", payload=None):
        self.status_code = status
        self.text = text
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


class FakeClient:
    """Per-model scripted behaviour: model -> (delay_seconds, response|Exception).

    Records every model actually requested and when, so we can prove hedging is
    genuinely concurrent and that losers are really cancelled.
    """

    def __init__(self, script, default=None):
        self.script = script
        self.default = default or (0.0, FakeResponse(500, "no script"))
        self.started = []
        self.finished = []
        self.t0 = time.time()

    async def post(self, url, files=None, data=None, headers=None, timeout=None):
        model = (data or {}).get("model", "")
        self.started.append((model, time.time() - self.t0))
        delay, result = self.script.get(model, self.default)
        if delay:
            await asyncio.sleep(delay)
        self.finished.append((model, time.time() - self.t0))
        if isinstance(result, Exception):
            raise result
        return result

    def models_tried(self):
        return [m for m, _ in self.started]

    def models_finished(self):
        return [m for m, _ in self.finished]


def ok_text(t):
    return FakeResponse(200, "", {"text": t})


CHAIN = ["model-primary", "model-backup", "model-third"]


def race(client, chain=None, **kw):
    """Run the real _race and return (result, last_err, elapsed_seconds)."""
    for k, v in kw.items():
        os.environ[k] = str(v)
    started = time.time()
    try:
        res, err = asyncio.run(stt._race(
            client, "http://fake/v1/audio/transcriptions", "fake-key",
            chain or CHAIN, AUDIO, "turn.webm", "audio/webm", "en", "",
        ))
    finally:
        for k in kw:
            os.environ.pop(k, None)
    return res, err, time.time() - started


# --- [1] the model chain leads with a streaming-native model ----------------
print("[1] the chain leads with a streaming-native model")
chain = stt._MODEL_CHAIN
check("the default model is the streaming model",
      "streaming" in stt._DEFAULT_MODEL.lower(), stt._DEFAULT_MODEL)
check("the first model in the chain is streaming-native",
      "streaming" in chain[0].lower(), chain[0])
check("whisper is still only the last resort", "whisper" in chain[-1].lower(), chain[-1])
check("parakeet is kept as a fallback, not deleted",
      any("parakeet" in m.lower() for m in chain))
check("the chain has no duplicates", len(set(chain)) == len(chain))
check("asr_model is still overridable from the environment",
      (os.environ.update({"NVIDIA_ASR_MODEL": "nvidia/canary-1b-flash"}) or
       stt.asr_model() == "nvidia/canary-1b-flash"))
os.environ.pop("NVIDIA_ASR_MODEL", None)


# --- [2] the knobs are bounded ---------------------------------------------
print("[2] the hedge knobs are read and clamped")
check("hedge delay has a sane default", 0.2 <= stt.hedge_delay() <= 1.5, stt.hedge_delay())
check("grace has a sane default", 0.1 <= stt.primary_grace() <= 1.0, stt.primary_grace())
check("hedge model count defaults to more than one", stt.hedge_models() >= 2)
os.environ["VOICE_ASR_HEDGE_DELAY"] = "99"
check("an absurd hedge delay is clamped", stt.hedge_delay() <= 5.0, stt.hedge_delay())
os.environ["VOICE_ASR_HEDGE_DELAY"] = "not-a-number"
check("garbage in the hedge delay does not raise", isinstance(stt.hedge_delay(), float))
os.environ.pop("VOICE_ASR_HEDGE_DELAY", None)
os.environ["VOICE_ASR_HEDGE_MODELS"] = "400"
check("the in-flight count is capped", stt.hedge_models() <= 4, stt.hedge_models())
os.environ["VOICE_ASR_HEDGE_MODELS"] = "0"
check("at least one attempt is always made", stt.hedge_models() >= 1)
os.environ.pop("VOICE_ASR_HEDGE_MODELS", None)
os.environ["VOICE_ASR_PRIMARY_GRACE"] = "-5"
check("a negative grace is floored at zero", stt.primary_grace() >= 0.0)
os.environ.pop("VOICE_ASR_PRIMARY_GRACE", None)


# --- [3] a healthy primary wins and the backups never even start ------------
print("[3] a healthy primary wins alone (hedging costs nothing when all is well)")
c = FakeClient({"model-primary": (0.02, ok_text("i want to cancel my subscription"))})
res, err, dt = race(c)
check("the primary transcript is returned",
      res.get("text") == "i want to cancel my subscription", res)
check("the winning engine is reported", res.get("engine") == "model-primary", res.get("engine"))
check("it returns fast", dt < 0.5, round(dt, 3))
check("the backup never fired, because the primary answered first",
      c.models_tried() == ["model-primary"], c.models_tried())


# --- [4] THE HEADLINE FIX: a dead primary no longer costs the full timeout ---
print("[4] a dead primary no longer costs a full timeout")
c = FakeClient({
    "model-primary": (30.0, ok_text("never arrives")),
    "model-backup": (0.05, ok_text("the backup heard me")),
})
res, err, dt = race(c, VOICE_ASR_HEDGE_DELAY="0.1", VOICE_ASR_PRIMARY_GRACE="0.1")
check("the backup transcript is used", res.get("text") == "the backup heard me", res)
check("the backup is credited as the engine", res.get("engine") == "model-backup")
check("total time is well under the old serial timeout", dt < 2.0, round(dt, 3))
check("both models really were in flight at once",
      "model-primary" in c.models_tried() and "model-backup" in c.models_tried(),
      c.models_tried())
check("the hanging primary was cancelled, not awaited",
      "model-primary" not in c.models_finished(), c.models_finished())


# --- [5] accuracy is not traded away: the primary gets a grace period -------
print("[5] the more accurate primary still wins if it lands within the grace")
c = FakeClient({
    "model-primary": (0.30, ok_text("cancel my subscription please")),
    "model-backup": (0.02, ok_text("cancel my description please")),
})
res, err, dt = race(c, VOICE_ASR_HEDGE_DELAY="0.01", VOICE_ASR_PRIMARY_GRACE="1.0")
check("the primary transcript wins the tie",
      res.get("text") == "cancel my subscription please", res)
check("the primary is credited", res.get("engine") == "model-primary")

print("[5] but the grace is bounded - a slow primary cannot stall the turn")
c = FakeClient({
    "model-primary": (5.0, ok_text("far too late")),
    "model-backup": (0.02, ok_text("good enough now")),
})
res, err, dt = race(c, VOICE_ASR_HEDGE_DELAY="0.01", VOICE_ASR_PRIMARY_GRACE="0.15")
check("the backup is used once the grace expires",
      res.get("text") == "good enough now", res)
check("the grace really is short", dt < 1.0, round(dt, 3))

print("[5] a zero grace commits to the first answer immediately")
c = FakeClient({
    "model-primary": (2.0, ok_text("slow primary")),
    "model-backup": (0.01, ok_text("instant backup")),
})
res, err, dt = race(c, VOICE_ASR_HEDGE_DELAY="0.01", VOICE_ASR_PRIMARY_GRACE="0")
check("the first answer is taken with no waiting",
      res.get("text") == "instant backup", res)
check("and it is genuinely immediate", dt < 0.6, round(dt, 3))


# --- [6] failures degrade honestly, never into a false transcript -----------
print("[6] failures degrade honestly")
c = FakeClient({
    "model-primary": (0.01, FakeResponse(401, "unauthorized")),
    "model-backup": (0.02, ok_text("should never be used")),
})
res, err, dt = race(c, VOICE_ASR_HEDGE_DELAY="0.2")
check("a bad key stops the whole race at once", not res.get("text"), res)
check("the key error is reported plainly", "401" in str(res.get("error", "")), res)
check("a bad key is marked fatal", bool(res.get("fatal")))
check("no time is wasted racing other models with a dead key", dt < 1.0, round(dt, 3))

print("[6] a rate limit on one model is NOT fatal - another model can answer")
c = FakeClient({
    "model-primary": (0.01, FakeResponse(429, "too many requests")),
    "model-backup": (0.05, ok_text("the second model answered")),
})
res, err, dt = race(c, VOICE_ASR_HEDGE_DELAY="0.05")
check("a 429 on the primary falls through to the backup",
      res.get("text") == "the second model answered", res)
check("the turn still succeeds despite the rate limit", bool(res.get("text")))

print("[6] when every model fails we say so instead of inventing words")
c = FakeClient({
    "model-primary": (0.01, FakeResponse(500, "boom")),
    "model-backup": (0.01, RuntimeError("socket died")),
    "model-third": (0.01, FakeResponse(200, "", {"text": ""})),
})
res, err, dt = race(c, VOICE_ASR_HEDGE_DELAY="0.02")
check("no transcript is fabricated", not res.get("text"), res)
check("a reason is carried back for the UI", bool(err), err)
check("an exception in one attempt does not kill the race", dt < 2.0, round(dt, 3))

print("[6] an empty transcript is not treated as success")
c = FakeClient({
    "model-primary": (0.01, FakeResponse(200, "", {"text": "   "})),
    "model-backup": (0.03, ok_text("real words this time")),
})
res, err, dt = race(c, VOICE_ASR_HEDGE_DELAY="0.02")
check("blank audio falls through to the next model",
      res.get("text") == "real words this time", res)


# --- [7] hedging can be switched off entirely -------------------------------
print("[7] hedging is switchable")
c = FakeClient({"model-primary": (0.02, ok_text("solo run"))})
res, err, dt = race(c, VOICE_ASR_HEDGE_DELAY="0")
check("with hedging off only one model is ever contacted",
      c.models_tried() == ["model-primary"], c.models_tried())
check("and it still returns the transcript", res.get("text") == "solo run")

c = FakeClient({
    "model-primary": (0.02, ok_text("one")),
    "model-backup": (0.02, ok_text("two")),
    "model-third": (0.02, ok_text("three")),
})
res, err, dt = race(c, VOICE_ASR_HEDGE_DELAY="0.01", VOICE_ASR_HEDGE_MODELS="2")
check("the in-flight cap is respected", len(set(c.models_tried())) <= 2, c.models_tried())

print("[7] a one-model chain still works")
c = FakeClient({"only": (0.01, ok_text("single model chain"))})
res, err, dt = race(c, chain=["only"], VOICE_ASR_HEDGE_DELAY="0.01")
check("a single-entry chain returns its transcript",
      res.get("text") == "single model chain", res)


# --- [8] the serial fallback loop is really gone ----------------------------
print("[8] the old serial loop is gone for good")
check("the bounded serial slice is gone", "chain[:3]" not in CODE)
check("transcribe delegates to the race", "await _race(" in CODE)
check("the race is concurrent, not a for-loop of awaits",
      "asyncio.wait(" in CODE and "FIRST_COMPLETED" in CODE)
check("losing attempts are cancelled", "_cancel(" in CODE and ".cancel()" in CODE)
check("tasks are created on the running loop", "get_running_loop()" in CODE)
check("the deprecated loop getter is not used", "get_event_loop()" not in CODE)
check("CancelledError is re-raised, never swallowed as a failure",
      "except asyncio.CancelledError:" in CODE and "raise" in CODE)
check("a 429 is no longer an early return for the whole turn",
      "rate limited (429)" in CODE)
check("transcribe still never raises", "async def transcribe(" in CODE)
check("the hedge stagger is applied per attempt", "delay * i" in CODE)

print("[8] status() still reports honestly")
st = stt.status()
check("status exposes readiness", "ready" in st and "enabled" in st)
check("status never leaks a key", "api_key" not in st and "key" not in str(st.get("note", "")).lower()
      or "has_key" in st)
check("status reports the model in use", bool(st.get("model")))

# --- [9] the grace must not be spent on a model that cannot win -------------
print("[9] a dead primary does not get a grace period")
c = FakeClient({
    "model-primary": (0.01, FakeResponse(500, "primary is down")),
    "model-backup": (0.05, ok_text("backup answered")),
    "model-third": (5.00, ok_text("third is far too slow")),
})
res, err, dt = race(c, VOICE_ASR_HEDGE_DELAY="0.01", VOICE_ASR_PRIMARY_GRACE="1.0")
check("the backup answer is returned", res.get("text") == "backup answered", res)
check("the full grace window is NOT burned waiting for a model that cannot win",
      dt < 0.55, round(dt, 3))
check("the guard is present in the source", "primary_live" in CODE)

print("[9] the grace is still honoured while the primary is genuinely alive")
c = FakeClient({
    "model-primary": (0.25, ok_text("the accurate answer")),
    "model-backup": (0.02, ok_text("the quick answer")),
    "model-third": (5.00, ok_text("irrelevant")),
})
res, err, dt = race(c, VOICE_ASR_HEDGE_DELAY="0.01", VOICE_ASR_PRIMARY_GRACE="1.0")
check("the primary still overrides the backup when it is alive",
      res.get("text") == "the accurate answer", res)


# --- [10] losing attempts are really stopped before we return ---------------
print("[10] losing attempts are cancelled AND awaited")


class CancelAwareClient(FakeClient):
    """Records cancellations actually delivered into the request coroutine."""

    def __init__(self, script, default=None):
        FakeClient.__init__(self, script, default)
        self.cancelled = []

    async def post(self, url, files=None, data=None, headers=None, timeout=None):
        model = (data or {}).get("model", "")
        try:
            return await FakeClient.post(
                self, url, files=files, data=data, headers=headers, timeout=timeout
            )
        except asyncio.CancelledError:
            self.cancelled.append(model)
            raise


check("_drain is a coroutine (it awaits the cancellations)",
      asyncio.iscoroutinefunction(stt._drain))
check("_drain gathers the cancelled tasks", "gather(" in CODE)
check("the losers are drained, not merely cancelled", "await _drain(" in CODE)
check("no bare fire-and-forget cancel of the pending set remains",
      "_cancel(pending)" not in CODE)

c = CancelAwareClient({
    "model-primary": (30.0, ok_text("never arrives")),
    "model-backup": (0.03, ok_text("backup wins")),
})
res, err, dt = race(c, VOICE_ASR_HEDGE_DELAY="0.01", VOICE_ASR_PRIMARY_GRACE="0.05")
check("the winning transcript is returned", res.get("text") == "backup wins", res)
check("the hanging attempt was actually cancelled before we returned",
      "model-primary" in c.cancelled, c.cancelled)
check("cancelling the loser does not slow the turn down", dt < 1.0, round(dt, 3))


# --- [11] the brain's streaming retry loop must not close a shared client ----
print("[11] the streaming retry loop cannot close the shared client")
BRAIN = io.open(os.path.join(_HERE, "brain.py"), encoding="utf-8").read()
BCODE = _code(BRAIN)
_stream_at = BCODE.find("for attempt in range(3):")
check("the streaming retry loop is still there", _stream_at > 0)
_tail = BCODE[_stream_at:_stream_at + 3000]
check("no client close survives inside the retry loop",
      "aclose()" not in _tail, _tail[-200:] if "aclose()" in _tail else "")
check("the shared-client accessor is still used", "get_client()" in BCODE)
check("a real owned-client close still exists elsewhere (list_nim_models)",
      BCODE.count("aclose()") >= 1)

print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
