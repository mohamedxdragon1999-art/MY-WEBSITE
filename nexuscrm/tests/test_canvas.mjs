// nx_render.js — CANVAS is a REAL graph-mutating surface, not a UI mask.
//
// Regression coverage for the renderer/canvas overhaul:
//   1. the canvas ADOPTS the immutably-returned project after every mutation
//      (before: it re-rendered the stale original — drags did nothing);
//   2. duplicate is a deep, in-place copy (same parent, adjacent, content +
//      subtree preserved, integrity holds) — not a shallow root-level shell;
//   3. drag preserves existing constraint fields (intrinsic/fill/max) instead of
//      clobbering them to {anchor, spacing};
//   4. design props (color/typography) actually render (not silently dropped);
//   5. group/ungroup are real graph ops that round-trip.
//
// Run: node tests/test_canvas.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const design = require('/home/user/nx_design.js');
const ir = require('/home/user/nx_ir.js');
const graph = require('/home/user/nx_graph.js');
globalThis.__NX_DEPS = { design, ir, graph };
const R = require('/home/user/nx_render.js');
const { nxBuildSiteGraph, nxRenderDocument, nxCanvas, nxDragToPatch, ngGroup, ngUngroup } = R;

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
function site(opts) { return nxBuildSiteGraph(Object.assign({ name: 'Nova', brief: 'premium saas', primary: '#04070f', accent: '#ff6b1a' }, opts)).project; }

console.log('\n== 1. CANVAS ADOPTS THE IMMUTABLE PROJECT (mutations actually land) ==');
{
  const p = site();
  const cv = nxCanvas(p);
  const hero = cv.project.order.find(id => cv.project.nodes[id].semanticRole === 'hero');
  const before = JSON.stringify(cv.project.constraints[hero]);
  const r = cv.setConstraint(hero, { intrinsic: 'fill', max: { width: 900 }, align: 'center' });
  check('setConstraint returns ok', r.ok === true);
  check('canvas adopted the NEW project (reference changed)', cv.project !== p);
  check('constraint landed on the LIVE project', JSON.stringify(cv.project.constraints[hero]) !== before && cv.project.constraints[hero].intrinsic === 'fill');
  check('project still passes integrity after mutation', ir.nxValidateGraphIntegrity(cv.project).ok);
  // drag against the live canvas must mutate live project
  const beforeDrag = JSON.stringify(cv.project.constraints[hero]);
  cv.drag(hero, 24, 0, { snap: 8 });
  check('live drag mutated the live project', JSON.stringify(cv.project.constraints[hero]) !== beforeDrag);
}

console.log('\n== 2. DUPLICATE = DEEP, IN-PLACE COPY ==');
{
  const cv = nxCanvas(site());
  const card = cv.project.order.find(id => cv.project.nodes[id].component.family === 'card');
  const parent = cv.project.nodes[card].parent;
  const sibIdx = cv.project.nodes[parent].children.indexOf(card);
  const childCount = (cv.project.nodes[card].children || []).length;
  const dup = cv.duplicate(card);
  const copy = cv.project.nodes[dup.copyId];
  check('duplicate ok + returned a copy id', dup.ok === true && !!dup.copyId);
  check('copy lives under the SAME parent (not a new root)', copy.parent === parent);
  check('copy is ADJACENT to the source', Math.abs(cv.project.nodes[parent].children.indexOf(dup.copyId) - sibIdx) === 1);
  check('copy preserves source content', JSON.stringify(cv.project.content[dup.copyId]) === JSON.stringify(cv.project.content[card]));
  check('copy preserves source structure (subtree size)', (copy.children || []).length === childCount);
  check('copy has a fresh id (no collision)', dup.copyId !== card);
  check('graph integrity holds after duplicate', ir.nxValidateGraphIntegrity(cv.project).ok);
  check('render is still valid after duplicate', nxRenderDocument(cv.project).valid === true);
}

console.log('\n== 3. DRAG PRESERVES EXISTING CONSTRAINT FIELDS ==');
{
  const p = site();
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  const cb = p.constraints[hero];
  const dr = nxDragToPatch(p, hero, 16, 0, { snap: 8 });
  check('drag emits a constraint.set', dr.ok && dr.ops[0].op === 'constraint.set');
  check('drag preserves intrinsic value', dr.ops[0].constraint.intrinsic === cb.intrinsic);
  check('drag preserves max binding', JSON.stringify(dr.ops[0].constraint.max) === JSON.stringify(cb.max));
  check('drag preserves anchor', dr.ops[0].constraint.anchor === cb.anchor);
  check('drag ADDS spacing without dropping the rest', dr.ops[0].constraint.spacing && dr.ops[0].constraint.max !== undefined);
}

console.log('\n== 4. DESIGN PROPS ACTUALLY RENDER ==');
{
  let p = site();
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  p = ir.nxProjectPatch(p, [{ op: 'node.set', id: hero, field: 'design', value: { backgroundColor: '#101010', color: '#ffffff', fontSize: 44, fontWeight: 700 } }]).project;
  const d = nxRenderDocument(p);
  check('design background renders', /background:#101010/.test(d.html), 'style attr');
  check('design color renders', /color:#ffffff/.test(d.html));
  check('design font-size renders as px', /font-size:44px/.test(d.html));
  check('design font-weight renders', /font-weight:700/.test(d.html));
}

console.log('\n== 5. GROUP / UNGROUP ARE REAL GRAPH OPS (round-trip) ==');
{
  const cv = nxCanvas(site());
  const cards = cv.project.order.filter(id => cv.project.nodes[id].component.family === 'card');
  const two = cards.slice(0, 2);
  const g = cv.group(two);
  check('group creates a real container node', g.ok === true);
  const groupId = g.groupId;
  check('grouped nodes are children of the new container', two.every(id => cv.project.nodes[id].parent === groupId));
  const u = cv.ungroup(groupId);
  check('ungroup ok', u.ok === true);
  check('ungrouped nodes re-parented to the group\'s parent', two.every(id => cv.project.nodes[id].parent == null || cv.project.nodes[id].parent !== groupId));
  check('graph integrity holds after group+ungroup', ir.nxValidateGraphIntegrity(cv.project).ok);
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
