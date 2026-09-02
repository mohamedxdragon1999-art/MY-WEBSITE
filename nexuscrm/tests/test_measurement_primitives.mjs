// THE PRIMITIVES EVERY VERDICT RESTS ON.
//
// Nineteen exported functions had never been tested directly — only through the
// pipelines that consume them. That is backwards: if nxResolveLength or
// nxContrast is wrong, then every "PASS" the gate has ever emitted is
// meaningless, and no amount of end-to-end testing reveals it, because the
// measurement and the assertion are wrong in the same direction.
//
// Testing them directly found four real defects:
//   * clampNum() stripped units, so `1.5rem` measured 1.5 and `24px` measured
//     24 — a 16x error. Two visually IDENTICAL type scales in different units
//     scored 0.455 apart, and the real min direction distance was understated
//     (0.379 vs the true 0.592).
//   * nxContrast returned NaN (not null) for unparseable colours; NaN compares
//     false against every threshold, so a failing pair passed the gate silently.
//   * calc() containing a nested clamp()/min()/max() resolved to null — i.e.
//     the declaration was silently not measured at all.
//
// Run: node tests/test_measurement_primitives.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../backend/src/nx_layout.js');
const V = require('../backend/src/nx_validate.js');
const C = require('../backend/src/nx_copy.js');
const S = require('../backend/src/nx_structured.js');
const A = require('../backend/src/nx_cascade.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const ctx = { vw: 1440, vh: 900, fontSize: 16, rootFontSize: 16, parentWidth: 1440 };
const near = (a, b, tol = 0.51) => a != null && Math.abs(a - b) <= tol;

console.log('\n== A. nxResolveLength: every CSS length form ==');
{
  const CASES = [
    ['10px', 10], ['0', 0], ['1rem', 16], ['1.5rem', 24], ['2em', 32],
    ['50%', 720], ['10vw', 144], ['10vh', 90], ['100vw', 1440],
    ['calc(100px + 2rem)', 132], ['calc(50% - 20px)', 700], ['calc(10vw*2)', 288],
    ['clamp(16px,10vw,32px)', 32], ['clamp(16px,1vw,32px)', 16], ['clamp(10px,5vw,100px)', 72],
    ['min(100px,10vw)', 100], ['max(100px,10vw)', 144], ['min(50%,300px)', 300],
    ['calc(1rem + 1vw)', 30.4],
    // Real stylesheets nest these; both used to fail.
    ['clamp(1rem,calc(2vw + 1rem),4rem)', 44.8],
    ['calc(clamp(10px,1vw,20px) * 2)', 28.8],
  ];
  const wrong = CASES.filter(([v, e]) => !near(L.nxResolveLength(v, ctx), e))
    .map(([v, e]) => `${v}→${L.nxResolveLength(v, ctx)} (want ${e})`);
  check('every length form resolves to the correct pixel value', wrong.length === 0, wrong.slice(0, 4).join(' | '));

  const bad = [];
  for (const junk of [null, undefined, '', 'abc', 'calc()', 'clamp(1px)', 'var(--x)', '10qq', 'NaN', 'calc(1px + )', '((']) {
    let r; try { r = L.nxResolveLength(junk, ctx); } catch (e) { bad.push(`threw on ${JSON.stringify(junk)}`); continue; }
    if (typeof r === 'number' && !Number.isFinite(r)) bad.push(`${JSON.stringify(junk)}→${r}`);
  }
  check('unparseable input yields null, never NaN or a throw', bad.length === 0, bad.slice(0, 3).join(' | '));
}

console.log('\n== B. nxContrast: WCAG ratios must be exact ==');
{
  // Reference values from the WCAG relative-luminance formula.
  const CASES = [['#000000', '#ffffff', 21], ['#ffffff', '#ffffff', 1], ['#777777', '#ffffff', 4.48],
    ['#595959', '#ffffff', 7.0], ['#0000ff', '#ffffff', 8.59], ['#808080', '#000000', 5.32]];
  const wrong = CASES.filter(([a, b, e]) => { const g = V.nxContrast(a, b); return g == null || Math.abs(g - e) > 0.12; })
    .map(([a, b, e]) => `${a}/${b}→${V.nxContrast(a, b)} (want ${e})`);
  check('contrast ratios match the WCAG formula', wrong.length === 0, wrong.join(' | '));
  check('contrast is symmetric', Math.abs(V.nxContrast('#123456', '#abcdef') - V.nxContrast('#abcdef', '#123456')) < 1e-9);

  // A NaN ratio compares false against EVERY threshold — a failing pair would
  // pass the gate silently. Unparseable input must be null, not NaN.
  const nany = [];
  for (const junk of [null, undefined, '', 'red', '#fff', 'rgb(0,0,0)', '#gggggg', 'transparent']) {
    const r = V.nxContrast(junk, '#ffffff');
    if (r != null && (!Number.isFinite(r) || r < 1 || r > 21)) nany.push(`${JSON.stringify(junk)}→${r}`);
  }
  check('unparseable colours yield null, never NaN', nany.length === 0, nany.join(' | '));
}

console.log('\n== C. clampNum: units must normalise to pixels ==');
{
  const CASES = [['24px', 24], ['1.5rem', 24], ['2em', 32], ['0.75rem', 12], ['16px', 16]];
  const wrong = CASES.filter(([v, e]) => !near(S.clampNum(v), e, 1.1)).map(([v, e]) => `${v}→${S.clampNum(v)} (want ${e})`);
  check('rem/em/px all normalise to the same pixel scale', wrong.length === 0, wrong.join(' | '));

  // The consequence that made this matter: identical scales in different units
  // must measure as identical, or direction distance is pure noise.
  const base = { order: [], hero: 'x', feature: 'y', palette: {}, motion: 'm', density: 'd' };
  const remScale = { ...base, typography: { display: '3rem', hero: '2rem', section: '1.5rem', body: '1rem' } };
  const pxScale = { ...base, typography: { display: '48px', hero: '32px', section: '24px', body: '16px' } };
  const dist = S.nxSignatureDistance(remScale, pxScale);
  check('two identical type scales in different units measure as close', dist < 0.15, `distance=${dist.toFixed(3)}`);
  const junked = [];
  for (const j of [null, undefined, '', 'abc', {}]) { try { S.clampNum(j); } catch (e) { junked.push(String(j)); } }
  check('clampNum never throws', junked.length === 0, junked.join(','));
}

console.log('\n== D. nxCascade value resolution ==');
{
  const vars = { '--a': '#fff', '--b': 'var(--a)', '--c': 'var(--missing, 12px)', '--loop': 'var(--loop)' };
  check('a direct custom property resolves', A.nxResolveValue('var(--a)', vars) === '#fff');
  check('a chained custom property resolves', A.nxResolveValue('var(--b)', vars) === '#fff');
  check('a fallback is used when the property is undefined', A.nxResolveValue('var(--c)', vars) === '12px');
  check('an undefined property with no fallback yields null', A.nxResolveValue('var(--nope)', vars) === null);
  let looped = true;
  try { A.nxResolveValue('var(--loop)', vars); } catch (e) { looped = false; }
  check('a self-referential property does not hang or throw', looped);
}

console.log('\n== E. Copy + text metrics behave monotonically ==');
{
  const easy = C.nxReadability('The cat sat on the mat. We fix drains. Call us today.');
  const hard = C.nxReadability('Notwithstanding the aforementioned considerations, implementation of multifaceted infrastructural methodologies necessitates comprehensive interdisciplinary evaluation.');
  check('simple prose scores easier than dense prose', easy != null && hard != null && easy > hard, `${easy} vs ${hard}`);
  const threw = [];
  for (const j of [null, undefined, '', '   ', 123, {}]) { try { C.nxReadability(j); } catch (e) { threw.push(String(j)); } }
  check('readability never throws on junk', threw.length === 0, threw.join(','));

  check('text width grows with length', L.nxTextWidth('a'.repeat(20), 16) > L.nxTextWidth('a'.repeat(10), 16));
  check('text width grows with font size', L.nxTextWidth('aaa', 32) > L.nxTextWidth('aaa', 16));
}

console.log('\n== F. The fix changed real measurements, not just unit tests ==');
{
  const nx = require('../backend/src/nx_compose.js');
  const BRIEF = { site_name: 'N', hero_headline: 'H', services: [{ title: 'a', desc: 'b' }], projects: [{ title: 'p', cat: 'c' }], reviews: [{ text: 'r', name: 'n' }], stats: [{ value: 1, label: 'l' }], contact: { email: 'h@n.co' } };
  const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);
  const sigs = {}; for (const d of DIRS) sigs[d] = S.nxStructuralSignature(nx.nxCompose(BRIEF, { direction: d }).html);
  let min = 1;
  for (let i = 0; i < DIRS.length; i++) for (let j = i + 1; j < DIRS.length; j++) min = Math.min(min, S.nxSignatureDistance(sigs[DIRS[i]], sigs[DIRS[j]]));
  // Unit-correct measurement raised the true figure from 0.379 to ~0.59: the
  // directions were always this different; the ruler was wrong.
  check('direction distance is measured with unit-correct sizes', min > 0.45, `min=${min.toFixed(3)}`);
  const leaky = DIRS.filter((d) => Object.values(sigs[d].typography || {}).some((v) => /[{}]/.test(String(v))));
  check('no CSS leaks into the measured type scale', leaky.length === 0, leaky.join(','));
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
