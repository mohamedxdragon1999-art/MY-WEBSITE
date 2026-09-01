// nx_structured.js — STRUCTURAL ANALYSIS of a rendered composed page (Cycle 2).
//
// The direction-distinctness rule is: two directions are "genuinely different"
// only when their RENDERED COMPOSITION differs — DOM hierarchy, layout structure,
// typography scale, section rhythm, section ordering, density, surface treatment.
// A color/radius/font-family-only change is a FAILED direction. This module
// extracts a STRUCTURAL SIGNATURE from rendered HTML so tests can measure real
// composition distance rather than trusting string diffs (which would be fooled
// by a palette swap and by CSS class definitions that always appear).

import { JSDOM } from 'jsdom';

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
  [['display', /\.c-display\{[^}]*font-size:([^;]+)/], ['hero', /\.c-lead\{[^}]*font-size:([^;]+)/], ['section', /\.c-sec-title\{[^}]*font-size:([^;]+)/], ['body', /\.c-body\{[^}]*font-size:([^;]+)/], ['caption', /\.c-kicker\{[^}]*font-size:([^;]+)/], ['btn', /\.c-btn\{[^}]*font-size:([^;]+)/]].forEach(([k, re]) => { const mm = css.match(re); if (mm) scale[k] = mm[1].trim(); });
  return { vars, scale };
}

function clampNum(v) {
  const m = String(v || '').match(/clamp\(([^,]+),([^,]+),([^)]+)\)/);
  if (m) return clampNum(m[1]) * 0.3 + clampNum(m[2]) * 0.4 + clampNum(m[3]) * 0.3;
  const n = parseFloat(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function num(v) { const n = parseFloat(String(v).replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : 0; }

// Top-level section order from the DOM body (real rendered structure, not CSS).
function sectionOrder(body) {
  const order = [];
  body.querySelectorAll('body > .c-page > *').forEach(el => {
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
export function nxStructuralSignature(html) {
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
    sectionCount: body.querySelectorAll('body > .c-page > *').length,
  };
}

// Distance between two signatures, on a 0..1 scale where 1 = structurally unrelated.
export function nxSignatureDistance(a, b) {
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
export function nxPaletteOnly(fullHtml) {
  const dom = new JSDOM(fullHtml);
  const body = dom.window.document.body;
  const css = parseCSSVars(fullHtml);
  // A clone that differs ONLY in palette: preserve structure, swap colors.
  const clone = fullHtml
    .replace(/--bg:[^;]+;/, '--bg:#000000;')
    .replace(/--accent:[^;]+;/, '--accent:#ff00ff;');
  return nxStructuralSignature(clone);
}
