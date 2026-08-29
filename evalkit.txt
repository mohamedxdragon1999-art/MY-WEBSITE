"""Measurement primitives for voice-agent evaluation.

WHY THIS FILE EXISTS
--------------------
Every serious voice-AI team (ElevenLabs, OpenAI, Google) reports the same small
set of numbers, and reports them the same way. Before this file, this project had
1174 passing tests that all answered yes/no questions ("did it emit an event?")
and not one that answered a QUANTITATIVE one ("how accurate?", "how fast at the
95th percentile?"). Boolean tests catch crashes; they cannot catch a regression
that makes the agent 200ms slower or 3% less accurate, which is exactly the kind
of regression that loses a phone call.

THE RULES THIS ENCODES, AND WHY
-------------------------------
1. WER is computed on NORMALISED text. "Okay, 20%." and "okay 20 percent" are the
   same words spoken; scoring them as errors measures your punctuation
   conventions, not your recogniser. Whisper's published benchmarks normalise for
   exactly this reason, and un-normalised WER is the most common way vendors
   accidentally overstate error rates.
2. Latency is reported as PERCENTILES, never as a mean. A mean hides the tail,
   and the tail is what users feel: one caller in twenty hitting 2s of dead air
   is a broken product even when the average looks excellent. Published guidance
   is explicit that ignoring p99 spikes is a top testing mistake.
3. Detection quality is precision/recall/F1, not accuracy. Endpointing is a
   heavily imbalanced problem - a detector that never fires can score high
   "accuracy" while never letting anyone finish a sentence.

Stdlib only, deterministic, no network: it must run in CI on any machine.
"""

from __future__ import annotations

import math
import re
import unicodedata
from typing import Dict, Iterable, List, Sequence, Tuple

# ---------------------------------------------------------------------------
# Text normalisation
# ---------------------------------------------------------------------------

# Spoken-form equivalences. Deliberately small and boring: an aggressive
# normaliser flatters the model by erasing real errors.
_CONTRACTIONS = {
    "can't": "cannot", "won't": "will not", "n't": " not",
    "i'm": "i am", "it's": "it is", "that's": "that is",
    "i've": "i have", "we're": "we are", "you're": "you are",
    "don't": "do not", "didn't": "did not", "doesn't": "does not",
    "let's": "let us", "i'll": "i will", "we'll": "we will",
}

_NUMBER_WORDS = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
    "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine",
    "10": "ten", "11": "eleven", "12": "twelve",
}

_FILLERS = ("uh", "um", "erm", "mm", "hmm", "uhh", "umm")

_PUNCT = re.compile(r"[^\w\s']", re.UNICODE)
_WS = re.compile(r"\s+")


def normalize_text(s: str, *, drop_fillers: bool = False,
                   spell_numbers: bool = True) -> str:
    """Canonical spoken form: lowercase, unpunctuated, single-spaced.

    `drop_fillers` is OFF by default. Whether "um" counts as an error depends on
    the question being asked - for a transcript it is an error, for turn-taking
    research it is signal - so the caller must choose explicitly rather than
    inherit a hidden default.
    """
    if not s:
        return ""
    # NFKC folds typographic variants (curly apostrophes, full-width forms) so
    # they cannot masquerade as substitutions.
    s = unicodedata.normalize("NFKC", s).lower().strip()
    s = s.replace("\u2019", "'").replace("\u02bc", "'")
    for k, v in _CONTRACTIONS.items():
        s = s.replace(k, v)
    s = _PUNCT.sub(" ", s)
    toks = [t for t in _WS.split(s) if t]
    out: List[str] = []
    for t in toks:
        if drop_fillers and t in _FILLERS:
            continue
        if spell_numbers and t in _NUMBER_WORDS:
            t = _NUMBER_WORDS[t]
        out.append(t)
    return " ".join(out)


# ---------------------------------------------------------------------------
# Edit distance / WER / CER
# ---------------------------------------------------------------------------

def edit_ops(ref: Sequence, hyp: Sequence) -> Tuple[int, int, int]:
    """(substitutions, deletions, insertions) via Levenshtein backtrace.

    Returning the breakdown rather than one number is what makes the metric
    actionable: deletions mean the recogniser is dropping audio (a capture or
    endpointing bug), insertions mean it is hallucinating (a decoding or
    echo bug). A single WER figure cannot tell those apart, and they have
    completely different fixes.
    """
    n, m = len(ref), len(hyp)
    if n == 0:
        return (0, 0, m)
    if m == 0:
        return (0, n, 0)

    # Full DP table: O(n*m) memory is fine at test scale and lets us backtrace.
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if ref[i - 1] == hyp[j - 1]:
                d[i][j] = d[i - 1][j - 1]
            else:
                d[i][j] = 1 + min(d[i - 1][j - 1],   # substitute
                                  d[i - 1][j],       # delete
                                  d[i][j - 1])       # insert

    sub = dele = ins = 0
    i, j = n, m
    while i > 0 and j > 0:
        if ref[i - 1] == hyp[j - 1] and d[i][j] == d[i - 1][j - 1]:
            i, j = i - 1, j - 1
        elif d[i][j] == d[i - 1][j - 1] + 1:
            sub += 1
            i, j = i - 1, j - 1
        elif d[i][j] == d[i - 1][j] + 1:
            dele += 1
            i -= 1
        else:
            ins += 1
            j -= 1
    dele += i
    ins += j
    return (sub, dele, ins)


def edit_distance(ref: Sequence, hyp: Sequence) -> int:
    s, d, i = edit_ops(ref, hyp)
    return s + d + i


def wer(ref: str, hyp: str, **kw) -> float:
    """Word error rate on normalised text. 0.0 is perfect; can exceed 1.0."""
    r = normalize_text(ref, **kw).split()
    h = normalize_text(hyp, **kw).split()
    if not r:
        return 0.0 if not h else 1.0
    return edit_distance(r, h) / len(r)


def cer(ref: str, hyp: str, **kw) -> float:
    """Character error rate. More sensitive than WER on short utterances, where
    one wrong word out of three looks like a catastrophic 33%."""
    r = normalize_text(ref, **kw).replace(" ", "")
    h = normalize_text(hyp, **kw).replace(" ", "")
    if not r:
        return 0.0 if not h else 1.0
    return edit_distance(r, h) / len(r)


def wer_detail(ref: str, hyp: str, **kw) -> Dict[str, float]:
    r = normalize_text(ref, **kw).split()
    h = normalize_text(hyp, **kw).split()
    sub, dele, ins = edit_ops(r, h)
    n = len(r) or 1
    return {
        "wer": (sub + dele + ins) / n,
        "sub": sub, "del": dele, "ins": ins,
        "ref_words": len(r), "hyp_words": len(h),
    }


# ---------------------------------------------------------------------------
# Latency percentiles
# ---------------------------------------------------------------------------

def percentile(values: Iterable[float], p: float) -> float:
    """Linear-interpolated percentile, p in 0..100.

    Interpolating rather than picking the nearest rank keeps small samples from
    reporting the same number for p95 and p99, which would silently hide a tail.
    """
    xs = sorted(float(v) for v in values)
    if not xs:
        return 0.0
    if len(xs) == 1:
        return xs[0]
    p = max(0.0, min(100.0, float(p)))
    k = (len(xs) - 1) * (p / 100.0)
    lo = math.floor(k)
    hi = math.ceil(k)
    if lo == hi:
        return xs[int(k)]
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def summarize(values: Iterable[float]) -> Dict[str, float]:
    xs = [float(v) for v in values]
    if not xs:
        return {"n": 0, "p50": 0.0, "p90": 0.0, "p95": 0.0, "p99": 0.0,
                "mean": 0.0, "max": 0.0, "min": 0.0}
    return {
        "n": len(xs),
        "p50": percentile(xs, 50),
        "p90": percentile(xs, 90),
        "p95": percentile(xs, 95),
        "p99": percentile(xs, 99),
        "mean": sum(xs) / len(xs),
        "max": max(xs),
        "min": min(xs),
    }


def fmt_summary(name: str, s: Dict[str, float], unit: str = "ms") -> str:
    return ("%-22s n=%-4d p50=%-7.1f p90=%-7.1f p95=%-7.1f p99=%-7.1f max=%-7.1f %s"
            % (name, s["n"], s["p50"], s["p90"], s["p95"], s["p99"], s["max"], unit))


# ---------------------------------------------------------------------------
# Detection quality
# ---------------------------------------------------------------------------

def prf(tp: int, fp: int, fn: int) -> Dict[str, float]:
    """Precision / recall / F1.

    Used instead of accuracy because endpointing and barge-in detection are
    imbalanced: a detector that never fires looks excellent under accuracy while
    being useless, and one that always fires looks fine under recall alone while
    cutting every caller off mid-word.
    """
    prec = tp / (tp + fp) if (tp + fp) else 0.0
    rec = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) else 0.0
    return {"precision": prec, "recall": rec, "f1": f1,
            "tp": tp, "fp": fp, "fn": fn}


# ---------------------------------------------------------------------------
# Audio-domain probes (used to build adversarial inputs)
# ---------------------------------------------------------------------------

def rms(samples: Sequence[float]) -> float:
    if not samples:
        return 0.0
    return math.sqrt(sum(float(s) * float(s) for s in samples) / len(samples))


def dbfs(samples: Sequence[float]) -> float:
    r = rms(samples)
    return -120.0 if r <= 1e-9 else 20.0 * math.log10(min(1.0, r))


def clipped_fraction(samples: Sequence[float], thresh: float = 0.999) -> float:
    if not samples:
        return 0.0
    return sum(1 for s in samples if abs(float(s)) >= thresh) / len(samples)


__all__ = [
    "normalize_text", "edit_ops", "edit_distance", "wer", "cer", "wer_detail",
    "percentile", "summarize", "fmt_summary", "prf",
    "rms", "dbfs", "clipped_fraction",
]
