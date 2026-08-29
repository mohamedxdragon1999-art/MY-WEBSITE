"""Human-realism text conditioning for TTS (the "sounds like a person" layer).

Why this exists
---------------
The single biggest reason synthetic speech still sounds synthetic is NOT the
vocoder - modern models are already near-transparent on isolated sentences.
Sesame's own research found that without conversational context, human listeners
show *no clear preference* between real recordings and generated speech; the gap
only appears once context and prosody matter.

So the win is not "a better vocoder". The win is feeding the vocoder text that
carries the cues a human would naturally produce:

  * contractions       - "I will not" reads stiff; "I won't" reads human
  * discourse markers  - "Well," / "So," / "Right," give a natural onset beat
  * micro-pauses       - commas and ellipses become real breath/timing
  * paralinguistics    - [laugh], [sigh], [breath] on models that support them

Models that understand bracket tags natively (Chatterbox Turbo/Nano, Fish Audio
S2) get the tags. Models that don't (Kokoro, Piper, Edge) get them stripped, but
still benefit from the contraction + pacing rewrites, so nothing regresses.

Pure stdlib on purpose: this must import even when no TTS backend is installed.
"""
from __future__ import annotations

import re
from typing import List

from . import speakable

# ---------------------------------------------------------------------------
# Paralinguistic tags
# ---------------------------------------------------------------------------
# Supported natively by Chatterbox (Turbo/Nano) and Fish Audio S2.
TAGS = (
    "laugh", "chuckle", "sigh", "breath", "cough", "whisper",
    "gasp", "clear throat", "hmm", "pause",
)

_TAG_RE = re.compile(r"\[[a-zA-Z ]{2,14}\]")

# ---------------------------------------------------------------------------
# STAGE DIRECTIONS - the "it literally said the word sigh" bug
# ---------------------------------------------------------------------------
# A language model asked to be emotional does NOT write "[sigh]". It writes
# "*sighs*", "(pauses)", "[Sigh]", "<laughs softly>", or even a bare "*chuckling*".
# The old tag regex only matched lowercase square brackets, so every other form
# survived all the way to the voice and got READ ALOUD. That is the bug.
#
# So we remove stage directions in every bracket style AND case, and we also
# catch the emphasis-asterisk style that has no closing bracket at all.
_ACTION_WORDS = (
    "laugh", "laughs", "laughing", "laughter", "chuckle", "chuckles", "chuckling",
    "sigh", "sighs", "sighing", "breath", "breathes", "breathing", "inhale",
    "inhales", "exhale", "exhales", "cough", "coughs", "coughing", "whisper",
    "whispers", "whispering", "gasp", "gasps", "gasping", "clear throat",
    "clears throat", "clearing throat", "hmm", "pause", "pauses", "pausing",
    "beat", "silence", "softly", "warmly", "gently", "cheerfully", "sadly",
    "excitedly", "nervously", "smiling", "smiles", "grins", "nods", "shrugs",
    "thinking", "hesitates", "hesitating", "emphatically", "quietly",
)
_ACTION_ALT = "|".join(sorted((re.escape(w) for w in _ACTION_WORDS), key=len, reverse=True))

# Any bracketed aside: [x] (x) {x} <x> *x* _x_ - short, and action-flavoured.
_BRACKET_ASIDE = re.compile(
    r"(?:\[|\(|\{|<|\*\*|\*|_)\s*(?:" + _ACTION_ALT + r")[a-zA-Z' ,-]{0,24}"
    r"\s*(?:\]|\)|\}|>|\*\*|\*|_)",
    re.IGNORECASE,
)
# Asterisk emphasis holding ONLY an action word, e.g. *sighs deeply*
_ASTERISK_ACTION = re.compile(r"\*[^*\n]{0,40}\*")
# A stage direction sitting alone at the start of a line: "Sighs. Okay then."
_LEADING_ACTION = re.compile(
    r"^\s*(?:" + _ACTION_ALT + r")\s*[.,:;!-]+\s*", re.IGNORECASE)


def sanitize_stage_directions(text: str) -> str:
    """Strip anything a voice would embarrassingly read out as a word.

    This runs for EVERY engine, including tag-aware ones, because a model
    writing "*sighs*" is not producing a tag that Fish or Chatterbox understand
    either - it is producing a word they will pronounce.
    """
    out = text or ""
    out = _BRACKET_ASIDE.sub(" ", out)
    # Remove asterisk-wrapped asides only when they read as an action, so real
    # emphasis like *free* is left alone.
    def _maybe_action(m):
        inner = m.group(0).strip("*").strip().lower()
        words = inner.replace(",", " ").split()
        if words and any(w.strip(".!?'") in _ACTION_WORDS for w in words):
            return " "
        return m.group(0)
    out = _ASTERISK_ACTION.sub(_maybe_action, out)
    out = _LEADING_ACTION.sub("", out)
    return _collapse(out)


def strip_tags(text: str) -> str:
    """Remove bracket tags for engines that would read them out loud.

    Critical safety net: if Kokoro received "[laugh] Sure thing" it would
    literally say "bracket laugh bracket". Always call this for non-tag engines.
    """
    return _collapse(sanitize_stage_directions(_TAG_RE.sub(" ", text or "")))


def has_tags(text: str) -> bool:
    return bool(_TAG_RE.search(text or ""))


# ---------------------------------------------------------------------------
# Contractions - the cheapest, highest-impact naturalness win
# ---------------------------------------------------------------------------
_CONTRACTIONS = [
    ("do not", "don't"), ("does not", "doesn't"), ("did not", "didn't"),
    ("is not", "isn't"), ("are not", "aren't"), ("was not", "wasn't"),
    ("were not", "weren't"), ("have not", "haven't"), ("has not", "hasn't"),
    ("had not", "hadn't"), ("will not", "won't"), ("would not", "wouldn't"),
    ("could not", "couldn't"), ("should not", "shouldn't"),
    ("cannot", "can't"), ("can not", "can't"),
    ("I am", "I'm"), ("you are", "you're"), ("we are", "we're"),
    ("they are", "they're"), ("it is", "it's"), ("that is", "that's"),
    ("there is", "there's"), ("here is", "here's"), ("what is", "what's"),
    ("let us", "let's"), ("I will", "I'll"), ("you will", "you'll"),
    ("we will", "we'll"), ("I have", "I've"), ("you have", "you've"),
    ("we have", "we've"), ("I would", "I'd"), ("you would", "you'd"),
]

# Precompiled word-boundary matchers, longest first so "can not" wins over "not".
_CONTRACTION_RES = [
    (re.compile(r"\b" + re.escape(a) + r"\b", re.IGNORECASE), b)
    for a, b in sorted(_CONTRACTIONS, key=lambda p: -len(p[0]))
]


def _match_case(original: str, replacement: str) -> str:
    """Keep the original capitalisation so sentence starts stay capitalised."""
    if original[:1].isupper():
        return replacement[:1].upper() + replacement[1:]
    return replacement


def contract(text: str) -> str:
    out = text or ""
    for rx, repl in _CONTRACTION_RES:
        out = rx.sub(lambda m: _match_case(m.group(0), repl), out)
    return out


# ---------------------------------------------------------------------------
# Pacing / breathing
# ---------------------------------------------------------------------------
# Discourse markers that a human naturally pauses after. Adding the comma turns
# a flat onset into a natural beat in every neural TTS we tested.
_MARKERS = (
    "well", "so", "right", "okay", "ok", "sure", "actually", "honestly",
    "basically", "look", "alright", "now", "yeah", "got it", "of course",
    "absolutely", "no problem", "good question",
)
_MARKER_RES = [
    (re.compile(r"^(" + re.escape(m) + r")\s+(?![,.!?])", re.IGNORECASE), m)
    for m in _MARKERS
]

_LONG_CONNECTIVES = ("however", "although", "because", "which means", "that said")


def pace(text: str) -> str:
    """Insert the small pauses a human would actually make."""
    out = (text or "").strip()
    if not out:
        return out
    # Beat after an opening discourse marker: "Well I can help" -> "Well, I can help"
    for rx, _m in _MARKER_RES:
        new = rx.sub(lambda m: m.group(1) + ", ", out, count=1)
        if new != out:
            out = new
            break
    # Light breath before long connectives (only if not already punctuated).
    for c in _LONG_CONNECTIVES:
        out = re.sub(r"(?<![,;:])\s+" + re.escape(c) + r"\b",
                     ", " + c, out, flags=re.IGNORECASE)
    return _collapse(out)


_WS_RE = re.compile(r"[ \t]+")
_SPACE_BEFORE_PUNCT = re.compile(r"\s+([,.!?;:])")
_DUP_COMMA = re.compile(r",\s*,+")


def _collapse(text: str) -> str:
    out = _WS_RE.sub(" ", text or "")
    out = _SPACE_BEFORE_PUNCT.sub(r"\1", out)
    out = _DUP_COMMA.sub(",", out)
    return out.strip()


# ---------------------------------------------------------------------------
# Paralinguistic enrichment
# ---------------------------------------------------------------------------
_APOLOGY = ("sorry", "apolog", "unfortunately", "afraid")
_WARM = ("great", "perfect", "wonderful", "glad", "happy to", "love that",
         "nice one", "awesome")
_THINKING = ("let me check", "let me look", "one moment", "give me a second",
             "bear with me", "let me see")


def enrich(text: str, *, level: float = 0.5) -> str:
    """Add paralinguistic tags where a human would naturally produce them.

    Deliberately conservative. Over-tagging is the fastest way to sound like a
    parody of a person, which is worse than sounding flat. At most one tag is
    added per utterance, and only when the sentiment clearly warrants it.

    level: 0.0 = never tag, 1.0 = tag whenever a trigger matches.
    """
    out = (text or "").strip()
    if not out or level <= 0 or has_tags(out):
        return out
    low = out.lower()

    # A soft sigh before bad news reads as genuine empathy.
    if level >= 0.35 and any(w in low for w in _APOLOGY):
        return "[sigh] " + out
    # A light chuckle on warm openers - only at higher expressiveness.
    if level >= 0.65 and any(w in low for w in _WARM) and len(out) < 160:
        return "[chuckle] " + out
    # A breath before "let me check..." mirrors real thinking time.
    if level >= 0.35 and any(w in low for w in _THINKING):
        return "[breath] " + out
    return out


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def humanize(text: str, *, tags: bool = True, level: float = 0.5,
             contractions: bool = True, pacing: bool = True) -> str:
    """Full pipeline. `tags=False` for engines that can't read bracket tags.

    Order matters: contract -> pace -> enrich, so the tag lands at the very
    front of the already-rewritten sentence.
    """
    out = text or ""
    # ALWAYS first: a model's own "*sighs*" must never reach any voice as a word.
    out = sanitize_stage_directions(out)
    if contractions:
        out = contract(out)
    if pacing:
        out = pace(out)
    if tags:
        out = enrich(out, level=level)
    else:
        out = strip_tags(out)
    return _collapse(out)


# A complete short sentence ("Sure, one moment.") is worth speaking immediately.
# This is a floor on the FIRST chunk only, and we never break a sentence to hit
# it - so it buys time-to-first-audio without ever clipping a phrase.
# 12 is deliberately low: it means "any COMPLETE short sentence goes now".
# 24 was still too high - "Sure, one moment." is 17 characters, so it sat in the
# buffer waiting for a second sentence and the caller heard silence.
_FIRST_CHUNK_CHARS = 12


def split_for_streaming(text: str, min_chars: int = 60) -> List[str]:
    """Split into chunks that can be synthesized and played back progressively.

    Time-to-first-audio dominates perceived latency far more than total
    synthesis time. Speaking sentence 1 while sentence 2 renders is what makes a
    voice agent feel instant rather than merely fast.
    """
    text = _collapse(text)
    if not text:
        return []
    # v0.0.32b - do not cut inside "Dr." or "2.5"; that flushed audio
    # mid-sentence, which is the one thing that always sounds broken.
    sentences = speakable.split_keeping_abbreviations(
        text, re.compile(r"(?<=[.!?])\s+"))
    chunks: List[str] = []
    buf = ""
    for s in sentences:
        buf = (buf + " " + s).strip() if buf else s
        # v0.0.32b - THE FIRST CHUNK IS THE ONLY ONE THE CALLER WAITS FOR.
        # Every chunk used to need `min_chars` (60) before it could be spoken,
        # including the first - so a reply that opened with a short sentence sat
        # in the buffer waiting for the NEXT sentence to arrive before a single
        # sound was produced. That is pure dead air at the worst possible moment,
        # right after the caller stops talking.
        # Later chunks keep the larger threshold, because once audio is playing,
        # bigger chunks sound smoother and the buffer is already ahead.
        threshold = _FIRST_CHUNK_CHARS if not chunks else min_chars
        if len(buf) >= threshold:
            chunks.append(buf)
            buf = ""
    if buf:
        # Fold a tiny trailing fragment into the previous chunk.
        if chunks and len(buf) < 25:
            chunks[-1] = chunks[-1] + " " + buf
        else:
            chunks.append(buf)
    return chunks
