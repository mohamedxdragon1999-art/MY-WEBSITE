@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
echo ══ NexusCRM backend deploy ══════════════════════

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js/npm required - install from https://nodejs.org
  pause & exit /b 1
)

where wrangler >nul 2>nul
if errorlevel 1 (
  echo Installing wrangler (Cloudflare CLI)...
  call npm install -g wrangler
)

wrangler whoami >nul 2>nul
if errorlevel 1 (
  echo Opening browser to log in to Cloudflare...
  call wrangler login
)

findstr /c:"REPLACE_WITH_YOUR_D1_DATABASE_ID" wrangler.toml >nul
if not errorlevel 1 goto :have_db

echo Creating D1 database 'nexuscrm'...
set "DBID="
for /f "tokens=3" %%i in ('wrangler d1 create nexuscrm ^| findstr /c:"database_id"') do set "DBID=%%i"
set DBID=!DBID:"=!
if "!DBID!"=="" (
  echo Could not read database_id - if the database already exists,
  echo put its id into wrangler.toml manually and re-run.
  pause & exit /b 1
)
powershell -Command "(Get-Content wrangler.toml) -replace 'REPLACE_WITH_YOUR_D1_DATABASE_ID','!DBID!' | Set-Content wrangler.toml"
echo database_id written into wrangler.toml

:have_db
echo Applying schema (idempotent - safe to re-run)...
call wrangler d1 execute nexuscrm --remote --file=./schema.sql
if errorlevel 1 ( pause & exit /b 1 )

echo Deploying worker...
call wrangler deploy
if errorlevel 1 ( pause & exit /b 1 )

echo.
echo Deployed! Next steps:
echo    1. Copy your worker URL from the output above
echo    2. In NexusCRM: Settings - System - Backend URL
echo       paste:  https://nexuscrm-backend.^<your-subdomain^>.workers.dev/api
echo    3. Register a fresh account, then add your AI key in Settings - AI Providers
pause
