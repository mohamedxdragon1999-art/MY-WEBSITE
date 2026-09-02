# NexusCRM — Improvement & Hardening Roadmap

**Generated 2026-08-30 · Basis: direct code inspection this session + FEATURE_STATUS.md tiers + the Master AI Operating Law roadmap.**
Every item below was observed in the real code — this is not a wishlist, it is a
prioritized audit. Work ONE item-group per session, tests-first, full battery
after each change (per AI_DEVELOPMENT_CONSTITUTION.md).

Status legend: 🔴 blocker-tier · 🟠 high value · 🟡 quality · 🟢 polish

---

## PHASE A — Finish Step 0 (NVIDIA/CORS) — mostly DONE this session

- ✅ **A1. `/ai/health` crash on undecryptable keys** (the "key not read" bug) — FIXED + regression-tested (V9.2).
- ✅ **A2. Mode-honest AI UI** (Server/Proxy/Browser indicator, button label, modal header) — FIXED + tested.
- 🔴 **A3. HUMAN VERIFICATION STILL REQUIRED**: deploy the backend, set Backend URL, register fresh account, paste NVIDIA key, click Test — the fix is only proven when the operator sees `nvidia: ✅` (or a key-specific 401/402/410) through the server path. Until then Step 0 is NOT complete.
- ✅ **A4.** Frontend `pingProvider` pre-flight — DONE: browser-mode nvidia/openai tests fail INSTANTLY with the fix (deploy backend / set proxy) instead of a 10s hang. Regression-tested in test_frontend (V9 hardening section).
- ✅ **A5.** Periodic backend re-check — DONE: 60s interval while the app is open; announces "backend back online" and refreshes when a dead backend revives. No page reload needed.
- ✅ **A6.** `/ai/health?refresh=1` cache bypass — DONE: manual Test Connection always reflects the provider's CURRENT state. Regression-tested (V9.3 in test_backend).

## PHASE A+ — AI provider mega-hardening (10-cycle deep pass) — ✅ DONE 2026-08-30

Operator asked for every AI feature + provider code + tests hardened 10,000×
and upgraded 100×, NVIDIA NIM especially, as 10 audit→harden→improve→test
cycles. All 10 cycles executed; battery grew 953 → **1,033 checks**.

- ✅ **Cycles 1–2 (provider core + NVIDIA specifics)** — 2 REAL bugs fixed:
  `ProviderError` dropped `retryAfterMs` (Retry-After was dead code — now
  honored end-to-end, header over body, 30s clamp), and the circuit breaker
  never tripped on 5xx/timeout/network (now trips via `noteProviderFailure`,
  once per attempt; 429/account/model issues still never count). Plus: catalog
  decrypt fix, 30s failed-catalog re-cache, empty/content_filter completions
  rejected, guardPayload pin-last-user invariant, Retry-After HTTP header read.
- ✅ **Cycles 3–4 (routes + agent safety)** — audited: daily-cap 429 gate,
  per-user 240/min AI limit, workspace-scoped agent actions all confirmed;
  no changes needed.
- ✅ **Cycle 5 (prompt injection)** — `wrapAsData` + `DATA_RULE` delimiting in
  rewrite / sentiment / doc-analyze / site-audit prompts.
- ✅ **Cycles 6–7 (streaming + caps)** — audited: 45s stream first-byte
  timeout, cap clamps confirmed; streaming now also counts 5xx in the breaker.
- ✅ **Cycle 8 (frontend parity)** — browser-direct path matches the backend
  taxonomy (402 no-credits, 429+Retry-After) and rejects empty/content-filtered
  completions instead of returning blank answers.
- ✅ **Cycle 9 (test explosion)** — NEW `tests/test_ai_providers.mjs` (71
  checks): the NIM simulator — full error taxonomy, Retry-After matrix, model
  chains, provider failover, breaker trip/reset/honesty, timeouts, malformed
  shapes, catalog decrypt regression + junk filter + ordering + sanity,
  injection delimiting, 300-case guardPayload property tests, fresh-workspace
  daily-cap, bounded-backoff proof. +9 frontend parity checks (V9b).
- ✅ **Cycle 10 (battery + docs)** — 13 suites, 1,033 checks, 0 failures,
  61/61 routes, ~76s.
- 🔴 **A3 still open (HUMAN VERIFICATION)** — same as below: deploy backend,
  paste NVIDIA key, Test Connection through the server path; then rotate the
  key the operator plans to paste in chat.

## PHASE A+2 — Settings extreme hardening + REAL one-click deploy — ✅ DONE 2026-08-30

- ✅ **The deploy button is real** — Deploy Studio (Settings → System):
  one-click spawn+stream via auto-deploy.js, or full Cloudflare REST deploy
  through the new same-origin /api/cf proxy (verify → account → D1 → schema →
  module upload with DB+secret bindings → workers.dev URL → cron → health →
  auto-connect). CORS-proxy worker auto-deploys the same way. 93-check suite.
- ✅ **Settings validation (V11)** — backend-URL /api normalization (the
  🟢-but-everything-404s trap), temperature-0 fix, negative-cap block,
  digest-hour validation, proxy/SMTP URL checks.
- 🔴 **HUMAN VERIFICATION (operator)**: launch via Start-NexusCRM → Settings
  → System → "Deploy my backend now" → Option A, click Allow once. The
  automated suite proves the orchestration against a scripted Cloudflare;
  the sandbox has no internet, so the first REAL deploy runs on the
  operator's machine.

## PHASE B — The automation brain (`/ai/build-workflow` + workflow engine)

*The owner's #1 stated pain: "the part which we write in it is small."*

**Status update 2026-08-30 (v0.0.0.0.5 session): B1, B2, B5 DONE + regression-proofed (76-check `tests/test_ai_robustness.mjs` — adversarial/property/golden, zero new deps). The Tier-3 route `/ai/build-workflow` now HAS automated tests (was B4's gap). B3/B4/B6/B7 remain open.**

- ✅ **B1. The AI builder prompt is 3 sentences** (backend/src/index.js `aiOpBuildWorkflow`). ~~It exposes only 5 of 8 triggers and 4 of 5 actions, gives no workspace context, no examples~~ — FIXED: full 8-trigger/5-action vocabulary with per-item explanations, workspace grounding (real contact/deal/task counts + pipeline stages), 2 worked examples, strict never-throwing validator, ONE repair pass capped at 2 provider calls, honest `live:false + reason` fallback.
- ✅ **B2. The local-mode fallback is a keyword regex** — UPGRADED: all 8 triggers incl. trigger_link/webhook, review-request keyword, WhatsApp honestly mapped to a human task; frontend direct-mode builder got full parity with validation + repair (previously saved unvalidated trigger values).
- 🟠 **B3. `send_whatsapp` is still a fake-send** — it creates a task telling a human to send it (honest degradation, good), but the AI prompt says "no public API" — correct — yet the ACTION LIST still advertises it to the model. Rename the action `whatsapp_reminder` (task-based) so reports never imply an auto-send happened.
- ✅ **B4. Build-workflow preview** — DONE: AI designs → human-readable preview (Accept / Edit-revalidated / Reject); nothing is saved before approval. Fully driven-tested in test_frontend (B4 section). Route checks: 76.
- ✅ **B5. Delay values are unbounded** — FIXED: validator + sanitizer cap `delay_hours` at 0–720 and property-tested (400 random drafts).
- ✅ **B6. Workflow templates library** — DONE: 6 validated one-click presets (Home Services Starter, Review Engine, No-Show Rescue, Form Fast-Response, honest manual WhatsApp, Link-Click Nurture); every install passes wfValidate; tested in test_frontend.
- ✅ **B7. Firing inspector** — DONE: per-workflow "Why?" button explains paused/armed/fired states, trigger semantics, last 10 runs with errors. Tested in test_frontend.

## PHASE C — Untested Tier-3 routes (tests FIRST, then fixes — roadmap STEP 1-2)

**Status update 2026-08-30 (v0.0.0.0.5 session): C1, C2, C3 DONE — 19 new checks in `tests/test_backend.mjs` + sentiment honesty in `tests/test_ai_robustness.mjs`. Both routes were already implemented correctly; what was missing was PROOF. C4–C7 remain open.**

- ✅ **C1. `/auth/logout`** — PROVEN correct: token rejected (401) everywhere after logout, repeated-logout 401, GET-method not a route, token-specific destroy (other sessions survive). No cookie to clear (Bearer-token auth).
- ✅ **C2. `/auth/demo`** — PROVEN: workspace starts empty, cross-tenant contact read → 404, demo writes never leak into the main workspace, per-IP rate limit 429s, cron purge deletes aged demo workspaces fully while main survives, purged sessions die.
- ✅ **C3. `/ai/sentiment`** — HONEST: failures now return `live:false + reason` instead of silently masquerading as a neutral AI verdict (the suite caught the no-JSON-reply case that the original fix missed); confidence clamping property-tested.
- 🟠 **C4. `/ai/insights/dashboard`** — verify aggregation math, forecast calculations, empty-workspace behavior.
- ✅ **C5. `/social`** — PROVEN: status whitelist honesty, PATCH semantics, ISO timestamps, cross-tenant 404s (test_isolation C5 section).
- ✅ **C6. `/sub-accounts`** — PROVEN: full parent/child isolation matrix (test_isolation C6 section).
- 🟡 **C7.** Hide/disable ALL Tier-3 UI entries that are clickable-but-untested (the law says: HIDE-UNTIL-TESTED).

## PHASE D — Reliability & ops (roadmap STEP 9)

- 🟠 **D1. No CI** — add a GitHub Action: npm install, run all 6 suites, fail the PR on any red. (This alone would have caught the V10 cache-poisoning class of bug.)
- 🟠 **D2. No staging Worker** — `nexuscrm-staging` vs production; the law requires manual staging verification for public-serve changes.
- 🟠 **D3. No uptime checks** on `/health` + one published sample site.
- 🟠 **D4. No D1 backups** — daily backup to R2 + a documented, TESTED restore.
- 🟡 **D5. No error tracking** (Sentry or equivalent) in worker + frontend, PII-free.
- 🟡 **D6.** Live-catalog test threshold (`>=25 models`) is stale vs NVIDIA's current 15 — decide: update threshold or mark as live-world indicator. (The only 2 red checks in the battery.)

## PHASE E — Contractor features (roadmap STEP 3-7, the GHL-killer list)

- 🟠 **E1.** Twilio `send_sms` workflow action + signature verification + STOP/opt-out + graceful task-fallback (STEP 3).
- 🟠 **E2.** Missed-call text-back webhook + contact upsert + inbox log (STEP 4).
- 🟠 **E3.** Review-request template: `invoice_paid` → delay → SMS/email → interceptor page (STEP 5).
- 🟠 **E4.** Website builder integrity: draft/published split, snapshots, sanitizer, edge cache, SSRF audit on ALL URL fetches (STEP 6 / W-protocol).
- 🟠 **E5.** Contractor site blocks: sticky call bar, before/after slider, LocalBusiness JSON-LD, multi-step estimate form, industry templates (STEP 7).
- 🟡 **E6.** Trades pipeline stages preset; lead-source attribution; duplicate contact merge by phone.

## PHASE F — Chat + Voice widgets (the CHAT-1…VOICE-3 addendum, gated)

- 🔴 **F1. GATE**: no voice work until NVIDIA Test is verified green by the human AND webchat is proven on a real third-party domain.
- 🟠 **F2. CHAT-1** widget hardening: domain allowlist + origin check on widget API, token rotation without breaking old embeds, message size caps, markdown-subset sanitizer, offline fallback form, `/ai/sentiment` hidden until C3 done.
- 🟠 **F3. CHAT-2** lead tools + contractor prompts (upsert contact, tag, deal, book appointment, escalate; emergency keyword path with tel:).
- 🟠 **F4. CHAT-3** human takeover (owner reply pauses bot), unread, canned replies, after-hours notify.
- 🟡 **F5. CHAT-4/5** knowledge retrieval, real booking slots, photo upload (R2, never D1), proactive message.
- 🟠 **F6. VOICE-1** turn-based mic in the SAME widget (MediaRecorder → backend STT → same brain → TTS), using Voice Studio's proven engine designs as reference — NOT copy-paste (per owner instruction: the old version had many problems).

## PHASE G — Smaller code-quality items observed this session

- 🟡 **G1.** `phoneLooksIntl()` operator precedence: `a && b || c` — works by accident; parenthesize for clarity.
- 🟡 **G2.** `friendlyHttpError` duplicates the backend's error taxonomy client-side — keep, but add the `encryption` kind mapping for backend 500s carrying that message.
- 🟡 **G3.** Frontend `pingProvider` in local mode tests `custom` only when active — but the UI still renders a "custom:" line with no context; label it "(not configured)".
- 🟡 **G4.** `HEALTH_CACHE` has no size bound — a Worker isolate serving many workspaces could grow it unbounded; cap at ~200 entries (LRU-ish).
- 🟡 **G5.** Docs: SETUP.md should document the new mode indicator + encryption error kind (done for CHANGELOG; SETUP update pending).
- 🟡 **G6.** Add `.github/workflows/tests.yml` placeholder even before D1 lands so the path exists.

---

**How to use this file**: each future session picks ONE phase item-group, prints
the Session Start Checklist, works tests-first, runs the full battery, appends a
CHANGELOG entry, and ticks the item here with the commit hash.
