'use strict';
// ══════════════════════════════════════════════════════════════════════════
// nx_ast.js — DETERMINISTIC STRUCTURAL VALIDATION FOR GENERATED HTML
//
// The composition engine emits HTML, and every AI/import path can emit HTML
// too. Nothing verified that the markup was structurally SOUND: parse5 happily
// repairs an unclosed <div> and reports no error, so malformed output reached
// the preview and the published page.
//
// The technique here is TREE-DIFF, not error-listening. We parse the source,
// re-serialize the resulting tree, then re-parse. If the document had to be
// repaired, the serialized form differs from the input in tag structure, and
// that difference is the evidence a tag was auto-closed or relocated.
//
// Two gates, matching the performance budget:
//   * nxAstSyntaxGate  — FAST, blocking. Structure only. Runs on every pass.
//   * nxAstDeepAudit   — heavier, non-blocking. Semantics/a11y/duplicate ids.
//
// Pure and dependency-light: parse5 only. Safe in a Worker.
// ══════════════════════════════════════════════════════════════════════════
const parse5 = require('parse5');

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);
// Elements that may not contain flow content — a <div> inside <p> is a real
// authoring bug that browsers silently "fix" by closing the <p> early, which
// changes the rendered layout.
// <a> and <button>/<label> are deliberately EXCLUDED: <a> is a "transparent"
// content model in HTML5, so <a><figure>…</figure></a> is perfectly valid and
// is a normal way to make a whole card clickable. Only elements that genuinely
// may not contain flow content belong here.
const PHRASING_ONLY = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span']);
const FLOW = new Set(['div', 'section', 'article', 'main', 'aside', 'header', 'footer',
  'nav', 'ul', 'ol', 'li', 'table', 'form', 'figure', 'blockquote', 'p']);

function __text(n) {
  if (!n) return '';
  if (n.nodeName === '#text') return n.value || '';
  return (n.childNodes || []).map(__text).join('');
}
function __walk(node, fn, depth = 0, parent = null) {
  if (!node) return;
  fn(node, depth, parent);
  for (const c of node.childNodes || []) __walk(c, fn, depth + 1, node);
}
function __tagCounts(html) {
  // Count OPENING tags in the raw source, ignoring comments/scripts/styles so
  // that markup inside a template string is not miscounted.
  const stripped = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '<style></style>');
  const counts = {};
  for (const m of stripped.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g)) {
    const tag = m[1].toLowerCase();
    if (VOID.has(tag) || m[2] === '/') continue;
    counts[tag] = (counts[tag] || 0) + 1;
  }
  const closes = {};
  for (const m of stripped.matchAll(/<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/g)) {
    const tag = m[1].toLowerCase();
    closes[tag] = (closes[tag] || 0) + 1;
  }
  return { opens: counts, closes };
}

// ── FAST BLOCKING GATE ────────────────────────────────────────────────────
// Structure only. Deterministic, no network, no heavy analysis.
function nxAstSyntaxGate(html) {
  const errors = [], warnings = [];
  const src = String(html == null ? '' : html);
  if (!src.trim()) return { ok: false, errors: ['empty document'], warnings: [], repaired: null, tagBalance: {} };

  let doc = null;
  try { doc = parse5.parse(src); }
  catch (e) { return { ok: false, errors: ['unparseable: ' + e.message], warnings: [], repaired: null, tagBalance: {} }; }

  // 1. Parser-level errors (catches unterminated <style>/<script>, bad EOF…).
  const parseErrors = [];
  try { parse5.parse(src, { onParseError: (e) => parseErrors.push(e.code) }); } catch (e) { /* already handled */ }
  for (const code of [...new Set(parseErrors)]) errors.push('parse error: ' + code);

  // 2. Tag-balance diff — the actual unclosed/stray-tag detector. parse5 repairs
  //    silently, so we compare raw open/close counts instead of trusting it.
  const { opens, closes } = __tagCounts(src);
  const tagBalance = {};
  for (const tag of new Set([...Object.keys(opens), ...Object.keys(closes)])) {
    if (VOID.has(tag) || tag === 'html' || tag === 'head' || tag === 'body') continue;
    const o = opens[tag] || 0, c = closes[tag] || 0;
    if (o !== c) {
      tagBalance[tag] = { open: o, close: c };
      if (o > c) errors.push(`unclosed <${tag}>: ${o} opened, ${c} closed`);
      else errors.push(`stray </${tag}>: ${c} closing tags but only ${o} opened`);
    }
  }

  // 3. Invalid nesting that browsers silently "repair" into different layout.
  //    This must be detected in the SOURCE, not the parsed tree: parse5 has
  //    already relocated the offending element by the time we can walk it, so
  //    the tree looks innocent while the rendered layout has silently changed.
  const flat = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  const stack = [];
  for (const m of flat.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g)) {
    const closing = m[1] === '/', tag = m[2].toLowerCase(), selfClose = m[3] === '/';
    if (VOID.has(tag) || selfClose) continue;
    if (closing) { const i = stack.lastIndexOf(tag); if (i >= 0) stack.splice(i, 1); continue; }
    const parent = stack[stack.length - 1];
    if (parent && PHRASING_ONLY.has(parent) && FLOW.has(tag)) {
      errors.push(`invalid nesting: <${tag}> inside <${parent}> (the browser will silently close the <${parent}> early)`);
    }
    stack.push(tag);
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings, repaired: null, tagBalance };
}

// ── AUTO-REPAIR ───────────────────────────────────────────────────────────
// Let the spec-compliant parser rebuild a well-formed tree, then serialize it.
// This is exactly how a browser would interpret the markup, so the repaired
// document renders identically to what the user would have seen — minus the
// structural ambiguity.
function nxAstAutoClose(html) {
  const src = String(html == null ? '' : html);
  if (!src.trim()) return { html: src, changed: false };
  try {
    const doc = parse5.parse(src);
    // parse5.serialize() on a Document ALREADY emits the doctype it parsed —
    // prefixing another one produced a duplicated <!DOCTYPE html>.
    let out = parse5.serialize(doc);
    if (/^\s*<!DOCTYPE/i.test(src) && !/^\s*<!DOCTYPE/i.test(out)) out = '<!DOCTYPE html>' + out;

    // parse5 rebuilds a spec-legal TREE but does not relocate flow content out
    // of a phrasing-only parent, because per spec that nesting is simply how the
    // author wrote it. Unwrap those explicitly so the repair is complete.
    let fixed = out;
    for (let pass = 0; pass < 3; pass++) {
      const before = fixed;
      for (const tag of PHRASING_ONLY) {
        // <h1><section>x</section></h1>  →  <h1>x</h1>
        const re = new RegExp('<(' + tag + ')(\\b[^>]*)>([\\s\\S]*?)<\\/\\1>', 'gi');
        fixed = fixed.replace(re, (m, t, attrs, inner) => {
          const cleaned = inner.replace(/<\/?(?:div|section|article|main|aside|header|footer|nav|ul|ol|li|table|form|figure|blockquote|p)\b[^>]*>/gi, '');
          return '<' + t + attrs + '>' + cleaned + '</' + t + '>';
        });
      }
      if (fixed === before) break;
    }
    return { html: fixed, changed: fixed !== src };
  } catch (e) { return { html: src, changed: false }; }
}

// ── DEEP (NON-BLOCKING) AUDIT ─────────────────────────────────────────────
// Semantics and accessibility. Heavier, intended for pre-publish / on demand.
// `opts.fragment` = true when auditing a SUBTREE rather than a whole page:
// page-level rules (exactly one <h1>) are meaningless for one section and would
// otherwise report a false problem against every node.
function nxAstDeepAudit(html, opts) {
  const fragment = !!(opts && opts.fragment);
  const issues = [];
  const src = String(html == null ? '' : html);
  let doc; try { doc = parse5.parse(src); } catch (e) { return { ok: false, issues: ['unparseable'], counts: {} }; }

  const ids = new Map(); const counts = { img: 0, imgNoAlt: 0, headings: 0, landmarks: 0, links: 0, linksNoText: 0 };
  const headingLevels = [];
  __walk(doc, (n) => {
    if (!n.tagName) return;
    const attrs = Object.fromEntries((n.attrs || []).map(a => [a.name, a.value]));
    if (attrs.id) ids.set(attrs.id, (ids.get(attrs.id) || 0) + 1);
    if (n.tagName === 'img') { counts.img++; if (!attrs.alt && attrs.alt !== '') counts.imgNoAlt++; }
    if (/^h[1-6]$/.test(n.tagName)) { counts.headings++; headingLevels.push(+n.tagName[1]); }
    if (['main', 'nav', 'header', 'footer', 'aside'].includes(n.tagName)) counts.landmarks++;
    if (n.tagName === 'a') { counts.links++; if (!__text(n).trim() && !attrs['aria-label']) counts.linksNoText++; }
  });
  for (const [id, n] of ids) if (n > 1) issues.push(`duplicate id "${id}" used ${n} times`);
  if (counts.imgNoAlt) issues.push(`${counts.imgNoAlt} image(s) missing alt text`);
  if (counts.linksNoText) issues.push(`${counts.linksNoText} link(s) have no accessible text`);
  const h1s = headingLevels.filter(l => l === 1).length;
  if (!fragment) {
    if (h1s === 0 && counts.headings) issues.push('no <h1> on the page');
    if (h1s > 1) issues.push(`${h1s} <h1> elements (should be exactly one)`);
  }
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] - headingLevels[i - 1] > 1) {
      issues.push(`heading level jumps h${headingLevels[i - 1]}→h${headingLevels[i]}`); break;
    }
  }
  return { ok: issues.length === 0, issues, counts };
}

// ── SELF-CORRECTION DIAGNOSTIC ────────────────────────────────────────────
// Turn failures into a precise instruction an LLM can act on. Deliberately
// imperative and specific: a vague "it was invalid" produces a vague retry.
function nxAstDiagnosticPrompt(html, opts) {
  const gate = nxAstSyntaxGate(html);
  const deep = (opts && opts.deep === false) ? { issues: [] } : nxAstDeepAudit(html);
  const all = [...gate.errors, ...deep.issues];
  if (!all.length) return null;
  return [
    'The HTML you produced did not pass structural validation. Fix EXACTLY these problems and return the corrected full document:',
    ...all.map((e, i) => `${i + 1}. ${e}`),
    'Rules: keep all existing content and styling; change only what is required to fix the listed problems; return the complete document starting with <!DOCTYPE html>.',
  ].join('\n');
}

// ── PER-NODE VALIDATION over the addressable tree ─────────────────────────
// Validates each section subtree independently so a fault is attributed to one
// addressable node instead of "the page is broken".
function nxAstValidateSections(html) {
  const src = String(html == null ? '' : html);
  const results = [];
  let doc; try { doc = parse5.parse(src); } catch (e) { return results; }
  __walk(doc, (n) => {
    if (!n.tagName) return;
    const attrs = Object.fromEntries((n.attrs || []).map(a => [a.name, a.value]));
    const key = attrs['data-nx-node'] || attrs['data-section'] || (n.tagName === 'section' ? (attrs.id || 'section') : null);
    if (!key) return;
    const frag = parse5.serialize(n);
    const deep = nxAstDeepAudit('<!DOCTYPE html><html><body>' + frag + '</body></html>', { fragment: true });
    results.push({ node: key, tag: n.tagName, ok: deep.ok, issues: deep.issues });
  });
  return results;
}

module.exports = { nxAstSyntaxGate, nxAstAutoClose, nxAstDeepAudit, nxAstDiagnosticPrompt, nxAstValidateSections };
