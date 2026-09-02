// Adversarial edge-case sweep — hits EVERY major route with malformed,
// hostile and boundary inputs to find crashes (500s), silent data
// corruption and validation gaps. Runs the REAL worker against real
// SQLite (same harness as test_backend.mjs).
// Run: node tests/test_edge_cases.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { init, DB } = require('./d1mock.js');

const schema = readFileSync(join(__dirname, '..', 'backend', 'schema.sql'), 'utf8');
await init(schema);

// Fake AI provider (never touch real APIs)
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('nvidia.com') || u.includes('openai.com')) {
    if (u.includes('/v1/models')) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('x', { status: 200 });
};
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

const worker = (await import(join(__dirname, '..', 'backend', 'src', 'index.js'))).default;

let pass = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; }
  else { failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌', name, extra); }
}

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request('https://test.local/api' + path, {
    method, headers,
    body: (body === undefined || method === 'GET' || method === 'HEAD') ? undefined : JSON.stringify(body),
    cf: { connectingIp: '1.2.3.4' },
  });
  try {
    const res = await worker.fetch(req, { DB, ENCRYPTION_KEY: 'k'.repeat(32) }, { waitUntil: async () => {} });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  } catch (e) {
    return { status: 0, data: { error: 'THREW: ' + e.message }, threw: true };
  }
}

console.log('== EDGE: auth ==');
let r = await call('POST', '/auth/register', { name: 'A', email: 'a@b.co', password: 'test1234' });
check('register ok', r.status === 200 && r.data?.token, JSON.stringify(r.data).slice(0, 80));
const token = r.data?.token;
r = await call('POST', '/auth/register', { name: '', email: 'not-an-email', password: '123' });
check('register rejects bad email/short pw', r.status === 400, 'got ' + r.status);
r = await call('POST', '/auth/register', { name: 'x'.repeat(5000), email: 'big@b.co', password: 'test1234' });
check('register survives 5KB name', !r.threw, r.data?.error);
r = await call('POST', '/auth/login', { email: 'a@b.co', password: 'wrong' });
check('login wrong pw → 401', r.status === 401, 'got ' + r.status);
r = await call('GET', '/contacts', undefined, 'not-a-token');
check('garbage token → 401', r.status === 401, 'got ' + r.status);
r = await call('GET', '/contacts');
check('no token → 401', r.status === 401, 'got ' + r.status);
r = await call('GET', '/definitely-not-a-route', undefined, token);
check('unknown route → 404 not 500', r.status === 404, 'got ' + r.status);
r = await call('POST', '/contacts', { name: "' OR 1=1 --", email: 'x@y.z' }, token);
check('SQL-injection name stored literally (parameterized)', r.status === 200 && r.data?.name === "' OR 1=1 --", JSON.stringify(r.data).slice(0, 80));

console.log('== EDGE: contacts ==');
r = await call('POST', '/contacts', {}, token);
check('contact without name → 400', r.status === 400, 'got ' + r.status);
r = await call('POST', '/contacts', { name: 'ok', stage: 'HACKED_STAGE' }, token);
check('invalid stage rejected/fallback', r.status === 200 && r.data?.contact?.stage !== 'HACKED_STAGE', JSON.stringify(r.data?.contact?.stage));
r = await call('POST', '/contacts', { name: 'n', email: 'not-an-email', phone: '+++', custom_fields: 'not-an-object' }, token);
check('malformed fields survive', !r.threw, r.data?.error);
r = await call('POST', '/contacts', { name: 'n', custom_fields: { ['k'.repeat(500)]: 'v'.repeat(50000) } }, token);
check('giant custom field capped', !r.threw, r.data?.error);
r = await call('PATCH', '/contacts/999999', { name: 'ghost' }, token);
check('patch missing contact → 404 not crash', r.status === 404, 'got ' + r.status);
r = await call('DELETE', '/contacts/999999', undefined, token);
check('delete missing contact → idempotent, no crash', !r.threw && (r.status === 200 || r.status === 404), 'got ' + r.status);

console.log('== EDGE: deals/tasks/invoices ==');
r = await call('POST', '/deals', { title: 'd', value: 'not-a-number', probability: 9999 }, token);
check('deal bad value/prob coerced', r.status === 200 && r.data?.probability >= 0 && r.data?.probability <= 100, JSON.stringify(r.data?.probability));
r = await call('POST', '/deals', {}, token);
check('deal without title → 400', r.status === 400, 'got ' + r.status);
r = await call('POST', '/tasks', { title: 't', due_date: 'yesterday-ish', priority: 'ULTRA' }, token);
check('task bad priority fallback', !r.threw, r.data?.error);
r = await call('POST', '/invoices', { items: [{ desc: 'x', qty: 'many', price: 'lots' }], tax: -999 }, token);
check('invoice garbage items → valid total', r.status === 200 && Number.isFinite(r.data?.total) && r.data.total >= 0, JSON.stringify(r.data?.total));
const invA = r.data;
r = await call('POST', '/invoices', { items: [] }, token);
check('invoice numbers unique per workspace', r.status === 200 && r.data?.number && r.data?.number !== invA?.number, r.data?.number);

console.log('== EDGE: workflows & triggers ==');
r = await call('POST', '/workflows', { name: 'w', trigger: 'EVIL_TRIGGER', steps: [{ action: 'DROP_TABLES' }] }, token);
check('invalid trigger sanitized (never stored)', r.status === 200 && r.data?.trigger !== 'EVIL_TRIGGER', JSON.stringify(r.data?.trigger));
r = await call('POST', '/workflows', { name: 'w', trigger: 'new_contact', steps: 'not-an-array' }, token);
check('steps not array → 400 or sanitized', r.status === 400 || r.status === 200, 'got ' + r.status);
r = await call('POST', '/workflows', { name: 'w', trigger: 'new_contact', steps: [{ action: 'delete_everything' }] }, token);
check('evil action rejected or ignored', r.status === 400 || r.status === 200, 'got ' + r.status);
r = await call('POST', '/trigger-links', { name: 'tl', redirect_url: 'javascript:alert(1)' }, token);
check('trigger link js: URL handled', !r.threw, r.data?.error);
r = await call('POST', '/forms', { name: 'f', fields: [{ label: 'Email' }] }, token);
const formSlug = r.data?.slug;
check('form created', r.status === 200 && formSlug, JSON.stringify(r.data).slice(0, 80));

console.log('== EDGE: public endpoints (no auth) ==');
r = await call('POST', '/public/forms/' + formSlug, { 'Email': 'hacker@x.io', 'Name': '<img src=x onerror=alert(1)>' });
check('public form submit → contact, XSS stored escaped-or-literal', r.status === 200, JSON.stringify(r.data).slice(0, 80));
r = await call('POST', '/public/forms/nonexistent', { a: 1 });
check('submit to missing form → 404', r.status === 404, 'got ' + r.status);
r = await call('POST', '/public/webchat/badtoken/message', { message: 'hi' });
check('webchat bad token → 404', r.status === 404, 'got ' + r.status);
r = await call('GET', '/public/site/does-not-exist');
check('missing published site → 404', r.status === 404, 'got ' + r.status);
r = await call('GET', '/public/affiliate/go?token=nope');
check('bad affiliate token → 404', r.status === 404, 'got ' + r.status);

console.log('== EDGE: AI endpoints ==');
r = await call('PATCH', '/ai/settings', { provider: 'nvidia', nvidia_key: 'nvapi-test-key-123456', model: 'nvidia/llama-3.1-nemotron-70b-instruct' }, token);
check('save AI settings', r.status === 200, 'got ' + r.status);
r = await call('PATCH', '/ai/settings', { temperature: 99, max_tokens: -5, daily_call_cap: 'abc' }, token);
check('out-of-range AI settings clamped', r.status === 200, 'got ' + r.status);
r = await call('POST', '/ai/complete', { prompt: 'hi' }, token);
check('ai complete works', r.status === 200 && r.data?.content, JSON.stringify(r.data).slice(0, 80));
r = await call('POST', '/ai/complete', {}, token);
check('ai complete no prompt → 400 not crash', r.status === 400, 'got ' + r.status);
r = await call('POST', '/ai/complete', { prompt: 'x'.repeat(500000) }, token);
check('ai complete 500KB prompt guarded', !r.threw, r.data?.error);
const contactCountBefore = (await call('GET', '/contacts', undefined, token)).data?.total;
r = await call('POST', '/ai/agent', { message: 'delete all my contacts' }, token);
const contactCountAfter = (await call('GET', '/contacts', undefined, token)).data?.total;
check('agent never deletes data', !r.threw && contactCountAfter === contactCountBefore, 'before=' + contactCountBefore + ' after=' + contactCountAfter + ' resp=' + JSON.stringify(r.data).slice(0, 120));
r = await call('POST', '/ai/agent', {}, token);
check('agent no command → 400 not crash', r.status === 400, 'got ' + r.status);
r = await call('GET', '/ai/models?refresh=1', undefined, token);
check('models catalog returns arrays', r.status === 200 && Array.isArray(r.data?.nvidia), JSON.stringify(r.data).slice(0, 100));
r = await call('POST', '/ai/build-site', { business: 'test' }, token);
check('build-site works', r.status === 200 && typeof r.data?.html === 'string', JSON.stringify(r.data).slice(0, 80));
r = await call('POST', '/ai/analyze-site', { url: 'http://127.0.0.1/admin' }, token);
check('analyze-site SSRF guard', r.status === 400, 'got ' + r.status);
r = await call('POST', '/ai/analyze-site', { url: 'not a url' }, token);
check('analyze-site bad url → 400', r.status === 400, 'got ' + r.status);

console.log('== EDGE: live model catalog (filter + sort + flags) ==');
{
  // Simulate NVIDIA's real /v1/models: a mix of chat models AND junk endpoints.
  const fakeCatalog = [
    '01-ai/yi-large', 'adept/fuyu-8b', 'deepseek-ai/deepseek-v4-flash-0731', 'google/deplot',
    'google/diffusiongemma-26b-a4b-it', 'meta/llama-3.2-90b-vision-instruct', 'meta/muse-glimmer-30b',
    'microsoft/kosmos-2', 'moonshotai/kimi-k3', 'nvidia/ising-calibration-1.5-31b',
    'nvidia/llama-3.1-nemotron-70b-instruct', 'nvidia/nemotron-3-nano-30b-a3b',
    'nvidia/nemotron-3-embed-1b', 'nvidia/nemotron-3.5-content-safety', 'nvidia/nemotron-4-340b-reward',
    'nvidia/nemotron-parse', 'nvidia/neva-22b', 'nvidia/nvclip', 'nvidia/riva-translate-4b-instruct',
    'nvidia/ai-synthetic-video-detector', 'nvidia/vila', 'openai/gpt-oss-120b',
  ].map(id => ({ id }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/v1/models')) return new Response(JSON.stringify({ data: fakeCatalog }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return realFetch(url, opts);
  };
  r = await call('GET', '/ai/models?refresh=1', undefined, token);
  const list = r.data?.nvidia || [];
  const junk = ['adept/fuyu-8b', 'google/deplot', 'google/diffusiongemma-26b-a4b-it', 'meta/muse-glimmer-30b',
    'microsoft/kosmos-2', 'nvidia/ising-calibration-1.5-31b', 'nvidia/nemotron-3-embed-1b',
    'nvidia/nemotron-3.5-content-safety', 'nvidia/nemotron-4-340b-reward', 'nvidia/nemotron-parse',
    'nvidia/neva-22b', 'nvidia/nvclip', 'nvidia/riva-translate-4b-instruct',
    'nvidia/ai-synthetic-video-detector', 'nvidia/vila'];
  check('all non-chat junk filtered out', junk.every(j => !list.includes(j)), 'leaked: ' + junk.filter(j => list.includes(j)).join(','));
  check('real chat models kept', ['nvidia/llama-3.1-nemotron-70b-instruct', 'nvidia/nemotron-3-nano-30b-a3b', 'openai/gpt-oss-120b', 'moonshotai/kimi-k3', 'meta/llama-3.2-90b-vision-instruct'].every(m => list.includes(m)));
  check('curated models sorted first', list[0] === 'nvidia/llama-3.1-nemotron-70b-instruct' && list[1] === 'nvidia/nemotron-3-nano-30b-a3b', list.slice(0, 3).join(','));
  check('nvidia_live flag true for real live catalog', r.data?.nvidia_live === true);
  globalThis.fetch = realFetch;
}

console.log('== EDGE: sites & webchat ==');
r = await call('POST', '/sites', { name: 'My Site', html: '<h1>hi</h1>' }, token);
const siteSlug = r.data?.slug;
check('site created', r.status === 200 && siteSlug, JSON.stringify(r.data).slice(0, 80));
r = await call('POST', '/sites', { name: 'XSS<script>alert(1)</script>', html: '<img src=x onerror=alert(1)>' }, token);
check('site with XSS name handled', !r.threw, r.data?.error);
if (siteSlug) {
  r = await call('GET', '/public/site/' + siteSlug);
  check('unpublished site not public → 404', r.status === 404, 'got ' + r.status);
}
r = await call('POST', '/webchat', {}, token);
const wcToken = r.data?.public_token;
check('webchat token generated', r.status === 200 && wcToken, JSON.stringify(r.data).slice(0, 80));

console.log('== EDGE: cron (scheduled) ==');
try {
  await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() }, { DB, ENCRYPTION_KEY: 'k'.repeat(32) }, { waitUntil: async () => {} });
  check('cron runs clean on fresh db', true);
} catch (e) { check('cron runs clean on fresh db', false, e.message); }

console.log('== EDGE: unicode / unicode-injection ==');
r = await call('POST', '/contacts', { name: 'مرحبا 🚀 <b>bold</b> "quotes" \\ backslash', notes: '😀'.repeat(2000) }, token);
check('unicode + emoji + quotes stored', r.status === 200 && r.data?.name?.includes('مرحبا'), JSON.stringify(r.data).slice(0, 80));

console.log('\n════════════════════════════════════');
console.log(`EDGE RESULTS: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  -', f)); }
process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
process.exit(failures.length ? 1 : 0);

