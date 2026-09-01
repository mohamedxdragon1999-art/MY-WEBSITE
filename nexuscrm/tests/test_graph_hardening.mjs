// GRAPH / IR / EDITOR HARDENING — adversarial.
//
// Every AI edit and every user canvas action flows through the mutation engine,
// the integrity validator and the render entry points. These tests attack that
// path with hostile ids, malformed ops and corrupted graphs. The rules:
//   * a mutation is atomic and pure,
//   * an op that cannot apply must REPORT failure (never silently no-op as ok),
//   * the integrity validator REPORTS corruption instead of throwing,
//   * a corrupt graph yields an invalid render result, not an exception.
//
// Run: node tests/test_graph_hardening.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.__NX_DESIGN = require('../nx_design.js');
globalThis.__NX_IR = require('../nx_ir.js');
const IR = require('../nx_ir.js');
const R = require('../nx_render.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
function mk() {
  const p = IR.nxNewProject({ name: 'T', brief: 'a luxury tech site' });
  IR.nxSeedNode(p, { component: { family: 'nav' } });
  IR.nxSeedNode(p, { component: { family: 'hero', variant: 'split' }, content: { headline: 'H', sub: 'S', cta: 'Go' } });
  IR.nxSeedNode(p, { component: { family: 'features' } });
  return p;
}
// Inherited Object.prototype keys look like real ids to a truthiness check.
const POISON = ['__proto__', 'constructor', 'prototype', 'toString'];

console.log('\n== A. Mutations are pure and atomic ==');
{
  const impure = [], nonAtomic = [];
  const p0 = mk(); const hero0 = p0.order.find(i => p0.nodes[i].semanticRole === 'hero');
  for (const ops of [[{ op: 'token.update', key: 'primaryColor', value: '#111111' }],
                     [{ op: 'node.set', id: hero0, field: 'content', value: { headline: 'X' } }],
                     [{ op: 'node.delete', id: hero0 }]]) {
    const p = mk(); const hero = p.order.find(i => p.nodes[i].semanticRole === 'hero');
    const real = ops.map(o => (o.id ? { ...o, id: hero } : o));
    const before = JSON.stringify(p);
    const r = IR.nxProjectPatch(p, real);
    if (JSON.stringify(p) !== before) impure.push(real[0].op);
    if (r.ok && r.project === p) impure.push(real[0].op + ' (same ref)');
  }
  check('no op mutates the caller\'s project', impure.length === 0, impure.join(','));

  const p = mk(); const hero = p.order.find(i => p.nodes[i].semanticRole === 'hero');
  const before = JSON.stringify(p);
  const r = IR.nxProjectPatch(p, [
    { op: 'token.update', key: 'primaryColor', value: '#abcdef' },
    { op: 'node.set', id: hero, field: 'content', value: { headline: 'CHANGED' } },
    { op: 'node.set', id: 'ghost-id', field: 'content', value: { x: 1 } },
  ]);
  if (r.ok) nonAtomic.push('reported ok');
  if (JSON.stringify(p) !== before) nonAtomic.push('left project mutated');
  check('a transaction with one bad op commits nothing', nonAtomic.length === 0, nonAtomic.join(','));
}

console.log('\n== B. Malformed ops are rejected, never silently "successful" ==');
{
  const accepted = [], crashed = [];
  const BAD = [null, undefined, {}, { op: 'nope' }, { op: 'token.update' }, { op: 'node.set', id: 'x' },
    { op: 'node.create' }, { op: 'node.delete', id: 'nonexistent' }, { op: 'node.move', id: 'nonexistent', to: 99 },
    'string-op', 42, []];
  for (const b of BAD) {
    const p = mk();
    try { const r = IR.nxProjectPatch(p, [b]); if (r && r.ok === true) accepted.push(JSON.stringify(b)); }
    catch (e) { crashed.push(JSON.stringify(b) + ': ' + e.message); }
  }
  check('no malformed op is reported as applied', accepted.length === 0, accepted.join(' | '));
  check('no malformed op crashes the mutation engine', crashed.length === 0, crashed.slice(0, 2).join(' | '));
}

console.log('\n== C. Prototype keys cannot impersonate a node or token ==');
{
  // These used to pass `!p.nodes[id]` / land in tokens, so the engine claimed
  // success while writing nothing — an AI patch that silently does nothing.
  const ghostOk = [], tokenOk = [];
  for (const k of POISON) {
    const p = mk();
    const r1 = IR.nxProjectPatch(p, [{ op: 'node.set', id: k, field: 'content', value: { a: 1 } }]);
    if (r1.ok) ghostOk.push('node.set ' + k);
    const r2 = IR.nxProjectPatch(p, [{ op: 'token.update', key: k, value: 'x' }]);
    if (r2.ok) tokenOk.push('token.update ' + k);
  }
  check('node ops on prototype keys are rejected', ghostOk.length === 0, ghostOk.join(','));
  check('token ops on reserved keys are rejected', tokenOk.length === 0, tokenOk.join(','));
  check('global Object.prototype is never polluted', ({}).polluted === undefined && ({}).PWN === undefined);
}

console.log('\n== D. The integrity validator reports corruption instead of throwing ==');
{
  const CORRUPT = [
    ['order references a missing node', (p) => { p.order.push('ghost'); }],
    ['node missing from order', (p) => { p.nodes['orphan'] = { id: 'orphan', component: { family: 'hero' } }; }],
    ['a node is null', (p) => { p.nodes[p.order[0]] = null; }],
    ['order is not an array', (p) => { p.order = 'nope'; }],
    ['duplicate id in order', (p) => { p.order.push(p.order[0]); }],
    ['children is not an array', (p) => { p.nodes[p.order[0]].children = 'x'; }],
  ];
  const threw = [], missed = [];
  for (const [label, corrupt] of CORRUPT) {
    const p = mk(); corrupt(p);
    let v; try { v = IR.nxValidateGraphIntegrity(p); } catch (e) { threw.push(label); continue; }
    if (v.ok) missed.push(label);
  }
  check('validator never throws on a corrupted graph', threw.length === 0, threw.join(' | '));
  check('validator detects every corruption', missed.length === 0, missed.join(' | '));
}

console.log('\n== E. Render + editor entry points survive a broken graph ==');
{
  const threw = [], wrongly = [];
  for (const junk of [null, undefined, {}, [], '', 0, { nodes: null }, { order: 'x' }, { nodes: { a: null }, order: ['a'] }]) {
    let r; try { r = R.nxRenderDocument(junk); } catch (e) { threw.push(String(e.message).slice(0, 40)); continue; }
    if (r && r.valid === true) wrongly.push(JSON.stringify(junk));
  }
  check('nxRenderDocument returns invalid instead of throwing', threw.length === 0, threw.slice(0, 2).join(' | '));
  check('a broken graph is never reported as a valid render', wrongly.length === 0, wrongly.join(','));

  const crashes = [], corrupted = [];
  const ACTS = ['select', 'drag', 'resize', 'delete', 'duplicate', 'group', 'ungroup', 'reparent', 'nope', null, '', 123];
  const PAYS = [null, undefined, {}, { id: 'ghost' }, { id: '__proto__' }, { id: null }, { dx: NaN, dy: Infinity }, { to: -5 }, []];
  for (const a of ACTS) for (const pay of PAYS) {
    const p = mk();
    try { R.nxCanvasApply(p, a, pay); } catch (e) { crashes.push(`${a}/${e.message.slice(0, 30)}`); }
  }
  check('no canvas action + payload combination crashes', crashes.length === 0, crashes.slice(0, 2).join(' | '));

  for (const ids of [[], ['ghost'], ['__proto__'], null, 'x', [null], [1, 2]]) {
    const p = mk();
    try {
      const r = R.ngGroup(p, ids);
      const v = IR.nxValidateGraphIntegrity((r && r.project) || p);
      if (!v.ok) corrupted.push(JSON.stringify(ids));
    } catch (e) { crashes.push('ngGroup ' + e.message.slice(0, 30)); }
  }
  check('ngGroup never crashes and never corrupts the graph', crashes.length === 0 && corrupted.length === 0, [...crashes, ...corrupted].slice(0, 2).join(' | '));

  const nanGeom = [];
  for (const [dx, dy] of [[NaN, 0], [Infinity, 0], [-1e9, 1e9], ['a', 'b'], [null, null]]) {
    const p = mk(); const hero = p.order.find(i => p.nodes[i].semanticRole === 'hero');
    try { if (/NaN|Infinity/.test(JSON.stringify(R.nxDragToPatch(p, hero, dx, dy, {}) || {}))) nanGeom.push(`${dx},${dy}`); }
    catch (e) { nanGeom.push(`throw ${dx},${dy}`); }
  }
  check('drag never emits NaN/Infinity geometry', nanGeom.length === 0, nanGeom.join(' | '));
}

const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
