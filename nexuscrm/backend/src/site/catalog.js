// backend/src/site/catalog.js — the curated design catalogs the website builder
// composes from: 40 colour themes, 12 hero layouts, 12 reveal animations,
// 6 card treatments, 4 nav treatments, 3 3D levels (400,000+ combinations).
// Pure data + two CSS/JS composers; no I/O, no globals. The AI design brain
// (site/design_brain.js) reads these to choose a coherent combination per brief.
// ════════════════════════════════════════════════════════════
// DESIGN ENGINE v4 — curated catalogs from researched design trends
// 40 themes × 12 hero styles × 12 animation presets × 6 card styles ×
// 4 nav styles × 3 3D levels = 400,000+ unique design combinations.
// ════════════════════════════════════════════════════════════
export const SITE_THEMES = {
  // trend: dark glassmorphism
  'glass-dark': { name: 'Glass Dark', vars: { '--bg': '#0b0f19', '--bg2': '#101828', '--card': 'rgba(255,255,255,.06)', '--line': 'rgba(255,255,255,.12)', '--text': '#eef2ff', '--muted': '#94a3b8', '--accent': '#818cf8', '--accent2': '#c084fc', '--teal': '#22d3ee', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#818cf8,#c084fc 55%,#22d3ee)', '--radius': '18px', '--glass': 'backdrop-filter:blur(14px)' } },
  'glass-light': { name: 'Glass Light', vars: { '--bg': '#eef2ff', '--bg2': '#e4e9f7', '--card': 'rgba(255,255,255,.55)', '--line': 'rgba(15,23,42,.10)', '--text': '#1e293b', '--muted': '#5a687d', '--accent': '#6366f1', '--accent2': '#8b5cf6', '--teal': '#0ea5e9', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#6366f1,#8b5cf6 55%,#0ea5e9)', '--radius': '20px', '--glass': 'backdrop-filter:blur(16px)' } },
  // trend: neumorphism
  'neo-light': { name: 'Neo Soft', vars: { '--bg': '#e4e9f0', '--bg2': '#dde3ec', '--card': '#e4e9f0', '--line': 'transparent', '--text': '#2d3748', '--muted': '#586475', '--accent': '#5a67d8', '--accent2': '#6b46c1', '--teal': '#319795', '--amber': '#d69e2e', '--grad': 'linear-gradient(100deg,#5a67d8,#6b46c1 55%,#319795)', '--radius': '22px', '--neo': 'box-shadow:9px 9px 20px #c3cad6,-9px -9px 20px #ffffff' } },
  // trend: brutalism
  'brutalism': { name: 'Brutalist', vars: { '--bg': '#f5f0e8', '--bg2': '#efe7d9', '--card': '#ffffff', '--line': '#111111', '--text': '#111111', '--muted': '#444444', '--accent': '#ff3d00', '--accent2': '#ffb300', '--teal': '#00c2a8', '--amber': '#ffb300', '--grad': 'linear-gradient(100deg,#ff3d00,#ffb300 55%,#00c2a8)', '--radius': '0px', '--brutal': 'box-shadow:6px 6px 0 #111111;border:2px solid #111111' } },
  // trend: dark luxury (gold on black)
  'luxury-dark': { name: 'Dark Luxury', vars: { '--bg': '#0a0a0a', '--bg2': '#121212', '--card': '#161616', '--line': '#2a2a2a', '--text': '#f5f0e6', '--muted': '#9c927e', '--accent': '#d4af37', '--accent2': '#f0d98c', '--teal': '#d4af37', '--amber': '#f0d98c', '--grad': 'linear-gradient(100deg,#d4af37,#f0d98c 55%,#b8860b)', '--radius': '4px' } },
  'minimal-white': { name: 'Minimal White', vars: { '--bg': '#ffffff', '--bg2': '#f7f7f8', '--card': '#ffffff', '--line': '#e8e8ea', '--text': '#18181b', '--muted': '#6f6f78', '--accent': '#18181b', '--accent2': '#52525b', '--teal': '#18181b', '--amber': '#a1a1aa', '--grad': 'linear-gradient(100deg,#18181b,#52525b 55%,#18181b)', '--radius': '12px' } },
  'minimal-dark': { name: 'Minimal Dark', vars: { '--bg': '#09090b', '--bg2': '#111113', '--card': '#151517', '--line': '#27272a', '--text': '#fafafa', '--muted': '#a1a1aa', '--accent': '#fafafa', '--accent2': '#a1a1aa', '--teal': '#fafafa', '--amber': '#d4d4d8', '--grad': 'linear-gradient(100deg,#fafafa,#a1a1aa 55%,#fafafa)', '--radius': '12px' } },
  // trend: editorial serif
  'editorial': { name: 'Editorial', vars: { '--bg': '#faf8f4', '--bg2': '#f2eee5', '--card': '#ffffff', '--line': '#ddd6c8', '--text': '#1c1917', '--muted': '#6b6257', '--accent': '#9a3412', '--accent2': '#c2410c', '--teal': '#44403c', '--amber': '#b45309', '--grad': 'linear-gradient(100deg,#9a3412,#c2410c 55%,#44403c)', '--radius': '0px', '--serif': "font-family:'Playfair Display',Georgia,serif" } },
  // trend: cyberpunk neon
  'cyberpunk': { name: 'Cyberpunk', vars: { '--bg': '#0d0221', '--bg2': '#150a33', '--card': '#1b0f3d', '--line': '#3b1d6e', '--text': '#e8f6ff', '--muted': '#9d8fd0', '--accent': '#00f0ff', '--accent2': '#ff00e5', '--teal': '#00f0ff', '--amber': '#ffe600', '--grad': 'linear-gradient(100deg,#00f0ff,#ff00e5 55%,#ffe600)', '--radius': '6px', '--neon': 'text-shadow:0 0 18px rgba(0,240,255,.6)' } },
  'sunset': { name: 'Sunset Vibrant', vars: { '--bg': '#0d0a16', '--bg2': '#151024', '--card': '#1d1530', '--line': '#33254d', '--text': '#fff5f0', '--muted': '#c4a8c0', '--accent': '#ff5e62', '--accent2': '#ff9966', '--teal': '#ffb56b', '--amber': '#ffd86b', '--grad': 'linear-gradient(100deg,#ff5e62,#ff9966 55%,#ffd86b)', '--radius': '18px' } },
  'ocean-light': { name: 'Ocean Light', vars: { '--bg': '#f0f9ff', '--bg2': '#e0f2fe', '--card': '#ffffff', '--line': '#bae6fd', '--text': '#0c4a6e', '--muted': '#446f8a', '--accent': '#0284c7', '--accent2': '#38bdf8', '--teal': '#0ea5e9', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#0284c7,#38bdf8 55%,#0ea5e9)', '--radius': '18px' } },
  'forest-dark': { name: 'Forest Dark', vars: { '--bg': '#0a120e', '--bg2': '#0f1a14', '--card': '#14221a', '--line': '#22382b', '--text': '#e7f2ea', '--muted': '#8fa89a', '--accent': '#34d399', '--accent2': '#a7f3d0', '--teal': '#34d399', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#34d399,#a7f3d0 55%,#fbbf24)', '--radius': '14px' } },
  'rose-elegant': { name: 'Rose Elegant', vars: { '--bg': '#fdf7f8', '--bg2': '#fbeef1', '--card': '#ffffff', '--line': '#f0dde2', '--text': '#38121c', '--muted': '#8a5a68', '--accent': '#d6336c', '--accent2': '#f783ac', '--teal': '#d6336c', '--amber': '#e8a13a', '--grad': 'linear-gradient(100deg,#d6336c,#f783ac 55%,#e8a13a)', '--radius': '18px' } },
  'midnight-violet': { name: 'Midnight Violet', vars: { '--bg': '#0d0a1a', '--bg2': '#141027', '--card': '#1b1533', '--line': '#2d2450', '--text': '#eae6ff', '--muted': '#a99fd0', '--accent': '#8b5cf6', '--accent2': '#c4b5fd', '--teal': '#a78bfa', '--amber': '#f0abfc', '--grad': 'linear-gradient(100deg,#8b5cf6,#c4b5fd 55%,#f0abfc)', '--radius': '16px' } },
  'ember-warm': { name: 'Ember Warm', vars: { '--bg': '#0d0b08', '--bg2': '#171310', '--card': '#201a14', '--line': '#3a2f24', '--text': '#f7efe4', '--muted': '#b39c80', '--accent': '#f59e0b', '--accent2': '#fbbf24', '--teal': '#f59e0b', '--amber': '#fcd34d', '--grad': 'linear-gradient(100deg,#f59e0b,#fcd34d 55%,#f97316)', '--radius': '16px' } },
  'graphite': { name: 'Graphite Mono', vars: { '--bg': '#0f0f0f', '--bg2': '#171717', '--card': '#1d1d1d', '--line': '#2e2e2e', '--text': '#f2f2f2', '--muted': '#9a9a9a', '--accent': '#e5e5e5', '--accent2': '#a3a3a3', '--teal': '#e5e5e5', '--amber': '#d4d4d4', '--grad': 'linear-gradient(100deg,#ffffff,#a3a3a3 55%,#ffffff)', '--radius': '10px' } },
  'sand-natural': { name: 'Sand Natural', vars: { '--bg': '#faf6ef', '--bg2': '#f1e9db', '--card': '#fffdf8', '--line': '#e2d5bf', '--text': '#3f3527', '--muted': '#746653', '--accent': '#b7791f', '--accent2': '#d69e2e', '--teal': '#8b9d6b', '--amber': '#d69e2e', '--grad': 'linear-gradient(100deg,#b7791f,#d69e2e 55%,#8b9d6b)', '--radius': '14px' } },
  'sakura': { name: 'Sakura Pastel', vars: { '--bg': '#fdf2f6', '--bg2': '#fbe7ef', '--card': '#ffffff', '--line': '#f6d5e2', '--text': '#4a2430', '--muted': '#875c6b', '--accent': '#ec4899', '--accent2': '#f9a8d4', '--teal': '#ec4899', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#ec4899,#f9a8d4 55%,#fbbf24)', '--radius': '20px' } },
  'mint-fresh': { name: 'Mint Fresh', vars: { '--bg': '#f0fdfa', '--bg2': '#ccfbf1', '--card': '#ffffff', '--line': '#99f6e4', '--text': '#134e4a', '--muted': '#34776e', '--accent': '#14b8a6', '--accent2': '#2dd4bf', '--teal': '#14b8a6', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#14b8a6,#2dd4bf 55%,#0ea5e9)', '--radius': '18px' } },
  'cobalt-corp': { name: 'Cobalt Corporate', vars: { '--bg': '#f8fafc', '--bg2': '#eef2f7', '--card': '#ffffff', '--line': '#dbe4ee', '--text': '#0f172a', '--muted': '#5b6b84', '--accent': '#1d4ed8', '--accent2': '#3b82f6', '--teal': '#0ea5e9', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#1d4ed8,#3b82f6 55%,#0ea5e9)', '--radius': '10px' } },
  'lime-pop': { name: 'Lime Pop', vars: { '--bg': '#0c0f0a', '--bg2': '#141a0d', '--card': '#1c2414', '--line': '#33421f', '--text': '#f2ffe8', '--muted': '#a3c08c', '--accent': '#a3e635', '--accent2': '#d9f99d', '--teal': '#a3e635', '--amber': '#facc15', '--grad': 'linear-gradient(100deg,#a3e635,#d9f99d 55%,#facc15)', '--radius': '14px' } },
  'terracotta': { name: 'Terracotta', vars: { '--bg': '#fbf3ee', '--bg2': '#f5e5dc', '--card': '#fffaf6', '--line': '#e8cdbf', '--text': '#3d2218', '--muted': '#875c49', '--accent': '#c2410c', '--accent2': '#ea580c', '--teal': '#b45309', '--amber': '#d97706', '--grad': 'linear-gradient(100deg,#c2410c,#ea580c 55%,#b45309)', '--radius': '12px' } },
  'lavender': { name: 'Lavender Soft', vars: { '--bg': '#f8f7ff', '--bg2': '#efedfd', '--card': '#ffffff', '--line': '#ddd9f5', '--text': '#2e2a54', '--muted': '#686495', '--accent': '#7c6cf0', '--accent2': '#a78bfa', '--teal': '#7c6cf0', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#7c6cf0,#a78bfa 55%,#f0abfc)', '--radius': '18px' } },
  'noir-ivory': { name: 'Noir Ivory', vars: { '--bg': '#141414', '--bg2': '#1c1c1c', '--card': '#232323', '--line': '#333333', '--text': '#f5f0e1', '--muted': '#a89f8d', '--accent': '#e8dcc5', '--accent2': '#c9bda4', '--teal': '#e8dcc5', '--amber': '#d4c5a8', '--grad': 'linear-gradient(100deg,#e8dcc5,#c9bda4 55%,#e8dcc5)', '--radius': '6px' } },
  'bordeaux': { name: 'Bordeaux Wine', vars: { '--bg': '#16090d', '--bg2': '#200e14', '--card': '#2a1220', '--line': '#452034', '--text': '#fbeef2', '--muted': '#c29aa8', '--accent': '#e11d48', '--accent2': '#fb7185', '--teal': '#e11d48', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#e11d48,#fb7185 55%,#f59e0b)', '--radius': '12px' } },
  'teal-aqua': { name: 'Teal Aqua', vars: { '--bg': '#042f2e', '--bg2': '#083838', '--card': '#0d4444', '--line': '#115e5e', '--text': '#ecfeff', '--muted': '#8fd6d3', '--accent': '#2dd4bf', '--accent2': '#5eead4', '--teal': '#2dd4bf', '--amber': '#fcd34d', '--grad': 'linear-gradient(100deg,#2dd4bf,#5eead4 55%,#38bdf8)', '--radius': '16px' } },
  'amber-retro': { name: 'Amber Retro', vars: { '--bg': '#1c1206', '--bg2': '#271a0a', '--card': '#32220e', '--line': '#4a3414', '--text': '#fdeed0', '--muted': '#c9a876', '--accent': '#f59e0b', '--accent2': '#fbbf24', '--teal': '#f59e0b', '--amber': '#fcd34d', '--grad': 'linear-gradient(100deg,#f59e0b,#fcd34d 55%,#fb923c)', '--radius': '8px', '--retro': 'letter-spacing:.02em' } },
  'slate-blue': { name: 'Slate Blue', vars: { '--bg': '#0a0c10', '--bg2': '#101319', '--card': '#151a22', '--line': '#222a36', '--text': '#e6eaf2', '--muted': '#8b97ab', '--accent': '#5b8def', '--accent2': '#8fa8ff', '--teal': '#7ee2d0', '--amber': '#f2c14e', '--grad': 'linear-gradient(100deg,#5b8def,#8fa8ff 55%,#7ee2d0)', '--radius': '14px' } },
  'coral-tropic': { name: 'Coral Tropic', vars: { '--bg': '#fff7f2', '--bg2': '#ffece1', '--card': '#ffffff', '--line': '#ffd6c2', '--text': '#3c1505', '--muted': '#9a5b3b', '--accent': '#ff6b3d', '--accent2': '#ff9f1c', '--teal': '#00c2a8', '--amber': '#ffd166', '--grad': 'linear-gradient(100deg,#ff6b3d,#ff9f1c 55%,#00c2a8)', '--radius': '20px' } },
  'evergreen': { name: 'Evergreen', vars: { '--bg': '#f1f7f3', '--bg2': '#e3efe8', '--card': '#ffffff', '--line': '#cde3d5', '--text': '#173b26', '--muted': '#4e705d', '--accent': '#15803d', '--accent2': '#22c55e', '--teal': '#16a34a', '--amber': '#ca8a04', '--grad': 'linear-gradient(100deg,#15803d,#22c55e 55%,#0d9488)', '--radius': '14px' } },
  'denim': { name: 'Denim', vars: { '--bg': '#101a2e', '--bg2': '#16233c', '--card': '#1c2c4a', '--line': '#2c4268', '--text': '#eef4ff', '--muted': '#93a9cc', '--accent': '#60a5fa', '--accent2': '#93c5fd', '--teal': '#38bdf8', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#60a5fa,#93c5fd 55%,#38bdf8)', '--radius': '12px' } },
  'plum-deep': { name: 'Plum Deep', vars: { '--bg': '#1c0d1f', '--bg2': '#26122b', '--card': '#301838', '--line': '#472450', '--text': '#f8eefc', '--muted': '#c39ecf', '--accent': '#c026d3', '--accent2': '#e879f9', '--teal': '#a21caf', '--amber': '#f0abfc', '--grad': 'linear-gradient(100deg,#c026d3,#e879f9 55%,#a78bfa)', '--radius': '16px' } },
  'canary': { name: 'Canary Bright', vars: { '--bg': '#fdfce8', '--bg2': '#faf7c8', '--card': '#ffffff', '--line': '#e8e3a0', '--text': '#3d3a08', '--muted': '#746f1b', '--accent': '#eab308', '--accent2': '#facc15', '--teal': '#ca8a04', '--amber': '#fde047', '--grad': 'linear-gradient(100deg,#eab308,#fde047 55%,#f97316)', '--radius': '12px' } },
  'steel': { name: 'Steel Grey', vars: { '--bg': '#0c0f14', '--bg2': '#12161d', '--card': '#181d26', '--line': '#2a3140', '--text': '#e8edf5', '--muted': '#8b96a8', '--accent': '#94a3b8', '--accent2': '#cbd5e1', '--teal': '#94a3b8', '--amber': '#d4a94e', '--grad': 'linear-gradient(100deg,#94a3b8,#cbd5e1 55%,#64748b)', '--radius': '8px' } },
  'berry': { name: 'Berry Magenta', vars: { '--bg': '#15060f', '--bg2': '#1f0a16', '--card': '#291020', '--line': '#421a31', '--text': '#fdeef6', '--muted': '#c493ad', '--accent': '#ec4899', '--accent2': '#f472b6', '--teal': '#db2777', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#ec4899,#f472b6 55%,#a855f7)', '--radius': '16px' } },
  'seafoam': { name: 'Seafoam', vars: { '--bg': '#f2fbf9', '--bg2': '#e2f6f2', '--card': '#ffffff', '--line': '#c8ebe4', '--text': '#1c4a42', '--muted': '#42746c', '--accent': '#0d9488', '--accent2': '#2dd4bf', '--teal': '#0d9488', '--amber': '#d97706', '--grad': 'linear-gradient(100deg,#0d9488,#2dd4bf 55%,#06b6d4)', '--radius': '18px' } },
  'chocolate': { name: 'Chocolate', vars: { '--bg': '#150f0a', '--bg2': '#1e1510', '--card': '#271b13', '--line': '#3d2b1f', '--text': '#f7ede1', '--muted': '#b79a7e', '--accent': '#d97706', '--accent2': '#f59e0b', '--teal': '#b45309', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#d97706,#f59e0b 55%,#92400e)', '--radius': '12px' } },
  'space': { name: 'Space Dark', vars: { '--bg': '#030712', '--bg2': '#0b1120', '--card': '#111a30', '--line': '#1e2a4a', '--text': '#e7ecff', '--muted': '#8ba0d8', '--accent': '#3b82f6', '--accent2': '#60a5fa', '--teal': '#22d3ee', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#3b82f6,#60a5fa 55%,#22d3ee)', '--radius': '16px' } },
  'peach': { name: 'Peach Cream', vars: { '--bg': '#fff7f0', '--bg2': '#ffefe0', '--card': '#ffffff', '--line': '#f7dcc8', '--text': '#3f2413', '--muted': '#896346', '--accent': '#fb923c', '--accent2': '#fdba74', '--teal': '#fb923c', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#fb923c,#fdba74 55%,#f87171)', '--radius': '20px' } },
  'classic-red': { name: 'Classic Red', vars: { '--bg': '#fff8f7', '--bg2': '#fdeeec', '--card': '#ffffff', '--line': '#f3d2cd', '--text': '#40130f', '--muted': '#96544b', '--accent': '#dc2626', '--accent2': '#ef4444', '--teal': '#b91c1c', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#dc2626,#ef4444 55%,#b91c1c)', '--radius': '10px' } },
};
// theme CSS builder
export function themeCss(themeId) {
  const t = SITE_THEMES[themeId];
  if (!t) return '';
  const vars = Object.entries(t.vars).map(([k, v]) => `${k}:${v}`).join(';');
  // glass/neo/brutal special treatments on cards + nav
  let extra = '';
  if (themeId === 'glass-dark' || themeId === 'glass-light') {
    extra = `.nx-card,.nx-stat,.nx-step,.nx-review,.nx-lead{background:var(--card);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--line)}.nx-nav{background:rgba(255,255,255,.06);backdrop-filter:blur(18px)}`;
  }
  if (themeId === 'neo-light') {
    extra = `.nx-card,.nx-stat,.nx-step,.nx-review{background:var(--card);box-shadow:9px 9px 20px #c3cad6,-9px -9px 20px #ffffff;border:none}.nx-nav{background:rgba(228,233,240,.9);backdrop-filter:blur(14px)}`;
  }
  if (themeId === 'brutalism') {
    extra = `.nx-card,.nx-stat,.nx-step,.nx-review,.btn,.nx-lead,.nx-form input,.nx-form textarea{border:2px solid #111;box-shadow:6px 6px 0 #111;border-radius:0}.btn-primary{background:#ff3d00;color:#fff}.nx-card:hover,.nx-stat:hover{transform:translate(-3px,-3px);box-shadow:9px 9px 0 #111}`;
  }
  if (themeId === 'luxury-dark' || themeId === 'noir-ivory') {
    extra = `.sec-title,.nx-hero h1{font-weight:700;letter-spacing:-.01em}.nx-brand em{font-style:normal}.nx-stat b{color:var(--accent)}`;
  }
  if (themeId === 'cyberpunk') {
    extra = `.nx-card{border:1px solid rgba(0,240,255,.3);box-shadow:0 0 24px -8px rgba(0,240,255,.25)}.nx-card:hover{box-shadow:0 0 36px -6px rgba(255,0,229,.4)}.grad-text,.nx-hero h1{text-shadow:0 0 18px rgba(0,240,255,.5)}`;
  }
  if (themeId === 'editorial') {
    extra = `body{font-family:'Playfair Display',Georgia,serif}h1,h2,h3{font-family:'Playfair Display',Georgia,serif;font-weight:800}.nx-card p,.nx-faq-a{font-family:system-ui,sans-serif}`;
  }
  return `:root{${vars}}${extra}`;
}
// ════════════════════════════════════════════════════════════
// COMPONENT STYLE CATALOGS (hero / animation / card / nav / 3D)
// ════════════════════════════════════════════════════════════
export const HERO_STYLES = {
  split:        { name: 'Split (text + image)', css: '', prompt: '.nx-hero-inner two-column grid' },
  center:       { name: 'Centered', css: `.nx-hero{text-align:center}.nx-hero-inner{display:block}.nx-hero p.lead{margin-left:auto;margin-right:auto}.nx-hero-actions{justify-content:center}`, prompt: '.nx-hero-inner single column, centered' },
  glass:        { name: 'Glass panel', css: `.nx-hero-inner{background:rgba(255,255,255,.05);border:1px solid var(--line);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-radius:calc(var(--radius) + 8px);padding:56px 48px;box-shadow:0 40px 90px -40px rgba(0,0,0,.6)}`, prompt: '.nx-hero-inner glass card panel' },
  mesh:         { name: 'Gradient mesh', css: `.nx-hero::before{content:"";position:absolute;inset:-20%;z-index:0;background:radial-gradient(40% 45% at 20% 30%,rgba(247,116,42,.28),transparent 60%),radial-gradient(35% 40% at 80% 20%,rgba(47,179,162,.25),transparent 60%),radial-gradient(45% 50% at 60% 85%,rgba(91,141,239,.22),transparent 60%);filter:blur(30px);animation:meshDrift 16s ease-in-out infinite alternate}.nx-hero>*{position:relative;z-index:2}@keyframes meshDrift{0%{transform:translate3d(0,0,0) scale(1)}100%{transform:translate3d(3%,-3%,0) scale(1.08)}}`, prompt: '.nx-hero-inner (gradient mesh blobs behind)' },
  tilt3d:       { name: '3D tilt card', css: `.nx-3d-wrap{perspective:1100px}.nx-3d-card{transform-style:preserve-3d;transition:transform .25s var(--ease);will-change:transform}.nx-3d-card>*{transform:translateZ(34px)}`, prompt: '.nx-hero-inner with a .nx-3d-wrap > .nx-3d-card around the hero image (if present)' },
  particles:    { name: 'Particle field', css: `#nx-particles{position:absolute;inset:0;z-index:0;pointer-events:none}.nx-hero>*{position:relative;z-index:2}`, prompt: '.nx-hero-inner (a canvas#nx-particles sits behind automatically)' },
  parallax:     { name: 'Layered parallax', css: `.nx-pl{position:absolute;inset:0;overflow:hidden;z-index:0;pointer-events:none}.nx-pl i{position:absolute;display:block;border-radius:50%;will-change:transform}.nx-hero>*{position:relative;z-index:2}`, prompt: '.nx-hero-inner (parallax layer divs .nx-pl with <i> orbs behind)' },
  marqueebg:    { name: 'Marquee background', css: `.nx-hero{overflow:hidden}.nx-hero-bg-marquee{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:none;z-index:0;opacity:.08;font-weight:900;white-space:nowrap;font-size:clamp(80px,16vw,220px);color:var(--accent)}.nx-hero-bg-marquee span{animation:heroMarquee 30s linear infinite}.nx-hero>*{position:relative;z-index:2}@keyframes heroMarquee{to{transform:translateX(-50%)}}`, prompt: '.nx-hero-bg-marquee div with the business name repeated, then .nx-hero-inner' },
  kinetic:      { name: 'Kinetic type', css: `.nx-kinetic{display:inline-block}.nx-kinetic b{display:inline-block;animation:kin 3.2s var(--ease) infinite;opacity:0}.nx-kinetic b:nth-child(2){animation-delay:.22s}.nx-kinetic b:nth-child(3){animation-delay:.44s}.nx-kinetic b:nth-child(4){animation-delay:.66s}.nx-kinetic b:nth-child(5){animation-delay:.88s}.nx-kinetic b:nth-child(6){animation-delay:1.1s}.nx-kinetic b:nth-child(7){animation-delay:1.32s}.nx-kinetic b:nth-child(8){animation-delay:1.54s}@keyframes kin{0%{opacity:0;transform:translateY(18px) rotate(4deg)}30%{opacity:1;transform:none}75%{opacity:1}100%{opacity:0}}`, prompt: 'hero h1 headline with .nx-kinetic wrapping each word in <b>' },
  splitimage:   { name: 'Split + framed image', css: `.nx-hero-img img{border:1px solid var(--line);border-radius:var(--radius);box-shadow:0 40px 90px -30px rgba(0,0,0,.5)}.nx-hero-img::after{content:"";position:absolute;inset:14px -14px -14px 14px;border:2px solid var(--accent);border-radius:var(--radius);opacity:.5;z-index:-1}`, prompt: '.nx-hero-inner with .nx-hero-img (image with decorative frame)' },
  badgehero:    { name: 'Badge compact', css: `.nx-hero{padding:80px 0 60px}.nx-hero-inner{grid-template-columns:1fr;text-align:center}.nx-hero p.lead{margin:0 auto 26px}.nx-hero-actions{justify-content:center}.nx-hero h1{font-size:clamp(34px,5vw,54px)}`, prompt: '.nx-hero-inner single column centered with .nx-badge' },
  minimal:      { name: 'Minimal', css: `.nx-hero{padding:120px 0 80px}.nx-hero-inner{display:block}.nx-hero h1{font-size:clamp(40px,7vw,76px);letter-spacing:-.04em;max-width:900px}.nx-hero p.lead{font-size:19px;max-width:560px}.nx-badge{display:none}`, prompt: '.nx-hero-inner single column, huge headline, no badge' },
};
export const ANIM_PRESETS = {
  fadeup:   { name: 'Fade up', css: `[data-reveal]{transform:translateY(26px)}` },
  fade:     { name: 'Fade', css: `[data-reveal]{transform:none}` },
  slideleft:{ name: 'Slide left', css: `[data-reveal]{transform:translateX(-40px)}` },
  slideright:{ name: 'Slide right', css: `[data-reveal]{transform:translateX(40px)}` },
  zoom:     { name: 'Zoom in', css: `[data-reveal]{transform:scale(.9)}` },
  blur:     { name: 'Blur in', css: `[data-reveal]{transform:translateY(18px);filter:blur(8px)}[data-reveal].in{filter:blur(0)}` },
  flip:     { name: 'Flip up', css: `[data-reveal]{transform:perspective(900px) rotateX(24deg);transform-origin:bottom}` },
  rise:     { name: 'Rise + fade', css: `[data-reveal]{transform:translateY(60px);transition-duration:.9s}` },
  pop:      { name: 'Pop', css: `[data-reveal]{transform:scale(.82) translateY(20px)}` },
  drift:    { name: 'Drift', css: `[data-reveal]{transform:translate(18px,22px)}` },
  clip:     { name: 'Clip up', css: `[data-reveal]{clip-path:inset(0 0 100% 0);transform:none;transition:clip-path .8s var(--ease)}[data-reveal].in{clip-path:inset(0 0 0 0)}` },
  none:     { name: 'None (instant)', css: `[data-reveal]{opacity:1;transform:none;transition:none}` },
};
export const CARD_STYLES = {
  standard: { name: 'Standard', css: '' },
  glass:    { name: 'Glass', css: `.nx-card,.nx-stat,.nx-step,.nx-review{background:rgba(255,255,255,.06);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--line)}` },
  neo:      { name: 'Neumorphic', css: `.nx-card,.nx-stat,.nx-step,.nx-review{background:var(--bg2);border:none;box-shadow:8px 8px 18px rgba(0,0,0,.22),-8px -8px 18px rgba(255,255,255,.04)}` },
  border:   { name: 'Gradient border', css: `.nx-card,.nx-stat,.nx-step,.nx-review{border:1px solid transparent;background:linear-gradient(var(--card),var(--card)) padding-box,var(--grad) border-box}` },
  lift3d:   { name: '3D lift', css: `.nx-card,.nx-stat,.nx-step{transform-style:preserve-3d}.nx-card:hover,.nx-stat:hover,.nx-step:hover{transform:perspective(900px) translateZ(22px) translateY(-8px) rotateX(2deg) rotateY(-2deg)}` },
  minimal:  { name: 'Minimal', css: `.nx-card,.nx-stat,.nx-step,.nx-review{background:transparent;border:none;border-bottom:1px solid var(--line);border-radius:0}` },
};
export const NAV_STYLES = {
  glass:  { name: 'Glass', css: `.nx-nav{background:rgba(11,14,20,.6);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}` },
  solid:  { name: 'Solid', css: `.nx-nav{background:var(--bg2);backdrop-filter:none}` },
  underline: { name: 'Underline', css: `.nx-nav-links a{position:relative}.nx-nav-links a::after{content:"";position:absolute;left:0;right:0;bottom:-4px;height:2px;background:var(--grad);transform:scaleX(0);transition:transform .25s var(--ease)}.nx-nav-links a:hover::after{transform:scaleX(1)}` },
  pill:   { name: 'Pill CTA', css: `.nx-nav-links .nx-nav-cta a,.nx-nav-links a[data-cta]{background:var(--grad);color:#fff;padding:8px 18px;border-radius:999px;font-weight:700}.nx-nav-links a[data-cta]:hover{color:#fff;transform:translateY(-2px)}` },
};
export const THREE_D_LEVELS = {
  off:   { name: 'Off', css: '', js: '' },
  light: { name: 'Light (CSS 3D)', css: `.nx-hero-img img,.nx-3d-card,.nx-card,.nx-stat{transform-style:preserve-3d}`, js: '' },
  full:  { name: 'Full (3D hero + particles)', css: `#nx-particles{position:absolute;inset:0;z-index:0;pointer-events:none}.nx-hero>*{position:relative;z-index:2}.nx-orb-3d{position:absolute;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle at 30% 30%,var(--accent2),var(--accent) 60%,transparent);filter:blur(6px);opacity:.5;animation:orbSpin 14s linear infinite;will-change:transform;z-index:0}.nx-hero{overflow:hidden}@keyframes orbSpin{0%{transform:rotate(0) translateX(60px) rotate(0)}100%{transform:rotate(360deg) translateX(60px) rotate(-360deg)}}`, js: `
  // 3D hero scene: inject canvas + orb automatically (no external libs)
  var mm3=function(q){try{return (typeof matchMedia!=='undefined')?matchMedia(q).matches:false;}catch(e){return false;}};
  var R3=mm3('(prefers-reduced-motion: reduce)');
  var heroEl=document.querySelector('.nx-hero');
  if(heroEl&&!R3){
    var orb=document.createElement('div');orb.className='nx-orb-3d';orb.style.top='12%';orb.style.right='8%';heroEl.appendChild(orb);
    var canvas=document.createElement('canvas');canvas.id='nx-particles';heroEl.appendChild(canvas);
    var pc=canvas;
    if(pc.getContext){
      var ctx=pc.getContext('2d'),W,H,pts=[];
      function ps(){W=pc.width=pc.offsetWidth;H=pc.height=pc.offsetHeight;pts=[];var n=Math.min(70,Math.floor(W/18));for(var i=0;i<n;i++)pts.push({x:Math.random()*W,y:Math.random()*H,r:Math.random()*2+0.6,vx:(Math.random()-.5)*.4,vy:(Math.random()-.5)*.4});}
      ps();addEventListener('resize',ps,{passive:true});
      (function loop(){ctx.clearRect(0,0,W,H);for(var i=0;i<pts.length;i++){var p=pts[i];p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>W)p.vx*=-1;if(p.y<0||p.y>H)p.vy*=-1;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle='rgba(120,160,255,.5)';ctx.fill();}requestAnimationFrame(loop);})();
    }
  }` },
};
// build the extra CSS for chosen component styles
export function componentStylesCss(opts) {
  const parts = [];
  const hero = HERO_STYLES[opts.hero_style];
  if (hero && hero.css) parts.push('/* hero:' + opts.hero_style + ' */\n' + hero.css);
  const anim = ANIM_PRESETS[opts.anim_preset];
  if (anim && anim.css) parts.push('/* anim:' + opts.anim_preset + ' */\n' + anim.css);
  const card = CARD_STYLES[opts.card_style];
  if (card && card.css) parts.push('/* card:' + opts.card_style + ' */\n' + card.css);
  const nav = NAV_STYLES[opts.nav_style];
  if (nav && nav.css) parts.push('/* nav:' + opts.nav_style + ' */\n' + nav.css);
  const t3 = THREE_D_LEVELS[opts.three_d];
  if (t3 && t3.css) parts.push('/* 3d:' + opts.three_d + ' */\n' + t3.css);
  return parts.join('\n');
}
export function componentScriptsJs(opts) {
  const t3 = THREE_D_LEVELS[opts.three_d];
  return (t3 && t3.js) || '';
}
