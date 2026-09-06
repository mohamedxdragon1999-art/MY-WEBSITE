// REAL RUNTIME GATE — the Worker must bundle with wrangler and BOOT IN WORKERD.
//
// Every other suite imports backend/src/index.js into Node, where `require()`
// of anything on disk works. Cloudflare Workers is not Node: wrangler bundles
// the module graph with esbuild and workerd executes it with no filesystem,
// no `process`, no child processes and no Node built-ins unless nodejs_compat.
// Until this suite existed nothing checked that boundary — and the checked-in
// code could not deploy at all (nx_structured.js required jsdom → 16
// unresolved Node built-ins → `wrangler deploy` failed; nx_browser.js used a
// dynamic `import(mod)` that workerd's module scanner rejects).
//
// This suite:
//   1. runs `wrangler deploy --dry-run` (the real esbuild bundle) and pins the
//      bundle under the Workers size limits (Free: 1 MiB gzipped; Paid 10 MiB),
//   2. boots that exact bundle in miniflare 3 (= workerd, the production
//      runtime binary) with a real D1 database and the production schema,
//   3. drives the product journey end-to-end INSIDE workerd: register → build
//      (deterministic + widgets) → publish → anonymous public serve → lead
//      webhook → AI settings → provider catalog → chat stream error path,
//   4. proves the page workerd renders is byte-identical to the Node harness
//      (so every other suite's evidence transfers to production).
//
// Skips honestly (never fakes green) when wrangler/miniflare are not installed.
// Run: node tests/test_workerd_runtime.mjs
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
function done() {
  console.log(`\nWORKERD RESULTS: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); }
  process.exit(failed ? 1 : 0);
}

const wranglerBin = join(ROOT, 'node_modules', '.bin', 'wrangler');
let Miniflare = null;
try { ({ Miniflare } = await import('miniflare')); } catch (e) { /* not installed */ }
if (!existsSync(wranglerBin) || !Miniflare) {
  console.log('WORKERD RESULTS: 0 passed, 0 failed (SKIPPED — install devDependencies: npm install)');
  process.exit(0);
}

// ── 1. Bundle exactly the way `wrangler deploy` does ────────────────────────
console.log('\n== 1. wrangler bundle (esbuild, production module graph) ==');
const outDir = join(ROOT, '.arena', 'dist');
mkdirSync(outDir, { recursive: true });
const build = spawnSync(wranglerBin, ['deploy', '--dry-run', '--outdir', outDir], {
  cwd: join(ROOT, 'backend'), encoding: 'utf8', timeout: 240_000,
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' },
});
const buildOut = (build.stdout || '') + (build.stderr || '');
const unresolved = [...buildOut.matchAll(/Could not resolve "([^"]+)"/g)].map((m) => m[1]);
check('wrangler deploy --dry-run succeeds (exit 0)', build.status === 0, 'exit ' + build.status + ' ' + buildOut.split('\n').filter((l) => /ERROR|error/.test(l)).slice(0, 3).join(' | ').slice(0, 300));
check('no unresolved imports (Node built-ins / npm packages that cannot run in workerd)', unresolved.length === 0, [...new Set(unresolved)].join(', '));
check('no "nodejs_compat" warnings (the Worker does not depend on Node APIs)', !/nodejs_compat/.test(buildOut), 'bundle references Node built-ins');
const bundlePath = join(outDir, 'index.js');
check('bundle written', existsSync(bundlePath));
if (!existsSync(bundlePath) || build.status !== 0) done();
const bundle = readFileSync(bundlePath);
const gz = gzipSync(bundle).length;
console.log(`  bundle ${(bundle.length / 1024).toFixed(0)} KiB raw / ${(gz / 1024).toFixed(0)} KiB gzip`);
check('bundle under the Workers FREE plan limit (1 MiB gzipped)', gz < 1024 * 1024, (gz / 1024).toFixed(0) + ' KiB');
check('bundle under 3.5 MiB raw (startup-time guard; Paid plan allows 10 MiB gzipped)', bundle.length < 3.5 * 1024 * 1024, (bundle.length / 1024).toFixed(0) + ' KiB');
const src = bundle.toString('utf8');
check('no jsdom / playwright code in the production bundle', !/node_modules\/jsdom\//.test(src) && !/node_modules\/playwright/.test(src));
check('no secrets or key material in the bundle', !/nvapi-[A-Za-z0-9_-]{20,}/.test(src) && !/sk-[A-Za-z0-9]{32,}/.test(src));

// ── 2. Boot in workerd with a real D1 + the production schema ───────────────
console.log('\n== 2. boot in workerd (miniflare 3 = the production runtime binary) ==');
const mf = new Miniflare({
  modules: true,
  scriptPath: bundlePath,
  compatibilityDate: '2025-06-01',
  d1Databases: { DB: 'nexuscrm-workerd-test' },
  // ALLOWED_ORIGINS set = production posture (unset keeps local dev permissive).
  bindings: { ENCRYPTION_KEY: 'k'.repeat(32), API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9, ALLOWED_ORIGINS: 'http://nexus.test,https://dashboard.example' },
  // Outbound fetch from the Worker must never reach the internet in tests.
  outboundService: async (req) => {
    const u = req.url;
    if (/\/models(\?|$)/.test(u)) return new Response(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  },
});
let booted = false;
try {
  const db = await mf.getD1Database('DB');
  const clean = readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  const stmts = clean.split(';').map((s) => s.trim()).filter(Boolean);
  let bad = 0;
  for (const s of stmts) { try { await db.exec(s.replace(/\s*\n\s*/g, ' ')); } catch (e) { bad++; if (bad < 3) console.log('   schema error:', e.message.slice(0, 160)); } }
  check(`production schema.sql applies to real D1 (${stmts.length} statements)`, bad === 0, bad + ' failed');
  booted = true;
} catch (e) {
  check('workerd boots the bundle', false, String(e && e.message || e).slice(0, 400));
}
if (!booted) { await mf.dispose(); done(); }

const call = async (method, path, body, token, extraHeaders) => {
  const r = await mf.dispatchFetch('http://nexus.test' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'http://nexus.test', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(extraHeaders || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch (e) { data = null; }
  return { status: r.status, data, text, headers: r.headers };
};

const health = await call('GET', '/api/health');
check('GET /api/health → 200 {ok:true} inside workerd', health.status === 200 && health.data && health.data.ok === true, health.status + ' ' + health.text.slice(0, 120));

// ── 3. The product journey, inside workerd ──────────────────────────────────
console.log('\n== 3. end-to-end journey inside workerd ==');
const reg = await call('POST', '/api/auth/register', { name: 'Workerd Owner', email: 'owner@workerd.test', password: 'password123' });
check('register → 200 + token (PBKDF2 via WebCrypto works in workerd)', reg.status === 200 && reg.data && typeof reg.data.token === 'string', reg.status + ' ' + reg.text.slice(0, 120));
const tok = reg.data && reg.data.token;
const dup = await call('POST', '/api/auth/register', { name: 'Dup', email: 'owner@workerd.test', password: 'password123' });
check('duplicate email → 409', dup.status === 409, String(dup.status));
const login = await call('POST', '/api/auth/login', { email: 'owner@workerd.test', password: 'password123' });
check('login → 200 (constant-time hash verify in workerd)', login.status === 200 && login.data && login.data.token, String(login.status));
const me = await call('GET', '/api/auth/me', undefined, tok);
check('auth/me → 200 with the user + workspace_id', me.status === 200 && me.data && me.data.user && me.data.user.workspace_id === reg.data.user.workspace_id, me.text.slice(0, 100));

const BRIEF = 'Private dental clinic in Leeds: teeth whitening from £299, Invisalign braces from £2,400, dental implants £1,950, hygienist visits £65. Call 0113 274 9911 or WhatsApp +44 7700 900123. Email hello@apexdental.co.uk.';
const t0 = Date.now();
const site = await call('POST', '/api/sites', { name: 'Apex Dental', description: BRIEF, build_with_ai: true, deterministic: true, published: true }, tok);
const buildMs = Date.now() - t0;
check('POST /sites (deterministic build) → 200 with a full page', site.status === 200 && site.data && typeof site.data.html === 'string' && site.data.html.length > 30_000, site.status + ' ' + site.text.slice(0, 160));
check('build reports widgets chosen from the brief facts (estimator + funnel + sticky)', Array.isArray(site.data?.build?.widgets) && ['estimator', 'funnel', 'stickycta'].every((k) => site.data.build.widgets.includes(k)), JSON.stringify(site.data?.build?.widgets));
check('brief facts reached the page (phone, WhatsApp, email, prices)', ['0113 274 9911', '447700900123', 'hello@apexdental', '2,400', '1,950'].every((n) => (site.data?.html || '').includes(n)));
check('deterministic build wall time < 3 s in workerd', buildMs < 3000, buildMs + ' ms');
console.log(`   (POST /sites took ${buildMs} ms in workerd)`);

const list = await call('GET', '/api/sites', undefined, tok);
check('GET /sites lists the site with its design id', list.status === 200 && Array.isArray(list.data?.sites) && list.data.sites.length === 1 && list.data.sites[0].design_id, list.text.slice(0, 120));
const slug = site.data && site.data.slug;

const pub = await mf.dispatchFetch('http://nexus.test/s/' + slug);
const pubHtml = await pub.text();
check('anonymous GET /s/:slug → 200 text/html with CSP + SAMEORIGIN', pub.status === 200 && /text\/html/.test(pub.headers.get('content-type') || '') && !!pub.headers.get('content-security-policy') && pub.headers.get('x-frame-options') === 'SAMEORIGIN', pub.status + ' ' + (pub.headers.get('content-type') || ''));
check('public page is the published HTML (same length as the build)', pubHtml.length === site.data.html.length, pubHtml.length + ' vs ' + site.data.html.length);
const pub404 = await mf.dispatchFetch('http://nexus.test/s/does-not-exist');
check('unknown slug → 404 page (not a 500, not a leak)', pub404.status === 404);
const evil = await mf.dispatchFetch('http://nexus.test/api/public/site/' + slug, { headers: { Origin: 'https://evil.example' } });
check('public site API: unvetted origin gets the page but NO CORS grant and SAMEORIGIN framing', evil.status === 200 && !evil.headers.get('access-control-allow-origin') && evil.headers.get('x-frame-options') === 'SAMEORIGIN', (evil.headers.get('access-control-allow-origin') || '-') + ' / ' + (evil.headers.get('x-frame-options') || '-'));
const vetted = await mf.dispatchFetch('http://nexus.test/api/public/site/' + slug, { headers: { Origin: 'https://dashboard.example' } });
check('public site API: ALLOWED_ORIGINS origin gets CORS + frame-ancestors grant (dashboard preview)', vetted.status === 200 && vetted.headers.get('access-control-allow-origin') === 'https://dashboard.example' && /frame-ancestors[^;]*dashboard\.example/.test(vetted.headers.get('content-security-policy') || ''), (vetted.headers.get('access-control-allow-origin') || '-'));
// The API is Bearer-authenticated (no cookies): reflecting Origin there is not
// a grant, and a browser cannot obtain the token cross-site. What WOULD make
// reflection dangerous is Allow-Credentials — it must never appear.
const evilApi = await call('GET', '/api/sites', undefined, tok, { Origin: 'https://evil.example' });
check('authenticated API never sets Access-Control-Allow-Credentials (bearer-only, no ambient auth)', !evilApi.headers.get('access-control-allow-credentials'), evilApi.headers.get('access-control-allow-credentials') || '-');
const noTok = await call('GET', '/api/sites', undefined, null, { Origin: 'https://evil.example' });
check('authenticated API without a token → 401 (nothing ambient grants access)', noTok.status === 401, String(noTok.status));

const leadUrl = String(site.data.lead_url || '').replace(/^https?:\/\/[^/]+/, '');
check('build returns the lead_url for the page runtime', /^\/api\/public\/webhook\/[A-Za-z0-9]+$/.test(leadUrl), leadUrl);
const lead = await call('POST', leadUrl, { event: 'site_lead', name: 'Visitor One', email: 'visitor@example.com', phone: '0777 000 000', message: 'Need whitening', source_widget: 'funnel' }, null, { Origin: 'https://apexdental.example' });
check('public lead webhook → 200 {ok:true} (workerd, no auth)', lead.status === 200 && lead.data && lead.data.ok === true, lead.text.slice(0, 120));
const contacts = await call('GET', '/api/contacts', undefined, tok);
const visitor = (contacts.data?.contacts || contacts.data || []).find?.((c) => c.email === 'visitor@example.com');
check('lead became a CRM contact in the owner\'s workspace', !!visitor, JSON.stringify(contacts.data).slice(0, 160));
const inbox = await call('GET', '/api/messages', undefined, tok);
const msg = (inbox.data?.messages || inbox.data || []).find?.((m) => /quick-quote/i.test(m.subject || ''));
check('funnel lead filed with its own inbox subject ("Website quick-quote request")', !!msg, JSON.stringify(inbox.data).slice(0, 160));

// Snapshot + restore (site_versions) inside D1
const patch = await call('PATCH', '/api/sites/' + site.data.id, { name: 'Apex Dental Leeds' }, tok);
check('PATCH /sites/:id (rename) → 200', patch.status === 200 && patch.data && patch.data.name === 'Apex Dental Leeds', patch.text.slice(0, 120));
const snapPost = await call('POST', '/api/sites/' + site.data.id + '/snapshots', { label: 'before redesign' }, tok);
check('POST /sites/:id/snapshots → snapshot persisted in D1 (site_versions)', snapPost.status === 200, snapPost.text.slice(0, 120));
const snaps = await call('GET', '/api/sites/' + site.data.id + '/snapshots', undefined, tok);
const snapList = snaps.data && (snaps.data.snapshots || snaps.data.versions || snaps.data);
check('GET /sites/:id/snapshots lists it', snaps.status === 200 && Array.isArray(snapList) && snapList.length >= 1, snaps.text.slice(0, 120));
const snapId = Array.isArray(snapList) && snapList[0] && snapList[0].id;
const restore = snapId ? await call('POST', '/api/sites/' + site.data.id + '/snapshots/' + snapId + '/restore', {}, tok) : { status: 0, text: 'no snapshot id' };
check('POST /sites/:id/snapshots/:v/restore → 200 (state restoration inside real D1)', restore.status === 200, restore.status + ' ' + restore.text.slice(0, 120));

// Foreign tenant cannot see the site (tenant isolation holds in production SQL)
const other = await call('POST', '/api/auth/register', { name: 'Other', email: 'other@workerd.test', password: 'password123' });
const foreign = await call('GET', '/api/sites/' + site.data.id, undefined, other.data.token);
check('another tenant gets 404 for the site (IDOR guard in real D1)', foreign.status === 404, String(foreign.status));

// ── 4. AI settings + provider path (stubbed egress) ─────────────────────────
console.log('\n== 4. AI settings + NVIDIA provider path inside workerd ==');
const settings = await call('PATCH', '/api/ai/settings', { provider: 'nvidia', nvidia_key: 'nvapi-' + 'x'.repeat(40), model: 'nvidia/llama-3.1-nemotron-70b-instruct' }, tok);
check('PATCH /ai/settings stores the key (AES-GCM via WebCrypto in workerd)', settings.status === 200, settings.text.slice(0, 160));
const got = await call('GET', '/api/ai/settings', undefined, tok);
check('GET /ai/settings never returns the key, only its presence', got.status === 200 && !JSON.stringify(got.data).includes('x'.repeat(20)), JSON.stringify(got.data).slice(0, 160));
const catalog = await call('GET', '/api/ai/site-catalog', undefined, tok);
const cLen = (k) => Array.isArray(catalog.data?.[k]) ? catalog.data[k].length : (typeof catalog.data?.[k] === 'number' ? catalog.data[k] : 0);
check('GET /ai/site-catalog → ≥40 themes, ≥160 icons, ≥9 designs available to the model', catalog.status === 200 && cLen('themes') >= 40 && cLen('icons') >= 160 && cLen('designs') >= 9, `themes ${cLen('themes')} icons ${cLen('icons')} designs ${cLen('designs')}`);
const complete = await call('POST', '/api/ai/complete', { prompt: 'hi' }, tok);
check('POST /ai/complete with a rejected key → 502 with a clear provider error (never fake success)', complete.status === 502 && /invalid|unauthori|key/i.test(complete.data?.error || ''), complete.status + ' ' + complete.text.slice(0, 160));
const streamRes = await mf.dispatchFetch('http://nexus.test/api/ai/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://nexus.test', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }) });
const streamText = await streamRes.text();
check('POST /ai/chat/stream → SSE with an {error} frame and a {done} frame when the provider rejects', /text\/event-stream/.test(streamRes.headers.get('content-type') || '') && /"error"/.test(streamText) && /"done":true/.test(streamText), streamText.slice(0, 160));

// ── 5. Byte-identical output: workerd vs the Node harness ───────────────────
console.log('\n== 5. workerd output ≡ Node harness output ==');
const ab = await call('POST', '/api/ai/agentic-build', { name: 'Northgate Civil', description: 'Civil engineering for commercial sites.', direction: 'signal-industrial', deterministic: true }, tok);
check('POST /ai/agentic-build → 200 with validation report inside workerd', ab.status === 200 && ab.data && ab.data.html && ab.data.validation, ab.status + ' ' + ab.text.slice(0, 160));
await mf.dispose();
{
  const { init, DB } = require(join(ROOT, 'tests', 'd1mock.js'));
  await init(readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8'));
  const worker = (await import(join(ROOT, 'backend', 'src', 'index.js'))).default;
  const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9, ENCRYPTION_KEY: 'k'.repeat(32) };
  const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
  globalThis.fetch = async () => { throw new Error('no net'); };
  const ncall = async (m, p, b, t) => { const r = await worker.fetch(new Request('http://nexus.test/api' + p, { method: m, headers: { 'Content-Type': 'application/json', Origin: 'http://nexus.test', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }), env, ctx); return { status: r.status, data: await r.json() }; };
  const ntok = (await ncall('POST', '/auth/register', { name: 'N', email: 'n@node.test', password: 'password123' })).data.token;
  const nb = await ncall('POST', '/ai/agentic-build', { name: 'Northgate Civil', description: 'Civil engineering for commercial sites.', direction: 'signal-industrial', deterministic: true }, ntok);
  check('agentic-build HTML is byte-identical in workerd and Node (validation/repair engines agree)', nb.status === 200 && nb.data.html === ab.data.html, (ab.data?.html || '').length + ' vs ' + (nb.data?.html || '').length);
  check('validation verdicts agree (pass + blocking rules)', JSON.stringify((ab.data.validation || {}).blocking) === JSON.stringify((nb.data.validation || {}).blocking) && ab.data.validation.pass === nb.data.validation.pass);
  const ns = await ncall('POST', '/sites', { name: 'Apex Dental', description: BRIEF, build_with_ai: true, deterministic: true }, ntok);
  // The lead URL embeds the request origin/token, so compare with it neutralised.
  const neutral = (h) => String(h || '').replace(/var NX_LEAD_URL="[^"]*"/, 'var NX_LEAD_URL=""').replace(/https?:\/\/[^"'\s]+\/api\/public\/webhook\/[A-Za-z0-9]+/g, 'LEAD');
  check('deterministic /sites page is byte-identical in workerd and Node (modulo the per-workspace lead URL)', neutral(ns.data.html) === neutral(site.data.html), neutral(ns.data.html).length + ' vs ' + neutral(site.data.html).length);
}
done();
