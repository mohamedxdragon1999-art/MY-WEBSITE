// ─────────────────────────────────────────────────────────────────────────────
// NXCROOM WEBSITE QUALITY ENGINE
// Deterministic, zero-dependency audit + enhancement for generated websites.
// Pure functions; usable identically in the browser (NexusCRM_V4_Hardened.html)
// and in the worker (backend/src/index.js). No network, no DOM API required.
// ─────────────────────────────────────────────────────────────────────────────

function __nxEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function __nxEscAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function __nxEmojiFavicon(emoji) {
  const e = String(emoji || '🚀').slice(0, 4);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    + '<text y=".9em" font-size="90">' + __nxEsc(e) + '</text></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// Lighthouse-style weightings (0..1). Sum = 1.
const NX_QUALITY_CATS = [
  { id: 'seo',    name: 'SEO',            weight: 0.30 },
  { id: 'perf',   name: 'Performance',    weight: 0.25 },
  { id: 'a11y',   name: 'Accessibility',  weight: 0.20 },
  { id: 'best',   name: 'Best Practices', weight: 0.15 },
  { id: 'mobile', name: 'Mobile',         weight: 0.10 },
];

function __nxGrade(score) {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  if (score >= 40) return 'E';
  return 'F';
}

// Audit an HTML string → { score, grade, categories, issues, checks }.
function auditSiteHtml(html) {
  const s = String(html || '');
  const low = s.toLowerCase();
  const cats = {};
  const flatChecks = {};
  const allIssues = [];

  function add(catId, name, max, cond, sev, msg) {
    const pass = !!cond;
    const c = cats[catId] = cats[catId] || { checks: [], issues: [], points: 0, total: 0 };
    c.checks.push({ name, pass, max });
    c.total += max;
    if (pass) c.points += max;
    flatChecks[name] = { pass, pts: pass ? max : 0, max };
    if (!pass) {
      const it = { id: name, cat: catId, severity: sev, message: msg };
      c.issues.push(it);
      allIssues.push(it);
    }
  }

  // ── locators ──────────────────────────────────────────────────────────────
  const head = (s.match(/<head[\s>][\s\S]*?<\/head>/i) || [''])[0] || (s.match(/<head[\s>][\s\S]*/i) || [''])[0];
  const headLow = head.toLowerCase();
  const title = (s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const titleLen = title.trim().length;
  const desc = (s.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) || [])[1]
    || (s.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i) || [])[1] || '';
  const htmlLang = /<html[^>]*\blang\s*=/.test(s);
  const imgs = s.match(/<img\b[^>]*>/gi) || [];
  const imgNoAlt = imgs.filter(t => !/<img\b[^>]*\balt\s*=/.test(t) && !/<img\b[^>]*\baria-label\s*=/.test(t)).length;
  const imgLazy = imgs.filter(t => /<img\b[^>]*\bloading\s*=\s*["']lazy/.test(t)).length;
  const imgDim = imgs.filter(t => !/<img\b[^>]*\b(width|height)\s*=/.test(t) && !/<img\b[^>]*\bstyle\s*=/.test(t)).length;
  const hasSrcset = /<img\b[^>]*\bsrcset\s*=/.test(s);
  const isGoogleFonts = /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(low);
  const hasFontPreconnect = /fonts\.googleapis\.com/.test(low) && /rel=["']preconnect["']/.test(low) && /<link[^>]*preconnect[^>]*fonts\.gstatic\.com/i.test(low);
  const fontSwap = /display\s*=\s*swap|&display=swap|font-display:\s*swap/i.test(s);
  const styleInHead = (() => {
    const headEnd = s.toLowerCase().indexOf('</head>');
    const firstStyle = s.toLowerCase().indexOf('<style>');
    return firstStyle === -1 || (headEnd !== -1 && firstStyle < headEnd);
  })();
  const hasDocWrite = /document\.write|document\.writeln/i.test(s);
  const hasDefer = /<script[^>]*\bdefer\b|type=["']module["']/i.test(s);
  const scriptsAtEnd = /<\/head>[\s\S]*<script[\s>][\s\S]*<\/body>/i.test(s);
  const controls = s.match(/<(input|textarea|select)\b[^>]*>/gi) || [];
  const controlsLabeled = controls.filter(t => {
    if (/<(input|textarea|select)\b[^>]*\baria-label\s*=/.test(t)) return true;
    const id = (t.match(/\bid\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!id) return false;
    return new RegExp('<label[^>]*\\bfor\\s*=\\s*["\']' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']', 'i').test(s);
  }).length;
  const buttons = s.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) || [];
  const btnOK = buttons.filter(t => t.replace(/<[^>]+>/g, '').trim().length > 0 || /aria-label\s*=/.test(t)).length;
  const tabPos = /tabindex\s*=\s*["'][1-9][0-9]*["']/.test(s);
  const hasFocusStyle = /:focus-visible|:focus\b|outline\s*:\s*[^;]+/.test(s);
  const hasReducedMotion = /prefers-reduced-motion/.test(s);
  const hasMedia = /@media\b/.test(s);
  const hasResponsiveGrid = /grid-template-columns\s*:\s*[^;]*(auto-fit|minmax)/i.test(s) || /flex-wrap\s*:\s*wrap/i.test(s) || /\b@media\b/.test(s);
  const hasTouch = /min-height\s*:\s*4[0-9]px|padding\s*:\s*[^;]*\b(12|16|20)px\b/i.test(s) || /\.btn\s*\{[^}]*padding/i.test(s);
  const viewport = /<meta[^>]*name=["']viewport["'][^>]*content=["'][^"']*\bwidth\s*=\s*device-width/i.test(s);
  const initScale = /<meta[^>]*name=["']viewport["'][^>]*content=["'][^"']*\binitial-scale/i.test(s);
  const noopener = /rel=["'][^"']*\bnoopener\b[^"']*["']/i.test(s);
  const anchorsBlank = s.match(/<a\b[^>]*\btarget\s*=\s*["']_blank["'][^>]*>/gi) || [];
  const blankNoNoopener = anchorsBlank.filter(t => !/rel=["'][^"']*\bnoopener\b[^"']*["']/.test(t)).length;
  const extHttpHrefs = (s.match(/<a\b[^>]*\bhref\s*=\s*["']http:\/\/(?!localhost|127\.0\.0\.1|api\.)[^"']*["'][^>]*>/gi) || []).length;
  const extHttpSrcs = (s.match(/<(img|script|link|iframe|source)\b[^>]*\bsrc(?:set)?\s*=\s*["']http:\/\/(?!localhost|127\.0\.0\.1|api\.)[^"']*["'][^>]*>/gi) || []).length;
  const jsonld = (s.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []);
  const jsonldType = /"@type"\s*:\s*"(LocalBusiness|Organization|ProfessionalService|Restaurant|Store|MedicalBusiness)".*/.test(jsonld.join('')) ? 'business' : (jsonld.length ? 'other' : 'none');
  const semantic = (['<main', '<header', '<footer', '<nav', '<section', '<article'].filter(tag => low.includes(tag)).length);
  const ogTitle = /property=["']og:title["']/.test(s) || /name=["']og:title["']/.test(s);
  const ogDesc = /property=["']og:description["']/.test(s) || /name=["']og:description["']/.test(s);
  const ogImg = /property=["']og:image["']/.test(s);
  const twCard = /name=["']twitter:card["']/.test(s);
  const canonical = /rel=["']canonical["']/.test(s);
  const favicon = /rel=["']icon["']|\bicon\b/.test(low);
  const robotsMeta = /<meta[^>]*name=["']robots["']/.test(s);
  const colorScheme = /name=["']color-scheme["']/.test(s);
  const themeColor = /name=["']theme-color["']/.test(s);
  const viewportPresent = /name=["']viewport["']/.test(s);
  const charset = /charset\s*=|<meta[^>]*charset/i.test(s);
  const h1s = (s.match(/<h1\b[^>]*>/gi) || []).length;
  const h2s = (s.match(/<h2\b[^>]*>/gi) || []).length;

  // ── SEO ────────────────────────────────────────────────────────────────────
  add('seo', 'title', 3, /<title[^>]*>[\s\S]*<\/title>/i.test(s), 'high', 'Every page needs a <title>.');
  add('seo', 'title_len', 2, titleLen >= 10 && titleLen <= 70, 'medium', 'Title should be 10–70 characters (currently ' + titleLen + ').');
  add('seo', 'description', 2, /<meta[^>]*name=["']description["']/i.test(s) && desc.length >= 30, 'high', 'Add a meta description (30–200 chars) that summarises the page.');
  add('seo', 'description_len', 1, desc.length >= 40 && desc.length <= 200, 'low', 'Description should be 40–200 characters (currently ' + desc.length + ').');
  add('seo', 'charset', 1, charset, 'low', 'Declare <meta charset="utf-8">.');
  add('seo', 'viewport', 1, viewportPresent, 'high', 'Add a Responsive viewport meta tag.');
  add('seo', 'lang', 2, htmlLang, 'medium', 'Set lang="..." on <html> for screen readers & SEO.');
  add('seo', 'canonical', 2, canonical, 'medium', 'Add <link rel="canonical"> to avoid duplicate-content issues.');
  add('seo', 'og_title', 1, ogTitle, 'medium', 'Add og:title for rich social sharing.');
  add('seo', 'og_description', 1, ogDesc, 'medium', 'Add og:description for rich social sharing.');
  add('seo', 'og_image', 1, ogImg, 'low', 'Add og:image so shares get a preview thumbnail.');
  add('seo', 'twitter_card', 1, twCard, 'low', 'Add twitter:card meta for better link previews.');
  add('seo', 'h1', 1, h1s >= 1, 'medium', 'Include a single <h1> as the main heading.');
  add('seo', 'h1_single', 1, h1s === 1, 'low', 'Use exactly one <h1> (currently ' + h1s + ').');
  add('seo', 'h2', 1, h2s >= 1, 'low', 'Organise sections with <h2> sub-headings.');
  add('seo', 'favicon', 1, favicon, 'low', 'Add a favicon (<link rel="icon">).');
  add('seo', 'jsonld', 2, jsonld.length > 0, 'medium', 'Add JSON-LD structured data for rich results.');
  add('seo', 'jsonld_business', 1, jsonldType === 'business', 'low', 'Use a LocalBusiness/Organization @type in JSON-LD.');
  add('seo', 'robots', 1, robotsMeta, 'low', 'Add <meta name="robots" content="index,follow">.');

  // ── Performance ────────────────────────────────────────────────────────────
  add('perf', 'font_preconnect', 2, !isGoogleFonts || (hasFontPreconnect && /preconnect/.test(low)), 'medium', 'Preconnect to fonts.googleapis.com / fonts.gstatic.com when a web font is used.');
  add('perf', 'font_swap', 2, !isGoogleFonts || fontSwap, 'medium', 'Use display=swap (Google Fonts) / font-display:swap so text renders during font load.');
  add('perf', 'css_in_head', 2, styleInHead, 'medium', 'Keep <style> in <head>, not the <body>.');
  add('perf', 'img_dimensions', 2, imgDim === 0 || imgs.length === 0, 'medium', imgDim ? (imgDim + ' <img> lack width/height/ratio → layout shift (CLS).') : '');
  add('perf', 'lazy_images', 2, imgs.length === 0 || (imgLazy / imgs.length) >= 0.6, 'low', 'Add loading="lazy" to below-the-fold images.');
  add('perf', 'responsive_images', 1, hasSrcset, 'low', 'Use srcset for responsive images.');
  add('perf', 'defer_scripts', 1, hasDefer || scriptsAtEnd, 'medium', 'Load scripts asynchronously (defer/type=module) or before </body>.');
  add('perf', 'no_document_write', 2, !hasDocWrite, 'high', 'Avoid document.write (blocks rendering).');
  add('perf', 'no_mixed_http', 2, extHttpSrcs === 0, 'medium', extHttpSrcs + ' external resource(s) loaded over http:// — HTTPS improves speed & trust.');

  // ── Accessibility ──────────────────────────────────────────────────────────
  add('a11y', 'img_alt', 3, imgNoAlt === 0, 'high', imgNoAlt ? (imgNoAlt + ' image(s) missing alt text.') : '');
  add('a11y', 'lang', 2, htmlLang, 'high', 'Set lang="..." on <html> for correct screen-reader pronunciation.');
  add('a11y', 'focus_styles', 2, hasFocusStyle, 'medium', 'Add :focus-visible/:focus styles so keyboard users can see focus.');
  add('a11y', 'reduced_motion', 2, hasReducedMotion, 'medium', 'Respect prefers-reduced-motion (disable heavy animation).');
  add('a11y', 'button_text', 2, btnOK === buttons.length, 'high', (buttons.length - btnOK) + ' button(s) have no accessible text/aria-label.');
  add('a11y', 'form_labels', 2, controls.length === 0 || controlsLabeled === controls.length, 'high', 'Associate every input with a <label> or aria-label.');
  add('a11y', 'no_positive_tabindex', 1, !tabPos, 'medium', 'Avoid positive tabindex values.');
  add('a11y', 'semantic_landmarks', 1, semantic >= 2, 'low', 'Use semantic landmarks (<header>/<nav>/<main>/<footer>/<section>).');

  // ── Best Practices ─────────────────────────────────────────────────────────
  add('best', 'noopener', 2, blankNoNoopener === 0, 'medium', blankNoNoopener + ' target="_blank" link(s) missing rel="noopener".');
  add('best', 'https_links', 1, extHttpHrefs === 0, 'medium', extHttpHrefs + ' link(s) use http:// — prefer https:// (avoid mixed content).');
  add('best', 'color_scheme', 1, colorScheme, 'low', 'Add <meta name="color-scheme"> for consistent dark-mode form rendering.');
  add('best', 'theme_color', 1, themeColor, 'low', 'Add <meta name="theme-color"> for branded mobile browser chrome.');

  // ── Mobile ─────────────────────────────────────────────────────────────────
  add('mobile', 'viewport', 2, viewport, 'high', 'Set the viewport meta to width=device-width.');
  add('mobile', 'initial_scale', 2, initScale, 'medium', 'Keep initial-scale for correct zoom on phones.');
  add('mobile', 'media_queries', 2, hasMedia, 'medium', 'Add @media queries for responsive layout.');
  add('mobile', 'responsive_grid', 2, hasResponsiveGrid, 'medium', 'Use fluid grids (auto-fit/minmax or flex-wrap) so columns stack.');
  add('mobile', 'touch_targets', 2, hasTouch, 'medium', 'Size tap targets ≥ ~44px (padding/min-height on buttons).');

  // ── fold into report ───────────────────────────────────────────────────────
  const categories = NX_QUALITY_CATS.map(c => {
    const cc = cats[c.id] || { checks: [], issues: [], points: 0, total: 1 };
    const maxTotal = cc.total || 1;
    const pct = Math.round((cc.points / maxTotal) * 100);
    return {
      id: c.id, name: c.name, weight: c.weight,
      score: Math.min(100, pct), points: cc.points, total: maxTotal,
      issues: cc.issues, checks: cc.checks,
    };
  });
  let weighted = 0, weightSum = 0;
  categories.forEach(c => { weighted += c.score * c.weight; weightSum += c.weight; });
  const score = Math.round(weighted / (weightSum || 1));
  const orderedIssues = allIssues.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return (rank[a.severity] - rank[b.severity]) || a.cat.localeCompare(b.cat);
  });
  return { score, grade: __nxGrade(score), categories, issues: orderedIssues, checks: flatChecks };
}

// Improve an HTML string so it passes the audit. Idempotent: never duplicates
// meta it already has. Safe for any HTML with a <head> or <html>.
function enhanceSiteHtml(html, name, opts) {
  opts = opts || {};
  const siteName = String(opts.name || name || 'My Website').slice(0, 100);
  const description = String(opts.description || '').slice(0, 200);
  const lang = String(opts.lang || 'en').slice(0, 10);
  const favicon = String(opts.favicon || '🚀').slice(0, 4);
  const canonical = String(opts.canonical || '').trim();
  let s = String(html || '').trim();

  if (!s || !/<html|<!doctype/i.test(s)) {
    s = '<!DOCTYPE html><html lang="' + __nxEscAttr(lang) + '"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width, initial-scale=1"></head>'
      + '<body><main><h1>' + __nxEsc(siteName) + '</h1></main></body></html>';
  }
  if (!/<!doctype\s+html/i.test(s)) s = s.replace(/^\s*/, '').replace(/^/i, '<!DOCTYPE html>\n');

  // Derivative content for meta we may need to inject.
  const h1Text = (s.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
  const firstText = (s.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '';
  const titleVal = (s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const titleIn = titleVal.trim() || siteName;
  const descIn = description || h1Text.replace(/<[^>]+>/g, '').trim() || firstText.replace(/<[^>]+>/g, '').trim() || titleIn;

  // <html lang>
  if (/<html\b/i.test(s)) {
    s = s.replace(/<html(\s[^>]*)?>/i, m => /\blang\s*=/.test(m) ? m : m.replace(/<html/i, '<html lang="' + __nxEscAttr(lang) + '"'));
  } else {
    s = s.replace(/^[\s\S]*?(<!doctype[^>]*>?)?/i, '$1\n<html lang="' + __nxEscAttr(lang) + '">');
  }

  // Ensure a <head> block exists.
  if (!/<head[\s>]/i.test(s)) {
    s = s.replace(/<html\b[^>]*>/i, m => m + '\n<head></head>');
  }

  // A single block of head additions, conditionally produced.
  let headAdd = '';
  const hasCharset = /<meta[^>]*charset\s*=/i.test(s);
  const hasViewport = /<meta[^>]*name=["']viewport["']/i.test(s);
  const hasTitle = /<title[^>]*>[\s\S]*<\/title>/i.test(s);
  const hasDesc = /<meta[^>]*name=["']description["']/i.test(s);
  if (!hasCharset) headAdd += '<meta charset="utf-8">\n';
  if (!hasViewport) headAdd += '<meta name="viewport" content="width=device-width, initial-scale=1">\n';
  if (!hasTitle) headAdd += '<title>' + __nxEsc(titleIn) + '</title>\n';
  if (!hasDesc) headAdd += '<meta name="description" content="' + __nxEscAttr(descIn.slice(0, 200)) + '">\n';
  if (!/name=["']robots["']/i.test(s)) headAdd += '<meta name="robots" content="index,follow">\n';
  if (!/name=["']theme-color["']/i.test(s)) headAdd += '<meta name="theme-color" content="' + __nxEscAttr(opts.theme_color || '#0b0e14') + '">\n';
  if (!/name=["']color-scheme["']/i.test(s)) headAdd += '<meta name="color-scheme" content="light dark">\n';
  if (!/property=["']og:title["']|name=["']og:title["']/i.test(s)) headAdd += '<meta property="og:title" content="' + __nxEscAttr(titleIn) + '">\n';
  if (!/property=["']og:type["']|name=["']og:type["']/i.test(s)) headAdd += '<meta property="og:type" content="website">\n';
  if (!/property=["']og:description["']|name=["']og:description["']/i.test(s)) headAdd += '<meta property="og:description" content="' + __nxEscAttr(descIn.slice(0, 200)) + '">\n';
  if (opts.image && !/property=["']og:image["']|name=["']og:image["']/i.test(s)) headAdd += '<meta property="og:image" content="' + __nxEscAttr(opts.image) + '">\n';
  if (!/name=["']twitter:card["']/.test(s)) headAdd += '<meta name="twitter:card" content="summary_large_image">\n';
  if (canonical && !/rel=["']canonical["']/i.test(s)) headAdd += '<link rel="canonical" href="' + __nxEscAttr(canonical) + '">\n';
  if (!/rel=["']icon["']|\bbase_url_favicon\b|apple-touch-icon/i.test(s)) headAdd += '<link rel="icon" href="' + __nxEscAttr(__nxEmojiFavicon(favicon)) + '"><link rel="apple-touch-icon" href="' + __nxEscAttr(__nxEmojiFavicon(favicon)) + '">\n';

  // Preconnect for Google Fonts (only if the page uses them but has no preconnect).
  if (!/rel=["']preconnect["']/i.test(s) && /fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(s)) {
    headAdd += '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n';
  }

  // A page with NO <style> at all has no responsive/accessible styling. Inject a
  // minimal, non-intrusive base layer (focus rings, reduced-motion, responsive
  // media, touch targets). Guarded so a themed page is never touched.
  if (!/<style\b/i.test(s)) {
    headAdd += '<style>'
      + '*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#1e293b}'
      + ':focus-visible{outline:3px solid currentColor;outline-offset:2px}'
      + 'img{max-width:100%;height:auto;display:block}'
      + 'a,button{min-height:44px;display:inline-flex;align-items:center;justify-content:center}'
      + '@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}'
      + '@media (max-width:768px){h1{font-size:1.6em}h2{font-size:1.35em}}'
      + '</style>\n';
  }

  // Structured data — skip if any JSON-LD already present.
  if (!/<script[^>]*type=["']application\/ld\+json["']/i.test(s)) {
    const business = {
      '@context': 'https://schema.org',
      '@type': opts.type === 'restaurant' ? 'Restaurant' : (opts.type === 'store' ? 'Store' : (opts.type === 'medical' ? 'MedicalBusiness' : (opts.type === 'professional' ? 'ProfessionalService' : 'LocalBusiness'))),
      'name': titleIn,
      'description': descIn.slice(0, 180),
      'url': canonical || undefined,
      'image': opts.image || undefined,
      'telephone': opts.phone || undefined,
      'email': opts.email || undefined,
      'address': opts.address ? { '@type': 'PostalAddress', streetAddress: opts.address } : undefined,
    };
    const json = JSON.stringify(business).replace(/</g, '\\u003c');
    headAdd += '<script type="application/ld+json">' + json + '<\/script>\n';
  }

  if (headAdd) s = s.replace(/<\/head>/i, headAdd + '</head>');

  // Favicon emoji in the title bar fallback + open-graph absolute fallback handled above.

  // Images: lazy, async decode, alt.
  if (/<img\b/i.test(s)) {
    s = s.replace(/<img\b([^>]*?)>/gi, (m, attrs) => {
      let a = attrs;
      if (!/loading\s*=/i.test(a)) a += ' loading="lazy"';
      if (!/decoding\s*=/i.test(a)) a += ' decoding="async"';
      return '<img' + a + '>';
    });
    // alt for images that have none
    s = s.replace(/<img\b([^>]*?)>/gi, (m, attrs) => {
      if (/alt\s*=|aria-label\s*=/.test(attrs)) return '<img' + attrs + '>';
      const src = (attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
      const base = String(src).split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
      return '<img' + attrs + (base ? ' alt="' + __nxEscAttr(base.slice(0, 120)) + '"' : ' alt=""') + '>';
    });
  }

  // target="_blank" → rel="noopener noreferrer"
  if (/target\s*=\s*["']_blank["']/i.test(s)) {
    s = s.replace(/<a\b([^>]*\btarget\s*=\s*["']_blank["'][^>]*?)>/gi, (m, attrs) => {
      const rel = (attrs.match(/\brel\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
      if (/\bnoopener\b/i.test(rel)) return '<a' + attrs + '>';
      const newRel = (rel ? rel + ' ' : '') + 'noopener noreferrer';
      if (/\brel\s*=\s*["']/i.test(attrs)) {
        return '<a' + attrs.replace(/\brel\s*=\s*["'][^"']*["']/i, 'rel="' + newRel + '"') + '>';
      }
      return '<a' + attrs + ' rel="' + newRel + '">';
    });
  }

  return s;
}

// If the raw input wasn't HTML at all, wrap it. Used internally.
function minimalDoc(title, body) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + __nxEsc(title || 'Page') + '</title></head>'
    + '<body><h1>' + __nxEsc(title || 'Page') + '</h1>' + (body || '') + '</body></html>';
}

// Export for tests.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { auditSiteHtml, enhanceSiteHtml, __nxGrade, NX_QUALITY_CATS, __nxEmojiFavicon };
}
