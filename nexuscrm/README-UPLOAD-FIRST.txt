═══════════════════════════════════════════════════════════════════
 NEXUSCRM v0.0.1.0 "Aurora" — READ THIS FIRST
 How to put this onto GitHub (no coding, ~5 minutes)
═══════════════════════════════════════════════════════════════════

This pack is the COMPLETE `nexuscrm/` folder (the app + backend + tests +
patches + docs). It is a drop-in replacement for everything currently in
your GitHub repo. Follow ONE of these routes once, and GitHub, your laptop
and every future session all start from v0.0.1.0.

──────────────────────────────────────────────────────────────────
 ROUTE A — Upload to a new branch (easiest, no git needed)
──────────────────────────────────────────────────────────────────
1. Unzip this pack — you get ONE folder: `nexuscrm`.
2. Open https://github.com/mohamedxdragon1999-art/MY-WEBSITE
3. Top-left branch dropdown (says `main`) → type `THE-NEW-VERSION-OF-IT`
   → "Create branch … from main". (Skip this if you want to upload onto
   `main` directly.)
4. Click "Add file ▾ → Upload files".
5. Drag the ENTIRE contents of the `nexuscrm` folder into the upload page
   (subfolders `backend/`, `tests/`, `patches/` come along automatically).
   GitHub caps ~100 files per drag; if it stops, drag the remaining files
   in a second batch and commit again.
6. Commit message: `v0.0.1.0 Aurora — full app + handover pack`
7. "Commit changes."

Done. Later, to make it the default: Branch page → "Contribute ▾ →
Open pull request" → merge into `main`, or Settings → Branches → set
`THE-NEW-VERSION-OF-IT` as default.

──────────────────────────────────────────────────────────────────
 ROUTE B — Git commands (also fine)
──────────────────────────────────────────────────────────────────
   git clone https://github.com/mohamedxdragon1999-art/MY-WEBSITE.git
   cd MY-WEBSITE
   # replace the repo contents with this nexuscrm/ folder
   rm -rf nexuscrm && cp -r /path/to/unzipped/nexuscrm .
   git add -A
   git commit -m "v0.0.1.0 Aurora — full app + handover pack"
   git push origin THE-NEW-VERSION-OF-IT

──────────────────────────────────────────────────────────────────
 VERIFY AFTER APPLYING
──────────────────────────────────────────────────────────────────
- `nexuscrm/NexusCRM_V4_Hardened.html` contains "v0.0.1.0 — Aurora",
  a `<style id="aurora-css">` block, and `SPLINE_SCENES` declared at
  top level right before `const NX_SCENE_FAMILIES`.
- `nexuscrm/HANDOVER-NEXT-SESSION.md` and `nexuscrm/CHANGES-v0.0.1.0.md` exist.
- `nexuscrm/tests/` has 21 `.mjs` files including `test_aurora.mjs`.
- `nexuscrm/server.js` contains `hasInternet`.

Locally after cloning that branch:
   cd nexuscrm && npm install && node tests/run_all.mjs
   → ✅ FULL BATTERY GREEN — 19 suites, 100% route coverage
(npm install is required — node_modules is never committed.)

In the app:
1. Hard refresh (Ctrl+Shift+R) → log in → sidebar bottom-left reads
   **v0.0.1.0 — Aurora**.
2. Dashboard: today strip + quick actions; Settings → 🎨 Appearance &
   Ergonomics with 6 accent themes; `?` shortcuts overlay; Ctrl+K palette.
3. ✨ 3D Scene Gallery shows all 50 scenes.
4. AI provider test in a hosted preview shows the instant, honest
   "server has no internet" message — correct by design (sandbox).
