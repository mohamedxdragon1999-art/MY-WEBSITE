'use strict';
// ════════════════════════════════════════════════════════════════════════════
// nx_safe_html.js — SAFE OUTPUT CONTRACT for generated websites (v0.0.0.0.19)
//
// Every byte that reaches a published page passes through here, whichever path
// produced it: the AI body pass, a user-supplied HTML upload, a scanned-site
// content plan, the template library, or a visual-editor patch. The builder's
// promise is "AI HTML is sanitised exactly like user HTML" — this module is
// where that promise is kept.
//
// Zero dependencies and no DOM: it must bundle into a Cloudflare Worker and run
// identically in Node tests. It is a conservative allowlist tokenizer, not a
// full HTML5 parser — anything it cannot classify with certainty is dropped.
//
//   nxSanitizeFragment(html, policy) → safe body-level HTML
//   nxSanitizeDocument(html, policy) → whole document (keeps head metadata,
//                                      inline <style>, and ONLY our own runtime)
//   nxJsonForScript(value)           → JSON safe inside <script> (no </, no U+2028)
//   nxJsString(value)                → JS string literal safe inside <script>
//   nxSafeUrl(url, opts)             → '' unless the scheme is allowed
//   nxSecurityHeaders(opts)          → CSP + hardening headers for public serve
// ════════════════════════════════════════════════════════════════════════════

const SVG_LEAF = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'use', 'stop', 'image', 'animate', 'animatetransform', 'fecolormatrix', 'fegaussianblur', 'feoffset', 'femerge', 'femergenode', 'feblend', 'feflood', 'fecomposite']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// Body-level tags a generated marketing page legitimately uses.
const BODY_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'button', 'caption', 'cite', 'code',
  'col', 'colgroup', 'data', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li',
  'main', 'mark', 'nav', 'ol', 'optgroup', 'option', 'p', 'picture', 'pre', 'q', 's', 'samp', 'section', 'select', 'small',
  'source', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'textarea', 'tfoot', 'th', 'thead', 'time',
  'tr', 'u', 'ul', 'var', 'video', 'audio', 'track', 'wbr', 'canvas', 'svg', 'path', 'g', 'circle', 'rect', 'line',
  'polyline', 'polygon', 'ellipse', 'defs', 'use', 'symbol', 'lineargradient', 'radialgradient', 'stop', 'clippath',
  'mask', 'text', 'tspan', 'title', 'desc', 'iframe', 'fieldset', 'progress', 'meter', 'dialog', 'menu',
  'spline-viewer', // custom element from @splinetool/viewer — url= is host-pinned below
  'animate', 'animatetransform', 'image', 'pattern', 'filter', 'fegaussianblur', 'feoffset', 'femerge', 'femergenode', 'feblend', 'fecolormatrix', 'feflood', 'fecomposite', 'textpath', 'marker',
]);

// Attributes allowed everywhere (event handlers are never in this list).
const GLOBAL_ATTRS = new Set([
  'id', 'class', 'style', 'title', 'lang', 'dir', 'role', 'tabindex', 'hidden', 'translate', 'draggable', 'itemprop',
  'itemscope', 'itemtype', 'data-*', 'aria-*', 'width', 'height', 'align', 'name', 'value', 'type', 'placeholder',
  'required', 'disabled', 'readonly', 'checked', 'selected', 'multiple', 'min', 'max', 'step', 'maxlength', 'minlength',
  'pattern', 'autocomplete', 'inputmode', 'for', 'colspan', 'rowspan', 'scope', 'headers', 'datetime', 'cite', 'open',
  'loading', 'decoding', 'alt', 'srcset', 'sizes', 'poster', 'controls', 'autoplay', 'muted', 'loop', 'playsinline',
  'preload', 'kind', 'label', 'srclang', 'default', 'reversed', 'start', 'download', 'hreflang', 'rel', 'target',
  'referrerpolicy', 'crossorigin', 'allowfullscreen', 'allow', 'frameborder', 'sandbox', 'method', 'enctype', 'novalidate',
  'accept', 'accept-charset', 'rows', 'cols', 'wrap', 'spellcheck', 'autofocus', 'form', 'list', 'size', 'span',
  // SVG presentation attributes
  'viewbox', 'xmlns', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform',
  'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'clip-path', 'offset', 'stop-color',
  'stop-opacity', 'gradientunits', 'gradienttransform', 'preserveaspectratio', 'focusable', 'aria-hidden', 'href',
  'src', 'action', 'usemap', 'ismap', 'text-anchor', 'font-size', 'font-family', 'font-weight', 'dominant-baseline',
  'vector-effect', 'mask', 'filter', 'marker-end', 'marker-start', 'pathlength',
  // SVG animation / filter / pattern / marker / text attributes
  'attributename', 'attributetype', 'values', 'dur', 'repeatcount', 'begin', 'end', 'from', 'to', 'by', 'keytimes',
  'keysplines', 'calcmode', 'additive', 'accumulate', 'restart', 'in', 'in2', 'result', 'stddeviation', 'dx', 'dy',
  'mode', 'flood-color', 'flood-opacity', 'operator', 'k1', 'k2', 'k3', 'k4', 'patternunits', 'patterncontentunits',
  'patterntransform', 'markerwidth', 'markerheight', 'refx', 'refy', 'orient', 'markerunits', 'startoffset',
  'lengthadjust', 'textlength', 'letter-spacing', 'word-spacing', 'font-style', 'baseline-shift', 'alignment-baseline',
  'shape-rendering', 'color', 'display', 'visibility', 'overflow', 'paint-order', 'stroke-miterlimit',
  // <spline-viewer> (custom element; url= is additionally host-pinned)
  'url', 'loading-anim-type', 'events-target',
]);

const URL_ATTRS = new Set(['href', 'src', 'action', 'poster', 'cite', 'formaction', 'data', 'srcset', 'xlink:href', 'longdesc', 'background', 'ping', 'url']);
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:', 'sms:', 'whatsapp:']);

// Hosts a generated page may frame (maps / video). Anything else is dropped.
const IFRAME_HOSTS = [
  'www.youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com', 'www.google.com', 'maps.google.com',
  'www.openstreetmap.org', 'open.spotify.com', 'w.soundcloud.com', 'calendly.com', 'www.facebook.com',
];

function __lower(s) { return String(s || '').toLowerCase(); }

// Decode the entity/whitespace tricks used to smuggle schemes: "java&#115;cript:",
// "  javascript:", "java\tscript:", "&#x6A;avascript:".
function __decodeForSchemeCheck(v) {
  let s = String(v || '');
  s = s.replace(/&#x([0-9a-f]+);?/gi, (m, h) => { const c = parseInt(h, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; });
  s = s.replace(/&#(\d+);?/g, (m, d) => { const c = parseInt(d, 10); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; });
  s = s.replace(/&(tab|newline|colon|sol);?/gi, (m, n) => ({ tab: '\t', newline: '\n', colon: ':', sol: '/' })[n.toLowerCase()]);
  // strip control chars + whitespace that browsers ignore inside a scheme
  return s.replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]+/g, '').trim();
}

/**
 * Return the URL if its scheme is allowed, else ''. Relative URLs and
 * fragments are allowed. `data:image/*` only when opts.allowDataImage.
 */
function nxSafeUrl(url, opts) {
  opts = opts || {};
  const raw = String(url == null ? '' : url).trim();
  if (!raw) return '';
  if (raw.length > (opts.maxLength || 2000)) return '';
  const probe = __decodeForSchemeCheck(raw).toLowerCase();
  const m = probe.match(/^([a-z][a-z0-9+.-]*):/);
  if (!m) {
    // scheme-less: relative, fragment, protocol-relative
    if (/^\/\//.test(probe)) return opts.allowProtocolRelative === false ? '' : raw;
    return raw;
  }
  const scheme = m[1] + ':';
  if (SAFE_SCHEMES.has(scheme)) {
    if (opts.httpsOnly && scheme === 'http:') return '';
    return raw;
  }
  if (scheme === 'data:' && opts.allowDataImage && /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(probe)) {
    // svg data URLs can carry script — only allow when the caller opted in for icons
    if (/svg\+xml/i.test(probe) && !opts.allowDataSvg) return '';
    return raw;
  }
  return '';
}

function __iframeAllowed(src, policy) {
  const safe = nxSafeUrl(src, { httpsOnly: true });
  if (!safe) return false;
  let host = '';
  try { host = new URL(safe, 'https://x.invalid').hostname.toLowerCase(); } catch (e) { return false; }
  const list = (policy && policy.iframeHosts) || IFRAME_HOSTS;
  return list.some((h) => host === h || host.endsWith('.' + h));
}

// Parse the attribute string of a start tag into [name, value|null] pairs.
function __parseAttrs(s) {
  const out = [];
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(s))) {
    const name = m[1];
    const value = m[2] != null ? m[2] : (m[3] != null ? m[3] : (m[4] != null ? m[4] : null));
    out.push([name, value]);
  }
  return out;
}

function __attrAllowed(name, policy) {
  const n = __lower(name);
  if (/^on/.test(n)) return false;                 // every event handler
  if (n === 'srcdoc' || n === 'formaction' || n === 'xlink:href' || n === 'background' || n === 'ping') return false;
  if (n.startsWith('data-') || n.startsWith('aria-')) return true;
  if (GLOBAL_ATTRS.has(n)) return true;
  if (policy && policy.extraAttrs && policy.extraAttrs.has(n)) return true;
  return false;
}

// CSS in style="" — kill anything that can fetch or execute.
function __safeStyle(v) {
  let s = String(v || '');
  if (/expression\s*\(|javascript\s*:|behaviou?r\s*:|-moz-binding|@import|url\s*\(\s*['"]?\s*(?!https?:|data:image\/|#|\/)/i.test(s)) return '';
  if (/url\s*\(/i.test(s) && /url\s*\(\s*['"]?\s*(javascript|vbscript|data:(?!image\/))/i.test(s)) return '';
  return s.slice(0, 2000);
}

// Attribute values are re-serialised from parsed markup, so existing entities must
// survive untouched (else "&amp;" becomes "&amp;amp;"); only bare ampersands, quotes
// and angle brackets are escaped.
function __escAttr(v) {
  return String(v == null ? '' : v)
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/g, '&amp;')
    .replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Sanitise a body-level HTML fragment. Drops everything not on the allowlist,
 * including the *content* of script/style/template/noscript/object blocks.
 */
function nxSanitizeFragment(html, policy) {
  policy = policy || {};
  const allowTags = policy.tags || BODY_TAGS;
  const allowStyleTag = !!policy.allowStyleTag;      // inline <style> blocks (our own design CSS)
  let s = String(html == null ? '' : html);
  if (policy.maxLength && s.length > policy.maxLength) s = s.slice(0, policy.maxLength);
  // Remove comments, CDATA, processing instructions, doctype — never useful in a fragment.
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!doctype[^>]*>/gi, '');
  // Drop dangerous blocks WITH their content (their bodies are not HTML).
  const dropWithContent = ['script', 'template', 'noscript', 'object', 'applet', 'xml', 'math', 'noembed', 'noframes', 'plaintext'];
  if (!allowStyleTag) dropWithContent.push('style');
  for (const t of dropWithContent) {
    // tolerate split tags like <scr<script>ipt> by iterating to a fixpoint
    const re = new RegExp('<' + t + '\\b[^>]*>[\\s\\S]*?<\\/' + t + '\\s*>', 'gi');
    let prev;
    do { prev = s; s = s.replace(re, ''); } while (prev !== s);
    // dangling open tag with no close → drop rest of the block to end
    s = s.replace(new RegExp('<' + t + '\\b[^>]*>[\\s\\S]*$', 'gi'), '');
  }
  const dropped = { tags: 0, attrs: 0, urls: 0 };
  let out = '';
  let i = 0;
  const N = s.length;
  while (i < N) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { out += s.slice(i); break; }
    out += s.slice(i, lt);
    // find end of tag honouring quotes
    let j = lt + 1, quote = null;
    while (j < N) {
      const ch = s[j];
      if (quote) { if (ch === quote) quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
      j++;
    }
    if (j >= N) { // unterminated tag → escape the rest as text
      out += s.slice(lt).replace(/</g, '&lt;');
      break;
    }
    const inner = s.slice(lt + 1, j);
    i = j + 1;
    const closing = inner[0] === '/';
    const nameMatch = inner.match(/^\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)/);
    if (!nameMatch) { out += '&lt;' + __escAttr(inner) + '&gt;'; continue; }
    const tag = nameMatch[1].toLowerCase();
    const tagOut = /^(lineargradient|radialgradient|clippath|foreignobject|textpath|animatetransform|fecolormatrix|fegaussianblur|feoffset|femerge|femergenode|feblend|feflood|fecomposite)$/.test(tag) ? nameMatch[1] : tag;
    if (!allowTags.has(tag)) { dropped.tags++; continue; }
    if (tag === 'style' && allowStyleTag) {
      if (closing) { out += '</style>'; continue; }
      // keep the block only if its CSS is not a smuggling vehicle
      const close = s.toLowerCase().indexOf('</style', i);
      const css = close >= 0 ? s.slice(i, close) : '';
      const safeCss = css.replace(/<\/?script/gi, '').replace(/expression\s*\(/gi, '').replace(/-moz-binding|behaviou?r\s*:/gi, '');
      out += '<style>' + safeCss + '</style>';
      i = close >= 0 ? s.indexOf('>', close) + 1 : N;
      continue;
    }
    if (closing) { if (!VOID.has(tag)) out += '</' + tagOut + '>'; continue; }
    const selfClose = /\/\s*$/.test(inner);
    const attrsStr = inner.slice(nameMatch[0].length).replace(/\/\s*$/, '');
    const attrs = __parseAttrs(attrsStr);
    let kept = '';
    let iframeSrcOk = tag !== 'iframe';
    let formOk = true;
    for (const [name, value] of attrs) {
      const n = name.toLowerCase();
      if (!__attrAllowed(n, policy)) { dropped.attrs++; continue; }
      let v = value;
      if (v == null) { kept += ' ' + n; continue; }
      if (URL_ATTRS.has(n)) {
        if (n === 'srcset') {
          v = v.split(',').map((c) => c.trim()).filter((c) => nxSafeUrl(c.split(/\s+/)[0], { allowDataImage: true, allowDataSvg: true })).join(', ');
        } else {
          // data:image/* (incl. svg) is safe ONLY in an image context — <img>/<source>
          // never execute script. It stays rejected for href/action/poster/etc.
          const imgCtx = n === 'src' && (tag === 'img' || tag === 'source');
          const safe = nxSafeUrl(v, { allowDataImage: imgCtx, allowDataSvg: imgCtx, httpsOnly: tag === 'iframe' });
          if (!safe) { dropped.urls++; if (n === 'action') formOk = false; continue; }
          v = safe;
        }
        if (tag === 'iframe' && n === 'src') { iframeSrcOk = __iframeAllowed(v, policy); if (!iframeSrcOk) break; }
        if (tag === 'form' && n === 'action') {
          // a form may only post to its own origin (relative) or an allowlisted webhook
          const abs = /^https?:/i.test(v);
          if (abs && !(policy.formHosts || []).some((h) => { try { return new URL(v).hostname === h; } catch (e) { return false; } })) { formOk = false; continue; }
        }
      }
      if (n === 'style') { v = __safeStyle(v); if (!v) continue; }
      if (n === 'target' && !/^(_blank|_self)$/i.test(v)) continue;
      if (n === 'sandbox') { v = 'allow-scripts allow-same-origin allow-popups allow-forms'; }
      // Preserve the author's attribute case (SVG's viewBox/preserveAspectRatio are
      // case-sensitive in some serialisers); the allowlist check was case-insensitive.
      kept += ' ' + name + '="' + __escAttr(v) + '"';
    }
    if (tag === 'spline-viewer') {
      const u = (kept.match(/\burl="([^"]*)"/i) || [])[1] || '';
      if (!/^https:\/\/(prod|my|draft)\.spline\.design\//i.test(u)) { dropped.tags++; continue; }
    }
    if (tag === 'animate' || tag === 'animatetransform') {
      // SMIL can retarget ANY attribute (href → javascript:, or an event handler).
      // Only presentation attributes may be animated, and never with URL-ish values.
      const an = (kept.match(/\battributeName="([^"]*)"/i) || [])[1] || '';
      const okName = tag === 'animatetransform' ? /^transform$/i.test(an) : /^(r|cx|cy|x|y|x1|y1|x2|y2|rx|ry|width|height|opacity|fill|fill-opacity|stroke|stroke-opacity|stroke-width|stroke-dashoffset|stroke-dasharray|offset|stop-color|stop-opacity|d|points|transform|font-size|letter-spacing|dx|dy|rotate|flood-opacity|stdDeviation)$/i.test(an);
      const vals = (kept.match(/\b(?:values|from|to|by)="([^"]*)"/gi) || []).join(' ');
      if (!okName || /url\s*\(|javascript|data:|&#|<|>/i.test(vals)) { dropped.tags++; continue; }
    }
    if (tag === 'iframe') {
      if (!iframeSrcOk) { dropped.tags++; // also skip its (ignored) content
        const close = s.toLowerCase().indexOf('</iframe', i); if (close >= 0) i = s.indexOf('>', close) + 1; continue; }
      if (!/\bsandbox=/.test(kept)) kept += ' sandbox="allow-scripts allow-same-origin allow-popups allow-forms"';
      if (!/\bloading=/.test(kept)) kept += ' loading="lazy"';
      if (!/\breferrerpolicy=/.test(kept)) kept += ' referrerpolicy="strict-origin-when-cross-origin"';
    }
    if (tag === 'form' && !formOk) { dropped.tags++; // neutralise: keep contents as a div so inputs still lay out
      out += '<div class="nx-form-disabled"'; out += '>'; continue; }
    if (tag === 'a' && /target="_blank"/i.test(kept) && !/\brel=/.test(kept)) kept += ' rel="noopener noreferrer"';
    const svgLeaf = SVG_LEAF.has(tag);
    // SVG leaf elements keep their self-closing form (an unclosed <path> would swallow
    // its siblings); HTML elements never self-close, so emit an explicit close instead.
    out += '<' + tagOut + kept + (selfClose && svgLeaf ? '/' : '') + '>';
    if (selfClose && !VOID.has(tag) && !svgLeaf) out += '</' + tagOut + '>';
  }
  nxSanitizeFragment.lastReport = dropped;
  return out;
}

/**
 * Sanitise a WHOLE document produced by the design system. Keeps <head> metadata,
 * inline <style>, our own runtime <script> blocks (those passed in
 * policy.trustedScripts — exact-string match), and strips everything else.
 */
function nxSanitizeDocument(html, policy) {
  policy = policy || {};
  let s = String(html == null ? '' : html);
  const trusted = Array.isArray(policy.trustedScripts) ? policy.trustedScripts : [];
  // Pull out the head + body.
  const headM = s.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  const bodyM = s.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const bodyAttrsM = s.match(/<body\b([^>]*)>/i);
  const htmlAttrsM = s.match(/<html\b([^>]*)>/i);
  let head = headM ? headM[1] : '';
  let body = bodyM ? bodyM[1] : (headM ? '' : s);
  // head: allow meta/title/link(stylesheet,icon,preconnect,canonical)/style/script[ld+json]/trusted scripts
  const headOut = [];
  const headTokens = head.match(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<[^>]+>|[^<]+/gi) || [];
  for (const tok of headTokens) {
    if (/^<script/i.test(tok)) {
      if (/type\s*=\s*["']application\/ld\+json["']/i.test(tok)) {
        const inner = tok.replace(/^<script[^>]*>/i, '').replace(/<\/script>\s*$/i, '');
        let obj = null; try { obj = JSON.parse(inner); } catch (e) { obj = null; }
        if (obj) headOut.push('<script type="application/ld+json">' + nxJsonForScript(obj) + '</script>');
        continue;
      }
      if (trusted.includes(tok)) headOut.push(tok);
      continue;
    }
    if (/^<style/i.test(tok)) { headOut.push(tok.replace(/<\/?script/gi, '').replace(/expression\s*\(/gi, '')); continue; }
    if (/^<(meta|title|\/title|link|base)\b/i.test(tok)) {
      if (/^<base/i.test(tok)) continue;
      if (/^<meta/i.test(tok) && /http-equiv\s*=\s*["']?(refresh|set-cookie)/i.test(tok)) continue;
      if (/^<link/i.test(tok)) {
        const rel = (tok.match(/\brel\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
        if (!/^(stylesheet|icon|shortcut icon|apple-touch-icon|preconnect|dns-prefetch|canonical|manifest|preload|alternate)$/i.test(rel.trim())) continue;
        const href = (tok.match(/\bhref\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
        if (href && !nxSafeUrl(href, { allowDataImage: true, allowDataSvg: true })) continue;
        if (/\bon[a-z]+\s*=/i.test(tok)) continue;
      }
      if (/\bon[a-z]+\s*=/i.test(tok)) continue;
      headOut.push(tok);
      continue;
    }
    if (!/^</.test(tok)) headOut.push(tok); // whitespace/text
  }
  // body: strip scripts except trusted, then sanitise fragment
  const bodyScripts = [];
  body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => { if (trusted.includes(m)) { bodyScripts.push(m); return '\u0000NXSCRIPT' + (bodyScripts.length - 1) + '\u0000'; } return ''; });
  const bodyPolicy = Object.assign({}, policy, { allowStyleTag: true });
  body = nxSanitizeFragment(body, bodyPolicy);
  body = body.replace(/\u0000NXSCRIPT(\d+)\u0000/g, (m, k) => bodyScripts[Number(k)] || '');
  const htmlAttrs = htmlAttrsM ? __sanitizeAttrString(htmlAttrsM[1]) : '';
  const bodyAttrs = bodyAttrsM ? __sanitizeAttrString(bodyAttrsM[1]) : '';
  // Keep the author's doctype→<html> spacing so an untouched page round-trips
  // byte-for-byte (the journey tests pin "stored === built").
  const nl = /<!doctype[^>]*>\s*\n/i.test(s) ? '\n' : '';
  return '<!DOCTYPE html>' + nl + '<html' + htmlAttrs + '><head>' + headOut.join('') + '</head><body' + bodyAttrs + '>' + body + '</body></html>';
}

function __sanitizeAttrString(str) {
  let out = '';
  for (const [name, value] of __parseAttrs(str || '')) {
    const n = name.toLowerCase();
    if (!/^(lang|dir|class|id|style|data-[a-z0-9-]+|aria-[a-z-]+|role)$/.test(n)) continue;
    if (value == null) { out += ' ' + n; continue; }
    const v = n === 'style' ? __safeStyle(value) : value;
    if (n === 'style' && !v) continue;
    out += ' ' + n + '="' + __escAttr(v) + '"';
  }
  return out;
}

/** JSON that can be embedded inside <script> without closing it. */
function nxJsonForScript(value) {
  return JSON.stringify(value === undefined ? null : value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** A JS string literal (with quotes) safe inside <script>. */
function nxJsString(value) {
  return nxJsonForScript(String(value == null ? '' : value));
}

/**
 * Security headers for the public serve path. The generated runtime uses inline
 * <script> and inline <style>, so 'unsafe-inline' is required for now; the CSP
 * still removes the most damaging capabilities (foreign script/frames/objects,
 * form hijacking, base-uri, mixed content).
 */
function nxSecurityHeaders(opts) {
  opts = opts || {};
  // Script hosts our OWN runtimes load from (verified against every generated
  // runtime — SITE_JS, component scripts, three.js scenes, Spline viewer, and the
  // template runtime's optional in-browser LLM which dynamic-imports from
  // jsdelivr/esm.run and spins up a blob: module worker for WebGPU inference).
  // Inline scripts stay allowed because every page ships its runtime inline; the
  // sanitiser is what keeps untrusted inline scripts out of the document.
  const scriptHosts = ['https://unpkg.com', 'https://cdn.jsdelivr.net', 'https://esm.run', 'https://prod.spline.design'].concat(opts.scriptHosts || []);
  const frameHosts = (opts.iframeHosts || IFRAME_HOSTS).map((h) => 'https://' + h);
  const connect = ["'self'", 'https:', 'wss:', 'blob:', 'data:'];
  const ancestors = opts.frameAncestors || "'self'";
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: " + [...new Set(scriptHosts)].join(' '),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' https: data: blob:",
    'media-src https: data: blob:',
    'worker-src blob:',
    'frame-src ' + frameHosts.join(' '),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self' https://formsubmit.co " + (opts.formHosts || []).map((h) => 'https://' + h).join(' '),
    'frame-ancestors ' + ancestors,
    'connect-src ' + connect.join(' '),
    'upgrade-insecure-requests',
  ].join('; ').replace(/\s+;/g, ';');
  const headers = {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'X-Permitted-Cross-Domain-Policies': 'none',
  };
  // X-Frame-Options only exists for legacy agents and cannot express a specific
  // ancestor; emit it only when the policy is exactly SAMEORIGIN.
  if (ancestors === "'self'") headers['X-Frame-Options'] = 'SAMEORIGIN';
  return headers;
}

const nx_safe_html_api = { nxSanitizeFragment, nxSanitizeDocument, nxJsonForScript, nxJsString, nxSafeUrl, nxSecurityHeaders, IFRAME_HOSTS, BODY_TAGS };
if (typeof module !== 'undefined' && module.exports) module.exports = nx_safe_html_api;
if (typeof globalThis !== 'undefined') globalThis.NX_SAFE_HTML = nx_safe_html_api;
