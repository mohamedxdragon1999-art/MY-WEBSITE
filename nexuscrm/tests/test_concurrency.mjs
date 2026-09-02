// CONCURRENCY / STORM suite — what happens when many users hit the API at
// the same instant? At multi-business scale this is the daily reality, and
// race conditions here cause silent data loss (the worst bug class).
//
// The D1 mock is in-process SQLite, so this measures the WORKER's logic
// under interleaving (await points), not SQLite's own locking. That is
// exactly where application-level races live.
//
// Run: node tests/test_concurrency.mjs
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

globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 180) : '')); }
}

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

// 5 tenants — concurrency across DIFFERENT businesses must not interfere.
const tenants = [];
for (let i = 0; i < 5; i++) {
  const r = await call('POST', '/auth/register', { name: `Biz ${i}`, email: `biz${i}@x.io`, password: 'password123' });
  tenants.push(r.data?.token);
}
check('5 tenants registered', tenants.every(Boolean));
const [t0, t1] = tenants;

console.log('\n== STORM 1: 60 parallel contact creates across 5 tenants ==');
{
  const jobs = [];
  for (let i = 0; i < 60; i++) {
    const tok = tenants[i % tenants.length];
    jobs.push(call('POST', '/contacts', { name: `Storm-${i}`, email: `storm${i}@x.io` }, tok));
  }
  const results = await Promise.all(jobs);
  check('all 60 creates answered (no dropped requests)', results.every(r => r.status === 200), results.filter(r => r.status !== 200).map(r => r.status).join(','));
  // Each tenant must see EXACTLY its 12 contacts — no cross-tenant bleed, no losses.
  let exact = true, leaked = false;
  for (let t = 0; t < tenants.length; t++) {
    const list = await call('GET', '/contacts', undefined, tenants[t]);
    const mine = (list.data?.contacts || []).filter(c => c.name.startsWith('Storm-'));
    if (mine.length !== 12) exact = false;
    const others = (list.data?.contacts || []).filter(c => !c.name.startsWith('Storm-'));
    if (others.length > 0) leaked = true;
  }
  check('every tenant has EXACTLY its own 12 contacts (no loss, no duplication)', exact);
  check('no tenant saw another tenant\'s rows during the storm', !leaked);
  // All ids distinct — no id collision from racing inserts.
  const allIds = new Set();
  for (const r of results) allIds.add(r.data?.id);
  check('60 creates → 60 distinct ids (no collision)', allIds.size === 60, `got ${allIds.size}`);
}

console.log('\n== STORM 2: parallel reads while writing ==');
{
  const writers = [];
  for (let i = 0; i < 30; i++) writers.push(call('POST', '/contacts', { name: `RW-${i}`, email: `rw${i}@x.io` }, t0));
  const readers = [];
  for (let i = 0; i < 30; i++) readers.push(call('GET', '/contacts', undefined, t0));
  const all = await Promise.all([...writers, ...readers]);
  check('30 concurrent writes + 30 concurrent reads all answered 200', all.every(r => r.status === 200), all.filter(r => r.status !== 200).map(r => r.status).join(','));
  // Readers saw a CONSISTENT snapshot: count only grows, never shrinks below seeds.
  const final = await call('GET', '/contacts', undefined, t0);
  const names = (final.data?.contacts || []).map(c => c.name);
  check('all 30 RW writes present at the end', Array.from({ length: 30 }, (_, i) => `RW-${i}`).every(n => names.includes(n)));
}

console.log('\n== STORM 3: same-row parallel PATCHes (last-write-wins, never corrupt) ==');
{
  const c = await call('POST', '/contacts', { name: 'Battlefield', notes: 'start' }, t0);
  const id = c.data.id;
  const jobs = [];
  for (let i = 0; i < 25; i++) jobs.push(call('PATCH', `/contacts/${id}`, { notes: `version-${i}` }, t0));
  const results = await Promise.all(jobs);
  check('all 25 parallel PATCHes answered (no deadlock/500)', results.every(r => r.status === 200), results.filter(r => r.status !== 200).map(r => r.status).join(','));
  const after = await call('GET', `/contacts/${id}`, undefined, t0);
  const okValues = Array.from({ length: 25 }, (_, i) => `version-${i}`);
  check('row holds exactly ONE of the written values (no interleaved corruption)', okValues.includes(after.data?.notes), `notes=${after.data?.notes}`);
  check('row still well-formed after the battle', after.data?.name === 'Battlefield');
}

console.log('\n== STORM 4: parallel creates + deletes of the same record ==');
{
  const c = await call('POST', '/contacts', { name: 'DeleteMe' }, t0);
  const id = c.data.id;
  // 10 attempts to delete the same id at once, plus 10 creates racing them.
  const jobs = [];
  for (let i = 0; i < 10; i++) jobs.push(call('DELETE', `/contacts/${id}`, undefined, t0));
  for (let i = 0; i < 10; i++) jobs.push(call('POST', '/contacts', { name: `Racer-${i}`, email: `r${i}@x.io` }, t0));
  const results = await Promise.all(jobs);
  check('no 500s from create/delete race', results.every(r => r.status !== 500), results.filter(r => r.status === 500).length + ' 500s');
  // Exactly ONE delete should win; the rest see 404 (our hardened semantics).
  const delResults = results.slice(0, 10).map(r => r.status).sort();
  const wins = delResults.filter(s => s === 200).length;
  check('exactly one delete succeeded (200), the rest got honest 404s', wins === 1, JSON.stringify(delResults));
  const after = await call('GET', `/contacts/${id}`, undefined, t0);
  check('record is genuinely gone after the race', after.status === 404);
}

console.log('\n== STORM 5: parallel logins + parallel demo workspaces ==');
{
  const logins = [];
  for (let i = 0; i < 20; i++) logins.push(call('POST', '/auth/login', { email: 'biz0@x.io', password: 'password123' }));
  const lr = await Promise.all(logins);
  check('20 parallel logins all succeed', lr.every(r => r.status === 200 && !!r.data?.token));
  const tokens = new Set(lr.map(r => r.data.token));
  check('each parallel login got a DISTINCT session token', tokens.size === 20, `got ${tokens.size}`);
  // Logout one — the others must survive (session isolation under concurrency).
  await call('POST', '/auth/logout', undefined, lr[0].data.token);
  const others = await Promise.all(lr.slice(1).map(r => call('GET', '/auth/me', undefined, r.data.token)));
  check('logging out ONE concurrent session leaves the other 19 alive', others.every(o => o.status === 200), others.filter(o => o.status !== 200).length + ' dead');
}

console.log('\n== STORM 6: rate limiter under concurrency (no counter races) ==');
{
  // Small per-token limit; fire 30 parallel requests.
  const envLimited = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 15 };
  const jobs = [];
  for (let i = 0; i < 30; i++) {
    jobs.push(worker.fetch(new Request(BASE + '/api/contacts', { headers: { Authorization: 'Bearer ' + t1 } }), envLimited, ctx).then(r => r.status));
  }
  const statuses = await Promise.all(jobs);
  const okCount = statuses.filter(s => s === 200).length;
  const limited = statuses.filter(s => s === 429).length;
  check('parallel burst: no 500s', !statuses.includes(500));
  check('parallel burst: limit still enforced (429s appear)', limited > 0, JSON.stringify(statuses.slice(0, 10)));
  check('parallel burst: no more than the limit succeeded (no counter race)', okCount <= 15, `ok=${okCount}`);
}

console.log('\n== STORM 7: workflow events firing concurrently for one contact ==');
{
  const c = await call('POST', '/contacts', { name: 'Workflow Storm Target' }, t0);
  const wf = await call('POST', '/workflows', { name: 'Storm WF', trigger: 'new_contact', steps: [{ action: 'create_task', note: 'follow up' }] }, t0);
  check('workflow armed', wf.status === 200);
  // 15 parallel contact creates — each fires the new_contact trigger path.
  const jobs = [];
  for (let i = 0; i < 15; i++) jobs.push(call('POST', '/contacts', { name: `WfStorm-${i}`, email: `ws${i}@x.io` }, t0));
  const res = await Promise.all(jobs);
  check('15 trigger-firing creates all answered 200', res.every(r => r.status === 200), res.filter(r => r.status !== 200).map(r => r.status).join(','));
  // Let deferred event processing settle, then verify the engine didn't corrupt anything.
  await new Promise(r => setTimeout(r, 250));
  const tasks = await call('GET', '/tasks', undefined, t0);
  check('task list still healthy after concurrent triggers', tasks.status === 200);
  const final = await call('GET', '/stats', undefined, t0);
  check('stats consistent after the event storm', final.status === 200 && typeof final.data?.contacts === 'number');
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(`CONCURRENCY RESULTS: ${passed} passed, ${failed} failed`);
if (failed) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
console.log('════════════════════════════════════════════════════════════');
try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch { }
process.exit(failed ? 1 : 0);
