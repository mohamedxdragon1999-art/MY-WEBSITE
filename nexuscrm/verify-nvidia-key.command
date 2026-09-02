#!/bin/bash
# NVIDIA key verification for macOS/Linux — double-click me.
cd "$(dirname "$0")" || exit 1

echo ""
echo "  NVIDIA KEY VERIFICATION (no deploy needed)"
echo "  =========================================="
echo "  This tests your NVIDIA key end-to-end through the REAL app code:"
echo "  encryption, health check, a live AI completion, and the live model"
echo "  catalog. The key is read from .nvidia-test-key (gitignored) and is"
echo "  never printed or saved anywhere else."
echo ""

if [ ! -f ".nvidia-test-key" ]; then
  echo "  No key file found."
  echo ""
  echo "  To set it up, run this in Terminal:"
  echo "    echo 'nvapi-YOURKEY' > \"$(pwd)/.nvidia-test-key\""
  echo "  Then run this file again."
  echo ""
  read -r -p "Press Enter to close..."
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is required. Get it free: https://nodejs.org"
  read -r -p "Press Enter to close..."
  exit 0
fi

[ -d "node_modules/jsdom" ] || npm install --no-audit --no-fund >/dev/null 2>&1

echo "  Running the real-key test suite..."
echo ""
node tests/test_real_nvidia.mjs
echo ""
echo "  ================ COPY EVERYTHING ABOVE THIS LINE ================"
echo "  The output contains NO key material — safe to paste into the chat."
echo "  Remember to rotate/delete the key at https://build.nvidia.com when done."
echo ""
read -r -p "Press Enter to close..."
