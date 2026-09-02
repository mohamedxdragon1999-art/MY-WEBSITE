'use strict';
// ══════════════════════════════════════════════════════════════════════════
// nx_content.js — SLOT-AWARE CONTENT INTELLIGENCE (Phase 3.1)
//
// Every generated site said the same thing. Six visually distinct directions
// all read "Made to be remembered." / "Start a project", because fallback copy
// was a single hardcoded string per slot, independent of the business, the
// industry, or the design's voice. The DESIGN varied; the WORDS never did.
//
// This module derives copy from three inputs that are actually available:
//   1. the BRIEF          — what the business does, in the user's own words
//   2. the INDUSTRY       — inferred from the brief's vocabulary, never asked for
//   3. the DIRECTION VOICE— an editorial page and a bold-experimental page
//                            should not phrase a CTA identically
//
// Two hard rules, both enforced by tests:
//   * COPY IS GENERATED TO FIT ITS SLOT. Length budgets are an input, not a
//     post-hoc truncation — truncation is almost always worse than writing
//     to spec, and mid-word cuts are a visible defect.
//   * NEVER INVENT FACTS. No fabricated stats, awards, client counts or years
//     in business. Everything below either restates the user's own words or
//     makes a claim that is true of any competent operator.
// ══════════════════════════════════════════════════════════════════════════

// Character budgets per slot, matched to what the layouts can hold.
const NX_SLOT_BUDGET = {
  headline: 62, sub: 155, kicker: 28, ctaPrimary: 22, ctaSecondary: 20,
  sectionTitle: 46, sectionSub: 120, cardTitle: 34, cardBody: 118,
  metricLabel: 18, quote: 165, faqQ: 72, faqA: 190,
};

// Industry inference from the brief's own vocabulary. Deliberately keyword
// based and deterministic: an LLM guess would be unreproducible, and a wrong
// industry is worse than a neutral one, so `general` is the safe default.
const NX_INDUSTRIES = [
  { id: 'construction', kw: ['groundwork', 'civil engineer', 'drainage', 'excavat', 'contractor', 'builder', 'construction', 'surfacing', 'roofing', 'plumb', 'scaffold'],
    noun: 'project', verb: 'build', outcome: 'built properly', proof: 'site' },
  { id: 'hospitality', kw: ['restaurant', 'cafe', 'café', 'bistro', 'hotel', 'bar ', 'kitchen', 'dining', 'menu', 'chef'],
    noun: 'table', verb: 'serve', outcome: 'worth returning for', proof: 'room' },
  { id: 'wellness', kw: ['yoga', 'pilates', 'wellness', 'therapy', 'massage', 'clinic', 'physio', 'meditation', 'spa'],
    noun: 'session', verb: 'guide', outcome: 'genuinely restorative', proof: 'studio' },
  { id: 'creative', kw: ['studio', 'design', 'photograph', 'brand', 'agency', 'creative', 'film', 'art direction', 'illustrat'],
    noun: 'commission', verb: 'craft', outcome: 'made with intent', proof: 'work' },
  { id: 'professional', kw: ['law', 'legal', 'solicitor', 'account', 'consult', 'advisor', 'finance', 'audit', 'tax'],
    noun: 'engagement', verb: 'advise', outcome: 'handled precisely', proof: 'practice' },
  { id: 'retail', kw: ['shop', 'store', 'boutique', 'furniture', 'goods', 'product', 'atelier', 'maker', 'craft'],
    noun: 'piece', verb: 'make', outcome: 'made to last', proof: 'workshop' },
  { id: 'technology', kw: ['software', 'saas', 'platform', 'api', 'data', 'ai ', 'app', 'developer', 'cloud', 'infrastructure'],
    noun: 'rollout', verb: 'ship', outcome: 'that actually works', proof: 'product' },
];

// Voice per direction. The same fact, phrased as that design would phrase it.
const NX_VOICE = {
  'editorial-minimal':   { kicker: 'Selected work', ctaA: 'Start a conversation', ctaB: 'See the work', tone: 'measured' },
  'cinematic-immersive': { kicker: 'The studio',    ctaA: 'Begin a project',      ctaB: 'View the work', tone: 'dramatic' },
  'luxury-art':          { kicker: 'By appointment', ctaA: 'Enquire',             ctaB: 'View the work', tone: 'restrained' },
  'bold-experimental':   { kicker: 'No filler',     ctaA: 'Get started',          ctaB: 'See it',        tone: 'direct' },
  'signal-industrial':   { kicker: 'Capability',    ctaA: 'Request a quote',      ctaB: 'See projects',  tone: 'technical' },
  'swiss-structured':    { kicker: 'Overview',      ctaA: 'Make an enquiry',      ctaB: 'View projects', tone: 'systematic' },
};

// Coerce safely. A plan field can be an object, array or number (AI patches and
// imports both produce these), and naive String() emits "[object Object]" into
// visible copy — a defect this project has already had to fix once.
function __clean(s) {
  if (s == null) return '';
  if (typeof s === 'string') return s.replace(/\s+/g, ' ').trim();
  if (typeof s === 'number') return Number.isFinite(s) ? String(s) : '';
  if (typeof s === 'boolean') return '';
  if (Array.isArray(s)) return __clean(s.find((x) => typeof x === 'string' && x.trim()) || '');
  if (typeof s === 'object') {
    // Prefer a meaningful nested field over stringifying the object.
    for (const k of ['title', 'name', 'text', 'label', 'value', 'desc']) {
      if (typeof s[k] === 'string' && s[k].trim()) return __clean(s[k]);
    }
    return '';
  }
  return '';
}

/** Trim to a budget on a WORD boundary. Mid-word cuts are a visible defect. */
function nxFit(text, budget, opts) {
  const t = __clean(text);
  if (!t) return '';
  if (t.length <= budget) return t;
  const cut = t.slice(0, budget + 1);
  const sp = cut.lastIndexOf(' ');
  let out = (sp > budget * 0.55 ? cut.slice(0, sp) : t.slice(0, budget)).replace(/[\s,;:–—-]+$/, '');
  if (opts && opts.sentence) {
    // Prefer ending on a real sentence if one fits inside the budget.
    const stop = out.lastIndexOf('. ');
    if (stop > budget * 0.5) out = out.slice(0, stop + 1);
  }
  return out;
}

/** Infer the industry from the brief's own words. Never asks, never guesses wildly. */
function nxInferIndustry(text) {
  const hay = __clean(text).toLowerCase();
  let best = null, score = 0;
  for (const ind of NX_INDUSTRIES) {
    const n = ind.kw.reduce((a, k) => a + (hay.includes(k) ? 1 : 0), 0);
    if (n > score) { score = n; best = ind; }
  }
  return best && score > 0 ? best
    : { id: 'general', noun: 'project', verb: 'deliver', outcome: 'done properly', proof: 'work' };
}

/** The first meaningful sentence of the brief, in the user's own voice. */
function __firstClaim(desc) {
  const t = __clean(desc);
  if (!t) return '';
  const m = t.split(/(?<=[.!?])\s+/)[0];
  return __clean(m || t);
}

/**
 * Build slot-fitted, direction-aware copy.
 * Everything returned either restates the brief or is generically true — no
 * invented numbers, awards, or client counts.
 */
function nxGenerateCopy(plan, directionId) {
  const p = plan || {};
  const name = __clean(p.site_name || p.name) || 'Studio';
  const desc = __clean(p.description || p.hero_sub || '');
  const services = Array.isArray(p.services) ? p.services : [];
  const svcWords = services.map((s) => __clean(s && (s.title || s))).filter(Boolean);
  const ind = nxInferIndustry([desc, name, svcWords.join(' ')].join(' '));
  const voice = NX_VOICE[directionId] || NX_VOICE['editorial-minimal'];
  const claim = __firstClaim(desc);

  // ── HEADLINE ── prefer the user's own; otherwise build from real specifics.
  let headline = __clean(p.hero_headline || p.tagline);
  if (!headline) {
    const lead = svcWords[0] ? svcWords[0].toLowerCase() : '';
    headline = lead
      ? `${lead.charAt(0).toUpperCase() + lead.slice(1)}, ${ind.outcome}.`
      : `${name}: ${ind.noun}s ${ind.outcome}.`;
  }
  headline = nxFit(headline, NX_SLOT_BUDGET.headline);

  // ── SUB ── restate the brief; never pad with adjectives.
  let sub = __clean(p.hero_sub);
  if (!sub) {
    sub = claim || (svcWords.length
      ? `${svcWords.slice(0, 3).join(', ')} — ${ind.outcome} by ${name}.`
      : `${name} — ${ind.noun}s ${ind.outcome}.`);
  }
  sub = nxFit(sub, NX_SLOT_BUDGET.sub, { sentence: true });

  // ── CTAs ── phrased in the direction's voice, sized to the button.
  const ctaPrimary = nxFit(__clean(p.cta_primary) || voice.ctaA, NX_SLOT_BUDGET.ctaPrimary);
  const ctaSecondary = nxFit(__clean(p.cta_secondary) || voice.ctaB, NX_SLOT_BUDGET.ctaSecondary);

  // ── SECTION HEADINGS ── per section type AND voice, not one global string.
  const sections = {
    feature: { kicker: nxFit(voice.kicker, NX_SLOT_BUDGET.kicker), title: nxFit(svcWords.length ? 'What we do' : 'Capabilities', NX_SLOT_BUDGET.sectionTitle) },
    work:    { kicker: nxFit('Selected', NX_SLOT_BUDGET.kicker),    title: nxFit(`Recent ${ind.noun}s`, NX_SLOT_BUDGET.sectionTitle) },
    story:   { kicker: nxFit('Approach', NX_SLOT_BUDGET.kicker),    title: nxFit('How we work', NX_SLOT_BUDGET.sectionTitle) },
    reviews: { kicker: nxFit('In their words', NX_SLOT_BUDGET.kicker), title: nxFit('What clients say', NX_SLOT_BUDGET.sectionTitle) },
    metrics: { kicker: nxFit('At a glance', NX_SLOT_BUDGET.kicker),  title: nxFit(`${name} by the numbers`, NX_SLOT_BUDGET.sectionTitle) },
    contact: { kicker: nxFit('Get in touch', NX_SLOT_BUDGET.kicker), title: nxFit(`Talk to ${name}`, NX_SLOT_BUDGET.sectionTitle) },
    cta:     { kicker: nxFit('Next step', NX_SLOT_BUDGET.kicker),    title: nxFit(`Ready to ${ind.verb}?`, NX_SLOT_BUDGET.sectionTitle) },
    faq:     { kicker: nxFit('Questions', NX_SLOT_BUDGET.kicker),    title: nxFit('Common questions', NX_SLOT_BUDGET.sectionTitle) },
  };

  // ── CARD BODIES ── a service with no description gets a sentence derived
  // from its OWN title, not a generic filler line repeated N times.
  const cards = svcWords.map((title, i) => {
    const given = __clean(services[i] && (services[i].desc || services[i].text));
    const body = given || `${title} — ${ind.outcome}, handled end to end.`;
    return { title: nxFit(title, NX_SLOT_BUDGET.cardTitle), text: nxFit(body, NX_SLOT_BUDGET.cardBody) };
  });

  return { industry: ind.id, tone: voice.tone, headline, sub, ctaPrimary, ctaSecondary, sections, cards, budgets: NX_SLOT_BUDGET };
}

module.exports = { nxGenerateCopy, nxInferIndustry, nxFit, NX_SLOT_BUDGET, NX_VOICE, NX_INDUSTRIES };
