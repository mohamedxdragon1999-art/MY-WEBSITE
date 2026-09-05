// TRUE end-to-end test of the Webchat Widget:
// 1. Serves the REAL embed.js from the worker
// 2. Runs it in a simulated browser page (jsdom) like a real visitor would
// 3. Opens the bubble, types a message, sends it
// 4. Verifies the AI reply streams into the chat window
// 5. Verifies the close button works
// 6. Verifies the daily-cap fallback protects the workspace
// Run: node tests/test_webchat_widget.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { init, DB } = require('./d1mock.js');

const schema = readFileSync(join(__dirname, '..', 'backend', 'schema.sql'), 'utf8');
await init(schema);

// ── Fake AI provider (streams "Hello from AI") ──
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('nvidia.com') || u.includes('openai.com')) {
    if (aiBehavior === 'cap') return new Response(JSON.stringify({ error: { message: 'x' } }), { status: 429 });
    if (aiBehavior === 'down') return new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 });
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Hello from the AI "}}]}\n\n'));
        c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"widget! How can I help?"}}]}\n\n'));
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        c.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  throw new Error('Unexpected fetch: ' + u);
};
let aiBehavior = 'ok';

const worker = (await import(join(__dirname, '..', 'backend', 'src', 'index.js'))).default;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 }; // limits tested explicitly in test_fuzz.mjs
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => { }) };
const BASE = 'http://test.local';

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', Origin: 'http://app.local' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request(BASE + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const res = await worker.fetch(req, env, ctx);
  let data = null; try { data = await res.json(); } catch { }
  return { status: res.status, data };
}

// ── Setup: register + configure AI ──
console.log('\n== SETUP ==');
const reg = await call('POST', '/auth/register', { name: 'Widget Owner', email: 'widget@x.com', password: 'password123' });
check('register', reg.status === 200);
const token = reg.data.token;
await call('PATCH', '/ai/settings', { provider: 'nvidia', nvidia_key: 'nvapi-test-key-123456' }, token);

const wc = await call('GET', '/webchat', null, token);
check('webchat settings expose public token', wc.status === 200 && !!wc.data.public_token);
const pubToken = wc.data.public_token;

// ── Serve the real embed script ──
const embedRes = await worker.fetch(new Request(BASE + '/api/public/webchat/' + pubToken + '/embed.js', { headers: { Origin: 'http://client-site.com' } }), env, ctx);
const embedScript = await embedRes.text();
check('embed.js served', embedRes.status === 200 && embedScript.includes('nx-webchat'), embedScript.slice(0, 60));

// ── Run the widget in a simulated visitor page ──
console.log('\n== VISITOR PAGE (real widget execution) ==');
const dom = new JSDOM('<!DOCTYPE html><html><body><h1>Client Website</h1></body></html>', {
  url: 'http://client-site.com/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const w = dom.window;
// Bridge: the widget's fetch calls go to the REAL worker.
// The widget script calls base + '/api/public/webchat/...' where base is
// the origin that served embed.js (http://test.local) — pass through as-is.
w.fetch = async (url, opts = {}) => {
  const u = String(url);
  const target = u.startsWith('http') ? u : BASE + u;
  const req = new Request(target, {
    method: opts.method || 'GET',
    headers: opts.headers || {},
    body: opts.body || undefined,
  });
  return worker.fetch(req, env, ctx);
};
// Evaluate the real embed script
const scriptEl = w.document.createElement('script');
scriptEl.textContent = embedScript;
w.document.body.appendChild(scriptEl);

await sleep(200);
const doc = w.document;

check('bubble button exists', !!doc.getElementById('nxw-btn'));
check('panel hidden initially', doc.getElementById('nxw-panel').style.display === 'none');

// ── Open the widget ──
doc.getElementById('nxw-btn').click();
await sleep(100);
check('panel opens on bubble click', doc.getElementById('nxw-panel').style.display === 'flex');
check('bubble hides when open', doc.getElementById('nxw-btn').style.display === 'none');

// ── Close button (the bug we just fixed) ──
doc.getElementById('nxw-x').click();
await sleep(100);
check('✕ button closes the panel', doc.getElementById('nxw-panel').style.display === 'none');
check('bubble returns after close', doc.getElementById('nxw-btn').style.display === 'flex');

// ── Send a real message ──
doc.getElementById('nxw-btn').click();
await sleep(100);
doc.getElementById('nxw-in').value = 'Do you have a free plan?';
doc.getElementById('nxw-send').click();
await sleep(100);
check('user message appears in chat', (doc.getElementById('nxw-msgs').textContent || '').includes('Do you have a free plan?'));

// Wait for the streamed AI reply (max 6s)
let reply = '';
for (let i = 0; i < 30; i++) {
  await sleep(200);
  reply = doc.getElementById('nxw-msgs').textContent || '';
  if (reply.includes('widget!')) break;
}
check('AI reply streamed into widget', reply.includes('Hello from the AI widget!'), reply.slice(-80));
// Let the stream's done handler finish (busy flag resets) before the next send.
await sleep(600);

// ── Conversation landed in the owner's inbox ──
const conv = await call('GET', '/webchat', null, token);
check('visitor message saved to inbox', conv.data.conversations.some(m => m.channel === 'webchat' && m.body.includes('free plan') && m.direction === 'inbound'));
check('AI reply ALSO saved to inbox (outbound, ai_generated)', conv.data.conversations.some(m => m.channel === 'webchat' && m.direction === 'outbound' && m.ai_generated === 1 && m.body.startsWith('AI:')));

// ── Daily cap protection ──
console.log('\n== DAILY CAP PROTECTION ==');
await call('PATCH', '/ai/settings', { daily_call_cap: 10 }, token);
for (let i = 0; i < 11; i++) DB._runRaw("INSERT INTO ai_usage_log (workspace_id, op, provider) VALUES (1, 'test', 'fake')");
const cntDbg = DB._raw('SELECT COUNT(*) c FROM ai_usage_log')[0].values[0][0];
console.log('  DEBUG usage rows before msg2:', cntDbg);
// send another widget message — must get the polite fallback, NOT an AI call
doc.getElementById('nxw-in').value = 'Are you still there?';
doc.getElementById('nxw-send').click();
let fallback = '';
for (let i = 0; i < 25; i++) {
  await sleep(200);
  fallback = doc.getElementById('nxw-msgs').textContent || '';
  if (fallback.includes('daily chat limit')) break;
}
check('cap reached → polite fallback (no AI burn)', fallback.includes('daily chat limit'), fallback.slice(-90));
check('cap fallback is honest: says it is automated + a person will reply, labelled as auto', fallback.includes('automated assistant') && fallback.includes('a person will reply') && !!doc.querySelector('[data-nxw-auto="daily_cap"]'), fallback.slice(-120));
DB._runRaw("DELETE FROM ai_usage_log WHERE op='test'");
await call('PATCH', '/ai/settings', { daily_call_cap: 300 }, token);

// ── B9: provider failure must NOT be passed off as an AI answer ──
console.log('\n== B9 HONEST AUTO-REPLY WHEN THE ASSISTANT IS DOWN ==');
aiBehavior = 'down';
const beforeB9 = (await call('GET', '/webchat', null, token)).data.conversations.length;
doc.getElementById('nxw-in').value = 'Can I book for Tuesday?';
doc.getElementById('nxw-send').click();
let downTxt = '';
for (let i = 0; i < 25; i++) { await sleep(200); downTxt = doc.getElementById('nxw-msgs').textContent || ''; if (downTxt.includes('not available right now')) break; }
check('visitor is TOLD the assistant is unavailable and a person will reply', downTxt.includes('not available right now') && downTxt.includes('a person will reply'), downTxt.slice(-120));
check('the auto bubble is labelled (data-nxw-auto) — not styled as an assistant answer', !!doc.querySelector('[data-nxw-auto="ai_unavailable"]'));
const afterB9 = (await call('GET', '/webchat', null, token)).data.conversations;
const autoRow = afterB9.find(m => m.direction === 'outbound' && m.body.startsWith('AUTO:'));
check('the auto-reply is saved to the inbox as NON-AI outbound (ai_generated=0)', !!autoRow && autoRow.ai_generated === 0, JSON.stringify(autoRow || null).slice(0, 120));
check('the visitor message + auto-reply both landed (thread complete)', afterB9.length === beforeB9 + 2, `${beforeB9} → ${afterB9.length}`);
check('inbox row keeps the visitor subject (per-visitor memory continues)', !!autoRow && /^__v_/.test(autoRow.subject || ''));
aiBehavior = 'ok';
// Recovery: the next message is answered by the real assistant again and the
// earlier auto-reply is replayed to the model as an assistant turn (by direction, not text prefix).
doc.getElementById('nxw-in').value = 'Are you back?';
doc.getElementById('nxw-send').click();
let backTxt = '';
for (let i = 0; i < 25; i++) { await sleep(200); backTxt = doc.getElementById('nxw-msgs').textContent || ''; if (/How can I help\?[^]*$/.test(backTxt) && backTxt.lastIndexOf('How can I help?') > backTxt.lastIndexOf('Are you back?')) break; }
check('after recovery the assistant answers again (no sticky fallback)', backTxt.lastIndexOf('How can I help?') > backTxt.lastIndexOf('Are you back?'), backTxt.slice(-100));

// ── Token regeneration (the other bug we fixed) ──
console.log('\n== TOKEN REGENERATION ==');
const regen = await call('POST', '/webchat', {}, token);
check('regenerate works via plain POST', regen.status === 200 && regen.data.public_token && regen.data.public_token !== pubToken, JSON.stringify(regen.data).slice(0, 60));
const after = await call('GET', '/webchat', null, token);
check('new token persisted', after.data.public_token === regen.data.public_token);

// ── Invalid token rejected ──
const bad = await worker.fetch(new Request(BASE + '/api/public/webchat/not-a-real-token/message', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://client-site.com' }, body: JSON.stringify({ message: 'hi' }) }), env, ctx);
check('invalid token → 404', bad.status === 404);

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
process.exit(failed ? 1 : 0);

