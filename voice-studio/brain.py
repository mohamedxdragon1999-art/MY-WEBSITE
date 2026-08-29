"""The agent "brain": turn what the user said into a reply.

By default the reply is produced by a tiny offline rule-based responder
(`reply.generate_reply`) so the site works with zero setup and zero cost.

If you add ANY free cloud AI provider key (see below), the brain automatically
upgrades to a real LLM for far more natural, context-aware answers - and falls
back to the offline responder if the provider is slow or errors, so it never
breaks.

All providers below have a genuinely FREE tier and speak the OpenAI-compatible
`/chat/completions` API, so one small client handles them all. Set one or more
of these environment variables (or put them in a .env file next to this file):

  GROQ_API_KEY        - Groq         (very fast, free)   https://console.groq.com
  CEREBRAS_API_KEY    - Cerebras     (very fast, free)   https://cloud.cerebras.ai
  NVIDIA_API_KEY      - NVIDIA NIM   (free)              https://build.nvidia.com
  GEMINI_API_KEY      - Google Gemini(free tier)         https://aistudio.google.com
  MISTRAL_API_KEY     - Mistral      (free tier)         https://console.mistral.ai
  OPENROUTER_API_KEY  - OpenRouter   (free models)       https://openrouter.ai
  TOGETHER_API_KEY    - Together AI  (free models)       https://api.together.ai

Optional overrides:
  BRAIN_ORDER   comma-separated provider ids to set priority, e.g. "groq,nvidia"
  <PROVIDER>_MODEL   override the model, e.g. GROQ_MODEL=llama-3.1-8b-instant
  BRAIN_DISABLE=1    force the offline responder even if keys are present
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Dict, List, Optional

from reply import generate_reply
from pool import POOL
import apikeys

# --- circuit breaker ------------------------------------------------------
# If a provider errors repeatedly we "open the circuit" and skip it for a short
# cooldown, so one flaky/slow provider can't drag every request down under load.
_CB_FAILS: Dict[str, int] = {}
_CB_OPEN_UNTIL: Dict[str, float] = {}
_CB_THRESHOLD = 4
_CB_COOLDOWN = 30.0

# --- v7.0 LATENCY BUDGETS --------------------------------------------------
# The single worst latency bug in this file was that the one-shot provider
# calls passed NO timeout at all, so they silently inherited the client
# default of 20s. Because providers are tried one after another, one hung
# provider cost the caller 20 seconds of dead air before the next was even
# attempted. In a voice call that is not "slow", it is a hang.
#
# We have fallbacks, so an individual attempt should be abandoned FAST. It is
# always better to drop a stalling provider after a few seconds and ask the
# next one than to keep waiting on a request that is probably never coming.


def _envf(name: str, default: float) -> float:
    """Read a float from the environment without ever raising."""
    try:
        raw = os.environ.get(name, "")
        return float(raw) if str(raw).strip() else default
    except (TypeError, ValueError):
        return default


def _connect_timeout() -> float:
    """TCP/TLS connect budget. A provider that cannot be reached quickly is
    almost certainly down, and we hold warm connections anyway."""
    return max(1.0, _envf("BRAIN_CONNECT_TIMEOUT", 3.0))


def _attempt_timeout() -> float:
    """Per-attempt read budget for a NON-streaming reply."""
    return max(2.0, _envf("BRAIN_ATTEMPT_TIMEOUT", 7.0))


def _stream_read_timeout() -> float:
    """Gap allowed BETWEEN streamed tokens.

    This is a read timeout, not a total timeout, so it does not cap the length
    of an answer: every token received resets it. It only fires when a provider
    has gone quiet, which is exactly the failure we want to abandon early.
    """
    return max(2.0, _envf("BRAIN_STREAM_READ_TIMEOUT", 6.0))


def _total_budget() -> float:
    """Hard ceiling on the whole provider-fallback loop.

    Without this, four providers x one attempt each could chain into half a
    minute of silence. When the budget is gone we stop trying and let the
    caller answer from the offline brain immediately - a fast local reply beats
    a perfect reply that arrives after the user has given up.
    """
    return max(3.0, _envf("BRAIN_TOTAL_BUDGET", 12.0))


def _timeout_for(read: float):
    """Build an httpx.Timeout with a short connect and the given read budget."""
    import httpx
    return httpx.Timeout(read, connect=_connect_timeout())


def _cb_open(pid: str) -> bool:
    return time.monotonic() < _CB_OPEN_UNTIL.get(pid, 0.0)


def _cb_fail(pid: str) -> None:
    n = _CB_FAILS.get(pid, 0) + 1
    _CB_FAILS[pid] = n
    if n >= _CB_THRESHOLD:
        _CB_OPEN_UNTIL[pid] = time.monotonic() + _CB_COOLDOWN
        _CB_FAILS[pid] = 0


def _cb_ok(pid: str) -> None:
    _CB_FAILS.pop(pid, None)
    _CB_OPEN_UNTIL.pop(pid, None)

SYSTEM_PROMPT = (
    "You are Alex, a warm, upbeat human customer-support agent speaking OUT LOUD "
    "on a real-time phone-style voice call, like a natural human conversation. "
    "Talk like a real person on the phone: use natural contractions (I'll, "
    "you're, let's), everyday words, and a friendly, relaxed tone. Sound "
    "unscripted and human, not like a manual being read. "
    "Open with a quick, genuine acknowledgment when it fits (\"Got it\", \"Oh "
    "for sure\", \"Happy to help\", \"Ah, sorry to hear that\"), and occasionally "
    "use a light natural filler such as \"well,\" \"honestly,\" or \"okay so\" when "
    "it sounds natural \u2014 but never overdo it. "
    "Keep it to ONE thought at a time: reply in 1-2 short spoken sentences "
    "(three only if truly needed) so the caller can jump in, just like a real "
    "back-and-forth. Vary your sentence length and rhythm so it never sounds "
    "robotic. Use natural punctuation \u2014 commas and periods \u2014 so the voice "
    "pauses in the right places; an occasional \"...\" is fine for a natural beat. "
    "Mirror the caller's energy and pace. If they pause to think, wait for them; "
    "never rush or talk over them. "
    "Never use markdown, bullet points, numbered lists, emojis, or headings. "
    "CRITICAL: never write stage directions or action words of any kind - not "
    "[sigh], not *sighs*, not (pause), not <laughs>, not \"Sighs.\" - because "
    "every character you write is read aloud verbatim, so the caller would "
    "literally hear the word \"sigh\". Express emotion through your WORD CHOICE "
    "and punctuation only; the voice layer adds the real sighs, warmth and "
    "pauses acoustically. "
    "Don't spell out URLs or long codes. Ask exactly one short clarifying "
    "question when you truly need more detail, otherwise just help. If the caller "
    "asks for a human, warmly reassure them you'll connect them right away. Never "
    "mention that you are an AI or a language model. "
    # --- speed: the first sentence is spoken before the rest is generated ---
    "SPEED: make your FIRST sentence short and immediately useful - under about "
    "twelve words - because the caller hears it out loud while you are still "
    "finishing the rest. Never open with a throat-clearing preamble like \"Sure, "
    "I can definitely help you with that today\" - lead with the actual answer or "
    "a two-word acknowledgment, then continue. "
    # --- emotion: word choice is the model's job, acoustics is ours ---
    "EMOTION: the voice layer reads your wording and automatically adds real "
    "warmth, slowing, pitch and pauses, so choose words that carry the feeling "
    "you mean. Say \"I'm sorry\" when apologising, \"great news\" when it is good "
    "news, \"let me check\" before a lookup - these phrases are what tell the "
    "voice how to sound. Punctuate properly: commas become real breaths, a "
    "question mark becomes a real rising tone, and a period becomes a real stop. "
    # --- spoken-number handling, straight from voice-agent practice ---
    "NUMBERS: speak digits the way a person would - a postcode or reference like "
    "94107 is \"nine four one zero seven\", a year is \"twenty twenty six\", "
    "money is \"nineteen dollars ninety nine\". Never read a code as one huge "
    "number. "
    # --- v7.3: your input is SPEECH RECOGNITION OUTPUT, not typed text ---
    "MISHEARD WORDS: everything you receive came from speech recognition, so it "
    "can contain words the caller never said. If a message is garbled, "
    "self-contradictory, or contains a word that clearly does not fit the "
    "context, do NOT confidently answer the nonsense and do NOT invent details "
    "to paper over it. Ask one short, natural clarifier instead - \"Sorry, did "
    "you say Tuesday?\" or \"I caught most of that, could you say the last bit "
    "again?\". But do not be pedantic: if only one word is doubtful and the "
    "intent is obvious, just answer normally. Never say the words \"transcript\", "
    "\"speech recognition\" or \"I received\" - a human would simply say they "
    "did not catch it. "
    # --- v7.3: real phone-call turn-taking ---
    "TURN-TAKING: short sounds like \"mm-hm\", \"yeah\", \"okay\", \"right\" and "
    "\"got it\" are usually the caller acknowledging you, NOT a new question - "
    "just continue naturally or say one brief word, never launch a fresh "
    "explanation. If the caller interrupts you mid-answer, do NOT restart from "
    "the beginning: answer their new point, or pick up from the part you had not "
    "yet said. Never repeat a sentence you have already spoken in this call, and "
    "never re-introduce yourself twice. If the caller goes quiet after a partial "
    "thought, they are still thinking - a brief \"mm-hm\" or \"sure\" is better "
    "than a full answer to half a question. "
    # --- v7.3: read-back of anything the caller must get exactly right ---
    "READ-BACK: when you repeat something the caller must get exactly right - an "
    "email address, a reference number, a name spelling, an appointment time - "
    "say it slowly with commas between the parts, then confirm it in the same "
    "breath: \"so that's j, s, m, i, t, h at gmail dot com, is that right?\". "
    "Spell ambiguous letters with a word when it matters: \"m for Mike\". "
    # --- v7.3: never let a lookup feel like dead air ---
    "WAITING: if you need a moment, say so out loud in a short human way "
    "(\"let me check that\", \"one sec\") rather than going silent, because the "
    "caller cannot see you working and silence on a call feels like a dropped "
    "line.\n"
    "CORRECTIONS: if the caller corrects you, accept it instantly and move on "
    "(\"ah, got it, Thursday then\"). Never argue, never defend the earlier "
    "answer, and never explain at length why you were wrong - that wastes the "
    "caller's time and sounds defensive. Just be right from now on.\n"
    "ONE AT A TIME: ask ONE question per turn. Stacking two questions into one "
    "turn is the most common way voice assistants confuse people, because the "
    "caller can only answer the last thing they heard and the first question is "
    "silently lost. If you need three details, ask for them across three turns.\n"
    "NO FILLER OPENERS: do not begin with \"Certainly!\", \"Great question!\", "
    "\"I'd be happy to help with that\" or any other stalling phrase. On a call "
    "every wasted syllable is dead air the caller has to sit through. Start with "
    "the answer.\n"
    # --- v0.0.44: the caller complained of being asked to repeat himself when
    # he had been heard perfectly. Over-clarifying is worse than a small error:
    # it makes the agent feel deaf and doubles the length of every exchange.
    "DO NOT OVER-CLARIFY: only ask the caller to repeat something when you "
    "genuinely cannot act without it. If you understood the intent, ANSWER - do "
    "not check first. Never ask about a detail you do not actually need, never "
    "ask the same thing twice, and never ask for confirmation of something the "
    "caller has already confirmed. If one word was doubtful but the meaning is "
    "clear, answer and let the caller correct you; that is what a person does. "
    "At most ONE clarifying question in a whole conversation unless the caller "
    "introduces something genuinely new and unclear.\n"
    # --- v0.0.44: capture the details that matter, and confirm them once.
    "IMPORTANT DETAILS: when the caller gives you something that must be exact - "
    "an email address, a phone number, a name, an order or reference number - "
    "repeat it back ONCE, spelled out, and ask for confirmation in the same "
    "breath. Letters one at a time and digits one at a time, briskly, not "
    "dragged out: for an email say the letters individually, then 'at gmail dot "
    "com', then 'is that right?'. For a number, read the digits in small groups. "
    "Do this immediately when you receive the detail, not later. Once the caller "
    "confirms it, treat it as settled: use it for the rest of the conversation, "
    "refer back to it naturally, and NEVER ask for it again. If the caller "
    "corrects a single letter or digit, accept just that change and read back "
    "only the corrected part."
)


def _temperature() -> float:
    try:
        return max(0.0, min(1.5, float(os.environ.get("BRAIN_TEMPERATURE", "0.6"))))
    except ValueError:
        return 0.6


def _max_tokens() -> int:
    # Short spoken replies -> fewer tokens -> the model finishes MUCH faster.
    # 200 tokens is ~2-3 spoken sentences, which is what we ask for.
    try:
        return max(32, int(os.environ.get("BRAIN_MAX_TOKENS", "200")))
    except ValueError:
        return 200

# Cloudflare builds its endpoint from the account id, so we read it up front.
_CF_ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()

# Each provider is OpenAI-compatible: POST {base}/chat/completions.
_PROVIDERS: Dict[str, Dict] = {
    "groq": {
        "label": "Groq",
        "key_env": "GROQ_API_KEY",
        "base": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
    },
    "cerebras": {
        "label": "Cerebras",
        "key_env": "CEREBRAS_API_KEY",
        "base": "https://api.cerebras.ai/v1",
        "model": "llama-3.3-70b",
    },
    "nvidia": {
        "label": "NVIDIA NIM",
        "key_env": "NVIDIA_API_KEY",
        "base": "https://integrate.api.nvidia.com/v1",
        # Small + fast by default so first-token latency is low. Users can pick
        # any bigger model live in the UI.
        "model": "meta/llama-3.1-8b-instruct",
    },
    # Cloudflare Workers AI: 10,000 free "neurons" every day, no credit card,
    # and it is an ongoing free allowance rather than a trial. Needs both
    # CLOUDFLARE_API_KEY and CLOUDFLARE_ACCOUNT_ID.
    "cloudflare": {
        "label": "Cloudflare Workers AI",
        "key_env": "CLOUDFLARE_API_KEY",
        "base": f"https://api.cloudflare.com/client/v4/accounts/{_CF_ACCOUNT}/ai/v1",
        "model": "@cf/meta/llama-3.1-8b-instruct-fast",
    },
    "gemini": {
        "label": "Google Gemini",
        "key_env": "GEMINI_API_KEY",
        "base": "https://generativelanguage.googleapis.com/v1beta/openai",
        "model": "gemini-1.5-flash",
    },
    "mistral": {
        "label": "Mistral",
        "key_env": "MISTRAL_API_KEY",
        "base": "https://api.mistral.ai/v1",
        "model": "mistral-small-latest",
    },
    "openrouter": {
        "label": "OpenRouter",
        "key_env": "OPENROUTER_API_KEY",
        "base": "https://openrouter.ai/api/v1",
        "model": "meta-llama/llama-3.3-70b-instruct:free",
        "extra_headers": {"HTTP-Referer": "http://localhost:8000", "X-Title": "Voice Studio"},
    },
    "together": {
        "label": "Together AI",
        "key_env": "TOGETHER_API_KEY",
        "base": "https://api.together.xyz/v1",
        "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
    },
}

# Fast + genuinely free first. NIM sits high because with a pooled set of free
# keys it has both good throughput and a very large daily allowance.
_DEFAULT_ORDER = ["groq", "cerebras", "nvidia", "cloudflare", "gemini",
                  "mistral", "openrouter", "together"]

# Fallback list of well-known NVIDIA NIM chat models, ONLY used if the live
# model listing (GET /v1/models with the user's key) can't be reached. The UI
# fetches the real, complete catalogue live - it is not limited to these.
# Fastest first, so the default is snappy.
NVIDIA_NIM_MODELS: List[Dict] = [
    {"id": "meta/llama-3.1-8b-instruct", "label": "Llama 3.1 8B Instruct (fastest)"},
    {"id": "meta/llama-3.3-70b-instruct", "label": "Llama 3.3 70B Instruct (best quality)"},
    {"id": "microsoft/phi-3.5-mini-instruct", "label": "Phi-3.5 Mini Instruct (fast)"},
    {"id": "qwen/qwen2.5-7b-instruct", "label": "Qwen 2.5 7B Instruct"},
    {"id": "google/gemma-2-9b-it", "label": "Gemma 2 9B"},
    {"id": "mistralai/mistral-7b-instruct-v0.3", "label": "Mistral 7B Instruct"},
    {"id": "mistralai/mixtral-8x7b-instruct-v0.1", "label": "Mixtral 8x7B Instruct"},
    {"id": "meta/llama-3.1-70b-instruct", "label": "Llama 3.1 70B Instruct"},
    {"id": "nvidia/llama-3.1-nemotron-70b-instruct", "label": "Nemotron 70B (NVIDIA-tuned)"},
    {"id": "meta/llama-3.1-405b-instruct", "label": "Llama 3.1 405B Instruct (largest)"},
]

# Substrings that mark a model as NOT a text chat model (image/video/embeddings
# /reranking/etc.) - filtered out of the live list so the picker stays useful.
_NIM_NON_CHAT = (
    "embed", "embedding", "rerank", "reward", "guard", "vila", "clip",
    "stable-diffusion", "sdxl", "flux", "image", "vision-", "ocr", "paddle",
    "parakeet", "canary", "whisper", "riva", "asr", "tts", "audio",
    "nv-embed", "retrieval", "melody", "video", "depth", "segment", "detect",
)


def nim_models() -> List[Dict]:
    """Static fallback catalogue (used only if the live listing is unavailable)."""
    return list(NVIDIA_NIM_MODELS)


def default_nim_model() -> str:
    return NVIDIA_NIM_MODELS[0]["id"]


async def list_nim_models(api_key: str, *, client=None) -> Dict:
    """Fetch the caller's REAL, live NVIDIA NIM model catalogue.

    Calls GET https://integrate.api.nvidia.com/v1/models with the user's key
    (OpenAI-compatible) and returns every chat/text model their key can use -
    not a hand-picked subset. Non-chat models (image, embeddings, ASR, ...) are
    filtered out. Falls back to the static list on any error so the UI always
    has something to show.
    """
    api_key = (api_key or "").strip()
    if not api_key:
        return {"ok": False, "error": "missing key", "models": nim_models(), "live": False}
    try:
        import httpx
    except Exception:
        return {"ok": False, "error": "httpx not installed", "models": nim_models(), "live": False}

    base = _PROVIDERS["nvidia"]["base"].rstrip("/")
    url = base + "/models"
    headers = {"Authorization": f"Bearer {api_key}"}
    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=6.0))
    try:
        r = await client.get(url, headers=headers)
        if r.status_code != 200:
            return {"ok": False, "error": f"HTTP {r.status_code}", "models": nim_models(), "live": False}
        data = r.json()
        rows = data.get("data") if isinstance(data, dict) else data
        models: List[Dict] = []
        seen = set()
        for row in (rows or []):
            mid = (row.get("id") if isinstance(row, dict) else str(row)) or ""
            mid = mid.strip()
            if not mid or mid in seen:
                continue
            low = mid.lower()
            if any(bad in low for bad in _NIM_NON_CHAT):
                continue
            seen.add(mid)
            models.append({"id": mid, "label": mid})
        if not models:
            return {"ok": False, "error": "no chat models returned", "models": nim_models(), "live": False}
        # Keep fast/small models near the top for a snappy default.
        def _rank(m):
            s = m["id"].lower()
            fast = any(t in s for t in ("8b", "7b", "mini", "small", "9b", "3b", "1b", "flash"))
            return (0 if fast else 1, m["id"])
        models.sort(key=_rank)
        return {"ok": True, "models": models, "live": True, "count": len(models)}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "models": nim_models(), "live": False}
    finally:
        if owns_client:
            await client.aclose()


# ===================== shared warm HTTP client =========================
# A cold DNS lookup + TLS handshake to a provider costs 100-300 ms, and can be
# up to ~2 s on a fresh container. Creating a new client per request pays that
# every single time. One shared, kept-alive, HTTP/2 client removes it almost
# entirely - this alone is the single biggest latency win available to us.
_CLIENT = None
_CLIENT_LOCK = threading.Lock()


def get_client():
    """Process-wide pooled HTTP client. HTTP/2 lets many concurrent callers
    share one connection instead of opening a socket each."""
    global _CLIENT
    if _CLIENT is not None:
        return _CLIENT
    try:
        import httpx
    except Exception:
        return None
    with _CLIENT_LOCK:
        if _CLIENT is not None:
            return _CLIENT
        limits = httpx.Limits(
            max_connections=200,
            max_keepalive_connections=100,
            keepalive_expiry=300.0,
        )
        timeout = httpx.Timeout(20.0, connect=6.0)
        try:
            _CLIENT = httpx.AsyncClient(limits=limits, timeout=timeout, http2=True)
        except Exception:
            # h2 package missing - HTTP/1.1 with keep-alive is still a big win.
            _CLIENT = httpx.AsyncClient(limits=limits, timeout=timeout)
        return _CLIENT


async def aclose_client() -> None:
    global _CLIENT
    if _CLIENT is not None:
        try:
            await _CLIENT.aclose()
        except Exception:
            pass
        _CLIENT = None


async def prewarm(client=None) -> Dict:
    """Open and warm a TLS connection to every configured provider at startup.

    The first caller of the day should not be the one who pays for the
    handshake. We just GET /models and throw the answer away.
    """
    c = client or get_client()
    if c is None:
        return {"warmed": []}
    warmed = []
    for p in available_providers():
        pid = p["id"]
        cfg = _PROVIDERS.get(pid)
        if not cfg:
            continue
        key = _key(pid)
        if not key:
            continue
        try:
            await c.get(
                cfg["base"].rstrip("/") + "/models",
                headers={"Authorization": f"Bearer {key}"},
                timeout=6.0,
            )
            warmed.append(pid)
        except Exception:
            continue
    return {"warmed": warmed}


# ========================= free key pool layer =========================
_POOL_READY = False


def _pool_ready() -> None:
    """Load keys from the environment into the pool exactly once."""
    global _POOL_READY
    if _POOL_READY:
        return
    POOL.load({pid: cfg["key_env"] for pid, cfg in _PROVIDERS.items()})
    _POOL_READY = True


def register_key(provider: str, key: str) -> bool:
    """Add a working key into the rotation at runtime. Pasting extra free keys
    in the UI immediately raises how many people the site can serve."""
    _pool_ready()
    return POOL.register_key((provider or "").lower().strip(), key)


def pool_status() -> Dict:
    _pool_ready()
    return POOL.snapshot()


def _key_count(pid: str) -> int:
    _pool_ready()
    p = POOL.pools.get(pid)
    return len(p) if p else 0


def _acquire(pid: str, exclude: Optional[set] = None) -> Optional[str]:
    """Next healthy key for a provider, or None if every key is saturated."""
    _pool_ready()
    slot = POOL.acquire(pid, exclude)
    return slot.key if slot else None


def _note(pid: str, key: Optional[str], *, status: Optional[int] = None,
          ok: bool = False) -> None:
    if key:
        POOL.note(pid, key, status=status, ok=ok)


# --------------- multiple keys pasted into the UI ----------------------
_UI_CURSOR = {"n": 0}
_UI_LOCK = threading.Lock()


def split_keys(raw: Optional[str]) -> List[str]:
    """Users can paste several free keys separated by commas/newlines/spaces.
    More keys = proportionally more requests per minute, still free."""
    if not raw:
        return []
    cleaned = raw.replace("\n", ",").replace("\r", ",").replace(" ", ",")
    out: List[str] = []
    for part in cleaned.split(","):
        part = part.strip()
        if part and part not in out:
            out.append(part)
    return out


def _pick_user_key(raw: Optional[str]) -> Optional[str]:
    """Round-robin across the keys the user supplied, so load is spread."""
    keys = split_keys(raw)
    if not keys:
        return None
    if len(keys) == 1:
        return keys[0]
    with _UI_LOCK:
        i = _UI_CURSOR["n"] % len(keys)
        _UI_CURSOR["n"] = (i + 1) % len(keys)
    return keys[i]


def _order() -> List[str]:
    raw = os.environ.get("BRAIN_ORDER", "").strip()
    if raw:
        ids = [x.strip() for x in raw.split(",") if x.strip() in _PROVIDERS]
        return ids + [p for p in _DEFAULT_ORDER if p not in ids]
    return list(_DEFAULT_ORDER)


def _key(pid: str) -> Optional[str]:
    """Any key for this provider, without consuming pool budget.

    Checks the plain env var first, then falls back to the pool so that a
    plural-only config (NVIDIA_API_KEYS=a,b,c) still counts as configured.
    """
    direct = os.environ.get(_PROVIDERS[pid]["key_env"], "").strip()
    if direct:
        return direct
    try:
        _pool_ready()
        p = POOL.pools.get(pid)
        if p and p.slots:
            return p.slots[0].key
    except Exception:
        pass
    return None


def available_providers() -> List[Dict]:
    """Providers that currently have a key configured, in priority order."""
    out = []
    for pid in _order():
        # Cloudflare is useless without an account id in the URL.
        if pid == "cloudflare" and not _CF_ACCOUNT:
            continue
        if _key(pid):
            p = _PROVIDERS[pid]
            model = os.environ.get(f"{pid.upper()}_MODEL", p["model"])
            out.append({"id": pid, "label": p["label"], "model": model})
    return out


def brain_status() -> Dict:
    if os.environ.get("BRAIN_DISABLE") == "1":
        return {"mode": "offline", "reason": "disabled via BRAIN_DISABLE", "providers": []}
    try:
        import httpx  # noqa: F401
        has_httpx = True
    except Exception:
        has_httpx = False
    provs = available_providers()
    if not has_httpx:
        return {"mode": "offline", "reason": "httpx not installed", "providers": [p["id"] for p in provs]}
    if not provs:
        return {"mode": "offline", "reason": "no free AI provider key set (see .env.example)", "providers": []}
    return {"mode": "ai", "active": provs[0]["label"], "providers": [p["label"] for p in provs]}


def _messages(text: str, history: Optional[List[Dict]],
              system_prompt: Optional[str] = None) -> List[Dict]:
    prompt = (system_prompt or "").strip() or SYSTEM_PROMPT
    msgs: List[Dict] = [{"role": "system", "content": prompt}]
    if history:
        for h in history[-8:]:
            # History may come from an untrusted client; tolerate any shape
            # (None, non-dict, missing keys, non-string content).
            if not isinstance(h, dict):
                continue
            role = h.get("role")
            content = _coerce_content(h.get("content")).strip()
            if role in ("user", "assistant") and content:
                msgs.append({"role": role, "content": content[:2000]})
    msgs.append({"role": "user", "content": (text or "").strip()[:2000]})
    return msgs


async def generate_reply_ai(text: str, history: Optional[List[Dict]] = None, *,
                            client=None, system_prompt: Optional[str] = None) -> Optional[str]:
    """Try each configured free provider in order; return the first good reply,
    or None if none are configured / all fail (caller falls back to offline).
    Providers whose circuit breaker is open are skipped this round."""
    if os.environ.get("BRAIN_DISABLE") == "1":
        return None
    provs = [p for p in available_providers() if not _cb_open(p["id"])]
    if not provs:
        return None
    try:
        import httpx
    except Exception:
        return None

    # Use the shared warm client so we never pay for a TLS handshake here.
    owns_client = False
    if client is None:
        client = get_client()
        if client is None:
            return None

    # Hard ceiling on the whole fallback chain (see _total_budget).
    _deadline = time.monotonic() + _total_budget()
    try:
        for p in provs:
            if time.monotonic() >= _deadline:
                break
            pid = p["id"]
            cfg = _PROVIDERS[pid]
            url = cfg["base"].rstrip("/") + "/chat/completions"
            payload = {
                "model": p["model"],
                "messages": _messages(text, history, system_prompt),
                "temperature": _temperature(),
                "max_tokens": _max_tokens(),
            }
            # Try several KEYS for this provider before giving up on it. This
            # is what turns a 429 into a sub-second retry instead of an error
            # the caller actually hears.
            tried: set = set()
            attempts = max(1, min(4, _key_count(pid)))
            for _ in range(attempts):
                key = _acquire(pid, tried) or _key(pid)
                if not key:
                    break
                tried.add(key)
                headers = {"Authorization": f"Bearer {key}",
                           "Content-Type": "application/json"}
                headers.update(cfg.get("extra_headers", {}))
                try:
                    # Never inherit the 20s client default here: with serial
                    # fallback that turns one stuck provider into 20s of dead
                    # air. Also never exceed whatever is left of the budget.
                    _left = max(1.0, _deadline - time.monotonic())
                    r = await client.post(
                        url, headers=headers, json=payload,
                        timeout=_timeout_for(min(_attempt_timeout(), _left)))
                    if r.status_code == 429:
                        # This key is spent: bench it and roll to the next one.
                        _note(pid, key, status=429)
                        continue
                    if r.status_code != 200:
                        _note(pid, key, status=r.status_code)
                        _cb_fail(pid)
                        break
                    content = _extract(r.json())
                    if content:
                        _note(pid, key, ok=True)
                        _cb_ok(pid)
                        return content
                    _note(pid, key, status=200)
                    _cb_fail(pid)
                    break
                except Exception:
                    _note(pid, key)
                    _cb_fail(pid)
                    break
        return None
    finally:
        if owns_client:
            await client.aclose()


def _coerce_content(content) -> str:
    """Content may be a plain string or a list of typed parts (some models)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for c in content:
            if isinstance(c, dict):
                parts.append(c.get("text") or c.get("content") or "")
            elif isinstance(c, str):
                parts.append(c)
        return "".join(parts)
    return ""


def _extract(data: Dict) -> Optional[str]:
    choice = (data.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    content = _coerce_content(msg.get("content")).strip()
    if not content:
        content = _coerce_content(choice.get("reasoning_content")).strip()
    return content or None


def _resolve_target(provider: Optional[str], api_key: Optional[str], model: Optional[str]):
    """Decide which endpoint/model/key to use for a reply.

    Returns (url, headers, model) or None if nothing is available (caller then
    falls back to the offline responder).
    """
    provider = (provider or "").lower().strip()
    # The user may have pasted several free keys; rotate across them.
    api_key = (_pick_user_key(api_key) or "").strip()
    # 1) User picked NVIDIA NIM in the UI and supplied their own key.
    if provider == "nvidia" and api_key:
        cfg = _PROVIDERS["nvidia"]
        url = cfg["base"].rstrip("/") + "/chat/completions"
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        return url, headers, ((model or "").strip() or default_nim_model())
    # 1b) Any known provider with an explicit key (e.g. a per-tenant key).
    if provider in _PROVIDERS and api_key:
        cfg = _PROVIDERS[provider]
        url = cfg["base"].rstrip("/") + "/chat/completions"
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        headers.update(cfg.get("extra_headers", {}))
        return url, headers, ((model or "").strip() or cfg["model"])
    # 2) A provider configured on the server via .env. Walk the priority list,
    #    skip anything whose circuit breaker is open or whose keys are all
    #    saturated, and draw a key from the pool so load spreads evenly.
    for p in available_providers():
        pid = p["id"]
        if _cb_open(pid):
            continue
        key = _acquire(pid) or _key(pid)
        if not key:
            continue
        cfg = _PROVIDERS[pid]
        url = cfg["base"].rstrip("/") + "/chat/completions"
        headers = {"Authorization": f"Bearer {key}",
                   "Content-Type": "application/json"}
        headers.update(cfg.get("extra_headers", {}))
        return url, headers, p["model"]
    return None


async def stream_reply(
    text: str,
    history: Optional[List[Dict]] = None,
    *,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    client=None,
    system_prompt: Optional[str] = None,
):
    """Async generator yielding reply text chunks as the model produces them
    (OpenAI-compatible Server-Sent Events, ``stream: true``).

    Yields incremental strings. Yields nothing if streaming isn't possible so
    the caller can fall back to the one-shot / offline path.
    """
    if os.environ.get("BRAIN_DISABLE") == "1":
        return
    try:
        import httpx  # noqa: F401
    except Exception:
        return

    owns_client = False
    if client is None:
        client = get_client()
        if client is None:
            return

    started = False
    # Up to 3 attempts. On a rate limit we re-resolve the target, which pulls
    # the NEXT key out of the pool, so a busy moment costs milliseconds rather
    # than failing the call.
    for attempt in range(3):
        target = _resolve_target(provider, api_key, model)
        if not target:
            return
        url, headers, mdl = target
        payload = {
            "model": mdl,
            "messages": _messages(text, history, system_prompt),
            "temperature": _temperature(),
            "max_tokens": _max_tokens(),
            "stream": True,
        }
        try:
            # A READ timeout, not a total one: every token resets it, so long
            # answers stream fine, but a provider that goes silent is dropped
            # in seconds instead of stalling the call for 30s.
            async with client.stream("POST", url, headers=headers,
                                     json=payload,
                                     timeout=_timeout_for(_stream_read_timeout())) as r:
                if r.status_code in (429, 503) and not started:
                    # Saturated: let the next attempt pick a different key.
                    continue
                if r.status_code != 200:
                    return
                async for line in r.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        obj = json.loads(data)
                    except Exception:
                        continue
                    choice = (obj.get("choices") or [{}])[0]
                    delta = choice.get("delta") or {}
                    piece = _coerce_content(delta.get("content"))
                    if piece:
                        started = True
                        yield piece
                return
        except Exception:
            # Never retry once audio has begun - the caller would hear the
            # sentence restart halfway through, which sounds broken.
            if started:
                return
            continue
        # NOTE (v0.0.44 audit): there used to be a
        #     finally:
        #         if owns_client:
        #             await client.aclose()
        # block here. It was DEAD CODE - `owns_client` is hardcoded False in
        # this function - but it was a loaded gun. It sat INSIDE the retry loop,
        # so the moment anyone made this function own its client, attempt 1
        # would have closed that client and attempts 2 and 3 would have failed
        # on a closed transport, turning one rate limit into a total failure.
        # This function must never close the client: it is the shared warm
        # pooled client and other callers are using it concurrently.


async def generate_reply_nim(
    text: str,
    history: Optional[List[Dict]] = None,
    *,
    api_key: str,
    model: Optional[str] = None,
    client=None,
    system_prompt: Optional[str] = None,
) -> Optional[str]:
    """Live NVIDIA NIM reply using a user-supplied key + model.

    This is a REAL call to https://integrate.api.nvidia.com/v1/chat/completions
    (OpenAI-compatible). Returns the reply text, or None on any failure so the
    caller can fall back to another provider / the offline responder.
    """
    keys = split_keys(api_key)
    if not keys:
        return None
    try:
        import httpx  # noqa: F401
    except Exception:
        return None

    model = (model or "").strip() or default_nim_model()
    base = _PROVIDERS["nvidia"]["base"]
    url = base.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "messages": _messages(text, history, system_prompt),
        "temperature": _temperature(),
        "max_tokens": _max_tokens(),
    }

    owns_client = False
    if client is None:
        client = get_client()
        if client is None:
            return None

    # Rotate through however many keys the user gave us, healthiest first.
    #
    # v0.0.45 - THE BUG THIS FIXES. Any status that was not 200 and not 429 used
    # to `return None` immediately, so ONE revoked or mistyped key (a 401)
    # abandoned the whole turn even though every other key the caller supplied
    # was healthy. Adding more keys made a bad key MORE damaging, which is the
    # exact opposite of why you add keys. Now a bad key costs one retry, gets
    # quarantined, and the next key answers.
    candidates = apikeys.RING.order(api_key, limit=4)
    if not candidates:
        candidates = keys[:4]
    # Same budget rule as the free-provider path: this loop retries up to FOUR
    # keys, so inheriting the 20s client default could stall a single answer
    # for over a minute.
    _deadline = time.monotonic() + _total_budget()
    try:
        for key in candidates:
            if time.monotonic() >= _deadline:
                break
            headers = {"Authorization": f"Bearer {key}",
                       "Content-Type": "application/json"}
            try:
                _left = max(1.0, _deadline - time.monotonic())
                r = await client.post(
                    url, headers=headers, json=payload,
                    timeout=_timeout_for(min(_attempt_timeout(), _left)))
                # One place decides what a status means for a key's health:
                # 429 cools it down, 401/403 quarantines it, 5xx rests it.
                apikeys.RING.note_status(key, r.status_code)
                if r.status_code != 200:
                    # Try the next key instead of giving up on the caller.
                    continue
                out = _extract(r.json())
                if out:
                    return out
            except Exception:
                apikeys.RING.note_error(key)
                continue
        return None
    finally:
        if owns_client:
            await client.aclose()


async def verify_nim_key(api_key: str, model: Optional[str] = None, *, client=None) -> Dict:
    """Do a tiny live round-trip so the UI can confirm the key really works."""
    reply = await generate_reply_nim("ping", None, api_key=api_key, model=model, client=client)
    if reply:
        return {"ok": True, "model": (model or default_nim_model())}
    return {"ok": False, "model": (model or default_nim_model())}


def generate_reply_offline(text: str) -> str:
    return generate_reply(text)
