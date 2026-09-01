# ═══════════════════════════════════════════════════════════════════
# CHANGES FILE — GET v0.0.1.0 "AURORA" ONTO GITHUB
# Updated 2026-08-31 · GitHub state VERIFIED from a fresh clone
# ═══════════════════════════════════════════════════════════════════

## 0) THE TRUE STATE OF GITHUB (verified, not assumed)

- `origin/main` = `010db76` "Merge pull request #1 from
  mohamedxdragon1999-art/arena/01a04f0e-my-website" — contains an
  **EARLY** app snapshot only:
  - `nexuscrm/NexusCRM_V4_Hardened.html`: 6,446 lines (current: 8,330)
  - 7 test files (current: 21 suites)
  - **NO** 3D Scene Gallery, Ctrl+K palette, Aurora design system,
    appearance controls, honest-AI-connectivity, handover docs, zip.
- Branch `THE-NEW-VERSION-OF-IT` **does not exist** on GitHub — the
  manual web-upload handovers were never completed by anyone.
- **Everything from v0.0.0.0.6 → v0.0.1.0 exists ONLY in the Arena
  workspace**, re-committed locally as **`a6e028c`** on branch
  `arena/01a04f0e-my-website` (single commit — the environment
  re-cloned and wiped the per-version history; files were unaffected
  and the full battery re-verified green: 19 suites · 1,308 checks ·
  0 failures · 61/61 routes).

**Conclusion: upload the WHOLE `nexuscrm/` folder — not a patch list.
GitHub is too far behind for a minimal diff to make sense.**

## 1) WHAT THIS RELEASE ADDS OVER WHAT'S ON GITHUB

| Since GitHub's version | What you get |
|---|---|
| v0.0.0.0.6–.7 | **50-scene 3D Spline gallery** (SPLINE_SCENES, top-level scope fix), AI hardening cycles 41–80 |
| v0.0.0.0.8 | **Ctrl+K command palette** (fuzzy search, keyboard nav, XSS-safe) |
| v0.0.0.0.9 | Gallery scope hotfix (scenes render after full app load) + honest relay error text |
| v0.0.0.0.10 | `/api/health` reports `internet:true/false`; relay-aware "Testing through" label; AI tests fail instantly + honestly when the server has no internet (hosted preview case) |
| **v0.0.1.0 Aurora** | New design system (glass, aurora background, gradient text/glow, staggered animations, light mode), **6 accent themes + density + motion controls** (Settings → Appearance & Ergonomics), dashboard today strip + quick actions, **real KPI sparklines** (true visit snapshots), getting-started checklist, palette v2 (recents + actions), `?` shortcuts overlay + Ctrl+Shift+L/A/D hotkeys |
| Docs & tests | 19 suites / 1,308 checks (incl. new `test_aurora.mjs` 44 checks), CHANGELOG, FEATURE_STATUS, **HANDOVER-NEXT-SESSION.md**, this file, release zip |

## 2) ROUTE A — GIT PUSH (preferred; needs a session with working GitHub auth)

```bash
cd /home/user/MY-WEBSITE
git log --oneline -2        # expect a6e028c on arena/01a04f0e-my-website
git ls-remote origin        # verify auth works
git push origin arena/01a04f0e-my-website
# then open + merge a PR:
gh pr create --base main --head arena/01a04f0e-my-website \
  --title "v0.0.1.0 Aurora — full app + handover pack" \
  --body "Closes the gap since PR #1: 3D gallery, palette, honest AI connectivity, Aurora overhaul, 19 test suites."
```
The branch is a strict superset of GitHub main → the merge is clean.
Alternative (user's preferred branch name):
`git push origin arena/01a04f0e-my-website:THE-NEW-VERSION-OF-IT`

## 3) ROUTE B — MANUAL WEB UPLOAD (no coding, ~5 minutes, always works)

A ready-made pack exists for exactly this:
**`nexuscrm/GITHUB-UPLOAD-PACK-v0.0.1.0.zip`** (1.5 MB · 112 files =
the complete `nexuscrm/` folder + `README-UPLOAD-FIRST.txt`).

1. Download and unzip it → you get one folder: `nexuscrm`.
2. Open https://github.com/mohamedxdragon1999-art/MY-WEBSITE
3. Branch dropdown (says "main") → type `THE-NEW-VERSION-OF-IT` →
   "Create branch … from main" (or skip this to upload onto main).
4. **Add file → Upload files** → drag the ENTIRE contents of the
   `nexuscrm` folder into the page (subfolders backend/, tests/,
   patches/ come along automatically).
5. Commit message: `v0.0.1.0 Aurora — full app + handover pack`.
6. Optional cleanup: delete leftover old root `.txt` duplicates if any
   remain from the original upload.

## 4) VERIFY AFTER APPLYING

On GitHub:
- `nexuscrm/NexusCRM_V4_Hardened.html` contains `v0.0.1.0 — Aurora`,
  `aurora-css`, `AURORA` (≥30 refs), and `SPLINE_SCENES` at top level
  right before `const NX_SCENE_FAMILIES`.
- `nexuscrm/HANDOVER-NEXT-SESSION.md` and
  `nexuscrm/CHANGES-v0.0.1.0.md` exist.
- `nexuscrm/tests/` has 21 `.mjs` files incl. `test_aurora.mjs`.
- `nexuscrm/server.js` contains `hasInternet`.
- Zips present: `NexusCRM_v0.0.1.0.zip` (+ the upload pack if included).

Locally after cloning that branch:
```bash
cd nexuscrm && npm install && node tests/run_all.mjs
# → ✅ FULL BATTERY GREEN — 19 suites, 100% route coverage
```
(`npm install` is required — node_modules is never committed.)

In the app (user-facing):
1. Hard refresh (**Ctrl+Shift+R**) → log in → sidebar bottom-left reads
   **v0.0.1.0 — Aurora**.
2. Dashboard: today strip + quick actions; Settings → 🎨 Appearance &
   Ergonomics with 6 swatches; `?` → shortcuts; `Ctrl+Shift+L` → light.
3. ✨ 3D Scene Gallery shows all 50 scenes.
4. AI provider test in the hosted preview shows the instant, honest
   "server has no internet" message — correct by design (sandbox).

## 5) AI FEATURE AUDIT (v0.0.1.0, 2026-08-31)

Ran a full offline/local-mode audit of the AI surface (no provider key, no
backend) by booting the real `NexusCRM_V4_Hardened.html` in jsdom and driving
every endpoint + every real UI tool handler. Added
`tests/test_ai_features.mjs` (87 checks) to lock it in.

**Bug fixed — 5 generation tools silently reused the email template.**
In local/offline mode, `localGenerate` looked up `LOCAL_TPL[type]`, and for a
type with no template it fell through to `LOCAL_TPL.email`. So a no-key user
who clicked *Product Description*, *Press Release*, *Meeting Agenda*,
*Job Description*, or *Blog Outline* got a **follow-up email** draft. Added
5 type-appropriate templates to `LOCAL_TPL` (product_description,
press_release, meeting_agenda, job_description, blog_outline) so each returns
its own copy. Verified distinct from the email template + each other.

**Verified working (local/offline):** `/ai/generate` (all 20 types the UI
requests), `/ai/complete`, `/ai/sentiment` (positive/negative/neutral +
confidence), `/ai/build-workflow` (valid trigger + actions), `/ai/agent`
(create_task persists), `/ai/forecast`, `/ai/brief`, `/ai/smart-reply`,
`/ai/score-tasks`, `/ai/deal-risks`, `/ai/pipeline-health`, `/ai/translate`,
`/ai/tone-remix`, `/ai/doc-analyze`, `/ai/suggest-workflows`, `/ai/rewrite`,
`/ai/insights/dashboard`, `/ai/models`, `/ai/memory` (GET/DELETE), and the
offline chat engine (`localChatComplete` — answers lead/pipeline/task
questions from live workspace data, and is honest about local mode).

**Verified working (the "bad level" risk cases):**
- Keyed-but-unreachable provider → falls back to a local draft **fast**
  (<2s, no 10s hang) and names the real provider error (`localFallbackNote`).
- 401 (bad key) → returns content, never crashes.
- `/api/ai-proxy` relay over the local server reaches NVIDIA and surfaces
  provider errors verbatim (validated a 410 model-end-of-life response and
  401s for valid catalog models). Catalog + default `nvidia/llama-3.1-nemotron-70b-instruct`
  are currently valid on NVIDIA.
- Backend `GEN_PROMPTS` already covers every type the frontend requests, and
  `callProvider` throws honestly when no key — no silent mis-prompting there.

Full battery still green except the pre-existing environmental
`test_deploy_studio` (asserts `/api/cf` returns 502 offline, but a sandbox
with outbound internet gets a real Cloudflare 400).

### Two real bugs found from live NVIDIA NIM use (2026-08-31, fixed)

1. **Model dropdown was "fixed" / stale.** In local mode (no backend), the
   Settings model list came from hard-coded `NVIDIA_MODELS`/`OPENAI_MODELS`
   arrays, so it showed models that may no longer exist and never reflected
   what the user's key could actually use. Added `localFetchLiveModels()`: the
   local `/ai/models` handler now fetches the LIVE catalogue from
   `integrate.api.nvidia.com/v1/models` (or OpenAI's) using the stored key,
   via the local relay when active (bypasses browser CORS). It filters out
   non-chat models (embeddings/audio/vision), orders curated-proven models
   first, and falls back to the curated list only on failure / no key. The
   dropdown shows live flags ("✅ Live catalog from NVIDIA NIM (n models)").

2. **Every local AI chat showed "⚠️ AI request failed".** `chatStreamFetch`
   returned a raw `{ body: stream }` in local mode (with no `.ok`/`.json`),
   so the panel/hub/bot chat callers' `if (!res.ok)` check always fired and
   showed "AI request failed" even for a perfectly-good local answer. Added
   `wrapChatStream()` which normalizes the local producer result into a
   Response-compatible shape (`{ ok:true, status:200, body, json }`);
   wrapped it in the has-key and no-key local paths. Verified end-to-end:
   the panel chat now streams the real local answer into the bubble.

- /ai/models now returns live models (NVIDIA fetch over the relay verified at
  76 models with a key, vs the curated 15).

### Improvement: honest live-catalog refresh diagnostics (2026-08-31)

The refresh toast used to be a single misleading catch-all —
`"⚠️ Could not reach the live catalogs (no key set, or local mode without
backend/proxy)"` — which fired for **every** failure and wrongly claimed
"no key set" even when a key was present, so a user with a valid key but a
relay/CORS hiccup got pointed at the wrong cause.

Now `refreshModels()` reports the **actual per-provider reason** instead:

- No keys at all → *"Set an NVIDIA or OpenAI API key to load its live model
  catalog…"* (not the misleading blob).
- NVIDIA live-succeeds + OpenAI no key → *"✅ NVIDIA live catalog refreshed
  (n models). Set an OpenAI key to unlock its live list too."*
- Both live → *"✅ Live catalogs refreshed — n NVIDIA + o OpenAI models."*
- Invalid/revoked key → *"⚠️ Could not load live catalogs: NVIDIA — 401 —
  invalid or revoked key; …"*
- CORS (direct call, no relay) → names "CORS … run via Start-NexusCRM".
- Network down → names "network".

Implementation: `localFetchLiveModels()` now returns a `reason`
(`no_key` / `cors` / `network` / `http_<status>` / `too_few` / `live`) and
the local `/ai/models` handler passes it through as `nvidia_reason` /
`openai_reason`. The Workers backend `fetchLiveModels()` got the same `reason`
(via decrypted key) and the `/ai/models` route now forwards it, plus a cache-hit
shape fix so `.live`/`.reason` are preserved on a cached response. Added 7
regression checks to `tests/test_ai_features.mjs` (now 87 checks) covering
no-key, keyed-success, and 401 messaging.
