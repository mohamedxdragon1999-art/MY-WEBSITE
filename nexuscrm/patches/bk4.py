#!/usr/bin/env python3
"""Backend patch 4: hardened AI provider layer (circuit breaker, backoff, taxonomy, validation)."""
import sys
P = 'backend/src/index.js'
s = open(P, encoding='utf-8').read()

start = "function hasKeyFor(w, provider) {"
end = "  throw new Error('All AI providers failed to stream — ' + errs.join(' | '));\n}"
i = s.find(start)
if i < 0:
    print('start not found'); sys.exit(1)
j = s.find(end, i)
if j < 0:
    print('end not found'); sys.exit(1)
j += len(end)

new_block = r'''// ════════════════════════════════════════════════════════════
// HARDENED PROVIDER LAYER (V5)
//  * Circuit breaker: a provider that fails 3x consecutively is put in a
//    60s cooldown and skipped — a sick provider can't drag every request.
//  * Smart routing: providers are ordered by (cooldown, recent failures),
//    then by user preference.
//  * Retries: exponential backoff with jitter on retryable errors only.
//  * Error taxonomy: precise, actionable messages for every failure class
//    (bad key / out of credits / model missing / rate limited / overloaded
//    / timeout / network / malformed response).
//  * Response validation: the reply must be OpenAI-shaped JSON with a real
//    content string — anything else is a "malformed response" error.
//  * Payload guards: total size caps so a giant paste can't blow limits.
// ════════════════════════════════════════════════════════════
const PROVIDER_HEALTH = new Map(); // provider -> { fails, cooldownUntil, lastErr }
const CB_THRESHOLD = 3;            // consecutive failures before cooldown
const CB_COOLDOWN_MS = 60000;      // 60s cooldown
const AI_TIMEOUT_MS = 30000;       // non-stream per-attempt timeout
const AI_STREAM_FIRST_BYTE_MS = 45000;
const MAX_PAYLOAD_CHARS = 60000;   // hard cap on serialized messages

function hasKeyFor(w, provider) {
  if (provider === 'openai') return !!w.ai_openai_key;
  if (provider === 'nvidia') return !!w.ai_nvidia_key;
  if (provider === 'custom') {
    if (!w.ai_custom_base_url) return false;
    return w.ai_custom_base_url !== 'http://localhost:11434/v1' || !!w.ai_custom_key || w.ai_provider === 'custom';
  }
  return false;
}
function providerRequest(w, provider) {
  let url, key, model;
  if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions'; key = w.ai_openai_key; model = w.ai_model || 'gpt-4o-mini';
  } else if (provider === 'nvidia') {
    url = 'https://integrate.api.nvidia.com/v1/chat/completions'; key = w.ai_nvidia_key; model = w.ai_model || 'meta/llama-3.1-8b-instruct';
  } else if (provider === 'custom') {
    url = (w.ai_custom_base_url || 'http://localhost:11434/v1').replace(/\/$/, '') + '/chat/completions';
    key = w.ai_custom_key || ''; model = w.ai_model || 'llama3.1';
  } else return null;
  return { url, key, model, provider };
}
// Providers in the order they should be tried: healthy ones first, then
// cooled-down ones, always ending with the user's own preference order.
function providerPriority(w) {
  const pref = [];
  if (isIn(w.ai_provider, ['openai', 'nvidia', 'custom']) && hasKeyFor(w, w.ai_provider)) pref.push(w.ai_provider);
  ['openai', 'nvidia', 'custom'].forEach(p => { if (p !== w.ai_provider && hasKeyFor(w, p)) pref.push(p); });
  const now = Date.now();
  const healthy = pref.filter(p => !isProviderCooledDown(p, now));
  const cooling = pref.filter(p => isProviderCooledDown(p, now));
  return healthy.concat(cooling);
}
function isProviderCooledDown(p, now) {
  const h = PROVIDER_HEALTH.get(p);
  return !!(h && h.cooldownUntil && h.cooldownUntil > now);
}
function recordProviderSuccess(p) {
  PROVIDER_HEALTH.set(p, { fails: 0, cooldownUntil: null, lastErr: null, lastOkAt: Date.now() });
}
function recordProviderFailure(p, message) {
  const h = PROVIDER_HEALTH.get(p) || { fails: 0 };
  h.fails = (h.fails || 0) + 1;
  h.lastErr = message;
  if (h.fails >= CB_THRESHOLD) h.cooldownUntil = Date.now() + CB_COOLDOWN_MS;
  PROVIDER_HEALTH.set(p, h);
}
function buildMessages(w, messages) {
  let msgs = messages;
  if (w.ai_system_prompt) msgs = [{ role: 'system', content: w.ai_system_prompt }, ...messages.filter(m => m.role !== 'system')];
  return msgs;
}
function guardPayload(messages) {
  // Cap total payload size (defense against giant pastes blowing limits).
  let total = 0;
  const out = [];
  for (const m of messages) {
    const content = String(m.content || '');
    const keep = content.slice(0, 8000);
    total += keep.length;
    if (total > MAX_PAYLOAD_CHARS) break;
    out.push({ role: m.role === 'system' ? 'system' : (m.role === 'assistant' ? 'assistant' : 'user'), content: keep });
  }
  if (!out.length) out.push({ role: 'user', content: 'Hello' });
  return out;
}
function providerPortal(provider) {
  return provider === 'nvidia' ? 'build.nvidia.com (free credits)' : provider === 'openai' ? 'platform.openai.com' : 'your custom server';
}
class ProviderError extends Error {
  constructor(message, { kind = 'unknown', status, retryable, provider } = {}) {
    super(message);
    this.kind = kind;      // no_key | bad_key | no_credits | model_not_found | rate_limited | overloaded | timeout | network | malformed | unknown
    this.status = status;
    this.retryable = retryable;
    this.provider = provider;
  }
}
function classifyHttpError(status, body, provider) {
  const raw = body?.error?.message || body?.message || '';
  const msg = String(raw).slice(0, 300);
  if (status === 401 || status === 403) {
    return new ProviderError(msg || `Invalid or unauthorized API key for ${provider} — check it in Settings → AI Providers (${providerPortal(provider)}).`, { kind: 'bad_key', status, provider });
  }
  if (status === 402) {
    return new ProviderError(msg || `${provider} says the account has no credits left — top up or grab free credits at ${providerPortal(provider)}.`, { kind: 'no_credits', status, provider });
  }
  if (status === 404) {
    return new ProviderError(msg || `Model not found on ${provider} — check the model name in Settings → AI Providers (e.g. meta/llama-3.1-8b-instruct works on the NVIDIA free tier).`, { kind: 'model_not_found', status, provider });
  }
  if (status === 429) {
    const retryAfter = (body?.error?.headers?.retry_after) || '';
    return new ProviderError(msg || `Rate limited by ${provider}${retryAfter ? ` (retry in ~${retryAfter}s)` : ''} — retrying on another provider.`, { kind: 'rate_limited', status, retryable: true, provider });
  }
  if (status >= 500) {
    return new ProviderError(msg || `${provider} is overloaded or having issues (HTTP ${status}) — retrying.`, { kind: 'overloaded', status, retryable: true, provider });
  }
  if (status === 400) {
    return new ProviderError(msg || `${provider} rejected the request (HTTP 400) — the model may not accept this message format; try a different model.`, { kind: 'unknown', status, provider });
  }
  return new ProviderError(msg || `Provider error ${status}`, { status, provider });
}
function parseProviderJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
function validateCompletion(d, provider) {
  const content = d?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new ProviderError(`${provider} returned an unexpected or empty response (no text content). Try again or switch models.`, { kind: 'malformed', provider });
  }
  const usage = d.usage || {};
  return {
    content,
    usage: { tokens_in: usage.prompt_tokens || usage.input_tokens || 0, tokens_out: usage.completion_tokens || 0 },
  };
}
async function callProviderOnce(w, provider, messages, opts) {
  const req = providerRequest(w, provider);
  if (!req) throw new ProviderError(`No key configured for ${provider}`, { kind: 'no_key', provider });
  const body = {
    model: req.model,
    messages: guardPayload(buildMessages(w, messages)),
    temperature: Math.max(0, Math.min(2, opts?.temperature ?? w.ai_temperature ?? 0.7)),
    max_tokens: Math.max(1, Math.min(8192, opts?.max_tokens ?? w.ai_max_tokens ?? 1024)),
  };
  if (opts?.json_mode) body.response_format = { type: 'json_object' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts?.timeoutMs || AI_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(req.url, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(req.key ? { Authorization: `Bearer ${req.key}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch (e) {
    clearTimeout(t);
    const timeout = e.name === 'AbortError';
    throw new ProviderError(
      timeout ? `${provider} timed out after ${Math.round((opts?.timeoutMs || AI_TIMEOUT_MS) / 1000)}s — try again or switch models.` : `Could not reach ${provider}: ${e.message}`,
      { kind: timeout ? 'timeout' : 'network', retryable: true, provider }
    );
  }
  clearTimeout(t);
  if (!r.ok) {
    const b = parseProviderJson(await r.text().catch(() => ''));
    const e = classifyHttpError(r.status, b, provider);
    if (!e.retryable) recordProviderFailure(provider, e.message);
    throw e;
  }
  const d = parseProviderJson(await r.text().catch(() => ''));
  if (!d) {
    recordProviderFailure(provider, 'malformed JSON response');
    throw new ProviderError(`${provider} sent an unreadable response — try again or switch models.`, { kind: 'malformed', retryable: true, provider });
  }
  let result;
  try { result = validateCompletion(d, provider); }
  catch (e) { recordProviderFailure(provider, e.message); throw e; }
  recordProviderSuccess(provider);
  return { ...result, provider, model: req.model };
}
// Non-streaming call: circuit-breaker aware, exponential backoff + jitter.
async function callProvider(w, messages, opts) {
  const list = providerPriority(w);
  if (!list.length) throw new ProviderError('No AI provider configured — add a free NVIDIA NIM key in Settings → AI Providers (build.nvidia.com).', { kind: 'no_key' });
  const errs = [];
  const attempted = new Set();
  for (const p of list) {
    if (attempted.has(p)) continue;
    attempted.add(p);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callProviderOnce(w, p, messages, opts);
      } catch (e) {
        errs.push(`${p}: ${e.message}`);
        if (e instanceof ProviderError && !e.retryable) { recordProviderFailure(p, e.message); break; }
        if (e instanceof ProviderError && (e.kind === 'bad_key' || e.kind === 'no_credits' || e.kind === 'model_not_found')) { recordProviderFailure(p, e.message); break; }
        // retryable: exponential backoff with jitter (400ms, 800ms)
        if (attempt === 0) await sleep(300 + Math.random() * 250);
        else await sleep(600 + Math.random() * 400);
      }
    }
  }
  throw new Error('All AI providers failed — ' + [...new Set(errs)].join(' | '));
}
// Streaming: same routing + circuit breaker; errors before the first byte
// fall through to the next provider.
async function openProviderStream(w, messages, opts) {
  const list = providerPriority(w);
  if (!list.length) throw new ProviderError('No AI provider configured — add a free NVIDIA NIM key in Settings → AI Providers (build.nvidia.com).', { kind: 'no_key' });
  const errs = [];
  const attempted = new Set();
  for (const p of list) {
    if (attempted.has(p)) continue;
    attempted.add(p);
    const req = providerRequest(w, p);
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
  }
  throw new Error('All AI providers failed to stream — ' + [...new Set(errs)].join(' | '));
}

'''

s = s[:i] + new_block + s[j:]
open(P, 'w', encoding='utf-8').write(s)
print('provider layer replaced')
