// POST /sites/:id/design — the AI DESIGN STUDIO backend: explore design
// directions → build a Project Graph → render → score (Design QA + Engineering
// QA) → optionally persist to the site.
//
// Run: node tests/test_design_route.mjs
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

console.log('\n== 1. DESIGN ROUTE: explore + directions ==');
let token = '';
{
  const reg = await call('POST', '/auth/register', { name: 'Design Tester', email: 'des' + Date.now() + '@x.com', password: 'password123' });
  token = reg.data?.token;
  check('registered workspace', !!token);
  const base = `<!DOCTYPE html><html lang="en"><head><title>Pre</title></head><body><h1>Old</h1></body></html>`;
  const site = await call('POST', '/sites', { name: 'Design Studio Site', html: base, published: false }, token);
  const sid = site.data?.id;
  check('created a site', !!sid, `id=${sid}`);

  const r = await call('POST', `/sites/${sid}/design`, { brief: 'luxury premium watch store' }, token);
  check('design route ok', r.status === 200 && r.data?.ok === true, r.status);
  check('explore returns 4 directions', Array.isArray(r.data.directions) && r.data.directions.length === 4);
  check('direction has label + tone + fit', r.data.directions.every(d => d.label && d.tone && typeof d.fit === 'number'));
  check('auto-chose best-fit, luxury → minimal-luxury', r.data.chosen === 'minimal-luxury', r.data.chosen);
  check('design QA present (score + grade)', typeof r.data.designQA?.score === 'number' && typeof r.data.designQA?.grade === 'string');
  // GRAPH-FIRST: the endpoint returns the canonical editable IR Project Graph.
  check('design route returns the IR project graph (graph, not just HTML)', !!r.data.irGraph && !!r.data.irGraph.order && r.data.irGraph.order.length >= 3);
  check('IR graph integrity holds across the whole page', internals.nxValidateGraphIntegrity(r.data.irGraph).ok);
  check('engineering QA present', typeof r.data.engQA?.score === 'number');
  check('default does not save', r.data.saved === false);
  // the site html must be untouched
  const get = await call('GET', `/sites/${sid}/html`, null, token);
  check('site not mutated unless overwrite', /Old/.test(get.data.html));

  // pick a specific direction + persist
  const r2 = await call('POST', `/sites/${sid}/design`, { direction: 'futuristic-cinematic', overwrite: true, headline: 'Launch Loop', sub: 'A cinematic journey', cta: 'Explore' }, token);
  check('overwrite saves', r2.status === 200 && r2.data?.saved === true, r2.status);
  check('chose the requested direction', r2.data.chosen === 'futuristic-cinematic');
  const get2 = await call('GET', `/sites/${sid}/html`, null, token);
  check('persisted futuristic headline', /Launch Loop/.test(get2.data.html));
  check('persisted motion runtime (reduced-motion guard)', /prefers-reduced-motion/.test(get2.data.html) && /IntersectionObserver/.test(get2.data.html));
  {
    // Bind to the engine's ACTUAL direction token instead of a stale literal.
    const expectedPrimary = internals.NX_DIRECTIONS['futuristic-cinematic'].brand.primaryColor;
    const re = new RegExp('--nx-primary:\\s*' + expectedPrimary, 'i');
    check('persisted futuristic design tokens', re.test(get2.data.html), 'expected ' + expectedPrimary);
  }
  const dqa = await call('POST', `/sites/${sid}/design`, { brief: 'x' }, token);
  check('regenerated site scores in design QA', typeof dqa.data?.designQA?.score === 'number');

  check('design route requires auth', (await call('POST', `/sites/${sid}/design`, { brief: 'x' }, '')).status === 401);
  check('design route on missing site → 404', (await call('POST', '/sites/99999/design', { brief: 'x' }, token)).status === 404);
}

console.log('\n== 2. INTERNALS: design engine exports ==');
{
  check('internals expose design engine', ['nxDesignQA', 'nxExplore', 'nxProjectToCode', 'nxBuildComponent', 'nxTokensToCss', 'NX_DIRECTIONS'].every(k => internals[k]));
  const dirs = internals.nxExplore('saas dashboard', 3);
  check('internals nxExplore works', dirs.length === 3 && dirs[0].id === 'tech-saas');
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
process.exit(failed ? 1 : 0);
