#!/usr/bin/env python3
"""Cycle 1: model fallback chains, provider health stats, SSE provider metadata."""
import sys
P = 'backend/src/index.js'
s = open(P, encoding='utf-8').read()

def rep(old, new, tag, count=1):
    global s
    n = s.count(old)
    if n != count:
        print(f'❌ [{tag}] found {n}'); print('OLD:', repr(old[:110])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

# ── 1. Health stats: track successes/requests + expose snapshot ──
rep("""const PROVIDER_HEALTH = new Map(); // provider -> { fails, cooldownUntil, lastErr }
const CB_THRESHOLD = 3;            // consecutive failures before cooldown
const CB_COOLDOWN_MS = 60000;      // 60s cooldown""",
"""const PROVIDER_HEALTH = new Map(); // provider -> { fails, cooldownUntil, lastErr, ok, reqs, lastOkAt }
const CB_THRESHOLD = 3;            // consecutive failures before cooldown
const CB_COOLDOWN_MS = 60000;      // 60s cooldown
// Snapshot of live provider health (used by /ai/providers + Settings UI).
function providerHealthSnapshot() {
  const now = Date.now();
  const out = {};
  for (const p of ['nvidia', 'openai', 'custom']) {
    const h = PROVIDER_HEALTH.get(p);
    out[p] = {
      status: h ? (h.cooldownUntil && h.cooldownUntil > now ? 'cooldown' : (h.fails > 0 ? 'degraded' : 'ok')) : 'untested',
      fails: h?.fails || 0,
      requests: h?.reqs || 0,
      successes: h?.ok || 0,
      last_error: h?.lastErr || null,
      cooldown_until: h?.cooldownUntil ? new Date(h.cooldownUntil).toISOString() : null,
      last_ok_at: h?.lastOkAt ? new Date(h.lastOkAt).toISOString() : null,
    };
  }
  return out;
}""",
'health snapshot')

rep("""function recordProviderSuccess(p) {
  PROVIDER_HEALTH.set(p, { fails: 0, cooldownUntil: null, lastErr: null, lastOkAt: Date.now() });
}
function recordProviderFailure(p, message) {
  const h = PROVIDER_HEALTH.get(p) || { fails: 0 };
  h.fails = (h.fails || 0) + 1;
  h.lastErr = message;
  if (h.fails >= CB_THRESHOLD) h.cooldownUntil = Date.now() + CB_COOLDOWN_MS;
  PROVIDER_HEALTH.set(p, h);
}""",
"""function recordProviderSuccess(p) {
  const h = PROVIDER_HEALTH.get(p) || { fails: 0 };
  h.fails = 0; h.cooldownUntil = null; h.lastErr = null; h.lastOkAt = Date.now();
  h.ok = (h.ok || 0) + 1; h.reqs = (h.reqs || 0) + 1;
  PROVIDER_HEALTH.set(p, h);
}
function recordProviderFailure(p, message) {
  const h = PROVIDER_HEALTH.get(p) || { fails: 0 };
  h.fails = (h.fails || 0) + 1;
  h.lastErr = message;
  h.reqs = (h.reqs || 0) + 1;
  if (h.fails >= CB_THRESHOLD) h.cooldownUntil = Date.now() + CB_COOLDOWN_MS;
  PROVIDER_HEALTH.set(p, h);
}""",
'health counters')

# ── 2. Model fallback chain: ai_model may be "model1,model2" — try each on same provider ──
rep("""function providerRequest(w, provider) {
  let url, key, model;
  if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions'; key = w.ai_openai_key; model = w.ai_model || 'gpt-4o-mini';
  } else if (provider === 'nvidia') {
    url = 'https://integrate.api.nvidia.com/v1/chat/completions'; key = w.ai_nvidia_key; model = w.ai_model || 'meta/llama-3.1-8b-instruct';
  } else if (provider === 'custom') {
    url = (w.ai_custom_base_url || 'http://localhost:11434/v1').replace(/\\/$/, '') + '/chat/completions';
    key = w.ai_custom_key || ''; model = w.ai_model || 'llama3.1';
  } else return null;
  return { url, key, model, provider };
}""",
"""function providerRequest(w, provider) {
  let url, key, model;
  if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions'; key = w.ai_openai_key; model = w.ai_model || 'gpt-4o-mini';
  } else if (provider === 'nvidia') {
    url = 'https://integrate.api.nvidia.com/v1/chat/completions'; key = w.ai_nvidia_key; model = w.ai_model || 'meta/llama-3.1-8b-instruct';
  } else if (provider === 'custom') {
    url = (w.ai_custom_base_url || 'http://localhost:11434/v1').replace(/\\/$/, '') + '/chat/completions';
    key = w.ai_custom_key || ''; model = w.ai_model || 'llama3.1';
  } else return null;
  // Model fallback chain: "a,b,c" means try a, then b, then c on this provider.
  const models = String(model || '').split(',').map(m => m.trim()).filter(Boolean);
  return { url, key, models: models.length ? models : [model], provider };
}""",
'model chain')

# callProviderOnce: iterate models; a model-level error (404/bad request) tries next model
old_call = """async function callProviderOnce(w, provider, messages, opts) {
  const req = providerRequest(w, provider);
  if (!req) throw new ProviderError(`No key configured for ${provider}`, { kind: 'no_key', provider });
  const body = {
    model: req.model,
    messages: guardPayload(buildMessages(w, messages)),
    temperature: Math.max(0, Math.min(2, opts?.temperature ?? w.ai_temperature ?? 0.7)),
    max_tokens: Math.max(1, Math.min(8192, opts?.max_tokens ?? w.ai_max_tokens ?? 1024)),
  };
  if (opts?.json_mode) body.response_format = { type: 'json_object' };"""
new_call = """async function callProviderOnce(w, provider, messages, opts) {
  const req = providerRequest(w, provider);
  if (!req) throw new ProviderError(`No key configured for ${provider}`, { kind: 'no_key', provider });
  const models = req.models || [req.model];
  let lastModelErr = null;
  // Try each model in the fallback chain; only model-level failures (404 /
  // 400 / malformed) fall through to the next model, other errors propagate.
  for (const model of models) {
    try {
      const body = {
        model,
        messages: guardPayload(buildMessages(w, messages)),
        temperature: Math.max(0, Math.min(2, opts?.temperature ?? w.ai_temperature ?? 0.7)),
        max_tokens: Math.max(1, Math.min(8192, opts?.max_tokens ?? w.ai_max_tokens ?? 1024)),
      };
      if (opts?.json_mode) body.response_format = { type: 'json_object' };"""
n = s.count(old_call)
if n != 1:
    print('❌ callProviderOnce head not found'); sys.exit(1)
s = s.replace(old_call, new_call)

# close the model loop: replace the tail of callProviderOnce (after parse/validate, before return)
old_tail = """  let result;
  try { result = validateCompletion(d, provider); }
  catch (e) { recordProviderFailure(provider, e.message); throw e; }
  recordProviderSuccess(provider);
  return { ...result, provider, model: req.model };
}"""
new_tail = """    let result;
    try { result = validateCompletion(d, provider); }
    catch (e) {
      // malformed from THIS model — try the next one in the chain
      lastModelErr = e;
      recordProviderFailure(provider, e.message);
      continue;
    }
    recordProviderSuccess(provider);
    return { ...result, provider, model };
      } catch (e) {
        // only model-level errors advance the chain
        if (e instanceof ProviderError && (e.kind === 'model_not_found' || e.kind === 'unknown' || e.kind === 'malformed')) {
          lastModelErr = e;
          recordProviderFailure(provider, e.message);
          continue;
        }
        throw e;
      }
  }
  throw lastModelErr || new ProviderError(`All models failed on ${provider}`, { kind: 'unknown', provider });
}"""
n = s.count(old_tail)
if n != 1:
    print('❌ callProviderOnce tail not found (count %d)' % n); sys.exit(1)
s = s.replace(old_tail, new_tail)
print('  ✅ callProviderOnce model chain')

# openProviderStream: same chain for models
old_stream = """    const req = providerRequest(w, p);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts?.timeoutMs || AI_STREAM_FIRST_BYTE_MS);
    let r;
    try {
      r = await fetch(req.url, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', ...(req.key ? { Authorization: `Bearer ${req.key}` } : {}) },
        body: JSON.stringify({ model: req.model, messages: guardPayload(buildMessages(w, messages)), temperature: opts?.temperature ?? w.ai_temperature ?? 0.7, max_tokens: Math.max(1, Math.min(8192, opts?.max_tokens ?? w.ai_max_tokens ?? 1024)), stream: true }),
      });
    } catch (e) {
      clearTimeout(t);
      errs.push(`${p}: ${e.name === 'AbortError' ? 'timed out' : e.message}`);
      recordProviderFailure(p, e.name === 'AbortError' ? 'stream timeout' : e.message);
      continue;
    }
    clearTimeout(t);
    if (!r.ok || !r.body) {
      const b = parseProviderJson(await r.text().catch(() => ''));
      const e = classifyHttpError(r.status, b, p);
      errs.push(`${p}: ${e.message}`);
      if (e.kind !== 'rate_limited' && e.kind !== 'overloaded' && e.kind !== 'timeout' && e.kind !== 'network') recordProviderFailure(p, e.message);
      continue;
    }
    recordProviderSuccess(p);
    return { res: r, provider: p, model: req.model };
  }"""
new_stream = """    const req = providerRequest(w, p);
    for (const model of (req.models || [req.model])) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), opts?.timeoutMs || AI_STREAM_FIRST_BYTE_MS);
      let r;
      try {
        r = await fetch(req.url, {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', ...(req.key ? { Authorization: `Bearer ${req.key}` } : {}) },
          body: JSON.stringify({ model, messages: guardPayload(buildMessages(w, messages)), temperature: opts?.temperature ?? w.ai_temperature ?? 0.7, max_tokens: Math.max(1, Math.min(8192, opts?.max_tokens ?? w.ai_max_tokens ?? 1024)), stream: true }),
        });
      } catch (e) {
        clearTimeout(t);
        errs.push(`${p}/${model}: ${e.name === 'AbortError' ? 'timed out' : e.message}`);
        recordProviderFailure(p, e.name === 'AbortError' ? 'stream timeout' : e.message);
        continue;
      }
      clearTimeout(t);
      if (!r.ok || !r.body) {
        const b = parseProviderJson(await r.text().catch(() => ''));
        const e = classifyHttpError(r.status, b, p);
        errs.push(`${p}/${model}: ${e.message}`);
        if (e.kind === 'model_not_found' || e.kind === 'unknown') { recordProviderFailure(p, e.message); continue; } // try next model
        if (e.kind !== 'rate_limited' && e.kind !== 'overloaded' && e.kind !== 'timeout' && e.kind !== 'network') recordProviderFailure(p, e.message);
        break; // provider-level error → next provider
      }
      recordProviderSuccess(p);
      return { res: r, provider: p, model };
    }
  }"""
n = s.count(old_stream)
if n != 1:
    print('❌ openProviderStream block not found'); sys.exit(1)
s = s.replace(old_stream, new_stream)
print('  ✅ openProviderStream model chain')

# ── 3. SSE metadata: first event tells the UI which provider+model answered ──
old_meta = """  const reader = streamRes.res.body.getReader();
  const decoder = new TextDecoder(); const encoder = new TextEncoder();
  let buf = '';
  let fullText = '';
  const stream = new ReadableStream({"""
new_meta = """  const reader = streamRes.res.body.getReader();
  const decoder = new TextDecoder(); const encoder = new TextEncoder();
  let buf = '';
  let fullText = '';
  let metaSent = false;
  const stream = new ReadableStream({
    start(controller) {
      // Announce which provider + model is answering (UI shows it).
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ meta: { provider: streamRes.provider, model: streamRes.model } })}\\n\\n`));
    },"""
n = s.count(old_meta)
if n != 1:
    print('❌ stream start anchor not found'); sys.exit(1)
s = s.replace(old_meta, new_meta)
print('  ✅ SSE meta event')

open(P, 'w', encoding='utf-8').write(s)
print('Cycle 1 backend done.')
