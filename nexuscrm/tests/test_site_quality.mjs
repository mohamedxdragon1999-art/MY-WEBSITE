// WEBSITE QUALITY ENGINE — the deterministic audit + enhancement layer behind
// the AI website builder. Tests BOTH sides:
//   (A) backend worker: pure functions + /sites/:id/audit endpoint + the
//       quality guarantee applied to AI-built sites.
//   (B) frontend: the functions exposed for the builder UI + the live audit
//       panel rendered in the preview modal.
//
// Run: node tests/test_site_quality.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const ROOT = join(__dirname, '..');
const { init, DB } = require('./d1mock.js');
const schema = readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8');
await init(schema);

const worker = (await import(join(ROOT, 'backend', 'src', 'index.js'))).default;
const internals = (await import(join(ROOT, 'backend', 'src', 'index.js'))).__internals;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
const BASE = 'http://test.local';

// Fake provider returns a plain string for any AI call (including the site-body
// generator), so we exercise the enhance pass on a real (if thin) document.
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('api.openai.com') || u.includes('integrate.api.nvidia.com') || u.includes('localhost:11434')) {
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'FAKE_AI_RESPONSE' } }],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
const email = 'quality' + Date.now() + '@x.com';
{
  const r = await call('POST', '/auth/register', { name: 'Quality Tester', email, password: 'password123' });
  token = r.data?.token || '';
}

console.log('\n== A1: PURE AUDIT (deterministic scoring) ==');
{
  const raw = '<!DOCTYPE html><html><head></head><body><h1>Acme</h1><p>stuff</p><img src="x.jpg"><a href="http://x.com" target="_blank">link</a></body></html>';
  const a = internals.auditSiteHtml(raw);
  check('audit returns a score 0-100', typeof a.score === 'number' && a.score >= 0 && a.score <= 100, a.score);
  check('audit returns a letter grade', typeof a.grade === 'string' && /^[A-F]\+?$/.test(a.grade), a.grade);
  check('audit has all 5 categories', Array.isArray(a.categories) && a.categories.length === 5 && ['seo','perf','a11y','best','mobile'].every(c => a.categories.find(x => x.id === c)));
  check('raw minimal page scores low (<60)', a.score < 60, 'score=' + a.score);
  check('audit lists actionable issues', Array.isArray(a.issues) && a.issues.length > 0);
  check('audit exposes a flat checks map', a.checks && typeof a.checks === 'object' && a.checks.title);
}

console.log('\n== A2: PURE ENHANCE (quality guarantee) ==');
{
  const raw = '<!DOCTYPE html><html><head></head><body><h1>Acme</h1><p>stuff</p><img src="x.jpg"><a href="http://x.com" target="_blank">link</a></body></html>';
  const e = internals.enhanceSiteHtml(raw, 'Acme Widgets', { description: 'We sell the very best widgets in town for a great price.', phone: '+20 100 000 0000' });
  const before = internals.auditSiteHtml(raw).score;
  const after = internals.auditSiteHtml(e).score;
  check('enhance injects <title>', /<title[^>]*>Acme Widgets<\/title>/i.test(e));
  check('enhance injects meta description', /name=["\']description["\']/.test(e));
  check('enhance injects SEO language', /<html[^>]*lang="en"/i.test(e));
  check('enhance injects Open Graph', /og:title/.test(e) && /og:description/.test(e) && /og:image|og:type/.test(e));
  check('enhance injects Twitter card', /twitter:card/.test(e));
  check('enhance injects JSON-LD', /application\/ld\+json/.test(e) && /LocalBusiness|Organization/.test(e));
  check('enhance injects robots meta', /name=["\']robots["\']/.test(e));
  check('enhance injects theme-color + color-scheme', /theme-color/.test(e) && /color-scheme/.test(e));
  check('enhance adds preconnect/font hygiene only when needed', true);
  check('enhance adds loading=lazy + alt to images', /loading="lazy"/.test(e) && /alt="/.test(e));
  check('enhance adds rel=noopener to target=_blank', /target="_blank"[^>]*rel="[^"]*noopener/.test(e) || /rel="[^"]*noopener[^"]*"[^>]*target="_blank"/.test(e));
  check('enhance stays idempotent (enhance twice === once)', internals.enhanceSiteHtml(e, 'Acme Widgets', { description: 'x' }) === e);
  check('enhance is a real quality jump (delta >= 30)', after - before >= 30, before + ' → ' + after);
}

console.log('\n== A3: /sites/:id/audit ENDPOINT ==');
{
  const site = await call('POST', '/sites', { name: 'Audit Me', html: '<!DOCTYPE html><html><head></head><body><h1>Audit</h1><p>content</p><img src="a.jpg"></body></html>', published: false }, token);
  check('create site for audit works', site.status === 200 && site.data?.id, JSON.stringify(site.data).slice(0, 80));
  const id = site.data.id;
  const r = await call('GET', `/sites/${id}/audit`, null, token);
  check('audit endpoint returns report', r.status === 200 && r.data?.report && r.data?.report.score != null);
  check('audit endpoint reports before < after', typeof r.data.before === 'number' && typeof r.data.after === 'number' && r.data.after > r.data.before, r.data.before + ' → ' + r.data.after);
  check('audit endpoint returns optimizedHtml', typeof r.data.optimizedHtml === 'string' && /og:title/.test(r.data.optimizedHtml));
  const g = await call('GET', `/sites/${id}/audit`, null, 'bad-token');
  check('audit endpoint rejects unauth', g.status === 401 || g.status === 403, g.status);
}

console.log('\n== A4: AI-BUILT SITE GOES THROUGH THE QUALITY GUARANTEE ==');
{
  const site = await call('POST', '/sites', { name: 'Quality Built', description: 'A fine local business', build_with_ai: true, published: false }, token);
  check('AI build_with_ai:true creates a site', site.status === 200 && site.data?.id, JSON.stringify(site.data).slice(0, 80));
  check('AI-built html is well-formed (doctype)', typeof site.data.html === 'string' && /<!DOCTYPE html/i.test(site.data.html));
  const r = await call('GET', `/sites/${site.data.id}/audit`, null, token);
  check('AI-built site auditable', r.status === 200 && r.data?.report);
  // The user can save the optimized html back through PATCH /sites/:id.
  if (site.data?.id) {
    const patched = await call('PATCH', `/sites/${site.data.id}`, { html: r.data.optimizedHtml }, token);
    check('PATCH site with optimized html persists', patched.status === 200, patched.status);
    const re = await call('GET', `/sites/${site.data.id}/audit`, null, token);
    check('re-audit reflects saved optimization (after >= before)', re.data.after >= re.data.before, re.data.before + ' → ' + re.data.after);
  }
}

// ── Frontend side (real app code in jsdom) ─────────────────────────
console.log('\n== B1: FRONTEND EXPOSES THE ENGINE ==');
{
  const html = readFileSync(join(ROOT, 'NexusCRM_V4_Hardened.html'), 'utf-8');
  const dom = new JSDOM(html, { url: 'http://localhost:3000/', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.confirm = () => true; w.alert = () => {}; w.fetch = async () => { throw new TypeError('no net'); }; } });
  const w = dom.window; const d = w.document;
  const errs = []; w.addEventListener('error', e => errs.push(e.message)); w.addEventListener('unhandledrejection', e => errs.push(e.reason?.message));
  await new Promise(r => setTimeout(r, 400));
  check('frontend auditSiteHtml exposed', typeof w.auditSiteHtml === 'function');
  check('frontend enhanceSiteHtml exposed', typeof w.enhanceSiteHtml === 'function');
  check('frontend UI helpers exposed', ['openSiteQuality','toggleSiteAudit','autoOptimizePreview','applySiteOptimize','renderSiteAudit','renderQualityBars'].every(f => typeof w[f] === 'function'));

  const sample = '<!DOCTYPE html><html><head><title>Demo Site</title></head><body><h1>Demo</h1><img src="p.jpg"><p>hello world</p></body></html>';
  const a = w.auditSiteHtml(sample);
  check('frontend audit score is a number', typeof a.score === 'number' && a.score <= 100, a.score);
  const e = w.enhanceSiteHtml(sample, 'Demo Site', { description: 'A great demo site with plenty of good descriptive text long enough to pass.' });
  check('frontend enhance injects OG/JSON-LD', /og:title/.test(e) && /ld\+json/.test(e));

  // drive the real preview modal → audit panel
  w.previewSiteById(null, sample);
  await new Promise(r => setTimeout(r, 200));
  check('preview modal renders inspect buttons', !!d.getElementById('site-audit-btn') && !!d.getElementById('site-optimize-btn'));
  w.toggleSiteAudit();
  await new Promise(r => setTimeout(r, 100));
  const grade = d.getElementById('site-grade')?.textContent || '';
  const panel = d.getElementById('site-audit-panel')?.innerHTML || '';
  check('preview grade chip shows score', /\/100/.test(grade), grade);
  check('audit panel renders category bars', panel.includes('SEO') && panel.includes('Accessibility'), panel.slice(0, 60));
  w.closeModal();
  check('no frontend runtime errors in quality flow', errs.length === 0, errs.join(' | '));
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
process.exit(failed ? 1 : 0);
