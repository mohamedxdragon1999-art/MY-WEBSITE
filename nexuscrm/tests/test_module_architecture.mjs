// MODULE ARCHITECTURE GUARDS.
//
// Modularisation is only durable if the invariants are enforced. Without this,
// the next edit re-adds a require() or a globalThis export and the monolith
// quietly reassembles itself.
//
// Also pins the two defects this refactor removed:
//   * `typeof require === 'function' ? require('./x.js') : null` fallbacks that
//     are DEAD in an ES module — they always evaluated to null, so resolution
//     silently depended on globalThis alone.
//   * a module-private cache (_encKeyCache) living in the same scope as 407
//     other functions.
//
// Run: node tests/test_module_architecture.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'backend', 'src');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const read = (p) => readFileSync(join(SRC, p), 'utf8');
const MODULES = ['middleware/http.js', 'security/crypto.js', 'validators/input.js'];

console.log('\n== A. Extracted modules exist and are strict ESM ==');
{
  const missing = MODULES.filter((m) => !existsSync(join(SRC, m)));
  check('every extracted module is present', missing.length === 0, missing.join(', '));
  const bad = [];
  for (const m of MODULES) {
    const src = read(m);
    if (!/^export /m.test(src)) bad.push(`${m}: no named exports`);
    // A hybrid module (module.exports / require) is what caused the original
    // ESM breakage — these files must be pure ESM.
    if (/\brequire\s*\(/.test(src)) bad.push(`${m}: uses require()`);
    if (/module\.exports/.test(src)) bad.push(`${m}: uses module.exports`);
    if (/export default/.test(src)) bad.push(`${m}: default export (named only)`);
  }
  check('modules use named ESM exports only, never require()', bad.length === 0, bad.join(' | '));
}

console.log('\n== B. Modules are importable and behave correctly ==');
{
  const http = await import(join(SRC, 'middleware/http.js'));
  const r = http.json({ ok: true }, 201, 'http://x');
  check('json() returns a Response with the right status', r.status === 201);
  check('json() applies the security headers', r.headers.get('x-content-type-options') === 'nosniff');
  check('err() shapes the payload as { error }', (await http.err('nope', 400, 'http://x').json()).error === 'nope');

  const crypto_ = await import(join(SRC, 'security/crypto.js'));
  const h = await crypto_.hashPassword('Password123!');
  check('hashPassword returns a hash and salt', !!(h.hash && h.salt));
  check('verifyPassword accepts the correct password', await crypto_.verifyPassword('Password123!', h.hash, h.salt));
  check('verifyPassword rejects a wrong password', !(await crypto_.verifyPassword('wrong', h.hash, h.salt)));
  check('timingSafeEqual compares correctly', crypto_.timingSafeEqual('abc', 'abc') && !crypto_.timingSafeEqual('abc', 'abd'));
  check('randomToken is URL-safe and unique', /^[A-Za-z0-9_-]+$/.test(crypto_.randomToken()) && crypto_.randomToken() !== crypto_.randomToken());
  // Round-trip through the real AES-GCM path.
  const env = { ENCRYPTION_KEY: 'test-key-material' };
  const ct = await crypto_.encryptSecret(env, 'sk-secret');
  check('encryptSecret produces versioned ciphertext', ct.startsWith('enc:v1:') && !ct.includes('sk-secret'));
  check('decryptSecret round-trips', (await crypto_.decryptSecret(env, ct)) === 'sk-secret');
  check('no ENCRYPTION_KEY degrades to plaintext rather than failing', (await crypto_.encryptSecret({}, 'x')) === 'x');

  const v = await import(join(SRC, 'validators/input.js'));
  check('isValidEmail accepts a real address', v.isValidEmail('a@b.co'));
  check('isValidEmail rejects junk and over-long input', !v.isValidEmail('nope') && !v.isValidEmail('a'.repeat(250) + '@b.co'));
  check('sanitizeCustomFields caps and stringifies', JSON.parse(v.sanitizeCustomFields({ k: 'x'.repeat(900) })).k.length === 500);
  check('sanitizeCustomFields rejects non-objects', v.sanitizeCustomFields(['a']) === '{}');
  check('parseCustomFields never throws on bad JSON', JSON.stringify(v.parseCustomFields('{oops')) === '{}');
}

console.log('\n== C. The worker no longer carries dead require() fallbacks ==');
{
  const idx = read('index.js');
  // `require` is undefined in an ES module, so any such branch is unreachable.
  // One guarded call remains for nx_template (which genuinely lives outside
  // backend/src and cannot be bundled) and is documented as CJS-host-only.
  // Count only EXECUTABLE occurrences — a comment explaining why the pattern is
  // wrong must not itself trip the guard.
  const guards = idx.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n').split("typeof require === 'function'").length - 1;
  check('at most the one documented require() guard remains', guards <= 1, `${guards} found`);
  if (guards === 1) {
    // Locate the executable line, not the comment that discusses the pattern.
    const line = idx.split('\n').find((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && l.includes("typeof require === 'function'")) || '';
    check('the remaining guard is the documented nx_template case', /nx_template/.test(line), line.trim().slice(0, 70));
  }
  check('extracted helpers are no longer defined in index.js',
    !/^function corsHeaders\(/m.test(idx) && !/^async function hashPassword\(/m.test(idx) && !/^function sanitizeCustomFields\(/m.test(idx));
  check('extracted state no longer lives in index.js', !/_encKeyCache/.test(idx));
  check('index.js imports the extracted modules', /middleware\/http\.js/.test(idx) && /security\/crypto\.js/.test(idx) && /validators\/input\.js/.test(idx));
}

console.log('\n== D. Modules do not leak internals globally ==');
{
  const bad = [];
  for (const m of MODULES) {
    const src = read(m);
    // Publishing onto globalThis is how the original file created implicit
    // coupling; extracted modules must communicate only through exports.
    if (/globalThis\s*\.\s*\w+\s*=/.test(src) || /globalThis\[/.test(src)) bad.push(`${m}: writes to globalThis`);
    if (/^\s*window\.\w+\s*=/m.test(src)) bad.push(`${m}: writes to window`);
  }
  check('no extracted module publishes to globalThis or window', bad.length === 0, bad.join(' | '));
  // getEncryptionKey is deliberately NOT exported — the cache stays private.
  const crypto_ = await import(join(SRC, 'security/crypto.js'));
  check('the encryption key cache is not reachable from outside', crypto_.getEncryptionKey === undefined);
}

console.log('\n== E. The monolith is measurably smaller ==');
{
  const lines = read('index.js').split('\n').length;
  check('index.js is below its pre-refactor size', lines < 11918, `${lines} lines (was 11918)`);
  const extracted = MODULES.reduce((n, m) => n + read(m).split('\n').length, 0);
  console.log(`     index.js ${lines} lines · extracted modules ${extracted} lines across ${MODULES.length} files`);
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
