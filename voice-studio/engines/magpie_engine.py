"""Mode 4 - NVIDIA Magpie TTS (NVIDIA NIM).

NVIDIA Magpie TTS Multilingual is served as an NVIDIA NIM microservice. IMPORTANT
and HONEST: Magpie runs on NVIDIA GPUs - either NVIDIA's hosted cloud API
(build.nvidia.com / integrate.api.nvidia.com) or a locally-hosted NIM container
that itself needs an NVIDIA GPU. It therefore CANNOT run on the user's CPU. In
this app it is exposed as a cloud voice: set NVIDIA_API_KEY and it streams audio
back over the internet. If no key is set, the mode is shown as "needs setup" and
the app transparently routes to a CPU voice instead.

Endpoint + payload are configurable via env so you can point at NVIDIA's hosted
function or your own NIM without code changes:
  NVIDIA_API_KEY   - required
  MAGPIE_URL       - REST endpoint (default: NVIDIA hosted TTS function)
  MAGPIE_VOICE     - default voice name
"""
from __future__ import annotations

import base64
import json
import os
from typing import Dict, List, Optional

from .base import Availability, TTSEngine, TTSResult, clean_text, pcm_to_wav

_DEFAULT_URL = os.environ.get(
    "MAGPIE_URL",
    "https://integrate.api.nvidia.com/v1/audio/speech",  # NVIDIA hosted TTS (OpenAI-compatible)
)
_VOICES = {
    "en": [
        {"id": "Magpie-Multilingual.EN-US.Sofia", "label": "Sofia (expressive female)", "gender": "female"},
        {"id": "Magpie-Multilingual.EN-US.Ryan", "label": "Ryan (expressive male)", "gender": "male"},
    ],
}
_DEFAULT = {"en": "Magpie-Multilingual.EN-US.Sofia"}


class MagpieEngine(TTSEngine):
    id = "magpie"
    title = "NVIDIA Magpie (cloud)"
    description = "NVIDIA NIM expressive multilingual voice. Runs on NVIDIA GPU cloud - needs API key + internet (NOT local CPU)."

    def availability(self) -> Availability:
        key = os.environ.get("NVIDIA_API_KEY")
        try:
            import httpx  # noqa: F401
            has_httpx = True
        except Exception:
            has_httpx = False
        if not has_httpx:
            return Availability(ok=False, cpu=False, needs_network=True, needs_key=True, quality=5,
                                reason="httpx not installed", setup="pip install httpx")
        if not key:
            return Availability(ok=False, cpu=False, needs_network=True, needs_key=True, quality=5,
                                reason="NVIDIA_API_KEY not set (Magpie runs on NVIDIA GPU cloud, not local CPU)",
                                setup="export NVIDIA_API_KEY=nvapi-...  (get a free key at build.nvidia.com)")
        return Availability(ok=True, cpu=False, needs_network=True, needs_key=True, quality=5,
                            reason="Ready (cloud GPU voice via NVIDIA NIM).")

    def voices(self, lang: str = "en") -> List[Dict]:
        return [dict(v, lang=lang) for v in _VOICES.get(lang, _VOICES["en"])]

    def synthesize(self, text: str, *, voice: Optional[str] = None, lang: str = "en",
                   rate: float = 1.0, pitch: float = 0.0, api_key: Optional[str] = None) -> TTSResult:
        import httpx
        # A key sent per-request from the UI wins; otherwise use the env key.
        key = (api_key or "").strip() or os.environ.get("NVIDIA_API_KEY")
        if not key:
            raise RuntimeError("NVIDIA_API_KEY not set for Magpie (enter your NVIDIA NIM key in the UI or .env).")
        voice_id = voice or os.environ.get("MAGPIE_VOICE") or _DEFAULT.get(lang, _DEFAULT["en"])
        payload = {
            "input": self.prepare(text),
            "voice": voice_id,
            "model": os.environ.get("MAGPIE_MODEL", "magpie-tts-multilingual"),
            "response_format": "mp3",
        }
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                   "Accept": "audio/mpeg"}
        with httpx.Client(timeout=60) as client:
            r = client.post(_DEFAULT_URL, headers=headers, json=payload)
            r.raise_for_status()
            ctype = r.headers.get("content-type", "")
            data = r.content
            # Some NIM endpoints return JSON with base64 audio instead of raw bytes.
            if "application/json" in ctype:
                obj = r.json()
                b64 = obj.get("audio") or obj.get("audio_content") or ""
                data = base64.b64decode(b64) if b64 else b""
                if obj.get("encoding", "").upper() in ("LINEAR_PCM", "PCM"):
                    sr = int(obj.get("sample_rate_hz", 24000))
                    return TTSResult(audio=pcm_to_wav(data, sr), mime="audio/wav",
                                     engine=self.id, voice=voice_id, sample_rate=sr)
        mime = "audio/mpeg" if ("mpeg" in ctype or "mp3" in ctype or not ctype) else ctype
        return TTSResult(audio=data, mime=mime, engine=self.id, voice=voice_id, sample_rate=24000)
