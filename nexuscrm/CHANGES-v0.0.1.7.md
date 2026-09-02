# v0.0.1.7 — AI IR + Project Mutation Engine (the architecture foundation)

Ship date: 2026-08-31 · Commit: `v0.0.1.7` (not pushed)

This is the **architecture-first** release you requested: I *don't* start the
renderer/motion/orchestrator from the old backlog. Instead I land the contracts
everything else will sit on, so those layers can't be retrofitted later. Per your
assessment of v0.0.1.6, the ordering is: **IR contracts + schemas → Project
Mutation Engine → Design Brief → Constraint/Layout → Interaction Graph → motion
composition → compiler pipeline → Design-QA methodology → AI Critic→Patch loop.**

The one governing rule from your review, now encoded: **every AI action becomes a
structured patch. Never `rewrite hero HTML`.** And the IR *preserves* creative
decisions — it doesn't replace AI judgment.

---

## What landed (`nx_ir.js`, 62 tests green)

### 1. Formal IR contracts + schemas
- `NX_NODE_FIELDS` / `NX_NODE_SCHEMA` — explicit allowed content for every slot
  (`id/type/parent/children/semanticRole/component/props/styles/tokens/content/
  design/motion/responsive/interactions/assets/metadata`). `nxValidateNode` rejects
  anything outside the contract (e.g. `props.onload` — the layout contract is
  enforced). `nxValidateProject` enforces structure invariants (one hero, no
  dangling order entries, valid brief). No two functions can interpret a node
  differently.

### 2. Project Mutation Engine (the big one)
- `nxProjectPatch(project, ops)` — applies an **ordered list of structured ops
  atomically**: if any op fails validation, nothing commits (full rollback).
- Named ops: `nxNodeCreate`, `nxNodeDelete` (cascades descendants), `nxNodeMove`,
  `nxNodeReplace`, `nxSetProperty`, `nxTokenUpdate`, `nxMotionUpdate`,
  `nxResponsiveUpdate`, `nxAssetReplace`, `nxInteractionAdd`.
- **Concern graphs are strongly separated** (component = what it is, design = how
  it looks, content = what it says, motion = how it moves, responsive = per-viewport,
  interaction = user effect, assets = what it shows) — all keyed by node id, so a
  `Button` isn't one blob of everything. `nxTokenUpdate` is **design-memory safe**:
  it changes only the key you touch and preserves the rest.

### 3. Design Brief (persistent creative intent)
- `nxBriefFromPrompt(prompt)` deterministically extracts
  `brand/audience/industry/goal/tone/visualStyle/colorDirection/
  typographyDirection/layoutStyle/motionMood/density/imageryStyle/3DStyle/
  conversionGoal/responsivePriority/accessibilityPriority`. `nxBriefValidate`.
  Flow: `prompt → DesignBrief → exploration → direction → Project Graph`. This
  stops the AI losing the original artistic intent across many iterations.

### 4. Constraint / Layout Engine
- `nxLayout` / `nxResolveLayout` / `nxDeriveResponsive` — Framer-like layout
  (`stack/grid/flex/columns/gap/align/maxWidth/padding/width-hug-fill`), and
  responsive derive **intelligently** from the base layout (grid/flex ≥2 cols
  collapse to a stack on tablet/mobile) instead of hand-tuning every element.
  Explicit per-node rules win.

### 5. Interaction Graph (first-class)
- `trigger/target/state/actions` with validation (`NX_INTERACTION_TRIGGERS/ACTIONS`),
  compiled to runtime JS (`nxCompileInteractions`) — interaction logic never gets
  tangled in arbitrary generated JavaScript.

### 6. Motion composition (not "add fade-in")
- `nxMotionComposeIR(mood, role)` builds a composed profile — e.g. cinematic hero
  = `heading-reveal + subtitle-reveal + cta-spring + background-parallax +
  3d-rotate + particle-drift + scroll-transition`. `nxCompileMotion` → keyframes.

### 7. Compiler Pipeline
- `nxCompile(project)` = normalize → validate → **layout resolve** → **style
  resolve** (tokens → CSS vars) → **motion compile** → **interaction compile** →
  (asset resolve) → code. The same IR can later target HTML/React/Next/Astro.

### 8. Design-QA methodology (no single "beauty" number)
- `nxDesignQAProject` returns irreducible sub-scores —
  **`structural` / `visual` / `brand` / `motion`** — plus 13 reproducible category
  scores (hierarchy, spacing, alignment, typography, contrast, colorHarmony,
  density, consistency, composition, visualRhythm, responsiveComposition,
  animationQuality, brandCoherence), with real WCAG contrast.

### 9. AI Critic → prioritized Patch → re-evaluate loop
- `nxCritic` (device: P1/P2/P3 priority, severity-ordered) → `nxPatchPlan`
  (ordered ops) → `nxDesignLoop` which applies patches through the mutation
  engine, re-renders, re-evaluates, and converges. Autonomous refinement, not
  one-shot generate-and-score.

### Integration
- IR injected into **both** the worker (`__internals`) and the frontend (`window`),
  with a `__NX_DESIGN` capture shim so `nx_ir` reuses the design system's
  color/token helpers without name collisions (validated in the browser live).
- Design IR functions exposed to the builder UI.

## Test coverage (measured)
- **`tests/test_ir.mjs` — 62 checks**, green, covering all nine areas above.
- **Full battery: 29 suites.** Route coverage **62/62**.
- Only failing suite is the pre-existing **offline-network** `test_deploy_studio.mjs`
  (Cloudflare needs internet) — unrelated.

### Real bugs found & fixed (by the tests)
1. **Duplicate `function nxDesignQA`** — illegal in ESM, would `SyntaxError` on
   injection; renamed the IR entry to `nxDesignQAIR` and exported it as `nxDesignQA`.
2. **Atomic rollback** — the applied-commit counter wasn't cleared on a failed op
   (the `applied` array), so the transaction looked partially committed; now
   commits *nothing* and clears `applied`.
3. **`asset.replace` inconsistency** — wrote a bare asset object over the per-node
   asset list; now keeps the node assets array and the asset graph pointing at it.
4. **`orderOk` penalty** — the rubric flagged a *valid* nav-then-hero ordering and
   made a 6-section site score *lower* than a lone hero; fixed and reversed.
5. **Critic targeting `"hero"` literal id** — would fail on real node ids; now
   resolves the actual hero id.

## Backlog (next)
Per `ARCHITECTURE.md` §10: now the contracts are stable, build the
**structure-aware Renderer on the graph**, then the **AI Director/Evolution
orchestrator**, then the SQLite data engine + agentic assistant + analytics.
