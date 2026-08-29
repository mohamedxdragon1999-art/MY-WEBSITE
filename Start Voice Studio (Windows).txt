@echo off
setlocal
title Voice Studio
cd /d "%~dp0"
set PORT=8000
set PIP_DISABLE_PIP_VERSION_CHECK=1
set PIP_NO_INPUT=1
set PYTHONDONTWRITEBYTECODE=1

REM v6.9 - NOTHING IS DOWNLOADED TWICE.
REM   * The whole setup phase is skipped after the first successful run.
REM   * pip is upgraded ONCE, not on every launch.
REM   * The venv reuses packages already installed on this machine.
REM   * Optional packages are checked independently and never retried forever.

echo ==================================================
echo    Voice Studio - talk-to-support voice website
echo.
echo    Keep THIS WINDOW OPEN while you use the site.
echo    Your browser opens automatically in a moment.
echo    Close this window when you are finished.
echo ==================================================
echo.

REM --- find Python ---
set PY=
where py >nul 2>nul && set PY=py
if not defined PY where python >nul 2>nul && set PY=python
if not defined PY where python3 >nul 2>nul && set PY=python3
if not defined PY (
  echo  Python was not found. It is a free one-time install:
  echo    1^) Go to  https://www.python.org/downloads/
  echo    2^) Run the installer and TICK "Add Python to PATH"
  echo    3^) Double-click this file again.
  echo.
  pause
  exit /b
)

REM --- create virtual env on first run ---
REM --system-site-packages REUSES anything already installed on this machine
REM instead of downloading a second private copy of it.
if not exist ".venv" (
  echo  First-time setup: creating environment...
  %PY% -m venv --system-site-packages .venv
  if errorlevel 1 %PY% -m venv .venv
  if errorlevel 1 (
    echo  Could not create the environment. Reinstall Python and try again.
    pause
    exit /b
  )
)
call ".venv\Scripts\activate.bat"

if not exist "logs" mkdir logs
set SETUP_LOG=logs\setup.log
if not exist "%SETUP_LOG%" type nul > "%SETUP_LOG%"

REM --- the "already set up" stamp ---
REM Hashes the requirements files + Python version. If nothing changed and the
REM core still imports, we do ZERO network work.
set WANT=
for /f "delims=" %%h in ('python -c "import hashlib,sys;d=open('requirements-core.txt','rb').read()+open('requirements.txt','rb').read();print(hashlib.md5(d).hexdigest()[:12]+'-'+str(sys.version_info[0])+'.'+str(sys.version_info[1]))" 2^>nul') do set WANT=%%h
set GOT=
if exist ".venv\.vs-setup-stamp" set /p GOT=<".venv\.vs-setup-stamp"

set SKIP=0
python -c "import fastapi, uvicorn, pydantic" >nul 2>nul
if not errorlevel 1 if "%WANT%"=="%GOT%" if not "%WANT%"=="" set SKIP=1
if "%VS_FORCE_SETUP%"=="1" set SKIP=0
if "%VS_SKIP_SETUP%"=="1" set SKIP=1

if "%SKIP%"=="1" (
  echo  Dependencies already installed - skipping setup ^(nothing to download^).
  goto :after_setup
)

REM --- pip upgrade: ONCE, not on every launch ---
if not exist ".venv\.vs-pip-upgraded" (
  echo  Preparing the installer ^(one time only^)...
  python -m pip install --upgrade pip >> "%SETUP_LOG%" 2>&1
  type nul > ".venv\.vs-pip-upgraded"
)

REM --- guaranteed core (required to start the server) ---
python -c "import fastapi, uvicorn, pydantic" >nul 2>nul
if errorlevel 1 (
  echo  Installing the core web server ^(first run only, needs internet^)...
  python -m pip install --prefer-binary -r requirements-core.txt >> "%SETUP_LOG%" 2>&1
)

python -c "import fastapi, uvicorn, pydantic" >nul 2>nul
if errorlevel 1 (
  echo    ...first attempt hit a problem; retrying with full output:
  python -m pip install --prefer-binary -r requirements-core.txt
)

python -c "import fastapi, uvicorn, pydantic" >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ERROR: the core packages could not be installed.
  echo  Details were saved to: %SETUP_LOG%
  echo  Make sure you have internet for this first run, then run this again.
  echo.
  pause
  exit /b
)

REM --- best-effort online voice + cloud brain (never blocks startup) ---
REM Each package is checked INDEPENDENTLY, so a missing one never causes the
REM one you already have to be downloaded again.
if exist ".venv\.vs-optional-failed" goto :stamp_it
set MISSING=
python -c "import edge_tts" >nul 2>nul
if errorlevel 1 set MISSING=%MISSING% edge-tts
python -c "import httpx" >nul 2>nul
if errorlevel 1 set MISSING=%MISSING% httpx
if not "%MISSING%"=="" (
  echo  Adding the online neural voice + cloud brain ^(optional^):%MISSING%
  python -m pip install --prefer-binary %MISSING% >> "%SETUP_LOG%" 2>&1
  if errorlevel 1 (
    echo    ^(Optional online voice/brain skipped - the browser voice still works.^)
    echo    ^(Delete .venv\.vs-optional-failed if you want to retry later.^)
    type nul > ".venv\.vs-optional-failed"
  )
)

:stamp_it
echo %WANT%> ".venv\.vs-setup-stamp"

:after_setup

REM --- preflight: make sure the app imports, so we show a real error here ---
REM     instead of a blank browser "connection refused" page.
python -c "import server" 1>>"%SETUP_LOG%" 2>&1
if errorlevel 1 (
  echo.
  echo  ERROR: the app failed to load. Details below ^(also in %SETUP_LOG%^):
  python -c "import server"
  del ".venv\.vs-setup-stamp" >nul 2>nul
  echo.
  pause
  exit /b
)

REM --- open the browser ONLY once the server is actually up (polls health) ---
REM     Uses 127.0.0.1, NOT 'localhost', to avoid the IPv6 ::1 refused bug.
start "" powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){try{$null=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:%PORT%/api/health' -TimeoutSec 1; Start-Process 'http://127.0.0.1:%PORT%/'; break}catch{Start-Sleep -Seconds 1}}"

echo.
echo  Starting Voice Studio on http://127.0.0.1:%PORT%/
echo  If the browser doesn't open, go to:  http://127.0.0.1:%PORT%/
echo  ^(Use 127.0.0.1, NOT 'localhost', if the browser says connection refused.^)
echo.
python -m uvicorn server:app --host 127.0.0.1 --port %PORT%

echo.
echo  Server stopped. Press any key to close.
pause >nul
