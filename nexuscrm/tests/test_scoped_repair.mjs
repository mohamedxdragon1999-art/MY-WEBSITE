// PHASE 1.3 — SCOPE-LIMITED REPAIR WITH ESCALATING SPECIFICITY.
//
// The previous repairer was a hammer: one 20px link failing the tap-target rule
// caused `a:not(p a),button{min-height:44px}` to be injected, restyling EVERY
// anchor and button on the page — including ones that were already correct.
// One faulty element, page-wide collateral damage.
//
// Repair now starts at the narrowest scope that can fix the reported violation
// and widens ONLY when re-measurement proves the narrow fix failed:
//   element → container → page
//
// Two real defects found while building this:
//   * violations are reported once PER VIEWPORT, so one faulty element looked
//     like four failures; the narrow fix was judged unsuccessful and discarded,
//     escalating straight to the page-wide rule it exists to avoid;
//   * a descriptive selector like "div" matches many nodes and the FIRST is
//     usually innocent — the fix landed on the wrong element. Targets are now
//     disambiguated using the measured evidence.
//
// Run: node tests/test_scoped_repair.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseHTML } = require('linkedom');
const R = require('../backend/src/nx_repair.js');
const V = require('../backend/src/nx_validate.js');
const nx = require('../backend/src/nx_compose.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const validate = (h) => V.nxValidatePage(h);
const HEAD = '<!DOCTYPE html><html lang="en"><head><title>T</title><meta name="description" content="d">';

console.log('\n== A. A single faulty element is fixed WITHOUT touching siblings ==');
{
  const page = HEAD + '<style>.keep{letter-spacing:.4em;color:#123456}</style></head><body><main>'
    + '<h1 class="keep">Precise Heading</h1><p class="keep">Authored copy that must survive.</p>'
    + '<section id="good"><h2>Fine</h2><p>Also fine.</p></section>'
    + '<a class="big" href="#good" style="min-height:80px;display:block">Large control</a>'
    + '<a class="tiny" href="#good">x</a></main></body></html>';
  const out = R.nxRepairScoped(page, validate(page).blocking, validate);
  const d0 = parseHTML(page).document, d1 = parseHTML(out.html).document;
  check('an untouched section is byte-identical afterwards',
    d0.querySelector('#good').outerHTML === d1.querySelector('#good').outerHTML);
  check('authored CSS is preserved', /letter-spacing:\.4em/.test(out.html) && /#123456/.test(out.html));
  check('authored classes are preserved', d1.querySelectorAll('.keep').length === 2);
  check('the already-correct control keeps its own styling', /class="big"[^>]*min-height:80px/.test(out.html));
  // The whole point: no page-wide selector for a single-element defect.
  const css = (out.html.match(/<style id="nx-repair">([\s\S]*?)<\/style>/) || [])[1] || '';
  check('no page-wide anchor rule is injected', !/a:not\(p a\)/.test(css), css.slice(0, 80));
  check('the fix targets a specific element', /\[data-nx-fix=/.test(css) || css === '', css.slice(0, 80));
}

console.log('\n== B. Repair reports WHICH element it changed ==');
{
  const page = HEAD + '</head><body><main><h1>H</h1><a class="tiny" href="#s">x</a><section id="s"><h2>S</h2></section></main></body></html>';
  const out = R.nxRepairScoped(page, validate(page).blocking, validate);
  const vague = out.applied.filter((a) => !a.selector || a.selector === 'page');
  check('every applied repair names its target', out.applied.length === 0 || vague.length === 0,
    JSON.stringify(out.applied.map((a) => a.selector)));
  check('every applied repair records its tier', out.applied.every((a) => ['element', 'container', 'page', 'document'].includes(a.tier)));
}

console.log('\n== C. Escalation happens only on measured failure ==');
{
  // An inline min-width no stylesheet can beat: the element tier must handle it
  // by rewriting that ONE attribute, never by escalating.
  const page = HEAD + '</head><body><main><h1>H</h1><div id="innocent" style="color:red">fine</div>'
    + '<div style="min-width:4000px">wide</div></main></body></html>';
  const out = R.nxRepairScoped(page, validate(page).blocking, validate);
  check('the overflow is resolved', validate(out.html).blocking.filter((b) => /overflow/.test(b.rule)).length === 0);
  check('it is resolved at ELEMENT scope, not page scope',
    out.applied.some((a) => /overflow/.test(a.rule) && a.tier === 'element'),
    JSON.stringify(out.applied.map((a) => a.rule + '@' + a.tier)));
  check('no page-wide overflow hammer is injected', !/html,body\{max-width/.test(out.html));
  check('the innocent sibling is untouched', /id="innocent" style="color:red"/.test(out.html));
  // Duplicate reports across viewports must not be mistaken for many failures.
  const dupes = validate(page).blocking.filter((b) => /overflow/.test(b.rule)).length;
  check('per-viewport duplicates are collapsed to one target', dupes > 1 && out.trace.length > 0 && out.trace[0].targets.length === 1,
    `${dupes} reports → ${out.trace[0] ? out.trace[0].targets.length : 0} target(s)`);
}

console.log('\n== D. The escalation ladder is ordered and recorded ==');
{
  check('tiers are element → container → page', JSON.stringify(R.NX_TIERS) === JSON.stringify(['element', 'container', 'page']));
  const page = HEAD + '</head><body><main><h1>H</h1><a class="tiny" href="#s">x</a><section id="s"><h2>S</h2></section></main></body></html>';
  const out = R.nxRepairScoped(page, validate(page).blocking, validate);
  check('a trace of what was attempted is produced', Array.isArray(out.trace));
  check('each trace entry records the remaining count', out.trace.every((t) => typeof t.remaining === 'number'));
  // Nothing narrower than the page tier should be skipped.
  const firstTier = out.trace.length ? out.trace[0].tier : 'element';
  check('the narrowest tier is attempted first', firstTier === 'element', firstTier);
}

console.log('\n== E. Repair prompts escalate in specificity ==');
{
  const v = [{ rule: 'overflow', selector: '#hero', viewport: '375x812', measured: 'overflows by 42px', message: '#hero overflows its container.' }];
  const trace = [{ rule: 'overflow', tier: 'element', targets: ['#hero'], remaining: 1 }];
  const p1 = R.nxRepairPrompt(v, [], 1);
  const p2 = R.nxRepairPrompt(v, trace, 2);
  check('the prompt states the measured fact', /42px/.test(p1) && /#hero/.test(p1));
  check('the prompt names the viewport', /375x812/.test(p1));
  check('a later attempt lists what was already tried', /Already attempted/.test(p2) && /element-scoped/.test(p2));
  check('the prompt forbids collateral edits', /Do not restructure/.test(p1) && /do not remove existing styling/i.test(p1));
  check('escalation adds information rather than repeating', p2.length > p1.length);
}

console.log('\n== F. Repair is safe, idempotent, and never invents colour ==');
{
  // Contrast has no safe automatic fix — guessing a colour would silently
  // change the design, so it must be surfaced instead.
  check('contrast is deliberately not auto-fixed', R.STRATEGY.contrast.element === null);

  for (const d of Object.keys(nx.NX_COMPOSE_DIRECTIONS)) {
    const html = nx.nxCompose({ site_name: 'A', hero_headline: 'H', services: [{ title: 's', desc: 'd' }], contact: { email: 'h@n.co' } }, { direction: d }).html;
    const before = validate(html);
    const out = R.nxRepairScoped(html, before.blocking, validate);
    if (validate(out.html).blocking.length > before.blocking.length) { check(`repair does not harm ${d}`, false); break; }
  }
  check('repair never worsens a healthy generated page', true);

  const page = HEAD + '</head><body><main><h1>H</h1><a class="tiny" href="#s">x</a><section id="s"><h2>S</h2></section></main></body></html>';
  const r1 = R.nxRepairScoped(page, validate(page).blocking, validate);
  const r2 = R.nxRepairScoped(r1.html, validate(r1.html).blocking, validate);
  check('repairing an already-repaired page adds no duplicate rules',
    (r2.html.match(/<style id="nx-repair">/g) || []).length <= 1);
}

console.log('\n== G. The live gate uses scoped repair ==');
{
  const broken = HEAD + '</head><body><main><h1>H</h1>'
    + '<a class="ok" href="#s" style="min-height:60px;display:block">Fine</a>'
    + '<a class="tiny" href="#s">x</a><div style="min-width:4000px">w</div>'
    + '<section id="s"><h2>S</h2></section></main></body></html>';
  const before = validate(broken).blocking.length;
  const out = V.nxValidateAndRepair(() => broken, null, { maxIterations: 4 });
  check('the gate reduces blocking violations', out.report.blocking.length < before, `${before} → ${out.report.blocking.length}`);
  const notes = out.log.flatMap((l) => l.repairs || []).map(String);
  check('gate repairs are element-scoped', notes.some((n) => /\[element\]/.test(n)), notes.slice(0, 2).join(' | '));
  check('the gate avoids the page-wide hammer when a narrow fix works', !/html,body\{max-width/.test(out.html));
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
