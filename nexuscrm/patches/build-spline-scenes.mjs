// Injects the 50 Spline Community scenes into backend/src/index.js and
// NexusCRM_V4_Hardened.html. Idempotent: re-running replaces the previous
// injection. Validates every scene before writing anything.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = require(join(ROOT, 'patches', 'spline-scenes.src.mjs'));

const scenes = SRC.default || SRC;
const ids = Object.keys(scenes);
const errors = [];
if (ids.length !== 50) errors.push(`expected 50 scenes, found ${ids.length}`);
const seenNames = new Set();
for (const id of ids) {
  const s = scenes[id];
  if (!/^sp\d+$/.test(id)) errors.push(`${id}: id must be sp<number>`);
  if (!s.name || typeof s.name !== 'string') errors.push(`${id}: missing name`);
  if (seenNames.has(s.name)) errors.push(`${id}: duplicate name "${s.name}"`);
  seenNames.add(s.name);
  if (!s.theme) errors.push(`${id}: missing theme`);
  if (!s.body || !s.tick) errors.push(`${id}: missing body/tick`);
  // Syntax-check the scene code (vars like THREE/scene/cam are free).
  try { new Function('THREE','scene','cam','renderer','host','ac','a2','t3','t','MX','MY', s.body); }
  catch (e) { errors.push(`${id}: body syntax error — ${e.message}`); }
  try { new Function('t', s.tick); }
  catch (e) { errors.push(`${id}: tick syntax error — ${e.message}`); }
  // text scenes must read the scene text token so words are editable
  if (s.text && !s.body.includes("__NXTX__")) errors.push(`${id}: text scene must include the __NXTX__ default token`);
  if (!s.text && s.body.includes("__NXTX__")) errors.push(`${id}: non-text scene must NOT include __NXTX__`);
  // scenes must not hardcode genre words (owner's standing rule: pure scenes)
  const banned = /\b(business|crm|marketing|restaurant|gym|real estate|fashion)\b/i;
  if (banned.test(s.name + (s.desc||''))) errors.push(`${id}: genre-pinning wording not allowed in scenes`);
}
if (errors.length) { console.error('❌ scene validation failed:\n' + errors.map(e=>'  - '+e).join('\n')); process.exit(1); }
const textCount = ids.filter(i => scenes[i].text).length;
console.log(`✓ ${ids.length} scenes validated (${textCount} editable-text scenes)`);

const LITERAL = 'const SPLINE_SCENES = ' + JSON.stringify(scenes) + ';';
const BACKEND_BLOCK = `
// ════════════════════════════════════════════════════════════
// SPLINE COMMUNITY SCENES — 50 professional WebGL scenes rebuilt
// from the owner-approved Spline community collections (particles,
// liquid glass, liquid-gold typography, reactive orbs, cloner
// boxes, scroll floaters, retrofuturism, web3 cores, holo earth).
// text:true scenes render window.NX_SCENE_TEXT (owner-editable
// words, any language) with the same animation. Maintained in
// patches/spline-scenes.src.mjs — rebuild with
// node patches/build-spline-scenes.mjs
// __NX_SPLINE_SCENES__
${LITERAL}
Object.assign(THREE_SCENES, SPLINE_SCENES);
`;

const BEG = '// __NX_SPLINE_SCENES__';
const ASSIGN = 'Object.assign(THREE_SCENES, SPLINE_SCENES);';
function stripPrev(txt) {
  const i = txt.indexOf(BEG);
  if (i === -1) return txt;
  // remove from the comment banner start (the line before BEG) to the assign end,
  // NORMALIZING surrounding blank lines so repeated rebuilds are byte-identical
  // (an earlier version leaked 3 blank lines per run and broke idempotency).
  const bannerStart = txt.lastIndexOf('// ════', i);
  const assignEnd = txt.indexOf(ASSIGN, i);
  if (bannerStart === -1 || assignEnd === -1) return txt;
  let start = bannerStart;
  while (start > 0 && (txt[start - 1] === '\n' || txt[start - 1] === ' ')) start--;
  let end = assignEnd + ASSIGN.length;
  while (end < txt.length && (txt[end] === '\n' || txt[end] === ' ')) end++;
  return txt.slice(0, start) + '\n' + txt.slice(end);
}

// ── backend injection ──
const bePath = join(ROOT, 'backend', 'src', 'index.js');
let be = readFileSync(bePath, 'utf8');
// Idempotent: the worker may still have the ORIGINAL one-argument signature
// (fresh repo) or the already-upgraded two-argument one (sceneText support).
const beUpgraded = be.includes('function threeSceneScript(scene, sceneText)');
if (!beUpgraded && !be.includes('function threeSceneScript(scene)')) { console.error('❌ backend anchor missing'); process.exit(1); }
be = stripPrev(be);
if (beUpgraded) {
  // already upgraded — just re-inject the scene block before the function
  be = be.replace('function threeSceneScript(scene, sceneText)', BACKEND_BLOCK + '\nfunction threeSceneScript(scene, sceneText)');
} else {
  be = be.replace('function threeSceneScript(scene)', BACKEND_BLOCK + '\nfunction threeSceneScript(scene)');
  // threeSceneScript gains an optional scene text (editable words baked at build time)
  be = be.replace(
    'function threeSceneScript(scene){return THREE_BOOT_HEAD.replace(\'/*BODY*/\',scene.body).replace(\'/*TICK*/\',scene.tick);}',
    `function threeSceneScript(scene, sceneText){
  // Text scenes bake the owner's words in at build time (window.NX_SCENE_TEXT
  // wins at runtime if a host page sets it — the words stay editable).
  let body = scene.body;
  if (scene.text) body = body.replace("'__NXTX__'", JSON.stringify(String(sceneText || '').slice(0, 40)));
  return THREE_BOOT_HEAD.replace('/*BODY*/', body).replace('/*TICK*/', scene.tick);
}`
  );
}
// scene list route: expose group + text flags so the builder can group/label them
be = be.replace(
  "const list = Object.entries(SITE_SCENES).map(([id, v]) => ({ id, name: v.name, theme: v.theme, desc: v.desc, type: isThreeScene(id) ? 'three' : 'canvas' }));",
  "const list = Object.entries(SITE_SCENES).map(([id, v]) => ({ id, name: v.name, theme: v.theme, desc: v.desc, type: isThreeScene(id) ? 'three' : 'canvas', group: v.group || '', text: !!v.text }));"
);
writeFileSync(bePath, be);
console.log('✓ backend/src/index.js: 50 scenes injected (THREE_SCENES + list route + text support)');

// ── frontend injection ──
const fePath = join(ROOT, 'NexusCRM_V4_Hardened.html');
let fe = readFileSync(fePath, 'utf8');
// The FE block MUST be injected at TOP LEVEL. It was originally placed inside
// the local-API handler function — which scoped SPLINE_SCENES to that
// function and crashed the gallery with "SPLINE_SCENES is not defined".
// The gallery family map is a stable top-level anchor.
const FE_ANCHOR = "const NX_SCENE_FAMILIES = [";
if (!fe.includes(FE_ANCHOR)) { console.error('❌ frontend anchor missing'); process.exit(1); }
// strip previous injection (between markers) if present
fe = fe.replace(/\/\/ __NX_SPLINE_SCENES_FE__[\s\S]*?\/\/ __NX_SPLINE_SCENES_FE_END__\n?/, '');
const FE_BLOCK = `// __NX_SPLINE_SCENES_FE__
// SPLINE COMMUNITY SCENES (local copy — mirrors backend/src/index.js so the
// scene picker, live preview AND local site generation all work with zero
// backend deployed). Maintained in patches/spline-scenes.src.mjs.
${LITERAL}
function nxSplineSceneList(){ return Object.entries(SPLINE_SCENES).map(function(kv){ return { id: kv[0], name: kv[1].name, theme: kv[1].theme, desc: kv[1].desc, type: 'three', group: 'spline', text: !!kv[1].text }; }); }
// __NX_SPLINE_SCENES_FE_END__
`;
fe = fe.replace(FE_ANCHOR, FE_BLOCK + FE_ANCHOR);
// 1) include them in the local scene list
fe = fe.replace(
  'return { scenes: [...canvas, ...three] };',
  'return { scenes: [...canvas, ...three, ...nxSplineSceneList()] };'
);
// 2) scene code route: serve the local copy instead of throwing
fe = fe.replace(
  `if (root === 'ai' && parts[1] === 'site-scenes' && parts[2] === 'code' && parts[3] && method === 'GET') {
    throw new Error('Scene preview needs the deployed backend (scene code lives server-side).');
  }`,
  `if (root === 'ai' && parts[1] === 'site-scenes' && parts[2] === 'code' && parts[3] && method === 'GET') {
    // Local copies of the 50 Spline Community scenes are embedded above, so
    // the live preview works with NO backend deployed. Older backend-only
    // scenes still need the deployed backend — say so honestly.
    const local = SPLINE_SCENES[parts[3]];
    if (local) return { type: 'three', body: local.body, tick: local.tick, text: !!local.text };
    throw new Error('This scene\'s code lives on the deployed backend — deploy it (Settings → System) or pick one of the 50 🌀 Spline Community scenes for a local preview.');
  }`
);
writeFileSync(fePath, fe);
console.log('✓ NexusCRM_V4_Hardened.html: local scene library + list + code route injected');
console.log('\nDone. Now wire the picker/preview/generation (see edits) and run tests.');
