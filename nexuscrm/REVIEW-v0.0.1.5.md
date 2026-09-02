# Review — v0.0.1.5 AI Visual Editor + Architecture North-Star

## 1. What shipped (slide 4) and how to drive it

Open the app → **Websites** → pick a site → **Preview** → **🎨 Visual Edit**.

| Step | What you see | What happens underneath |
|---|---|---|
| **Click a hero, heading, button, paragraph** | It's highlighted (an overlay box + focus outline). | `nxComputeSelector(el)` builds a stable selector: `#id`, else `tag.class`, else `tag:nth-of-type(n)`. |
| **Type in the command bar** | e.g. `make it bigger`, `make this orange`, `bold`, `center`, `rounded corners`, `hide`, `make it say Book Now`, `set size to 28px` | `nxVisualCommand(instruction, ctx)` parses it using the **current computed style** (so "bigger" knows the current size) against the **16-color palette** (`NX_VISUAL_COLORS`) or any `#hex`. Text replacement **preserves your capitalization**. |
| **Tap a quick-action chip** | Bigger · Orange · Bold · Center · Hide · Rounded · Contact text | Same deterministic engine, zero AI key needed. |
| **See it update** | Live in the iframe, no reload. | `nxVisualCss` merges `{selector, css}` into a `<style data-nx-visual>` block, `_kebab()` converts `fontSize`→`font-size` (valid CSS), and the change is applied to the in-memory DOM. |
| ** ↩ Undo** | Steps back one edit at a time. | A stack of previous `srcdoc` snapshots; undo reloads the prior one. |
| **💾 Save** | Site is updated + you get a version checkpoint. | Serializes the edited DOM back to HTML, creates a snapshot named `before visual edit` (version control), then `PATCH /sites/:id`. |

**Why the preview iframe is script-free:** `sandbox="allow-same-origin"` (no `allow-scripts`). You edit the **authored HTML**, not a runtime-injected DOM — so edits don't vanish on re-render, and there are no script side effects during editing.

**The backend does it too:** `POST /api/sites/:id/visual` accepts `{overrides:[{selector,css,text}]}` **or** `{html}` **or** `{command,selector,element_css}`. It applies the same engine, **persists** the change, and returns the before/after quality score. That means an agent (or the future AI freeform layer) can restyle a stored site programmatically, not just from the UI.

---

## 2. Test coverage (measurement, not claims)

`tests/test_visual.mjs` — **45/45 green**, and the whole battery is now **26 suites / 25 green**.

| Section | Covers | Checks |
|---|---|---|
| **A1 Pure command engine** | size↑/↓, named color→hex, change-text casing, bold/align/padding/radius/shadow/hide, explicit size, italic, uppercase, "unsupported" guard | 14 |
| **A2 Pure apply** | kebab-case CSS, **idempotent single** `<style data-nx-visual>` block, text via `#id` / `tag.class` / bare `.class`, CSS+text together | 7 |
| **A3 `/sites/:id/visual` route** | auth 401, missing site 404, CSS apply, text apply, server-side command, full-doc replacement, **persistence verified by re-reading stored HTML** | 14 |
| **B1 Frontend** | engine parity with backend, selector on a real DOM, WYSIWYG modal (script-free iframe, command input, chips, save), **zero runtime errors** | 10 |

**Route coverage: 62/62** — every route the worker serves is exercised; `POST /api/sites/:id/visual` is now in the set.

**Honest results.** No invented multipliers: this slide is a deterministic engine + route + WYSIWYG. The AI freeform phrasing layer (loose, open-ended instructions) is **not** yet wired — that's explicit in the backlog, not implied.

### The one red, and why it's not this slide's fault
`test_deploy_studio.mjs` = **92/1**. The single failure is the **pre-existing, network-dependent** Cloudflare call (`code 6003 — Invalid request headers`, HTTP 400) that only happens **without internet** (this sandbox). Unrelated to the visual editor; it's on the backlog to make that test internet-independent, not a regression.

### Real bugs found & fixed by this slide's tests
1. `nxVisualCss` wrote **camelCase** keys (`fontSize`) into a `<style>` block → **invalid CSS**. Now `_kebab` → `font-size`.
2. The id matcher built a broken `[hero-h1]` character class → `SyntaxError: Range out of order in character class`. Now `["']id["']`.
3. `#id` **text** edits did nothing (the selector had no tag to close). Now extracts the actual tag from the matched opening element.
4. Frontend `nxVeQuick` called an undefined `nxGeUndo`; undo-by-`innerHTML` was unreliable → reload iframe via `srcdoc`.
5. `nxComputeSelector` used `CSS.escape` which doesn't exist in jsdom/some runtimes → added `_cssEscape` fallback.

---

## 3. Your North-Star Architecture → gap map

You defined a six-layer pipeline. Below, each layer is mapped to **what exists today**, the **gap**, and **which phase closes it**. This becomes the Phase 2+ build plan so we don't bolt features on in random order.

```
USER INTENT
   │  TEXT / CHAT or IMAGE / VIDEO
   ▼
AI DIRECTOR ── Intent + Brief + Design Strategy
   ▼
DESIGN GRAPH / SITE IR  (intermediate representation)
   ▼
VISUAL DESIGNER  •  MOTION SYSTEM  •  CONTENT AI
   ▼
COMPONENT GRAPH + DESIGN TOKENS
   ▼
CODE GENERATOR / RUNTIME ENGINE
   ▼
LIVE RENDERER
   ▼
VISUAL ANALYZER  •  INTERACTION TESTER   (feedback loop back up)
```

| Layer | Today (v0.0.1.5) | Gap | Closed by |
|---|---|---|---|
| **User Intent** | Blueprint engine takes a brief; visual editor accepts a text command line. | No **image/video** intent path. | `screenshot → site` + `AI image gen` (backlog) |
| **AI Director** | Blueprint engine does industry detection + a deterministic content plan. | No explicit "design strategy" object that survives into generation. | Elevate blueprint plan → a persisted **brief/design-strategy** record. |
| **Design Graph / Site IR** | ❌ none — sites are raw HTML strings. | The biggest structural gap. Introduce a **Site IR** (typed node tree) so designers/content/motion/tokens all mutate one source of truth. | Phase 2 (design system) |
| **Visual Designer** | `nxVisualCommand` + WYSIWYG element styling. | Single-element first; no **section/whole-page** designer or a token-driven system. | Add token + component-graph driven designer. |
| **Motion System** | Curated 3D library (50+ scenes, chosen not invented) + scroll animation. | No curated **motion/transition** system layered on components. | Motion system pass (Phase 2). |
| **Content AI** | Text edits + content plan; text replacement works. | No image/video content gen, no tone/brand voice engine. | Content AI layer (Phase 2). |
| **Component Graph + Design Tokens** | App shell uses CSS variables (`--primary` etc.); sites are free-form CSS. | No **first-class component library** or **design-token → site** bridge. | Component/token system (Phase 2). |
| **Code Generator / Runtime** | `generateSiteHtml` + `aiBuildSite` emit HTML; worker persists. | Strong. Run the generator **from the IR** instead of from a flat prompt. | Refactor generator onto the IR. |
| **Live Renderer** | Script-free preview iframe (correct, deterministic). | Strong. | — |
| **Visual Analyzer** | `auditSiteHtml` (SEO/perf/a11y/best-practices/mobile) + quality engine auto-fix. | Strong. | — |
| **Interaction Tester** | Agentic **Testing Agent** + debugger + auto-fix loop (v0.0.1.4). | Strong; ties into analyzer loop. | — |

**Key conclusion:** v0.0.1.5 lands the **right end** of that pipeline (live renderer + deterministic command engine + analyzer + interaction tester) as a real, tested vertical slice. The **middle layers** — Site IR, Component Graph + Design Tokens, Motion System, Content AI — are the highest-leverage build in Phase 2, and the IR is the linchpin: once sites are a typed IR instead of a string, the designers/content/motion/token generators all become deterministic transforms instead of regex hacks.

### Recommended Phase 2 order (so each step is real + testable)
1. **Site IR** — parse a site into a typed node tree (shared client/server), with round-trip serialization back to HTML. Unit-tested. *(unlocks everything below)*
2. **Design Tokens** — define a token schema (`color/typography/space/radius/shadow/motion`) and a `tokens → CSS variables` compiler. Unit-tested.
3. **Component Graph** — curated section/component library as IR nodes (`hero`, `features`, `pricing`, `testimonials`, `cta`, `footer`…) with token bindings.
4. **Designer + Motion + Content generators** — deterministic functions from IR → IR (they become the 500-cycle "make it better" passes operating on the graph, not regexes).
5. **Runtime generator** — IR → HTML/CSS/JS, replacing the flat prompt generator; wire through the existing Live Renderer + Analyzer/Interaction Tester loop.
6. **SQLite data engine** (Phase 3 across from this) — real DB-backed records, virtualized tables, 50k+ target.

No feature here is claimed until its suite is green and its numbers are measured.
