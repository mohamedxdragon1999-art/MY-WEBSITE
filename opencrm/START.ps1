# OpenCRM launcher (legacy name) - delegates to the one-click engine.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File .\START.ps1
& (Join-Path $PSScriptRoot "scripts\launch.ps1") @args
exit $LASTEXITCODE
