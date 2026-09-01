// nx_evidence.js — REAL BROWSER VISUAL EVIDENCE (Phase 1)
//
//   Project Graph → nxRenderDocument (compiled HTML) → Browser (headless Chromium)
//     → full-page screenshot + computed DOM geometry + accessibility snapshot
//       + computed styles + console/page/network errors
//         → structured Visual Evidence → evidence-backed QA
//
// The graph is the source of truth, the browser is the execution surface; this
// module turns a rendered page into FACTS (not heuristics) keyed by `data-nx-id`.
//
// HONESTY RULE: if a real browser (Playwright + Chromium) is not available, every
// function returns { available:false, reason } and NEVER fakes geometry or
// screenshots. We never claim pixel-level QA unless a real render produced it.
//
// CommonJS module (lazy-loads Playwright via require). Node-side tool only.

// ── Lazy Playwright loader (never throws at import time) ──────────────────────
let _pw = null, _pwTried = false;
function _playwright() {
  if (_pwTried) return _pw;
  _pwTried = true;
  try { _pw = require('playwright').chromium || null; } catch (e) { _pw = null; }
  return _pw;
}

const VIEWPORTS = { desktop: 1280, tablet: 768, mobile: 390 };

// Detect whether a real browser can actually launch (and render). Returns a reason
// string on failure so callers can truthfully report "unavailable", never fake it.
async function nxBrowserAvailable() {
  const chromium = _playwright();
  if (!chromium) return { available: false, reason: 'playwright not installed' };
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setContent('<!DOCTYPE html><html><body>ok</body></html>');
    await browser.close();
    return { available: true, backend: 'browser' };
  } catch (e) {
    if (browser) try { await browser.close(); } catch {}
    return { available: false, reason: 'browser launch failed: ' + (e && e.message) };
  }
}

// Extract per-node computed geometry + computed styles + accessibility metadata
// for every `[data-nx-id]` element, from the LIVE browser. Real measurement.
function __collectNodesScript() {
  return `(function(){
    var out = [], els = document.querySelectorAll('[data-nx-id]');
    var VPW = window.innerWidth, VPH = window.innerHeight;
    for (var i=0;i<els.length;i++){
      var el = els[i], id = el.getAttribute('data-nx-id'); if (!id) continue;
      var r = el.getBoundingClientRect(), cs = window.getComputedStyle(el);
    // Parse a computed backgroundColor into {r,g,b,a} (a in 0..1). Returns null for nothing.
    function _parts(bg){
      if (!bg || bg === 'transparent') return null;
      var o = bg.indexOf('('); if (o < 0) return null;
      var c = bg.indexOf(')', o); if (c < 0) c = bg.length;
      var inner = bg.slice(o + 1, c);
      var p = inner.split(',').map(function(x){ return parseFloat(x); });
      if (p.length < 3 || isNaN(p[0])) return null;
      return { r: p[0], g: p[1], b: p[2], a: p.length >= 4 ? p[3] : 1 };
    }
    // Compose the EFFECTIVE background behind an element: repeatedly composite the
    // element's bg over the bg of the layer(s) behind until fully opaque (or hit
    // the body). This is what text actually renders on, so contrast is correct
    // even over translucent tints (e.g. a 10% orange glow over the dark body).
    function _resolvedBg(e){
      // Collect the stack of backgrounds from the element up to the root (innermost
      // first), then composite BOTTOM-UP (outermost painted first, top layers over
      // it). This is the real "source-over" paint order, so translucent panels
      // (e.g. a 10% orange tint over a stale dark body) resolve to the true color
      // text renders on — not a white base.
      var layers = [], c = e;
      while (c){ var l = _parts(window.getComputedStyle(c).backgroundColor); layers.push(l); c = c.parentElement; }
      var acc = { r: 0, g: 0, b: 0, a: 0 };
      for (var k = layers.length - 1; k >= 0; k--){
        var p = layers[k]; if (!p || p.a <= 0.001) continue;
        var na = p.a + acc.a * (1 - p.a);
        if (na > 0){
          var r = (p.r * p.a + acc.r * acc.a * (1 - p.a)) / na;
          var g = (p.g * p.a + acc.g * acc.a * (1 - p.a)) / na;
          var b = (p.b * p.a + acc.b * acc.a * (1 - p.a)) / na;
          acc = { r: r, g: g, b: b, a: na };
        }
      }
      // If nothing opaque was found, fall back to the page body background.
      if (acc.a < 0.99){
        var body = _parts(window.getComputedStyle(document.body).backgroundColor) || { r:255, g:255, b:255, a:1 };
        var na = body.a + acc.a * (1 - body.a);
        if (na > 0) acc = { r: (body.r*body.a + acc.r*acc.a*(1-body.a))/na, g: (body.g*body.a + acc.g*acc.a*(1-body.a))/na, b: (body.b*body.a + acc.b*acc.a*(1-body.a))/na, a: na };
      }
      return 'rgb(' + Math.round(acc.r) + ', ' + Math.round(acc.g) + ', ' + Math.round(acc.b) + ')';
    }
    var link = el.querySelector && el.querySelector('a');
    var heading = /^H[1-6]$/.test(el.tagName) ? +el.tagName[1] : null;
    out.push({
      id: id, tag: el.tagName, cls: el.className || '', role: el.getAttribute('data-role') || '',
      parentId: (el.parentElement && el.parentElement.getAttribute && el.parentElement.getAttribute('data-nx-id')) || null,
      rect: { x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10, right: Math.round(r.right*10)/10, bottom: Math.round(r.bottom*10)/10 },
      computed: {
        display: cs.display, position: cs.position, direction: cs.flexDirection,
        gridTemplateColumns: cs.gridTemplateColumns, gap: cs.gap, padding: cs.padding, margin: cs.margin,
        width: cs.width, height: cs.height, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        color: cs.color, backgroundColor: cs.backgroundColor, resolvedBg: _resolvedBg(el), textAlign: cs.textAlign,
        opacity: cs.opacity, zIndex: cs.zIndex, visibility: cs.visibility,
        overflow: cs.overflow, transform: cs.transform
      },
      a11y: {
        roleA11y: el.getAttribute('role') || '',
        accessibleName: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (link && link.getAttribute('aria-label')) || el.textContent.trim().slice(0,60) || '',
        alt: el.getAttribute('alt') || '', title: el.getAttribute('title') || '', headingLevel: heading
      },
      onscreen: r.bottom > 0 && r.right > 0 && r.top < VPH && r.left < VPW,
      hidden: cs.display === 'none' || cs.visibility === 'hidden',
      // True when an ancestor clips horizontal overflow (overflow:hidden/clip/x-auto
      // on any ancestor up to the page). Such an element does NOT cause page-level
      // sideways scroll, so it is not a real overflow defect — this mirrors how the
      // marquee/gallery/lightbox intentionally bleed and are clipped by the section.
      clipped: (function(){ var a = el.parentElement; while (a && a !== document.body) { var o = window.getComputedStyle(a).overflowX; if (o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll') return true; a = a.parentElement; } return false; })(),
      // True when the node sits inside a position:fixed/absolute ancestor (sticky
      // nav, floating hero cards, badges). Such elements intentionally overlay
      // other content, so they are not stacking collisions.
      overlaid: (function(){ var a = el.parentElement; while (a && a !== document.body) { var p = window.getComputedStyle(a).position; if (p === 'fixed' || p === 'absolute') return true; a = a.parentElement; } return false; })()
      });
    }
    return { nodes: out, viewport: { w: VPW, h: VPH }, scrollHeight: document.body.scrollHeight };
  })();`;
}

// Capture evidence for a compiled HTML document across a set of breakpoints.
async function nxCaptureEvidence(html, opts) {
  opts = opts || {};
  if (!_playwright()) return { available: false, reason: 'playwright not installed' };
  const htmlStr = String(html || '');
  if (!htmlStr) return { available: false, reason: 'empty html' };
  const chromium = _playwright();
  const breakpoints = (opts.breakpoints && opts.breakpoints.length) ? opts.breakpoints : ['desktop', 'tablet', 'mobile'];
  const pages = {};
  const allErrors = { consoleErrors: [], pageErrors: [], networkFailures: [] };
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  } catch (e) {
    return { available: false, reason: 'browser launch failed: ' + (e && e.message) };
  }
  try {
    for (const bp of breakpoints) {
      const width = VIEWPORTS[bp] || (opts.widths && opts.widths[bp]) || 1280;
      const height = bp === 'mobile' ? 844 : 900;
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      const consoleErrors = [], pageErrors = [], networkFailures = [];
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', e => pageErrors.push(String(e)));
      page.on('requestfailed', r => networkFailures.push(r.url() + ' :: ' + ((r.failure() && r.failure().errorText) || 'failed')));
      try {
        await page.setContent(htmlStr, { waitUntil: 'load', timeout: 20000 });
        await page.waitForTimeout(opts.waitMs || 500);
        try { await page.evaluate(() => document.fonts && document.fonts.ready ? document.fonts.ready.then(() => {}, () => {}) : Promise.resolve()); } catch {}
        await page.waitForTimeout(opts.waitMs || 250);
      } catch (e) { pageErrors.push('setContent: ' + e.message); }
      let data = null;
      try { data = await page.evaluate(__collectNodesScript()); } catch (e) { pageErrors.push('collect: ' + e.message); }
      let shot = null;
      try {
        const buf = await page.screenshot({ fullPage: true, type: 'png' });
        shot = buf && buf.length ? 'data:image/png;base64,' + buf.toString('base64') : null;
      } catch (e) { pageErrors.push('screenshot: ' + e.message); }
      let a11y = null, a11yAvailable = false, a11yNote = '';
      try {
        if (page.accessibility && page.accessibility.snapshot) {
          a11y = await page.accessibility.snapshot({ interestingOnly: false });
          a11yAvailable = !!a11y;
        } else {
          const text = (data && data.nodes) || [];
          a11y = {
            derived: true,
            summary: {
              headings: text.filter(n => n.a11y && n.a11y.headingLevel).map(n => ({ id: n.id, level: n.a11y.headingLevel, name: n.a11y.accessibleName })),
              interactive: text.filter(n => /(button|link)/.test((n.cls || '') + n.tag)).map(n => ({ id: n.id, name: n.a11y.accessibleName })),
              imagesWithoutAlt: text.filter(n => /img/.test(n.tag) && !n.a11y.alt).map(n => n.id),
            },
          };
          a11yAvailable = true;
          a11yNote = 'AX snapshot API unavailable in this browser; accessibility derived from measured nodes.';
        }
      } catch (e) { a11yNote = 'a11y snapshot error: ' + e.message; }
      let runtime = {};
      try { runtime = await page.evaluate(() => typeof window !== 'undefined' && !!window.NXRuntime ? { started: true, reduce: !!(window.NXRuntime && window.NXRuntime.reduce) } : { started: false }); } catch {}
      pages[bp] = {
        viewport: { width, height }, scrollHeight: data ? data.scrollHeight : null,
        nodes: (data && data.nodes) || [], screenshot: shot, accessibility: a11y, a11yAvailable, a11yNote,
        consoleErrors, pageErrors, networkFailures, runtime,
      };
      allErrors.consoleErrors = allErrors.consoleErrors.concat(consoleErrors);
      allErrors.pageErrors = allErrors.pageErrors.concat(pageErrors);
      allErrors.networkFailures = allErrors.networkFailures.concat(networkFailures);
      await page.close();
    }
  } finally {
    try { await browser.close(); } catch {}
  }
  return { available: true, backend: 'browser', breakpoints: Object.keys(pages), pages, errors: allErrors, generatedAt: new Date().toISOString() };
}

const NX_CSS_RGBA = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/;
function __relLum(r, g, b) { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function __contrast(c1, c2) {
  const la = __relLum(c1.r, c1.g, c1.b), lb = __relLum(c2.r, c2.g, c2.b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
function __parseColor(str) {
  if (!str) return null;
  const m = NX_CSS_RGBA.exec(str);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], css: str };
  const hex = /^#([0-9a-f]{6})$/i.exec(String(str).trim());
  if (hex) return { r: parseInt(hex[1].slice(0, 2), 16), g: parseInt(hex[1].slice(2, 4), 16), b: parseInt(hex[1].slice(4, 6), 16), css: str };
  return null;
}
// Node-side twin of the browser `_solid`: a background counts as "real" only when
// it's a non-transparent rgb(a) value, so we never assess contrast against a
// node's own (often transparent) background — we use the RESOLVED bg instead.
function __isSolidBg(bg) {
  if (!bg) return false;
  const s = String(bg);
  if (s === 'transparent') return false;
  // resolvedBg is now COMPOSITED to an opaque rgb(); a translucent raw panel bg
  // (alpha <= 0.4) is not a solid contrast surface — it composites over the dark
  // body, so we fall through to the ancestor. Only a genuinely opaque layer
  // anchors contrast.
  const o = s.indexOf('(');
  if (o < 0) return false;
  const c = s.lastIndexOf(')');
  const inner = s.slice(o + 1, c < 0 ? s.length : c);
  const parts = inner.split(',').map(x => parseFloat(x));
  if (parts.length < 3) return false;
  if (s.indexOf('rgba') === 0 && parts.length >= 4) return parts[3] > 0.4;
  return true;
}

// Turn captured evidence into STRUCTURED, evidence-backed problems. Each carries
// Problem / Evidence / Expected effect / Proposed operation / Confidence / Potential
// regression. No problem is fabricated from nothing — each maps to a concrete
// measured fact (rect, computed style, contrast, an error, an a11y gap).
function nxEvidenceQa(evidence, opts) {
  opts = opts || {};
  if (!evidence || !evidence.available) return { available: false, reason: (evidence && evidence.reason) || 'no evidence', problems: [] };
  const problems = [];
  const seen = new Set();
  const push = (p) => { const k = p.problem + '|' + (p.nodeId || ''); if (!seen.has(k)) { seen.add(k); problems.push(p); } };

  for (const bp of Object.keys(evidence.pages || {})) {
    const page = evidence.pages[bp];
    const VPW = page.viewport.width;
    for (const err of page.consoleErrors || []) push({ nodeId: null, breakpoint: bp, problem: 'Console error in ' + bp, evidence: err, expectedEffect: 'clean console (no runtime errors)', op: null, confidence: 0.9, regressionRisk: 'low' });
    for (const err of page.pageErrors || []) push({ nodeId: null, breakpoint: bp, problem: 'Runtime page error in ' + bp, evidence: err, expectedEffect: 'runtime boots without exceptions', op: null, confidence: 0.9, regressionRisk: 'low' });
    for (const err of page.networkFailures || []) push({ nodeId: null, breakpoint: bp, problem: 'Network failure in ' + bp, evidence: err, expectedEffect: 'all referenced resources load', op: null, confidence: 0.85, regressionRisk: 'low' });

    for (const n of page.nodes || []) {
      const fs = parseFloat(n.computed.fontSize);
      if (n.computed.fontSize && fs > 0 && fs < 12 && /text|span|heading/.test(n.cls || '')) {
        push({ nodeId: n.id, breakpoint: bp, problem: 'Text too small to read', evidence: 'font-size ' + n.computed.fontSize + ' on ' + n.id, expectedEffect: 'readable body text (≥12px)', op: { op: 'node.set', id: n.id, field: 'design', value: { fontSize: 16 } }, confidence: 0.8, regressionRisk: 'low' });
      }
      if (!n.hidden && !n.clipped && n.rect && n.rect.right > VPW + 2) {
        push({ nodeId: n.id, breakpoint: bp, problem: 'Horizontal overflow in ' + bp, evidence: 'right edge ' + n.rect.right + 'px > viewport ' + VPW + 'px', expectedEffect: 'no sideways scroll on ' + bp, op: { op: 'responsive.update', id: n.id, rule: { on: bp, props: { display: 'stack', direction: 'column' } } }, confidence: 0.75, regressionRisk: 'layout' });
      }
      const isTextish = /(nx-text|nx-heading|nx-paragraph|nx-card|nx-btn|button|p|h[1-6])/.test((n.cls || '') + n.tag);
      const bgStr = n.computed.resolvedBg || n.computed.backgroundColor || '';
      const bgIsSolid = __isSolidBg(bgStr);
      const fg = __parseColor(n.computed.color);
      const bg = __parseColor(bgIsSolid ? bgStr : null);
      if (isTextish && fg && bg && bgIsSolid) {
        const ratio = __contrast(fg, bg);
        if (ratio < 4.5) {
          push({ nodeId: n.id, breakpoint: bp, problem: 'Text contrast below WCAG AA in ' + bp, evidence: n.id + ' ' + (n.cls || '') + ' contrast ' + ratio.toFixed(2) + ':1 (fg ' + fg.css + ' on bg ' + bg.css + ')', expectedEffect: 'legible text (≥4.5:1)', op: { op: 'node.set', id: n.id, field: 'design', value: { color: '#ffffff' } }, confidence: 0.85, regressionRisk: 'low' });
        }
      }
    }
  }

  // overlap detection (non-nested nodes intersecting), only when we have real rects
  for (const bp of Object.keys(evidence.pages || {})) {
    const nodes = evidence.pages[bp].nodes || [];
    const byId = {}; for (const n of nodes) byId[n.id] = n;
    const isDescendant = (id, maybeAncestor) => {
      let cur = byId[id]; let hops = 0;
      while (cur && cur.parentId && hops++ < 64) { if (cur.parentId === maybeAncestor) return true; cur = byId[cur.parentId]; }
      return false;
    };
    const isNested = (a, b) => a.rect && b.rect && a.rect.x <= b.rect.x && a.rect.y <= b.rect.y && (a.rect.x + a.rect.w) >= (b.rect.x + b.rect.w) && (a.rect.y + a.rect.h) >= (b.rect.y + b.rect.h);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (!a.rect || !b.rect || a.hidden || b.hidden || a.id === b.id) continue;
      if (isNested(a, b) || isNested(b, a)) continue;
      if (b.parentId === a.id || a.parentId === b.id) continue;           // containment, not collision
      if (isDescendant(a.id, b.id) || isDescendant(b.id, a.id)) continue; // ancestor/descendant, not collision
      // Fixed / absolutely-positioned elements (sticky nav, floating hero cards,
      // badges) intentionally overlay other content — that is the design, not a
      // collision. A node clipped by an ancestor (marquee ticker, lightbox) is
      // not a real overlap either since its visible box is contained.
      if ((a.computed && (a.computed.position === 'fixed' || a.computed.position === 'absolute')) || (b.computed && (b.computed.position === 'fixed' || b.computed.position === 'absolute'))) continue;
      if (a.clipped || b.clipped || a.overlaid || b.overlaid) continue;
      const ix = Math.max(0, Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x));
      const iy = Math.max(0, Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y));
      const area = ix * iy;
      const small = Math.min(a.rect.w * a.rect.h, b.rect.w * b.rect.h);
      if (area > 0 && area > small * 0.12) {
        push({ nodeId: a.id, breakpoint: bp, problem: 'Overlapping elements in ' + bp, evidence: a.id + ' overlaps ' + b.id + ' by ' + Math.round(area) + 'px²', expectedEffect: 'clean stacking / no visual collision', op: { op: 'node.set', id: a.id, field: 'props', value: { position: 'relative', zIndex: 1 } }, confidence: 0.7, regressionRisk: 'layout' });
      }
    }
  }

  problems.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  return { available: true, backend: 'browser', problems, problemCount: problems.length };
}

module.exports = { nxBrowserAvailable, nxCaptureEvidence, nxEvidenceQa, VIEWPORTS };
