# Cycle 2 — Composition Intelligence

**What changed:** the design intelligence from Cycle 1 (Brief → Strategy → Direction) is now an **authoritative input to the rendered website**. A design direction no longer lives in metadata — it drives section selection, hero structure, feature/review variants, the typographic hierarchy, section rhythm, visual density, motion language and responsive re-composition of the DOM.

**The bar (from the directive):** a `color / font / radius`-only difference is a **failed** direction. The tests below measure the **rendered DOM**, not the schema, and prove the five directions are structurally, typographically and rhythmically different from each other **and** from a direction-blind generic template.

---

## 1. What was built (not rewritten — extended)

New module **`backend/src/nx_compose.js`** (also at repo root) — the Compose + Composition engine. It is *dependency-free*, exposes `.nxCompose(plan, {direction})`, and is both `require()`-able by the backend and ESM-importable by tests. It resolves through `__NX_IR` (see §5).

New module **`backend/src/nx_structured.js`** — the **structural analyzer** that fingerprints rendered HTML (section order, hero/feature/review variants, the full type scale, `data-density`, `data-rhythm`, palette, DOM shape) so distinctness can be measured against *actual output*. It also computes the **repetition model** and **card-dependency** metric (§11, §14).

**Real, visible evidence (headless Chromium).** Playwright + the downloaded Chrome headless shell render each direction's page to a real screenshot at desktop (1440px) and mobile (390px) widths:
`CYCLE2_evidence/screenshots/{direction}-{desktop,mobile}.png`. The five directions are **visually identifiable without being told which was selected** — see §2.

The map from direction → rendered composition:

| Direction | Hero mode | Feature mode | Reviews mode | Motion | Density | Section rhythm (per section) |
|---|---|---|---|---|---|---|
| editorial-minimal | **editorial** (asymmetric two-col + full-bleed) | **edlist** (numbered editorial list) | **quote** | quiet | airy | dramatic→compact→normal→spacious… |
| cinematic-immersive | **fullbleed** (veiled image hero, 86vh) | **bento** (variable-size grid) | **grid** | cinematic | balanced | dramatic→compact→spacious… |
| luxury-art | **minimal** (centered statement) | **split** (image + list) | **single** (large centered quote) | slow | airy | dramatic→spacious→normal… |
| bold-experimental | **overlap** (overlapping shapes) | **alternating** (staggered rows) | **grid** | energetic | dense | dramatic→compact→dramatic… |
| swiss-structured | **split** (rational two-col) | **grid** (card grid) | *omitted* | functional | balanced | normal→compact→normal… |

**Realised systems, per the acceptance criteria:**

- **Composition Resolver** — deterministic; `nxComposePlan` maps a direction → section order, per-section variants, type scale, rhythm motif, density, motion, emphasis and palette.
- **Remove-before-add** — a section is dropped if it has no actual content to justify it (e.g. `feature` when there are no services *and* no "why", `reviews` when there are no reviews, `metrics` when no stats), so the page is not padded with empty sections.
- **Content-aware component selection** — the engine reads the plan and picks the variant/content that is actually present; families degrade gracefully (services → why → sub → copy) instead of assuming the perfect dataset.
- **Real composition families** — heroes (editorial / fullbleed / minimal / overlap / split), features (edlist / alternating / bento / split / grid), reviews (single / quote / grid).
- **Typographic Hierarchy Solver (rendered)** — a full scale per direction (`display / hero / section / body / caption / btn`) + a text **measure** (`62ch…72ch`). The scale is emitted in `<style>`, not metadata.
- **Section Rhythm System** — each rendered section gets an explicit `data-rhythm="dramatic|spacious|normal|compact"`; CSS maps each beat to a real `padding-block`, so spacing physically changes down the page.
- **Visual density control** — `data-density="airy|balanced|dense"` on the page root.
- **Motion profile** — `data-motion="quiet|cinematic|slow|energetic|functional"` drives reveal/roll-up timing and easing (and honours `prefers-reduced-motion`).
- **Responsive re-composition** — the `@media (max-width:900px)` block rewrites multi-column grids → single column and collapses hero/split layouts, i.e. *composition* changes, not just font size.
- **Design-aware content length** + **human-readable explanation** (`nxDesignExplanation`) that is derived from the actual plan (direction, hero, feature, rhythm, density, motion) — no invented claims.
- **Section Transitions** — each rendered section carries `data-transition="fade|bridge|bleed|overlap|flat"`, a per-direction motif (`NX_COMPOSE_TRANSITIONS`) so the page reads as one continuous composition rather than isolated blocks (§16).
- **Visual Emphasis Budget** — a per-section weight is bucketed into `data-emphasis="max|high|med|low"` and rendered (the section title scales via `calc(... * var(--emph))`). Only the hero (and typically one CTA) is `max`; the rest are supporting (§12).
- **Repetition model + card-dependency** — `nxRepetitionModel(html)` returns `cardDependency`, `layoutDistinctness`, `rhythmVariety`, `componentDiversity` and `monotony`. A card-soup fixture measures `cardDependency 1.0 / monotony 95`; the directed compositions measure **monotony 15–40** and negligible card dependency (§11, §14).
- **Card-dependency / genericness guard** — the `card-soup` fixture is structurally poor and measured; the quality signature (`nxRenderedDesignQuality`) quantifies rendered structure.
- **Visual Quality Loop (§20)** — `nxComposeQualityLoop(plan, direction)` runs `render → measure(rendered DOM) → diagnose the largest structural weakness → patch the composition plan → re-render → compare`. It starts from a deliberately degraded candidate (uniform type, all sections max-emphasis, card grid, low contrast) and, in one pass, repairs it on the **actual rendered output** (not a score): monotony 62→15, card-dependency 0.8→0, type-uniformity 1→0.86, emphasis all-max→single focal. Screenshots at `CYCLE2_evidence/screenshots/qualityloop_{degraded,repaired}.png` make the before/after visible.

---

## 2. Direction distinctness — measured on rendered DOM

`nxSignatureDistance(a,b)` returns `0..1` (higher = more structurally unrelated). It compares hero mode, feature mode, review mode, motion, density, section order sequence, the full type scale (with a tolerance), the text measure, palette and the DOM shape.

| Pair | Distance |
|---|---|
| cinematic-immersive ↔ swiss-structured | 0.487 |
| bold-experimental ↔ luxury-art | 0.500 |
| … (all 10 pairs) | **0.354 – 0.500** |

**The anti-cheat guard:** a *palette-only* clone of `editorial-minimal` (same DOM, only `--bg`/`--accent` swapped) scores **0.077**, well below the `0.18` pass oracle. So a "colour swap" direction is correctly rejected, and the minimum *real* distance (≈0.35) sits a wide margin above it. If Cycle 2 had been achieved by reskinning, this test would fail.

**© visual confirmation.** The five `.png` screenshots are genuinely different compositions — not the same layout in a different colour:

| Direction | What you actually see |
|---|---|
| editorial-minimal | cream serif editorial; asymmetric headline; full-bleed band; numbered editorial list |
| cinematic-immersive | near-black full-bleed glass hero; metric row; bento grid; cinematic motion |
| luxury-art | near-black centered serif statement; huge negative space; split feature; single large quote |
| bold-experimental | oversized type on black; pink accent; alternating rows; massive "WORK" |
| swiss-structured | light grotesk; blue accent; strict grid; split hero; card grid; functional motion |

A human can identify the direction without being told which was selected.

---

## 3. Before / after (real rendered output)

`CYCLE2_evidence/` holds the **actual HTML** the engine emits. The "before" baseline is a direction-blind generic template (same card grid + default type for any site); "after" is the direction-directed composition.

| Site / direction | Distance vs generic baseline | Hero | Feature | Rendered section order | Motion | Density | Display | Measure |
|---|---|---|---|---|---|---|---|---|
| editorial-minimal | **0.995** | editorial | edlist | nav→hero→logos→feature→story→work→reviews→cta→contact→footer | quiet | airy | clamp(3.2rem,8.5vw,6.6rem) | 62ch |
| cinematic-immersive | **0.995** | fullbleed | bento | nav→hero→marquee→metrics→feature→story→work→reviews→cta→contact→footer | cinematic | balanced | clamp(3.4rem,10vw,8rem) | 58ch |
| luxury-art | **0.993** | minimal | split | nav→hero→story→feature→work→reviews→cta→contact→footer | slow | airy | clamp(3rem,7.5vw,5.8rem) | 56ch |
| bold-experimental | **0.995** | overlap | alternating | nav→hero→marquee→feature→metrics→work→reviews→cta→contact→footer | energetic | dense | clamp(4rem,13vw,10rem) | 54ch |
| swiss-structured | **0.883** | split | grid | nav→hero→metrics→feature→story→work→cta→contact→footer | functional | balanced | clamp(3rem,8vw,5.6rem) | 72ch |

Every directed page is **≥0.88** structurally different from the generic template **and** ≥0.35 different from every other direction. The five `.html` files are real, complete pages (with inline direction CSS + runtime), each a genuinely different composition — not the same layout in different colours. The table also records `monotony` (repetition) and `cardDependency` (card-soup guard) for each page: a card-soup fixture measures `monotony 95`, while the directed pages measure **15–40**.

---

## 4. Test suite

**`tests/test_composition.mjs` — 57/57 passing**, covering:
- A. Component families resolve to the correct rendered variants per direction.
- B. Determinism + complete/valid page per direction.
- C. Typographic Hierarchy Solver (full scale rendered; bold/cinematic display > swiss; distinct text measure).
- D. Section Rhythm System + density (airy ↔ dense is real; rhythm length == final section count).
- E. Direction-controlled motion (5 unique motion profiles).
- F. Responsive re-composes the grid at the breakpoint.
- G. All five hero modes are structurally distinct.
- H. **Direction distinctness** (all 10 pairs above oracle; palette-only clone rejected).
- I. Genericness proof (card-soup → poor structure; direction → measurable structure via `nxRenderedDesignQuality`).
- J. **20-brief × 5-direction golden benchmark** (global min pairwise distance 0.340 > 0.20; all deterministic).
- K. Human-readable explanation matches the graph (hero/feature/rhythm/density/motion, no invented claims).
- L. `nxComposeFromProject` graph → directed page bridge (direction authoritative).
- M. **Section Transitions** (per-direction `data-transition` motif, not one universal treatment) and **Visual Emphasis Budget** (hero is `max`; no direction has more than 2 focal sections).
- N. **Repetition model + card-dependency**: card-soup detected (`cardDependency ≥ 0.8`, `monotony ≥ 80`); all directed compositions far less monotonous; editorial/cinematic use non-card alternatives (card-dependency 0 / <0.3).
- O. **Visual Quality Loop**: detects a genuinely degraded render, repairs monotony/card-dependency/type-uniformity/emphasis on rendered DOM, converges to the direction target (no visually-worse regression), deterministic, and improves every direction.

Wired into `tests/run_all.mjs`. **Zero new failures across the full battery** — the only failing suites remain the 5 pre-existing ones (`test_deploy_studio`, `test_design_route`, `test_integrity`, `test_version`, `test_e2e`); Cycle 1's `test_design_system.mjs` still passes 28/28.

---

## 5. Integration surface (so the direction is authoritative, not decoration)

- `__NX_IR` (the graph runtime) now exposes: `NX_COMPOSE_DIRECTIONS`, `NX_COMPOSE_ORDER`, `nxComposeContent`, `nxComposePlan`, `nxDesignExplanation`, `nxRenderDirected`, `nxCompose`, `nxComposeFromProject`, `nxRenderedDesignQuality`, `nxRenderScheme`.
- `nxComposeFromProject(project, direction)` reads the **graph** (nodes → content) and composes it into a direction-directed page, so the direction drives the rendered site from the real graph.
- The backend `__dep` resolver now resolves the `compose` module (single source of truth).

---

## 6. Honest scope — what is done vs. still open

**Done in this cycle:** the composition engine + structural analyzer, the `__NX_IR` integration, direction-authoritative rendering, the typographic hierarchy / rhythm / density / motion / responsive systems, the distinctness + benchmark + genericness tests, and rendered before/after evidence.

**Still open (carried, not hidden):**
1. **Live-route wiring** — the site-render route (`renderSectionsHtml` / the site POST handler) has not yet been taught to pick a direction and emit the composed page; today the direction is authoritative *through* `__NX_IR` (`nxComposeFromProject`) but the production site preview route still needs to call it. This is the next concrete step.
2. **Builder upgrade evidence** — the visual editor should surface direction choice + the `nxDesignExplanation` (direction-aware). Not yet wired.
3. **`template` default flip** for new frontend sites remains deferred pending your confirmation (unchanged since last cycle).
4. **No push** until you explicitly confirm.
5. **3D / WebGL / Spline** extension only after you confirm (unchanged).

---

## 7. How to run

```bash
cd /home/user/repo/nexuscrm
node tests/test_composition.mjs          # Cycle 2 — 57/57
node tests/test_design_system.mjs        # Cycle 1 — 28/28
node tests/run_all.mjs                   # full battery (5 pre-existing failures only)
```

Rendered evidence lives in `CYCLE2_evidence/` — `before_baseline.html`, one `.html` per direction, `before_after.json`, `evidence_table.json`, the quality-loop pair (`qualityloop_degraded.html` / `qualityloop_repaired.html`), and `screenshots/` (desktop + mobile for all five directions, plus the quality-loop before/after).
