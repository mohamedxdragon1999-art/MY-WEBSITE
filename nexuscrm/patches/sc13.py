#!/usr/bin/env python3
"""Batch A (cycles 1-12): design inheritance system, 5 new designs, theme overrides, fonts, favicon, lazy."""
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

# ── 1. Design registry v2: inheritance + extras (insert before SITE_DESIGNS) ──
rep("""const SITE_DESIGNS = {
  sentinel: {""",
"""// Extra per-design touches (composed onto the base design's CSS).
const DESIGN_EXTRAS = {
  ocean: `/* ocean: airy coastal blue */
:root{--bg:#f3f8fc;--bg2:#e8f1fa;--card:#ffffff;--line:#dbe7f3;--text:#0b1f33;--muted:#4c6a85;--accent:#0e7490;--accent2:#22d3ee;--teal:#0e7490;--amber:#f59e0b;--grad:linear-gradient(100deg,#0e7490,#22d3ee 55%,#5eead4);--radius:18px}
body::before{background:radial-gradient(50vw 50vw at 90% -10%,rgba(34,211,238,.12),transparent 60%),radial-gradient(45vw 45vw at 0% 105%,rgba(14,116,144,.08),transparent 60%)}
.nx-hero::before{background:radial-gradient(circle,rgba(34,211,238,.16),transparent 65%)}`,
  forest: `/* forest: deep green, premium */
:root{--bg:#0a120e;--bg2:#0f1a14;--card:#14221a;--line:#22382b;--text:#e7f2ea;--muted:#8fa89a;--accent:#34d399;--accent2:#a7f3d0;--teal:#34d399;--amber:#fbbf24;--grad:linear-gradient(100deg,#34d399,#a7f3d0 55%,#fbbf24);--radius:14px}
body::before{background:radial-gradient(55vw 55vw at 8% -5%,rgba(52,211,153,.10),transparent 60%),radial-gradient(50vw 50vw at 105% 108%,rgba(251,191,36,.06),transparent 60%)}
.nx-nav{background:rgba(10,18,14,.85)}`,
  rose: `/* rose: elegant light */
:root{--bg:#fdf7f8;--bg2:#fbeef1;--card:#ffffff;--line:#f0dde2;--text:#38121c;--muted:#8a5a68;--accent:#d6336c;--accent2:#f783ac;--teal:#d6336c;--amber:#e8a13a;--grad:linear-gradient(100deg,#d6336c,#f783ac 55%,#e8a13a);--radius:18px}
body::before{background:radial-gradient(50vw 50vw at 90% -10%,rgba(214,51,108,.10),transparent 60%),radial-gradient(45vw 45vw at 0% 105%,rgba(232,161,58,.08),transparent 60%)}
.nx-hero::before{background:radial-gradient(circle,rgba(214,51,108,.12),transparent 65%)}
.btn-primary{box-shadow:0 14px 30px -10px rgba(214,51,108,.45)}`,
  midnight: `/* midnight: deep violet, dramatic */
:root{--bg:#0d0a1a;--bg2:#141027;--card:#1b1533;--line:#2d2450;--text:#eae6ff;--muted:#a99fd0;--accent:#8b5cf6;--accent2:#c4b5fd;--teal:#a78bfa;--amber:#f0abfc;--grad:linear-gradient(100deg,#8b5cf6,#c4b5fd 55%,#f0abfc);--radius:16px}
body::before{background:radial-gradient(55vw 55vw at 8% -5%,rgba(139,92,246,.14),transparent 60%),radial-gradient(50vw 50vw at 105% 108%,rgba(192,132,252,.10),transparent 60%)}
.nx-nav{background:rgba(13,10,26,.85)}
.nx-hero::before{background:radial-gradient(circle,rgba(139,92,246,.18),transparent 65%)}`,
  ember: `/* ember: warm amber, inviting */
:root{--bg:#0d0b08;--bg2:#171310;--card:#201a14;--line:#3a2f24;--text:#f7efe4;--muted:#b39c80;--accent:#f59e0b;--accent2:#fbbf24;--teal:#f59e0b;--amber:#fcd34d;--grad:linear-gradient(100deg,#f59e0b,#fcd34d 55%,#f97316);--radius:16px}
body::before{background:radial-gradient(55vw 55vw at 8% -5%,rgba(245,158,11,.12),transparent 60%),radial-gradient(50vw 50vw at 105% 108%,rgba(249,115,22,.08),transparent 60%)}
.nx-nav{background:rgba(13,11,8,.85)}
.btn-primary{box-shadow:0 14px 34px -10px rgba(245,158,11,.5)}`,
  graphite: `/* graphite: monochrome minimal */
:root{--bg:#0f0f0f;--bg2:#171717;--card:#1d1d1d;--line:#2e2e2e;--text:#f2f2f2;--muted:#9a9a9a;--accent:#e5e5e5;--accent2:#a3a3a3;--teal:#e5e5e5;--amber:#d4d4d4;--grad:linear-gradient(100deg,#ffffff,#a3a3a3 55%,#ffffff);--radius:10px}
body::before{background:radial-gradient(55vw 55vw at 8% -5%,rgba(255,255,255,.05),transparent 60%)}
.btn-primary{background:linear-gradient(135deg,#ffffff,#c7c7c7);color:#0f0f0f;box-shadow:0 14px 30px -12px rgba(0,0,0,.7)}
.nx-marquee span::after{content:"◆";color:#a3a3a3}`,
};
// Theme overrides appended after any design's CSS (accent, font, radius, animation).
function themeOverridesCss(opts) {
  const parts = [];
  const accent = String(opts.accent || '').trim();
  const accent2 = String(opts.accent2 || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(accent)) {
    const a2 = /^#[0-9a-fA-F]{6}$/.test(accent2) ? accent2 : accent;
    parts.push(`:root{--accent:${accent};--accent2:${a2};--teal:${accent};--grad:linear-gradient(100deg,${accent},${a2} 55%,${a2})}`);
  }
  const radius = opts.radius;
  if (radius === 'sharp') parts.push(':root{--radius:8px}');
  if (radius === 'round') parts.push(':root{--radius:24px}');
  const font = String(opts.font || '').trim();
  const FONTS = {
    inter: ["'Inter'", 'Inter', 'sans-serif'],
    poppins: ["'Poppins'", 'Poppins', 'sans-serif'],
    playfair: ["'Playfair Display'", 'Playfair Display', 'Georgia, serif'],
    space: ["'Space Grotesk'", 'Space Grotesk', 'sans-serif'],
    dm: ["'DM Sans'", 'DM Sans', 'sans-serif'],
  };
  if (FONTS[font]) parts.push(`body{font-family:${FONTS[font][0]},${FONTS[font][1]},${FONTS[font][2]}}`);
  const anim = opts.animation_level;
  if (anim === 'subtle') parts.push('[data-reveal]{transform:translateY(14px);transition-duration:.45s}.nx-hero-img img{animation:none}.nx-marquee-track{animation-duration:40s}');
  if (anim === 'expressive') parts.push('[data-reveal]{transform:translateY(40px) scale(.985);transition-duration:.9s}.nx-hero-img img{animation-duration:5s}.nx-card:hover{transform:translateY(-10px) rotate(-.4deg)}.nx-marquee-track{animation-duration:18s}.nx-stat b{transition:transform .3s}.nx-stat:hover b{transform:scale(1.08)}');
  return parts.join('\\n');
}
function resolveDesignCss(designId, opts) {
  const d = SITE_DESIGNS[designId] || SITE_DESIGNS.sentinel;
  let css = d.css || '';
  const extra = DESIGN_EXTRAS[designId];
  if (extra) css += '\\n' + extra;
  css += '\\n' + themeOverridesCss(opts || {});
  return css;
}
// Favicon from an emoji (data URI, no external request).
function emojiFavicon(emoji) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${emoji}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
const SITE_DESIGNS = {
  sentinel: {""",
'design registry v2')

# ── 2. generateSiteHtml: use resolveDesignCss + fonts link + favicon + lazy + theme opts ──
rep("""  const w = await getWorkspace(env, ws);
  const design = SITE_DESIGNS[opts.design_id] || SITE_DESIGNS.sentinel;
  const name = String(opts.name || 'My Website').slice(0, 120);
  const plan = normalizePlan(opts.plan, name, String(opts.description || ''));
  const desc = String(opts.description || '').slice(0, 800);
  const instructions = String(opts.instructions || '').slice(0, 1500);""",
"""  const w = await getWorkspace(env, ws);
  const designId = SITE_DESIGNS[opts.design_id] ? opts.design_id : 'sentinel';
  const name = String(opts.name || 'My Website').slice(0, 120);
  const plan = normalizePlan(opts.plan, name, String(opts.description || ''));
  const desc = String(opts.description || '').slice(0, 800);
  const instructions = String(opts.instructions || '').slice(0, 1500);
  const themeOpts = {
    accent: opts.accent, accent2: opts.accent2, radius: opts.radius,
    font: opts.font, animation_level: opts.animation_level,
  };
  const sections = Array.isArray(opts.sections) && opts.sections.length ? opts.sections : null;
  const customCss = String(opts.custom_css || '').replace(/<\\/style>/gi, '').replace(/<script/gi, '').slice(0, 8000);""",
'generateSiteHtml theme opts')

rep("""  const webhookUrl = opts.webhook_url || '';
  const css = design.css;
  const js = SITE_JS.replace('__WEBHOOK_URL__', webhookUrl);""",
"""  const webhookUrl = opts.webhook_url || '';
  const css = resolveDesignCss(designId, themeOpts) + (customCss ? '\\n/* custom */\\n' + customCss : '');
  const js = SITE_JS.replace('__WEBHOOK_URL__', webhookUrl);
  // font loading (preconnect + stylesheet + swap), only when a font is chosen
  const FONT_URLS = { inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap', poppins: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;900&display=swap', playfair: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;800&family=Inter:wght@400;600&display=swap', space: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap', dm: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;900&display=swap' };
  const fontHtml = FONT_URLS[themeOpts.font] ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="${FONT_URLS[themeOpts.font]}" rel="stylesheet">` : '';""",
'fonts + css resolve')

rep("""  const ogTitle = escHtml(name);
  const metaDesc = escHtml(String((plan && plan.meta_desc) || desc || name)).slice(0, 200);""",
"""  const ogTitle = escHtml(name);
  const metaDesc = escHtml(String((plan && plan.meta_desc) || desc || name)).slice(0, 200);
  // section filter hint for the AI prompt
  const sectionList = sections ? sections.join(', ') : 'nav, hero, marquee, stats, services, why, about, process, parallax, gallery, reviews, lead, faq, contact, footer';""",
'section list')

# prompt: inject section list + new sections vocabulary
rep("""SECTIONS IN THIS EXACT ORDER: nav (brand = ${JSON.stringify(name)}, links), hero (.nx-hero with badge, h1 (use grad-text on a keyword), lead paragraph, two buttons .btn-primary + .btn-ghost, optional .nx-hero-img), marquee (5-6 items), stats (3-4 .nx-stat with b data-count), services (.nx-grid.g3 of .nx-card with emoji .ic, h3, p), why us (.nx-split with .nx-check bullets), about (.nx-split with text), process (.nx-steps of 4 .nx-step), parallax band (.nx-parallax with CTA), gallery (.nx-gallery with real image URLs), reviews (.nx-tstrip of .nx-review with .stars "★★★★★"), lead magnet (.nx-lead with h2/p/button), faq (3-5 .nx-faq-item), contact (.nx-contact-grid: .nx-cinfo with phone/email/address/working hours + .nx-form), footer.""",
"""INCLUDE ONLY THESE SECTIONS, IN THIS EXACT ORDER: ${sectionList}.
Section vocabulary:
- nav: .nx-nav > .container.nx-nav-inner (brand, .nx-menu-btn, .nx-nav-links with anchors)
- hero: .nx-hero with .nx-badge, h1 (use .grad-text on a keyword), p.lead, .nx-hero-actions (a.btn.btn-primary + a.btn.btn-ghost), optional .nx-hero-img img
- marquee: .nx-marquee > .nx-marquee-track > 5-6 spans
- stats: .nx-stats of 3-4 .nx-stat (b data-count + span)
- services: .nx-grid.g3 of .nx-card (div.ic emoji, h3, p)
- why: .nx-split with .nx-check bullets (b + text)
- about: .nx-split with h2 + paragraphs + optional img
- process: .nx-steps of 4 .nx-step (span.n + h3 + p)
- parallax: .nx-parallax with h2, p, a.btn.btn-primary
- gallery: .nx-gallery with real image URLs (add alt + loading="lazy")
- reviews: .nx-tstrip of .nx-review (.stars "★★★★★", p, .who)
- lead: .nx-lead with h2, p, a.btn.btn-primary
- faq: .nx-faq of 3-5 .nx-faq-item (.nx-faq-q + .nx-faq-a)
- pricing: .nx-grid.g3 of .nx-card pricing (h3 plan name, b price, ul features, a.btn.btn-primary "Choose") — mark the popular one with class "popular" style text
- team: .nx-grid.g2 of .nx-card (div.ic emoji avatar, h3 name, p role + bio)
- timeline: .nx-steps of milestones (span.n number, h3, p)
- logos: .nx-grid.g3 of .nx-card (h3 client name, p one-liner)
- newsletter: .nx-lead with form.nx-form containing only input name="email" + button (subscribe)
- video: .nx-parallax containing an iframe (youtube embed, loading="lazy", title="Video")
- map: .nx-split containing iframe (google maps embed from the address, loading="lazy", title="Map")
- contact: .nx-contact-grid (.nx-cinfo with phone/email/address/working hours + .nx-form with inputs name/email/phone/message)
- footer: .nx-footer""",
'prompt sections vocabulary')

# plan-based conditional sections: build a section list from plan data when not provided
rep("""  const sections = Array.isArray(opts.sections) && opts.sections.length ? opts.sections : null;""",
"""  const sections = Array.isArray(opts.sections) && opts.sections.length ? opts.sections : (() => {
    const auto = ['nav', 'hero', 'marquee', 'stats', 'services', 'why', 'about', 'process', 'parallax', 'reviews', 'lead', 'faq', 'contact', 'footer'];
    if (Array.isArray(plan.gallery_imgs) && plan.gallery_imgs.length) auto.splice(9, 0, 'gallery');
    if (Array.isArray(plan.pricing) && plan.pricing.length) auto.splice(auto.indexOf('reviews'), 0, 'pricing');
    if (Array.isArray(plan.team) && plan.team.length) auto.splice(auto.indexOf('reviews'), 0, 'team');
    if (Array.isArray(plan.timeline) && plan.timeline.length) auto.splice(auto.indexOf('reviews'), 0, 'timeline');
    if (Array.isArray(plan.logos) && plan.logos.length) auto.splice(auto.indexOf('reviews'), 0, 'logos');
    if (plan.video_url) auto.splice(auto.indexOf('reviews'), 0, 'video');
    if (plan.contact && plan.contact.address) auto.push('map');
    return auto;
  })();""",
'auto sections from plan')

# favicon + lazy + font link in head
rep("""<meta name="theme-color" content="#0b0e14">
${jsonLd}
<style>${css}</style>
</head><body>
${body}
<script>${js}</script>
</body></html>`;
}""",
"""<meta name="theme-color" content="#0b0e14">
<link rel="icon" href="${emojiFavicon(String((plan && plan.favicon) || '🚀').slice(0, 4))}">
${fontHtml}
${jsonLd}
<style>${css}</style>
</head><body>
${body}
<script>${js}</script>
</body></html>`;
}""",
'favicon + fonts head')

# lazy loading enforcement: rewrite <img> without loading attr in the AI body
rep("""  // strip any stray style/script the model may have emitted
  body = body.replace(/<style[\\s\\S]*?<\\/style>/gi, '').replace(/<script[\\s\\S]*?<\\/script>/gi, '');""",
"""  // strip any stray style/script the model may have emitted
  body = body.replace(/<style[\\s\\S]*?<\\/style>/gi, '').replace(/<script[\\s\\S]*?<\\/script>/gi, '');
  // ensure lazy loading + alt on every image
  body = body.replace(/<img(?![^>]*loading=)[^>]*>/gi, (tag) => tag.replace(/^<img/, '<img loading="lazy"'));
  // hero image should load eagerly — flip the first image back
  body = body.replace(/<img loading="lazy"([^>]*class="[^"]*nx-hero-img[^"]*")/i, '<img$1');""",
'lazy images')

open(P, 'w', encoding='utf-8').write(s)
print('Batch A done.')
