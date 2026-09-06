// GATE FIDELITY — the validation gate must judge what a browser renders, and
// every design the catalog advertises must ship through it CLEAN.
//
// Every check here is a regression pin for a real false blocker (or a real
// defect) found by probing the live routes with deterministic builds:
//   (A) the cascade honours @media: mobile-only rules apply at 375px only,
//       desktop-only fixed widths are not "overflow" on a phone, hidden
//       subtrees are not measured, box shorthands expand, var() fallbacks are
//       not "undefined tokens"
//   (B) semantics: a logo link named by its <img alt> is accessible; a
//       template's switched-off (`hidden`) phone/email links are not "links
//       with no accessible text"; heading order in the reference template
//   (C) the testing agent inspects MARKUP only (an <img> inside a runtime's
//       template literal is not an image on the page) and lives in its own
//       zero-I/O module
//   (D) live routes: all 10 catalog designs pass the gate on three briefs via
//       POST /ai/build-site; POST /sites honours `direction` (composed page
//       with a connected lead form); the agentic loop survives a gate failure
//   (E) the reference template ships 44px tap targets on mobile, a spotlight
//       that cannot widen a phone, sized + prioritised images
//
// Run: node tests/test_gate_fidelity.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = join(__dirname, '..');
const { init, DB } = require('./d1mock.js');
await init(readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8'));
const { parseHTML } = require('linkedom');
const C = require(join(ROOT, 'backend/src/nx_cascade.js'));
const L = require(join(ROOT, 'backend/src/nx_layout.js'));
const V = require(join(ROOT, 'backend/src/nx_validate.js'));
const A = require(join(ROOT, 'backend/src/nx_ast.js'));
const AGENT = require(join(ROOT, 'backend/src/nx_site_agent.js'));

const workerMod = await import(join(ROOT, 'backend', 'src', 'index.js'));
const worker = workerMod.default;
const T = workerMod.__internals;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9, ENCRYPTION_KEY: 'k'.repeat(32) };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'garbage' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', Origin: 'http://app.local' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await worker.fetch(new Request('http://test.local/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  let data = null; try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const doc = (html) => parseHTML(html).document;
const page = (head, body) => `<!DOCTYPE html><html lang="en"><head><title>T</title><meta name="description" content="d"><style>${head}</style></head><body><main><h1>Hi</h1>${body}</main></body></html>`;
const rulesAt = (html, vp) => L.nxMeasure(html, doc(html), vp).issues.map((i) => i.rule + ' ' + i.selector);

console.log('\n== A. The cascade evaluates @media instead of ignoring it ==');
{
  const html = page(
    '.a{width:560px;padding:4px 8px}@media (max-width:520px){.a{display:none;width:100px}}@media (min-width:900px){.a{padding:20px}}'
    + '@media screen and (min-width:600px) and (max-width:899px){.a{width:50%}}@media (width <= 400px){.a{color:red}}@media print{.a{color:blue}}'
    + '@keyframes k{from{opacity:0}to{opacity:1}}@supports not (display:grid){.a{float:left}}@media (prefers-reduced-motion:reduce){.a{animation:none}}',
    '<div class="a">x</div>');
  const d = doc(html); const c = C.nxCascade(html, d); const el = d.querySelector('.a');
  const at = (vp, p) => c.computed(el, p, vp);
  const M = { width: 375, height: 812 }, Tb = { width: 768, height: 1024 }, D = { width: 1440, height: 900 };
  check('default (no viewport) is the desktop cascade', c.computed(el, 'width') === '560px' && c.computed(el, 'padding-top') === '20px');
  check('max-width rule applies on a phone only', at(M, 'display') === 'none' && at(M, 'width') === '100px' && at(D, 'display') === null);
  check('min-width rule applies on desktop only', at(D, 'padding-top') === '20px' && at(M, 'padding-top') === '4px');
  check('range list (min and max) applies on a tablet only', at(Tb, 'width') === '50%' && at(M, 'width') === '100px' && at(D, 'width') === '560px');
  check('level-4 range syntax (width <= 400px) is understood', at(M, 'color') === 'red' && at(D, 'color') === null);
  check('print rules never apply to a screen audit', at(M, 'color') !== 'blue' && at(D, 'color') === null);
  check('@keyframes selectors are not style rules', !c.rules.some((r) => r.selector === 'from' || r.selector === 'to'));
  check('@supports not (…) is treated as unsupported', at(D, 'float') === null);
  check('reduced-motion overrides are not the default rendering', at(D, 'animation') === null);
  check('each rule remembers its condition text', c.rules.some((r) => r.selector === '.a' && /max-width:520px/.test(r.mediaText)));
  const fresh = C.nxComputed(el, 'width', c.rules, c.vars, undefined, M);
  check('un-indexed nxComputed agrees with the indexed cascade at a viewport', fresh === at(M, 'width'), fresh + ' vs ' + at(M, 'width'));

  // :root tokens overridden under a condition do not replace the default palette
  const h2 = page(':root{--faint:#444}@media (prefers-color-scheme:dark){:root{--faint:#fff}}', '<p>x</p>');
  check('conditional :root overrides do not leak into the default token table', C.nxCascade(h2, doc(h2)).vars['--faint'] === '#444');
}

console.log('\n== A2. Layout estimator measures per viewport, skips hidden subtrees ==');
{
  const html = page(
    '.wide{width:1100px}@media (max-width:520px){.wide{display:none}.m a{min-height:44px;min-width:44px;display:inline-flex}}@media (min-width:1200px){.d{width:1500px}}.m a{padding:2px}.b{padding:13px 26px}',
    '<div class="wide">x</div><nav class="m"><a href="#a">Tap</a></nav><div class="d">d</div><div hidden><a href="#a">hid</a></div><a class="b" href="#a">Button</a><div style="display:none"><a href="#a">no</a></div>');
  const m = rulesAt(html, { width: 375, height: 812 }), d = rulesAt(html, { width: 1440, height: 900 }), w = rulesAt(html, { width: 1920, height: 1080 });
  check('a desktop-only 1100px box hidden on phones is not overflow at 375px', !m.some((x) => x === 'overflow-x div.wide'), m.join(' | '));
  check('a mobile-only 44px rule satisfies the tap-target check on the phone', !m.some((x) => x === 'touch-target a'), m.join(' | '));
  const noMobileRule = page('.m a{padding:2px}', '<nav class="m"><a href="#a">Tap</a></nav>');
  check('without that rule the same 3-letter link IS a narrow/short tap target', rulesAt(noMobileRule, { width: 375, height: 812 }).includes('touch-target a'));
  check('a min-width:1200px fixed width IS overflow at 1440 but not at 1920', d.includes('overflow-x div.d') && !w.includes('overflow-x div.d'), d.join(' | ') + ' // ' + w.join(' | '));
  check('links inside [hidden] / display:none are never measured', !m.concat(d).some((x) => /hid|no$/.test(x)));
  check('box shorthand padding counts toward the tap-target height', !m.some((x) => x === 'touch-target a.b'), m.join(' | '));
  const fb = page(':root{--x:1px}.a{transform:translate(var(--gx,50%))}.b{color:var(--nope)}', '<p class="a">y</p>');
  const dv = C.nxCascade(fb, doc(fb)).danglingVars();
  check('var() with a fallback is not an undefined token; without one it is', !dv.includes('--gx') && dv.includes('--nope'), dv.join(','));
  const r = V.nxValidatePage(page('.t{padding:2px;font-size:12px}', '<a class="t" href="#a">Tiny</a><div style="width:2400px">w</div>'));
  const rules = new Set(r.blocking.map((b) => b.rule));
  check('real defects are still caught (sub-44px control, fixed 2400px box)', rules.has('touch-target') && rules.has('overflow-x'), [...rules].join(','));
}

console.log('\n== B. Semantics: accessible names and switched-off links ==');
{
  const audit = (body) => A.nxAstDeepAudit(page('', body)).issues.filter((i) => /link/.test(i));
  check('a logo link named by its image alt is accessible', audit('<a href="#top"><img alt="Acme logo" src="x.png"></a>').length === 0);
  check('aria-labelledby / title / svg <title> name a link', audit('<span id="l">Home</span><a href="#a" aria-labelledby="l"></a><a href="#b" title="Call"></a><a href="#c"><svg viewBox="0 0 1 1"><title>Mail</title></svg></a>').length === 0);
  check('a genuinely empty link is still reported', audit('<a href="#a"></a>').length === 1);
  check('an empty-alt image does not name a link', audit('<a href="#a"><img alt="" src="x.png"></a>').length === 1);
  check('a `hidden` link (unknown phone number) is not in the accessibility tree', audit('<a href="tel:" hidden></a><a data-cfg-email="" hidden></a>').length === 0);
  check('an aria-hidden link is not reported', audit('<a href="#a" aria-hidden="true"></a>').length === 0);
  check('an <a> without href is not a link', audit('<a class="anchor"></a>').length === 0);
}

console.log('\n== C. The testing agent inspects markup only and is a module ==');
{
  check('nx_site_agent exports the three agent functions + categories', ['debugSiteHtml', 'testSiteHtml', 'autoFixSite', 'NX_AGENT_CATS'].every((k) => k in AGENT));
  check('index.js re-exports the same functions through __internals', T.testSiteHtml === AGENT.testSiteHtml && T.debugSiteHtml === AGENT.debugSiteHtml && T.autoFixSite === AGENT.autoFixSite);
  const src = readFileSync(join(ROOT, 'backend/src/nx_site_agent.js'), 'utf8');
  check('the agent module has no imports (zero-I/O, bundle-safe)', !/\brequire\(|^import /m.test(src));
  const withRuntimeImg = page('', '<img src="a.png" alt="a" width="10" height="10" loading="lazy" decoding="async"><script>const t=`<img src="${x}" alt="">`;</script>');
  const d = AGENT.debugSiteHtml(withRuntimeImg);
  check('an <img> built inside a <script> template literal is not counted as a page image', d.info.imgs === 1 && !d.warnings.some((w) => /width\/height|lazy/.test(w)), JSON.stringify(d.warnings));
  const t = AGENT.testSiteHtml(withRuntimeImg);
  check('the perf category passes for a fully-sized, lazy page', t.categories.find((c) => c.id === 'perf').results.every((r) => r.pass), JSON.stringify(t.categories.find((c) => c.id === 'perf')));
}

let token = '';
{
  const r = await call('POST', '/auth/register', { name: 'Gate', email: 'gate' + Date.now() + '@x.com', password: 'password123', workspace_name: 'Gate' });
  token = r.data?.token || '';
  check('registered a workspace for the live-route checks', !!token);
}

console.log('\n== D. Live routes: every catalog design ships clean ==');
{
  const cat = await call('GET', '/ai/site-catalog', null, token);
  const designs = (cat.data && cat.data.designs || []).map((d) => d.id || d);
  check('the catalog advertises 10 designs', designs.length === 10, designs.join(','));
  const briefs = [
    ['Northgate Civil', 'Family-run civil engineering contractor in Leeds: drainage, groundworks, retaining walls. 30 years, NICEIC. Call 0113 555 0100.'],
    ['Apex Dental', 'Modern dental clinic: implants, whitening, orthodontics. Open Sat–Thu 9am–9pm.'],
    ['x', ''],
  ];
  const bad = [], noForm = [], slow = [];
  const t0 = Date.now();
  for (const design_id of designs) for (const [name, description] of briefs) {
    const r = await call('POST', '/ai/build-site', { name, description, deterministic: true, design_id }, token);
    const v = r.data && r.data.validation;
    if (r.status !== 200 || !v || !v.pass || v.shippedWithBlockers) bad.push(`${design_id}/${name}: ${r.status} ${(v && v.blocking || []).map((b) => b.rule + ' ' + (b.selector || '') + ' ' + (b.measured || '')).join('; ').slice(0, 160)}`);
    if (r.data && !/<form\b/i.test(r.data.html)) noForm.push(design_id + '/' + name);
    if (r.data && !/NX_LEAD_URL/.test(r.data.html)) noForm.push(design_id + '/' + name + ' (no lead runtime)');
  }
  const ms = Date.now() - t0;
  check(`all ${designs.length * briefs.length} deterministic builds pass the validation gate (no shippedWithBlockers)`, bad.length === 0, bad.slice(0, 4).join(' | '));
  check('every build carries a contact form wired to the lead runtime', noForm.length === 0, noForm.slice(0, 6).join(','));
  check(`the matrix is fast (${ms} ms for ${designs.length * briefs.length} builds)`, ms < 60000);
  // the template design specifically: heading order, mobile tap targets, spotlight, images
  const tpl = await call('POST', '/ai/build-site', { name: 'Northgate Civil', description: briefs[0][1], deterministic: true, design_id: 'template' }, token);
  const html = tpl.data.html;
  const levels = [...html.replace(/<script\b[\s\S]*?<\/script>/g, '').matchAll(/<h([1-6])\b/g)].map((m) => +m[1]);
  let jump = false; for (let i = 1; i < levels.length; i++) if (levels[i] > levels[i - 1] + 1) jump = true;
  check('template: no heading level is skipped anywhere in the document', !jump, levels.join(''));
  const d = doc(html); const c = C.nxCascade(html, d); const M = { width: 375, height: 812 };
  check('template: the pointer spotlight is switched off on phones', c.computed(d.querySelector('#spotlight'), 'display', M) === 'none');
  const small = [...d.querySelectorAll('.nav-links a, .foot-col a, .lead-form button, .foot-bottom .links a')].filter((el) => c.computed(el, 'min-height', M) !== '44px');
  check('template: nav, footer and form controls are 44px on phones', small.length === 0, small.length + ' small');
  const imgs = [...html.replace(/<script\b[\s\S]*?<\/script>/g, '').matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  check('template: every page image has intrinsic width/height (no CLS)', imgs.length >= 8 && imgs.every((t) => /\bwidth="\d+"/.test(t) && /\bheight="\d+"/.test(t)), imgs.length + ' imgs');
  check('template: the hero image is eager + high priority, the rest lazy', imgs.some((t) => /data-nx-img="hero"/.test(t) && /loading="eager"/.test(t) && /fetchpriority="high"/.test(t)) && imgs.filter((t) => /loading="lazy"/.test(t)).length >= imgs.length - 1);
  check('template: --faint passes 3:1 against the page background', V.nxValidatePage(html).blocking.every((b) => b.rule !== 'contrast'));
  check('template: the testing agent scores 100', T.testSiteHtml(html).score === 100, String(T.testSiteHtml(html).score));
}

console.log('\n== D2. POST /sites honours `direction` (composition engine + lead form) ==');
{
  const r = await call('POST', '/sites', { name: 'Swiss Studio', description: 'Brand design studio in Zurich. Identity systems, packaging, motion.', build_with_ai: true, deterministic: true, direction: 'swiss-structured' }, token);
  check('POST /sites with a direction builds (200)', r.status === 200, String(r.status));
  const html = r.data && r.data.html || '';
  check('the page is a composed page (composition classes present)', /class="c-/.test(html));
  check('the composed page has a contact form connected to the lead endpoint', /<form\b/.test(html) && new RegExp('var NX_LEAD_URL="' + String(r.data.lead_url || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(html));
  const meta = await call('GET', '/sites/' + r.data.id + '/html', null, token);
  const themeObj = (meta.data && meta.data.theme) || {};
  check('the direction is persisted with the site theme (GET /sites/:id/html)', themeObj.direction === 'swiss-structured', JSON.stringify(themeObj).slice(0, 120));
  const p = await call('PATCH', '/sites/' + r.data.id, { build_with_ai: true, deterministic: true, direction: 'editorial-minimal' }, token);
  check('PATCH can change the direction and rebuilds through the composer', p.status === 200 && /class="c-/.test(p.data.html || ''));
  const unknown = await call('POST', '/sites', { name: 'U', build_with_ai: true, deterministic: true, direction: 'no-such-direction' }, token);
  check('an unknown direction is rejected by validation or ignored (never a 500)', unknown.status === 400 || unknown.status === 200, String(unknown.status));
  const v = V.nxValidatePage(html);
  check('the composed /sites page passes the validation gate', v.pass, v.blocking.map((b) => b.rule + ' ' + b.selector).join(','));
}

console.log('\n== D3. The agentic loop survives a validation-gate crash ==');
{
  const orig = A.nxAstValidateSections;
  A.nxAstValidateSections = () => { throw new Error('injected gate failure'); };
  let out = null, threw = null;
  try { out = await T.runAgenticLoop(() => page('', '<section id="a"><h2>A</h2><p>copy</p></section>'), { name: 'X', maxIterations: 1, direction: 'swiss-structured' }); }
  catch (e) { threw = e; }
  finally { A.nxAstValidateSections = orig; }
  check('a throwing gate is logged, not fatal (no ReferenceError from the catch handler)', !threw && out && typeof out.html === 'string', threw && threw.message);
}

console.log('\n== E. The reference template source is consistent across its three copies ==');
{
  const idx = readFileSync(join(ROOT, 'backend/src/index.js'), 'utf8');
  const fe = readFileSync(join(ROOT, 'NexusCRM_V4_Hardened.html'), 'utf8');
  const root = readFileSync(join(ROOT, 'nx_template.js'), 'utf8');
  const line = (s, pfx) => s.split('\n').find((l) => l.startsWith(pfx)) || '';
  const same = ['const NX_CSS = ', '  "why": { t: ', '  "about": { t: ', '  "process": { t: ', '  "footer": { t: '].every((p) => line(idx, p) && line(idx, p) === line(fe, p) && line(idx, p) === line(root, p));
  check('NX_CSS + retagged blades are byte-identical in index.js, the FE and nx_template.js', same);
  check('the template CSS no longer styles card headings as h4 / footer as h5', !/\.feat h4\{|\.proc-step h4\{|\.foot-col h5\{/.test(line(idx, 'const NX_CSS = ')) && /\.feat h3\{/.test(line(idx, 'const NX_CSS = ')));
  check('the template CSS carries the mobile hardening block', /@media\(max-width:520px\)\{#spotlight\{display:none\}/.test(line(idx, 'const NX_CSS = ')));
}

const total = passed + failed;
console.log('\n────────────────────────────────────────');
if (failed) { console.log(`❌ ${failed}/${total} FAILED:\n` + failures.map((f) => '  • ' + f).join('\n')); process.exit(1); }
console.log(`ALL PASSED — ${passed}/${total} passing`);
process.exit(0);
