'use strict';
// ══════════════════════════════════════════════════════════════════════════
// nx_browser.js — REAL BROWSER RENDERING (Phase 1.1)
//
// Renders a page in headless Chromium at every required viewport and measures
// the things only a layout engine can know: actual bounding boxes, overlap,
// off-canvas clipping, real tap-target size, computed contrast of rendered
// text, broken images, and Core Web Vitals (CLS).
//
// AVAILABILITY CONTRACT — this is the important part:
//   * If Chromium is present, measurements are REAL and `browserValidated`
//     is true.
//   * If it is not, we degrade to approximate mode and every consumer is told
//     so explicitly. We NEVER silently claim a page was visually verified.
//   * Detection is cached, so a missing browser costs one probe, not one per
//     generation.
//
// In this environment the Chromium binary cannot be installed (its CDN is
// network-blocked), so the fallback path is what runs here. The real path is
// fully implemented and activates automatically the moment a browser exists —
// `npx playwright install chromium` is the only step required.
// ══════════════════════════════════════════════════════════════════════════

const NX_VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812, dpr: 2 },
  { name: 'tablet', width: 768, height: 1024, dpr: 2 },
  { name: 'desktop', width: 1440, height: 900, dpr: 1 },
  { name: 'wide', width: 1920, height: 1080, dpr: 1 },
];

let __probe = null;   // cached availability probe

/** Resolve Playwright + a launchable Chromium, or explain precisely why not. */
async function nxBrowserProbe() {
  if (__probe) return __probe;
  const out = { available: false, engine: null, reason: '', version: '' };
  let pw = null;
  for (const mod of ['playwright', 'playwright-chromium', 'playwright-core']) {
    try { pw = await import(mod); out.engine = mod; break; } catch (e) { /* try next */ }
  }
  if (!pw) {
    out.reason = 'playwright is not installed (npm i -D playwright)';
    __probe = out; return out;
  }
  const chromium = pw.chromium || (pw.default && pw.default.chromium);
  if (!chromium) { out.reason = 'the resolved playwright build exposes no chromium'; __probe = out; return out; }
  try {
    // Launching is the only honest test: the package can exist while the
    // browser binary does not.
    const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    out.version = await b.version().catch(() => '');
    await b.close();
    out.available = true;
  } catch (e) {
    out.reason = 'chromium binary unavailable: ' + String(e && e.message || e).split('\n')[0].slice(0, 160);
  }
  __probe = out; return out;
}

function nxBrowserReset() { __probe = null; }

// Measurement executed INSIDE the page. Must be self-contained.
function __pageProbe() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const out = { overflowX: [], offCanvas: [], overlaps: [], smallTargets: [], zeroSize: [], badContrast: [], brokenImages: [], docWidth: document.documentElement.scrollWidth, cls: 0 };
  const ident = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/)[0] : '';
    return el.tagName.toLowerCase() + id + cls;
  };
  const lum = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null;
    const p = m[1].split(',').map(parseFloat);
    if (p.length > 3 && p[3] === 0) return null;             // fully transparent
    const f = p.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  // Effective background: walk up until a non-transparent colour is found.
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (lum(c) !== null) return c;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)';
  };
  const all = [...document.querySelectorAll('body *')].filter((el) => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity !== 0;
  });
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (r.width === 0 && r.height === 0) continue;
    // ── real horizontal overflow ──
    if (el.scrollWidth > el.clientWidth + 1 && !/auto|scroll/.test(s.overflowX) && el.clientWidth > 0) {
      out.overflowX.push({ sel: ident(el), by: Math.round(el.scrollWidth - el.clientWidth) });
    }
    // ── off-canvas (fixed/sticky overlays legitimately sit outside) ──
    if ((r.right > vw + 1 || r.left < -1) && s.position !== 'fixed' && s.position !== 'sticky') {
      out.offCanvas.push({ sel: ident(el), left: Math.round(r.left), right: Math.round(r.right), vw });
    }
    // ── zero-size boxes that hold visible text ──
    if ((r.width < 1 || r.height < 1) && (el.textContent || '').trim().length > 2 && s.overflow !== 'hidden') {
      out.zeroSize.push({ sel: ident(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
    // ── tap targets (mobile only, standalone controls only) ──
    if (vw <= 480 && /^(a|button|input|select|textarea)$/.test(el.tagName.toLowerCase())) {
      const inProse = el.tagName.toLowerCase() === 'a' && el.closest('p,li');
      const wrapsBlock = !!el.querySelector('img,svg,figure,picture,video,div,h1,h2,h3');
      if (!inProse && !wrapsBlock && (el.textContent || '').trim() && (r.height < 44 || r.width < 44)) {
        out.smallTargets.push({ sel: ident(el), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    // ── rendered text contrast ──
    const txt = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (txt.length) {
      const fg = lum(s.color), bg = lum(bgOf(el));
      if (fg !== null && bg !== null) {
        const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        const px = parseFloat(s.fontSize) || 16;
        const bold = (parseInt(s.fontWeight, 10) || 400) >= 700;
        const need = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5;
        if (ratio < need) out.badContrast.push({ sel: ident(el), ratio: +ratio.toFixed(2), need, px: Math.round(px) });
      }
    }
  }
  // ── broken images ──
  for (const img of document.querySelectorAll('img')) {
    if (img.complete && img.naturalWidth === 0) out.brokenImages.push({ sel: ident(img), src: String(img.currentSrc || img.src).slice(0, 120) });
  }
  // ── unintentional overlap between sibling sections ──
  const secs = [...document.querySelectorAll('main > *, body > header, body > footer')].filter((el) => {
    const s = getComputedStyle(el);
    return s.position === 'static' || s.position === 'relative';
  });
  for (let i = 0; i < secs.length; i++) {
    for (let j = i + 1; j < secs.length; j++) {
      const a = secs[i].getBoundingClientRect(), b = secs[j].getBoundingClientRect();
      if (a.height < 2 || b.height < 2) continue;
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      // >4px on both axes is a genuine collision, not a rounding artefact.
      if (overlapY > 4 && overlapX > 4) out.overlaps.push({ a: ident(secs[i]), b: ident(secs[j]), y: Math.round(overlapY) });
    }
  }
  return out;
}

/**
 * Render `html` in real Chromium across every viewport and return measured
 * violations. Returns { available:false } when no browser exists, so callers
 * can degrade explicitly rather than assume success.
 */
async function nxBrowserMeasure(html, opts) {
  opts = opts || {};
  const probe = await nxBrowserProbe();
  if (!probe.available) return { available: false, reason: probe.reason, viewports: [], violations: [] };

  const pw = await import(probe.engine);
  const chromium = pw.chromium || pw.default.chromium;
  const viewports = opts.viewports || NX_VIEWPORTS;
  const violations = [], perViewport = [];
  let browser = null;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    for (const vp of viewports) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr || 1 });
      const page = await ctx.newPage();
      // Never let a hung asset stall a build.
      page.setDefaultTimeout(opts.timeoutMs || 15000);
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e).slice(0, 140)));
      await page.setContent(html, { waitUntil: 'load' });
      // Fonts change metrics; measuring before they settle produces phantom
      // overflow. Bounded so a missing font cannot hang the gate.
      await page.evaluate(() => (document.fonts && document.fonts.ready) || Promise.resolve()).catch(() => {});
      await page.waitForTimeout(opts.settleMs || 120);
      const m = await page.evaluate(__pageProbe);
      const shot = opts.screenshot ? await page.screenshot({ fullPage: true }).catch(() => null) : null;

      const at = `${vp.width}x${vp.height}`;
      const add = (severity, rule, sel, measured, message) =>
        violations.push({ severity, category: 'layout', rule, selector: sel, viewport: at, measured, message, source: 'browser' });

      for (const o of m.overflowX) add('blocking', 'overflow', o.sel, `content overflows by ${o.by}px`, `${o.sel} overflows its container horizontally at ${at}.`);
      for (const o of m.offCanvas) add('blocking', 'off-canvas', o.sel, `x ${o.left}..${o.right} vs viewport ${o.vw}`, `${o.sel} renders outside the viewport at ${at}.`);
      for (const o of m.overlaps) add('blocking', 'overlap', `${o.a} / ${o.b}`, `${o.y}px vertical overlap`, `${o.a} and ${o.b} overlap unintentionally at ${at}.`);
      for (const o of m.smallTargets) add('blocking', 'touch-target', o.sel, `${o.w}x${o.h}px (min 44x44)`, `${o.sel} is too small to tap at ${at}.`);
      for (const o of m.zeroSize) add('blocking', 'zero-size', o.sel, `${o.w}x${o.h}px with text`, `${o.sel} has content but renders with no size at ${at}.`);
      for (const o of m.badContrast) add('blocking', 'contrast', o.sel, `${o.ratio}:1 (needs ${o.need}:1 at ${o.px}px)`, `${o.sel} fails WCAG AA contrast as rendered.`);
      for (const o of m.brokenImages) add('blocking', 'broken-image', o.sel, o.src, `${o.sel} failed to load.`);
      for (const e of pageErrors) violations.push({ severity: 'blocking', category: 'runtime', rule: 'page-error', selector: 'document', viewport: at, measured: e, message: `JavaScript error while rendering: ${e}`, source: 'browser' });
      if (m.docWidth > vp.width + 1) add('blocking', 'overflow', 'document', `document is ${m.docWidth}px wide in a ${vp.width}px viewport`, `The page scrolls horizontally at ${at}.`);

      perViewport.push({ viewport: at, issues: violations.filter((v) => v.viewport === at).length, screenshot: shot });
      await ctx.close();
    }
  } catch (e) {
    return { available: false, reason: 'render failed: ' + String(e && e.message || e).slice(0, 160), viewports: [], violations: [] };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return { available: true, engine: probe.engine, version: probe.version, viewports: perViewport, violations };
}

module.exports = { nxBrowserMeasure, nxBrowserProbe, nxBrowserReset, NX_VIEWPORTS };
