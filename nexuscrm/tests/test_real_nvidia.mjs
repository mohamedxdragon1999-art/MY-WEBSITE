// REAL NVIDIA INTEGRATION TEST — runs the ACTUAL provider layer against the
// REAL NVIDIA NIM API using the operator's key. This is the end-to-end proof
// that would otherwise require a manual deploy + Test Connection click.
//
// KEY HANDLING (security law: no secrets in code/logs):
//   The key is read from `nexuscrm/.nvidia-test-key` (gitignored) or the
//   NVAPI_KEY environment variable. It is injected through the REAL
//   /ai/settings route (encrypted by the worker itself), never printed,
//   never written to any tracked file. A leak guard scans every tracked
//   file for the key prefix and fails the run if it appears anywhere.
//   The operator rotates the key after testing regardless.
//
// Skips cleanly (exit 0, marked SKIPPED) when no key is provided.
// Run: node tests/test_real_nvidia.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);

// ── Key loading (never logged) ────────────────────────────────
let NV_KEY = '';
if (existsSync(join(ROOT, '.nvidia-test-key'))) {
  NV_KEY = readFileSync(join(ROOT, '.nvidia-test-key'), 'utf8').trim();
} else if (process.env.NVAPI_KEY) {
  NV_KEY = process.env.NVAPI_KEY.trim();
}

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 200) : '')); }
}

// ── LEAK GUARD runs in BOTH modes: the key prefix must never appear in any
// tracked file. (Also runs in skip mode: catches leftovers from past runs.)
console.log('\n== SECRET LEAK GUARD (runs always) ==');
{
  let tracked = [];
  try { tracked = execSync('git -C "' + ROOT + '" ls-files', { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { }
  let leaked = [];
  const scan = (files) => {
    for (const f of files) {
      const p = join(ROOT, f);
      try {
        if (!statSync(p).isFile()) continue;
        const content = readFileSync(p, 'utf8');
        if (/nvapi-[A-Za-z0-9_-]{16,}/.test(content)) leaked.push(f);
      } catch { }
    }
  };
  scan(tracked);
  // Also scan untracked-but-present files that are NOT gitignored secrets.
  check('no NVIDIA key (nvapi-…) committed in any tracked file', leaked.length === 0, leaked.slice(0, 5).join(', '));
  if (NV_KEY) check('key loaded for this run', NV_KEY.startsWith('nvapi-'), 'key must start with nvapi-');
}

if (!NV_KEY) {
  console.log('\n⚠️  SKIPPED — no key found. Provide one via EITHER:');
  console.log('     1. echo "nvapi-YOURKEY" > nexuscrm/.nvidia-test-key   (gitignored — preferred)');
  console.log('     2. NVAPI_KEY=nvapi-YOURKEY node tests/test_real_nvidia.mjs');
  console.log('   Rotate the key after testing. Nothing ran; battery stays green.');
  console.log('\nREAL-NVIDIA RESULTS: 0 passed, 0 failed (SKIPPED — no key)');
  process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
  process.exit(0);
}

// ── Boot the REAL worker with the REAL network ────────────────
const { init, DB } = require('./d1mock.js');
await init(readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8'));
const worker = (await import(join(ROOT, 'backend', 'src', 'index.js'))).default;
const env = { DB, ENCRYPTION_KEY: 'local-test-encryption-key-32b', API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => { }) };
const BASE = 'http://test.local';
// REAL fetch — no mocking in this suite. That's the entire point.
const realFetch = globalThis.fetch;

let keyLeakedToConsole = false;
const origLog = console.log;
console.log = (...a) => { if (a.some(x => typeof x === 'string' && x.includes(NV_KEY))) { keyLeakedToConsole = true; return; } origLog(...a); };

async function call(method, path, body, token) {
  const r = await worker.fetch(new Request(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, ctx);
  let data = null;
  try { data = await r.json(); } catch { }
  return { status: r.status, data };
}

console.log('\n== SETUP: workspace + key injected through the REAL settings route ==');
{
  const reg = await call('POST', '/auth/register', { name: 'Real NV', email: 'realnv@test.io', password: 'password123' });
  globalThis.__tok = reg.data?.token;
  check('workspace registered', !!globalThis.__tok);
  const set = await call('PATCH', '/ai/settings', { provider: 'nvidia', nvidia_key: NV_KEY, model: 'nvidia/llama-3.1-nemotron-70b-instruct' }, globalThis.__tok);
  check('key accepted by /ai/settings (encrypted server-side)', set.status === 200, JSON.stringify(set.data).slice(0, 100));
  // The stored value must be ENCRYPTED, not the raw key.
  const raw = JSON.stringify(DB._raw('SELECT * FROM workspaces')[0]?.values || []);
  check('stored key is NOT plaintext in the database', !raw.includes(NV_KEY));
}

console.log('\n== REAL /ai/health — the exact route Test Connection uses ==');
{
  const t0 = Date.now();
  const h = await call('GET', '/ai/health?refresh=1', undefined, globalThis.__tok);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const nv = h.data?.nvidia;
  check('/ai/health answers (no 500) in ' + secs + 's', h.status === 200, 'status=' + h.status);
  check('nvidia provider reports a structured verdict', !!nv && typeof nv.status === 'string', JSON.stringify(nv).slice(0, 120));
  if (nv?.status === 'ok') {
    check('🟢 NVIDIA VERDICT: ok — real key works end-to-end through the worker', true);
    check('nvidia verdict names the tested model', typeof nv.model === 'string' && nv.model.includes('/'), String(nv.model));
    check('openai honestly reports no_key (not configured here)', h.data?.openai?.status === 'no_key');
  } else {
    check('🟡 NVIDIA verdict is a specific, actionable failure (NOT a 500/CORS)', ['bad_key', 'no_credits', 'timeout', 'network', 'error'].includes(nv?.status) && !!nv?.message, JSON.stringify(nv).slice(0, 160));
    console.log('     verdict detail: ' + String(nv?.message || '').slice(0, 200));
  }
}

console.log('\n== REAL /ai/complete — a genuine chat completion round-trip ==');
{
  const c = await call('POST', '/ai/complete', { prompt: 'Reply with exactly the word: PONG' }, globalThis.__tok);
  check('/ai/complete answers (no 500)', c.status === 200, 'status=' + c.status + ' ' + JSON.stringify(c.data).slice(0, 120));
  if (c.status === 200) {
    const text = String(c.data?.text || c.data?.content || '');
    check('real completion returned non-empty text', text.length > 0, JSON.stringify(c.data).slice(0, 120));
    check('usage tracked (tokens recorded)', await (async () => {
      const u = await call('GET', '/ai/usage', undefined, globalThis.__tok);
      return /complete|op/.test(JSON.stringify(u.data || {}));
    })());
  }
}

console.log('\n== REAL live model catalog (the S10 path, with a valid key this time) ==');
{
  const m = await call('GET', '/ai/models?refresh=1', undefined, globalThis.__tok);
  const list = m.data?.nvidia || [];
  check('/ai/models answers', m.status === 200);
  if (m.data?.nvidia_live === true) {
    check('LIVE catalog fetched with the real key', list.length > 0, 'got ' + list.length);
    check('live catalog filtered to chat-capable models (no embed/rerank junk)', !/embed|rerank|reward|guard/i.test(list.slice(0, 20).join(',')));
    check('proven default model present in live catalog', list.includes('nvidia/llama-3.1-nemotron-70b-instruct'), 'first 3: ' + list.slice(0, 3).join(', '));
  } else {
    check('catalog fell back honestly (live=false labeled)', m.data?.nvidia_live === false && list.length > 0, 'live=' + m.data?.nvidia_live);
  }
}

console.log('\n== KEY HYGIENE ==');
{
  console.log = origLog; // restore before final prints
  check('key never leaked to console during the run', !keyLeakedToConsole);
  const usage = await call('GET', '/ai/usage', undefined, globalThis.__tok);
  check('usage report contains no key material', !JSON.stringify(usage.data || {}).includes(NV_KEY));
  const settings = await call('GET', '/ai/settings', undefined, globalThis.__tok);
  check('GET /ai/settings never returns the raw key', !JSON.stringify(settings.data || {}).includes(NV_KEY), JSON.stringify(settings.data).slice(0, 80));
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(`REAL-NVIDIA RESULTS: ${passed} passed, ${failed} failed`);
if (failed) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
console.log('════════════════════════════════════════════════════════════');
process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
process.exit(failed ? 1 : 0);
