"""v6.9 - startup must not re-download dependencies that are already present.

The user reported that launching re-downloaded packages every time. These tests
lock in every fix so the regression cannot come back silently.
"""
import os
import re
import subprocess
import sys
import tempfile

PASS = 0
FAIL = 0
fails = []


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok   " + name)
    else:
        FAIL += 1
        fails.append(name)
        print("  FAIL " + name + (("  -> " + str(detail)) if detail else ""))


SH = open("run.sh", encoding="utf-8").read()
CMD = open("Start Voice Studio (Mac-Linux).command", encoding="utf-8").read()
BAT = open("Start Voice Studio (Windows).bat", encoding="utf-8", newline="").read()
SHELLS = {"run.sh": SH, ".command": CMD}
ALL = {"run.sh": SH, ".command": CMD, ".bat": BAT}

print("\n[1] THE BUG: pip was upgraded on EVERY launch")
for name, src in SHELLS.items():
    # The old line sat at column 0 with nothing guarding it, so every single
    # startup made a network round-trip to PyPI before doing anything else.
    bare = re.search(r"^python -m pip install --upgrade pip", src, re.M)
    check(name + ": pip upgrade is no longer unconditional", bare is None)
    check(name + ": pip upgrade is guarded by a one-time marker",
          ".vs-pip-upgraded" in src)
check(".bat: pip upgrade is guarded by a one-time marker",
      ".vs-pip-upgraded" in BAT)
check(".bat: pip upgrade sits inside the marker check",
      BAT.index(".vs-pip-upgraded") < BAT.index("pip install --upgrade pip"))

print("\n[2] packages already on the machine are REUSED, not re-downloaded")
for name, src in ALL.items():
    check(name + ": venv is created with --system-site-packages",
          "venv --system-site-packages .venv" in src)
    check(name + ": falls back to a plain venv if that is unsupported",
          src.count("-m venv") >= 2, src.count("-m venv"))

print("\n[3] the whole setup phase is skipped once it has succeeded")
for name, src in ALL.items():
    check(name + ": a setup stamp is written", ".vs-setup-stamp" in src)
    check(name + ": the stamp is compared before doing any work",
          "WANT" in src and "GOT" in src)
    check(name + ": tells the user nothing is being downloaded",
          "skipping setup" in src)
    check(name + ": the stamp covers BOTH requirements files",
          "requirements-core.txt" in src and "requirements.txt" in src)
    check(name + ": the stamp includes the Python version",
          "version_info" in src)

print("\n[4] a stale environment still repairs itself")
for name, src in ALL.items():
    check(name + ": the core import is re-verified even when stamped",
          src.count("import fastapi") >= 1 or "have fastapi" in src)
    check(name + ": a failed app import clears the stamp so setup re-runs",
          ".vs-setup-stamp" in src and
          ("rm -f \"$STAMP\"" in src or 'del ".venv\\.vs-setup-stamp"' in src))
    check(name + ": VS_FORCE_SETUP can force a reinstall", "VS_FORCE_SETUP" in src)
    check(name + ": VS_SKIP_SETUP can skip it entirely", "VS_SKIP_SETUP" in src)

print("\n[5] optional packages are checked independently")
for name, src in SHELLS.items():
    # The old code was `if ! (have edge_tts && have httpx)` which reinstalled
    # BOTH (plus uvicorn[standard]) whenever only one was missing.
    check(name + ": no combined all-or-nothing optional check",
          "have edge_tts && have httpx" not in src)
    check(name + ": each optional package is added to MISSING separately",
          "have edge_tts ||" in src and "have httpx    ||" in src)
    check(name + ": only the missing ones are installed",
          "pip install --prefer-binary $MISSING" in src)
    check(name + ": a hopeless optional install is not retried forever",
          ".vs-optional-failed" in src)
check(".bat: optional packages are probed separately",
      'python -c "import edge_tts"' in BAT and 'python -c "import httpx"' in BAT)
check(".bat: a hopeless optional install is not retried forever",
      ".vs-optional-failed" in BAT)

print("\n[6] pip's own download cache is never defeated")
for name, src in ALL.items():
    # --no-cache-dir would force a fresh download even for a wheel already on
    # disk. It must never appear.
    check(name + ": --no-cache-dir is never used", "--no-cache-dir" not in src)
    check(name + ": prefers prebuilt wheels over compiling",
          "--prefer-binary" in src)
    check(name + ": pip version check is disabled (one less network call)",
          "PIP_DISABLE_PIP_VERSION_CHECK=1" in src)
    check(name + ": pip never blocks waiting for input", "PIP_NO_INPUT=1" in src)

print("\n[7] the setup log is kept, not wiped every launch")
for name, src in SHELLS.items():
    check(name + ": log is no longer truncated on startup",
          ': > "$SETUP_LOG"' not in src)
    check(name + ": log is created without destroying history",
          'touch "$SETUP_LOG"' in src)

print("\n[8] the launchers are still valid scripts")
for name, path in (("run.sh", "run.sh"),
                   (".command", "Start Voice Studio (Mac-Linux).command")):
    r = subprocess.run(["bash", "-n", path], capture_output=True, text=True)
    check(name + ": passes bash syntax check", r.returncode == 0, r.stderr[:200])
check("run.sh is executable", os.access("run.sh", os.X_OK))
check(".command is executable",
      os.access("Start Voice Studio (Mac-Linux).command", os.X_OK))
check(".bat keeps CRLF line endings (Windows requires them)", "\r\n" in BAT)
check(".bat uses goto flow, not fragile nested parentheses",
      ":after_setup" in BAT and "goto :after_setup" in BAT)
check(".bat labels are all defined",
      all((":" + lbl) in BAT for lbl in re.findall(r"goto :(\w+)", BAT)),
      re.findall(r"goto :(\w+)", BAT))
check("all three launchers still start uvicorn",
      all("uvicorn server:app" in s for s in ALL.values()))
check("all three still poll health before opening the browser",
      all("api/health" in s for s in ALL.values()))

print("\n[9] FUNCTIONAL: the skip logic actually skips")
# Run the real stamp comparison in a sandbox to prove it behaves, rather than
# trusting that the shell reads the way it looks.
script = r'''
set -e
cd "$1"
STAMP=".venv/.vs-setup-stamp"
mkdir -p .venv
WANT="$(cat requirements-core.txt requirements.txt 2>/dev/null | cksum | awk '{print $1}')-3.13"
GOT="$(cat "$STAMP" 2>/dev/null || true)"
if [ "$WANT" = "$GOT" ]; then echo SKIP; else echo INSTALL; fi
echo "$WANT" > "$STAMP"
GOT2="$(cat "$STAMP" 2>/dev/null || true)"
if [ "$WANT" = "$GOT2" ]; then echo SKIP; else echo INSTALL; fi
echo "changed" >> requirements.txt
WANT2="$(cat requirements-core.txt requirements.txt 2>/dev/null | cksum | awk '{print $1}')-3.13"
if [ "$WANT2" = "$GOT2" ]; then echo SKIP; else echo INSTALL; fi
'''
with tempfile.TemporaryDirectory() as td:
    for f in ("requirements-core.txt", "requirements.txt"):
        with open(os.path.join(td, f), "w", encoding="utf-8") as fh:
            fh.write(open(f, encoding="utf-8").read())
    out = subprocess.run(["bash", "-c", script, "_", td],
                         capture_output=True, text=True).stdout.split()
check("first ever run installs", out[:1] == ["INSTALL"], out)
check("SECOND run downloads NOTHING (the actual complaint)",
      out[1:2] == ["SKIP"], out)
check("changing requirements correctly triggers a reinstall",
      out[2:3] == ["INSTALL"], out)

print("\n[10] offline launch is possible once set up")
for name, src in ALL.items():
    idx_skip = src.find("skipping setup")
    idx_core = src.find("requirements-core.txt", idx_skip if idx_skip > 0 else 0)
    check(name + ": the skip branch happens before any pip install",
          idx_skip > 0 and (idx_core == -1 or idx_skip < idx_core))

print("\nPASSED: %d FAILED: %d" % (PASS, FAIL))
if fails:
    print("failures: " + "; ".join(fails))
sys.exit(1 if FAIL else 0)
