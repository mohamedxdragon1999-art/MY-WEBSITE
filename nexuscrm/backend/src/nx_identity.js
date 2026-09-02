'use strict';
// ══════════════════════════════════════════════════════════════════════════
// nx_identity.js — TEMPLATE IDENTITY SUBSTITUTION
//
// The reference template (nx_template.js) is a real, finished, high-quality
// site design that we WANT to keep as a default style. What we must never keep
// is the identity of the business it was authored for: its name, owner, phone,
// email, postal address, service copy and a large industry-specific chatbot
// knowledge base were all literal strings inside shared engine code.
//
// Rendering that template for a different business emitted that real business's
// contact details into someone else's website. This module is the boundary:
// the DESIGN passes through, the IDENTITY is replaced.
//
// Design goals:
//   * Deny-by-default — substitution is driven by an explicit inventory of
//     reference identity, so a missed field fails loudly in tests instead of
//     silently shipping. Anything unmapped is scrubbed to a neutral value.
//   * Longest-match-first so "info@rcatkincontractor.co.uk" is replaced before
//     the bare domain, and "R C Atkin" before "Atkin".
//   * Case- and format-tolerant (phone numbers appear spaced, dashed and
//     tel:-encoded).
// ══════════════════════════════════════════════════════════════════════════

// The reference site's real identity. This inventory exists so the scrubber can
// be exhaustive and so tests can assert that NONE of it survives.
const NX_REFERENCE_IDENTITY = {
  business: ['R C Atkin', 'RC Atkin', 'R.C. Atkin', 'rcatkincontractor'],
  owner: ['Martin'],
  phones: ['07721 511814', '07721511814', '+447721511814'],
  emails: ['info@rcatkincontractor.co.uk'],
  domains: ['rcatkincontractor.co.uk', 'rcatkincontractor'],
  places: ['Spa House, Copmere End, Eccleshall, Stafford, Staffordshire, ST21 6HH',
    'Spa House, Eccleshall, ST21 6HH', 'Copmere End', 'Eccleshall', 'ST21 6HH', 'ST216HH',
    'Staffordshire', 'Shropshire', 'Derbyshire', 'Cheshire', 'Stafford',
    // URL-encoded forms: these appear inside Google Maps links where spaces are
    // '+' or '%20', so the plain-text patterns above never match them.
    'Spa+House+Copmere+End', 'Spa+House', 'Copmere+End', 'Copmere',
    'Spa%20House', 'Copmere%20End', 'Spa House'],
  // Industry vocabulary. Present so a generated site for another trade cannot
  // inherit drainage copy; only used when the caller has supplied replacements.
  industry: ['septic tank', 'septic tanks', 'septic', 'soakaway', 'soakaways',
    'drainage field', 'off-mains drainage', 'drainage systems', 'drainage', 'treatment plant',
    'CCTV drain survey', 'high-pressure jetting', 'civil groundworks', 'Environment Agency'],
};

function __esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function __digits(s) { return String(s).replace(/[^\d]/g, ''); }

// Build the ordered replacement table. Longest source first so that a longer
// phrase is consumed before any substring of it.
function nxIdentityMap(profile) {
  const p = profile || {};
  const name = String(p.name || p.business || '').trim();
  const owner = String(p.owner || '').trim();
  const phone = String(p.phone || '').trim();
  const email = String(p.email || '').trim();
  const place = String(p.base || p.address || '').trim();
  const coverage = String(p.coverage || '').trim();

  const pairs = [];
  const push = (from, to) => { if (from) pairs.push([String(from), String(to == null ? '' : to)]); };

  for (const e of NX_REFERENCE_IDENTITY.emails) push(e, email || 'hello@example.com');
  for (const d of NX_REFERENCE_IDENTITY.domains) push(d, email ? (email.split('@')[1] || 'example.com') : 'example.com');
  for (const b of NX_REFERENCE_IDENTITY.business) push(b, name || 'This Studio');
  for (const o of NX_REFERENCE_IDENTITY.owner) push(o, owner || 'the owner');
  for (const ph of NX_REFERENCE_IDENTITY.phones) push(ph, phone || '');
  // Places are ALWAYS replaced. Leaving the reference client's town/county in
  // another business's site is exactly the leak this module exists to stop, so
  // a missing profile falls back to a neutral phrase rather than opting out.
  for (const pl of NX_REFERENCE_IDENTITY.places) push(pl, (place || coverage || 'your area'));
  // Industry vocabulary: replaced so a yoga studio never inherits septic-tank
  // copy — but ONLY the leftover template boilerplate. If the caller genuinely
  // works in this trade (a drainage firm using this template, or any user whose
  // own service titles contain these words), scrubbing their real content would
  // be destructive. `keepIndustry` opts out, and callers who supply their own
  // wording for a term are never overridden.
  if (!p.keepIndustry) {
    const trade = p.industryTerm || p.industry || 'our work';
    const own = String(p.ownWords || '').toLowerCase();
    for (const t of NX_REFERENCE_IDENTITY.industry) {
      // Never rewrite a term the caller themselves used.
      if (own && own.includes(t.toLowerCase())) continue;
      push(t, trade);
    }
  }

  pairs.sort((a, b) => b[0].length - a[0].length);
  return pairs;
}

// Replace every trace of the reference identity in an arbitrary string.
function nxScrubIdentity(text, profile) {
  if (text == null) return text;
  let out = String(text);
  const phone = String((profile && profile.phone) || '').trim();

  for (const [from, to] of nxIdentityMap(profile)) {
    // WORD-BOUNDARY matching. Plain substring replacement corrupted legitimate
    // copy: "Martina Franca" became "Anaa Franca", "Staffordshire terriers"
    // became "Lisbon terriers", and "martin@othercompany.com" was rewritten.
    // Only replace when the term is a standalone word.
    const alnumStart = /^[A-Za-z0-9]/.test(from);
    const alnumEnd = /[A-Za-z0-9]$/.test(from);
    // Boundaries chosen from measured failures:
    //  * `.` must NOT be in the trailing guard, or a sentence-ending word
    //    ("Owner is Martin.") stops matching.
    //  * an email is protected by what FOLLOWS it (`@`), not what precedes it,
    //    so "martin@othercompany.com" survives while "Martin." is scrubbed.
    // The lookbehind must not treat an ESCAPE SEQUENCE as a word character.
    // Inside a JS string literal the reference name appears after a literal
    // backslash-n; 'n' is alphanumeric, so the guard silently blocked the
    // match and identity survived inside the embedded chatbot script.
    // An ESCAPE SEQUENCE must not count as a word character. Inside a JS
    // string literal the reference name appears after a literal backslash-n;
    // 'n' is alphanumeric, so a plain lookbehind silently blocked the match
    // and identity survived inside the embedded chatbot script. Allow the
    // match when preceded by an escape, otherwise require a real boundary.
    const pre = alnumStart ? '(?:\\\\[nrtv]|(?<![A-Za-z0-9._-]))' : '';
    // A third-party email must survive, but the reference DOMAIN itself must
    // still be scrubbed — so the "@"/".tld" guard applies only to short word
    // terms (a person's name), never to domains or multi-word business names.
    const isDomainish = /[.]/.test(from) || /\s/.test(from) || from.length > 14;
    // Inside a URL the surrounding "." and "-" are separators, not word
    // characters, so a strict boundary let identity survive in hrefs such as
    // "…rcatkincontractor.co.uk/post/the-septic-tank…". Domain-ish terms and
    // industry vocabulary are unambiguous identity: match them anywhere.
    const urlish = isDomainish || NX_REFERENCE_IDENTITY.industry.indexOf(from) >= 0
      || NX_REFERENCE_IDENTITY.places.indexOf(from) >= 0;
    const pre2 = urlish ? '' : pre;
    const post = !alnumEnd ? '' : (urlish ? '' : '(?![A-Za-z0-9-]|@)');
    try {
      out = out.replace(new RegExp(pre2 + '(' + __esc(from) + ')' + post, 'gi'), (m, g) => m.replace(g, to));
    } catch (e) {
      // Lookbehind is unsupported on some engines — fall back to a manual guard.
      out = out.replace(new RegExp('(^|[^A-Za-z0-9._-])' + __esc(from) + post, 'gi'), (m, p1) => (p1 || '') + to);
    }
  }
  // Phone numbers survive in normalised forms (tel: hrefs, no spaces, dashes).
  for (const ref of NX_REFERENCE_IDENTITY.phones) {
    const d = __digits(ref);
    if (d.length < 7) continue;
    const loose = d.split('').map(__esc).join('[\\s\\-().]*');
    out = out.replace(new RegExp(loose, 'g'), __digits(phone) || '');
  }
  return out;
}

// Deep-scrub any JSON-serialisable structure (config objects, knowledge bases).
function nxScrubDeep(value, profile) {
  if (typeof value === 'string') return nxScrubIdentity(value, profile);
  if (Array.isArray(value)) return value.map(v => nxScrubDeep(v, profile));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = nxScrubDeep(value[k], profile);
    return out;
  }
  return value;
}

// Verification: does ANY reference identity survive? Used as a shipping gate.
function nxIdentityLeaks(text, opts) {
  const hay = String(text == null ? '' : text);
  // Default to checking EVERYTHING: identity, places and industry vocabulary.
  const groups = (opts && opts.identityOnly)
    ? Object.keys(NX_REFERENCE_IDENTITY).filter(k => k !== 'industry' && k !== 'places')
    : Object.keys(NX_REFERENCE_IDENTITY);
  const found = [];
  for (const g of groups) {
    for (const term of NX_REFERENCE_IDENTITY[g]) {
      if (new RegExp(__esc(term), 'i').test(hay)) found.push(term);
    }
  }
  // Digit-only phone forms.
  for (const ref of NX_REFERENCE_IDENTITY.phones) {
    const d = __digits(ref);
    if (d.length >= 7 && hay.replace(/[^\d]/g, '').includes(d)) found.push(ref + ' (digits)');
  }
  return [...new Set(found)];
}

// Build a neutral identity profile from a normal site brief.
function nxProfileFromPlan(plan) {
  const p = plan || {};
  const c = p.contact || {};
  return {
    // The template's runtime config uses businessName/ownerName; a brief uses
    // site_name/owner. Read both, or substitution silently no-ops.
    name: p.site_name || p.name || p.business || p.businessName || '',
    owner: p.owner || p.ownerName || '',
    phone: c.phone || p.phone || '',
    email: c.email || p.email || '',
    base: p.base || p.address || '',
    coverage: p.coverage || '',
    industryTerm: p.industryTerm || '',
  };
}

module.exports = {
  NX_REFERENCE_IDENTITY, nxIdentityMap, nxScrubIdentity, nxScrubDeep,
  nxIdentityLeaks, nxProfileFromPlan,
};
