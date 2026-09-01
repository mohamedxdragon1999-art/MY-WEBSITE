// v0.0.1.9+ — FOUR INTEGRATION PROJECTS built through the REAL Project Graph and
// rendered by the real compiler (instruction §28). Catches renderer/edge-case
// bugs across diverse content, not just the one SaaS fixture.
//
// Run: node tests/test_projects.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const design = require('/home/user/nx_design.js');
const ir = require('/home/user/nx_ir.js');
const graph = require('/home/user/nx_graph.js');
globalThis.__NX_DEPS = { design, ir, graph };
const R = require('/home/user/nx_render.js');
const { nxSeedComponent, nxRenderDocument, nxBuildSiteGraph } = R;

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

// Generic page builder: add a set of components (each its own top-level section).
function build(blocks) {
  let p = ir.nxNewProject({ name: blocks.name, brief: blocks.brief, tokens: blocks.tokens });
  for (const b of blocks.sections) {
    const r = nxSeedComponent(p, b.family, b.variant, b.content, b.role);
    if (!r.ok) throw new Error('seed ' + b.family + ': ' + r.errors.join(';'));
    p = r.project;
  }
  return p;
}

console.log('\n== A. SaaS ==');
{
  const p = build({ name: 'SaaS', brief: 'modern saas dashboard', sections: [
    { family: 'nav', variant: 'standard', role: 'nav', content: { brand: 'Dash' } },
    { family: 'hero', variant: 'split', role: 'hero', content: { headline: 'Automate work', sub: 'A platform.', cta: 'Start' } },
    { family: 'features', variant: 'grid', role: 'features', content: { heading: 'Features', items: [{ title: 'a', text: 'x' }, { title: 'b', text: 'y' }] } },
    { family: 'testimonials', variant: 'grid', role: 'testimonials', content: { heading: 'Quotes', items: [{ quote: 'q', author: 'a' }] } },
    { family: 'pricing', variant: 'grid', role: 'pricing', content: { heading: 'Pricing', tiers: [{ name: 'S', price: '$1' }] } },
    { family: 'cta', variant: 'centered', role: 'cta', content: { heading: 'Ready?', cta: 'Go' } },
    { family: 'footer', variant: 'columns', role: 'footer', content: { name: 'Dash', legal: '©' } },
  ]});
  const d = nxRenderDocument(p);
  check('SaaS builds a valid, integrity-sound graph', ir.nxValidateGraphIntegrity(p).ok && d.valid);
  check('SaaS renders all 7 sections tagged', ['nav', 'hero', 'features', 'pricing', 'testimonials', 'cta', 'footer'].every(r => p.order.some(id => p.nodes[id].semanticRole === r)));
}

console.log('\n== B. Luxury (minimal layout) ==');
{
  const p = build({ name: 'Luxury', brief: 'dark luxurious minimal', tokens: { primaryColor: '#0a0a0a', neutralBg: '#0a0a0a', neutralFg: '#f5f0e8', motionStyle: 'cinematic' },
    sections: [
      { family: 'nav', variant: 'standard', role: 'nav', content: { brand: 'Maison' } },
      { family: 'hero', variant: 'split', role: 'hero', content: { headline: 'Timeless', sub: 'Crafted.', cta: 'Enquire' } },
      { family: 'features', variant: 'grid', role: 'features', content: { heading: 'Craft', items: [{ title: 'Atelier', text: 'x' }, { title: 'Heritage', text: 'y' }] } },
      { family: 'testimonials', variant: 'grid', role: 'testimonials', content: { heading: 'Praise', items: [{ quote: 'Exquisite', author: 'V.I.P.' }] } },
      { family: 'footer', variant: 'columns', role: 'footer', content: { name: 'Maison', legal: '©' } },
    ]});
  const d = nxRenderDocument(p);
  check('Luxury builds a validity-holding graph', ir.nxValidateGraphIntegrity(p).ok && d.valid);
  check('Luxury dark theme yields light foreground var (contrast preserved)', /--nx-fg:#f5f0e8/i.test(d.css));
  check('Luxury compiles a cinematic motion timeline', !!graph.nxTimeline('hero', 'cinematic').points['heading begins']);
}

console.log('\n== C. Restaurant (menu/gallery/reviews/location/reservation CTA) ==');
{
  // Restaurant needs structure the standard registry doesn't ship (menu/gallery).
  // Build it from primitives to prove the renderer handles ARBITRARY valid graphs.
  let p = ir.nxNewProject({ name: 'Bistro', brief: 'restaurant' });
  const ops = [];
  const rootIds = {};
  function container(id, cls, props, children) {
    const r = { family: 'section', variant: '', role: 'section', content: { role: 'section' }, props: { display: 'flex', direction: 'column', gap: '1rem', ...props } };
    return r;
  }
  // Build a restaurant page: hero + menu grid + gallery + reviews (all as sections).
  const add = (id, family, role, content, props, parent) => {
    p = ir.nxProjectPatch(p, [{ op: 'node.create', node: { id, component: { family }, semanticRole: role || 'none', content, props: props || {} }, parentId: parent || null }]).project;
    return id;
  };
  const hero = add('r-hero', 'hero', 'hero', { headline: 'Bistro', sub: 'Farm to table', cta: 'Reserve' });
  const menu = add('r-menu', 'section', 'section', { heading: 'Menu', items: [{ title: 'Tartare' }, { title: 'Risotto' }] });
  // nested menu cards to prove recursion
  let gm = add('r-menu-grid', 'grid', 'none', { role: 'menu-grid' }, { display: 'grid', columns: 2, gap: '1rem' }, menu);
  add('r-menu-1', 'card', 'none', { title: 'Tartare', text: 'beef' }, {}, gm);
  add('r-menu-2', 'card', 'none', { title: 'Risotto', text: 'mushroom' }, {}, gm);
  const gallery = add('r-gallery', 'section', 'section', { heading: 'Gallery' });
  const ggrid = add('r-gallery-grid', 'grid', 'none', { role: 'gallery' }, { display: 'grid', columns: 3, gap: '1rem' }, gallery);
  add('r-img-1', 'media', 'none', {}, { display: 'grid' }, ggrid);
  add('r-img-2', 'media', 'none', {}, { display: 'grid' }, ggrid);
  const reviews = add('r-reviews', 'testimonials', 'testimonials', { heading: 'Reviews', items: [{ quote: 'Delicious', author: 'Foodie' }] });
  const location = add('r-location', 'section', 'section', { heading: 'Find us' });
  const cta = add('r-cta', 'cta', 'cta', { heading: 'Reserve', cta: 'Book a table' });
  add('r-footer', 'footer', 'footer', { name: 'Bistro', legal: '©' });
  const d = nxRenderDocument(p);
  check('Restaurant builds a validity-holding graph with nested menu cards', ir.nxValidateGraphIntegrity(p).ok && d.valid);
  check('Restaurant renders its nested menu cards (recursion)', d.html.includes('data-nx-id="r-menu-1"') && d.html.includes('data-nx-id="r-menu-2"'));
  check('Restaurant renders gallery media grid', d.html.includes('data-nx-id="r-gallery-grid"') && d.html.includes('data-nx-id="r-img-1"'));
  check('Restaurant renders reservation CTA + location', d.html.includes('data-nx-id="r-cta"') && d.html.includes('data-nx-id="r-location"'));
  check('every node appears exactly once in the render', ['r-hero','r-menu','r-menu-grid','r-menu-1','r-menu-2','r-gallery','r-gallery-grid','r-img-1','r-img-2','r-reviews','r-location','r-cta','r-footer'].every(id => (d.html.match(new RegExp('data-nx-id="' + id + '"','g'))||[]).length === 1));
}

console.log('\n== D. Portfolio (large hero + project grid + case studies) ==');
{
  const p = build({ name: 'Portfolio', brief: 'visual portfolio', tokens: { motionStyle: 'cinematic' }, sections: [
    { family: 'nav', variant: 'standard', role: 'nav', content: { brand: 'Studio' } },
    { family: 'hero', variant: 'split', role: 'hero', content: { headline: 'Selected Work', sub: '2019–2026', cta: 'See work' } },
    { family: 'features', variant: 'grid', role: 'features', content: { heading: 'Projects', items: [{ title: 'Brand X', text: 'Design' }, { title: 'App Y', text: 'Dev' }, { title: 'Site Z', text: 'Web' }] } },
    { family: 'testimonials', variant: 'grid', role: 'testimonials', content: { heading: 'Clients', items: [{ quote: 'Great', author: 'X' }] } },
    { family: 'footer', variant: 'columns', role: 'footer', content: { name: 'Studio', legal: '©' } },
  ]});
  const d = nxRenderDocument(p);
  check('Portfolio holds integrity + renders valid', ir.nxValidateGraphIntegrity(p).ok && d.valid);
  check('Portfolio hero + project grid rendered', d.html.includes('data-nx-id=') && /<section[^>]*class="nx-hero/.test(d.html) && /class="nx-features"/.test(d.html));
}

console.log('\n== E. `nxBuildSiteGraph` freezes brand + composes in one shot ==');
{
  const b = nxBuildSiteGraph({ name: 'Nova', brief: 'saas', primary: '#04070f', accent: '#ff6b1a', motionStyle: 'futuristic' });
  check('single-shot builder produces a valid page', b.compiled.valid, JSON.stringify(b.compiled.validationErrors));
  check('single-shot builder applies primary + accent + dark theme', /--nx-primary:#04070f/i.test(b.compiled.css) && /--nx-fg:#f5f5f7/i.test(b.compiled.css));
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
