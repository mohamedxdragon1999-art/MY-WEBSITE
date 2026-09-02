// THE REFINE LOOP — degrade → diagnose → patch → re-render must CONVERGE.
//
// The self-correction loop is only trustworthy if it (a) actually detects a
// deliberately weakened design, (b) improves the measured metric rather than
// the score, (c) never oscillates or regresses, and (d) does not destroy the
// direction's identity while repairing it.
//
// Building this found a real analyzer bug: the type-scale parser matched
// `font-size:([^;]+)`, which runs past the closing brace when a declaration has
// no trailing semicolon — so `typography.section` contained 500+ characters of
// unrelated CSS. Every check reading that field was measuring garbage.
//
// Run: node tests/test_refine_loop.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const nx = require('../backend/src/nx_compose.js');
const st = require('../backend/src/nx_structured.js');
const V = require('../backend/src/nx_validate.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);
const BRIEF = {
  site_name: 'Northgate Civil', hero_headline: 'Groundworks, done properly', hero_sub: 'Civil engineering for commercial sites.',
  services: [{ title: 'Groundworks', desc: 'Excavation.' }, { title: 'Drainage', desc: 'Install.' }, { title: 'Surfacing', desc: 'Tarmac.' }],
  stats: [{ value: '40+', label: 'Years' }], projects: [{ title: 'Pier 7', cat: 'Commercial' }],
  reviews: [{ text: 'Great.', name: 'R', role: 'Mgr' }], contact: { email: 'h@n.co' },
};
const content = nx.nxComposeContent(BRIEF);
const measure = (html) => st.nxRenderedDesignReport(html);

console.log('\n== A. The type-scale analyzer reads clean values ==');
{
  // A greedy value match swallowed whole CSS rules into the reported font size.
  const dirty = [];
  for (const d of DIRS) {
    const t = st.nxStructuralSignature(nx.nxCompose(BRIEF, { direction: d }).html).typography || {};
    for (const [k, v] of Object.entries(t)) {
      if (/[{}]|c-sec-head|\/\*/.test(String(v))) dirty.push(`${d}.${k}`);
      if (String(v).length > 40) dirty.push(`${d}.${k} len=${String(v).length}`);
    }
  }
  check('no CSS rule leaks into a reported type size', dirty.length === 0, dirty.slice(0, 4).join(' | '));
}

console.log('\n== B. Degradation is genuinely worse (or the loop tests nothing) ==');
{
  const notWorse = [];
  for (const d of DIRS) {
    const good = measure(nx.nxCompose(BRIEF, { direction: d }).html);
    const deg = nx.nxComposeDegrade(BRIEF, d);
    const bad = measure(nx.nxRenderDirected(content, d, deg.plan || deg).html);
    if (!(bad.monotony > good.monotony || bad.cardDependency > good.cardDependency)) {
      notWorse.push(`${d}: mono ${good.monotony}->${bad.monotony}, card ${good.cardDependency}->${bad.cardDependency}`);
    }
  }
  check('the degraded variant measures worse than the healthy one', notWorse.length === 0, notWorse.slice(0, 3).join(' | '));
}

console.log('\n== C. Diagnosis detects the damage it was given ==');
{
  const blind = [];
  for (const d of DIRS) {
    const deg = nx.nxComposeDegrade(BRIEF, d);
    const m = measure(nx.nxRenderDirected(content, d, deg.plan || deg).html);
    if (nx.nxComposeDiagnose(m).length === 0) blind.push(d);
  }
  check('every degraded page is diagnosed as problematic', blind.length === 0, blind.join(','));
  // …and a healthy page must NOT be diagnosed, or the loop churns forever.
  const falsePos = DIRS.filter((d) => nx.nxComposeDiagnose(measure(nx.nxCompose(BRIEF, { direction: d }).html)).length > 0);
  check('a healthy page is not falsely diagnosed', falsePos.length === 0, falsePos.join(','));
}

console.log('\n== D. The loop converges, improves, and never regresses ==');
{
  const noConverge = [], regressed = [], stalled = [], notImproved = [];
  for (const d of DIRS) {
    const deg = nx.nxComposeDegrade(BRIEF, d);
    let plan = deg.plan || deg;
    let html = nx.nxRenderDirected(content, d, plan).html;
    let m = measure(html); const start = m;
    let iters = 0;
    for (let it = 1; it <= 4; it++) {
      const probs = nx.nxComposeDiagnose(m);
      if (!probs.length) break;
      const ops = [...new Set(probs.flatMap((p) => p.ops))];
      const next = nx.nxComposePatchPlan(plan, ops, d);
      const nplan = next.plan || next;
      const nhtml = nx.nxRenderDirected(content, d, nplan).html;
      const nm = measure(nhtml);
      iters = it;
      // A patch must not make the page measurably worse.
      if (nm.monotony > m.monotony + 1) regressed.push(`${d} it${it}: monotony ${m.monotony}->${nm.monotony}`);
      if (nm.cardDependency > m.cardDependency + 0.01) regressed.push(`${d} it${it}: cardDep ${m.cardDependency}->${nm.cardDependency}`);
      if (nhtml === html) stalled.push(`${d} it${it}: identical output, no progress`);
      plan = nplan; html = nhtml; m = nm;
    }
    if (nx.nxComposeDiagnose(m).length) noConverge.push(`${d}: ${nx.nxComposeDiagnose(m).length} problems remain after ${iters} iterations`);
    // The metric must genuinely move — not just the diagnosis stop firing.
    if (!(m.monotony < start.monotony)) notImproved.push(`${d}: monotony ${start.monotony}->${m.monotony}`);
  }
  check('the loop converges within the iteration budget', noConverge.length === 0, noConverge.slice(0, 3).join(' | '));
  check('no iteration makes the design measurably worse', regressed.length === 0, regressed.slice(0, 3).join(' | '));
  check('no iteration stalls producing identical output', stalled.length === 0, stalled.slice(0, 3).join(' | '));
  check('the measured metric genuinely improves', notImproved.length === 0, notImproved.slice(0, 3).join(' | '));
}

console.log('\n== E. Repair preserves validity and identity ==');
{
  const invalid = [], lostId = [];
  for (const d of DIRS) {
    const deg = nx.nxComposeDegrade(BRIEF, d);
    let plan = deg.plan || deg;
    let m = measure(nx.nxRenderDirected(content, d, plan).html);
    for (let it = 1; it <= 4; it++) {
      const probs = nx.nxComposeDiagnose(m); if (!probs.length) break;
      const next = nx.nxComposePatchPlan(plan, [...new Set(probs.flatMap((p) => p.ops))], d);
      plan = next.plan || next;
      m = measure(nx.nxRenderDirected(content, d, plan).html);
    }
    const html = nx.nxRenderDirected(content, d, plan).html;
    if (!V.nxValidatePage(html).pass) invalid.push(`${d}: ${V.nxValidatePage(html).blocking[0].rule}`);
    // Repairing must not turn every direction into the same safe layout.
    if (!html.includes(`data-dir="${d}"`)) lostId.push(d);
  }
  check('a repaired page still clears the blocking gate', invalid.length === 0, invalid.slice(0, 3).join(' | '));
  check('repair does not erase the direction identity', lostId.length === 0, lostId.join(','));
}

console.log('\n== F. Repaired pages stay distinct from each other ==');
{
  // The failure mode to guard: every repair converging on one bland layout.
  const sigs = {};
  for (const d of DIRS) {
    const deg = nx.nxComposeDegrade(BRIEF, d);
    let plan = deg.plan || deg;
    let m = measure(nx.nxRenderDirected(content, d, plan).html);
    for (let it = 1; it <= 4; it++) {
      const probs = nx.nxComposeDiagnose(m); if (!probs.length) break;
      const next = nx.nxComposePatchPlan(plan, [...new Set(probs.flatMap((p) => p.ops))], d);
      plan = next.plan || next;
      m = measure(nx.nxRenderDirected(content, d, plan).html);
    }
    sigs[d] = st.nxStructuralSignature(nx.nxRenderDirected(content, d, plan).html);
  }
  let min = 1, worst = '';
  for (let i = 0; i < DIRS.length; i++) for (let j = i + 1; j < DIRS.length; j++) {
    const v = st.nxSignatureDistance(sigs[DIRS[i]], sigs[DIRS[j]]);
    if (v < min) { min = v; worst = `${DIRS[i]}↔${DIRS[j]}`; }
  }
  check('repaired directions remain structurally distinct', min > 0.20, `min=${min.toFixed(3)} (${worst})`);
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
