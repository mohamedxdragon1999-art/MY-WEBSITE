// AI VISUAL EDITOR — the natural-language element editor behind the website
// builder. Tests BOTH sides:
//   (A) backend worker: pure functions (nxVisualCommand / nxVisualCss /
//       nxVisualApplyCss / nxVisualApplyEdits) + the POST /sites/:id/visual route.
//   (B) frontend: the engine exposed to the builder UI + the click-to-select
//       WYSIWYG editor (edit button, sandboxed iframe, command input, chips).
//
// Run: node tests/test_visual.mjs
import { readFileSync } from 'node:fs';
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

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('api.openai.com') || u.includes('nvidia.com') || u.includes('localhost:11434')) {
    return new Response(JSON.stringify({ choices: [{ message: { content: 'FAKE_AI' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('<html><head><title>t</title></head><body><h1>t</h1></body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
};

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', Origin: 'http://app.local' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await worker.fetch(new Request(BASE + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

// ═══════════ A1: PURE COMMAND ENGINE ═══════════
console.log('\n== A1: PURE COMMAND ENGINE ==');
{
  const { nxVisualCommand } = internals;
  const ctx = { css: { fontSize: '16px', color: '#111', fontWeight: '400', textAlign: 'left', padding: '8px 12px', borderRadius: '0px', boxShadow: 'none', backgroundColor: 'transparent' } };
  const cases = ['make it bigger', 'make this orange', 'make it blue', 'change button text to Contact us', 'make it say Book Now', 'bold', 'center', 'more padding', 'rounded corners', 'hide', 'set size to 28px', 'make it italic', 'uppercase'];
  const res = Object.fromEntries(cases.map(c => [c, nxVisualCommand(c, ctx)]));
  check('bigger scales fontSize up', res['make it bigger'].css.fontSize && parseFloat(res['make it bigger'].css.fontSize) > 16);
  check('named color maps to hex', res['make this orange'].css.color === '#f7742a');
  check('named blue maps to hex', res['make it blue'].css.color === '#3b82f6');
  check('change-text preserves capitalization', res['change button text to Contact us'].text === 'Contact us');
  check('"make it say" captures text', res['make it say Book Now'].text === 'Book Now');
  check('bold → fontWeight 700', res.bold.css.fontWeight === '700');
  check('center → textAlign center', res.center.css.textAlign === 'center');
  check('more padding spreads out', res['more padding'].css.padding && /^[0-9]/.test(res['more padding'].css.padding));
  check('rounded → borderRadius', res['rounded corners'].css.borderRadius === '16px');
  check('hide → display none', res.hide.css.display === 'none');
  check('explicit size to 28px', res['set size to 28px'].css.fontSize === '28px');
  check('italic → fontStyle', res['make it italic'].css.fontStyle === 'italic');
  check('uppercase → textTransform', res.uppercase.css.textTransform === 'uppercase');
  check('unsupported returns error', nxVisualCommand('hello world there').error === 'unsupported');
}

// ═══════════ A2: PURE APPLY (CSS + TEXT) ═══════════
console.log('\n== A2: PURE APPLY (CSS + TEXT) ==');
{
  const { nxVisualApplyCss, nxVisualApplyEdits, nxVisualCss } = internals;
  const tpl = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>X</title></head><body>
<h1 id="hero-h1" class="nx-hero-title">Original Headline</h1>
<p class="lead">Default lead text here.</p>
<button class="cta">Get Started</button>
<section id="sec1"><h2>Our services</h2><p>Some copy.</p></section>
</body></html>`;
  // CSS override → idempotent <style data-nx-visual> with kebab-case properties
  const cssOut = nxVisualApplyCss(tpl, '.a{color:red}');
  const cssOut2 = nxVisualApplyCss(cssOut, '.a{color:red}');
  check('applyCss injects one style block', (cssOut2.match(/data-nx-visual/g) || []).length === 1);
  const styled = nxVisualApplyEdits(tpl, [{ selector: '#hero-h1', css: { color: '#f7742a', fontSize: '28px', fontWeight: '700' } }]);
  check('applyEdits writes kebab-case CSS', /#hero-h1 \{ color:#f7742a; font-size:28px; font-weight:700; \}/.test(styled));
  // text by #id, .class, and a bare class on a button
  check('text edit via #id', /<h1 id="hero-h1"[^>]*>Book Now<\/h1>/.test(nxVisualApplyEdits(tpl, [{ selector: '#hero-h1', text: 'Book Now' }])));
  check('text edit via tag.class', /<p class="lead">New lead sentence\.<\/p>/.test(nxVisualApplyEdits(tpl, [{ selector: 'p.lead', text: 'New lead sentence.' }])));
  check('text edit via .class on button', /<button class="cta">Contact Us<\/button>/.test(nxVisualApplyEdits(tpl, [{ selector: '.cta', text: 'Contact Us' }])));
  // CSS + text together, original text index untouched
  const both = nxVisualApplyEdits(tpl, [{ selector: '#hero-h1', css: { color: '#0af' } }, { selector: '#hero-h1', text: 'Pay Now' }]);
  check('css+text both applied', /<style data-nx-visual>/.test(both) && /<h1 id="hero-h1"[^>]*>Pay Now<\/h1>/.test(both) && /#hero-h1 \{ color:#0af; \}/.test(both));
  check('nxVisualCss emits kebab properties', nxVisualCss([{ selector: 'h3', css: { backgroundColor: '#111', textAlign: 'center' } }]).includes('background-color:#111') && nxVisualCss([{ selector: 'h3', css: { backgroundColor: '#111' } }]).includes('text-align:') === false);
}

// ═══════════ A3: /sites/:id/visual ROUTE ═══════════
console.log('\n== A3: /sites/:id/visual ROUTE ==');
let token = '';
{
  const email = 'visual' + Date.now() + '@x.com';
  const reg = await call('POST', '/auth/register', { name: 'Visual Tester', email, password: 'password123' });
  token = reg.data?.token;
  check('registered a workspace', !!token, reg.status);

  // create a site
  const base = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>V</title></head><body><h1 id="hero" class="nx-hero-title">Welcome</h1><p class="lead">Text here</p></body></html>`;
  const site = await call('POST', '/sites', { name: 'Visual Test Site', html: base, published: false }, token);
  const sid = site.data?.id;
  check('created a site', !!sid, `id=${sid}`);

  // apply CSS via overrides
  const r1 = await call('POST', `/sites/${sid}/visual`, { overrides: [{ selector: '#hero', css: { color: '#f7742a', fontSize: '30px' } }] }, token);
  check('visual apply returns ok', r1.status === 200 && r1.data?.ok === true, r1.status);
  check('visual apply computes before/after', typeof r1.data?.before === 'number' && typeof r1.data?.after === 'number');
  const get1 = await call('GET', `/sites/${sid}/html`, null, token);
  check('persisted the CSS edit', /<style data-nx-visual>/.test(get1.data.html) && /color:#f7742a/.test(get1.data.html));
  check('persisted kebab-case property', /font-size:30px/.test(get1.data.html));

  // apply text via overrides
  const r2 = await call('POST', `/sites/${sid}/visual`, { overrides: [{ selector: '#hero', text: 'Pay Now' }] }, token);
  check('visual text apply ok', r2.status === 200 && r2.data?.ok === true);
  const get2 = await call('GET', `/sites/${sid}/html`, null, token);
  check('persisted the text edit', /<h1 id="hero"[^>]*>Pay Now<\/h1>/.test(get2.data.html));

  // apply a natural-language command routed server-side
  const cmd = await call('POST', `/sites/${sid}/visual`, { selector: '#hero', command: 'make it bold' }, token);
  check('server-side command apply ok', cmd.status === 200 && cmd.data?.ok === true, cmd.status);
  const get3 = await call('GET', `/sites/${sid}/html`, null, token);
  check('command produced an override', /<style data-nx-visual>/.test(get3.data.html));

  // full-document replacement path
  const newDoc = '<!DOCTYPE html><html lang="en"><head><title>V2</title></head><body><h1 id="hero">Replaced</h1></body></html>';
  const r3 = await call('POST', `/sites/${sid}/visual`, { html: newDoc }, token);
  check('html replacement ok', r3.status === 200 && r3.data?.ok === true);
  const get4 = await call('GET', `/sites/${sid}/html`, null, token);
  check('html replacement persisted', /Replaced/.test(get4.data.html));

  // unauth → 401
  const r401 = await call('POST', `/sites/${sid}/visual`, { overrides: [{ selector: '#hero', css: { color: '#fff' } }] }, '');
  check('visual apply requires auth', r401.status === 401, r401.status);

  // non-existent site → 404
  const r404 = await call('POST', '/sites/99999/visual', { overrides: [] }, token);
  check('visual apply on missing site → 404', r404.status === 404, r404.status);
}

// ═══════════ B1: FRONTEND ENGINE + WYSIWYG ═══════════
console.log('\n== B1: FRONTEND ENGINE + WYSIWYG ==');
{
  const html = readFileSync(join(ROOT, 'NexusCRM_V4_Hardened.html'), 'utf-8');
  const dom = new JSDOM(html, { url: 'http://localhost:3000/', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.confirm = () => true; w.alert = () => {}; w.fetch = async () => { throw new TypeError('no net'); }; } });
  const w = dom.window, d = w.document, dw = dom.window;
  const errs = []; dw.addEventListener('error', e => errs.push(e.message)); dw.addEventListener('unhandledrejection', e => errs.push(e.reason?.message));
  await new Promise(r => setTimeout(r, 400));

  check('frontend nxVisualCommand exposed', typeof dw.nxVisualCommand === 'function');
  check('frontend WYSIWYG helpers exposed', ['nxOpenVisualEditor', 'nxApplyVisualCmd', 'nxSaveVisualEdit', 'nxComputeSelector', 'nxVisualCss', 'nxVisualApplyEdits'].every(f => typeof dw[f] === 'function'));

  // command engine parity with backend
  const ctx = { css: { fontSize: '16px', color: '#111', fontWeight: '400', textAlign: 'left', padding: '8px 12px' } };
  check('frontend command bigger', parseFloat(dw.nxVisualCommand('make it bigger', ctx).css.fontSize) > 16);
  check('frontend command text keeps case', dw.nxVisualCommand('make it say Book Now', ctx).text === 'Book Now');

  // selector on a real DOM
  const dd = new JSDOM('<div><section id="services"><div class="nx-card"><h3 id="a">One</h3></div><div class="nx-card"><h3 id="b">Two</h3></div></section></div>');
  const h = dd.window.document.querySelectorAll('.nx-card')[1].querySelector('h3');
  const sel = dw.nxComputeSelector(h, dd.window.document);
  check('selector prefers id', sel === '#b', sel);

  // open the visual editor → sandboxed iframe + command input + chips + save
  dw.nxOpenVisualEditor(0, '<!DOCTYPE html><html><head><title>S</title></head><body><h1 id="hero">Hi</h1></body></html>');
  await new Promise(r => setTimeout(r, 150));
  const modal = d.getElementById('modal-container')?.innerHTML || '';
  check('visual editor renders an iframe', /id="ve-frame"/.test(modal));
  check('visual editor iframe is script-free (allow-same-origin, no allow-scripts)', /sandbox="allow-same-origin"/.test(modal) && !/allow-scripts/.test(modal));
  check('visual editor has command input + apply + save', /id="ve-cmd"/.test(modal) && /nxApplyVisualCmd\(\)/.test(modal) && /nxSaveVisualEdit\(\)/.test(modal));
  check('visual editor has quick-action chips', /id="ve-chips"/.test(modal));
  check('no frontend runtime errors in visual flow', errs.length === 0, errs.join(' | '));
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
process.exit(failed ? 1 : 0);
