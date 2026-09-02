// IS VALIDATION A GATE, OR JUST A REPORT?
//
// A validator that only annotates output puts a human back in the QA loop. The
// distinction that matters: when a NEW generation contains a blocking
// violation, does the pipeline refuse it and repair automatically — with no
// human action — or does it log and ship anyway?
//
// These tests hold the pipeline to the blocking contract:
//   * blocking violations trigger automatic, minimal repair
//   * a repair that does not strictly improve the page is rejected
//   * blockers surviving the budget are reported as shippedWithBlockers, never
//     silently passed off as success
//   * the live build route runs the gate on every generation
//   * generation history is recorded so slow drift is visible
//
// Run: node tests/test_validation_gate.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const V = require(join(ROOT, 'backend', 'src', 'nx_validate.js'));
const H = require(join(ROOT, 'backend', 'src', 'nx_history.js'));

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
// A page with several REAL blocking defects: invalid nesting, a tap target far
// under 44px, and a fixed width that overflows every viewport.
const BAD = '<!DOCTYPE html><html lang="en"><head><title>T</title><meta name="description" content="d">'
  + '</head><body><main><h1>Hi</h1><p>Some copy here.</p>'
  + '<a href="#x">Tap</a><div style="width:2400px">wide</div><p><div>bad nesting</div></p>'
  + '</main></body></html>';

console.log('\n== A. Blocking violations are actually detected ==');
{
  const r = V.nxValidatePage(BAD);
  check('a defective page does not pass', r.pass === false);
  const rules = new Set(r.blocking.map(b => b.rule));
  check('invalid nesting is blocking', rules.has('html-validity'), [...rules].join(','));
  check('sub-44px tap targets are blocking', rules.has('touch-target'), [...rules].join(','));
  check('viewport overflow is blocking', rules.has('overflow-x'), [...rules].join(','));
}

console.log('\n== B. Blockers trigger AUTOMATIC repair (no caller wiring) ==');
{
  // Passing no repair function at all: the gate must still fix the page.
  const before = V.nxValidatePage(BAD).blocking.length;
  const out = V.nxValidateAndRepair(() => BAD, null, { maxIterations: 4 });
  check('the page is repaired without a supplied fixer', out.report.blocking.length < before,
    `${before} → ${out.report.blocking.length}`);
  check('repair resolves every blocking violation here', out.report.pass === true,
    out.report.blocking.map(b => b.rule).join(','));
  check('the repair is recorded in the log', out.log.some(l => (l.repairs || []).length > 0));
  check('repaired output keeps the original content', /bad nesting/.test(out.html) && /Some copy here/.test(out.html));
  check('the loop stays within its iteration budget', out.iterations <= 5, String(out.iterations));
}

console.log('\n== C. A regressive repair is refused (best-known-version rule) ==');
{
  // Genuinely worse = strictly MORE blocking violations than the input. (A
  // shorter broken page can have fewer blockers, which would be an improvement
  // by the only metric the gate has — so the fixture must actually regress.)
  const worse = () => BAD.replace('</main>',
    '<p><div>extra bad nesting</div></p><div style="width:8000px">x</div><span><section>nested wrong</section></span></main>');
  const baseline = V.nxValidatePage(BAD).blocking.length;
  const worseCount = V.nxValidatePage(worse()).blocking.length;
  check('the regression fixture really is worse', worseCount > baseline, `${baseline} → ${worseCount}`);
  const out = V.nxValidateAndRepair(() => BAD, worse, { maxIterations: 3 });
  check('a worse candidate is never accepted', out.html === BAD, `blocking went ${baseline} → ${V.nxValidatePage(out.html).blocking.length}`);
}

console.log('\n== D. Surviving blockers are declared, never hidden ==');
{
  // A repair function that changes bytes but fixes nothing must not be able to
  // launder a failing page into a "pass".
  const noop = (h) => h + '<!-- touched -->';
  const out = V.nxValidateAndRepair(() => BAD, noop, { maxIterations: 2 });
  check('an ineffective repair leaves the page failing', out.report.pass === false);
  check('shippedWithBlockers is set truthfully', out.shippedWithBlockers === true);
  check('the unresolved violations are itemised', Array.isArray(out.unresolved) && out.unresolved.length > 0,
    String(out.unresolved && out.unresolved.length));
}

console.log('\n== E. Clean input is left completely alone ==');
{
  const good = '<!DOCTYPE html><html lang="en"><head><title>Studio</title><meta name="description" content="A studio.">'
    + '</head><body><main><h1>Objects of permanence</h1><p>A studio for considered interiors.</p></main></body></html>';
  const out = V.nxValidateAndRepair(() => good, null, { maxIterations: 4 });
  check('a passing page is not rewritten', out.html === good);
  check('no repair iterations are spent', out.repaired === false, String(out.iterations));
}

console.log('\n== F. The live build route runs the gate on every generation ==');
{
  const { init, DB } = await import(join(__dirname, 'd1mock.js'));
  await init(readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8'));
  const worker = (await import(join(ROOT, 'backend', 'src', 'index.js'))).default;
  const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
  const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
  globalThis.fetch = async () => new Response('x', { status: 200 });
  let TOK = null;
  const call = async (m, p, b) => {
    const h = { 'Content-Type': 'application/json', Origin: 'http://a' };
    if (TOK) h.Authorization = 'Bearer ' + TOK;
    const r = await worker.fetch(new Request('http://t.local/api' + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }), env, ctx);
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  TOK = (await call('POST', '/auth/register', { email: 'gate@t.co', password: 'Password123!', name: 'G' })).data.token;

  const r = await call('POST', '/ai/build-site', { name: 'Northgate Civil', description: 'Civil engineering for commercial sites.', direction: 'signal-industrial', deterministic: true });
  const v = r.data && r.data.validation;
  check('the build response carries a validation verdict', !!v);
  check('the generated page passes the gate', v && v.pass === true, v ? JSON.stringify(v.blocking.slice(0, 2)) : '');
  check('all four viewports were measured', v && v.perViewport && v.perViewport.length === 4, v ? String(v.perViewport && v.perViewport.length) : '');
  check('the verdict does not overstate verification', v && v.browserValidated === false && /not verified/i.test(String(v.note)));

  // §7 — cross-generation history must accumulate.
  const hist = await call('GET', '/ai/validation-history');
  check('validation history is exposed', hist.status === 200 && hist.data && hist.data.stats);
  check('this generation was recorded', hist.data.stats.total >= 1, JSON.stringify(hist.data.stats.total));
  check('history reports a repair-iteration distribution',
    hist.data.stats && ['cleanFirstPass', 'needed1', 'needed2plus', 'shippedWithBlockers'].every(k => k in hist.data.stats),
    JSON.stringify(hist.data.stats));
}

console.log('\n== G. History aggregation surfaces drift ==');
{
  H.nxHistoryReset();
  H.nxRecordGeneration({ pass: true, iterations: 1, repaired: false, blockingRules: [], repairs: [] });
  H.nxRecordGeneration({ pass: true, iterations: 2, repaired: true, blockingRules: ['touch-target'], repairs: ['touch-target: enforced'] });
  H.nxRecordGeneration({ pass: false, iterations: 4, repaired: true, shippedWithBlockers: true, blockingRules: ['overflow-x', 'touch-target'], repairs: ['overflow-x: contained'] });
  const s = H.nxHistoryStats();
  check('clean first-pass generations are counted', s.cleanFirstPass === 1, JSON.stringify(s));
  check('single-repair generations are counted', s.needed1 === 1, JSON.stringify(s));
  check('budget-exhausted generations are counted', s.shippedWithBlockers === 1, JSON.stringify(s));
  check('the most frequent failing rule is identified', s.topRules[0] && s.topRules[0].rule === 'touch-target', JSON.stringify(s.topRules));
  check('a pass rate is reported', typeof s.passRate === 'number', String(s.passRate));
}

// Report which routes this suite exercised, so the runner's route-coverage
// gate counts them (it is enforced: every served route must be tested).
process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });

const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
