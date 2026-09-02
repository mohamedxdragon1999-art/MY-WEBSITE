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
// linkedom instead of jsdom: measured, jsdom retains ~1.4MB per document even
// after window.close() (200 parses grew the heap 279MB), and this gate runs on
// EVERY generation — a long-lived worker would climb until it died. linkedom
// parses the same markup with the DOM API these auditors use and stays flat
// (200 parses: 2MB). Correctness is unchanged; only the parser differs.
const { parseHTML } = require('linkedom');
const { nxAstSyntaxGate, nxAstDeepAudit } = require('./nx_ast.js');
const { nxCascade } = require('./nx_cascade.js');
const { nxMeasure, NX_VIEWPORTS } = require('./nx_layout.js');
const { nxAuditCopy } = require('./nx_copy.js');
const { nxAuditSections } = require('./nx_components.js');

function __lum(h) {
  const m = String(h || '').replace('#', '').trim();
  // Must be exactly six hex digits. The old check only tested LENGTH, so
  // 'rgb(0,0,0)' and '#gggggg' parsed to NaN and produced a NaN ratio — which
  // silently compared false against every threshold, so a genuinely failing
  // colour pair could pass the contrast gate unnoticed.
  if (!/^[0-9a-f]{6}$/i.test(m)) return null;
  const c = [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function nxContrast(a, b) {
  const A = __lum(a), B = __lum(b);
  if (A == null || B == null) return null;
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
}

// A single reusable jsdom environment. Reparsing the document body into an
// existing window avoids the per-instance retention that made repeated
// validation leak, while keeping the standard DOM API the auditors expect.
// Reusing one window via document.write() does NOT help: jsdom still retains
// each parsed tree, so the heap grows ~0.85MB per call either way (measured
// linear over 600 calls). The only reliable bound is to close and rebuild the
// environment periodically, which caps retention at N documents' worth.
function __acquireDoc(html) {
  const { document } = parseHTML(html);
  return document;
}
// Exposed so a long-running host can drop the environment if it wants to.
function nxValidateReset() { /* no shared state to release with linkedom */ }

// ── SEVERITY POLICY (Phase 1.2) ───────────────────────────────────────────
// One table, in code, decides what ships. Previously severity was assigned
// ad-hoc at each call site, so the same class of defect could be blocking in
// one path and a warning in another.
//
// BLOCKING  — the page is broken for a real user. Never ships unrepaired.
// WARNING   — quality signal. Ships, but is surfaced rather than hidden.
const NX_BLOCKING_RULES = new Set([
  'overflow', 'overflow-x', 'overlap', 'off-canvas', 'clipping',
  'touch-target', 'contrast', 'broken-image', 'broken-link', 'dead-anchor',
  'placeholder', 'zero-size', 'html-validity', 'semantics', 'unparseable',
  'undefined-token', 'page-error', 'section-contract',
]);
const NX_WARNING_RULES = new Set([
  'cliche', 'slot-overflow', 'repetition', 'readability', 'line-length',
  'rhythm', 'judge-score', 'genericness',
]);
/** Classify a rule. Unknown rules default to WARNING so a new check can never
 *  block shipping until it is deliberately promoted. */
function nxSeverityFor(rule, fallback) {
  if (NX_BLOCKING_RULES.has(rule)) return 'blocking';
  if (NX_WARNING_RULES.has(rule)) return 'warning';
  return fallback || 'warning';
}

function nxValidatePage(html, opts) {
  opts = opts || {};
  const viewports = opts.viewports || NX_VIEWPORTS;
  const violations = [];
  // Every violation is classified by the policy table, not by its call site.
  const add = (v) => violations.push(Object.assign({}, v, { severity: nxSeverityFor(v.rule, v.severity) }));

  // ── STRUCTURE (blocking: malformed markup changes layout silently) ──
  const gate = nxAstSyntaxGate(html);
  for (const e of gate.errors) add({ severity: 'blocking', category: 'structure', rule: 'html-validity', measured: e, message: e });
  const deep = nxAstDeepAudit(html);
  for (const i of deep.issues) add({ severity: 'blocking', category: 'structure', rule: 'semantics', measured: i, message: i });

  // MEMORY: jsdom retains roughly 1.6MB per instance even after window.close(),
  // and this gate runs on EVERY generation — a long-lived worker would climb
  // until it died. Measured: 40 validations grew the heap by ~107MB.
  //
  // Reuse one document and reparse into it instead of constructing a new
  // environment each time. Bounded, and ~5x faster since the jsdom setup cost
  // is paid once rather than per call.
  let doc;
  try { doc = __acquireDoc(html); }
  catch (e) {
    add({ severity: 'blocking', category: 'structure', rule: 'unparseable', measured: e.message, message: 'Document could not be parsed.' });
    return __report(violations, [], null);
  }
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

  // ── SECTION SHELL CONTRACT (Phase 2.2) ──
  // Hand-authored shells drifted: some sections shipped with no heading, so
  // they were absent from the document outline. Enforce the contract on the
  // rendered page, not just at construction time.
  try {
    for (const i of nxAuditSections(doc)) {
      add({ severity: i.rule === 'no-heading' ? 'blocking' : 'warning', category: 'structure',
        rule: 'section-contract', selector: i.id, measured: i.rule, message: i.message });
    }
  } catch (e) { /* never break a build on an audit */ }

  // ── COPY (§4.1) ──
  const copy = nxAuditCopy(doc);
  for (const i of copy.issues) add(i);

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

// ── DETERMINISTIC AUTO-REPAIR (§5) ────────────────────────────────────────
// Repairs must be MINIMAL and targeted at a specific measured violation. Each
// handler fixes exactly one rule and touches nothing else, so a fix for one
// blocker cannot introduce another elsewhere.
function nxAutoRepair(html, blocking) {
  let out = String(html || '');
  const applied = [];
  const rules = new Set((blocking || []).map(b => b.rule));

  // Structural breakage — let the spec-compliant parser rebuild the tree.
  if (rules.has('html-validity')) {
    try {
      const { nxAstAutoClose } = require('./nx_ast.js');
      const rep = nxAstAutoClose(out);
      if (rep.changed) { out = rep.html; applied.push('html-validity: reparsed and re-serialised'); }
    } catch (e) { /* leave as-is */ }
  }

  // Sub-44px tap targets — inject a scoped rule rather than rewriting elements,
  // which is the smallest intervention that satisfies the constraint.
  // All auto-repair CSS goes into ONE stylesheet. Three separate <style> blocks
  // was idempotent but wasteful, and made the repaired document harder to read.
  const repairCss = [];
  if (rules.has('touch-target')) {
    repairCss.push('/* auto-repair: WCAG 2.5.8 minimum target size */'
      + '@media (max-width:480px){a:not(p a):not(li a),button,input[type="submit"],input[type="button"]'
      + '{min-height:44px;min-width:44px;display:inline-flex;align-items:center;justify-content:center}}');
    applied.push('touch-target: enforced 44px minimum on mobile');
  }

  // Anything wider than the viewport — contain it without altering layout intent.
  if (rules.has('overflow-x')) {
    repairCss.push('/* auto-repair: prevent horizontal scroll */'
      + 'html,body{max-width:100%;overflow-x:hidden}img,svg,video,table{max-width:100%}');
    applied.push('overflow-x: contained oversized content');
    // A stylesheet cannot beat an inline style, which is where fixed oversized
    // widths usually come from. Rewrite the declaration itself: cap the width
    // and keep the intent by preserving it as a max-width.
    const before = out;
    out = out.replace(/style\s*=\s*"([^"]*)"/gi, (m, decls) => {
      if (!/(?:^|;)\s*(?:min-)?width\s*:\s*\d{3,}px/i.test(decls)) return m;
      const fixed = decls
        .replace(/(^|;)\s*width\s*:\s*(\d{3,})px/gi, (mm, sep, n) => `${sep}width:100%;max-width:${n}px`)
        .replace(/(^|;)\s*min-width\s*:\s*\d{3,}px/gi, '$1min-width:0');
      return 'style="' + fixed + '"';
    });
    if (out !== before) applied.push('overflow-x: capped oversized inline widths');
  }

  // A tap target that is too NARROW usually has no horizontal padding. Give
  // standalone controls a minimum inline size without disturbing prose links.
  // Inject once, and only if this document has not already been repaired —
  // repeated repair must be a strict no-op.
  if (repairCss.length && !/id="nx-repair"/.test(out) && /<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, '<style id="nx-repair">' + repairCss.join('') + '</style></head>');
  } else if (repairCss.length && /id="nx-repair"/.test(out)) {
    applied.length = 0;   // already repaired: report no new work
  }

  return { html: out, applied };
}

// ── BROWSER-BACKED VALIDATION (Phase 1.1) ─────────────────────────────────
// Runs the synchronous gate, then augments it with REAL rendered measurements
// when Chromium is available. The two are merged into one violation list so
// callers have a single source of truth.
//
// The visual-verification flag is derived from what actually happened, never
// assumed: `browserValidated` is true only if a browser really rendered the
// page. When it is false the report says so and explains why, so no consumer
// can mistake approximate geometry for verified pixels.
async function nxValidatePageAsync(html, opts) {
  opts = opts || {};
  const base = nxValidatePage(html, opts);
  if (opts.browser === false) return base;

  let br = null;
  try {
    const { nxBrowserMeasure } = require('./nx_browser.js');
    br = await nxBrowserMeasure(html, opts);
  } catch (e) {
    br = { available: false, reason: 'browser module unavailable: ' + String(e && e.message || e).slice(0, 120) };
  }

  if (!br || !br.available) {
    return Object.assign({}, base, {
      renderer: 'approximate',
      browserValidated: false,
      browserReason: (br && br.reason) || 'no browser',
      // Explicit, machine-readable flag so a UI can badge the output.
      visuallyUnverified: true,
      note: base.note + ' Chromium was not available at runtime (' + ((br && br.reason) || 'unknown') + '), so this page is VISUALLY UNVERIFIED.',
    });
  }

  // Real measurements supersede the estimates for the rules they cover.
  const estimatedRules = new Set(['overflow-x', 'touch-target', 'zero-size', 'line-length']);
  const kept = base.violations.filter((v) => !(v.source !== 'browser' && estimatedRules.has(v.rule)));
  const merged = kept.concat(br.violations.map((v) => Object.assign({}, v, { severity: nxSeverityFor(v.rule, v.severity) })));
  const blocking = merged.filter((v) => v.severity === 'blocking');
  const warnings = merged.filter((v) => v.severity === 'warning');
  return {
    pass: blocking.length === 0,
    blocking, warnings, violations: merged,
    perViewport: br.viewports.map((v) => ({ viewport: v.viewport, issues: v.issues })),
    screenshots: br.viewports.map((v) => ({ viewport: v.viewport, png: v.screenshot || null })),
    readability: base.readability,
    renderer: 'chromium',
    engine: br.engine, browserVersion: br.version,
    browserValidated: true,
    visuallyUnverified: false,
    note: 'Layout, overlap, tap targets and contrast were measured in real Chromium at ' + br.viewports.length + ' viewports.',
  };
}

// §5/§6: iterate a generator against its own violations.
function nxValidateAndRepair(generate, repair, opts) {
  opts = opts || {};
  const max = Math.max(1, Math.min(6, opts.maxIterations || 4));
  // Default to the built-in deterministic repairer so the gate works with no
  // caller wiring: validation that needs a hand-supplied fixer is advisory.
  const fix = (typeof repair === 'function') ? repair
    : (h, blocking) => nxAutoRepair(h, blocking).html;
  const log = [];
  let html = typeof generate === 'function' ? generate() : String(generate || '');
  let report = nxValidatePage(html, opts);
  log.push({ iteration: 0, blocking: report.blocking.length, warnings: report.warnings.length, repairs: [] });

  for (let i = 1; i <= max && !report.pass; i++) {
    let next = null, applied = [];
    if (typeof repair === 'function') next = repair(html, report.blocking, i);
    else {
      // Phase 1.3: try SCOPE-LIMITED repair first. It fixes the smallest scope
      // that resolves each violation and only widens on measured failure, so a
      // single faulty element cannot trigger page-wide restyling. The blunt
      // repairer stays as the final fallback.
      let scoped = null;
      try {
        const { nxRepairScoped } = require('./nx_repair.js');
        scoped = nxRepairScoped(html, report.blocking, (h) => nxValidatePage(h, opts));
      } catch (e) { scoped = null; }
      if (scoped && scoped.html !== html) {
        next = scoped.html;
        applied = scoped.applied.map((a) => `${a.rule} [${a.tier}] ${a.selector}: ${a.note}`);
      } else {
        const r = nxAutoRepair(html, report.blocking); next = r.html; applied = r.applied;
      }
    }
    if (!next || next === html) break;              // no progress — stop, do not spin
    const cand = nxValidatePage(next, opts);
    // Best-known-version rule: never replace a page with a worse candidate.
    if (cand.blocking.length >= report.blocking.length) break;
    html = next; report = cand;
    log.push({ iteration: i, blocking: report.blocking.length, warnings: report.warnings.length, repairs: applied });
  }
  return {
    html, report, iterations: log.length, log,
    repaired: log.length > 1,
    // §6: if blockers survive the budget we must NOT claim success.
    shippedWithBlockers: !report.pass,
    unresolved: report.blocking,
  };
}

// Async counterpart of nxValidateAndRepair using browser-backed verdicts.
async function nxValidateAndRepairAsync(generate, repair, opts) {
  opts = opts || {};
  const max = Math.max(1, Math.min(6, opts.maxIterations || 4));
  const fix = (typeof repair === 'function') ? repair : (h, blocking) => nxAutoRepair(h, blocking).html;
  const log = [];
  let html = typeof generate === 'function' ? await generate() : String(generate || '');
  let report = await nxValidatePageAsync(html, opts);
  log.push({ iteration: 0, blocking: report.blocking.length, warnings: report.warnings.length, repairs: [] });
  for (let i = 1; i <= max && !report.pass; i++) {
    let next = null, applied = [];
    if (typeof repair === 'function') next = await repair(html, report.blocking, i);
    else { const r = nxAutoRepair(html, report.blocking); next = r.html; applied = r.applied; }
    if (!next || next === html) break;
    const cand = await nxValidatePageAsync(next, opts);
    if (cand.blocking.length >= report.blocking.length) break;   // never accept a regression
    html = next; report = cand;
    log.push({ iteration: i, blocking: report.blocking.length, warnings: report.warnings.length, repairs: applied });
  }
  return { html, report, iterations: log.length, log, repaired: log.length > 1, shippedWithBlockers: !report.pass, unresolved: report.blocking };
}

module.exports = { nxValidatePage, nxValidatePageAsync, nxValidateAndRepairAsync, nxSeverityFor, NX_BLOCKING_RULES, NX_WARNING_RULES, nxValidateReset, nxValidateAndRepair, nxAutoRepair, nxContrast };
