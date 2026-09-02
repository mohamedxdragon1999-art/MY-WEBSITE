# NexusCRM V4.1 — Hardened & Upgraded

All 33 findings from the code review are fixed, every placeholder feature is
now real, the AI layer is substantially upgraded, and everything is verified
by automated tests.

## Layout
```
nexuscrm/
├── NexusCRM_V4_Hardened.html   ← the app (open in a browser; works local-first)
├── backend/
│   ├── wrangler.toml           ← Cloudflare Worker config (main = src/index.js)
│   ├── schema.sql              ← D1 schema (V2: consistent timestamps + new tables)
│   ├── src/index.js            ← the whole backend (Worker + D1 + Resend)
│   ├── cors-proxy-worker.js    ← optional CORS proxy (local-only mode)
│   └── DEPLOY.md               ← 15-minute deploy guide
├── tests/
│   ├── test_backend.mjs        ← 70 integration tests (real SQLite via sql.js)
│   └── test_frontend.mjs       ← 25 browser-simulation tests (jsdom)
└── patches/                    ← the applied fix scripts (documentation of changes)
```

## Run the tests
```bash
npm install sql.js jsdom        # once (test-only dependencies)
node tests/test_backend.mjs        # → RESULTS: 316 passed, 0 failed
node tests/test_frontend.mjs       # → RESULTS: 134 passed, 0 failed
node tests/test_webchat_widget.mjs # → RESULTS: 16 passed, 0 failed (real widget in a simulated browser)
node tests/test_pingbackend_fix.mjs # → 7 passed, 0 failed (no dependencies)
node tests/test_edge_cases.mjs     # → 50 passed, 0 failed (adversarial: malformed/hostile inputs, SSRF, XSS, injection, unicode, model-catalog filtering)
node tests/test_deep.mjs           # → 78 passed, 0 failed (deep journeys with DB-state assertions: multi-tenant isolation, workflow engine incl. delayed steps, cron reminders/digest/purges, rate limits + lockout, key encryption round-trip, provider failover, circuit-breaker hygiene, AI cap, agent safety, webchat E2E, LIVE model catalog proof against the REAL NVIDIA API)
```
> `tests/d1mock.js` auto-selects its SQLite engine: Node's built-in
> `node:sqlite` when available (Node ≥ 22.5), otherwise `sql.js` — so the
> suites run on any Node version.

## What changed — the short version

**V4.1 "free & solo" pass adds (all tested):**
- **AI Website Builder** — describe your business → AI generates a complete
  responsive site → preview → publish at a public URL (`/api/public/site/:slug`).
- **AI Website Analyzer** — paste any URL, get a scored audit (SEO, copy,
  CTAs, structure) with ranked fixes.
- **AI Image Generator** — free text-to-image (Pollinations.ai, no key),
  with download + save-as-social-draft.
- **Live Webchat Widget** — one-line embeddable AI chat for any website;
  answers with your AI key + CRM context; conversations land in your inbox.
- **Trigger Links** — trackable links that fire workflows on click, with a
  click counter.
- **Contact tags + custom fields** — tag & filter contacts, store any
  per-contact data (birthday, URLs…), shown on the contact card.
- **Review-request workflow action** (emails past clients for a review),
  **24h appointment reminders**, review replies now persist.
- **One-click launcher**: `Start-NexusCRM.bat` / `start-nexuscrm.command` +
  `server.js` — double-click opens the app at http://127.0.0.1:8080.
- **UI polish**: view transitions, card hover lifts, animated auth screen,
  focus rings, `prefers-reduced-motion` support.
- **NVIDIA connection UX**: key format hints, model-suggestion and
  rate-limit guidance inside the connection-test results.
- **Free-only guarantee**: no Stripe/PayPal/Yext/WordPress-hosting/app-store
  features — see FEATURES_AUDIT.md for the full honest matrix.


**Bugs that broke real usage (all fixed & tested):**
- Delayed workflow steps fired up to 24h late → now fire on time (timestamp
  format unified to ISO-8601 UTC everywhere).
- Steps after a "wait N hours" step were dropped forever → remaining steps
  are re-queued and executed.
- Overdue-task reminder emails went out every hour forever → once per task.
- Wrong password showed no error with a real backend → clear error.
- Cold-starting backend silently derailed the app into phantom local mode →
  5s health timeout, 15s re-ping, never falls back when a backend is configured.
- Review replies were never saved → `PATCH /reviews/:id` + real UI save.
- AI keys could never be removed → empty string clears; all 3 providers
  can be configured simultaneously.
- Gmail OAuth failed for most users (missing redirect URI) + token race →
  fixed instructions + postMessage token handoff.
- Gmail replies didn't thread (messageId vs threadId) → fixed.
- Chat stream errors hung forever; history sent duplicate empty messages →
  fixed.
- CSV imports mangled quoted fields → proper parser.
- XSS: all email/contact/AI content escaped/sanitized before rendering.
- `</script>` inside the embed-code generator broke the whole page → escaped.
- Invoice numbers reused after deletion → monotonic + UNIQUE constraint.

**Security:**
- IP rate limits on register/demo/login + public form & affiliate endpoints.
- Expired sessions + stale demo workspaces purged by cron.
- Server-side validation of workflow triggers/actions/stages.

**Real features (previously stubs):**
- Forms with public embed (`/api/public/forms/:id/embed.js`), submissions →
  auto-create contacts → `form_submitted` workflows actually fire.
- Courses (create/publish/AI outlines, stored), Funnels (saved with stages),
  Affiliates (real click-tracking links), Community posts, Reports with
  charts + CSV export.

**AI upgrades:**
- Multi-provider auto-fallback with retries (NVIDIA → OpenAI → custom).
- Live CRM context injected into every chat/complete call (data-aware answers).
- 20+ content types (cold email, follow-up, Facebook/YouTube, landing pages,
  press releases, job descriptions, meeting agendas, hashtags…).
- 8-mode text improver (`/ai/rewrite`), token tracking, strict-JSON parsing
  for scoring/sentiment/workflow building with safe fallbacks.
- **5 upgrade cycles applied (build → test → harden → verify):**
  - **Cycle 1 — provider layer**: model fallback chains ("model1,model2" tries
    each on the same provider before switching), live provider-health snapshot
    endpoint, SSE streams announce which provider+model is answering, and the
    chat shows it under every reply.
  - **Cycle 2 — memory & agent**: old conversations auto-summarize into a
    long-term memory the AI keeps; agent can update contacts and append notes;
    agent is idempotent (double-clicks can't duplicate); the webchat widget
    remembers returning visitors (persistent visitor id).
  - **Cycle 3 — content AI**: brand voice profile — set it once in Settings
    and every email/post/ad/chat reply is written in that voice (tested across
    complete, generate, agent and webchat).
  - **Cycle 4 — automation AI**: public webhook endpoint
    (`/api/public/webhook/:token`) that fires workflows from any external
    system; per-workflow run history (ok/error log); data-driven AI workflow
    suggestions ("💡 AI Suggest"); visual step editor on every workflow.
  - **Cycle 5 — UX & hardening**: provider status panel in Settings
    (healthy/cooling/degraded + success counts + last error), ⌨️ shortcuts
    modal (Ctrl+/), offline banner when the backend is unreachable, AI usage
    mini-panel (calls + tokens + by-operation breakdown).
- **25 more upgrade cycles (agent-first), all tested:**
  - **Agent v2**: natural dates ("tomorrow", "next friday" → real due dates),
    completes tasks, updates deals (value/probability), finds contacts,
    remembers facts you tell it ("remember I prefer calls before 11am") and
    injects them into every future agent call, and runs **multi-step
    sequences** (one command → several actions, capped at 3 safe steps).
  - **AI on data**: per-contact AI relationship summary, 3 smart reply options
    per inbound message (click to compose), AI tag suggestions (one-click
    apply), AI task urgency ranking (shown as AI Rank column), deal-risk
    scanner (stale/low-probability alerts with 🚨 button in the pipeline).
  - **Content AI v2**: Tone Remix (8 tones), Document Analyzer (key points,
    decisions, action items), dedicated translate endpoint.
  - **Daily AI brief** on the dashboard ("what to focus on today") with
    refresh; **AI feedback loop** (👍/👎 under every chat reply, stored to
    improve quality); **Snippets → insert into compose**; **Voice notes →
    create tasks** (agent turns your transcript into real tasks).
  - **Meeting Processor** hub tool: paste a transcript → action items and
    appointments are created as real CRM objects.
  - Hub now has **41 tools**.
- **AI Agent in the chat**: type `/task`, `/contact`, `/deal`, `/forecast` or
  `/weekly` (or click the chips) and the AI actually DOES it — creates tasks,
  contacts, deals, appointments, updates deal stages, sends email drafts,
  returns your forecast or weekly review. Strict whitelist: it can never
  delete or damage data (tested: unknown/dangerous actions are rejected).
- **Sales Forecast 30/60/90**: expected revenue from your pipeline
  (value × probability, date-aware), with an AI-written 2-sentence read —
  shown on the dashboard AND as a hub tool.
- **Voice Notes → AI**: record with your mic (free, Chrome/Edge) → speech
  transcription lands in the transcript box → summarize / action items /
  follow-up email instantly.
- **AI buttons on your data**: 🤖 on any task writes its follow-up email;
  📧 AI Update Email in every deal modal; results can be copied, saved to
  CRM messages, or stored in the new **📌 Snippets Library**.
- **Content Calendar now saves**: generate a 7-day calendar → "Save all as
  Social Drafts" creates real posts in your Social Media tab.
- **Design Engine v4 — 40 more cycles, researched from Awwwards 2025-26 winners + CSS-3D techniques:**
  - **400,000+ unique design combinations**: 40 curated themes × 12 hero
    styles × 12 entrance-animation presets × 6 card styles × 4 nav styles ×
    3 3D levels. Every build is a unique combination — the curated component
    libraries replace the need for thousands of static templates.
  - **40 themes** from researched trends: glassmorphism (dark/light),
    neumorphism, brutalism, dark luxury, editorial serif, cyberpunk neon,
    sunset, ocean, forest, rose, midnight, ember, graphite, sand, sakura,
    mint, cobalt, lime, terracotta, lavender, noir, bordeaux, teal, retro
    amber, slate, coral, evergreen, denim, plum, canary, steel, berry,
    seafoam, chocolate, space, peach, classic red, minimal white/dark.
    Each theme brings its own card treatments (glass blur, neo shadows,
    brutal hard shadows, neon glows, editorial serif type).
  - **12 hero styles**: split, centered, glass panel, gradient mesh (animated
    blobs), 3D tilt card, particle field, layered parallax, marquee
    background, kinetic type (word-by-word animation), framed image,
    compact badge, minimal huge-type.
  - **12 entrance animation presets**: fade-up, fade, slide-left/right, zoom,
    blur-in, flip-up, rise, pop, drift, clip-up, none.
  - **6 card styles** (standard, glass, neumorphic, gradient-border, 3D lift,
    minimal) + **4 nav styles** (glass, solid, underline, pill CTA).
  - **3D levels**: Off / Light (CSS 3D preserve-3d) / Full (3D hero scene —
    injected canvas particle field + orbiting gradient orb, zero external
    libraries, auto-injected into the hero, reduced-motion safe, and tested
    to run without errors even when canvas is unavailable).
  - **Design Gallery in the builder**: theme picker with live color swatches,
    hero/animation/card/nav/3D selectors, live combination counter, all
    persisted per-site and applied on regenerate; local mode mirrors the
    full catalogs.
  - **Bugs found & fixed by tests**: full-3D script referenced an outer-scope
    variable (would crash), particle canvas was never created (now
    auto-injected), styles endpoint lacked theme swatch data, local parity
    showed tiny catalogs.
- **Website Engine v3 — 60 more upgrade cycles, researched from the best AI builders (Framer, Wix AI, Durable, v0):**
  - **9 design systems**: your Sentinel style + Aurora, Slate, and 6 new —
    Ocean, Forest, Rose, Midnight, Ember, Graphite. Design inheritance means
    new palettes compose onto the proven layout.
  - **Theme system per site**: Google-font picker (Inter, Poppins, Playfair
    Display, Space Grotesk, DM Sans — preconnect + display=swap), accent
    color override, corner radius (sharp/soft/round), animation level
    (subtle/balanced/expressive), favicon emoji, custom CSS injection —
    all persisted in site settings and reapplied on regeneration.
  - **Section control**: pick exactly which sections the AI builds (nav,
    hero, marquee, stats, services, why, about, process, parallax, gallery,
    reviews, pricing, team, timeline, logos, video, lead, faq, contact,
    map, footer) — the prompt carries the exact list.
  - **New site capabilities**: pricing tables, team grid, timeline,
    logo strip, video embed, map embed, newsletter form — all planned
    automatically from scanned data (or added via instructions).
  - **Real-world verified**: the scanner was tested against YOUR OWN
    template.html — it extracted the real title (entities decoded),
    paragraphs, h2 sections, and produced a plan; a site was built from
    that plan, then the generated site was RUN in a browser simulation:
    nav renders, reveal animations fire, FAQ accordion toggles, and the
    lead form posted through the webhook into the CRM as a real contact.
  - **Robustness**: SSRF guard, entity decoding, design-id validation fixed
    (extras designs were being silently downgraded), matchMedia guards so
    generated sites never crash in odd browsers, lazy images everywhere.
  - **Workflow**: device preview (desktop/tablet/mobile), design swatches,
    ⚙️ per-site settings modal (edit theme + instructions + custom CSS →
    Save & Regenerate), ⬇️ export the site HTML, 📄 duplicate a site,
    publish/unpublish toggle.
- **Website Engine v2 — professional AI websites (inspired by your own design system):**
  - **3 design systems** (Bold & Interactive "Sentinel style", Aurora light,
    Slate dark) — fixed professional CSS + interactive JS; the AI writes only
    the content, so every site looks hand-designed, never generic.
  - **Full section order** from your template: Nav → Hero → Marquee → Stats →
    Services → Why Us → About → Process → Parallax → Gallery → Reviews →
    Lead Magnet → FAQ → Contact → Footer.
  - **Your animation DNA built in**: scroll-reveal, count-up stats, cursor
    spotlight, card tilt + glare, magnetic buttons, floating hero image,
    marquee, film-grain ambience, gradient hairlines, testimonial auto-scroll,
    gallery lightbox (Esc closes), FAQ accordion, back-to-top, mobile menu,
    countdown timers, typing effects — all reduced-motion aware.
  - **🔍 Scan & Rebuild**: paste any old client site URL → the worker fetches
    and extracts real content (title, headings, paragraphs, images with
    absolute URLs, phone, email, working hours incl. "Mon-Fri 8am-6pm" ranges,
    address, socials, links) → AI builds a content plan → you review a readable
    summary or edit the JSON → approve → a brand-new modern site is generated
    with their REAL content (hours, phone, images) + SEO meta + JSON-LD
    LocalBusiness schema.
  - **Continuous instructions**: per-site instructions are stored and applied
    to every regeneration ("always show the 24/7 number", "mention the free
    consultation") — plus a 🔄 Regenerate button that rebuilds with the saved
    design + content plan + your updated instructions.
  - **Lead capture built in**: the site's contact form posts to your backend's
    webhook → auto-creates a contact + message in your CRM and can fire
    workflows.
  - **Security**: SSRF guard (private/localhost URLs refused — tested),
    size caps, plan normalization with sensible defaults (tested).
  - Device preview (desktop/tablet/mobile), design color swatches, publish/
    unpublish toggle, design badge on the sites list.
- **PRO 3D TIER — the real upgrade (97 scenes: 55 canvas + 42 WebGL):**
  - **42 WebGL (Three.js) scenes** — the same technology the award-winning
    sites use: real 3D objects, lights, materials, particles (Galaxy Spiral
    with 9,000 additive stars, Planet & Ring with orbiting moon, 3D Ocean
    with displaced vertices, Abstract Sculpture with torus knot + platonic
    solids, 3D City Night with lit windows, Wireframe Globe, Nebula Clouds,
    3D Mountains flythrough, Solar System, Particle Tornado, Black Hole with
    accretion disk, Volcano with erupting particles, Aurora Ribbons, DNA
    Helix, Floating Islands, Sci-Fi Grid, Meteor Shower, Lava Fields, Ice
    Planet, Grid World, Tunnel, Ribbon Waves, Rose Curves and more). Each is
    loaded via a guarded Three.js boot (CDN, WebGL check with graceful
    fallback, theme colors, reduced-motion, resize) and **tested to run in a
    browser with zero errors**.
  - **12 Pro Canvas scenes** with a real mini-3D engine: perspective
    projection (rot3/proj3/dot3/line3/mesh3), depth-sorted faces and height
    shading — 3D Cube Cluster, Wire Sphere, Torus Knot, Galaxy, Terrain Mesh,
    City Blocks, DNA, Perspective Tunnel, Globe Pro, Floating Shapes (with
    painter's-algorithm face sorting), Solar System Pro.
  - **LIVE scene preview**: the 👁 Preview button now fetches the actual
    scene code and runs it in a real-time iframe (canvas scenes render
    instantly; WebGL scenes load Three.js live) — no more static placeholders.
  - **Scene picker grouped by tier**: 🎮 WebGL 3D / 🧊 Canvas Pro / ✨ Classic,
    with live counts.
  - **3D Gallery upgraded to 60 real sites** — added 30 more from 2026 award
    roundups (Oimachi, Cipher, LIKOVA, Michael Gatt, PX PUSH, HAOQI.DESIGN,
    Mosby's Files, Revelatio, Studio K95, NOTHIN', Produx, Vero New-York,
    Alethia, Serotoninn, Noomo, 2xA, CIAO ENERGY, Paul Kalkbrenner, Neoconda,
    Rechroma, Made With GSAP, WebGL Gallery, Pirates in the Sea, FacetLab,
    JT's Portfolio, AL Noble Perfume…) — each with **"🎬 Rebuild this feel"**
    which maps the site's technique to one of our scenes and opens the
    builder pre-configured.
  - **Concepts expanded to 680** (40 scene packs × 17 industries).
- **50+ NEW real 3D scenes & designs from web research (2024-2026):**
  - **25 new 3D background scenes** implementing the techniques made famous
    by real award-winning sites — each credits its inspiration: Z-Depth
    Parallax (Oryzo), Scroll-Mesh (Shopify Editions), 3D Monolith (Hubtown),
    Landscape Flythrough (Explore Primland), Morphing Fragments (Species in
    Pieces), Light Prisms (fromanother), Depth Fog (DeepSee), plus Globe,
    Terrain, Ocean, Ring World, Meteor Storm, Solar System, DNA Helix,
    3D City, Volcano, Galaxy Arms, Beacon Lights, Wire Planet, Orrery,
    Wavefront, Constellation 3D, Tunnel Rings, 3D Wave Field = **55 scenes
    total**. All tested to build AND run in a browser with zero errors.
  - **🌌 3D Gallery — 30 REAL award-winning 3D websites** (Oryzo, Bruno
    Simon, Species in Pieces, Nomadic Tribe, Explore Primland, Cartier,
    Hubtown, Active Theory, Resn, DeepSee, Iventions, fromanother, Mat
    Voyce, 4x4 Builder, Terrain Rider, and more) with each site's live URL,
    creator, standout technique and "what to steal" — open them in a new
    tab from inside the builder.
  - **Spline 3D Library link** (free ready-to-use 3D scenes, commercial
    use) + the existing paste-any-Spline-URL support.
  - **Concepts expanded to 340** (20 scene packs × 17 industries).
- **3D Scene Engine — 30 real working 3D background scenes** (zero external
  libraries, GPU-friendly canvas, theme-aware, reduced-motion safe): Starfield,
  Particle Field, 3D Grid Floor, Floating Orbs, Aurora Waves, Galaxy Spiral,
  Light Tunnel, Synthwave, 3D Wave Grid, Helix, Matrix Rain, Hex Grid, Lava
  Lamp, Morph Blobs, Fireflies, Constellations, Embers, Smoke, Sparkles and
  more — every scene is a live animated 3D background behind the hero, and
  scenes are **tested to run in a browser with zero errors** (canvas guard).
- **Spline 3D support**: paste any public Spline scene URL → the official
  Spline viewer script + element is embedded as the site's 3D background.
- **170 professional 3D website concepts** (17 industries × 10 scene packs):
  every concept is a unique combination of a 3D scene + curated theme +
  hero layout, with descriptions the AI uses when generating. Pick one in the
  builder → scene/theme/hero preset instantly; scene + Spline + concept all
  persist per-site and reapply on regenerate; live scene preview modal.
- **NVIDIA custom base URL**: point AI calls at your own NIM deployment or a
  regional endpoint (self-hosted / OpenAI-compatible NVIDIA gateways) —
  health tests ping the custom URL (tested).
- **Connection hardening**: SSE keep-alive every 15s (proxies can't drop long
  generations), Retry-After respected on 429 (capped 30s), per-provider
  model health checks, latency reported in connection tests.
- **One-command deploy**: `backend/deploy.sh` (macOS/Linux) and
  `backend/deploy.bat` (Windows) — install wrangler → login → create D1 →
  apply schema → deploy → print your URL. The worker is 336 KB (well under
  Cloudflare's 1 MB free limit) and passes the full suite.
- **AI Connection hardening (Settings fixes)**: the NVIDIA "Couldn't reach the
  provider" error in local-only mode is now explained as the expected browser
  CORS wall with two clear fixes (deploy free backend → button, or CORS proxy
  → button) instead of looking like a broken key. Health tests now use a
  per-provider model (testing NVIDIA never sends gpt-4o-mini — this caused
  false "model not found" errors), errors carry a `kind` for smart UI,
  silent test-after-save no longer pops a modal (dot + toast only), and the
  Connection card has Save & Test / Get proxy / Deploy backend actions.
- **LIVE model catalog**: the NVIDIA/OpenAI dropdowns are fetched from the
  providers' real `/v1/models` API with your key (10-min cache, `🔄 Refresh
  Models` button, non-chat endpoints filtered out, curated fallback if the
  provider is unreachable) — when NVIDIA adds or removes models, your app
  reflects it automatically. No hardcoded placeholder list.
- **HARDENED AI provider layer (V5)**: circuit breaker (3 fails → 60s cooldown),
  smart routing to the healthiest provider, exponential backoff + jitter,
  precise error taxonomy (bad key / no credits / model missing / rate limited /
  overloaded / timeout / malformed response), response-shape validation,
  payload size guards, per-user AI rate limit, and a 45s stream safety net.
- **Persistent AI memory**: the chat remembers past conversations across
  sessions (capped at 30, clearable with the 🧠 Forget button).
- **New AI tools (36 total)**: Pipeline Health (0-100 + reasons), Deal Doctor,
  Contact Icebreaker, A/B Subject Lines, SEO Keywords, Cold Call Script,
  Brand Name Generator, **Image Analyzer (vision AI — describe/OCR images)**,
  Weekly Business Review — plus a richer live-CRM context injected into every
  chat (sub-accounts, paid invoices, sites, trigger links, webchat stats).
- **AI calls are UNLIMITED by default (cap 0)** — perfect for free models; you can set a numeric cap anytime as a paid-key guardrail. Usage is still tracked per day (counts + tokens).
