"""Rolling latency percentiles for every stage of the voice pipeline.

Why this exists
---------------
Averaged latency lies. A pipeline can show a healthy 400ms mean while one
caller in twenty waits three seconds, and the mean will never reveal it. In a
voice agent the tail IS the experience: the caller who waits 3s is the one who
thinks the product is broken. So we track PERCENTILES, and we care about P95.

Dependency-free (stdlib only) on purpose: metrics must never be the reason a
deployment fails to boot, and this way it is unit-testable anywhere.

Design notes
------------
* Bounded memory: each stage keeps at most _WINDOW recent samples in a deque,
  so percentiles describe how the service behaves NOW, not an hour ago.
* Thread-safe: the lock is only ever held for O(1) appends or a sort of a
  bounded window, never across an await.
* Never raises: bad input is dropped rather than propagated into a request.
"""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from typing import Deque, Dict, List, Optional

_WINDOW = 512

STAGES = (
    "stt",
    "brain",
    "tts",
    "turn",
)


def _percentile(values: List[float], pct: float) -> float:
    """Nearest-rank percentile. values must already be sorted.

    Nearest-rank rather than interpolation, so the number returned is always a
    real observed measurement - easier to reason about when chasing one slow
    call.
    """
    if not values:
        return 0.0
    if pct <= 0:
        return round(values[0], 1)
    if pct >= 100:
        return round(values[-1], 1)
    # Nearest-rank is ceil(pct/100 * N), 1-indexed. This MUST use math.ceil,
    # not round(x + 0.5): Python rounds halves to even, so round(95.5) is 96,
    # which silently shifted every percentile up by one sample. Caught by a
    # test asserting p95 of 1..100 == 95.
    rank = math.ceil((pct / 100.0) * len(values))
    idx = max(0, min(len(values) - 1, rank - 1))
    return round(values[idx], 1)


class LatencyTracker:
    """Thread-safe rolling percentiles per named stage."""

    def __init__(self, window: int = _WINDOW) -> None:
        self._window = max(16, int(window))
        self._samples: Dict[str, Deque[float]] = {}
        self._totals: Dict[str, float] = {}
        self._counts: Dict[str, int] = {}
        self._slow: Dict[str, int] = {}
        self._lock = threading.Lock()

    def record(self, stage: str, ms: float, slow_ms: float = 2000.0) -> None:
        """Record one measurement in milliseconds. Never raises."""
        try:
            value = float(ms)
        except (TypeError, ValueError):
            return
        if value != value or value < 0 or value > 3600000:
            return
        name = str(stage or "").strip() or "unknown"
        with self._lock:
            buf = self._samples.get(name)
            if buf is None:
                buf = deque(maxlen=self._window)
                self._samples[name] = buf
            buf.append(value)
            self._totals[name] = self._totals.get(name, 0.0) + value
            self._counts[name] = self._counts.get(name, 0) + 1
            if value >= slow_ms:
                self._slow[name] = self._slow.get(name, 0) + 1

    def stage(self, name: str) -> Dict[str, float]:
        """Percentile summary for a single stage."""
        with self._lock:
            buf = list(self._samples.get(name, ()))
            count = self._counts.get(name, 0)
            total = self._totals.get(name, 0.0)
            slow = self._slow.get(name, 0)
        buf.sort()
        return {
            "count": count,
            "slow": slow,
            "mean": round(total / count, 1) if count else 0.0,
            "p50": _percentile(buf, 50),
            "p95": _percentile(buf, 95),
            "p99": _percentile(buf, 99),
            "max": round(buf[-1], 1) if buf else 0.0,
        }

    def snapshot(self) -> Dict[str, Dict[str, float]]:
        """Summary for every stage, including declared-but-unused ones, so a
        fresh boot still reports a stable set of series."""
        with self._lock:
            names = set(self._samples) | set(STAGES)
        return {n: self.stage(n) for n in sorted(names)}

    def reset(self) -> None:
        with self._lock:
            self._samples.clear()
            self._totals.clear()
            self._counts.clear()
            self._slow.clear()

    def timer(self, stage: str) -> "_Timer":
        """with LATENCY.timer('brain'): ... records the elapsed time."""
        return _Timer(self, stage)


class _Timer:
    """Records elapsed wall time for a stage.

    It records on the way out even when the body raised, because a failed call
    that took four seconds is exactly the latency worth seeing.
    """

    __slots__ = ("_tracker", "_stage", "_t0")

    def __init__(self, tracker: LatencyTracker, stage: str) -> None:
        self._tracker = tracker
        self._stage = stage
        self._t0 = 0.0

    def __enter__(self) -> "_Timer":
        self._t0 = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        self._tracker.record(self._stage, (time.perf_counter() - self._t0) * 1000.0)
        return False

    async def __aenter__(self) -> "_Timer":
        self._t0 = time.perf_counter()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        self._tracker.record(self._stage, (time.perf_counter() - self._t0) * 1000.0)
        return False


def prometheus_lines(snap: Optional[Dict[str, Dict[str, float]]] = None,
                     tracker: Optional["LatencyTracker"] = None) -> List[str]:
    """Render a snapshot as Prometheus-style plaintext lines."""
    if snap is None:
        snap = (tracker or LATENCY).snapshot()
    lines: List[str] = []
    for stage in sorted(snap):
        s = snap[stage]
        for field in ("p50", "p95", "p99", "mean", "max"):
            lines.append(
                'voice_latency_ms{stage="%s",quantile="%s"} %s' % (stage, field, s.get(field, 0.0))
            )
        lines.append('voice_latency_count{stage="%s"} %s' % (stage, s.get("count", 0)))
        lines.append('voice_latency_slow_total{stage="%s"} %s' % (stage, s.get("slow", 0)))
    return lines


# Process-wide singleton used by the server.
LATENCY = LatencyTracker()
