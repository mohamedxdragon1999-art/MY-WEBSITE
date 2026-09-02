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
    palette: { bg: '#F4F1EB', bg2: '#EAE6DC', surface: '#FBFAF6', surface2: '#EFECE2', text: '#1A1714', muted: '#6B655A', faint: '#7D7669', accent: '#B5402A', accent2: '#6A4A34', line: 'rgba(26,23,20,.12)', rule: '#1A1714' },
    type: { family: "'Playfair Display', Georgia, serif", bodyFamily: "'Söhne', 'Inter', system-ui, sans-serif", body: "'Helvetica Neue', Arial, sans-serif", display: 'clamp(3.2rem,8.5vw,6.6rem)', hero: 'clamp(2.6rem,6vw,4.6rem)', section: 'clamp(1.7rem,3.4vw,2.6rem)', body: 'clamp(1.02rem,1.35vw,1.14rem)', caption: '0.78rem', btn: '0.74rem', measure: '62ch' },
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
    type: { family: "'Space Grotesk', 'Inter', sans-serif", bodyFamily: "'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif", display: 'clamp(3.4rem,10vw,8rem)', hero: 'clamp(2.4rem,6vw,4.8rem)', section: 'clamp(1.9rem,4vw,3.1rem)', body: 'clamp(1.05rem,1.4vw,1.2rem)', caption: '0.8rem', btn: '0.75rem', measure: '58ch' },
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
    type: { family: "'Playfair Display', 'Didot', Georgia, serif", bodyFamily: "'Söhne', 'Inter', system-ui, sans-serif", body: "'Helvetica Neue', Arial, sans-serif", display: 'clamp(3rem,7.5vw,5.8rem)', hero: 'clamp(2.3rem,5.4vw,4.2rem)', section: 'clamp(1.6rem,3vw,2.3rem)', body: 'clamp(1.02rem,1.3vw,1.12rem)', caption: '0.72rem', btn: '0.72rem', measure: '56ch' },
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
    type: { family: "'Archivo Black', 'Space Grotesk', sans-serif", bodyFamily: "'Space Grotesk', 'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif", display: 'clamp(4rem,13vw,10rem)', hero: 'clamp(3rem,9vw,7rem)', section: 'clamp(2.2rem,5.5vw,4rem)', body: 'clamp(1.05rem,1.4vw,1.2rem)', caption: '0.78rem', btn: '0.78rem', measure: '54ch' },
    radius: 0, shadow: '6px 6px 0 var(--accent)', surfaceFx: 'flat',
    heroVariant: 'overlap', featureMode: 'alternating', reviewMode: 'grid',
    sectionOrder: ['nav', 'hero', 'marquee', 'feature', 'metrics', 'work', 'reviews', 'cta', 'contact', 'footer'],
    rhythm: ['dramatic', 'compact', 'dramatic', 'normal', 'compact', 'dramatic', 'compact'],
    density: 'dense', motion: 'energetic', emphasis: { hero: 100, cta: 85, feature: 60, work: 65, contact: 60 },
    desc: 'Unexpected composition, strong contrast, large/small scale variation, overlap, experimental grid, expressive motion.',
  },
  // ── SIGNAL INDUSTRIAL ──────────────────────────────────────────────────
  // Distilled from the reference site design the owner supplied as the house
  // default: a deep near-black field, a single hot-orange accent used sparingly
  // as a signal (never as decoration), Space Grotesk display against Inter body,
  // a mono eyebrow in wide tracking, and generous 72–132px section breathing.
  //
  // This is a TOKEN SET, not a copy of that page. The 274KB literal template is
  // one client's finished site; this reproduces its design language so any brief
  // renders in that style with its own content, structure and composition.
  'signal-industrial': {
    id: 'signal-industrial',
    name: 'Signal Industrial',
    family: 'engineered',
    palette: {
      bg: '#060912', bg2: '#080C16', surface: '#0D1322', surface2: '#121A2C',
      text: '#EEF2F8', muted: '#97A3BA', faint: '#6B7791',
      accent: '#FF5F00', accent2: '#FFB23E',
      line: 'rgba(255,255,255,.10)', rule: 'rgba(255,255,255,.13)',
    },
    type: {
      family: "'Space Grotesk','Inter',system-ui,sans-serif",
      // Grotesk display against a neutral body is the core pairing of this
      // direction; the mono is reserved for eyebrows and technical labels.
      bodyFamily: "'Inter',system-ui,-apple-system,sans-serif",
      mono: "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace",
      body: 'clamp(1rem,1.2vw,1.125rem)',
      display: 'clamp(2.5rem,6.6vw,4.75rem)',
      hero: 'clamp(2rem,4.2vw,3rem)',
      section: 'clamp(1.625rem,3.1vw,2.4rem)',
      caption: '0.76rem',
      btn: '0.8rem',
      measure: '68ch',
    },
    radius: 14,
    shadow: '0 30px 80px -30px rgba(0,0,0,.9)',
    surfaceFx: 'panel',
    heroVariant: 'aurora',
    featureMode: 'spec',
    reviewMode: 'grid',
    // Proof-forward order: credibility (metrics) lands immediately after the
    // hero, matching how the reference design argues for a trade business.
    sectionOrder: ['nav', 'hero', 'marquee', 'metrics', 'feature', 'story', 'work', 'reviews', 'faq', 'cta', 'contact', 'footer'],
    rhythm: ['compact', 'dramatic', 'compact', 'normal', 'spacious', 'normal', 'normal', 'compact', 'normal', 'spacious', 'normal'],
    density: 'balanced',
    motion: 'engineered',
    emphasis: { hero: 100, metrics: 60, feature: 70, cta: 80, work: 55, contact: 65 },
    desc: 'Deep engineered dark field with a single hot-signal accent, technical mono eyebrows, grotesk display against a neutral body, panelled surfaces and generous structural breathing.',
  },
  'swiss-structured': {
    id: 'swiss-structured', name: 'Modern Swiss', family: 'systematic',
    palette: { bg: '#FAFAF8', bg2: '#F2F2EE', surface: '#FFFFFF', surface2: '#EBEBE5', text: '#111210', muted: '#5A5C55', faint: '#8A8C83', accent: '#1B4DE4', accent2: '#0A0A0A', line: 'rgba(17,18,16,.14)', rule: '#111210' },
    type: { family: "'Söhne', 'Neue Haas Grotesk Display', 'Helvetica Neue', Helvetica, sans-serif", bodyFamily: "'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif", display: 'clamp(3rem,8vw,5.6rem)', hero: 'clamp(2.2rem,4.8vw,3.6rem)', section: 'clamp(1.5rem,2.8vw,2.1rem)', body: 'clamp(1rem,1.25vw,1.08rem)', caption: '0.75rem', btn: '0.74rem', measure: '72ch' },
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
    return { title: __str(s && s.title).slice(0, 40), text: __str(s && (s.desc || s.text)).slice(0, 140), icon: __str(s && s.icon).slice(0, 12), image: __safeImg(s && s.image) };
  }).filter(s => s.title || s.text);
  const why = __arr(plan.why_us || plan.why).map(w => (typeof w === 'string' ? w : __str(w && (w.check || w.title)))).filter(Boolean).slice(0, 5);
  const stats = __arr(plan.stats).slice(0, 4).map(s => ({ value: (s && s.value != null && __str(s.value) !== '') ? s.value : '0', label: __str(s && (s.label || s.name)).slice(0, 30) })).filter(s => s.label);
  const projects = __arr(plan.projects).slice(0, 6).map(p => ({ title: __str(p && p.title).slice(0, 60), cat: __str(p && (p.cat || p.cls)).slice(0, 30), image: __safeImg(p && p.image), text: __str(p && p.text).slice(0, 110) })).filter(p => p.title);
  const reviews = __arr(plan.reviews || plan.testimonials).slice(0, 4).map(r => ({ quote: __str(r && (r.text || r.quote)).slice(0, 220), author: __str(r && (r.name || r.author)).slice(0, 40), role: __str(r && (r.role || r.via)).slice(0, 30), stars: Math.max(1, Math.min(5, Number(r && r.stars) || 5)) })).filter(r => r.quote);
  const faqs = __arr(plan.faqs || plan.faq).slice(0, 6).map(f => ({ q: __str(f && f.q).slice(0, 100), a: __str(f && f.a).slice(0, 200) })).filter(f => f.q);
  const contact = (plan.contact && typeof plan.contact === 'object') ? plan.contact : {};
  const phone = __str(contact.phone || plan.phone).slice(0, 30);
  const email = __str(contact.email || plan.email).slice(0, 60);
  return { name, owner, headline, sub, ctas, services, why, stats, projects, reviews, faqs, contact, phone, email, meta: __metaDescription(plan, name, headline, sub, services) };
}

// ── Composition Plan: direction → section order/variants/typography/rhythm/density ──
// Classify what the content IS, so component selection can respond to it.
// Deterministic and evidence-based: it reads the actual content, never a label.
function nxContentShape(c) {
  c = c || {};
  const n = (a) => (Array.isArray(a) ? a.length : 0);
  const projects = n(c.projects), services = n(c.services), reviews = n(c.reviews), stats = n(c.stats);
  const copy = String(c.sub || '').length + String(c.headline || '').length;
  const total = projects + services + reviews + stats;
  let archetype = 'balanced';
  if (projects >= 2 && projects >= services) archetype = 'image-led';
  else if (services >= 3 && projects === 0) archetype = 'service-led';
  else if (total <= 2 && copy < 160) archetype = 'statement-led';
  else if (reviews >= 2 && reviews >= services) archetype = 'proof-led';
  return { archetype, projects, services, reviews, stats, contentVolume: total };
}

// A meta description drives the search-result snippet AND the social preview
// card. It was simply `plan.description`, so any brief without that field
// shipped <meta name="description" content=""> — an empty snippet on every
// generated page. Derive a real sentence from the content we DO have, and
// never fabricate claims: this only restates the business's own words.
function __metaDescription(plan, name, headline, sub, services) {
  const clean = (x) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
  const direct = clean(plan && (plan.description || plan.meta));
  if (direct) return direct.slice(0, 160);
  const parts = [];
  const h = clean(headline), sb = clean(sub);
  if (h) parts.push(h.replace(/[.\s]+$/, ''));
  if (sb && sb !== h) parts.push(sb.replace(/[.\s]+$/, ''));
  const svc = (Array.isArray(services) ? services : []).map(x => clean(x && x.title)).filter(Boolean).slice(0, 3);
  if (svc.length) parts.push(svc.join(', '));
  const out = parts.join('. ');
  const fallback = clean(name) ? clean(name) + ' — official website.' : '';
  return (out ? (out.endsWith('.') ? out : out + '.') : fallback).slice(0, 160);
}

// Script direction is a property of the CONTENT, not a setting the caller must
// remember to pass. Arabic, Hebrew, Persian, Urdu and Thaana text rendered
// left-to-right is not a cosmetic issue — the page is unreadable. Detect it
// from the copy itself so an Arabic brief simply works.
const __RTL_RANGE = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0780-\u07BF\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
// A caller-supplied image URL must survive normalisation (it was being dropped
// entirely, so every brief silently fell back to generated placeholder art) —
// but it must not become an injection vector. Allow only http(s), protocol-
// relative and site-relative paths; reject javascript:, data:, vbscript: etc.
function __safeImg(u) {
  const v = String(u == null ? '' : u).trim();
  if (!v || v.length > 2000) return '';
  if (/^(https?:)?\/\//i.test(v)) return v;   // absolute or protocol-relative
  if (/^\/[^\/]/.test(v)) return v;            // site-relative
  return '';                                   // anything else (js:, data:, …)
}

function nxDetectDirection(content) {
  // Weight AUTHORED fields only. The composer injects English defaults for any
  // slot the brief left empty (a generic sub-headline, CTA labels), and mixing
  // those into the sample diluted a fully-Arabic brief to 35% RTL — under the
  // threshold — so the page rendered left-to-right. Name and headline are the
  // fields a user always writes themselves, so they decide.
  const authored = [content && content.name, content && content.headline].filter(Boolean).join(' ');
  const secondary = [...(((content && content.services) || []).slice(0, 4).map(x => (x && x.title) || ''))]
    .filter(Boolean).join(' ');
  const sample = (authored + ' ' + secondary).trim();
  if (!sample) return 'ltr';
  const rtl = (sample.match(new RegExp(__RTL_RANGE.source, 'g')) || []).length;
  const letters = (sample.match(/[\p{L}]/gu) || []).length;
  // Majority test: a single foreign word in an English page must not flip it.
  return (letters && rtl / letters > 0.4) ? 'rtl' : 'ltr';
}

// Best-effort BCP-47 tag from the script actually used. Declaring Hebrew text
// as lang="ar" misleads screen readers, which pick a voice from this attribute.
function nxDetectLang(content) {
  const sample = [content && content.name, content && content.headline].filter(Boolean).join(' ');
  if (/[\u0590-\u05FF\uFB1D-\uFB4F]/.test(sample)) return 'he';
  if (/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(sample)) return 'ar';
  if (/[\u0700-\u074F]/.test(sample)) return 'syr';
  if (/[\u0780-\u07BF]/.test(sample)) return 'dv';
  if (/[\u3040-\u30FF]/.test(sample)) return 'ja';
  if (/[\uAC00-\uD7AF]/.test(sample)) return 'ko';
  if (/[\u4E00-\u9FFF]/.test(sample)) return 'zh';
  return 'en';
}

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
  // ── CONTENT-AWARE COMPONENT SELECTION (§5) ────────────────────────────────
  // The direction sets the visual LANGUAGE; the content decides which member of
  // each family speaks it. Without this, a photography portfolio and a law firm
  // with the same field counts render an identical layout — component choice must
  // answer "what does this content actually need?", not just "what is missing?".
  const shape = nxContentShape(content);
  let heroVariant = d.heroVariant, featureMode = d.featureMode, reviewMode = d.reviewMode;
  if (shape.archetype === 'image-led') {
    // A body of work is the argument: lead with the visual, let work run early.
    if (heroVariant === 'minimal' || heroVariant === 'split') heroVariant = d.family === 'systematic' ? 'split' : 'fullbleed';
    if (featureMode === 'grid' || featureMode === 'ruled') featureMode = 'split';
    const wi = sections.indexOf('work');
    if (wi > 2) { sections.splice(wi, 1); sections.splice(Math.min(2, sections.length), 0, 'work'); }
  } else if (shape.archetype === 'service-led') {
    // Many distinct services need a scannable enumeration, not a hero visual.
    if (featureMode === 'split') featureMode = d.family === 'systematic' ? 'ruled' : 'edlist';
  } else if (shape.archetype === 'statement-led') {
    // Very little content: do not pad it out — make the statement the whole page.
    if (heroVariant === 'split' || heroVariant === 'fullbleed') heroVariant = 'minimal';
    if (featureMode === 'bento' || featureMode === 'grid') featureMode = 'split';
  }
  // A single testimonial should never be rendered as a "grid" of one.
  if (reviewMode === 'grid' && (content.reviews || []).length < 2) reviewMode = 'single';
  const rhythm = sections.map((_, i) => motif[i % motif.length]);
  return {
    direction: d.id, name: d.name, family: d.family, palette: d.palette, type: d.type,
    radius: d.radius, shadow: d.shadow, surfaceFx: d.surfaceFx,
    heroVariant, featureMode, reviewMode, contentShape: shape,
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

// ── IMAGE COMPONENT ───────────────────────────────────────────────────────
// __art() returns a bare data: URI. Every call site interpolated that string
// straight into markup, so the URI rendered as VISIBLE TEXT instead of an
// image — on every generated page. This wraps it properly and, critically,
// uses a caller-supplied image when the brief provides one (those URLs were
// being silently discarded).
//
// Emits width/height (prevents layout shift / CLS), loading + decoding hints,
// and real alt text. Decorative art gets alt="" + aria-hidden so screen
// readers skip it rather than announcing a meaningless placeholder.
function __img(opts) {
  const o = opts || {};
  const w = o.w || 800, h = o.h || 600;
  const src = (typeof o.src === 'string' && o.src.trim()) ? o.src.trim() : __art(o.seed || 0, w, h, o.dir);
  const decorative = !o.alt;
  const altAttr = decorative ? 'alt="" aria-hidden="true"' : `alt="${__e(o.alt)}"`;
  const cls = o.cls ? ` class="${__e(o.cls)}"` : '';
  const eager = !!o.eager;   // above-the-fold art must not be lazily fetched
  return `<img${cls} src="${__e(src)}" ${altAttr} width="${w}" height="${h}"`
    + ` loading="${eager ? 'eager' : 'lazy'}" decoding="${eager ? 'sync' : 'async'}"`
    + `${eager ? ' fetchpriority="high"' : ''} style="max-width:100%;height:auto;display:block">`;
}
// Escape for HTML text AND attribute contexts. The single quote is included
// deliberately: nx_render.js already had a separate __escAttr covering it while
// this pipeline did not, so the two generators in the same builder carried
// different safety guarantees for the same job. Today every attribute emitted
// here is double-quoted so the gap is not exploitable — but the next person to
// copy a snippet between these files would silently inherit the weaker escape.
// One function, one guarantee, both contexts safe.
function __e(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

// ── SECTION RENDERERS (structural variants per direction) ────────────────────
function __nav(c, p) {
  const links = p.sections.filter(s => ['feature', 'story', 'work', 'reviews', 'contact', 'metrics'].includes(s)).slice(0, 5);
  const mk = (label, id) => `<a href="#${id}">${__e(label)}</a>`;
  const map = { feature: 'Work', story: 'Story', work: 'Projects', reviews: 'Clients', contact: 'Contact', metrics: 'Numbers' };
  return `<header class="c-nav" id="top" data-r><div class="c-wrap c-bar"><div class="c-brand">${__e(c.name)}</div><nav class="c-links">${links.map(x => mk(map[x] || x, x)).join('')}</nav><a class="c-btn c-btn-ghost" href="#contact">${__e(c.ctas.primary)}</a></div></header>`;
}

function __hero(c, p) {
  const v = p.heroVariant;
  const eyebrow = `<span class="c-kicker">${__e(c.name)} — 2026</span>`;
  const title = `<h1 class="c-display">${__e(c.headline)}</h1>`;
  const body = `<p class="c-lead">${__e(c.sub)}</p>`;
  // The secondary CTA hardcoded #work, but the work section is PRUNED when the
  // brief has no projects — so on any project-less site this was a dead link
  // that silently did nothing when clicked. Resolve it against the sections
  // that were actually composed, and drop the CTA if none of them fit.
  const __present = (id) => Array.isArray(p.sections) && p.sections.includes(id);
  const __secondaryTarget = ['work', 'feature', 'story', 'reviews'].find(__present) || '';
  const secondaryCta = __secondaryTarget
    ? `<a class="c-btn c-btn-ghost" href="#${__secondaryTarget}">${__e(c.ctas.secondary)}</a>` : '';
  const actions = `<div class="c-actions"><a class="c-btn c-btn-primary" href="#contact">${__e(c.ctas.primary)}</a>${secondaryCta}</div>`;
  if (v === 'editorial') {
    return `<section class="c-hero c-hero-editorial" id="home" data-r><div class="c-wrap c-hero-inner"><div class="c-hero-copy">${eyebrow}${title}${body}${actions}</div><div class="c-hero-meta"><span>Est. ${__e(c.owner)}</span><span class="c-rule"></span><span>High craft, considered</span></div></div><div class="c-hero-bleed">${__img({ seed: 3, w: 1200, h: 420, dir: p.direction, src: c.image, eager: true })}</div></section>`;
  }
  if (v === 'fullbleed') {
    return `<section class="c-hero c-hero-fullbleed" id="home" data-r><div class="c-hero-bg">${__img({ seed: 5, w: 1600, h: 1000, dir: p.direction, src: c.image, eager: true })}<div class="c-hero-veil"></div></div><div class="c-wrap c-hero-inner"><div class="c-hero-copy">${eyebrow}${title}${body}${actions}</div></div></section>`;
  }
  if (v === 'minimal') {
    return `<section class="c-hero c-hero-minimal" id="home" data-r><div class="c-wrap c-hero-inner">${eyebrow}${title}${body}<div class="c-hero-actions">${actions}</div></div></section>`;
  }
  if (v === 'aurora') {
    // Signature hero of the engineered family: three offset radial glow fields
    // drifting behind a hard technical grid, copy on the left, and a spec-row
    // that states real, verifiable facts instead of invented credibility stats.
    const specs = [];
    if (Array.isArray(c.stats)) for (const st of c.stats.slice(0, 3)) {
      if (st && (st.value != null) && st.label) specs.push({ v: String(st.value), l: String(st.label) });
    }
    const specRow = specs.length
      ? `<dl class="c-hero-specs">${specs.map(x => `<div><dt>${__e(x.l)}</dt><dd>${__e(x.v)}</dd></div>`).join('')}</dl>`
      : '';
    return `<section class="c-hero c-hero-aurora" id="home" data-r>`
      + `<div class="c-aurora" aria-hidden="true"><i class="c-a1"></i><i class="c-a2"></i><i class="c-a3"></i></div>`
      + `<div class="c-hero-grid-lines" aria-hidden="true"></div>`
      + `<div class="c-wrap c-hero-inner">`
      + `<div class="c-hero-copy">${eyebrow}${title}${body}${actions}${specRow}</div>`
      + `</div></section>`;
  }
  if (v === 'overlap') {
    return `<section class="c-hero c-hero-overlap" id="home" data-r><div class="c-wrap c-hero-inner"><div class="c-hero-copy">${eyebrow}${title}${body}${actions}</div><div class="c-hero-badges">${__img({ seed: 2, w: 520, h: 340, dir: p.direction, src: c.image })}${__img({ seed: 7, w: 380, h: 240, dir: p.direction, src: c.image })}</div></div></section>`;
  }
  // split
  return `<section class="c-hero c-hero-split" id="home" data-r><div class="c-wrap c-hero-inner"><div class="c-hero-copy">${eyebrow}${title}${body}${actions}</div><div class="c-hero-img">${__img({ seed: 4, w: 720, h: 720, dir: p.direction, src: c.image })}</div></div></section>`;
}

function __logoStrip(c, p) {
  // Decorative logo strip: addressable id + hidden from assistive tech, matching
  // how the marquee is treated. Placeholder letters carry no meaning to announce.
  return `<section class="c-strip" id="logos" data-r aria-hidden="true"><div class="c-wrap c-strip-row">${['A', 'B', 'C', 'D', 'E'].map(x => `<span>${x}</span>`).join('')}</div></section>`;
}
function __marquee(c, p) {
  const items = (c.why && c.why.length ? c.why : ['Considered', 'Crafted', 'Precise', 'Timeless']).slice(0, 6);
  // Decorative furniture: give it a stable id (so it is addressable like every
  // other section) and aria-hidden (a scrolling word list is noise for screen
  // readers, and it duplicates copy that already appears elsewhere).
  return `<div class="c-marquee" id="marquee" data-r aria-hidden="true"><div class="c-marquee-track">${items.map(t => `<span>${__e(t)}</span><i>·</i>`).join('')}</div></div>`;
}
function __metrics(c, p) {
  // A visually-titleless section still needs a heading, or it is absent from the
  // document outline for screen readers and search engines. Rendered sr-only so
  // the design is unchanged.
  return `<section class="c-metrics" id="metrics" data-r><h2 class="c-sr-only">${__e(c.name)} by the numbers</h2><div class="c-wrap c-metrics-grid">${(c.stats.length ? c.stats : [{ value: '0', label: 'Start here' }]).map((s, i) => `<div class="c-metric"><b data-count="${__e(s.value)}">${__e(s.value)}</b><span>${__e(s.label)}</span></div>`).join('')}</div></section>`;
}

function __feature(c, p) {
  const mode = p.featureMode; const items = c.services.length ? c.services : (c.why.length ? c.why.map(w => ({ title: w, text: c.sub })) : [{ title: 'Craft', text: c.sub }]);
  const head = `<div class="c-sec-head c-sec-left"><span class="c-kicker">What we do</span><h2 class="c-sec-title">${__e(p.direction === 'editorial-minimal' ? 'A considered craft' : 'What we do')}</h2></div>`;
  const num = (i) => `<span class="c-num">${String(i + 1).padStart(2, '0')}</span>`;
  if (mode === 'edlist') {
    return `<section class="c-feature c-feature-edlist" id="feature" data-r><div class="c-wrap">${head}<div class="c-edlist">${items.slice(0, 4).map((it, i) => `<div class="c-edrow"><div class="c-edrow-h">${num(i)}<h3>${__e(it.title)}</h3></div><p>${__e(it.text || c.sub)}</p></div>`).join('')}</div></div></section>`;
  }
  if (mode === 'alternating') {
    return `<section class="c-feature c-feature-alt" id="feature" data-r><div class="c-wrap">${head}<div class="c-altlist">${items.slice(0, 4).map((it, i) => `<div class="c-altrow"><div class="c-altrow-num">${num(i)}</div><div class="c-altrow-body"><h3>${__e(it.title)}</h3><p>${__e(it.text || c.sub)}</p></div><div class="c-altrow-img">${__img({ seed: i, w: 420, h: 260, dir: p.direction, src: it.image, alt: it.title ? (it.title + ' — illustration') : '' })}</div></div>`).join('')}</div></div></section>`;
  }
  if (mode === 'bento') {
    return `<section class="c-feature c-feature-bento" id="feature" data-r><div class="c-wrap">${head}<div class="c-bento">${items.slice(0, 3).map((it, i) => `<div class="c-bento-cell ${i === 0 ? 'c-bento-big' : ''}"><div class="c-bento-img">${__img({ seed: i + 1, w: i === 0 ? 640 : 320, h: i === 0 ? 440 : 200, dir: p.direction, src: it.image, alt: it.title ? (it.title + ' — illustration') : '' })}</div><h3>${__e(it.title)}</h3><p>${__e(it.text || c.sub)}</p></div>`).join('')}</div></div></section>`;
  }
  if (mode === 'split') {
    return `<section class="c-feature c-feature-split" id="feature" data-r><div class="c-wrap c-split"><div class="c-split-img">${__img({ seed: 6, w: 640, h: 800, dir: p.direction, src: c.image })}</div><div class="c-split-body">${head}${items.slice(0, 3).map(it => `<div class="c-split-item"><span class="c-dot"></span><div><h3>${__e(it.title)}</h3><p>${__e(it.text || c.sub)}</p></div></div>`).join('')}</div></div></section>`;
  }
  if (mode === 'spec') {
    // Spec sheet — the engineered treatment: each capability is a numbered
    // technical row (index · title · description), aligned to a hard baseline
    // with a hairline separator. Deliberately NOT cards: an engineering firm
    // presents capabilities as a schedule of works, not as marketing tiles.
    return `<section class="c-feature c-feature-spec" id="feature" data-r><div class="c-wrap">${head}`
      + `<ol class="c-spec">${items.slice(0, 6).map((it, i) => `<li class="c-spec-row">`
        + `<span class="c-spec-idx">${String(i + 1).padStart(2, '0')}</span>`
        + `<h3 class="c-spec-title">${__e(it.title)}</h3>`
        + `<p class="c-spec-desc">${__e(it.desc)}</p>`
        + `</li>`).join('')}</ol></div></section>`;
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

// The story section printed c.sub as the lead AND `c.meta || c.sub` as the body.
// Since c.meta defaults to c.sub, the hero subtitle appeared three times on the
// same page. Duplicated copy reads as a broken generator, so: never repeat a
// paragraph, and never pad with a restatement — if there is only one real
// sentence, show one paragraph.
function __storyCopy(c) {
  // The hero already shows c.sub. Repeating it verbatim as the story lead is
  // still duplication, so prefer any DISTINCT longer-form copy and only fall
  // back to the subtitle when the brief genuinely has nothing else to say.
  const heroSub = String(c.sub || '').trim();
  const alt = [c.about, c.meta, c.blurb].map(x => String(x || '').trim()).find(x => x && x !== heroSub) || '';
  const lead = alt || heroSub;
  const bodyRaw = [c.meta, c.about].map(x => String(x || '').trim()).find(x => x && x !== lead && x !== heroSub) || '';
  const body = bodyRaw;
  const out = [];
  if (lead) out.push(`<p class="c-lead">${__e(lead)}</p>`);
  if (body) out.push(`<p class="c-body">${__e(body)}</p>`);
  // If the only copy available is already on screen in the hero, say something
  // structural instead of echoing it.
  if (!out.length || (out.length === 1 && lead === heroSub && !body)) {
    return `<p class="c-lead">${__e(c.name)} — how we work, and what we hold to.</p>`;
  }
  return out.join('');
}

function __story(c, p) {
  return `<section class="c-story" id="story" data-r><div class="c-wrap c-story-inner"><div class="c-story-img">${__img({ seed: 8, w: 700, h: 760, dir: p.direction, src: c.image })}</div><div class="c-story-body"><span class="c-kicker">Our story</span><h2 class="c-sec-title">${__e(p.direction === 'bold-experimental' ? 'The work is the story' : 'Built on care')}</h2>${__storyCopy(c)}</div></div></section>`;
}

function __work(c, p) {
  const items = c.projects.length ? c.projects.slice(0, 6) : [{ title: 'Selected work', cat: 'Case study', text: c.sub }];
  return `<section class="c-work" id="work" data-r><div class="c-wrap"><div class="c-sec-head c-sec-left"><span class="c-kicker">Selected</span><h2 class="c-sec-title">${__e(p.direction === 'bold-experimental' ? 'WORK' : 'Selected projects')}</h2></div><div class="c-work-grid">${items.map((it, i) => `<a class="c-work-item" href="#contact"><figure>${__img({ seed: i + 2, w: 640, h: 460, dir: p.direction, src: it.image, alt: it.title ? (it.title + (it.cat ? ' — ' + it.cat : '')) : '' })}</figure><div class="c-work-meta"><span class="c-work-cat">${__e(it.cat)}</span><h3>${__e(it.title)}</h3><p>${__e(it.text)}</p></div></a>`).join('')}</div></div></section>`;
}

function __reviews(c, p) {
  const items = c.reviews.length ? c.reviews.slice(0, 4) : [{ quote: c.sub, author: c.owner, role: 'Client' }];
  const star = () => '★'.repeat(5);
  if (p.reviewMode === 'single') {
    return `<section class="c-reviews c-reviews-single" id="reviews" data-r><h2 class="c-sr-only">What clients say about ${__e(c.name)}</h2><div class="c-wrap"><div class="c-quote-large"><span class="c-mark">“</span><p>${__e(items[0].quote)}</p><div class="c-quote-by"><b>${__e(items[0].author)}</b><span>${__e(items[0].role)}</span><span class="c-stars">${star()}</span></div></div></div></section>`;
  }
  if (p.reviewMode === 'quote') {
    return `<section class="c-reviews c-reviews-quote" id="reviews" data-r><h2 class="c-sr-only">What clients say about ${__e(c.name)}</h2><div class="c-wrap"><div class="c-quote-row">${items.slice(0, 2).map(it => `<figure class="c-quote"><blockquote>“${__e(it.quote)}”</blockquote><figcaption><b>${__e(it.author)}</b><span>${__e(it.role)}</span></figcaption></figure>`).join('')}</div></div></section>`;
  }
  return `<section class="c-reviews c-reviews-grid" id="reviews" data-r><div class="c-wrap"><div class="c-sec-head c-sec-left"><span class="c-kicker">Clients</span><h2 class="c-sec-title">What they say</h2></div><div class="c-reviewGrid">${items.map(it => `<div class="c-review"><span class="c-stars">${star()}</span><blockquote>“${__e(it.quote)}”</blockquote><div class="c-review-by"><b>${__e(it.author)}</b><span>${__e(it.role)}</span></div></div>`).join('')}</div></div></section>`;
}

function __cta(c, p) {
  return `<section class="c-cta" id="cta" data-r><div class="c-wrap c-cta-inner"><span class="c-kicker c-kicker-center">Let's talk</span><h2 class="c-cta-title">${__e(p.direction === 'bold-experimental' ? 'Make it happen' : 'Start the conversation')}</h2><div class="c-actions"><a class="c-btn c-btn-primary c-btn-lg" href="${c.email ? `mailto:${__e(c.email)}` : '#contact'}">${__e(c.ctas.primary)}</a></div></div></section>`;
}
function __contact(c, p) {
  return `<section class="c-contact" id="contact" data-r><div class="c-wrap c-contact-inner"><span class="c-kicker">Get in touch</span><h2 class="c-sec-title">${__e(p.direction === 'bold-experimental' ? 'Talk to us' : 'Start a conversation')}</h2><p class="c-lead">${__e(c.ctas.primary)} — tell us what you're making.</p><div class="c-contact-row">${c.email ? `<a href="mailto:${__e(c.email)}" class="c-btn c-btn-ghost">${__e(c.email)}</a>` : ''}${c.phone ? `<a href="tel:${__e(c.phone)}" class="c-btn c-btn-ghost">${__e(c.phone)}</a>` : ''}</div></div></section>`;
}

function __footer(c, p) {
  return `<footer class="c-footer" data-r><div class="c-wrap c-footer-row"><div class="c-footer-brand">${__e(c.name)} <span>— ${__e(c.owner)}</span></div><div class="c-footer-links">${c.email ? `<a href="mailto:${__e(c.email)}">${__e(c.email)}</a>` : ''}${c.phone ? `<a href="tel:${__e(c.phone)}">${__e(c.phone)}</a>` : ''}<span>© 2026 ${__e(c.name)}</span></div></div></footer>`;
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
  // ── PLAN NORMALISATION ────────────────────────────────────────────────
  // The plan is trusted input, but it can arrive from an AI patch, an import or
  // an API caller. Fuzzing the plan layer found three real failure modes:
  // a non-array `sections` threw (.map of a string), duplicated entries emitted
  // duplicate element ids AND two <h1> elements, and an empty list produced a
  // page with no <h1> at all. Normalise once, here, rather than trusting it.
  const __known = Object.keys(render);
  let __sections = Array.isArray(p.sections) ? p.sections : [];
  const __seen = new Set();
  __sections = __sections
    .filter((x) => typeof x === 'string' && __known.includes(x))   // drop nulls/unknown keys
    .filter((x) => (__seen.has(x) ? false : (__seen.add(x), true)));// each section at most once
  // A page must always have a hero (it carries the only <h1>) and a footer.
  if (!__sections.includes('hero')) __sections.unshift('hero');
  if (!__sections.includes('footer')) __sections.push('footer');
  if (__sections[__sections.length - 1] !== 'footer') {
    __sections = __sections.filter((x) => x !== 'footer').concat(['footer']);
  }
  // A non-array rhythm/transitions/emphasisTiers (an AI patch can produce one)
  // previously left EVERY section without a rhythm beat — the whole rhythm
  // system silently switched off. Fall back to the direction's own motif and
  // resize to match the final section list.
  const __motif = (d.rhythm && d.rhythm.length) ? d.rhythm : ['normal'];
  const __rhythm = Array.isArray(p.rhythm) && p.rhythm.length
    ? __sections.map((_, i) => p.rhythm[i] || __motif[i % __motif.length])
    : __sections.map((_, i) => __motif[i % __motif.length]);
  const __trans = Array.isArray(p.transitions) && p.transitions.length
    ? __sections.map((_, i) => p.transitions[i] || 'fade')
    : __sections.map((_, i) => (i === 0 ? 'flat' : 'fade'));
  const __tiers = Array.isArray(p.emphasisTiers) && p.emphasisTiers.length
    ? __sections.map((_, i) => p.emphasisTiers[i] || 'med')
    : __sections.map(() => 'med');
  const np = Object.assign({}, p, { sections: __sections, rhythm: __rhythm, transitions: __trans, emphasisTiers: __tiers });

  const parts = np.sections.map((s, i) => ({
    key: s,
    html: __injectRhythm(render[s] ? render[s](content, np) : '', Array.isArray(np.rhythm) ? np.rhythm[i] : '', Array.isArray(np.transitions) ? np.transitions[i] : '', Array.isArray(np.emphasisTiers) ? np.emphasisTiers[i] : ''),
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
  const __textDir = nxDetectDirection(content);
  const html = `<!DOCTYPE html><html lang="${nxDetectLang(content)}" dir="${__textDir}" data-dir="${d.id}" data-motion="${__e(motion)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${__e(content.name)} — ${__e(d.name)}</title><meta name="description" content="${__e(content.meta)}"><meta property="og:type" content="website"><meta property="og:title" content="${__e(content.name)}"><meta property="og:description" content="${__e(content.meta)}"><meta property="og:site_name" content="${__e(content.name)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${__e(content.name)}"><meta name="twitter:description" content="${__e(content.meta)}"><meta name="theme-color" content="${d.palette.bg}"><style>${__css(d, np)}</style></head><body><a class="c-skip" href="#main">Skip to content</a><div class="c-page" data-density="${__e(np.density)}">${main}</div><script>${__js(np)}</script></body></html>`;
  return { html, plan: p, content };
}

// ── DIRECTION DESIGN SYSTEM CSS ──────────────────────────────────────────────
// ── CSS VALUE SANITISER ───────────────────────────────────────────────────
// Palette/type/shadow values are interpolated straight into a <style> block. A
// plan can be supplied by an AI patch, an import, or an API caller, so a value
// containing "}</style><script>" escaped the stylesheet and executed — a real,
// demonstrated XSS. Strip the characters that can terminate a declaration,
// a rule, or the element itself. Nothing legitimate in a colour, length, font
// stack or shadow needs < > ; { } or an @-rule.
function __cssVal(v, fallback) {
  const raw = String(v == null ? '' : v);
  const clean = raw.replace(/[<>{}:;]/g, (ch) => (ch === ':' ? ':' : ''))
    .replace(/[<>{};]/g, '')
    .replace(/@import|expression\s*\(|javascript:|behaviou?r\s*:/gi, '')
    .trim();
  // A value that was entirely unsafe, or is now empty, falls back rather than
  // emitting a broken declaration.
  return clean && clean.length <= 200 ? clean : String(fallback == null ? '' : fallback);
}
function __cssNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 400 ? n : fallback;
}

// Decide light vs dark from the actual background luminance rather than a
// hand-maintained flag that can drift out of sync with the palette.
function __isDarkPalette(pal) {
  const m = String((pal && pal.bg) || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(m)) return false;
  const c = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) < 0.5;
}

function __css(d, p) {
  // A plan may override the direction's type/palette so patches change the render.
  // Sanitise every plan-supplied value, and fall back to the direction's own
  // token when a value is missing or unusable — a partial palette must not
  // yield `--bg:undefined`.
  const rawT = (p && p.type) || d.type; const rawPal = (p && p.palette) || d.palette;
  const t = {}; for (const k of Object.keys(d.type)) t[k] = __cssVal(rawT && rawT[k], d.type[k]);
  const pal = {}; for (const k of Object.keys(d.palette)) pal[k] = __cssVal(rawPal && rawPal[k], d.palette[k]);
  const radius = __cssNum((p && p.radius != null) ? p.radius : d.radius, d.radius);
  const shadow = __cssVal((p && p.shadow != null) ? p.shadow : d.shadow, d.shadow);
  return `
:root{--bg:${pal.bg};--bg2:${pal.bg2};--surf:${pal.surface};--surf2:${pal.surface2};--text:${pal.text};--muted:${pal.muted};--faint:${pal.faint};--accent:${pal.accent};--accent2:${pal.accent2};--line:${pal.line};--rule:${pal.rule};--disp:${t.family};--font:${t.bodyFamily || t.family};--body:${t.body};--rad:${radius}px;--shadow:${shadow};--measure:${t.measure};--mono:${t.mono || "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace"};--fs-caption:${t.caption};--fs-display:${t.display};--fs-hero:${t.hero};--fs-section:${t.section};--ease:cubic-bezier(.22,1,.36,1);--emph:1;
  /* ── DESIGN TOKEN LAYER ────────────────────────────────────────────────
     Previously only raw primitives (one colour set, one radius, one shadow)
     were exposed. Everything else — spacing, elevation, motion, stacking —
     was hardcoded per rule, so it could drift, could not be themed, and could
     not be audited. These are the scales a real design system exposes. */
  /* Spacing: 4px base, geometric. Every gap/padding should come from here. */
  --space-0:0;--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:24px;
  --space-6:32px;--space-7:48px;--space-8:64px;--space-9:96px;--space-10:128px;
  /* Radius scale derived from the direction's own radius so themes stay coherent */
  --rad-xs:${Math.max(0, Math.round(radius * 0.5))}px;--rad-sm:${radius}px;
  --rad-md:${Math.round(radius * 1.6)}px;--rad-lg:${Math.round(radius * 2.4)}px;--rad-full:9999px;
  /* Elevation: a scale, not a single shadow. Low alpha = premium depth. */
  --elev-0:none;
  --elev-1:0 1px 2px -1px rgba(0,0,0,.12);
  --elev-2:0 8px 24px -12px rgba(0,0,0,.18);
  --elev-3:${shadow};
  /* Motion: named durations + easings so timing is consistent and tunable */
  --dur-fast:120ms;--dur-base:240ms;--dur-slow:480ms;
  --ease-out:cubic-bezier(.22,1,.36,1);--ease-in-out:cubic-bezier(.65,0,.35,1);
  /* Stacking: an explicit ladder prevents the classic ad-hoc z-index war */
  --z-base:0;--z-raised:10;--z-sticky:50;--z-overlay:100;--z-modal:1000;
  /* Interaction states, derived from the accent so they theme automatically */
  --state-hover:color-mix(in oklab, var(--accent) 88%, white 12%);
  --state-active:color-mix(in oklab, var(--accent) 82%, black 18%);
  --state-focus:var(--accent);
  --state-disabled:var(--faint);
  /* Feedback colours — table stakes for forms, absent until now */
  --success:#1f9d55;--warning:#c77700;--danger:#c8342b;--info:var(--accent)}
/* Tell the browser which scheme this palette is, so native controls,
   scrollbars and form widgets match instead of fighting the design. */
:root{color-scheme:${__isDarkPalette(pal) ? 'dark' : 'light'}}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:var(--font);font-size:var(--body);background:var(--bg);color:var(--text);line-height:1.7;-webkit-font-smoothing:antialiased;overflow-x:hidden}
/* A long unbroken word, URL or email must never force horizontal scroll on a
   narrow viewport — the classic mobile-overflow defect. Break only where needed. */
h1,h2,h3,h4,h5,h6,p,li,a,span,figcaption,blockquote{overflow-wrap:anywhere;word-break:normal}
/* Keyboard focus MUST be visible. Nothing defined one, so a keyboard or
   switch-control user had no idea where they were on the page. :focus-visible
   keeps it out of the way of mouse users. */
:focus-visible{outline:3px solid var(--state-focus);outline-offset:3px;border-radius:var(--rad-xs)}
/* Visually hidden, still announced. Lets a section carry a heading for the
   document outline without altering the visual design. */
.c-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
/* Feedback + interaction utilities. These make the semantic tokens REAL rather
   than declared-and-unused: any generated form, alert or toast consumes them. */
.c-msg{padding:var(--space-3) var(--space-4);border-radius:var(--rad-sm);font-size:var(--fs-caption)}
.c-msg-success{color:var(--success);border:1px solid var(--success)}
.c-msg-warning{color:var(--warning);border:1px solid var(--warning)}
.c-msg-danger{color:var(--danger);border:1px solid var(--danger)}
.c-msg-info{color:var(--info);border:1px solid var(--info)}
.c-btn:hover{background:var(--state-hover)}
.c-btn:active{background:var(--state-active);transition-duration:var(--dur-fast)}
.c-btn[disabled],.c-btn[aria-disabled="true"]{color:var(--state-disabled);pointer-events:none}
.c-elev-2{box-shadow:var(--elev-2)}.c-elev-3{box-shadow:var(--elev-3)}
.c-round{border-radius:var(--rad-full)}.c-round-lg{border-radius:var(--rad-lg)}.c-round-md{border-radius:var(--rad-md)}
/* RTL: mirror the layout, not only the text run. Logical properties keep a
   single stylesheet correct in both directions instead of duplicating rules. */
[dir="rtl"] .c-sec-left,[dir="rtl"] .c-hero-copy{text-align:right}
[dir="rtl"] .c-spec-row{direction:rtl}
[dir="rtl"] .c-marquee-track{animation-direction:reverse}
/* Standalone navigation/footer links are tap targets too. Inline links inside
   prose are deliberately excluded — 44px does not apply mid-sentence. */
.c-nav a,.c-footer-links a,.c-nav-links a{display:inline-flex;align-items:center;min-height:44px}
.c-skip{min-height:44px;display:inline-flex;align-items:center}
a:focus-visible,button:focus-visible,[tabindex]:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
/* Skip link — the <main> landmark existed but nothing let you jump to it. */
.c-skip{position:absolute;left:-9999px;top:0;z-index:var(--z-modal);padding:var(--space-3) var(--space-4);background:var(--accent);color:#fff;font-weight:700}
.c-skip:focus{left:8px;top:8px}
img,svg{max-width:100%;display:block}a{color:inherit;text-decoration:none}button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
.c-wrap{max-width:1200px;margin-inline:auto;padding-inline:clamp(20px,4.5vw,56px)}
.c-kicker{display:inline-block;font-family:var(--body);font-size:${t.caption};letter-spacing:.26em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:16px}
.c-kicker-center{text-align:center}
.c-display{font-family:var(--disp);font-weight:700;line-height:1.02;letter-spacing:-.02em;font-size:${t.display};max-width:16ch}
.c-lead{font-family:var(--body);font-size:${t.hero};line-height:1.25;color:var(--muted);max-width:${t.measure};font-weight:400;letter-spacing:-.01em}
.c-body{font-size:${t.body};line-height:1.7;color:var(--muted);max-width:${t.measure}}
.c-sec-title{font-family:var(--disp);font-weight:700;line-height:1.08;letter-spacing:-.02em;font-size:${t.section}}
.c-sec-head{margin-bottom:clamp(24px,4vw,48px)}.c-sec-left .c-sec-title{max-width:22ch}
/* WCAG 2.5.8 / platform guidance: an interactive control must present at
   least a 44x44px target. The padding+line-height here resolved to ~42px,
   just under the bar, so every button on every generated page was a
   marginal tap target on a phone. min-height enforces it directly. */
.c-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;gap:var(--space-2);padding:var(--space-3) var(--space-5);font-family:var(--body);font-weight:700;font-size:${t.btn};letter-spacing:.12em;text-transform:uppercase;border-radius:var(--rad);transition:transform var(--dur-base) var(--ease-out),background var(--dur-base) var(--ease-out),color var(--dur-base) var(--ease-out),border-color var(--dur-base) var(--ease-out);white-space:nowrap}
.c-btn-primary{background:var(--accent);color:${d.family==='type-led'? '#fff' : (d.id==='swiss-structured'? '#fff':'#fff')};box-shadow:var(--shadow)}
.c-btn-primary:hover{transform:translateY(-2px)}
.c-btn-ghost{background:transparent;color:var(--text);border:1px solid var(--line);border-radius:var(--rad)}
.c-btn-ghost:hover{border-color:var(--accent);color:var(--accent)}
.c-btn-lg{padding:16px 32px}
.c-actions{display:flex;gap:12px;margin-top:32px;flex-wrap:wrap}
/* nav */
.c-nav{position:sticky;top:0;z-index:var(--z-sticky);background:var(--bg);border-bottom:1px solid var(--line);backdrop-filter:blur(10px)}
.c-bar{display:flex;align-items:center;justify-content:space-between;height:76px;gap:20px}
.c-brand{font-family:var(--disp);font-weight:700;font-size:1.05rem;letter-spacing:-.01em}
.c-links{display:flex;gap:24px}.c-links a{font-size:.9rem;color:var(--muted);transition:color .2s}.c-links a:hover{color:var(--accent)}
/* hero */
.c-hero{position:relative}
.c-hero-inner{display:grid;gap:40px;align-items:center;padding-block:clamp(56px,9vw,112px)}
.c-hero-copy>*{max-width:${t.measure}}
/* editorial hero: asymmetric two-col */
.c-hero-editorial .c-hero-inner{grid-template-columns:1fr 1.4fr}
.c-hero-editorial .c-hero-copy{align-self:center}
.c-hero-meta{display:flex;align-items:center;gap:16px;align-self:end;padding-bottom:16px;color:var(--faint);font-size:${t.caption};text-transform:uppercase;letter-spacing:.2em}
.c-rule{width:56px;height:1px;background:var(--rule)}
.c-hero-bleed{margin-top:8px}
.c-hero-bleed svg{width:100%;height:clamp(120px,20vw,220px)}
/* fullbleed cinematic */
.c-hero-fullbleed{min-height:86vh;display:flex;align-items:center}
.c-hero-bg{position:absolute;inset:0;overflow:hidden}
.c-hero-bg svg{width:100%;height:100%;object-fit:cover}
.c-hero-veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35),var(--bg) 92%)}
.c-hero-fullbleed .c-hero-inner{position:relative;z-index:var(--z-raised)}
.c-hero-fullbleed .c-display{color:#fff}
.c-hero-fullbleed .c-lead{color:rgba(255,255,255,.8)}
/* minimal luxury */
.c-hero-minimal .c-hero-inner{display:flex;flex-direction:column;align-items:center;text-align:center;padding-block:clamp(96px,14vw,192px)}
.c-hero-minimal .c-display{text-align:center}
.c-hero-minimal .c-lead{text-align:center}
/* overlap bold */
.c-hero-overlap .c-hero-inner{grid-template-columns:1.2fr .8fr;align-items:center}
/* ── AURORA HERO (engineered family) ────────────────────────────────────
   Three offset radial fields drift slowly behind a hard technical grid. The
   glow is the ONLY decorative element in the whole direction, which is what
   lets a single hot accent read as a signal rather than as noise. */
.c-hero-aurora{position:relative;overflow:hidden;isolation:isolate}
.c-hero-aurora .c-hero-inner{padding-block:clamp(96px,13vw,160px);position:relative;z-index:var(--z-raised)}
.c-hero-aurora .c-hero-copy{max-width:min(100%,58ch)}
.c-aurora{position:absolute;inset:-25% -10%;z-index:0;filter:blur(70px);opacity:.5;pointer-events:none}
.c-aurora i{position:absolute;display:block;border-radius:50%}
.c-aurora .c-a1{width:44vw;height:44vw;left:-6%;top:-12%;background:radial-gradient(circle,var(--accent) 0%,transparent 68%);animation:c-drift1 26s ease-in-out infinite alternate}
.c-aurora .c-a2{width:34vw;height:34vw;right:-4%;top:6%;background:radial-gradient(circle,var(--accent2) 0%,transparent 66%);animation:c-drift2 32s ease-in-out infinite alternate}
.c-aurora .c-a3{width:30vw;height:30vw;left:32%;bottom:-18%;background:radial-gradient(circle,var(--accent) 0%,transparent 70%);opacity:.55;animation:c-drift3 38s ease-in-out infinite alternate}
@keyframes c-drift1{to{transform:translate3d(6%,4%,0) scale(1.12)}}
@keyframes c-drift2{to{transform:translate3d(-5%,7%,0) scale(1.08)}}
@keyframes c-drift3{to{transform:translate3d(4%,-6%,0) scale(1.15)}}
.c-hero-grid-lines{position:absolute;inset:0;z-index:var(--z-raised);pointer-events:none;opacity:.5;
  background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);
  background-size:76px 76px;
  -webkit-mask-image:radial-gradient(ellipse at 50% 40%,#000 30%,transparent 78%);
          mask-image:radial-gradient(ellipse at 50% 40%,#000 30%,transparent 78%)}
/* Technical spec row — real facts from the brief, never invented numbers. */
.c-hero-specs{display:flex;flex-wrap:wrap;gap:clamp(24px,4vw,56px);margin-top:clamp(24px,4vw,40px);
  padding-top:clamp(20px,2.6vw,24px);border-top:1px solid var(--line)}
.c-hero-specs dt{font-family:var(--mono);font-size:var(--fs-caption);letter-spacing:.2em;text-transform:uppercase;color:var(--faint);margin-bottom:4px}
.c-hero-specs dd{font-size:clamp(1.5rem,2.6vw,2.1rem);font-weight:700;letter-spacing:-.02em;color:var(--text)}
/* ── SPEC SHEET FEATURE FAMILY (engineered) ─────────────────────────────
   A schedule of works, not a card grid: numbered rows on a hard baseline,
   separated by hairlines. The accent appears only on the index numeral. */
.c-spec{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.c-spec-row{display:grid;grid-template-columns:auto minmax(12ch,22%) 1fr;gap:clamp(16px,3vw,40px);
  align-items:baseline;padding:clamp(20px,3vw,32px) 0;border-bottom:1px solid var(--line);transition:background .3s var(--ease)}
.c-spec-row:hover{background:rgba(255,255,255,.02)}
.c-spec-idx{font-family:var(--mono);font-size:var(--fs-caption);letter-spacing:.18em;color:var(--accent)}
.c-spec-title{font-family:var(--disp);font-size:clamp(1.05rem,1.7vw,1.35rem);font-weight:700;letter-spacing:-.01em;margin:0}
.c-spec-desc{color:var(--muted);margin:0;max-width:var(--measure)}
@media (max-width:760px){.c-spec-row{grid-template-columns:auto 1fr;row-gap:8px}.c-spec-desc{grid-column:2/-1}}
@media (prefers-reduced-motion:reduce){.c-aurora i{animation:none}}
.c-hero-badges{position:relative}
.c-hero-badges svg{width:100%}
.c-hero-badges svg:last-child{position:absolute;right:0;bottom:-32px;width:64%;border:6px solid var(--bg)}
/* split */
.c-hero-split .c-hero-inner{grid-template-columns:1fr 1fr;align-items:center}
.c-hero-split .c-hero-img svg{width:100%;border-radius:var(--rad)}
/* strip / marquee */
.c-strip{padding-block:24px;border-block:1px solid var(--line)}
.c-strip-row{display:flex;justify-content:space-between;align-items:center;color:var(--faint);font-size:${t.caption};letter-spacing:.2em;text-transform:uppercase}
.c-marquee{overflow:hidden;border-bottom:1px solid var(--line);padding-block:16px;background:var(--bg2)}
.c-marquee-track{display:flex;gap:40px;white-space:nowrap;animation:cmarquee 24s linear infinite;width:max-content}
.c-marquee-track span{font-family:var(--disp);font-weight:700;font-size:1.4rem;text-transform:uppercase;letter-spacing:.04em}
.c-marquee-track i{color:var(--accent);font-style:normal}
@keyframes cmarquee{to{transform:translateX(-50%)}}
/* metrics */
.c-metrics{padding-block:clamp(48px,7vw,96px);border-block:1px solid var(--line)}
.c-metrics-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:32px}
.c-metric b{font-family:var(--disp);font-size:${t.hero};font-weight:700;display:block;line-height:1}
.c-metric span{color:var(--muted);font-size:${t.caption};letter-spacing:.1em;text-transform:uppercase}
/* feature modes */
.c-feature{padding-block:clamp(64px,10vw,128px)}
.c-feature *{max-width:none}
.c-edlist,.c-altlist{display:flex;flex-direction:column}
.c-edrow{display:grid;grid-template-columns:1fr 1fr;gap:32px;padding-block:32px;border-top:1px solid var(--line)}
.c-edrow-h{display:flex;align-items:baseline;gap:16px}.c-edrow-h h3{font-family:var(--disp);font-size:${t.section};font-weight:700;letter-spacing:-.01em}
.c-edrow p{color:var(--muted);font-size:${t.body};max-width:44ch}
.c-num{font-family:var(--body);font-size:${t.caption};color:var(--accent);letter-spacing:.1em}
.c-altrow{display:grid;grid-template-columns:64px 1fr 240px;gap:32px;align-items:center;padding-block:24px;border-top:1px solid var(--line)}
.c-altrow-img svg{width:100%;border-radius:var(--rad)}
.c-bento{display:grid;grid-template-columns:repeat(2,1fr);gap:24px}
.c-bento-cell{position:relative;overflow:hidden;border-radius:var(--rad);background:var(--surf2);border:1px solid var(--line);padding:24px}
.c-bento-big{grid-row:span 2}
.c-bento-img svg{width:100%;border-radius:var(--rad);margin-bottom:16px}
.c-split{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center}
.c-split-img svg{width:100%;border-radius:var(--rad)}
.c-split-item{display:flex;gap:16px;padding-block:16px;border-top:1px solid var(--line)}
.c-split-item h3{font-family:var(--disp);font-size:1.15rem;margin-bottom:4px;font-weight:600}
.c-split-item p{color:var(--muted);font-size:${t.body}}
.c-dot{width:10px;height:10px;background:var(--accent);border-radius:50%;margin-top:4px;flex:none}
/* card grid */
.c-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}
.c-grid-3{grid-template-columns:repeat(3,1fr)}
.c-card{padding:var(--space-5);background:var(--surf);border:1px solid var(--line);border-radius:var(--rad-sm);box-shadow:var(--elev-1)}
${p.surfaceFx === 'panel' ? `
/* ── PANEL SURFACE (engineered) ─────────────────────────────────────────
   surfaceFx was declared on every direction but never consumed by the CSS —
   dead configuration. A panel reads as machined hardware: a subtle top-edge
   highlight, a hairline border, and a hot accent rule that appears only on
   hover so the signal colour stays scarce. */
.c-card,.c-bento-item,.c-stat,.c-rev{position:relative;background:linear-gradient(180deg,var(--surf2) 0%,var(--surf) 100%);border:1px solid var(--line);box-shadow:var(--shadow);overflow:hidden}
.c-card::before,.c-bento-item::before,.c-stat::before{content:'';position:absolute;left:0;right:0;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.16),transparent)}
.c-card::after,.c-bento-item::after{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--accent);transform:scaleY(0);transform-origin:top;transition:transform .45s var(--ease,cubic-bezier(.22,1,.36,1))}
.c-card:hover::after,.c-bento-item:hover::after{transform:scaleY(1)}
.c-kicker{font-family:var(--mono)}
` : ''}
/* ruled grid — hairline modular cells, no elevated surface (Swiss) */
.c-ruled{display:grid;grid-template-columns:repeat(2,1fr);gap:0;border-top:1px solid var(--rule)}
.c-ruled-3{grid-template-columns:repeat(3,1fr)}
.c-ruled-cell{padding:32px 24px 32px 0;border-bottom:1px solid var(--line);border-right:1px solid var(--line)}
.c-ruled-cell:nth-child(2n){padding-right:0}
.c-ruled-3 .c-ruled-cell:nth-child(3n){border-right:0}
.c-ruled-idx{display:block;font-size:var(--fs-caption);letter-spacing:.14em;color:var(--accent);margin-bottom:12px;font-variant-numeric:tabular-nums}
.c-ruled-cell h3{margin:0 0 8px;font-size:calc(var(--fs-section)*.62);line-height:1.15}
.c-ruled-cell p{margin:0;color:var(--muted);max-width:38ch}
.c-card-k{display:block;font-size:1.2rem;margin-bottom:12px;color:var(--accent)}
.c-card h3{font-family:var(--disp);font-size:1.25rem;margin-bottom:8px;letter-spacing:-.01em}
.c-card p{color:var(--muted);font-size:${t.body}}
/* story */
.c-story{padding-block:clamp(72px,11vw,160px);background:var(--bg2)}
.c-story-inner{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center}
.c-story-img svg{width:100%;border-radius:var(--rad)}
/* work */
.c-work{padding-block:clamp(64px,10vw,128px)}
.c-work-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:24px}
.c-work-item figure svg{width:100%;border-radius:var(--rad);aspect-ratio:4/3;object-fit:cover}
.c-work-meta{margin-top:12px}.c-work-cat{color:var(--accent);font-size:${t.caption};letter-spacing:.14em;text-transform:uppercase}
.c-work-meta h3{font-family:var(--disp);font-size:1.3rem;margin-top:4px;letter-spacing:-.01em}
.c-work-meta p{color:var(--muted);font-size:${t.body}}
/* reviews */
.c-reviews{padding-block:clamp(56px,9vw,112px);background:var(--bg2)}
.c-reviews-single .c-quote-large{max-width:760px;margin-inline:auto;text-align:center}
.c-mark{font-family:var(--disp);font-size:6rem;color:var(--accent);line-height:.4;display:block}
.c-quote-large p{font-family:var(--disp);font-size:${t.hero};line-height:1.3;margin-block:4px}
.c-quote-by{display:flex;flex-direction:column;gap:4px;margin-top:24px;color:var(--muted)}
.c-stars{color:var(--accent);letter-spacing:.1em;font-size:.9rem}
.c-quote-row{display:grid;grid-template-columns:1fr 1fr;gap:40px}
.c-quote blockquote{font-family:var(--disp);font-size:${t.section};line-height:1.3;margin-bottom:20px}
.c-quote figcaption{display:flex;flex-direction:column;color:var(--muted)}
.c-reviewGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:24px}
.c-review{padding:32px;background:var(--surf);border:1px solid var(--line);border-radius:var(--rad)}
.c-review blockquote{font-size:${t.body};margin-block:12px}
.c-review-by{display:flex;flex-direction:column;color:var(--muted)}
/* cta */
.c-cta{padding-block:clamp(80px,13vw,192px);text-align:center}
.c-cta-inner{display:flex;flex-direction:column;align-items:center;gap:8px}
.c-cta-title{font-family:var(--disp);font-size:${t.display};font-weight:700;letter-spacing:-.02em;line-height:1.05;max-width:18ch}
/* contact */
.c-contact{padding-block:clamp(64px,10vw,128px);background:var(--bg2)}
.c-contact-inner{max-width:720px}
.c-contact-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}
@media (max-width:600px){.c-contact-row{flex-direction:column}}
/* footer */
.c-footer{padding-block:40px;border-top:1px solid var(--line);background:var(--bg2)}
.c-footer-row{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}
.c-footer-brand{font-family:var(--disp);font-weight:700}.c-footer-brand span{color:var(--muted);font-weight:400}
.c-footer-links{display:flex;gap:24px;align-items:center;color:var(--muted);font-size:.9rem;flex-wrap:wrap}
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
[data-rhythm="dramatic"]{padding-block:clamp(96px,16vw,224px)}
[data-rhythm="spacious"]{padding-block:clamp(80px,12vw,160px)}
[data-rhythm="normal"]{padding-block:clamp(56px,9vw,112px)}
[data-rhythm="compact"]{padding-block:clamp(32px,6vw,72px)}
/* ── SECTION TRANSITIONS: connect sections so the page reads as one composition ── */
[data-transition="bridge"]{border-top:1px solid var(--line);position:relative}
[data-transition="bridge"]::before{content:"";position:absolute;left:calc(max(20px,4.5vw) + 0px);right:calc(max(20px,4.5vw) + 0px);top:0;height:6px;background:var(--line);opacity:.5;transform:translateX(0)}
[data-transition="fade"]{position:relative;background-image:linear-gradient(to bottom,transparent,rgba(0,0,0,.02) 30%,var(--bg) 100%)}
[data-transition="bleed"]{border-top:1px solid var(--line)}
[data-transition="overlap"]{position:relative;z-index:var(--z-raised);margin-top:calc(clamp(-40px,-5vw,-16px));border-radius:var(--rad) var(--rad) 0 0;background:var(--bg);box-shadow:0 -32px 80px -40px rgba(0,0,0,.22)}
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
  .c-edrow{grid-template-columns:1fr;gap:8px}
  .c-altrow{grid-template-columns:1fr;gap:12px}.c-altrow-img{order:-1}
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
  // Reveal sections start at opacity:0, so ANY failure here leaves the whole
  // page permanently blank. IntersectionObserver is unavailable in older
  // browsers and some embedded webviews, and calling new on an undefined global
  // throws — taking the rest of this script (counters, nav) down with it.
  // Fail OPEN: if we cannot observe, everything is simply shown.
  var showAll=function(){els.forEach(function(e){e.classList.add('on');});};
  if(reduce||typeof IntersectionObserver!=='function'){showAll();}
  else{
    try{
      var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('on');io.unobserve(e.target);}});},{threshold:.12});
      els.forEach(function(e){io.observe(e);});
      // Safety net: if nothing has revealed after 3s (observer never fired, or
      // the page is shorter than the viewport), show the content anyway.
      setTimeout(function(){if(!document.querySelector('[data-r].on'))showAll();},3000);
    }catch(err){showAll();}
  }
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
  nxComposeContent, nxComposePlan, nxContentShape, nxDesignExplanation, nxRenderDirected, nxCompose, nxDetectDirection, nxDetectLang,
  nxComposeDegrade, nxComposePatchPlan, nxComposeDiagnose,
};

// Dual export: CommonJS (backend require + ESM default-interop) + browser global.
if (typeof module !== 'undefined' && module.exports) module.exports = nx_compose_api;
if (typeof globalThis !== 'undefined') globalThis.NX_COMPOSE_LIB = nx_compose_api;
if (typeof window !== 'undefined') window.NX_COMPOSE_LIB = nx_compose_api;
