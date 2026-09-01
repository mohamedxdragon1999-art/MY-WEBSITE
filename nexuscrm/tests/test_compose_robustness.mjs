// COMPOSITION ROBUSTNESS + RENDERED-PAGE QUALITY.
//
// A plan reaches the composition engine from AI output, imported sites and raw
// user input, so NO field can be assumed to have the expected type. These tests
// are adversarial: they feed hostile, degenerate and malformed content through
// every direction and assert the engine still emits a safe, valid, accessible
// document. They also assert landmark/heading semantics on the rendered DOM.
//
// Run: node tests/test_compose_robustness.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const nx = require('../backend/src/nx_compose.js');
const { JSDOM } = require('jsdom');

const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);
let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

// ── A. Hostile / malformed plans must never crash or leak junk ───────────────
const HOSTILE = {
  'empty': {},
  'nulls': { site_name: null, hero_headline: null, services: null, reviews: null, contact: null },
  'wrong-types': { site_name: 12345, hero_headline: { a: 1 }, services: 'not-an-array', stats: [{ value: NaN, label: undefined }], reviews: 7 },
  'nested-objects': { services: [{ title: { deep: { deeper: 'x' } }, desc: ['a', 'b'] }] },
  'huge': { site_name: 'X'.repeat(500), hero_headline: 'word '.repeat(400), services: Array.from({ length: 40 }, (_, i) => ({ title: 'Service '.repeat(20) + i, desc: 'd '.repeat(300) })) },
  'one-word': { site_name: 'A', hero_headline: 'Hi', hero_sub: '.', services: [{ title: 'A', desc: '' }] },
  'unicode-rtl': { site_name: 'أتيليه الشمال', hero_headline: 'تصميم داخلي فاخر يدوم طويلاً', services: [{ title: 'الأثاث', desc: 'قطع مصنوعة يدويًا' }] },
  'emoji': { site_name: '🏛️🔥', hero_headline: '👨‍👩‍👧‍👦 family 🇪🇬', services: [{ title: '🎨', desc: '🚀'.repeat(50) }] },
  'entities': { site_name: 'Smith & Sons <Ltd>', hero_headline: 'A "quoted" & \'apostrophe\' test' },
  'array-plan': [1, 2, 3],
  'string-plan': 'just a string',
};

console.log('\n== A. Hostile plans never crash and never leak internals ==');
{
  let crashes = [], junk = [], invalid = [];
  for (const [label, plan] of Object.entries(HOSTILE)) {
    for (const d of DIRS) {
      let html;
      try { html = nx.nxCompose(plan, { direction: d }).html; }
      catch (e) { crashes.push(label + '/' + d + ': ' + e.message); continue; }
      if (typeof html !== 'string' || !html.includes('</html>')) { invalid.push(label + '/' + d); continue; }
      if (/\[object Object\]/.test(html)) junk.push(label + '/' + d + ': [object Object]');
      if (/>\s*(NaN|undefined|null)\s*</.test(html)) junk.push(label + '/' + d + ': NaN/undefined/null');
      if ((html.match(/<style/gi) || []).length !== (html.match(/<\/style>/gi) || []).length) invalid.push(label + '/' + d + ': unbalanced <style>');
    }
  }
  check('no plan shape crashes the composition engine', crashes.length === 0, crashes.slice(0, 3).join(' | '));
  check('no plan leaks "[object Object]" / NaN / undefined into the page', junk.length === 0, junk.slice(0, 3).join(' | '));
  check('every hostile plan still yields a complete, balanced document', invalid.length === 0, invalid.slice(0, 3).join(' | '));
}

// ── B. Script injection stays inert ──────────────────────────────────────────
console.log('\n== B. Injected markup is escaped, not executed ==');
{
  const evil = {
    site_name: '<script>alert(1)</script>',
    hero_headline: '"><img src=x onerror=alert(1)>',
    hero_sub: '</style><script>bad()</script>',
    services: [{ title: '<iframe src="//evil"></iframe>', desc: '<svg onload=alert(1)>' }],
    reviews: [{ text: '<script>steal()</script>', name: '<b>x</b>' }],
  };
  let leaks = [];
  for (const d of DIRS) {
    const html = nx.nxCompose(evil, { direction: d }).html;
    const doc = new JSDOM(html).window.document;
    // Parse the DOM: an escaped payload becomes TEXT, a real injection becomes a NODE.
    if (doc.querySelector('iframe')) leaks.push(d + ': iframe node created');
    if (doc.querySelector('img[onerror], svg[onload], [onerror], [onload]')) leaks.push(d + ': event-handler attribute survived');
    const inline = [...doc.querySelectorAll('script')].map(s => s.textContent).join('\n');
    if (/alert\(1\)|bad\(\)|steal\(\)/.test(inline)) leaks.push(d + ': payload landed inside a <script>');
  }
  check('no direction executes injected markup (escaped as inert text)', leaks.length === 0, leaks.slice(0, 3).join(' | '));
}

// ── C. Rendered accessibility + document semantics ───────────────────────────
console.log('\n== C. Rendered pages are semantically valid and accessible ==');
{
  const plan = {
    site_name: 'Atelier North', hero_headline: 'Objects of permanence.', hero_sub: 'A studio for considered interiors.',
    cta_primary: 'Begin', cta_secondary: 'Work',
    services: [{ title: 'Furniture', desc: 'Built to last.' }, { title: 'Lighting', desc: 'Sculptural.' }, { title: 'Textiles', desc: 'Hand-woven.' }],
    why: ['Made to order', 'Natural materials'], stats: [{ value: 12, label: 'Years' }],
    projects: [{ title: 'Halcyon', cat: 'Residential' }], reviews: [{ text: 'Superb work.', name: 'E', role: 'Owner' }],
    faqs: [{ q: 'Lead time?', a: 'Six weeks.' }], contact: { email: 'h@x.co', phone: '+20 10 1234' },
  };
  const problems = { h1: [], main: [], lang: [], alt: [], jump: [], name: [], anchor: [], label: [], meta: [] };
  for (const d of DIRS) {
    const html = nx.nxCompose(plan, { direction: d }).html;
    const doc = new JSDOM(html).window.document;
    if (doc.querySelectorAll('h1').length !== 1) problems.h1.push(d + '=' + doc.querySelectorAll('h1').length);
    if (!doc.querySelector('main')) problems.main.push(d);
    if (!doc.documentElement.getAttribute('lang')) problems.lang.push(d);
    doc.querySelectorAll('img').forEach(i => { if (!i.hasAttribute('alt')) problems.alt.push(d); });
    const hs = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(e => +e.tagName[1]);
    for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) { problems.jump.push(`${d}: h${hs[i - 1]}→h${hs[i]}`); break; }
    doc.querySelectorAll('a,button').forEach(e => { if (!((e.textContent || '').trim() || e.getAttribute('aria-label'))) problems.name.push(d); });
    doc.querySelectorAll('a[href^="#"]').forEach(a => { const id = a.getAttribute('href').slice(1); if (id && !doc.getElementById(id)) problems.anchor.push(`${d}:#${id}`); });
    doc.querySelectorAll('input,textarea,select').forEach(i => {
      const id = i.getAttribute('id'); const lab = id && doc.querySelector(`label[for="${id}"]`);
      if (!lab && !i.getAttribute('aria-label') && !i.closest('label')) problems.label.push(d);
    });
    if (!doc.querySelector('meta[name="description"]') || !doc.querySelector('meta[name="viewport"]') || !doc.title.trim()) problems.meta.push(d);
  }
  check('exactly one <h1> per page', problems.h1.length === 0, problems.h1.join(','));
  check('every page has a <main> landmark', problems.main.length === 0, problems.main.join(','));
  check('every page declares a lang', problems.lang.length === 0, problems.lang.join(','));
  check('every image has alt text', problems.alt.length === 0, [...new Set(problems.alt)].join(','));
  check('no heading level is skipped', problems.jump.length === 0, problems.jump.join(' | '));
  check('every link/button has an accessible name', problems.name.length === 0, [...new Set(problems.name)].join(','));
  check('every in-page anchor resolves to a real target', problems.anchor.length === 0, [...new Set(problems.anchor)].join(','));
  check('every form field has a label', problems.label.length === 0, [...new Set(problems.label)].join(','));
  check('every page has title + description + viewport', problems.meta.length === 0, problems.meta.join(','));
}

const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
