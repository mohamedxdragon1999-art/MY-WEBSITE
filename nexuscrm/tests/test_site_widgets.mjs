// SITE WIDGETS + WCAG AA (builder overhaul, part 5) — proves the interactive
// micro-widgets and the accessibility guarantees of generated sites:
//
//   A. site/widgets.js — plan → widget selection is fact-driven (an
//      estimator needs ≥2 priced tiers, a funnel ≥2 services, filter chips
//      ≥5 categorisable services, the mobile bar a phone/WhatsApp/CTA);
//      money parsing; category inference; idempotent injection.
//   B. The markup survives the AI-output sanitiser byte-for-byte (the
//      widgets are injected BEFORE sanitising, like everything else).
//   C. Behaviour in a real DOM (jsdom): estimator arithmetic + contact-form
//      pre-fill, funnel step gating + validation + POST to the site_lead
//      webhook, filter chips hide/show + aria-pressed, sticky bar activates.
//   D. End to end: POST /sites picks widgets from the brief, the funnel's
//      payload lands in the workspace inbox with its own subject, and
//      widgets:false / widgets:[…] are honoured through the validator.
//   E. WCAG AA — every builder palette and every catalog theme has ≥4.5:1
//      body/muted text on bg/bg2/card, AA link text, AA button labels; a
//      :focus-visible ring and a skip link ship with every page; a proof
//      block without quotes is never headed "What people say".
//   F. Brief understanding that feeds the widgets: thousands separators are
//      not list commas, priced items are still services, colon-introduced
//      lists count, "WhatsApp +44…" labels the number after it, pricing
//      tiers are named after what the brief priced, and a long content plan
//      is trimmed so the RULES (incl. widget vocabulary) always reach the
//      model inside the 8,000-char message cap.
//
// Run: node tests/test_site_widgets.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const { init, DB } = require('./d1mock.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

const W = await import('../backend/src/site/widgets.js');
const SAFE = require('../backend/src/nx_safe_html.js');
const BUILDER = require('../backend/src/nx_site_builder.js');
const CATALOG = await import('../backend/src/site/catalog.js');

// ───────────────────────────── A. selection ─────────────────────────────
console.log('\n== A. widget selection is fact-driven ==');
{
  const rich = {
    name: 'Apex Plumbing',
    pricing: [{ name: 'Call-out', price: '£45' }, { name: 'Boiler service', price: '£89' }, { name: 'Full install', price: 'from £1,800' }],
    services: [{ title: 'Emergency repairs', text: 'burst pipes' }, { title: 'Boiler installation' }, { title: 'Annual servicing' }, { title: 'Bathroom fitting' }, { title: 'Leak detection' }],
    contact: { phone: '0113 000 0000', whatsapp: '+44 7700 900000' }, hero: { primary: 'Book a plumber' },
  };
  const wp = W.nxWidgetPlan(rich, {});
  check('rich plan → all four widgets', JSON.stringify(wp.kinds) === JSON.stringify(['estimator', 'funnel', 'filter', 'stickycta']), JSON.stringify(wp.kinds));
  check('estimator tiers parsed with currency + from-flag', wp.estimator.currency === '£' && wp.estimator.tiers.length === 3 && wp.estimator.tiers[2].amount === 1800 && wp.estimator.tiers[2].from === true);
  check('funnel lists the plan services (≤8) and the brand', wp.funnel.services.length === 5 && wp.funnel.brand === 'Apex Plumbing');
  check('filter targets services with ≥2 inferred groups', wp.filter.target === 'services' && wp.filter.groups.length >= 2 && wp.filter.byService['Emergency repairs'] === 'Repairs');
  check('sticky bar carries phone, whatsapp and the primary CTA', wp.stickycta.phone && wp.stickycta.whatsapp && wp.stickycta.primary === 'Book a plumber');

  const thin = W.nxWidgetPlan({ name: 'Solo', services: [{ title: 'Only one' }], pricing: [{ name: 'A', price: '£10' }] }, {});
  check('one service + one price → no estimator, no funnel, no filter', !thin.kinds.includes('estimator') && !thin.kinds.includes('funnel') && !thin.kinds.includes('filter'), JSON.stringify(thin.kinds));
  check('a primary CTA alone is enough for the mobile action bar', thin.kinds.includes('stickycta'));
  const nothing = W.nxWidgetPlan({}, {});
  check('empty plan → sticky bar only (default CTA), nothing invented', JSON.stringify(nothing.kinds) === JSON.stringify(['stickycta']));
  const disabled = W.nxWidgetPlan(rich, { disable: ['funnel', 'stickycta'] });
  check('opts.disable removes kinds (owner avoid-list)', !disabled.kinds.includes('funnel') && !disabled.kinds.includes('stickycta') && disabled.kinds.includes('estimator'));
  const only = W.nxWidgetPlan(rich, { only: ['filter'] });
  check('opts.only limits to a list', JSON.stringify(only.kinds) === JSON.stringify(['filter']));
  const unpriced = W.nxWidgetPlan({ pricing: [{ name: 'A', price: 'Call for price' }, { name: 'B', price: 'POA' }], services: [{ title: 'x' }, { title: 'y' }] }, {});
  check('unpriced tiers never produce an estimator', !unpriced.kinds.includes('estimator'));
  const gallery = W.nxWidgetPlan({ gallery_imgs: ['a', 'b', 'c', 'd', 'e', 'f'] }, {});
  check('≥6 gallery images → filter chips over the gallery', gallery.filter && gallery.filter.target === 'gallery');

  // money parsing
  const M = W.nxParseMoney;
  check('parses "£1,250.50"', M('£1,250.50').amount === 1250.5 && M('£1,250.50').currency === '£');
  check('parses "from $99 / month" as from-price in dollars', M('from $99 / month').from === true && M('from $99 / month').currency === '$');
  check('parses "EGP 450" and "450 LE" as Egyptian pounds', M('EGP 450').currency === 'EGP ' && M('450 LE').currency === 'EGP ');
  check('rejects "free" / empty / zero', M('free') === null && M('') === null && M('£0') === null);

  // category inference
  const cats = W.__widgetInternals.serviceCategories({ services: [{ title: 'Teeth whitening' }, { title: 'Dental implants' }, { title: 'Emergency dentist' }, { title: 'Hygienist visits' }, { title: 'Invisalign braces' }] });
  check('dental services split into ≥2 real groups', cats.groups.length >= 2 && !cats.groups.includes('More'), JSON.stringify(cats.groups));
}

// ───────────────────────────── B. sanitiser pass-through ────────────────
console.log('\n== B. widget markup survives the sanitiser ==');
{
  const wp = W.nxWidgetPlan({ name: 'X', pricing: [{ name: 'A', price: '£10' }, { name: 'B', price: '£20' }], services: [{ title: 'Emergency repairs' }, { title: 'Boiler installation' }, { title: 'Annual servicing' }, { title: 'Bathroom fitting' }, { title: 'Leak detection' }], contact: { phone: '0113 000 0000', whatsapp: '+447700900000' } }, {});
  for (const k of wp.kinds) {
    const html = W.nxWidgetHtml(k, wp[k], {});
    const clean = SAFE.nxSanitizeFragment(html, { maxLength: 400000 });
    check(`${k}: sanitiser keeps every tag and attribute`, clean === html, `dropped=${JSON.stringify(SAFE.nxSanitizeFragment.lastReport)}`);
  }
  const body = '<main><section class="section" id="services"><div class="container"><h2>S</h2><div class="nx-grid g3"><div class="nx-card"><h3>Emergency repairs</h3></div><div class="nx-card"><h3>Boiler installation</h3></div><div class="nx-card"><h3>Annual servicing</h3></div><div class="nx-card"><h3>Bathroom fitting</h3></div><div class="nx-card"><h3>Leak detection</h3></div></div></div></section><section class="section" id="pricing"><div class="container">p</div></section><section class="section" id="contact"><form class="nx-form"><textarea name="message"></textarea></form></section></main><footer class="nx-footer">f</footer>';
  const once = W.nxInjectWidgets(body, wp, {});
  const twice = W.nxInjectWidgets(once.html, wp, {});
  check('injection places all four kinds', once.injected.length === 4, JSON.stringify(once.injected));
  check('injection is idempotent', twice.html === once.html && twice.injected.length === 0);
  const order = ['id="services"', 'class="nx-filter"', 'id="pricing"', 'id="estimate"', 'id="quote"', 'id="contact"', '</footer>', 'class="nx-sticky-cta"'].map((n) => once.html.indexOf(n));
  check('placement order: chips in services → estimator after pricing → funnel before contact → sticky after footer', order.every((v, i) => v !== -1 && (i === 0 || v > order[i - 1])), order.join(','));
  check('every service card received a data-tags category', (once.html.match(/data-tags="/g) || []).length === 5);
  const css = W.nxWidgetsCss(W.WIDGET_KINDS), js = W.nxWidgetsJs(W.WIDGET_KINDS);
  check('CSS uses design tokens (no hard-coded brand colours)', /var\(--accent\)/.test(css) && /var\(--line\)/.test(css) && !/#[0-9a-f]{6}\b(?![^{]*\})/i.test(css.replace(/#c0392b/g, '')));
  check('runtime parses as a script and needs no external library', (() => { try { new Function(js); return true; } catch (e) { return false; } })() && !/https?:\/\//.test(js));
  check('runtime reads the lead URL from window.NX_LEAD_URL (shared with the contact form)', /window\.NX_LEAD_URL/.test(js));
  check('vocab tells the model what NOT to duplicate', /do NOT write your own calculator/.test(W.nxWidgetsVocab(['estimator'])) && W.nxWidgetsVocab([]) === '');
}

// ───────────────────────────── C. DOM behaviour ─────────────────────────
console.log('\n== C. behaviour in a real DOM ==');
async function mount(html, onPost) {
  const vc = new VirtualConsole();
  const jsErrors = []; vc.on('jsdomError', (e) => jsErrors.push(String(e && e.message || e)));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://site.example/', virtualConsole: vc, beforeParse(w) {
    w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
    w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    w.requestAnimationFrame = (f) => setTimeout(f, 0);
    w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function () {};
    w.fetch = async (url, opts) => { const r = onPost ? onPost(url, opts) : { ok: true }; return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  } });
  await new Promise((r) => setTimeout(r, 30));
  return { window: dom.window, d: dom.window.document, jsErrors };
}
{
  const wp = W.nxWidgetPlan({ name: 'X', pricing: [{ name: 'Basic clean', price: '£40', per: 'room' }, { name: 'Deep clean', price: '£95', per: 'room' }], estimator_options: [{ name: 'Oven', amount: 25 }], services: [{ title: 'Emergency repairs' }, { title: 'Boiler installation' }, { title: 'Annual servicing' }, { title: 'Bathroom fitting' }, { title: 'Leak detection' }], contact: { phone: '0113 000 0000' } }, {});
  const body = '<nav class="nx-nav"></nav><main><section class="nx-hero" id="home"><h1>x</h1></section><section class="section" id="services"><div class="container"><div class="nx-grid g3"><div class="nx-card"><h3>Emergency repairs</h3></div><div class="nx-card"><h3>Boiler installation</h3></div><div class="nx-card"><h3>Annual servicing</h3></div><div class="nx-card"><h3>Bathroom fitting</h3></div><div class="nx-card"><h3>Leak detection</h3></div></div></div></section><section class="section" id="pricing"></section><section class="section" id="contact"><form class="nx-form"><textarea name="message"></textarea></form></section></main><footer></footer>';
  const inj = W.nxInjectWidgets(body, wp, {});
  const posts = [];
  const page = `<!DOCTYPE html><html><head><style>${W.nxWidgetsCss(wp.kinds)}</style></head><body>${inj.html}<script>window.NX_LEAD_URL='https://api.example/api/public/webhook/tok';</script><script>${W.nxWidgetsJs(wp.kinds)}</script></body></html>`;
  const { window, d, jsErrors } = await mount(page, (url, opts) => { posts.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; });
  const ev = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));

  // estimator: tier × qty + add-on
  const est = d.querySelector('.nx-estimator'); const total = est.querySelector('.nx-est-total');
  check('estimator shows the first tier initially', total.textContent === '£40', total.textContent);
  const tiers = est.querySelectorAll('input[name=nx-est-tier]'); tiers[1].checked = true; ev(tiers[1], 'change');
  const qty = est.querySelector('input[name=nx-est-qty]'); qty.value = '3'; ev(qty, 'input');
  est.querySelector('input[name=nx-est-opt]').checked = true; ev(est.querySelector('input[name=nx-est-opt]'), 'change');
  check('estimator: £95 × 3 rooms + £25 add-on = £310', total.textContent === '£310', total.textContent);
  qty.value = '9999'; ev(qty, 'input');
  check('estimator clamps quantity to 999', total.textContent === '£' + (95 * 999 + 25).toLocaleString('en-US'), total.textContent);
  qty.value = '-4'; ev(qty, 'input');
  check('estimator floors quantity at 1 (no negative totals)', total.textContent === '£120', total.textContent);
  const cta = est.querySelector('.nx-est-cta'); cta.click();
  check('"Get an exact quote" pre-fills the contact form with the configuration', /Estimate request: Deep clean/.test(d.querySelector('.nx-form textarea').value), d.querySelector('.nx-form textarea').value);

  // funnel
  const fn = d.querySelector('.nx-funnel'); const steps = fn.querySelectorAll('.nx-funnel-step'); const next = () => fn.querySelector('.nx-funnel-step.on [data-next]');
  next().click();
  check('funnel: cannot advance without choosing a need (inline error, role=alert)', !fn.querySelector('.nx-funnel-error').hidden && steps[0].classList.contains('on'));
  const r0 = steps[0].querySelector('input[name=need]'); r0.checked = true; ev(r0, 'change'); next().click();
  check('funnel: step 2 after a choice; progress marks step 1 done', steps[1].classList.contains('on') && fn.querySelectorAll('.nx-funnel-progress li')[0].classList.contains('done'));
  fn.querySelector('.nx-funnel-step.on [data-prev]').click();
  check('funnel: Back returns to step 1', steps[0].classList.contains('on'));
  next().click(); next().click();
  check('funnel: reaches the contact step', steps[2].classList.contains('on'));
  fn.querySelector('input[name=name]').value = 'Sam'; fn.querySelector('input[name=email]').value = 'not-an-email';
  fn.querySelector('button[type=submit]').click(); await new Promise((r) => setTimeout(r, 20));
  check('funnel: invalid email blocks submit — nothing posted', posts.length === 0 && /email/i.test(fn.querySelector('.nx-funnel-error').textContent));
  fn.querySelector('input[name=email]').value = 'sam@example.com'; fn.querySelector('button[type=submit]').click(); await new Promise((r) => setTimeout(r, 30));
  check('funnel: posts ONE site_lead to the shared webhook with source_widget=funnel', posts.length === 1 && posts[0].url === 'https://api.example/api/public/webhook/tok' && posts[0].body.event === 'site_lead' && posts[0].body.source_widget === 'funnel');
  check('funnel: the answers are folded into the message', /Need: Emergency repairs/.test(posts[0].body.message) && /When:/.test(posts[0].body.message));
  check('funnel: success state shown, steps hidden', !fn.querySelector('.ok').hidden && ![...steps].some((s) => s.classList.contains('on')));

  // filter
  const chips = d.querySelectorAll('.nx-filter-chip'); chips[1].click();
  const cards = [...d.querySelectorAll('.nx-card[data-tags]')];
  check('filter: a chip hides non-matching cards and toggles aria-pressed', cards.some((c) => c.classList.contains('nx-hide')) && chips[1].getAttribute('aria-pressed') === 'true' && chips[0].getAttribute('aria-pressed') === 'false');
  chips[0].click();
  check('filter: "All" restores every card', !cards.some((c) => c.classList.contains('nx-hide')));

  // sticky
  const bar = d.querySelector('.nx-sticky-cta');
  check('sticky bar un-hidden by the runtime and body padded for it', bar.hidden === false && d.body.classList.contains('nx-has-sticky'));
  check('no runtime errors in the page', jsErrors.length === 0, jsErrors.join(' | '));
}

// ───────────────────────────── D. end to end ────────────────────────────
console.log('\n== D. POST /sites → widgets from the brief → funnel lead in the inbox ==');
{
  await init(readFileSync(join(ROOT, 'backend/schema.sql'), 'utf8'));
  const worker = (await import('../backend/src/index.js')).default;
  const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9, ENCRYPTION_KEY: 'k'.repeat(32) };
  const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
  const realFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('no net in tests'); };
  const call = async (method, path, body, token) => {
    const r = await worker.fetch(new Request('http://t.local/api' + path, { method, headers: { 'Content-Type': 'application/json', Origin: 'http://t.local', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch (e) { data = null; }
    return { status: r.status, data, text };
  };
  const reg = await call('POST', '/auth/register', { name: 'W', email: 'w' + Date.now() + '@x.io', password: 'password123' });
  const tok = reg.data.token;
  const desc = 'Private dental clinic in Leeds: teeth whitening from £299, invisalign braces from £2,400, dental implants £1,950, emergency dentist, hygienist visits £65. Call 0113 000 0000, WhatsApp +44 7700 900000, hello@apexdental.co.uk, 12 Park Row Leeds.';
  const r = await call('POST', '/sites', { name: 'Apex Dental', description: desc, build_with_ai: true, deterministic: true }, tok);
  check('deterministic build succeeds', r.status === 200 || r.status === 201, r.status + ' ' + r.text.slice(0, 200));
  const html = r.data?.html || '';
  check('build.widgets reports what was injected', Array.isArray(r.data?.build?.widgets) && r.data.build.widgets.includes('estimator') && r.data.build.widgets.includes('funnel') && r.data.build.widgets.includes('stickycta'), JSON.stringify(r.data?.build?.widgets));
  check('page contains estimator + funnel + sticky bar markup, CSS and runtime', /class="nx-estimator"/.test(html) && /class="nx-funnel"/.test(html) && /class="nx-sticky-cta"/.test(html) && /widget:estimator/.test(html) && /window\.NX_LEAD_URL=/.test(html));
  check('estimator tiers come from the brief prices (£299, £2,400, £1,950, £65)', /data-amount="299"/.test(html) && /data-amount="2400"/.test(html) && /data-amount="1950"/.test(html) && /data-amount="65"/.test(html));
  check('sticky bar has tel: and wa.me links from the brief', /nx-sticky-call" *>|class="nx-sticky-call"/.test(html) && /https:\/\/wa\.me\/447700900000/.test(html));
  check('still exactly one runtime <script> + JSON-LD (no extra script tags)', (html.match(/<script\b(?![^>]*ld\+json)/g) || []).length === 1, String((html.match(/<script\b/g) || []).length));

  // the funnel's payload → inbox with its own subject
  const leadUrl = (html.match(/var NX_LEAD_URL=("(?:[^"\\]|\\.)*");/) || [])[1];
  check('lead URL embedded for the shared runtime', !!leadUrl);
  const path = JSON.parse(leadUrl).replace('http://t.local/api', '');
  const lead = await call('POST', path, { event: 'site_lead', name: 'Funnel Person', email: 'funnel@example.com', phone: '0777', message: 'Quick quote request. Need: Teeth whitening. When: As soon as possible.', source_widget: 'funnel' });
  check('funnel payload accepted by the public webhook', lead.status === 200 && lead.data?.ok === true, lead.text.slice(0, 120));
  const row = await DB.prepare("SELECT m.subject, m.body, c.name FROM messages m JOIN contacts c ON c.id=m.contact_id WHERE c.email='funnel@example.com' ORDER BY m.id DESC LIMIT 1").first();
  check('inbox message carries the quick-quote subject and the folded answers', row && row.subject === 'Website quick-quote request' && /Need: Teeth whitening/.test(row.body) && row.name === 'Funnel Person', JSON.stringify(row));
  const plain = await call('POST', path, { event: 'site_lead', name: 'Form Person', email: 'form@example.com', message: 'hi' });
  const row2 = await DB.prepare("SELECT m.subject FROM messages m JOIN contacts c ON c.id=m.contact_id WHERE c.email='form@example.com' ORDER BY m.id DESC LIMIT 1").first();
  check('a plain contact-form lead keeps the classic subject', plain.status === 200 && row2 && row2.subject === 'Website form message');

  // widgets option through the validator
  const off = await call('POST', '/sites', { name: 'Off', description: desc, build_with_ai: true, deterministic: true, widgets: false }, tok);
  check('widgets:false → no widget markup, build.widgets=[]', off.status < 300 && !/nx-estimator|nx-funnel|nx-sticky-cta|nx-filter-chip/.test(off.data.html) && off.data.build.widgets.length === 0);
  const some = await call('POST', '/sites', { name: 'Some', description: desc, build_with_ai: true, deterministic: true, widgets: ['funnel', 'bogus'] }, tok);
  check('widgets:[funnel,bogus] → only the funnel (+ warning), unknown id ignored', some.status < 300 && JSON.stringify(some.data.build.widgets) === '["funnel"]' && JSON.stringify(some.data.input_warnings || []).includes('bogus'), JSON.stringify(some.data?.build?.widgets) + ' ' + JSON.stringify(some.data?.input_warnings));
  const bad = await call('POST', '/sites', { name: 'Bad', description: desc, build_with_ai: true, deterministic: true, widgets: 'yes please' }, tok);
  check('widgets:"string" → 400 naming the field', bad.status === 400 && /widgets/.test(bad.text));
  const persisted = JSON.parse((await DB.prepare('SELECT theme FROM site_meta WHERE site_id=?').bind(off.data.id).first())?.theme || '{}');
  check('widgets preference persisted with the site theme', persisted.widgets === false, JSON.stringify(persisted).slice(0, 200));

  // a11y markers on every deterministic page
  check('skip link + <main id="main"> on the generated page', /<a class="nx-skip" href="#main">/.test(html) && /<main id="main">/.test(html));
  check(':focus-visible ring shipped in the page CSS', /:focus-visible\{outline:3px solid/.test(html));
  check('proof block without quotes is headed "By the numbers", not "What people say"', !/What patients say|What people say/.test(html) || /class="nx-review"/.test(html));
  globalThis.fetch = realFetch;
}

// ───────────────────────────── E. WCAG AA ───────────────────────────────
console.log('\n== E. WCAG AA across every palette and theme ==');
{
  const hex = (h) => { const m = String(h).replace('#', ''); const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m; return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };
  const lum = (h) => { const [r, g, b] = hex(h).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

  // builder palettes: through nxTokensFor for every palette + variant seed
  const src = readFileSync(join(ROOT, 'backend/src/nx_site_builder.js'), 'utf8');
  const m = src.match(/const PALETTES = (\{[\s\S]*?\n\});/);
  const PALETTES = m ? (0, eval)('(' + m[1] + ')') : null;
  check('PALETTES literal readable from nx_site_builder.js', !!PALETTES);
  const fails = [];
  let palettes = 0;
  for (const personality of Object.keys(PALETTES || {})) {
    for (let v = 0; v < PALETTES[personality].length; v++) {
      palettes++;
      for (const mode of ['light', 'dark']) {
        const t = BUILDER.nxTokensFor({ name: 'X', personality: { primary: personality }, _industry: 'dental' }, { mode, variant: v });
        const p = t.palette;
        if (!t.checks || t.checks.aa !== true) fails.push(`${personality}/${p.name}/${mode}: ${JSON.stringify(t.checks)}`);
        for (const bg of [p.bg, p.bg2, p.card]) {
          if (contrast(p.text, bg) < 4.5) fails.push(`${p.name}: text on ${bg} ${contrast(p.text, bg).toFixed(2)}`);
          if (contrast(p.muted, bg) < 4.5) fails.push(`${p.name}: muted on ${bg} ${contrast(p.muted, bg).toFixed(2)}`);
          if (contrast(t.linkText, bg) < 4.5) fails.push(`${p.name}: link on ${bg} ${contrast(t.linkText, bg).toFixed(2)}`);
        }
        if (contrast(t.btnText, p.accent) < 4.5) fails.push(`${p.name}: button label ${contrast(t.btnText, p.accent).toFixed(2)}`);
      }
    }
  }
  check(`every builder palette (${palettes}) passes AA for text, muted, links and button labels`, fails.length === 0, fails.slice(0, 4).join(' | '));
  check('nxTokensFor exposes linkText/accentText + per-surface checks', (() => { const t = BUILDER.nxTokensFor({ name: 'X', personality: { primary: 'warm' } }, { mode: 'light', variant: 0 }); return typeof t.linkText === 'string' && typeof t.accentText === 'string' && 'linkOnBg' in t.checks && 'mutedOnCard' in t.checks; })());

  // catalog themes: text + muted on all three surfaces
  const themeFails = [];
  const themes = CATALOG.SITE_THEMES || {};
  const ids = Object.keys(themes);
  for (const id of ids) {
    const css = typeof themes[id] === 'string' ? themes[id] : (themes[id].css || themes[id].vars || JSON.stringify(themes[id]));
    const get = (k) => { const mm = String(css).match(new RegExp('--' + k + ':\\s*(#[0-9a-fA-F]{3,8})')); return mm ? mm[1].slice(0, 7) : null; };
    const text = get('text'), muted = get('muted');
    for (const k of ['bg', 'bg2', 'card']) {
      const bg = get(k); if (!bg || !text) continue;
      if (contrast(text, bg) < 4.5) themeFails.push(`${id}: text/${k} ${contrast(text, bg).toFixed(2)}`);
      if (muted && contrast(muted, bg) < 4.5) themeFails.push(`${id}: muted/${k} ${contrast(muted, bg).toFixed(2)}`);
    }
  }
  check(`every catalog theme (${ids.length}) keeps body + muted text ≥ 4.5:1 on bg/bg2/card`, ids.length >= 40 && themeFails.length === 0, themeFails.slice(0, 5).join(' | '));

  // the generic focus ring + skip link ship even when the palette scope is off
  const t = BUILDER.nxTokensFor({ name: 'X', personality: { primary: 'bold' } }, { mode: 'dark', variant: 1 });
  const cssOff = BUILDER.nxTokensCss(t, { palette: false, fonts: false });
  check('focus ring + skip-link CSS present even with an owner-pinned theme', /:focus-visible\{outline:3px solid var\(--accent\)/.test(cssOff) && /\.nx-skip\{/.test(cssOff));
}

// ───────────────────────────── F. brief understanding ───────────────────
console.log('\n== F. brief understanding that feeds the widgets ==');
{
  const BRIEF = require('../backend/src/nx_brief.js');
  const COPY = require('../backend/src/nx_copywriter.js');
  const DB_ = await import('../backend/src/site/design_brain.js');
  const u = (name, description) => BRIEF.nxUnderstandBrief({ name, description });
  const dental = u('Apex Dental', 'Private dental clinic in Leeds: teeth whitening from £299, invisalign braces from £2,400, dental implants £1,950, emergency dentist, hygienist visits £65, root canal, crowns and veneers, children\'s dentistry. 15 years experience, 3,000 happy patients, rated 4.9 on Google. Call 0113 000 0000, WhatsApp +44 7700 900000, hello@apexdental.co.uk.');
  const titles = dental.services.map((s) => s.title);
  check('"£2,400" is not split at the thousands separator', !titles.some((t) => /^\d|^,/.test(t)) && titles.includes('Invisalign braces'), JSON.stringify(titles));
  check('priced items are still recognised as services (8 from the colon list)', titles.length >= 7 && titles.includes('Teeth whitening') && titles.includes('Hygienist visits') && titles.includes('Root canal'), JSON.stringify(titles));
  check('"15 years experience" / "3,000 happy patients" are proof, not services', !titles.some((t) => /experience|patients/i.test(t)) && dental.proof.some((p) => p.value === '3,000'));
  check('prices carry the label of what was priced', dental.prices.map((p) => p.label).join('|') === 'teeth whitening|invisalign braces|dental implants|hygienist visits', JSON.stringify(dental.prices.map((p) => p.label)));
  check('"WhatsApp +44 7700 900000" labels the number AFTER it, the landline stays the phone', dental.contact.phone === '0113 000 0000' && dental.contact.whatsapp === '+44 7700 900000', JSON.stringify(dental.contact));
  const hours = u('Time', 'Opening hours: Mon-Fri 9-5, Sat 10-2. Call us on 0100 000 0000.');
  check('an "Opening hours:" colon list is hours, never services', hours.services.length === 0 && /Mon-Fri 9-5/.test(hours.contact.hours[0] || ''), JSON.stringify(hours.services));
  const law = u('Law', 'Boutique law firm in Manchester. Practice areas: family law, conveyancing, wills and probate, employment disputes.');
  check('"Practice areas:" list → services', law.services.map((s) => s.title).includes('Conveyancing') && law.services.length >= 4, JSON.stringify(law.services.map((s) => s.title)));
  const plan = (b) => { const w = COPY.nxWriteSite(b, {}); return COPY.nxContentPlanFromWriteup(b, w, {}); };
  const tiers = plan(dental).pricing.map((t) => t.name + '=' + t.price);
  check('pricing tiers are named after the priced service, not "Standard/Option 2"', tiers.join('|') === 'Teeth whitening=from £299|Invisalign braces=from £2,400|Dental implants=£1,950|Hygienist visits=£65', tiers.join('|'));
  const bare = plan(u('Studio', 'Photography studio. Prices from £250. Weddings, portraits, events.')).pricing;
  check('a bare "prices from £250" becomes a starting-price tier — never attributed to the first service', bare.length === 1 && bare[0].name === 'Starting price' && bare[0].price === 'from £250', JSON.stringify(bare));
  const clean = plan(u('Clean Co', 'Domestic cleaning in Bristol. Regular clean £18 per hour, deep clean from £120, end of tenancy from £220, oven cleaning £45.')).pricing;
  check('per-unit prices keep their unit (£18 per hour)', clean[0].name === 'Regular clean' && clean[0].per === 'hour', JSON.stringify(clean[0]));

  // prompt budget: the RULES + widget vocabulary always survive
  const big = { hero: { h: 'x'.repeat(300) }, services: [...Array(6)].map((_, i) => ({ title: 's' + i, text: 't'.repeat(120) })), faq: [...Array(8)].map((_, i) => ({ q: 'q' + i, a: 'a'.repeat(200) })), about: { body: 'b'.repeat(1500) }, process: [...Array(4)].map(() => ({ t: 'p'.repeat(200) })), why: [...Array(4)].map(() => ({ text: 'w'.repeat(200) })), contact: { phone: '1' } };
  const spec = 'CONTENT PLAN (…):\nBRIEF: ' + JSON.stringify({ name: 'X', facts: 'f'.repeat(2500) }) + '\nSITEMAP (render in this order): ["hero"]\nCOPY: ' + JSON.stringify(big) + '\nHARD RULES: never invent numbers.';
  const m = DB_.nxBuilderMessages({ sectionList: 'nav, hero, services, faq, contact, footer', contentSpec: spec, design: {}, prefs: {}, sceneHint: '\n' + W.nxWidgetsVocab(['estimator', 'funnel']) });
  check('an oversize content plan is trimmed under the 8,000-char message cap', spec.length > DB_.MAX_MSG_CHARS - 1500 && m.user.length <= DB_.MAX_MSG_CHARS, String(m.user.length));
  check('…and the RULES + widget vocabulary + HARD RULES still reach the model', /Output ONLY the body HTML\.$/.test(m.user) && /INTERACTIVE WIDGETS/.test(m.user) && /HARD RULES/.test(m.user));
  check('…least important copy goes first (faq/process/why dropped, hero/services/contact kept)', !/"faq"/.test(m.user) && /"hero"/.test(m.user) && /"services"/.test(m.user) && /"contact"/.test(m.user));
  const small = DB_.nxBuilderMessages({ sectionList: 'nav, hero', contentSpec: 'CONTENT PLAN:\nBRIEF: {}\nSITEMAP (render in this order): []\nCOPY: {"hero":1}\nHARD RULES: x', design: {}, prefs: {} });
  check('a content plan that fits is passed through untouched', /COPY: \{"hero":1\}/.test(small.user));
  const specFor = (desc) => BUILDER.nxAiContentSpec(BUILDER.nxBuildSitePlan('Apex Dental', desc, { plan: {}, instructions: '' }));
  const longDesc = ('Private dental clinic in Leeds: teeth whitening from £299, invisalign braces from £2,400, dental implants £1,950, emergency dentist, hygienist visits £65. 15 years experience, 3,000 happy patients, rated 4.9 on Google. Call 0113 000 0000, WhatsApp +44 7700 900000, hello@apexdental.co.uk, 12 Park Row Leeds. Mon-Fri 8-6. Dr Sarah Khan (principal dentist). Free parking. 0% finance available. ').repeat(3);
  check('the content spec no longer carries provenance noise (evidence/source/candidates)', !/"evidence"|"source"|"candidates"/.test(specFor(longDesc)) && specFor(longDesc).length < 6500, String(specFor(longDesc).length));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
process.exit(0);
