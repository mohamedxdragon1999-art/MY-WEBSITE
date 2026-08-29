"""Voice engine registry.

Importing this module never fails just because a backend isn't installed - each
engine reports its own availability. `build_registry()` returns id -> engine.
"""
from __future__ import annotations

from typing import Dict, List

from . import cpu_profile
from .base import Availability, TTSEngine, TTSResult
from .edge_engine import EdgeEngine
from .piper_engine import PiperEngine
from .kokoro_engine import KokoroEngine
from .magpie_engine import MagpieEngine
from .best_engine import BestEngine
from .fish_engine import FishEngine
from .chatterbox_engine import ChatterboxEngine
from .human_engine import HumanEngine

# Display order. "human" is the flagship Ultra Human mode and is listed last so
# it reads as the upgrade over everything above it.
_ORDER = ["edge", "piper", "kokoro", "magpie", "fish", "chatterbox", "best", "human"]


def build_registry() -> Dict[str, TTSEngine]:
    base: Dict[str, TTSEngine] = {
        "edge": EdgeEngine(),
        "piper": PiperEngine(),
        "kokoro": KokoroEngine(),
        "magpie": MagpieEngine(),
        "fish": FishEngine(),
        "chatterbox": ChatterboxEngine(),
    }
    # These two compose the engines above them, so they are built last.
    base["best"] = BestEngine(base)
    base["human"] = HumanEngine(base)
    return base


def ordered_ids() -> List[str]:
    return list(_ORDER)


def status_payload(registry: Dict[str, TTSEngine], lang: str = "en") -> List[Dict]:
    """Everything the frontend needs to render the mode picker."""
    out = []
    for eid in _ORDER:
        eng = registry.get(eid)
        if eng is None:
            continue
        try:
            av = eng.availability()
        except Exception as exc:  # never let one broken backend blank the picker
            av = Availability(ok=False, reason=str(exc)[:160])
        # v0.0.51 - an engine can be perfectly installed and still be something
        # this deployment must not use: fish/chatterbox need a GPU, and fish's
        # weights are non-commercial. Reporting those as "ready" would put them
        # in the mode picker, and the moment a user selected one we would be
        # right back to attempting an engine that cannot serve the request.
        # We keep them LISTED (so the reason is visible and an operator can act
        # on it) but never "ok".
        if not cpu_profile.is_allowed(eid):
            av = Availability(
                ok=False,
                reason="Disabled here: " + cpu_profile.block_reason(eid),
                needs_network=av.needs_network,
                needs_key=av.needs_key,
                cpu=False,
                quality=av.quality,
                setup=av.setup,
            )
        out.append({
            "id": eng.id,
            "title": eng.title,
            "description": eng.description,
            "availability": av.to_dict(),
            "voices": eng.voices(lang),
        })
    return out


__all__ = [
    "Availability", "TTSEngine", "TTSResult",
    "EdgeEngine", "PiperEngine", "KokoroEngine", "MagpieEngine", "BestEngine",
    "FishEngine", "ChatterboxEngine", "HumanEngine",
    "build_registry", "ordered_ids", "status_payload",
]
