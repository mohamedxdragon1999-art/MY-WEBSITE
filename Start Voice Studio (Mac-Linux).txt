#!/bin/bash
# Voice Studio - one-click launcher (Mac & Linux).
#
# The website ALWAYS starts: a tiny core is installed first, and every optional
# voice package is best-effort and can never block startup.
#
# v6.9 - NOTHING IS DOWNLOADED TWICE. After the first successful run the entire
# setup phase is skipped, so launching is instant and works with no internet.

cd "$(dirname "$0")"
PORT=8000
export PIP_DISABLE_PIP_VERSION_CHECK=1
export PIP_NO_INPUT=1
export PYTHONDONTWRITEBYTECODE=1

echo "=================================================="
echo "   Voice Studio - talk-to-support voice website"
echo ""
echo "   Keep THIS WINDOW OPEN while you use the site."
echo "   Your browser opens automatically in a moment."
echo "   Close this window when you are finished."
echo "=================================================="
echo ""

# --- find Python ---
PY=""
if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python; fi
if [ -z "$PY" ]; then
  echo "Python 3 was not found."
  echo "  Mac:   install from https://www.python.org/downloads/"
  echo "  Linux: sudo apt install python3 python3-venv python3-pip"
  read -n1 -r -p "Press any key to close..."
  exit 1
fi

# --- create virtual env on first run ---
# --system-site-packages REUSES anything already installed on this machine
# instead of downloading a second private copy of it.
if [ ! -d ".venv" ]; then
  echo "First-time setup: creating environment..."
  if ! "$PY" -m venv --system-site-packages .venv 2>/dev/null; then
    if ! "$PY" -m venv .venv; then
      echo "Could not create the environment. On Linux run: sudo apt install python3-venv"
      read -n1 -r -p "Press any key to close..."
      exit 1
    fi
  fi
fi
source .venv/bin/activate

mkdir -p logs
SETUP_LOG="logs/setup.log"
touch "$SETUP_LOG" 2>/dev/null || true   # APPEND - never wipe the history

have() { python -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('$1') else 1)" >/dev/null 2>&1; }

# --- the "already set up" stamp -------------------------------------------
STAMP=".venv/.vs-setup-stamp"
WANT="$(cat requirements-core.txt requirements.txt 2>/dev/null | cksum | awk '{print $1}')-$(python -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null)"
GOT="$(cat "$STAMP" 2>/dev/null || true)"

SKIP_SETUP=0
if [ "$WANT" = "$GOT" ] && have fastapi && have uvicorn && have pydantic; then
  SKIP_SETUP=1
fi
if [ "${VS_FORCE_SETUP:-0}" = "1" ]; then SKIP_SETUP=0; fi
if [ "${VS_SKIP_SETUP:-0}" = "1" ]; then SKIP_SETUP=1; fi

if [ "$SKIP_SETUP" = "1" ]; then
  echo "Dependencies already installed - skipping setup (nothing to download)."
else
  # pip upgrade: ONCE, not on every launch.
  if [ ! -f ".venv/.vs-pip-upgraded" ]; then
    echo "Preparing the installer (one time only)..."
    python -m pip install --upgrade pip >>"$SETUP_LOG" 2>&1 || true
    touch ".venv/.vs-pip-upgraded" 2>/dev/null || true
  fi

  # --- guaranteed core (required) ---
  if ! ( have fastapi && have uvicorn && have pydantic ); then
    echo "Installing the voice engine core (first run only, needs internet)..."
    python -m pip install --prefer-binary -r requirements-core.txt >>"$SETUP_LOG" 2>&1
    if ! ( have fastapi && have uvicorn && have pydantic ); then
      echo "  ...first attempt hit a problem; retrying with full output:"
      python -m pip install --prefer-binary -r requirements-core.txt 2>&1 | tee -a "$SETUP_LOG"
    fi
  fi

  if ! ( have fastapi && have uvicorn && have pydantic ); then
    echo ""
    echo "Setup could not finish. Details are in: $SETUP_LOG"
    echo "Make sure you have internet for this first run, then double-click again."
    read -n1 -r -p "Press any key to close..."
    exit 1
  fi

  # --- best-effort online voice + cloud brain (never blocks startup) ---
  # Checked INDEPENDENTLY so a missing one never re-downloads the other.
  MISSING=""
  have edge_tts || MISSING="$MISSING edge-tts"
  have httpx    || MISSING="$MISSING httpx"
  if [ -n "$MISSING" ]; then
    if [ ! -f ".venv/.vs-optional-failed" ]; then
      echo "Adding the online neural voice + cloud brain (optional):$MISSING"
      if ! python -m pip install --prefer-binary $MISSING >>"$SETUP_LOG" 2>&1; then
        echo "  (Optional online voice/brain skipped - the browser voice still works.)"
        echo "  (Delete .venv/.vs-optional-failed if you want to retry later.)"
        touch ".venv/.vs-optional-failed" 2>/dev/null || true
      fi
    fi
  fi

  echo "$WANT" > "$STAMP" 2>/dev/null || true
fi

# --- preflight: make sure the app itself imports, so we can show a real error
#     here instead of a blank browser "connection refused" page --------------
if ! python -c "import server" >>"$SETUP_LOG" 2>&1; then
  echo ""
  echo "ERROR: the app failed to load. Details below (also in $SETUP_LOG):"
  python -c "import server" 2>&1 | tail -n 20
  rm -f "$STAMP" 2>/dev/null || true
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

URL="http://127.0.0.1:$PORT/"
# --- open the browser ONLY once the server is actually accepting requests ---
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
echo "Starting Voice Studio on $URL"
echo "If the browser doesn't open automatically, go to:  $URL"
echo "(Use 127.0.0.1 - NOT 'localhost' - if your browser says connection refused.)"
echo ""
exec python -m uvicorn server:app --host 127.0.0.1 --port $PORT
