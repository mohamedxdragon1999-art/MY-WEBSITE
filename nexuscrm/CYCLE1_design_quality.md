# Cycle 1 — Design Quality Foundation

**Goal:** Stop the generator from producing generic, template-like, "AI-soup" pages and make
the actual emitted websites read as *intentional, professional design* — while keeping the
Project Graph as the real runtime (no rewriting the architecture; strengthening it).

This cycle delivers the **measurable foundation** the art-director loop is built on. Every
new function is graph-authoritative (reads/writes the same Project Graph the renderer
compiles), so decisions are editable and survive into the emitted site.

> Philosophy applied — **"make it generate better", not "make it generate more":**
> *less generic, more intentional; less clutter, more hierarchy; less decoration, more
> composition; less repetition, more variety; less arbitrary scale, more coherent systems;
> less motion everywhere, more purposeful motion; less content, better content.*

---

## What was built (in `backend/src/index.js`, the project-graph IR engine)

### 1. Coherent scales — not random values
`NX_SCALES` gives a type scale ratio, a spacing rhythm, radius/shadow/container measures and
a motion cadence. An AI may pick *which* family, but the values stay internally consistent
(`typeScale.hero > base`, rhythm `[1,2,3,4,6,8,12]`, etc.).

### 2. Persistent Design Strategy — "make it beautiful" is never a strategy
`nxDesignStrategy(brief)` produces an explicit, validated strategy (`visualConcept`,
`designPersonality`, `compositionStrategy`, `hierarchyStrategy`, `densityStrategy`,
`typographyStrategy`, `colorStrategy`, `surfaceStrategy`, `shapeLanguage`, `spacingStrategy`,
`motionStrategy`, `interactionStrategy`, `responsiveStrategy`, `conversionStrategy`,
`contentStrategy`) derived from the brief's *selected values* — never a free-form "make it
look nice."

### 3. Genuinely different creative directions — not color variants
`nxDesignDirections(brief)` returns 5 real directions (`editorial-minimal`, `cinematic-immersive`,
`luxury-art`, `bold-experimental`, `swiss-structured`), each varying **composition, type scale,
section rhythm, density, surface treatment, section selection and motion language** — ranked by
fit to the brief, each carrying a derived strategy + maturity.

### 4. Maturity model
`nxDesignMaturity(strategy)` classifies a design `1 template-like → 2 coherent → 3 polished →
4 art-directed → 5 exceptional`. A rich brief lands at art-directed (4); exceptional (5) is rare.

### 5. Design QA that catches *design* problems, not just structure
`nxDesignQAProject` now emits a **design-diagnostics** layer *in addition to* the existing
aggregate `.score` (whose contract is untouched): `typography`, `hierarchy`, `restraint`,
`genericness`, `sectionRhythm`, `composition`, plus flags like `allOversized` / `flat`.
The aggregate `.score` is the structural/engineering-breadth score; the new
**`nxDesignQuality` composite** (0–100) is the *design-quality* score the loop optimizes.

### 6. A critic that explains WHY (and a fix that is a scale, not one node)
`nxCritic` now flags design problems (typography/hierarchy/genericness/restraint/rhythm/
composition) with actionable reasons, and the typography fix applies a **coherent type scale
across the whole page** (hero large, rest subordinate) — the "smallest effective intervention,"
never "make everything bigger."

### 7. A design-quality LAB that proves detect → explain → fix
`nxDesignQALab(project)` runs the full art-directed loop and reports a reproducible
before/after scorecard. `nxBadDesignFixtures()` supplies deliberate bad graphs.

---

## Measurable evidence (from `tests/test_design_system.mjs`, 28/28)

| Check | Result |
|---|---|
| Persistent strategy has all 16 fields | ✅ |
| Luxury brief → refined concept + personality; density responds | ✅ |
| Strategy never uses "make it beautiful" as a value | ✅ |
| 5 directions with **distinct** compositions / types / motions / sections | ✅ (≥4 vary each) |
| Luxury brief ranks the `luxury-art` direction first | ✅ |
| Each direction carries a strategy + maturity | ✅ |
| Rich luxury brief ≥ art-directed (4); minimal brief finer-grained | ✅ |
| **Bad design flagged** `allOversized`; typography & hierarchy score << good | ✅ |
| **Critic explains why** (reasons, not labels) | ✅ |
| **Design-QA LAB improves a bad design** (composite ↑, genericness ↓) | ✅ |
| **Good design is NOT degraded** by the loop | ✅ |
| Scales are coherent; composite score is 0–100 | ✅ |

Concrete run for a deliberately-bad graph (every section set to oversized 120px type):
```
typography 15 → 53   hierarchy 20 → 90   genericness 65 → 30 (reduced)
design-quality composite 70 → 81   (aggregate score held constant — diagnostics are separate)
```

The full battery still shows **exactly the 5 pre-existing failures** (`test_deploy_studio`,
`test_design_route`, `test_integrity`, `test_version`, `test_e2e`) and **zero new failures**.
Green: `test_backend` 379, `test_template_design` 21, `test_template_prod` 19,
`test_design_system` 28, `test_design` 73, `test_render_v2` 242, `test_frontend` 182, and all
other suites.

---

## Scope decisions (kept deliberately, and why)

- **The `template` reference-design is a first-class, selectable design that now routes through
  the real production path** (`generateSiteHtml` → `nxBuildTemplateSiteFromPlan`), with words
  driven by the user's plan. This was verified earlier (`tests/test_template_prod.mjs`, 19/19).
- **I did NOT force `template` as the universal UI default this cycle.** The master directive
  explicitly warns against making every site look the same — a fixed template shell isn't the
  right default for every brand. The correct default is **direction/industry-aware**, which I'll
  implement in a later cycle (pick `template`/trades for off-mains, `editorial` for magazines,
  `luxury-art` for premium, etc.). Forcing one shell now would regress the "right design for the
  right brand" goal and break the frontend's design-swatch tests.

---

## Roadmap — next cycles (each a distinct, verifiable batch)

- **Cycle 2 — Composition Intelligence:** wire `design` direction + strategy into the emitter so
  a chosen direction actually changes composition/type/density/rhythm (Phase B impact on the
  rendered site). Content-aware component selection; intentional omission ("remove before add").
- **Cycle 3 — Motion Intelligence:** role-based motion, timeline pacing, motion-density/budget,
  reduced-motion strategy, scroll choreography (Phase C).
- **Cycle 4 — Visual Evidence + responsive re-composition:** desktop/tablet/mobile screenshots,
  computed layout, visual-regression comparison, and mobile that re-composes (not squeezes).
- **Cycle 5 — AI Critic → Patch → Best-Known:** evidence-based critic, multi-objective acceptance,
  evolution loop that keeps the best known version; direction/industry-aware default.
- Each cycle ships with tests that measure **the rendered site**, not only data structures.

## How to run
```
node tests/test_design_system.mjs     # this cycle's conformance suite (28 checks)
node tests/run_all.mjs                # full battery
```
