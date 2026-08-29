# Voice Studio - enterprise multi-tenant voice assistant server.
# Multi-stage-ish single image: small, production-ready, runs behind gunicorn.
FROM python:3.12-slim

# ffmpeg helps some audio paths; curl is used by the container healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000 \
    LOG_LEVEL=INFO \
    VOICE_MAX_INFLIGHT=96

WORKDIR /app

# Install dependencies first for better layer caching.
# Use the core requirements by default (server + edge-tts + NIM/brain over HTTP).
# Swap to requirements.txt if you also want local neural TTS (Kokoro/Piper).
COPY requirements-core.txt requirements.txt ./
RUN pip install --upgrade pip \
    && pip install -r requirements-core.txt gunicorn

# App code
COPY . .

# Run as a non-root user.
RUN useradd -m -u 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${PORT}/api/ready || exit 1

# gunicorn manages multiple uvicorn workers (real multi-core concurrency).
CMD ["gunicorn", "-c", "gunicorn_conf.py", "server:app"]
