// ══════════════════════════════════════════════════════════════════════════
// nx_site_output.js — the SITE OUTPUT CONTRACT glue (v0.0.0.0.19).
//
// Everything that decides what a stored / served page may contain lives here,
// on top of the zero-dependency primitives in nx_safe_html.js:
//
//   • nxSafeWebhookUrl / nxSetLeadUrl   — the lead-form endpoint is an http(s)
//                                          URL, embedded as a JS string literal
//   • nxSafeSplineUrl                    — Spline scenes are host-pinned
//   • nxDecodeEntities                   — <title> text → plain text (no
//                                          double-encoding on every save)
//   • nxSanitizeUserDocument             — whole-document sanitiser for user
//                                          uploads / visual-editor saves; only
//                                          scripts that are byte-identical to
//                                          our own runtimes survive
//   • servePublicSite / nxPublicSiteHeaders — one public serve path with CSP
//
// Strict ESM, named exports, no globalThis writes, no worker state. The
// runtime sources that identify "our own scripts" are passed in by index.js
// (SITE_JS, NX_RUNTIME_LIB) so this module never imports the monolith.
// ══════════════════════════════════════════════════════════════════════════
import NX_SAFE_HTML from './nx_safe_html.js';

const { nxSafeUrl, nxJsString, nxSanitizeDocument, nxSecurityHeaders } = NX_SAFE_HTML;

/** Accept only absolute http(s) webhook targets without embedded credentials. */
export function nxSafeWebhookUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const safe = nxSafeUrl(s, { httpsOnly: false });
  if (!safe || !/^https?:\/\//i.test(safe)) return '';
  try { const u = new URL(safe); if (u.username || u.password) return ''; return u.href; } catch (e) { return ''; }
}

/**
 * Point an already-rendered page's lead form at a webhook (idempotent). The
 * runtime reads `var NX_LEAD_URL='…'`; only that literal is rewritten, as a
 * JSON string so the value can never close the literal or the script block.
 */
export function nxSetLeadUrl(html, url) {
  const lit = nxJsString(nxSafeWebhookUrl(url));
  return String(html || '').replace(/var NX_LEAD_URL=(?:'[^']*'|"(?:[^"\\]|\\.)*");/, 'var NX_LEAD_URL=' + lit + ';');
}

/** Spline scene files may only come from *.spline.design. */
export function nxSafeSplineUrl(raw) {
  const u = String(raw || '').trim();
  if (!u || u.length > 400) return '';
  if (!/^https:\/\/(prod|my|draft|app)\.spline\.design\/[A-Za-z0-9_\-\/.]+$/i.test(u)) return '';
  return u;
}

/** Decode the entities that appear in <title>/text content back to characters. */
export function nxDecodeEntities(t) {
  return String(t || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') { const c = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return (c > 0 && c < 0x110000) ? String.fromCodePoint(c) : m; }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }[k] || m;
  });
}

/**
 * Is this <script> one of the runtimes we generate? Compared against the live
 * sources (not a hash list) so a runtime edit cannot strand existing sites.
 * `runtimes` = { siteJs, runtimeLib } supplied by the worker.
 */
export function nxIsOwnRuntimeScript(scriptTag, runtimes) {
  runtimes = runtimes || {};
  const open = (scriptTag.match(/^<script\b[^>]*>/i) || [''])[0];
  const body = scriptTag.slice(open.length).replace(/<\/script>\s*$/i, '');
  if (/\bsrc\s*=/i.test(open)) {
    return /^<script\s+type="module"\s+src="https:\/\/unpkg\.com\/@splinetool\/viewer@[0-9.]+\/build\/spline-viewer\.js"\s*>$/i.test(open) && body.trim() === '';
  }
  if (/application\/ld\+json/i.test(open)) return false; // re-emitted from parsed JSON by the document sanitiser
  const t = body.trim();
  if (!t) return false;
  // Generic site runtime (SITE_JS + component/scene scripts concatenated into one block).
  const siteJs = String(runtimes.siteJs || '').trim();
  if (siteJs && t.startsWith(siteJs.slice(0, 120))) return true;
  // Reference-template runtime + its config literal.
  if (/^"use strict";\s*window\.__mainReadyAt=performance\.now\(\);/.test(t)) return true;
  if (/^window\.__NX_CFG=\{[\s\S]*\};?$/.test(t) && !/[<>]/.test(t)) return true;
  // Composition / graph runtimes (exact prefixes of the sources nx_compose.js and
  // the worker emit; a hostile script would have to BE one of our runtimes).
  if (/^\(function\(\)\{\s*var mm=function\(q\)\{try\{return \(typeof matchMedia!=='undefined'\)\?matchMedia\(q\)/.test(t)) return true;
  if (/^\(function\(\)\{\s*var reduce=window\.matchMedia&&window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches;\s*var els=\[\]\.slice\.call\(document\.querySelectorAll\('\[data-r\]'\)\);/.test(t)) return true;
  if (/^\(function\(\)\{"use strict";\s*var reduce=window\.matchMedia&&window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches;/.test(t)) return true;
  const lib = String(runtimes.runtimeLib || '');
  if (lib && t.startsWith("(function(){'use strict';" + lib.slice(0, 200))) return true;
  return false;
}

/**
 * Whole-document sanitiser for user-supplied pages (imports, visual-editor
 * saves, duplicates). Head keeps meta/link/style/JSON-LD; body keeps the
 * allowlist; the ONLY scripts that survive are our own runtimes.
 */
export function nxSanitizeUserDocument(html, runtimes) {
  const s = String(html || '').slice(0, 400000);
  const scripts = s.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  const trusted = scripts.filter((sc) => nxIsOwnRuntimeScript(sc, runtimes));
  return nxSanitizeDocument(s, { trustedScripts: trusted });
}

// ── PUBLIC SITE SERVE ───────────────────────────────────────────────────────
// Rules: no auth; only published=1 rows; only the stored html column; every
// response carries the hardening headers + a CSP pinned to the CDN hosts our
// runtimes use and the embed hosts the sanitiser allows. The serve path never
// touches AI or provider state, so a public page stays up when the builder is
// down (W5).
export const NX_PUBLIC_HTML_404 = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#0b0e14;color:#e6e9ef;display:grid;place-items:center;min-height:100vh;margin:0}main{text-align:center;padding:24px}h1{font-size:22px;margin:0 0 8px}p{color:#9aa3b2;margin:0}</style></head><body><main><h1>Site not found</h1><p>This address does not point to a published site.</p></main></body></html>';
const NX_PUBLIC_HTML_503 = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Temporarily unavailable</title></head><body><h1>Temporarily unavailable</h1><p>Please try again in a moment.</p></body></html>';

export function nxPublicSiteHeaders(extra) {
  const h = nxSecurityHeaders({});
  const out = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' };
  for (const k of Object.keys(h)) if (h[k] !== undefined && h[k] !== null) out[k] = h[k];
  return Object.assign(out, extra || {});
}

export function nxPublicNotFound() {
  return new Response(NX_PUBLIC_HTML_404, { status: 404, headers: nxPublicSiteHeaders({ 'Cache-Control': 'no-store' }) });
}

export async function servePublicSite(env, slug) {
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(String(slug || ''))) return nxPublicNotFound();
  let site = null;
  try {
    site = await env.DB.prepare('SELECT html, published FROM sites WHERE slug=?').bind(slug).first();
  } catch (e) {
    return new Response(NX_PUBLIC_HTML_503, { status: 503, headers: nxPublicSiteHeaders({ 'Cache-Control': 'no-store', 'Retry-After': '30' }) });
  }
  if (!site || !site.published) return nxPublicNotFound();
  return new Response(String(site.html || ''), { status: 200, headers: nxPublicSiteHeaders() });
}

/**
 * Legacy /api/public/site/:slug — same page, plus CORS for the dashboard and a
 * frame-ancestors grant for the requesting origin (the dashboard previews the
 * page in an iframe). X-Frame-Options cannot express a specific ancestor, so
 * it is dropped whenever one is granted; the CSP is the source of truth.
 */
export async function servePublicSiteForOrigin(env, slug, origin, corsHeaders) {
  const res = await servePublicSite(env, slug);
  const h = new Headers(res.headers);
  // `origin` is the ALREADY-VETTED origin to grant (see allowedPublicOrigin in
  // middleware/http.js). Empty means "no grant": the page serves with its
  // default same-origin frame policy and WITHOUT any Access-Control headers —
  // an unknown site can neither iframe nor read it cross-origin.
  const grant = /^https?:\/\/[^\s/]+$/i.test(String(origin || '')) ? String(origin) : '';
  if (grant) {
    const cors = corsHeaders ? corsHeaders(grant) : {};
    for (const k of Object.keys(cors)) if (/^access-control-/i.test(k)) h.set(k, cors[k]);
    h.set('Vary', 'Origin');
    h.set('Content-Security-Policy', String(h.get('Content-Security-Policy') || '').replace(/frame-ancestors [^;]*/, "frame-ancestors 'self' " + grant));
    h.delete('X-Frame-Options');
  }
  return new Response(res.body, { status: res.status, headers: h });
}
