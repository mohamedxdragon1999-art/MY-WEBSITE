'use strict';
// ══════════════════════════════════════════════════════════════════════════
// nx_repair.js — SCOPE-LIMITED REPAIR WITH ESCALATING SPECIFICITY (Phase 1.3)
//
// The previous repair was a hammer. A single 20px link failing the tap-target
// rule caused `a:not(p a),button{min-height:44px}` to be injected, restyling
// EVERY anchor and button on the page — including ones that were already
// correct. One faulty element, page-wide collateral damage.
//
// This module repairs the SMALLEST SCOPE that can fix the reported violation,
// and escalates only when a narrower attempt provably failed:
//
//   TIER 1  element   — a unique surgical selector for the one faulty node
//   TIER 2  container — its nearest addressable ancestor
//   TIER 3  page      — the blunt global rule (last resort, as before)
//
// Escalation is driven by MEASUREMENT, not by retry count: a tier is abandoned
// only after re-validation shows the violation survived. Each escalation also
// produces a more specific diagnostic (element, measured value, what was
// already tried), so an LLM repair step gets facts rather than "try again".
// ══════════════════════════════════════════════════════════════════════════

const { parseHTML } = require('linkedom');

const NX_TIERS = ['element', 'container', 'page'];

/** A CSS selector that matches exactly one node, preferring stability. */
function nxUniqueSelector(el, doc) {
  if (!el || !el.tagName) return null;
  const id = el.getAttribute && el.getAttribute('id');
  if (id && /^[A-Za-z][\w-]*$/.test(id) && doc.querySelectorAll('#' + id).length === 1) return '#' + id;
  // A repair-specific data attribute is the most stable handle we can create:
  // it cannot collide with authored styling and survives re-serialisation.
  const marker = 'nxr' + Math.abs(__hash(el.outerHTML || el.tagName)).toString(36).slice(0, 8);
  el.setAttribute('data-nx-fix', marker);
  return `[data-nx-fix="${marker}"]`;
}
function __hash(s) { let h = 5381; const t = String(s); for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) | 0; return h; }

/** Nearest ancestor that is a real section/container. */
function nxContainerOf(el) {
  let n = el && el.parentElement;
  while (n && n.tagName) {
    const t = n.tagName.toLowerCase();
    if (['section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'form', 'ul', 'ol'].includes(t)) return n;
    if (n.getAttribute && n.getAttribute('id')) return n;
    n = n.parentElement;
  }
  return null;
}

// ── Per-rule repair strategies, narrowest first ───────────────────────────
// Each returns { css?, mutate?, note } or null when the tier cannot help.
const STRATEGY = {
  'touch-target': {
    element: (sel) => ({ css: `@media (max-width:480px){${sel}{min-height:44px;min-width:44px;display:inline-flex;align-items:center;justify-content:center}}`,
      note: `touch-target: enlarged ${sel} to the 44px minimum` }),
    container: (sel) => ({ css: `@media (max-width:480px){${sel} a,${sel} button{min-height:44px;min-width:44px;display:inline-flex;align-items:center;justify-content:center}}`,
      note: `touch-target: enlarged controls within ${sel}` }),
    page: () => ({ css: `@media (max-width:480px){a:not(p a):not(li a),button,input[type="submit"]{min-height:44px;min-width:44px;display:inline-flex;align-items:center;justify-content:center}}`,
      note: 'touch-target: page-wide minimum (last resort)' }),
  },
  // The estimator reports 'overflow-x'; the browser probe reports 'overflow'.
  // Both must resolve to the same strategy or the narrow tiers never run.
  'overflow-x': {
    element: (sel) => ({ css: `${sel}{max-width:100%;min-width:0;overflow-wrap:anywhere}`, note: `overflow: constrained ${sel}` }),
    container: (sel) => ({ css: `${sel},${sel} *{max-width:100%;min-width:0}`, note: `overflow: constrained contents of ${sel}` }),
    page: () => ({ css: 'html,body{max-width:100%;overflow-x:hidden}img,svg,video,table{max-width:100%}', note: 'overflow: page-wide containment (last resort)' }),
  },
  overflow: {
    element: (sel) => ({ css: `${sel}{max-width:100%;min-width:0;overflow-wrap:anywhere}`, note: `overflow: constrained ${sel}` }),
    container: (sel) => ({ css: `${sel},${sel} *{max-width:100%}`, note: `overflow: constrained contents of ${sel}` }),
    page: () => ({ css: 'html,body{max-width:100%;overflow-x:hidden}img,svg,video,table{max-width:100%}', note: 'overflow: page-wide containment (last resort)' }),
  },
  'off-canvas': {
    element: (sel) => ({ css: `${sel}{max-width:100%;margin-inline:auto}`, note: `off-canvas: pulled ${sel} back into view` }),
    container: (sel) => ({ css: `${sel}{overflow-x:clip}`, note: `off-canvas: clipped ${sel}` }),
    page: () => ({ css: 'html,body{max-width:100%;overflow-x:hidden}', note: 'off-canvas: page-wide clip (last resort)' }),
  },
  overlap: {
    element: (sel) => ({ css: `${sel}{position:relative;z-index:1}`, note: `overlap: isolated ${sel}` }),
    container: (sel) => ({ css: `${sel}{display:flow-root;clear:both}`, note: `overlap: cleared float context on ${sel}` }),
    page: () => ({ css: 'main>*{position:relative}', note: 'overlap: page-wide stacking reset (last resort)' }),
  },
  'zero-size': {
    element: (sel) => ({ css: `${sel}{min-height:1em;height:auto}`, note: `zero-size: restored height on ${sel}` }),
    container: null, page: null,
  },
  contrast: {
    // Colour cannot be guessed safely; surface it rather than invent a value.
    element: null, container: null, page: null,
  },
};

/**
 * Repair exactly one violation at the given tier.
 * Returns { html, note, selector } or null when this tier cannot act.
 */
function nxRepairOne(html, violation, tier) {
  const rule = violation && violation.rule;
  const strat = STRATEGY[rule];
  if (!strat || !strat[tier]) return null;

  // Structural repair is inherently document-wide; keep it at page tier only.
  const { document } = parseHTML(html);
  let sel = null;
  if (tier === 'element' || tier === 'container') {
    // A descriptive selector like "div" can match many nodes, and the FIRST is
    // usually not the faulty one. Disambiguate using the measured evidence
    // (e.g. "min-width 4000px") so the fix lands on the element that actually
    // failed rather than an innocent sibling.
    let el = null;
    const measured = String(violation.measured || '');
    const px = (/(\d{3,})px/.exec(measured) || [])[1];
    const wantsWidth = /width/i.test(measured) && px;
    const candidates = (() => {
      try { return [...document.querySelectorAll(violation.selector || '*')]; } catch (e) { return []; }
    })();
    if (wantsWidth) {
      el = candidates.find((c) => {
        const st = (c.getAttribute && c.getAttribute('style')) || '';
        return st.includes(px + 'px');
      }) || null;
    }
    if (!el) el = candidates[0] || null;
    if (!el && violation.selector) {
      // Selectors from the browser probe are descriptive, not queryable —
      // resolve them by tag+class instead of failing outright.
      const m = /^([a-z0-9]+)(?:#([\w-]+))?(?:\.([\w-]+))?/i.exec(violation.selector);
      if (m) {
        const q = m[2] ? `#${m[2]}` : (m[3] ? `${m[1]}.${m[3]}` : m[1]);
        try { el = document.querySelector(q); } catch (e) { el = null; }
      }
    }
    if (!el) return null;
    const target = tier === 'element' ? el : nxContainerOf(el);
    if (!target) return null;
    sel = nxUniqueSelector(target, document);
    if (!sel) return null;
  }

  const made = strat[tier](sel);
  if (!made) return null;

  // A stylesheet cannot override an inline style. When the faulty element
  // carries a hard inline width, rewrite that ONE attribute — the narrowest
  // possible intervention — instead of escalating to a page-wide rule.
  if (tier === 'element' && /overflow/.test(rule)) {
    const el = document.querySelector(sel);
    const st = el && el.getAttribute('style');
    if (st && /(?:^|;)\s*(?:min-)?width\s*:\s*\d{3,}px/i.test(st)) {
      el.setAttribute('style', st
        .replace(/(^|;)\s*width\s*:\s*(\d{3,})px/gi, (m, sep, n) => `${sep}width:100%;max-width:${n}px`)
        .replace(/(^|;)\s*min-width\s*:\s*\d{3,}px/gi, '$1min-width:0'));
    }
  }

  // Re-serialise only if we marked an element; otherwise keep the original
  // bytes so a page-tier fix cannot perturb formatting.
  let out = html;
  if (sel && sel.startsWith('[data-nx-fix')) {
    const body = document.body ? document.body.innerHTML : '';
    out = html.replace(/(<body[^>]*>)([\s\S]*)(<\/body>)/i, (m, a, b, c) => a + body + c);
  }
  out = __appendRepairCss(out, made.css);
  return { html: out, note: made.note, selector: sel || 'page', tier };
}

function __appendRepairCss(html, css) {
  if (!css) return html;
  if (/<style id="nx-repair">/.test(html)) {
    // Never duplicate an identical rule — repair must stay idempotent.
    const cur = (html.match(/<style id="nx-repair">([\s\S]*?)<\/style>/) || [])[1] || '';
    if (cur.includes(css)) return html;
    return html.replace(/(<style id="nx-repair">)([\s\S]*?)(<\/style>)/, (m, a, b, c) => a + b + css + c);
  }
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `<style id="nx-repair">${css}</style></head>`);
  return html;
}

/**
 * Escalating repair driven by measurement.
 *
 * For each blocking violation, try the narrowest tier first and only widen
 * when re-validation proves the violation survived. `validate` is injected so
 * this module stays independent of the gate implementation.
 */
function nxRepairScoped(html, blocking, validate, opts) {
  opts = opts || {};
  let out = String(html || '');
  const applied = [], unresolved = [], trace = [];
  // Group by rule AND target. The same defect is reported once per viewport,
  // so grouping by rule alone made a single element look like four failures —
  // the narrow fix was then judged "unsuccessful" and discarded, escalating
  // straight to the page-wide hammer this module exists to avoid.
  const byRule = new Map();
  for (const v of (blocking || [])) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, []);
    const seen = byRule.get(v.rule);
    if (!seen.some((x) => (x.selector || '') === (v.selector || ''))) seen.push(v);
  }

  for (const [rule, group] of byRule) {
    // Structural rules have no meaningful element scope — delegate them.
    if (rule === 'html-validity' || rule === 'semantics') {
      try {
        const { nxAstAutoClose } = require('./nx_ast.js');
        const rep = nxAstAutoClose(out);
        if (rep.changed) { out = rep.html; applied.push({ rule, tier: 'document', selector: 'document', note: 'reparsed and re-serialised' }); }
      } catch (e) { /* leave as-is */ }
      continue;
    }
    if (!STRATEGY[rule]) { unresolved.push(...group); continue; }

    let fixed = false;
    for (const tier of NX_TIERS) {
      if (!STRATEGY[rule][tier]) continue;
      let candidate = out, notes = [], sels = [];
      for (const v of group) {
        const r = nxRepairOne(candidate, v, tier);
        if (r) { candidate = r.html; notes.push(r.note); sels.push(r.selector); }
      }
      if (candidate === out) continue;                 // this tier could not act
      // ESCALATE ONLY ON EVIDENCE: re-measure and keep the narrow fix if the
      // violation is gone. Otherwise discard it and widen.
      const after = validate ? validate(candidate) : null;
      const still = after ? after.blocking.filter((b) => b.rule === rule).length : 0;
      trace.push({ rule, tier, targets: sels, remaining: still });
      if (!after || still === 0) {
        out = candidate;
        applied.push({ rule, tier, selector: sels.join(', '), note: notes.join('; ') });
        fixed = true;
        break;
      }
      if (tier === 'page') { out = candidate; applied.push({ rule, tier, selector: 'page', note: notes.join('; ') }); }
    }
    if (!fixed) unresolved.push(...group);
  }
  return { html: out, applied, unresolved, trace };
}

/**
 * A repair instruction that escalates in specificity. Given the attempts
 * already made, produce a prompt stating exactly what was tried and why it
 * failed — never a bare "fix it".
 */
function nxRepairPrompt(violations, trace, attempt) {
  const lines = [`Repair attempt ${attempt}. The following BLOCKING problems remain after automated fixes:`];
  for (const v of violations.slice(0, 8)) {
    lines.push(`- [${v.rule}] ${v.selector || 'document'}${v.viewport ? ' @' + v.viewport : ''}: ${v.measured || ''} — ${v.message || ''}`);
  }
  if (trace && trace.length) {
    lines.push('', 'Already attempted (do not repeat these):');
    for (const t of trace.slice(-6)) {
      lines.push(`- ${t.rule}: ${t.tier}-scoped fix on ${(t.targets || []).join(', ') || 'page'} left ${t.remaining} violation(s)`);
    }
  }
  lines.push('', 'Change ONLY the elements named above. Do not restructure surrounding markup, and do not remove existing styling.');
  return lines.join('\n');
}

module.exports = { nxRepairScoped, nxRepairOne, nxRepairPrompt, nxUniqueSelector, nxContainerOf, NX_TIERS, STRATEGY };
