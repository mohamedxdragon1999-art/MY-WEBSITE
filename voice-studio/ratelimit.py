"""Lightweight, dependency-free rate limiting + backpressure for Voice Studio.

Two layers protect the service when many websites each send 10-50 concurrent
users:

1. TokenBucket per (tenant, client-ip): smooths bursts and stops a single
   abusive client from starving everyone else. Refills continuously at
   `rate_per_min`, allowing short bursts up to `burst`.
2. A global in-flight gate (an asyncio.Semaphore, created in server.py) caps how
   many heavy requests run at once so the box degrades gracefully (HTTP 429 with
   Retry-After) instead of melting.

Everything here is pure stdlib and thread-safe, so it imports fine even when
fastapi/httpx are missing (offline import tests, workers, etc.).
"""
from __future__ import annotations

import threading
import time
from typing import Dict, Tuple


class TokenBucket:
    __slots__ = ("capacity", "tokens", "refill_per_sec", "last")

    def __init__(self, capacity: float, refill_per_sec: float):
        self.capacity = float(max(1.0, capacity))
        self.tokens = self.capacity
        self.refill_per_sec = float(max(0.001, refill_per_sec))
        self.last = time.monotonic()

    def take(self, amount: float = 1.0) -> Tuple[bool, float]:
        now = time.monotonic()
        elapsed = now - self.last
        self.last = now
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_per_sec)
        if self.tokens >= amount:
            self.tokens -= amount
            return True, 0.0
        # seconds until enough tokens are available again
        needed = amount - self.tokens
        retry_after = needed / self.refill_per_sec
        return False, round(retry_after, 2)


class RateLimiter:
    """Keyed token buckets with lazy creation + periodic stale eviction."""

    def __init__(self, max_keys: int = 50_000, idle_evict_sec: float = 900.0):
        self._buckets: Dict[str, TokenBucket] = {}
        self._seen: Dict[str, float] = {}
        self._lock = threading.Lock()
        self._max_keys = max_keys
        self._idle = idle_evict_sec
        self._last_gc = time.monotonic()

    def check(self, key: str, rate_per_min: float, burst: float) -> Tuple[bool, float]:
        """Return (allowed, retry_after_seconds)."""
        refill = max(0.001, float(rate_per_min) / 60.0)
        capacity = max(1.0, float(burst) or float(rate_per_min))
        now = time.monotonic()
        with self._lock:
            b = self._buckets.get(key)
            if b is None:
                b = TokenBucket(capacity, refill)
                self._buckets[key] = b
            else:
                # keep bucket params in sync if tenant limits change on reload
                b.capacity = capacity
                b.refill_per_sec = refill
            self._seen[key] = now
            ok, retry = b.take(1.0)
            self._maybe_gc(now)
            return ok, retry

    def _maybe_gc(self, now: float) -> None:
        if now - self._last_gc < 60.0 and len(self._buckets) < self._max_keys:
            return
        self._last_gc = now
        stale = [k for k, t in self._seen.items() if now - t > self._idle]
        for k in stale:
            self._buckets.pop(k, None)
            self._seen.pop(k, None)
        # hard cap: if still too big, drop the oldest
        if len(self._buckets) > self._max_keys:
            for k, _ in sorted(self._seen.items(), key=lambda kv: kv[1])[: len(self._buckets) - self._max_keys]:
                self._buckets.pop(k, None)
                self._seen.pop(k, None)

    def stats(self) -> Dict:
        with self._lock:
            return {"tracked_clients": len(self._buckets)}
