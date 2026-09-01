// DESIGN-QA INTEGRITY: the score must reflect real design, and must not be gameable.
//
// Cycle 2 forbids "improve the number without improving the site". The inverse
// risk is a scorer that rewards MARKERS rather than SUBSTANCE — 30 empty
// <section> tags scoring like a real layout. These tests pin the ordering of
// known-good vs known-bad pages and cap what empty markup can earn.
//
// Run: node tests/test_qa_integrity.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('../nx_design.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const score = (h) => D.nxDesignQA(h).score;

const EMPTY = '<!DOCTYPE html><html><head><title>x</title></head><body></body></html>';
const GAMED = EMPTY.replace('</body>', '<section></section>'.repeat(30) + '<style>' + '@media(min-width:1px){}'.repeat(30) + 'display:grid;padding:1px;--x:1;'.repeat(50) + '</style></body>');
const TERRIBLE = `<!DOCTYPE html><html><head><title>x</title></head><body>
${Array.from({ length: 40 }, () => '<div class="card" style="border-radius:37px;box-shadow:0 0 90px red;background:linear-gradient(1deg,#f0f,#0ff)"><h1 style="font-size:140px;color:#fafafa">HUGE</h1><p style="color:#fbfbfb;font-size:7px">tiny</p></div>').join('\n')}
</body></html>`;
const GOOD = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atelier</title><meta name="description" content="A studio">
<style>:root{--nx-bg:#ffffff;--nx-fg:#111111;--nx-primary:#1b4de4}body{font-family:Inter,sans-serif;background:var(--nx-bg);color:var(--nx-fg);line-height:1.6}
h1{font-size:56px}h2{font-size:28px}p{font-size:17px;max-width:64ch}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:64px}
@media(max-width:900px){.grid{grid-template-columns:1fr}}</style></head><body>
<main><section><h1>Objects of permanence</h1><p>A studio for considered interiors that age gracefully over many years of daily use.</p></section>
<section class="grid"><div><h2>Furniture</h2><p>Built to last generations.</p></div><div><h2>Lighting</h2><p>Sculptural light.</p></div><div><h2>Textiles</h2><p>Hand-woven.</p></div></section>
<section><img src="a.jpg" alt="Workshop"><h2>Our story</h2><p>Founded in 2010 by a small team.</p></section></main></body></html>`;

console.log('\n== A. Junk input never crashes the scorer ==');
{
  const crashed = [];
  for (const j of [null, undefined, '', {}, [], 0, '<html>', 'not html', '<div'.repeat(5000)]) {
    try { D.nxDesignQA(j); } catch (e) { crashed.push(String(j).slice(0, 15) + ': ' + e.message.slice(0, 40)); }
  }
  check('nxDesignQA tolerates any input', crashed.length === 0, crashed.slice(0, 2).join(' | '));
}

console.log('\n== B. The scorer ranks real design above bad design ==');
{
  const g = score(GOOD), t = score(TERRIBLE), e = score(EMPTY);
  console.log(`     good=${g} terrible=${t} empty=${e} gamed=${score(GAMED)}`);
  check('a well-built page beats card-soup', g > t, `good=${g} terrible=${t}`);
  check('card-soup with 40 h1s and 140px type does not score well', t < 70, String(t));
  check('an empty page does not score well', e < 60, String(e));
  check('every score stays within 0..100', [g, t, e, score(GAMED)].every(v => v >= 0 && v <= 100 && !Number.isNaN(v)));
}

console.log('\n== C. The score is not gameable with empty markers ==');
{
  // Repeating <section>, @media and "display:grid" adds no design whatsoever.
  // Composition credit must require real content, not marker presence.
  const delta = score(GAMED) - score(EMPTY);
  check('empty markup cannot buy a large score gain', delta <= 20, `gained ${delta} pts (${score(EMPTY)}→${score(GAMED)})`);
  check('a gamed empty page still loses to a real page', score(GAMED) < score(GOOD), `${score(GAMED)} vs ${score(GOOD)}`);
}

console.log('\n== D. Scoring is deterministic ==');
{
  check('same input yields the same score', score(GOOD) === score(GOOD) && score(TERRIBLE) === score(TERRIBLE));
}

const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
