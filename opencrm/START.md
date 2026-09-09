# OpenCRM - how to run

## One click (recommended)

Double-click **`START-OpenCRM.bat`**. It automatically:

1. Checks Node 18+ and npm, installs dependencies if missing.
2. Creates/fixes `apps/api/.env` (database path + generated secrets - never hardcoded).
3. Syncs the database schema and rebuilds the API when sources changed.
4. Frees ports 4000/3001 (only their current owners - nothing else is touched).
5. Starts the API and the Web in their own windows (they stay open on errors).
6. Waits for real health responses, then opens http://localhost:3001 in your browser.

Re-running it any time is safe - it heals instead of duplicating.

Old names (`START.bat`, `START-MS.bat`, `start-opencrm.cmd`, `START.ps1`,
`start-all.ps1`) all delegate to the same engine, so existing habits keep working.

## Single services

- API only: `start-api.ps1` (or engine `-Mode api`)
- Web only: `start-web.ps1` (or engine `-Mode web`)

## Diagnose / stop

- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\launch.ps1 -Mode doctor`
  checks versions, ports, secrets, build freshness without changing anything.
- `... -Mode stop` frees ports 4000/3001.
- `... -Rebuild` forces a clean API rebuild.
- Logs: API/Web print into their own windows; watchdog (optional) logs to
  `%TEMP%\opencrm-watchdog.log` and restarts anything that stops answering.

## Manual (experts only)

```powershell
$env:DATABASE_URL  = "file:C:/Users/moham/AppData/Local/Temp/opencode/opencrm-dev.db"
$env:JWT_SECRET    = "<64-hex from apps/api/.env>"
$env:INTEGRATION_KEY = "<64-hex from apps/api/.env>"
npx prisma db push --schema="packages/db/prisma/schema.prisma"
npm run build --workspace=api
node apps/api/dist/main.js            # :4000
npx next dev -p 3001                  # :3001 (from apps/web)
```

## If it fails

1. Run doctor mode (above) - it names the exact problem.
2. A red FATAL at API boot means a secret is missing - the launcher generates
   these automatically, so this only happens with manual starts.
3. "Port busy" that will not clear: `... -Mode stop`, then launch again.
4. Never `taskkill /F /IM node.exe` - that kills unrelated Node work on your PC.
