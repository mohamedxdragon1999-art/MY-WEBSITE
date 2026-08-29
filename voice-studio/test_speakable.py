"""v0.0.44 - spoken-form normalisation and sentence integrity.

EXECUTED, not pattern-matched. Every assertion here calls the real function,
because the bugs this suite guards against (a period inside an abbreviation
being read as the end of a sentence) are completely invisible to a source-text
search - the code looked correct.
"""
import os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engines import speakable, prosody, emotion, base

PASS = 0
fails = []
FAIL = 0


def check(label, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok   " + label)
    else:
        FAIL += 1
        fails.append(label)
        print("  FAIL " + label)


print("\n[1] money is said the way a person says it")
check("$45.99 becomes dollars and cents",
      speakable.normalize("Refund of $45.99 today")
      == "Refund of 45 dollars and 99 cents today")
check("a whole amount has no stray cents",
      "25 dollars" in speakable.normalize("It costs $25.")
      and "cent" not in speakable.normalize("It costs $25."))
check("one dollar is singular", "1 dollar and 1 cent"
      in speakable.normalize("Just $1.01"))
check("no dollar SIGN survives to be read aloud",
      "$" not in speakable.normalize("Pay $45.99 or $25 now"))

print("\n[2] the things that used to be read as MINUS or SLASH")
check("a numeric range says 'to', not 'minus'",
      "3 to 5 business days" in speakable.normalize("in 3-5 business days"))
check("24/7 is not 'twenty four slash seven'",
      "/" not in speakable.normalize("We are open 24/7."))
phone = speakable.normalize("Call 1-800-555-0199 now.")
check("a phone number contains no dashes", "-" not in phone)
check("the country code is not turned into a range", " to " not in phone)
check("percent is a word", "20 percent" in speakable.normalize("20% off"))
check("a reference number is not a hash",
      "number 1423" in speakable.normalize("order #1423"))
check("thousands separators do not split the number",
      "1250" in speakable.normalize("That is 1,250 units"))

print("\n[3] addresses a voice has to spell out")
mail = speakable.normalize("Email care@example.com please")
check("an email has no @", "@" not in mail)
check("an email says 'at' and 'dot'", " at " in mail and " dot " in mail)
url = speakable.normalize("Visit https://example.com/help-page")
check("a URL loses its protocol", "http" not in url)
check("a URL says slash", "slash" in url)

print("\n[4] abbreviations are expanded, so the period disappears with them")
check("Dr. becomes Doctor", speakable.normalize("Dr. Smith") == "Doctor Smith")
check("approx. becomes approximately",
      "approximately" in speakable.normalize("approx. 20 items"))
check("Mon. becomes Monday", "Monday" in speakable.normalize("It ships Mon."))
check("e.g. becomes for example",
      "for example" in speakable.normalize("e.g. this one"))

print("\n[5] running it twice must not corrupt the text")
for original in ("Refund of $45.99 in 3-5 days", "Call 1-800-555-0199",
                 "Dr. Smith approved 20% off order #1423",
                 "Email care@example.com", "We are open 24/7"):
    once = speakable.normalize(original)
    check("idempotent: " + original, speakable.normalize(once) == once)

print("\n[6] THE BUG: a period inside a word is not the end of a sentence")
sents = emotion.split_sentences(
    "Dr. Smith approved approx. 20% off on order #1423. It ships Mon. at 5:30pm.")
check("the sentence is not torn into fragments (got %d)" % len(sents),
      len(sents) == 2)
check("'Dr.' is never a sentence by itself", "Dr." not in sents)
check("'It ships Mon.' is not cut before the time",
      any("5:30" in s and "ships" in s for s in sents))
check("a decimal version is not split",
      len(emotion.split_sentences("Version 2.5 shipped today.")) == 1)
check("initials stay with the name",
      len(emotion.split_sentences("J. Smith called back.")) == 1)

print("\n[7] the planner therefore performs whole sentences")
beats = emotion.plan("Dr. Smith approved approx. 20% off. It ships Mon.")
check("no beat is a bare abbreviation",
      all(b.text.strip() not in ("Dr.", "approx.", "Mon.") for b in beats))
check("no beat is shorter than a real clause",
      all(len(b.text.strip()) > 4 for b in beats))

print("\n[8] time-to-first-audio: a complete short sentence goes immediately")
chunks = prosody.split_for_streaming(
    "Sure, one moment. Your refund is on its way and should arrive in "
    "three to five business days.")
check("the opener is its own chunk", chunks[0] == "Sure, one moment.")
check("the rest follows separately", len(chunks) == 2)
check("first-chunk floor is low enough for a short sentence",
      prosody._FIRST_CHUNK_CHARS <= 20)
check("but not so low it emits fragments", prosody._FIRST_CHUNK_CHARS >= 8)
check("streaming never cuts inside an abbreviation",
      all(not c.rstrip().endswith("Dr.") for c in
          prosody.split_for_streaming("Ask Dr. Lee about it. He signed it off.")))
long_one = prosody.split_for_streaming(
    "This is a single long sentence with no early full stop in it at all.")
check("a single sentence is never broken mid-phrase", len(long_one) == 1)

print("\n[9] every engine benefits, because clean_text is the shared path")
cleaned = base.clean_text("Refund of $45.99 in 3-5 days. Call 1-800-555-0199.")
check("clean_text normalises money", "45 dollars and 99 cents" in cleaned)
check("clean_text normalises ranges", "3 to 5" in cleaned)
check("clean_text leaves no dashes in a phone number",
      "1-800" not in cleaned)
check("markdown is still stripped",
      "*" not in base.clean_text("This is **bold** text"))
check("empty input stays empty", base.clean_text("") == "")
check("normalisation never returns None",
      isinstance(speakable.normalize(None), str))

print("\n[10] version")
srv = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "server.py")).read()
check("version bumped to 0.0.51", 'VERSION = "0.0.51"' in srv)

print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
if fails:
    print("failures: " + "; ".join(fails))
sys.exit(1 if FAIL else 0)
