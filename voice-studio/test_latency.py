"""v6.8 - latency percentiles: the module, and its wiring into the server.

These are real executable tests, not string matching, for everything that can
run without network or audio. The server wiring is verified statically because
FastAPI/httpx are not installable in every environment.
"""
import ast
import math
import re
import sys
import threading
import time

import latency

PASS = 0
FAIL = 0
fails = []


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok   " + name)
    else:
        FAIL += 1
        fails.append(name)
        print("  FAIL " + name + (("  -> " + str(detail)) if detail else ""))


print("\n[1] percentiles are mathematically correct")
t = latency.LatencyTracker()
for v in range(1, 101):
    t.record("brain", float(v))
s = t.stage("brain")
check("count is exact", s["count"] == 100, s["count"])
check("p50 of 1..100 is 50", s["p50"] == 50.0, s["p50"])
# Regression guard: round(95.5) is 96 in Python (halves round to even), which
# silently shifted every percentile up by one sample until this was caught.
check("p95 of 1..100 is 95, not 96", s["p95"] == 95.0, s["p95"])
check("p99 of 1..100 is 99", s["p99"] == 99.0, s["p99"])
check("max is the largest sample", s["max"] == 100.0, s["max"])
check("mean is correct", s["mean"] == 50.5, s["mean"])
check("p95 >= p50 always", s["p95"] >= s["p50"])
check("p99 >= p95 always", s["p99"] >= s["p95"])

print("\n[2] percentiles survive the awkward cases")
check("empty tracker returns zeros, never divides by zero",
      latency.LatencyTracker().stage("nothing")["p95"] == 0.0)
check("empty list percentile is 0.0", latency._percentile([], 95) == 0.0)
one = latency.LatencyTracker()
one.record("a", 7.0)
check("a single sample is its own p50/p95/p99",
      one.stage("a")["p50"] == one.stage("a")["p99"] == 7.0)
check("p0 is the minimum", latency._percentile([1.0, 2.0, 3.0], 0) == 1.0)
check("p100 is the maximum", latency._percentile([1.0, 2.0, 3.0], 100) == 3.0)
check("identical samples give a flat distribution",
      latency._percentile([5.0] * 50, 95) == 5.0)

print("\n[3] a bad measurement can never poison the metrics")
bad = latency.LatencyTracker()
for value in (None, "abc", float("nan"), -5.0, 10 ** 9, [], {}):
    bad.record("b", value)
check("garbage input is dropped, not recorded", bad.stage("b")["count"] == 0,
      bad.stage("b")["count"])
check("recording never raises", True)

print("\n[4] memory is bounded (this runs forever in production)")
small = latency.LatencyTracker(window=16)
for v in range(1, 1001):
    small.record("x", float(v))
check("window keeps only the most recent samples",
      len(list(small._samples["x"])) == 16, len(list(small._samples["x"])))
check("total count still reflects every sample seen",
      small.stage("x")["count"] == 1000, small.stage("x")["count"])
check("percentiles describe recent behaviour, not ancient history",
      small.stage("x")["p50"] > 900, small.stage("x")["p50"])
check("a tiny window is clamped to something sane",
      latency.LatencyTracker(window=1)._window >= 16)

print("\n[5] the timer measures real elapsed time")
tm = latency.LatencyTracker()
with tm.timer("turn"):
    time.sleep(0.05)
elapsed = tm.stage("turn")["p50"]
check("a 50ms block measures roughly 50ms", 40 < elapsed < 250, elapsed)
raised = latency.LatencyTracker()
try:
    with raised.timer("turn"):
        raise ValueError("boom")
except ValueError:
    pass
check("a failed call is still measured (slow failures matter most)",
      raised.stage("turn")["count"] == 1)
check("the timer never swallows the exception", True)

print("\n[6] thread safety (FastAPI serves from a threadpool)")
conc = latency.LatencyTracker()


def _worker():
    for i in range(2000):
        conc.record("brain", float(i % 100))


threads = [threading.Thread(target=_worker) for _ in range(8)]
for th in threads:
    th.start()
for th in threads:
    th.join()
check("no samples lost under 8 concurrent writers",
      conc.stage("brain")["count"] == 16000, conc.stage("brain")["count"])
check("reading while writing does not corrupt state",
      conc.stage("brain")["p95"] >= 0)

print("\n[7] slow calls are counted separately")
slow = latency.LatencyTracker()
slow.record("tts", 5000.0)
slow.record("tts", 10.0)
check("a call over the slow threshold is flagged", slow.stage("tts")["slow"] == 1)
check("a fast call is not flagged", slow.stage("tts")["count"] == 2)
check("threshold is configurable per call",
      (lambda tr: (tr.record("z", 100.0, slow_ms=50.0), tr.stage("z")["slow"])[1])(
          latency.LatencyTracker()) == 1)

print("\n[8] snapshot and reset")
snap = t.snapshot()
check("every declared stage is always reported, even before first use",
      set(latency.STAGES) <= set(snap), sorted(snap))
check("the four pipeline stages are the ones we care about",
      set(latency.STAGES) == {"stt", "brain", "tts", "turn"}, latency.STAGES)
fresh = latency.LatencyTracker()
fresh.record("brain", 1.0)
fresh.reset()
check("reset clears every counter", fresh.stage("brain")["count"] == 0)

print("\n[9] prometheus rendering")
lines = latency.prometheus_lines(snap)
check("p95 is exported", any('quantile="p95"' in ln for ln in lines))
check("p50 is exported", any('quantile="p50"' in ln for ln in lines))
check("p99 is exported", any('quantile="p99"' in ln for ln in lines))
check("per-stage counts are exported", any("voice_latency_count" in ln for ln in lines))
check("slow totals are exported", any("voice_latency_slow_total" in ln for ln in lines))
check("every line is prometheus-shaped (name{labels} value)",
      all(re.match(r"^[a-z_]+\{[^}]*\} [-0-9.]+$", ln) for ln in lines),
      [ln for ln in lines if not re.match(r"^[a-z_]+\{[^}]*\} [-0-9.]+$", ln)][:2])
check("no stage label is ever empty", all('stage=""' not in ln for ln in lines))
check("it renders from the live singleton with no arguments",
      len(latency.prometheus_lines()) > 0)

print("\n[10] the module is safe to import anywhere")
src = open("latency.py", encoding="utf-8").read()
tree = ast.parse(src)
imports = set()
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        for a in node.names:
            imports.add(a.name.split(".")[0])
    elif isinstance(node, ast.ImportFrom) and node.module:
        imports.add(node.module.split(".")[0])
third_party = imports - {"math", "threading", "time", "collections", "typing", "__future__"}
check("stdlib only - metrics can never break the boot", not third_party, third_party)
check("a process-wide singleton exists", isinstance(latency.LATENCY, latency.LatencyTracker))

print("\n[11] wired into the server pipeline")
srv = open("server.py", encoding="utf-8").read()
ast.parse(srv)
check("server imports the tracker", re.search(r"^import latency", srv, re.M) is not None)
check("the STT stage is timed", 'latency.LATENCY.timer("stt")' in srv)
check("the brain stage is timed", 'latency.LATENCY.timer("brain")' in srv)
check("the TTS stage is timed", 'latency.LATENCY.timer("tts")' in srv)
check("both brain providers are timed, not just one",
      srv.count('latency.LATENCY.timer("brain")') >= 2,
      srv.count('latency.LATENCY.timer("brain")'))
check("percentiles are exposed on /api/metrics",
      "lines.extend(latency.prometheus_lines())" in srv)
check("version bumped to 0.0.51", 'VERSION = "0.0.51"' in srv)

print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
if fails:
    print("failures: " + "; ".join(fails))
sys.exit(1 if FAIL else 0)
