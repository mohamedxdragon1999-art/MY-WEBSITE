// CROSS-CYCLE HARDENING — attacks on everything built in cycles 1-6.
//
// Each earlier cycle was verified against the failure modes I imagined AT THE
// TIME. This suite attacks those same subsystems from angles never previously
// tried: idempotence, repair safety, boundary correctness, parallelism.
//
// Two real defects found and fixed:
//   * IDENTITY SCRUBBING USED SUBSTRING MATCHING. "Martina Franca" became
//     "Anaa Franca", "Staffordshire terriers" became "Lisbon terriers", and
//     "martin@othercompany.com" was rewritten. Legitimate customer copy was
//     being corrupted. Now word-boundary matched, with the trailing guard tuned
//     from measured failures (a `.` in it stopped "Owner is Martin." matching;
//     an email is protected by the FOLLOWING '@', not a preceding character).
//   * Auto-repair injected three separate <style> blocks.
//
// Run: node tests/test_cross_cycle_hardening.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseHTML } = require('linkedom');
const nx = require('../backend/src/nx_compose.js');
const V = require('../backend/src/nx_validate.js');
const C = require('../backend/src/nx_copy.js');
const I = require('../backend/src/nx_identity.js');
const A = require('../backend/src/nx_ast.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);
const PLAN = { site_name: 'A', hero_headline: 'H', services: [{ title: 's', desc: 'd' }], contact: { email: 'h@n.co' } };
const RULES = [{ rule: 'touch-target' }, { rule: 'overflow-x' }, { rule: 'html-validity' }];

console.log('\n== A. Auto-repair is idempotent ==');
{
  const drift = [], stacked = [];
  for (const d of DIRS) {
    const html = nx.nxCompose(PLAN, { direction: d }).html;
    const r1 = V.nxAutoRepair(html, RULES);
    const r2 = V.nxAutoRepair(r1.html, RULES);
    if (r1.html !== r2.html) drift.push(`${d}: ${r1.html.length}→${r2.html.length}`);
    if ((r2.html.match(/<style/g) || []).length > 2) stacked.push(`${d}: ${(r2.html.match(/<style/g) || []).length} style blocks`);
    if (r2.applied.length) drift.push(`${d}: second pass reported work: ${r2.applied[0]}`);
  }
  check('repairing an already-repaired page changes nothing', drift.length === 0, drift.slice(0, 3).join(' | '));
  check('repair CSS is consolidated, not stacked', stacked.length === 0, stacked.slice(0, 3).join(' | '));
}

console.log('\n== B. Repair never damages a healthy page ==');
{
  const harmed = [], lost = [];
  for (const d of DIRS) {
    const html = nx.nxCompose(PLAN, { direction: d }).html;
    const before = V.nxValidatePage(html);
    const rep = V.nxAutoRepair(html, [{ rule: 'overflow-x' }, { rule: 'touch-target' }]);
    const after = V.nxValidatePage(rep.html);
    if (after.blocking.length > before.blocking.length) harmed.push(`${d}: +${after.blocking.length - before.blocking.length}`);
    const d1 = parseHTML(html).document, d2 = parseHTML(rep.html).document;
    if (d1.querySelectorAll('h1').length !== d2.querySelectorAll('h1').length) harmed.push(`${d}: h1 count changed`);
    if (d2.body.textContent.length < d1.body.textContent.length * 0.98) lost.push(`${d}: text shrank`);
  }
  check('repair never introduces new blocking violations', harmed.length === 0, harmed.slice(0, 3).join(' | '));
  check('repair never loses visible content', lost.length === 0, lost.slice(0, 3).join(' | '));
  // And it must still genuinely fix a broken page.
  const broken = '<!DOCTYPE html><html lang="en"><head><title>t</title><meta name="description" content="d"></head><body><main><h1>H</h1><a href="#x">T</a><div style="width:3000px">w</div></main></body></html>';
  const out = V.nxValidateAndRepair(() => broken, null, { maxIterations: 4 });
  check('repair still resolves a genuinely broken page', out.report.blocking.length === 0,
    `${V.nxValidatePage(broken).blocking.length} → ${out.report.blocking.length}`);
}

console.log('\n== C. Identity scrubbing respects word boundaries ==');
{
  const prof = { name: 'Aurora Yoga', owner: 'Ana', phone: '+351 900', email: 'a@b.co', base: 'Lisbon' };
  // Legitimate customer copy that merely CONTAINS a reference term as a substring.
  const preserve = [
    'Our studio is in Martina Franca, Italy.',
    'Contact martin@othercompany.com for details.',
    'The atkinson method of design.',
    'A martinez family business.',
  ];
  const corrupted = preserve.filter((t) => I.nxScrubIdentity(t, prof) !== t)
    .map((t) => `"${t.slice(0, 34)}" → "${I.nxScrubIdentity(t, prof).slice(0, 34)}"`);
  check('legitimate copy containing a substring is untouched', corrupted.length === 0, corrupted.join(' | '));

  // Genuine identity must STILL be removed — boundaries must not weaken it.
  const scrub = ['Call R C Atkin on 07721 511814', 'Owner is Martin.', 'Speak to Martin, the owner',
    'email info@rcatkincontractor.co.uk', 'Based in Eccleshall'];
  const leaked = scrub.map((t) => [t, I.nxIdentityLeaks(I.nxScrubIdentity(t, prof))])
    .filter(([, l]) => l.length).map(([t, l]) => `${t.slice(0, 26)}: ${l.join(',')}`);
  check('real reference identity is still fully removed', leaked.length === 0, leaked.join(' | '));
  check('a sentence-ending name is scrubbed', !/Martin/.test(I.nxScrubIdentity('Owner is Martin.', prof)));
}

console.log('\n== D. Copy auditing does not block legitimate business writing ==');
{
  const legit = ['We deliver a seamless installation process for every client.',
    'Our team is passionate about delivering measurable results.'];
  const blocked = [];
  for (const t of legit) {
    const doc = parseHTML(`<!DOCTYPE html><html><body><main><h1>T</h1><p>${t}</p></main></body></html>`).document;
    const b = C.nxAuditCopy(doc).issues.filter((i) => i.severity === 'blocking');
    if (b.length) blocked.push(`${t.slice(0, 30)}: ${b[0].rule}`);
  }
  check('marketing phrasing warns but never blocks', blocked.length === 0, blocked.join(' | '));
  // Placeholder text must still be blocking.
  const ph = parseHTML('<!DOCTYPE html><html><body><main><h1>T</h1><p>Lorem ipsum dolor sit amet.</p></main></body></html>').document;
  check('placeholder text is still blocking', C.nxAuditCopy(ph).issues.some((i) => i.rule === 'placeholder' && i.severity === 'blocking'));
}

console.log('\n== E. AST auto-close never loses content ==');
{
  const cases = [
    ['<!DOCTYPE html><html><body><main><h1>Keep</h1><p>This text<div>and this</div></main></body></html>', ['Keep', 'This text', 'and this']],
    ['<!DOCTYPE html><html><body><main><section><h2>A</h2><ul><li>one<li>two</ul></section></main></body></html>', ['one', 'two']],
  ];
  const lost = [];
  for (const [src, words] of cases) {
    const rep = A.nxAstAutoClose(src);
    for (const w of words) if (!rep.html.includes(w)) lost.push(w);
  }
  check('structural repair preserves every word', lost.length === 0, lost.join(', '));
}

console.log('\n== F. Parallel generation is independent ==');
{
  // Shared module state would cross-contaminate concurrent renders.
  const results = await Promise.all(DIRS.map(async (d) =>
    ({ d, html: nx.nxCompose({ site_name: 'Co ' + d, hero_headline: 'H ' + d }, { direction: d }).html })));
  const bad = results.filter(({ d, html }) => !html.includes(`data-dir="${d}"`) || !html.includes('Co ' + d)).map((r) => r.d);
  check('concurrent renders do not bleed into each other', bad.length === 0, bad.join(','));
}

console.log('\n== G. Validation is deterministic ==');
{
  const html = nx.nxCompose(PLAN, { direction: 'luxury-art' }).html;
  const a = V.nxValidatePage(html), b = V.nxValidatePage(html);
  check('the same page always yields the same verdict',
    a.blocking.length === b.blocking.length && a.warnings.length === b.warnings.length,
    `${a.blocking.length}/${a.warnings.length} vs ${b.blocking.length}/${b.warnings.length}`);
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
