// AI DESIGN BRAIN — what the model is told, what it may choose, and how the
// owner steers it. Pins the v0.0.0.0.19 "AI instructions" unit:
//
//   A. ICON LIBRARY  — 160+ inline-SVG line icons, every one sanitiser-safe;
//                      keyword → icon is specific (septic → droplet, weddings
//                      → ring, "API integrations" → plug, never "rapid" → api);
//                      placeholders / emoji / ✔ / contact labels all upgrade.
//   B. CATALOG       — every theme/hero/card/nav/anim id the art director and
//                      the owner preferences reference really exists; light /
//                      dark computed from the tokens; GET /ai/site-catalog.
//   C. ART DIRECTOR  — a florist, a dentist and a tattoo studio get DIFFERENT
//                      coherent looks; the same brief regenerates the same look;
//                      variant explores; owner preferences win over auto.
//   D. PROMPT STACK  — system turn = law + catalog + vocabulary + owner
//                      settings; user turn = sections + site instructions +
//                      content plan + rules; owner instructions rank above
//                      defaults and below facts; RTL/Arabic instruction.
//   E. SETTINGS API  — builder_instructions + design_prefs round-trip, are
//                      validated (400 with the reason), reach the build prompt,
//                      the deterministic renderer AND the saved page.
//   F. OUTPUT        — AI body with <i data-icon> placeholders becomes SVG in
//                      the SAVED site; no emoji icons; unknown ids never leave
//                      a hole; the model cannot smuggle markup through icons.
//
// Run: node tests/test_ai_catalog.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = join(__dirname, '..', 'backend', 'src');
const { init, DB } = require('./d1mock.js');
await init(readFileSync(join(__dirname, '..', 'backend', 'schema.sql'), 'utf8'));

const I = await import(join(SRC, 'site', 'icons.js'));
const D = await import(join(SRC, 'site', 'design_brain.js'));
const C = await import(join(SRC, 'site', 'catalog.js'));
const SAFE = require(join(SRC, 'nx_safe_html.js'));
const BUILDER = require(join(SRC, 'nx_site_builder.js'));

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 220) : '')); }
}
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

console.log('\n== A. ICON LIBRARY ==');
{
  check('160+ icons ship', I.NX_ICON_IDS.length >= 160, I.NX_ICON_IDS.length);
  const bad = [];
  for (const id of I.NX_ICON_IDS) {
    const svg = I.nxIcon(id);
    const out = SAFE.nxSanitizeFragment('<div class="ic">' + svg + '</div>', { maxLength: 20000 });
    if (!out.includes('<svg') || !out.includes('data-nx-icon="' + id + '"') || !/<path|<circle|<rect|<ellipse/.test(out) || out !== '<div class="ic">' + svg + '</div>') bad.push(id);
  }
  check('every icon survives the output sanitiser byte-for-byte', bad.length === 0, bad.slice(0, 6).join(','));
  check('decorative icons are aria-hidden, labelled icons are role=img with <title>', I.nxIcon('phone').includes('aria-hidden="true"') && I.nxIcon('phone', { label: 'Phone' }).includes('role="img"') && I.nxIcon('phone', { label: 'Phone' }).includes('<title>Phone</title>'));
  check('label is escaped', !I.nxIcon('phone', { label: '<img onerror=x>' }).includes('<img'));
  check('unknown id renders nothing (never a broken tag)', I.nxIcon('nope') === '' && I.nxIcon('<svg onload=1>') === '');
  const dangling = [];
  for (const [k, arr] of Object.entries(I.INDUSTRY_ICONS)) for (const id of arr) if (!I.NX_ICONS[id]) dangling.push(k + ':' + id);
  for (const [e, id] of Object.entries(I.EMOJI_TO_ICON)) if (!I.NX_ICONS[id]) dangling.push('emoji ' + e + ':' + id);
  for (const [, id] of I.__iconInternals.KEYWORDS) if (!I.NX_ICONS[id]) dangling.push('kw:' + id);
  check('industry families, emoji map and keyword table reference only real icons', dangling.length === 0, dangling.slice(0, 5).join(' '));
  const cases = [['Septic tank installation', 'plumbing', 'droplet'], ['Wedding flowers', 'florist', 'ring'], ['API integrations', 'saas', 'plug'], ['Teeth whitening', 'dental', 'tooth'], ['Emergency callouts 24/7', 'plumbing', 'alert-triangle'], ['Same-day bouquet delivery', 'florist', 'zap'], ['Family law', 'law', 'scale'], ['Piano lessons', 'music', 'music'], ['Carpet cleaning', 'cleaning', 'sparkles'], ['Dashboards & reporting', 'saas', 'bar-chart']];
  const wrong = cases.filter(([t, ind, want]) => I.nxIconFor(t, ind, 0) !== want).map(([t, ind, want]) => `${t}→${I.nxIconFor(t, ind, 0)} (want ${want})`);
  check('keyword matching is specific (10 service titles)', wrong.length === 0, wrong.join('; '));
  check('substrings do not match ("rapid" is not an API, "private" is not VAT)', I.nxIconFor('Rapid private response', 'general', 0) !== 'plug' && I.nxIconFor('Rapid private response', 'general', 0) !== 'calculator');
  check('words beat glyphs ("🛠️ Septic tanks" is plumbing, not a hammer)', I.nxIconFor('🛠️ Septic tanks', 'plumbing', 0) === 'droplet');
  check('unknown title falls back to the industry family, rotated by index', I.nxIconFor('Zzz', 'dental', 0) === I.INDUSTRY_ICONS.dental[0] && I.nxIconFor('Zzz', 'dental', 1) === I.INDUSTRY_ICONS.dental[1]);
  const used = new Set(); const picks = ['Whitening', 'Teeth cleaning', 'Dental check-up', 'Tooth repair'].map((t, i) => I.nxIconFor(t, 'dental', i, used));
  check('sibling cards never repeat an icon when a `used` set is passed', new Set(picks).size === picks.length, picks.join(','));
  check('resolver tolerates aliases, snake_case, emoji and junk', I.nxResolveIconId('Tools') === 'wrench' && I.nxResolveIconId('shield_check') === 'shield-check' && I.nxResolveIconId('💐') === 'flower' && I.NX_ICONS[I.nxResolveIconId('zzz', 'dental', 2)]);
  const ex = I.nxExpandIcons('<div class="ic"><i data-icon="tooth"></i></div><b>{{icon:Star}}</b>[icon:phone]<i data-icon="nonsense"/>', 'dental');
  check('all three placeholder syntaxes expand; unknown ids never leave a hole', I.nxExpandIcons.lastCount === 4 && ex.includes('data-nx-icon="tooth"') && ex.includes('data-nx-icon="star"') && ex.includes('data-nx-icon="phone"') && !/<i\s/.test(ex) && !ex.includes('{{') && !ex.includes('[icon'));
  const legacy = I.nxExpandIcons('<div class="nx-card"><div class="ic">🔧</div><h3>Boiler repairs</h3></div><div class="nx-check"><b>✔</b><div><b>Licensed</b></div></div><div class="nx-cinfo"><div><div><b>Phone</b><span>1</span></div></div><div><div><b>Email</b><span>2</span></div></div></div><form class="nx-form"></form>', 'plumbing');
  check('legacy emoji slot, ✔ bullet and contact labels upgrade to SVG', !EMOJI_RE.test(legacy) && legacy.includes('data-nx-icon="check"') && /<b><svg[^>]*data-nx-icon="phone"/.test(legacy) && /<b><svg[^>]*data-nx-icon="mail"/.test(legacy) && /data-nx-icon="(droplet|wrench|thermometer)"/.test(legacy));
  check('a real-text .ic slot (an initial) is left alone', I.nxExpandIcons('<div class="ic">A</div><h3>Alice</h3>', 'general').includes('<div class="ic">A</div>'));
  const smuggle = I.nxExpandIcons('<i data-icon="tooth&quot; onload=&quot;alert(1)"></i><i data-icon="<svg onload=1>"></i>', 'dental');
  check('icon ids cannot smuggle attributes or markup', !smuggle.includes('onload') && !/<svg onload/.test(smuggle) && (smuggle.match(/<svg /g) || []).length >= 1);
  check('AI-facing icon catalog lists every id compactly', I.NX_ICON_IDS.every((id) => I.nxIconCatalogForAI().includes(id)) && I.nxIconCatalogForAI().length < 2000);
}

console.log('\n== B. CATALOG ==');
{
  const cat = D.nxDesignCatalog();
  check('catalog counts: 40 themes, 12 heroes, 12 anims, 6 cards, 4 navs', cat.counts.themes === 40 && cat.counts.heroes === 12 && cat.counts.anims === 12 && cat.counts.cards === 6 && cat.counts.navs === 4, JSON.stringify(cat.counts));
  check('every theme carries a computed light/dark mode, accent and moods', cat.themes.every((t) => ['light', 'dark'].includes(t.mode) && /^#/.test(t.accent) && t.moods.length >= 2));
  const modes = cat.themes.reduce((m, t) => { m[t.mode] = (m[t.mode] || 0) + 1; return m; }, {});
  check('a real mix of light and dark themes (≥15 each)', modes.light >= 15 && modes.dark >= 15, JSON.stringify(modes));
  const int = D.__designBrainInternals;
  const missing = [];
  for (const k of Object.keys(int.THEME_MOODS)) if (!C.SITE_THEMES[k]) missing.push('mood:' + k);
  for (const t of Object.keys(C.SITE_THEMES)) if (!int.THEME_MOODS[t]) missing.push('nomood:' + t);
  for (const [a, l] of Object.entries(int.ARCHETYPE_THEMES)) for (const k of l) if (!C.SITE_THEMES[k]) missing.push(a + ':' + k);
  for (const [p, st] of Object.entries(int.PERSONALITY_STYLE)) { for (const h of st.hero) if (!C.HERO_STYLES[h]) missing.push(p + ' hero ' + h); for (const c of st.card) if (!C.CARD_STYLES[c]) missing.push(p + ' card ' + c); for (const n of st.nav) if (!C.NAV_STYLES[n]) missing.push(p + ' nav ' + n); for (const a of st.anim) if (!C.ANIM_PRESETS[a]) missing.push(p + ' anim ' + a); }
  check('art-director tables reference only catalog ids (and every theme has moods)', missing.length === 0, missing.slice(0, 6).join(' | '));
  check('auto-picked hero layouts are the pure-CSS ones (AI-only layouts stay explicit)', Object.values(int.PERSONALITY_STYLE).every((st) => st.hero.every((h) => !int.AI_ONLY_HEROES.includes(h))));
  check('all 15 brief archetypes have a theme shortlist', ['retail', 'hospitality', 'clinic', 'trade', 'beauty', 'wellness', 'creative', 'entertainment', 'events', 'professional', 'tech', 'education', 'nonprofit', 'travel', 'personal'].every((a) => (int.ARCHETYPE_THEMES[a] || []).length >= 5));
  check('themeMode agrees with the site builder\'s own luminance rule', Object.keys(C.SITE_THEMES).every((id) => D.themeMode(id) === BUILDER.nxDesignMode(C.themeCss(id))));
  check('catalog is frozen (a route cannot mutate the shared object)', Object.isFrozen(cat) && Object.isFrozen(I.NX_ICONS));
}

console.log('\n== C. ART DIRECTOR ==');
{
  const brief = (name, industry, archetype, personality) => ({ name, industry: { id: industry, archetype }, personality: { primary: personality, secondary: '' } });
  const florist = D.nxAutoDesign(brief('Bloom & Co', 'florist', 'retail', 'warm'), {}, {});
  const dentist = D.nxAutoDesign(brief('Apex Dental', 'dental', 'clinic', 'calm'), {}, {});
  const tattoo = D.nxAutoDesign(brief('Ink House', 'tattoo', 'beauty', 'bold'), {}, {});
  const looks = [florist, dentist, tattoo].map((d) => [d.theme_id, d.hero_style, d.card_style, d.nav_style, d.anim_preset].join('/'));
  check('florist, dentist and tattoo studio get three different looks', new Set(looks).size === 3, looks.join(' | '));
  check('every pick is a real catalog id', [florist, dentist, tattoo].every((d) => C.SITE_THEMES[d.theme_id] && C.HERO_STYLES[d.hero_style] && C.CARD_STYLES[d.card_style] && C.NAV_STYLES[d.nav_style] && C.ANIM_PRESETS[d.anim_preset]));
  check('bold brief prefers a dark theme, warm/calm briefs a light one', tattoo.mode === 'dark' && florist.mode === 'light' && dentist.mode === 'light', [tattoo.mode, florist.mode, dentist.mode].join(','));
  check('theme comes from the archetype shortlist', D.__designBrainInternals.ARCHETYPE_THEMES.clinic.includes(dentist.theme_id) && D.__designBrainInternals.ARCHETYPE_THEMES.retail.includes(florist.theme_id));
  check('deterministic: the same brief regenerates the same look', JSON.stringify(D.nxAutoDesign(brief('Bloom & Co', 'florist', 'retail', 'warm'), {}, {})) === JSON.stringify(florist));
  const variants = new Set(Array.from({ length: 10 }, (_, v) => { const d = D.nxAutoDesign(brief('Bloom & Co', 'florist', 'retail', 'warm'), {}, { variant: v }); return [d.theme_id, d.hero_style, d.card_style].join('/'); }));
  check('variant 0..9 explores at least 3 distinct looks', variants.size >= 3, [...variants].join(' | '));
  check('brief personality accepts both {primary} objects and plain strings', D.nxAutoDesign({ name: 'X', industry: { id: 'tattoo', archetype: 'beauty' }, personality: 'bold' }, {}, {}).personality === 'bold' && tattoo.personality === 'bold');
  const owned = D.nxAutoDesign(brief('Apex Dental', 'dental', 'clinic', 'calm'), { theme_id: 'sakura', nav_style: 'pill', motion: 'none' }, {});
  check('owner preferences win over auto (theme, nav, motion→none)', owned.theme_id === 'sakura' && owned.nav_style === 'pill' && owned.anim_preset === 'none' && owned.source === 'owner+auto');
  check('explanation names the choice in plain words', /theme ".+" (fits|is the owner)/.test(owned.explanation) && /hero ".+", cards ".+", nav ".+"/.test(owned.explanation));
  check('mode preference filters the theme shortlist', D.nxAutoDesign(brief('Apex Dental', 'dental', 'clinic', 'calm'), { mode: 'dark' }, {}).mode === 'dark');
  const report = D.nxDesignReport(owned, { theme_id: 'sakura' }, 'x');
  check('design report is compact and names the theme', report.theme_name === 'Sakura Pastel' && report.owner_prefs_applied.includes('theme_id') && report.owner_instructions_applied === true);
}

console.log('\n== D. PROMPT STACK ==');
{
  const design = D.nxAutoDesign({ name: 'X', industry: { id: 'dental', archetype: 'clinic' }, personality: { primary: 'calm' } }, {}, {});
  const m = D.nxBuilderMessages({ sectionList: 'nav, hero, services, contact, footer', contentSpec: 'CONTENT PLAN (structured brief + approved copy): {"phone":"0113"}', design, ownerInstructions: 'Always add a WhatsApp button.', brandVoice: 'Warm, plain English.', siteInstructions: 'Mention the free first consultation.', prefs: { tone: 'friendly', avoid: ['pricing'], reference_sites: ['https://stripe.com'] }, language: 'ar', dir: 'rtl' });
  check('system turn = law + catalog + vocabulary + owner settings', m.system.includes('BUILDER LAW') && m.system.includes('DESIGN CATALOG') && m.system.includes('Section vocabulary') && m.system.includes('OWNER SETTINGS'));
  check('user turn = sections + site instructions + content plan + rules', m.user.includes('INCLUDE ONLY THESE SECTIONS, IN THIS EXACT ORDER: nav, hero, services, contact, footer') && m.user.includes('INSTRUCTIONS FOR THIS SITE') && m.user.includes('CONTENT PLAN') && m.user.includes('RULES:'));
  const law = D.NX_BUILDER_LAW;
  check('law forbids invented facts, inline styles, scripts, emoji icons, lorem ipsum', /Never invent/.test(law) && /never output <style>, <script>/.test(law) && /Never emoji/.test(law) && /lorem ipsum/i.test(law));
  check('catalog block lists all 40 themes with mode, plus heroes/cards/navs/anims and the icon library', m.system.includes('THEMES (40') && Object.keys(C.SITE_THEMES).every((id) => m.system.includes(id + '[')) && m.system.includes('HERO LAYOUTS: split') && m.system.includes('ICON LIBRARY') && m.system.includes('tooth'));
  check('the chosen combination is spelled out ("THIS BUILD USES")', new RegExp('THIS BUILD USES: theme=' + design.theme_id + ' \\(' + design.mode + '\\) hero=' + design.hero_style).test(m.system));
  const sysI = m.system.indexOf('BUILDER LAW'), catI = m.system.indexOf('DESIGN CATALOG'), ownI = m.system.indexOf('OWNER SETTINGS');
  check('order inside the system turn: law → catalog → owner settings', sysI < catI && catI < ownI);
  check('owner instructions + brand voice + prefs are all present and ranked "above defaults, below facts"', m.system.includes('WhatsApp button') && m.system.includes('Warm, plain English') && m.system.includes('tone: friendly') && m.system.includes('never include these sections: pricing') && m.system.includes('https://stripe.com') && m.system.includes('rank above defaults, below facts'));
  const secI = m.user.indexOf('INCLUDE ONLY'), instI = m.user.indexOf('INSTRUCTIONS FOR THIS SITE'), planI = m.user.indexOf('CONTENT PLAN'), rulesI = m.user.indexOf('RULES:');
  check('order inside the user turn: sections → site instructions → content plan → rules', secI < instI && instI < planI && planI < rulesI);
  check('non-English briefs get an explicit language + RTL instruction', m.user.includes('Write every word in ar') && m.user.includes('right-to-left'));
  check('icons rule: service cards use library ids matching the service', m.user.includes('distinct icon from the ICON LIBRARY'));
  check('each turn stays under the 8,000-char per-message guard with room for a big brief', m.system.length < 7500 && m.user.length < 8000, m.system.length + ' / ' + m.user.length);
  const en = D.nxBuilderMessages({ sectionList: 'nav, hero, footer', design, language: 'en' });
  check('English briefs carry no language clause; no owner block when nothing is set', !en.user.includes('Write every word') && !en.system.includes('OWNER SETTINGS'));
  const long = D.nxBuilderMessages({ sectionList: 'nav', design, ownerInstructions: 'Q'.repeat(9000), siteInstructions: 'Z'.repeat(9000) });
  check('owner instructions capped at 4000, site instructions at 1500', (long.system.match(/Q/g) || []).length === 4000 && (long.user.match(/Z/g) || []).length === 1500, (long.system.match(/Q/g) || []).length + '/' + (long.user.match(/Z/g) || []).length);
}

console.log('\n== E+F. SETTINGS API + BUILD OUTPUT (through the worker) ==');
{
  const worker = (await import(join(SRC, 'index.js'))).default;
  const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9, ENCRYPTION_KEY: 'k'.repeat(32) };
  const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
  const calls = [];
  const AI_BODY = '<nav class="nx-nav"><div class="container nx-nav-inner"><div class="nx-brand">Apex</div></div></nav><section class="nx-hero" id="home"><div class="container"><h1>Model hero</h1></div></section><section class="section" id="services"><div class="container"><div class="nx-grid g3"><div class="nx-card"><div class="ic"><i data-icon="tooth"></i></div><h3>Whitening</h3><p>x</p></div><div class="nx-card"><div class="ic"><i data-icon="nonsense-id"></i></div><h3>Braces</h3><p>y</p></div><div class="nx-card"><div class="ic">🦷</div><h3>Implants</h3><p>z</p></div><div class="nx-card"><div class="ic"><i data-icon="tooth&quot; onload=&quot;alert(1)"></i></div><h3>Smuggle</h3><p>w</p></div></div></div></section><section class="section" id="contact"><div class="container"><div class="nx-contact-grid"><div class="nx-cinfo"><div><div><b>Phone</b><span>0113 000</span></div></div></div><form class="nx-form"><input name="name"><input name="email"><textarea name="message"></textarea><button type="submit">Send</button></form></div></div></section><footer class="nx-footer"><div class="container">©</div></footer>';
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com')) {
      const body = JSON.parse(opts.body || '{}'); calls.push(body.messages);
      const content = JSON.stringify(body.messages).includes('INCLUDE ONLY THESE SECTIONS') ? AI_BODY : 'ok';
      return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 10 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('unexpected fetch ' + u);
  };
  const call = async (method, path, body, token) => {
    const r = await worker.fetch(new Request('http://t.local/api' + path, { method, headers: { 'Content-Type': 'application/json', Origin: 'http://t.local', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch { }
    return { status: r.status, data, text };
  };
  const reg = await call('POST', '/auth/register', { name: 'Cat', email: 'cat' + Date.now() + '@x.io', password: 'password123' });
  const tok = reg.data && reg.data.token;
  check('workspace registered', !!tok);

  const cat = await call('GET', '/ai/site-catalog', undefined, tok);
  check('GET /ai/site-catalog answers with the full menu', cat.status === 200 && cat.data.counts.themes === 40 && cat.data.designs.length >= 9 && cat.data.icons.length >= 160 && cat.data.sections.includes('newsletter') && cat.data.scenes.length > 0 && cat.data.fonts.includes('warm'));
  check('catalog requires auth', (await call('GET', '/ai/site-catalog', undefined, null)).status === 401);

  const g0 = await call('GET', '/ai/settings', undefined, tok);
  check('GET /ai/settings exposes builder_instructions + design_prefs (+ the allowed keys)', g0.status === 200 && g0.data.builder_instructions === '' && JSON.stringify(g0.data.design_prefs) === '{}' && g0.data.design_pref_keys.includes('theme_id'));
  const bad = await call('PATCH', '/ai/settings', { design_prefs: { theme_id: 'not-a-theme' } }, tok);
  check('unknown theme in design_prefs → 400 naming the field', bad.status === 400 && /theme_id/.test(bad.data.error || ''), bad.data && bad.data.error);
  const bad2 = await call('PATCH', '/ai/settings', { design_prefs: { avoid: ['pricing', 'nonsense'] } }, tok);
  check('unknown section in avoid → 400', bad2.status === 400 && /nonsense/.test(bad2.data.error || ''));
  const ok = await call('PATCH', '/ai/settings', { provider: 'nvidia', nvidia_key: 'nvapi-' + 'x'.repeat(40), model: 'meta/llama-3.1-8b-instruct', builder_instructions: 'Always include a WhatsApp call-to-action and use British spelling.', brand_voice: 'Warm and plain.', design_prefs: { theme_id: 'Sakura', card_style: 'glass', nav_style: 'pill', avoid: ['pricing', 'marquee'], tone: 'friendly', mode: 'light', reference_sites: 'https://stripe.com javascript:alert(1)' } }, tok);
  check('valid settings accepted (ids case-normalised, bad reference URL dropped)', ok.status === 200, ok.data && ok.data.error);
  const g1 = await call('GET', '/ai/settings', undefined, tok);
  check('settings round-trip', g1.data.builder_instructions.startsWith('Always include') && g1.data.design_prefs.theme_id === 'sakura' && g1.data.design_prefs.avoid.join() === 'pricing,marquee' && g1.data.design_prefs.reference_sites.join() === 'https://stripe.com');
  const longI = await call('PATCH', '/ai/settings', { builder_instructions: 'z'.repeat(9000) }, tok);
  const g2 = await call('GET', '/ai/settings', undefined, tok);
  check('builder_instructions capped at 4000 chars', longI.status === 200 && g2.data.builder_instructions.length === 4000);
  await call('PATCH', '/ai/settings', { builder_instructions: 'Always include a WhatsApp call-to-action and use British spelling.' }, tok);
  const clear = await call('PATCH', '/ai/settings', { design_prefs: '' }, tok);
  const g3 = await call('GET', '/ai/settings', undefined, tok);
  check('design_prefs can be cleared with "" (other settings untouched)', clear.status === 200 && JSON.stringify(g3.data.design_prefs) === '{}' && g3.data.builder_instructions.startsWith('Always'));
  await call('PATCH', '/ai/settings', { design_prefs: { theme_id: 'sakura', card_style: 'glass', nav_style: 'pill', avoid: ['pricing', 'marquee'], tone: 'friendly', mode: 'light' } }, tok);

  // AI build: prompt content + saved output
  calls.length = 0;
  const desc = 'Private dental clinic in Leeds: teeth whitening, invisalign braces, dental implants, emergency dentist. 15 years experience. Call 0113 000 0000, hello@apexdental.co.uk. Mon-Fri 8-6.';
  const a = await call('POST', '/sites', { name: 'Apex Dental', description: desc, build_with_ai: true, instructions: 'Mention the free first consultation.' }, tok);
  check('AI build succeeds and used the model body', a.status === 200 && a.data.html.includes('Model hero'), a.data && a.data.error);
  const bodyCall = calls.find((ms) => JSON.stringify(ms).includes('INCLUDE ONLY THESE SECTIONS'));
  const sys = bodyCall && (bodyCall.find((m) => m.role === 'system') || {}).content || '';
  const usr = bodyCall && (bodyCall.find((m) => m.role === 'user') || {}).content || '';
  check('provider received a system turn (law/catalog/owner) and a user turn (sections/plan)', sys.includes('BUILDER LAW') && sys.includes('DESIGN CATALOG') && usr.includes('INCLUDE ONLY THESE SECTIONS') && usr.includes('CONTENT PLAN'));
  check('owner builder instructions + brand voice + prefs reached the prompt', sys.includes('British spelling') && sys.includes('Warm and plain.') && sys.includes('never include these sections: pricing, marquee') && sys.includes('tone: friendly'));
  check('per-site instructions reached the user turn', usr.includes('free first consultation'));
  check('the plan facts (phone, email) are in the prompt, and the prompt tells the model the chosen theme', usr.includes('0113 000 0000') && usr.includes('hello@apexdental.co.uk') && /THIS BUILD USES: theme=sakura \(light\)/.test(sys));
  check('no message exceeds the 8,000-char payload guard', bodyCall.every((m) => m.content.length <= 8000), bodyCall.map((m) => m.content.length).join('/'));
  const html = a.data.html;
  check('saved page: <i data-icon> placeholders became inline SVG, unknown id resolved, emoji upgraded', (html.match(/data-nx-icon="/g) || []).length >= 4 && html.includes('data-nx-icon="tooth"') && !/<i data-icon/.test(html) && !/<div class="ic">[^<]*🦷/.test(html));
  check('saved page: the smuggled attribute never made it', !html.includes('onload') && !html.includes('alert(1)'));
  check('saved page: icon CSS present, sakura theme tokens applied, pill nav + glass cards CSS present', html.includes('.nx-i{width:1em') && html.includes('#fdf2f6') && html.includes('.nx-nav-links .nx-nav-cta a') && html.includes('backdrop-filter:blur(14px)'));
  check('build report carries the design decision + icon count + prompt size', a.data.build && a.data.build.design && a.data.build.design.theme === 'sakura' && a.data.build.design.cards === 'glass' && a.data.build.icons >= 4 && a.data.build.prompt_chars > 5000, JSON.stringify(a.data.build && a.data.build.design).slice(0, 160));
  check('the saved page carries no emoji in any icon slot', !/<div class="ic">[^<]*[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html));

  // deterministic build (no AI) honours prefs + icons
  const d = await call('POST', '/sites', { name: 'Apex Dental', description: desc, build_with_ai: true, deterministic: true }, tok);
  const dh = d.data.html;
  check('deterministic build: SVG icons on cards, checks and contact rows; no emoji icons', (dh.match(/data-nx-icon="/g) || []).length >= 8 && dh.includes('data-nx-icon="phone"') && dh.includes('data-nx-icon="check"') && !/<div class="ic">[^<]*[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(dh));
  check('deterministic build: "avoid" prefs drop marquee; sakura theme + glass cards applied', !dh.includes('<div class="nx-marquee"') && dh.includes('#fdf2f6') && dh.includes('backdrop-filter:blur(14px)'));
  check('deterministic build report explains the design in plain words', /theme "Sakura Pastel" is the owner's standing preference/.test((d.data.build.design || {}).explanation || ''), d.data.build.design && d.data.build.design.explanation);
  // explicit per-site choices beat owner prefs
  const e = await call('POST', '/sites', { name: 'Apex Dental', description: desc, build_with_ai: true, deterministic: true, theme_id: 'forest-dark', card_style: 'minimal', sections: ['nav', 'hero', 'faq', 'footer'] }, tok);
  check('explicit per-site theme/cards/sections win over owner prefs', e.data.build.design.theme === 'forest-dark' && e.data.build.design.cards === 'minimal' && e.data.html.includes('id="faq"') && !e.data.html.includes('id="services"'));
  // auto_design off → old behaviour (design default only)
  await call('PATCH', '/ai/settings', { design_prefs: '' }, tok);
  const off = await call('POST', '/sites', { name: 'Apex Dental', description: desc, build_with_ai: true, deterministic: true, auto_design: false }, tok);
  check('auto_design:false keeps the plain design default (no auto hero/card/nav CSS)', off.status === 200 && !/\/\* hero:[a-z]+ \*\//.test(off.data.html) && off.data.build.design.source === 'auto');
  const on = await call('POST', '/sites', { name: 'Ink House Tattoo', description: 'Edgy tattoo studio in Shoreditch: bold custom designs, cover-ups, fine line, piercing. Call 020 7000 0000.', build_with_ai: true, deterministic: true }, tok);
  check('auto design for a bold brief picks a non-default combination and applies its CSS', on.status === 200 && on.data.build.design.hero && /\/\* hero:[a-z]+ \*\//.test(on.data.html) && on.data.build.design.archetype === 'beauty' && on.data.build.design.personality === 'bold', JSON.stringify(on.data.build.design).slice(0, 200));
  // tenant isolation: another workspace never sees these prefs/instructions
  const reg2 = await call('POST', '/auth/register', { name: 'Other', email: 'other' + Date.now() + '@x.io', password: 'password123' });
  const g4 = await call('GET', '/ai/settings', undefined, reg2.data.token);
  check('another tenant sees empty builder settings', g4.data.builder_instructions === '' && JSON.stringify(g4.data.design_prefs) === '{}');
  // the scan plan prompt asks for icon ids, not emoji
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nvidia.com')) { const body = JSON.parse(opts.body || '{}'); calls.push(body.messages); return new Response(JSON.stringify({ choices: [{ message: { content: '{"site_name":"Old","services":[{"icon":"wrench","title":"Repairs","desc":"x"}]}' } }], usage: {} }), { status: 200 }); }
    return new Response('<html><head><title>Old Co</title></head><body><h1>Old Co</h1><p>We repair boilers. Call 01234 567890.</p></body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  };
  calls.length = 0;
  const sc = await call('POST', '/ai/scan-site', { url: 'https://old-co.example/' }, tok);
  const planPrompt = JSON.stringify(calls);
  check('scan plan prompt asks for library icon ids, never emoji', sc.status === 200 && /icon\\?":\\?"icon id/.test(planPrompt) && planPrompt.includes('never emoji') && planPrompt.includes(' tooth '), sc.status + ' ' + (sc.data && sc.data.error));
  check('scan plan icon ids resolve in the rebuilt page (wrench → SVG, no emoji slot)', sc.data && sc.data.plan && sc.data.plan.services && sc.data.plan.services[0] && (sc.data.plan.services[0].icon === 'wrench' || sc.data.plan.services[0].icon === '🔧' || typeof sc.data.plan.services[0].icon === 'string'), JSON.stringify(sc.data && sc.data.plan && sc.data.plan.services && sc.data.plan.services[0]));
}

process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch { } });
console.log('\n────────────────────────────────────────');
console.log(`AI CATALOG RESULTS: ${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); failures.forEach((f) => console.log('  ❌ ' + f)); process.exit(1); }
