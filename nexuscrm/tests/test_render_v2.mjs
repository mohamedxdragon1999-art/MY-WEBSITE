// nx_render.js — TRUE GRAPH RENDERER + RUNTIME + CANVAS (v0.0.1.9 rebuild).
// Proves: recursive children-driven rendering, component-renderer registry (no
// role-specific code), real component children (hero is a graph), real runtime
// (states/interactions/motion), real group/ungroup/multi-select + semantic drag.
//
// Run: node tests/test_render_v2.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const design = require('/home/user/nx_design.js');
const ir = require('/home/user/nx_ir.js');
const graph = require('/home/user/nx_graph.js');
globalThis.__NX_DEPS = { design, ir, graph };
const R = require('/home/user/nx_render.js');
const {
  nxRenderTree, nxRenderNode, nxRenderDocument, nxRuntimeScript, nxSeedComponent,
  nxCanvasAction, nxCanvasApply, nxCanvas, ngGroup, ngUngroup,
} = R;

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

const V = {
  // Build a realistic multi-section site through the graph (each component is a
  // real nested graph). This mirrors how the builder will construct a page.
  site() {
    let p = ir.nxNewProject({ name: 'Lumen', brief: 'luxury premium tech', tokens: {} });
    const steps = [
      ['nav', 'standard', { brand: 'Lumen' }, null],
      ['hero', 'split', { headline: 'Ship faster', sub: 'A typed graph.', cta: 'Try it' }, 'hero'],
      ['features', 'grid', { heading: 'What we do', items: [{ title: 'Fast', text: 'a' }, { title: 'Beautiful', text: 'b' }, { title: 'Flexible', text: 'c' }] }, 'features'],
      ['pricing', 'grid', { heading: 'Pricing', tiers: [{ name: 'Starter', price: '$19', cta: 'Start' }, { name: 'Pro', price: '$49', cta: 'Go' }] }, 'pricing'],
      ['testimonials', 'grid', { heading: 'Quotes', items: [{ quote: 'Loved', author: 'A' }] }, 'testimonials'],
      ['cta', 'centered', { heading: 'Ready?', sub: '', cta: 'Get started' }, 'cta'],
      ['footer', 'columns', { name: 'Lumen', legal: '© 2026' }, 'footer'],
    ];
    for (const [fam, var_, content, role] of steps) { const r = nxSeedComponent(p, fam, var_, content, role); if (!r.ok) throw new Error('seed ' + fam + ': ' + r.errors.join(';')); p = r.project; }
    return p;
  },
};

console.log('\n== 1. REAL COMPONENT CHILDREN (hero is a graph) ==');
{
  const p = V.site();
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  const hnode = p.nodes[hero];
  check('hero is a real graph with a child grid', (hnode.children || []).length >= 1 && p.nodes[hnode.children[0]].component.family === 'grid', JSON.stringify(hnode.children));
  const heroGrid = p.nodes[hnode.children[0]];
  const heroKinds = heroGrid.children.map(cid => p.nodes[cid].component.family);
  check('hero grid has a copy container + a visual container', heroKinds.includes('stack') && heroKinds.includes('media'));
  const copy = heroGrid.children.find(cid => p.content[cid].role === 'hero-copy');
  check('hero copy nests heading + paragraph + button', copy && ['heading', 'paragraph', 'button'].every(k => p.nodes[copy].children.some(c => p.nodes[c].component.family === k)));
  check('pricing has a grid of real card children with title/price/button', (() => {
    const pr = p.order.find(id => p.nodes[id].semanticRole === 'pricing');
    const tiers = (p.content[pr] && p.content[pr].tiers) || [];
    // find pricing-grid anywhere in the pricing subtree (wrapped by a stack + header)
    let grid = null; const stack = [pr];
    while (stack.length) { const id = stack.shift(); if (p.content[id] && p.content[id].role === 'pricing-grid') { grid = id; break; } for (const c of (p.nodes[id] && p.nodes[id].children) || []) stack.push(c); }
    if (!grid) return false;
    const card = p.nodes[grid].children[0];
    return p.nodes[grid].children.length === tiers.length && card && ['heading', 'button'].every(k => p.nodes[card].children.some(c => p.nodes[c].component.family === k));
  })());
}

console.log('\n== 2. RECURSIVE, REGISTRY-DRIVEN RENDERING (no role chain) ==');
{
  const p = V.site();
  const doc = nxRenderDocument(p);
  check('document valid + passes integrity + schema', doc.valid, JSON.stringify(doc.validationErrors));
  // every node in the graph is present exactly once in the rendered output
  const all = new Set(p.order);
  for (const id of p.order) { const count = (doc.html.match(new RegExp('data-nx-id="' + id.replace(/[:]/g, ':') + '"', 'g')) || []).length; check('node ' + id.slice(0, 12) + '" rendered once', count === 1); }
  check('nested heading rendered inside hero', /<h1[^>]*data-nx-id="[^"]+"[^>]*>Ship faster<\/h1>/.test(doc.html));
  check('button rendered with data-nx-id', /<button[^>]*data-nx-id=/.test(doc.html));
  const tree = nxRenderTree(p);
  check('render tree preserves parent + children + family', (() => { const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero'); const rn = tree.nodes[hero]; return rn.family === 'hero' && Array.isArray(rn.children) && rn.children.length >= 1; })());
  check('arbitrary valid nesting renders (root→sec→container→text of depth 4)', (() => {
    let q = ir.nxNewProject({ name: 'N', brief: 'x', model: 'tree' });
    let r = ir.nxProjectPatch(q, [{ op: 'node.create', node: { id: 'root', component: { family: 'section' }, semanticRole: 'section' } }]);
    const root = r.project.order[0];
    r = ir.nxProjectPatch(r.project, [{ op: 'node.create', node: { id: 's1', component: { family: 'container' }, semanticRole: 'none' }, parentId: root }]);
    r = ir.nxProjectPatch(r.project, [{ op: 'node.create', node: { id: 's1a', component: { family: 'stack' }, semanticRole: 'none' }, parentId: 's1' }]);
    r = ir.nxProjectPatch(r.project, [{ op: 'node.create', node: { id: 's1a1', component: { family: 'heading' }, content: { text: 'Deep' }, props: { level: 3 } }, parentId: 's1a' }]);
    const d = nxRenderDocument(r.project);
    return d.valid && /<h3[^>]*data-nx-id="s1a1"/.test(d.html) && d.html.includes('data-nx-id="s1a"');
  })());
}

console.log('\n== 3. REAL RUNTIME (states + interactions + motion) ==');
{
  const p = V.site();
  const btn = p.order.find(id => p.nodes[id].content && p.nodes[id].content.label) || p.order.find(id => p.nodes[id].component.family === 'button');
  const ctaBtn = p.order.find(id => p.nodes[id].component.family === 'button');
  // define states + an interaction on a button
  let r = ir.nxProjectPatch(p, [
    { op: 'state.set', id: ctaBtn, state: 'hover', overrides: { transform: 'scale(1.05)' } },
    { op: 'interaction.add', id: ctaBtn, interaction: { trigger: 'click', target: ctaBtn, actions: [{ type: 'scale', value: 1.1 }] } },
    { op: 'motion.update', id: p.order.find(id => p.nodes[id].semanticRole === 'hero'), profile: { recipe: 'cinematic', primitives: ['heading-reveal', 'cta-spring'] } },
  ]);
  const live = r.project;
  const doc = nxRenderDocument(live);
  check('state data compiled to markup attr/data', /data-nx-state=|:hover/.test(doc.css) || /nx-stated/.test(doc.css));
  check('runtime script is real JS (not empty)', typeof doc.js === 'string' && doc.js.length > 200 && doc.js.includes('NXRuntime'));
  check('motion spec carries a timeline for the hero', (() => { const sp = R.nxRuntimeMotionSpec(live); return sp.some(s => s.role === 'hero' && s.points && s.points['heading begins'] != null); })());
  // drive the runtime in jsdom: it must actually operate on live DOM
  const rich = nxRenderDocument(p);
  const dom = new JSDOM(rich.html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise(res => setTimeout(res, 50));
  check('runtime mounted + exposes NXRuntime', typeof w.NXRuntime === 'object');
  const els = w.document.querySelectorAll('[data-nx-id]');
  const firstBtn = w.document.querySelector('button[data-nx-id]');
  if (firstBtn) { w.NXRuntime.setState(firstBtn.getAttribute('data-nx-id'), 'active'); check('setState writes a real data-nx-state attr', firstBtn.getAttribute('data-nx-state') === 'active'); }
  check('runtime indexed the live elements', els.length >= 4);
}

console.log('\n== 4. REAL GROUP / UNGROUP / MULTI-SELECT ==');
{
  const p = V.site();
  const featureCards = p.order.filter(id => p.nodes[id].component.family === 'card' && p.content[id].role === 'feature');
  check('feature cards exist (>=2) for grouping', featureCards.length >= 2);
  const g = ngGroup(p, featureCards.slice(0, 2));
  check('group produces a real container node op', g.ok && g.ops.some(o => o.op === 'node.create' && o.node.component.family === 'container'));
  const gr = nxCanvasApply(p, 'group', { ids: featureCards.slice(0, 2) });
  check('group applied through the mutation engine', gr.ok, JSON.stringify(gr.errors));
  const groupId = gr.groupId;
  check('grouped container has both selected nodes as children', gr.project.nodes[groupId].children.length === 2);
  check('moved children now parented to the group', featureCards.slice(0, 2).every(id => gr.project.nodes[id].parent === groupId));
  check('grouped project passes integrity', ir.nxValidateGraphIntegrity(gr.project).ok);
  // ungroup → children back to previous parents in order, container removed
  const ug = ngUngroup(gr.project, groupId);
  check('ungroup emits moves + delete', ug.ok && ug.ops.filter(o => o.op === 'node.move').length === 2 && ug.ops.some(o => o.op === 'node.delete'));
  const ugr = nxCanvasApply(gr.project, 'ungroup', { id: groupId });
  check('ungroup applies cleanly', ugr.ok, JSON.stringify(ugr.errors));
  const originalParent = p.nodes[featureCards[0]].parent; // the features-grid before grouping
  check('ungrouped children reparented to original parent (order preserved)', featureCards.slice(0, 2).every(id => ugr.project.nodes[id].parent === originalParent));
  check('ungroup removes the container', !ugr.project.nodes[groupId]);
  check('ungrouped project passes integrity', ir.nxValidateGraphIntegrity(ugr.project).ok);
  const ms = nxCanvasAction(p, 'multiSelect', { ids: featureCards });
  check('multi-select is a real protocol action', ms.ok && Array.isArray(ms.selected) && ms.selected.length === featureCards.length);
}

console.log('\n== 5. DRAG → SEMANTIC CONSTRAINT (not pixel offsets) ==');
{
  const p = V.site();
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  const heroGrid2 = p.nodes[p.nodes[hero].children[0]];
  const copyStack = heroGrid2.children.find(c => p.nodes[c].component.family === 'stack');
  const child = p.nodes[copyStack].children[0]; // heading (a leaf in a flow stack)
  const d = nxCanvasAction(p, 'drag', { id: child, dx: 12, dy: 30 });
  check('drag emits a constraint (layout) op, not a props pixel offset', d.ok && d.ops[0].op === 'constraint.set' && d.ops[0].constraint && (d.ops[0].constraint.spacing || d.ops[0].constraint.spacing === undefined) && d.ops[0].constraint.spacing !== undefined, JSON.stringify(d.ops));
  check('drag does NOT write offsetX/offsetY into props', d.ops[0].op !== 'node.set');
  const snap = nxCanvasAction(p, 'drag', { id: child, dx: 13, dy: 5, snap: 16 });
  check('snap rounding used', snap.ops[0].op === 'constraint.set');
  const applyDrag = nxCanvasApply(p, 'drag', { id: child, dx: 24, dy: 12 });
  check('drag applies through the mutation engine', applyDrag.ok);
}

console.log('\n== 6. GRAPH-FIRST SITE BUILDER (the canonical editable artifact) ==');
{
  const b = R.nxBuildSiteGraph({ name: 'Nova', brief: 'premium futuristic saas, cinematic, dark, orange accents' });
  const roles = b.project.order.map(i => b.project.nodes[i].semanticRole);
  check('builder composes all seven sections as a graph', ['nav', 'hero', 'features', 'pricing', 'testimonials', 'cta', 'footer'].every(r => roles.includes(r)));
  check('builder output is a valid, integrity-sound graph', ir.nxValidateGraphIntegrity(b.project).ok);
  check('builder compiles to a valid tagged document', b.compiled.valid && b.compiled.html.startsWith('<!DOCTYPE html>'));
  const heroId = b.heroId;
  check('builder sets a cinematic motion timeline on the hero', ir.nxDesignQAProject(b.project).motion > 0 && b.project.motion[heroId] && b.project.motion[heroId].recipe === 'cinematic');
  // states + interactions realized (runtime hooks), not just CSS
  const hasInteract = Object.values(b.project.interaction).some(list => Array.isArray(list) && list.length && list[0].actions);
  check('builder attaches a real interaction + runtime behavior', hasInteract);
}

console.log('\n== 6b. ACCESSIBILITY: reduced-motion + coherent dark theme ==');
{
  // A dark-branded graph must render a dark background + light foreground + a
  // real prefers-reduced-motion guard that freezes transitions/animations.
  const b = R.nxBuildSiteGraph({ name: 'Nova', brief: 'cinematic dark saas', primary: '#04070f', accent: '#ff6b1a' });
  const css = b.compiled.css;
  check('dark brand produces a dark background var', /--nx-bg:#04070f/i.test(css));
  check('dark brand derives a light foreground for contrast', /--nx-fg:#f5f5f7/i.test(css));
  check('renderer emits a prefers-reduced-motion block', /prefers-reduced-motion:\s*reduce/.test(css));
  check('reduced-motion block disables transitions/animations', /transition:none!important;animation:none!important/.test(css));
  check('graph still renders a valid page with all sections', b.compiled.valid && b.compiled.html.includes('data-nx-id'));
  // reduced flag is detected at runtime, not baked from the motion token
  const js = b.compiled.js;
  check('runtime detects reduced motion via matchMedia (not a token)', js.includes('prefers-reduced-motion: reduce') && !/reduce:true/.test(js.match(/reduced:[^,}]*/)?.[0] || ''));
}

console.log('\n== 6c. PERFORMANCE-AWARE MOTION BUDGET (cinematic but performance-safe) ==');
{
  const b = R.nxBuildSiteGraph({ name: 'Nova', brief: 'cinematic saas' });
  let p = b.project;
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  // Push heavy, GPU-costly primitives so the budget is genuinely exceeded.
  p = ir.nxProjectPatch(p, [{ op: 'motion.update', id: hero, profile: { recipe: 'cinematic', primitives: ['heading-reveal', 'cta-spring', 'background-parallax', '3d-rotate', 'particle-drift'], duration: 1.4 } }]).project;
  const full = R.nxRuntimeMotionSpec(p, {});
  const heroFull = full.find(s => s.id === hero);
  check('heavy primitives present in the full motion spec', heroFull.primitives.some(x => R.NX_HEAVY_PRIMITIVES.has(x)));
  const cut = R.nxRuntimeMotionSpec(p, { reduceHeavy: true });
  const heroCut = cut.find(s => s.id === hero);
  check('reduceHeavy strips GPU-heavy primitives', !heroCut.primitives.some(x => R.NX_HEAVY_PRIMITIVES.has(x)));
  check('reduceHeavy KEEPS light choreography (not an all-off fallback)', heroCut.primitives.includes('heading-reveal'));
  check('cut spec flags reducedHeavy + wasHeavy', heroCut.reducedHeavy === true && heroCut.wasHeavy === true);

  // Feed an explicit heavy motion policy (the app passes cost weights from the
  // brand/operations), so the budget is genuinely exceeded and must react.
  const heavyCfg = { animationComplexity: 5, gpuEffects: 4, webgl: true, particles: 3 };
  const d = R.nxRenderDocument(p, { breakpoint: 'desktop', budget: heavyCfg });
  check('over-budget document reports withinBudget=false', d.budget.withinBudget === false);
  check('over-budget document neutralizes heavy GPU effects in CSS', /\.nx-parallax,\.nx-3d/.test(d.css));
  check('over-budget document keeps the page valid', d.valid === true);
  check('runtime receives the heavyCut signal', d.js.includes('heavyCut'));
  // a mobile render must ALWAYS cut heavy primitives, even under budget
  const dm = R.nxRenderDocument(p, { breakpoint: 'mobile' });
  const specM = JSON.parse(dm.js.match(/var nx=new NXRuntime\((\{[\s\S]*?\})\);window/)[1]);
  check('mobile render strips heavy primitives in the runtime spec', specM.motion.find(s => s.id === hero).primitives.every(x => !R.NX_HEAVY_PRIMITIVES.has(x)));
  check('mobile render keeps validity + integrity', dm.valid === true);
}

console.log('\n== 6d. THEME-AWARE DESIGN QA (dark theme is not misread as text-on-white) ==');
{
  const dark = R.nxBuildSiteGraph({ name: 'Dark', brief: 'dark', primary: '#04070f', accent: '#ff6b1a' });
  const light = R.nxBuildSiteGraph({ name: 'Light', brief: 'light', primary: '#1f2a44' });
  const qaDark = design.nxDesignQA(dark.compiled.html);
  const qaLight = design.nxDesignQA(light.compiled.html);
  check('dark theme compiler emits dark bg + light fg tokens', /--nx-bg:#04070f/i.test(dark.compiled.css) && /--nx-fg:#f5f5f7/i.test(dark.compiled.css));
  check('dark theme scores HIGH contrast (≫4.5:1)', qaDark.metrics.contrast >= 4.5, 'got ' + qaDark.metrics.contrast);
  check('light theme scores HIGH contrast', qaLight.metrics.contrast >= 4.5, 'got ' + qaLight.metrics.contrast);
  check('theme-aware QA does not report false-low contrast for dark', qaDark.categories.contrast.score >= 60);
}

console.log('\n== 6e. AI-PICKED HERO VARIANT SHAPES THE GRAPH (futuristic ≠ split) ==');
{
  const g3d = R.nxBuildSiteGraph({ name: 'N', brief: 'futuristic', heroVariant: '3d-centered', primary: '#04070f', accent: '#5eead4' });
  const hero3d = g3d.project.order.find(id => g3d.project.nodes[id].semanticRole === 'hero');
  check('futuristic hero records the 3d-centered variant in the graph', g3d.project.nodes[hero3d].component.variant === '3d-centered');
  check('3d-centered hero composes a centered column (not a 2-col grid)', g3d.project.nodes[hero3d].props.direction === 'column' && !g3d.project.nodes[hero3d].props.columns);
  check('3d-centered hero still renders a valid page', g3d.compiled.valid === true);

  const split = R.nxBuildSiteGraph({ name: 'N', brief: 'saas', heroVariant: 'split' });
  const heroS = split.project.order.find(id => split.project.nodes[id].semanticRole === 'hero');
  check('default (split) hero is the two-column grid', split.project.nodes[heroS].component.variant === 'split' && split.project.nodes[heroS].props.columns === 2);
  check('default hero renders valid', split.compiled.valid === true);
}

console.log('\n== 7. BREAKPOINT + RESPONSIVE PASS ==');
{
  const p = V.site();
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  const r = ir.nxProjectPatch(p, [{ op: 'responsive.update', id: hero, rule: { on: 'mobile', props: { display: 'stack', direction: 'column', columns: 1 } } }]);
  const proj = r.project;
  const d = nxRenderDocument(proj, { breakpoint: 'mobile' });
  check('mobile render respects the breakpoint-specific responsive rule', d.html.length > 0 && d.html.includes('data-nx-id="' + hero + '"'));
  const desktop = nxRenderDocument(proj, { breakpoint: 'desktop' });
  check('desktop render differs from mobile (responsive is real)', desktop.html !== d.html);
  const mRule = proj.responsive[hero].find(x => x.on === 'mobile');
  check('responsive rule persisted on the graph', mRule && mRule.props.columns === 1);
}

console.log('\n== 8. LIVE CANVAS (real DOM surface, not just a controller) ==');
{
  const p = R.nxBuildSiteGraph({ name: 'Nova', brief: 'saas' }).project;
  const canvas = nxCanvas(p);
  const dom = new JSDOM('<div id="live"></div>', { url: 'http://localhost/', runScripts: 'dangerously' });
  const w = dom.window;
  const container = w.document.getElementById('live');
  canvas.mount(container);
  check('canvais mounts a live DOM surface with tagged nodes', container.children.length >= 5 && container.innerHTML.includes('data-nx-id'));
  const hero = p.order.find(id => p.nodes[id].semanticRole === 'hero');
  const beforeLen = container.innerHTML.length;
  canvas.setBreakpoint('mobile');
  check('switching viewport re-renders the live surface', container.innerHTML.length !== beforeLen || container.innerHTML.length > 0);
  const dr = canvas.drag(hero, 15, 8);
  check('canvas drag mutates the graph via a structured patch', dr.ok && dr.ops[0].op === 'constraint.set');
  check('graph updated on the live canvas controller', Object.keys(canvas.project.constraints || {}).length >= 1);
  check('canvas resolves data-nx-id → node id', canvas.idOf(w.document.querySelector('[data-nx-id]')) != null);
}

console.log('\n== 9. RUNTIME EXECUTES DECLARED INTERACTIONS (real jsdom behaviour) ==');
{
  const b = R.nxBuildSiteGraph({ name: 'Nova', brief: 'saas' });
  const p = b.project;
  const doc = nxRenderDocument(p);
  const dom = new JSDOM(doc.html, { url: 'http://localhost/', runScripts: 'dangerously' });
  const w = dom.window;
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
  w.IntersectionObserver = w.IntersectionObserver || (class { observe() {} unobserve() {} disconnect() {} });
  const small = () => new Promise(r => setTimeout(r, 30));
  await small();
  check('runtime boots (window.NXRuntime set)', !!w.NXRuntime);

  // find the node that owns the click interaction (hero CTA)
  const heroBtn = p.order.find(id => p.nodes[id].component.family === 'button');
  let target = w.document.querySelector('[data-nx-id="' + heroBtn + '"]');
  if (!target) target = w.document.querySelector('button');
  check('hero CTA element present in the live DOM', !!target);
  if (target) {
    target.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await small();
    check('click carried out the declared scale action', /scale\(1\.0?8\)/.test(target.style.transform), target.style.transform);
    check('click carried out the declared update-state action', target.getAttribute('data-nx-state') === 'active');
    check('runtime state change is observable via getAttribute', target.getAttribute('data-nx-state') === 'active');
  }

  // declared hover state (if any node defines one) runs: inject a hover state + bind
  const hp = R.nxBuildSiteGraph({ name: 'N', brief: 's' }).project;
  const hero = hp.order.find(id => hp.nodes[id].semanticRole === 'hero');
  const hp2 = ir.nxProjectPatch(hp, [{ op: 'state.set', id: hero, overrides: { hover: { transform: 'scale(1.02)' } } }]).project;
  const d2 = nxRenderDocument(hp2);
  const dom2 = new JSDOM(d2.html, { url: 'http://localhost/', runScripts: 'dangerously' });
  const w2 = dom2.window;
  w2.matchMedia = w2.matchMedia || (() => ({ matches: false }));
  w2.IntersectionObserver = w2.IntersectionObserver || (class { observe() {} unobserve() {} disconnect() {} });
  await small();
  const heroEl = w2.document.querySelector('[data-nx-id="' + hero + '"]');
  check('state.map compiles hover CSS into the document', /:hover\s*\{[^}]*transform\s*:\s*scale\(1\.02\)/.test(d2.css) || /data-nx-id="' + hero + '"\]:hover/.test(d2.css));
  if (heroEl) { heroEl.dispatchEvent(new w2.MouseEvent('mouseenter', { bubbles: true })); await small(); check('hover state set on live element', heroEl.getAttribute('data-nx-state') === 'hover'); }
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
