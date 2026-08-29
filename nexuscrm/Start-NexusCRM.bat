@echo off
title NexusCRM
cd /d "%~dp0"

rem ── Preferred: Node.js (server.js opens the browser itself ONCE it is
rem    actually listening — do NOT open a second tab here; that was the
rem    historical double-tab bug).
where node >nul 2>nul
if %errorlevel%==0 (
  node server.js
  goto :end
)

rem ── Fallback: Python's built-in static server (opens browser itself,
rem    because the Python server can't do it).
where python >nul 2>nul
if %errorlevel%==0 (
  start "" "http://127.0.0.1:8080/NexusCRM_V4_Hardened.html"
  python -m http.server 8080 --bind 127.0.0.1
  goto :end
)
where py >nul 2>nul
if %errorlevel%==0 (
  start "" "http://127.0.0.1:8080/NexusCRM_V4_Hardened.html"
  py -m http.server 8080 --bind 127.0.0.1
  goto :end
)

echo.
echo   NexusCRM needs Node.js (recommended) or Python 3.
echo   Get Node.js free: https://nodejs.org
echo.
pause
:end
