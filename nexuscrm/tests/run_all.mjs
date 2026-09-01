// FULL BATTERY RUNNER — one command, every suite, plus ROUTE COVERAGE
// ENFORCEMENT: every route the worker actually serves must be exercised by
// at least one suite. A route with zero coverage is a failure — the "we
// shipped it but never tested it" class of risk dies here.
//
// Run: node tests/run_all.mjs        (or: npm test)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SUITES = [
  'test_backend.mjs',
  'test_template_design.mjs', // graph-driven reference-template design library + plan->site builder
  'test_template_prod.mjs',   // production path: design_id:'template' routes through generateSiteHtml
  'test_design_system.mjs',   // design-quality foundation: strategy/directions/maturity + QA detects+fixes bad designs
  'test_composition.mjs',     // Cycle 2: direction-authoritative composition — rendered DOM/typography/rhythm/section order differ per direction (color-only fails)
  'test_live_direction.mjs',  // Cycle 2: the direction is authoritative on the LIVE route (POST /ai/agentic-build), not just in unit tests
  'test_compose_robustness.mjs', // Cycle 2: adversarial plans (hostile/malformed/unicode) + rendered a11y & document semantics
  'test_render_quality.mjs',    // Cycle 2: rendered craft invariants — type hierarchy, emphasis budget, rhythm, WCAG contrast, mobile re-composition
  'test_graph_hardening.mjs',   // Adversarial: IR mutation purity/atomicity, prototype-key impersonation, integrity validator, render + canvas entry points
  'test_deep.mjs',
  'test_edge_cases.mjs',
  'test_isolation.mjs',
  'test_fuzz.mjs',
  'test_concurrency.mjs',
  'test_ai_robustness.mjs',
  'test_ai_providers.mjs',   // NIM simulator: provider layer, breaker, catalog, caps
  'test_ai_hardening.mjs',   // hardening cycles: SSRF guards, key shapes, caps, burst limiter
  'test_local_ai_proxy.mjs', // real server.js relay: allowlist, streaming, caps, key hygiene
  'test_spline_scenes.mjs',  // 50-scene library: structure, text contract, wiring, idempotency
  'test_cmdk.mjs',          // Ctrl+K command palette: fuzzy, keyboard, XSS, caps
  'test_deploy_studio.mjs',  // one-click backend deploy + settings validation + server.js
  'test_webchat_widget.mjs',
  'test_route_coverage.mjs',
  'test_deploy.mjs',
  'test_aurora.mjs',         // v0.0.1.0 Aurora overhaul: appearance, sparklines, palette, CSS layer
  'test_frontend.mjs',
  'test_real_nvidia.mjs',   // skips cleanly when no key file present
  'test_benchmark.mjs',      // v0.0.1.1: before/after perf (esc memo, DB serialize, heal/migrate)
  'test_xss_injection.mjs',  // v0.0.1.1: new a11y render paths keep user data inert
  'test_overhaul.mjs',       // v0.0.1.1: data-safety + modal a11y + decorateA11y + stream guard
  'test_site_quality.mjs',   // v0.0.1.2: website quality engine (audit + enhance + /sites/:id/audit)
  'test_blueprint.mjs',      // v0.0.1.3: deterministic Blueprint engine (industry + plan + no-AI sections)
  'test_agentic.mjs',        // v0.0.1.4: agentic build loop + testing agent + debugger + version control
  'test_visual.mjs',         // v0.0.1.5: AI visual editor (click-to-select WYSIWYG + command engine)
  'test_design.mjs',         // v0.0.1.6: design-system core (brand/tokens, project graphs, motion, component families, exploration, design QA, bidirectional)
  'test_design_route.mjs',   // v0.0.1.6: POST /sites/:id/design (explore → graph → render → score → persist)
  'test_ir.mjs',             // v0.0.1.7: IR contracts + schemas, Project Mutation Engine, Design Brief, constraint/layout, Interaction Graph, motion composition, compiler pipeline, Design-QA sub-scores, Critic→Patch loop
  'test_integrity.mjs',      // v0.0.1.9: graph integrity + true atomic mutation (failed txn mutates nothing, cycle/dangling/symmetry rejected, delete cleans cross-graph)
  'test_graph.mjs',          // v0.0.1.8: Layout Constraint Graph + Solver, State Graph, Asset Graph subsystem, History/Diff engine, Intent→Patch, evidence Critic, Motion Timeline/Budget, Best-Known-Version evolution
  'test_render_v2.mjs',      // v0.0.1.9: TRUE graph renderer (recursive, component registry, real children) + runtime + real canvas (group/ungroup/multi-select/semantic drag) + breakpoint pass
  'test_import.mjs',         // v0.0.1.9: HTML → Project Graph import/migration layer with confidence (extracted/inferred/unknown) + extracted tokens/assets/cards
  'test_version.mjs',        // v0.0.1.9+: version snapshot fidelity, real revert (restores the graph), honest nxDiff, measured nxCompare delta
  'test_projects.mjs',       // v0.0.1.9+: four integration projects (SaaS/Luxury/Restaurant/Portfolio) built + rendered through the real graph, incl arbitrary nested graphs
  'test_canvas.mjs',         // v0.0.1.9+: canvas is a REAL graph-mutating surface — adopts immutable project, deep in-place duplicate, drag preserves constraints, design props render, group/ungroup round-trip
  'test_graph_version.mjs',  // v0.0.1.10: GRAPH-NATIVE PERSISTENCE — the DB stores the canonical IR graph; snapshots capture it; restore recomputes HTML from the graph. Legacy HTML-only snapshots still fall back.
  'test_visual_evidence.mjs',// v0.0.1.10: VISUAL EVIDENCE QA — computed geometry + per-node a11y/contrast + heading hierarchy, with evidence-backed problems; responsive + reduced-motion now authored in the graph
  'test_import_bridge.mjs',  // v0.0.1.10: HTML → GRAPH MIGRATION BRIDGE — bring a legacy/build_with_ai HTML site into the graph world, persist the graph, re-render from it, graph-first restore
  'test_evidence_browser.mjs', // v0.0.1.10: REAL BROWSER VISUAL EVIDENCE — headless-Chromium render → full-page screenshot + computed geometry + a11y + console/page/network errors per breakpoint → evidence-backed QA. Skips honestly when no browser.
  'test_e2e.mjs',            // v0.0.1.9: END-TO-END acceptance — prompt → brief → explore → graph → constraints → motion → interactions → assets → compile → canvas → drag → responsive → intent→patch → runtime → QA → evidence critic → accept/retain best-known → save → publish
];

// ── Route inventory: what does the worker ACTUALLY serve? ─────
function routeInventory() {
  const src = readFileSync(join(ROOT, 'backend', 'src', 'index.js'), 'utf8');
  const routes = new Set();
  // Resource roots dispatched in the router
  for (const m of src.matchAll(/root === '([\w-]+)'/g)) {
    const r = '/' + m[1];
    // Bare "/ai" and "/public" are prefixes, not endpoints (they 404) —
    // only their sub-routes are real.
    if (r !== '/ai' && r !== '/public') routes.add(r);
  }
  // Literal paths
  for (const m of src.matchAll(/path === '\/([\w\/-]+)'/g)) routes.add('/' + m[1]);
  // Public subroutes — ONLY those inside the public-endpoints block
  // (parts[1] matches elsewhere belong to other roots).
  const pubStart = src.indexOf('── PUBLIC ENDPOINTS');
  const pubEnd = pubStart === -1 ? -1 : src.indexOf('── MAIN ROUTER', pubStart);
  if (pubStart !== -1 && pubEnd !== -1) {
    const pubBlock = src.slice(pubStart, pubEnd);
    for (const m of pubBlock.matchAll(/parts\[1\] === '([\w-]+)'/g)) routes.add('/public/' + m[1]);
  }
  return [...routes].sort();
}

// ── Run every suite in its own process ────────────────────────
console.log('NexusCRM full battery — ' + SUITES.length + ' suites\n');
const t0 = Date.now();
const results = [];
for (const suite of SUITES) {
  const proc = spawnSync(process.execPath, [join(__dirname, suite)], { encoding: 'utf8', timeout: 10 * 60 * 1000 });
  const out = proc.stdout || '';
  const m = out.match(/(?:RESULTS?|DEEP RESULTS|EDGE RESULTS|DEPLOY RESULTS|AI ROBUSTNESS RESULTS|CONCURRENCY RESULTS|ISOLATION RESULTS|FUZZ RESULTS):\s*(.+)$/m);
  const cov = out.match(/^ROUTE_COVERAGE_JSON: (.+)$/m);
  const exitOk = proc.status === 0;
  results.push({
    suite,
    summary: m ? m[1].trim() : (exitOk ? 'completed' : 'CRASHED / no summary'),
    pass: exitOk,
    coverage: cov ? JSON.parse(cov[1]) : [],
  });
  const mark = exitOk ? '✅' : '❌';
  console.log(`  ${mark} ${suite.padEnd(26)} ${results[results.length - 1].summary}`);
}

// ── Coverage report ───────────────────────────────────────────
const inventory = routeInventory();
const covered = new Set();
for (const r of results) for (const c of r.coverage) covered.add(c);

// The log records METHOD + normalized path ("/resource" or "/resource/sub").
// Normalize the inventory the same way: match any method.
const coveredPaths = new Set([...covered].map(c => c.replace(/^[A-Z]+ /, '')));
const uncovered = inventory.filter(route => {
  if (coveredPaths.has(route)) return false;
  // "/resource/sub" coverage also covers the bare "/resource"
  const base = '/' + route.split('/')[1];
  return !coveredPaths.has(base);
});

console.log('\n── ROUTE COVERAGE (enforced: every served route must be tested) ──');
console.log(`   routes served: ${inventory.length} · routes exercised: ${inventory.length - uncovered.length}`);
if (uncovered.length) {
  console.log('   ❌ NEVER TESTED:');
  for (const u of uncovered) console.log(`      - ${u}`);
} else {
  console.log('   ✅ every route in the worker is exercised by at least one suite');
}

// ── Verdict ───────────────────────────────────────────────────
const failedSuites = results.filter(r => !r.pass);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log('\n──────────────────────────────────────────────');
if (failedSuites.length === 0 && uncovered.length === 0) {
  console.log(`✅ FULL BATTERY GREEN — ${SUITES.length} suites in ${secs}s, 100% route coverage`);
  process.exit(0);
} else {
  if (failedSuites.length) console.log(`❌ failing suites: ${failedSuites.map(f => f.suite).join(', ')}`);
  if (uncovered.length) console.log(`❌ ${uncovered.length} route(s) have zero test coverage`);
  process.exit(1);
}
