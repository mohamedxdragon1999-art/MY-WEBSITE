# How to get v0.0.0.0.8 into your GitHub (2 minutes)

> **You already created the branch `THE-NEW-VERSION-OF-IT` — use Option 1
> below and upload into THAT branch.** (The coding workspace cannot push for
> you: its GitHub token expired. The download → upload path below is the
> bridge, and it takes about two minutes.)

Your GitHub repo still has the OLD version. The new version (v0.0.0.0.8:
50 3D scenes + gallery, command palette, 80 AI hardening cycles, 1,262 green
tests) exists in the build workspace only. Follow ONE of the two options
below ONCE — after that, GitHub, your laptop, and every future session all
start from the new version.

---

## Option 1 — GitHub website, into your new branch (easiest, no tools needed)

1. Download `NexusCRM_v0.0.0.0.8.zip` (from the workspace file viewer).
2. Unzip it on your computer — you get a folder with ~104 files.
3. Open your repo on github.com. At the TOP-LEFT of the file list there is a
   branch dropdown (it probably says `main`) — click it and switch to
   **`THE-NEW-VERSION-OF-IT`**. The page reloads showing that branch's files.
4. Now click **Add file ▾ → Upload files**.
5. Drag the CONTENTS of the unzipped folder into the upload page — the
   folders (`backend`, `tests`, `patches`, `docs`) AND all the loose files.
   GitHub web upload caps ~100 files per drag, so do two batches:
   **batch 1:** the four folders → commit; **batch 2:** the loose files
   (NexusCRM_V4_Hardened.html, server.js, README-HANDOVER.md, …) → commit.
6. Commit message: `v0.0.0.0.8 — 50 3D scenes, command palette, AI hardening`
7. Click **Commit changes** — it commits straight into
   `THE-NEW-VERSION-OF-IT`.

Done. Open the branch page — the new version is now the source of truth.
(Old `.txt` files from the first upload may still sit in the branch; they are
harmless, but you can delete them via the web UI: select file → trash icon.)

**Later, to make it the main version:** Branch page →
**Contribute ▾ → Open pull request** → merge it into `main` yourself,
or Settings → Branches → change the default branch to
`THE-NEW-VERSION-OF-IT`.

## Option 2 — Git commands (if you have git installed)

```bash
# 1. get a fresh copy of your repo
git clone https://github.com/mohamedxdragon1999-art/MY-WEBSITE.git
cd MY-WEBSITE

# 2. delete everything except .git, then copy the unzipped files in
#    (unzip NexusCRM_v0.0.0.0.8.zip somewhere first)
rm -rf * .* 2>/dev/null        # keeps .git
cp -r /path/to/unzipped/* .

# 3. commit and push
git add -A
git commit -m "v0.0.0.0.8 — 50 3D scenes, command palette, AI hardening"
git push origin main
```

On Windows, do the same steps in Git Bash or GitHub Desktop
("Add existing repository" → drag the new files in → Commit → Push).

---

## After uploading — verify you have the new version

- Open `NexusCRM_V4_Hardened.html` (locally: double-click `Start-NexusCRM.bat`)
- The sidebar bottom must say **v0.0.0.0.8**
- New sidebar item **✨ 3D Scene Gallery** must exist
- Press **Ctrl+K** — the command palette must open
- If any of those are missing, you are looking at an old copy.

## Running it locally

```
node server.js        (or double-click Start-NexusCRM.bat)
```
Then open http://127.0.0.1:8080 — the local AI relay removes the CORS wall
automatically (Settings → AI Providers will show the green relay badge when
the server is running).

## Notes

- `node_modules/` is NOT in the zip (too big / not needed to upload).
  If you want to run tests locally: `cd nexuscrm && npm install && npm test`
  (18 suites, ~100 seconds, all green).
- Never upload files containing real API keys (`.env`, `.dev.vars`).
  Keys live only in your browser localStorage or encrypted on your deployed
  backend — never in the repo.
- If you tested AI with a real NVIDIA key during this handover, rotate it at
  build.nvidia.com afterwards.

---

## ⚠️ SUPERSEDED — read these first for v0.0.1.0+
- **`HANDOVER-NEXT-SESSION.md`** — complete context for a new AI session
  (current state, truths, constraints, ship procedure, gotchas).
- **`CHANGES-v0.0.1.0.md`** — exact changed-file list + the two routes
  (git push OR manual web upload) to apply v0.0.1.0 "Aurora" (plus
  v0.0.0.0.9/.10) to branch `THE-NEW-VERSION-OF-IT`.

**UPDATE 2026-08-31:** GitHub verified — main only has the old PR #1
snapshot and `THE-NEW-VERSION-OF-IT` never existed; nothing since
v0.0.0.0.6 was ever pushed. Use the ready-made
`GITHUB-UPLOAD-PACK-v0.0.1.0.zip` (drag-and-drop, steps inside) or a
new Arena session with working GitHub auth (Route A in
`CHANGES-v0.0.1.0.md`).
