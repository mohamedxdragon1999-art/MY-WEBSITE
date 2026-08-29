#!/usr/bin/env bash
# Voice Studio launcher (Linux / Mac).
#
# Philosophy: the website must ALWAYS start. We install a tiny guaranteed core;
# every heavier/optional package is best-effort and can NEVER block startup.
#
# v6.9 - NOTHING IS DOWNLOADED TWICE.
#   * The whole setup phase is skipped entirely after the first successful run
#     (guarded by a stamp file that hashes the requirements files).
#   * pip itself is upgraded ONCE, not on every launch. Upgrading pip every
#     time was a guaranteed network round-trip on every single startup.
#   * The venv is created with --system-site-packages, so packages ALREADY
#     installed on this machine are reused instead of downloaded again.
#   * Each optional package is checked independently, so a missing one can
#     never trigger a re-download of the ones already present.
#   * pip's download cache is never disabled, so even a real reinstall reuses
#     already-downloaded wheels instead of hitting the network.

cd "$(dirname "$0")"
PORT="${PORT:-8000}"
export PIP_DISABLE_PIP_VERSION_CHECK=1
export PIP_NO_INPUT=1
export PYTHONDONTWRITEBYTECODE=1   # avoid stale __pycache__ across Python versions

# --- find Python -----------------------------------------------------------
PY=""
if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python; fi
if [ -z "$PY" ]; then
  echo "Python 3 was not found."
  echo "  Mac:   install from https://www.python.org/downloads/"
  echo "  Linux: sudo apt install python3 python3-venv python3-pip"
  exit 1
fi

# --- virtual environment (first run) --------------------------------------
# --system-site-packages: if fastapi/numpy/httpx are already installed on this
# machine, REUSE them. Without this flag the venv is sealed off and pip
# re-downloads everything you already have.
if [ ! -d ".venv" ]; then
  echo "First-time setup: creating an isolated environment..."
  if ! "$PY" -m venv --system-site-packages .venv 2>/dev/null; then
    if ! "$PY" -m venv .venv; then
      echo "Could not create the environment. On Linux run: sudo apt install python3-venv"
      exit 1
    fi
  fi
fi
# shellcheck disable=SC1091
source .venv/bin/activate

mkdir -p logs
SETUP_LOG="logs/setup.log"
touch "$SETUP_LOG" 2>/dev/null || true   # APPEND - never wipe the history

have() { python -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('$1') else 1)" >/dev/null 2>&1; }

# --- the "already set up" stamp -------------------------------------------
# The stamp records a hash of the requirements files + the Python version. If
# nothing has changed and the core still imports, we do ZERO network work.
STAMP=".venv/.vs-setup-stamp"
WANT="$(cat requirements-core.txt requirements.txt 2>/dev/null | cksum | awk '{print $1}')-$(python -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null)"
GOT="$(cat "$STAMP" 2>/dev/null || true)"

SKIP_SETUP=0
if [ "$WANT" = "$GOT" ] && have fastapi && have uvicorn && have pydantic; then
  SKIP_SETUP=1
fi
# Escape hatches: VS_FORCE_SETUP=1 re-runs it, VS_SKIP_SETUP=1 never runs it.
if [ "${VS_FORCE_SETUP:-0}" = "1" ]; then SKIP_SETUP=0; fi
if [ "${VS_SKIP_SETUP:-0}" = "1" ]; then SKIP_SETUP=1; fi

if [ "$SKIP_SETUP" = "1" ]; then
  echo "Dependencies already installed - skipping setup (nothing to download)."
else
  # pip upgrade: ONCE, not every launch. This single line used to cost a
  # network round-trip on every startup.
  if [ ! -f ".venv/.vs-pip-upgraded" ]; then
    echo "Preparing the installer (one time only)..."
    python -m pip install --upgrade pip >>"$SETUP_LOG" 2>&1 || true
    touch ".venv/.vs-pip-upgraded" 2>/dev/null || true
  fi

  # --- guaranteed core (required to start the server) ---------------------
  if ! ( have fastapi && have uvicorn && have pydantic ); then
    echo "Installing the core web server (first run only, needs internet)..."
    python -m pip install --prefer-binary -r requirements-core.txt >>"$SETUP_LOG" 2>&1
    if ! ( have fastapi && have uvicorn && have pydantic ); then
      echo "  ...first attempt hit a problem; retrying with full output:"
      python -m pip install --prefer-binary -r requirements-core.txt 2>&1 | tee -a "$SETUP_LOG"
    fi
  fi

  if ! ( have fastapi && have uvicorn && have pydantic ); then
    echo ""
    echo "ERROR: the core packages could not be installed."
    echo "Details were saved to: $SETUP_LOG"
    echo "Common fixes:"
    echo "  * Make sure you have internet access for this first run."
    echo "  * Update pip:   python -m pip install --upgrade pip"
    echo "  * Linux only:   sudo apt install python3-venv python3-pip"
    exit 1
  fi

  # --- best-effort niceties (online neural voice + free cloud brain) ------
  # Checked INDEPENDENTLY: a missing edge-tts must not cause httpx (already
  # installed) to be downloaded again.
  MISSING=""
  have edge_tts || MISSING="$MISSING edge-tts"
  have httpx    || MISSING="$MISSING httpx"
  if [ -n "$MISSING" ]; then
    # Only give up permanently after a failure, so we don't retry a hopeless
    # download on every single launch (delete .venv/.vs-optional-failed to retry).
    if [ ! -f ".venv/.vs-optional-failed" ]; then
      echo "Adding the online neural voice + cloud brain (optional):$MISSING"
      if ! python -m pip install --prefer-binary $MISSING >>"$SETUP_LOG" 2>&1; then
        echo "  (Optional online voice/brain skipped - the browser voice still works.)"
        echo "  (It will not be retried every launch; delete .venv/.vs-optional-failed to retry.)"
        touch ".venv/.vs-optional-failed" 2>/dev/null || true
      fi
    fi
  fi

  # Remember that this exact set of requirements is satisfied.
  echo "$WANT" > "$STAMP" 2>/dev/null || true
fi

# --- preflight: make sure the app itself imports, so we can show a real error
#     here instead of a blank browser "connection refused" page --------------
if ! python -c "import server" >>"$SETUP_LOG" 2>&1; then
  echo ""
  echo "ERROR: the app failed to load. Details below (also in $SETUP_LOG):"
  python -c "import server" 2>&1 | tail -n 20
  rm -f "$STAMP" 2>/dev/null || true   # force a real setup pass next time
  exit 1
fi

URL="http://127.0.0.1:$PORT/"
# --- open the browser ONLY once the server is actually accepting requests ---
#     (we poll /api/health instead of a blind timer, and use 127.0.0.1 rather
#     than 'localhost' to avoid IPv6 ::1 mismatch on some systems) -----------
( for _i in $(seq 1 90); do
    if command -v curl >/dev/null 2>&1; then
      curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
    else
      sleep 5; break
    fi
    sleep 1
  done
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi ) >/dev/null 2>&1 &

echo ""
echo "Voice Studio is starting on $URL"
echo "If the browser doesn't open automatically, go to:  $URL"
echo "(Use 127.0.0.1 - NOT 'localhost' - if your browser says connection refused.)"
echo "Keep this window open while you use it; press Ctrl+C to stop."
echo ""
exec python -m uvicorn server:app --host 127.0.0.1 --port "$PORT"
