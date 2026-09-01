// /ai/build-site MUST USE THE COMPOSITION ENGINE.
//
// This route previously asked the model for a raw HTML document and fell back to a
// single static template, bypassing directions, the composition plan, the hierarchy
// system and the quality loop. It now delegates to the same deterministic pipeline
// as /ai/agentic-build. These tests pin that: if it ever regresses to the generic
// template path, the 5 directions collapse to one structure and this suite fails.
//
// Run: node tests/test_build_site_unified.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const { init, DB } = await import(join(__dirname, 'd1mock.js'));
await init(readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8'));
const worker = (await import(join(ROOT, 'backend', 'src', 'index.js'))).default;
const st = (await import(join(ROOT, 'backend', 'src', 'nx_structured.js'))).default;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
// No AI key is configured here on purpose: the DESIGN FLOOR must not depend on a model.
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
TOK = (await call('POST', '/auth/register', { email: 'bs@t.co', password: 'Password123!', name: 'B' })).data.token;

const DIRS = ['editorial-minimal', 'cinematic-immersive', 'luxury-art', 'bold-experimental', 'swiss-structured'];
const BRIEF = { name: 'Atelier North', description: 'A furniture studio making slow, permanent objects from oak and linen.' };

console.log('\n== A. The route builds through the composition engine ==');
const sigs = {}; const payloads = {};
{
  const bad = [];
  for (const d of DIRS) {
    const r = await call('POST', '/ai/build-site', { ...BRIEF, direction: d, deterministic: true });
    if (r.status !== 200 || !r.data || !r.data.html) { bad.push(`${d}:HTTP ${r.status}`); continue; }
    payloads[d] = r.data;
    sigs[d] = st.nxStructuralSignature(r.data.html);
  }
  check('every direction returns a page', bad.length === 0, bad.join(','));
  check('the response echoes the requested direction', DIRS.every(d => payloads[d] && payloads[d].direction === d),
    DIRS.map(d => payloads[d] && payloads[d].direction).join(','));
  // The static fallback template carried no design rationale at all.
  check('every build carries a design explanation', DIRS.every(d => payloads[d] && String(payloads[d].designExplanation || '').trim().length > 0));
  check('pages are substantial documents', DIRS.every(d => payloads[d].html.length > 8000),
    DIRS.map(d => payloads[d] && payloads[d].html.length).join(','));
}

console.log('\n== B. Directions are render-authoritative here too (not colour-only) ==');
{
  const heroes = DIRS.map(d => sigs[d] && sigs[d].hero);
  const feats = DIRS.map(d => sigs[d] && sigs[d].feature);
  check('directions do not collapse to one hero family', new Set(heroes).size >= 4, heroes.join(','));
  check('directions do not collapse to one feature family', new Set(feats).size >= 3, feats.join(','));

  let min = 1, worst = '';
  for (let i = 0; i < DIRS.length; i++) for (let j = i + 1; j < DIRS.length; j++) {
    const v = st.nxSignatureDistance(sigs[DIRS[i]], sigs[DIRS[j]]);
    if (v < min) { min = v; worst = `${DIRS[i]}↔${DIRS[j]}`; }
  }
  // A colour-only clone scores ~0.08. The generic template path scored 0.
  check('every direction pair is structurally distinct (>0.20)', min > 0.20, `min=${min.toFixed(3)} (${worst})`);
  console.log(`     min pairwise structural distance = ${min.toFixed(3)} (${worst})`);
}

console.log('\n== C. The design floor does not depend on an AI provider ==');
{
  // Rendered with NO model configured. If this route ever falls back to the old
  // static template again, these structural markers disappear.
  const html = payloads['swiss-structured'].html;
  check('output contains a real <main> landmark', /<main[\s>]/.test(html));
  check('output carries composition metadata (data-rhythm)', /data-rhythm=/.test(html));
  check('output carries emphasis metadata', /data-emphasis=/.test(html));
  check('output ships a responsive breakpoint', /@media[^{]*max-width/.test(html));
  check('output respects prefers-reduced-motion', /prefers-reduced-motion/.test(html));
}

console.log('\n== D. Determinism ==');
{
  const a = await call('POST', '/ai/build-site', { ...BRIEF, direction: 'luxury-art', deterministic: true });
  const b = await call('POST', '/ai/build-site', { ...BRIEF, direction: 'luxury-art', deterministic: true });
  const sa = st.nxStructuralSignature(a.data.html), sb = st.nxStructuralSignature(b.data.html);
  check('the same brief + direction yields the same structure', st.nxSignatureDistance(sa, sb) === 0);
}

const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
