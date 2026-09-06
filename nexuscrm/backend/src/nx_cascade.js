'use strict';
// ══════════════════════════════════════════════════════════════════════════
// nx_cascade.js — RESOLVE WHAT THE USER ACTUALLY SEES
//
// Every check we had until now inspected MARKUP ("is class X present?") or
// grepped the stylesheet text. Neither answers the only question that matters:
// what colour, size and font does this element actually END UP with?
//
// jsdom parses the DOM but performs no cascade for custom properties — it
// returns the literal string "var(--font)". So a page could declare a hot
// orange accent, never reference it, and every markup-level test would pass
// while the rendered site looked grey.
//
// This module parses the real stylesheet with css-tree, resolves the custom
// property graph (including nested and fallback var() forms), matches simple
// selectors against elements, and reports COMPUTED declared values. It is not a
// full browser — no layout, no inheritance chains for every property — but it
// turns "the class is present" into "the colour is #FF5F00", which is the
// difference between testing a string and testing a design.
// ══════════════════════════════════════════════════════════════════════════
const csstree = require('css-tree');

function __styleText(html) {
  const out = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m; while ((m = re.exec(String(html || '')))) out.push(m[1]);
  return out.join('\n');
}

// Collect declarations per selector, in source order (later wins, as in CSS).
// Split a shorthand value on top-level whitespace (a `calc(1px + 2px)` or
// `var(--a, 4px)` component stays whole).
function __splitTop(v) {
  const out = []; let cur = '', depth = 0;
  for (const ch of String(v)) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (/\s/.test(ch) && !depth) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
// Box shorthands → longhands. The layout estimator reads `padding-top` etc.;
// without this every `.btn{padding:13px 26px}` measured as padding 0 and each
// button on every generic page was flagged as a sub-44px tap target (a false
// blocker that triggered the repair loop on 100% of builds). `!important` and
// global keywords are left to the longhand as written.
const __BOX_SHORTHANDS = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
};
const __AXIS_SHORTHANDS = {
  'padding-block': ['padding-top', 'padding-bottom'], 'padding-inline': ['padding-left', 'padding-right'],
  'margin-block': ['margin-top', 'margin-bottom'], 'margin-inline': ['margin-left', 'margin-right'],
  'inset-block': ['top', 'bottom'], 'inset-inline': ['left', 'right'],
};
function __expandShorthand(prop, value, decls) {
  const parts = __splitTop(value);
  if (!parts.length || parts.length > 4) return;
  if (__BOX_SHORTHANDS[prop]) {
    const [t, r = t, b = t, l = r] = parts;
    const names = __BOX_SHORTHANDS[prop];
    [t, r, b, l].forEach((v, i) => { decls[names[i]] = v; });
  } else if (__AXIS_SHORTHANDS[prop] && parts.length <= 2) {
    const [a, b = a] = parts;
    const names = __AXIS_SHORTHANDS[prop];
    decls[names[0]] = a; decls[names[1]] = b;
  }
}

// ── MEDIA QUERIES ARE EVALUATED, NOT IGNORED ──────────────────────────────
// Until now every rule inside an @media block was applied UNCONDITIONALLY at
// every viewport (the at-rule wrapper was simply dropped). Two real failure
// modes followed: a desktop-only `@media (min-width:1200px){.hero{width:1100px}}`
// was reported as horizontal overflow on a 375px phone, and a mobile-only
// `@media (max-width:520px){.nav a{min-height:44px}}` counted as satisfied on
// desktop while a `display:none` meant for phones hid the element everywhere.
// Each rule now carries the condition it was declared under and the cascade
// evaluates it against the viewport being measured.
//
// Supported: width/height min/max and level-4 range syntax, orientation,
// aspect-ratio, screen/all/print, `not`/`only`, comma lists, em/rem units
// (always 16px in a media query), hover/pointer (coarse ≤480px), user
// preference features at their DEFAULT value (no-preference / light / no
// forced colours). Unknown features do not match — the same answer a browser
// gives for a feature it does not implement.
const __DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const __mediaMemo = new Map();
function __mqLength(n, unit) { const v = parseFloat(n); return unit === 'px' ? v : v * 16; }
function __mqTerm(term) {
  const t = term.trim();
  if (t === 'screen' || t === 'all') return () => true;
  if (t === 'print' || t === 'speech' || t === 'tty' || t === 'braille') return () => false;
  const m = /^\(([\s\S]*)\)$/.exec(t);
  if (!m) return () => false;
  const inner = m[1].trim().replace(/\s+/g, ' ');
  let r;
  if ((r = /^([\d.]+)(px|em|rem) ?(<=|<) ?(width|height) ?(<=|<) ?([\d.]+)(px|em|rem)$/.exec(inner))) {
    const lo = __mqLength(r[1], r[2]), hi = __mqLength(r[6], r[7]), dim = r[4], loInc = r[3] === '<=', hiInc = r[5] === '<=';
    return (vw, vh) => { const v = dim === 'width' ? vw : vh; return (loInc ? v >= lo : v > lo) && (hiInc ? v <= hi : v < hi); };
  }
  if ((r = /^(width|height) ?(<=|<|>=|>|=) ?([\d.]+)(px|em|rem)$/.exec(inner))) {
    const lim = __mqLength(r[3], r[4]), dim = r[1], op = r[2];
    return (vw, vh) => { const v = dim === 'width' ? vw : vh; return op === '<=' ? v <= lim : op === '<' ? v < lim : op === '>=' ? v >= lim : op === '>' ? v > lim : v === lim; };
  }
  if ((r = /^(min|max)-(width|height) ?: ?([\d.]+)(px|em|rem)$/.exec(inner))) {
    const lim = __mqLength(r[3], r[4]), dim = r[2], isMin = r[1] === 'min';
    return (vw, vh) => { const v = dim === 'width' ? vw : vh; return isMin ? v >= lim : v <= lim; };
  }
  if ((r = /^(min-|max-)?aspect-ratio ?: ?([\d.]+) ?\/ ?([\d.]+)$/.exec(inner))) {
    const ratio = parseFloat(r[2]) / parseFloat(r[3]);
    return (vw, vh) => { const a = vw / vh; return r[1] === 'min-' ? a >= ratio : r[1] === 'max-' ? a <= ratio : Math.abs(a - ratio) < 1e-6; };
  }
  if ((r = /^orientation ?: ?(portrait|landscape)$/.exec(inner))) return (vw, vh) => (vh >= vw) === (r[1] === 'portrait');
  if (/^prefers-reduced-motion ?: ?no-preference$/.test(inner)) return () => true;
  if (/^prefers-reduced-(motion|transparency|data)/.test(inner)) return () => false;
  if (/^prefers-color-scheme ?: ?light$/.test(inner)) return () => true;
  if (/^prefers-color-scheme/.test(inner)) return () => false;
  if (/^prefers-contrast ?: ?no-preference$/.test(inner)) return () => true;
  if (/^prefers-contrast/.test(inner)) return () => false;
  if (/^forced-colors ?: ?none$/.test(inner)) return () => true;
  if (/^forced-colors/.test(inner)) return () => false;
  if ((r = /^(any-)?hover ?: ?(hover|none)$/.exec(inner))) return (vw) => (vw > 480) === (r[2] === 'hover');
  if ((r = /^(any-)?pointer ?: ?(fine|coarse|none)$/.exec(inner))) return (vw) => r[2] === 'none' ? false : (vw > 480) === (r[2] === 'fine');
  if (/^display-mode ?: ?browser$/.test(inner)) return () => true;
  if (/^(color|scripting ?: ?enabled|color-gamut ?: ?srgb|update ?: ?fast)$/.test(inner)) return () => true;
  return () => false;
}
function __mqQuery(query) {
  let q = query.trim();
  let negate = false;
  if (/^not\s/.test(q)) { negate = true; q = q.slice(4); }
  q = q.replace(/^only\s+/, '');
  if (!q) return () => false;
  const tests = q.split(/\s+and\s+/i).map(__mqTerm);
  return (vw, vh) => { const ok = tests.every((t) => t(vw, vh)); return negate ? !ok : ok; };
}
function __mediaMatcher(prelude) {
  const key = String(prelude || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key) return null;
  let fn = __mediaMemo.get(key);
  if (fn) return fn;
  // split on top-level commas only (a comma inside `(400px <= width)` cannot occur, but stay safe)
  const parts = []; let depth = 0, cur = '';
  for (const ch of key) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  const queries = parts.map(__mqQuery);
  fn = (vw, vh) => queries.some((qf) => qf(vw, vh));
  __mediaMemo.set(key, fn);
  return fn;
}
// Combine the at-rule stack a rule sits under into one predicate (or null when
// unconditional). `@supports` is assumed satisfied (the audit targets evergreen
// browsers) unless it is a `not` query; `@container` cannot be evaluated
// without layout and is treated as not matching; `@layer`/`@scope` are
// transparent (ordering between layers is beyond this resolver).
function __conditionFor(stack) {
  const preds = [];
  for (const at of stack) {
    const name = String(at.name || '').toLowerCase();
    const prelude = at.prelude ? csstree.generate(at.prelude) : '';
    if (name === 'media') { const fn = __mediaMatcher(prelude); if (fn) preds.push(fn); }
    else if (name === 'supports') { if (/^\s*not\b/i.test(prelude)) preds.push(() => false); }
    else if (name === 'container') preds.push(() => false);
    // @layer, @scope, @starting-style and vendor wrappers: transparent
  }
  if (!preds.length) return null;
  if (preds.length === 1) return preds[0];
  return (vw, vh) => preds.every((p) => p(vw, vh));
}
// At-rules whose block holds declarations or keyframe selectors, never style rules.
const __NON_RULE_ATRULES = /^(font-face|page|counter-style|property|font-feature-values|font-palette-values|view-transition|-webkit-keyframes|-moz-keyframes|keyframes|document|-moz-document|namespace|import|charset)$/;

function nxParseRules(css) {
  const rules = [];
  let ast; try { ast = csstree.parse(css, { parseValue: false, parseRulePrelude: false }); }
  catch (e) { return rules; }
  const stack = [];
  csstree.walk(ast, {
    enter(node) {
      if (node.type === 'Atrule') {
        if (__NON_RULE_ATRULES.test(String(node.name || '').toLowerCase())) return this.skip;
        stack.push(node);
        return undefined;
      }
      if (node.type !== 'Rule') return undefined;
      const prelude = node.prelude && node.prelude.value ? String(node.prelude.value).trim() : '';
      if (!prelude) return this.skip;
      const decls = {};
      csstree.walk(node.block, {
        visit: 'Declaration',
        enter(d) {
          const prop = d.property.toLowerCase();
          const val = csstree.generate(d.value).trim();
          decls[prop] = val;
          // Source order wins exactly as in a browser: a later `padding-top`
          // overrides the expansion, and a later `padding` overrides an
          // earlier longhand — both fall out of writing in declaration order.
          if (__BOX_SHORTHANDS[prop] || __AXIS_SHORTHANDS[prop]) __expandShorthand(prop, val, decls);
        },
      });
      const media = stack.length ? __conditionFor(stack) : null;
      const mediaText = stack.length ? stack.map((a) => '@' + a.name + ' ' + (a.prelude ? csstree.generate(a.prelude) : '')).join(' ').trim() : '';
      for (const sel of prelude.split(',')) {
        const s = sel.trim();
        if (s) rules.push({ selector: s, decls, media, mediaText });
      }
      return this.skip; // declarations already collected; nested rules are not style rules
    },
    leave(node) {
      if (node.type === 'Atrule' && stack.length && stack[stack.length - 1] === node) stack.pop();
    },
  });
  return rules;
}

// Does this rule apply at the given viewport? Unconditional rules always do.
function nxRuleApplies(rule, viewport) {
  if (!rule.media) return true;
  const vp = viewport || __DEFAULT_VIEWPORT;
  return !!rule.media(vp.width, vp.height);
}
// Per-viewport activity table, computed once per (cascade, viewport).
function __activeTable(rules, viewport, tables) {
  const vp = viewport || __DEFAULT_VIEWPORT;
  const key = vp.width + 'x' + vp.height;
  let t = tables.get(key);
  if (!t) {
    t = new Uint8Array(rules.length);
    for (let i = 0; i < rules.length; i++) t[i] = nxRuleApplies(rules[i], vp) ? 1 : 0;
    tables.set(key, t);
  }
  return t;
}

// Build the custom-property table from :root (and html/body fallbacks).
// Tokens redefined only under a condition that does not hold at the default
// desktop viewport (a dark-scheme override, a print sheet, a phone-only
// override) do not replace the base value: the contrast audit must judge the
// palette that actually renders by default.
function nxRootVars(rules, viewport) {
  const vars = {};
  for (const r of rules) {
    if (!/^(:root|html|body)$/.test(r.selector)) continue;
    if (!nxRuleApplies(r, viewport)) continue;
    for (const k of Object.keys(r.decls)) if (k.startsWith('--')) vars[k] = r.decls[k];
  }
  return vars;
}

// Resolve var(--x, fallback) recursively. Returns null if unresolvable, so a
// dangling custom property is reported rather than silently rendering as text.
function nxResolveValue(value, vars, depth) {
  depth = depth || 0;
  let v = String(value == null ? '' : value);
  if (depth > 12) return v;
  if (!/var\(/.test(v)) return v.trim();
  let out = '', i = 0;
  while (i < v.length) {
    const at = v.indexOf('var(', i);
    if (at < 0) { out += v.slice(i); break; }
    out += v.slice(i, at);
    // find the matching close paren
    let dep = 0, j = at + 3;
    for (; j < v.length; j++) { if (v[j] === '(') dep++; else if (v[j] === ')') { dep--; if (!dep) break; } }
    const inner = v.slice(at + 4, j);
    const comma = (() => { let d2 = 0; for (let k = 0; k < inner.length; k++) { const c = inner[k]; if (c === '(') d2++; else if (c === ')') d2--; else if (c === ',' && !d2) return k; } return -1; })();
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fb = comma < 0 ? null : inner.slice(comma + 1).trim();
    if (Object.prototype.hasOwnProperty.call(vars, name)) out += nxResolveValue(vars[name], vars, depth + 1);
    else if (fb != null) out += nxResolveValue(fb, vars, depth + 1);
    else return null; // undefined custom property with no fallback
    i = j + 1;
  }
  return out.trim();
}

// Very small selector matcher: tag, .class, #id, and descendant/compound forms.
function __matches(el, selector) {
  try { return el.matches(selector); } catch (e) { return false; }
}

// Selectors the DOM cannot match (pseudo-classes/elements, at-rule preludes).
const __UNMATCHABLE = /::|:hover|:focus|:active|:visited|:focus-within|:focus-visible|:target|:checked|:disabled|:placeholder-shown|:invalid|:valid|@/;

// Per-cascade memo: `el.matches(selector)` is answered ONCE per element per
// selector instead of once per element per selector per property. The layout
// audit asks ~12 properties for every element of a 40 KB page, and each
// `matches()` re-compiles the selector — that made a deterministic build burn
// ~1 s of CPU in selector compilation alone. Same semantics, ~10x cheaper.
function __matchMemo(rules, document) {
  const skip = rules.map((r) => __UNMATCHABLE.test(r.selector));
  // With a document: each selector is compiled and evaluated ONCE
  // (querySelectorAll → Set of matched elements) instead of once per element.
  if (document && typeof document.querySelectorAll === 'function') {
    const sets = new Array(rules.length);
    return (el, idx) => {
      if (skip[idx]) return false;
      let set = sets[idx];
      if (!set) {
        try { set = new Set(document.querySelectorAll(rules[idx].selector)); }
        catch (e) { set = new Set(); /* invalid selector: matches nothing, like the browser */ }
        sets[idx] = set;
      }
      return set.has(el);
    };
  }
  const cache = new WeakMap();
  return (el, idx) => {
    if (skip[idx]) return false;
    let hits = cache.get(el);
    if (!hits) { hits = new Map(); cache.set(el, hits); }
    let v = hits.get(idx);
    if (v === undefined) { v = __matches(el, rules[idx].selector); hits.set(idx, v); }
    return v;
  };
}

// Compute the declared (cascaded) value of `prop` for an element.
function nxComputed(el, prop, rules, vars, memo, viewport) {
  const match = memo || __matchMemo(rules);
  let winner = null;
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (r.decls[prop] === undefined) continue;
    if (r.media && !nxRuleApplies(r, viewport)) continue;
    if (match(el, i)) winner = r.decls[prop];
  }
  const inline = el.getAttribute && el.getAttribute('style');
  if (inline) {
    const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:([^;]+)', 'i').exec(inline);
    if (m) winner = m[1].trim();
  }
  if (winner == null) return null;
  return nxResolveValue(winner, vars, 0);
}

// INVERTED SELECTOR INDEX: element → ascending list of the rule indices that
// match it. Built in ONE pass (each selector evaluated once with
// querySelectorAll, pushes happen in source order so "later wins" survives).
// `computed(el, prop)` then walks the handful of rules that apply to that
// element instead of scanning every rule of the stylesheet — the layout audit
// asks ~12 properties × every element × 4 viewports, so the full-scan version
// was the single largest CPU cost of a build (≈60 ms of a 200 ms page in Node,
// far more under the Workers 10 ms/request free-plan budget).
//
// Most selectors in a generated page are plain compounds (`.c-btn`,
// `section.c-hero h2`, `#quote .step`). Those are answered from a one-pass
// class/tag/id index instead of the DOM engine's generic selector matcher,
// which re-tokenises every element's class attribute for every class test
// (≈45 ms of a 200 ms build). Anything with attribute selectors, pseudo-
// classes, sibling combinators or escapes falls back to querySelectorAll, so
// the answer is always the engine's answer — the fast path only short-cuts
// the shapes whose semantics are trivial (exact class token, case-insensitive
// tag, exact id, descendant/child ancestry).
const __SIMPLE_COMPOUND = /^(?:[a-zA-Z][\w-]*|\*)?(?:#[\w-]+)?(?:\.[\w-]+)*$/;

function __parseCompound(str) {
  if (!__SIMPLE_COMPOUND.test(str) || !str) return null;
  const tagM = /^([a-zA-Z][\w-]*|\*)/.exec(str);
  const tag = tagM && tagM[1] !== '*' ? tagM[1].toLowerCase() : null;
  const idM = /#([\w-]+)/.exec(str);
  const classes = [...str.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  return { tag, id: idM ? idM[1] : null, classes };
}

// `a > b c` → [{compound}, {comb:'>'}, {compound}, {comb:' '}, {compound}]
function __parseSimpleSelector(selector) {
  const parts = String(selector).trim().split(/\s*(>)\s*|\s+/).filter((x) => x !== undefined && x !== '');
  const out = [];
  let expectCompound = true;
  for (const p of parts) {
    if (p === '>') { if (expectCompound) return null; out.push({ comb: '>' }); expectCompound = true; continue; }
    const c = __parseCompound(p);
    if (!c) return null;
    if (!expectCompound) out.push({ comb: ' ' });
    out.push(c); expectCompound = false;
  }
  if (expectCompound || !out.length) return null;
  return out;
}

function __elementIndex(document) {
  const all = document.querySelectorAll('*');
  const byClass = new Map(), byTag = new Map(), byId = new Map(), info = new WeakMap();
  for (const el of all) {
    const tag = el.localName || String(el.tagName || '').toLowerCase();
    const cls = el.getAttribute ? (el.getAttribute('class') || '') : '';
    const classes = cls ? cls.split(/\s+/).filter(Boolean) : [];
    const id = el.getAttribute ? el.getAttribute('id') : null;
    info.set(el, { tag, classes: new Set(classes), id: id || null });
    let t = byTag.get(tag); if (!t) byTag.set(tag, t = []); t.push(el);
    for (const c of classes) { let l = byClass.get(c); if (!l) byClass.set(c, l = []); l.push(el); }
    if (id) { let l = byId.get(id); if (!l) byId.set(id, l = []); l.push(el); } // duplicate ids all match `#id`, as in querySelectorAll
  }
  const matchesCompound = (el, c) => {
    const i = info.get(el); if (!i) return false;
    if (c.tag && i.tag !== c.tag) return false;
    if (c.id && i.id !== c.id) return false;
    for (const k of c.classes) if (!i.classes.has(k)) return false;
    return true;
  };
  const candidates = (c) => {
    if (c.id) return (byId.get(c.id) || []).filter((el) => matchesCompound(el, c));
    if (c.classes.length) {
      // start from the rarest class
      let best = null;
      for (const k of c.classes) { const l = byClass.get(k) || []; if (!best || l.length < best.length) best = l; }
      return best.filter((el) => matchesCompound(el, c));
    }
    if (c.tag) return byTag.get(c.tag) || [];
    return [...all];
  };
  // Standard right-to-left matching with backtracking: `el` must match the
  // compound at `pos`, and (for pos > 0) some parent/ancestor must match the
  // rest of the chain. Exact for any mix of ' ' and '>' combinators.
  const matchChain = (el, chain, pos) => {
    if (!matchesCompound(el, chain[pos])) return false;
    if (pos === 0) return true;
    const direct = chain[pos - 1].comb === '>';
    let p = el.parentNode;
    if (direct) return !!(p && p.nodeType === 1 && matchChain(p, chain, pos - 2));
    while (p && p.nodeType === 1) { if (matchChain(p, chain, pos - 2)) return true; p = p.parentNode; }
    return false;
  };
  // Returns the matched elements in DOCUMENT ORDER (like querySelectorAll) or
  // null when the selector is outside the fast path.
  return (selector) => {
    const chain = __parseSimpleSelector(selector);
    if (!chain) return null;
    const lastPos = chain.length - 1;
    const els = candidates(chain[lastPos]);
    return lastPos === 0 ? els : els.filter((el) => matchChain(el, chain, lastPos));
  };
}

function __ruleIndex(rules, document) {
  const byEl = new WeakMap();
  const fast = __elementIndex(document);
  for (let i = 0; i < rules.length; i++) {
    if (__UNMATCHABLE.test(rules[i].selector)) continue;
    let els = fast(rules[i].selector);
    if (els === null) {
      try { els = document.querySelectorAll(rules[i].selector); }
      catch (e) { continue; /* invalid selector: matches nothing, like the browser */ }
    }
    for (const el of els) {
      const list = byEl.get(el);
      if (list) list.push(i); else byEl.set(el, [i]);
    }
  }
  return byEl;
}

// Indexed computed value. Same answer as nxComputed(el, prop, rules, vars) —
// pinned by test_validation_pipeline — with results memoised per (element,
// property): the cascade is viewport-independent, so the four viewport passes
// of a layout audit reuse each other's answers.
function __computedIndexed(el, prop, rules, vars, byEl, cache, active) {
  let props = cache.get(el);
  if (!props) { props = new Map(); cache.set(el, props); }
  if (props.has(prop)) return props.get(prop);
  let winner = null;
  const list = byEl.get(el);
  if (list) for (let k = 0; k < list.length; k++) {
    if (active && !active[list[k]]) continue;
    const d = rules[list[k]].decls[prop];
    if (d !== undefined) winner = d;
  }
  const inline = el.getAttribute && el.getAttribute('style');
  if (inline) {
    const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:([^;]+)', 'i').exec(inline);
    if (m) winner = m[1].trim();
  }
  const out = winner == null ? null : nxResolveValue(winner, vars, 0);
  props.set(prop, out);
  return out;
}

// One-shot: parse a document and return a resolver bound to it.
// `computed(el, prop, viewport)`: without a viewport the answer is the DEFAULT
// desktop (1440x900) cascade — the value a design-token audit should judge.
// With one, conditional rules are switched on/off for that viewport, so the
// layout estimator sees what a phone (or a wide monitor) really renders.
function nxCascade(html, document) {
  const css = __styleText(html);
  const rules = nxParseRules(css);
  const vars = nxRootVars(rules);
  const conditional = rules.some((r) => !!r.media);
  const indexed = !!(document && typeof document.querySelectorAll === 'function');
  const byEl = indexed ? __ruleIndex(rules, document) : null;
  const caches = indexed ? new Map() : null;   // viewport key → WeakMap(el → Map(prop → value))
  const tables = new Map();
  const memo = indexed ? null : __matchMemo(rules, document);
  const vpKey = (vp) => (conditional && vp) ? (vp.width + 'x' + vp.height) : 'default';
  const cacheFor = (vp) => { const k = vpKey(vp); let c = caches.get(k); if (!c) caches.set(k, c = new WeakMap()); return c; };
  return {
    rules, vars,
    conditional,
    computed: indexed
      ? (el, prop, vp) => __computedIndexed(el, prop, rules, vars, byEl, cacheFor(vp), conditional ? __activeTable(rules, vp, tables) : null)
      : (el, prop, vp) => nxComputed(el, prop, rules, vars, memo, vp),
    applies: (rule, vp) => nxRuleApplies(rule, vp),
    resolve: (v) => nxResolveValue(v, vars, 0),
    // Every custom property that is referenced WITHOUT a fallback and never
    // defined. `var(--gx, 50%)` is a deliberate, valid pattern (the runtime sets
    // --gx from the pointer); it used to be reported as a broken token on every
    // page that used it.
    danglingVars() {
      const used = new Set();
      for (const r of rules) for (const k of Object.keys(r.decls)) {
        const re = /var\(\s*(--[a-zA-Z0-9-_]+)\s*([,)])/g; let m;
        while ((m = re.exec(r.decls[k]))) if (m[2] === ')') used.add(m[1]);
      }
      return [...used].filter(n => !Object.prototype.hasOwnProperty.call(vars, n));
    },
    // Custom properties that are defined but never referenced anywhere.
    unusedVars() {
      const used = new Set();
      for (const r of rules) for (const k of Object.keys(r.decls)) {
        const re = /var\(\s*(--[a-zA-Z0-9-_]+)/g; let m;
        while ((m = re.exec(r.decls[k]))) used.add(m[1]);
      }
      return Object.keys(vars).filter(n => !used.has(n));
    },
  };
}

module.exports = { nxCascade, nxParseRules, nxRootVars, nxResolveValue, nxComputed, nxRuleApplies, __elementIndex };
