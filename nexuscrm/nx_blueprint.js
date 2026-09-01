// ─────────────────────────────────────────────────────────────────────────────
// NXCROOM BLUEPRINT ENGINE
// Deterministic content-plan generation + industry detection + section
// rendering using the design-system `.nx-*` vocabulary. Lets the AI website
// builder produce a coherent, masterpiece-grade site EVEN WITH NO AI — and
// acts as the content floor under AI enrichment.
// Pure functions; no network, no DOM.
// ─────────────────────────────────────────────────────────────────────────────

function __be(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function __beNum(n) {
  const v = Number(n);
  return isFinite(v) ? String(Math.round(v)) : '0';
}

// ── Industry detection ───────────────────────────────────────────────────────
const NX_INDUSTRIES = {
  restaurant: { label: 'Restaurant', emoji: '🍽️', tagline: 'Fresh, delicious food served with a smile.', services: [['🍽️', 'Dine-in & takeout', 'Seasonal menu cooked to order with fresh local ingredients.'], ['🎉', 'Private events', 'Birthdays, family dinners and celebrations in a welcoming space.'], ['🥡', 'Delivery & catering', 'Your favourites, delivered or set up for your next event.']], stats: [['years', '12'], ['dishes', '48'], ['rating', '4.9']] },
  cafe: { label: 'Coffee Shop', emoji: '☕', tagline: 'Great coffee, made to order, every morning.', services: [['☕', 'Specialty coffee', 'Freshly roasted beans brewed your way.'], ['🥐', 'Fresh pastries', 'Baked daily — croissants, muffins and more.'], ['💻', 'Cozy workspace', 'Free Wi-Fi and plenty of outlets to get work done.']], stats: [['cups/day', '600'], ['roasts', '12'], ['rating', '4.8']] },
  plumbing: { label: 'Plumbing', emoji: '🔧', tagline: 'Fast, reliable plumbing — repaired right the first time.', services: [['🚨', 'Emergency repairs', '24/7 rapid response for leaks, bursts and clogs.'], ['🔧', 'Installation', 'Sinks, pipes, water heaters and fixtures installed to code.'], ['🧹', 'Drain cleaning', 'Clear blockages and keep drains flowing year-round.'], ['🗓️', 'Maintenance plans', 'Scheduled inspections that prevent costly surprises.']], stats: [['hours', '24/7'], ['jobs', '3200'], ['rating', '4.9']] },
  electrician: { label: 'Electrician', emoji: '⚡', tagline: 'Certified electricians for safe, reliable power.', services: [['💡', 'Rewiring', 'Renovation and whole-home rewiring done safely.'], ['🔌', 'Repairs', 'Faulty outlets, switches and panels fixed fast.'], ['🔋', 'EV & solar', 'Chargers and solar-ready panel upgrades.']], stats: [['jobs', '2800'], ['years', '18'], ['rating', '4.9']] },
  hvac: { label: 'Heating & Cooling', emoji: '❄️', tagline: 'Comfortable temperature, all year round.', services: [['❄️', 'AC repair', 'Fast fixes for air conditioners that quit.'], ['🔥', 'Furnace service', 'Tune-ups and repairs to keep the heat flowing.'], ['🌱', 'Installation', 'Efficient new systems fitted cleanly and to code.']], stats: [['units', '1500'], ['years', '20'], ['rating', '4.8']] },
  salon: { label: 'Hair & Beauty', emoji: '💇‍♀️', tagline: 'Look and feel your best.', services: [['✂️', 'Haircuts & styling', 'Precision cuts and styling for every look.'], ['🎨', 'Color & balayage', 'Rich, dimensional color by experienced stylists.'], ['💅', 'Nails & brows', 'Manicures, pedicures and brow shaping.']], stats: [['clients', '5000'], ['stylists', '8'], ['rating', '4.9']] },
  dental: { label: 'Dental', emoji: '🦷', tagline: 'Healthy smiles, comfortable visits.', services: [['🦷', 'Check-ups & cleaning', 'Gentle preventive care that keeps teeth healthy.'], ['✨', 'Whitening', 'Safe, professional-grade whitening.'], ['🩺', 'Restorative', 'Fillings, crowns and implants done right.']], stats: [['patients', '4000'], ['years', '15'], ['rating', '4.9']] },
  medical: { label: 'Medical / Clinic', emoji: '🩺', tagline: 'Caring, expert healthcare.', services: [['🩺', 'General check-ups', 'Comprehensive exams and preventive screening.'], ['💉', 'Vaccinations', 'Immunisations for the whole family.'], ['🩻', 'Diagnostics', 'On-site testing and lab work.'], ['🩹', 'Minor procedures', 'Quick, careful treatment of minor issues.']], stats: [['patients', '9000'], ['specialists', '12'], ['rating', '4.9']] },
  fitness: { label: 'Fitness & Training', emoji: '🏋️', tagline: 'Train smarter, reach your goals.', services: [['🏋️', 'Personal training', '1:1 coaching tailored to your goals.'], ['🧘', 'Group classes', 'High-energy classes for every level.'], ['📋', 'Nutrition plans', 'Plans that support your training.']], stats: [['members', '800'], ['classes', '30'], ['rating', '4.9']] },
  realestate: { label: 'Real Estate', emoji: '🏠', tagline: 'Find the right home, fast.', services: [['🏡', 'Buying', 'Expert guidance to your dream home.'], ['🏷️', 'Selling', 'Maximise value with smart marketing.'], ['🔑', 'Renting', 'Quality rentals and great tenants.']], stats: [['homes sold', '650'], ['years', '14'], ['rating', '4.8']] },
  auto: { label: 'Auto Repair', emoji: '🚗', tagline: 'Honest, quality auto repair.', services: [['🔧', 'Repair & maintenance', 'From brakes to full service.'], ['🛞', 'Tires & alignment', 'Correct fit and alignment for safety.'], ['🛠️', 'Diagnostics', 'Modern computerised diagnostics.']], stats: [['cars', '7000'], ['years', '22'], ['rating', '4.9']] },
  construction: { label: 'Construction & Remodeling', emoji: '🏗️', tagline: 'Built right, on time, on budget.', services: [['🏗️', 'New builds', 'From foundation to finished.'], ['🔨', 'Remodeling', 'Kitchens, baths and additions.'], ['✅', 'Project management', 'One trusted team, end to end.']], stats: [['projects', '340'], ['years', '25'], ['rating', '4.9']] },
  education: { label: 'Education & Tutoring', emoji: '🎓', tagline: 'Learn better with expert tutors.', services: [['📚', '1:1 tutoring', 'Personalised attention that works.'], ['📝', 'Test prep', 'Focused prep for exams.'], ['🧑‍🏫', 'Online lessons', 'Learn from anywhere, live.']], stats: [['students', '1200'], ['tutors', '15'], ['rating', '4.9']] },
  legal: { label: 'Legal', emoji: '⚖️', tagline: 'Clear guidance when it matters.', services: [['📄', 'Consultations', 'Confidential advice on your matter.'], ['📝', 'Contracts', 'Drafting and reviewing agreements.'], ['⚖️', 'Representation', 'Skilled representation in negotiations.']], stats: [['cases', '900'], ['years', '16'], ['rating', '4.9']] },
  saas: { label: 'Software / SaaS', emoji: '💻', tagline: 'Software that saves you hours every day.', services: [['🚀', 'Core platform', 'Everything your team needs in one place.'], ['🔌', 'Integrations', 'Works with the tools you already use.'], ['🛟', 'Priority support', 'Real humans, fast answers.'], ['📈', 'Analytics', 'Insights that drive decisions.']], stats: [['teams', '2400'], ['uptime', '99.9'], ['rating', '4.8']] },
  agency: { label: 'Agency / Studio', emoji: '🎨', tagline: 'Creative work that moves the needle.', services: [['🎨', 'Branding', 'Identity systems people remember.'], ['🌐', 'Websites', 'Fast, beautiful, conversion-focused.'], ['📣', 'Marketing', 'Campaigns that reach the right people.'], ['📈', 'Growth', 'Data-backed strategy and execution.']], stats: [['clients', '180'], ['projects', '520'], ['rating', '4.9']] },
  photography: { label: 'Photography', emoji: '📸', tagline: 'Moments captured beautifully.', services: [['📸', 'Portraits', 'Personal and family sessions.'], ['💍', 'Events & weddings', 'You celebrate, we capture.'], ['🏢', 'Commercial', 'Brand and product imagery.']], stats: [['shoots', '900'], ['years', '10'], ['rating', '4.9']] },
  cleaning: { label: 'Cleaning', emoji: '🧽', tagline: 'A spotless space, every time.', services: [['🧽', 'Home cleaning', 'Recurring and one-time cleans.'], ['🏢', 'Office cleaning', 'Fresh workspaces that impress.'], ['🪟', 'Deep clean', 'The thorough top-to-bottom clean.']], stats: [['clients', '750'], ['teams', '20'], ['rating', '4.9']] },
  landscaping: { label: 'Landscaping', emoji: '🌿', tagline: 'Outdoor spaces that wow.', services: [['🌿', 'Design', 'Plans tailored to your yard.'], ['✂️', 'Maintenance', 'Lawns and gardens kept pristine.'], ['🌳', 'Installation', 'Planting, hardscaping and more.']], stats: [['jobs', '1100'], ['years', '12'], ['rating', '4.9']] },
  default: { label: 'Business', emoji: '🚀', tagline: 'Professional service you can count on.', services: [['⭐', 'Quality you can trust', 'Consistent, high-quality work every time.'], ['⚡', 'Fast response', 'Quick follow-up and on-time delivery.'], ['🤝', 'Fair pricing', 'Transparent quotes with no surprises.'], ['🏅', 'Experienced team', 'Skilled people who care about the result.']], stats: [['years', '15'], ['clients', '1200'], ['rating', '4.9']] },
};
const NX_INDUSTRY_RULES = [
  [/sushi|pizza|grill|restaurant|bistro|bakery|pastry|cater/ig, 'restaurant'],
  [/cafe|coffee|espresso|barista|latte/ig, 'cafe'],
  [/plumb|drain|pipe|water heater|leak|septic/ig, 'plumbing'],
  [/electr|wiring|outlet|panel|generator/ig, 'electrician'],
  [/hvac|air conditioning|furnace|heating|ac repair/ig, 'hvac'],
  [/hair|salon|beauty|herbal/ig, 'salon'],
  [/dent|teeth|orthod/ig, 'dental'],
  [/clinic|medical|doctor|physician|health|pharmacy/ig, 'medical'],
  [/fitness|gym|personal trainer|yoga|workout/ig, 'fitness'],
  [/real estate|realtor|property|apartment|house for sale/ig, 'realestate'],
  [/auto|mechanic|cars|tires|garage|detailing/ig, 'auto'],
  [/construction|contractor|remodel|renovat|builder/ig, 'construction'],
  [/tutor|school|academy|training|learn|course/ig, 'education'],
  [/law|legal|attorney|lawyer/ig, 'legal'],
  [/software|saas|app|platform|tech|cloud|api/ig, 'saas'],
  [/agency|studio|marketing|advertis|brand|design/ig, 'agency'],
  [/photograph|photo|videograph|video|wedding/ig, 'photography'],
  [/clean|housekeeping|disinfect/ig, 'cleaning'],
  [/landscap|garden|lawn|lawn care/ig, 'landscaping'],
];
function detectIndustry(name, desc) {
  const text = String(name + ' ' + (desc || ''));
  for (const [re, id] of NX_INDUSTRY_RULES) if (re.test(text)) return NX_INDUSTRIES[id];
  return NX_INDUSTRIES.default;
}

// ── Content plan ─────────────────────────────────────────────────────────────
function estimateServices(desc) {
  // Only treat a desc as an explicit service list if it is `;`-delimited into
  // two-or-more short items — prose with a comma should NOT become a list.
  const items = String(desc || '').split(';').map(s => s.trim()).filter(Boolean);
  if (items.length >= 2 && items.length <= 6 && items.every(i => i.length < 60)) return items;
  return null;
}
function buildContentPlan(name, desc, opts) {
  opts = opts || {};
  const existing = (opts.plan && typeof opts.plan === 'object') ? opts.plan : {};
  const ind = detectIndustry(name, desc);
  const rawSvcs = Array.isArray(existing.services) ? existing.services : null;
  const services0 = (rawSvcs && rawSvcs.length)
    ? rawSvcs.map(nxNormalizeService).slice(0, 6)
    : (estimateServices(desc) || ind.services).map(function (s, i) {
        if (Array.isArray(s)) return { icon: s[0], title: s[1], text: s[2] };
        return { icon: '⭐', title: String(s).slice(0, 28), text: String(s).slice(0, 90) || ind.tagline };
      });
  const rawWhy = Array.isArray(existing.why) ? existing.why : (Array.isArray(existing.why_us) ? existing.why_us : null);
  const why = (rawWhy && rawWhy.length)
    ? rawWhy.map(w => (typeof w === 'string' ? { check: w.slice(0, 60), text: ind.tagline } : { check: (w.check || w.title || '').slice(0, 60), text: (w.text || w.desc || '').slice(0, 140) }))
    : [
      { check: 'Licensed & insured professionals', text: 'Rest easy knowing the job is done right.' },
      { check: 'Upfront, honest pricing', text: 'No hidden fees — you approve the cost first.' },
      { check: 'On-time, every time', text: 'We respect your schedule and your home.' },
      { check: 'Satisfaction guaranteed', text: 'We are not done until you are happy.' },
    ];
  const rawProc = Array.isArray(existing.process) ? existing.process : null;
  const process = (rawProc && rawProc.length)
    ? rawProc.map(nxNormalizeProcess)
    : [
      { step: 1, title: 'Reach out', text: 'Tell us what you need — call, email or message.' },
      { step: 2, title: 'Get a clear quote', text: 'Transparent pricing with no surprises.' },
      { step: 3, title: 'We deliver', text: 'Skilled work, done on time and to standard.' },
      { step: 4, title: 'We follow up', text: 'We check in to make sure you are happy.' },
    ];
  const rawRev = Array.isArray(existing.reviews) ? existing.reviews : null;
  const reviews = (rawRev && rawRev.length)
    ? rawRev.map(nxNormalizeReview)
    : [
      { name: 'Aisha M.', role: 'Local customer', quote: 'Absolutely outstanding service — fast, friendly and fairly priced.', stars: 5 },
      { name: 'Omar K.', role: 'Repeat customer', quote: 'I would not go anywhere else. They really care about getting it right.', stars: 5 },
      { name: 'Laila R.', role: 'Recent client', quote: 'On time, professional and thorough. Highly recommended.', stars: 5 },
    ];
  const phone = (existing.contact && existing.contact.phone) || (String(desc).match(/[+()0-9\s-]{7,}/) || [])[0] || '';
  const email = (existing.contact && existing.contact.email) || (String(desc).match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i) || [])[0] || '';
  const title0 = String(existing.hero_headline || existing.title || '').trim();
  const sub0 = String(existing.hero_sub || existing.sub || (desc || '')).replace(/\s+/g, ' ').trim();
  const faqs0 = Array.isArray(existing.faqs)
    ? existing.faqs.map(f => ({ q: String(f.q || '').slice(0, 120), a: String(f.a || '').slice(0, 320) })).filter(f => f.q)
    : (Array.isArray(existing.faq) ? existing.faq.map(f => ({ q: String(f.q || '').slice(0, 120), a: String(f.a || '').slice(0, 320) })).filter(f => f.q) : null);
  return {
    _industry: ind.id,
    meta_desc: String(desc || ind.tagline).slice(0, 200),
    tagline: ind.tagline,
    hero: {
      badge: String(existing.badge || 'Serving ' + name + ' & the community'),
      title: title0 || ('Welcome to ' + String(name || '').split(' ')[0] || 'us'),
      sub: sub0 || ind.tagline,
      primary: String(existing.cta_primary || 'Get a free quote').slice(0, 12),
      secondary: String(existing.cta_secondary || 'Explore services').slice(0, 12),
      image: (existing.hero_image || existing.about_image || '') || '',
    },
    services: services0,
    stats: (Array.isArray(existing.stats) && existing.stats.length)
      ? existing.stats.map(s => ({ label: String(s.label || s.name || '').slice(0, 30), value: String(s.value != null ? s.value : 0) }))
      : ind.stats.map(function (s) { return { label: s[0], value: s[1] }; }),
    why: why,
    about: {
      heading: String(existing.about_heading || ('About ' + (name || ''))).slice(0, 60),
      body: String(existing.about || sub0 || ('We are a trusted local ' + ind.label.toLowerCase() + ' delivering dependable, high-quality service with a personal touch.')).slice(0, 420),
      image: existing.about_image || '',
    },
    process: process,
    reviews: reviews,
    pricing: (Array.isArray(existing.pricing) && existing.pricing.length) ? existing.pricing.map(nxNormalizePlan) : null,
    team: (Array.isArray(existing.team) && existing.team.length) ? existing.team.map(nxNormalizePlan) : null,
    timeline: (Array.isArray(existing.timeline) && existing.timeline.length) ? existing.timeline.map(nxNormalizePlan) : null,
    logos: (Array.isArray(existing.logos) && existing.logos.length) ? existing.logos : null,
    gallery_imgs: (Array.isArray(existing.gallery_imgs) && existing.gallery_imgs.length) ? existing.gallery_imgs : [],
    video_url: existing.video_url || '',
    faq: faqs0 || [
      { q: 'Do you offer free estimates?', a: 'Yes — contact us and we will give you a clear, no-obligation quote for the job.' },
      { q: 'How quickly can you come out?', a: 'We prioritise urgent requests and can usually schedule an appointment within a day or two.' },
      { q: 'Are you licensed and insured?', a: 'Absolutely. Every job is carried out by a qualified, fully covered professional you can trust.' },
      { q: 'What is your service area?', a: 'We serve ' + name + ' and the surrounding areas at no extra travel charge.' },
    ],
    contact: {
      phone: phone.trim(),
      email: email.trim(),
      address: String((existing.contact && existing.contact.address) || '').slice(0, 200),
      hours: String((existing.contact && existing.contact.hours) || 'Mon – Fri 9:00 – 17:00').slice(0, 80),
    },
    working_hours: (Array.isArray(existing.working_hours) && existing.working_hours.length) ? existing.working_hours : ['Mon – Fri 9:00 – 17:00', 'Sat 10:00 – 14:00', 'Sun Closed'],
    cta: { heading: String(existing.lead_title || existing.cta_heading || ('Ready to get started with ' + (name || 'us') + '?')).slice(0, 60), sub: String(existing.lead_text || existing.cta_sub || 'Get in touch today for a fast, friendly response.').slice(0, 140), primary: String(existing.cta_primary || 'Get a free quote').slice(0, 12) },
  };
}
function nxNormalizeService(s) {
  if (typeof s === 'string') return { icon: '⭐', title: String(s).slice(0, 28), text: String(s).slice(0, 120) };
  if (Array.isArray(s)) return { icon: s[0] || '⭐', title: String(s[1] || '').slice(0, 28), text: String(s[2] || '').slice(0, 140) };
  return { icon: String(s.icon || '⭐').slice(0, 4), title: String(s.title || '').slice(0, 28), text: String(s.text || s.desc || '').slice(0, 140) };
}
function nxNormalizeProcess(p, i) {
  if (typeof p === 'string') return { step: i + 1, title: p.slice(0, 60), text: 'A clear, simple step in our process.' };
  return { step: p.step || i + 1, title: String(p.title || '').slice(0, 60), text: String(p.text || p.desc || '').slice(0, 180) };
}
function nxNormalizeReview(r) {
  if (typeof r === 'string') return { name: 'A Happy Client', role: '', quote: r.slice(0, 200), stars: 5 };
  return { name: String(r.name || 'A Happy Client').slice(0, 60), role: String(r.role || '').slice(0, 60), quote: String(r.text || r.quote || '').slice(0, 240), stars: Math.max(1, Math.min(5, Number(r.stars) || 5)) };
}
function nxNormalizePlan(p, i) {
  if (typeof p === 'string') return { name: String(p).slice(0, 40), price: '', per: '', features: [], text: '' };
  return { name: String(p.name || p.title || p['Plan'] || '').slice(0, 60), price: String(p.price || '').slice(0, 20), per: String(p.per || p.unit || '').slice(0, 12), features: Array.isArray(p.features) ? p.features.map(String) : [], text: String(p.text || p.desc || '').slice(0, 160), year: String(p.year || '').slice(0, 12), role: String(p.role || '').slice(0, 60), emoji: String(p.emoji || '👤').slice(0, 4), popular: !!p.popular, bio: String(p.bio || '').slice(0, 160) };
}

// ── Section rendering (uses ONLY the design-system .nx-* classes) ───────────
function renderSectionsHtml(plan, opts) {
  opts = opts || {};
  const P = plan || {};
  const brand = String(P.name || 'My Business');
  const name = brand;
  const h = P.hero || {};
  const contact = P.contact || {};
  const hasSec = (key) => Array.isArray(P[key]) && P[key].length > 0;
  const hasPricing = hasSec('pricing'), hasTeam = hasSec('team'), hasTimeline = hasSec('timeline'),
        hasLogos = hasSec('logos'), hasGallery = hasSec('gallery_imgs'), hasVideo = !!P.video_url, hasMap = !!contact.address;

  const navAnchors = ['#home', '#services', '#about', '#process'];
  if (hasPricing) navAnchors.push('#pricing');
  if (hasGallery) navAnchors.push('#gallery');
  navAnchors.push('#reviews', '#faq', '#contact');
  const navAnchorLabels = { '#home': 'Home', '#services': 'Services', '#about': 'About', '#process': 'Process', '#pricing': 'Pricing', '#gallery': 'Gallery', '#reviews': 'Reviews', '#faq': 'FAQ', '#contact': 'Contact' };

  const reveal = (delay) => 'data-reveal' + (delay ? ' data-delay="' + delay + '"' : '');

  // NAV
  let out = `<nav class="nx-nav"><div class="container nx-nav-inner">
    <div class="nx-brand">${__be(brand)}</div>
    <button class="nx-menu-btn" aria-label="Menu">☰</button>
    <ul class="nx-nav-links">${navAnchors.map(a => `<li><a href="${a}">${navAnchorLabels[a]}</a></li>`).join('')}</ul>
  </div></nav>`;

  // HERO
  out += `<section class="nx-hero" id="home"><div class="container nx-hero-inner">
    <div ${reveal()}><span class="nx-badge"><span class="dot"></span> ${__be(h.badge || 'Trusted local service')}</span>
    <h1>${nxGradTitle(h.title || 'Welcome')}</h1>
    <p class="lead">${__be(h.sub || '')}</p>
    <div class="nx-hero-actions"><a class="btn btn-primary" href="#contact">${__be(h.primary || 'Get a free quote')}</a><a class="btn btn-ghost" href="#services">${__be(h.secondary || 'Explore services')}</a></div></div>
    ${h.image ? `<div class="nx-hero-img"><img src="${__be(h.image)}" alt="${__be(brand)}" loading="eager"></div>` : ''}
  </div></section>`;

  // MARQUEE
  out += `<div class="nx-marquee"><div class="nx-marquee-track">${['Quality you can trust', 'Fast response', 'Local experts', 'Fair pricing', 'Satisfaction guaranteed'].map(t => `<span>${__be(t)}</span>`).join('')}</div></div>`;

  // STATS
  if (hasSec('stats') || P.stats) out += `<section class="section"><div class="container"><div class="nx-stats">${(P.stats || []).map((s, i) => `<div class="nx-stat" ${reveal(i)}><b data-count="${__beNum(s.value)}">${__beNum(s.value)}</b><span>${__be(s.label)}</span></div>`).join('')}</div></div></section>`;

  // SERVICES
  if (hasSec('services')) out += `<section class="section" id="services"><div class="container">
    <div ${reveal()}>${'<span class="eyebrow">What we do</span>'} <h2 class="sec-title">Our <span class="grad-text">services</span></h2></div>
    <div class="nx-grid g3">${(P.services || []).map((s, i) => `<div class="nx-card" ${reveal(i === 0 ? '' : String(i % 3))}><div class="ic">${__be(s.icon || '⭐')}</div><h3>${__be(s.title)}</h3><p>${__be(s.text)}</p></div>`).join('')}</div>
  </div></section>`;

  // WHY (split with checks)
  if (hasSec('why') || P.why) out += `<section class="section"><div class="container"><div class="nx-split">
    <div ${reveal()}>${'<span class="eyebrow">Why choose us</span>'} <h2 class="sec-title">The <span class="grad-text">difference</span></h2>
    ${(P.why || []).map((w, i) => `<div class="nx-check" ${reveal((i % 3) + 1)}><b>✔</b><div><b>${__be(w.check)}</b><span>${__be(w.text)}</span></div></div>`).join('')}</div>
    <div ${reveal()}>${__be(P.about ? P.about.body : '')}</div></div>
  </div></section>`;

  // ABOUT
  if (P.about) out += `<section class="section" id="about"><div class="container"><div class="nx-split">
    <div ${reveal()}>${'<span class="eyebrow">About us</span>'} <h2 class="sec-title">${__be(P.about.heading || 'About us')}</h2><p>${__be(P.about.body)}</p></div>
    <div ${reveal()} class="nx-hero-img">${P.about.image ? `<img src="${__be(P.about.image)}" alt="${__be(name)} about" loading="lazy">` : ''}</div>
  </div></div></section>`;

  // PROCESS
  if (hasSec('process') || P.process) out += `<section class="section" id="process"><div class="container">
    <div ${reveal()}>${'<span class="eyebrow">How it works</span>'} <h2 class="sec-title">Our <span class="grad-text">process</span></h2></div>
    <div class="nx-steps">${(P.process || []).map((r) => `<div class="nx-step" ${reveal()}><span class="n">${__beNum(r.step)}</span><h3>${__be(r.title)}</h3><p>${__be(r.text)}</p></div>`).join('')}</div>
  </div></section>`;

  // PRICING
  if (hasPricing) out += `<section class="section" id="pricing"><div class="container">
    <div ${reveal()}>${'<span class="eyebrow">Pricing</span>'} <h2 class="sec-title">Simple, <span class="grad-text">clear</span> pricing</h2></div>
    <div class="nx-grid g3">${(P.pricing || []).map((p, i) => `<div class="nx-card ${p.popular ? 'popular' : ''}" ${reveal()}>
      <div class="pl">${__be(p.name)}</div><b>${__be(p.price)}${p.per ? '<span class="per"> / ' + __be(p.per) + '</span>' : ''}</b>
      <ul>${(p.features || []).map(f => `<li>${__be(f)}</li>`).join('')}</ul><a class="btn btn-primary" href="#contact">Choose</a></div>`).join('')}</div>
  </div></section>`;

  // TEAM
  if (hasTeam) out += `<section class="section" id="team"><div class="container">
    <div ${reveal()}>${'<span class="eyebrow">Meet the team</span>'} <h2 class="sec-title">The <span class="grad-text">people</span> behind it</h2></div>
    <div class="nx-grid g2">${(P.team || []).map((m) => `<div class="nx-card" ${reveal()}><div class="ic">${__be(m.emoji || '👤')}</div><h3>${__be(m.name)}</h3><p>${__be(m.role || '')}</p>${m.bio ? `<p>${__be(m.bio)}</p>` : ''}</div>`).join('')}</div>
  </div></section>`;

  // TIMELINE
  if (hasTimeline) out += `<section class="section" id="timeline"><div class="container">
    <div ${reveal()}>${'<span class="eyebrow">Our journey</span>'} <h2 class="sec-title">Milestones we are <span class="grad-text">proud</span> of</h2></div>
    <div class="nx-steps">${(P.timeline || []).map((t) => `<div class="nx-step" ${reveal()}><span class="n">${__be(t.year)}</span><h3>${__be(t.title)}</h3><p>${__be(t.text)}</p></div>`).join('')}</div>
  </div></section>`;

  // LOGOS
  if (hasLogos) out += `<section class="section" id="logos"><div class="container"><div class="nx-grid g3">${(P.logos || []).map((lg) => `<div class="nx-card" ${reveal()}><h3>${__be(lg)}</h3><p>Trusted partner</p></div>`).join('')}</div></div></section>`;

  // VIDEO
  if (hasVideo) out += `<section class="section"><div class="nx-parallax">${`<div class="container">`}<h2>See us in <span class="grad-text">action</span></h2><p>Take a quick look.</p>${embedVideo(P.video_url)}</div></section>`;

  // GALLERY
  if (hasGallery) out += `<section class="section" id="gallery"><div class="container">
    <div ${reveal()}>${'<span class="eyebrow">Gallery</span>'} <h2 class="sec-title">A look at our <span class="grad-text">work</span></h2></div>
    <div class="nx-gallery">${(P.gallery_imgs || []).map((g) => `<img src="${__be(g)}" alt="${__be(brand)} ${__be(Number(P.gallery_imgs.indexOf(g)) + 1)}" loading="lazy">`).join('')}</div>
  </div></section>`;

  // REVIEWS
  if (hasSec('reviews') || P.reviews) out += `<section class="section" id="reviews"><div class="container">
    <div ${reveal()}>${'<span class="eyebrow">Testimonials</span>'} <h2 class="sec-title">What our <span class="grad-text">clients</span> say</h2></div>
    <div class="nx-tstrip">${(P.reviews || []).map((r) => `<div class="nx-review" ${reveal()}><div class="stars">${'★'.repeat(Math.max(1, Math.min(5, Number(r.stars) || 5)))}</div><p>“${__be(r.quote)}”</p><div class="who"><b>${__be(r.name)}</b><span>${__be(r.role || '')}</span></div></div>`).join('')}</div>
  </div></section>`;

  // LEAD / CTA
  const cta = P.cta || {};
  out += `<section class="section nx-lead"><div class="container" ${reveal()}><h2>${__be(cta.heading || 'Ready to get started?')}</h2><p>${__be(cta.sub || 'Get in touch today.')}</p><a class="btn btn-primary" href="#contact">${__be(cta.primary || 'Get a free quote')}</a></div></section>`;

  // FAQ
  if (hasSec('faq') || P.faq) out += `<section class="section" id="faq"><div class="container">
    <div ${reveal()}>${'<span class="eyebrow">FAQ</span>'} <h2 class="sec-title">Common <span class="grad-text">questions</span></h2></div>
    <div class="nx-faq">${(P.faq || []).map((f) => `<div class="nx-faq-item" ${reveal()}><div class="nx-faq-q">${__be(f.q)}</div><div class="nx-faq-a">${__be(f.a)}</div></div>`).join('')}</div>
  </div></section>`;

  // CONTACT
  out += `<section class="section" id="contact"><div class="container"><div class="nx-contact-grid">
    <div class="nx-cinfo" ${reveal()}>
      <div><div><b>Contact us</b><span>${__be(contact.phone || 'Call us')}${contact.email ? ' · ' + __be(contact.email) : ''}</span></div></div>
      <div><div><b>Working hours</b><span>${Array.isArray(P.working_hours) ? P.working_hours.map(__be).join(' · ') : __be(contact.hours || '')}</span></div></div>
      ${contact.address ? `<div><div><b>Address</b><span>${__be(contact.address)}</span></div></div>` : ''}
    </div>
    <form class="nx-form"><input name="name" placeholder="Your name" required aria-label="Your name"><input name="email" type="email" placeholder="Email" required aria-label="Email"><input name="phone" placeholder="Phone" aria-label="Phone"><textarea name="message" placeholder="How can we help?" required aria-label="Message"></textarea><button class="btn btn-primary" type="submit">Send message</button><div class="ok">✅ Thanks! We will get back to you shortly.</div></form>
  </div></div></section>`;

  // MAP
  if (hasMap) out += `<section class="section" id="map"><div class="container">${embedMap(contact.address)}</div></section>`;

  // FOOTER
  out += `<footer class="nx-footer"><div class="container">© ${new Date().getFullYear()} ${name} — built with NexusCRM</div></footer>`;
  return out;
}

function nxGradTitle(t) {
  // Escape the title, then wrap the LAST word in .grad-text (applied AFTER
  // escaping so the inserted <span> is never double-encoded).
  const words = String(t || 'Welcome').replace(/\s+/g, ' ').trim().split(' ');
  const last = words.pop() || 'Welcome';
  const head = words.map(__be).join(' ');
  return (head ? head + ' ' : '') + '<span class="grad-text">' + __be(last) + '</span>';
}
function embedVideo(url) {
  const u = String(url || '');
  const m = u.match(/(?:youtu\.be\/|youtube\.com\/embed\/|v=)([\w-]{6,})/) || [];
  const id = m[1];
  if (!id) return `<div class="nx-video"><a class="btn btn-ghost" href="${__be(u)}" target="_blank" rel="noopener">Watch video</a></div>`;
  return `<div class="nx-video"><iframe src="https://www.youtube.com/embed/${id}" title="Video" loading="lazy" allowfullscreen></iframe></div>`;
}
function embedMap(address) {
  const q = encodeURIComponent(String(address || ''));
  return `<div class="nx-map"><iframe src="https://www.google.com/maps?q=${q}&output=embed" title="Map" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectIndustry, buildContentPlan, renderSectionsHtml, NX_INDUSTRIES };
}
