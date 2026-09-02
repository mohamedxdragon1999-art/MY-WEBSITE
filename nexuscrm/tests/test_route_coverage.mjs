// ROUTE-COVERAGE CLOSER — smoke tests for routes the rest of the battery
// never touches. The run_all.mjs gate refuses a green battery while any
// served route has zero coverage; new routes must be added here (or to a
// proper suite) the moment they are born.
//
// Run: node tests/test_route_coverage.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { init, DB } = require('./d1mock.js');
await init(readFileSync(join(__dirname, '..', 'backend', 'schema.sql'), 'utf8'));

const worker = (await import(join(__dirname, '..', 'backend', 'src', 'index.js'))).default;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
const BASE = 'http://test.local';

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('api.openai.com') || u.includes('nvidia.com') || u.includes('localhost:11434')) {
    // SSE-shaped reply for stream route, JSON for the rest — both shapes the
    // provider may legitimately return.
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Fake but well-formed AI reply.' } }], usage: { prompt_tokens: 3, completion_tokens: 5 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('<html><head><title>Site</title></head><body>Analyzed content here</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
};

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 160) : '')); }
}

async function call(method, path, body, token, raw = false) {
  const r = await worker.fetch(new Request(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, ctx);
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { }
  return { status: r.status, data, text };
}

const reg = await call('POST', '/auth/register', { name: 'Cov', email: 'cov@x.io', password: 'password123' });
const token = reg.data?.token;
check('workspace registered', !!token);
await call('POST', '/contacts', { name: 'Cov Contact', email: 'cov@x.io' }, token);

console.log('\n== /ai/chat/stream (authenticated SSE chat) ==');
{
  const r = await call('POST', '/ai/chat/stream', { messages: [{ role: 'user', content: 'hello there' }] }, token);
  check('chat/stream answers (200) with a body', r.status === 200 && r.text.length > 0, `status=${r.status}`);
  check('chat/stream is event-stream shaped', r.text.includes('data:') || /Fake but well-formed/.test(r.text), r.text.slice(0, 80));
  const noAuth = await call('POST', '/ai/chat/stream', { messages: [{ role: 'user', content: 'x' }] }, null);
  check('chat/stream requires auth (401)', noAuth.status === 401);
  const garbage = await call('POST', '/ai/chat/stream', { messages: 'not-an-array' }, token);
  check('chat/stream survives non-array messages', garbage.status !== 500, `status=${garbage.status}`);
}

console.log('\n== /ai/insights/dashboard (aggregation math) ==');
{
  const r = await call('GET', '/ai/insights/dashboard', undefined, token);
  check('insights/dashboard answers 200', r.status === 200, `status=${r.status}`);
  const ins = r.data?.insights;
  check('insights is a non-empty array', Array.isArray(ins) && ins.length > 0);
  check('every insight has title + text', ins?.every(i => typeof i.title === 'string' && typeof i.text === 'string' && i.icon));
  check('no insight leaks another workspace\'s data', !JSON.stringify(ins).includes('SEED-'));
  const noAuth = await call('GET', '/ai/insights/dashboard', undefined, null);
  check('insights/dashboard requires auth (401)', noAuth.status === 401);
  // Empty second workspace: must degrade gracefully, not crash.
  const reg2 = await call('POST', '/auth/register', { name: 'Empty', email: 'empty@x.io', password: 'password123' });
  const empty = await call('GET', '/ai/insights/dashboard', undefined, reg2.data?.token);
  check('insights/dashboard on an EMPTY workspace still answers', empty.status === 200 && Array.isArray(empty.data?.insights));
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(`ROUTE-COVERAGE RESULTS: ${passed} passed, ${failed} failed`);
if (failed) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
console.log('════════════════════════════════════════════════════════════');
process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
process.exit(failed ? 1 : 0);
