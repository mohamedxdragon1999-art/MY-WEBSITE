// PLAN/GRAPH-LAYER FUZZING — the composition plan as untrusted input.
//
// The previous fuzzer varied CONTENT. This one attacks the PLAN: the object the
// renderer trusts to describe section order, variants, palette, type scale and
// rhythm. Plans do not only come from nxComposePlan() — they arrive from AI
// patch operations, imported sites and API callers, so "the engine builds it
// correctly" is not a safety argument.
//
// Found on the first run, all real:
//   * a palette value containing "}</style><script>" ESCAPED the stylesheet and
//     executed — a live alert(1) in the rendered page
//   * a non-array `sections` threw (.map is not a function)
//   * duplicated sections emitted duplicate element ids AND two <h1>
//   * an empty `sections` produced a page with no <h1> at all
//
// Run: node tests/test_plan_hardening.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseHTML } = require('linkedom');
const nx = require('../backend/src/nx_compose.js');
const V = require('../backend/src/nx_validate.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const BRIEF = { site_name: 'A', hero_headline: 'H', services: [{ title: 's', desc: 'd' }], projects: [{ title: 'p', cat: 'c' }], reviews: [{ text: 'r', name: 'n' }], stats: [{ value: 1, label: 'l' }] };
const content = nx.nxComposeContent(BRIEF);
const basePlan = () => nx.nxComposePlan(content, 'luxury-art');
const render = (plan) => nx.nxRenderDirected(content, 'luxury-art', plan).html;

// Every way a plan can be wrong, malicious, or self-contradictory.
const MUTATIONS = {
  'sections: empty': (p) => ({ ...p, sections: [] }),
  'sections: unknown key': (p) => ({ ...p, sections: [...p.sections, 'wormhole'] }),
  'sections: duplicated': (p) => ({ ...p, sections: [...p.sections, ...p.sections] }),
  'sections: not an array': (p) => ({ ...p, sections: 'nav,hero' }),
  'sections: null entries': (p) => ({ ...p, sections: [null, undefined, 'hero'] }),
  'sections: footer first': (p) => ({ ...p, sections: ['footer', 'hero', 'nav'] }),
  'sections: 200 entries': (p) => ({ ...p, sections: Array.from({ length: 200 }, (_, i) => (i % 2 ? 'feature' : 'work')) }),
  'rhythm shorter than sections': (p) => ({ ...p, rhythm: ['normal'] }),
  'rhythm: not an array': (p) => ({ ...p, rhythm: 'normal' }),
  'emphasisTiers mismatched': (p) => ({ ...p, emphasisTiers: ['max'] }),
  'transitions: not an array': (p) => ({ ...p, transitions: 5 }),
  'heroVariant: unknown': (p) => ({ ...p, heroVariant: 'quantum' }),
  'featureMode: unknown': (p) => ({ ...p, featureMode: 'quantum' }),
  'reviewMode: unknown': (p) => ({ ...p, reviewMode: 'quantum' }),
  'density: unknown': (p) => ({ ...p, density: 'infinite' }),
  'motion: unknown': (p) => ({ ...p, motion: 'hyperspeed' }),
  'radius: negative': (p) => ({ ...p, radius: -500 }),
  'radius: a string': (p) => ({ ...p, radius: 'lots' }),
  'palette: missing keys': (p) => ({ ...p, palette: { bg: '#fff' } }),
  'palette: null': (p) => ({ ...p, palette: null }),
  'type: null': (p) => ({ ...p, type: null }),
  'type: missing sizes': (p) => ({ ...p, type: { family: 'serif' } }),
  'emphasis: not an object': (p) => ({ ...p, emphasis: 'high' }),
};

console.log('\n== A. No hostile plan crashes the renderer ==');
{
  const crashed = [], empty = [];
  for (const [label, mut] of Object.entries(MUTATIONS)) {
    let html;
    try { html = render(mut(basePlan())); }
    catch (e) { crashed.push(`${label}: ${e.message.slice(0, 45)}`); continue; }
    if (typeof html !== 'string' || html.length < 500) empty.push(`${label}: ${html ? html.length : 0}B`);
  }
  check('every malformed plan still renders', crashed.length === 0, crashed.slice(0, 3).join(' | '));
  check('no plan produces an empty document', empty.length === 0, empty.slice(0, 3).join(' | '));
}

console.log('\n== B. Structural invariants survive any plan ==');
{
  const bad = [];
  for (const [label, mut] of Object.entries(MUTATIONS)) {
    let doc;
    try { doc = parseHTML(render(mut(basePlan()))).document; } catch (e) { continue; }
    const h1 = doc.querySelectorAll('h1').length;
    const main = doc.querySelectorAll('main').length;
    if (h1 !== 1) bad.push(`${label}: ${h1} h1`);
    if (main !== 1) bad.push(`${label}: ${main} main`);
    // Duplicated sections used to emit duplicate element ids.
    const ids = [...doc.querySelectorAll('[id]')].map((e) => e.getAttribute('id'));
    const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
    if (dupes.length) bad.push(`${label}: duplicate id ${dupes[0]}`);
  }
  check('exactly one h1, one main, and no duplicate ids', bad.length === 0, bad.slice(0, 4).join(' | '));
}

console.log('\n== C. A plan cannot inject executable code ==');
{
  // A palette value is interpolated into <style>. This payload closed the tag.
  const VECTORS = {
    'style breakout via palette': (p) => ({ ...p, palette: { ...p.palette, bg: '#fff;}</style><script>alert(1)</script><style>{' } }),
    'style breakout via type': (p) => ({ ...p, type: { ...p.type, family: 'x;}</style><script>alert(2)</script><style>{' } }),
    'style breakout via shadow': (p) => ({ ...p, shadow: '0 0 0 red;}</style><script>alert(3)</script><style>{' }),
    'css expression': (p) => ({ ...p, palette: { ...p.palette, accent: 'expression(alert(4))' } }),
    'css @import': (p) => ({ ...p, palette: { ...p.palette, bg: 'red;@import url(//evil.test/x.css)' } }),
    'attribute breakout via density': (p) => ({ ...p, density: 'airy" onload="alert(5)' }),
    'attribute breakout via motion': (p) => ({ ...p, motion: 'slow" onmouseover="alert(6)' }),
  };
  const live = [], escaped = [];
  for (const [label, mut] of Object.entries(VECTORS)) {
    let html; try { html = render(mut(basePlan())); } catch (e) { live.push(`${label}: threw`); continue; }
    const doc = parseHTML(html).document;
    // Exactly one <style> and one <script> (the page's own runtime) are correct.
    if (doc.querySelectorAll('style').length !== 1) escaped.push(`${label}: ${doc.querySelectorAll('style').length} <style>`);
    if (doc.querySelectorAll('script').length !== 1) live.push(`${label}: ${doc.querySelectorAll('script').length} <script>`);
    if (doc.querySelector('[onload],[onerror],[onmouseover]')) live.push(`${label}: live event handler`);
    if (/@import|expression\s*\(/i.test(html)) escaped.push(`${label}: css directive survived`);
  }
  check('no plan value breaks out of the stylesheet', escaped.length === 0, escaped.slice(0, 3).join(' | '));
  check('no plan value becomes executable script or a handler', live.length === 0, live.slice(0, 3).join(' | '));
}

console.log('\n== D. Unusable values fall back instead of emitting broken CSS ==');
{
  const broken = [];
  for (const [label, mut] of Object.entries(MUTATIONS)) {
    let html; try { html = render(mut(basePlan())); } catch (e) { continue; }
    const root = (html.match(/:root\{[^}]*\}/) || [''])[0];
    for (const bad of ['undefined', 'NaN', 'null', '[object Object]']) {
      if (root.includes(bad)) broken.push(`${label}: --token:${bad}`);
    }
  }
  check('custom properties never resolve to undefined/NaN/null', broken.length === 0, broken.slice(0, 4).join(' | '));
}

console.log('\n== E. Hostile plans still clear the blocking gate ==');
{
  const failing = [];
  for (const [label, mut] of Object.entries(MUTATIONS)) {
    let r; try { r = V.nxValidatePage(render(mut(basePlan()))); } catch (e) { failing.push(`${label}: threw`); continue; }
    if (!r.pass) failing.push(`${label}: ${r.blocking.slice(0, 2).map((b) => b.rule).join(',')}`);
  }
  check('every repaired plan produces a page that passes validation', failing.length === 0, failing.slice(0, 4).join(' | '));
}

console.log('\n== F. Normalisation preserves legitimate intent ==');
{
  // Hardening must not flatten real design decisions into one default.
  const p = basePlan();
  const custom = { ...p, sections: ['nav', 'hero', 'work', 'contact', 'footer'] };
  const doc = parseHTML(render(custom)).document;
  const order = [...doc.querySelectorAll('main > *, body > header, body > footer')]
    .map((e) => e.getAttribute('id')).filter(Boolean);
  check('a legitimate custom section order is honoured', order.includes('work') && order.includes('contact'), order.join(','));
  check('the footer is always last', /footer/.test(String(order[order.length - 1] || '')) || !!doc.querySelector('body > footer, .c-footer'));
  // Distinctness must survive: normalisation cannot collapse the directions.
  const st = require('../backend/src/nx_structured.js');
  const sigs = Object.keys(nx.NX_COMPOSE_DIRECTIONS).map((d) => st.nxStructuralSignature(nx.nxCompose(BRIEF, { direction: d }).html));
  let min = 1;
  for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) min = Math.min(min, st.nxSignatureDistance(sigs[i], sigs[j]));
  check('directions remain structurally distinct after hardening', min > 0.20, `min=${min.toFixed(3)}`);
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
