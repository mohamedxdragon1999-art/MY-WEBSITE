"""Continuous sentiment -> emotion, for the lines no cue phrase can catch.

THE PROBLEM THIS SOLVES
-----------------------
`emotion.py` picks a feeling by matching cue SUBSTRINGS ("i'm sorry",
"great news"). That is high precision and worth keeping. But it is a lookup
table, so it is silent on anything it was not told about:

    "The refund was rejected and the money is gone."   -> no cue -> NEUTRAL
    "Your data was lost and we cannot recover it."     -> no cue -> NEUTRAL

Both are delivered perfectly flatly, which is the exact moment a listener
decides they are talking to a machine. You cannot fix this by adding more
cues: the space of sad sentences is not enumerable.

So this module scores meaning CONTINUOUSLY - a valence (how good/bad) and an
arousal (how activated) - from a lexicon, with the grammar that actually
flips meaning in support conversations: negation, intensifiers, diminishers,
and contrast ("but").

THE "A BIT" REQUIREMENT
-----------------------
Mild sentiment must sound MILD, not like a performance. This module gets that
by GRADED SELECTION rather than by scaling: weak positive picks `warm`, strong
positive picks `happy`, very strong with high arousal picks `excited`. The
same downward: `serious` -> `concerned` -> `empathetic`.

That matters for a subtle reason. `emotion.Emotion.scaled(level)` already
attenuates the deviation from neutral, and `plan()` applies it to whatever
`detect()` returns. If this module ALSO returned a pre-attenuated emotion, the
two would compound and mild feelings would vanish entirely. Choosing a
gentler emotion instead composes correctly with the existing scaling.

THE "BORING STAYS NORMAL" REQUIREMENT
-------------------------------------
Flat, factual, unremarkable text must be delivered in a NORMAL voice - not a
bored one. Two deliberate guarantees:

  1. There is no "bored" emotion here, and this module can never invent one.
  2. Text whose evidence is below the confidence floor returns exactly
     ("neutral", 0.0) - the untouched voice.

A bored delivery would be an ACTIVE choice (slower, lower, quieter). Neutral
is the absence of one. Those are different sounds and the difference is the
requirement.

DETERMINISM
-----------
Pure function of the text. No clock, no randomness, no I/O. The same sentence
always scores the same, which is required because a failed beat gets
re-synthesised on its own and has to match the beats around it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Tuple

# ---------------------------------------------------------------------------
# Lexicon: word -> (valence -1..+1, arousal 0..1)
# ---------------------------------------------------------------------------
# Chosen for CUSTOMER SUPPORT, not general prose. "declined", "charged",
# "refund", "outage" carry far more weight here than in a film review, and a
# generic sentiment list would score them near zero.
_LEX: Dict[str, Tuple[float, float]] = {}


def _add(words: str, valence: float, arousal: float) -> None:
    for w in words.split():
        _LEX[w] = (valence, arousal)


# --- strong negative -------------------------------------------------------
_add("""terrible awful horrible dreadful appalling unacceptable disgraceful
        outrageous furious livid disaster catastrophic devastating""", -0.85, 0.85)
_add("""lost stolen fraud fraudulent hacked breached compromised unauthorised
        unauthorized scam""", -0.80, 0.75)
_add("""failed failure broken crash crashed down outage unusable
        corrupted destroyed""", -0.70, 0.65)
_add("""cancelled canceled terminated suspended revoked banned blocked denied
        rejected declined refused""", -0.65, 0.55)

# --- moderate negative -----------------------------------------------------
_add("""angry upset frustrated frustrating annoyed annoying irritating
        disappointed disappointing unhappy dissatisfied""", -0.60, 0.60)
_add("""sad sorry regret unfortunate unfortunately afraid worried worrying
        concerned concerning anxious distressed""", -0.55, 0.35)
_add("""problem problems issue issues error errors fault bug glitch defect
        complaint trouble""", -0.45, 0.45)
_add("""delay delayed late overdue missing stuck pending unresolved
        incomplete""", -0.40, 0.35)
_add("""wrong incorrect invalid mistake mistaken oversight""", -0.40, 0.40)
_add("""expired expiring insufficient unavailable""", -0.35, 0.30)
_add("""difficult hard confusing complicated struggling painful""", -0.35, 0.35)
_add("""charged charge fee fees penalty overcharged""", -0.25, 0.30)

# --- strong positive -------------------------------------------------------
_add("""amazing fantastic wonderful excellent brilliant outstanding superb
        incredible awesome perfect delighted thrilled""", 0.85, 0.80)
_add("""congratulations congrats celebrate""", 0.80, 0.85)

# --- moderate positive -----------------------------------------------------
_add("""great good happy glad pleased love lovely nice better best
        beautiful""", 0.60, 0.50)
_add("""success successful succeeded approved accepted confirmed completed
        complete done resolved fixed solved restored refunded""", 0.55, 0.45)
_add("""thanks thank thankful grateful appreciate appreciated welcome
        pleasure""", 0.50, 0.35)
_add("""ready available active enabled working works upgraded improved
        secure safe protected covered""", 0.40, 0.30)
_add("""help helpful helping support supported easy simple quick fast""", 0.35, 0.30)
_add("""sure certainly absolutely definitely course""", 0.30, 0.35)

# --- everyday words the support-specific list above skipped ----------------
# Found by EXECUTING the scorer, not by reading it: "that is not bad actually"
# scored exactly zero, because "bad" - the most common negative word in
# English - was missing while "unauthorised" was present. A lexicon written
# from a domain outwards always has this hole in the middle.
_add("""bad poor worse worst lousy rubbish useless pointless nonsense
        ridiculous unhelpful rude unfair waste wasted""", -0.55, 0.45)
_add("""hate hates hated dislike disliked despise""", -0.70, 0.60)
_add("""slow sluggish clunky expensive costly overpriced""", -0.30, 0.30)
_add("""enjoy enjoyed enjoying satisfied satisfying smooth seamless reliable
        recommend recommended impressive impressed""", 0.55, 0.40)
_add("""fine okay ok alright acceptable adequate""", 0.15, 0.15)

# Verb stems the -ed forms above missed. "we cannot fix this" scored zero
# because only "fixed" was listed - the negation had nothing to act on.
# "refund" is deliberately NOT here. As a bare noun it is neutral - "the
# refund was rejected" is bad news - and listing it as positive made exactly
# that sentence average out to nothing. "refunded" above stays positive.
_add("""fix repair resolve solve restore recover correct
        upgrade improve""", 0.45, 0.35)
_add("""fail break lose lost gone missing crash cancel reject decline deny
        suspend""", -0.60, 0.55)

# --- calm / low arousal ----------------------------------------------------
_add("""calm relax relaxed patient patiently gentle quiet steady stable""", 0.20, 0.10)

# ---------------------------------------------------------------------------
# Grammar that changes the meaning of the words above
# ---------------------------------------------------------------------------
# Negation flips valence. "not good" is not neutral, it is bad - and notably
# it is MILDER than "bad", which is why the flip is damped rather than exact.
_NEGATORS = frozenset("""
    not no never none cannot cant can't won't wont don't dont doesn't doesnt
    didn't didnt isn't isnt aren't arent wasn't wasnt weren't werent
    haven't havent hasn't hasnt hadn't hadnt shouldn't shouldnt
    wouldn't wouldnt couldn't couldnt without nor neither
""".split())
_NEG_WINDOW = 3          # how many following words a negator reaches
_NEG_DAMP = 0.75         # "not good" is weaker than "bad"

_INTENSIFIERS: Dict[str, float] = {
    "very": 1.45, "really": 1.40, "extremely": 1.75, "incredibly": 1.70,
    "absolutely": 1.60, "completely": 1.55, "totally": 1.50, "utterly": 1.65,
    "deeply": 1.50, "terribly": 1.55, "seriously": 1.40, "truly": 1.40,
    "so": 1.30, "such": 1.25, "quite": 1.15, "particularly": 1.30,
    "especially": 1.30, "highly": 1.35, "massively": 1.60, "hugely": 1.55,
}
_DIMINISHERS: Dict[str, float] = {
    "slightly": 0.55, "somewhat": 0.60, "bit": 0.60, "little": 0.65,
    "mildly": 0.55, "fairly": 0.75, "rather": 0.80, "kind": 0.70,
    "sort": 0.70, "marginally": 0.50, "barely": 0.45, "hardly": 0.45,
    "minor": 0.55, "slight": 0.55,
}
_MOD_WINDOW = 2          # how far a modifier reaches forward

# "I know it was late, BUT it is fixed now" - people put the point they mean
# after the contrast. Weighting both sides equally averages the sentence to
# nothing, which is precisely the flat delivery we are trying to remove.
_CONTRAST = frozenset("but however although though nevertheless nonetheless yet".split())
_PRE_CONTRAST_WEIGHT = 0.45

# "The issue is resolved." - averaging "issue" (-0.45) against "resolved"
# (+0.55) lands near zero, so the single most common GOOD sentence in support
# came out flat. That is backwards: naming the problem you just fixed is not
# half-bad news, it is good news. When a resolution word follows a problem
# word, the problem is being REPORTED, not suffered, so its weight collapses.
_RESOLVERS = frozenset("""
    resolved resolve fixed fix solved solve corrected correct restored restore
    recovered recover refunded refund sorted completed complete cleared
    approved reversed reinstated reactivated working works done
""".split())
_RESOLVE_WINDOW = 8      # how far ahead a resolution reaches back over a problem
_RESOLVED_DAMP = 0.20    # what is left of the problem once it is fixed

# The exact mirror of the rule above, and just as necessary. "The refund was
# rejected" must not average a hoped-for good thing against the refusal and
# land on neutral - the refusal is the news. A good thing that is immediately
# refused is not half-good.
_CANCELLERS = frozenset("""
    rejected reject declined decline denied deny refused refuse failed fail
    cancelled canceled cancel blocked revoked suspended expired unavailable
""".split())
_CANCEL_WINDOW = 4
_CANCELLED_DAMP = 0.15

_WORD_RE = re.compile(r"[a-z']+")


@dataclass(frozen=True)
class Reading:
    """What the text feels like, before it is turned into a voice."""
    valence: float      # -1 (bad) .. +1 (good)
    arousal: float      #  0 (flat) .. 1 (activated)
    confidence: float   #  0 .. 1, how much evidence there was
    hits: int           # how many lexicon words matched

    def to_dict(self) -> Dict[str, float]:
        return {
            "valence": round(self.valence, 4),
            "arousal": round(self.arousal, 4),
            "confidence": round(self.confidence, 4),
            "hits": self.hits,
        }


NEUTRAL_READING = Reading(0.0, 0.0, 0.0, 0)


def tokenize(text: str) -> List[str]:
    return _WORD_RE.findall((text or "").lower())


def read(text: str) -> Reading:
    """Score a piece of text. Pure function, no state."""
    raw = text or ""
    words = tokenize(raw)
    if not words:
        return NEUTRAL_READING

    # Everything after the last contrast marker is what the speaker means.
    pivot = -1
    for i, w in enumerate(words):
        if w in _CONTRAST:
            pivot = i

    total_v = 0.0
    total_a = 0.0
    weight_sum = 0.0
    hits = 0

    for i, w in enumerate(words):
        entry = _LEX.get(w)
        if entry is None:
            continue
        v, a = entry
        hits += 1

        # --- modifiers immediately before the word ---
        mult = 1.0
        for back in range(1, _MOD_WINDOW + 1):
            j = i - back
            if j < 0:
                break
            prev = words[j]
            if prev in _INTENSIFIERS:
                mult *= _INTENSIFIERS[prev]
                break
            if prev in _DIMINISHERS:
                mult *= _DIMINISHERS[prev]
                break

        # --- negation somewhere in the preceding window ---
        negated = False
        for back in range(1, _NEG_WINDOW + 1):
            j = i - back
            if j < 0:
                break
            if words[j] in _NEGATORS:
                negated = True
                break
        if negated:
            v = -v * _NEG_DAMP
            # Negating something rarely raises energy the way asserting it does.
            a *= 0.85

        v *= mult
        a *= min(1.0, mult)

        # A good thing that is refused right afterwards barely counts.
        if v > 0:
            for fwd in range(1, _CANCEL_WINDOW + 1):
                k = i + fwd
                if k >= len(words):
                    break
                if words[k] in _CANCELLERS:
                    neg_can = any(
                        words[m] in _NEGATORS
                        for m in range(max(0, k - _NEG_WINDOW), k)
                    )
                    if not neg_can:
                        v *= _CANCELLED_DAMP
                    break

        # A problem that is resolved later in the sentence barely counts.
        if v < 0:
            for fwd in range(1, _RESOLVE_WINDOW + 1):
                k = i + fwd
                if k >= len(words):
                    break
                if words[k] in _RESOLVERS:
                    # Only if the resolution is not itself negated:
                    # "the issue is not resolved" must stay negative.
                    neg_res = any(
                        words[m] in _NEGATORS
                        for m in range(max(0, k - _NEG_WINDOW), k)
                    )
                    if not neg_res:
                        v *= _RESOLVED_DAMP
                        a *= 0.7
                    break

        # Contrast weighting: the clause before "but" counts for less.
        w_i = _PRE_CONTRAST_WEIGHT if (pivot >= 0 and i < pivot) else 1.0

        total_v += v * w_i
        total_a += a * w_i
        weight_sum += w_i

    if hits == 0 or weight_sum <= 0:
        # No lexical evidence. Punctuation alone is not enough to claim a
        # feeling - "Your order number is 5512!" is not joy - so we only let
        # it raise AROUSAL, never invent a valence.
        return NEUTRAL_READING

    valence = total_v / weight_sum
    arousal = total_a / weight_sum

    # --- punctuation and shouting modulate arousal only ---
    excl = raw.count("!")
    if excl:
        arousal = min(1.0, arousal + 0.12 * min(excl, 3))
    letters = [c for c in raw if c.isalpha()]
    if len(letters) >= 8:
        caps = sum(1 for c in letters if c.isupper()) / float(len(letters))
        if caps > 0.6:
            arousal = min(1.0, arousal + 0.20)

    # --- confidence: more evidence, and denser evidence, means more certainty --
    # A single matched word in a forty word paragraph is weak evidence; two or
    # three in a short sentence is strong. Both terms are capped so one
    # repeated word cannot manufacture certainty.
    density = hits / float(len(words))
    conf = min(1.0, 0.45 * min(hits, 3) + 1.6 * min(density, 0.35))
    conf = min(1.0, conf * min(1.0, 0.35 + abs(valence) * 1.9))

    return Reading(
        valence=max(-1.0, min(1.0, valence)),
        arousal=max(0.0, min(1.0, arousal)),
        confidence=max(0.0, min(1.0, conf)),
        hits=hits,
    )


# ---------------------------------------------------------------------------
# Reading -> emotion name
# ---------------------------------------------------------------------------
# The bands are deliberately asymmetric. Mis-reading a routine line as CHEERFUL
# is a small embarrassment; mis-reading a customer's bad news as cheerful is a
# disaster. So negative feelings are allowed to engage on weaker evidence than
# positive ones, which is also what a competent support agent does.
CONF_FLOOR = 0.30        # below this the text is simply not emotional enough
POS_MILD = 0.18
POS_CLEAR = 0.42
POS_STRONG = 0.62
NEG_MILD = -0.15
NEG_CLEAR = -0.32
NEG_STRONG = -0.55
HIGH_AROUSAL = 0.62


def emotion_name(text: str) -> str:
    """The emotion this text calls for, or "neutral".

    Returns a key of `emotion.EMOTIONS`. Never returns a "bored" style, and
    returns plain "neutral" whenever the evidence is thin - unremarkable text
    gets the normal voice, not a downbeat one.
    """
    return name_for(read(text))


def name_for(r: Reading) -> str:
    if r.confidence < CONF_FLOOR:
        return "neutral"
    v, a = r.valence, r.arousal

    if v >= POS_STRONG and a >= HIGH_AROUSAL:
        return "excited"
    if v >= POS_CLEAR:
        return "happy"
    if v >= POS_MILD:
        return "warm"            # "a bit happy"

    if v <= NEG_STRONG:
        return "empathetic"      # real bad news: slow down, soften
    if v <= NEG_CLEAR:
        return "concerned"
    if v <= NEG_MILD:
        return "serious"         # "a bit sad": lower and level, not theatrical

    return "neutral"


def describe(text: str) -> str:
    """Debug helper: what was read and what it became."""
    r = read(text)
    return "%s v=%.2f a=%.2f c=%.2f hits=%d" % (
        name_for(r), r.valence, r.arousal, r.confidence, r.hits,
    )
