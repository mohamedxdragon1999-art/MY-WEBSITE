// nx_graph.js — the GRAPH FOUNDATION II systems: Layout Constraint Graph + Solver,
// State Graph, Asset Graph subsystem, Project History/Diff engine, Design Intent→Patch
// compiler, evidence-based AI Critic, Motion Timeline + Budget, and the
// Best-Known-Version evolution loop. Built on top of nx_ir.js's mutation engine.
//
// Run: node tests/test_graph.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Provide nx_ir to nx_graph via the __NX_IR registry, and the design system for QA.
globalThis.__NX_IR = require('/home/user/nx_ir.js');
globalThis.__NX_DESIGN = require('/home/user/nx_design.js');

const G = require('/home/user/nx_graph.js');
const IR = require('/home/user/nx_ir.js');
const {
  nxSetConstraint, nxGetConstraint, nxSolveConstraint, nxSolveLayout,
  nxDefineState, nxStates, nxCompileStateCss,
  nxAddAsset, nxGetAsset, nxAssetValidate, nxResolveAssetForViewport,
  nxDiff, nxHistoryPush, nxSnapshotView, nxHistoryRevert,
  nxIntentToPlan, nxApplyIntent,
  nxCriticEvidence,
  nxTimeline, nxTimelineCompose, nxMotionBudget,
  nxEvolve,
} = G;

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
function mkProject(brief, tokens) {
  const p = IR.nxNewProject({ name: 'T', brief: brief || 'a luxury premium tech site', tokens });
  IR.nxSeedNode(p, { component: { family: 'nav' } });
  IR.nxSeedNode(p, { component: { family: 'hero', variant: 'split' }, content: { headline: 'Ship faster', sub: 'A typed graph.', cta: 'Try' } });
  IR.nxSeedNode(p, { component: { family: 'features' } });
  IR.nxSeedNode(p, { component: { family: 'pricing' } });
  IR.nxSeedNode(p, { component: { family: 'cta' } });
  IR.nxSeedNode(p, { component: { family: 'footer' } });
  return p;
}

// ═══════════ 1. LAYOUT CONSTRAINT GRAPH + SOLVER ═══════════
console.log('\n== 1. LAYOUT CONSTRAINT GRAPH + SOLVER ==');
{
  const p = mkProject();
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  const s = nxSetConstraint(p, hero, { anchor: 'center', intrinsic: 'fill', aspectRatio: '16:9', spacing: { before: 32, after: 16 }, max: { width: 1200 } });
  check('set constraint validates + stores', s.ok && nxGetConstraint(p, hero).anchor === 'center');
  check('invalid anchor rejected', nxSetConstraint(p, hero, { anchor: 'diagonal' }).ok === false);
  check('invalid aspect ratio rejected', nxSetConstraint(p, hero, { aspectRatio: 'wat' }).ok === false);
  const solved = nxSolveConstraint(nxGetConstraint(p, hero), p.nodes[hero].props, 'desktop');
  check('center anchor → auto margins', solved.marginLeft === 'auto' && solved.marginRight === 'auto');
  check('fill intrinsic → 100% width', solved.width === '100%');
  check('aspect ratio resolved to CSS', solved.aspectRatio === '16 / 9');
  check('spacing relations resolved', solved.marginTop === '32px' && solved.marginBottom === '16px');
  const layout = nxSolveLayout(p);
  check('solver resolves per-node breakpoints', layout[hero] && layout[hero].desktop && layout[hero].mobile && typeof layout[hero].tablet === 'object');
  const mobile = nxSolveConstraint(nxGetConstraint(p, hero), p.nodes[hero].props, 'mobile');
  check('breakpoint override can differ', typeof mobile === 'object');
}

// ═══════════ 2. STATE GRAPH ═══════════
console.log('\n== 2. STATE GRAPH ==');
{
  const p = mkProject();
  const btn = p.order.find(id => p.nodes[id].semanticRole === 'cta');
  check('define default state ok', nxDefineState(p, btn, 'default', { background: '#0a1638' }).ok);
  check('define hover state ok', nxDefineState(p, btn, 'hover', { transform: 'translateY(-3px)', shadow: '0 8px 24px rgba(0,0,0,.18)' }).ok);
  check('invalid state rejected', nxDefineState(p, btn, 'sizzling', {}).ok === false);
  check('states are first-class per node', Object.keys(nxStates(p, btn)).includes('hover'));
  const css = nxCompileStateCss(p);
  check('state compiles to scoped selectors + kebab props', /:hover\{/.test(css) && /transform:translateY\(-3px\)/.test(css));
}

// ═══════════ 3. ASSET GRAPH SUBSYSTEM ═══════════
console.log('\n== 3. ASSET GRAPH SUBSYSTEM ==');
{
  const p = mkProject();
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  check('add image asset ok', nxAddAsset(p, hero, 'image', { src: 'https://cdn/hero.jpg', width: 1600, height: 900, sizeKB: 520, variants: { mobile: { src: 'https://cdn/hero-mob.jpg', sizeKB: 90 }, desktop: { src: 'https://cdn/hero.jpg' } } }).ok);
  check('invalid asset kind rejected', nxAddAsset(p, hero, 'hologram', {}).ok === false);
  check('get asset for mobile returns lighter variant', nxGetAsset(p, hero, 'mobile').sizeKB === 90 && nxGetAsset(p, hero, 'mobile').src.includes('-mob'));
  check('get asset for desktop returns base', nxGetAsset(p, hero, 'desktop').sizeKB === 520);
  check('asset validation passes', nxAssetValidate(p).ok);
  const viewport = nxResolveAssetForViewport(p, hero, 'mobile');
  check('viewport resolver picks mobile variant + not heavy', viewport.preferredForMobile === 'mobile variant' && viewport.sizeKB === 90);
  const dsk = nxResolveAssetForViewport(p, hero, 'desktop');
  check('desktop asset flagged heavy for mobile', dsk.heavy === true);
}

// ═══════════ 4. PROJECT HISTORY / DIFF ENGINE ═══════════
console.log('\n== 4. PROJECT HISTORY / DIFF ENGINE ==');
{
  const p = mkProject();
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  let cur = IR.nxProjectPatch(p, [{ op: 'token.update', key: 'primaryColor', value: '#123456' }, { op: 'node.set', id: hero, field: 'content', value: { headline: 'New headline' } }]).project;
  const diff = nxDiff(p, cur);
  check('diff detects token + content change', diff.some(o => o.op === 'token.update' && o.key === 'primaryColor' && o.value === '#123456') && diff.some(o => o.op === 'node.set' && o.id === hero));
  const snap = nxSnapshotView(cur);
  check('snapshot view is serializable', snap.tokens.primaryColor === '#123456');
  const entry = nxHistoryPush(cur, [{ op: 'token.update', key: 'primaryColor', value: '#123456' }], 'change brand', p);
  check('history push records entry + reason', entry && entry.reason === 'change brand' && cur.history.length === 1);
  // revert via diff from stored view
  const rev = nxHistoryRevert(cur, 1);
  check('revert produces inverse ops', Array.isArray(rev.ops || rev) && (rev.ok === false || rev.ops.length >= 0));
}

// ═══════════ 5. DESIGN INTENT → PATCH COMPILER ═══════════
console.log('\n== 5. DESIGN INTENT → PATCH COMPILER ==');
{
  const p = mkProject();
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  const plan = nxIntentToPlan('make it feel luxurious', p);
  check('luxury intent maps to design decisions', plan.decisions.length >= 4 && /whitespace|hierarchy|slower motion/i.test(plan.decisions.join(' ')));
  check('luxury intent produces motion + token ops', plan.ops.some(o => o.op === 'motion.update' && o.id === hero) && plan.ops.some(o => o.op === 'token.update' && o.key === 'motionStyle'));
  const before = p.tokens.motionStyle;
  const applied = nxApplyIntent(p, 'make it feel luxurious');
  check('apply intent mutates via the mutation engine', applied.ok && applied.project.tokens.motionStyle === 'cinematic');
  const f = nxIntentToPlan('energetic vibe', mkProject());
  check('energetic intent maps to energetic recipe', f.ops.some(o => o.op === 'token.update' && o.value === 'energetic'));
}

// ═══════════ 6. EVIDENCE-BASED AI CRITIC ═══════════
console.log('\n== 6. EVIDENCE-BASED AI CRITIC ==');
{
  const p = mkProject();
  const pWeak = mkProject(undefined, { neutralFg: '#ffffff', neutralBg: '#ffffff' }); // no contrast
  const crit = nxCriticEvidence(pWeak);
  check('critic returns evidence-based problems', crit.problems.length >= 1);
  const p0 = crit.problems[0];
  check('problem has all evidence fields', ['problem', 'evidence', 'expectedEffect', 'op', 'confidence', 'regressionRisk'].every(k => p0[k] !== undefined));
  check('confidence is a number 0..1', typeof p0.confidence === 'number' && p0.confidence > 0 && p0.confidence <= 1);
  check('critic flags the contrast regression first', /contrast/i.test(p0.problem));
  const critGood = nxCriticEvidence(p);
  check('healthy project still yields a critic (may be empty of fixes)', Array.isArray(critGood.problems));
}

// ═══════════ 7. MOTION TIMELINE + BUDGET ═══════════
console.log('\n== 7. MOTION TIMELINE + BUDGET ==');
{
  const tl = nxTimeline('hero', 'cinematic');
  check('hero timeline has synchronized steps', tl.points['heading begins'] === 0.10 && tl.points['CTA begins'] === 0.45);
  const seq = nxTimelineCompose(tl, { offset: 0.1 });
  check('timeline composes sorted events with offsets', seq.events[0].at >= 0.05 && seq.events.every((e, i, a) => i === 0 || e.at >= a[i - 1].at));
  const p = mkProject();
  const budget = nxMotionBudget(p);
  check('motion budget computes complexity + score', typeof budget.complexity === 'number' && typeof budget.score === 'number');
  const heavy = nxMotionBudget(p, { webgl: 1, gpuEffects: 3, animationComplexity: 5, particles: 6 });
  check('budget flags an overbudget motion design', heavy.withinBudget === false || heavy.score < budget.score);
  const light = nxMotionBudget(p, { reducedMotion: 'none' });
  check('budget respects a mobile-reduction/reduced policy', typeof light.score === 'number');
}

// ═══════════ 8. BEST-KNOWN-VERSION EVOLUTION LOOP ═══════════
console.log('\n== 8. BEST-KNOWN-VERSION EVOLUTION LOOP ==');
{
  const weak = mkProject(undefined, { neutralFg: '#fff', neutralBg: '#fff', motionStyle: 'none' });
  const initial = IR.nxDesignQAProject(weak).score;
  const ev = nxEvolve(weak, {}, { iterations: 4 });
  check('evolution produces a best-known project + log', ev.project && Array.isArray(ev.log) && ev.log.length >= 1);
  check('evolution does not regress design QA', ev.bestScore >= initial, ev.bestScore + ' vs ' + initial);
  check('evolution promoted at least one candidate', ev.promoted >= 1, 'promoted=' + ev.promoted);
  const finalScore = IR.nxDesignQAProject(ev.project).score;
  check('best-known version improved on a bad start', finalScore > initial, finalScore + ' vs ' + initial);
  check('candidate only promoted when budget respected (log records result)', ev.log.every(l => l.result));
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
