"""Many-key handling: the ring, and the paths that consume it.

The headline assertion in this file is [8]. It EXECUTES the real NIM loop in
brain.py against a fake HTTP client where the first key returns 401 and the
second returns 200. Before v0.0.45 that returned None - one revoked key threw
away the turn even though a healthy key was sitting right there. A structural
test cannot catch that, which is exactly the lesson from the v0.0.44 regression,
so this one runs the code.
"""
import asyncio
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "")

PASS = 0
FAIL = []


def check(label, cond, detail=""):
    global PASS
    if cond:
        PASS += 1
        print("  ok  " + label)
    else:
        FAIL.append(label)
        print("  FAIL " + label + (("  -> " + str(detail)) if detail else ""))


# httpx is not installable in this environment, and brain.py imports it INSIDE
# the functions we want to run. A minimal stand-in lets the real logic execute.
if "httpx" not in sys.modules:
    fake_httpx = types.ModuleType("httpx")

    class _Timeout:
        def __init__(self, read, connect=None):
            self.read = read
            self.connect = connect

    fake_httpx.Timeout = _Timeout
    sys.modules["httpx"] = fake_httpx

import apikeys  # noqa: E402
import brain  # noqa: E402

A = "nvapi-aaaa1111"
B = "nvapi-bbbb2222"
C = "nvapi-cccc3333"
RAW = A + "," + B + "," + C

print("\n[1] however you paste them, they parse")
apikeys.RING.forget()
check("commas", apikeys.split_keys("a,b,c") == ["a", "b", "c"])
check("newlines", apikeys.split_keys("a\nb\nc") == ["a", "b", "c"])
check("spaces and tabs", apikeys.split_keys("a b\tc") == ["a", "b", "c"])
check("semicolons", apikeys.split_keys("a;b") == ["a", "b"])
check("mixed separators together", apikeys.split_keys("a, b\n c") == ["a", "b", "c"])
check("surrounding quotes are stripped", apikeys.split_keys('"a",\'b\'') == ["a", "b"])
check("blank input is no keys", apikeys.split_keys("") == [] and apikeys.split_keys(None) == [])
# A duplicate is NOT extra capacity: it is the same rate limit twice, and it
# would take two slots in the rotation while contributing one key's headroom.
check("duplicates are dropped", apikeys.split_keys("a,b,a") == ["a", "b"])
check("a pasted essay cannot blow up the ring",
      len(apikeys.split_keys(",".join("k%d" % i for i in range(500)))) <= 64)

print("\n[2] a key is never exposed")
for k in (A, B, C):
    m = apikeys.mask(k)
    check("mask hides the secret part of " + m, k not in m and len(m) <= 8, m)
check("mask keeps the last 4 so you can tell keys apart", apikeys.mask(A).endswith("1111"))
check("a short key is not partially leaked", apikeys.mask("ab") == "**")
check("empty stays empty", apikeys.mask("") == "")
rows = apikeys.RING.summary(RAW)["keys"]
blob = repr(rows)
check("no raw key appears anywhere in the manager payload",
      A not in blob and B not in blob and C not in blob)

print("\n[3] load is spread, not dumped on the first key")
apikeys.RING.forget()
picks = [apikeys.RING.pick(RAW) for _ in range(9)]
check("every key gets used", set(picks) == {A, B, C}, picks)
check("used evenly", max(picks.count(x) for x in (A, B, C)) -
      min(picks.count(x) for x in (A, B, C)) <= 1, picks)
check("no keys means no pick", apikeys.RING.pick("") is None)
check("a single key is just returned", apikeys.RING.pick(A) == A)

print("\n[4] a rate limited key steps aside")
apikeys.RING.forget()
apikeys.RING.note_rate_limited(A)
check("it is not counted usable", apikeys.RING.usable_count(RAW) == 2)
check("it is never picked while cooling",
      A not in [apikeys.RING.pick(RAW) for _ in range(8)])
check("it is still LAST-RESORT available, not deleted", A in apikeys.RING.order(RAW, limit=3))
check("healthy keys are tried before it", apikeys.RING.order(RAW, limit=3)[0] != A)
check("the UI can see why",
      [r for r in apikeys.RING.summary(RAW)["keys"] if r["mask"] == apikeys.mask(A)][0]["state"] == "cooling")

print("\n[5] a rejected key is quarantined harder than a busy one")
apikeys.RING.forget()
apikeys.RING.note_rejected(B)
apikeys.RING.note_rate_limited(A)
order = apikeys.RING.order(RAW, limit=3)
check("the healthy key goes first", order[0] == C, order)
# A rejected key is WRONG, not busy: trying it before a merely-busy key would
# spend the caller's latency on a request that cannot succeed.
check("a busy key is preferred over a rejected one",
      order.index(A) < order.index(B), order)
check("a success clears the bad history",
      (apikeys.RING.note_ok(B), apikeys.RING.usable_count(RAW))[1] >= 2)

print("\n[6] a stale cooldown must never mean 'the feature is off'")
apikeys.RING.forget()
for k in (A, B, C):
    apikeys.RING.note_rate_limited(k)
check("every key cooling still yields a key to try", apikeys.RING.pick(RAW) in (A, B, C))
check("and order is never empty", len(apikeys.RING.order(RAW, limit=3)) == 3)
apikeys.RING.forget()
for k in (A, B, C):
    apikeys.RING.note_rejected(k)
check("even all-rejected returns something rather than going silent",
      apikeys.RING.pick(RAW) in (A, B, C))

print("\n[7] a status means exactly one thing")
apikeys.RING.forget()
apikeys.RING.note_status(A, 429)
check("429 cools", apikeys.RING.summary(A)["cooling"] == 1)
apikeys.RING.forget()
apikeys.RING.note_status(A, 401)
check("401 quarantines", apikeys.RING.summary(A)["rejected"] == 1)
apikeys.RING.forget()
apikeys.RING.note_status(A, 403)
check("403 quarantines", apikeys.RING.summary(A)["rejected"] == 1)
apikeys.RING.forget()
apikeys.RING.note_status(A, 500)
check("5xx rests, it does not blame the key",
      apikeys.RING.summary(A)["keys"][0]["state"] == "resting")
apikeys.RING.forget()
apikeys.RING.note_status(A, 400)
# A bad model name is a problem with the REQUEST. Quarantining a good key for it
# would take real capacity offline for ten minutes over a typo.
check("a 400 does NOT punish the key", apikeys.RING.summary(A)["ready"] == 1)
apikeys.RING.forget()
apikeys.RING.note_status(A, 200)
check("200 keeps it ready", apikeys.RING.summary(A)["ready"] == 1)

print("\n[8] THE BUG: one bad key used to throw away the whole turn")


class FakeResp:
    def __init__(self, status, text=""):
        self.status_code = status
        self._text = text

    def json(self):
        return {"choices": [{"message": {"content": self._text}}]}


class FakeClient:
    """Answers per key so we can prove WHICH key served the reply."""

    def __init__(self, by_key):
        self.by_key = by_key
        self.tried = []

    async def post(self, url, headers=None, json=None, timeout=None):
        key = (headers or {}).get("Authorization", "").replace("Bearer ", "")
        self.tried.append(key)
        got = self.by_key.get(key, 500)
        if isinstance(got, Exception):
            raise got
        if got == 200:
            return FakeResp(200, "served by " + apikeys.mask(key))
        return FakeResp(got)


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


apikeys.RING.forget()
fc = FakeClient({A: 401, B: 200, C: 200})
out = run(brain.generate_reply_nim("hello", None, api_key=RAW, client=fc))
check("a 401 on the first key no longer loses the turn", bool(out), out)
check("a healthy key actually answered", "served by" in (out or ""), out)
check("it did not stop at the bad key", len(fc.tried) >= 2, fc.tried)
check("the bad key was quarantined for next time",
      apikeys.RING.summary(A)["rejected"] == 1)

apikeys.RING.forget()
fc2 = FakeClient({A: 429, B: 429, C: 200})
out2 = run(brain.generate_reply_nim("hello", None, api_key=RAW, client=fc2))
check("two rate limited keys still produce an answer", bool(out2), out2)
check("both busy keys were remembered as cooling",
      apikeys.RING.summary(A + "," + B)["cooling"] == 2)

apikeys.RING.forget()
fc3 = FakeClient({A: RuntimeError("boom"), B: 200, C: 200})
out3 = run(brain.generate_reply_nim("hello", None, api_key=RAW, client=fc3))
check("a transport error also falls through to the next key", bool(out3), out3)

apikeys.RING.forget()
fc4 = FakeClient({A: 429, B: 429, C: 429})
out4 = run(brain.generate_reply_nim("hello", None, api_key=RAW, client=fc4))
# Honesty matters more than a fake answer: the caller falls back to another
# provider or the offline responder, which it can only do if we return None.
check("when every key really is exhausted we admit it", out4 is None, out4)
check("no keys at all is a fast no",
      run(brain.generate_reply_nim("hi", None, api_key="", client=fc4)) is None)

print("\n[9] the second try uses a DIFFERENT key")
apikeys.RING.forget()
fc5 = FakeClient({A: 401, B: 200, C: 200})
run(brain.generate_reply_nim("hello", None, api_key=RAW, client=fc5))
first_round = list(fc5.tried)
fc6 = FakeClient({A: 401, B: 200, C: 200})
run(brain.generate_reply_nim("hello", None, api_key=RAW, client=fc6))
check("the quarantined key is not retried on the next turn",
      A not in fc6.tried, (first_round, fc6.tried))

print("\n[10] the health table cannot grow forever")
apikeys.RING.forget()
for i in range(400):
    apikeys.RING.note_ok("throwaway-key-%d" % i)
check("bounded", len(apikeys.RING._state) <= 64 * 4 + 2, len(apikeys.RING._state))

print("\n[11] browser keys and server keys combine")
old = os.environ.get("NVIDIA_API_KEYS", "")
try:
    os.environ["NVIDIA_API_KEYS"] = "env-key-9999"
    both = apikeys.split_keys(apikeys.resolve(A))
    check("the pasted key is honoured first", both[0] == A, both)
    check("the server key is still available as backup", "env-key-9999" in both, both)
    check("a caller with no key of their own is still served",
          apikeys.split_keys(apikeys.resolve(None)) == ["env-key-9999"])
finally:
    if old:
        os.environ["NVIDIA_API_KEYS"] = old
    else:
        os.environ.pop("NVIDIA_API_KEYS", None)

print("\n[12] every path really is wired to the ring")
SRV = open(os.path.dirname(os.path.abspath(__file__)) + "/server.py").read()
STT = open(os.path.dirname(os.path.abspath(__file__)) + "/stt.py").read()
BRN = open(os.path.dirname(os.path.abspath(__file__)) + "/brain.py").read()
check("brain imports the ring", "import apikeys" in BRN)
check("capture imports the ring", "import apikeys" in STT)
check("server imports the ring", "import apikeys" in SRV)
check("the brain asks for an ORDER of keys, not one key",
      "apikeys.RING.order(api_key" in BRN)
check("the brain records what each status meant", "RING.note_status(" in BRN)
# The old code did `return None` on any non-429 status. If that line ever comes
# back, one bad key silently breaks the brain again.
nim = BRN[BRN.index("async def generate_reply_nim"):]
nim = nim[:nim.index("async def verify_nim_key")]
check("the give-up-on-first-bad-status line is gone",
      "if r.status_code != 200:\n                    return None" not in nim)
check("capture walks several keys", "RING.order(raw_keys" in STT)
check("capture quarantines a rejected key", "note_rejected(_attempt_key)" in STT)
check("capture retries the next key on a rate limit",
      "note_rate_limited(_attempt_key)" in STT)
check("magpie picks a healthy key", "RING.pick(apikeys.resolve(req.api_key))" in SRV)
check("there is a key manager endpoint", '@app.post("/api/keys")' in SRV)
check("and a way to clear a quarantine without a restart",
      '@app.post("/api/keys/reset")' in SRV)
# Keys in a URL end up in access logs, proxy logs and browser history.
check("the manager is POST, never GET (keys must not sit in a URL)",
      '@app.get("/api/keys")' not in SRV)
check("the pool view reports key health too", '"nvidia_keys"' in SRV)

print("\n[13] version")
check("version bumped", 'VERSION = "0.0.51"' in SRV)

print("\n" + "=" * 60)
print("PASSED: %d FAILED: %d" % (PASS, len(FAIL)))
for f in FAIL:
    print("  failed: " + f)
sys.exit(1 if FAIL else 0)
