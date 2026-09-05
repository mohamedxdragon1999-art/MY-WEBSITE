# v0.0.0.0.19 — Website Builder: fix + hardening + intelligence plan

Rule per unit: reproduce → change → targeted test → full battery → commit.

## Unit 1 — Safe output contract (closes XSS chain S3/S8/S9/S10/S11/S12/N2)
- New module `backend/src/nx_safe_html.js` (bundle-safe, zero deps, regex-tokenizer):
  `nxSanitizeFragment(html, policy)` — allowlist tags/attrs, strip event handlers,
  `javascript:`/`vbscript:`/`data:` (non-image) URLs, `<iframe>` unless allowlisted host,
  `<object|embed|meta|base|link|form[action≠''|#|self]>`, comments, CDATA.
  `nxJsonForScript(obj)` — JSON.stringify + `<`, `>`, `&`, U+2028/9 escapes.
  `nxJsString(s)` — safe JS string literal.
  `nxSafeUrl(u, {schemes})` — returns '' unless scheme allowed.
- Apply: AI body (L7739), user `html` on POST/PATCH (S3), JSON-LD (L7765 → nxJsonForScript),
  webhook URL (nxJsString + https validation), scene_text (nxJsString), plan URL fields
  (nxSafeUrl), template plan text fields (escape via `__be`).
- CSP + security headers on BOTH public serve paths (`publicSiteGet` and `/s/:slug`), unify
  them into one function.
- Tests: `tests/test_safe_html.mjs` — unit + jsdom `runScripts` execution proof for every
  vector in audit/repro (quote-free payloads), for every design + directions.

## Unit 2 — Template identity boundary in the PRODUCTION copy (F16/T1)
- Port the identity scrub into the inlined `nxRenderTemplateDocument` (index.js) using
  `nx_identity.js` (static import — bundle-safe, no deps); title fallback → site name.
- De-list `template` from `/ai/site-designs` when a plan has no real contact (or always
  list last with an explicit "reference" label) — decision: keep listed, but LAST, and
  rename to "Reference (drainage showcase)"; scrub guarantees no leak.
- Test: `tests/test_template_identity.mjs` extended to hit the LIVE route
  (`POST /sites design_id:'template'` with and without plan) and assert 0 leaks.

## Unit 3 — Data integrity of the site lifecycle (S1, S2, N7, N8, B15)
- site_versions insert: use `label` (schema) not `note`; never swallow; add `mustRun`.
- snapshots DELETE: scope by workspace via JOIN.
- Webhook URL: backend derives from `w.public_token` + request origin at render time;
  persist `public_origin` in `site_meta.theme` JSON (no schema change); regenerate keeps it.
  `/s/:slug` POST → JSON 405 explaining the form is disconnected (never 401).
- `published` on PATCH: only change when `body.published` is explicitly boolean.
- graph import: render BEFORE writing graph; write both or neither.
- Tests: extend `test_backend.mjs` sections + new `tests/test_site_lifecycle.mjs`
  (lead survives regenerate; draft stays draft; version row exists; cross-tenant delete 404).

## Unit 4 — Deploy-ability (N1)
- `nx_structured.js`: linkedom instead of jsdom (API-parity verified).
- Declare `parse5`, `css-tree` in package.json.
- Bundle for Deploy Studio: `scripts/bundle-worker.mjs` (esbuild-free, own tiny CJS/ESM
  concatenating bundler for the 16 first-party files + 3 npm deps?) → too risky; instead
  make `server.js /api/backend-source` run a real bundler if available (`npx esbuild`),
  else return 503 with an honest message; add `npm run bundle` script; test asserts the
  served module has no unresolved relative imports.
  (esbuild not installed in sandbox — mark as "requires `npm i -D esbuild`", test skips
  honestly when absent.)

## Unit 5 — Streaming (F17/B11) — 3 readers + persist webchat reply on close
- Shared parser `nxSseDeltas(buffer)`; `pull()` loops until enqueue or EOF.
- Tests: multi-packet shapes A–I with per-chunk delay in backend + frontend jsdom.

## Unit 6 — Intelligence upgrade (the "level 50+" part)
Deterministic first (works with no AI), AI enrichment second — never depends on a model.
1. **Brief understanding**: `nx_brief.js` — extract industry (40+ rules incl. Arabic
   keywords), locale/RTL, tone, audience, offers, geography, USPs, price positioning,
   urgency; produce a `BriefProfile` with confidence per field.
2. **Section strategy**: page-goal aware section selection + ordering per industry ×
   goal (lead-gen / booking / e-commerce-lite / portfolio / SaaS / restaurant menu),
   with rationale (why each section exists, in the explanation payload).
3. **Copy intelligence**: `nx_content.js` extended — industry lexicon (20 → 40
   industries), headline formulas (benefit / outcome / social proof / urgency), CTA
   pairs, FAQ generation from services, microcopy; reading-level & length guards;
   Arabic/English bilingual generation for RTL briefs; no lorem, no "quality you can
   rely on" boilerplate repeated across sites (variety seeded by brief hash).
4. **Design intelligence**: palette derivation from brief mood (OKLCH-based contrast-safe
   generation), type pairing by industry, density/motion per audience, dark/light by
   industry; explain choices.
5. **Conversion intelligence**: sticky CTA on mobile, click-to-call/WhatsApp when phone
   present (wa.me with international normalisation), trust strip, FAQ schema.org,
   Service schema, BreadcrumbList, Open Graph complete, hreflang for bilingual.
6. **Quality gate v2**: `auditSiteHtml` → add checks for: CTA presence above the fold,
   contact reachability, RTL correctness, image alt quality, heading order, duplicate
   IDs, contrast tokens, mobile tap targets, CSP-compatibility (no inline handlers),
   JSON-LD validity (parse it back), leak scan (identity + lorem + template placeholders).
   Score breakdown returned to UI with fix hints; block publish on critical fails.
7. AI enrichment prompt: structured JSON output (not raw HTML) validated against a
   schema → rendered by the deterministic renderer → sanitiser (defence in depth).

Version: APP_VERSION → v0.0.0.0.19 (sidebar + Settings).
