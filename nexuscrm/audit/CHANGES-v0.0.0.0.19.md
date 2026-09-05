# CHANGES — v0.0.0.0.19 "UNDERSTAND → WRITE → DESIGN"

Scope: the website builder, its design systems and its intelligence, measured against
prompt-to-website leaders (Google AI Studio Build mode, Wix Harmony, Framer Wireframer,
Squarespace Blueprint, Durable, Relume, v0, Lovable, Google Stitch). English brief
understanding is the first-class input. Everything below was reproduced before it was
fixed and is pinned by a test that fails on the old behaviour.

Read with `audit/AUDIT-2026-09-03.md` (findings), `audit/PLAN-v0.0.0.0.19.md` (plan) and
`audit/repro/*.mjs` (reproductions).

---

## 1. What the leaders do that we did not (gap benchmark → closed)

| Axis (from the research) | Before | Now |
|---|---|---|
| **Brief understanding** — Wix's four decisions (Scope / Audience / Function / Visual) extracted from the prompt, with follow-up questions | Keyword industry match, everything else invented from a fixed template | `nx_brief.js`: 52-industry taxonomy with archetypes, services/people/founded/years/hours/prices/proof/differentiators/audience/location/contact/CTA-intent/personality/language extraction, `missing[]` → owner questions, `_summary` (owner) and `_facts` (visitor-safe) |
| **Structure first** (Relume sitemap → wireframe → style) | One fixed section order for every business | Per-archetype sitemap + section labels, wordless sections hidden, empty cards pruned |
| **Fact-only copy in a chosen voice** (Squarespace tone, Durable's "we summarise what we understood") | 65 % of sentences identical across businesses; 6/6 fabricated facts (reviews, stats, credentials, hours) | `nx_copywriter.js`: personality voices, slot budgets, headline/sub/CTA/why/about/FAQ/process written from brief facts only; sentence overlap 9 %, fabricated 0; suggestions flagged in `warnings[]` |
| **Real brand tokens** (Stitch theme tokenizer, Lovable design-system consistency) | Palette/fonts fixed | `nxTokensFor` palettes ≥ 7:1 / ≥ 4.5:1 contrast, font pairs per personality, `--radius`, art per industry |
| **No PII / template residue** | Reference client's name, phone, postcode, drainage copy shipped on every site | `nx_identity.js` scrub at source + `nxIdentityLeaks(html) === 0` pinned |
| **Design QA** (~160 visual issues per AI page in the wild) | none on the template path | Shipping gate + build report (`quality{score,issues}`, `coverage`, `assumptions`, `questions`, `warnings`) |
| **Honest assistant on the generated site** | see §2 | see §2 |

## 2. The generated site's assistant (this unit)

**Reproduced (jsdom, real served page):**
- Under `mode:'custom'` the chat brain depended on 20+ functions that were **not in the
  bundle** (`smallTalk`, `obMathAnswer`, `SENTINEL_KB`, `offlineUltimateAnswer`, …).
  Most questions fell through to a bare "How can I help?" with a random "Sure — " opener.
- Default provider was `webllm`; the header advertised "Qwen … loads on first message";
  browsers without WebGPU **auto-downloaded a ~400 MB GGUF from Hugging Face** on the
  first message without the owner opting in.
- Config text defects: greeting "We're a plumbing in Stafford", chip "Visit us?",
  knowledge carried builder meta ("Feel: precise. Primary action: visit"), hero sub
  "has spent 17 years on fixed properly, first time", why card "Established 2009 and
  still clear.", plumbers got a "Visit us / Opening hours" hero CTA because "Open
  Mon-Fri" matched the `visit` intent.
- The dev panel shipped label-less (identity patch blanked every blade default) and the
  lead card shipped with an empty `<h3>` and button.

**Fixed:**
- New built-in brain (`NX_SCRIPT`, byte-identical in `backend/src/index.js`,
  `nx_template.js`, `NexusCRM_V4_Hardened.html`): normalise → tag (price/hours/where/
  speed/trust/contact/about/services/payment/policy) → owner FAQ/Q&A (stemmed word
  overlap + tag agreement) → emergency/problem → concrete contact facts → topic rules →
  per-service cards (`serviceList`) → proof facts (`facts`) → owner notes → **honest
  fallback** ("I don't have that written down, so I won't guess" + how to reach the
  owner). Coverage questions parse the place and answer "can't confirm" unless it is in
  `coverage/city/base`. Arithmetic/percentages via a recursive-descent evaluator (no
  `Function`/`eval`). Elliptical follow-ups ("how much?") resolve against the previous
  topic; long questions are never treated as follow-ups. Chips never repeat a question
  already asked and never restate the current topic.
- Provider defaults: `offline` (built-in) is a first-class preset; header reads
  "● Instant answers · on this page"; CPU GGUF fallback requires
  `AICFG.allowCpuDownload === true`; Test connection self-tests the brain; key/endpoint/
  model rows hide for the built-in engine.
- Runtime config now carries `serviceList[{t,d}]` and `facts[{t,d}]` (from the plan's
  services/why/stats) and a visitor-safe `knowledge` (`nxBriefFacts`, no builder meta).
- Dev panel: 50 neutral labels restored; "Built-in assistant · instant · no key" preset
  button first. Lead card ships only when a lead can be delivered (webhook or e-mail),
  with the copywriter's voice-aware heading/text.
- Copywriter: hero sub / why-card grammar; playbook FAQ answers are filtered by evidence
  (no "Call us" without a phone, no "how fast" without an emergency claim, no "Yes — …"
  without a matching brief fact) and flagged `source:'suggested'` + warning.
- Brief: `visit` CTA intent gated to walk-in archetypes; `nxBriefFacts()` exported.
- Template route: chips are questions ("How do I get a quote?"), never `<button label>?`.

**Tests:** `tests/test_template_assistant.mjs` (52 checks, executes the served page:
honest defaults, no downloads, fact answers, no guessing, sentence quality, arithmetic,
follow-ups, sparse-brief degradation). Fuzzed with hostile config values (prototype keys,
markup, 20 kB strings, `2**9999`, `1/0`) — no throw, no pollution, < 1 ms per reply.

## 3. Test status

`node tests/run_all.mjs` → **78 suites green, 100 % route coverage** (≈ 250 s).
Suites touched: `test_template_identity` 35/35, `test_template_prod` 25/25,
`test_template_design` 21/21, `test_safe_html` 76/0, `test_backend` 344/0,
`test_user_journey` 31/31, `test_module_architecture` 26/26, `test_render_v2` 242/0,
`test_content_intelligence` 23/23, `test_blueprint` 32/32, `test_aurora` 44/0,
`test_template_assistant` 52/52 (new).

## 4. Files

`backend/src/index.js` (template IIFE: NX_SCRIPT, blades, mapper; `nxTemplatePlanFromBlueprint`;
template route), `nx_template.js`, `NexusCRM_V4_Hardened.html` (inlined lib + version),
`backend/src/nx_brief.js`, `backend/src/nx_copywriter.js`, `backend/src/nx_site_builder.js`,
`backend/src/nx_identity.js` + root `nx_identity.js`, `backend/src/nx_safe_html.js`,
`backend/src/nx_site_output.js`, `tests/test_template_assistant.mjs`, `tests/test_safe_html.mjs`,
`tests/run_all.mjs`, `tests/test_aurora.mjs`, `tests/test_template_*.mjs`, `tests/test_backend.mjs`,
`tests/test_blueprint.mjs`.

Version: `v0.0.0.0.19` (`APP_VERSION`, sidebar).

## 5. Known limits (honest)

- The built-in assistant is rule-based on purpose: it answers only from written facts.
  It does not paraphrase long knowledge notes and it does not speak languages other than
  the one the notes are written in (matching works on the note text itself).
- Real-browser (Chromium) rendering checks remain unavailable in this sandbox
  (`playwright install` fails offline); all runtime verification is jsdom.
- Remaining audit items not in this unit: S2 IDOR on snapshots, N7 forced publish,
  B12 unscoped tenant SQL at `site_versions`/`site_meta`/automation, empty-catch sweep.

## 6. Post-release units on v0.0.0.0.19 (same version string; see `CHANGELOG.md` top entries)

- **Security + NIM unit** (`AI_HARDENING.md` Batch 9): S2 IDOR, N7 forced publish,
  B12 unscoped tenant SQL, SSRF (DNS rebinding + metadata ranges), stored-XSS chain,
  F17 stream stall, B7 build-report race, B9 canned webchat reply, silent-catch
  elimination, strict brief schema, `providers/nim.js` + `providers/errors.js`
  ("any NIM model works"), `NVIDIA_NIM.md`. The audit items listed as "remaining" in
  §5 above are CLOSED by this unit (proof: `audit/repro/*` re-run green).
- **Reliability + builder pass** (`AI_HARDENING.md` Batch 10): model-output verdict +
  one repair round, stream idle watchdogs, per-provider deadlines, option clamps,
  breaker semantics on HTTP-200 garbage, FastAPI `detail[]`, bounded caches, cron GC;
  builder part 5 — `site/widgets.js` (estimator / quote funnel / filter chips / mobile
  action bar), WCAG AA across all palettes + themes, skip link + `<main id="main">`
  + `:focus-visible`, honest proof heading, brief-intelligence fixes (thousands
  separators, priced services, colon lists, WhatsApp attribution, named pricing
  tiers), prompt budget trimming. Tests: `test_site_widgets.mjs` (83),
  `test_model_output.mjs` (84).
