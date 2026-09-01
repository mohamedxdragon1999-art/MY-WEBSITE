# Voice Studio — talk-to-support voice website (English)

A website for **customer service by voice**: the user clicks the mic, **talks**,
and the agent **replies out loud** in a realistic, human-like voice. Five
selectable voice modes, and it always falls back to the browser voice so it
*never goes silent*.

```
You speak  →  browser Speech-to-Text  →  reply  →  chosen TTS voice  →  audio plays
```

## 🆕 v50 — emotion that tracks meaning

### The bug: emotion was a lookup table

`emotion.py` picked a feeling by matching cue **substrings** (`"i'm sorry"`,
`"great news"`). High precision, worth keeping — and completely silent on
anything it was never told about:

```
"The refund was rejected and the money is gone."  -> no cue -> NEUTRAL (flat)
"Your data was lost and we cannot recover it."    -> no cue -> NEUTRAL (flat)
```

Those are the exact moments a listener decides they are talking to a machine.
You cannot fix this by adding more cues, because **the set of sad sentences is
not enumerable**.

### The fix: continuous valence/arousal

New `engines/sentiment.py` scores meaning continuously — how good/bad
(*valence*) and how activated (*arousal*) — with the grammar that actually
flips meaning in support conversations:

| Rule | Example | Result |
|---|---|---|
| **Negation** (damped, not mirrored) | "this is **not** good" | negative, but milder than "bad" |
| **Intensifiers / diminishers** | "**slightly** delayed" vs "**extremely** bad" | scales magnitude |
| **Contrast** — what follows "but" is the point | "it was late, **but** it's fixed now" | positive |
| **Resolution cancels the problem** | "the **issue** is **resolved**" | positive, not averaged to flat |
| **Cancellation cancels the good thing** | "the **refund** was **rejected**" | negative, not averaged to flat |

The last two are mirrors of each other and both were found by *running* the
scorer, not reading it. Without them the two most common sentences in support
— announcing a fix, and announcing a refusal — both averaged out to
expressionless.

### "A bit sad", not theatrical

Mild feelings sound mild through **graded selection**, not extra scaling:

```
valence  +0.9 & loud -> excited        -0.15 -> serious      (a bit down)
         +0.5        -> happy          -0.32 -> concerned
         +0.18       -> warm           -0.55 -> empathetic   (real bad news)
```

This matters for a subtle reason: `Emotion.scaled(level)` already attenuates
the deviation from neutral. If this layer *also* returned a pre-attenuated
emotion the two would compound and mild feelings would vanish entirely.
Choosing a gentler emotion composes correctly instead.

The bands are deliberately **asymmetric** — negative feelings engage on weaker
evidence than positive ones. Mis-reading a routine line as cheerful is an
embarrassment; mis-reading a customer's bad news as cheerful is a disaster.

### Boring stays normal — never bored

Unremarkable text gets the **untouched** voice, guaranteed three ways:

1. There is no "bored" emotion in the table, and this layer cannot invent one.
2. Evidence below the confidence floor returns exactly `("neutral", 0.0)`.
3. A soft emotion is unreachable at non-negative valence (tested across the range).

A bored delivery is an *active* choice — slower, lower, quieter. Neutral is the
absence of one. Those are different sounds, and the difference is the
requirement.

> One of my own tests got this wrong, and running it proved it: I asserted no
> emotion may be slow+low+quiet at once, but `empathetic` is exactly that
> (0.93, −1.0, 0.97) — and should be. **Softness is not boredom.** The real
> rule is about *when* a soft emotion may be chosen: never on flat text.

Cues still win over the statistical read, so `"i'm sorry"` stays apologetic.
The scorer is pure, deterministic and stdlib-only — no clock, no randomness,
no network — which is required because a failed beat is re-synthesised alone
and must match the beats around it.

**`test_sentiment.py`: 113 checks.** Whole suite: **2,105 checks, 0 failures.**

---

## 🆕 v49 — realtime full-duplex voice (`/ws/voice`)

v48 was a **request/response** system wearing a realtime costume. v49 replaced
the transport and the turn-taking logic. Nothing was deleted: every HTTP route
(`/api/stt`, `/api/reply-stream`, `/api/tts`) still works, and the browser falls
back to the old path automatically if it can't open a socket. Add `?rt=0` to the
URL to force the old path for an A/B comparison.

### The five things that actually made v48 slow

| # | v48 behaviour | v49 |
|---|---|---|
| 1 | **Zero WebSockets.** `grep -rn websocket` matched nothing. Every turn was a POST. | Audio streams continuously over `/ws/voice`. |
| 2 | **Re-uploaded the whole utterance every 700 ms** (`_chunks.slice(0)`), so cost grew with the *square* of turn length — the end of a long sentence was the slowest part. | A **bounded** recognition window; constant cost per tick. |
| 3 | **"Streaming" ASR was batch.** `nemotron-asr-streaming` called via multipart upload. | Incremental recognition with LocalAgreement commits and overlap stripping. |
| 4 | **Endpointing was a regex ladder + fixed timers**, and only one rule could ever fire. | Log-odds fusion of *what* was said and *how* it was said — evidence accumulates. |
| 5 | **Could not be interrupted.** `_liveTick()` returned early while speaking; playback used a `Blob` + `Audio` element. | Open mic throughout; gapless Web Audio scheduling; barge-in is first-class. |

### Why turn-taking is the real latency win

Most "low latency" work optimises the model. The dominant cost in v48 was
**waiting to be sure you had stopped talking** — a flat padded timer, often
1.4 s. v49 decides using evidence:

- *"My account number is…"* → trailing preposition, still voiced → **waits**.
- *"Yes, that's correct."* → complete clause, falling pitch → **answers in ~200–300 ms**.
- *"Mhm"* while the agent talks → **backchannel**, does not steal the floor.

Prosody is strictly optional: with no prosody hint it contributes *exactly* 0.5
probability, a no-op in log-odds space, so a client that never sends it degrades
timing slightly instead of breaking. If the agent cuts someone off, it becomes
measurably more patient for the rest of the call.

### Speaking before the answer exists

The reply is chunked as it streams from the model. The **first** chunk is cut at
the earliest clause boundary (a comma is enough) to start audio as soon as
possible; later chunks require a full sentence boundary, because mid-sentence
cuts wreck prosody. Time-to-first-audio stops depending on reply length. If a
caller interrupts, only the text that was **actually spoken** enters history.

### New files

| File | Role |
|---|---|
| `endpointing.py` | Semantic + prosodic turn detection (log-odds fusion). |
| `audio_frames.py` | Raw PCM ring buffer, framing, VAD, prosody. |
| `asr_stream.py` | Incremental transcription, bounded window, overlap/repeat guards. |
| `realtime.py` | Full-duplex session state machine. Pure logic, no framework. |
| `realtime_server.py` | FastAPI WebSocket transport. |
| `engines/sentiment.py` | Continuous valence/arousal emotion (v50). |
| `static/capture-worklet.js` | 16 kHz PCM capture on the audio render thread. |
| `static/realtime.js` | Client engine: socket, gapless playback, barge-in. |

`realtime.py` takes its three dependencies (transcribe / stream_reply / synth)
by injection, so a **complete conversation, including barge-in, is tested with
no network, no API key and no browser**.

### Test status

All **26** suites pass. Five of them — `test_all_modes_human`, `test_call_mode`,
`test_emotion`, `test_turbo_capture`, `test_ultra_human` — were **silently dead**
before this build: they hardcoded `/data/new_ws/voice-studio` and aborted with
`FileNotFoundError` on any other machine. They now resolve paths relative to the
test file, so they actually run.

### Tuning

`VOICE_RT_SYNTH_TOTAL` (default 8s) caps synthesis of one sentence chunk across
the *whole* engine fallback chain. `?sensitivity=` (0.5–2.0) trades speed against
patience; the existing "reply after pause" slider maps onto it.

---

## 🆕 What's new in this build

### Natural conversation & GPT-4o-style turn-taking

- **Talks like a real person.** The agent now speaks in short, one-thought-at-a-time
  spoken sentences with natural rhythm, contractions, and light acknowledgments — no
  robotic, manual-reading tone. It uses natural punctuation so the voice pauses in the
  right places, and it's told to mirror your pace and never talk over you.
- **Smart turn-taking (knows when you've finished).** The mic now stays open and
  watches for a *natural pause* instead of firing the instant the browser guesses you
  stopped. An **adaptive silence detector** tells a 1-second "let me think…" pause from
  a finished thought: complete sentences get a snappy ~0.3–0.5s human gap, while trailing
  words like *"and…", "so…", "um…"* or a comma make it **wait patiently** so it never
  cuts you off mid-sentence.
- **Adjustable "Reply after pause".** A new slider in **⚙ Settings** (0.4s–2.0s, default
  0.9s ≈ a natural human gap) lets you tune exactly how long it waits before replying.

- **One-click talking + custom shortcuts.** The mic is now a **single-click toggle**
  (click once to start, click again to stop) — no more holding the mouse down. Open
  **⚙ Settings** to pick *One-click* or *Hold-to-talk*, and set your own **editable
  keyboard shortcuts** (e.g. `Space` to talk, `Escape` to stop). They're remembered
  in your browser.
- **Much faster replies.** Shorter, snappier answers (lower token budget), the brain
  defaults to a **fast small model**, and the local voices are **warmed up at startup**
  so the first reply isn't slow. Piper voices are now **cached** (they used to reload
  on every single reply — a big slowdown).
- **More natural voice.** *Vox Premium (best)* now leads with the **natural Edge neural
  voice** (the one from the demo), plus extra expressive voices (Emma, Brian, Ava…). A
  new **Pitch** slider joins **Speed** in ⚙ Settings for balancing the tone.
- **Live NVIDIA NIM models.** Once you save your NIM key, the app **loads every chat
  model your key can use live from NVIDIA** — not a fixed list of 5. There's a **search
  box** to filter and a **↻ Reload** button. Fast/small models are listed first.

> Voice tuning & shortcuts live in **⚙ Settings**; the brain/model picker lives in **🧠 AI Brain**.

## ⭐ One-click start (what you asked for)

Just double-click the launcher for your system — it sets everything up the first
time, starts the server, and opens the website in your browser automatically:

- **Windows:** `Start Voice Studio (Windows).bat`
- **Mac / Linux:** `Start Voice Studio (Mac-Linux).command`
  - On Mac, the first time you may need to right-click → **Open** (Gatekeeper).
  - If it won't run on Linux, run once: `chmod +x "Start Voice Studio (Mac-Linux).command"`

The **only** requirement is Python 3 (a free one-time install from
https://www.python.org/downloads/ — on Windows tick **“Add Python to PATH”**).
The first launch needs internet to install the voice engine; after that it
starts instantly. Use **Chrome or Edge** — they provide in-browser voice input.

> Manual start (optional): `pip install -r requirements-core.txt` then
> `uvicorn server:app --host 127.0.0.1 --port 8000`.

### If the first run shows errors
The launcher is designed so the website **always starts**, even if some optional
pieces fail:
- It installs a **tiny core** first (just the web server). Only if *that* fails
  will it stop — and it prints a clear message.
- The nicer extras (the online neural voice + the free cloud brain) and the
  fully-offline voices (Kokoro/Piper) are **optional**. If they don't install,
  the site still runs with the **browser voice** + the **offline brain**, and
  you'll just see a short "skipped" note — those red pip lines are not fatal.
- Every install line is saved to **`logs/setup.log`**. If setup ever stops,
  open that file (or send it to support) to see the exact cause.
- Common fixes: make sure you have **internet** on the first run; update pip
  (`python -m pip install --upgrade pip`); on Linux install
  `python3-venv python3-pip`. Then just launch again — it self-heals and only
  installs what's actually missing (no stale "already installed" state).

---

## ✨ What makes it feel human & fast (latest upgrade)
- **Streaming replies.** The agent starts answering token-by-token instead of
  waiting for the whole reply, so you hear the first words almost immediately.
- **Sentence-pipelined speech.** As each sentence finishes streaming, its audio
  is fetched *while the previous sentence is still playing* — much lower
  time-to-first-sound and no long silent gaps.
- **Barge-in (interrupt).** Just start talking (or press the mic / **⏹ Stop**)
  and the agent instantly stops speaking and listens — exactly like a real call.
- **Warmer, human persona.** The agent ("Alex") uses contractions, quick
  acknowledgments, and 1–3 short spoken sentences — never robotic, never dumps
  markdown or links into speech.
- **Tunable style.** `BRAIN_TEMPERATURE` (default 0.6) and `BRAIN_MAX_TOKENS`
  (default 320) let you dial warmth vs. focus and reply length.
- **⏹ Stop** and **↺ New** buttons in the top bar: stop the voice instantly or
  start a fresh conversation.

---

## The five voice modes (and the honest CPU story)

| # | Mode | Engine | Runs on user CPU? | Needs internet | Needs key | Quality |
|---|------|--------|-------------------|----------------|-----------|---------|
| 1 | **Current voice** | edge-tts (MS Edge neural) | CPU-friendly (no GPU) | **Yes** (online service) | No | ★★★★ |
| 2 | **Pocket TTS** | Piper | **Yes, 100% offline** | No | No | ★★★ |
| 3 | **Kokoro TTS** | kokoro-onnx (82M) | **Yes, offline (ONNX)** | No | No | ★★★★★ |
| 4 | **NVIDIA Magpie** | NVIDIA NIM | **No** (NVIDIA GPU cloud) | **Yes** | **Yes** | ★★★★★ |
| 5 | **Vox Premium** | auto-router + mastering | uses best *ready* one | depends | depends | ★★★★★ |

### Straight talk about "all on CPU, no problems"
- **Truly local-CPU, offline, private:** Kokoro (mode 3) and Piper (mode 2).
  These are the right choice for a CPU-only deployment. **Kokoro is the
  recommended default** — the most human-like of the CPU options.
- **edge-tts (mode 1)** doesn't need a GPU, but it is Microsoft's **online**
  service, so it needs internet. It's the exact voice from the original
  project's sample video (`en-US-AndrewMultilingualNeural`). This is what the
  one-click launcher installs by default, so the site sounds great immediately.
- **NVIDIA Magpie (mode 4)** is excellent but **cannot run on a user's CPU** — it
  runs on NVIDIA GPUs (NVIDIA's hosted cloud or a local NIM container). It's
  included as a **cloud** voice (set `NVIDIA_API_KEY`). Because the browser
  talks to *this app's* Python server and the server calls NVIDIA, there is **no
  CORS problem** and no separate proxy to deploy.
- **Vox Premium (mode 5)** is the honest "better than all": no single TTS beats
  every other everywhere, so it auto-selects the best voice actually *ready* on
  your machine (prefers Kokoro), then lightly masters the audio (normalize +
  fade) for a clean, consistent support-line sound.

If a mode isn't set up, the UI clearly says so and uses the **browser voice**
fallback so the page always talks.

---

## Optional upgrades (unlock the offline / cloud modes)

The launcher installs only the fast core. To enable the others:

```bash
# activate the environment the launcher made:
#   Windows:  .venv\Scripts\activate
#   Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt        # installs all engine libraries
```

### Mode 2 — Pocket TTS (Piper)  — offline CPU
```bash
python -m piper.download_voices en_US-amy-medium --data-dir models/piper
```
More voices: https://huggingface.co/rhasspy/piper-voices

### Mode 3 — Kokoro TTS  — offline CPU (recommended)
Download the two files into `models/kokoro/`:
- `kokoro-v1.0.onnx` (~310 MB) and `voices-v1.0.bin`
- from https://github.com/thewh1teagle/kokoro-onnx/releases

### Mode 4 — NVIDIA Magpie (cloud)
```bash
export NVIDIA_API_KEY=nvapi-xxxxxxxx          # free key at build.nvidia.com
# optional overrides:
export MAGPIE_URL=https://integrate.api.nvidia.com/v1/audio/speech
export MAGPIE_VOICE=Magpie-Multilingual.EN-US.Sofia
```

### Optional — server-side speech-to-text
The browser does speech-to-text for free. For browsers without it:
```bash
pip install faster-whisper
```

---

## Making it sound as human as possible
- Prefer **Kokoro** or **Magpie** for the most natural tone; **edge-tts** is a
  close, zero-setup option (needs internet).
- Keep replies in **short sentences** — neural voices use punctuation for natural
  pauses and intonation (text is cleaned for this automatically).
- Use the **Speed** slider (0.7–1.3) to match your brand's pace.
- Pick a fixed voice in the **Voice** dropdown for a consistent persona.

## The "brain" — free cloud AI (optional, recommended)
The reply text works out of the box with a tiny **offline** responder
(`reply.py`) — zero cost, zero setup. But you can instantly upgrade it to a real
LLM using any of these **genuinely free** cloud providers. Add a key to a `.env`
file (copy `.env.example`) and the brain auto-upgrades; if a provider is slow or
fails it **falls back to the offline responder**, so it never breaks.

| Provider | Env var | Free? | Get a key |
|----------|---------|-------|-----------|
| **Groq** (very fast) | `GROQ_API_KEY` | Yes | https://console.groq.com |
| **Cerebras** (very fast) | `CEREBRAS_API_KEY` | Yes | https://cloud.cerebras.ai |
| **NVIDIA NIM** | `NVIDIA_API_KEY` | Yes | https://build.nvidia.com |
| **Google Gemini** | `GEMINI_API_KEY` | Free tier | https://aistudio.google.com |
| **Mistral** | `MISTRAL_API_KEY` | Free tier | https://console.mistral.ai |
| **OpenRouter** (free models) | `OPENROUTER_API_KEY` | Yes | https://openrouter.ai |
| **Together AI** (free models) | `TOGETHER_API_KEY` | Yes | https://api.together.ai |

- Set **one or more** keys — the brain tries them in priority order and uses the
  first that answers. Control order with `BRAIN_ORDER=groq,nvidia` and override
  a model with e.g. `GROQ_MODEL=llama-3.1-8b-instant`.

### 🟢 Use NVIDIA NIM right from the website (no .env needed)
Click **🧠 AI Brain** in the top bar, choose **NVIDIA NIM models**, pick a model
(Llama 3.3 70B, Nemotron 70B, Mixtral, Qwen, Gemma, Phi, and more), paste your
`nvapi-...` key, and press **Save & test** — the app does a real live round-trip
to `https://integrate.api.nvidia.com/v1/chat/completions` to confirm it works.
From then on:
- The **NVIDIA NIM brain works with every voice mode** (edge, Piper, Kokoro,
  Magpie, Vox Premium) — brain and voice are independent choices.
- The same key also unlocks the **NVIDIA Magpie** voice (mode 4) — no `.env`
  edit required.
- The key is stored **only in your browser** (localStorage) and sent to your own
  local server, which calls NVIDIA for you — so there's no CORS/proxy problem
  and the key never goes to any third party.
- It's a real, live integration (not a placeholder): if NVIDIA is slow or the
  key/model is wrong, it automatically falls back to a server key or the offline
  responder so the line never goes dead.
- `httpx` (in `requirements-core.txt`) is all that's needed — no extra SDKs.
- The header/status line shows which brain is active. Force offline with
  `BRAIN_DISABLE=1`.
- Want your own assistant instead? Replace `generate_reply` in `reply.py` or
  point `brain.py` at your endpoint — the whole voice layer keeps working.

## Built for many users at once (~50 concurrent)
The server is designed to stay responsive when lots of people use it together:
- **Async everywhere.** Network voices (edge/Magpie) and the cloud brain run
  natively `async`, so waiting on the network never blocks other users.
- **One shared HTTP pool** (`httpx.AsyncClient`, keep-alive) for all brain calls
  instead of a new connection per request.
- **Concurrency lanes.** CPU voices (Kokoro/Piper) are bounded by a semaphore
  (`VOICE_CPU_CONCURRENCY`, default = CPU cores, max 4) so they can't thrash the
  machine; network voices get a much higher lane (`VOICE_NET_CONCURRENCY`, 32).
- **Audio LRU cache.** Identical requests (same text/voice/speed) are served
  from memory — support lines repeat a lot, so most hits are instant.
- **Single model load.** Kokoro's 310 MB model and the Whisper STT model load
  **once** behind a lock, even if 50 first-hits arrive together.
- **Cached availability checks** keep the hot path cheap.

**Recommendation for real 50-user load on CPU:** use **edge-tts** (network,
light on CPU) or a **cloud brain**, and/or run multiple workers
(`uvicorn server:app --workers 4`). Pure offline Kokoro on CPU is the highest
quality but the heaviest — the CPU lane keeps it stable, but for very high
concurrency give the box more cores/workers.

## Speed problems & hidden issues fixed in this version
- **STT temp-file collision (bug):** the old code wrote every upload to one
  fixed file — concurrent users corrupted each other's audio. Now each request
  uses a unique temp file.
- **STT model reloaded every request (slow):** the Whisper model is now cached
  and loaded once behind a lock.
- **Blocking calls under load:** network TTS + brain now run async on a shared
  client instead of spinning a fresh event loop/thread per call.
- **Repeated identical synths (slow + wasteful):** added an in-memory audio
  cache.
- **Availability probing on every call:** now memoized for a few seconds.
- **Kokoro model could load many times at once:** now guarded with a lock.
- **Requests could crash instead of degrading:** synth errors now return a clean
  503/502 and the UI falls back to the browser voice.
- **No smart replies out of the box:** added the free cloud-AI brain with
  automatic offline fallback.

## Project layout
```
voice-studio/
  Start Voice Studio (Windows).bat      one-click launcher (Windows)
  Start Voice Studio (Mac-Linux).command one-click launcher (Mac/Linux)
  server.py            FastAPI app (serves site + /api/tts, /api/reply, /api/stt)
  reply.py             simple offline customer-service responder (English)
  brain.py             optional free cloud-AI reply engine (Groq/NVIDIA/Gemini/...)
  .env.example         copy to .env to add free AI keys + tune performance
  engines/
    base.py            engine interface + audio/text helpers
    edge_engine.py     Mode 1   (edge-tts)
    piper_engine.py    Mode 2   (Piper, offline)
    kokoro_engine.py   Mode 3   (Kokoro, offline)
    magpie_engine.py   Mode 4   (NVIDIA NIM, cloud)
    best_engine.py     Mode 5   (auto-best + mastering)
  static/              index.html, app.js, styles.css (the website)
  models/              (you download Piper/Kokoro weights here)
  requirements-core.txt  minimal deps the launcher installs
  requirements.txt       full deps for all modes
```

## 🏢 Enterprise / multi-tenant mode

Run ONE server for MANY websites, each with its own branding, voice, prompt,
brain key and rate limits - built for 10-50+ concurrent customers per site.
Full guide: **[ENTERPRISE.md](ENTERPRISE.md)**.

**Embed on any website with one line** (change `data-site` per site):
```html
<script src="https://your-host/widget.js"
        data-site="acme"
        data-api="https://your-host"
        defer></script>
```
The widget renders inside a Shadow DOM (never clashes with the host page),
streams replies, speaks each sentence as it arrives, supports barge-in, and
falls back to the browser voice. Live demo at `/widget-demo.html`.

**Define your websites** in `tenants.json` (see `tenants.example.json`), then:
```bash
cp .env.example .env          # add free AI keys + per-tenant *_AI_KEY values
docker compose up -d --build  # gunicorn + uvicorn workers, health-checked
```

**What enterprise mode adds**
- Multi-tenant config + isolation (per-site voice, prompt, brand, key, limits).
- Embeddable Shadow-DOM widget (`static/widget.js`) + demo page.
- Dynamic per-tenant CORS; optional per-tenant API token.
- Token-bucket rate limiting (per tenant, per client) + global backpressure gate.
- Server-side conversation sessions with TTL (no unbounded history on the client).
- **Per-call memory (privacy by default):** the assistant remembers everything
  said *while a call is open*, then **forgets the visitor the moment the call
  ends** — closing the chat, pressing “New conversation”, or closing the tab all
  wipe the server-side context and rotate to a fresh, unlinkable call id. The
  session id is kept only in memory (never in localStorage/cookies), so nothing
  carries over between calls or survives a reload. An idle-call TTL is the
  safety net that clears abandoned calls automatically.
- Provider circuit breaker (skips a failing AI provider, fails over instantly).
- Balanced audio mastering: DC removal + RMS loudness targeting + peak ceiling,
  so every reply sounds consistently clear and never clips.
- Observability: structured JSON logs w/ request ids, `/api/health`,
  `/api/ready`, `/api/metrics` (Prometheus), plus security headers.
- Deploy artifacts: `Dockerfile`, `docker-compose.yml`, `gunicorn_conf.py`,
  `nginx.conf.example`, `.dockerignore`.

### Enterprise project layout (additions)
```
voice-studio/
  tenants.py            multi-tenant registry (config + isolation)
  tenants.example.json  sample registry for two websites
  ratelimit.py          per-client token-bucket rate limiter
  sessions.py           server-side conversation sessions (TTL-evicted)
  ENTERPRISE.md         full multi-tenant / deploy / scaling / security guide
  Dockerfile            production image (non-root, healthcheck)
  docker-compose.yml    one-command deploy
  gunicorn_conf.py      multi-worker (uvicorn) config
  nginx.conf.example    TLS + SSE-friendly reverse proxy
  static/
    widget.js           embeddable Shadow-DOM widget (one-line install)
    widget-demo.html    embed demo page
```

---

# v16 — Speed & Free Capacity Overhaul

This release is about one thing: **making the brain fast and keeping it fast when many people call at once, without ever paying.**

## First, a correction worth knowing

Cerebras' free tier is **not** 5 requests per minute. It is roughly **30 requests/minute and about 1 million tokens/day, with no card required**. The underlying worry is still completely valid though: *any* free tier is rate limited **per key**, so a single key really will start throwing errors once enough people call at the same time. That is the actual problem, and v16 solves it directly.

## The fix: free keys are a resource you can multiply

Rate limits are enforced **per key**, not per site and not per person. So the cheapest way to buy capacity is to make more free keys.

| Free NVIDIA keys | Requests/minute | Rough simultaneous callers | Cost |
|---|---|---|---|
| 1 | ~36 | ~9 | £0 |
| 3 | ~108 | ~27 | £0 |
| 5 | ~180 | ~45 | £0 |
| 10 | ~360 | ~90 | £0 |

Add them in `.env` (`NVIDIA_API_KEYS=a,b,c`) or just **paste them comma-separated into the key box in the UI**. The panel tells you live how much capacity you now have.

### How the rotation behaves
- Keys are handed out **round-robin**, so load spreads evenly instead of hammering key #1.
- Each key's usage is tracked against its own per-minute and per-day budget. A key that is at its ceiling is simply **not offered**.
- A `429` **benches that key for ~22 seconds** and the request immediately retries on the next key. The caller hears an answer, not an error.
- Up to 4 keys are tried before falling back to the next provider, then to the offline brain. **There is no path that ends in silence.**

## Making NIM itself faster

Five changes, each attacking a real, measured source of delay:

1. **Warm connections at startup.** A cold DNS lookup + TLS handshake can add **up to ~2 seconds** to a first reply. The server now opens a connection to every configured provider *before* anyone calls, and re-pings every 4 minutes so it never goes cold. The first caller of the day is now as fast as the hundredth.
2. **HTTP/2 with a large keep-alive pool** (200 connections, 100 kept alive, 5-minute expiry). Reusing an established connection removes **60–80% of per-request overhead**. Falls back to HTTP/1.1 automatically if `h2` isn't installed.
3. **Fast model first.** `meta/llama-3.1-8b-instruct` is the NIM default — **136.8 tokens/sec** versus 111.8 for the 30B reasoning model. The live model list is also sorted fast-first (8b/mini/small/flash float to the top), so the quick options are the ones you see.
4. **Instant-answer cache.** Around **30% of customer-service questions are repeats**. Those now return from memory in microseconds, use **zero** rate-limit budget, and free the whole pool for genuinely new questions. Deployments doing this have gone from 25s to <100ms on repeat questions.
5. **Streaming is never retried mid-sentence.** Once the first token is out the door the answer is committed, so you never hear a reply restart itself.

### The cache is deliberately careful
It only fires on stand-alone, non-personal, non-time-sensitive questions. It **refuses** anything containing "my order", "my account", an order number, "today", "status of", any follow-up that depends on conversation history, and anything under 2 meaningful words. It is also **scoped per tenant and per persona** — one site can never see another site's answers, and changing the system prompt invalidates the scope. Entries expire after 30 minutes and the store is bounded at 800 entries.

## Cloudflare Workers AI — one more free provider

Added as a first-class provider: **10,000 free Neurons/day, no card required**, running `@cf/meta/llama-3.1-8b-instruct-fast`. Set `CLOUDFLARE_API_KEY` and `CLOUDFLARE_ACCOUNT_ID`. If either is missing the provider is hidden automatically rather than failing at call time.

Full free fallback chain: `groq → cerebras → nvidia → cloudflare → gemini → mistral → openrouter → together`. Every one has a free tier; the first with a working key wins, and a dead provider is skipped by a circuit breaker for 30 seconds instead of being retried into the ground.

## New visibility

- **`GET /api/pool`** — keys configured, capacity per minute, per-key headroom, which keys are benched, and cache hit rate.
- **`/api/health`** now includes `brain_pool` and `reply_cache`.
- **`/api/metrics`** adds `voice_brain_keys`, `voice_brain_capacity_rpm`, `voice_reply_cache_{entries,hits,misses,hit_rate}`, plus per-provider and per-key gauges. Keys are shown as last-4 only — **the full key is never exposed anywhere**.

## Honest caveats

- The per-key RPM figures are the documented free-tier defaults. If your tier differs, override with `NVIDIA_RPM` / `NVIDIA_RPD` etc.
- The build sandbox has no outbound internet, so pool/cache/rotation logic is verified by an automated test suite (44 checks, all passing) rather than by live calls to NVIDIA. The first thing to do on your own machine is start it and watch `/api/pool`.
- Turn-taking still relies on the browser's speech recognition, which is Chrome/Edge only.

---

# v5.0 - ULTRA HUMAN MODE (new)

A sixth voice mode built for one purpose: sound more like a real person than a
single-vendor assistant voice, on a normal CPU, for free.

## Why this model, and not another one

I ranked every serious option on three axes the competitor is weak on -
**realism, stability, and "can a phone user actually run it"**.

| Model | Realism evidence | CPU speed | Licence | Verdict |
|---|---|---|---|---|
| **Fish Audio S2.1 Pro** | Elo **1116** - top open-weights model on the blind Speech Arena | Cloud, so any device | Free API tier, no card | **Chosen - tier 1** |
| **Chatterbox (Resemble)** | Preferred over ElevenLabs in **63.75%** of blind tests | Nano 110M = **3x real time on 8 cores** | **MIT** | **Chosen - tier 2** |
| Qwen-Audio-3.0-TTS | Elo **1238**, #1 overall | Cloud | Not free/open enough | Rejected |
| Sesame CSM-1B | Listeners could not reliably tell it from a real recording | Unverified on CPU | Apache-2.0 | Rejected (unproven cost) |
| Orpheus 3B | Excellent | Needs 6-8GB VRAM | Apache-2.0 | Rejected (no GPU) |
| Supertonic 3 | MOS 4.37, RTF 0.165 (fastest tested) | Excellent | **OpenRAIL-M commercial limits** | Rejected (licence) |
| NeuTTS Air | MOS ~4.2-4.5 | >2x real time | Apache-2.0 | Viable spare |
| Kokoro-82M (we ship it) | 44% win rate, TTS Arena V2 | ~2x real time | Apache-2.0 | Kept as fallback |

The honest finding behind all of this: **raw naturalness is close to saturated**.
Sesame's own study found listeners had no clear preference between their model
and real human recordings when context was stripped out. So the remaining gap
versus a competitor voice is **not the vocoder** - it is *what text you feed it*
and *whether it ever breaks*. That is where this mode spends its effort.

## What the mode actually does

**1. A prosody layer (`engines/prosody.py`) that runs before every voice.**
Humans do not speak written English. This rewrites the reply the way a person
would actually say it:

- contractions (35 pairs): `I am sorry but I cannot` -> `I'm sorry but I can't`
- natural pauses after discourse markers: `Well I` -> `Well, I`
- one - and only one - paralinguistic cue where a human would produce it:
  `[sigh]` before an apology, `[chuckle]` on warmth, `[breath]` before thinking.
  Over-tagging is what makes AI voices sound like parody, so it is capped at one.

Example, verified:
`Well I am sorry but I cannot do that because it is not allowed`
-> `[sigh] Well, I'm sorry but I can't do that, because it isn't allowed`

**2. Tags are routed, not blindly sent.** Fish and Chatterbox read bracket tags
natively. Kokoro, Edge and Piper do not - they would literally pronounce
"bracket sigh bracket". So tags are stripped automatically for those engines.
This is covered by tests because it is the single most embarrassing possible bug.

**3. A quality ladder, not a single model.** Per request it picks the best tier
that is actually working: Fish -> Chatterbox -> Kokoro -> Edge -> Piper. A tier
that fails is benched for 20 seconds so the next caller does not wait on it.
**This is the stability win** - one model having a bad day degrades the voice by
one rung instead of producing silence.

## Setup (30 seconds, free)

Get a free key at <https://fish.audio> - no credit card, unlimited under fair
use - and put it in `.env`:

```
FISH_API_KEY=your_key_here
```

That alone gives every visitor the top-ranked open-weights voice, including
phone users with no GPU, and costs your server almost nothing.

Optional fully-offline tier:

```
pip install chatterbox-tts
CHATTERBOX_MODEL=nano      # 110M, ~3x real time on 8 CPU cores
```

With **neither** installed the mode still works - it falls back to Kokoro/Edge
and still applies the prosody layer, so it is better than before either way.

## Tuning

| Variable | Default | Effect |
|---|---|---|
| `HUMAN_EXPRESSIVENESS` | `0.5` | 0 = flat and formal, 1 = very animated |
| `HUMAN_ORDER` | `fish,chatterbox,kokoro,edge,piper` | Reorder the ladder |
| `HUMAN_COOLDOWN_SEC` | `20` | How long a failed tier is skipped |
| `CHATTERBOX_MODEL` | `nano` | `nano` (CPU) or `turbo` (GPU, higher quality) |
| `CHATTERBOX_REF` | - | Path to a 5s clip to clone a specific voice |

## Honest limitations

- Chatterbox's advertised sub-200ms latency is a **GPU** figure. On CPU expect
  roughly real time. This is exactly why Fish is tier 1.
- Fish is a network call - if the operator sets no key and installs no local
  model, you get the older Kokoro-quality voice, not the new one.
- No audio could be rendered in the build environment (no network, no wheels),
  so the new engines are **code-verified and contract-tested, not ear-tested**.
  The first thing to do after adding a key is listen.

---

# v5.1 - Ultra Human, verified and hardened

This release exists because two claims in v5.0 deserved to be checked rather
than trusted. Both checks changed the code.

## 1. "Isn't Fish paid and limited?" - half right, and the half matters

There are **two different things called free** at Fish Audio:

| | What it is | Limits |
|---|---|---|
| Website **Free plan** | Consumer plan | 8,000 credits/mo, **~7 minutes total**, 500 chars per generation |
| API model **`s2.1-pro-free`** | What this app uses | **$0.00 / M UTF-8 bytes** in the official pricing table, **no hard character cap**, fair use |

For scale, 1M UTF-8 bytes is roughly **12 hours of speech**. So the API tier is
not the 7-minute plan - it is genuinely free at real volume.

**The real catches** (from Fish's own "What free actually means" page, not marketing):

- **No SLA, no latency guarantee.** It can be slow or briefly unavailable.
- **Requests may be retained for model improvement.**
- Products above **~$1M ARR** are asked to contact Fish first.

**What changed in the code because of this:**

- **`FISH_PRIVACY_STRICT=1`** - hard-disables the cloud tier. For customer
  service where callers say order numbers or addresses, **set this**. Retention
  is a bigger deal than voice quality.
- **Timeout cut 20s -> 12s.** No SLA means fail fast to the local voice; silence
  is worse than a slightly lesser voice.
- **429 -> 30s automatic cooldown**, and auth/rate errors are never retried.
- **`FISH_MAX_RPM=120` local fair-use limiter** so a traffic spike can't get the
  free key throttled or banned.

## 2. "Isn't Chatterbox heavy?" - the full model yes, Nano no

| Variant | Params | Needs | Verdict |
|---|---|---|---|
| Full Chatterbox | 0.5B Llama backbone | **8-16GB VRAM**, GPU recommended | Too heavy - never a default here |
| Turbo | 350M | ~5GB RAM, wants GPU to feel instant | Optional |
| **Nano** | **110M** | **~2.5GB RAM, 3x real-time on 8 CPU cores** | **Our default** |

So your instinct was right about Chatterbox in general and wrong about the one
we actually use. Nano is the distilled model - decoder cut from 10 steps to 1.

**What changed in the code:** a **RAM guard**. Before loading, it reads actual
system memory and *refuses* a variant that would thrash, with a message telling
you to use Nano - instead of OOM-ing your server. Also a **thread cap**, because
without it every concurrent request grabs every core and 5 callers run slower
than 5 callers in a queue.

## 3. What server should I actually rent?

Assume Fish handles most traffic and local TTS is the fallback. **RAM is the
constraint, cores decide concurrency.**

| Load | Spec | Provider examples | ~Price/mo |
|---|---|---|---|
| Testing / 1 site, few callers | 2 vCPU, 4GB | Hetzner CX22 | **~EUR 3.79** |
| **Recommended start** - 10-30 concurrent | 4 vCPU, 8GB | Hetzner CX32 / Contabo Cloud VPS | **~EUR 5.50-7** |
| 50+ concurrent, local TTS heavy | **8 vCPU, 24GB** | **Contabo Cloud VPS 8** | **~EUR 11-14** |
| Consistent latency under load | Dedicated cores | Hetzner CCX / Contabo VDS | ~EUR 31-43 |

**Recommendation: Contabo Cloud VPS (8 vCPU / 24GB, ~EUR 11-14/mo)** is the best
value for this workload - it is roughly $1.29 per vCPU, and TTS is CPU-and-RAM
bound, not network bound. Hetzner is the better-quality network but **raised
cloud prices sharply in June 2026** (CPX/CCX up 2.1x-3.1x), so its dedicated-core
plans are no longer the bargain they were. Avoid the $4-6 1GB droplets - Nano
alone wants ~2.5GB.

**Two things that cut the server you need in half:**

1. **Set a Fish key.** Cloud TTS moves the work off your box entirely. A EUR 5
   server can then serve a lot of callers, because it is only doing STT routing
   and the brain call.
2. **The reply cache** (already in this app) - customer service repeats itself
   constantly, and a cache hit costs no CPU at all.

**Sizing rule of thumb:** with Nano at 3x real-time, one core produces ~3
seconds of audio per second. People listen far longer than they talk, so
budget roughly **1 core per 3-5 concurrent callers** for local TTS, and far
more if Fish is carrying the load.

## Test coverage

`test_v17_voice.py` - **159 assertions, all passing**: tag stripping for all 10
tags, contraction and pacing transforms, one-tag-max restraint, unicode/empty/
long-text safety, registry ordering, availability honesty for every mode, Fish
payload clamping and free-tier guards, privacy-strict enforcement, the fair-use
limiter's sliding window, the Chatterbox RAM guard refusing an oversized
variant, and - using simulated engines - the full ladder fall-through:
broken tier benched, next tier serves, tag-aware tiers receive tags, Kokoro
receives stripped text, and an actionable error when every tier is down.

---

# v5.2 - Voice capture rebuilt, and EVERY mode made human

## 1. The "um" bug - found the exact cause

The recognizer's `onend` handler was ending your turn. Chrome closes the speech
stream by itself after a short silence **even with `continuous = true`**, and
the old code treated that close as "the caller finished talking" and instantly
submitted whatever it had. So when you said *"um... I think..."*, the pause
after "um" closed the stream and **"um" was sent as your whole question** -
completely bypassing the adaptive pause timer that was supposed to wait for you.

**Fix: `onend` can no longer end a turn, ever.** It keeps the words captured so
far, restarts the recognizer immediately, and only the pause timer decides when
you are done.

## 2. Weak / slow / dropped capture - three separate causes

| Cause | Fix |
|---|---|
| The mic was powered up fresh on every turn, and that startup swallowed your first word or two | **One mic stream is now opened once and reused** for the whole session, before recognition starts |
| Quiet speech, fan noise and distance made words unrecoverable | `echoCancellation`, `noiseSuppression` and `autoGainControl` are now requested explicitly - auto gain is what rescues quiet and far-from-mic speakers |
| When the recognizer dropped, it silently died | `_restartRecognition()` retries with backoff, and only after 8 failures tells you honestly to click the mic |

## 3. It stopped waiting for you - now it listens to your actual voice

The old logic could only react to words **already transcribed**. If you were
still mid-sentence but the recognizer hadn't caught up, that was
indistinguishable from silence.

Now there is a real **audio VAD**: an analyser measures live microphone energy
against an **adaptive noise floor** (so a noisy office still works), and a turn
**cannot end while the mic can physically hear you talking**. On top of that:

- **Filler-only speech never counts as a turn.** "um", "uh", "hmm", "so", "well"
  on their own buy you **+1400ms** instead of being sent as a question.
- **Trailing hesitations** ("I want to", "my order is", "because") buy **+1000ms**.
- **Default pause raised 900ms to 1100ms** - the old value was the "talk in 2
  seconds" feeling you described.
- **A finished sentence still answers fast** (base minus 500ms), so patience
  costs you nothing when you clearly stopped.
- A **20-second hard deadline** guarantees the agent always eventually replies.

## 4. ALL modes are now human, not just Ultra Human

Humanization used to live inside the Ultra Human mode only. It now lives on the
**base engine class**, so Edge, Piper, Kokoro, Magpie, Fish and Chatterbox all
get it.

The reason this matters more than model quality: **neural voices sound robotic
mostly because the TEXT is robotic.** "I am not able to do that" is written
English; "I'm not able to do that" is spoken English. No model fixes that for
you. Every mode now gets contractions, natural pacing and breath points.

Crucially, tags are routed correctly: only **Fish and Chatterbox** are marked
`tag_aware` and actually perform `[sigh]`. For every other engine the tags are
stripped, because otherwise the voice literally reads out "bracket sigh
bracket". Tests assert this for all 10 tags across every non-tag-aware engine.

Two new knobs: `VOICE_HUMANIZE=0` reads text verbatim (for legal/scripted copy),
and `VOICE_EXPRESSIVENESS` (0.0 flat to 1.0 very expressive, default 0.5) now
tunes every mode from one place.

## Test coverage: 339 assertions, all passing

- `test_ultra_human.py` - **159**
- `test_all_modes_human.py` - **180** (new)

The new suite covers: humanization on every registered mode, the
"bracket sigh bracket" bug for all 10 tags across all non-tag-aware engines,
tag preservation without double-tagging on tag-aware engines, expressiveness
clamping and the global off-switch, hostile input (empty, 9000 chars, unicode,
HTML, stray brackets), a static guarantee that no engine bypasses the shared
layer, and the capture logic: that `onend` never submits, that the mic is
opened before recognition, that VAD and filler rules gate the turn, and that a
bounded deadline still guarantees a reply.

**Three real bugs were caught by these tests during development** - including
Fish and Chatterbox silently *losing* their expression tags, because
`humanize(tags=False)` strips them. That one would have been invisible in code
review and audible in production.

---

## v6.0 - Phone-call mode, and a real "words taker"

Two things changed that you will feel immediately.

### 1. The mic no longer stops between turns

The old behaviour was a walkie-talkie: every time you finished a sentence the
code called `stopListening()`, answered you, then re-opened the mic. That is
why it felt like it kept cutting you off.

Now there is a real call. Press **Start call** once and the microphone stays
open until you press **End call** - nothing in between closes it.

- `state.inCall` guards the old teardown: `if (!state.inCall) stopListening()`.
- A **3-second watchdog** (`_ensureAlive`) revives the recognizer if the browser
  kills it. This is not theoretical: Chrome's SpeechRecognition is documented to
  stop on its own after a minute or two of silence, and Safari has an open
  AudioSession bug. The watchdog restarts it without dropping your call.
- Transient recognizer errors restart the line instead of hanging up. Only a
  denied mic permission ends the call, and it says so plainly.
- Returning to a background tab revives the line; closing the tab releases the
  mic so the browser stops showing the recording dot.

### 2. Barge-in that knows the difference between interrupting and agreeing

You can talk over the agent and it stops instantly. But saying "mm-hmm",
"yeah", "right", "got it" while it talks no longer cuts it off - those are
backchannels, not interruptions. This is exactly the fix LiveKit tracks in
issue #4450, and it costs well under a millisecond per decision.

### 3. New mic features

| Feature | Why it matters |
|---|---|
| **Mute** | Disables the audio track instead of stopping it, so the line is never dropped and the browser never re-prompts for permission. |
| **Live input meter** | You can see the mic is actually hearing you (AnalyserNode-based, the correct API for metering - `ScriptProcessorNode` is deprecated). |
| **Call timer** | Shows how long the call has been up. |
| **Honest errors** | A blocked mic says so instead of pretending to listen. |

### 4. Turbo capture: 10-30x faster transcription

The browser's SpeechRecognition was the weakest part of the whole stack. It is
slow to commit final text and it silently drops words. So it is no longer in
charge of your words.

While a call is open, the site records the audio of each turn from the mic
stream that is already open, and sends that turn to a Parakeet-class ASR model:

| Model | WER | RTFx (seconds of audio per second of compute) |
|---|---|---|
| `parakeet-tdt-0.6b-v2` (default) | 6.05% | ~3386 |
| `canary-1b-flash` | 6.35% | ~1046 |
| `whisper-large-v3` | ~7.4% | ~100 |

RTFx in the thousands means a five-second utterance is transcribed in
single-digit milliseconds of model time, against roughly 100x real-time for
Whisper-class autoregressive decoding. Parakeet also hallucinates far less
during silence, because a TDT transducer is allowed to emit nothing.

**How it behaves in practice:**

- Browser text is still used instantly for live captions and pause detection,
  so the UI never feels frozen.
- The recorded audio decides the **final** wording, which is what fixes dropped
  words.
- If the model returns nothing, or a suspiciously truncated result, the browser
  transcript is used instead. Your words are never lost.
- The upload is time-capped, so a bad network can never stall the call.
- The recorder is started **once** per call and sliced per turn. Restarting a
  recorder per turn loses the first syllables - that was part of the original
  capture bug.
- With no NVIDIA key it silently stays on browser recognition. Set
  `NVIDIA_ASR_URL` to a local ASR NIM container for a fully self-hosted path.

See `.env.example` for `VOICE_FAST_STT`, `NVIDIA_ASR_MODEL`, `NVIDIA_ASR_URL`,
and `NVIDIA_ASR_TIMEOUT`.

### Latency targets we are designing against

Published benchmarks: above **800ms** callers notice the delay, above
**1500ms** conversations feel broken, and the industry median for voice agents
is **1.4-1.7s**. Dead air past **5s** is an alarm and **10s** is a red line.

### Test coverage

**477 assertions, all passing:** 75 call-mode, 63 turbo-capture, 180 voice/
humanization, 159 ultra-human. Honest caveat: this environment has no audio
device and no GPU, so voice output and ASR accuracy are verified by contract
and by code, not by listening. Speech capture still needs Chrome or Edge for
the browser fallback layer.

---

## v6.1 - Real emotion, and the end of the spoken "sigh"

### The bug you heard

You asked it to be emotional and it said the WORD "sigh". Here is exactly why.

The old sanitizer was this single regex:

    _TAG_RE = re.compile(r"\[[a-z ]{2,14}\]")

It only matched **lowercase** text inside **square brackets**. But a language
model told to be emotional does not write `[sigh]`. It writes `*sighs*`,
`(pauses)`, `[Sigh]`, `<laughs softly>`, or just `Sighs.` at the start of a
line. Every one of those forms slipped past the filter, reached the voice, and
got pronounced as a word. The filter was catching the one case that rarely
happened and missing all the cases that did.

**Fixed at four independent layers**, because one filter is how this happened:

1. **`sanitize_stage_directions()`** removes asides in every bracket style
   (`[] () {} <> ** * _`), any capitalisation, plus bare leading actions like
   "Sighs." - and it runs for *every* engine, including the tag-aware ones.
2. **Every engine** now sanitizes on the way in, verified per engine in tests.
3. **The browser fallback voice** - the robotic one - never went through the
   server sanitizer at all. It now sanitizes in the browser before speaking.
4. **The system prompt** explicitly forbids producing them in the first place.

It does **not** over-strip: "This deal is \*free\* today", "press the pause
button", and "your refund (up to 30 days)" all survive intact.

### Emotion is acoustics, not vocabulary

This is the core insight behind the rebuild. Writing "[sigh]" was never going
to produce emotion - at best a couple of engines perform it, at worst it gets
read aloud. **Real emotion lives in rate, pitch and volume.**

So `engines/emotion.py` reads the *meaning* of each line and returns real
numbers that every engine applies to its actual synthesis parameters:

| Emotion | Speed | Pitch | Volume |
|---|---|---|---|
| apologetic | -9% | -1.2 st | -5% |
| empathetic | -7% | -1.0 st | -3% |
| thinking | -6% | -0.3 st | -2% |
| serious | -5% | -0.8 st | 0 |
| warm | +2% | +0.5 st | +2% |
| happy | +7% | +1.4 st | +5% |
| excited | +12% | +2.2 st | +8% |

Eleven emotions are detected from real support-call phrasing - "unfortunately",
"I understand how frustrating", "great news", "let me check", "do not share",
"don't worry" - with question marks and exclamations as a fallback. An apology
now genuinely comes out **slower, lower and softer**; good news comes out
**faster, higher and brighter**.

### Per-sentence delivery: the biggest robot tell, removed

One rate for a whole paragraph is *why* TTS sounds mechanical. Nobody delivers
every sentence identically. Now each sentence gets its own tone, its own speed,
and **real silence** between sentences instead of the word "pause":

    "Thanks for waiting."            warm      pause 240ms
    "Let me check that for you."     thinking  pause 520ms
    "Great news, it shipped!"        happy     pause 260ms
    "I'm sorry it was late."         apologetic

The thinking pause is deliberately the longest - that gap is what `[pause]` was
failing to express. Each sentence also carries a small deterministic variation
(±3% speed, ±0.35 semitone) so a long answer rises and falls. It is seeded from
the sentence text, so the same reply always sounds the same rather than
jittering randomly between retries.

### What each mode got

| Mode | How emotion is applied |
|---|---|
| **Edge** | Real rate + pitch + **volume** per reply (volume was never sent before) |
| **Kokoro** | Per-sentence speed with real silent gaps, stitched from raw samples |
| **Piper** | Per-sentence `length_scale` with real silent gaps |
| **Fish** | Emotion-driven speed **plus** one performance tag for the actual sound |
| **Chatterbox** | Emotion drives the `exaggeration` knob, plus one tag |
| **Browser fallback** | Rate and pitch now move with meaning; sanitized first |

Every mode is expressive now - not just the premium one.

### Controls

- `VOICE_EMOTION=1` - master switch (`0` gives a deliberately flat voice).
- `VOICE_EMOTION_INTENSITY=0.75` - `0` collapses to neutral, `1` is a full
  performance. Pitch stays under 4 semitones at all settings, because bigger
  jumps stop sounding human and start sounding like a cartoon.

Your own speed setting still applies on top of emotion; emotion multiplies it
rather than overriding it.

### Tests

**619 assertions, all passing** - 142 new emotion/sanitizer, 63 turbo capture,
75 call mode, 180 all-modes, 159 ultra-human. The emotion suite checks all 27
leak forms are removed, that real words are not eaten, that every engine
sanitizes, and that an apology is measurably slower than good news.

Honest caveat: this environment has no audio device and no GPU, so the direction
and magnitude of every acoustic change is verified numerically, but I could not
listen to the result. You are the first ear on it.


---

## v6.2 - prosody, capture and latency

Three things changed in this release: the voice got real intonation, the
recogniser got sharper, and the reply got faster **without speeding up the
speech**.

### 1. Emotion: from "which emotion" to "how it is delivered"

v6.1 already picked an emotion per sentence and moved rate/pitch/volume. That
was the right foundation, but every sentence still *landed* the same way, and
that is the strongest robot tell there is. Pitch movement (F0) is the dominant
prosodic parameter in the speech-synthesis literature - the overwhelming
majority of published prosody studies model it - so it is where the remaining
realism was hiding.

**Terminal contour.** Every sentence now gets a `rise`, `fall` or `level`
ending:

| Sentence | Contour | Why |
|---|---|---|
| `Do you want the receipt?` | rise | yes/no questions rise |
| `Where do you live?` | **fall** | wh-questions *fall* in natural English |
| `Your refund is confirmed.` | fall | statements settle |
| `Let me check that,` | level | the thought is not finished |

The wh-question case is the detail almost every TTS gets wrong. Machines lift
the ending of anything with a question mark; people do not.

**Emphasis, capped at three.** Content words and always-stressed words (`not`,
`never`, `only`, `confirmed`, `declined`, `refund`...) are marked for stress, but
never more than three per sentence. A voice that stresses nothing sounds bored;
one that stresses everything sounds unhinged.

**Micro-pauses inside sentences.** Commas, semicolons and dashes now insert real
silence - 90ms normally, **150ms** when apologetic/concerned/serious, **70ms**
when excited or amused. Sad speech breathes slower than happy speech.

**Smoothing, so emotions do not whiplash.** Each sentence carries **25%** of the
previous sentence's acoustic state forward. Snapping from grief to delight
between two sentences is a machine artefact. There is also **final lengthening**
(last beat at `rate * 0.97`), because people slow down on the last thing they
say.

**Five new emotions**, bringing the palette to 16: `concerned`, `encouraging`,
`confident`, `polite`, `amused` - the registers a support agent actually needs
and the ones the old set had to fake with `warm`.

All of it is wired into the engines, not decorative: Kokoro and Piper expose no
pitch control, so their contour is carried by tempo, and both now insert the
clause gaps.

### 2. Word capture: keyword boosting

Speech recognition tops out around 95-98% on clean audio, and the errors cluster
on exactly the words that matter - names, products, reference codes. Keyword
boosting biases the decoder toward specific tokens at decode time. No training,
no model swap.

- Set `VOICE_ASR_HOTWORDS` for every caller, or use **Settings -> Boost these
  words** per browser. The two are merged.
- Capped at 40 terms (10-40 is the recommended range; past that the bias starts
  hurting ordinary words).
- Decoding is now greedy (`temperature=0`) - fastest path, and we are
  latency-bound on a live call.

### 3. Faster replies, without rushing the voice

The speech rate was **not** touched. The time was taken out of the waiting.

> A fixed silence timeout taxes your fast turns to protect your slow ones.

That is the whole problem with a single endpoint value, and it was the single
largest controllable delay in the pipeline. The base pause dropped **900ms ->
700ms** (the researched accuracy/latency sweet spot), and patience is now added
back only where it is needed:

| Situation | Wait |
|---|---|
| `yes` / `no` / `correct` / `thanks` | **~250ms** (was ~1600ms) |
| finished sentence, 4+ words | ~320ms |
| 8+ words, no punctuation | ~520ms |
| trailing `um`, mid-thought | +800ms |
| spelling out an email or code | +900ms |
| unfinished clause (`and`, `to`, `the`) | +850ms |
| pure filler | +1400ms |

A one-word confirmation used to be the *slowest* thing you could say. It is now
the fastest. The slider also goes down to 250ms.

On the model side, the prompt now asks for a **short first sentence** - it is
spoken aloud while the rest is still being generated, so a short opener directly
cuts time-to-first-audio - and bans throat-clearing preambles. It also teaches
digit-by-digit number reading (`94107` -> "nine four one zero seven") and tells
the model to punctuate properly, because commas and question marks are now
load-bearing: they become real breaths and real intonation.

### Tests

**743 assertions, all passing** (159 + 183 + 75 + 63 + 142 + 121). `test_prosody.py`
is new and covers contour, the emphasis cap, clause gaps, smoothing, the five new
emotions, the capture detectors, the endpoint arithmetic and the engine wiring.

---

## v6.3 - Real intonation (the emotion upgrade)

**What was wrong with v6.2.** The emotion layer knew a great deal about how a
sentence *should* sound - which words to stress, whether the pitch should rise
or fall, where to breathe. It then handed all of that to engines that cannot
change pitch. Kokoro and Piper expose speaking rate and nothing else. So a
rising question was rendered by speaking slightly *faster*. That is a tempo
trick, not intonation, and it is exactly why the result still sounded flat.

**What v6.3 does.** `engines/voice_fx.py` edits the waveform after the engine
has produced it, so intonation no longer depends on what the engine supports:

- **Terminal contour.** Questions genuinely rise, statements genuinely fall.
  Measured: a rendered question ends ~14Hz above where it began, a statement
  ends ~10Hz below.
- **Declination.** Pitch drifts gently downward across a sentence and resets at
  the next one. Every human language does this; a perfectly flat baseline is
  one of the strongest synthesis giveaways.
- **Word-level emphasis.** `Beat.emphasis` was computed in v6.2 and then never
  used, because no engine could act on it. It is now audible.
- **Jitter and shimmer.** Vocal folds never repeat a cycle exactly. Tiny
  frequency and amplitude fluctuation is present in all natural speech and its
  absence reads as machine.
- **One loudness target.** Every tier is normalised to the same RMS, so
  switching engines no longer changes how loud the agent is.

**Shifts stay small on purpose.** Pitch shifting distorts the vocal formants,
and pushed too far it produces the "Mickey Mouse" effect. Movement is clamped
to a few semitones - enough to hear, not enough to sound like a cartoon.

**How it is built.** Pitch shifting is resample-then-restore-duration. The
duration restore uses **WSOLA**: each output frame is chosen by searching a few
milliseconds either side for the segment that best continues what came before.
A naive overlap-add does not work here - it re-imposes the original period and
silently undoes the shift, handing back the frequency you started with. That
bug is now pinned by regression tests that assert measured F0.

**Cost.** ~5ms per sentence on one core. Turn it off with `VOICE_FX=0`, or
scale it with `VOICE_FX_STRENGTH` (0 = bypass, 1.0 = tuned default). If numpy
is missing, the input audio is returned untouched - prosody is a nicety and
never costs the caller their reply.

**Not applied automatically:** `voice_fx.prepend_breath()` is implemented and
tested but deliberately not wired in, because an audible breath before every
heavy sentence becomes a tic. It is there if you want it.

**Verified by:** `test_voice_fx.py` - 70 assertions, including measured F0 for
five pitch shifts, rise/fall/level contours, and the declination check.

---

## v6.4 - The call system, and the words-taker

### The bug that broke every call

`"Microphone stopped unexpectedly - click the mic to resume."`

This was not a browser problem or a flaky microphone. It was self-inflicted,
and it fired on **every** call at roughly the same moment.

`recognition.start()` throws `InvalidStateError` when the recognizer is
*already running* - which is the healthiest state it can be in. The old
`_restartRecognition()` treated any throw as a failure and incremented a retry
counter. Meanwhile the call-mode watchdog called that same function every 3
seconds, believing the comment that said it was "a no-op if already running".
It was not a no-op: it threw, every single tick. Eight ticks later - about 24
seconds into a completely healthy call - the counter hit its limit, printed
that message and switched the microphone off.

**The keep-alive was the thing doing the killing.**

The fix is to track the real state (`onstart`/`onend`) instead of inferring it
from an exception, treat "already running" as success, and never shut the mic
off mid-call - a second of dead air is better than hanging up on someone.

### The pipeline was stacked, not overlapped

Your diagnosis was right. The old order was strictly one-after-another:

```
you stop talking -> wait out the FULL pause timer -> only THEN start
uploading audio -> wait for the model -> think -> speak
```

The audio was already sitting in memory the whole time the pause timer ran, and
we did nothing with it.

Now the moment you pause, transcription starts **in parallel with the pause
countdown**. When the timer fires the words are usually already back, so the
recognition step costs close to nothing. If you carry on speaking, the
speculative result is discarded and the full turn is transcribed instead -
wasted work is much cheaper than wasted seconds.

Safety: the speculative transcript is used **only** if no new audio arrived
after it started (`_pendingAsr.n === _chunks.length`), so it can never answer a
half-sentence.

### Why capture was only "20% good"

Two causes, both fixed:

1. **The good transcript was being thrown away.** The ASR had a 1500ms
   deadline, measured *after* the pause had already elapsed. Whenever it was
   exceeded we silently fell back to the browser's transcript - the component
   that drops words. So the accurate recogniser was being paid for and then
   discarded, constantly. Because the clock now starts during the pause, the
   ceiling is 3000ms and costs nothing in the normal case.
2. **The recorder was starved at 32kbps.** Consonants live in the high
   frequencies that a low bitrate discards first, and consonants are exactly
   what a mis-transcription gets wrong. Now 48kbps - still a tiny upload.

**Verified by:** `test_capture_pipeline.py` - 34 assertions, including one that
fails if anything ever puts `stopListening()` back into the restart path.

---

## v6.5 - Matching what the leading voice agents actually do

This release came from reading how GPT-Realtime, LiveKit, Pipecat, Deepgram and
Cartesia actually build their agents, then closing the gaps that mattered.

### What they do that we now do too: preemptive generation

The single most valuable technique found. LiveKit describes it plainly:
preemptive generation "speculatively starts an LLM response before the user's
end of turn is confirmed" and it is **enabled by default**. Pipecat has an open
issue asking for the same feature. The reason is arithmetic - across the
industry the LLM is **60-70% of total voice-agent latency**, so it is the only
stage where a big win is still available.

v6.4 removed the ASR from the critical path by transcribing during the pause.
v6.5 does the same thing one stage further down: as soon as the speculative
words come back, the brain is already being asked - still during the pause
countdown. When you have genuinely finished speaking, the answer is often
already written by the time the turn commits.

**The safety rule that makes this acceptable**, and it is the same one LiveKit
applies: only the **brain** runs early. TTS never runs on a guess. A wrong
speculation is completely silent - it costs some tokens and is thrown away. It
can never produce a wrong word out loud, or a reply to half a sentence.

The guess is only used if the committed words match the guessed words after
normalisation (case and punctuation ignored, since those shift between the
interim and final transcript). Any mismatch falls straight through to the
normal streaming path.

Cost note: like LiveKit's, this increases token usage, because some
speculations are discarded. It is least favourable for long dictation and most
favourable for ordinary back-and-forth support conversation, which is what this
is built for. Set `PREEMPTIVE_BRAIN = false` in `static/app.js` to disable it.

### Where we deliberately differ from them

- **Cascaded, not speech-to-speech.** GPT-4o is genuinely end-to-end audio, and
  that is why it conveys tone so well. But the honest tradeoffs are cost,
  provider lock-in and debuggability, and every S2S option is paid. A cascade
  is also what Deepgram, Cartesia and most production agents still ship. Our
  constraint is free-tier and CPU-only, so cascade is the correct choice - we
  just refuse to let it be a *serial* cascade.
- **WebSocket/HTTP, not WebRTC.** LiveKit and Daily are right that WebRTC beats
  WebSockets for edge-to-cloud audio: UDP means a lost packet does not stall
  the stream. This is a real, known gap. It is a large architectural change and
  is recorded as future work rather than pretended away.

### Reference latency, for honesty

Published figures for a production cascade are **1.5-3s** end of speech to
start of audio; the natural-conversation target is **~500ms**. Speculative ASR
plus preemptive brain attack the two largest terms in that budget.

**Verified by:** `test_preemptive.py` - 35 assertions, including four that fail
if anything ever makes the speculative path speak.

---

## v6.6 - The mic message, again (and it was a different bug)

### Why it came back after v6.4 "fixed" it

v6.4 fixed the watchdog that was **killing** the call. It did not fix the code
that **prints the message**, and those turned out to be two different bugs.

The message was printed the instant the retry counter reached 8 - unconditionally,
with no check of whether the microphone was actually dead. And restarting the
recognizer legitimately throws several times in a row for a moment while Chrome
tears the previous session down. That teardown happens **exactly when you stop
talking and hand the turn over**, which is precisely when the user saw it.

So the sequence was: you stop talking (normal), Chrome closes the session
(normal), we retry a handful of times (normal), we recover successfully
(normal) - and then we told you your microphone had died. The microphone was
fine the whole time.

Now, when the counter trips, we wait, then check whether we already recovered.
If we did, we say nothing at all. If we really are dead, we silently re-acquire
the device and restart ourselves. The message only appears if self-healing has
genuinely failed - it is a last resort, not a first reaction.

### Latency: the base pause was too long

The pause before we answer was **700ms**. Published guidance is consistent that
**400-600ms** feels materially faster than the 800-1000ms defaults most agents
ship, with the perceived-quality knee around 600ms. The default is now **550ms**
- roughly a fifth of a second off *every single turn*, before any other work.

This is safe because the pause is adaptive, not fixed: hesitation, filler words,
spelling out, and dangling phrases all still add their patience back on top. A
short base buys speed on finished sentences without cutting off a hesitant one.
The slider in Settings still goes from 250ms to 2s if you want to tune it live.

### The three latency stages, honestly

| Stage | What we did | Where it now sits |
|---|---|---|
| You stop -> we commit the turn | 700ms -> 550ms adaptive | ~550ms, tunable |
| Words out of your audio | speculative ASR, runs during the pause | ~0ms in the common case |
| Brain writes the answer | preemptive generation, runs during the pause | ~0ms when the guess matches |
| Answer -> first audio | streams per sentence | first sentence only |

The stages that remain genuinely serial are the ones that cannot be guessed
ahead: if your words change the answer, the brain has to run for real.

**Verified by:** `test_preemptive.py` - now 48 assertions, 13 of them new and
dedicated to these two fixes.

---

## v6.7 - Streaming word capture (fast AND right)

### What was actually wrong

Capture was **batch**: the audio for a whole turn was uploaded only once you
stopped talking, and only then did any words exist. Nothing could start before
that. No amount of tuning fixes that, because it is the shape of the pipeline,
not a slow constant in it.

Now words are committed **while you are still speaking**. Say "I am..." and
those words are recognised, committed, and handed to the brain before you have
finished the sentence.

### Fast and right, not fast and wrong

This was the explicit requirement, and it is the hard part. Partial hypotheses
flicker - "i am" becomes "i'm", then "i am a". Printing every guess is fast and
WRONG, and it looks broken.

So we use **LocalAgreement-2**, the algorithm behind `whisper_streaming`: run
the recogniser repeatedly on a rolling window and only **commit** the leading
words that **two consecutive independent hypotheses agree on**. Agreement is
the confidence signal - a word that survives two passes is almost never revised
later.

That gives two classes of text:

| | Meaning | Used for |
|---|---|---|
| **Committed** | two passes agreed | sent to the brain, never retracted |
| **Tail** | still unstable | shown on screen only, may change |

Committed text only ever grows. A word that has been shown as committed is
never taken back.

### The trap we deliberately avoided

The obvious implementation - re-transcribe the whole turn every second - is a
documented disaster. The audio keeps growing, each pass costs more than the
last, and latency spirals (widely reported as 3s -> 10s -> 30s on CPU, ending
in dropped audio).

So the window is **bounded**: `LIVE_TAIL_CHUNKS` (~10s) of rolling tail, plus
chunk 0 - the container header, without which a webm slice cannot be decoded at
all. Cost per pass is **flat** no matter how long the caller talks. A `_liveBusy`
latch guarantees two passes can never overlap, which is how the spiral starts.

### On "the best free STT that runs on any CPU"

Worth being precise, because there are two different things here:

- **The model does not run on the caller's CPU.** It runs server-side
  (NVIDIA Parakeet via NIM, free tier). So a phone or a weak laptop is fine -
  that is what makes it work "on any CPU". Running a local model in the browser
  is what would break weak devices, not what saves them.
- **On accuracy, Parakeet-TDT-0.6B is the right pick and stays.** It leads the
  Open ASR leaderboard at ~6.3% WER, beating Whisper Large v3 - at 0.6B params,
  a fraction of the size.

**Moonshine v2** is the notable alternative and is genuinely built for this job
(50ms latency on Tiny, 5-15x faster than Whisper on-device, permissive
licence). It is the right choice if you ever want *fully offline* capture with
no server. It is not a straight upgrade here: it trades accuracy for latency,
and our latency problem was the *pipeline shape*, which is now fixed. Swapping
the model would have bought far less than streaming did.

**Verified by:** `test_preemptive.py` - 70 assertions, 22 new for streaming
capture, including ones that fail if the window ever becomes unbounded or if a
word is committed on a single unconfirmed pass.

---

## v6.8 - Latency you can actually see (P50/P95/P99)

### Why this matters more than it sounds

Every previous version guessed at latency. Guessing is how you end up
"optimising" the stage that was already fast. This version measures all four
stages of the pipeline and reports **percentiles**, because averages lie:
a service can show a healthy 400ms mean while one caller in twenty waits three
seconds, and the mean will never show it. In a voice agent the tail IS the
experience - the person who waits 3s is the one who decides the product is
broken.

`GET /api/metrics` now reports, for `stt`, `brain`, `tts` and `turn`:

```
voice_latency_ms{stage="brain",quantile="p50"} 412.0
voice_latency_ms{stage="brain",quantile="p95"} 1180.0
voice_latency_ms{stage="brain",quantile="p99"} 2310.0
voice_latency_count{stage="brain"} 1043
voice_latency_slow_total{stage="brain"} 7
```

**How to use it:** talk to the site for a few minutes, open `/api/metrics`, and
read the P95 row for each stage. The largest P95 is your bottleneck, and it is
now a fact rather than an opinion. `voice_latency_slow_total` counts calls over
2s - if that number climbs, individual callers are having a bad time even if
the averages look fine.

### Engineering notes

* **Stdlib only.** Metrics must never be the reason a deployment fails to boot,
  so `latency.py` imports nothing outside the standard library. A test asserts
  this and will fail if anyone adds a dependency.
* **Bounded memory.** Each stage keeps a rolling window of 512 samples, so
  percentiles describe how the service is behaving *now*, and memory is flat on
  a server that runs for months.
* **Thread-safe.** FastAPI serves from a threadpool; a test hammers the tracker
  with 8 concurrent writers and asserts not one sample is lost.
* **Never breaks a call.** Bad input is dropped rather than raised. The timer
  records even when the wrapped call *failed*, because a failure that took four
  seconds is exactly the latency worth seeing.

### A real bug this caught, in its own code

The first implementation computed the nearest rank with `round(pct/100*N + 0.5)`.
Python rounds halves to even, so `round(95.5)` is **96**, not 96 by accident -
every percentile was silently shifted up by one sample. P95 of 1..100 returned
96 instead of 95. Fixed with `math.ceil`, and there is now a regression test
named exactly "p95 of 1..100 is 95, not 96" so it cannot come back.

This is the point of the exercise: a metrics system that is quietly wrong is
worse than none, because you will trust it.

### Also fixed here: the test mirrors had drifted

The suites shipped inside the zip had fallen behind the ones used during
development - three of them still asserted the old 700ms endpoint that v6.6
lowered to 550ms. They were failing inside the package while development
reported green, because only four of the ten were being run in the release
smoke test. All ten mirrors are now synced, and the smoke test runs **all ten**.

**Total: 968 assertions across 10 suites, 0 failures.**

---

## v6.9 - Nothing is downloaded twice

You were right: launching re-downloaded things it already had. There were
**four** separate causes, not one.

### 1. pip was upgraded on every single launch

This line sat unguarded in all three launchers:

```
python -m pip install --upgrade pip
```

It ran **before anything else, every time you started the app** - a guaranteed
network round-trip on every launch, even when everything was already installed.
It now runs once, guarded by a `.venv/.vs-pip-upgraded` marker.

### 2. Packages already on your machine were invisible

The environment was created with a plain `python -m venv .venv`, which is
**sealed off from the rest of your system**. If you already had fastapi, numpy
or httpx installed, pip could not see them and downloaded a second private copy.
This is almost certainly what you noticed.

Now it is created with `--system-site-packages`, so anything already on your
device is **reused**, with an automatic fallback to a plain venv if that is not
supported.

### 3. One missing optional package re-downloaded the others

The old check was all-or-nothing:

```
if ! ( have edge_tts && have httpx ); then
    pip install "uvicorn[standard]" edge-tts httpx
```

If `edge-tts` was missing but `httpx` was fine, it reinstalled **all three**.
And if a package could never install (no internet, unsupported Python), it
retried the whole download **on every launch, forever**.

Now each package is probed independently, only the genuinely missing ones are
installed, and a hopeless optional install is remembered rather than retried
(delete `.venv/.vs-optional-failed` to try again).

### 4. There was no "already set up" memory

The launcher re-evaluated the whole dependency phase every time. It now writes
`.venv/.vs-setup-stamp` containing a hash of **both** requirements files plus
your Python version. On the next launch, if the hash matches and the core still
imports, the entire setup phase is skipped and you see:

```
Dependencies already installed - skipping setup (nothing to download).
```

**Zero network calls.** The app now starts fully offline once installed.

It still self-heals: if you edit a requirements file the hash changes and setup
re-runs, and if the app fails to import the stamp is deleted so the next launch
does a real repair pass.

### Controls

| Variable | Effect |
|---|---|
| `VS_FORCE_SETUP=1` | Re-run setup even if the stamp matches |
| `VS_SKIP_SETUP=1` | Never run setup (fully offline launch) |

Also: `--prefer-binary` is used so pip takes a prebuilt wheel instead of
compiling, `--no-cache-dir` is never used (a test enforces this, since it would
defeat pip's own download cache), and `logs/setup.log` is now appended to rather
than wiped on every launch.

**Verified by `test_startup.py` - 80 assertions**, including a live simulation
that runs the real stamp logic and asserts the second launch installs nothing.

**Total: 1,048 assertions across 11 suites, 0 failures.**

---

## v7.0 - The hidden stalls that made answers slow

You were right that something was still slowing answers down badly. The causes
were not in the voice code at all - they were **missing timeouts**. A network
call with no deadline is not "slow", it is a hang, and there were four of them.

### 1. The provider calls had NO timeout (the big one)

```python
r = await client.post(url, headers=headers, json=payload)   # no timeout!
```

This silently inherited the client default of **20 seconds**. Providers are
tried one after another, so if the first one stalled, you sat through 20
seconds of dead air before the second was even attempted. Every attempt now
carries its own short budget (**7s**, connect **3s**).

### 2. The NIM key rotation could stall for over a minute

The same untimed call sat inside a loop that retries up to **four** API keys.
Four keys x 20s = **80 seconds for a single answer**. Now bounded.

### 3. Streaming waited 30s for a provider that had gone silent

```python
async with client.stream(..., timeout=30.0)
```

Now a **read** timeout (6s), which is the important distinction: it measures the
gap *between tokens*, so every token resets it. Long answers stream perfectly -
only a provider that has actually gone quiet gets dropped.

### 4. Text-to-speech waited 30s per engine

With a seven-engine fallback chain, one hung engine held your reply for half a
minute before the next voice was tried. Now **10s** per engine with a **22s**
ceiling across the whole chain.

### Total budgets

Every retry loop now runs against a deadline, and each attempt gets
`min(its own budget, whatever is left)` - so timeouts can never chain together.
When the budget is spent the offline brain answers immediately, because a fast
local reply beats a perfect reply that arrives after you have given up.

| Path | Before (worst case) | After |
|---|---|---|
| Free providers | 20s per provider, unbounded chain | 7s per attempt, 12s total |
| NIM key rotation | ~80s | 12s total |
| Streaming | 30s of silence | 6s between tokens |
| Text-to-speech | 30s per engine | 10s per engine, 22s total |

**End-to-end worst case: over 100s -> under 40s**, asserted arithmetically by
the test suite rather than claimed.

### Tunable

`BRAIN_ATTEMPT_TIMEOUT`, `BRAIN_CONNECT_TIMEOUT`, `BRAIN_STREAM_READ_TIMEOUT`,
`BRAIN_TOTAL_BUDGET`, `VOICE_SYNTH_TIMEOUT`, `VOICE_SYNTH_TOTAL`. All are
clamped to safe ranges and can never crash the app, even if set to nonsense -
there is a test that feeds them garbage on purpose.

**Verified by `test_speed.py` - 57 assertions. Total: 1,105 across 12 suites, 0 failures.**

---

## v7.1 - Word capture: fast AND right

Your diagnosis was exactly right: v6.7 made capture faster and **less
accurate**. Three separate defects caused it, and the first one is severe.

### 1. It was uploading corrupt audio

```js
const parts = [_chunks[0]].concat(_chunks.slice(start));   // v6.7
```

That glued the WebM container header onto an **arbitrary mid-stream tail**.
Opus frames decoded without the frames preceding them are garbage, and the
container timestamps no longer line up either. Past roughly ten seconds of
speech, the model was literally being fed a broken file.

The critical part: **a speech model given corrupt audio does not return
nothing - it returns confident wrong words.** That is the "it hears them wrong"
symptom, precisely.

A partial window must always be a *genuine prefix* of the recording, so we now
only ever send chunks `0..N` - always a real, decodable file. Past a 40s cap we
stop speculating entirely and let the final pass do the work, because arriving
slightly later is infinitely better than being wrong.

### 2. Agreement "confirmed" its own mistakes

v6.7 committed a word once **two** consecutive passes agreed on it. But the
last words of a partial transcript have no right-hand context yet, so they are
exactly the ones a model gets wrong - and two windows cut at nearly the same
point produce **the same wrong guess**. The old code read that repetition as
confirmation. It was agreeing with itself.

Two fixes: agreement now requires **three** passes, and a **two-word holdback**
discards the unsettled tail so we only ever act on words that had real context.
If a new hypothesis contradicts what we already committed, we stop speculating
rather than doubling down.

### 3. The accurate transcript was computed, then thrown away

This is the one that made it feel like a downgrade. The final pass - which sees
the whole utterance with full context on both sides of every word - was
**overridden by the live guesses whenever they were longer**. The correct
answer was produced and then discarded in favour of a guess made from a
half-finished sentence.

Live text is now **speculation only**. It starts the brain thinking early (that
is the speed win, and it is kept), but the final full-audio pass is always the
source of truth. This restores the old accuracy - "right but slow" - while
keeping the new speed.

### Verified by execution, not by inspection

The v6.7 bug looked correct in review and behaved wrongly, so `test_capture_
accuracy.py` **extracts the real algorithm from `app.js` and runs it in node**
against known inputs, including the exact reported failure:

| Hypotheses | Old result | New result |
|---|---|---|
| `i want to buy a` x3 | commits `i want to buy a` | commits `i want to` |
| `call me tomorrow`, x2, `call me today` | commits `tomorrow` | commits `call me` |

**19 functional assertions. Total: 1,132 across 13 suites, 0 failures.**

Tuning lives in `static/app.js`: `LIVE_AGREE_PASSES` (3),
`LIVE_HOLDBACK_WORDS` (2), `LIVE_MS` (700ms), `LIVE_MAX_CHUNKS` (400).
Raising the first two buys accuracy at the cost of commit latency.

---

## v7.2 - Capture accuracy, round two

Three more causes of wrong words, found by auditing the whole capture chain
rather than just the algorithm.

### 1. It was transcribing its own voice (the big one)

`_liveTick` had no guard on `state.speaking`. While the agent talked, live
capture kept uploading windows and transcribing whatever the microphone heard -
and what it heard included **the agent's own speech leaking from the speakers**.

Browser echo cancellation is good but not perfect: on laptop speakers at volume,
with no headset, a real fraction leaks through. Whatever leaks gets transcribed
as if the user had said it. So the agent's own words were being injected into
the user's transcript - fluent, plausible words that the user never spoke. This
is the single most likely explanation for wrong words appearing mid-conversation
rather than at the edges of a sentence.

Live capture now pauses while the agent speaks. **Barge-in is unaffected**: the
VAD in `_vadLoop` listens independently and still cuts playback the moment you
start talking, and the guard opens again as soon as playback stops. The test
suite asserts the VAD loop does *not* consult `state.speaking`, so this fix can
never silently disable interruption.

### 2. Opus at 48kbps was blurring consonants

Vowels survive low bitrates; **consonants do not**. Sibilants and plosives are
exactly what distinguishes `sixty`/`sixteen`, `can`/`can't`, `fifty`/`fifteen` -
the classic mis-hear pairs. Raised to 64kbps mono, which is transparent for
speech and costs about 2KB/s more upload. Both suites that pinned the old value
now assert a **floor** instead of an exact number, so improving fidelity can
never again be reported as a regression.

### 3. Resampling was left to chance

ASR models including Parakeet run at 16kHz mono. `getUserMedia` now requests
`sampleRate: 16000` so the OS resamples with a proper anti-alias filter. It is a
hint - browsers that ignore it behave exactly as before, so it cannot break
capture.

### On speed

Audited and left alone deliberately. After v7.0's timeout budgets, the profile
is dominated by provider round-trips, not local work - and the honest way to cut
further is architectural (WebRTC transport + streaming ASR over a persistent
socket), not more tuning. Cutting the agreement passes would buy latency by
spending accuracy, which is the trade that caused this bug in the first place.
`/api/metrics` exposes real p50/p95/p99 per stage, so this is measurable rather
than guessed.

### What ElevenLabs and GPT-realtime actually do differently

Worth being straight about, because it explains the remaining gap:

- **GPT-realtime is a single speech-to-speech model.** OpenAI: it "processes and
  generates audio directly through a single model," which "preserves nuance in
  speech." A cascade like ours (STT -> LLM -> TTS) throws tone away at the first
  step - the LLM never hears that you sounded annoyed, only the words. No amount
  of tuning recovers that; it needs a different model class.
- **ElevenLabs v3 is also a cascade.** Their own interaction-models post
  describes an "advanced cascaded architecture" with in-house STT and TTS. So the
  cascade is not the thing holding us back - their *TTS* is.
- **Their expressiveness comes from audio tags**: `[laughs]`, `[whispers]`,
  `[sighs]`, `[curious]`, `[sarcastic]`. Their own docs warn effectiveness
  depends on the voice: "don't expect a whispering voice to suddenly shout."

We already do this, and our tag set (`laugh`, `chuckle`, `sigh`, `breath`,
`cough`, `whisper`, `gasp`, `clear throat`, `hmm`, `pause`) is deliberately
restricted to what Chatterbox Turbo and Fish S2 **actually support** - confirmed
again this round. Chatterbox Turbo (350M, ~75ms latency) natively supports
`[laugh] [sigh] [gasp] [whisper]`. Inventing richer tags would be worse than
useless: unsupported tags get either ignored or read aloud, which is the exact
"it said the word sigh" bug fixed in v6.1.

**So the emotion ceiling is not the tag layer - it is which engine is running.**
With Chatterbox or Fish installed, tags are honoured and the voice is genuinely
expressive. On the browser `speechSynthesis` fallback, tags are stripped and no
DSP can add real emotion. If emotion still sounds flat, check what the page
reports next to the mic: that one line tells you which tier you are hearing.

---

## v7.3 - Brain instructions, and the emotion bug nobody could see

### The bug: replies were being spoken with the WRONG feeling

`emotion.detect()` returned on the **first** cue that matched in `_CUES` order,
and `apologetic` sits first in that list. So:

```
"I can't wait to help!"   ->  matched apologetic cue "i can't"  ->  spoken SADLY
```

even though `can't wait` is an **excited** cue sitting further down the table.
Every short cue silently shadowed every longer, more specific cue below it.

This is why emotion could feel random: the tables were right, the tuning was
right, and the wrong emotion was still being chosen. No string-matching test
could catch it - the code *looked* correct.

Detection now scores by **specificity**: the emotion whose longest matching cue
is longest wins, because a longer phrase match is stronger evidence than a short
substring. `can't wait` (10 chars) beats `i can't` (7). Ties break on how many
cues matched, then on original table order, so nothing that was already right
changed. Verified by execution:

| Line | Before | After |
|---|---|---|
| `I can't wait to help!` | apologetic | **excited** |
| `I can't do that` | apologetic | apologetic (unchanged) |

### The brain now knows its input came from a microphone

This is the instruction that was most conspicuously missing, and it directly
addresses wrong words. Previously, if capture mis-heard something, the brain
confidently answered the nonsense and invented details to make it cohere -
turning one bad word into a whole wrong answer.

- **MISHEARD WORDS** - if a message is garbled, self-contradictory, or contains a
  word that clearly does not fit, ask one short natural clarifier ("Sorry, did
  you say Tuesday?") instead of guessing. Explicitly told **not** to be pedantic
  when one word is doubtful but the intent is obvious, and never to say
  "transcript" or "speech recognition" out loud - a human just says they did not
  catch it.
- **TURN-TAKING** - `mm-hm`, `yeah`, `okay`, `right` are acknowledgements, not
  new questions. If interrupted, **do not restart from the beginning**. Never
  repeat a sentence already spoken, never re-introduce itself. If the caller goes
  quiet mid-thought they are still thinking, so a brief "mm-hm" beats a full
  answer to half a question.
- **READ-BACK** - emails, reference numbers and spellings are read back slowly
  with commas and confirmed in the same breath ("so that's j, s, m, i, t, h at
  gmail dot com, is that right?"), spelling ambiguous letters as "m for Mike".
- **WAITING** - say "let me check that" out loud rather than going silent,
  because silence on a call reads as a dropped line.

The v6.1 stage-direction ban is asserted to have survived these additions, and
the prompt is asserted to stay under 6000 characters since it is sent on every
single turn.

### Tag discipline, now enforced by a test

Every emotion that carries a paralinguistic tag is checked against
`prosody.TAGS`, the set Chatterbox and Fish **actually support**. An invented tag
is worse than no tag: it is either ignored or read aloud, which is exactly the
"it said the word sigh" bug. This can no longer regress silently.

**`test_brain_instructions.py` - 73 assertions, 10 sections, executed rather
than pattern-matched. Total: 1,215 across 15 suites, 0 failures.**

---

## v0.0.32 - why capture was "sometimes right, sometimes wrong"

The version number is now `0.0.32`, by request. It is an honest number.

### The intermittency had two causes, and both were self-inflicted

**1. The browser's recogniser was allowed to overrule the accurate model.**
`_bestTranscript()` contained this rule:

```js
if (bw >= 3 && mw < Math.ceil(bw / 2)) return b;   // REMOVED
```

The intent was to catch a truncated upload: if the model returned far fewer
words than the browser heard, assume the model was cut off. The cure was worse
than the disease. The browser recogniser is a **completely different engine that
hears different words**, so this discarded the good transcript and substituted an
alternative one on nothing more than a word-count ratio. Terse but legitimate
speech - "yes", "tomorrow please", "the second one" - tripped it constantly.

That is the mechanism behind "sometimes right, sometimes wrong": two engines were
competing for the same turn, and a length heuristic picked the winner. The model
is now authoritative whenever it returns anything at all. The browser is a
fallback for silence, never a competitor.

**2. One 3-second deadline was shared by guesses and by the real answer.**
Speculative live windows and the final full-audio pass used the same
`TURBO_WAIT_MS = 3000`. For a guess that is correct - a late guess is worthless.
For the pass that decides what you actually said it is far too tight: a cold
model or a slow network blew the deadline, the accurate result was **thrown away
after being paid for**, and the browser's words were used instead. Fast network,
right words. Slow network, wrong words. Same sentence, same speaker.

So the two jobs now have two budgets:

| Budget | Value | Job |
|---|---|---|
| `LIVE_WAIT_MS` | 2200 ms | live guesses - must never pile up |
| `TURBO_WAIT_MS` | 3000 ms | speculative pass during the pause |
| `TURBO_FINAL_WAIT_MS` | 9000 ms | the authoritative pass - accuracy wins |

### Why this does not make it slower

This is the important part, and it is the answer to "I want both the quality and
the fast speed". The patient budget is **not** on the critical path. The reply is
already being warmed from the speculative transcript that started during your
pause, so the final pass usually returns long before its ceiling matters. The
9-second figure is a rescue ceiling for the slow tail, not a wait you will feel.
Nothing about turn detection, endpointing or synthesis timing changed here, so
this version should not be slower than v7.2 anywhere - it should simply stop
being wrong at random.

### Emotion: three reactions that were missing

| Emotion | Rate | Pitch | Tag | Why |
|---|---|---|---|---|
| `surprised` | 1.06 | +2.0 | `gasp` | a flat "I see" is the most robotic moment on a call |
| `grateful` | 1.00 | +0.7 | - | "thanks for your patience" read as generic warmth |
| `patient` | 0.92 | -0.5 | `breath` | "take your time" was being said at normal pace |

Every tag is still checked against what Chatterbox and Fish actually support.
The tag vocabulary was deliberately **not** expanded - an unsupported tag is
ignored or read aloud, which is exactly the old "it said the word sigh" bug.

### Four more brain instructions

- **CORRECTIONS** - accept a correction instantly, never defend the old answer.
- **ONE AT A TIME** - one question per turn; stacked questions silently lose the
  first one, because a caller can only answer the last thing they heard.
- **NO FILLER OPENERS** - no "Certainly!", no "Great question!". On a call every
  wasted syllable is dead air.

The prompt is 5,447 characters and is asserted to stay under 6,000, because it
is sent on **every single turn** and bloat there is latency everywhere.

### Tests

1,254 assertions across 14 suites, 0 failures. `test_capture_accuracy.py`
sections [7] and [8] lock in both capture fixes; `test_emotion.py` section [12]
covers the new reactions. One stale assertion in `test_turbo_capture.py` that
*required* the removed heuristic was inverted to forbid it.

---

## v0.0.33 - I read aloud what the engines were actually being handed

This round I acted as the tone tester: instead of reasoning about the voice code,
I executed it on realistic support sentences and inspected exactly what came out
the other end. Three defects fell out immediately, and one of them explains a
lot of the "it sounds broken" feeling.

### 1. THE BUG: a period inside a word was ending the sentence

`emotion.split_sentences()` split on `(?<=[.!?])\s+`. Correct-looking, and
wrong. Executed on a normal support reply it produced this:

```
"Dr. Smith approved approx. 20% off on order #1423. It ships Mon. at 5:30pm."

  BEFORE: ['Dr.', 'Smith approved approx.', '20% off on order #1423.',
           'It ships Mon.', 'at 5:30pm.']          <- 5 fragments
  AFTER:  ['Dr. Smith approved approx. 20% off on order #1423.',
           'It ships Mon. at 5:30pm.']             <- 2 real sentences
```

Every fragment was then treated as a whole utterance: it got its own **falling
final intonation**, its own **240 ms pause**, its own **independent emotion
reading**, and audio was **flushed mid-sentence**. The voice said "Dr." - pause,
full stop - "Smith approved approx." - pause, full stop. That is not an emotion
problem and no amount of emotion tuning could have fixed it, because the
sentence was being torn in half *before* any performance was applied.

Fixed with `speakable.protect_abbreviations()`, which hides abbreviation periods
behind a sentinel, splits, then restores them. It also protects decimals
(`2.5`) and initials (`J. Smith`). Applied in all three splitters:
`emotion.split_sentences`, `base.split_sentences`, `prosody.split_for_streaming`.

**My first attempt at this fix only half worked** and the test caught it: I
protected only the never-expand list, so `approx.` and `Mon.` still split,
because the planner runs on raw model text that has not been normalised yet.
Both tables are protected now.

### 2. "Wrong written things" - the text was written for the eye, not the ear

Every engine was fed raw model output. New `engines/speakable.py` normalises it
in `clean_text()`, which is the one function every engine already calls:

| Written | Was heard as | Now |
|---|---|---|
| `$45.99` | "dollar forty five point nine nine" | "45 dollars and 99 cents" |
| `3-5 days` | "three **minus** five days" | "3 to 5 days" |
| `1-800-555-0199` | a string of minus signs | "1, 800, 555, 0199" |
| `24/7` | "twenty four **slash** seven" | "24 7" |
| `20%` | "twenty percent **sign**" | "20 percent" |
| `#1423` | "**hash** 1423" | "number 1423" |
| `care@example.com` | "care **at sign** example…" | "care at example dot com" |
| `1,250 EGP` | "one, two hundred fifty…" | "1250 Egyptian pounds" |
| `Dr.` / `approx.` / `Mon.` | "drr" / "approx" + a false stop | "Doctor" / "approximately" / "Monday" |

Rules: only unambiguous rewrites, never invent words, and **idempotent** -
asserted, because `clean_text` runs at more than one layer.

A bug in my own regex, caught by executing it: `1-800-555-0199` came out as
"1 **to** 800" because the phone pattern demanded 3+ leading digits, so the
range rule matched the country code first. The pattern now allows a 1-4 digit
leading group.

### 3. Speed: the first chunk is the only one the caller waits for

`split_for_streaming` required 60 characters before **any** chunk could be
spoken, including the first. A reply opening with a short sentence sat in the
buffer waiting for the *next* sentence to arrive before a single sound was
produced - dead air at the worst possible moment, right after you stop talking.

The first chunk now has a 12-character floor; later chunks keep 60, because once
audio is playing, larger chunks sound smoother and the buffer is already ahead.
A sentence is still never broken to hit the floor.

```
"Sure, one moment. Your refund is on its way and should arrive in 3-5 days."
  BEFORE: one chunk  - nothing spoken until the whole reply was ready
  AFTER:  ['Sure, one moment.', 'Your refund is on its way ...']
```

My first value here was 24, which still failed: "Sure, one moment." is 17
characters. Executing it is what showed the number was wrong.

### Tests

1,298 assertions across 16 suites, 0 failures. New `test_speakable.py` (44
assertions, 10 sections) is **executed, not pattern-matched**, because this class
of bug is invisible to a source search - the code looked right.

### What did NOT change, and why

- **No speech-rate change.** Your standing instruction is that speed comes from
  the pipeline, not from making the voice talk faster. Time-to-first-audio is a
  pipeline win; the voice speaks at the same pace.
- **No new emotion tags.** Still limited to what Chatterbox and Fish actually
  support, still test-enforced. An unsupported tag is ignored or read aloud.

---

## v0.0.35 - Pocket TTS repaired, and emotion that survives real wording

This round was driven by running the code rather than reading it. Four real
bugs, two of them in the "why does it sound flat?" category.

### 1. Short replies had NO emotion at all (Pocket TTS and Kokoro)

Both engines gated their entire expressive path behind:

```python
if len(beats) > 1:      # <- only multi-sentence replies
```

A one-sentence answer fell through to a path whose only expressive control is
tempo. Neither Piper nor Kokoro exposes pitch control, so those replies had no
terminal contour, no declination, no emphasis, no emotional pitch offset and no
micro-instability - they were literally flat. Short replies are the majority of
what a support agent says, and the brain is instructed to answer concisely, so
this was the common case, not the edge case. Now any planned beat gets the full
performance; a single sentence simply gets no silence after it.

### 2. "I am really sorry" was scored as NEUTRAL (affects EVERY mode)

The emotion cue table was rigid literal substrings. `"i am sorry"` was present,
but could not match **"I am really sorry about that delay."** because an adverb
sits between "am" and "sorry". The more emotive the wording, the more likely it
was missed - emphasis is exactly where people add adverbs.

This reached every mode, not one: all engines get emotion through
`emotion_params()` / `overall()`, so a miss removed rate, pitch, volume,
contour, pauses and performance tags everywhere simultaneously.

Multi-word cues now tolerate a **closed list** of intensifiers between their
words (`really`, `very`, `truly`, `so`, ...). Deliberately not a wildcard:
`(?:\s+\w+)*` would let `"i can't"` match `"I can't wait to help"`, which is the
exact bug fixed in v7.3. Cost measured at **0.039 ms per sentence**. The
apologetic cue set also gained the forms real agents use (`sorry about`,
`sorry for`, `our mistake`, `we regret`, ...).

### 3. Pocket TTS could emit SILENCE with no error

`requirements.txt` pins `piper-tts>=1.2.0`, which is unbounded, and the API
moved. In piper-tts 1.3+, `synthesize()` became a *generator* of audio chunks
and the wav writer is `synthesize_wav(...)` with speed carried in a
`SynthesisConfig`. The old code called `synthesize(text, wav, length_scale=...)`,
caught the `TypeError`, then retried `synthesize(text, wav)` - which on 1.3+
returns a generator, writes nothing, and produces an empty wav. No exception,
nothing in the log, just a voice that never speaks. `_synth_wav()` now tries the
modern writer first, falls back to the legacy call, drains a generator if it is
handed one, and raises loudly if a build exposes no usable call at all.

### 4. Pocket TTS hardcoded 22050 Hz

The expressive path generated silence gaps at 22050 and declared the result
22050, while the fallback path correctly read the rate from the model. Piper's
`low`/`x_low` voices run at **16000 Hz**, so installing one produced gaps of the
wrong length spliced onto 16 kHz speech, played back at the wrong pitch and
speed. The real rate is now read from the voice.

### 5. A "breath" that was never a breath

Both engines appended `silence_wav(clause_gap)` **after** the finished sentence,
under a comment claiming it made the voice breathe inside the sentence. It sat
on top of `pause_after_ms`, so it was just up to 150 ms of extra drag per
sentence - doubling a pause the neural model already produces at a comma by
itself. Removed. The planner still exposes `clause_gaps` for engines that can
place them properly.

### 6. `patient` was planned but never rendered

Added in 0.0.32 with a deliberately slow rate and lowered pitch, but never
added to `voice_fx._HEAVY`, so it never received the grounded delivery the other
slow emotions get. It was planned as patient and rendered as neutral.

### Tests

New `test_pocket_tts.py` (91 assertions) **executes** the fixed paths: it drives
`_synth_wav` with fake objects imitating each piper-tts API generation -
including the generator shape that used to yield silence - and calls
`detect()`/`plan()` on real support sentences instead of grepping source.

One stale assertion in `test_prosody.py` was corrected, not worked around: it
asserted only that the string `clause_gaps` appeared in each engine, which
enshrined the fake-breath defect. It now asserts the artificial tail gap is
absent and that real inter-sentence silence and the prosody chain remain.

**18 suites, 1,436 assertions, all green.**


---

## v0.0.35 - Pocket TTS and Kokoro were literally flat

One gate caused it: `if len(beats) > 1:` wrapped the ENTIRE expressive path in
both engines. A one-sentence reply produces exactly one prosody beat, so a
short reply - which is most of a customer-service reply - got **no prosody
rendering at all**. Neither engine has native pitch control, so the output was
flat by construction. Changed to `if beats:`.

Also fixed in that pass:

- Pocket TTS hardcoded 22050 Hz in the expressive path while the low/x_low
  voices are 16 kHz - wrong sample rate means wrong pitch and wrong speed.
  Now read from the voice via `_voice_sr()`.
- piper-tts 1.3+ turned `synthesize()` into a generator, so the old call wrote
  **nothing and raised nothing**: silent audio. `_synth_wav()` is now
  version-agnostic and raises if it produced no samples.
- `emotion.detect("I am really sorry about that delay.")` returned `neutral`,
  because an intensifier between the words broke the cue match. This affected
  EVERY mode, not just Pocket TTS.
- A fake "breath" was being appended AFTER the sentence rather than inside it.
  Removed, not reimplemented.

## v0.0.36 - the agent was transcribing itself

Reported as "it is hearing what the ai told me and repeating it again in the
chat". This was real, and the earlier fix for it was incomplete: it guarded the
model path only. There were **two** leaks.

1. **The browser recognizer was never gated on playback.** Worse, it appended
   finals into the turn buffer *before* anything judged them. Speaker bleed into
   the microphone is made of real words, so it passed every filter and was
   submitted as the user's next turn.
2. **The recorder kept recording during playback**, so the agent's own voice was
   inside the audio blob uploaded to the ASR model - and the model result
   outranks the browser transcript, so the agent's words *won*.

Echo rejection now compares what the microphone hears against what we are
currently saying, using this-event words only, and is consulted **only during
playback**. Single words are never auto-rejected, so "stop" and "wait" still
interrupt.

## v0.0.37 - capture latency: the serial fallback chain

The ASR fallback chain was **serial**. Try model 1, wait up to the full 12
second timeout, and only then try model 2. One cold, slow or rate-limited model
cost the user up to 12 seconds of silence before an alternative was even
attempted. That is a large part of "the word capturing is slow", and it is also
why it sometimes "writes nothing at all".

Requests are now **hedged**: attempts are staggered by ~0.65s and race each
other, first usable transcript wins, losers are cancelled. When the primary is
healthy it wins outright and the backup never fires, so hedging costs nothing in
the normal case. Verified by executing the real race against fake transports:
**a dead primary now costs under 2 seconds instead of 12.**

Accuracy is deliberately not traded away for that speed. If a backup answers
first, the primary still gets a short bounded grace period (~0.4s) to land and
override it, because chain[0] is the most accurate model.

**The default model changed from Parakeet-TDT to Nemotron 3 ASR Streaming.**
Parakeet is an excellent *offline* model, which is why it was chosen, but the
streaming numbers decide it for a live microphone:

| | streaming WER | BSF | latency |
|---|---|---|---|
| Nemotron 0.6B (cache-aware FastConformer-RNNT) | 7.28% | 1.03 | 80 ms chunks |
| Parakeet TDT / Canary | nearly doubles | >= 1.74 | ~4x higher |

BSF is the batch-to-streaming factor. A model at BSF 1.74 gets much worse the
moment you stop feeding it one whole clean utterance - which is exactly what a
live microphone does. Nemotron also emits punctuation and capitalisation
natively. Parakeet, Canary and Whisper are all retained as fallbacks.

A 429 on one model is no longer treated as fatal for the whole turn, since NIM
rate limits are per-model and another model on the same endpoint can answer.
A bad key (401/403) still aborts immediately, because it is bad for every model.

New knobs: `VOICE_ASR_HEDGE_DELAY` (0 disables hedging),
`VOICE_ASR_HEDGE_MODELS`, `VOICE_ASR_PRIMARY_GRACE`.

## v0.0.38 - hidden-con audit of the new hedged capture path

The hedged ASR race landed in v0.0.37. This version audits it, because new code
is where new bugs live. Three real problems were found and fixed.

**1. Losing attempts were cancelled but never awaited.** `asyncio` delivers a
cancellation at the next await point, so a cancelled request can still be inside
the socket after we have walked away. On a *shared* pooled HTTP client - which is
exactly what we use, and we hedge on every slow turn - that risks handing the
next caller a connection with an unread response body still in it, plus Python
warnings about results that were never retrieved. `_drain()` now cancels **and**
awaits (`asyncio.gather(..., return_exceptions=True)`). A test proves the
cancellation is genuinely delivered into the request coroutine before `_race`
returns, and that it costs no measurable time.

**2. The accuracy grace period was being spent on models that could not win.**
Only the primary model is allowed to override a backup's transcript. But if the
primary had already failed (a 429, a dead socket) and only a *third* model was
still in flight, the code still burned the entire grace window - up to 400ms of
dead air added to precisely the turns that had already gone wrong. The grace is
now granted only while the primary is genuinely still running. Measured: that
case now returns in under 0.55s instead of waiting out a 1.0s grace, while a
live primary still overrides the backup as designed.

**3. A loaded gun in the brain's streaming retry loop.** A
`finally: if owns_client: await client.aclose()` block sat *inside*
`for attempt in range(3)`. It was dead code today (`owns_client` is hardcoded
`False` there), which is why it never bit - but if anyone had ever made that
function own its client, attempt 1 would have closed the client and attempts 2
and 3 would have failed on a closed transport, turning a single rate limit into
a total failure. Removed, with the invariant written down: that function must
never close the shared warm client, because other callers are using it
concurrently. A test now pins it shut.

`test_hedged_asr.py` grew from 56 to 71 executed assertions.

## v0.0.39 - the cache was capable of confidently telling customers the opposite of the truth

This version is a continued hidden-con hunt. The instant-answer cache is the
fastest path in the product - under a millisecond on a repeat question, and it
spends none of your free rate limit. That makes it valuable, and dangerous: a
cache that returns a plausible-but-wrong answer is far worse than one that is
merely slow. Two real wrong-answer defects were found by probing it, both of
which would have hit a live customer.

**1. Word order was completely invisible.** Matching is done on a token *set*,
which has no idea what order the words arrived in. So these two questions were
literally identical to the cache - similarity 1.0:

    can i exchange the small one for the large one
    can i exchange the large one for the small one

The second was served the first one's answer. Direction is everywhere in
customer service: exchange X for Y, transfer A to B, upgrade from P to Q,
convert dollars to euros. A shared answer must now also agree on adjacent
word pairs (`_MIN_BIGRAM = 0.5`).

**2. Negation was treated as a filler word.** `are you open on sunday` and
`are you NOT open on sunday` scored 0.67, which the deliberately
length-tolerant matching rule accepted - because to a token set, `not` looks
exactly like the harmless extra word that rule was designed to forgive. Two
questions must now agree on negation exactly (`_POLARITY`, a closed list of 25
words including `never`, `without`, `unless`, `cannot`).

**Crucially, this is not a downgrade of the cache.** A guard that blocks every
match would be worse than the bug. All the genuine repeat questions still hit:
filler-word rephrases (`tell me the opening hours`), inserted articles, trailing
politeness, case and punctuation differences. That is enforced by
`test_cache_safety.py`, which is a new suite of 43 executed assertions covering
reversed direction, negation, the must-still-hit cases, the pre-existing guards,
tenant and persona isolation, and one-word edge cases.

Also verified as already correct during this audit, so nobody has to re-check
them: answers never leak between sites or personas, the scope hash is not
reversible to the system prompt, personal questions (`where is my order`),
time-sensitive questions (`are you open today`), order numbers and any follow-up
with conversation history are all correctly refused by the cache, and the server
checks `is_cacheable()` *before* every lookup rather than only before storing.

## v0.0.40 - emotion stops being a feature of two engines and becomes how the product speaks

This version addresses "I don't think there is emotions at all" honestly,
because that complaint was **correct** - and the reason was structural, not a
matter of tuning. Before writing any code, every engine was surveyed for what it
actually did with emotion. The result:

    piper       per-sentence plan + full prosody DSP   <- expressive
    kokoro      per-sentence plan + full prosody DSP   <- expressive
    fish        ONE flat emotion for the whole reply
    chatterbox  ONE flat emotion for the whole reply
    edge        ONE flat emotion for the whole reply   <- AND THIS IS THE DEFAULT
    magpie      no emotion at all
    best        no emotion of its own
    human       no emotion of its own

Six of eight modes had little or no expression, and the two that did were not the
ones most people hear. A single rate/pitch/volume applied to an entire reply is
precisely the classic robot tell: nothing moves *while the agent is talking*.

### The shared performance layer: `engines/expressive.py`

Emotion now lives in one place that every mode uses, so it can never again be
true that improving expression means improving one engine. It provides:

* **Per-beat parameters** - each sentence gets its own tempo, pitch centre,
  loudness and terminal contour.
* **An emotional arc** - the intensity itself changes across a reply, so the
  reply has a *shape* instead of a constant level. A person opens slightly
  stronger and settles as the thought closes; measured multipliers for a
  three-sentence reply are `1.157, 1.009, 0.86`. This was missing even from
  piper and kokoro, which had per-sentence emotion but hardcoded `intensity=1.0`
  for every beat.
* **Deviation scaling** - turning expressiveness down lands on a normal voice,
  never on a whisper or a chipmunk, because what gets scaled is the distance from
  neutral rather than the absolute value.

### The default mode is now a real performance, and it is not slower

Edge used to send the whole reply as one request with one setting. It now sends
**one request per sentence**, each with its own rate, pitch and volume - and the
requests are issued **concurrently**, so a three-sentence performance costs about
the same wall-clock time as the one flat request did. This is the rare change
that makes the voice more human *and* not slower. The sync entry point was also
folded into the async one, because it had quietly become a second, flatter code
path.

Fish and Chatterbox now receive a tag **per sentence** instead of one tag for the
whole reply, so an answer that moves from apology to reassurance to good news is
performed that way. Crucially, the tags come from exactly the same vetted
vocabulary as before - inventing tags a model does not recognise is what made an
earlier version read the word "sigh" out loud.

### Failure behaviour, stated plainly

If planning fails, if any single sentence fails, or if `VOICE_EXPRESSIVE=0`, the
engine falls back to its original flat single-shot path. **Half a reply is worse
than a flat one**, so a partial performance is always discarded rather than
shipped. Emotion is an enhancement and is never a reason to lose the voice.

### New knob

    VOICE_EMOTION_ARC=0.35   # 0 = the old constant level, 1.0 = maximum shape

### Verification: `test_expressive.py`, 92 executed assertions

"We added emotions" has been claimed before while the default mode was still
flat, so nothing in this suite is a source-code opinion poll. It **executes** the
arc, the per-beat parameters, the real stitched audio through the real DSP, and
the Edge per-sentence request path against a fake network - no key, no internet
and no speakers required. It proves, among other things, that Edge sends one
request per sentence, that those requests carry *different* prosody, that they
**overlap in time** rather than queueing, that the pauses are real silence rather
than a spoken word, that a failed sentence falls back to a complete flat reply,
and that no invented tag can ever reach a model.

## v0.0.41 - the multi-tenant memory bug, and two hidden costs in my own new code

Three real findings, one of which would have looked like the AI being stupid
rather than a bug, plus one suspicion that turned out to be wrong and is recorded
as wrong.

### 1. One site could delete another site's live conversation (real, proven)

`sessions.py` had exactly one bound: a global cap on live sessions, evicted
oldest-first. Isolation was assumed because keys are namespaced per tenant - but
namespacing only stops history from LEAKING, it does nothing about CAPACITY. With
one shared pool, the busiest site takes the whole store, and a quiet site's
session gets evicted mid-call.

Proven with a probe before touching anything:

    vip history before flood: [{'content': 'my order is 12345'}]
    vip history after flood : []
    VERDICT B: BUG - one tenant's flood destroyed another tenant's session

This is the worst kind of bug in a customer-service product, because it has no
error message. The customer asks a follow-up question, the agent has silently
forgotten the order number, and it reads as a dumb model instead of an evicted
cache entry.

Capacity is now fair-shared. Every tenant gets its own allowance and a tenant at
its allowance evicts **its own** least-recently-used session, never a
neighbour's. If the global cap is still reached, eviction takes from the
**largest** tenant, so the heaviest user of the box pays for the overflow instead
of the smallest. All removals now go through one function, so the per-tenant
index cannot drift out of step with the data.

### 2. My own per-sentence synthesis had unbounded fan-out (real)

The v0.0.40 expression upgrade issued one request per sentence, all at once. That
is what made it fast, and it was also a hazard I shipped: a 10-sentence reply
opens 10 sockets, and 50 concurrent callers open around 500. A shared TTS
endpoint answers that with rate-limits and connection resets - an expression
upgrade quietly becoming an outage under exactly the load this product is for.
Fan-out per reply is now capped (`VOICE_EXPRESSIVE_MAX_PARALLEL`, default 4),
which keeps essentially all of the latency win, because the early sentences are
the ones the listener is waiting on.

### 3. One flaky sentence cost the listener the whole performance (real)

Also mine: if any single beat failed, the entire reply was thrown away and
re-synthesized flat. A momentary blip therefore cost **two** full round trips AND
the emotion. Now the failed sentence alone is retried once; only if that fails
does the reply fall back to flat. The guarantee being protected was never "must
be flat" - it was **"must never be truncated"** - and that still holds, verified
with a permanently-failing sentence.

### 4. A suspicion that was wrong, recorded as wrong

I expected the session store to hit a latency cliff at capacity, since eviction
sorts the store. Measured: **0.194 ms per append at capacity vs 0.205 ms below
it** - no cliff, because eviction is rare and dictionaries that size sort fast.
No change made. A guess is not a finding until it is measured.

### Verification

New `test_sessions.py` (39 executed assertions) covers tenant isolation, the
fairness rule, LRU victim selection, TTL slot release, index consistency,
copy-on-read, and 6 threads of concurrent traffic. `test_expressive.py` grew to
102, now including the fan-out cap under a live in-flight counter and both
retry paths. Totals: **22 suites, 1,741 assertions, zero failures**, run against
a fresh extract of the shipped zip.


## v0.0.42 - the 4-7 second gap was a `await`, not a slow model

The reported problem was "it takes 4-7 seconds to write what I told the AI, and
then the AI waits before reading it, like it waits intentionally." That last
observation was correct, and it was not a figure of speech: the code was
waiting on purpose.

`_submitTurn` had the browser's transcript of the turn in hand, in a local
variable, and then did this:

```js
_turboTranscribe(audio, TURBO_FINAL_WAIT_MS).then((better) => {
  handleUserText(_bestTranscript(better, utter));   // 9000 ms ceiling
});
```

`handleUserText` is what draws the words on screen, pushes history, and asks the
brain. So *nothing at all happened* - no text, no thinking - until the audio had
been uploaded and the speech model had answered, with a ceiling of **9,000 ms**.
On a slow upload the whole pipeline serialised into visible dead air while the
words were already known.

This came from a real fix. In v0.0.32 the browser transcript was overriding the
model and locking in wrong words, so the rule became "the model always wins".
That rule is right for **accuracy** - but it was implemented as "nothing happens
until the model replies", which is a **latency** decision. Two different
requirements were being served by one piece of code, and the slow one won.

They are now separated:

* `DISPATCH_BUDGET_MS = 650` - how long a turn may wait for the better
  transcript. Fast ASR normally lands inside this, so in the common case the
  model still decides the wording and accuracy is completely unchanged.
* `TURBO_FINAL_WAIT_MS` dropped from 9,000 to 2,500 and is now only an **abort
  ceiling for a hung socket**, never a wait a caller experiences.
* If the budget expires, the caller is answered *immediately* from the words we
  already have, and `_lateCorrect` quietly fixes the transcript on screen when
  the model catches up. It never re-speaks and never re-asks the brain -
  swapping words mid-sentence would be worse than a corrected line of text.

Two suites had assertions demanding the old patience (`final_ms >= 7000`, and
"the final budget is more patient than a speculative one"). Those assertions
were **encoding the bug**. They were replaced with the contract that actually
matters - the *perceived* wait is short, the ceiling only kills hung sockets,
and a late transcript is corrected rather than lost - plus checks that the
correction path cannot speak.

### Setting up the local voices (and why emotions can feel absent)

Every emotion feature here - per-sentence performance, the emotional arc, the
prosody DSP, pauses - runs on a **neural** voice. With no neural voice
installed, the app falls back to the browser's built-in `speechSynthesis`, which
has **zero emotion support**: the emotion is computed and then discarded at the
last step, and the result sounds flat no matter how good the engine is.

```
python setup_voices.py            # both engines
python setup_voices.py --piper    # Pocket TTS only (~63 MB, fastest on CPU)
python setup_voices.py --kokoro   # Kokoro only (~330 MB, most natural)
python setup_voices.py --check    # report what is installed
```

No GPU, no API key, no account. Files land in `models/piper` and
`models/kokoro`, which is exactly where the engines look - restart the server
and the engine reports itself available. Downloads use mirrors and verify a
plausible file size, because a truncated model otherwise fails much later with
a confusing synthesis error instead of failing here.

If the line under the microphone says *"browser fallback voice - no emotion
support"*, that is the single reason the agent sounds robotic, and this command
is the fix.


## v0.0.43 - I broke capture in v0.0.42, and the test that would have caught it was one I had deleted

Reported: "too slow in capturing the words said" and "it became not able to hear
me or capture any words at all". The second half was a regression I introduced
one version earlier.

In v0.0.42 I dropped `TURBO_FINAL_WAIT_MS` from 9000 to 2500, describing it as
"only an abort ceiling for a hung socket". That was wrong, and the code I wrote
in the same version is what proves it:

```js
if (!heard) {              // the browser recogniser produced NOTHING
  asrPromise.then(...)     // the server ASR is now our ONLY source of words
}
```

On that path there is no browser transcript to fall back to, so the upload must
be allowed to finish. A cold NVIDIA ASR request regularly exceeds 2.5 s, so the
abort fired, the result was empty, `handleUserText("")` returned immediately, and
**nothing appeared on screen at all**. Anyone without working browser speech
recognition lost capture entirely.

The assertion that would have caught this was `final_ms >= 7000` - which I
deleted in v0.0.42 as "encoding the bug". Part of it was: patience in the
*dispatch* was the bug. But that same number also protected the ASR-only path,
and I removed both meanings at once.

### What changed

* `TURBO_FINAL_WAIT_MS` restored to 9000, documented as an abort ceiling that
  **must stay generous** because the ASR-only path depends on it.
* `DISPATCH_BUDGET_MS = 650` is unchanged - the perceived wait stays short. The
  v0.0.42 speed fix is intact; only the ceiling was wrong.
* The ASR-only path no longer waits the full ceiling when it doesn't have to: if
  the live pass already recognised words, the caller is answered at the normal
  budget and the model corrects the wording afterwards. That addresses the
  "capturing is too slow" half of the report for exactly the users who were hit
  hardest.
* Total model failure can no longer produce silence: live text is used as a last
  resort rather than dropping the turn.

### New suite: `test_dispatch.py` (38 executed assertions)

This path has now broken twice while every structural assertion passed, because
"the function contains the string `_bestTranscript`" cannot tell you whether a
caller ever gets answered. So this suite lifts the real `_dispatchTurn`,
`_raceBudget`, `_lateCorrect`, `_bestTranscript` and `_normKey` out of `app.js`,
runs them in **node** against fake promises and timers, and asserts on observed
behaviour: who was answered, with which words, and after how many milliseconds.

Nine scenarios, each proving the one rule - **no path may leave the caller
unanswered**: fast model, slow model, rejected model, empty model, no upload
available, ASR-only (the v0.0.42 regression), ASR-only with a slow model plus
live text, and two total-failure rescues. It also measures that the slow-model
case is answered near the budget rather than at the model's latency, and that
the late correction updates the transcript without re-speaking.


## v0.0.44 - the agent was quoting itself, and the echo guard was on exactly one of four paths

Three reported problems, three located causes.

### 1. Call mode repeated the agent's own words as the caller's turn

"if it said that is it okay it writes again as if i am the one who told it".

`_rejectEcho` was called from **exactly one place** in the whole file: the browser
recogniser's `onresult` handler. Every other route into the conversation - the
server ASR transcript, the live-capture text, the late correction - went straight
to `handleUserText` with no echo test whatsoever. In call mode the microphone
never closes, so the agent's own sentence is recorded, uploaded, and transcribed
perfectly by NVIDIA ASR. It then entered the conversation as the caller's words.

There was a second layer underneath it. `_submitTurn` calls
`_forgetAgentSpeech()` at the start of every turn, which empties `_agentSaid` -
and `_looksLikeEcho` returns `false` immediately when that buffer is empty. So
even adding a guard to the async paths would have done nothing: by the time the
transcript came back, the memory of what the agent had just said was gone.

Fixed by:

* snapshotting `const echoRef = _agentSaid` **before** the turn is reset, and
  threading it through `_dispatchTurn` / `_lateCorrect`;
* `_looksLikeEchoIn(text, ref)` - the same 60% overlap test, but readable against
  a snapshot instead of only the live buffer;
* **`_answer(text, echoRef)` is now the only way any turn reaches the brain.**
  Four call sites funnel through it, so the guard cannot be forgotten on a new
  path again - which is precisely how this bug was introduced.

### 2. Asking for clarification when it had heard correctly

The `MISHEARD WORDS` rule told the model its input could contain words the caller
never said, and it over-applied it. Added `DO NOT OVER-CLARIFY`: answer when the
intent is clear, never ask about a detail you do not need, never ask the same
thing twice, at most one clarifier in a whole conversation.

### 3. The voice changed mid-conversation

`server.py` builds `candidates = [req.mode] + _FALLBACK_ORDER` **per request**, and
the client synthesises **one sentence per request**. So a single failed sentence
was silently spoken by a different engine in the middle of a reply. The client
now pins the engine that actually produced audio (`state.pinnedEngine`, keyed to
the selected mode so changing mode invalidates it) and requests that engine
explicitly, sending `voice: null` when pinned to a different engine because a
voice name only means something to its own engine.

### Also

* `IMPORTANT DETAILS` rule: an email address, phone number, name or reference is
  read back **once**, spelled out letter by letter and digit by digit, briskly,
  with "is that right?" in the same breath - then treated as settled and never
  asked for again.
* The ASR-only path answers at the 650 ms budget when live text exists instead of
  waiting for the upload, which is the remaining "capturing is too slow" case.

### `test_dispatch.py` 38 -> 46 executed assertions

Six new scenarios run in node: the model transcribing our own voice, the browser
transcript being our own voice, live text being our own voice, a late correction
carrying our own voice - all four must be **dropped** - plus a genuine turn and a
two-word barge-in that must still get through while echo memory exists.

## v0.0.47 - every sentence had seven holes punched in it, and the rhythm was computed but never rendered

This round went at the complaint that has outlived every other one: the voice is
robotic. Two causes were found by measuring the actual waveform, not by reading
intentions.

**1. Every sentence, from every engine, had dropouts in it.** WSOLA cannot emit
its final partial frame, so `pitch_shift()` filled the shortfall with
`np.pad(..., zeros)` - digital silence. `pitch_ramp()` calls `pitch_shift()` once
per segment, so a 7-segment intonation glide punched **7 holes of ~22.7ms, 164.8ms
of a 2.4s sentence**, on every reply, in Piper, Kokoro, and everything routed
through the FX chain. Small dropouts are exactly what a listener hears as
"mechanical". The shortfall is now filled with the real trailing audio,
cross-faded in: measured **164.8ms of silence -> 0.0ms**, with length still
preserved exactly.

**2. The rhythm was planned for months and never rendered.** `clause_gaps` -
micro-pauses at commas - has been computed for every beat by the planner, and
*nothing consumed it*. Timing is the strongest human cue after pitch.

It was tried once, in v0.0.35, and correctly ripped out: the engines appended
`silence_wav(gap)` **after** the finished sentence, on top of `pause_after_ms`,
which is not a breath inside a clause - it is just drag on every sentence,
doubling a pause the neural model already produces at a comma. Two suites still
assert the engines never do that, and those assertions are right.

So the gap now goes where it belongs: **inside the waveform, at the comma**, in
`voice_fx`. Measured on a 2.4s sentence: neutral **+180ms**, apologetic
**+300ms**, excited **+140ms** - the emotion decides the rhythm, in the audio.
Because `render()` derives the gaps itself from the text and emotion it is
already given, Piper and Kokoro gained real rhythm **without one line changing in
their source**, so the v0.0.35 guarantees stay intact instead of being fought.

**A self-caught defect in that fix.** Butt-splicing silence into voiced audio
measured a sample step of **0.188** where the signal's own 99th-percentile motion
was **0.021** - a ~9x discontinuity, an audible click at every comma, which would
have been worse than having no rhythm at all. Each splice edge is now ramped to
zero first: **0.188 -> 0.00098**, about 21x quieter than the signal's own motion.
The cut point is also snapped to the quietest nearby region rather than the raw
character offset, because a character position only approximates where a word ends
in time.

**3. The breath existed since v0.0.41 and was never called.**
`voice_fx.prepend_breath()` was written, shipped, and inert - nothing but its own
test ever invoked it. It is now taken at the **start of a turn only**, and only
for the heavy emotions: people inhale before delivering bad news, and a breath
between every clause sounds asthmatic rather than alive. Tunable with
`VOICE_BREATH_MS` (default 150, clamped to 400, `0` disables).

Evidence: `test_voice_fx.py` went **70 -> 115** assertions, and the new ones
measure properties - zero-length silence runs, splice discontinuity against the
signal's own motion, durations per emotion, gap clamping, and that the pause sits
inside the sentence rather than on its tail. Suite total **1,885 -> 1,930**
across 24 suites, 0 failures. The FX chain still measures **6ms per sentence**, so
none of this was bought with latency.

## v0.0.46 - "many keys" was only ever true for one of three paths, and one bad key threw away the turn

You asked for a real many-key system with a manager. Going in, the project already
let you paste several keys - but reading the code turned up three problems, one of
which made extra keys actively *harmful*.

**1. One revoked key abandoned the whole turn.** The NIM loop in `brain.py`
rotated through your keys, but any response that was not `200` and not `429` did
`return None` immediately. So a single mistyped or expired key - a `401` - lost
the answer even though your other keys were healthy and idle. Adding more keys
made a bad key *more* likely to break a call, the exact opposite of the point.
Now a bad key costs one retry, gets quarantined, and the next key answers.

**2. Rotation had no memory.** A key that had just been rate limited was retried
at the same rate on the very next turn, so callers paid that timeout again and
again for a key we already knew was exhausted.

**3. Only the brain rotated.** `stt.py` took a single key, and so did Magpie.
Word capture makes far more requests than the brain does, so it is the *first*
thing to hit a per-key limit - and it was the one path that could not rotate.

### What is in place now

All keys live in one place, `apikeys.py`, with per-key health:

- **`429` -> cooling** for 45s (`VOICE_KEY_COOLDOWN_SEC`). Busy, not broken.
- **`401/403` -> quarantined** for 10 minutes (`VOICE_KEY_QUARANTINE_SEC`).
  Wrong keys fail fast, so retrying them only spends your latency budget.
- **`5xx` -> resting** briefly. That is the provider's fault, not the key's.
- **`400` -> nothing.** A bad model name is a problem with the *request*;
  quarantining a good key over a typo would take real capacity offline.
- Round-robin across the healthy keys, so one key is not exhausted while the
  rest sit idle - and a busy key is always preferred over a rejected one.
- If *every* key is cooling down we still return one to try. A stale cooldown
  must never turn into "the feature is off".

Brain, capture and Magpie all ask the same ring, so the health picture is shared.

### The key manager

In the brain panel: **Check key health** and **Clear cooldowns**. It shows each
key's state, its countdown, and its success/limit/reject counts.

Two deliberate choices: keys are shown **masked** (`***1111`, the last four
characters only) so you can tell them apart without exposing the secret, and the
endpoint is **POST, not GET**, because keys in a URL end up in access logs, proxy
logs and browser history. The server never sends a raw key back. "Clear
cooldowns" exists because the quarantine is deliberately long - if you fix a key
upstream you should not have to wait it out or restart the server.

### Proof, not assertions about strings

The headline bug was behavioural, and a structural test cannot catch it, so
`test_apikeys.py` **executes** the real NIM loop against a fake client where the
first key returns `401` and the second returns `200`. It asserts an answer comes
back, that a healthy key served it, that the loop did not stop at the bad key,
and that the bad key was quarantined for next time. It also proves all-exhausted
returns nothing rather than inventing a reply, and that the raw key never appears
anywhere in the manager payload. 66 new assertions; **24 suites, 1,885 total.**

One of those assertions caught a bug in my own new module: the health table grew
to 400 entries because eviction only dropped entries untouched for an hour, but
nothing stamped `last_used` on a write, so the condition could never fire. Fixed
the design (every touch counts as recency, LRU eviction at a hard ceiling) rather
than relaxing the bound.

---

## v0.0.45 - the conversation had no emotional memory, and the detector re-did its work on every beat

Two changes to the emotional engine, one for feeling and one for speed. Both are
verified by executing the real planner and comparing real numbers, not by reading
the source.

### The mood now survives between turns

Every reply used to be planned from a standing start. The agent could apologise
with real warmth, and then the very next sentence - a fraction of a second later
- was planned as if nothing had happened, because nothing was remembered. That
is a large part of why the emotion never felt like a PERSON: each reply was
expressive on its own, yet the conversation as a whole was flat.

`emotion.py` now remembers the feeling a reply ended on and bleeds it into the
opening beat of the next one:

  * it remembers the last emotion that actually had colour, so a reply that ends
    on a flat closing line does not erase the feeling that preceded it;
  * the carry is a bleed, not a takeover - 35% at full expressiveness, and only
    on the OPENING beat, because a mood colours how you start speaking, not
    everything you go on to say;
  * a mood expires (`VOICE_EMOTION_MOOD_SEC`, default 25s), so one bad turn does
    not tint an entire call;
  * `reset_mood()` is called for a new caller, so nobody inherits a stranger's mood.

**The mistake I made writing it, and had to undo.** My first version scaled the
carry continuously by elapsed time and updated the mood on every call to
`plan()`. That broke this module's core promise - the same reply must always
plan to the same numbers - and `test_emotion.py` caught it immediately. It
matters in production, not just in the suite: when a single beat fails to
synthesise it is re-rendered ON ITS OWN, and if re-planning gives it different
numbers, the repaired sentence no longer matches the ones around it. So the
carry amount is now fixed while a mood is fresh, and re-planning the same reply
deliberately reuses the mood that preceded it rather than compounding the mood
that reply itself produced. Determinism is asserted three times over.

### The emotion detector is ~30x faster on repeat lines

`detect()` scans 17 cue groups per sentence, and multi-word cues that miss
literally get a second pass through an intensifier-tolerant regex. It is a pure
function of the normalised text, and in a real deployment the same lines recur
constantly - greetings, confirmations, read-backs, apologies. It is now memoised
with a bounded cache (512 entries).

Measured on this machine, 80 sentences per pass: **0.455 ms cold, 0.015 ms warm
- about 30x.** The suite asserts a differential (warm < cold/2), not an absolute
duration, because absolute timings on a shared machine are noise while the ratio
between two passes on the SAME machine is real.

This is a small slice of a turn, and I am not going to pretend it is the reason
replies feel slow. It is real, it is free, and it is on the hot path of every
beat of every reply.

### Tests

`test_emotion.py` 154 -> 171. New sections `[12] the mood carries across turns`
(carry-over changes the opening beat, leans the right way, is a bleed not a
takeover, expires, resets, and stays deterministic across three replans) and
`[13] the detector is memoised and still correct` (cached readings equal
uncached ones, the measured speedup, the cache is bounded and never exceeds its
bound, empty text is never cached as a key).


## v0.0.49 - the agent was listening in batches and answering in one lump

Capture, thinking and speech were three sequential phases. The caller finished
talking, *then* the audio was uploaded, *then* the model was asked, *then* the
whole reply was synthesised, *then* audio started. Every stage waited for the
last one to complete, so the silences were additive.

Worse, the browser re-uploaded a **growing blob** roughly every 700ms, so the
cost of recognising a sentence grew with the length of that sentence. A long
utterance was measurably more expensive to hear than a short one - the opposite
of what a real-time system needs. Measured payloads per tick before the fix:
`[12844, 25644, 38444, 47404]` bytes.

**What changed.** A genuine streaming path, `/ws/voice`:

- `static/capture-worklet.js` + `audio_frames.py` - fixed-size PCM frames, so
  per-tick cost is **constant** instead of growing with the utterance.
- `endpointing.py` - end of turn is decided by fusing *what* was said with
  *how* it was said, rather than by a fixed timer. "My account number is..."
  waits; "yes, that's right." answers almost immediately.
- `asr_stream.py` / `realtime.py` - partial transcripts while the caller talks.
- The reply is spoken **clause by clause as the model generates it**, so first
  audio arrives long before the full answer exists.
- `_RT_SYNTH_TOTAL` - a whole-chain deadline for mid-reply chunks, much tighter
  than the batch budget: audio that arrives late is worse than useless, because
  the conversation has already moved on.

The old HTTP path is retained as a fallback, and `?rt=0` opts out.

**Self-review caught two real bugs**, both found by tests rather than by
reading: per-tick payload still growing (fixed with `MAX_PENDING_MS`), and
flush duplicating overlap words - "i would like to cancel my order i would like
to cancel my order today" - fixed with a repeat guard in `strip_overlap`.

```
SUITES=25   TOTAL PASSED=1992   TOTAL FAILED=0
```


## v0.0.50 - the emotion detector only had feelings about sentences it recognised

Emotion was driven by substring cue matching. If a sentence contained a known
cue it was delivered with feeling; if it did not, it came out **completely
flat**. Since most real sentences contain no cue phrase, the default experience
was a monotone voice that occasionally became expressive - which reads as more
robotic than consistent flatness, because the inconsistency is audible.

The first useful finding was a negative one:

```
grep -n 'emotion|expressive|prosody|voice_fx' server.py   ->   EMPTY
```

Emotion is applied *inside* the engines, keyed off the text handed to
`synthesize()`. That meant the new v49 per-chunk streaming path already reached
it - no rewiring needed. The weakness was entirely in detection.

**What changed.** `engines/sentiment.py`: a continuous **valence/arousal**
scorer (stdlib-only, no model, no network) wired in after the cue scan and
before the punctuation fallback, so every sentence now gets a reading. It
handles negation windows, intensifiers and diminishers, contrastive clauses
("it was late, **but** it is fixed now" resolves positive), and confidence
weighting so weak evidence produces subtle delivery rather than a wild swing.

Crucially, **punctuation never invents valence** - "Your order number is 5512"
stays genuinely neutral. Emotion that fires on neutral content is worse than no
emotion, because it makes the agent sound insincere.

**Self-review found four defects, and only two were code.** Executing the
scorer by hand surfaced that the word **"bad" was missing from the lexicon**
(`'That is not bad actually.'` -> `hits=0`). Two more were **my tests being
wrong**: I had asserted that "empathetic" delivery was a bug, when soft delivery
for sad content is the entire point - documented in-file as *"softness is not
boredom."* One was a regression I introduced myself, adding `refund` as a
positive stem, which broke "the refund was rejected".

```
test_sentiment.py   PASSED: 113   FAILED: 0
SUITES=26   TOTAL PASSED=2105   TOTAL FAILED=0
```


## v0.0.51 - the server was optimised for hardware the operator does not have

The brief for this release was short: **no GPU, no GPU budget, CPU only.** That
turned out not to be a limitation to work around but a bug report, because the
product had been quietly assuming the opposite.

### The defect

Two separate fallback ladders led with engines that cannot run on a CPU:

```
server.py            _FALLBACK_ORDER = [human, fish, chatterbox, kokoro, edge, piper, magpie]
engines/human_engine _DEFAULT_ORDER  = [fish, chatterbox, kokoro, edge, piper]
```

`fish` is a 4B model that needs a local GPU. `chatterbox` is 0.5B, and its
advertised "sub-200ms" is measured on an RTX 4090 (users report 500ms-1s even
*with* the GPU). On a CPU-only box neither can ever serve a request.

So every single reply walked the ladder, attempted two engines that were never
going to work, absorbed a failure - and for `fish`, potentially a network
timeout - and only then arrived at Kokoro, which was always going to be the
engine that spoke. **This was pure latency, paid on every turn, for nothing.**

There was a second problem sitting in the same line. Fish Audio S2 Pro's
weights are published under the Fish Audio Research License: **non-commercial**.
It was ranked second by preference, which means the highest-priority engine that
could actually be reached on a machine with a GPU was one the project is not
licensed to charge money for. That is a legal exposure, not a technical one, and
it was invisible in the code.

### The fix

A new module, `engines/cpu_profile.py`, owns one question - *which engines can
this box actually use?* - so the routers, the registry and the docs cannot drift
apart from each other again. It is stdlib-only, pure and deterministic.

| Concern | Before | After |
| --- | --- | --- |
| `server._FALLBACK_ORDER` | human, **fish, chatterbox**, kokoro, ... | human, **kokoro**, edge, piper, magpie |
| `human_engine._DEFAULT_ORDER` | **fish, chatterbox**, kokoro, edge, piper | **kokoro**, edge, piper, (chatterbox, fish) |
| `best_engine._PRIORITY` | **edge**, kokoro, piper, magpie | **kokoro**, edge, piper, magpie |
| Non-commercial weights | reachable by default | blocked unless explicitly allowed |

`best_engine` changed for a different reason than the other two. Edge sounds
excellent, but it is an **online Microsoft service**: it adds a network round
trip to every reply and it is not infrastructure we control. For a self-hosted
box, a local, offline, Apache-2.0 engine that still beats real time is the
better default. Edge remains the next rung, which is what it is genuinely good
at - a free, very natural voice for when local weights are missing.

Two guarantees are enforced in `filter_order()` rather than left to callers:

1. **It can never return an empty ladder.** Speaking with a lower-tier voice is
   a far better failure than not speaking at all, so if filtering would empty
   the list it falls back to the CPU-safe order, and failing that, to the input.
2. **An explicit `HUMAN_ORDER` is filtered too.** Naming an engine in the
   environment cannot conjure a GPU, and obeying it silently would reintroduce
   exactly the latency tax this release removes.

### Making the one engine that runs, run better

With Kokoro now serving essentially every request, it earned direct attention:

- **Chunked synthesis.** Kokoro's real-time factor gets *worse* on longer input
  instead of amortising down - measured **0.51 -> 0.69** going from short to
  extended text on CPU. Long strings are now split on whitespace and stitched,
  which is free speed and, more importantly, much better time-to-first-audio.
  Falls back to a single whole-string call if numpy is unavailable, because
  correctness outranks the optimisation.
- **Bounded thread pool.** ONNX Runtime grabs every core it can see. On a box
  also serving HTTP and WebSockets that means one synthesis makes the *second*
  concurrent caller wait and starves the event loop. Now capped at cores-1.
- **Optional int8 weights.** If `models/kokoro/kokoro-v1.0.int8.onnx` is
  present it is preferred: ~4x smaller and faster on CPU. Entirely opt-in.

### A note on emotion, since it is the headline feature

Kokoro's model card is explicit: **no voice cloning, no emotion control.** It
accepts text and a speed value, nothing else.

This is worth stating plainly because it reframes the v0.0.50 work. The
sentiment -> prosody layer is not a workaround for lacking a better model. On
CPU it is **the only mechanism that exists** for emotional delivery, because
every engine that takes emotion as a native input (Maya1, Step Audio EditX)
needs 12-16GB of VRAM. Shaping rate, pitch contour, pauses and emphasis around
a flat engine *is* the CPU strategy, not a compromise on the way to one.

### Self-review: what this release broke

`test_ultra_human.py` began failing, and it was right to. Its block [11] proved
"a broken tier is skipped and the next one receives the emotion tags" - but the
only tag-aware engines are `fish` and `chatterbox`, both now filtered out, so
the assertion crashed with `IndexError` on an empty call list.

The wrong fix would have been to delete those checks. Tag routing is real
behaviour that still matters on a GPU box. Instead the block now explicitly
simulates a GPU deployment (`VOICE_CPU_ONLY=0`, `VOICE_ALLOW_NONCOMMERCIAL=1`)
**and pins the ladder with `HUMAN_ORDER`** - because relying on the default
order meant the test was silently re-testing whatever the default happened to
be, rather than the fall-through it claimed to verify. A new block [13] then
covers the CPU-only path properly, including the assertion that matters most
here: on a CPU box, `fish` and `chatterbox` are **never called at all**.

### Verification

```
SUITES=27   TOTAL PASSED=2223   TOTAL FAILED=0
```

including the new `test_cpu_only.py` (105 checks): classification, env parsing,
the never-empty guarantee, lossless chunk splitting (no word is ever torn, and
a pathological 1000-character single token terminates instead of looping),
thread bounding, and source-level assertions that all three routers are
genuinely wired to the policy rather than merely documented as such.

### Honest limits

The sandbox has no `fastapi` and no Kokoro weights, so `server.py` is
syntax-checked rather than booted, and the RTF figures quoted here are
published CPU benchmarks, not measurements from your hardware. The ordering,
filtering, splitting and threading logic is fully covered by tests; the
end-to-end latency win is an engineering expectation until measured on the
real box.

### Post-release audit: three defects found by reviewing my own v51 work

The v51 test suite was green at 2223 checks. Green tests are not the same thing
as correct code, so I audited the release against the actual request path. Three
real problems came out of it, one of them serious.

**1. The policy could be bypassed entirely from the API (serious).**

I filtered `_FALLBACK_ORDER`, but the *requested* mode is client-supplied and
was prepended to the ladder **unfiltered**:

```python
candidates = [req.mode] + [m for m in _FALLBACK_ORDER if m != req.mode]
```

So `POST /api/tts {"mode": "fish"}` still put a GPU-only, non-commercially
licensed engine at the *head* of the chain on a CPU-only box. Both the latency
tax and the licence exposure were still fully reachable - just through the API
instead of the default path. The same hole existed in the realtime WebSocket
loop. Both now route through one `_candidates()` helper that filters the whole
list, which also de-duplicates it so the requested engine is never tried twice.

**2. Blocked engines were still advertised as "ready".**

`status_payload()` (which backs `/api/engines` and the mode picker) reported
engine availability with no knowledge of the CPU policy. On a box where the
Fish libraries happened to be installed, the UI would have shown Fish as a
selectable, ready voice - and selecting it triggered defect #1. Blocked engines
are now reported `ok: false` with an actionable reason, while remaining
*listed* so an operator can see why:

```
fish        ok=False  Disabled here: needs a GPU (VOICE_CPU_ONLY=1); weights are non-commercial
chatterbox  ok=False  Disabled here: needs a GPU (VOICE_CPU_ONLY=1)
```

The 503 path was improved to match: asking for a blocked engine now says so,
instead of reporting a generic "No voice engine is ready" that would send an
operator hunting for a broken install that does not exist.

**3. My own chunk-splitting was hurting the thing this release is about.**

This one is a quality bug I introduced. `split_for_cpu` cut at an arbitrary
space. That is fine for throughput, but a neural TTS renders each piece as a
**complete utterance** - so an arbitrary cut drops a falling, sentence-final
intonation into the middle of a sentence, and one sentence audibly becomes two.
On a release whose entire selling point is human-sounding delivery, I had traded
prosody for speed without noticing.

Splitting now prefers a **clause boundary** (comma, semicolon, colon, dash) -
where a person would have paused anyway - and only falls back to a plain space
when a piece contains no punctuation at all. A floor guard stops it cutting so
early that it emits a two-word stub. Verified on real text:

```
"...and the money should appear in your account within three working days;
 if it has not arrived by Friday,"   <- cut lands here, not mid-phrase
```

`describe()` was also documented as feeding `/api/health` but had never been
wired in; `/api/health` now reports the live policy, so you can confirm what a
running box will actually attempt without reading the source.

```
SUITES=27   TOTAL PASSED=2253   TOTAL FAILED=0
```

Thirty new checks cover the three defects specifically, including the ones that
matter most: a client asking for `fish` gets a working ladder that does not
contain `fish`, blocked engines are never advertised as ready, and splitting is
lossless (rejoining the pieces reproduces the original text exactly).
