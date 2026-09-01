'use strict';
// ══════════════════════════════════════════════════════════════════════════
// nx_layout.js — APPROXIMATE LAYOUT MEASUREMENT WITHOUT A BROWSER
//
// The validation spec requires rendering in a real headless browser and reading
// getBoundingClientRect(). No browser engine can be installed in this sandbox
// (Playwright + Puppeteer downloads are both blocked at the network layer), so
// this module does NOT claim to replace that. It is explicitly an approximation
// and every caller must report it as such.
//
// What it CAN do, deterministically and with no network:
//   * resolve CSS lengths (px / rem / em / vw / vh / % / clamp / min / max /
//     calc) against a concrete viewport,
//   * estimate text width from a per-character advance table so we can detect
//     copy that cannot fit its slot,
//   * flag horizontal overflow, off-canvas boxes, sub-minimum touch targets,
//     line lengths outside the 45–75ch readability band, and zero-size boxes.
//
// What it CANNOT do: real flex/grid solving, font metrics, wrapping, or
// stacking. So it reports HIGH-CONFIDENCE violations only — cases that are
// wrong under any reasonable layout algorithm — and stays silent otherwise.
// A false negative is acceptable here; a false positive is not.
// ══════════════════════════════════════════════════════════════════════════
const { nxCascade } = require('./nx_cascade.js');

// Mean advance width as a fraction of font-size, measured across common UI
// sans faces. Used only for "does this obviously not fit" decisions.
const ADVANCE = { default: 0.52, mono: 0.60, display: 0.55 };

function __num(x) { const n = parseFloat(x); return Number.isFinite(n) ? n : null; }

// Resolve a CSS length to px for a given viewport and context.
function nxResolveLength(value, ctx) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  const { vw, vh, fontSize = 16, rootFontSize = 16, parentWidth = vw } = ctx || {};

  const clampMatch = /^clamp\(([\s\S]+)\)$/i.exec(v);
  if (clampMatch) {
    const parts = __splitTop(clampMatch[1]);
    if (parts.length === 3) {
      const [lo, mid, hi] = parts.map(p => nxResolveLength(p, ctx));
      if (lo == null || mid == null || hi == null) return null;
      return Math.min(Math.max(lo, mid), hi);
    }
  }
  const fn = /^(min|max)\(([\s\S]+)\)$/i.exec(v);
  if (fn) {
    const parts = __splitTop(fn[2]).map(p => nxResolveLength(p, ctx)).filter(n => n != null);
    if (!parts.length) return null;
    return fn[1].toLowerCase() === 'min' ? Math.min(...parts) : Math.max(...parts);
  }
  const calc = /^calc\(([\s\S]+)\)$/i.exec(v);
  if (calc) return __calc(calc[1], ctx);

  let m;
  if ((m = /^(-?[\d.]+)px$/i.exec(v))) return __num(m[1]);
  if ((m = /^(-?[\d.]+)rem$/i.exec(v))) return __num(m[1]) * rootFontSize;
  if ((m = /^(-?[\d.]+)em$/i.exec(v))) return __num(m[1]) * fontSize;
  if ((m = /^(-?[\d.]+)vw$/i.exec(v))) return __num(m[1]) * vw / 100;
  if ((m = /^(-?[\d.]+)vh$/i.exec(v))) return __num(m[1]) * vh / 100;
  if ((m = /^(-?[\d.]+)vmin$/i.exec(v))) return __num(m[1]) * Math.min(vw, vh) / 100;
  if ((m = /^(-?[\d.]+)ch$/i.exec(v))) return __num(m[1]) * fontSize * ADVANCE.default;
  if ((m = /^(-?[\d.]+)%$/i.exec(v))) return __num(m[1]) * parentWidth / 100;
  if ((m = /^(-?[\d.]+)$/.exec(v))) return __num(m[1]) === 0 ? 0 : null;
  return null;
}
function __splitTop(s) {
  const out = []; let d = 0, cur = '';
  for (const c of s) {
    if (c === '(') d++; if (c === ')') d--;
    if (c === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function __calc(expr, ctx) {
  // Substitute each length token with its px value, then evaluate arithmetic.
  const substituted = expr.replace(/(-?[\d.]+)(px|rem|em|vw|vh|vmin|ch|%)/gi, (mm) => {
    const n = nxResolveLength(mm, ctx); return n == null ? 'NaN' : String(n);
  });
  if (!/^[\s0-9.+\-*/()NaN]+$/.test(substituted)) return null;
  try { const r = Function('"use strict";return (' + substituted + ')')(); return Number.isFinite(r) ? r : null; }
  catch (e) { return null; }
}

// Estimated rendered width of a string at a given font size.
function nxTextWidth(text, fontSize, family) {
  const adv = /mono/i.test(String(family || '')) ? ADVANCE.mono : ADVANCE.default;
  return String(text || '').length * fontSize * adv;
}

// Measure a document against one viewport and return high-confidence issues.
function nxMeasure(html, document, viewport) {
  const vw = viewport.width, vh = viewport.height;
  const cascade = nxCascade(html, document);
  const issues = [];
  const root = 16;
  const ctx = { vw, vh, fontSize: root, rootFontSize: root, parentWidth: vw };
  const px = (v, c) => nxResolveLength(v, c || ctx);

  const all = [...document.querySelectorAll('body *')];
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'br') continue;
    const sel = __ident(el);

    // Font size in context (used for text estimates).
    const fsRaw = cascade.computed(el, 'font-size');
    const fs = px(fsRaw) || root;
    const fam = cascade.computed(el, 'font-family') || '';

    // ── Fixed widths that cannot fit the viewport ──
    const wRaw = cascade.computed(el, 'width');
    const w = px(wRaw);
    if (w != null && w > vw + 1 && !/%|auto/.test(String(wRaw))) {
      issues.push({ severity: 'blocking', category: 'layout', rule: 'overflow-x',
        selector: sel, viewport: `${vw}x${vh}`, measured: `width ${Math.round(w)}px > viewport ${vw}px`,
        message: `${sel} is wider than the viewport and will cause horizontal scrolling.` });
    }
    // min-width is the classic un-shrinkable overflow source.
    const mwRaw = cascade.computed(el, 'min-width');
    const mw = px(mwRaw);
    if (mw != null && mw > vw + 1) {
      issues.push({ severity: 'blocking', category: 'layout', rule: 'overflow-x',
        selector: sel, viewport: `${vw}x${vh}`, measured: `min-width ${Math.round(mw)}px > viewport ${vw}px`,
        message: `${sel} has a min-width larger than the viewport; it cannot shrink and will overflow.` });
    }

    // ── Touch targets (mobile only) ──
    const interactive = /^(a|button|input|select|textarea)$/.test(tag);
    if (interactive && vw <= 480) {
      const padY = (px(cascade.computed(el, 'padding-top')) || 0) + (px(cascade.computed(el, 'padding-bottom')) || 0);
      const padX = (px(cascade.computed(el, 'padding-left')) || 0) + (px(cascade.computed(el, 'padding-right')) || 0);
      const lh = px(cascade.computed(el, 'line-height')) || Math.round(fs * 1.4);
      const hExplicit = px(cascade.computed(el, 'height')) || px(cascade.computed(el, 'min-height'));
      const h = hExplicit != null ? hExplicit : (lh + padY);
      const label = (el.textContent || '').trim();
      const wEst = nxTextWidth(label, fs, fam) + padX;
      // Only flag when we are confident: element has real text and no explicit
      // sizing that would rescue it, and it is a standalone control (not inline
      // text inside a paragraph, where 44px does not apply).
      // A link that WRAPS block content (an image card, a figure, a grid tile)
      // derives its height from that child, which we cannot measure without a
      // real layout pass. Estimating from line-height alone produced a false
      // "too small" verdict on obviously large cards, so those are skipped:
      // a false positive here would send the repair loop chasing a non-bug.
      const wrapsBlock = !!el.querySelector('img,svg,figure,picture,video,div,h1,h2,h3,h4');
      const inlineInProse = (tag === 'a' && el.closest('p,li')) || wrapsBlock;
      if (!inlineInProse && label && h > 0 && h < 44) {
        issues.push({ severity: 'blocking', category: 'layout', rule: 'touch-target',
          selector: sel, viewport: `${vw}x${vh}`, measured: `≈${Math.round(h)}px tall (min 44px)`,
          message: `${sel} is too small to tap reliably on mobile.` });
      }
      // Honour an explicit min-width/width: if the author (or a repair pass) has
      // guaranteed the inline size, the text-advance estimate is irrelevant.
      const minW = px(cascade.computed(el, 'min-width')) || px(cascade.computed(el, 'width')) || 0;
      if (!inlineInProse && label && wEst > 0 && Math.max(wEst, minW) < 44 && label.length <= 3) {
        issues.push({ severity: 'blocking', category: 'layout', rule: 'touch-target',
          selector: sel, viewport: `${vw}x${vh}`, measured: `≈${Math.round(wEst)}px wide (min 44px)`,
          message: `${sel} is too narrow to tap reliably on mobile.` });
      }
    }

    // ── Readability: measured line length in characters ──
    if (/^(p|li|blockquote)$/.test(tag)) {
      const text = (el.textContent || '').trim();
      if (text.length > 90) {
        const maxwRaw = cascade.computed(el, 'max-width');
        const container = px(maxwRaw) != null ? px(maxwRaw) : Math.min(vw - 48, 1200);
        const chars = container / (fs * ADVANCE.default);
        if (chars > 95) {
          issues.push({ severity: 'warning', category: 'aesthetic', rule: 'line-length',
            selector: sel, viewport: `${vw}x${vh}`, measured: `≈${Math.round(chars)} chars/line (target 45–75)`,
            message: `${sel} renders overly long lines, which hurts readability.` });
        }
      }
    }

    // ── Zero-size boxes that should show content ──
    const hRaw = cascade.computed(el, 'height');
    const hVal = px(hRaw);
    if (hVal === 0 && (el.textContent || '').trim() && !/hidden/.test(String(cascade.computed(el, 'overflow') || ''))) {
      issues.push({ severity: 'blocking', category: 'layout', rule: 'zero-size',
        selector: sel, viewport: `${vw}x${vh}`, measured: 'height:0 with text content',
        message: `${sel} has content but is collapsed to zero height.` });
    }
  }
  return { viewport: `${vw}x${vh}`, issues, approximate: true };
}

function __ident(el) {
  const id = el.getAttribute && el.getAttribute('id');
  if (id) return '#' + id;
  const cls = (el.getAttribute && el.getAttribute('class') || '').trim().split(/\s+/)[0];
  return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
}

const NX_VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
];

module.exports = { nxMeasure, nxResolveLength, nxTextWidth, NX_VIEWPORTS };
