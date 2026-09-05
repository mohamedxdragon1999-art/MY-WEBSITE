'use strict';
// ══════════════════════════════════════════════════════════════════════════
// nx_brief.js — NATURAL-LANGUAGE BRIEF UNDERSTANDING (English first)
//
// What the leading prompt-to-website builders (Wix Harmony/Aria, Durable,
// Squarespace Blueprint, Relume, Framer) all do BEFORE they draw a pixel is
// read the brief and turn it into decisions: what the business is, who it is
// for, what it offers, where it is, how to reach it, how it should feel and
// what the visitor should do. A brief that is not understood becomes a generic
// theme with the prompt pasted into the hero — which is exactly what our
// benchmark measured (65% identical copy across four unrelated businesses).
//
// This module is the "Intent Parser". It is deterministic, dependency-free and
// runs in the Worker, the browser and the test harness. It extracts:
//
//   industry (45 ids, weighted-keyword scoring with confidence + runners-up)
//   services / offers  ("offering X, Y and Z", "we do X; Y", noun-phrase lists)
//   location            ("in Portland, Oregon", "based in Nasr City, Cairo")
//   contact             (phone, WhatsApp, email, website, socials, hours)
//   people              (founder / owner / lead practitioner + role)
//   time facts          (founded year, years of experience)
//   audience            (families, couples, small businesses, patients…)
//   tone → personality  (warm / refined / bold / precise / calm / playful)
//   products & launches ("Lantern Hollow", launching this October)
//   prices, differentiators, social proof THE USER STATED (never invented)
//   call-to-action intent (book / order / quote / consult / wishlist / enrol…)
//   language + direction (English first; Arabic/Hebrew → rtl)
//
// …and, like the best builders, it says what it understood, what it assumed
// and what it still needs to ask (nxBriefSummary / nxBriefQuestions).
//
// HARD RULE: nothing here manufactures a fact. Every extracted value points
// back to a span of the user's own words (`facts[]` carries the evidence).
// ══════════════════════════════════════════════════════════════════════════

// ── Industry taxonomy ────────────────────────────────────────────────────────
// archetype drives structure (nx_sitemap) and voice (nx_copywriter).
// kw: [term, weight]. Multi-word terms match as phrases. Name hits count ×1.6.
const NX_TAXONOMY = [
  { id: 'florist', label: 'Florist', archetype: 'retail', schema: 'Florist', kw: [['florist', 6], ['flower shop', 6], ['flowers', 3], ['bouquet', 4], ['floral', 4], ['arrangements', 2], ['wedding flowers', 5], ['blooms', 3]] },
  { id: 'bakery', label: 'Bakery', archetype: 'hospitality', schema: 'Bakery', kw: [['bakery', 6], ['bakes', 2], ['baked', 2], ['bread', 3], ['pastry', 3], ['pastries', 3], ['cakes', 3], ['sourdough', 4], ['patisserie', 5], ['cupcake', 3]] },
  { id: 'cafe', label: 'Café', archetype: 'hospitality', schema: 'CafeOrCoffeeShop', kw: [['cafe', 5], ['café', 5], ['coffee shop', 6], ['coffee', 3], ['espresso', 4], ['roastery', 5], ['barista', 4], ['brunch', 2], ['tea room', 4]] },
  { id: 'restaurant', label: 'Restaurant', archetype: 'hospitality', schema: 'Restaurant', kw: [['restaurant', 6], ['bistro', 5], ['diner', 4], ['eatery', 4], ['grill', 3], ['pizzeria', 5], ['pizza', 3], ['sushi', 4], ['kitchen', 1], ['menu', 2], ['dishes', 2], ['chef', 3], ['cuisine', 3], ['dining', 3], ['takeaway', 2], ['takeout', 2], ['steakhouse', 5], ['trattoria', 5], ['ramen', 4], ['burger', 3], ['seafood', 3], ['fine dining', 5]] },
  { id: 'bar', label: 'Bar & Lounge', archetype: 'hospitality', schema: 'BarOrPub', kw: [['bar', 3], ['pub', 5], ['cocktail', 5], ['cocktails', 5], ['brewery', 5], ['taproom', 5], ['wine bar', 6], ['lounge', 3], ['nightlife', 3]] },
  { id: 'hotel', label: 'Hotel & Stays', archetype: 'hospitality', schema: 'LodgingBusiness', kw: [['hotel', 6], ['guesthouse', 6], ['guest house', 6], ['bed and breakfast', 6], ['b&b', 5], ['hostel', 5], ['resort', 5], ['villa', 3], ['airbnb', 4], ['rooms', 2], ['stay', 1], ['boutique hotel', 7], ['lodge', 4]] },
  { id: 'catering', label: 'Catering', archetype: 'hospitality', schema: 'FoodEstablishment', kw: [['catering', 6], ['caterer', 6], ['cater', 4], ['private chef', 5], ['meal prep', 5]] },
  { id: 'dental', label: 'Dental Clinic', archetype: 'clinic', schema: 'Dentist', kw: [['dental', 6], ['dentist', 6], ['dentistry', 6], ['teeth', 3], ['tooth', 3], ['orthodont', 5], ['implants', 3], ['whitening', 3], ['braces', 4], ['invisalign', 5], ['smile', 1], ['root canal', 5]] },
  { id: 'medical', label: 'Medical Clinic', archetype: 'clinic', schema: 'MedicalClinic', kw: [['clinic', 4], ['medical', 4], ['doctor', 4], ['doctors', 4], ['gp', 2], ['physician', 5], ['pediatric', 5], ['paediatric', 5], ['dermatolog', 5], ['cardiolog', 5], ['patients', 3], ['health centre', 5], ['health center', 5], ['urgent care', 6], ['family medicine', 6], ['surgery', 3]] },
  { id: 'physio', label: 'Physiotherapy', archetype: 'clinic', schema: 'Physiotherapy', kw: [['physio', 6], ['physiotherap', 6], ['physical therapy', 6], ['chiropract', 6], ['osteopath', 6], ['rehab', 4], ['rehabilitation', 4], ['sports injur', 5], ['massage therapy', 4]] },
  { id: 'vet', label: 'Veterinary', archetype: 'clinic', schema: 'VeterinaryCare', kw: [['vet', 4], ['veterinar', 6], ['animal hospital', 6], ['pet clinic', 6], ['pets', 2], ['dogs and cats', 3]] },
  { id: 'pharmacy', label: 'Pharmacy', archetype: 'clinic', schema: 'Pharmacy', kw: [['pharmacy', 6], ['pharmacist', 6], ['chemist', 4], ['prescriptions', 4]] },
  { id: 'therapy', label: 'Therapy & Counselling', archetype: 'clinic', schema: 'MedicalBusiness', kw: [['therapist', 5], ['therapy', 3], ['counsel', 5], ['counsell', 5], ['psycholog', 6], ['psychotherap', 6], ['mental health', 6], ['coaching', 1], ['anxiety', 3], ['couples therapy', 6]] },
  { id: 'plumbing', label: 'Plumbing', archetype: 'trade', schema: 'Plumber', kw: [['plumb', 6], ['plumber', 7], ['plumbing', 7], ['drain', 4], ['drains', 4], ['leak', 3], ['leaks', 3], ['boiler', 4], ['water heater', 5], ['pipes', 3], ['blocked', 2]] },
  { id: 'electrician', label: 'Electrical', archetype: 'trade', schema: 'Electrician', kw: [['electrician', 7], ['electrical', 6], ['rewir', 5], ['wiring', 4], ['fuse', 3], ['lighting installation', 5], ['ev charger', 5], ['solar', 2]] },
  { id: 'hvac', label: 'Heating & Cooling', archetype: 'trade', schema: 'HVACBusiness', kw: [['hvac', 7], ['air conditioning', 6], ['air con', 5], ['ac repair', 6], ['heating', 4], ['cooling', 3], ['furnace', 5], ['heat pump', 5], ['ventilation', 4]] },
  { id: 'roofing', label: 'Roofing', archetype: 'trade', schema: 'RoofingContractor', kw: [['roof', 5], ['roofing', 7], ['roofer', 7], ['gutters', 4], ['shingles', 5], ['skylight', 3]] },
  { id: 'construction', label: 'Construction & Remodeling', archetype: 'trade', schema: 'GeneralContractor', kw: [['construction', 6], ['contractor', 5], ['builder', 4], ['builders', 4], ['remodel', 5], ['renovat', 5], ['extension', 3], ['extensions', 3], ['kitchen fitting', 5], ['bathroom fitting', 5], ['loft conversion', 6], ['groundworks', 6], ['drainage', 4], ['septic', 5], ['carpentry', 5], ['joinery', 5], ['tiling', 4], ['painting and decorating', 6], ['decorators', 5], ['handyman', 6]] },
  { id: 'landscaping', label: 'Landscaping & Gardens', archetype: 'trade', schema: 'HomeAndConstructionBusiness', kw: [['landscap', 7], ['garden', 4], ['gardening', 5], ['gardener', 5], ['lawn', 5], ['tree surgeon', 6], ['tree removal', 6], ['patio', 3], ['fencing', 4], ['irrigation', 4]] },
  { id: 'cleaning', label: 'Cleaning', archetype: 'trade', schema: 'HousePainter', kw: [['cleaning', 6], ['cleaners', 6], ['cleaner', 5], ['housekeeping', 6], ['maid', 5], ['janitorial', 6], ['carpet cleaning', 6], ['window cleaning', 6], ['pressure wash', 6], ['deep clean', 5], ['end of tenancy', 6]] },
  { id: 'pest', label: 'Pest Control', archetype: 'trade', schema: 'HomeAndConstructionBusiness', kw: [['pest', 6], ['pest control', 8], ['exterminat', 7], ['rodent', 5], ['termite', 6], ['wasp', 4], ['bed bug', 6]] },
  { id: 'moving', label: 'Moving & Removals', archetype: 'trade', schema: 'MovingCompany', kw: [['movers', 6], ['moving company', 7], ['removals', 7], ['relocation', 5], ['man and van', 7], ['storage', 2], ['packing', 3], ['house move', 6]] },
  { id: 'auto', label: 'Auto Repair', archetype: 'trade', schema: 'AutoRepair', kw: [['mechanic', 6], ['garage', 4], ['auto repair', 7], ['car repair', 7], ['tyres', 5], ['tires', 5], ['mot', 3], ['brakes', 4], ['car service', 5], ['bodyshop', 6], ['body shop', 6], ['detailing', 4], ['car wash', 5], ['oil change', 5]] },
  { id: 'security', label: 'Security & Locksmith', archetype: 'trade', schema: 'Locksmith', kw: [['locksmith', 8], ['cctv', 6], ['alarm', 4], ['alarms', 4], ['security systems', 6], ['access control', 5]] },
  { id: 'salon', label: 'Hair Salon', archetype: 'beauty', schema: 'HairSalon', kw: [['salon', 5], ['hair', 4], ['hairdresser', 7], ['hairstylist', 7], ['stylist', 3], ['balayage', 6], ['blowout', 5], ['haircut', 6], ['colourist', 6], ['colorist', 6], ['extensions', 1]] },
  { id: 'barber', label: 'Barbershop', archetype: 'beauty', schema: 'HairSalon', kw: [['barber', 7], ['barbershop', 8], ['beard', 4], ['fade', 3], ['hot towel', 5]] },
  { id: 'spa', label: 'Spa & Beauty', archetype: 'beauty', schema: 'BeautySalon', kw: [['spa', 5], ['beauty', 4], ['facial', 5], ['facials', 5], ['massage', 4], ['nails', 5], ['nail salon', 7], ['manicure', 6], ['pedicure', 6], ['lashes', 5], ['brows', 5], ['waxing', 5], ['aesthetic', 4], ['aesthetics', 4], ['skincare', 5], ['botox', 5], ['makeup artist', 6]] },
  { id: 'tattoo', label: 'Tattoo Studio', archetype: 'beauty', schema: 'TattooParlor', kw: [['tattoo', 8], ['tattoos', 8], ['piercing', 6], ['ink', 2]] },
  { id: 'fitness', label: 'Fitness & Training', archetype: 'wellness', schema: 'HealthClub', kw: [['gym', 6], ['fitness', 6], ['personal trainer', 7], ['personal training', 7], ['crossfit', 7], ['workout', 4], ['bootcamp', 6], ['strength', 2], ['pilates', 6], ['boxing', 4], ['martial arts', 6], ['classes', 1], ['coach', 2]] },
  { id: 'yoga', label: 'Yoga & Wellness', archetype: 'wellness', schema: 'HealthAndBeautyBusiness', kw: [['yoga', 8], ['meditation', 6], ['wellness', 4], ['mindfulness', 5], ['retreat', 3], ['breathwork', 6], ['holistic', 4], ['reiki', 6]] },
  { id: 'nutrition', label: 'Nutrition & Coaching', archetype: 'wellness', schema: 'HealthAndBeautyBusiness', kw: [['nutrition', 6], ['nutritionist', 8], ['dietitian', 8], ['dietician', 8], ['meal plan', 5], ['weight loss', 5], ['health coach', 6], ['life coach', 5]] },
  { id: 'photography', label: 'Photography', archetype: 'creative', schema: 'ProfessionalService', kw: [['photograph', 7], ['photographer', 8], ['photo studio', 7], ['photos', 3], ['portrait', 4], ['portraits', 4], ['headshots', 6], ['videograph', 6], ['film maker', 5], ['filmmaker', 5], ['wedding photograph', 8]] },
  { id: 'design', label: 'Design Studio', archetype: 'creative', schema: 'ProfessionalService', kw: [['design studio', 7], ['design agency', 7], ['graphic design', 7], ['branding', 5], ['brand identity', 6], ['ux', 4], ['ui', 3], ['web design', 6], ['illustrat', 5], ['creative studio', 7], ['creative agency', 7], ['logo', 3], ['motion design', 6]] },
  { id: 'marketing', label: 'Marketing Agency', archetype: 'creative', schema: 'ProfessionalService', kw: [['marketing', 6], ['marketing agency', 8], ['advertis', 5], ['seo', 5], ['social media', 5], ['ppc', 5], ['content marketing', 6], ['growth agency', 6], ['pr agency', 6], ['public relations', 6]] },
  { id: 'architecture', label: 'Architecture & Interiors', archetype: 'creative', schema: 'ProfessionalService', kw: [['architect', 7], ['architecture', 7], ['interior design', 8], ['interior designer', 8], ['interiors', 5], ['spatial design', 6]] },
  { id: 'music', label: 'Music & Audio', archetype: 'entertainment', schema: 'MusicGroup', kw: [['band', 3], ['musician', 6], ['singer', 5], ['dj', 5], ['recording studio', 7], ['music producer', 7], ['album', 4], ['podcast', 6], ['sound design', 5], ['music lessons', 6]] },
  { id: 'games', label: 'Game Studio', archetype: 'entertainment', schema: 'Organization', kw: [['game studio', 9], ['games studio', 9], ['indie game', 9], ['indie games', 9], ['video game', 8], ['video games', 8], ['game developer', 8], ['gamedev', 8], ['steam', 4], ['playstation', 5], ['nintendo', 5], ['xbox', 5], ['pixel art', 5], ['rpg', 4], ['puzzle game', 6], ['cozy game', 7], ['cosy game', 7], ['board game', 6], ['tabletop', 5]] },
  { id: 'events', label: 'Events & Weddings', archetype: 'events', schema: 'EventVenue', kw: [['event planner', 8], ['event planning', 8], ['wedding planner', 9], ['wedding planning', 9], ['events company', 7], ['venue', 5], ['party', 3], ['parties', 3], ['celebration', 3], ['corporate events', 6], ['conference', 3], ['festival', 4]] },
  { id: 'law', label: 'Law Firm', archetype: 'professional', schema: 'LegalService', kw: [['law firm', 9], ['lawyer', 8], ['lawyers', 8], ['solicitor', 8], ['solicitors', 8], ['attorney', 8], ['attorneys', 8], ['legal', 5], ['barrister', 7], ['litigation', 6], ['employment law', 8], ['family law', 8], ['immigration law', 8], ['conveyancing', 7], ['notary', 6]] },
  { id: 'accounting', label: 'Accounting & Tax', archetype: 'professional', schema: 'AccountingService', kw: [['accountant', 8], ['accounting', 8], ['bookkeep', 7], ['tax', 4], ['taxes', 4], ['payroll', 5], ['cpa', 6], ['audit', 3], ['vat', 4]] },
  { id: 'consulting', label: 'Consulting', archetype: 'professional', schema: 'ProfessionalService', kw: [['consultant', 6], ['consultancy', 7], ['consulting', 7], ['advisory', 6], ['strategy', 3], ['business coach', 6], ['hr consult', 7], ['management consult', 8]] },
  { id: 'finance', label: 'Financial Services', archetype: 'professional', schema: 'FinancialService', kw: [['financial advis', 8], ['financial planning', 8], ['mortgage', 7], ['mortgages', 7], ['insurance', 6], ['broker', 4], ['wealth', 4], ['investment', 4], ['loans', 4], ['fintech', 3]] },
  { id: 'realestate', label: 'Real Estate', archetype: 'professional', schema: 'RealEstateAgent', kw: [['real estate', 8], ['realtor', 8], ['estate agent', 8], ['property', 4], ['properties', 5], ['apartments', 4], ['homes for sale', 7], ['lettings', 6], ['letting agent', 7], ['property management', 7], ['rentals', 3], ['developer', 1]] },
  { id: 'saas', label: 'Software / SaaS', archetype: 'tech', schema: 'SoftwareApplication', kw: [['saas', 8], ['software', 6], ['platform', 4], ['app', 3], ['mobile app', 6], ['api', 4], ['dashboard', 4], ['automation', 4], ['startup', 4], ['ai', 3], ['machine learning', 5], ['analytics', 4], ['cloud', 3], ['crm', 4], ['tool for', 3], ['no-code', 5], ['devtool', 5], ['open source', 4]] },
  { id: 'itservices', label: 'IT Services & Web', archetype: 'tech', schema: 'ProfessionalService', kw: [['it services', 8], ['it support', 8], ['managed services', 7], ['web development', 7], ['software development', 7], ['app development', 7], ['web developer', 7], ['cyber', 5], ['cybersecurity', 7], ['networking', 4], ['computer repair', 7], ['hosting', 4], ['digital agency', 6]] },
  { id: 'ecommerce', label: 'Online Store', archetype: 'retail', schema: 'Store', kw: [['online store', 8], ['online shop', 8], ['e-commerce', 8], ['ecommerce', 8], ['shop', 3], ['store', 3], ['boutique', 5], ['sell', 3], ['products', 3], ['handmade', 4], ['jewelry', 6], ['jewellery', 6], ['clothing', 5], ['fashion', 5], ['apparel', 6], ['gifts', 4], ['candles', 5], ['furniture', 5], ['bookshop', 6], ['bookstore', 6], ['pet store', 6], ['skincare products', 6], ['merch', 4], ['brand', 1]] },
  { id: 'grocery', label: 'Grocery & Food Shop', archetype: 'retail', schema: 'GroceryStore', kw: [['grocery', 7], ['grocer', 6], ['supermarket', 7], ['butcher', 7], ['deli', 5], ['farm shop', 7], ['organic produce', 6], ['market stall', 5], ['fishmonger', 7]] },
  { id: 'school', label: 'School & Tutoring', archetype: 'education', schema: 'EducationalOrganization', kw: [['school', 5], ['tutor', 7], ['tutoring', 8], ['tuition', 6], ['academy', 5], ['courses', 4], ['course', 3], ['training', 3], ['lessons', 4], ['learn', 2], ['students', 4], ['teacher', 4], ['language school', 8], ['driving school', 8], ['driving instructor', 8], ['bootcamp', 2], ['workshop', 2], ['exam prep', 7], ['nursery', 5], ['preschool', 7], ['daycare', 7], ['childcare', 7], ['kindergarten', 7]] },
  { id: 'nonprofit', label: 'Non-profit & Community', archetype: 'nonprofit', schema: 'NGO', kw: [['charity', 8], ['nonprofit', 9], ['non-profit', 9], ['ngo', 8], ['foundation', 5], ['volunteer', 6], ['volunteers', 6], ['donate', 6], ['donations', 6], ['fundrais', 7], ['community group', 7], ['church', 6], ['mosque', 6], ['ministry', 4], ['association', 4], ['club', 2]] },
  { id: 'travel', label: 'Travel & Tours', archetype: 'travel', schema: 'TravelAgency', kw: [['travel agency', 9], ['tour operator', 9], ['tours', 6], ['tour', 4], ['travel', 5], ['safari', 6], ['excursions', 6], ['day trips', 6], ['guided tours', 8], ['nile cruise', 7], ['holiday', 4], ['vacation', 4], ['adventure', 3]] },
  { id: 'portfolio', label: 'Personal Portfolio', archetype: 'personal', schema: 'Person', kw: [['portfolio', 7], ['freelance', 6], ['freelancer', 7], ['my work', 4], ['personal site', 7], ['personal website', 7], ['author', 5], ['writer', 5], ['speaker', 5], ['resume', 5], ['cv', 3], ['developer portfolio', 8], ['artist', 5], ['painter', 4], ['sculptor', 5]] },
];

const NX_GENERAL = { id: 'general', label: 'Business', archetype: 'professional', schema: 'LocalBusiness', kw: [] };

// How to refer to the business in a sentence ("a plumbing company", "an online store").
const NX_NOUN = { florist: 'florist', bakery: 'bakery', cafe: 'café', restaurant: 'restaurant', bar: 'bar', hotel: 'hotel', catering: 'catering company', dental: 'dental clinic', medical: 'medical clinic', physio: 'physiotherapy clinic', vet: 'veterinary practice', pharmacy: 'pharmacy', therapy: 'therapy practice', plumbing: 'plumbing company', electrician: 'electrical contractor', hvac: 'heating and cooling company', roofing: 'roofing company', construction: 'construction and remodeling company', landscaping: 'landscaping company', cleaning: 'cleaning company', pest: 'pest control company', moving: 'removals company', auto: 'auto repair shop', security: 'security and locksmith service', salon: 'hair salon', barber: 'barbershop', spa: 'spa and beauty salon', tattoo: 'tattoo studio', fitness: 'fitness studio', yoga: 'yoga studio', nutrition: 'nutrition practice', photography: 'photography studio', design: 'design studio', marketing: 'marketing agency', architecture: 'architecture and interiors practice', music: 'music act', games: 'game studio', events: 'events company', law: 'law firm', accounting: 'accounting practice', consulting: 'consultancy', finance: 'financial services firm', realestate: 'real estate agency', saas: 'software product', itservices: 'IT services company', ecommerce: 'online store', grocery: 'food shop', school: 'school', nonprofit: 'non-profit', travel: 'travel company', portfolio: 'personal portfolio', general: 'business' };
function nxIndustryNoun(id, withArticle) { const n = NX_NOUN[id] || 'business'; if (!withArticle) return n; return (/^[aeiou]/i.test(n) ? 'an ' : 'a ') + n; }

// Arabic brief support (the product is used in Egypt): a compact lexicon so an
// Arabic description still lands in the right industry. Copy stays English-first.
const NX_KW_AR = { restaurant: ['مطعم', 'مأكولات', 'أكل', 'وجبات', 'مشويات', 'بيتزا'], cafe: ['كافيه', 'قهوة', 'كوفي', 'مقهى'], bakery: ['مخبز', 'حلويات', 'كيك', 'معجنات'], dental: ['أسنان', 'اسنان', 'تقويم', 'زراعة الأسنان'], medical: ['عيادة', 'طبيب', 'دكتور', 'مستشفى', 'طبية'], pharmacy: ['صيدلية'], plumbing: ['سباكة', 'سباك', 'مواسير'], electrician: ['كهرباء', 'كهربائي'], hvac: ['تكييف', 'تكييفات', 'تبريد'], cleaning: ['تنظيف', 'نظافة'], salon: ['صالون', 'كوافير', 'شعر'], spa: ['تجميل', 'سبا', 'بشرة', 'مساج'], law: ['محاماة', 'محامي', 'محامى', 'قانونية', 'استشارات قانونية'], accounting: ['محاسبة', 'محاسب', 'ضرائب'], realestate: ['عقارات', 'عقار', 'شقق', 'تمليك'], school: ['مدرسة', 'دروس', 'تعليم', 'أكاديمية', 'حضانة', 'كورسات'], hotel: ['فندق', 'شاليه', 'إقامة'], florist: ['ورد', 'زهور', 'باقات'], fitness: ['جيم', 'لياقة', 'تدريب', 'رياضة'], auto: ['سيارات', 'ميكانيكي', 'كاوتش', 'صيانة سيارات'], travel: ['سياحة', 'رحلات', 'سفر'], photography: ['تصوير', 'مصور', 'فوتوغرافي'], ecommerce: ['متجر', 'اونلاين', 'أونلاين', 'ملابس', 'إكسسوارات'], construction: ['مقاولات', 'تشطيبات', 'بناء', 'ديكور'], itservices: ['برمجة', 'مواقع', 'تطبيقات', 'تقنية'], marketing: ['تسويق', 'إعلانات', 'سوشيال ميديا'], events: ['أفراح', 'حفلات', 'مناسبات', 'تنظيم حفلات'], vet: ['بيطري', 'حيوانات أليفة'], grocery: ['سوبر ماركت', 'بقالة', 'جزارة', 'خضار'], nonprofit: ['جمعية', 'خيرية', 'تطوع'] };

const NX_ARCHETYPES = ['trade', 'clinic', 'hospitality', 'beauty', 'wellness', 'creative', 'professional', 'tech', 'retail', 'education', 'events', 'nonprofit', 'entertainment', 'personal', 'travel'];

// ── Lexicons for extraction ──────────────────────────────────────────────────
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'];
const NOT_PLACES = new Set(['the', 'a', 'an', 'our', 'your', 'their', 'my', 'this', 'that', 'need', 'order', 'stock', 'business', 'house', 'home', 'town', 'love', 'style', 'time', 'person', 'partnership', 'addition', 'general', 'particular', 'short', 'fact', 'all', 'every', 'most', 'both', 'one', 'two', 'three', 'english', 'arabic', 'french', 'spanish', 'german', 'italian', 'store', 'shop', 'person', 'touch', 'total', 'detail', 'demand', 'mind', 'case', 'town', 'summary', 'terms', 'line', 'progress', 'action', 'advance', 'writing', 'print', 'stock', 'person', 'return', 'exchange', 'october', 'november', 'december', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'spring', 'summer', 'autumn', 'fall', 'winter', 'weekends', 'evenings']);

const AUDIENCES = [
  'families', 'family', 'couples', 'kids', 'children', 'teens', 'teenagers', 'students', 'small businesses', 'small business owners', 'startups', 'founders', 'professionals', 'busy professionals', 'seniors', 'older adults', 'women', 'men', 'pets', 'dogs', 'cats', 'teams', 'enterprises', 'enterprise teams', 'homeowners', 'landlords', 'tenants', 'brides', 'newlyweds', 'tourists', 'visitors', 'locals', 'beginners', 'athletes', 'runners', 'patients', 'parents', 'new parents', 'expats', 'creators', 'developers', 'designers', 'agencies', 'restaurants', 'clinics', 'schools', 'nonprofits', 'gamers', 'players', 'readers', 'collectors', 'travelers', 'travellers', 'adults', 'employees', 'employers', 'businesses', 'companies', 'brands', 'retailers', 'weddings', 'events', 'offices', 'commercial clients', 'residential clients', 'first-time buyers', 'investors', 'freelancers', 'remote teams', 'e-commerce brands', 'ecommerce brands',
];

const TONE_MAP = {
  warm: ['cozy', 'cosy', 'warm', 'friendly', 'welcoming', 'homely', 'homey', 'family-run', 'family run', 'family-owned', 'family owned', 'neighbourhood', 'neighborhood', 'community', 'comforting', 'heartfelt', 'personal', 'down-to-earth', 'approachable', 'caring', 'gentle', 'kind'],
  refined: ['luxury', 'luxurious', 'premium', 'elegant', 'high-end', 'high end', 'bespoke', 'boutique', 'sophisticated', 'upscale', 'fine', 'exclusive', 'timeless', 'classic', 'artisan', 'artisanal', 'curated', 'refined', 'tailored', 'couture', 'exquisite', 'prestige'],
  bold: ['bold', 'edgy', 'loud', 'energetic', 'vibrant', 'punchy', 'daring', 'fearless', 'rebellious', 'street', 'urban', 'dynamic', 'high-energy', 'high energy', 'powerful', 'striking', 'unapologetic'],
  precise: ['professional', 'technical', 'modern', 'clean', 'minimal', 'minimalist', 'sleek', 'precise', 'corporate', 'reliable', 'efficient', 'data-driven', 'data driven', 'expert', 'rigorous', 'trusted', 'no-nonsense', 'straightforward', 'structured', 'engineered', 'enterprise'],
  calm: ['calm', 'natural', 'organic', 'eco', 'eco-friendly', 'sustainable', 'holistic', 'serene', 'peaceful', 'relaxing', 'soothing', 'mindful', 'earthy', 'botanical', 'green', 'slow', 'quiet', 'tranquil', 'wellness', 'restorative'],
  playful: ['playful', 'fun', 'quirky', 'whimsical', 'colorful', 'colourful', 'cheerful', 'joyful', 'cute', 'indie', 'creative', 'imaginative', 'lighthearted', 'light-hearted', 'witty', 'charming', 'delightful', 'kid-friendly', 'kid friendly'],
};

const DIFFERENTIATORS = [
  ['24/7', /\b24\s*\/\s*7\b|\b24 hours\b|\baround the clock\b/i, 'Available 24/7'],
  ['emergency', /\bemergenc(y|ies)\b/i, 'Emergency call-outs'],
  ['same-day', /\bsame[- ]day\b/i, 'Same-day service'],
  ['free-consultation', /\bfree (initial )?consultation\b|\bfree first (visit|session|consultation)\b/i, 'Free first consultation'],
  ['free-quote', /\bfree (quote|quotes|estimate|estimates)\b|\bno[- ]obligation quote\b/i, 'Free, no-obligation quotes'],
  ['free-delivery', /\bfree (local )?delivery\b|\bfree shipping\b/i, 'Free delivery'],
  ['delivery', /\b(we )?deliver(y|ies|s)?\b(?! (of|on) time)/i, 'Delivery available'],
  ['family-owned', /\bfamily[- ](owned|run|business)\b/i, 'Family-owned and run'],
  ['women-owned', /\bwomen[- ]owned\b|\bwoman[- ]owned\b|\bfemale[- ]owned\b/i, 'Women-owned'],
  ['award-winning', /\baward[- ]winning\b/i, 'Award-winning'],
  ['licensed', /\blicensed\b|\blicenced\b/i, 'Licensed'],
  ['insured', /\b(fully )?insured\b/i, 'Fully insured'],
  ['certified', /\bcertified\b|\baccredited\b|\bregistered\b(?! office)/i, 'Certified and accredited'],
  ['organic', /\borganic\b/i, 'Organic'],
  ['vegan', /\bvegan\b|\bplant[- ]based\b/i, 'Vegan options'],
  ['halal', /\bhalal\b/i, 'Halal'],
  ['gluten-free', /\bgluten[- ]free\b/i, 'Gluten-free options'],
  ['local-sourcing', /\blocally[- ]sourced\b|\blocal (produce|ingredients|suppliers|growers|farms)\b|\bseasonal\b/i, 'Locally sourced and seasonal'],
  ['handmade', /\bhand[- ]?made\b|\bhand[- ]?crafted\b|\bmade by hand\b/i, 'Handmade'],
  ['eco', /\beco[- ]friendly\b|\bsustainab/i, 'Eco-friendly'],
  ['bilingual', /\bbilingual\b|\b(english|arabic|french|spanish|german)[- ]speaking\b|\bspeak (english|arabic|french|spanish|german)\b/i, 'Multilingual team'],
  ['accessible', /\bwheelchair[- ]accessible\b|\bstep[- ]free\b/i, 'Wheelchair accessible'],
  ['parking', /\bfree parking\b|\bparking available\b/i, 'Free parking'],
  ['online-booking', /\bonline booking\b|\bbook online\b|\bbook(ing)? via (email|whatsapp|phone|instagram)\b/i, 'Easy online booking'],
  ['home-visits', /\bhome visits?\b|\bmobile service\b|\bwe come to you\b|\bat[- ]home\b/i, 'Home visits available'],
  ['warranty', /\bwarranty\b|\bguarantee(d)?\b/i, 'Work guaranteed'],
  ['payment-plans', /\bpayment plans?\b|\bfinance available\b|\binstal?lments?\b|\b0% finance\b/i, 'Payment plans available'],
  ['walk-ins', /\bwalk[- ]ins? (are )?welcome\b/i, 'Walk-ins welcome'],
  ['remote', /\bremote\b|\bonline sessions?\b|\bvia zoom\b|\bvideo (calls?|sessions?)\b/i, 'Remote sessions available'],
  ['multiplatform', /\b(pc|steam|switch|playstation|xbox|ios|android)\b(?:[,/ &]+(?:and )?\b(pc|steam|switch|playstation|xbox|ios|android)\b)+/i, 'Multi-platform'],
];

const CTA_INTENTS = [
  ['wishlist', /\bwishlist\b|\bsteam page\b|\bpre[- ]?order\b|\bcoming (soon|this|in|out)\b|\breleas(e|ing)\b|\blaunch(ing)?\b/i],
  ['book', /\bbook(ing|ings)?\b|\bappointment/i],
  ['reserve', /\breserv(e|ation|ations)\b|\btable\b/i],
  ['order', /\border (online|now|ahead)\b|\bdelivery\b|\btakeaway\b|\btakeout\b|\bpre[- ]?order\b/i],
  ['shop', /\bshop\b|\bbuy\b|\bonline store\b|\bpurchase\b|\bcheckout\b/i],
  ['quote', /\bquote|\bestimate\b/i],
  ['consult', /\bconsultation\b|\bconsult\b|\bcase\b|\badvice\b|\badvis(e|ing|ory)\b/i],
  ['enrol', /\benrol|\benroll|\bregister\b|\bregistration\b|\badmission|\bapply\b|\bsign[- ]?up\b/i],
  ['donate', /\bdonat(e|ion|ions)\b|\bgive\b|\bsupport our\b|\bvolunteer/i],
  ['subscribe', /\bsubscribe\b|\bnewsletter\b|\bmembership(s)?\b|\bbecome a member\b|\bjoin (us|the club|our community)\b/i],
  ['demo', /\bdemo\b|\bfree trial\b|\btry (it )?free\b|\bwaitlist\b|\bearly access\b/i],
  ['hire', /\bhire\b|\bavailable for\b|\bcommission/i],
  ['visit', /\bvisit us\b|\bcome (in|by|visit)\b|\bdrop (in|by)\b|\bopen (daily|every|mon|tue|wed|thu|fri|sat|sun)/i],
  ['call', /\bcall (us|now|today)\b|\bgive us a (call|ring)\b/i],
];

const VERB_LIST_LEADS = /\b(?:offering|offers?|we offer|providing|provides?|we provide|specialis(?:e|es|ing|z(?:e|es|ing))\s+in|(?:our\s+)?(?:services?|menu|treatments?|practice areas?|classes|programs?|programmes?|products?|packages?|sessions?|features?|areas? of (?:practice|expertise)|what we do)\s*(?:include|including|:|-|—)|we (?:do|handle|cover|make|sell|bake|serve|teach|treat|fix|repair|install|design|build|create|deliver|offer|provide)|help(?:ing|s)?\s+(?:[a-z][\w-]*\s+){0,4}with|(?:including|such as|like)|focus(?:ed|ing)? on|known for|famous for|expert(?:s)? in|everything from)\s*:?\s*([^.!?\n;]{4,240})/i;

const SERVICE_STOP = new Set(['things', 'stuff', 'it all', 'more', 'services', 'products', 'us', 'you', 'them', 'it', 'more', 'etc', 'others', 'all', 'everything', 'anything', 'the', 'a', 'an', 'and', 'or', 'we', 'our', 'your', 'in', 'at', 'on', 'for', 'to', 'of', 'with', 'from', 'by', 'so', 'much', 'many', 'some', 'any', 'each', 'every', 'here', 'there', 'now', 'today', 'soon', 'also', 'plus', 'only', 'just', 'both', 'over', 'under', 'around', 'since', 'until', 'while', 'very', 'really', 'quite', 'well', 'call', 'email', 'phone', 'whatsapp', 'website', 'instagram', 'facebook', 'open', 'closed', 'hours', 'prices', 'price', 'located', 'based', 'founded', 'owner', 'run', 'served', 'serving', 'serves', 'serve']);
const COMMON_VERBS = /\b(is|are|was|were|be|been|being|have|has|had|do|does|did|offer|offers|offering|provide|provides|providing|serve|serves|serving|need|needs|want|wants|love|loves|help|helps|helping|make|makes|making|run|runs|running|open|opens|opened|call|contact|email|book|visit|come|located|based|founded|specialise|specialize|specialising|specializing|deliver|delivers|delivering|bring|brings|create|creates|creating|build|builds|building|design|designs|designing|treat|treats|treating|teach|teaches|teaching|sell|sells|selling|work|works|working|launch|launching|launches|release|releasing|releases|focus|focuses|focusing|include|includes|including|cover|covers|covering|handle|handles|handling|take|takes|taking|give|gives|giving|get|gets|getting|use|uses|using|know|knows|believe|think|feel|welcome|welcomes|cater|caters|catering|repair|repairs|repairing|fix|fixes|fixing|install|installs|installing|clean|cleans|cleaning|bake|bakes|baking|cook|cooks|cooking|grow|grows|growing|source|sources|sourcing|accept|accepts|accepting|can|will|should|would|could|may|might|must)\b/i;

// ── Small utilities ──────────────────────────────────────────────────────────
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const titleCase = (s) => clean(s).replace(/(^|[\s\-/&(])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const sentenceCase = (s) => { const t = clean(s); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };
const uniq = (arr) => { const seen = new Set(); const out = []; for (const x of arr) { const k = String(x).toLowerCase(); if (!k || seen.has(k)) continue; seen.add(k); out.push(x); } return out; };
const hash = (s) => { let h = 2166136261; const t = String(s || ''); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function splitSentences(text) {
  return clean(text).split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])|\n+|\s+[•|]\s+/).map(clean).filter(Boolean);
}

function splitList(s) {
  // "X, Y and Z" / "X; Y; Z" / "X / Y" / "X • Y" / "X & Y" → items
  // thousands separators ("£2,400", "3,000 patients") are not list commas
  let t = clean(s).replace(/(\d),(?=\d{3}\b)/g, '$1\u0001').replace(/(\d)\s*\/\s*(month|week|year|hour|day|session|person|night|visit|class)\b/gi, '$1 per $2').replace(/\s*(?:,|;|•|·|\|)\s*(?:and|or|&|plus)\s+/gi, ', ').replace(/\s+(?:and|or|&|plus)\s+/gi, ', ').replace(/\s*[;•·|]\s*/g, ', ').replace(/\s+\/\s+/g, ', ');
  return t.split(/\s*,\s*/).map((x) => clean(x.replace(/\u0001/g, ','))).filter(Boolean);
}

function looksLikeService(item) {
  const t = clean(item).replace(/[.!?]+$/, '');
  if (!t || t.length < 3 || t.length > 48) return false;
  const words = t.split(' ');
  if (words.length > 6) return false;
  if (/^[\d,.]|\b(am|pm)\b|@|https?:|www\.|\$|£|€|\b(EGP|USD|GBP|EUR|AED|SAR|LE)\b|\d{4,}|\d[\d,]*\.\d/i.test(t)) return false;
  if (/\b(?:years?|yrs)\s+(?:of\s+)?experience\b|\bhappy\s+(?:clients|customers|patients)\b|\b(?:clients|customers|patients|reviews|projects)\s+served\b|\brated\b|\bstars?\b|\baward/i.test(t)) return false;
  if (/^(prices?|pricing|rates?|fees?|from|starting|open|opening|hours|call|email|phone|whatsapp|book|visit|contact|located|based|founded|since|rated|over|more than)\b/i.test(t)) return false;
  if (SERVICE_STOP.has(t.toLowerCase())) return false;
  if (words.length === 1 && /^(sessions?|classes|services?|treatments?|packages?|products?|options?|solutions?|months?|weeks?|years?|hours?|days?|prices?|rates?|areas?|more|team|staff|quality|experience|advice|support|help|care|work|jobs?)$/i.test(t)) return false;
  if (words.length === 1 && t.length < 3) return false;
  if (/^(we|our|your|the|a|an|to|for|in|at|on|with|by|from|so|and|or|but|if|when|where|which|that|this|it|is|are|was)\b/i.test(t) && words.length < 3) return false;
  return true;
}

function cleanServiceItem(item) {
  let t = clean(item).replace(/^[-–—•*\d.)\s]+/, '').replace(/[.!?:]+$/, '');
  // "teeth whitening from £299" / "day pass EGP 150" / "lessons £35 per hour"
  // → the service is the phrase; the price is extracted separately
  t = t.replace(/\s*(?:[-–—:(]\s*)?(?:from|starting (?:at|from)|only|just|at|for|is|are|costs?)?\s*(?:(?:\$|£|€|EGP|USD|GBP|EUR|AED|SAR|E£|LE)\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:EGP|USD|GBP|EUR|AED|SAR|LE|\$|£|€|pounds|dollars|euros))\b(?:\s*(?:\/|per)\s*\w+)?\)?\s*$/i, '');
  t = t.replace(/^(?:our\s+)?(?:services?|menu|treatments?|products?|classes|programs?|programmes?|packages?|practice areas?|what we do|we offer|we provide|we do|offering|including|includes?|such as|like)\s*[:\-—]?\s*/i, '');
  // strip trailing prepositional tails: "leak repair in Cairo" → "leak repair"; "for families" → drop
  t = t.replace(/\s+(?:in|across|around|throughout|near)\s+[A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3}$/, '');
  t = t.replace(/\s+(?:for|to)\s+(?:all|every|any|our|your|the|local)?\s*(?:[a-z][\w'-]*\s*){1,4}$/, (m) => (/\bfor (?:weddings|events|kids|children|babies|pets|dogs|cats|cars|homes|offices|businesses)$/i.test(m) ? m : ''));
  t = t.replace(/^(?:and|or|plus|also|even|our|the|a|an)\s+/i, '');
  t = t.replace(/^(?:everything from|from)\s+/i, '').replace(/\s+to\s+(?:full|complete|whole)\b.*$/i, '');
  return sentenceCase(t);
}

// ── Extractors ───────────────────────────────────────────────────────────────
function detectLanguage(text) {
  const t = String(text || '');
  const letters = (t.match(/[A-Za-z\u0600-\u06FF\u0590-\u05FF\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF]/g) || []).length || 1;
  const ar = (t.match(/[\u0600-\u06FF]/g) || []).length;
  const he = (t.match(/[\u0590-\u05FF]/g) || []).length;
  const cy = (t.match(/[\u0400-\u04FF]/g) || []).length;
  const cjk = (t.match(/[\u4E00-\u9FFF\u3040-\u30FF]/g) || []).length;
  if (ar / letters > 0.3) return { code: 'ar', dir: 'rtl', name: 'Arabic' };
  if (he / letters > 0.3) return { code: 'he', dir: 'rtl', name: 'Hebrew' };
  if (cy / letters > 0.3) return { code: 'ru', dir: 'ltr', name: 'Russian' };
  if (cjk / letters > 0.3) return { code: 'zh', dir: 'ltr', name: 'Chinese' };
  const low = ' ' + t.toLowerCase() + ' ';
  const score = (words) => words.reduce((n, w) => n + (low.split(' ' + w + ' ').length - 1), 0);
  const fr = score(['le', 'la', 'les', 'nous', 'et', 'une', 'des', 'pour', 'avec', 'dans', 'notre']);
  const es = score(['el', 'los', 'las', 'nosotros', 'y', 'una', 'para', 'con', 'nuestro', 'nuestra', 'somos']);
  const de = score(['der', 'die', 'das', 'wir', 'und', 'eine', 'für', 'mit', 'unser', 'unsere', 'sind']);
  const en = score(['the', 'and', 'we', 'our', 'for', 'with', 'in', 'a', 'of', 'to', 'is']);
  const best = Math.max(fr, es, de);
  if (best >= 3 && best > en) return fr === best ? { code: 'fr', dir: 'ltr', name: 'French' } : es === best ? { code: 'es', dir: 'ltr', name: 'Spanish' } : { code: 'de', dir: 'ltr', name: 'German' };
  return { code: 'en', dir: 'ltr', name: 'English' };
}

function scoreIndustries(name, desc) {
  const n = ' ' + String(name || '').toLowerCase().replace(/[^a-z0-9&'+/ -]/g, ' ') + ' ';
  const d = ' ' + String(desc || '').toLowerCase().replace(/[^a-z0-9&'+/ -]/g, ' ') + ' ';
  const scores = [];
  for (const ind of NX_TAXONOMY) {
    let s = 0; const hits = [];
    // Longest term first, and every match is blanked out so a stem never counts
    // the same word twice ("cater" + "catering" used to out-score "restaurant").
    let nn = n, dd = d;
    for (const [term, w] of ind.kw.slice().sort((a, b) => b[0].length - a[0].length)) {
      const re = new RegExp('(?<![a-z0-9])' + escRe(term) + (term.length <= 3 ? '(?![a-z0-9])' : '(?:s|es|ed|ing)?(?![a-z0-9])'), 'g');
      const inName = (nn.match(re) || []).length;
      const inDesc = (dd.match(re) || []).length;
      if (inName) { s += w * 1.6 * Math.min(inName, 2); hits.push(term); nn = nn.replace(re, ' '); }
      if (inDesc) { s += w * Math.min(inDesc, 3); if (!inName) hits.push(term); dd = dd.replace(re, ' '); }
    }
    if (s > 0) scores.push({ id: ind.id, label: ind.label, archetype: ind.archetype, schema: ind.schema, score: s, hits });
  }
  const raw = String(name || '') + ' ' + String(desc || '');
  if (/[\u0600-\u06FF]/.test(raw)) {
    for (const [id, terms] of Object.entries(NX_KW_AR)) {
      const hits = terms.filter((t) => raw.includes(t));
      if (!hits.length) continue;
      const ind = NX_TAXONOMY.find((i) => i.id === id);
      const s = hits.length * 6;
      const ex = scores.find((x) => x.id === id);
      if (ex) { ex.score += s; ex.hits.push(...hits); } else scores.push({ id: ind.id, label: ind.label, archetype: ind.archetype, schema: ind.schema, score: s, hits });
    }
  }
  scores.sort((a, b) => b.score - a.score);
  return scores;
}

function extractLocation(text) {
  const t = clean(text);
  const tok = '(?:St\\.|Ste\\.|Mt\\.|Ft\\.|[A-Z][\\w\'’-]*|(?:of|de|del|al|el|upon|on|the)(?![\\w]))';
  const place = '(' + tok + '(?:[ -]' + tok + '){0,3})(?:,\\s*([A-Z][\\w\'’-]*(?:\\s+[A-Z][\\w\'’-]*){0,2}|[A-Z]{2}))?';
  const pats = [
    new RegExp('\\b(?:based|located|situated|headquartered|nestled|found)\\s+in\\s+' + place, 'g'),
    new RegExp('\\b(?:serving|serves|covering|across|throughout|around)\\s+(?:the\\s+)?' + place, 'g'),
    new RegExp('\\b(?:in|near)\\s+(?:the\\s+heart\\s+of\\s+|downtown\\s+|central\\s+)?' + place, 'g'),
    new RegExp('\\b' + place + '[- ]based\\b', 'g'),
  ];
  const cands = [];
  pats.forEach((re, pi) => {
    let m;
    while ((m = re.exec(t))) {
      const p1 = clean((m[1] || '').replace(/[.,;:]+$/, ''));
      const p2 = clean((m[2] || '').replace(/[.,;:]+$/, ''));
      if (!p1) continue;
      const first = p1.split(/[ -]/)[0].toLowerCase();
      if (NOT_PLACES.has(first) || MONTHS.includes(first) || /^\d/.test(p1)) continue;
      if (p1.split(' ').every((w) => NOT_PLACES.has(w.toLowerCase()) || /^(of|the|on|upon|de|del|al|el)$/i.test(w))) continue;
      // "in October", "in 2015", "in Steam" style rejections
      if (/^(Steam|PC|Xbox|PlayStation|Nintendo|Switch|iOS|Android|English|Arabic|October|November|December|January|February|March|April|May|June|July|August|September)$/i.test(p1)) continue;
      const region = p2 && !NOT_PLACES.has(p2.toLowerCase()) && !MONTHS.includes(p2.toLowerCase()) ? p2 : '';
      cands.push({ city: p1, region, raw: region ? p1 + ', ' + region : p1, priority: pi, idx: m.index });
    }
  });
  if (!cands.length) return null;
  cands.sort((a, b) => a.priority - b.priority || a.idx - b.idx);
  const best = cands[0];
  const service = uniq(cands.filter((c) => c.priority === 1 && c.raw !== best.raw).map((c) => c.raw)).slice(0, 4);
  return { city: best.city, region: best.region, raw: best.raw, serviceArea: service, evidence: best.raw };
}

function extractContact(text) {
  const t = String(text || '');
  const out = { phone: '', whatsapp: '', email: '', website: '', instagram: '', facebook: '', hours: [], address: '' };
  const email = t.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  if (email) out.email = email[0];
  const url = t.match(/\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+|\b[a-z0-9-]+\.(?:com|net|org|io|co|uk|eg|ae|sa|de|fr|es|it|nl|ca|au|app|dev|me|studio|shop|store)(?:\.[a-z]{2})?\b(?!@)/i);
  if (url && !(email && email[0].includes(url[0]))) out.website = url[0];
  const tNoMail = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ').replace(/\bhttps?:\/\/[^\s)]+/g, ' ');
  const ig = tNoMail.match(/(?:instagram\.com\/|insta(?:gram)?\s*[:@]\s*|@)([A-Za-z0-9_]{3,30}(?:\.[A-Za-z0-9_]{1,30})*)(?![\w.]*\.(?:com|net|org|io|co|uk|eg))/i);
  if (ig) out.instagram = ig[1];
  const fb = t.match(/facebook\.com\/([A-Za-z0-9_.]{3,40})/i);
  if (fb) out.facebook = fb[1];
  // phones: sequences with 7–15 digits, allowing spaces/dashes/dots/parentheses, optional +
  const phoneRe = /(?:\+|00)?\(?\d{1,4}\)?(?:[\s.-]?\(?\d{1,5}\)?){2,6}/g;
  let m; const phones = [];
  while ((m = phoneRe.exec(t))) {
    const raw = m[0].trim();
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) continue;
    if (/^(19|20)\d{2}$/.test(digits)) continue;
    if (/\d{4}\s*[-–]\s*\d{4}/.test(raw) && digits.length === 8) continue; // year ranges / hours
    if (/^\d{1,2}[.:]\d{2}$/.test(raw)) continue;
    const before = t.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
    // "WhatsApp +44…" labels the number that FOLLOWS; "0100… (WhatsApp)"
    // labels the number that PRECEDES. A "WhatsApp" further along the
    // sentence belongs to the next number, never to this one.
    const after = t.slice(m.index + raw.length, m.index + raw.length + 24);
    phones.push({ raw, digits, wa: /whatsapp|wa\b|wa:|whats app/.test(before) || /^\s*[(\[]?\s*(?:on\s+|via\s+)?whatsapp/i.test(after) });
  }
  const wa = phones.find((p) => p.wa);
  const other = phones.find((p) => !p.wa) || phones[0];
  if (wa) out.whatsapp = wa.raw;
  if (other) out.phone = other.raw;
  if (!out.phone && out.whatsapp) out.phone = out.whatsapp;
  // hours
  const hoursRe = /\b(?:open(?:ing hours)?|hours|we(?:'re| are) open|opening times)\s*:?\s*([^.;\n]{4,90})/gi;
  while ((m = hoursRe.exec(t))) {
    const h = clean(m[1]).replace(/[,.]+$/, '');
    if (/\d|daily|weekday|weekend|mon|tue|wed|thu|fri|sat|sun|noon|midnight|24/i.test(h)) out.hours.push(h);
  }
  const dayRange = t.match(/\b((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*(?:to|-|–|through|thru)\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?[^.;\n]{0,50}?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|-|–|until|till)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (dayRange && !out.hours.some((h) => h.includes(dayRange[1]))) out.hours.push(clean(dayRange[1]));
  if (/\b24\s*\/\s*7\b/.test(t) && !out.hours.length) out.hours.push('Open 24/7');
  out.hours = uniq(out.hours).slice(0, 4);
  // street address: number + street word
  const addr = t.match(/\b\d{1,5}[A-Za-z]?\s+(?:[A-Z][\w'.-]*\s+){0,3}(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Way|Square|Sq\.?|Place|Pl\.?|Court|Ct\.?|Crescent|Terrace|Parade|Row|Corniche|Highway|Hwy\.?|Close|Gardens|Walk|Mall|Plaza|Market|Tower|Building)\b[^.;\n]{0,60}/);
  if (addr) out.address = clean(addr[0]).replace(/[,.\s]+$/, '');
  return out;
}

function extractPeople(text) {
  const t = clean(text);
  const out = [];
  const nameP = '((?:Dr\\.?|Dr|Chef|Coach|Mr\\.?|Mrs\\.?|Ms\\.?|Prof\\.?)?\\s*[A-Z][a-z\'’-]+(?:\\s+(?:[A-Z][a-z\'’-]+|[A-Z]\\.|van|von|de|del|bin|al|el|ibn)){0,3})';
  const pats = [
    [new RegExp('\\b(?:[Ff]ounded|[Ss]tarted|[Ee]stablished|[Oo]pened|[Ll]aunched|[Cc]reated|[Bb]uilt)\\s+(?:in\\s+\\d{4}\\s+)?by\\s+' + nameP, 'g'), 'Founder'],
    [new RegExp('\\b(?:[Oo]wned|[Rr]un|[Ll]ed|[Mm]anaged|[Oo]perated)\\s+by\\s+' + nameP, 'g'), 'Owner'],
    [new RegExp('\\b(?:[Oo]wner|[Ff]ounder|[Cc]o-founder|[Dd]irector|[Pp]rincipal|[Hh]ead [Cc]hef|[Cc]hef|[Ll]ead (?:designer|developer|stylist|trainer|instructor|photographer)|[Pp]hotographer|[Ss]tylist|[Tt]rainer|[Ii]nstructor|[Tt]herapist|[Dd]entist|[Dd]octor|[Ss]olicitor|[Ll]awyer|[Aa]ttorney|[Dd]esigner|[Dd]eveloper|[Bb]aker)\\s*[:,]?\\s+(?:is\\s+)?' + nameP, 'g'), null],
    [new RegExp('\\b' + nameP + '\\s+(?:and (?:his|her|their) team|has been|is (?:a|an|the|our)|founded|started|runs|owns|leads)\\b', 'g'), 'Founder'],
    [new RegExp('\\b(?:I(?:\'m| am)|my name is|this is)\\s+' + nameP + '\\b', 'g'), 'Owner'],
  ];
  for (const [re, role] of pats) {
    let m;
    while ((m = re.exec(t))) {
      const name = clean(m[1]);
      const first = name.split(' ')[0];
      if (!name || /^(We|Our|The|This|That|It|Its|Every|Each|All|Your|You|They|He|She|Since|From|Based|Located|In|At|On|For|With|Serving|Open|Call|Email|Book|Visit|Offering|Providing|Specialising|Specializing|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Steam|Google|Instagram|Facebook|WhatsApp)$/i.test(first)) continue;
      if (name.split(' ').length > 4) continue;
      const roleWord = role || titleCase((m[0].match(/^(owner|founder|co-founder|director|principal|head chef|chef|lead [a-z]+|photographer|stylist|trainer|instructor|therapist|dentist|doctor|solicitor|lawyer|attorney|designer|developer|baker)/i) || ['Founder'])[0]);
      const withTitle = /^(Dr\.?|Chef|Coach|Prof\.?)\s/i.test(name);
      out.push({ name, role: withTitle && roleWord === 'Founder' ? (name.split(' ')[0].replace('.', '') === 'Dr' ? 'Lead clinician' : roleWord) : roleWord, evidence: m[0] });
    }
  }
  return uniq(out.map((p) => p.name)).map((n) => out.find((p) => p.name === n)).slice(0, 3);
}

function extractTime(text) {
  const t = String(text || '');
  const out = { founded: 0, yearsExperience: 0, evidence: '' };
  const y = t.match(/\b(?:since|est\.?|established|founded|opened|started|running since|serving since|in business since|trading since)\s*(?:in\s+)?((?:19|20)\d{2})\b/i);
  if (y) { out.founded = Number(y[1]); out.evidence = y[0]; }
  const y2 = !out.founded && t.match(/\b(?:founded|established|opened|started)\s+(?:the\s+\w+\s+)?(?:by\s+[A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+)?\s+)?in\s+((?:19|20)\d{2})\b/i);
  if (y2) { out.founded = Number(y2[1]); out.evidence = y2[0]; }
  const yrs = t.match(/\b(?:over|more than|nearly|almost|about|around)?\s*(\d{1,2})\+?\s*(?:years?|yrs)(?:['’]|\s+of)?\s*(?:experience|in business|in the trade|of service|serving|behind|expertise|in the industry)/i);
  if (yrs) { out.yearsExperience = Number(yrs[1]); if (!out.evidence) out.evidence = yrs[0]; }
  const now = new Date().getFullYear();
  if (out.founded && !out.yearsExperience && now - out.founded >= 1 && now - out.founded < 150) out.yearsExperience = now - out.founded;
  return out;
}

function extractAudience(text) {
  const t = ' ' + clean(text).toLowerCase() + ' ';
  const found = [];
  for (const a of AUDIENCES) {
    const re = new RegExp('\\b(?:for|to|with|helping|serving|serve|welcome|welcomes|aimed at|designed for|made for|built for|tailored to|perfect for|ideal for)\\s+(?:busy\\s+|local\\s+|growing\\s+|small\\s+|new\\s+|young\\s+|modern\\s+)?' + escRe(a) + '\\b');
    if (re.test(t)) found.push(a);
  }
  // bare mentions of strong audience nouns
  for (const a of ['families', 'couples', 'small businesses', 'startups', 'students', 'patients', 'homeowners', 'landlords', 'brides', 'gamers', 'players', 'seniors', 'professionals', 'developers', 'teams', 'businesses', 'tourists', 'parents']) {
    if (!found.includes(a) && new RegExp('\\b' + escRe(a) + '\\b').test(t)) found.push(a);
  }
  const u = uniq(found);
  return u.filter((a) => !u.some((b) => b !== a && b.includes(a))).slice(0, 4);
}

function extractTone(text) {
  const t = ' ' + clean(text).toLowerCase() + ' ';
  const scores = {}; const words = [];
  for (const [axis, list] of Object.entries(TONE_MAP)) {
    for (const w of list) {
      const re = new RegExp('(?<![a-z-])' + escRe(w) + '(?![a-z])');
      if (re.test(t)) { scores[axis] = (scores[axis] || 0) + (w.length > 6 ? 2 : 1); words.push(w); }
    }
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  return { words: uniq(words).slice(0, 8), axes: ranked, scores, primary: ranked[0] || '', secondary: ranked[1] || '' };
}

function extractServices(text, industryId) {
  const items = [];
  const sentences = splitSentences(text);
  const push = (arr, source) => { for (const it of arr) { const c = cleanServiceItem(it); if (looksLikeService(c)) items.push({ title: c, source }); } };
  // 1. explicit list leads: "offering X, Y and Z" / "services include" / "we do"
  for (const s of sentences) {
    const m = s.match(VERB_LIST_LEADS);
    if (m) {
      let tail = m[1];
      // cut at the next clause that is clearly not part of the list
      tail = tail.split(/\s+(?:for|to|in|at|across|since|with|because|so that|which|where|that|while|using|through|via)\s+(?=[a-z])/)[0];
      const parts = splitList(tail);
      if (parts.length >= 2) push(parts, 'list');
      else if (parts.length === 1 && parts[0].split(' ').length >= 2 && parts[0].split(' ').length <= 5) push(parts, 'lead');
    }
  }
  // 1b. colon-introduced lists: "Dental clinic in Leeds: whitening, implants, …"
  for (const s of sentences) {
    const m = s.match(/^([^:]{3,80}):\s*([^!?\n]{8,400}?)[.!?]*$/);
    // the lead must describe the business, not hours/contact/prices/notes
    if (m && !VERB_LIST_LEADS.test(s) && !/\b(?:hours?|open(?:ing)?|times?|call|phone|tel|whatsapp|email|contact|address|prices?|pricing|rates?|fees?|note|nb|ps|update|warning|closed|holidays?|dates?|when|where)\b/i.test(m[1]) && !/\b(?:am|pm)\b|\d\s*[-–]\s*\d/.test(m[2])) {
      const parts = splitList(m[2].replace(/[.!?]+$/, ''));
      if (parts.length >= 2 && parts.length <= 12 && parts.every((p) => p.split(' ').length <= 7)) push(parts, 'list');
    }
  }
  // 2. semicolon lists anywhere
  if (/;/.test(text)) {
    const parts = String(text).split(';').map(clean).filter(Boolean);
    if (parts.length >= 2 && parts.length <= 8 && parts.every((p) => p.length < 60)) push(parts, 'semicolon');
  }
  // 3. verbless noun-phrase sentences: "Drain cleaning, water heater installation, leak repair."
  for (const s of sentences) {
    const core = s.replace(/[.!?]+$/, '');
    if ((core.match(/,/g) || []).length >= 1 && !COMMON_VERBS.test(core) && core.split(' ').length <= 40) {
      const parts = splitList(core);
      if (parts.length >= 3 && parts.length <= 12 && parts.every((p) => p.split(' ').length <= 6)) push(parts, 'nounlist');
    }
  }
  // 4. newline / bullet lists
  const lines = String(text || '').split(/\n/).map(clean).filter(Boolean);
  if (lines.length >= 3) {
    const bullets = lines.filter((l) => /^[-–—•*]\s*|^\d+[.)]\s*/.test(l)).map((l) => l.replace(/^[-–—•*]\s*|^\d+[.)]\s*/, ''));
    if (bullets.length >= 2) push(bullets, 'bullets');
  }
  // 5. "X for Y" style service phrases with industry nouns ("wedding flowers", "emergency repairs")
  const svcNoun = /\b((?:[a-z][\w'-]*\s+){0,2}(?:repairs?|installations?|cleaning|design|designs|consultations?|treatments?|sessions?|classes|lessons|courses|workshops|packages|catering|deliveries|delivery|maintenance|inspections?|surveys?|coaching|therapy|training|photography|arrangements|bouquets|subscriptions?|events|weddings|portraits|headshots|whitening|implants|check-?ups|fillings|braces|aligners|tours|excursions|rentals|removals|storage|detailing|servicing|tuning|grooming|boarding|vaccinations|check-ups))\b/gi;
  let m; const nounHits = [];
  while ((m = svcNoun.exec(String(text || '')))) { const c = cleanServiceItem(m[1]); if (looksLikeService(c) && c.split(' ').length <= 4 && !/^(our|the|and|with|for|all|any|your|a|an|of|in|on|at)\s/i.test(c) && !SERVICE_STOP.has(c.split(' ')[0].toLowerCase())) nounHits.push(c); }
  if (!items.length && nounHits.length) push(uniq(nounHits).slice(0, 6), 'noun');
  // rank: list/semicolon/bullets first, then noun hits; dedupe by lowercase; drop items that are just the industry word
  const order = { list: 0, semicolon: 0, bullets: 0, nounlist: 1, lead: 2, noun: 3 };
  items.sort((a, b) => order[a.source] - order[b.source]);
  const seen = new Set(); const out = [];
  for (const it of items) {
    const k = it.title.toLowerCase().replace(/s$/, '');
    if (seen.has(k)) continue;
    if (industryId && k === industryId) continue;
    // reject items that contain each other ("weddings" vs "wedding flowers") — keep the more specific
    if (out.some((o) => o.title.toLowerCase().includes(k) || k.includes(o.title.toLowerCase()))) continue;
    seen.add(k); out.push(it);
    if (out.length >= 8) break;
  }
  return out;
}

function extractProducts(text) {
  const t = clean(text);
  const out = [];
  const quoted = t.match(/["“']([A-Z][^"”']{2,40})["”']/g) || [];
  for (const q of quoted) out.push({ name: q.replace(/^["“']|["”']$/g, ''), kind: 'named', evidence: q });
  const called = t.match(/\b(?:called|titled|named|introducing|our (?:new|first|debut|flagship|latest) (?:game|product|album|app|book|collection|course|range|line|menu|service)|the game|our game)\s*[,:]?\s*["“']?([A-Z][\w'’]*(?:\s+[A-Z][\w'’]*){0,4})["”']?/g) || [];
  for (const c of called) { const n = c.replace(/^[^"“']*?(?:called|titled|named|introducing|our (?:new|first|debut|flagship|latest) [a-z]+|the game|our game)\s*[,:]?\s*["“']?/i, '').replace(/["”']$/, ''); if (n && !out.some((o) => o.name === n)) out.push({ name: clean(n), kind: 'named', evidence: c }); }
  let launch = '';
  const when = t.match(/\b(?:launch(?:ing|es)?|releas(?:e|ing|es)|coming|out|available|opening|opens|drops?)\s+(?:on|in|this|next|early|late|mid[- ])?\s*((?:January|February|March|April|May|June|July|August|September|October|November|December|spring|summer|autumn|fall|winter|Q[1-4])(?:\s+\d{4})?|\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{4})?)/i);
  if (when) launch = clean(when[1]);
  const platforms = uniq((t.match(/\b(PC|Steam|Nintendo Switch|Switch|PlayStation ?5?|PS5|Xbox|iOS|Android|Mac|Linux|itch\.io|Epic Games)\b/gi) || []).map((p) => p.replace(/\s+/g, ' ')));
  return { items: out.slice(0, 4), launch, platforms };
}

function extractPrices(text) {
  const t = String(text || '');
  const out = [];
  const re = /\b(?:from|starting (?:at|from)|prices? (?:from|start(?:ing)? at)|only|just|as low as)?\s*((?:\$|£|€|EGP|USD|GBP|EUR|AED|SAR|E£|LE)\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:EGP|USD|GBP|EUR|AED|SAR|LE|\$|£|€|pounds|dollars|euros))\b(?:\s*(?:\/|per)\s*(\w+))?/gi;
  let m;
  while ((m = re.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
    // the thing being priced is the noun phrase just before the price in the
    // same clause: "dental implants £1,950" / "deep clean from £120"
    const clause = t.slice(0, m.index).split(/[.;:\n,]|\band\b|\bor\b|\(|—|–/).pop() || '';
    const label = clean(clause.replace(/\b(?:from|starting (?:at|from)|prices? (?:from|start(?:ing)? at)|only|just|as low as|costs?|is|are|at|for)\s*$/i, '')).replace(/^(?:our|the|a|an)\s+/i, '');
    const words = label.split(' ');
    out.push({ amount: clean(m[1]), per: m[2] || '', from: /from|start|low as/.test(before) || /\b(?:from|starting|low as)\b/i.test(m[0]), evidence: clean(m[0]), label: words.length >= 1 && words.length <= 5 && /^[A-Za-z][\w'&-]*(?:\s[\w'&-]+)*$/.test(label) && !/^(?:call|phone|email|open|hours|visit|book|price|prices|pricing|rates|fees|cost)$/i.test(label) ? label : '' });
  }
  return out.slice(0, 6);
}

function extractSocialProof(text) {
  const t = String(text || '');
  const out = [];
  let m;
  const re = /\b(\d[\d,.]*\s*\+?|\d+k\+?)\s*(?:\+\s*)?(happy\s+)?(clients|customers|patients|students|members|projects|weddings|events|homes|installs|installations|reviews|five[- ]star reviews|5[- ]star reviews|downloads|players|users|followers|subscribers|graduates|cases)\b/gi;
  while ((m = re.exec(t))) out.push({ value: clean(m[1]).replace(/\s/g, ''), label: titleCase(m[3]), evidence: clean(m[0]) });
  const rated = t.match(/\b(?:rated|rating(?: of)?)\s*(\d(?:\.\d)?)\s*(?:\/\s*5|stars?|out of 5)?(?:\s*on\s*(Google|Trustpilot|Yelp|Facebook|Tripadvisor|Steam))?/i);
  if (rated) out.push({ value: rated[1] + (rated[0].includes('/') || /out of/i.test(rated[0]) ? '/5' : '★'), label: rated[2] ? 'Rated on ' + rated[2] : 'Average rating', evidence: rated[0] });
  const stars = t.match(/\b(\d(?:\.\d)?)[- ]star\b/i);
  if (stars && !rated) out.push({ value: stars[1] + '★', label: 'Rating', evidence: stars[0] });
  const awards = t.match(/\b(?:won|winner of|awarded|voted)\s+([^.;,\n]{4,60})/i);
  if (awards) out.push({ value: '', label: 'Award: ' + clean(awards[1]), evidence: awards[0] });
  return out.slice(0, 4);
}

function extractDifferentiators(text) {
  const out = [];
  for (const [id, re, label] of DIFFERENTIATORS) {
    const m = String(text || '').match(re);
    if (m) out.push({ id, label, evidence: m[0] });
  }
  return out.slice(0, 8);
}

function detectCtaIntent(text, industry, products) {
  const t = String(text || '');
  const hits = [];
  for (const [id, re] of CTA_INTENTS) if (re.test(t)) hits.push(id);
  const arche = industry.archetype;
  if (products && products.launch && (arche === 'entertainment' || hits.includes('wishlist'))) return { intent: 'wishlist', source: 'brief' };
  const byIndustry = { itservices: 'consult', hotel: 'book', florist: 'order', bakery: 'order', catering: 'quote', events: 'consult', photography: 'book', moving: 'quote', pharmacy: 'visit', grocery: 'visit', bar: 'reserve', music: 'hire', portfolio: 'hire', school: 'enrol', travel: 'book', realestate: 'consult', tattoo: 'book', security: 'quote' };
  const byArche = { trade: 'quote', clinic: 'book', hospitality: industry.id === 'hotel' ? 'book' : 'reserve', beauty: 'book', wellness: 'book', creative: 'hire', professional: 'consult', tech: 'demo', retail: industry.id === 'florist' ? 'order' : 'shop', education: 'enrol', events: 'consult', nonprofit: 'donate', entertainment: 'wishlist', personal: 'hire', travel: 'book' };
  // brief-stated intent wins when it is compatible with the archetype; otherwise archetype default
  const pref = ['book', 'reserve', 'order', 'shop', 'quote', 'consult', 'enrol', 'donate', 'demo', 'subscribe', 'wishlist', 'hire', 'visit', 'call'];
  for (const p of pref) if (hits.includes(p)) {
    if (p === 'shop' && ['clinic', 'trade', 'professional'].includes(arche)) continue;
    if (p === 'order' && ['clinic', 'professional', 'trade'].includes(arche)) continue;
    if (p === 'wishlist' && arche !== 'entertainment' && arche !== 'tech') continue;
    // "open Mon-Fri" is an opening-hours fact, not an invitation to drop in, unless
    // visitors really do walk through the door (shops, cafés, salons, clinics).
    if (p === 'visit' && !['hospitality', 'retail', 'beauty', 'wellness', 'clinic', 'education', 'entertainment'].includes(arche)) continue;
    return { intent: p, source: 'brief' };
  }
  return { intent: byIndustry[industry.id] || byArche[arche] || 'call', source: 'industry' };
}

function detectGoals(text) {
  const t = String(text || '').toLowerCase();
  const goals = [];
  if (/\b(bookings?|appointments?|reservations?)\b/.test(t)) goals.push('get bookings');
  if (/\b(leads?|enquir|inquir|quotes?)\b/.test(t)) goals.push('generate enquiries');
  if (/\b(sell|shop|store|orders?|e-?commerce|checkout)\b/.test(t)) goals.push('sell online');
  if (/\b(portfolio|showcase|show off|my work|our work|case studies)\b/.test(t)) goals.push('showcase work');
  if (/\b(wishlist|launch|release|coming soon|pre-?order)\b/.test(t)) goals.push('build launch buzz');
  if (/\b(donat|volunteer|fundrais|support us)\b/.test(t)) goals.push('drive donations');
  if (/\b(hire|hiring|careers|join (our|the) team)\b/.test(t)) goals.push('recruit');
  if (/\b(newsletter|subscribe|community|followers)\b/.test(t)) goals.push('grow an audience');
  if (/\b(inform|information|about us|credib|trust|reputation|brochure)\b/.test(t)) goals.push('build credibility');
  return uniq(goals).slice(0, 3);
}

// ── Personality: tone axes + industry defaults → one committed aesthetic ─────
const ARCHE_PERSONALITY = { trade: 'precise', clinic: 'calm', hospitality: 'warm', beauty: 'refined', wellness: 'calm', creative: 'bold', professional: 'precise', tech: 'precise', retail: 'warm', education: 'warm', events: 'refined', nonprofit: 'warm', entertainment: 'playful', personal: 'bold', travel: 'warm' };
const INDUSTRY_PERSONALITY = { florist: 'warm', bakery: 'warm', cafe: 'warm', bar: 'bold', hotel: 'refined', law: 'precise', accounting: 'precise', finance: 'precise', realestate: 'refined', games: 'playful', music: 'bold', tattoo: 'bold', barber: 'bold', spa: 'calm', yoga: 'calm', dental: 'calm', design: 'bold', architecture: 'refined', photography: 'refined', saas: 'precise', ecommerce: 'refined', school: 'warm', nonprofit: 'warm', travel: 'warm', portfolio: 'bold' };

function decidePersonality(tone, industry) {
  const fallback = INDUSTRY_PERSONALITY[industry.id] || ARCHE_PERSONALITY[industry.archetype] || 'precise';
  let axes = tone.axes.slice();
  // A tie between what the brief says and what the industry usually wants goes
  // to the industry ("cozy indie game studio": cozy=warm, indie=playful → playful).
  if (axes.length >= 2 && tone.scores && tone.scores[axes[0]] === tone.scores[axes[1]] && axes.includes(fallback)) axes = [fallback].concat(axes.filter((a) => a !== fallback));
  const primary = axes[0] || fallback;
  const secondary = axes[1] || (primary === fallback ? '' : fallback);
  return { primary, secondary, source: tone.primary ? 'brief' : 'industry' };
}

// ── Main entry ───────────────────────────────────────────────────────────────
function nxUnderstandBrief(input) {
  input = input || {};
  const name = clean(input.name || input.site_name || '').slice(0, 120);
  const description = String(input.description || input.brief || input.desc || '').slice(0, 4000);
  const instructions = String(input.instructions || '').slice(0, 1500);
  const text = description + (instructions ? '\n' + instructions : '');
  const plan = input.plan && typeof input.plan === 'object' ? input.plan : {};

  const language = detectLanguage(description || name);
  const ranked = scoreIndustries(name, text);
  const top = ranked[0];
  const total = ranked.slice(0, 3).reduce((n, r) => n + r.score, 0) || 1;
  const industry = top ? { id: top.id, label: top.label, archetype: top.archetype, schema: top.schema, confidence: Math.min(0.98, Math.round((top.score / total) * 100) / 100), evidence: top.hits.slice(0, 6), candidates: ranked.slice(1, 3).map((r) => ({ id: r.id, label: r.label })) }
    : { id: NX_GENERAL.id, label: NX_GENERAL.label, archetype: NX_GENERAL.archetype, schema: NX_GENERAL.schema, confidence: 0, evidence: [], candidates: [] };
  if (top && ranked[1] && ranked[1].score >= top.score * 0.85 && ranked[1].archetype !== top.archetype) industry.confidence = Math.min(industry.confidence, 0.55);

  const location = extractLocation(text) || (plan.contact && plan.contact.address ? { city: '', region: '', raw: '', serviceArea: [], evidence: '' } : null);
  const contact = extractContact(text);
  if (plan.contact && typeof plan.contact === 'object') {
    // Plan values are untrusted (scanner output, imported JSON): a contact field
    // is a contact field only if it looks like one — markup never rides along.
    const VALID = {
      email: (v) => /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(v) ? v : '',
      phone: (v) => { const d = v.replace(/[^\d+()\s.-]/g, ''); return d.replace(/\D/g, '').length >= 7 && d.replace(/\D/g, '').length <= 15 ? clean(d) : ''; },
      whatsapp: (v) => { const d = v.replace(/[^\d+()\s.-]/g, ''); return d.replace(/\D/g, '').length >= 7 && d.replace(/\D/g, '').length <= 15 ? clean(d) : ''; },
      website: (v) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/[^\s<>"']*)?$/.test(v) ? v : '',
      address: (v) => v.replace(/<[^>]*>?/g, ' ').replace(/[<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
    };
    for (const k of ['phone', 'email', 'address', 'whatsapp', 'website']) if (!contact[k] && plan.contact[k]) contact[k] = VALID[k](clean(plan.contact[k]));
  }
  // Structured hours from the plan (scan/AI/user form) are an explicit fact and
  // outrank anything inferred from prose — an instruction like "show the 24/7
  // number" must never replace real opening times. Text-derived hours are only
  // appended when they add information, deduplicated case-insensitively.
  if (Array.isArray(plan.working_hours) && plan.working_hours.length) {
    const fromPlan = plan.working_hours.map((h) => clean(String(h).replace(/<[^>]*>?/g, ' ')).replace(/[<>"]/g, ' ').trim().slice(0, 80)).filter(Boolean).slice(0, 4);
    if (fromPlan.length) {
      const seen = new Set(fromPlan.map((h) => h.toLowerCase().replace(/\s+/g, '')));
      const extra = contact.hours.filter((h) => !seen.has(h.toLowerCase().replace(/\s+/g, '')));
      contact.hours = fromPlan.concat(extra).slice(0, 4);
    }
  }
  const people = extractPeople(text);
  if (plan.ownerName && !people.length) people.push({ name: clean(plan.ownerName), role: 'Owner', evidence: 'plan.ownerName' });
  const time = extractTime(text);
  const audience = extractAudience(text);
  const tone = extractTone(text);
  const personality = decidePersonality(tone, industry);
  const products = extractProducts(text);
  const prices = extractPrices(text);
  const proof = extractSocialProof(text);
  const differentiators = extractDifferentiators(text);
  let services = extractServices(text, industry.id);
  if (Array.isArray(plan.services) && plan.services.length) {
    const fromPlan = plan.services.map((s) => (typeof s === 'string' ? { title: clean(s), desc: '' } : { title: clean(s.title || s.name), desc: clean(s.desc || s.text || ''), icon: s.icon })).filter((s) => s.title);
    if (fromPlan.length) services = fromPlan.map((s) => Object.assign({ source: 'plan' }, s));
  }
  // products that are actually the services list (e.g. quoted service names) — do not double count
  products.items = products.items.filter((p) => !services.some((s) => s.title.toLowerCase() === p.name.toLowerCase()));
  const cta = detectCtaIntent(text, industry, products);
  const goals = detectGoals(text);

  // Evidence ledger: every fact traceable to the user's words.
  const facts = [];
  if (name) facts.push({ key: 'name', value: name, source: 'name field' });
  if (top) facts.push({ key: 'industry', value: industry.label, source: 'keywords: ' + industry.evidence.join(', ') });
  if (location && location.raw) facts.push({ key: 'location', value: location.raw, source: location.evidence });
  for (const s of services) facts.push({ key: 'service', value: s.title, source: s.source });
  if (contact.phone) facts.push({ key: 'phone', value: contact.phone, source: 'brief' });
  if (contact.whatsapp) facts.push({ key: 'whatsapp', value: contact.whatsapp, source: 'brief' });
  if (contact.email) facts.push({ key: 'email', value: contact.email, source: 'brief' });
  if (contact.website) facts.push({ key: 'website', value: contact.website, source: 'brief' });
  if (contact.address) facts.push({ key: 'address', value: contact.address, source: 'brief' });
  for (const h of contact.hours) facts.push({ key: 'hours', value: h, source: 'brief' });
  for (const p of people) facts.push({ key: 'person', value: p.name + ' (' + p.role + ')', source: p.evidence });
  if (time.founded) facts.push({ key: 'founded', value: String(time.founded), source: time.evidence });
  if (time.yearsExperience) facts.push({ key: 'years', value: String(time.yearsExperience), source: time.evidence || 'derived from founding year' });
  for (const a of audience) facts.push({ key: 'audience', value: a, source: 'brief' });
  for (const p of products.items) facts.push({ key: 'product', value: p.name, source: p.evidence });
  if (products.launch) facts.push({ key: 'launch', value: products.launch, source: 'brief' });
  for (const p of prices) facts.push({ key: 'price', value: (p.from ? 'from ' : '') + p.amount + (p.per ? ' / ' + p.per : ''), source: p.evidence });
  for (const p of proof) facts.push({ key: 'proof', value: (p.value ? p.value + ' ' : '') + p.label, source: p.evidence });
  for (const d of differentiators) facts.push({ key: 'differentiator', value: d.label, source: d.evidence });

  const assumptions = [];
  if (!top) assumptions.push('No industry keywords found — using a general business structure.');
  else if (industry.confidence < 0.6) assumptions.push(`Treating this as a ${industry.label.toLowerCase()} (could also be ${industry.candidates.map((c) => c.label.toLowerCase()).join(' or ') || 'something else'}).`);
  if (!tone.primary) assumptions.push(`No tone given — using a ${personality.primary} feel that suits ${industry.label.toLowerCase()} sites.`);
  if (cta.source === 'industry') assumptions.push(`Main call to action set to "${cta.intent}" because that is what ${industry.label.toLowerCase()} visitors usually want.`);
  if (!services.length) assumptions.push('No services listed — the services section uses typical offerings for this kind of business, clearly marked for you to edit.');

  const missing = [];
  const localArche = ['trade', 'clinic', 'hospitality', 'beauty', 'wellness', 'retail', 'education', 'events', 'travel'].includes(industry.archetype);
  if (!services.length) missing.push({ id: 'services', question: 'What are your 3–6 main services or products?' });
  if (localArche && !(location && location.raw) && !contact.address) missing.push({ id: 'location', question: 'Where are you based, and what area do you serve?' });
  if (!contact.phone && !contact.email && !contact.whatsapp) missing.push({ id: 'contact', question: 'How should visitors reach you — phone, WhatsApp or email?' });
  if (['hospitality', 'clinic', 'beauty', 'retail'].includes(industry.archetype) && !contact.hours.length) missing.push({ id: 'hours', question: 'What are your opening hours?' });
  if (!tone.primary) missing.push({ id: 'tone', question: 'How should the site feel? (e.g. warm & friendly, premium & minimal, bold & playful)' });
  if (cta.source === 'industry') missing.push({ id: 'cta', question: 'What is the one action you want visitors to take? (book, call, get a quote, order…)' });
  if (!people.length && ['clinic', 'professional', 'personal', 'creative', 'wellness'].includes(industry.archetype)) missing.push({ id: 'people', question: 'Who is behind the business? A name and role makes the About section far more credible.' });

  // Coverage score: how much of what a great brief contains did we get?
  const have = [!!name, !!top, services.length > 0, !!(location && location.raw) || !localArche, !!(contact.phone || contact.email || contact.whatsapp), !!tone.primary, cta.source === 'brief', people.length > 0 || !!time.founded, audience.length > 0].filter(Boolean).length;
  const coverage = Math.round((have / 9) * 100);

  return {
    version: 2,
    name, description, language, industry, archetype: industry.archetype, personality,
    audience, tone, location, contact, people, founded: time.founded, yearsExperience: time.yearsExperience,
    services, products, prices, proof, differentiators, cta, goals,
    facts, assumptions, missing, coverage,
    seed: hash(name + '|' + industry.id),
  };
}

// "Here is what I understood" — plain English, like Durable's confirmation step.
function nxBriefSummary(b) {
  if (!b) return '';
  const parts = [];
  const where = b.location && b.location.raw ? ` in ${b.location.raw}` : '';
  parts.push(`${b.name || 'Your business'} is ${nxIndustryNoun(b.industry.id, true)}${where}.`);
  if (b.services.length) parts.push(`Main offerings: ${b.services.slice(0, 6).map((s) => s.title).join(', ')}.`);
  if (b.audience.length) parts.push(`Built for ${b.audience.slice(0, 3).join(', ')}.`);
  if (b.people.length) parts.push(`${b.people.map((p) => p.name + ' (' + p.role.toLowerCase() + ')').join(', ')}${b.founded ? ', since ' + b.founded : ''}.`);
  else if (b.founded) parts.push(`Established ${b.founded}.`);
  const ch = [b.contact.phone && 'phone', b.contact.whatsapp && 'WhatsApp', b.contact.email && 'email'].filter(Boolean);
  if (ch.length) parts.push(`Contact via ${ch.join(', ')}${b.contact.hours.length ? '; hours: ' + b.contact.hours[0] : ''}.`);
  if (b.products.items.length) parts.push(`Featured: ${b.products.items.map((p) => p.name).join(', ')}${b.products.launch ? ' (launching ' + b.products.launch + ')' : ''}.`);
  parts.push(`Feel: ${b.personality.primary}${b.personality.secondary ? ' with a ' + b.personality.secondary + ' edge' : ''}${b.tone.words.length ? ' (you said: ' + b.tone.words.slice(0, 4).join(', ') + ')' : ''}. Primary action: ${b.cta.intent}.`);
  if (b.differentiators.length) parts.push(`Highlights: ${b.differentiators.slice(0, 4).map((d) => d.label.toLowerCase()).join(', ')}.`);
  return parts.join(' ');
}

// Visitor-facing facts only (no builder meta such as tone or CTA intent) — this is
// what the generated site's assistant is allowed to know.
function nxBriefFacts(b) {
  if (!b) return '';
  const parts = [];
  const where = b.location && b.location.raw ? ` in ${b.location.raw}` : '';
  parts.push(`${b.name || 'The business'} is ${nxIndustryNoun(b.industry.id, true)}${where}.`);
  if (b.services.length) parts.push(`Services: ${b.services.slice(0, 8).map((s) => s.title).join(', ')}.`);
  if (b.audience.length) parts.push(`Built for ${b.audience.slice(0, 3).join(', ')}.`);
  if (b.people.length) parts.push(`${b.people.map((p) => p.name + ' (' + p.role.toLowerCase() + ')').join(', ')}${b.founded ? ', since ' + b.founded : ''}.`);
  else if (b.founded) parts.push(`Established ${b.founded}.`);
  if (b.yearsExperience) parts.push(`${b.yearsExperience} years of experience.`);
  if (b.contact.hours.length) parts.push(`Hours: ${b.contact.hours.join('; ')}.`);
  if (b.prices.length) parts.push(`Prices mentioned: ${b.prices.slice(0, 4).map((p) => (p.from ? 'from ' : '') + p.amount + (p.per ? ' per ' + p.per : '')).join(', ')}.`);
  if (b.differentiators.length) parts.push(`Also true: ${b.differentiators.slice(0, 6).map((d) => d.label.toLowerCase()).join(', ')}.`);
  if (b.proof.length) parts.push(`Proof: ${b.proof.map((p) => (p.value ? p.value + ' ' : '') + p.label).join(', ')}.`);
  if (b.products.items.length) parts.push(`Featured: ${b.products.items.map((p) => p.name).join(', ')}${b.products.launch ? ' (launching ' + b.products.launch + ')' : ''}.`);
  return parts.join('\n');
}

function nxBriefQuestions(b) { return b && Array.isArray(b.missing) ? b.missing.map((m) => m.question) : []; }

function nxIndustryById(id) { return NX_TAXONOMY.find((i) => i.id === id) || NX_GENERAL; }

module.exports = { nxUnderstandBrief, nxBriefSummary, nxBriefFacts, nxBriefQuestions, nxIndustryById, nxIndustryNoun, NX_TAXONOMY, NX_ARCHETYPES, NX_GENERAL, __internals: { extractServices, extractLocation, extractContact, extractPeople, extractTime, extractAudience, extractTone, extractProducts, extractPrices, extractSocialProof, extractDifferentiators, detectLanguage, scoreIndustries, splitList, titleCase, sentenceCase, hash } };
