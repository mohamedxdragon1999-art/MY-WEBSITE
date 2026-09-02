// IMAGE PIPELINE INTEGRITY (§2.3 image-aware layout, §6.1 CLS/perf, a11y).
//
// This suite exists because the generator had a defect no markup-presence check
// could see: __art() returns a bare `data:` URI, and every call site
// interpolated that STRING directly into the page — so the URI rendered as
// visible text instead of an image, on every generated page. Separately, any
// image URL supplied in the brief was silently discarded by the content
// normaliser, so user photography could never appear.
//
// Invariants now enforced:
//   * art renders as a real <img>, never as raw text
//   * caller-supplied URLs are honoured, and only safe schemes are allowed
//   * every image carries width/height (prevents layout shift)
//   * every image declares loading/decoding (above-the-fold art is eager)
//   * content images carry meaningful alt; decorative art is hidden from AT
//
// Run: node tests/test_image_pipeline.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const nx = require('../backend/src/nx_compose.js');
const V = require('../backend/src/nx_validate.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);
const PLAN = {
  site_name: 'Northgate Civil', hero_headline: 'Groundworks, done properly',
  hero_sub: 'Civil engineering for commercial sites.',
  services: [{ title: 'Groundworks', desc: 'Excavation.' }, { title: 'Drainage', desc: 'Install.' }, { title: 'Surfacing', desc: 'Tarmac.' }],
  projects: [{ title: 'Pier 7', cat: 'Commercial' }, { title: 'Mill Yard', cat: 'Civil' }],
  contact: { email: 'h@n.co' },
};
const pages = {};
for (const d of DIRS) { const html = nx.nxCompose(PLAN, { direction: d }).html; pages[d] = { html, doc: new JSDOM(html).window.document }; }

console.log('\n== A. Art renders as an image, never as raw text ==');
{
  const leaked = DIRS.filter(d => />data:image/.test(pages[d].html) || /<\/div>data:/.test(pages[d].html));
  check('no data: URI is emitted as visible text', leaked.length === 0, leaked.join(','));
  const none = DIRS.filter(d => pages[d].doc.querySelectorAll('img').length === 0);
  check('every direction renders real <img> elements', none.length === 0, none.join(','));
}

console.log('\n== B. Layout stability: dimensions are always declared (§6.1 CLS) ==');
{
  const bad = [];
  for (const d of DIRS) for (const img of pages[d].doc.querySelectorAll('img')) {
    const w = img.getAttribute('width'), h = img.getAttribute('height');
    if (!w || !h || !/^\d+$/.test(w) || !/^\d+$/.test(h)) bad.push(`${d}: ${w}x${h}`);
  }
  check('every image declares intrinsic width and height', bad.length === 0, bad.slice(0, 4).join(' | '));
  const noFluid = [];
  for (const d of DIRS) for (const img of pages[d].doc.querySelectorAll('img')) {
    if (!/max-width\s*:\s*100%/.test(img.getAttribute('style') || '')) noFluid.push(d);
  }
  check('images are fluid so they cannot overflow a narrow viewport', noFluid.length === 0, [...new Set(noFluid)].join(','));
}

console.log('\n== C. Loading strategy is explicit (§6.1) ==');
{
  const bad = [];
  for (const d of DIRS) for (const img of pages[d].doc.querySelectorAll('img')) {
    const l = img.getAttribute('loading'), dec = img.getAttribute('decoding');
    if (!['lazy', 'eager'].includes(l)) bad.push(`${d}: loading=${l}`);
    if (!['async', 'sync', 'auto'].includes(dec)) bad.push(`${d}: decoding=${dec}`);
  }
  check('every image declares loading and decoding', bad.length === 0, bad.slice(0, 4).join(' | '));
  // A lazily-loaded hero image delays the largest contentful paint.
  const heroLazy = DIRS.filter(d => {
    const hero = pages[d].doc.querySelector('.c-hero img');
    return hero && hero.getAttribute('loading') === 'lazy' && +hero.getAttribute('width') >= 1200;
  });
  check('above-the-fold hero art is not lazy-loaded', heroLazy.length === 0, heroLazy.join(','));
}

console.log('\n== D. Accessibility: content images described, decorative ones hidden ==');
{
  const bad = [];
  for (const d of DIRS) for (const img of pages[d].doc.querySelectorAll('img')) {
    const alt = img.getAttribute('alt');
    if (alt === null) { bad.push(`${d}: missing alt attribute`); continue; }
    // Decorative art must be BOTH alt="" and aria-hidden, or AT announces noise.
    if (alt === '' && img.getAttribute('aria-hidden') !== 'true') bad.push(`${d}: empty alt without aria-hidden`);
    if (alt && /^(image|photo|picture|img|graphic)$/i.test(alt.trim())) bad.push(`${d}: generic alt "${alt}"`);
  }
  check('alt text is present and never generic', bad.length === 0, bad.slice(0, 4).join(' | '));
  // Portfolio images are CONTENT — they must be described, not hidden.
  const work = pages['cinematic-immersive'].doc.querySelectorAll('.c-work img, .c-work-item img');
  const described = [...work].filter(i => (i.getAttribute('alt') || '').trim().length > 0);
  check('portfolio images carry descriptive alt text', work.length === 0 || described.length > 0,
    [...work].map(i => JSON.stringify(i.getAttribute('alt'))).join(','));
}

console.log('\n== E. Caller-supplied images are used, not discarded ==');
{
  // The normaliser dropped `image` entirely, so a brief with real photography
  // silently rendered generated placeholder art instead.
  const withImgs = nx.nxCompose({ ...PLAN, projects: [{ title: 'Pier 7', cat: 'Commercial', image: 'https://cdn.example.com/pier7.jpg' }] }, { direction: 'cinematic-immersive' }).html;
  check('an absolute image URL from the brief is rendered', withImgs.includes('https://cdn.example.com/pier7.jpg'));
  const rel = nx.nxCompose({ ...PLAN, projects: [{ title: 'P', cat: 'C', image: '/img/local.jpg' }] }, { direction: 'luxury-art' }).html;
  check('a site-relative image path is rendered', rel.includes('/img/local.jpg'));
  const proto = nx.nxCompose({ ...PLAN, projects: [{ title: 'P', cat: 'C', image: '//cdn.example.com/x.jpg' }] }, { direction: 'luxury-art' }).html;
  check('a protocol-relative URL is accepted', proto.includes('//cdn.example.com/x.jpg'));
}

console.log('\n== F. Unsafe image sources are rejected ==');
{
  const vectors = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)'];
  const leaked = [];
  for (const v of vectors) {
    const html = nx.nxCompose({ ...PLAN, projects: [{ title: 'P', cat: 'C', image: v }] }, { direction: 'luxury-art' }).html;
    if (html.includes(v.trim())) leaked.push(v.slice(0, 24));
    // And it must never become a live handler. Scope this to INJECTED nodes:
    // every page legitimately ships one inline runtime script, so a bare
    // 'script' selector here would flag the generator's own code.
    const doc = new JSDOM(html).window.document;
    if (doc.querySelector('img[onerror], img[onload], [src^="javascript:"], [href^="javascript:"], main script')) {
      leaked.push('live node from ' + v.slice(0, 18));
    }
  }
  check('unsafe URL schemes never reach the page', leaked.length === 0, leaked.join(' | '));
  const quoted = nx.nxCompose({ ...PLAN, projects: [{ title: 'P', cat: 'C', image: '" onerror="alert(1)' }] }, { direction: 'luxury-art' }).html;
  check('quote-breaking payloads cannot escape the attribute', !/onerror\s*=\s*"?alert/.test(quoted));
}

console.log('\n== G. Pages still pass full validation with images present ==');
{
  const bad = DIRS.filter(d => !V.nxValidatePage(pages[d].html).pass);
  check('every direction passes the blocking gate', bad.length === 0,
    bad.map(d => `${d}: ${V.nxValidatePage(pages[d].html).blocking[0].rule}`).join(' | '));
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
