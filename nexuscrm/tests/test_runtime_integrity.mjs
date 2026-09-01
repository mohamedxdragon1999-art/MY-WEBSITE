// RUNTIME, ACCESSIBILITY, SEO AND CONTENT-QUALITY INTEGRITY.
//
// Earlier suites checked markup presence and computed CSS. Neither EXECUTES the
// page. That blind spot hid the worst defect found so far: the reveal script
// called `new IntersectionObserver(...)` unguarded, and because every [data-r]
// section starts at opacity:0, a single ReferenceError left the ENTIRE PAGE
// PERMANENTLY BLANK on any browser lacking that API.
//
// This suite runs the generated page's own JavaScript, then audits the things a
// real visitor experiences: can a keyboard user see focus, does a shared link
// render a preview card, is the copy free of duplication and placeholder leaks.
//
// Run: node tests/test_runtime_integrity.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const nx = require('../backend/src/nx_compose.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);
const PLAN = {
  site_name: 'Northgate Civil', hero_headline: 'Groundworks, done properly',
  hero_sub: 'Civil engineering and drainage for commercial sites.',
  services: [{ title: 'Groundworks', desc: 'Excavation and foundations.' }, { title: 'Drainage', desc: 'Design and install.' }, { title: 'Surfacing', desc: 'Concrete and tarmac.' }],
  stats: [{ value: '40+', label: 'Years' }], projects: [{ title: 'Pier 7', cat: 'Commercial' }],
  reviews: [{ text: 'Exceptional.', name: 'R', role: 'Manager' }], faqs: [{ q: 'Lead time?', a: 'Two weeks.' }],
  contact: { email: 'hi@northgate.co.uk' },
};
// Render once, and also execute each page in a DOM with scripts enabled.
const built = {};
for (const d of DIRS) {
  const html = nx.nxCompose(PLAN, { direction: d }).html;
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e.message).slice(0, 100)));
  let dom = null;
  try {
    dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  } catch (e) { errors.push('threw on load: ' + e.message.slice(0, 90)); }
  built[d] = { html, dom, errors, doc: dom ? dom.window.document : null, css: (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '' };
}

console.log('\n== A. The page\'s own JavaScript executes without throwing ==');
{
  // jsdom deliberately omits IntersectionObserver, which is exactly the
  // environment an old browser or embedded webview presents.
  const broken = DIRS.filter(d => built[d].errors.length);
  check('no direction throws a runtime error on load', broken.length === 0,
    broken.map(d => `${d}: ${built[d].errors[0]}`).join(' | '));
}

console.log('\n== B. Content is visible even when the reveal API is missing ==');
{
  // Sections start hidden (opacity:0) and are revealed by adding .on. If the
  // observer is unavailable the page MUST fail open, or the visitor sees nothing.
  const blank = [];
  for (const d of DIRS) {
    const doc = built[d].doc; if (!doc) { blank.push(d + ': no document'); continue; }
    const total = doc.querySelectorAll('[data-r]').length;
    const shown = doc.querySelectorAll('[data-r].on').length;
    if (total > 0 && shown === 0) blank.push(`${d}: 0/${total} sections revealed`);
  }
  check('every direction reveals its content without IntersectionObserver', blank.length === 0, blank.join(' | '));
  // The CSS must actually define the hidden->shown transition it relies on.
  const noReveal = DIRS.filter(d => /\[data-r\]\{[^}]*opacity:0/.test(built[d].css) && !/\[data-r\]\.on\{[^}]*opacity:1/.test(built[d].css));
  check('a reveal-out state exists wherever content starts hidden', noReveal.length === 0, noReveal.join(','));
}

console.log('\n== C. Keyboard users can see and reach things ==');
{
  const noFocus = DIRS.filter(d => !/:focus-visible|:focus\b/.test(built[d].css));
  check('every direction defines a visible focus style', noFocus.length === 0, noFocus.join(','));
  const stripped = DIRS.filter(d => /outline\s*:\s*(none|0)\b/.test(built[d].css) && !/:focus-visible/.test(built[d].css));
  check('no direction removes outlines without a replacement', stripped.length === 0, stripped.join(','));
  // A <main> landmark is useless if nothing can jump to it.
  const noSkip = DIRS.filter(d => { const doc = built[d].doc; return !doc || !doc.querySelector('a[href="#main"], a.c-skip'); });
  check('a skip-to-content link targets the main landmark', noSkip.length === 0, noSkip.join(','));
  const badTarget = DIRS.filter(d => { const doc = built[d].doc; if (!doc) return true; const a = doc.querySelector('a.c-skip'); return a && !doc.querySelector(a.getAttribute('href')); });
  check('the skip link points at an element that exists', badTarget.length === 0, badTarget.join(','));
}

console.log('\n== D. Shared links render a preview, not a blank card ==');
{
  const need = ['og:title', 'og:description', 'og:type'];
  const missing = [];
  for (const d of DIRS) {
    const doc = built[d].doc; if (!doc) { missing.push(d); continue; }
    for (const p of need) if (!doc.querySelector(`meta[property="${p}"]`)) missing.push(`${d}:${p}`);
    if (!doc.querySelector('meta[name^="twitter:"]')) missing.push(`${d}:twitter`);
    const desc = doc.querySelector('meta[name="description"]');
    if (!desc || !String(desc.getAttribute('content') || '').trim()) missing.push(`${d}:description`);
    if (!doc.documentElement.getAttribute('lang')) missing.push(`${d}:lang`);
    if (!doc.title || !doc.title.trim()) missing.push(`${d}:title`);
  }
  check('every page carries complete sharing + document metadata', missing.length === 0, missing.slice(0, 6).join(', '));
}

console.log('\n== E. Copy is not duplicated or padded ==');
{
  // The story section printed the hero subtitle again as its lead AND its body,
  // so one sentence appeared three times. Repetition reads as a broken generator.
  const dupes = [], leaks = [];
  for (const d of DIRS) {
    const doc = built[d].doc; if (!doc) continue;
    const paras = [...doc.querySelectorAll('p')].map(p => p.textContent.trim()).filter(t => t.length > 25);
    const seen = new Set(), dup = new Set();
    for (const t of paras) { if (seen.has(t)) dup.add(t); seen.add(t); }
    if (dup.size) dupes.push(`${d}: "${[...dup][0].slice(0, 45)}"`);
    const clone = doc.body.cloneNode(true);
    clone.querySelectorAll('script,style').forEach(n => n.remove());
    const text = clone.textContent;
    for (const ph of ['Lorem ipsum', 'TODO', 'FIXME', '[object Object]', 'NaN']) {
      if (text.includes(ph)) leaks.push(`${d}: ${ph}`);
    }
    if (/\bundefined\b/.test(text)) leaks.push(`${d}: undefined`);
  }
  check('no paragraph is repeated on a page', dupes.length === 0, dupes.join(' | '));
  check('no placeholder or object leaks into visible copy', leaks.length === 0, leaks.join(' | '));
}

console.log('\n== F. Form controls are labelled ==');
{
  const unlabelled = [];
  for (const d of DIRS) {
    const doc = built[d].doc; if (!doc) continue;
    for (const el of doc.querySelectorAll('input,textarea,select')) {
      const id = el.getAttribute('id');
      const hasLabel = (id && doc.querySelector(`label[for="${id}"]`)) || el.getAttribute('aria-label') || el.closest('label');
      if (!hasLabel) unlabelled.push(`${d}:<${el.tagName.toLowerCase()}>`);
    }
  }
  check('every form control has an accessible label', unlabelled.length === 0, unlabelled.slice(0, 5).join(', '));
}

for (const d of DIRS) { try { built[d].dom && built[d].dom.window.close(); } catch (e) {} }
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
