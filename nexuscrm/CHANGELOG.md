# CHANGELOG

Format per AI_DEVELOPMENT_CONSTITUTION.md §8: date · one-line description · files touched · tests added · risk level. Newest first.

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
