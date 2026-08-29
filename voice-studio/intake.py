"""Caller intake - capture the facts a business needs from a phone call.

WHAT THIS IS FOR
----------------
An inbound call is worthless to a business if nobody knows who rang. This module
captures, from ordinary speech, the things a human receptionist would write on a
notepad:

    first_name, last_name, email, phone, account, service

WHY IT IS ITS OWN MODULE AND NOT PROMPT TEXT
--------------------------------------------
Asking the language model to "remember the caller's email" fails in production
for reasons no prompt can fix:

* Emails and phone numbers are the WORST case for speech recognition. They are
  not words, so the recogniser's language model - the thing that makes it
  accurate on sentences - actively works against you. "john at gmail dot com"
  is what the caller says; "john@gmail.com" is what the CRM needs.
* A wrong digit is indistinguishable from a right one to a model that is only
  predicting plausible text. Validation has to be mechanical.
* The captured data must survive an interruption, a topic change, and a caller
  who gives their surname forty seconds after their first name.

So capture is deterministic, testable, and independent of which model is
answering. Everything here is pure stdlib and pure functions where possible: no
network, no model, no I/O. That means it can be unit-tested exhaustively, which
is the only way to trust it.

DESIGN RULES
------------
1. NEVER overwrite a confirmed value with an unconfirmed guess. A caller who
   spells their email once and later says "gmail" in passing must not have their
   address clobbered.
2. Prefer the LAST value for a field when neither is confirmed - people correct
   themselves ("it's smith, no sorry, smyth").
3. Confidence is recorded, not guessed at: spelled-out input scores higher than
   run-together input, because spelling is what humans do when it matters.
4. Read back anything that is expensive to get wrong. An email read back
   letter-by-letter is the difference between a delivered quote and a lost lead.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

__all__ = [
    "FIELDS", "REQUIRED", "DEFAULT_SERVICES",
    "spoken_digits", "normalize_email", "normalize_phone",
    "extract_name", "extract_service", "extract_account",
    "spell_out", "group_phone", "valid_email", "valid_phone",
    "Slot", "Intake",
]

# Order matters: this is the order the agent will ask in. Name first because it
# is the cheapest to get right and it makes the rest of the call feel personal.
FIELDS: Tuple[str, ...] = (
    "first_name", "last_name", "service", "phone", "email", "account",
)

# `account` is deliberately NOT required: most callers are new and have none.
# Asking every caller for an account number they do not have is the fastest way
# to make a phone system feel stupid.
REQUIRED: Tuple[str, ...] = (
    "first_name", "last_name", "service", "phone", "email",
)

# ---------------------------------------------------------------------------
# Spoken-token vocabularies
# ---------------------------------------------------------------------------

# NOTE ON HOMOPHONES - these were removed deliberately, after they caused a
# real failure: "the best number TO reach me is oh one zero..." captured the
# phone number as "20101234567", because "to" was decoded as the digit 2. A
# leading junk digit makes a number undialable, and the caller is then
# unreachable while the record LOOKS complete - the worst possible outcome.
# Homophones ("to"/"two", "for"/"four", "ate"/"eight", "won"/"one") appear far
# more often as ordinary words than as digits, so they cost more than they earn.
_DIGIT_WORDS: Dict[str, str] = {
    "zero": "0", "oh": "0", "o": "0", "nought": "0", "naught": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9", "niner": "9",
}

# "double seven" and "triple four" are how people really read numbers aloud.
_REPEAT_WORDS: Dict[str, int] = {"double": 2, "triple": 3, "treble": 3}

# The NATO alphabet, because callers spelling something important reach for it,
# and because it is far more robust over a phone line than bare letter names
# ('b', 'p', 'd', 'e', 'v' are near-indistinguishable at 8kHz).
_NATO: Dict[str, str] = {
    "alpha": "a", "alfa": "a", "bravo": "b", "charlie": "c", "delta": "d",
    "echo": "e", "foxtrot": "f", "golf": "g", "hotel": "h", "india": "i",
    "juliet": "j", "juliett": "j", "kilo": "k", "lima": "l", "mike": "m",
    "november": "n", "oscar": "o", "papa": "p", "quebec": "q", "romeo": "r",
    "sierra": "s", "tango": "t", "uniform": "u", "victor": "v",
    "whiskey": "w", "whisky": "w", "xray": "x", "yankee": "y", "zulu": "z",
}

_SYMBOL_WORDS: Dict[str, str] = {
    "at": "@", "atsign": "@",
    "dot": ".", "period": ".", "point": ".", "full": "", "stop": ".",
    "underscore": "_", "underline": "_",
    "dash": "-", "hyphen": "-", "minus": "-",
    "plus": "+",
}

# Bare domains callers say without the TLD: "it's john at gmail".
_BARE_DOMAINS: Dict[str, str] = {
    "gmail": "gmail.com", "googlemail": "gmail.com", "google": "gmail.com",
    "hotmail": "hotmail.com", "outlook": "outlook.com", "live": "live.com",
    "yahoo": "yahoo.com", "icloud": "icloud.com", "me": "me.com",
    "aol": "aol.com", "proton": "proton.me", "protonmail": "proton.me",
    "gmx": "gmx.com", "zoho": "zoho.com", "yandex": "yandex.com",
    "mail": "mail.com", "msn": "msn.com", "comcast": "comcast.net",
}

# Recogniser output for spoken TLDs is wildly inconsistent, so accept the lot.
_TLD_FIX: Dict[str, str] = {
    "com": "com", "co": "co", "net": "net", "org": "org", "edu": "edu",
    "gov": "gov", "io": "io", "ai": "ai", "me": "me", "uk": "uk",
    "de": "de", "fr": "fr", "eg": "eg", "sa": "sa", "ae": "ae",
}

# Words that belong to the SENTENCE, not to the address. Reaching one of these
# while walking outward from the spoken "at" ends the address.
_ADDR_STOP = {
    "hi", "hello", "hey", "my", "name", "is", "are", "and", "so", "the",
    "it", "its", "that", "thats", "email", "emails", "address", "number",
    "phone", "account", "please", "thanks", "thank", "you", "sure", "yes",
    "no", "okay", "ok", "um", "uh", "can", "reach", "me", "send", "write",
    "use", "using", "im", "was", "be", "this", "here", "there", "of", "in",
    "with", "but", "also", "actually", "sorry", "spell", "spelled",
    "letter", "letters", "word", "all", "lower", "case", "capital",
    "contact", "best", "sign", "signed", "register", "registered", "work",
    "personal", "same", "just", "got", "give", "giving", "take", "put",
}

_EMAIL_RE = re.compile(r"[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+")
_STRICT_EMAIL_RE = re.compile(
    r"^[a-z0-9][a-z0-9!#$%&'*+/=?^_`{|}~.-]*@[a-z0-9]([a-z0-9-]*[a-z0-9])?"
    r"(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$"
)

# Most specific intent first. A caller who says "cancel" wants to cancel, even
# if they also said a word that appears in the sales vocabulary.
_SERVICE_PRIORITY: Tuple[str, ...] = (
    "cancellation", "complaint", "billing", "delivery", "booking",
    "technical", "sales", "support",
)

DEFAULT_SERVICES: Dict[str, Tuple[str, ...]] = {
    "sales": ("buy", "purchase", "pricing", "price", "quote", "plan",
              "subscription", "upgrade", "demo", "trial", "sales"),
    "support": ("support", "help", "broken", "not working", "issue",
                "problem", "error", "bug", "fix", "trouble", "outage",
                "reset", "password"),
    "billing": ("billing", "invoice", "charge", "charged", "refund",
                "payment", "card", "receipt", "overcharge", "bill"),
    "booking": ("book", "booking", "appointment", "schedule", "reschedule",
                "reservation", "slot", "availability"),
    "cancellation": ("cancel", "cancellation", "terminate", "close my",
                     "unsubscribe", "stop my"),
    "complaint": ("complaint", "complain", "unhappy", "unacceptable",
                  "terrible", "speak to a manager", "escalate"),
    "delivery": ("delivery", "shipping", "order status", "tracking",
                 "where is my order", "shipment", "parcel"),
    "technical": ("install", "installation", "setup", "integration", "api",
                  "configure", "migration"),
}

# Words that follow a name cue but are not names. Without this, "this is
# regarding my bill" books a caller called Regarding.
_NOT_NAMES = {
    "calling", "call", "calling about", "here", "regarding", "about",
    "looking", "trying", "just", "still", "not", "the", "a", "an", "my",
    "your", "his", "her", "their", "our", "it", "its", "me", "you", "we",
    "they", "he", "she", "and", "but", "so", "because", "with", "from",
    "for", "very", "really", "sorry", "okay", "ok", "yes", "no", "yeah",
    "hello", "hi", "hey", "good", "morning", "afternoon", "evening",
    "interested", "wondering", "hoping", "actually", "afraid", "having",
    "trouble", "unhappy", "gonna", "going", "want", "wanted", "need",
    "needing", "phoning", "ringing", "back", "again", "sure", "fine",
    "customer", "client", "user", "member", "one", "of", "in", "on", "at",
    # "im" is what a recogniser emits for "I'm" when it drops the apostrophe,
    # and without it here "im sarah" was captured as the name "Im Sarah".
    "im", "ive", "id", "ill", "thats", "whats", "lets",
}

_NAME_CUES = (
    r"my name(?:'s| is)\s+",
    # "im sarah" - recognisers routinely drop the apostrophe from "I'm", and
    # without this cue the bare-name path saw two words and captured "Im" as
    # the first name.
    r"\bim\s+",
    r"(?:this|it)(?:'s| is)\s+",
    r"i(?:'m| am)\s+",
    r"name's\s+",
    r"speaking with\s+",
    r"you(?:'re| are) speaking (?:to|with)\s+",
    r"(?:it's|its)\s+",
)
_NAME_WORD = r"([a-z][a-z'\u2019-]{1,19})"
_NAME_RES = [
    re.compile(cue + _NAME_WORD + r"(?:\s+" + _NAME_WORD + r")?", re.I)
    for cue in _NAME_CUES
]
_SURNAME_RE = re.compile(
    r"(?:last name|surname|family name|second name)(?:'s| is|:)?\s+" + _NAME_WORD,
    re.I,
)
_FIRSTNAME_RE = re.compile(
    r"(?:first name|given name|forename)(?:'s| is|:)?\s+" + _NAME_WORD, re.I,
)
_ACCOUNT_RE = re.compile(
    r"(?:account|customer|client|reference|ref|policy|order|member(?:ship)?)"
    r"\s*(?:number|no\.?|id|#)?(?:'s| is|:)?\s+([a-z0-9 \-]{2,40})",
    re.I,
)


# ---------------------------------------------------------------------------
# Normalisation primitives
# ---------------------------------------------------------------------------

def _tokens(text: str) -> List[str]:
    return re.findall(r"[a-z0-9@._+#'-]+", (text or "").lower())


def spoken_digits(text: str) -> str:
    """Pull a digit string out of speech.

    Handles literal digits, digit words, and the multiplier forms people
    actually use aloud ("double four" -> "44"). Deliberately greedy: callers
    read numbers in groups and the grouping carries no information we need.
    """
    out: List[str] = []
    repeat = 1
    for tok in _tokens(text):
        if tok in _REPEAT_WORDS:
            repeat = _REPEAT_WORDS[tok]
            continue
        if tok in _DIGIT_WORDS:
            out.append(_DIGIT_WORDS[tok] * repeat)
            repeat = 1
            continue
        if tok.isdigit():
            out.append(tok if repeat == 1 else tok * repeat)
            repeat = 1
            continue
        # Any other word breaks a multiplier but is otherwise ignored.
        repeat = 1
    return "".join(out)


def valid_email(value: str) -> bool:
    """Mechanical validation. Cheap, and it catches what speech gets wrong."""
    if not value or len(value) > 254 or value.count("@") != 1:
        return False
    local, _, domain = value.partition("@")
    if not local or not domain or "." not in domain:
        return False
    if ".." in value or local.startswith(".") or local.endswith("."):
        return False
    if domain.startswith("-") or domain.endswith("-") or domain.startswith("."):
        return False
    tld = domain.rsplit(".", 1)[1]
    if len(tld) < 2 or not tld.isalpha():
        return False
    return bool(_STRICT_EMAIL_RE.match(value))


def valid_phone(digits: str) -> bool:
    """E.164 allows 15 digits; nothing real is shorter than 7."""
    d = digits.lstrip("+")
    return d.isdigit() and 7 <= len(d) <= 15


def normalize_email(text: str) -> Optional[str]:
    """Turn spoken text into an email address, or return None.

    Returning None on doubt is the whole point. A wrong email is worse than a
    missing one: the business believes it can reach the caller and cannot.
    """
    if not text:
        return None
    low = text.lower().replace("\u2019", "'")

    # Already written out (typed, or a recogniser that normalises for us).
    # Only spaces AROUND the at-sign are removed. Stripping every space glued
    # the whole sentence to the address, so "my email is john.smith@gmail.com"
    # was captured as "myemailisjohn.smith@gmail.com".
    direct = _EMAIL_RE.search(re.sub(r"\s*@\s*", "@", low))
    if direct:
        cand = direct.group(0).strip(".")
        if valid_email(cand):
            return cand

    if "@" not in low and not re.search(r"\bat\b", low):
        return None

    # WINDOWED WALK - and this is the whole reason this function is not three
    # lines long.
    #
    # THE BUG THIS FIXES: gluing every token in the utterance together turned
    # "hi my name is john smith and my email is john at gmail dot com" into
    # "himynameisjohnsmithandmyemailisjohn@gmail.com". That is far worse than a
    # failure, because it is a VALID-LOOKING address: it passes a regex, gets
    # stored in the CRM, and every mail sent to the caller silently bounces.
    #
    # An address is always contiguous around the spoken "at", so we walk
    # outward from that pivot and stop the moment we hit a word that belongs to
    # the sentence instead of the address.
    toks = _tokens(low)
    # EVERY candidate pivot, not just the first.
    #
    # THE BUG THIS FIXES: "you can reach me at mike at me dot com" pivots on
    # the FIRST "at", whose left neighbour is the sentence word "me", so the
    # local part came out empty and the address was lost entirely. Callers say
    # "at" in passing constantly ("reach me at", "look at", "at four o'clock"),
    # so the pivot has to be chosen by which one VALIDATES, not by position.
    pivots = [i for i, t in enumerate(toks)
              if t in ("at", "atsign", "@") and i + 1 < len(toks)]
    if not pivots:
        return None

    # Is the caller SPELLING? Several single letters or NATO words in one
    # utterance means yes.
    #
    # THE BUG THIS FIXES: the NATO alphabet contains ordinary names - "mike",
    # "victor", "romeo", "india", "hotel", "echo", "delta". Decoding it
    # unconditionally turned "mike at me dot com" into "m@me.com", quietly
    # replacing a real address with a one-letter one. NATO is only decoded when
    # the surrounding utterance actually looks spelled out.
    spell_hint = sum(1 for t in toks if len(t) == 1 or t in _NATO) >= 2

    def _part(tok: str) -> Optional[str]:
        """This token as address text, or None if it cannot be part of one."""
        if tok == "full":                     # "full stop"
            return ""
        if tok in _SYMBOL_WORDS:
            return _SYMBOL_WORDS[tok]
        if tok in _NATO and spell_hint:
            return _NATO[tok]
        if tok in _DIGIT_WORDS and len(tok) > 1:
            return _DIGIT_WORDS[tok]
        # Hyphens are legal in a domain and common in company addresses
        # ("info@my-company.com"), which this used to reject outright.
        if re.fullmatch(r"[a-z0-9-]+", tok):
            return tok
        return None

    def _stops(tok: str) -> bool:
        # Single characters are never sentence words - they are spelled letters,
        # and treating "a" as a stop word would truncate every spelled address.
        if len(tok) < 2:
            return False
        if tok in _DIGIT_WORDS or tok in _NATO or tok in _SYMBOL_WORDS:
            return False
        return tok in _ADDR_STOP

    _PIVOTS = ("at", "atsign", "@")
    _DOTS = ("dot", "period", "point")

    def _fix_domain(domain: str) -> str:
        if "." in domain:
            return domain
        if domain in _BARE_DOMAINS:
            return _BARE_DOMAINS[domain]
        # "gmailcom" - the caller said the dot, the recogniser ate it.
        for _bare, full in _BARE_DOMAINS.items():
            head = full.split(".")[0]
            for tld in ("com", "net", "org", "me", "co"):
                if domain == head + tld:
                    return full
        for tld in ("com", "net", "org", "edu", "gov", "io"):
            if domain.endswith(tld) and len(domain) > len(tld):
                return domain[: -len(tld)] + "." + tld
        return domain

    def _try(pivot: int) -> Optional[str]:
        left: List[str] = []
        for tok in reversed(toks[:pivot]):
            # Another "at" ends the local part. Without this, the walk happily
            # swallowed a previous pivot and built "me@mike" as a local part.
            if tok in _PIVOTS:
                break
            piece = _part(tok)
            if piece is None or _stops(tok):
                break
            left.append(piece)
        left.reverse()

        right: List[str] = []
        rest = toks[pivot + 1:]
        for idx, tok in enumerate(rest):
            if tok in _PIVOTS:
                break
            piece = _part(tok)
            if piece is None:
                break
            # The stop list is not applied to the FIRST domain token, because
            # some real mail domains are ordinary words ("me.com", "mail.com").
            if right and _stops(tok):
                break
            right.append(piece)
            joined = "".join(right)
            if "." in joined and joined.rsplit(".", 1)[1] in _TLD_FIX:
                # A two-part suffix ("co.uk", "com.eg") is only finished once
                # the next token is NOT another spoken dot - breaking here
                # unconditionally truncated "hotmail.co.uk" to "hotmail.co".
                nxt = rest[idx + 1] if idx + 1 < len(rest) else ""
                if nxt not in _DOTS:
                    break

        local = "".join(left).strip(".")
        domain = _fix_domain("".join(right).strip("."))
        if not local or not domain:
            return None
        cand = f"{local}@{domain}"
        return cand if valid_email(cand) else None

    for p in pivots:
        got = _try(p)
        if got:
            return got
    return None


def normalize_phone(text: str, *, default_country: str = "") -> Optional[str]:
    """Extract a dialable number, preserving an explicit country code."""
    if not text:
        return None
    low = text.lower()
    plus = bool(re.search(r"\+\s*\d", low)) or "plus" in _tokens(low)
    digits = spoken_digits(low)
    if not digits:
        return None
    # Trim an obvious leading trunk zero when a country code was given.
    if plus and digits.startswith("00"):
        digits = digits[2:]
    if not valid_phone(digits):
        return None
    if plus:
        return "+" + digits
    if default_country and len(digits) <= 11:
        return digits
    return digits


def extract_name(text: str) -> Tuple[Optional[str], Optional[str]]:
    """Find (first, last). Either may be None; both may be None."""
    if not text:
        return (None, None)
    low = text.replace("\u2019", "'")

    first = last = None

    m = _FIRSTNAME_RE.search(low)
    if m and _is_name(m.group(1)):
        first = m.group(1)
    m = _SURNAME_RE.search(low)
    if m and _is_name(m.group(1)):
        last = m.group(1)
    if first or last:
        return (_cap(first), _cap(last))

    for rx in _NAME_RES:
        m = rx.search(low)
        if not m:
            continue
        a, b = m.group(1), m.group(2)
        if not _is_name(a):
            continue
        first = a
        if b and _is_name(b):
            last = b
        return (_cap(first), _cap(last))

    # Bare "John Smith" as a whole utterance - common when answering "and your
    # name?". Only trusted when the utterance is JUST the name, because a bare
    # two-word guess anywhere else is how you end up with nonsense records.
    words = re.findall(r"[a-z][a-z'-]+", low.strip(), re.I)
    if 1 <= len(words) <= 2 and len(re.findall(r"\w+", low)) == len(words):
        if all(_is_name(w) for w in words):
            if len(words) == 2:
                return (_cap(words[0]), _cap(words[1]))
            return (_cap(words[0]), None)
    return (None, None)


def _is_name(word: Optional[str]) -> bool:
    if not word:
        return False
    w = word.lower().strip("'-")
    if len(w) < 2 or len(w) > 20 or not w[0].isalpha():
        return False
    if w in _NOT_NAMES or w in _SYMBOL_WORDS or w in _DIGIT_WORDS:
        return False
    return bool(re.fullmatch(r"[a-z][a-z'-]*", w))


def _cap(word: Optional[str]) -> Optional[str]:
    if not word:
        return None
    parts = re.split(r"(['-])", word.strip("'-"))
    return "".join(p if p in "'-" else p.capitalize() for p in parts)


def extract_service(text: str,
                    catalog: Optional[Dict[str, Tuple[str, ...]]] = None,
                    ) -> Optional[str]:
    """Classify what the caller wants by keyword score.

    Deliberately NOT a model: routing has to be explainable to the business that
    owns the phone line, and a keyword table can be edited by them without a
    retrain. Longest match wins so "speak to a manager" beats "speak".
    """
    if not text:
        return None
    cat = catalog or DEFAULT_SERVICES
    low = " " + re.sub(r"[^a-z0-9 ]+", " ", text.lower()) + " "

    scores: Dict[str, int] = {}
    for name, words in cat.items():
        best_len = 0
        for w in words:
            if re.search(r"\b" + re.escape(w), low):
                best_len = max(best_len, len(w))
        if best_len:
            scores[name] = best_len
    if not scores:
        return None

    # SPECIFICITY BEATS KEYWORD LENGTH.
    #
    # THE BUG THIS FIXES: "i want to cancel my subscription" matched both
    # `cancellation` ("cancel") and `sales` ("subscription"), and longest-match
    # scoring sent it to SALES - so a caller trying to leave got routed to
    # someone trying to sell to them. An intent that names a specific ACTION
    # always outranks a generic topic, so ties are broken by category, with
    # keyword length used only within a category.
    def rank(name: str):
        pri = (_SERVICE_PRIORITY.index(name)
               if name in _SERVICE_PRIORITY else len(_SERVICE_PRIORITY))
        return (pri, -scores[name])

    return min(scores, key=rank)


def extract_account(text: str) -> Optional[str]:
    """Account/reference numbers: letters spelled, digits spoken, or mixed."""
    if not text:
        return None
    m = _ACCOUNT_RE.search(text)
    if not m:
        return None
    tail = m.group(1)
    out: List[str] = []
    for tok in _tokens(tail):
        if tok in _DIGIT_WORDS:
            out.append(_DIGIT_WORDS[tok])
        elif tok in _NATO:
            out.append(_NATO[tok].upper())
        elif tok.isdigit():
            out.append(tok)
        elif len(tok) == 1 and tok.isalpha():
            out.append(tok.upper())
        elif tok in _REPEAT_WORDS:
            continue
        else:
            break            # a real word ends the identifier
    val = "".join(out)
    return val if len(val) >= 3 else None


# ---------------------------------------------------------------------------
# Read-back helpers
# ---------------------------------------------------------------------------

def spell_out(email: str) -> str:
    """Render an email so a TTS voice reads it back unambiguously.

    Letters are spaced (a voice says "jaysmith" otherwise), symbols are spoken,
    and the domain is left as a word because "gmail dot com" is idiomatic and
    spelling it out sounds robotic and takes far too long.
    """
    if not email or "@" not in email:
        return email or ""
    local, _, domain = email.partition("@")
    spoken_local = []
    for ch in local:
        if ch == ".":
            spoken_local.append("dot")
        elif ch == "_":
            spoken_local.append("underscore")
        elif ch == "-":
            spoken_local.append("dash")
        else:
            spoken_local.append(ch.upper())
    return " ".join(spoken_local) + " at " + domain.replace(".", " dot ")


def group_phone(number: str) -> str:
    """Group digits for read-back. Humans cannot verify an 11-digit run."""
    if not number:
        return ""
    plus = number.startswith("+")
    d = number.lstrip("+")
    groups: List[str] = []
    if plus and len(d) > 10:
        groups.append(d[:-10])
        d = d[-10:]
    while len(d) > 4:
        groups.append(d[:3])
        d = d[3:]
    if d:
        groups.append(d)
    out = " ".join(groups)
    return ("+" + out) if plus else out


# ---------------------------------------------------------------------------
# Slot state
# ---------------------------------------------------------------------------

@dataclass
class Slot:
    """One captured fact, with how sure we are and where it came from."""
    value: Optional[str] = None
    confidence: float = 0.0
    source: str = ""
    confirmed: bool = False
    attempts: int = 0
    history: List[str] = field(default_factory=list)

    def filled(self) -> bool:
        return bool(self.value)

    def as_dict(self) -> Dict[str, object]:
        return {
            "value": self.value,
            "confidence": round(self.confidence, 3),
            "source": self.source,
            "confirmed": self.confirmed,
            "attempts": self.attempts,
        }


_PROMPTS: Dict[str, str] = {
    "first_name": "Could I take your first name?",
    "last_name": "And your last name?",
    "service": "What can we help you with today?",
    "phone": "What's the best number to reach you on?",
    "email": "And your email address?",
    "account": "Do you have an account number with us?",
}

_RETRY_PROMPTS: Dict[str, str] = {
    "email": "Sorry, I didn't catch that. Could you spell the email out for me, "
             "letter by letter?",
    "phone": "Sorry, could you give me that number one digit at a time?",
    "account": "Could you read the account number out one character at a time?",
    "first_name": "Sorry, could you say your first name again?",
    "last_name": "Sorry, could you spell your last name for me?",
    "service": "Just so I route you correctly - is this about sales, support, "
               "or billing?",
}


class Intake:
    """Accumulates caller details across a whole conversation.

    Fed every final transcript. It never asks anything itself - it reports what
    is still missing and what to say next, and the conversation layer decides
    when to use that. Keeping the policy here and the speech elsewhere is what
    makes the whole thing unit-testable without a model or a microphone.
    """

    # Confidence floors. Below `CONFIRM_AT` we ask the caller to confirm rather
    # than trusting it, because these fields are expensive to get wrong.
    CONFIRM_AT = 0.85
    MAX_ATTEMPTS = 3

    def __init__(self,
                 required: Tuple[str, ...] = REQUIRED,
                 catalog: Optional[Dict[str, Tuple[str, ...]]] = None) -> None:
        self.slots: Dict[str, Slot] = {f: Slot() for f in FIELDS}
        self.required = tuple(required)
        self.catalog = catalog or DEFAULT_SERVICES
        self.turns = 0
        self.awaiting: Optional[str] = None      # field we last asked about

    # -- capture -----------------------------------------------------------
    def observe(self, text: str) -> List[str]:
        """Ingest one caller utterance. Returns the fields that changed."""
        if not text or not text.strip():
            return []
        self.turns += 1
        changed: List[str] = []
        spelled = self._looks_spelled(text)

        email = normalize_email(text)
        if email and self._set("email", email, 0.95 if spelled else 0.8,
                               "speech"):
            changed.append("email")

        # Only look for a phone number where one is plausible: a bare "two" in
        # "two of them" must never become a phone number.
        if self._phone_context(text):
            phone = normalize_phone(text)
            if phone and self._set("phone", phone, 0.95 if spelled else 0.8,
                                   "speech"):
                changed.append("phone")

        acct = extract_account(text)
        if acct and self._set("account", acct, 0.9, "speech"):
            changed.append("account")

        first, last = extract_name(text)
        if first and self._set("first_name", first, 0.9, "speech"):
            changed.append("first_name")
        if last and self._set("last_name", last, 0.9, "speech"):
            changed.append("last_name")

        svc = extract_service(text, self.catalog)
        if svc and self._set("service", svc, 0.85, "speech"):
            changed.append("service")

        # A direct answer to what we just asked is worth more than a passing
        # mention, so an answered prompt raises confidence on that field.
        if self.awaiting and self.awaiting in changed:
            self.slots[self.awaiting].confidence = min(
                1.0, self.slots[self.awaiting].confidence + 0.1)
        return changed

    def apply_dtmf(self, digits: str, field_name: Optional[str] = None) -> Optional[str]:
        """Accept keypad input - the reliable fallback for numbers.

        Keypad entry is not a recognition result, it is ground truth, so it is
        recorded confirmed at full confidence and can override speech.
        """
        d = re.sub(r"[^0-9*#]", "", digits or "")
        if not d:
            return None
        target = field_name or (
            self.awaiting if self.awaiting in ("phone", "account") else None)
        if target is None:
            target = "phone" if valid_phone(d) else "account"
        slot = self.slots.setdefault(target, Slot())
        slot.value = ("+" + d) if target == "phone" and len(d) > 11 else d
        slot.confidence = 1.0
        slot.source = "dtmf"
        slot.confirmed = True
        slot.history.append(slot.value or "")
        return target

    def _set(self, name: str, value: str, confidence: float, source: str) -> bool:
        slot = self.slots.setdefault(name, Slot())
        if slot.confirmed and slot.value != value:
            # RULE 1: a confirmed value is never overwritten by a guess. The
            # caller already verified it; a later passing mention is noise.
            return False
        if slot.value == value:
            slot.confidence = max(slot.confidence, confidence)
            return False
        slot.value = value
        slot.confidence = confidence
        slot.source = source
        slot.confirmed = False
        slot.attempts += 1
        slot.history.append(value)
        return True

    @staticmethod
    def _looks_spelled(text: str) -> bool:
        toks = _tokens(text)
        if len(toks) < 3:
            return False
        singles = sum(1 for t in toks if len(t) == 1 or t in _NATO)
        return singles >= max(3, len(toks) // 2)

    @staticmethod
    def _phone_context(text: str) -> bool:
        low = text.lower()
        if re.search(r"\b(?:phone|number|mobile|cell|call me|reach me|"
                     r"contact|whatsapp|telephone|digits)\b", low):
            return True
        # Or simply enough digits to be a number and nothing else going on.
        return len(spoken_digits(low)) >= 7

    # -- policy ------------------------------------------------------------
    def missing(self) -> List[str]:
        return [f for f in FIELDS
                if f in self.required and not self.slots[f].filled()]

    def unconfirmed(self) -> List[str]:
        """Filled fields we are not yet confident enough to rely on."""
        return [f for f in FIELDS
                if self.slots[f].filled()
                and not self.slots[f].confirmed
                and self.slots[f].confidence < self.CONFIRM_AT
                and f in ("email", "phone", "account")]

    def complete(self) -> bool:
        return not self.missing()

    def next_prompt(self) -> Optional[str]:
        """What to ask next, or None when there is nothing left to ask.

        Asks for ONE thing at a time. Stacked questions ("name, email and
        number please") reliably get one answer out of three on a phone call.
        """
        for f in self.unconfirmed():
            self.awaiting = f
            return self.confirm_prompt(f)
        for f in self.missing():
            slot = self.slots[f]
            self.awaiting = f
            if slot.attempts >= 1 and f in _RETRY_PROMPTS:
                return _RETRY_PROMPTS[f]
            if slot.attempts >= self.MAX_ATTEMPTS:
                continue
            return _PROMPTS.get(f)
        self.awaiting = None
        return None

    def confirm_prompt(self, name: str) -> Optional[str]:
        """A read-back question for one field."""
        slot = self.slots.get(name)
        if not slot or not slot.value:
            return None
        if name == "email":
            return f"Let me read that back: {spell_out(slot.value)}. Is that right?"
        if name == "phone":
            return f"So that's {group_phone(slot.value)} - correct?"
        if name == "account":
            spaced = " ".join(slot.value)
            return f"That's account {spaced}. Did I get that right?"
        return f"I have {slot.value} - is that correct?"

    def confirm(self, name: str, ok: bool = True) -> None:
        """Record the caller's answer to a read-back."""
        slot = self.slots.get(name)
        if not slot:
            return
        if ok:
            slot.confirmed = True
            slot.confidence = 1.0
        else:
            # Wrong: clear it. Keeping a value the caller just rejected is how
            # bad data gets written to a CRM.
            slot.value = None
            slot.confirmed = False
            slot.confidence = 0.0

    # -- output ------------------------------------------------------------
    def summary(self) -> str:
        """One-line human summary for a call log or a CRM note."""
        bits = []
        name = " ".join(x for x in (self.slots["first_name"].value,
                                   self.slots["last_name"].value) if x)
        if name:
            bits.append(name)
        for f in ("service", "phone", "email", "account"):
            v = self.slots[f].value
            if v:
                bits.append(f"{f}={v}")
        return "; ".join(bits)

    def to_dict(self) -> Dict[str, object]:
        return {
            "complete": self.complete(),
            "missing": self.missing(),
            "unconfirmed": self.unconfirmed(),
            "turns": self.turns,
            "fields": {k: v.as_dict() for k, v in self.slots.items()},
            "summary": self.summary(),
        }

    def redacted(self) -> Dict[str, object]:
        """Same shape, with PII masked - safe for logs.

        Voice-agent transcripts are a GDPR/PCI liability and the fastest way to
        leak an email is to log the session state while debugging. So provide a
        safe view rather than trusting everyone to remember.
        """
        out: Dict[str, object] = {"complete": self.complete(),
                                  "missing": self.missing(),
                                  "turns": self.turns}
        fields: Dict[str, object] = {}
        for k, slot in self.slots.items():
            v = slot.value
            if not v:
                fields[k] = None
            elif k == "email":
                local, _, dom = v.partition("@")
                fields[k] = (local[:1] + "***@" + dom) if local else "***"
            elif k in ("phone", "account"):
                fields[k] = ("*" * max(0, len(v) - 4)) + v[-4:]
            else:
                fields[k] = v
        out["fields"] = fields
        return out
