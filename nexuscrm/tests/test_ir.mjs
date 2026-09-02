// nx_ir.js — the IR foundation layer: schemas/contracts, Project Mutation Engine,
// Design Brief, Constraint/Layout Engine, Interaction Graph, Motion composition,
// Compiler Pipeline, Design-QA methodology, and the AI Critic → Patch → re-evaluate
// loop. Every AI action here is a *structured patch*, never "rewrite hero HTML".
//
// Run: node tests/test_ir.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Let nx_ir resolve the color/token helpers from the design system.
globalThis.__NX_DESIGN = require('../nx_design.js');

const IR = require('../nx_ir.js');
const {
  nxValidateNode, nxValidateProject,
  nxBriefFromPrompt, nxBriefValidate,
  nxNewProject, nxSeedNode,
  nxProjectPatch, nxNodeCreate, nxNodeDelete, nxNodeMove, nxNodeReplace,
  nxSetProperty, nxTokenUpdate, nxMotionUpdate, nxResponsiveUpdate,
  nxAssetReplace, nxInteractionAdd, NX_OPS,
  nxLayout, nxResolveLayout, nxDeriveResponsive,
  nxInteractionValidate,
  nxMotionComposeIR, nxCompileMotion,
  nxCompile, nxDesignQA, nxDesignQAProject,
  nxCritic, nxPatchPlan, nxDesignLoop,
} = IR;

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
function mkProject(brief, tokens) {
  const p = nxNewProject({ name: 'Test', brief: brief || 'a luxury premium tech site', tokens });
  nxSeedNode(p, { component: { family: 'nav' } });
  nxSeedNode(p, { component: { family: 'hero', variant: 'split' }, content: { headline: 'Ship faster', sub: 'A typed design graph.', cta: 'Try it' } });
  nxSeedNode(p, { component: { family: 'features' } });
  nxSeedNode(p, { component: { family: 'pricing' } });
  nxSeedNode(p, { component: { family: 'cta' } });
  nxSeedNode(p, { component: { family: 'footer' } });
  return p;
}

// ═══════════ 1. IR SCHEMAS + CONTRACTS ═══════════
console.log('\n== 1. IR SCHEMAS + CONTRACTS ==');
{
  const p = mkProject();
  const v = nxValidateProject(p);
  check('valid project passes', v.ok, JSON.stringify(v.errors));
  const bad = nxValidateNode({ id: 'x!' });
  check('node without type/semanticRole/component rejected', bad.ok === false && bad.errors.length >= 1);
  const badProps = nxValidateNode(Object.assign({}, nxSeedNode(nxNewProject({}), { component: { family: 'hero' } }), { props: { onload: 'x' } }));
  check('props outside the layout contract rejected', badProps.ok === false, JSON.stringify(badProps.errors));
  const empty = nxNewProject({});
  check('project with no hero is invalid', nxValidateProject(empty).ok === false);
}

// ═══════════ 2. DESIGN BRIEF ═══════════
console.log('\n== 2. DESIGN BRIEF ==');
{
  const b = nxBriefFromPrompt('Build a luxury premium watch website for high-end buyers. Dark and cinematic. Make it feel energetic. Aim for a lead conversion. Accessible.');
  check('brief detects luxury industry', b.industry === 'luxury', b.industry);
  check('brief detects dark color direction', b.colorDirection === 'dark', b.colorDirection);
  check('brief detects cinematic motion mood', b.motionMood === 'cinematic', b.motionMood);
  check('brief default conversionGoal is lead', b.conversionGoal === 'lead');
  check('brief has all required fields', nxBriefValidate(b).ok === true, JSON.stringify(nxBriefValidate(b).errors));
  const b2 = nxBriefFromPrompt('minimalist app. energetic. subscribe newsletter. light.');
  check('brief detects minimal + light + subscribe', b2.visualStyle === 'minimal' && b2.colorDirection === 'light' && b2.conversionGoal === 'subscribe', JSON.stringify(b2));
  check('brief validation rejects a missing field', nxBriefValidate({}).ok === false);
}

// ═══════════ 3. PROJECT + SEPARATED CONCERN GRAPHS ═══════════
console.log('\n== 3. PROJECT + SEPARATED CONCERN GRAPHS ==');
{
  const p = mkProject('a clean minimal saas site');
  const hero = p.nodes[p.order.find(id => p.nodes[id].semanticRole === 'hero')];
  check('component graph holds structure only', hero.id && hero.component.family === 'hero');
  check('content is separated (headline in content graph)', p.content[hero.id].headline === 'Ship faster');
  check('design is separated (colors in design graph)', p.design[hero.id].colors.primary === p.tokens.primaryColor);
  check('motion is separated (recipe from brief)', /smooth|minimal/.test(p.motion[hero.id].recipe || ''), p.motion[hero.id].recipe);
  check('responsive is an array per node', Array.isArray(p.responsive[hero.id]));
  check('interaction graph is an array per node', Array.isArray(p.interaction[hero.id]));
  check('assets graph keyed by node', Array.isArray(p.assets[hero.id]));
}

// ═══════════ 4. PROJECT MUTATION ENGINE ═══════════
console.log('\n== 4. PROJECT MUTATION ENGINE ==');
{
  const p = mkProject();
  const heroId = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  // create a new testimonial section
  const created = nxNodeCreate(p, { component: { family: 'testimonials', variant: 'grid' }, content: { heading: 'Proof' } });
  check('node.create appends a node', created.ok && created.project.order.length === p.order.length + 1);
  const createdId = created.project.order[created.project.order.length - 1];
  check('created node is validated', nxValidateProject(created.project).ok);

  // set property
  const set = nxSetProperty(created.project, heroId, 'props', { align: 'center' });
  check('node.set mutates props (immutably)', set.project.nodes[heroId].props.align === 'center' && set.project !== created.project);

  // token.update + design memory (only changes the key)
  const tok = nxTokenUpdate(set.project, 'primaryColor', '#c9a35c');
  check('token.update changes the key', tok.project.tokens.primaryColor === '#c9a35c');
  check('token.update preserves other tokens', tok.project.tokens.neutralBg === set.project.tokens.neutralBg);

  // motion.update
  const mo = nxMotionUpdate(tok.project, heroId, 'cinematic');
  check('motion.update sets recipe', mo.project.motion[heroId].recipe === 'cinematic' || mo.project.motion[heroId].profile);

  // responsive.update
  const resp = nxResponsiveUpdate(mo.project, heroId, { on: 'mobile', props: { columns: 1 } });
  check('responsive.update sets a rule', resp.project.responsive[heroId].some(r => r.on === 'mobile'));

  // asset.replace
  const asset = nxAssetReplace(resp.project, heroId, { src: 'https://cdn/x.png' }, 'image');
  check('asset.replace records the asset', asset.project.assets[heroId] && asset.project.assets[heroId][0] && asset.project.assets[heroId][0].src === 'https://cdn/x.png');

  // interaction.add
  const it = nxInteractionAdd(asset.project, heroId, { trigger: 'click', target: heroId, actions: [{ type: 'toggle-class', class: 'is-active' }] });
  check('interaction.add records a valid interaction', it.project.interaction[heroId].some(x => x.trigger === 'click'));

  // atomic rollback: a bad op must not partially apply
  const raid = nxProjectPatch(p, [{ op: 'token.update', key: 'primaryColor', value: '#123' }, { op: 'token.update' }]);
  check('patch with a bad op rolls back atomically', raid.ok === false && raid.project.tokens.primaryColor !== '#123' && raid.applied.length === 0, JSON.stringify(raid.errors));

  // node.replace
  const replaced = nxNodeReplace(it.project, heroId, 'hero', 'split');
  check('node.replace changes variant', replaced.project.nodes[heroId].component.variant === 'split' && replaced.project.nodes[heroId].metadata.replaced === true);

  // node.move
  const moved = nxNodeMove(replaced.project, createdId, null, 0);
  check('node.move reorders the graph', moved.ok && moved.project.order[0] === createdId, JSON.stringify(moved.errors));

  // node.delete cascades
  const p2 = mkProject();
  const del = nxNodeDelete(p2, p2.order.find(id => p2.nodes[id].semanticRole === 'hero'));
  check('node.delete removes the node + concern slices', del.ok && !del.project.nodes[p2.order.find(id => p2.nodes[id].semanticRole === 'hero')] && !del.project.design[p2.order.find(id => p2.nodes[id].semanticRole === 'hero')]);
  check('project without hero is now invalid', nxValidateProject(del.project).ok === false);

  // all named mutation ops are registered
  check('all mutation op kinds registered', NX_OPS.length >= 9 && NX_OPS.includes('node.create') && NX_OPS.includes('interaction.add'));
}

// ═══════════ 5. CONSTRAINT / LAYOUT ENGINE ═══════════
console.log('\n== 5. CONSTRAINT / LAYOUT ENGINE ==');
{
  const l = nxLayout({ columns: 3, align: 'center', gap: '2rem' });
  check('grid layout resolves columns + align', l.display === 'grid' && l.columns === 3 && l.align === 'center');
  const lf = nxLayout({ direction: 'row', justifyContent: 'space-between' });
  check('flex layout resolves direction + justify', lf.display === 'flex' && lf.direction === 'row' && lf.justifyContent === 'space-between');
  const resp = nxDeriveResponsive(l, [{ on: 'tablet', props: { columns: 2 } }]);
  check('responsive derived for multi-column (tablet + mobile)', resp.some(r => r.on === 'tablet') && resp.some(r => r.on === 'mobile'));
  const single = nxDeriveResponsive(nxLayout({ columns: 1, align: 'center' }), []);
  check('single column gets no auto-responsive collapse', single.length === 0);
  check('explicit responsive rule wins', nxDeriveResponsive(l, [{ on: 'tablet', props: { columns: 1 } }]).find(r => r.on === 'tablet').props.columns === 1);
  const p = mkProject();
  check('nxResolveLayout reads node props', nxResolveLayout(p.nodes[p.order.find(id => p.nodes[id].semanticRole === 'hero')]).display === 'grid');
}

// ═══════════ 6. INTERACTION GRAPH ═══════════
console.log('\n== 6. INTERACTION GRAPH ==');
{
  check('valid interaction passes', nxInteractionValidate({ trigger: 'hover', target: 'x', actions: [{ type: 'translate', dx: 4, dy: -4 }] }).ok);
  check('bad trigger rejected', nxInteractionValidate({ trigger: 'bogus', target: 'x', actions: [{}] }).ok === false);
  check('missing actions rejected', nxInteractionValidate({ trigger: 'click', target: 'x' }).ok === false);
  check('bad action type rejected', nxInteractionValidate({ trigger: 'click', target: 'x', actions: [{ type: 'explode' }] }).ok === false);
}

// ═══════════ 7. MOTION COMPOSITION ═══════════
console.log('\n== 7. MOTION COMPOSITION ==');
{
  const cine = nxMotionComposeIR('cinematic', 'hero');
  check('cinematic hero is composed of multiple primitives', cine.primitives.length > 3 && cine.primitives.includes('heading-reveal') && cine.primitives.includes('cta-spring'));
  const css = nxCompileMotion(cine);
  check('composition compiles to keyframes', /@keyframes/.test(css));
  const minimal = nxMotionComposeIR('minimal', 'card');
  check('minimal card is a single primitive', minimal.primitives.length === 1);
}

// ═══════════ 8. COMPILER PIPELINE ═══════════
console.log('\n== 8. COMPILER PIPELINE ==');
{
  const p = mkProject('an energetic cinematic site');
  const stages = nxCompile(p);
  check('compile normalizes + validates', stages.normalized && stages.valid === true, JSON.stringify(stages.validationErrors));
  check('compile resolves layout per node', stages.layout && stages.layout[p.order.find(id => p.nodes[id].semanticRole === 'hero')].display === 'grid');
  check('compile compiles motion css', /@keyframes/.test(stages.motionCss));
  check('compile compiles interaction runtime', /reduced-motion/.test(stages.javascript));
  check('compile resolves style tokens (css vars)', /--nx-primary/.test(stages.style.cssVars));
}

// ═══════════ 9. DESIGN QA METHODOLOGY ═══════════
console.log('\n== 9. DESIGN QA METHODOLOGY ==');
{
  const p = mkProject();
  const qa = nxDesignQAProject(p);
  check('QA returns structured sub-scores', typeof qa.structural === 'number' && typeof qa.visual === 'number' && typeof qa.brand === 'number' && typeof qa.motion === 'number');
  check('QA separates scores (not one beauty number)', qa.structural !== undefined && qa.motion !== undefined);
  check('QA has the 13 categories', ['hierarchy', 'spacing', 'alignment', 'typography', 'contrast', 'colorHarmony', 'density', 'consistency', 'composition', 'visualRhythm', 'responsiveComposition', 'animationQuality', 'brandCoherence'].every(c => qa.categories[c]));
  check('well-formed site scores ≥60', qa.score >= 60, 'score=' + qa.score);
  check('QA computed real contrast', qa.metrics.contrast >= 4.5, 'contrast=' + qa.metrics.contrast);
  const thin = nxNewProject({});
  nxSeedNode(thin, { component: { family: 'hero' } });
  const qaThin = nxDesignQAProject(thin);
  check('thin site scores lower than full site', qaThin.score < qa.score, qaThin.score + ' vs ' + qa.score);
}

// ═══════════ 10. AI CRITIC → PATCH → RE-EVALUATE LOOP ═══════════
console.log('\n== 10. AI CRITIC → PATCH → RE-EVALUATE LOOP ==');
{
  const p = mkProject('a minimal clean site');  // smooth motion, stack-ish hero (centered)
  const crit = nxCritic(p);
  check('critic returns prioritized problems', Array.isArray(crit.problems) && crit.problems.every(pr => pr.severity >= 0));
  const p0 = nxDesignQAProject(p).score;
  const loop = nxDesignLoop(p, 3);
  check('design loop applies patches and re-evaluates', Array.isArray(loop.history) && loop.history.length >= 1);
  check('loop converges or improves (final score >= initial)', loop.finalQa.score >= p0, loop.finalQa.score + ' vs ' + p0);
  check('each loop step recorded a score', loop.history.every(h => typeof h.score === 'number'));
  // a concrete patch plan from the critic is legal and atomic
  const plan = nxPatchPlan(crit.problems);
  check('patch plan is an ordered list of ops', Array.isArray(plan));
  if (plan.length) {
    const applied = nxProjectPatch(p, plan.map(pl => { const { _id, _reason, ...op } = pl; return op; }));
    check('critic patch plan applies cleanly', applied.ok, JSON.stringify(applied.errors));
  }
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
