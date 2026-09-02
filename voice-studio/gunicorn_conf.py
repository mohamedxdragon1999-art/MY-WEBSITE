"""Gunicorn configuration for Voice Studio (production).

Runs FastAPI under multiple uvicorn workers so the service uses every CPU core
and can serve many concurrent visitors across many websites.

Tune with env vars:
  PORT                 (default 8000)
  WEB_CONCURRENCY      number of worker processes (default: 2*cores+1, capped 8)
  GUNICORN_TIMEOUT     hard request timeout seconds (default 120; keep high for SSE)
  GUNICORN_KEEPALIVE   keep-alive seconds (default 5)

Note: state that must be shared across workers (rate limits, sessions) is
process-local here. For a single box this is fine. For a multi-worker or
multi-box deployment where limits/sessions must be global, back sessions.py /
ratelimit.py with Redis (interfaces are drop-in). See ENTERPRISE.md.
"""
import multiprocessing
import os


def _int(name, default):
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


_port = os.environ.get("PORT", "8000").strip() or "8000"
bind = f"0.0.0.0:{_port}"

_default_workers = min(8, (multiprocessing.cpu_count() * 2) + 1)
workers = _int("WEB_CONCURRENCY", _default_workers)
worker_class = "uvicorn.workers.UvicornWorker"

# SSE streaming responses are long-lived; don't kill them early.
timeout = _int("GUNICORN_TIMEOUT", 120)
graceful_timeout = 30
keepalive = _int("GUNICORN_KEEPALIVE", 5)

# Recycle workers periodically to bound memory growth under long uptime.
max_requests = _int("GUNICORN_MAX_REQUESTS", 2000)
max_requests_jitter = _int("GUNICORN_MAX_REQUESTS_JITTER", 200)

# Logs to stdout/stderr (container-friendly); the app also emits JSON logs.
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("LOG_LEVEL", "info").lower()
proc_name = "voice-studio"
