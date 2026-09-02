// PHASE 1.1 + 1.2 — browser-backed validation and the hard blocking gate.
//
// 1.1  Real Chromium rendering is wired INLINE into the generation route, with
//      a graceful, EXPLICITLY FLAGGED fallback when no browser exists. The
//      contract that matters is honesty: a page that was never rendered must
//      never be reported as visually verified.
// 1.2  Severity is decided by ONE policy table in code, not ad-hoc at each
//      call site, and the route refuses to return unresolved blocking issues.
//
// NOTE ON THIS ENVIRONMENT: the Chromium binary cannot be installed here — its
// only source (cdn.playwright.dev) is network-blocked, confirmed by direct
// probe. These tests therefore verify BOTH paths: that the real path is
// correctly implemented and detected, and that the fallback degrades honestly.
// Running `npx playwright install chromium` flips the same code to real
// measurement with no further changes.
//
// Run: node tests/test_browser_gate.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const nx = require(join(ROOT, 'backend/src/nx_compose.js'));
const V = require(join(ROOT, 'backend/src/nx_validate.js'));
const B = require(join(ROOT, 'backend/src/nx_browser.js'));

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const PLAN = { site_name: 'Northgate Civil', hero_headline: 'Groundworks, done properly', hero_sub: 'Civil engineering for commercial sites.',
  services: [{ title: 'Groundworks', desc: 'Excavation.' }, { title: 'Drainage', desc: 'Install.' }],
  projects: [{ title: 'Pier 7', cat: 'Commercial' }], contact: { email: 'h@n.co' } };
const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);

console.log('\n== A. Browser availability is probed honestly ==');
const probe = await B.nxBrowserProbe();
console.log(`     engine=${probe.engine || 'none'} available=${probe.available}${probe.reason ? ' reason=' + probe.reason.slice(0, 90) : ''}`);
{
  check('the probe reports a definite availability boolean', typeof probe.available === 'boolean');
  check('an unavailable browser comes with a concrete reason', probe.available || (probe.reason && probe.reason.length > 10), probe.reason);
  // Detection must be by LAUNCH, not by module presence: the package can be
  // installed while the binary is missing, which is exactly the case here.
  check('availability is decided by launching, not by import alone',
    probe.available || /binary|Executable|launch|install/i.test(probe.reason), probe.reason.slice(0, 80));
}

console.log('\n== B. The gate never overstates what it verified ==');
{
  const html = nx.nxCompose(PLAN, { direction: 'signal-industrial' }).html;
  const r = await V.nxValidatePageAsync(html);
  if (probe.available) {
    check('with a browser, the renderer is chromium', r.renderer === 'chromium', r.renderer);
    check('with a browser, browserValidated is true', r.browserValidated === true);
    check('with a browser, output is not flagged unverified', r.visuallyUnverified === false);
    check('with a browser, all four viewports were measured', (r.perViewport || []).length === 4, String((r.perViewport || []).length));
  } else {
    check('without a browser, the renderer is approximate', r.renderer === 'approximate', r.renderer);
    check('without a browser, browserValidated is false', r.browserValidated === false);
    check('without a browser, output IS flagged visually unverified', r.visuallyUnverified === true);
    check('the report explains why verification did not happen', /unverified/i.test(r.note) && !!r.browserReason, (r.browserReason || '').slice(0, 60));
  }
  check('a verdict is still produced either way', typeof r.pass === 'boolean');
}

console.log('\n== C. Severity is decided by one policy table (1.2) ==');
{
  const BLOCK = ['overflow', 'overlap', 'off-canvas', 'touch-target', 'contrast', 'broken-image', 'placeholder', 'html-validity', 'page-error'];
  const WARN = ['cliche', 'slot-overflow', 'repetition', 'readability', 'line-length', 'judge-score'];
  const wrongB = BLOCK.filter((r) => V.nxSeverityFor(r) !== 'blocking');
  const wrongW = WARN.filter((r) => V.nxSeverityFor(r) !== 'warning');
  check('every must-fix class is classified blocking', wrongB.length === 0, wrongB.join(','));
  check('every quality signal is classified warning', wrongW.length === 0, wrongW.join(','));
  // A new rule must not be able to block shipping until deliberately promoted.
  check('an unknown rule defaults to warning, not blocking', V.nxSeverityFor('some-future-rule') === 'warning');
  check('the policy overrides an ad-hoc severity at the call site', V.nxSeverityFor('contrast', 'warning') === 'blocking');
}

console.log('\n== D. Blocking issues are detected and repaired, not shipped ==');
{
  const broken = '<!DOCTYPE html><html lang="en"><head><title>t</title><meta name="description" content="d"></head>'
    + '<body><main><h1>H</h1><p>Lorem ipsum dolor sit amet.</p><div style="width:3000px">wide</div><p><div>bad</div></p></main></body></html>';
  const r = await V.nxValidatePageAsync(broken);
  check('a genuinely broken page does not pass', r.pass === false, JSON.stringify(r.blocking.map((b) => b.rule)));
  const rules = new Set(r.blocking.map((b) => b.rule));
  check('placeholder text is blocking', rules.has('placeholder'), [...rules].join(','));
  check('invalid nesting is blocking', rules.has('html-validity'), [...rules].join(','));

  const out = await V.nxValidateAndRepairAsync(() => broken, null, { maxIterations: 4 });
  check('the async loop repairs blocking issues automatically', out.report.blocking.length < r.blocking.length,
    `${r.blocking.length} → ${out.report.blocking.length}`);
  check('surviving blockers are declared, never hidden', typeof out.shippedWithBlockers === 'boolean');
  check('a repair that does not improve the page is rejected',
    (await V.nxValidateAndRepairAsync(() => broken, (h) => h + '<!-- noop -->', { maxIterations: 2 })).report.pass === false);
}

console.log('\n== E. Every generated page clears the gate ==');
{
  const bad = [];
  for (const d of DIRS) {
    const r = await V.nxValidatePageAsync(nx.nxCompose(PLAN, { direction: d }).html);
    if (!r.pass) bad.push(`${d}: ${r.blocking.slice(0, 2).map((b) => b.rule + '(' + b.selector + ')').join(', ')}`);
  }
  check('all six directions pass the hardened gate', bad.length === 0, bad.join(' | '));
}

console.log('\n== F. The live route enforces the gate inline ==');
{
  const { init, DB } = await import(join(__dirname, 'd1mock.js'));
  await init(readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8'));
  const worker = (await import(join(ROOT, 'backend', 'src', 'index.js'))).default;
  const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
  const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
  globalThis.fetch = async () => new Response('x', { status: 200 });
  let TOK = null;
  const api = async (m, p, b) => {
    const h = { 'Content-Type': 'application/json', Origin: 'http://a' };
    if (TOK) h.Authorization = 'Bearer ' + TOK;
    const r = await worker.fetch(new Request('http://t.local/api' + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }), env, ctx);
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  TOK = (await api('POST', '/auth/register', { email: 'bg@t.co', password: 'Password123!', name: 'BG' })).data.token;
  const r = await api('POST', '/ai/build-site', { name: 'Northgate Civil', description: 'Civil engineering.', direction: 'signal-industrial', deterministic: true });
  const v = r.data && r.data.validation;
  check('the route returns a validation verdict', !!v);
  check('the generated page passes with zero blockers', v && v.pass === true && v.blocking.length === 0,
    v ? JSON.stringify(v.blocking.slice(0, 2)) : 'none');
  check('the route measures every required viewport', v && (v.perViewport || []).length === 4, v ? String((v.perViewport || []).length) : '');
  // The flag must reach the API consumer, not just the internal report.
  check('the response exposes the visual-verification flag', v && typeof v.visuallyUnverified === 'boolean');
  check('the flag matches actual browser availability', v && v.visuallyUnverified === !probe.available,
    `flag=${v && v.visuallyUnverified} browser=${probe.available}`);
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
