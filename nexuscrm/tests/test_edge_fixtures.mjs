// EDGE-CASE FIXTURE SUITE (§1.4) + RTL/i18n CORRECTNESS.
//
// The regression discipline the roadmap asks for: three fixture classes kept
// permanently — known-bad inputs that MUST be caught, known-good inputs that
// must NOT be false-flagged, and edge cases (empty, enormous, RTL, CJK, missing
// images, hostile markup) that historically break generators.
//
// The RTL checks exist because this suite found a real defect: Arabic and
// Hebrew briefs rendered left-to-right, which makes the page unreadable rather
// than merely ugly. Detection is content-based, so an Arabic brief just works.
//
// Run: node tests/test_edge_fixtures.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const nx = require('../backend/src/nx_compose.js');
const V = require('../backend/src/nx_validate.js');
const H = require('../backend/src/nx_history.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);
const LONG = 'Groundworks and civil engineering delivered with precision '.repeat(12);

console.log('\n== A. Edge-case inputs never crash and never ship blockers ==');
{
  const EDGE = {
    'empty plan': {},
    'only a name': { site_name: 'X' },
    'whitespace-only fields': { site_name: '   ', hero_headline: '\t\n  ' },
    'single-character fields': { site_name: 'A', hero_headline: 'B', services: [{ title: 'D', desc: 'E' }] },
    'enormous headline': { site_name: 'A', hero_headline: LONG, hero_sub: LONG },
    'forty services': { site_name: 'A', hero_headline: 'H', services: Array.from({ length: 40 }, (_, i) => ({ title: 'Service ' + i, desc: LONG.slice(0, 200) })) },
    'missing images': { site_name: 'A', hero_headline: 'H', projects: [{ title: 'P', cat: 'C', image: null }], services: [{ title: 'S', desc: 'd', icon: undefined }] },
    'CJK content': { site_name: '北門土木', hero_headline: '確かな技術で、確かな仕事を', services: [{ title: '掘削工事', desc: '基礎工事' }] },
    'emoji and diacritics': { site_name: 'Café ☕ Nørd', hero_headline: 'Ünïcödé 🎉 tëst' },
    'markup in content': { site_name: '<b>Bold</b> Co', hero_headline: '<script>alert(1)</script>', services: [{ title: '<img src=x onerror=alert(1)>', desc: 'ok' }] },
  };
  const crashed = [], blocked = [], tiny = [];
  for (const [label, plan] of Object.entries(EDGE)) {
    for (const d of DIRS) {
      let html;
      try { html = nx.nxCompose(plan, { direction: d }).html; }
      catch (e) { crashed.push(`${label}/${d}: ${e.message.slice(0, 50)}`); continue; }
      if (!html || html.length < 2000) { tiny.push(`${label}/${d}: ${html ? html.length : 0}B`); continue; }
      const r = V.nxValidatePage(html);
      if (!r.pass) blocked.push(`${label}/${d}: ${r.blocking[0].rule}`);
    }
  }
  check('no edge case crashes the composer', crashed.length === 0, crashed.slice(0, 3).join(' | '));
  check('every edge case still yields a real page', tiny.length === 0, tiny.slice(0, 3).join(' | '));
  check('no edge case ships blocking violations', blocked.length === 0, blocked.slice(0, 3).join(' | '));
}

console.log('\n== B. Hostile markup in content stays inert ==');
{
  const html = nx.nxCompose({ site_name: '<b>X</b>', hero_headline: '<script>alert(1)</script>', services: [{ title: '<img src=x onerror=alert(1)>', desc: 'ok' }] }, { direction: 'luxury-art' }).html;
  const { JSDOM } = require('jsdom');
  const doc = new JSDOM(html).window.document;
  // Inspect the parsed DOM, not the string: escaped text is inert even though
  // a naive grep for "<script>" would match it.
  const injected = [...doc.querySelectorAll('main script, main img[onerror], main b')];
  check('injected markup does not become live DOM nodes', injected.length === 0, String(injected.length));
}

console.log('\n== C. RTL scripts render right-to-left ==');
{
  const cases = [
    ['Arabic', { site_name: 'استوديو الشمال', hero_headline: 'نحن نبني مواقع رائعة' }, 'rtl', 'ar'],
    ['Hebrew', { site_name: 'סטודיו', hero_headline: 'אנחנו בונים אתרים' }, 'rtl', 'he'],
    ['Arabic + services', { site_name: 'استوديو', hero_headline: 'نحن نبني', services: [{ title: 'الحفر', desc: 'x' }] }, 'rtl', 'ar'],
    ['English', { site_name: 'Northgate', hero_headline: 'Groundworks done properly' }, 'ltr', 'en'],
    ['Japanese', { site_name: '北門土木', hero_headline: '確かな技術で' }, 'ltr', 'ja'],
  ];
  const wrongDir = [], wrongLang = [];
  for (const [label, plan, expDir, expLang] of cases) {
    const tag = nx.nxCompose(plan, { direction: 'luxury-art' }).html.match(/<html[^>]*>/)[0];
    const dir = (tag.match(/\sdir="(\w+)"/) || [])[1];
    const lang = (tag.match(/\slang="([\w-]+)"/) || [])[1];
    if (dir !== expDir) wrongDir.push(`${label}: ${dir}≠${expDir}`);
    if (lang !== expLang) wrongLang.push(`${label}: ${lang}≠${expLang}`);
  }
  check('script direction is detected from the content', wrongDir.length === 0, wrongDir.join(' | '));
  check('the lang attribute names the actual script', wrongLang.length === 0, wrongLang.join(' | '));

  // One foreign word must not flip an otherwise-English page.
  const mixed = nx.nxCompose({ site_name: 'Northgate Civil', hero_headline: 'Groundworks مثال done properly' }, { direction: 'luxury-art' }).html;
  check('a single foreign word does not flip direction', /\sdir="ltr"/.test(mixed.match(/<html[^>]*>/)[0]));

  const rtlPage = nx.nxCompose({ site_name: 'استوديو', hero_headline: 'نحن نبني' }, { direction: 'signal-industrial' }).html;
  check('RTL pages carry mirrored layout rules', /\[dir="rtl"\]/.test(rtlPage));
  check('RTL pages still pass full validation', V.nxValidatePage(rtlPage).pass);
}

console.log('\n== D. Known-bad fixtures are still caught (no silent softening) ==');
{
  const KNOWN_BAD = {
    'unclosed container': '<!DOCTYPE html><html lang="en"><head><title>t</title><meta name="description" content="d"></head><body><main><div><p>x</p></main></body></html>',
    'flow inside a paragraph': '<!DOCTYPE html><html lang="en"><head><title>t</title><meta name="description" content="d"></head><body><main><p><div>x</div></p></main></body></html>',
    'oversized fixed width': '<!DOCTYPE html><html lang="en"><head><title>t</title><meta name="description" content="d"></head><body><main><h1>H</h1><div style="width:3000px">x</div></main></body></html>',
    'placeholder copy': '<!DOCTYPE html><html lang="en"><head><title>t</title><meta name="description" content="d"></head><body><main><h1>H</h1><p>Lorem ipsum dolor sit amet.</p></main></body></html>',
  };
  const missed = [];
  for (const [label, html] of Object.entries(KNOWN_BAD)) {
    if (V.nxValidatePage(html).pass) missed.push(label);
  }
  check('every known-bad fixture is still rejected', missed.length === 0, missed.join(' | '));
}

console.log('\n== E. Known-good fixtures are not false-flagged ==');
{
  const good = '<!DOCTYPE html><html lang="en"><head><title>Studio</title><meta name="description" content="A studio for considered interiors.">'
    + '</head><body><main><h1>Objects of permanence</h1><p>A studio for considered interiors that age gracefully.</p></main></body></html>';
  const r = V.nxValidatePage(good);
  check('a clean minimal page passes', r.pass, r.blocking.map(b => b.rule).join(','));
  const realPages = DIRS.map(d => nx.nxCompose({ site_name: 'Northgate Civil', hero_headline: 'Groundworks, done properly', hero_sub: 'Civil engineering for commercial sites.', services: [{ title: 'Groundworks', desc: 'Excavation.' }], contact: { email: 'h@n.co' } }, { direction: d }).html);
  const flagged = realPages.map((h, i) => [DIRS[i], V.nxValidatePage(h)]).filter(([, r2]) => !r2.pass);
  check('no real generated page is false-flagged', flagged.length === 0, flagged.map(([d, r2]) => `${d}:${r2.blocking[0].rule}`).join(' | '));
}

console.log('\n== F. Observability records cost, not only quality (§1.5) ==');
{
  H.nxHistoryReset();
  H.nxRecordGeneration({ pass: true, iterations: 1, ms: 120, renderer: 'approximate', browserValidated: false, blockingRules: [], repairs: [] });
  H.nxRecordGeneration({ pass: true, iterations: 2, repaired: true, ms: 340, renderer: 'approximate', browserValidated: false, blockingRules: ['touch-target'], repairs: ['touch-target: fixed'] });
  const s = H.nxHistoryStats();
  check('timing percentiles are tracked', typeof s.medianMs === 'number' && typeof s.p95Ms === 'number', JSON.stringify([s.medianMs, s.p95Ms]));
  check('a repair rate is tracked for drift detection', s.repairRate === 50, String(s.repairRate));
  check('unverified (non-browser) renders are counted', s.unverifiedRenders === 2, String(s.unverifiedRenders));
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
