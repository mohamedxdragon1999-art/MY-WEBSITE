// RENDERED DESIGN-QUALITY INVARIANTS.
//
// Cycle 2 forbids "the score improved" as proof. These assertions are measured on
// the RENDERED page and encode non-negotiable craft rules: a coherent typographic
// hierarchy, a bounded visual-emphasis budget, real section rhythm, WCAG contrast,
// and a mobile layout that re-composes instead of overflowing.
//
// Run: node tests/test_render_quality.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const nx = require('../backend/src/nx_compose.js');
const st = require('../backend/src/nx_structured.js');
const { JSDOM } = require('jsdom');

const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);
let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const PLAN = {
  site_name: 'Atelier North', hero_headline: 'Objects of permanence, made slowly.',
  hero_sub: 'A studio for considered interiors.',
  services: [{ title: 'Furniture', desc: 'Built to last.' }, { title: 'Lighting', desc: 'Sculptural.' }, { title: 'Textiles', desc: 'Hand-woven.' }],
  why: ['Made to order', 'Natural materials'], stats: [{ value: 12, label: 'Years' }],
  projects: [{ title: 'Halcyon', cat: 'Residential' }], reviews: [{ text: 'Superb.', name: 'E', role: 'Owner' }],
  faqs: [{ q: 'Lead time?', a: 'Six weeks.' }], contact: { email: 'h@x.co' },
};
// Resolve clamp(min,preferred,max) to its desktop ceiling, in px.
function px(v) {
  const m = String(v).match(/clamp\(([^,]+),([^,]+),([^)]+)\)/);
  const pick = m ? m[3] : v; const n = parseFloat(pick);
  return /rem/.test(pick) ? n * 16 : n;
}
function lum(h) { const m = String(h).replace('#', ''); if (m.length < 6) return null; const c = [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function cr(a, b) { const A = lum(a), B = lum(b); if (A == null || B == null) return null; return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); }

console.log('\n== A. Typographic hierarchy is coherent (never "everything is huge") ==');
{
  const inverted = [], unreadable = [], absurd = [];
  for (const d of DIRS) {
    const ts = st.nxStructuralSignature(nx.nxCompose(PLAN, { direction: d }).html).typography || {};
    const chain = ['display', 'hero', 'section', 'body', 'caption'].map(k => ({ k, v: px(ts[k]) }));
    for (let i = 1; i < chain.length; i++) if (chain[i].v > chain[i - 1].v) inverted.push(`${d}: ${chain[i].k}>${chain[i - 1].k}`);
    if (px(ts.body) < 14 || px(ts.body) > 24) unreadable.push(`${d}: body=${px(ts.body)}px`);
    if (px(ts.display) > 200) absurd.push(`${d}: display=${px(ts.display)}px`);
  }
  check('scale is monotonic display ≥ hero ≥ section ≥ body ≥ caption', inverted.length === 0, inverted.join(' | '));
  check('body copy stays in a readable 14–24px range', unreadable.length === 0, unreadable.join(' | '));
  check('no direction uses an absurd display size', absurd.length === 0, absurd.join(' | '));
  const displays = DIRS.map(d => px((st.nxStructuralSignature(nx.nxCompose(PLAN, { direction: d }).html).typography || {}).display));
  check('directions do not all share one display size', new Set(displays).size >= 4, displays.join(','));
}

console.log('\n== B. Visual emphasis budget + section rhythm ==');
{
  const overBudget = [], noFocal = [], uniform = [];
  for (const d of DIRS) {
    const doc = new JSDOM(nx.nxCompose(PLAN, { direction: d }).html).window.document;
    const maxes = doc.querySelectorAll('[data-emphasis="max"]').length;
    if (maxes > 2) overBudget.push(`${d}=${maxes}`);
    if (maxes === 0) noFocal.push(d);
    const beats = new Set([...doc.querySelectorAll('[data-rhythm]')].map(e => e.getAttribute('data-rhythm')));
    if (beats.size < 2) uniform.push(`${d}=${beats.size}`);
  }
  check('no page spends more than 2 sections at max emphasis', overBudget.length === 0, overBudget.join(','));
  check('every page establishes at least one focal point', noFocal.length === 0, noFocal.join(','));
  check('section spacing is not mechanically uniform', uniform.length === 0, uniform.join(','));
}

console.log('\n== C. Colour contrast meets WCAG on every palette ==');
{
  const bad = [];
  for (const d of DIRS) {
    const p = nx.NX_COMPOSE_DIRECTIONS[d].palette;
    const pairs = { 'text/bg': [cr(p.text, p.bg), 4.5], 'muted/bg': [cr(p.muted, p.bg), 4.5], 'faint/bg': [cr(p.faint, p.bg), 3], 'text/surface': [cr(p.text, p.surface), 4.5], 'accent/bg': [cr(p.accent, p.bg), 4.5] };
    for (const [k, [v, need]] of Object.entries(pairs)) if (v != null && v < need) bad.push(`${d} ${k}=${v.toFixed(2)}<${need}`);
  }
  check('all foreground/background pairs meet their WCAG ratio', bad.length === 0, bad.join(' | '));
}

console.log('\n== D. Mobile re-composes and never overflows ==');
{
  const noMq = [], noCollapse = [], noWrap = [], noContain = [], noRm = [];
  for (const d of DIRS) {
    const css = (nx.nxCompose(PLAN, { direction: d }).html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
    const mq = css.match(/@media[^{]*max-width[\s\S]*?\n\}/g) || [];
    if (!mq.length) noMq.push(d);
    else if (!/grid-template-columns\s*:\s*1fr/.test(mq.join(' '))) noCollapse.push(d);
    if (!/overflow-wrap\s*:\s*(anywhere|break-word)/.test(css)) noWrap.push(d);
    if (!/overflow-x\s*:\s*hidden/.test(css)) noContain.push(d);
    if (!/prefers-reduced-motion/.test(css)) noRm.push(d);
  }
  check('every direction ships a mobile breakpoint', noMq.length === 0, noMq.join(','));
  check('mobile collapses multi-column grids (re-composition)', noCollapse.length === 0, noCollapse.join(','));
  check('long words/URLs cannot force horizontal scroll', noWrap.length === 0, noWrap.join(','));
  check('page contains horizontal overflow', noContain.length === 0, noContain.join(','));
  check('motion honours prefers-reduced-motion', noRm.length === 0, noRm.join(','));
}

console.log('\n== E. Content-aware component selection (§5): content shapes composition ==');
{
  const photography = { site_name: 'Ilya Petrov', hero_headline: 'Photographs', projects: [{ title: 'Northlight', cat: 'Series' }, { title: 'Salt', cat: 'Series' }, { title: 'Dusk', cat: 'Series' }] };
  const lawFirm = { site_name: 'Hale & Reed', hero_headline: 'Counsel, precisely', services: [{ title: 'Corporate', desc: 'x' }, { title: 'Disputes', desc: 'y' }, { title: 'Tax', desc: 'z' }, { title: 'IP', desc: 'w' }] };
  const luxury = { site_name: 'Maison Lune', hero_headline: 'Couture, quietly' };
  const shape = (p) => nx.nxCompose(p, { direction: 'luxury-art' }).plan.contentShape.archetype;
  check('a body of work is classified image-led', shape(photography) === 'image-led', shape(photography));
  check('many services with no work is service-led', shape(lawFirm) === 'service-led', shape(lawFirm));
  check('a sparse brief is statement-led', shape(luxury) === 'statement-led', shape(luxury));

  // The SAME direction must compose these differently — otherwise industry/content
  // has no influence and every site is the direction's default template.
  let differs = 0;
  for (const d of DIRS) {
    const a = nx.nxCompose(photography, { direction: d }).plan;
    const b = nx.nxCompose(lawFirm, { direction: d }).plan;
    if (a.heroVariant !== b.heroVariant || a.featureMode !== b.featureMode || a.sections.join() !== b.sections.join()) differs++;
  }
  check('image-led and service-led briefs compose differently within a direction', differs === DIRS.length, differs + '/' + DIRS.length);

  // A lone testimonial must not be rendered as a "grid" of one.
  const one = { site_name: 'X', reviews: [{ text: 'Great', name: 'A' }] };
  const soloGrid = DIRS.filter(d => nx.nxCompose(one, { direction: d }).plan.reviewMode === 'grid');
  check('a single testimonial never renders as a grid', soloGrid.length === 0, soloGrid.join(','));
}

const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
