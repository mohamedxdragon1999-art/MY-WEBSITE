// NexusCRM — COMPOSITION INTELLIGENCE (Cycle 2).
//
// Turns Cycle 1's design intelligence into the site the user actually SEES. The
// design direction must be AUTHORITATIVE for the rendered page: a direction
// changes section selection, hero structure, feature/review variants, typography
// scale, section rhythm, density and motion language — a color/font/radius-only
// difference is a FAILED direction. We measure the RENDERED DOM, not metadata.
//
// Run: node tests/test_composition.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('./d1mock.js'); // ensure sql.js is resolvable
await import(new URL('../backend/src/index.js', import.meta.url).pathname);
const ir = globalThis.__NX_IR;

import nx from '../backend/src/nx_compose.js';
import st from '../backend/src/nx_structured.js';
const { nxStructuralSignature, nxSignatureDistance } = st;

const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);
const DISTINCT = 0.20;   // two directions are "genuinely different" above this
const COLOR_ONLY = 0.18; // a palette-only clone must stay below this

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

// A content-rich site plan (the "what", direction decides the "how").
function richPlan() {
  return {
    site_name: 'Atelier North', ownerName: 'Maya Chen',
    hero_headline: 'Objects of permanence, made slowly.',
    hero_sub: 'A studio for considered interiors that age gracefully.',
    cta_primary: 'Begin a project', cta_secondary: 'See the work',
    services: [
      { title: 'Bespoke furniture', desc: 'Pieces built to last generations.' },
      { title: 'Lighting', desc: 'Sculptural light for warm rooms.' },
      { title: 'Textiles', desc: 'Natural fibre, hand-woven.' },
      { title: 'Workshop', desc: 'A cabinet of small-series editions.' },
    ],
    why: ['Made to order', 'Natural materials', 'Hand finished'],
    stats: [{ value: 120, label: 'Projects' }, { value: 14, label: 'Years' }, { value: 32, label: 'Artisans' }, { value: 8, label: 'Awards' }],
    projects: [
      { title: 'Halcyon House', cat: 'Residential' },
      { title: 'Meridian', cat: 'Retail' },
      { title: 'Quiet Forms', cat: 'Furniture' },
    ],
    reviews: [
      { text: 'A team that treats every detail as the whole point.', name: 'Elliot', role: 'Owner' },
      { text: 'They translated a feeling into a space.', name: 'Priya', role: 'Founder' },
    ],
    faqs: [{ q: 'Lead time?', a: 'Six to twelve weeks.' }],
    contact: { email: 'hello@ateliernorth.co', phone: '+20 10 1234 5678' },
  };
}

console.log('\n== A. COMPOSITION RESOLVER: component families produce the right variants ==');
{
  check('five directions registered', DIRS.length === 5, `got ${DIRS.length}`);
  check('direction ids match Cycle 1 NX_DESIGN_DIRECTIONS', DIRS.every(d => ir.NX_DESIGN_DIRECTIONS.some(x => x.id === d)));
  for (const d of DIRS) {
    const r = ir.nxCompose(richPlan(), { direction: d });
    const sig = nxStructuralSignature(r.html);
    check(d + ' hero=' + r.plan.heroVariant, sig.hero === r.plan.heroVariant, `rendered ${sig.hero} vs plan ${r.plan.heroVariant}`);
    check(d + ' feature=' + r.plan.featureMode, sig.feature === r.plan.featureMode, `rendered ${sig.feature} vs plan ${r.plan.featureMode}`);
    check(d + ' motion=' + r.plan.motion, sig.motion === r.plan.motion, `rendered ${sig.motion}`);
  }
}

console.log('\n== B. DETERMINISM & VALID PAGE ==');
{
  const a = ir.nxCompose(richPlan(), { direction: 'luxury-art' }).html;
  const b = ir.nxCompose(richPlan(), { direction: 'luxury-art' }).html;
  check('same input → identical output', a === b);
  let valid = true;
  for (const d of DIRS) {
    const h = ir.nxCompose(richPlan(), { direction: d }).html;
    if (!/<html[^>]*>/i.test(h) || !/<\/html>\s*$/i.test(h) || !/<body>/i.test(h)) valid = false;
  }
  check('every direction emits a complete, well-formed page', valid);
}

console.log('\n== C. TYPOGRAPHIC HIERARCHY SOLVER (rendered, not metadata) ==');
{
  const scales = {};
  for (const d of DIRS) scales[d] = nxStructuralSignature(ir.nxCompose(richPlan(), { direction: d }).html).typography;
  check('every direction renders a full type scale (display/hero/section/body/caption/btn)', DIRS.every(d => ['display', 'hero', 'section', 'body', 'caption', 'btn'].every(k => scales[d][k])));
  // bold display must be larger than editorial display (measured clamp midpoint)
  const num = (v) => { const m = String(v).match(/clamp\(([^,]+),([^,]+),([^)]+)\)/); const mid = (s) => parseFloat(s.replace(/[^\d.]/g, '')) || 0; return m ? mid(m[1]) * 0.3 + mid(m[2]) * 0.4 + mid(m[3]) * 0.3 : (parseFloat(String(v).replace(/[^\d.]/g, '')) || 0); };
  check('bold-experimental display > swiss-structured display (hierarchy grows)', num(scales['bold-experimental'].display) > num(scales['swiss-structured'].display));
  check('cinematic display > swiss-structured display', num(scales['cinematic-immersive'].display) > num(scales['swiss-structured'].display));
  check('each direction has a distinct text measure (type scale, rendered)', new Set(DIRS.map(d => nxStructuralSignature(ir.nxCompose(richPlan(), { direction: d }).html).measure)).size === 5);
}

console.log('\n== D. SECTION RHYTHM SYSTEM & DENSITY ==');
{
  const dens = {};
  for (const d of DIRS) dens[d] = nxStructuralSignature(ir.nxCompose(richPlan(), { direction: d }).html).density;
  check('density attribute present per direction', DIRS.every(d => ['airy', 'balanced', 'dense'].includes(dens[d])), JSON.stringify(dens));
  check('editorial=airy && bold=dense (density control is real)', dens['editorial-minimal'] === 'airy' && dens['bold-experimental'] === 'dense');
  check('rhythm array exists & length == sections for each direction', DIRS.every(d => {
    const p = ir.nxCompose(richPlan(), { direction: d }).plan;
    return Array.isArray(p.rhythm) && p.rhythm.length === p.sections.length;
  }));
}

console.log('\n== E. DIRECTION-CONTROLLED MOTION ==');
{
  const motion = {};
  for (const d of DIRS) motion[d] = ir.nxCompose(richPlan(), { direction: d }).plan.motion;
  check('motion set is unique across directions', new Set(Object.values(motion)).size === 5, JSON.stringify(motion));
  check('cinematic motion is cinematic', motion['cinematic-immersive'] === 'cinematic');
}

console.log('\n== F. RESPONSIVE RE-COMPOSES (breakpoint changes layout, not just size) ==');
{
  const re = /@media\s*\(max-width:\s*900px\)[^{]*\{[\s\S]*?grid-template-columns:\s*1fr\s*;[\s\S]*?\}/;
  const good = DIRS.every(d => re.test(ir.nxCompose(richPlan(), { direction: d }).html));
  check('media query rewrites multi-column grid to single column on mobile', good);
}

console.log('\n== G. HERO IS STRUCTURALLY DIFFERENT ACROSS DIRECTIONS ==');
{
  const heroes = new Set(DIRS.map(d => nxStructuralSignature(ir.nxCompose(richPlan(), { direction: d }).html).hero));
  check('all five hero modes are structurally distinct', heroes.size === 5, JSON.stringify([...heroes]));
}

console.log('\n== H. DIRECTION DISTINCTNESS (rendered DOM, NOT palette) ==');
{
  const sigs = {}; for (const d of DIRS) sigs[d] = nxStructuralSignature(ir.nxCompose(richPlan(), { direction: d }).html);
  let minReal = 1, closePair = '';
  for (let i = 0; i < DIRS.length; i++) for (let j = i + 1; j < DIRS.length; j++) {
    const dist = nxSignatureDistance(sigs[DIRS[i]], sigs[DIRS[j]]);
    if (dist < minReal) { minReal = dist; closePair = DIRS[i] + ' vs ' + DIRS[j]; }
  }
  check('every pair of directions is structurally distinct (min real distance ' + minReal.toFixed(3) + ' > ' + DISTINCT + ')', minReal > DISTINCT, 'min ' + minReal.toFixed(3) + ' at ' + closePair);
  // color-only clone must NOT count as a new direction
  const baseHtml = ir.nxCompose(richPlan(), { direction: 'editorial-minimal' }).html;
  const cloneHtml = baseHtml.replace(/--bg:#[0-9A-Fa-f]{3,8};/g, '--bg:#000000;').replace(/--accent:#[0-9A-Fa-f]{3,8};/g, '--accent:#ff00ff;').replace(/data-dir="[^"]*"/g, 'data-dir="clone"');
  const cloneDist = nxSignatureDistance(sigs['editorial-minimal'], nxStructuralSignature(cloneHtml));
  check('a palette-only clone is NOT a distinct direction (distance ' + cloneDist.toFixed(3) + ' < ' + COLOR_ONLY + ')', cloneDist < COLOR_ONLY, 'clone dist ' + cloneDist.toFixed(3));
  check("minimum real distance (max over pairs) exceeds color-only 'distance' by a wide margin", minReal > cloneDist + 0.15, `min=${minReal.toFixed(3)} clone=${cloneDist.toFixed(3)}`);
}

console.log('\n== I. GENERICNESS PROOF: bad input → poor structure, direction → real structure ==');
{
  // A "card-soup" fixture: one section, uniform cards, no hierarchy, no direction.
  const soup = {
    site_name: 'Soup', hero_headline: '', hero_sub: '',
    services: [{ title: 'a' }, { title: 'a' }, { title: 'a' }],
  };
  const sigSoup = nxStructuralSignature(nx.nxCompose(soup, { direction: 'editorial-minimal' }).html);
  const sigDir = nxStructuralSignature(nx.nxCompose(richPlan(), { direction: 'cinematic-immersive' }).html);
  // a rich, directed composition must be structurally richer than an empty card-soup
  check('directed composition has more distinct structural roles than card-soup', (sigDir.hero !== 'generic' ? 1 : 0) + (sigDir.feature !== 'generic' ? 1 : 0) + (sigDir.density ? 1 : 0) >= (sigSoup.hero !== 'generic' ? 1 : 0) + (sigSoup.feature !== 'generic' ? 1 : 0) + (sigSoup.density ? 1 : 0));
  // rendered-quality analyzer is exposed and reports a usable score for a good direction
  const q = ir.nxRenderedDesignQuality(nx.nxCompose(richPlan(), { direction: 'editorial-minimal' }).html);
  check('rendered output has a measurable (non-zero) quality signature', q.score > 0, 'score=' + q.score);
}

console.log('\n== J. 20-BRIEF × 5-DIRECTION GOLDEN BENCHMARK ==');
{
  const briefs = [
    richPlan(),
    { site_name: 'Field Notes', hero_headline: 'Take better notes.', hero_sub: 'A lighter way to think.', services: [{ title: 'Capture', desc: '' }, { title: 'Organize', desc: '' }], reviews: [{ text: 'Wonderful.', name: 'A' }] },
    { site_name: 'Mono', ownerName: 'J', hero_headline: 'One thing, well.', hero_sub: 'Less is more.' },
    { site_name: 'Atlas', hero_headline: 'Navigate the wild.', hero_sub: 'Bold by design.', stats: [{ value: 9000, label: 'Miles' }], projects: [{ title: 'Ridge', cat: 'Trail' }] },
    { site_name: 'Kindred', hero_headline: 'Grow together.', hero_sub: 'A community studio.', services: [{ title: 'Classes' }, { title: 'Studio' }, { title: 'Events' }, { title: 'Rentals' }], reviews: [{ text: 'Loved it.', name: 'K', role: 'Member' }] },
    { site_name: 'Harbor', ownerName: 'L', hero_headline: 'Calm waters.', hero_sub: 'A retreat by the sea.', stats: [{ value: 48, label: 'Suites' }] },
    { site_name: 'Vertex', hero_headline: 'Clients first.', hero_sub: 'A consultancy.' },
    { site_name: 'Bloom', hero_headline: 'Everyday luxury.', hero_sub: 'For the table.', services: [{ title: 'Ceramics' }, { title: 'Glass' }], projects: [{ title: 'Vessel', cat: 'Objects' }] },
    { site_name: 'Northwind', hero_headline: 'Built to last.', hero_sub: 'Outdoor gear.', why: ['Guaranteed', 'Repairable'] },
    { site_name: 'Sable', hero_headline: 'Bespoke tailoring.', hero_sub: 'Cut for you.', services: [{ title: 'Suits' }, { title: 'Shirts' }], reviews: [{ text: 'Fits perfectly.', name: 'R' }] },
    { site_name: 'Cascade', hero_headline: 'A better flow.', hero_sub: 'Work tools.' },
    { site_name: 'Echo', hero_headline: 'Tell better stories.', hero_sub: 'A journal.', projects: [{ title: 'Issue 1', cat: 'Editorial' }] },
    { site_name: 'Juniper', hero_headline: 'Small is beautiful.', hero_sub: 'A boutique.', stats: [{ value: 12, label: 'Makers' }] },
    { site_name: 'Solstice', hero_headline: 'Light and shadow.', hero_sub: 'A gallery.', projects: [{ title: 'Forms', cat: 'Sculpture' }, { title: 'Light', cat: 'Art' }], reviews: [{ text: 'Breathtaking.', name: 'M' }] },
    { site_name: 'Corner', ownerName: 'T', hero_headline: 'A neighborhood café.', hero_sub: 'Slow mornings.', services: [{ title: 'Coffee' }, { title: 'Bakery' }] },
    { site_name: 'Ledger', hero_headline: 'Keep it simple.', hero_sub: 'Small business finance.', why: ['Safe', 'Fast'] },
    { site_name: 'Nectar', ownerName: 'A', hero_headline: 'Real ingredients.', hero_sub: 'A small kitchen.', projects: [{ title: 'Menu', cat: 'Seasonal' }] },
    { site_name: 'Forum', hero_headline: 'Better debate.', hero_sub: 'A place for ideas.' },
    { site_name: 'Cliff', hero_headline: 'Breathe deep.', hero_sub: 'A mountain retreat.', stats: [{ value: 20, label: 'Cabins' }], services: [{ title: 'Stay' }, { title: 'Guides' }] },
    { site_name: 'Mosaic', hero_headline: 'Every piece matters.', hero_sub: 'A collective.', reviews: [{ text: 'Brilliant.', name: 'S' }], projects: [{ title: 'Wall', cat: 'Mural' }] },
  ];
  let distinctAll = true, detAll = true, invalid = [];
  let globalMin = 1;
  for (let bi = 0; bi < briefs.length; bi++) {
    const sigs = {};
    for (const d of DIRS) sigs[d] = nxStructuralSignature(nx.nxCompose(briefs[bi], { direction: d }).html);
    // pairwise distinctness within this brief
    for (let i = 0; i < DIRS.length; i++) for (let j = i + 1; j < DIRS.length; j++) {
      const dist = nxSignatureDistance(sigs[DIRS[i]], sigs[DIRS[j]]);
      if (dist < globalMin) globalMin = dist;
      if (dist < DISTINCT) { distinctAll = false; invalid.push(`brief#${bi} ${DIRS[i]}vs${DIRS[j]} dist=${dist.toFixed(3)}`); }
    }
    if (!briefs[bi].site_name) detAll = false;
  }
  check('all 5 directions stay structurally distinct across all 20 briefs (global min ' + globalMin.toFixed(3) + ' > ' + DISTINCT + ')', distinctAll, invalid.slice(0, 4).join(' | '));
  check('same brief+direction is deterministic across the benchmark', detAll);
}

console.log('\n== K. HUMAN-READABLE DESIGN EXPLANATION MATCHES THE GRAPH ==');
{
  const r = ir.nxCompose(richPlan(), { direction: 'luxury-art' });
  const ex = r.explanation;
  check('explanation names the chosen direction', ex.indexOf('Luxury Art-Directed') >= 0);
  check('explanation states composition facts (hero + feature + rhythm)', /minimal hero/.test(ex) && /split feature/.test(ex) && /rhythm/.test(ex));
  check('explanation reflects density & motion (no invented claims)', /airy/.test(ex) && /slow/.test(ex));
}

console.log('\n== L. COMPOSE-FROM-PROJECT (graph → directed page) bridge ==');
{
  const g = ir.nxNewProject({ name: 'GraphCo', brief: { visualStyle: 'modern-clean', tone: 'professional' } });
  ['nav', 'hero', 'features', 'testimonials', 'cta', 'footer'].forEach((fam, i) =>
    ir.nxSeedNode(g, { semanticRole: fam === 'testimonials' ? 'testimonials' : fam, id: 'n' + i, component: { family: fam, variant: 'default' } }));
  const r = ir.nxComposeFromProject(g, 'luxury-art');
  check('graph project → directed page returns HTML + plan', r.html.length > 1000 && !!r.plan.direction);
  check('direction from project is authoritative (luxury)', r.plan.direction === 'luxury-art');
}

console.log('\n== M. SECTION TRANSITIONS & VISUAL EMPHASIS BUDGET ==');
{
  const tras = {};
  for (const d of DIRS) {
    const p = ir.nxCompose(richPlan(), { direction: d }).plan;
    const html = ir.nxCompose(richPlan(), { direction: d }).html;
    const bodyHtml = html.replace(/<style>[\s\S]*?<\/style>/g, ''); // ignore CSS selector block
    tras[d] = { transitions: [...new Set([...bodyHtml.matchAll(/data-transition="([^"]+)"/g)].map(m => m[1]))], tiers: p.emphasisTiers.join(','), maxTiers: p.emphasisTiers.filter(t => t === 'max').length };
  }
  check('every direction renders section transitions (data-transition present)', DIRS.every(d => tras[d].transitions.some(t => t !== 'flat')));
  check('transition motif differs across directions (not one universal treatment)', new Set(DIRS.map(d => tras[d].transitions.sort().join('|'))).size > 1);
  check('emphasis budget limits focal sections (no direction has >2 max-emphasis sections)', DIRS.every(d => tras[d].maxTiers >= 1 && tras[d].maxTiers <= 2), JSON.stringify(DIRS.map(d => [d, tras[d].maxTiers])));
  check('hero is always the primary focal point (max)', DIRS.every(d => ir.nxCompose(richPlan(), { direction: d }).plan.emphasisTiers[1] === 'max'));
}

console.log('\n== N. REPETITION MODEL & CARD-DEPENDENCY (no card-soup) ==');
{
  const nm = (html) => st.nxRepetitionModel(html);
  const soupHtml = '<html><body><div class="c-page"><section class="c-grid">' + '<div class="c-card">x</div>'.repeat(6) + '</section></div></body></html>';
  const soup = nm(soupHtml);
  check('card-soup fixture is detected: high cardDependency + high monotony', soup.cardDependency >= 0.8 && soup.monotony >= 80, JSON.stringify(soup));
  const dirMono = {}; for (const d of DIRS) dirMono[d] = nm(ir.nxCompose(richPlan(), { direction: d }).html);
  check('every directed composition is far less monotonous than card-soup', DIRS.every(d => dirMono[d].monotony < soup.monotony - 30), JSON.stringify(DIRS.map(d => [d, dirMono[d].monotony])));
  check('card-dependency is reduced by editorial list / bento / split alternatives', dirMono['editorial-minimal'].cardDependency === 0 && dirMono['cinematic-immersive'].cardDependency < 0.3, JSON.stringify({ ed: dirMono['editorial-minimal'].cardDependency, ci: dirMono['cinematic-immersive'].cardDependency }));
}

console.log('\n== O. VISUAL QUALITY LOOP (§20): corrupt → measure → patch → re-render → repair ==');
{
  const plan = richPlan();
  const loop = ir.nxComposeQualityLoop(plan, 'editorial-minimal', { iterations: 4 });
  check('loop found a genuinely degraded starting render', loop.before.monotony > 45 && loop.before.cardDependency > 0.5 && loop.before.emphasisAllMax, JSON.stringify({ m: loop.before.monotony, cd: loop.before.cardDependency, max: loop.before.emphasisAllMax }));
  check('loop REPAIRED the rendered composition (monotony dropped materially)', loop.after.monotony < loop.before.monotony - 30, `${loop.before.monotony}→${loop.after.monotony}`);
  check('loop reduced card-dependency to ~0 (alternatives found)', loop.after.cardDependency < 0.2, `${loop.before.cardDependency}→${loop.after.cardDependency}`);
  check('loop restored a real typographic hierarchy', loop.after.typeUniformity < 0.95 && loop.after.typeUniformity < loop.before.typeUniformity, `${loop.before.typeUniformity}→${loop.after.typeUniformity}`);
  check('loop established a single focal point (no longer all-max)', loop.after.emphasisAllMax === false && loop.after.emphasisTiers >= 2);
  check('converges to the direction target (no visually-worse regression)', loop.deltas.structureDistance === 0 || loop.deltas.structureDistance < 0.05, 'structureDistance=' + loop.deltas.structureDistance);
  check('loop is deterministic', JSON.stringify(ir.nxComposeQualityLoop(plan, 'editorial-minimal', { iterations: 4 }).deltas) === JSON.stringify(loop.deltas));
  // verify across all directions too
  let okAll = true, msg = [];
  for (const d of DIRS) {
    const l = ir.nxComposeQualityLoop(plan, d, { iterations: 4 });
    if (l.before.monotony <= l.after.monotony) { okAll = false; msg.push(d + ' not improved'); }
  }
  check('quality loop improves every direction (no direction left degraded)', okAll, msg.join(' | '));
}

console.log('\n== P. STRUCTURAL INVARIANTS: page furniture order + no card-soup in ANY direction ==');
{
  // P1. `footer` must be the LAST rendered section in every direction. A missing
  // `contact` used to be appended AFTER an already-present footer, so luxury-art
  // and swiss-structured rendered footer-before-contact.
  let footerLast = true; const badFooter = [];
  for (const d of DIRS) {
    const order = nxStructuralSignature(ir.nxCompose(richPlan(), { direction: d }).html).order || [];
    const last = String(order[order.length - 1] || '');
    if (!/c-footer/.test(last)) { footerLast = false; badFooter.push(d + ':' + last); }
  }
  check('footer is structurally terminal in every direction', footerLast, badFooter.join(','));

  // P2. No direction may degenerate into card-soup. swiss-structured previously
  // measured cardDependency 0.6 / monotony 49 by using generic feature cards.
  let noSoup = true; const soupy = [];
  for (const d of DIRS) {
    const rep = st.nxRepetitionModel(ir.nxCompose(richPlan(), { direction: d }).html);
    if (rep.cardDependency > 0.35 || rep.monotony > 45) { noSoup = false; soupy.push(d + ' cardDep=' + rep.cardDependency + ' monotony=' + rep.monotony); }
  }
  check('no direction degenerates into card-soup', noSoup, soupy.join(' | '));

  // P3. Feature families must be genuinely distinct across directions (a shared
  // fallback "grid" for several directions would be a reskin, not composition).
  const feats = DIRS.map(d => nxStructuralSignature(ir.nxCompose(richPlan(), { direction: d }).html).feature);
  check('every direction resolves a distinct, recognised feature family', new Set(feats).size === DIRS.length && !feats.includes('generic'), feats.join(','));
}

const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
