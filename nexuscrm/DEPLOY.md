# Deploying the NexusCRM backend (V4.1)

This turns NexusCRM from a browser-only demo into a real, syncable product.
Everything below is free at solo-user scale (Cloudflare's free tier is
generous; Resend's free tier is 3,000 emails/month, 100/day).

Total time: ~15 minutes, once.

## What you'll have accounts on
- **Cloudflare** (Workers + D1) — cloudflare.com, free
- **Resend** (real outbound email) — resend.com, free — optional but
  recommended; without it, everything works except real email sending

## 0. One-command deploy (recommended)
- **Windows:** double-click `deploy.bat`
- **macOS / Linux:** run `./deploy.sh`

Both scripts automate everything below (install wrangler → login → create D1 →
fill the config → apply schema → deploy → print your URL). If you prefer
manual steps, continue:

## 1. Install Wrangler (Cloudflare's CLI)
```bash
npm install -g wrangler
wrangler login
```
This opens a browser to authorize the CLI against your Cloudflare account.

## 2. Get this folder onto your machine
Download/copy the `backend/` folder (this file, `wrangler.toml`,
`schema.sql`, and `src/index.js`) to your computer, then `cd` into it.

> **Note on file names (V4.1):** earlier versions of this project shipped
> files named `wrangler.md` / `schema.Md` — Wrangler only accepts
> `wrangler.toml` and the schema must be `schema.sql` for the command in
> step 4. This folder already has the correct names, and `main` points at
> `src/index.js`, so no renaming is needed.

## 3. Create the D1 database
```bash
wrangler d1 create nexuscrm
```
This prints a `database_id`. Copy it into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_D1_DATABASE_ID`.

## 4. Apply the schema
```bash
wrangler d1 execute nexuscrm --remote --file=./schema.sql
```

## 5. Deploy
```bash
wrangler deploy
```
This prints a URL like `https://nexuscrm-backend.YOUR-SUBDOMAIN.workers.dev`.
**That's your backend URL — copy it.**

## 6. Point the frontend at it
Open NexusCRM in your browser → **Settings → System → Backend URL** →
paste `https://nexuscrm-backend.YOUR-SUBDOMAIN.workers.dev/api` (note
the trailing `/api`) → Save.

Register a fresh account here — accounts made in local-only mode don't
carry over (they were never on a server to begin with). Your local data
isn't lost; use **Settings → Data & Backup → Export** first if you want
to manually re-enter anything important.

## 7. (Recommended) Connect Resend for real email
1. Sign up at resend.com (free)
2. Verify a sending domain, or use their shared `onboarding@resend.dev`
   for testing (limited to sending to your own account's email)
3. Create an API key
4. In NexusCRM → Settings → Email → paste the key, set a From email/name
5. Click "Send Test Email"

Without this step, `/email/send` returns a clear error rather than
silently failing — no email gets faked as "sent."

## 8. (Optional) Custom domain
By default your API lives on `*.workers.dev`. If you want it on your own
domain (e.g. `api.yourbusiness.com`), add a route in the Cloudflare
dashboard under Workers → your worker → Triggers → Custom Domains. Then
use that domain (with `/api`) as the Backend URL in step 6 instead.

---

## What V4.1 fixes / adds (vs the previous version)

**Bugs fixed (verified by automated tests — `tests/` folder):**
- Delayed workflow steps ("3 days later") now fire **on time** — all
  timestamps are stored in one ISO-8601 format; previously a format
  mismatch made steps fire up to 24h late.
- Steps that come AFTER a delayed step are no longer silently dropped —
  the remaining steps are re-queued and run when the delay elapses.
- Overdue-task reminder emails are sent **once per task** (not every
  hour forever) and the daily digest sends **once per day**.
- Wrong passwords now show a real error (401 on login is surfaced, not
  swallowed).
- A configured-but-slow/cold-starting backend no longer silently derails
  the app into localStorage mode — the health timeout is 5s, the app
  re-pings every 15s, and configured backends never fall back to local.
- "Use This Reply" on reviews actually saves the reply (new
  `PATCH /reviews/:id` endpoint + UI).
- API keys can be **cleared** (empty string = remove) — per-provider,
  and all three providers can be configured at once.
- Invoice numbers are sequential and never reused; invoice modal lets
  you pick the contact.
- Contact deletion cascades cleanly (tasks/messages/appointments/deals
  removed, invoices/events detached).
- Gmail OAuth instructions now include the **Authorized redirect URI**
  (the #1 cause of `redirect_uri_mismatch`), and the popup token flow
  uses postMessage so it can't race the app's own URL cleanup.
- Gmail replies thread correctly (threadId, not messageId).
- XSS hardening: every user/email-sourced field (Gmail subjects, senders,
  snippets, HTML email bodies, contact names, AI output) is escaped or
  sanitized before rendering.
- Chat history no longer sends duplicate empty assistant messages to the
  model; chat errors show as messages instead of hanging forever.
- CSV import handles quoted fields with commas.
- Bulk WhatsApp no longer trips popup blockers (link list instead of
  mass `window.open`).

**Security:**
- Rate limiting (register/demo/login by IP; public form submissions and
  affiliate clicks too) + the per-email login lockout.
- Expired sessions and stale demo workspaces are purged by the cron.
- Workflow triggers/actions validated server-side.

**Real features (no more placeholders):**
- **Forms** — build a form, embed it on any website with one line of
  `<script>`, submissions auto-create contacts and can trigger
  automations (`form_submitted` trigger now actually fires).
- **Courses** — create/save/publish courses; AI generates module/lesson
  outlines that are stored, not just displayed.
- **Funnels** — save funnels with stages; AI-designed funnels are
  persisted; view/optimize/delete.
- **Affiliates** — real tracking: each affiliate gets a public tracking
  link (`/api/public/affiliate/go?token=…`), clicks are counted and
  logged.
- **Community** — real posts (create, list, delete).
- **Reports** — pipeline-by-stage and task charts + one-click CSV export
  of everything.
- **AI Command Hub** — 25 tools (landing page copy, product descriptions,
  hashtags, meeting agendas, blog outlines, press releases, job
  descriptions, and an 8-mode text improver via `/ai/rewrite`).

**AI upgrades:**
- **Multi-provider auto-fallback**: configure NVIDIA + OpenAI (and a
  custom OpenAI-compatible server) at once — if the primary provider
  errors or rate-limits, calls automatically retry on the next working
  provider.
- **Retries** on 429/5xx with backoff; clear, specific error messages.
- **Token tracking** in usage reports.
- **Data-aware chat**: every chat and `/ai/complete` call gets a live
  snapshot of your CRM (deals, hot leads, overdue tasks, appointments)
  injected as context — answers are about YOUR business, not generic.
- **Expanded prompt library**: 20+ content types (cold email, follow-up,
  Facebook/YouTube posts, landing pages, press releases, job
  descriptions, meeting agendas…).
- **Strict-JSON parsing** for scoring/sentiment/workflow-building with
  safe fallbacks — no more "score 2" regex misfires.
- All AI calls (including workflow emails and auto-scoring) count toward
  the daily cap and usage logs.

## What's still honestly out of scope
- **WhatsApp still can't be auto-sent.** There's no API that lets a
  server send a WhatsApp message on your behalf without WhatsApp
  Business API (a separate, paid, Meta-run onboarding process). Any
  workflow step that would "send WhatsApp" creates a task reminding a
  human to send it instead of pretending to automate it.
- **Live real-time push (WebSocket) isn't implemented in this Worker** —
  the frontend degrades gracefully without it.
- ~~API keys are stored as plain columns in D1~~ — **fixed:** AI provider
  keys and the Resend key are now encrypted at rest (AES-256-GCM) before
  being written to D1; Settings shows a "🔒 encrypted at rest" badge.

## Running the test suite (optional)
```bash
cd backend/..   # project root
npm install sql.js jsdom   # test-only dependencies
node tests/test_backend.mjs    # 70 integration tests against real SQLite
node tests/test_frontend.mjs   # 25 browser-simulation tests of the UI
```

---

## Upgrading an EXISTING database (schema v2 → v3)

If you already deployed the previous schema, run these once against your D1:

```bash
wrangler d1 execute nexuscrm --remote --command "ALTER TABLE workspaces ADD COLUMN public_token TEXT DEFAULT ''"
wrangler d1 execute nexuscrm --remote --command "ALTER TABLE contacts ADD COLUMN tags TEXT DEFAULT ''"
wrangler d1 execute nexuscrm --remote --command "ALTER TABLE contacts ADD COLUMN custom_fields TEXT DEFAULT '{}'"
wrangler d1 execute nexuscrm --remote --file=./schema.sql   # idempotent — creates the new tables only
```

### Make AI unlimited (0 = unlimited)
The new default is **unlimited AI calls** (`ai_daily_call_cap = 0`). If your
database was created with the older 300-cap default, run:

```bash
wrangler d1 execute nexuscrm --remote --command "UPDATE workspaces SET ai_daily_call_cap = 0"
```

You can also set any number in **Settings → AI Providers → Daily AI call cap**
(0 = unlimited). Unlimited is the recommended setting for free models
(NVIDIA NIM free credits, Ollama, etc.); set a number only if you later move
to a paid key and want a runaway-loop guardrail.

The rest of `schema.sql` is `CREATE TABLE IF NOT EXISTS`, so re-running it is safe.
**If upgrading an existing database to V5 (cycles):**
```bash
wrangler d1 execute nexuscrm --remote --command "ALTER TABLE workspaces ADD COLUMN ai_brand_voice TEXT DEFAULT ''"
wrangler d1 execute nexuscrm --remote --file=./schema.sql   # adds workflow_runs + chat_memory tables
```
(ai_memory_summary is written by the app at runtime — no migration needed.)
**For the latest cycle set (V6):**
```bash
wrangler d1 execute nexuscrm --remote --command "ALTER TABLE workspaces ADD COLUMN agent_facts TEXT DEFAULT '[]'"
wrangler d1 execute nexuscrm --remote --file=./schema.sql   # adds ai_feedback + site_meta tables
```
Note: `site_meta` now includes `theme` and `custom_css` columns — for an
existing V6 database run:
```bash
wrangler d1 execute nexuscrm --remote --command "ALTER TABLE site_meta ADD COLUMN theme TEXT DEFAULT '{}'"
wrangler d1 execute nexuscrm --remote --command "ALTER TABLE site_meta ADD COLUMN custom_css TEXT DEFAULT ''"
```
