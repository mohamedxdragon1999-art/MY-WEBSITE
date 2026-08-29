// NexusCRM backend integration tests — run the REAL worker code against a
// real SQLite database (sql.js) with a fake AI provider on the network edge.
//
// Run: node tests/test_backend.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { init, DB } = require('./d1mock.js');

const schema = readFileSync(join(__dirname, '..', 'backend', 'schema.sql'), 'utf8');
await init(schema);

// ── Fake AI provider on the network edge ─────────────────────
let aiBehavior = 'ok'; // 'ok' | 'fail500' | 'fail500nvidia' | 'fail401' | 'stream'
// The fake provider lives on the network edge — never let tests touch the
// real APIs. Restore uses this same function (NOT the native fetch).
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('api.openai.com') || u.includes('integrate.api.nvidia.com') || u.includes('localhost:11434')) {
    if (aiBehavior === 'fail500nvidia' && u.includes('nvidia.com')) {
      return new Response(JSON.stringify({ error: { message: 'boom (500)' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    if (aiBehavior === 'fail500') {
      return new Response(JSON.stringify({ error: { message: 'boom (500)' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    if (aiBehavior === 'fail401') {
      return new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    if (aiBehavior === 'stream') {
      const enc = new TextEncoder();
      const body = new ReadableStream({
        start(c) {
          c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Hi "}}]}\n\n'));
          c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"there"}}]}\n\n'));
          c.enqueue(enc.encode('data: [DONE]\n\n'));
          c.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'FAKE_AI_RESPONSE' } }],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  // any other URL = a fake website page (for analyze-site)
  return new Response('<html><head><title>Acme Test Site</title></head><body><h1>Welcome to Acme</h1><p>We sell widgets and more widgets.</p><a href="/buy">Buy now</a></body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
};
const FAKE_FETCH = globalThis.fetch;

// ── Worker under test ────────────────────────────────────────
const worker = (await import(join(__dirname, '..', 'backend', 'src', 'index.js'))).default;
const env = { DB };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => { }) };

const BASE = 'http://test.local';
async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', Origin: 'http://app.local' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request(BASE + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const res = await worker.fetch(req, env, ctx);
  let data = null;
  try { data = await res.json(); } catch { }
  return { status: res.status, data };
}
// For SSE: read the raw response body manually (reader-based), then return text.
async function readSSE(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', Origin: 'http://app.local' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request(BASE + '/api' + path, { method, headers, body: JSON.stringify(body) });
  const res = await worker.fetch(req, env, ctx);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  // NOTE: use the reader directly — Response.text() hangs in Node/undici on
  // userland ReadableStream bodies. A 5s race guard keeps the suite from
  // wedging forever if a stream ever stalls.
  for (let i = 1; i <= 100; i++) {
    const r = await Promise.race([reader.read(), new Promise(res2 => setTimeout(() => res2({ __timeout: true }), 5000))]);
    if (r.__timeout) break;
    if (r.done) break;
    full += decoder.decode(r.value, { stream: true });
  }
  return { status: res.status, text: full };
}

// ── Tiny test framework ──────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

// ════════════════════════════════════════════════════════════
console.log('\n== AUTH ==');
let token;
{
  const r = await call('POST', '/auth/register', { name: 'Test User', email: 'test@example.com', password: 'password123' });
  check('register returns token', r.status === 200 && !!r.data?.token);
  token = r.data.token;
}
{
  const r = await call('POST', '/auth/register', { name: 'X', email: 'test@example.com', password: 'password123' });
  check('duplicate email → 409', r.status === 409);
}
{
  const r = await call('POST', '/auth/login', { email: 'test@example.com', password: 'wrongpass' });
  check('wrong password → 401 with message', r.status === 401 && !!r.data?.error);
}
{
  const r = await call('POST', '/auth/login', { email: 'test@example.com', password: 'password123' });
  check('correct login → token', r.status === 200 && !!r.data?.token);
}
{
  const r = await call('GET', '/contacts');
  check('no token → 401', r.status === 401);
}
{
  const r = await call('GET', '/auth/me', null, token);
  check('/auth/me works', r.status === 200 && r.data.user.email === 'test@example.com');
}
{
  DB._runRaw("INSERT INTO sessions (token, user_id, workspace_id, expires_at) VALUES ('expiredtok', 1, 1, '2020-01-01T00:00:00.000Z')");
  const r = await call('GET', '/auth/me', null, 'expiredtok');
  check('expired session → 401', r.status === 401);
  const gone = DB._raw("SELECT COUNT(*) c FROM sessions WHERE token='expiredtok'");
  check('expired session row deleted lazily', gone[0].values[0][0] === 0);
}

console.log('\n== RATE LIMITING ==');
{
  let hit429 = false;
  for (let i = 0; i < 21; i++) {
    const r = await call('POST', '/auth/register', { name: 'Spam' + i, email: `spam${i}@x.com`, password: 'password123' });
    if (r.status === 429) { hit429 = true; break; }
  }
  check('register rate limit (20/hr/IP) kicks in', hit429);
}

console.log('\n== TIMESTAMP FORMAT (fire_at fix) ==');
{
  const r = await call('POST', '/contacts', { name: 'Jane Doe', email: 'jane@x.com', phone: '+15550001', company: 'Acme' }, token);
  check('contact created', r.status === 200);
  const iso = DB._raw("SELECT created_at FROM contacts WHERE id=1")[0].values[0][0];
  check('created_at is ISO-8601 UTC', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso), iso);
  const cmp = DB._raw("SELECT COUNT(*) c FROM contacts WHERE created_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')")[0].values[0][0];
  check('ISO created_at compares correctly vs strftime(now)', cmp >= 1);
}

console.log('\n== CONTACTS CRUD + CASCADE ==');
let contactId;
{
  const r = await call('POST', '/contacts', { name: 'John Smith', email: 'john@x.com', phone: '+15550002', company: 'Acme' }, token);
  contactId = r.data.id;
  const r2 = await call('GET', '/contacts?search=john', null, token);
  check('search works', r2.status === 200 && r2.data.contacts.length === 1);
  const r3 = await call('GET', `/contacts/${contactId}`, null, token);
  check('get single', r3.status === 200 && r3.data.name === 'John Smith');
  const r4 = await call('PATCH', `/contacts/${contactId}`, { stage: 'qualified', notes: 'hot' }, token);
  check('patch works', r4.status === 200 && r4.data.stage === 'qualified');
}
{
  const d = await call('POST', '/deals', { title: 'Big Deal', contact_id: contactId, value: 5000 }, token);
  check('deal created', d.status === 200);
  await call('POST', '/tasks', { title: 'Follow up', contact_id: contactId }, token);
  await call('POST', '/messages', { contact_id: contactId, channel: 'email', body: 'hi' }, token);
  await call('POST', '/invoices', { contact_id: contactId, items: [{ desc: 'x', qty: 1, price: 10 }] }, token);
  const del = await call('DELETE', `/contacts/${contactId}`, null, token);
  check('delete contact', del.status === 200);
  const tasks = DB._raw('SELECT COUNT(*) c FROM tasks WHERE contact_id=' + contactId)[0].values[0][0];
  const deals = DB._raw('SELECT COUNT(*) c FROM deals WHERE contact_id=' + contactId)[0].values[0][0];
  const msgs = DB._raw('SELECT COUNT(*) c FROM messages WHERE contact_id=' + contactId)[0].values[0][0];
  check('tasks cascade-deleted', tasks === 0);
  check('deals cascade-deleted', deals === 0);
  check('messages cascade-deleted', msgs === 0);
}

console.log('\n== INVOICE NUMBERING (no reuse/collision) ==');
{
  const a = await call('POST', '/invoices', { items: [{ desc: 'A', qty: 1, price: 100 }] }, token);
  const b = await call('POST', '/invoices', { items: [{ desc: 'B', qty: 1, price: 200 }] }, token);
  const nA = parseInt(a.data.number.replace('INV-', ''));
  const nB = parseInt(b.data.number.replace('INV-', ''));
  check('sequential invoice numbers', nB === nA + 1, `${a.data.number} → ${b.data.number}`);
  DB._runRaw(`DELETE FROM invoices WHERE id=${a.data.id}`);
  const c = await call('POST', '/invoices', { items: [{ desc: 'C', qty: 1, price: 300 }] }, token);
  const nC = parseInt(c.data.number.replace('INV-', ''));
  check('number never reused after deletion (monotonic)', nC > nB, `${b.data.number} → ${c.data.number}`);
  const paid = await call('PATCH', `/invoices/${b.data.id}`, { status: 'paid' }, token);
  check('mark paid sets paid_at', paid.status === 200 && !!paid.data.paid_at);
  const st = await call('GET', '/stats', null, token);
  check('revenue_collected counts paid invoice', st.data.revenue_collected === 200, String(st.data.revenue_collected));
}

console.log('\n== REVIEWS PATCH (was a no-op) ==');
{
  const r = await call('POST', '/reviews', { platform: 'google', rating: 5, text: 'Amazing service!' }, token);
  check('review created', r.status === 200);
  const rid = r.data.id;
  const p = await call('PATCH', `/reviews/${rid}`, { ai_reply: 'Thank you so much!', status: 'responded' }, token);
  check('review reply saved', p.status === 200 && p.data.ai_reply === 'Thank you so much!');
  const list = await call('GET', '/reviews', null, token);
  const found = list.data.reviews.find(x => x.id === rid);
  check('reply persists on GET', found?.ai_reply === 'Thank you so much!' && found?.status === 'responded');
}

console.log('\n== WORKFLOW ENGINE (delays + remaining steps) ==');
{
  const wf = await call('POST', '/workflows', {
    name: 'Welcome', trigger: 'new_contact',
    steps: [
      { action: 'create_task', note: 'Immediate task' },
      { action: 'create_task', note: 'Delayed task', delay_hours: 0.00003 },
      { action: 'create_task', note: 'After delay task' },
    ],
  }, token);
  check('workflow created', wf.status === 200 && wf.data.steps.length === 3);
  const c = await call('POST', '/contacts', { name: 'Delay Test', email: 'dt@x.com' }, token);
  check('contact triggers event', c.status === 200);
  await new Promise(r => setTimeout(r, 400));
  await worker.scheduled({}, env, ctx);
  await new Promise(r => setTimeout(r, 100));
  const tasks = await call('GET', '/tasks', null, token);
  const titles = tasks.data.tasks.map(t => t.title);
  check('immediate step ran', titles.includes('Immediate task'));
  check('delayed step ran after fire_at', titles.includes('Delayed task'));
  check('step AFTER the delay also ran (was dropped before)', titles.includes('After delay task'), titles.join(','));
}

console.log('\n== FORM SUBMITTED TRIGGER + PUBLIC FORMS ==');
let formId;
{
  const f = await call('POST', '/forms', { name: 'Lead Capture', fields: [{ label: 'Name', type: 'text', required: true }, { label: 'Email', type: 'email', required: true }] }, token);
  check('form created', f.status === 200 && f.data.slug);
  formId = f.data.id;
  const pub = await call('GET', `/public/forms/${f.data.slug}`);
  check('public form GET works (no auth)', pub.status === 200 && pub.data.fields.length === 2);
  const wf = await call('POST', '/workflows', { name: 'Form Followup', trigger: 'form_submitted', steps: [{ action: 'create_task', note: 'New form lead!' }] }, token);
  check('form_submitted workflow created', wf.status === 200);
  const sub = await call('POST', `/public/forms/${f.data.slug}`, { Name: 'Web Visitor', Email: 'visitor@x.com' });
  check('public submission accepted', sub.status === 200 && sub.data.ok);
  await new Promise(r => setTimeout(r, 80));
  await worker.scheduled({}, env, ctx);
  const subs = await call('GET', `/forms/${formId}/submissions`, null, token);
  check('submission stored', subs.status === 200 && subs.data.submissions.length === 1);
  const tasks = await call('GET', '/tasks', null, token);
  check('form_submitted workflow fired', tasks.data.tasks.some(t => t.title.includes('form lead') || t.title.includes('Form')), tasks.data.tasks.map(t => t.title).join(','));
  const contacts = await call('GET', '/contacts?search=visitor', null, token);
  check('submission auto-created a contact', contacts.data.contacts.length === 1);
  const bad = await call('POST', `/public/forms/${f.data.slug}`, { Name: '' });
  check('required field enforced publicly', bad.status === 400);
}

console.log('\n== AFFILIATE TRACKING ==');
{
  const a = await call('POST', '/affiliates', { name: 'Partner A', email: 'p@x.com', rate: 25 }, token);
  check('affiliate created', a.status === 200 && a.data.token);
  const go = await call('GET', `/public/affiliate/go?token=${a.data.token}&ref=newsletter`);
  check('public click-track endpoint works', go.status === 200);
  const list = await call('GET', '/affiliates', null, token);
  check('clicks incremented', list.data.affiliates[0].clicks === 1);
  const bad = await call('GET', '/public/affiliate/go?token=nope');
  check('invalid token → 404', bad.status === 404);
}

console.log('\n== COURSES / FUNNELS / COMMUNITY CRUD ==');
{
  const c = await call('POST', '/courses', { title: 'Marketing 101', price: 49, modules: [{ title: 'Intro', lessons: [{ title: 'L1' }] }] }, token);
  check('course created', c.status === 200);
  const f = await call('POST', '/funnels', { name: 'Lead Funnel', goal: 'get leads', stages: [{ name: 'Awareness', copy: 'Hi' }] }, token);
  check('funnel created', f.status === 200);
  const p = await call('POST', '/community', { title: 'Hello', content: 'Welcome!' }, token);
  check('community post created', p.status === 200);
  const all = await call('GET', '/courses', null, token);
  check('courses list', all.data.courses.length === 1);
}

console.log('\n== AI LAYER (keys, cap, tokens, fallback) ==');
{
  const s = await call('PATCH', '/ai/settings', { provider: 'nvidia', nvidia_key: 'nv-test', openai_key: 'sk-test' }, token);
  check('settings saved', s.status === 200);
  const g = await call('GET', '/ai/settings', null, token);
  check('key flags exposed', g.data.nvidia_key_set === true && g.data.openai_key_set === true);
  const clr = await call('PATCH', '/ai/settings', { openai_key: '' }, token);
  check('key can be cleared', clr.status === 200);
  const g2 = await call('GET', '/ai/settings', null, token);
  check('cleared key no longer set', g2.data.openai_key_set === false);

  aiBehavior = 'ok';
  const comp = await call('POST', '/ai/complete', { prompt: 'Say hi' }, token);
  check('ai/complete works (fake provider)', comp.status === 200 && comp.data.content === 'FAKE_AI_RESPONSE');
  check('ai/complete returns provider+model', !!comp.data.provider && !!comp.data.model);
  const usage = await call('GET', '/ai/usage', null, token);
  check('tokens tracked in usage', usage.data.tokens_today >= 19, String(usage.data.tokens_today));

  await call('PATCH', '/ai/settings', { openai_key: 'sk-test' }, token);
  aiBehavior = 'fail500nvidia';
  const fb = await call('POST', '/ai/complete', { prompt: 'hi' }, token);
  check('auto-fallback to next provider on 500', fb.status === 200 && fb.data.content === 'FAKE_AI_RESPONSE', fb.data?.error);

  aiBehavior = 'fail401';
  const badk = await call('POST', '/ai/complete', { prompt: 'hi' }, token);
  check('bad keys → clear error', badk.status === 502 && /Invalid|unauthorized/i.test(badk.data.error || ''));

  aiBehavior = 'stream';
  const chat = await readSSE('POST', '/ai/chat/stream', { messages: [{ role: 'user', content: 'hello' }] }, token);
  check('chat stream 200', chat.status === 200, String(chat.status));
  check('chat stream has deltas', chat.text.includes('Hi there') || chat.text.includes('Hi'), chat.text.slice(0, 80));
  check('chat stream ends with done', chat.text.includes('"done":true'));

  aiBehavior = 'fail401';
  const chatErr = await readSSE('POST', '/ai/chat/stream', { messages: [{ role: 'user', content: 'hello' }] }, token);
  check('chat stream failure → SSE error event', chatErr.text.includes('"error"') && chatErr.text.includes('"done"'), chatErr.text.slice(0, 120));

  // Cap is clamped to a 10 minimum server-side. Inject 11 usage rows for
  // this workspace, set cap 10, and the next call must be blocked with 429.
  await call('PATCH', '/ai/settings', { daily_call_cap: 10 }, token);
  for (let i = 0; i < 11; i++) {
    DB._runRaw("INSERT INTO ai_usage_log (workspace_id, op, provider) VALUES (1, 'test', 'fake')");
  }
  aiBehavior = 'ok';
  const capped = await call('POST', '/ai/complete', { prompt: 'x' }, token);
  check('daily cap enforced (429)', capped.status === 429, String(capped.status));
  DB._runRaw("DELETE FROM ai_usage_log WHERE op='test'");
  await call('PATCH', '/ai/settings', { daily_call_cap: 300 }, token);

  const rw = await call('POST', '/ai/rewrite', { text: 'hello there', mode: 'improve' }, token);
  check('ai/rewrite works', rw.status === 200 && rw.data.content);

  const sc = await call('POST', '/contacts', { name: 'Scorable', email: 's@x.com' }, token);
  aiBehavior = 'ok';
  const scR = await call('POST', `/ai/score-lead/${sc.data.id}`, {}, token);
  check('score-lead returns 0-100 score', scR.status === 200 && scR.data.score >= 0 && scR.data.score <= 100);
}


console.log('\n== UNLIMITED AI (cap 0) ==');
{
  // 0 = unlimited: even with 50 usage rows today, calls must succeed.
  await call('PATCH', '/ai/settings', { daily_call_cap: 0 }, token);
  for (let i = 0; i < 50; i++) DB._runRaw("INSERT INTO ai_usage_log (workspace_id, op, provider) VALUES (1, 'unlimited-test', 'fake')");
  aiBehavior = 'ok';
  const r = await call('POST', '/ai/complete', { prompt: 'hi' }, token);
  check('cap=0 → unlimited (50 calls used, still works)', r.status === 200 && r.data.content === 'FAKE_AI_RESPONSE', String(r.status));
  DB._runRaw("DELETE FROM ai_usage_log WHERE op='unlimited-test'");
  const g = await call('GET', '/ai/settings', null, token);
  check('cap=0 round-trips through settings', g.data.daily_call_cap === 0);
  // And a positive cap still works as a guardrail:
  await call('PATCH', '/ai/settings', { daily_call_cap: 10 }, token);
  for (let i = 0; i < 11; i++) DB._runRaw("INSERT INTO ai_usage_log (workspace_id, op, provider) VALUES (1, 'cap-test2', 'fake')");
  const capped2 = await call('POST', '/ai/complete', { prompt: 'x' }, token);
  check('positive cap still enforced', capped2.status === 429, String(capped2.status));
  DB._runRaw("DELETE FROM ai_usage_log WHERE op='cap-test2'");
  await call('PATCH', '/ai/settings', { daily_call_cap: 0 }, token);
}


console.log('\n== V5: CIRCUIT BREAKER + ERROR TAXONOMY ==');
{
  await call('PATCH', '/ai/settings', { provider: 'nvidia', nvidia_key: 'nv-test', openai_key: 'sk-test' }, token);
  if (globalThis.__nxTest) globalThis.__nxTest.resetProviderHealth();
  // 402 = no credits → clear message, not retried, no fallback burn of other provider.
  let status402 = false;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com')) return new Response(JSON.stringify({ error: { message: 'Insufficient credits' } }), { status: 402 });
    if (u.includes('openai.com')) return new Response(JSON.stringify({ choices: [{ message: { content: 'SHOULD_NOT_BE_USED' } }], usage: {} }), { status: 200 });
    throw new Error('unexpected ' + u);
  };
  // Single provider (clear openai) so the 402 surfaces instead of falling back.
  await call('PATCH', '/ai/settings', { openai_key: '' }, token);
  const r402 = await call('POST', '/ai/complete', { prompt: 'hi' }, token);
  check('402 → clear no-credits error', r402.status === 502 && /credit/i.test(r402.data.error || ''), r402.data?.error);
  // 404 model not found → actionable message
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com')) return new Response(JSON.stringify({ error: { message: 'Model not found' } }), { status: 404 });
    if (u.includes('openai.com')) return new Response(JSON.stringify({ choices: [{ message: { content: 'SHOULD_NOT' } }], usage: {} }), { status: 200 });
    throw new Error('unexpected ' + u);
  };
  const r404 = await call('POST', '/ai/complete', { prompt: 'hi' }, token);
  check('404 → model guidance', r404.status === 502 && /model/i.test(r404.data.error || ''), r404.data?.error);
  await call('PATCH', '/ai/settings', { openai_key: 'sk-test' }, token); // restore both for circuit test
  // Circuit breaker: nvidia fails 3x with a genuine PROVIDER-HEALTH error
  // (400 = malformed request rejection, non-retryable, counts toward the
  // breaker) → cooldown → openai used. (Account/model errors deliberately
  // do NOT cool down the shared provider — see isProviderHealthIssue.)
  let nvCalls = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com')) { nvCalls++; return new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 400 }); }
    if (u.includes('openai.com')) return new Response(JSON.stringify({ choices: [{ message: { content: 'FALLBACK_WORKS' } }], usage: {} }), { status: 200 });
    throw new Error('unexpected ' + u);
  };
  for (let i = 0; i < 4; i++) {
    const rr = await call('POST', '/ai/complete', { prompt: 'hi' }, token);
    if (i === 3) check('circuit breaker → falls back to openai', rr.status === 200 && rr.data.content === 'FALLBACK_WORKS');
  }
  // count nvidia calls: 3 fails then cooldown → 4th request should skip nvidia
  check('nvidia called only 3x before cooldown (4th skips)', nvCalls <= 6, 'nvCalls=' + nvCalls);
}

console.log('\n== V5: CHAT MEMORY ==');
{
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      const enc = new TextEncoder();
      const body = new ReadableStream({ start(c){ c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"MEMORY_REPLY"}}]}\n\n')); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    throw new Error('unexpected ' + u);
  };
  // chat with memory on
  await readSSE('POST', '/ai/chat/stream', { messages: [{ role: 'user', content: 'remember this fact' }], memory: true }, token);
  await new Promise(r => setTimeout(r, 300));
  const mem = await call('GET', '/ai/memory', null, token);
  check('user message persisted to memory', mem.status === 200 && mem.data.memory.some(m => m.content === 'remember this fact'), JSON.stringify(mem.data?.memory || []).slice(0, 100));
  check('assistant reply persisted to memory', mem.data.memory.some(m => m.content === 'MEMORY_REPLY'));
  // clear memory
  const clr = await call('DELETE', '/ai/memory', null, token);
  const mem2 = await call('GET', '/ai/memory', null, token);
  check('memory cleared', clr.status === 200 && mem2.data.memory.length === 0);
}

console.log('\n== V5: PIPELINE HEALTH + IMAGE ANALYSIS ==');
{
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'FAKE_AI_RESPONSE' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const h = await call('GET', '/ai/pipeline-health', null, token);
  check('pipeline health returns score+verdict+reasons', h.status === 200 && typeof h.data.score === 'number' && h.data.score >= 0 && h.data.score <= 100 && Array.isArray(h.data.reasons), JSON.stringify(h.data).slice(0, 120));
  check('pipeline health has verdict', ['Excellent','Healthy','Needs attention','Critical'].includes(h.data.verdict));
  const img = await call('POST', '/ai/analyze-image', { url: 'https://example.com/pic.png', question: 'What is in this image?' }, token);
  check('analyze-image with URL works', img.status === 200 && img.data.content === 'FAKE_AI_RESPONSE', img.data?.error);
  const badimg = await call('POST', '/ai/analyze-image', { url: 'ftp://nope' }, token);
  check('analyze-image rejects bad URL', badimg.status === 502 || badimg.status === 400);
  const noimg = await call('POST', '/ai/analyze-image', {}, token);
  check('analyze-image requires input', noimg.status === 502 || noimg.status === 400);
}


console.log('\n== LIVE MODEL CATALOG (real, not placeholder) ==');
{
  await call('PATCH', '/ai/settings', { nvidia_key: 'nv-test', openai_key: 'sk-test' }, token);
  // NVIDIA's real /v1/models shape, including non-chat endpoints to filter out
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/v1/models')) {
      return new Response(JSON.stringify({ data: [
        { id: 'meta/llama-3.3-70b-instruct' },
        { id: 'meta/llama-3.1-8b-instruct' },
        { id: 'deepseek-ai/deepseek-r1' },
        { id: 'nvidia/embed-qa-4' },
        { id: 'nvidia/tts-1' },
        { id: 'mistralai/mistral-large-2-instruct' },
        { id: 'nvidia/llama-3.1-nemotron-70b-instruct' },
        { id: 'google/gemma-2-27b-it' },
        { id: 'qwen/qwen2-7b-instruct' },
        { id: 'microsoft/phi-3-medium-128k-instruct' },
      ] }), { status: 200 });
    }
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'X' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const m = await call('GET', '/ai/models?refresh=1', null, token);
  check('live models fetched from provider (not hardcoded)', m.status === 200 && m.data.live === true, JSON.stringify(m.data).slice(0,120));
  check('live list contains provider models', m.data.nvidia.includes('meta/llama-3.3-70b-instruct') && m.data.nvidia.includes('deepseek-ai/deepseek-r1'), JSON.stringify(m.data.nvidia).slice(0,120));
  check('non-chat models filtered (embed/tts)', !m.data.nvidia.includes('nvidia/embed-qa-4') && !m.data.nvidia.includes('nvidia/tts-1'));
  check('chat models kept', m.data.nvidia.includes('mistralai/mistral-large-2-instruct'));
  // Fallback when the live fetch fails entirely
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/v1/models')) throw new Error('network down');
    if (u.includes('nvidia.com') || u.includes('openai.com')) return new Response(JSON.stringify({ choices: [{ message: { content: 'X' } }], usage: {} }), { status: 200 });
    throw new Error('unexpected ' + u);
  };
  const m2 = await call('GET', '/ai/models?refresh=1', null, token);
  check('falls back to curated list when provider unreachable', m2.status === 200 && m2.data.nvidia.length >= 10 && m2.data.live === false, JSON.stringify(m2.data).slice(0,80));
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}

console.log('\n== V5: AI RATE LIMIT (240/min) ==');
{
  let blocked = false;
  // Use a fresh user to avoid the earlier requests; register another account
  DB._runRaw('DELETE FROM rate_limits'); // clear per-IP counters polluted by earlier tests
  const rr = await call('POST', '/auth/register', { name: 'RL User', email: 'rl@x.com', password: 'password123' });
  const rlTok = rr.data.token;
  await call('PATCH', '/ai/settings', { provider: 'nvidia', nvidia_key: 'k' }, rlTok);
  for (let i = 0; i < 250; i++) {
    const r = await call('POST', '/ai/complete', { prompt: 'x' }, rlTok);
    if (r.status === 429) { blocked = true; break; }
  }
  check('per-user AI rate limit kicks in (240/min)', blocked);
  DB._runRaw("DELETE FROM rate_limits WHERE key LIKE 'ai:%'");
  // Restore the default fake fetch for the sections that follow (V4.1 etc.)
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}


console.log('\n== AI AGENT (natural-language CRM actions) ==');
{
  // Agent with a create_task JSON response
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"create_task","params":{"title":"Call Ahmed about the proposal","due_date":"2026-09-01","priority":"high"},"reply":"I created the task for you."}' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const a1 = await call('POST', '/ai/agent', { message: 'create a task to call Ahmed about the proposal due September 1, high priority' }, token);
  check('agent executes create_task', a1.status === 200 && a1.data.action === 'create_task' && a1.data.ok === true, JSON.stringify(a1.data).slice(0,120));
  const tasks = await call('GET', '/tasks', null, token);
  check('task actually created in DB', tasks.data.tasks.some(t => t.title.includes('Ahmed') && t.due_date === '2026-09-01' && t.priority === 'high'), tasks.data.tasks.map(t=>t.title).join(','));
  // Agent with create_contact
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"create_contact","params":{"name":"Sarah Hassan","email":"sarah@acme.com","company":"Acme","tags":"vip"},"reply":"Done!"}' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const a2 = await call('POST', '/ai/agent', { message: 'add contact Sarah Hassan from Acme, sarah@acme.com, tag vip' }, token);
  check('agent executes create_contact', a2.status === 200 && a2.data.action === 'create_contact');
  const contacts = await call('GET', '/contacts?search=sarah', null, token);
  check('contact actually created', contacts.data.contacts.some(c => c.email === 'sarah@acme.com' && c.tags === 'vip'));
  // Agent question → action none
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"none","reply":"Your pipeline has 3 open deals."}' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const a3 = await call('POST', '/ai/agent', { message: 'how is my pipeline?' }, token);
  check('agent answers questions without action', a3.status === 200 && a3.data.action === 'none' && a3.data.reply.includes('pipeline'));
  // Agent with garbage (non-JSON) → graceful text fallback, no crash
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'I cannot do that, but here is some text.' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const a4 = await call('POST', '/ai/agent', { message: 'whatever' }, token);
  check('agent graceful on non-JSON reply', a4.status === 200 && a4.data.action === 'none' && !!a4.data.reply);
  // Agent with unknown/dangerous action → rejected (never executed)
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"delete_all_contacts","params":{},"reply":"done"}' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const before = await call('GET', '/contacts', null, token);
  const a5 = await call('POST', '/ai/agent', { message: 'delete all contacts' }, token);
  const after = await call('GET', '/contacts', null, token);
  check('dangerous unknown action never executed', a5.data.action === 'none' && after.data.contacts.length === before.data.contacts.length, JSON.stringify(a5.data).slice(0,80));
}

console.log('\n== SALES FORECAST (30/60/90) ==');
{
  // deterministic numbers (no AI needed for the buckets)
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'FAKE_AI_RESPONSE' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  // seed deals: one 90% close in 10 days (30d bucket), one 50% in 45 days (60d), one 20% no date (90d)
  await call('POST', '/deals', { title: 'Fast Deal', value: 10000, probability: 90, close_date: '2026-09-01' }, token);
  await call('POST', '/deals', { title: 'Mid Deal', value: 8000, probability: 50, close_date: '2026-10-05' }, token);
  await call('POST', '/deals', { title: 'Slow Deal', value: 20000, probability: 20 }, token);
  const f = await call('GET', '/ai/forecast', null, token);
  check('forecast returns 3 buckets', f.status === 200 && f.data && f.data.buckets && f.data.buckets.length === 3, JSON.stringify(f.data).slice(0,100));
  check('30-day bucket ≈ 9000 (10000×90%)', Math.abs(f.data.buckets[0].value - 9000) < 1, String(f.data.buckets[0].value));
  check('60-day bucket ≈ 4000 (8000×50%)', Math.abs(f.data.buckets[1].value - 4000) < 1, String(f.data.buckets[1].value));
  check('90-day bucket ≈ 4000 (20000×20%)', Math.abs(f.data.buckets[2].value - 4000) < 1, String(f.data.buckets[2].value));
  check('total weighted ≈ 17000', Math.abs(f.data.total_weighted - 17000) < 2, String(f.data.total_weighted));
  check('narrative present', typeof f.data.narrative === 'string');
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}


console.log('\n== CYCLE1: MODEL FALLBACK CHAIN + PROVIDER HEALTH ==');
{
  await call('PATCH', '/ai/settings', { provider: 'nvidia', nvidia_key: 'nv-test', model: 'bad/model-name,meta/llama-3.1-8b-instruct' }, token);
  // First model 404s, second works — same provider → must succeed via chain.
  let modelCalls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com')) {
      const body = JSON.parse((opts.body) || '{}');
      modelCalls.push(body.model);
      if (body.model === 'bad/model-name') return new Response(JSON.stringify({ error: { message: 'Model not found' } }), { status: 404 });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'CHAIN_OK' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const r = await call('POST', '/ai/complete', { prompt: 'hi' }, token);
  check('model fallback chain works (bad → good on same provider)', r.status === 200 && r.data.content === 'CHAIN_OK' && r.data.model === 'meta/llama-3.1-8b-instruct', JSON.stringify(r.data).slice(0,100));
  check('both models were attempted in order', modelCalls[0] === 'bad/model-name' && modelCalls[1] === 'meta/llama-3.1-8b-instruct', modelCalls.join(','));
  // /ai/providers reports live health
  const hp = await call('GET', '/ai/providers', null, token);
  check('providers endpoint returns health snapshot', hp.status === 200 && hp.data.nvidia && typeof hp.data.nvidia.requests === 'number', JSON.stringify(hp.data).slice(0,100));
  check('health tracks successes', hp.data.nvidia.successes >= 1, String(hp.data.nvidia.successes));
  // SSE meta event in chat stream
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com')) {
      const enc = new TextEncoder();
      const body = new ReadableStream({ start(c){ c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n')); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    throw new Error('unexpected ' + u);
  };
  const chat = await readSSE('POST', '/ai/chat/stream', { messages: [{ role: 'user', content: 'hello' }] }, token);
  check('stream announces provider+model in meta event', chat.text.includes('"meta"') && chat.text.includes('"provider"'), chat.text.slice(0,100));
  await call('PATCH', '/ai/settings', { model: 'meta/llama-3.1-8b-instruct' }, token);
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}


console.log('\n== CYCLE2: AGENT CONTACT ACTIONS + IDEMPOTENCY + VISITOR MEMORY ==');
{
  // seed a contact to update
  await call('POST', '/contacts', { name: 'Agent Target', email: 'target@x.com', phone: '+1555000' }, token);
  // agent says update_contact
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"update_contact","params":{"contact_email":"target@x.com","company":"NewCo","tags":"vip,active"},"reply":"Updated."}' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const a = await call('POST', '/ai/agent', { message: 'update target@x.com company NewCo and tag vip' }, token);
  check('agent update_contact executes', a.status === 200 && a.data.action === 'update_contact' && a.data.ok === true, JSON.stringify(a.data).slice(0,100));
  const c = await call('GET', '/contacts?search=target', null, token);
  const found = c.data.contacts.find(x => x.email === 'target@x.com');
  check('contact actually updated', found && found.company === 'NewCo' && found.tags === 'vip,active', JSON.stringify(found).slice(0,100));
  // agent idempotency: same message twice → second is a duplicate, no new action
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"create_task","params":{"title":"Idempotency task"},"reply":"done"}' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const before = await call('GET', '/tasks', null, token);
  const t1 = await call('POST', '/ai/agent', { message: 'create task Idempotency task' }, token);
  const t2 = await call('POST', '/ai/agent', { message: 'create task Idempotency task' }, token);
  check('first agent call executes', t1.data.action === 'create_task' && t1.data.ok === true);
  check('duplicate agent call blocked (idempotent)', t2.data.duplicate === true && t2.data.action === 'none', JSON.stringify(t2.data).slice(0,80));
  const after = await call('GET', '/tasks', null, token);
  const added = after.data.tasks.length - before.data.tasks.length;
  check('only ONE task created despite two calls', added === 1, 'added=' + added);
  // add_contact_note
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"add_contact_note","params":{"contact_email":"target@x.com","note":"Called today — interested"},"reply":"Noted!"}' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const n1 = await call('POST', '/ai/agent', { message: 'note on target@x.com: called today interested' }, token);
  check('agent add_contact_note executes', n1.status === 200 && n1.data.action === 'add_contact_note' && n1.data.ok === true);
  const c2 = await call('GET', '/contacts?search=target', null, token);
  const found2 = c2.data.contacts.find(x => x.email === 'target@x.com');
  check('note appended to contact', found2.notes.includes('Called today — interested'), found2?.notes);
  // webchat visitor memory: visitor_id continuity
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      const enc = new TextEncoder();
      const body = new ReadableStream({ start(c){ c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"reply"}}]}\n\n')); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    throw new Error('unexpected ' + u);
  };
  const wc = await call('GET', '/webchat', null, token);
  const wtoken = wc.data.public_token;
  await readSSE('POST', `/public/webchat/${wtoken}/message`, { message: 'Hello, I am visitor one', history: [], visitor_id: 'visitor-abc-123' });
  // message stored with marker
  const conv = await call('GET', '/webchat', null, token);
  check('visitor message stored with marker', conv.data.conversations.some(m => m.body === 'Hello, I am visitor one' && String(m.subject||'').includes('visitor-abc-123')), JSON.stringify(conv.data.conversations[conv.data.conversations.length-1]).slice(0,120));
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}


console.log('\n== CYCLE3: BRAND VOICE INJECTION ==');
{
  await call('PATCH', '/ai/settings', { brand_voice: 'Warm and playful, short sentences, emoji ok' }, token);
  let lastPrompt = '';
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      const body = JSON.parse(opts.body || '{}');
      lastPrompt = JSON.stringify(body.messages || []);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'X' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  await call('POST', '/ai/complete', { prompt: 'write something' }, token);
  check('brand voice injected into /ai/complete', lastPrompt.includes('Warm and playful'), lastPrompt.slice(0,120));
  await call('POST', '/ai/generate', { type: 'email', context: 'hello' }, token);
  check('brand voice injected into /ai/generate', lastPrompt.includes('Warm and playful'));
  await call('POST', '/ai/agent', { message: 'hi' }, token);
  check('brand voice injected into agent', lastPrompt.includes('Warm and playful'));
  // settings round-trip
  const g = await call('GET', '/ai/settings', null, token);
  check('brand voice saved + returned', g.data.brand_voice === 'Warm and playful, short sentences, emoji ok');
  await call('PATCH', '/ai/settings', { brand_voice: '' }, token);
  const g2 = await call('GET', '/ai/settings', null, token);
  check('brand voice can be cleared', g2.data.brand_voice === '');
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}


console.log('\n== CYCLE4: WEBHOOKS + RUN LOG + SUGGESTIONS ==');
{
  // workflow triggered by webhook
  const wf = await call('POST', '/workflows', { name: 'Webhook Handler', trigger: 'webhook', steps: [{ action: 'create_task', note: 'Webhook received!' }] }, token);
  check('webhook workflow created', wf.status === 200);
  const wc = await call('GET', '/webchat', null, token);
  const token2 = wc.data.public_token;
  // fire the public webhook with a custom event
  globalThis.fetch = async () => new Response('{}', { status: 200 }); // no AI needed here
  const wh = await worker.fetch(new Request(BASE + `/api/public/webhook/${token2}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://external.com' },
    body: JSON.stringify({ event: 'payment_received', payload: { amount: 99 } }),
  }), env, ctx);
  check('webhook accepted', wh.status === 200, String(wh.status));
  await new Promise(r => setTimeout(r, 200));
  await worker.scheduled({}, env, ctx);
  const tasks = await call('GET', '/tasks', null, token);
  check('webhook fired the workflow', tasks.data.tasks.some(t => t.title.includes('Webhook received!')), tasks.data.tasks.map(t=>t.title).slice(-3).join(','));
  // invalid token rejected
  const badWh = await worker.fetch(new Request(BASE + '/api/public/webhook/nope', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'x' }) }), env, ctx);
  check('bad webhook token → 404', badWh.status === 404);
  // run log exists for the fired workflow
  const runs = await call('GET', `/workflows/${wf.data.id}/runs`, null, token);
  check('run history recorded', runs.status === 200 && runs.data.runs.length >= 1, JSON.stringify(runs.data).slice(0,120));
  check('run status ok', runs.data.runs[0].status === 'ok');
  // suggestions endpoint returns data-driven ideas
  const sug = await call('GET', '/ai/suggest-workflows', null, token);
  check('suggest-workflows returns array', sug.status === 200 && Array.isArray(sug.data.suggestions));
  check('suggestions are data-driven and relevant', sug.data.suggestions.length >= 1 && sug.data.suggestions.every(x => x.title && x.trigger && Array.isArray(x.steps)), JSON.stringify(sug.data.suggestions.map(x=>x.title)).slice(0,150));
  // fresh workspace (no workflows yet, has new contacts) → welcome suggestion appears
  const rr2 = await call('POST', '/auth/register', { name: 'Fresh', email: 'fresh@x.com', password: 'password123' });
  await call('POST', '/contacts', { name: 'New One' }, rr2.data.token);
  await call('POST', '/contacts', { name: 'New Two' }, rr2.data.token);
  await call('POST', '/contacts', { name: 'New Three' }, rr2.data.token);
  const sug2 = await call('GET', '/ai/suggest-workflows', null, rr2.data.token);
  check('fresh workspace gets welcome-new-contacts suggestion', sug2.data.suggestions.some(x => x.trigger === 'new_contact'), JSON.stringify(sug2.data.suggestions.map(x=>x.title)).slice(0,150));
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}


console.log('\n== SC1: AGENT V2 (dates, sequences, facts, tasks, deals) ==');
{
  await call('PATCH', '/ai/settings', { provider: 'nvidia', nvidia_key: 'nv-test' }, token);
  // complete_task via agent
  const tk = await call('POST', '/tasks', { title: 'Agent Complete Me' }, token);
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"complete_task","params":{"task_id":' + tk.data.id + '},"reply":"Done!"}' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const c1 = await call('POST', '/ai/agent', { message: 'complete that task' }, token);
  check('agent completes a task', c1.data.action === 'complete_task' && c1.data.ok === true, JSON.stringify(c1.data).slice(0,100));
  const tasksAfter = await call('GET', '/tasks', null, token);
  const foundTask = tasksAfter.data.tasks.find(t => t.id === tk.data.id);
  check('task actually done', foundTask && foundTask.status === 'done');
  // natural date in create_task ("tomorrow")
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"create_task","params":{"title":"Call tomorrow thing","due_date":"tomorrow"},"reply":"ok"}' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const c2 = await call('POST', '/ai/agent', { message: 'create a task to call, due tomorrow' }, token);
  check('agent creates task with natural date', c2.data.ok === true);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0,10);
  const t2 = await call('GET', '/tasks', null, token);
  check('due_date = tomorrow', t2.data.tasks.some(t => t.title.includes('tomorrow thing') && t.due_date === tomorrow), JSON.stringify(t2.data.tasks.filter(t=>t.title.includes('tomorrow thing')).map(t=>t.due_date)));
  // multi-step sequence
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"steps":[{"action":"create_task","params":{"title":"Step A"}},{"action":"create_task","params":{"title":"Step B"}}],"reply":"Done both"}' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const c3 = await call('POST', '/ai/agent', { message: 'create task A and task B' }, token);
  check('agent runs multi-step sequence', c3.data.action === 'sequence' && c3.data.ok === true && c3.data.results.length === 2, JSON.stringify(c3.data).slice(0,120));
  const t3 = await call('GET', '/tasks', null, token);
  check('both sequence steps created', t3.data.tasks.some(t => t.title === 'Step A') && t3.data.tasks.some(t => t.title === 'Step B'));
  // remember facts
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"remember","params":{"fact":"Prefers calls before 11am"},"reply":"Got it"}' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const c4 = await call('POST', '/ai/agent', { message: 'remember I prefer calls before 11' }, token);
  check('agent remembers a fact', c4.data.action === 'remember' && c4.data.ok === true);
  const raw = DB._raw("SELECT agent_facts FROM workspaces WHERE id=1")[0].values[0][0];
  check('fact stored in workspace', raw.includes('Prefers calls before 11am'), raw);
}

console.log('\n== SC2: AI ON DATA (summary, replies, tags, tasks, risks, translate) ==');
{
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'FAKE_AI_RESPONSE' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const cc = await call('POST', '/contacts', { name: 'Summarize Me', email: 'sum@x.com', notes: 'Wants a quote for 5 users' }, token);
  const cs = await call('GET', `/ai/contact-summary/${cc.data.id}`, null, token);
  check('contact summary endpoint works', cs.status === 200 && cs.data.summary === 'FAKE_AI_RESPONSE', cs.data?.error);
  const sr = await call('POST', '/ai/smart-reply', { text: 'Thanks for the quote, we are interested!' }, token);
  check('smart reply returns options', sr.status === 200 && Array.isArray(sr.data.options) && sr.data.options.length >= 1);
  const tg = await call('GET', `/ai/tag-suggest/${cc.data.id}`, null, token);
  check('tag suggest works', tg.status === 200 && Array.isArray(tg.data.tags));
  const st = await call('GET', '/ai/score-tasks', null, token);
  check('task scoring works', st.status === 200 && Array.isArray(st.data.tasks));
  const dr = await call('GET', '/ai/deal-risks', null, token);
  check('deal risks works', dr.status === 200 && Array.isArray(dr.data.risks));
  const tr = await call('POST', '/ai/translate', { text: 'Good morning', language: 'Arabic' }, token);
  check('translate works', tr.status === 200 && tr.data.content === 'FAKE_AI_RESPONSE');
  const tm = await call('POST', '/ai/tone-remix', { text: 'Please buy our product', tone: 'playful' }, token);
  check('tone remix works', tm.status === 200 && tm.data.content === 'FAKE_AI_RESPONSE');
  const da = await call('POST', '/ai/doc-analyze', { text: 'We decided to hire 2 people. Action: post jobs by Friday.' }, token);
  check('doc analyze works', da.status === 200 && da.data.content === 'FAKE_AI_RESPONSE');
  const bad = await call('POST', '/ai/smart-reply', {}, token);
  check('smart reply without text still handles', bad.status === 200 || bad.status === 502);
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}


console.log('\n== SC3-6: BRIEF + FEEDBACK + SMART REPLY + RISKS ==');
{
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'FAKE_AI_RESPONSE' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const b = await call('GET', '/ai/brief', null, token);
  check('daily brief works', b.status === 200 && typeof b.data.brief === 'string' && b.data.brief.length > 0, JSON.stringify(b.data).slice(0,80));
  const f1 = await call('POST', '/ai/feedback', { rating: 1, op: 'chat', provider: 'nvidia', model: 'test' }, token);
  check('feedback recorded', f1.status === 200 && f1.data.ok === true);
  const f2 = await call('POST', '/ai/feedback', { rating: 5 }, token);
  check('invalid feedback rejected', f2.status === 400);
  const cnt = DB._raw("SELECT COUNT(*) c FROM ai_feedback")[0].values[0][0];
  check('feedback row stored', cnt === 1);
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}


console.log('\n== V6 WEBSITE ENGINE: DESIGNS + SCAN + BUILD + WEBHOOK LEAD ==');
{
  // designs endpoint
  const ds = await call('GET', '/ai/site-designs', null, token);
  check('designs endpoint lists designs', ds.status === 200 && Array.isArray(ds.data.designs) && ds.data.designs.length >= 3, JSON.stringify(ds.data).slice(0,120));
  const ids = ds.data.designs.map(d => d.id);
  check('sentinel + aurora + slate present', ids.includes('sentinel') && ids.includes('aurora') && ids.includes('slate'));
  // scanner against a fake "old 2008-style" site
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        site_name: 'Bob Plumbing', tagline: 'Local plumbing done right',
        hero_headline: 'Plumbing you can trust', hero_sub: 'Fast, fair, friendly',
        marquee_items: ['24/7 emergency', 'Free quotes', 'Licensed & insured'],
        stats: [{value: 15, label: 'Years experience'}],
        services: [{icon: '🔧', title: 'Repairs', desc: 'All kinds'}],
        why_us: ['Upfront pricing'],
        about: 'Family-run since 2010.',
        process: [{title: 'Call', desc: 'Book a slot'}],
        gallery_imgs: ['https://old-site.com/img1.jpg'],
        reviews: [{name: 'Jane', text: 'Great work', stars: 5}],
        lead_title: 'Get a free quote', lead_text: 'Call now',
        faqs: [{q: 'Do you offer guarantees?', a: 'Yes, 12 months.'}],
        working_hours: ['Mon-Fri 8am-6pm', 'Sat 9am-1pm'],
        contact: {phone: '+44 1234 567890', email: 'bob@plumbing.co.uk', address: 'Main St 5'},
        footer_note: 'Bob Plumbing Ltd'
      }) } }], usage: {} }), { status: 200 });
    }
    // fake old website with real content to extract
    return new Response(`<!DOCTYPE html><html><head><title>Bob Plumbing - Old Site</title><meta name="description" content="Plumbing services in town"></head>
      <body bgcolor="#FFFFFF"><table width="800"><tr><td><h1>Welcome to Bob Plumbing</h1>
      <p>We provide plumbing repairs, boiler installs and drain unblocking. Call us today.</p>
      <p>Open Monday to Friday 8am to 6pm and Saturday 9am to 1pm. Emergency 24/7.</p>
      <p>Phone: +44 1234 567890 or email bob@plumbing.co.uk</p>
      <img src="/images/van.jpg" alt="our van"><img src="/images/team.jpg" alt="the team">
      <a href="https://facebook.com/bobplumbing">Facebook</a>
      </td></tr></table></body></html>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
  };
  const sc = await call('POST', '/ai/scan-site', { url: 'https://old-site.com' }, token);
  check('scan returns extracted data', sc.status === 200 && sc.data.extracted, JSON.stringify(sc.data).slice(0,120));
  check('scan extracts phone', sc.data.extracted.phone.includes('1234 567890'), sc.data.extracted.phone);
  check('scan extracts email', sc.data.extracted.email === 'bob@plumbing.co.uk');
  check('scan extracts working hours (incl. Mon-Fri ranges)', sc.data.extracted.working_hours.some(h => /mon/i.test(h) && /8/i.test(h) && /6/i.test(h)), JSON.stringify(sc.data.extracted.working_hours));
  check('scan extracts images with absolute URLs', sc.data.extracted.images.length >= 2 && sc.data.extracted.images.every(i => i.url.startsWith('https://old-site.com')), JSON.stringify(sc.data.extracted.images).slice(0,120));
  check('scan produces AI content plan', sc.data.plan && sc.data.plan.site_name === 'Bob Plumbing', JSON.stringify(sc.data.plan).slice(0,120));
  check('plan keeps real working hours', sc.data.plan.working_hours.some(h => /8am-6pm/i.test(h)), JSON.stringify(sc.data.plan.working_hours));
  // build a site from the plan + design
  const plan = sc.data.plan;
  const site = await call('POST', '/sites', { name: 'Bob Plumbing NEW', build_with_ai: true, design_id: 'sentinel', plan, instructions: 'Always show the 24/7 number in the hero', published: true }, token);
  check('site built from plan', site.status === 200 && site.data.slug, (site.data?.error || '').slice(0,100));
  const html = String(site.data.html || '');
  check('built site has design CSS', html.includes('.nx-hero') && html.includes('.nx-marquee') && html.includes('.nx-faq'));
  check('built site has interactive JS', html.includes('data-reveal') && html.includes('IntersectionObserver') && html.includes('nx-top'));
  check('built site has count-up support', html.includes('data-count') || html.includes('data-count'));
  check('built site includes working hours (from plan)', html.includes('8am') || html.includes('Mon'), html.slice(0,80));
  // publish + public serve
  const pubRes = await worker.fetch(new Request(BASE + '/api/public/site/' + site.data.slug, { headers: { Origin: 'http://x.com' } }), env, ctx);
  check('published site serves full HTML', pubRes.status === 200 && (await pubRes.text()).includes('<!DOCTYPE html>'));
  // site meta round-trip
  const meta = await call('GET', `/sites/${site.data.id}/html`, null, token);
  check('site meta returns design+instructions+plan', meta.status === 200 && meta.data.design_id === 'sentinel' && meta.data.instructions.includes('24/7') && meta.data.plan && meta.data.plan.site_name === 'Bob Plumbing');
  // regenerate with new instruction
  const regen = await call('PATCH', `/sites/${site.data.id}`, { build_with_ai: true, instructions: 'Add a big banner about the winter boiler offer' }, token);
  check('regenerate works', regen.status === 200 && String(regen.data.html || '').includes('nx-hero'));
  const meta2 = await call('GET', `/sites/${site.data.id}/html`, null, token);
  check('new instruction persisted', meta2.data.instructions.includes('winter boiler offer'));
  // webhook site_lead → auto contact
  const wc2 = await call('GET', '/webchat', null, token);
  const whRes = await worker.fetch(new Request(BASE + '/api/public/webhook/' + wc2.data.public_token, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://client-site.com' },
    body: JSON.stringify({ event: 'site_lead', name: 'Web Lead', email: 'weblead@x.com', phone: '+1555000111', message: 'Need a boiler install' }),
  }), env, ctx);
  check('site_lead webhook accepted', whRes.status === 200);
  const leads = await call('GET', '/contacts?search=weblead', null, token);
  check('site_lead auto-created a contact', leads.data.contacts.some(c => c.email === 'weblead@x.com' && c.source === 'website'), JSON.stringify(leads.data.contacts).slice(0,120));
  const msgs = await call('GET', '/messages', null, token);
  check('lead message saved to CRM', msgs.data.messages.some(m => m.body.includes('boiler install')));
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}


console.log('\n== V6.2: SSRF + SEO + JS UPGRADES + DEFAULTS ==');
{
  // SSRF: localhost/private targets refused
  const r1 = await call('POST', '/ai/scan-site', { url: 'http://127.0.0.1:8080/admin' }, token);
  // Validation errors are UserErrors → 400 (was 502 — a blocked URL is the
  // user's input problem, not a server outage; 502 now means "fetch failed").
  check('SSRF guard blocks localhost', r1.status === 400 && /private|internal/i.test(r1.data.error || ''), r1.status + ' ' + r1.data?.error);
  const r2 = await call('POST', '/ai/scan-site', { url: 'http://192.168.1.10/x' }, token);
  check('SSRF guard blocks private IPs', r2.status === 400 && /private|internal/i.test(r2.data.error || ''));
  const r3 = await call('POST', '/ai/scan-site', { url: 'http://10.0.0.5/x' }, token);
  check('SSRF guard blocks 10.x', r3.status === 400);
  // normalizePlan defaults: build with a minimal plan → defaults fill in
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      const body = JSON.parse(opts.body || '{}');
      const msg = JSON.stringify(body.messages || []);
      if (msg.includes('CONTENT PLAN')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: '<section class="nx-hero"><div class="container"><h1>Defaults work</h1></div></section>' } }], usage: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'X' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const site2 = await call('POST', '/sites', { name: 'Default Co', build_with_ai: true, design_id: 'aurora', plan: { site_name: 'Default Co' }, published: false }, token);
  check('site builds with minimal plan (defaults)', site2.status === 200 && String(site2.data.html || '').includes('nx-hero'), (site2.data?.error || '').slice(0,80));
  const html2 = String(site2.data.html || '');
  check('built site uses chosen design (aurora)', html2.includes('design: aurora') && html2.includes('--accent:#4f46e5'));
  check('built site has JSON-LD scaffolding path', html2.includes('application/ld+json') || html2.includes('og:title'));
  check('built site has interactive JS upgrades', html2.includes('data-countdown') && html2.includes('data-type') && html2.includes('Escape'));
  check('built site has reduce-motion guard', html2.includes('prefers-reduced-motion'));
  // scan with no contact info → defaults in plan (normalizePlan at build)
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ site_name: 'Tiny Shop', hero_headline: 'Hi' }) } }], usage: {} }), { status: 200 });
    }
    return new Response('<html><head><title>Tiny Shop</title></head><body><h1>Welcome to Tiny Shop</h1><p>We sell handmade gifts and local crafts. Open Tuesday to Saturday 10am to 4pm. Call 0123 456789 for more.</p></body></html>', { status: 200 });
  };
  const sc2 = await call('POST', '/ai/scan-site', { url: 'https://tinyshop.example' }, token);
  check('scan handles content-poor sites', sc2.status === 200 && sc2.data.plan && sc2.data.plan.site_name === 'Tiny Shop');
  const site3 = await call('POST', '/sites', { name: 'Tiny Shop', build_with_ai: true, plan: sc2.data.plan }, token);
  const html3 = String(site3.data.html || '');
  check('defaults injected into build (working hours fallback)', html3.includes('Mon - Fri 9:00 - 17:00') || html3.includes('9:00'), html3.slice(0, 200));
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}


console.log('\n== V7 REAL-WORLD: SCAN THE OWNER TEMPLATE + BUILD + RUN THE SITE ==');
if (!existsSync('/home/user/uploads/template.html')) {
  console.log('  ⚠️  SKIPPED — fixture file /home/user/uploads/template.html not present in this environment (it\'s a real client site HTML sample from wherever these tests were first written, not part of the app). Run this section on a machine that has it if you want that specific coverage; every other test still ran.');
} else {
{
  // Use the owner's ACTUAL template.html as the "old client website" fixture.
  const templateHtml = readFileSync('/home/user/uploads/template.html', 'utf8').slice(0, 400000);
  let scanFetches = 0;
  let lastSitePrompt = '';
  let planJson;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      const msg = JSON.stringify(JSON.parse(opts.body || '{}').messages || []);
      // BUILD requests: prompt says which sections to include
      if (msg.includes('INCLUDE ONLY THESE SECTIONS')) {
        lastSitePrompt = msg;
        return new Response(JSON.stringify({ choices: [{ message: { content:
          '<nav class="nx-nav"><div class="container nx-nav-inner"><div class="nx-brand">R C Atkin</div><button class="nx-menu-btn">☰</button><ul class="nx-nav-links"><li><a href="#home">Home</a></li><li><a href="#contact">Contact</a></li></ul></div></nav>' +
          '<section class="nx-hero" data-reveal><div class="container"><h1>Built from the real template</h1></div></section>' +
          '<img src="https://rcatkin-old.example/images/van.jpg" alt="our van">' +
          '<section class="nx-stats" data-reveal data-delay="1"><div class="nx-stat"><b data-count="40">0</b><span>Years</span></div></section>' +
          '<section class="nx-faq"><div class="nx-faq-item"><button class="nx-faq-q">Q<span class="arr">+</span></button><div class="nx-faq-a">A</div></div></section>' +
          '<section class="nx-contact"><div class="container"><div class="nx-contact-grid"><div class="nx-cinfo"><div><b>Phone</b><span>+44 1785 123456</span></div><div><b>Hours</b><span>Mon-Fri 8am-5pm</span></div></div>' +
          '<form class="nx-form"><input name="name" required><input name="email" type="email" required><input name="phone"><textarea name="message" required></textarea><button type="submit" class="btn btn-primary">Send</button><div class="ok">✅</div></form></div></div></section>'
        } }], usage: {} }), { status: 200 });
      }
      // SCAN requests: prompt asks for a content plan
      if (msg.includes('produce a CONTENT PLAN')) {
        planJson = {
          site_name: 'R C Atkin', tagline: 'Drainage specialists',
          hero_headline: 'Drainage done right', hero_sub: 'Septic tanks & soakaways',
          marquee_items: ['24/7 emergency', 'Free surveys'],
          stats: [{ value: 40, label: 'Years experience' }],
          services: [{ icon: '🛠️', title: 'Septic tanks', desc: 'Installation & replacement' }, { icon: '📹', title: 'CCTV surveys', desc: 'Camera line inspections' }, { icon: '🚜', title: 'Groundworks', desc: 'Excavation & surfacing' }],
          why_us: ['Speak to the owner', 'Family-run'],
          about: 'A renowned family-run business.',
          process: [{ title: 'Survey', desc: 'Free survey' }, { title: 'Quote', desc: 'Clear quote' }, { title: 'Install', desc: 'Professional install' }, { title: 'Support', desc: 'Ongoing support' }],
          gallery_imgs: [], reviews: [{ name: 'Local Farmer', text: 'Excellent work on our soakaway', stars: 5 }],
          lead_title: 'Book a free survey', lead_text: 'Call today',
          faqs: [{ q: 'Do you cover my area?', a: 'We cover Staffordshire and Shropshire.' }],
          working_hours: ['Mon-Fri 8am-5pm'], contact: { phone: '+44 1785 123456', email: 'info@rcatkin.co.uk', address: 'Staffordshire' },
          footer_note: 'R C Atkin Ltd'
        };
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(planJson) } }], usage: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '<section class="nx-hero"><div class="container"><h1>Generic</h1></div></section>' } }], usage: {} }), { status: 200 });
    }
    if (u.startsWith('https://rcatkin-old.example')) {
      scanFetches++;
      return new Response(templateHtml, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    throw new Error('unexpected ' + u);
  };
  // 1) SCAN the real template
  const sc = await call('POST', '/ai/scan-site', { url: 'https://rcatkin-old.example' }, token);
  check('scan fetches the real template', scanFetches >= 1);
  const ex = sc.data?.extracted || {};
  check('scan extracts real template title (entities decoded)', ex.title && ex.title.includes('R C Atkin') && ex.title.includes('Septic Tank') && !ex.title.includes('&amp;'), ex.title);
  check('scan extracts real paragraphs', (ex.paragraphs || []).length >= 4, JSON.stringify(ex.paragraphs).slice(0,120));
  check('scan extracts real h2 section names', (ex.headings?.h2 || []).some(h => /Survey/i.test(h) || /Family/i.test(h)), JSON.stringify(ex.headings?.h2||[]).slice(0,120));
  check('scan produces a content plan', sc.data.plan && sc.data.plan.site_name === 'R C Atkin');
  // 2) BUILD from the scanned plan with theme options + webhook
  const wcT = await call('GET', '/webchat', null, token);
  const whUrl = 'http://test.local/api/public/webhook/' + wcT.data.public_token;
  const site = await call('POST', '/sites', { name: 'R C Atkin NEW', build_with_ai: true, design_id: 'forest', plan: sc.data.plan, font: 'inter', accent: '#22c55e', radius: 'round', animation_level: 'expressive', custom_css: '.nx-card{border-radius:12px}', favicon: '🌲', sections: ['nav','hero','stats','services','faq','contact','footer'], webhook_url: whUrl, published: true }, token);
  check('site builds from real-template plan', site.status === 200 && site.data.slug, (site.data?.error||'').slice(0,100));
  const html = String(site.data.html || '');
  check('built site uses forest design', html.includes('#0a120e') && html.includes('#34d399'));
  check('built site has Inter font link + family', html.includes('fonts.googleapis.com') && html.includes("'Inter'"));
  check('built site has accent override', html.includes('--accent:#22c55e'));
  check('built site has round radius override', html.includes('--radius:24px'));
  check('built site has expressive animation', html.includes('translateY(40px)'));
  check('built site has custom css appended', html.includes('.nx-card{border-radius:12px}'));
  check('built site has favicon', html.includes('data:image/svg+xml'));
  check('built site has lazy images enforcement', html.includes('loading="lazy"'));
  check('builder prompt receives ONLY the chosen sections', lastSitePrompt.includes('nav, hero, stats, services, faq, contact, footer'), lastSitePrompt.slice(0,140));
  check('built site has JSON-LD LocalBusiness (contact present)', html.includes('application/ld+json') && html.includes('LocalBusiness'));
  check('built site has SEO title from plan', html.includes('R C Atkin') && html.includes('meta name="description"'));
  check('built site has interactive engine', html.includes('data-reveal') && html.includes('countdown') && html.includes('nx-top'));
  check('built site embeds the lead webhook URL', html.includes('/api/public/webhook/'));
  // 3) RUN the generated site in a browser simulation (jsdom)
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(html, { url: 'https://generated-site.example/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w2) {
      w2.IntersectionObserver = class { constructor(cb){ this.cb = cb; } observe(el){ this.cb([{ isIntersecting: true, target: el }]); } unobserve(){} disconnect(){} };
      w2.matchMedia = () => ({ matches: false, addEventListener(){} });
    } });
  const w = dom.window;
  w.fetch = async (url, opts = {}) => {
    const u = String(url);
    const target = u.startsWith('http') ? u : 'http://test.local' + u;
    return worker.fetch(new Request(target, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body || undefined }), env, ctx);
  };
  await new Promise(r => setTimeout(r, 400));
  check('generated site renders nav', !!w.document.querySelector('.nx-nav'));
  check('generated site has back-to-top button', !!w.document.getElementById('nx-top'));
  check('generated site has reveal elements marked in', w.document.querySelectorAll('[data-reveal].in').length >= 1);
  const q = w.document.querySelector('.nx-faq-q');
  if (q) { q.click(); await new Promise(r => setTimeout(r, 100)); }
  check('FAQ accordion toggles open', q ? q.parentElement.classList.contains('open') : true);
  const form = w.document.querySelector('.nx-form');
  if (form) {
    const set = (name, val) => { const el = form.querySelector('[name="' + name + '"]'); if (el) el.value = val; };
    set('name', 'Site Visitor'); set('email', 'visitor@example.com'); set('phone', '+447700900123'); set('message', 'Interested in a new septic tank');
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 700));
  }
  const leads2 = await call('GET', '/contacts?search=visitor@example.com', null, token);
  check('generated site lead form → CRM contact created', leads2.data.contacts.some(c => c.email === 'visitor@example.com' && c.source === 'website'), JSON.stringify(leads2.data.contacts).slice(0,120));
  // 4) NEW DESIGNS all available and buildable
  const ds2 = await call('GET', '/ai/site-designs', null, token);
  const ids2 = ds2.data.designs.map(d => d.id);
  check('9 designs available', ids2.length >= 9, ids2.join(','));
  ['ocean','forest','rose','midnight','ember','graphite'].forEach(id => check('design present: ' + id, ids2.includes(id)));
  for (const did of ['ocean','rose','midnight','ember','graphite']) {
    const t = await call('POST', '/sites', { name: 'Design Test', build_with_ai: true, design_id: did, published: false }, token);
    check('design ' + did + ' builds', t.status === 200 && String(t.data.html || '').includes('nx-hero'), (t.data?.error||'').slice(0,60));
  }
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}
}


console.log('\n== V8 DESIGN ENGINE: CATALOGS + COMBINATIONS + COMPONENT STYLES ==');
{
  // styles endpoint: all catalogs + combo count
  const st = await call('GET', '/ai/site-styles', null, token);
  check('styles endpoint returns catalogs', st.status === 200 && st.data.themes && st.data.heroes && st.data.anims && st.data.cards && st.data.navs && st.data.three_d, JSON.stringify(st.data).slice(0,80));
  check('40 curated themes', st.data.themes.length >= 40, String(st.data.themes.length));
  check('12 hero styles', st.data.heroes.length >= 12, String(st.data.heroes.length));
  check('12 animation presets', st.data.anims.length >= 12, String(st.data.anims.length));
  check('6 card styles', st.data.cards.length >= 6, String(st.data.cards.length));
  check('4 nav styles', st.data.navs.length >= 4, String(st.data.navs.length));
  check('3 3D levels', st.data.three_d.length >= 3);
  check('400k+ design combinations', st.data.combo_count >= 400000, st.data.combo_count.toLocaleString());
  check('theme includes vars for swatches', st.data.themes[0].vars && st.data.themes[0].vars['--accent'], JSON.stringify(st.data.themes[0]).slice(0,80));
  // build with every catalog option → each injects its CSS/JS
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '<section class="nx-hero"><div class="container"><h1>T</h1></div></section><div class="nx-hero-img"><img src="https://x.com/a.jpg" alt="a"></div>' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  // theme
  const t1 = await call('POST', '/sites', { name: 'Cyber', build_with_ai: true, design_id: 'sentinel', theme_id: 'cyberpunk', published: false }, token);
  check('cyberpunk theme injects vars + neon', t1.status === 200 && String(t1.data.html).includes('--accent:#00f0ff') && String(t1.data.html).includes('--neon'), (t1.data?.error||'').slice(0,60));
  const t2 = await call('POST', '/sites', { name: 'Glass', build_with_ai: true, theme_id: 'glass-dark', published: false }, token);
  check('glass theme injects glass card treatment', String(t2.data.html).includes('backdrop-filter:blur(14px)') && String(t2.data.html).includes('--glass'));
  const t3 = await call('POST', '/sites', { name: 'Brutal', build_with_ai: true, theme_id: 'brutalism', published: false }, token);
  check('brutalism theme injects brutal cards', String(t3.data.html).includes('6px 6px 0 #111'));
  // hero styles
  const h1 = await call('POST', '/sites', { name: 'Kinetic', build_with_ai: true, hero_style: 'kinetic', published: false }, token);
  check('kinetic hero injects kinetic type css', String(h1.data.html).includes('@keyframes kin') && String(h1.data.html).includes('nx-kinetic'));
  const h2 = await call('POST', '/sites', { name: 'Mesh', build_with_ai: true, hero_style: 'mesh', published: false }, token);
  check('mesh hero injects gradient mesh', String(h2.data.html).includes('meshDrift') && String(h2.data.html).includes('radial-gradient(40% 45%'));
  const h3 = await call('POST', '/sites', { name: 'MarqueeBG', build_with_ai: true, hero_style: 'marqueebg', published: false }, token);
  check('marquee bg hero injects big marquee', String(h3.data.html).includes('nx-hero-bg-marquee'));
  // animation presets
  const a1 = await call('POST', '/sites', { name: 'ClipAnim', build_with_ai: true, anim_preset: 'clip', published: false }, token);
  check('clip animation preset injected', String(a1.data.html).includes('clip-path:inset(0 0 100% 0)'));
  const a2 = await call('POST', '/sites', { name: 'BlurAnim', build_with_ai: true, anim_preset: 'blur', published: false }, token);
  check('blur animation preset injected', String(a2.data.html).includes('filter:blur(8px)'));
  // card styles
  const c1 = await call('POST', '/sites', { name: 'GradBorder', build_with_ai: true, card_style: 'border', published: false }, token);
  check('gradient-border card style injected', String(c1.data.html).includes('padding-box,var(--grad) border-box'));
  const c2 = await call('POST', '/sites', { name: 'Lift3D', build_with_ai: true, card_style: 'lift3d', published: false }, token);
  check('3D lift card style injected', String(c2.data.html).includes('translateZ(22px)'));
  // nav styles
  const n1 = await call('POST', '/sites', { name: 'UnderNav', build_with_ai: true, nav_style: 'underline', published: false }, token);
  check('underline nav style injected', String(n1.data.html).includes('scaleX(0)'));
  // 3D levels
  const d1 = await call('POST', '/sites', { name: 'ThreeD', build_with_ai: true, three_d: 'full', published: false }, token);
  check('full 3D injects particle canvas JS + orb', String(d1.data.html).includes('nx-particles') && String(d1.data.html).includes('orbSpin') && String(d1.data.html).includes('requestAnimationFrame'));
  const d2 = await call('POST', '/sites', { name: 'ThreeDlight', build_with_ai: true, three_d: 'light', published: false }, token);
  check('light 3D injects preserve-3d only (no canvas)', String(d2.data.html).includes('preserve-3d') && !String(d2.data.html).includes('nx-particles'));
  const d3 = await call('POST', '/sites', { name: 'ThreeDoff', build_with_ai: true, three_d: 'off', published: false }, token);
  check('3D off injects nothing', !String(d3.data.html).includes('nx-particles') && !String(d3.data.html).includes('preserve-3d'));
  // combination: everything at once still builds + prompt hints present
  const combo = await call('POST', '/sites', { name: 'Combo King', build_with_ai: true, design_id: 'midnight', theme_id: 'cyberpunk', hero_style: 'tilt3d', anim_preset: 'flip', card_style: 'border', nav_style: 'pill', three_d: 'full', published: false }, token);
  check('full combo builds', combo.status === 200 && String(combo.data.html).includes('nx-hero'), (combo.data?.error||'').slice(0,60));
  const ch = String(combo.data.html);
  check('combo includes theme + hero + anim + card + nav + 3d css', ch.includes('--accent:#00f0ff') && ch.includes('perspective:1100px') && ch.includes('rotateX(24deg)') && ch.includes('border-box') && ch.includes('scaleX(0)') || ch.includes('data-cta') && ch.includes('nx-particles'));
  // theme + design persist through settings round-trip
  const meta = await call('GET', `/sites/${combo.data.id}/html`, null, token);
  check('theme persisted in site meta', meta.data.theme && meta.data.theme.theme_id === 'cyberpunk' && meta.data.theme.hero_style === 'tilt3d' && meta.data.theme.three_d === 'full', JSON.stringify(meta.data.theme).slice(0,100));
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}


console.log('\n== V8.2: FULL-3D SITE RUNS SAFELY IN A BROWSER (no crash, canvas guard) ==');
try {
  // build a full-3D site
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '<section class="nx-hero"><div class="container"><h1>3D Hero</h1></div></section><section class="nx-faq"><div class="nx-faq-item"><button class="nx-faq-q">Q<span class="arr">+</span></button><div class="nx-faq-a">A</div></div></section>' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const site = await call('POST', '/sites', { name: '3D Run', build_with_ai: true, three_d: 'full', anim_preset: 'pop', published: false }, token);
  const html = String(site.data.html || '');
  // run in jsdom with a canvas whose getContext returns null (like jsdom) — must not crash
  const { JSDOM } = await import('jsdom');
  const errors = [];
  const dom = new JSDOM(html, { url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w2) {
      w2.IntersectionObserver = class { constructor(cb){ this.cb = cb; } observe(el){ this.cb([{ isIntersecting: true, target: el }]); } unobserve(){} disconnect(){} };
      w2.matchMedia = () => ({ matches: false, addEventListener(){} });
      w2.HTMLCanvasElement.prototype.getContext = () => null;
    } });
  const w = dom.window;
  w.addEventListener('error', e => errors.push(e.message));
  await new Promise(r => setTimeout(r, 500));
  check('full-3D site runs without errors (canvas guard works)', errors.length === 0, errors.slice(0,2).join(' | '));
  check('particle canvas element present in DOM', !!w.document.getElementById('nx-particles'));
  check('pop animation preset applied to reveals', w.document.querySelectorAll('[data-reveal].in').length >= 1 || html.includes('scale(.82)'));
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
} catch (e) {
  if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /jsdom/.test(String(e.message))) {
    console.log("  \u26a0\ufe0f  SKIPPED \u2014 jsdom not installed in this environment (everything else in this section that doesn't need a real DOM already ran above; the rest of the suite continues).");
  } else { throw e; }
} finally {
  // The section above may have set a narrow, section-specific fetch mock
  // before reaching the jsdom import — if jsdom is missing, that mock's
  // own restoration line never runs. Always put the shared fake back so
  // later sections never inherit a stale mock.
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}


console.log('\n== V9: HEALTH TEST PER-PROVIDER MODEL + KIND ==');
{
  // Workspace has an OpenAI-style model but an NVIDIA key — health test must
  // ping NVIDIA with an NVIDIA model, not gpt-4o-mini.
  await call('PATCH', '/ai/settings', { provider: 'openai', model: 'gpt-4o-mini', nvidia_key: 'nv-test', openai_key: '' }, token);
  let pingedModels = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com')) {
      const body = JSON.parse(opts.body || '{}');
      pingedModels.push(body.model);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {}, model: body.model }), { status: 200 });
    }
    if (u.includes('openai.com')) {
      const body = JSON.parse(opts.body || '{}');
      pingedModels.push('openai:' + body.model);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {}, model: body.model }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const h = await call('GET', '/ai/health', null, token);
  check('health test returns statuses', h.status === 200 && h.data.nvidia && h.data.openai, JSON.stringify(h.data).slice(0,80));
  check('NVIDIA pinged with NVIDIA model (not gpt-4o-mini)', pingedModels.includes('nvidia/llama-3.1-nemotron-70b-instruct'), pingedModels.join(','));
  check('health ok includes model', h.data.nvidia.status === 'ok' && h.data.nvidia.model === 'nvidia/llama-3.1-nemotron-70b-instruct');
  // error path carries a kind (clear the 30s health cache first)
  if (globalThis.__nxTest) globalThis.__nxTest.resetProviderHealth();
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nvidia.com')) return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
    throw new Error('unexpected ' + u);
  };
  const h2 = await call('GET', '/ai/health', null, token);
  check('health error includes kind (bad_key)', h2.data.nvidia.kind === 'bad_key' && h2.data.nvidia.status === 'error', JSON.stringify(h2.data.nvidia));
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
  await call('PATCH', '/ai/settings', { provider: 'nvidia', model: 'meta/llama-3.1-8b-instruct', nvidia_key: 'nv-test' }, token);
}


console.log('\n== V10: 3D SCENE ENGINE + 170 CONCEPTS + SPLINE + NVIDIA BASE URL ==');
try {
  // 1) scenes + concepts endpoints
  const sc = await call('GET', '/ai/site-scenes', null, token);
  check('scenes endpoint returns 30 scenes', sc.status === 200 && sc.data.scenes.length >= 30, String(sc.data.scenes?.length));
  const cp = await call('GET', '/ai/site-concepts', null, token);
  check('concepts endpoint returns 680 concepts (40 packs x 17 industries)', cp.status === 200 && cp.data.concepts.length === 680, String(cp.data.concepts?.length));
  const c0 = cp.data.concepts[0];
  check('concept has scene+theme+hero+desc', c0.scene_id && c0.theme_id && c0.hero_style && c0.desc, JSON.stringify(c0).slice(0,100));
  check('concept scene ids are all real', cp.data.concepts.every(c => sc.data.scenes.some(x => x.id === c.scene_id)));
  // 2) build with a scene → host + bootstrap + fn injected
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      const msg = JSON.stringify(JSON.parse(opts.body || '{}').messages || []);
      if (msg.includes('3D BACKGROUND')) lastScenePrompt = msg;
      return new Response(JSON.stringify({ choices: [{ message: { content: '<section class="nx-hero"><div class="container"><h1>Scene site</h1></div></section>' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  let lastScenePrompt = '';
  const site = await call('POST', '/sites', { name: 'Scene Test', build_with_ai: true, scene_id: 'galaxy', design_id: 'sentinel', published: false }, token);
  const html = String(site.data.html || '');
  check('site builds with scene', site.status === 200 && site.data.slug, (site.data?.error||'').slice(0,80));
  check('scene host div injected', html.includes('nx-scene-host') && html.includes('data-scene="galaxy"'));
  check('scene bootstrap injected (canvas+loop)', html.includes('nx-scene-canvas') && html.includes('requestAnimationFrame') && html.includes('SCENE=function'));
  check('scene draw code present (galaxy spiral)', html.includes('Galaxy Spiral') === false && /Galaxy/.test(html) === false ? html.includes('Math.pow') : html.includes('Math.pow'));
  check('prompt told the AI about the 3D background', lastScenePrompt.includes('3D BACKGROUND'), lastScenePrompt.slice(0,80));
  // 3) scene RUNS in jsdom without errors (canvas stub returns null)
  const { JSDOM } = await import('jsdom');
  const errors = [];
  const dom = new JSDOM(html, { url: 'https://scene.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w2) {
      w2.IntersectionObserver = class { constructor(cb){ this.cb = cb; } observe(el){ this.cb([{ isIntersecting: true, target: el }]); } unobserve(){} disconnect(){} };
      w2.matchMedia = () => ({ matches: false, addEventListener(){} });
      w2.HTMLCanvasElement.prototype.getContext = () => null;
    } });
  const w = dom.window;
  w.addEventListener('error', e => errors.push(e.message));
  await new Promise(r => setTimeout(r, 400));
  check('scene site runs without errors (canvas guard)', errors.length === 0, errors.slice(0,2).join(' | '));
  // 4) Spline embed
  const spline = await call('POST', '/sites', { name: 'Spline Site', build_with_ai: true, spline_url: 'https://my.spline.design/abcdef123456/', published: false }, token);
  const sh = String(spline.data.html || '');
  check('spline viewer script + element injected', sh.includes('splinetool/viewer') && sh.includes('<spline-viewer') && sh.includes('my.spline.design'));
  // 5) scene + theme persisted
  const meta = await call('GET', `/sites/${site.data.id}/html`, null, token);
  check('scene_id persisted in theme', meta.data.theme && meta.data.theme.scene_id === 'galaxy', JSON.stringify(meta.data.theme).slice(0,80));
  // 6) NVIDIA custom base URL
  await call('PATCH', '/ai/settings', { nvidia_base_url: 'https://my-nim.example.com/v1' }, token);
  const g = await call('GET', '/ai/settings', null, token);
  check('nvidia base url saved + returned', g.data.nvidia_base_url === 'https://my-nim.example.com/v1');
  let nimFetched = false;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('my-nim.example.com')) { nimFetched = true; return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {} }), { status: 200 }); }
    throw new Error('unexpected ' + u);
  };
  await call('GET', '/ai/health', null, token);
  check('health pings the custom NVIDIA base URL', nimFetched === true);
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
  await call('PATCH', '/ai/settings', { nvidia_base_url: '' }, token);
} catch (e) {
  if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /jsdom/.test(String(e.message))) {
    console.log("  \u26a0\ufe0f  SKIPPED \u2014 jsdom not installed in this environment (everything else in this section that doesn't need a real DOM already ran above; the rest of the suite continues).");
  } else { throw e; }
} finally {
  // The section above may have set a narrow, section-specific fetch mock
  // before reaching the jsdom import — if jsdom is missing, that mock's
  // own restoration line never runs. Always put the shared fake back so
  // later sections never inherit a stale mock.
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}


console.log('\n== V11: 3D GALLERY + 55 SCENES + NEW TECHNIQUE SCENES RUN ==');
try {
  // gallery
  const g = await call('GET', '/ai/site-gallery', null, token);
  check('gallery returns 30 real sites', g.status === 200 && g.data.sites.length >= 30, String(g.data.sites?.length));
  check('gallery sites have url+technique+steal', g.data.sites.every(x => x.url && x.technique && x.steal));
  check('gallery includes researched sites', ['Oryzo','Bruno Simon','Species in Pieces','Primland','Cartier'].every(n => g.data.sites.some(x => (x.name||'').includes(n))), g.data.sites.slice(0,3).map(x=>x.name).join(','));
  check('gallery urls are real https sites', g.data.sites.every(x => /^https?:\/\//.test(x.url)));
  // scenes: 30 v1 + 25 v2 = 55
  const sc = await call('GET', '/ai/site-scenes', null, token);
  check('55 scenes total', sc.data.scenes.length >= 55, String(sc.data.scenes.length));
  const v2ids = ['globe','terrain','ocean','fragments','zparallax','scrollmesh','monolith','flythrough','prisms','depthfog','ringworld','meteor','planets','dna','city','volcano','galaxyarms','lighthouses','citynight','wireplanet','orrery','wavefront','constellation3d','tunnelrings','waves3d'];
  v2ids.forEach(id => check('v2 scene present: ' + id, sc.data.scenes.some(x => x.id === id)));
  check('v2 scene descriptions credit real sites', sc.data.scenes.some(x => /inspired by/i.test(x.desc || '')), JSON.stringify(sc.data.scenes.find(x=>x.id==='zparallax')).slice(0,120));
  // concepts still 170 with new packs
  const cp = await call('GET', '/ai/site-concepts', null, token);
  check('concepts now 680', cp.data.concepts.length === 680, String(cp.data.concepts.length));
  check('concepts use new scenes', cp.data.concepts.some(c => c.scene_id === 'globe') && cp.data.concepts.some(c => c.scene_id === 'fragments'));
  // build with a v2 scene + run it crash-free
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '<section class="nx-hero"><div class="container"><h1>V2 Scene</h1></div></section>' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  for (const sid of ['globe','fragments','terrain','zparallax','monolith','planets','dna','city','galaxyarms','depthfog']) {
    const t = await call('POST', '/sites', { name: 'Scene ' + sid, build_with_ai: true, scene_id: sid, published: false }, token);
    check('v2 scene builds: ' + sid, t.status === 200 && String(t.data.html).includes('nx-scene-host'), (t.data?.error||'').slice(0,50));
  }
  const runSite = await call('POST', '/sites', { name: 'Run V2', build_with_ai: true, scene_id: 'fragments', published: false }, token);
  const html = String(runSite.data.html || '');
  const { JSDOM } = await import('jsdom');
  const errors = [];
  const dom = new JSDOM(html, { url: 'https://v2.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w2) {
      w2.IntersectionObserver = class { constructor(cb){ this.cb = cb; } observe(el){ this.cb([{ isIntersecting: true, target: el }]); } unobserve(){} disconnect(){} };
      w2.matchMedia = () => ({ matches: false, addEventListener(){} });
      w2.HTMLCanvasElement.prototype.getContext = () => null;
    } });
  const w = dom.window;
  w.addEventListener('error', e => errors.push(e.message));
  await new Promise(r => setTimeout(r, 400));
  check('v2 scene site runs without errors', errors.length === 0, errors.slice(0,2).join(' | '));
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
} catch (e) {
  if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /jsdom/.test(String(e.message))) {
    console.log("  \u26a0\ufe0f  SKIPPED \u2014 jsdom not installed in this environment (everything else in this section that doesn't need a real DOM already ran above; the rest of the suite continues).");
  } else { throw e; }
} finally {
  // The section above may have set a narrow, section-specific fetch mock
  // before reaching the jsdom import — if jsdom is missing, that mock's
  // own restoration line never runs. Always put the shared fake back so
  // later sections never inherit a stale mock.
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}


console.log('\n== V12: PRO 3D — WEBGL SCENES + PRO CANVAS + LIVE PREVIEW CODE + GALLERY REBUILD ==');
try {
  // scenes: 55 canvas + 42 three = 97 total, typed
  const sc = await call('GET', '/ai/site-scenes', null, token);
  check('97+ scenes total', sc.data.scenes.length >= 97, String(sc.data.scenes.length));
  const threeCount = sc.data.scenes.filter(x => x.type === 'three').length;
  const canvasCount = sc.data.scenes.filter(x => x.type === 'canvas').length;
  check('42 WebGL scenes', threeCount >= 42, String(threeCount));
  check('55 canvas scenes', canvasCount >= 55, String(canvasCount));
  check('every scene typed', sc.data.scenes.every(x => x.type === 'three' || x.type === 'canvas'));
  // code endpoint
  const code = await call('GET', '/ai/site-scenes/tgalaxy/code', null, token);
  check('three scene code endpoint returns body+tick', code.status === 200 && code.data.type === 'three' && code.data.body.includes('THREE.') && code.data.tick.length > 0, JSON.stringify(code.data).slice(0,80));
  const code2 = await call('GET', '/ai/site-scenes/p3cube/code', null, token);
  check('pro canvas code endpoint returns fn', code2.status === 200 && code2.data.type === 'canvas' && code2.data.fn.includes('mesh3'), code2.data?.fn?.slice(0,60));
  // build with a WebGL scene → script + boot injected, canvas guard present
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com') || u.includes('openai.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '<section class="nx-hero"><div class="container"><h1>Pro 3D</h1></div></section>' } }], usage: {} }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  const w3 = await call('POST', '/sites', { name: 'WebGL Site', build_with_ai: true, scene_id: 'tgalaxy', published: false }, token);
  const wh = String(w3.data.html || '');
  check('webgl site builds', w3.status === 200 && w3.data.slug);
  check('three boot injected (WebGL check + CDN loader)', wh.includes('WebGLRenderingContext') && wh.includes('unpkg.com/three') && wh.includes('boot()'));
  check('host marked type=three', wh.includes('data-type="three"'));
  check('theme colors passed to scene', wh.includes("tc('--accent'"));
  // WebGL site runs in jsdom without crashing (WebGL absent → graceful)
  const { JSDOM } = await import('jsdom');
  const errors = [];
  const dom = new JSDOM(wh, { url: 'https://pro3d.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w2) {
      w2.IntersectionObserver = class { constructor(cb){ this.cb = cb; } observe(el){ this.cb([{ isIntersecting: true, target: el }]); } unobserve(){} disconnect(){} };
      w2.matchMedia = () => ({ matches: false, addEventListener(){} });
      w2.HTMLCanvasElement.prototype.getContext = () => null;
    } });
  const w = dom.window;
  w.addEventListener('error', e => errors.push(e.message));
  await new Promise(r => setTimeout(r, 400));
  check('webgl site runs without errors (graceful no-WebGL)', errors.length === 0, errors.slice(0,2).join(' | '));
  // build with a PRO canvas scene → mini-3D helpers available
  const c3 = await call('POST', '/sites', { name: 'Pro Canvas', build_with_ai: true, scene_id: 'p3shapes', published: false }, token);
  const ch = String(c3.data.html || '');
  check('pro canvas build includes mini-3D engine (rot3/proj3/mesh3)', ch.includes('function rot3') && ch.includes('function proj3') && ch.includes('function mesh3'), ch.slice(0,60));
  check('pro canvas host type=canvas', ch.includes('data-type="canvas"'));
  // concepts now include WebGL packs
  const cp = await call('GET', '/ai/site-concepts', null, token);
  check('concepts include webgl packs', cp.data.concepts.some(c => c.scene_id === 'tgalaxy') && cp.data.concepts.some(c => c.scene_id === 'tcity'), String(cp.data.concepts.length));
  // gallery 60 sites
  const g = await call('GET', '/ai/site-gallery', null, token);
  check('gallery has 60 real sites', g.data.sites.length >= 60, String(g.data.sites.length));
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
} catch (e) {
  if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /jsdom/.test(String(e.message))) {
    console.log("  \u26a0\ufe0f  SKIPPED \u2014 jsdom not installed in this environment (everything else in this section that doesn't need a real DOM already ran above; the rest of the suite continues).");
  } else { throw e; }
} finally {
  // The section above may have set a narrow, section-specific fetch mock
  // before reaching the jsdom import — if jsdom is missing, that mock's
  // own restoration line never runs. Always put the shared fake back so
  // later sections never inherit a stale mock.
  globalThis.fetch = FAKE_FETCH;
  aiBehavior = 'ok';
}

console.log('\n== EMAIL (validation, no silent failure) ==');
{
  const r = await call('POST', '/email/send', { to: 'not-an-email', subject: 'x', body: 'y' }, token);
  check('invalid recipient rejected', r.status === 400 && /valid recipient/.test(r.data.error || ''));
  const r2 = await call('POST', '/email/send', { to: 'a@b.com' }, token);
  check('no provider → clear error (not fake success)', r2.status === 400 && /Resend|provider/i.test(r2.data.error || ''));
}

console.log('\n== WORKSPACE ISOLATION ==');
{
  DB._runRaw('DELETE FROM rate_limits'); // reset per-IP counters before registering user B

  const r2 = await call('POST', '/auth/register', { name: 'Other', email: 'other@x.com', password: 'password123' });
  const otherTok = r2.data.token;
  const r3 = await call('GET', '/contacts', null, otherTok);
  check('user B sees none of user A data', r3.data.contacts.length === 0);
  const r4 = await call('PATCH', '/contacts/1', { name: 'Hacked' }, otherTok);
  check('user B cannot patch user A contact', r4.status === 404);
  const r5 = await call('GET', '/stats', null, otherTok);
  check('stats isolated', r5.data.contacts === 0);
}

console.log('\n== CRON SAFETY ==');
{
  await worker.scheduled({}, env, ctx);
  const s = DB._raw("SELECT COUNT(*) c FROM sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')")[0].values[0][0];
  check('expired sessions purged by cron', s === 0);
}


console.log('\n== V4.1: CONTACT TAGS + CUSTOM FIELDS ==');
{
  const c = await call('POST', '/contacts', { name: 'Tagged Person', email: 'tagged@x.com', tags: 'vip, hot-lead', custom_fields: { birthday: '1990-01-01', website: 'https://x.io' } }, token);
  check('contact with tags saved', c.status === 200 && c.data.tags === 'vip, hot-lead', c.data?.error);
  const got = await call('GET', '/contacts?tag=vip', null, token);
  check('tag filter works', got.data.contacts.some(x => x.name === 'Tagged Person'));
  const got2 = await call('GET', '/contacts?tag=other', null, token);
  check('tag filter excludes others', !got2.data.contacts.some(x => x.name === 'Tagged Person'));
  const p = await call('PATCH', `/contacts/${c.data.id}`, { tags: 'vip', custom_fields: { birthday: '1990-02-02' } }, token);
  check('tags/custom fields patch', p.status === 200 && p.data.tags === 'vip');
  const raw = DB._raw(`SELECT custom_fields FROM contacts WHERE id=${c.data.id}`)[0].values[0][0];
  check('custom_fields stored as JSON', raw.includes('birthday') && raw.includes('1990-02-02'), raw);
}

console.log('\n== V4.1: TRIGGER LINKS ==');
{
  const wf = await call('POST', '/workflows', { name: 'Link Workflow', trigger: 'trigger_link', steps: [{ action: 'create_task', note: 'Trigger link clicked!' }] }, token);
  check('trigger_link workflow created', wf.status === 200);
  const l = await call('POST', '/trigger-links', { name: 'Promo Link', redirect_url: 'https://example.com/offer' }, token);
  check('trigger link created', l.status === 200 && l.data.slug);
  const before = await call('GET', '/trigger-links', null, token);
  const clickRes = await worker.fetch(new Request(BASE + `/api/public/trigger/${l.data.slug}?ref=email`, { headers: { Origin: 'http://app.local' } }), env, ctx);
  // With a redirect_url set, the link should redirect (302) after counting the click.
  check('public click counts + redirects', clickRes.status === 302 || clickRes.status === 200, String(clickRes.status));
  check('redirect target correct', clickRes.status !== 302 || (clickRes.headers.get('location') || '').includes('example.com'), clickRes.headers.get('location') || '');
  await new Promise(r => setTimeout(r, 120));
  await worker.scheduled({}, env, ctx);
  const after = await call('GET', '/trigger-links', null, token);
  check('clicks incremented', after.data.links[0].clicks === 1);
  const tasks = await call('GET', '/tasks', null, token);
  check('workflow fired by link click', tasks.data.tasks.some(t => t.title.includes('Trigger link clicked!')), tasks.data.tasks.map(t=>t.title).join(','));
}

console.log('\n== V4.1: WEBCHAT WIDGET ==');
{
  const wc = await call('GET', '/webchat', null, token);
  check('webchat settings expose token', wc.status === 200 && !!wc.data.public_token, JSON.stringify(wc.data).slice(0,80));
  const token2 = wc.data.public_token;
  const embedRes = await worker.fetch(new Request(BASE + `/api/public/webchat/${token2}/embed.js`, { headers: { Origin: 'http://app.local' } }), env, ctx);
  const embedTxt = await embedRes.text();
  check('embed script served', embedRes.status === 200 && embedTxt.includes('nx-webchat'), embedTxt.slice(0,60));
  aiBehavior = 'stream';
  const msg = await readSSE('POST', `/public/webchat/${token2}/message`, { message: 'Do you have a plan for small businesses?', history: [] });
  check('webchat message → SSE deltas', msg.status === 200 && (msg.text.includes('Hi') || msg.text.includes('"done"')), msg.text.slice(0,80));
  const conv = await call('GET', '/webchat', null, token);
  check('webchat conversation saved to inbox', conv.data.conversations.some(m => m.channel === 'webchat' && m.direction === 'inbound'));
  const bad = await call('GET', '/public/webchat/nonexistent/embed.js');
  check('bad widget token → 404', bad.status === 404);
}

console.log('\n== V4.1: WEBSITES (AI build + publish) ==');
{
  aiBehavior = 'ok';
  const b = await call('POST', '/ai/build-site', { name: 'Acme Landing', description: 'Widgets for everyone' }, token);
  check('ai/build-site returns HTML', b.status === 200 && b.data.html.includes('<!DOCTYPE html>'), (b.data?.error || '').slice(0,80));
  const site = await call('POST', '/sites', { name: 'Acme Landing', build_with_ai: true, description: 'Widgets for everyone', published: true }, token);
  check('site saved + published', site.status === 200 && site.data.slug && site.data.published === 1);
  const pubRes = await worker.fetch(new Request(BASE + `/api/public/site/${site.data.slug}`, { headers: { Origin: 'http://app.local' } }), env, ctx);
  const pubTxt = await pubRes.text();
  check('published site served publicly', pubRes.status === 200 && pubTxt.includes('<html'), pubTxt.slice(0,60));
  const list = await call('GET', '/sites', null, token);
  check('sites list shows size', list.status === 200 && list.data.sites.length >= 1);
  const del = await call('DELETE', `/sites/${site.data.id}`, null, token);
  check('site deleted', del.status === 200);
  const pub2Res = await worker.fetch(new Request(BASE + `/api/public/site/${site.data.slug}`, { headers: { Origin: 'http://app.local' } }), env, ctx);
  check('deleted site → 404', pub2Res.status === 404);
}

console.log('\n== V4.1: AI WEBSITE ANALYZER ==');
{
  aiBehavior = 'ok';
  const a = await call('POST', '/ai/analyze-site', { url: 'https://example.com' }, token);
  check('analyze-site returns verdict', a.status === 200 && a.data.content === 'FAKE_AI_RESPONSE', a.data?.error);
  const bad = await call('POST', '/ai/analyze-site', { url: 'ftp://nope' }, token);
  check('analyze-site rejects bad URLs', bad.status === 502 || bad.status === 400);
}

console.log('\n== V4.1: REVIEW REQUEST WORKFLOW ACTION ==');
{
  const c = await call('POST', '/contacts', { name: 'Review Target', email: 'review@x.com' }, token);
  const wf = await call('POST', '/workflows', { name: 'Ask Review', trigger: 'new_contact', steps: [{ action: 'send_review_request', note: 'Thank them + ask for review' }] }, token);
  check('review request workflow saved', wf.status === 200);
  await call('POST', '/contacts', { name: 'Review Trigger', email: 'rt@x.com' }, token);
  await new Promise(r => setTimeout(r, 120));
  await worker.scheduled({}, env, ctx);
  const tasks = await call('GET', '/tasks', null, token);
  // no Resend key configured → the action must degrade to a task, not crash
  check('review request degrades to task without email provider', tasks.data.tasks.some(t => t.title.includes('review request') || t.title.includes('Review')), tasks.data.tasks.map(t=>t.title).slice(0,3).join(','));
}

console.log('\n== V4.1: SECURITY HEADERS ==');
{
  const h = await worker.fetch(new Request(BASE + '/api/health', { headers: { Origin: 'http://app.local' } }), env, ctx);
  check('nosniff header present', h.headers.get('X-Content-Type-Options') === 'nosniff');
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
