# Voice Studio - Enterprise & Multi-Tenant Guide

Voice Studio is built to run as a shared voice customer-service backend for
**many websites at once**. One server can host any number of "tenants" (websites),
each with 10-50+ concurrent customers, its own branding, voice, prompt, brain
key, and rate limits - fully isolated from every other tenant.

This guide covers: multi-tenancy, the embeddable widget, deployment, scaling,
security, and observability.

---

## 1. Multi-tenancy (one server, many websites)

A **tenant** is one website. Tenants are defined in a JSON registry. Point the
server at it with `VOICE_TENANTS_FILE`, or drop a `tenants.json` next to the app.
See `tenants.example.json` for a complete, commented example.

```jsonc
{
  "defaults": {                 // inherited by every tenant unless overridden
    "voice_mode": "best",
    "rate_per_min": 30,
    "burst": 10,
    "max_history": 12
  },
  "tenants": [
    {
      "id": "acme",                                  // must match data-site
      "name": "Acme Support",
      "allowed_origins": ["https://acme.com", "https://www.acme.com"],
      "voice_mode": "kokoro",
      "voice": "",
      "brain_provider": "nvidia",
      "brain_model": "meta/llama-3.1-8b-instruct",
      "brain_key_env": "ACME_AI_KEY",               // env var NAME (not the key)
      "system_prompt": "You are Acme's warm, concise support agent...",
      "greeting": "Hi! Thanks for contacting Acme. How can I help?",
      "theme": { "color": "#e11d48", "title": "Acme Support" },
      "rate_per_min": 40,
      "burst": 15,
      "api_token": ""                                // optional shared secret
    }
  ]
}
```

### Isolation guarantees
- **Config**: each tenant has its own greeting, brand color, voice, system
  prompt, brain provider/model/key, and rate limits.
- **Conversation memory**: sessions are keyed by `tenant_id:session_id`, so one
  tenant's history can never leak into another's.
- **Secrets**: `tenants.json` stores the **name** of an env var (`brain_key_env`),
  never the key itself. Keys live only in the environment.
- **Unknown site ids** fall back to a **neutral** synthesized `default` tenant
  (no cross-origin, no secrets) - never to another real tenant's config.

Edit `tenants.json` and the server picks it up on restart (or call the internal
`tenants.reload()` if you wire a reload hook).

---

## 2. Embeddable widget (one line per website)

Drop this just before `</body>` on any site. Change `data-site` per website and
point `data-api` at your server:

```html
<script src="https://your-host/widget.js"
        data-site="acme"
        data-api="https://your-host"
        defer></script>
```

- Renders a floating button + chat panel **inside a Shadow DOM**, so it never
  clashes with the host page's CSS or JavaScript.
- Pulls the tenant's theme/greeting/voice from `/api/config?site=acme`.
- Streams replies and **speaks each sentence as soon as it's ready**.
- **Barge-in**: the customer can talk or press Stop to instantly interrupt.
- Falls back to the browser's built-in voice if the server voice is unavailable.
- Keeps a per-visitor `session_id` in `localStorage` for short context.
- Optional `data-token="..."` when the tenant requires an API token.

A live demo page is served at `/widget-demo.html`.

---

## 3. Deployment

### Docker (recommended)
```bash
cp .env.example .env            # add your free AI keys
# edit tenants.json for your websites
docker compose up -d --build
```
The image runs **gunicorn with multiple uvicorn workers** (`gunicorn_conf.py`)
so it uses every CPU core. Health at `/api/health`, readiness at `/api/ready`.

### Bare metal / VM
```bash
pip install -r requirements-core.txt gunicorn   # + requirements.txt for local neural TTS
gunicorn -c gunicorn_conf.py server:app
```

### Behind nginx (TLS + SSE)
Use `nginx.conf.example`. The important bits:
- `proxy_buffering off` on `/api/reply-stream` so streamed tokens arrive live;
- a long `proxy_read_timeout` so streams aren't cut off;
- forward `X-Forwarded-For` so per-client rate limiting is accurate.

---

## 4. Scaling & concurrency (10-50+ users per site)

Layers of protection keep the service responsive under load:

| Mechanism | Where | What it does |
|-----------|-------|--------------|
| Worker processes | `WEB_CONCURRENCY` | real multi-core parallelism |
| In-flight gate | `VOICE_MAX_INFLIGHT` | caps concurrent heavy ops per worker (backpressure) |
| CPU synth semaphore | `VOICE_CPU_CONCURRENCY` | stops local TTS from thrashing the CPU |
| Network semaphore | `VOICE_NET_CONCURRENCY` | bounds outbound calls, shares one HTTP pool |
| Audio LRU cache | in-memory | identical synths served instantly |
| Per-client rate limit | token bucket | `rate_per_min` + `burst` per tenant, per IP |
| Circuit breaker | brain providers | skips a failing AI provider for 30s, fails over |

**Capacity math**: effective concurrent heavy ops = `WEB_CONCURRENCY x VOICE_MAX_INFLIGHT`.
A 4-core box with `WEB_CONCURRENCY=4` comfortably serves many sites of 10-50
users, because most turns are short and cached/streamed.

### Sessions & rate limits across workers
Sessions and rate limits are **process-local**. For a single box this is fine.
For multiple workers/boxes where they must be global, either enable sticky
sessions at the load balancer, or back `sessions.py` / `ratelimit.py` with Redis -
their interfaces (`append/history/reset`, `check`) are tiny and drop-in.

---

## 5. Security

- **CORS is dynamic**: the server only allows the union of every tenant's
  `allowed_origins`. If no tenant restricts origins, it allows all (dev mode).
- **Optional per-tenant API token**: set `api_token`; callers must send
  `X-API-Token` or `Authorization: Bearer <token>`.
- **Security headers** on every response: `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`.
- **Secrets** never live in `tenants.json` or reach the browser - only env vars.
- **Input caps**: request text is length-limited; voice controls are clamped to
  safe ranges so audio can't be distorted.
- Container runs as a **non-root** user.
- **Rotate any API keys** that were ever committed or shared.

---

## 6. Observability

- `GET /api/health` - version, uptime, in-flight count, cache/tenant stats.
- `GET /api/ready` - readiness probe (200 only once startup finished).
- `GET /api/metrics` - Prometheus-style plaintext (request counts, rate-limited,
  tts/reply totals, active sessions, tracked clients, per-path counts).
- **Structured JSON logs** (one line per API request) with a request id, path,
  status and latency. Set `LOG_LEVEL` to tune verbosity. Every response also
  carries an `X-Request-ID` for tracing.

---

## 7. Endpoint reference (tenant-aware)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/config?site=ID` | public tenant config for the widget (no secrets) |
| POST | `/api/reply` | one-shot reply (`site`, `session_id` optional) |
| POST | `/api/reply-stream` | streamed SSE reply (recommended) |
| POST | `/api/tts` | synth audio (`site` picks the default voice) |
| POST | `/api/reset` | clear a server-side session |
| GET | `/api/engines` | voice modes availability |
| POST | `/api/verify-key` | validate an NVIDIA NIM key |
| GET | `/api/health` `/api/ready` `/api/metrics` | ops |

All POST bodies accept an optional `site` (tenant id) and, where relevant, a
`session_id`. Omit them and everything works as a single default tenant.
