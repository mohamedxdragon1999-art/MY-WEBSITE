// THE VALIDATION PIPELINE — layout geometry, design tokens, copy quality.
//
// Implements the checkable parts of the self-validation spec:
//   §2 layout geometry at four required viewports (375/768/1440/1920)
//   §3.1 design-token discipline enforced at GENERATION time
//   §3.2 deterministic contrast + rhythm scoring on resolved values
//   §4.1 deterministic copy checks (clichés, placeholders, slot bounds)
//   §5/§6 severity-tagged violations and a repair loop that cannot regress
//
// HONESTY (§1): no headless browser can be installed here — Playwright and
// Puppeteer downloads are both blocked at the network layer. Layout numbers are
// ESTIMATED from the resolved cascade, so the pipeline reports
// browserValidated:false. These tests assert that the claim is never inflated.
//
// Run: node tests/test_validation_pipeline.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const nx = require('../backend/src/nx_compose.js');
const V = require('../backend/src/nx_validate.js');
const L = require('../backend/src/nx_layout.js');
const C = require('../backend/src/nx_copy.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);
const PLAN = {
  site_name: 'Northgate Civil', hero_headline: 'Groundworks, done properly',
  hero_sub: 'Civil engineering and drainage for commercial sites.',
  services: [{ title: 'Groundworks', desc: 'Excavation and foundations.' }, { title: 'Drainage', desc: 'Design and install.' }, { title: 'Surfacing', desc: 'Concrete and tarmac.' }],
  stats: [{ value: '40+', label: 'Years' }], projects: [{ title: 'Pier 7', cat: 'Commercial' }],
  reviews: [{ text: 'Exceptional work.', name: 'R', role: 'Manager' }], faqs: [{ q: 'Lead time?', a: 'Two weeks.' }],
  contact: { email: 'hi@northgate.co.uk' },
};
const pages = {};
for (const d of DIRS) pages[d] = nx.nxCompose(PLAN, { direction: d }).html;

console.log('\n== A. Every direction passes the full pipeline with zero blockers ==');
{
  const bad = [];
  for (const d of DIRS) {
    const r = V.nxValidatePage(pages[d]);
    if (!r.pass) bad.push(`${d}: ${r.blocking.slice(0, 2).map(b => b.rule + '(' + b.measured + ')').join(', ')}`);
  }
  check('no blocking violations in any direction', bad.length === 0, bad.join(' | '));
}

console.log('\n== B. Layout is measured at all four required viewports (§1) ==');
{
  const r = V.nxValidatePage(pages[DIRS[0]]);
  const seen = r.perViewport.map(v => v.viewport);
  check('mobile / tablet / desktop / wide are all measured',
    ['375x812', '768x1024', '1440x900', '1920x1080'].every(v => seen.includes(v)), seen.join(', '));
}

console.log('\n== C. Touch targets meet the 44px minimum on mobile (§2.4) ==');
{
  const bad = [];
  for (const d of DIRS) {
    const doc = new JSDOM(pages[d]).window.document;
    const issues = L.nxMeasure(pages[d], doc, { width: 375, height: 812 }).issues.filter(i => i.rule === 'touch-target');
    if (issues.length) bad.push(`${d}: ${issues.length} (${issues[0].selector} ${issues[0].measured})`);
  }
  check('no sub-44px tap targets on a 375px viewport', bad.length === 0, bad.join(' | '));
}

console.log('\n== D. Nothing is wider than the viewport it renders in (§2.1/§2.3) ==');
{
  const bad = [];
  for (const d of DIRS) {
    const doc = new JSDOM(pages[d]).window.document;
    for (const vp of L.NX_VIEWPORTS) {
      const of = L.nxMeasure(pages[d], doc, vp).issues.filter(i => i.rule === 'overflow-x');
      if (of.length) bad.push(`${d}@${vp.name}: ${of[0].selector} ${of[0].measured}`);
    }
  }
  check('no horizontal overflow at any viewport', bad.length === 0, bad.join(' | '));
}

console.log('\n== E. Design tokens are enforced at generation time (§3.1) ==');
{
  // Free-styled spacing was 58% off-grid. A fixed scale is what makes rhythm
  // look designed rather than arbitrary.
  const SCALE = new Set([0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 72, 80, 96, 112, 128, 160, 192, 224, 256]);
  const bad = [];
  for (const d of DIRS) {
    const css = (pages[d].match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
    const off = new Set();
    // The visually-hidden idiom (.c-sr-only) requires margin:-1px by definition —
    // it is a clipping technique, not spacing, so it is exempt from the scale.
    const scoped = css.replace(/\.c-sr-only\{[^}]*\}/g, '');
    for (const m of scoped.matchAll(/(?:margin|padding|gap|row-gap|column-gap)[a-z-]*\s*:\s*([^;}]+)/g)) {
      for (const n of m[1].matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
        const v = Math.abs(+n[1]); if (v && !SCALE.has(v)) off.add(v);
      }
    }
    if (off.size) bad.push(`${d}: ${[...off].sort((a, b) => a - b).slice(0, 6).join(',')}`);
  }
  check('all spacing values sit on the 4px modular scale', bad.length === 0, bad.join(' | '));

  const manyColours = [];
  for (const d of DIRS) {
    const pal = nx.NX_COMPOSE_DIRECTIONS[d].palette;
    const hexes = new Set(Object.values(pal).filter(v => /^#[0-9a-f]{6}$/i.test(String(v))).map(v => String(v).toUpperCase()));
    if (hexes.size > 12) manyColours.push(`${d}: ${hexes.size}`);
  }
  check('each palette stays within a disciplined colour count', manyColours.length === 0, manyColours.join(', '));
}

console.log('\n== F. Copy quality is checked deterministically (§4.1) ==');
{
  const bad = [];
  for (const d of DIRS) {
    const doc = new JSDOM(pages[d]).window.document;
    const r = C.nxAuditCopy(doc);
    const blocking = r.issues.filter(i => i.severity === 'blocking');
    if (blocking.length) bad.push(`${d}: ${blocking[0].rule} ${blocking[0].measured}`);
  }
  check('no placeholder text ships in any direction', bad.length === 0, bad.join(' | '));

  // The checks must actually fire — a silent auditor is worthless.
  const junk = new JSDOM('<!DOCTYPE html><html><body>'
    + '<h1>Unlock your potential and take it to the next level with a seamless experience</h1>'
    + '<p class="c-lead">Lorem ipsum dolor sit amet.</p>'
    + '<a class="c-btn">Click here to get started with our truly amazing offer</a>'
    + '</body></html>').window.document;
  const jr = C.nxAuditCopy(junk);
  check('clichés are detected', jr.issues.some(i => i.rule === 'cliche'));
  check('placeholder text is blocking', jr.issues.some(i => i.rule === 'placeholder' && i.severity === 'blocking'));
  check('over-long slot copy is detected', jr.issues.some(i => i.rule === 'slot-overflow'));
}

console.log('\n== G. Violations are structured for machine repair (§2 output format) ==');
{
  const bad = new JSDOM('<!DOCTYPE html><html><body><p>x</p></body></html>').window.document;
  const r = V.nxValidatePage('<!DOCTYPE html><html><body><div><p>unclosed</body></html>');
  const shaped = r.violations.every(v => v.severity && v.category && v.rule && v.message);
  check('every violation carries severity, category, rule and message', shaped, JSON.stringify(r.violations[0] || {}));
  check('malformed HTML produces blocking violations', r.blocking.length > 0, String(r.blocking.length));
}

console.log('\n== H. The pipeline never overstates what it verified (§1, §6) ==');
{
  const r = V.nxValidatePage(pages[DIRS[0]]);
  // No browser could be installed here, so claiming a real render would be a lie.
  check('reports browserValidated:false', r.browserValidated === false);
  check('labels its layout numbers as approximate', r.renderer === 'approximate');
  check('carries an explicit caveat about unverified pixels', /not verified/i.test(String(r.note)));
}

console.log('\n== I. The repair loop cannot make a page worse (§5) ==');
{
  const broken = '<!DOCTYPE html><html><head><title>t</title></head><body><div><p>unclosed</body></html>';
  const worse = () => '<!DOCTYPE html><html><body><p><div>even worse</body></html>';
  const out = V.nxValidateAndRepair(() => broken, worse, { maxIterations: 3 });
  check('a regressive repair is rejected', out.html === broken, 'accepted a worse candidate');

  const fixIt = require('../backend/src/nx_ast.js').nxAstAutoClose;
  const out2 = V.nxValidateAndRepair(() => broken, (h) => fixIt(h).html, { maxIterations: 3 });
  check('a genuine repair is accepted and reduces blockers',
    out2.report.blocking.length < V.nxValidatePage(broken).blocking.length,
    `${V.nxValidatePage(broken).blocking.length} → ${out2.report.blocking.length}`);
  check('the loop terminates within its iteration budget', out2.iterations <= 4, String(out2.iterations));
}

const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
