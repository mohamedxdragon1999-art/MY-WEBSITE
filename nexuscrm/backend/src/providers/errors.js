// ═════════════════════════════════════════════════════════════════════════
// providers/errors.js — provider error taxonomy + completion validation
// (pure, strict ESM; no network, no state).
//
//   ProviderError       kinds: no_key | bad_key | no_credits | model_not_found |
//                       rate_limited | overloaded | timeout | network | malformed |
//                       reasoning_budget | unknown
//   classifyHttpError   HTTP status + body (OpenAI / Anthropic / RFC-7807 NIM /
//                       FastAPI detail arrays) → ProviderError with the right kind
//   validateCompletion  chat-completion JSON → { content, reasoning, usage },
//                       reasoning-model aware (reasoning_content / <think>)
// ═════════════════════════════════════════════════════════════════════════
import * as NIM from './nim.js';

export function providerPortal(provider) {
  return provider === 'nvidia' ? 'build.nvidia.com (free credits)' : provider === 'openai' ? 'platform.openai.com' : 'your custom server';
}

export class ProviderError extends Error {
  constructor(message, { kind = 'unknown', status, retryable, provider, retryAfterMs = 0 } = {}) {
    // HARDENING: provider echo (and everything downstream) is capped so a
    // hostile/broken provider can't push megabytes into UI toasts, logs or D1.
    super(String(message).slice(0, 500));
    this.kind = kind;      // no_key | bad_key | no_credits | model_not_found | rate_limited | overloaded | timeout | network | malformed | unknown
    this.status = status;
    this.retryable = retryable;
    this.provider = provider;
    this.retryAfterMs = retryAfterMs || 0; // ms to wait before retrying (429 Retry-After)
  }
}
export function classifyHttpError(status, body, provider, retryAfterHeader) {
  // NVIDIA (and some others) answer RFC-7807 style: { type, title, status, detail }
  let raw = body?.error?.message || body?.message || body?.detail || (typeof body?.error === 'string' ? body.error : '') || '';
  // FastAPI/NIM validation errors put an ARRAY of {loc,msg} in `detail` — turn
  // it into the human message(s), never "[object Object]".
  if (raw && typeof raw !== 'string') {
    if (Array.isArray(raw)) raw = raw.map(x => (x && typeof x === 'object') ? [Array.isArray(x.loc) ? x.loc.join('.') : '', x.msg || x.message || ''].filter(Boolean).join(': ') : String(x)).filter(Boolean).join('; ');
    else { try { raw = JSON.stringify(raw); } catch (e) { raw = String(raw); } }
  }
  // ── Cycle 52: Anthropic-style bodies { error: { type, message } } — the
  // type field classifies the failure more reliably than the HTTP status
  // alone. Mapped BEFORE status checks so it wins when present. ──
  const aType = String(body?.error?.type || '').toLowerCase();
  if (aType === 'authentication_error' || aType === 'permission_error') {
    return new ProviderError(String(raw || `Invalid or unauthorized API key for ${provider} — check it in Settings → AI Providers.`).slice(0, 300), { kind: 'bad_key', status: 401, provider });
  }
  if (aType === 'not_found_error') {
    return new ProviderError(String(raw || `Model not found on ${provider} — check the model name in Settings → AI Providers.`).slice(0, 300), { kind: 'model_not_found', status: 404, provider });
  }
  if (aType === 'rate_limit_error') {
    return new ProviderError(String(raw || `Rate limited by ${provider} — retrying on another provider.`).slice(0, 300), { kind: 'rate_limited', status: 429, retryable: true, provider, retryAfterMs: 2000 });
  }
  // ── Cycle 53: OpenAI-style machine codes ride in error.code — e.g.
  // model_not_found / context_length_exceeded. context_length_exceeded is a
  // 400-class REQUEST problem: no provider retry will shrink the prompt. ──
  const oCode = String(body?.error?.code || '').toLowerCase();
  if (oCode === 'model_not_found' || oCode === 'model_decommissioned') {
    return new ProviderError(String(raw || `Model not found on ${provider} — pick a current model in Settings.`).slice(0, 300), { kind: 'model_not_found', status: 404, provider });
  }
  if (oCode === 'context_length_exceeded' || oCode === 'maximum_context_length_exceeded') {
    return new ProviderError(String(raw || 'The conversation grew past this model context window — start a shorter conversation or pick a larger-context model.').slice(0, 300), { kind: 'unknown', status: 400, provider });
  }
  if (oCode === 'invalid_api_key' || oCode === 'invalid_auth') {
    return new ProviderError(String(raw || `Invalid API key for ${provider} — re-enter it in Settings → AI Providers.`).slice(0, 300), { kind: 'bad_key', status: 401, provider });
  }
  const msg = String(raw).slice(0, 300);
  // A 400 that says the id is an embedding/rerank/etc. endpoint is a MODEL
  // problem (pick a chat model), never a provider-health or request problem.
  if (status === 400 || status === 422) {
    const adapt = NIM.nimAdaptError(status, body, raw);
    if (adapt && adapt.kind === 'not_chat') return new ProviderError(`That model is not a chat model on ${provider} — ${adapt.message || 'pick a chat-completions model in Settings → AI Providers'}`.slice(0, 300), { kind: 'model_not_found', status, provider });
  }
  if (status === 401 || status === 403) {
    return new ProviderError(msg || `Invalid or unauthorized API key for ${provider} — check it in Settings → AI Providers (${providerPortal(provider)}).`, { kind: 'bad_key', status, provider });
  }
  if (status === 402) {
    return new ProviderError(msg || `${provider} says the account has no credits left — top up or grab free credits at ${providerPortal(provider)}.`, { kind: 'no_credits', status, provider });
  }
  if (status === 404) {
    return new ProviderError(msg || `Model not found on ${provider} — check the model name in Settings → AI Providers (e.g. nvidia/llama-3.1-nemotron-70b-instruct works on the NVIDIA free tier).`, { kind: 'model_not_found', status, provider });
  }
  if (status === 410) {
    // NVIDIA returns 410 "Gone" when a model reaches end-of-life — the key is fine,
    // the model itself is retired. Not retryable; the user must pick another model.
    return new ProviderError(msg || `That model has reached its end of life on ${provider} — pick a different model in Settings → AI Providers (e.g. nvidia/llama-3.1-nemotron-70b-instruct).`, { kind: 'model_not_found', status, provider });
  }
  if (status === 429) {
    // Retry-After arrives EITHER as an HTTP header (NVIDIA NIM style) or
    // inside the JSON body (OpenAI style). Read both, trust the header.
    let retryAfter = String(retryAfterHeader || '').trim() || String(body?.error?.headers?.retry_after || '');
    const ra = parseInt(retryAfter);
    if (!Number.isFinite(ra)) retryAfter = '';
    const delay = ra > 0 ? Math.min(ra, 30) : 0;
    return new ProviderError(msg || `Rate limited by ${provider}${retryAfter ? ` (retry in ~${retryAfter}s)` : ''} — retrying on another provider.`, { kind: 'rate_limited', status, retryable: true, provider, retryAfterMs: delay * 1000 });
  }
  if (status >= 500) {
    return new ProviderError(msg || `${provider} is overloaded or having issues (HTTP ${status}) — retrying.`, { kind: 'overloaded', status, retryable: true, provider });
  }
  if (status === 400) {
    return new ProviderError(msg || `${provider} rejected the request (HTTP 400) — the model may not accept this message format; try a different model.`, { kind: 'unknown', status, provider });
  }
  return new ProviderError(msg || `Provider error ${status}`, { status, provider });
}
export function parseProviderJson(text) {
  try { return JSON.parse(text); } catch (e) { return null; } // a non-JSON provider body is reported by the caller with the raw text
}
export function validateCompletion(d, provider, opts) {
  const choice = d?.choices?.[0];
  const rawContent = choice?.message?.content;
  // Reasoning models (DeepSeek-R1/V3.1, Qwen3, Nemotron-3, gpt-oss…) put their
  // thinking in `reasoning_content` or inline <think>…</think>; only the
  // answer after it is the content. Parts arrays are flattened too.
  const ex = NIM.nimExtractContent(choice?.message);
  const content = ex.content;
  const finish = choice?.finish_reason;
  if (finish === 'content_filter') {
    throw new ProviderError(`${provider} refused to answer (content filter) — rephrase the request or switch models.`, { kind: 'malformed', provider });
  }
  // A model that answers NOTHING (empty string, or a length-capped response
  // with zero content) is treated as malformed so the fallback chain
  // advances to the next model instead of returning a blank result. The
  // one exception: the budget ran out WHILE THINKING (reasoning present,
  // finish_reason=length) — that is a budget problem the caller can fix by
  // retrying with more room, so it is labelled distinctly.
  if ((typeof rawContent !== 'string' && !Array.isArray(rawContent) && !ex.reasoning) || !content.trim()) {
    if (ex.reasoning && (finish === 'length' || !finish)) {
      if (opts && opts.probe) return { content: '', reasoning: ex.reasoning, usage: { tokens_in: d.usage?.prompt_tokens || 0, tokens_out: d.usage?.completion_tokens || 0 }, thinking_only: true };
      throw new ProviderError(`${provider} spent the whole token budget thinking (reasoning model) — retrying with a larger budget.`, { kind: 'reasoning_budget', retryable: true, provider });
    }
    throw new ProviderError(`${provider} returned an unexpected or empty response (no text content). Try again or switch models.`, { kind: 'malformed', provider });
  }
  const usage = d.usage || {};
  return {
    content,
    reasoning: ex.reasoning || undefined,
    // finish_reason travels with the result: 'length' tells a long-form caller
    // (the website builder) the answer was cut by max_tokens, before it looks.
    finish: typeof finish === 'string' ? finish : undefined,
    usage: { tokens_in: usage.prompt_tokens || usage.input_tokens || 0, tokens_out: usage.completion_tokens || usage.output_tokens || 0 },
  };
}
