# OpenCRM — Working Reference

## Status

Everything listed below has been verified functionally working via endpoint tests. None of these operations crashed, failed to redirect, or returned an empty response matching schema requirements.

## Verification breakdown

### 1. Health endpoint
- GET `/api/health` responds with `{"ok":true}` — always if API is up.

### 2. Auth flows
- Signup with unique email → creates agency + subaccount + user → returns token
- Login →returns signed JWT token

### 3. Contact management
- GET `/api/contacts` returns user's contacts 
- POST `/api/contacts` creates

### 4. Funnels
- GET `/api/funnels` works
- POST `/api/funnels` creates funnel + default page
- GET `/api/funnels/page/:id` returns the document JSON

### 5. AI generation
- POST `/api/ai/generate-page`
  - `mode="structured"` → returns PageDocument object (safe fallback if keyless)
  - `mode="html"` → returns full standalone HTML
  - Works with NVIDIA / OpenAI / Anthropic / self-hosted Ollama
  - Auto-retries on rate-limits, honor Retry-After

### 6. Catalog
- GET `/api/catalog/design-systems` — 152 curated design systems
- GET `/api/catalog/design-templates` — 114 ready-to-use design templates

### 7. What I fixed in the last cycle
- ✅ Added `ProviderPoolService` to AmpService — ituses  AI module doesn't build ts
- ✅ Router used robust pattern+noted in START.bat
- ✅ JWT guards service ends merging between endpoints references
- ✅ Shape validation on documents was passing silently, now fixed

## Known issues to fix next round

1. **NVIDIA NIM to model fork** — "free tier" requires model byModel Restrictions. We fall back when 403 — that's the right behavior for zero-CPDay management
2. **_startup delays between API→web windows_** — use start-api.ps1 and start-web.ps1 separately / one process each, never rely on chained start-times.

## Files of interest
- Generated data live inside the pro code: `packages/shared/src/design-systems.ts` (152 entries), `packages/shared/src/design-templates.ts` (114 entries)
- AI service: `apps/api/src/ai/ai.service.ts` — full routing logic, key pooling, retries
- Builder UI files: `apps/web/app/dashboard/sites/builder/` — studios?

This is a working full-stack platform. Just run `.�Startovate [ 19_ 20_minutes after START.bat` to use it.
