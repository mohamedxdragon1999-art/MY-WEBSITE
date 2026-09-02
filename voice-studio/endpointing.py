"""Semantic turn detection - deciding WHEN the caller has actually finished.

WHY THIS REPLACES THE REGEX LADDER IN app.js
--------------------------------------------
v48 decided the end of a turn with `_endpointDelay()`: a hand-written ladder of
regexes that each added or subtracted a fixed number of milliseconds. That
design has three structural faults, and together they are the single largest
source of both "it cuts me off" and "it takes ages to answer":

  1. IT IS A LADDER, SO ONLY ONE RULE EVER FIRES. `_endpointDelay` returns on
     the first match. "So, um, the thing is..." is a filler AND dangling AND
     hesitant - three independent reasons to wait - but it collected the bonus
     for exactly one of them. Evidence does not combine in a ladder.

  2. IT IS TEXT-ONLY. Humans do not signal the end of a turn with vocabulary,
     they signal it with PROSODY: pitch falls, energy drops, and the final
     syllable lengthens. Those cues arrive BEFORE the silence does, which is
     precisely why a person can answer you in 200ms without ever cutting you
     off. A text-only endpointer is structurally blind to the fastest signal
     available, so it can only ever compensate by waiting longer.

  3. IT IS UNCALIBRATED. The numbers (+1400, +850, -380) were chosen by hand.
     Nothing measures whether they are right, so nothing can improve them.

WHAT THIS DOES INSTEAD
----------------------
Every available cue is scored independently into a probability that the turn is
complete, the cues are FUSED in log-odds space (so evidence accumulates instead
of overwriting), and the fused probability is converted into how long we still
need to wait. Confident finish -> answer almost immediately. Ambiguous -> wait.
Clearly mid-thought -> hold the turn open indefinitely (up to a hard ceiling).

This is the difference between "wait 550ms for everybody" and "wait 120ms for
'yes, that's right.' and 2 seconds for 'my account number is, um-'".

STDLIB ONLY. No numpy, no model download, no network. It must be impossible for
this file to be the reason a call fails or a deploy breaks.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Tunables. Every one is a real, measurable quantity rather than a magic bonus.
# ---------------------------------------------------------------------------

# The floor is what a confident, clearly-finished turn costs. Human
# conversational gaps cluster around 200ms and turn-taking research puts the
# median between-speaker gap near zero, so anything above ~200ms already sounds
# slower than a person. We do not go below 120ms because below that we are
# reacting to the tail of the word itself rather than to a pause.
MIN_SILENCE_MS = 120.0

# The ceiling is what a genuinely ambiguous turn costs. Beyond ~1.6s the caller
# starts to believe the line is dead and repeats themselves, which is worse
# than a slightly early answer.
MAX_SILENCE_MS = 1600.0

# A turn that is clearly UNFINISHED ("my number is...") must not be governed by
# MAX_SILENCE_MS at all - people pause for two or three seconds mid-sentence
# while they read something off a card. This is the ceiling for those.
OPEN_TURN_MS = 4200.0

# Absolute safety net: a stuck microphone can never hold a turn open forever.
HARD_DEADLINE_MS = 45000.0


def _logit(p: float) -> float:
    """Probability -> log-odds, clamped so we never take log(0)."""
    p = min(0.9995, max(0.0005, float(p)))
    return math.log(p / (1.0 - p))


def _sigmoid(x: float) -> float:
    """Log-odds -> probability, overflow-safe in both directions."""
    if x >= 0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


# ---------------------------------------------------------------------------
# LEXICAL CUES
# ---------------------------------------------------------------------------

# Words that CANNOT end an English sentence. If the last word is one of these,
# the speaker is mid-clause no matter how long they pause. This is a closed
# class (function words), which is why a word list is the right tool here and
# a statistical model would be overkill.
_DANGLING_WORDS = frozenset("""
a an the and but or so because cause if when while that which who whom whose
to for with from at on in of my your our their his her its this these those
is are was were am be been being will would can could should shall may might
must do does did have has had i i'm we you they he she it there here
about into onto over under after before between during than then as by
some any every each either neither both few many much more most less least
let gonna wanna gotta trying going about
""".split())

# Hesitation / thinking noises. These are NOT words, they are the audible sound
# of the caller still composing a sentence. Ending a turn on one is the single
# most infuriating failure mode a voice agent has, because the caller was
# demonstrably still talking.
_FILLERS = frozenset("""
um umm ummm uh uhh uhhh er err erm ah ahh ahhh eh hm hmm hmmm mm mmm
like well okay ok right anyway basically actually literally
""".split())

# Pure acknowledgements. Said WHILE the agent is talking these are backchannels
# ("keep going"), not turns - interrupting yourself to answer "mhm" is what
# makes an agent feel deaf.
_BACKCHANNELS = frozenset("""
mhm mmhm mmhmm uhhuh uh-huh ahha aha yeah yep yup ok okay sure right
i-see gotcha exactly true nice wow oh ha
""".split())

# Short utterances that ARE complete turns. A bare "yes" needs no pause at all;
# confirmations are the most frequent utterance in a support call, so making
# them instant is the most-felt speed win in the product.
_COMPLETE_SHORT = frozenset("""
yes yeah yep yup no nope nah correct incorrect right wrong sure okay ok
please thanks thank-you exactly done stop start hello hi hey bye goodbye
help agreed confirm confirmed cancel continue repeat again louder slower
perfect great awesome nothing nevermind
""".split())

# Interrogatives at the START of an utterance make it a question, and a
# question is a strong end-of-turn signal even without a question mark,
# because the caller is explicitly handing the floor over.
_WH_WORDS = frozenset("what where when why who how which can could would will "
                      "do does did is are am should may might have has".split())

_WORD_RE = re.compile(r"[a-z0-9']+")

# Reading out a code, an email or a number. People pause between groups of
# characters, and every one of those pauses looks like the end of a turn to a
# silence timer. This is the classic "it interrupted me while I read my account
# number" bug.
_SPELLING_RE = re.compile(
    r"(\b[a-z0-9]\s+[a-z0-9]\s+[a-z0-9]\b)"       # s p e l l i n g
    r"|@|\bdot\b|\bdash\b|\bhyphen\b|\bunderscore\b|\bslash\b"
    r"|\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|double|triple)\b"
    r"\s+\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|double|triple)\b",
    re.I,
)


def tokenize(text: str) -> List[str]:
    """Lowercase word tokens. Punctuation is handled separately, on purpose:
    ASR punctuation is unreliable, so it may inform us but must never decide."""
    return _WORD_RE.findall((text or "").lower())


def strip_fillers(text: str) -> str:
    """Remove hesitation noise, preserving everything else verbatim.

    Used for the *speculation key* (so "um, cancel it" and "cancel it" reuse the
    same preemptive answer instead of paying for two) - NOT for what we send to
    the model. See `hesitation_ratio` for why the fillers themselves matter.
    """
    kept = []
    for w in (text or "").split():
        found = _WORD_RE.findall(w.lower())
        # A token with no word characters at all (a stray "-" or "...") is not a
        # filler; it is punctuation, and it stays. Indexing [0] unconditionally
        # here would raise on exactly that input.
        if not found or found[0] not in _FILLERS:
            kept.append(w)
    return " ".join(kept).strip()


def hesitation_ratio(text: str) -> float:
    """Fraction of tokens that are hesitation noise, 0..1.

    This is a genuine understanding signal, not junk to be filtered. A caller
    whose speech is 30% filler is uncertain, and an agent that knows that can
    slow down and offer help rather than firing back a brisk answer. We pass it
    to the brain as context instead of silently deleting it.
    """
    toks = tokenize(text)
    if not toks:
        return 0.0
    return sum(1 for t in toks if t in _FILLERS) / float(len(toks))


def is_backchannel(text: str) -> bool:
    """True if this is 'mhm / yeah / go on' and nothing else.

    Only meaningful while the AGENT is speaking. The same words said into
    silence are a real answer to a real question.
    """
    toks = tokenize(text)
    if not toks or len(toks) > 3:
        return False
    return all(t in _BACKCHANNELS for t in toks)


def lexical_completion(text: str) -> Tuple[float, str]:
    """P(the caller has finished) from the WORDS alone. Returns (p, reason).

    Unlike the v48 ladder, every cue below contributes to one running score in
    log-odds space, so three weak "keep waiting" signals correctly outweigh one
    weak "they're done" signal instead of being discarded by an early return.
    """
    raw = (text or "").strip()
    toks = tokenize(raw)
    if not toks:
        # No words at all. Genuinely unknown, so contribute nothing.
        return 0.5, "empty"

    reasons: List[str] = []
    # Prior: most utterances that reach us with a pause after them are, in fact,
    # finished. Slightly above even.
    score = _logit(0.55)

    last = toks[-1]
    n = len(toks)

    # --- strongest single cue: the last word cannot end a sentence -----------
    if last in _DANGLING_WORDS:
        score += _logit(0.06) - _logit(0.5)
        reasons.append("dangling:" + last)

    # --- hesitation noise ---------------------------------------------------
    if last in _FILLERS:
        score += _logit(0.04) - _logit(0.5)
        reasons.append("trailing-filler:" + last)
    hes = hesitation_ratio(raw)
    if hes > 0.0 and last not in _FILLERS:
        # Filler earlier in the utterance is weaker evidence than filler at the
        # end, but it still means the caller is composing as they go.
        score += _logit(max(0.20, 0.5 - hes)) - _logit(0.5)
        reasons.append("hesitant:%.2f" % hes)
    if all(t in _FILLERS for t in toks):
        # "um." is never a turn. Push it as close to zero as the clamp allows.
        score = _logit(0.01)
        reasons.append("filler-only")
        return _sigmoid(score), ",".join(reasons)

    # --- reading out a code / email / number --------------------------------
    if _SPELLING_RE.search(raw):
        score += _logit(0.12) - _logit(0.5)
        reasons.append("spelling-out")

    # --- terminal punctuation from the ASR ----------------------------------
    # Nemotron and Whisper both punctuate natively, and a final '.' or '?' is a
    # real signal - but it is the MODEL's guess, so it informs and never decides.
    if raw.endswith((".", "!", "?")):
        score += _logit(0.80) - _logit(0.5)
        reasons.append("terminal-punct")
    elif raw.endswith((",", ";", ":", "-", "\u2014")):
        score += _logit(0.15) - _logit(0.5)
        reasons.append("continuation-punct")

    # --- short, complete answers --------------------------------------------
    if n <= 3 and all(t in _COMPLETE_SHORT for t in toks):
        score += _logit(0.95) - _logit(0.5)
        reasons.append("confirmation")

    # --- questions hand the floor over explicitly ---------------------------
    if toks[0] in _WH_WORDS and n >= 3:
        score += _logit(0.78) - _logit(0.5)
        reasons.append("question")

    # --- length -------------------------------------------------------------
    # A one- or two-word fragment that is NOT a known confirmation is usually
    # the start of something longer ("my- my account").
    if n <= 2 and last not in _COMPLETE_SHORT:
        score += _logit(0.30) - _logit(0.5)
        reasons.append("fragment")
    elif n >= 8:
        # Long utterances are usually complete; the ASR just did not punctuate.
        score += _logit(0.68) - _logit(0.5)
        reasons.append("long")

    return _sigmoid(score), ",".join(reasons) or "neutral"


# ---------------------------------------------------------------------------
# PROSODIC CUES
#
# This is the signal v48 did not have at all, and it is the one that lets us go
# faster WITHOUT cutting people off. A falling pitch contour plus decaying
# energy is how every English speaker signals "I'm done", and it is measurable
# from the same audio frames the VAD already computes. Because the cue arrives
# while the last word is still being said, acting on it buys back most of the
# silence timer rather than trading accuracy for speed.
# ---------------------------------------------------------------------------


@dataclass
class Prosody:
    """Cheap acoustic summary of the last ~500ms of speech.

    f0_slope:   semitones per second of pitch change over the final voiced run.
                Negative = falling = finality. Positive = rising = a question,
                or a list continuing ("eggs, milk, ...").
    energy_ratio: energy of the final 150ms divided by the utterance mean.
                Below ~0.6 = trailing off = finality.
    final_lengthening: duration of the last voiced run over the median run.
                Above ~1.3 = the speaker stretched the last syllable, which in
                English is a strong phrase-final marker.
    voiced: whether the very last frame still had voice in it.
    """
    f0_slope: float = 0.0
    energy_ratio: float = 1.0
    final_lengthening: float = 1.0
    voiced: bool = False


def prosodic_completion(p: Optional[Prosody]) -> Tuple[float, str]:
    """P(finished) from acoustics alone. Returns (p, reason).

    Returns exactly 0.5 (no information) when we have no prosody, so a caller
    without an AudioWorklet is never penalised - fusion with a 0.5 term is a
    no-op in log-odds space. That property is what makes this safe to add.
    """
    if p is None:
        return 0.5, "no-prosody"

    score = _logit(0.5)
    reasons: List[str] = []

    # Pitch. A fall of ~4 semitones over the final run is a canonical English
    # declarative boundary; a rise of the same size is a yes/no question, which
    # is ALSO a completed turn - so we treat a strong rise as finality too, and
    # only a FLAT contour as "still going", because flat is what a speaker does
    # mid-list and mid-clause.
    if p.f0_slope <= -2.0:
        score += _logit(0.82) - _logit(0.5)
        reasons.append("falling-pitch")
    elif p.f0_slope >= 3.0:
        score += _logit(0.72) - _logit(0.5)
        reasons.append("rising-question")
    elif -0.5 < p.f0_slope < 1.0:
        score += _logit(0.38) - _logit(0.5)
        reasons.append("flat-pitch")

    # Energy decay.
    if p.energy_ratio <= 0.55:
        score += _logit(0.78) - _logit(0.5)
        reasons.append("energy-decay")
    elif p.energy_ratio >= 1.15:
        # Still loud at the cut point - almost always mid-sentence.
        score += _logit(0.30) - _logit(0.5)
        reasons.append("still-loud")

    # Final lengthening.
    if p.final_lengthening >= 1.30:
        score += _logit(0.75) - _logit(0.5)
        reasons.append("final-lengthening")

    # If the final frame is STILL voiced the caller is mid-word. This one is
    # close to decisive and deliberately outweighs everything above it.
    if p.voiced:
        score += _logit(0.05) - _logit(0.5)
        reasons.append("still-voiced")

    return _sigmoid(score), ",".join(reasons) or "neutral"


# ---------------------------------------------------------------------------
# FUSION
# ---------------------------------------------------------------------------


@dataclass
class Decision:
    end_of_turn: bool
    p_complete: float          # fused probability the caller has finished
    wait_ms: float             # silence still required before committing
    required_ms: float         # total silence this turn needs
    reason: str
    backchannel: bool = False

    def to_dict(self) -> Dict:
        return {
            "end_of_turn": self.end_of_turn,
            "p": round(self.p_complete, 4),
            "wait_ms": round(self.wait_ms, 1),
            "required_ms": round(self.required_ms, 1),
            "reason": self.reason,
            "backchannel": self.backchannel,
        }


# Relative trust in each cue. Prosody is weighted slightly below lexicon
# because our prosody is computed from a cheap time-domain estimator, not from
# a real pitch tracker - so it is noisier. Both are well above zero because the
# entire point is that they are INDEPENDENT views of the same question.
W_LEXICAL = 1.0
W_PROSODIC = 0.8


def fuse(p_lex: float, p_pros: float,
         w_lex: float = W_LEXICAL, w_pros: float = W_PROSODIC) -> float:
    """Combine independent cues in log-odds space.

    Log-odds addition is the correct way to pool independent evidence (it is
    naive-Bayes), and it has the property we need most: a cue carrying no
    information (p=0.5, logit=0) contributes exactly nothing. That is what lets
    prosody be optional without biasing the result.
    """
    z = w_lex * _logit(p_lex) + w_pros * _logit(p_pros)
    return _sigmoid(z)


def required_silence_ms(p_complete: float) -> float:
    """Convert confidence into patience.

    The mapping is deliberately non-linear. Between p=0.5 and p=0.9 we want a
    steep payoff (this is the bulk of real turns, and it is where the latency
    win lives), while below p=0.35 we want to fall off a cliff into "hold the
    turn open", because those are the turns where interrupting is unforgivable.
    """
    p = min(1.0, max(0.0, float(p_complete)))
    if p < 0.35:
        # Clearly unfinished. Scale between the max and the open-turn ceiling.
        t = p / 0.35                      # 0 at p=0, 1 at p=0.35
        return OPEN_TURN_MS + t * (MAX_SILENCE_MS - OPEN_TURN_MS)
    # p in [0.35, 1]. Cubic ease-out: most of the saving is realised early.
    t = (p - 0.35) / 0.65
    eased = 1.0 - (1.0 - t) ** 3
    return MAX_SILENCE_MS + eased * (MIN_SILENCE_MS - MAX_SILENCE_MS)


class TurnDetector:
    """Stateful endpointer for one conversation.

    Usage per audio frame or per partial transcript:

        d = det.update(text=partial, silence_ms=since_last_voice,
                       prosody=pros, agent_speaking=is_playing)
        if d.end_of_turn: commit()

    It is stateful for one reason only: the hard deadline and the adaptive
    per-speaker offset both need memory across a turn.
    """

    def __init__(self,
                 min_ms: float = MIN_SILENCE_MS,
                 max_ms: float = MAX_SILENCE_MS,
                 hard_deadline_ms: float = HARD_DEADLINE_MS,
                 sensitivity: float = 1.0) -> None:
        self.min_ms = float(min_ms)
        self.max_ms = float(max_ms)
        self.hard_deadline_ms = float(hard_deadline_ms)
        # >1 = more eager to answer, <1 = more patient. Exposed so a deployment
        # can trade interruptions against latency without a code change.
        self.sensitivity = max(0.25, min(4.0, float(sensitivity)))
        self._turn_ms = 0.0
        self._committed = False
        # Adaptive: how often we have had to correct ourselves this session.
        # A caller who keeps getting cut off makes us permanently more patient.
        self._interruptions = 0

    # -- lifecycle ---------------------------------------------------------
    def begin_turn(self) -> None:
        self._turn_ms = 0.0
        self._committed = False

    def note_interruption(self) -> None:
        """Call when the caller resumed talking immediately after we committed.

        That is ground truth that we ended the turn too early, and it is free -
        no labels, no training. Three of them and we are meaningfully more
        patient for the rest of the session.
        """
        self._interruptions = min(10, self._interruptions + 1)

    @property
    def patience(self) -> float:
        """Multiplier applied to the required silence, from observed mistakes."""
        return (1.0 + 0.18 * self._interruptions) / self.sensitivity

    # -- the decision ------------------------------------------------------
    def update(self,
               text: str,
               silence_ms: float,
               prosody: Optional[Prosody] = None,
               agent_speaking: bool = False,
               elapsed_ms: Optional[float] = None) -> Decision:
        if elapsed_ms is not None:
            self._turn_ms = float(elapsed_ms)

        silence_ms = max(0.0, float(silence_ms))

        # Backchannel while we are talking: acknowledge, never take the floor.
        if agent_speaking and is_backchannel(text):
            return Decision(False, 0.0, self.max_ms, self.max_ms,
                            "backchannel-while-speaking", backchannel=True)

        p_lex, why_lex = lexical_completion(text)
        p_pro, why_pro = prosodic_completion(prosody)
        p = fuse(p_lex, p_pro)

        need = required_silence_ms(p) * self.patience
        # Respect the caller-configured floor/ceiling for ordinary turns. The
        # open-turn branch is intentionally allowed to exceed max_ms: that is
        # the whole point of it.
        if need <= MAX_SILENCE_MS:
            need = min(self.max_ms, max(self.min_ms, need))

        # Hard deadline: a stuck mic must never hold the line open.
        if self._turn_ms >= self.hard_deadline_ms:
            return Decision(True, p, 0.0, need, "hard-deadline")

        done = silence_ms >= need
        return Decision(
            end_of_turn=done,
            p_complete=p,
            wait_ms=max(0.0, need - silence_ms),
            required_ms=need,
            reason="lex[%s|%.2f] pros[%s|%.2f]" % (why_lex, p_lex, why_pro, p_pro),
        )


__all__ = [
    "Prosody", "Decision", "TurnDetector",
    "lexical_completion", "prosodic_completion", "fuse",
    "required_silence_ms", "tokenize", "strip_fillers",
    "hesitation_ratio", "is_backchannel",
    "MIN_SILENCE_MS", "MAX_SILENCE_MS", "OPEN_TURN_MS", "HARD_DEADLINE_MS",
]
