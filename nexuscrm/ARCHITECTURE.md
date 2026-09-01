# NexusCRM — AI Website Architecture (North-Star)

This is the agreed architecture for the **AI Design + AI Engineering + Visual Runtime** system. It supersedes the earlier single-`Site IR` sketch. The IR is a **constraint layer that preserves creative decisions**, not a replacement for AI judgment. The AI makes the creative choices; the deterministic engines preserve, serialize, and (re)render them.

> Ground truth: **Framer 3.0's agent line is already moving toward agents operating directly on the canvas, creating components, handling breakpoints/effects, writing code, connecting CMS, and supporting branching.** We design one step ahead of that. The six-layer pipeline below is the target; **Phase 2 builds the middle (Graph + Engines), which is the highest-leverage gap in the current code.**

```
                              USER
                               │
                    TEXT / IMAGE / VIDEO
                               │
                               ▼
                   ┌──────────────────┐
                   │   AI DIRECTOR    │  intent + goals + constraints (brand, audience, conversion)
                   └────────┬─────────┘
                            ▼
                   ┌──────────────────┐
                   │  DESIGN EXPLORER │  generates 3–5 distinct *directions*, evaluates, picks
                   └────────┬─────────┘
                            ▼
             ┌──────────────────────────────┐
             │         PROJECT GRAPH        │   ← the Design Graph (creative decisions live here)
             │                              │
             │  Design      Components      │
             │  Content     Motion          │
             │  Responsive  Assets          │
             │  Tokens (Brand)              │
             └──────────────┬───────────────┘
                            │
     ┌──────────────────────┼──────────────────────┐
     ▼                      ▼                      ▼
  DESIGN ENGINE        MOTION ENGINE         CONTENT ENGINE
  (visual decision)    (Motion Graph)        (text/asset)
     │                      │                      │
     └──────────────────────┼──────────────────────┘
                            ▼
                   COMPONENT ENGINE   (families of compositions, parameterized)
                            │
                            ▼
                     CODE ENGINE      (deterministic: IR → HTML/CSS/JS)
                            │
                            ▼
                       RUNTIME
                            │
                            ▼
                  ┌────────────────┐
                  │  LIVE CANVAS   │  script-free, structure-aware renderer
                  └───────┬────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
     VISUAL QA       BROWSER QA      PERFORMANCE QA
     (aesthetics)    (eng/runtime)   (audit)
          │               │               │
          └───────────────┼───────────────┘
                          ▼
                    AI CRITIC  (beauty + correctness)
                          │
                          ▼
                REFINEMENT AGENT (deterministic apply loop)
                          │
                          ▼
                     VERSION   ──►  PUBLISH
```

## The core principle: hybrid AI / deterministic

| Use **AI** for (creative, high-entropy) | Use **deterministic engines** for (reliable, low-entropy) |
|---|---|
| understanding intent | applying styles |
| creative decisions | layout calculations |
| planning | token / brand management |
| design exploration | component operations |
| composition | serialization & versioning |
| content & tone | validation / rendering |
| motion strategy | QA scoring |
| diagnosis / critique | the automatic fix loop |

"LLM does everything" is strictly worse. The engines make the 500-cycle (each refactor pass) **deterministic**, reproducible, and diffable.

---

## 1. Project Model (multi-graph, not one Site IR)

Distinct concern → distinct graph, joined by a shared node id:

```
              PROJECT MODEL
                   │
   ┌───────────────┼───────────────┐
   │               │               │
CONTENT GRAPH  DESIGN GRAPH  MOTION GRAPH
   │               │               │
   └───────────────┼───────────────┘
                   │
            COMPONENT GRAPH
                   │
              ASSET GRAPH
                   │
            RESPONSIVE GRAPH
                   │
                   CODE
```

Each graph node carries **slots** for its concern. Example — a `hero` node:

```
Hero
 ├─ structure        (split/centered/asymmetric/editorial/product/3d/video/interactive)
 ├─ visual hierarchy (headline→sub→CTA order & weight)
 ├─ typography       (font, sizeScale, weightScale, line-height)
 ├─ colors           (bg, fg, accent, gradient)
 ├─ spacing          (padding scale, section rhythm)
 ├─ responsive rules (breakpoint overrides)
 ├─ background       (color / image / gradient / 3D scene ref)
 ├─ 3D scene         (curated-library scene id, placement — AI never invents a scene)
 ├─ animation timeline (Motion Graph ref)
 └─ interactions     (hover, click, pointer, viewport, scroll, page-transition)
```

## 2. Design Graph (the mind of the system)

The Design Graph stores **why** a decision was made, so refinement never destroys intent. Relations are first-class (`headlineHighlights`, `thisPops`, `softerThan`), enabling the AI to reason about the design rather than re-guess every turn.

## 3. First-class Motion Engine

Motion is **not** an afterthought. A `Motion Graph` models animation as data:

```
Motion Graph
├─ timeline (ordered, with offsets)
├─ triggers (viewport-entry, scroll-progress, hover, pointer-move, click, page-transition, load)
├─ targets (node ids / selectors)
├─ states (from/to, per state)
├─ transitions (spring, tween, keyframes)
├─ easing (curves)
├─ stagger (per-target delay)
└─ reduced-motion behavior (never optional)
```

The AI **generates motion** — e.g.

```
Hero entrance
→ heading reveal
→ subtitle fade
→ CTA scale
→ background parallax
→ 3D object rotates
→ particles drift
→ cards stagger on scroll
```

without reinventing animation code per site.

### Animation Composer (design vocabulary for motion)
The AI describes a **mood**; the composer maps it to a recipe of named parameters:

| Mood | Recipe |
|---|---|
| `cinematic` | slow entrance + large depth movement + subtle parallax + smooth easing + staggered reveals + low-frequency bg motion |
| `energetic` | faster transitions + spring interactions + stronger hover + short stagger + dynamic gradients |
| `minimal` | 0–1 motion, quick fades, single easing, no bg motion |
| `playful` | bouncy springs + overshoot + varied stagger |
| `futuristic` | glide + parallax + 3D rotate + particles (from curated scenes) |

`nxMotionCompose(mood, opts)` → concrete recipe; `nxMotionToCss/Js` → deterministic runtime.

## 4. Component Intelligence (families, not templates)

Don't store flat `Hero / Pricing / Testimonials`. Store **families of compositions**, each with variants, and each variant carrying its own rules:

```
Hero
├─ Centered         ├─ Split          ├─ Asymmetric
├─ Editorial        ├─ Product        ├─ 3D-centered
├─ Video-focused    └─ Interactive
```

Every variant declares: **structure, design rules, responsive rules, motion recipes, semantic purpose, conversion purpose.** The AI *composes* from intelligent building blocks rather than copying templates.

## 5. Design Exploration (multiple directions)

Don't go `prompt → one design → refine`. Go:

```
Prompt → Generate 3–5 design directions → Evaluate → Choose strongest → Expand into full site
```

Directions are distinct, parameterized aesthetic profiles (e.g. **A Minimal-Luxury, B Futuristic-Cinematic, C Editorial, D Bold-Experimental**). `nxExplore(brief, n)` proposes n viable directions deterministically + a fit score; the user or the AI picks; then it's expanded.

## 6. Bidirectional Visual / Code hybrid

The editor must live in **both** directions:

```
Visual Canvas  ↕  Design Graph  ↕  Component Graph  ↕  Generated Code
```

- **Canvas → code:** move a button 24px left → the graph node's spacing slot changes → code regenerates.
- **Code → canvas:** AI returns new code → it's re-parsed into the graph → canvas updates.

The current **iframe (DOM → selector → CSS override)** is fine for v0.0.1.5 but is a **short-term** editor, not the long-term one. The long-term renderer understands the **Project Graph**:

```
Project Graph → Renderer → Canvas → Selection / Measurement / Manipulation
```

This makes nested components, responsive variants, animations, constraints, component states, reusable styles, code components, 3D, and interactions all reliable — because the renderer knows the structure instead of editing arbitrary authored HTML.

## 7. Two separate evaluators

**Engineering QA** (build, runtime, console, links, forms, a11y, performance, responsive) — already strong in the analyzer.

**Design QA** (composition, hierarchy, typography, spacing, balance, contrast, consistency, visual rhythm, animation quality, brand coherence) — **new**, and essential for judging *beauty*, not just correctness. Running both, the AI Critic learns aesthetics + correctness together and the Refinement Agent fixes accordingly.

## 8. Design memory (Brand model)

"Make this orange," then 15 edits later the system must still protect the design language. Not via chat history — via structured project state:

```
Brand
├─ primaryColor / secondaryColor / accentColor
├─ headingFont / bodyFont
├─ radiusStyle / shadowStyle / motionStyle
└─ visualTone
```

`nxMergeBrand(base, patch)` merges edits into the **brand as a single source of truth**; tokens compile to CSS variables; the Design QA scores brand coherence so the AI can't drift.

## 9. Deterministic core (what I'm building right now)

`nx_design.js` — shared, dependency-free, tested: tokens/brand, project+graphs, component families, motion engine + composer, design exploration, **Design QA**, and the bidirectional graph↔code mapping. Wired into both the worker (`__internals`) and the frontend. This is the backbone that Phase 3 (SQLite data engine, on-data agentic assistant, analytics) plugs into.

## 10. Recommended Phase 2 build order (REVISED — architecture-first)

The backlog order below was changed **before** the renderer/motion/orchestrator are
integrated, because retrofitting these contracts afterward is far more expensive.

1. **IR contracts + schemas** *(done, v0.0.1.7)* — explicit node schemas + validation.
2. **Project Mutation Engine** *(done, v0.0.1.7)* — every AI action is a structured patch.
3. **Design Brief object** *(done, v0.0.1.7)* — persistent creative intent.
4. **Constraint / Layout Engine** *(done, v0.0.1.7 core + v0.0.1.8 constraint graph)*.
5. **Interaction Graph** *(done, v0.0.1.7)*.
6. **Motion composition + timeline + budget** *(done, v0.0.1.7 core; v0.0.1.8 timeline/budget)*.
7. **Compiler pipeline** *(done, v0.0.1.7)*.
8. **Design-QA methodology** *(done, v0.0.1.7)*.
9. **AI Critic → Patch → re-evaluate** *(done v0.0.1.7; v0.0.1.8 evidence-based + Best Known Version)*.
10. **State Graph, Asset Graph, Project History/Diff, Intent→Patch, Motion Timeline+Budget, evidence Critic, Best-Known-Version** *(done, v0.0.1.8; extended v0.0.1.9)* — the four missing foundational systems, formalised before the renderer embeds. `nx_graph.js` 44/44 + import layer 18/18.
11. **Graph Renderer + Runtime + Canvas Protocol** — structure-aware, **recursive, children-driven** renderer with a component-renderer registry (no role-special-casing), real component sub-graphs, a real runtime (states/interactions/motion timelines), and a bidirectional canvas (`PROJECT GRAPH ↕ RENDERING MODEL ↕ VISUAL CANVAS ↕ CODE`) with `select/hover/drag/resize/reparent/duplicate/delete/multiSelect/group/ungroup/setProperty/setConstraint/setBreakpoint` — every action → a Project Patch; drag resolves to a semantic constraint, not a pixel offset. *(done, v0.0.1.9; `nx_render.js`, 80/80)*
12. **AI Director + Evolution** — staged `OBSERVE→UNDERSTAND→PLAN→PATCH→RENDER→TEST→CRITIQUE→ACCEPT/REJECT` with **Best Known Version** promotion (quality↑ AND engineering not regressed AND performance OK); embeds the renderer/canvas into the visual editor. *(foundation done v0.0.1.9; embed next)*
13. **SQLite data engine** (50k+ target), **agentic assistant on real data**, **analytics/reporting**. *(v0.0.1.10)*

No layer is claimed or shipped until its suite is green and its numbers are measured.
