// GRAPH-NATIVE VERSIONING — the DB treats the IR/Project Graph as the authoritative
// versioned artifact, NOT the compiled HTML.
//
//   Project → IR Graph → persisted snapshot → compile/render
//
// (Instead of: Project → HTML → try to reconstruct what the project was.)
//
// Verifies:
//   1. a saved site persists its graph (not just HTML);
//   2. a checkpoint stores the full graph;
//   3. restoring a checkpoint restores THE GRAPH and RECOMPILES the HTML from it,
//      so you get back exactly the design (never an HTML-only probe);
//   4. a legacy HTML-only snapshot still restores via the html fallback;
//   5. the snapshot list surfaces graph_size.
//
// Run: node tests/test_graph_version.mjs
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
const px = (proj) => JSON.parse(JSON.stringify(proj));

let token = '', sid = null;
{
  const reg = await call('POST', '/auth/register', { name: 'Ver Tester', email: 'ver' + Date.now() + '@x.com', password: 'password123' });
  token = reg.data?.token;
  check('registered workspace', !!token);
  const site = await call('POST', '/sites', { name: 'Graph Site', html: '<!DOCTYPE html><html lang="en"><head><title>G</title></head><body><h1>Start</h1></body></html>', published: false }, token);
  sid = site.data?.id;
  check('created a site', !!sid);
}

console.log('\n== 1. SAVING A DESIGN PERSISTS THE GRAPH (not just HTML) ==');
let graphStr = '';
{
  const r = await call('POST', `/sites/${sid}/design`, { brief: 'premium futuristic saas', overwrite: true, headline: 'Versioned Headline', cta: 'Go' }, token);
  check('design overwrite saved', r.status === 200 && r.data?.saved === true);
  check('design returns a valid IR graph', !!r.data.irGraph && internals.nxValidateGraphIntegrity(r.data.irGraph).ok);
  graphStr = JSON.stringify(px(r.data.irGraph));
  // the site's stored graph must match the delivered graph
  const v = await DB.prepare('SELECT graph, html FROM sites WHERE id=?').bind(sid).first();
  check('site persisted its graph', !!v.graph && JSON.parse(v.graph).order && JSON.parse(v.graph).order.length >= 3);
  check('persisted graph equals the delivered graph', JSON.stringify(JSON.parse(v.graph)) === graphStr);
}

console.log('\n== 2. A CHECKPOINT STORES THE FULL GRAPH ==');
let versionId = null;
{
  const cap = await call('POST', `/sites/${sid}/snapshots`, { label: 'v1 perfect' }, token);
  check('checkpoint captured', cap.status === 200 && cap.data?.ok === true);
  const list = cap.data.snapshots || [];
  check('snapshot list includes graph_size', list.every(s => typeof s.graph_size === 'number'));
  const v1 = list.find(s => s.label === 'v1 perfect');
  versionId = v1?.id;
  check('found the checkpoint id', !!versionId);
  const row = await DB.prepare('SELECT graph, html FROM site_versions WHERE id=?').bind(versionId).first();
  check('checkpoint stored the graph', !!row.graph && JSON.parse(row.graph).order.length >= 3);
  check('checkpoint graph equals the saved graph', JSON.stringify(JSON.parse(row.graph)) === graphStr);
}

console.log('\n== 3. RESTORE RECOMPILES HTML FROM THE GRAPH (authoritative = graph) ==');
{
  // Dramatically change the site (a different design, different content), so a
  // naive HTML restore would be visible if we didn't recompute from the graph.
  const r2 = await call('POST', `/sites/${sid}/design`, { brief: 'minimal editorial agency', overwrite: true, headline: 'CHANGED entirely', cta: 'Contact' }, token);
  check('changed the site via a new design', r2.data?.saved === true);
  const v2 = await DB.prepare('SELECT graph, html FROM sites WHERE id=?').bind(sid).first();
  check('site graph now differs from the checkpoint', v2.graph !== graphStr);
  check('site content changed', /CHANGED entirely/.test(v2.html));

  const restore = await call('POST', `/sites/${sid}/snapshots/${versionId}/restore`, {}, token);
  check('restore ok', restore.status === 200 && restore.data?.ok === true);
  check('restore went through the GRAPH path (recomputed=true)', restore.data?.recomputed === true);
  const v3 = await DB.prepare('SELECT graph, html FROM sites WHERE id=?').bind(sid).first();
  check('restored site graph equals the checkpoint graph', v3.graph === graphStr);
  // HTML must be recompiled from the restored graph, not the stale changed html
  const expectedHtml = internals.nxRenderDocument(JSON.parse(graphStr)).html;
  check('restored HTML is recompiled from the graph', v3.html === expectedHtml);
  check('restored HTML no longer carries the changed headline', !/CHANGED entirely/.test(v3.html));
  check('restored page is valid + integrity-sound', internals.nxRenderDocument(JSON.parse(graphStr)).valid === true);
}

console.log('\n== 4. LEGACY HTML-ONLY SNAPSHOT STILL RESTORES (no graph) ==');
{
  // Insert a legacy-style checkpoint with html but no graph, then restore it.
  await DB.prepare("INSERT INTO site_versions (site_id, label, html, graph) VALUES (?,?,?,?)").bind(sid, 'legacy-html', '<html><body><p>LEGACY_BODY</p></body></html>', '').run();
  const legacyRow = await DB.prepare('SELECT id FROM site_versions WHERE label=?').bind('legacy-html').first();
  const restore = await call('POST', `/sites/${sid}/snapshots/${legacyRow.id}/restore`, {}, token);
  check('legacy snapshot restores ok', restore.status === 200 && restore.data?.ok === true);
  check('legacy snapshot did NOT recompute (html fallback)', restore.data?.recomputed === false);
  const v = await DB.prepare('SELECT html FROM sites WHERE id=?').bind(sid).first();
  check('legacy snapshot restored its html', /LEGACY_BODY/.test(v.html));
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
