"""Real emotion for every voice mode.

THE PROBLEM THIS SOLVES
-----------------------
Asking a TTS model to "be emotional" by writing "[sigh]" or "*sighs*" into the
text does not produce emotion. On most engines it produces the WORD "sigh",
which is worse than being flat. Only Fish and Chatterbox understand performance
tags at all, and even they do not understand "*sighs deeply*".

Emotion in speech is not vocabulary. It is ACOUSTICS:

  happy      faster, higher pitch, louder, wider pitch range
  empathetic slower, slightly lower, softer
  excited    much faster, much higher, loud
  calm       slower, flat-ish, soft
  thinking   slower with a real pause before the answer
  serious    slower, lower, level

So this module reads the MEANING of what the agent is about to say, decides how
a person would say it, and returns concrete numbers (rate, pitch, volume) that
every engine can actually apply. Nothing here is a placeholder: the values are
passed into the real synthesis parameters of each engine.

WHY PER SENTENCE
----------------
A single rate/pitch for a whole reply is exactly what makes TTS sound robotic:
real people do not deliver every sentence identically. We therefore emit a
plan per sentence, with small deterministic variation so a long answer rises
and falls instead of droning. The variation is seeded by the sentence text, so
the same reply always sounds the same (no random jitter between retries).
"""
from __future__ import annotations

import hashlib
import os
import re
import time
from dataclasses import dataclass
from typing import Dict, List, Tuple

from . import sentiment, speakable

# ---------------------------------------------------------------------------
# Emotion definitions: (rate_mult, pitch_semitones, volume_mult, style)
# ---------------------------------------------------------------------------
# rate_mult   1.0 = the user's chosen speed. 1.08 = 8% faster.
# pitch_st    semitones offset. Kept small; big jumps sound like a cartoon.
# volume_mult 1.0 = unchanged.
# style       Azure/Edge express-as style name, used when the engine supports it.
@dataclass(frozen=True)
class Emotion:
    name: str
    rate: float
    pitch: float
    volume: float
    style: str
    tag: str = ""        # performance tag, ONLY for tag-aware engines

    def scaled(self, level: float) -> "Emotion":
        """Scale the deviation from neutral by expressiveness (0..1).

        level 0 collapses to neutral, so a user who wants a flat corporate
        voice can have one; level 1 gives the full performance.
        """
        lv = max(0.0, min(1.0, level))
        return Emotion(
            name=self.name,
            rate=1.0 + (self.rate - 1.0) * lv,
            pitch=self.pitch * lv,
            volume=1.0 + (self.volume - 1.0) * lv,
            style=self.style,
            tag=self.tag if lv >= 0.35 else "",
        )


NEUTRAL = Emotion("neutral", 1.00, 0.0, 1.00, "chat")

EMOTIONS: Dict[str, Emotion] = {
    "neutral":    NEUTRAL,
    "warm":       Emotion("warm",       1.02,  0.5, 1.02, "friendly"),
    "happy":      Emotion("happy",      1.07,  1.4, 1.05, "cheerful", "chuckle"),
    "excited":    Emotion("excited",    1.12,  2.2, 1.08, "excited"),
    "empathetic": Emotion("empathetic", 0.93, -1.0, 0.97, "empathetic", "sigh"),
    "apologetic": Emotion("apologetic", 0.91, -1.2, 0.95, "empathetic", "sigh"),
    "calm":       Emotion("calm",       0.96, -0.4, 0.97, "gentle"),
    "thinking":   Emotion("thinking",   0.94, -0.3, 0.98, "chat", "breath"),
    "serious":    Emotion("serious",    0.95, -0.8, 1.00, "serious"),
    "curious":    Emotion("curious",    1.03,  1.0, 1.01, "chat"),
    "reassuring": Emotion("reassuring", 0.97, -0.2, 1.01, "friendly"),
    # --- v6.2 additions: the shades a real support agent actually uses ---
    "concerned":  Emotion("concerned",  0.94, -0.7, 0.98, "empathetic"),
    "encouraging": Emotion("encouraging", 1.04, 0.9, 1.03, "friendly"),
    "confident":  Emotion("confident",  1.00, -0.3, 1.03, "serious"),
    "polite":     Emotion("polite",     0.99,  0.3, 1.00, "friendly"),
    "amused":     Emotion("amused",     1.05,  1.1, 1.02, "cheerful", "chuckle"),
    # --- v0.0.32 additions: the reactions a support call actually needs ---
    # "surprised" is the one people notice is missing. When a caller says
    # something unexpected, a flat "I see" is the most robotic moment in a call.
    "surprised":  Emotion("surprised",  1.06,  2.0, 1.04, "excited", "gasp"),
    "grateful":   Emotion("grateful",   1.00,  0.7, 1.02, "friendly"),
    "patient":    Emotion("patient",    0.92, -0.5, 0.98, "gentle", "breath"),
}

# ---------------------------------------------------------------------------
# Cue words. Ordered: the FIRST match wins, most specific first.
# ---------------------------------------------------------------------------
_CUES: List[Tuple[str, Tuple[str, ...]]] = [
    ("apologetic", ("i'm sorry", "i am sorry", "we're sorry", "we are sorry",
                    "so sorry", "sorry about", "sorry for", "i do apologise",
                    "apolog", "unfortunately", "i regret", "we regret",
                    "i'm afraid", "i am afraid", "my mistake", "that's on us",
                    "our mistake", "our fault", "shouldn't have happened",
                    "i can't", "i cannot", "we can't", "not able to",
                    "there's no record", "has been declined", "went wrong")),
    ("empathetic", ("i understand", "i hear you", "that must be", "frustrat",
                    "sorry to hear", "i know how", "that sounds", "upsetting",
                    "difficult", "stressful", "annoying", "worried")),
    ("excited",    ("congratulations", "amazing", "fantastic", "brilliant",
                    "that's incredible", "can't wait", "so exciting", "woohoo")),
    ("happy",      ("great news", "good news", "all set", "you're all set",
                    "perfect", "wonderful", "happy to", "glad to", "love that",
                    "nice one", "awesome", "sorted", "done and dusted",
                    "confirmed", "approved", "success")),
    ("thinking",   ("let me check", "let me look", "one moment", "one sec",
                    "give me a second", "bear with me", "let me see",
                    "i'll pull that up", "checking", "hold on", "let me find")),
    ("serious",    ("important", "please note", "be aware", "security",
                    "fraud", "urgent", "immediately", "do not share",
                    "cannot be undone", "permanent", "final", "legal",
                    "terms", "policy requires")),
    ("reassuring", ("don't worry", "do not worry", "no problem", "no worries",
                    "i'll take care", "i can help", "we'll sort", "we'll fix",
                    "you're covered", "it's safe", "rest assured",
                    "i've got you", "leave it with me")),
    ("curious",    ("could you tell me", "can you tell me", "what's the",
                    "which one", "may i ask", "just to confirm",
                    "can i get", "would you like", "did you mean")),
    ("concerned",  ("i'm seeing", "there may be", "looks like there",
                    "flagged", "overdue", "expired", "failed", "declined",
                    "we noticed", "a problem with", "an issue with")),
    ("encouraging",("you're almost", "almost there", "nearly done",
                    "just one more", "last step", "you got it", "that's it",
                    "exactly right", "well done", "good catch")),
    ("confident",  ("i can confirm", "definitely", "absolutely certain",
                    "guarantee", "i've verified", "it's confirmed",
                    "you can count on", "without a doubt")),
    ("amused",     ("haha", "that's funny", "good one", "i love that",
                    "fair enough", "you're not wrong")),
    ("polite",     ("would you mind", "if you don't mind", "whenever you're",
                    "at your convenience", "please could", "my pleasure",
                    "apologies for the")),
    ("surprised",  ("oh wow", "really?", "that's surprising", "i had no idea",
                    "that's unusual", "oh!", "wait, really", "huh",
                    "that's odd", "never seen that")),
    ("grateful",   ("thanks so much", "thank you so much", "i appreciate",
                    "appreciate you", "that's very kind", "you've been",
                    "thanks for waiting", "thanks for your patience",
                    "thank you for holding")),
    ("patient",    ("take your time", "no rush", "whenever you're ready",
                    "in your own time", "i'll wait", "no hurry",
                    "take as long as")),
    ("warm",       ("thanks", "thank you", "welcome", "hi there", "hello",
                    "good morning", "good afternoon", "good evening",
                    "pleasure", "of course", "absolutely", "sure thing")),
]

_SENT_SPLIT = re.compile(r"(?<=[.!?\u2026])\s+")

# ---------------------------------------------------------------------------
# v0.0.35 - THE ADVERB BLIND SPOT. Found by EXECUTING the planner, not reading.
# ---------------------------------------------------------------------------
# Every cue above is a rigid literal substring, so the single most common
# apology in customer service was scored as NEUTRAL:
#
#   detect("I am really sorry about that delay.")  ->  neutral
#
# "i am sorry" is in the table, but the caller-facing sentence has an adverb
# wedged between "am" and "sorry", and a literal substring cannot see through
# it. The same hole swallowed "I'm very sorry", "we are truly sorry", "I can't
# really help with that" and so on - the MORE emotive the wording, the more
# likely it was to be missed, because emphasis is exactly where people insert
# adverbs. Those lines were then rendered flat.
#
# This matters in EVERY mode, not just one: all engines reach detect() through
# emotion_params()/overall(), so a miss here removes rate, pitch, volume,
# contour, pauses and tags from that sentence everywhere at once.
#
# Fix: allow optional intensifiers between the words of a multi-word cue.
# Deliberately NOT a wildcard - `(?:\s+\w+)*` would make "i can't" match "I
# can't wait to help", which is the exact bug fixed in v7.3. Only this closed
# list of adverbs may appear in the gap, so specificity is preserved.
_INTENSIFIERS = (
    "really", "very", "so", "truly", "extremely", "terribly", "genuinely",
    "sincerely", "deeply", "awfully", "super", "quite", "honestly",
    "absolutely", "incredibly", "particularly", "especially", "just",
)
_INT_GAP = r"(?:\s+(?:%s))*\s+" % "|".join(_INTENSIFIERS)
_FLEX_CACHE = {}


def _flex(cue: str):
    """Compiled matcher for one multi-word cue, tolerant of intensifiers.

    Cached because detect() runs on every sentence of every reply and the
    pattern for a given cue never changes.
    """
    pat = _FLEX_CACHE.get(cue)
    if pat is None:
        pat = re.compile(_INT_GAP.join(re.escape(p) for p in cue.split()))
        _FLEX_CACHE[cue] = pat
    return pat


def _env_float(name: str, default: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float((os.environ.get(name) or "").strip() or default)))
    except ValueError:
        return default


def enabled() -> bool:
    return (os.environ.get("VOICE_EMOTION", "1") or "").strip().lower() \
        not in ("0", "false", "no", "off")


def intensity() -> float:
    """How strongly emotion is applied. 0 = flat, 1 = full performance."""
    return _env_float("VOICE_EMOTION_INTENSITY", 0.75, 0.0, 1.0)


# v0.0.45 - SPEED.
# detect() scans 17 cue groups, and multi-word cues that miss literally get a
# second pass through an intensifier-tolerant regex. That is fine once, but the
# same sentences recur constantly in a real deployment (greetings, confirmations,
# read-backs, apologies) and every beat of every reply pays the full scan. The
# result is a pure function of the normalised text, so it is safe to memoise.
_DETECT_CACHE: Dict[str, "Emotion"] = {}
_DETECT_CACHE_MAX = 512


def detect(text: str) -> Emotion:
    """Pick the emotion a person would use for this line (memoised)."""
    low = (text or "").strip().lower()
    if not low:
        return NEUTRAL
    hit = _DETECT_CACHE.get(low)
    if hit is not None:
        return hit
    emo = _detect_scan(low)
    # A plain clear beats an LRU here: this is a bounded hot-path cache, not a
    # store of anything precious, and clearing costs one allocation.
    if len(_DETECT_CACHE) >= _DETECT_CACHE_MAX:
        _DETECT_CACHE.clear()
    _DETECT_CACHE[low] = emo
    return emo


def _detect_scan(low: str) -> Emotion:
    """The real cue scan. Takes ALREADY normalised text."""
    if not low:
        return NEUTRAL
    # v7.3 - THE "SPOKEN WITH THE WRONG FEELING" BUG.
    # This used to return on the FIRST cue that matched in _CUES order, and
    # "apologetic" is first in that list. So "I can't wait to help!" matched the
    # apologetic cue "i can't" and was spoken sadly, even though "can't wait" is
    # an excited cue sitting further down. Any short cue shadowed every longer,
    # more specific one below it.
    #
    # Now we score by SPECIFICITY: the emotion whose longest matching cue is
    # longest wins, because a longer phrase match is stronger evidence than a
    # short substring. "can't wait" (10 chars) beats "i can't" (7). Ties break on
    # how many distinct cues matched, then on _CUES order so previous behaviour
    # is preserved wherever there is genuinely no better signal.
    best_name = ""
    best_len = 0
    best_hits = 0
    for name, cues in _CUES:
        longest = 0
        hits = 0
        for cue in cues:
            # Literal match first: it is the common case and the cheapest.
            # v0.0.35 - a multi-word cue that did not match literally gets a
            # second chance through an intensifier-tolerant pattern, so
            # "I am really sorry" now scores as "i am sorry". Scoring still uses
            # the CUE length, not the matched span, so an adverb cannot inflate
            # a cue's specificity and steal the win from a longer phrase.
            if cue in low or (" " in cue and _flex(cue).search(low)):
                hits += 1
                if len(cue) > longest:
                    longest = len(cue)
        if not hits:
            continue
        if longest > best_len or (longest == best_len and hits > best_hits):
            best_name, best_len, best_hits = name, longest, hits
    if best_name:
        return EMOTIONS[best_name]

    # v0.0.50 - THE SENTENCES NO CUE LIST CAN EVER COVER.
    # Everything above is a lookup table, so it is silent on anything it was
    # not explicitly told about: "the refund was rejected and the money is
    # gone" matched nothing and was delivered perfectly flatly. You cannot fix
    # that by adding cues, because the set of sad sentences is not
    # enumerable. So we fall through to a continuous valence/arousal read.
    #
    # It runs AFTER the cues on purpose: the cues are hand-tuned and high
    # precision, and a statistical read should not be allowed to overrule
    # "i'm sorry". It runs BEFORE the punctuation guess below because "!" is
    # very weak evidence of happiness - "this failed again!" is not cheerful.
    #
    # Note `low` is already lower-cased here, so the shouting heuristic inside
    # read() cannot fire. That is acceptable: it only affects arousal, and
    # this path is deliberately conservative.
    try:
        s_name = sentiment.emotion_name(low)
    except Exception:
        s_name = "neutral"
    if s_name != "neutral":
        return EMOTIONS[s_name]

    # Fall back on punctuation, which carries real intent.
    if low.endswith("?"):
        return EMOTIONS["curious"]
    if "!" in low:
        return EMOTIONS["happy"]
    return NEUTRAL


def _jitter(sentence: str, index: int) -> Tuple[float, float]:
    """Small deterministic per-sentence variation, so a long reply breathes.

    Monotone delivery is the single biggest robot tell. Real speakers vary a
    few percent sentence to sentence. Seeded by the text so it is reproducible.
    """
    h = hashlib.sha1((str(index) + "|" + sentence[:60]).encode("utf-8")).digest()
    rate = 1.0 + ((h[0] / 255.0) - 0.5) * 0.06     # +/- 3%
    pitch = ((h[1] / 255.0) - 0.5) * 0.7           # +/- 0.35 semitone
    return rate, pitch


def split_sentences(text: str) -> List[str]:
    # v0.0.32b - A PERIOD INSIDE A WORD IS NOT THE END OF A SENTENCE.
    # "Dr. Smith approved approx. 20% off" used to become FIVE beats:
    #   ['Dr.', 'Smith approved approx.', '20% off...']
    # Each fragment then got its own falling intonation, its own 240ms pause and
    # its own emotion reading, and audio was flushed mid-sentence. It sounded
    # like the voice was malfunctioning, and no emotion tuning could ever have
    # fixed it, because the sentence was torn apart before any performance was
    # applied to it.
    parts = speakable.split_keeping_abbreviations(text, _SENT_SPLIT)
    return parts or ([text.strip()] if (text or "").strip() else [])


@dataclass
class Beat:
    """One sentence plus exactly how to perform it."""
    text: str
    emotion: Emotion
    rate: float          # final multiplier on the user's rate
    pitch: float         # final semitone offset
    volume: float
    pause_after_ms: int  # real silence, instead of the word "pause"
    # --- v6.2 prosody detail -------------------------------------------------
    # F0 (pitch) is the dominant prosodic parameter in the research literature:
    # 95 of 100 reviewed synthesis studies model it. A flat terminal contour is
    # a dead giveaway that a machine is talking, because every real utterance
    # ends by rising (question / list continues) or falling (statement done).
    contour: str = "fall"          # "rise" | "fall" | "level"
    emphasis: Tuple[str, ...] = () # content words a human would lean on
    clause_gaps: Tuple[int, ...] = ()  # micro-pauses at commas, in ms


def _pause_for(sentence: str, emo: Emotion, is_last: bool) -> int:
    """Human pause length after a sentence.

    Thinking lines get a genuinely long gap - that gap is what "[pause]" was
    trying and failing to express.
    """
    if is_last:
        return 0
    if emo.name == "thinking":
        return 520
    if sentence.endswith("?"):
        return 330
    if sentence.endswith("!"):
        return 260
    if emo.name in ("apologetic", "empathetic", "serious"):
        return 380
    return 240


# ---------------------------------------------------------------------------
# Terminal contour, emphasis and clause timing (v6.2)
# ---------------------------------------------------------------------------
# Words that carry no meaning on their own. A speaker never leans on these,
# so they are excluded from emphasis. Everything else is a candidate.
_FUNCTION_WORDS = frozenset("""
a an the and or but so if then than that this these those of to in on at by for
with from as is am are was were be been being do does did have has had will
would can could shall should may might must i you he she it we they me him her
us them my your his its our their there here what which who whom whose when
where why how not no nor too very just about into over under again once
""".split())

# A speaker leans hardest on these: they change the meaning of the sentence.
_ALWAYS_EMPHASIS = frozenset("""
not never no cannot can't won't don't doesn't isn't didn't must always every
only free now today tomorrow immediately urgent important confirmed approved
declined failed expired refund cancelled guaranteed
""".split())

_WORD_RE = re.compile(r"[A-Za-z'\u2019]+|\d[\d,.:/-]*")
_CLAUSE_RE = re.compile(r"[,;:\u2014]")


def contour_for(sentence: str) -> str:
    """How the pitch should move at the END of the sentence.

    This is the cheapest big win in the whole module. Statements fall,
    questions rise, and a sentence that is only a fragment stays level because
    the thought is still going. Getting the terminal contour wrong is what
    makes a synthetic voice sound like it is reading a list of unrelated items.
    """
    s = (sentence or "").strip()
    if not s:
        return "level"
    if s.endswith("?"):
        # Yes/no questions rise. Wh- questions actually FALL in natural English
        # ("where do you live?" drops at the end) - a detail most TTS misses.
        words = _WORD_RE.findall(s.lower())
        head = words[0] if words else ""
        if head in ("what", "where", "when", "why", "who", "whom", "whose", "how", "which"):
            return "fall"
        return "rise"
    if s.endswith((",", ";", ":", "\u2014", "-")):
        return "level"        # the thought continues
    if s.endswith("\u2026") or s.endswith("..."):
        return "level"        # trailing off
    return "fall"


def emphasis_words(sentence: str, limit: int = 3) -> Tuple[str, ...]:
    """Content words a human would stress.

    Research on explicit emphasis control shows word-level prominence is what
    listeners use to recover meaning; a voice that stresses nothing sounds
    bored, and one that stresses everything sounds unhinged. So we cap it.
    """
    words = _WORD_RE.findall((sentence or "").lower())
    picked: List[str] = []
    for w in words:
        if w in _ALWAYS_EMPHASIS and w not in picked:
            picked.append(w)
    for w in words:
        if len(picked) >= limit:
            break
        if w in _FUNCTION_WORDS or len(w) <= 3 or w in picked:
            continue
        # Numbers and long content words carry the information load.
        if w[0].isdigit() or len(w) >= 5:
            picked.append(w)
    return tuple(picked[:limit])


def clause_gaps_for(sentence: str, emo: Emotion) -> Tuple[int, ...]:
    """Micro-pauses at commas, in ms, one per clause break.

    Real speech breathes inside a sentence, not only between sentences. These
    are short (a comma is not a full stop) and stretch when the emotion is
    heavy, because people slow down when delivering bad news.
    """
    breaks = len(_CLAUSE_RE.findall(sentence or ""))
    if breaks <= 0:
        return ()
    base = 90
    if emo.name in ("apologetic", "empathetic", "serious", "concerned", "thinking"):
        base = 150
    elif emo.name in ("excited", "happy", "amused"):
        base = 70
    return tuple([base] * min(breaks, 6))


def _smooth(beats: List[Beat]) -> List[Beat]:
    """Stop emotional whiplash between neighbouring sentences.

    Jumping straight from "apologetic" to "excited" in consecutive sentences
    sounds unhinged, because real people transition through their range rather
    than snapping between presets. We pull each beat a little toward the one
    before it. We also apply FINAL LENGTHENING - every language slows down on
    the last sentence of a turn, and its absence is a strong robot cue.
    """
    if not beats:
        return beats
    out: List[Beat] = []
    for i, b in enumerate(beats):
        rate, pitch, vol = b.rate, b.pitch, b.volume
        if i > 0:
            prev = out[-1]
            # 25% carry-over: audible continuity without erasing the emotion.
            rate = round(rate * 0.75 + prev.rate * 0.25, 4)
            pitch = round(pitch * 0.75 + prev.pitch * 0.25, 3)
            vol = round(vol * 0.75 + prev.volume * 0.25, 4)
        if i == len(beats) - 1 and len(beats) > 1:
            rate = round(rate * 0.97, 4)      # final lengthening
        out.append(Beat(
            text=b.text, emotion=b.emotion, rate=rate, pitch=pitch, volume=vol,
            pause_after_ms=b.pause_after_ms, contour=b.contour,
            emphasis=b.emphasis, clause_gaps=b.clause_gaps,
        ))
    return out


# ---------------------------------------------------------------------------
# CROSS-TURN MOOD (v0.0.45)
#
# Until now every reply was planned from a standing start, so the agent's tone
# reset to neutral the instant it stopped speaking. A person does not do that.
# If they have just apologised, the next sentence still carries some of it; if
# they were delighted, warmth bleeds into what follows. Planning each reply in
# isolation is a large part of why the emotion never felt like a PERSON - each
# reply was expressive on its own and yet the conversation was emotionally flat.
#
# So we remember the emotion the last reply ended on and let it bleed into the
# opening of the next one, decaying with real time: a reply half a minute later
# is a fresh start, a reply two seconds later is a continuation.
# ---------------------------------------------------------------------------
# DETERMINISM (this module's core promise, and my first attempt broke it).
# The same reply must always plan to the same numbers, because a failed beat is
# re-synthesised on its own and has to match the beats around it. So:
#   * the carry AMOUNT is fixed while a mood is fresh - it is not a continuous
#     function of elapsed time, or a retry two seconds later would differ;
#   * re-planning the SAME reply reuses the mood that was in effect the first
#     time, instead of compounding the mood that reply itself produced.
_MOOD_NAME = ""
_MOOD_AT = 0.0
_MOOD_KEY = ""              # the reply that produced the current mood
_MOOD_PREV = ""             # the mood in effect BEFORE that reply
_MOOD_PREV_AT = 0.0
_MOOD_CARRY = 0.35          # how much of the previous mood bleeds in, at most


def mood_decay_sec() -> float:
    """How long a mood survives between turns."""
    return _env_float("VOICE_EMOTION_MOOD_SEC", 25.0, 0.0, 600.0)


def mood() -> str:
    """The emotion still colouring this conversation, or "" once it has decayed."""
    if not _MOOD_NAME:
        return ""
    if (time.time() - _MOOD_AT) > mood_decay_sec():
        return ""
    return _MOOD_NAME


def note_mood(name: str) -> None:
    """Record the emotion a reply ended on."""
    global _MOOD_NAME, _MOOD_AT, _MOOD_KEY
    _MOOD_NAME = name or ""
    _MOOD_AT = time.time()
    _MOOD_KEY = ""          # set by hand, so an explicit note is never idempotent


def reset_mood() -> None:
    """Forget the conversation's mood - a new caller starts neutral."""
    global _MOOD_NAME, _MOOD_AT, _MOOD_KEY, _MOOD_PREV, _MOOD_PREV_AT
    _MOOD_NAME = ""
    _MOOD_AT = 0.0
    _MOOD_KEY = ""
    _MOOD_PREV = ""
    _MOOD_PREV_AT = 0.0


def _fresh(at: float) -> bool:
    """Is a mood recorded at `at` still colouring the conversation?"""
    return bool(at) and (time.time() - at) <= mood_decay_sec()


def _mood_apply(beats: List[Beat], lv: float) -> List[Beat]:
    """Bleed the previous turn's mood into the opening beat, then update it."""
    global _MOOD_NAME, _MOOD_AT, _MOOD_KEY, _MOOD_PREV, _MOOD_PREV_AT
    if not beats:
        return beats
    out = list(beats)
    key = hashlib.sha1(
        (("%.3f|" % lv) + "\n".join(b.text for b in out)).encode("utf-8")
    ).hexdigest()

    # Re-planning the very same reply must reproduce the very same numbers, so
    # look at the mood that preceded it rather than the one it just created.
    if key and key == _MOOD_KEY:
        prev, prev_at = _MOOD_PREV, _MOOD_PREV_AT
    else:
        prev, prev_at = _MOOD_NAME, _MOOD_AT
    if prev and not _fresh(prev_at):
        prev = ""

    if prev and prev != out[0].emotion.name:
        base = EMOTIONS.get(prev)
        if base is not None:
            carry = _MOOD_CARRY * lv
            if carry > 0.0:
                src = base.scaled(lv)
                b = out[0]
                keep = 1.0 - carry
                out[0] = Beat(
                    text=b.text, emotion=b.emotion,
                    rate=round(b.rate * keep + src.rate * carry, 4),
                    pitch=round(b.pitch * keep + src.pitch * carry, 3),
                    volume=round(b.volume * keep + src.volume * carry, 4),
                    pause_after_ms=b.pause_after_ms, contour=b.contour,
                    emphasis=b.emphasis, clause_gaps=b.clause_gaps,
                )
    # Remember the last emotion that actually had colour, so a reply that simply
    # ends on a flat closing line does not erase the feeling that preceded it.
    ending = ""
    for b in reversed(out):
        if b.emotion.name != "neutral":
            ending = b.emotion.name
            break
    if key != _MOOD_KEY:
        _MOOD_PREV, _MOOD_PREV_AT = prev, prev_at
    _MOOD_NAME = ending or out[-1].emotion.name
    _MOOD_AT = time.time()
    _MOOD_KEY = key
    return out


def plan(text: str, *, level: float = -1.0) -> List[Beat]:
    """Turn a reply into a per-sentence performance plan."""
    lv = intensity() if level < 0 else max(0.0, min(1.0, level))
    sentences = split_sentences(text)
    if not enabled() or lv <= 0:
        return [Beat(s, NEUTRAL, 1.0, 0.0, 1.0, 0, contour_for(s)) for s in sentences]

    beats: List[Beat] = []
    last = len(sentences) - 1
    for i, s in enumerate(sentences):
        emo = detect(s).scaled(lv)
        jr, jp = _jitter(s, i)
        beats.append(Beat(
            text=s,
            emotion=emo,
            rate=round(emo.rate * jr, 4),
            pitch=round(emo.pitch + jp * lv, 3),
            volume=round(emo.volume, 4),
            pause_after_ms=_pause_for(s, emo, i == last),
            contour=contour_for(s),
            emphasis=emphasis_words(s),
            clause_gaps=clause_gaps_for(s, emo),
        ))
    return _mood_apply(_smooth(beats), lv)


def overall(text: str, *, level: float = -1.0) -> Emotion:
    """Single emotion for engines that cannot vary within one request.

    Uses the first non-neutral sentence, because the opening sets the tone a
    listener actually perceives.
    """
    lv = intensity() if level < 0 else max(0.0, min(1.0, level))
    if not enabled() or lv <= 0:
        return NEUTRAL
    for s in split_sentences(text):
        emo = detect(s)
        if emo.name != "neutral":
            return emo.scaled(lv)
    return NEUTRAL


def tag_for(text: str, *, level: float = -1.0) -> str:
    """The one performance tag to use on tag-aware engines (Fish/Chatterbox).

    Returns a bracketed tag or "". At most one per utterance: over-tagging is
    how voices start sounding like a parody of a person.
    """
    emo = overall(text, level=level)
    return ("[" + emo.tag + "] ") if emo.tag else ""


def describe(text: str, *, level: float = -1.0) -> str:
    """Human-readable summary for the UI / logs."""
    beats = plan(text, level=level)
    names = []
    for b in beats:
        if not names or names[-1] != b.emotion.name:
            names.append(b.emotion.name)
    return " then ".join(names) if names else "neutral"
