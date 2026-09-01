'use strict';
// ══════════════════════════════════════════════════════════════════════════
// nx_validate.js — THE VALIDATION PIPELINE (§0, §5, §6)
//
//   GENERATE → RENDER → MEASURE → SCORE → DECIDE → REPAIR → REPEAT
//
// Aggregates structural (nx_ast), layout (nx_layout), visual (nx_cascade) and
// copy (nx_copy) findings into ONE structured violation list, tagged by
// category, severity and location — the format §2 requires so REPAIR can act on
// specific measured facts instead of "make it look better".
//
// HONESTY REQUIREMENT (§1): no headless browser can be installed in this
// environment, so layout numbers are ESTIMATED, not rendered. Every report
// carries `renderer: 'approximate'` and `browserValidated: false`. Callers must
// surface that rather than claim a layout passed real validation.
// ══════════════════════════════════════════════════════════════════════════
const { JSDOM } = require('jsdom');
const { nxAstSyntaxGate, nxAstDeepAudit } = require('./nx_ast.js');
const { nxCascade } = require('./nx_cascade.js');
const { nxMeasure, NX_VIEWPORTS } = require('./nx_layout.js');
const { nxAuditCopy } = require('./nx_copy.js');

function __lum(h) {
  const m = String(h || '').replace('#', '');
  if (m.length < 6) return null;
  const c = [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function nxContrast(a, b) {
  const A = __lum(a), B = __lum(b);
  if (A == null || B == null) return null;
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
}

function nxValidatePage(html, opts) {
  opts = opts || {};
  const viewports = opts.viewports || NX_VIEWPORTS;
  const violations = [];
  const add = (v) => violations.push(v);

  // ── STRUCTURE (blocking: malformed markup changes layout silently) ──
  const gate = nxAstSyntaxGate(html);
  for (const e of gate.errors) add({ severity: 'blocking', category: 'structure', rule: 'html-validity', measured: e, message: e });
  const deep = nxAstDeepAudit(html);
  for (const i of deep.issues) add({ severity: 'blocking', category: 'structure', rule: 'semantics', measured: i, message: i });

  let dom;
  try { dom = new JSDOM(html); }
  catch (e) {
    add({ severity: 'blocking', category: 'structure', rule: 'unparseable', measured: e.message, message: 'Document could not be parsed.' });
    return __report(violations, [], null);
  }
  const doc = dom.window.document;
  const cascade = nxCascade(html, doc);

  // ── VISUAL: contrast on real resolved colours (§3.2) ──
  const bg = cascade.resolve('var(--bg)');
  const pairs = [['--text', 4.5, 'body text'], ['--muted', 4.5, 'muted text'], ['--faint', 3, 'faint text'], ['--accent', 4.5, 'accent text']];
  for (const [tok, min, label] of pairs) {
    const fg = cascade.resolve(`var(${tok})`);
    const ratio = nxContrast(fg, bg);
    if (ratio != null && ratio < min) {
      add({ severity: 'blocking', category: 'aesthetic', rule: 'contrast', selector: tok,
        measured: `${ratio.toFixed(2)}:1 (needs ${min}:1)`, message: `${label} fails WCAG contrast against the page background.` });
    }
  }
  // Dangling custom properties make any calc() using them invalid.
  for (const v of cascade.danglingVars()) {
    add({ severity: 'blocking', category: 'aesthetic', rule: 'undefined-token', selector: v,
      measured: v, message: `${v} is referenced but never defined; dependent values are invalid.` });
  }

  // ── LAYOUT across every required viewport (§1, §2) ──
  const perViewport = [];
  for (const vp of viewports) {
    const r = nxMeasure(html, doc, vp);
    perViewport.push({ viewport: r.viewport, issues: r.issues.length });
    for (const i of r.issues) add(i);
  }

  // ── COPY (§4.1) ──
  const copy = nxAuditCopy(doc);
  for (const i of copy.issues) add(i);

  try { dom.window.close(); } catch (e) {}
  return __report(violations, perViewport, copy);
}

function __report(violations, perViewport, copy) {
  const blocking = violations.filter(v => v.severity === 'blocking');
  const warnings = violations.filter(v => v.severity === 'warning');
  return {
    pass: blocking.length === 0,
    blocking, warnings, violations,
    perViewport,
    readability: copy ? copy.readability : null,
    // §1 / §6: never claim full validation without a real render.
    renderer: 'approximate',
    browserValidated: false,
    note: 'Layout geometry is ESTIMATED from the resolved cascade. No headless browser is available in this environment, so pixel-accurate layout, wrapping and overlap were NOT verified.',
  };
}

// §5/§6: iterate a generator against its own violations.
function nxValidateAndRepair(generate, repair, opts) {
  opts = opts || {};
  const max = Math.max(1, Math.min(6, opts.maxIterations || 4));
  const log = [];
  let html = generate();
  let report = nxValidatePage(html, opts);
  log.push({ iteration: 0, blocking: report.blocking.length, warnings: report.warnings.length });
  for (let i = 1; i <= max && !report.pass && typeof repair === 'function'; i++) {
    const next = repair(html, report.blocking, i);
    if (!next || next === html) break;         // no progress — stop, do not loop
    const cand = nxValidatePage(next, opts);
    // Never accept a repair that makes things worse (best-known-version rule).
    if (cand.blocking.length >= report.blocking.length) break;
    html = next; report = cand;
    log.push({ iteration: i, blocking: report.blocking.length, warnings: report.warnings.length });
  }
  return { html, report, iterations: log.length, log };
}

module.exports = { nxValidatePage, nxValidateAndRepair, nxContrast };
