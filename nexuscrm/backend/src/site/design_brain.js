// backend/src/site/design_brain.js — what the AI is TOLD and what it may CHOOSE.
//
// Before this module the model building a site saw a class vocabulary and a
// content plan, was asked for "emoji" icons, and knew nothing about the 40
// themes, 12 hero layouts, 6 card treatments, 4 nav treatments, 6 art
// directions, palettes or font pairs the product ships. Owners had one
// free-text "instructions" box per site and no place to tell the AI how their
// sites must look in general.
//
// This module gives the pipeline three things, all pure (no I/O, no globals):
//
//   1. nxDesignCatalog()            — the complete, machine-readable menu of
//                                      everything the builder can render
//                                      (served at GET /ai/site-catalog and
//                                      summarised inside every build prompt).
//   2. nxAutoDesign(brief, prefs)   — a deterministic art director: picks a
//                                      coherent theme + hero + card + nav +
//                                      animation combination for THIS brief
//                                      (industry archetype, personality,
//                                      light/dark, owner preferences) so the
//                                      page never falls into one generic look.
//   3. nxBuilderPrompt(ctx)         — the layered instruction stack the model
//                                      receives: builder law → catalog →
//                                      chosen design → owner's standing
//                                      builder instructions + brand voice →
//                                      per-site instructions → content plan →
//                                      hard rules. Same order every time, so
//                                      the owner's settings always outrank
//                                      the defaults and never outrank facts.
//
// Owner-level settings live on the workspace (ai_builder_instructions ≤4000
// chars, ai_design_prefs JSON) and are validated by nxParseDesignPrefs().

import { SITE_THEMES, HERO_STYLES, ANIM_PRESETS, CARD_STYLES, NAV_STYLES, THREE_D_LEVELS } from './catalog.js';
import { NX_ICON_IDS, nxIconCatalogForAI, INDUSTRY_ICONS } from './icons.js';

// ── Theme metadata the raw CSS catalog does not carry ──────────────────────
// mood tags + best-fit archetypes, derived once from the palette + a curated
// mapping. `mode` is computed from --bg luminance so it is never out of date.
const THEME_MOODS = Object.freeze({
  'glass-dark': ['premium', 'tech', 'modern'], 'glass-light': ['clean', 'tech', 'friendly'], 'neo-light': ['soft', 'modern', 'friendly'], 'brutalism': ['bold', 'creative', 'loud'],
  'luxury-dark': ['luxury', 'premium', 'quiet'], 'minimal-white': ['minimal', 'clean', 'professional'], 'minimal-dark': ['minimal', 'premium', 'quiet'], 'editorial': ['editorial', 'refined', 'serif'],
  'cyberpunk': ['bold', 'tech', 'neon'], 'sunset': ['warm', 'playful', 'energetic'], 'ocean-light': ['calm', 'fresh', 'trust'], 'forest-dark': ['natural', 'premium', 'calm'], 'rose-elegant': ['elegant', 'warm', 'beauty'],
  'midnight-violet': ['creative', 'tech', 'premium'], 'ember-warm': ['warm', 'bold', 'craft'], 'graphite': ['professional', 'minimal', 'modern'], 'sand-natural': ['natural', 'warm', 'calm'], 'sakura': ['soft', 'beauty', 'playful'],
  'mint-fresh': ['fresh', 'health', 'clean'], 'cobalt-corp': ['corporate', 'trust', 'professional'], 'lime-pop': ['playful', 'energetic', 'bold'], 'terracotta': ['warm', 'craft', 'natural'], 'lavender': ['calm', 'wellness', 'soft'],
  'noir-ivory': ['luxury', 'editorial', 'quiet'], 'bordeaux': ['luxury', 'warm', 'hospitality'], 'teal-aqua': ['fresh', 'trust', 'health'], 'amber-retro': ['retro', 'warm', 'playful'], 'slate-blue': ['professional', 'trust', 'calm'],
  'coral-tropic': ['playful', 'warm', 'travel'], 'evergreen': ['natural', 'trust', 'outdoors'], 'denim': ['casual', 'trust', 'friendly'], 'plum-deep': ['luxury', 'creative', 'quiet'], 'canary': ['playful', 'bold', 'energetic'],
  'steel': ['industrial', 'professional', 'precise'], 'berry': ['playful', 'warm', 'food'], 'seafoam': ['calm', 'fresh', 'wellness'], 'chocolate': ['warm', 'craft', 'food'], 'space': ['tech', 'bold', 'premium'], 'peach': ['soft', 'warm', 'friendly'], 'classic-red': ['bold', 'trust', 'classic'],
});

// Which themes suit which business archetype (first = strongest fit). The
// personality of the brief then picks within the shortlist.
const ARCHETYPE_THEMES = Object.freeze({
  retail: ['peach', 'sunset', 'berry', 'canary', 'minimal-white', 'coral-tropic'],
  hospitality: ['bordeaux', 'chocolate', 'terracotta', 'ember-warm', 'sand-natural', 'noir-ivory'],
  clinic: ['mint-fresh', 'teal-aqua', 'ocean-light', 'slate-blue', 'minimal-white', 'cobalt-corp'],
  trade: ['steel', 'cobalt-corp', 'classic-red', 'amber-retro', 'graphite', 'ember-warm'],
  beauty: ['rose-elegant', 'sakura', 'noir-ivory', 'lavender', 'peach', 'luxury-dark'],
  wellness: ['lavender', 'seafoam', 'sand-natural', 'sakura', 'mint-fresh', 'evergreen'],
  creative: ['brutalism', 'midnight-violet', 'editorial', 'plum-deep', 'lime-pop', 'minimal-dark'],
  entertainment: ['cyberpunk', 'space', 'midnight-violet', 'lime-pop', 'sunset', 'canary'],
  events: ['noir-ivory', 'rose-elegant', 'bordeaux', 'plum-deep', 'sunset', 'sakura'],
  professional: ['cobalt-corp', 'slate-blue', 'graphite', 'noir-ivory', 'minimal-white', 'steel'],
  tech: ['glass-dark', 'space', 'glass-light', 'midnight-violet', 'cobalt-corp', 'graphite'],
  education: ['denim', 'ocean-light', 'canary', 'mint-fresh', 'slate-blue', 'minimal-white'],
  nonprofit: ['evergreen', 'denim', 'ocean-light', 'terracotta', 'seafoam', 'minimal-white'],
  travel: ['coral-tropic', 'ocean-light', 'sunset', 'evergreen', 'sand-natural', 'teal-aqua'],
  personal: ['editorial', 'noir-ivory', 'minimal-white', 'sand-natural', 'graphite', 'peach'],
});

// Personality (from nx_brief) → component preferences. Auto-picked hero
// layouts are the pure-CSS ones (they look right even when the deterministic
// renderer writes the markup); kinetic / marqueebg / parallax / tilt3d /
// particles need model-written markup and stay explicit choices.
const PERSONALITY_STYLE = Object.freeze({
  warm: { hero: ['splitimage', 'split', 'badgehero'], card: ['standard', 'neo'], nav: ['solid', 'pill'], anim: ['rise', 'fadeup'], radius: 'round', prefersDark: false },
  refined: { hero: ['minimal', 'split', 'center'], card: ['minimal', 'border'], nav: ['underline', 'solid'], anim: ['fade', 'blur'], radius: 'soft', prefersDark: false },
  bold: { hero: ['mesh', 'minimal', 'center'], card: ['border', 'lift3d'], nav: ['pill', 'solid'], anim: ['clip', 'pop', 'slideleft'], radius: 'sharp', prefersDark: true },
  precise: { hero: ['split', 'center', 'glass'], card: ['standard', 'glass'], nav: ['glass', 'underline'], anim: ['fadeup', 'fade'], radius: 'soft', prefersDark: null },
  calm: { hero: ['center', 'minimal', 'splitimage'], card: ['minimal', 'standard'], nav: ['solid', 'underline'], anim: ['fade', 'drift'], radius: 'round', prefersDark: false },
  playful: { hero: ['badgehero', 'mesh', 'splitimage'], card: ['neo', 'lift3d'], nav: ['pill', 'solid'], anim: ['pop', 'zoom', 'flip'], radius: 'round', prefersDark: false },
});
const AI_ONLY_HEROES = Object.freeze(['kinetic', 'marqueebg', 'parallax', 'tilt3d', 'particles']);

const ICON_STYLES = Object.freeze(['line', 'filled-soft', 'none']);
const SECTION_IDS = Object.freeze(['nav', 'hero', 'marquee', 'stats', 'services', 'why', 'about', 'process', 'parallax', 'gallery', 'pricing', 'team', 'timeline', 'logos', 'video', 'reviews', 'lead', 'newsletter', 'faq', 'hours', 'areas', 'map', 'contact', 'footer']);
const DIRECTION_IDS = Object.freeze(['editorial-minimal', 'cinematic-immersive', 'bold-experimental', 'warm-organic', 'tech-precise', 'luxury-quiet', 'signal-industrial', 'luxury-art', 'swiss-structured']);
const MOTION_LEVELS = Object.freeze(['none', 'subtle', 'normal', 'expressive']);
const DENSITY = Object.freeze(['airy', 'balanced', 'compact']);
const TONE = Object.freeze(['professional', 'friendly', 'luxury', 'playful', 'bold', 'calm', 'technical']);

function luminance(hex) {
  const m = String(hex || '').replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function themeMode(themeId) {
  const t = SITE_THEMES[themeId];
  if (!t) return 'dark';
  return luminance(t.vars['--bg']) > 0.35 ? 'light' : 'dark';
}

// ── 1. The catalog ─────────────────────────────────────────────────────────
let __catalogCache = null;
export function nxDesignCatalog(extra) {
  if (!__catalogCache) {
    const themes = Object.entries(SITE_THEMES).map(([id, t]) => ({ id, name: t.name, mode: themeMode(id), accent: t.vars['--accent'], bg: t.vars['--bg'], moods: THEME_MOODS[id] || [] }));
    __catalogCache = Object.freeze({
      version: 2,
      themes,
      heroes: Object.entries(HERO_STYLES).map(([id, v]) => ({ id, name: v.name, layout: v.prompt || '' })),
      anims: Object.entries(ANIM_PRESETS).map(([id, v]) => ({ id, name: v.name })),
      cards: Object.entries(CARD_STYLES).map(([id, v]) => ({ id, name: v.name })),
      navs: Object.entries(NAV_STYLES).map(([id, v]) => ({ id, name: v.name })),
      three_d: Object.entries(THREE_D_LEVELS).map(([id, v]) => ({ id, name: v.name })),
      directions: DIRECTION_IDS.slice(),
      sections: SECTION_IDS.slice(),
      icons: NX_ICON_IDS.slice(),
      icon_styles: ICON_STYLES.slice(),
      personalities: Object.keys(PERSONALITY_STYLE),
      archetypes: Object.keys(ARCHETYPE_THEMES),
      motion_levels: MOTION_LEVELS.slice(),
      densities: DENSITY.slice(),
      tones: TONE.slice(),
      counts: { themes: themes.length, heroes: Object.keys(HERO_STYLES).length, anims: Object.keys(ANIM_PRESETS).length, cards: Object.keys(CARD_STYLES).length, navs: Object.keys(NAV_STYLES).length, icons: NX_ICON_IDS.length },
    });
  }
  return extra ? Object.assign({}, __catalogCache, extra) : __catalogCache;
}

// ── 2. Owner design preferences (workspace-level, validated) ───────────────
export const DESIGN_PREF_KEYS = Object.freeze(['design_id', 'theme_id', 'hero_style', 'card_style', 'nav_style', 'anim_preset', 'three_d', 'direction', 'mode', 'icon_style', 'motion', 'density', 'tone', 'sections', 'avoid', 'palette_note', 'font_note', 'reference_sites']);
export function nxParseDesignPrefs(raw, validDesignIds) {
  let o = raw;
  if (typeof raw === 'string') { try { o = raw.trim() ? JSON.parse(raw) : {}; } catch (e) { o = {}; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) o = {};
  const errors = [];
  const out = {};
  const pick = (k, allowed) => {
    if (o[k] === undefined || o[k] === null || o[k] === '') return;
    const v = String(o[k]).trim().toLowerCase();
    if (allowed.includes(v)) out[k] = v; else errors.push(`${k}: "${String(o[k]).slice(0, 40)}" is not in the catalog`);
  };
  if (o.design_id !== undefined && o.design_id !== '') {
    const v = String(o.design_id).trim().toLowerCase();
    if (!validDesignIds || validDesignIds.includes(v)) out.design_id = v; else errors.push(`design_id: "${v.slice(0, 40)}" is not a design`);
  }
  pick('theme_id', Object.keys(SITE_THEMES));
  pick('hero_style', Object.keys(HERO_STYLES));
  pick('card_style', Object.keys(CARD_STYLES));
  pick('nav_style', Object.keys(NAV_STYLES));
  pick('anim_preset', Object.keys(ANIM_PRESETS));
  pick('three_d', Object.keys(THREE_D_LEVELS));
  pick('direction', DIRECTION_IDS);
  pick('mode', ['light', 'dark', 'auto']);
  pick('icon_style', ICON_STYLES);
  pick('motion', MOTION_LEVELS);
  pick('density', DENSITY);
  pick('tone', TONE);
  for (const k of ['sections', 'avoid']) {
    if (o[k] === undefined || o[k] === null) continue;
    const arr = (Array.isArray(o[k]) ? o[k] : String(o[k]).split(/[,\n]/)).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
    const bad = arr.filter((s) => !SECTION_IDS.includes(s));
    if (bad.length) errors.push(`${k}: unknown section(s) ${bad.slice(0, 5).join(', ')}`);
    const ok = arr.filter((s) => SECTION_IDS.includes(s));
    if (ok.length) out[k] = Array.from(new Set(ok)).slice(0, 24);
  }
  for (const k of ['palette_note', 'font_note']) if (o[k] !== undefined && o[k] !== null && String(o[k]).trim()) out[k] = String(o[k]).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (o.reference_sites !== undefined && o.reference_sites !== null) {
    const arr = (Array.isArray(o.reference_sites) ? o.reference_sites : String(o.reference_sites).split(/[,\n\s]+/)).map((s) => String(s).trim()).filter((s) => /^https?:\/\/[^\s"'<>]{4,200}$/i.test(s));
    if (arr.length) out.reference_sites = arr.slice(0, 5);
  }
  return { prefs: out, errors };
}

// ── 3. The art director ────────────────────────────────────────────────────
// Deterministic for a given brief (seeded by name + industry + variant) so the
// same description regenerates the same look, while variant 0..9 explores.
function seedFrom(str) { let h = 2166136261; const s = String(str || ''); for (let i = 0; s.length > i; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function nxAutoDesign(brief, prefs, opts) {
  brief = brief || {}; prefs = prefs || {}; opts = opts || {};
  const industry = (brief.industry && brief.industry.id) || brief._industry || 'general';
  const archetype = (brief.industry && brief.industry.archetype) || brief.archetype || brief._archetype || 'professional';
  // nx_brief gives { primary, secondary }; plans carry the string in _personality
  const rawP = brief.personality && typeof brief.personality === 'object' ? brief.personality.primary : (brief.personality || brief._personality);
  const personality = PERSONALITY_STYLE[rawP] ? rawP : 'precise';
  const ps = PERSONALITY_STYLE[personality];
  const variant = Math.max(0, Math.min(9, parseInt(opts.variant, 10) || 0));
  const seed = seedFrom((brief.name || '') + '|' + industry + '|' + variant);
  const pickSeeded = (arr, salt) => arr[(seed + salt * 7919) % arr.length];
  const wantMode = prefs.mode && prefs.mode !== 'auto' ? prefs.mode : (opts.mode || (ps.prefersDark === true ? 'dark' : ps.prefersDark === false ? 'light' : null));
  let themeId = prefs.theme_id || '';
  const explanation = [];
  if (!themeId) {
    const shortlist = (ARCHETYPE_THEMES[archetype] || ARCHETYPE_THEMES.professional).filter((id) => SITE_THEMES[id]);
    let pool = wantMode ? shortlist.filter((id) => themeMode(id) === wantMode) : shortlist;
    if (!pool.length) pool = shortlist;
    // the brief's personality nudges within the archetype shortlist
    const moodFor = { warm: 'warm', refined: 'luxury', bold: 'bold', precise: 'professional', calm: 'calm', playful: 'playful' }[personality];
    const moody = pool.filter((id) => (THEME_MOODS[id] || []).includes(moodFor));
    themeId = pickSeeded(moody.length ? moody : pool, 1);
    explanation.push(`theme "${SITE_THEMES[themeId].name}" fits a ${personality} ${archetype} business${wantMode ? ' (' + wantMode + ' mode)' : ''}`);
  } else explanation.push(`theme "${SITE_THEMES[themeId] ? SITE_THEMES[themeId].name : themeId}" is the owner's standing preference`);
  const heroStyle = prefs.hero_style || pickSeeded(ps.hero, 2);
  const cardStyle = prefs.card_style || pickSeeded(ps.card, 3);
  const navStyle = prefs.nav_style || pickSeeded(ps.nav, 4);
  let animPreset = prefs.anim_preset || pickSeeded(ps.anim, 5);
  if (prefs.motion === 'none') animPreset = 'none';
  else if (prefs.motion === 'subtle' && !prefs.anim_preset) animPreset = 'fade';
  else if (prefs.motion === 'expressive' && !prefs.anim_preset) animPreset = pickSeeded(['clip', 'pop', 'flip', 'zoom'], 6);
  const threeD = prefs.three_d || (prefs.motion === 'none' ? 'off' : 'off');
  explanation.push(`hero "${HERO_STYLES[heroStyle].name}", cards "${CARD_STYLES[cardStyle].name}", nav "${NAV_STYLES[navStyle].name}", entrance "${ANIM_PRESETS[animPreset].name}"`);
  return {
    theme_id: themeId, hero_style: heroStyle, card_style: cardStyle, nav_style: navStyle, anim_preset: animPreset, three_d: threeD,
    mode: themeMode(themeId), personality, archetype, industry, variant,
    icon_style: prefs.icon_style || 'line',
    icon_family: INDUSTRY_ICONS[industry] || INDUSTRY_ICONS.general,
    direction: prefs.direction || '',
    explanation: explanation.join('; ') + '.',
    source: prefs.theme_id || prefs.hero_style || prefs.card_style || prefs.nav_style ? 'owner+auto' : 'auto',
  };
}

// ── 4. The builder prompt ──────────────────────────────────────────────────
export const NX_BUILDER_LAW = [
  'You are the senior art director and front-end engineer of a website studio. You produce the BODY of one finished, production-quality landing page.',
  'Facts are sacred: use only the names, numbers, prices, years, places, hours, phone numbers, emails, reviews and services in the CONTENT PLAN. Never invent any of them. If a fact is missing, write copy that needs no fact.',
  'Design is chosen, not improvised: use only the CSS classes listed in the section vocabulary; never output <style>, <script>, inline style attributes, event handlers, or hard-coded colours. The design tokens colour everything.',
  'Icons are line icons from the ICON LIBRARY, written as <i data-icon="id"></i> (one per service card, checklist item, contact row). Never emoji, never external icon fonts, never raw <svg>.',
  'Every image needs alt text; only image URLs present in the plan may be used. No stock-photo placeholders, no lorem ipsum, no "[Insert …]".',
  'Accessibility is not optional: one <h1>, h2 per section in order, buttons and links with real labels, form inputs with labels, contrast left to the tokens.',
  'Write for humans: concrete verbs, specific nouns, one idea per paragraph, no filler adjectives ("innovative", "cutting-edge", "seamless"), no exclamation marks in body copy.',
  'Output ONLY the body inner HTML — no markdown fences, no commentary, no <html>/<head>/<body> wrappers.',
].join('\n');

const SECTION_VOCAB = `Section vocabulary (class names are exact):
- nav: .nx-nav > .container.nx-nav-inner (div.nx-brand, button.nx-menu-btn, ul.nx-nav-links with anchors #home #services #about #process #gallery #reviews #faq #contact)
- hero: section.nx-hero#home > .container > .nx-hero-inner: span.nx-badge, h1 (wrap ONE keyword in span.grad-text), p.lead, .nx-hero-actions (a.btn.btn-primary + a.btn.btn-ghost), optional .nx-hero-img > img
- marquee: .nx-marquee > .nx-marquee-track > 5-6 span (trust phrases; the runtime scrolls it)
- stats: .nx-stats of 3-4 .nx-stat (b[data-count="N"] + span label) — only numbers from the plan
- services: .nx-grid.g3 of .nx-card (div.ic > i[data-icon], h3, p)
- why: .nx-split > div(.nx-check items: b > i[data-icon="check"], div > b title + span text) + div(img or .nx-art)
- about: .nx-split with h2.sec-title + paragraphs + optional img
- process: .nx-steps of 3-4 .nx-step (span.n number, h3, p)
- parallax: .nx-parallax > .container (h2, p, a.btn.btn-primary) — the mid-page call to action
- gallery: .nx-gallery of img (real plan URLs only; alt + loading="lazy")
- pricing: .nx-grid.g3 of .nx-card (h3 plan, b price, ul features, a.btn.btn-primary) — add class "popular" to one card
- team: .nx-grid.g2 of .nx-card (div.ic > i[data-icon="user"], h3 name, p role + bio)
- timeline: .nx-steps of milestones (span.n year, h3, p)
- logos: .nx-grid.g3 of .nx-card (h3 client, p one line)
- video: .nx-parallax containing iframe (YouTube embed URL from the plan only, loading="lazy", title)
- reviews: .nx-tstrip of .nx-review (div.stars "★★★★★", p quote, div.who name)
- lead: section.nx-lead > .container (h2, p, a.btn.btn-primary) — same primary action as the hero
- newsletter: .nx-lead with form.nx-form (input[name=email] + button)
- faq: .nx-faq of 3-5 .nx-faq-item (button.nx-faq-q + div.nx-faq-a, answers 20-40 words)
- hours: .nx-hours rows; areas: .nx-occasions chips; map: .nx-map > iframe (Google Maps embed of the plan address)
- contact: section#contact .nx-contact-grid: .nx-cinfo rows (div > div > b label + span value; b may start with i[data-icon]) + form.nx-form (label+input name, email, phone, textarea message, button[type=submit].btn.btn-primary)
- footer: footer.nx-footer > .container (© year brand · address · phone)
Every section except nav/footer: <section class="section" id="…"><div class="container"><span class="eyebrow">kicker</span><h2 class="sec-title">title</h2>…</div></section>. Add data-reveal to major blocks (data-delay="1|2|3" to stagger).`;

function compactCatalog(design) {
  const cat = nxDesignCatalog();
  const lines = [];
  lines.push(`THEMES (${cat.counts.themes}; each has light/dark mode and full token set): ` + cat.themes.map((t) => `${t.id}[${t.mode[0]}]`).join(' '));
  lines.push(`HERO LAYOUTS: ` + cat.heroes.map((h) => h.id).join(' ') + ` · CARD STYLES: ` + cat.cards.map((c) => c.id).join(' ') + ` · NAV STYLES: ` + cat.navs.map((n) => n.id).join(' ') + ` · ENTRANCE ANIMATIONS: ` + cat.anims.map((a) => a.id).join(' '));
  lines.push(`ART DIRECTIONS (full-page compositions): ` + cat.directions.join(' '));
  if (design) lines.push(`THIS BUILD USES: theme=${design.theme_id} (${design.mode}) hero=${design.hero_style} cards=${design.card_style} nav=${design.nav_style} animation=${design.anim_preset}${design.direction ? ' direction=' + design.direction : ''}. The CSS for exactly this combination is already on the page — write markup that fits it (${HERO_STYLES[design.hero_style] ? HERO_STYLES[design.hero_style].prompt : 'standard hero'}).`);
  lines.push('ICON LIBRARY (use ids exactly):\n' + nxIconCatalogForAI());
  return lines.join('\n');
}

// ctx: { sectionList, contentSpec, design, ownerInstructions, brandVoice, siteInstructions, prefs, sceneHint, language, dir }
// Returns the prompt as ONE string (system + user parts joined) and exposes
// the split through nxBuilderMessages(): the standing part (law, catalog,
// vocabulary, owner settings) is the system turn; the per-build part
// (sections, site instructions, content plan, rules) is the user turn.
export function nxBuilderMessages(ctx) {
  ctx = ctx || {};
  const prefs = ctx.prefs || {};
  const sys = [];
  sys.push('BUILDER LAW:\n' + NX_BUILDER_LAW);
  sys.push('DESIGN CATALOG:\n' + compactCatalog(ctx.design));
  sys.push(SECTION_VOCAB);
  const owner = [];
  if (ctx.ownerInstructions) owner.push('Standing builder instructions from the site owner (apply to every site they build):\n' + String(ctx.ownerInstructions).slice(0, 4000));
  if (ctx.brandVoice) owner.push('Brand voice (every sentence must sound like this): ' + String(ctx.brandVoice).slice(0, 1000));
  const prefLines = [];
  if (prefs.tone) prefLines.push(`tone: ${prefs.tone}`);
  if (prefs.density) prefLines.push(`density: ${prefs.density}`);
  if (prefs.motion) prefLines.push(`motion: ${prefs.motion}`);
  if (prefs.icon_style) prefLines.push(`icon style: ${prefs.icon_style}${prefs.icon_style === 'none' ? ' (omit div.ic entirely)' : ''}`);
  if (prefs.palette_note) prefLines.push(`palette note: ${prefs.palette_note}`);
  if (prefs.font_note) prefLines.push(`typography note: ${prefs.font_note}`);
  if (Array.isArray(prefs.avoid) && prefs.avoid.length) prefLines.push(`never include these sections: ${prefs.avoid.join(', ')}`);
  if (Array.isArray(prefs.reference_sites) && prefs.reference_sites.length) prefLines.push(`reference sites the owner admires (match their feel, never copy their text): ${prefs.reference_sites.join(', ')}`);
  if (prefLines.length) owner.push('Owner design preferences: ' + prefLines.join('; ') + '.');
  if (owner.length) sys.push('OWNER SETTINGS (rank above defaults, below facts):\n' + owner.join('\n'));
  const usr = [];
  usr.push(`INCLUDE ONLY THESE SECTIONS, IN THIS EXACT ORDER: ${ctx.sectionList || 'nav, hero, services, about, reviews, faq, contact, footer'}.`);
  if (ctx.siteInstructions) usr.push('INSTRUCTIONS FOR THIS SITE (follow strictly; they refine, never contradict, the facts):\n' + String(ctx.siteInstructions).slice(0, 1500));
  const lang = ctx.language && ctx.language !== 'en' ? `\n- Write every word in ${ctx.language}${ctx.dir === 'rtl' ? ' (right-to-left; the page sets dir="rtl")' : ''}.` : '';
  const rules = `RULES:
- Hero headline ≤ 12 words, sub ≤ 25 words, buttons ≤ 3 words; every other paragraph ≤ 45 words.
- Service cards: 3-6, each with a distinct icon from the ICON LIBRARY that matches the service (plumbing → droplet/wrench, dentistry → tooth, weddings → ring).
- Stats only from the plan's numbers; if the plan has none, omit the stats section.
- Reviews only from the plan; if none, omit the reviews section rather than inventing testimonials.
- The hero CTA, the parallax CTA and the lead CTA describe the SAME primary action.
- Contact section uses the plan's exact phone, email, address and hours; the form keeps inputs name, email, phone, message.
- Vary rhythm: not every section is a 3-column grid; alternate split / grid / band / strip treatments.${ctx.sceneHint || ''}${lang}
- Output ONLY the body HTML.`;
  // BUDGET: the provider layer hard-caps every message at MAX_MSG_CHARS. The
  // RULES (and any widget/scene hints inside them) must always reach the
  // model, so a long content plan is trimmed to what fits — least important
  // copy first (faq, process, why, about, marquee), then a hard cut on the
  // COPY line — never the RULES or the section list.
  const fixed = usr.join('\n\n').length + rules.length + 4;
  let spec = ctx.contentSpec ? String(ctx.contentSpec) : '';
  if (spec && fixed + spec.length > MAX_MSG_CHARS) spec = shrinkContentSpec(spec, MAX_MSG_CHARS - fixed);
  if (spec) usr.push(spec);
  usr.push(rules);
  return { system: sys.join('\n\n'), user: usr.join('\n\n') };
}
export const MAX_MSG_CHARS = 8000;
// Trim a CONTENT PLAN string to `budget` chars by dropping the least
// important COPY keys first; the BRIEF (facts) and HARD RULES lines survive.
export function shrinkContentSpec(spec, budget) {
  const copyAt = spec.indexOf('\nCOPY: ');
  const rulesAt = spec.indexOf('\nHARD RULES:');
  if (copyAt === -1 || rulesAt === -1 || rulesAt < copyAt) return spec.slice(0, Math.max(0, budget));
  const head = spec.slice(0, copyAt);
  const tail = spec.slice(rulesAt);
  let copy;
  try { copy = JSON.parse(spec.slice(copyAt + 7, rulesAt)); } catch (e) { copy = null; }
  if (!copy || typeof copy !== 'object') return spec.slice(0, Math.max(0, budget));
  const order = ['video_url', 'gallery_imgs', 'areas', 'occasions', 'logos', 'timeline', 'marquee', 'why', 'process', 'faq', 'about', 'team', 'reviews', 'stats', 'product', 'working_hours', 'cta', 'pricing', 'services', 'contact', 'hero'];
  const build = () => head + '\nCOPY: ' + JSON.stringify(copy) + tail;
  let out = build();
  for (const k of order) {
    if (out.length <= budget) break;
    if (k in copy) { delete copy[k]; out = build(); }
  }
  if (out.length > budget) {
    // last resort: shorten the facts block too, keeping the rules intact
    const room = Math.max(0, budget - tail.length - 20);
    out = (head + '\nCOPY: ' + JSON.stringify(copy)).slice(0, room) + '…' + tail;
  }
  return out;
}
export function nxBuilderPrompt(ctx) {
  const m = nxBuilderMessages(ctx);
  return m.system + '\n\n' + m.user;
}

// The plan-JSON prompt used when scanning an old site — icons become ids.
export function nxPlanPromptIconRule() {
  return `"icon" must be an icon id from this library (never emoji): ${NX_ICON_IDS.slice(0, 80).join(' ')} …`;
}

// ── 5. A concise, human-readable design brief for the build report ─────────
export function nxDesignReport(design, prefs, ownerInstructions) {
  if (!design) return null;
  return {
    theme: design.theme_id, theme_name: SITE_THEMES[design.theme_id] ? SITE_THEMES[design.theme_id].name : design.theme_id, mode: design.mode,
    hero: design.hero_style, cards: design.card_style, nav: design.nav_style, animation: design.anim_preset, three_d: design.three_d,
    direction: design.direction || '', icon_style: design.icon_style, personality: design.personality, archetype: design.archetype,
    source: design.source, explanation: design.explanation,
    owner_prefs_applied: Object.keys(prefs || {}),
    owner_instructions_applied: !!(ownerInstructions && String(ownerInstructions).trim()),
  };
}

export const __designBrainInternals = { THEME_MOODS, ARCHETYPE_THEMES, PERSONALITY_STYLE, AI_ONLY_HEROES, SECTION_IDS, DIRECTION_IDS, ICON_STYLES, MOTION_LEVELS, DENSITY, TONE, seedFrom };
