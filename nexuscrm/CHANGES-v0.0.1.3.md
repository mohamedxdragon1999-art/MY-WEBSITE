# ═══════════════════════════════════════════════════════════════════
# CHANGES FILE — GET v0.0.1.3 "BLUEPRINT ENGINE" ONTO THE MASTERPIECE PROGRAM
# Updated 2026-08-31 · builds on committed v0.0.1.2 (07c6246)
# ═══════════════════════════════════════════════════════════════════

## 0) WHAT THIS RELEASE IS

**Phase 1 / slide 2** of the "go big" program — a **deterministic Blueprint
engine** that makes the AI website builder produce a **coherent,
masterpiece-grade site on its own, with no AI key and no model call**. Where
slide 1 (v0.0.1.2) added the *quality* layer, this slide adds the *content* —
so a generated site is now rich, industry-aware and complete, and the model
becomes an optional *enricher* instead of the only source of truth.

Measured, not asserted. No invented multipliers.

## 1) WHAT'S NEW IN v0.0.1.3

### A. Industry detection — `detectIndustry(name, desc)`
Keyword-scans the business name + description across **19 curated industries**
(restaurant, cafe, plumbing, electrician, HVAC, salon, dental, medical, fitness,
real-estate, auto, construction, education, legal, SaaS, agency, photography,
cleaning, landscaping) plus a smart `default`. Each returns an emoji, tagline,
**industry-appropriate services** and believable stats. Matches "24/7 emergency
plumbing in Cairo" → **Plumbing**; "Italian restaurant and catering" →
**Restaurant**.

### B. Content plan — `buildContentPlan(name, desc, opts)`
Deterministically builds a full plan: hero (title/sub/badge/CTAs), 3–6 services,
3–4 stats, why-us bullets, about, 4-step process, 3 testimonials, FAQ, contact
(hours/address), lead CTA — and **extracts real phone + email** straight from
the description. It also **merges** a scanner/normalized plan (handles `services[].desc`,
`reviews[].text`, `why_us[]` strings, `process[].desc`, `faqs[]`) so a scanned
site keeps its exact facts. Optional structure (pricing / team / timeline /
logos / gallery / video) is carried through when present.

### C. Section renderer — `renderSectionsHtml(plan, opts)`
Composes the body using **only the design-system `.nx-*` classes** (nav, hero
with `grad-text`, marquee, stats with `data-count`, services grid, why-split,
about, process steps, pricing/team/timeline/logos/gallery/video/map, reviews
strip, lead, FAQ accordion, contact, footer), with `data-reveal` animation hooks
and **every** user-controlled value escaped (a `<script>alert(1)</script>` name
becomes inert text).

### D. No-AI build path — **Blueprint (no AI)**
- The builder modal gains a **"🧩 Build from Blueprint (no AI)"** toggle.
- `buildSiteWithAI()` passes `deterministic:true` → `POST /api/sites`.
- Backend `generateSiteHtml` gained `opts.deterministic`: **skips the model
  entirely** and composes the sections. On the existing AI path, if the model
  returns junk / empty (the real "failed model" class of bug), it now composes
  the **Blueprint floor** instead of the old skeletal nav+hero+services+contact.
- The end result runs through the v0.0.1.2 Quality Engine, so a no-AI site is
  both content-rich **and** A-grade on the audit.

## 2) MEASURED

| Check | Result |
|-------|--------|
| Industries detected | 19 (+ default) |
| Blueprint sections composed | 10 core, up to **17** with optional blocks |
| phone / email extraction from description | ✅ (+20 100 123 4567, joe@example.com) |
| No-AI `deterministic` build | full `<html>` doc, 10+ sections, ~28 KB |
| Quality audit of a no-AI / garbage-AI site | **> 70** (A/B) |
| "garbage model" floor | coherent 10-section site, no junk leaked |

## 3) FILES TOUCHED

- `backend/src/index.js` — Blueprint engine (detectIndustry / buildContentPlan /
  renderSectionsHtml); `deterministic` mode in `generateSiteHtml` (skips model on
  AI-fail + no-AI); `opts.deterministic` passed through `handleSites` POST+PATCH;
  exported in `__internals`.
- `NexusCRM_V4_Hardened.html` — builder "Blueprint (no AI)" toggle; `deterministic`
  sent on build; `APP_VERSION` → **v0.0.1.3**.
- `tests/test_blueprint.mjs` — NEW suite (29 checks).
- `tests/run_all.mjs` — registered the suite.
- `tests/test_aurora.mjs` — version string assertion updated.

## 4) TESTS ADDED

`test_blueprint.mjs` (29/0):
- A1 industry detection (plumbing/restaurant/SaaS/default).
- A2 content plan (hero, 3–6 services, stats, phone+email, reviews+faq, merges
  scanner shapes).
- A3 section rendering (all `.nx-*` sections, `data-reveal`, XSS-escaped
  script, rich plan → 17-section layout, ≥8 sections).
- B1 no-AI `deterministic` build (full doc, many sections, real contact, no
  fake-AI leak, **audit ≥70**).
- B2 AI-garbage floor (coherent site, no junk, **audit ≥70**).
- C1 frontend (Blueprint toggle present, buildSiteWithAI exposed).

## 5) FULL BATTERY

24 suites: **all green except the pre-existing network-dependent
`test_deploy_studio.mjs` (92/1)**. Route coverage **61/61**.

## 6) SCOPE / NEXT

Slide 2 done. Remaining builder slice options (before moving to the data engine):
**editable content-plan UI** (see/order/edit the plan as it builds), and **live
Blueprint preview in the builder**. Then the big **SQLite data engine**. Nothing
pushed yet — I wait for your go-ahead.
