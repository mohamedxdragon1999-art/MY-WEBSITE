# OpenCRM Setup

## One-time setup
```powershell
.\setup.ps1
```

Or do it yourself.

## Run it at any time
```powershell
.\START.bat     # (starts API and Web)
```

Both must be running. If they stop (browser closes windows), re-run `.\START.bat`.

## What works
- Multi-tenant: agencies → sub-accounts → contacts/funnels/pages
- Website builder: section presets (99+), 153 design systems, theme editing
- AI page generation (bring your own key) — works with any OpenAI-compatible endpoint (NVIDIA NIM, OpenAI.com, DeepSeek etc.) or goes offline to the local fallback if the key is unclear
- Save/publish → public URL preview under `http://localhost:4000/api/funnels/public-page/<pageId>`

Note: for live NVIDIA pages, the API key needs actual model access. The app's fallback mechanism ensures the developer never sees a broken UI.