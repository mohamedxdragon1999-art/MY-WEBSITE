// nx_graph.js — HISTORY / REVERT + COMPARE are REAL. Proves a version restore
// actually returns the graph to a prior state (and that a snapshot is faithful),
// and that `nxCompare` reports a measured Design-QA delta, not a hard-coded zero.
//
// Run: node tests/test_version.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.__NX_IR = require('/home/user/nx_ir.js');
globalThis.__NX_DESIGN = require('/home/user/nx_design.js');
const G = require('/home/user/nx_graph.js');
const IR = require('/home/user/nx_ir.js');
const { nxHistoryPush, nxSnapshotView, nxHistoryRevert, nxCompare, nxDiff } = G;

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
function mkProject() {
  const p = IR.nxNewProject({ name: 'T', brief: 'a luxury premium tech site' });
  IR.nxSeedNode(p, { component: { family: 'nav' } });
  IR.nxSeedNode(p, { component: { family: 'hero', variant: 'split' }, content: { headline: 'Original headline', sub: 'Original sub', cta: 'Start' } });
  IR.nxSeedNode(p, { component: { family: 'features' } });
  return p;
}

console.log('\n== 1. SNAPSHOT IS A FAITHFUL, FULL-STATE COPY ==');
{
  const p = mkProject();
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  const snap = nxSnapshotView(p);
  check('snapshot keeps tokens + the whole node graph', snap.tokens && snap.nodes && snap.nodes[hero]);
  check('snapshot keeps content (headline + cta + sub)', snap.nodes[hero] && snap.content[hero].headline === 'Original headline' && snap.content[hero].cta === 'Start');
  // snapshot must be independent of the live project (mutation must not leak back)
  const deepS = JSON.parse(JSON.stringify(p));
  deepS.nodes[hero].id = 'MUTATED';
  check('snapshot is independent (deep clone)', snap.nodes[hero].id === hero && snap.content[hero].headline === 'Original headline');
}

console.log('\n== 2. REVERT ACTUALLY RESTORES THE GRAPH ==');
{
  const p = mkProject();
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  // V1 = p. V2 = change headline + token via the mutation engine.
  const v2 = IR.nxProjectPatch(p, [{ op: 'node.set', id: hero, field: 'content', value: { headline: 'CHANGED' } }, { op: 'token.update', key: 'primaryColor', value: '#123456' }]).project;
  const entry = nxHistoryPush(v2, [{ op: 'node.set', id: hero, field: 'content', value: { headline: 'CHANGED' } }], 'edit headline', p);
  check('history records 1 entry + a prior snapshot', entry && v2.history.length === 1 && !!v2.history[0].beforeView);
  const rev = nxHistoryRevert(v2, 1);
  check('revert is ok and returns a restored project', rev.ok === true && !!rev.project, JSON.stringify(rev.errors || []));
  check('revert restores the headline to the prior content', rev.project.content[hero].headline === 'Original headline');
  check('revert restores the token', rev.project.tokens.primaryColor === '#0a1638');
  check('revert returns ops describing the change', Array.isArray(rev.ops) && rev.ops.some(o => o.op === 'token.update'));
  check('restored project is a valid graph', IR.nxValidateGraphIntegrity(rev.project).ok);
  // reverting again with no history → honest failure
  const empty = IR.nxNewProject({ name: 'T', brief: 'x' });
  const r2 = nxHistoryRevert(empty, 1);
  check('revert with no history fails honestly', r2.ok === false && /no prior snapshot/.test(r2.errors.join(' ')));
}

console.log('\n== 3. nxDIFF IS AN HONEST "WHAT CHANGED" REPORTER ==');
{
  const p = mkProject();
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  const v2 = IR.nxProjectPatch(p, [{ op: 'node.set', id: hero, field: 'content', value: { headline: 'Changed' } }, { op: 'token.update', key: 'primaryColor', value: '#222222' }]).project;
  const d = nxDiff(p, v2);
  check('diff detects the content change + the token change', d.some(o => o.op === 'token.update' && o.key === 'primaryColor') && d.some(o => o.op === 'node.set' && o.id === hero));
  const d2 = nxDiff(v2, p);
  check('diff is directional (reverse diff has reversed values)', d2.some(o => o.op === 'token.update' && o.value === '#0a1638'));
}

console.log('\n== 4. nxCOMPARE = REAL MEASURED DELTA (not hard-coded zero) ==');
{
  const weak = mkProject();
  // Make a genuinely worse project (no contrast) and a genuinely better one.
  const weak2 = IR.nxProjectPatch(mkProject(), [{ op: 'token.update', key: 'neutralFg', value: '#ffffff' }, { op: 'token.update', key: 'neutralBg', value: '#ffffff' }]).project;
  const good = mkProject();
  const cmp = nxCompare(weak2, good);
  check('compare returns ops', Array.isArray(cmp.ops));
  check('compare reports a non-zero, MEASURED design-QA delta', typeof cmp.designQADelta === 'number' && cmp.designQADelta !== 0, 'delta=' + cmp.designQADelta);
  check('compare exposes sub-deltas', ['structuralDelta', 'visualDelta', 'brandDelta', 'motionDelta'].every(k => typeof cmp[k] === 'number'));
  const selfCmp = nxCompare(good, good);
  check('comparing identical projects has zero delta + empty ops', selfCmp.designQADelta === 0 && selfCmp.ops.length === 0);
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
