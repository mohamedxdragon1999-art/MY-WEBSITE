"""Many API keys, treated as one pool of capacity.

WHY THIS MODULE EXISTS
----------------------
NVIDIA NIM is free but rate limited per key. The answer is several free keys, and
the project already let you paste a comma-separated list. But the handling was
both incomplete and, in one place, actively harmful:

  1. THE BUG THAT WASTED YOUR GOOD KEYS. brain.py rotated through the keys, but
     any response that was not 200 and not 429 did `return None` immediately.
     So ONE revoked or mistyped key - a 401 - abandoned the whole turn even
     though every other key was healthy. Adding more keys made a bad key MORE
     likely to break you, which is the exact opposite of the point.

  2. NO MEMORY. A key that had just been rate limited was tried again at the
     same rate on the very next turn, so the caller paid the timeout repeatedly
     for a key we already knew was exhausted.

  3. ONLY THE BRAIN. stt.py took a single key, and so did Magpie. Word capture -
     the most request-hungry part of a call - never rotated at all. "Many keys"
     was only ever true for one of three paths.

So keys live here now, with health, and every path asks this module.

DESIGN NOTES
------------
* A key is never logged, never returned to the browser, and never stored on
  disk by this module. `stats()` reports a MASK (last 4 characters) so a manager
  UI can show you which key is which without ever exposing the secret.
* Health is per key, not per provider: one exhausted key must not sideline the
  others, and one bad key must not sideline anything.
* Rate limited (429) means "come back soon" -> a short cooldown.
  Rejected (401/403) means "this key is wrong" -> a long quarantine, because
  retrying a revoked key just spends the caller's latency budget.
* Everything here is synchronous and lock-guarded. It is called from async code,
  but it never blocks on I/O, so a plain threading.Lock is correct and cheap.
* Round-robin, not "first healthy": always using the first key would exhaust it
  and leave the rest idle.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Dict, List, Optional, Tuple

# A rate limited key is usually usable again within a minute.
_COOLDOWN_429 = 45.0
# A rejected key is wrong until the human fixes it. Long, but not forever, so a
# key that was re-enabled upstream eventually comes back on its own.
_QUARANTINE = 600.0
# A transport error is not the key's fault; back off briefly and move on.
_COOLDOWN_ERR = 10.0
# Defensive ceiling: someone will eventually paste a whole file in.
_MAX_KEYS = 64


def _f(name: str, default: float, lo: float, hi: float) -> float:
    try:
        v = float(os.environ.get(name, "").strip())
    except Exception:
        return default
    return max(lo, min(hi, v))


def cooldown_429() -> float:
    return _f("VOICE_KEY_COOLDOWN_SEC", _COOLDOWN_429, 1.0, 3600.0)


def quarantine_sec() -> float:
    return _f("VOICE_KEY_QUARANTINE_SEC", _QUARANTINE, 5.0, 86400.0)


def mask(key: str) -> str:
    """A safe label for a key. NEVER return the key itself to a caller/UI."""
    k = (key or "").strip()
    if not k:
        return ""
    if len(k) <= 4:
        return "*" * len(k)
    return "***" + k[-4:]


def split_keys(raw: Optional[str]) -> List[str]:
    """Parse however the user pasted their keys.

    Commas, newlines, carriage returns, tabs, semicolons and spaces all separate
    keys, because people paste from spreadsheets, .env files and chat messages.
    Duplicates are dropped (a duplicate is not extra capacity - it is the same
    rate limit twice, and it would make one key take two slots in the rotation).
    """
    if not raw:
        return []
    cleaned = raw
    for ch in ("\n", "\r", "\t", ";", " "):
        cleaned = cleaned.replace(ch, ",")
    out: List[str] = []
    for part in cleaned.split(","):
        part = part.strip().strip('"').strip("'")
        if part and part not in out:
            out.append(part)
        if len(out) >= _MAX_KEYS:
            break
    return out


class _State:
    """Health of a single key."""

    __slots__ = ("ok", "rate_limited", "rejected", "errors", "until", "reason",
                 "last_used")

    def __init__(self) -> None:
        self.ok = 0
        self.rate_limited = 0
        self.rejected = 0
        self.errors = 0
        self.until = 0.0        # not usable before this monotonic time
        self.reason = ""
        self.last_used = 0.0


class KeyRing:
    """Round-robin over the healthy keys, with per-key health."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state: Dict[str, _State] = {}
        self._cursor = 0

    # -- internal ---------------------------------------------------------
    def _st(self, key: str) -> _State:
        s = self._state.get(key)
        now = time.monotonic()
        if s is None:
            s = _State()
            self._state[key] = s
            # Bound the health table: keys come from user input, and a long-lived
            # server must not accumulate state for every string ever pasted.
            if len(self._state) > _MAX_KEYS * 4:
                self._evict_locked()
        # Every touch, read or write, counts as recency. This is what makes the
        # eviction below correct: the FIRST version of this only dropped entries
        # older than an hour, but nothing ever stamped last_used on a write, so
        # the condition could never fire and the table grew without limit. Its
        # own test caught it.
        s.last_used = now
        return s

    def _evict_locked(self) -> None:
        """Drop the least recently touched health, down to half the ceiling.

        Losing health data is SAFE - a forgotten key simply looks 'ready' again
        and gets one hopeful request - so this never needs to be clever. What
        matters is that the table has a hard ceiling.
        """
        keep = _MAX_KEYS * 2
        items = sorted(self._state.items(), key=lambda kv: kv[1].last_used)
        for k, _v in items[:max(0, len(items) - keep)]:
            self._state.pop(k, None)

    def _healthy_locked(self, keys: List[str], now: float) -> List[str]:
        return [k for k in keys if self._st(k).until <= now]

    # -- reads ------------------------------------------------------------
    def pick(self, raw: Optional[str]) -> Optional[str]:
        """The next key to try, skipping any in cooldown or quarantine.

        Returns None only when the user supplied no keys at all. If EVERY key is
        cooling down we still return one - the least recently used - because a
        stale cooldown must never turn into "the feature is off". Better to make
        one hopeful request than to go silent.
        """
        keys = split_keys(raw)
        if not keys:
            return None
        now = time.monotonic()
        with self._lock:
            usable = self._healthy_locked(keys, now)
            if not usable:
                # All cooling down: prefer the one that is closest to ready and
                # was not rejected outright.
                soft = [k for k in keys if self._st(k).reason != "rejected"]
                pool = soft or keys
                pool = sorted(pool, key=lambda k: self._st(k).until)
                chosen = pool[0]
                self._st(chosen).last_used = now
                return chosen
            i = self._cursor % len(usable)
            self._cursor = (i + 1) % max(1, len(usable))
            chosen = usable[i]
            self._st(chosen).last_used = now
            return chosen

    def order(self, raw: Optional[str], limit: int = 4) -> List[str]:
        """Keys to try for ONE request, best first.

        Healthy keys come first in rotation order, then the ones in cooldown as
        a last resort. A caller walks this list and stops at the first success -
        so one bad key costs a retry, not the whole turn.
        """
        keys = split_keys(raw)
        if not keys:
            return []
        now = time.monotonic()
        with self._lock:
            usable = self._healthy_locked(keys, now)
            resting = [k for k in keys if k not in usable
                       and self._st(k).reason != "rejected"]
            rejected = [k for k in keys if self._st(k).reason == "rejected"
                        and k not in usable]
            if usable:
                i = self._cursor % len(usable)
                self._cursor = (i + 1) % max(1, len(usable))
                usable = usable[i:] + usable[:i]
            resting.sort(key=lambda k: self._st(k).until)
            out = usable + resting + rejected
        lim = max(1, int(limit))
        return out[:lim]

    def usable_count(self, raw: Optional[str]) -> int:
        keys = split_keys(raw)
        if not keys:
            return 0
        now = time.monotonic()
        with self._lock:
            return len(self._healthy_locked(keys, now))

    # -- feedback ---------------------------------------------------------
    def note_ok(self, key: str) -> None:
        if not key:
            return
        with self._lock:
            s = self._st(key)
            s.ok += 1
            s.until = 0.0
            s.reason = ""

    def note_rate_limited(self, key: str) -> None:
        if not key:
            return
        with self._lock:
            s = self._st(key)
            s.rate_limited += 1
            s.until = time.monotonic() + cooldown_429()
            s.reason = "rate limited"

    def note_rejected(self, key: str) -> None:
        """401/403 - the key is wrong, revoked, or lacks access to the model."""
        if not key:
            return
        with self._lock:
            s = self._st(key)
            s.rejected += 1
            s.until = time.monotonic() + quarantine_sec()
            s.reason = "rejected"

    def note_error(self, key: str) -> None:
        if not key:
            return
        with self._lock:
            s = self._st(key)
            s.errors += 1
            s.until = time.monotonic() + _COOLDOWN_ERR
            s.reason = "error"

    def note_status(self, key: str, status: int) -> None:
        """Record an HTTP status. One place, so no path invents its own rules."""
        if status == 200:
            self.note_ok(key)
        elif status == 429:
            self.note_rate_limited(key)
        elif status in (401, 403):
            self.note_rejected(key)
        elif status >= 500 or status == 408:
            self.note_error(key)
        # 4xx other than the above is about the REQUEST, not the key: recording
        # it against the key would quarantine a perfectly good key over a bad
        # model name.

    def forget(self, raw: Optional[str] = None) -> None:
        """Clear health. With no argument, clears everything."""
        with self._lock:
            if raw is None:
                self._state.clear()
                self._cursor = 0
                return
            for k in split_keys(raw):
                self._state.pop(k, None)

    # -- manager view -----------------------------------------------------
    def stats(self, raw: Optional[str]) -> List[Dict]:
        """Per-key health for the key manager UI. Masked - never the real key."""
        keys = split_keys(raw)
        now = time.monotonic()
        out: List[Dict] = []
        with self._lock:
            for idx, k in enumerate(keys):
                s = self._st(k)
                left = max(0.0, s.until - now)
                if left <= 0:
                    state = "ready"
                elif s.reason == "rejected":
                    state = "rejected"
                elif s.reason == "rate limited":
                    state = "cooling"
                else:
                    state = "resting"
                out.append({
                    "index": idx,
                    "mask": mask(k),
                    "state": state,
                    "reason": s.reason,
                    "cooldown_sec": round(left, 1),
                    "ok": s.ok,
                    "rate_limited": s.rate_limited,
                    "rejected": s.rejected,
                    "errors": s.errors,
                })
        return out

    def summary(self, raw: Optional[str]) -> Dict:
        rows = self.stats(raw)
        ready = sum(1 for r in rows if r["state"] == "ready")
        return {
            "total": len(rows),
            "ready": ready,
            "cooling": sum(1 for r in rows if r["state"] == "cooling"),
            "rejected": sum(1 for r in rows if r["state"] == "rejected"),
            "resting": sum(1 for r in rows if r["state"] == "resting"),
            # NVIDIA NIM free tier is roughly 40 requests/minute per key. This is
            # an ESTIMATE for the UI, not a promise.
            "estimated_rpm": ready * 40,
            "keys": rows,
        }


# One ring for the whole process, so every path shares the same health picture.
RING = KeyRing()


def env_keys(name: str = "NVIDIA_API_KEY") -> str:
    """Keys from the environment, singular or plural, as one raw string.

    NVIDIA_API_KEYS (plural) is the documented way to give several; the singular
    name is still honoured so nobody's existing .env breaks.
    """
    parts = []
    for n in (name + "S", name):
        v = (os.environ.get(n, "") or "").strip()
        if v:
            parts.append(v)
    return ",".join(parts)


def resolve(explicit: Optional[str] = None, env_name: str = "NVIDIA_API_KEY") -> str:
    """All candidate keys as one raw string: caller-supplied first, then env.

    The browser's keys come first because a user who pastes a key expects THAT
    key to be used, but the server's own keys stay available as a fallback so a
    caller with no key of their own is still served.
    """
    raw = (explicit or "").strip()
    envs = env_keys(env_name)
    if raw and envs:
        return raw + "," + envs
    return raw or envs
