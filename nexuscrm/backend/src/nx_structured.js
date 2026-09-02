// nx_structured.js — STRUCTURAL ANALYSIS of a rendered composed page (Cycle 2).
//
// The direction-distinctness rule is: two directions are "genuinely different"
// only when their RENDERED COMPOSITION differs — DOM hierarchy, layout structure,
// typography scale, section rhythm, section ordering, density, surface treatment.
// A color/radius/font-family-only change is a FAILED direction. This module
// extracts a STRUCTURAL SIGNATURE from rendered HTML so tests can measure real
// composition distance rather than trusting string diffs (which would be fooled
// by a palette swap and by CSS class definitions that always appear).

// Dual module (CJS for backend require + ESM named-import interop).
const { JSDOM } = (typeof module !== 'undefined' && module.exports && require('jsdom')) || {};

// Parse the direction system's custom properties + type scale out of the <style>.
function parseCSSVars(html) {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  let vars = {}, scale = {};
  if (!m) return { vars, scale };
  const css = m[1];
  // :root{--bg:#...;--disp:...;--rad:...}
  const root = css.match(/:root\{([^}]*)\}/);
  if (root) {
    root[1].split(';').forEach(p => {
      const eq = p.indexOf(':');
      if (eq > 0) { const k = p.slice(0, eq).trim(), v = p.slice(eq + 1).trim(); if (k.startsWith('--')) vars[k.slice(2)] = v; }
    });
  }
  // typography scale: font-size declarations on .c-display/.c-sec-title/etc.
  [['display', /\.c-display\{[^}]*font-size:([^;}]+)/], ['hero', /\.c-lead\{[^}]*font-size:([^;}]+)/], ['section', /\.c-sec-title\{[^}]*font-size:([^;}]+)/], ['body', /\.c-body\{[^}]*font-size:([^;}]+)/], ['caption', /\.c-kicker\{[^}]*font-size:([^;}]+)/], ['btn', /\.c-btn\{[^}]*font-size:([^;}]+)/]].forEach(([k, re]) => { const mm = css.match(re); if (mm) scale[k] = mm[1].trim(); });
  return { vars, scale };
}

// Normalise a CSS length to PIXELS. The previous version stripped the unit and
// parsed the bare number, so `1.5rem` measured as 1.5 while the visually
// identical `24px` measured as 24 — a 16x error. Every consumer compares these
// numerically (typeUniformity, signature distance, scale monotonicity), so two
// identical type scales expressed in different units scored 0.455 apart.
const NX_ROOT_PX = 16;      // browser default root font-size
const NX_VW_PX = 1440 / 100; // desktop reference viewport for vw/vmin
function clampNum(v) {
  const str = String(v == null ? '' : v).trim();
  const m = str.match(/clamp\(([^,]+),([^,]+),([^)]+)\)/);
  if (m) return clampNum(m[1]) * 0.3 + clampNum(m[2]) * 0.4 + clampNum(m[3]) * 0.3;
  const num = parseFloat(str);
  if (!Number.isFinite(num)) return 0;
  if (/(?:^|[\d.])r?em\s*$/i.test(str)) return num * NX_ROOT_PX;
  if (/vw\s*$/i.test(str) || /vmin\s*$/i.test(str) || /vh\s*$/i.test(str)) return num * NX_VW_PX;
  if (/%\s*$/.test(str)) return num * NX_ROOT_PX / 100;
  return num;   // px, or a unitless number
}

function num(v) { const n = parseFloat(String(v).replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : 0; }

// Top-level section order from the DOM body (real rendered structure, not CSS).
function sectionOrder(body) {
  const order = [];
  body.querySelectorAll(':scope > .c-page > *:not(.c-main), :scope > .c-page > .c-main > *').forEach(el => {
    const cls = (el.getAttribute('class') || '').split(' ').find(c => c.startsWith('c-'));
    const id = el.id ? '#' + el.id : '';
    order.push((cls || el.tagName.toLowerCase()) + id);
  });
  return order;
}

function heroVariant(body) {
  const hero = body.querySelector('[class*="c-hero"]');
  if (!hero) return null;
  const cls = hero.getAttribute('class') || '';
  if (/c-hero-editorial/.test(cls)) return 'editorial';
  if (/c-hero-fullbleed/.test(cls)) return 'fullbleed';
  if (/c-hero-minimal/.test(cls)) return 'minimal';
  if (/c-hero-overlap/.test(cls)) return 'overlap';
  if (/c-hero-aurora/.test(cls)) return 'aurora';
  if (/c-hero-split/.test(cls)) return 'split';
  return 'generic';
}
function featureVariant(body) {
  const f = body.querySelector('[class*="c-feature"]');
  if (!f) return null;
  const cls = f.getAttribute('class') || '';
  if (/c-feature-edlist/.test(cls)) return 'edlist';
  if (/c-feature-alt/.test(cls)) return 'alternating';
  if (/c-feature-bento/.test(cls)) return 'bento';
  if (/c-feature-split/.test(cls)) return 'split';
  if (/c-feature-ruled/.test(cls)) return 'ruled';
  if (/c-feature-spec/.test(cls)) return 'spec';
  if (/c-feature-grid/.test(cls)) return 'grid';
  return 'generic';
}
function reviewVariant(body) {
  const r = body.querySelector('[class*="c-reviews"]');
  if (!r) return null;
  const cls = r.getAttribute('class') || '';
  if (/c-reviews-single/.test(cls)) return 'single';
  if (/c-reviews-quote/.test(cls)) return 'quote';
  if (/c-reviews-grid/.test(cls)) return 'grid';
  return 'generic';
}

// A compact DOM-shape hash: tags + key classes down to depth 6, order-sensitive.
function domShape(body) {
  const parts = [];
  const walk = (node, d) => {
    if (d > 6) return;
    node.childNodes.forEach(ch => {
      if (ch.nodeType === 1) {
        const cls = (ch.getAttribute('class') || '').split(' ').filter(c => /^(c-|^$)/.test(c)).slice(0, 3).join('.');
        parts.push(ch.tagName.toLowerCase() + (cls ? '.' + cls : ''));
        walk(ch, d + 1);
      }
    });
  };
  walk(body, 0);
  return parts;
}

// Full structural signature — the source of truth for distinctness.
function nxStructuralSignature(html) {
  const dom = new JSDOM(html);
  const body = dom.window.document.body;
  const css = parseCSSVars(html);
  return {
    dir: ((html.match(/data-dir="([^"]+)"/) || [])[1] || ''),
    motion: ((html.match(/data-motion="([^"]+)"/) || [])[1] || ''),
    density: (body.querySelector('[class*="c-page"]') ? (body.querySelector('[class*="c-page"]').getAttribute('data-density') || '') : ''),
    order: sectionOrder(body),
    hero: heroVariant(body),
    feature: featureVariant(body),
    reviews: reviewVariant(body),
    typography: css.scale,
    palette: { bg: css.vars.bg, text: css.vars.text, accent: css.vars.accent, accent2: css.vars.accent2 },
    radius: num(css.vars.rad),
    measure: css.vars.measure,
    shape: domShape(body),
    sectionCount: body.querySelectorAll(':scope > .c-page > *:not(.c-main), :scope > .c-page > .c-main > *').length,
  };
}

// Distance between two signatures, on a 0..1 scale where 1 = structurally unrelated.
function nxSignatureDistance(a, b) {
  let d = 0, n = 0;
  const cmp = (x, y) => { n++; if (x !== y) d++; };
  cmp(a.hero, b.hero); cmp(a.feature, b.feature); cmp(a.reviews, b.reviews);
  cmp(a.motion, b.motion); cmp(a.density, b.density); cmp(a.dir, b.dir);
  // order sequence: Jaccard on ordered list (as string)
  if (a.order.join('|') !== b.order.join('|')) { n++; d++; }
  // typography scale: compare each clamp/px value with tolerance
  const keys = Object.keys(a.typography).filter(k => b.typography[k]);
  keys.forEach(k => { n++; if (Math.abs(clampNum(a.typography[k]) - clampNum(b.typography[k])) > 3) d++; });
  // measure
  if (a.measure !== b.measure) { n++; d++; }
  // shape similarity (set of structural fragments)
  const sa = new Set(a.shape), sb = new Set(b.shape);
  let inter = 0; sa.forEach(s => { if (sb.has(s)) inter++; });
  const unionSize = Math.max(1, sa.size + sb.size - inter);
  const shapeSim = inter / unionSize; // 1 = identical
  n++; d += (1 - shapeSim);
  return n ? d / n : 0;
}

// Feature-flag check: a "color-only clone" should be far LESS distinct than a real
// direction change. Expose the palette-only signature of a given signature.
function nxPaletteOnly(fullHtml) {
  const dom = new JSDOM(fullHtml);
  const body = dom.window.document.body;
  const css = parseCSSVars(fullHtml);
  // A clone that differs ONLY in palette: preserve structure, swap colors.
  const clone = fullHtml
    .replace(/--bg:[^;]+;/, '--bg:#000000;')
    .replace(/--accent:[^;]+;/, '--accent:#ff00ff;');
  return nxStructuralSignature(clone);
}

// Visual repetition model (§14) + card-dependency metric (§11).
// Consistency is good; mechanical repetition is bad. We measure:
//  - cardDependency: fraction of content blocks rendered as cards (card-soup).
//  - layoutDistinctness: how many distinct layout modes are actually used.
//  - rhythmVariety: how many distinct spacing beats appear.
//  - componentDiversity: distinct top-level component families.
//  - monotony: composite 0..1 (high = monotonous / repetitive).
function nxRepetitionModel(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const sections = [...doc.querySelectorAll('body > .c-page > *:not(.c-main), body > .c-page > .c-main > *')];
  const comp = {};
  sections.forEach((s) => { const cls = (s.getAttribute('class') || '').split(' ').find((c) => c.startsWith('c-')); if (cls) comp[cls] = (comp[cls] || 0) + 1; });
  const families = Object.keys(comp);
  const componentDiversity = families.length;
  // card dependency: cards/reviews vs. all content-representational blocks
  const cards = doc.querySelectorAll('.c-card, .c-review').length;
  const blocks = doc.querySelectorAll('.c-card, .c-review, .c-edrow, .c-altrow, .c-work-item, .c-quote, .c-bento-cell, .c-split-item, .c-metric, .c-ruled-cell').length;
  const cardDependency = blocks ? cards / blocks : 0;
  // layout distinctness among section layout modes
  const modes = new Set();
  sections.forEach((s) => { const c = s.getAttribute('class') || ''; const m = c.match(/c-(ruled|grid|bento|work-grid|reviewGrid|metrics-grid|edlist|altlist|split|story|hero-[a-z]+)/); if (m) modes.add(m[1]); });
  const layoutDistinctness = Math.min(1, modes.size / 5);
  // rhythm variety
  const rhythms = new Set([...doc.querySelectorAll('[data-rhythm]')].map((e) => e.getAttribute('data-rhythm')));
  const rhythmVariety = Math.min(1, rhythms.size / 4);
  const monotony = Math.round((cardDependency * 0.4 + (1 - layoutDistinctness) * 0.25 + (1 - rhythmVariety) * 0.2 + (componentDiversity <= 3 ? 0.15 : 0) ) * 100);
  return {
    cardDependency: +cardDependency.toFixed(3), layoutDistinctness: +layoutDistinctness.toFixed(3),
    rhythmVariety: +rhythmVariety.toFixed(3), componentDiversity, monotony,
  };
}

function lum(hex) { const m = String(hex || '').replace('#', ''); if (m.length < 6) return 0.05; const r = parseInt(m.slice(0, 2), 16) / 255, g = parseInt(m.slice(2, 4), 16) / 255, b = parseInt(m.slice(4, 6), 16) / 255; const f = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function contrastRatio(a, b) { const L1 = Math.max(lum(a), lum(b)), L2 = Math.min(lum(a), lum(b)); return (L1 + 0.05) / (L2 + 0.05); }

// Full rendered-design report for the visual quality loop (measured on output).
function nxRenderedDesignReport(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const css = parseCSSVars(html);
  const rep = nxRepetitionModel(html);
  const keys = ['display', 'hero', 'section', 'body', 'caption', 'btn'];
  const sizes = keys.map((k) => clampNum(css.scale[k])).filter((v) => v > 0);
  const spread = sizes.length ? Math.max(...sizes) - Math.min(...sizes) : 0;
  const typeUniformity = spread < 4 ? 1 : Math.max(0, 1 - spread / 40);
  const emph = [...doc.querySelectorAll('[data-emphasis]')].map((e) => e.getAttribute('data-emphasis'));
  const emphasisAllMax = emph.length > 0 && emph.every((v) => v === 'max');
  const contrast = contrastRatio(css.vars.accent, css.vars.text);
  return {
    monotony: rep.monotony, cardDependency: rep.cardDependency, layoutDistinctness: rep.layoutDistinctness,
    rhythmVariety: rep.rhythmVariety, componentDiversity: rep.componentDiversity,
    typeUniformity: +typeUniformity.toFixed(3), emphasisAllMax, contrast: +contrast.toFixed(2),
    emphasisTiers: new Set(emph).size, hero: ((html.match(/data-dir="([^"]+)"/) || [])[1] || ''),
    sectionCount: doc.querySelectorAll('body > .c-page > *:not(.c-main), body > .c-page > .c-main > *').length,
  };
}

const nx_structured_api = { nxStructuralSignature, nxSignatureDistance, nxPaletteOnly, nxRepetitionModel, nxRenderedDesignReport, parseCSSVars, clampNum };
if (typeof module !== 'undefined' && module.exports) module.exports = nx_structured_api;
if (typeof globalThis !== 'undefined') globalThis.NX_STRUCTURED = nx_structured_api;
