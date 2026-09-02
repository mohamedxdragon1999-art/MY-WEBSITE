// nx_design.js — the DETERMINISTIC core of the hybrid AI/deterministic website
// engine. Covers: Brand/Tokens (design memory), the multi-graph Project Model,
// Component Intelligence (families of compositions), the Motion Engine +
// Animation Composer, Design Exploration, **Design QA** (beauty), and the
// bidirectional Project Graph ◄─► Code mapping.
//
// Run: node tests/test_design.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const D = (await import(join(ROOT, 'nx_design.js'))); // shared engine
const {
  NX_BRAND_DEFAULTS, NX_COMPONENTS, NX_DIRECTIONS,
  expandHex, contrastRatio, isHex,
  nxTokensToCss, nxMergeBrand, nxBrandFromSite, nxTokensValidate,
  nxProject, nxProjectAddComponent, nxProjectValidate, nxNode,
  nxListComponents, nxComponentVariants, nxBuildComponent,
  nxMotionMood, nxMotionCompose, nxMotionToCss, nxMotionToJs,
  nxDirectionFit, nxExplore,
  nxDesignQA,
  nxProjectToCode, nxCodeToProject,
} = D;
if (typeof nxDesignQA === 'undefined') throw new Error('nx_design.js failed to import');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

// ═══════════ 1. BRAND / TOKENS / DESIGN MEMORY ═══════════
console.log('\n== 1. BRAND / TOKENS / DESIGN MEMORY ==');
{
  const css = nxTokensToCss({ primaryColor: '#f7742a' });
  check('tokens compile to :root with kebab vars', css.startsWith(':root') && /--nx-primary:#f7742a/i.test(css) && !/--nx-primaryColor/.test(css));
  check('defaults fill unspecified keys', /--nx-heading-font:/.test(css));
  const base = { primaryColor: '#111', headingFont: 'Sora' };
  const merged = nxMergeBrand(base, { primaryColor: '#f7742a' });
  check('merge preserves unspecified (design memory)', merged.primaryColor === '#f7742a' && merged.headingFont === 'Sora');
  check('merge skips empty patch values', nxMergeBrand(base, { accentColor: '' }).accentColor === NX_BRAND_DEFAULTS.accentColor);
  const brand = nxBrandFromSite('<style>body{font-family:Inter;color:#17173a;background:#fff}h1{color:#0a1638;border-radius:12px}</style>');
  check('brand extracts a primary hex', isHex(brand.primaryColor) && brand.accentColor !== undefined);
  check('brand extracts fonts + radius', /Inter/.test(brand.bodyFont || '') && brand.radiusStyle === '12px');
  const bad = nxTokensValidate({ neutralFg: '#ffffff', neutralBg: '#ffffff' });
  check('validate flags low body contrast', !bad.ok && bad.errors.some(e => /contrast/i.test(e)));
  const good = nxTokensValidate({});
  check('validate passes defaults', good.ok === true);
  check('expandHex normalizes short hex', expandHex('#fff') === '#ffffff');
  check('contrastRatio white/black ≈21', Math.round(contrastRatio('#ffffff', '#000000')) === 21);
}

// ═══════════ 2. PROJECT MODEL (multi-graph) ═══════════
console.log('\n== 2. PROJECT MODEL (multi-graph) ==');
{
  const p = nxProject({ name: 'Studio', brand: { motionStyle: 'cinematic' } });
  const hero = nxBuildComponent('hero', 'split', { headline: 'Build faster' }, p.brand);
  const feats = nxBuildComponent('features', 'grid', { items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }, p.brand);
  nxProjectAddComponent(p, hero); nxProjectAddComponent(p, feats);
  p.order = [hero.id, feats.id];
  const v = nxProjectValidate(p);
  check('valid project passes', v.ok, JSON.stringify(v.errors));
  const bare = nxProject({});
  check('project with no hero is invalid', nxProjectValidate(bare).ok === false);
  check('node has design/motion/responsive slots', hero.structure && hero.visual && hero.responsive && hero.purpose);
  check('hero structure is split grid', hero.structure.type === 'grid' && hero.structure.columns === 2);
  check('component carries semantic + conversion purpose', /first impression/i.test(hero.purpose.semantic) && /CTA/i.test(hero.purpose.conversion));
}

// ═══════════ 3. COMPONENT INTELLIGENCE ═══════════
console.log('\n== 3. COMPONENT INTELLIGENCE ==');
{
  check('lists component families', nxListComponents().includes('hero') && nxListComponents().includes('pricing'));
  check('hero has 8 composition variants', nxComponentVariants('hero').length === 8 && nxComponentVariants('hero').includes('asymmetric'));
  check('unknown family/variant throws', (() => { try { nxBuildComponent('hero', 'bogus', {}, {}); return false; } catch { return true; } })());
  for (const f of nxListComponents()) {
    const variants = nxComponentVariants(f);
    check(`every family has variants (${f})`, variants.length > 0);
  }
}

// ═══════════ 4. MOTION ENGINE + ANIMATION COMPOSER ═══════════
console.log('\n== 4. MOTION ENGINE + ANIMATION COMPOSER ==');
{
  check('"make it feel cinematic" maps to cinematic', nxMotionMood('Make it feel cinematic') === 'cinematic');
  check('"make it feel energetic" maps to energetic', nxMotionMood('make it feel energetic') === 'energetic');
  check('unknown mood falls back to smooth', nxMotionMood('totally random string') === 'smooth');
  const c = nxMotionCompose('cinematic');
  check('cinematic recipe is slow + staggered + parallax', c.speed > 0.8 && c.stagger >= 100 && c.parallax > 0.25);
  const e = nxMotionCompose('energetic', { speedOverride: undefined });
  check('energetic recipe is fast + spring', nxMotionCompose('energetic').easing === 'spring' && nxMotionCompose('energetic').speed < 0.7);
  check('compose overrides numeric opts', nxMotionCompose('cinematic', { speed: 0.2 }).speed === 0.2);
  const css = nxMotionToCss('cinematic');
  check('motion CSS has keyframes + enter/is-in', /@keyframes nx-ve/.test(css) && /nx-ve-enter/.test(css) && /\.is-in/.test(css));
  check('motion CSS includes reduced-motion', /prefers-reduced-motion/.test(css));
  const js = nxMotionToJs('cinematic');
  check('motion JS has IntersectionObserver + parallax', /IntersectionObserver/.test(js) && /prefers-reduced-motion/.test(js) && /translate3d/.test(js));
  check('motion JS guards reduced-motion first', js.indexOf('prefers-reduced-motion') < js.indexOf('IntersectionObserver'));
}

// ═══════════ 5. DESIGN EXPLORATION ═══════════
console.log('\n== 5. DESIGN EXPLORATION ==');
{
  const dirs = nxExplore('luxury premium law firm', 4);
  check('explore returns requested count', dirs.length === 4);
  check('explore returns distinct ids', new Set(dirs.map(d => d.id)).size === 4);
  check('explore sorts best-fit first for luxury', dirs[0].id === 'minimal-luxury', dirs[0].id);
  check('each direction has token set', dirs.every(d => d.brand && isHex(d.brand.primaryColor)));
  check('fit score bounded 20..100', nxDirectionFit('luxury', 'minimal-luxury') <= 100 && nxDirectionFit('x', 'minimal-luxury') >= 20);
  check('futuristic direction is motion-rich', NX_DIRECTIONS['futuristic-cinematic'].brand.motionStyle === 'futuristic');
}

// ═══════════ 6. DESIGN QA (judges beauty) ═══════════
console.log('\n== 6. DESIGN QA ==');
{
  const rich = `<!DOCTYPE html><html lang="en"><head><style>body{font-family:Inter,sans-serif;color:#17173a;background:#fff}h1{font-family:Sora;color:#0a1638}h2{font-family:Sora}.nx-card{border-radius:12px}.nx-sec{padding:3rem}</style></head><body><section class="nx-section"><h1>Headline</h1><h2>Sub</h2><div class="nx-grid" style="display:grid;grid-template-columns:repeat(3,1fr)"><div class="nx-card nx-ve-enter"><h3>A</h3></div><div class="nx-card nx-ve-enter"><h3>B</h3></div><div class="nx-card nx-ve-enter"><h3>C</h3></div></div></section><style>@keyframes nx-ve{from{opacity:0}to{opacity:1}}@media(prefers-reduced-motion:reduce){}</style></body></html>`;
  const qa = nxDesignQA(rich);
  check('design QA returns score + grade', typeof qa.score === 'number' && typeof qa.grade === 'string');
  check('design QA has all 8 aesthetic categories', ['composition', 'hierarchy', 'typography', 'spacing', 'balance', 'contrast', 'consistency', 'motion'].every(c => qa.categories[c]));
  check('rich site scores ≥70', qa.score >= 70, 'score=' + qa.score);
  const bare = nxDesignQA('<!DOCTYPE html><html><head><title>x</title></head><body><p>hello</p></body></html>');
  check('bare page scores much lower than rich', bare.score < 35, 'bare=' + bare.score);
  check('bare page flags missing h1 + contrast', bare.issues.some(i => /h1/.test(i.message)));
  check('high-contrast palette yields good contrast score', qa.categories.contrast.score >= 35);
  check('motion categories responds to animations', qa.categories.motion.score > 0);
}

// ═══════════ 7. BIDIRECTIONAL Project ◄─► Code ═══════════
console.log('\n== 7. BIDIRECTIONAL Project ◄─► Code ==');
{
  const p = nxProject({ name: 'SaaS', brand: { primaryColor: '#0a1638', motionStyle: 'energetic' } });
  nxProjectAddComponent(p, nxBuildComponent('hero', 'split', { headline: 'Ship faster', sub: 'A typed design graph.', cta: 'Try it' }, p.brand));
  nxProjectAddComponent(p, nxBuildComponent('features', 'grid', { heading: 'Features', items: [{ title: 'Graph', text: 'x' }, { title: 'Motion', text: 'y' }, { title: 'Tokens', text: 'z' }] }, p.brand));
  nxProjectAddComponent(p, nxBuildComponent('cta', 'centered', { heading: 'Start now', sub: 'Free', cta: 'Sign up' }, p.brand));
  nxProjectAddComponent(p, nxBuildComponent('nav', 'standard', { brand: 'SaaS', links: ['Home', 'Pricing'] }, p.brand));
  p.order = p.order.slice(-1).concat(p.order.slice(0, -1)); // nav first for demo ordering
  const rendered = nxProjectToCode(p);
  check('renderer produces a full doc', /<!DOCTYPE html>/.test(rendered.html) && /<\/html>/.test(rendered.html));
  check('renderer output has hero headline', /Ship faster/.test(rendered.html));
  check('renderer output has CSS tokens + motion css', /--nx-primary/.test(rendered.html) && /@keyframes nx-ve/.test(rendered.html));
  check('renderer output has motion js', /IntersectionObserver/.test(rendered.html));
  check('renderer output applies energetic motion', /nx-ve-enter/.test(rendered.html) && /is-in/.test(rendered.html));
  // round-trip back to a graph
  const p2 = nxCodeToProject(rendered.html);
  check('round-trip recovers brand primary hex', /^#[0-9a-f]{6}$/i.test(p2.brand.primaryColor || ''));
  check('round-trip recovers a hero', p2.order.some(id => p2.nodes[id].kind === 'hero'));
  check('round-trip recovers features cards', Object.values(p2.nodes).some(n => n.kind === 'features' && n.content.items && n.content.items.length >= 1));
  const qa2 = nxDesignQA(rendered.html);
  check('rendered site passes design QA ≥70', qa2.score >= 70, 'score=' + qa2.score);
}

// ═══════════ 8. FRONTEND: design core exposed + Design Studio UI ═══════════
console.log('\n== 8. FRONTEND: design exposed + Design Studio UI ==');
{
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { JSDOM } = require('jsdom');
  const fs = await import('node:fs');
  const html = fs.readFileSync(join(ROOT, 'NexusCRM_V4_Hardened.html'), 'utf-8');
  const dom = new JSDOM(html, { url: 'http://localhost:3000/', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.confirm = () => true; w.alert = () => {}; w.fetch = async () => { throw new TypeError('no net'); }; } });
  const w = dom.window, d = w.document;
  const errs = []; w.addEventListener('error', e => errs.push(e.message));
  await new Promise(r => setTimeout(r, 400));
  const reachable = (f) => { try { return w.eval('typeof ' + f) !== 'undefined'; } catch { return false; } };
  check('frontend exposes design core', ['nxDesignQA', 'nxExplore', 'nxProjectToCode', 'nxBuildComponent', 'nxTokensToCss', 'nxMotionCompose', 'NX_DIRECTIONS', 'NX_COMPONENTS'].every(reachable));
  check('frontend Design QA runnable', typeof w.nxDesignQA === 'function' && w.nxDesignQA('<h1>x</h1>').score >= 0);
  check('frontend Explore runnable', w.nxExplore('luxury', 3).length === 3);
  check('frontend renderer runnable', typeof w.nxProjectToCode === 'function');
  // Design Studio button + modal
  check('Design Studio helpers present', typeof w.openDesignStudio === 'function' && typeof w.dsExplore === 'function' && typeof w.dsPick === 'function' && typeof w.dsSave === 'function');
  check('cards include 🎨 Studio button', /openDesignStudio\(/.test(html));
  w.openDesignStudio(0, 'Test Site');
  await new Promise(r => setTimeout(r, 100));
  const modal = d.getElementById('modal-container')?.innerHTML || '';
  check('Design Studio modal renders title + brief input', /Design Studio/.test(modal) && /id="ds-brief"/.test(modal));
  check('Design Studio modal has explore button', /dsExplore\(\)/.test(modal));
  check('no frontend runtime errors from design injection', errs.length === 0, errs.join(' | '));
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
