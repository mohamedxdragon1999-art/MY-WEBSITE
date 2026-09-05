// ══════════════════════════════════════════════════════════════════════════
// middleware/http.js — HTTP response construction and CORS.
//
// First extraction from the 11.9k-line worker. Chosen deliberately: these are
// PURE functions with no dependencies and no shared mutable state, so the
// extraction cannot change behaviour. Strict ESM, named exports only — no
// internal helpers leak, and nothing is published on globalThis.
// ══════════════════════════════════════════════════════════════════════════

/** Security + CORS headers applied to every JSON response. */
export function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer-when-downgrade',
  };
}

/**
 * Origin allow-list for the PUBLIC site route — the one place where reflecting
 * the request Origin is a real grant (CORS + `frame-ancestors`, i.e. "you may
 * embed this page"). The API itself is Bearer-authenticated (no cookies), so
 * reflection there confers nothing; the public page is different.
 *
 *   ALLOWED_ORIGINS unset/empty → permissive (local dev, file://, any host)
 *   ALLOWED_ORIGINS="https://app.example.com, https://crm.example.com"
 *                        → only those origins are granted; every other
 *                          Origin gets NO cors headers and NO frame grant
 *                          (the page still serves — same-origin embedding
 *                          and direct visits are unaffected).
 *
 * Returns the origin to grant, or '' when the caller must not be granted.
 */
export function allowedPublicOrigin(env, origin) {
  const o = String(origin || '').trim();
  if (!o || o === '*' || o === 'null') return '';
  let parsed;
  try { parsed = new URL(o); } catch (e) { return ''; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
  const raw = env && env.ALLOWED_ORIGINS != null ? String(env.ALLOWED_ORIGINS).trim() : '';
  if (!raw) return parsed.origin; // permissive mode (no allow-list configured)
  if (raw === '*') return parsed.origin;
  const list = raw.split(/[\s,]+/).map((x) => x.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean);
  const want = parsed.origin.toLowerCase();
  for (const entry of list) {
    if (entry === want) return parsed.origin;
    // "*.example.com" grants any subdomain (never the bare apex by accident)
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1); // ".example.com"
      const host = parsed.hostname.toLowerCase();
      if (host.endsWith(suffix) && host.length > suffix.length) return parsed.origin;
    }
    if (entry.startsWith('https://*.') || entry.startsWith('http://*.')) {
      const [scheme, rest] = entry.split('://');
      const suffix = rest.slice(1);
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol === scheme + ':' && host.endsWith(suffix) && host.length > suffix.length) return parsed.origin;
    }
  }
  return '';
}

/** A JSON response carrying the standard header set. */
export function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

/** A JSON error response. Shape is `{ error: message }` — clients rely on it. */
export function err(message, status, origin) {
  return json({ error: message }, status || 400, origin);
}
