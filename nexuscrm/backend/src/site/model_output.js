// ═════════════════════════════════════════════════════════════════════════
// site/model_output.js — what the model SENT vs what the page may USE.
//
// Models are told "return ONLY the body markup" and still, in the wild, send:
//   • a ```html fence around the markup (very common on instruct models)
//   • a sentence before/after ("Here is the website you asked for:")
//   • a whole document (<!DOCTYPE html><html><head><title>…<style>…</style>
//     </head><body>…</body></html>) — the head then leaks into the page body
//   • a <think>…</think> block (reasoning models when the adapter did not split)
//   • an output cut by max_tokens: an unterminated tag, a missing </section>,
//     a page with no contact form and no footer
//   • an apology / refusal instead of markup
//
// This module turns that into an honest verdict the builder can act on:
//   nxNormalizeModelBody(raw)  → { html, notes[] }   markup only, fences/prose/
//                                                    document chrome stripped
//   nxAssessModelBody(html, ctx) → { ok, usable, reasons[], score, sections,
//                                    missing[], truncated }
//   nxModelBodyVerdict(raw, ctx) → both, plus `action`: 'use' | 'retry' | 'fallback'
//
// Pure, dependency-free, deterministic. No DOM. Safe for the worker and tests.
// ═════════════════════════════════════════════════════════════════════════

const FENCE_RE = /```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)```/g;
const PROSE_LEAD_RE = /^(?:(?:sure|certainly|of course|here(?:'s| is| you go)|below is|okay|ok)[^<\n]{0,160}\n+)+/i;
const PROSE_TAIL_RE = /(?:\n+(?:let me know|feel free|i hope|this (?:page|site|website|design)|note:|notes?:|you can|if you (?:need|want|would)|hope this)[^<]{0,400})$/i;

/** Strip fences, leading/trailing prose, <think> blocks and document chrome. */
export function nxNormalizeModelBody(raw) {
  const notes = [];
  let s = String(raw == null ? '' : raw);
  if (!s.trim()) return { html: '', notes: ['empty'] };
  // reasoning leftovers
  if (/<think>/i.test(s)) {
    const before = s.length;
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '');
    if (s.length !== before) notes.push('think_block_removed');
  }
  // fenced code: take the LARGEST fenced block when any exists (the answer),
  // unless the un-fenced text carries more markup (fence was an aside)
  const fenced = [];
  let m; FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(s))) fenced.push(m[1]);
  if (fenced.length) {
    const best = fenced.slice().sort((a, b) => tagCount(b) - tagCount(a))[0];
    const outside = s.replace(FENCE_RE, '');
    if (tagCount(best) >= tagCount(outside)) { s = best; notes.push('fence_unwrapped'); }
    else { s = outside; notes.push('fence_dropped'); }
  }
  // whole-document chrome → keep what is inside <body>, remember head styles.
  // A <body> that appears AFTER real page markup is a stray tag inside the
  // page (a model quirk — or a payload), not document chrome: unwrapping
  // from there would throw the nav and hero away, so it is removed instead.
  if (/<html[\s>]|<!doctype/i.test(s) || /<body[\s>]/i.test(s)) {
    const bodyAt = s.search(/<body[\s>]/i);
    const markupBefore = bodyAt > 0 && /<(nav|header|section|main|article|aside|h1|div)\b/i.test(s.slice(0, bodyAt));
    const body = !markupBefore && s.match(/<body[^>]*>([\s\S]*?)(?:<\/body>|$)/i);
    if (body) { s = body[1]; notes.push('document_unwrapped'); }
    else {
      s = s.replace(/<!doctype[^>]*>/gi, '').replace(/<\/?html[^>]*>/gi, '').replace(/<head>[\s\S]*?<\/head>/gi, '').replace(/<\/?body[^>]*>/gi, '');
      notes.push(markupBefore ? 'stray_body_removed' : 'document_chrome_removed');
    }
  }
  // the head sometimes arrives without <body> tags — drop head-only elements
  const beforeHead = s.length;
  s = s.replace(/<title>[\s\S]*?<\/title>/gi, '').replace(/<meta\b[^>]*>/gi, '').replace(/<link\b[^>]*>/gi, '').replace(/<base\b[^>]*>/gi, '');
  if (s.length !== beforeHead) notes.push('head_elements_removed');
  // model-authored <style>/<script>: the design system owns both. Removing them
  // here is cosmetic — the sanitiser removes scripts anyway — but keeps the
  // note honest for the build report.
  if (/<style[\s>]/i.test(s)) { s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ''); notes.push('style_removed'); }
  if (/<script[\s>]/i.test(s)) { s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''); notes.push('script_removed'); }
  // prose around the markup
  const first = s.search(/<(nav|header|section|main|div|footer|article|aside|h1)\b/i);
  if (first > 0) {
    const lead = s.slice(0, first);
    if (!/<[a-z]/i.test(lead) && (PROSE_LEAD_RE.test(lead) || lead.trim().length < 400)) { s = s.slice(first); notes.push('lead_prose_removed'); }
  }
  const lastClose = Math.max(s.lastIndexOf('</footer>'), s.lastIndexOf('</section>'), s.lastIndexOf('</div>'), s.lastIndexOf('</nav>'));
  if (lastClose !== -1) {
    const tail = s.slice(lastClose);
    const closeEnd = tail.indexOf('>') + 1;
    const after = tail.slice(closeEnd);
    if (after.trim() && !/<[a-z]/i.test(after) && (PROSE_TAIL_RE.test(after) || after.trim().length < 400)) { s = s.slice(0, lastClose + closeEnd); notes.push('tail_prose_removed'); }
  }
  return { html: s.trim(), notes };
}

function tagCount(s) { return (String(s || '').match(/<[a-z][a-z0-9-]*[\s>/]/gi) || []).length; }

const SECTION_MARKERS = {
  nav: /<nav\b[^>]*class="[^"]*nx-nav/i,
  hero: /class="[^"]*nx-hero/i,
  contact: /(id="contact"|class="[^"]*nx-contact)/i,
  form: /<form\b[^>]*class="[^"]*nx-form/i,
  footer: /<footer\b/i,
};

const REFUSAL_RE = /\b(i (?:can(?:'|no)t|cannot|am unable to|'m unable to)|as an ai|i'm sorry|i am sorry|unable to (?:create|build|generate)|not able to (?:create|build|generate))\b/i;

/**
 * Is this body a usable page? ctx: { sections: ['nav','hero',…] (requested),
 * finish: finish_reason, minChars }
 */
export function nxAssessModelBody(html, ctx) {
  ctx = ctx || {};
  const s = String(html || '');
  const reasons = [];
  const text = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const tags = tagCount(s);
  const sections = (s.match(/<section\b/gi) || []).length;
  const requested = Array.isArray(ctx.sections) ? ctx.sections : [];
  const present = {};
  for (const k of Object.keys(SECTION_MARKERS)) present[k] = SECTION_MARKERS[k].test(s);
  const missing = [];
  if (!present.nav) missing.push('nav');
  if (!present.hero) missing.push('hero');
  if (requested.includes('contact') || !requested.length) { if (!present.contact) missing.push('contact'); if (!present.form) missing.push('form'); }
  if (!present.footer) missing.push('footer');
  // structural truncation signals
  const openTags = (s.match(/<(section|div|nav|footer|ul|form)\b/gi) || []).length;
  const closeTags = (s.match(/<\/(section|div|nav|footer|ul|form)>/gi) || []).length;
  const unterminated = /<[a-z][^<>]*$/i.test(s.trim()); // ends inside a tag
  // A page that ENDS cleanly (last thing is a closing block tag) with its
  // contact form intact merely forgot the footer — that is not a cut answer.
  const cleanEnd = /<\/(section|footer|div|nav|form|ul|p)>\s*$/i.test(s);
  const truncated = !!(ctx.finish === 'length' || unterminated || (openTags - closeTags) > 3 || (!present.footer && present.hero && sections >= 2 && !(cleanEnd && present.contact && present.form && (openTags - closeTags) <= 1)));
  if (tags < 8) reasons.push('too_little_markup');
  // Thin copy is a WARNING (a complete, short page is still a page); no copy
  // at all is fatal — a nav and a footer with nothing between them is not.
  if (text.length < 40) reasons.push('no_text');
  else if (text.length < (ctx.minChars || 200)) reasons.push('thin_text');
  if (REFUSAL_RE.test(text.slice(0, 400)) && tags < 20) reasons.push('refusal');
  if (truncated) reasons.push('truncated');
  if (missing.length) reasons.push('missing:' + missing.join('+'));
  if (/\blorem ipsum\b/i.test(text)) reasons.push('lorem_ipsum');
  const FATAL = (r) => r === 'too_little_markup' || r === 'no_text' || r === 'refusal' || r === 'truncated' || r.startsWith('missing:');
  const fatal = reasons.some(FATAL);
  const score = Math.max(0, 100 - reasons.filter(FATAL).length * 25 - reasons.filter((r) => !FATAL(r)).length * 8 - missing.length * 10);
  return { ok: !fatal && reasons.length === 0, usable: !fatal, reasons, score, sections, missing, truncated, tags, text_chars: text.length };
}

/**
 * One call for the builder: normalise, assess, decide.
 *   action 'use'      — page is complete; use it
 *   action 'retry'    — worth one more model call (truncated / refusal / thin)
 *   action 'fallback' — nothing usable; deterministic renderer takes over
 */
export function nxModelBodyVerdict(raw, ctx) {
  ctx = ctx || {};
  const norm = nxNormalizeModelBody(raw);
  let a = nxAssessModelBody(norm.html, ctx);
  // The ONLY thing wrong is a forgotten footer on an otherwise complete page:
  // append the deterministic one instead of spending a whole model round.
  if (!a.truncated && a.missing.length === 1 && a.missing[0] === 'footer' && a.reasons.every((r) => r === 'missing:footer' || r === 'thin_text')) {
    norm.html = norm.html + nxFooterHtml(ctx.brand, ctx.year);
    norm.notes.push('footer_appended');
    a = nxAssessModelBody(norm.html, ctx);
  }
  let action = 'use';
  if (!norm.html || !norm.html.includes('<')) action = 'fallback';
  else if (!a.usable) action = (a.reasons.includes('refusal') || (a.reasons.includes('too_little_markup') && a.tags < 3)) ? 'fallback' : 'retry';
  return { html: norm.html, notes: norm.notes, assessment: a, action };
}

const escText = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** The deterministic footer used when a model forgets one (same classes the design system styles). */
export function nxFooterHtml(brand, year) {
  const y = Number(year) || new Date().getUTCFullYear();
  const b = String(brand || '').trim().slice(0, 80);
  return `<footer class="nx-footer"><div class="container">© ${y}${b ? ' ' + escText(b) : ''}. All rights reserved.</div></footer>`;
}

/** The follow-up user turn for a retry: tells the model exactly what went wrong. */
export function nxRetryInstruction(assessment, notes) {
  const why = [];
  if (assessment.truncated) why.push('your previous answer was cut off before the end of the page');
  if (assessment.missing.length) why.push('it was missing: ' + assessment.missing.join(', '));
  if (assessment.reasons.includes('refusal')) why.push('it contained an apology instead of markup');
  if ((notes || []).includes('fence_unwrapped') || (notes || []).includes('lead_prose_removed')) why.push('it wrapped the markup in prose or a code fence');
  return 'Return the COMPLETE page again as body markup only, from <nav class="nx-nav"> to </footer>, with no prose and no code fence' + (why.length ? ' — ' + why.join('; ') : '') + '. Keep every section short enough to finish within the token budget: at most 6 cards per grid, 5 FAQ items, and 2 sentences per paragraph.';
}

export const __modelOutputInternals = { FENCE_RE, PROSE_LEAD_RE, PROSE_TAIL_RE, SECTION_MARKERS, REFUSAL_RE, tagCount };
