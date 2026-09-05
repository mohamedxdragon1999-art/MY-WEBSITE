// NVIDIA NIM — "ANY model in the catalog actually works" suite.
//
// The provider layer must make every chat model NVIDIA lists usable, not just
// the curated defaults. That means: pasted ids/links are normalised; the live
// catalog is honest (vision-chat in, embeddings/rerankers/VLM-only out);
// reasoning models (DeepSeek-R1, Qwen3, Nemotron-3, gpt-oss) get a thinking
// budget and their <think>/reasoning_content is split from the answer, both
// in JSON and SSE; a model that rejects the request shape (system role, JSON
// mode, max_tokens ceiling, alternation, max_completion_tokens) teaches the
// worker an adjustment that is applied and REMEMBERED; the health probe never
// false-fails a reasoning model; and POST /ai/models/check gives a precise,
// actionable verdict for any id — including "did you mean".
//
// Every provider response here is a faithful copy of a real NIM shape.
// Run: node tests/test_nim_models.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const { init, DB } = require('./d1mock.js');
await init(readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8'));

const mod = await import(pathToFileURL(join(ROOT, 'backend', 'src', 'index.js')).href);
const worker = mod.default;
const PT = mod.__providerTest;
const NIM = await import(pathToFileURL(join(ROOT, 'backend', 'src', 'providers', 'nim.js')).href);
const env = { DB, ENCRYPTION_KEY: 'nim-suite-encryption-key-32chars!', API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
const BASE = 'http://test.local';

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 220) : '')); }
}

// ── fake NIM on the network edge ─────────────────────────────────────────
let captured = [];
let behavior = null; // (info) => Response
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const info = { url: u, method: opts.method || 'GET', auth: String(opts.headers?.Authorization || '').replace('Bearer ', ''), body: opts.body ? JSON.parse(opts.body) : null, accept: opts.headers?.Accept || '' };
  captured.push(info);
  if (behavior) return behavior(info, opts);
  return okJson('ok');
};
const okJson = (content, extra = {}) => new Response(JSON.stringify({ id: 'chatcmpl-x', object: 'chat.completion', model: 'm', choices: [{ index: 0, message: { role: 'assistant', content, ...extra }, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const err = (status, payload, headers = {}) => new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const sse = (lines) => { const enc = new TextEncoder(); return new Response(new ReadableStream({ start(c) { for (const l of lines) c.enqueue(enc.encode(typeof l === 'string' ? l : 'data: ' + JSON.stringify(l) + '\n\n')); c.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }); };
const chunk = (delta, extra = {}) => ({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { ...(delta === null ? {} : { content: delta }), ...extra }, finish_reason: null }] });
const finishChunk = (usage) => ({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], ...(usage ? { usage } : {}) });

async function call(method, path, body, token) {
  const r = await worker.fetch(new Request(BASE + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  let data = null; try { data = await r.json(); } catch { }
  return { status: r.status, data, res: r };
}
async function readSse(res) {
  const events = []; const dec = new TextDecoder(); const rd = res.body.getReader(); let buf = '';
  for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) if (l.startsWith('data: ')) { try { events.push(JSON.parse(l.slice(6))); } catch { } } }
  return events;
}

const reg = await call('POST', '/auth/register', { name: 'NIM', email: 'nim' + Date.now() + '@t.io', password: 'password123' });
const TOK = reg.data?.token;
const setModel = async (model) => call('PATCH', '/ai/settings', { provider: 'nvidia', model, nvidia_key: 'nvapi-suite-key-0000000000' }, TOK);
await setModel('nvidia/llama-3.1-nemotron-70b-instruct');
const reset = () => { PT.resetHealth(); PT.resetBurst(); PT.resetModelAdjustments(); captured = []; behavior = null; };

console.log('\n== 1. Model-id hygiene: whatever the operator pastes becomes a NIM id ==');
{
  const N = NIM.nimNormalizeModelId;
  check('build.nvidia.com link → org/model', N('https://build.nvidia.com/deepseek-ai/deepseek-r1') === 'deepseek-ai/deepseek-r1');
  check('build.nvidia.com slug with 3_1 → 3.1 (+ /modelcard stripped)', N('https://build.nvidia.com/nvidia/llama-3_1-nemotron-70b-instruct/modelcard') === 'nvidia/llama-3.1-nemotron-70b-instruct', N('https://build.nvidia.com/nvidia/llama-3_1-nemotron-70b-instruct/modelcard'));
  check('backticks / quotes / whitespace stripped', N(' `meta/llama-3.3-70b-instruct` ') === 'meta/llama-3.3-70b-instruct' && N('"qwen/qwen3-235b-a22b".') === 'qwen/qwen3-235b-a22b');
  check('models/ prefix stripped', N('models/qwen/qwen3-235b-a22b') === 'qwen/qwen3-235b-a22b');
  check('control characters removed, length capped', N('a/b\u0000\u0001' + 'x'.repeat(400)).length <= 200 && !/[\u0000-\u001f]/.test(N('a/b\u0000')));
  check('chain keeps order, dedupes, drops blanks', JSON.stringify(NIM.nimModelChain(' deepseek-ai/deepseek-r1,\n nvidia/nemotron-3-nano-30b-a3b , deepseek-ai/deepseek-r1,,')) === JSON.stringify(['deepseek-ai/deepseek-r1', 'nvidia/nemotron-3-nano-30b-a3b']));
  // through the real settings route
  await call('PATCH', '/ai/settings', { model: ' https://build.nvidia.com/moonshotai/kimi-k2-instruct ' }, TOK);
  const g = await call('GET', '/ai/settings', undefined, TOK);
  check('PATCH /ai/settings normalises a pasted model link', g.data.model === 'moonshotai/kimi-k2-instruct', g.data.model);
  await setModel('nvidia/llama-3.1-nemotron-70b-instruct');
  check('endpoint math: pasted full chat URL → base', NIM.nimChatUrl('https://nim.corp.example/v1/chat/completions/') === 'https://nim.corp.example/v1/chat/completions' && NIM.nimModelsUrl('https://nim.corp.example/v1/models') === 'https://nim.corp.example/v1/models');
  check('endpoint math: empty base → public NIM', NIM.nimChatUrl('') === 'https://integrate.api.nvidia.com/v1/chat/completions');
}

console.log('\n== 2. Live catalog is honest: vision-chat IN, embeddings/rerank/VLM-only OUT, meta badges ==');
{
  reset();
  const catalog = ['nvidia/llama-3.1-nemotron-70b-instruct', 'meta/llama-3.2-90b-vision-instruct', 'google/gemma-3-27b-it', 'qwen/qwen2.5-vl-72b-instruct', 'nvidia/nemotron-nano-12b-v2-vl', 'deepseek-ai/deepseek-r1', 'qwen/qwen3-235b-a22b', 'openai/gpt-oss-120b', 'mistralai/devstral-2-123b-instruct-2512',
    'nvidia/nv-embedqa-e5-v5', 'nvidia/llama-3.2-nv-rerankqa-1b-v2', 'nvidia/neva-22b', 'nvidia/vila', 'adept/fuyu-8b', 'microsoft/kosmos-2', 'nvidia/parakeet-ctc-1.1b-asr', 'nvidia/magpie-tts-multilingual', 'black-forest-labs/flux.1-dev', 'nvidia/nemotron-4-340b-reward', 'nvidia/llama-3.1-nemoguard-8b-content-safety', 'meta/esm2-650m', 'nvidia/cosmos-predict2-14b', 'stabilityai/stable-diffusion-3-medium', 'nvidia/riva-translate-4b-instruct', 'nvidia/nemoretriever-parse', 'microsoft/phi-3.5-vision-instruct'];
  behavior = (i) => i.url.endsWith('/models') ? err(200, { object: 'list', data: catalog.map((id) => ({ id, object: 'model', owned_by: id.split('/')[0] })) }) : okJson('ok');
  const r = await call('GET', '/ai/models?refresh=1', undefined, TOK);
  const list = r.data.nvidia;
  check('catalog is live', r.data.nvidia_live === true && r.data.nvidia_reason === 'live');
  for (const keep of ['meta/llama-3.2-90b-vision-instruct', 'google/gemma-3-27b-it', 'qwen/qwen2.5-vl-72b-instruct', 'nvidia/nemotron-nano-12b-v2-vl', 'microsoft/phi-3.5-vision-instruct', 'deepseek-ai/deepseek-r1', 'openai/gpt-oss-120b'])
    check('kept (chat-capable): ' + keep, list.includes(keep));
  for (const drop of ['nvidia/nv-embedqa-e5-v5', 'nvidia/llama-3.2-nv-rerankqa-1b-v2', 'nvidia/neva-22b', 'nvidia/vila', 'adept/fuyu-8b', 'microsoft/kosmos-2', 'nvidia/parakeet-ctc-1.1b-asr', 'nvidia/magpie-tts-multilingual', 'black-forest-labs/flux.1-dev', 'nvidia/nemotron-4-340b-reward', 'nvidia/llama-3.1-nemoguard-8b-content-safety', 'meta/esm2-650m', 'nvidia/cosmos-predict2-14b', 'stabilityai/stable-diffusion-3-medium', 'nvidia/riva-translate-4b-instruct', 'nvidia/nemoretriever-parse'])
    check('hidden (not chat): ' + drop, !list.includes(drop));
  check('curated default ranks first', list[0] === 'nvidia/llama-3.1-nemotron-70b-instruct');
  check('meta badges: deepseek-r1 reasoning, llama-3.2-vision vision, devstral code', r.data.nvidia_meta['deepseek-ai/deepseek-r1']?.reasoning === true && r.data.nvidia_meta['meta/llama-3.2-90b-vision-instruct']?.vision === true && r.data.nvidia_meta['mistralai/devstral-2-123b-instruct-2512']?.code === true, JSON.stringify(r.data.nvidia_meta['deepseek-ai/deepseek-r1']));
  check('catalog endpoint reported (public NIM)', /integrate\.api\.nvidia\.com\/v1\/models$/.test(r.data.nvidia_endpoint));
  check('current chain returned normalised', Array.isArray(r.data.current) && r.data.current[0] === 'nvidia/llama-3.1-nemotron-70b-instruct');
  // self-hosted NIM: the catalog comes from THAT endpoint and 1 model is a real answer
  await call('PATCH', '/ai/settings', { nvidia_base_url: 'https://nim.corp.example/v1' }, TOK);
  captured = [];
  behavior = (i) => i.url.endsWith('/models') ? err(200, { data: [{ id: 'meta/llama-3.1-8b-instruct' }] }) : okJson('ok');
  const r2 = await call('GET', '/ai/models?refresh=1', undefined, TOK);
  const catCall = captured.find((c) => c.url.endsWith('/models'));
  check('self-hosted NIM: catalog fetched from the custom base URL', catCall && catCall.url === 'https://nim.corp.example/v1/models', catCall && catCall.url);
  check('self-hosted NIM: a 1-model catalog is accepted as live (not "too few")', r2.data.nvidia_live === true && r2.data.nvidia.length === 1, JSON.stringify(r2.data.nvidia));
  await call('PATCH', '/ai/settings', { nvidia_base_url: '' }, TOK);
}

console.log('\n== 3. Reasoning models: thinking split from the answer (JSON) + budget rescue ==');
{
  reset();
  await setModel('deepseek-ai/deepseek-r1');
  behavior = () => okJson('The answer is 4.', { reasoning_content: 'User asks 2+2. Compute: 4.' });
  const r = await call('POST', '/ai/complete', { prompt: 'What is 2+2?', include_context: false }, TOK);
  check('reasoning_content never leaks into the answer', r.status === 200 && r.data.content === 'The answer is 4.', JSON.stringify(r.data).slice(0, 120));
  const sent = captured.find((c) => c.body && c.body.model === 'deepseek-ai/deepseek-r1');
  check('reasoning model gets a thinking budget (max_tokens ≥ 1024 even when the caller asked for less)', sent && sent.body.max_tokens >= 1024, sent && sent.body.max_tokens);
  // inline <think> (Qwen3 / QwQ style), terminated
  captured = [];
  await setModel('qwen/qwen3-235b-a22b');
  behavior = () => okJson('<think>\nLet me reason about this.\n</think>\n\nParis.');
  const r2 = await call('POST', '/ai/complete', { prompt: 'Capital of France?', include_context: false }, TOK);
  check('inline <think>…</think> stripped, answer kept', r2.data.content === 'Paris.', JSON.stringify(r2.data.content));
  // budget exhausted while thinking → automatic retry with a bigger budget → answer
  captured = [];
  let n = 0;
  behavior = () => { n++; return n === 1 ? new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '', reasoning_content: 'thinking thinking thinking' }, finish_reason: 'length' }], usage: { prompt_tokens: 5, completion_tokens: 1024 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }) : okJson('Done: 42', { reasoning_content: 'ok' }); };
  const r3 = await call('POST', '/ai/complete', { prompt: 'Think hard', include_context: false, max_tokens: 1024 }, TOK);
  const budgets = captured.filter((c) => c.body).map((c) => c.body.max_tokens);
  check('budget exhausted mid-thought → retried once with a larger budget → real answer', r3.status === 200 && r3.data.content === 'Done: 42' && budgets.length === 2 && budgets[1] > budgets[0], JSON.stringify(budgets) + ' ' + JSON.stringify(r3.data).slice(0, 80));
  check('the raised budget is remembered for the model', /reasoning_budget/.test(JSON.stringify(PT.modelAdjustments('nvidia', 'https://integrate.api.nvidia.com/v1/chat/completions', 'qwen/qwen3-235b-a22b'))));
  const snap = PT.healthSnapshot().nvidia;
  check('a thinking-only first pass is NOT counted as provider sickness', snap.status !== 'cooldown' && snap.fails === 0, JSON.stringify(snap));
  // unterminated <think> with finish=length, no reasoning_content → same rescue path
  captured = []; n = 0; PT.resetModelAdjustments();
  behavior = () => { n++; return n === 1 ? new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '<think>still going' }, finish_reason: 'length' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }) : okJson('<think>brief</think>Final.'); };
  const r4 = await call('POST', '/ai/complete', { prompt: 'x', include_context: false }, TOK);
  check('unterminated <think> (budget ran out) rescued the same way', r4.status === 200 && r4.data.content === 'Final.', JSON.stringify(r4.data).slice(0, 80));
  await setModel('nvidia/llama-3.1-nemotron-70b-instruct');
}

console.log('\n== 4. Streaming: reasoning deltas become `thinking` events; only the answer is the answer ==');
{
  reset();
  await setModel('deepseek-ai/deepseek-r1');
  behavior = () => sse([chunk(null, { role: 'assistant' }), chunk(null, { reasoning_content: 'Let me think… ' }), chunk(null, { reasoning_content: 'ok.' }), chunk('Hello'), chunk(' there'), finishChunk({ prompt_tokens: 7, completion_tokens: 9 }), 'data: [DONE]\n\n']);
  const s1 = await worker.fetch(new Request(BASE + '/api/ai/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOK }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) }), env, ctx);
  const ev = await readSse(s1);
  const text = ev.filter((e) => e.delta).map((e) => e.delta).join('');
  const thinking = ev.filter((e) => e.thinking).map((e) => e.thinking).join('');
  check('stream: answer deltas = "Hello there"', text === 'Hello there', JSON.stringify(text));
  check('stream: reasoning arrives as thinking events, never as delta', thinking === 'Let me think… ok.' && !/think/.test(text), JSON.stringify(thinking));
  check('stream: meta announces a reasoning model', ev[0] && ev[0].meta && ev[0].meta.reasoning === true && ev[0].meta.model === 'deepseek-ai/deepseek-r1', JSON.stringify(ev[0]));
  check('stream: usage forwarded from stream_options', ev.some((e) => e.usage && e.usage.tokens_out === 9));
  check('stream: request asked for usage accounting (stream_options.include_usage)', captured.some((c) => c.body && c.body.stream === true && c.body.stream_options && c.body.stream_options.include_usage === true));
  // Latency pin: NIM's first chunk is role-only and a reasoning model's next
  // frames are thinking. A pull-based stream that forwards nothing for such
  // a frame is not pulled again until the 15 s keep-alive → the answer used
  // to arrive 15 s late. The pump now consumes empty frames in a loop.
  {
    behavior = () => sse([chunk(null, { role: 'assistant' }), chunk(null, { reasoning_content: 'x'.repeat(30000) }), chunk(null, { reasoning_content: 'more' }), { choices: [{ index: 0, delta: {}, finish_reason: null }] }, chunk('Fast'), finishChunk(), 'data: [DONE]\n\n']);
    const t0 = Date.now();
    const s3 = await worker.fetch(new Request(BASE + '/api/ai/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOK }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], memory: false }) }), env, ctx);
    const ev3 = await readSse(s3);
    const ms = Date.now() - t0;
    check('stream: empty/role-only/over-cap frames never stall the pump (answer + done in < 2 s, not 15 s)', ms < 2000 && ev3.some((e) => e.delta === 'Fast') && ev3[ev3.length - 1].done === true, ms + 'ms ' + JSON.stringify(ev3.map((e) => Object.keys(e)[0])));
    const thinkBytes = ev3.filter((e) => e.thinking).reduce((a, e) => a + e.thinking.length, 0);
    check('stream: thinking relay capped (~20 KB) so a 30 KB think block cannot flood the client', thinkBytes <= 20000 && thinkBytes > 0, thinkBytes);
  }
  // inline <think> split across chunk boundaries
  behavior = () => sse([chunk('<thi'), chunk('nk>secret plan</th'), chunk('ink>Answer'), chunk(' here'), finishChunk(), 'data: [DONE]\n\n']);
  const s2 = await worker.fetch(new Request(BASE + '/api/ai/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOK }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) }), env, ctx);
  const ev2 = await readSse(s2);
  const text2 = ev2.filter((e) => e.delta).map((e) => e.delta).join('');
  const think2 = ev2.filter((e) => e.thinking).map((e) => e.thinking).join('');
  check('stream: <think> tags split across chunks are still separated', text2 === 'Answer here' && think2 === 'secret plan', JSON.stringify({ text2, think2 }));
  // the answer that reaches chat memory is the clean one
  const mem = await call('GET', '/ai/memory', undefined, TOK);
  const lastA = (mem.data.memory || []).filter((m) => m.role === 'assistant').pop();
  check('chat memory stores only the answer (no thinking)', lastA && lastA.content === 'Answer here', JSON.stringify(lastA));
  await setModel('nvidia/llama-3.1-nemotron-70b-instruct');
}

console.log('\n== 5. Request-shape adaptation: real NIM 400 bodies teach a remembered adjustment ==');
{
  const cases = [
    { label: 'max_tokens ceiling (vLLM style)', model: 'meta/llama-3.1-8b-instruct', body: { object: 'error', message: "This model's maximum context length is 4096 tokens. However, you requested 8100 tokens (900 in the messages, 7200 in the completion). Please reduce the length of the messages or completion.", type: 'BadRequestError', code: 400 }, expect: (b) => b.max_tokens <= 4096, adj: 'clamp_max_tokens', big: true },
    { label: 'max_tokens ≤ N (NIM validation)', model: 'google/gemma-2-2b-it', body: { type: 'urn:inference-service:problem-details:bad-request', title: 'Bad Request', status: 400, detail: '[{"type":"less_than_equal","loc":["body","max_tokens"],"msg":"Input should be less than or equal to 1024","input":8192,"ctx":{"le":1024}}]' }, expect: (b) => b.max_tokens <= 1024, adj: 'clamp_max_tokens', big: true },
    { label: 'system role unsupported (gemma)', model: 'google/gemma-3-27b-it', body: { object: 'error', message: 'System role not supported', type: 'BadRequestError' }, expect: (b) => !b.messages.some((m) => m.role === 'system') && /Instructions/.test(b.messages[0].content), adj: 'fold_system' },
    { label: 'roles must alternate (mistral)', model: 'mistralai/mistral-large-2-instruct', body: { object: 'error', message: 'Conversation roles must alternate user/assistant/user/assistant/...', type: 'BadRequestError' }, expect: (b) => b.messages.every((m, i, a) => i === 0 || m.role === 'system' || a[i - 1].role === 'system' || m.role !== a[i - 1].role), adj: 'merge_roles', stream: true },
    { label: 'response_format unsupported', model: 'nvidia/nemotron-4-340b-instruct', body: { detail: [{ loc: ['body', 'response_format'], msg: 'extra fields not permitted', type: 'value_error.extra' }] }, expect: (b) => !b.response_format && /JSON object only/.test(b.messages[b.messages.length - 1].content), adj: 'drop_response_format', json: true },
    { label: 'use max_completion_tokens (o-series style)', model: 'openai/gpt-oss-120b', body: { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", type: 'invalid_request_error', param: 'max_tokens', code: 'unsupported_parameter' } }, expect: (b) => !('max_tokens' in b) && b.max_completion_tokens > 0, adj: 'max_completion_tokens' },
    { label: 'temperature fixed by the model', model: 'openai/o3-mini', body: { error: { message: "Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported.", type: 'invalid_request_error', param: 'temperature' } }, expect: (b) => !('temperature' in b), adj: 'drop_sampling' },
  ];
  // Each case exercises the shape it is about: a big budget for the ceiling
  // cases, the (always present) system prompt for fold_system, a two-user
  // conversation through the streaming route for merge_roles, json_mode for
  // response_format. Streaming and JSON paths share one adaptation brain.
  const drive = async (c) => {
    if (c.stream) {
      const res = await worker.fetch(new Request(BASE + '/api/ai/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOK }, body: JSON.stringify({ messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }], memory: false }) }), env, ctx);
      if (res.status !== 200) { let d = null; try { d = await res.json(); } catch { } return { status: res.status, data: d }; }
      const ev = await readSse(res);
      return { status: 200, data: { content: ev.filter((e) => e.delta).map((e) => e.delta).join('') } };
    }
    return call('POST', '/ai/complete', { prompt: 'hello', max_tokens: c.big ? 8192 : undefined, json_mode: !!c.json }, TOK);
  };
  for (const c of cases) {
    reset();
    await setModel(c.model);
    let calls = 0;
    behavior = (i) => { calls++; const b = i.body; return c.expect(b) ? (c.stream ? sse([chunk('adapted ok'), finishChunk(), 'data: [DONE]\n\n']) : okJson('adapted ok')) : err(400, c.body); };
    const r = await drive(c);
    const ok = r.status === 200 && /adapted ok/.test(JSON.stringify(r.data));
    check(`${c.label}: 400 → adapted → success`, ok, r.status + ' ' + JSON.stringify(r.data).slice(0, 100));
    check(`${c.label}: adapted within the SAME request (exactly 2 provider calls)`, calls === 2, 'calls=' + calls);
    const learned = PT.modelAdjustments('nvidia', 'https://integrate.api.nvidia.com/v1/chat/completions', c.model);
    check(`${c.label}: adjustment remembered (${c.adj})`, c.adj in learned, JSON.stringify(learned));
    const before = calls;
    await drive(c);
    check(`${c.label}: next call applies it FIRST TIME (no second 400)`, calls - before === 1, 'extra calls=' + (calls - before));
    check(`${c.label}: request errors never trip the breaker`, PT.healthSnapshot().nvidia.status !== 'cooldown');
  }
  await setModel('nvidia/llama-3.1-nemotron-70b-instruct');
  // a 400 that is NOT about shape (bad input) is reported honestly, once
  reset();
  let calls = 0;
  behavior = () => { calls++; return err(400, { object: 'error', message: 'Invalid image URL in message content', type: 'BadRequestError' }); };
  const r = await call('POST', '/ai/complete', { prompt: 'x', include_context: false }, TOK);
  check('non-shape 400 → honest error, no infinite adaptation loop', r.status >= 400 && calls <= 2, 'calls=' + calls + ' ' + JSON.stringify(r.data).slice(0, 80));
  // "not a chat model" → model_not_found (pick another), never provider sickness
  reset();
  behavior = () => err(400, { object: 'error', message: 'nvidia/nv-embedqa-e5-v5 is not a chat model. Use the embeddings endpoint.', type: 'BadRequestError' });
  await setModel('nvidia/nv-embedqa-e5-v5');
  const r2 = await call('POST', '/ai/complete', { prompt: 'x', include_context: false }, TOK);
  check('"not a chat model" 400 → actionable model error', r2.status >= 400 && /not a chat model/i.test(JSON.stringify(r2.data)) && PT.healthSnapshot().nvidia.status !== 'cooldown', JSON.stringify(r2.data).slice(0, 100));
  await setModel('nvidia/llama-3.1-nemotron-70b-instruct');
}

console.log('\n== 6. Health probe: reasoning models never false-fail; a 5-token probe is not sent to them ==');
{
  reset();
  await setModel('deepseek-ai/deepseek-r1');
  behavior = (i) => i.body && i.body.max_tokens <= 8
    ? new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '', reasoning_content: 'The user wants ok' }, finish_reason: 'length' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    : okJson('ok', { reasoning_content: 'trivial' });
  const h = await call('GET', '/ai/health?refresh=1', undefined, TOK);
  check('/ai/health → ok for a reasoning model', h.status === 200 && h.data.nvidia.status === 'ok' && h.data.nvidia.model === 'deepseek-ai/deepseek-r1', JSON.stringify(h.data.nvidia));
  check('health flags the model as reasoning', h.data.nvidia.reasoning === true);
  const probe = captured.find((c) => c.body && c.body.model === 'deepseek-ai/deepseek-r1');
  check('probe request carried a real thinking budget', probe && probe.body.max_tokens >= 1024, probe && probe.body.max_tokens);
  await setModel('nvidia/llama-3.1-nemotron-70b-instruct');
  reset();
  behavior = () => okJson('ok');
  await call('GET', '/ai/health?refresh=1', undefined, TOK);
  const probe2 = captured.find((c) => c.body);
  check('ordinary model keeps the cheap 5-token probe', probe2 && probe2.body.max_tokens === 5, probe2 && probe2.body.max_tokens);
}

console.log('\n== 7. POST /ai/models/check: a precise verdict for ANY id ==');
{
  reset();
  const catalog = ['nvidia/llama-3.1-nemotron-70b-instruct', 'nvidia/llama-3.3-nemotron-super-49b-v1', 'meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1', 'nvidia/nv-embedqa-e5-v5'];
  behavior = (i) => {
    if (i.url.endsWith('/models')) return err(200, { data: catalog.map((id) => ({ id })) });
    const m = i.body.model;
    if (m === 'meta/llama-3.3-70b-instruct') return okJson('ok');
    if (m === 'deepseek-ai/deepseek-r1') return okJson('ok', { reasoning_content: 'short' });
    if (m === 'google/gemma-3-27b-it') return i.body.messages.some((x) => x.role === 'system') ? err(400, { message: 'System role not supported' }) : okJson('ok');
    return err(404, { type: 'about:blank', title: 'Not Found', status: 404, detail: `Model "${m}" not found` });
  };
  await call('GET', '/ai/models?refresh=1', undefined, TOK); // warm the live catalog for suggestions
  let r = await call('POST', '/ai/models/check', { model: 'meta/llama-3.3-70b-instruct' }, TOK);
  check('works → status ok + timing + reply', r.status === 200 && r.data.ok === true && r.data.status === 'ok' && typeof r.data.ms === 'number' && r.data.reply === 'ok', JSON.stringify(r.data).slice(0, 120));
  r = await call('POST', '/ai/models/check', { model: 'https://build.nvidia.com/deepseek-ai/deepseek-r1' }, TOK);
  check('pasted link is accepted; reasoning profile reported', r.data.ok === true && r.data.model === 'deepseek-ai/deepseek-r1' && r.data.profile.reasoning === true, JSON.stringify(r.data).slice(0, 120));
  r = await call('POST', '/ai/models/check', { model: 'nvidia/nv-embedqa-e5-v5' }, TOK);
  check('embedding id → not_chat with the reason, and NO network call wasted', r.data.ok === false && r.data.status === 'not_chat' && /embedding/i.test(r.data.message) && !captured.some((c) => c.body && c.body.model === 'nvidia/nv-embedqa-e5-v5'), JSON.stringify(r.data).slice(0, 120));
  r = await call('POST', '/ai/models/check', { model: 'nvidia/llama-3.3-nemotron-super-49b' }, TOK);
  check('typo → model_not_found + "did you mean" from the LIVE catalog', r.data.ok === false && r.data.status === 'model_not_found' && Array.isArray(r.data.suggestions) && r.data.suggestions[0] === 'nvidia/llama-3.3-nemotron-super-49b-v1', JSON.stringify(r.data).slice(0, 160));
  r = await call('POST', '/ai/models/check', { model: 'google/gemma-3-27b-it' }, TOK);
  check('model needing adaptation → ok + the adaptation is named', r.data.ok === true && r.data.adjustments.some((a) => /system prompt folded/.test(a)), JSON.stringify(r.data).slice(0, 160));
  r = await call('POST', '/ai/models/check', { model: '' }, TOK);
  check('empty model → 400', r.status === 400);
  r = await call('POST', '/ai/models/check', { model: 'x/y', provider: 'openai' }, TOK);
  check('provider without a key → no_key verdict (200, structured)', r.status === 200 && r.data.status === 'no_key');
  const unauth = await worker.fetch(new Request(BASE + '/api/ai/models/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"model":"a/b"}' }), env, ctx);
  check('check route requires auth', unauth.status === 401);
  // the saved setting itself can be any live id — the chain runs it
  behavior = (i) => i.url.endsWith('/models') ? err(200, { data: catalog.map((id) => ({ id })) }) : (i.body.model === 'nvidia/llama-3.3-nemotron-super-49b-v1' ? okJson('super ok') : err(404, { detail: 'nope' }));
  await setModel('nvidia/llama-3.3-nemotron-super-49b-v1');
  const c = await call('POST', '/ai/complete', { prompt: 'hi', include_context: false }, TOK);
  check('a non-curated live model works as the saved model', c.status === 200 && c.data.content === 'super ok' && c.data.model === 'nvidia/llama-3.3-nemotron-super-49b-v1', JSON.stringify(c.data).slice(0, 100));
  await setModel('nvidia/llama-3.1-nemotron-70b-instruct');
}

console.log('\n== 8b. Workspace personality prompt never erases a task protocol ==');
{
  reset();
  await call('PATCH', '/ai/settings', { system_prompt: 'You are NexusCRM AI for Nile Plumbing. Be warm and brief.' }, TOK);
  behavior = () => okJson('{"action":"create_task","params":{"title":"Call Bob"},"reply":"Done — task created."}');
  const r = await call('POST', '/ai/agent', { message: 'remind me to call Bob' }, TOK);
  const sent = captured.find((c) => c.body && c.body.messages);
  const sys = (sent ? sent.body.messages : []).filter((m) => m.role === 'system');
  check('agent still answers with an action', r.status === 200 && /Done/.test(JSON.stringify(r.data)), JSON.stringify(r.data).slice(0, 100));
  check('ONE merged system turn (models that accept a single system message stay happy)', sys.length === 1, 'system turns=' + sys.length);
  check('the personality is in it…', /Nile Plumbing/.test(sys[0]?.content || ''));
  check('…AND the agent JSON protocol survived (was silently dropped before)', /Allowed actions/.test(sys[0]?.content || ''), (sys[0]?.content || '').slice(0, 80));
  captured = [];
  behavior = () => okJson('Your hottest lead is Bob.');
  await call('POST', '/ai/complete', { prompt: 'hottest lead?' }, TOK);
  const sent2 = captured.find((c) => c.body && c.body.messages);
  const sys2 = (sent2 ? sent2.body.messages : []).filter((m) => m.role === 'system');
  check('complete: personality + operating law + live data in one system turn', sys2.length === 1 && /Nile Plumbing/.test(sys2[0].content) && /Never invent contacts/.test(sys2[0].content), (sys2[0]?.content || '').slice(0, 120));
  await call('PATCH', '/ai/settings', { system_prompt: '' }, TOK);
}

console.log('\n== 8. Pure adapter unit checks (no worker) ==');
{
  const f = NIM.nimThinkFilter();
  let out = { d: '', r: '' };
  for (const piece of ['  <th', 'ink>plan', ' more</thi', 'nk>Answer', ' text']) { const x = f.feed(piece); out.d += x.delta; out.r += x.reasoning; }
  const fl = f.flush(); out.d += fl.delta; out.r += fl.reasoning;
  check('think filter: boundary-split tags', out.d === 'Answer text' && out.r === 'plan more', JSON.stringify(out));
  const g = NIM.nimThinkFilter(); const y = g.feed('Plain answer'); check('think filter: plain text passes through untouched', y.delta === 'Plain answer' && y.reasoning === '');
  const e = NIM.nimExtractContent({ content: [{ type: 'text', text: 'part one ' }, { type: 'text', text: 'part two' }] });
  check('parts-array content flattened', e.content === 'part one part two');
  check('adaptError: unrelated 400 → null', NIM.nimAdaptError(400, { message: 'Invalid image URL' }) === null && NIM.nimAdaptError(500, { message: 'max_tokens' }) === null);
  const a = NIM.nimAdaptError(400, { message: "This model's maximum context length is 8192 tokens. However, you requested 9000 tokens (2000 in the messages, 7000 in the completion)." });
  check('adaptError: context-length arithmetic leaves room for the prompt', a && a.kind === 'clamp_max_tokens' && a.value <= 8192 - 2000 && a.value >= 1000, JSON.stringify(a));
  const body = NIM.nimBuildBody('deepseek-ai/deepseek-r1', [{ role: 'user', content: 'x' }], { max_tokens: 5, temperature: 0.2, stream: true }, new Map([['clamp_max_tokens', 2048]]));
  check('buildBody: reasoning floor (1024) then clamp (2048) → 1024; stream_options on', body.max_tokens === 1024 && body.stream === true && body.stream_options.include_usage === true, JSON.stringify(body).slice(0, 120));
  const merged = NIM.nimMergeRoles([{ role: 'assistant', content: 'a' }, { role: 'user', content: 'u1' }, { role: 'user', content: 'u2' }]);
  check('mergeRoles: leading assistant gets a user opener; consecutive users merge', merged[0].role === 'user' && merged.length === 3 && merged[2].content === 'u1\n\nu2', JSON.stringify(merged));
  check('suggestModels: closest ids first', NIM.nimSuggestModels('nemotron 70b', ['a/b', 'nvidia/llama-3.1-nemotron-70b-instruct', 'nvidia/nemotron-3-nano-30b-a3b'], 2)[0] === 'nvidia/llama-3.1-nemotron-70b-instruct');
  const X = NIM.nimExtractJson;
  check('extractJson: fenced JSON + prose + stray brace after', JSON.stringify(X('Here you go:\n```json\n{"score": 82, "reason": "hot {lead}"}\n```\nHope that helps }')) === '{"score":82,"reason":"hot {lead}"}');
  check('extractJson: <think> prefix + trailing comma tolerated', JSON.stringify(X('<think>hmm</think>{"a":1,}')) === '{"a":1}');
  check('extractJson: arrays on request; objects skipped', JSON.stringify(X('[1,2,3] and {"x":1}', 'array')) === '[1,2,3]' && JSON.stringify(X('[1,2,3] and {"x":1}')) === '{"x":1}');
  check('extractJson: nothing parseable → null (never a fake {})', X('no json here') === null && X('{"broken": ') === null && X('') === null);
  check('extractJson: braces inside strings do not confuse the scanner', JSON.stringify(X('text {"nested":{"x":"}"}} trailing {"y":2}')) === '{"nested":{"x":"}"}}');
  check('nonChatReason explains the class', /embedding/.test(NIM.nimNonChatReason('nvidia/nv-embedqa-e5-v5')) && /reranker/.test(NIM.nimNonChatReason('nvidia/llama-3.2-nv-rerankqa-1b-v2')) && NIM.nimNonChatReason('meta/llama-3.3-70b-instruct') === '');
}

globalThis.fetch = realFetch;
// Route-coverage handshake (run_all.mjs merges these across suites so every
// served route — including /ai/models/check — is proven exercised).
process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch (e) { /* coverage print is best-effort */ } });
console.log(`\nNIM RESULTS: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
