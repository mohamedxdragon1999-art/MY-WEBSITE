# MUSE SPARK PROGRESS — Backend / Security / Tests / Functionality

> **Sole writer: Muse Spark (backend invisible work). Frontend AI: READ ONLY.**
> **Last updated:** 2026-09-09 ~20:00 UTC — Wave 9 done (UI/UX OVERHAUL: theme resurrected, dead nav removed, real data everywhere, brand unified), web tsc+build clean.
> **OWNERSHIP (user order 2026-09-09): Muse Spark is SOLO on frontend AND backend.** KIMI K3 file kept as read-only reference; no other writer active.
> This file is continuously updated after every change + every test run.
> Frontend AI must read this before touching anything. Backend owns files listed below.

## 0. Ownership & File Locks (DO NOT CROSS)

| Area | Owner | Files / Patterns |
|------|-------|------------------|
| Backend API | Muse Spark ONLY | `apps/api/src/**`, `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/test/**` |
| DB / Prisma | Muse Spark ONLY | `packages/db/**` |
| Shared schema (PageDocument) | Muse Spark ONLY (schema authority) | `packages/shared/src/page-document.ts`, `packages/shared/src/index.ts` |
| Shared catalog data | READ-ONLY for both (frozen) | `packages/shared/src/design-systems.ts`, `design-templates.ts`, `craft-rules.ts`, `master-templates.ts` |
| Frontend UI/UX/visuals | Other AI ONLY | `apps/web/app/**`, `apps/web/components/**`, `apps/web/lib/**`, `apps/web/*.js`, `apps/web/*.css` |
| Coordination log | Muse Spark SOLE WRITER, Frontend READ-ONLY | `MUSE SPARK PROGRESS.md` (this file) |

**Contract — Frontend MUST NOT change response shapes without a REQUEST block below:**
- `GET /api/health` -> `{ok:true, time:number, version:string}`
- `POST /api/auth/signup {email,password>=8,firstName,lastName,agencyName}` -> `{accessToken}` (400 duplicate, 400 validation, 500 only on real server fault)
- `POST /api/auth/login {email,password}` -> `{accessToken}` (401 invalid)
- `GET/POST /api/contacts`, `DELETE /api/contacts/:id` (auth, subAccount-scoped, 404 if not found)
- `GET/POST /api/funnels`, `GET /api/funnels/page/:pageId`, `PATCH /api/funnels/page/:pageId/document {document:PageDocument}`, `POST /api/funnels/page/:pageId/publish`, `GET /api/funnels/public-page/:pageId` (public, minimal fields only)
- `POST /api/ai/generate-page {prompt<=8000,provider,baseUrl,apiKey,model,mode,system}` -> `{document|html, fallback?:boolean, reason?:string, keyUsed?:string}` — 4xx validation errors are thrown, NOT swallowed into fallback. Only 5xx/upstream errors fall back.
- `POST /api/ai/edit-element`, `POST /api/ai/models`, `POST /api/ai/test`, `POST /api/ai/config`, `POST /api/ai/config/keys`, `GET /api/ai/config/keys/:provider`, `GET /api/ai/config`
- `GET /api/catalog/design-systems`, `GET /api/catalog/design-templates`, `GET /api/catalog/health`
- Wave 2 additive (all auth-guarded, subAccount-scoped, backward-compatible — old shapes unchanged):
  `GET /api/auth/me`, `POST /api/auth/change-password`, `GET /api/contacts?q=&skip=&take=` (still returns array),
  `PATCH /api/contacts/:id`, `PATCH /api/funnels/:id` (rename), `DELETE /api/funnels/:id`,
  `POST /api/funnels/:id/clone`, `POST /api/funnels/:funnelId/pages`, `PATCH /api/funnels/page/:pageId` (rename),
  `DELETE /api/funnels/page/:pageId` (refuses to delete a funnel's only page). All responses carry `X-Request-Id`.
- Wave 4 additive (all backward-compatible):
  `POST /api/public/forms/:pageId/submit` (public, 5/min, honeypot spam guard → `{ok:true}`),
  `GET /api/funnels/page/:pageId/versions` (light list `{id,createdAt,bytes}`, max 20),
  `GET /api/funnels/page/:pageId/versions/:versionId` (full doc),
  `POST /api/funnels/page/:pageId/restore/:versionId` (validated restore, snapshots current first),
  `GET /api/ai/usage` → `{used,cap,remaining,resetsAt}`,
  `?envelope=1` on `GET /api/contacts` → `{items,total,skip,take}` and `GET /api/funnels` → `{items,total}` (defaults stay bare arrays).
  `POST /api/ai/generate-page` success is now HTTP 200 (was Nest-default 201) — RPC-style, friendlier for `fetch().ok` checks.
- Wave 5 additive:
  `POST /api/ai/import-url {url,provider?,baseUrl?,apiKey?,model?,mode?,system?}` (10/min) → `{document|html, system?, source:{url,title}, fallback?, reason?, keyUsed?}`. SSRF-guarded fetch (15s timeout, 3 manual redirects re-validated per hop, HTML-only, 1MB cap); empty pages → 502; AI failure → deterministic synthesis from the real brief (never a silent generic fallback).
- Wave 7 additive:
  `PATCH /api/funnels/page/:pageId/meta {title?,slug?,description?}` → `{id,title,slug,seo}` (slug validated + unique per funnel, 409 on clash); `GET /api/funnels/public-page/:pageId` now also returns `slug` + `seo`.
  `POST /api/uploads/image` (multipart `file`, magic-byte verified PNG/JPEG/GIF/WebP ≤5MB, 100 files/account) → `{url,name,size}`; `GET /api/uploads` → `{items,total}`; `DELETE /api/uploads/:name` (strict name regex, scoped dir).
  Published pages now honor tablet (≤1024px) / mobile (≤640px) style overrides via generated media-query CSS, and stack multi-column rows + pricing grids on phones. Preview sets `<title>` + meta description from page SEO.

## 1. WILL DO EXACTLY (staged plan)

- [x] Stage 0: Create this file, lock ownership, publish plan.
- [ ] Stage 1: Baseline — `npm run typecheck`, `npm run build` (api), record results; run smoke script if API boots.
- [ ] Stage 2: Security hardening:
  1. Fail-fast on missing `JWT_SECRET` (no `dev-secret`), fail-fast on missing `INTEGRATION_KEY` (no hardcoded default) in non-test env.
  2. `helmet` headers, strict CORS whitelist (`WEB_URL` split by comma, default `http://localhost:3001`), `app.enableShutdownHooks()`.
  3. Global `HttpExceptionFilter` that redacts `nvapi-*/sk-*/Bearer` from responses/logs.
  4. `ValidationPipe({whitelist:true, forbidNonWhitelisted:true, transform:true})`.
  5. Strict DTOs with `MaxLength` caps: prompt<=8000, instruction<=4000, agencyName<=120, contact fields capped, document size cap 500KB + Zod `safeParse` with 400 on invalid (no silent strip).
  6. Fix `JwtAuthGuard`: populate `agencyId` correctly via subAccount->agency, catch JWT errors as 401, attach `subAccountId`.
  7. Fix signup status: duplicate -> 409/400 (not 500).
  8. Throttle: `@nestjs/throttler` on `ai/generate-page`, `ai/edit-element`, `ai/test`, `auth/login|signup` (e.g. 20/min auth, 10/min ai per IP).
  9. SSRF `validateBase` keep + unit test; block `file://`, `gopher://`, userinfo `@`.
  10. Prisma `DATABASE_URL` required check at boot.
- [ ] Stage 3: Functionality correctness:
  1. Wire `ProviderPoolService` into `AiService` (actually rotate keys) OR delete dead code — will wire it.
  2. Fix `listKeys` (`getPool` missing -> use `getLog` + DB masked list merge).
  3. `FunnelsService.updatePageDocument`: validate size + Zod, return parsed doc (not raw prisma row with string doc).
  4. `ContactsService`: reject empty create (400), `remove` returns 404 if 0 deleted, fix `@Delete(':id')` path.
  5. Fix funnel `path` collision handling (catch P2002 -> retry suffix).
  6. Make AI `generate` throw 4xx (validation/no-config) instead of fallback; fallback only on upstream 5xx/network/AI-empty.
- [ ] Stage 4: Tests — add `jest`+`supertest`+`ts-jest` to `apps/api`, `test/*.e2e-spec.ts`: auth, contacts scoping, funnels doc round-trip + oversize/corrupt rejection, AI validation + SSRF block + redact, security (401s, CORS not tested e2e, ValidationPipe forbid). `npm run test:e2e` must be green.
- [ ] Stage 5: Harden loop — re-run typecheck/build/tests 3x, fuzz corrupt docs, verify no secret leak, append results here.

## 2. WILL CHANGE (files I intend to touch — frontend: do not touch these)

1. `MUSE SPARK PROGRESS.md` (this file) — continuous.
2. `apps/api/package.json` — add `helmet`, `@nestjs/throttler`, `jest`, `supertest`, `ts-jest`, `@types/jest`, `@types/supertest`, test scripts.
3. `apps/api/src/main.ts` — helmet, CORS, filter, throttle, env checks.
4. `apps/api/src/app.module.ts` — register ThrottlerModule.
5. `apps/api/src/common/http-exception.filter.ts` — NEW (redaction).
6. `apps/api/src/common/env-check.ts` — NEW (fail-fast helper, test-bypass via ALLOW_INSECURE_TEST).
7. `apps/api/src/auth/auth.module.ts` — remove dev-secret default, require env.
8. `apps/api/src/auth/auth.controller.ts` — preserve 400/409 statuses.
9. `apps/api/src/auth/auth.service.ts` — normalize email, cap lengths.
10. `apps/api/src/auth/jwt-auth.guard.ts` — fix agencyId, 401 mapping.
11. `apps/api/src/contacts/contacts.controller.ts` + `contacts.service.ts` — validation, 404, path fix.
12. `apps/api/src/funnels/funnels.controller.ts` + `funnels.service.ts` — strict DTO, size cap, Zod validate, path retry.
13. `apps/api/src/ai/ai.controller.ts` — throttles, DTO caps, 4xx passthrough (no fallback swallow).
14. `apps/api/src/ai/ai.service.ts` — wire pool, length caps, encrypt fail-fast, redact, SSRF harden.
15. `apps/api/src/ai/provider-pool.ts` — add `getPool()` accessor, fix logger, expose MAX_FAILS, use it.
16. `apps/api/test/*.e2e-spec.ts` + `jest.e2e.json` — NEW.
17. `packages/shared/src/page-document.ts` — ONLY if needed: add `MAX_DOCUMENT_BYTES` export + `safeParseDocument()` helper (no shape change without frontend note).

## 3. HAVE CHANGED (append-only)

### 2026-09-08 — Stage 0
- Created this file. No code changed yet.
- Baseline audit completed (read-only): confirmed 12 backend issues listed in plan (JWT default, INTEGRATION_KEY default, guard agencyId, signup 500-masking, CORS 3000-vs-3001, no helmet/throttle/filter, unvalidated document:any, AI fallback swallowing 4xx, dead pool wiring, contacts empty-create, public-page enumerability, theme .catch swallowing).

### 2026-09-08 — Stage 1 (baseline)
- `npm run typecheck --workspace=api` → EXIT 0 (clean before changes).
- `npm run build --workspace=api` → EXIT 0.

### 2026-09-08 — Stages 2+3 (hardening + correctness, all implemented)
- NEW `apps/api/src/common/env-check.ts`: `requireJwtSecret()` (>=16 chars), `requireIntegrationKey()` (64 hex), `requireDatabaseUrl()`, `parseCorsOrigins()`; test bypass via `ALLOW_INSECURE_TEST=1`.
- NEW `apps/api/src/common/http-exception.filter.ts`: global filter, redacts `nvapi-*/sk-*/Bearer/JWT` from responses+logs, preserves body-parser 413/400 statuses (entity.too.large fix found by e2e), 500s masked.
- `apps/api/src/main.ts`: fail-fast env checks, `helmet`, explicit CORS whitelist (default `http://localhost:3001`), `bodyParser:false` + `json/urlencoded 1mb` (so service-level 500KB doc check returns the actionable 413), strict `ValidationPipe({whitelist, forbidNonWhitelisted, transform})`, global filter, shutdown hooks, health now includes `version`.
- `apps/api/src/app.module.ts`: `ThrottlerModule` (default 120/min, auth 20/min, ai 15/min) + global `ThrottlerGuard`.
- `apps/api/src/auth/*`: module requires env secret (no `dev-secret`); controller preserves 409 duplicate (was 500) + `@Throttle` + DTO `MaxLength` caps; service normalizes email lowercase/trim, validates, throws 409 on P2002; guard populates real `agencyId` via `subAccount.agency`, maps all JWT/DB failures to 401, rejects users without `subAccountId`.
- `apps/api/src/contacts/*`: `@Delete('/:id')` path fix; service rejects empty create (400), validates email, returns `{ok,deleted}` + 404 when nothing deleted.
- `packages/shared/src/page-document.ts`: +`MAX_DOCUMENT_BYTES` (500KB) +`safeParseDocument()`; NO shape change. Rebuilt `packages/shared/dist` via `tsc -p packages/shared/tsconfig.json`.
- `apps/api/src/funnels/*`: controller DTO `@IsObject document` + name cap; service validates name, retries path on P2002 collision, `updatePageDocument` enforces size cap (413) + Zod `safeParse` (400, never silent strip) and returns parsed doc.
- `apps/api/src/ai/provider-pool.ts`: restored `POOLS` store, exported `MAX_FAILS_PER_KEY`, added `getPool()` accessor, fixed stray `logger` ref → `this.logger` (no secret in logs), deactivates keys after max fails.
- `apps/api/src/ai/ai.service.ts`: `saveKeys` validates (non-empty, ≤10, key 8-500 chars, SSRF-checked baseUrl) + hydrates pool; `resolveCreds` understands multi-key `{json:{keys,defaults}}` shape + legacy, hydrates pool, corrupt store → 400, missing config/key-hint → 400 (was generic Error); `saveConfig` validates; `listConfigs` handles both shapes, never leaks raw keys (`maskKey` length-only fingerprint); `listKeys` uses `getPool()` with DB-masked fallback; `generate` caps prompt 8k + validates system/mode, rotates via `pool.chat` when >1 key, returns `keyUsed`, upstream failures prefixed `UPSTREAM_*`; `editElement` caps instruction 4k + element 200KB; `testConnection` validates baseUrl; `encKey()` → `requireIntegrationKey()` (no hardcoded default); `validateBase` hardened (blocks credsuserinfo, `.internal/.lan`, `0.0.0.0/::1`, host length); exported `redact/maskKey/withVersionedPath/validateBase/mappedError` for tests.
- `apps/api/src/ai/ai.controller.ts`: strict DTO caps + `ArrayMin/MaxSize` + nested `KeyEntryDto` validation, `@Throttle(ai)` on generate/edit/models/test, `generate` only falls back on upstream errors — 4xx config/validation errors now reach the client (was: everything swallowed into 200 fallback).
- `apps/api/package.json`: +`helmet`, `@nestjs/throttler`, `@nestjs/testing@10`, `jest/supertest/ts-jest/@types/*`; scripts `test`, `test:e2e`, `test:all`.
- `apps/api/jest.unit.json` + `jest.e2e.json` + `test/security.unit-spec.ts` (13 tests) + `test/pool.unit-spec.ts` (5 tests) + `test/backend.e2e-spec.ts` (7 tests, isolated temp SQLite).
- `apps/api/.env` (gitignored, local-only): `WEB_URL` now `http://localhost:3001,http://localhost:3000`; generated local `INTEGRATION_KEY` (64 hex, value NOT recorded here).
- `start-api.ps1` + `start-all.ps1`: load `INTEGRATION_KEY` from gitignored `.env`, else generate+persist there; never hardcode. Both parse-clean (PSParser 0 errors).
- E2E-driven fixes (tests caught real bugs): (a) framework 100KB body cap masked as 500 → set 1MB + filter preserves 413; (b) `listKeys` leaked full custom keys via `redact()` (only masks nvapi/sk patterns) → new `maskKey()` length-only fingerprint in `listKeys`+`listConfigs`.

### 2026-09-08 — Wave 2 (management APIs, all additive, e2e-verified)
- `auth`: `GET me` (safe fields only, no passwordHash) + `POST change-password` (verifies current, 8-128 policy, old password stops working).
- `contacts`: `GET ?q=&skip=&take=` (contains-search email/phone/first/last, take 1-100, still returns array); `PATCH /:id` (partial update, 400 empty patch, 404 cross-user).
- `funnels`: `PATCH /:id` rename, `DELETE /:id` (cascades pages), `POST /:id/clone` (deep copy pages, "(Copy)" name, fresh path), `POST /:funnelId/pages` (ordered, slugged), `PATCH page/:pageId` rename, `DELETE page/:pageId` (400 when last page). Removed dead unauthenticated `dumpRaw` helper (attack surface).
- NEW `common/request-id.middleware.ts`: `X-Request-Id` on all responses, reused when valid, logged as `[rid=...]` on 500s; wired in `main.ts`.
- NEW `test/wave2.e2e-spec.ts` (4 tests, isolated `opencrm-test-wave2.db`): request-id header, me/change-password rotation, contacts search/pagination/update/isolation, full funnel lifecycle incl. clone + delete guards.

### 2026-09-09 — Wave 3 (error-shape contract — answers KIMI K3 item 31)
- Read `KIMI K3 PROGRESS.md` (found 2026-09-09). No backend files touched by frontend AI; ownership respected. Their asks of me: (a) keep contracts forward-compatible — my Waves 1-2 were purely additive, confirmed; (b) 4xx from `generate-page` must be handled gracefully in their `AiModal` — backend side of that is now LOCKED by tests (see below); (c) key-health indicator red/yellow/green — served by `GET /api/ai/config/keys/:provider` `health` field (unchanged, still `healthy|warning|error` + fingerprint `key`).
- NEW `test/error-shapes.e2e-spec.ts` (8 tests, isolated `opencrm-test-wave3.db`): asserts every client error is `{statusCode, message}` with `message: string|string[]` — signup-400 (array), duplicate (409/400 string "already exists"), login-401, unauth-401 on 4 guarded routes, contacts-404 + request-id header, funnel-page-404, ai-generate-400 ×4 (empty/oversize/unknown-system/no-provider with "No AI provider" message), document-400 "Invalid document". If any of these shapes change, e2e goes red BEFORE frontend breaks.
- No production code changes needed in Wave 3 (shapes were already correct) — pure contract-locking.

### 2026-09-09 — Wave 4 (MAJOR: forms, versions, metering, lockout, envelopes)
- Schema (`packages/db/prisma/schema.prisma`, client regenerated, dev DB pushed — all additive): NEW `PageVersion` (snapshot+bytes, cascade delete, `[pageId,createdAt]` index), NEW `AiUsage` (kind/provider/model, `[subAccountId,createdAt]` index, `SubAccount.aiUsages` back-relation), NEW indexes `User[subAccountId]`, `Funnel[subAccountId,updatedAt]`, `Page[funnelId,order]`.
- Page versions: every validated `updatePageDocument` snapshots (pruned to last 20); list/get/restore endpoints; restore goes through the validated save path so current state is snapshotted first. Serves KIMI's "History sandbox" UI directly.
- Public forms: `PublicFormsController` (`POST /api/public/forms/:pageId/submit`, 5/min, 1–20 fields, values ≤2000 chars, email validated, honeypot → fake 200 with zero DB writes, creates contact with `source:form:<pageId>` + full payload in `customFields`). Makes builder `form` blocks functional end-to-end.
- AI metering: `AiUsage` row per generate/edit/test (fire-and-forget, never breaks calls); daily cap (`AI_DAILY_CAP`, default 200, read per-request) → HTTP 429 with reset time; `GET /api/ai/usage`. Serves KIMI's "rate-limit sandbox" meter.
- Login lockout: per-email ledger (5 fails → 15min 429, success resets, unknown emails stay 401 to avoid enumeration). In-memory per-process — multi-instance needs Redis (known limit, documented here).
- Envelopes: opt-in `?envelope=1` on contacts + funnels lists; defaults untouched.
- Throttle redesign (lesson from a REAL e2e failure): named throttlers in `forRoot` applied to EVERY route with per-route counters, so 22 legit doc saves 429'd on the 15/min `ai` bucket. Now: single generous per-route default (120/min) + strict route-level budgets (auth 20, ai 15, forms 5). `generate-page` also pinned to HTTP 200.
- NEW `test/wave4.e2e-spec.ts` (4 tests) + `test/auth-lockout.unit-spec.ts` (3 tests). Wave 4 first run caught the 2 issues above (429-design + generate 201-vs-200); both fixed in prod code, all green after.

## 4. TEST MATRIX (command + result — updated every run)

| Date (UTC) | Command | Result |
|------------|---------|--------|
| 2026-09-08 | `npm run typecheck --workspace=api` (baseline) | EXIT 0 |
| 2026-09-08 | `npm run build --workspace=api` (baseline) | EXIT 0 |
| 2026-09-08 | `npm run typecheck --workspace=api` (after hardening) | EXIT 0 |
| 2026-09-08 | `npm run test --workspace=api` (unit) | 2 suites, 18/18 PASS |
| 2026-09-08 | `npm run test:e2e --workspace=api` (1st run) | 5/7 PASS — caught 2 real bugs (413 masking, key leak) |
| 2026-09-08 | `npm run test:e2e --workspace=api` (after fixes) | 1 suite, 7/7 PASS |
| 2026-09-08 | `npm run build --workspace=api` (final) | EXIT 0 |
| 2026-09-08 | `npm run typecheck --workspace=api` (final) | EXIT 0 |
| 2026-09-08 | `npm run test --workspace=api` (final) | 2 suites, 18/18 PASS |
| 2026-09-08 | `npm run test:e2e --workspace=api` (Wave 2) | 2 suites, 11/11 PASS (7 old + 4 new) |
| 2026-09-08 | `npm run typecheck --workspace=api` (Wave 2) | EXIT 0 |
| 2026-09-08 | `npm run test --workspace=api` (Wave 2) | 2 suites, 18/18 PASS |
| 2026-09-08 | `npm run build --workspace=api` (Wave 2) | EXIT 0 |
| 2026-09-09 | `npm run test:e2e --workspace=api` (Wave 3) | 3 suites, 19/19 PASS (7+4+8) |
| 2026-09-09 | `npm run typecheck --workspace=api` (Wave 3) | EXIT 0 |
| 2026-09-09 | `npm run test --workspace=api` (Wave 3) | 2 suites, 18/18 PASS |
| 2026-09-09 | `npm run build --workspace=api` (Wave 3) | EXIT 0 |
| 2026-09-09 | `npm run test:e2e --workspace=api` (Wave 4, 1st run) | 21/23 — caught 2 real issues (throttle design 429, generate 201-vs-200) |
| 2026-09-09 | `npm run test:e2e --workspace=api` (Wave 4, after fix) | 4 suites, 23/23 PASS |
| 2026-09-09 | `npm run typecheck --workspace=api` (Wave 4) | EXIT 0 |
| 2026-09-09 | `npm run test --workspace=api` (Wave 4) | 3 suites, 21/21 PASS |
| 2026-09-09 | `npm run build --workspace=api` (Wave 4) | EXIT 0 |
| 2026-09-09 | `npm run test:e2e --workspace=api` (Wave 5, 1st run) | 28/29 — caught filter masking intentional 502 as 500 |
| 2026-09-09 | `npm run test:e2e --workspace=api` (Wave 5, after fix) | 5 suites, 29/29 PASS |
| 2026-09-09 | `npm run typecheck --workspace=api` (Wave 5) | EXIT 0 |
| 2026-09-09 | `npm run test --workspace=api` (Wave 5) | 5 suites, 31/31 PASS |
| 2026-09-09 | `npm run build --workspace=api` (Wave 5) | EXIT 0 |
| 2026-09-09 | web `npx tsc --noEmit` + `npm run build` (Wave 6) | both EXIT 0 (11 routes) |
| 2026-09-09 | `npm run test/test:e2e/typecheck` (Wave 6, backend untouched) | 31/31, 29/29, EXIT 0 |
| 2026-09-09 | `npm run test:e2e --workspace=api` (Wave 7, 1st run) | 30/31 — static middleware 301-shadowed GET /api/uploads |
| 2026-09-09 | `npm run test:e2e --workspace=api` (Wave 7, after fix) | 6 suites, 31/31 PASS |
| 2026-09-09 | `npm run test --workspace=api` (Wave 7) | 6 suites, 33/33 PASS |
| 2026-09-09 | api `typecheck` + `build` (Wave 7) | EXIT 0 + EXIT 0 |
| 2026-09-09 | web `tsc --noEmit` + `next build` (Wave 7) | EXIT 0 + EXIT 0 (11 routes) |
| 2026-09-09 | web `tsc --noEmit` + `next build` (Wave 9 redesign) | EXIT 0 + EXIT 0 (11 routes) |
| 2026-09-09 | launcher live test #1 (Wave 8) | caught 2 engine bugs (scope loss, unquoted schema path) |
| 2026-09-09 | launcher live test #2+#3 (Wave 8) | full launch EXIT 0 twice; catalog 152/114 + login 200 live; stop freed exact PIDs |

## 5. KNOWN CONS / BUGS -> FIX STATUS

| # | Bug / hidden con | Severity | Status |
|---|------------------|----------|--------|
| 1 | JWT defaulted to `dev-secret` | CRITICAL | FIXED: fail-fast `requireJwtSecret()` in module+boot; scripts pass explicit secret |
| 2 | INTEGRATION_KEY hardcoded default | CRITICAL | FIXED: `requireIntegrationKey()`; local key in gitignored `.env`; scripts load/generate it, never hardcode |
| 3 | Guard `agencyId` always undefined | HIGH | FIXED: populated via `subAccount.agency`; 401 mapping; rejects missing subAccount |
| 4 | Signup duplicate returned 500 | HIGH | FIXED: service throws 409, controller preserves 4xx; e2e asserts 409/400 |
| 5 | No helmet/rate-limit/filter, CORS wrong default | HIGH | FIXED: helmet, throttler (auth 20/ai 15 per min), global redacting filter, CORS default 3001 |
| 6 | `document:any` unlimited, no Zod gate | HIGH | FIXED: 500KB cap + `safeParseDocument` 400; framework 1MB so message is actionable |
| 7 | AI swallowed 4xx into fallback | MEDIUM | FIXED: 4xx passthrough, fallback only upstream; e2e asserts no-config → 400 |
| 8 | Pool rotation dead code (`getPool` missing) | MEDIUM | FIXED: `getPool()` added, `saveKeys`/`resolveCreds` hydrate pool, `generate` rotates; unit+e2e covered |
| 9 | Contacts empty-create + no 404 | MEDIUM | FIXED: 400 on empty/bad email, 404 on missing delete, `@Delete('/:id')`; e2e incl. cross-user isolation |
| 10 | Funnel path collision unhandled | LOW | FIXED: P2002 retry ×3 |
| 11 | Global env-key fallback cross-tenant | MEDIUM | MITIGATED: stored per-subAccount keys preferred + pool hydration; env keys only last-resort fallback (documented; full per-tenant-only mode needs product decision) |
| 12 | No backend tests at all | HIGH | FIXED: 18 unit + 7 e2e, all green; `test`, `test:e2e`, `test:all` scripts |
| 13 | (found by e2e) framework 413 masked as 500 | MEDIUM | FIXED: filter preserves body-parser status; 1MB framework cap |
| 14 | (found by e2e) `listKeys`/`listConfigs` leaked raw custom keys | HIGH | FIXED: `maskKey()` length-only fingerprint |
| 15 | (found by e2e) named throttlers 429'd legit bulk editing | HIGH | FIXED: single per-route default + route-level budgets |
| 16 | Builder forms were decorative (no backend capture) | HIGH | FIXED Wave 4: public submit → contact + honeypot + 5/min |
| 17 | No undo/version history for pages | HIGH | FIXED Wave 4: last-20 snapshots + list/get/restore |
| 18 | Unbounded AI spend, no visibility | HIGH | FIXED Wave 4: metering + daily cap (429) + usage endpoint |
| 19 | No brute-force account lockout | MEDIUM | FIXED Wave 4: 5 fails → 15min 429 (per-process; Redis needed for multi-instance) |
| 20 | (found by e2e) filter masked intentional 502 as generic 500 | MEDIUM | FIXED Wave 5: curated HttpExceptions pass through; only unknown errors masked |
| 21 | (found by audit) AI animation keyframes missing → all animations dead | HIGH | FIXED Wave 6: 9 dist-* keyframes in globals.css + delayMs honored |
| 22 | (found by audit) builder/preview forms dead (no submit wiring, empty pageId) | HIGH | FIXED Wave 6: PageRenderer pageId → public submit endpoint |
| 23 | (found by audit) rawHtml iframe allowed scripts+same-origin (token theft) | CRITICAL | FIXED Wave 6: sandbox allow-forms+popups only |
| 24 | (found by audit) headings rendered as raw HTML (script vector) | HIGH | FIXED Wave 6: escaped text rendering |
| 25 | (found by audit) load() marked clean → AI output showed "Saved" pre-save | MEDIUM | FIXED Wave 6: load(doc, markDirty?) |
| 26 | (found by audit) published pages ignored tablet/mobile overrides; phone overflow | HIGH | FIXED Wave 7: responsiveCss media queries + mobile stacking + stylesAt cascade |
| 27 | (found by e2e) serve-static 301-shadowed GET /api/uploads list endpoint | MEDIUM | FIXED Wave 7: `redirect:false` on static mount (main + tests) |
| 28 | No image hosting (picsum-only) | HIGH | FIXED Wave 7: magic-byte uploads + library + Inspector button |
| 29 | Launchers broken 10+ ways (unquoted cd with spaces, var-with-space, garbage URL suffix, invalid PS color, missing INTEGRATION_KEY = guaranteed API FATAL, no build/prisma steps, taskkill-all-node, watchdog -Method typo + restart loop, garbled docs) | CRITICAL | FIXED Wave 8: one engine + thin delegates (below) |
| 30 | (found by live test) engine lost env map to child scope; unquoted schema path | HIGH | FIXED Wave 8: $script: scope + quoted --schema |
| 31 | (root cause of "bad UI") globals.css theme vars used em-dash names — entire design system silently dead | CRITICAL | FIXED Wave 9: real --vars, fonts, selection, focus rings |
| 32 | Dead nav routes (Conversations/Automations/Calendars have zero backend) + dashboard links to them | HIGH | FIXED Wave 9: nav trimmed to real pages; dead links gone |
| 33 | Fake dashboard stats (hardcoded 0s), sites without actions, contacts without search/delete, settings without health/usage/password | HIGH | FIXED Wave 9: real data + clone/delete/preview, search+delete, key-health dots + meter + change-password |

## 6. REQUESTS

### TO FRONTEND (other AI — please acknowledge by reading, do not edit backend)
- **Error-shape guide (for AiModal + forms + toasts):** every 4xx is `{statusCode:number, message:string|string[]}`. ValidationPipe errors → `message` is an ARRAY of strings (join with "; " or show first). Service errors (BadRequest/401/404/409/413) → `message` is a STRING. Always also check `statusCode`. Every response (incl. errors) carries `X-Request-Id` — include it in bug reports to me. These shapes are now e2e-locked (`error-shapes.e2e-spec.ts`); I will announce here before any change.
- Key-health UI: `GET /api/ai/config/keys/:provider` → `[{label, key:"*** (N chars)", baseUrl, fails, lastError, cooldownUntil, health:"healthy"|"warning"|"error"}]`. Poll at most ~1/min; `health` mapping is stable.
- Wave 4 for builder UI (adopt-when-ready): History panel → `GET page/:id/versions` (light rows) + click row → `GET .../versions/:vid` (full doc preview) + Restore button → `POST .../restore/:vid` (201, returns restored page); usage meter → `GET /api/ai/usage` (`{used,cap,remaining,resetsAt}` — show progress bar, warn at remaining 0; 429 body message is user-displayable); form blocks → point `<form>` at `POST /api/public/forms/:pageId/submit` with `{fields:{...}}` + hidden `website` honeypot input (bots fill it, humans don't); tables → add `?envelope=1` for `{items,total}` pagination.
- Response contract is UNCHANGED for happy paths; only additions: `generate-page` success may include optional `keyUsed` (label string); upstream-failure fallback still `{document, fallback:true, reason}`. NEW: config/validation problems now return 4xx instead of silent 200-fallback — surface `body.message` to the user.
- `PATCH .../document` now enforces 500KB + strict shape: on 400/413 show the message, do NOT retry silently. Round-trip preserves sections (e2e-verified 2 sections save→read).
- `DELETE /api/contacts/:id` now returns `{ok:true, deleted:1}` (was raw Prisma count) and 404s properly — update any UI that parsed the old shape.
- Wave 2 for builder UI (all optional/adopt-when-ready): clone button → `POST /:id/clone`; funnel settings rename → `PATCH /:id {name}`; page tabs add/rename/delete → `POST /:funnelId/pages`, `PATCH page/:id {title}`, `DELETE page/:id` (400 "only page" → show message); account menu → `GET auth/me`; settings password form → `POST auth/change-password`; contacts table search box → `GET /contacts?q=`.
- `GET /api/ai/config/keys/:provider` `key` field is now a length-only fingerprint (`*** (N chars)`) — never the real key. Use `label` to distinguish keys.
- KIMI K3 watch: checked for `*KIMI*` progress file on 2026-09-08 ~22:00 UTC — NOT FOUND yet. I will re-check each cycle; if you (frontend AI) create it under a different name, drop its path in your reply so I can read it.

### FROM FRONTEND (requests the other AI left for me)
- 2026-09-09 read `KIMI K3 PROGRESS.md`: (a) keep contracts forward-compatible → confirmed additive-only so far; (b) 4xx shape question for AiModal → answered above + locked by tests; (c) key-health colors → supported via existing `health` field. No backend action pending from their side.

## 7. LOG (append-only, newest at bottom)

- `2026-09-08T00:00Z` — File created by Muse Spark. Plan published. Frontend notified of locks. Next: Stage 1 baseline typecheck/build.
- `2026-09-08T~21:30Z` — Baseline green (typecheck 0, build 0). Installed helmet/throttler/jest/supertest/ts-jest/@nestjs/testing@10. Implemented Stages 2-4.
- `2026-09-08T~21:55Z` — Unit 18/18 green. E2E 5/7: caught 2 real bugs (413-masked-as-500, raw key leak in listKeys). Fixed both (filter status preservation + 1MB cap; maskKey fingerprint).
- `2026-09-08T~22:00Z` — E2E 7/7 green, build 0, typecheck 0, unit 18/18 re-green. Fixed local boot chain (.env key + WEB_URL, both start scripts load/generate INTEGRATION_KEY, PSParser 0 errors). Checked for KIMI K3 progress file (*KIMI*): not found yet — will re-check each cycle. No frontend files touched (all changes under apps/api, packages/shared schema+dist, test, start-*.ps1, this log).
- `2026-09-08T~22:15Z` — WAVE 2 done: auth me/change-password, contacts search+update, funnel rename/clone/pages/delete, request-id tracing, dead dumpRaw removed. E2E 11/11 (2 suites), unit 18/18, typecheck 0, build 0. Checked *KIMI*: still not found. No frontend files touched. Proposed Wave 3 (awaiting user steer): AI usage metering + per-subAccount spend caps, login lockout after repeated 401s, pagination metadata envelope (opt-in via ?envelope=1 to stay compatible), Prisma index audit.
- `2026-09-09T~18:15Z` — WAVE 3 done: read `KIMI K3 PROGRESS.md` (their asks: forward-compat ✓, AiModal 4xx shapes → locked by NEW `error-shapes.e2e-spec.ts` 8 tests + guide above, key-health colors → existing `health` field). E2E 19/19 (3 suites), unit 18/18, typecheck 0, build 0. No prod code changes needed; no frontend files touched. Next candidates: AI spend caps, login lockout, opt-in pagination envelope, index audit.
- `2026-09-09T~18:30Z` — WAVE 4 done (MAJOR): all Wave-3 candidates SHIPPED — public form capture, page version history (last-20 + restore), AI metering + daily cap + usage endpoint, login lockout, envelopes, index audit, throttle redesign after a REAL e2e-caught 429 + generate pinned to HTTP 200. E2E 23/23 (4 suites), unit 21/21, typecheck 0, build 0. Schema extended (PageVersion, AiUsage, 4 indexes), client regenerated, dev DB pushed. No frontend files touched.
- `2026-09-09T~18:50Z` — WAVE 5 done (generation MASTERPIECE engine + URL import, solo ownership from here): prompt rewritten (9-section blueprint, copy playbook per business type, animation/color/image discipline, picsum guidance); NEW `sanitize.ts` (clamp/fill/drop-unknown/strip-JS/renormalize widths) wired into generate; thin-page (<4 sections) single expansion retry keeping the fuller doc; output budget 4096→8000 tokens; fallback upgraded to 5 animated sections; NEW `site-import.ts` (SSRF-safe fetch, brief extractor, deterministic synthesis + escaped HTML fallback) + `POST /api/ai/import-url`; filter now passes curated HttpException 5xx (e.g. 502) through instead of masking all to 500. E2E 29/29 (5 suites), unit 31/31, typecheck 0, build 0. First run caught the 502-masking; fixed in prod code. NEXT: frontend — renderer delayMs for all presets, AiModal URL tab + 4xx display + usage meter + versions panel.
- `2026-09-09T~19:05Z` — WAVE 6 done (FRONTEND, audit found 6 live bugs, all fixed): (1) `dist-*` animation keyframes DIDN'T EXIST — every AI animation silently dead → added all 9 to globals.css; (2) `blockAnimCss` ignored delayMs except fade-in → honored for all presets (stagger works); (3) headings rendered via dangerouslySetInnerHTML → now escaped text (imported content can't inject scripts); (4) forms DEAD everywhere (formSubmit never wired, pageId "") → PageRenderer takes pageId, posts to `/public/forms/:pageId/submit`; (5) rawHtml iframe sandbox allowed scripts+same-origin (token theft via prompt-injected scripts) → `allow-forms allow-popups` only; (6) `load()` marked clean so AI output showed "Saved" before persisting → `load(doc, markDirty?)`, AI/templates pass true; (7) preview link hardcoded :3000 → relative; save errors swallowed → shown on button. NEW: AiModal Import-URL tab + live usage meter + friendly 429/502/401 errors + source/fallback notes; NEW VersionsPanel (last-20 list + one-click restore, current auto-snapshotted first) + Toolbar History button. Web `tsc` 0 + `next build` 0 (11 routes); backend re-verified 31/31 + 29/29 + typecheck 0.
- `2026-09-09T~19:25Z` — WAVE 7 done (responsive perfection, SEO meta, self-hosted uploads): PageRenderer emits per-node media-query CSS from tablet/mobile overrides (overrides win via !important) + auto-stacking rows/pricing on ≤640px; editor `stylesAt` mobile now inherits tablet (real cascade). NEW page meta API (title/slug/description, slug format+uniqueness, public surface extended, preview sets title+meta). NEW uploads module (memory-only Multer, magic-byte sniffing, 5MB/100-file caps, per-account dirs, static serving with redirect:false, gitignored) + Inspector upload button + apiForm helper. Wave-7 e2e (meta+uploads incl. traversal/size-cap cases) first caught static-301 shadowing the list endpoint — fixed in prod code. Unit 33/33 (6 suites), e2e 31/31 (6 suites), api typecheck+build 0, web tsc+build 0.
- `2026-09-09T~19:45Z` — WAVE 8 done (LAUNCHER REBUILT, user-reported breakage): audit found every launcher broken (see #29). NEW `START-OpenCRM.bat` (double-click) + `scripts/launch.ps1` engine (PS5.1-safe, zero hardcoded paths, ASCII-only after finding 5.1 misdecodes UTF-8 dashes as quote chars): node/npm check, auto npm install, .env ensure with generated secrets (gitignored), prisma generate+push, freshness-gated build, surgical port freeing (exact PIDs, never taskkill-all), titled crash-visible windows, real health waits, browser open, modes all/api/web/doctor/stop + -Rebuild/-NoBrowser. Legacy names (START.bat/MS/cmd, START.ps1, start-all/api/web.ps1) delegate to the engine; watchdog rewritten (fixed -Method typo, env-correct restarts, also watches web); START.md rewritten accurate. PROVEN LIVE twice: EXIT 0, catalog 152/114 + login-page 200 over HTTP, stop freed exact PIDs; machine left clean. Lesson: all .ps1 must stay pure-ASCII (5.1 has no BOM sniffing).
- `2026-09-09T~20:00Z` — WAVE 9 done (UI/UX OVERHAUL): root cause of "bad UI" was #31 (dead theme vars) + #32/#33. Fixed theme (real vars, Inter tight, selection, focus rings, meter/lift/tile/page/empty/lbl utilities); tailwind brand+display tokens; NEW shared Logo/AuthShell; sidebar rebranded with live user email; dashboard home with REAL data (contacts total via envelope, funnels/pages counts, AI meter, 5 recent, quick actions); sites with clone/delete/preview + counts; contacts with live search + source badges + delete; settings with provider saved-dots, per-key HEALTH list, usage meter, account + change-password; auth pages unified on brand (429-aware login); landing rewritten (real numbers, features grid, 3 steps, checklist band, final CTA). Web tsc 0 + next build 0. Backend untouched (still 33/31 green from Wave 7).
