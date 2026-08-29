"""CPU-only deployment policy (v51).

Why this module exists
----------------------
This project ships eight TTS engine ids, but only some of them can actually
produce audio on a machine with no GPU:

    kokoro      82M ONNX, ~1.8x real time on 4 CPU cores   LOCAL  free  Apache-2.0
    piper       tiny ONNX, ~30x real time                  LOCAL  free  always works
    edge        Microsoft neural voices                    CLOUD  free  no key
    magpie      NVIDIA NIM                                 CLOUD  free key needed

    fish        4B Dual-AR. Needs a GPU to run locally, AND the weights are
                under the Fish Audio Research License, which is NON-COMMERCIAL.
    chatterbox  0.5B. Its "sub-200ms" figure is measured on an RTX 4090; users
                report 500ms-1s even on GPU. Not a CPU real-time engine.

    best/human  routers, not models. They delegate to the engines above.

Before v51 both routers listed `fish` and `chatterbox` AHEAD of `kokoro`:

    server._FALLBACK_ORDER    = [human, fish, chatterbox, kokoro, edge, ...]
    human_engine._DEFAULT_ORDER = [fish, chatterbox, kokoro, edge, piper]

On a CPU-only box that is not merely suboptimal, it is a *latency tax*. Every
request walks the ladder, attempts two engines that cannot run on this hardware,
pays a failure (and possibly a network timeout) for each, and only then reaches
the engine that was always going to serve the audio.

This module centralises the single question "which engines can this box actually
use?" so the routers, the registry, and the docs cannot silently drift apart
from each other again.

Everything here is stdlib-only, pure, and deterministic. No clock, no I/O,
no randomness - so it is cheap to call on a hot path and trivial to test.
"""
from __future__ import annotations

import os
from typing import Dict, Iterable, List, Set

# --------------------------------------------------------------------------
# Engine classification
# --------------------------------------------------------------------------

#: Engines that need a local NVIDIA GPU to be usable in real time.
GPU_ENGINES = frozenset({"fish", "chatterbox"})

#: Engines whose WEIGHTS are not licensed for commercial use.
#: Fish Audio S2 Pro ships under the Fish Audio Research License: free for
#: research, commercial use requires a separate agreement with Fish Audio.
NON_COMMERCIAL_ENGINES = frozenset({"fish"})

#: Engines that run somewhere else. They cost no local CPU but need network.
CLOUD_ENGINES = frozenset({"edge", "magpie"})

#: Engines that genuinely run on a CPU, offline.
LOCAL_CPU_ENGINES = frozenset({"kokoro", "piper"})

#: Routers. Never blocked: they resolve to a concrete engine at call time.
ROUTER_ENGINES = frozenset({"best", "human"})

#: The ladder we want on a CPU-only box, best-sounding first.
#:
#: kokoro first because it is the highest-quality engine that actually runs
#: here (top-5 on the blind Speech Arena at 82M parameters, Apache-2.0).
#: edge second: it is free and very natural, but it is an online Microsoft
#: service, so it cannot be the thing we depend on.
#: piper third: never the prettiest, but it is ~30x real time and it has never
#: once failed to speak.
#: magpie last: cloud, and it needs a key.
CPU_SAFE_ORDER = ("kokoro", "edge", "piper", "magpie")


def _flag(name: str, default: bool) -> bool:
    """Read a boolean env var without raising on junk input."""
    raw = (os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return default


def enabled() -> bool:
    """Is CPU-only mode active?

    Defaults to TRUE as of v51. The overwhelmingly common deployment for this
    project is a cheap CPU VPS, and the previous default silently optimised for
    hardware most operators do not have.

    Set VOICE_CPU_ONLY=0 to restore the GPU-first ladders.
    """
    return _flag("VOICE_CPU_ONLY", True)


def allow_non_commercial() -> bool:
    """Allow engines whose weights forbid commercial use.

    Off by default. If you are only ever doing research or personal use, set
    VOICE_ALLOW_NONCOMMERCIAL=1 and `fish` becomes selectable again (assuming
    you also have the GPU to run it).
    """
    return _flag("VOICE_ALLOW_NONCOMMERCIAL", False)


def blocked_engines() -> Set[str]:
    """The set of engine ids this deployment should not attempt."""
    out: Set[str] = set()
    if enabled():
        out |= set(GPU_ENGINES)
    if not allow_non_commercial():
        out |= set(NON_COMMERCIAL_ENGINES)
    return out


def is_allowed(engine_id: str) -> bool:
    """May we attempt this engine on this box?"""
    eid = (engine_id or "").strip().lower()
    if not eid:
        return False
    if eid in ROUTER_ENGINES:
        return True
    return eid not in blocked_engines()


def block_reason(engine_id: str) -> str:
    """Explain a block in words an operator can act on. Empty if allowed."""
    eid = (engine_id or "").strip().lower()
    if is_allowed(eid):
        return ""
    bits: List[str] = []
    if eid in GPU_ENGINES and enabled():
        bits.append("needs a GPU (VOICE_CPU_ONLY=1)")
    if eid in NON_COMMERCIAL_ENGINES and not allow_non_commercial():
        bits.append("weights are non-commercial (VOICE_ALLOW_NONCOMMERCIAL=0)")
    return "; ".join(bits) or "not available on this deployment"


def filter_order(order: Iterable[str]) -> List[str]:
    """Drop unusable engines from a preference ladder, preserving order.

    Two guarantees that matter more than the filtering itself:

    1. De-duplicates, so a caller-supplied ladder cannot make us try the same
       engine twice.
    2. NEVER returns an empty list. Losing the voice entirely is a far worse
       failure than speaking with a lower-tier engine, so if filtering would
       empty the ladder we fall back to CPU_SAFE_ORDER, and if even that is
       empty we return the original input untouched.
    """
    seen: Set[str] = set()
    out: List[str] = []
    original: List[str] = []
    for raw in order or ():
        eid = (raw or "").strip().lower()
        if not eid or eid in seen:
            continue
        seen.add(eid)
        original.append(eid)
        if is_allowed(eid):
            out.append(eid)
    if out:
        return out
    safe = [e for e in CPU_SAFE_ORDER if is_allowed(e)]
    return safe or original


def preferred_order() -> List[str]:
    """The ladder to use when the caller has no opinion."""
    return filter_order(CPU_SAFE_ORDER)


# --------------------------------------------------------------------------
# CPU tuning
# --------------------------------------------------------------------------

#: Kokoro's ONNX real-time factor gets WORSE on longer input rather than
#: amortising down (measured 0.51 -> 0.69 from short to extended text). So the
#: cheapest speed win available on CPU is simply never handing it a long
#: string: synthesise in short pieces and concatenate. This also improves
#: time-to-first-audio, which is what a caller actually perceives as "fast".
_DEFAULT_CHUNK_CHARS = 180
_MIN_CHUNK_CHARS = 60
_MAX_CHUNK_CHARS = 400


def _int_env(name: str, default: int, lo: int, hi: int) -> int:
    try:
        val = int(float((os.environ.get(name) or "").strip()))
    except Exception:
        return default
    return max(lo, min(hi, val))


def max_synth_chars() -> int:
    """Longest string we hand to a CPU neural engine in one call."""
    return _int_env(
        "VOICE_CPU_CHUNK_CHARS", _DEFAULT_CHUNK_CHARS, _MIN_CHUNK_CHARS, _MAX_CHUNK_CHARS
    )


#: Punctuation that marks a place a human would naturally draw breath.
#: Order does not matter; we take the LATEST one that fits.
_CLAUSE_MARKS = (";", ":", ",", "\u2014", "\u2013")


def _clause_cut(window: str, floor: int) -> int:
    """Index just after the last clause boundary in `window`, or -1.

    `floor` guards against cutting so early that we emit a two-word fragment,
    which would sound worse than not splitting at all.
    """
    best = -1
    for mark in _CLAUSE_MARKS:
        idx = window.rfind(mark + " ")
        if idx > best:
            best = idx
    if best < floor:
        return -1
    return best + 1  # keep the punctuation attached to the head


def split_for_cpu(text: str, limit: int = 0) -> List[str]:
    """Split one already-sentence-sized string into CPU-friendly pieces.

    Splits on whitespace only, so words are never torn in half. A string that
    is already short enough comes back as a single-item list, which keeps this
    a no-op for the common case.

    v0.0.51 correction: the first version cut at an arbitrary space. That is
    fine for throughput but bad for the ear - a neural TTS renders each piece
    as a complete utterance, so an arbitrary cut lands a falling, sentence-final
    intonation in the MIDDLE of a sentence, and one sentence audibly becomes
    two. We now prefer a clause boundary (comma, semicolon, colon, dash), which
    is where a person would have paused anyway, and only fall back to a plain
    space when the piece contains no punctuation at all.
    """
    text = (text or "").strip()
    if not text:
        return []
    cap = limit if limit > 0 else max_synth_chars()
    if len(text) <= cap:
        return [text]

    out: List[str] = []
    rest = text
    floor = max(1, cap // 3)
    while len(rest) > cap:
        window = rest[: cap + 1]
        cut = _clause_cut(window, floor)
        if cut <= 0:
            cut = rest.rfind(" ", 0, cap + 1)
        if cut <= 0:
            # A single unbroken token longer than the cap. Hard-cut it rather
            # than loop forever; this is pathological input, not prose.
            cut = cap
        head = rest[:cut].strip()
        if head:
            out.append(head)
        rest = rest[cut:].strip()
        if not rest:
            break
    if rest:
        out.append(rest)
    return [p for p in out if p]


def worker_threads() -> int:
    """How many threads a CPU inference session should use.

    ONNX Runtime defaults to every core it can see. On a box that is also
    serving HTTP and WebSockets, letting one synthesis grab all cores makes the
    SECOND concurrent caller wait for the first. Leaving a core free keeps the
    event loop responsive under load.
    """
    override = _int_env("VOICE_CPU_THREADS", 0, 0, 64)
    if override > 0:
        return override
    try:
        cores = os.cpu_count() or 1
    except Exception:
        cores = 1
    if cores <= 2:
        return 1
    return max(1, cores - 1)


def describe() -> Dict[str, object]:
    """Machine-readable summary, for /api/health and the docs."""
    return {
        "cpu_only": enabled(),
        "allow_non_commercial": allow_non_commercial(),
        "blocked": sorted(blocked_engines()),
        "preferred_order": preferred_order(),
        "max_synth_chars": max_synth_chars(),
        "worker_threads": worker_threads(),
    }
