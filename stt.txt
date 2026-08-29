"""Fast speech-to-text (the "words taker").

WHY THIS EXISTS
---------------
The browser's built-in SpeechRecognition is convenient but it is the weakest
link in the whole stack: it is slow to return finals, it silently drops words,
it needs a network round trip to Google anyway, and it only exists in
Chrome/Edge. This module replaces it with a real ASR model.

SPEED (measured by others, not by us - we cannot run a GPU here)
----------------------------------------------------------------
  parakeet-tdt-0.6b-v2   6.05% WER   RTFx ~3386 (batch 128)  <- default
  canary-1b-flash        6.35% WER   RTFx ~1046
  whisper-large-v3       ~7.4% WER   RTFx ~100 (autoregressive, much slower)

RTFx is "seconds of audio per second of compute", so Parakeet transcribes a
5-second utterance in single-digit milliseconds of GPU time. Against
Whisper-class decoding that is the 10-30x class of speedup you asked for, and
it also hallucinates far less on silence because a TDT transducer can emit
blank instead of being forced to produce text.

ORDER OF PREFERENCE
-------------------
  1. NVIDIA NIM Parakeet (cloud or your own container) - fastest
  2. NIM Canary / Whisper on the same endpoint - fallback models
  3. Local faster-whisper - works with no key, but slow on CPU
  4. Browser recognition - always available as the last resort (front-end)

HONEST LIMITS
-------------
NVIDIA hosts several ASR NIMs, and the exact hosted route has changed over
time, so the endpoint is CONFIGURABLE and we try more than one request shape.
If none match your deployment, set NVIDIA_ASR_URL explicitly. We never claim a
transcript we did not get: failures return a reason, and the caller falls back.
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Dict, List, Optional, Tuple

import apikeys

# Hosted NIM default. Many NIM ASR deployments (and the OpenAI-compatible
# gateway) accept the standard /v1/audio/transcriptions multipart shape.
_DEFAULT_URL = "https://integrate.api.nvidia.com/v1/audio/transcriptions"
# v0.0.44: Nemotron 3 ASR Streaming replaces Parakeet as the default.
#
# Parakeet-TDT is still an excellent OFFLINE model - it is why we chose it - but
# the published streaming numbers are decisive for a live call:
#
#   Nemotron-0.6B (cache-aware FastConformer-RNNT)  7.28% streaming WER,
#                                                   BSF 1.03 (no degradation
#                                                   from batch), 80ms chunks,
#                                                   ~24ms median time-to-final
#   Parakeet TDT / Canary                           BSF >= 1.74 - WER ALMOST
#                                                   DOUBLES under chunking, at
#                                                   4x higher latency
#
# BSF is the batch-to-streaming factor. A model with BSF 1.74 is a model that
# gets much WORSE the moment you stop feeding it a whole clean utterance, which
# is exactly what a live microphone does. That is the "sometimes it hears me
# wrong" complaint expressed as a number.
#
# It also emits punctuation and capitalisation natively, so we stop paying for a
# separate formatting pass.
_DEFAULT_MODEL = "nvidia/nemotron-asr-streaming"

# Tried CONCURRENTLY now (see _race below), best-of-first, not one-after-another.
_MODEL_CHAIN = [
    "nvidia/nemotron-asr-streaming",
    "nvidia/nemotron-speech-streaming-en-0.6b",
    "nvidia/parakeet-tdt-0.6b-v2",
    "nvidia/parakeet-ctc-0.6b-asr",
    "nvidia/canary-1b-flash",
    "openai/whisper-large-v3",
]

# HEDGING. The old code was serial: try model 1, wait up to the FULL timeout,
# only then try model 2. One cold model therefore cost the user 12 seconds of
# silence before anything else was even attempted. Hedged requests are the
# standard cure for tail latency: fire a second attempt after a short delay and
# take whichever answers first. The delay is what keeps it cheap - if the
# primary is healthy it wins the race and the backup is cancelled before it
# costs anything.
_HEDGE_MODELS = 3        # never more than this many in flight at once
_HEDGE_DELAY = 0.65      # seconds before the backup joins the race
_PRIMARY_GRACE = 0.40    # how long a winner waits for the more accurate model
_TIMEOUT = 12.0
_MAX_AUDIO_BYTES = 8 * 1024 * 1024   # ~8MB: far more than one spoken turn


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def asr_url() -> str:
    return _env("NVIDIA_ASR_URL", _DEFAULT_URL)


def asr_model() -> str:
    return _env("NVIDIA_ASR_MODEL", _DEFAULT_MODEL)


def api_key(explicit: str = "") -> str:
    """Caller-supplied key wins, then env. Never stored, never logged."""
    if explicit and explicit.strip():
        return explicit.strip()
    for name in ("NVIDIA_ASR_API_KEY", "NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"):
        v = _env(name)
        if v:
            return v
    return ""


def timeout() -> float:
    try:
        return max(2.0, min(60.0, float(_env("NVIDIA_ASR_TIMEOUT", str(_TIMEOUT)))))
    except ValueError:
        return _TIMEOUT


def enabled() -> bool:
    """Cloud ASR is on unless explicitly disabled."""
    return _env("VOICE_FAST_STT", "1").lower() not in ("0", "false", "no", "off")


def _extract_text(payload) -> str:
    """Pull the transcript out of whichever response shape we got.

    Different ASR APIs disagree on the envelope, so we look for all the common
    ones instead of assuming a single vendor format.
    """
    if payload is None:
        return ""
    if isinstance(payload, str):
        return payload.strip()
    if isinstance(payload, list):
        return " ".join(_extract_text(p) for p in payload).strip()
    if not isinstance(payload, dict):
        return ""
    # OpenAI-compatible and most NIM REST replies
    for key in ("text", "transcript", "transcription"):
        v = payload.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    # Riva-style: results -> alternatives -> transcript
    for key in ("results", "segments", "alternatives", "output", "data", "chunks"):
        v = payload.get(key)
        if v:
            got = _extract_text(v)
            if got:
                return got
    return ""


def hotwords() -> List[str]:
    """Domain words the recogniser should be biased toward.

    Keyword boosting ('phrase lists' in Azure, 'keyword boosting' in NVIDIA and
    Deepgram) raises the probability of specific tokens at decode time. It is
    the single cheapest accuracy win available: no training, no model change.
    Research on keyword-boosted ASR shows large gains on exactly the words that
    matter most in support calls - proper nouns, product names, reference codes
    - while leaving everything else unchanged.

    10-40 terms is the recommended range; beyond that the bias starts hurting
    ordinary words, so we cap it hard.
    """
    raw = _env("VOICE_ASR_HOTWORDS", "")
    words = [w.strip() for w in raw.replace("\n", ",").split(",") if w.strip()]
    seen, out = set(), []
    for w in words:
        low = w.lower()
        if low not in seen:
            seen.add(low)
            out.append(w[:48])
    return out[:40]


def _boost_prompt(extra: str = "") -> str:
    """Build the decoder bias string sent alongside the audio.

    Whisper-family endpoints accept a `prompt`; it acts as soft context that
    nudges spelling and vocabulary. We keep it short - a long prompt can cause
    the model to hallucinate the prompt text back into the transcript.
    """
    terms = hotwords()
    if extra:
        terms = terms + [t.strip() for t in extra.split(",") if t.strip()][:20]
    if not terms:
        return ""
    return (", ".join(terms))[:900]


def _fsec(name: str, default: float, lo: float, hi: float) -> float:
    """Read a float knob from the environment without ever raising."""
    try:
        return max(lo, min(hi, float(_env(name, str(default)))))
    except ValueError:
        return default


def hedge_delay() -> float:
    """Seconds to wait before starting a backup attempt. 0 disables hedging."""
    return _fsec("VOICE_ASR_HEDGE_DELAY", _HEDGE_DELAY, 0.0, 5.0)


def hedge_models() -> int:
    """How many models may be in flight for a single turn."""
    try:
        return max(1, min(4, int(float(_env("VOICE_ASR_HEDGE_MODELS", str(_HEDGE_MODELS))))))
    except ValueError:
        return _HEDGE_MODELS


def primary_grace() -> float:
    """Seconds a backup winner waits for the primary model to catch up."""
    return _fsec("VOICE_ASR_PRIMARY_GRACE", _PRIMARY_GRACE, 0.0, 2.0)


async def _attempt(
    client,
    url: str,
    key: str,
    candidate: str,
    audio: bytes,
    filename: str,
    content_type: str,
    lang: str,
    boost: str,
) -> Dict[str, object]:
    """One transcription request. Returns a result dict; never raises.

    `fatal` means "do not bother trying any other model" - a bad key is bad for
    every model on the endpoint, so racing more of them would only waste time.
    """
    res: Dict[str, object] = {"text": "", "engine": candidate, "error": "", "fatal": ""}
    files = {"file": (filename, audio, content_type)}
    data = {"model": candidate, "response_format": "json"}
    if lang and lang != "auto":
        data["language"] = lang
    # Bias the decoder toward domain vocabulary. Sent under both of the common
    # field names so whichever the endpoint understands takes effect; an
    # endpoint that knows neither simply ignores the extra form field.
    bias = _boost_prompt(boost)
    if bias:
        data["prompt"] = bias
        data["hotwords"] = bias
    # Greedy decoding is fastest and we are latency-bound on a live call.
    data["temperature"] = "0"
    try:
        r = await client.post(
            url,
            files=files,
            data=data,
            headers={"Authorization": "Bearer " + key, "Accept": "application/json"},
            timeout=timeout(),
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        res["error"] = type(exc).__name__ + ": " + str(exc)[:160]
        return res

    if r.status_code in (401, 403):
        res["fatal"] = "NVIDIA rejected the key (401/403) - check or rotate it"
        res["error"] = res["fatal"]
        return res
    if r.status_code == 429:
        # Rate limits are per-model on NIM, so this is NOT fatal: another model
        # on the same endpoint may well answer. Let the race continue.
        res["error"] = "rate limited (429) on " + candidate
        return res
    if r.status_code >= 400:
        res["error"] = "HTTP " + str(r.status_code) + ": " + (r.text or "")[:160]
        return res

    try:
        payload = r.json()
    except Exception:
        payload = (r.text or "").strip()
    text = _extract_text(payload)
    if text:
        res["text"] = text
    else:
        res["error"] = "empty transcript from " + candidate
    return res


def _cancel(tasks) -> None:
    for t in tasks:
        if not t.done():
            t.cancel()


async def _drain(tasks) -> None:
    """Cancel the losing attempts AND wait for them to actually stop.

    HIDDEN CON THIS FIXES: cancelling an in-flight httpx request on the SHARED
    pooled client and then walking away is not free. Cancellation is delivered
    at the next await point, so the coroutine may still be inside the socket
    when we return. Under load that can hand the next caller a pooled
    connection with an unread response body still in it, and Python separately
    complains that the task result was never retrieved. Awaiting the
    cancellation is what makes hedging safe with a shared client - which is the
    whole point, since we hedge on every slow turn and we are built for 50
    concurrent callers.
    """
    pend = [t for t in tasks if not t.done()]
    _cancel(pend)
    if pend:
        await asyncio.gather(*pend, return_exceptions=True)


async def _race(
    client,
    url: str,
    key: str,
    chain: List[str],
    audio: bytes,
    filename: str,
    content_type: str,
    lang: str,
    boost: str,
) -> Tuple[Dict[str, object], str]:
    """Race several models, staggered, and return the first usable transcript.

    Returns (result, last_error). `result` is empty-texted if nobody answered.

    Ordering matters: chain[0] is the most accurate streaming model, so if a
    later model wins the race we give the primary a short grace period to land
    before we commit. That buys most of the latency win without trading away
    the accuracy that made us pick the primary in the first place.
    """
    delay = hedge_delay()
    want = max(1, min(hedge_models(), len(chain)))
    picked = chain[:want]

    # get_running_loop, NOT get_event_loop: the latter is deprecated inside a
    # running loop and on 3.14 it raises instead of warning.
    loop = asyncio.get_running_loop()
    pending = set()
    owner = {}
    last_err = ""

    async def _staggered(candidate: str, wait: float):
        if wait > 0:
            await asyncio.sleep(wait)
        return await _attempt(
            client, url, key, candidate, audio, filename, content_type, lang, boost
        )

    for i, candidate in enumerate(picked):
        # 0 delay disables hedging: everything after the first waits forever-ish
        # is wrong, so instead we simply run the primary alone in that case.
        if delay <= 0 and i > 0:
            break
        t = loop.create_task(_staggered(candidate, delay * i))
        owner[t] = candidate
        pending.add(t)

    best: Dict[str, object] = {}
    while pending:
        done, pending = await asyncio.wait(
            pending, return_when=asyncio.FIRST_COMPLETED, timeout=timeout() + 2.0
        )
        if not done:
            break
        for t in done:
            try:
                res = t.result()
            except asyncio.CancelledError:
                continue
            except Exception as exc:
                last_err = type(exc).__name__ + ": " + str(exc)[:160]
                continue
            if res.get("fatal"):
                await _drain(pending)
                return res, str(res.get("error") or "")
            if res.get("error"):
                last_err = str(res["error"])
            if not res.get("text"):
                continue
            if owner.get(t) == picked[0] or not pending:
                # The primary answered, or nobody else is left to wait for.
                await _drain(pending)
                return res, last_err
            # A backup won. Hold it, and give the primary a short grace period.
            best = res
            grace = primary_grace()
            # HIDDEN CON THIS FIXES: the grace period only makes sense while the
            # PRIMARY is still running, because the primary is the only model
            # allowed to override a backup. If the primary already failed (a 429
            # or a dead socket) and only a third model is still in flight, the
            # old code still burned the full grace window waiting for something
            # that could never win - adding up to 400ms of pure dead air to
            # exactly the turns that had already gone wrong.
            primary_live = any(owner.get(p) == picked[0] for p in pending)
            if grace <= 0 or not primary_live:
                await _drain(pending)
                return best, last_err
            done2, pending = await asyncio.wait(
                pending, return_when=asyncio.FIRST_COMPLETED, timeout=grace
            )
            for t2 in done2:
                try:
                    r2 = t2.result()
                except Exception:
                    continue
                if r2.get("text") and owner.get(t2) == picked[0]:
                    await _drain(pending)
                    return r2, last_err
                if r2.get("error"):
                    last_err = str(r2["error"])
            await _drain(pending)
            return best, last_err

    await _drain(pending)
    return best, last_err


async def transcribe(
    audio: bytes,
    *,
    filename: str = "turn.webm",
    content_type: str = "audio/webm",
    lang: str = "en",
    key: str = "",
    model: str = "",
    boost: str = "",
) -> Dict[str, object]:
    """Transcribe one spoken turn. Returns {text, engine, ms, error}.

    Never raises: the caller must always be able to fall back.
    """
    started = time.time()
    out: Dict[str, object] = {"text": "", "engine": "", "ms": 0, "error": ""}

    if not audio:
        out["error"] = "no audio received"
        return out
    if len(audio) > _MAX_AUDIO_BYTES:
        out["error"] = "audio too large (over 8MB for a single turn)"
        return out
    if not enabled():
        out["error"] = "fast STT disabled (VOICE_FAST_STT=0)"
        return out

    k = api_key(key)
    if not k:
        out["error"] = (
            "no NVIDIA API key - add NVIDIA_API_KEY to .env or paste a key in the "
            "brain panel to enable fast transcription (free at build.nvidia.com)"
        )
        return out

    try:
        import httpx  # noqa: F401
    except Exception:
        out["error"] = "httpx not installed (pip install httpx)"
        return out

    from brain import get_client  # reuse the pooled HTTP/2 client

    url = asr_url()
    wanted = (model or asr_model()).strip()
    chain: List[str] = [wanted] + [m for m in _MODEL_CHAIN if m != wanted]
    client = get_client()

    # v0.0.45 - CAPTURE ROTATES KEYS TOO.
    #
    # Word capture makes far more requests than the brain does, so it is the
    # FIRST thing to hit a per-key rate limit - and yet it was the one path that
    # only ever used a single key. A caller could have five healthy keys pasted
    # in and still lose the turn to a 401 or a 429 on the first one.
    raw_keys = (key or "").strip()
    for _name in ("NVIDIA_ASR_API_KEY", "NVIDIA_API_KEYS", "NVIDIA_API_KEY",
                  "NVIDIA_NIM_API_KEY"):
        _v = _env(_name)
        if _v:
            raw_keys = (raw_keys + "," + _v) if raw_keys else _v
    # Bounded at 3: this is a live call, and a fourth key is worth less than the
    # latency it would cost. A rejected key fails fast, so this is cheap.
    candidates = apikeys.RING.order(raw_keys, limit=3) or [k]

    result: Dict[str, object] = {}
    last_err = ""
    for _attempt_key in candidates:
        result, last_err = await _race(
            client, url, _attempt_key, chain, audio, filename, content_type,
            lang, boost
        )
        if result.get("text"):
            apikeys.RING.note_ok(_attempt_key)
            break
        if result.get("fatal"):
            # 401/403 is fatal for every MODEL on the endpoint, but not for the
            # caller's other KEYS. Quarantine this one and try the next.
            apikeys.RING.note_rejected(_attempt_key)
            continue
        _err = str(result.get("error") or last_err or "").lower()
        if "429" in _err or "rate limit" in _err or "too many" in _err:
            apikeys.RING.note_rate_limited(_attempt_key)
            continue
        # Anything else (network, bad audio, no endpoint) is not the key's
        # fault, so retrying other keys would just burn the turn's budget.
        break

    if result.get("text"):
        out["text"] = result["text"]
        out["engine"] = result.get("engine") or ""
        out["ms"] = int((time.time() - started) * 1000)
        return out

    out["error"] = str(result.get("error") or last_err or "no ASR endpoint responded")
    out["ms"] = int((time.time() - started) * 1000)
    return out


def status() -> Dict[str, object]:
    """What the UI shows about capture speed, with no secrets."""
    has_key = bool(api_key())
    return {
        "enabled": enabled(),
        "has_key": has_key,
        "url": asr_url(),
        "model": asr_model(),
        "timeout": timeout(),
        "ready": bool(enabled() and has_key),
        "note": (
            "Fast cloud transcription active (Parakeet-class ASR)."
            if enabled() and has_key
            else "Add an NVIDIA API key for 10-30x faster capture; "
                 "browser recognition is used until then."
        ),
    }
