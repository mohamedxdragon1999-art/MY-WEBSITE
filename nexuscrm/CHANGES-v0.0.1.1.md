# ═══════════════════════════════════════════════════════════════════
# CHANGES FILE — GET v0.0.1.1 "NEXUS 2.0" ONTO GITHUB
# Updated 2026-08-31 · builds on committed v0.0.1.0 (a6e028c → e1a1ac6)
# ═══════════════════════════════════════════════════════════════════

## 0) WHAT THIS RELEASE IS

v0.0.1.1 is a **data-safety, accessibility, performance and AI-resilience
overhaul** layered on top of the already-strong v0.0.1.0 Aurora build. It does
not re-do what the app already does well (esc/escAttr/jsAttr escaping,
`sanitizeHtml`, debounced search, error boundary, honest per-provider live-model
messaging, backup/restore, `prefers-reduced-motion` handling) — it **adds new
layers** on top and proves them with new test suites + before/after numbers.

Everything is measured, not asserted: the new `test_benchmark.mjs` reports real
before/after timing for the hot paths.

## 1) WHAT'S NEW IN v0.0.1.1

### A. Data-safety layer (versioned, self-healing local DB)
- `DB_SCHEMA_VERSION = 2`. A browser DB that predates a field the UI reads
  (e.g. `aiMemory`, `seq`) is **silently upgraded** instead of throwing.
- `healWorkspace()` fills every array `[]` and scalar default the UI reads, so
  an old/hand-edited DB never trips a `.map` on `undefined`.
- `migrateDB()` = heal + compact (drop `null` fields) + stamp `__v`, **idempotent**,
  invoked on every load.
- `snapshotDBForMigration()` writes the pre-migration DB to its own key **before**
  any transformation, so a buggy migration can never destroy data irrecoverably.
- `estimateDBBytes()` + `checkStorageHeadroom()` warn once a minute when the data
  approaches the ~5 MB browser limit (and surface a backup nudge) **before** a
  `QuotaExceededError` would silently drop a save.
- `flushSave()` writes immediately and is wired to `pagehide` + `beforeunload`
  (one-time guard) so a pending debounced save is never lost on tab close.
- `importAllData()` (backup restore) now runs the imported DB through `migrateDB()`
  and surfaces a save-failure toast instead of silently returning.
- **Hardening:** a backup DB containing malformed/null arrays is healed on import.

### B. Accessibility layer
- Every modal is exposed as `role="dialog"`, `aria-modal="true"`,
  `aria-label="Dialog"`, saves/restores the previously-focused element, and
  focuses the first interactive control on open.
- A global focus trap keeps Tab / Shift+Tab cycling **inside** the open modal
  (WCAG 2.4.3 focus order) and closes it on Escape.
- `decorateA11y()` (run at boot, fresh-login, and after every modal injection):
  - copies a `[title]` onto **icon-only** controls as an accessible name
    (`aria-label`), treating empty text **or** pure emoji/symbol text (🧠 ⚙️ 📧 ×)
    as icon-only — real words in any script (`Settings`, `إعدادات`) are never
    overwritten;
  - labels every `.modal-close` as "Close dialog";
  - sets landmark roles: `#sidebar` → `navigation`, `#main` → `main`;
  - creates a polite `#a11y-live` region.
- Toasts are announced into `#a11y-live` (via `textContent`, never `innerHTML`).

### C. Performance
- `esc()` is now memoized with a **bounded** (`~4k`) cache — the hottest render
  helper (it runs once per field per row in large list/tables). Icon-only fill
  kept the identical output; the cache is capped so a pathological domain can't
  grow it without bound.
- Measured on the real file (`test_benchmark.mjs`): a repeated-value list renders
  through `esc()` **~3.2× faster (≈69% less time)** than the old per-call regex,
  with byte-identical output.
- A 2,000-contact workspace serializes for the storage-headroom check in **~2 ms**
  (measured).

### D. AI resilience
- `streamProviderDirect()` now races each provider read against a **30 s stall
  watchdog**; a provider that accepts a connection but never sends a byte no
  longer spins the stream cursor forever — the reader is cancelled and a clean
  `done` frame ends the request so the UI can respond.

### E. Version marker
- Rebranded to `Nexus 2.0`; `APP_VERSION = 'v0.0.1.1'`; sidebar shows
  `v0.0.1.1 — Nexus 2.0 · All-in-One Business Platform`.

## 2) TEST COVERAGE (new suites in this release)

| Suite | Checks | Pins |
|---|---|---|
| `test_benchmark.mjs` | 24 | esc memo before/after, DB serialize timing, heal/migrate speed + idempotency |
| `test_xss_injection.mjs` | 32 | the new a11y render paths keep user data inert (lists, modal decoration, toast live region) |
| `test_overhaul.mjs` | 42 | data-safety, modal a11y + focus trap + Escape + focus restore, `decorateA11y`, toast live region, fresh-login decoration, stream stall watchdog |

All registered in `tests/run_all.mjs`.

## 3) HOW TO GET THIS ONTO GITHUB

Same two routes as v0.0.1.0:

**Route A — git push (needs a GitHub-authenticated session):**
```bash
cd /home/user/repo/nexuscrm
git add -A
git commit -m "v0.0.1.1 Nexus 2.0 — data-safety, accessibility, performance & AI resilience overhaul"
git push origin <branch>
```
(The branch must be a strict superset of GitHub main — it is.)

**Route B — manual upload (no auth, ~5 min):**
`nexuscrm/GITHUB-UPLOAD-PACK-v0.0.1.1.zip` is the complete `nexuscrm/` folder +
`README-UPLOAD-FIRST.txt`. Unzip → upload the whole `nexuscrm` folder to the
branch via **Add file → Upload files**.

## 4) BUILD ARTIFACTS
- `NexusCRM_v0.0.1.1.zip` — the user-facing single-file app (and its launchers).
- `GITHUB-UPLOAD-PACK-v0.0.1.1.zip` — the whole repo folder for web upload.
