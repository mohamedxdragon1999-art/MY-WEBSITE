# v0.0.1.5 — AI Visual Editor (Slide 4 of the Website-Builder mega-upgrade)

Ship date: 2026-08-31 · Commit: `v0.0.1.5` (not pushed)

This is the fourth slide of the website-builder mega-upgrade. Slides 1–3 landed the
**Quality Engine** (v0.0.1.2), the **Blueprint Engine** (v0.0.1.3) and the
**Agentic Build Loop** (v0.0.1.4). Slide 4 adds a real, WYSIWYG **AI Visual Editor**:
you point at an element in a live preview, type or say a change in plain language,
and it applies — then the edit is serialized back to the site's HTML and saved with
automatic version control.

---

## What you can do now

Open any site's **Preview → 🎨 Visual Edit**:

1. **Click to select** any element in the site. It's highlighted and targeted.
2. **Type or say a change** in the command bar, or tap a quick-action chip:
   - `make it bigger` / `make it smaller`
   - `make this orange` / `blue` / `green` / `red` / `purple` … (16 named colors + any `#hex`)
   - `make it bold` / `italic` / `underline` / `uppercase`
   - `center` / `align right` / `align left`
   - `more padding` / `less padding` / `rounded corners` / `add a shadow`
   - `hide` / `remove`
   - `make it say Book Now` / `change button text to Contact us` (preserves your capitalization)
   - `set size to 28px`
3. The change applies **live** — no reload, no waiting on an AI provider.
4. **↩ Undo** steps back one change at a time.
5. **💾 Save** serializes the edited DOM back into the site's HTML, takes a
   **checkpoint of the previous version** (`before visual edit`), and saves via
   `PATCH /sites/:id` — so edits persist *and* are restorable.

The preview the editor edits is **script-free** (`sandbox="allow-same-origin"` only),
so you are editing the *authored* HTML — not a runtime-injected DOM that would
lose your work when it re-renders.

---

## How it's built (real engines, not placeholders)

### `nx_visual.js` — deterministic command engine
- `nxVisualCommand(instruction, context)` — a small, pure natural-language →
  CSS/text parser. It reads the element's *current* computed style so relative
  commands ("make it bigger") are intelligent, and it maps the 16-color palette
  + any `#hex`. Words are matched case-insensitively; captured replace-text keeps
  **your** capitalization. Runs with **no AI key** (deterministic) — a live model
  can be layered on for freeform phrasing later.
- `nxComputeSelector(element)` — builds a stable CSS selector (uses `#id`, then
  `tag.class`, then adds `:nth-of-type(n)` to disambiguate identical siblings).
- `nxVisualCss(overrides)` / `_kebab()` — joins `{selector, css}` into a stylesheet
  body, **converting camelCase style keys to valid kebab-case CSS** (`fontSize`→
  `font-size`). (This was a real bug caught by the tests: camelCase is invalid in
  a `<style>` block.)
- `_cssEscape()` — robust CSS identifier escaping with a manual fallback so it
  works even where `CSS.escape` is missing (jsdom, some embedded runtimes).

### Backend (worker)
- Same engine functions exported under `__internals` for the test battery.
- **`POST /sites/:id/visual`** — applies a list of `{selector, css?, text?}`
  overrides (or a whole `html` document, or a single `command`+`selector`) to a
  stored site and **persists** it. Returns the before/after quality score.
- `nxVisualApplyCss(html, css)` — idempotently injects / replaces a single
  `<style data-nx-visual>` block.
- `nxVisualApplyEdits(html, overrides)` — dependency-free (runs in the worker),
  applies CSS overrides **and** text replacement to leaf elements matched by a
  trailing `#id` or `.class`.

### Test suite
`tests/test_visual.mjs` — **45 checks**, green:
- **A1** pure command engine (size/color/text/bold/align/padding/radius/shadow/hide/
  explicit-size/italic/uppercase/unsupported).
- **A2** pure apply — kebab-case CSS, idempotent single style block, text edit via
  `#id` / `tag.class` / bare `.class`, CSS+text together.
- **A3** the `/sites/:id/visual` route — create site, apply CSS, apply text,
  server-side command, full-document replacement, **401 unauth**, **404 missing site**,
  and persistence verified by re-reading the stored HTML.
- **B1** frontend — engine parity, selector on a real DOM, and the WYSIWYG modal
  (script-free iframe, command input, chips, save) with zero runtime errors.

---

## Backlog (unchanged, not claimed)
- Screenshot → Website, AI Image Generation, in-product AI **Database Builder**
  (SQLite / virtualized tables), and the full agentic assistant on live data.
- 3D stays on the **curated library** (AI never invents a scene) per the standing
  design constraint.

## Measured results (honest, no invented multipliers)
- Visual engine + apply: 45/45 automated checks.
- Quality Engine (v0.0.1.2): 38/38 · Blueprint (v0.0.1.3): 29/29 · Agentic (v0.0.1.4): 23/23.
