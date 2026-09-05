'use strict';
// ══════════════════════════════════════════════════════════════════════════
// nx_copywriter.js — STRUCTURE + ENGLISH COPY FROM AN UNDERSTOOD BRIEF
//
// The second half of what the leading prompt-to-website builders do:
//   1. SITEMAP FIRST (Relume / Framer): choose the sections a *florist* needs
//      (occasions, delivery, gallery) vs a *law firm* (practice areas,
//      credentials, consultation) vs a *game studio* (game showcase, wishlist,
//      devlog) — different section sets and orders, not one checklist.
//   2. COPY PER INDUSTRY & TONE (Squarespace Blueprint / Wix): a real
//      headline, sub-headline, service descriptions, about, process, FAQ and
//      CTAs written for THIS business, in the personality the brief asked for.
//   3. NEVER INVENT (the thing every review says AI builders get wrong): no
//      "10 years experience", no "500 happy clients", no fake testimonials.
//      Proof sections render ONLY the numbers/quotes the owner supplied; when
//      there are none the section is omitted and a trust strip built from the
//      brief's real differentiators takes its place.
//   4. WRITE TO FIT: every slot has a character budget; a phrase that does not
//      fit is replaced by a shorter phrase — never truncated mid-word.
//
// Input : the brief object from nx_brief.js (nxUnderstandBrief)
// Output: { plan (content plan compatible with renderSectionsHtml / compose /
//           template paths), sitemap, tokens hints, rationale, warnings }
// Deterministic, dependency-free, English-first.
// ══════════════════════════════════════════════════════════════════════════

const BUDGET = { headline: 64, sub: 170, kicker: 30, cta: 22, ctaSecondary: 20, cardTitle: 34, cardBody: 150, sectionTitle: 56, faqQ: 90, faqA: 260, about: 520, badge: 46, marquee: 26, lead: 62, leadSub: 150 };

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const cap = (s) => { const t = clean(s); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };
const low = (s) => clean(s).toLowerCase();
const uniq = (arr) => { const seen = new Set(); return arr.filter((x) => { const k = low(x); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
const pick = (arr, seed, salt) => arr[(Math.abs((seed >>> 0) + (salt || 0) * 7919) % arr.length)];

// Choose the longest candidate that fits the budget; never cut a word.
function fit(candidates, budget) {
  const list = (Array.isArray(candidates) ? candidates : [candidates]).map(clean).filter(Boolean);
  for (const c of list) if (c.length <= budget) return c;
  const s = list[list.length - 1] || '';
  if (!s) return '';
  const cut = s.slice(0, budget + 1);
  const at = cut.lastIndexOf(' ');
  return (at > budget * 0.5 ? cut.slice(0, at) : cut.slice(0, budget)).replace(/[,;:\-–—]+$/, '');
}

// ── Industry playbooks ───────────────────────────────────────────────────────
// Each playbook says: what the visitor came for (outcome), the words the
// industry uses (nouns), typical offerings WITH honest one-line descriptions
// (used only when the brief lists none, and flagged as suggestions), FAQ that
// is true of any competent operator, and the section set that suits it.
const PLAYBOOKS = {
  florist: { outcome: 'flowers that say it for you', noun: 'arrangement', people: 'customers', kicker: 'The studio', sections: ['hero', 'trust', 'services', 'occasions', 'gallery', 'about', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['💐', 'Bouquets & arrangements', 'Hand-tied bouquets and vase arrangements made fresh to order.'], ['💍', 'Weddings & events', 'Bridal bouquets, table flowers and installations, planned around your day.'], ['🚚', 'Local delivery', 'Same-day delivery on orders placed before midday.'], ['🌿', 'Subscriptions', 'Fresh seasonal stems on your doorstep every week or fortnight.'], ['🎁', 'Sympathy & gifts', 'Thoughtful arrangements for the moments that matter most.']],
    occasions: ['Weddings', 'Birthdays', 'Anniversaries', 'Sympathy', 'New baby', 'Just because'],
    faq: [['Can I order for same-day delivery?', 'Yes — order before our daily cut-off and we deliver the same day within our local area. Call us for anything urgent.'], ['Can I choose the flowers?', 'Absolutely. Tell us your favourite stems and colours, or let us design something seasonal around your budget.'], ['Do you do wedding flowers?', 'We do. Book a consultation and we will plan bouquets, buttonholes, ceremony and table flowers around your venue and colours.'], ['How long will my flowers last?', 'With fresh water and a cool spot most arrangements last a week or more. Every order comes with simple care tips.']],
    process: [['Tell us the occasion', 'Who it is for, the feel you want and your budget.'], ['We design it', 'Seasonal stems, arranged by hand the day you need them.'], ['Delivered or collected', 'To their door, your venue, or ready for pick-up.']] },
  bakery: { outcome: 'baked fresh every morning', noun: 'bake', people: 'customers', kicker: 'From the oven', sections: ['hero', 'trust', 'services', 'menu', 'gallery', 'about', 'hours', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🥖', 'Breads', 'Sourdough, baguettes and loaves baked from scratch each morning.'], ['🥐', 'Pastries', 'Croissants, danishes and buns, best eaten warm.'], ['🎂', 'Celebration cakes', 'Custom cakes for birthdays, weddings and everything worth celebrating.'], ['☕', 'Coffee & counter', 'Good coffee to go with whatever just came out of the oven.'], ['🏢', 'Wholesale', 'Daily deliveries for cafés, restaurants and offices.']],
    faq: [['Do you take custom cake orders?', 'Yes. Give us a few days\u2019 notice, tell us the size, flavours and occasion, and we will design it with you.'], ['Are you open every day?', 'Our opening hours are listed below — the earlier you come, the wider the choice.'], ['Do you cater for allergies?', 'Ask us about any allergy or dietary need and we will tell you exactly what each bake contains.'], ['Can I pre-order?', 'Yes — call or message ahead and we will have your order ready for collection.']],
    process: [['Baked before dawn', 'Every loaf and pastry made by hand each morning.'], ['Fresh at the counter', 'Come in early for the fullest shelves.'], ['Orders for occasions', 'Cakes and platters made to order with a little notice.']] },
  cafe: { outcome: 'good coffee, made properly', noun: 'cup', people: 'regulars', kicker: 'The café', sections: ['hero', 'trust', 'menu', 'about', 'gallery', 'hours', 'proof', 'faq', 'lead', 'contact'],
    offers: [['☕', 'Specialty coffee', 'Espresso, filter and cold brew from carefully roasted beans.'], ['🥐', 'Breakfast & brunch', 'Simple, fresh plates served all morning.'], ['🍰', 'Cakes & bakes', 'Baked in small batches, changing with the season.'], ['🛋️', 'A place to work', 'Fast Wi-Fi, good light and plenty of plug sockets.'], ['🎉', 'Private hire', 'Book the space for meetings, launches and small celebrations.']],
    faq: [['Do you have plant-based milk?', 'Yes — oat and other alternatives are always available.'], ['Can I work from the café?', 'You are welcome to. We have Wi-Fi and plenty of seating; we only ask that you keep the coffee coming during busy hours.'], ['Do you serve food all day?', 'Our kitchen hours are listed with our opening times below.'], ['Is the café dog-friendly?', 'Well-behaved dogs are welcome — water bowls are by the door.']],
    process: [['Beans we trust', 'Sourced from roasters we know by name.'], ['Made to order', 'Every cup dialled in by a trained barista.'], ['Stay a while', 'Good seats, good light, no rush.']] },
  restaurant: { outcome: 'a table worth coming back to', noun: 'dish', people: 'guests', kicker: 'The kitchen', sections: ['hero', 'trust', 'menu', 'about', 'gallery', 'hours', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🍽️', 'Lunch & dinner', 'A seasonal menu cooked to order with ingredients we would serve our own families.'], ['🥂', 'Private dining', 'Set menus and a private space for parties, celebrations and corporate dinners.'], ['🥡', 'Takeaway & delivery', 'The same dishes, packed carefully, ready when you are.'], ['🎉', 'Events & catering', 'Our kitchen, at your venue.']],
    faq: [['Do I need to book?', 'Walk-ins are welcome when we have space, but booking guarantees your table — especially on weekends.'], ['Can you cater for dietary needs?', 'Yes. Tell us about allergies or preferences when you book and the kitchen will look after you.'], ['Do you have parking?', 'Details on parking and how to find us are in the contact section below.'], ['Can I book the space for a private event?', 'Yes — get in touch with your date and numbers and we will put together a menu and a quote.']],
    process: [['Book a table', 'Online, by phone or just walk in.'], ['Cooked to order', 'Seasonal ingredients, prepared fresh.'], ['Come back soon', 'Regulars are how we measure success.']] },
  bar: { outcome: 'the best night out on the street', noun: 'drink', people: 'guests', kicker: 'The bar', sections: ['hero', 'trust', 'menu', 'gallery', 'about', 'hours', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🍸', 'Cocktails', 'Classics done right and a house list that changes with the season.'], ['🍺', 'Beer & wine', 'A considered list of local and independent producers.'], ['🎶', 'Events & live nights', 'DJs, live music and quiz nights through the week.'], ['🎉', 'Private hire', 'Book a corner or the whole room for your celebration.']],
    faq: [['Do you take bookings?', 'Yes for groups and events — walk-ins are always welcome for a drink.'], ['Is there an age policy?', 'Valid ID is required; check our hours and events for any age-restricted nights.'], ['Do you serve food?', 'Our food and snack options are listed on the menu.'], ['Can I hire the venue?', 'Yes — send your date and guest numbers and we will send options.']],
    process: [['Pick your night', 'See what is on this week.'], ['Book or walk in', 'Groups book; friends drop in.'], ['Stay late', 'Good drinks, good company.']] },
  hotel: { outcome: 'a stay you will want to repeat', noun: 'stay', people: 'guests', kicker: 'The property', sections: ['hero', 'trust', 'rooms', 'amenities', 'gallery', 'about', 'location', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🛏️', 'Rooms & suites', 'Comfortable, quiet rooms with everything you need for a good night.'], ['🍳', 'Breakfast', 'A proper breakfast to start the day, included or à la carte.'], ['🧭', 'Local guidance', 'Our team knows the area — ask us what is worth your time.'], ['🎉', 'Events & groups', 'Space and support for weddings, retreats and meetings.']],
    faq: [['What time is check-in and check-out?', 'Check-in and check-out times are confirmed on your booking; early or late requests are handled whenever we can.'], ['Is parking available?', 'Parking and transport details are listed in the location section.'], ['Do you allow pets?', 'Contact us before booking and we will confirm our current pet policy.'], ['How do I cancel or change a booking?', 'Use the link in your confirmation or contact us directly — we will help you sort it quickly.']],
    process: [['Choose your dates', 'Check availability in seconds.'], ['Book direct', 'Best rate, no middlemen.'], ['Arrive and unwind', 'We handle the rest.']] },
  catering: { outcome: 'food your guests will talk about', noun: 'menu', people: 'clients', kicker: 'The kitchen', sections: ['hero', 'trust', 'services', 'menu', 'gallery', 'about', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🥂', 'Weddings', 'Menus designed around your day, from canapés to late-night bites.'], ['🏢', 'Corporate', 'Breakfasts, working lunches and events, delivered on time.'], ['🎉', 'Private parties', 'Birthdays, anniversaries and family gatherings.'], ['👨‍🍳', 'Private chef', 'Restaurant-quality dining at your table.']],
    faq: [['How far ahead should I book?', 'The earlier the better for large events; smaller orders can often be arranged within a few days.'], ['Can you accommodate dietary requirements?', 'Yes — every menu can be adapted for allergies and preferences.'], ['Do you provide staff and equipment?', 'We can supply service staff, crockery and equipment as part of your quote.'], ['How is pricing worked out?', 'Per head, based on menu and numbers. You get a clear written quote before anything is confirmed.']],
    process: [['Tell us about the event', 'Date, numbers, venue and the feel you want.'], ['Taste and refine', 'A menu built around you.'], ['We deliver and serve', 'You enjoy your own event.']] },
  dental: { outcome: 'healthy teeth and a smile you like', noun: 'treatment', people: 'patients', kicker: 'The practice', sections: ['hero', 'trust', 'services', 'about', 'team', 'process', 'proof', 'faq', 'hours', 'lead', 'contact'],
    offers: [['🦷', 'Check-ups & hygiene', 'Routine examinations and professional cleaning to keep problems small.'], ['✨', 'Whitening', 'Safe, dentist-supervised whitening with results you can see.'], ['🔩', 'Implants', 'A permanent, natural-looking replacement for missing teeth.'], ['😁', 'Braces & aligners', 'Straighter teeth for adults and teenagers, with discreet options.'], ['🧒', 'Children\u2019s dentistry', 'Gentle first visits that build good habits early.'], ['🚨', 'Emergency care', 'Same-day appointments for pain, breaks and swelling.']],
    faq: [['Are you taking new patients?', 'Yes — book a first appointment and we will take a full history and a look at what you need.'], ['I am nervous about the dentist. Can you help?', 'Many of our patients are. Tell us when you book and we will go at your pace and explain every step.'], ['Do you offer payment plans?', 'Ask about spreading the cost of larger treatments — we will explain the options before you commit.'], ['What should I do in a dental emergency?', 'Call us as early as possible. We keep time for emergency appointments every day we are open.']],
    process: [['Book an appointment', 'Online, by phone or WhatsApp.'], ['A thorough first visit', 'Examination, X-rays if needed, and a clear plan.'], ['Treatment at your pace', 'Costs agreed up front. No surprises.']] },
  medical: { outcome: 'care that listens first', noun: 'appointment', people: 'patients', kicker: 'The clinic', sections: ['hero', 'trust', 'services', 'about', 'team', 'process', 'proof', 'faq', 'hours', 'lead', 'contact'],
    offers: [['🩺', 'Consultations', 'Unhurried appointments with a clinician who listens.'], ['🧪', 'Tests & screening', 'On-site tests with results explained in plain language.'], ['💉', 'Vaccinations', 'Routine and travel immunisations for the whole family.'], ['👨‍👩‍👧', 'Family medicine', 'Continuity of care from childhood onwards.']],
    faq: [['How do I book?', 'Call, message or use the form below. Urgent same-day slots are kept back every day.'], ['Do you see children?', 'Yes — our clinicians see patients of all ages.'], ['Can I get a same-day appointment?', 'We reserve time each day for urgent needs. Call as early as you can.'], ['Do you accept insurance?', 'Contact us with your provider details and we will confirm what is covered.']],
    process: [['Book', 'Choose a time that suits you.'], ['Consult', 'A proper conversation, then an examination.'], ['A clear plan', 'Next steps explained, in writing if you want them.']] },
  physio: { outcome: 'move without pain again', noun: 'session', people: 'patients', kicker: 'The clinic', sections: ['hero', 'trust', 'services', 'about', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🦵', 'Injury rehabilitation', 'Structured recovery from sports, work and everyday injuries.'], ['🧘', 'Back & neck pain', 'Hands-on treatment plus exercises that stop it coming back.'], ['🏃', 'Sports physiotherapy', 'Get back to training safely, and stronger than before.'], ['💆', 'Massage therapy', 'Targeted soft-tissue work for recovery and tension.']],
    faq: [['Do I need a referral?', 'No — you can book directly.'], ['What happens at the first session?', 'An assessment, an explanation of what is going on, and treatment starts the same day.'], ['How many sessions will I need?', 'It depends on the problem. We will give you an honest estimate after the first assessment.'], ['What should I wear?', 'Comfortable clothing that lets us see and move the area we are treating.']],
    process: [['Assess', 'Understand the cause, not just the symptom.'], ['Treat', 'Hands-on therapy and a personal exercise plan.'], ['Recover', 'Back to the things you love, with tools to stay there.']] },
  vet: { outcome: 'the care your pet deserves', noun: 'visit', people: 'pet owners', kicker: 'The practice', sections: ['hero', 'trust', 'services', 'about', 'team', 'proof', 'faq', 'hours', 'lead', 'contact'],
    offers: [['🐾', 'Consultations', 'Unhurried check-ups with a vet who takes time with nervous animals.'], ['💉', 'Vaccinations & prevention', 'Vaccines, parasite control and health plans.'], ['🏥', 'Surgery', 'Routine and soft-tissue procedures with modern anaesthetic monitoring.'], ['🦷', 'Dental care', 'Cleaning and treatment to keep teeth and gums healthy.']],
    faq: [['Do you see emergencies?', 'Call us first — we will tell you exactly what to do and where to come.'], ['Which animals do you treat?', 'Dogs, cats and small pets. Ask about anything more unusual.'], ['Do you offer health plans?', 'Yes — spread the cost of routine care across the year.'], ['My pet is anxious at the vet. Can you help?', 'Tell us when you book. We will plan a calmer visit.']],
    process: [['Book', 'Routine or urgent — call or message.'], ['Examine', 'A careful check and a clear explanation.'], ['Care plan', 'Treatment and prevention agreed with you.']] },
  pharmacy: { outcome: 'advice you can trust, when you need it', noun: 'service', people: 'customers', kicker: 'The pharmacy', sections: ['hero', 'trust', 'services', 'about', 'hours', 'faq', 'lead', 'contact'],
    offers: [['💊', 'Prescriptions', 'Fast dispensing and repeat prescriptions managed for you.'], ['🩹', 'Minor ailments', 'Advice and treatment without a doctor\u2019s appointment.'], ['💉', 'Vaccinations', 'Seasonal and travel vaccinations, walk-in or booked.'], ['🧴', 'Health & beauty', 'Everyday essentials and expert product advice.']],
    faq: [['Do you deliver prescriptions?', 'Ask in store — delivery may be available for repeat prescriptions.'], ['Can I get advice without an appointment?', 'Yes — our pharmacists are available during opening hours.'], ['Do you offer vaccinations?', 'Yes. Check availability and book by phone or in store.'], ['What are your opening hours?', 'Listed below, including any late nights and weekends.']],
    process: [['Bring your prescription', 'Or send it electronically.'], ['We prepare it', 'Usually while you wait.'], ['Free advice', 'Ask us anything about your medication.']] },
  therapy: { outcome: 'a calmer, clearer way forward', noun: 'session', people: 'clients', kicker: 'The practice', sections: ['hero', 'trust', 'services', 'about', 'process', 'faq', 'lead', 'contact'],
    offers: [['🌱', 'Individual therapy', 'Confidential one-to-one sessions at your pace.'], ['💞', 'Couples therapy', 'A safe space to work through what is hard to say.'], ['🧠', 'Anxiety & stress', 'Practical tools alongside deeper work.'], ['💻', 'Online sessions', 'The same care, from wherever you are.']],
    faq: [['How do I know if therapy is right for me?', 'Book a short introductory call. There is no commitment and it is a good way to see if we are a fit.'], ['Is everything confidential?', 'Yes, within the professional and legal limits we will explain at the first session.'], ['How long does therapy take?', 'Some people come for a few sessions, others longer. We review together regularly.'], ['Do you offer online sessions?', 'Yes — secure video sessions are available.']],
    process: [['Introductory call', 'Say hello and ask questions.'], ['First session', 'Understand what brings you here.'], ['Ongoing work', 'Regular sessions, reviewed together.']] },
  plumbing: { outcome: 'fixed properly, first time', noun: 'job', people: 'customers', kicker: 'The team', sections: ['hero', 'trust', 'services', 'areas', 'why', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🚨', 'Emergency repairs', 'Burst pipes, leaks and blockages — fast response when it cannot wait.'], ['🚿', 'Bathrooms & kitchens', 'Installation and re-plumbing done to a clean, lasting standard.'], ['🔥', 'Boilers & heating', 'Servicing, repairs and replacements.'], ['🧰', 'General plumbing', 'Taps, toilets, radiators, outdoor taps — the everyday jobs done right.'], ['🕳️', 'Drains', 'Clearing, camera inspection and repair.']],
    faq: [['Do you charge a call-out fee?', 'We will tell you exactly what applies before we come out — no surprises on the invoice.'], ['How fast can you get here?', 'Emergencies are prioritised. Call and we will give you an honest arrival time.'], ['Is your work guaranteed?', 'Yes — ask us for the details of our workmanship guarantee.'], ['Which areas do you cover?', 'Our service area is listed below. If you are just outside it, ask.']],
    process: [['Call or message', 'Describe the problem; send a photo if you can.'], ['Clear price', 'A straight quote before work starts.'], ['Done and tidy', 'Fixed properly, and we clean up after ourselves.']] },
  electrician: { outcome: 'safe, certified electrical work', noun: 'job', people: 'customers', kicker: 'The team', sections: ['hero', 'trust', 'services', 'areas', 'why', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🔌', 'Repairs & fault finding', 'Tripping circuits, dead sockets and flickering lights traced and fixed.'], ['🏠', 'Rewiring', 'Full and partial rewires, done cleanly and certified.'], ['💡', 'Lighting', 'Indoor and outdoor lighting design and installation.'], ['🔋', 'EV chargers & solar', 'Home charging points and renewable installs.'], ['📋', 'Inspections & certificates', 'Safety reports for landlords and homebuyers.']],
    faq: [['Are you qualified and certified?', 'Yes — ask to see our registration and we will happily show it.'], ['Do you provide certificates?', 'Every notifiable job comes with the paperwork you need.'], ['Can you come out in an emergency?', 'Call us — electrical faults that pose a safety risk are prioritised.'], ['Do you give free quotes?', 'We will tell you our quoting policy when you call; most jobs get a fixed price up front.']],
    process: [['Describe the job', 'By phone, message or the form.'], ['Fixed quote', 'Clear pricing before we start.'], ['Certified work', 'Done safely, tested and signed off.']] },
  hvac: { outcome: 'comfortable all year round', noun: 'system', people: 'customers', kicker: 'The team', sections: ['hero', 'trust', 'services', 'areas', 'why', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['❄️', 'Air conditioning', 'Supply, installation and repair of split and ducted systems.'], ['🔥', 'Heating', 'Boilers, heat pumps and furnaces — installed and serviced.'], ['🛠️', 'Servicing & maintenance', 'Annual plans that keep systems efficient and under warranty.'], ['🚨', 'Breakdowns', 'Fast repairs when the temperature is against you.']],
    faq: [['How often should my system be serviced?', 'Once a year keeps it efficient and protects the warranty.'], ['Do you offer maintenance plans?', 'Yes — ask about annual service agreements.'], ['Can you help choose the right system?', 'We survey the space and recommend the right size and type for your budget.'], ['Do you work on all brands?', 'We service most major brands. Tell us your model when you call.']],
    process: [['Survey', 'We assess the space and your needs.'], ['Quote', 'Clear options and pricing.'], ['Install & maintain', 'Fitted cleanly, serviced annually.']] },
  roofing: { outcome: 'a roof that lasts', noun: 'roof', people: 'homeowners', kicker: 'The team', sections: ['hero', 'trust', 'services', 'gallery', 'areas', 'why', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🏠', 'New roofs', 'Complete re-roofs in tile, slate and flat systems.'], ['🔧', 'Repairs', 'Leaks, slipped tiles and storm damage fixed fast.'], ['🌧️', 'Gutters & fascias', 'Replacement and repair to keep water where it belongs.'], ['🔍', 'Inspections', 'Honest surveys with photos, before you buy or sell.']],
    faq: [['Do you offer free inspections?', 'Ask when you call — we will explain what a survey involves and what it costs, if anything.'], ['How long does a new roof take?', 'Most domestic roofs take a few days to a week, weather permitting.'], ['Is the work guaranteed?', 'Yes — you receive a written guarantee on workmanship and materials.'], ['Can you help with insurance claims?', 'We provide the photos and reports insurers ask for.']],
    process: [['Inspect', 'A clear photo report of what we find.'], ['Quote', 'Fixed price, itemised.'], ['Fix it right', 'Quality materials, tidy site, guaranteed.']] },
  construction: { outcome: 'built well, on time, on budget', noun: 'project', people: 'clients', kicker: 'The company', sections: ['hero', 'trust', 'services', 'gallery', 'why', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🏗️', 'Extensions & new builds', 'From foundations to finish, managed under one roof.'], ['🍳', 'Kitchens & bathrooms', 'Design, supply and fit — plumbing and electrics included.'], ['🏠', 'Renovations', 'Whole-house refurbishments and loft conversions.'], ['🧱', 'Groundworks & drainage', 'Site preparation, drainage and hard landscaping.'], ['🔨', 'Repairs & maintenance', 'The smaller jobs, done to the same standard.']],
    faq: [['Do you handle planning and building control?', 'Yes — we can guide you through applications and liaise with inspectors.'], ['How do you price a project?', 'A detailed, itemised quote after a site visit. Changes are agreed in writing.'], ['Are you insured?', 'Fully — public liability and employer\u2019s cover, details on request.'], ['Can I see previous work?', 'Yes. Look through the gallery and ask us for references.']],
    process: [['Site visit', 'Understand the space and your goals.'], ['Design & quote', 'Drawings, timeline and a fixed price.'], ['Build', 'One point of contact from start to handover.']] },
  landscaping: { outcome: 'outdoor space you actually use', noun: 'garden', people: 'clients', kicker: 'The team', sections: ['hero', 'trust', 'services', 'gallery', 'why', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🌿', 'Garden design', 'Plans that suit your soil, light and how you live.'], ['🧱', 'Patios & paving', 'Terraces, paths and driveways laid to last.'], ['🌳', 'Planting & lawns', 'New lawns, borders and trees, established properly.'], ['✂️', 'Maintenance', 'Regular visits that keep everything looking its best.']],
    faq: [['Do you offer design as well as build?', 'Yes — design, build and maintenance, or any one of them.'], ['When is the best time to start?', 'Hard landscaping can happen most of the year; planting has its seasons. We will advise.'], ['Do you provide a plan first?', 'For larger projects, yes — you approve the design before work starts.'], ['Can you maintain a garden you did not build?', 'Of course.']],
    process: [['Visit', 'We walk the space with you.'], ['Design', 'A plan and clear quote.'], ['Build & plant', 'Then keep it looking good.']] },
  cleaning: { outcome: 'a spotless space, every time', noun: 'clean', people: 'clients', kicker: 'The team', sections: ['hero', 'trust', 'services', 'areas', 'why', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🏠', 'Regular home cleaning', 'Weekly or fortnightly visits from the same trusted cleaner.'], ['✨', 'Deep cleans', 'Top-to-bottom cleaning for spring, moving or after works.'], ['🏢', 'Office & commercial', 'Out-of-hours cleaning that keeps workplaces fresh.'], ['🔑', 'End of tenancy', 'Checklist-based cleans that get deposits back.'], ['🪟', 'Windows & carpets', 'Specialist cleaning for the things a normal clean misses.']],
    faq: [['Do I need to provide cleaning products?', 'No — we bring everything, unless you prefer specific products.'], ['Are your cleaners vetted?', 'Yes. Every team member is reference-checked and insured.'], ['Will I get the same cleaner each time?', 'For regular cleans, yes — consistency is the point.'], ['What if I am not happy with a clean?', 'Tell us within 24 hours and we will come back and put it right.']],
    process: [['Tell us the space', 'Rooms, frequency and any priorities.'], ['Fixed quote', 'Clear pricing, no contracts required.'], ['Sit back', 'Vetted, insured cleaners do the rest.']] },
  pest: { outcome: 'pest-free, and kept that way', noun: 'treatment', people: 'customers', kicker: 'The team', sections: ['hero', 'trust', 'services', 'areas', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🐀', 'Rodents', 'Fast, discreet removal and proofing so they do not return.'], ['🐜', 'Insects', 'Ants, cockroaches, bed bugs, wasps and more.'], ['🏢', 'Commercial contracts', 'Compliance-ready monitoring for food and hospitality businesses.'], ['🛡️', 'Prevention', 'Proofing and regular inspections.']],
    faq: [['Are your treatments safe for children and pets?', 'We use the least-toxic effective method and tell you exactly what precautions to take.'], ['How quickly can you come?', 'Usually within a day or two; urgent infestations are prioritised.'], ['Is the treatment guaranteed?', 'Most treatments come with a follow-up visit and guarantee period.'], ['Will you be discreet?', 'Unmarked vehicles on request.']],
    process: [['Inspect', 'Identify the pest and how it is getting in.'], ['Treat', 'Targeted, safe treatment.'], ['Prevent', 'Proofing and follow-up.']] },
  moving: { outcome: 'moved without the stress', noun: 'move', people: 'customers', kicker: 'The team', sections: ['hero', 'trust', 'services', 'areas', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🏠', 'Home removals', 'From studios to family houses, packed and moved with care.'], ['🏢', 'Office moves', 'Planned around your business hours to keep downtime minimal.'], ['📦', 'Packing service', 'Materials and expert packing, if you want us to handle it.'], ['🗄️', 'Storage', 'Secure short and long-term storage.']],
    faq: [['How is the price calculated?', 'By volume, distance and services — you get a fixed quote after a quick survey.'], ['Are my belongings insured?', 'Yes, goods-in-transit insurance is included. Ask for the details.'], ['Can you move on weekends?', 'Yes — book early, weekend slots go first.'], ['Do you dismantle furniture?', 'We can dismantle and reassemble beds, wardrobes and desks.']],
    process: [['Survey', 'In person or by video.'], ['Fixed quote', 'No hidden extras.'], ['Moving day', 'On time, careful, done.']] },
  auto: { outcome: 'honest work, fair prices', noun: 'repair', people: 'drivers', kicker: 'The workshop', sections: ['hero', 'trust', 'services', 'why', 'process', 'proof', 'faq', 'hours', 'lead', 'contact'],
    offers: [['🔧', 'Servicing & MOT', 'Manufacturer-schedule servicing and inspections.'], ['🛞', 'Tyres & brakes', 'Supplied, fitted and balanced while you wait.'], ['🔍', 'Diagnostics', 'Warning lights read and explained properly.'], ['🚗', 'Repairs', 'Engine, clutch, suspension, exhaust — from small fixes to big jobs.'], ['✨', 'Bodywork & detailing', 'Scratches, dents and a proper clean.']],
    faq: [['Will you tell me the price before starting work?', 'Always. We diagnose, quote, and only proceed with your approval.'], ['Do you work on all makes?', 'Yes — cars and light vans of every make.'], ['Can I wait while you work?', 'For quick jobs yes; for longer ones we will call you when it is ready.'], ['Do you use genuine parts?', 'Genuine or quality equivalent — your choice, explained clearly.']],
    process: [['Book it in', 'Online, by phone or drop by.'], ['Diagnose & quote', 'You approve before we touch anything.'], ['Fixed & tested', 'Back on the road, with a clear invoice.']] },
  security: { outcome: 'secure, and sure of it', noun: 'system', people: 'clients', kicker: 'The team', sections: ['hero', 'trust', 'services', 'areas', 'why', 'process', 'faq', 'lead', 'contact'],
    offers: [['🔐', 'Locksmith services', 'Lockouts, lock changes and upgrades, day or night.'], ['📹', 'CCTV', 'Cameras you can check from your phone.'], ['🚨', 'Alarms', 'Monitored and self-monitored systems for home and business.'], ['🪪', 'Access control', 'Keyless entry and intercoms.']],
    faq: [['Do you offer 24-hour emergency call-out?', 'Check our hours below — emergency lockout response is a priority.'], ['Can I view CCTV remotely?', 'Yes — every system we install is app-connected.'], ['Do you install for businesses?', 'Yes, from single shops to multi-site contracts.'], ['Are you vetted and insured?', 'Fully, with identification on arrival.']],
    process: [['Survey', 'We assess the risks and your budget.'], ['Recommend', 'Options, clearly explained.'], ['Install & support', 'Professional fitting and after-care.']] },
  salon: { outcome: 'hair you feel great in', noun: 'appointment', people: 'clients', kicker: 'The salon', sections: ['hero', 'trust', 'services', 'gallery', 'team', 'about', 'pricing', 'proof', 'faq', 'lead', 'contact'],
    offers: [['✂️', 'Cuts & styling', 'Precision cuts and finishes tailored to your hair and life.'], ['🎨', 'Colour', 'Balayage, highlights, glossing and full colour by specialists.'], ['💫', 'Treatments', 'Keratin, bond repair and deep conditioning.'], ['👰', 'Occasion hair', 'Bridal, party and event styling.']],
    faq: [['Do I need a consultation before colour?', 'For big changes, yes — it is free and it means we get it right.'], ['How far ahead should I book?', 'Weekends fill fast; a week or two is safe for most appointments.'], ['Which products do you use?', 'Professional ranges chosen for hair health, available to take home.'], ['What is your cancellation policy?', 'We ask for 24 hours\u2019 notice so someone else can have the slot.']],
    process: [['Consult', 'Talk through what you want.'], ['Create', 'Expert hands, quality products.'], ['Maintain', 'Advice and products to keep it looking good.']] },
  barber: { outcome: 'a sharp cut, every time', noun: 'cut', people: 'clients', kicker: 'The shop', sections: ['hero', 'trust', 'services', 'gallery', 'pricing', 'about', 'proof', 'faq', 'hours', 'lead', 'contact'],
    offers: [['💈', 'Haircuts', 'Classic and modern cuts, fades and scissor work.'], ['🧔', 'Beard trims & shaves', 'Shaping, hot-towel shaves and beard care.'], ['👦', 'Kids\u2019 cuts', 'Patient barbers for first cuts onwards.'], ['🎁', 'Grooming products', 'The products we use, to take home.']],
    faq: [['Do I need to book?', 'Walk-ins are welcome; booking guarantees your slot.'], ['How long is a cut?', 'Around 30–45 minutes, longer with a shave.'], ['Do you cut children\u2019s hair?', 'Yes — kids of all ages.'], ['What forms of payment do you take?', 'Card and cash.']],
    process: [['Book or walk in', 'Whatever suits you.'], ['Sit back', 'Good conversation optional.'], ['Walk out sharp', 'Every time.']] },
  spa: { outcome: 'look and feel your best', noun: 'treatment', people: 'clients', kicker: 'The studio', sections: ['hero', 'trust', 'services', 'gallery', 'about', 'pricing', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🧖', 'Facials & skincare', 'Treatments matched to your skin, with honest advice.'], ['💆', 'Massage', 'Relaxing and remedial massage to release tension.'], ['💅', 'Nails', 'Manicures, pedicures and gel.'], ['👁️', 'Brows & lashes', 'Shaping, tinting, lifts and extensions.'], ['🪒', 'Waxing', 'Fast, careful waxing for face and body.']],
    faq: [['How should I prepare for a facial?', 'Arrive with clean skin if you can — we take care of the rest.'], ['Are your products suitable for sensitive skin?', 'We patch-test where needed and choose products for your skin type.'], ['Can I book a package or gift voucher?', 'Yes — vouchers and packages are available.'], ['What is your cancellation policy?', 'Please give 24 hours\u2019 notice.']],
    process: [['Book', 'Choose your treatment and time.'], ['Relax', 'Expert hands in a calm space.'], ['Glow', 'Take-home advice to make it last.']] },
  tattoo: { outcome: 'ink you will love for life', noun: 'piece', people: 'clients', kicker: 'The studio', sections: ['hero', 'trust', 'gallery', 'services', 'team', 'about', 'process', 'faq', 'lead', 'contact'],
    offers: [['🖋️', 'Custom tattoos', 'Original designs drawn for you, from fine line to full sleeves.'], ['📐', 'Cover-ups & reworks', 'Give an old piece a second life.'], ['💎', 'Piercing', 'Clean, precise piercing with quality jewellery.'], ['🎨', 'Flash days', 'Ready-to-go designs at set prices.']],
    faq: [['How do I book a custom piece?', 'Send your idea, placement and size. We will quote and book a consultation.'], ['Is a deposit required?', 'Yes — it secures your slot and comes off the final price.'], ['How should I prepare?', 'Eat, hydrate, sleep well and skip alcohol the night before.'], ['How do I look after a new tattoo?', 'You leave with written aftercare, and you can always message us.']],
    process: [['Consult', 'Idea, placement, size.'], ['Design', 'Drawn for you, refined together.'], ['Ink', 'Clean studio, steady hands.']] },
  fitness: { outcome: 'stronger, fitter, more confident', noun: 'session', people: 'members', kicker: 'The gym', sections: ['hero', 'trust', 'services', 'schedule', 'about', 'team', 'pricing', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🏋️', 'Personal training', 'One-to-one coaching around your goals and schedule.'], ['👥', 'Group classes', 'Strength, HIIT, mobility — all levels, real coaching.'], ['📋', 'Programmes', 'Structured plans with progress you can measure.'], ['🥗', 'Nutrition support', 'Simple habits that make training pay off.']],
    faq: [['I am a complete beginner. Is that OK?', 'Yes — most people are when they start. Every session is scaled to you.'], ['Do you offer a trial?', 'Ask about a first session or class before committing.'], ['What are the membership options?', 'Pay-as-you-go, class packs and monthly memberships — details on request.'], ['What should I bring?', 'Comfortable kit, water and a towel.']],
    process: [['Free chat', 'Goals, injuries, schedule.'], ['Your plan', 'Built for you, not a template.'], ['Train & track', 'Coaching every step.']] },
  yoga: { outcome: 'space to breathe', noun: 'class', people: 'students', kicker: 'The studio', sections: ['hero', 'trust', 'services', 'schedule', 'about', 'team', 'pricing', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🧘', 'Vinyasa flow', 'Breath-led movement to build strength and ease.'], ['🌙', 'Yin & restorative', 'Slow, deep stretches to unwind body and mind.'], ['🤰', 'Prenatal & postnatal', 'Safe, supportive practice through pregnancy and beyond.'], ['🌱', 'Beginners\u2019 courses', 'The foundations, taught patiently from scratch.'], ['🧘‍♂️', 'Meditation', 'Guided sessions for a quieter mind.']],
    faq: [['I have never done yoga. Which class should I try?', 'Start with a beginners\u2019 or gentle class. Tell the teacher it is your first time.'], ['Do I need my own mat?', 'Mats and props are available in the studio.'], ['How early should I arrive?', 'Ten minutes before class is perfect.'], ['Can I practise while pregnant?', 'Yes — our prenatal classes are designed for it. Let us know when you book.']],
    process: [['Pick a class', 'Check the schedule.'], ['Book your spot', 'Online in seconds.'], ['Arrive & breathe', 'Everything else is provided.']] },
  nutrition: { outcome: 'eat well without the guesswork', noun: 'plan', people: 'clients', kicker: 'The practice', sections: ['hero', 'trust', 'services', 'about', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🥗', 'Personal nutrition plans', 'Realistic plans built around your life and preferences.'], ['⚖️', 'Weight management', 'Sustainable change, no crash diets.'], ['🏃', 'Sports nutrition', 'Fuel training and recovery properly.'], ['🩺', 'Clinical nutrition', 'Support for digestive, hormonal and long-term conditions.']],
    faq: [['What happens at the first consultation?', 'We talk through your history, goals and current habits, then agree a starting plan.'], ['Do you offer online consultations?', 'Yes — most clients mix online and in-person.'], ['Will I have to give up foods I love?', 'No. Plans are built around what you enjoy.'], ['How long until I see results?', 'Most people notice energy and habit changes within weeks; we track what matters to you.']],
    process: [['Consult', 'Your history, goals and habits.'], ['Plan', 'Realistic and personal.'], ['Support', 'Check-ins that keep you on track.']] },
  photography: { outcome: 'photographs you will keep forever', noun: 'session', people: 'clients', kicker: 'The studio', sections: ['hero', 'gallery', 'services', 'about', 'process', 'pricing', 'proof', 'faq', 'lead', 'contact'],
    offers: [['📸', 'Portraits', 'Relaxed sessions for individuals and families — no stiff posing.'], ['💍', 'Weddings', 'Documentary coverage of the whole day, told honestly.'], ['💼', 'Headshots & branding', 'Images that make you look like the professional you are.'], ['🏢', 'Commercial', 'Product, interior and campaign photography.'], ['🎥', 'Video', 'Short films for brands and events.']],
    faq: [['How do we book a session?', 'Send your date and what you have in mind. We confirm with a small deposit.'], ['How long until we receive the photos?', 'A preview within days; the full edited gallery within a few weeks.'], ['Do you travel?', 'Yes — locally at no extra cost, further afield by arrangement.'], ['What if the weather is bad?', 'We have a plan B for every outdoor shoot.']],
    process: [['Plan', 'Location, style, timings.'], ['Shoot', 'Relaxed, unhurried.'], ['Deliver', 'A beautifully edited gallery.']] },
  design: { outcome: 'design that does its job beautifully', noun: 'project', people: 'clients', kicker: 'The studio', sections: ['hero', 'work', 'services', 'about', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🎯', 'Brand identity', 'Logos, systems and guidelines that scale.'], ['🌐', 'Websites', 'Fast, accessible sites designed to convert.'], ['📱', 'Product & UX', 'Interfaces people understand at a glance.'], ['🖨️', 'Print & packaging', 'Work that feels as good as it looks.']],
    faq: [['How does a project start?', 'A discovery call, then a written proposal with scope, timeline and price.'], ['How long does a brand identity take?', 'Typically a few weeks, depending on scope and feedback rounds.'], ['Do you work with small businesses?', 'Yes — many of our best projects are with founders.'], ['What do we receive at the end?', 'All final files, source assets and guidelines, with a handover session.']],
    process: [['Discover', 'Goals, audience, constraints.'], ['Design', 'Concepts, refined with you.'], ['Deliver', 'Files, guidelines, launch support.']] },
  marketing: { outcome: 'growth you can measure', noun: 'campaign', people: 'clients', kicker: 'The agency', sections: ['hero', 'trust', 'services', 'work', 'about', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🔍', 'SEO', 'Rank for the searches your customers actually make.'], ['📣', 'Paid media', 'Search and social campaigns managed for return, not vanity.'], ['📱', 'Social media', 'Content and community that build an audience.'], ['✍️', 'Content & email', 'Words that earn attention and keep it.']],
    faq: [['How do you report results?', 'A monthly report in plain English, tied to the goals we agreed.'], ['Is there a minimum contract?', 'We will tell you our terms up front — no lock-ins hidden in the small print.'], ['Do you work with small budgets?', 'Yes. We scope to your budget and tell you honestly what it can achieve.'], ['How soon will we see results?', 'Paid campaigns move fast; SEO compounds over months. We set expectations at the start.']],
    process: [['Audit', 'Where you are and what is possible.'], ['Plan', 'Channels, budget, targets.'], ['Run & report', 'Optimise weekly, report monthly.']] },
  architecture: { outcome: 'spaces that work as beautifully as they look', noun: 'project', people: 'clients', kicker: 'The practice', sections: ['hero', 'work', 'services', 'about', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🏛️', 'Architecture', 'New builds and extensions, from concept to completion.'], ['🛋️', 'Interior design', 'Layouts, materials and furniture with a point of view.'], ['📐', 'Planning & permissions', 'Applications handled with the authorities.'], ['🏗️', 'Project management', 'Budgets and builders kept on track.']],
    faq: [['Do you take on small projects?', 'Yes — a single room can be as rewarding as a whole house.'], ['How do fees work?', 'A fixed fee or a percentage, agreed in writing before we start.'], ['Do you handle planning applications?', 'Yes, including listed-building and conservation-area consents.'], ['Can you recommend builders?', 'We work with contractors we trust and can run a tender for you.']],
    process: [['Brief', 'How you live and what you need.'], ['Design', 'Concepts to detailed drawings.'], ['Build', 'On site with you until handover.']] },
  music: { outcome: 'music worth turning up', noun: 'show', people: 'fans', kicker: 'The music', sections: ['hero', 'listen', 'shows', 'about', 'gallery', 'press', 'faq', 'lead', 'contact'],
    offers: [['🎵', 'Live shows', 'Book us for venues, festivals and private events.'], ['🎧', 'Releases', 'Stream and buy the latest music.'], ['🎚️', 'Studio & production', 'Recording, mixing and production for other artists.'], ['🎓', 'Lessons', 'One-to-one tuition.']],
    faq: [['How do I book you for an event?', 'Send the date, venue and set length. We reply with availability and a quote.'], ['Where can I listen?', 'Links to every platform are on this page.'], ['Do you play private events?', 'Yes — weddings, parties and corporate events.'], ['Can I sign up for tour news?', 'Join the mailing list below.']],
    process: [['Listen', 'New releases first.'], ['Come to a show', 'Dates below.'], ['Stay close', 'Join the list.']] },
  games: { outcome: 'games made with heart', noun: 'game', people: 'players', kicker: 'The studio', sections: ['hero', 'showcase', 'features', 'about', 'team', 'devlog', 'press', 'faq', 'lead', 'contact'],
    offers: [['🎮', 'Hand-crafted worlds', 'Every tile, sprite and sound made in-house.'], ['🧩', 'Thoughtful puzzles', 'Designed to make you feel clever, not stuck.'], ['🌙', 'Cozy pace', 'No timers, no fail states — play at your own rhythm.'], ['🎶', 'Original soundtrack', 'Music composed for the world it lives in.']],
    faq: [['When does it come out?', 'Release timing is on this page and on the store page — wishlist to be notified on launch day.'], ['Which platforms?', 'Listed in the game details above. More may follow after launch.'], ['Will there be a demo?', 'Follow the devlog or newsletter — demos and playtests are announced there first.'], ['Can I cover or stream the game?', 'Yes, please do. Press and creator kits are available on request.']],
    process: [['Wishlist', 'It helps more than you know.'], ['Follow the devlog', 'See the game come together.'], ['Play at launch', 'Day one, on your platform.']] },
  events: { outcome: 'an event people remember', noun: 'event', people: 'clients', kicker: 'The team', sections: ['hero', 'trust', 'services', 'gallery', 'about', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['💍', 'Weddings', 'Full planning or on-the-day coordination.'], ['🏢', 'Corporate events', 'Conferences, launches and away days that run to the minute.'], ['🎉', 'Private celebrations', 'Birthdays, anniversaries and parties of every size.'], ['🎨', 'Styling & décor', 'Design, florals and lighting to set the scene.']],
    faq: [['How far in advance should we book?', 'Weddings: 9–18 months. Corporate and private events: as early as you can, but call — we can move fast.'], ['Do you work with our venue and suppliers?', 'Yes — or recommend trusted ones.'], ['What does planning cost?', 'A clear proposal after a first conversation, priced to scope.'], ['Can you help with just one part?', 'Absolutely — on-the-day coordination, styling or full planning.']],
    process: [['Consultation', 'Vision, guest numbers, budget.'], ['Plan', 'Suppliers, timeline, design.'], ['The day', 'We run it; you enjoy it.']] },
  law: { outcome: 'clear advice when it matters most', noun: 'matter', people: 'clients', kicker: 'The firm', sections: ['hero', 'trust', 'services', 'about', 'team', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['⚖️', 'Advice & representation', 'Straight answers and strong representation across our practice areas.'], ['📄', 'Contracts & agreements', 'Drafted and reviewed so the small print protects you.'], ['🤝', 'Dispute resolution', 'Negotiation first, litigation when it is needed.'], ['🏢', 'Business clients', 'Practical support for founders and growing companies.']],
    faq: [['How much will it cost?', 'We explain fees clearly before you commit — fixed fees where possible, and no surprises.'], ['Do you offer an initial consultation?', 'Yes. It is the quickest way to find out where you stand.'], ['How long will my case take?', 'It depends on the matter and the other side. We give you a realistic timeline at the start and keep you updated.'], ['Is everything confidential?', 'Completely. Everything you tell us is protected by legal privilege.']],
    process: [['Initial consultation', 'Tell us what happened.'], ['Clear options', 'Your position, the routes, the costs.'], ['We act', 'Firmly, and with regular updates.']] },
  accounting: { outcome: 'numbers handled, stress removed', noun: 'return', people: 'clients', kicker: 'The practice', sections: ['hero', 'trust', 'services', 'about', 'process', 'pricing', 'proof', 'faq', 'lead', 'contact'],
    offers: [['📊', 'Accounts & bookkeeping', 'Tidy books and year-end accounts filed on time.'], ['🧾', 'Tax returns', 'Personal and business returns, with every allowance claimed.'], ['💷', 'Payroll & VAT', 'Run accurately, every period.'], ['📈', 'Advisory', 'Plain-English advice on growth, structure and cash flow.']],
    faq: [['How do you charge?', 'Fixed monthly or annual fees agreed up front.'], ['Can you take over from my current accountant?', 'Yes — we handle the handover.'], ['Do you work with sole traders?', 'From sole traders to limited companies.'], ['Which software do you use?', 'The major cloud platforms; we will recommend the right one for you.']],
    process: [['Free chat', 'Understand your business.'], ['Fixed fee', 'Know the cost from day one.'], ['Ongoing support', 'Deadlines met, questions answered.']] },
  consulting: { outcome: 'decisions made with confidence', noun: 'engagement', people: 'clients', kicker: 'The practice', sections: ['hero', 'trust', 'services', 'about', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🧭', 'Strategy', 'Clarity on where to play and how to win.'], ['⚙️', 'Operations', 'Processes that scale without the chaos.'], ['👥', 'People & change', 'Bring the team with you.'], ['📈', 'Growth', 'Practical plans, not decks that gather dust.']],
    faq: [['How do engagements work?', 'A scoped project or a monthly retainer — we recommend whichever fits the problem.'], ['Do you work with small companies?', 'Yes, and we price accordingly.'], ['What makes you different?', 'We stay to help implement, not just advise.'], ['How do we start?', 'A free conversation about the challenge.']],
    process: [['Diagnose', 'Understand the real problem.'], ['Plan', 'Options, trade-offs, a recommendation.'], ['Implement', 'Alongside your team.']] },
  finance: { outcome: 'financial decisions with clarity', noun: 'plan', people: 'clients', kicker: 'The firm', sections: ['hero', 'trust', 'services', 'about', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🏠', 'Mortgages', 'Whole-of-market advice for first-time buyers, movers and remortgages.'], ['🛡️', 'Protection', 'Life, income and critical-illness cover that fits.'], ['📈', 'Investments & pensions', 'Long-term plans reviewed regularly.'], ['🧾', 'Financial planning', 'A clear picture and a plan to get where you want.']],
    faq: [['Are you independent?', 'We will explain exactly how we are regulated and paid before you decide.'], ['How do you charge?', 'Fees or commission, disclosed in writing up front.'], ['Do I need a lot of money to start?', 'No — good planning matters most when you are starting out.'], ['How often do we review?', 'At least annually, or whenever life changes.']],
    process: [['Discovery', 'Your situation and goals.'], ['Recommendation', 'Clear, written advice.'], ['Review', 'Kept on track over time.']] },
  realestate: { outcome: 'the right move, made simple', noun: 'property', people: 'clients', kicker: 'The agency', sections: ['hero', 'trust', 'services', 'listings', 'about', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🏡', 'Selling', 'Accurate valuations and marketing that reaches serious buyers.'], ['🔑', 'Buying', 'Honest guidance from first viewing to keys.'], ['📋', 'Lettings & management', 'Vetted tenants and properties looked after.'], ['💼', 'Commercial', 'Offices, retail and investment property.']],
    faq: [['How much is my property worth?', 'Book a free, no-obligation valuation.'], ['What are your fees?', 'Explained clearly before you instruct us.'], ['How long does it take to sell?', 'It depends on market and price; we will give you an honest estimate.'], ['Do you manage rental properties?', 'Yes — full management or let-only.']],
    process: [['Valuation', 'Free and realistic.'], ['Marketing', 'Photos, listings, viewings.'], ['Completion', 'Negotiated and handled to the end.']] },
  saas: { outcome: 'hours back every week', noun: 'workflow', people: 'teams', kicker: 'The product', sections: ['hero', 'logos', 'features', 'how', 'proof', 'pricing', 'faq', 'lead', 'contact'],
    offers: [['⚡', 'Automate the busywork', 'Set it up once; it runs every time.'], ['📊', 'See everything in one place', 'Live dashboards instead of spreadsheets.'], ['🔌', 'Works with your stack', 'Integrations with the tools you already use.'], ['🔒', 'Secure by default', 'Permissions, audit logs and encryption built in.']],
    faq: [['Is there a free trial?', 'Details on trials and plans are in the pricing section.'], ['How long does setup take?', 'Most teams are running within a day; we help with migration.'], ['Is my data secure?', 'Encrypted in transit and at rest, with role-based access.'], ['Can I cancel anytime?', 'Yes — no long-term lock-in.']],
    process: [['Connect', 'Plug in your data and tools.'], ['Configure', 'Templates get you started fast.'], ['Run', 'Watch the busywork disappear.']] },
  itservices: { outcome: 'technology that just works', noun: 'system', people: 'clients', kicker: 'The team', sections: ['hero', 'trust', 'services', 'about', 'process', 'proof', 'pricing', 'faq', 'lead', 'contact'],
    offers: [['🛠️', 'IT support', 'Fast, friendly help desk with real response times.'], ['🛡️', 'Cybersecurity', 'Protection, monitoring and staff training.'], ['☁️', 'Cloud & Microsoft 365', 'Migration, setup and ongoing management.'], ['🌐', 'Networks & hardware', 'Reliable infrastructure, installed and maintained.'], ['💻', 'Web & software', 'Sites and tools built for your business.']],
    faq: [['What response times do you offer?', 'Defined in your agreement and reported monthly.'], ['Do you offer fixed monthly pricing?', 'Yes — predictable per-user or per-device plans.'], ['Can you take over from our current provider?', 'Yes; we manage the handover with minimal disruption.'], ['Do you support remote teams?', 'Fully — remote support and secure access are standard.']],
    process: [['Audit', 'Understand your systems and risks.'], ['Plan', 'Priorities and fixed pricing.'], ['Support', 'Proactive monitoring and fast help.']] },
  ecommerce: { outcome: 'things worth owning', noun: 'product', people: 'customers', kicker: 'The shop', sections: ['hero', 'trust', 'collections', 'featured', 'about', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🛍️', 'New arrivals', 'The latest additions to the collection.'], ['⭐', 'Bestsellers', 'The pieces customers come back for.'], ['🎁', 'Gifts', 'Curated ideas for every occasion.'], ['🚚', 'Shipping & returns', 'Fast dispatch and easy returns.']],
    faq: [['How long does delivery take?', 'Dispatch and delivery times are shown at checkout and in our shipping policy.'], ['What is your returns policy?', 'Returns are accepted within the stated window — see the policy for details.'], ['Do you ship internationally?', 'Check the shipping options at checkout for your country.'], ['How can I track my order?', 'A tracking link is emailed as soon as your order ships.']],
    process: [['Browse', 'Find what you love.'], ['Order', 'Secure checkout.'], ['Enjoy', 'Fast delivery, easy returns.']] },
  grocery: { outcome: 'good food, close to home', noun: 'product', people: 'customers', kicker: 'The shop', sections: ['hero', 'trust', 'services', 'about', 'hours', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🥬', 'Fresh produce', 'Fruit and veg delivered daily.'], ['🥩', 'Butchery & deli', 'Quality meat, cheese and prepared foods.'], ['🍞', 'Bakery', 'Fresh bread and pastries every morning.'], ['🛒', 'Local delivery', 'Order by phone or message and we bring it round.']],
    faq: [['Do you deliver?', 'Local delivery is available — see the details below.'], ['Do you stock local produce?', 'Yes, from growers and makers we know.'], ['What are your opening hours?', 'Listed below.'], ['Can I place an order for collection?', 'Yes — call or message ahead.']],
    process: [['Visit or call', 'See what is fresh.'], ['We prepare', 'Picked and packed with care.'], ['Collect or delivered', 'Whichever suits.']] },
  school: { outcome: 'learning that sticks', noun: 'course', people: 'students', kicker: 'The school', sections: ['hero', 'trust', 'services', 'about', 'team', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['📚', 'One-to-one tuition', 'Focused lessons that move at the student\u2019s pace.'], ['👥', 'Small group classes', 'Structured courses with room for questions.'], ['📝', 'Exam preparation', 'Techniques and practice that turn knowledge into marks.'], ['💻', 'Online lessons', 'The same quality teaching from anywhere.']],
    faq: [['How do I enrol?', 'Get in touch and we will arrange a short assessment and place the student in the right group.'], ['Who are the teachers?', 'Qualified, experienced and background-checked. Meet them above.'], ['What are the fees?', 'Set out clearly per course or per hour — ask for the current schedule.'], ['Do you offer a trial lesson?', 'Yes — a first session to see if we are the right fit.']],
    process: [['Assessment', 'Understand the student\u2019s level and goals.'], ['Placement', 'The right class or tutor.'], ['Progress', 'Regular feedback to parents and students.']] },
  nonprofit: { outcome: 'change you can be part of', noun: 'programme', people: 'supporters', kicker: 'The cause', sections: ['hero', 'impact', 'programs', 'about', 'team', 'stories', 'faq', 'lead', 'contact'],
    offers: [['🤝', 'Programmes', 'What we run, who it helps and how.'], ['💛', 'Donate', 'Every gift goes to the work.'], ['🙋', 'Volunteer', 'Give time and skills where they count.'], ['📣', 'Campaigns', 'Add your voice.']],
    faq: [['Where does my donation go?', 'Directly to our programmes; our accounts are published annually.'], ['How can I volunteer?', 'Tell us your availability and skills using the form and we will be in touch.'], ['Is my donation tax-deductible?', 'Where applicable we provide receipts for tax purposes.'], ['Can my company get involved?', 'Yes — partnerships, matched giving and team volunteering.']],
    process: [['Learn', 'What we do and why.'], ['Give or join', 'Money, time or voice.'], ['See the impact', 'We report back.']] },
  travel: { outcome: 'journeys you will tell stories about', noun: 'trip', people: 'travellers', kicker: 'The company', sections: ['hero', 'trust', 'tours', 'gallery', 'about', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['🧭', 'Guided tours', 'Small groups, expert local guides.'], ['🗺️', 'Tailor-made trips', 'Itineraries built around you.'], ['🚐', 'Day trips & transfers', 'Comfortable, reliable, on time.'], ['🏨', 'Stays & experiences', 'Hand-picked hotels and activities.']],
    faq: [['What is included in the price?', 'Every listing states exactly what is and is not included.'], ['Are your guides licensed?', 'Yes — local, licensed and passionate about the places they show you.'], ['What is your cancellation policy?', 'Clear terms are provided before you book.'], ['Can you arrange private tours?', 'Yes, for families, groups and special occasions.']],
    process: [['Tell us your dates', 'And what you love.'], ['We plan', 'A clear itinerary and price.'], ['Travel', 'We handle the details.']] },
  portfolio: { outcome: 'work that speaks for itself', noun: 'project', people: 'clients', kicker: 'About me', sections: ['hero', 'work', 'services', 'about', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['💼', 'Selected work', 'Recent projects and what they achieved.'], ['🧰', 'What I do', 'The skills and services I offer.'], ['🤝', 'How I work', 'Collaborative, transparent, on time.'], ['📬', 'Get in touch', 'Available for new projects.']],
    faq: [['Are you available for new work?', 'Availability is noted on this page — send details of your project.'], ['How do you charge?', 'Project or day rate, agreed in writing.'], ['Do you work remotely?', 'Yes, with clients anywhere.'], ['Can I see more examples?', 'Ask — there is always more than fits on a page.']],
    process: [['Brief', 'Tell me about the project.'], ['Proposal', 'Scope, timeline, price.'], ['Deliver', 'On time, with clear communication.']] },
  general: { outcome: 'done properly', noun: 'job', people: 'customers', kicker: 'About us', sections: ['hero', 'trust', 'services', 'about', 'process', 'proof', 'faq', 'lead', 'contact'],
    offers: [['⭐', 'What we do', 'A clear description of the core service goes here.'], ['🤝', 'How we work', 'Straightforward, on time and to the standard agreed.'], ['📍', 'Where we work', 'The areas and customers we serve.'], ['📬', 'Get in touch', 'Questions answered quickly.']],
    faq: [['How do I get started?', 'Use the form or contact details below — we reply promptly.'], ['How is pricing worked out?', 'Clearly, in writing, before anything is agreed.'], ['Which areas do you cover?', 'See the contact section for where we work.'], ['What happens after I get in touch?', 'A quick conversation to understand what you need, then a clear next step.']],
    process: [['Get in touch', 'Tell us what you need.'], ['Clear proposal', 'Scope, timing and price in writing.'], ['Delivered', 'To the standard agreed.']] },
};
const ARCHE_FALLBACK = { trade: 'plumbing', clinic: 'medical', hospitality: 'restaurant', beauty: 'spa', wellness: 'fitness', creative: 'design', professional: 'consulting', tech: 'saas', retail: 'ecommerce', education: 'school', events: 'events', nonprofit: 'nonprofit', entertainment: 'music', personal: 'portfolio', travel: 'travel' };
function playbookFor(brief) { return PLAYBOOKS[brief.industry.id] || PLAYBOOKS[ARCHE_FALLBACK[brief.archetype]] || PLAYBOOKS.general; }

// ── Voice: personality → phrasing ───────────────────────────────────────────
const VOICE = {
  warm: { badge: ['Family-run', 'Local and independent', 'Made with care'], adjectives: ['friendly', 'personal', 'welcoming'], ctaLead: ['Say hello', 'Get in touch', 'Come and see us'], leadTitle: ['We would love to hear from you', 'Come and say hello', 'Let\u2019s talk about what you need'], leadSub: 'Send a message and a real person will reply — usually the same day.', aboutOpen: (n) => `${n} started with a simple idea: do one thing really well and treat people properly.` },
  refined: { badge: ['By appointment', 'Considered, not rushed', 'Quietly exceptional'], adjectives: ['considered', 'bespoke', 'attentive'], ctaLead: ['Enquire', 'Begin a conversation', 'Request details'], leadTitle: ['Begin the conversation', 'Enquire about availability', 'Let us take care of the details'], leadSub: 'Tell us a little about what you have in mind and we will be in touch personally.', aboutOpen: (n) => `${n} is built on a belief that the details are the work.` },
  bold: { badge: ['No half measures', 'Built different', 'Loud and proud'], adjectives: ['fearless', 'sharp', 'unmistakable'], ctaLead: ['Let\u2019s go', 'Start something', 'Make it happen'], leadTitle: ['Ready when you are', 'Let\u2019s make something', 'Start the conversation'], leadSub: 'Tell us the idea. We will tell you how to make it real.', aboutOpen: (n) => `${n} exists because good enough is not.` },
  precise: { badge: ['Clear pricing', 'Straight answers', 'Done properly'], adjectives: ['clear', 'reliable', 'thorough'], ctaLead: ['Get in touch', 'Request a callback', 'Talk to us'], leadTitle: ['Tell us what you need', 'Get a clear answer', 'Let\u2019s get it sorted'], leadSub: 'Send the details and we will come back with a clear next step, not a sales pitch.', aboutOpen: (n) => `${n} does the job properly: clear scope, clear price, clear communication.` },
  calm: { badge: ['At your pace', 'A calm space', 'Gentle by design'], adjectives: ['calm', 'gentle', 'unhurried'], ctaLead: ['Get in touch', 'Book a first visit', 'Ask a question'], leadTitle: ['Take the first step', 'Questions? Just ask', 'We are here when you are ready'], leadSub: 'No pressure — send a note and we will reply with the information you need.', aboutOpen: (n) => `${n} was created to be the kind of place people actually look forward to visiting.` },
  playful: { badge: ['Made with love', 'Small team, big ideas', 'Handmade, heartfelt'], adjectives: ['joyful', 'curious', 'hand-made'], ctaLead: ['Say hi', 'Join in', 'Come play'], leadTitle: ['Say hi', 'Join the community', 'Come along for the ride'], leadSub: 'Questions, ideas, kind words — we read everything.', aboutOpen: (n) => `${n} is a small team making things we would want to use ourselves.` },
};

// CTA phrasing per intent, all ≤ 22 chars (the button budget) — no truncation.
const CTA = {
  book: { primary: ['Book an appointment', 'Book now'], secondary: ['See treatments', 'Our services', 'See classes'] },
  reserve: { primary: ['Reserve a table', 'Book a table'], secondary: ['See the menu', 'View menu'] },
  order: { primary: ['Order now', 'Order flowers', 'Place an order'], secondary: ['Browse the range', 'See what we offer'] },
  shop: { primary: ['Shop the collection', 'Shop now'], secondary: ['New arrivals', 'Bestsellers'] },
  quote: { primary: ['Get a free quote', 'Request a quote'], secondary: ['Our services', 'What we do'] },
  consult: { primary: ['Book a consultation', 'Talk to us'], secondary: ['How we help', 'Our services'] },
  enrol: { primary: ['Enrol today', 'Book a trial lesson'], secondary: ['See courses', 'How it works'] },
  donate: { primary: ['Donate now', 'Support the work'], secondary: ['Volunteer with us', 'Our programmes'] },
  demo: { primary: ['Start free trial', 'Book a demo'], secondary: ['See how it works', 'View pricing'] },
  subscribe: { primary: ['Join now', 'Become a member'], secondary: ['See the schedule', 'Learn more'] },
  wishlist: { primary: ['Wishlist on Steam', 'Wishlist now'], secondary: ['Watch the trailer', 'About the game'] },
  hire: { primary: ['Start a project', 'Work with us'], secondary: ['See our work', 'View portfolio'] },
  visit: { primary: ['Visit us', 'Find us'], secondary: ['Opening hours', 'What we offer'] },
  call: { primary: ['Call us today', 'Get in touch'], secondary: ['Our services', 'Learn more'] },
};

// ── Headline generation: patterns chosen by personality, filled with brief facts
function headlineFor(brief, pb, voice) {
  const n = brief.name || 'We';
  const first = brief.services[0] ? low(brief.services[0].title) : '';
  const second = brief.services[1] ? low(brief.services[1].title) : '';
  const where = brief.location && brief.location.city ? brief.location.city : '';
  const aud = brief.audience[0] || '';
  const outcome = pb.outcome;
  const product = brief.products.items[0] ? brief.products.items[0].name : '';
  const noun = require('./nx_brief.js').nxIndustryNoun(brief.industry.id, false);
  const P = brief.personality.primary;
  const seed = brief.seed;
  const c = [];
  if (product) c.push(`${product}: ${cap(outcome)}.`, `Meet ${product}.`, `${product} — ${outcome}.`);
  if (P === 'warm') c.push(where ? `${cap(outcome)}, right here in ${where}.` : `${cap(outcome)}.`, first && where ? `${cap(first)} in ${where}, made with care.` : '', `The ${noun} ${where ? where + ' ' : ''}comes back to.`);
  if (P === 'refined') c.push(`${cap(outcome)}.`, first ? `${cap(first)}, done beautifully.` : '', where ? `${cap(noun)} in ${where}, without compromise.` : `A ${noun} without compromise.`);
  if (P === 'bold') c.push(`${cap(outcome)}. No exceptions.`, first ? `${cap(first)} that actually delivers.` : '', `${n}: ${outcome}.`);
  if (P === 'precise') c.push(where ? `${cap(outcome)} — ${noun} in ${where}.` : `${cap(outcome)}.`, first && second ? `${cap(first)}, ${second} and more — ${outcome}.` : '', `${cap(outcome)}. ${n}.`);
  if (P === 'calm') c.push(`${cap(outcome)}.`, where ? `A calmer kind of ${noun} in ${where}.` : `A calmer kind of ${noun}.`, aud ? `${cap(outcome)} — for ${aud}.` : '');
  if (P === 'playful') c.push(`${cap(outcome)}.`, product ? `${product} is coming.` : '', first ? `${cap(first)}, with a smile.` : '');
  c.push(`${cap(outcome)}.`, `${n}: ${outcome}.`);
  const cands = uniq(c.filter(Boolean).map(clean));
  // rotate the start point deterministically so different businesses in the same
  // industry+personality do not all get pattern #1
  const start = seed % Math.max(1, Math.min(cands.length, 3));
  const rotated = cands.slice(start).concat(cands.slice(0, start));
  return fit(rotated, BUDGET.headline);
}

function subFor(brief, pb) {
  const n = brief.name || 'We';
  const where = brief.location && brief.location.raw ? brief.location.raw : '';
  const svc = brief.services.slice(0, 3).map((s) => low(s.title));
  const aud = brief.audience.slice(0, 2);
  const diffs = brief.differentiators.slice(0, 2).map((d) => low(d.label));
  const years = brief.yearsExperience;
  const people = brief.people[0];
  const c = [];
  const list = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
  const verb = brief.archetype === 'professional' || brief.archetype === 'clinic' ? 'helps with' : brief.archetype === 'education' ? 'teaches' : brief.archetype === 'retail' || brief.archetype === 'hospitality' ? 'offers' : brief.archetype === 'creative' || brief.archetype === 'personal' ? 'specialises in' : 'handles';
  if (svc.length >= 2) c.push(`${n} ${where ? 'in ' + where + ' ' : ''}${verb} ${list(svc)}${aud.length ? ' for ' + list(aud) : ''}${diffs.length ? ' — ' + list(diffs) : ''}.`);
  if (svc.length >= 1) c.push(`${cap(svc[0])}${svc[1] ? ' and ' + svc[1] : ''}${where ? ' in ' + where : ''}${years ? ', with ' + years + ' years behind every job' : ''}.`);
  if (brief.products.items[0]) c.push(`${brief.products.items[0].name}${brief.products.launch ? ' launches ' + brief.products.launch : ''}${brief.products.platforms.length ? ' on ' + list(brief.products.platforms.slice(0, 3)) : ''}. ${cap(pb.outcome)}, from ${where ? 'a small team in ' + where : 'a small team'}.`);
  if (people && years) c.push(`Founded by ${people.name}${brief.founded ? ' in ' + brief.founded : ''}, ${n} has spent ${years} years making sure of one thing: ${pb.outcome}.`);
  if (where) c.push(`${cap(require('./nx_brief.js').nxIndustryNoun(brief.industry.id, true))} in ${where}${diffs.length ? ' — ' + list(diffs) : ''}. ${cap(pb.outcome)}.`);
  const firstSentence = clean(brief.description).split(/(?<=[.!?])\s/)[0];
  if (firstSentence && firstSentence.length >= 30 && firstSentence.length <= BUDGET.sub && !/[@+]|\d{5,}|http/.test(firstSentence)) c.push(firstSentence.replace(/[^.!?]$/, (m) => m + '.'));
  c.push(`${cap(pb.outcome)} — ${diffs.length ? list(diffs) : 'clear communication and work you can rely on'}.`);
  return fit(c.map(clean), BUDGET.sub);
}

// ── Services (cards) ─────────────────────────────────────────────────────────
function iconFor(title, pb, i) {
  const t = low(title);
  const map = [[/wedding|bridal/, '💍'], [/deliver/, '🚚'], [/subscri/, '🔁'], [/emergenc|24\/7|urgent/, '🚨'], [/clean/, '✨'], [/repair|fix/, '🔧'], [/install/, '🛠️'], [/design/, '✏️'], [/coffee|espresso/, '☕'], [/cake|bake|bread|pastr/, '🥐'], [/kid|child|family|families/, '🧒'], [/whiten/, '✨'], [/implant/, '🔩'], [/brace|align/, '😁'], [/consult|advice/, '🗣️'], [/contract|agreement/, '📄'], [/dispute|dismissal|litigation/, '⚖️'], [/photo|portrait|headshot/, '📸'], [/video|film/, '🎥'], [/class|course|lesson|tuition|training/, '📚'], [/yoga|pilates|meditat/, '🧘'], [/massage|spa|facial/, '💆'], [/nail/, '💅'], [/hair|cut|colour|color|balayage/, '✂️'], [/security|cyber|lock/, '🔐'], [/cloud|network|it support|microsoft/, '☁️'], [/web|site|app|software/, '💻'], [/market|seo|social|brand/, '📣'], [/garden|lawn|landscap|plant/, '🌿'], [/roof/, '🏠'], [/paint|decorat/, '🎨'], [/drain|pipe|leak|plumb|heater|boiler/, '🚿'], [/electric|wiring|light/, '💡'], [/tour|trip|travel|safari/, '🧭'], [/car|auto|tyre|tire|brake|mot/, '🚗'], [/pet|dog|cat|vet/, '🐾'], [/game|puzzle|pixel/, '🎮'], [/music|band|dj|sound/, '🎵'], [/event|party|celebrat/, '🎉'], [/tax|account|payroll|vat|bookkeep/, '🧾'], [/mortgage|loan|invest|pension/, '📈'], [/rent|let|property|home|apartment/, '🏡'], [/flower|bouquet|floral|bloom/, '💐'], [/menu|dinner|lunch|dish|food/, '🍽️'], [/room|suite|stay/, '🛏️'], [/donat|volunteer/, '💛']];
  for (const [re, ic] of map) if (re.test(t)) return ic;
  return (pb.offers[i % pb.offers.length] || ['⭐'])[0];
}

function describeService(title, brief, pb, i) {
  const t = low(title);
  const where = brief.location && brief.location.city ? brief.location.city : '';
  const tmpl = [
    `${cap(title)} handled properly — clear pricing, honest advice and work you can rely on.`,
    `Ask us about ${t}. We explain the options in plain English and quote before we start.`,
    `${cap(title)}${where ? ' across ' + where : ''}, done to a standard we would accept in our own home.`,
    `From first conversation to finished ${pb.noun}, ${t} is looked after end to end.`,
    `${cap(title)} tailored to you — no packages you do not need.`,
  ];
  const arche = brief.archetype;
  const soft = [
    `${cap(title)}, made fresh and with care every time.`,
    `Ask about ${t} — a favourite with regulars, and always in season.`,
    `${cap(title)} for every occasion, prepared the day you need it.`,
  ];
  const clinic = [
    `${cap(title)} explained clearly, with costs agreed before treatment starts.`,
    `Gentle, unhurried ${t} from a team that takes time to listen.`,
    `${cap(title)} with modern equipment and a calm, reassuring approach.`,
  ];
  const creative = [
    `${cap(title)} with a clear point of view and a process that keeps you involved.`,
    `${cap(title)} that does its job beautifully — on brief, on time.`,
    `${cap(title)}: concepts, refinement and finished work you will be proud of.`,
  ];
  const learn = [
    `${cap(title)} taught patiently, at the student\u2019s pace, with real progress you can see.`,
    `${cap(title)} in small groups or one-to-one — ask about a trial session.`,
  ];
  const pool = ['hospitality', 'retail'].includes(arche) ? soft : arche === 'clinic' || arche === 'wellness' || arche === 'beauty' ? clinic : arche === 'creative' || arche === 'entertainment' || arche === 'personal' ? creative : arche === 'education' ? learn : tmpl;
  return fit(pick(pool, brief.seed, i), BUDGET.cardBody);
}

function servicesFor(brief, pb) {
  const list = brief.services.slice(0, 6);
  let cards;
  let suggested = false;
  if (list.length) {
    cards = list.map((s, i) => ({ icon: (s.icon && String(s.icon).slice(0, 4)) || iconFor(s.title, pb, i), title: fit(cap(s.title), BUDGET.cardTitle), text: s.desc ? fit(s.desc, BUDGET.cardBody) : describeService(s.title, brief, pb, i), source: 'brief' }));
    // a two-item list looks thin; add the two most relevant playbook offers that do not overlap
    if (cards.length < 3) {
      for (const o of pb.offers) { if (cards.length >= 4) break; if (cards.some((c) => low(c.title).includes(low(o[1]).split(' ')[0]) || low(o[1]).includes(low(c.title)))) continue; cards.push({ icon: o[0], title: fit(o[1], BUDGET.cardTitle), text: fit(o[2], BUDGET.cardBody), source: 'suggested' }); suggested = true; }
    }
  } else {
    cards = pb.offers.slice(0, 4).map((o) => ({ icon: o[0], title: fit(o[1], BUDGET.cardTitle), text: fit(o[2], BUDGET.cardBody), source: 'suggested' }));
    suggested = true;
  }
  return { cards, suggested };
}

// ── Why / trust: ONLY real differentiators + industry truths (no numbers) ────
function whyFor(brief, pb, voice, plan) {
  const out = [];
  // Owner-approved plan items (scanner / previous build) come first, verbatim.
  const given = Array.isArray(plan && (plan.why_us || plan.why)) ? (plan.why_us || plan.why) : [];
  for (const w of given.slice(0, 4)) {
    const check = typeof w === 'string' ? w : String((w && (w.check || w.title)) || '');
    const text = typeof w === 'string' ? '' : String((w && (w.text || w.desc)) || '');
    if (check.trim()) out.push({ check: fit(check, 40), text: fit(text || 'Part of how we work, every time.', 120), source: 'plan' });
  }
  for (const d of brief.differentiators.slice(0, 4)) out.push({ check: fit(d.label, 40), text: fit(whyText(d.id, brief), 120), source: 'brief' });
  if (brief.yearsExperience >= 2) out.push({ check: fit(`${brief.yearsExperience} years of experience`, 40), text: fit(brief.founded ? `Established ${brief.founded} — still ${low(voice.adjectives[0])}, still ${low(voice.adjectives[1])}.` : `Experience you can feel in the work.`, 120), source: 'brief' });
  if (brief.people[0]) out.push({ check: fit(`Led by ${brief.people[0].name}`, 40), text: fit(`${brief.people[0].role} — you deal with the person responsible.`, 120), source: 'brief' });
  if (brief.location && brief.location.raw) out.push({ check: fit(`Local to ${brief.location.city || brief.location.raw}`, 40), text: fit(brief.location.serviceArea.length ? `Serving ${brief.location.serviceArea.join(', ')}.` : `Based in ${brief.location.raw}, part of the community.`, 120), source: 'brief' });
  const generic = { trade: [['Clear, upfront pricing', 'You approve the cost before any work starts.'], ['Tidy, respectful work', 'We treat your home like our own and clean up after.'], ['One point of contact', 'Talk to the person doing the job.']], clinic: [['Unhurried appointments', 'Time to ask questions and understand your options.'], ['Costs explained first', 'No treatment starts before you know the price.'], ['Modern, gentle care', 'Current techniques and a calm approach.']], hospitality: [['Made fresh, every day', 'We do not do shortcuts.'], ['A warm welcome', 'Regulars and first-timers treated the same way.'], ['Seasonal by nature', 'The menu changes with what is good.']], beauty: [['Consultation first', 'We listen before we start.'], ['Professional products', 'Chosen for results and hair or skin health.'], ['A relaxed space', 'Time that is genuinely yours.']], wellness: [['Every level welcome', 'Sessions scaled to you, never the other way round.'], ['Qualified, caring coaches', 'Real attention, not a crowd.'], ['Progress you can see', 'We track what matters to you.']], creative: [['A clear process', 'You always know what happens next.'], ['Work with a point of view', 'Considered, not templated.'], ['On brief and on time', 'Deadlines are part of the craft.']], professional: [['Plain-English advice', 'No jargon, no hedging.'], ['Transparent fees', 'Agreed in writing before we start.'], ['Responsive by default', 'Calls and emails answered promptly.']], tech: [['Fast to set up', 'Running within a day, with help on hand.'], ['Secure by default', 'Encryption, permissions and audit logs built in.'], ['Human support', 'Real people who know the product.']], retail: [['Carefully chosen', 'Everything here earned its place.'], ['Easy returns', 'Changed your mind? No drama.'], ['Fast dispatch', 'Orders out the door quickly.']], education: [['Qualified teachers', 'Experienced, checked and genuinely good at explaining.'], ['Small groups', 'Room for every question.'], ['Regular feedback', 'You always know how it is going.']], events: [['One point of contact', 'From first idea to last dance.'], ['Trusted suppliers', 'People we have worked with many times.'], ['Calm on the day', 'We handle problems before you see them.']], nonprofit: [['Transparent accounts', 'Every pound and hour reported.'], ['Local roots', 'Run by people from the community.'], ['Real outcomes', 'We measure what changes, not what we spend.']], entertainment: [['Made in-house', 'Every detail by a small, caring team.'], ['Community first', 'Players shape what we build next.'], ['No dark patterns', 'You pay once and you own it.']], personal: [['Direct collaboration', 'You work with me, not an account manager.'], ['Clear scope and pricing', 'Agreed in writing.'], ['Reliable delivery', 'On time, every time.']], travel: [['Local, licensed guides', 'People who love the places they show you.'], ['Small groups', 'Never lost in a crowd.'], ['Clear inclusions', 'You know exactly what you are paying for.']] };
  for (const g of generic[brief.archetype] || generic.professional) { if (out.length >= 4) break; if (out.some((o) => low(o.check) === low(g[0]))) continue; out.push({ check: g[0], text: g[1], source: 'industry' }); }
  return out.slice(0, 4);
}
function whyText(id, brief) {
  const m = { '24/7': 'Day or night, someone answers.', emergency: 'Urgent jobs go to the front of the queue.', 'same-day': 'Order or book today and it happens today.', 'free-consultation': 'A first conversation, at no cost and no obligation.', 'free-quote': 'A clear price before you decide anything.', 'free-delivery': 'No delivery charge in our local area.', delivery: 'We bring it to you.', 'family-owned': 'Run by the family whose name is on it.', 'women-owned': 'Proudly women-owned and led.', 'award-winning': 'Recognised by people who know the industry.', licensed: 'Fully licensed — ask to see the paperwork.', insured: 'Comprehensive insurance for your peace of mind.', certified: 'Trained, accredited and up to date.', organic: 'Grown and made without the nasties.', vegan: 'Plant-based options that are not an afterthought.', halal: 'Halal-certified throughout.', 'gluten-free': 'Gluten-free options prepared with care.', 'local-sourcing': 'From growers and makers we know by name.', handmade: 'Made by hand, in small batches.', eco: 'Better for you and lighter on the planet.', bilingual: 'Help in the language you are most comfortable with.', accessible: 'Step-free access and space to move.', parking: 'Park right outside.', 'online-booking': 'Book in a minute, any time.', 'home-visits': 'We come to you when that is easier.', warranty: 'Backed by a written guarantee.', 'payment-plans': 'Spread the cost — ask us how.', 'walk-ins': 'No appointment needed.', remote: 'Sessions online, wherever you are.', multiplatform: 'Play on the platform you already own.' };
  return m[id] || 'Ask us about it.';
}

// ── About ────────────────────────────────────────────────────────────────────
function aboutFor(brief, pb, voice) {
  const n = brief.name || 'We';
  const where = brief.location && brief.location.raw ? brief.location.raw : '';
  const p = brief.people[0];
  const svc = brief.services.slice(0, 3).map((s) => low(s.title));
  const list = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
  const s = [];
  if (p && brief.founded) s.push(`${p.name} founded ${n} in ${brief.founded}${where ? ' in ' + where : ''}.`);
  else if (p) s.push(`${n} is led by ${p.name}${p.role && p.role !== 'Founder' && p.role !== 'Owner' ? ', ' + low(p.role) : ''}${where ? ', and based in ' + where : ''}.`);
  else if (brief.founded) s.push(`${n} has been ${where ? 'part of ' + where : 'doing this'} since ${brief.founded}.`);
  else s.push(voice.aboutOpen(n));
  if (svc.length) s.push(`We focus on ${list(svc)}${brief.audience.length ? ' for ' + list(brief.audience.slice(0, 2)) : ''}. The aim is simple: ${pb.outcome}.`);
  else s.push(`Everything we do comes back to one thing: ${pb.outcome}.`);
  if (brief.differentiators.length) s.push(`${cap(list(brief.differentiators.slice(0, 3).map((d) => low(d.label))))} — not slogans, just how we work.`);
  else s.push(`We keep things ${voice.adjectives[0]}, ${voice.adjectives[1]} and ${voice.adjectives[2]}, because that is what we would want ourselves.`);
  if (brief.products.items[0]) s.push(`Right now we are focused on ${brief.products.items[0].name}${brief.products.launch ? ', launching ' + brief.products.launch : ''}.`);
  return fit([s.join(' '), s.slice(0, 3).join(' '), s.slice(0, 2).join(' ')], BUDGET.about);
}

// ── Proof: strictly what the owner supplied ──────────────────────────────────
function proofFor(brief, plan) {
  const stats = [];
  for (const p of brief.proof) if (p.value) stats.push({ value: p.value, label: p.label, source: 'brief' });
  if (brief.yearsExperience >= 2 && !stats.some((s) => /year/i.test(s.label))) stats.push({ value: String(brief.yearsExperience), label: 'Years in business', source: 'brief' });
  if (Array.isArray(plan && plan.stats)) for (const s of plan.stats) if (s && s.label && s.value != null && stats.length < 4) stats.push({ value: String(s.value), label: String(s.label).slice(0, 30), source: 'plan' });
  const reviews = Array.isArray(plan && plan.reviews) ? plan.reviews.map((r) => ({ name: String(r.name || '').slice(0, 60), role: String(r.role || '').slice(0, 60), quote: String(r.text || r.quote || '').slice(0, 240), stars: Math.max(1, Math.min(5, Number(r.stars) || 5)) })).filter((r) => r.quote) : [];
  return { stats: stats.slice(0, 4), reviews: reviews.slice(0, 6) };
}

// ── FAQ: playbook truths, personalised with brief facts ─────────────────────
function faqFor(brief, pb, plan) {
  const given = Array.isArray(plan && (plan.faqs || plan.faq)) ? (plan.faqs || plan.faq).map((f) => ({ q: fit(String(f.q || ''), BUDGET.faqQ), a: fit(String(f.a || ''), BUDGET.faqA) })).filter((f) => f.q && f.a) : [];
  if (given.length >= 3) return given.slice(0, 6);
  const out = given.slice();
  const where = brief.location && brief.location.raw ? brief.location.raw : '';
  const local = brief.location && brief.location.serviceArea.length ? brief.location.serviceArea.join(', ') : '';
  const contactWords = [brief.contact.phone && 'call', brief.contact.whatsapp && 'WhatsApp', brief.contact.email && 'email'].filter(Boolean);
  if (where && ['trade', 'clinic', 'hospitality', 'beauty', 'wellness', 'retail', 'education', 'travel', 'events'].includes(brief.archetype)) out.push({ q: 'Where are you based?', a: fit(`We are in ${where}${local ? ' and cover ' + local : ''}. Directions and contact details are at the bottom of the page.`, BUDGET.faqA) });
  if (brief.contact.hours.length) out.push({ q: 'When are you open?', a: fit(`${cap(brief.contact.hours.join('; '))}. ${contactWords.length ? 'Outside those hours, ' + contactWords[0] + ' and we will get back to you.' : ''}`, BUDGET.faqA) });
  // Playbook answers are industry-typical, not this business's facts: an answer
  // that promises a phone call needs a phone number, one that promises a fast
  // arrival needs the business to actually do emergencies. Everything else is
  // reworded so it never asserts what the owner has not said.
  const canCall = !!(brief.contact.phone || brief.contact.whatsapp);
  const emergency = brief.differentiators.some((d) => d.id === 'emergency' || /24\/7|emergency/i.test(d.label));
  for (const f of pb.faq) {
    if (out.length >= 5) break;
    if (out.some((o) => low(o.q) === low(f[0]))) continue;
    let a = f[1];
    if (!canCall) a = a.replace(/\bCall(?: us)?\b(?= and| for| to| —)/g, 'Get in touch').replace(/\bcall(?: us)?\b(?= and| for| to| —)/g, 'get in touch').replace(/\b(?:phone|ring) us\b/gi, 'message us');
    if (/how fast|how quickly|how soon|arrival/i.test(f[0]) && !emergency) continue;
    if (/guarantee|warranty|insured|certified|qualified|registered/i.test(f[0]) && !brief.differentiators.some((d) => /guarantee|insured|certified|accredited|qualified/i.test(d.label))) continue;
    // A "Yes — …" answer asserts a fact. Keep it only when the brief gives evidence
    // for the thing asked about (a content word of the question appears in the brief).
    if (/^(yes|no)\b/i.test(a)) {
      const briefLow = low(String(brief.description || '') + ' ' + brief.differentiators.map((d) => d.label).join(' ') + ' ' + brief.services.map((x) => x.title).join(' '));
      const cues = low(f[0]).replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !/^(does|do|you|your|have|with|take|offer|need|there|what|when|where|which|from|that|this|they|them|will|can|could|should|would|about|into|over|also|only|just|more|than|some|any|are|for|the|and)$/.test(w));
      if (!cues.some((w) => briefLow.includes(w.replace(/s$/, '')))) continue;
    }
    out.push({ q: fit(f[0], BUDGET.faqQ), a: fit(a, BUDGET.faqA), source: 'suggested' });
  }
  return out.slice(0, 6);
}

function processFor(brief, pb, plan) {
  const given = Array.isArray(plan && plan.process) ? plan.process.map((p, i) => ({ step: i + 1, title: fit(String(p.title || p), 40), text: fit(String(p.text || p.desc || ''), 120) })).filter((p) => p.title) : [];
  if (given.length >= 3) return given.slice(0, 5);
  return pb.process.map((p, i) => ({ step: i + 1, title: fit(p[0], 40), text: fit(p[1], 120) }));
}

// ── Sitemap ──────────────────────────────────────────────────────────────────
// The section list is decided by industry playbook + what the brief actually
// contains. Sections with no honest content are dropped, not filled with filler.
function sitemapFor(brief, pb, content, plan) {
  const has = { gallery: Array.isArray(plan && plan.gallery_imgs) && plan.gallery_imgs.length > 0, pricing: Array.isArray(plan && plan.pricing) && plan.pricing.length > 0 || brief.prices.length > 0, team: Array.isArray(plan && plan.team) && plan.team.length > 0 || brief.people.length > 0, proof: content.proof.stats.length > 0 || content.proof.reviews.length > 0, hours: brief.contact.hours.length > 0, map: !!brief.contact.address || !!(brief.location && brief.location.raw && ['trade', 'clinic', 'hospitality', 'beauty', 'retail'].includes(brief.archetype)), product: brief.products.items.length > 0, video: !!(plan && plan.video_url), logos: Array.isArray(plan && plan.logos) && plan.logos.length > 0, areas: !!(brief.location && (brief.location.serviceArea.length || brief.location.raw)) };
  const rename = { occasions: 'occasions', menu: 'services', rooms: 'services', amenities: 'why', schedule: 'process', listings: 'gallery', collections: 'services', featured: 'gallery', tours: 'services', programs: 'services', impact: 'proof', stories: 'proof', showcase: 'product', features: 'services', how: 'process', listen: 'product', shows: 'process', press: 'proof', devlog: 'lead', work: 'gallery', location: 'map' };
  const out = [];
  for (const raw of pb.sections) {
    const s = rename[raw] || raw;
    if (s === 'gallery' && !has.gallery) continue;
    if (s === 'pricing' && !has.pricing) continue;
    if (s === 'team' && !has.team) continue;
    if (s === 'proof' && !has.proof) continue;
    if (s === 'hours' && !has.hours) continue;
    if (s === 'product' && !has.product) continue;
    if (s === 'areas' && !has.areas) continue;
    if (s === 'trust' && !content.why.length) continue;
    if (!out.includes(s)) out.push(s);
  }
  if (has.video && !out.includes('video')) out.splice(Math.max(1, out.indexOf('about')), 0, 'video');
  if (has.logos && !out.includes('logos')) out.splice(1, 0, 'logos');
  if (!out.includes('why') && content.why.length && !out.includes('trust')) out.splice(Math.min(out.length, 3), 0, 'why');
  if (has.map && !out.includes('map')) out.push('map');
  // nav = the sections a visitor navigates to
  const navLabels = { services: brief.archetype === 'hospitality' ? 'Menu' : brief.industry.id === 'law' ? 'Practice areas' : brief.archetype === 'clinic' ? 'Treatments' : brief.industry.id === 'games' ? 'Features' : brief.industry.id === 'saas' ? 'Features' : ['fitness', 'yoga', 'school'].includes(brief.industry.id) ? 'Classes' : brief.archetype === 'retail' && brief.industry.id !== 'florist' ? 'Shop' : 'Services', occasions: 'Occasions', product: brief.products.items[0] ? brief.products.items[0].name : 'The game', gallery: brief.archetype === 'creative' || brief.archetype === 'personal' ? 'Work' : 'Gallery', about: 'About', team: 'Team', process: brief.industry.id === 'games' ? 'Roadmap' : ['fitness', 'yoga'].includes(brief.industry.id) ? 'Schedule' : 'How it works', pricing: 'Pricing', proof: brief.archetype === 'nonprofit' ? 'Impact' : 'Reviews', faq: 'FAQ', contact: 'Contact', hours: 'Hours', areas: 'Areas', map: 'Find us', why: 'Why us', trust: 'Why us' };
  const nav = out.filter((s) => ['services', 'occasions', 'product', 'gallery', 'about', 'team', 'process', 'pricing', 'proof', 'faq', 'contact'].includes(s)).slice(0, 7).map((s) => ({ id: s, label: navLabels[s] || cap(s) }));
  return { sections: out, nav, labels: navLabels, has };
}

// ── Pricing tiers: each price is named after the thing the brief priced ─────
// "dental implants £1,950" → { name: 'Dental implants', price: '£1,950' }.
// Falls back to the service list by position, then to neutral labels; never
// two tiers with the same name, at most 4 tiers (the estimator shows them).
function pricingTiers(brief) {
  const used = new Set(); const tiers = [];
  const services = brief.services.map((s) => cap(s.title));
  // Only a price that names its subject may be attributed to a service; a
  // bare "prices from £250" becomes a "From £250" starting-price tier, never
  // a claim that the first listed service costs £250.
  for (const p of brief.prices) {
    let name = p.label ? cap(p.label) : '';
    if (name) {
      const svc = services.find((t) => !used.has(t.toLowerCase()) && (t.toLowerCase() === name.toLowerCase() || t.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(t.toLowerCase())));
      if (svc) name = svc;
    }
    if (!name) name = p.from ? 'Starting price' : tiers.length === 0 ? 'Standard' : 'Option ' + (tiers.length + 1);
    if (used.has(name.toLowerCase())) continue;
    used.add(name.toLowerCase());
    tiers.push({ name, price: (p.from ? 'from ' : '') + p.amount, per: p.per || '', features: [], text: '' });
    if (tiers.length >= 4) break;
  }
  return tiers;
}

// ── Section headings per industry & tone ────────────────────────────────────
function headingsFor(brief, pb, voice, sitemap) {
  const n = brief.name || 'us';
  const L = sitemap.labels;
  const H = {};
  H.services = { kicker: fit(L.services === 'Menu' ? 'On the menu' : L.services === 'Practice areas' ? 'How we can help' : L.services === 'Treatments' ? 'Treatments' : L.services === 'Classes' ? 'What we teach' : L.services === 'Features' ? 'What you get' : L.services === 'Shop' ? 'The collection' : 'What we do', BUDGET.kicker), title: fit(L.services === 'Menu' ? 'Cooked fresh, served warm' : L.services === 'Practice areas' ? 'Practice areas' : L.services === 'Treatments' ? 'Treatments and care' : L.services === 'Classes' ? 'Classes and programmes' : L.services === 'Features' ? `What makes it ${brief.personality.primary === 'playful' ? 'special' : 'different'}` : L.services === 'Shop' ? 'Shop the collection' : brief.archetype === 'trade' ? `Services in ${brief.location && brief.location.city ? brief.location.city : 'your area'}` : `What ${n} does best`, BUDGET.sectionTitle) };
  H.why = { kicker: fit(voice === VOICE.warm ? 'Why people choose us' : 'Why us', BUDGET.kicker), title: fit(brief.personality.primary === 'bold' ? 'Why us? Simple.' : brief.personality.primary === 'refined' ? 'The difference is in the details' : brief.personality.primary === 'calm' ? 'What you can expect' : `Why ${n}`, BUDGET.sectionTitle) };
  H.trust = { kicker: H.why.kicker, title: fit(brief.differentiators.length ? 'What you can count on' : H.why.title, BUDGET.sectionTitle) };
  H.about = { kicker: fit(pb.kicker, BUDGET.kicker), title: fit(brief.people[0] ? `Meet ${brief.people[0].name.split(' ')[0]}` + (brief.people[0].name.split(' ').length > 1 ? ` ${brief.people[0].name.split(' ').slice(1).join(' ')}` : '') : brief.founded ? `${n} since ${brief.founded}` : `About ${n}`, BUDGET.sectionTitle) };
  H.process = { kicker: fit(brief.industry.id === 'games' ? 'Roadmap' : ['fitness', 'yoga'].includes(brief.industry.id) ? 'Getting started' : 'How it works', BUDGET.kicker), title: fit(brief.industry.id === 'games' ? 'From wishlist to launch day' : brief.archetype === 'trade' ? 'From first call to finished job' : brief.archetype === 'clinic' ? 'Your first visit, step by step' : brief.archetype === 'hospitality' ? 'Simple, from start to finish' : 'How it works', BUDGET.sectionTitle) };
  H.proof = { kicker: fit(brief.archetype === 'nonprofit' ? 'Impact' : 'In their words', BUDGET.kicker), title: fit(brief.archetype === 'nonprofit' ? 'What changes because of you' : `What ${pb.people} say`, BUDGET.sectionTitle) };
  H.faq = { kicker: 'Good to know', title: fit(brief.personality.primary === 'warm' ? 'Questions we hear a lot' : 'Frequently asked questions', BUDGET.sectionTitle) };
  H.gallery = { kicker: fit(brief.archetype === 'creative' || brief.archetype === 'personal' ? 'Selected work' : 'Gallery', BUDGET.kicker), title: fit(brief.archetype === 'creative' || brief.archetype === 'personal' ? 'Recent work' : `A look inside ${n}`, BUDGET.sectionTitle) };
  H.pricing = { kicker: 'Pricing', title: fit(brief.prices.length && brief.prices[0].from ? `From ${brief.prices[0].amount}${brief.prices[0].per ? ' / ' + brief.prices[0].per : ''}` : 'Simple, transparent pricing', BUDGET.sectionTitle) };
  H.team = { kicker: 'The team', title: fit(brief.archetype === 'clinic' ? 'The people looking after you' : 'The people behind the work', BUDGET.sectionTitle) };
  H.contact = { kicker: 'Contact', title: fit(brief.location && brief.location.city ? `Find us in ${brief.location.city}` : 'Get in touch', BUDGET.sectionTitle) };
  H.occasions = { kicker: 'Occasions', title: 'Flowers for every moment' };
  H.product = { kicker: fit(brief.products.launch ? `Launching ${brief.products.launch}` : 'Featured', BUDGET.kicker), title: fit(brief.products.items[0] ? brief.products.items[0].name : 'Featured', BUDGET.sectionTitle) };
  H.hours = { kicker: 'Opening hours', title: 'When to find us' };
  H.areas = { kicker: 'Where we work', title: fit(brief.location && brief.location.city ? `Covering ${brief.location.city} and nearby` : 'Areas we cover', BUDGET.sectionTitle) };
  H.map = { kicker: 'Find us', title: fit(brief.contact.address || (brief.location && brief.location.raw) || 'Our location', BUDGET.sectionTitle) };
  return H;
}

// ── Marquee / trust strip: real facts only ───────────────────────────────────
function marqueeFor(brief, pb, voice) {
  const items = [];
  for (const d of brief.differentiators) items.push(d.label);
  if (brief.location && brief.location.city) items.push(`Based in ${brief.location.city}`);
  if (brief.founded) items.push(`Est. ${brief.founded}`);
  for (const s of brief.services.slice(0, 4)) items.push(cap(s.title));
  if (brief.contact.hours[0]) items.push(cap(brief.contact.hours[0]));
  for (const b of voice.badge) items.push(b);
  // never truncate a strip item — drop the ones that do not fit instead
  return uniq(items.map(clean).filter((t) => t && t.length <= BUDGET.marquee)).slice(0, 6);
}

// ── Main ─────────────────────────────────────────────────────────────────────
function nxWriteSite(brief, plan) {
  plan = plan && typeof plan === 'object' ? plan : {};
  const pb = playbookFor(brief);
  const voice = VOICE[brief.personality.primary] || VOICE.precise;
  const cta = CTA[brief.cta.intent] || CTA.call;
  const services = servicesFor(brief, pb);
  const why = whyFor(brief, pb, voice, plan);
  const proof = proofFor(brief, plan);
  const authored = (k, budget) => (plan[k] ? fit(String(plan[k]), budget) : '');
  const headline = authored('hero_headline', BUDGET.headline) || headlineFor(brief, pb, voice);
  const sub = authored('hero_sub', BUDGET.sub) || subFor(brief, pb);
  const ctaPrimary = authored('cta_primary', BUDGET.cta) || fit(cta.primary, BUDGET.cta);
  const ctaSecondary = authored('cta_secondary', BUDGET.ctaSecondary) || fit(cta.secondary, BUDGET.ctaSecondary);
  const badge = authored('badge', BUDGET.badge) || fit([brief.differentiators[0] ? brief.differentiators[0].label : '', brief.location && brief.location.city ? `${pb.kicker === 'About me' ? 'Based' : brief.industry.label} in ${brief.location.city}` : '', pick(voice.badge, brief.seed, 3)].filter(Boolean), BUDGET.badge);
  const about = authored('about', BUDGET.about) || aboutFor(brief, pb, voice);
  const content = { headline, sub, ctaPrimary, ctaSecondary, badge, services: services.cards, why, about, proof, faq: faqFor(brief, pb, plan), process: processFor(brief, pb, plan), marquee: Array.isArray(plan.marquee_items) && plan.marquee_items.length ? plan.marquee_items.map((t) => fit(String(t), BUDGET.marquee)) : marqueeFor(brief, pb, voice), lead: { title: authored('lead_title', BUDGET.lead) || fit(pick(voice.leadTitle, brief.seed, 1), BUDGET.lead), sub: authored('lead_text', BUDGET.leadSub) || fit(voice.leadSub, BUDGET.leadSub), cta: ctaPrimary } };
  const sitemap = sitemapFor(brief, pb, content, plan);
  const headings = headingsFor(brief, pb, voice, sitemap);
  const noun = require('./nx_brief.js').nxIndustryNoun(brief.industry.id, true);
  const metaDesc = fit([`${brief.name} — ${noun}${brief.location && brief.location.raw ? ' in ' + brief.location.raw : ''}. ${brief.services.length ? cap(brief.services.slice(0, 3).map((s) => low(s.title)).join(', ')) + '. ' : ''}${cap(pb.outcome)}.`, sub], 160);
  const warnings = [];
  if (services.suggested) warnings.push('Some service cards are suggestions based on your industry — edit them to match exactly what you offer.');
  if (content.faq.some((f) => f.source === 'suggested')) warnings.push('Some FAQ entries are industry-typical wording, not your own facts — check each answer before publishing.');
  if (!proof.stats.length && !proof.reviews.length) warnings.push('No reviews or numbers were provided, so no testimonials or statistics were invented. Add real ones to unlock a proof section.');
  const rationale = `${brief.industry.label} playbook, ${brief.personality.primary} voice${brief.personality.secondary ? ' with ' + brief.personality.secondary + ' notes' : ''}; ${sitemap.sections.length} sections chosen for a "${brief.cta.intent}" goal. ${brief.facts.length} facts from your brief were used; nothing was invented.`;
  return { content, sitemap, headings, playbook: { id: brief.industry.id, outcome: pb.outcome, occasions: pb.occasions || null }, metaDesc, rationale, warnings, voice: brief.personality.primary };
}

// ── Adapter: the rich write-up → the legacy content-plan shape the renderers
// already understand (renderSectionsHtml / nxComposePlanFromBlueprint /
// nxTemplatePlanFromBlueprint). Keeps every existing design working.
function nxContentPlanFromWriteup(brief, w, plan) {
  plan = plan && typeof plan === 'object' ? plan : {};
  const c = w.content;
  const contact = { phone: brief.contact.phone || '', email: brief.contact.email || '', address: brief.contact.address || (plan.contact && plan.contact.address) || '', hours: brief.contact.hours[0] || '', whatsapp: brief.contact.whatsapp || '' };
  const hours = brief.contact.hours.length ? brief.contact.hours : (Array.isArray(plan.working_hours) && plan.working_hours.length ? plan.working_hours : []);
  return {
    _industry: brief.industry.id, _archetype: brief.archetype, _personality: brief.personality.primary, _language: brief.language.code, _dir: brief.language.dir, _schema: brief.industry.schema,
    _sitemap: w.sitemap, _headings: w.headings, _warnings: w.warnings, _rationale: w.rationale,
    name: brief.name, meta_desc: w.metaDesc, tagline: c.sub,
    hero: { badge: c.badge, title: c.headline, sub: c.sub, primary: c.ctaPrimary, secondary: c.ctaSecondary, image: plan.hero_image || plan.about_image || '' },
    marquee: c.marquee,
    services: c.services.map((s) => ({ icon: s.icon, title: s.title, text: s.text })),
    stats: c.proof.stats.length ? c.proof.stats.map((s) => ({ label: s.label, value: s.value })) : null,
    why: c.why.map((x) => ({ check: x.check, text: x.text })),
    about: { heading: w.headings.about.title, body: c.about, image: plan.about_image || '' },
    process: c.process,
    reviews: c.proof.reviews.length ? c.proof.reviews : null,
    pricing: Array.isArray(plan.pricing) && plan.pricing.length ? plan.pricing : (brief.prices.length ? pricingTiers(brief) : null),
    team: Array.isArray(plan.team) && plan.team.length ? plan.team : (brief.people.length ? brief.people.map((p) => ({ name: p.name, role: p.role, emoji: '👤', bio: '' })) : null),
    timeline: Array.isArray(plan.timeline) && plan.timeline.length ? plan.timeline : null,
    logos: Array.isArray(plan.logos) && plan.logos.length ? plan.logos : null,
    gallery_imgs: Array.isArray(plan.gallery_imgs) ? plan.gallery_imgs : [],
    video_url: plan.video_url || '',
    faq: c.faq,
    contact, working_hours: hours,
    cta: { heading: c.lead.title, sub: c.lead.sub, primary: c.lead.cta },
    product: brief.products.items[0] ? { name: brief.products.items[0].name, launch: brief.products.launch, platforms: brief.products.platforms } : null,
    occasions: w.playbook.occasions,
    areas: brief.location ? { city: brief.location.city, region: brief.location.region, serviceArea: brief.location.serviceArea } : null,
  };
}

module.exports = { nxWriteSite, nxContentPlanFromWriteup, PLAYBOOKS, VOICE, CTA, BUDGET, fit, __internals: { headlineFor, subFor, servicesFor, whyFor, aboutFor, faqFor, sitemapFor, headingsFor, marqueeFor, playbookFor } };
