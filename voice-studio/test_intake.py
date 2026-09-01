#!/usr/bin/env python3
"""Caller-intake evaluation.

METHODOLOGY
-----------
Slot Filling Accuracy (SFA) is the industry metric for this job:

    SFA = correct slot extractions / total required slots

It is measured over whole SCRIPTED CALLS rather than isolated phrases, because
the failures that matter in production are cross-turn: a surname arriving forty
seconds after a first name, a caller correcting themselves, a passing mention of
"gmail" after the address was already confirmed.

Three rules this suite enforces, each of which is a real production incident:

1. A WRONG value must be treated as worse than a MISSING value. A missing email
   makes the agent ask again; a wrong-but-plausible email makes the business
   believe it can reach a customer it cannot. So every extractor is tested on
   negatives - utterances that must yield nothing - and those count as failures
   when they produce output.
2. Confirmed data is immutable to guesses.
3. Nothing here may ever raise on a live call, so the fuzz section throws
   garbage at every entry point.
"""

import random
import re
import sys

import intake as k

PASS = 0
FAIL = 0
NOTES = []


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print(f"  FAIL {name}" + (f"  -> {detail}" if detail else ""))


def section(t):
    print(f"\n== {t} ==")


def note(s):
    NOTES.append(s)
    print(f"  .. {s}")


def guard(fn):
    """An unexpected exception is a FAIL, not an aborted run."""
    try:
        fn()
    except Exception as exc:                                # noqa: BLE001
        global FAIL
        FAIL += 1
        print(f"  FAIL {fn.__name__} raised {type(exc).__name__}: {exc}")


# ---------------------------------------------------------------------------
section("1. email capture - the hardest field on a phone line")

# (utterance, expected). None means "must extract nothing".
EMAIL_CASES = [
    # The regression that motivated the windowed walk.
    ("hi my name is john smith and my email is john at gmail dot com",
     "john@gmail.com"),
    # "j o h n" spells john, so the local part is john.smith - my first
    # expectation here said j.smith, which was simply wrong.
    ("my email is j o h n dot smith at gmail dot com", "john.smith@gmail.com"),
    ("its sarah underscore 99 at hotmail dot com", "sarah_99@hotmail.com"),
    # Two-part suffix: must not be truncated to "hotmail.co".
    ("its sarah underscore 99 at hotmail dot co dot uk", "sarah_99@hotmail.co.uk"),
    ("you can reach me at mike at me dot com thanks", "mike@me.com"),
    ("email me at ahmed at yahoo", "ahmed@yahoo.com"),
    ("a l i at proton dot me please", "ali@proton.me"),
    ("contact is bravo oscar bravo at outlook dot com", "bob@outlook.com"),
    ("my address is info at my-company dot com", "info@my-company.com"),
    ("sales at acme dot co dot uk", "sales@acme.co.uk"),
    ("m dash smith at gmail dot com", "m-smith@gmail.com"),
    ("it's tom dot h at company dot io", "tom.h@company.io"),
    # Already-written form (typed into the widget, or a normalising recogniser).
    ("my email is John.Smith@Gmail.com", "john.smith@gmail.com"),
    # NEGATIVES - these must yield nothing at all.
    ("i am at the office right now", None),
    ("call me back tomorrow at four", None),
    ("no email sorry", None),
    ("i'll look at it later", None),
    ("", None),
    ("at", None),
]

for said, want in EMAIL_CASES:
    got = k.normalize_email(said)
    check(f"email: {said[:44]!r}", got == want, f"got {got!r} want {want!r}")

# Anything produced must be structurally valid - a plausible-looking address is
# the dangerous failure mode, so validity is asserted independently.
bad = [s for s, _ in EMAIL_CASES
       if (g := k.normalize_email(s)) and not k.valid_email(g)]
check("every extracted address passes validation", not bad, str(bad))

# The sentence must never leak into the local part.
leaks = [s for s, _ in EMAIL_CASES
         if (g := k.normalize_email(s)) and len(g.split("@")[0]) > 30]
check("no utterance is swallowed into the local part", not leaks, str(leaks))

check("validator rejects a missing TLD", not k.valid_email("a@b"))
check("validator rejects a double dot", not k.valid_email("a..b@c.com"))
check("validator rejects two at signs", not k.valid_email("a@b@c.com"))
check("validator rejects a numeric TLD", not k.valid_email("a@b.12"))
check("validator accepts a normal address", k.valid_email("a.b-c@d.co.uk"))


# ---------------------------------------------------------------------------
section("2. phone capture")

PHONE_CASES = [
    # 10 digits: 0-1-0-22-3-4-5-6-7. Counted by hand rather than assumed - the
    # first version of this expectation was wrong, which would have masked a
    # real bug in either direction.
    ("my number is oh one zero double two three four five six seven",
     "0102234567"),
    ("my phone is 010 1234 5678", "01012345678"),
    ("call me on 555 1234", "5551234"),
    ("the best number is triple eight one two three four", "8881234"),
    # NEGATIVES
    ("i have two of them", None),
    ("my number is 123", None),          # too short to be real
    ("i called you three times", None),
    ("", None),
]
for said, want in PHONE_CASES:
    got = k.normalize_phone(said)
    check(f"phone: {said[:40]!r}", got == want, f"got {got!r} want {want!r}")

plus = k.normalize_phone("plus two zero one zero one two three four five six seven eight")
check("an explicit country code is preserved", bool(plus and plus.startswith("+")), str(plus))
check("country-code numbers still validate", bool(plus and k.valid_phone(plus)), str(plus))
check("7 digits is the floor", k.valid_phone("1234567") and not k.valid_phone("123456"))
check("15 digits is the E.164 ceiling",
      k.valid_phone("1" * 15) and not k.valid_phone("1" * 16))
check("double doubles a digit", k.spoken_digits("double four") == "44")
check("triple triples a digit", k.spoken_digits("triple seven") == "777")
check("oh is read as zero", k.spoken_digits("oh one oh") == "010")
check("a multiplier is not applied across words",
      k.spoken_digits("double cheese four") == "4",
      k.spoken_digits("double cheese four"))


# ---------------------------------------------------------------------------
section("3. names")

NAME_CASES = [
    ("my name is john smith", ("John", "Smith")),
    ("hi im sarah", ("Sarah", None)),
    ("im sarah", ("Sarah", None)),
    ("this is ahmed hassan calling", ("Ahmed", "Hassan")),
    ("my name's o'brien", ("O'Brien", None)),
    ("first name is mary", ("Mary", None)),
    ("last name is smyth", (None, "Smyth")),
    ("John Smith", ("John", "Smith")),
    # NEGATIVES - cue words followed by non-names.
    ("this is regarding my bill", (None, None)),
    ("i'm calling about an invoice", (None, None)),
    ("i am very unhappy", (None, None)),
    ("this is not working", (None, None)),
    ("hello there", (None, None)),
    ("", (None, None)),
]
for said, want in NAME_CASES:
    got = k.extract_name(said)
    check(f"name: {said[:40]!r}", got == want, f"got {got!r} want {want!r}")

check("names are capitalised for a CRM", k.extract_name("my name is jOHN")[0] == "John")
check("hyphenated surnames survive",
      k.extract_name("my name is anna smith-jones")[1] == "Smith-Jones",
      str(k.extract_name("my name is anna smith-jones")))


# ---------------------------------------------------------------------------
section("4. service routing")

SERVICE_CASES = [
    ("i want to know your pricing", "sales"),
    ("my login is broken", "support"),
    ("i was charged twice on my invoice", "billing"),
    ("i'd like to book an appointment", "booking"),
    ("i want to cancel my subscription", "cancellation"),
    ("where is my order", "delivery"),
    ("i need to speak to a manager", "complaint"),
    ("can you help me set up the api", "technical"),
    ("", None),
]
for said, want in SERVICE_CASES:
    got = k.extract_service(said)
    check(f"service: {said[:40]!r}", got == want, f"got {got!r} want {want!r}")

# The catalog must be replaceable without touching code - the business that owns
# the phone line has to be able to edit its own routing.
custom = {"pizza": ("pizza", "pepperoni"), "pasta": ("pasta",)}
check("a custom catalog overrides the default",
      k.extract_service("i want a pepperoni pizza", custom) == "pizza")
check("a custom catalog does not fall back to defaults",
      k.extract_service("my login is broken", custom) is None)


# ---------------------------------------------------------------------------
section("5. account / reference numbers")

check("digits after an account cue",
      k.extract_account("my account number is four four five six") == "4456",
      str(k.extract_account("my account number is four four five six")))
check("NATO letters are decoded and upper-cased",
      k.extract_account("account is alpha bravo one two three") == "AB123",
      str(k.extract_account("account is alpha bravo one two three")))
check("a reference cue also works",
      k.extract_account("the reference is 9 9 8 8 7") == "99887",
      str(k.extract_account("the reference is 9 9 8 8 7")))
check("no cue means no account", k.extract_account("just four five six") is None)
check("too short to be an identifier",
      k.extract_account("my account is 1") is None)


# ---------------------------------------------------------------------------
section("6. read-back rendering")

spoken = k.spell_out("j.smith@gmail.com")
check("letters are separated for the voice", "J . " not in spoken and " S " in spoken.upper(),
      spoken)
check("the dot in the local part is spoken", "dot" in spoken, spoken)
check("the at sign is spoken", " at " in spoken, spoken)
check("the domain stays idiomatic", "gmail dot com" in spoken, spoken)
check("underscores are spoken", "underscore" in k.spell_out("a_b@c.com"))
check("read-back never returns an empty string for a real address",
      bool(k.spell_out("a@b.com").strip()))

check("phone read-back is grouped", k.group_phone("5551234") == "555 1234",
      k.group_phone("5551234"))
check("country code is split off for read-back",
      k.group_phone("+201012345678").startswith("+20"),
      k.group_phone("+201012345678"))
check("no group is longer than 4 digits",
      all(len(g.lstrip("+")) <= 4 for g in k.group_phone("+201012345678").split()),
      k.group_phone("+201012345678"))


# ---------------------------------------------------------------------------
section("7. cross-turn slot filling accuracy (SFA)")

# A realistic call: details arrive out of order, spread over turns, with
# corrections and irrelevant chat in between.
CALL = [
    "hi there",
    "yeah i'm having trouble logging in to my account",
    "my name is ahmed",
    "sorry my last name is hassan",
    "the best number to reach me is oh one zero one two three four five six seven",
    "and my email is a h m e d at gmail dot com",
    "thanks a lot",
]
EXPECT = {
    "first_name": "Ahmed",
    "last_name": "Hassan",
    "service": "support",
    # 10 digits, counted from the transcript: oh-one-zero-one-two-three-four-
    # five-six-seven.
    "phone": "0101234567",
    "email": "ahmed@gmail.com",
}

sess = k.Intake()
for line in CALL:
    sess.observe(line)

correct = sum(1 for f, want in EXPECT.items() if sess.slots[f].value == want)
sfa = correct / len(EXPECT)
note(f"SFA over a 7-turn call = {sfa:.2%} ({correct}/{len(EXPECT)})")
for f, want in EXPECT.items():
    check(f"SFA slot {f}", sess.slots[f].value == want,
          f"got {sess.slots[f].value!r} want {want!r}")
check("SFA is 100% on the scripted call", sfa == 1.0, f"{sfa:.2%}")
check("the call is reported complete", sess.complete(), str(sess.missing()))
check("nothing is still missing", sess.missing() == [], str(sess.missing()))
check("an optional account was not invented", sess.slots["account"].value is None)
check("the summary names the caller", "Ahmed Hassan" in sess.summary(), sess.summary())

# A caller correcting themselves must win.
corr = k.Intake()
corr.observe("my name is john smith")
corr.observe("sorry my last name is smythe")
check("a correction replaces the earlier surname",
      corr.slots["last_name"].value == "Smythe", corr.slots["last_name"].value)
check("the correction is kept in history",
      "Smith" in corr.slots["last_name"].history, str(corr.slots["last_name"].history))


# ---------------------------------------------------------------------------
section("8. confirmation discipline")

c = k.Intake()
c.observe("my email is john at gmail dot com")
first_email = c.slots["email"].value
prompt = c.confirm_prompt("email")
check("the read-back prompt spells the address",
      prompt is not None and "J" in prompt and "gmail dot com" in prompt, str(prompt))
c.confirm("email", True)
check("confirming raises confidence to certain", c.slots["email"].confidence == 1.0)

# RULE 1: a confirmed value is immune to a later passing mention.
c.observe("yeah i also use hotmail at hotmail dot com sometimes")
check("a confirmed email is not overwritten by a guess",
      c.slots["email"].value == first_email, c.slots["email"].value)

# A rejected value must be cleared, not kept.
r = k.Intake()
r.observe("my email is john at gmail dot com")
r.confirm("email", False)
check("a rejected value is cleared", r.slots["email"].value is None)
check("a rejected field is asked for again", "email" in r.missing())

# Prompts ask for one thing at a time.
p = k.Intake()
asked = []
for _ in range(6):
    q = p.next_prompt()
    if not q:
        break
    asked.append(q)
    p.observe({
        "first_name": "my name is lena",
        "last_name": "last name is farag",
        "service": "i need help with a bug",
        "phone": "my number is 555 987 6543",
        "email": "l e n a at gmail dot com",
    }.get(p.awaiting or "", "okay"))
check("prompts ask one field at a time",
      all(q.count("?") <= 1 for q in asked), str(asked))
check("the prompt sequence terminates", p.next_prompt() is None, str(p.missing()))
check("every required field was gathered by prompting", p.complete(), str(p.missing()))


# ---------------------------------------------------------------------------
section("9. keypad (DTMF) fallback")

d = k.Intake()
d.observe("my number is 555 1234")
speech_value = d.slots["phone"].value
d.apply_dtmf("5559876543", "phone")
check("keypad entry overrides a speech guess",
      d.slots["phone"].value == "5559876543", d.slots["phone"].value)
check("keypad entry is trusted as confirmed", d.slots["phone"].confirmed)
check("keypad entry is recorded as its own source",
      d.slots["phone"].source == "dtmf", d.slots["phone"].source)
check("the speech value differed (so the override was real)",
      speech_value != d.slots["phone"].value)
check("keypad input is stripped of noise",
      k.Intake().apply_dtmf("55-51 234") == "phone")
check("empty keypad input changes nothing", k.Intake().apply_dtmf("") is None)

# A confirmed keypad number must not be clobbered by a later mishearing.
d.observe("my number is 555 0000 111")
check("a keypad number survives a later mishearing",
      d.slots["phone"].value == "5559876543", d.slots["phone"].value)


# ---------------------------------------------------------------------------
section("10. privacy - transcripts are a compliance liability")

pv = k.Intake()
pv.observe("my name is john smith")
pv.observe("email is john dot smith at gmail dot com")
pv.observe("my number is 555 987 6543")
red = str(pv.redacted())
check("the full email never appears in the redacted view",
      "john.smith@gmail.com" not in red, red)
check("the full phone never appears in the redacted view",
      "5559876543" not in red, red)
check("the last 4 digits are kept for identification",
      "6543" in red, red)
check("the domain is kept for triage", "gmail.com" in red, red)
check("the redacted view still reports completeness",
      "complete" in pv.redacted())
check("the full view is still available when needed",
      pv.to_dict()["fields"]["email"]["value"] == "john.smith@gmail.com")


# ---------------------------------------------------------------------------
section("11. fuzzing - nothing here may raise on a live call")

rng = random.Random(1234)
ALPHABET = list("abcdefghijklmnopqrstuvwxyz0123456789 .@_-+#'\"\\/\t\n") + [
    "at", "dot", "double", "gmail", "account", "my name is", "\u00e9", "\u0645",
    "\ud83d\ude00", "NULL", "<script>", "'; drop table", "%s", "{}", "\x00",
]

errors = []
for i in range(3000):
    n = rng.randint(0, 14)
    s = "".join(rng.choice(ALPHABET) for _ in range(n))
    try:
        k.normalize_email(s)
        k.normalize_phone(s)
        k.extract_name(s)
        k.extract_service(s)
        k.extract_account(s)
        k.spoken_digits(s)
        k.spell_out(s)
        k.group_phone(s)
        sess = k.Intake()
        sess.observe(s)
        sess.next_prompt()
        sess.to_dict()
        sess.redacted()
        sess.apply_dtmf(s)
    except Exception as exc:                                # noqa: BLE001
        errors.append(f"{type(exc).__name__}: {exc} on {s!r}")
        if len(errors) > 4:
            break
check("3000 fuzzed utterances raise nothing", not errors, "; ".join(errors[:3]))
note("fuzzed 3000 random utterances through every entry point")

# Pathological inputs that have broken regex-based extractors before.
for s in ["a" * 5000, "at " * 500, "1" * 400, " ".join(["dot"] * 300),
          "my name is " + "x" * 300, "@" * 100, None]:
    try:
        k.normalize_email(s if s is not None else "")
        k.Intake().observe(s if s is not None else "")
        ok = True
    except Exception as exc:                                # noqa: BLE001
        ok = False
        print(f"  FAIL pathological input {type(exc).__name__}: {exc}")
    check(f"pathological input handled: {str(s)[:18]!r}", ok)

# A 5000-character run must not be accepted as an address.
huge = k.normalize_email("my email is " + "a" * 5000 + " at gmail dot com")
check("an absurdly long local part is rejected",
      huge is None or len(huge) <= 254, str(huge)[:40])


# ---------------------------------------------------------------------------
section("12. wiring into the live session")

import realtime  # noqa: E402

sess = realtime.RealtimeSession.__new__(realtime.RealtimeSession)
check("the session class exposes intake", hasattr(realtime, "Intake"))
src = open("realtime.py", encoding="utf-8").read()
check("intake is constructed per session", "self.intake = Intake()" in src)
check("every committed turn is observed", "self.intake.observe(said)" in src)
check("intake is reported to the client", 't="intake"' in src)
check("intake failure cannot break the call",
      "got = self.intake.observe(said)" in src
      and src.split("got = self.intake.observe(said)")[0].rstrip().endswith("try:"))


# ---------------------------------------------------------------------------
print("\n" + "=" * 62)
for n in NOTES:
    print("note: " + n)
print(f"PASSED: {PASS}  FAILED: {FAIL}")
print("=" * 62)
sys.exit(1 if FAIL else 0)
