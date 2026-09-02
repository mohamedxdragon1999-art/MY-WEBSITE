// DESIGN TOKEN SYSTEM — the contract a tokens.css / defaults.css layer encodes.
//
// The generator previously exposed only raw primitives: one colour set, one
// radius, one shadow. Spacing, elevation, motion and stacking were hardcoded
// per rule, which means they could drift, could not be themed, and could not be
// audited. Interaction states (hover/active/focus/disabled) and feedback
// colours (success/warning/danger) did not exist at all — so any generated form
// had no way to express an error.
//
// This suite pins the token contract on the RENDERED page, not on source.
//
// Run: node tests/test_design_tokens.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseHTML } = require('linkedom');
const nx = require('../backend/src/nx_compose.js');
const { nxCascade } = require('../backend/src/nx_cascade.js');
const V = require('../backend/src/nx_validate.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);
const PLAN = { site_name: 'Northgate Civil', hero_headline: 'H', hero_sub: 'S',
  services: [{ title: 'a', desc: 'x' }, { title: 'b', desc: 'y' }], projects: [{ title: 'p', cat: 'c' }],
  reviews: [{ text: 'r', name: 'n' }], stats: [{ value: 1, label: 'l' }], contact: { email: 'h@n.co' } };
const built = {};
for (const d of DIRS) {
  const html = nx.nxCompose(PLAN, { direction: d }).html;
  const doc = parseHTML(html).document;
  built[d] = { html, doc, cascade: nxCascade(html, doc), css: (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '' };
}
const names = (d) => Object.keys(built[d].cascade.vars);

console.log('\n== A. Every scale exists as tokens, not literals ==');
{
  const SCALES = [
    ['spacing', /^--space-\d/, 8],
    ['radius', /^--rad-/, 3],
    ['elevation', /^--elev-/, 3],
    ['motion duration', /^--dur-/, 3],
    ['easing', /^--ease/, 2],
    ['stacking', /^--z-/, 4],
  ];
  const missing = [];
  for (const d of DIRS) for (const [label, re, min] of SCALES) {
    const n = names(d).filter((x) => re.test(x)).length;
    if (n < min) missing.push(`${d}: ${label} has ${n} (need ${min})`);
  }
  check('every direction exposes a full scale for each dimension', missing.length === 0, missing.slice(0, 4).join(' | '));
}

console.log('\n== B. Interaction states and feedback colours exist ==');
{
  // A generated form could not previously express hover, focus or an error.
  const noState = [], noFeedback = [];
  for (const d of DIRS) {
    const n = names(d);
    for (const s of ['--state-hover', '--state-active', '--state-focus', '--state-disabled'])
      if (!n.includes(s)) noState.push(`${d}:${s}`);
    for (const f of ['--success', '--warning', '--danger', '--info'])
      if (!n.includes(f)) noFeedback.push(`${d}:${f}`);
  }
  check('interaction-state tokens are defined', noState.length === 0, noState.slice(0, 4).join(', '));
  check('feedback tokens are defined', noFeedback.length === 0, noFeedback.slice(0, 4).join(', '));
  // …and are actually consumed, not merely declared.
  const unusedState = DIRS.filter((d) => !/var\(--state-hover\)/.test(built[d].css));
  check('state tokens are consumed by real rules', unusedState.length === 0, unusedState.join(','));
  const noMsg = DIRS.filter((d) => !/\.c-msg-danger/.test(built[d].css));
  check('feedback tokens are consumed by real utilities', noMsg.length === 0, noMsg.join(','));
}

console.log('\n== C. No dangling tokens, and no ad-hoc stacking ==');
{
  const dangling = [];
  for (const d of DIRS) { const dv = built[d].cascade.danglingVars(); if (dv.length) dangling.push(`${d}: ${dv.join(',')}`); }
  // A referenced-but-undefined property makes every calc() using it invalid.
  check('no token is referenced without being defined', dangling.length === 0, dangling.join(' | '));

  const adhoc = [];
  for (const d of DIRS) {
    // z-index:0 is the base layer and is meaningful as a literal; anything
    // above it must come from the ladder or stacking bugs become unfixable.
    const raw = [...built[d].css.matchAll(/z-index:\s*(\d+)/g)].map((m) => +m[1]).filter((v) => v > 0);
    if (raw.length) adhoc.push(`${d}: ${raw.join(',')}`);
  }
  check('no ad-hoc z-index above the base layer', adhoc.length === 0, adhoc.join(' | '));
}

console.log('\n== D. The browser is told which colour scheme this is ==');
{
  // Without color-scheme, native form controls and scrollbars render light
  // chrome on a dark page.
  const missing = [], wrong = [];
  for (const d of DIRS) {
    const m = /color-scheme:\s*(\w+)/.exec(built[d].css);
    if (!m) { missing.push(d); continue; }
    // Derived from real background luminance, so it cannot drift from the palette.
    const bg = String(nx.NX_COMPOSE_DIRECTIONS[d].palette.bg).replace('#', '');
    const c = [0, 2, 4].map((i) => parseInt(bg.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const want = lum < 0.5 ? 'dark' : 'light';
    if (m[1] !== want) wrong.push(`${d}: says ${m[1]}, palette is ${want}`);
  }
  check('every page declares a colour scheme', missing.length === 0, missing.join(','));
  check('the declared scheme matches the actual palette luminance', wrong.length === 0, wrong.join(' | '));
}

console.log('\n== E. Scales are coherent, not arbitrary ==');
{
  const px = (v) => { const m = /(-?[\d.]+)px/.exec(String(v || '')); return m ? parseFloat(m[1]) : null; };
  const bad = [];
  for (const d of DIRS) {
    const v = built[d].cascade.vars;
    // Spacing must ascend monotonically or it is not a scale.
    const steps = Object.keys(v).filter((k) => /^--space-\d+$/.test(k))
      .sort((a, b) => +a.split('-')[2] - +b.split('-')[2]).map((k) => px(v[k]));
    for (let i = 1; i < steps.length; i++) if (steps[i] !== null && steps[i - 1] !== null && steps[i] <= steps[i - 1]) { bad.push(`${d}: spacing not ascending at step ${i}`); break; }
    // Radius scale must ascend too (xs < sm < md < lg), ignoring the 0 case.
    const r = ['--rad-xs', '--rad-sm', '--rad-md', '--rad-lg'].map((k) => px(v[k]));
    if (r.every((x) => x !== null) && r[3] > 0) {
      for (let i = 1; i < r.length; i++) if (r[i] < r[i - 1]) { bad.push(`${d}: radius scale not ascending`); break; }
    }
    // Durations must ascend fast < base < slow.
    const dur = ['--dur-fast', '--dur-base', '--dur-slow'].map((k) => parseFloat(String(v[k] || '')));
    if (dur.every((x) => Number.isFinite(x)) && !(dur[0] < dur[1] && dur[1] < dur[2])) bad.push(`${d}: durations not ordered`);
    // Stacking ladder must ascend.
    const z = ['--z-base', '--z-raised', '--z-sticky', '--z-overlay', '--z-modal'].map((k) => parseFloat(String(v[k] || '')));
    if (z.every((x) => Number.isFinite(x))) for (let i = 1; i < z.length; i++) if (z[i] <= z[i - 1]) { bad.push(`${d}: z ladder not ascending`); break; }
  }
  check('spacing, radius, duration and stacking scales all ascend', bad.length === 0, bad.slice(0, 4).join(' | '));
}

console.log('\n== F. Tokenisation did not break the output ==');
{
  const failing = DIRS.filter((d) => !V.nxValidatePage(built[d].html).pass);
  check('all six directions still clear the blocking gate', failing.length === 0,
    failing.map((d) => V.nxValidatePage(built[d].html).blocking[0].rule).join(', '));
  const st = require('../backend/src/nx_structured.js');
  const sigs = DIRS.map((d) => st.nxStructuralSignature(built[d].html));
  let min = 1;
  for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) min = Math.min(min, st.nxSignatureDistance(sigs[i], sigs[j]));
  check('directions remain structurally distinct', min > 0.20, `min=${min.toFixed(3)}`);
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
