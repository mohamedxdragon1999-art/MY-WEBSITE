# SETUP — everything needed to run NexusCRM in a new environment

Per AI_DEVELOPMENT_CONSTITUTION.md §8: no guessing. Every variable, key, and dependency is listed here.

## 1. Requirements
| What | Version | Needed for |
|---|---|---|
| Node.js | ≥ 20 (≥ 22.5 recommended) | Everything. ≥22.5 lets tests use built-in `node:sqlite`; older Node falls back to `sql.js` automatically |
| npm | bundled with Node | Test deps + wrangler |
| Cloudflare account | free tier | Backend (Workers + D1) — optional until you need sync/AI/email |
| Wrangler CLI | latest (`npm i -g wrangler`) | Deploying the backend |

## 2. Run the app locally (no backend — local-only mode)
- **Windows:** double-click `Start-NexusCRM.bat`
- **macOS:** double-click `start-nexuscrm.command`
- **Manual:** `node server.js`

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Local server port |
| `HOST` | `127.0.0.1` | Bind address. **Leave default on your machine.** Only set `0.0.0.0` inside sandboxed preview environments |

Data stays in the browser (localStorage). AI calls are blocked by browser CORS in this mode — deploy the backend to enable AI.

## 3. Deploy the backend (free)
```bash
cd backend
./deploy.sh          # macOS/Linux   (or deploy.bat on Windows)
```
Automates: wrangler install → login → `d1 create nexuscrm` → writes `database_id` into `wrangler.toml` → applies `schema.sql` → deploys.

### Required secret (set once after first deploy)
```bash
wrangler secret put ENCRYPTION_KEY
```
| Secret | Meaning |
|---|---|
| `ENCRYPTION_KEY` | ≥32 chars. Encrypts AI/Resend keys at rest (AES-256-GCM). **Without it, keys are stored in plain text** and Settings shows a yellow warning badge. Never commit this value anywhere |

### Connect the app
Settings → System → Backend URL = `https://nexuscrm-backend.<your-subdomain>.workers.dev/api` (trailing `/api` matters). Register a fresh account after switching.

## 4. External services (all optional, all free tier)
| Service | Key format | Set where | Used for |
|---|---|---|---|
| NVIDIA NIM | `nvapi-…` (build.nvidia.com) | Settings → AI Providers | Primary AI (free) |
| OpenAI | `sk-…` | Settings → AI Providers | Fallback AI provider |
| Custom (Ollama/LM Studio) | any/none | Settings → AI Providers → Custom | Local models |
| Resend | `re_…` (resend.com) | Settings → Email | Real email sending + reminders/digest. Without it, email workflow steps degrade to human tasks (by design — nothing is faked) |
| Pollinations.ai | none | — | Free AI image generation (third-party availability not guaranteed) |
| Google OAuth | client id/secret | Settings → Gmail | Gmail inbox/compose (client-side flow) |

## 5. Running the tests
```bash
npm install sql.js jsdom        # test-only dependencies
node tests/test_backend.mjs         # 316 checks — worker vs real SQLite
node tests/test_deep.mjs            # 78 checks — journeys, isolation, LIVE NVIDIA catalog (needs internet)
node tests/test_edge_cases.mjs      # 50 checks — adversarial inputs
node tests/test_frontend.mjs        # 134 checks — jsdom UI flows
node tests/test_webchat_widget.mjs  # 17 checks — widget E2E
node tests/test_pingbackend_fix.mjs # 7 checks — no dependencies
```
`tests/d1mock.js` auto-selects its SQLite engine (node:sqlite → sql.js fallback).

## 6. Project layout
```
nexuscrm/
├── NexusCRM_V4_Hardened.html      ← the entire app (single file)
├── server.js / Start-NexusCRM.bat / start-nexuscrm.command   ← local launchers
├── backend/
│   ├── src/index.js               ← Cloudflare Worker (all API + AI + automations)
│   ├── schema.sql                 ← D1 schema (idempotent, re-runnable)
│   ├── wrangler.toml              ← deploy config (database_id filled by deploy script)
│   └── deploy.sh / deploy.bat
├── cors-proxy-worker.js           ← optional CORS proxy (local mode + AI)
├── tests/                         ← 6 suites, 602 checks total
├── patches/                       ← 43 historical patch scripts (.py) — records, never run at startup
└── docs: README · DEPLOY · FEATURES_AUDIT · FIXES_APPLIED · FEATURE_STATUS · CHANGELOG · SETUP · AI_DEVELOPMENT_CONSTITUTION
```
