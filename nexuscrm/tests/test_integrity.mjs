// nx_ir.js — GRAPH INTEGRITY + TRUE ATOMIC MUTATION. Proves the "atomic" and
// "graph integrity" claims with behavioral tests, not by asserting on function
// existence.
//
// Run: node tests/test_integrity.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.__NX_DESIGN = require('../nx_design.js');
const IR = require('../nx_ir.js');
const {
  nxNewProject, nxSeedNode, nxProjectPatch, nxNodeMove, nxNodeDelete, nxNodeCreate,
  nxValidateGraphIntegrity, nxValidateGraphState, nxValidateProject,
} = IR;

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
function mkProject() {
  const p = nxNewProject({ name: 'T', brief: 'a luxury premium tech site' });
  nxSeedNode(p, { component: { family: 'nav' } });
  nxSeedNode(p, { component: { family: 'hero', variant: 'split' }, content: { headline: 'Ship faster', sub: 'typed', cta: 'Go' } });
  nxSeedNode(p, { component: { family: 'features' }, content: { heading: 'What we do' } });
  nxSeedNode(p, { component: { family: 'cta' }, content: { heading: 'Ready?' } });
  return p;
}
const snapshotSlice = (p) => JSON.stringify({ nodes: p.nodes, design: p.design, content: p.content, motion: p.motion, responsive: p.responsive, interaction: p.interaction, assets: p.assets, states: p.states || {}, constraints: p.constraints || {}, assetGraph: p.assetGraph || {}, history: p.history || [], tokens: p.tokens, order: p.order });

console.log('\n== A. ATOMIC MUTATION — a failed transaction mutates NOTHING ==');
{
  const p = mkProject();
  const before = snapshotSlice(p);
  const beforePrimary = p.tokens.primaryColor; // capture the REAL pre-patch value
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  // a valid op followed by an INVALID op (bad token prop location)
  const r = nxProjectPatch(p, [
    { op: 'node.set', id: hero, field: 'content', value: { headline: 'CHANGED' } },
    { op: 'token.update', key: 'primaryColor', value: '#123456' },
    { op: 'node.set', id: 'does-not-exist', field: 'content', value: { x: 1 } }, // invalid
  ]);
  check('failed transaction reports ok:false', r.ok === false);
  check('failed transaction returns the ORIGINAL project reference', r.project === p);
  check('original project deeply unchanged', snapshotSlice(p) === before);
  // the ops that DID apply before the failure must not have leaked
  check('content headline unchanged in original', p.content[hero].headline === 'Ship faster');
  check('token primaryColor unchanged in original', p.tokens.primaryColor === beforePrimary, 'expected ' + beforePrimary + ', got ' + p.tokens.primaryColor);
  // the candidate returned is the original (isolated), not a half-applied copy
  check('candidate not partially mutated', r.project.nodes[hero].content === undefined);
}
console.log('\n== B. ATOMIC MUTATION — success applies fully & leaves original intact ==');
{
  const p = mkProject();
  const before = snapshotSlice(p);
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  const r = nxProjectPatch(p, [
    { op: 'node.set', id: hero, field: 'content', value: { headline: 'NEW' } },
    { op: 'token.update', key: 'primaryColor', value: '#222222' },
  ]);
  check('success returns ok:true + new project', r.ok && r.project !== p);
  check('original unchanged after success', snapshotSlice(p) === before);
  check('candidate mutated (content + token)', r.project.content[hero].headline === 'NEW' && r.project.tokens.primaryColor === '#222222');
  // nested object isolation: mutating the candidate must not touch the original
  r.project.content[hero].headline = 'MUTATED AFTER';
  check('candidate nested object is NOT the original reference', p.content[hero].headline !== 'MUTATED AFTER' && r.project.content[hero].headline === 'MUTATED AFTER');
}

console.log('\n== C. GRAPH INTEGRITY — structural soundness gate ==');
{
  // exact one root in tree mode, cycles, dangling, symmetry, reachability
  const p = nxNewProject({ name: 'T', brief: 'x', model: 'tree' });
  // build root -> a -> b nested children
  const rootOp = nxNodeCreate(p, { component: { family: 'section' }, semanticRole: 'section', id: 'root' });
  check('tree root created', rootOp.ok);
  const a = nxNodeCreate(rootOp.project, { component: { family: 'section' }, semanticRole: 'section', id: 'a' });
  check('child a created (no parent yet)', a.ok);
  const mv1 = nxNodeMove(a.project, 'a', 'root', 0);
  check('move a under root correct parent/child symmetry', mv1.ok && mv1.project.nodes['a'].parent === 'root' && mv1.project.nodes['root'].children.includes('a'));
  const b = nxNodeCreate(mv1.project, { component: { family: 'section' }, semanticRole: 'section', id: 'b' });
  const mv2 = nxNodeMove(b.project, 'b', 'a', 0);
  check('grandchild b under a', mv2.ok && mv2.project.nodes['b'].parent === 'a');
  const iv = nxValidateGraphIntegrity(mv2.project, { requireSingleRoot: true });
  check('a valid tree passes integrity', iv.ok, JSON.stringify(iv.errors));
  check('tree reports exactly one root', mv2.project.order.filter(id => mv2.project.nodes[id].parent == null).length === 1);
  // cycle rejection: move root under its own descendant b
  const cyc = nxNodeMove(mv2.project, 'root', 'b', 0);
  check('cannot move a node below its own descendant (cycle rejected)', cyc.ok === false);
  // break symmetry then see integration fail
  const bad = nxProjectPatch(mv2.project, []);
  const tampered = JSON.parse(JSON.stringify(bad.project));
  tampered.nodes['a'].parent = 'b'; // asymmetric + would orphan a unless b still has it
  const t = nxValidateGraphIntegrity(tampered, { requireSingleRoot: true });
  check('asymmetric parent/child is rejected', t.ok === false);
  const tampered2 = JSON.parse(JSON.stringify(bad.project));
  delete tampered2.nodes['b'];
  tampered2.nodes['a'].children = tampered2.nodes['a'].children.filter(x => x !== 'b');
  const t2 = nxValidateGraphIntegrity(tampered2);
  check('dangling child / orphan is rejected', t2.ok === false);
}

console.log('\n== D. node.delete cleans cross-graph references ==');
{
  const p = mkProject();
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  // add an interaction on cta that targets the hero, plus a state/constraint/asset on hero
  nxProjectPatch(p, [{ op: 'interaction.add', id: p.order.find(i => p.nodes[i].semanticRole === 'cta'), interaction: { trigger: 'hover', target: hero, actions: [{ type: 'scale' }] } }]);
  const s = nxProjectPatch(p, [
    { op: 'state.set', id: hero, state: 'hover', overrides: { transform: 'scale(1.05)' } },
    { op: 'constraint.set', id: hero, constraint: { anchor: 'center' } },
    { op: 'asset.set', id: hero, asset: { kind: 'image', src: 'h.jpg' } },
  ]);
  const withRefs = s.project;
  const before = snapshotSlice(withRefs);
  const del = nxNodeDelete(withRefs, hero);
  check('delete succeeds', del.ok, JSON.stringify(del.errors));
  check('hero removed from every concerngraph', !del.project.nodes[hero] && !del.project.design[hero] && !del.project.content[hero] && !del.project.motion[hero] && !del.project.states[hero] && !del.project.constraints[hero] && !del.project.assetGraph[hero]);
  check('parent (nav/etc) no longer lists hero', Object.values(del.project.nodes).every(n => !(n.children || []).includes(hero)));
  check('interaction in another node no longer targets deleted hero', del.project.interaction[p.order.find(i => p.nodes[i].semanticRole === 'cta')].every(it => it.target !== hero));
  check('deleted project passes integrity', nxValidateGraphIntegrity(del.project).ok);
  // node.delete on a graph with a legit hero removed → integrity ok (hero check is at render time)
  check('node.delete is not blocked by missing hero during building', del.ok);
}

console.log('\n== E. PER-CONCERN SCHEMAS ==');
{
  const p = mkProject();
  check('a healthy project passes graph-state schema', nxValidateGraphState(p).ok, JSON.stringify(nxValidateGraphState(p).errors));
  const bad = JSON.parse(JSON.stringify(p));
  bad.design[Object.keys(bad.design)[0]].colors = { primary: '#000', NOTALLOWED: 'x' };
  const r = nxValidateGraphState(bad);
  check('design schema rejects unknown color key', r.ok === false && /NOTALLOWED/.test(r.errors.join(' ')));
  const bad2 = JSON.parse(JSON.stringify(p));
  bad2.motion[Object.keys(bad2.motion)[0]].primitives = 'not-an-array';
  check('motion schema rejects non-array primitives', nxValidateGraphState(bad2).ok === false);
  const bad3 = JSON.parse(JSON.stringify(p));
  bad3.responsive[Object.keys(bad3.responsive)[0]] = { on: 'mobile' }; // object, not array
  check('responsive schema rejects non-array', nxValidateGraphState(bad3).ok === false);
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
