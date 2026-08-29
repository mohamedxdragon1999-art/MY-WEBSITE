"""Human pacing: when to pause, how long, when NOT to, and why.

THE PROBLEM THIS SOLVES
-----------------------
v51 synthesised a reply in clauses and the browser scheduled them with
`playHead += audio.duration` - deliberately, perfectly gapless. Each clause was
also synthesised independently, so every clause began and ended at a hard
boundary with no breath and no silence between them.

The result is speech with ZERO inter-clause silence. That is not "slightly less
natural"; it is one of the single strongest robot tells that exists. Real speech
is roughly 20-30% silence by duration. A voice that never pauses reads as
synthetic within about two seconds, no matter how good the vocoder is - which is
why adding a better TTS model alone would not have fixed "not human enough".

WHY A PLANNER, AND NOT JUST "ADD 300ms EVERYWHERE"
--------------------------------------------------
Because uniform pauses are also robotic, just differently. A metronome is not
human either. Human pause placement is *informative* - the length of a silence
carries meaning:

  - a pause AFTER a sentence closes an idea
  - a pause BEFORE a contrast ("but...") warns you the direction is changing
  - a pause BEFORE bad news softens it, and gives you a moment to brace
  - a pause BEFORE a number is the sound of someone actually checking
  - NO pause when answering a direct yes/no, because hesitating there reads as
    evasion or incompetence

So the planner is explicitly a model of MEANING, not of typography. Every rule
below returns a reason string, which is surfaced in the debug panel, because a
behaviour you cannot explain is a behaviour you cannot tune.

THE PART THAT MATTERS MOST: THE BUDGET
--------------------------------------
The user's requirement was "pauses when needed" AND "fast". Those conflict, and
a rule engine with no ceiling always resolves that conflict the wrong way -
every individual pause looks justified while the reply as a whole becomes
sluggish. So there is a hard per-turn silence budget (`MAX_TURN_PAUSE_MS`).
Once it is spent, later pauses are compressed toward zero. This is the "when NOT
to" half of the request, and it is enforced structurally rather than left to
rule tuning.

Determinism: jitter comes from a per-session seeded RNG. Real pause lengths are
never identical, so a constant 300ms is itself detectable - but tests need
reproducibility, so randomness is seeded rather than global.

STDLIB ONLY. No model, no network, no numpy. Cost is a few microseconds per
clause, which matters because this runs inside the reply hot path.
"""
from __future__ import annotations

import os
import random
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

# --- tunables ---------------------------------------------------------------

SENTENCE_PAUSE_MS = 300      # after . ! ? - closes an idea
CLAUSE_PAUSE_MS = 140        # after , ; - groups words
COLON_PAUSE_MS = 220         # after : or - - introduces a list or an aside
PARAGRAPH_PAUSE_MS = 460     # topic change

CONTRAST_BONUS_MS = 150      # before but / however
BAD_NEWS_BONUS_MS = 260      # before unfortunately / I'm afraid
RECALL_BONUS_MS = 170        # before a number, price, date, name
EMPHASIS_BONUS_MS = 120      # before the actual answer to a direct question

MAX_PAUSE_MS = 900           # nothing is ever longer than this
MAX_TURN_PAUSE_MS = 1500     # total added silence per reply - the hard budget

# Regex fragments. Compiled once at import: this is a hot path.
_CONTRAST = re.compile(
    r"^\W*(but|however|although|though|that said|on the other hand|"
    r"then again|whereas|still|yet)\b", re.I)
_BAD_NEWS = re.compile(
    r"^\W*(unfortunately|i'?m afraid|sadly|regrettably|sorry|apologies|"
    r"we can'?t|i can'?t|we cannot|i cannot|there'?s no|we don'?t|"
    r"that'?s not)\b", re.I)
_GOOD_NEWS = re.compile(
    r"^\W*(great|good news|absolutely|perfect|excellent|of course|"
    r"happy to|certainly|sure)\b", re.I)
_HAS_NUMBER = re.compile(r"\d|\b(one|two|three|four|five|six|seven|eight|nine|"
                         r"ten|eleven|twelve|twenty|thirty|forty|fifty|"
                         r"hundred|thousand|million)\b", re.I)
_DIRECT_ANSWER = re.compile(r"^\W*(yes|yeah|yep|no|nope|correct|exactly|right)\b", re.I)
_QUESTION_END = re.compile(r"\?\s*$")
_SENTENCE_END = re.compile(r"[.!?][\"')\]]*\s*$")
_CLAUSE_END = re.compile(r"[,;][\"')\]]*\s*$")
_COLON_END = re.compile(r"[:\u2014-][\"')\]]*\s*$")

# Backchannels. Short, non-committal, and deliberately NOT answers - their whole
# job is to say "I am still here and still listening" without taking the turn.
BACKCHANNELS = ("mm-hm", "right", "I see", "sure", "got it", "okay")
EMPATHY_BACKCHANNELS = ("I hear you", "I understand", "that makes sense",
                        "of course")

# Thinking sounds. Used ONLY to cover real measured latency - see should_fill().
# A filler that covers nothing is a lie about effort and it makes the agent
# sound hesitant rather than thoughtful.
FILLERS = ("Let me see", "One moment", "Let me check that", "Right", "Okay so")


def _flag(name: str, default: bool) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw not in ("0", "false", "no", "off")


def _num(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name) or default)
    except (TypeError, ValueError):
        return default


@dataclass
class Pause:
    """A planned silence in front of one clause."""
    ms: int = 0
    reason: str = ""

    def as_meta(self) -> Dict[str, object]:
        if self.ms <= 0:
            return {}
        return {"pause_ms": self.ms, "pause_reason": self.reason}


@dataclass
class Pacer:
    """Per-session pacing state.

    One instance per call. It has to be stateful because the interesting rules
    are all about SEQUENCE - budget spent so far, whether we just paused, whether
    a filler was already used this turn. A stateless function cannot avoid
    pausing twice in a row, and pausing twice in a row is the specific failure
    that makes a voice sound broken rather than thoughtful.
    """

    seed: int = 0
    enabled: bool = field(default_factory=lambda: _flag("VOICE_PACING", True))
    intensity: float = field(
        default_factory=lambda: max(0.0, min(2.0, _num("VOICE_PACING_INTENSITY", 1.0))))

    _rng: random.Random = field(init=False, repr=False)
    _spent_ms: int = 0
    _index: int = 0
    _last_pause_ms: int = 0
    _filled_turn: int = -1
    _turn: int = 0
    _last_backchannel_turn: int = -99
    trace: List[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed or 1234567)

    # -- turn lifecycle ----------------------------------------------------
    def start_turn(self) -> None:
        """Reset the per-reply budget. Called when a new reply begins."""
        self._turn += 1
        self._spent_ms = 0
        self._index = 0
        self._last_pause_ms = 0
        self.trace = []

    @property
    def spent_ms(self) -> int:
        return self._spent_ms

    def _jitter(self, ms: int) -> int:
        """+/-18% so no two pauses are identical.

        Humans are incapable of reproducing a duration exactly. A voice that
        pauses for precisely 300ms every single time is measurably mechanical
        even when the placement is perfect.
        """
        if ms <= 0:
            return 0
        return int(ms * (1.0 + self._rng.uniform(-0.18, 0.18)))

    # -- the main rule -----------------------------------------------------
    def plan(
        self,
        text: str,
        *,
        prev_text: str = "",
        is_first: bool = False,
        is_last: bool = False,
        arousal: float = 0.0,
        valence: float = 0.0,
        caller_valence: float = 0.0,
    ) -> Pause:
        """Decide the silence that belongs in FRONT of `text`.

        arousal/valence describe the AGENT's intended delivery (from
        engines/sentiment.py); caller_valence describes the CALLER's state, which
        matters because you do not pace a frustrated person the way you pace a
        cheerful one.
        """
        if not self.enabled or not text:
            return Pause()

        self._index += 1

        # RULE 0 - never delay the first sound of a reply.
        # Time-to-first-audio is the number the caller actually feels as
        # "responsiveness". Any silence here is pure regression, no matter how
        # natural it would be in isolation.
        if is_first or not prev_text:
            return Pause()

        base, reason = self._boundary(prev_text)
        if base <= 0:
            return Pause()

        bonus, why = self._semantic_bonus(text)
        base += bonus
        if why:
            reason = f"{reason}+{why}"

        # RULE - arousal compresses, calm expands.
        # An excited or urgent speaker runs clauses together; a calm or somber
        # one leaves air. This single multiplier is most of what makes the same
        # sentence read as "urgent" vs "gentle".
        base *= (1.0 - 0.30 * max(0.0, min(1.0, arousal)))
        if valence < -0.25:
            base *= 1.18            # bad news is delivered slowly

        # RULE - empathy. Do not rush someone who is upset. Rushing a frustrated
        # caller is read as dismissiveness, which is the single most damaging
        # thing a support voice can do.
        if caller_valence < -0.3:
            base *= 1.20

        base *= self.intensity

        # RULE - never two long pauses back to back. Consecutive long silences
        # sound like the line dropped, not like thoughtfulness.
        if self._last_pause_ms >= SENTENCE_PAUSE_MS:
            base *= 0.55
            reason += "+damped"

        ms = self._jitter(int(base))
        ms = max(0, min(MAX_PAUSE_MS, ms))

        # RULE - the budget. This is the "when NOT to pause" guarantee: as the
        # reply gets longer, pauses shrink, so a long answer never accumulates
        # into something that feels slow.
        remaining = MAX_TURN_PAUSE_MS - self._spent_ms
        if remaining <= 0:
            self._last_pause_ms = 0
            self.trace.append(f"{self._index}:0:budget-exhausted")
            return Pause()
        if ms > remaining:
            ms = remaining
            reason += "+capped"

        # RULE - the last clause gets a shorter run-up. Trailing off before the
        # final phrase makes the reply sound unsure of its own conclusion.
        if is_last:
            ms = int(ms * 0.8)

        self._spent_ms += ms
        self._last_pause_ms = ms
        self.trace.append(f"{self._index}:{ms}:{reason}")
        return Pause(ms=ms, reason=reason)

    # -- rule helpers ------------------------------------------------------
    def _boundary(self, prev: str) -> Tuple[float, str]:
        """How strong is the break we just crossed? Based on the PREVIOUS clause,
        because punctuation belongs to the text that ended, not the text that
        is starting."""
        p = prev.rstrip()
        if p.endswith("\n\n"):
            return PARAGRAPH_PAUSE_MS, "paragraph"
        if _QUESTION_END.search(p):
            # After the agent asks a question the reply is over and we are
            # listening, so an internal pause is meaningless here. But if more
            # text does follow a question mark, a real break belongs there.
            return SENTENCE_PAUSE_MS * 1.15, "after-question"
        if _SENTENCE_END.search(p):
            return SENTENCE_PAUSE_MS, "sentence"
        if _COLON_END.search(p):
            return COLON_PAUSE_MS, "colon"
        if _CLAUSE_END.search(p):
            return CLAUSE_PAUSE_MS, "clause"
        # No punctuation: the chunker split mid-sentence purely for streaming
        # reasons. Inserting silence inside a grammatical unit is worse than no
        # pause at all - it sounds like a stutter or a dropped packet.
        return 0.0, "mid-sentence"

    def _semantic_bonus(self, text: str) -> Tuple[float, str]:
        """Extra silence justified by what is about to be SAID."""
        # A direct yes/no must land immediately. Hesitating before "yes" reads as
        # reluctance; hesitating before "no" reads as evasion. This rule
        # SUBTRACTS, and it is checked first because it outranks the others.
        if _DIRECT_ANSWER.match(text):
            return -CLAUSE_PAUSE_MS, "direct-answer"
        if _BAD_NEWS.match(text):
            return BAD_NEWS_BONUS_MS, "bad-news"
        if _CONTRAST.match(text):
            return CONTRAST_BONUS_MS, "contrast"
        if _GOOD_NEWS.match(text):
            # Good news is delivered promptly - eagerness is the point.
            return -40, "good-news"
        if _HAS_NUMBER.search(text[:48]):
            return RECALL_BONUS_MS, "recall"
        return 0.0, ""

    # -- thinking sounds ---------------------------------------------------
    def should_fill(self, elapsed_ms: float, *, threshold_ms: float = 700.0) -> Optional[str]:
        """A filler, but only when there is genuine dead air to cover.

        Gated on MEASURED elapsed time, never on "this looks like a hard
        question". If the brain answers in 200ms, a filler makes a fast reply
        slower and sounds affected. If the brain takes two seconds, silence
        sounds like a dropped call and the filler is doing real work.

        At most one per turn: repeated fillers are the most irritating failure
        mode of every voice agent that has tried this.
        """
        if not self.enabled:
            return None
        if self._filled_turn == self._turn:
            return None
        if elapsed_ms < threshold_ms:
            return None
        self._filled_turn = self._turn
        return self._rng.choice(FILLERS)

    def backchannel(self, *, caller_ms: float, caller_valence: float = 0.0,
                    min_ms: float = 4200.0) -> Optional[str]:
        """A listening noise while the CALLER is still talking.

        Only for a genuinely long turn. On a short turn the caller is about to
        stop anyway, and speaking over them to say "mm-hm" is an interruption
        wearing a helpful costume.

        Rate-limited to once every few turns for the same reason.
        """
        if not self.enabled or caller_ms < min_ms:
            return None
        if self._turn - self._last_backchannel_turn < 3:
            return None
        self._last_backchannel_turn = self._turn
        pool = EMPATHY_BACKCHANNELS if caller_valence < -0.3 else BACKCHANNELS
        return self._rng.choice(pool)


def plan_all(chunks: List[str], **kw) -> List[Pause]:
    """Convenience helper: plan a whole reply at once. Used by the tests and by
    non-streaming callers."""
    pacer = Pacer(seed=kw.pop("seed", 7))
    pacer.start_turn()
    out: List[Pause] = []
    prev = ""
    for i, c in enumerate(chunks):
        out.append(pacer.plan(c, prev_text=prev, is_first=(i == 0),
                             is_last=(i == len(chunks) - 1), **kw))
        prev = c
    return out


__all__ = ["Pacer", "Pause", "plan_all", "MAX_TURN_PAUSE_MS", "MAX_PAUSE_MS",
           "BACKCHANNELS", "FILLERS"]
