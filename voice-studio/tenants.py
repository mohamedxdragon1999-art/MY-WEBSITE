"""Multi-tenant configuration for Voice Studio.

One Voice Studio server can power MANY websites ("tenants"). Each tenant has its
own allowed browser origins, branding, default voice + brain, an optional custom
system prompt, and its own rate limits. A tenant NEVER shares its greeting,
prompt, or history with another tenant.

Config sources (first found wins):
  1. $VOICE_TENANTS_FILE  -> path to a JSON file
  2. ./tenants.json       -> next to this file
  3. built-in "default" tenant that allows every origin (great for a single
     site / local dev; lock it down in production with a tenants.json).

JSON shape (see tenants.example.json):
{
  "defaults": { "voice_mode": "best", "rate_per_min": 30, "burst": 10, ... },
  "tenants": [
    {
      "id": "acme",
      "name": "Acme Support",
      "allowed_origins": ["https://acme.com", "https://www.acme.com"],
      "voice_mode": "kokoro",
      "voice": "",
      "brain_provider": "",          # "" = use server default order
      "brain_model": "",
      "brain_key_env": "ACME_AI_KEY", # env var NAME holding this tenant's key
      "system_prompt": "You are Acme's friendly support agent...",
      "greeting": "Hi! Thanks for calling Acme. How can I help?",
      "theme": { "color": "#6c8cff", "title": "Acme Support" },
      "rate_per_min": 40,
      "burst": 15,
      "api_token": ""                 # optional shared secret to call the API
    }
  ]
}

All fields are optional except "id". Missing fields inherit from "defaults",
then from the built-in defaults below. Real environment variables are the only
place secrets live; tenants.json stores the NAME of the key env var, not the key.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Dict, List, Optional

HERE = Path(__file__).resolve().parent

_BUILTIN_DEFAULTS: Dict = {
    "voice_mode": "best",
    "voice": "",
    "lang": "en",
    "rate": 1.0,
    "pitch": 0.0,
    "brain_provider": "",
    "brain_model": "",
    "brain_key_env": "",
    "system_prompt": "",
    "greeting": "Hi there! How can I help you today?",
    "theme": {"color": "#6c8cff", "title": "Voice Assistant", "position": "right"},
    "rate_per_min": 30,
    "burst": 10,
    "max_history": 12,
    "api_token": "",
}


class Tenant:
    __slots__ = ("id", "name", "allowed_origins", "voice_mode", "voice", "lang",
                 "rate", "pitch", "brain_provider", "brain_model", "brain_key_env",
                 "system_prompt", "greeting", "theme", "rate_per_min", "burst",
                 "max_history", "api_token")

    def __init__(self, raw: Dict, defaults: Dict):
        def pick(key):
            val = raw.get(key)
            if val in (None, ""):
                val = defaults.get(key, _BUILTIN_DEFAULTS.get(key))
            return val

        self.id = str(raw.get("id") or "default").strip()
        self.name = str(raw.get("name") or self.id)
        # Distinguish an explicit empty list ([] = same-origin only) from
        # "not provided" (inherit defaults, else allow all).
        origins = raw.get("allowed_origins")
        if origins is None:
            origins = defaults.get("allowed_origins")
        if origins is None:
            origins = ["*"]
        self.allowed_origins = [str(o).strip() for o in origins if str(o).strip()]
        self.voice_mode = str(pick("voice_mode"))
        self.voice = str(pick("voice") or "")
        self.lang = str(pick("lang"))
        self.rate = float(pick("rate"))
        self.pitch = float(pick("pitch"))
        self.brain_provider = str(pick("brain_provider") or "")
        self.brain_model = str(pick("brain_model") or "")
        self.brain_key_env = str(pick("brain_key_env") or "")
        self.system_prompt = str(pick("system_prompt") or "")
        self.greeting = str(pick("greeting"))
        theme = dict(_BUILTIN_DEFAULTS["theme"])
        theme.update(defaults.get("theme") or {})
        theme.update(raw.get("theme") or {})
        self.theme = theme
        self.rate_per_min = int(pick("rate_per_min"))
        self.burst = int(pick("burst"))
        self.max_history = int(pick("max_history"))
        self.api_token = str(pick("api_token") or "")

    # ---- helpers -------------------------------------------------------
    def allows_origin(self, origin: Optional[str]) -> bool:
        if "*" in self.allowed_origins:
            return True
        if not self.allowed_origins:
            # No configured origins: same-origin only (deny cross-origin).
            return False
        if not origin:
            return False
        return origin.rstrip("/") in {o.rstrip("/") for o in self.allowed_origins}

    def brain_key(self) -> Optional[str]:
        """Resolve this tenant's AI key from its configured env var (never stored
        in JSON directly)."""
        if self.brain_key_env:
            return os.environ.get(self.brain_key_env, "").strip() or None
        return None

    def public_config(self) -> Dict:
        """Safe subset the browser widget may see (NO secrets)."""
        return {
            "id": self.id,
            "name": self.name,
            "voice_mode": self.voice_mode,
            "voice": self.voice,
            "lang": self.lang,
            "rate": self.rate,
            "pitch": self.pitch,
            "greeting": self.greeting,
            "theme": self.theme,
            "requires_token": bool(self.api_token),
        }


class _Registry:
    def __init__(self):
        self._lock = threading.Lock()
        self._tenants: Dict[str, Tenant] = {}
        self._defaults: Dict = {}
        self._loaded = False
        self._allow_all = True  # true when any tenant allows "*"

    def _path(self) -> Optional[Path]:
        env = os.environ.get("VOICE_TENANTS_FILE", "").strip()
        if env and Path(env).exists():
            return Path(env)
        local = HERE / "tenants.json"
        if local.exists():
            return local
        return None

    def load(self, force: bool = False) -> None:
        with self._lock:
            if self._loaded and not force:
                return
            tenants: Dict[str, Tenant] = {}
            defaults: Dict = {}
            path = self._path()
            if path is not None:
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                    defaults = data.get("defaults") or {}
                    for raw in data.get("tenants") or []:
                        # Isolate each tenant: one malformed entry must not
                        # discard every other (valid) tenant.
                        try:
                            t = Tenant(raw, defaults)
                            tenants[t.id] = t
                        except Exception as e:
                            print(f"[tenants] skipped bad tenant {raw.get('id') if isinstance(raw, dict) else raw!r}: {e}")
                except Exception as e:  # bad file/JSON must not crash the server
                    print(f"[tenants] failed to load {path}: {e}")
            if not tenants:
                # No config at all: single built-in tenant that allows every
                # origin (great for one site / local dev).
                t = Tenant({"id": "default", "allowed_origins": ["*"]}, defaults)
                tenants[t.id] = t
            elif "default" not in tenants:
                # A registry exists but has no explicit "default". Synthesize a
                # NEUTRAL fallback (no cross-origin, no secrets) so an unknown
                # site id can never inherit another real tenant's prompt/brand/
                # key. Empty origins => does not widen the global CORS union.
                tenants["default"] = Tenant({"id": "default", "allowed_origins": []}, defaults)
            self._tenants = tenants
            self._defaults = defaults
            # "Allow all" only when a tenant EXPLICITLY opts in with "*".
            self._allow_all = any("*" in t.allowed_origins for t in tenants.values())
            self._loaded = True

    def get(self, site_id: Optional[str]) -> Tenant:
        self.load()
        sid = (site_id or "default").strip() or "default"
        return self._tenants.get(sid) or self._tenants.get("default") or next(iter(self._tenants.values()))

    def all(self) -> List[Tenant]:
        self.load()
        return list(self._tenants.values())

    def origins(self) -> Optional[List[str]]:
        """Union of every tenant's allowed origins, or None to allow all."""
        self.load()
        if self._allow_all:
            return None
        out = set()
        for t in self._tenants.values():
            for o in t.allowed_origins:
                out.add(o.rstrip("/"))
        return sorted(out)


REGISTRY = _Registry()


def get_tenant(site_id: Optional[str]) -> Tenant:
    return REGISTRY.get(site_id)


def all_tenants() -> List[Tenant]:
    return REGISTRY.all()


def allowed_origins() -> Optional[List[str]]:
    return REGISTRY.origins()


def reload() -> None:
    REGISTRY.load(force=True)
