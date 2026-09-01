// BUILDER UI ↔ ENGINE WIRING.
//
// The composition engine can support five art directions, but if the builder UI
// never SENDS `direction`, every user gets the auto pick and the feature is
// unreachable in practice. Equally, `designExplanation` is computed server-side
// and was never displayed. These tests pin the front-end contract.
//
// Run: node tests/test_builder_ui_wiring.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const APP = readFileSync(join(ROOT, 'NexusCRM_V4_Hardened.html'), 'utf8');
const { JSDOM } = await import('jsdom');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const DIRS = ['editorial-minimal', 'cinematic-immersive', 'luxury-art', 'bold-experimental', 'swiss-structured'];

console.log('\n== A. The app document is well-formed ==');
{
  let ok = true; try { new JSDOM(APP); } catch (e) { ok = false; }
  check('NexusCRM_V4_Hardened.html parses as HTML', ok);
}

console.log('\n== B. The direction picker exists and offers every direction ==');
{
  const block = APP.match(/<select id="ws-direction"[\s\S]*?<\/select>/);
  check('a #ws-direction picker is rendered', !!block);
  if (block) {
    const opts = [...block[0].matchAll(/value="([^"]*)"/g)].map(m => m[1]);
    const missing = DIRS.filter(d => !opts.includes(d));
    check('every art direction is offered', missing.length === 0, 'missing: ' + missing.join(','));
    check('an auto/default option exists', opts.includes(''), opts.join('|'));
  }
}

console.log('\n== C. The chosen direction reaches the backend ==');
{
  // Without this line the picker is decorative and the engine always auto-picks.
  check('the build payload sends `direction`', /direction:\s*V\('ws-direction'\)/.test(APP));
  check('the picker has a change handler', /id="ws-direction"[^>]*onchange="directionPick\(\)"/.test(APP));
  check('directionPick is defined', /function directionPick\(\)/.test(APP));
}

console.log('\n== D. The design rationale is shown to the user ==');
{
  check('the report renders r.designExplanation', /r\.designExplanation/.test(APP));
  // It must be escaped: the explanation is server-generated text placed into HTML.
  check('the explanation is HTML-escaped', /esc\(r\.designExplanation\)/.test(APP));
  check('the report shows which direction was used', /r\.direction\?/.test(APP));
}

console.log('\n== E. 3D scene text is published before the renderer boots ==');
{
  // boot3() used to run BEFORE window.NX_SCENE_TEXT was assigned, so text:true
  // scenes rendered `undefined` instead of the user's words.
  const i = APP.indexOf('window.NX_SCENE_TEXT=${JSON.stringify((V(\'ws-scene-text\')');
  const j = APP.indexOf('else{boot3();}', i > 0 ? i - 4000 : 0);
  check('NX_SCENE_TEXT is assigned before boot3() is called', i > 0 && j > i, `assign@${i} boot@${j}`);
}

const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
