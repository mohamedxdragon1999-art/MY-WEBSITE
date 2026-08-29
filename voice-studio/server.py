"""Voice Studio - a voice customer-service website.

You TALK to it (browser speech-to-text) and it TALKS BACK with a realistic voice.
Five selectable TTS modes:
  1. edge   - Current voice (Microsoft Edge neural; online, no key, CPU-friendly)
  2. piper  - Pocket TTS (Piper; fully offline, local CPU)
  3. kokoro - Kokoro TTS (open-weight 82M; local CPU via ONNX, high quality)
  4. magpie - NVIDIA Magpie (NVIDIA NIM cloud GPU; needs key + internet)
  5. best   - Vox Premium (auto-picks the best READY voice + light mastering)

The reply text ("brain") is offline+free by default, and auto-upgrades to a free
cloud LLM (Groq / Cerebras / NVIDIA NIM / Gemini / Mistral / OpenRouter /
Together) if you add a key - see .env.example and brain.py.

Built to stay responsive with many concurrent users (~50):
  * network engines (edge/magpie) run natively async and share one HTTP pool;
  * CPU engines (kokoro/piper) are bounded by a semaphore so they don't thrash;
  * identical requests are served from an in-memory LRU cache;
  * availability checks are cached briefly to keep hot paths cheap.

Endpoints:
  GET  /                 -> the website
  GET  /api/engines      -> availability + voices for every mode
  POST /api/tts          -> {text, mode, voice, lang, rate, pitch} -> audio bytes
  POST /api/reply        -> {text, lang, history?} -> reply text (+ brain source)
  POST /api/stt          -> multipart audio -> {text} (optional, needs faster-whisper)
  GET  /api/health       -> ok + brain status

Run (single process, handles ~50 users on the async + threadpool model):
  uvicorn server:app --host 0.0.0.0 --port 8000
Higher load / multi-core CPU voices: run several workers behind the launcher:
  uvicorn server:app --host 0.0.0.0 --port 8000 --workers 4
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import logging.handlers
import math
import os
import tempfile
import threading
import time

import apikeys

import latency
import uuid
from collections import OrderedDict
from functools import partial
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, File, Form, Request, UploadFile, WebSocket
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"


def _load_dotenv() -> None:
    """Minimal .env loader (no dependency). Real env vars always win."""
    env = HERE / ".env"
    if not env.exists():
        return
    try:
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
    except Exception:
        pass


_load_dotenv()

from engines import build_registry, status_payload  # noqa: E402 (after dotenv)
from engines import cpu_profile  # noqa: E402 (after dotenv)
from reply import generate_reply  # noqa: E402
import brain  # noqa: E402
import tenants  # noqa: E402
from ratelimit import RateLimiter  # noqa: E402
from sessions import Store as SessionStore  # noqa: E402
from cache import CACHE as REPLY_CACHE, is_cacheable  # noqa: E402
import stt as fast_stt  # noqa: E402
import asr_local  # noqa: E402
import realtime_server  # noqa: E402

VERSION = "0.0.51"
START_TIME = time.time()

# ------------------------------- logging --------------------------------

class _JsonLog(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)),
            "level": record.levelname,
            "msg": record.getMessage(),
        }
        if isinstance(getattr(record, "extra_fields", None), dict):
            base.update(record.extra_fields)
        return json.dumps(base, ensure_ascii=False)


log = logging.getLogger("voice_studio")
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(_JsonLog())
    log.addHandler(_h)
    log.setLevel(getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO))
    log.propagate = False
    # Persist structured logs to rotating files so voice problems are captured
    # for debugging even without a stdout collector. Best-effort: if the files
    # can't be created (read-only FS, etc.) we simply keep logging to stdout.
    try:
        _log_dir = Path(os.environ.get("VOICE_LOG_DIR", "") or (HERE / "logs"))
        _log_dir.mkdir(parents=True, exist_ok=True)
        try:
            _log_max = max(100_000, int(os.environ.get("VOICE_LOG_MAX_BYTES", "") or 5_000_000))
        except ValueError:
            _log_max = 5_000_000
        try:
            _log_backups = max(1, int(os.environ.get("VOICE_LOG_BACKUPS", "") or 5))
        except ValueError:
            _log_backups = 5
        # Everything (requests, fallbacks, errors) -> voice-studio.log
        _fh = logging.handlers.RotatingFileHandler(
            str(_log_dir / "voice-studio.log"), maxBytes=_log_max, backupCount=_log_backups, encoding="utf-8")
        _fh.setFormatter(_JsonLog())
        log.addHandler(_fh)
        # Problems only (WARNING+) -> voice-errors.log
        _efh = logging.handlers.RotatingFileHandler(
            str(_log_dir / "voice-errors.log"), maxBytes=_log_max, backupCount=_log_backups, encoding="utf-8")
        _efh.setFormatter(_JsonLog())
        _efh.setLevel(logging.WARNING)
        log.addHandler(_efh)
    except Exception:
        pass


def _logx(level: int, msg: str, **fields) -> None:
    log.log(level, msg, extra={"extra_fields": fields})


app = FastAPI(title="Voice Studio", version=VERSION)

# Dynamic CORS: only the origins configured across all tenants are allowed. If
# any tenant uses "*" (e.g. the built-in dev tenant), allow all. Lock this down
# in production by adding a tenants.json with explicit allowed_origins.
_origins = tenants.allowed_origins()
if _origins is None:
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
else:
    app.add_middleware(
        CORSMiddleware, allow_origins=_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"], allow_credentials=True, max_age=600,
    )

REGISTRY = build_registry()

# Per-client rate limiting + bounded server-side sessions.
rate_limiter = RateLimiter()
sessions = SessionStore(
    ttl_sec=float(os.environ.get("SESSION_TTL_SEC", "1800") or 1800),
)

# Global backpressure gate: cap total heavy requests in flight so N sites x
# 10-50 users degrade gracefully (429) instead of thrashing the box.
_GLOBAL_INFLIGHT = None  # created on startup (needs the running event loop)
_metrics = {
    "requests_total": 0,
    "requests_by_path": {},
    "rate_limited_total": 0,
    "overloaded_total": 0,
    "rejected_total": 0,
    "tts_fallback_total": 0,
    "synth_error_total": 0,
    "tts_unavailable_total": 0,
    "tts_total": 0,
    "reply_total": 0,
    "errors_total": 0,
    "inflight": 0,
}
_metrics_lock = threading.Lock()


def _bump(key: str, n: int = 1) -> None:
    with _metrics_lock:
        _metrics[key] = _metrics.get(key, 0) + n

# ------------------------- concurrency + caching -------------------------

def _int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, "") or default))
    except ValueError:
        return default


# Bound CPU-heavy synths so 50 users can't thrash the CPU; network synths get a
# higher cap because they mostly wait on the wire.
_CPU_LIMIT = _int_env("VOICE_CPU_CONCURRENCY", min(4, (os.cpu_count() or 2)))
_NET_LIMIT = _int_env("VOICE_NET_CONCURRENCY", 32)
_cpu_sema = asyncio.Semaphore(_CPU_LIMIT)
_net_sema = asyncio.Semaphore(_NET_LIMIT)

# Reject oversized JSON bodies early to protect memory (STT audio is exempt and
# bounded separately). Tune with VOICE_MAX_BODY_BYTES.
_MAX_BODY_BYTES = _int_env("VOICE_MAX_BODY_BYTES", 262144)  # 256 KB


def _trusted_hops() -> int:
    """How many proxy hops (X-Forwarded-For entries) to trust. Default 1 matches
    the bundled nginx. Set VOICE_TRUSTED_PROXY_HOPS=0 when directly exposed so a
    client cannot spoof its IP to dodge rate limits."""
    try:
        return max(0, int(os.environ.get("VOICE_TRUSTED_PROXY_HOPS", "1") or 1))
    except ValueError:
        return 1


_TRUSTED_HOPS = _trusted_hops()


def _clampf(value, lo: float, hi: float, default: float) -> float:
    """Parse to float and clamp to [lo, hi]; reject NaN/inf/garbage -> default."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(v):
        return default
    return max(lo, min(hi, v))


# Cross-engine fallback order (quality-first) used when the requested voice
# engine is unavailable or fails, so a single bad engine never breaks a reply.
#
# v0.0.51 - this ladder used to read [human, fish, chatterbox, kokoro, ...],
# i.e. it tried two GPU-only engines BEFORE the engine that actually runs on
# this hardware. On a CPU-only box that cost a failed attempt (and possibly a
# network timeout) on every single request before the first usable engine was
# even reached. cpu_profile.filter_order() removes engines this deployment
# cannot use, and is guaranteed never to return an empty ladder.
_FALLBACK_ORDER = cpu_profile.filter_order(
    ["human", "kokoro", "edge", "piper", "magpie", "chatterbox", "fish"]
)


def _candidates(mode: str) -> list:
    """Engine ids to attempt, in order, for a requested mode.

    v0.0.51 - this exists because filtering only `_FALLBACK_ORDER` left a hole.
    The requested mode is CLIENT-SUPPLIED and was prepended to the ladder
    unfiltered, so `{"mode": "fish"}` still put a GPU-only, non-commercially
    licensed engine at the front of the chain on a CPU-only box - exactly the
    latency tax and licence exposure this release removes, just reachable
    through the API instead of the default path.

    Running the WHOLE list through filter_order also de-duplicates it, so the
    requested engine is never attempted twice, and it can never return empty.
    """
    return cpu_profile.filter_order([mode] + list(_FALLBACK_ORDER))

# v7.0: this used to be 30s PER ENGINE. With a 7-engine fallback chain a
# single hung engine held the whole reply for half a minute before the next
# voice was even tried - the user heard nothing at all. Speech is only useful
# if it arrives while the listener is still waiting, so we now abandon a slow
# engine quickly and move to the next one, under a hard total ceiling.
try:
    _SYNTH_TIMEOUT = max(1.0, float(os.environ.get("VOICE_SYNTH_TIMEOUT", "") or 10.0))
except ValueError:
    _SYNTH_TIMEOUT = 10.0

try:
    _SYNTH_TOTAL = max(_SYNTH_TIMEOUT,
                       float(os.environ.get("VOICE_SYNTH_TOTAL", "") or 22.0))
except ValueError:
    _SYNTH_TOTAL = 22.0


def _valid_audio(res) -> bool:
    """Guard against silent/corrupt voice output: audio must be present, and WAV
    output must carry a real RIFF header."""
    audio = getattr(res, "audio", None)
    if not isinstance(audio, (bytes, bytearray)) or len(audio) < 8:
        return False
    if (getattr(res, "mime", "") or "").endswith("wav"):
        return bytes(audio[:4]) == b"RIFF"
    return True

# Shared async HTTP client for the cloud brain (connection pooling).
_http_client = None

# In-memory LRU cache of rendered audio (support replies repeat a lot).
_CACHE_MAX = _int_env("VOICE_CACHE_ENTRIES", 256)
_cache: "OrderedDict[str, tuple]" = OrderedDict()
_cache_lock = threading.Lock()


def _cache_key(mode, voice, lang, rate, pitch, text) -> str:
    raw = f"{mode}|{voice or ''}|{lang}|{round(float(rate),2)}|{round(float(pitch),2)}|{text}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _cache_get(key):
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    return None


def _cache_put(key, value):
    with _cache_lock:
        _cache[key] = value
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)


@app.on_event("startup")
async def _startup():
    global _http_client, _GLOBAL_INFLIGHT
    _GLOBAL_INFLIGHT = asyncio.Semaphore(_int_env("VOICE_MAX_INFLIGHT", 96))
    try:
        import httpx
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=6.0),
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        )
    except Exception:
        _http_client = None
    pool_snap = brain.pool_status()
    _logx(logging.INFO, "startup", version=VERSION, tenants=len(tenants.all_tenants()),
          cpu_concurrency=_CPU_LIMIT, net_concurrency=_NET_LIMIT,
          brain_keys=pool_snap.get("total_keys", 0),
          brain_capacity_rpm=pool_snap.get("capacity_rpm", 0))

    # Warm a TLS connection to every configured provider BEFORE anyone calls.
    # A cold DNS + TLS handshake can add up to ~2s to the first reply; paying
    # it here means the very first caller is as fast as the hundredth.
    async def _warm_brain():
        try:
            res = await brain.prewarm()
            _logx(logging.INFO, "brain_prewarm", warmed=",".join(res.get("warmed", [])))
        except Exception as e:
            _logx(logging.WARNING, "brain_prewarm_failed", error=f"{type(e).__name__}: {e}")

    # Re-ping periodically so the connection never goes cold on a quiet site.
    async def _keepalive():
        interval = _int_env("BRAIN_KEEPALIVE_SEC", 240)
        if interval <= 0:
            return
        while True:
            try:
                await asyncio.sleep(interval)
                await brain.prewarm()
            except asyncio.CancelledError:
                return
            except Exception:
                continue

    if os.environ.get("BRAIN_PREWARM", "1") != "0":
        try:
            asyncio.get_event_loop().create_task(_warm_brain())
            asyncio.get_event_loop().create_task(_keepalive())
        except Exception:
            pass
    # Warm up local voice engines in the background so the FIRST real request
    # isn't slow (Kokoro loads a 310 MB model; Piper loads a voice off disk).
    # Best-effort only; never blocks or fails startup.
    if os.environ.get("VOICE_WARMUP", "1") != "0":
        def _warm():
            for eid in ("kokoro", "piper"):
                eng = REGISTRY.get(eid)
                warm = getattr(eng, "warmup", None)
                if callable(warm):
                    try:
                        if eng.availability_cached().ok:
                            warm()
                            _logx(logging.INFO, "warmup_done", engine=eid)
                    except Exception:
                        pass
        try:
            threading.Thread(target=_warm, name="voice-warmup", daemon=True).start()
        except Exception:
            pass


@app.on_event("shutdown")
async def _shutdown():
    if _http_client is not None:
        await _http_client.aclose()
    try:
        await brain.aclose_client()
    except Exception:
        pass
    _logx(logging.INFO, "shutdown")


# ------------------------- middleware + helpers --------------------------

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-XSS-Protection": "0",
}


@app.middleware("http")
async def _observability(request: Request, call_next):
    """Attach a request id, time every request, add security headers, and emit
    one structured log line per request."""
    rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:16]
    request.state.rid = rid
    start = time.monotonic()
    path = request.url.path
    _bump("requests_total")
    with _metrics_lock:
        _metrics["requests_by_path"][path] = _metrics["requests_by_path"].get(path, 0) + 1
    response = None
    if _oversized(request, path):
        _bump("rejected_total")
        response = JSONResponse(
            {"error": "payload too large", "limit_bytes": _MAX_BODY_BYTES, "request_id": rid},
            status_code=413,
        )
    if response is None:
        try:
            response = await call_next(request)
        except Exception as e:
            _bump("errors_total")
            _logx(logging.ERROR, "unhandled", rid=rid, path=path, error=f"{type(e).__name__}: {e}")
            response = JSONResponse({"error": "internal error", "request_id": rid}, status_code=500)
    dur_ms = round((time.monotonic() - start) * 1000, 1)
    for k, v in _SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    response.headers["X-Request-ID"] = rid
    if path.startswith("/api/"):
        _logx(logging.INFO, "request", rid=rid, path=path,
              status=getattr(response, "status_code", 0), ms=dur_ms)
    return response


_BODY_EXEMPT = {"/api/stt"}  # audio upload, bounded separately


def _oversized(request: Request, path: str) -> bool:
    """True when a POST to a JSON API endpoint declares a body over the cap."""
    if request.method != "POST" or not path.startswith("/api/") or path in _BODY_EXEMPT:
        return False
    cl = (request.headers.get("content-length", "") or "").strip()
    return cl.isdigit() and int(cl) > _MAX_BODY_BYTES


def _client_ip(request: Request) -> str:
    """Best-effort client IP. Only trusts X-Forwarded-For for the number of proxy
    hops you actually run (VOICE_TRUSTED_PROXY_HOPS, default 1), taking the
    right-most trusted entry so a client cannot spoof its IP to dodge rate
    limits. Set the env to 0 when the app is directly exposed."""
    if _TRUSTED_HOPS > 0:
        xff = request.headers.get("X-Forwarded-For", "")
        if xff:
            parts = [p.strip() for p in xff.split(",") if p.strip()]
            if parts:
                return parts[-min(_TRUSTED_HOPS, len(parts))]
    return request.client.host if request.client else "unknown"


def _too_many(request: Request, tenant) -> Optional[JSONResponse]:
    """Per-(tenant, client-ip) token-bucket check. Returns a 429 response when
    the caller should back off, else None."""
    key = f"{tenant.id}:{_client_ip(request)}"
    ok, retry = rate_limiter.check(key, tenant.rate_per_min, tenant.burst)
    if ok:
        return None
    _bump("rate_limited_total")
    return JSONResponse(
        {"error": "rate limited", "retry_after": retry, "fallback": "browser"},
        status_code=429, headers={"Retry-After": str(int(retry) + 1)},
    )


def _auth_ok(request: Request, tenant) -> bool:
    """If a tenant defines an api_token, require it via Authorization: Bearer or
    X-API-Token. Tenants without a token are open (public widget)."""
    if not tenant.api_token:
        return True
    got = request.headers.get("X-API-Token", "").strip()
    if not got:
        auth = request.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            got = auth[7:].strip()
    return got == tenant.api_token


def _brain_args_for(tenant, req) -> Dict:
    """Resolve which brain provider/key/model/prompt to use for this request,
    preferring an explicit UI key, then the tenant's configured key."""
    provider = (getattr(req, "provider", None) or tenant.brain_provider or "").strip() or None
    model = (getattr(req, "model", None) or tenant.brain_model or "").strip() or None
    api_key = (getattr(req, "api_key", None) or "").strip() or tenant.brain_key()
    return {"provider": provider, "model": model, "api_key": api_key,
            "system_prompt": tenant.system_prompt or None}


# ------------------------------- models ---------------------------------

class TTSRequest(BaseModel):
    text: str
    mode: Optional[str] = None       # falls back to the tenant's default voice mode
    voice: Optional[str] = None
    lang: str = "en"
    rate: Optional[float] = None
    pitch: Optional[float] = None
    api_key: Optional[str] = None  # optional per-request NVIDIA key (for Magpie)
    site: Optional[str] = None       # tenant id (which website is calling)


class ReplyRequest(BaseModel):
    text: str
    lang: str = "en"
    history: Optional[List[Dict]] = None
    provider: Optional[str] = None   # e.g. "nvidia" to force the NVIDIA NIM brain
    model: Optional[str] = None      # NIM model id chosen in the UI
    api_key: Optional[str] = None    # user's NVIDIA NIM key entered in the UI
    site: Optional[str] = None       # tenant id (which website is calling)
    session_id: Optional[str] = None # server-side conversation id (optional)


class VerifyKeyRequest(BaseModel):
    api_key: str
    model: Optional[str] = None


class NimModelsRequest(BaseModel):
    api_key: str


class ResetRequest(BaseModel):
    site: Optional[str] = None
    session_id: Optional[str] = None


# ------------------------------- routes ---------------------------------

@app.get("/api/health")
def health():
    with _metrics_lock:
        inflight = _metrics.get("inflight", 0)
    return {
        "ok": True,
        "version": VERSION,
        "uptime_sec": round(time.time() - START_TIME, 1),
        "brain": brain.brain_status(),
        "cpu_concurrency": _CPU_LIMIT,
        "net_concurrency": _NET_LIMIT,
        "inflight": inflight,
        "cache_entries": len(_cache),
        "tenants": len(tenants.all_tenants()),
        "brain_pool": brain.pool_status(),
        "reply_cache": REPLY_CACHE.stats(),
        # v0.0.51 - which engines this box will actually attempt, and why.
        "cpu_profile": cpu_profile.describe(),
    }


@app.get("/api/ready")
def ready():
    """Readiness probe for load balancers: 200 only once startup finished."""
    if _GLOBAL_INFLIGHT is None:
        return JSONResponse({"ready": False}, status_code=503)
    return {"ready": True}


@app.get("/api/metrics")
def metrics():
    """Prometheus-style plaintext metrics for scraping/dashboards."""
    with _metrics_lock:
        m = dict(_metrics)
        by_path = dict(m.pop("requests_by_path", {}))
    pool_snap = brain.pool_status()
    rc = REPLY_CACHE.stats()
    lines = [
        "# Voice Studio metrics",
        f"voice_uptime_seconds {round(time.time() - START_TIME, 1)}",
        f"voice_cache_entries {len(_cache)}",
        f"voice_sessions_active {sessions.stats().get('active_sessions', 0)}",
        f"voice_rate_clients {rate_limiter.stats().get('tracked_clients', 0)}",
        f"voice_brain_keys {pool_snap.get('total_keys', 0)}",
        f"voice_brain_capacity_rpm {pool_snap.get('capacity_rpm', 0)}",
        f"voice_reply_cache_entries {rc.get('entries', 0)}",
        f"voice_reply_cache_hits {rc.get('hits', 0)}",
        f"voice_reply_cache_misses {rc.get('misses', 0)}",
        f"voice_reply_cache_hit_rate {rc.get('hit_rate', 0.0)}",
    ]
    # Percentiles, not averages. A healthy-looking mean routinely hides a P95
    # that is three times worse, and in a voice agent the tail IS the caller's
    # experience - the one person in twenty who waits 3s is the one who thinks
    # the product is broken.
    lines.extend(latency.prometheus_lines())
    for k, v in m.items():
        if isinstance(v, (int, float)):
            lines.append(f"voice_{k} {v}")
    for p, c in by_path.items():
        safe = p.replace('"', "")
        lines.append(f'voice_requests_path{{path="{safe}"}} {c}')
    return Response("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")


@app.get("/api/pool")
def pool_status():
    """Live view of the free key pool: how many keys, headroom left on each,
    and roughly how many callers can be served per minute.

    Free tiers are rate limited PER KEY, so adding more free keys is what
    raises capacity. This endpoint shows that effect immediately.
    """
    snap = brain.pool_status()
    snap["reply_cache"] = REPLY_CACHE.stats()
    snap["nvidia_keys"] = apikeys.RING.summary(apikeys.resolve(None))
    return snap


class KeysReq(BaseModel):
    api_key: Optional[str] = None


@app.post("/api/keys")
def keys_status(req: KeysReq):
    """Health of every NVIDIA key, for the key manager in the UI.

    POST rather than GET on purpose: a key must never travel in a URL, because
    URLs end up in access logs, proxy logs and browser history. Only MASKED
    labels (last four characters) are ever sent back.
    """
    raw = apikeys.resolve(req.api_key)
    snap = apikeys.RING.summary(raw)
    snap["server_keys"] = len(apikeys.split_keys(apikeys.env_keys()))
    snap["browser_keys"] = len(apikeys.split_keys(req.api_key))
    snap["cooldown_sec"] = apikeys.cooldown_429()
    snap["quarantine_sec"] = apikeys.quarantine_sec()
    return snap


@app.post("/api/keys/reset")
def keys_reset(req: KeysReq):
    """Forget remembered health, so a quarantined key gets another chance now.

    This exists because the quarantine is deliberately long (10 minutes). If you
    fix a key upstream you should not have to wait, or restart the server.
    """
    raw = apikeys.resolve(req.api_key)
    apikeys.RING.forget(raw if (req.api_key or "").strip() else None)
    return {"ok": True, "keys": apikeys.RING.summary(raw)}


@app.get("/api/config")
def config(site: Optional[str] = None):
    """Public per-tenant config the browser widget uses to theme itself and pick
    its default voice/greeting. Contains NO secrets."""
    tenant = tenants.get_tenant(site)
    return {
        "config": tenant.public_config(),
        "modes": status_payload(REGISTRY, tenant.lang or "en"),
        "brain": brain.brain_status(),
        "nim_models": brain.nim_models(),
        "nim_default": brain.default_nim_model(),
    }


@app.post("/api/reset")
def reset_session(req: ResetRequest):
    """Clear a server-side conversation session (New conversation)."""
    tenant = tenants.get_tenant(req.site)
    sessions.reset(tenant.id, req.session_id)
    return {"ok": True}


@app.get("/api/engines")
def engines(lang: str = "en"):
    return {
        "modes": status_payload(REGISTRY, lang),
        "brain": brain.brain_status(),
        "nim_models": brain.nim_models(),
        "nim_default": brain.default_nim_model(),
    }


@app.post("/api/verify-key")
async def verify_key(req: VerifyKeyRequest):
    """Live check that a user's NVIDIA NIM key + model actually work."""
    try:
        return await brain.verify_nim_key(req.api_key, req.model, client=_http_client)
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


@app.post("/api/nim-models")
async def nim_models(req: NimModelsRequest):
    """Return the caller's REAL, live NVIDIA NIM model catalogue (every chat
    model their key can use), fetched from NVIDIA - not a hard-coded subset.
    Falls back to a static list on any error so the UI always has options."""
    try:
        return await brain.list_nim_models(req.api_key, client=_http_client)
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}",
                "models": brain.nim_models(), "live": False}


def _history_for(tenant, req) -> Optional[List[Dict]]:
    """Prefer server-side session history (bounded, per-tenant); fall back to
    client-supplied history for stateless callers."""
    if req.session_id:
        hist = sessions.history(tenant.id, req.session_id)
        if hist:
            return hist
    return req.history


@app.post("/api/reply")
async def reply(req: ReplyRequest, request: Request):
    tenant = tenants.get_tenant(req.site)
    if not _auth_ok(request, tenant):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    limited = _too_many(request, tenant)
    if limited is not None:
        return limited
    _bump("reply_total")
    text = (req.text or "").strip()[:4000]
    if not text:
        return {"reply": generate_reply(""), "source": "offline"}

    history = _history_for(tenant, req)
    bargs = _brain_args_for(tenant, req)

    # Instant answer for a question we've already answered. Skips the provider
    # entirely, so it costs no rate-limit budget and returns in microseconds
    # instead of seconds. Only stand-alone, non-personal questions qualify.
    if is_cacheable(text, history):
        hit = REPLY_CACHE.get(text, site=tenant.id, system_prompt=bargs["system_prompt"])
        if hit:
            _bump("reply_cache_hit_total")
            if req.session_id:
                sessions.append(tenant.id, req.session_id, "user", text, tenant.max_history)
                sessions.append(tenant.id, req.session_id, "assistant", hit, tenant.max_history)
            return {"reply": hit, "source": "cache", "used": "instant cache"}

    ai = None
    used = None
    async with _GLOBAL_INFLIGHT:
        _bump("inflight")
        try:
            # 1) NVIDIA NIM with an explicit key (UI or per-tenant).
            if (bargs["provider"] or "").lower() == "nvidia" and (bargs["api_key"] or ""):
                try:
                    with latency.LATENCY.timer("brain"):
                        ai = await brain.generate_reply_nim(
                            text, history, api_key=bargs["api_key"], model=bargs["model"],
                            client=_http_client, system_prompt=bargs["system_prompt"])
                    if ai:
                        used = f"NVIDIA NIM ({bargs['model'] or brain.default_nim_model()})"
                except Exception:
                    ai = None
            # 2) Any free provider configured on the server (.env) / per-tenant key.
            if not ai:
                try:
                    with latency.LATENCY.timer("brain"):
                        ai = await brain.generate_reply_ai(
                            text, history, client=_http_client, system_prompt=bargs["system_prompt"])
                    if ai:
                        used = "server AI"
                except Exception:
                    ai = None
        finally:
            _bump("inflight", -1)

    source = "ai" if ai else "offline"
    if not ai:
        _logx(logging.INFO, "brain_offline_fallback", rid=getattr(request.state, "rid", ""))
    reply_text = ai or generate_reply(text, lang=req.lang)
    # Remember real AI answers so the next caller asking the same thing gets it
    # instantly and we don't spend another request from the free pool.
    if ai and is_cacheable(text, history):
        REPLY_CACHE.put(text, reply_text, site=tenant.id,
                        system_prompt=bargs["system_prompt"])
    # Persist the turn to the session (if one was provided).
    if req.session_id:
        sessions.append(tenant.id, req.session_id, "user", text, tenant.max_history)
        sessions.append(tenant.id, req.session_id, "assistant", reply_text, tenant.max_history)
    if ai:
        return {"reply": reply_text, "source": source, "used": used}
    return {"reply": reply_text, "source": source}


@app.post("/api/reply-stream")
async def reply_stream(req: ReplyRequest, request: Request):
    """Stream the reply token-by-token as Server-Sent Events so the caller can
    show text instantly and start speaking each sentence as soon as it's ready.

    Event lines:
      data: {"delta": "..."}       incremental text
      data: {"done": true, "reply": "...", "source": "ai|offline"}
      data: {"error": "..."}       only on rate-limit / auth, before done
    Always ends with a done event; never leaves the client hanging.
    """
    import json as _json

    tenant = tenants.get_tenant(req.site)
    if not _auth_ok(request, tenant):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    limited = _too_many(request, tenant)
    if limited is not None:
        return limited
    _bump("reply_total")

    text = (req.text or "").strip()[:4000]
    history = _history_for(tenant, req)
    bargs = _brain_args_for(tenant, req)

    async def gen():
        full = ""
        source = "offline"
        # Instant answer for a repeat question: no provider call, no rate-limit
        # budget spent, and the caller starts hearing it straight away.
        if text and is_cacheable(text, history):
            hit = REPLY_CACHE.get(text, site=tenant.id,
                                  system_prompt=bargs["system_prompt"])
            if hit:
                _bump("reply_cache_hit_total")
                yield f"data: {_json.dumps({'delta': hit})}\n\n"
                if req.session_id:
                    sessions.append(tenant.id, req.session_id, "user", text, tenant.max_history)
                    sessions.append(tenant.id, req.session_id, "assistant", hit, tenant.max_history)
                yield f"data: {_json.dumps({'done': True, 'reply': hit, 'source': 'cache'})}\n\n"
                return
        async with _GLOBAL_INFLIGHT:
            _bump("inflight")
            try:
                if text:
                    # 1) True token streaming (explicit key, else a server provider).
                    try:
                        async for piece in brain.stream_reply(
                            text, history,
                            provider=bargs["provider"], api_key=bargs["api_key"],
                            model=bargs["model"], client=_http_client,
                            system_prompt=bargs["system_prompt"],
                        ):
                            if piece:
                                full += piece
                                source = "ai"
                                yield f"data: {_json.dumps({'delta': piece})}\n\n"
                    except Exception:
                        pass
                    # 2) No stream? fall back to a one-shot call, emitted as one delta.
                    if not full:
                        one = None
                        try:
                            if (bargs["provider"] or "").lower() == "nvidia" and (bargs["api_key"] or ""):
                                one = await brain.generate_reply_nim(
                                    text, history, api_key=bargs["api_key"], model=bargs["model"],
                                    client=_http_client, system_prompt=bargs["system_prompt"])
                            if not one:
                                one = await brain.generate_reply_ai(
                                    text, history, client=_http_client,
                                    system_prompt=bargs["system_prompt"])
                        except Exception:
                            one = None
                        if one:
                            full = one
                            source = "ai"
                            yield f"data: {_json.dumps({'delta': one})}\n\n"
                    # 3) Still nothing? offline responder.
                    if not full:
                        full = generate_reply(text, lang=req.lang)
                        source = "offline"
                        yield f"data: {_json.dumps({'delta': full})}\n\n"
                else:
                    full = generate_reply("")
                    yield f"data: {_json.dumps({'delta': full})}\n\n"
            finally:
                _bump("inflight", -1)
        # Remember real AI answers for the next caller who asks the same thing.
        if source == "ai" and full and is_cacheable(text, history):
            REPLY_CACHE.put(text, full, site=tenant.id,
                            system_prompt=bargs["system_prompt"])
        # Persist the completed turn to the session (if one was provided).
        if req.session_id and text:
            sessions.append(tenant.id, req.session_id, "user", text, tenant.max_history)
            sessions.append(tenant.id, req.session_id, "assistant", full, tenant.max_history)
        yield f"data: {_json.dumps({'done': True, 'reply': full, 'source': source})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive",
    })


async def _do_synth(engine, req: TTSRequest):
    """Run a synth honoring the right concurrency lane (network vs CPU) and using
    the engine's native async path when it has one."""
    av = engine.availability_cached()
    use_net = av.needs_network
    sema = _net_sema if use_net else _cpu_sema
    async with sema:
        # Pass the per-request NVIDIA key only to engines that accept it (Magpie).
        extra = {}
        if getattr(engine, "id", "") == "magpie":
            # v0.0.45 - Magpie rotates keys too. It used to take whatever single
            # key the browser sent, so a rate limited key meant a silent voice
            # even when other healthy keys were available.
            _mk = apikeys.RING.pick(apikeys.resolve(req.api_key))
            if _mk:
                extra["api_key"] = _mk
        asynch = getattr(engine, "asynthesize", None)
        if callable(asynch):
            return await asynch(req.text, voice=req.voice, lang=req.lang, rate=req.rate, pitch=req.pitch, **extra)
        return await run_in_threadpool(
            partial(engine.synthesize, req.text,
                    voice=req.voice, lang=req.lang, rate=req.rate, pitch=req.pitch, **extra),
        )


@app.post("/api/tts")
async def tts(req: TTSRequest, request: Request):
    tenant = tenants.get_tenant(req.site)
    if not _auth_ok(request, tenant):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    limited = _too_many(request, tenant)
    if limited is not None:
        return limited
    # Fill any unset fields from the tenant's defaults.
    req.mode = (req.mode or tenant.voice_mode or "best").strip()
    if req.voice is None:
        req.voice = tenant.voice or None
    if req.rate is None:
        req.rate = tenant.rate
    if req.pitch is None:
        req.pitch = tenant.pitch
    # Clamp voice controls to sane, well-balanced ranges (avoid distorted audio).
    req.rate = _clampf(req.rate, 0.5, 2.0, 1.0)
    req.pitch = _clampf(req.pitch, -12.0, 12.0, 0.0)
    req.text = (req.text or "")[:2000]

    engine = REGISTRY.get(req.mode)
    if engine is None:
        return JSONResponse({"error": f"unknown mode '{req.mode}'"}, status_code=400)
    if not (req.text or "").strip():
        return JSONResponse({"error": "empty text"}, status_code=400)
    _bump("tts_total")
    ui_key = (req.api_key or "").strip()
    rid = getattr(request.state, "rid", "")

    # Serve identical requests straight from cache (keyed on what was asked for).
    key = _cache_key(req.mode, req.voice, req.lang, req.rate, req.pitch, req.text.strip())
    cached = _cache_get(key)
    if cached is not None:
        audio, mime, eng, voice, detail = cached
        return Response(content=audio, media_type=mime, headers={
            "X-Voice-Engine": eng, "X-Voice-Name": voice, "X-Voice-Detail": detail,
            "X-Voice-Cache": "hit", "Cache-Control": "public, max-age=300",
        })

    # Fallback chain: try the requested voice first, then the next-best READY
    # engines. A single unavailable/slow/broken engine can never break a reply -
    # if everything server-side fails we tell the browser to use its own voice.
    candidates = _candidates(req.mode)
    any_available = False
    requested_av = None
    last_error = None
    # Hard ceiling across the WHOLE fallback chain, so a bad day cannot chain
    # several timeouts together into a minute of silence.
    _synth_deadline = time.monotonic() + _SYNTH_TOTAL
    async with _GLOBAL_INFLIGHT:
        _bump("inflight")
        try:
            for cid in candidates:
                if time.monotonic() >= _synth_deadline:
                    last_error = "synthesis budget exhausted"
                    break
                eng = engine if cid == req.mode else REGISTRY.get(cid)
                if eng is None:
                    continue
                av = eng.availability_cached()
                if cid == req.mode:
                    requested_av = av
                # Magpie can be driven by a UI-supplied key even if the server
                # env has none.
                if not (av.ok or (cid == "magpie" and bool(ui_key))):
                    continue
                any_available = True
                _synth_budget = max(1.0, min(_SYNTH_TIMEOUT,
                                             _synth_deadline - time.monotonic()))
                try:
                    with latency.LATENCY.timer("tts"):
                        result = await asyncio.wait_for(_do_synth(eng, req), timeout=_synth_budget)
                except asyncio.TimeoutError:
                    last_error = f"{cid} timed out after {_synth_budget:.1f}s"
                    _bump("synth_error_total")
                    _logx(logging.WARNING, "tts_timeout", rid=rid, mode=cid, timeout=_synth_budget)
                    continue
                except Exception as e:
                    last_error = f"{type(e).__name__}: {e}"
                    _bump("synth_error_total")
                    _logx(logging.WARNING, "tts_synth_failed", rid=rid, mode=cid, error=last_error)
                    continue
                if not _valid_audio(result):
                    last_error = f"{cid} produced invalid/empty audio"
                    _bump("synth_error_total")
                    _logx(logging.WARNING, "tts_invalid_audio", rid=rid, mode=cid)
                    continue
                fell_back = cid != req.mode
                if fell_back:
                    _bump("tts_fallback_total")
                    _logx(logging.WARNING, "tts_fallback", rid=rid, requested=req.mode, used=cid)
                _cache_put(key, (result.audio, result.mime, result.engine, result.voice, result.detail or ""))
                headers = {
                    "X-Voice-Engine": result.engine, "X-Voice-Name": result.voice,
                    "X-Voice-Detail": result.detail or "", "X-Voice-Cache": "miss",
                    "Cache-Control": "public, max-age=300",
                }
                if fell_back:
                    headers["X-Voice-Fallback"] = req.mode
                return Response(content=result.audio, media_type=result.mime, headers=headers)
        finally:
            _bump("inflight", -1)

    # No server-side engine could produce audio -> graceful browser fallback.
    if not any_available:
        _bump("tts_unavailable_total")
        # If the caller asked for an engine this deployment blocks, say so
        # plainly. Otherwise the operator sees "No voice engine is ready" and
        # goes looking for a broken install that isn't there.
        reason = getattr(requested_av, "reason", None)
        if not reason and not cpu_profile.is_allowed(req.mode):
            reason = "'%s' is disabled here: %s" % (
                req.mode, cpu_profile.block_reason(req.mode))
        reason = reason or "No voice engine is ready."
        setup = getattr(requested_av, "setup", "") or ""
        _logx(logging.WARNING, "tts_unavailable", rid=rid, mode=req.mode)
        return JSONResponse(
            {"error": reason, "setup": setup, "mode": req.mode, "fallback": "browser"},
            status_code=503,
        )
    _bump("errors_total")
    _logx(logging.ERROR, "tts_all_failed", rid=rid, mode=req.mode, error=last_error)
    return JSONResponse(
        {"error": last_error or "synthesis failed", "mode": req.mode, "fallback": "browser"},
        status_code=502,
    )


# ---- optional server-side speech-to-text (browser does STT for free) ----
_whisper_model = None
_whisper_lock = threading.Lock()


def _get_whisper():
    global _whisper_model
    if _whisper_model is None:
        with _whisper_lock:
            if _whisper_model is None:
                from faster_whisper import WhisperModel
                _whisper_model = WhisperModel(
                    os.environ.get("WHISPER_MODEL", "base"), device="cpu", compute_type="int8")
    return _whisper_model


@app.get("/api/stt-status")
def stt_status():
    """Tells the browser whether fast cloud capture is available, so the front
    end can pick the best 'words taker' instead of guessing."""
    return fast_stt.status()


@app.post("/api/stt")
async def stt(
    audio: UploadFile = File(...),
    lang: str = Form("en"),
    key: str = Form(""),
    model: str = Form(""),
    boost: str = Form(""),
):
    """Transcribe one spoken turn, fastest path first.

    1. NVIDIA NIM Parakeet-class ASR (RTFx in the thousands - a spoken turn
       comes back in milliseconds of model time). This is a NETWORK call, so it
       does NOT take the CPU semaphore and does not block local voices.
    2. Local faster-whisper, if installed, for fully offline use.
    3. HTTP 503 with a reason, so the browser falls back to its own recognizer
       instead of losing the user's words.
    """
    data = await audio.read()

    if fast_stt.enabled() and fast_stt.api_key(key):
        with latency.LATENCY.timer("stt"):
            got = await fast_stt.transcribe(
                data,
                filename=(audio.filename or "turn.webm"),
                content_type=(audio.content_type or "audio/webm"),
                lang=lang,
                key=key,
                model=model,
                boost=boost,
            )
        if got.get("text"):
            return {
                "text": got["text"],
                "engine": got.get("engine", "nvidia-asr"),
                "ms": got.get("ms", 0),
            }
        log.info("fast stt unavailable, falling back: %s", got.get("error", ""))
        _fast_stt_error = str(got.get("error", ""))
    else:
        _fast_stt_error = "no NVIDIA key for fast capture"

    try:
        import faster_whisper  # noqa: F401
    except Exception:
        return JSONResponse(
            {
                "error": _fast_stt_error or "no transcription backend available",
                "setup": (
                    "Add NVIDIA_API_KEY for fast cloud capture (free at "
                    "build.nvidia.com), or pip install faster-whisper for offline use"
                ),
            },
            status_code=503,
        )
    # Unique temp file per request (concurrent-safe).
    fd, tmp_path = tempfile.mkstemp(suffix=".audio", dir=str(HERE))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)

        def _transcribe():
            model = _get_whisper()  # cached across requests
            segments, _ = model.transcribe(tmp_path, language=None if lang == "auto" else lang)
            return " ".join(s.text for s in segments).strip()

        async with _cpu_sema:  # STT is CPU-heavy too
            text = await run_in_threadpool(_transcribe)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
    return {"text": text}


# Per-chunk synthesis ceiling for the realtime socket. Deliberately far tighter
# than the HTTP _SYNTH_TOTAL: that budget covers one whole reply, while this
# covers one sentence of a reply that is already being spoken.
try:
    _RT_SYNTH_TOTAL = max(1.0, float(os.environ.get("VOICE_RT_SYNTH_TOTAL", "") or 8.0))
except ValueError:
    _RT_SYNTH_TOTAL = 8.0


# --------------------------- realtime voice socket ---------------------------
#
# Full-duplex replacement for the POST /api/stt + /api/reply-stream + /api/tts
# round-trip loop. The HTTP routes above are all still live and unchanged, so
# existing clients and the widget keep working exactly as before; this is an
# additional transport, not a migration.
#
# Everything conversational lives in realtime.RealtimeSession. This route only
# resolves the tenant and hands the session three callables.

@app.websocket("/ws/voice")
async def ws_voice(ws: WebSocket):
    qp = ws.query_params
    tenant = tenants.get_tenant(qp.get("site") or None)

    # Auth. A WebSocket cannot carry custom headers from the browser, so a
    # token-protected tenant accepts it via query string instead. We close with
    # 4401 (an application code) rather than refusing the handshake, because a
    # bare refusal gives the client no way to tell auth failure from a network
    # problem and it will sit there retrying forever.
    if tenant.api_token:
        got = (qp.get("token") or "").strip()
        if got != tenant.api_token:
            await ws.accept()
            await ws.close(code=4401)
            return

    # Rate limit on CONNECTIONS. The per-turn cost is bounded by the pipeline
    # itself, but opening sockets in a loop must not be free.
    client_host = ws.client.host if ws.client else "unknown"
    ok, retry = rate_limiter.check(f"{tenant.id}:ws:{client_host}",
                                   tenant.rate_per_min, tenant.burst)
    if not ok:
        await ws.accept()
        await ws.send_text(json.dumps({"t": "error", "error": "rate limited",
                                       "retry_after": retry}))
        await ws.close(code=4429)
        return

    await ws.accept()
    _bump("ws_voice_total")

    lang = (qp.get("lang") or tenant.lang or "en").strip()
    mode = (qp.get("mode") or tenant.voice_mode or "best").strip()
    voice = (qp.get("voice") or tenant.voice or "").strip() or None
    ui_key = (qp.get("api_key") or "").strip()
    session_id = (qp.get("session_id") or "").strip()
    sensitivity = _clampf(qp.get("sensitivity"), 0.5, 2.0, 1.0)
    rate = _clampf(qp.get("rate"), 0.5, 2.0, tenant.rate)
    pitch = _clampf(qp.get("pitch"), -12.0, 12.0, tenant.pitch)

    history = sessions.history(tenant.id, session_id) if session_id else None

    async def _transcribe(wav: bytes):
        """Local first, cloud second.

        The old order was cloud-only, so a fresh install with no NVIDIA key
        simply could not hear anything, and every turn paid a network round trip
        even with a perfectly good local model on disk. Local also keeps caller
        audio on the box, which matters for a phone system.
        """
        t0 = time.perf_counter()
        got = None
        if asr_local.batch_available():
            try:
                got = await asr_local.transcribe(wav)
            except Exception as exc:                        # noqa: BLE001
                log.warning("local asr failed, falling back: %s", exc)
                got = None
        if not (isinstance(got, dict) and str(got.get("text") or "").strip()):
            try:
                got = await fast_stt.transcribe(
                    wav, filename="turn.wav", content_type="audio/wav",
                    lang=lang, key=ui_key or None, model=None, boost=True,
                ) or got
            except Exception as exc:                        # noqa: BLE001
                log.warning("cloud asr failed: %s", exc)
        latency.LATENCY.record("stt", (time.perf_counter() - t0) * 1000.0)
        return got or {}

    async def _reply(text: str, hist):
        bargs = {
            "provider": (tenant.brain_provider or "").strip() or None,
            "model": (tenant.brain_model or "").strip() or None,
            "api_key": ui_key or tenant.brain_key(),
            "system_prompt": tenant.system_prompt or None,
        }
        first = True
        t0 = time.perf_counter()
        async for tok in brain.stream_reply(text, hist, client=_http_client,
                                            **bargs):
            if first:
                latency.LATENCY.record("brain",
                                       (time.perf_counter() - t0) * 1000.0)
                first = False
            yield tok

    async def _synth(text: str):
        # Reuse the exact HTTP synth path: same engine registry, same
        # concurrency lanes, same cache. A second implementation here would be
        # a second thing to keep correct.
        key = _cache_key(mode, voice, lang, rate, pitch, text)
        hit = _cache_get(key)
        if hit:
            return {"audio": hit[0], "mime": hit[1]}

        req = TTSRequest(text=text, mode=mode, voice=voice, lang=lang,
                         rate=rate, pitch=pitch, api_key=ui_key or None)
        t0 = time.perf_counter()

        # ONE deadline for the whole fallback chain, not per engine. A flat
        # per-engine timeout multiplied across a seven-engine chain is over a
        # minute of dead air, which on a live call is indistinguishable from a
        # dropped connection. The ceiling is also tighter than the HTTP one:
        # this is a single sentence inside an ongoing turn, and audio that
        # arrives late is worse than useless because the conversation has
        # already moved past it.
        _synth_deadline = time.monotonic() + _RT_SYNTH_TOTAL
        res = None
        for eid in _candidates(mode):
            if time.monotonic() >= _synth_deadline:
                log.warning("realtime synthesis budget exhausted")
                break
            eng = REGISTRY.get(eid)
            if eng is None:
                continue
            _synth_budget = max(0.5, min(_SYNTH_TIMEOUT,
                                         _synth_deadline - time.monotonic()))
            try:
                res = await asyncio.wait_for(_do_synth(eng, req),
                                             timeout=_synth_budget)
            except asyncio.CancelledError:
                # A barge-in cancelled us. This is not an engine failure and
                # must NOT fall through to the next voice - the caller is
                # talking and wants silence.
                raise
            except Exception:                       # noqa: BLE001
                res = None
                continue
            if _valid_audio(res):
                break
            res = None

        if not _valid_audio(res):
            return None
        latency.LATENCY.record("tts", (time.perf_counter() - t0) * 1000.0)
        _cache_put(key, (res.audio, res.mime))
        return {"audio": res.audio, "mime": res.mime}

    def _persist(session):
        turn_ms = (session.metrics.to_dict() or {}).get("total_ms") or 0
        if turn_ms:
            latency.LATENCY.record("turn", float(turn_ms))
        if not session_id:
            return
        for m in session.history[len(history or []):]:
            sessions.append(tenant.id, session_id, m.get("role", "user"),
                            m.get("content", ""), tenant.max_history)

    # A true streaming recogniser when one is installed. This is the biggest
    # latency win in the stack: words commit as they are spoken instead of after
    # a round trip per tick, so the reply starts forming before the caller has
    # finished. None => the previous cloud path, byte for byte.
    _streaming = asr_local.make_stream if asr_local.streaming_available() else None

    deps = realtime_server.make_deps(transcribe=_transcribe,
                                     stream_reply=_reply,
                                     synth=_synth,
                                     streaming=_streaming)
    await realtime_server.run_socket(ws, deps, sensitivity=sensitivity,
                                     history=history, on_close=_persist)


@app.get("/api/voice-status")
def voice_status():
    """Can this install actually hear and speak, and if not, what fixes it?

    The worst failure this product had was a SILENT one: with no ASR and no TTS
    model, the call connected, the socket stayed open, the UI looked healthy, and
    nothing was ever heard or said. An operator could not tell that apart from a
    bug. One GET now answers it, and every hint names a command that exists.
    """
    try:
        asr = asr_local.status()
    except Exception as exc:                               # noqa: BLE001
        asr = {"error": str(exc)}

    try:
        cloud = bool(fast_stt.enabled())
    except Exception:                                      # noqa: BLE001
        cloud = False

    items = (REGISTRY.items() if isinstance(REGISTRY, dict)
             else [(getattr(e, "id", str(i)), e)
                   for i, e in enumerate(REGISTRY or [])])

    engines_out = []
    can_speak = False
    for eid, eng in items:
        reason = ""
        allowed = True
        try:
            if not cpu_profile.is_allowed(eid):
                allowed = False
                reason = cpu_profile.block_reason(eid) or "blocked by CPU profile"
        except Exception:                                  # noqa: BLE001
            pass
        ok = False
        if allowed:
            try:
                av = eng.availability()
                ok = bool(getattr(av, "ok", False))
                if not ok:
                    reason = str(getattr(av, "reason", "") or "unavailable")
            except Exception as exc:                       # noqa: BLE001
                reason = str(exc)
        engines_out.append({"id": eid, "available": ok, "reason": reason})
        if ok:
            can_speak = True

    can_hear = bool(asr.get("streaming") or asr.get("batch") or cloud)

    hints = []
    if not can_hear:
        hints.append("No speech recognition installed. "
                     "Run: python setup_voices.py --asr")
    if not can_speak:
        hints.append("No working voice installed. "
                     "Run: python setup_voices.py --tts")
    if can_hear and not asr.get("streaming"):
        hints.append("Streaming recognition is not installed, so replies wait "
                     "for the end of each turn. Run: "
                     "python setup_voices.py --asr")

    return {
        "ok": bool(can_hear and can_speak),
        "can_hear": can_hear,
        "can_speak": can_speak,
        "asr": asr,
        "cloud_asr": cloud,
        "tts_engines": engines_out,
        "hint": " ".join(hints),
    }


@app.get("/")
def index():
    return FileResponse(str(STATIC / "index.html"))


# MUST stay last: this is a catch-all mount and would shadow every route
# declared after it, including /ws/voice.
app.mount("/", StaticFiles(directory=str(STATIC), html=True), name="static")
