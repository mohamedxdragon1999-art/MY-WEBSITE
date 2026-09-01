"""FastAPI WebSocket bridge for the realtime voice pipeline.

This module owns the TRANSPORT only. All conversational behaviour lives in
`realtime.RealtimeSession`, which knows nothing about FastAPI and is driven by
injected callables - that separation is what lets the whole pipeline be tested
without a network, a browser, or an API key.

It deliberately does not import `server`. The server injects what it needs, so
there is no circular import and no second copy of the tenant/engine logic that
could drift out of sync with the HTTP routes.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Callable, Dict, List, Optional

from realtime import Deps, RealtimeSession

log = logging.getLogger("voice.realtime")

# A caller cannot out-talk this. Frames are 20 ms of 16 kHz mono int16 = 640
# bytes; anything far larger is not our client and should not be buffered.
MAX_FRAME_BYTES = 64 * 1024
MAX_TEXT_BYTES = 32 * 1024


async def run_socket(ws,
                     deps: Deps,
                     *,
                     sensitivity: float = 1.0,
                     history: Optional[List[Dict]] = None,
                     preemptive: bool = True,
                     on_close: Optional[Callable[[RealtimeSession], None]] = None,
                     ) -> None:
    """Drive one accepted WebSocket to completion.

    The caller is responsible for `await ws.accept()` and for auth, because both
    depend on tenant policy the transport layer should not be second-guessing.
    """
    send_lock = asyncio.Lock()

    async def send_json(payload: Dict) -> None:
        # One lock across BOTH senders. A `speak` control frame and its audio
        # frame must arrive adjacent and in order; without this, two concurrent
        # tasks can interleave and the client pairs audio with the wrong text.
        async with send_lock:
            await ws.send_text(json.dumps(payload))

    async def send_bytes(data: bytes) -> None:
        async with send_lock:
            await ws.send_bytes(data)

    session = RealtimeSession(send_json, send_bytes, deps,
                              sensitivity=sensitivity,
                              history=list(history or []),
                              preemptive=preemptive)

    loops = asyncio.create_task(session.run_loops())

    try:
        while True:
            msg = await ws.receive()

            mtype = msg.get("type")
            if mtype == "websocket.disconnect":
                break

            data = msg.get("bytes")
            if data is not None:
                if len(data) > MAX_FRAME_BYTES:
                    log.warning("oversized audio frame: %d bytes", len(data))
                    continue
                await session.on_audio(data)
                continue

            text = msg.get("text")
            if not text:
                continue
            if len(text) > MAX_TEXT_BYTES:
                log.warning("oversized control frame: %d bytes", len(text))
                continue
            try:
                payload = json.loads(text)
            except (ValueError, TypeError):
                continue
            if not isinstance(payload, dict):
                continue
            if payload.get("t") == "stop":
                break
            await session.on_message(payload)

    except asyncio.CancelledError:
        raise
    except Exception as exc:                      # noqa: BLE001
        # A dropped call is normal, not exceptional. Log it and shut down
        # cleanly rather than letting a disconnect surface as a 500.
        log.info("realtime socket ended: %s: %s", type(exc).__name__, exc)
    finally:
        # Order matters. Close the session FIRST so in-flight synth and brain
        # tasks are cancelled, then stop the loops, then reap. Reversing this
        # leaves orphaned tasks writing to a dead socket.
        try:
            await session.close()
        except Exception:                          # noqa: BLE001
            pass
        loops.cancel()
        await asyncio.gather(loops, return_exceptions=True)
        if on_close is not None:
            try:
                on_close(session)
            except Exception:                      # noqa: BLE001
                pass


def make_deps(*,
              transcribe: Callable,
              stream_reply: Callable,
              synth: Callable,
              streaming: Optional[Callable] = None) -> Deps:
    """Small named constructor so the server reads declaratively.

    `streaming` is an optional factory returning a fresh local streaming
    recogniser per call. Keyword-only and defaulted, so every existing caller
    and test keeps working untouched.
    """
    return Deps(transcribe=transcribe, stream_reply=stream_reply, synth=synth,
                streaming=streaming)
