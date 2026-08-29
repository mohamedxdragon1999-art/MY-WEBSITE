"""Mode 1 - "Current voice": Microsoft Edge neural TTS (edge-tts).

This is the exact engine/voice that produced the good sample video in the
original project (en-US-AndrewMultilingualNeural, 24 kHz). It is FREE and needs
NO API key, but it is an ONLINE Microsoft service, so it needs internet. It does
not need a GPU, so it is CPU-friendly for the user's machine.
"""
from __future__ import annotations

import asyncio
from typing import Dict, List, Optional

from . import expressive
from .base import (Availability, TTSEngine, TTSResult, clean_text, pitch_to_hz,
                   rate_to_percent, volume_to_percent)

# The Multilingual Neural voices are Microsoft's most human-sounding, expressive
# voices (natural prosody + emotion) - ideal for a warm support line. Andrew is
# the exact voice from the good sample video and stays the default.
_VOICES = {
    "en": [
        {"id": "en-US-AndrewMultilingualNeural", "label": "Andrew (warm male) \u2605 demo voice", "gender": "male"},
        {"id": "en-US-AvaMultilingualNeural", "label": "Ava (natural female)", "gender": "female"},
        {"id": "en-US-EmmaMultilingualNeural", "label": "Emma (friendly female)", "gender": "female"},
        {"id": "en-US-BrianMultilingualNeural", "label": "Brian (casual male)", "gender": "male"},
        {"id": "en-US-AriaNeural", "label": "Aria (expressive female)", "gender": "female"},
        {"id": "en-US-JennyNeural", "label": "Jenny (support female)", "gender": "female"},
        {"id": "en-US-GuyNeural", "label": "Guy (male)", "gender": "male"},
        {"id": "en-GB-RyanNeural", "label": "Ryan (British male)", "gender": "male"},
        {"id": "en-GB-SoniaNeural", "label": "Sonia (British female)", "gender": "female"},
    ],
}
_DEFAULT = {"en": "en-US-AndrewMultilingualNeural"}


class EdgeEngine(TTSEngine):
    id = "edge"
    title = "Current voice (Edge Neural)"
    description = "Microsoft Edge online neural voices - the original Vox voice. Free, no key, CPU-friendly, needs internet."

    def availability(self) -> Availability:
        try:
            import edge_tts  # noqa: F401
        except Exception:
            return Availability(ok=False, needs_network=True, quality=4,
                                reason="edge-tts not installed",
                                setup="pip install edge-tts")
        return Availability(ok=True, needs_network=True, needs_key=False, cpu=True, quality=4,
                            reason="Ready (online Microsoft service, no GPU/key needed).")

    def voices(self, lang: str = "en") -> List[Dict]:
        return [dict(v, lang=lang) for v in _VOICES.get(lang, _VOICES["en"])]

    async def _stream(self, clean: str, voice_id: str, rate_s: str, pitch_s: str,
                      volume_s: str = "+0%") -> bytes:
        import edge_tts
        # Volume is part of how emotion reads: an apology is genuinely softer.
        try:
            comm = edge_tts.Communicate(clean, voice_id, rate=rate_s, pitch=pitch_s,
                                        volume=volume_s)
        except TypeError:
            try:
                comm = edge_tts.Communicate(clean, voice_id, rate=rate_s, pitch=pitch_s)
            except TypeError:
                comm = edge_tts.Communicate(clean, voice_id, rate=rate_s)
        buf = bytearray()
        async for chunk in comm.stream():
            if chunk.get("type") == "audio" and chunk.get("data"):
                buf.extend(chunk["data"])
        return bytes(buf)

    async def asynthesize(self, text: str, *, voice: Optional[str] = None, lang: str = "en",
                          rate: float = 1.0, pitch: float = 0.0) -> TTSResult:
        """Native async path (edge-tts is network-bound). The server awaits this
        directly on the event loop, so there's no extra thread/event-loop per
        call - much lighter under many concurrent users."""
        voice_id = voice or _DEFAULT.get(lang, _DEFAULT["en"])

        # v0.0.40 - PER-SENTENCE PERFORMANCE, ON THE MODE MOST PEOPLE HEAR.
        # This engine used to send the whole reply as ONE request with ONE
        # rate/pitch/volume. Andrew is a genuinely expressive neural voice, but
        # a single setting for a three-sentence answer means nothing moves while
        # the agent is talking, which is the exact thing that reads as robotic.
        # Now every sentence is its own request with its own tempo, pitch centre
        # and loudness, following the emotional arc of the reply.
        #
        # The requests run CONCURRENTLY, so a three-sentence performance takes
        # about as long as the one flat request did. More human AND not slower.
        if expressive.enabled():
            beats = expressive.plan(text)
            if beats:
                async def _one(seg: str, br: float, bp: float, bv: float) -> bytes:
                    return await self._stream(self.prepare(seg), voice_id,
                                              rate_to_percent(br), pitch_to_hz(bp),
                                              volume_to_percent(bv))

                audio = await expressive.arender_beats(beats, _one, rate=rate,
                                                       pitch=pitch)
                if audio:
                    return TTSResult(audio=audio, mime="audio/mpeg", engine=self.id,
                                     voice=voice_id, sample_rate=24000,
                                     detail=expressive.describe(beats))

        # Fallback: one flat request. Also the path VOICE_EXPRESSIVE=0 selects,
        # and the path taken if any single beat fails - half a reply would be
        # worse than a flat one.
        e_rate, e_pitch, e_vol, e_name = self.emotion_params(text, rate, pitch)
        audio = await self._stream(self.prepare(text), voice_id,
                                   rate_to_percent(e_rate), pitch_to_hz(e_pitch),
                                   volume_to_percent(e_vol))
        return TTSResult(audio=audio, mime="audio/mpeg", engine=self.id, voice=voice_id,
                         sample_rate=24000, detail=e_name)

    def synthesize(self, text: str, *, voice: Optional[str] = None, lang: str = "en",
                   rate: float = 1.0, pitch: float = 0.0) -> TTSResult:
        # One implementation, one behaviour. The sync entry point now performs
        # the same plan as the async one instead of being a second, flatter code
        # path that quietly drifted out of step with it.
        return asyncio.run(self.asynthesize(text, voice=voice, lang=lang,
                                            rate=rate, pitch=pitch))
