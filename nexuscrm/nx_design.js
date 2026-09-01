// ─────────────────────────────────────────────────────────────────────────────
// nx_design.js — NexusCRM design-system core.
//
// The DETERMINISTIC half of the hybrid AI/deterministic website engine.
//   AI    → intent, creative decisions, design exploration, composition,
//           content/tone, motion strategy, diagnosis/critique.
//   THIS  → preserving decisions (Brand/Tokens), modelling them (Project Graph),
//           composing building blocks (Component families), generating motion
//           (Motion Engine + Animation Composer), judging beauty (Design QA),
//           and the bidirectional graph↔code mapping.
//
// Dependency-free. Runs in the worker, the browser, and the test harness.
// Pure functions only — deterministic inputs in, deterministic outputs out.
// ─────────────────────────────────────────────────────────────────────────────

// ── BRAND / DESIGN MEMORY (single source of truth for the visual language) ────
const NX_BRAND_DEFAULTS = {
  primaryColor: '#060912',       // deep space navy background
  secondaryColor: '#FF5F00',     // signature orange
  accentColor: '#5B8DEF',        // electric steel-blue
  neutralBg: '#060912',
  neutralFg: '#EEF2F8',
  headingFont: 'Space Grotesk, Inter, system-ui, sans-serif',
  bodyFont: 'Inter, system-ui, sans-serif',
  monoFont: 'JetBrains Mono, monospace',
  amberColor: '#FFB23E',
  radiusStyle: '14px',
  shadowStyle: '0 30px 80px -30px rgba(0,0,0,.9)',
  motionStyle: 'cinematic',
  visualTone: 'dark-cinematic',
  spacingScale: 1,
  fontScale: 1,
  maxWidth: '1200px',
};

function isHex(c) { return typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c); }
function expandHex(h) {
  if (!isHex(h)) return null;
  if (h.length === 4) return '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  return h.toLowerCase();
}
// WCAG relative luminance for a #rrggbb hex.
function _lum(hex) {
  const e = expandHex(hex); if (!e) return 0;
  const r = parseInt(e.slice(1, 3), 16) / 255;
  const g = parseInt(e.slice(3, 5), 16) / 255;
  const b = parseInt(e.slice(5, 7), 16) / 255;
  const f = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
// WCAG contrast ratio between two hex colors.
function contrastRatio(a, b) {
  const la = _lum(a), lb = _lum(b);
  const L = Math.max(la, lb), D = Math.min(la, lb);
  return (L + 0.05) / (D + 0.05);
}

// Compile a brand into a CSS :root variable block (deterministic).
function nxTokensToCss(brand) {
  const b = nxMergeBrand(NX_BRAND_DEFAULTS, brand || {});
  const s = `  --nx-primary:${b.primaryColor};\n` +
    `  --nx-secondary:${b.secondaryColor};\n` +
    `  --nx-accent:${b.accentColor};\n` +
    `  --nx-amber:${b.amberColor};\n` +
    `  --nx-bg:${b.neutralBg};\n` +
    `  --nx-bg-2:#080C16;\n` +
    `  --nx-panel:#0D1322;\n` +
    `  --nx-panel-2:#121A2C;\n` +
    `  --nx-line:rgba(255,255,255,.07);\n` +
    `  --nx-line-2:rgba(255,255,255,.13);\n` +
    `  --nx-muted:#97A3BA;\n` +
    `  --nx-dim:#65708A;\n` +
    `  --nx-fg:${b.neutralFg};\n` +
    `  --nx-heading-font:${b.headingFont};\n` +
    `  --nx-body-font:${b.bodyFont};\n` +
    `  --nx-mono-font:${b.monoFont};\n` +
    `  --nx-radius:${b.radiusStyle};\n` +
    `  --nx-shadow:${b.shadowStyle};\n` +
    `  --nx-max-width:${b.maxWidth};\n` +
    `  --nx-accent-glow:rgba(255,95,0,.45);\n` +
    `  --nx-accent-soft:rgba(255,95,0,.12);\n`;
  return ':root {\n' + s + '}';
}

// Merge a patch onto a base brand — DESIGN MEMORY: keys the patch does NOT
// mention are preserved exactly (so "make it orange" never wipes the font).
function nxMergeBrand(base, patch) {
  // Start from defaults so every call yields a COMPLETE brand, then overlay the
  // given base, then overlay the patch. Empty/undefined patch values are skipped
  // so "make this orange" never wipes the font choice (design memory).
  const out = Object.assign({}, NX_BRAND_DEFAULTS, base || {});
  if (patch && typeof patch === 'object') for (const k of Object.keys(patch)) {
    if (patch[k] !== undefined && patch[k] !== null && patch[k] !== '') out[k] = patch[k];
  }
  return out;
}

// Best-effort extraction of a brand from an existing site's CSS / inline styles,
// so AI edits DON'T destroy the original design language.
function nxBrandFromSite(html) {
  const b = {};
  const s = String(html || '');
  const colors = [...new Set(String(s).match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi) || [])].map(c => c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c);
  if (colors.length) {
    // pick the most-common as primary, a second-most-common as accent
    const freq = {}; colors.forEach(c => freq[c] = (freq[c] || 0) + 1);
    // weight toward saturated/dark for primary
    const sorted = Object.keys(freq).sort((a, bb) => freq[bb] - freq[a]);
    b.primaryColor = sorted[0];
    if (sorted[1]) b.accentColor = sorted[1];
  }
  const fonts = s.match(/font-family:\s*([^;}{]+)/gi) || [];
  if (fonts.length >= 2) b.headingFont = (fonts[0].replace(/^font-family:\s*/i, '')).trim();
  if (fonts.length >= 1) b.bodyFont = (fonts[fonts.length - 1].replace(/^font-family:\s*/i, '')).trim();
  const radius = s.match(/border-radius:\s*([^;}{]+)/i);
  if (radius) b.radiusStyle = radius[1].trim();
  return b;
}

// Validate a brand object; returns {ok, errors}.
function nxTokensValidate(brand) {
  const errors = [];
  const b = nxMergeBrand(NX_BRAND_DEFAULTS, brand || {});
  if (!isHex(b.primaryColor)) errors.push('primaryColor must be a hex color');
  if (!isHex(b.neutralBg)) errors.push('neutralBg must be a hex color');
  if (!isHex(b.neutralFg)) errors.push('neutralFg must be a hex color');
  const ratio = contrastRatio(b.neutralFg, b.neutralBg);
  if (ratio < 4.5) errors.push(`body contrast too low (${ratio.toFixed(2)}:1, need ≥4.5)`);
  if (!b.headingFont) errors.push('headingFont required');
  if (typeof b.spacingScale !== 'number' || b.spacingScale < 0.5) errors.push('spacingScale must be ≥0.5');
  return { ok: errors.length === 0, errors };
}

// ── PROJECT MODEL (multi-graph: content / design / motion / component / asset / responsive) ──
let __nxSeq = 1;
function nxNode(kind, props) {
  return Object.assign({
    id: 'n' + (__nxSeq++),
    kind: kind || 'section',
    structure: { type: 'stack', columns: 1, order: [] },
    visual: { hierarchy: [], typography: {}, colors: {}, spacing: {}, background: {} },
    motion: { timeline: [], triggers: [], easing: 'ease', stagger: 0 },
    responsive: { rules: [] },
    content: {},
    assets: [],
    purpose: { semantic: '', conversion: '' },
  }, props || {});
}
function nxProject(meta) {
  return {
    id: meta && meta.id || ('p' + Date.now().toString(36)),
    name: (meta && meta.name) || 'Untitled Site',
    brand: nxMergeBrand(NX_BRAND_DEFAULTS, (meta && meta.brand) || {}),
    nodes: {},
    order: [],
    motionStyle: (meta && meta.motionStyle) || NX_BRAND_DEFAULTS.motionStyle,
    direction: (meta && meta.direction) || '',
    created: (meta && meta.created) || new Date().toISOString(),
  };
}
function nxProjectAddComponent(project, node) {
  project.nodes[node.id] = node;
  project.order.push(node.id);
  return project;
}
function nxProjectValidate(project) {
  const errors = [];
  if (!project || !Array.isArray(project.order)) return { ok: false, errors: ['not a project'] };
  if (!project.order.length) errors.push('project has no components');
  for (const id of project.order) if (!project.nodes[id]) errors.push('dangling order entry ' + id);
  const h = Object.values(project.nodes).filter(n => n.kind === 'hero');
  if (!h.length) errors.push('project has no hero');
  if (h.length > 1) errors.push('project has more than one hero');
  return { ok: errors.length === 0, errors };
}

// ── COMPONENT INTELLIGENCE (families of compositions, not flat templates) ─────
const NX_COMPONENTS = {
  hero: {
    purpose: { semantic: 'above-the-fold first impression', conversion: 'capture attention + drive primary CTA' },
    variants: {
      centered:    { structure: { type: 'stack', columns: 1, align: 'center' } },
      split:       { structure: { type: 'grid', columns: 2, align: 'left' } },
      asymmetric:  { structure: { type: 'grid', columns: [3, 2], align: 'left' } },
      editorial:   { structure: { type: 'stack', columns: 1, align: 'left', maxChars: 60 } },
      product:     { structure: { type: 'grid', columns: 2, align: 'left', media: 'product' } },
      '3d-centered': { structure: { type: 'stack', columns: 1, align: 'center', media: '3d' } },
      video:       { structure: { type: 'stack', columns: 1, align: 'left', media: 'video' } },
      interactive: { structure: { type: 'grid', columns: 2, align: 'left', media: 'interactive' } },
    },
  },
  features: {
    purpose: { semantic: 'explain value proposition', conversion: 'build credibility + qualify' },
    variants: {
      grid:     { structure: { type: 'grid', columns: 3, align: 'left' } },
      split:    { structure: { type: 'grid', columns: 2, align: 'left' } },
      editorial:{ structure: { type: 'stack', columns: 1, align: 'left', maxChars: 70 } },
      bento:    { structure: { type: 'bento', columns: 0, align: 'left' } },
    },
  },
  pricing: {
    purpose: { semantic: 'offer tiers + value framing', conversion: 'convert to a paid plan' },
    variants: {
      centered: { structure: { type: 'grid', columns: 3, align: 'center', highlight: 'middle' } },
      toggle:   { structure: { type: 'stack', columns: 1, align: 'center', toggle: true } },
    },
  },
  testimonials: {
    purpose: { semantic: 'build trust via social proof', conversion: 'reduce risk + reinforce' },
    variants: {
      grid:     { structure: { type: 'grid', columns: 3, align: 'left' } },
      marquee:  { structure: { type: 'stack', columns: 1, align: 'left', marquee: true } },
      spotlight:{ structure: { type: 'grid', columns: 1, align: 'center', spotlight: true } },
    },
  },
  cta: {
    purpose: { semantic: 'final conversion push', conversion: 'convert now' },
    variants: {
      centered: { structure: { type: 'stack', columns: 1, align: 'center' } },
      split:    { structure: { type: 'grid', columns: 2, align: 'left' } },
    },
  },
  footer: {
    purpose: { semantic: 'nav + trust + contact', conversion: 'recovery / legal / brand' },
    variants: {
      columns:  { structure: { type: 'grid', columns: 4, align: 'left' } },
      minimal:  { structure: { type: 'stack', columns: 1, align: 'center' } },
    },
  },
  nav: {
    purpose: { semantic: 'orientation', conversion: 'wayfinding' },
    variants: {
      standard: { structure: { type: 'row', columns: 0, align: 'space-between' } },
      centered: { structure: { type: 'row', columns: 0, align: 'center' } },
    },
  },
  marquee: {
    purpose: { semantic: 'social proof / capability ticker', conversion: 'reinforce breadth' },
    variants: { ticker: { structure: { type: 'row', columns: 0, align: 'left', marquee: true } } },
  },
  stats: {
    purpose: { semantic: 'evidence band', conversion: 'build credibility' },
    variants: { grid: { structure: { type: 'grid', columns: 4, align: 'left' } }, row: { structure: { type: 'row', columns: 0, align: 'center' } } },
  },
  services: {
    purpose: { semantic: 'what we offer', conversion: 'qualify + route' },
    variants: { matrix: { structure: { type: 'grid', columns: 3, align: 'left' } }, rows: { structure: { type: 'stack', columns: 1, align: 'left' } } },
  },
  process: {
    purpose: { semantic: 'how it works', conversion: 'reduce uncertainty' },
    variants: { steps: { structure: { type: 'grid', columns: 4, align: 'left' } }, timeline: { structure: { type: 'stack', columns: 1, align: 'left' } } },
  },
  gallery: {
    purpose: { semantic: 'proof by imagery', conversion: 'build trust' },
    variants: { grid: { structure: { type: 'grid', columns: 3, align: 'left' } }, tabs: { structure: { type: 'grid', columns: 3, align: 'left', tabs: true } } },
  },
  faq: {
    purpose: { semantic: 'objection handling', conversion: 'remove friction' },
    variants: { accordion: { structure: { type: 'stack', columns: 1, align: 'left', accordion: true } } },
  },
  contact: {
    purpose: { semantic: 'conversion channel', conversion: 'capture enquiry' },
    variants: { split: { structure: { type: 'grid', columns: 2, align: 'left' } }, centered: { structure: { type: 'stack', columns: 1, align: 'center' } } },
  },
};

function nxListComponents() {
  return Object.keys(NX_COMPONENTS);
}
function nxComponentVariants(family) {
  return (NX_COMPONENTS[family] ? Object.keys(NX_COMPONENTS[family].variants) : []);
}
// Build a component node with sensible defaults overlaid by the chosen variant,
// then bind the brand tokens into it (colors/typography/spacing/motion).
function nxBuildComponent(family, variant, content, brand) {
  const fam = NX_COMPONENTS[family];
  if (!fam) throw new Error('unknown component family: ' + family);
  const v = fam.variants[variant];
  if (!v) throw new Error('unknown variant ' + variant + ' for ' + family);
  const b = nxMergeBrand(NX_BRAND_DEFAULTS, brand || {});
  const node = nxNode(family, {
    variant,
    structure: v.structure,
    purpose: fam.purpose,
    content: Object.assign({}, content || {}),
  });
  node.visual.typography = { headingFont: b.headingFont, bodyFont: b.bodyFont, scale: b.fontScale };
  node.visual.colors = { bg: b.neutralBg, fg: b.neutralFg, primary: b.primaryColor, accent: b.accentColor };
  node.visual.spacing = { scale: b.spacingScale, radius: b.radiusStyle, sectionTop: 'clamp(3.5rem,6vw,6rem)' };
  node.motion.easing = b.motionStyle === 'energetic' ? 'spring' : 'ease-out';
  node.motion.stagger = (b.motionStyle === 'minimal' || b.motionStyle === 'none') ? 0 : 60;
  node.responsive.rules = [{ on: 'mobile', columns: 1 }, { on: 'tablet', columns: (v.structure.columns === 2 || v.structure.columns === 4) ? 2 : 1 }];
  return node;
}

// ── MOTION ENGINE + ANIMATION COMPOSER ────────────────────────────────────────
// A Motion Graph is data: timeline + triggers + targets + states + easing +
// stagger + reduced-motion. Named moods map to recipes, so the AI speaks a
// *design vocabulary for motion* instead of generating random effects.
const NX_MOTION_RECIPES = {
  none:      { label: 'None',      desc: 'no motion', speed: 0,  easing: 'linear', stagger: 0,  parallax: 0, entrance: 'none',   hover: 'none',   reduced: 'none' },
  minimal:   { label: 'Minimal',   desc: 'single quick fade-in', speed: 0.45, easing: 'ease', stagger: 0, parallax: 0, entrance: 'fade', hover: 'lift', reduced: 'none' },
  smooth:    { label: 'Smooth',    desc: 'measured fades + subtle lift', speed: 0.6, easing: 'ease-out', stagger: 60, parallax: 0.1, entrance: 'fade-up', hover: 'lift', reduced: 'fade' },
  cinematic: { label: 'Cinematic', desc: 'slow entrance + large depth movement + subtle parallax + smooth easing + staggered reveals + low-frequency bg motion', speed: 1.1, easing: 'cubic-bezier(0.16,1,0.3,1)', stagger: 120, parallax: 0.32, entrance: 'fade-up', hover: 'depth', reduced: 'fade' },
  energetic: { label: 'Energetic', desc: 'faster transitions + spring interactions + stronger hover + short stagger + dynamic gradients', speed: 0.5, easing: 'spring', stagger: 45, parallax: 0.18, entrance: 'scale-in', hover: 'pop', reduced: 'fade' },
  playful:   { label: 'Playful',   desc: 'bouncy springs + overshoot + varied stagger', speed: 0.55, easing: 'spring', stagger: 80, parallax: 0.12, entrance: 'bounce-in', hover: 'wiggle', reduced: 'fade' },
  futuristic:{ label: 'Futuristic',desc: 'glide + parallax + 3D rotate + particles (curated scenes)', speed: 0.9, easing: 'cubic-bezier(0.22,1,0.36,1)', stagger: 100, parallax: 0.4, entrance: 'glide', hover: 'tilt', reduced: 'fade' },
};
const NX_MOTION_MOODS = {
  'make it feel cinematic': 'cinematic',
  cinematic: 'cinematic',
  dramatic: 'cinematic',
  'make it feel energetic': 'energetic',
  energetic: 'energetic',
  lively: 'energetic',
  upbeat: 'energetic',
  'make it feel playful': 'playful',
  playful: 'playful',
  'make it feel futuristic': 'futuristic',
  futuristic: 'futuristic',
  'make it feel minimal': 'minimal',
  minimal: 'minimal',
  'make it feel calm': 'minimal',
  'make it feel clean': 'smooth',
  smooth: 'smooth',
  'make it feel luxurious': 'cinematic',
  'make it feel premium': 'cinematic',
};
function nxMotionMood(text) {
  const key = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!key) return 'smooth';
  return NX_MOTION_MOODS[key] || 'smooth';
}
// Resolve a mood (or a recipe name) into a concrete recipe, with numeric opts.
function nxMotionCompose(moodOrRecipe, opts) {
  const name = nxMotionMood(moodOrRecipe);
  const rec = Object.assign({}, NX_MOTION_RECIPES[name] || NX_MOTION_RECIPES.smooth);
  if (opts && typeof opts === 'object') {
    for (const k of ['speed', 'stagger', 'parallax']) if (opts[k] != null) rec[k] = opts[k];
    if (opts.easing) rec.easing = opts.easing;
    if (opts.entrance) rec.entrance = opts.entrance;
    if (opts.hover) rec.hover = opts.hover;
  }
  rec.name = name;
  return rec;
}

// Deterministic CSS keyframes + per-trigger classes for a recipe.
const NX_ENTRANCES = {
  'fade':      'from{opacity:0}to{opacity:1}',
  'fade-up':   'from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}',
  'fade-in':   'from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}',
  'scale-in':  'from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}',
  'bounce-in': '0%{opacity:0;transform:translateY(40px)}60%{opacity:1;transform:translateY(-10px)}100%{transform:none}',
  'glide':     'from{opacity:0;transform:translateX(-30px)}to{opacity:1;transform:none}',
  'none':      'from{opacity:1}to{opacity:1}',
};
function nxMotionToCss(recipe) {
  const r = recipe && recipe.name ? recipe : nxMotionCompose(recipe);
  const kf = NX_ENTRANCES[r.entrance] || NX_ENTRANCES['fade-up'];
  const dur = Math.round(r.speed * 1000);
  let css = '@keyframes nx-ve{' + kf + '}\n' +
    `.nx-ve-enter{opacity:0}\n` +
    `.nx-ve-enter.is-in{animation:nx-ve ${dur}ms ${r.easing} both;animation-delay:var(--nx-ve-d,0ms)}\n` +
    `.nx-ve-parallax{will-change:transform;transition:transform .3s linear}\n`;
  if (r.hover === 'lift') css += `.nx-ve-hover{transition:transform .25s ease,box-shadow .25s ease}.nx-ve-hover:hover{transform:translateY(-6px)}\n`;
  if (r.hover === 'depth') css += `.nx-ve-hover{transition:transform .5s cubic-bezier(.16,1,.3,1),box-shadow .5s ease}.nx-ve-hover:hover{transform:translateY(-7px) scale(1.015)}\n`;
  if (r.hover === 'pop') css += `.nx-ve-hover{transition:transform .2s cubic-bezier(.34,1.56,.64,1)}.nx-ve-hover:hover{transform:scale(1.05)}\n`;
  if (r.hover === 'tilt') css += `.nx-ve-hover{transition:transform .3s ease}.nx-ve-hover:hover{transform:perspective(600px) rotateX(4deg) rotateY(-4deg)}\n`;
  if (r.reduced) css += `@media (prefers-reduced-motion:reduce){.nx-ve-enter{animation:none!important}.nx-ve-parallax,.nx-ve-hover{transition:none!important}}\n`;
  return css;
}
// Deterministic runtime JS: IntersectionObserver reveals + scroll parallax,
// always guarded by prefers-reduced-motion.
function nxMotionToJs(recipe) {
  const r = recipe && recipe.name ? recipe : nxMotionCompose(recipe);
  const stagger = r.stagger;
  const parallax = r.parallax;
  return `(function(){"use strict";
var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if(reduce){return;}
var els=Array.prototype.slice.call(document.querySelectorAll('.nx-ve-enter'));
els.forEach(function(el,i){el.style.setProperty('--nx-ve-d',(i*${stagger})+'ms');});
var io=('IntersectionObserver' in window)?new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('is-in');io.unobserve(e.target);}});},{threshold:0.15}):null;
els.forEach(function(el){if(io)io.observe(el);else el.classList.add('is-in');});
${parallax>0 ? `var pp=Array.prototype.slice.call(document.querySelectorAll('.nx-ve-parallax'));
if('scroll' in document){
  function upd(){if(reduce)return;var y=window.scrollY||0;pp.forEach(function(el){var s=parseFloat(el.dataset.px||${parallax});el.style.transform='translate3d(0,'+(y*s)+'px,0)';});}
  window.addEventListener('scroll',upd,{passive:true});upd();
}` : ''}
})();`;
}

// ── DESIGN EXPLORATION (multiple directions, evaluated) ───────────────────────
const NX_DIRECTIONS = {
  'minimal-luxury': {
    label: 'A · Minimal Luxury', tone: 'quiet, premium, restrained',
    brand: { visualTone: 'minimal-luxury', primaryColor: '#111827', accentColor: '#c9a35c', neutralBg: '#fbfaf8', neutralFg: '#1f2937', radiusStyle: '4px', motionStyle: 'minimal', shadowStyle: '0 1px 3px rgba(0,0,0,.06)' },
  },
  'futuristic-cinematic': {
    label: 'B · Futuristic Cinematic', tone: 'glide, parallax, depth, motion',
    brand: { visualTone: 'dark-cinematic', primaryColor: '#060912', secondaryColor: '#FF5F00', accentColor: '#5B8DEF', amberColor: '#FFB23E', neutralBg: '#060912', neutralFg: '#EEF2F8', radiusStyle: '14px', motionStyle: 'futuristic', shadowStyle: '0 30px 80px -30px rgba(0,0,0,.9)', headingFont: 'Space Grotesk, Inter, system-ui, sans-serif' },
  },
  'editorial': {
    label: 'C · Editorial', tone: 'serif, structured, magazine',
    brand: { visualTone: 'editorial', primaryColor: '#20150f', accentColor: '#b23a2f', neutralBg: '#fffdf9', neutralFg: '#2a2420', radiusStyle: '0px', motionStyle: 'smooth', shadowStyle: 'none', headingFont: 'Georgia, "Times New Roman", serif' },
  },
  'bold-experimental': {
    label: 'D · Bold Experimental', tone: 'gradients, geometry, energy',
    brand: { visualTone: 'bold', primaryColor: '#3b0a63', accentColor: '#ff3d83', neutralBg: '#14001f', neutralFg: '#ffffff', radiusStyle: '999px', motionStyle: 'energetic', shadowStyle: '0 20px 60px rgba(255,61,131,.22)' },
  },
  'warm-organic': {
    label: 'E · Warm Organic', tone: 'earthy, rounded, welcoming',
    brand: { visualTone: 'organic', primaryColor: '#3f2d20', accentColor: '#e07a3f', neutralBg: '#fdf6ee', neutralFg: '#3a2c20', radiusStyle: '999px', motionStyle: 'playful', shadowStyle: '0 16px 40px rgba(224,122,63,.12)' },
  },
  'tech-saas': {
    label: 'F · Tech SaaS', tone: 'clean, trustworthy, functional',
    brand: { visualTone: 'saas', primaryColor: '#0a1638', accentColor: '#3b82f6', neutralBg: '#ffffff', neutralFg: '#141433', radiusStyle: '12px', motionStyle: 'smooth', shadowStyle: '0 10px 30px rgba(10,22,56,.10)' },
  },
};
function nxForeground({ v }) { return v; }
// Score how well a direction matches a brief's keywords (deterministic, 0–100).
function nxDirectionFit(brief, direction) {
  const b = String(brief || '').toLowerCase();
  const d = NX_DIRECTIONS[direction];
  if (!d) return 0;
  // Base 40 (every valid direction is at least viable), then +16 per brief
  // keyword that the direction's tone group matches. A matched direction always
  // outranks an unmatched one.
  let score = 40;
  const w = {
    luxury: ['luxury', 'premium', 'elegant', 'high-end', 'expensive', 'fine', 'boutique', 'brand'],
    minimal: ['minimal', 'minimalist', 'clean', 'simple', 'airy', 'quiet', 'white', 'space'],
    futuristic: ['future', 'futuristic', 'tech', 'cinematic', 'modern', 'ai', '3d', 'sci-fi', 'neon', 'motion'],
    editorial: ['editorial', 'magazine', 'serif', 'elegant', 'news', 'story', 'journal'],
    bold: ['bold', 'loud', 'vibrant', 'energetic', 'colorful', 'creative', 'playful', 'fun', 'gradient'],
    organic: ['organic', 'warm', 'friendly', 'earthy', 'natural', 'welcoming', 'soft'],
    saas: ['saas', 'software', 'app', 'startup', 'b2b', 'product', 'professional', 'dashboard'],
  };
  // Match a keyword group against the direction's FULL identity, not just
  // `visualTone`. Relying on visualTone alone silently broke directions whose
  // tone label doesn't literally contain its group name (e.g.
  // futuristic-cinematic → visualTone "dark-cinematic" never matched the
  // "futuristic" group, so a clearly futuristic brief ranked it last).
  const identity = [direction, d.tone, d.brand.visualTone].join(' ').toLowerCase();
  // Extra aliases let a group be recognised from equivalent vocabulary.
  const groupAliases = {
    luxury: ['luxury', 'premium'],
    minimal: ['minimal'],
    futuristic: ['futuristic', 'cinematic', 'sci-fi', 'neon', 'parallax', 'depth'],
    editorial: ['editorial', 'magazine', 'serif'],
    bold: ['bold', 'experimental', 'energy', 'gradients'],
    organic: ['organic', 'warm', 'earthy'],
    saas: ['saas', 'tech', 'clean', 'functional'],
  };
  for (const [group, words] of Object.entries(w)) {
    const aliases = groupAliases[group] || [group];
    const matchesGroup = aliases.some((a) => identity.indexOf(a) !== -1);
    if (matchesGroup) for (const word of words) if (b.includes(word)) score += 16;
  }
  return Math.min(100, score);
}
// Propose N distinct directions, sorted by fit.
function nxExplore(brief, n) {
  const count = Math.max(1, Math.min(n || 4, Object.keys(NX_DIRECTIONS).length));
  const scored = Object.keys(NX_DIRECTIONS).map((k) => ({
    id: k, label: NX_DIRECTIONS[k].label, tone: NX_DIRECTIONS[k].tone,
    fit: nxDirectionFit(brief, k), brand: NX_DIRECTIONS[k].brand,
  })).sort((a, b) => b.fit - a.fit);
  return scored.slice(0, count);
}

// ── DESIGN QA (judges BEAUTY, distinct from Engineering QA) ───────────────────
// Categories: composition, hierarchy, typography, spacing, balance, contrast,
// consistency, rhythm, brand, motion. Deterministic + testable.
function _count(re, s) { return (String(s).match(re) || []).length; }
function nxDesignQA(input) {
  const html = typeof input === 'string' ? input : (input && input.__html) || '';
  const analysis = { html };
  // ── hierarchy ──
  const h1 = _count(/<h1\b/gi, html);
  const h2 = _count(/<h2\b/gi, html);
  const h3 = _count(/<h3\b/gi, html);
  const heads = [...String(html).matchAll(/<h([1-6])\b/gi)].map(m => +m[1]);
  let orderOk = true;
  for (let i = 1; i < heads.length; i++) if (heads[i] < heads[i - 1]) { orderOk = false; break; }
  const hierarchyScore = (h1 >= 1 && h2 >= 1 ? 60 : (h1 >= 1 ? 40 : 10)) + (h1 >= 1 ? 20 : 0) + (orderOk ? 20 : 0);
  // ── typography ──
  const fonts = _count(/font-family\s*:/gi, html);
  const distinctFonts = new Set((String(html).match(/font-family:\s*([^;}{]+)/gi) || []).map(m => m.replace(/^font-family:\s*/i, '').trim())).size;
  const typographyScore = (fonts ? 40 : 0) + (distinctFonts > 0 && distinctFonts <= 2 ? 40 : (distinctFonts > 2 ? 15 : 0)) + (h1 || h2 ? 20 : 0);
  // ── composition / structure ──
  const sections = _count(/class="[^"]*\bnx-section\b|<\s*section\b/gi, html);
  const gridOrFlex = _count(/display\s*:\s*(grid|flex)/gi, html);
  const mediaQueries = _count(/@media\b/gi, html);
  // Composition credit must reflect SUBSTANCE, not the mere presence of markers:
  // 30 empty <section> tags and a repeated "display:grid" string used to score the
  // same as a real layout, so an empty page could be gamed upward ~30 points.
  const __textOnly = String(html).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').trim();
  const __words = __textOnly ? __textOnly.split(/\s+/).filter(Boolean).length : 0;
  // A page with no real copy has no composition to judge, whatever markup it emits.
  const __hasSubstance = __words >= 25 && (h1 + h2 + h3) > 0;
  const compositionScore = !__hasSubstance ? Math.min(20, (sections ? 10 : 0) + (gridOrFlex ? 5 : 0) + (mediaQueries ? 5 : 0))
    : (sections ? 30 : 0) + (gridOrFlex ? 35 : 0) + (mediaQueries ? 35 : 0) + (h1 ? 10 : 0);
  // ── spacing / rhythm ──
  const cssVars = _count(/--[a-z-]+\s*:/i, html);
  const paddings = _count(/padding\s*:/gi, html);
  const radiusCount = _count(/border-radius:/gi, html);
  const distinctRadius = new Set((String(html).match(/border-radius:\s*([^;}{]+)/gi) || []).map(m => m.replace(/^border-radius:\s*/i, '')).map(v => v.replace(/^0px|0\b/, '0'))).size;
  const spacingScore = (cssVars ? 25 : 0) + (paddings ? 25 : 0) + (radiusCount ? 15 : 0) + (distinctRadius <= 3 ? 35 : (distinctRadius <= 5 ? 25 : 10));
  // ── balance ──
  const imgs = _count(/<img\b/gi, html);
  const balanceScore = (sections >= 3 ? 30 : 0) + ((imgs && sections) ? 30 : 0) + (gridOrFlex ? 30 : 0);
  // ── contrast (real WCAG ratio between dominant fg & bg) ──
  // Theme-aware: prefer the actual --nx-bg / --nx-fg (or --nx-primary) tokens that
  // the compiler emits, so a DARK theme (dark bg + light text) is scored correctly
  // instead of being misread as "first dark hex = text." Fall back to the most
  // dominant declared background + inherited foreground.
  const colors = [...new Set((String(html).match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi) || []).map(c => expandHex(c)))];
  const tokenBg = (String(html).match(/--nx-(bg|background)\s*:\s*([^;}\s]+)/i) || [])[2];
  const tokenFg = (String(html).match(/--nx-(fg|foreground)\s*:\s*([^;}\s]+)/i) || [])[2];
  const primaryToken = (String(html).match(/--nx-(primary|primary-color)\s*:\s*([^;}\s]+)/i) || [])[2];
  let fgC = null, bgC = null;
  if (tokenFg && isHex(tokenFg)) fgC = expandHex(tokenFg);
  if (tokenBg && isHex(tokenBg)) bgC = expandHex(tokenBg);
  if (!fgC && primaryToken && isHex(primaryToken)) fgC = expandHex(primaryToken);
  if (!bgC) bgC = colors.find(c => c && isHex(c) && _lum(c) > 0.75) || '#ffffff';
  if (!fgC) fgC = colors.find(c => c && isHex(c) && _lum(c) < 0.5) || '#111111';
  const contrast = (fgC && bgC) ? contrastRatio(fgC, bgC) : 0;
  const contrastScore = contrast >= 4.5 ? 100 : contrast >= 3 ? 60 : contrast > 0 ? 30 : 0;
  // ── consistency / brand coherence ──
  const consistencyScore = (distinctFonts <= 2 ? 40 : 15) + (distinctRadius <= 3 ? 30 : 12) + (cssVars ? 30 : 8);
  // ── motion ──
  const hasAnim = /@keyframes|animation\s*:|transition\s*:/i.test(html);
  const reducedMotion = /prefers-reduced-motion/i.test(html);
  const nxVe = /nx-ve-enter|is-in/.test(html);
  const motionScore = (nxVe ? 55 : (hasAnim ? 40 : 0)) + (reducedMotion ? 30 : 0) + (hasAnim ? 25 : 0);
  const score = Math.round((hierarchyScore * 0.15 + typographyScore * 0.15 + compositionScore * 0.18 + spacingScore * 0.12 + balanceScore * 0.1 + contrastScore * 0.12 + consistencyScore * 0.1 + motionScore * 0.08));
  const clamp = (x) => Math.max(0, Math.min(100, x));
  const cats = {
    composition: { score: clamp(compositionScore), weight: 0.18 },
    hierarchy: { score: clamp(hierarchyScore), weight: 0.15 },
    typography: { score: clamp(typographyScore), weight: 0.15 },
    spacing: { score: clamp(spacingScore), weight: 0.12 },
    balance: { score: clamp(balanceScore), weight: 0.10 },
    contrast: { score: clamp(contrastScore), weight: 0.12 },
    consistency: { score: clamp(consistencyScore), weight: 0.10 },
    motion: { score: clamp(motionScore), weight: 0.08 },
  };
  const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : score < 45 ? 'F' : 'D';
  const issues = [];
  if (h1 === 0) issues.push({ severity: 'high', category: 'hierarchy', message: 'no <h1> — open with a headline' });
  if (h1 > 1) issues.push({ severity: 'medium', category: 'hierarchy', message: 'multiple <h1> — use one de facto headline' });
  if (!orderOk) issues.push({ severity: 'medium', category: 'hierarchy', message: 'heading levels skip / jump out of order' });
  if (distinctFonts > 2) issues.push({ severity: 'medium', category: 'typography', message: 'too many font families — keep ≤2' });
  if (contrast < 4.5 && contrast > 0) issues.push({ severity: 'high', category: 'contrast', message: `fg/bg contrast ${contrast.toFixed(2)}:1 below 4.5:1` });
  if (!mediaQueries) issues.push({ severity: 'medium', category: 'composition', message: 'no responsive breakpoints' });
  if (!reducedMotion && (hasAnim || nxVe)) issues.push({ severity: 'medium', category: 'motion', message: 'add prefers-reduced-motion' });
  return { score, grade, categories: cats, issues, metrics: { h1, h2, h3, distinctFonts, contrast: +contrast.toFixed(2), sections, mediaQueries, hasMotion: !!hasAnim || nxVe } };
}

// ── BIDIRECTIONAL: Project Graph ◄─► Code ──────────────────────────────────────
function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _escAttr(s) { return _esc(s).replace(/'/g, '&#39;'); }

const NX_SECTION_TITLES = { hero: 'Welcome', features: 'What we do', pricing: 'Pricing', testimonials: 'What clients say', cta: 'Get started', footer: '', nav: '' };

// Deterministic: Project Graph → { html, css, js }.
function nxProjectToCode(project) {
  const b = nxMergeBrand(NX_BRAND_DEFAULTS, project.brand || {});
  const parts = [];
  let main = '';
  for (const id of project.order) {
    const n = project.nodes[id];
    if (!n) continue;
    if (n.kind === 'nav') main += nxComponentToHtml(n, b);
    else main += nxComponentToHtml(n, b);
  }
  const css = nxTokensToCss(b) + '\n' + nxComponentCss(b) + '\n' + nxMotionToCss(b.motionStyle);
  const js = nxMotionToJs(b.motionStyle);
  return {
    html: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${_escAttr(project.name)}</title><style>${css}</style></head><body>${main}<script>${js}<\/script></body></html>`,
    css, js,
  };
}
function nxComponentCss(b) {
  return `.nx-container{max-width:${b.maxWidth};margin:0 auto;padding:0 clamp(1rem,4vw,2rem)}
.nx-section{padding:clamp(3.5rem,6vw,6rem) 0}
.nx-hero{display:grid;gap:2rem;align-items:center}
.nx-hero h1{font-family:${b.headingFont};font-size:clamp(2.2rem,5vw,4rem);line-height:1.05;letter-spacing:-.02em;margin:0 0 1rem;color:${b.primaryColor}}
.nx-hero p{font-family:${b.bodyFont};font-size:clamp(1rem,1.6vw,1.2rem);color:${b.neutralFg};max-width:44ch}
.nx-btn{display:inline-flex;align-items:center;justify-content:center;padding:.85rem 1.6rem;border-radius:${b.radiusStyle};font-family:${b.bodyFont};font-weight:600;border:none;cursor:pointer;text-decoration:none;background:${b.primaryColor};color:${b.neutralBg};box-shadow:${b.shadowStyle}}
.nx-btn--accent{background:${b.accentColor}}
.nx-grid{display:grid;gap:1.5rem}
.nx-card{background:${b.neutralBg};border:1px solid rgba(0,0,0,.06);border-radius:${b.radiusStyle};padding:1.6rem;box-shadow:${b.shadowStyle}}
.nx-card h3{font-family:${b.headingFont};margin:0 0 .5rem;color:${b.primaryColor}}
.nx-muted{color:${b.neutralFg};opacity:.75}
.nx-foot{border-top:1px solid rgba(0,0,0,.08);padding:2rem 0;font-family:${b.bodyFont}}
`;
}
function nxComponentToHtml(node, b) {
  const n = node;
  const k = n.kind;
  const cols = n.structure && n.structure.columns;
  const gridStyle = (typeof cols === 'number' && cols > 1) ? ` style="grid-template-columns:repeat(${cols},1fr)"` : '';
  const enter = `.nx-ve-enter`;
  const base = (b.motionStyle === 'none') ? '' : ' nx-ve-enter';
  if (k === 'nav') {
    return `<nav class="nx-container nx-section nx-ve-enter" style="padding-block:1rem"><strong>${_escAttr(n.content.brand || 'Brand')}</strong><span class="nx-muted">${_escAttr(n.content.links ? n.content.links.join(' · ') : '')}</span></nav>`;
  }
  if (k === 'hero') {
    const h = n.content.headline || NX_SECTION_TITLES.hero;
    const sub = n.content.sub || '';
    const cta = n.content.cta || 'Get started';
    return `<section class="nx-section nx-hero nx-container${base}"><div><h1>${_esc(h)}</h1>${sub ? `<p>${_esc(sub)}</p>` : ''}<button class="nx-btn nx-btn--accent nx-ve-hover">${_esc(cta)}</button></div></section>`;
  }
  if (k === 'features') {
    const items = (n.content.items || []).slice(0, 6).map(item => `<div class="nx-card${base} nx-ve-hover"><h3>${_esc(item.title || '')}</h3><p class="nx-muted">${_esc(item.text || '')}</p></div>`).join('');
    return `<section class="nx-section nx-container"><h2>${_esc(n.content.heading || NX_SECTION_TITLES.features)}</h2><div class="nx-grid${gridStyle}">${items}</div></section>`;
  }
  if (k === 'pricing') {
    const tiers = (n.content.tiers || []).slice(0, 3).map((t, i) => {
      const highlight = n.structure.highlight === 'middle' && i === 1 ? ' style="outline:2px solid ' + b.accentColor + '"' : '';
      return `<div class="nx-card${base} nx-ve-hover"${highlight}><h3>${_esc(t.name || 'Plan')}</h3><p class="nx-muted">${_esc(t.price || '')}</p><button class="nx-btn">${_esc(t.cta || 'Choose')}</button></div>`;
    }).join('');
    return `<section class="nx-section nx-container"><h2>${_esc(n.content.heading || NX_SECTION_TITLES.pricing)}</h2><div class="nx-grid${gridStyle}">${tiers}</div></section>`;
  }
  if (k === 'testimonials') {
    const items = (n.content.items || []).slice(0, 3).map(item => `<div class="nx-card${base}"><p>"${_esc(item.quote || '')}"</p><p class="nx-muted">— ${_esc(item.author || '')}</p></div>`).join('');
    return `<section class="nx-section nx-container"><h2>${_esc(n.content.heading || NX_SECTION_TITLES.testimonials)}</h2><div class="nx-grid${gridStyle}">${items}</div></section>`;
  }
  if (k === 'cta') {
    return `<section class="nx-section nx-container"><div class="nx-card${base} nx-ve-enter" style="text-align:center"><h2>${_esc(n.content.heading || NX_SECTION_TITLES.cta)}</h2>${n.content.sub ? `<p class="nx-muted">${_esc(n.content.sub)}</p>` : ''}<button class="nx-btn nx-btn--accent nx-ve-hover">${_esc(n.content.cta || 'Get started')}</button></div></section>`;
  }
  if (k === 'footer') {
    return `<footer class="nx-foot nx-container${base}"><span>${_escAttr(n.content.name || '© ' + new Date().getFullYear() + ' ' + project_name(n))}</span><span class="nx-muted">${_escAttr(n.content.legal || '')}</span></footer>`;
  }
  return `<section class="nx-section nx-container${base}"><p>${_esc((n.content.text || ''))}</p></section>`;
}
function project_name(n) { return (n && n.content && n.content.name) || 'Your Company'; }
// Add a tiny accessor so `project_name` doesn't need the project object.
nxProjectToCode.__doc = 'Deterministic renderer: Project Graph → {html,css,js}';

// Best-effort: Code → Project Graph. Honest — this is a *partial* round-trip that
// recovers tokens + components for the structures the renderer emits.
function nxCodeToProject(html) {
  const s = String(html || '');
  const brand = nxBrandFromSite(s);
  const project = nxProject({ name: (s.match(/<title>([^<]*)<\/title>/i) || [])[1] || 'Imported', brand });
  const add = (kind, content, structure) => nxProjectAddComponent(project, nxNode(kind, { variant: 'imported', content, structure }));
  if (/\bnx-hero\b/i.test(s)) add('hero', { headline: (s.match(/<h1[^>]*>([^<]*)<\/h1>/i) || [])[1] || 'Welcome', sub: (s.match(/nx-hero[^>]*>[\s\S]*?<p[^>]*>([^<]*)<\/p>/i) || [])[1] || '' });
  else add('hero', { headline: 'Welcome' });
  const cards = [...s.matchAll(/<div class="nx-card[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([^<]*)<\/h3>/gi)].map(m => ({ title: m[1] }));
  if (cards.length) add('features', { heading: 'What we do', items: cards });
  add('footer', { name: project.name });
  return project;
}

// ── module / window export ─────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NX_BRAND_DEFAULTS, NX_COMPONENTS, NX_MOTION_RECIPES, NX_MOTION_MOODS, NX_DIRECTIONS,
    expandHex, contrastRatio, isHex,
    nxTokensToCss, nxMergeBrand, nxBrandFromSite, nxTokensValidate,
    nxNode, nxProject, nxProjectAddComponent, nxProjectValidate,
    nxListComponents, nxComponentVariants, nxBuildComponent,
    nxMotionMood, nxMotionCompose, nxMotionToCss, nxMotionToJs,
    nxDirectionFit, nxExplore,
    nxDesignQA,
    nxProjectToCode, nxCodeToProject, nxComponentToHtml, nxComponentCss,
  };
}
if (typeof window !== 'undefined') {
  window.contrastRatio = contrastRatio; window.expandHex = expandHex; window.isHex = isHex;
  window.nxTokensToCss = nxTokensToCss; window.nxMergeBrand = nxMergeBrand; window.nxBrandFromSite = nxBrandFromSite;
  window.nxTokensValidate = nxTokensValidate; window.nxNode = nxNode; window.nxProject = nxProject;
  window.nxProjectAddComponent = nxProjectAddComponent; window.nxProjectValidate = nxProjectValidate;
  window.nxListComponents = nxListComponents; window.nxComponentVariants = nxComponentVariants; window.nxBuildComponent = nxBuildComponent;
  window.nxMotionMood = nxMotionMood; window.nxMotionCompose = nxMotionCompose; window.nxMotionToCss = nxMotionToCss; window.nxMotionToJs = nxMotionToJs;
  window.nxDirectionFit = nxDirectionFit; window.nxExplore = nxExplore; window.nxDesignQA = nxDesignQA;
  window.nxProjectToCode = nxProjectToCode; window.nxCodeToProject = nxCodeToProject; window.nxComponentToHtml = nxComponentToHtml;
  window.NX_COMPONENTS = NX_COMPONENTS; window.NX_MOTION_RECIPES = NX_MOTION_RECIPES; window.NX_DIRECTIONS = NX_DIRECTIONS;
}
