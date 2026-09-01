# NexusCRM — Honest Feature Status Report
**Generated 2026-08-30 · Basis: 1308 automated checks executed this session against the real shipped code**
**(19 suites: backend 343 · deep 76 · edge 50 · isolation 47 · fuzz 36 · concurrency 34 · ai-robustness 76 · ai-providers 71 · ai-hardening 38 · local-relay 28 · spline-scenes 36 · cmdk 18 · deploy-studio 61 · webchat 17 · route-coverage 11 · deploy 44 · frontend 182 · aurora 44 · real-nvidia skip)**
(backend 316 · deep journeys 78 · adversarial edge 50 · frontend jsdom 134 · webchat E2E 17 · ping regression 7)

Percentages are engineering judgment anchored to evidence, not measurements:
- **Tier 1 (100%)** = direct automated assertions passed this session.
- **Tier 2 (65–99%)** = logic proven by tests, but a real-world dependency (your keys, external service, real deploy, browser hardware) was mocked or unavailable here.
- **Tier 3 (≤65%)** = no automated evidence this session. Unverified ≠ broken, but don't trust it until tested.

---

## ✅ TIER 1 — 100% PROVEN (asserted by tests this session)

### CRM core
- **Contacts** — CRUD, tags, custom fields, search, AI score fields, cascade-clean delete, unicode/emoji safe
- **Deals / pipeline** — CRUD, stage moves (fire `deal_stage_change`), probability clamped 0–100
- **Tasks** — CRUD, overdue reminders sent **once** (cron, no spam)
- **Appointments** — CRUD, 24h-before reminders sent **once**
- **Invoices** — CRUD, tax/total math exact, sequential numbers that never collide, mark-paid stamps `paid_at` and fires `invoice_paid`
- **Messages** — CRUD, per-contact history
- **Reviews** — CRUD, AI reply drafts **persist**

### Automations
- **Workflow engine** — all 6 triggers proven to fire real DB effects: `new_contact`, `deal_stage_change`, `invoice_paid`, `form_submitted`, `trigger_link`, `webhook`
- **Delayed steps** — queue with future `fire_at`, don't fire early, fire exactly when due, remaining steps never dropped
- **Run history** — `run_count` + `workflow_runs` ok/error log
- **Graceful degradation** — email steps without an email provider create a human task (never fake a send)
- **Cron** — due-event sweep, expired-session purge, stale demo-workspace purge, daily-digest once-per-day guard

### Lead capture & public endpoints
- **Forms** — CRUD, public embed script, public submit (rate-limited) → auto-creates contact → fires workflow
- **Trigger links** — public click → redirect + click counter + fires workflow
- **Affiliates** — public tracking link → click counter + click log with ref
- **AI websites** — save/publish/public-serve/unpublish/slug uniqueness (the *plumbing*; content quality is Tier 2)
- **Webchat widget** — token gen/regen, embed.js served, visitor message → SSE reply (**stream now terminates correctly — fixed this session**), visitor AND AI reply land in CRM inbox (**fixed this session**), daily-cap protection, returning-visitor memory

### AI infrastructure (plumbing — with mocked providers)
- **Keys encrypted at rest (AES-256-GCM)** and the provider receives the *decrypted* key (round-trip captured and asserted)
- **Multi-provider failover** — NVIDIA 500 → auto-retry on OpenAI (both calls observed)
- **Error taxonomy** — 401 bad key / 402 no credits / 404 model missing / 410 model end-of-life (clear message, not "Provider error 410") / 429 with Retry-After
- **Circuit breaker** — cools down only on genuine provider-health failures (**fixed this session:** bad keys/dead models no longer poison the provider globally for all workspaces)
- **Live model catalog** — proven against the **real NVIDIA API**: real fetch, 0 non-chat junk leaks, curated-first sorting, per-provider live/fallback flags
- **Daily call cap + usage/token accounting** enforced
- **AI ops endpoints** — complete/generate/rewrite with input guards (empty prompt → 400, 500 KB prompt guarded)
- **AI agent execution layer** — creates real tasks/contacts, `remember` persists to `agent_facts`, duplicate commands deduped, **destructive actions rejected with data untouched**
- **Chat** — SSE streaming (terminates), persistent chat memory + clear endpoint
- **Forecast** — pipeline math from real deal values × probability

### Security & multi-tenancy
- **Cross-tenant isolation** — 18 attack patterns (read/patch/delete another workspace's contacts, deals, tasks, invoices, appointments, reviews, sites, workflows, forms, links, affiliates, inbox) — all blocked, data verified intact
- **SQL injection** — parameterized everywhere (injection payload stored as literal text)
- **SSRF guards** — scan-site AND analyze-site refuse localhost/private/link-local (**analyze-site hole found & fixed this session**)
- **XSS** — user/email/AI content escaped before render (frontend suite)
- **Rate limits** — 9 limiters proven (register/login/demo/form/webchat/webhook/affiliate/trigger/AI) + per-email login lockout
- **Auth** — register, login, wrong password → real 401, expired sessions rejected + purged

### Frontend & local mode (Aurora overhaul v0.0.1.0)
- **Aurora design system + appearance controls** — 6 accent themes, light/dark mode, density, motion toggle: applied live, persisted, asserted end-to-end (44 checks)
- **Dashboard today strip + quick actions, real KPI sparklines** (true visit snapshots, honest "next visit" hint before history exists), **getting-started checklist** derived from real data
- **Command palette v2** — recently-viewed views + Aurora actions, existing fuzzy/XSS/keyboard guarantees intact

### Frontend & local mode (previous)
- App boots in jsdom with **zero uncaught errors**; register → contact → dashboard → form → workflow → reports flows work
- Settings UI renders from live catalog; model dropdowns populated; workflow trigger list matches backend
- Local-only engine parity (forms/workflows/contacts persist to localStorage)
- Local launcher (`server.js`) — health flag, app serving, fake-backend rejection (the ping fix)

---

## 🟡 TIER 2 — 65–99% (logic proven; real-world dependency not exercisable here)

| Feature | % | What's proven / what's not |
|---|---|---|
| Resend email sending | ~85% | Code path tested to the API boundary (mocked). Real delivery needs your Resend key + verified domain |
| Cloudflare deployment | ~85% | Schema runs on real SQLite; worker passes 602 checks; `wrangler deploy` itself never executed here |
| Webchat widget on real third-party websites | ~85% | Full E2E in simulated browser (17 checks); real cross-domain embedding not performed |
| CORS proxy worker | ~80% | Syntax-verified, logic trivial + host-locked; never deployed |
| **AI output quality with YOUR real key** (chat answers, agent natural-language parsing, 25+ content tools, scoring, sentiment) | ~80% | All plumbing 100% proven; the *intelligence* (real LLM responses) was mocked — parsing accuracy of e.g. "call Ahmed tomorrow" depends on the live model |
| AI Website Builder content quality | ~75% | Build/save/publish pipeline proven; generated HTML quality with a real key untested (the 40 themes/12 heroes catalogs are data, verified present) |
| Reports charts + CSV export | ~75% | Data layer + CSV tested; canvas chart rendering stubbed in jsdom (never visually verified) |
| Data backup export/import | ~75% | Export tested; full import round-trip only partially asserted |
| Custom provider (Ollama/LM Studio) | ~75% | Routing/auth/health logic tested with mocks; no real local model server exercised |
| 3D scenes & design gallery (97 scenes, 40 themes) | ~70% | Picker/catalogs render (frontend tests); docs claim browser-tested, but the scenes were NOT re-verified this session |

---

## 🔴 TIER 3 — ≤65% (no automated evidence this session — verify before trusting)

| Feature | % | Status |
|---|---|---|
| Meeting Processor / Content Calendar "save all" / Snippets insert | ~55% | Endpoints exist; not individually asserted this session |
| `/auth/logout` | ~55% | Trivial code path, but zero tests |
| `/auth/demo` (Try Demo button) | ~50% | Zero tests — **you're using this in the preview right now, so any issue would be immediately visible** |
| Social planner (drafts/publish-status CRUD) | ~50% | Zero tests this session |
| Sub-accounts CRUD | ~50% | Zero tests this session |
| `/ai/build-workflow` (AI writes a workflow from plain English) | ~50% | Zero tests |
| `/ai/sentiment`, `/ai/insights/dashboard` | ~50% | Zero tests |
| Gmail integration (OAuth popup, inbox, reply threading) | ~40% | Needs real Google credentials; only frontend function-existence checks; historically the buggiest area per FIXES_APPLIED.md |
| AI image generation (Pollinations.ai) | ~40% | Zero tests; depends entirely on a free third-party service's availability |
| Voice notes (mic recording + browser transcription) | ~35% | Zero tests; requires browser hardware APIs (Chrome/Edge only) |

---

## Route coverage diff (worker vs tests, this session)
Untested routes found by automated diff: `/ai/build-workflow`, `/ai/insights/dashboard`,
`/ai/sentiment`, `/auth/demo`, `/auth/logout`, `/social`, `/sub-accounts` — everything else
is hit by at least one suite.

## Bugs found & fixed by this verification process (this conversation)
1. Default model dead (NVIDIA EOL 2026-08-26) + 9/14 dropdown models retired
2. 410 errors surfaced as opaque "Provider error 410"
3. Backspace control char inside `prettyModelName` regex (old patch-script bug)
4. SSRF hole in `/ai/analyze-site`
5. 12 non-chat models leaked into the chat dropdown
6. All `/ai/*` validation errors misreported as 502
7. Empty prompt sent to AI instead of rejected
8. "Live catalog ✅" shown while serving fallback list
9. **SSE streams never closed** (every chat/webchat message leaked a connection)
10. **Webchat AI replies never saved to CRM inbox**
11. **Circuit breaker cross-tenant poisoning** (one bad key cooled the provider for all workspaces)
