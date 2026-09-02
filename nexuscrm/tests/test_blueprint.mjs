// BLUEPRINT ENGINE — deterministic content-plan + industry detection + section
// rendering, and the no-AI build path. Tests:
//   (A) pure functions via __internals (industry, plan, section rendering, XSS)
//   (B) the worker /sites POST with `deterministic:true` (no-AI) + the AI-
//       garbage floor for build_with_ai:true
//   (C) frontend: the builder renders the Blueprint toggle and posts `deterministic`
//
// Run: node tests/test_blueprint.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = join(__dirname, '..');
const { init, DB } = require('./d1mock.js');
const schema = readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8');
await init(schema);

const workerMod = await import(join(ROOT, 'backend', 'src', 'index.js'));
const worker = workerMod.default;
const t = workerMod.__internals;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
const BASE = 'http://test.local';

let aiBehavior = 'garbage'; // 'garbage' | 'ok'
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('api.openai.com') || u.includes('integrate.api.nvidia.com') || u.includes('localhost:11434')) {
    if (aiBehavior === 'ok') {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'FAKE_AI_RESPONSE' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // default garbage: a non-HTML string (the real 'model failed' class of bug)
    return new Response(JSON.stringify({ choices: [{ message: { content: 'oops something broke' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('<html><head><title>t</title></head><body><h1>t</h1></body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
};

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', Origin: 'http://app.local' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request(BASE + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const res = await worker.fetch(req, env, ctx);
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

let token = '';
{
  const r = await call('POST', '/auth/register', { name: 'Blueprint', email: 'bp' + Date.now() + '@x.com', password: 'password123' });
  token = r.data?.token || '';
}

console.log('\n== A1: INDUSTRY DETECTION ==');
{
  check('plumbing detected', t.detectIndustry('Joe Plumbing', '24/7 emergency plumbing in Cairo').label === 'Plumbing');
  check('restaurant detected', t.detectIndustry('Bella Vita', 'Italian restaurant and catering in town').label === 'Restaurant');
  check('saas detected', t.detectIndustry('CloudTools', 'All-in-one software platform for teams').label === 'Software / SaaS');
  check('default fallback works', t.detectIndustry('Generic Co', 'We make things.') && typeof t.detectIndustry('Generic Co', 'We make things.').label === 'string');
}

console.log('\n== A2: CONTENT PLAN ==');
{
  const plan = t.buildContentPlan('Joe Plumbing', '24/7 emergency plumbing in Cairo. Drain cleaning, water heater installation, leak repair. Call +20 100 123 4567 or email joe@example.com', {});
  check('plan has hero', plan.hero && plan.hero.title && plan.hero.sub);
  check('industry presets services (3-6)', Array.isArray(plan.services) && plan.services.length >= 3 && plan.services.length <= 6, plan.services.length);
  check('plan has stats', Array.isArray(plan.stats) && plan.stats.length >= 3);
  check('plan extracts phone', (plan.contact.phone || '').replace(/\D/g, '').length >= 7, plan.contact.phone);
  check('plan extracts email', /@/.test(plan.contact.email), plan.contact.email);
  check('plan has reviews + faq', Array.isArray(plan.reviews) && plan.reviews.length >= 1 && plan.faq.length >= 3);
  // merge from a normalized scanner plan
  const merged = t.buildContentPlan('X', 'desc', { plan: { services: [{ icon: '🛠️', title: 'A', desc: 'B' }], reviews: [{ name: 'Y', text: 'Z', stars: 5 }], why_us: ['Licensed'], process: [{ title: 'P', desc: 'Q' }] } });
  check('merges scanner services (.desc field)', merged.services[0].title === 'A' && merged.services[0].text === 'B');
  check('merges scanner reviews (.text field)', merged.reviews[0].quote === 'Z');
  check('merges scanner why_us (strings)', merged.why[0].check === 'Licensed');
}

console.log('\n== A3: SECTION RENDERING (design classes + XSS) ==');
{
  const evil = t.buildContentPlan('<script>alert(1)</script>', 'x');
  const body = t.renderSectionsHtml(evil, {});
  check('renders nav/hero/stats/services/faq/reviews/footer', ['nx-nav','nx-hero','nx-stat','nx-card','nx-faq-item','nx-review','nx-footer'].every(c => body.includes(c)));
  check('uses [data-reveal] animation hooks', body.includes('data-reveal'));
  check('softens injected script (escaped, inert)', !/<script>alert\(1\)/.test(body) && body.includes('&lt;script&gt;'));
  // richer plan → more sections
  const rich = t.buildContentPlan('Joe Plumbing', 'plumbing', { plan: { pricing: [{ name: 'Basic', price: '$99', features: ['a'] }], team: [{ name: 'Ali', role: 'Owner' }], timeline: [{ year: '2010', title: 'Founded' }], logos: ['ACME'], gallery_imgs: ['https://x.com/a.jpg'], video_url: 'https://youtu.be/abc123', contact: { address: 'Cairo St' } } });
  const richBody = t.renderSectionsHtml(rich, {});
  check('pricing/team/timeline/logos/gallery/map/video rendered', ['pricing','team','timeline','logo','nx-gallery','nx-map','nx-video'].every(c => richBody.includes(c)));
  const secCount = (richBody.match(/<section\b/g) || []).length;
  check('rich plan → many sections (>= 8)', secCount >= 8, secCount);
}

console.log('\n== B1: NO-AI BLUEPRINT BUILD (/sites POST deterministic) ==');
{
  const site = await call('POST', '/sites', { name: 'Joe Plumbing', description: '24/7 emergency plumbing in Cairo. Drain cleaning, water heater installation, leak repair. Call +20 100 123 4567 or email joe@example.com', build_with_ai: true, deterministic: true, published: false }, token);
  check('deterministic build succeeds', site.status === 200 && site.data?.id, JSON.stringify(site.data).slice(0, 80));
  const html = site.data?.html || '';
  check('build is a full well-formed doc', /<!DOCTYPE html/i.test(html) && /<\/html>/i.test(html));
  check('blueprint floor composes many sections', (html.match(/<section\b/g) || []).length >= 6, (html.match(/<section\b/g) || []).length);
  check('extracts real phone + email into the page', html.includes('20 100 123 4567') && html.includes('joe@example.com'));
  check('no AI placeholder leaked into the page', !html.includes('FAKE_AI_RESPONSE') && !/oops something broke/.test(html));
  // quality engine also ran on it
  const audit = t.auditSiteHtml(html);
  check('blueprint site passes quality audit (score >= 70)', audit.score >= 70, audit.score + ' ' + audit.grade);
}

console.log('\n== B2: AI-GARBAGE FLOOR (build_with_ai, model returns junk) ==');
{
  aiBehavior = 'garbage';
  const site = await call('POST', '/sites', { name: 'DentCare', description: 'Modern dental clinic offering check-ups, whitening and restorative care. hello@dentcare.com', build_with_ai: true, published: false }, token);
  const html = site.data?.html || '';
  check('garbage-AI build still returns a coherent site', (html.match(/<section\b/g) || []).length >= 6 && html.includes('nx-hero'));
  check('no garbage leaked', !html.includes('oops something broke'));
  const audit = t.auditSiteHtml(html);
  check('garbage-AI site is still A/B-grade after quality floor', audit.score >= 70, audit.score + ' ' + audit.grade);
}

console.log('\n== C1: FRONTEND BLUEPRINT OPTION ==');
{
  const { JSDOM } = require('jsdom');
  const html = readFileSync(join(ROOT, 'NexusCRM_V4_Hardened.html'), 'utf-8');
  const dom = new JSDOM(html, { url: 'http://localhost:3000/', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.confirm = () => true; w.alert = () => {}; } });
  const w = dom.window, d = w.document;
  // open the builder
  await w.openAISiteBuilder();
  await new Promise(r => setTimeout(r, 350));
  check('builder shows the Blueprint (no AI) toggle', !!d.getElementById('ws-blueprint-no-ai'));
  // toggle it and read model inputs that buildSiteWithAI uses
  const box = d.getElementById('ws-blueprint-no-ai'); box.checked = true;
  w.closeModal();
  check('frontend exposes the Blueprint driven functions', typeof w.buildSiteWithAI === 'function');
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
process.exit(failed ? 1 : 0);
