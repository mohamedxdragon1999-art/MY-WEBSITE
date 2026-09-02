# v0.0.1.9 — Make the Project Graph the REAL Website Runtime

Ship date: 2026-08-31 · Commit: `v0.0.1.9` (not pushed)

This release completes the master instruction: the Project Graph becomes the
**canonical source of truth** for an editable website. HTML is now a **compiled
output**, not the representation of the website. The architecture was not
rewritten — it was strengthened and **actually connected and executable**.

To the instruction §30: nothing below is claimed by the existence of a function.
Every item is proven by a behavioral test, and the **mandatory end-to-end
acceptance test (`tests/test_e2e.mjs`, 41/41) drives the whole flow through the
real system with no hand-edited HTML.**

---

## The audit (what was previously only superficial)

| Claimed (v0.0.1.8) | What was actually there | Is now real |
|---|---|---|
| "Atomic" mutation | `__cloneProject` was a **shallow** copy; ops mutated references shared with the caller | True deep clone; isolated candidate; full pre-commit graph validation; deterministic rollback (proven in `test_integrity`) |
| Graph integrity | only "one hero / valid brief" | `nxValidateGraphIntegrity`: root/cycle/parent-child symmetry/duplicate-dangling children/reachability/cross-graph refs; `node.move` rejects descendant cycles; `node.delete` cleans all cross-graph refs |
| Renderer | iterated `project.order`, giant `if role===hero/pricing/footer…`, `js:''`, no nesting | **Recursive, children-driven** via a component-renderer registry; real component sub-graphs; a real runtime script |
| Canvas | `multiSelect/group/ungroup` were **no-ops**; `drag` wrote `offsetX/offsetY` | Real group/ungroup/multi-select graph ops; drag → **semantic constraint** (spacing/anchor/alignment), never accumulated pixels |
| States | Compile to CSS metadata only | Real runtime state behavior (`setState` on live elements) |
| Interactions | Just emitted a `nxBind` template | Runtime implements translate/scale/opacity/color/shadow/toggle-class/update-state/navigate/open-modal/lock-scroll/blur/animate/play-motion |
| Motion | CSS strings only | `nxTimeline` → synchronized `nxTimelineCompose` → `nxRuntimeMotionSpec` → runtime `setProgress` with timeline points + budget |
| Import | none | `nxImportHtml` → HTML→graph with confidence (`extracted/inferred/unknown`) + extracted tokens/assets/cards |

---

## What landed

### 1. True atomic mutation + graph integrity (`nx_ir.js`)
- `nxProjectPatch` deep-clones the project, applies ops on an isolated candidate,
  validates the **whole graph** (integrity + per-node schema) before commit, and
  returns the original on failure. A failed transaction mutates **nothing**.
- `nxValidateGraphIntegrity` + `nxValidateGraphState` + `NX_CONCERN_SCHEMAS`
  (formal schemas for design/content/motion/responsive/interaction/assets/
  constraints/states/metadata).
- `node.move` rejects moving a node below its own descendant; `node.delete`
  removes the node from its parent's children and strips every cross-graph ref
  (design/content/motion/responsive/interaction/assets/constraints/states/
  assetGraph + dangling interaction targets in other nodes).

### 2. Recursive, registry-driven graph renderer + runtime (`nx_render.js`)
- `NX_COMPONENT_DEFS` (family → tag/leaf/void/src/alt) + `NX_CHILDREN` (family →
  real sub-graph). A **Hero is a graph** (hero → grid → stack[heading,paragraph,
  button] + media), **Pricing** is grid → card → heading/paragraph/button. No
  `if role ===` chain; new families plug into the registry.
- `nxSeedComponent` builds any component as a real nested graph atomically.
- `nxRenderTree` (rendering model: parent/children/id/family/variant/resolved
  layout/states/interactions/assets/breakpoint) → `nxRenderDocument` (recursive
  compile to a `data-nx-id`-tagged HTML/CSS/JS document + structural grade).
- `nxRuntimeScript`/`nxRuntimeMotionSpec` — a real runtime that indexes live
  elements, binds states/interactions/IntersectionObserver motion, and advances a
  synchronized timeline; every declared action actually executes.
- A **valid structural subtree renders** even without a hero; page completeness
  (`pageReady`) is a separate publish gate.

### 3. Real canvas (`nx_canvas`)
- `nxCanvasAction` → `nxDragToPatch` (drag → constraint based on parent layout
  model: grid→spacing, flex-row→inline spacing, flex-column→flow spacing,
  absolute→position), `ngGroup`/`ngUngroup` (real container nodes, order/layout
  preserved), real `multiSelect`, `setConstraint`/`setBreakpoint`.
- `nxCanvas` live controller: design/runtime modes, breakpoints, `redraw`,
  `select/hover/drag/resize/group/ungroup`, id-of-node.

### 4. HTML → Project Graph import (`nx_graph.js`)
- `nxImportHtml` parses structural blocks + headings, extracts sections,
  hierarchy, semantic roles, text, images, cards, brand tokens (colors/fonts),
  and binds assets — with per-node confidence. It does not promise perfect
  reverse parsing; it lets existing HTML **enter the graph architecture**.

### 5. Graph-first site builder + Design Studio wiring
- `nxBuildSiteGraph(opts)` — the AI Director feeds intent + brief into this; it
  composes the full page as a graph (nav/hero/features/pricing/testimonials/cta/
  footer), sets constraints, a cinematic motion timeline, interactions, and
  renders it. The graph is the editable artifact; HTML is only its output.
- `POST /sites/:id/design` now also returns `irGraph` (the IR Project Graph) via
  `nxBuildSiteGraph` + `nxRenderDocument` — the running app is now graph-first.
- Backend (`__internals`) and frontend (`window`) both expose the full graph +
  renderer + integrity + import + builder surface; verified live in the browser
  with zero load errors.

---

## Tests (measured, behavioral)

| Suite | Checks | Covers |
|---|---|---|
| `test_integrity.mjs` | **29** | atomic mutation (failed txn mutates nothing), integrity, cycle/dangling/symmetry, delete clean, schemas |
| `test_render_v2.mjs` | **80** | real component children, recursive registry rendering, runtime, group/ungroup/multi-select, semantic drag, breakpoint, graph-first builder |
| `test_import.mjs` | **18** | HTML→graph import + confidence + tokens/assets |
| `test_e2e.mjs` | **41** | **the mandatory end-to-end acceptance flow** |
| `test_design_route.mjs` | **22** | design route returns `irGraph` (graph-first) + integrity |
| `test_ir.mjs` | 62 | IR contracts/engine (unchanged, still green) |
| `test_graph.mjs` | 44 | graph systems (unchanged, still green) |

Full battery: **34 suites**. Only the pre-existing offline-network
`test_deploy_studio.mjs` fails (Cloudflare needs internet, unrelated). Route
coverage **62/62**.

### Real bugs found & fixed (by the tests)
1. **Inverted `node.move` descendant check** — rejected valid reparents back to
   an ancestor (broke `ungroup`); now rejects only moving a node below its own
   descendant.
2. **`nxSeedNode` ignored `spec.props`** — component sub-graph lost `level`,
   `tone`, etc.; now merges them (so heading `level` → h1/h2/h3).
3. **Leaf renderer emitted no `>`** — markup collapsed; fixed.
4. **`asset.set` auto-injected `id`** — rejected by the asset schema; allowed.
5. **`</script>` in the emitted document** — terminated the page's own inline
   `<script>` (classic injection bug); escaped to `<\/script>`.
6. **`nxNewProject('brief')`** — now accepts an existing brief object.
7. **Importer** — tag hint short-circuited text hints (hero→section) and mapped
   `section`→`features`; fixed.

---

## Backlog (next)
The graph is now real, recursive, integrity-checked, and graph-first in the app.
Per §10: embed the canvas as a full visual editor surface (drag/select/snap on a
live DOM overlay driving patches), then wire the **AI Director** to drive the
graph (OBSERVE→UNDERSTAND→PLAN→PATCH→RENDER→TEST→CRITIQUE→ACCEPT/REJECT) as its
primary mode, then SQLite data engine + agentic assistant on real data.
