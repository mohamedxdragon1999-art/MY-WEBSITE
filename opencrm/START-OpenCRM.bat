@echo off
REM OpenCRM — ONE-CLICK LAUNCHER. Double-click this file.
REM It checks everything, heals ports/schema/builds/secrets, starts API + Web, opens your browser.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1" %*
if errorlevel 1 (
  echo.
  echo  ####  LAUNCH FAILED - read the red lines above.  ####
  echo  ####  Your API/Web windows stay open so you can see errors.  ####
  pause
  exit /b 1
)
echo.
echo  All done - OpenCRM should now be open in your browser.
pause
