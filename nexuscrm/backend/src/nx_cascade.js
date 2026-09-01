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
function nxParseRules(css) {
  const rules = [];
  let ast; try { ast = csstree.parse(css, { parseValue: false, parseRulePrelude: false }); }
  catch (e) { return rules; }
  csstree.walk(ast, {
    visit: 'Rule',
    enter(node) {
      const prelude = node.prelude && node.prelude.value ? String(node.prelude.value).trim() : '';
      if (!prelude) return;
      const decls = {};
      csstree.walk(node.block, {
        visit: 'Declaration',
        enter(d) { decls[d.property.toLowerCase()] = csstree.generate(d.value).trim(); },
      });
      for (const sel of prelude.split(',')) {
        const s = sel.trim();
        if (s) rules.push({ selector: s, decls });
      }
    },
  });
  return rules;
}

// Build the custom-property table from :root (and html/body fallbacks).
function nxRootVars(rules) {
  const vars = {};
  for (const r of rules) {
    if (!/^(:root|html|body)$/.test(r.selector)) continue;
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

// Compute the declared (cascaded) value of `prop` for an element.
function nxComputed(el, prop, rules, vars) {
  let winner = null;
  for (const r of rules) {
    // skip pseudo/at-rule selectors the DOM cannot match
    if (/::|:hover|:focus|@/.test(r.selector)) continue;
    if (r.decls[prop] === undefined) continue;
    if (__matches(el, r.selector)) winner = r.decls[prop];
  }
  const inline = el.getAttribute && el.getAttribute('style');
  if (inline) {
    const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:([^;]+)', 'i').exec(inline);
    if (m) winner = m[1].trim();
  }
  if (winner == null) return null;
  return nxResolveValue(winner, vars, 0);
}

// One-shot: parse a document and return a resolver bound to it.
function nxCascade(html, document) {
  const css = __styleText(html);
  const rules = nxParseRules(css);
  const vars = nxRootVars(rules);
  return {
    rules, vars,
    computed: (el, prop) => nxComputed(el, prop, rules, vars),
    resolve: (v) => nxResolveValue(v, vars, 0),
    // Every custom property that is referenced but never defined.
    danglingVars() {
      const used = new Set();
      for (const r of rules) for (const k of Object.keys(r.decls)) {
        const re = /var\(\s*(--[a-zA-Z0-9-_]+)/g; let m;
        while ((m = re.exec(r.decls[k]))) used.add(m[1]);
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

module.exports = { nxCascade, nxParseRules, nxRootVars, nxResolveValue, nxComputed };
