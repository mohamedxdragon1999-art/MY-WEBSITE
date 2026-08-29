"""Spoken-form normalisation: turn WRITTEN text into SAYABLE text.

v0.0.32b - found by reading aloud what the engines were actually handed.

Every TTS engine in this project was being fed raw model output. Models write
for the eye, not the ear, so callers were hearing things like:

    "$45.99"          -> "dollar forty five point nine nine"
    "3-5 days"        -> "three minus five days"
    "24/7"            -> "twenty four slash seven"
    "1-800-555-0199"  -> a string of minus signs
    "#1423"           -> "hash one thousand four hundred twenty three"
    "care@example.com" -> "care at example dot com" at best, garbage at worst
    "approx."         -> "approx", and worse, a FALSE SENTENCE BOUNDARY

That last one is the expensive bug. A period inside an abbreviation looks
exactly like the end of a sentence, so the sentence splitter cut "Dr. Smith"
into "Dr." + "Smith", gave each half its own falling intonation and its own
240ms pause, and flushed audio mid-sentence. It sounded like the voice was
breaking down, and no amount of emotion tuning could have fixed it, because the
sentence itself was being torn in half before any performance was applied.

Design rules:
- Only rewrite what is unambiguous. A wrong expansion is worse than none.
- Never invent words. "1,250 EGP" becomes "1250 Egyptian pounds", not a guess
  at what the number means.
- Idempotent: running this twice must not corrupt the text, because clean_text
  is called from several layers.
"""

from __future__ import annotations

import re
from typing import List

# ---------------------------------------------------------------------------
# Abbreviations. Expanding these kills two birds: the word is pronounced
# correctly AND the sentence-breaking period disappears.
# ---------------------------------------------------------------------------
_ABBREV = {
    "dr": "Doctor", "mr": "Mister", "mrs": "Missus", "ms": "Miss",
    "prof": "Professor", "st": "Street", "ave": "Avenue", "rd": "Road",
    "approx": "approximately", "dept": "department", "est": "estimated",
    "etc": "etcetera", "vs": "versus", "incl": "including",
    "min": "minimum", "max": "maximum", "ref": "reference",
    "mon": "Monday", "tue": "Tuesday", "tues": "Tuesday",
    "wed": "Wednesday", "thu": "Thursday", "thur": "Thursday",
    "thurs": "Thursday", "fri": "Friday", "sat": "Saturday",
    "sun": "Sunday", "jan": "January", "feb": "February",
    "mar": "March", "apr": "April", "jun": "June", "jul": "July",
    "aug": "August", "sep": "September", "sept": "September",
    "oct": "October", "nov": "November", "dec": "December",
}

# Multi-word abbreviations, handled before the single-token pass.
_PHRASES = (
    (re.compile(r"\be\.\s*g\.", re.I), "for example"),
    (re.compile(r"\bi\.\s*e\.", re.I), "that is"),
    (re.compile(r"\ba\.\s*m\.", re.I), "AM"),
    (re.compile(r"\bp\.\s*m\.", re.I), "PM"),
    (re.compile(r"\bU\.\s*S\.\s*A\."), "USA"),
    (re.compile(r"\bU\.\s*S\."), "US"),
    (re.compile(r"\b24/7\b"), "24 7"),
    (re.compile(r"\bw/o\b", re.I), "without"),
    (re.compile(r"\bw/\b", re.I), "with"),
    (re.compile(r"\b&\b"), "and"),
)

_CURRENCY_WORD = {
    "$": ("dollar", "dollars"),
    "\u00a3": ("pound", "pounds"),
    "\u20ac": ("euro", "euros"),
}

_CODES = {
    "USD": "US dollars", "EUR": "euros", "GBP": "British pounds",
    "EGP": "Egyptian pounds", "AED": "dirhams", "SAR": "Saudi riyals",
}

# Abbreviations we do NOT expand but must never be treated as a sentence end.
_NO_SPLIT = (
    "inc", "ltd", "co", "corp", "llc", "no", "fig", "vol", "pp",
    "eg", "ie", "al", "jr", "sr", "phd", "dr", "mr", "mrs", "ms",
)

_SENTINEL = "\u0000"


def protect_abbreviations(text: str) -> str:
    """Hide abbreviation periods so sentence splitters cannot cut on them.

    Returns text with those periods replaced by a sentinel. Call
    `restore_abbreviations` on each resulting piece.
    """
    t = text or ""
    # Protect BOTH lists. The expansion table matters just as much here: the
    # planner runs on raw model text that has not been normalised yet, so
    # "approx." and "Mon." would still be treated as sentence ends even though
    # normalize() would later have expanded them away. Missing this was why the
    # first version of this fix only half worked.
    for ab in set(_NO_SPLIT) | set(_ABBREV):
        t = re.sub(r"\b(" + ab + r")\.", r"\1" + _SENTINEL, t, flags=re.I)
    # Initials: "J. Smith" is one name, not two sentences.
    t = re.sub(r"\b([A-Z])\.(?=\s+[A-Z])", r"\1" + _SENTINEL, t)
    # A period between digits (version or decimal) is never a sentence end.
    t = re.sub(r"(?<=\d)\.(?=\d)", _SENTINEL, t)
    return t


def restore_abbreviations(text: str) -> str:
    return (text or "").replace(_SENTINEL, ".")


def _money(m: re.Match) -> str:
    sym, whole, cents = m.group(1), m.group(2), m.group(3)
    singular, plural = _CURRENCY_WORD.get(sym, ("dollar", "dollars"))
    whole_clean = whole.replace(",", "")
    unit = singular if whole_clean == "1" else plural
    if cents and int(cents) > 0:
        cent_word = "cent" if int(cents) == 1 else "cents"
        return "%s %s and %d %s" % (whole_clean, unit, int(cents), cent_word)
    return "%s %s" % (whole_clean, unit)


def _phone(m: re.Match) -> str:
    # Dashes in a phone number must become pauses, never "minus".
    return m.group(0).replace("-", ", ")


def normalize(text: str) -> str:
    """Rewrite written forms into forms a TTS engine says correctly."""
    t = text or ""
    if not t.strip():
        return t

    # Emails and URLs first: they contain the dots and slashes that later rules
    # would otherwise mangle.
    t = re.sub(r"\b([\w.+-]+)@([\w-]+)\.([\w.]+)\b",
               lambda m: "%s at %s dot %s" % (m.group(1).replace(".", " dot "),
                                              m.group(2),
                                              m.group(3).replace(".", " dot ")),
               t)
    t = re.sub(r"\bhttps?://\S+|\bwww\.\S+", _speak_url, t)

    for pattern, replacement in _PHRASES:
        t = pattern.sub(replacement, t)

    # Money before ranges, so "$3-$5" keeps its currency.
    t = re.sub(r"([$\u00a3\u20ac])\s?(\d[\d,]*)(?:\.(\d{2}))?", _money, t)

    # Phone-like runs of digits joined by dashes. The leading group may be a
    # single-digit country code ("1-800-..."), which is why this allows 1-4
    # digits up front - requiring 3+ let "1-800" fall through to the range rule
    # below and be read as "one TO eight hundred".
    t = re.sub(r"\b\d{1,4}(?:-\d{2,4}){2,}\b", _phone, t)

    # Numeric range: "3-5 days" is "3 to 5 days", never "3 minus 5".
    t = re.sub(r"(?<=\d)\s?-\s?(?=\d)", " to ", t)

    t = re.sub(r"(\d)\s?%", r"\1 percent", t)
    t = re.sub(r"#\s?(\d)", r"number \1", t)
    # Thousands separators: "1,250" must not be read as two numbers.
    t = re.sub(r"(?<=\d),(?=\d{3}\b)", "", t)

    for code, words in _CODES.items():
        t = re.sub(r"\b" + code + r"\b", words, t)

    # "5:30pm" -> "5:30 PM" so the meridiem is not glued to the minutes.
    t = re.sub(r"(\d)\s?([ap])\.?m\.?\b", lambda m: m.group(1) + " " +
               m.group(2).upper() + "M", t)

    # Single-token abbreviations, period included so the false sentence
    # boundary disappears with the expansion.
    def _ab(m: re.Match) -> str:
        return _ABBREV.get(m.group(1).lower(), m.group(1))

    t = re.sub(r"\b(" + "|".join(_ABBREV) + r")\.", _ab, t, flags=re.I)

    return re.sub(r"[ \t]{2,}", " ", t).strip()


def _speak_url(m: re.Match) -> str:
    url = m.group(0)
    url = re.sub(r"^https?://", "", url)
    url = url.rstrip(".,;:!?")
    url = url.replace("://", " ").replace("/", " slash ")
    url = url.replace(".", " dot ").replace("-", " dash ").replace("_", " ")
    return re.sub(r"\s{2,}", " ", url).strip()


def split_keeping_abbreviations(text: str, pattern: re.Pattern) -> List[str]:
    """Sentence-split without cutting inside abbreviations or decimals."""
    protected = protect_abbreviations(text or "")
    parts = [restore_abbreviations(p).strip() for p in pattern.split(protected)]
    return [p for p in parts if p]
