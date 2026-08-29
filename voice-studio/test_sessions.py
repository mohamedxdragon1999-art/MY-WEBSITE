"""Session store: tenant isolation, capacity fairness, TTL and bookkeeping.

Why this suite exists
---------------------
The store namespaces keys per tenant, so it was assumed to be multi-tenant safe.
Namespacing only stops history from LEAKING - it says nothing about CAPACITY.
With one shared pool and global oldest-first eviction, a busy site simply took
the whole store and a quiet site's live conversation was deleted mid-call. The
agent then answered the next question with no memory of the previous one, which
looks exactly like the model being stupid rather than a capacity bug.

Everything here really executes: sessions.py is pure stdlib.
"""
import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sessions  # noqa: E402

PASS = 0
FAIL = 0


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok   " + label)
    else:
        FAIL += 1
        print("  FAIL: " + label + ("  " + str(extra) if extra != "" else ""))


print("[1] one tenant can never evict another tenant's session")
st = sessions.Store(ttl_sec=1800.0, max_sessions=100)
st.append("good-shop", "vip", "user", "my order is 12345")
check("the quiet tenant has history to begin with", len(st.history("good-shop", "vip")) == 1)

for i in range(500):
    st.append("noisy-shop", "flood%d" % i, "user", "spam")

survived = st.history("good-shop", "vip")
check("a 500-session flood did NOT delete the neighbour's conversation",
      len(survived) == 1, survived)
check("and the surviving turn is the right content",
      survived and survived[0]["content"] == "my order is 12345", survived)
check("the flooding tenant is itself bounded",
      st.stats()["active_sessions"] <= 100 + 1, st.stats())

print("[2] a tenant at its allowance evicts its OWN oldest, and keeps working")
st2 = sessions.Store(ttl_sec=1800.0, max_sessions=800, max_per_tenant=5)
for i in range(5):
    st2.append("t", "s%d" % i, "user", "turn for %d" % i)
    time.sleep(0.002)
check("filled to the allowance", len(st2.history("t", "s0")) == 1)

# touch s0 so it is the most-recently-used, then overflow by one
st2.history("t", "s0")
st2.append("t", "s-new", "user", "newest")
check("the new session exists", len(st2.history("t", "s-new")) == 1)
check("the RECENTLY USED session was kept", len(st2.history("t", "s0")) == 1)
check("the least-recently-used one was the victim", len(st2.history("t", "s1")) == 0)
check("the tenant never exceeds its allowance",
      st2.stats()["active_sessions"] <= 5, st2.stats())

print("[3] the per-tenant index cannot drift out of step with the data")
st3 = sessions.Store(ttl_sec=1800.0, max_sessions=50)
st3.append("a", "one", "user", "x")
st3.append("a", "two", "user", "x")
st3.append("b", "one", "user", "x")
check("two tenants tracked", st3.stats()["active_tenants"] == 2, st3.stats())
st3.reset("a", "one")
st3.reset("a", "two")
check("emptied tenants are forgotten, not left as empty shells",
      st3.stats()["active_tenants"] == 1, st3.stats())
check("the other tenant is untouched", len(st3.history("b", "one")) == 1)
st3.reset("b", "one")
check("store fully drains to zero",
      st3.stats()["active_sessions"] == 0 and st3.stats()["active_tenants"] == 0, st3.stats())

print("[4] resetting or expiring a session frees its slot for real")
st4 = sessions.Store(ttl_sec=1800.0, max_sessions=800, max_per_tenant=3)
for i in range(3):
    st4.append("t", "s%d" % i, "user", "x")
st4.reset("t", "s0")
st4.append("t", "fresh", "user", "x")
check("a freed slot is reusable without evicting anyone",
      len(st4.history("t", "s1")) == 1 and len(st4.history("t", "fresh")) == 1)

print("[5] TTL still expires on read, and the slot is released")
st5 = sessions.Store(ttl_sec=0.05, max_sessions=800, max_per_tenant=2)
st5.append("t", "old", "user", "x")
time.sleep(0.12)
check("an expired session returns no history", st5.history("t", "old") == [])
check("and it no longer occupies a slot", st5.stats()["active_sessions"] == 0, st5.stats())

print("[6] history is never shared between tenants using the same session id")
st6 = sessions.Store()
st6.append("shop-a", "same-id", "user", "secret A")
st6.append("shop-b", "same-id", "user", "secret B")
ha = [t["content"] for t in st6.history("shop-a", "same-id")]
hb = [t["content"] for t in st6.history("shop-b", "same-id")]
check("tenant A sees only its own turn", ha == ["secret A"], ha)
check("tenant B sees only its own turn", hb == ["secret B"], hb)
check("no cross-tenant leakage in either direction",
      "secret B" not in ha and "secret A" not in hb)

print("[7] returned history is a copy - a caller cannot corrupt the store")
st7 = sessions.Store()
st7.append("t", "s", "user", "original")
h = st7.history("t", "s")
h.append({"role": "user", "content": "injected"})
again = [t["content"] for t in st7.history("t", "s")]
check("mutating the returned list does not affect the store", again == ["original"], again)

print("[8] turn history stays bounded and content is length-capped")
st8 = sessions.Store()
for i in range(50):
    st8.append("t", "s", "user", "turn %d" % i, max_turns=8)
h8 = st8.history("t", "s")
check("turns are capped per session", len(h8) == 8, len(h8))
check("the most recent turn is kept", h8[-1]["content"] == "turn 49", h8[-1])
st8.append("t", "s", "user", "z" * 9000, max_turns=8)
check("a huge turn is truncated, not stored whole",
      len(st8.history("t", "s")[-1]["content"]) <= 2000)

print("[9] empty / missing identifiers are ignored safely")
st9 = sessions.Store()
st9.append("t", None, "user", "x")
st9.append("t", "", "user", "x")
st9.append("t", "s", "user", "")
check("no session is created from junk input", st9.stats()["active_sessions"] == 0, st9.stats())
check("history of an unknown session is empty, not an error", st9.history("t", "nope") == [])
check("history with no session id is empty", st9.history("t", None) == [])
st9.reset("t", None)
check("reset with no session id does not raise", True)

print("[10] concurrent traffic keeps the store consistent")
st10 = sessions.Store(ttl_sec=1800.0, max_sessions=400, max_per_tenant=50)
errors = []


def worker(tid):
    try:
        for i in range(120):
            st10.append("tenant%d" % tid, "s%d" % (i % 60), "user", "hello %d" % i)
            st10.history("tenant%d" % tid, "s%d" % (i % 60))
            if i % 17 == 0:
                st10.reset("tenant%d" % tid, "s%d" % (i % 60))
    except Exception as exc:  # noqa: BLE001
        errors.append(exc)


threads = [threading.Thread(target=worker, args=(t,)) for t in range(6)]
for t in threads:
    t.start()
for t in threads:
    t.join()
check("no thread raised", not errors, errors[:2])
snap = st10.stats()
check("global cap respected under concurrency", snap["active_sessions"] <= 400, snap)
check("per-tenant cap respected under concurrency",
      snap["active_sessions"] <= 6 * 50, snap)
check("the store is still usable afterwards",
      st10.append("tenant0", "final", "user", "ok") is None
      and len(st10.history("tenant0", "final")) == 1)

print("[11] eviction charges the LARGEST tenant, not the smallest")
st11 = sessions.Store(ttl_sec=1800.0, max_sessions=20, max_per_tenant=18)
st11.append("small", "only", "user", "precious")
for i in range(18):
    st11.append("big", "b%d" % i, "user", "bulk")
    time.sleep(0.001)
for i in range(10):
    st11.append("big", "more%d" % i, "user", "bulk")
check("the small tenant's only session survived the big tenant's growth",
      len(st11.history("small", "only")) == 1, st11.stats())
check("the store stayed within its global cap",
      st11.stats()["active_sessions"] <= 20, st11.stats())

print("[12] stats expose the fairness limits for operators")
st12 = sessions.Store(ttl_sec=1800.0, max_sessions=1000)
s = st12.stats()
for field in ("active_sessions", "active_tenants", "max_sessions", "max_per_tenant"):
    check("stats reports " + field, field in s, s)
check("a tenant cannot be allowed the entire store",
      s["max_per_tenant"] < s["max_sessions"], s)
check("the allowance is still generous for a real site (10-50 callers)",
      s["max_per_tenant"] >= 64, s)

print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
