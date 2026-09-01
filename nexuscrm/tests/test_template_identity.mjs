// REFERENCE-TEMPLATE IDENTITY BOUNDARY + SHIPPED-SECRET AUDIT.
//
// nx_template.js is a real, finished, high-quality site design kept as a default
// style. It was authored for an actual business, and that business's identity —
// name, owner, phone, email, postal address and industry copy — was baked into
// shared engine code. Rendering the template for anyone else emitted a real
// company's contact details into a stranger's website.
//
// The DESIGN is meant to pass through. The IDENTITY must not.
//
// Run: node tests/test_template_identity.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const id = require('../backend/src/nx_identity.js');
const tpl = require('../nx_template.js');
const nx = require('../backend/src/nx_compose.js');
const agent = require('../nx_agent.js');

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
// A business with nothing in common with the reference client.
const OTHER = { business: 'Aurora Yoga Studio', owner: 'Ana Duarte', phone: '+351 912 345 678', email: 'hi@aurorayoga.pt', base: 'Rua Nova 12, Lisbon', coverage: 'Lisbon' };

console.log('\n== A. Rendering for another business leaks NO reference identity ==');
{
  const built = tpl.nxBuildTemplateSite(OTHER, {});
  const html = (built && (built.compiled?.html || built.html)) || '';
  check('the template still renders a substantial page', html.length > 50000, String(html.length));
  const leaks = id.nxIdentityLeaks(html);
  check('no reference business identity survives', leaks.length === 0, leaks.slice(0, 8).join(', '));

  const proj = tpl.nxTemplateProject(OTHER);
  check('the project name is never the reference client', !/R\.?\s?C\.?\s?Atkin/i.test(String(proj.name)), String(proj.name));

  const doc = tpl.nxRenderTemplateDocument(proj, {});
  check('the rendered document is clean too', id.nxIdentityLeaks(doc.html || '').length === 0,
    id.nxIdentityLeaks(doc.html || '').slice(0, 6).join(', '));
  // The caller's OWN details must actually appear — scrubbing must substitute,
  // not merely delete, or the template would render an anonymous page.
  check('the caller\'s real details are substituted in', html.includes('Aurora Yoga Studio'));
}

console.log('\n== B. Substitution is exhaustive across formats ==');
{
  const src = "Call R C Atkin on 07721 511814 or 07721511814, email info@rcatkincontractor.co.uk. "
    + "Owner Martin, at Spa House, Copmere End, Eccleshall, Stafford, Staffordshire, ST21 6HH. "
    + "Link: tel:+447721511814 and maps: Spa+House+Copmere+End";
  const out = id.nxScrubIdentity(src, OTHER);
  check('all identity formats are replaced (spaced, packed, tel:, URL-encoded)', id.nxIdentityLeaks(out).length === 0,
    id.nxIdentityLeaks(out).join(', '));
  check('substitution inserts the new identity', out.includes('Aurora Yoga Studio') && out.includes('hi@aurorayoga.pt'));
  // Deep-scrub must reach nested config/knowledge-base structures.
  const deep = id.nxScrubDeep({ a: ['R C Atkin', { b: 'info@rcatkincontractor.co.uk' }] }, OTHER);
  check('nested structures are scrubbed', id.nxIdentityLeaks(JSON.stringify(deep)).length === 0);
}

console.log('\n== C. No unlock secret is shipped in the bundle ==');
{
  // The dev panel used plaintext passcodes as string literals in the browser
  // bundle; anyone could view-source, open the panel and use its reveal toggle
  // to read the owner's stored AI provider API key.
  const script = String(tpl.NX_TEMPLATE_SCRIPT || '');
  check('the runtime script still compiles', (() => { try { new Function(script); return true; } catch (e) { return false; } })());
  check('no plaintext unlock passcodes are shipped', !/'AIAPIKEY'|'MARTIN'|"AIAPIKEY"|"MARTIN"/.test(script));
  check('unlock is gated on a hashed, owner-set passphrase', /nx-devpanel-v1/.test(script) && /SHA-256/.test(script));
  check('the panel fails CLOSED when no passphrase is configured', /Developer panel is disabled/.test(script));
}

console.log('\n== D. autoFixSite\'s broken-anchor pass actually does something ==');
{
  // Both ternary branches returned the input unchanged, so this fix was dead code.
  const html = '<!DOCTYPE html><html><body><nav><a href="#real">Good</a><a href="#ghost">Broken</a></nav><section id="real">x</section></body></html>';
  const out = agent.autoFixSite(html);
  check('a valid in-page anchor is preserved', /href="#real"/.test(out));
  check('a broken anchor is neutralised', !/href="#ghost"/.test(out));
  check('the broken anchor is flagged for review', /data-nx-broken-anchor="ghost"/.test(out));
}

console.log('\n== E. One escaping guarantee across both generators ==');
{
  // nx_render.js had a stricter attribute-safe escape than nx_compose.js. Not
  // exploitable while every attribute is double-quoted, but it is exactly the
  // drift that becomes an XSS bug when a snippet is copied between files.
  const html = nx.nxCompose({ site_name: "O'Brien & Sons", hero_headline: "It's <b>bold</b>", contact: { email: 'a@x.co' } }, { direction: 'luxury-art' }).html;
  check('apostrophes are escaped by the compose pipeline', html.includes('&#39;'));
  check('angle brackets are still escaped', !/<b>bold<\/b>/.test(html) && html.includes('&lt;b&gt;'));
  check('ampersands are escaped', html.includes('&amp;'));
}

const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
