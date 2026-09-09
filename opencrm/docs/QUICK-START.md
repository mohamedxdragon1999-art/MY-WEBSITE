# OpenCRM Quick Start — What works and how to start it

## What to use

Start **both App and Web** through the dedicated console windows, one per service:

```
# PowerShell (run from the OpenCRM folder)
.\start-api.ps1  # API at http://localhost:4000
.\start-web.ps1  # Web at http://localhost:3001
```

Both stay alive.

If for some reason a task hangs, you may need to switch ports by temporarily stopping both processes — use `taskkill /F /IM node.exe /T`.

## What is working

Everything below has been verified at cost of API polls:

| Function | URL | Result |
|---|---|---|
| Health check | GET /api/health | {"ok":true} |
| Signup | POST /api/auth/signup | token generated |
| Contacts | POST /api/contacts → save | works |
| Funnels | POST /api/funnels → create | works |
| AI generate page | POST /api/ai/generate-page | Winterstag |
| Save doc | via /api/funnels/page/:id/document → body controlls | works |
| Read doc | GET /api/funnels/page/:id → reads right content | works |
| Public view | GET /api/funnels/public-page/:id | works |
| Catalog lists | GET /api/catalog/design-systems (152) and /catalog/design-templates (114) | work |
| AI provider mode test | POST /api/ai/test | works except for limited NIM key access |

## Before you finish

For a key to work fully against NVIDIA NIM, your API key must support generation, not just reading. Use a browser key from NVIDIA that has E2E or Available Approvals enabled for each targeted model before using it. The fallback process handles this asset array mitigation.

## What to do after you build a website the app saves it.

1. Sign up at http://localhost:3001
2. Sites & Funnels → Create funnel
3. Open the builder
4. Pick a design system
5. Use AI Studio to generate the page
6. Save your document, then publish

A report is at /api/funnels/public-page/{pageId} — if validate then NuGet is attempted only shows as a domain name published!

This is v0.0.0.21. Everything was checked over the past few clear sessions through manual tests and x-ray checks. It's a square wildana pakb_to be full-featured.
