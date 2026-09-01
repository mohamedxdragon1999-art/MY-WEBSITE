# ═══════════════════════════════════════════════════════════════════
# NEXUSCRM — FULL HANDOVER TO THE NEXT AI SESSION
# Written 2026-08-30 · Current version: **v0.0.1.0 "Aurora"**
# ═══════════════════════════════════════════════════════════════════

You are a new AI coding session picking up long-running work on this
repository. This file is the complete context. Read it fully before doing
anything. The workspace (this repo checkout) is the source of truth —
trust files over memory.

---

## 0) THE FIRST THREE THINGS TO DO

1. **Read the user's instruction file** — repo root contains
   `i want you to read and understand t.txt` (~81 KB). It was NEVER read
   in any previous session. It may contain standing instructions from the
   user that change priorities. Read it early and ask the user about
   anything in it that conflicts with this handover.
2. **Test whether GitHub works in your session — and if it does, PUSH
   IMMEDIATELY.** The user's #1 request is applying the work to GitHub
   (nothing since v0.0.0.0.5 was ever pushed there — see Section 1).
   Run `git ls-remote origin`; if it works, follow Route A in Section 3
   right away (push `arena/01a04f0e-my-website`, PR → main, merge).
   If auth fails, tell the user to reconnect GitHub in Arena and use
   Route B (upload pack) meanwhile.
3. **Ask the user what they want next** — but come prepared: Section 8
   lists the open questions and the backlog.

---

## 1) WHERE THINGS STAND RIGHT NOW

- **App**: NexusCRM — a full CRM (contacts, pipeline, tasks, invoices,
  calendar, forms, workflows, websites, webchat, 26 views) in ONE file:
  `nexuscrm/NexusCRM_V4_Hardened.html` (~8,300 lines) + a local Node
  server `nexuscrm/server.js` + an optional Cloudflare backend
  (`nexuscrm/backend/`). Runs 100% offline in "local-only mode"
  (localStorage engine) — that is how the user actually uses it.
- **Current shipped version**: **v0.0.1.0 "Aurora"** (commit `967677f`),
  built as a full visual + UX overhaul (see `CHANGELOG.md`).
- **Zip for the user**: `nexuscrm/NexusCRM_v0.0.1.0.zip` (~776 KB).
- **Local git**: branch `arena/01a04f0e-my-website`. ⚠️ HISTORY EVENT:
  the environment was re-cloned from GitHub at the end of the last
  session, which WIPED the local commit history (per-version commits
  5362182/d7ff17f/967677f/c43a5f6 are gone). The workspace FILES all
  survived and were re-committed as ONE commit: **`a6e028c`** (all of
  v0.0.0.0.6 → v0.0.1.0 in a single commit). Verified healthy after the
  rebuild: full battery 19 suites / 1,308 checks / 0 failures.
- **GitHub TRUE state (verified 2026-08-31 from the fresh clone refs):**
  - `origin/main` = `010db76` "Merge pull request #1 from
    mohamedxdragon1999-art/arena/01a04f0e-my-website" — an EARLY app
    snapshot: HTML only 6,446 lines (vs 8,330 now), 7 test files
    (vs 21), **NO 3D gallery, NO command palette, NO Aurora, NO
    handover docs, NO release zip**.
  - Branch `THE-NEW-VERSION-OF-IT` **DOES NOT EXIST on GitHub** — the
    user never completed the manual web-upload handovers. All zip →
    web-upload instructions from previous sessions never got executed.
  - Net: **everything from v0.0.0.0.6 onward exists ONLY in this
    workspace.** The user's #1 open request is getting it onto GitHub.

### Recent version history (why each exists)
| Version | What it fixed/added |
|---|---|
| v0.0.0.0.6–.8 | 50-scene 3D gallery, AI hardening cycles, Ctrl+K command palette |
| v0.0.0.0.9 | Gallery scope bug (SPLINE_SCENES was trapped inside a function → top-level now, before `const NX_SCENE_FAMILIES`), honest relay error surfacing |
| v0.0.0.0.10 | Honest AI connectivity: `/api/health` reports `internet:true/false`, relay-aware mode label, instant no-internet fast-fail in provider tests |
| v0.0.1.0 | **Aurora overhaul** — new design-system CSS layer, 6 accent themes, light mode, density, motion toggle, dashboard today strip + real KPI sparklines + getting-started checklist, palette v2, shortcuts overlay. +44 checks |

---

## 2) THE ABSOLUTE TRUTHS (never re-litigate these)

1. **The hosted preview sandbox has NO outbound internet.** AI provider
   tests (NVIDIA NIM / OpenAI) can NEVER succeed in the preview. This is
   not a bug and not the user's key. v0.0.0.0.10+ reports this honestly
   (`/api/health` → `internet:false`, instant clear error). Real-key AI
   testing happens ONLY on the user's own machine
   (`Start-NexusCRM.bat` → relay → provider).
2. **The user is often on a stale cached page.** Before debugging any
   reported bug, have them hard-refresh (**Ctrl+Shift+R**) and READ THE
   VERSION NUMBER bottom-left of the sidebar. A "bug" on an old version
   is not a bug.
3. **The sidebar and app only render after login.** The user must log in
   (or Quick Start) before the 3D gallery / any view exists.
4. **Never ship placeholder/for-show features.** Every feature must be
   real and covered by an automated check. The user explicitly demands
   this.
5. **NVIDIA key hygiene**: the user's real key must NEVER appear in
   tracked files or logs. The user pasted a real key into the preview
   once — they were told to rotate it. Remind them if relevant.

---

## 3) GITHUB — THE SITUATION AND THE ROUTES

The user's top request: **get the current state onto GitHub.** The last
session could not push (its GitHub write-access was closed by the
platform — pushes/PRs/gh fail there). If YOUR session has working auth,
do Route A immediately — it is the whole reason the user starts a new
session.

**Route A (preferred — git push, ~1 minute):**
```bash
git log --oneline -2      # expect a6e028c on arena/01a04f0e-my-website
git ls-remote origin      # verify auth actually works
git push origin arena/01a04f0e-my-website
# then open a PR arena/01a04f0e-my-website → main and merge it
# (gh pr create --base main --head arena/01a04f0e-my-website ...)
```
GitHub's main is far behind and this branch is a strict superset, so the
PR merge is clean. Alternatively push straight to a branch named
`THE-NEW-VERSION-OF-IT` if the user still wants that branch name:
`git push origin arena/01a04f0e-my-website:THE-NEW-VERSION-OF-IT`.

**Route B (fallback — manual web upload, always works):**
A ready-made pack exists: `nexuscrm/GITHUB-UPLOAD-PACK-v0.0.1.0.zip`
(1.5 MB, 112 files = complete `nexuscrm/` folder + README-UPLOAD-FIRST
with click-by-click steps). User unzips → GitHub web → branch dropdown →
create `THE-NEW-VERSION-OF-IT` (or stay on main) → "Add file → Upload
files" → drag the whole `nexuscrm` folder → commit. Full details in
`CHANGES-v0.0.1.0.md`.

If GitHub auth fails in your session too: tell the user to reconnect
GitHub in Arena, or use Route B. Never ask for passwords/tokens in chat.

---

## 4) HOW TO VERIFY A BUILD (do this before trusting anything)

```bash
cd nexuscrm
node tests/run_all.mjs        # FULL battery
# EXPECT: "✅ FULL BATTERY GREEN — 19 suites", 100% route coverage
# Totals: 1,308 checks · 0 failures · 61/61 routes
```

Start the preview (bind 0.0.0.0, port 8080):
```bash
PORT=8080 HOST=0.0.0.0 node server.js   # from nexuscrm/
```
Then verify:
- `curl -s http://127.0.0.1:8080/api/health` → contains
  `"aiRelay":true,"internet":false` (false is correct — sandbox)
- `curl -s http://127.0.0.1:8080/ | grep -o "v0.0.1.0 — Aurora"`
- UI markers after login: version bottom-left = **v0.0.1.0 — Aurora**,
  ✨ 3D Scene Gallery in sidebar, Ctrl+K palette, `?` shortcuts overlay,
  Settings → "🎨 Appearance & Ergonomics".

---

## 5) SHIP PROCEDURE (per release — follow exactly)

1. Make changes; run the relevant suite(s), then the full battery.
2. Bump version: `NexusCRM_V4_Hardened.html` — sidebar string
   (`v0.0.1.0 — Aurora`, ~line 311) and `const APP_VERSION` (~line 1105).
3. Add a `CHANGELOG.md` entry; update `FEATURE_STATUS.md` basis numbers.
4. Delete the old zip; build the new one from `nexuscrm/`:
   `zip -qr NexusCRM_vX.Y.Z.W.zip . -x "node_modules/*" "*.zip" ".deployed.json" ".wrangler/*" ".git/*"`
5. `git add -A nexuscrm && git commit -m "vX.Y.Z.W — …"` (root of repo).
6. Restart the preview process (kill by process_id, not pkill — pkill
   kills the preview), re-verify with curl.
7. Present the zip; tell the user: hard refresh, log in, check version
   bottom-left. If GitHub works → Route A; else remind them of the zip →
   web-upload route.

---

## 6) ARCHITECTURE MAP (landmarks, verify with grep — lines drift)

`nexuscrm/NexusCRM_V4_Hardened.html` (single-file app):
- Lines 7–272: original CSS. **Line ~274: `<style id="aurora-css">`** —
  the Aurora design-system layer (accent themes, light mode, density,
  motion, glass, animations). Reapplies cleanly because it only
  overrides the same CSS variables + adds component styles.
- ~300: auth screen (login/register/Quick Start).
- ~820–845: `LOCAL_AI_RELAY`, `LOCAL_RELAY_INTERNET`, `detectLocalRelay`
  IIFE (reads `/api/health`).
- ~1105: `const APP_VERSION`.
- ~1197–1250: `pingProvider` (pre-flight only when NOT viaProxy; instant
  fail when relay has no internet).
- ~2132: `api()` — falls back to `localApi` (localStorage engine) when
  no backend.
- ~2152: `navigate(view)` — **wrapped by Aurora** to track recent views
  (`nx_recent_views` in localStorage).
- ~2387–2530: Ctrl+K command palette (`nxCommands` — **wrapped by
  Aurora** to prepend recents + appearance actions; `nxRenderCmdk`,
  `nxPaintCmdk`, `nxRunCmdk`, XSS-safe via `esc()`).
- ~2902: `const views = {}` … one async function per view
  (dashboard ~3100, settings ~5561, gallery3d etc.).
- ~6641: `aiModeInfo()` — relay-aware mode labels ('relay' mode).
- ~6895–6901: **SPLINE_SCENES marker block** `__NX_SPLINE_SCENES_FE__` /
  `_END__` — MUST stay top-level, right before `const NX_SCENE_FAMILIES`
  (the v0.0.0.0.9 bug: it was inside a function → gallery died).
- ~7780+: **Aurora JS layer** (`patches/aurora.js` content, injected
  before `window.views = views;`): `window.AURORA` appearance system,
  dashboard wrapper (today strip, KPI sparklines, checklist), settings
  wrapper (Appearance card), shortcuts overlay, `navigate`/`nxCommands`
  wraps.

Other files:
- `server.js` — local static server + `/api/ai-proxy` relay +
  `/api/health` (with cached `hasInternet()` probe).
- `backend/src/index.js` (+ `schema.sql`, `wrangler.toml`,
  `auto-deploy.js`) — the real Cloudflare Worker backend.
- `patches/` — the patch scripts/sources that PRODUCED the HTML changes
  (`aurora.css`, `aurora.js`, `build-spline-scenes.mjs`, older .py
  patches). `build-spline-scenes.mjs` is idempotent (verified
  byte-identical rebuilds); keep it that way.
- `tests/` — 19 suites (see `run_all.mjs`). Key ones:
  `test_frontend.mjs` (182 checks, jsdom full app load),
  `test_aurora.mjs` (44 checks — appearance, sparklines, palette v2,
  shortcuts, CSS layer), `test_spline_scenes.mjs` (36),
  `test_cmdk.mjs` (18), `test_local_ai_proxy.mjs` (28),
  `test_real_nvidia.mjs` (skips cleanly without a key file).
- `README-HANDOVER.md` — the zip → web-upload procedure for the user.
- `CHANGES-v0.0.1.0.md` — exact file list + GitHub application routes.
- Root of repo: `voice-studio/` (untouched so far), the unread
  `i want you to read and understand t.txt`.

---

## 7) STANDING USER CONSTRAINTS (never violate)

- **3D taste** (rounds 3–4 verdicts): APPROVED styles = spline
  interactive landing hero; three.js particle galaxy/gradient hero;
  awwwards scroll floating objects; liquid-gold metallic animated text
  (favorite); chrome liquid-metal type (partially). REJECTED as
  "trash": glass typography, matcap/chrome object showcases,
  soft-bodies, drivable car world, ocean waves, bird murmuration,
  low-poly islands. Taste = premium dark abstract motion.
- **Never include unvetted images** (no photos of people at computers,
  no dinosaur scenes). Without vision, vet by source title/metadata only.
- **3D scenes come from the user's two Spline collection links**
  (community.spline.design public mirror; file pages show Remix counts —
  most-downloads first, >100 remixes each), never self-created.
- **Scene rules**: pure scene only — no genre-pinning words/labels, no
  code text, no captions; fully interactive/animated; high graphics
  quality; animated words user-editable (same animation/style, any
  language).
- **Avoid these failed searches**: "spline community gallery best 3d
  scenes"; "spline community scene featured animated interactive
  abstract".
- **No placeholder features** (see Section 2.4).
- Round-5 scene catalog (50 scenes with UUIDs/stats) — the gallery data
  lives in the HTML's SPLINE_SCENES block; thumbnail pattern:
  `community-filepreview.spline.design/{uuid}.jpg`.

---

## 8) OPEN QUESTIONS FOR THE USER + BACKLOG

**Open questions (ask these):**
1. Did the 3D gallery finally appear after hard refresh on
   v0.0.0.0.9+? (They reported "gallery does not appear at all"; the
   served build was verified correct — they never reported back the
   version number they saw. v0.0.1.0 supersedes it, but confirm.)
2. Did they rotate the NVIDIA key they pasted into the preview?
3. What is in `i want you to read and understand t.txt`? (Read it
   yourself first — Section 0.)
4. Do they want Route A (you push to GitHub) or continue zip uploads?

**Backlog candidates (user was offered these, not yet chosen):**
- Contacts/pipeline tables: click-to-sort columns, bulk select/actions,
  pagination.
- Notification center (unified alerts).
- `FEATURE_STATUS.md` Tier 3 gaps: `/auth/logout` tests, demo-mode
  tests, social planner, sub-accounts, Gmail OAuth (needs real Google
  credentials), voice notes (browser hardware).
- Reports: charts are canvas-based (stubbed in jsdom) — a visual
  verification pass or SVG chart rewrite would raise their tier.
- `voice-studio/` — untouched; ask the user if/when they want it
  integrated.

---

## 9) GOTCHAS LEARNED THE HARD WAY

- Kill preview servers **by process_id** — `pkill -f "node server.js"`
  kills the preview tooling itself.
- Heredocs mangle `${...}` — for big code patches write the payload to
  a file (`write_file`) and insert with a Python script (see
  `patches/`). Template literals in heredocs = corrupted output.
- Global `sed` replaces hit the FIRST occurrence; assert anchor
  uniqueness in Python before replacing.
- Top-level `return` in a `.mjs` loop is a SyntaxError; use flags.
- In `vm` stubs, `document.getElementById` returning null and missing
  `location.hash` crash `init()` — prefer jsdom
  (`runScripts:'dangerously'`, `window.eval`) for full-load tests.
- Build-script idempotency: after changing a function signature that a
  patch anchor matches, verify the rebuild actually CHANGES the file —
  a silent no-op looks exactly like success.
- Users report errors from stale cached pages. Always: version number
  first, debug second.
- **The environment may re-clone the repo between turns**: workspace
  files persist, but local git history can be WIPED and `node_modules`
  disappears (it's excluded from snapshots). After any recycle: re-run
  `npm install` in `nexuscrm/` (registry was reachable), re-verify the
  battery, and re-commit everything (`git add -A && git commit`).
  Missing jsdom = 5 suites fail with ERR_MODULE_NOT_FOUND — that is a
  missing-dependency problem, NOT broken code.
- The AI relay test suite asserts `/api/health` contains the boolean
  `internet` field — keep that when touching `server.js`.
- Preview servers must bind `0.0.0.0` (not 127.0.0.1) or the live
  preview breaks.

---

## 10) QUICK SANITY SNAPSHOT (what "healthy" looks like)

```
$ node tests/run_all.mjs
✅ FULL BATTERY GREEN — 19 suites in ~106s, 100% route coverage
   (1,308 checks · 0 failures · 61/61 routes)

$ curl -s localhost:8080/api/health
{"ok":true,"service":"nexuscrm-local-static","localOnly":true,"aiRelay":true,"internet":false}

Sidebar version after login: v0.0.1.0 — Aurora
```

If any of that is untrue in the new session, something regressed — find
out what before building on top.
