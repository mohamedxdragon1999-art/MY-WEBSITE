#!/bin/bash
# NexusCRM launcher for macOS — double-click this file.
cd "$(dirname "$0")" || exit 1

if command -v node >/dev/null 2>&1; then
  # server.js opens the browser itself once it's actually listening.
  exec node server.js
fi

if command -v python3 >/dev/null 2>&1; then
  # Python fallback: open the browser after a short delay (the Python
  # static server can't do it itself).
  ( sleep 1; open "http://127.0.0.1:8080/NexusCRM_V4_Hardened.html" ) &
  exec python3 -m http.server 8080 --bind 127.0.0.1
fi

echo "NexusCRM needs Node.js (recommended) or Python 3."
echo "Get Node.js free: https://nodejs.org"
read -r -p "Press Enter to close..."
