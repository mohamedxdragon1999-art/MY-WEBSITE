# OpenCRM one-click launcher engine (PowerShell 5.1 compatible).
#
# Usage (double-click START-OpenCRM.bat, or directly):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\launch.ps1 [-Mode all|api|web|doctor|stop] [-Rebuild] [-NoBrowser]
#
# What it does, in order (every run is idempotent and safe to repeat):
#   1. Checks node (>=18) + npm exist.
#   2. npm install (only if node_modules is missing).
#   3. Ensures apps/api/.env has DATABASE_URL, JWT_SECRET, INTEGRATION_KEY, WEB_URL, API_PORT
#      (generates cryptographically random secrets into the GITIGNORED .env - never hardcoded).
#   4. prisma generate + prisma db push (schema sync; additive, never destructive).
#   5. Builds the API unless dist is already newer than all sources (or -Rebuild).
#   6. Frees ports 4000/3001 by stopping ONLY their current owners (never kills all node.exe).
#   7. Starts API + Web in titled windows that STAY OPEN on crash (logs visible).
#   8. Waits for real health responses (API /api/health, Web HTTP 200).
#   9. Opens the browser at http://localhost:3001.
param(
  [string]$Mode = "all",
  [switch]$Rebuild,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ApiDir = Join-Path $Root "apps\api"
$WebDir = Join-Path $Root "apps\web"
$ApiEnvFile = Join-Path $ApiDir ".env"
$WebEnvFile = Join-Path $WebDir ".env.local"
$SchemaFile = Join-Path $Root "packages\db\prisma\schema.prisma"
$ApiPort = 4000
$WebPort = 3001
$Failures = 0

function Write-Step($msg) { Write-Host ("  -> " + $msg) -ForegroundColor DarkGray }
function Write-Ok($msg) { Write-Host ("  OK " + $msg) -ForegroundColor Green }
function Write-Warn($msg) { Write-Host ("  !! " + $msg) -ForegroundColor Yellow }
function Write-Bad($msg) { Write-Host ("  XX " + $msg) -ForegroundColor Red; $script:Failures++ }

function New-HexKey($Bytes) {
  $b = New-Object byte[] $Bytes
  (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($b)
  return ($b | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Read-DotEnv($File) {
  $map = @{}
  if (Test-Path -LiteralPath $File) {
    foreach ($line in (Get-Content -LiteralPath $File)) {
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
        $v = $Matches[2].Trim()
        if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) {
          $v = $v.Substring(1, $v.Length - 2)
        }
        $map[$Matches[1]] = $v
      }
    }
  }
  return $map
}

function Ensure-ApiEnv() {
  $map = Read-DotEnv $ApiEnvFile
  $changed = $false
  if (-not $map.ContainsKey("DATABASE_URL") -or [string]::IsNullOrWhiteSpace($map["DATABASE_URL"])) {
    $dbFile = Join-Path $env:TEMP "opencode\opencrm-dev.db"
    $map["DATABASE_URL"] = "file:" + ($dbFile -replace "\\", "/")
    $changed = $true
  }
  if (-not $map.ContainsKey("JWT_SECRET") -or $map["JWT_SECRET"].Length -lt 16) {
    $map["JWT_SECRET"] = New-HexKey 32
    $changed = $true
    Write-Warn "JWT_SECRET was missing/weak - generated a fresh one (old login tokens are invalid now)."
  }
  if (-not $map.ContainsKey("INTEGRATION_KEY") -or $map["INTEGRATION_KEY"] -notmatch '^[0-9a-fA-F]{64}$') {
    $map["INTEGRATION_KEY"] = New-HexKey 32
    $changed = $true
    Write-Warn "INTEGRATION_KEY was missing - generated one. Previously saved AI provider keys cannot be decrypted and must be re-saved once in Settings."
  }
  if (-not $map.ContainsKey("WEB_URL")) { $map["WEB_URL"] = "http://localhost:3001"; $changed = $true }
  if (-not $map.ContainsKey("API_PORT")) { $map["API_PORT"] = "4000"; $changed = $true }
  if (-not (Test-Path -LiteralPath $ApiEnvFile)) { New-Item -ItemType File -Path $ApiEnvFile -Force | Out-Null; $changed = $true }
  if ($changed) {
    $lines = @()
    foreach ($k in $map.Keys) { $lines += "$k=$($map[$k])" }
    Set-Content -LiteralPath $ApiEnvFile -Value ($lines -join "`r`n") -Encoding Ascii
  }
  return $map
}

function Test-BuildStale() {
  $distMain = Join-Path $ApiDir "dist\main.js"
  if (-not (Test-Path -LiteralPath $distMain)) { return $true }
  $distTime = (Get-Item -LiteralPath $distMain).LastWriteTimeUtc
  foreach ($dir in @("apps\api\src", "packages\shared\src", "packages\db\src")) {
    $p = Join-Path $Root $dir
    if (Test-Path -LiteralPath $p) {
      $newest = Get-ChildItem -LiteralPath $p -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -eq ".ts" } |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
      if ($newest -and $newest.LastWriteTimeUtc -gt $distTime) { return $true }
    }
  }
  return $false
}

function Clear-Port($Port) {
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
      try {
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Step ("Freed port {0} (previous owner PID {1})" -f $Port, $c.OwningProcess)
        Start-Sleep -Seconds 1
      } catch {}
    }
  } catch {}
}

function Wait-Http($Url, $Seconds, $WantOk) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    try {
      $r = Invoke-RestMethod -Uri $Url -TimeoutSec 3
      if (-not $WantOk -or $r.ok) { return $true }
    } catch {}
    Start-Sleep -Seconds 1
  }
  return $false
}

function Wait-Web($Url, $Seconds) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $Url -TimeoutSec 4 -UseBasicParsing
      if ($r.StatusCode -eq 200) { return $true }
    } catch {}
    Start-Sleep -Seconds 2
  }
  return $false
}

function Invoke-Step($Title, [scriptblock]$Body) {
  Write-Step $Title
  try { & $Body }
  catch {
    Write-Bad ($Title + " FAILED: " + $_.Exception.Message)
    throw
  }
}

# -- doctor: checks only, changes nothing -------------------------
function Invoke-Doctor() {
  Write-Host "== OpenCRM doctor ==" -ForegroundColor Cyan
  $ok = $true
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { Write-Bad "node not found on PATH (install Node 18+)"; $ok = $false }
  else {
    $ver = ((& node --version) -replace "^v")
    $major = [int]($ver.Split(".")[0])
    if ($major -lt 18) { Write-Bad "node $ver too old (need >= 18)"; $ok = $false } else { Write-Ok "node $ver" }
  }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Write-Bad "npm not found"; $ok = $false } else { Write-Ok "npm present" }
  if (-not (Test-Path (Join-Path $Root "node_modules"))) { Write-Warn "root node_modules missing (launcher will npm install)" } else { Write-Ok "dependencies installed" }
  $map = Read-DotEnv $ApiEnvFile
  if (-not $map.ContainsKey("JWT_SECRET") -or $map["JWT_SECRET"].Length -lt 16) { Write-Warn "JWT_SECRET missing/weak in apps/api/.env (launcher will generate)" }
  elseif ($map["JWT_SECRET"] -eq "dev-secret-change-me" -or $map["JWT_SECRET"] -eq "dev-secret-change-me-in-prod") { Write-Warn "JWT_SECRET is the public dev default - fine locally, never use in production" }
  else { Write-Ok "JWT_SECRET set" }
  if (-not $map.ContainsKey("INTEGRATION_KEY") -or $map["INTEGRATION_KEY"] -notmatch '^[0-9a-fA-F]{64}$') { Write-Warn "INTEGRATION_KEY missing in apps/api/.env (launcher will generate)" } else { Write-Ok "INTEGRATION_KEY set" }
  if (Test-BuildStale) { Write-Warn "API dist is stale/missing (launcher will rebuild)" } else { Write-Ok "API dist is fresh" }
  foreach ($p in @($ApiPort, $WebPort)) {
    $busy = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($busy) { Write-Warn ("port {0} is busy (launcher will free it)" -f $p) } else { Write-Ok ("port {0} free" -f $p) }
  }
  try {
    $h = Invoke-RestMethod -Uri ("http://localhost:{0}/api/health" -f $ApiPort) -TimeoutSec 3
    if ($h.ok) { Write-Ok "API already running and healthy" } else { Write-Warn "API responded but not ok" }
  } catch { Write-Step "API not running (that is fine - launcher will start it)" }
  if ($ok) { Write-Host "Doctor: ready to launch." -ForegroundColor Green } else { Write-Host "Doctor: problems found above." -ForegroundColor Red }
  return $ok
}

# -- main flows ---------------------------------------------------
function Start-ApiService($ApiEnv) {
  Clear-Port $ApiPort
  $env:DATABASE_URL = $ApiEnv["DATABASE_URL"]
  $env:JWT_SECRET = $ApiEnv["JWT_SECRET"]
  $env:INTEGRATION_KEY = $ApiEnv["INTEGRATION_KEY"]
  $env:WEB_URL = $ApiEnv["WEB_URL"]
  $env:API_PORT = $ApiEnv["API_PORT"]
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "title OpenCRM API && node --max-old-space-size=4096 apps/api/dist/main.js" -WorkingDirectory $Root | Out-Null
  Write-Step "API starting in its own window (logs stay visible)..."
  if (-not (Wait-Http ("http://localhost:{0}/api/health" -f $ApiPort) 60 $true)) {
    Write-Bad "API did not answer /api/health within 60s - read the red text in the 'OpenCRM API' window."
    throw "API failed to start"
  }
  Write-Ok ("API healthy at http://localhost:{0}/api" -f $ApiPort)
}

function Start-WebService() {
  Clear-Port $WebPort
  $env:NEXT_PUBLIC_API_URL = "http://localhost:4000/api"
  $webEnv = Read-DotEnv $WebEnvFile
  if ($webEnv["NEXT_PUBLIC_API_URL"] -ne "http://localhost:4000/api") {
    Set-Content -LiteralPath $WebEnvFile -Value "NEXT_PUBLIC_API_URL=http://localhost:4000/api`r`n" -Encoding Ascii
  }
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k", ("title OpenCRM Web && cd apps\web && set NEXT_PUBLIC_API_URL=http://localhost:4000/api && npx next dev -p {0}" -f $WebPort) -WorkingDirectory $Root | Out-Null
  Write-Step "Web starting in its own window (first boot compiles, ~30-60s)..."
  if (-not (Wait-Web ("http://localhost:{0}" -f $WebPort) 120)) {
    Write-Bad "Web did not answer within 120s - read the 'OpenCRM Web' window."
    throw "Web failed to start"
  }
  Write-Ok ("Web live at http://localhost:{0}" -f $WebPort)
}

try {
  if ($Mode -eq "doctor") { if (Invoke-Doctor) { exit 0 } else { exit 1 } }
  if ($Mode -eq "stop") {
    Write-Host "== OpenCRM stop ==" -ForegroundColor Cyan
    Clear-Port $ApiPort
    Clear-Port $WebPort
    Write-Ok "ports 4000/3001 freed"
    exit 0
  }

  Write-Host "== OpenCRM launcher ==" -ForegroundColor Cyan

  Invoke-Step "Checking node + npm" {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "node not found on PATH - install Node.js 18+ from https://nodejs.org" }
    $major = [int]((((& node --version) -replace "^v")).Split(".")[0])
    if ($major -lt 18) { throw ("node major version {0} too old - need 18+" -f $major) }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm not found on PATH" }
  }

  $needApi = ($Mode -eq "all" -or $Mode -eq "api")
  $needWeb = ($Mode -eq "all" -or $Mode -eq "web")
  if (-not $needApi -and -not $needWeb) { throw "Unknown -Mode '$Mode' (use all|api|web|doctor|stop)" }

  Invoke-Step "Ensuring dependencies" {
    if (-not (Test-Path (Join-Path $Root "node_modules"))) {
      Write-Step "node_modules missing - running npm install (one-time, a few minutes)..."
      & npm install --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    }
  }

  [hashtable]$script:apiEnv = @{}
  Invoke-Step "Ensuring API config (apps/api/.env)" { $script:apiEnv = Ensure-ApiEnv }

  if ($needApi) {
    Invoke-Step "Syncing database schema (prisma generate + db push)" {
      $env:DATABASE_URL = $script:apiEnv["DATABASE_URL"]
      & npx prisma generate --schema="$SchemaFile"
      if ($LASTEXITCODE -ne 0) { throw "prisma generate failed" }
      & npx prisma db push --schema="$SchemaFile"
      if ($LASTEXITCODE -ne 0) { throw "prisma db push failed - database file may be locked or the schema drifted (back up the .db and retry)" }
    }
    $stale = Test-BuildStale
    if ($Rebuild -or $stale) {
      Invoke-Step "Building API (sources changed since last build)" {
        & npm run build --workspace=api
        if ($LASTEXITCODE -ne 0) { throw "API build failed" }
      }
    } else {
      Write-Ok "API build is fresh - skipping (use -Rebuild to force)"
    }
    Invoke-Step "Starting API" { Start-ApiService $apiEnv }
  }

  if ($needWeb) {
    Invoke-Step "Starting Web" { Start-WebService }
  }

  if (-not $NoBrowser -and ($Mode -eq "all" -or $Mode -eq "web")) {
    Start-Process ("http://localhost:{0}" -f $WebPort) | Out-Null
    $browserNote = "  (opened in your browser)"
  } else {
    $browserNote = ""
  }

  Write-Host ""
  Write-Host "OpenCRM is LIVE:" -ForegroundColor Green
  if ($needApi) { Write-Host ("  API : http://localhost:{0}/api/health" -f $ApiPort) }
  if ($needWeb) { Write-Host ("  Web : http://localhost:{0}{1}" -f $WebPort, $browserNote) }
  Write-Host "  Tip : re-run this any time - it heals ports, schema, builds and secrets automatically." -ForegroundColor DarkGray
  exit 0
}
catch {
  Write-Host ""
  Write-Host ("LAUNCH FAILED: " + $_.Exception.Message) -ForegroundColor Red
  Write-Host "Fix the line above and run again. 'doctor' mode only checks:  scripts\launch.ps1 -Mode doctor" -ForegroundColor Yellow
  exit 1
}
