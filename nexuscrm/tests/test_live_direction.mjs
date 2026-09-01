// LIVE ROUTE: the design direction must be authoritative on the path a real user
// hits (POST /ai/agentic-build), not merely inside the composition unit tests.
// A direction that only changes colour — or that is ignored entirely by the live
// renderer — is a FAILED integration (Cycle 2, §1 "data exists but renderer ignores it").
//
// Run: node tests/test_live_direction.mjs
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
globalThis.fetch = async () => new Response('x', { status: 200 });

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', Origin: 'http://app.local' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await worker.fetch(new Request('http://test.local/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const reg = await call('POST', '/auth/register', { email: 'live@dir.co', password: 'Password123!', name: 'L' });
const token = reg.data.token || reg.data.accessToken;
const DIRS = ['editorial-minimal', 'cinematic-immersive', 'luxury-art', 'bold-experimental', 'swiss-structured'];
const brief = { name: 'Atelier North', description: 'A premium interiors studio making bespoke furniture, lighting and textiles.', deterministic: true };

console.log('\n== LIVE ROUTE renders a direction-authoritative composition ==');
const sigs = {}; const expl = {};
for (const d of DIRS) {
  const r = await call('POST', '/ai/agentic-build', { ...brief, direction: d }, token);
  check(d + ': live route returns a page', r.status === 200 && !!r.data?.html && r.data.html.length > 5000, 'HTTP ' + r.status);
  check(d + ': response echoes the selected direction', r.data?.direction === d, String(r.data?.direction));
  sigs[d] = st.nxStructuralSignature(r.data.html);
  expl[d] = String(r.data.designExplanation || '');
}

console.log('\n== The rendered DOM actually differs per direction (not colour-only) ==');
check('every direction renders a distinct hero family', new Set(DIRS.map(d => sigs[d].hero)).size === DIRS.length, DIRS.map(d => sigs[d].hero).join(','));
// Content-aware selection (§5) may legitimately converge two directions on the
// same feature family for a given brief (e.g. a service-led brief pushes several
// directions toward an enumerated list). What must NOT happen is collapse onto a
// single default, so require real variety rather than strict uniqueness.
check('feature families show real variety across directions (no single default)', new Set(DIRS.map(d => sigs[d].feature)).size >= 3 && !DIRS.some(d => sigs[d].feature === 'generic'), DIRS.map(d => sigs[d].feature).join(','));
check('directions do not all share one section count', new Set(DIRS.map(d => (sigs[d].order || []).length)).size > 1);
let min = 1, worst = '';
for (let i = 0; i < DIRS.length; i++) for (let j = i + 1; j < DIRS.length; j++) {
  const dist = st.nxSignatureDistance(sigs[DIRS[i]], sigs[DIRS[j]]);
  if (dist < min) { min = dist; worst = DIRS[i] + '↔' + DIRS[j]; }
}
check('every pair is structurally distinct on the LIVE route (>0.20)', min > 0.20, 'min=' + min.toFixed(3) + ' @ ' + worst);

console.log('\n== The human-readable rationale matches what was rendered (§24) ==');
let explOk = true; const bad = [];
for (const d of DIRS) {
  // the explanation must name the direction actually rendered, and its hero mode
  if (!expl[d] || !expl[d].includes(sigs[d].hero)) { explOk = false; bad.push(d + ':' + expl[d].split('\n')[0]); }
}
check('explanation names the hero composition actually rendered', explOk, bad.join(' | '));
check('explanations are not all identical', new Set(DIRS.map(d => expl[d])).size === DIRS.length);

const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
