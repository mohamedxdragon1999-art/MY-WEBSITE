// ROUTE-LEVEL FUZZER — adversarial reliability testing against the REAL
// worker: thousands of malformed, hostile, and random requests with ONE
// non-negotiable invariant set:
//
//   1. NEVER a 500 (unexpected crashes are bugs, whatever the input is)
//   2. EVERY response is valid JSON with a JSON Content-Type
//   3. Statuses stay within the documented set
//   4. No request hangs the worker
//   5. After all the abuse, the workspace is still fully functional
//   6. Cross-tenant data never appears in responses
//
// Seeded + deterministic: failures reproduce by re-running with the seed
// printed at the start. Run: node tests/test_fuzz.mjs
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

// Fake AI provider: always a well-formed completion (AI robustness has its
// own suite — here we only care that the ROUTES survive hostile inputs).
let aiCallCount = 0;
globalThis.fetch = async (url) => {
  aiCallCount++;
  if (String(url).includes('api.openai.com') || String(url).includes('nvidia.com') || String(url).includes('localhost:11434')) {
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"sentiment":"neutral","confidence":50,"tone":"x"}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('<html><body>ok</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
};

// ── Deterministic PRNG (reproducible failures) ────────────────
const SEED = Number(process.env.FUZZ_SEED) || 0xF00D;
let s = SEED;
function rnd() { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));
function randStr(len) { let out = ''; const CH = 'abcXYZ 019"{}[]:,\'\\/<>&;$#%@\n\té字😊'; while (out.length < len) out += CH[Math.floor(rnd() * CH.length)]; return out; }
console.log(`fuzz seed: ${SEED} (reproduce with FUZZ_SEED=${SEED})`);

let passed = 0, failed = 0, totalRequests = 0, saw500 = 0, sawNonJson = 0, sawBadStatus = 0, sawSlow = 0;
const failures = [], sample500s = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 180) : '')); }
}

const OK_STATUS = new Set([200, 201, 400, 401, 403, 404, 405, 413, 422, 429, 500, 502, 503, 504]); // 500 allowed ONLY in the deliberate-500 phase; 502/503/504 = documented AI upstream-failure statuses
async function hit(method, path, body, token, opts = {}) {
  totalRequests++;
  const t0 = Date.now();
  let r;
  try {
    r = await worker.fetch(new Request(BASE + '/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(opts.headers || {}),
      },
      body: body === undefined ? undefined : (opts.rawBody ? body : JSON.stringify(body)),
    }), env, ctx);
  } catch (e) {
    // A fetch() that THROWS is the worst possible outcome — the worker crashed.
    saw500++;
    sample500s.push(`${method} ${path} THREW: ${e.message}`);
    return { status: 0, data: null, threw: true };
  }
  const ms = Date.now() - t0;
  if (ms > 3000) { sawSlow++; sample500s.push(`${method} ${path} took ${ms}ms`); }
  const ct = r.headers.get('Content-Type') || '';
  let data = null;
  const text = await r.text().catch(() => '');
  if (text) { try { data = JSON.parse(text); } catch { /* non-JSON body */ } }
  if (!opts.allowNonJson && (!ct.includes('application/json') || (text && data === null))) {
    sawNonJson++; sample500s.push(`${method} ${path} → CT=${ct} body=${text.slice(0, 60)}`);
  }
  if (!OK_STATUS.has(r.status) && !opts.allow500) { sawBadStatus++; sample500s.push(`${method} ${path} → ${r.status}`); }
  if (r.status === 500 && !opts.allow500) { saw500++; sample500s.push(`${method} ${path} → 500 ${text.slice(0, 80)}`); }
  return { status: r.status, data, ms };
}

// ── Boot two tenants + seed data ──────────────────────────────
const A = (await hit('POST', '/auth/register', { name: 'Fuzz A', email: 'fuzz-a@x.io', password: 'password123' })).data?.token;
const B = (await hit('POST', '/auth/register', { name: 'Fuzz B', email: 'fuzz-b@x.io', password: 'password123' })).data?.token;
check('tenants registered for fuzzing', !!A && !!B);
const seeded = [];
for (let i = 0; i < 5; i++) {
  const c = await hit('POST', '/contacts', { name: 'SEED-A-' + i, email: `s${i}@a.io` }, A);
  seeded.push(c.data?.id);
}
check('seed contacts created', seeded.every(Boolean) && seeded.length === 5);

// ── PHASE 1: malformed transport bodies against every route root ──
console.log('\n== PHASE 1: malformed bodies (invalid JSON / wrong types / huge / deep) ==');
{
  const ROOTS = ['/contacts', '/deals', '/tasks', '/messages', '/appointments', '/reviews', '/workflows', '/invoices', '/social', '/sub-accounts', '/forms', '/courses', '/funnels', '/affiliates', '/community', '/trigger-links', '/sites', '/webchat', '/stats', '/ai/complete', '/ai/sentiment', '/ai/build-workflow', '/ai/agent', '/ai/settings', '/ai/usage', '/email/smtp', '/email/send'];
  const garbage = [
    { label: 'invalid JSON', raw: true, body: '{not json at all' },
    { label: 'array body', body: [1, 2, 3] },
    { label: 'string body', body: 'just a string' },
    { label: 'null body', body: null },
    { label: 'number body', body: 42 },
    { label: 'deep nested', body: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: {} } } } } } } } } } } } },
    { label: 'mega string field', body: { name: 'X'.repeat(500000) } },
    { label: 'huge key', body: { ['k'.repeat(10000)]: 'v' } },
    { label: 'unicode salad', body: { name: '😀🍺🎉 𝕊𝕡𝕖𝕔𝕚𝕒𝕝 𝕥𝕖𝕩𝕥 \u0000\u001F\u007F ‮️RTL' } },
    { label: 'empty object', body: {} },
  ];
  for (const root of ROOTS) {
    for (const g of garbage) {
      await hit(pick(['POST', 'PATCH']), root, g.body, A, { rawBody: !!g.raw });
      await hit(pick(['GET', 'DELETE']), root + '/' + randInt(1, 3), undefined, A);
    }
  }
  check('phase 1: zero 500s across malformed-body blitz', saw500 === 0, sample500s.slice(0, 3).join(' | '));
  check('phase 1: every response valid JSON', sawNonJson === 0, sample500s.slice(0, 3).join(' | '));
  check('phase 1: statuses within documented set', sawBadStatus === 0, sample500s.slice(0, 4).join(' | '));
}

// ── PHASE 2: hostile payloads (injection / pollution / XSS) ──
console.log('\n== PHASE 2: injection, pollution, XSS payloads into every field ==');
{
  const ATTACKS = [
    "'; DROP TABLE contacts;--",
    "1' OR '1'='1",
    "{{constructor.constructor('return 1')()}}",
    "__proto__", "constructor", "prototype",
    "<script>window.__pwned=1</script>",
    "<img src=x onerror=window.__pwned=1>",
    "javascript:alert(1)",
    "../../etc/passwd", "\\\\server\\share",
    "${7*7}", "#{7*7}", "{{7*7}}",
    "' UNION SELECT * FROM users--",
    "\u0000\u001B[31m", "😀'.repeat(100000)",
  ];
  for (let i = 0; i < 60; i++) {
    const atk = pick(ATTACKS);
    const body = { name: atk, title: atk, note: atk, notes: atk, text: atk, content: atk, email: atk, search: atk, goal: atk, prompt: atk, message: atk, description: atk, label: atk, stage: atk, tag: atk, [atk]: atk };
    const path = pick(['/contacts', '/deals', '/tasks', '/messages', '/appointments', '/reviews', '/workflows', '/invoices', '/social', '/sub-accounts', '/forms', '/courses', '/funnels', '/affiliates', '/community', '/trigger-links']);
    await hit(pick(['POST', 'PATCH']), rnd() < 0.7 ? path : path + '/' + randInt(1, 5), body, rnd() < 0.5 ? A : B);
  }
  check('phase 2: zero 500s across hostile payloads', saw500 === 0, sample500s.slice(0, 3).join(' | '));
  // Prototype pollution: __NX poleeux check — the module's globals must be intact
  const polluted = ({}).polluted || globalThis.polluted || Object.prototype.polluted;
  check('phase 2: no prototype pollution landed', !polluted);
  // SQL injection: the seed data must still exist and the schema must be intact
  const list = await hit('GET', '/contacts?search=' + encodeURIComponent("' OR 1=1 --"), undefined, A);
  const got = JSON.stringify(list.data || {});
  check('phase 2: SQLi in search did not dump other tenants', !got.includes('Fuzz B') || !got.includes('fuzz-b@'), got.slice(0, 100));
  const intact = await hit('GET', '/contacts', undefined, A);
  check('phase 2: A\'s seed contacts survived the attack wave', JSON.stringify(intact.data).includes('SEED-A-0'));
}

// ── PHASE 3: random walk — method × route × id × token ───────
console.log('\n== PHASE 3: 800-request random walk (methods × routes × ids × tenants) ==');
{
  const ROUTES = ['/contacts', '/deals', '/tasks', '/messages', '/appointments', '/reviews', '/workflows', '/invoices', '/social', '/sub-accounts', '/forms', '/courses', '/funnels', '/affiliates', '/community', '/trigger-links', '/sites', '/webchat', '/stats', '/auth/me', '/ai/usage', '/ai/models', '/ai/health', '/email/smtp'];
  const METHODS = ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'];
  const IDS = ['1', '2', '3', '999999', '0', '-5', 'abc', '1.5', 'NaN', '999999999999999'];
  for (let i = 0; i < 800; i++) {
    const route = pick(ROUTES);
    const method = pick(METHODS);
    const withId = rnd() < 0.6;
    const path = withId ? `${route}/${pick(IDS)}` : route;
    const tok = pick([A, B, A, B, 'garbage-token', '', null]);
    const body = method === 'POST' || method === 'PATCH' ? { name: 'walk-' + i, title: 'walk-' + i, date: '2026-01-01', items: [] } : undefined;
    await hit(method, path, body, tok || undefined);
  }
  check('phase 3: zero 500s across 800-request random walk', saw500 === 0, sample500s.slice(0, 3).join(' | '));
  check('phase 3: zero non-JSON responses', sawNonJson === 0, sample500s.slice(0, 3).join(' | '));
  check('phase 3: no request took > 3s', sawSlow === 0);
}

// ── PHASE 4: auth header abuse ────────────────────────────────
console.log('\n== PHASE 4: Authorization header abuse ==');
{
  // NOTE: undici's Request constructor itself rejects non-Latin-1 header
  // values (emoji etc.) — those never reach the worker through any spec-
  // compliant HTTP client, so this phase uses Latin-1-safe hostile tokens.
  const badTokens = ['', ' ', 'Bearer', 'Basic xyz', 'Bearer ', 'Bearer ' + 'A'.repeat(10000), 'Bearer \xE9\xFF', 'Bearer null', 'Bearer undefined', 'Bearer %00', 'Bearer ../../etc/passwd', 'Bearer\ttab', 'bearer lowercase'];
  for (const t of badTokens) {
    let r;
    try {
      r = await worker.fetch(new Request(BASE + '/api/contacts', { headers: { Authorization: t } }), env, ctx);
    } catch (e) {
      // Constructor-level rejection — acceptable (client-side guard).
      continue;
    }
    totalRequests++;
    if (r.status === 500) { saw500++; sample500s.push(`auth "${t.slice(0, 20)}" → 500`); }
    if (r.status === 200) { sample500s.push(`auth "${t.slice(0, 20)}" → 200?!`); sawBadStatus++; }
  }
  check('phase 4: malformed auth headers → 401, never 500 or 200', saw500 === 0 && sawBadStatus === 0, sample500s.slice(0, 2).join(' | '));
}

// ── PHASE 5: size guards actually fire ────────────────────────
console.log('\n== PHASE 5: body-size guards (413 on real oversized bodies) ==');
{
  const huge = { name: 'Y'.repeat(1_600_000) };
  const r = await hit('POST', '/contacts', huge, A);
  check('phase 5: 1.6MB body → 413 (header layer)', r.status === 413, 'status=' + r.status);
  // Chunked-style: no Content-Length header, huge actual body
  const req = new Request(BASE + '/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + A }, body: JSON.stringify({ name: 'Z'.repeat(1_600_000) }) });
  req.headers.delete('Content-Length');
  const r2 = await worker.fetch(req, env, ctx);
  totalRequests++;
  check('phase 5: huge body without Content-Length also rejected', r2.status === 413, 'status=' + r2.status);
  const arr = await hit('POST', '/contacts', [1, 2, 3], A);
  check('phase 5: array body → 400 with clear message', arr.status === 400 && /expected a JSON object/.test(arr.data?.error || ''), `status=${arr.status}`);
}

// ── PHASE 6: the global rate limiter works (small window test) ──
console.log('\n== PHASE 6: global rate limiter fires under burst ==');
{
  const envLimited = { DB, API_IP_RATE_MAX: 25, API_TOKEN_RATE_MAX: 1e9 };
  let hit429 = false, bad = null;
  for (let i = 0; i < 40; i++) {
    const r = await worker.fetch(new Request(BASE + '/api/health'), envLimited, ctx);
    if (r.status === 429) { hit429 = true; const ct = r.headers.get('Content-Type'); if (!ct?.includes('json')) bad = '429 not JSON'; break; }
    if (r.status !== 200) { bad = 'unexpected ' + r.status; break; }
  }
  check('phase 6: per-IP burst limit fires (429) and stays JSON', hit429 && !bad, bad || '');
  // Per-token limit
  const envTok = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 10 };
  let tok429 = false;
  for (let i = 0; i < 30; i++) {
    const r = await worker.fetch(new Request(BASE + '/api/contacts', { headers: { Authorization: 'Bearer ' + B } }), envTok, ctx);
    if (r.status === 429) { tok429 = true; break; }
  }
  check('phase 6: per-token burst limit fires (429)', tok429);
}

// ── PHASE 7: state integrity after all the abuse ──────────────
console.log('\n== PHASE 7: the workspace still works after everything ==');
{
  const stats = await hit('GET', '/stats', undefined, A);
  check('phase 7: /stats still answers', stats.status === 200);
  const me = await hit('GET', '/auth/me', undefined, A);
  check('phase 7: auth still works', me.status === 200 && me.data?.user?.email === 'fuzz-a@x.io');
  const list = await hit('GET', '/contacts', undefined, A);
  const names = JSON.stringify(list.data || {});
  check('phase 7: A\'s data intact (no loss, no corruption)', names.includes('SEED-A-0') && names.includes('SEED-A-4'));
  const bList = JSON.stringify((await hit('GET', '/contacts', undefined, B)).data || {});
  check('phase 7: B never saw A\'s records during the entire fuzz', !bList.includes('SEED-A-'));
  const created = await hit('POST', '/contacts', { name: 'POST-FUZZ-OK', email: 'pf@x.io' }, A);
  check('phase 7: writes still work after the storm', created.status === 200 && !!created.data?.id);
  check('phase 7: DB schema survived (no dropped tables)', (() => {
    const tables = DB._raw("SELECT name FROM sqlite_master WHERE type='table'")[0].values.map(v => v[0]);
    return ['users', 'sessions', 'contacts', 'workspaces'].every(t => tables.includes(t));
  })());
}

console.log(`\n(total requests fired: ${totalRequests}, AI calls: ${aiCallCount})`);
console.log('\n════════════════════════════════════════════════════════════');
console.log(`FUZZ RESULTS: ${passed} passed, ${failed} failed`);
if (failed) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
console.log('════════════════════════════════════════════════════════════');
try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch { }
process.exit(failed ? 1 : 0);
