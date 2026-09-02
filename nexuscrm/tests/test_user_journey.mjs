// THE JOURNEY TEST — what a real person actually does, end to end.
//
// Every other suite tests a LAYER. This one performs the sequence a user
// performs — sign up, generate, save, read back, publish, visit the public URL,
// edit, snapshot, restore — and inspects the artefact they would really receive.
//
// It earned its place immediately. 65 suites were green while PUBLISHING WAS
// COMPLETELY BROKEN: sites carried `published` and `slug` columns and the UI had
// a Publish button, but no route ever served them, so every published site
// returned 401 to visitors. No layer test could see it, because no layer was
// wrong — the seam between them was missing entirely.
//
// Run: node tests/test_user_journey.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const { parseHTML } = require('linkedom');
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
const api = async (m, p, b) => {
  const h = { 'Content-Type': 'application/json', Origin: 'http://app.local' };
  if (TOK) h.Authorization = 'Bearer ' + TOK;
  const r = await worker.fetch(new Request('http://t.local/api' + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }), env, ctx);
  return { status: r.status, data: await r.json().catch(() => null) };
};
// A visitor: no credentials, no /api prefix.
const visit = async (p) => {
  const r = await worker.fetch(new Request('http://t.local' + p), env, ctx);
  return { status: r.status, body: await r.text(), headers: r.headers };
};

console.log('\n== 1. Sign up and generate a site ==');
const reg = await api('POST', '/auth/register', { email: 'real@user.co', password: 'Password123!', name: 'Real User' });
check('a new user can register', reg.status === 200, String(reg.status));
TOK = reg.data && reg.data.token;
const BRIEF = { name: 'Northgate Civil', description: 'A civil engineering and groundworks contractor handling drainage, excavation and surfacing for commercial sites.', direction: 'signal-industrial', deterministic: true };
const build = await api('POST', '/ai/build-site', BRIEF);
check('the builder returns a site', build.status === 200 && !!(build.data && build.data.html), String(build.status));
const html = (build.data && build.data.html) || '';
check('the build passes its own validation gate', !!(build.data && build.data.validation && build.data.validation.pass),
  build.data && build.data.validation ? JSON.stringify(build.data.validation.blocking.slice(0, 2)) : 'no report');

console.log('\n== 2. Save it, and get back exactly what was built ==');
const saved = await api('POST', '/sites', { name: 'Northgate Civil', html, published: false });
check('the site saves', saved.status === 200, String(saved.status));
const id = saved.data && saved.data.id;
const back = await api('GET', `/sites/${id}`);
check('the saved site can be read back', back.status === 200, String(back.status));
// Storage must not mutate the artefact — a silent truncation here would be
// invisible until a user looked at their live page.
check('stored html is byte-identical to what was built', back.data && back.data.html === html,
  back.data ? `${(back.data.html || '').length} vs ${html.length} bytes` : 'no data');

console.log('\n== 3. A draft is private ==');
const slug = back.data && back.data.slug;
check('the site has a public slug', !!slug, String(slug));
{
  const v = await visit('/s/' + slug);
  check('an unpublished draft is not served', v.status === 404, String(v.status));
  check('an unpublished draft leaks no content', !v.body.includes('Northgate'), 'draft content exposed');
}

console.log('\n== 4. Publish — and a visitor can actually see it ==');
const pub = await api('PATCH', `/sites/${id}`, { published: true });
check('publishing succeeds', pub.status === 200, String(pub.status));
const live = await visit('/s/' + slug);
// This is the check that was missing: 65 green suites, and publishing served 401.
check('a visitor with no account can load the published page', live.status === 200, `HTTP ${live.status}`);
check('the page is served as HTML', /text\/html/i.test(live.headers.get('content-type') || ''), live.headers.get('content-type') || '');
check('the visitor receives the site that was built', live.body === html, `${live.body.length} vs ${html.length} bytes`);
check('the response sets nosniff', (live.headers.get('x-content-type-options') || '') === 'nosniff');

console.log('\n== 5. The served page is actually usable ==');
{
  const doc = parseHTML(live.body).document;
  check('exactly one h1 on the live page', doc.querySelectorAll('h1').length === 1, String(doc.querySelectorAll('h1').length));
  check('the live page has a main landmark', !!doc.querySelector('main'));
  check('the live page has a non-empty title', !!(doc.querySelector('title') && doc.querySelector('title').textContent.trim()));
  check('the live page has a meta description', !!doc.querySelector('meta[name="description"][content]:not([content=""])'));
  const dead = [...doc.querySelectorAll('a[href^="#"]')]
    .filter((a) => a.getAttribute('href').length > 1 && !doc.querySelector(a.getAttribute('href')));
  check('no dead in-page links for a visitor', dead.length === 0, dead.map((a) => a.getAttribute('href')).join(','));
  check('no raw data: URI rendered as visible text', !/>data:image/.test(live.body));
  const noAlt = [...doc.querySelectorAll('img')].filter((i) => i.getAttribute('alt') === null);
  check('every image on the live page has an alt attribute', noAlt.length === 0, String(noAlt.length));
}

console.log('\n== 6. Unpublishing revokes access ==');
{
  await api('PATCH', `/sites/${id}`, { published: false });
  const v = await visit('/s/' + slug);
  check('an unpublished site stops being served', v.status === 404, String(v.status));
  check('unpublishing leaks no content', !v.body.includes('Northgate'));
  await api('PATCH', `/sites/${id}`, { published: true });
}

console.log('\n== 7. Bad public paths are rejected safely ==');
{
  const bad = [];
  for (const p of ['/s/nonexistent-slug', '/s/../../etc/passwd', '/s/%2e%2e%2f', '/s/a']) {
    const v = await visit(p);
    if (v.status === 200) bad.push(`${p} -> 200`);
    if (/root:|SELECT|sqlite/i.test(v.body)) bad.push(`${p} leaked internals`);
  }
  check('no bogus public path returns content', bad.length === 0, bad.join(' | '));
}

console.log('\n== 8. Editing works and persists ==');
{
  const edited = html.replace('</main>', '<section id="extra"><h2>Note</h2><p>Hand-edited.</p></section></main>');
  const up = await api('PATCH', `/sites/${id}`, { html: edited });
  check('a hand edit is accepted', up.status === 200, String(up.status));
  const after = await api('GET', `/sites/${id}`);
  check('the edit persists exactly', after.data && after.data.html === edited);
  const v = await visit('/s/' + slug);
  check('the edit is visible to visitors', v.body.includes('Hand-edited.'));
}

console.log('\n== 9. Snapshot and restore protect the user\'s work ==');
{
  const snap = await api('POST', `/sites/${id}/snapshots`, { label: 'before-disaster' });
  check('a snapshot can be taken', snap.status === 200, String(snap.status));
  await api('PATCH', `/sites/${id}`, { html: '<html><body>destroyed</body></html>' });
  const snaps = await api('GET', `/sites/${id}/snapshots`);
  const vid = snaps.data && snaps.data.snapshots && snaps.data.snapshots[0] && snaps.data.snapshots[0].id;
  check('the snapshot is listed', !!vid, JSON.stringify(snaps.data && snaps.data.snapshots));
  if (vid) {
    const rest = await api('POST', `/sites/${id}/snapshots/${vid}/restore`, {});
    check('the snapshot restores', rest.status === 200, String(rest.status));
    const now = await api('GET', `/sites/${id}`);
    check('destroyed content is recovered', !!(now.data && !/destroyed/.test(now.data.html || '')));
  }
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
