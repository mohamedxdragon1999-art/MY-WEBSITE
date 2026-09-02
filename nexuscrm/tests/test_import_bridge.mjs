// HTML → GRAPH MIGRATION BRIDGE (Gap 2) — a legacy HTML-only site (including a
// `build_with_ai` output) can be brought into the graph world as the canonical
// artifact, with confidence tagging, so there is ONE source of truth.
//
//   AI / User / Import → Intent/Plan → IR Graph → Validation → Design QA → Renderer → HTML
//
// Run: node tests/test_import_bridge.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const { init, DB } = await import(join(__dirname, 'd1mock.js'));
const schema = readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8');
await init(schema);
const worker = (await import(join(ROOT, 'backend', 'src', 'index.js'))).default;
const internals = (await import(join(ROOT, 'backend', 'src', 'index.js'))).__internals;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
const BASE = 'http://test.local';
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('api.openai.com') || u.includes('nvidia.com') || u.includes('localhost:11434')) {
    return new Response(JSON.stringify({ choices: [{ message: { content: 'FAKE_AI' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('<html><body>x</body></html>', { status: 200 });
};
async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', Origin: 'http://app.local' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await worker.fetch(new Request(BASE + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

let token = '', sid = null;
{
  const reg = await call('POST', '/auth/register', { name: 'Imp Tester', email: 'imp' + Date.now() + '@x.com', password: 'password123' });
  token = reg.data?.token;
  check('registered workspace', !!token);
  // A site that looks like the LEGACY composition output (class-based sections).
  const legacyHtml = `<!DOCTYPE html><html lang="en"><head><title>Legacy Co</title></head><body>
    <nav class="nx-nav"><div class="container nx-nav-inner"><span class="brand">Legacy Co</span><div class="nx-nav-links"><a href="#home">Home</a><a href="#services">Services</a></div></div></nav>
    <section class="nx-hero" id="home"><div class="container"><h1>Welcome</h1><p>A legacy build.</p><a class="btn btn-primary" href="#services">Explore</a></div></section>
    <section class="nx-grid g3" id="services"><div class="nx-card"><h3>Fast</h3><p>x</p></div><div class="nx-card"><h3>Beautiful</h3><p>y</p></div></section>
    <footer class="nx-foot"><div class="container"><p>© Legacy Co</p></div></footer>
  </body></html>`;
  const site = await call('POST', '/sites', { name: 'Legacy Co', html: legacyHtml, published: false }, token);
  sid = site.data?.id;
  check('created a legacy site', !!sid);
}

console.log('\n== 1. MIGRATE LEGACY HTML → GRAPH (one source of truth) ==');
let graphJson = '';
{
  const r = await call('POST', `/sites/${sid}/import`, {}, token);
  check('import bridge ok', r.status === 200 && r.data?.ok === true);
  check('import returned a Project Graph', !!r.data.graph && Array.isArray(r.data.graph.order) && r.data.graph.order.length >= 1);
  check('import returned confidence tagging', Array.isArray(r.data.confidence) && r.data.confidence.every(c => c.confidence && ['extracted', 'inferred', 'unknown'].includes(c.confidence)));
  check('import re-rendered the site from the graph', r.data.recompiled === true, 'recompiled=' + r.data.recompiled);
  const v = await DB.prepare('SELECT graph, html FROM sites WHERE id=?').bind(sid).first();
  check('site persisted the imported graph', !!v.graph && JSON.parse(v.graph).order.length >= 1);
  graphJson = v.graph;
  check('imported graph is integrity-sound', internals.nxValidateGraphIntegrity(JSON.parse(v.graph)).ok);
  check('renderer can compile the imported graph (validated)', internals.nxRenderDocument(JSON.parse(v.graph)).valid === true);
}

console.log('\n== 2. IMPORTED GRAPH IS THE AUTHORITY (snapshot + graph-first restore) ==');
{
  const cap = await call('POST', `/sites/${sid}/snapshots`, { label: 'after-import' }, token);
  const vid = (cap.data.snapshots || []).find(s => s.label === 'after-import')?.id;
  check('snapshotted the imported graph', !!vid && (await DB.prepare('SELECT graph FROM site_versions WHERE id=?').bind(vid).first()).graph === graphJson);
  // change the site then restore → gets back the imported graph + recompiled html
  const change = await call('POST', `/sites/${sid}/design`, { brief: 'totally different agency', overwrite: true, headline: 'SUPERSEDED' }, token);
  check('changed the site after import', change.data?.saved === true);
  const restore = await call('POST', `/sites/${sid}/snapshots/${vid}/restore`, {}, token);
  check('restore ok + went through the GRAPH path', restore.status === 200 && restore.data?.ok === true && restore.data?.recomputed === true);
  const v = await DB.prepare('SELECT graph, html FROM sites WHERE id=?').bind(sid).first();
  check('restored graph equals the imported graph', v.graph === graphJson);
  check('restored html no longer carries the superseded content', !/SUPERSEDED/.test(v.html));
}

console.log('\n== 3. IMPORT ERRORS ARE SURFACED (not silently swallowed) ==');
{
  const site = await call('POST', '/sites', { name: 'Empty', html: '', published: false }, token);
  // An empty/trivial site produces no blocks → import still returns a valid (minimal) graph.
  const r = await call('POST', `/sites/${site.data.id}/import`, {}, token);
  check('import on a trivial site returns ok (minimal graph)', r.status === 200 && r.data?.ok === true);
  check('import on missing site → 404', (await call('POST', '/sites/99999/import', {}, token)).status === 404);
  check('import requires auth', (await call('POST', `/sites/${sid}/import`, {}, '')).status === 401);
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
process.exit(failed ? 1 : 0);
