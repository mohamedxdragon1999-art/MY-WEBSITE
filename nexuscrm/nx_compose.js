// nx_compose.js — DIRECTION-AUTHORITATIVE COMPOSITION ENGINE (Cycle 2).
//
// Cycle 1 built the design-QUALITY foundation. Cycle 2 turns it into the site the
// user actually SEES. A design direction is an authoritative input that changes
// section selection, hero structure, section variants, typography scale, section
// rhythm, density, surface treatment and motion language — not just color/font.
// It composes from primitives + families (no hardcoded static templates). A
// color-only difference is a FAILED direction (the tests enforce this).

const NX_COMPOSE_DIRECTIONS = {
  'editorial-minimal': {
    id: 'editorial-minimal', name: 'Editorial Minimal', family: 'type-led',
    palette: { bg: '#F4F1EB', bg2: '#EAE6DC', surface: '#FBFAF6', surface2: '#EFECE2', text: '#1A1714', muted: '#6B655A', faint: '#9B9486', accent: '#B5402A', accent2: '#6A4A34', line: 'rgba(26,23,20,.12)', rule: '#1A1714' },
    type: { family: "'Playfair Display', Georgia, serif", body: "'Helvetica Neue', Arial, sans-serif", display: 'clamp(3.2rem,8.5vw,6.6rem)', hero: 'clamp(2.6rem,6vw,4.6rem)', section: 'clamp(1.7rem,3.4vw,2.6rem)', body: 'clamp(1.02rem,1.35vw,1.14rem)', caption: '0.78rem', btn: '0.74rem', measure: '62ch' },
    radius: 0, shadow: 'none', surfaceFx: 'none',
    heroVariant: 'editorial', featureMode: 'edlist', reviewMode: 'quote',
    sectionOrder: ['nav', 'hero', 'logos', 'feature', 'story', 'work', 'reviews', 'cta', 'contact', 'footer'],
    rhythm: ['dramatic', 'compact', 'normal', 'spacious', 'normal', 'compact', 'dramatic'],
    density: 'airy', motion: 'quiet', emphasis: { hero: 100, cta: 80, feature: 55, story: 55, contact: 60 },
    desc: 'Strong typography, generous whitespace, restrained surfaces, editorial grid, asymmetric alignment, minimal decoration, quiet motion.',
  },
  'cinematic-immersive': {
    id: 'cinematic-immersive', name: 'Cinematic Immersive', family: 'image-led',
    palette: { bg: '#07090D', bg2: '#0B0E14', surface: '#12161F', surface2: '#171D2A', text: '#EAF0F6', muted: '#94A1B4', faint: '#5A6678', accent: '#FF6A2B', accent2: '#FFB23E', line: 'rgba(255,255,255,.10)', rule: 'rgba(255,255,255,.16)' },
    type: { family: "'Space Grotesk', 'Inter', sans-serif", body: "'Inter', system-ui, sans-serif", display: 'clamp(3.4rem,10vw,8rem)', hero: 'clamp(2.4rem,6vw,4.8rem)', section: 'clamp(1.9rem,4vw,3.1rem)', body: 'clamp(1.05rem,1.4vw,1.2rem)', caption: '0.8rem', btn: '0.75rem', measure: '58ch' },
    radius: 18, shadow: '0 40px 90px -30px rgba(0,0,0,.8)', surfaceFx: 'glass',
    heroVariant: 'fullbleed', featureMode: 'bento', reviewMode: 'grid',
    sectionOrder: ['nav', 'hero', 'marquee', 'metrics', 'feature', 'story', 'work', 'reviews', 'cta', 'contact', 'footer'],
    rhythm: ['dramatic', 'compact', 'spacious', 'normal', 'dramatic', 'normal', 'compact', 'dramatic'],
    density: 'balanced', motion: 'cinematic', emphasis: { hero: 100, cta: 80, feature: 60, story: 55, contact: 60 },
    desc: 'Large visual hero, deep layering, dramatic scale, controlled depth, image dominance, slower motion, strong transitions.',
  },
  'luxury-art': {
    id: 'luxury-art', name: 'Luxury Art-Directed', family: 'editorial',
    palette: { bg: '#0E0C09', bg2: '#14110C', surface: '#1B1712', surface2: '#221C14', text: '#F3ECDD', muted: '#A99C82', faint: '#6E6250', accent: '#C9A961', accent2: '#E4CF9A', line: 'rgba(201,169,97,.22)', rule: 'rgba(201,169,97,.4)' },
    type: { family: "'Playfair Display', 'Didot', Georgia, serif", body: "'Helvetica Neue', Arial, sans-serif", display: 'clamp(3rem,7.5vw,5.8rem)', hero: 'clamp(2.3rem,5.4vw,4.2rem)', section: 'clamp(1.6rem,3vw,2.3rem)', body: 'clamp(1.02rem,1.3vw,1.12rem)', caption: '0.72rem', btn: '0.72rem', measure: '56ch' },
    radius: 2, shadow: '0 30px 80px -40px rgba(0,0,0,.7)', surfaceFx: 'metallic',
    heroVariant: 'minimal', featureMode: 'split', reviewMode: 'single',
    sectionOrder: ['nav', 'hero', 'story', 'feature', 'work', 'reviews', 'cta', 'footer'],
    rhythm: ['dramatic', 'spacious', 'normal', 'spacious', 'normal', 'dramatic', 'normal'],
    density: 'airy', motion: 'slow', emphasis: { hero: 100, cta: 75, feature: 50, story: 60, contact: 60 },
    desc: 'High negative space, refined typography, minimal palette, large visual moments, asymmetry, subtle surfaces, slow precise motion.',
  },
  'bold-experimental': {
    id: 'bold-experimental', name: 'Bold Experimental', family: 'type-led',
    palette: { bg: '#101014', bg2: '#16161C', surface: '#1E1E26', surface2: '#25252F', text: '#F2F2F5', muted: '#A0A0AC', faint: '#6A6A78', accent: '#FF3E7A', accent2: '#4C6EFF', line: 'rgba(255,255,255,.12)', rule: 'rgba(255,255,255,.2)' },
    type: { family: "'Archivo Black', 'Space Grotesk', sans-serif", body: "'Inter', system-ui, sans-serif", display: 'clamp(4rem,13vw,10rem)', hero: 'clamp(3rem,9vw,7rem)', section: 'clamp(2.2rem,5.5vw,4rem)', body: 'clamp(1.05rem,1.4vw,1.2rem)', caption: '0.78rem', btn: '0.78rem', measure: '54ch' },
    radius: 0, shadow: '6px 6px 0 var(--accent)', surfaceFx: 'flat',
    heroVariant: 'overlap', featureMode: 'alternating', reviewMode: 'grid',
    sectionOrder: ['nav', 'hero', 'marquee', 'feature', 'metrics', 'work', 'reviews', 'cta', 'contact', 'footer'],
    rhythm: ['dramatic', 'compact', 'dramatic', 'normal', 'compact', 'dramatic', 'compact'],
    density: 'dense', motion: 'energetic', emphasis: { hero: 100, cta: 85, feature: 60, work: 65, contact: 60 },
    desc: 'Unexpected composition, strong contrast, large/small scale variation, overlap, experimental grid, expressive motion.',
  },
  'swiss-structured': {
    id: 'swiss-structured', name: 'Modern Swiss', family: 'systematic',
    palette: { bg: '#FAFAF8', bg2: '#F2F2EE', surface: '#FFFFFF', surface2: '#EBEBE5', text: '#111210', muted: '#5A5C55', faint: '#8A8C83', accent: '#1B4DE4', accent2: '#0A0A0A', line: 'rgba(17,18,16,.14)', rule: '#111210' },
    type: { family: "'Inter', 'Helvetica Neue', sans-serif", body: "'Inter', system-ui, sans-serif", display: 'clamp(3rem,8vw,5.6rem)', hero: 'clamp(2.2rem,4.8vw,3.6rem)', section: 'clamp(1.5rem,2.8vw,2.1rem)', body: 'clamp(1rem,1.25vw,1.08rem)', caption: '0.75rem', btn: '0.74rem', measure: '72ch' },
    radius: 0, shadow: 'none', surfaceFx: 'none',
    heroVariant: 'split', featureMode: 'ruled', reviewMode: 'quote',
    sectionOrder: ['nav', 'hero', 'metrics', 'feature', 'story', 'work', 'cta', 'footer'],
    rhythm: ['normal', 'compact', 'normal', 'normal', 'compact', 'normal', 'compact'],
    density: 'balanced', motion: 'functional', emphasis: { hero: 100, cta: 70, feature: 55, metrics: 45, contact: 60 },
    desc: 'Strong grid, strict alignment, controlled typography, clear information hierarchy, restrained decoration, precise spacing, functional motion.',
  },
};

const NX_COMPOSE_ORDER = ['editorial-minimal', 'cinematic-immersive', 'luxury-art', 'bold-experimental', 'swiss-structured'];

// Section-transition motifs — how a section connects to the one before it, so a
// page reads as one continuous composition rather than isolated blocks (§16).
const NX_COMPOSE_TRANSITIONS = {
  'editorial-minimal':   ['fade', 'bridge', 'flat', 'bleed', 'fade', 'bridge'],
  'cinematic-immersive': ['bleed', 'overlap', 'fade', 'bleed', 'overlap'],
  'luxury-art':          ['fade', 'flat', 'bridge', 'flat', 'flat'],
  'bold-experimental':   ['overlap', 'bleed', 'overlap', 'fade', 'overlap'],
  'swiss-structured':    ['bridge', 'flat', 'bridge', 'flat', 'bridge'],
};

// ── Content architecture (what the page says — always derived from the plan) ──
// HARDENING: a plan arrives from AI output, imported sites and user input, so no
// field can be trusted to have the expected type. `__arr` tolerates a non-array
// collection instead of throwing, and `__str` never lets a non-primitive leak
// into visible copy as "[object Object]" / "NaN" / "undefined".
function __arr(v) { return Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]); }
function __str(v) {
  if (v == null) return '';
  const t = typeof v;
  if (t === 'string') return v;
  if (t === 'number') return Number.isFinite(v) ? String(v) : '';
  if (t === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(__str).filter(Boolean).join(' ');
  if (t === 'object') {
    // Prefer a human-meaningful field over a useless "[object Object]".
    for (const k of ['title', 'text', 'name', 'label', 'value', 'q', 'a']) {
      if (v[k] != null && typeof v[k] !== 'object') return __str(v[k]);
    }
    return '';
  }
  return '';
}
function nxComposeContent(plan) {
  plan = (plan && typeof plan === 'object' && !Array.isArray(plan)) ? plan : {};
  const name = __str(plan.site_name || plan.name).slice(0, 60) || 'Studio';
  const owner = __str(plan.ownerName || plan.owner).split(' ')[0] || 'The Studio';
  const headline = __str(plan.hero_headline || plan.tagline).slice(0, 90) || 'Made to be remembered.';
  const sub = __str(plan.hero_sub || plan.description).slice(0, 180) || 'A considered, high-craft site for people who care about the details.';
  const ctas = { primary: __str(plan.cta_primary).slice(0, 28) || 'Start a project', secondary: __str(plan.cta_secondary).slice(0, 28) || 'See our work' };
  const services = __arr(plan.services || plan.features).slice(0, 6).map(s => {
    if (typeof s === 'string') return { title: s.slice(0, 32), text: '' };
    return { title: __str(s && s.title).slice(0, 40), text: __str(s && (s.desc || s.text)).slice(0, 140), icon: __str(s && s.icon).slice(0, 12) };
  }).filter(s => s.title || s.text);
  const why = __arr(plan.why_us || plan.why).map(w => (typeof w === 'string' ? w : __str(w && (w.check || w.title)))).filter(Boolean).slice(0, 5);
  const stats = __arr(plan.stats).slice(0, 4).map(s => ({ value: (s && s.value != null && __str(s.value) !== '') ? s.value : '0', label: __str(s && (s.label || s.name)).slice(0, 30) })).filter(s => s.label);
  const projects = __arr(plan.projects).slice(0, 6).map(p => ({ title: __str(p && p.title).slice(0, 60), cat: __str(p && (p.cat || p.cls)).slice(0, 30), text: __str(p && p.text).slice(0, 110) })).filter(p => p.title);
  const reviews = __arr(plan.reviews || plan.testimonials).slice(0, 4).map(r => ({ quote: __str(r && (r.text || r.quote)).slice(0, 220), author: __str(r && (r.name || r.author)).slice(0, 40), role: __str(r && (r.role || r.via)).slice(0, 30), stars: Math.max(1, Math.min(5, Number(r && r.stars) || 5)) })).filter(r => r.quote);
  const faqs = __arr(plan.faqs || plan.faq).slice(0, 6).map(f => ({ q: __str(f && f.q).slice(0, 100), a: __str(f && f.a).slice(0, 200) })).filter(f => f.q);
  const contact = (plan.contact && typeof plan.contact === 'object') ? plan.contact : {};
  const phone = __str(contact.phone || plan.phone).slice(0, 30);
  const email = __str(contact.email || plan.email).slice(0, 60);
  return { name, owner, headline, sub, ctas, services, why, stats, projects, reviews, faqs, contact, phone, email, meta: __str(plan.description).slice(0, 160) };
}

// ── Composition Plan: direction → section order/variants/typography/rhythm/density ──
function nxComposePlan(content, directionId) {
  const d = NX_COMPOSE_DIRECTIONS[directionId] || NX_COMPOSE_DIRECTIONS['editorial-minimal'];
  const has = (arr) => Array.isArray(arr) && arr.length > 0;
  let sections = d.sectionOrder.slice();
  const drop = (s) => {
    if (s === 'feature' && !has(content.services) && !has(content.why)) return true;
    if (s === 'story' && !content.headline && !content.sub) return true;
    if (s === 'work' && !has(content.projects)) return true;
    if (s === 'reviews' && !has(content.reviews)) return true;
    if (s === 'metrics' && !has(content.stats)) return true;
    if (s === 'marquee' && !has(content.why)) return true;
    if (s === 'logos' && !has(content.why)) return true;
    return false;
  };
  sections = sections.filter(s => !drop(s));
  // Guarantee the required closing sections exist. `footer` is STRUCTURALLY
  // terminal: appending a missing `contact` after an already-present `footer`
  // would render the page furniture out of order, so re-seat the footer last.
  for (const req of ['cta', 'contact', 'footer']) if (!sections.includes(req)) sections.push(req);
  if (sections[sections.length - 1] !== 'footer') {
    sections = sections.filter(s => s !== 'footer').concat(['footer']);
  }
  // Section Rhythm System: map the direction's rhythm motif onto the final,
  // filtered section list so EVERY section gets an explicit, real spacing beat.
  const motif = (d.rhythm && d.rhythm.length ? d.rhythm : ['normal']);
  const floor = (v) => sections.indexOf(v);
  const orderKey = (s) => { const i = floor(s); return i < 0 ? sections.length : i; };
  const rhythm = sections.map((_, i) => motif[i % motif.length]);
  return {
    direction: d.id, name: d.name, family: d.family, palette: d.palette, type: d.type,
    radius: d.radius, shadow: d.shadow, surfaceFx: d.surfaceFx,
    heroVariant: d.heroVariant, featureMode: d.featureMode, reviewMode: d.reviewMode,
    sections, rhythm, transitions: sections.map((_, i) => { const mot = NX_COMPOSE_TRANSITIONS[d.id] || ['fade']; return i === 0 ? 'flat' : mot[(i - 1) % mot.length]; }),
    emphasisTiers: sections.map((s) => { const w = (d.emphasis && d.emphasis[s] != null) ? d.emphasis[s] : __EMPH_W[s]; return __EMPH_TIER(w == null ? 50 : w); }),
    density: d.density, motion: d.motion, emphasis: d.emphasis || {}, desc: d.desc,
  };
}

// ── Design explanation (corresponds to the plan; no invented claims) ──
function nxDesignExplanation(plan, content, directionId) {
  const d = NX_COMPOSE_DIRECTIONS[directionId] || NX_COMPOSE_DIRECTIONS['editorial-minimal'];
  const present = (k, v) => Array.isArray(v) && v.length;
  const removed = ['pricing', 'team', 'timeline', 'video', 'logos'].filter(x => present(x, plan[x])).length;
  const lines = [
    'Chosen direction: ' + d.name + '.',
    'Why: ' + d.desc + '.',
    'Composition: ' + d.heroVariant + ' hero, ' + d.featureMode + ' feature treatment, ' + d.rhythm.join(' → ') + ' rhythm.',
    'Typography: ' + (d.type.family.indexOf('serif') >= 0 ? 'editorial serif display' : 'grotesk display') + ' with a restrained body measure (' + d.type.measure + ').',
    'Density: ' + d.density + '. Motion: ' + d.motion + '.',
  ];
  if (removed) lines.push('Sections omitted: ' + removed + ' section(s) without a distinct purpose were removed to keep the composition focused.');
  return lines.join('\n');
}

// ── SCALABLE VECTOR PLACEHOLDERS (art-directed, inline — no external images) ──
function __art(seed, w, h, dir) {
  w = w || 800; h = h || 600;
  const accents = { 'editorial-minimal': ['#B5402A', '#6A4A34'], 'cinematic-immersive': ['#FF6A2B', '#FFB23E'], 'luxury-art': ['#C9A961', '#E4CF9A'], 'bold-experimental': ['#FF3E7A', '#4C6EFF'], 'swiss-structured': ['#1B4DE4', '#0A0A0A'] };
  const pair = accents[dir] || ['#333', '#666']; let idx = (seed || 0) % pair.length; const a = pair[idx], b = pair[(idx + 1) % 2];
  const palette = { 'editorial-minimal': '#EFECE2', 'cinematic-immersive': '#12161F', 'luxury-art': '#1B1712', 'bold-experimental': '#25252F', 'swiss-structured': '#EBEBE5' };
  const base = palette[dir] || '#eee';
  const n = 5 + (seed % 4);
  let rects = '';
  for (let i = 0; i < n; i++) { const x = (i * 137 + (seed || 0) * 61) % w, y = (i * 191 + (seed || 0) * 47) % h, rw = 60 + ((i * 53) % 200), rh = 40 + ((i * 97) % 160), o = 0.12 + ((i * 23) % 30) / 100; rects += `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="${a}" opacity="${o}"/>`; }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g${seed}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${base}"/><stop offset="1" stop-color="${b}" stop-opacity=".55"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g${seed})"/>${rects}<circle cx="${(seed * 173) % w}" cy="${(seed * 89) % h}" r="${70 + (seed % 50)}" fill="${a}" opacity=".18"/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
function __e(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ── SECTION RENDERERS (structural variants per direction) ────────────────────
function __nav(c, p) {
  const links = p.sections.filter(s => ['feature', 'story', 'work', 'reviews', 'contact', 'metrics'].includes(s)).slice(0, 5);
  const mk = (label, id) => `<a href="#${id}">${__e(label)}</a>`;
  const map = { feature: 'Work', story: 'Story', work: 'Projects', reviews: 'Clients', contact: 'Contact', metrics: 'Numbers' };
  return `<header class="c-nav" data-r><div class="c-wrap c-bar"><div class="c-brand">${__e(c.name)}</div><nav class="c-links">${links.map(x => mk(map[x] || x, x)).join('')}</nav><a class="c-btn c-btn-ghost" href="#contact">${__e(c.ctas.primary)}</a></div></header>`;
}

function __hero(c, p) {
  const v = p.heroVariant;
  const eyebrow = `<span class="c-kicker">${__e(c.name)} — 2026</span>`;
  const title = `<h1 class="c-display">${__e(c.headline)}</h1>`;
  const body = `<p class="c-lead">${__e(c.sub)}</p>`;
  const actions = `<div class="c-actions"><a class="c-btn c-btn-primary" href="#contact">${__e(c.ctas.primary)}</a><a class="c-btn c-btn-ghost" href="#work">${__e(c.ctas.secondary)}</a></div>`;
  if (v === 'editorial') {
    return `<section class="c-hero c-hero-editorial" id="home" data-r><div class="c-wrap c-hero-inner"><div class="c-hero-copy">${eyebrow}${title}${body}${actions}</div><div class="c-hero-meta"><span>Est. ${__e(c.owner)}</span><span class="c-rule"></span><span>High craft, considered</span></div></div><div class="c-hero-bleed">${__art(3, 1200, 420, p.direction)}</div></section>`;
  }
  if (v === 'fullbleed') {
    return `<section class="c-hero c-hero-fullbleed" id="home" data-r><div class="c-hero-bg">${__art(5, 1600, 1000, p.direction)}<div class="c-hero-veil"></div></div><div class="c-wrap c-hero-inner"><div class="c-hero-copy">${eyebrow}${title}${body}${actions}</div></div></section>`;
  }
  if (v === 'minimal') {
    return `<section class="c-hero c-hero-minimal" id="home" data-r><div class="c-wrap c-hero-inner">${eyebrow}${title}${body}<div class="c-hero-actions">${actions}</div></div></section>`;
  }
  if (v === 'overlap') {
    return `<section class="c-hero c-hero-overlap" id="home" data-r><div class="c-wrap c-hero-inner"><div class="c-hero-copy">${eyebrow}${title}${body}${actions}</div><div class="c-hero-badges">${__art(2, 520, 340, p.direction)}${__art(7, 380, 240, p.direction)}</div></div></section>`;
  }
  // split
  return `<section class="c-hero c-hero-split" id="home" data-r><div class="c-wrap c-hero-inner"><div class="c-hero-copy">${eyebrow}${title}${body}${actions}</div><div class="c-hero-img">${__art(4, 720, 720, p.direction)}</div></div></section>`;
}

function __logoStrip(c, p) {
  return `<section class="c-strip" data-r><div class="c-wrap c-strip-row">${['A', 'B', 'C', 'D', 'E'].map(x => `<span>${x}</span>`).join('')}</div></section>`;
}
function __marquee(c, p) {
  const items = (c.why && c.why.length ? c.why : ['Considered', 'Crafted', 'Precise', 'Timeless']).slice(0, 6);
  return `<div class="c-marquee" data-r><div class="c-marquee-track">${items.map(t => `<span>${__e(t)}</span><i>·</i>`).join('')}</div></div>`;
}
function __metrics(c, p) {
  return `<section class="c-metrics" id="metrics" data-r><div class="c-wrap c-metrics-grid">${(c.stats.length ? c.stats : [{ value: '0', label: 'Start here' }]).map((s, i) => `<div class="c-metric"><b data-count="${__e(s.value)}">${__e(s.value)}</b><span>${__e(s.label)}</span></div>`).join('')}</div></section>`;
}

function __feature(c, p) {
  const mode = p.featureMode; const items = c.services.length ? c.services : (c.why.length ? c.why.map(w => ({ title: w, text: c.sub })) : [{ title: 'Craft', text: c.sub }]);
  const head = `<div class="c-sec-head c-sec-left"><span class="c-kicker">What we do</span><h2 class="c-sec-title">${__e(p.direction === 'editorial-minimal' ? 'A considered craft' : 'What we do')}</h2></div>`;
  const num = (i) => `<span class="c-num">${String(i + 1).padStart(2, '0')}</span>`;
  if (mode === 'edlist') {
    return `<section class="c-feature c-feature-edlist" id="feature" data-r><div class="c-wrap">${head}<div class="c-edlist">${items.slice(0, 4).map((it, i) => `<div class="c-edrow"><div class="c-edrow-h">${num(i)}<h3>${__e(it.title)}</h3></div><p>${__e(it.text || c.sub)}</p></div>`).join('')}</div></div></section>`;
  }
  if (mode === 'alternating') {
    return `<section class="c-feature c-feature-alt" id="feature" data-r><div class="c-wrap">${head}<div class="c-altlist">${items.slice(0, 4).map((it, i) => `<div class="c-altrow"><div class="c-altrow-num">${num(i)}</div><div class="c-altrow-body"><h3>${__e(it.title)}</h3><p>${__e(it.text || c.sub)}</p></div><div class="c-altrow-img">${__art(i, 420, 260, p.direction)}</div></div>`).join('')}</div></div></section>`;
  }
  if (mode === 'bento') {
    return `<section class="c-feature c-feature-bento" id="feature" data-r><div class="c-wrap">${head}<div class="c-bento">${items.slice(0, 3).map((it, i) => `<div class="c-bento-cell ${i === 0 ? 'c-bento-big' : ''}"><div class="c-bento-img">${__art(i + 1, i === 0 ? 640 : 320, i === 0 ? 440 : 200, p.direction)}</div><h3>${__e(it.title)}</h3><p>${__e(it.text || c.sub)}</p></div>`).join('')}</div></div></section>`;
  }
  if (mode === 'split') {
    return `<section class="c-feature c-feature-split" id="feature" data-r><div class="c-wrap c-split"><div class="c-split-img">${__art(6, 640, 800, p.direction)}</div><div class="c-split-body">${head}${items.slice(0, 3).map(it => `<div class="c-split-item"><span class="c-dot"></span><div><h3>${__e(it.title)}</h3><p>${__e(it.text || c.sub)}</p></div></div>`).join('')}</div></div></section>`;
  }
  if (mode === 'ruled') {
    // Ruled grid — the authentic Swiss treatment: information sits in a strict
    // modular grid separated by hairline rules, NOT in elevated card surfaces.
    // This is a real alternative presentation mode (§11 card-soup), not a reskin.
    return `<section class="c-feature c-feature-ruled" id="feature" data-r><div class="c-wrap">${head}<div class="c-ruled${items.length > 3 ? ' c-ruled-3' : ''}">${items.slice(0, 6).map((it, i) => `<div class="c-ruled-cell"><span class="c-ruled-idx">${String(i + 1).padStart(2, '0')}</span><h3>${__e(it.title)}</h3><p>${__e(it.text || c.sub)}</p></div>`).join('')}</div></div></section>`;
  }
  // grid
  return `<section class="c-feature c-feature-grid" id="feature" data-r><div class="c-wrap">${head}<div class="c-grid${items.length > 3 ? ' c-grid-3' : ''}">${items.slice(0, 6).map((it) => `<div class="c-card"><span class="c-card-k">${__e(it.icon || '◦')}</span><h3>${__e(it.title)}</h3><p>${__e(it.text || c.sub)}</p></div>`).join('')}</div></div></section>`;
}

function __story(c, p) {
  return `<section class="c-story" id="story" data-r><div class="c-wrap c-story-inner"><div class="c-story-img">${__art(8, 700, 760, p.direction)}</div><div class="c-story-body"><span class="c-kicker">Our story</span><h2 class="c-sec-title">${__e(p.direction === 'bold-experimental' ? 'The work is the story' : 'Built on care')}</h2><p class="c-lead">${__e(c.sub)}</p><p class="c-body">${__e(c.meta || c.sub)}</p></div></div></section>`;
}

function __work(c, p) {
  const items = c.projects.length ? c.projects.slice(0, 6) : [{ title: 'Selected work', cat: 'Case study', text: c.sub }];
  return `<section class="c-work" id="work" data-r><div class="c-wrap"><div class="c-sec-head c-sec-left"><span class="c-kicker">Selected</span><h2 class="c-sec-title">${__e(p.direction === 'bold-experimental' ? 'WORK' : 'Selected projects')}</h2></div><div class="c-work-grid">${items.map((it, i) => `<a class="c-work-item" href="#contact"><figure>${__art(i + 2, 640, 460, p.direction)}</figure><div class="c-work-meta"><span class="c-work-cat">${__e(it.cat)}</span><h3>${__e(it.title)}</h3><p>${__e(it.text)}</p></div></a>`).join('')}</div></div></section>`;
}

function __reviews(c, p) {
  const items = c.reviews.length ? c.reviews.slice(0, 4) : [{ quote: c.sub, author: c.owner, role: 'Client' }];
  const star = () => '★'.repeat(5);
  if (p.reviewMode === 'single') {
    return `<section class="c-reviews c-reviews-single" id="reviews" data-r><div class="c-wrap"><div class="c-quote-large"><span class="c-mark">“</span><p>${__e(items[0].quote)}</p><div class="c-quote-by"><b>${__e(items[0].author)}</b><span>${__e(items[0].role)}</span><span class="c-stars">${star()}</span></div></div></div></section>`;
  }
  if (p.reviewMode === 'quote') {
    return `<section class="c-reviews c-reviews-quote" id="reviews" data-r><div class="c-wrap"><div class="c-quote-row">${items.slice(0, 2).map(it => `<figure class="c-quote"><blockquote>“${__e(it.quote)}”</blockquote><figcaption><b>${__e(it.author)}</b><span>${__e(it.role)}</span></figcaption></figure>`).join('')}</div></div></section>`;
  }
  return `<section class="c-reviews c-reviews-grid" id="reviews" data-r><div class="c-wrap"><div class="c-sec-head c-sec-left"><span class="c-kicker">Clients</span><h2 class="c-sec-title">What they say</h2></div><div class="c-reviewGrid">${items.map(it => `<div class="c-review"><span class="c-stars">${star()}</span><blockquote>“${__e(it.quote)}”</blockquote><div class="c-review-by"><b>${__e(it.author)}</b><span>${__e(it.role)}</span></div></div>`).join('')}</div></div></section>`;
}

function __cta(c, p) {
  return `<section class="c-cta" id="cta" data-r><div class="c-wrap c-cta-inner"><span class="c-kicker c-kicker-center">Let's talk</span><h2 class="c-cta-title">${__e(p.direction === 'bold-experimental' ? 'Make it happen' : 'Start the conversation')}</h2><div class="c-actions"><a class="c-btn c-btn-primary c-btn-lg" href="mailto:${__e(c.email)}">${__e(c.ctas.primary)}</a></div></div></section>`;
}
function __contact(c, p) {
  return `<section class="c-contact" id="contact" data-r><div class="c-wrap c-contact-inner"><span class="c-kicker">Get in touch</span><h2 class="c-sec-title">${__e(p.direction === 'bold-experimental' ? 'Talk to us' : 'Start a conversation')}</h2><p class="c-lead">${__e(c.ctas.primary)} — tell us what you're making.</p><div class="c-contact-row"><a href="mailto:${__e(c.email)}" class="c-btn c-btn-ghost">${__e(c.email)}</a>${c.phone ? `<a href="tel:${__e(c.phone)}" class="c-btn c-btn-ghost">${__e(c.phone)}</a>` : ''}</div></div></section>`;
}

function __footer(c, p) {
  return `<footer class="c-footer" data-r><div class="c-wrap c-footer-row"><div class="c-footer-brand">${__e(c.name)} <span>— ${__e(c.owner)}</span></div><div class="c-footer-links"><a href="mailto:${__e(c.email)}">${__e(c.email)}</a>${c.phone ? `<a href="tel:${__e(c.phone)}">${__e(c.phone)}</a>` : ''}<span>© 2026 ${__e(c.name)}</span></div></div></footer>`;
}

// ── FULL RENDER: compose sections in the plan order with the direction CSS ──
function __injectRhythm(html, rhythm, transition, emphasis) {
  if (!html) return html;
  const m = html.match(/<([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/);
  if (!m || !m[0]) return html;
  let tag = m[0].replace(/>$/, '').replace(/data-rhythm="[^"]*"/, '').replace(/data-transition="[^"]*"/, '').replace(/data-emphasis="[^"]*"/, '');
  if (rhythm) tag += ' data-rhythm="' + rhythm + '"';
  if (transition) tag += ' data-transition="' + transition + '"';
  if (emphasis) tag += ' data-emphasis="' + emphasis + '"';
  return html.replace(m[0], tag + '>');
}
// Map a section name to a visual-emphasis weight (0..100), then bucket into tiers.
const __EMPH_W = { hero: 100, cta: 85, metrics: 50, feature: 60, story: 60, work: 66, reviews: 55, contact: 60, marquee: 40, logos: 30, footer: 22, nav: 40 };
const __EMPH_TIER = (w) => (w >= 85 ? 'max' : w >= 65 ? 'high' : w >= 45 ? 'med' : 'low');

function nxRenderDirected(content, directionId, plan) {
  const d = NX_COMPOSE_DIRECTIONS[directionId] || NX_COMPOSE_DIRECTIONS['editorial-minimal'];
  const p = plan || nxComposePlan(content, directionId);
  const render = { nav: __nav, hero: __hero, logos: __logoStrip, marquee: __marquee, metrics: __metrics, feature: __feature, story: __story, work: __work, reviews: __reviews, cta: __cta, contact: __contact, footer: __footer };
  // Landmark structure: `nav` and `footer` are page furniture and must sit
  // OUTSIDE <main>; everything between them is the document's main content.
  // Without a <main> landmark, screen-reader users get no "skip to content" target.
  const parts = p.sections.map((s, i) => ({
    key: s,
    html: __injectRhythm(render[s] ? render[s](content, p) : '', p.rhythm ? p.rhythm[i] : '', p.transitions ? p.transitions[i] : '', p.emphasisTiers ? p.emphasisTiers[i] : ''),
  }));
  const lead = [], body = [], tail = [];
  let seenMain = false;
  for (const part of parts) {
    if (part.key === 'nav' && !seenMain) { lead.push(part.html); continue; }
    if (part.key === 'footer') { tail.push(part.html); continue; }
    seenMain = true; body.push(part.html);
  }
  const main = lead.join('\n') + '\n<main id="main" class="c-main">' + body.join('\n') + '</main>\n' + tail.join('\n');
  const motion = (p && p.motion) || d.motion;
  const html = `<!DOCTYPE html><html lang="en" data-dir="${d.id}" data-motion="${motion}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${__e(content.name)} — ${__e(d.name)}</title><meta name="description" content="${__e(content.meta)}"><style>${__css(d, p)}</style></head><body><div class="c-page" data-density="${p.density}">${main}</div><script>${__js(p)}</script></body></html>`;
  return { html, plan: p, content };
}

// ── DIRECTION DESIGN SYSTEM CSS ──────────────────────────────────────────────
function __css(d, p) {
  // A plan may override the direction's type/palette so patches change the render.
  const t = (p && p.type) || d.type; const pal = (p && p.palette) || d.palette;
  const radius = (p && p.radius != null) ? p.radius : d.radius;
  const shadow = (p && p.shadow != null) ? p.shadow : d.shadow;
  return `
:root{--bg:${pal.bg};--bg2:${pal.bg2};--surf:${pal.surface};--surf2:${pal.surface2};--text:${pal.text};--muted:${pal.muted};--faint:${pal.faint};--accent:${pal.accent};--accent2:${pal.accent2};--line:${pal.line};--rule:${pal.rule};--disp:${t.family};--body:${t.body};--rad:${radius}px;--shadow:${shadow};--measure:${t.measure}}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:var(--body);background:var(--bg);color:var(--text);line-height:1.7;-webkit-font-smoothing:antialiased;overflow-x:hidden}
img,svg{max-width:100%;display:block}a{color:inherit;text-decoration:none}button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
.c-wrap{max-width:1200px;margin-inline:auto;padding-inline:clamp(20px,4.5vw,56px)}
.c-kicker{display:inline-block;font-family:var(--body);font-size:${t.caption};letter-spacing:.26em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:16px}
.c-kicker-center{text-align:center}
.c-display{font-family:var(--disp);font-weight:700;line-height:1.02;letter-spacing:-.02em;font-size:${t.display};max-width:16ch}
.c-lead{font-family:var(--body);font-size:${t.hero};line-height:1.25;color:var(--muted);max-width:${t.measure};font-weight:400;letter-spacing:-.01em}
.c-body{font-size:${t.body};line-height:1.7;color:var(--muted);max-width:${t.measure}}
.c-sec-title{font-family:var(--disp);font-weight:700;line-height:1.08;letter-spacing:-.02em;font-size:${t.section}}
.c-sec-head{margin-bottom:clamp(28px,4vw,52px)}.c-sec-left .c-sec-title{max-width:22ch}
.c-btn{display:inline-flex;align-items:center;gap:10px;padding:14px 26px;font-family:var(--body);font-weight:700;font-size:${t.btn};letter-spacing:.12em;text-transform:uppercase;border-radius:var(--rad);transition:transform .3s,background .3s,color .3s,border-color .3s;white-space:nowrap}
.c-btn-primary{background:var(--accent);color:${d.family==='type-led'? '#fff' : (d.id==='swiss-structured'? '#fff':'#fff')};box-shadow:var(--shadow)}
.c-btn-primary:hover{transform:translateY(-2px)}
.c-btn-ghost{background:transparent;color:var(--text);border:1px solid var(--line);border-radius:var(--rad)}
.c-btn-ghost:hover{border-color:var(--accent);color:var(--accent)}
.c-btn-lg{padding:18px 34px}
.c-actions{display:flex;gap:14px;margin-top:30px;flex-wrap:wrap}
/* nav */
.c-nav{position:sticky;top:0;z-index:50;background:var(--bg);border-bottom:1px solid var(--line);backdrop-filter:blur(10px)}
.c-bar{display:flex;align-items:center;justify-content:space-between;height:76px;gap:20px}
.c-brand{font-family:var(--disp);font-weight:700;font-size:1.05rem;letter-spacing:-.01em}
.c-links{display:flex;gap:26px}.c-links a{font-size:.9rem;color:var(--muted);transition:color .2s}.c-links a:hover{color:var(--accent)}
/* hero */
.c-hero{position:relative}
.c-hero-inner{display:grid;gap:40px;align-items:center;padding-block:clamp(56px,9vw,120px)}
.c-hero-copy>*{max-width:${t.measure}}
/* editorial hero: asymmetric two-col */
.c-hero-editorial .c-hero-inner{grid-template-columns:1fr 1.4fr}
.c-hero-editorial .c-hero-copy{align-self:center}
.c-hero-meta{display:flex;align-items:center;gap:18px;align-self:end;padding-bottom:18px;color:var(--faint);font-size:${t.caption};text-transform:uppercase;letter-spacing:.2em}
.c-rule{width:56px;height:1px;background:var(--rule)}
.c-hero-bleed{margin-top:10px}
.c-hero-bleed svg{width:100%;height:clamp(120px,20vw,220px)}
/* fullbleed cinematic */
.c-hero-fullbleed{min-height:86vh;display:flex;align-items:center}
.c-hero-bg{position:absolute;inset:0;overflow:hidden}
.c-hero-bg svg{width:100%;height:100%;object-fit:cover}
.c-hero-veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35),var(--bg) 92%)}
.c-hero-fullbleed .c-hero-inner{position:relative;z-index:2}
.c-hero-fullbleed .c-display{color:#fff}
.c-hero-fullbleed .c-lead{color:rgba(255,255,255,.8)}
/* minimal luxury */
.c-hero-minimal .c-hero-inner{display:flex;flex-direction:column;align-items:center;text-align:center;padding-block:clamp(90px,14vw,180px)}
.c-hero-minimal .c-display{text-align:center}
.c-hero-minimal .c-lead{text-align:center}
/* overlap bold */
.c-hero-overlap .c-hero-inner{grid-template-columns:1.2fr .8fr;align-items:center}
.c-hero-badges{position:relative}
.c-hero-badges svg{width:100%}
.c-hero-badges svg:last-child{position:absolute;right:0;bottom:-32px;width:64%;border:6px solid var(--bg)}
/* split */
.c-hero-split .c-hero-inner{grid-template-columns:1fr 1fr;align-items:center}
.c-hero-split .c-hero-img svg{width:100%;border-radius:var(--rad)}
/* strip / marquee */
.c-strip{padding-block:26px;border-block:1px solid var(--line)}
.c-strip-row{display:flex;justify-content:space-between;align-items:center;color:var(--faint);font-size:${t.caption};letter-spacing:.2em;text-transform:uppercase}
.c-marquee{overflow:hidden;border-bottom:1px solid var(--line);padding-block:16px;background:var(--bg2)}
.c-marquee-track{display:flex;gap:44px;white-space:nowrap;animation:cmarquee 24s linear infinite;width:max-content}
.c-marquee-track span{font-family:var(--disp);font-weight:700;font-size:1.4rem;text-transform:uppercase;letter-spacing:.04em}
.c-marquee-track i{color:var(--accent);font-style:normal}
@keyframes cmarquee{to{transform:translateX(-50%)}}
/* metrics */
.c-metrics{padding-block:clamp(48px,7vw,90px);border-block:1px solid var(--line)}
.c-metrics-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:30px}
.c-metric b{font-family:var(--disp);font-size:${t.hero};font-weight:700;display:block;line-height:1}
.c-metric span{color:var(--muted);font-size:${t.caption};letter-spacing:.1em;text-transform:uppercase}
/* feature modes */
.c-feature{padding-block:clamp(64px,10vw,140px)}
.c-feature *{max-width:none}
.c-edlist,.c-altlist{display:flex;flex-direction:column}
.c-edrow{display:grid;grid-template-columns:1fr 1fr;gap:30px;padding-block:30px;border-top:1px solid var(--line)}
.c-edrow-h{display:flex;align-items:baseline;gap:18px}.c-edrow-h h3{font-family:var(--disp);font-size:${t.section};font-weight:700;letter-spacing:-.01em}
.c-edrow p{color:var(--muted);font-size:${t.body};max-width:44ch}
.c-num{font-family:var(--body);font-size:${t.caption};color:var(--accent);letter-spacing:.1em}
.c-altrow{display:grid;grid-template-columns:64px 1fr 240px;gap:32px;align-items:center;padding-block:28px;border-top:1px solid var(--line)}
.c-altrow-img svg{width:100%;border-radius:var(--rad)}
.c-bento{display:grid;grid-template-columns:repeat(2,1fr);gap:24px}
.c-bento-cell{position:relative;overflow:hidden;border-radius:var(--rad);background:var(--surf2);border:1px solid var(--line);padding:24px}
.c-bento-big{grid-row:span 2}
.c-bento-img svg{width:100%;border-radius:var(--rad);margin-bottom:16px}
.c-split{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center}
.c-split-img svg{width:100%;border-radius:var(--rad)}
.c-split-item{display:flex;gap:16px;padding-block:18px;border-top:1px solid var(--line)}
.c-split-item h3{font-family:var(--disp);font-size:1.15rem;margin-bottom:4px;font-weight:600}
.c-split-item p{color:var(--muted);font-size:${t.body}}
.c-dot{width:10px;height:10px;background:var(--accent);border-radius:50%;margin-top:6px;flex:none}
/* card grid */
.c-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}
.c-grid-3{grid-template-columns:repeat(3,1fr)}
.c-card{padding:28px;background:var(--surf);border:1px solid var(--line);border-radius:var(--rad)}
/* ruled grid — hairline modular cells, no elevated surface (Swiss) */
.c-ruled{display:grid;grid-template-columns:repeat(2,1fr);gap:0;border-top:1px solid var(--rule)}
.c-ruled-3{grid-template-columns:repeat(3,1fr)}
.c-ruled-cell{padding:32px 28px 36px 0;border-bottom:1px solid var(--line);border-right:1px solid var(--line)}
.c-ruled-cell:nth-child(2n){padding-right:0}
.c-ruled-3 .c-ruled-cell:nth-child(3n){border-right:0}
.c-ruled-idx{display:block;font-size:var(--fs-caption);letter-spacing:.14em;color:var(--accent);margin-bottom:14px;font-variant-numeric:tabular-nums}
.c-ruled-cell h3{margin:0 0 10px;font-size:calc(var(--fs-section)*.62);line-height:1.15}
.c-ruled-cell p{margin:0;color:var(--muted);max-width:38ch}
.c-card-k{display:block;font-size:1.2rem;margin-bottom:12px;color:var(--accent)}
.c-card h3{font-family:var(--disp);font-size:1.25rem;margin-bottom:8px;letter-spacing:-.01em}
.c-card p{color:var(--muted);font-size:${t.body}}
/* story */
.c-story{padding-block:clamp(72px,11vw,160px);background:var(--bg2)}
.c-story-inner{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center}
.c-story-img svg{width:100%;border-radius:var(--rad)}
/* work */
.c-work{padding-block:clamp(64px,10vw,140px)}
.c-work-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:28px}
.c-work-item figure svg{width:100%;border-radius:var(--rad);aspect-ratio:4/3;object-fit:cover}
.c-work-meta{margin-top:14px}.c-work-cat{color:var(--accent);font-size:${t.caption};letter-spacing:.14em;text-transform:uppercase}
.c-work-meta h3{font-family:var(--disp);font-size:1.3rem;margin-top:6px;letter-spacing:-.01em}
.c-work-meta p{color:var(--muted);font-size:${t.body}}
/* reviews */
.c-reviews{padding-block:clamp(56px,9vw,120px);background:var(--bg2)}
.c-reviews-single .c-quote-large{max-width:760px;margin-inline:auto;text-align:center}
.c-mark{font-family:var(--disp);font-size:6rem;color:var(--accent);line-height:.4;display:block}
.c-quote-large p{font-family:var(--disp);font-size:${t.hero};line-height:1.3;margin-block:6px}
.c-quote-by{display:flex;flex-direction:column;gap:4px;margin-top:26px;color:var(--muted)}
.c-stars{color:var(--accent);letter-spacing:.1em;font-size:.9rem}
.c-quote-row{display:grid;grid-template-columns:1fr 1fr;gap:40px}
.c-quote blockquote{font-family:var(--disp);font-size:${t.section};line-height:1.3;margin-bottom:20px}
.c-quote figcaption{display:flex;flex-direction:column;color:var(--muted)}
.c-reviewGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:24px}
.c-review{padding:30px;background:var(--surf);border:1px solid var(--line);border-radius:var(--rad)}
.c-review blockquote{font-size:${t.body};margin-block:14px}
.c-review-by{display:flex;flex-direction:column;color:var(--muted)}
/* cta */
.c-cta{padding-block:clamp(80px,13vw,180px);text-align:center}
.c-cta-inner{display:flex;flex-direction:column;align-items:center;gap:10px}
.c-cta-title{font-family:var(--disp);font-size:${t.display};font-weight:700;letter-spacing:-.02em;line-height:1.05;max-width:18ch}
/* contact */
.c-contact{padding-block:clamp(64px,10vw,140px);background:var(--bg2)}
.c-contact-inner{max-width:720px}
.c-contact-row{display:flex;gap:14px;flex-wrap:wrap;margin-top:26px}
@media (max-width:600px){.c-contact-row{flex-direction:column}}
/* footer */
.c-footer{padding-block:44px;border-top:1px solid var(--line);background:var(--bg2)}
.c-footer-row{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}
.c-footer-brand{font-family:var(--disp);font-weight:700}.c-footer-brand span{color:var(--muted);font-weight:400}
.c-footer-links{display:flex;gap:26px;align-items:center;color:var(--muted);font-size:.9rem;flex-wrap:wrap}
/* motion levels */
[data-motion="quiet"] [data-r]{opacity:0;transform:translateY(14px);transition:opacity .7s,transform .7s}
[data-motion="quiet"] [data-r].on{opacity:1;transform:none}
[data-motion="cinematic"] [data-r]{opacity:0;transform:translateY(30px) scale(.99);transition:opacity 1s cubic-bezier(.22,1,.36,1),transform 1s cubic-bezier(.22,1,.36,1)}
[data-motion="cinematic"] [data-r].on{opacity:1;transform:none}
[data-motion="slow"] [data-r]{opacity:0;transform:translateY(18px);transition:opacity 1.1s,transform 1.1s}
[data-motion="slow"] [data-r].on{opacity:1;transform:none}
[data-motion="energetic"] [data-r]{opacity:0;transform:translateY(26px) rotate(-.5deg);transition:opacity .5s,transform .5s cubic-bezier(.2,.8,.2,1.2)}
[data-motion="energetic"] [data-r].on{opacity:1;transform:none}
[data-motion="functional"] [data-r]{opacity:0;transform:translateY(10px);transition:opacity .4s,transform .4s}
[data-motion="functional"] [data-r].on{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){[data-r]{opacity:1!important;transform:none!important}.c-marquee-track{animation:none}}
/* ── SECTION RHYTHM SYSTEM: explicit per-section spacing beat (real, in DOM) ── */
[data-rhythm="dramatic"]{padding-block:clamp(104px,16vw,220px)}
[data-rhythm="spacious"]{padding-block:clamp(80px,12vw,160px)}
[data-rhythm="normal"]{padding-block:clamp(56px,9vw,120px)}
[data-rhythm="compact"]{padding-block:clamp(36px,6vw,76px)}
/* ── SECTION TRANSITIONS: connect sections so the page reads as one composition ── */
[data-transition="bridge"]{border-top:1px solid var(--line);position:relative}
[data-transition="bridge"]::before{content:"";position:absolute;left:calc(max(20px,4.5vw) + 0px);right:calc(max(20px,4.5vw) + 0px);top:0;height:6px;background:var(--line);opacity:.5;transform:translateX(0)}
[data-transition="fade"]{position:relative;background-image:linear-gradient(to bottom,transparent,rgba(0,0,0,.02) 30%,var(--bg) 100%)}
[data-transition="bleed"]{border-top:1px solid var(--line)}
[data-transition="overlap"]{position:relative;z-index:2;margin-top:calc(clamp(-40px,-5vw,-16px));border-radius:var(--rad) var(--rad) 0 0;background:var(--bg);box-shadow:0 -20px 60px -30px rgba(0,0,0,.4)}
[data-transition="flat"]{}
/* ── VISUAL EMPHASIS BUDGET: only the hero(+CTA) are focal; the rest are supporting ── */
[data-emphasis]{--emph:1}
[data-emphasis="max"]{--emph:1}
[data-emphasis="high"]{--emph:.84}
[data-emphasis="med"]{--emph:.72}
[data-emphasis="low"]{--emph:.58}
.c-sec-title{font-size:calc(${t.section} * var(--emph,1))}
[data-emphasis="low"] .c-card,[data-emphasis="low"] .c-review{background:var(--bg);border-color:var(--line);box-shadow:none}
/* responsiveness: RE-COMPOSE, not squeeze */
@media (max-width:900px){
  .c-hero-editorial .c-hero-inner,.c-hero-split .c-hero-inner,.c-hero-overlap .c-hero-inner,.c-story-inner,.c-split{grid-template-columns:1fr}
  .c-grid,.c-grid-3,.c-bento,.c-work-grid,.c-reviewGrid,.c-metrics-grid{grid-template-columns:1fr}
  .c-ruled,.c-ruled-3{grid-template-columns:1fr}
  .c-ruled-cell{border-right:0;padding-right:0}
  .c-bento-big{grid-row:auto}
  .c-edrow{grid-template-columns:1fr;gap:10px}
  .c-altrow{grid-template-columns:1fr;gap:14px}.c-altrow-img{order:-1}
  .c-quote-row{grid-template-columns:1fr}
  .c-links{display:none}
}
`;
}

// ── RUNTIME: reveal-on-scroll, count-up, all gated by motion level ───────────
function __js(p) {
  const countMs = p.motion === 'cinematic' ? 30 : (p.motion === 'slow' ? 24 : 16);
  return `(function(){
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var els=[].slice.call(document.querySelectorAll('[data-r]'));
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('on');io.unobserve(e.target);}});},{threshold:.12});
  els.forEach(function(e){io.observe(e);if(reduce)e.classList.add('on');});
  [].slice.call(document.querySelectorAll('[data-count]')).forEach(function(el){
    var n=parseFloat((el.getAttribute('data-count')||'0').replace(/,/g,''))||0;var cur=0;var step=Math.max(1,Math.ceil(n/30));
    var t=setInterval(function(){cur+=step;if(cur>=n){cur=n;clearInterval(t);}el.textContent=(cur>=1000?cur.toLocaleString():cur);},${countMs});
  });
})();`;
}

// ── VISUAL QUALITY LOOP primitives (§20) ──────────────────────────────────────
// A deliberately DEGRADED candidate (same direction, corrupted composition) — so
// the loop has a real weakness to find, and the fix is measured on rendered DOM.
function nxComposeDegrade(content, directionId) {
  const d = NX_COMPOSE_DIRECTIONS[directionId] || NX_COMPOSE_DIRECTIONS['editorial-minimal'];
  content = nxComposeContent(content);          // normalize so renderers get c.ctas etc.
  const base = nxComposePlan(content, directionId);
  const flatType = (() => { const o = Object.assign({}, base.type); const big = o.display; ['display', 'hero', 'section', 'body', 'caption', 'btn'].forEach((k) => { o[k] = big; }); return o; })();
  const lowPal = Object.assign({}, base.palette);
  // collapse contrast: accent ≈ muted so nothing stands out
  lowPal.accent = lowPal.muted; lowPal.accent2 = lowPal.muted; lowPal.rule = lowPal.line;
  const plan = Object.assign({}, base, {
    type: flatType, palette: lowPal,
    featureMode: base.featureMode === 'grid' ? 'grid' : 'grid',   // force a uniform card grid
    reviewMode: base.reviewMode === 'grid' ? 'grid' : 'grid',
    rhythm: base.sections.map(() => 'normal'),                    // identical spacing everywhere
    transitions: base.sections.map(() => 'flat'),
    emphasisTiers: base.sections.map(() => 'max'),               // every section equally loud
    degraded: true,
  });
  return { plan, html: nxRenderDirected(content, directionId, plan).html };
}
// Patch ops (deterministic) restore the direction's real composition choices.
function nxComposePatchPlan(plan, ops, directionId) {
  const d = NX_COMPOSE_DIRECTIONS[directionId] || NX_COMPOSE_DIRECTIONS['editorial-minimal'];
  const next = Object.assign({}, plan, { degraded: false });
  const applied = [];
  if (ops.includes('typo')) { next.type = d.type; applied.push('typography hierarchy restored'); }
  if (ops.includes('feature')) { next.featureMode = d.featureMode; next.reviewMode = d.reviewMode; applied.push('component variants restored (non-card alternatives)'); }
  if (ops.includes('rhythm')) { next.rhythm = next.sections.map((_, i) => (d.rhythm && d.rhythm.length ? d.rhythm[i % d.rhythm.length] : 'normal')); next.transitions = next.sections.map((_, i) => { const mot = NX_COMPOSE_TRANSITIONS[d.id] || ['fade']; return i === 0 ? 'flat' : mot[(i - 1) % mot.length]; }); applied.push('section rhythm diversified'); }
  if (ops.includes('emphasis')) { next.emphasisTiers = next.sections.map((s) => { const w = (d.emphasis && d.emphasis[s] != null) ? d.emphasis[s] : __EMPH_W[s]; return __EMPH_TIER(w == null ? 50 : w); }); applied.push('emphasis budget set (one focal)'); }
  if (ops.includes('contrast')) { next.palette = d.palette; applied.push('contrast restored'); }
  if (ops.includes('motion')) { next.motion = d.motion; applied.push('direction motion restored'); }
  return { plan: next, applied, explanation: applied.join('; ') || 'no change' };
}
// Diagnose a degraded render from a measure() result (structure, not a score).
function nxComposeDiagnose(meas) {
  const probs = [];
  if (!meas) return probs;
  if (meas.monotony != null && meas.monotony > 45) { probs.push({ id: 'monotony', ops: ['feature', 'rhythm', 'emphasis'], ev: 'monotony=' + meas.monotony }); }
  if (meas.cardDependency != null && meas.cardDependency > 0.5) { probs.push({ id: 'cards', ops: ['feature'], ev: 'cardDependency=' + meas.cardDependency }); }
  if (meas.typeUniformity != null && meas.typeUniformity > 0.95) { probs.push({ id: 'type', ops: ['typo'], ev: 'typeUniformity=' + meas.typeUniformity }); }
  if (meas.emphasisAllMax) { probs.push({ id: 'emphasis', ops: ['emphasis'], ev: 'all sections at max emphasis' }); }
  return probs;
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────
const nxCompose = (content, opts) => {
  const direction = opts && opts.direction;
  let plan, html;
  const c = nxComposeContent(content);
  const dir = NX_COMPOSE_DIRECTIONS[direction] ? direction : 'editorial-minimal';
  plan = nxComposePlan(c, dir);
  html = nxRenderDirected(c, dir, plan).html;
  return { html, plan, explanation: nxDesignExplanation(content || {}, c, dir), content: c };
};

const nx_compose_api = {
  NX_COMPOSE_DIRECTIONS, NX_COMPOSE_ORDER, NX_COMPOSE_TRANSITIONS,
  nxComposeContent, nxComposePlan, nxDesignExplanation, nxRenderDirected, nxCompose,
  nxComposeDegrade, nxComposePatchPlan, nxComposeDiagnose,
};

// Dual export: CommonJS (backend require + ESM default-interop) + browser global.
if (typeof module !== 'undefined' && module.exports) module.exports = nx_compose_api;
if (typeof globalThis !== 'undefined') globalThis.NX_COMPOSE_LIB = nx_compose_api;
if (typeof window !== 'undefined') window.NX_COMPOSE_LIB = nx_compose_api;
