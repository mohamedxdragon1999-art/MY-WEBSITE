"""Server-side conversation sessions (optional, in-memory, TTL-evicted).

Why: for an enterprise widget it's cleaner and safer if the browser sends only a
short `session_id` and the server keeps the recent turn history (bounded per
tenant). This avoids trusting the client with unbounded history, keeps payloads
tiny, and lets one tenant's history never leak into another's.

The store is process-local. For multi-worker / multi-box deployments set
gunicorn workers with sticky sessions, or swap this module's `Store` for a Redis
implementation (same tiny interface: append/history/reset). The rest of the app
doesn't care.

FAIRNESS BETWEEN TENANTS (found in the v0.0.44 audit)
-----------------------------------------------------
This store used to have exactly one bound: a global cap on the number of live
sessions, evicted oldest-first. Isolation was assumed to be handled by the fact
that keys are namespaced per tenant - but namespacing only stops history from
LEAKING, it does nothing about capacity. With one shared pool and global
oldest-first eviction, the busiest tenant simply takes the whole store, and a
quiet tenant's live conversation gets deleted mid-call to make room. Proven with
a probe: a flood of 500 sessions from one site destroyed another site's active
session, and that customer's agent instantly forgot the conversation.

So capacity is now fair-shared. Each tenant gets its own allowance, and a tenant
at its allowance evicts ITS OWN least-recently-used session - never a
neighbour's. If the global cap is somehow still reached, eviction takes from the
LARGEST tenant first, so the heaviest user of the box pays for the overflow
instead of the smallest.

Pure stdlib -> import-safe with no third-party deps.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Deque, Dict, List, Optional, Set


class _Session:
    __slots__ = ("tenant_id", "turns", "created", "last_seen")

    def __init__(self, tenant_id: str, max_turns: int):
        self.tenant_id = tenant_id
        self.turns: Deque[Dict] = deque(maxlen=max_turns)
        self.created = time.time()
        self.last_seen = self.created


class Store:
    def __init__(self, ttl_sec: float = 1800.0, max_sessions: int = 20_000,
                 max_per_tenant: int = 0):
        self._data: Dict[str, _Session] = {}
        # tenant_id -> set of keys, so per-tenant accounting never costs a scan
        # of the whole store on the hot path.
        self._owned: Dict[str, Set[str]] = {}
        self._lock = threading.Lock()
        self._ttl = ttl_sec
        self._max = max(1, int(max_sessions))
        # A tenant's fair share. Generous enough that a normal site (10-50
        # concurrent customers) never notices, small enough that one site cannot
        # occupy the whole box.
        if max_per_tenant and max_per_tenant > 0:
            self._max_tenant = int(max_per_tenant)
        else:
            self._max_tenant = max(64, self._max // 8)
        self._last_gc = time.monotonic()

    def _key(self, tenant_id: str, session_id: str) -> str:
        return f"{tenant_id}:{session_id}"

    # ---------------------------------------------------------------- internals
    def _drop_locked(self, key: str) -> None:
        """The ONLY way a session leaves the store, so the per-tenant index can
        never drift out of step with the data."""
        s = self._data.pop(key, None)
        if s is None:
            return
        owned = self._owned.get(s.tenant_id)
        if owned is not None:
            owned.discard(key)
            if not owned:
                self._owned.pop(s.tenant_id, None)

    def _oldest_of_locked(self, tenant_id: str) -> Optional[str]:
        owned = self._owned.get(tenant_id)
        if not owned:
            return None
        best = None
        best_seen = None
        for k in owned:
            s = self._data.get(k)
            if s is None:
                continue
            if best_seen is None or s.last_seen < best_seen:
                best, best_seen = k, s.last_seen
        return best

    def _largest_tenant_locked(self) -> Optional[str]:
        best = None
        best_n = -1
        for tid, keys in self._owned.items():
            if len(keys) > best_n:
                best, best_n = tid, len(keys)
        return best

    # ------------------------------------------------------------------- public
    def history(self, tenant_id: str, session_id: Optional[str]) -> List[Dict]:
        if not session_id:
            return []
        with self._lock:
            key = self._key(tenant_id, session_id)
            s = self._data.get(key)
            if not s:
                return []
            now = time.time()
            # Enforce TTL on read so an expired session never comes back, even
            # before the periodic GC runs.
            if now - s.last_seen > self._ttl:
                self._drop_locked(key)
                return []
            s.last_seen = now
            return list(s.turns)

    def append(self, tenant_id: str, session_id: Optional[str], role: str,
               content: str, max_turns: int = 12) -> None:
        if not session_id or not content:
            return
        key = self._key(tenant_id, session_id)
        with self._lock:
            s = self._data.get(key)
            if s is None:
                # A NEW session for this tenant. If the tenant is already at its
                # fair share, it evicts its OWN least-recently-used session.
                # This is the line that stops one busy site from deleting a
                # different site's live conversation.
                owned = self._owned.setdefault(tenant_id, set())
                while len(owned) >= self._max_tenant:
                    victim = self._oldest_of_locked(tenant_id)
                    if victim is None:
                        break
                    self._drop_locked(victim)
                    owned = self._owned.setdefault(tenant_id, set())
                s = _Session(tenant_id, max_turns)
                self._data[key] = s
                owned.add(key)
            if s.turns.maxlen != max_turns:
                # resize while preserving most-recent turns
                s.turns = deque(list(s.turns)[-max_turns:], maxlen=max_turns)
            s.turns.append({"role": role, "content": content[:2000]})
            s.last_seen = time.time()
            self._gc_locked()

    def reset(self, tenant_id: str, session_id: Optional[str]) -> None:
        if not session_id:
            return
        with self._lock:
            self._drop_locked(self._key(tenant_id, session_id))

    def _gc_locked(self) -> None:
        now = time.monotonic()
        if now - self._last_gc < 60.0 and len(self._data) < self._max:
            return
        self._last_gc = now
        cutoff = time.time() - self._ttl
        stale = [k for k, s in self._data.items() if s.last_seen < cutoff]
        for k in stale:
            self._drop_locked(k)
        # Global backstop. Overflow is charged to the LARGEST tenant rather than
        # to whoever happens to be quietest, so heavy use cannot be paid for by
        # a small site losing its customers' context.
        guard = 0
        while len(self._data) > self._max and guard < self._max:
            guard += 1
            tid = self._largest_tenant_locked()
            if tid is None:
                break
            victim = self._oldest_of_locked(tid)
            if victim is None:
                self._owned.pop(tid, None)
                continue
            self._drop_locked(victim)

    def stats(self) -> Dict:
        with self._lock:
            return {
                "active_sessions": len(self._data),
                "active_tenants": len(self._owned),
                "max_sessions": self._max,
                "max_per_tenant": self._max_tenant,
            }
