# OpenCRM launcher (legacy name) - delegates to the one-click engine.
& (Join-Path $PSScriptRoot "scripts\launch.ps1") @args
exit $LASTEXITCODE
