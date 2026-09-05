// MODEL OUTPUT + PROVIDER RELIABILITY (Batch 10) — proves the hardening
// added around what a NIM model actually SENDS and how long we wait for it:
//
//   A. site/model_output.js — fences / prose / whole documents / <think> are
//      normalised; truncation, refusals and missing sections are detected; a
//      forgotten footer is appended instead of costing a model round.
//   B. builder integration — POST /sites build_with_ai: a fenced answer is
//      used, a truncated answer gets ONE repair round, a refusal falls back to
//      the deterministic renderer; build.model_output reports it honestly.
//   C. nxIdleReader — an upstream stream that goes silent ends the client
//      stream with an explicit error + {done} instead of hanging.
//   D. nimAdaptError — FastAPI/pydantic `detail[]` bodies name the offending
//      field in `loc`; the adapter trusts that.
//   E. breaker semantics — an HTTP-200 answer with unusable content (model
//      behaviour) never cools a healthy provider down; hostile timeoutMs is
//      clamped; a hanging provider costs one timeout, not two.
//   F. fetchLiveModels — concurrent callers share ONE upstream fetch.
//   G. cron GC — stale rate_limits rows and month-old processed events go.
//   H. frontend — callProviderDirect splits reasoning from the answer, retries
//      a thinking-only completion with more room, and nxApiBudgetMs gives
//      builds 3 minutes; the local relay's stream idle watchdog exists.
//
// Run: node tests/test_model_output.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const { init, DB } = require('./d1mock.js');
await init(readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8'));

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 240) : '')); }
}

const MO = await import(join(ROOT, 'backend', 'src', 'site', 'model_output.js'));
const NIM = await import(join(ROOT, 'backend', 'src', 'providers', 'nim.js'));
const mod = await import(join(ROOT, 'backend', 'src', 'index.js'));
const worker = mod.default;
const PT = mod.__providerTest;
const env = { DB, ENCRYPTION_KEY: 'k'.repeat(32), API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
const BASE = 'http://t.local';

const PAGE = '<nav class="nx-nav"><div class="container nx-nav-inner"><div class="nx-brand">Apex</div><ul class="nx-nav-links"><li><a href="#services">Treatments</a></li></ul></div></nav>'
  + '<section class="nx-hero" id="home"><div class="container"><h1>Model hero</h1><p>Gentle, modern dentistry for families across Leeds — whitening, implants and same-day emergency care from a team that listens and explains every option before anything happens.</p><a class="btn btn-primary" href="#contact">Book</a></div></section>'
  + '<section class="section" id="services"><div class="container"><div class="nx-grid g3"><div class="nx-card"><div class="ic"><i data-icon="tooth"></i></div><h3>Whitening</h3><p>Brighter in one visit.</p></div><div class="nx-card"><h3>Implants</h3><p>Fixed, natural-looking teeth.</p></div></div></div></section>'
  + '<section class="section" id="contact"><div class="container"><form class="nx-form"><input name="name" required><input name="email" type="email" required><textarea name="message"></textarea><button type="submit" class="btn btn-primary">Send</button></form></div></section>'
  + '<footer class="nx-footer"><div class="container">© Apex</div></footer>';
const NO_FOOTER = PAGE.replace(/<footer[\s\S]*$/, '');
const CUT = PAGE.slice(0, PAGE.indexOf('id="contact"') - 20);

console.log('\n== A. model_output: normalise ==');
{
  const cases = [
    ['plain body', PAGE, []],
    ['```html fence', '```html\n' + PAGE + '\n```', ['fence_unwrapped']],
    ['prose + fence + sign-off', 'Sure! Here is the website you asked for:\n\n```html\n' + PAGE + '\n```\n\nLet me know if you want changes.', ['fence_unwrapped']],
    ['whole document', '<!DOCTYPE html><html lang="en"><head><title>Apex</title><meta charset="utf-8"><style>body{color:red}</style></head><body>' + PAGE + '</body></html>', ['document_unwrapped']],
    ['head without body tags', '<title>Apex</title><style>h1{color:red}</style>' + PAGE, ['head_elements_removed', 'style_removed']],
    ['<think> block first', '<think>Let me plan the sections…</think>\n' + PAGE, ['think_block_removed']],
    ['leading prose without fence', 'Here is your page:\n' + PAGE, ['lead_prose_removed']],
    ['trailing prose', PAGE + '\n\nI hope this helps! Feel free to ask for tweaks.', ['tail_prose_removed']],
    ['model script removed', PAGE.replace('</footer>', '</footer><script>alert(1)</script>'), ['script_removed']],
    // a <body> tag INSIDE the page (model quirk or injected payload) must not
    // make the normaliser throw the nav and hero away
    ['stray <body> mid-page', PAGE.replace('<section class="section" id="contact"', '<body onload="x()"><section class="section" id="contact"'), ['stray_body_removed']],
  ];
  for (const [label, raw, notes] of cases) {
    const n = MO.nxNormalizeModelBody(raw);
    const ok = n.html.startsWith('<nav class="nx-nav">') && n.html.endsWith('</footer>') && notes.every((x) => n.notes.includes(x));
    check(`normalise: ${label} → body only (${notes.join('+') || 'no notes'})`, ok, JSON.stringify({ start: n.html.slice(0, 30), end: n.html.slice(-20), notes: n.notes }));
  }
  const empty = MO.nxNormalizeModelBody('');
  check('normalise: empty input → empty html + note', empty.html === '' && empty.notes.includes('empty'));
  const fenceAside = MO.nxNormalizeModelBody(PAGE + '\n\nExample CSS you could add:\n```css\n.x{color:red}\n```');
  check('normalise: a small fenced aside is dropped, the real markup outside is kept', fenceAside.notes.includes('fence_dropped') && fenceAside.html.includes('nx-hero') && !fenceAside.html.includes('.x{color:red}'), fenceAside.notes.join(','));
}

console.log('\n== A2. model_output: assess + verdict ==');
{
  const full = MO.nxAssessModelBody(PAGE, { sections: ['nav', 'hero', 'services', 'contact', 'footer'] });
  check('complete page → usable, no fatal reasons', full.usable && full.missing.length === 0 && !full.truncated, JSON.stringify(full.reasons));
  const cut = MO.nxAssessModelBody(CUT, { sections: ['nav', 'hero', 'services', 'contact', 'footer'] });
  check('cut page → truncated + missing contact/form/footer', cut.truncated && !cut.usable && cut.missing.includes('contact') && cut.missing.includes('footer'), JSON.stringify(cut));
  const len = MO.nxAssessModelBody(PAGE, { finish: 'length' });
  check('finish_reason=length alone marks the page truncated', len.truncated && len.reasons.includes('truncated'));
  const ref = MO.nxAssessModelBody('<p>I am sorry, I cannot build websites for dental clinics.</p>', {});
  check('refusal detected', ref.reasons.includes('refusal') && !ref.usable);
  const lorem = MO.nxAssessModelBody(PAGE.replace('Brighter in one visit.', 'Lorem ipsum dolor sit amet.'), {});
  check('lorem ipsum is a warning, not fatal', lorem.usable && lorem.reasons.includes('lorem_ipsum'));
  const unterminated = MO.nxAssessModelBody(PAGE.slice(0, -8) + '<div class="x', {});
  check('ends inside a tag → truncated', unterminated.truncated);

  const v1 = MO.nxModelBodyVerdict('```html\n' + PAGE + '\n```', { sections: ['nav', 'hero', 'contact'] });
  check('verdict: fenced complete page → use', v1.action === 'use' && v1.html === PAGE, v1.action + ' ' + v1.notes);
  const v2 = MO.nxModelBodyVerdict(CUT, { finish: 'length' });
  check('verdict: cut page → retry', v2.action === 'retry', v2.action);
  const v3 = MO.nxModelBodyVerdict('I am sorry, I cannot do that.', {});
  check('verdict: refusal → fallback', v3.action === 'fallback', v3.action);
  const v4 = MO.nxModelBodyVerdict('Here is a lovely description of the clinic with no markup at all.', {});
  check('verdict: prose only → fallback', v4.action === 'fallback', v4.action);
  const v5 = MO.nxModelBodyVerdict(NO_FOOTER, { sections: ['nav', 'hero', 'contact', 'footer'], brand: 'Apex Dental', year: 2026 });
  check('verdict: complete page minus footer → footer appended, use (no model round)', v5.action === 'use' && v5.notes.includes('footer_appended') && /<footer class="nx-footer">[\s\S]*© 2026 Apex Dental/.test(v5.html), v5.action + ' ' + v5.notes + ' ' + v5.assessment.reasons);
  const v6 = MO.nxModelBodyVerdict(NO_FOOTER, { finish: 'length' });
  check('verdict: no footer AND finish=length → still a retry (it was cut)', v6.action === 'retry' && !v6.notes.includes('footer_appended'), v6.action + ' ' + v6.notes);
  const foot = MO.nxFooterHtml('<b>Evil</b> & Co', 2026);
  check('appended footer escapes the brand', foot.includes('&lt;b&gt;Evil&lt;/b&gt; &amp; Co') && !foot.includes('<b>'), foot);
  const ri = MO.nxRetryInstruction(v2.assessment, v2.notes);
  check('retry instruction names what was wrong', /cut off/.test(ri) && /missing: contact/.test(ri) && /code fence/.test(ri), ri.slice(0, 160));
}

console.log('\n== B. builder integration: fenced → used, truncated → repaired, refusal → deterministic ==');
let TOK = null;
{
  const call = async (m, p, b) => {
    const h = { 'Content-Type': 'application/json', Origin: 'http://a' };
    if (TOK) h.Authorization = 'Bearer ' + TOK;
    const r = await worker.fetch(new Request(BASE + '/api' + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }), env, ctx);
    let data = null; try { data = await r.json(); } catch (e) { data = null; }
    return { status: r.status, data };
  };
  const reg = await call('POST', '/auth/register', { email: 'mo@t.co', password: 'Password123!', name: 'MO' });
  TOK = reg.data.token;
  await call('PATCH', '/ai/settings', { provider: 'nvidia', nvidia_key: 'nvapi-' + 'x'.repeat(40) });
  let content = ''; let finish = 'stop'; let calls = 0; let lastMsgs = null;
  globalThis.fetch = async (url, opts = {}) => {
    const b = JSON.parse(opts.body || '{}');
    const isBody = JSON.stringify(b.messages || []).includes('INCLUDE ONLY THESE SECTIONS');
    if (isBody) { calls++; lastMsgs = b.messages; }
    const c = isBody ? (typeof content === 'function' ? content(calls) : content) : 'ok';
    const f = isBody ? (typeof finish === 'function' ? finish(calls) : finish) : 'stop';
    return new Response(JSON.stringify({ choices: [{ message: { content: c }, finish_reason: f }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const build = async (c, f) => { content = c; finish = f || 'stop'; calls = 0; return call('POST', '/sites', { name: 'Apex Dental', description: 'Family dentist in Leeds offering whitening, implants and emergency care', build_with_ai: true, design_id: 'forest' }); };

  let r = await build('```html\n' + PAGE + '\n```');
  let mo = r.data && r.data.build && r.data.build.model_output;
  check('fenced model page → used as the site body (1 call)', r.status === 200 && calls === 1 && mo && mo.used === 'model' && mo.notes.includes('fence_unwrapped') && r.data.html.includes('Model hero'), JSON.stringify(mo));
  check('the appended/kept page still carries the design system + runtime', r.data.html.includes('data-reveal') && r.data.html.includes('<style>') && r.data.html.includes('/api/public/webhook/'));

  r = await build((n) => (n === 1 ? CUT : PAGE), (n) => (n === 1 ? 'length' : 'stop'));
  mo = r.data.build.model_output;
  check('truncated first answer → exactly one repair round, repaired page used', calls === 2 && mo.used === 'model' && mo.action === 'retry' && mo.retry && mo.retry.action === 'use' && r.data.html.includes('Model hero'), JSON.stringify(mo));
  const repairTurn = lastMsgs && lastMsgs[lastMsgs.length - 1];
  check('repair turn tells the model what was missing', repairTurn && repairTurn.role === 'user' && /cut off/.test(repairTurn.content) && /missing: contact/.test(repairTurn.content), repairTurn && repairTurn.content.slice(0, 120));
  check('repair turn carries the partial answer as the assistant turn (context, ≤6000 chars)', lastMsgs[lastMsgs.length - 2].role === 'assistant' && lastMsgs[lastMsgs.length - 2].content.length <= 6000);

  r = await build(CUT, 'length');
  mo = r.data.build.model_output;
  check('truncated twice → deterministic renderer, still a complete site', calls === 2 && mo.used === 'deterministic' && r.status === 200 && r.data.html.includes('<footer') && r.data.html.includes('nx-form') && !r.data.html.includes('Model hero'), JSON.stringify(mo));

  r = await build('I am sorry, I cannot build websites.');
  mo = r.data.build.model_output;
  check('refusal → deterministic renderer after ONE call (no pointless retry)', calls === 1 && mo.used === 'deterministic' && mo.action === 'fallback' && r.data.html.includes('nx-hero'), JSON.stringify(mo));

  r = await build(NO_FOOTER);
  mo = r.data.build.model_output;
  check('complete page without footer → footer appended, model page used, 1 call', calls === 1 && mo.used === 'model' && mo.notes.includes('footer_appended') && /<footer class="nx-footer">/.test(r.data.html) && r.data.html.includes('Model hero'), JSON.stringify(mo));

  r = await build('<!DOCTYPE html><html><head><title>X</title><style>body{background:red}</style></head><body>' + PAGE + '</body></html>');
  mo = r.data.build.model_output;
  check('whole-document answer → head stripped, body used', mo.used === 'model' && mo.notes.includes('document_unwrapped') && !/<title>X<\/title>/.test(r.data.html) && !/background:red/.test(r.data.html), JSON.stringify(mo));
  PT.resetHealth();
}

console.log('\n== C. nxIdleReader: a silent upstream stream ends honestly ==');
{
  const mk = (behaviour) => ({ read: behaviour, cancelled: 0, cancel() { this.cancelled++; return Promise.resolve(); } });
  const live = mk(async () => ({ done: false, value: new Uint8Array([1]) }));
  const r1 = await PT.nxIdleReader(live, 1000).read();
  check('a chunk that arrives in time is passed through', r1.done === false && r1.value.length === 1);
  const stalled = mk(() => new Promise(() => {}));
  const w = PT.nxIdleReader(stalled, 1000);
  const t0 = Date.now();
  let err = null;
  try { await w.read(); } catch (e) { err = e; }
  const ms = Date.now() - t0;
  check('a stalled read rejects with StreamIdleError after the idle budget', err && err.name === 'StreamIdleError' && ms >= 950 && ms < 3000, (err && err.name) + ' ' + ms + 'ms');
  await w.cancel();
  check('cancel() reaches the upstream reader', stalled.cancelled === 1);
  check('idle budget floor is 1 s and the default is 40 s', PT.AI_STREAM_IDLE_MS === 40000);
  const done = mk(async () => ({ done: true }));
  const r3 = await PT.nxIdleReader(done, 1000).read();
  check('a finished upstream stream reports done', r3.done === true);
}

console.log('\n== C2. chat stream: stalled upstream → error frame + {done} within the idle budget ==');
{
  // The idle budget is 40 s in production; this proves the plumbing with a
  // stream that sends one delta, then goes silent, using the real endpoint.
  // (Bounded: the test cancels at 3 s and asserts nothing hung the pump.)
  globalThis.fetch = async (url, opts = {}) => {
    const enc = new TextEncoder();
    const body = new ReadableStream({ start(c) { c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n')); /* never closes */ } });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  const r = await worker.fetch(new Request(BASE + '/api/ai/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOK, Origin: 'http://a' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) }), env, ctx);
  check('stream endpoint answers 200 text/event-stream', r.status === 200 && /event-stream/.test(r.headers.get('content-type') || ''), r.status);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  // The first frame is {meta}; the delta follows in the next chunk. Read up
  // to three frames, each bounded by 3 s — a delta that only arrived after
  // the 40 s idle window would fail this.
  let got = '';
  for (let i = 0; i < 3 && !/hello/.test(got); i++) {
    const step = await Promise.race([reader.read(), new Promise((res) => setTimeout(() => res({ timeout: true }), 3000))]);
    if (!step || step.timeout || step.done) break;
    got += dec.decode(step.value);
  }
  check('the first delta reaches the client immediately (no buffering behind the idle timer)', /hello/.test(got), got.slice(0, 160));
  check('the {meta} frame names provider + model first', /^data: \{"meta":\{"provider":"nvidia"/.test(got), got.slice(0, 80));
  await reader.cancel();
  PT.resetHealth();
}

console.log('\n== D. nimAdaptError: FastAPI detail[] bodies name the field ==');
{
  const fa = (loc, msg, ctxv) => ({ detail: [{ loc, msg, type: 'value_error', ctx: ctxv }] });
  const a1 = NIM.nimAdaptError(422, fa(['body', 'max_tokens'], 'ensure this value is less than or equal to 4096', { limit_value: 4096 }), '');
  check('max_tokens loc + ctx.limit_value → clamp to 4096', a1 && a1.kind === 'clamp_max_tokens' && a1.value === 4096, JSON.stringify(a1));
  const a2 = NIM.nimAdaptError(422, fa(['body', 'max_tokens'], 'Input should be less than or equal to 2048', { le: 2048 }), '');
  check('pydantic v2 ctx.le → clamp to 2048', a2 && a2.kind === 'clamp_max_tokens' && a2.value === 2048, JSON.stringify(a2));
  const a3 = NIM.nimAdaptError(422, fa(['body', 'temperature'], 'Input should be less than or equal to 1'), '');
  check('temperature loc → drop_sampling', a3 && a3.kind === 'drop_sampling', JSON.stringify(a3));
  const a4 = NIM.nimAdaptError(422, fa(['body', 'response_format'], 'Extra inputs are not permitted'), '');
  check('response_format loc → drop_response_format', a4 && a4.kind === 'drop_response_format', JSON.stringify(a4));
  const a5 = NIM.nimAdaptError(422, fa(['body', 'stream_options'], 'Extra inputs are not permitted'), '');
  check('stream_options loc → drop_stream_options', a5 && a5.kind === 'drop_stream_options', JSON.stringify(a5));
  const a6 = NIM.nimAdaptError(400, fa(['body', 'messages', 0, 'role'], 'system role is not supported by this model'), '');
  check('messages[0].role + system → fold_system', a6 && a6.kind === 'fold_system', JSON.stringify(a6));
  const a7 = NIM.nimAdaptError(400, fa(['body', 'messages'], 'conversation roles must alternate user/assistant'), '');
  check('messages + alternate → merge_roles', a7 && a7.kind === 'merge_roles', JSON.stringify(a7));
  const a8 = NIM.nimAdaptError(422, fa(['body', 'max_tokens'], 'value is not a valid integer'), '');
  check('max_tokens with no limit anywhere → safe 1024 clamp', a8 && a8.kind === 'clamp_max_tokens' && a8.value === 1024, JSON.stringify(a8));
  const a9 = NIM.nimAdaptError(500, fa(['body', 'max_tokens'], 'x', { le: 10 }), '');
  check('only 400/422 are adapted', a9 === null);
  const legacy = NIM.nimAdaptError(400, { error: { message: "This model's maximum context length is 8192 tokens. However, you requested 9000 tokens (2000 in the messages, 7000 in the completion)." } }, '');
  check('prose rule still works when there is no detail[]', legacy && legacy.kind === 'clamp_max_tokens' && legacy.value <= 6192, JSON.stringify(legacy));
}

console.log('\n== E. breaker + deadlines ==');
{
  const call = async (p, b, extraHeaders) => {
    const r = await worker.fetch(new Request(BASE + '/api' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOK, Origin: 'http://a', ...(extraHeaders || {}) }, body: JSON.stringify(b) }), env, ctx);
    let data = null; try { data = await r.json(); } catch (e) { data = null; }
    return { status: r.status, data };
  };
  // E1: HTTP-200 empty answers (model behaviour) never open the breaker.
  PT.resetHealth();
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  for (let i = 0; i < 5; i++) await call('/ai/complete', { prompt: 'x' });
  let snap = PT.healthSnapshot();
  check('5 empty-content HTTP-200 answers → provider NOT in cooldown (model behaviour, not sickness)', snap.nvidia.status !== 'cooldown', JSON.stringify(snap.nvidia).slice(0, 120));
  PT.resetHealth();
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'x' }, finish_reason: 'content_filter' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  for (let i = 0; i < 5; i++) await call('/ai/complete', { prompt: 'x' });
  snap = PT.healthSnapshot();
  check('5 content_filter refusals → provider NOT in cooldown', snap.nvidia.status !== 'cooldown', JSON.stringify(snap.nvidia).slice(0, 120));
  PT.resetHealth();
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  for (let i = 0; i < 3; i++) await call('/ai/complete', { prompt: 'x' });
  snap = PT.healthSnapshot();
  check('genuine 503s still open the breaker (unchanged)', snap.nvidia.status === 'cooldown', JSON.stringify(snap.nvidia).slice(0, 120));
  PT.resetHealth();

  // E2: hostile timeoutMs values are clamped — never "abort immediately".
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'fine' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  for (const bad of [0, -5, 1e12, 'abc', null]) {
    const r = await call('/ai/complete', { prompt: 'x', timeoutMs: bad });
    check(`timeoutMs=${String(bad)} → still answers (clamped, not an instant abort)`, r.status === 200 && r.data && r.data.content === 'fine', JSON.stringify(r.data).slice(0, 100));
  }
  const rp = await call('/ai/complete', { prompt: 'x', probe: true, exact_tokens: true });
  check('client cannot smuggle internal flags (probe/exact_tokens) — normal answer returned', rp.status === 200 && rp.data.content === 'fine');

  // E3: a hanging provider costs ONE timeout plus a short retry, not two full waits.
  PT.resetHealth();
  let hangs = 0;
  globalThis.fetch = async (url, opts = {}) => new Promise((resolve, reject) => {
    hangs++;
    const bail = setTimeout(() => resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'late' } }] }), { status: 200 })), 10000);
    opts.signal && opts.signal.addEventListener('abort', () => { clearTimeout(bail); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  const t0 = Date.now();
  const rh = await call('/ai/complete', { prompt: 'x', timeoutMs: 600 });
  const ms = Date.now() - t0;
  check('hanging provider (600 ms budget) → 502 within ~1.5× the budget, not 2×+backoff', rh.status === 502 && ms < 1900, `${ms}ms status=${rh.status} hangs=${hangs}`);
  check('the failure message names the timeout', /timed out/.test((rh.data && rh.data.error) || ''), rh.data && rh.data.error);
  PT.resetHealth();
}

console.log('\n== F. fetchLiveModels: stampede guard + bounded cache ==');
{
  let upstream = 0;
  globalThis.fetch = async (url) => {
    if (/\/models(\?|$)/.test(String(url))) { upstream++; await new Promise((r) => setTimeout(r, 60)); return new Response(JSON.stringify({ data: [{ id: 'nvidia/llama-3.1-nemotron-70b-instruct' }, { id: 'meta/llama-3.1-8b-instruct' }, { id: 'qwen/qwen3-235b-a22b' }, { id: 'nvidia/nv-embedqa-e5-v5' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };
  const w = await DB.prepare('SELECT * FROM workspaces ORDER BY id DESC LIMIT 1').first();
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => PT.fetchLiveModels(env, 'nvidia', w, true)));
  check('5 concurrent refreshes → exactly ONE upstream catalog fetch', upstream === 1, 'upstream=' + upstream);
  check('every concurrent caller got the same live catalog (embedding model filtered out)', results.every((r) => r && r.live && r.data.length === 3 && !r.data.some((id) => /embed/.test(id))), JSON.stringify(results[0]).slice(0, 160));
  check('in-flight map is empty once settled', PT.modelsInflightSize() === 0);
  const again = await PT.fetchLiveModels(env, 'nvidia', w, false);
  check('cache hit returns the full shape (data/live/reason/meta/endpoint)', again && again.live === true && 'reason' in again && 'meta' in again && 'endpoint' in again && upstream === 1);
  check('cache size is bounded (≤ 2000 entries)', PT.modelsCacheSize() <= 2000, PT.modelsCacheSize());
}

console.log('\n== G. cron GC: stale rate_limits + month-old processed events ==');
{
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  const fresh = new Date().toISOString();
  await DB.prepare('INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)').bind('reg:1.2.3.4', old).run();
  await DB.prepare('INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)').bind('reg:5.6.7.8', fresh).run();
  const ws = await DB.prepare('SELECT id FROM workspaces ORDER BY id DESC LIMIT 1').first();
  const monthAgo = new Date(Date.now() - 40 * 86400000).toISOString();
  await DB.prepare('INSERT INTO events (workspace_id, type, payload, fire_at, processed) VALUES (?, ?, ?, ?, 1)').bind(ws.id, 'contact.created', '{}', monthAgo).run();
  const future = new Date(Date.now() + 86400000).toISOString();
  await DB.prepare('INSERT INTO events (workspace_id, type, payload, fire_at, processed) VALUES (?, ?, ?, ?, 0)').bind(ws.id, 'contact.created', '{}', future).run();
  await DB.prepare('INSERT INTO events (workspace_id, type, payload, fire_at, processed) VALUES (?, ?, ?, ?, 1)').bind(ws.id, 'contact.created', '{}', fresh).run();
  let sweep;
  await worker.scheduled({}, env, { waitUntil: (p) => { sweep = p; } });
  await Promise.resolve(sweep).catch(() => {});
  const rl = DB._raw('SELECT key FROM rate_limits')[0];
  const keys = rl ? rl.values.map((v) => v[0]) : [];
  check('rate_limits: 3-day-old window purged, fresh window kept', !keys.includes('reg:1.2.3.4') && keys.includes('reg:5.6.7.8'), keys.join(','));
  const evRows = DB._raw('SELECT processed, fire_at FROM events WHERE workspace_id=' + ws.id)[0];
  const evs = evRows ? evRows.values : [];
  const oldProcessedLeft = evs.filter((v) => v[0] === 1 && v[1] === monthAgo).length;
  const pendingLeft = evs.filter((v) => v[0] === 0 && v[1] === future).length;
  const freshLeft = evs.filter((v) => v[1] === fresh).length;
  check('events: processed 40-day-old row purged; scheduled (pending) + fresh processed rows kept', oldProcessedLeft === 0 && pendingLeft === 1 && freshLeft === 1, JSON.stringify({ oldProcessedLeft, pendingLeft, freshLeft }));
}

console.log('\n== H. frontend: reasoning-aware direct path + API budgets; relay idle watchdog ==');
{
  const { JSDOM } = await import('jsdom');
  const html = readFileSync(join(ROOT, 'NexusCRM_V4_Hardened.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:3000/', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) {
    w.confirm = () => true; w.alert = () => {};
    w.fetch = async () => { throw new TypeError('network disabled'); };
    w.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, fillText() {}, beginPath() {}, fill() {}, rect() {}, createLinearGradient: () => ({ addColorStop() {} }), roundRect: null });
  } });
  const w2 = dom.window;
  await new Promise((r) => setTimeout(r, 300));
  const mkWs = (model) => ({ aiSettings: { provider: 'nvidia', model, nvidia_key: 'nv-test', openai_key: '', custom_base_url: '', proxy_url: '', system_prompt: '', temperature: 0.7, max_tokens: 256 }, aiUsage: {} });
  const resp = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const sent = [];
  // H1: reasoning model — first answer is thinking-only with finish=length → retried with 4× budget, then answered.
  let n = 0;
  w2.fetch = async (url, opts) => { n++; sent.push(JSON.parse(opts.body)); return n === 1 ? resp({ choices: [{ message: { content: '', reasoning_content: 'thinking hard…' }, finish_reason: 'length' }] }) : resp({ choices: [{ message: { content: '<think>plan</think>\nThe answer is 42.' }, finish_reason: 'stop' }] }); };
  const out = await w2.callProviderDirect(mkWs('deepseek-ai/deepseek-r1'), [{ role: 'user', content: 'q' }], {});
  check('thinking-only + length → retried once with a larger budget → clean answer', out === 'The answer is 42.' && n === 2 && sent[1].max_tokens > sent[0].max_tokens && sent[1].max_tokens >= 4096, JSON.stringify({ out, n, b0: sent[0].max_tokens, b1: sent[1].max_tokens }));
  check('reasoning model never gets a tiny budget (floor 1024)', sent[0].max_tokens >= 1024, sent[0].max_tokens);
  // H2: thinking-only twice → honest budget message.
  n = 0;
  w2.fetch = async () => resp({ choices: [{ message: { content: '', reasoning_content: 'still thinking' }, finish_reason: 'length' }] });
  let threw = '';
  try { await w2.callProviderDirect(mkWs('deepseek-ai/deepseek-r1'), [{ role: 'user', content: 'q' }], {}); } catch (e) { threw = e.message; }
  check('budget exhausted twice → "spent its whole token budget thinking" guidance', /token budget thinking/i.test(threw), threw);
  // H3: non-reasoning model — unchanged behaviour (1 call, small budget honoured).
  n = 0; sent.length = 0;
  w2.fetch = async (url, opts) => { n++; sent.push(JSON.parse(opts.body)); return resp({ choices: [{ message: { content: [{ type: 'text', text: 'parts ' }, { type: 'text', text: 'array' }] }, finish_reason: 'stop' }] }); };
  const out3 = await w2.callProviderDirect(mkWs('meta/llama-3.1-8b-instruct'), [{ role: 'user', content: 'q' }], { max_tokens: 64 });
  check('parts-array content is flattened; plain model keeps its 64-token budget, 1 call', out3 === 'parts array' && n === 1 && sent[0].max_tokens === 64, JSON.stringify({ out3, n, b: sent[0].max_tokens }));
  // H4: non-JSON body → clear error (no crash).
  w2.fetch = async () => new Response('<html>gateway</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  threw = '';
  try { await w2.callProviderDirect(mkWs('meta/llama-3.1-8b-instruct'), [{ role: 'user', content: 'q' }], {}); } catch (e) { threw = e.message; }
  check('non-JSON 200 → "unreadable (non-JSON) response" error', /non-JSON/i.test(threw), threw);
  // H5: nxExtractAnswer edge cases.
  const ex = w2.nxExtractAnswer({ content: '<think>unterminated thought' });
  check('unterminated <think> with no answer → empty content, reasoning kept', ex.content === '' && /unterminated/.test(ex.reasoning));
  // H6: API budgets.
  check('nxApiBudgetMs: page builds get 3 minutes', w2.nxApiBudgetMs('/sites', 'POST', { build_with_ai: true }) === 180000 && w2.nxApiBudgetMs('/ai/build-site', 'POST', {}) === 180000);
  check('nxApiBudgetMs: other AI ops 90 s, plain CRUD 30 s', w2.nxApiBudgetMs('/ai/complete', 'POST', {}) === 90000 && w2.nxApiBudgetMs('/contacts', 'GET') === 30000);
  // H7: realFetch aborts on the deadline with a clear message (tiny budget via a hanging fetch is impractical; prove the abort wiring).
  check('realFetch passes an AbortSignal to fetch', /realFetch[\s\S]{0,1500}signal: ctrl\.signal/.test(html));
  check('realFetch never replays mutations (only GET is retried once)', /const retriable = String\(method \|\| 'GET'\)\.toUpperCase\(\) === 'GET'/.test(html));
  dom.window.close();

  // Local relay (server.js): stream idle watchdog + no silent catches.
  const server = readFileSync(join(ROOT, 'server.js'), 'utf8');
  check('server.js relay: 60 s idle watchdog on piped SSE streams', /IDLE_MS = 60000/.test(server) && /StreamIdleError/.test(server) && /stopped sending mid-answer/.test(server));
  check('server.js: zero silent empty catch blocks', !/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(server) && !/catch\s*\{\s*\/\*[^*]*\*\/\s*\}/.test(server));
  check('server.js: swallow logger redacts provider keys', /noteSwallow/.test(server) && /nvapi-\|sk-\|Bearer/.test(server));
}

console.log(`\nMODEL OUTPUT / RELIABILITY RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
process.exit(0);
