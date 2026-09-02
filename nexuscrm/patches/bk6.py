#!/usr/bin/env python3
"""Backend patch 6: LIVE model catalog fetched from NVIDIA/OpenAI (cached, fallback-safe)."""
import sys
P = 'backend/src/index.js'
s = open(P, encoding='utf-8').read()

def rep(old, new, tag):
    global s
    n = s.count(old)
    if n != 1:
        print(f'❌ [{tag}] found {n}'); print('OLD:', repr(old[:100])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

# 1. Add live-fetch machinery right after MODEL_LISTS
rep("""const MODEL_LISTS = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-3.5-turbo', 'o3-mini'],
  nvidia: [
    'meta/llama-3.3-70b-instruct', 'meta/llama-3.1-405b-instruct', 'meta/llama-3.1-70b-instruct',
    'meta/llama-3.1-8b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct', 'nvidia/nemotron-4-340b-instruct',
    'deepseek-ai/deepseek-r1', 'deepseek-ai/deepseek-v3', 'mistralai/mistral-large-2-instruct',
    'microsoft/phi-3-medium-128k-instruct', 'google/gemma-2-27b-it', 'meta/llama-3.2-90b-vision-instruct',
    'qwen/qwen2-7b-instruct', 'meta/llama-3.2-3b-instruct',
  ],
  custom: [],
};""",
"""const MODEL_LISTS = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-3.5-turbo', 'o3-mini'],
  nvidia: [
    'meta/llama-3.3-70b-instruct', 'meta/llama-3.1-405b-instruct', 'meta/llama-3.1-70b-instruct',
    'meta/llama-3.1-8b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct', 'nvidia/nemotron-4-340b-instruct',
    'deepseek-ai/deepseek-r1', 'deepseek-ai/deepseek-v3', 'mistralai/mistral-large-2-instruct',
    'microsoft/phi-3-medium-128k-instruct', 'google/gemma-2-27b-it', 'meta/llama-3.2-90b-vision-instruct',
    'qwen/qwen2-7b-instruct', 'meta/llama-3.2-3b-instruct',
  ],
  custom: [],
};

// ════════════════════════════════════════════════════════════
// LIVE MODEL CATALOG — real models from the providers, not placeholders.
//  * Fetches NVIDIA's OpenAI-compatible /v1/models with YOUR key, so when
//    NVIDIA adds/removes models the app reflects it automatically.
//  * Cached per workspace for 10 minutes (fast page loads).
//  * Non-chat endpoints (embed/rerank/tts/vision-gallery etc.) are filtered
//    out so the dropdown only shows models you can chat with.
//  * If the live fetch fails (no key / network / provider hiccup) it falls
//    back to the curated list — the app never breaks.
// ════════════════════════════════════════════════════════════
const MODELS_CACHE = new Map();          // `${provider}:${workspaceId}` -> { data, ts }
const MODELS_TTL_MS = 10 * 60 * 1000;    // 10 minutes
const NON_CHAT_MODEL_RE = /embed|rerank|classify|tts|stt|asr|audio|video|guard|ocr|segmentation|image-gen|flux|sdxl|pixart|vlm|retrieval/i;

async function fetchLiveModels(provider, w, refresh) {
  const cacheKey = `${provider}:${w.id}`;
  if (!refresh) {
    const cached = MODELS_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < MODELS_TTL_MS) return cached.data;
  }
  let live = null;
  const key = provider === 'nvidia' ? w.ai_nvidia_key : w.ai_openai_key;
  const url = provider === 'nvidia'
    ? 'https://integrate.api.nvidia.com/v1/models'
    : 'https://api.openai.com/v1/models';
  if (key) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) {
        const d = await r.json();
        const ids = (d.data || [])
          .map(m => String(m.id || ''))
          .filter(id => id && id.length < 120 && !NON_CHAT_MODEL_RE.test(id));
        // Sanity: only accept a real list (>=3 entries), capped for a sane dropdown.
        if (ids.length >= 3) live = [...new Set(ids)].slice(0, 120);
      }
    } catch { /* live fetch failed — fall back to curated below */ }
  }
  const data = live || MODEL_LISTS[provider] || [];
  MODELS_CACHE.set(cacheKey, { data, ts: Date.now() });
  return data;
}""",
'live model machinery')

# 2. Route: serve live catalog
rep("""  if (path === '/ai/models' && req.method === 'GET') return json(MODEL_LISTS, 200, origin);""",
"""  if (path === '/ai/models' && req.method === 'GET') {
    const w = await getWorkspace(env, auth.workspaceId);
    const refresh = query.get('refresh') === '1';
    const [nvidia, openai] = await Promise.all([
      fetchLiveModels('nvidia', w, refresh),
      fetchLiveModels('openai', w, refresh),
    ]);
    return json({ nvidia, openai, custom: [], live: !!(nvidia && nvidia.length > 3) }, 200, origin);
  }""",
'live models route')

open(P, 'w', encoding='utf-8').write(s)
print('Backend patch 6 done.')
