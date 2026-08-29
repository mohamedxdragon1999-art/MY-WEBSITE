#!/usr/bin/env python3
"""Batch C (cycles 17-24): builder prompt quality, plan defaults, device preview, plan summary, local parity."""
import sys
P = 'backend/src/index.js'
s = open(P, encoding='utf-8').read()

def rep(old, new, tag, count=1):
    global s
    n = s.count(old)
    if n != count:
        print(f'❌ [{tag}] found {n}'); print('OLD:', repr(old[:110])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

# ── C17-18: builder prompt — section quality rules + plan defaults ──
rep("""Rules: professional, specific, real-sounding content; keep paragraphs short; include the working hours and phone/email from the plan in the contact section; use images from the plan's gallery_imgs when present; no lorem ipsum. Output ONLY the body HTML.`,""",
"""Rules:
- Use EXACTLY the plan's facts: working hours, phone, email, address, services, reviews, FAQs. Never invent contact details or services.
- Keep every paragraph under 45 words. One idea per paragraph.
- Section headings must use h2 with class sec-title inside .container; one h1 only (in the hero).
- Hero headline ≤ 12 words; sub ≤ 25 words; buttons ≤ 3 words each.
- Use the plan's gallery_imgs (real URLs) for .nx-hero-img, .nx-gallery and .nx-split images when present; add alt text to every img.
- Marquee: 5-6 short items that build trust.
- Stats: 3-4 believable numbers with data-count.
- Lead magnet + parallax CTA must reference the SAME primary action as the hero CTA.
- FAQ answers 20-40 words.
- If the plan's field is empty, write tasteful generic copy that fits the business type — never lorem ipsum.
- Output ONLY the body HTML.`,""",
'prompt quality rules')

# plan defaults helper: fill missing plan fields with sensible fallbacks derived from business name/desc
rep("""async function generateSiteHtml(env, ws, opts) {
  const w = await getWorkspace(env, ws);
  const design = SITE_DESIGNS[opts.design_id] || SITE_DESIGNS.sentinel;
  const name = String(opts.name || 'My Website').slice(0, 120);
  const plan = opts.plan || null;      // scanned + approved content plan
  const desc = String(opts.description || '').slice(0, 800);
  const instructions = String(opts.instructions || '').slice(0, 1500);""",
"""async function generateSiteHtml(env, ws, opts) {
  const w = await getWorkspace(env, ws);
  const design = SITE_DESIGNS[opts.design_id] || SITE_DESIGNS.sentinel;
  const name = String(opts.name || 'My Website').slice(0, 120);
  const plan = normalizePlan(opts.plan, name, String(opts.description || ''));
  const desc = String(opts.description || '').slice(0, 800);
  const instructions = String(opts.instructions || '').slice(0, 1500);""",
'normalizePlan call')

rep("""// Build the content instruction payload
  let contentSpec;
  if (plan) {
    contentSpec = `CONTENT PLAN (approved by the owner — use it, keep facts exact): ${JSON.stringify(plan)}`;
  } else {
    contentSpec = `Business: "${name}". About: ${desc || 'A professional local business.'}`;
  }""",
"""// Build the content instruction payload
  let contentSpec;
  if (plan) {
    contentSpec = `CONTENT PLAN (approved by the owner — use it, keep facts exact): ${JSON.stringify(plan)}`;
  } else {
    contentSpec = `Business: "${name}". About: ${desc || 'A professional local business.'}`;
  }""",
'noop')

# add normalizePlan helper before generateSiteHtml
rep("""// Build a full site: DESIGN CSS + AI-written content HTML (with the class
// vocabulary) + the interactive JS. Deterministic shell, AI fills content.""",
"""// Fill missing plan fields with sensible defaults so the AI always has
// complete material, even when the scan found little.
function normalizePlan(plan, name, desc) {
  const p = plan && typeof plan === 'object' ? { ...plan } : {};
  const biz = name || 'Our Business';
  p.site_name = String(p.site_name || name || 'Our Website').slice(0, 120);
  p.tagline = String(p.tagline || '').slice(0, 100) || `${biz} — trusted local service`;
  p.hero_headline = String(p.hero_headline || '').slice(0, 100) || `${biz}: quality you can rely on`;
  p.hero_sub = String(p.hero_sub || '').slice(0, 200) || (desc ? desc.split('.')[0] + '.' : 'Professional service, done right.');
  p.cta_primary = String(p.cta_primary || 'Get a free quote').slice(0, 40);
  p.cta_secondary = String(p.cta_secondary || 'Our services').slice(0, 40);
  if (!Array.isArray(p.marquee_items) || !p.marquee_items.length) p.marquee_items = ['Trusted locally', 'Fast response', 'Fair pricing', 'Quality guaranteed', 'Friendly service'];
  if (!Array.isArray(p.stats) || !p.stats.length) p.stats = [{ value: 10, label: 'Years experience' }, { value: 500, label: 'Happy clients' }, { value: 100, label: '% Satisfaction' }];
  if (!Array.isArray(p.services) || !p.services.length) p.services = [{ icon: '🛠️', title: 'Professional service', desc: 'Reliable, high-quality work — every time.' }, { icon: '⚡', title: 'Fast turnaround', desc: 'Quick response and on-time delivery.' }, { icon: '🤝', title: 'Fair pricing', desc: 'Transparent quotes, no surprises.' }];
  if (!Array.isArray(p.why_us) || !p.why_us.length) p.why_us = ['Licensed and insured', 'Upfront, honest pricing', 'Local and trusted', 'Work guaranteed'];
  p.about = String(p.about || '').slice(0, 600) || `${biz} has been serving the local community with professional service and honest advice. Every job is done right the first time — and backed by a real guarantee.`;
  if (!Array.isArray(p.process) || !p.process.length) p.process = [{ title: 'Contact us', desc: 'Call, email or use the form — we reply fast.' }, { title: 'Free quote', desc: 'A clear, no-obligation price before we start.' }, { title: 'We do the work', desc: 'Professional service with minimum disruption.' }, { title: 'Guaranteed', desc: 'Every job is finished right and backed by a guarantee.' }];
  if (!Array.isArray(p.gallery_imgs) || !p.gallery_imgs.length) p.gallery_imgs = [];
  if (!Array.isArray(p.reviews) || !p.reviews.length) p.reviews = [{ name: 'A Happy Client', text: 'Brilliant service from start to finish — highly recommended!', stars: 5 }];
  p.lead_title = String(p.lead_title || '').slice(0, 80) || 'Ready to get started?';
  p.lead_text = String(p.lead_text || '').slice(0, 200) || 'Contact us today for a free, friendly quote.';
  if (!Array.isArray(p.faqs) || !p.faqs.length) p.faqs = [{ q: 'How fast do you respond?', a: 'We usually reply within a few hours on business days.' }, { q: 'Do you provide guarantees?', a: 'Yes — every job is backed by a written guarantee.' }, { q: 'How do I get a quote?', a: 'Call, email or use the form and we will send a clear quote.' }];
  if (!Array.isArray(p.working_hours) || !p.working_hours.length) p.working_hours = ['Mon - Fri 9:00 - 17:00'];
  p.contact = p.contact && typeof p.contact === 'object' ? p.contact : {};
  p.footer_note = String(p.footer_note || '').slice(0, 120) || biz;
  return p;
}
// Build a full site: DESIGN CSS + AI-written content HTML (with the class
// vocabulary) + the interactive JS. Deterministic shell, AI fills content.""",
'normalizePlan')

open(P, 'w', encoding='utf-8').write(s)
print('Backend batch C done.')
