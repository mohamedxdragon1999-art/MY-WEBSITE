// ═══════════════════════════════════════════════════════════════════════════
// validators/brief.js — strict schema validation for every website-builder
// input (POST /sites, PATCH /sites/:id, /ai/build-site, /ai/agentic-build).
//
// Design: CLOSED on shape, OPEN on vocabulary.
//   • Every known field has a type, a cap and (where it is an enum) a list.
//     A wrong type is an ERROR (400), never a silent coercion to "" — a client
//     that sends `name: {a:1}` or `services: "x"` has a bug and must hear it.
//   • The content plan may carry extra keys (the reference-template "words"
//     plan and scanned plans do); unknown keys survive only as bounded plain
//     JSON (depth ≤ 6, ≤ 60 keys per object, ≤ 50 items per array, strings
//     ≤ 2 000 chars) and are reported in `warnings`.
//   • Prototype-pollution keys (__proto__, constructor, prototype) are dropped
//     at every level, before anything downstream spreads the object.
//   • Nothing here sanitises HTML: XSS defence stays in nx_safe_html, which
//     runs on the OUTPUT. This module only guarantees that what reaches the
//     pipeline has the shape the pipeline was written for.
//
// Pure ESM, named exports only, no state, no globalThis writes.
// ═══════════════════════════════════════════════════════════════════════════

export const SITE_HTML_MAX = 600_000;        // bytes of stored page HTML (largest generated design ≈ 240 KB)
export const PLAN_JSON_MAX = 200_000;        // serialized content plan
export const FONT_IDS = Object.freeze(['', 'system', 'inter', 'poppins', 'playfair', 'space', 'dm']);
export const RADIUS_IDS = Object.freeze(['', 'default', 'sharp', 'round']);
export const ANIMATION_LEVELS = Object.freeze(['', 'balanced', 'subtle', 'expressive', 'none']);
export const THREE_D_IDS = Object.freeze(['', 'off', 'light', 'subtle', 'full']);
export const SECTION_IDS = Object.freeze([
  'nav', 'hero', 'marquee', 'stats', 'services', 'why', 'about', 'process', 'parallax', 'gallery', 'pricing', 'team',
  'timeline', 'logos', 'video', 'reviews', 'lead', 'faq', 'contact', 'map', 'footer', 'projects', 'calculator', 'funnel', 'band', 'chat',
]);
export const WIDGET_IDS = Object.freeze(['estimator', 'funnel', 'filter', 'stickycta']);
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/* ── primitive checkers (each returns {ok, value} or {error}) ─────────── */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function str(v, max, field, errors, opts) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
  if (typeof v !== 'string') { errors.push(`${field} must be text`); return ''; }
  const s = (opts && opts.keepWhitespace) ? v : v.replace(/\u0000/g, '');
  return s.length > max ? s.slice(0, max) : s;
}
function bool(v, field, errors) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === 0) return !!v;
  if (v === 'true' || v === 'false') return v === 'true';
  errors.push(`${field} must be true or false`);
  return undefined;
}
function oneOf(v, list, field, errors, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v !== 'string') { errors.push(`${field} must be text`); return fallback; }
  const s = v.trim().toLowerCase();
  if (!list.includes(s)) { errors.push(`${field} must be one of: ${list.filter(Boolean).join(', ')}`); return fallback; }
  return s;
}
function slug(v, field, errors) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string') { errors.push(`${field} must be text`); return ''; }
  const s = v.trim();
  if (!SLUG_RE.test(s)) { errors.push(`${field} has an invalid format`); return ''; }
  return s;
}
function hex(v, field, errors) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string') { errors.push(`${field} must be a hex colour like #1a73e8`); return ''; }
  const s = v.trim();
  if (!HEX_RE.test(s)) { errors.push(`${field} must be a hex colour like #1a73e8`); return ''; }
  return s.toLowerCase();
}
function int(v, min, max, field, errors, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? parseInt(v, 10) : NaN);
  if (!Number.isInteger(n)) { errors.push(`${field} must be a whole number`); return fallback; }
  return Math.max(min, Math.min(max, n));
}

/* ── bounded plain-JSON copy for open vocabulary ─────────────────────── */
export function boundedJson(v, depth, warnings, path) {
  depth = depth || 0;
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === 'string') return v.length > 2000 ? v.slice(0, 2000) : v;
  if (t === 'number') return Number.isFinite(v) ? v : 0;
  if (t === 'boolean') return v;
  if (depth >= 6) { if (warnings) warnings.push(`${path || 'plan'}: nested too deep — dropped`); return null; }
  if (Array.isArray(v)) return v.slice(0, 50).map((x, i) => boundedJson(x, depth + 1, warnings, (path || 'plan') + '[' + i + ']')).filter((x) => x !== undefined);
  if (t === 'object') {
    const out = {};
    let n = 0;
    for (const k of Object.keys(v)) {
      if (BAD_KEYS.has(k)) continue;
      if (++n > 60) { if (warnings) warnings.push(`${path || 'plan'}: more than 60 keys — extra keys dropped`); break; }
      const val = boundedJson(v[k], depth + 1, warnings, (path || 'plan') + '.' + k);
      if (val !== undefined) out[k.slice(0, 64)] = val;
    }
    return out;
  }
  return undefined; // functions, symbols, bigint: not JSON
}

/* ── content plan schema ─────────────────────────────────────────────── */
const PLAN_STRINGS = {
  site_name: 120, tagline: 200, hero_headline: 200, hero_sub: 400, cta_primary: 60, cta_secondary: 60, about: 2000,
  lead_title: 120, lead_text: 400, footer_note: 300, meta_desc: 300, hero_image: 2000, about_image: 2000, video_url: 2000,
  map_url: 2000, favicon: 8, owner: 80, ownerName: 80, pricing_note: 200, description: 4000, language: 12, industry: 60,
  tone: 60, goal: 200, audience: 300,
};
const PLAN_STRING_LISTS = { marquee_items: [10, 80], why_us: [8, 200], why: [8, 200], working_hours: [7, 80], gallery_imgs: [24, 2000], areas: [20, 80], suggestions: [12, 200] };
const PLAN_OBJECT_LISTS = { services: 12, reviews: 12, faqs: 12, faq: 12, team: 12, pricing: 8, timeline: 12, logos: 12, stats: 6, process: 8, projects: 12, socials: 10 };

export function validatePlan(plan, opts) {
  const errors = [], warnings = [];
  if (plan === undefined || plan === null || plan === '') return { ok: true, value: null, errors, warnings };
  if (typeof plan === 'string') {
    try { plan = JSON.parse(plan); } catch (e) { return { ok: false, value: null, errors: ['plan must be a JSON object'], warnings }; }
  }
  if (!isObj(plan)) return { ok: false, value: null, errors: ['plan must be an object'], warnings };
  const out = {};
  for (const [k, max] of Object.entries(PLAN_STRINGS)) {
    if (plan[k] === undefined || plan[k] === null) continue;
    if (isObj(plan[k]) || Array.isArray(plan[k])) { errors.push(`plan.${k} must be text`); continue; }
    out[k] = str(plan[k], max, 'plan.' + k, errors);
  }
  for (const [k, [maxItems, maxLen]] of Object.entries(PLAN_STRING_LISTS)) {
    if (plan[k] === undefined || plan[k] === null) continue;
    if (!Array.isArray(plan[k])) { errors.push(`plan.${k} must be a list`); continue; }
    out[k] = plan[k].slice(0, maxItems).map((x) => (isObj(x) ? boundedJson(x, 3, warnings, 'plan.' + k) : str(x, maxLen, 'plan.' + k + '[]', errors))).filter((x) => x !== '' && x !== null && x !== undefined);
  }
  for (const [k, maxItems] of Object.entries(PLAN_OBJECT_LISTS)) {
    if (plan[k] === undefined || plan[k] === null) continue;
    if (!Array.isArray(plan[k])) { errors.push(`plan.${k} must be a list`); continue; }
    if (plan[k].length > maxItems) warnings.push(`plan.${k}: only the first ${maxItems} items are used`);
    out[k] = plan[k].slice(0, maxItems).map((x, i) => {
      if (typeof x === 'string') return str(x, 400, `plan.${k}[${i}]`, errors);
      if (!isObj(x)) { errors.push(`plan.${k}[${i}] must be an object`); return null; }
      return boundedJson(x, 3, warnings, `plan.${k}[${i}]`);
    }).filter((x) => x !== null && x !== '');
  }
  if (plan.contact !== undefined && plan.contact !== null) {
    if (!isObj(plan.contact)) errors.push('plan.contact must be an object');
    else out.contact = { phone: str(plan.contact.phone, 40, 'plan.contact.phone', errors), email: str(plan.contact.email, 120, 'plan.contact.email', errors), address: str(plan.contact.address, 200, 'plan.contact.address', errors), whatsapp: str(plan.contact.whatsapp, 40, 'plan.contact.whatsapp', errors) };
  }
  const known = new Set([...Object.keys(PLAN_STRINGS), ...Object.keys(PLAN_STRING_LISTS), ...Object.keys(PLAN_OBJECT_LISTS), 'contact']);
  for (const k of Object.keys(plan)) {
    if (known.has(k) || BAD_KEYS.has(k)) continue;
    const v = boundedJson(plan[k], 1, warnings, 'plan.' + k);
    if (v !== undefined) { out[k.slice(0, 64)] = v; if (!/^_/.test(k)) warnings.push(`plan.${k}: not a standard plan field (kept)`); }
  }
  const size = JSON.stringify(out).length;
  if (size > PLAN_JSON_MAX) errors.push(`plan is too large (${size} chars, max ${PLAN_JSON_MAX})`);
  return { ok: errors.length === 0, value: out, errors, warnings };
}

/* ── site body schema (create / update / build) ──────────────────────── */
/**
 * Validate a website-builder request body.
 * mode: 'create' (POST /sites) | 'update' (PATCH /sites/:id) | 'build' (/ai/build-site, /ai/agentic-build)
 * Returns { ok, value, errors, warnings, tooLarge }. `value` contains ONLY known
 * fields, typed and capped; absent fields stay undefined so callers can tell
 * "not sent" from "sent empty".
 */
export function validateSiteBody(body, mode) {
  const errors = [], warnings = [];
  mode = mode || 'create';
  if (!isObj(body)) return { ok: false, value: {}, errors: ['request body must be a JSON object'], warnings };
  const v = {};
  if (body.name !== undefined) {
    if (isObj(body.name) || Array.isArray(body.name)) errors.push('name must be text');
    else v.name = str(body.name, 120, 'name', errors).trim();
  }
  if (mode === 'create' && !v.name) errors.push('Name is required');
  if (body.description !== undefined) v.description = isObj(body.description) || Array.isArray(body.description) ? (errors.push('description must be text'), '') : str(body.description, 4000, 'description', errors);
  if (body.instructions !== undefined) v.instructions = isObj(body.instructions) || Array.isArray(body.instructions) ? (errors.push('instructions must be text'), '') : str(body.instructions, 2000, 'instructions', errors);
  if (body.html !== undefined) {
    if (typeof body.html !== 'string') errors.push('html must be a string');
    else if (body.html.length > SITE_HTML_MAX) return { ok: false, value: v, errors: [`html is too large (${body.html.length} bytes, max ${SITE_HTML_MAX})`], warnings, tooLarge: true };
    else v.html = body.html;
  }
  for (const k of ['published', 'build_with_ai', 'deterministic', 'overwrite', 'auto_design']) if (body[k] !== undefined) v[k] = bool(body[k], k, errors);
  if (body.publish_action !== undefined) v.publish_action = oneOf(body.publish_action, ['publish', 'unpublish'], 'publish_action', errors, '');
  if (body.design_id !== undefined) v.design_id = slug(body.design_id, 'design_id', errors);
  for (const k of ['theme_id', 'hero_style', 'anim_preset', 'card_style', 'nav_style', 'scene_id', 'concept_id', 'direction']) if (body[k] !== undefined) v[k] = slug(body[k], k, errors);
  if (body.three_d !== undefined) v.three_d = oneOf(body.three_d, THREE_D_IDS, 'three_d', errors, '');
  if (body.font !== undefined) v.font = oneOf(body.font, FONT_IDS, 'font', errors, '');
  if (body.radius !== undefined) v.radius = oneOf(body.radius, RADIUS_IDS, 'radius', errors, '');
  if (body.animation_level !== undefined) v.animation_level = oneOf(body.animation_level, ANIMATION_LEVELS, 'animation_level', errors, '');
  if (body.accent !== undefined) v.accent = hex(body.accent, 'accent', errors);
  if (body.accent2 !== undefined) v.accent2 = hex(body.accent2, 'accent2', errors);
  if (body.variant !== undefined) v.variant = int(body.variant, 0, 9, 'variant', errors, 0);
  if (body.favicon !== undefined) v.favicon = str(body.favicon, 8, 'favicon', errors);
  if (body.scene_text !== undefined) v.scene_text = str(body.scene_text, 40, 'scene_text', errors);
  if (body.webhook_url !== undefined) v.webhook_url = str(body.webhook_url, 500, 'webhook_url', errors).trim();
  if (body.spline_url !== undefined) v.spline_url = str(body.spline_url, 400, 'spline_url', errors).trim();
  if (body.custom_css !== undefined) {
    if (typeof body.custom_css !== 'string') errors.push('custom_css must be text');
    else v.custom_css = body.custom_css.slice(0, 8000).replace(/<\/style/gi, '').replace(/<script/gi, '');
  }
  // Interactive widgets: true/false (auto / none) or a list of kinds.
  if (body.widgets !== undefined) {
    if (body.widgets === null || body.widgets === true || body.widgets === 'true') v.widgets = true;
    else if (body.widgets === false || body.widgets === 'false') v.widgets = false;
    else if (Array.isArray(body.widgets)) {
      const kinds = [];
      for (const k of body.widgets.slice(0, 8)) {
        if (typeof k !== 'string') { errors.push('widgets must contain only widget ids'); break; }
        const id = k.trim().toLowerCase();
        if (!WIDGET_IDS.includes(id)) { warnings.push(`widgets: "${id.slice(0, 20)}" is not a known widget (ignored)`); continue; }
        kinds.push(id);
      }
      v.widgets = kinds;
    } else errors.push('widgets must be true, false or a list of widget ids');
  }
  if (body.sections !== undefined) {
    if (body.sections === null) v.sections = null;
    else if (!Array.isArray(body.sections)) errors.push('sections must be a list of section ids');
    else {
      const secs = [];
      for (const s of body.sections.slice(0, 40)) {
        if (typeof s !== 'string') { errors.push('sections must contain only text ids'); break; }
        const id = s.trim().toLowerCase();
        if (!SLUG_RE.test(id)) { errors.push(`sections: "${s.slice(0, 20)}" is not a valid section id`); break; }
        if (!SECTION_IDS.includes(id)) warnings.push(`sections: "${id}" is not a known section (ignored by the renderer)`);
        secs.push(id);
      }
      v.sections = secs;
    }
  }
  if (body.plan !== undefined) {
    const p = validatePlan(body.plan);
    errors.push(...p.errors); warnings.push(...p.warnings);
    v.plan = p.value;
  }
  // Visual editor (POST /sites/:id/visual): a bounded list of CSS/text
  // overrides keyed by selector. Selectors are capped strings (the applier
  // matches them structurally — never eval'd); css is a flat map of string
  // values; text is plain text. Anything else is a 400 with the field name.
  const CSS_VAL_RE = /^[^<>{};]{0,300}$/;
  const cleanCss = (css, label) => {
    if (css === null || css === undefined) return null;
    if (!isObj(css)) { errors.push(`${label} must be an object of CSS properties`); return null; }
    const out = {};
    for (const [k, val] of Object.entries(css).slice(0, 40)) {
      if (!/^[a-zA-Z-]{1,60}$/.test(k)) { errors.push(`${label}: "${String(k).slice(0, 20)}" is not a CSS property name`); return null; }
      const sv = typeof val === 'number' ? String(val) : val;
      if (typeof sv !== 'string' || !CSS_VAL_RE.test(sv)) { errors.push(`${label}.${k} must be a plain CSS value`); return null; }
      out[k] = sv;
    }
    return out;
  };
  if (body.overrides !== undefined) {
    if (!Array.isArray(body.overrides)) errors.push('overrides must be a list');
    else {
      v.overrides = [];
      for (const o of body.overrides.slice(0, 60)) {
        if (!isObj(o)) { errors.push('overrides must contain objects'); break; }
        const item = { selector: str(o.selector, 300, 'overrides.selector', errors).trim() };
        if (o.css !== undefined) item.css = cleanCss(o.css, 'overrides.css');
        if (o.text !== undefined && o.text !== null) item.text = isObj(o.text) || Array.isArray(o.text) ? (errors.push('overrides.text must be text'), '') : str(o.text, 2000, 'overrides.text', errors);
        v.overrides.push(item);
      }
      if (body.overrides.length > 60) warnings.push('overrides: only the first 60 were applied');
    }
  }
  if (body.selector !== undefined) v.selector = str(body.selector, 300, 'selector', errors).trim();
  if (body.element_css !== undefined) v.element_css = str(body.element_css, 4000, 'element_css', errors);
  if (body.command !== undefined) v.command = str(body.command, 500, 'command', errors);
  if (body.text !== undefined && body.text !== null) v.text = isObj(body.text) || Array.isArray(body.text) ? (errors.push('text must be text'), '') : str(body.text, 2000, 'text', errors);
  for (const k of ['label', 'brief', 'headline', 'sub', 'cta']) if (body[k] !== undefined) v[k] = isObj(body[k]) || Array.isArray(body[k]) ? (errors.push(`${k} must be text`), '') : str(body[k], k === 'brief' ? 600 : 200, k, errors);
  return { ok: errors.length === 0, value: v, errors, warnings };
}

/** One-line error message for a 400 response. */
export function briefErrorMessage(result) {
  const e = (result && result.errors) || [];
  if (!e.length) return '';
  return e.length === 1 ? e[0] : e[0] + ` (+${e.length - 1} more: ` + e.slice(1, 4).join('; ') + ')';
}
