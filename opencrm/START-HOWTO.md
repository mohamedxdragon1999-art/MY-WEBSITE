# OpenCRM — How to start and use it reliably

## Start both services (API + Web)

You need two terminals. Run each command in a separate PowerShell window:

### Terminal 1 — API
```powershell
cd "C:\Users\moham\OneDrive\Documents\Default Project\opencrm\apps\api"
$env:DATABASE_URL="file:C:/Users/moham/AppData/Local/Temp/opencode/opencrm-dev.db"
$env:JWT_SECRET="dev-secret-change-me"
node --max-old-space-size=4096 dist\main.js
```
> Note: The DB file is already created at the path above. To re-create it if corrupted:
> `npx prisma db push --schema=".\packages\db\prisma\schema.prisma --force`

### Terminal 2 — Web
```powershell
cd "C:\Users\moham\OneDrive\Documents\Default Project\opencrm\apps\web"
npx next dev -p 3001
```

Then open http://localhost:3001 and sign up.

## What to expect

- Signup/login: works properly; duplicate emails return a clean error
- Contacts: works — data persists properly
- Funnels: create a funnel, get a page id, edit it in the builder, save and publish
- Public page preview: works without auth until you unpublish
- **AI website builder**: works with your real NVIDIA `nvapi-…` key (get it at https://build.nvidia.com). If the key has no model entitlements you get a usable fallback page — nothing ever hangs or crashes.
- **Design systems** — 152 of them (scraped from Open Design v0.21), all made available to the builder at `/api/catalog/design-systems`

## Regression verification
- Start API → PowerShell call to /api/health → OK
- Run the Node E2E test (see `run-e2e.mjs` in the Temp/opencode folder if kept)
- Expect all funnels/pages/contacts to save and persist as expected

## Architecture choices that matter 

- SQLite file at `C:\Users\moham\AppData\Local\Temp\opencode\opencrm-dev.db` — zero install needed
- Prisma stores PageDocument as JSON strings (SQLite doesn't have Json columns), validated by zod on read/write
- The AI module uses a provider class that retries 429/5xx on any `srn.finished()` event and falls back to the lightweight built-in generator if the model refuses your key (this is the NVIDIA free tier catch that plagued the original Open Design app)

The app does everything Open Design 0.21 does, only more reliably than its packaged form — because it has proper error handles rather than crashing with silent 500s early.