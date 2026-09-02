# ═══════════════════════════════════════════════════════════════════
# CHANGES FILE — GET v0.0.1.4 "AGENTIC BUILD LOOP" ONTO THE MASTERPIECE PROGRAM
# Updated 2026-08-31 · builds on committed v0.0.1.3 (782a2e6)
# ═══════════════════════════════════════════════════════════════════

## 0) WHAT THIS RELEASE IS

**Phase 1 / slide 3** of the "go big" program — and the **feature that separates
a basic AI builder from a great one**: an **agentic development loop** and the
**AI Testing Agent / AI Debugger / AI Version Control** that support it.

Your brief said: the biggest upgrade is the loop
**Prompt → Plan → Build → Run → Inspect → Test → Detect → Fix → Re-test → Deploy**.
This release implements that loop for real, deterministically, and **tests it** so
it is not "placeholder or fake or extremely buggy." Measured, not asserted.

It sits on top of v0.0.1.2 (Quality Engine) + v0.0.1.3 (Blueprint Engine), so the
loop always has a rich, coherent site to act on.

## 1) WHAT'S NEW IN v0.0.1.4

### A. AI Testing Agent — `testSiteHtml(html)`
"Opens" the generated page and verifies it works, across **6 categories**
(structure, accessibility, performance, SEO, responsive, content) and **26
checks** — valid document, sections present, no broken internal links, unique
ids, `lang`, alt-text on images, accessible buttons, no positive tabindex,
`rel=noopener`, lazy/decoded/sized images, no `document.write`, no mixed http,
title/description/single-h1/JSON-LD/OG, viewport + media queries + type scale,
hero copy + CTA + contact form, no lorem/fake content, no leaked script. Returns
`status` (pass/warn/fail), `score`, per-category rows, and the failing checks.

### B. AI Debugger — `debugSiteHtml(html)`
Diagnoses concrete problems: unbalanced/unclosed tags, **broken internal links**
(anchor → missing section id), duplicate ids, missing alt, missing width/height
(CLS), missing `lang`, viewport, no `<h1>`/duplicate `<h1>`, silent buttons,
`tabindex`, `document.write`, mixed `http://`, missing JSON-LD.

### C. auto-fix + the loop — `autoFixSite()` + `runAgenticLoop()`
Targeted, idempotent fixes (keep exactly one `<h1>` and demote extras to `<h2>`,
eager-load the first/hero image, ensure an `<h2>` when sections exist), and a
capped loop: **build → inspect → test → detect → fix → re-test**, up to 3
iterations, returning the final HTML, test report, audit and trace.

### D. Agentic endpoint + UI
- **`POST /api/ai/agentic-build`** — runs the full loop (Blue
print plan + AI enrich + quality pass → test → fix → re-test) and returns
`{ html, test, audit, iterations, fixed, trace }`.
- **`GET /api/sites/:id/test`** — run the Testing Agent + audit on a saved site,
plus a `retest` after the auto-fix pass.
- Builder footer gains **🚀 Agentic Build** (opens a report with the Testing Agent
  category rows, Audit grade, iteration count and a Preview button).
- Site list rows gain **🧪 Test** (opens the report with an **Apply fixes & Save**
  button) and **⏱ Snapshot / ↩ Versions**.

### E. AI Version Control — checkpoints + restore
- New `site_versions` table; **`POST /sites/:id/snapshots`** (save a checkpoint,
  bounded to newest 40 per site), **`GET /sites/:id/snapshots`** (list), **`POST
  /sites/:id/snapshots/:sid/restore`** (restore), **`DELETE /sites/:id/snapshots`**
  (cleanup).
- Snapshot/restore/versions buttons in the site list — undo any change with one
  click.

### F. 3D (per your instruction)
The AI **does not generate 3D scenes from scratch.** Sites take 3D from **our
curated library** (50+ real WebGL/Canvas/Spline scenes). AI is used only to
*choose & place* a scene (scene picker / concept / spline URL), never to invent
one.

## 2) MEASURED

| Check | Result |
|-------|--------|
| Agentic Build (no-AI, deterministic) | **pass 26/26** Testing Agent · **Audit 95** · 1 iteration |
| Garbage-model build | coherent site, no junk leaked, **audit ≥ 70** |
| /sites/:id/test | pass 26/26, retest 26/26 |
| Debugger on a broken site | detects duplicate h1, broken anchor, missing alt, document.write |
| Version control | 2 checkpoints saved; restore returns the site to its saved state |
| Route coverage | 61/61 |

## 3) FILES TOUCHED

- `backend/src/index.js` — Agentic engine (testSiteHtml / debugSiteHtml /
  autoFixSite / runAgenticLoop), `buildAgenticSite`, agentic-build + site-test +
  version-control endpoints, `site_versions` handling, exported in `__internals`.
- `backend/schema.sql` — `site_versions` table + index.
- `NexusCRM_V4_Hardened.html` — Agentic Build button + report, Test action,
  Snapshot/Versions UI, `APP_VERSION` → **v0.0.1.4**.
- `tests/test_agentic.mjs` — NEW suite (23 checks).
- `tests/run_all.mjs` — registered the suite.
- `tests/test_aurora.mjs` — version assertion updated.

## 4) TESTS ADDED

`test_agentic.mjs` (23/0):
- A1 debugger detects duplicate h1/lang/broken anchor/alt/document.write; no
  findings on a clean doc.
- A2 testing agent returns status/score/6 categories; clean site passes most.
- A3 autoFix keeps exactly one h1; clean blueprint site passes on iteration 1.
- B1 `/ai/agentic-build` returns a well-formed site, test pass, audit ≥ 70,
  iterations ≥ 1.
- B2 `/sites/:id/test` returns a report; garbage html is not "pass"; offers a retest.
- B3 snapshots create/list; restore returns the site to its saved score.
- C1 frontend: agentic + version functions exposed; builder has the Agentic
  button; report renders; no runtime errors.

## 5) FULL BATTERY

25 suites: **all green except the pre-existing network-dependent
`test_deploy_studio.mjs` (92/1)**. Route coverage **61/61**.

## 6) WHAT THIS COVERS / WHAT REMAINS

Covered (and tested) now: **Agent/Autonomous builder** (the loop), **AI Testing
Agent**, **AI Debugger**, **AI Version Control**, plus the prior **Quality
Engine** (SEO/accessibility/performance as the SEO & a11y & perf builder) and
**Blueprint** (Design/Content generator). **AI Responsive Designer** is expressed
as the responsive checks in the Testing Agent.

Still to come in this program (honest list, not faked):
- **AI Visual Editor** (select an element → say "make this larger/orange") — needs a live DOM editing surface; planned.
- **Screenshot → Website** — needs multimodal image understanding; planned.
- **Image Generation** — needs a real image model + key; add only when a key is configured (never a no-op placeholder).
- **AI Database Builder** — part of the **SQLite data engine** phase (big).

Nothing pushed; I wait for your go-ahead.
