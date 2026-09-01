# v0.0.1.8 — Graph Foundation II + Structure-Aware Graph Renderer / Canvas Protocol

Ship date: 2026-08-31 · Commit: `v0.0.1.8` (not pushed)

Per your architecture review, the four **missing foundational systems** had to
exist *before* the renderer embeds, so the renderer lands on a **stable contract**
rather than on arbitrary authored HTML. This release ships both halves:

- **Graph Foundation II** (`nx_graph.js`, 44 tests green) — Layout Constraint
  Graph + Solver, first-class State Graph, Asset Graph subsystem, Project
  History/Diff engine, Design Intent→Patch compiler, evidence-based Critic,
  Motion Timeline + Budget, and a guarded Best-Known-Version evolution loop.
- **Graph Renderer + Canvas Protocol** (`nx_render.js`, 27 tests green) — the
  structure-aware, **bidirectional** renderer:
  `PROJECT GRAPH ↕ RENDERING MODEL ↕ VISUAL CANVAS ↕ CODE`, with design & runtime
  modes and a `selectNode/hover/drag/resize/reparent/duplicate/delete/multiSelect/
  group/ungroup/setProperty/setConstraint/setBreakpoint` protocol where **every
  action emits a Project Patch** (never a permanent DOM mutation).

The one governing rule you set is now enforced at the *renderer* layer too: the
AI (and the canvas) only ever emit **structured ops**; the renderer consumes the
graph and regenerates code. This is the contract the AI Director (v0.0.1.9) will
drive.

---

## What landed

### 1. Layout Constraint Graph + Solver (`nx_graph.js`)
- **Relationships, not isolated CSS props.** A node's constraint is a relation to
  its container/siblings (`anchor`/`alignment`/`spacing`/`min`/`max`/`intrinsic`/
  `aspectRatio`/`parent`/`siblings`/`stack`) plus `breakpoints` overrides.
- `nxSetConstraint` validates anchors/alignment/intrinsic/aspect-ratio; `nxGetConstraint`;
  `nxSolveConstraint(constraint, props, breakpoint)` resolves a constraint into
  CSS-ready layout instructions (e.g. `center` → `margin-left/right:auto`, `fill`
  → `width:100%`); `nxSolveLayout(project)` resolves **all** nodes per breakpoint.

### 2. State Graph (first-class data)
- `nxDefineState` / `nxStates` — `default/hover/active/focus/disabled/selected/
  expanded/loading/success/error/open/closed` as first-class per-node data, not
  ad-hoc CSS strings. Invalid states rejected. `nxCompileStateCss` → scoped
  selectors + kebab-cased props (works with the Interaction + Motion graphs).

### 3. Asset Graph subsystem
- `NX_ASSET_KINDS` (`image/video/svg/icon/font/3d/texture/audio/generated`);
  `nxAddAsset` validates kind + rejects unknown; `nxGetAsset(node, viewport)`;
  `nxAssetValidate`; `nxResolveAssetForViewport` — resolves per-viewport variants
  and **flags a heavy asset for mobile** (the "hero.jpg is 520KB on mobile" case
  the AI can reason about). Metadata carries dimensions/aspect/format/size/
  variants/optimization/source/license.

### 4. Project History / Diff Engine (explainable + reversible)
- `nxDiff(projectA, projectB)` → patch ops; `nxSnapshotView(project)` →
  serializable view; `nxHistoryPush` records reason + before/after snapshots;
  `nxHistoryRevert(project, steps)` → inverse ops via re-diff to the stored view.
  Every AI modification is explainable and reversible.

### 5. Design Intent → Patch compiler (preserve reasoning vs execution)
- `NX_INTENTS` (luxury, energetic, minimal, playful, …) → `nxIntentToPlan(intent,
  project)` yields the creative **decisions** (rationale) *plus* the concrete ops
  (e.g. `motion.update`, `token.update`); `nxApplyIntent` applies them through the
  mutation engine. The AI's reasoning stays separate from what executes.

### 6. Evidence-based AI Critic
- `nxCriticEvidence(project)` → `{ problems: [{ problem, evidence,
  expectedEffect, op, confidence(0..1), regressionRisk }] }`. A real rule-based
  critic (WCAG contrast, motion budget, brand coherence) produces an
  actionable, *measured* fix — the loop the AI Director drives.

### 7. Motion Timeline + Budget
- `nxTimeline(role, mood)` → synchronized timeline (e.g. `heading begins 0.10`,
  `CTA begins 0.45`); `nxTimelineCompose(timeline, {offset})` → sorted composed
  events for sequences/parallel/stagger; `nxMotionBudget(project, overrides)` →
  complexity/score/withinBudget under a GPU/WebGL/particles/blur + mobile/reduced
  policy.

### 8. Best-Known-Version evolution loop
- `nxEvolve(project, model, {iterations})` → staged
  `OBSERVE→UNDERSTAND→PLAN→PATCH→RENDER→TEST→CRITIQUE→ACCEPT/REJECT`, keeping a
  **Best Known Version**; a candidate is promoted only if design QA improves **and**
  engineering doesn't regress **and** the motion budget is acceptable. Logged per
  iteration (with result), measured.

### 9. Graph Renderer + Canvas Protocol (`nx_render.js`)
- `nxRenderTree(project)` → the **Rendering Model**: every node bound to its id,
  role, family, props, resolved per-breakpoint constraints, design/content/motion
  slices, states, interactions and asset — the object the canvas and the compiler
  both understand.
- `nxRenderDocument(project)` → the compiler pipeline
  (normalize→validate→constraint solve→style→motion→state→interaction→asset→emit)
  into HTML/CSS/JS with **every element tagged `data-nx-id`**, and a validating
  grade (`valid`/`validationErrors`).
- `nxCanvasAction(project, action, payload)` → the Canvas Interaction Protocol.
  `drag`/`resize`/`reparent`/`duplicate`/`delete`/`setProperty`/`setConstraint`/
  `setBreakpoint` each emit a **Project Patch**; `nxCanvasApply` routes them
  through `nxProjectPatch` (now extended with `constraint.set`/`state.set`/
  `asset.set` ops). `nxCanvas(project)` is the live controller with design/runtime
  modes, `select`/`drag`/`resize`/`setConstraint`/`setBreakpoint` and an
  id-of-node resolver.
- Because the renderer is **graph→code**, editing a graph slice re-renders a
  correct, tagged document — this is the bidirectional path (code→graph→canvas is
  the contract the visual editor drivers consume next).

## Integration
- `nx_graph.js` + `nx_render.js` are injected into **both** the worker
  (`__internals`) and the frontend, each wrapped in an IIFE on a unique global
  (`__NX_GRAPH_API` / `__NX_RENDER_API`) to avoid the `const API` collision with
  `nx_ir.js`; a `__NX_DEPS` registry lets the renderer resolve graph/ir/design.
- `nxProjectPatch` gained `constraint.set`, `state.set`, `asset.set` ops and the
  clone now preserves `constraints/states/assetGraph/history`.

## Test coverage (measured)
- **`tests/test_graph.mjs` — 44 checks** green (Constraint+Solver, State, Asset,
  History/Diff, Intent→Patch, evidence Critic, Timeline/Budget, Evolution).
- **`tests/test_render.mjs` — 27 checks** green (Rendering Model, compiler
  pipeline + tagged document, 13-action Canvas Protocol, bidirectional pass) plus a
  **live browser** check that the frontend exposes the renderer and renders an IR
  project with zero load errors.
- **Full battery: registries incremented.** Route coverage intact.
- Only failing suite is the pre-existing **offline-network**
  `test_deploy_studio.mjs` (Cloudflare needs internet) — unrelated.

### Real bugs found & fixed (by the tests)
1. **`const API` collision** — `nx_graph.js`/`nx_render.js` both declared a
   top-level `const API`, which would `SyntaxError` next to `nx_ir.js`; wrapped
   each in an IIFE with a unique global registry.
2. **`nxHistoryRevert` shape** — wrapped `nxDiffFromView`'s `{ok,ops}` result as
   if it were the ops array; now unwraps correctly.
3. **`nxCanvasAction('setConstraint')`** — emitted `node.set` with field
   `constraint`, unsupported by the mutation engine; now emits the dedicated
   `constraint.set` op that was added to `NX_OPS`.

## Backlog (next)
Per `ARCHITECTURE.md` §10: **v0.0.1.9 = AI Director + Evolution** (embeds the
renderer/canvas into the visual editor, drives the guarded Best-Known-Version
loop), then **v0.0.1.10 = SQLite data engine + agentic assistant on real data +
analytics/reporting**.
