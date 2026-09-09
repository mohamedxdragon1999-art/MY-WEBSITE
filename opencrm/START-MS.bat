@echo off
REM OpenCRM launcher (legacy name) - now delegates to the one-click engine.
setlocal
cd /d "%~dp0"
call "%~dp0START-OpenCRM.bat" %*
