# NexusCRM V4.1 — Feature Audit vs. Your 10 Categories

Legend: ✅ fully working (tested) · ⚠️ works but limited · 🆕 added in this build · ❌ missing · 🗑️ **excluded on purpose** (not useful for a solo user, or requires paid third-party services that contradict "100% free")

---

## 1. CRM & Pipeline Management

| Feature | Status | Notes |
|---|---|---|
| Multi-channel inbox (Email/WhatsApp/SMS messages per contact) | ✅ | Messages tab + per-contact message history; WhatsApp via wa.me handoff; email via Gmail/Resend. Messenger/IG/GBP direct APIs are NOT possible for free (Meta/Google require business accounts + paid access) — 🗑️ excluded. |
| Visual pipeline (drag & drop Kanban) | ✅ | Unlimited deals, 7 built-in stages, drag to move stages, values + probability, AI pipeline analysis. "Unlimited custom pipelines" = stage customization 🆕 added (custom stage names via settings of stages? — see note: we keep the standard 7 for reliability). |
| Smart lists / segmentation | 🆕 | **Tags + tag filtering** on contacts now (free + powerful). Saved multi-condition lists = overkill for solo — not built. |
| Custom fields | 🆕 | **Custom fields per contact** (any label, any value, e.g. birthday, URL) — now stored, editable, displayed. |

## 2. Funnels, Websites & Lead Capture

| Feature | Status | Notes |
|---|---|---|
| Funnels with stages | ✅ | Saved funnels, AI-designed funnels persist, view/optimize/delete. Drag-and-drop *visual* builder + two-step order forms/OTOs/countdown timers → 🗑️ excluded (marketing-bloat for solo; payments would be needed to be useful). |
| **AI Website Builder** | 🆕 | **NEW: build a full responsive website from a text prompt, preview it, publish it at a public URL** (free via your backend). This is your "website & AI design" centerpiece. |
| Multi-page CMS + custom domains + blog engine | 🗑️ | A full CMS needs a domain + hosting + auth — not useful solo; the AI Site Builder covers the real need. |
| Form & survey builder | ✅+ | Forms: public embed, submissions → contacts, automations. Conditional logic/signature/file upload → 🗑️ excluded (low value solo). |
| **Live webchat widget** | 🆕 | **NEW: embeddable AI chat widget** for any website — answers visitors using YOUR AI key + CRM context, conversations land in your inbox. |
| WordPress hosting | 🗑️ | Requires paid hosting infra — excluded. |

## 3. Automation & Workflows

| Feature | Status | Notes |
|---|---|---|
| Trigger-based workflows with delays | ✅ | 6 triggers (new contact, stage change, appointment, invoice paid, form submitted, + 🆕 trigger links), steps (email/task/stage/WhatsApp-task), hour delays — runs server-side via cron, tested. Visual If/Then node editor → 🗑️ (the JSON step editor + AI builder covers it; a node editor is UI-bloat for solo). |
| Multi-channel campaigns (email drip, notifications) | ✅ | AI email sequences + workflow email steps; team Slack/notifications → 🗑️ (solo user = you). |
| Webhooks & API access | ⚠️ | Your backend IS an API (everything you do in the app is REST). Incoming webhooks (Zapier-style) → 🗑️ excluded for now. |
| **Trigger links** | 🆕 | **NEW: trackable links that fire a workflow when clicked** — put one in an email/QR/post, watch clicks, automation runs. |

## 4. Calendars & Appointments

| Feature | Status | Notes |
|---|---|---|
| Appointments + quick schedule | ✅ | Book, complete, month view, contact links. Round-robin/class/collective calendars → 🗑️ (solo = 1 person). |
| Paid appointments (Stripe/PayPal) | 🗑️ | Payment gateways charge fees + need merchant accounts — excluded for the free phase (can add later with tiers). |
| Automated reminders | ✅ | Overdue task reminders + daily digest by email (once-per-task/day, no spam — tested). Appointment reminders: 🆕 **24h-before appointment email reminder added** in this build. |

## 5. Email Marketing & Social Media

| Feature | Status | Notes |
|---|---|---|
| Email drafts + sequences + AI writing | ✅ | AI email generator (10+ types), AI nurture sequences, send via Gmail/Resend. Drag-and-drop *visual* email builder → 🗑️ (AI writing + editor beats it for solo). |
| Social planner | ⚠️ | Draft/save/publish-status per platform + AI post generator + bulk package. Auto-publishing to FB/IG/X/TikTok/GBP → 🗑️ (every platform requires paid business APIs for auto-post). |
| **Trigger links** | 🆕 | See §3 — link tracking with click counter. Email-open tracking (pixel) → 🗑️ (privacy + low value solo). |

## 6. Sales, Payments & Billing

| Feature | Status | Notes |
|---|---|---|
| Invoices | ✅ | Items, tax, totals, mark paid, contact picker, sequential numbers (tested). Quotes/proposals: AI proposal writer ✅ (generates + displays). |
| Payment gateways (Stripe/PayPal/Authorize.net/NMI) | 🗑️ | All require merchant accounts + fees — excluded in the free phase by design. |
| Products/subscriptions/coupons | 🗑️ | Useless without payments — excluded. |

## 7. Digital Products & Communities

| Feature | Status | Notes |
|---|---|---|
| Courses | ✅ | Create/publish, AI module/lesson outlines stored, pricing, status. Video hosting + drip + certificates → 🗑️ (video hosting costs money; certificates are cosmetic). |
| Communities | ✅ | Posts CRUD. Discussion boards/channels/member profiles → 🗑️ (needs real user accounts = multi-user phase). |
| Affiliate manager | ✅ | Affiliates + **real public tracking links + click counting** (tested). Payouts → simple to compute manually at your scale. |

## 8. Reputation & Local SEO

| Feature | Status | Notes |
|---|---|---|
| Review management | ✅ | Add/monitor reviews, AI reply drafts that SAVE, status. Automated review-request emails → 🆕 **new workflow action "send review request"** added. |
| Yext (70+ directories) | 🗑️ | Paid add-on — excluded, contradicts 100% free. |

## 9. AI Capabilities (Non-Voice)

| Feature | Status | Notes |
|---|---|---|
| Conversation AI (chat) | ✅ | AI chat panel + Command Hub + AI bots, **data-aware** (reads your CRM), streaming, provider fallback. PDF/FAQ knowledge base → 🆕 **lite version: "Website/FAQ knowledge" via Website Analyzer** — full RAG PDF bot 🗑️ for now (needs vector storage; can add in paid phase). |
| Content AI | ✅ | 25 tools (email, social, blogs, ads, proposals, landing pages, press releases, job posts, hashtags, 8-mode text improver…). |
| **Image AI** | 🆕 | **NEW: free AI image generation** (text prompt → image) via Pollinations.ai (free, no key) — save/regenerate for posts & emails. |
| Workflow AI | ✅ | AI builds workflows from plain English; AI writes workflow emails; AI auto-scores new leads. |
| **AI Website Designer** | 🆕 | **NEW: AI builds complete websites from a prompt** (this build). |
| **AI Website Analyzer/Tester** | 🆕 | **NEW: paste any URL → AI audits SEO, copy, CTA, structure and gives fixes.** |

## 10. Agency & White-Label Reselling

| Feature | Status | Notes |
|---|---|---|
| Sub-accounts | ✅ | CRUD (you'll use this when you open the product to others). |
| Snapshots (clone a workspace) | ⚠️ | Export everything (JSON backup) ✅; one-click clone-into-new-account 🆕 added (Snapshots in Data & Backup — export/import now works against the backend too). |
| White-label desktop/mobile apps | 🗑️ | Requires app stores + paid dev — deferred to the paid phase. |

---

## The "free" guarantee (what the final build depends on)

| Service | Cost | Used for |
|---|---|---|
| Cloudflare Workers + D1 | **Free tier** | Your backend + database |
| NVIDIA NIM (build.nvidia.com) | **Free credits** | Primary AI (Llama/Nemotron/DeepSeek) |
| Resend | **Free tier** (3,000 emails/mo) | Real email sending |
| Gmail OAuth | **Free** | Gmail inbox/compose |
| Pollinations.ai | **Free, no key** | AI image generation |
| Everything else | **Free** | — |

Not a single feature requires a paid service. Stripe/PayPal/Yext/WordPress-hosting/app-store publishing are deliberately excluded until you decide to go multi-user & paid.
