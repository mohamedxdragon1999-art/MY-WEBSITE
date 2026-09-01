'use strict';
// ══════════════════════════════════════════════════════════════════════════
// nx_copy.js — DETERMINISTIC COPY-QUALITY CHECKS (§4.1)
//
// Copy length is a LAYOUT INPUT, not only a quality concern: a headline that
// runs long does not just read badly, it overflows its slot. These checks are
// deterministic and run with no model call, so they gate every build.
//
// The cliché list targets the specific register that makes generated copy
// recognisable as generated. It is intentionally conservative — each entry is a
// phrase that is near-meaningless rather than merely common.
// ══════════════════════════════════════════════════════════════════════════

const NX_CLICHES = [
  'unlock your potential', 'take it to the next level', 'in today\'s fast-paced world',
  'seamless experience', 'seamlessly integrate', 'game-changer', 'game changing',
  'cutting-edge solutions', 'best-in-class', 'world-class solutions', 'synergy',
  'revolutionize', 'revolutionise', 'elevate your brand', 'unleash the power',
  'transform your business', 'one-stop shop', 'think outside the box',
  'leverage our expertise', 'passionate about delivering', 'we go the extra mile',
  'at the end of the day', 'moving forward', 'low-hanging fruit',
  'your journey starts here', 'the future is here', 'redefine what\'s possible',
];
const NX_PLACEHOLDERS = [
  'lorem ipsum', 'dolor sit amet', '[insert', 'company name', 'your company here',
  'tbd', 'todo', 'fixme', 'placeholder text', 'sample text', 'xxx',
];
// Max characters per slot before the copy stops fitting its container.
const NX_SLOT_LIMITS = {
  display: 70,   // hero H1
  hero: 70,
  section: 60,   // section H2
  card: 42,      // card/service title
  button: 24,    // CTA label
  kicker: 34,    // eyebrow
  lead: 180,     // hero subtitle / section lead
  body: 320,     // body paragraph
};

function __sentences(t) {
  return String(t || '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 3);
}
function __syllables(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const m = w.replace(/(?:es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g);
  return m ? m.length : 1;
}
// Flesch Reading Ease. Higher = easier. Marketing copy should sit above ~50.
function nxReadability(text) {
  const sents = __sentences(text);
  const words = String(text || '').split(/\s+/).filter(w => /[a-z]/i.test(w));
  if (!sents.length || !words.length) return null;
  const syl = words.reduce((a, w) => a + __syllables(w), 0);
  const score = 206.835 - 1.015 * (words.length / sents.length) - 84.6 * (syl / words.length);
  return Math.round(score * 10) / 10;
}

// Audit the rendered document's visible copy.
function nxAuditCopy(document, opts) {
  const issues = [];
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script,style').forEach(n => n.remove());
  const visible = clone.textContent.replace(/\s+/g, ' ').trim();
  const low = visible.toLowerCase();

  for (const c of NX_CLICHES) {
    if (low.includes(c)) issues.push({ severity: 'warning', category: 'copy', rule: 'cliche',
      measured: `"${c}"`, message: `Copy contains the filler phrase "${c}".` });
  }
  for (const ph of NX_PLACEHOLDERS) {
    if (low.includes(ph)) issues.push({ severity: 'blocking', category: 'copy', rule: 'placeholder',
      measured: `"${ph}"`, message: `Placeholder text "${ph}" must never ship.` });
  }

  // Slot overflow — copy longer than its container can hold.
  const slots = [
    ['h1', 'display'], ['h2', 'section'], ['h3', 'card'],
    ['.c-kicker', 'kicker'], ['.c-btn', 'button'], ['.c-lead', 'lead'],
  ];
  for (const [sel, slot] of slots) {
    const limit = NX_SLOT_LIMITS[slot];
    for (const el of document.querySelectorAll(sel)) {
      const t = (el.textContent || '').trim();
      if (t.length > limit) issues.push({ severity: 'warning', category: 'copy', rule: 'slot-overflow',
        selector: sel, measured: `${t.length} chars (limit ${limit})`,
        message: `${slot} copy is ${t.length - limit} characters over its slot and may wrap or clip.` });
    }
  }

  // Near-duplicate sentences across the page.
  const sents = __sentences(visible).filter(s => s.length > 30);
  const seen = new Map();
  for (const s of sents) {
    const key = s.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 60);
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [k, n] of seen) if (n > 1) issues.push({ severity: 'warning', category: 'copy',
    rule: 'repetition', measured: `${n}×`, message: `Sentence repeated ${n} times: "${k.slice(0, 45)}…"` });

  // Readability of the body prose.
  const prose = [...document.querySelectorAll('p')].map(p => p.textContent.trim()).filter(t => t.length > 60).join(' ');
  const score = nxReadability(prose);
  if (score != null && score < 30) issues.push({ severity: 'warning', category: 'copy', rule: 'readability',
    measured: `Flesch ${score}`, message: 'Body copy is dense and hard to scan (Flesch below 30).' });

  return { issues, readability: score, wordCount: visible.split(/\s+/).length };
}

module.exports = { nxAuditCopy, nxReadability, NX_CLICHES, NX_PLACEHOLDERS, NX_SLOT_LIMITS };
