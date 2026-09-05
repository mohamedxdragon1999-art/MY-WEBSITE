# NVIDIA NIM in NexusCRM — the operator's guide

NexusCRM talks to NVIDIA NIM (build.nvidia.com, or a self-hosted NIM
container) through its OpenAI-compatible `chat/completions` API. Every model
in the catalog is different, so the worker carries a **NIM adapter**
(`backend/src/providers/nim.js`) whose job is one sentence long:

> *Any chat model NVIDIA lists must work when you pick it — without you
> knowing its quirks.*

This document is what the adapter does, how to prove it, and what to do when
a model still does not answer.

---

## 1. Setup in 90 seconds

1. **Get a key** — build.nvidia.com → *Get API Key*. Keys look like `nvapi-…`
   and come with free credits.
2. **Settings → AI Providers → NVIDIA NIM** → paste the key.
3. **Pick a model** from the dropdown (it is the *live* catalog filtered to
   chat-capable models, badged 🧠 reasoning · 👁 vision · 💻 code), **or**
   choose **✏️ Other model** and paste *anything*: the id
   (`deepseek-ai/deepseek-r1`), the model page link
   (`https://build.nvidia.com/qwen/qwen3-235b-a22b`), or a comma-separated
   **fallback chain** (`a/b, c/d` — the first model that answers wins).
4. Press **🔎 Check this model**. One real, budget-bounded call is made
   against exactly that id and you get a verdict (see §4). Then **Save**.

Self-hosted or regional NIM? Put its base URL in **NIM endpoint**
(`https://nim.yourcorp.example/v1`). The catalog and every call then go to
*that* endpoint — a self-hosted NIM that serves a single model is listed as
exactly that one model.

> **Where do calls travel?** Browser → your backend worker (or the local
> `Start-NexusCRM` relay) → NIM. Browsers cannot call NIM directly (CORS);
> the app tells you so instantly instead of timing out.

---

## 2. What the adapter does for every request

| Problem a model can have | What happens now |
|---|---|
| Pasted `build.nvidia.com/...` link, backticks, `models/` prefix, `3_1` slugs | Normalised to the id NIM accepts (`nimNormalizeModelId`) — on save, on check, and on every call |
| Reasoning model (DeepSeek-R1/V3.1, Qwen3/QwQ, Nemotron 3, gpt-oss, GLM-4.5+, Kimi K2…) spends the budget *thinking* | Budget floor of 1024 tokens; if the answer is still empty with `finish_reason: length`, **one automatic retry with 4× the budget** (remembered per model) |
| Thinking arrives as `reasoning_content` or inline `<think>…</think>` | Split from the answer in JSON **and** SSE (tags split across chunks handled). Dashboard chat shows a muted "🧠 thinking…" indicator; website visitors never see it; chat memory stores only the answer |
| `400: max_tokens must be ≤ 4096` / context-length arithmetic | Clamp learned and applied to all later calls for that model |
| `400: System role not supported` (some Gemma / Mistral builds) | System prompt folded into the first user turn |
| `400: Conversation roles must alternate` | Consecutive same-role turns merged |
| `400: response_format not supported` | JSON mode dropped; "answer with a single JSON object" added to the prompt instead |
| `400: use max_completion_tokens` / `temperature not supported` (o-series style) | Parameter renamed / dropped |
| `400: … is not a chat model` (embedding, reranker, reward …) | Reported as a **model** problem with the reason, never as provider sickness |
| Provider hiccup returns one model for the public catalog | Rejected as "too few" (curated list shown); a self-hosted endpoint legitimately serving 1 model is accepted |
| SSE frames that carry nothing for the client (role-only first chunk, thinking) | Consumed in a loop — the answer is never delayed until the 15 s keep-alive |
| Model JSON wrapped in ```` ```json ```` fences or prose | `nimExtractJson` finds the first balanced object/array; nothing parseable → the honest local fallback, never a fake `{}` |
| Website body wrapped in a fence, a whole `<html>` document, prose before/after, a `<think>` block, a stray `<body>` mid-page, or cut off by the token budget | `site/model_output.js` normalises it, detects truncation / refusal / missing sections, appends a forgotten footer, asks ONCE for a repair (`build-site-repair`), then renders deterministically — `build.model_output` tells you what happened |
| FastAPI/pydantic `422` with `detail: [{loc:[…,'max_tokens'], msg}]` (self-hosted NIM) | The field named in `loc` drives the same adaptation table as a plain 400 |
| Stream goes silent mid-answer (no bytes for 40 s) | `nxIdleReader` ends the client stream with an explicit `{error}` + `{done}` — the dashboard never hangs; the local relay (`server.js`) does the same at 60 s |
| A model answers `200` with an empty / unusable body | Treated as model behaviour: the breaker is NOT tripped for the provider; `malformed` is reported to the client |
| A provider hangs on every attempt | Per-provider deadline = 1.5× the per-attempt timeout — one timeout, not two, before the next provider in the chain |
| Client sends `timeoutMs: 0` / `max_tokens: 10^9` | `nxTimeoutMs` clamps 250 ms–180 s; `nxClientAiOpts` whitelists `max_tokens` 1–8192, `temperature` 0–2, `json_mode`, `include_context` |
| Dozens of dashboard tabs open `/ai/models` at once | One upstream fetch is shared by all concurrent callers; the cache is bounded (2,000 entries) |

Adaptations are learned **once per (provider, host, model)** from the
provider's own 400 body, applied first-time on later calls, and logged as
`ai.model.adapted`. They never trip the circuit breaker: a request-shape 400
is not a sick provider.

### What stays hidden from the model dropdown, and why

`nimIsChatModel` drops endpoints you cannot chat with using text prompts:
embeddings (`nv-embedqa`, `arctic-embed`, …), rerankers, guard/safety
classifiers, reward models, ASR/TTS/translation (`parakeet`, `magpie`,
`riva`), image/video/3D generation (`flux`, `sdxl`, `cosmos-predict`), bio/
chem/physics NIMs (`esm2`, `alphafold`, `fourcastnet`), OCR/parsers, and the
first-generation VLMs NVIDIA serves on `/v1/vlm/*` (`neva`, `vila`, `llava`,
`fuyu`, `kosmos-2`, `paligemma`). Modern vision-**chat** models
(`llama-3.2-*-vision`, `gemma-3`, `qwen2.5-vl`, `nemotron-nano-*-vl`,
`phi-3.5-vision`) **stay** — they answer text-only prompts.

If you believe a hidden model does chat, paste its id into *Other model* and
press Check: the verdict is the truth, the filter is only the default view.

---

## 3. Health probe semantics

`GET /ai/health` still sends the cheap "reply with the single word: ok" probe
(`max_tokens: 5`) to ordinary models. For a reasoning model the probe gets a
real thinking budget, and "thought but had no room to answer" still counts as
a live, authenticated model (`status: ok`, `reasoning: true`). Any adaptation
that was needed is returned in `adjustments`.

---

## 4. `POST /ai/models/check` — the verdict API

Body: `{ "model": "<id or link>", "provider": "nvidia" }` (provider optional).
Always HTTP 200 with a structured verdict (401 without auth, 400 without a
model):

| `status` | Meaning | What the UI shows |
|---|---|---|
| `ok` | Answered. `ms`, `reply`, `profile {reasoning, vision, code}`, `adjustments[]`, `thinking_only` | ✅ works (+ what was auto-adapted) |
| `not_chat` | Id is an embedding/reranker/speech/image/vision-only endpoint (no network call wasted) | ❌ with the class and why |
| `model_not_found` | 404 from NIM; `suggestions[]` = closest ids from the **live** catalog | ❌ "Did you mean …" (clickable) |
| `bad_key` / `no_key` | Key rejected / not saved | ❌ with the fix |
| `rate_limited` | 429 (Retry-After honoured elsewhere) | ❌ wait and retry |
| `timeout` / `network` | No answer in 25 s / unreachable | ❌ try a smaller model |

---

## 5. Proof

* `node tests/test_nim_models.mjs` — 124 checks: id hygiene, honest catalog
  (kept/hidden lists), reasoning split (JSON + SSE, boundary-split tags,
  memory stores only the answer), budget rescue, **seven real NIM 400 bodies
  → adaptation → success in the same request → remembered**, probe
  semantics, every `/ai/models/check` verdict, personality-prompt merge, and
  the pure adapter helpers.
* `node tests/test_ai_providers.mjs` — breaker, chain, cooldowns, catalog.
* `node tests/test_real_nvidia.mjs` — **live** run when `NVAPI_KEY` is set
  in the environment or a git-ignored `nexuscrm/.nvidia-test-key` file exists
  (skipped otherwise). It also asserts that no `nvapi-…` key is committed in
  any tracked file.
* Full battery: `npm test` (80 suites; route coverage enforced — `/ai/models/check` included).

---

## 6. When a model still fails

1. Press **Check this model** — read the `status`.
2. `model_not_found` with suggestions → the id changed; click a suggestion.
3. `ok` but `thinking_only` → normal for reasoning models on the probe; real
   calls get 1024+ tokens (raise **Max Tokens** in Settings for long answers).
4. Slow (> 20 s) → free-tier queueing on very large models; pick a smaller
   model or add it as the *second* entry of a fallback chain.
5. Repeated `overloaded`/`timeout` → the breaker cools the provider for 60 s
   after 3 failures and falls back to the next configured provider; the
   status dot and `/ai/providers` show it.
6. Anything else: the structured log line `ai.model.adapted` /
   `ai.provider.failure` (Cloudflare → Workers → Logs) carries the provider's
   exact message — keys are never logged.
