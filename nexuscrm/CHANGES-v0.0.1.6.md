# v0.0.1.6 — AI Design System (the hybrid engine + Design Studio)

Ship date: 2026-08-31 · Commit: `v0.0.1.6` (not pushed)

This introduces the **deterministic engine core** of the hybrid **AI Design + AI
Engineering + Visual Runtime** architecture (see `ARCHITECTURE.md`). The AI makes
the creative decisions; these engines preserve, model, compose, evaluate and
(re)render them. Nothing here is a placeholder — every function ships with a
passing test and a measured result.

---

## The core principle: hybrid AI / deterministic

| **AI** does (creative, high-entropy) | **Deterministic engines** do (reliable, low-entropy) |
|---|---|
| understanding intent | applying styles |
| creative decisions | layout calculations |
| design exploration | token / brand management |
| planning | component operations |
| composition | serialization & versioning |
| content & tone | validation / rendering |
| motion strategy | QA scoring |
| diagnosis / critique | the auto-fix loop |

"LLM does everything" is strictly worse. The engines make the 500-cycle **reproducible and diffable**.

## What landed

### `nx_design.js` — the engine core (dependency-free, pure, tested)
- **Brand / Design memory (`nxTokensToCss`, `nxMergeBrand`, `nxBrandFromSite`, `nxTokensValidate`)** — a single source of truth for the visual language. `nxMergeBrand` **preserves keys the patch doesn't mention**, so "make this orange" never wipes the font. `nxBrandFromSite` best-effort recovers a brand from an existing site so AI edits don't destroy the design language. `nxTokensValidate` does a real **WCAG contrast** check (4.5:1).
- **Project Model (multi-graph)** — content / design / motion / component / asset / responsive as distinct concern graphs joined by node ids, each node with slots (`structure`, `visual`, `typography`, `colors`, `spacing`, `responsive`, `background`, `3D scene`, `animation timeline`, `interactions`). `nxProjectValidate` enforces the invariant (one hero, no dangling refs).
- **Component Intelligence (`NX_COMPONENTS`, `nxBuildComponent`)** — *families of compositions*, not flat templates. e.g. Hero has **8 variants** (Centered/Split/Asymmetric/Editorial/Product/3D-centered/Video/Interactive), each with structure + **semantic purpose + conversion purpose**. The AI composes from intelligent building blocks.
- **Motion Engine + Animation Composer (`nxMotionMood`, `nxMotionCompose`, `nxMotionToCss`, `nxMotionToJs`)** — a Motion Graph as data (timeline, triggers, targets, states, easing, stagger, parallax, reduced-motion). Design vocabulary: `cinematic`, `energetic`, `minimal`, `playful`, `futuristic`, `smooth` → recipes. Compiles to keyframes + IntersectionObserver JS, **always guarded by `prefers-reduced-motion`**.
- **Design Exploration (`nxExplore`, `nxDirectionFit`)** — proposes **3–5 distinct directions** (Minimal-Luxury, Futuristic-Cinematic, Editorial, Bold-Experimental, Warm-Organic, Tech-SaaS), each with a token set + fit score, so we don't force one design on the first attempt.
- **Design QA (`nxDesignQA`)** — a *second*, distinct evaluator that judges **beauty** (composition, hierarchy, typography, spacing, balance, contrast, consistency, rhythm, motion) — separate from the existing Engineering QA (`auditSiteHtml`).
- **Bidirectional Project ◄─► Code** — `nxProjectToCode` renders a graph to HTML/CSS/JS; `nxCodeToProject` partially round-trips it back into the graph (brand + components), the foundation for the canvas↔graph↔code editor.

### Backend
- Same engine exported under `__internals`.
- **`POST /sites/:id/design`** — takes `{brief}`, explores 4 directions, auto-picks the best-fit (or a requested `direction`), builds the Project Graph, renders, scores it with **Design QA + Engineering QA**, returns the preview HTML, and **persists** (with a snapshot of the prior version) when `overwrite:true`. Honest 401 / 404 handling.

### Frontend
- Design core injected & exposed on `window` (`nxDesignQA`, `nxExplore`, `nxProjectToCode`, …).
- **🎨 Design Studio** action on every website card: explore directions → pick → render a live preview with both QA scores → **💾 Save to site** (snapshots the previous version).

## Test coverage (measured)
- **`tests/test_design.mjs` — 66 checks**, green: brand/tokens/design-memory (10), project model (6), component intelligence (9), motion engine + composer (10), design exploration (6), **Design QA** (8), bidirectional graph↔code (9), frontend exposure + Studio modal (8).
- **`tests/test_design_route.mjs` — 20 checks**, green: explore returns 4 directions, best-fit auto-pick (luxury→minimal-luxury), Design QA + Engineering QA present, **no mutation unless overwrite**, persist + snapshot + 401/404.
- **Full battery: 28 suites.** Route coverage **62/62**.
- The only failure is the pre-existing **offline-network** `test_deploy_studio.mjs` (92/1, Cloudflare `code 6003` in a no-internet sandbox) — unrelated to this work.

### Real bugs found & fixed this release
1. `nxDesignQA`/`nxDirectionFit` scored matched directions *lower* than unmatched ones (base below the clamp) — fixed so a matched direction always outranks.
2. Injected design core embedded `</script>` literally inside the app's inline `<script>` → **`Unexpected end of input`** (the HTML parser closed the host script early). Fixed with a JS-escaped `<\/script>` (output identical, parser-safe).
3. `nxBrandFromSite` used `Set.prototype.map` (doesn't exist) → `TypeError`; fixed to spread the set first.
4. Design Studio render passed a boolean (`includes(...)`) as the hero variant → `unknown variant true`; fixed to pass the variant name.

## Backlog (next, in `ARCHITECTURE.md`)
- Renderer **on the graph** (structure-aware canvas) replacing the iframe-only editor.
- Content & motion engines as deterministic IR→IR passes (the 500-cycle on the graph).
- AI Director/Evolution orchestrator (AI-vs-deterministic per step) feeding the AI Critic from both QAs.
- SQLite data engine (50k+ target), agentic assistant on real data, analytics/reporting.
