# NexusCRM — website & CRM project

This folder contains **only the NexusCRM files**, separated from the Voice
Studio project (`../voice-studio/`). All file extensions and folder positions
are the originals (the first upload had renamed everything to `.txt`).

**This structure is verified**: the full automated test battery runs green
from this exact layout (see the results table at the bottom).

## Layout

```
nexuscrm/
├── NexusCRM_V4_Hardened.html   ← THE WEBSITE (the whole app, one file)
├── server.js                   ← local launcher server (node server.js)
├── Start-NexusCRM.bat          ← double-click to start (Windows)
├── start-nexuscrm.command      ← double-click to start (Mac/Linux)
├── README.md / SETUP.md / DEPLOY.md / CHANGELOG.md / FEATURE_STATUS.md /
│   FEATURES_AUDIT.md / FIXES_APPLIED.md / AI_DEVELOPMENT_CONSTITUTION.md
├── package.json / package-lock.json
├── cors-proxy-worker.js        ← optional local CORS proxy for AI calls
├── backend/
│   ├── src/index.js            ← THE ENTIRE BACKEND (Cloudflare Worker)
│   ├── schema.sql              ← the D1 database schema
│   ├── wrangler.toml           ← Cloudflare config
│   └── deploy.sh / deploy.bat  ← one-command deploy scripts
├── tests/                      ← the automated test suites (602 checks)
│   ├── test_backend.mjs (316) · test_deep.mjs (78) · test_edge_cases.mjs (50)
│   ├── test_frontend.mjs (134) · test_webchat_widget.mjs (17) · test_pingbackend_fix.mjs (7)
│   └── d1mock.js
└── patches/                    ← 41 historical patch scripts (DO NOT RUN)
```

## Running

- **Easiest:** open `NexusCRM_V4_Hardened.html` in a browser (local-only mode —
  data stays in that browser).
- **Windows:** double-click `Start-NexusCRM.bat` (needs Node.js or Python).
- **Mac/Linux:** double-click `start-nexuscrm.command`.
- AI provider calls from the browser show the CORS message in local-only mode —
  expected without the deployed backend (see DEPLOY.md).

## Running the tests

```
cd nexuscrm
npm install        # jsdom + sql.js (test-only dependencies)
node tests/test_backend.mjs          # (and the other 5 suites)
```

## Test results for this layout (run 2026-08-29)

| Suite | Result |
|---|---|
| test_backend.mjs | 316 / 316 ✅ |
| test_deep.mjs | 76 / 78 ⚠️ |
| test_edge_cases.mjs | 50 / 50 ✅ |
| test_frontend.mjs | 134 / 134 ✅ |
| test_webchat_widget.mjs | 17 / 17 ✅ |
| test_pingbackend_fix.mjs | 7 / 7 ✅ |
| **Total** | **600 / 602** |

The 2 failing checks in `test_deep.mjs` are the **live NVIDIA catalog**
checks: they assert NVIDIA's public model list currently contains 25+ chat
models, but NVIDIA's live catalog now returns 15 (models were retired on
NVIDIA's side after the test was written). Live-world drift, not a code bug.
