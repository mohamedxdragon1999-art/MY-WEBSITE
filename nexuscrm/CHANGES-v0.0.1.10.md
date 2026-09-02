# v0.0.1.10 — Close the architectural gaps: graph-native persistence, one source of truth, visual evidence QA

Ship date: 2026-08-31 · Commit: `v0.0.1.10` (not pushed)

## Gap 1 — Graph-versioned persistence (CLOSED)
`site_versions` stored only **HTML**, so revert meant "Project → HTML → try to
reconstruct what the project was." Now:

- `sites` and `site_versions` have a **`graph` TEXT column** (the canonical
  IR/Project Graph). HTML is a compiled projection.
- **Checkpoint** captures the full graph alongside html; the snapshot list surfaces
  `graph_size`.
- **Restore is graph-first**: it restores **the graph** and **recompiles the HTML**
  from it (`recomputed=true`), so you get back exactly the design — never an
  HTML-only probe. Legacy HTML-only snapshots still restore via the html fallback.
- Design Studio save persists the graph and snapshots the prior graph.
- Idempotent cached migration (`__ensureSiteGraphColumns`) upgrades pre-existing
  DBs without breaking fresh `schema.sql` databases.

Net model: **Project → IR Graph → persisted snapshot → compile/render.**

## Gap 2 — One source of truth (mostly CLOSED; migration path built)
The legacy `generateSiteHtml`/`build_with_ai` path is a deterministic composition
engine. Rather than keep HTML as a second world, we now have a first-class
**HTML → Graph migration bridge**:

- New **`POST /sites/:id/import`** route: takes *any* site's HTML (including a
  legacy `build_with_ai` output), imports it to a Project Graph via `nxImportHtml`
  with **confidence tagging (`extracted`/`inferred`/`unknown`)**, persists the graph
  as the canonical artifact, and **re-renders the site from that graph**.
- Imported graph is then the authority: snapshot it, re-render from it, restore it
  graph-first.

So a legacy site can enter the graph world and become a single-source-of-truth
project. This is the migration path the master instructions describe
(HTML/CSS analysis → semantic interpretation → component detection → graph
reconstruction → editable project).

## Gap 3 — Visual evidence QA (CLOSED for model-driven evidence; pixel screenshots still future)
Design QA was a heuristic HTML/graph scorer. Now there's a **visual evidence engine**
(`nx_graph.nxVisualEvidence`):
- resolves the layout model into **computed geometry** (display/columns/gap/
  direction/width),
- measures **per-node accessibility** (alt, accessible name, heading level) and
  **per-node contrast** from real fg/bg tokens,
- derives a **document evidence model** (contrast, heading hierarchy, a11y counts,
  responsive coverage, motion budget, reduced-motion),
- emits **evidence-backed problems** each carrying the required
  `Problem / Evidence / Expected effect / Proposed operation / Confidence /
  Potential regression` fields.
- Wired into `nxEvolve` observability (the director records `visualEvidence`).

### Two real defects the evidence engine surfaced — and I fixed
1. **Heading order was broken**: the nav brand was an `<h3>` *before* the hero
   `<h1>`. Brand is now a plain `text` lockup (new `text` component family), so the
   outline starts at the hero `h1`. The hierarchy heuristic now only flags true
   forward skips (h1→h3), not legitimate returns to a shallower sibling.
2. **Responsive was not graph-authoritative**: the graph authored **0** responsive
   rules (only a global CSS fallback). `nxBuildSiteGraph` now calls `nxApplyResponsive`,
   so every multi-column node carries an explicit responsive rule **in the graph**;
   the renderer compiles per-node reflow (mobile → flex column). Evidence now reads
   8/48 responsive nodes.
3. **Latent design-schema inconsistency**: the property-panel/canvas wrote flat
   presentational design keys (`fontSize`, `fontWeight`, `color`, `opacity`…) that
   the design concern schema **rejected** — producing invalid graphs even though the
   styles rendered. The design schema now allows those flat presentational keys, so a
   property-panel edit is a **valid** graph mutation. The default builder also now
   declares a `reducedMotion` token.

## Gap 4 — REAL BROWSER VISUAL EVIDENCE (Phase 1 §16/§17/§37) (CLOSED)
The evidence engine was model-derived (computed from graph tokens/CSS, not from a
render). Per the master directive, screenshot/geometry QA must come from a real
browser — the AI should be able to say "I built this, **rendered it**, inspected it,
found a problem, fixed it, rendered again, verified." This gap delivers exactly that.

New `nx_evidence.js` (real-browser evidence runner, CommonJS, lazy Playwright):
- **`nxBrowserAvailable()`** honestly reports whether a real Chromium can launch.
- **`nxCaptureEvidence(html, {breakpoints})`** → for each of desktop/tablet/mobile:
  a real **full-page PNG screenshot** (base64), **per-`data-nx-id` computed
  DOM geometry** (bounding box, display/flex/grid, gap, font, color) plus **resolved
  background** (walks ancestors, not the node's own transparent bg), per-node a11y
  (accessible name, alt, heading level), and **console + page + network errors**.
- **`nxEvidenceQa(evidence)`** → structured problems each carrying
  `Problem / Evidence / Expected operation / Confidence / Regression risk`
  (contrast, text-too-small, horizontal overflow, element overlap).
- HONESTY RULE: when no browser is available every function returns
  `{available:false, reason}` and **never fakes a screenshot or geometry**. We never
  claim pixel QA unless a real render produced it.

New **`tests/test_evidence_browser.mjs`** (28 checks, registered in `run_all.mjs`):
asserts real browser facts — a screenshot exists, nodes are measured (w/h numeric),
no console/page/network errors, responsive differs between breakpoints, contrast is
correct on the dark theme, and QA is structured + doesn't fabricate. **It skips
honestly (exit 0) when no browser is present** and must NOT count as a pass for
browser-level guarantees in that case.

### Three real defects the browser caught — and the fixes
1. **REAL rendering bug — black text on a dark theme.** The compiled output did not
   apply the theme foreground token, so nav links + hero text rendered
   `color: rgb(0,0,0)` on the `#04070f` dark theme = invisible. `__componentCss` now
   wires `body{background:var(--nx-bg);color:var(--nx-fg)}` (+ heading fg), so
   inherited text uses the theme token. Verified: nav/hero text is now
   `rgb(245,245,247)` on `rgb(4,7,15)` (≥4.5:1), and the light theme is dark-on-white.
2. **Contrast QA false-positive storm.** `nxEvidenceQa` compared text color against a
   node's own *transparent* background → black-on-black ⇒ 40+ bogus "below AA"
   problems. It now resolves the **effective background by walking ancestors** and
   skips when it's genuinely transparent. 43 → 0 fabricated contrast problems.
3. **a11y API crash.** `page.accessibility.snapshot` isn't a method in this Chromium
   build and threw `Cannot read properties of undefined (reading 'snapshot')`,
   corrupting evidence with a fake page error. The runner now falls back to an
   **honestly-derived a11y summary** from measured nodes (`a11yAvailable` + `a11yNote`
   saying "AX snapshot API unavailable … derived"), never a fabricated AX tree.

Also fixed a root cause underneath all three: the page-injection string was full of
`\\d`/`\\s`/`\\(` escapes that collapsed differently when the template literal was
parsed, leaving a broken regex (so `_solid` couldn't match digits and every node
resolved to the white fallback). The `_solid`/`__isSolidBg` helpers are now
**backslash-free** (parse the alpha channel via `indexOf`/`slice`/`split`), giving
**48/48 nodes a correct resolved background** on both themes.

## Honest remaining limitations
- The specialized **legacy composition sections** (WebGL 3D scene, Spline, marquee,
  lightbox, FAQ accordion, count-up stats) are still authored by the legacy engine
  and **imported** into the graph at lower confidence (`extracted`/`inferred`). They
  are not yet *natively* graph-authored. That's the documented migration path, not a
  silent loss.
- The browser now renders and screenshots in the sandbox (Playwright + Chromium are
  installed). QA reports **genuine remaining design defects** (7 element overlaps on
  desktop/tablet, 2 horizontal overflow on tablet/mobile) — the evidence loop works;
  those are the next repair targets, not hidden.
- `test_deploy_studio.mjs` still needs live Cloudflare network (offline in the sandbox).

## Tests added (behavioral)
- `test_graph_version` (23) — graph persistence, checkpoint fidelity, graph-first
  restore w/ recompiled HTML, legacy fallback.
- `test_visual_evidence` (17) — computed geometry, a11y/contrast evidence,
  evidence-backed problems, responsive + reduced-motion authored, true negatives.
- `test_import_bridge` (17) — legacy HTML → graph w/ confidence, persisted, re-rendered,
  graph-first restore, error surfacing.
- `test_render_v2` 117 → 120.

## Measured full battery
**40 suites · 39 green.** Only the offline-network `test_deploy_studio.mjs` fails
(92 honest-failure checks pass locally). Route coverage **62/62**.

## Gap 5 — REAL high-quality design + PROVEN repair loop (Phase 1 upgrade)
The milestone level — and the site itself — was far below the brief. The builder
emitted a wireframe ("Welcome / What we do / Ready?"), cards rendered empty (a real
renderer bug), there were no design scales, and QA was not yet *proving* improvement.
This upgrade makes the loop produce a genuinely production-grade site, and **proves**
Generate → Render → See → Diagnose → Mutate → Verify.

### Renderer: components are now REAL nested graphs, not strings
- New families + a registry-driven composition layer: `eyebrow`, `icon` (inline SVG
  glyph bank), `badge`, `avatar`, `statValue/statLabel`, `quote`, `divider`, `media`
  visuals, `benefit`, `logos`. The renderer walks children (recursive), so a hero is
  literally `hero → grid → [copy(stack→eyebrow/heading/paragraph/CTA/trust) + media]`.
- **Product visual** built entirely from graph nodes (app window with chrome, stat
  grid, live-automation flow rows, toolbar) — no fixed heights, no nested HTML strings.
- **`card` fixed**: it previously rendered empty because it had no leaf/content path;
  cards now use `children`, so feature/testimonial/plan cards are real composed graphs.
- `__attrHtml` emits design-sheet presentation + `data-nx-tone`; `__renderRec` supports
  a family `render` hook (SVG icons, avatar initials); `box-sizing:border-box`,
  `minmax(0,1fr)` grids, and `min-width:0` so content never forces overflow.

### Design-system value
- A coherent dark cinematic language driven by tokens: radius/shadow/border/surface
  variables, primary/secondary/ghost button tones, card hover, section rhythm,
  ambient hero glow gradient, `prefers-reduced-motion` guard, spacing scale tokens.

### Graph is the source of truth for responsive AND the fix
- New `__responsiveRulesCss(project)`: compiles each node's **authored graph
  responsive rule** into real `@media` CSS keyed by `data-nx-id`, so the browser honors
  a per-node reflow — not just a global media query. Mobile is now a genuinely DIFFERENT
  composition (nav links hidden, hero & dashboard stats stack, pricing stacks) with
  **0 overflow**, authored via `responsive.update` graph ops.
- The evidence engine now auto-resolves the **effective background by compositing
  alpha bottom-up** (so a 10% orange tint resolves to the dark body → correct contrast,
  0 false positives) and captures `parentId` so **ancestor/descendant containment isn't
  misreported as overlap**.

### PROOF: the repair loop (in `test_evidence_browser.mjs`)
`Generate → Render(Chromium) → Evidence → Diagnose → Graph mutation → Re-render →
Verify`:
- Inject two REAL defects via **graph mutations** (heading → black; pricing grid → 5 cols).
- Re-render from the graph → **browser catches both** (contrast + overflow), each
  referencing a graph node id with evidence + proposed op.
- Apply **graph repair mutations** (color token, columns) → re-render → **0 problems**.
- Metrics improved 2 → 0. The fix went through the graph, never patching HTML.

### Measured
- **0 QA problems on the default build** (desktop/tablet/mobile): no overflow, no
  contrast, no overlap, no tiny text, 0 console/page/network errors, 294 real nodes,
  a11y derived, 15 headings in a valid outline.
- `test_evidence_browser` 28 → **36**; `test_render_v2` 120 → **242**.
- Full battery **41 suites, 40 green + only the offline-network
  `test_deploy_studio.mjs`**; route coverage 62/62. Re-baked renderer into
  `NexusCRM_V4_Hardened.html` + `backend/src/index.js` (one source of truth; `</script>`
  escaped for the HTML embed).

## Tests added (behavioral)
- `test_evidence_browser` 28 → 36 (adds the full **before/after repair loop** proof).
- `test_render_v2` 120 → 242 (recursive registry, real card children, responsive graph
  authoring, runtime interactions).

## Measured full battery
**41 suites · 40 green.** Only the offline-network `test_deploy_studio.mjs` fails
(92 honest-failure checks pass locally). Route coverage **62/62**.
