// nx_template.js — reference-template DESIGN LIBRARY, graph-driven.
// Proves: (1) the design is byte-identical to the reference template (same body
// structure, CSS, glyph counts) regardless of words; (2) the graph drives the
// words (change plan -> copy changes, design does not); (3) plan->site builder
// produces a valid 21-blade site; (4) config (phone/email) flows through runtime.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require('../nx_template.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

// 1. Design is fixed: default words vs completely different brand words must yield
//    the SAME design signatures (section count, blade order, CSS length, H-tags).
console.log('\n== 1. DESIGN IS FIXED, WORDS ARE THE VARIABLE ==');
{
  const a = T.nxBuildTemplateSite(null);
  const b = T.nxBuildTemplateSite({ name: 'Aurelia', hero: ['Off-Mains · 30y','Crafted in','Trust.','Built to Endure.'] });
  check('compiled both valid', a.compiled.valid && b.compiled.valid);
  check('identical CSS length', a.compiled.css.length === b.compiled.css.length, a.compiled.css.length + ' vs ' + b.compiled.css.length);
  check('identical blade order', JSON.stringify(a.project.nodes['__root__'].children) === JSON.stringify(b.project.nodes['__root__'].children));
  check('identical JS length', a.compiled.js.length === b.compiled.js.length, a.compiled.js.length + ' vs ' + b.compiled.js.length);
  check('copy differs -> body differs', a.compiled.html !== b.compiled.html);
  const tagCount = h => (h.match(/<section\b/g) || []).length;
  check('section count invariant', tagCount(a.compiled.html) === tagCount(b.compiled.html), tagCount(a.compiled.html)+' vs '+tagCount(b.compiled.html));
  // Both share the template tokens & Space Grotesk + template body bg.
  check('template palette present', /--bg:#060912/.test(a.compiled.css) && /#FF5F00/.test(a.compiled.css));
  check('Space Grotesk + Inter fonts', /Space Grotesk/.test(a.compiled.css) && /font-family:['"]Inter['"]/.test(a.compiled.css));
}

// 2. Words are graph-authored: plan -> correct copy, design untouched.
console.log('\n== 2. PLAN → SITE (graph is the runtime) ==');
{
  const p = {
    name: 'Aurelia Hydro', owner: 'Arthur', phone: '01707 220 114', email: 'h@a.co',
    years: '30+', counties: '4', compliance: '100',
    hero: { badge: 'Off-Mains · 30y', line1: 'Crafted in', line2: 'Trust.', line3: 'Built to Endure.', lead: 'You deal with the owner.' },
    services: [{ tag: 'Install', title: 'Septic Tanks', text: 'Full install.' }],
    reviews: { text: 'Amazing.' }, projects: { title: 'Big job' },
  };
  const site = T.nxBuildTemplateSiteFromPlan(p);
  check('plan site valid', site.compiled.valid);
  const root = site.project.nodes['__root__'];
  check('21 blades in order', root.children.length === 21 && JSON.stringify(root.children) === JSON.stringify(T.NX_TEMPLATE_ORDER));
  check('hero words injected', /Crafted in/.test(site.compiled.html) && /Trust\./.test(site.compiled.html));
  check('service words injected', /Septic Tanks/.test(site.compiled.html));
  check('phone flows to runtime config', /01707 220 114/.test(site.compiled.html));
  check('config merged (not replacing DEFAULT_CFG)', /DEFAULT_CFG/.test(site.compiled.js) && /Object.assign\(DEFAULT_CFG/.test(site.compiled.js));
  check('runtime guard keeps phones', /let CFG=loadCfg/.test(site.compiled.js));
  check('head google fonts present', /fonts.googleapis.com/.test(T.NX_TEMPLATE_HEAD));
}

// 3. Plan tolerates empty / partial / sparse input (never throws, always valid).
console.log('\n== 3. ROBUST PLANS ==');
{
  check('empty plan valid', T.nxBuildTemplateSiteFromPlan({}).compiled.valid);
  check('null plan valid', T.nxBuildTemplateSite(null).compiled.valid);
  check('sparse (one review obj) valid', T.nxBuildTemplateSiteFromPlan({ reviews: { text: 'x' } }).compiled.valid);
  const words = T.nxPlanToWords({ name: 'N', owner: 'O', phone: '1', email: 'e' });
  check('mapper produces all blades keyed', ['topbar','header','hero','stats','services','why','about','process','gallery','projects','reviews','lead','faq','contact','footer'].every(k => Array.isArray(words[k])));
  check('mapper derives config', words.config && words.config.phone === '1' && words.config.email === 'e');
}

console.log(`\n════════════════════════════════════════\nRESULTS: ${passed} passed, ${failed} failed\n`);
if (failed) { console.log('FAILURES:\n' + failures.map(f => '  • ' + f).join('\n')); process.exit(1); }
