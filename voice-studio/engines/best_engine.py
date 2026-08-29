"""Mode 5 - "Vox Premium" (auto-best).

There is no single magic TTS that is strictly better than every other in all
conditions, so the honest "better than them all" mode is a smart router: it picks
the highest-quality voice that is actually READY on this machine right now, and
applies light mastering (peak-normalize + a short fade) so replies sound clean
and consistent for a customer-service line.

Priority (most human-sounding + lowest-latency first):
  Edge (online, the very natural voice from the sample video, streams fast) >
  Kokoro (local CPU, top offline quality) > Piper (local CPU, fast) >
  Magpie (cloud GPU).
Edge is first because it is the most natural-sounding and lowest-latency option
(it is what produced the good demo voice), so "best" feels human by default. If
there's no internet it automatically drops to Kokoro/Piper on the local CPU.
It never fails silently: if nothing server-side is ready it reports that clearly
so the frontend can fall back to the browser voice.
"""
from __future__ import annotations

import io
import wave
from typing import Dict, List, Optional

from . import cpu_profile
from .base import Availability, TTSEngine, TTSResult

# v0.0.51 - kokoro promoted ahead of edge for CPU-only deployments.
# Edge sounds excellent, but it is an ONLINE Microsoft service: it adds a
# network round trip to every reply and it is not something we control. Kokoro
# is local, offline, Apache-2.0, and on CPU it still runs faster than real
# time, so it is the better default for a self-hosted box. Edge stays as the
# next rung, which is exactly what it is good at: a free, very natural voice
# for when local weights are missing.
_PRIORITY = list(cpu_profile.filter_order(["kokoro", "edge", "piper", "magpie"]))


# Target loudness (RMS) as a fraction of full scale. ~ -18 dBFS RMS is a good,
# comfortable level for speech that stays clear of clipping. We also enforce a
# peak ceiling so louder voices never distort.
_TARGET_RMS = 0.125          # ~ -18 dBFS
_PEAK_CEILING = 0.95 * 32767.0
_MAX_GAIN = 8.0              # don't over-amplify near-silence / breaths


def _master_wav(data: bytes) -> bytes:
    """Master a 16-bit PCM WAV so every reply sounds consistent and balanced:
      1. remove any DC offset (kills low-end 'thump' and wasted headroom),
      2. RMS loudness-normalize toward a fixed target (so quiet and loud voices
         land at the same comfortable level),
      3. apply a peak ceiling so it never clips/distorts,
      4. add a short fade in/out to avoid clicks.
    Falls back to the original bytes on any error.
    """
    try:
        import numpy as np
        with wave.open(io.BytesIO(data), "rb") as wf:
            params = wf.getparams()
            if params.sampwidth != 2:
                return data
            raw = wf.readframes(wf.getnframes())
        arr = np.frombuffer(raw, dtype="<i2").astype(np.float32)
        if arr.size == 0:
            return data
        # 1) DC offset removal
        arr = arr - float(np.mean(arr))
        # 2) RMS loudness targeting (bounded gain)
        rms = float(np.sqrt(np.mean(arr * arr))) or 1.0
        gain = (_TARGET_RMS * 32767.0) / rms
        gain = max(0.1, min(_MAX_GAIN, gain))
        arr = arr * gain
        # 3) peak ceiling (only attenuate if we'd clip)
        peak = float(np.max(np.abs(arr))) or 1.0
        if peak > _PEAK_CEILING:
            arr = arr * (_PEAK_CEILING / peak)
        # 4) short fade in/out (per-channel aware)
        n_fade = min(int(params.framerate * 0.01) * max(1, params.nchannels), arr.size // 2)
        if n_fade > 0:
            ramp = np.linspace(0.0, 1.0, n_fade, dtype=np.float32)
            arr[:n_fade] *= ramp
            arr[-n_fade:] *= ramp[::-1]
        out_raw = np.clip(arr, -32768, 32767).astype("<i2").tobytes()
        out = io.BytesIO()
        with wave.open(out, "wb") as wf:
            wf.setnchannels(params.nchannels)
            wf.setsampwidth(params.sampwidth)
            wf.setframerate(params.framerate)
            wf.writeframes(out_raw)
        return out.getvalue()
    except Exception:
        return data


class BestEngine(TTSEngine):
    id = "best"
    title = "Vox Premium (auto-best)"
    description = "Automatically uses the highest-quality voice that is ready on your machine, with light audio mastering."

    def __init__(self, registry: Dict[str, TTSEngine]):
        self._registry = registry

    def _pick(self) -> Optional[TTSEngine]:
        for eid in _PRIORITY:
            eng = self._registry.get(eid)
            if eng and eng.availability().ok:
                return eng
        return None

    def availability(self) -> Availability:
        chosen = self._pick()
        if chosen is None:
            return Availability(ok=False, cpu=True, quality=5,
                                reason="No backend voice is ready yet - set up Kokoro or edge-tts.",
                                setup="Install Kokoro (best CPU quality) or edge-tts (online). See README.")
        av = chosen.availability()
        return Availability(ok=True, cpu=av.cpu, needs_network=av.needs_network, needs_key=av.needs_key,
                            quality=5, reason=f"Ready - currently using: {chosen.title}.")

    def voices(self, lang: str = "en") -> List[Dict]:
        chosen = self._pick()
        return chosen.voices(lang) if chosen else []

    def synthesize(self, text: str, *, voice: Optional[str] = None, lang: str = "en",
                   rate: float = 1.0, pitch: float = 0.0) -> TTSResult:
        chosen = self._pick()
        if chosen is None:
            raise RuntimeError("No backend TTS engine is ready. Install Kokoro or edge-tts (see README).")
        res = chosen.synthesize(text, voice=voice, lang=lang, rate=rate, pitch=pitch)
        if res.mime == "audio/wav":
            res = TTSResult(audio=_master_wav(res.audio), mime=res.mime, engine=self.id,
                            voice=res.voice, sample_rate=res.sample_rate,
                            detail=f"via {chosen.id}")
        else:
            res.engine = self.id
            res.detail = f"via {chosen.id}"
        return res
