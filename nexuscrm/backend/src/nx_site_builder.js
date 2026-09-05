'use strict';
// ══════════════════════════════════════════════════════════════════════════
// nx_site_builder.js — BRIEF → PLAN → TOKENS → SECTIONS (the build pipeline)
//
// Mirrors the architecture the strongest prompt-to-website tools converge on
// (Google Stitch: Intent Parser → Layout Generator → Theme Tokenizer →
// Renderer; Relume: sitemap → wireframe → style guide):
//
//   nxUnderstandBrief (nx_brief)      — what the business is, offers, wants
//   nxWriteSite       (nx_copywriter) — sitemap + English copy, no invention
//   nxTokensFor       (here)          — one committed aesthetic per brand
//                                       personality: ≤3 hues, display+body
//                                       pairing, radius, contrast-checked
//   nxRenderSections  (here)          — industry-specific section order and
//                                       treatments, real SVG art instead of
//                                       broken placeholders, honest proof
//
// Everything is deterministic (same brief → same site) and uses ONLY the
// existing .nx-* design-system classes, so all ten shipped designs, the theme
// catalogue and the component styles keep working unchanged.
// ══════════════════════════════════════════════════════════════════════════
const NX_BRIEF = require('./nx_brief.js');
const NX_WRITER = require('./nx_copywriter.js');

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => { const v = Number(String(n).replace(/[^\d.-]/g, '')); return isFinite(v) ? String(Math.round(v)) : '0'; };
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// ── 1. PLAN ──────────────────────────────────────────────────────────────────
function nxBuildSitePlan(name, desc, opts) {
  opts = opts || {};
  const plan = opts.plan && typeof opts.plan === 'object' ? opts.plan : {};
  const brief = NX_BRIEF.nxUnderstandBrief({ name, description: desc, instructions: opts.instructions || '', plan });
  // A variant is the same understanding with a different creative seed: other
  // headline candidates, palette and type pairing — never different facts.
  const variant = Math.max(0, Math.min(9, parseInt(opts.variant, 10) || 0));
  if (variant) brief.seed = ((brief.seed >>> 0) + variant * 7919) >>> 0;
  brief.variant = variant;
  const writeup = NX_WRITER.nxWriteSite(brief, plan);
  const out = NX_WRITER.nxContentPlanFromWriteup(brief, writeup, plan);
  out._brief = brief;
  out._summary = NX_BRIEF.nxBriefSummary(brief);
  out._facts = NX_BRIEF.nxBriefFacts(brief);
  out._questions = NX_BRIEF.nxBriefQuestions(brief);
  return out;
}

// ── 2. TOKENS ────────────────────────────────────────────────────────────────
// Palettes: dominant + accent + neutral ramp; light or dark by personality.
// Every pair below was chosen so body text ≥ 7:1 and muted text ≥ 4.5:1 on bg.
const PALETTES = {
  warm: [
    { name: 'Terracotta & cream', mode: 'light', bg: '#fbf6ef', bg2: '#f4ebdd', card: '#ffffff', line: '#e8dcc8', text: '#2b1d14', muted: '#6f5b4c', accent: '#c2562b', accent2: '#e9a23b', third: '#5d7a4a' },
    { name: 'Honey & moss', mode: 'light', bg: '#faf7f0', bg2: '#f1ecdf', card: '#ffffff', line: '#e5dcc7', text: '#26211a', muted: '#66604f', accent: '#b7791f', accent2: '#e0a848', third: '#4f6b3c' },
    { name: 'Rose & clay', mode: 'light', bg: '#fcf5f2', bg2: '#f6e9e3', card: '#ffffff', line: '#ecd9d0', text: '#2d1c17', muted: '#735b52', accent: '#b8474d', accent2: '#e08a6d', third: '#6b6b3f' },
    { name: 'Espresso & amber', mode: 'dark', bg: '#1a120d', bg2: '#22180f', card: '#2a1e15', line: '#3d2d21', text: '#f6ede3', muted: '#c9b7a6', accent: '#e8863a', accent2: '#f2b25c', third: '#9bbd85' },
  ],
  refined: [
    { name: 'Ivory & ink', mode: 'light', bg: '#f8f6f1', bg2: '#efebe2', card: '#ffffff', line: '#dfd9cc', text: '#17161a', muted: '#5c5a5f', accent: '#1f1d2b', accent2: '#8c7a54', third: '#8c7a54' },
    { name: 'Charcoal & brass', mode: 'dark', bg: '#121214', bg2: '#19191d', card: '#1f1f24', line: '#2c2c33', text: '#f2efe8', muted: '#aaa59a', accent: '#c9a45c', accent2: '#e6c887', third: '#9a8f7a' },
    { name: 'Stone & forest', mode: 'light', bg: '#f6f5f0', bg2: '#ecebe3', card: '#ffffff', line: '#dcdacf', text: '#1a1f1b', muted: '#5a625b', accent: '#2f4a3a', accent2: '#8aa08f', third: '#b09a6a' },
  ],
  bold: [
    { name: 'Black & electric', mode: 'dark', bg: '#0b0b0f', bg2: '#131319', card: '#1a1a22', line: '#2a2a36', text: '#f7f7fb', muted: '#a6a6b8', accent: '#ff4d2e', accent2: '#ffb020', third: '#1fd1c5' },
    { name: 'Midnight & lime', mode: 'dark', bg: '#0a0f14', bg2: '#10171f', card: '#161f29', line: '#243040', text: '#f2f7fb', muted: '#9fb0c0', accent: '#b8f542', accent2: '#5eead4', third: '#f472b6' },
    { name: 'Paper & red', mode: 'light', bg: '#f7f5f0', bg2: '#eeebe4', card: '#ffffff', line: '#d9d5cc', text: '#111111', muted: '#4b4b4b', accent: '#d61f2c', accent2: '#111111', third: '#1e5bff' },
  ],
  precise: [
    { name: 'Navy & sky', mode: 'light', bg: '#f6f8fb', bg2: '#eceff5', card: '#ffffff', line: '#d9dfe9', text: '#0f1a2b', muted: '#4f5f78', accent: '#1d4ed8', accent2: '#0ea5e9', third: '#0f766e' },
    { name: 'Graphite & teal', mode: 'dark', bg: '#0e1116', bg2: '#141920', card: '#1a212a', line: '#26303c', text: '#eef2f6', muted: '#a3afbd', accent: '#2dd4bf', accent2: '#60a5fa', third: '#f59e0b' },
    { name: 'Slate & amber', mode: 'light', bg: '#f7f7f8', bg2: '#eeeef0', card: '#ffffff', line: '#dcdde1', text: '#151619', muted: '#55585f', accent: '#0f172a', accent2: '#d97706', third: '#0369a1' },
  ],
  calm: [
    { name: 'Sage & linen', mode: 'light', bg: '#f6f8f4', bg2: '#ebf0e7', card: '#ffffff', line: '#d8e0d3', text: '#1d261f', muted: '#5b6a5e', accent: '#3f7d5a', accent2: '#8fbf9f', third: '#c9a86a' },
    { name: 'Mist & sea', mode: 'light', bg: '#f4f8f9', bg2: '#e8f0f2', card: '#ffffff', line: '#d3e0e4', text: '#14262b', muted: '#4f6970', accent: '#1f6f78', accent2: '#7fc4c9', third: '#c98a5b' },
    { name: 'Sand & eucalyptus', mode: 'light', bg: '#faf8f3', bg2: '#f0ede4', card: '#ffffff', line: '#e2ddd0', text: '#23261f', muted: '#626557', accent: '#527660', accent2: '#a9c4b1', third: '#b9865b' },
    { name: 'Deep sea & sage', mode: 'dark', bg: '#0f1a17', bg2: '#14211d', card: '#1a2925', line: '#28403a', text: '#eaf2ee', muted: '#aec2b9', accent: '#6fcf97', accent2: '#a3e4c1', third: '#e0b56b' },
  ],
  playful: [
    { name: 'Cream & coral', mode: 'light', bg: '#fff9f2', bg2: '#fff0e1', card: '#ffffff', line: '#f4dfc9', text: '#2a1f2e', muted: '#6d5f72', accent: '#ff6b57', accent2: '#ffc542', third: '#4cc9c0' },
    { name: 'Plum & sunshine', mode: 'dark', bg: '#1b1230', bg2: '#22183c', card: '#2b1f4a', line: '#3b2c60', text: '#f8f4ff', muted: '#bfb3d6', accent: '#ffd166', accent2: '#ff7ab6', third: '#6ee7b7' },
    { name: 'Sky & tangerine', mode: 'light', bg: '#f3f9ff', bg2: '#e6f2ff', card: '#ffffff', line: '#cfe3f7', text: '#152238', muted: '#51627c', accent: '#ff8a3d', accent2: '#3b82f6', third: '#a855f7' },
  ],
};

// Display + body pairings per personality (Google Fonts; body ≥ 16px in CSS).
const FONT_PAIRS = {
  warm: [['Fraunces', 'Nunito Sans', 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&family=Nunito+Sans:wght@400;600;700&display=swap', 'serif'], ['Lora', 'Source Sans 3', 'https://fonts.googleapis.com/css2?family=Lora:wght@600;700&family=Source+Sans+3:wght@400;600;700&display=swap', 'serif']],
  refined: [['Cormorant Garamond', 'Inter Tight', 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter+Tight:wght@400;500;600&display=swap', 'serif'], ['Playfair Display', 'Figtree', 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;800&family=Figtree:wght@400;600;700&display=swap', 'serif']],
  bold: [['Bricolage Grotesque', 'Manrope', 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Manrope:wght@400;600;700&display=swap', 'sans-serif'], ['Syne', 'DM Sans', 'https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;700&display=swap', 'sans-serif']],
  precise: [['Sora', 'Inter', 'https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600&display=swap', 'sans-serif'], ['Plus Jakarta Sans', 'IBM Plex Sans', 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=IBM+Plex+Sans:wght@400;500;600&display=swap', 'sans-serif']],
  calm: [['Newsreader', 'Work Sans', 'https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500;6..72,700&family=Work+Sans:wght@400;500;600&display=swap', 'serif'], ['DM Serif Display', 'Karla', 'https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Karla:wght@400;600;700&display=swap', 'serif']],
  playful: [['Outfit', 'Nunito', 'https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800&family=Nunito:wght@400;600;700&display=swap', 'sans-serif'], ['Baloo 2', 'Quicksand', 'https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Quicksand:wght@400;600;700&display=swap', 'sans-serif']],
};

function hexToRgb(h) { const m = String(h).replace('#', ''); const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m; return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]; }
function luminance(h) { const [r, g, b] = hexToRgb(h).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function contrast(a, b) { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
function onColor(bg) { return contrast(bg, '#111111') >= contrast(bg, '#ffffff') ? '#111111' : '#ffffff'; }
const toHex = (rgb) => '#' + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
/**
 * WCAG AA text colour derived from a brand hue: the accent is pushed towards
 * black (light pages) or white (dark pages) in small steps until it reads at
 * ≥ 4.5:1 on EVERY surface it is used on (page background AND card). Hue is
 * kept, only lightness moves — the brand stays recognisable, the text stays
 * legible. Buttons keep the raw accent (their label colour is solved by
 * onColor); this is for links, eyebrows, checklist ticks and stat numbers.
 */
function aaText(color, surfaces, mode, min) {
  min = min || 4.5;
  const ok = (c) => surfaces.every((bg) => contrast(c, bg) >= min);
  if (ok(color)) return color;
  const target = mode === 'dark' ? [255, 255, 255] : [0, 0, 0];
  const base = hexToRgb(color);
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = toHex(base.map((v, i) => v + (target[i] - v) * t));
    if (ok(c)) return c;
  }
  return mode === 'dark' ? '#ffffff' : '#111111';
}

function nxTokensFor(plan, opts) {
  opts = opts || {};
  const personality = (plan && plan._personality) || 'precise';
  const seed = ((plan && plan._brief && plan._brief.seed) || 0) + (parseInt(opts.variant, 10) || 0) * 7919;
  let pals = PALETTES[personality] || PALETTES.precise;
  // The chosen design decides light vs dark; the brief decides the hues.
  if (opts.mode === 'dark' || opts.mode === 'light') { const f = pals.filter((p) => p.mode === opts.mode); if (f.length) pals = f; }
  const pal = pals[(seed >>> 0) % pals.length];
  const pairs = FONT_PAIRS[personality] || FONT_PAIRS.precise;
  const pair = pairs[((seed >>> 3) >>> 0) % pairs.length];
  const radius = { warm: '14px', refined: '6px', bold: '4px', precise: '10px', calm: '18px', playful: '22px' }[personality] || '12px';
  const btnText = onColor(pal.accent);
  const grad = `linear-gradient(100deg,${pal.accent} 10%,${pal.accent2} 60%,${pal.third} 100%)`;
  // Accent-as-text (links, eyebrows, ticks, numbers) must pass AA on the page
  // AND on cards; the raw accent often does not on warm/playful light palettes.
  const surfaces = [pal.bg, pal.bg2, pal.card];
  const linkText = aaText(pal.mode === 'dark' ? pal.accent2 : pal.accent, surfaces, pal.mode);
  const accentText = aaText(pal.accent, surfaces, pal.mode);
  const r1 = (v) => Math.round(v * 10) / 10;
  return { personality, palette: pal, fonts: { display: pair[0], body: pair[1], url: pair[2], displayFallback: pair[3] }, radius, btnText, grad, linkText, accentText, checks: { textOnBg: r1(contrast(pal.text, pal.bg)), mutedOnBg: r1(contrast(pal.muted, pal.bg)), mutedOnCard: r1(contrast(pal.muted, pal.card)), buttonText: r1(contrast(btnText, pal.accent)), linkOnBg: r1(contrast(linkText, pal.bg)), linkOnCard: r1(contrast(linkText, pal.card)), aa: contrast(pal.text, pal.bg) >= 4.5 && contrast(pal.muted, pal.bg) >= 4.5 && contrast(pal.muted, pal.card) >= 4.5 && contrast(linkText, pal.bg) >= 4.5 && contrast(linkText, pal.card) >= 4.5 && contrast(btnText, pal.accent) >= 4.5 } };
}

function nxTokensCss(tokens, scope) {
  if (!tokens) return '';
  const p = tokens.palette;
  scope = scope || { palette: true, fonts: true };
  const parts = [`/* brand tokens: ${tokens.personality} · ${p.name} · ${tokens.fonts.display} + ${tokens.fonts.body} */`];
  // keyboard users always get a visible focus ring and a skip link — even
  // when the owner pinned their own theme/accent (palette scope off); the
  // palette block below refines the colour to the AA-checked accent.
  parts.push(`:focus-visible{outline:3px solid var(--accent);outline-offset:3px;border-radius:4px}.btn:focus-visible{outline-offset:4px}.nx-skip{position:absolute;left:12px;top:-60px;z-index:200;padding:10px 16px;border-radius:10px;background:var(--accent);color:var(--on-accent,#fff);font-weight:700;text-decoration:none;transition:top .15s}.nx-skip:focus{top:12px;outline-offset:2px}`);
  if (scope.palette) {
    parts.push(`:root{--bg:${p.bg};--bg2:${p.bg2};--card:${p.card};--line:${p.line};--text:${p.text};--muted:${p.muted};--accent:${p.accent};--accent2:${p.accent2};--teal:${p.third};--amber:${p.accent2};--grad:${tokens.grad};--radius:${tokens.radius};--on-accent:${tokens.btnText};color-scheme:${p.mode}}`);
    parts.push(`body::before{background:radial-gradient(60vw 60vw at 8% -5%,${p.accent}14,transparent 60%),radial-gradient(55vw 55vw at 105% 108%,${p.third}14,transparent 60%)}`);
    parts.push(`.btn-primary{background:linear-gradient(135deg,${p.accent2},${p.accent} 55%,${p.accent});color:${tokens.btnText};box-shadow:0 14px 34px -12px ${p.accent}99}`);
    parts.push(`.nx-nav{background:${p.mode === 'dark' ? 'rgba(10,10,14,.82)' : 'rgba(255,255,255,.78)'}}`);
    const lt = tokens.linkText || (p.mode === 'dark' ? p.accent2 : p.accent), at = tokens.accentText || p.accent;
    parts.push(`.nx-badge{background:${p.accent}1a;border-color:${p.accent}55;color:${lt}}`);
    parts.push(`a{color:${lt}}.nx-nav-links a:hover,.eyebrow{color:${lt}}.nx-check b{color:${at}}`);
    parts.push(`.nx-hero-img img,.nx-hero-img svg{box-shadow:0 30px 70px -30px ${p.mode === 'dark' ? 'rgba(0,0,0,.8)' : p.accent + '55'}}`);
    parts.push(`#nx-spot{background:radial-gradient(circle,${p.accent}1a,transparent 60%)}.nx-step .n,.nx-stat b{color:${lt}}`);
    // keyboard users get the same affordance mouse users get from hover
    parts.push(`:focus-visible{outline-color:${at}}.nx-skip{background:${at};color:${onColor(at)}}`);
  }

  if (scope.fonts) {
    parts.push(`body{font-family:'${tokens.fonts.body}',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:17px}h1,h2,h3,.nx-brand,.nx-stat b{font-family:'${tokens.fonts.display}',${tokens.fonts.displayFallback === 'serif' ? 'Georgia,serif' : 'system-ui,sans-serif'}}`);
    parts.push(`.nx-hero h1{font-size:clamp(38px,6.2vw,68px);line-height:1.04;letter-spacing:${tokens.personality === 'refined' || tokens.personality === 'calm' ? '-.01em' : '-.03em'}}.sec-title{font-size:clamp(28px,3.8vw,44px)}`);
  }
  // section treatments that vary down the page (anti-monotony) + the few
  // classes the base designs never styled
  parts.push(`.nx-alt{background:var(--bg2)}.nx-occasions{display:flex;flex-wrap:wrap;gap:10px}.nx-occasions span{padding:10px 16px;border:1px solid var(--line);border-radius:999px;background:var(--card);font-weight:600;font-size:14px}.nx-map iframe,.nx-video iframe{width:100%;min-height:340px;border:0;border-radius:var(--radius)}.nx-hours{display:grid;gap:8px;max-width:520px}.nx-hours div{display:flex;justify-content:space-between;gap:16px;padding:12px 16px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius)}.nx-areas{display:flex;flex-wrap:wrap;gap:8px}.nx-areas span{padding:8px 14px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:14px}.nx-hero-img svg{width:100%;height:auto;border-radius:var(--radius);display:block}.nx-product{display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:center}.nx-product .plat{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 22px}.nx-product .plat span{padding:6px 12px;border-radius:999px;border:1px solid var(--line);font-size:13px;color:var(--muted)}.nx-wa{display:inline-flex;align-items:center;gap:8px;margin-top:10px;font-weight:700}.nx-cinfo a{color:inherit;text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:3px}.nx-cinfo a:hover{text-decoration-color:var(--accent)}.nx-note{font-size:13px;color:var(--muted);margin-top:8px}.nx-form label{display:block;font-size:13px;color:var(--muted);margin:0 0 4px}@media(max-width:820px){.nx-product{grid-template-columns:1fr}}`);
  return parts.join('\n');
}

// ── 3. ART: deterministic SVG illustrations per industry/personality ────────
// Replaces "0 images" / broken {{HERO}} placeholders with real, on-brand art
// the owner can swap for photos. Pure vector, tiny, no external requests.
const MOTIFS = {
  florist: 'petals', bakery: 'rings', cafe: 'rings', restaurant: 'rings', bar: 'rings', hotel: 'arches', catering: 'rings',
  dental: 'soft', medical: 'soft', physio: 'waves', vet: 'soft', pharmacy: 'soft', therapy: 'waves',
  plumbing: 'grid', electrician: 'bolts', hvac: 'waves', roofing: 'peaks', construction: 'grid', landscaping: 'petals', cleaning: 'soft', pest: 'grid', moving: 'grid', auto: 'bolts', security: 'grid',
  salon: 'waves', barber: 'stripes', spa: 'soft', tattoo: 'stripes', fitness: 'bolts', yoga: 'waves', nutrition: 'petals',
  photography: 'aperture', design: 'blocks', marketing: 'bolts', architecture: 'arches', music: 'waves', games: 'pixels', events: 'confetti',
  law: 'columns', accounting: 'blocks', consulting: 'blocks', finance: 'peaks', realestate: 'arches', saas: 'blocks', itservices: 'grid', ecommerce: 'blocks', grocery: 'petals', school: 'blocks', nonprofit: 'soft', travel: 'peaks', portfolio: 'aperture', general: 'soft',
};
function prng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return (s % 10000) / 10000; }; }

function nxArtSvg(kind, tokens, seed, label, variant) {
  const p = tokens.palette;
  const r = prng((seed || 1) + (variant || 0) * 977);
  const W = 720, H = 540;
  nxArtSvg.__n = (nxArtSvg.__n || 0) + 1;
  const id = 'g' + ((seed >>> 0) % 9973) + 'v' + (variant || 0) + 'n' + nxArtSvg.__n;
  const bgA = p.mode === 'dark' ? p.card : p.bg2;
  let body = '';
  const A = p.accent, B = p.accent2, C = p.third;
  const at = (x, y) => `${Math.round(x)} ${Math.round(y)}`;
  switch (kind) {
    case 'petals': { for (let i = 0; i < 9; i++) { const cx = 120 + r() * 480, cy = 90 + r() * 360, rr = 40 + r() * 70; const col = [A, B, C][i % 3]; body += `<ellipse cx="${Math.round(cx)}" cy="${Math.round(cy)}" rx="${Math.round(rr)}" ry="${Math.round(rr * (0.55 + r() * 0.3))}" fill="${col}" fill-opacity="${(0.22 + r() * 0.35).toFixed(2)}" transform="rotate(${Math.round(r() * 180)} ${Math.round(cx)} ${Math.round(cy)})"/>`; } body += `<circle cx="360" cy="270" r="54" fill="${A}"/><circle cx="360" cy="270" r="22" fill="${B}"/>`; break; }
    case 'rings': { for (let i = 0; i < 6; i++) { const cx = 160 + r() * 400, cy = 120 + r() * 300, rr = 50 + r() * 120; body += `<circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="${Math.round(rr)}" fill="none" stroke="${[A, B, C][i % 3]}" stroke-width="${Math.round(10 + r() * 26)}" stroke-opacity="${(0.35 + r() * 0.45).toFixed(2)}"/>`; } break; }
    case 'arches': { for (let i = 0; i < 5; i++) { const x = 60 + i * 130, h = 260 + r() * 200; body += `<path d="M ${x} ${H} V ${Math.round(H - h + 60)} A 60 60 0 0 1 ${x + 120} ${Math.round(H - h + 60)} V ${H} Z" fill="${[A, B, C][i % 3]}" fill-opacity="${(0.45 + r() * 0.4).toFixed(2)}"/>`; } break; }
    case 'soft': { for (let i = 0; i < 4; i++) { const cx = 180 + r() * 360, cy = 150 + r() * 240, rr = 110 + r() * 120; body += `<circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="${Math.round(rr)}" fill="url(#${id}${i % 2 ? 'b' : 'a'})" fill-opacity="${(0.5 + r() * 0.4).toFixed(2)}"/>`; } break; }
    case 'waves': { for (let i = 0; i < 6; i++) { const y = 120 + i * 60, amp = 24 + r() * 40; let d = `M 0 ${y}`; for (let x = 0; x <= W; x += 90) d += ` Q ${x + 45} ${Math.round(y + (r() > 0.5 ? amp : -amp))} ${x + 90} ${y}`; body += `<path d="${d}" fill="none" stroke="${[A, B, C][i % 3]}" stroke-width="${Math.round(8 + r() * 14)}" stroke-linecap="round" stroke-opacity="${(0.4 + r() * 0.5).toFixed(2)}"/>`; } break; }
    case 'grid': { for (let y = 60; y < H; y += 100) for (let x = 60; x < W; x += 100) { if (r() < 0.45) continue; const s = 30 + r() * 50; body += `<rect x="${x}" y="${y}" width="${Math.round(s)}" height="${Math.round(s)}" rx="${tokens.radius === '4px' ? 2 : 10}" fill="${[A, B, C][Math.floor(r() * 3)]}" fill-opacity="${(0.3 + r() * 0.6).toFixed(2)}"/>`; } break; }
    case 'bolts': { for (let i = 0; i < 7; i++) { const x = 80 + r() * 560, y = 60 + r() * 300, s = 40 + r() * 80; body += `<polygon points="${at(x, y)},${at(x + s * 0.6, y)},${at(x + s * 0.25, y + s * 0.5)},${at(x + s * 0.7, y + s * 0.5)},${at(x - s * 0.1, y + s * 1.2)},${at(x + s * 0.15, y + s * 0.65)},${at(x - s * 0.2, y + s * 0.65)}" fill="${[A, B, C][i % 3]}" fill-opacity="${(0.4 + r() * 0.5).toFixed(2)}"/>`; } break; }
    case 'peaks': { for (let i = 0; i < 4; i++) { const base = H, x0 = -100 + i * 180, h = 220 + r() * 260; body += `<polygon points="${at(x0, base)},${at(x0 + 220, base - h)},${at(x0 + 440, base)}" fill="${[A, B, C][i % 3]}" fill-opacity="${(0.35 + r() * 0.45).toFixed(2)}"/>`; } break; }
    case 'stripes': { for (let i = 0; i < 12; i++) { const x = -120 + i * 80; body += `<rect x="${x}" y="-60" width="${Math.round(20 + r() * 30)}" height="${H + 120}" fill="${[A, B, C][i % 3]}" fill-opacity="${(0.25 + r() * 0.6).toFixed(2)}" transform="rotate(-18 360 270)"/>`; } break; }
    case 'aperture': { for (let i = 0; i < 8; i++) { const ang = (i / 8) * Math.PI * 2; body += `<path d="M 360 270 L ${Math.round(360 + Math.cos(ang) * 210)} ${Math.round(270 + Math.sin(ang) * 210)} A 210 210 0 0 1 ${Math.round(360 + Math.cos(ang + 0.7) * 210)} ${Math.round(270 + Math.sin(ang + 0.7) * 210)} Z" fill="${[A, B, C][i % 3]}" fill-opacity="${(0.35 + (i % 3) * 0.2).toFixed(2)}"/>`; } body += `<circle cx="360" cy="270" r="70" fill="${bgA}"/>`; break; }
    case 'blocks': { for (let i = 0; i < 9; i++) { const x = 60 + r() * 520, y = 40 + r() * 380, w = 60 + r() * 160, h = 40 + r() * 120; body += `<rect x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" rx="${parseInt(tokens.radius, 10) || 8}" fill="${[A, B, C][i % 3]}" fill-opacity="${(0.25 + r() * 0.6).toFixed(2)}"/>`; } break; }
    case 'pixels': { const cell = 36; for (let y = 36; y < H - 36; y += cell) for (let x = 36; x < W - 36; x += cell) { if (r() < 0.6) continue; body += `<rect x="${x}" y="${y}" width="${cell - 4}" height="${cell - 4}" fill="${[A, B, C, p.text][Math.floor(r() * 4)]}" fill-opacity="${(0.35 + r() * 0.6).toFixed(2)}"/>`; } break; }
    case 'confetti': { for (let i = 0; i < 40; i++) { const x = r() * W, y = r() * H, s = 8 + r() * 18; body += `<rect x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(s)}" height="${Math.round(s * 0.5)}" rx="3" fill="${[A, B, C][i % 3]}" fill-opacity="${(0.5 + r() * 0.5).toFixed(2)}" transform="rotate(${Math.round(r() * 360)} ${Math.round(x)} ${Math.round(y)})"/>`; } break; }
    case 'columns': { for (let i = 0; i < 5; i++) { const x = 90 + i * 120; body += `<rect x="${x}" y="120" width="60" height="360" fill="${i % 2 ? B : A}" fill-opacity="${(0.55 + r() * 0.3).toFixed(2)}"/><rect x="${x - 14}" y="100" width="88" height="22" rx="4" fill="${C}" fill-opacity=".8"/>`; } body += `<rect x="40" y="480" width="640" height="18" rx="4" fill="${p.text}" fill-opacity=".5"/>`; break; }
    default: { body += `<circle cx="360" cy="270" r="170" fill="url(#${id}a)"/>`; }
  }
  const title = esc(label || 'Illustration');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}" width="${W}" height="${H}"><title>${title}</title><defs><linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${A}"/><stop offset="1" stop-color="${B}"/></linearGradient><linearGradient id="${id}b" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C}"/><stop offset="1" stop-color="${A}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="${bgA}"/>${body}</svg>`;
}
function nxHeroArt(plan, tokens, variant) { const ind = (plan && plan._industry) || 'general'; return nxArtSvg(MOTIFS[ind] || 'soft', tokens, (plan && plan._brief && plan._brief.seed) || 7, `${(plan && plan.name) || 'Brand'} — ${ind} illustration`, variant || 0); }

// ── 4. RENDER ────────────────────────────────────────────────────────────────
function nxRenderSections(P, opts) {
  opts = opts || {};
  P = P || {};
  nxArtSvg.__n = 0; // gradient ids are unique within a page and deterministic across builds
  const brand = clean(P.name) || 'Our business';
  const tokens = opts.tokens || nxTokensFor(P, opts);
  const h = P.hero || {};
  const H = P._headings || {};
  const sm = P._sitemap || { sections: [], nav: [], labels: {} };
  const contact = P.contact || {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const reveal = (d) => 'data-reveal' + (d ? ' data-delay="' + d + '"' : '');
  const head = (key, fallbackKicker, fallbackTitle) => { const x = H[key] || {}; return `<div ${reveal()}><span class="eyebrow">${esc(x.kicker || fallbackKicker)}</span><h2 class="sec-title">${esc(x.title || fallbackTitle)}</h2></div>`; };
  const gradLast = (t) => { const w = clean(t || 'Welcome').split(' '); const last = w.pop(); return (w.length ? w.map(esc).join(' ') + ' ' : '') + '<span class="grad-text">' + esc(last) + '</span>'; };
  const tel = (v) => 'tel:' + String(v || '').replace(/[^\d+]/g, '');
  const wa = (v) => 'https://wa.me/' + String(v || '').replace(/\D/g, '');
  const hasArr = (k) => arr(P[k]).length > 0;

  // Sections present: sitemap order, then anything the plan supplies that the
  // sitemap did not name (pricing/team/timeline/logos/gallery/video/map).
  let order = sm.sections && sm.sections.length ? sm.sections.slice() : ['hero', 'services', 'why', 'about', 'process', 'faq', 'lead', 'contact'];
  const ensure = (s, before) => { if (order.includes(s)) return; const i = order.indexOf(before); if (i === -1) order.push(s); else order.splice(i, 0, s); };
  if (hasArr('pricing')) ensure('pricing', 'proof');
  if (hasArr('team')) ensure('team', 'process');
  if (hasArr('timeline')) ensure('timeline', 'proof');
  if (hasArr('logos')) ensure('logos', 'services');
  if (hasArr('gallery_imgs')) ensure('gallery', 'about');
  if (P.video_url) ensure('video', 'proof');
  if (contact.address && !order.includes('map')) order.push('map');
  if (arr(P.stats).length || arr(P.reviews).length) ensure('proof', 'faq');
  // A strip of real facts (differentiators, services, location) under the hero
  // for the louder personalities; quiet ones let the hero breathe.
  if (arr(P.marquee).length >= 4 && !order.includes('marquee') && !['refined', 'calm'].includes(P._personality)) order.splice(1, 0, 'marquee');
  // opts.sections = the builder's checkbox list. A section is hidden only when
  // it is one the builder knows about AND the owner unticked it; industry
  // sections the UI never listed (occasions, product, areas, hours…) stay.
  if (Array.isArray(opts.sections) && opts.sections.length) {
    const allow = new Set(opts.sections.map(String));
    const LEGACY = new Set(['hero', 'marquee', 'stats', 'services', 'why', 'about', 'process', 'gallery', 'reviews', 'pricing', 'team', 'timeline', 'logos', 'video', 'lead', 'faq', 'contact', 'map']);
    const NEWER = new Set(['occasions', 'product', 'areas', 'hours']);
    // an older client that never listed the newer sections cannot have unticked them
    const knowsNewer = [...NEWER].some((k) => allow.has(k));
    const keep = (s) => { if (s === 'trust') s = 'why'; if (s === 'proof') return allow.has('reviews') || allow.has('stats') || allow.has('proof'); if (LEGACY.has(s)) return allow.has(s); if (NEWER.has(s)) return !knowsNewer || allow.has(s); return true; };
    order = order.filter((s) => keep(s) || s === 'hero' || s === 'contact');
  }
  order = order.filter((s) => s !== 'nav' && s !== 'footer');

  const navItems = (sm.nav && sm.nav.length ? sm.nav : order.filter((s) => ['services', 'about', 'process', 'pricing', 'gallery', 'proof', 'faq', 'contact'].includes(s)).map((s) => ({ id: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))).filter((n) => order.includes(n.id) || n.id === 'contact');
  let out = `<a class="nx-skip" href="#main">Skip to content</a><nav class="nx-nav"><div class="container nx-nav-inner"><div class="nx-brand">${esc(brand)}</div><button class="nx-menu-btn" aria-label="Menu" aria-expanded="false">☰</button><ul class="nx-nav-links">${navItems.map((n) => `<li><a href="#${esc(n.id)}">${esc(n.label)}</a></li>`).join('')}</ul></div></nav><main id="main">`;
  let alt = 0; const band = () => (alt++ % 2 ? ' nx-alt' : '');

  const R = {
    hero() {
      const art = h.image ? `<img src="${esc(h.image)}" alt="${esc(brand)}" loading="eager" width="720" height="540">` : nxHeroArt(P, tokens, 0);
      const ctaHref = P.product ? '#product' : '#contact';
      return `<section class="nx-hero" id="home"><div class="container nx-hero-inner"><div ${reveal()}>${h.badge ? `<span class="nx-badge"><span class="dot"></span> ${esc(h.badge)}</span>` : ''}<h1>${gradLast(h.title)}</h1><p class="lead">${esc(h.sub || '')}</p><div class="nx-hero-actions"><a class="btn btn-primary" href="${P.product && P.product.url ? esc(P.product.url) : ctaHref}">${esc(h.primary || 'Get in touch')}</a><a class="btn btn-ghost" href="#${order.includes('services') ? 'services' : 'about'}">${esc(h.secondary || 'Learn more')}</a></div>${contact.phone ? `<p class="nx-note">Prefer to talk? <a href="${tel(contact.phone)}">${esc(contact.phone)}</a>${contact.whatsapp && contact.whatsapp !== contact.phone ? ` · WhatsApp <a href="${wa(contact.whatsapp)}" rel="noopener">${esc(contact.whatsapp)}</a>` : ''}</p>` : ''}</div><div class="nx-hero-img" ${reveal(1)}>${art}</div></div></section>`;
    },
    marquee() { const items = arr(P.marquee).filter(Boolean); if (!items.length) return ''; return `<div class="nx-marquee" aria-hidden="true"><div class="nx-marquee-track">${items.concat(items).map((t) => `<span>${esc(t)}</span>`).join('')}</div></div>`; },
    trust() { return R.why(); },
    why() {
      const items = arr(P.why); if (!items.length || R.__whyDone) return ''; R.__whyDone = true;
      return `<section class="section${band()}" id="why"><div class="container"><div class="nx-split"><div>${head('why', 'Why us', 'Why ' + brand)}${items.map((w, i) => `<div class="nx-check" ${reveal((i % 3) + 1)}><b>✔</b><div><b>${esc(w.check)}</b><span>${esc(w.text)}</span></div></div>`).join('')}</div><div ${reveal(2)} class="nx-hero-img">${nxHeroArt(P, tokens, 1)}</div></div></div></section>`;
    },
    services() {
      const items = arr(P.services); if (!items.length) return '';
      return `<section class="section${band()}" id="services"><div class="container">${head('services', 'What we do', 'Services')}<div class="nx-grid g3">${items.map((s, i) => `<div class="nx-card" ${reveal(String(i % 3))}><div class="ic">${esc(s.icon || '⭐')}</div><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></div>`).join('')}</div></div></section>`;
    },
    occasions() { const items = arr(P.occasions); if (!items.length) return ''; return `<section class="section${band()}" id="occasions"><div class="container">${head('occasions', 'Occasions', 'For every moment')}<div class="nx-occasions" ${reveal()}>${items.map((o) => `<span>${esc(o)}</span>`).join('')}</div></div></section>`; },
    product() {
      const pr = P.product; if (!pr) return '';
      return `<section class="section${band()}" id="product"><div class="container"><div class="nx-product"><div ${reveal()}><span class="eyebrow">${esc((H.product && H.product.kicker) || 'Featured')}</span><h2 class="sec-title">${esc(pr.name)}</h2><p>${esc(h.sub || '')}</p>${arr(pr.platforms).length ? `<div class="plat">${pr.platforms.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}<a class="btn btn-primary" href="${pr.url ? esc(pr.url) : '#contact'}">${esc(h.primary || 'Learn more')}</a></div><div class="nx-hero-img" ${reveal(1)}>${nxHeroArt(P, tokens, 2)}</div></div></div></section>`;
    },
    about() {
      const a = P.about || {}; if (!a.body) return '';
      return `<section class="section${band()}" id="about"><div class="container"><div class="nx-split"><div ${reveal()}><span class="eyebrow">${esc((H.about && H.about.kicker) || 'About')}</span><h2 class="sec-title">${esc(a.heading || 'About ' + brand)}</h2><p>${esc(a.body)}</p></div><div ${reveal(1)} class="nx-hero-img">${a.image ? `<img src="${esc(a.image)}" alt="${esc(brand)} — about" loading="lazy" width="720" height="540">` : nxHeroArt(P, tokens, 3)}</div></div></div></section>`;
    },
    team() {
      const items = arr(P.team); if (!items.length) return '';
      return `<section class="section${band()}" id="team"><div class="container">${head('team', 'The team', 'The people behind it')}<div class="nx-grid g2">${items.map((m) => `<div class="nx-card" ${reveal()}><div class="ic">${esc(m.emoji || '👤')}</div><h3>${esc(m.name)}</h3><p>${esc(m.role || '')}</p>${m.bio ? `<p>${esc(m.bio)}</p>` : ''}</div>`).join('')}</div></div></section>`;
    },
    process() {
      const items = arr(P.process); if (!items.length) return '';
      return `<section class="section${band()}" id="process"><div class="container">${head('process', 'How it works', 'How it works')}<div class="nx-steps">${items.map((s, i) => `<div class="nx-step" ${reveal(String(i % 3))}><span class="n">${num(s.step || i + 1)}</span><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></div>`).join('')}</div></div></section>`;
    },
    pricing() {
      const items = arr(P.pricing); if (!items.length) return '';
      return `<section class="section${band()}" id="pricing"><div class="container">${head('pricing', 'Pricing', 'Simple, clear pricing')}<div class="nx-grid g3">${items.map((p) => `<div class="nx-card${p.popular ? ' popular' : ''}" ${reveal()}><div class="pl">${esc(p.name)}</div><b>${esc(p.price)}${p.per ? `<span class="per"> / ${esc(p.per)}</span>` : ''}</b>${arr(p.features).length ? `<ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : (p.text ? `<p>${esc(p.text)}</p>` : '')}<a class="btn btn-primary" href="#contact">${esc(h.primary || 'Choose')}</a></div>`).join('')}</div></div></section>`;
    },
    timeline() {
      const items = arr(P.timeline); if (!items.length) return '';
      return `<section class="section${band()}" id="timeline"><div class="container">${head('timeline', 'Our journey', 'Milestones')}<div class="nx-steps">${items.map((t) => `<div class="nx-step" ${reveal()}><span class="n">${esc(t.year || t.name || '')}</span><h3>${esc(t.title || t.name || '')}</h3><p>${esc(t.text || '')}</p></div>`).join('')}</div></div></section>`;
    },
    logos() { const items = arr(P.logos); if (!items.length) return ''; return `<section class="section${band()}" id="logos"><div class="container"><div class="nx-grid g3">${items.map((lg) => `<div class="nx-card" ${reveal()}><h3>${esc(typeof lg === 'string' ? lg : lg.name || '')}</h3><p>Partner</p></div>`).join('')}</div></div></section>`; },
    video() { const u = String(P.video_url || ''); if (!u) return ''; const m = u.match(/(?:youtu\.be\/|youtube\.com\/embed\/|v=)([\w-]{6,})/) || []; return `<section class="section${band()}" id="video"><div class="container">${head('video', 'Watch', 'See it for yourself')}<div class="nx-video">${m[1] ? `<iframe src="https://www.youtube.com/embed/${esc(m[1])}" title="Video" loading="lazy" allowfullscreen></iframe>` : `<a class="btn btn-ghost" href="${esc(u)}" target="_blank" rel="noopener">Watch video</a>`}</div></div></section>`; },
    gallery() { const items = arr(P.gallery_imgs); if (!items.length) return ''; return `<section class="section${band()}" id="gallery"><div class="container">${head('gallery', 'Gallery', 'A look at our work')}<div class="nx-gallery">${items.map((g, i) => `<img src="${esc(g)}" alt="${esc(brand)} — photo ${i + 1}" loading="lazy" width="600" height="450">`).join('')}</div></div></section>`; },
    proof() {
      const stats = arr(P.stats), reviews = arr(P.reviews); if (!stats.length && !reviews.length) return '';
      // Honesty: a proof block with numbers but no quotes is headed as
      // numbers ("By the numbers"), never as "What people say".
      const proofHead = reviews.length ? head('proof', 'In their words', 'What people say') : `<div ${reveal()}><span class="eyebrow">Track record</span><h2 class="sec-title">By the numbers</h2></div>`;
      return `<section class="section${band()}" id="proof"><div class="container">${proofHead}${stats.length ? `<div class="nx-stats">${stats.map((s, i) => { const v = String(s.value); const n = v.replace(/[^\d]/g, ''); const suffix = v.replace(/^[\d,.\s]+/, ''); return `<div class="nx-stat" ${reveal(i)}><b${/^\d+$/.test(n) && !/[.★/]/.test(v) ? ` data-count="${n}"` : ''}>${esc(v)}</b><span>${esc(s.label)}</span></div>`; }).join('')}</div>` : ''}${reviews.length ? `<div class="nx-tstrip">${reviews.map((r) => `<div class="nx-review" ${reveal()}><div class="stars" aria-label="${Math.max(1, Math.min(5, Number(r.stars) || 5))} out of 5">${'★'.repeat(Math.max(1, Math.min(5, Number(r.stars) || 5)))}</div><p>“${esc(r.quote || r.text)}”</p><div class="who"><b>${esc(r.name)}</b><span>${esc(r.role || '')}</span></div></div>`).join('')}</div>` : ''}</div></section>`;
    },
    faq() { const items = arr(P.faq); if (!items.length) return ''; return `<section class="section${band()}" id="faq"><div class="container">${head('faq', 'Good to know', 'Frequently asked questions')}<div class="nx-faq">${items.map((f) => `<div class="nx-faq-item" ${reveal()}><div class="nx-faq-q" role="button" tabindex="0">${esc(f.q)}</div><div class="nx-faq-a">${esc(f.a)}</div></div>`).join('')}</div></div></section>`; },
    hours() { const items = arr(P.working_hours); if (!items.length) return ''; return `<section class="section${band()}" id="hours"><div class="container">${head('hours', 'Opening hours', 'When to find us')}<div class="nx-hours" ${reveal()}>${items.map((l) => { const m = String(l).match(/^([^:\d]{3,40}?)\s*[:\-–]?\s*(\d.*|closed.*|open.*)$/i); return m ? `<div><b>${esc(clean(m[1]))}</b><span>${esc(clean(m[2]))}</span></div>` : `<div><span>${esc(l)}</span></div>`; }).join('')}</div></div></section>`; },
    areas() { const a = P.areas; if (!a || (!a.city && !arr(a.serviceArea).length)) return ''; const chips = [a.city, a.region].concat(arr(a.serviceArea)).filter(Boolean); return `<section class="section${band()}" id="areas"><div class="container">${head('areas', 'Where we work', 'Areas we cover')}<div class="nx-areas" ${reveal()}>${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div><p class="nx-note">Just outside these areas? Ask — we can often help.</p></div></section>`; },
    lead() { const c = P.cta || {}; return `<section class="section nx-lead" id="lead"><div class="container" ${reveal()}><h2>${esc(c.heading || 'Get in touch')}</h2><p>${esc(c.sub || '')}</p><a class="btn btn-primary" href="#contact">${esc(c.primary || h.primary || 'Get in touch')}</a></div></section>`; },
    contact() {
      const hours = arr(P.working_hours);
      const rows = [];
      if (contact.phone) rows.push(`<div><div><b>Phone</b><span><a href="${tel(contact.phone)}">${esc(contact.phone)}</a></span></div></div>`);
      if (contact.whatsapp) rows.push(`<div><div><b>WhatsApp</b><span><a href="${wa(contact.whatsapp)}" rel="noopener" target="_blank">${esc(contact.whatsapp)}</a></span></div></div>`);
      if (contact.email) rows.push(`<div><div><b>Email</b><span><a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a></span></div></div>`);
      if (contact.address) rows.push(`<div><div><b>Address</b><span>${esc(contact.address)}</span></div></div>`);
      if (hours.length) rows.push(`<div><div><b>Hours</b><span>${hours.map(esc).join(' · ')}</span></div></div>`);
      if (!rows.length) rows.push(`<div><div><b>Get in touch</b><span>Use the form and we will reply as soon as we can.</span></div></div>`);
      return `<section class="section${band()}" id="contact"><div class="container">${head('contact', 'Contact', 'Get in touch')}<div class="nx-contact-grid"><div class="nx-cinfo" ${reveal()}>${rows.join('')}</div><form class="nx-form" ${reveal(1)}><label for="nx-f-name">Your name</label><input id="nx-f-name" name="name" placeholder="Your name" required autocomplete="name"><label for="nx-f-email">Email</label><input id="nx-f-email" name="email" type="email" placeholder="you@example.com" required autocomplete="email"><label for="nx-f-phone">Phone</label><input id="nx-f-phone" name="phone" placeholder="Optional" autocomplete="tel"><label for="nx-f-msg">Message</label><textarea id="nx-f-msg" name="message" placeholder="How can we help?" required></textarea><button class="btn btn-primary" type="submit">${esc(h.primary && h.primary.length <= 22 ? 'Send message' : 'Send message')}</button><p class="ok" style="display:none">Thanks — we have your message and will reply soon.</p></form></div></div></section>`;
    },
    map() { if (!contact.address) return ''; return `<section class="section${band()}" id="map"><div class="container"><div class="nx-map"><iframe src="https://www.google.com/maps?q=${encodeURIComponent(String(contact.address))}&output=embed" title="Map" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div></div></section>`; },
  };
  for (const s of order) { const fn = R[s]; if (fn) out += fn(); }
  out += `</main><footer class="nx-footer"><div class="container">© ${new Date().getFullYear()} ${esc(brand)}${contact.address ? ' · ' + esc(contact.address) : ''}${contact.phone ? ' · <a href="' + tel(contact.phone) + '">' + esc(contact.phone) + '</a>' : ''}</div></footer>`;
  return out;
}

// ── 5. QUALITY REPORT — what a reviewer would check ─────────────────────────
function nxContentQuality(plan, html) {
  const brief = (plan && plan._brief) || null;
  const issues = [];
  const text = String(html || '');
  const FABRICATED = [/\b\d+\+?\s*(years? experience|happy clients|projects completed|satisfied customers)\b/i, /\b100\s?%\s*satisfaction\b/i, /\bA Happy Client\b/, /\bLorem ipsum\b/i, /\bMy Business\b/, /\bYour Company\b/i, /\bStart a conv\b/];
  const supplied = JSON.stringify([(plan && plan.stats) || [], (plan && plan.reviews) || [], (brief && brief.proof) || []]).toLowerCase();
  for (const re of FABRICATED) { const m = text.match(re); if (m && !supplied.includes(String(m[0]).toLowerCase().replace(/\s+/g, ' ').split(' ')[0])) issues.push({ id: 'fabricated', message: 'Suspicious invented claim: ' + m[0] }); }
  if (brief) {
    for (const s of brief.services.slice(0, 6)) if (!text.toLowerCase().includes(String(s.title).toLowerCase().slice(0, 12))) issues.push({ id: 'missing-service', message: 'Brief service not on page: ' + s.title });
    for (const k of ['phone', 'email']) if (brief.contact[k] && !text.includes(brief.contact[k])) issues.push({ id: 'missing-contact', message: 'Brief ' + k + ' not on page' });
    if (brief.location && brief.location.city && !text.includes(brief.location.city)) issues.push({ id: 'missing-location', message: 'Location not on page' });
  }
  const btns = [...text.matchAll(/class="btn[^"]*"[^>]*>([^<]{1,80})</g)].map((m) => m[1].trim());
  for (const b of btns) if (b.length > 26) issues.push({ id: 'long-cta', message: 'Button copy too long: ' + b });
  const score = Math.max(0, 100 - issues.length * 12);
  return { score, issues, sections: (text.match(/<section\b/g) || []).length, images: (text.match(/<img\b/g) || []).length + (text.match(/<svg\b/g) || []).length };
}

// ── 6. INTEGRATION HELPERS (keep index.js thin) ──────────────────────────────
// Legacy `detectIndustry` shape for callers/tests that only need id + label.
function nxDetectIndustry(name, desc) {
  const b = NX_BRIEF.nxUnderstandBrief({ name: name || '', description: desc || '' });
  return { id: b.industry.id, label: b.industry.label, archetype: b.industry.archetype, schema: b.industry.schema, confidence: b.industry.confidence, noun: NX_BRIEF.nxIndustryNoun(b.industry.id, false), personality: b.personality.primary };
}
const NX_INDUSTRIES = Object.freeze(Object.fromEntries((NX_BRIEF.NX_TAXONOMY || []).map((i) => [i.id, { label: i.label, archetype: i.archetype, schema: i.schema }]).concat([[NX_BRIEF.NX_GENERAL.id, { label: NX_BRIEF.NX_GENERAL.label, archetype: NX_BRIEF.NX_GENERAL.archetype, schema: NX_BRIEF.NX_GENERAL.schema }]])));
// Light or dark? Read the design's own --bg so brand hues respect the chosen mode.
function nxDesignMode(css) { const m = String(css || '').match(/--bg:\s*(#[0-9a-fA-F]{3,6})/); if (!m) return 'dark'; try { return luminance(m[1]) > 0.35 ? 'light' : 'dark'; } catch (e) { return 'dark'; } }
// What the model is allowed to work from: facts, chosen structure and copy —
// never a plan padded with invented defaults.
function nxAiContentSpec(plan) {
  const b = (plan && plan._brief) || {};
  const pickKeys = (o, keys) => { const out = {}; for (const k of keys) if (o && o[k] != null && !(Array.isArray(o[k]) && !o[k].length) && o[k] !== '') out[k] = o[k]; return out; };
  // Compact the brief for the prompt: every fact once, without the provenance
  // (`evidence`/`source`/`candidates`) that the build report keeps but the
  // model does not need. A long brief must still leave room for the RULES
  // block — the provider layer caps every message at 8,000 chars.
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) if (!['evidence', 'source', 'candidates', 'raw', 'seed', 'variant', 'version', 'coverage', 'missing', 'description', 'tone'].includes(k) && v[k] !== '' && v[k] != null && !(Array.isArray(v[k]) && !v[k].length)) o[k] = strip(v[k]); return o; }
    return v;
  };
  const facts = strip(pickKeys(b, ['name', 'industry', 'archetype', 'personality', 'audience', 'location', 'contact', 'people', 'founded', 'yearsExperience', 'services', 'products', 'prices', 'proof', 'differentiators', 'cta', 'goals', 'assumptions']));
  if (facts.industry) facts.industry = { id: facts.industry.id, label: facts.industry.label };
  if (facts.personality) facts.personality = facts.personality.primary || facts.personality;
  const copy = strip(pickKeys(plan || {}, ['hero', 'marquee', 'services', 'why', 'about', 'process', 'stats', 'reviews', 'pricing', 'team', 'timeline', 'logos', 'faq', 'contact', 'working_hours', 'cta', 'product', 'occasions', 'areas', 'gallery_imgs', 'video_url']));
  return `CONTENT PLAN (structured brief + approved copy — facts are exact, copy may be polished but not contradicted):\nBRIEF: ${JSON.stringify(facts)}\nSITEMAP (render in this order): ${JSON.stringify(((plan && plan._sitemap) || {}).sections || [])}\nCOPY: ${JSON.stringify(copy)}\nHARD RULES: never invent numbers, years, client counts, ratings, awards, certifications, reviews, team members, prices or opening hours that are not in BRIEF/COPY. If stats or reviews are empty, OMIT those sections entirely rather than inventing social proof. Keep every fact (phone, email, address, hours, services, names) exactly as given.`;
}
// The "what I understood" panel + variant/quality data returned to the app.
function nxBuildReport(plan, tokens, html) {
  const b = (plan && plan._brief) || {};
  const q = nxContentQuality(plan, html);
  return {
    summary: (plan && plan._summary) || '',
    industry: b.industry ? { id: b.industry.id, label: b.industry.label, confidence: b.industry.confidence } : null,
    personality: (plan && plan._personality) || '',
    goal: b.cta ? b.cta.intent : '',
    language: (plan && plan._language) || 'en',
    assumptions: Array.isArray(b.assumptions) ? b.assumptions : [],
    questions: Array.isArray(plan && plan._questions) ? plan._questions : [],
    warnings: Array.isArray(plan && plan._warnings) ? plan._warnings : [],
    rationale: (plan && plan._rationale) || '',
    sitemap: ((plan && plan._sitemap) || {}).sections || [],
    tokens: tokens ? { palette: tokens.palette.name, mode: tokens.palette.mode, display: tokens.fonts.display, body: tokens.fonts.body, radius: tokens.radius, contrast: tokens.checks } : null,
    variant: b.variant || 0,
    facts_used: Array.isArray(b.facts) ? b.facts.length : 0,
    coverage: b.coverage || 0,
    quality: q,
  };
}

module.exports = { nxBuildSitePlan, nxTokensFor, nxTokensCss, nxRenderSections, nxHeroArt, nxArtSvg, nxContentQuality, nxDetectIndustry, nxDesignMode, nxAiContentSpec, nxBuildReport, NX_INDUSTRIES, PALETTES, FONT_PAIRS, contrast };
