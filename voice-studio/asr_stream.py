"""Incremental ASR: constant-cost partial transcription with stable commits.

WHAT WAS WRONG IN v48
---------------------
`_liveTick()` re-uploaded the ENTIRE utterance every 700ms and re-ran the model
on all of it, because WebM/Opus cannot be sliced. Three consequences:

  * cost and latency grow as O(N^2) in utterance length;
  * speculation had to be disabled past ~40s (LIVE_MAX_CHUNKS), so exactly the
    long, complicated turns that most need help got the least;
  * every pass re-decoded audio whose words were already settled, so the model
    was free to CHANGE its mind about words the user had heard us commit.

THE FIX
-------
Audio is raw PCM now (see audio_frames.py), so it is sliceable. We only ever
transcribe the audio AFTER the last committed word, plus a short overlap for
left context. Work per tick is bounded by the pause length, not the utterance
length, and an utterance can run for minutes without degrading.

STABILITY: LocalAgreement-N
---------------------------
Partial hypotheses flicker ("i am" -> "i'm" -> "i am a"). Printing every guess
is fast and wrong. We keep the last N hypotheses and commit only the leading
words all N agree on, minus a holdback of the final words - those have no
right-hand context yet and are the ones the model revises. v48 had this and it
was the best idea in the file; it is preserved and then corrected in one
important way.

THE CORRECTION: v48 compared whole hypotheses of a GROWING window, so two
consecutive passes shared almost all of their audio and therefore agreed almost
by construction - including agreeing on the same mistake. Agreement between two
near-identical inputs is not evidence. Here each hypothesis covers a DIFFERENT,
advancing window, so when they agree on a word they agree from genuinely
different context, which is what makes agreement mean something.

STDLIB ONLY.
"""
from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Dict, List, Optional, Tuple

from audio_frames import SAMPLE_RATE, PcmStream, pcm16_to_wav

_WORD_RE = re.compile(r"[^\W_]+(?:'[^\W_]+)?", re.UNICODE)

# How many independent hypotheses must contain a word before we trust it.
# 2 is the classic LocalAgreement-2. We default to 2 because our windows now
# advance (see above) so each pass is genuinely independent evidence; v48 needed
# 3 to compensate for its overlapping windows, and paid ~700ms of extra latency
# for it.
AGREE_PASSES = 2

# Words held back from every commit. The final word of a partial has no
# right-hand context and is the one most often revised.
HOLDBACK_WORDS = 1

# Minimum new audio before another pass is worth making. Below this the model
# sees essentially the same clip and returns the same answer for full price.
MIN_NEW_AUDIO_MS = 180.0

# Left context replayed before the commit point on every pass.
OVERLAP_MS = 240.0

# HARD CEILING on the pending window.
#
# Everything above assumes the commit point keeps up with the audio. Usually it
# does. But commit advancement is an ESTIMATE (we rarely get word timestamps),
# and if the recogniser consistently returns fewer words than the audio really
# contains - a quiet speaker, a bad connection, a model that drops a clause -
# the commit point falls behind and the window grows without bound. That is the
# exact v48 failure mode reappearing through a different door, so guessing well
# is not good enough: the bound has to be structural.
#
# Past this many milliseconds of un-committed audio we stop waiting for
# agreement and accept the current hypothesis outright. Slightly less certain
# text is a far better trade than an unbounded upload on every tick.
MAX_PENDING_MS = 6000.0


def words_of(text: str) -> List[str]:
    return [w for w in (text or "").strip().split() if w]


def _key(w: str) -> str:
    """Comparison form of a word: case- and punctuation-insensitive.

    Commit decisions must not hinge on whether the model wrote "okay," or
    "Okay" - those are the same word and treating them as disagreement is what
    stalls a commit for an extra pass.
    """
    m = _WORD_RE.search((w or "").lower())
    return m.group(0) if m else ""


def agreed_prefix(hyps: List[str], holdback: int = HOLDBACK_WORDS) -> str:
    """Longest leading word run that EVERY hypothesis agrees on, minus holdback.

    Returns the newest spelling of each word, because later passes have more
    context and punctuate/capitalise better.
    """
    if not hyps:
        return ""
    lists = [words_of(h) for h in hyps]
    if any(not l for l in lists):
        return ""
    shortest = min(len(l) for l in lists)
    out: List[str] = []
    for i in range(shortest):
        k = _key(lists[0][i])
        if not k:
            break
        if any(_key(l[i]) != k for l in lists[1:]):
            break
        out.append(lists[-1][i])
    keep = max(0, len(out) - max(0, holdback))
    return " ".join(out[:keep])


def strip_overlap(hypothesis: str, tail_of_committed: str) -> str:
    """Drop the re-transcribed left-context words from the front of a hypothesis.

    Every pass replays OVERLAP_MS of already-committed audio so the decoder has
    context. Those words come back in the transcript and must be removed, or
    the committed text stutters ("cancel my cancel my order"). We align on the
    committed tail rather than on a byte count because the model may render the
    overlap with different spacing or punctuation.
    """
    hyp = words_of(hypothesis)
    tail = [_key(w) for w in words_of(tail_of_committed) if _key(w)]
    if not hyp or not tail:
        return " ".join(hyp)
    hk = [_key(w) for w in hyp]

    # Case 1 - the normal one. The hypothesis STARTS with words we already
    # committed, because we deliberately replayed them as left context. Find
    # the longest such run, longest first, so we never under-trim (under-
    # trimming duplicates words, which is worse than over-trimming by one).
    for n in range(min(len(tail), len(hk)), 0, -1):
        if hk[:n] == tail[-n:]:
            return " ".join(hyp[n:])

    # Case 2 - the whole hypothesis is a REPEAT of text we already have.
    #
    # Case 1 only catches an overlap that is aligned at the first word of the
    # hypothesis. A recogniser handed a window that still contains settled
    # audio can instead re-emit the entire phrase from an earlier point, so the
    # overlap begins in the MIDDLE of our committed text and the prefix test
    # above sees nothing to trim. Appending that produces the stutter
    # "cancel my order cancel my order", which is the single worst-looking
    # transcript bug there is - it reads as though the caller was ignored and
    # then heard twice.
    #
    # Guarded at 3+ words so genuine short repetition ("no, no", "yes yes")
    # is never swallowed - people really do say those, and deleting them
    # changes the meaning.
    if len(hk) >= 3 and len(tail) >= len(hk):
        if tail[-len(hk):] == hk:
            return ""
    return " ".join(hyp)


@dataclass
class Partial:
    """One incremental result."""
    committed: str = ""       # stable: safe to speculate on, never revised
    tail: str = ""            # provisional: shown on screen, may change
    changed: bool = False     # did `committed` grow on this tick?
    engine: str = ""
    ms: int = 0

    @property
    def text(self) -> str:
        return (self.committed + " " + self.tail).strip() if self.tail else self.committed

    def to_dict(self) -> Dict:
        return {
            "committed": self.committed,
            "tail": self.tail,
            "text": self.text,
            "changed": self.changed,
            "engine": self.engine,
            "ms": self.ms,
        }


TranscribeFn = Callable[[bytes], Awaitable[Dict[str, object]]]


class IncrementalTranscriber:
    """Turns a growing PcmStream into stable committed text.

    `transcribe_fn(wav_bytes) -> {"text": str, "engine": str, ...}` is injected
    rather than imported so this class is unit-testable with a fake recogniser
    and has no network dependency of its own.
    """

    def __init__(self,
                 stream: PcmStream,
                 transcribe_fn: TranscribeFn,
                 *,
                 agree_passes: int = AGREE_PASSES,
                 holdback: int = HOLDBACK_WORDS,
                 overlap_ms: float = OVERLAP_MS,
                 min_new_audio_ms: float = MIN_NEW_AUDIO_MS,
                 max_pending_ms: float = MAX_PENDING_MS) -> None:
        self.stream = stream
        self._transcribe = transcribe_fn
        self.agree_passes = max(1, int(agree_passes))
        self.holdback = max(0, int(holdback))
        self.overlap_ms = float(overlap_ms)
        self.min_new_audio_ms = float(min_new_audio_ms)
        self.max_pending_ms = float(max_pending_ms)
        self.forced_commits = 0

        self.committed = ""
        self.tail = ""
        self._hyps: List[str] = []
        self._busy = False
        self._last_end_sample = 0
        self.engine = ""
        self.passes = 0
        self.wasted_passes = 0

    # -- helpers -----------------------------------------------------------
    def _committed_tail(self, n: int = 6) -> str:
        return " ".join(words_of(self.committed)[-n:])

    def _repeat_guard_tail(self, hyp_words: int) -> str:
        """A longer tail, sized to the hypothesis, for the repeat check.

        The 6-word tail is right for finding the replayed left context, but it
        is too short to notice that a 9-word hypothesis is a verbatim repeat.
        The two checks want different amounts of history, so they get them.
        """
        return " ".join(words_of(self.committed)[-max(6, hyp_words):])

    def _have_new_audio(self) -> bool:
        new = self.stream.total_samples - self._last_end_sample
        return (1000.0 * new / self.stream.sample_rate) >= self.min_new_audio_ms

    def _advance_commit(self, window_start: int, window_end: int,
                        hyp_words: int, committed_words: int) -> None:
        """Move the audio commit point forward in proportion to words committed.

        We do not get word timestamps from every endpoint, so we estimate: if
        the window produced W words and we committed C of them, roughly C/W of
        the window's audio is now settled. The estimate is deliberately
        CONSERVATIVE (we keep a margin) because over-advancing permanently
        deletes audio that was never transcribed, while under-advancing only
        costs a little duplicated work that `strip_overlap` cleans up.
        """
        if hyp_words <= 0 or committed_words <= 0:
            return
        frac = min(1.0, committed_words / float(hyp_words))
        # 10% margin: never claim the last sliver of audio is settled.
        frac = max(0.0, frac - 0.10)
        span = max(0, window_end - window_start)
        self.stream.advance_commit(window_start + int(span * frac))

    # -- the incremental pass ---------------------------------------------
    async def tick(self) -> Optional[Partial]:
        """Run one incremental pass. Returns None when there was nothing to do.

        Never raises: a dropped partial is harmless because the final flush
        still runs. Losing the whole call because a partial failed is not.
        """
        if self._busy:
            return None
        if not self._have_new_audio():
            return None

        # Is the commit point falling behind the audio?
        pending_samples = self.stream.total_samples - self.stream.commit_sample
        pending_ms = 1000.0 * pending_samples / self.stream.sample_rate
        force = pending_ms >= self.max_pending_ms

        wav, start = self.stream.pending_wav(self.overlap_ms,
                                             max_ms=self.max_pending_ms)
        if not wav:
            return None
        end = self.stream.total_samples
        self._busy = True
        t0 = time.perf_counter()
        try:
            got = await self._transcribe(wav)
        except asyncio.CancelledError:
            raise
        except Exception:
            return None
        finally:
            self._busy = False
            self._last_end_sample = end

        self.passes += 1
        raw = str((got or {}).get("text") or "").strip()
        eng = str((got or {}).get("engine") or "")
        if eng:
            self.engine = eng
        if not raw:
            self.wasted_passes += 1
            return None

        # Remove the replayed left context (and reject verbatim repeats).
        hyp = strip_overlap(raw, self._repeat_guard_tail(len(words_of(raw))))
        if not hyp:
            return None

        self._hyps.append(hyp)
        if len(self._hyps) > self.agree_passes:
            self._hyps.pop(0)

        changed = False
        if force:
            # Bounded-window escape hatch. Accept the hypothesis as-is, advance
            # the commit point to the end of what we just transcribed, and drop
            # the agreement history (it describes a window that no longer
            # exists). Cost per tick is now guaranteed constant no matter how
            # the recogniser behaves.
            self.committed = (self.committed + " " + hyp).strip()
            self.forced_commits += 1
            self._hyps = []
            self.tail = ""
            self.stream.advance_commit(end)
            return Partial(committed=self.committed, tail="", changed=True,
                           engine=self.engine,
                           ms=int((time.perf_counter() - t0) * 1000))

        if len(self._hyps) >= self.agree_passes:
            stable = agreed_prefix(self._hyps, self.holdback)
            if stable:
                nwords = len(words_of(stable))
                self.committed = (self.committed + " " + stable).strip()
                changed = True
                self._advance_commit(start, end, len(words_of(hyp)), nwords)
                # Everything committed is gone from the pending window now, so
                # the hypothesis history must be rebased or the next agreement
                # check compares text from two different windows.
                self._hyps = [strip_overlap(h, stable) for h in self._hyps]
                self._hyps = [h for h in self._hyps if h]

        self.tail = self._hyps[-1] if self._hyps else ""
        return Partial(
            committed=self.committed,
            tail=self.tail,
            changed=changed,
            engine=self.engine,
            ms=int((time.perf_counter() - t0) * 1000),
        )

    async def flush(self) -> Partial:
        """Final pass over everything not yet committed.

        This is the authoritative transcript for the turn: it sees the complete
        remaining audio with context on both sides of every word. Its result
        always wins over partials, which are speculation by definition.
        """
        wav, _start = self.stream.pending_wav(self.overlap_ms,
                                              max_ms=self.max_pending_ms)
        final_tail = ""
        if wav:
            try:
                got = await self._transcribe(wav)
                raw = str((got or {}).get("text") or "").strip()
                eng = str((got or {}).get("engine") or "")
                if eng:
                    self.engine = eng
                if raw:
                    final_tail = strip_overlap(
                        raw, self._repeat_guard_tail(len(words_of(raw))))
            except asyncio.CancelledError:
                raise
            except Exception:
                final_tail = ""
        if not final_tail:
            # Nothing new from the flush - fall back to the best provisional
            # text we had. Speculation beats silence when it is all we have.
            final_tail = self.tail
        text = (self.committed + " " + final_tail).strip()
        self.committed = text
        self.tail = ""
        self._hyps = []
        self.stream.advance_commit(self.stream.total_samples)
        return Partial(committed=text, tail="", changed=bool(final_tail),
                       engine=self.engine)

    def reset(self) -> None:
        self.committed = ""
        self.tail = ""
        self._hyps = []
        self._last_end_sample = self.stream.total_samples
        self.stream.advance_commit(self.stream.total_samples)

    def stats(self) -> Dict:
        return {
            "passes": self.passes,
            "wasted": self.wasted_passes,
            "forced": self.forced_commits,
            "committed_words": len(words_of(self.committed)),
            "engine": self.engine,
        }


__all__ = [
    "IncrementalTranscriber", "Partial",
    "agreed_prefix", "strip_overlap", "words_of",
    "AGREE_PASSES", "HOLDBACK_WORDS", "OVERLAP_MS",
]
