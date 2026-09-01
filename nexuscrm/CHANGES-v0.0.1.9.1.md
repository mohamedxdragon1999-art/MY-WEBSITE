# v0.0.1.9.1 — Hardening pass: fix real placeholder logic + accessibility (pre-v0.0.1.10)

Ship date: 2026-08-31 · Commit: `v0.0.1.9.1` (not pushed)

Before moving to v0.0.1.10 I swept the previous upgrades for **real** defects
(each fixed because a test exposed it — not because a function existed). This is
also the honest accounting for the mass failure the user hit.

## The single biggest "not working" cause (environment, not code)
`node_modules` is an **excluded snapshot path** — it's wiped between turns. Every
suite that `import`s the backend worker or `jsdom` then **crashed at import
(`Cannot find module 'sql.js'` / `jsdom`)**, so ~25 suites reported `CRASHED /
no summary` and route coverage dropped to 0. That cascade looked like "thousands
of failures" but was one missing install. `npm install` restores it (declared in
`package.json`). Full battery returns to **35/36 green** (route coverage 62/62).

## Real code/logic fixes

### 1. `nxCompare` was a placeholder (`designQADelta: 0`) → now measured
- Returns the real op diff + a **measured** Design-QA delta and the
  structural/visual/brand/motion sub-deltas. Comparing a project to itself yields
  `delta === 0` + empty ops; comparing good vs bad yields a real number.

### 2. `nxHistoryRevert` returned ops but never restored → now a real version restore
- Snapshots are now a **deep, full-state copy** (nodes/order + every concern graph
  + tokens + brief), not just content strings.
- `nxHistoryRevert` returns an actual **restored project** (`project`) you can use,
  plus the ops describing the change. Verified: edit headline + token → revert →
  headline and token return to their prior values and the graph stays valid.
- `nxDiff` is now one honest "what changed" reporter (tokens, node add/remove,
  per-node content/props/design/motion), replacing the earlier duplicate/limited
  diff.

### 3. Design Studio was building TWO model graphs → now graph-canonical
- The `/sites/:id/design` route built the old `nxProject` model AND a new IR graph
  separately, returning HTML from the old model — so what the user edited (graph)
  could differ from what they previewed/saved. Now the route returns the
  **graph-compiled HTML** as the canonical `html` (irGraph/irHtml/legacyHtml
  retained). Edit == preview == save.
- `nxBuildSiteGraph` now honors explicit `primary`/`accent`/`motionStyle` tokens
  and derives a coherent **dark theme** (dark bg + light fg) from a dark brand, so
  a "futuristic dark" brief isn't text-on-white.

### 4. Accessibility: real `prefers-reduced-motion`
- The renderer was missing a CSS reduced-motion guard (only runtime flags existed),
  and the runtime's `reduced` flag was mis-labeled (derived from a *motion token*
  like `'fade'`, not the user's actual preference). Now:
  a CSS `@media (prefers-reduced-motion: reduce)` block freezes
  transitions/animations, and the runtime detects reduced motion via
  `matchMedia` **at runtime** (not baked from a token) and skips motion.

### 5. `nxValidateGraphIntegrity`/`nxValidateGraphState` exposed and enforced
- Exported via `__internals` and `window`; the Design route + tests now actively
  assert integrity on the delivered graph (previously implicit).

## Tests added (behavioral)
- `test_version.mjs` (16) — snapshot fidelity, real revert restores the graph,
  honest `nxDiff` (directional), measured `nxCompare` delta.
- `test_projects.mjs` (14) — **four integration projects** (SaaS/Luxury/
  Restaurant/Portfolio) built + rendered through the real graph; includes an
  arbitrary nested menu/gallery graph to prove recursion and that **every node
  renders exactly once**.
- `test_render_v2.mjs` (80 → 86) — dark-theme coherence + `prefers-reduced-motion`
  CSS + runtime detection.
- `test_design_route.mjs` (20 → 22) — asserts the endpoint returns a valid IR graph
  and that integrity holds across the page.

## Measured test results (full battery)
- **36 suites. 35 green.** Only the pre-existing offline-network
  `test_deploy_studio.mjs` fails (needs live Cloudflare; its 92 honest-failure
  checks pass locally). Route coverage **62/62**.
- New/updated: `test_render_v2 86`, `test_e2e 41`, `test_graph 44`, `test_ir 62`,
  `test_integrity 29`, `test_import 18`, `test_version 16`, `test_projects 14`,
  `test_design_route 22`, `test_aurora 44`.

## Batch 2 — performance-aware motion + theme-aware Design QA (added in this pass)

- **Motion budget is now ENFORCED, not a comment.** `nxRenderDocument` reads the
  budget and, when it's exceeded (or the viewport is mobile/tablet), strips
  GPU-heavy primitives (`3d-rotate`, `background-parallax`, `particle-drift`,
  `blur`, `webgl`, …) from the runtime motion spec and emits a `__budgetCss`
  safety block that neutralizes heavy effects. New `NX_HEAVY_PRIMITIVES` export.
  This is the "cinematic but performance-safe" guarantee now backed by a test.
- **Design QA is theme-aware.** `nxDesignQA` (the HTML scorer) used to pick "first
  dark hex = text, first light hex = bg," which misread a DARK theme as text-on-
  white/low-contrast. It now reads the actual `--nx-bg` / `--nx-fg` (or
  `--nx-primary`) tokens the compiler emits, so a dark theme scores its real high
  contrast (verified: dark 18.5:1, light 13.1:1).
- **`__attrHtml` no longer emits `width:` twice** when both a constraint width and a
  numeric props width are set.
- **`node.create` honors an `index`** for sibling insertion (powers the duplicate
  copy landing adjacent to its source).
- render_v2 91 → 105 (budget enforcement + theme-aware QA), test_canvas 27.

## Batch 1 — renderer/canvas overhaul (commit 480499d)
- **Canvas never mutated** (immutable `nxProjectPatch` not adopted) → controller now
  adopts the returned project; every edit lands on the live graph.
- **Duplicate** was a shallow root-level shell → now a deep, in-place copy (same
  parent, adjacent, content/design/motion/responsive/interactions/subtree preserved).
- **Drag** clobbered constraints → now preserves intrinsic/fill/max.
- **Design props never rendered** → `__attrHtml` now emits color/typography with units.
- **Renderer was O(n²)** → tree solved once per document and threaded through.

## Batch 3 — AI chooses the graph shape + runtime interactions proven (this pass)

- **The AI's hero-direction now shapes the graph.** The design route computed a
  `heroVariant` (`3d-centered` for futuristic directions, else `split`) but never
  passed it to the graph builder — so a "futuristic/3D" brief still rendered a
  plain split hero. Now `nxBuildSiteGraph` honors `heroVariant`, and the hero
  children factory is **variant-aware**: a `3d-centered`/`cinematic` hero composes
  a centered single-column stage (heading → sub → CTA → 3D/media), while the
  default `split` hero stays a two-column grid. The variant is recorded in the
  graph (the editable artifact), not just a renderer cosmetic. Verified the
  centered hero clears `columns` so it doesn't render a bogus 2-col grid.
- **Runtime interactions/hover states are proven to EXECUTE** (instruction #16):
  a compiled page is dropped into real jsdom, the hero CTA is clicked, and the
  declared `scale(1.08)` + `update-state(active)` actions are asserted to run
  (`data-nx-state='active'`, `transform: scale(1.08)`); a declared hover state is
  shown to compile CSS and set `data-nx-state='hover'` on mouseenter.
- test_render_v2 91 → 117 (budget, theme-aware QA, hero-variant, runtime
  interactions). Full battery 37 suites / 36 green (only offline deploy_studio).

## Batch 2 — performance-aware motion + theme-aware Design QA
- `generateSiteHtml`/`build_with_ai` remains the deterministic+AI composition
  system (stores theme/plan/instructions in `site_meta`) — a legitimate
  compatibility path, not arbitrary HTML rewriting; it is not yet graph-serialized.
- Site versioning in the DB (`site_versions`) still stores HTML (not the full graph
  snapshot) — graph-versioned persistence is the next milestone.
- Design QA is still heuristic (sub-scores); screenshot/geometry evidence pipeline
  is future work.
