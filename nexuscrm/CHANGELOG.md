# CHANGELOG

Format per AI_DEVELOPMENT_CONSTITUTION.md §8: date · one-line description · files touched · tests added · risk level. Newest first.

---

## 2026-08-31 — RELEASE v0.0.1.4 "AGENTIC BUILD LOOP": AI Testing Agent + debugger + build loop + version control (Phase 1, slide 3)

Implements the "agentic development loop" (prompt→plan→build→inspect→test→detect→fix→re-test) that separates a basic AI builder from a great one. Adds `testSiteHtml()` (26 checks across structure/a11y/perf/SEO/responsive/content → status/score/categories), `debugSiteHtml()` (broken anchors, tag balance, duplicate ids, missing alt/width-height/lang, silent buttons, document.write, mixed http, JSON-LD), `autoFixSite()` (keep exactly one h1, eager hero image, ensure h2), and a capped `runAgenticLoop()`. New `POST /api/ai/agentic-build`, `GET /api/sites/:id/test`. New AI Version Control: `site_versions` table + snapshot/list/restore/delete endpoints. Builder gains 🚀 Agentic Build (report + preview), site rows gain 🧪 Test and ⏱ Snapshot / ↩ Versions. 3D stays on **our curated library** (AI never invents a scene, per your instruction).

Files: `backend/src/index.js`, `backend/schema.sql`, `NexusCRM_V4_Hardened.html`, `tests/test_agentic.mjs` (23/0), `tests/run_all.mjs`, `tests/test_aurora.mjs`. Version: `v0.0.1.4`.
Risk: low — deterministic, additive; full battery green except pre-existing network `test_deploy_studio`.

---

## 2026-08-31 — RELEASE v0.0.1.3 "BLUEPRINT ENGINE": deterministic content-plan + industry detection + no-AI site composition (Phase 1, slide 2)

Second builder slice — makes a generated site coherent and complete with **no AI
key**. Adds `detectIndustry()` (19 curated industries), `buildContentPlan()`
(deterministic hero/services/stats/why/process/reviews/FAQ/contact + real
phone/email extraction + merging of a scanned plan, handling `services[].desc`,
`reviews[].text`, `why_us[]` strings, `process[].desc`, `faqs[]`), and
`renderSectionsHtml()` (up to 17 `.nx-*` sections with `data-reveal`, every
string escaped — a `<script>alert(1)</script>` name is inert). New builder
toggle **"🧩 Build from Blueprint (no AI)"** sends `deterministic:true`; backend
`generateSiteHtml` gained `opts.deterministic` (skips the model) and now composes
the Blueprint floor when the model returns junk/empty. Result runs through the
v0.0.1.2 Quality Engine → no-AI and garbage-model sites are both content-rich
**and** A/B-grade (audit ≥ 70).

Files: `backend/src/index.js`, `NexusCRM_V4_Hardened.html`, `tests/test_blueprint.mjs`
(29/0), `tests/run_all.mjs`, `tests/test_aurora.mjs`. Version: `v0.0.1.3`.
Risk: low — additive, deterministic, no AI dependency; full battery green except
pre-existing network `test_deploy_studio`.

---

## 2026-08-31 — RELEASE v0.0.1.2 "QUALITY ENGINE": deterministic site audit + enhancement for the AI website builder (Phase 1, slide 1)

First slice of the "go big" masterpiece program — a zero-dependency **Website
Quality Engine** that every AI-built site is pushed through. Adds
`auditSiteHtml()` (SEO 30 / Perf 25 / A11y 20 / Best 15 / Mobile 10 → score +
grade + actionable issues) and an idempotent `enhanceSiteHtml()` that injects
lang/charset/viewport/title/description, Open Graph + Twitter card, robots,
theme-color, color-scheme, font preconnect, JSON-LD structured data, emoji →
inline-SVG favicon, lazy+alt images, `rel=noopener`, and a base
a11y/mobile layer (only when no `<style>`) — measured **33 F → 85 A (+52)** on a
bare page, idempotent, ceiling 88 A. Wired into the preview modal (live grade
chip + 🔬 Audit report + ⚡ Optimize), the site list (🔬 Audit card action), and
rammed through the backend `generateSiteHtml` + `aiBuildSite` with a new
`GET /api/sites/:id/audit`.

Files: `NexusCRM_V4_Hardened.html`, `backend/src/index.js`, `tests/test_site_quality.mjs`
(38/0), `tests/run_all.mjs`. Version: `v0.0.1.2`.
Risk: low — additive, idempotent, deterministic (no AI re-call), full battery
green except pre-existing network-dependent `test_deploy_studio`.

---

## 2026-08-31 — RELEASE v0.0.1.1 "NEXUS 2.0": data-safety + accessibility + performance + AI-resilience overhaul

Full audit + hardening pass over the whole app (not a patch):
- **Data safety** — versioned local DB (`DB_SCHEMA_VERSION = 2`): `healWorkspace()` fills missing arrays/scalars, `migrateDB()` heals + compacts + stamps `__v` idempotently, `snapshotDBForMigration()` backs up pre-migration data, `estimateDBBytes()` + `checkStorageHeadroom()` warn before the ~5 MB quota silently drops a save, `flushSave()` wired to `pagehide`/`beforeunload`, and `importAllData()` migrates + surfaces save failures. Files: `NexusCRM_V4_Hardened.html`.
- **Accessibility** — modal `role=dialog`/`aria-modal`, focus trap + Escape-close + focus restore; `decorateA11y()` labels icon-only `[title]` controls (empty OR pure emoji/symbol text, `\p{L}`-safe for non-Latin labels) and `.modal-close`, sets sidebar/main landmark roles, creates a polite `#a11y-live` region; toasts announce into it via `textContent`. Files: `NexusCRM_V4_Hardened.html`.
- **Performance** — `esc()` now has a bounded (~4k) memo; measured ~3.2× faster with byte-identical output. Files: `NexusCRM_V4_Hardened.html`.
- **AI resilience** — `streamProviderDirect()` races each provider read against a 30s stall watchdog so a hanging SSE can't spin forever. Files: `NexusCRM_V4_Hardened.html`.
- **Version** — `APP_VERSION='v0.0.1.1'`, sidebar shows "Nexus 2.0". + `CHANGES-v0.0.1.1.md`, rebuilt `NexusCRM_v0.0.1.1.zip` + `GITHUB-UPLOAD-PACK-v0.0.1.1.zip`.

Tests added: `test_benchmark.mjs` (24), `test_xss_injection.mjs` (32), `test_overhaul.mjs` (42) — registered in `tests/run_all.mjs`; `test_aurora.mjs` version assert updated.
Battery: 22 suites · 61/61 routes. Risk: low (layered additions; all 21 local suites + route coverage green; the sole red `test_deploy_studio` item is a network-dependent Cloudflare probe that 400s in the no-internet sandbox, pre-existing and unrelated).

---

## 2026-08-30 — HOTFIX v0.0.0.0.9: gallery scope bug + honest relay errors

Operator bug reports, both real and both fixed:
1. **"SPLINE_SCENES is not defined"** — the 50-scene library was injected
   INSIDE the local-API handler function, so the picker worked but the 3D
   Scene Gallery crashed. Moved to top level; the build script now injects
   at a top-level anchor (and its backend stage became idempotent — it had
   silently failed since the threeSceneScript signature change, leaking 3
   blank lines per run). Regression tests added: the gallery now renders
   after a FULL app load in jsdom (test_frontend), plus a static top-level
   anchor check (test_spline_scenes).
2. **Misleading "provider error (502)"** — when the local relay cannot reach
   the provider, its honest message ("Could not reach the AI provider —
   check your internet connection") now reaches the user instead of a
   generic 502. Note: in the hosted preview sandbox this is expected — the
   sandbox has no internet; on your own machine with the zip, NVIDIA NIM
   works.

Battery: 18 suites · 1,264 checks · 0 failures · 61/61 routes.

---

## 2026-08-30 — COMMAND PALETTE + FULL IMPROVEMENT CYCLE (v0.0.0.0.8)

Cycle delivered: upgrade → add the most valuable missing feature → harden →
test everything → polish. Battery: **18 suites · 1262 checks · 0 failures ·
61/61 routes.**

### ⌨️ Command Palette (Ctrl+K) — every feature one keystroke away
The old global search only jumped to Contacts on Enter. Now it is a real
palette: live fuzzy results across contacts, deals and tasks grouped under
"Your data", plus 27 quick actions (navigate anywhere, new contact/deal/task,
3D Scene Gallery, export, CSV import, deploy…) grouped under "Actions".
Full keyboard navigation (↑↓ wrap-around, ↵ run, esc close), XSS-proof
rendering (every user datum escaped — verified with a poisoned contact
name), result caps (8 data + 6 commands), 80-char query cap, closes on
navigation. Legacy behavior preserved: plain Enter still searches contacts.

### Hardening of the new feature (18 dedicated checks)
test_cmdk.mjs extracts the REAL palette code from the shipped HTML and
exercises it: fuzzy scoring, keyboard semantics, XSS escaping, caps,
action reachability (Invoices, 3D Gallery, Deploy).

### Everything re-verified
18 suites / 1262 checks / 0 failures / 61-of-61 routes covered; HTML
script block parses; version bumped to v0.0.0.0.8 (sidebar proof).

---

## 2026-08-30 — 3D SCENE GALLERY + AI HARDENING CYCLES 41-80 (v0.0.0.0.7)

Operator follow-up: "the changes have not been applied" — root cause: the
work exists in this workspace only; the user's GitHub main/local copy still
has the baseline. Fixed with a visible verification surface + a downloadable
bundle, plus 40 MORE hardening cycles. Battery: **17 suites · 1,244 checks ·
0 failures · 61/61 routes.**

### ✨ 3D Scene Gallery (new sidebar view)
All 50 designs are now impossible to miss: a dedicated gallery with 9-family
filters, a big LIVE interactive WebGL preview (the exact scene code that
ships in generated sites), editable-words input for the 8 text scenes (any
language), and a "Use in Site Builder" jump that pre-selects the scene.

### AI hardening cycles 41-80 (details: AI_HARDENING.md)
- Local relay (server.js): per-IP rate limiting (40/min), security headers,
  content-type allowlist, URL caps, CORS preflight, endless-stream hard cut,
  process-level crash safety nets.
- Worker: key-decryption failures get a distinct honest `encryption` class;
  Anthropic-style + OpenAI machine-code error bodies classified correctly;
  system-prompt cap.
- Browser: client-side circuit breaker (3 fails → 60s cooldown per provider),
  stream usage accounting, paste-trimmed key inputs, hardened proxy-URL
  validation.
- 3 real regressions caught and fixed by the hardening loop itself (keep-alive
  upload race, error-class collision, orphaned-test-server poisoning).

### Files
`NexusCRM_V4_Hardened.html` · `server.js` · `backend/src/index.js` ·
`patches/{add-gallery.py,harden-server2.py,harden-frontend2.py}` (applied) ·
`tests/{test_ai_hardening,test_local_ai_proxy}.mjs` · `AI_HARDENING.md`
Risk level: LOW (full battery green before and after).

---

## 2026-08-30 — 50 SPLINE-STYLE 3D SCENES + 40 AI HARDENING CYCLES (v0.0.0.0.6)

Operator asks: ~50 new professional, highly-animated, fully-3D interactive
designs from the two approved Spline collections (each >100 remixes), plus
40 real hardening cycles on the AI provider layer with honest reporting.
Battery: **17 suites · 1,219 checks · 0 failures · 100% route coverage.**

### The 50-scene WebGL library (Site Builder → 3D Scene)
- 50 original real-time three.js scenes in 9 style families pulled from the
  most-remixed community designs: particles (incl. the 73,714-remix
  Particles 🌑 sphere), liquid/glass, liquid-gold & chrome typography,
  reactive orbs, boxes/cloner fields, scroll-float parallax, retrofuturism,
  web3 cores, holographic earth. All mouse-interactive, phone-scaled (Q
  factor + DPR clamp), reduced-motion safe.
- **8 editable-text scenes** (liquid gold ⭐, liquid chrome, distorting wave,
  flying orbit, neon grid, text rain, morph rings, golden block): the owner
  types the words in the builder — same animation, any language (verified
  with Arabic/CJK), 30-char cap, NEXUS fallback.
- Source of truth `patches/spline-scenes.src.mjs`; rebuild both ships with
  `node patches/build-spline-scenes.mjs` (validated + idempotent — proven
  byte-identical on re-run by test_spline_scenes).
- Wired end-to-end BOTH ways: picker optgroup "🌀 Spline Community" with ✍️
  text-scene markers, live preview, local no-backend generation, and full
  backend support — `scene_text` flows POST /sites → theme JSON → regenerate
  → `threeSceneScript(scene, sceneText)`.
- **Real bug caught & fixed by the new tests:** the frontend's global
  `__NXTX__` token replace also rewrote the fallback condition — text scenes
  would have rendered "NEXUS" instead of the user's words. Now
  first-occurrence replace (backend already was).

### 40 AI hardening cycles (details: AI_HARDENING.md)
- Backend: SSRF/base-URL guards at save AND request time, key-shape
  validation (header-injection proof), response size caps (2 MB), ProviderError
  echo cap, per-workspace burst limiter, history caps, single-flight model
  fetches, and the temperature=0 / digest-hour=0 `|| default` bug class.
- Frontend: API keys NEVER enter export files, save-time validation parity,
  offline pre-flight, in-flight ceiling, bounded retry with Retry-After
  respect (non-streaming + pre-first-byte), SSE line cap, token usage
  accounting into the "Tokens Today" card.
- Local relay (server.js) fully proven by a real-server suite: allowlist,
  path rules, forwarding, SSE piping, 512 KB body cap, zero key leakage.
- 3 new suites (test_ai_hardening 38 · test_local_ai_proxy 19 ·
  test_spline_scenes 36) wired into the battery; the cycles themselves found
  and fixed unrealistic test keys and a too-tight burst limit — evidence the
  program works.

### Files
`NexusCRM_V4_Hardened.html` · `backend/src/index.js` · `server.js` (tested) ·
`patches/{spline-scenes.src,build-spline-scenes}.mjs` · `patches/harden-{backend,frontend}.py` (one-shot, applied) ·
`tests/{test_ai_hardening,test_local_ai_proxy,test_spline_scenes}.mjs` · `AI_HARDENING.md`
Risk level: LOW (all additive guards; full battery green before and after).

---
: the deploy button is now REAL (Deploy Studio)

Operator report: "most of the options in the settings has many problems…
especially the ai providers section and the cors one… the [deploy] button did
not work at all as if it was just for show." Correct — it WAS for show: the
in-app button only navigated to text saying "close the app and double-click
Start-NexusCRM". This round makes it genuinely one-click and hardens the
whole Settings surface. Battery: 14 suites, 1,126 checks, 0 failures.

### Deploy Studio (Settings → System → "Deploy my backend now")
- **Option A — one click:** the app asks the bundled local server to run the
  battle-tested `backend/auto-deploy.js` (wrangler) and streams its live
  step-by-step progress into the modal (`--json-status` + `/api/deploy/status`).
  The only operator action is clicking Allow once in the Cloudflare login window.
- **Option B — API token:** full REST deploy orchestrated from the app through
  a new same-origin `/api/cf` proxy in server.js (Cloudflare's API blocks
  browser CORS — verified — so the proxy is the only honest path): token
  verify → auto account discovery (multi-account picker) → D1 find-or-create
  (reuse, never duplicate) → whole schema.sql applied in ONE batched D1 query
  → multipart worker upload (metadata + real module source; bindings: D1 `DB`
  + `ENCRYPTION_KEY` secret_text) → workers.dev URL enable → `*/5` cron →
  live /health verify → auto-connect with normalized URL. Token: memory-only,
  never stored, never logged (tested). ENCRYPTION_KEY: generated 256-bit,
  reused across redeploys from the same browser so saved AI keys never become
  undecryptable.
- **CORS proxy auto-deploy:** Settings → AI Providers → Fix Connection now
  deploys the proxy worker via the same machinery and auto-fills its URL —
  the manual copy-paste-into-dashboard path remains only as fallback.
- **file:// honesty:** opened as a file, the modal explains the CORS physics,
  offers a generated Deploy-Backend-Now launcher download, and never shows a
  button that cannot work.
- server.js: new `/api/backend-source`, `/api/schema-source`,
  `/api/cors-proxy-source`, allowlisted `/api/cf/*` proxy (30s timeout,
  graceful offline 502), `/api/deploy/start|status`.

### Settings validation bugs fixed (V11) — all found by audit, all regression-locked
1. **Backend URL without `/api`** showed 🟢 Online (worker answers /health at
   root) while EVERY real call 404'd — now auto-normalized with an
   explanatory toast; garbage URLs rejected outright.
2. **Temperature 0 was impossible** (`||0.7` coercion) — deterministic AI
   output now persists as 0.
3. **Negative daily cap silently became UNLIMITED** — the exact opposite of
   intent; now blocks the save with the reason.
4. **Digest hour NaN passthrough** (`parseInt('') ?? 13` → NaN) — now
   validated 0–23.
5. **proxy_url / SMTP from_email unvalidated** — scheme + format checks;
   plain-http remote proxies rejected (would leak keys).
6. `dsConnect` depended on a rendered input — could silently CLEAR the
   backend URL instead of connecting (found by the new test suite).

### New suite: `tests/test_deploy_studio.mjs` (93 checks)
Full Cloudflare REST simulator (scripted network): happy-path orchestration
with exact call-shape assertions (metadata/bindings/module = the real
backend source), D1 create-vs-reuse, multi-account picker, bad-token and
upload-failure honesty, cron-failure tolerance, health retry, key reuse,
token-never-persisted, one-click spawn+poll path, CORS proxy auto-deploy,
file:// honesty, all V11 validation cases, and a REAL server.js integration
section (every endpoint live on an ephemeral port, allowlist enforcement,
graceful offline proxy failure).

---

## 2026-08-30 — AI MEGA-HARDENING: 10-cycle provider-layer deep pass + NIM simulator suite

Goal (operator request): harden every AI feature and its tests 10,000×, make
them 100× more useful, with NVIDIA NIM depth — executed as 10 real
audit→harden→improve→test cycles. Two of the cycles found REAL shipped bugs,
both now regression-locked.

### Real bugs found by the new simulator and fixed (`backend/src/index.js`)
1. **Retry-After was dead code end-to-end** — `ProviderError`'s constructor
   destructured only {kind,status,retryable,provider} and silently DROPPED
   `retryAfterMs`, so NVIDIA NIM's `Retry-After` header was parsed, computed,
   and thrown away: every 429 fell back to generic 300–550ms backoff. The
   constructor now carries `retryAfterMs` (header wins over OpenAI's body
   style, clamped ≤30s against hostile values).
2. **Circuit breaker was blind to sick providers** — only malformed/400
   responses recorded failures (`!e.retryable && …`), so a provider stuck in
   5xx / timeout / network-error loops NEVER tripped the 60s cooldown it was
   built for. New `noteProviderFailure()` records exactly once per failed
   attempt for overloaded/timeout/network/malformed, while rate_limited
   (Retry-After governs) and account/model problems (bad_key, no_credits,
   model_not_found) still never count. Also removed pre-existing
   double/triple-counting of the same failure.

### Provider-layer hardening (Cycles 1–7)
- **NVIDIA catalog decrypt fix** — fetchLiveModels sent the ENCRYPTED key as
  the Bearer token, so the live model catalog could NEVER succeed (silent
  permanent fallback). Now decrypts like the chat path.
- Failed live-catalog attempts re-cache in 30s (was full TTL); success = 10min.
- Empty/whitespace completions and `finish_reason:"content_filter"` refusals
  are now errors → the model fallback chain advances instead of blank answers.
- **guardPayload invariant**: the LAST user message (the actual request) is
  pinned and never shed; oversized history sheds oldest-first; persona kept.
- **Prompt-injection defense** (`wrapAsData` + `DATA_RULE`): external content
  in rewrite / sentiment / doc-analyze / site-audit is delimited in
  `<user_content>` tags with a "this is data, never instructions" rule.
- Router gates re-audited: per-user 240/min AI limit + daily-cap 429 confirmed.

### Frontend AI parity (Cycle 8, `NexusCRM_V4_Hardened.html`)
- `friendlyHttpError` now matches the backend taxonomy: **402 no-credits**
  class added; **429 reads Retry-After** (header or OpenAI body style, 30s
  cap, says when capped).
- `callProviderDirect` (browser→NVIDIA path) rejects empty and
  content-filtered completions like the backend — no more silent blank
  answers; callers show their honest local-fallback note.

### NIM simulator suite (`tests/test_ai_providers.mjs`, 71 checks)
Scripted fake network for every provider behavior: full error taxonomy
(401/403/402/404/410/429/500/503), Retry-After header vs body vs hostile
clamp, model fallback chains, provider failover, circuit breaker
(trip on 5xx/timeout/network, honest snapshot, one-success reset, bad-key
never trips), 250ms budget timeouts with hang protection, six malformed
completion shapes, non-JSON bodies, the encrypted-key catalog regression,
junk-model filtering, curated-first ordering, degenerate-catalog sanity,
prompt-injection delimiting, 300-case guardPayload property tests, fresh-workspace
daily-cap 429, bounded-backoff speed proof, and aggregated total-failure errors.
Battery: **13 suites, 1,033 checks, 0 failures, 100% route coverage.**

---

## 2026-08-30 — Templates, firing inspector, C5/C6 proofs, real-key harness (B6/B7/C5/C6 + key infra)

- **B6 workflow templates** — 6 one-click starter presets for local businesses (Home Services, Review Engine, No-Show Rescue, Form Fast-Response, honest manual WhatsApp, Link-Click Nurture). Every install goes through the SAME wfValidate guard as AI designs; rendered on the empty-state page + Templates modal.
- **B7 firing inspector** — per-workflow "🔍 Why?" button: explains PAUSED vs armed-and-waiting vs fired-N-times, shows last 10 runs with status/detail, and explains exactly what each trigger needs to fire. Operators no longer guess why an automation sat silent.
- **C5 /social proven** — status whitelist honesty (garbage → draft), PATCH semantics, ISO timestamp validity, cross-tenant 404s.
- **C6 /sub-accounts proven** — parent/child isolation: lists never leak across tenants, foreign read/patch/delete all 404, /stats reflects only own accounts, all records survive attack.
- **Real-NVIDIA harness** (`tests/test_real_nvidia.mjs`) — runs the ACTUAL provider layer against the real NVIDIA API with the operator's key: /ai/settings encryption proof, /ai/health?refresh=1 real verdict, /ai/complete round-trip, live catalog, plus a leak guard (scans every tracked file for `nvapi-…` — fails if the key ever touches a committed file) and console-leak detection. Key enters via gitignored `.nvidia-test-key` or NVAPI_KEY env var; never printed, never committed; suite skips cleanly when absent. NOTE: this sandbox has no outbound internet, so the real-API calls run on the OPERATOR's machine — the harness prints a key-free verdict to paste back.
- Battery: 12 suites, 953 checks, 0 failures, 100% route coverage.

---

## 2026-08-30 — EXTREME HARDENING + industrial test battery + UX honesty (post-v0.0.0.0.5)

Goal: the product must survive real multi-business scale. Every fix below
was FOUND by new test infrastructure, reproduced, fixed, regression-locked.

### 5 real vulnerabilities fixed (`backend/src/index.js`, `NexusCRM_V4_Hardened.html`)
1. **Stored XSS via JS-string breakout** — 48 inline `onclick` sites passed user data through `escAttr` alone; entities decode at attribute-parse, so a contact named `Evil');…;//` executed JS on Email-click (reproduced). New `jsAttr()` (JSON.stringify + escAttr) guards all 48; exploit proven inert.
2. **POST /sites crashed 500** on two paths (TDZ variable shadow + unguarded `.slice`) — fuzzer find.
3. **/ai/insights/dashboard 500'd on EVERY call** (destructuring bug) — a shipped route that never once worked; coverage-gate find.
4. **Cross-tenant DELETE lied**: 12 handlers returned `ok` for foreign ids. Now atomic rows-affected checks → honest 404; exactly ONE racer wins a delete storm.
5. **Rate-limiter race**: 30 concurrent requests all passed a cap of 15. Atomic conditional-UPDATE rewrite with bounded retry.

### Reliability hardening
Global per-IP + per-token rate limits · two-layer body-size guard (chunked-proof) · non-object JSON bodies → clear 400 · token shape validated before D1 · sanitized 500s with correlation refs · `/messages/*` subpaths 404 · A4 instant-honest CORS pre-flight (no more 10s hangs) · A5 60s backend auto-recovery detection · A6 manual Test bypasses the health cache (`?refresh=1`).

### B4: workflow preview gate
AI designs → human-readable preview ("When a new contact is created → 1. Send email…") with Accept / Edit (validated through the same wfValidate the backend uses) / Reject. Nothing is saved before approval.

### Test battery: 926 checks, 11 suites, 100% route coverage
`test_isolation.mjs` (101 cross-tenant checks) · `test_fuzz.mjs` (24 checks / ~1430 hostile requests, seeded) · `test_concurrency.mjs` (23 storm checks) · `test_route_coverage.mjs` (coverage closer) · `run_all.mjs` = `npm test` with ENFORCED route coverage (any untested route fails the build) · XSS behavioral regression incl. the actual exploit · brittle live-NVIDIA check now skips honestly.

Risk: **Medium** — auth parser, rate limiter, 12 DELETE handlers, 48 onclick sites and the workflow-save flow changed; all covered by the battery above.

---

## 2026-08-30 — v0.0.0.0.5 session: one-click auto-deploy launcher, auth proven, automation brain rebuilt (Steps 1–2)

Three units, all tested, in dependency order:

### Unit 1 — One-click backend auto-deploy (the user cannot deploy manually)
- Files: `backend/auto-deploy.js` (new), `Start-NexusCRM.bat`, `start-nexuscrm.command`, `server.js`, `NexusCRM_V4_Hardened.html`, `.gitignore`, `tests/test_deploy.mjs` (new), `DEPLOY.md`, `SETUP.md`
- The launcher now deploys the Cloudflare backend AUTOMATICALLY before the app opens: marker + live `/health` check = never a redundant deploy; D1 database REUSED (never duplicated); `ENCRYPTION_KEY` generated once and reused forever (saved AI keys never become undecryptable); live health verification before success is claimed. Free `*.workers.dev` address — **no domain purchase needed ($0)**, stated explicitly in the UI and docs.
- `GET /api/deployed-backend` on the local server + one-click "Use this backend" in Settings → System (no copy-pasting URLs). App version stamped **v0.0.0.0.5**.
- Tests: `test_deploy.mjs` — 44 checks (idempotency, resource reuse, failure safety, real server.js integration). A test-isolation bug (shorthand `fs2` instead of `fs: fs2` silently falling back to the REAL filesystem and leaking state into `backend/`) was caught with a file canary + stack instrumentation, fixed, and permanently guarded by leak checks in the suite.
- Risk: **Low** — deployer is fake-wrangler-tested only until the human's first real launch (verification checklist below).

### Unit 2 — /auth/logout + /auth/demo proven (roadmap Step 1, HIGH-RISK auth)
- Files: `tests/test_backend.mjs`
- Both routes were already correct; 19 new adversarial checks now PROVE it: token rejection after logout, token-specific destroy, method enforcement, demo workspace isolation (empty start, cross-tenant 404, no write leakage), per-IP rate limit (429), and cron purge (aged demo fully deleted, main workspace survives).
- Test-harness fix: `worker.scheduled()` defers via `ctx.waitUntil()` and returns instantly — tests must capture and await that promise; the old CRON SAFETY check passed only because it was trivially true.
- Risk: **Low** — test-only change.

### Unit 3 — Automation brain rebuild (roadmap Step 2, company-grade)
- Files: `backend/src/index.js`, `NexusCRM_V4_Hardened.html`, `tests/test_ai_robustness.mjs` (new)
- The workflow-builder prompt taught only 6/8 triggers and 4/5 actions, with no CRM context, no examples, no repair. Now: full vocabulary with per-item explanations, grounding in the user's real CRM counts + pipeline stages, 2 worked examples, a strict never-throwing validator, ONE repair pass (capped at 2 provider calls), and an honest keyword fallback (`live:false` + `reason`). Frontend direct-mode builder got full parity (it previously saved UNVALIDATED trigger values from the model). Sentiment degradation is now labeled `live:false` — the suite caught that a no-JSON reply was silently presented as a live AI verdict, fixed.
- Tests: `test_ai_robustness.mjs` — 76 checks, ZERO new npm deps (randomized-loop property tests per project rule): golden/repair/cap/provider-down paths, 10 adversarial drafts, 400-random-draft validator totality, 300-random-goal fallback validity, 200-random-confidence clamping, prompt vocabulary grep-proofing, usage tracking, jsdom frontend parity.
- Full battery: **754/756** (2 pre-existing NVIDIA live-catalog drift checks, unchanged from baseline).
- Risk: **Medium** — AI builder behavior changes (better outputs, stricter validation); sentiment response adds `live`/`reason` fields (backward compatible).

### ⏳ PENDING HUMAN VERIFICATION (gates Step 0 closure + all chat/voice work)
1. Double-click **Start-NexusCRM** → answer `y` to the one-click deploy offer
2. App opens → Settings → System → the auto-detected backend appears → click **"Use this backend"**
3. Register a NEW account (backend accounts are separate from local ones)
4. Settings → AI Providers → paste NVIDIA key → **Test Connection**
5. Expect: "🟢 Testing through: Server" + `nvidia ✅` (or a specific key error — never a CORS sentence in backend mode). Paste the result to close out Step 0.

---

## 2026-08-30 — STEP 0 (NVIDIA/CORS): /ai/health can no longer crash on undecryptable keys; mode-honest AI connection UI
- Files: `backend/src/index.js`, `NexusCRM_V4_Hardened.html`, `tests/test_backend.mjs`, `tests/test_frontend.mjs`
- Bugs fixed:
  (1) **The "key not read" root cause** — worker `pingProvider()` called `providerRequest()` (which decrypts the stored key) BEFORE checking whether a key exists, and its try/catch only wrapped the network call. With ENCRYPTION_KEY missing or rotated, `decryptSecret()` threw and the exception escaped and crashed the ENTIRE `/ai/health` route with an opaque 500 → the operator saw "Test failed: …" with no per-provider detail. Now: `hasKeyFor()` runs first (no decrypt work when no key), each provider's test is fully isolated, decrypt failures return a distinct `kind: 'encryption'` status whose message says exactly what to do (`wrangler secret put ENCRYPTION_KEY`), and the route itself has a last-resort try/catch so Test Connection ALWAYS returns a structured, renderable response.
  (2) **Mode-blind AI UI** — nothing told the operator WHICH path AI requests take, so an architectural browser-CORS block looked identical to a broken key. Added `aiModeInfo()` (one source of truth: server / proxy / browser), a connection-mode box in Settings → AI Providers, a mode-aware Test button label ("via server" / "via proxy" / "from browser"), a "Testing through: …" header on the Test modal, and explicit handling of the new `encryption` kind in both the modal and the after-save toast.
- Tests added: `test_backend.mjs` V9.2 — 4 checks (route returns 200 with an undecryptable stored key; nvidia reports `kind:'encryption'` not a crash/bad_key; other providers unaffected; message names ENCRYPTION_KEY). `test_frontend.mjs` STEP 0 section — 9 checks (aiModeInfo reports browser/backend/proxy modes correctly; button label follows mode; mode box renders in settings in both local and server modes).
- Full battery: **613/615 passing** (2 pre-existing live NVIDIA-catalog drift checks unchanged — NVIDIA retired models after the threshold was written).
- Risk: **Medium** — touches the AI health route and the settings UI; behavior change fully covered by the battery. No schema change, no new dependency, no secret in the diff.

---
## 2026-08-29 — Governance setup: constitution, changelog, setup docs, git baseline
- Files: `AI_DEVELOPMENT_CONSTITUTION.md` (new), `CHANGELOG.md` (new), `SETUP.md` (new), `.gitignore` (new)
- Tests added: none (documentation-only change)
- Risk: **Low** — no executable code touched

## 2026-08-29 — Honest feature status report (evidence-based, 602-check basis)
- Files: `FEATURE_STATUS.md` (new)
- Tests added: none (report only; includes route-coverage diff findings)
- Risk: **Low**

## 2026-08-29 — Webchat AI replies now persist to CRM inbox; SSE streams terminate on [DONE]; circuit-breaker cross-tenant poisoning fixed
- Files: `backend/src/index.js`
- Bugs fixed: (1) SSE pumps stalled after `[DONE]` → every chat/webchat message leaked an unclosed stream; (2) webchat AI replies were never stored in `messages` (inbox showed only visitor side; visitor memory broken); (3) `bad_key`/`no_credits`/`model_not_found` cooled down the GLOBAL provider health → one tenant's bad key broke AI for all tenants (6 recording sites fixed via `isProviderHealthIssue()`)
- Tests added: `tests/test_deep.mjs` S6 regression (dead model must not cool provider), S9 webchat reply-in-inbox; `tests/test_webchat_widget.mjs` reply-persistence check (16→17)
- Risk: **Medium** — touches AI streaming + workflow-adjacent code; fully covered by 602-check battery

## 2026-08-29 — Deep verification suite (multi-tenant isolation, journeys, live NVIDIA catalog proof)
- Files: `tests/test_deep.mjs` (new, 78 checks)
- Risk: **Low** (test-only)

## 2026-08-27 — SSRF fix, error taxonomy (UserError→400), live model catalog hardening, launcher/deploy scripts
- Files: `backend/src/index.js`, `NexusCRM_V4_Hardened.html`, `tests/test_backend.mjs`, `tests/test_edge_cases.mjs` (new), `Start-NexusCRM.bat` (new), `start-nexuscrm.command` (new), `backend/deploy.sh` (new), `backend/deploy.bat` (new), `README.md`
- Bugs fixed: SSRF hole in `/ai/analyze-site`; 12 non-chat models leaked into dropdown; all `/ai/*` validation errors misreported as 502; empty prompt sent to AI; false "live catalog ✅" UI claim
- Risk: **Medium** — security fix + AI route behavior change; covered by 50-check adversarial suite + full battery

## 2026-08-26 — Dead-model emergency fix + missing deploy files + test infrastructure
- Files: `backend/src/index.js`, `NexusCRM_V4_Hardened.html`, `backend/schema.sql` (new — reconstructed from worker SQL), `backend/wrangler.toml` (new), `tests/d1mock.js` (hybrid engine), `tests/test_backend.mjs` (2 assertions updated to new default model), `DEPLOY.md`
- Bugs fixed: default model `meta/llama-3.1-8b-instruct` hit NVIDIA end-of-life (410) → new default `nvidia/llama-3.1-nemotron-70b-instruct` (verified live); 9/14 dropdown models retired → rebuilt from live catalog; 410 surfaced as opaque "Provider error 410" → clear end-of-life message; backspace control char in `prettyModelName` regex (legacy patch-script corruption)
- Risk: **High** (at the time) — model defaults + schema reconstruction; fully validated: 473→602 checks green
