// 3D SCENE GALLERY INTEGRITY.
//
// Every scene the gallery advertises must be usable: it must return code, that
// code must COMPILE, and it must carry the metadata the picker renders. A scene
// with a syntax error is invisible in a list but throws the moment a user picks it.
//
// Run: node tests/test_scene_gallery.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const { init, DB } = await import(join(__dirname, 'd1mock.js'));
await init(readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8'));
const worker = (await import(join(ROOT, 'backend', 'src', 'index.js'))).default;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
globalThis.fetch = async () => new Response('x', { status: 200 });

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
let TOK = null;
const call = async (m, p, b) => {
  const h = { 'Content-Type': 'application/json', Origin: 'http://a' };
  if (TOK) h.Authorization = 'Bearer ' + TOK;
  const r = await worker.fetch(new Request('http://t.local/api' + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }), env, ctx);
  return { status: r.status, data: await r.json().catch(() => null) };
};
TOK = (await call('POST', '/auth/register', { email: 'scene@t.co', password: 'Password123!', name: 'S' })).data.token;

const scenes = (await call('GET', '/ai/site-scenes')).data.scenes;
console.log(`\n== Gallery advertises ${scenes.length} scenes ==`);
check('the gallery is non-trivially populated', scenes.length >= 100, String(scenes.length));

console.log('\n== A. Ids and metadata ==');
{
  const ids = scenes.map(s => s.id), names = scenes.map(s => s.name);
  const dupId = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  check('scene ids are unique', dupId.length === 0, dupId.slice(0, 5).join(','));
  const noName = scenes.filter(s => !s.name || !String(s.name).trim()).map(s => s.id);
  const noDesc = scenes.filter(s => !s.desc || !String(s.desc).trim()).map(s => s.id);
  const noTheme = scenes.filter(s => !s.theme || !String(s.theme).trim()).map(s => s.id);
  check('every scene has a name', noName.length === 0, noName.slice(0, 5).join(','));
  // A blank description renders an empty card in the picker.
  check('every scene has a description', noDesc.length === 0, `${noDesc.length} missing: ` + noDesc.slice(0, 6).join(','));
  check('every scene has a theme', noTheme.length === 0, noTheme.slice(0, 5).join(','));
}

console.log('\n== B. Every advertised scene returns COMPILING code ==');
{
  const noCode = [], syntax = [];
  for (const s of scenes) {
    const r = await call('GET', `/ai/site-scenes/${encodeURIComponent(s.id)}/code`);
    if (r.status !== 200 || !r.data) { noCode.push(`${s.id}(HTTP ${r.status})`); continue; }
    const d = r.data;
    if (s.type === 'three') {
      if (!d.body || !String(d.body).trim()) { noCode.push(s.id + '(no body)'); continue; }
      for (const [part, code] of [['body', d.body], ['tick', d.tick || '']]) {
        if (!code) continue;
        try { new Function('THREE', 'scene', 'cam', 'ac', 'a2', 't3', 't', 'renderer', 'document', 'addEventListener', 'innerWidth', 'innerHeight', code); }
        catch (e) { syntax.push(`${s.id}.${part}: ${e.message.slice(0, 50)}`); }
      }
    } else {
      if (!d.fn || !String(d.fn).trim()) { noCode.push(s.id + '(no fn)'); continue; }
      try { new Function('ctx', 'W', 'H', 't', 'C', 'D', 'hex2rgb', 'rot3', 'proj3', 'dot3', 'line3', 'mesh3', String(d.fn)); }
      catch (e) { syntax.push(`${s.id}.fn: ${e.message.slice(0, 50)}`); }
    }
  }
  check('every advertised scene returns usable code', noCode.length === 0, noCode.slice(0, 5).join(','));
  // A syntax error here means the scene throws the instant a user selects it.
  check('every scene body/tick compiles', syntax.length === 0, syntax.slice(0, 5).join(' | '));
}

console.log('\n== C. Scene lookup rejects bogus ids ==');
{
  const unknown = await call('GET', '/ai/site-scenes/__nope__/code');
  check('an unknown scene id returns 404', unknown.status === 404, String(unknown.status));
  const leaked = [];
  for (const bad of ['__proto__', 'constructor', 'prototype', 'toString']) {
    const r = await call('GET', `/ai/site-scenes/${encodeURIComponent(bad)}/code`);
    if (r.status === 200) leaked.push(bad);
  }
  check('prototype keys do not resolve as scenes', leaked.length === 0, leaked.join(','));
}

const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
