// backend/src/site/icons.js — the website builder's icon library.
//
// 120 stroke icons (24×24 grid, 2px round strokes — the Lucide/Feather visual
// language), inlined as SVG so a generated site needs ZERO external requests
// and no icon font. Every icon inherits `currentColor`, so the design tokens
// colour it; `aria-hidden` keeps decorative icons out of the accessibility
// tree while `label` makes an icon meaningful when it carries information.
//
// Three consumers:
//   • the AI page writer — told the ids and asked to emit `<i data-icon="id"></i>`
//     (never raw SVG, never emoji), which `nxExpandIcons` turns into markup;
//   • the deterministic renderer — `nxIconFor(text, industry)` picks the icon
//     that fits a service title ("Septic tanks" → droplet, "Weddings" → ring);
//   • existing content plans that carry emoji — `EMOJI_TO_ICON` upgrades them.
//
// Pure module: no I/O, no globals.

const P = (d) => `<path d="${d}"/>`;
const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const R = (x, y, w, h, rx) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"${rx ? ` rx="${rx}"` : ''}/>`;

export const NX_ICONS = Object.freeze({
  // ── universal ──
  'check': P('M20 6 9 17l-5-5'),
  'check-circle': C(12, 12, 10) + P('m9 12 2 2 4-4'),
  'badge-check': P('M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z') + P('m9 12 2 2 4-4'),
  'star': P('m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'),
  'heart': P('M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'),
  'shield': P('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'),
  'shield-check': P('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z') + P('m9 12 2 2 4-4'),
  'award': C(12, 8, 7) + P('M8.21 13.89 7 23l5-3 5 3-1.21-9.12'),
  'trophy': P('M6 9H4.5a2.5 2.5 0 0 1 0-5H6') + P('M18 9h1.5a2.5 2.5 0 0 0 0-5H18') + P('M4 22h16') + P('M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22') + P('M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22') + P('M18 2H6v7a6 6 0 0 0 12 0V2Z'),
  'crown': P('m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14'),
  'thumbs-up': P('M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3'),
  'sparkles': P('m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z') + P('M5 3v4M19 17v4M3 5h4M17 19h4'),
  'zap': P('M13 2 3 14h9l-1 8 10-12h-9l1-8z'),
  'target': C(12, 12, 10) + C(12, 12, 6) + C(12, 12, 2),
  'clock': C(12, 12, 10) + P('M12 6v6l4 2'),
  'calendar': R(3, 4, 18, 18, 2) + P('M16 2v4M8 2v4M3 10h18'),
  'calendar-check': R(3, 4, 18, 18, 2) + P('M16 2v4M8 2v4M3 10h18') + P('m9 16 2 2 4-4'),
  'watch': C(12, 12, 7) + P('M12 9v3l1.5 1.5') + P('M16.51 17.35l-.35 3.83a2 2 0 0 1-2 1.82H9.83a2 2 0 0 1-2-1.82l-.35-3.83m.01-10.7.35-3.83A2 2 0 0 1 9.83 1h4.35a2 2 0 0 1 2 1.82l.35 3.83'),
  'map-pin': P('M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z') + C(12, 10, 3),
  'map': P('m1 6 7-3 8 3 7-3v15l-7 3-8-3-7 3z') + P('M8 3v15M16 6v15'),
  'navigation': P('m3 11 19-9-9 19-2-8-8-2z'),
  'compass': C(12, 12, 10) + P('m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z'),
  'globe': C(12, 12, 10) + P('M2 12h20') + P('M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'),
  'phone': P('M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'),
  'mail': P('M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z') + P('m22 6-10 7L2 6'),
  'send': P('m22 2-7 20-4-9-9-4 20-7z') + P('M22 2 11 13'),
  'message-circle': P('M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z'),
  'message-square': P('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'),
  'bell': P('M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9') + P('M13.73 21a2 2 0 0 1-3.46 0'),
  'megaphone': P('m3 11 18-5v12L3 14v-3z') + P('M11.6 16.8a3 3 0 1 1-5.8-1.6'),
  'info': C(12, 12, 10) + P('M12 16v-4M12 8h.01'),
  'help-circle': C(12, 12, 10) + P('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3') + P('M12 17h.01'),
  'alert-triangle': P('M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z') + P('M12 9v4M12 17h.01'),
  'life-buoy': C(12, 12, 10) + C(12, 12, 4) + P('m4.93 4.93 4.24 4.24m5.66 5.66 4.24 4.24m0-14.14-4.24 4.24m-5.66 5.66-4.24 4.24'),
  'flag': P('M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z') + P('M4 22v-7'),
  'bookmark': P('m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z'),
  'quote': P('M10 11H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6a4 4 0 0 1-4 4') + P('M20 11h-4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6a4 4 0 0 1-4 4'),
  'arrow-right': P('M5 12h14M12 5l7 7-7 7'),
  'arrow-up-right': P('M7 17 17 7M7 7h10v10'),
  'plus': P('M12 5v14M5 12h14'),
  'search': C(11, 11, 8) + P('m21 21-4.35-4.35'),
  'refresh': P('M23 4v6h-6M1 20v-6h6') + P('M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15'),
  'download': P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4') + P('m7 10 5 5 5-5M12 15V3'),
  'link': P('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71') + P('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'),
  'external-link': P('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6') + P('M15 3h6v6M10 14 21 3'),
  'eye': P('M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z') + C(12, 12, 3),
  'lock': R(3, 11, 18, 11, 2) + P('M7 11V7a5 5 0 0 1 10 0v4'),
  'key': P('m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4'),
  'settings': C(12, 12, 3) + P('M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z'),
  'sliders': P('M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'),
  'layers': P('m12 2 10 5-10 5L2 7l10-5z') + P('m2 17 10 5 10-5') + P('m2 12 10 5 10-5'),
  'layout': R(3, 3, 18, 18, 2) + P('M3 9h18M9 21V9'),
  'grid': R(3, 3, 7, 7) + R(14, 3, 7, 7) + R(14, 14, 7, 7) + R(3, 14, 7, 7),
  'users': P('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2') + C(9, 7, 4) + P('M23 21v-2a4 4 0 0 0-3-3.87') + P('M16 3.13a4 4 0 0 1 0 7.75'),
  'user': P('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2') + C(12, 7, 4),
  'user-check': P('M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2') + C(8.5, 7, 4) + P('m17 11 2 2 4-4'),
  'smile': C(12, 12, 10) + P('M8 14s1.5 2 4 2 4-2 4-2') + P('M9 9h.01M15 9h.01'),
  'home': P('m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z') + P('M9 22V12h6v10'),
  'building': P('M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z') + P('M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2') + P('M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2') + P('M10 6h4M10 10h4M10 14h4M10 18h4'),
  'store': P('m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7') + P('M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8') + P('M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4') + P('M2 7h20') + P('M22 7v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7'),
  'landmark': P('M3 22h18') + P('M6 18v-7M10 18v-7M14 18v-7M18 18v-7') + P('m2 7 10-5 10 5H2z'),
  'briefcase': R(2, 7, 20, 14, 2) + P('M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16'),
  'truck': R(1, 3, 15, 13) + P('M16 8h4l3 3v5h-7V8z') + C(5.5, 18.5, 2.5) + C(18.5, 18.5, 2.5),
  'car': P('M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2') + C(7, 17, 2) + P('M9 17h6') + C(17, 17, 2),
  'plane': P('M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z'),
  'bike': C(18.5, 17.5, 3.5) + C(5.5, 17.5, 3.5) + C(15, 5, 1) + P('M12 17.5V14l-3-3 4-3 2 3h2'),
  'package': P('m16.5 9.4-9-5.19') + P('M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z') + P('M3.27 6.96 12 12.01l8.73-5.05') + P('M12 22.08V12'),
  'gift': P('M20 12v10H4V12') + P('M2 7h20v5H2z') + P('M12 22V7') + P('M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z') + P('M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z'),
  'tag': P('M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z') + P('M7 7h.01'),
  'ticket': P('M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z') + P('M13 5v2M13 17v2M13 11v2'),
  'shopping-bag': P('M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z') + P('M3 6h18') + P('M16 10a4 4 0 0 1-8 0'),
  'shopping-cart': C(9, 21, 1) + C(20, 21, 1) + P('M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6'),
  'percent': P('M19 5 5 19') + C(6.5, 6.5, 2.5) + C(17.5, 17.5, 2.5),
  // ── money & business ──
  'dollar': P('M12 1v22') + P('M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'),
  'banknote': R(2, 6, 20, 12, 2) + C(12, 12, 2) + P('M6 12h.01M18 12h.01'),
  'coins': C(8, 8, 6) + P('M18.09 10.37A6 6 0 1 1 10.34 18') + P('M7 6h1v4') + P('m16.71 13.88.7.71-2.82 2.82'),
  'credit-card': R(1, 4, 22, 16, 2) + P('M1 10h22'),
  'wallet': P('M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1') + P('M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4'),
  'piggy-bank': P('M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z') + P('M2 9v1c0 1.1.9 2 2 2h1') + P('M16 11h.01'),
  'receipt': P('M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z') + P('M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8') + P('M12 17.5v-11'),
  'calculator': R(4, 2, 16, 20, 2) + P('M8 6h8') + P('M16 14v4M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01'),
  'trending-up': P('m23 6-9.5 9.5-5-5L1 18') + P('M17 6h6v6'),
  'bar-chart': P('M12 20V10M18 20V4M6 20v-4'),
  'pie-chart': P('M21.21 15.89A10 10 0 1 1 8 2.83') + P('M22 12A10 10 0 0 0 12 2v10z'),
  'scale': P('m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z') + P('m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z') + P('M7 21h10') + P('M12 3v18') + P('M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2'),
  'gavel': P('m14 13-7.5 7.5c-.83.83-2.17.83-3 0a2.12 2.12 0 0 1 0-3L11 10') + P('m16 16 6-6') + P('m8 8 6-6') + P('m9 7 8 8') + P('m21 11-8-8'),
  'clipboard': P('M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2') + R(8, 2, 8, 4, 1),
  'file-text': P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z') + P('M14 2v6h6M16 13H8M16 17H8M10 9H8'),
  'folder': P('M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'),
  'printer': P('M6 9V2h12v7') + P('M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2') + R(6, 14, 12, 8),
  'graduation-cap': P('M22 10v6M2 10l10-5 10 5-10 5z') + P('M6 12v5c3 3 9 3 12 0v-5'),
  'book-open': P('M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z') + P('M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'),
  'lightbulb': P('M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5') + P('M9 18h6') + P('M10 22h4'),
  'rocket': P('M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z') + P('m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z') + P('M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0') + P('M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5'),
  // ── tech ──
  'monitor': R(2, 3, 20, 14, 2) + P('M8 21h8M12 17v4'),
  'laptop': P('M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16'),
  'smartphone': R(5, 2, 14, 20, 2) + P('M12 18h.01'),
  'wifi': P('M5 12.55a11 11 0 0 1 14.08 0') + P('M1.42 9a16 16 0 0 1 21.16 0') + P('M8.53 16.11a6 6 0 0 1 6.95 0') + P('M12 20h.01'),
  'cloud': P('M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z'),
  'server': R(2, 2, 20, 8, 2) + R(2, 14, 20, 8, 2) + P('M6 6h.01M6 18h.01'),
  'database': '<ellipse cx="12" cy="5" rx="9" ry="3"/>' + P('M21 12c0 1.66-4 3-9 3s-9-1.34-9-3') + P('M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5'),
  'code': P('m16 18 6-6-6-6M8 6l-6 6 6 6'),
  'terminal': P('m4 17 6-6-6-6M12 19h8'),
  'cpu': R(4, 4, 16, 16, 2) + R(9, 9, 6, 6) + P('M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3'),
  'plug': P('M12 22v-5') + P('M9 8V2') + P('M15 8V2') + P('M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z'),
  // ── creative & media ──
  'camera': P('M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z') + C(12, 13, 4),
  'image': R(3, 3, 18, 18, 2) + C(8.5, 8.5, 1.5) + P('m21 15-5-5L5 21'),
  'video': P('m23 7-7 5 7 5V7z') + R(1, 5, 15, 14, 2),
  'film': R(2, 2, 20, 20, 2.18) + P('M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5'),
  'aperture': C(12, 12, 10) + P('m14.31 8 5.74 9.94M9.69 8h11.48M7.38 12l5.74-9.94M9.69 16 3.95 6.06M14.31 16H2.83M16.62 12l-5.74 9.94'),
  'play': P('m5 3 14 9-14 9V3z'),
  'mic': P('M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z') + P('M19 10v2a7 7 0 0 1-14 0v-2') + P('M12 19v4M8 23h8'),
  'music': P('M9 18V5l12-2v13') + C(6, 18, 3) + C(18, 16, 3),
  'headphones': P('M3 18v-6a9 9 0 0 1 18 0v6') + P('M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z'),
  'gamepad': P('M6 12h4M8 10v4M15 13h.01M18 11h.01') + P('M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z'),
  'pen': P('M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z'),
  'pen-tool': P('m12 19 7-7 3 3-7 7-3-3z') + P('m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z') + P('m2 2 7.586 7.586') + C(11, 11, 2),
  'paintbrush': P('M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z') + P('M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7') + P('M14.5 17.5 4.5 15'),
  'palette': C(13.5, 6.5, .5) + C(17.5, 10.5, .5) + C(8.5, 7.5, .5) + C(6.5, 12.5, .5) + P('M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z'),
  'brush': P('m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08') + P('M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z'),
  'wand': P('m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z') + P('m14 7 3 3') + P('M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9'),
  'ruler': P('M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z') + P('m14.5 12.5 2-2') + P('m11.5 9.5 2-2') + P('m8.5 6.5 2-2') + P('m17.5 15.5 2-2'),
  'feather': P('M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z') + P('M16 8 2 22M17.5 15H9'),
  'party-popper': P('M5.8 11.3 2 22l10.7-3.79') + P('M4 3h.01M22 8h.01M15 2h.01M22 20h.01') + P('m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10') + P('m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11-.11.7-.72 1.22-1.43 1.22H17') + P('m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7') + P('M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z'),
  'gem': P('M6 3h12l4 6-10 13L2 9Z') + P('M11 3 8 9l4 13 4-13-3-6') + P('M2 9h20'),
  'ring': C(12, 14, 6) + P('m9 5 3-3 3 3-3 3z'),
  'shirt': P('M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z'),
  'scissors': C(6, 6, 3) + C(6, 18, 3) + P('M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12'),
  // ── food & hospitality ──
  'coffee': P('M18 8h1a4 4 0 0 1 0 8h-1') + P('M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z') + P('M6 1v3M10 1v3M14 1v3'),
  'utensils': P('M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2') + P('M7 2v20') + P('M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7'),
  'chef-hat': P('M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z') + P('M6 17h12'),
  'cake': P('M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8') + P('M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1') + P('M2 21h20') + P('M7 8v3M12 8v3M17 8v3') + P('M7 4h.01M12 4h.01M17 4h.01'),
  'wine': P('M8 22h8') + P('M7 10h10') + P('M12 15v7') + P('M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z'),
  'apple': P('M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z') + P('M10 2c1 .5 2 2 2 5'),
  'bed': P('M2 4v16') + P('M2 8h18a2 2 0 0 1 2 2v10') + P('M2 17h20') + P('M6 8v9'),
  'bath': P('M9 6 6.5 3.5a1.5 1.5 0 0 0-1-.5C4.683 3 4 3.683 4 4.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5') + P('M10 5 8 7') + P('M2 12h20') + P('M7 19v2M17 19v2'),
  'armchair': P('M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3') + P('M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0Z') + P('M5 18v2M19 18v2'),
  'umbrella': P('M23 12a11.05 11.05 0 0 0-22 0zm-5 7a3 3 0 0 1-6 0v-7'),
  'mountain': P('m8 3 4 8 5-5 5 15H2L8 3z'),
  'anchor': C(12, 5, 3) + P('M12 22V8M5 12H2a10 10 0 0 0 20 0h-3'),
  // ── health & care ──
  'activity': P('M22 12h-4l-3 9L9 3l-3 9H2'),
  'heart-pulse': P('M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z') + P('M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27'),
  'stethoscope': P('M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3') + P('M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4') + C(20, 10, 2),
  'pill': P('m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z') + P('m8.5 8.5 7 7'),
  'tooth': P('M12 5.5c-1.5-1.2-3.4-1.8-5-1a4.2 4.2 0 0 0-2 4.8c.5 1.8 1.4 3.2 1.8 5 .5 2.3.5 5.7 2.2 5.7 1.4 0 1.6-3.3 3-3.3s1.6 3.3 3 3.3c1.7 0 1.7-3.4 2.2-5.7.4-1.8 1.3-3.2 1.8-5a4.2 4.2 0 0 0-2-4.8c-1.6-.8-3.5-.2-5 1z'),
  'paw': C(7.5, 8, 1.8) + C(11, 5, 1.8) + C(15.5, 6, 1.8) + C(18.5, 10, 1.8) + P('M12.5 10.5c-2.6 0-5.5 2.6-5.5 5.2 0 1.6 1.2 2.8 2.8 2.8 1 0 1.7-.6 2.7-.6s1.7.6 2.7.6c1.6 0 2.8-1.2 2.8-2.8 0-2.6-2.9-5.2-5.5-5.2z'),
  'dumbbell': P('m6.5 6.5 11 11') + P('m21 21-1-1') + P('m3 3 1 1') + P('m18 22 4-4') + P('m2 6 4-4') + P('m3 10 7-7') + P('m14 21 7-7'),
  'leaf': P('M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z') + P('M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12'),
  'sprout': P('M7 20h10') + P('M10 20c5.5-2.5.8-6.4 3-10') + P('M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z') + P('M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z'),
  'flower': C(12, 6, 3) + C(12, 18, 3) + C(6, 12, 3) + C(18, 12, 3) + C(12, 12, 2.5),
  'sun': C(12, 12, 5) + P('M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42'),
  'sunrise': P('M17 18a5 5 0 0 0-10 0') + P('M12 2v7') + P('M4.22 10.22l1.42 1.42M1 18h2M21 18h2M18.36 11.64l1.42-1.42M23 22H1M8 6l4-4 4 4'),
  'moon': P('M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'),
  'droplet': P('M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z'),
  'thermometer': P('M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z'),
  'wind': P('M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2'),
  'snowflake': P('M2 12h20') + P('M12 2v20') + P('m20 16-4-4 4-4') + P('m4 8 4 4-4 4') + P('m16 4-4 4-4-4') + P('m8 20 4-4 4 4'),
  'flame': P('M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z'),
  // ── trades ──
  'wrench': P('M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'),
  'hammer': P('m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9') + P('m18 15 4-4') + P('m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5'),
  'hard-hat': P('M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2z') + P('M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5') + P('M4 15v-3a6 6 0 0 1 6-6') + P('M14 6a6 6 0 0 1 6 6v3'),
  'bug': P('m8 2 1.88 1.88M14.12 3.88 16 2') + P('M9 7.13v-1a3.003 3.003 0 1 1 6 0v1') + P('M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6') + P('M12 20v-9') + P('M6.53 9C4.6 8.8 3 7.1 3 5') + P('M6 13H2') + P('M3 21c0-2.1 1.7-3.9 3.8-4') + P('M20.97 5c0 2.1-1.6 3.8-3.5 4') + P('M22 13h-4') + P('M17.2 17c2.1.1 3.8 1.9 3.8 4'),
});

export const NX_ICON_IDS = Object.freeze(Object.keys(NX_ICONS));
const ICON_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;

// Render one icon. `label` turns a decorative icon into an informative one
// (role="img" + <title>), otherwise it is hidden from assistive tech.
export function nxIcon(id, opts) {
  opts = opts || {};
  const key = String(id || '').toLowerCase().trim();
  const inner = NX_ICONS[key];
  if (!inner) return '';
  const size = opts.size ? ` width="${parseInt(opts.size, 10) || 24}" height="${parseInt(opts.size, 10) || 24}"` : '';
  const cls = ' class="nx-i' + (opts.cls ? ' ' + String(opts.cls).replace(/[^a-zA-Z0-9 _-]/g, '') : '') + '"';
  const label = opts.label ? String(opts.label).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])).slice(0, 80) : '';
  const a11y = label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true" focusable="false"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${size}${cls} data-nx-icon="${key}"${a11y}>${label ? `<title>${label}</title>` : ''}${inner}</svg>`;
}

// Keyword → icon. Ordered: the first match wins, so specific words come before
// generic ones ("emergency plumbing" → alert-triangle beats droplet).
const KEYWORDS = [
  // urgency / speed
  [/emergenc|urgent|24\s*\/\s*7|24[- ]hour|call[- ]?outs?\b|breakdown/i, 'alert-triangle'],
  [/same[- ]day|next[- ]day|\bexpress\b|fast turnaround/i, 'zap'],
  // occasions / retail
  [/wedding|bridal|\bbrides?\b|engagement/i, 'ring'],
  [/birthday|\bpart(y|ies)\b|celebrat|\bevents?\b|festival/i, 'party-popper'],
  [/\bgifts?\b|voucher|hamper/i, 'gift'],
  [/deliver|shipping|courier|removals?\b|\bmoving\b|\bvans?\b/i, 'truck'],
  [/subscri|recurring|monthly plan|membership/i, 'refresh'],
  // health
  [/\btooth|\bteeth|dental|whitening|implants?\b|orthodont|braces|hygienist/i, 'tooth'],
  [/\bdoctors?\b|\bclinic|medical|\bgp\b|check-?ups?\b|diagnos/i, 'stethoscope'],
  [/pharmac|prescription|medicine|\btablets?\b|\bpills?\b|vaccin/i, 'pill'],
  [/\bheart\b|cardio|\bblood\b|\bpulse\b|\bhealth/i, 'heart-pulse'],
  [/physio|rehab|injur|posture|mobility|massage|therap/i, 'activity'],
  [/\bvets?\b|veterinar|\bpets?\b|\bdogs?\b|\bcats?\b|pupp(y|ies)|kitten|animal|\bgroom/i, 'paw'],
  [/\bgym\b|fitness|strength|weight ?loss|\bworkouts?\b|personal train|crossfit/i, 'dumbbell'],
  [/\byoga\b|pilates|meditat|mindful|breathwork|\bcalm\b|wellness|retreat/i, 'sprout'],
  [/nutrition|\bdiet|meal plan|healthy eating|\bfruit|organic/i, 'apple'],
  // beauty
  [/\bhair|haircut|\bcuts?\b|blow[- ]?dry|colouring|coloring|highlights|barber|\bbeard|\bshave|\btrims?\b/i, 'scissors'],
  [/\bnails?\b|manicure|pedicure|\blash(es)?\b|\bbrows?\b|make-?up|facials?\b|\bskin|\bbeauty|\bspas?\b/i, 'sparkles'],
  [/tattoo|piercing|\bink\b/i, 'pen-tool'],
  // food & hospitality
  [/coffee|espresso|\blatte|caf[eé]\b|barista|\btea\b/i, 'coffee'],
  [/\bbread|sourdough|pastr|croissant|\bbak(e|ed|ing|ery)\b|\boven/i, 'chef-hat'],
  [/\bcakes?\b|dessert|\bsweets?\b|cupcake/i, 'cake'],
  [/\bmenu|\bdinner|\blunch|\bbrunch|\bdish(es)?\b|cuisine|restaurant|\bdining|catering|\bchef|\bfood/i, 'utensils'],
  [/\bwines?\b|cocktail|\bbar\b|\bdrinks\b|\bbeers?\b|\bbrew/i, 'wine'],
  [/\bhotel|\brooms?\b|\bstays?\b|\bsuites?\b|accommodation|\bguests?\b|\bbed(s|rooms?)?\b|\bsleep/i, 'bed'],
  [/\bbath|\bshower|\btoilet|sanitary|wet ?room/i, 'bath'],
  // trades
  [/\bplumb|\bpipes?\b|\bleaks?\b|\bdrain|septic|soakaway|\bsewer|\bwater\b|\btaps?\b|\bboiler/i, 'droplet'],
  [/\bheat(ing|er|ers)?\b|furnace|radiator|\bhvac\b|thermostat|underfloor/i, 'thermometer'],
  [/air ?con|\bcooling|ventilat|refrigerat|\bfridge|\bfreez|\bchill/i, 'snowflake'],
  [/electric|\bwiring|rewire|\bfuse ?box|\bsockets?\b|\blighting|ev charg|\bsolar/i, 'zap'],
  [/\broof|\bgutter|\bslates?\b|\btiles?\b|\btiling|chimney|fascia/i, 'home'],
  [/\bbuild(ing|er|ers)?\b|construct|extension|renovat|remodel|\bloft|\bbrick|concrete|foundation/i, 'hard-hat'],
  [/kitchen fit|carpent|joiner|cabinet|furniture|\bwood|timber|decking|\bfenc/i, 'hammer'],
  [/\bgarden|landscap|\blawns?\b|\bhedge|\btrees?\b|planting|\bpatio|\bturf/i, 'leaf'],
  [/\bflowers?\b|floral|bouquet|arrangement|florist|\bblooms?\b/i, 'flower'],
  [/\bclean|end of tenancy|\bcarpets?\b|window clean|housekeep|laundry/i, 'sparkles'],
  [/\bpests?\b|\brodent|\brats?\b|\bmice\b|\bwasps?\b|bed ?bugs?|termite|\binsects?\b|fumigat/i, 'bug'],
  [/\block(s|smith|ing)?\b|\bkeys?\b|\balarms?\b|\bcctv\b|security|\bguard|surveillance|access control/i, 'lock'],
  [/\bmot\b|\bcars?\b|vehicle|\bauto\b|automotive|\bgarage|\btyres?\b|\btires?\b|\bbrakes?\b|\bengines?\b|servicing/i, 'car'],
  [/\brepairs?\b|\bfix(es|ing)?\b|mainten|service call|\binstall|\bfitting/i, 'wrench'],
  // creative & tech
  [/\bphoto|portrait|headshot|\bshoots?\b|photograph/i, 'camera'],
  [/\bvideo|\bfilms?\b|cinemat|\bdrone|\bediting\b|\breels?\b|youtube/i, 'video'],
  [/\bbrand|\blogo|identity|graphic|illustrat|print design/i, 'palette'],
  [/web ?design|website|landing page|\bui\b|\bux\b|app design|figma/i, 'layout'],
  [/interior|architect|\bplans?\b|\bdrawings?\b|blueprint|\bsurvey|extension design/i, 'ruler'],
  [/\bpaint|decorat|wallpaper|plaster|\brender/i, 'paintbrush'],
  [/marketing|campaign|\bads?\b|advertis|\bseo\b|social media|\bcontent\b/i, 'megaphone'],
  [/\bmusic|\bband\b|\bdj\b|guitar|piano|\brecording|\bmixing|\bmaster(ing)?\b/i, 'music'],
  [/podcast|voice ?over|\bmic\b|microphone|\baudio|\bsound/i, 'mic'],
  [/\bgames?\b|gaming|esports|streaming/i, 'gamepad'],
  [/\bapis?\b|integration|webhook|\bconnectors?\b|\bplugins?\b/i, 'plug'],
  [/automat|workflow|pipeline/i, 'settings'],
  [/dashboard|analytic|\breports?\b|reporting|\bkpis?\b|\bmetrics?\b|insight/i, 'bar-chart'],
  [/software|\bsaas\b|platform|\bcloud|hosting|\bapp\b|\bapps\b|mobile app/i, 'cloud'],
  [/it support|helpdesk|\bnetwork|\bservers?\b|\bbackups?\b|\bcyber|\bdata\b|computer|laptop/i, 'server'],
  [/\bdevelop|\bcoding|engineer|programming/i, 'code'],
  [/\bsupport\b|help ?desk|\bassistance/i, 'life-buoy'],
  // professional
  [/\blaw\b|\blegal|solicitor|attorney|\bcourt\b|litigation|\bcontracts?\b|\bwills?\b|probate|\bdisputes?\b|conveyanc/i, 'scale'],
  [/\btax|\bvat\b|payroll|bookkeep|accountan|accounting|\baudit|self[- ]assess/i, 'calculator'],
  [/mortgage|\bloans?\b|financ|\binvest(ment|ments|or|ors|ing)?\b|pension|wealth|savings?\b|\bfunds?\b/i, 'piggy-bank'],
  [/insur|\bcover(age)?\b|\bprotect|warrant(y|ies)|guarantee/i, 'shield-check'],
  [/propert(y|ies)|\bestate|letting|\brent(al|als|ing)?\b|\bsales?\b|valuation|landlord|tenant|home buy|\bhous(e|es|ing)\b/i, 'home'],
  [/\bshops?\b|\bstores?\b|\bretail|\bproducts?\b|catalog|order online|e-?commerce|checkout/i, 'shopping-bag'],
  [/grocer|\bfresh\b|\bmarket\b|\bproduce\b|\bfarm|butcher|\bdeli\b|delicatessen/i, 'apple'],
  [/\bschool|\btutor|\bteach|\blessons?\b|\bclass(es)?\b|\bcourses?\b|\blearn|\bexams?\b|student|educat|workshop/i, 'graduation-cap'],
  [/\bkids?\b|\bchild|nursery|\bfamil(y|ies)\b|\bbab(y|ies)\b|toddler/i, 'smile'],
  [/charit|donat|volunteer|community|fundrais|non-?profit/i, 'heart'],
  [/\btravel|\btours?\b|\btrips?\b|holiday|excursion|\bguided?\b|safari|cruise|\bflights?\b/i, 'plane'],
  [/\bhik(e|es|ing)\b|\btrek|mountain|adventure|\bcamp(s|ing|site)?\b/i, 'mountain'],
  // generic intents (last)
  [/\bbook(ing|ings)?\b|appointment|schedule|reserv|\bslots?\b|calendar/i, 'calendar-check'],
  [/\bhours\b|\bopen(ing)?\b|\btimes?\b|\bfast\b|\bquick|\brapid|\bminutes?\b/i, 'clock'],
  [/location|\blocal\b|\bareas?\b|\bnear|\bvisit|address|\bmaps?\b|directions/i, 'map-pin'],
  [/\bteam\b|\bstaff\b|\bpeople\b|\bexperts?\b|specialist|\bcrew\b/i, 'users'],
  [/\bprices?\b|pricing|\bquotes?\b|estimate|\bcosts?\b|budget|afford|\bpay/i, 'receipt'],
  [/\bawards?\b|certif|accredit|licen[sc]|qualif|approved|winner/i, 'award'],
  [/\breviews?\b|\brating|testimonial|trusted|reputation|recommend/i, 'star'],
  [/\bsafe|\bsecure|\btrust|privacy|compliance/i, 'shield'],
  [/\beco\b|eco-|\bgreen\b|sustainab|recycl|environment|\bnatural/i, 'leaf'],
  [/\bideas?\b|creative|innovat|strateg|advice|advis|consult|\bplanning\b/i, 'lightbulb'],
  [/launch|\bstart(up|ups)?\b|\bgrow(th)?\b|\bboost|accelerat/i, 'rocket'],
  [/\btalk|\bchat|message|contact|\breply|question|\bfaq/i, 'message-circle'],
  [/\bemail|newsletter|\binbox/i, 'mail'],
  [/\bcalls?\b|\bphone|ring us/i, 'phone'],
  [/document|paperwork|\bforms?\b|invoice/i, 'file-text'],
  [/\bresults?\b|measur|\btrack|performance/i, 'trending-up'],
];

// Icon families per industry — used when a title matches nothing above, so a
// plumber's fourth card still gets a plumbing icon rather than a generic star.
export const INDUSTRY_ICONS = Object.freeze({
  florist: ['flower', 'ring', 'truck', 'gift', 'leaf'], bakery: ['chef-hat', 'cake', 'coffee', 'sunrise', 'gift'], cafe: ['coffee', 'utensils', 'cake', 'wifi', 'sunrise'],
  restaurant: ['utensils', 'wine', 'chef-hat', 'calendar-check', 'users'], bar: ['wine', 'music', 'party-popper', 'calendar', 'users'], hotel: ['bed', 'bath', 'coffee', 'wifi', 'map-pin'], catering: ['utensils', 'chef-hat', 'party-popper', 'truck', 'users'],
  dental: ['tooth', 'sparkles', 'shield-check', 'calendar-check', 'smile'], medical: ['stethoscope', 'heart-pulse', 'pill', 'calendar-check', 'shield-check'], physio: ['activity', 'heart-pulse', 'dumbbell', 'calendar-check', 'users'], vet: ['paw', 'stethoscope', 'heart', 'pill', 'shield-check'], pharmacy: ['pill', 'stethoscope', 'clock', 'truck', 'shield-check'], therapy: ['heart', 'message-circle', 'sprout', 'calendar-check', 'lock'],
  plumbing: ['droplet', 'wrench', 'thermometer', 'bath', 'alert-triangle'], electrician: ['zap', 'plug', 'lightbulb', 'shield-check', 'alert-triangle'], hvac: ['thermometer', 'snowflake', 'wind', 'wrench', 'calendar-check'], roofing: ['home', 'hard-hat', 'umbrella', 'shield-check', 'hammer'], construction: ['hard-hat', 'hammer', 'ruler', 'building', 'clipboard'], landscaping: ['leaf', 'sprout', 'flower', 'sun', 'ruler'], cleaning: ['sparkles', 'home', 'droplet', 'calendar-check', 'shield-check'], pest: ['bug', 'shield-check', 'home', 'search', 'alert-triangle'], moving: ['truck', 'package', 'home', 'calendar-check', 'shield-check'], auto: ['car', 'wrench', 'settings', 'clipboard', 'clock'], security: ['lock', 'shield', 'camera', 'key', 'bell'],
  salon: ['scissors', 'sparkles', 'palette', 'calendar-check', 'star'], barber: ['scissors', 'user', 'clock', 'calendar-check', 'star'], spa: ['sparkles', 'flower', 'droplet', 'sprout', 'heart'], tattoo: ['pen-tool', 'palette', 'shield-check', 'image', 'calendar-check'],
  fitness: ['dumbbell', 'activity', 'target', 'users', 'calendar'], yoga: ['sprout', 'sun', 'heart', 'users', 'calendar'], nutrition: ['apple', 'heart-pulse', 'clipboard', 'message-circle', 'target'],
  photography: ['camera', 'aperture', 'image', 'ring', 'film'], design: ['palette', 'pen-tool', 'layout', 'layers', 'sparkles'], marketing: ['megaphone', 'trending-up', 'target', 'bar-chart', 'rocket'], architecture: ['ruler', 'building', 'layout', 'armchair', 'compass'],
  music: ['music', 'mic', 'headphones', 'calendar', 'users'], games: ['gamepad', 'cpu', 'trophy', 'users', 'zap'], events: ['party-popper', 'ring', 'calendar-check', 'music', 'users'],
  law: ['scale', 'gavel', 'file-text', 'shield', 'briefcase'], accounting: ['calculator', 'receipt', 'pie-chart', 'file-text', 'shield-check'], consulting: ['lightbulb', 'trending-up', 'target', 'users', 'briefcase'], finance: ['piggy-bank', 'trending-up', 'shield-check', 'wallet', 'banknote'], realestate: ['home', 'key', 'building', 'map-pin', 'receipt'],
  saas: ['cloud', 'zap', 'lock', 'bar-chart', 'code'], itservices: ['server', 'shield', 'wifi', 'laptop', 'life-buoy'], ecommerce: ['shopping-bag', 'truck', 'credit-card', 'refresh', 'star'], grocery: ['apple', 'shopping-cart', 'truck', 'leaf', 'clock'],
  school: ['graduation-cap', 'book-open', 'users', 'award', 'calendar'], nonprofit: ['heart', 'users', 'globe', 'gift', 'megaphone'], travel: ['plane', 'map', 'compass', 'mountain', 'bed'], portfolio: ['pen-tool', 'briefcase', 'award', 'mail', 'link'],
  general: ['check-circle', 'users', 'clock', 'shield-check', 'star'],
});

// Emoji that older content plans (and the scanner) carry → icon ids.
export const EMOJI_TO_ICON = Object.freeze({
  '💐': 'flower', '🌸': 'flower', '🌷': 'flower', '💍': 'ring', '🚚': 'truck', '🚛': 'truck', '🚜': 'truck', '🔧': 'wrench', '🛠️': 'hammer', '🛠': 'hammer', '🔨': 'hammer', '🚨': 'alert-triangle', '⚠️': 'alert-triangle',
  '✨': 'sparkles', '⭐': 'star', '🌟': 'star', '📹': 'video', '🎥': 'video', '🎬': 'film', '📸': 'camera', '📷': 'camera', '☕': 'coffee', '🎂': 'cake', '🍰': 'cake', '🥖': 'chef-hat', '🥐': 'chef-hat', '🍞': 'chef-hat', '👨‍🍳': 'chef-hat', '🍽️': 'utensils', '🍴': 'utensils', '🍷': 'wine', '🍸': 'wine', '🍺': 'wine',
  '🌿': 'leaf', '🍃': 'leaf', '🌱': 'sprout', '🌳': 'leaf', '🏠': 'home', '🏡': 'home', '🏢': 'building', '🏪': 'store', '🏨': 'bed', '🛏️': 'bed', '🛁': 'bath', '🚿': 'bath', '📞': 'phone', '☎️': 'phone', '✉️': 'mail', '📧': 'mail', '📩': 'send', '💬': 'message-circle', '🗨️': 'message-square',
  '💡': 'lightbulb', '🔒': 'lock', '🔑': 'key', '🛡️': 'shield', '💳': 'credit-card', '💰': 'banknote', '💵': 'banknote', '🪙': 'coins', '👛': 'wallet', '🐷': 'piggy-bank', '🧾': 'receipt', '🧮': 'calculator', '📈': 'trending-up', '📊': 'bar-chart', '🎯': 'target',
  '🧘': 'sprout', '🧘‍♀️': 'sprout', '🧘‍♂️': 'sprout', '💪': 'dumbbell', '🏋️': 'dumbbell', '🏋️‍♀️': 'dumbbell', '🚗': 'car', '🚙': 'car', '🐾': 'paw', '🐶': 'paw', '🐱': 'paw', '🦷': 'tooth', '🪥': 'tooth', '🩺': 'stethoscope', '🏥': 'stethoscope', '💊': 'pill', '🩹': 'pill', '❤️': 'heart', '💚': 'heart', '💙': 'heart', '🫀': 'heart-pulse', '🚑': 'heart-pulse',
  '🎵': 'music', '🎶': 'music', '🎸': 'music', '🎹': 'music', '🎤': 'mic', '🎧': 'headphones', '🎮': 'gamepad', '🕹️': 'gamepad', '✈️': 'plane', '🗺️': 'map', '📍': 'map-pin', '🧭': 'compass', '⛰️': 'mountain', '🏔️': 'mountain', '⚓': 'anchor', '☂️': 'umbrella',
  '⚖️': 'scale', '🔨⚖️': 'gavel', '🧹': 'sparkles', '🧼': 'droplet', '🧴': 'droplet', '💧': 'droplet', '🌡️': 'thermometer', '❄️': 'snowflake', '🔥': 'flame', '💨': 'wind', '⚡': 'zap', '🔌': 'plug', '☀️': 'sun', '🌅': 'sunrise', '🌙': 'moon',
  '🐛': 'bug', '🪲': 'bug', '🐜': 'bug', '🎓': 'graduation-cap', '📚': 'book-open', '📖': 'book-open', '✏️': 'pen', '🖊️': 'pen', '🖋️': 'pen-tool', '🎨': 'palette', '🖌️': 'brush', '📐': 'ruler', '📏': 'ruler', '💻': 'laptop', '🖥️': 'monitor', '📱': 'smartphone', '☁️': 'cloud', '🖨️': 'printer', '📦': 'package', '🎁': 'gift', '🏷️': 'tag', '🛒': 'shopping-cart', '🛍️': 'shopping-bag', '🎟️': 'ticket', '🎫': 'ticket', '🎉': 'party-popper', '🎊': 'party-popper', '👑': 'crown', '🏆': 'trophy', '🥇': 'award', '🏅': 'award', '💎': 'gem', '✂️': 'scissors', '👔': 'shirt', '👕': 'shirt',
  '🧠': 'lightbulb', '👥': 'users', '👤': 'user', '👩‍⚕️': 'stethoscope', '👨‍⚕️': 'stethoscope', '👩‍🏫': 'graduation-cap', '👨‍🔧': 'wrench', '👷': 'hard-hat', '✔': 'check', '✔️': 'check', '✅': 'check-circle', '☑️': 'check-circle', '🕐': 'clock', '⏰': 'clock', '⏱️': 'clock', '📅': 'calendar', '🗓️': 'calendar-check', '🔍': 'search', '🔎': 'search', '🔄': 'refresh', '🔗': 'link', '🚀': 'rocket', '📣': 'megaphone', '📢': 'megaphone', '🔔': 'bell', '🚩': 'flag', 'ℹ️': 'info', '❓': 'help-circle', '🛟': 'life-buoy', '📋': 'clipboard', '📄': 'file-text', '📁': 'folder', '⌚': 'watch', '🍎': 'apple', '🥗': 'apple', '🏛️': 'landmark', '🎪': 'party-popper', '👍': 'thumbs-up', '😊': 'smile', '🙂': 'smile', '🌍': 'globe', '🌐': 'globe', '💼': 'briefcase', '🪑': 'armchair', '🛋️': 'armchair', '🚲': 'bike', '🖼️': 'image', '▶️': 'play', '🎞️': 'film',
});

// Best icon for a piece of text (service title, feature, bullet). Emoji in the
// text are honoured first, then keywords, then the industry family (rotated by
// `index` so sibling cards never repeat), then a neutral default.
// Ordered candidates: every keyword hit (words beat glyphs — "🛠️ Septic
// tanks" is a plumbing job, not a hammer), then emoji, then the industry
// family rotated by `index`, then the neutral family.
export function nxIconCandidates(text, industry, index) {
  const t = String(text || '');
  const out = [];
  for (const [re, id] of KEYWORDS) if (re.test(t) && !out.includes(id)) out.push(id);
  for (const [emo, id] of Object.entries(EMOJI_TO_ICON)) if (t.includes(emo) && !out.includes(id)) out.push(id);
  const fam = INDUSTRY_ICONS[String(industry || '').toLowerCase()] || INDUSTRY_ICONS.general;
  const start = Math.abs(parseInt(index, 10) || 0) % fam.length;
  for (let i = 0; fam.length > i; i++) { const id = fam[(start + i) % fam.length]; if (!out.includes(id)) out.push(id); }
  for (const id of INDUSTRY_ICONS.general) if (!out.includes(id)) out.push(id);
  return out;
}
// `used` (optional Set) makes sibling cards distinct: the first candidate not
// already used in this grid wins, and is recorded.
export function nxIconFor(text, industry, index, used) {
  const cands = nxIconCandidates(text, industry, index);
  let pick = cands[0];
  if (used && typeof used.has === 'function') { pick = cands.find((id) => !used.has(id)) || cands[0]; used.add(pick); }
  return pick;
}

// Resolve any id-ish string (icon id, emoji, or free text) to a real icon id.
export function nxResolveIconId(raw, industry, index) {
  const s = String(raw || '').trim();
  if (!s) return nxIconFor('', industry, index);
  const low = s.toLowerCase();
  if (NX_ICONS[low]) return low;
  if (EMOJI_TO_ICON[s]) return EMOJI_TO_ICON[s];
  // tolerate synonyms / near misses the model may produce
  const alias = { tool: 'wrench', tools: 'wrench', spanner: 'wrench', tick: 'check', checkmark: 'check', verified: 'badge-check', location: 'map-pin', pin: 'map-pin', chat: 'message-circle', email: 'mail', telephone: 'phone', people: 'users', team: 'users', person: 'user', money: 'banknote', cash: 'banknote', card: 'credit-card', chart: 'bar-chart', graph: 'trending-up', growth: 'trending-up', lightning: 'zap', bolt: 'zap', power: 'zap', fire: 'flame', water: 'droplet', drop: 'droplet', dentist: 'tooth', doctor: 'stethoscope', medicine: 'pill', dog: 'paw', cat: 'paw', pet: 'paw', gym: 'dumbbell', weights: 'dumbbell', plant: 'sprout', garden: 'leaf', tree: 'leaf', restaurant: 'utensils', food: 'utensils', cafe: 'coffee', beer: 'wine', cocktail: 'wine', hotel: 'bed', house: 'home', building2: 'building', office: 'building', shop: 'store', cart: 'shopping-cart', bag: 'shopping-bag', delivery: 'truck', shipping: 'truck', vehicle: 'car', photo: 'camera', picture: 'image', movie: 'film', design: 'palette', paint: 'paintbrush', measure: 'ruler', law: 'scale', justice: 'scale', legal: 'gavel', tax: 'calculator', savings: 'piggy-bank', bank: 'landmark', secure: 'lock', security: 'shield', safe: 'shield-check', idea: 'lightbulb', launch: 'rocket', announce: 'megaphone', time: 'clock', schedule: 'calendar-check', booking: 'calendar-check', book: 'book-open', education: 'graduation-cap', school: 'graduation-cap', student: 'graduation-cap', celebration: 'party-popper', event: 'party-popper', wedding: 'ring', diamond: 'gem', quality: 'award', trophy: 'trophy', badge: 'badge-check', smiley: 'smile', happy: 'smile', support: 'life-buoy', help: 'help-circle', info: 'info', warning: 'alert-triangle', globe: 'globe', world: 'globe', web: 'globe', wifi: 'wifi', internet: 'wifi', server: 'server', hosting: 'server', code: 'code', developer: 'code', computer: 'laptop', phone2: 'smartphone', mobile: 'smartphone', sound: 'mic', audio: 'headphones', game: 'gamepad', flower2: 'flower', clean: 'sparkles', magic: 'wand', star2: 'star', heart2: 'heart', calendar2: 'calendar', clock2: 'clock', cog: 'settings', gear: 'settings', wrench2: 'wrench', umbrella2: 'umbrella', sun2: 'sun', snow: 'snowflake', cold: 'snowflake', hot: 'flame', heating: 'thermometer', temperature: 'thermometer', wind2: 'wind', air: 'wind', electric: 'zap', electricity: 'zap', plug2: 'plug', pest: 'bug', insect: 'bug', roof: 'home', construction: 'hard-hat', builder: 'hard-hat', hammer2: 'hammer', scissors2: 'scissors', hair: 'scissors', barber: 'scissors', beauty: 'sparkles', spa: 'flower', yoga: 'sprout', nutrition: 'apple', fruit: 'apple', vet: 'paw', receipt2: 'receipt', invoice: 'receipt', price: 'receipt', quote: 'quote', testimonial: 'quote', review: 'star', map2: 'map', route: 'navigation', travel: 'plane', flight: 'plane', trip: 'map', mountain2: 'mountain', hike: 'mountain', anchor2: 'anchor', boat: 'anchor', ticket2: 'ticket', gift2: 'gift', percent2: 'percent', discount: 'percent', offer: 'tag', sale: 'tag', dollar2: 'dollar', coin: 'coins', wallet2: 'wallet', target2: 'target', goal: 'target', layers2: 'layers', layout2: 'layout', grid2: 'grid', settings2: 'sliders', filter: 'sliders', search2: 'search', find: 'search', link2: 'link', share: 'external-link', arrow: 'arrow-right', next: 'arrow-right', add: 'plus', user2: 'user', usercheck: 'user-check', client: 'user-check', eye2: 'eye', view: 'eye', key2: 'key', lock2: 'lock', bell2: 'bell', notify: 'bell', flag2: 'flag', bookmark2: 'bookmark', file: 'file-text', document: 'file-text', folder2: 'folder', print: 'printer', clipboard2: 'clipboard', checklist: 'clipboard', crown2: 'crown', premium: 'crown', award2: 'award', certified: 'badge-check', cake2: 'cake', bakery: 'chef-hat', bread: 'chef-hat', wine2: 'wine', coffee2: 'coffee', bed2: 'bed', bath2: 'bath', sofa: 'armchair', chair: 'armchair', interior: 'armchair', ruler2: 'ruler', pen2: 'pen', write: 'pen', brush2: 'brush', palette2: 'palette', camera2: 'camera', video2: 'video', film2: 'film', aperture2: 'aperture', play2: 'play', music2: 'music', mic2: 'mic', headphones2: 'headphones', gamepad2: 'gamepad', code2: 'code', terminal2: 'terminal', cpu2: 'cpu', database2: 'database', cloud2: 'cloud', monitor2: 'monitor', laptop2: 'laptop', smartphone2: 'smartphone', rocket2: 'rocket', lightbulb2: 'lightbulb', megaphone2: 'megaphone', send2: 'send', mail2: 'mail', message: 'message-circle', comment: 'message-square', info2: 'info', question: 'help-circle', alert: 'alert-triangle', danger: 'alert-triangle', lifebuoy: 'life-buoy', rescue: 'life-buoy', thumbsup: 'thumbs-up', like: 'thumbs-up', smile2: 'smile', users2: 'users', home2: 'home', building3: 'building', store2: 'store', landmark2: 'landmark', briefcase2: 'briefcase', truck2: 'truck', car2: 'car', plane2: 'plane', bike2: 'bike', cycling: 'bike', package2: 'package', box: 'package', parcel: 'package', shirt2: 'shirt', clothing: 'shirt', fashion: 'shirt', gem2: 'gem', jewel: 'gem', ring2: 'ring', flower3: 'flower', leaf2: 'leaf', sprout2: 'sprout', apple2: 'apple', dumbbell2: 'dumbbell', activity2: 'activity', heartpulse: 'heart-pulse', stethoscope2: 'stethoscope', pill2: 'pill', tooth2: 'tooth', paw2: 'paw', bug2: 'bug', hardhat: 'hard-hat', droplet2: 'droplet', thermometer2: 'thermometer', snowflake2: 'snowflake', flame2: 'flame', zap2: 'zap', sun3: 'sun', sunrise2: 'sunrise', moon2: 'moon', globe2: 'globe', compass2: 'compass', navigation2: 'navigation', map3: 'map', mappin: 'map-pin', calendarcheck: 'calendar-check', watch2: 'watch', percent3: 'percent', trending: 'trending-up', barchart: 'bar-chart', piechart: 'pie-chart', calculator2: 'calculator', piggybank: 'piggy-bank', banknote2: 'banknote', creditcard: 'credit-card', coins2: 'coins', scale2: 'scale', gavel2: 'gavel', graduation: 'graduation-cap', bookopen: 'book-open', filetext: 'file-text', pentool: 'pen-tool', paintbrush2: 'paintbrush', partypopper: 'party-popper', shoppingbag: 'shopping-bag', shoppingcart: 'shopping-cart', chefhat: 'chef-hat', utensils2: 'utensils', badgecheck: 'badge-check', checkcircle: 'check-circle', shieldcheck: 'shield-check', helpcircle: 'help-circle', alerttriangle: 'alert-triangle', messagecircle: 'message-circle', messagesquare: 'message-square', externallink: 'external-link', arrowright: 'arrow-right', arrowupright: 'arrow-up-right' };
  const norm = low.replace(/[\s_]+/g, '-');
  if (NX_ICONS[norm]) return norm;
  const squashed = low.replace(/[^a-z0-9]/g, '');
  if (alias[low]) return alias[low];
  if (alias[squashed]) return alias[squashed];
  return nxIconFor(s, industry, index);
}

// Expand icon placeholders emitted by the AI writer or a content plan:
//   <i data-icon="tooth"></i>   <i data-icon="tooth"/>   {{icon:tooth}}   [icon:tooth]
// Unknown ids never leave a hole — they resolve through nxResolveIconId.
// Also upgrades legacy markup so EVERY page ships vector icons:
//   <div class="ic">🔧</div><h3>Repairs</h3>  → SVG chosen from the emoji, else the title
//   <div class="ic">stethoscope</div>          → SVG (a bare id the writer emitted)
//   .nx-check <b>✔</b>                          → check icon
//   .nx-cinfo <b>Phone</b> / Email / Address / Hours / WhatsApp → labelled row icons
const CONTACT_LABEL_ICONS = { phone: 'phone', tel: 'phone', telephone: 'phone', call: 'phone', whatsapp: 'message-circle', email: 'mail', 'e-mail': 'mail', mail: 'mail', address: 'map-pin', location: 'map-pin', visit: 'map-pin', hours: 'clock', 'opening hours': 'clock', 'working hours': 'clock', open: 'clock', website: 'globe', web: 'globe', 'الهاتف': 'phone', 'البريد': 'mail', 'العنوان': 'map-pin', 'ساعات العمل': 'clock' };
export function nxExpandIcons(html, industry) {
  let n = 0;
  const one = (id) => { n++; return nxIcon(nxResolveIconId(id, industry, n - 1)); };
  let out = String(html || '')
    .replace(/<i\s+[^>]*?data-icon=["']([^"']{1,40})["'][^>]*?(?:\/>|>\s*<\/i>)/gi, (_, id) => one(id))
    .replace(/\{\{\s*icon:\s*([a-z0-9 _-]{1,40})\s*\}\}/gi, (_, id) => one(id))
    .replace(/\[icon:\s*([a-z0-9 _-]{1,40})\s*\]/gi, (_, id) => one(id));
  // legacy emoji / bare-id icon slots (title-aware: the h3 that follows decides when the glyph is unknown)
  let slot = 0;
  const used = new Set();
  out = out.replace(/(<div class="ic"[^>]*>)\s*([^<]{1,40}?)\s*(<\/div>)(\s*<h3[^>]*>([^<]{0,160})<\/h3>)?/g, (m, open, glyph, close, h3, title) => {
    const g = glyph.trim();
    if (!g) return m;
    const emojiId = EMOJI_TO_ICON[g];
    const looksLikeId = /^[a-z][a-z0-9-]{1,30}$/.test(g) && NX_ICONS[g];
    const hasEmoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/u.test(g);
    if (!emojiId && !looksLikeId && !hasEmoji) return m; // real text (e.g. an initial) — leave it
    const id = looksLikeId ? g : nxIconFor((title || '') + ' ' + g, industry, slot, used);
    slot++; n++;
    return open + nxIcon(id) + close + (h3 || '');
  });
  out = out.replace(/(<div class="nx-check"[^>]*>\s*<b>)\s*(✔|✓|✔️|✅|☑️)\s*(<\/b>)/g, (_, a, __, c) => { n++; return a + nxIcon('check') + c; });
  out = out.replace(/(<div class="nx-cinfo"[^>]*>)([\s\S]*?)(<\/div>\s*<form|<\/div>\s*<\/div>\s*<\/div>\s*<\/section>)/, (m, open, inner, tail) => {
    const upgraded = inner.replace(/<b>([^<]{1,40})<\/b>/g, (mm, label) => {
      if (/<svg/.test(mm)) return mm;
      const id = CONTACT_LABEL_ICONS[label.trim().toLowerCase()];
      if (!id) return mm;
      n++;
      return '<b>' + nxIcon(id) + label + '</b>';
    });
    return open + upgraded + tail;
  });
  nxExpandIcons.lastCount = n;
  return out;
}

// The compact list the AI is shown (≈900 chars): every id, grouped by theme.
export function nxIconCatalogForAI() {
  return [
    'universal: check check-circle badge-check star heart shield shield-check award trophy crown thumbs-up sparkles zap target clock calendar calendar-check watch map-pin map navigation compass globe phone mail send message-circle message-square bell megaphone info help-circle alert-triangle life-buoy flag bookmark quote arrow-right arrow-up-right plus search refresh download link external-link eye lock key settings sliders layers layout grid users user user-check smile home building store landmark briefcase truck car plane bike package gift tag ticket shopping-bag shopping-cart percent',
    'money/business: dollar banknote coins credit-card wallet piggy-bank receipt calculator trending-up bar-chart pie-chart scale gavel clipboard file-text folder printer graduation-cap book-open lightbulb rocket',
    'tech: monitor laptop smartphone wifi cloud server database code terminal cpu plug',
    'creative: camera image video film aperture play mic music headphones gamepad pen pen-tool paintbrush palette brush wand ruler feather party-popper gem ring shirt scissors',
    'food/hospitality: coffee utensils chef-hat cake wine apple bed bath armchair umbrella mountain anchor',
    'health/nature: activity heart-pulse stethoscope pill tooth paw dumbbell leaf sprout flower sun sunrise moon droplet thermometer wind snowflake flame',
    'trades: wrench hammer hard-hat bug',
  ].join('\n');
}

// CSS that makes icons sit right in every design (appended to the token CSS).
export const NX_ICON_CSS = '.nx-i{width:1em;height:1em;display:inline-block;vertical-align:-.125em;flex:none}.ic{color:var(--accent);line-height:1}.ic .nx-i{width:clamp(22px,1.05em,40px);height:clamp(22px,1.05em,40px)}.nx-check b .nx-i,.nx-cinfo b .nx-i{width:1.15em;height:1.15em;margin-inline-end:.4em;color:var(--accent)}.nx-cinfo b{display:inline-flex;align-items:center}.nx-step .n .nx-i{width:1em;height:1em}@media (prefers-reduced-motion:reduce){.nx-i{transition:none}}';

export const __iconInternals = { KEYWORDS, ICON_ID_RE };
