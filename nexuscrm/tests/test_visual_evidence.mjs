// VISUAL EVIDENCE ENGINE (Gap 3) — real computed-geometry + accessibility +
// contrast evidence, not just a heuristic score.
//
//   IR Graph → computed geometry (columns/gap/direction/width) → per-node a11y
//             → per-node contrast → document evidence → structured problems
//
// Each problem carries the required fields:
//   Problem / Evidence / Expected effect / Proposed operation / Confidence /
//   Potential regression
//
// Run: node tests/test_visual_evidence.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const design = require('/home/user/nx_design.js');
const ir = require('/home/user/nx_ir.js');
const graph = require('/home/user/nx_graph.js');
globalThis.__NX_DEPS = { design, ir, graph };
const R = require('/home/user/nx_render.js');
const { nxBuildSiteGraph, nxRenderDocument } = R;
const { nxVisualEvidence } = graph;

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const cx = (x) => J(x); function J(x){ return JSON.parse(JSON.stringify(x)); }

console.log('\n== 1. EVIDENCE IS COMPUTED GEOMETRY + A11Y, NOT AN EMPTY SCORE ==');
{
  const b = nxBuildSiteGraph({ name: 'Nova', brief: 'saas', primary: '#04070f', accent: '#ff6b1a' });
  const ve = nxVisualEvidence(b.project);
  const e = ve.evidence;
  check('evidence exposes computed contrast (from real fg/bg tokens)', typeof e.contrast === 'number' && e.contrast >= 4.5, 'contrast=' + e.contrast);
  check('evidence exposes heading hierarchy levels', Array.isArray(e.hierarchy.levels) && e.hierarchy.levels.length > 0);
  check('evidence exposes accessibility counts (alt / missing-name)', e.accessibility && typeof e.accessibility.imagesNoAlt === 'number');
  check('evidence exposes per-node geometry', Object.keys(e.nodes).length === b.project.order.length);
  const heroId = b.project.order.find(id => b.project.nodes[id].semanticRole === 'hero');
  const heroGeom = e.nodes[heroId];
  check('per-node geometry computed (display + columns + gap)', heroGeom && heroGeom.display && typeof heroGeom.columns === 'number');
  check('every problem has the required 6 evidence fields', ve.problems.every(p => p.problem && p.evidence && p.expectedEffect && p.op && typeof p.confidence === 'number' && p.regressionRisk));
}

console.log('\n== 2. PROBLEMS ARE EVIDENCE-DRIVEN AND TARGET REAL DEFECTS ==');
{
  // A deliberately weak project (no contrast, no responsive, no hierarchy) must
  // produce concrete evidence-backed problems, not silence.
  const weak = nxBuildSiteGraph({ name: 'Weak', brief: 'saas' });
  let p = weak.project;
  p = ir.nxProjectPatch(p, [{ op: 'token.update', key: 'neutralFg', value: '#ffffff' }, { op: 'token.update', key: 'neutralBg', value: '#ffffff' }]).project;
  const ve = nxVisualEvidence(p);
  check('low-contrast project flags a contrast problem', ve.problems.some(pb => /contrast/i.test(pb.problem)));
  const cpb = ve.problems.find(pb => /contrast/i.test(pb.problem));
  if (cpb) {
    check('contrast problem carries measured evidence', /[0-9.]+:1/.test(cpb.evidence), cpb.evidence);
    check('contrast problem proposes an operation', cpb.op && cpb.op.op === 'token.update');
  }
  // TRUE NEGATIVES (Gap-3 fixes): hand-crafted minimal graphs expose the remaining
  // gaps, so the evidence engine must flag responsive + reduced-motion + contrast.
  let bare = ir.nxNewProject({ name: 'Bare', brief: 'x' });
  bare = ir.nxProjectPatch(bare, [
    { op: 'node.create', node: { id: 'sec', component: { family: 'hero' }, semanticRole: 'hero', content: { headline: 'X' } } },
    { op: 'motion.update', id: 'sec', profile: { recipe: 'cinematic', primitives: ['background-parallax'], reduced: 'none' } },
    { op: 'constraint.set', id: 'sec', constraint: { intrinsic: 'fill' } },
  ]).project;
  const veBare = nxVisualEvidence(bare);
  check('graph with NO responsive rules is flagged', veBare.problems.some(pb => /responsive/i.test(pb.problem)), JSON.stringify(veBare.problems.map(p => p.problem)));
  check('motion with reduced= none is flagged as not declaring reduced-motion', veBare.problems.some(pb => /reduced-motion/i.test(pb.problem)));

  // FIXED behavior: the default builder now AUTHORS responsive rules + declares
  // reduced-motion, so those are no longer flagged (they are satisfied).
  const built = nxBuildSiteGraph({ name: 'S', brief: 'x' }).project;
  const veBuilt = nxVisualEvidence(built);
  check('default build AUTHORS responsive rules into the graph', veBuilt.evidence.responsive.nodesWithRules > 0, veBuilt.evidence.responsive.nodesWithRules + '/' + veBuilt.evidence.responsive.total);
  check('default build declares reduced-motion preference', built.tokens.reducedMotion === 'fade');
}

console.log('\n== 3. EVIDENCE SEES ACCESSIBILITY DEFECTS ON A CRAFTED GRAPH ==');
{
  // Build a small graph with an image missing alt + a button with no label.
  let p = ir.nxNewProject({ name: 'A', brief: 'x' });
  p = ir.nxProjectPatch(p, [{ op: 'node.create', node: { id: 'img1', component: { family: 'image' }, semanticRole: 'none', content: { src: 'x.png' } } }]).project;
  p = ir.nxProjectPatch(p, [{ op: 'node.create', node: { id: 'btn1', component: { family: 'button' }, semanticRole: 'none', content: { label: '' } } }]).project;
  const ve = nxVisualEvidence(p);
  check('image without alt is flagged', ve.problems.some(pb => /missing alt/.test(pb.problem)));
  check('interactive element without accessible name is flagged', ve.problems.some(pb => /accessible name/.test(pb.problem)));
  check('accessibility counts reflect crafted defects', ve.evidence.accessibility.imagesNoAlt >= 1 && ve.evidence.accessibility.interactiveMissingName >= 1);
  check('document still renders valid (evidence did not corrupt it)', nxRenderDocument(p).valid === true);
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
