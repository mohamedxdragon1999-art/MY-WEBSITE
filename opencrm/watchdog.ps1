# OpenCRM watchdog: keeps API + Web alive by delegating restarts to the launcher engine.
# Run as: powershell -NoProfile -ExecutionPolicy Bypass -File .\watchdog.ps1
# (Add -WindowStyle Hidden to run it invisibly. Stop it with Ctrl+C.)

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Root) { $Root = Get-Location }
$Engine = Join-Path $Root "scripts\launch.ps1"
$LogFile = Join-Path $env:TEMP "opencrm-watchdog.log"

function Log($msg) {
  $ts = Get-Date -Format "HH:mm:ss"
  Add-Content -Path $LogFile -Value ("[" + $ts + "] " + $msg)
}

function Test-Url($url) {
  try {
    $r = Invoke-WebRequest -Uri $url -Method Get -TimeoutSec 5 -UseBasicParsing
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

Log "watchdog started"
Write-Host "OpenCRM watchdog running (log: $LogFile). Ctrl+C to stop." -ForegroundColor Cyan
while ($true) {
  if (-not (Test-Url "http://localhost:4000/api/health")) {
    Log "API down - restarting via launcher engine"
    Start-Process -FilePath "powershell" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $Engine, "-Mode", "api", "-NoBrowser" -WindowStyle Hidden | Out-Null
  }
  if (-not (Test-Url "http://localhost:3001")) {
    Log "Web down - restarting via launcher engine"
    Start-Process -FilePath "powershell" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $Engine, "-Mode", "web", "-NoBrowser" -WindowStyle Hidden | Out-Null
  }
  Start-Sleep -Seconds 20
}
