# OpenCRM - start API only (delegates to the one-click engine).
& (Join-Path $PSScriptRoot "scripts\launch.ps1") -Mode api @args
exit $LASTEXITCODE
