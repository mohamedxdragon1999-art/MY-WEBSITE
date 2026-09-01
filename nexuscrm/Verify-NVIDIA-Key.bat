@echo off
title NexusCRM - NVIDIA Key Verification
cd /d "%~dp0"

echo.
echo   NVIDIA KEY VERIFICATION (no deploy needed)
echo   =========================================
echo   This tests your NVIDIA key end-to-end through the REAL app code:
echo   encryption, health check, a live AI completion, and the live model
echo   catalog. The key is read from nexuscrm\.nvidia-test-key (gitignored)
echo   and is never printed or saved anywhere else.
echo.

if not exist ".nvidia-test-key" (
  echo   No key file found.
  echo.
  echo   To set it up: open Notepad, paste your key ^(one line, starts with nvapi-^),
  echo   save it as:  nexuscrm\.nvidia-test-key
  echo   Then run this file again.
  echo.
  pause
  goto :eof
)

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo   Node.js is required. Get it free: https://nodejs.org
  pause
  goto :eof
)

if not exist "node_modules\jsdom" call npm install --no-audit --no-fund >nul 2>&1

echo   Running the real-key test suite...
echo.
call node tests\test_real_nvidia.mjs
echo.
echo   ================ COPY EVERYTHING ABOVE THIS LINE ================
echo   The output contains NO key material - safe to paste into the chat.
echo   Remember to rotate/delete the key at https://build.nvidia.com when done.
echo.
pause
