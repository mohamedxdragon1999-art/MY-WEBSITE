# OpenCRM - start Web only (delegates to the one-click engine).
& (Join-Path $PSScriptRoot "scripts\launch.ps1") -Mode web @args
exit $LASTEXITCODE
