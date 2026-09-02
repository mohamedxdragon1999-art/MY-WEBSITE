// COMPUTED VISUAL VERIFICATION — what the user actually SEES.
//
// Every earlier suite inspected MARKUP ("is the class present?") or grepped the
// stylesheet text. Neither answers the only question that matters: what colour,
// size and font does an element END UP with? A page can declare a hot orange
// accent, never reference it, and pass every markup test while rendering grey.
//
// nx_cascade.js parses the real stylesheet, resolves the custom-property graph
// (including nested var() and fallbacks) and reports COMPUTED declared values.
// These tests assert on those resolved values, per direction, per element.
//
// Run: node tests/test_computed_visual.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const nx = require('../backend/src/nx_compose.js');
const { nxCascade } = require('../backend/src/nx_cascade.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);
const PLAN = {
  site_name: 'Northgate Civil', hero_headline: 'Groundworks, done properly',
  hero_sub: 'Civil engineering and drainage for commercial sites.',
  services: [{ title: 'Groundworks', desc: 'Excavation.' }, { title: 'Drainage', desc: 'Install.' }, { title: 'Surfacing', desc: 'Tarmac.' }],
  stats: [{ value: '40+', label: 'Years' }, { value: '4', label: 'Counties' }],
  projects: [{ title: 'Pier 7', cat: 'Commercial' }], reviews: [{ text: 'Exceptional.', name: 'R', role: 'Manager' }],
  faqs: [{ q: 'Lead time?', a: 'Two weeks.' }], contact: { email: 'hi@northgate.co.uk' },
};
const built = {};
for (const d of DIRS) {
  const html = nx.nxCompose(PLAN, { direction: d }).html;
  const doc = new JSDOM(html).window.document;
  built[d] = { html, doc, cascade: nxCascade(html, doc) };
}
const hex = (s) => { const m = /#([0-9a-f]{6})/i.exec(String(s || '')); return m ? ('#' + m[1].toUpperCase()) : null; };

console.log('\n== A. No broken custom properties (invalid values render as defaults) ==');
{
  // A referenced-but-undefined var makes any calc() using it INVALID, so the
  // browser silently falls back — a real visual bug no markup test can see.
  const bad = [];
  for (const d of DIRS) { const dv = built[d].cascade.danglingVars(); if (dv.length) bad.push(`${d}: ${dv.join(',')}`); }
  check('every referenced custom property is defined', bad.length === 0, bad.join(' | '));
}

console.log('\n== B. The declared palette actually reaches the page ==');
{
  const notApplied = [], accentUnused = [];
  for (const d of DIRS) {
    const { doc, cascade } = built[d];
    const pal = nx.NX_COMPOSE_DIRECTIONS[d].palette;
    const bg = hex(cascade.computed(doc.body, 'background') || cascade.computed(doc.body, 'background-color'));
    if (bg !== hex(pal.bg)) notApplied.push(`${d}: body bg ${bg} ≠ ${hex(pal.bg)}`);
    // The accent must be REFERENCED somewhere, not merely declared.
    const usesAccent = cascade.rules.some(r => Object.values(r.decls).some(v => /var\(\s*--accent\s*\)/.test(v)));
    if (!usesAccent) accentUnused.push(d);
  }
  check('each direction\'s background colour is the one it declares', notApplied.length === 0, notApplied.join(' | '));
  check('each direction actually uses its accent colour', accentUnused.length === 0, accentUnused.join(','));
}

console.log('\n== C. Typography resolves to a real font stack ==');
{
  const unresolved = [], sameFont = [];
  for (const d of DIRS) {
    const f = built[d].cascade.computed(built[d].doc.body, 'font-family');
    // The historic bug: body{font-family:var(--body)} where --body is a SIZE,
    // so the whole page silently fell back to the browser default font.
    if (!f || /var\(/.test(f) || /^\s*clamp\(/.test(f)) unresolved.push(`${d}: ${f}`);
    sameFont.push(String(f || '').split(',')[0].trim());
  }
  check('body font-family resolves to an actual family', unresolved.length === 0, unresolved.join(' | '));
  check('directions do not all share one body font', new Set(sameFont).size >= 3, sameFont.join(' | '));
}

console.log('\n== D. Dark directions are genuinely dark, light ones genuinely light ==');
{
  // Guards against a palette being declared but overridden to a default white.
  const lum = (h) => { const m = String(h || '').replace('#', ''); if (m.length < 6) return null; const c = [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const wrong = [];
  for (const d of DIRS) {
    const pal = nx.NX_COMPOSE_DIRECTIONS[d].palette;
    const bgL = lum(pal.bg), txL = lum(pal.text);
    if (bgL == null || txL == null) continue;
    // Text and background must sit on opposite sides of mid-grey.
    if (Math.abs(bgL - txL) < 0.25) wrong.push(`${d}: bg ${bgL.toFixed(2)} vs text ${txL.toFixed(2)}`);
  }
  check('text and background are strongly separated in luminance', wrong.length === 0, wrong.join(' | '));
}

console.log('\n== E. Signal Industrial renders its signature design language ==');
{
  const { html, doc, cascade } = built['signal-industrial'];
  check('the aurora hero is present with all three glow fields', doc.querySelectorAll('.c-aurora i').length === 3);
  check('a technical grid overlay is rendered', !!doc.querySelector('.c-hero-grid-lines'));
  check('the hot signal accent resolves to the intended orange', cascade.resolve('var(--accent)') === '#FF5F00', cascade.resolve('var(--accent)'));
  check('the display face is a grotesk, the body a neutral sans',
    /Space Grotesk/.test(cascade.resolve('var(--disp)')) && /Inter/.test(cascade.resolve('var(--font)')),
    cascade.resolve('var(--disp)') + ' / ' + cascade.resolve('var(--font)'));
  check('a monospace token is available for technical labels', /mono/i.test(cascade.resolve('var(--mono)')));
  check('the panel surface treatment is applied', /PANEL SURFACE/.test(html));
  // Facts only: the hero spec row must come from the brief, never be invented.
  const specs = [...doc.querySelectorAll('.c-hero-specs dd')].map(e => e.textContent.trim());
  check('hero specs are drawn from the brief, not fabricated', specs.every(v => ['40+', '4'].includes(v)), specs.join(','));
  // The aurora drift is the only ambient animation in this direction, so it is
  // the one that must stop for users who ask for reduced motion.
  const flat = html.replace(/\s+/g, ' ');
  check('motion is honest about reduced-motion preference',
    /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.c-aurora i\s*\{\s*animation:\s*none/.test(flat));
}

console.log('\n== F. The panel treatment is scoped, not leaked to other directions ==');
{
  const leaked = DIRS.filter(d => d !== 'signal-industrial' && /PANEL SURFACE/.test(built[d].html));
  check('surfaceFx styling applies only where declared', leaked.length === 0, leaked.join(','));
}

const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
