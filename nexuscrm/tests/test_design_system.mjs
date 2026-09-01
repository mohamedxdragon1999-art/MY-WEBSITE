// NexusCRM — DESIGN QUALITY FOUNDATION (Cycle 1).
// Proves the system thinks like a designer, not a template: persistent strategy,
// genuinely-different creative directions, a maturity model, and a Design-QA +
// Critic + Patch loop that DETECTS, EXPLAINS and FIXES a deliberately-bad design.
//
// Run: node tests/test_design_system.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('./d1mock.js'); // ensure sql.js is resolvable for tests that need it
await import(new URL('../backend/src/index.js', import.meta.url).pathname);
const ir = globalThis.__NX_IR;

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

// Build a standard multi-section project for the QA loop.
function buildProject(name, brief) {
  const p = ir.nxNewProject({ name, brief: brief || { visualStyle: 'modern-clean', tone: 'professional', density: 'balanced' } });
  ['nav', 'hero', 'features', 'pricing', 'testimonials', 'cta', 'footer', 'section', 'section', 'section'].forEach((fam, i) =>
    ir.nxSeedNode(p, { semanticRole: fam === 'section' ? 'section' : fam, id: 'n' + i, component: { family: fam, variant: 'default' } }));
  return p;
}
function setAllSizes(p, sz) { Object.values(p.nodes).forEach(n => { n.styles = Object.assign({}, n.styles, { fontSize: sz }); }); return p; }

console.log('\n== 1. PERSISTENT DESIGN STRATEGY ==');
{
  const s = ir.nxDesignStrategy({ visualStyle: 'luxury', tone: 'luxurious', motionMood: 'minimal', density: 'airy' });
  check('strategy has all fields', ['visualConcept', 'designPersonality', 'compositionStrategy', 'hierarchyStrategy', 'densityStrategy', 'typographyStrategy', 'colorStrategy', 'motionStrategy', 'spacingStrategy', 'conversionStrategy'].every(k => typeof s[k] === 'string' && s[k].length > 0));
  check('luxury brief → refined concept/personality', /luxur|refined|premium/i.test(s.visualConcept) && /luxur|refined|premium/i.test(s.designPersonality), s.visualConcept + '/' + s.designPersonality);
  check('density responds to brief', s.densityStrategy === 'Airy');
  check('never uses "make it beautiful" as a strategy', !/beautiful|make it look nice/i.test(JSON.stringify(s)));
}

console.log('\n== 2. CREATIVE DIRECTIONS DIFFER (not color variants) ==');
{
  const dirs = ir.nxDesignDirections({ visualStyle: 'luxury', tone: 'luxurious', industry: 'fashion' });
  check('returns 5 directions', dirs.length === 5);
  check('directions have distinct ids', new Set(dirs.map(d => d.id)).size === dirs.length);
  const comps = new Set(dirs.map(d => d.composition));
  const types = new Set(dirs.map(d => d.type));
  const motions = new Set(dirs.map(d => d.motion));
  check('compositions genuinely vary', comps.size >= 4, 'compositions=' + comps.size);
  check('typography systems vary', types.size >= 4, 'types=' + types.size);
  check('motion languages vary', motions.size >= 4, 'motions=' + motions.size);
  check('sections differ per direction', new Set(dirs.map(d => d.sections.join(','))).size >= 4);
  check('luxury brief ranks luxury direction first', dirs[0].id === 'luxury-art', dirs.map(d => d.id + '(' + d.fit.score + ')').join(','));
  check('each direction carries a derived strategy + maturity', dirs.every(d => d.strategy && d.maturity && d.maturity.level >= 2));
}

console.log('\n== 3. MATURITY MODEL ==');
{
  const min = ir.nxDesignMaturity(ir.nxDesignStrategy({ visualStyle: 'minimal', tone: 'calm' }));
  const lux = ir.nxDesignMaturity(ir.nxDesignStrategy({ visualStyle: 'luxury', tone: 'luxurious', motionMood: 'cinematic' }));
  check('maturity returns level + label', typeof min.level === 'number' && /template-like|coherent|polished|art-directed|exceptional/.test(min.label));
  check('rich luxury brief ≥ art-directed (4), never template-like', lux.level >= 4, 'lux level=' + lux.level + ' ' + lux.label);
  check('minimal brief is finer-grained (polished or lower)', min.level <= 4, 'min level=' + min.level + ' ' + min.label);
}

console.log('\n== 4. DESIGN QA DETECTS A BAD DESIGN ==');
{
  const good = buildProject('good');
  const bad = setAllSizes(buildProject('bad'), '120px'); // oversized everywhere, no hierarchy
  const gqa = ir.nxDesignQAProject(good);
  const bqa = ir.nxDesignQAProject(bad);
  check('bad design flagged allOversized', bqa.designDiagnostics.allOversized === true);
  check('bad typography score << good', bqa.designDiagnostics.typography < gqa.designDiagnostics.typography, bqa.designDiagnostics.typography + ' vs ' + gqa.designDiagnostics.typography);
  check('bad hierarchy score << good', bqa.designDiagnostics.hierarchy < gqa.designDiagnostics.hierarchy);
  check('bad genericness > good', bqa.designDiagnostics.genericness > gqa.designDiagnostics.genericness);
}

console.log('\n== 5. CRITIC EXPLAINS THE PROBLEM ==');
{
  const bad = setAllSizes(buildProject('bad'), '120px');
  const crit = ir.nxCritic(bad);
  check('critic produces an actionable typography problem', crit.problems.some(p => p.category === 'typography' && p.severity >= 4 && p.message.length > 10));
  check('critic explains why (message is a reason, not a label)', crit.problems.some(p => /hierarchy|subordinate|dominant/i.test(p.message)));
}

console.log('\n== 6. QA LAB IMPROVES A BAD DESIGN, LEAVES A GOOD ONE ==');
{
  const bad = setAllSizes(buildProject('bad'), '120px');
  const lab = ir.nxDesignQALab(bad, { iterations: 4 });
  check('lab improves design-quality composite', lab.improved.quality > 0, lab.start.composite + '→' + lab.after.composite);
  check('lab reduces genericness', lab.improved.genericness > 0, 'genΔ=' + lab.improved.genericness);
  check('lab improves typography + hierarchy', lab.improved.typography >= 0 && lab.improved.hierarchy >= 0);
  const good = buildProject('good');
  const labGood = ir.nxDesignQALab(good, { iterations: 3 });
  check('good design is NOT degraded by the loop', labGood.improved.quality >= 0, labGood.start.composite + '→' + labGood.after.composite);
}

console.log('\n== 7. SCALES + QA COMPOSITE PRESENT ==');
{
  check('type scale is coherent', ir.NX_SCALES.typeScale.ratio >= 1 && ir.NX_SCALES.typeScale.hero > ir.NX_SCALES.typeScale.base);
  check('spacing rhythm is a coherent scale', Array.isArray(ir.NX_SCALES.spacing.rhythm) && ir.NX_SCALES.spacing.rhythm.length >= 5);
  const q = ir.nxDesignQuality(buildProject('good'));
  check('composite score is 0..100 with aggregate+design', typeof q.composite === 'number' && q.composite >= 0 && q.composite <= 100 && typeof q.design === 'number');
}

console.log(`\n═══ RESULTS: ${passed} passed, ${failed} failed ═══`);
if (failed) { console.log('FAILURES:\n' + failures.map(f => '  • ' + f).join('\n')); process.exit(1); }
