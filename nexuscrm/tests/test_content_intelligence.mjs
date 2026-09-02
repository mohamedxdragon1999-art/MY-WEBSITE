// PHASE 3 — CONTENT INTELLIGENCE.
//
// Six visually distinct directions all shipped the SAME WORDS: every fallback
// slot was one hardcoded string, so "Made to be remembered." / "Start a
// project" appeared on a groundworks contractor, a yoga studio and an
// accounting product alike. The design varied; the copy never did. That was the
// single largest remaining gap between this output and a site someone ships.
//
// Copy is now derived from three real inputs — the brief's own words, an
// industry inferred from its vocabulary, and the direction's voice — and is
// GENERATED TO FIT its slot rather than truncated afterwards.
//
// Two rules the tests enforce hard:
//   * no invented facts (no fabricated stats, awards, years, client counts)
//   * every slot respects its length budget, and never cuts mid-word
//
// Run: node tests/test_content_intelligence.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseHTML } = require('linkedom');
const C = require('../backend/src/nx_content.js');
const nx = require('../backend/src/nx_compose.js');
const V = require('../backend/src/nx_validate.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);
const BRIEFS = {
  civil: { site_name: 'Northgate Civil', description: 'A civil engineering and groundworks contractor handling drainage, excavation and surfacing for commercial sites.', services: [{ title: 'Groundworks' }, { title: 'Drainage' }], contact: { email: 'h@n.co' } },
  yoga: { site_name: 'Aurora Yoga', description: 'A calm yoga studio in Lisbon offering vinyasa and restorative classes.', services: [{ title: 'Vinyasa' }], contact: { email: 'h@a.pt' } },
  saas: { site_name: 'Ledgerly', description: 'Accounting software that helps finance teams close their books faster.', services: [{ title: 'Sync' }], contact: { email: 'h@l.co' } },
  diner: { site_name: 'Osteria Pino', description: 'A wood-fired restaurant serving a short seasonal menu.', services: [{ title: 'Dinner' }], contact: { email: 'h@o.it' } },
};

console.log('\n== A. Industry is inferred from the brief, never asked for ==');
{
  const want = { civil: 'construction', yoga: 'wellness', saas: 'professional', diner: 'hospitality' };
  const wrong = [];
  for (const [k, b] of Object.entries(BRIEFS)) {
    const got = C.nxGenerateCopy(b, 'editorial-minimal').industry;
    if (got !== want[k]) wrong.push(`${k}: ${got} (expected ${want[k]})`);
  }
  check('each brief resolves to a sensible industry', wrong.length === 0, wrong.join(' | '));
  // An unrecognised brief must fall back to neutral, not to a wrong guess.
  check('an unknown domain falls back to general, not a wrong guess',
    C.nxInferIndustry('something entirely unclassifiable zzz').id === 'general');
}

console.log('\n== B. Copy differs across BRIEFS (the original defect) ==');
{
  const heads = Object.values(BRIEFS).map((b) => C.nxGenerateCopy(b, 'editorial-minimal').headline);
  check('four different businesses get four different headlines', new Set(heads).size === 4, heads.join(' | '));
  const subs = Object.values(BRIEFS).map((b) => C.nxGenerateCopy(b, 'editorial-minimal').sub);
  check('four different businesses get four different sub-headlines', new Set(subs).size === 4);
  // The exact strings that used to appear on every site.
  const stale = heads.filter((h) => /Made to be remembered|considered, high-craft/.test(h));
  check('the old universal filler is gone', stale.length === 0, stale.join(' | '));
}

console.log('\n== C. Voice differs across DIRECTIONS for the same brief ==');
{
  const ctas = DIRS.map((d) => C.nxGenerateCopy(BRIEFS.civil, d).ctaPrimary);
  check('the call to action is phrased per direction', new Set(ctas).size >= 4, ctas.join(' | '));
  const kickers = DIRS.map((d) => C.nxGenerateCopy(BRIEFS.civil, d).sections.feature.kicker);
  check('section kickers are phrased per direction', new Set(kickers).size >= 4, kickers.join(' | '));
  // Voice must not override facts: the industry noun stays correct regardless.
  const inds = DIRS.map((d) => C.nxGenerateCopy(BRIEFS.civil, d).industry);
  check('voice never changes the inferred industry', new Set(inds).size === 1, inds.join(','));
}

console.log('\n== D. Every slot respects its budget, and never cuts mid-word ==');
{
  const over = [], midWord = [];
  for (const [k, b] of Object.entries(BRIEFS)) for (const d of DIRS) {
    const c = C.nxGenerateCopy(b, d);
    const slots = [['headline', c.headline], ['sub', c.sub], ['ctaPrimary', c.ctaPrimary],
      ['ctaSecondary', c.ctaSecondary], ['sectionTitle', c.sections.feature.title], ['kicker', c.sections.feature.kicker]];
    for (const [slot, text] of slots) {
      if (text.length > C.NX_SLOT_BUDGET[slot]) over.push(`${k}/${d}/${slot}: ${text.length}>${C.NX_SLOT_BUDGET[slot]}`);
    }
    for (const cd of c.cards) {
      if (cd.title.length > C.NX_SLOT_BUDGET.cardTitle) over.push(`${k}/${d}/cardTitle`);
      if (cd.text.length > C.NX_SLOT_BUDGET.cardBody) over.push(`${k}/${d}/cardBody`);
    }
  }
  check('no slot exceeds its character budget', over.length === 0, over.slice(0, 4).join(' | '));

  // Truncation must land on a word boundary — a mid-word cut is a visible bug.
  const long = 'Comprehensive civil engineering groundworks drainage excavation surfacing programme delivery';
  for (const budget of [20, 34, 48, 62]) {
    const out = C.nxFit(long, budget);
    if (out.length > budget) midWord.push(`budget ${budget} overflowed`);
    // The result must be a prefix ending at a space in the original.
    if (out && long.startsWith(out) && long.length > out.length && long[out.length] !== ' ') midWord.push(`budget ${budget} cut mid-word: "${out.slice(-12)}"`);
  }
  check('trimming lands on word boundaries', midWord.length === 0, midWord.join(' | '));
  check('short text is returned untouched', C.nxFit('Short line', 60) === 'Short line');
  check('empty input yields empty output, not a crash', C.nxFit(null, 20) === '' && C.nxFit(undefined, 20) === '');
}

console.log('\n== E. No invented facts ==');
{
  // The one thing worse than bland copy is confident fiction. Nothing generated
  // may assert a number, award, or client count the user did not supply.
  const FABRICATION = /\b(\d{2,}\+?\s*(years|clients|projects|customers))\b|\baward[- ]winning\b|\b#1\b|\bindustry[- ]leading\b|\btrusted by \d+/i;
  const bad = [];
  for (const [k, b] of Object.entries(BRIEFS)) for (const d of DIRS) {
    const c = C.nxGenerateCopy(b, d);
    const all = [c.headline, c.sub, c.ctaPrimary, c.ctaSecondary,
      ...Object.values(c.sections).flatMap((s) => [s.kicker, s.title]),
      ...c.cards.flatMap((x) => [x.title, x.text])].join(' ');
    const m = FABRICATION.exec(all);
    if (m) bad.push(`${k}/${d}: "${m[0]}"`);
  }
  check('no fabricated stats, awards or client counts', bad.length === 0, bad.slice(0, 3).join(' | '));
  // A service with no description gets a line derived from its OWN title.
  const c = C.nxGenerateCopy({ site_name: 'X', description: 'A drainage contractor.', services: [{ title: 'CCTV surveys' }, { title: 'Jetting' }] }, 'editorial-minimal');
  check('a description-less service is described from its own title',
    c.cards[0].text.includes('CCTV surveys') && c.cards[1].text.includes('Jetting'),
    c.cards.map((x) => x.text).join(' | '));
  check('card bodies are not all identical', new Set(c.cards.map((x) => x.text)).size === c.cards.length);
}

console.log('\n== F. User-supplied copy always wins ==');
{
  const b = { ...BRIEFS.civil, hero_headline: 'My own headline', hero_sub: 'My own sub.', cta_primary: 'Call now' };
  const c = C.nxGenerateCopy(b, 'luxury-art');
  check('an authored headline is never overwritten', c.headline === 'My own headline');
  check('an authored sub is never overwritten', c.sub === 'My own sub.');
  check('an authored CTA is never overwritten', c.ctaPrimary === 'Call now');
}

console.log('\n== G. The generated copy reaches the page and clears the gate ==');
{
  const rendered = {};
  for (const d of DIRS) rendered[d] = nx.nxCompose(BRIEFS.civil, { direction: d }).html;
  const failing = DIRS.filter((d) => !V.nxValidatePage(rendered[d]).pass);
  check('all six directions still pass the blocking gate', failing.length === 0,
    failing.map((d) => V.nxValidatePage(rendered[d]).blocking[0].rule).join(', '));

  // The words must actually be in the DOM, not merely computed.
  const doc = parseHTML(rendered['signal-industrial']).document;
  const h1 = (doc.querySelector('h1') || {}).textContent || '';
  check('the industry-derived headline is rendered', /Groundworks/i.test(h1), h1.slice(0, 50));
  const btn = [...doc.querySelectorAll('.c-btn')].map((e) => e.textContent.trim());
  check('the direction-voiced CTA is rendered', btn.some((t) => /Request a quote/i.test(t)), btn.slice(0, 3).join(' | '));

  // Different briefs must produce visibly different pages.
  const a = nx.nxCompose(BRIEFS.yoga, { direction: 'luxury-art' }).html;
  const b2 = nx.nxCompose(BRIEFS.civil, { direction: 'luxury-art' }).html;
  check('two briefs in the same direction render different copy',
    /Vinyasa/i.test(a) && /Groundworks/i.test(b2) && !/Vinyasa/i.test(b2));

  // Longer copy must not break the rhythm or overflow the layout.
  const wordy = { ...BRIEFS.civil, description: 'A civil engineering and groundworks contractor handling drainage design, deep excavation, ground stabilisation, concrete surfacing and full site remediation for commercial and industrial clients across the region.' };
  const wr = V.nxValidatePage(nx.nxCompose(wordy, { direction: 'swiss-structured' }).html);
  check('a long brief does not trigger overflow or rhythm violations', wr.pass,
    wr.blocking.slice(0, 2).map((x) => x.rule).join(', '));
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
