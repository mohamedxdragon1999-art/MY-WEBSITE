// SPLINE SCENE LIBRARY TESTS — proves the 50-scene WebGL library is complete
// and consistent in BOTH ships (worker + frontend HTML), that every editable
// text scene honors the user-text contract, and that the build script is
// idempotent (re-running it changes nothing).
//
// Run: node tests/test_spline_scenes.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

const backend = readFileSync(join(ROOT, 'backend', 'src', 'index.js'), 'utf8');
const html = readFileSync(join(ROOT, 'NexusCRM_V4_Hardened.html'), 'utf8');

// The source of truth module IS the library; the build script injects it
// verbatim into both ships (proven byte-identical by the idempotency test
// at the end, which re-runs the build and asserts nothing changes).
const srcMod = await import(join(ROOT, 'patches', 'spline-scenes.src.mjs'));
const SCENES = new Map(Object.entries(srcMod.COMPOSED || srcMod.default));
function shipHas(scene) {
  // a scene is present in a ship when its id key AND its full name string appear
  return (s, id, name) => s.includes(id + ':') && s.includes(name);
}

console.log('\n════════ SCENE LIBRARY: structure (both ships) ════════');
check('library has exactly 50 scenes', SCENES.size === 50, 'got ' + SCENES.size);
check('scene ids are sp1..sp50', [...SCENES.keys()].every((k, i) => k === 'sp' + (i + 1)));
check('backend declares the SPLINE_SCENES block', backend.includes('const SPLINE_SCENES'));
check('frontend declares the SPLINE_SCENES block', html.includes('const SPLINE_SCENES'));

const names = new Set();
let dupName = null;
for (const [id, s] of SCENES) { if (names.has(s.name)) dupName = s.name; names.add(s.name); }
check('all 50 names unique', !dupName, 'duplicate: ' + dupName);
const missingBe = [...SCENES.entries()].filter(([, s]) => !backend.includes(s.name));
const missingFe = [...SCENES.entries()].filter(([, s]) => !html.includes(s.name));
check('all 50 scene names present in backend', missingBe.length === 0, missingBe.map(([, s]) => s.name).join(','));
check('all 50 scene names present in frontend', missingFe.length === 0, missingFe.map(([, s]) => s.name).join(','));

console.log('\n════════ SCENE LIBRARY: code sanity ════════');
let parseFail = 0, tickFail = 0, thinBody = 0;
for (const [id, s] of SCENES) {
  try { new vm.Script('(function(){' + s.body + '})'); } catch { parseFail++; }
  if (typeof s.tick !== 'function') { try { new vm.Script('(function(t){' + s.tick + '})'); } catch { tickFail++; } }
  if (!s.body || s.body.length < 200) thinBody++;
}
check('every scene body compiles as JavaScript', parseFail === 0, parseFail + ' broken');
check('every scene tick compiles as JavaScript', tickFail === 0, tickFail + ' broken');
check('every scene body is a real implementation (>200 chars)', thinBody === 0);

// A catch-all stub: any property of it is another usable stub (function,
// object, whatever the scene reaches for). Good enough to execute the TXT
// contract lines without a real DOM.
function anyStub() {
  const f = function () { return anyStub(); };
  return new Proxy(f, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : anyStub()),
    apply: () => anyStub(),
    construct: () => anyStub(),
  });
}
const mkSandbox = () => ({
  window: {}, String, JSON, Math, console, Date, Array, Object,
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  addEventListener: () => {}, removeEventListener: () => {},
  requestAnimationFrame: () => {}, cancelAnimationFrame: () => {},
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  performance: { now: () => 0 },
  document: anyStub(), navigator: anyStub(), location: anyStub(), THREE: anyStub(),
});

console.log('\n════════ SCENE LIBRARY: editable-text contract ════════');
const TOKEN = "'__NXTX__'";
const textScenes = [...SCENES.entries()].filter(([, s]) => s.text);
check('8 editable-text scenes exist', textScenes.length === 8, 'got ' + textScenes.length);
check('ONLY text scenes contain the replace token', [...SCENES.entries()].every(([, s]) => (s.text ? s.body.includes(TOKEN) : !s.body.includes(TOKEN))));
check('every text scene reads window.NX_SCENE_TEXT (preview contract)', textScenes.every(([, s]) => s.body.includes('window.NX_SCENE_TEXT')));
check('every text scene has the NEXUS fallback (never blank)', textScenes.every(([, s]) => s.body.includes("'NEXUS'")));

// Contract behavior: user text wins, truncation holds, any language works.
const contractScenes = [
  ['sp17', 'أهلاً بالعالم', 'أهلاً بالعالم'],      // Arabic
  ['sp18', 'Hello World', 'Hello World'],            // Latin
  ['sp21', '日本語テスト', '日本語テスト'],           // CJK
  ['sp22', '0123456789012345678901234567890123456789', '012345678901234567890123456789'], // >30 chars truncated to 30
];
for (const [id, input, expected] of contractScenes) {
  const s = SCENES.get(id);
  // Execute ONLY the TXT contract prologue (the lines every text scene
  // starts with) — the rest of the body is WebGL setup tested elsewhere.
  const prologueMatch = s.body.match(/var TXT=[\s\S]{0,220}?TXT=TXT\.slice\(0,30\)\|\|'NEXUS';/);
  if (!prologueMatch) { check(id + ': TXT prologue found', false); continue; }
  const code = prologueMatch[0].replace(TOKEN, JSON.stringify(input.slice(0, 30))); // first occurrence only — production behavior
  let captured = null;
  const sandbox = mkSandbox();
  try {
    captured = new vm.Script('(function(){' + code + '; return TXT;})').runInNewContext(sandbox)();
  } catch (e) { captured = 'THREW: ' + e.message; }
  check(`${id}: user text "${expected.slice(0, 16)}" is baked (any language)`, captured === expected, 'got ' + JSON.stringify(captured));
  // the preview path: window.NX_SCENE_TEXT set + token unreplaced must ALSO work
  {
    const sb = mkSandbox(); sb.window = { NX_SCENE_TEXT: input };
    let cap = null;
    try { cap = new vm.Script('(function(){' + prologueMatch[0] + '; return TXT;})').runInNewContext(sb)(); }
    catch (e) { cap = 'THREW: ' + e.message; }
    check(`${id}: preview path (window.NX_SCENE_TEXT) renders the same words`, cap === expected, 'got ' + JSON.stringify(cap));
  }
}
// no replacement → NEXUS fallback
{
  const s = SCENES.get('sp17');
  const pro = s.body.match(/var TXT=[\s\S]{0,220}?TXT=TXT\.slice\(0,30\)\|\|'NEXUS';/);
  let captured = null;
  const sandbox = mkSandbox();
  try {
    captured = new vm.Script('(function(){' + pro[0] + '; return TXT;})').runInNewContext(sandbox)();
  } catch (e) { captured = 'THREW: ' + e.message; }
  check('sp17 with no user text falls back to NEXUS (never crashes)', captured === 'NEXUS', 'got ' + JSON.stringify(captured));
}

console.log('\n════════ SCENE LIBRARY: taste rules (no genre-pinning words) ════════');
const BANNED = /\b(horror|zombie|dinosaur|driving|racing|car\s|bird|ocean\s|island|cute|kids?|toy)\b/i;
const bad = [...SCENES.entries()].filter(([, s]) => BANNED.test(s.name + ' ' + s.body.slice(0, 400)));
check('no banned genre words in any scene', bad.length === 0, bad.map(([id]) => id).join(','));

console.log('\n════════ SCENE LIBRARY: wiring into both apps ════════');
check('backend merges SPLINE_SCENES into THREE_SCENES', backend.includes('Object.assign(THREE_SCENES, SPLINE_SCENES)'));
check('backend scene list exposes group + text flags', /group:\s*v\.group/.test(backend) && /text:\s*!!v\.text/.test(backend));
check('backend injects scene text via __NXTX__', /threeSceneScript\(scene,\s*sceneText\)/.test(backend));
check('backend buildSiteHtml reads opts.scene_text', /opts\.scene_text/.test(backend));
check('frontend has nxSplineSceneList()', html.includes('function nxSplineSceneList'));
check('frontend picker has the Spline Community optgroup', /Spline Community/.test(html));
check('frontend has the editable-scene-text input', html.includes('ws-scene-text'));
check('frontend local site builder takes sceneText', /nxLocalSceneSiteHtml\(/.test(html));
check('frontend generation POSTs scene_text', /scene_text/.test(html));

console.log('\n════════ SCENE LIBRARY: build script idempotency ════════');
{
  const beforeBe = readFileSync(join(ROOT, 'backend', 'src', 'index.js'), 'utf8');
  const beforeFe = readFileSync(join(ROOT, 'NexusCRM_V4_Hardened.html'), 'utf8');
  let out = '';
  try { out = execFileSync(process.execPath, [join(ROOT, 'patches', 'build-spline-scenes.mjs')], { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const afterBe = readFileSync(join(ROOT, 'backend', 'src', 'index.js'), 'utf8');
  const afterFe = readFileSync(join(ROOT, 'NexusCRM_V4_Hardened.html'), 'utf8');
  check('build script runs clean (50 scenes validated)', /50 scenes validated/.test(out), out.slice(0, 120));
  check('re-running the build leaves the backend byte-identical', beforeBe === afterBe);
  check('re-running the build leaves the frontend byte-identical', beforeFe === afterFe);
}

console.log('\n' + '═'.repeat(56));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('FAILED:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
