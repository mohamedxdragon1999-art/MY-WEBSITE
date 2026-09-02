// PHASE 1.4 — PERMANENT REGRESSION CORPUS + ANTI-SLOP CRAFT RULES.
//
// Until now every fixture was inline in the suite that happened to find the
// bug, so adding a regression meant editing test CODE. That is friction, and
// friction means bugs quietly stop being pinned. The corpus is now DATA
// (tests/fixtures/regressions.json): adding a fixture is a JSON entry, and
// every entry records the cycle it came from and what actually broke.
//
// Three classes, all enforced here:
//   bad   — MUST be caught (a real defect from a real cycle)
//   good  — MUST NOT be flagged (guards against over-strict rules, which have
//           already caused two false-positive regressions in this project)
//   edge  — must not crash
//
// The `slop` rules are distilled from the high-end-visual-design skill supplied
// in SKILLS.zip. They catch a different failure class: output that VALIDATES
// but still looks machine-made — a generic body font used for headings, harsh
// black drop shadows, banned linear/ease-in-out motion.
//
// Run: node tests/test_regression_corpus.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const V = require('../backend/src/nx_validate.js');
const nx = require('../backend/src/nx_compose.js');
const CORPUS = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'regressions.json'), 'utf8'));

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);

console.log(`\n== A. Known-bad fixtures are still caught (${CORPUS.bad.length}) ==`);
{
  const missed = [], wrongRule = [];
  for (const f of CORPUS.bad) {
    const r = V.nxValidatePage(f.html);
    if (r.pass) { missed.push(`${f.id} (cycle ${f.cycle})`); continue; }
    const rules = new Set(r.blocking.map((b) => b.rule));
    if (f.expect && !rules.has(f.expect)) wrongRule.push(`${f.id}: expected ${f.expect}, got ${[...rules].join(',')}`);
  }
  check('every historical defect is still detected', missed.length === 0, missed.join(' | '));
  check('each is detected as the RIGHT rule, not incidentally', wrongRule.length === 0, wrongRule.join(' | '));
}

console.log(`\n== B. Known-good fixtures are never false-flagged (${CORPUS.good.length}) ==`);
{
  // Over-strict rules have caused two real false-positive regressions in this
  // project (an <a><figure> nesting rule, and a section audit that walked bare
  // <h1>/<p> children). This class exists to stop a third.
  const flagged = [];
  for (const f of CORPUS.good) {
    const r = V.nxValidatePage(f.html);
    if (!r.pass) flagged.push(`${f.id}: ${r.blocking.slice(0, 2).map((b) => b.rule).join(',')}`);
  }
  check('no legitimate document is blocked', flagged.length === 0, flagged.join(' | '));
}

console.log(`\n== C. Edge cases never crash the pipeline (${CORPUS.edge.length}) ==`);
{
  const crashed = [];
  for (const f of CORPUS.edge) {
    try { const r = V.nxValidatePage(f.html); if (typeof r.pass !== 'boolean') crashed.push(`${f.id}: no verdict`); }
    catch (e) { crashed.push(`${f.id}: ${String(e.message).slice(0, 40)}`); }
  }
  check('every edge case yields a verdict without throwing', crashed.length === 0, crashed.join(' | '));
}

console.log('\n== D. The corpus itself stays honest ==');
{
  // A fixture that no longer reproduces its bug is worse than no fixture: it
  // gives false confidence. Require provenance on every entry.
  const noProv = CORPUS.bad.filter((f) => !f.cycle || !f.bug);
  check('every bad fixture records its cycle and the real bug', noProv.length === 0, noProv.map((f) => f.id).join(','));
  const noWhy = CORPUS.good.filter((f) => !f.why);
  check('every good fixture explains what it guards against', noWhy.length === 0, noWhy.map((f) => f.id).join(','));
  const ids = CORPUS.bad.concat(CORPUS.good, CORPUS.edge).map((f) => f.id);
  check('fixture ids are unique', new Set(ids).size === ids.length);
  check('the corpus covers multiple cycles', new Set(CORPUS.bad.map((f) => f.cycle)).size >= 3);
}

console.log('\n== E. Anti-slop craft rules (from the SKILLS design pack) ==');
{
  const slop = CORPUS.slop;
  const PLAN = { site_name: 'Northgate Civil', hero_headline: 'H', hero_sub: 'S',
    services: [{ title: 'a', desc: 'x' }, { title: 'b', desc: 'y' }, { title: 'c', desc: 'z' }], contact: { email: 'h@n.co' } };
  const genericDisplay = [], harshShadow = [], bannedMotion = [], noPairing = [];
  for (const d of DIRS) {
    const dir = nx.NX_COMPOSE_DIRECTIONS[d];
    const css = (nx.nxCompose(PLAN, { direction: d }).html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
    const display = String(dir.type.family || '');
    const body = String(dir.type.bodyFamily || dir.type.family || '');
    // A generic UI sans as the DISPLAY face is the clearest "generic AI" tell.
    for (const f of slop.bannedDisplayFonts) {
      if (new RegExp(`^['"]${f}['"]`).test(display.trim())) genericDisplay.push(`${d}: ${f}`);
    }
    // Display and body identical = no typographic pairing at all.
    if (display === body) noPairing.push(d);
    for (const m of css.matchAll(/box-shadow:([^;}]+)/g)) {
      const a = /rgba\(0,\s*0,\s*0,\s*(0?\.\d+)\)/.exec(m[1]);
      if (a && parseFloat(a[1]) > slop.maxShadowAlpha && !/inset/.test(m[1])) harshShadow.push(`${d}: alpha ${a[1]}`);
    }
    for (const t of slop.bannedTransitionTimings) {
      if (new RegExp(`transition:[^;}]*\\b${t}\\b`).test(css)) bannedMotion.push(`${d}: ${t}`);
    }
  }
  check('no direction uses a generic UI sans as its display face', genericDisplay.length === 0, genericDisplay.join(', '));
  check('every direction has a real display/body pairing', noPairing.length === 0, noPairing.join(', '));
  check('no harsh black drop shadows', harshShadow.length === 0, harshShadow.join(', '));
  check('no banned linear/ease-in-out transitions', bannedMotion.length === 0, bannedMotion.join(', '));
}

console.log('\n== F. Generated output still clears the whole corpus bar ==');
{
  const PLAN = { site_name: 'Northgate Civil', hero_headline: 'Groundworks, done properly',
    hero_sub: 'Civil engineering for commercial sites.',
    services: [{ title: 'Groundworks', desc: 'Excavation.' }], projects: [{ title: 'Pier 7', cat: 'Commercial' }],
    contact: { email: 'h@n.co' } };
  const bad = DIRS.filter((d) => !V.nxValidatePage(nx.nxCompose(PLAN, { direction: d }).html).pass);
  check('all six directions pass every corpus rule', bad.length === 0, bad.join(', '));
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
