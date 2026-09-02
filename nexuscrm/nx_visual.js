// ─────────────────────────────────────────────────────────────────────────────
// NXCROOM AI VISUAL EDITOR
// 1) nxVisualCommand(instruction, context) — deterministic natural-language →
//    CSS/text action for common edits (size, color, text, bold, align, padding,
//    radius, shadow, hide). Runs locally with NO AI key; optional AI assist can
//    be layered on top for freeform wording.
// 2) nxComputeSelector(element) — a robust, stable CSS selector for a DOM node.
// 3) nxVisualCss(overrides) — joins selector → rules into a <style> body.
// Pure / DOM-optional (selector needs a DOM node); command is pure.
// ─────────────────────────────────────────────────────────────────────────────

const NX_VISUAL_COLORS = {
  orange: '#f7742a', red: '#ef4444', blue: '#3b82f6', green: '#22c55e',
  purple: '#a855f7', pink: '#ec4899', teal: '#14b8a6', yellow: '#eab308',
  black: '#0b0e14', white: '#ffffff', gray: '#64748b', grey: '#64748b',
  navy: '#1e3a8a', gold: '#f5b301', 'dark blue': '#1e3a8a', 'light gray': '#e2e8f0',
};

function _curve(v, factor, unit) {
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) return null;
  const out = Math.round(n * factor * 10) / 10;
  return out + (unit || (String(v).replace(/[0-9.,]/g, '') || 'px'));
}
function _pad(v, factor) {
  if (!v) return null;
  const parts = String(v).trim().split(/\s+/);
  const unit = parts[0].replace(/[0-9.,]/g, '') || 'px';
  const u = (s) => _curve(s, factor, unit);
  if (parts.length === 1) return u(parts[0]);
  return parts.map(u).join(' ');
}
function _extractText(raw) {
  // Match explicit "change/set/rename ... to X", "make it/this say X", "say X",
  // "write X", "read X", "label it as X". Case-insensitive but PRESERVES the
  // original capitalization of the captured text. Only fires on a clear verb.
  const m = String(raw).match(/(?:change|set|rename)\b[\s\S]*?\bto\b|make (?:this|it) say|make this say|say\b|write\b|read\b|label it(?: as)?/i);
  if (!m) return null;
  const verb = m[0];
  const idx = String(raw).toLowerCase().indexOf(verb.toLowerCase());
  let rest = String(raw).slice(idx + verb.length);
  // for change/set/rename ... to, strip up to and incl. the trailing "to"
  if (/^(?:change|set|rename)/i.test(verb.trim()) && !/^make|^say|^write|^read|^label/i.test(verb.trim())) {
    const toIdx = rest.toLowerCase().indexOf('to');
    if (toIdx !== -1) rest = rest.slice(toIdx + 2);
  }
  rest = rest.replace(/^[:.\s"']+/, '').replace(/[."'!]+$/, '').trim();
  return rest || null;
}

function nxVisualCommand(instruction, ctx) {
  ctx = ctx || {};
  const cur = ctx.css || {};
  const raw = String(instruction || '').replace(/[.,!]+$/g, '').trim();
  const i = raw.toLowerCase();
  const out = { css: {}, text: null, action: null, summary: '' };
  if (!i) return { error: 'empty' };

  // ── size ──
  let m = i.match(/(?:font-?size|size|text)\s*(?:to|of|=)\s*([0-9.]+)\s*(px|em|rem|%)/);
  if (m) { out.css.fontSize = m[1] + m[2]; out.action = 'size'; }
  else if (/(much |way )?(bigger|larger|huge|increase the size|make (it|this|the (?:text|heading|button)) bigger)/.test(i) || /\b(bigger|larger)\b/.test(i)) {
    const f = /(huge|much bigger|way bigger)/.test(i) ? 1.6 : 1.35;
    const v = _curve(cur.fontSize, f); if (v) { out.css.fontSize = v; out.action = 'size'; }
  }
  else if (/\b(smaller|smaller text|decrease the size|make (it|this) smaller)\b/.test(i)) {
    const v = _curve(cur.fontSize, 0.72); if (v) { out.css.fontSize = v; out.action = 'size'; }
  }

  // ── color / background ──
  const colM = i.match(/\b(navy|dark blue|light gray|orange|red|blue|green|purple|pink|teal|yellow|black|white|gray|grey|gold)\b/);
  const hexM = i.match(/#[0-9a-f]{3,6}\b/i);
  const bg = /background|bg|fill/.test(i);
  if (colM && NX_VISUAL_COLORS[colM[1]]) {
    if (bg) out.css.backgroundColor = NX_VISUAL_COLORS[colM[1]];
    else out.css.color = NX_VISUAL_COLORS[colM[1]];
    out.action = bg ? 'background' : 'color';
  } else if (hexM) {
    if (bg) out.css.backgroundColor = hexM[0]; else out.css.color = hexM[0];
    out.action = bg ? 'background' : 'color';
  }

  // ── weight / style ──
  if (/\bbold\b|make (it|this) bold/.test(i)) { out.css.fontWeight = '700'; out.action = 'weight'; }
  else if (/\bthin\b|light weight|lighter\b/.test(i)) { out.css.fontWeight = '400'; out.action = 'weight'; }
  if (/\bitalic\b/.test(i)) { out.css.fontStyle = 'italic'; out.action = 'style'; }
  if (/\bunderline\b/.test(i)) { out.css.textDecoration = 'underline'; out.action = 'style'; }
  if (/\buppercase|all caps|caps\b/.test(i)) { out.css.textTransform = 'uppercase'; out.action = 'transform'; }

  // ── alignment ──
  if (/\b(center|centred|centered|align center|middle)\b/.test(i)) { out.css.textAlign = 'center'; out.action = 'align'; }
  else if (/\b(right align|align right|justify right)\b/.test(i)) { out.css.textAlign = 'right'; out.action = 'align'; }
  else if (/\b(left align|align left|justify left)\b/.test(i)) { out.css.textAlign = 'left'; out.action = 'align'; }

  // ── spacing / padding / radius / shadow ──
  if (/\bmore padding|add padding|more space|increase padding|spread out\b/.test(i)) { const v = _pad(cur.padding, 1.25); if (v) { out.css.padding = v; out.action = 'padding'; } }
  else if (/\bless padding|reduce padding|less space|tighten\b/.test(i)) { const v = _pad(cur.padding, 0.75); if (v) { out.css.padding = v; out.action = 'padding'; } }
  if (/\brounded|round the corners|round corners\b/.test(i)) { out.css.borderRadius = '16px'; out.action = 'radius'; }
  if (/\bshadow|drop shadow|add depth\b/.test(i)) { out.css.boxShadow = '0 12px 34px rgba(0,0,0,.22)'; out.action = 'shadow'; }

  // ── hide / remove ──
  if (/\b(hide|remove|delete|get rid of|disappear)\b/.test(i)) { out.css.display = 'none'; out.action = 'hide'; }

  // ── text change (lowest priority; only if nothing else matched) ──
  if (!out.action) {
    const t = _extractText(raw);
    if (t) { out.text = t; out.action = 'text'; }
  }

  if (!out.action) return { error: 'unsupported' };
  out.summary = (out.action === 'text') ? ('Text → "' + out.text + '"') : (out.action + ': ' + Object.entries(out.css).map(([k, v]) => k + ' ' + v).join(', '));
  return out;
}

// Robust, stable CSS selector for a DOM element (chromium/jsdom-safe).
function nxComputeSelector(el, root) {
  if (!el || el.nodeType !== 1) return null;
  root = root || document || ((el.ownerDocument && el.ownerDocument.body) || el);
  if (el === root || el === root.body) return 'body';
  // prefer id
  if (el.id) return '#' + _cssEscape(el.id);
  const parts = [];
  let node = el;
  while (node && node !== root && node.nodeType === 1) {
    let seg = node.tagName.toLowerCase();
    const cls = (typeof node.className === 'string' ? node.className : '')
      .trim().split(/\s+/).filter(Boolean)
      .map(c => '.' + _cssEscape(c)).join('');
    // disambiguate among siblings of the same tag+class combo
    const same = node.parentElement ? Array.prototype.filter.call(node.parentElement.children, (s) =>
      s.tagName === node.tagName && (s.className || '') === (node.className || '')) : [node];
    if (same.length > 1) {
      const idx = same.indexOf(node);
      if (idx >= 0) seg += (cls ? '' : '') + ':nth-of-type(' + (idx + 1) + ')';
    }
    parts.unshift(seg + (cls && seg.indexOf(cls) === -1 ? cls : ''));
    node = node.parentElement;
    if (node && node !== root && node.children && node.children.length < 2) break; // avoid over-qualifying
  }
  return parts.join(' > ');
}

// camelCase → kebab-case so style-object keys (fontSize, backgroundColor…) become
// VALID CSS property names in a stylesheet (font-size, background-color…).
function _kebab(k) { return String(k).replace(/([A-Z])/g, '-$1').toLowerCase(); }

// CSS.escape falls back to a manual escape when the global is unavailable
// (jsdom, some embedded runtimes) — ids/classes keep working.
function _cssEscape(s) {
  if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(s);
  return String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]/g, (c) => '\\' + c);
}

// Join a list of { selector, css } into a CSS body string.
function nxVisualCss(overrides) {
  return (overrides || []).filter(o => o && o.selector && o.css && Object.keys(o.css).length)
    .map(o => o.selector + ' { ' + Object.entries(o.css).map(([k, v]) => _kebab(k) + ':' + v + ';').join(' ') + ' }')
    .join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { nxVisualCommand, nxComputeSelector, nxVisualCss, NX_VISUAL_COLORS };
}
