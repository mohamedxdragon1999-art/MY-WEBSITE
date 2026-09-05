// ═════════════════════════════════════════════════════════════════
// site/widgets.js — interactive micro-widgets for generated sites.
//
// Every widget is: deterministic markup (from PLAN facts only), a few lines
// of token-driven CSS, and a self-contained vanilla runtime that activates
// only when its markup is on the page. Zero external JS, no icon fonts, no
// build step. Each widget degrades gracefully with JavaScript disabled
// (the estimator is a plain <form>, the funnel shows every step, the filter
// shows every card, the sticky bar is an ordinary link).
//
//   estimator   — instant cost estimate from the plan's prices (tier × qty
//                 + options); a "get an exact quote" button pre-fills the
//                 contact form with the chosen configuration.
//   funnel      — 3-step lead funnel (need → details → contact) that posts
//                 to the SAME site_lead webhook as the contact form, with
//                 the answers folded into the message.
//   filter      — filter chips over the services grid / gallery
//                 (data-tags on cards; "All" resets), keyboard operable.
//   stickycta   — mobile bottom action bar (call / WhatsApp / primary CTA)
//                 that appears once the hero has scrolled away.
//
// Exports
//   nxWidgetPlan(plan, opts)          → which widgets apply (+ their data)
//   nxWidgetHtml(kind, data, ctx)     → markup for one widget
//   nxWidgetsCss(kinds)               → CSS for the kinds present
//   nxWidgetsJs(kinds)                → runtime for the kinds present
//   nxWidgetsVocab()                  → prompt lines describing the markup
//                                       contract for the model
//   nxAttachFilterTags(html, plan)    → adds data-tags to .nx-card / gallery
//                                       imgs so the filter has something to
//                                       act on, even in model output
// Pure, dependency-free, deterministic.
// ═════════════════════════════════════════════════════════════════

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (v) => esc(v).replace(/'/g, '&#39;');
const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const arr = (v) => (Array.isArray(v) ? v : []);
const slug = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';

export const WIDGET_KINDS = Object.freeze(['estimator', 'funnel', 'filter', 'stickycta']);

/* ── money parsing (plan prices are strings the owner typed) ──────────── */
export function nxParseMoney(v) {
  const s = clean(v);
  if (!s) return null;
  const m = s.match(/(?:(£|\$|€|EGP|USD|GBP|EUR|AED|SAR|E£|LE)\s?)?(\d[\d,]*(?:\.\d{1,2})?)\s?(£|\$|€|EGP|USD|GBP|EUR|AED|SAR|LE|pounds|dollars|euros)?/i);
  if (!m) return null;
  const amount = Number(String(m[2]).replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const sym = (m[1] || m[3] || '').toUpperCase();
  const currency = /^£|GBP|POUNDS/.test(sym) ? '£' : /^\$|USD|DOLLARS/.test(sym) ? '$' : /^€|EUR|EUROS/.test(sym) ? '€' : /EGP|E£|^LE$/.test(sym) ? 'EGP ' : /AED/.test(sym) ? 'AED ' : /SAR/.test(sym) ? 'SAR ' : '';
  return { amount, currency, from: /\bfrom\b|starting/i.test(s) };
}

/* ── which widgets apply to this plan ─────────────────────────────────── */
export function nxWidgetPlan(plan, opts) {
  plan = plan || {}; opts = opts || {};
  const out = { kinds: [], estimator: null, funnel: null, filter: null, stickycta: null };
  const off = new Set(arr(opts.disable).map(String));
  const only = Array.isArray(opts.only) ? new Set(opts.only.map(String)) : null;
  const want = (k) => !off.has(k) && (!only || only.has(k));

  // estimator: needs ≥2 priced tiers (or 1 tier + a per-unit) from the plan
  const tiers = arr(plan.pricing).map((p) => ({ name: clean(p.name || p.title), money: nxParseMoney(p.price || p.amount), per: clean(p.per || '') })).filter((t) => t.name && t.money);
  if (want('estimator') && tiers.length >= 2) {
    const currency = tiers[0].money.currency || '';
    const unitLabel = tiers.find((t) => t.per) ? (tiers.find((t) => t.per).per) : '';
    out.estimator = { currency, tiers: tiers.slice(0, 6).map((t) => ({ id: slug(t.name), name: t.name, amount: t.money.amount, from: t.money.from, per: t.per })), unit: unitLabel, options: arr(plan.estimator_options).slice(0, 4).map((o) => ({ id: slug(o.name || o), name: clean(o.name || o), amount: Number(o.amount) || 0 })).filter((o) => o.name && o.amount > 0) };
    out.kinds.push('estimator');
  }
  // funnel: any business with ≥2 services (the "what do you need" step) and a lead form
  const services = arr(plan.services).map((s) => clean(s.title || s.name || s)).filter(Boolean);
  if (want('funnel') && services.length >= 2 && opts.funnel !== false) {
    out.funnel = { services: services.slice(0, 8), urgency: opts.urgency || ['As soon as possible', 'Within a month', 'Just planning ahead'], brand: clean(plan.name || '') };
    out.kinds.push('funnel');
  }
  // filter: ≥5 services with inferable categories, or a gallery with ≥6 images
  const cats = serviceCategories(plan);
  const gallery = arr(plan.gallery_imgs);
  if (want('filter') && (cats.groups.length >= 2 && services.length >= 5 || gallery.length >= 6)) {
    out.filter = { target: cats.groups.length >= 2 && services.length >= 5 ? 'services' : 'gallery', groups: cats.groups, byService: cats.byService };
    out.kinds.push('filter');
  }
  // sticky CTA: whenever there is a phone/whatsapp or a primary CTA
  const c = plan.contact || {};
  const primary = clean((plan.hero && plan.hero.primary) || (plan.cta && plan.cta.primary) || 'Get in touch');
  if (want('stickycta') && (c.phone || c.whatsapp || primary)) {
    out.stickycta = { phone: clean(c.phone || ''), whatsapp: clean(c.whatsapp || ''), primary: primary.slice(0, 22) };
    out.kinds.push('stickycta');
  }
  return out;
}

const CATEGORY_RULES = [
  ['Repairs', /repair|fix|leak|fault|breakdown|emergency|blocked|burst/i],
  ['Installation', /install|fit|fitting|new|replace|replacement|upgrade/i],
  ['Maintenance', /maintain|maintenance|service|servicing|clean|cleaning|inspection|check|annual/i],
  ['Cosmetic', /whiten|veneer|invisalign|align|smile|facial|botox|filler|lash|brow|nails?|colour|color|highlights/i],
  ['Treatments', /treatment|therapy|massage|implant|filling|crown|root|extraction|hygien|physio|consult/i],
  ['Design', /design|brand|logo|ui|ux|website|web|graphic|interior|landscape/i],
  ['Development', /develop|app|software|code|api|integration|automation|seo|marketing|ads/i],
  ['Events', /wedding|event|party|corporate|birthday|celebration|catering|venue/i],
  ['Training', /class|course|lesson|training|coaching|workshop|tuition|tutor/i],
  ['Property', /property|home|house|residential|commercial|office|garden|roof|kitchen|bathroom|extension/i],
];
function serviceCategories(plan) {
  const byService = {};
  const counts = new Map();
  for (const s of arr(plan.services)) {
    const title = clean(s.title || s.name || s); if (!title) continue;
    const text = title + ' ' + clean(s.text || s.desc || '');
    let cat = '';
    for (const [name, re] of CATEGORY_RULES) { if (re.test(text)) { cat = name; break; } }
    if (!cat) cat = 'More';
    byService[title] = cat;
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  const groups = [...counts.entries()].filter(([name, n]) => name !== 'More' || counts.size <= 2).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  return { groups: groups.slice(0, 6), byService };
}

/* ── markup ───────────────────────────────────────────────────────────── */
export function nxWidgetHtml(kind, data, ctx) {
  ctx = ctx || {};
  const reveal = ctx.reveal !== false ? ' data-reveal' : '';
  if (kind === 'estimator' && data) {
    const cur = data.currency || '';
    const tiers = data.tiers.map((t, i) => `<label class="nx-est-tier"><input type="radio" name="nx-est-tier" value="${attr(t.id)}" data-amount="${t.amount}"${i === 0 ? ' checked' : ''}><span><b>${esc(t.name)}</b><small>${t.from ? 'from ' : ''}${esc(cur)}${fmt(t.amount)}${t.per ? ' / ' + esc(t.per) : ''}</small></span></label>`).join('');
    const opts = data.options.length ? `<fieldset class="nx-est-opts"><legend>Add-ons</legend>${data.options.map((o) => `<label><input type="checkbox" name="nx-est-opt" value="${attr(o.id)}" data-amount="${o.amount}"> <span>${esc(o.name)} <small>+${esc(cur)}${fmt(o.amount)}</small></span></label>`).join('')}</fieldset>` : '';
    const unit = data.unit ? `<label class="nx-est-qty">How many ${esc(data.unit)}s? <input type="number" name="nx-est-qty" min="1" max="999" value="1" inputmode="numeric"></label>` : '';
    return `<section class="section" id="estimate"${reveal}><div class="container"><span class="eyebrow">Instant estimate</span><h2 class="sec-title">${esc(ctx.title || 'What will it cost?')}</h2><form class="nx-estimator" data-currency="${attr(cur)}" aria-describedby="nx-est-note"><div class="nx-est-grid"><div>${tiers}${unit}${opts}</div><div class="nx-est-result" aria-live="polite"><span>Estimated total</span><strong class="nx-est-total">${esc(cur)}${fmt(data.tiers[0].amount)}</strong><p id="nx-est-note" class="nx-note">A guide price based on our published rates — the exact quote depends on the details. No obligation.</p><a class="btn btn-primary nx-est-cta" href="#contact">${esc(ctx.cta || 'Get an exact quote')}</a></div></div></form></div></section>`;
  }
  if (kind === 'funnel' && data) {
    const services = data.services.map((s) => `<label class="nx-chip"><input type="radio" name="need" value="${attr(s)}" required><span>${esc(s)}</span></label>`).join('');
    const urgency = data.urgency.map((u) => `<label class="nx-chip"><input type="radio" name="when" value="${attr(u)}"><span>${esc(u)}</span></label>`).join('');
    return `<section class="section nx-alt" id="quote"${reveal}><div class="container"><span class="eyebrow">Quick quote</span><h2 class="sec-title">${esc(ctx.title || 'Tell us what you need — 30 seconds')}</h2><form class="nx-funnel" novalidate><ol class="nx-funnel-progress" aria-label="Progress"><li class="on">Need</li><li>Details</li><li>Contact</li></ol><fieldset class="nx-funnel-step on" data-step="1"><legend>What do you need help with?</legend><div class="nx-chips">${services}</div><div class="nx-funnel-nav"><button type="button" class="btn btn-primary" data-next>Next</button></div></fieldset><fieldset class="nx-funnel-step" data-step="2"><legend>When do you need it?</legend><div class="nx-chips">${urgency}</div><label for="nx-fn-notes">Anything we should know? (optional)</label><textarea id="nx-fn-notes" name="notes" rows="3" maxlength="600"></textarea><div class="nx-funnel-nav"><button type="button" class="btn btn-ghost" data-prev>Back</button><button type="button" class="btn btn-primary" data-next>Next</button></div></fieldset><fieldset class="nx-funnel-step" data-step="3"><legend>Where should we send your quote?</legend><label for="nx-fn-name">Your name</label><input id="nx-fn-name" name="name" required autocomplete="name"><label for="nx-fn-email">Email</label><input id="nx-fn-email" name="email" type="email" required autocomplete="email"><label for="nx-fn-phone">Phone (optional)</label><input id="nx-fn-phone" name="phone" autocomplete="tel" inputmode="tel"><div class="nx-funnel-nav"><button type="button" class="btn btn-ghost" data-prev>Back</button><button type="submit" class="btn btn-primary">${esc(ctx.cta || 'Send my request')}</button></div></fieldset><p class="nx-funnel-error" role="alert" hidden></p><p class="ok" hidden>Thanks — we have your request and will reply with a quote soon.</p></form></div></section>`;
  }
  if (kind === 'filter' && data) {
    const chips = ['All'].concat(data.groups).map((g, i) => `<button type="button" class="nx-filter-chip${i === 0 ? ' on' : ''}" data-filter="${attr(i === 0 ? '*' : slug(g))}" aria-pressed="${i === 0 ? 'true' : 'false'}">${esc(g)}</button>`).join('');
    return `<div class="nx-filter" role="group" aria-label="Filter" data-target="${attr(data.target)}">${chips}</div>`;
  }
  if (kind === 'stickycta' && data) {
    const tel = data.phone ? `<a href="tel:${attr(String(data.phone).replace(/[^\d+]/g, ''))}" class="nx-sticky-call">Call</a>` : '';
    const wa = data.whatsapp ? `<a href="https://wa.me/${attr(String(data.whatsapp).replace(/\D/g, ''))}" rel="noopener" target="_blank" class="nx-sticky-wa">WhatsApp</a>` : '';
    return `<div class="nx-sticky-cta" hidden aria-hidden="true">${tel}${wa}<a href="#contact" class="btn btn-primary">${esc(data.primary || 'Get in touch')}</a></div>`;
  }
  return '';
}
function fmt(n) { n = Number(n) || 0; return n % 1 === 0 ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : n.toFixed(2); }

/**
 * Give service cards / gallery images data-tags (category slugs) so the
 * filter chips can act on them. Works on deterministic AND model markup:
 * a card is matched by its <h3> text; unknown cards get "more".
 */
export function nxAttachFilterTags(html, plan, filter) {
  if (!filter) return html;
  let s = String(html || '');
  if (filter.target === 'services') {
    const byService = filter.byService || {};
    const lookup = Object.keys(byService).map((k) => [k.toLowerCase(), slug(byService[k])]);
    s = s.replace(/<div class="nx-card([^"]*)"([^>]*)>([\s\S]*?<h3>([\s\S]*?)<\/h3>)/g, (m, cls, rest, inner, h3) => {
      if (/data-tags=/.test(rest)) return m;
      const title = clean(h3.replace(/<[^>]+>/g, '')).toLowerCase();
      const hit = lookup.find(([k]) => k === title) || lookup.find(([k]) => title.includes(k) || k.includes(title));
      return `<div class="nx-card${cls}" data-tags="${hit ? hit[1] : 'more'}"${rest}>${inner}`;
    });
  } else if (filter.target === 'gallery') {
    let i = 0; const groups = filter.groups.length ? filter.groups.map(slug) : ['work'];
    s = s.replace(/<img([^>]*class="[^"]*nx-gallery[^"]*"[^>]*)>|(<div class="nx-gallery">)([\s\S]*?)(<\/div>)/g, (m, single, open, inner, close) => {
      if (!open) return m;
      const tagged = inner.replace(/<img\b([^>]*)>/g, (im, a) => (/data-tags=/.test(a) ? im : `<img data-tags="${groups[i++ % groups.length]}"${a}>`));
      return open + tagged + close;
    });
  }
  return s;
}

/* ── CSS (token-driven; nothing hard-coded but geometry) ──────────────── */
const CSS = {
  estimator: `.nx-estimator{margin-top:22px}.nx-est-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:24px;align-items:start}@media(max-width:820px){.nx-est-grid{grid-template-columns:1fr}}
.nx-est-tier{display:flex;gap:12px;align-items:center;padding:14px 16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);margin-bottom:10px;cursor:pointer;transition:border-color .2s}.nx-est-tier:has(input:checked){border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}.nx-est-tier input{accent-color:var(--accent);width:18px;height:18px;margin:0}.nx-est-tier span{display:flex;flex-direction:column}.nx-est-tier small{color:var(--muted);font-size:13px}
.nx-est-qty{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:14px 0;font-weight:600}.nx-est-qty input{width:96px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg2);color:var(--text);font:inherit}
.nx-est-opts{border:1px solid var(--line);border-radius:var(--radius);padding:12px 16px 6px;margin:0}.nx-est-opts legend{padding:0 6px;font-weight:700;font-size:14px}.nx-est-opts label{display:flex;gap:10px;align-items:center;padding:8px 0;cursor:pointer}.nx-est-opts input{accent-color:var(--accent);width:18px;height:18px;margin:0}.nx-est-opts small{color:var(--muted)}
.nx-est-result{position:sticky;top:90px;padding:26px;border-radius:var(--radius);background:var(--card);border:1px solid var(--line);display:flex;flex-direction:column;gap:8px}.nx-est-result>span{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.08em}.nx-est-result .nx-est-cta{width:100%;text-align:center;margin-top:6px}.nx-est-result .nx-est-total{display:block;font-size:clamp(34px,4.6vw,52px);font-weight:800;line-height:1;letter-spacing:-.02em}.nx-est-result .nx-note{margin:6px 0 10px;font-size:13px}`,
  funnel: `.nx-funnel{max-width:720px;margin:26px auto 0;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px}
.nx-funnel-progress{display:flex;gap:8px;list-style:none;padding:0;margin:0 0 20px;counter-reset:fs}.nx-funnel-progress li{flex:1;text-align:center;font-size:13px;font-weight:600;color:var(--muted);padding:10px 6px;border-radius:999px;background:var(--bg2);position:relative}.nx-funnel-progress li.on{color:var(--text);background:color-mix(in srgb,var(--accent) 18%,var(--bg2))}.nx-funnel-progress li.done{color:var(--text)}.nx-funnel-progress li.done::before{content:"✓ "}
.nx-funnel-step{border:0;padding:0;margin:0;display:none}.nx-funnel-step.on{display:block}.nx-funnel-step legend{font-size:clamp(20px,2.6vw,26px);font-weight:800;margin-bottom:16px;letter-spacing:-.01em}
.nx-chips{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px}.nx-chip{position:relative}.nx-chip input{position:absolute;opacity:0;inset:0;width:100%;height:100%;margin:0;cursor:pointer}.nx-chip span{display:inline-flex;align-items:center;min-height:44px;padding:10px 18px;border:1px solid var(--line);border-radius:999px;background:var(--bg2);font-weight:600;font-size:15px;transition:all .2s}.nx-chip input:checked+span{background:var(--accent);color:var(--on-accent,#111);border-color:var(--accent)}.nx-chip input:focus-visible+span{outline:3px solid var(--accent);outline-offset:3px}
.nx-funnel label{display:block;font-size:13px;color:var(--muted);margin:10px 0 4px}.nx-funnel input,.nx-funnel textarea{width:100%;background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:13px 16px;color:var(--text);font:inherit;font-size:15px}.nx-funnel input:focus,.nx-funnel textarea:focus{border-color:var(--accent);outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.nx-funnel-nav{display:flex;justify-content:space-between;gap:12px;margin-top:20px}.nx-funnel-nav .btn:only-child{margin-left:auto}.nx-funnel-error{color:#c0392b;font-weight:600;margin:12px 0 0}.nx-funnel .ok{margin-top:14px;font-weight:600}
@media(prefers-reduced-motion:no-preference){.nx-funnel-step.on{animation:nxFs .35s var(--ease)}@keyframes nxFs{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}}
.nx-js .nx-funnel-step:not(.on){display:none}`,
  filter: `.nx-filter{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 22px}.nx-filter-chip{min-height:44px;padding:10px 16px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--text);font:inherit;font-weight:600;font-size:14px;cursor:pointer;transition:all .2s}.nx-filter-chip:hover{border-color:var(--accent)}.nx-filter-chip.on{background:var(--accent);color:var(--on-accent,#111);border-color:var(--accent)}
[data-tags].nx-hide{display:none!important}`,
  stickycta: `.nx-sticky-cta{position:fixed;left:0;right:0;bottom:0;z-index:60;display:none;gap:10px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--line)}.nx-sticky-cta.show{display:flex}.nx-sticky-cta a{flex:1;display:inline-flex;align-items:center;justify-content:center;min-height:46px;border-radius:12px;font-weight:700;text-decoration:none;font-size:15px}.nx-sticky-cta .nx-sticky-call,.nx-sticky-cta .nx-sticky-wa{background:var(--card);border:1px solid var(--line);color:var(--text)}.nx-sticky-cta .btn{flex:1.4}
@media(min-width:900px){.nx-sticky-cta.show{display:none}}body.nx-has-sticky{padding-bottom:72px}@media(min-width:900px){body.nx-has-sticky{padding-bottom:0}}`,
};
export function nxWidgetsCss(kinds) {
  return arr(kinds).filter((k) => CSS[k]).map((k) => '/* widget:' + k + ' */\n' + CSS[k]).join('\n');
}

/* ── runtime (plain ES5-ish, activates only on present markup) ────────── */
const JS = {
  estimator: `(function(){var f=document.querySelector('.nx-estimator');if(!f)return;var out=f.querySelector('.nx-est-total'),cur=f.getAttribute('data-currency')||'',qty=f.querySelector('input[name=nx-est-qty]');
function fmt(n){return n%1===0?String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g,','):n.toFixed(2);}
function calc(){var t=f.querySelector('input[name=nx-est-tier]:checked'),base=t?+t.getAttribute('data-amount')||0:0,q=qty?Math.max(1,Math.min(999,parseInt(qty.value,10)||1)):1,add=0;f.querySelectorAll('input[name=nx-est-opt]:checked').forEach(function(o){add+=+o.getAttribute('data-amount')||0;});var total=base*q+add;if(out)out.textContent=cur+fmt(total);var cta=f.querySelector('.nx-est-cta');if(cta){var parts=[t?t.parentElement.querySelector('b').textContent:'',q>1?q+' x':'',f.querySelectorAll('input[name=nx-est-opt]:checked').length?'+ add-ons':''].filter(Boolean).join(' ');cta.setAttribute('data-summary',parts+' ~ '+cur+fmt(total));}}
f.addEventListener('change',calc);f.addEventListener('input',calc);f.addEventListener('submit',function(e){e.preventDefault();});calc();
var cta=f.querySelector('.nx-est-cta');if(cta)cta.addEventListener('click',function(){var m=document.querySelector('.nx-form textarea[name=message]');if(m&&!m.value){m.value='Estimate request: '+(cta.getAttribute('data-summary')||'')+'. Please send an exact quote.';}});})();`,
  funnel: `(function(){var f=document.querySelector('.nx-funnel');if(!f)return;document.documentElement.classList.add('nx-js');var steps=[].slice.call(f.querySelectorAll('.nx-funnel-step')),prog=[].slice.call(f.querySelectorAll('.nx-funnel-progress li')),err=f.querySelector('.nx-funnel-error'),cur=0;
function show(i){cur=i;steps.forEach(function(s,k){s.classList.toggle('on',k===i);});prog.forEach(function(p,k){p.classList.toggle('on',k===i);p.classList.toggle('done',k<i);});if(err){err.hidden=true;err.textContent='';}var first=steps[i].querySelector('input,textarea,button');if(first&&i>0)try{first.focus({preventScroll:true});}catch(e){/* focus options unsupported (old Safari) — the step is still shown */}}
function fail(msg){if(err){err.textContent=msg;err.hidden=false;}}
function valid(i){var s=steps[i];if(i===0&&!s.querySelector('input[name=need]:checked')){fail('Pick the option closest to what you need.');return false;}if(i===2){var n=s.querySelector('input[name=name]'),e=s.querySelector('input[name=email]');if(!n.value.trim()){fail('Please add your name.');n.focus();return false;}if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(e.value.trim())){fail('That email address does not look right.');e.focus();return false;}}return true;}
f.addEventListener('click',function(e){var b=e.target.closest('[data-next],[data-prev]');if(!b)return;if(b.hasAttribute('data-next')){if(valid(cur))show(Math.min(steps.length-1,cur+1));}else show(Math.max(0,cur-1));});
f.addEventListener('submit',function(e){e.preventDefault();if(!valid(2))return;var url=(typeof window.NX_LEAD_URL==='string'&&window.NX_LEAD_URL)||'';var get=function(n){var el=f.querySelector('[name='+n+']:checked')||f.querySelector('[name='+n+']');return el?el.value.trim():'';};
var data={event:'site_lead',name:get('name'),email:get('email'),phone:get('phone'),message:'Quick quote request. Need: '+get('need')+'. When: '+(get('when')||'not said')+'.'+(get('notes')?' Notes: '+get('notes'):''),source_widget:'funnel'};
var btn=f.querySelector('button[type=submit]');if(btn)btn.disabled=true;
if(!url){var tel=document.querySelector('a[href^="tel:"]');fail('This form is not connected yet. '+(tel?'Please call '+tel.textContent.trim()+'.':'Please use the contact details on this page.'));if(btn)btn.disabled=false;return;}
fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json();}).then(function(j){if(j&&j.ok){steps.forEach(function(s){s.classList.remove('on');});prog.forEach(function(p){p.classList.add('done');p.classList.remove('on');});var ok=f.querySelector('.ok');if(ok)ok.hidden=false;}else{fail((j&&j.error)||'Could not send - try again.');if(btn)btn.disabled=false;}}).catch(function(){fail('Could not reach the server.');if(btn)btn.disabled=false;});});
show(0);})();`,
  filter: `(function(){document.querySelectorAll('.nx-filter').forEach(function(bar){var target=bar.getAttribute('data-target')||'services',scope=bar.parentElement||document,items=[].slice.call(scope.querySelectorAll('[data-tags]'));if(!items.length)items=[].slice.call(document.querySelectorAll('[data-tags]'));
bar.addEventListener('click',function(e){var b=e.target.closest('.nx-filter-chip');if(!b)return;var v=b.getAttribute('data-filter')||'*';bar.querySelectorAll('.nx-filter-chip').forEach(function(c){var on=c===b;c.classList.toggle('on',on);c.setAttribute('aria-pressed',on?'true':'false');});var shown=0;items.forEach(function(it){var tags=(it.getAttribute('data-tags')||'').split(/\\s+/);var ok=v==='*'||tags.indexOf(v)!==-1;it.classList.toggle('nx-hide',!ok);if(ok)shown++;});bar.setAttribute('data-shown',shown);});});})();`,
  stickycta: `(function(){var bar=document.querySelector('.nx-sticky-cta');if(!bar)return;var hero=document.querySelector('.nx-hero')||document.querySelector('header'),contact=document.getElementById('contact');document.body.classList.add('nx-has-sticky');bar.hidden=false;
function upd(){var past=hero?hero.getBoundingClientRect().bottom<0:scrollY>400;var atContact=contact?contact.getBoundingClientRect().top<innerHeight*0.6:false;var on=past&&!atContact;bar.classList.toggle('show',on);bar.setAttribute('aria-hidden',on?'false':'true');}
addEventListener('scroll',upd,{passive:true});addEventListener('resize',upd,{passive:true});upd();})();`,
};
export function nxWidgetsJs(kinds) {
  return arr(kinds).filter((k) => JS[k]).map((k) => '/* widget:' + k + ' */\n' + JS[k]).join('\n');
}

/* ── prompt contract for the model ────────────────────────────────────── */
export function nxWidgetsVocab(kinds) {
  const k = new Set(arr(kinds));
  const lines = [];
  if (k.has('filter')) lines.push('- filter chips: put <div class="nx-filter" role="group" aria-label="Filter" data-target="services"> with button.nx-filter-chip[data-filter] (first chip "All" data-filter="*") directly above the services grid, and give every .nx-card a data-tags="category-slug" attribute matching one chip.');
  if (k.has('estimator')) lines.push('- estimator: the cost estimator section (#estimate) is rendered by the platform from the plan prices — do NOT write your own calculator; keep the pricing section as normal cards.');
  if (k.has('funnel')) lines.push('- quick quote funnel: the 3-step quote form (#quote) is rendered by the platform — do NOT write a second lead form besides the contact form; link the hero secondary button to #quote when the plan has ≥2 services.');
  if (k.has('stickycta')) lines.push('- mobile action bar: rendered by the platform (call / WhatsApp / primary CTA) — nothing to write.');
  return lines.length ? 'INTERACTIVE WIDGETS on this page:\n' + lines.join('\n') : '';
}

/**
 * Place platform-rendered widgets into a finished body (model or
 * deterministic): estimator after pricing (or before contact), funnel before
 * contact, sticky bar at the very end, filter chips above the services grid.
 * Idempotent — a body that already contains a widget is left alone.
 */
export function nxInjectWidgets(body, wp, ctx) {
  let s = String(body || '');
  if (!wp || !wp.kinds.length) return { html: s, injected: [] };
  const injected = [];
  const before = (needle, html) => { const i = s.search(needle); if (i === -1) return false; s = s.slice(0, i) + html + s.slice(i); return true; };
  if (wp.filter && !/class="nx-filter"/.test(s)) {
    const chips = nxWidgetHtml('filter', wp.filter, ctx);
    const re = wp.filter.target === 'gallery' ? /<div class="nx-gallery">/ : /<div class="nx-grid g3">/;
    const sec = wp.filter.target === 'gallery' ? /<section[^>]*id="gallery"[^>]*>[\s\S]*?(?=<div class="nx-gallery">)/ : /<section[^>]*id="services"[^>]*>[\s\S]*?(?=<div class="nx-grid g3">)/;
    const m = s.match(sec);
    if (m) { const at = m.index + m[0].length; s = s.slice(0, at) + chips + s.slice(at); s = nxAttachFilterTags(s, null, wp.filter); injected.push('filter'); }
    else if (re.test(s)) { before(re, chips); s = nxAttachFilterTags(s, null, wp.filter); injected.push('filter'); }
  }
  if (wp.estimator && !/class="nx-estimator"/.test(s)) {
    const html = nxWidgetHtml('estimator', wp.estimator, ctx);
    const afterPricing = s.match(/<section[^>]*id="pricing"[^>]*>[\s\S]*?<\/section>/);
    if (afterPricing) { const at = afterPricing.index + afterPricing[0].length; s = s.slice(0, at) + html + s.slice(at); injected.push('estimator'); }
    else if (before(/<section[^>]*id="(lead|contact)"/, html)) injected.push('estimator');
  }
  if (wp.funnel && !/class="nx-funnel"/.test(s)) {
    const html = nxWidgetHtml('funnel', wp.funnel, ctx);
    // before the lead band when there is one (band → contact stays adjacent),
    // else directly before contact, else before the footer
    if (before(/<section[^>]*id="lead"/, html) || before(/<section[^>]*id="contact"/, html) || before(/<footer\b/, html)) injected.push('funnel');
  }
  if (wp.stickycta && !/class="nx-sticky-cta"/.test(s)) {
    const html = nxWidgetHtml('stickycta', wp.stickycta, ctx);
    const i = s.lastIndexOf('</footer>');
    if (i !== -1) { s = s.slice(0, i + 9) + html + s.slice(i + 9); injected.push('stickycta'); }
    else { s += html; injected.push('stickycta'); }
  }
  return { html: s, injected };
}

export const __widgetInternals = { CATEGORY_RULES, serviceCategories, CSS, JS, slug, fmt };
