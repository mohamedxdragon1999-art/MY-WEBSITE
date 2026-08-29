"""v0.0.39 - the reply cache must never answer a question nobody asked.

WHY THIS SUITE EXISTS
---------------------
The instant-answer cache is the fastest path in the whole product: on a repeat
question it replies in under a millisecond and spends none of the free rate
limit. That makes it valuable - and dangerous, because a cache that returns a
plausible-but-wrong answer is worse than one that is simply slow. A customer
who is told the opposite of the truth, instantly and confidently, is a real
business problem.

The v0.0.39 audit found the cache doing exactly that, twice:

  1. WORD ORDER WAS INVISIBLE. Matching is done on a token SET, which has no
     idea what order the words arrived in. So
         'can i exchange the small one for the large one'
     and 'can i exchange the large one for the small one'
     were identical - similarity 1.0 - and the second question was served the
     first question's answer. Direction is everywhere in customer service:
     exchange X for Y, transfer A to B, upgrade from P to Q.

  2. NEGATION WAS TREATED AS A FILLER WORD. 'are you open on sunday' and
     'are you NOT open on sunday' scored 0.67, which the deliberately
     length-tolerant rule accepted, because to a token set 'not' looks just
     like the harmless extra word it was designed to forgive.

Everything here is executed against the real cache. No network, no key.
"""
from __future__ import annotations

import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PASS = 0
FAIL = 0


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print("  FAIL: %s %s" % (label, ("[%s]" % (extra,)) if extra != "" else ""))


import cache  # noqa: E402

_HERE = os.path.dirname(os.path.abspath(__file__))
SRC = io.open(os.path.join(_HERE, "cache.py"), encoding="utf-8").read()


def _code(src):
    """Strip whole-line comments so 'forbidden string' checks cannot be fooled
    by a comment that merely describes the old behaviour."""
    out = []
    for line in src.splitlines():
        if line.strip().startswith("#"):
            continue
        out.append(line)
    return "\n".join(out)


CODE = _code(SRC)


def miss(stored, asked, label):
    c = cache.ReplyCache()
    c.put(stored, "STORED-ANSWER")
    got = c.get(asked)
    check(label, got is None, got)


def hit(stored, asked, label):
    c = cache.ReplyCache()
    c.put(stored, "STORED-ANSWER")
    got = c.get(asked)
    check(label, got == "STORED-ANSWER", got)


# --- [1] reversed direction must never share an answer ----------------------
print("[1] word order is respected")
miss("can i exchange the small one for the large one",
     "can i exchange the large one for the small one",
     "exchange small->large is not answered with large->small")
miss("can i transfer money from savings to checking",
     "can i transfer money from checking to savings",
     "transfer savings->checking is not answered with checking->savings")
miss("how do i upgrade from basic to premium",
     "how do i upgrade from premium to basic",
     "upgrade basic->premium is not answered with premium->basic")
miss("do you convert dollars into euros",
     "do you convert euros into dollars",
     "currency direction is respected")


# --- [2] negation must never share an answer --------------------------------
print("[2] negation flips the meaning")
miss("are you open on sunday", "are you not open on sunday",
     "'not open' is not answered with 'open'")
miss("are you not open on sunday", "are you open on sunday",
     "and the reverse direction too")
miss("is shipping free", "is shipping not free",
     "'not free' is not answered with 'free'")
miss("do you deliver without a signature", "do you deliver with a signature",
     "'without' is not answered with 'with'")
miss("can i return it", "can i never return it",
     "'never' is not treated as filler")


# --- [3] the cache must STILL earn its keep ---------------------------------
# A guard that kills every match is not a fix, it is a downgrade. These are the
# real repeat questions the cache exists to serve.
print("[3] genuine repeats still hit")
hit("what are your opening hours", "tell me the opening hours",
    "a filler-word rephrase still hits")
hit("what are your opening hours", "what are your opening hours",
    "an exact repeat still hits")
hit("how long does shipping take", "how long does the shipping take",
    "an inserted article still hits")
hit("do you ship to egypt", "do you ship to egypt please",
    "a trailing politeness still hits")
hit("can i pay with paypal", "can i pay with paypal",
    "repeat with identical wording still hits")
hit("WHAT ARE YOUR OPENING HOURS?", "what are your opening hours",
    "case and punctuation are still ignored")


# --- [4] the pre-existing guards must not have been weakened ----------------
print("[4] the older safety rules still hold")
miss("what is the refund policy",
     "what is the refund policy for damaged imports",
     "a longer, more specific question is not answered with the general one")
miss("do you ship to egypt", "do you ship to england",
     "a different country is not a match")
check("personal questions are still never cacheable",
      cache.is_cacheable("where is my order", None) is False)
check("time-sensitive questions are still never cacheable",
      cache.is_cacheable("are you open today", None) is False)
check("questions with long digit runs are still never cacheable",
      cache.is_cacheable("what about order 12345", None) is False)
check("follow-ups with history are still never cacheable",
      cache.is_cacheable("and the second one",
                         [{"role": "user", "content": "hi"}]) is False)
check("a plain standalone question is still cacheable",
      cache.is_cacheable("what are your opening hours", None) is True)


# --- [5] tenant and persona isolation --------------------------------------
print("[5] answers never leak between sites")
c = cache.ReplyCache()
c.put("what are the opening hours", "Site A: nine to five", site="site-a")
check("another site cannot see it",
      c.get("what are the opening hours", site="site-b") is None)
check("the owning site can",
      c.get("what are the opening hours", site="site-a") == "Site A: nine to five")
check("a different persona cannot see it",
      c.get("what are the opening hours", site="site-a",
            system_prompt="you are a pirate") is None)
check("the scope hash is not reversible to the prompt",
      "pirate" not in cache.ReplyCache.scope("site-a", "you are a pirate"))


# --- [6] the helpers exist and behave ---------------------------------------
print("[6] the order/negation helpers")
check("_content keeps word order",
      cache._content("exchange the small for the large")
      == ["exchange", "small", "large"],
      cache._content("exchange the small for the large"))
check("_bigrams captures adjacency",
      ("exchange", "small") in cache._bigrams("exchange the small for the large"))
check("_bigrams differs when the order flips",
      cache._bigrams("exchange small large") != cache._bigrams("exchange large small"))
check("_polarity finds negation", "not" in cache._polarity("we are not open"))
check("_polarity is empty for a plain question",
      not cache._polarity("are you open on sunday"))
check("_polarity spots 'without'",
      "without" in cache._polarity("delivered without a signature"))
check("a single word is not a bigram", not cache._bigrams("refunds"))


# --- [7] the guards are wired into the real lookup path ---------------------
print("[7] the guards are actually reachable from get()")
check("_accept takes the two normalised questions",
      "na: Optional[str] = None" in CODE)
check("get() passes them in", "norm, best_norm)" in CODE)
check("the candidate loop iterates items, not values",
      "for cand_norm, e in bucket.items():" in CODE)
check("the old order-blind loop is gone",
      "for e in bucket.values():" not in CODE)
check("the polarity guard is in _accept", "_polarity(na) != _polarity(nb)" in CODE)
check("the bigram guard is in _accept", "_MIN_BIGRAM" in CODE)
check("the bigram floor is a real threshold", 0.3 <= cache._MIN_BIGRAM <= 0.8,
      cache._MIN_BIGRAM)
check("negation words are a closed list, not a wildcard",
      isinstance(cache._POLARITY, frozenset) and len(cache._POLARITY) >= 15,
      len(cache._POLARITY))


# --- [8] a stored entry with no bigrams still behaves ----------------------
# Guard against the fix crashing or over-blocking on one-word questions.
print("[8] short questions do not break the guard")
c = cache.ReplyCache()
c.put("refund policy", "Fourteen days.")
check("a two-word question can still be stored and matched",
      c.get("refund policy") == "Fourteen days.")
check("stats still report cleanly", cache.ReplyCache().stats()["entries"] == 0)

print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
