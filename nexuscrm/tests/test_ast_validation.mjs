// AST STRUCTURAL VALIDATION + SELF-CORRECTION.
//
// Generated HTML previously reached the preview and the published page with no
// structural verification at all. A browser silently "repairs" an unclosed <div>
// or a <div> inside a <p> — its repair changes the rendered layout, so the user
// sees a broken design with no error anywhere.
//
// Gate design:
//   * nxAstSyntaxGate — FAST + blocking: structure only, runs on every build.
//   * nxAstDeepAudit  — heavier: semantics/a11y, page vs fragment aware.
//   * nxAstAutoClose  — deterministic repair, must never lose content.
//   * nxAstDiagnosticPrompt — turns failures into an actionable LLM correction.
//
// Run: node tests/test_ast_validation.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ast = require('../backend/src/nx_ast.js');
const nx = require('../backend/src/nx_compose.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

const BROKEN = {
  'unclosed div': '<!DOCTYPE html><html><body><div><p>hi</p></body></html>',
  'unclosed main+section': '<!DOCTYPE html><html><body><main><section><h1>T</h1></body></html>',
  'stray closing tag': '<!DOCTYPE html><html><body></div><p>x</p></body></html>',
  'flow inside <p>': '<!DOCTYPE html><html><body><p><div>bad</div></p></body></html>',
  'flow inside heading': '<!DOCTYPE html><html><body><h1><section>x</section></h1></body></html>',
  'unterminated <style>': '<!DOCTYPE html><html><head><style>body{color:red}</head><body><p>x</p></body></html>',
};
const VALID = {
  'clean document': '<!DOCTYPE html><html lang="en"><head><title>t</title></head><body><main><h1>Hi</h1><p>ok</p></main></body></html>',
  'inline inside <p>': '<!DOCTYPE html><html><body><p>text <strong>b</strong> <em>i</em> <a href="#">l</a></p></body></html>',
  // <a> is a TRANSPARENT content model in HTML5 — wrapping a figure in a link is
  // valid and is the normal way to make a whole card clickable.
  'figure inside <a>': '<!DOCTYPE html><html><body><a href="#"><figure><img src="x" alt="y"></figure></a></body></html>',
  'nested flow containers': '<!DOCTYPE html><html><body><div><section><div><p>deep</p></div></section></div></body></html>',
};

console.log('\n== A. The blocking gate catches real structural breakage ==');
{
  const missed = [];
  for (const [label, html] of Object.entries(BROKEN)) if (ast.nxAstSyntaxGate(html).ok) missed.push(label);
  check('every malformed document is rejected', missed.length === 0, missed.join(' | '));
}

console.log('\n== B. …without false positives on valid HTML ==');
{
  const wrong = [];
  for (const [label, html] of Object.entries(VALID)) {
    const g = ast.nxAstSyntaxGate(html);
    if (!g.ok) wrong.push(`${label}: ${g.errors[0]}`);
  }
  check('valid documents pass cleanly', wrong.length === 0, wrong.join(' | '));
}

console.log('\n== C. Auto-repair fixes structure and never loses content ==');
{
  const bad = [];
  for (const [label, html] of Object.entries(BROKEN)) {
    const rep = ast.nxAstAutoClose(html);
    const after = ast.nxAstSyntaxGate(rep.html);
    if (after.errors.length >= ast.nxAstSyntaxGate(html).errors.length) bad.push(`${label}: not improved`);
  }
  check('repair strictly reduces structural errors', bad.length === 0, bad.join(' | '));

  const src = '<!DOCTYPE html><html><head><title>T</title></head><body><main><section class="hero"><h1>Title</h1><p>Copy<div class="card">card</div></section></body></html>';
  const rep = ast.nxAstAutoClose(src);
  check('repaired output keeps all visible content', ['Title', 'Copy', 'card', 'hero'].every(t => rep.html.includes(t)));
  check('a valid document is left untouched', ast.nxAstAutoClose(VALID['clean document']).changed === false);
}

console.log('\n== D. Deep audit is page-aware vs fragment-aware ==');
{
  const dup = ast.nxAstDeepAudit('<!DOCTYPE html><html><body><div id="a"></div><div id="a"></div></body></html>');
  check('duplicate ids are detected', dup.issues.some(i => /duplicate id/.test(i)), dup.issues.join(','));
  const noalt = ast.nxAstDeepAudit('<!DOCTYPE html><html><body><img src="x"></body></html>');
  check('images without alt are detected', noalt.issues.some(i => /alt text/.test(i)));
  const twoH1 = ast.nxAstDeepAudit('<!DOCTYPE html><html><body><h1>a</h1><h1>b</h1></body></html>');
  check('multiple <h1> is a page-level error', twoH1.issues.some(i => /<h1>/.test(i)));
  // The same rule must NOT fire against a single section subtree.
  const frag = ast.nxAstDeepAudit('<!DOCTYPE html><html><body><h2>b</h2><p>x</p></body></html>', { fragment: true });
  check('page-only rules are suppressed for fragments', !frag.issues.some(i => /no <h1>/.test(i)), frag.issues.join(','));
}

console.log('\n== E. Per-node validation attributes faults to one addressable node ==');
{
  const res = ast.nxAstValidateSections('<!DOCTYPE html><html><body><section id="hero"><img src="a"><h1>A</h1></section><section id="feat"><h2>B</h2><p>ok</p></section></body></html>');
  check('each addressable section is reported separately', res.length === 2, JSON.stringify(res.map(r => r.node)));
  const hero = res.find(r => r.node === 'hero'), feat = res.find(r => r.node === 'feat');
  check('the faulty node is the one flagged', hero && !hero.ok && hero.issues.some(i => /alt text/.test(i)));
  check('the healthy node is not flagged', feat && feat.ok, feat && feat.issues.join(','));
}

console.log('\n== F. Failures become an actionable correction prompt ==');
{
  const p = ast.nxAstDiagnosticPrompt('<!DOCTYPE html><html><body><div><p><div>x</div></body></html>');
  check('a diagnostic prompt is produced for broken input', !!p && p.length > 40);
  check('the prompt enumerates the specific faults', /unclosed <div>/.test(p) && /invalid nesting/.test(p));
  check('the prompt instructs minimal change', /change only what is required/i.test(p));
  check('valid input yields no prompt', ast.nxAstDiagnosticPrompt(VALID['clean document']) === null);
}

console.log('\n== G. The composition engine\'s own output is structurally sound ==');
{
  const PLAN = {
    site_name: 'Atelier North', hero_headline: 'Objects of permanence', hero_sub: 'A studio.',
    services: [{ title: 'Furniture', desc: 'x' }, { title: 'Lighting', desc: 'y' }, { title: 'Textiles', desc: 'z' }],
    projects: [{ title: 'Halcyon', cat: 'Residential' }], reviews: [{ text: 'Superb.', name: 'E', role: 'Owner' }],
    stats: [{ value: 12, label: 'Years' }], faqs: [{ q: 'Lead time?', a: 'Six weeks.' }], contact: { email: 'h@x.co' },
  };
  const bad = [];
  for (const d of Object.keys(nx.NX_COMPOSE_DIRECTIONS)) {
    const html = nx.nxCompose(PLAN, { direction: d }).html;
    const g = ast.nxAstSyntaxGate(html), deep = ast.nxAstDeepAudit(html);
    if (!g.ok) bad.push(`${d} syntax: ${g.errors[0]}`);
    if (!deep.ok) bad.push(`${d} deep: ${deep.issues[0]}`);
  }
  check('every direction emits structurally valid, accessible HTML', bad.length === 0, bad.slice(0, 4).join(' | '));
}

const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
