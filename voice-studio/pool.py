"""Free Brain Pool - multiply free rate limits with multi-key rotation.

THE PROBLEM
-----------
Every free LLM tier is rate limited PER ACCOUNT (not per user):

    NVIDIA NIM   ~40 requests/minute   (free, rate-limited, resets constantly)
    Groq          ~30 requests/minute, 14,400/day
    Cerebras      low RPM, ~1M tokens/day
    Cloudflare    10,000 neurons/day

So if 20 callers talk to your site at once on ONE key, some of them get a 429
and hear an error. That is the thing that actually breaks a voice site.

THE FIX
-------
Rate limits are per KEY, so N keys = N x the limit. This module keeps a pool
of keys per provider and:

  * round-robins across every healthy key (spreads load evenly)
  * tracks RPM / RPD per key locally, and SKIPS a key before it 429s
  * on a real 429, benches that key for a cooldown and instantly retries
    the next one - the caller never sees the error
  * falls through to the next PROVIDER when a whole provider is saturated
  * costs nothing: free keys are free, you just make more of them

With 5 free NIM keys you get ~180 req/min instead of ~36. Combined with the
other free providers the pool comfortably serves 50+ concurrent callers.

CONFIGURE
---------
Either numbered env vars or one comma-separated var - both work:

    NVIDIA_API_KEY=nvapi-aaa
    NVIDIA_API_KEY_2=nvapi-bbb
    NVIDIA_API_KEY_3=nvapi-ccc

    # ...or equivalently:
    NVIDIA_API_KEYS=nvapi-aaa,nvapi-bbb,nvapi-ccc

This module is pure standard library: it is import-safe with no dependencies.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Dict, List, Optional

# Conservative per-key ceilings. We stay UNDER the published free limits on
# purpose, because hitting a 429 costs a full round-trip of latency. Better to
# quietly move to the next key than to ask and be refused.
#
# Sources: NIM ~40 RPM (NVIDIA devforum), Groq 30 RPM / 14,400 RPD,
# Cerebras low RPM but ~1M tokens/day, OpenRouter 20 RPM / 50 RPD.
DEFAULT_LIMITS: Dict[str, Dict[str, int]] = {
    "nvidia":     {"rpm": 36,  "rpd": 40000},
    "groq":       {"rpm": 28,  "rpd": 14000},
    "cerebras":   {"rpm": 28,  "rpd": 14000},
    "cloudflare": {"rpm": 60,  "rpd": 9000},
    "gemini":     {"rpm": 14,  "rpd": 1400},
    "mistral":    {"rpm": 55,  "rpd": 20000},
    "openrouter": {"rpm": 18,  "rpd": 950},
    "together":   {"rpm": 55,  "rpd": 4000},
    "github":     {"rpm": 14,  "rpd": 140},
}

_FALLBACK_LIMIT = {"rpm": 30, "rpd": 5000}

# How long a key sits on the bench after a hard 429 from the provider.
_COOLDOWN_429 = 22.0
# How long after a non-rate-limit error (500, timeout, DNS, ...).
_COOLDOWN_ERR = 12.0


class KeySlot:
    """One API key plus its live usage counters."""

    __slots__ = ("provider", "key", "index", "minute_start", "minute_count",
                 "day_start", "day_count", "blocked_until", "total", "errors",
                 "last_used")

    def __init__(self, provider: str, key: str, index: int) -> None:
        self.provider = provider
        self.key = key
        self.index = index
        now = time.time()
        self.minute_start = now
        self.minute_count = 0
        self.day_start = now
        self.day_count = 0
        self.blocked_until = 0.0
        self.total = 0
        self.errors = 0
        self.last_used = 0.0

    # -- window bookkeeping -------------------------------------------------
    def _roll(self, now: float) -> None:
        if now - self.minute_start >= 60.0:
            self.minute_start = now
            self.minute_count = 0
        if now - self.day_start >= 86400.0:
            self.day_start = now
            self.day_count = 0

    def available(self, limits: Dict[str, int], now: Optional[float] = None) -> bool:
        now = now or time.time()
        if now < self.blocked_until:
            return False
        self._roll(now)
        if self.minute_count >= limits["rpm"]:
            return False
        if self.day_count >= limits["rpd"]:
            return False
        return True

    def note_use(self) -> None:
        now = time.time()
        self._roll(now)
        self.minute_count += 1
        self.day_count += 1
        self.total += 1
        self.last_used = now

    def note_429(self) -> None:
        """Provider actually refused us: bench this key and assume the minute
        bucket is spent so we do not immediately try it again."""
        self.blocked_until = time.time() + _COOLDOWN_429
        self.minute_count = 10 ** 6

    def note_error(self) -> None:
        self.errors += 1
        self.blocked_until = time.time() + _COOLDOWN_ERR

    def note_ok(self) -> None:
        self.errors = 0

    def snapshot(self, limits: Dict[str, int]) -> Dict:
        now = time.time()
        self._roll(now)
        return {
            "index": self.index,
            "tail": self.key[-4:] if len(self.key) >= 4 else "****",
            "minute_used": min(self.minute_count, limits["rpm"]),
            "minute_limit": limits["rpm"],
            "day_used": min(self.day_count, limits["rpd"]),
            "day_limit": limits["rpd"],
            "blocked": now < self.blocked_until,
            "blocked_for": max(0.0, round(self.blocked_until - now, 1)),
            "total": self.total,
        }


def _parse_keys(provider: str, env_single: str) -> List[str]:
    """Collect every key for a provider from all supported env spellings."""
    keys: List[str] = []

    def _add(raw: Optional[str]) -> None:
        for part in (raw or "").replace("\n", ",").split(","):
            part = part.strip()
            if part and part not in keys:
                keys.append(part)

    # NVIDIA_API_KEY
    _add(os.environ.get(env_single))
    # NVIDIA_API_KEYS=a,b,c  (plural)
    _add(os.environ.get(env_single + "S"))
    # NVIDIA_API_KEY_2 ... _25
    for n in range(2, 26):
        _add(os.environ.get(f"{env_single}_{n}"))
    return keys


class ProviderPool:
    """All keys for one provider, with round-robin selection."""

    def __init__(self, provider: str, keys: List[str]) -> None:
        self.provider = provider
        self.limits = dict(DEFAULT_LIMITS.get(provider, _FALLBACK_LIMIT))
        # Allow per-deployment tuning, e.g. NVIDIA_RPM=60
        try:
            self.limits["rpm"] = int(os.environ.get(f"{provider.upper()}_RPM", self.limits["rpm"]))
            self.limits["rpd"] = int(os.environ.get(f"{provider.upper()}_RPD", self.limits["rpd"]))
        except ValueError:
            pass
        self.slots = [KeySlot(provider, k, i) for i, k in enumerate(keys)]
        self._cursor = 0
        self._lock = threading.Lock()

    def __len__(self) -> int:
        return len(self.slots)

    def capacity_rpm(self) -> int:
        return len(self.slots) * self.limits["rpm"]

    def acquire(self, exclude: Optional[set] = None) -> Optional[KeySlot]:
        """Pick the next healthy key, round-robin. None if all are saturated."""
        exclude = exclude or set()
        with self._lock:
            n = len(self.slots)
            if n == 0:
                return None
            now = time.time()
            for step in range(n):
                slot = self.slots[(self._cursor + step) % n]
                if slot.key in exclude:
                    continue
                if slot.available(self.limits, now):
                    self._cursor = (self._cursor + step + 1) % n
                    slot.note_use()
                    return slot
            return None

    def find(self, key: str) -> Optional[KeySlot]:
        for s in self.slots:
            if s.key == key:
                return s
        return None

    def add_key(self, key: str) -> bool:
        """Register a key discovered at runtime (e.g. typed into the UI)."""
        key = (key or "").strip()
        if not key:
            return False
        with self._lock:
            if any(s.key == key for s in self.slots):
                return False
            self.slots.append(KeySlot(self.provider, key, len(self.slots)))
            return True

    def snapshot(self) -> Dict:
        return {
            "provider": self.provider,
            "keys": len(self.slots),
            "rpm_per_key": self.limits["rpm"],
            "capacity_rpm": self.capacity_rpm(),
            "slots": [s.snapshot(self.limits) for s in self.slots],
        }


class BrainPool:
    """Every provider pool together, in priority order."""

    def __init__(self) -> None:
        self.pools: Dict[str, ProviderPool] = {}
        self._lock = threading.Lock()

    def load(self, provider_env: Dict[str, str]) -> None:
        """provider_env maps provider id -> env var name for its key."""
        with self._lock:
            for pid, env_name in provider_env.items():
                keys = _parse_keys(pid, env_name)
                if keys:
                    self.pools[pid] = ProviderPool(pid, keys)

    def ensure(self, provider: str) -> ProviderPool:
        with self._lock:
            if provider not in self.pools:
                self.pools[provider] = ProviderPool(provider, [])
            return self.pools[provider]

    def register_key(self, provider: str, key: str) -> bool:
        """Add a user-supplied key into the rotation so extra keys pasted in
        the UI immediately raise the site's total capacity."""
        return self.ensure(provider).add_key(key)

    def acquire(self, provider: str, exclude: Optional[set] = None) -> Optional[KeySlot]:
        pool = self.pools.get(provider)
        return pool.acquire(exclude) if pool else None

    def note(self, provider: str, key: str, *, status: Optional[int] = None,
             ok: bool = False) -> None:
        """Report the outcome of a call so the pool can self-heal."""
        pool = self.pools.get(provider)
        if not pool:
            return
        slot = pool.find(key)
        if not slot:
            return
        if ok:
            slot.note_ok()
        elif status == 429:
            slot.note_429()
        else:
            slot.note_error()

    def providers_with_keys(self) -> List[str]:
        return [p for p, pool in self.pools.items() if len(pool) > 0]

    def total_capacity_rpm(self) -> int:
        return sum(p.capacity_rpm() for p in self.pools.values())

    def snapshot(self) -> Dict:
        pools = [p.snapshot() for p in self.pools.values() if len(p) > 0]
        return {
            "providers": len(pools),
            "total_keys": sum(p["keys"] for p in pools),
            "capacity_rpm": self.total_capacity_rpm(),
            "estimated_concurrent_callers": self.total_capacity_rpm() // 4,
            "pools": pools,
        }


# Module-level singleton used by brain.py / server.py.
POOL = BrainPool()
