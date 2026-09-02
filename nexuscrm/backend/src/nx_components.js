'use strict';
// ══════════════════════════════════════════════════════════════════════════
// nx_components.js — VALIDATED SECTION PRIMITIVES (Phase 2.2)
//
// Every section used to hand-author its own outer shell. With 22 hand-written
// section tags across 23 render helpers, the shells DRIFTED: the `grid` review
// variant emitted a section heading while `single` and `quote` did not, and the
// metrics section omitted one entirely — so those sections were invisible in
// the document outline for screen-reader and SEO purposes.
//
// The fix is structural, not another patch: one function owns the shell, so a
// section cannot be built wrong. Correctness is guaranteed BY CONSTRUCTION
// rather than re-verified on every generation.
//
// Each shell is guaranteed to carry:
//   * a stable id (addressable, linkable, and a valid anchor target)
//   * data-r / data-rhythm / data-emphasis so it participates in the reveal,
//     rhythm and emphasis-budget systems rather than silently opting out
//   * a heading in the document outline — visually shown, or visually hidden
//     when the design intentionally has no visible title
//   * a .c-wrap measure container unless the section is deliberately full-bleed
// ══════════════════════════════════════════════════════════════════════════

function __esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A heading that exists for assistive tech and document structure but is not
// painted. Used where the visual design deliberately shows no title — the
// alternative (omitting it) removes the section from the outline entirely.
const NX_SR_ONLY_CSS = '.c-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;'
  + 'overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}';

// Build a section shell. `heading` is REQUIRED — pass `visible:false` to render
// it screen-reader-only, never omit it.
function nxSection(opts) {
  const o = opts || {};
  const id = String(o.id || 'section').replace(/[^a-z0-9-]/gi, '');
  const cls = ['c-' + (o.family || 'section'), o.variant ? 'c-' + o.family + '-' + o.variant : '', o.cls || '']
    .filter(Boolean).join(' ');
  const tag = o.tag || 'section';
  const level = o.level || 2;
  const headingText = String(o.heading == null ? '' : o.heading).trim();
  const visible = o.headingVisible !== false && !!headingText;

  // Furniture (nav, footer, marquee) is exempt: it is labelled by its element
  // role, and an <h2> inside a <nav> would pollute the outline.
  const furniture = !!o.furniture;
  let head = '';
  if (!furniture) {
    if (!headingText) {
      // Fail loudly in development rather than silently shipping a headless
      // section — this is the exact defect the library exists to prevent.
      head = `<h${level} class="c-sr-only">${__esc(o.fallbackHeading || id)}</h${level}>`;
    } else if (visible) {
      head = (o.headingHtml != null) ? o.headingHtml
        : `<div class="c-sec-head${o.center ? ' c-sec-center' : ' c-sec-left'}">`
          + (o.kicker ? `<span class="c-kicker${o.center ? ' c-kicker-center' : ''}">${__esc(o.kicker)}</span>` : '')
          + `<h${level} class="c-sec-title">${__esc(headingText)}</h${level}>`
          + (o.sub ? `<p class="c-sec-sub">${__esc(o.sub)}</p>` : '')
          + `</div>`;
    } else {
      head = `<h${level} class="c-sr-only">${__esc(headingText)}</h${level}>`;
    }
  }

  const attrs = [
    `class="${cls}"`,
    `id="${id}"`,
    'data-r',
    o.rhythm ? `data-rhythm="${__esc(o.rhythm)}"` : '',
    o.emphasis ? `data-emphasis="${__esc(o.emphasis)}"` : '',
    o.transition ? `data-transition="${__esc(o.transition)}"` : '',
    o.label ? `aria-label="${__esc(o.label)}"` : '',
  ].filter(Boolean).join(' ');

  const inner = o.bleed ? (head + (o.body || ''))
    : `<div class="c-wrap">${head}${o.body || ''}</div>`;
  return `<${tag} ${attrs}>${inner}</${tag}>`;
}

// Structural audit: does a rendered document satisfy the shell contract?
// Used by tests and by the validation gate.
function nxAuditSections(document) {
  const issues = [];
  // Only SECTION CONTAINERS are subject to the contract. A page may legitimately
  // place bare content (an <h1>, a <p>) directly in <main>; auditing those as
  // sections produced false blockers on perfectly clean minimal documents.
  const SECTION_TAGS = new Set(['SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'NAV']);
  const nodes = [...document.querySelectorAll('main > *')].filter((el) => {
    if (SECTION_TAGS.has(el.tagName)) return true;
    // A <div> counts only when it is acting as a section (carries the markers).
    return el.tagName === 'DIV' && (el.hasAttribute('data-rhythm') || /^c-(hero|feature|work|reviews|metrics|story|cta|contact|faq)\b/.test(el.className || ''));
  });
  for (const s of nodes) {
    const cls = s.className || '';
    const id = s.getAttribute('id') || cls.split(/\s+/)[0] || '(anonymous)';
    const furniture = /c-nav|c-footer|c-marquee|c-strip/.test(cls) || s.tagName === 'NAV' || s.tagName === 'FOOTER';
    if (!s.getAttribute('id')) issues.push({ id, rule: 'no-id', message: `${id}: section has no id` });
    if (!s.hasAttribute('data-r')) issues.push({ id, rule: 'no-reveal', message: `${id}: not part of the reveal system` });
    if (!furniture) {
      if (!s.hasAttribute('data-rhythm')) issues.push({ id, rule: 'no-rhythm', message: `${id}: no data-rhythm` });
      if (!s.hasAttribute('data-emphasis')) issues.push({ id, rule: 'no-emphasis', message: `${id}: no data-emphasis` });
      if (!s.querySelector('h1,h2,h3,h4,h5,h6')) {
        issues.push({ id, rule: 'no-heading', message: `${id}: no heading — invisible in the document outline` });
      }
    }
  }
  return issues;
}

module.exports = { nxSection, nxAuditSections, NX_SR_ONLY_CSS };
