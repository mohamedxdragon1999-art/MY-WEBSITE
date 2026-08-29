"""Instant-answer cache for repeated questions.

In customer service roughly a third of everything people ask is a variation of
the same handful of questions (where is my order, how do I get a refund, are
you open on Sunday). Teams that cache those answers report going from about 25
seconds down to under 100 ms on the repeats, and cutting provider calls by
roughly two thirds.

For a voice site that is a double win:
  * the reply is instant, so it sounds like a human who already knows it
  * it does NOT spend a slot from your free rate limit, so the key pool lasts
    much longer and far more people can be served at the same time

This is a lexical semantic cache: no embedding model, no extra dependency, no
GPU. It normalises the question and compares token sets (Jaccard similarity),
which is fast, deterministic, and works well for the short utterances people
actually speak out loud.

Safety rules that keep it honest:
  * only caches when there is no conversation history, because a follow-up
    such as 'and the second one?' depends on context and must never be reused
  * scoped per tenant AND per system prompt, so one site's answers can never
    leak into another site
  * skips anything personal or time sensitive (order numbers, my account,
    today, my name, and so on)
  * entries expire, so answers never go stale
"""
from __future__ import annotations

import hashlib
import re
import threading
import time
from typing import Dict, List, Optional

_MAX_ENTRIES = 800
_TTL = 1800.0          # 30 minutes
_SIMILARITY = 0.72     # how alike two questions must be to share an answer
_MIN_TOKENS = 2        # ignore very short utterances (yes / no / thanks)

# Words that carry no meaning for matching purposes.
_STOP = {
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "am",
    "do", "does", "did", "can", "could", "will", "would", "shall", "should",
    "i", "you", "we", "they", "it", "me", "us", "them", "to", "of", "in",
    "on", "at", "for", "with", "and", "or", "but", "so", "if", "that",
    "this", "there", "here", "please", "just", "like", "about", "get",
    "got", "have", "has", "had", "um", "uh", "er", "hmm", "okay", "ok",
    "hey", "hi", "hello", "thanks", "thank",
    "your", "our", "their", "its", "any", "some", "much", "many",
    "tell", "know", "want", "need", "wondering",
}

# If any of these appear the answer is personal or time sensitive and must
# never be served to a different caller.
_NEVER_CACHE = (
    "my order", "my account", "my ticket", "my booking", "my refund",
    "my card", "my payment", "my email", "my address", "my name",
    "my phone", "my number", "my password", "my subscription",
    "order number", "tracking number", "reference number", "invoice",
    "today", "tomorrow", "yesterday", "right now", "this morning",
    "last night", "just now", "status of",
)

# Words that FLIP the meaning of a question. Two questions that do not agree on
# these can never share an answer, however similar the rest of the words are.
#
# FOUND IN THE v0.0.39 AUDIT: 'are you open on sunday' and 'are you NOT open on
# sunday' scored 0.67 and cheerfully shared one answer. The length-tolerant
# rule in _accept() was written to forgive one extra filler word - and to a
# token set, 'not' looks exactly like a filler word. The cache was therefore
# capable of telling a customer the precise opposite of the truth.
_POLARITY = frozenset((
    "not", "no", "never", "none", "cannot", "cant", "dont", "doesnt",
    "didnt", "isnt", "arent", "wasnt", "werent", "wont", "wouldnt",
    "shouldnt", "couldnt", "havent", "hasnt", "aint", "nor", "neither",
    "without", "unless", "except", "non",
))

# How much of the word ORDER two questions must share.
#
# FOUND IN THE v0.0.39 AUDIT: a token set has no idea what order the words came
# in, so 'exchange the small one for the large one' and 'exchange the large one
# for the small one' are identical to it - score 1.0 - and the cache answered
# the reversed question with the original answer. Direction matters constantly
# in customer service (exchange X for Y, transfer A to B, upgrade from P to Q),
# so a shared answer now also has to agree on adjacent word pairs.
_MIN_BIGRAM = 0.5

_DIGIT_RUN = re.compile("[0-9]{3,}")
_NON_WORD = re.compile("[^a-z0-9 ]+")
_WS = re.compile(" +")


def _normalise(text: str) -> str:
    t = (text or "").lower().strip()
    t = t.replace("\t", " ").replace("\n", " ").replace("\r", " ")
    t = _NON_WORD.sub(" ", t)
    return _WS.sub(" ", t).strip()


def _content(norm: str) -> List[str]:
    """The meaningful words, IN ORDER."""
    return [w for w in norm.split() if w not in _STOP and len(w) > 1]


def _tokens(norm: str) -> frozenset:
    return frozenset(_content(norm))


def _bigrams(norm: str) -> frozenset:
    """Adjacent content-word pairs - this is what carries word order."""
    seq = _content(norm)
    return frozenset(zip(seq, seq[1:]))


def _polarity(norm: str) -> frozenset:
    """Negation words present, which must match exactly to share an answer."""
    return frozenset(w for w in norm.split() if w in _POLARITY)


def _similar(a: frozenset, b: frozenset) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if not inter:
        return 0.0
    return inter / len(a | b)


def _accept(a: frozenset, b: frozenset, score: float,
            na: Optional[str] = None, nb: Optional[str] = None) -> bool:
    """Decide whether two questions are close enough to share an answer.

    Plain Jaccard alone is too blunt for speech. 'what are your opening hours'
    and 'tell me the opening hours' mean exactly the same thing but only score
    0.67, because one has an extra filler word the other does not.

    So we accept on either of two grounds:
      1. a clearly high overlap, or
      2. a decent overlap between two questions of near-identical length,
         sharing at least two real content words.

    Rule 2 deliberately requires similar lengths. That is what stops a short
    question ('what is the refund policy') from being answered with a longer,
    more specific one ('what is the refund policy for damaged imports'), which
    is the classic way a semantic cache gives people the wrong answer.

    Two further guards, both added after the v0.0.39 audit caught the cache
    handing out answers to questions nobody had asked:
      3. the two questions must agree on NEGATION, so 'are you open on sunday'
         can never be answered with the reply to 'are you not open on sunday'
      4. they must share word ORDER, so 'exchange the small for the large' is
         never answered with the reply to 'exchange the large for the small'
    """
    if na is not None and nb is not None:
        if _polarity(na) != _polarity(nb):
            return False
        ba, bb = _bigrams(na), _bigrams(nb)
        if ba and bb and _similar(ba, bb) < _MIN_BIGRAM:
            return False
    if score >= _SIMILARITY:
        return True
    inter = len(a & b)
    return score >= 0.6 and inter >= 2 and abs(len(a) - len(b)) <= 1


def is_cacheable(text: str, history: Optional[List[Dict]]) -> bool:
    """Only stand-alone, non-personal, non-time-sensitive questions."""
    if history:
        return False
    raw = (text or "").lower()
    if not raw.strip():
        return False
    if _DIGIT_RUN.search(raw):
        return False
    for bad in _NEVER_CACHE:
        if bad in raw:
            return False
    norm = _normalise(raw)
    return len(_tokens(norm)) >= _MIN_TOKENS


class _Entry:
    __slots__ = ("tokens", "reply", "expires", "hits", "created")

    def __init__(self, tokens: frozenset, reply: str, ttl: float) -> None:
        self.tokens = tokens
        self.reply = reply
        self.created = time.time()
        self.expires = self.created + ttl
        self.hits = 0


class ReplyCache:
    """Per-scope cache of question tokens mapped to a spoken reply."""

    def __init__(self, ttl: float = _TTL, max_entries: int = _MAX_ENTRIES) -> None:
        self.ttl = ttl
        self.max_entries = max_entries
        self._data: Dict[str, Dict[str, _Entry]] = {}
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    @staticmethod
    def scope(site: Optional[str], system_prompt: Optional[str]) -> str:
        """Answers are only ever shared inside one site plus one persona."""
        h = hashlib.sha256()
        h.update((site or "default").encode("utf-8", "ignore"))
        h.update(b"|")
        h.update((system_prompt or "").encode("utf-8", "ignore"))
        return h.hexdigest()[:16]

    def _bucket(self, scope: str) -> Dict[str, _Entry]:
        b = self._data.get(scope)
        if b is None:
            b = {}
            self._data[scope] = b
        return b

    def _evict(self, bucket: Dict[str, _Entry], now: float) -> None:
        dead = [k for k, e in bucket.items() if e.expires <= now]
        for k in dead:
            bucket.pop(k, None)
        if len(bucket) > self.max_entries:
            ordered = sorted(bucket.items(), key=lambda kv: (kv[1].hits, kv[1].created))
            for k, _ in ordered[: len(bucket) - self.max_entries]:
                bucket.pop(k, None)

    def get(self, text: str, *, site: Optional[str] = None,
            system_prompt: Optional[str] = None) -> Optional[str]:
        norm = _normalise(text)
        toks = _tokens(norm)
        if len(toks) < _MIN_TOKENS:
            return None
        scope = self.scope(site, system_prompt)
        now = time.time()
        with self._lock:
            bucket = self._data.get(scope)
            if not bucket:
                self.misses += 1
                return None
            entry = bucket.get(norm)
            if entry and entry.expires > now:
                entry.hits += 1
                self.hits += 1
                return entry.reply
            best = None
            best_norm = ""
            best_score = 0.0
            # The bucket key IS the normalised question, so we can compare word
            # order and negation without storing anything extra.
            for cand_norm, e in bucket.items():
                if e.expires <= now:
                    continue
                score = _similar(toks, e.tokens)
                if score > best_score:
                    best, best_norm, best_score = e, cand_norm, score
            if best is not None and _accept(toks, best.tokens, best_score,
                                            norm, best_norm):
                best.hits += 1
                self.hits += 1
                return best.reply
            self.misses += 1
            return None

    def put(self, text: str, reply: str, *, site: Optional[str] = None,
            system_prompt: Optional[str] = None) -> None:
        reply = (reply or "").strip()
        if not reply:
            return
        norm = _normalise(text)
        toks = _tokens(norm)
        if len(toks) < _MIN_TOKENS:
            return
        scope = self.scope(site, system_prompt)
        now = time.time()
        with self._lock:
            bucket = self._bucket(scope)
            bucket[norm] = _Entry(toks, reply, self.ttl)
            self._evict(bucket, now)

    def clear(self, site: Optional[str] = None,
              system_prompt: Optional[str] = None) -> None:
        with self._lock:
            if site is None and system_prompt is None:
                self._data.clear()
            else:
                self._data.pop(self.scope(site, system_prompt), None)

    def stats(self) -> Dict:
        with self._lock:
            total = sum(len(b) for b in self._data.values())
            asked = self.hits + self.misses
            return {
                "entries": total,
                "scopes": len(self._data),
                "hits": self.hits,
                "misses": self.misses,
                "hit_rate": round(self.hits / asked, 3) if asked else 0.0,
                "ttl_seconds": int(self.ttl),
            }


# Module-level singleton used by server.py.
CACHE = ReplyCache()
