# OpenCRM runbook

## Quick start
```powershell
# 1. One-time DB setup (create schema)
npx prisma db push --schema=".\packages\db\prisma\schema.prisma"

# 2. Start API (foreground)
powershell -File .\start-api.ps1         # port 4000

# 3. Start web (foreground, separate terminal)
powershell -File .\start-web.ps1         # port 3001
```

Open http://localhost:3001 in your browser.

## Verifying the AI provider (NVIDIA)
The app reads `nvapi-*` keys. For NVIDIA:
1. Get key at https://build.nvidia.com
2. Settings → AI Model → Provider "NVIDIA NIM" → paste key → Save → Test
3. If the key has free NIM entitlements, generation will work. Otherwise you'll get a helpful error.
4. The fallback generator always renders a usable page even if AI is unavailable (never hangs).

## Features included
- Multi-tenant: agencies → sub-accounts → contacts/funnels
- Page editor with sections/rows/columns/blocks, undo/redo (Ctrl+Z/Y), inline text editing
- AI generation with themes/design systems (152 systems, 114 templates from Open Design)
- 📞AI element editing (edit selected block via natural language)
- Publications (funnel pats), public previews, and a model catalog pull from the AI provider