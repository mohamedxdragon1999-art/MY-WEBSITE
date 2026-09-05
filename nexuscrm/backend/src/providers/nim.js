// ═════════════════════════════════════════════════════════════════════════
// providers/nim.js — NVIDIA NIM adapter knowledge (pure, strict ESM).
//
// NIM (integrate.api.nvidia.com and self-hosted NIM containers) speaks the
// OpenAI chat-completions dialect, but the ~150 models behind it do NOT all
// behave the same. This module is everything the worker needs to make ANY
// model in the catalog usable, without hardcoding a per-model table that
// goes stale the week NVIDIA ships new models:
//
//   • endpoint math      — default vs custom base URL, pasted full URLs
//   • model-id hygiene   — "https://build.nvidia.com/deepseek-ai/deepseek-r1"
//                          pasted from the browser → "deepseek-ai/deepseek-r1"
//   • capability profile — reasoning / vision / code families (heuristic;
//                          the live /ai/models/check route is the proof)
//   • chat-vs-not filter — embeddings, rerankers, ASR/TTS, image/video gen,
//                          bio/physics NIMs never reach the chat dropdown;
//                          vision-CHAT models (llama-3.2-vision, VILA, NeVA,
//                          gemma-3, qwen-vl…) DO — they answer text prompts
//   • reasoning output   — `reasoning_content` (DeepSeek/Qwen3/Nemotron-3/
//                          gpt-oss) and inline `<think>…</think>` are split
//                          from the answer, for both JSON and SSE responses
//   • error adaptation   — a 400 that says "system role not supported",
//                          "max_tokens must be ≤ 4096", "response_format not
//                          supported", "roles must alternate", "use
//                          max_completion_tokens" … is turned into a concrete
//                          request adjustment the caller applies and retries
//                          ONCE (then remembers per model)
//
// Nothing here touches the network or global state — the worker owns the
// fetch, the breaker and the memory of learned adjustments.
// ═════════════════════════════════════════════════════════════════════════

export const NIM_DEFAULT_BASE = 'https://integrate.api.nvidia.com/v1';
export const NIM_DEFAULT_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct';
export const NIM_PORTAL = 'build.nvidia.com';

/* ── endpoints ─────────────────────────────────────────────────────────── */

/** Normalise a base URL: '' → default; strips a pasted `/chat/completions` or `/models` suffix and trailing slashes. */
export function nimBase(raw) {
  let s = String(raw || '').trim();
  if (!s) return NIM_DEFAULT_BASE;
  s = s.replace(/[\u0000-\u001f\u007f\s]+/g, '');
  s = s.replace(/\/+$/, '');
  s = s.replace(/\/(chat\/completions|completions|models|embeddings)$/i, '');
  return s || NIM_DEFAULT_BASE;
}
export function nimChatUrl(base) { return nimBase(base) + '/chat/completions'; }
export function nimModelsUrl(base) { return nimBase(base) + '/models'; }

/* ── model ids ─────────────────────────────────────────────────────────── */

/**
 * Turn whatever the operator pasted into a model id NIM accepts.
 *   "https://build.nvidia.com/deepseek-ai/deepseek-r1"            → deepseek-ai/deepseek-r1
 *   "https://build.nvidia.com/nvidia/llama-3_1-nemotron-70b-instruct/modelcard" → nvidia/llama-3.1-nemotron-70b-instruct
 *   " `meta/llama-3.3-70b-instruct` "                              → meta/llama-3.3-70b-instruct
 *   "models/qwen/qwen3-235b-a22b"                                  → qwen/qwen3-235b-a22b
 */
export function nimNormalizeModelId(raw) {
  let s = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  s = s.replace(/^[`'"“”‘’\s]+|[`'"“”‘’\s.,;]+$/g, '');
  const url = s.match(/build\.nvidia\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/);
  if (url) s = url[1] + '/' + url[2].replace(/_(\d)/g, '.$1'); // build.nvidia.com slugs use 3_1 for 3.1
  s = s.replace(/^(?:models|model|nim|v1)\//i, '');
  s = s.replace(/^\/+|\/+$/g, '');
  s = s.split(/[\s?#]/)[0];
  return s.slice(0, 200);
}

/** Split a comma/newline-separated fallback chain into clean ids. */
export function nimModelChain(raw) {
  const out = [];
  for (const part of String(raw || '').split(/[,\n]/)) {
    const id = nimNormalizeModelId(part);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Looks like an "org/model" NIM id (vs an OpenAI-style bare id). */
export function nimLooksLikeNimId(id) { return /^[a-z0-9_.-]+\/[a-z0-9_.:-]+$/i.test(String(id || '')); }

/* ── capability profile ────────────────────────────────────────────────── */

const REASONING_RE = /(deepseek-r1|deepseek-v3\.?1|deepseek-v4|qwen3|qwq|gpt-oss|nemotron-3-(nano|super|ultra)|nemotron-nano-2|nemotron-super|nemotron-ultra|llama-3\.1-nemotron-ultra|reasoning|thinking|-think|\br1\b|\bo[1-4](-|$)|glm-4\.[5-9]|glm-5|kimi-k[2-9]|minimax-m|magistral|phi-4-reasoning|phi-4-mini-reasoning|seed-oss|exaone-deep|granite-4|cogito|openthinker|acereason|nemotron-research-reasoning|sonar-reasoning|grok-3-mini|grok-4|claude)/i;
const VISION_RE = /(vision|-vl\b|-vl-|\bvl\b|vlm|vila|neva|llava|pixtral|phi-3-vision|phi-3\.5-vision|phi-4-multimodal|gemma-3(?!n)|gemma-3-\d+b-it|qwen2-vl|qwen2\.5-vl|qwen3-vl|kimi-vl|llama-4|llama-3\.2-(11|90)b|paligemma|cosmos-reason|nemotron-nano-vl|nemotron-nano-12b-v2-vl|molmo|idefics|internvl|minicpm-v|ovis|glm-4v|glm-4\.1v|mistral-small-3|mistral-medium-3|gpt-4o|gpt-4\.1|gpt-5)/i;
const CODE_RE = /(coder|codellama|starcoder|codestral|deepseek-coder|codegemma|devstral|qwen2\.5-coder|granite-code|nemotron-code|code-)/i;
const SMALL_RE = /(\b|-)(0\.5|0\.6|1|1\.5|1\.7|2|3|3\.8|4|7|8)b(\b|-)|mini|nano|tiny|small/i;

/** Heuristic capability profile for a model id (no network). */
export function nimModelProfile(id) {
  const m = String(id || '');
  const reasoning = REASONING_RE.test(m);
  const vision = VISION_RE.test(m);
  const code = CODE_RE.test(m);
  const org = m.includes('/') ? m.split('/')[0].toLowerCase() : '';
  const small = SMALL_RE.test(m) && !/\d{2,3}b/.test(m);
  return {
    id: m, org, reasoning, vision, code, small,
    // Reasoning models spend tokens THINKING before they answer: a tiny
    // max_tokens (the classic "reply with one word" health probe) returns an
    // empty answer with all the budget in reasoning_content. Give them room.
    minBudget: reasoning ? 1024 : 1,
  };
}

/* ── chat-vs-not-chat filter ───────────────────────────────────────────── */

// Substring tokens (lower-case) that mark endpoints you cannot CHAT with using
// text-only messages: embeddings, rerankers, guards/classifiers, ASR/TTS/
// translation, image/video/3D generation, bio/chem/physics/weather NIMs,
// detectors/segmenters, OCR/document parsers, reward models — and the
// first-generation VLMs (neva, vila, llava, fuyu, kosmos-2, paligemma) that
// NVIDIA serves on /v1/vlm/*, NOT on chat/completions (verified 2026-08-27:
// they fail when picked). Modern vision-CHAT models (llama-3.2-vision,
// gemma-3, qwen-vl, nemotron-nano-vl, phi-3.5-vision) are chat/completions
// models that answer text-only prompts, so they are deliberately NOT here.
const NON_CHAT_TOKENS = [
  'embed', 'rerank', 'classif', 'guard', 'safety', 'moderat', 'reward', 'synthetic', 'jailbreak', 'topic-control', 'content-safety',
  'ocr', 'paddle', 'nemoretriever', 'retriever', 'retrieval', 'nvclip', 'clip-', '/clip', 'siglip', 'colpali', 'jina', 'arctic-embed', 'bge-', 'e5-', 'omniparser', 'page-elements', 'graphic-elements', 'table-structure', 'deplot', 'kosmos', 'fuyu', 'florence', 'parse',
  'neva', '/vila', 'vila-', 'llava', 'paligemma',
  'asr', 'parakeet', 'canary-', 'whisper', 'tts', 'fastpitch', 'magpie', 'riva', 'translate', 'nmt', 'audio', 'speech', 'voice', 'music', 'sound', 'studiovoice',
  'sdxl', 'stable-diffusion', 'flux', 'pixart', 'image-gen', 'diffusion', 'consistory', 'edify', 'maisi', 'vista-', 'inpaint', 'upscal', 'background', 'relight', 'video', 'cosmos-predict', 'cosmos-transfer', 'genmol', 'molmim', 'diffdock', 'esm', 'proteinmpnn', 'alphafold', 'openfold', 'rfdiffusion', 'evo2', 'evo-2', 'geneformer', 'boltz', 'msa-search', 'cuopt', 'earth2', 'fourcastnet', 'corrdiff', 'atmos', 'maxine', 'eyecontact', 'segment', 'sam2', 'grounding', 'detect', 'yolo', 'changenet', 'pose', 'bodytrack', 'ising', 'calibration', 'glimmer', 'usdcode', 'usdsearch', 'digital-human', 'audio2face', 'a2f', 'nemotron-4-340b-reward', 'llama-3.1-nemotron-70b-reward', 'nv-dinov2', 'dino', 'vit-', 'genai-perf',
];
export const NIM_NON_CHAT_TOKENS = Object.freeze(NON_CHAT_TOKENS.slice());
export function nimIsChatModel(id) {
  const l = String(id || '').toLowerCase();
  if (!l || l.length > 160) return false;
  return !NON_CHAT_TOKENS.some((t) => l.includes(t));
}
/** Why a model was hidden from the chat list (for /ai/models/check explanations). */
export function nimNonChatReason(id) {
  const l = String(id || '').toLowerCase();
  const t = NON_CHAT_TOKENS.find((x) => l.includes(x));
  if (!t) return '';
  if (/embed|retriev|clip|siglip|colpali|jina|arctic|bge-|e5-/.test(t)) return 'an embedding/retrieval model — it returns vectors, not chat replies';
  if (/rerank/.test(t)) return 'a reranker — it scores passages, it does not chat';
  if (/guard|safety|moderat|jailbreak|topic-control|content-safety|classif/.test(t)) return 'a safety classifier — it labels text, it does not chat';
  if (/reward/.test(t)) return 'a reward model — it scores answers, it does not write them';
  if (/asr|parakeet|canary|whisper|riva|speech|voice|tts|fastpitch|magpie|audio|music|sound|translate|nmt/.test(t)) return 'a speech/audio/translation model — not a chat endpoint';
  if (/ocr|paddle|deplot|kosmos|fuyu|florence|parse|omniparser|page-elements|graphic-elements|table-structure/.test(t)) return 'a document/vision parsing model that needs an image input';
  if (/neva|vila|llava|paligemma/.test(t)) return 'a first-generation vision model served on the /v1/vlm endpoint (image input required) — not chat/completions';
  if (/sdxl|diffusion|flux|pixart|image-gen|consistory|edify|maisi|vista|inpaint|upscal|background|relight|video|cosmos-predict|cosmos-transfer/.test(t)) return 'an image/video generation model — not a chat endpoint';
  if (/genmol|molmim|diffdock|esm|protein|alphafold|openfold|rfdiffusion|evo|geneformer|boltz|msa/.test(t)) return 'a biology/chemistry model — not a chat endpoint';
  if (/earth2|fourcastnet|corrdiff|atmos|cuopt/.test(t)) return 'a physics/optimisation model — not a chat endpoint';
  return 'not a chat-completions model';
}

/* ── response parsing ──────────────────────────────────────────────────── */

/**
 * Split a completion message into { content, reasoning }. Handles:
 *   message.content as string OR parts array; message.reasoning_content /
 *   message.reasoning; inline <think>…</think> (Qwen3/QwQ style), including an
 *   UNTERMINATED <think> (budget ran out mid-thought → content is empty).
 */
export function nimExtractContent(message) {
  if (!message || typeof message !== 'object') return { content: '', reasoning: '' };
  let c = message.content;
  if (Array.isArray(c)) c = c.map((p) => (p && (p.type === 'text' || p.type === 'output_text') ? String(p.text || '') : '')).join('');
  c = String(c == null ? '' : c);
  let reasoning = String(message.reasoning_content || message.reasoning || '');
  const m = c.match(/^\s*<think>([\s\S]*?)<\/think>\s*/i);
  if (m) { if (!reasoning) reasoning = m[1].trim(); c = c.slice(m[0].length); }
  else if (/^\s*<think>/i.test(c) && !/<\/think>/i.test(c)) { if (!reasoning) reasoning = c.replace(/^\s*<think>/i, '').trim(); c = ''; }
  // Some models emit a stray closing tag with no opener (thinking was in reasoning_content).
  c = c.replace(/^\s*<\/think>\s*/i, '');
  return { content: c, reasoning };
}

/** One SSE chunk → { delta, reasoning, finish, usage }. */
export function nimStreamDelta(chunk) {
  const ch = chunk && chunk.choices && chunk.choices[0];
  const d = (ch && ch.delta) || {};
  let delta = d.content;
  if (Array.isArray(delta)) delta = delta.map((p) => (p && p.type === 'text' ? String(p.text || '') : '')).join('');
  return {
    delta: typeof delta === 'string' ? delta : '',
    reasoning: String(d.reasoning_content || d.reasoning || ''),
    finish: (ch && ch.finish_reason) || null,
    usage: (chunk && chunk.usage) || null,
  };
}

/**
 * Stateful filter for streams that carry inline <think>…</think> in the
 * content deltas. feed(text) → { delta, reasoning }. Tags split across chunk
 * boundaries are handled by holding back a small tail while undecided.
 */
export function nimThinkFilter() {
  let state = 'start'; // start | think | text
  let buf = '';
  const OPEN = '<think>', CLOSE = '</think>';
  return {
    feed(text) {
      let delta = '', reasoning = '';
      buf += String(text || '');
      for (;;) {
        if (state === 'start') {
          const lead = buf.replace(/^\s+/, '');
          if (!lead) return { delta, reasoning };
          if (OPEN.startsWith(lead.slice(0, OPEN.length).toLowerCase()) && lead.length < OPEN.length) return { delta, reasoning }; // undecided
          if (lead.toLowerCase().startsWith(OPEN)) { state = 'think'; buf = lead.slice(OPEN.length); continue; }
          state = 'text'; delta += buf; buf = ''; return { delta, reasoning };
        }
        if (state === 'think') {
          const i = buf.toLowerCase().indexOf(CLOSE);
          if (i === -1) {
            const keep = CLOSE.length - 1; // a partial "</thin" may be arriving
            if (buf.length > keep) { reasoning += buf.slice(0, buf.length - keep); buf = buf.slice(buf.length - keep); }
            return { delta, reasoning };
          }
          reasoning += buf.slice(0, i); buf = buf.slice(i + CLOSE.length).replace(/^\s+/, ''); state = 'text'; continue;
        }
        delta += buf; buf = ''; return { delta, reasoning };
      }
    },
    flush() { const out = state === 'think' ? { delta: '', reasoning: buf } : { delta: buf, reasoning: '' }; buf = ''; return out; },
    get state() { return state; },
  };
}

/* ── error → adjustment ────────────────────────────────────────────────── */

/**
 * Read a provider 4xx and decide whether the REQUEST can be adapted so this
 * model accepts it. Returns null when the error is not about request shape.
 *   { kind:'clamp_max_tokens', value }   max_tokens above the model's limit
 *   { kind:'fold_system' }               model rejects the system role
 *   { kind:'merge_roles' }               model demands strict user/assistant alternation
 *   { kind:'drop_response_format' }      no JSON mode on this model
 *   { kind:'drop_sampling' }             temperature/top_p fixed on this model (o-series, some NIM)
 *   { kind:'max_completion_tokens' }     model wants max_completion_tokens instead of max_tokens
 *   { kind:'drop_stream_options' }       stream_options unsupported
 *   { kind:'not_chat' }                  the id is not a chat model at all
 */
export function nimAdaptError(status, body, rawText) {
  if (status !== 400 && status !== 422) return null;
  const pick = (o) => (o && typeof o === 'object') ? (o.error && typeof o.error === 'object' ? (o.error.message || o.error.detail || '') : (o.message || o.detail || o.error || '')) : '';
  let msg = String(pick(body) || rawText || '');
  if (typeof body?.detail === 'object') msg += ' ' + JSON.stringify(body.detail).slice(0, 400);
  const l = msg.toLowerCase();
  if (!l) return null;
  // FastAPI/pydantic validation errors (most NIM containers are FastAPI): the
  // offending field is named exactly in `loc`. Trust that over prose matching.
  const details = Array.isArray(body?.detail) ? body.detail : (Array.isArray(body?.error?.detail) ? body.error.detail : []);
  for (const d of details) {
    const loc = Array.isArray(d?.loc) ? d.loc.map(String) : [];
    const field = loc.filter((x) => x !== 'body' && !/^\d+$/.test(x)).pop() || '';
    const dm = String(d?.msg || '').toLowerCase();
    const lim = Number(d?.ctx?.limit_value ?? d?.ctx?.le ?? d?.ctx?.lt ?? NaN);
    if (/^(max_tokens|max_completion_tokens|max_new_tokens)$/.test(field)) {
      if (Number.isFinite(lim) && lim >= 16) return { kind: 'clamp_max_tokens', value: Math.min(lim, 200000), message: msg.slice(0, 300) };
      const n = (dm.match(/\d{2,7}/g) || []).map(Number).filter((x) => x >= 16);
      return { kind: 'clamp_max_tokens', value: n.length ? Math.min(Math.min(...n), 200000) : 1024, message: msg.slice(0, 300) };
    }
    if (/^(temperature|top_p|top_k|presence_penalty|frequency_penalty|repetition_penalty|seed)$/.test(field)) return { kind: 'drop_sampling', message: msg.slice(0, 300) };
    if (field === 'response_format' || /^(guided_json|guided_regex|guided_choice)$/.test(field)) return { kind: 'drop_response_format', message: msg.slice(0, 300) };
    if (field === 'stream_options' || field === 'include_usage') return { kind: 'drop_stream_options', message: msg.slice(0, 300) };
    if (field === 'role' && /system/.test(dm)) return { kind: 'fold_system', message: msg.slice(0, 300) };
    if (field === 'messages' && /(alternate|consecutive|roles?)/.test(dm)) return { kind: 'merge_roles', message: msg.slice(0, 300) };
  }
  if (/(is not a chat model|not a chat model|does not support chat|not supported for chat|use the embeddings|use \/v1\/embeddings|use the rerank|only supports the completions)/.test(l)) return { kind: 'not_chat', message: msg.slice(0, 300) };
  if (/max_completion_tokens/.test(l) && /(max_tokens.*(not supported|unsupported|instead)|use 'max_completion_tokens'|use "max_completion_tokens")/.test(l)) return { kind: 'max_completion_tokens', message: msg.slice(0, 300) };
  if (/(max_tokens|max_completion_tokens|max_new_tokens|maximum context length|context length|context window|tokens? (must|should|can ?not|cannot)|too many tokens|exceeds the (model'?s )?(maximum|context)|input is too long|prompt is too long)/.test(l)) {
    const nums = (msg.match(/\d{2,7}/g) || []).map(Number).filter((n) => n >= 16 && n <= 2000000);
    let value = 0;
    const le = msg.match(/(?:less than or equal to|at most|<=|maximum(?: of)?|max(?:imum)?(?: value)?(?: is| of)?|limit(?: is| of)?|up to)\s*:?\s*(\d{2,7})/i);
    if (le) value = Number(le[1]);
    const ctx = msg.match(/maximum context length is (\d+) tokens.*?(\d+) in the messages/i) || msg.match(/context length[^\d]*(\d+)[^\d]+(\d+)[^\d]*(?:in the messages|prompt|input)/i);
    if (ctx) value = Math.max(64, Number(ctx[1]) - Number(ctx[2]) - 64);
    if (!value && nums.length) value = Math.min(...nums);
    if (value >= 16) return { kind: 'clamp_max_tokens', value: Math.min(value, 200000), message: msg.slice(0, 300) };
    return { kind: 'clamp_max_tokens', value: 1024, message: msg.slice(0, 300) };
  }
  if (/system/.test(l) && /(not supported|unsupported|does not support|only user and assistant|role must be|invalid role|no system|cannot be system|developer instruction)/.test(l)) return { kind: 'fold_system', message: msg.slice(0, 300) };
  if (/(must alternate|should alternate|alternat(e|ing) (user|roles)|conversation roles|roles must|consecutive (user|assistant)|last message must be from user|first message must be from user|after a user message)/.test(l)) return { kind: 'merge_roles', message: msg.slice(0, 300) };
  if (/(response_format|json_object|json_schema|json mode|structured output|guided_json|guided decoding|grammar)/.test(l)) return { kind: 'drop_response_format', message: msg.slice(0, 300) };
  if (/(temperature|top_p|top_k|presence_penalty|frequency_penalty|sampling)/.test(l) && /(not supported|unsupported|only the default|must be|does not support|invalid|out of range|between)/.test(l)) return { kind: 'drop_sampling', message: msg.slice(0, 300) };
  if (/(stream_options|include_usage)/.test(l)) return { kind: 'drop_stream_options', message: msg.slice(0, 300) };
  if (/(extra_forbidden|unexpected keyword|unknown field|unrecognized request argument|additional properties)/.test(l)) {
    if (/(response_format)/.test(l)) return { kind: 'drop_response_format', message: msg.slice(0, 300) };
    if (/(stream_options)/.test(l)) return { kind: 'drop_stream_options', message: msg.slice(0, 300) };
    if (/(temperature|top_p)/.test(l)) return { kind: 'drop_sampling', message: msg.slice(0, 300) };
  }
  return null;
}

/* ── request shaping ───────────────────────────────────────────────────── */

/** Merge consecutive same-role turns and make the conversation start with a user turn. */
export function nimMergeRoles(messages) {
  const out = [];
  for (const m of messages || []) {
    if (!m) continue;
    const role = m.role === 'system' ? 'system' : (m.role === 'assistant' ? 'assistant' : 'user');
    const content = m.content;
    const prev = out[out.length - 1];
    if (prev && prev.role === role && role !== 'system' && typeof prev.content === 'string' && typeof content === 'string') { prev.content = prev.content + '\n\n' + content; continue; }
    out.push({ role, content });
  }
  const firstNonSys = out.findIndex((m) => m.role !== 'system');
  if (firstNonSys !== -1 && out[firstNonSys].role === 'assistant') out.splice(firstNonSys, 0, { role: 'user', content: 'Context follows.' });
  return out;
}

/** Fold system messages into the first user turn (for models that reject role=system). */
export function nimFoldSystem(messages) {
  const sys = [];
  const rest = [];
  for (const m of messages || []) { if (m && m.role === 'system') sys.push(String(m.content == null ? '' : m.content)); else if (m) rest.push({ role: m.role, content: m.content }); }
  if (!sys.length) return rest;
  const prefix = 'Instructions (follow them for the whole conversation):\n' + sys.join('\n\n') + '\n\n---\n';
  const i = rest.findIndex((m) => m.role === 'user');
  if (i === -1) return [{ role: 'user', content: prefix + 'Hello' }, ...rest];
  const u = rest[i];
  if (Array.isArray(u.content)) rest[i] = { role: 'user', content: [{ type: 'text', text: prefix }, ...u.content] };
  else rest[i] = { role: 'user', content: prefix + String(u.content == null ? '' : u.content) };
  return rest;
}

/**
 * Build the request body for one attempt.
 *   opts: { temperature, max_tokens, json_mode, stream, profile }
 *   adjustments: Map(kind → value|true) learned for this model
 */
export function nimBuildBody(model, messages, opts, adjustments) {
  const adj = adjustments || new Map();
  const profile = (opts && opts.profile) || nimModelProfile(model);
  let msgs = Array.isArray(messages) ? messages.map((m) => ({ role: m.role, content: m.content })) : [];
  if (adj.has('fold_system')) msgs = nimFoldSystem(msgs);
  if (adj.has('merge_roles')) msgs = nimMergeRoles(msgs);
  let maxTokens = Math.max(1, Math.floor(Number(opts && opts.max_tokens) || 1024));
  // Reasoning models need a thinking budget: never send them a 5-token cap.
  if (!(opts && opts.exact_tokens)) maxTokens = Math.max(maxTokens, profile.minBudget || 1);
  if (adj.has('clamp_max_tokens')) maxTokens = Math.min(maxTokens, Math.max(16, Number(adj.get('clamp_max_tokens')) || maxTokens));
  const body = { model, messages: msgs };
  if (!adj.has('drop_sampling')) {
    const t = Number(opts && opts.temperature);
    body.temperature = Number.isFinite(t) ? Math.max(0, Math.min(2, t)) : 0.7;
  }
  if (adj.has('max_completion_tokens')) body.max_completion_tokens = maxTokens; else body.max_tokens = maxTokens;
  if (opts && opts.json_mode && !adj.has('drop_response_format')) body.response_format = { type: 'json_object' };
  else if (opts && opts.json_mode && adj.has('drop_response_format')) {
    // No native JSON mode → make the instruction explicit in the last user turn.
    const i = msgs.map((m) => m.role).lastIndexOf('user');
    if (i !== -1 && typeof msgs[i].content === 'string' && !/only (a )?(single )?json/i.test(msgs[i].content)) msgs[i] = { role: 'user', content: msgs[i].content + '\n\nRespond with a single valid JSON object only — no prose, no code fences.' };
  }
  if (opts && opts.stream) {
    body.stream = true;
    if (!adj.has('drop_stream_options')) body.stream_options = { include_usage: true };
  }
  return body;
}

/** Budget to retry with when a reasoning model spent everything on thinking. */
export function nimBumpBudget(current, cap) {
  const c = Math.max(1, Number(current) || 1);
  return Math.min(cap || 8192, Math.max(4096, c * 4));
}

/* ── catalog helpers ───────────────────────────────────────────────────── */

/** Chat-capable ids from a /v1/models payload, curated ranking first, then alphabetical. */
export function nimChatModelsFromCatalog(payload, curated, limit) {
  const ids = ((payload && payload.data) || []).map((m) => String((m && m.id) || '')).filter((id) => id && id.length < 160 && nimIsChatModel(id));
  const uniq = [...new Set(ids)];
  const rank = new Map((curated || []).map((m, i) => [m, i]));
  uniq.sort((a, b) => { const ra = rank.has(a) ? rank.get(a) : 1e6, rb = rank.has(b) ? rank.get(b) : 1e6; return ra !== rb ? ra - rb : a.localeCompare(b); });
  return uniq.slice(0, limit || 200);
}

/** Per-id capability hints for the UI (reasoning/vision/code badges). */
export function nimCatalogMeta(ids) {
  const out = {};
  for (const id of ids || []) { const p = nimModelProfile(id); out[id] = { reasoning: p.reasoning, vision: p.vision, code: p.code }; }
  return out;
}

/** "Did you mean …" — closest catalog ids for a mistyped model or a loose description ("nemotron 70b"). */
export function nimSuggestModels(input, catalog, n) {
  let q = String(input == null ? '' : input).toLowerCase().trim();
  q = q.replace(/^https?:\/\/build\.nvidia\.com\//, '').replace(/^(?:models|model|nim|v1)\//, '').replace(/^[`'"\s]+|[`'"\s.,;]+$/g, '');
  if (!q) return [];
  const qBase = q.includes('/') ? q.split('/').slice(1).join('/') : q;
  const tokens = qBase.split(/[^a-z0-9.]+/).filter((t) => t.length >= 2);
  const score = (id) => {
    const l = id.toLowerCase();
    const base = l.includes('/') ? l.split('/')[1] : l;
    let s = 0;
    if (l === q) s += 1000;
    if (base === qBase) s += 500;
    if (l.startsWith(q) || base.startsWith(qBase)) s += 200;
    if (l.includes(qBase)) s += 100;
    let hit = 0;
    for (const t of tokens) if (base.includes(t)) { s += 10 + t.length; hit++; }
    if (tokens.length > 1 && hit === tokens.length) s += 60; // every word matched
    if (q.includes('/') && l.startsWith(q.split('/')[0] + '/')) s += 25;
    return s;
  };
  return (catalog || []).map((id) => [id, score(id)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).slice(0, n || 5).map((x) => x[0]);
}

/** Human explanation of the adjustments learned for a model (for /ai/models/check + logs). */
export function nimDescribeAdjustments(adjustments) {
  const out = [];
  for (const [k, v] of (adjustments instanceof Map ? adjustments : new Map(Object.entries(adjustments || {})))) {
    if (k === 'clamp_max_tokens') out.push(`max_tokens capped at ${v} (model limit)`);
    else if (k === 'fold_system') out.push('system prompt folded into the first user turn (model rejects role=system)');
    else if (k === 'merge_roles') out.push('consecutive same-role turns merged (model requires strict alternation)');
    else if (k === 'drop_response_format') out.push('no native JSON mode — JSON requested in plain instructions');
    else if (k === 'drop_sampling') out.push('temperature/top_p left at the model default (fixed by the model)');
    else if (k === 'max_completion_tokens') out.push('uses max_completion_tokens instead of max_tokens');
    else if (k === 'drop_stream_options') out.push('stream usage accounting unsupported on this model');
    else if (k === 'reasoning_budget') out.push(`reasoning model — output budget raised to ${v} so the answer survives the thinking phase`);
  }
  return out;
}

/* ── model output → JSON ───────────────────────────────────────────────── */

/**
 * Extract the first complete JSON object/array from model text. Handles
 * ```json fences, prose before/after, and trailing commentary — by scanning
 * for the FIRST balanced top-level object/array (string-aware), instead of
 * the greedy `/\{[\s\S]*\}/` that breaks as soon as a model appends "}"-bearing
 * prose. Returns null when nothing parses (callers keep their honest
 * fallbacks — never invent a verdict from '{}').
 *   want: 'object' (default) | 'array' | 'any'
 */
export function nimExtractJson(text, want) {
  let t = String(text == null ? '' : text);
  if (!t.trim()) return null;
  t = t.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '');
  const fence = t.match(/```(?:json|JSON|javascript|js)?\s*([\s\S]*?)```/);
  const candidates = fence ? [fence[1], t] : [t];
  const wantObj = want !== 'array', wantArr = want === 'array' || want === 'any';
  for (const c of candidates) {
    const direct = tryParse(c.trim());
    if (direct !== undefined && matches(direct)) return direct;
    for (let i = 0; i < c.length; i++) {
      const ch = c[i];
      if (!((ch === '{' && wantObj) || (ch === '[' && wantArr))) continue;
      const end = balancedEnd(c, i);
      if (end === -1) continue;
      const v = tryParse(c.slice(i, end + 1));
      if (v !== undefined && matches(v)) return v;
      // lenient: trailing commas / single quotes are the two most common slips
      const v2 = tryParse(c.slice(i, end + 1).replace(/,\s*([}\]])/g, '$1'));
      if (v2 !== undefined && matches(v2)) return v2;
    }
  }
  return null;
  function matches(v) { return v && typeof v === 'object' && (Array.isArray(v) ? wantArr : wantObj); }
  function tryParse(str) { try { return JSON.parse(str); } catch (e) { return undefined; } }
  function balancedEnd(str, start) {
    const open = str[start], close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < str.length; i++) {
      const ch = str[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return (ch === close) ? i : -1; }
    }
    return -1;
  }
}
