// ══════════════════════════════════════════════════════════════════════════
// validators/input.js — request-payload validation and sanitisation.
//
// Pure predicates and normalisers with no I/O and no shared state. Isolating
// them means D1 query code (Priority #3) can be moved without dragging
// validation along, and these can be unit-tested directly rather than only
// through a route.
//
// Strict ESM, named exports only.
// ══════════════════════════════════════════════════════════════════════════

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** RFC-length-bounded email check. */
export function isValidEmail(e) {
  return typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e);
}

/** Membership test used by the route handlers for enum-like fields. */
export function isIn(v, list) { return list.includes(v); }

/** Copy only the listed keys that are actually present. */
export function pick(obj, keys) {
  const o = {};
  keys.forEach((k) => { if (obj[k] !== undefined) o[k] = obj[k]; });
  return o;
}

// Custom fields arrive as an object {label: value} — store only plain string
// values, capped, so the column can never hold garbage.
export function sanitizeCustomFields(cf) {
  if (!cf || typeof cf !== 'object' || Array.isArray(cf)) return '{}';
  const out = {};
  for (const [k, v] of Object.entries(cf)) {
    const key = String(k).slice(0, 60).trim();
    if (!key) continue;
    out[key] = String(v == null ? '' : v).slice(0, 500);
  }
  return JSON.stringify(out);
}

/** Inverse of sanitizeCustomFields; never throws on malformed stored JSON. */
export function parseCustomFields(cf) {
  try { const p = JSON.parse(cf || '{}'); return p && typeof p === 'object' ? p : {}; }
  catch { return {}; }
}
