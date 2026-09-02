// PROPERTY-BASED FUZZING + MEMORY BOUNDS.
//
// Every other suite uses hand-picked fixtures, which can only find bugs someone
// already imagined. This one asserts INVARIANTS that must hold for ANY plan and
// then generates hundreds of randomised plans to attack them.
//
// It earned its place immediately: the first run found a dead `#work` anchor on
// every direction (the hero's secondary CTA hardcoded a target that is PRUNED
// when a brief has no projects — a silently broken button on every
// project-less site), and the harness OOM revealed that the validation gate
// leaked ~1.4MB per call.
//
// Seeds are deterministic, so any failure reported here is reproducible by
// re-running with the same seed.
//
// Run: node tests/test_property_fuzz.mjs
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
const DIRS = Object.keys(nx.NX_COMPOSE_DIRECTIONS);
const N = Number(process.env.NX_FUZZ_N || 200);

// Deterministic PRNG — a failing seed can be replayed exactly.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const WORDS = ['groundworks', 'atelier', 'studio', 'civil', 'drainage', 'north', 'forge', 'lumen', 'vertex', 'quiet', 'bold', 'stone', 'river', 'iron', 'clay', 'muse', 'apex', 'harbor', 'field', 'craft'];
function makePlan(seed) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const words = (n) => Array.from({ length: 1 + Math.floor(r() * n) }, () => pick(WORDS)).join(' ');
  const maybe = (p, v) => (r() < p ? v : undefined);
  const arr = (n, f) => Array.from({ length: Math.floor(r() * n) }, (_, i) => f(i));
  return {
    site_name: maybe(0.9, words(3)), hero_headline: maybe(0.85, words(8)),
    hero_sub: maybe(0.7, words(20)), description: maybe(0.5, words(30)),
    services: maybe(0.8, arr(9, () => ({ title: words(4), desc: maybe(0.8, words(15)) }))),
    projects: maybe(0.6, arr(7, () => ({ title: words(3), cat: maybe(0.7, words(2)) }))),
    reviews: maybe(0.6, arr(5, () => ({ text: words(18), name: words(2), role: maybe(0.6, words(2)) }))),
    stats: maybe(0.5, arr(5, () => ({ value: String(Math.floor(r() * 9999)), label: words(2) }))),
    faqs: maybe(0.4, arr(6, () => ({ q: words(6) + '?', a: words(20) }))),
    why: maybe(0.4, arr(6, () => words(3))),
    contact: maybe(0.7, { email: maybe(0.8, 'a@b.co'), phone: maybe(0.5, '+44 1234 567890') }),
  };
}

console.log(`\n== Fuzzing ${N} randomised plans across ${DIRS.length} directions ==`);
const found = { crash: [], nondet: [], blocking: [], outline: [], leak: [], link: [], identity: [] };
for (let seed = 1; seed <= N; seed++) {
  const plan = makePlan(seed);
  const dir = DIRS[seed % DIRS.length];
  let html;
  try { html = nx.nxCompose(plan, { direction: dir }).html; }
  catch (e) { found.crash.push(`seed=${seed} ${dir}: ${e.message.slice(0, 50)}`); continue; }

  // Determinism — the same brief must always produce the same site.
  if (nx.nxCompose(plan, { direction: dir }).html !== html) found.nondet.push(`seed=${seed} ${dir}`);

  let r;
  try { r = V.nxValidatePage(html); }
  catch (e) { found.crash.push(`seed=${seed} validator: ${e.message.slice(0, 40)}`); continue; }
  if (!r.pass) found.blocking.push(`seed=${seed} ${dir}: ${r.blocking.slice(0, 2).map(b => b.rule).join(',')}`);

  const doc = parseHTML(html).document;
  if (doc.querySelectorAll('h1').length !== 1) found.outline.push(`seed=${seed} ${dir}: ${doc.querySelectorAll('h1').length} h1`);
  if (doc.querySelectorAll('main').length !== 1) found.outline.push(`seed=${seed} ${dir}: main count`);

  const clone = doc.body.cloneNode(true);
  clone.querySelectorAll('script,style').forEach((n) => n.remove());
  const text = clone.textContent;
  for (const bad of ['undefined', '[object Object]', 'NaN', '${']) {
    if (text.includes(bad)) found.leak.push(`seed=${seed} ${dir}: "${bad}"`);
  }

  // Every in-page anchor must resolve. This is what caught the dead #work CTA.
  for (const a of doc.querySelectorAll('a[href^="#"]')) {
    const h = a.getAttribute('href');
    if (h.length > 1 && !doc.querySelector(h)) found.link.push(`seed=${seed} ${dir}: ${h}`);
  }
  if (!html.includes(`data-dir="${dir}"`)) found.identity.push(`seed=${seed} ${dir}`);
}

check('no plan crashes the composer or the validator', found.crash.length === 0, found.crash.slice(0, 3).join(' | '));
check('generation is deterministic for every plan', found.nondet.length === 0, found.nondet.slice(0, 3).join(' | '));
check('every generated page clears the blocking gate', found.blocking.length === 0, found.blocking.slice(0, 3).join(' | '));
check('every page has exactly one h1 and one main', found.outline.length === 0, found.outline.slice(0, 3).join(' | '));
check('no engine internals leak into visible copy', found.leak.length === 0, found.leak.slice(0, 3).join(' | '));
check('no in-page anchor is ever dead', found.link.length === 0, found.link.slice(0, 4).join(' | '));
check('direction identity survives any content', found.identity.length === 0, found.identity.slice(0, 3).join(' | '));

console.log('\n== Targeted regression: the dead-anchor class ==');
{
  // Minimal repro of the fuzz finding, kept as a permanent fixture.
  const noProjects = { site_name: 'A', hero_headline: 'H', services: [{ title: 's', desc: 'd' }] };
  const dead = [];
  for (const d of DIRS) {
    const doc = parseHTML(nx.nxCompose(noProjects, { direction: d }).html).document;
    for (const a of doc.querySelectorAll('a[href^="#"]')) {
      const h = a.getAttribute('href');
      if (h.length > 1 && !doc.querySelector(h)) dead.push(`${d}: ${h}`);
    }
  }
  check('a brief with no projects produces no dead links', dead.length === 0, dead.join(', '));
  // And the CTA must still appear when the target genuinely exists.
  const withWork = parseHTML(nx.nxCompose({ site_name: 'A', hero_headline: 'H', projects: [{ title: 'P', cat: 'C' }] }, { direction: 'luxury-art' }).html).document;
  check('the secondary CTA is kept when its target exists', !!withWork.querySelector('.c-hero a[href="#work"]'));
}

console.log('\n== Memory: the gate must not leak (it runs on every generation) ==');
{
  // jsdom retained ~1.4MB per document even after window.close(), so repeated
  // validation grew unboundedly (600 calls => ~591MB). linkedom stays flat.
  const html = nx.nxCompose({ site_name: 'A', hero_headline: 'H', services: [{ title: 's', desc: 'd' }] }, { direction: 'luxury-art' }).html;
  for (let i = 0; i < 30; i++) V.nxValidatePage(html);   // warm up
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 120; i++) V.nxValidatePage(html);
  if (global.gc) global.gc();
  const grewMB = (process.memoryUsage().heapUsed - before) / 1048576;
  // Generous bound: without a fix this grows >100MB over the same 120 calls.
  check('120 validations do not grow the heap unboundedly', grewMB < 40, `${grewMB.toFixed(1)}MB`);
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
