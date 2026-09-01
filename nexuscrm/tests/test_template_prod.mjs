// NexusCRM — production-path REFERENCE TEMPLATE design integration.
// Verifies that design_id:'template' routes through generateSiteHtml to the
// template library (byte-identical design shell, words from the user's plan),
// the design registry exposes it, and the default design is untouched.
//
// Run: node tests/test_template_prod.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { init, DB } = require('./d1mock.js');
const schema = readFileSync(join(__dirname, '..', 'backend', 'schema.sql'), 'utf8');
await init(schema);

const worker = (await import(join(__dirname, '..', 'backend', 'src', 'index.js'))).default;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => { }) };
const BASE = 'http://test.local';

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', Origin: 'http://app.local' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request(BASE + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const res = await worker.fetch(req, env, ctx);
  let data = null;
  try { data = await res.json(); } catch { }
  return { status: res.status, data };
}

console.log('\n== AUTH ==');
let token;
{
  const r = await call('POST', '/auth/register', { name: 'P', email: 'pd@example.com', password: 'password123' });
  check('register returns token', r.status === 200 && !!r.data?.token, (r.data?.error || '').slice(0, 80));
  token = r.data.token;
}

console.log('\n== DESIGN REGISTRY ==');
{
  const r = await call('GET', '/ai/site-designs', null, token);
  const ids = (r.data.designs || []).map(d => d.id);
  check('template design listed', ids.includes('template'), ids.join(','));
  check('sentinel still listed', ids.includes('sentinel'));
}

console.log('\n== BUILD SITE WITH design_id: template (deterministic) ==');
let html;
{
  const r = await call('POST', '/sites', {
    name: 'Aurelia Hydro', build_with_ai: true, deterministic: true, design_id: 'template',
    description: 'Water treatment, soakaways and groundworks across Hertfordshire.',
    plan: {
      site_name: 'Aurelia Hydro', phone: '01707 220 114', email: 'hello@aureliahydro.co.uk',
      hero_headline: 'Crafted in Trust.', hero_sub: 'Design, install and maintenance of packaged treatment plants.',
      cta_primary: 'Get a Free Quote',
      services: [
        { title: 'Water Treatment', desc: 'Packaged treatment plant design & install.' },
        { title: 'Soakaway Design', desc: 'Percolation tests and drainage fields.' },
        { title: 'Groundworks', desc: 'Excavation and reinstatement.' },
      ],
      why_us: ['EA compliant design', 'Fixed all-inclusive pricing', '24/7 emergency callouts'],
      process: [{ title: 'Survey', desc: 'Free on-site assessment.' }, { title: 'Design', desc: 'System sizing.' }, { title: 'Install', desc: 'Excavate & build.' }, { title: 'Certify', desc: 'Building control sign-off.' }],
      faqs: [{ q: 'Do you cover my area?', a: 'Yes — everywhere in Hertfordshire.' }],
      contact: { phone: '01707 220 114', email: 'hello@aureliahydro.co.uk', address: 'Aurelia HQ, Hertford, Herts, SG14' },
    },
    published: false,
  }, token);
  check('site built ok', r.status === 200 && !!r.data?.html, (r.data?.error || '').slice(0, 120));
  html = String(r.data?.html || '');
  check('large document produced', html.length > 100000, 'len=' + html.length);
  check('template design shell (wrap, no nx-hero)', /class="wrap"/.test(html) && !/class="nx-hero"/.test(html));
  // The hero headline is split across the template's signature 3-line build.
  for (const w of ['Crafted', 'in', 'Trust.', 'Aurelia Hydro']) {
    check('words sampled: ' + w, html.includes(w));
  }
  check('phone flows into runtime config', html.includes('01707 220 114'));
  check('email flows into runtime config', html.includes('hello@aureliahydro.co.uk'));
  check('21-blade sections present', /#services/.test(html) && /#why/.test(html) && /#about/.test(html) && /#gallery/.test(html) && /#projects/.test(html) && /#reviews/.test(html) && /#faq/.test(html) && /#contact/.test(html));
  check('template palette bg', html.includes('--bg:#060912'));
  check('template accent FF5F00', html.includes('--accent:#FF5F00'));
  check('doctype + lang', /<!DOCTYPE html>/.test(html) && /<html lang="en">/.test(html));
  check('runtime config merged (guard)', html.includes('Object.assign(DEFAULT_CFG'));
}

console.log('\n== DEFAULT DESIGN (sentinel) UNCHANGED ==');
{
  const r = await call('POST', '/sites', { name: 'Default Co', build_with_ai: true, deterministic: true, published: false }, token);
  const h = String(r.data?.html || '');
  check('default still nx-hero', /class="nx-hero"/.test(h), (r.data?.error || '').slice(0, 80));
  check('default is not template', !/class="wrap"/.test(h));
}

console.log(`\n═══ RESULTS: ${passed} passed, ${failed} failed ═══`);
if (failed) { console.log('FAILURES:\n' + failures.map(f => '  • ' + f).join('\n')); process.exit(1); }
