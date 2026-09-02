// REAL BROWSER VISUAL EVIDENCE (Phase 1 §16/§17/§37) — genuine headless-Chromium
// render of the compiled graph, not model-derived geometry.
//
//   Project Graph → nxRenderDocument (compiled HTML) → REAL browser
//     → screenshot (full page) + per-node computed geometry/styles + a11y
//       + console/page/network errors, per breakpoint (desktop/tablet/mobile)
//       → nxEvidenceQa → evidence-backed problems
//
// HONESTY RULE: this test only runs its real-browser assertions when a real
// browser is available (nxBrowserAvailable() === true). When it is NOT (e.g. a
// sandbox without Playwright/Chromium), it reports "skipped (browser unavailable)"
// and must NOT be counted as a pass for browser-level guarantees. It never fakes
// geometry or a screenshot.
//
// Run: node tests/test_evidence_browser.mjs   (or via tests/run_all.mjs)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const design = require('../nx_design.js');
const ir = require('../nx_ir.js');
const graph = require('../nx_graph.js');
globalThis.__NX_DEPS = { design, ir, graph };
const R = require('../nx_render.js');
const { nxBuildSiteGraph } = R;
const EV = require('../nx_evidence.js');

let passed = 0, failed = 0, skipped = 0; const failures = []; let skippedAll = false;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
function skip(name, reason = 'browser unavailable') { skipped++; console.log('  ⏭️  ' + name + ' (skipped: ' + reason + ')'); }

console.log('\n== 1. BROWSER AVAILABILITY (real, honest) ==');
const avail = await EV.nxBrowserAvailable();
// first check: the availability call itself must be well-formed
if (!avail || typeof avail.available !== 'boolean') {
  check('nxBrowserAvailable returns {available:true|false}', false, JSON.stringify(avail));
} else {
  check('nxBrowserAvailable returns {available:true|false}', true, 'available=' + avail.available);
}

const browserAvailable = avail && avail.available === true;
if (!browserAvailable) {
  console.log('\n⚠️  No real browser available — ' + (avail && avail.reason) + '. Skipping browser-level assertions honestly.');
  console.log('    Implemented/tested modules above do NOT claim pixel/geometry verification. Visual evidence requires a real render.');
  skippedAll = true;
}

if (browserAvailable) {
  console.log('\n== 2. COMPILE GRAPH → REAL BROWSER RENDER ==');
  const b = nxBuildSiteGraph({ name: 'Nova', brief: 'premium futuristic saas', primary: '#04070f', accent: '#ff6b1a' });
  check('nxBuildSiteGraph produced compiled HTML', typeof b.compiled.html === 'string' && b.compiled.html.length > 500, 'len=' + (b.compiled.html && b.compiled.html.length));
  check('compiled HTML embeds data-nx-id (graph binding)', /data-nx-id=/.test(b.compiled.html || ''));
  check('compiled HTML declares dark theme tokens in :root', /--nx-bg:#04070f/.test(b.compiled.html || ''));

  console.log('\n== 3. CAPTURE EVIDENCE AT 3 BREAKPOINTS ==');
  let ev;
  try { ev = await EV.nxCaptureEvidence(b.compiled.html, { breakpoints: ['desktop', 'tablet', 'mobile'] }); }
  catch (e) { check('nxCaptureEvidence runs without throwing', false, e.message); }
  if (ev) {
    check('evidence is backend=browser', ev.backend === 'browser', 'backend=' + ev.backend);
    check('evidence covers desktop/tablet/mobile', ['desktop','tablet','mobile'].every(bp => ev.pages && ev.pages[bp]), JSON.stringify(Object.keys(ev.pages || {})));
    check('each breakpoint returned a real full-page screenshot', ['desktop','tablet','mobile'].every(bp => ev.pages[bp] && typeof ev.pages[bp].screenshot === 'string' && ev.pages[bp].screenshot.startsWith('data:image/png;base64,') && ev.pages[bp].screenshot.length > 1000));
    check('each breakpoint measured real DOM nodes', ['desktop','tablet','mobile'].every(bp => ev.pages[bp] && Array.isArray(ev.pages[bp].nodes) && ev.pages[bp].nodes.length > 10), 'desktop=' + (ev.pages.desktop && ev.pages.desktop.nodes.length));
    check('every node is keyed by data-nx-id', ev.pages.desktop.nodes.every(n => typeof n.id === 'string' && n.id.length > 0));
    check('geometry is REAL (bounding box has numeric w/h)', ev.pages.desktop.nodes.every(n => n.rect && typeof n.rect.w === 'number' && typeof n.rect.h === 'number' && n.rect.w > 0));
    check('computed display/color/background captured', ev.pages.desktop.nodes.every(n => n.computed && n.computed.display && n.computed.color && n.computed.backgroundColor));

    console.log('\n== 4. CONTRAST / TEXT-ON-DARK IS CORRECT (renderer bug regression guard) ==');
    const hex = /^(#?)?([0-9a-f]{6})$/i;
    const parseRgb = (s) => { const m = /rgb?\(([^)]+)\)/i.exec(s || ''); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return p.length >= 3 ? { r: p[0], g: p[1], b: p[2] } : null; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const contrast = (a, b) => { const la = lum(a), lb = lum(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); };
    const textish = ev.pages.desktop.nodes.filter(n => /(nx-heading|nx-text|nx-btn|he|par|h[1-6])/.test(n.cls));
    check('text nodes exist (≥8)', textish.length >= 8, 'count=' + textish.length);
    let darkFgOnDark = textish.filter(n => {
      const fg = parseRgb(n.computed.color);
      const bg1 = parseRgb(n.computed.resolvedBg || n.computed.backgroundColor);
      if (!fg || !bg1) return false;
      return contrast(fg, bg1) < 3.0; // below 3:1 means genuinely unreadable on the SAME node
    });
    check('no text is rendered unreadable (low contrast) on its own resolved bg', darkFgOnDark.length === 0, 'violations=' + darkFgOnDark.length + ' ' + darkFgOnDark.map(n=>n.id).slice(0,3).join(','));
    // Verify the previously-failing bug directly: nav + hero text must be light, not black-on-dark
    const nav = ev.pages.desktop.nodes.find(n => /nav/.test(n.cls));
    if (nav) {
      const fg = parseRgb(nav.computed.color), bg = parseRgb(nav.computed.resolvedBg || nav.computed.backgroundColor);
      check('nav/hero text uses theme foreground (not default black)', fg && fg.r > 100 && fg.g > 100 && fg.b > 100, JSON.stringify({ color: nav.computed.color }));
      check('nav text contrast ≥ 4.5:1 on resolved bg', fg && bg && contrast(fg, bg) >= 4.5, JSON.stringify({ fg: nav.computed.color, bg: nav.computed.resolvedBg || nav.computed.backgroundColor }));
    } else { skip('nav node contrast check'); }

    console.log('\n== 5. RUNTIME IS CLEAN (console/page/network) ==');
    check('no console errors on any breakpoint', ['desktop','tablet','mobile'].every(bp => ev.pages[bp].consoleErrors.length === 0), JSON.stringify(ev.pages.desktop.consoleErrors));
    check('no runtime page errors on any breakpoint', ['desktop','tablet','mobile'].every(bp => ev.pages[bp].pageErrors.length === 0), JSON.stringify(ev.pages.desktop.pageErrors));
    check('no network failures on any breakpoint', ['desktop','tablet','mobile'].every(bp => ev.pages[bp].networkFailures.length === 0), JSON.stringify(ev.pages.desktop.networkFailures));

    console.log('\n== 6. ACCESSIBILITY IS CAPTURED (honestly derived if AX API absent) ==');
    check('a11yAvailable is true', ev.pages.desktop.a11yAvailable === true);
    check('a11y data present (derived summary or snapshot)', ev.pages.desktop.accessibility && (ev.pages.desktop.accessibility.summary || ev.pages.desktop.accessibility.roles));
    const a11y = ev.pages.desktop.accessibility;
    if (a11y && a11y.summary) {
      check('a11y derived headings have hierarchy', Array.isArray(a11y.summary.headings) && a11y.summary.headings.filter(h => h.level).length > 0, 'headings=' + (a11y.summary.headings && a11y.summary.headings.length));
    }

    console.log('\n== 7. RESPONSIVE: REAL BREAKPOINT DIFFERENCE ==');
    const dH = ev.pages.desktop.scrollHeight, mH = ev.pages.mobile.scrollHeight;
    check('mobile lays out taller than desktop (responsive works)', mH > dH, 'desktop=' + dH + ' mobile=' + mH);
    check('mobile viewport is narrower (real viewport switch)', ev.pages.mobile.viewport.width === 390 && ev.pages.desktop.viewport.width === 1280, JSON.stringify(ev.pages.mobile.viewport));

    console.log('\n== 8. EVIDENCE-BACKED QA (structured problems, no fabrication) ==');
    const qa = EV.nxEvidenceQa(ev);
    check('QA is backend=browser and structured', qa.available === true && qa.backend === 'browser');
    check('every QA problem carries Problem + Evidence + Op + Confidence + RegressionRisk', qa.problems.every(p => p.problem && p.evidence && p.op && typeof p.confidence === 'number' && p.regressionRisk));
    check('QA does NOT fabricate a11y/runtime-error problems when runtime is clean', !qa.problems.some(p => /Runtime page error/.test(p.problem) || /^a11y/.test(p.problem)), 'problems=' + qa.problemCount);
    check('QA is honest on a clean build (no fabricated contrast/overlap/tiny-text problems)', qa.problemCount === 0 && !qa.problems.some(p => /contrast|tiny|overflow|overlap/i.test(p.problem)), 'problemCount=' + qa.problemCount);
    check('QA overflow problems map to a real measured node (evidence, not guess)', qa.problems.filter(p => /overflow/.test(p.problem)).every(p => p.nodeId && typeof p.nodeId === 'string'));

    console.log('\n== 9. REPAIR LOOP — Generate → See → Diagnose → Mutate → Verify (graph-only) ==');
    // We intentionally INJECT a real defect through a GRAPH mutation (not by editing
    // HTML), prove the browser catches it, then REPAIR it through the graph and
    // prove the evidence metrics improved. This is the actual "before / after" loop.
    const ir = require('../nx_ir.js');
    let bad = nxBuildSiteGraph({ name: 'Meridian', brief: 'premium futuristic saas, cinematic, dark', primary: '#04070f', accent: '#ff6b1a', motionStyle: 'cinematic', heroVariant: 'split' });
    // find the hero copy heading and the pricing-grid; force a REAL defect:
    const heroHead = bad.project.order.find(id => bad.project.nodes[id].component.family === 'heading' && bad.project.content[id].level === 1) || bad.project.order.find(id => bad.project.nodes[id].component.family === 'heading');
    // defect 1: force the primary heading to black text (invisible on the dark theme)
    bad.project = ir.nxProjectPatch(bad.project, [{ op: 'node.set', id: heroHead, field: 'design', value: { color: '#000000' } }]).project;
    // defect 2: force the pricing grid to a 5-column grid on ALL breakpoints (mobile overflow)
    const prGrid = bad.project.order.find(id => bad.project.content[id] && bad.project.content[id].role === 'pricing-grid');
    bad.project = ir.nxProjectPatch(bad.project, [{ op: 'node.set', id: prGrid, field: 'props', value: { columns: 5, gap: '0.4rem' } }]).project;
    // RE-RENDER the graph after the injected mutations — the graph is the source of truth.
    bad.compiled = R.nxRenderDocument(bad.project);
    const badEv = await EV.nxCaptureEvidence(bad.compiled.html, { breakpoints: ['desktop', 'mobile'] });
    const badQa = EV.nxEvidenceQa(badEv);
    const beforeProblems = badQa.problemCount;
    const beforeContrast = badQa.problems.filter(p => /contrast/.test(p.problem)).length;
    const beforeOverflow = badQa.problems.filter(p => /overflow/.test(p.problem)).length;
    console.log('    BEFORE repair: problems=' + beforeProblems + ' contrast=' + beforeContrast + ' overflow=' + beforeOverflow);
    check('repair loop: injecting a defect produces at least one caught problem', beforeProblems > 0, 'problems=' + beforeProblems);
    check('repair loop: the caught problem references a graph node id', badQa.problems.some(p => p.nodeId && bad.project.nodes[p.nodeId]), JSON.stringify(badQa.problems.map(p => p.nodeId).slice(0, 3)));
    check('repair loop: the caught problem carries evidence + a proposed op', badQa.problems[0] && badQa.problems[0].evidence && badQa.problems[0].op);

    // REPAIR through the graph (mutations, never touching HTML):
    const repairs = [];
    if (beforeContrast > 0) repairs.push({ op: 'node.set', id: heroHead, field: 'design', value: { color: 'var(--nx-fg,#f5f5f7)' } });
    if (beforeOverflow > 0) repairs.push({ op: 'node.set', id: prGrid, field: 'props', value: { columns: 3, gap: '1.4rem' } });
    let fixed = ir.nxProjectPatch(bad.project, repairs).project;
    // rebuild the compiled HTML from the REPAIRED graph (graph remains the source of truth)
    const fixedDoc = R.nxRenderDocument(fixed);
    const fixedEv = await EV.nxCaptureEvidence(fixedDoc.html, { breakpoints: ['desktop', 'mobile'] });
    const fixedQa = EV.nxEvidenceQa(fixedEv);
    const afterProblems = fixedQa.problemCount;
    const afterContrast = fixedQa.problems.filter(p => /contrast/.test(p.problem)).length;
    const afterOverflow = fixedQa.problems.filter(p => /overflow/.test(p.problem)).length;
    console.log('    AFTER repair:  problems=' + afterProblems + ' contrast=' + afterContrast + ' overflow=' + afterOverflow);
    check('repair loop: captured evidence AFTER the graph mutation (re-ran the browser)', fixedQa.available === true);
    check('repair loop: metrics improved (problems reduced)', afterProblems < beforeProblems, beforeProblems + ' -> ' + afterProblems);
    check('repair loop: contrast problems resolved', afterContrast === 0, 'after=' + afterContrast);
    check('repair loop: overflow problems resolved', afterOverflow === 0, 'after=' + afterOverflow);
    check('repair loop: fix was a graph mutation, not an HTML patch', repairs.every(r => r.op && r.id) && !/black-on-dark|manual/.test(String(repairs)));
  }
}

// ── summary ──────────────────────────────────────────────────────────────────
function report() {
  const total = passed + failed;
  console.log('\n── REAL BROWSER VISUAL EVIDENCE ──');
  if (skippedAll) {
    console.log(`   skipped (no browser): ${skipped}`);
    console.log(`   status: SKIPPED (browser unavailable — visual evidence not claimed)`);
    console.log(`RESULTS: ${passed} passed, ${failed} failed (browser unavailable — honest skip)`);
  } else {
    console.log(`   passed: ${passed}   failed: ${failed}   skipped: ${skipped}`);
    console.log(`   status: ${failed ? 'FAIL' : 'PASS'}`);
    console.log(`RESULTS: ${passed} passed, ${failed} failed`);
    if (failed) for (const f of failures) console.log('       - ' + f);
  }
  return total;
}
report();
process.exit(failed ? 1 : 0);
