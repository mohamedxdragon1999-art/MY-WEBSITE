// SECTION SHELL CONTRACT (Phase 2.2 — component library).
//
// Every section used to hand-author its own outer shell: 22 section tags across
// 23 render helpers. They DRIFTED. The `grid` review variant emitted a section
// heading while `single` and `quote` did not, and `metrics` omitted one
// entirely — so those sections were absent from the document outline that
// screen readers and search engines navigate by.
//
// nx_components.js makes the shell a single primitive, so a section cannot be
// constructed wrong. This suite enforces the contract on the RENDERED page:
// construction-time guarantees are worthless if a legacy path bypasses them.
//
// Run: node tests/test_component_contract.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const nx = require('../backend/src/nx_compose.js');
const { nxSection, nxAuditSections } = require('../backend/src/nx_components.js');
const { nxCascade } = require('../backend/src/nx_cascade.js');
const V = require('../backend/src/nx_validate.js');

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
const pages = {};
for (const d of DIRS) { const html = nx.nxCompose(PLAN, { direction: d }).html; pages[d] = { html, doc: new JSDOM(html).window.document }; }

console.log('\n== A. Every rendered section satisfies the shell contract ==');
{
  const bad = [];
  for (const d of DIRS) for (const i of nxAuditSections(pages[d].doc)) bad.push(`${d}/${i.id}: ${i.rule}`);
  check('no section violates id/reveal/rhythm/emphasis/heading', bad.length === 0, bad.slice(0, 5).join(' | '));
}

console.log('\n== B. Every section appears in the document outline ==');
{
  // This is the exact defect that shipped: metrics and two review variants had
  // no heading at all, so assistive tech could not navigate to them.
  const headless = [];
  for (const d of DIRS) {
    for (const s of pages[d].doc.querySelectorAll('main > *')) {
      const cls = s.className || '';
      if (/c-nav|c-footer|c-marquee|c-strip/.test(cls)) continue;
      if (!s.querySelector('h1,h2,h3,h4,h5,h6')) headless.push(`${d}/${s.getAttribute('id') || cls.split(/\s+/)[0]}`);
    }
  }
  check('no content section is missing a heading', headless.length === 0, headless.join(', '));

  // Specifically pin the sections that regressed.
  for (const key of ['metrics', 'reviews']) {
    const missing = DIRS.filter(d => {
      const s = pages[d].doc.querySelector(`#${key}`);
      return s && !s.querySelector('h1,h2,h3,h4,h5,h6');
    });
    check(`the ${key} section always carries a heading`, missing.length === 0, missing.join(','));
  }
}

console.log('\n== C. Hidden headings are truly invisible, not just off-screen text ==');
{
  // A heading added for the outline must not alter the visual design.
  const visible = [];
  for (const d of DIRS) {
    const c = nxCascade(pages[d].html, pages[d].doc);
    for (const el of pages[d].doc.querySelectorAll('.c-sr-only')) {
      if (c.computed(el, 'position') !== 'absolute') visible.push(`${d}: position=${c.computed(el, 'position')}`);
    }
  }
  check('sr-only headings are visually removed', visible.length === 0, visible.join(' | '));
  const noRule = DIRS.filter(d => !/\.c-sr-only\{/.test(pages[d].html));
  check('the sr-only utility ships with every page', noRule.length === 0, noRule.join(','));
}

console.log('\n== D. Heading hierarchy stays valid after the additions ==');
{
  const bad = [], multiH1 = [];
  for (const d of DIRS) {
    const hs = [...pages[d].doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => +h.tagName[1]);
    for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) { bad.push(`${d}: h${hs[i - 1]}→h${hs[i]}`); break; }
    const n = hs.filter(x => x === 1).length;
    if (n !== 1) multiH1.push(`${d}: ${n}`);
  }
  check('no heading level is skipped', bad.length === 0, bad.join(' | '));
  check('exactly one h1 per page', multiH1.length === 0, multiH1.join(', '));
}

console.log('\n== E. The primitive cannot build an invalid shell ==');
{
  // Omitting a heading must still produce one, not a headless section.
  const s = nxSection({ family: 'metrics', id: 'metrics', body: '<p>x</p>' });
  const doc = new JSDOM(`<main>${s}</main>`).window.document;
  check('a section built with no heading still gets one', !!doc.querySelector('h2'), s.slice(0, 90));
  check('the shell always emits data-r', / data-r[ >]/.test(s));
  check('the shell always emits an id', /id="metrics"/.test(s));
  const withRhythm = nxSection({ family: 'work', id: 'work', heading: 'Selected work', rhythm: 'spacious', emphasis: 'high', body: '' });
  check('rhythm and emphasis are carried through', /data-rhythm="spacious"/.test(withRhythm) && /data-emphasis="high"/.test(withRhythm));
  const bleed = nxSection({ family: 'hero', id: 'home', heading: 'H', bleed: true, body: '<i></i>' });
  check('full-bleed sections omit the measure container', !/c-wrap/.test(bleed));
  check('contained sections include the measure container', /c-wrap/.test(withRhythm));
  // Ids must be safe to use as anchor targets.
  const dirty = nxSection({ family: 'x', id: 'a b"><script>', heading: 'H', body: '' });
  check('ids are sanitised to a valid anchor target', /id="ab(script)?"/.test(dirty), dirty.slice(0, 70));
}

console.log('\n== F. The contract is enforced by the blocking gate ==');
{
  const headless = '<!DOCTYPE html><html lang="en"><head><title>t</title><meta name="description" content="d"></head>'
    + '<body><main><h1>H</h1><section id="x" data-r data-rhythm="normal" data-emphasis="low"><p>no heading</p></section></main></body></html>';
  const r = V.nxValidatePage(headless);
  check('a headless section is a blocking violation', r.blocking.some(b => b.rule === 'section-contract'),
    r.blocking.map(b => b.rule).join(','));
  const clean = DIRS.filter(d => !V.nxValidatePage(pages[d].html).pass);
  check('no real generated page is false-flagged', clean.length === 0,
    clean.map(d => V.nxValidatePage(pages[d].html).blocking[0].message).join(' | '));
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
