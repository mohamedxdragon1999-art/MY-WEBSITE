// nx_graph.js — HTML → PROJECT GRAPH IMPORT / MIGRATION LAYER (v0.0.1.9).
// Proves existing HTML sites can enter the graph architecture, with confidence
// (extracted / inferred / unknown) and extracted brand tokens — never a claim of
// perfect reverse parsing.
//
// Run: node tests/test_import.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.__NX_IR = require('../nx_ir.js');
globalThis.__NX_DESIGN = require('../nx_design.js');
const G = require('../nx_graph.js');
const IR = require('../nx_ir.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

const HTML = '<!DOCTYPE html><html lang="en"><head><title>Acme Studio</title><style>body{background:#fff;color:#111} h1{font-family:"Playfair Display",serif} .cta{background:#c0392b;color:#fff}</style></head><body><nav><strong>Acme</strong><span>Home About Contact</span></nav><section class="hero"><h1>Welcome to Acme</h1><p>We craft beautiful software.</p><a class="cta">Get started</a><img src="hero.jpg" alt="hero visual" width="1600" height="900"></section><section class="features"><h2>Our Services</h2><div class="card"><h3>Fast</h3><p>Instant.</p></div><div class="card"><h3>Beautiful</h3><p>Designed.</p></div></section><section class="pricing"><h2>Pricing</h2><div class="tier">Pro $49</div></section><footer><p>© 2026 Acme</p></footer></body></html>';

console.log('\n== 1. IMPORT INTO A VALID GRAPH ==');
{
  const r = G.nxImportHtml(HTML, { name: 'Acme Studio' });
  check('import succeeds', r.ok, r.errors && r.errors.join(';'));
  check('produces a project with nodes + order', r.project && Array.isArray(r.project.order) && r.project.order.length >= 3);
  check('imported graph passes integrity', IR.nxValidateGraphIntegrity(r.project).ok, JSON.stringify(IR.nxValidateGraphIntegrity(r.project).errors));
  const roles = r.project.order.map(id => r.project.nodes[id].semanticRole);
  check('nav detected', roles.includes('nav'));
  check('hero detected with headline', roles.includes('hero') && r.project.content[r.project.order.find(id => r.project.nodes[id].semanticRole === 'hero')].headline.toLowerCase().includes('welcome'));
  check('pricing detected', roles.includes('pricing'));
  check('footer detected', roles.includes('footer'));
}

console.log('\n== 2. CONFIDENCE IS EXPOSED PER NODE ==');
{
  const r = G.nxImportHtml(HTML, { name: 'Acme' });
  check('every imported block has a confidence', r.confidence.every(c => ['extracted', 'inferred', 'unknown'].includes(c.confidence)));
  const navC = r.confidence.find(c => c.role === 'nav');
  check('structural tags are marked "extracted"', navC && navC.confidence === 'extracted');
  check('heading-derived sections are marked "inferred"', r.confidence.some(c => c.confidence === 'inferred'));
}

console.log('\n== 3. TEXT / ASSETS / CARDS / TOKENS EXTRACTED ==');
{
  const r = G.nxImportHtml(HTML, { name: 'Acme' });
  const hero = r.project.order.find(id => r.project.nodes[id].semanticRole === 'hero');
  check('hero cta extracted', r.project.content[hero].cta.toLowerCase().includes('get started'));
  check('hero subheading extracted', /beautiful software/i.test(r.project.content[hero].sub));
  const features = r.project.order.find(id => r.project.nodes[id].semanticRole === 'features');
  check('feature cards extracted (>=2)', (r.project.content[features].items || []).length >= 2);
  check('brand tokens extracted (primary color)', /^#[0-9a-f]{6}$/i.test((r.tokens && r.tokens.primary) || ''));
  check('heading font extracted', /playfair|serif/i.test((r.tokens && r.tokens.headingFont) || ''));
  // assets should be bound (an image was found in the hero block)
  check('asset extraction picks up hero image', r.confidence.some(c => c.assets >= 1));
}

console.log('\n== 4. IMPORTED GRAPH CAN BE RENDERED (enters the pipeline) ==');
{
  globalThis.__NX_DEPS = { design: globalThis.__NX_DESIGN, ir: globalThis.__NX_IR, graph: G };
  const R = require('../nx_render.js');
  const r = G.nxImportHtml(HTML, { name: 'Acme' });
  const doc = R.nxRenderDocument(r.project);
  check('imported graph renders a tagged document', doc.html && doc.html.includes('data-nx-id'));
  check('rendered document is structurally valid', doc.valid, JSON.stringify(doc.validationErrors));
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
