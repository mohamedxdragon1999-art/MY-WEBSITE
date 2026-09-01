# ═══════════════════════════════════════════════════════════════════
# CHANGES FILE — GET v0.0.1.2 "QUALITY ENGINE" ONTO THE MASTERPIECE PROGRAM
# Updated 2026-08-31 · builds on committed v0.0.1.1 (fd74adf)
# ═══════════════════════════════════════════════════════════════════

## 0) WHAT THIS RELEASE IS

This is **Phase 1 / slide 1** of the agreed multi-phase "go big" program — the
**AI website-builder mega-upgrade**. The first thing I shipped is a **Website
Quality Engine**: a deterministic, zero-dependency **audit + enhancement**
layer that sits on top of the existing design system and that **every** AI-built
site is pushed through automatically.

It is the highest-leverage first slice because it is the single most visible +
testable upgrade to the builder: instead of just producing a page, the builder
now **guarantees** on-page SEO, accessibility, performance and mobile hygiene,
**shows you a live Lighthouse-style score in the preview**, and lets you
**auto-optimize in one click** (before → after, measured).

I am deliberately **not** claiming "10× / 100× / 300× better". Those are
invented. What I report below is **measured**.

## 1) WHAT'S NEW IN v0.0.1.2

### A. Deterministic site audit — `auditSiteHtml(html)`
Pure, zero-I/O, runs identically in the browser and the worker. Returns:
`{ score, grade, categories[5], issues[], checks{} }` across five weighted
categories (SEO 30% · Performance 25% · Accessibility 20% · Best Practices 15%
· Mobile 10%), with per-check pass/max and an **actionable issue list** sorted
by severity. No network, no DOM, no Lighthouse binary.

### B. Deterministic site enhancement — `enhanceSiteHtml(html, name, opts)`
Idempotent (run it twice → byte-identical) pass that injects only what's
missing:
- `<html lang>`, `<meta charset>`, `<meta viewport>`, `<title>`, meta
  description (auto-derived from description/h1/p if absent)
- **Open Graph** (title/type/description/image) + **Twitter card**
- `robots`, `theme-color`, `color-scheme`
- **preconnect** to Google Fonts when a web font is used
- **JSON-LD structured data** (LocalBusiness / Restaurant / Store /
  MedicalBusiness / Organization), `<` escaped for safety
- favicon **emoji → inline SVG data-URI** (no external asset needed)
- `<img>` → `loading="lazy"` + `decoding="async"` + `alt` (auto-named from src)
- `target="_blank"` → `rel="noopener noreferrer"`
- **base accessibility/mobile layer** injected only when the page has *no*
  `<style>` at all: `:focus-visible` rings, `prefers-reduced-motion`,
  responsive images, 44px touch targets, small-screen type scale

### C. Live quality UI in the builder + preview
- **Preview modal** now has a 🔬 **Audit** button, a ⚡ **Optimize** button, a
  live **grade chip** (e.g. `A 85/100`), and an on-screen report with per-category
  bars + actionable issues.
- **Site list** rows gain a 🔬 **Audit** card action → a dedicated **Site
  Quality** modal that shows current score, the reachable optimized score, +
  `+delta`, and a one-click **Optimize & Save** (persists via `PATCH /sites/:id`).
- A local (no-backend) build is now routed through `enhanceSiteHtml` too.

### D. Backend quality guarantee + endpoint
- `generateSiteHtml` (modern design-system path) and `aiBuildSite` (legacy
  prompt path) both **enhance their output before returning** — so a published
  site is always quality-hardened.
- New **`GET /api/sites/:id/audit`** returns `{ before, after, report,
  optimizedHtml, optimizedReport }`.

### E. Version + test
- `APP_VERSION` → **v0.0.1.2**.
- New suite **`test_site_quality.mjs`** (backend + frontend, 38 checks).

## 2) MEASURED (real numbers, not claimed multipliers)

| Input page                        | Audit score | Grade |
|-----------------------------------|-------------|-------|
| Bare AI output (no meta/no lazy/noopener) | **33** | **F** |
| Same page after `enhanceSiteHtml` | **85** | **A** |
| Fully-optimised authored page (ceiling)  | **88** | **A** |

- **Delta on a bare page: +52 points (F → A)** by a single deterministic pass.
- Crude count of SEO/a11y categories: SEO 27 → 81, Accessibility 33 → 93,
  Best Practices 20 → 100, Mobile 0 → 80, Performance 63 → 75.
- Enhancement is provably idempotent: `enhance(enhance(x)) === enhance(x)`.

## 3) FILES TOUCHED

- `NexusCRM_V4_Hardened.html` — engine (audit+enhance), preview/site-list audit
  UI, local-build routing through enhance, `APP_VERSION`.

  Note: the engine block is **duplicated verbatim** in the worker because the
  frontend and worker are separate artifacts that cannot share a module. They are
  kept in sync by `tests/test_site_quality.mjs` (runs both).
- `backend/src/index.js` — engine, enhance applied at end of `generateSiteHtml`
  and `aiBuildSite`, new `/sites/:id/audit`, exported via `__internals`.
- `tests/test_site_quality.mjs` — NEW suite.
- `tests/run_all.mjs` — registered the new suite.

## 4) TESTS ADDED

`test_site_quality.mjs` (38/0 green):
- A1 audit: score range, grade, 5 categories, low score on bare page, issues,
  flat checks map.
- A2 enhance: injects title/description/lang/OG/Twitter/JSON-LD/robots/theme/
  lazy+alt/noopener, **idempotent**, real **delta ≥ 30**.
- A3 `/sites/:id/audit`: create+audit, before < after, optimizedHtml returned,
  auth rejection.
- A4 AI build: `build_with_ai:true` creates a well-formed page, auditable,
  PATCH-optimize persists, re-audit confirms `after ≥ before`.
- B1 frontend (jsdom): engine exposed, preview modal renders audit chip + panel,
  no runtime errors.

## 5) FULL BATTERY

23 suites: **all green except the pre-existing `test_deploy_studio.mjs`
(92/1)** — a network-dependent Cloudflare integration probe that 400s in the
no-internet sandbox (confirmed pre-existing across v0.0.1.1 and earlier). Route
coverage **61/61**.

## 6) SCOPE / NEXT

This is slice #1. The remaining big-program phases — **SQLite data engine**,
**agentic AI assistant**, and **analytics/reporting suite** — are queued and
each gets its own before/after benchmark + battery. I did **not** push; do not
push until you confirm.
