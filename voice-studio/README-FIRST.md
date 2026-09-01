# Voice Studio — voice assistant project (reference base)

This folder contains **only the Voice Studio project** (the voice AI assistant
built before NexusCRM), separated from the NexusCRM website files
(`../nexuscrm/`). Extensions and folder positions are the originals (the first
upload had renamed everything to `.txt`).

## Layout

```
voice-studio/
├── server.py                   ← FastAPI server (VERSION 0.0.51)
├── run.sh / Start Voice Studio (Windows).bat / (Mac-Linux).command
├── brain.py, reply.py          ← multi-provider LLM brain + offline fallback
├── apikeys.py, pool.py, cache.py, latency.py, ratelimit.py,
│   sessions.py, tenants.py     ← free-key rotation, HTTP pool, limits, tenants
├── stt.py, asr_local.py, asr_stream.py, endpointing.py,
│   intake.py, audio_frames.py  ← speech recognition & turn detection
├── realtime.py, realtime_server.py  ← full-duplex WebSocket voice pipeline
├── pacing.py, evalkit.py, setup_voices.py
├── engines/                    ← TTS engines + emotion/prosody layer
│   ├── base.py, cpu_profile.py, best_engine.py
│   ├── edge_engine.py, piper_engine.py, kokoro_engine.py, magpie_engine.py,
│   ├── fish_engine.py, chatterbox_engine.py, human_engine.py
│   └── emotion.py, sentiment.py, prosody.py, voice_fx.py,
│       expressive.py, speakable.py
├── static/                     ← the website (index.html, app.js, styles.css, orb.js)
│   ├── widget.js, widget-demo.html    ← embeddable Shadow-DOM chat/voice widget
│   └── realtime.js, capture-worklet.js
├── test_*.py                   ← 26 test suites (run from this root folder)
├── .env.example, tenants.example.json, requirements*.txt
├── Dockerfile, docker-compose.yml, gunicorn_conf.py, nginx.conf.example
└── logs/                       ← historical run logs
```

## Status of this code

- The server version on disk is **0.0.51** (with v52-era frontend fixes in
  `static/realtime.js` and `static/capture-worklet.js`).
- Per the owner's instruction: this old version **had many problems** — it is
  the **reference base** for adding voice/chat widgets to NexusCRM, to be
  carefully reworked, NOT copy-pasted.
- This is a standalone Python/FastAPI project. It is **not** part of the
  NexusCRM Cloudflare Worker backend and cannot be dropped into it as-is.

## Running (reference only)

```
cd voice-studio
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-core.txt
python server.py        # or: uvicorn server:app --host 0.0.0.0 --port 8000
```
