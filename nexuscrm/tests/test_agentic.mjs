// AGENTIC SITE ENGINE — the "AI Testing Agent + AI Debugger + build loop + version
// control" behind the website builder. Tests:
//   (A) pure functions: debugSiteHtml / testSiteHtml / autoFixSite / runAgenticLoop
//   (B) endpoints: /ai/agentic-build, /sites/:id/test, snapshots + restore
//   (C) frontend: agentic & version functions exposed, builder button present
//
// Run: node tests/test_agentic.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = join(__dirname, '..');
const { init, DB } = require('./d1mock.js');
const schema = readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8');
await init(schema);

const workerMod = await import(join(ROOT, 'backend', 'src', 'index.js'));
const worker = workerMod.default;
const t = workerMod.__internals;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
const BASE = 'http://test.local';

globalThis.fetch = async (url, opts = {}) => {
  const x = String(url);
  if (x.includes('api.openai.com') || x.includes('integrate.api.nvidia.com') || x.includes('localhost:11434')) {
    return new Response(JSON.stringify({ choices: [{ message: { content: 'garbage' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('<html><head><title>t</title></head><body><h1>t</h1></body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
};

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', Origin: 'http://app.local' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request(BASE + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const res = await worker.fetch(req, env, ctx);
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

let token = '';
{
  const r = await call('POST', '/auth/register', { name: 'Agent', email: 'ag' + Date.now() + '@x.com', password: 'password123' });
  token = r.data?.token || '';
}

console.log('\n== A1: DEBUGGER (detects real problems) ==');
{
  const bad = `<html><head><title>x</title></head><body><h1>A</h1><h1>B</h1><img src="a.jpg"><a href="#missing">go</a><button></button><script>document.write("x")</script></body></html>`;
  const d = t.debugSiteHtml(bad);
  check('detects duplicate h1 / missing lang / broken anchor / silent button', d.errors.concat(d.warnings).some(e => /h1|lang/.test(e)) && d.info.h1 === 2);
  check('detects broken internal links', d.errors.some(e => /Broken internal link/.test(e)));
  check('detects missing alt', d.warnings.some(e => /alt text/.test(e)));
  check('detects document.write', d.errors.some(e => /document\.write/.test(e)));
  check('no findings on a clean doc', t.debugSiteHtml(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>x</title></head><body><h1>A</h1><h2>B</h2><p>c</p></body></html>`).errors.length === 0);
}

console.log('\n== A2: TESTING AGENT (open-and-verify report) ==');
{
  const good = t.enhanceSiteHtml(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>x</title></head><body><h1>A</h1><h2>B</h2><p>hi</p></body></html>`, 'X', { description: 'desc' });
  const r = t.testSiteHtml(good);
  check('report has status/score/categories', typeof r.status === 'string' && typeof r.score === 'number' && Array.isArray(r.categories) && r.categories.length === 6);
  check('clean site passes most checks', r.passed >= 8, r.passed + '/' + r.total);
}

console.log('\n== A3: AUTOFIX + LOOP ==');
{
  const fixed = t.autoFixSite(`<html><head></head><body><h1>A</h1><h1>B</h1><img src="x.jpg" loading="lazy"></body></html>`);
  check('autoFix demotes extra h1 (keeps exactly one)', (fixed.match(/<h1\b/gi)||[]).length === 1, (fixed.match(/<h1\b/gi)||[]).length + ' h1');
  // a real, full site built via the Blueprint engine → should pass the agent
  const body = t.renderSectionsHtml(t.buildContentPlan('Joe Plumbing', '24/7 plumbing in Cairo. Drain cleaning. joe@example.com', {}));
  const raw = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Joe Plumbing</title><style>@media(max-width:768px){.g{grid-template-columns:1fr}}.btn{padding:14px 22px}:focus-visible{outline:3px solid}body{margin:0}</style></head><body>${body}</body></html>`;
  // the real pipeline runs the quality/enhance pass after composing — mirror it
  const full = t.enhanceSiteHtml(raw, 'Joe Plumbing', { description: '24/7 plumbing in Cairo.' });
  const loopGood = await t.runAgenticLoop(async () => full);
  check('clean blueprint site → pass on first iteration', loopGood.test.status === 'pass' && loopGood.iterations === 1, loopGood.test.status + ' ' + loopGood.test.score);
}

console.log('\n== B1: AGENTIC BUILD ENDPOINT ==');
{
  const r = await call('POST', '/ai/agentic-build', { name: 'Joe Plumbing', description: '24/7 emergency plumbing in Cairo. Drain cleaning. Call +20 100 123 4567 or email joe@example.com', deterministic: true }, token);
  check('agentic-build returns a site', r.status === 200 && r.data?.html && /<!DOCTYPE html/i.test(r.data.html));
  check('agentic-build test passes', r.data?.test?.status === 'pass' && r.data?.test?.score >= 90, r.data?.test?.score);
  check('agentic-build audit >= 70', r.data?.audit?.score >= 70, r.data?.audit?.score);
  check('agentic-build reports iterations', typeof r.data?.iterations === 'number' && r.data.iterations >= 1);
}

console.log('\n== B2: SITE TEST ENDPOINT ==');
{
  const site = await call('POST', '/sites', { name: 'Joe Plumbing', html: 'garbage-html-no-doctype', published: false }, token);
  const sid = site.data?.id;
  const r = await call('GET', `/sites/${sid}/test`, null, token);
  check('site test returns report', r.status === 200 && r.data?.test && typeof r.data.test.passed === 'number');
  check('garbage html flagged (not pass)', r.data?.test?.status !== 'pass');
  check('site test offers a retest after fix', r.data?.retest && typeof r.data.retest.score === 'number');
}

console.log('\n== B3: VERSION CONTROL (checkpoints + restore) ==');
{
  const ab = await call('POST', '/ai/agentic-build', { name: 'Joe Plumbing', description: 'plumbing in Cairo. joe@example.com', deterministic: true }, token);
  const site = await call('POST', '/sites', { name: 'Joe Plumbing', html: ab.data.html, published: false }, token);
  const sid = site.data?.id;
  const goodScore = (await call('GET', `/sites/${sid}/test`, null, token)).data?.test?.score;
  const s1 = await call('POST', `/sites/${sid}/snapshots`, { label: 'v1' }, token);
  const s2 = await call('POST', `/sites/${sid}/snapshots`, { label: 'v2' }, token);
  check('two snapshots created', s1.status === 200 && s2.status === 200 && (s2.data?.snapshots?.length || 0) >= 2);
  // mutate to a broken state
  await call('PATCH', `/sites/${sid}`, { html: '<html><body>destroyed</body></html>' }, token);
  const vId = (s2.data.snapshots || []).slice(-1)[0]?.id;
  const restore = await call('POST', `/sites/${sid}/snapshots/${vId}/restore`, {}, token);
  check('restore succeeds', restore.status === 200 && restore.data?.restored === true);
  const after = await call('GET', `/sites/${sid}/test`, null, token);
  check('after restore the site is whole again (score back to high)', after.data?.test?.score >= 80 && after.data?.test?.score === goodScore, after.data?.test?.score + ' vs ' + goodScore);
}

console.log('\n== C1: FRONTEND AGENTIC + VERSION UI ==');
{
  const { JSDOM } = require('jsdom');
  const html = readFileSync(join(ROOT, 'NexusCRM_V4_Hardened.html'), 'utf-8');
  const dom = new JSDOM(html, { url: 'http://localhost:3000/', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.confirm = () => true; w.alert = () => {}; } });
  const w = dom.window, d = w.document;
  const errs = []; w.addEventListener('error', e => errs.push(e.message));
  await new Promise(r => setTimeout(r, 400));
  check('agentic + version functions exposed', ['buildSiteAgentic','nxTestReportHtml','openSiteTest','snapshotSite','snapshotList','restoreSnapshot'].every(f => typeof w[f] === 'function'));
  await w.openAISiteBuilder();
  await new Promise(r => setTimeout(r, 300));
  check('builder footer has Agentic Build button', d.body.textContent.includes('Agentic Build'));
  // report renderer draws a real report
  const host = d.createElement('div');
  host.innerHTML = w.nxTestReportHtml({ categories: [{ name: 'Structure', passed: 2, total: 2, results: [{ name: 'Valid HTML', pass: true }] }] });
  check('test report renders categories/rows', host.textContent.includes('Structure') && host.textContent.includes('Valid HTML'));
  w.closeModal();
  check('no frontend errors in agentic flow', errs.length === 0, errs.join(' | '));
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
process.exit(failed ? 1 : 0);
