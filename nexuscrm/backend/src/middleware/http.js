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
