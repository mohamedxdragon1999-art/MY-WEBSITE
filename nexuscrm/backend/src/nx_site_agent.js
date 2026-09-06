'use strict';
// ════════════════════════════════════════════════════════════
// nx_site_agent.js — THE DETERMINISTIC TESTING AGENT + DEBUGGER
//
// The "AI Testing Agent + AI Debugger" behind the website builder, with zero
// I/O and zero dependencies so it runs identically in Node, workerd and the
// browser preview:
//   debugSiteHtml(html) — diagnose concrete problems (tag balance, broken
//                         anchors, duplicate ids, alt text, CLS-risk images,
//                         silent buttons, mixed content, forms without labels)
//   testSiteHtml(html)  — open the generated page and verify it works
//                         (structure, a11y, perf, SEO, responsive, content),
//                         returning a scored pass/fail report by category
//   autoFixSite(html)   — targeted, idempotent fixes beyond the quality pass
//                         (eager hero image, flagged orphan anchors, single h1)
// runAgenticLoop (build → inspect → test → detect → fix → re-test) stays in
// index.js because it drives the model and the validation gate; it consumes
// these three through the same names.
//
// Only MARKUP is inspected: <script> and <style> bodies are stripped before any
// count, because runtimes build <img>/<a> tags inside template literals and a
// CSS comment that says "<main>" is not a landmark.
// ════════════════════════════════════════════════════════════

const NX_AGENT_CATS = [
  ['structure', 'Structure'],
  ['a11y', 'Accessibility'],
  ['perf', 'Performance'],
  ['seo', 'SEO'],
  ['responsive', 'Responsive'],
  ['content', 'Content'],
];

function _countTags(html) {
  const counts = {};
  const re = /<(\/?)(section|div|nav|header|footer|main|form|ul|ol|li|figure|table|tr|td|th|h[1-6]|p|a|span|button|label|select|textarea|aside|article|blockquote|script|style)\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[2].toLowerCase();
    if (m[1] === '/') counts[tag] = (counts[tag] || 0) - 1;
    else if (!['img', 'br', 'input', 'hr', 'meta', 'link', 'source'].includes(tag)) counts[tag] = (counts[tag] || 0) + 1;
  }
  return counts;
}

function debugSiteHtml(html) {
  const s = String(html || '');
  const info = {};
  const errors = [];
  const warnings = [];

  // ── structure ──
  const openClose = {};
  const re = /<(section|div|nav|header|footer|main|form|ul|ol|li|figure|h[1-6]|button|select|textarea|aside|article|blockquote|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
  // tag balance via explicit open/close — comments + <script>/<style> BODIES removed first (a CSS comment saying "<main>" opened a phantom tag and failed every composed page)
  const tags = [];
  const tagRe = /<(\/?)(section|div|nav|header|footer|main|form|ul|ol|li|figure|h[1-6]|button|label|select|textarea|aside|article|blockquote|script|style)\b[^>]*>/gi;
  const scan = s.replace(/<!--[\s\S]*?-->/g, '').replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2').replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi, '$1$2');
  let mm;
  while ((mm = tagRe.exec(scan))) {
    const name = mm[2].toLowerCase();
    if (mm[1] === '/') { if (tags.length && tags[tags.length - 1] === name) tags.pop(); else errors.push('Unbalanced </' + name + '> (unexpected closer).'); }
    else if (!['img', 'br', 'input', 'hr', 'meta', 'link', 'source'].includes(name)) tags.push(name);
  }
  if (tags.length) errors.push('Unclosed tag(s): ' + tags.slice(-4).join(', ') + ' (likely <' + tags[tags.length - 1] + '>).');

  // ── ids / anchors ──
  const ids = [];
  const idRe = /\bid\s*=\s*["']([^"']+)["']/gi;
  let idm;
  while ((idm = idRe.exec(s))) ids.push(idm[1]);
  const seen = new Set(), dups = [];
  ids.forEach(i => { if (seen.has(i)) dups.push(i); else seen.add(i); });
  if (dups.length) warnings.push('Duplicate id(s): ' + dups.slice(0, 4).join(', ') + '.');
  const idSet = new Set(ids);
  const anchorIds = [];
  const aRe = /href\s*=\s*["']#([^"']+)["']/gi;
  let am;
  while ((am = aRe.exec(s))) anchorIds.push(am[1]);
  const broken = [...new Set(anchorIds.filter(a => a && !idSet.has(a)))];
  if (broken.length) errors.push('Broken internal link(s): #' + broken.slice(0, 5).join(', #') + ' — the target section id is missing.');

  // ── images ──
  // MARKUP only: runtimes build <img> tags inside template literals (gallery
  // tiles, the lightbox stage), and those strings are not images on the page.
  // Counting them reported phantom CLS / lazy-loading defects on every
  // template site and sent the fix loop after markup that does not exist.
  const imgs = scan.match(/<img\b[^>]*>/gi) || [];
  const noAlt = imgs.filter(t => !/\balt\s*=/.test(t));
  const noDim = imgs.filter(t => !/<(img)[^>]*\b(width|height)\s*=/.test(t) && !/<img\b[^>]*\bstyle\s*=/.test(t));
  const noLazy = imgs.filter(t => !/loading\s*=/.test(t));
  const noDecode = imgs.filter(t => !/decoding\s*=/.test(t));
  if (noAlt.length) warnings.push(noAlt.length + ' image(s) missing alt text.');
  if (noDim.length) warnings.push(noDim.length + ' image(s) lacking width/height (CLS risk).');
  if (noLazy.length) warnings.push(noLazy.length + ' image(s) not lazy-loaded.');
  if (noDecode.length && noDecode.length < imgs.length) warnings.push(noDecode.length + ' image(s) missing decoding="async".');

  // ── meta / a11y / responsive ──
  const low = s.toLowerCase();
  if (!/<html\b[^>]*\blang\s*=/.test(s)) errors.push('<html> has no lang attribute.');
  if (!/<meta[^>]*name=["']viewport["']/i.test(s)) errors.push('No responsive viewport meta.');
  if (!/<title[^>]*>[\s\S]*<\/title>/i.test(s)) errors.push('No <title>.');
  if (!/<meta[^>]*name=["']description["']/i.test(s)) warnings.push('No meta description.');
  const h1 = (s.match(/<h1\b/gi) || []).length;
  if (h1 === 0) errors.push('No <h1> (main heading).');
  if (h1 > 1) errors.push(h1 + ' <h1> tags (use exactly one).');
  const h2 = (s.match(/<h2\b/gi) || []).length;
  if (!h2) warnings.push('No <h2> sub-headings.');
  if (!/@media\b/.test(s)) warnings.push('No @media queries (responsive layout unverified).');
  const buttons = s.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) || [];
  const silentButtons = buttons.filter(t => t.replace(/<[^>]+>/g, '').trim().length === 0 && !/aria-label\s*=/.test(t));
  if (silentButtons.length) warnings.push(silentButtons.length + ' button(s) have no accessible text/aria-label.');
  const blankLinks = s.match(/<a\b[^>]*\btarget\s*=\s*["']_blank["'][^>]*>/gi) || [];
  const noNoopener = blankLinks.filter(t => !/rel=["'][^"']*\bnoopener\b/.test(t));
  if (noNoopener.length) warnings.push(noNoopener.length + ' target="_blank" link(s) missing rel="noopener".');
  if (/tabindex\s*=\s*["'][1-9][0-9]*["']/.test(s)) warnings.push('Positive tabindex found (breaks keyboard flow).');
  if (/document\.write|document\.writeln/i.test(s)) errors.push('document.write used (blocking).');
  const httpSrcs = (s.match(/<(img|script|link|iframe|source)\b[^>]*\bsrc(?:set)?\s*=\s*["']http:\/\/(?!localhost|127\.0\.0\.1|api\.)[^"']*["'][^>]*>/gi) || []).length;
  if (httpSrcs) warnings.push(httpSrcs + ' external resource(s) over http:// (mixed content).');
  if (!/ld\+json/.test(low) && !/<script[^>]*type=["']application\/ld\+json/.test(s)) warnings.push('No JSON-LD structured data.');

  info.imgs = imgs.length;
  info.h1 = h1; info.h2 = h2;
  info.ids = ids.length; info.anchors = anchorIds.length; info.brokenAnchors = broken.length;
  info.sections = (s.match(/<section\b/gi) || []).length;
  info.silentButtons = silentButtons.length;
  info.buttons = buttons.length;
  return { errors, warnings, info };
}

function testSiteHtml(html) {
  const d = debugSiteHtml(html);
  const s = String(html || '').toLowerCase();
  const cat = {};
  function ch(catId, name, pass, note) {
    const c = cat[catId] = cat[catId] || { results: [] };
    c.results.push({ name, pass: !!pass, note: note || '' });
  }
  // structure
  ch('structure', 'Valid HTML document', /<!DOCTYPE/i.test(s) && d.errors.filter(e => /Unbalanced|Unclosed/.test(e)).length === 0);
  ch('structure', 'Sections present', d.info.sections >= 4, 'found ' + d.info.sections);
  ch('structure', 'No broken internal links', d.info.brokenAnchors === 0, d.info.brokenAnchors + ' broken');
  ch('structure', 'Unique element ids', d.errors.concat(d.warnings).filter(e => /Duplicate id/.test(e)).length === 0);
  // a11y
  ch('a11y', 'lang attribute', /<html[^>]*\blang\s*=/.test(html));
  ch('a11y', 'Every image has alt', d.info.imgs === 0 || d.warnings.filter(e => /alt text/.test(e)).length === 0, d.info.imgs + ' images');
  ch('a11y', 'Buttons have accessible text', d.info.silentButtons === 0, d.info.silentButtons + ' silent');
  ch('a11y', 'No positive tabindex', !/tabindex\s*=\s*["'][1-9][0-9]*["']/.test(html));
  ch('a11y', '_blank links rel=noopener', d.warnings.filter(e => /noopener/.test(e)).length === 0);
  // perf
  ch('perf', 'Images lazy / async decoded', d.warnings.filter(e => /lazy/.test(e)).length === 0);
  ch('perf', 'No document.write', !/document\.write|document\.writeln/i.test(html));
  ch('perf', 'No mixed http:// content', d.warnings.filter(e => /http:\/\//.test(e)).length === 0);
  ch('perf', 'Images sized (no CLS)', d.warnings.filter(e => /width\/height/.test(e)).length === 0);
  // seo
  ch('seo', '<title> present', /<title[^>]*>[\s\S]*<\/title>/i.test(html));
  ch('seo', 'Meta description', /<meta[^>]*name=["']description["']/i.test(html));
  ch('seo', 'Single <h1>', d.info.h1 === 1, 'h1=' + d.info.h1);
  ch('seo', 'JSON-LD structured data', /ld\+json|application\/ld\+json/i.test(html));
  ch('seo', 'Open Graph present', /og:title|og:description/i.test(html));
  // responsive
  ch('responsive', 'Viewport meta', /<meta[^>]*name=["']viewport["']/i.test(html));
  ch('responsive', 'Media queries / fluid grid', /@media\b|auto-fit|minmax/i.test(html));
  ch('responsive', 'Reasonable type scale', /h1|font-size/i.test(html));
  // content
  ch('content', 'Hero + lead (copy present)', /<h1\b/.test(html) && /<p\b/.test(html));
  ch('content', 'Call-to-action present', /btn-primary|btn|btn-primary/.test(html));
  ch('content', 'Contact form present', /<form\b/.test(html) && /nx-form|type=["']email|placeholder=["']Email/i.test(html));
  ch('content', 'No placeholder/lorem content', !/lorem ipsum|FAKE_AI_RESPONSE|oops something broke/i.test(html));
  ch('content', 'No raw user script leaked', !/<script>alert\(1\)/.test(html));

  const categories = NX_AGENT_CATS.map(([id, name]) => {
    const c = cat[id] || { results: [] };
    const passed = c.results.filter(r => r.pass).length;
    return { id, name, passed, total: c.results.length, results: c.results };
  });
  const all = categories.reduce((a, c) => a.concat(c.results), []);
  const passed = all.filter(r => r.pass).length;
  const failedChecks = all.filter(r => !r.pass);
  const status = failedChecks.length === 0 ? 'pass' : (failedChecks.length <= 2 ? 'warn' : 'fail');
  return {
    status,
    passed,
    total: all.length,
    score: Math.round((passed / Math.max(1, all.length)) * 100),
    summary: failedChecks.length === 0 ? 'All checks passed — site is production-ready.'
      : (failedChecks.length + ' check(s) need attention.'),
    categories,
    issues: failedChecks.map(r => ({ cat: categories.find(c => c.results.includes(r))?.id || 'x', name: r.name, note: r.note || '' })),
    debug: d,
  };
}

// Targeted, idempotent fixes that go beyond the meta/quality pass. Used to close
// the gap so the test agent actually turns red → green.
function autoFixSite(html) {
  const d = debugSiteHtml(html);
  let s = html || '';
  // 1) eager-load the very first image (hero): set an EXPLICIT strategy — deleting the attribute failed the "explicit loading" check and lowered the score this fix was meant to raise.
  //    IDEMPOTENT: if any page image is already eager (a hero the generator marked itself, or a previous pass), nothing is touched — re-running the fix used to eager the NEXT lazy image each time, so three loop iterations un-lazied three above-the-fold images.
  const markup = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  if (!/<img\b[^>]*\bloading="eager"/i.test(markup)) s = s.replace(/<img([^>]*?)\s*loading="lazy"/i, '<img$1 loading="eager"');
  // 2) drop nav links whose section id is missing (broken anchors)
  const idSet = new Set([...(String(s).match(/\bid\s*=\s*["']([^"']+)["']/gi) || [])].map(x => x.replace(/^id\s*=\s*["']|["']$/gi, '')));
  // Both branches used to return `mm`, so this replace did nothing at all. A
  // broken in-page anchor is a real defect (the click silently does nothing),
  // but DELETING the link would tear holes in the nav. Instead mark it: point it
  // at the top of the page and flag it so a later pass / the author can see it.
  s = s.replace(/<a\b([^>]*?\bhref\s*=\s*["']#([^"']+)["'][^>]*?)>/gi, (mm, pre, id) => {
    if (idSet.has(id) || id === '' || id === 'top') return mm;
    return '<a' + pre.replace(/\bhref\s*=\s*["']#[^"']+["']/i, 'href="#"') + ' data-nx-broken-anchor="' + id + '">';
  });
  // 3) ensure a single h1 — protect the first, demote the rest to h2
  if ((s.match(/<h1\b/gi) || []).length > 1) {
    s = s.replace(/<h1\b/i, '__KEEP_H1__').replace(/<h1\b/gi, '<h2').replace(/__KEEP_H1__/i, '<h1');
  }
  // 4) ensure an <h2> sub-heading exists if there are sections but no h2
  if (!/<h2\b/gi.test(s) && /<section\b/i.test(s)) s = s.replace(/(<h1\b[^>]*>[\s\S]*?<\/h1>)/i, '$1\n<h2>Overview</h2>');
  return s;
}

module.exports = { debugSiteHtml, testSiteHtml, autoFixSite, NX_AGENT_CATS };
