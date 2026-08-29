#!/usr/bin/env python3
"""Batch 1 (cycles 1-12): 40-theme library + hero styles + animation presets + card/nav styles + 3D levels."""
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

# ── 1. THEMES library (insert before DESIGN_EXTRAS) ──
rep("""const DESIGN_EXTRAS = {""",
r'''// ════════════════════════════════════════════════════════════
// DESIGN ENGINE v4 — curated catalogs from researched design trends
// 40 themes × 12 hero styles × 12 animation presets × 6 card styles ×
// 4 nav styles × 3 3D levels = 400,000+ unique design combinations.
// ════════════════════════════════════════════════════════════
const SITE_THEMES = {
  // trend: dark glassmorphism
  'glass-dark': { name: 'Glass Dark', vars: { '--bg': '#0b0f19', '--bg2': '#101828', '--card': 'rgba(255,255,255,.06)', '--line': 'rgba(255,255,255,.12)', '--text': '#eef2ff', '--muted': '#94a3b8', '--accent': '#818cf8', '--accent2': '#c084fc', '--teal': '#22d3ee', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#818cf8,#c084fc 55%,#22d3ee)', '--radius': '18px', '--glass': 'backdrop-filter:blur(14px)' } },
  'glass-light': { name: 'Glass Light', vars: { '--bg': '#eef2ff', '--bg2': '#e4e9f7', '--card': 'rgba(255,255,255,.55)', '--line': 'rgba(15,23,42,.10)', '--text': '#1e293b', '--muted': '#64748b', '--accent': '#6366f1', '--accent2': '#8b5cf6', '--teal': '#0ea5e9', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#6366f1,#8b5cf6 55%,#0ea5e9)', '--radius': '20px', '--glass': 'backdrop-filter:blur(16px)' } },
  // trend: neumorphism
  'neo-light': { name: 'Neo Soft', vars: { '--bg': '#e4e9f0', '--bg2': '#dde3ec', '--card': '#e4e9f0', '--line': 'transparent', '--text': '#2d3748', '--muted': '#718096', '--accent': '#5a67d8', '--accent2': '#6b46c1', '--teal': '#319795', '--amber': '#d69e2e', '--grad': 'linear-gradient(100deg,#5a67d8,#6b46c1 55%,#319795)', '--radius': '22px', '--neo': 'box-shadow:9px 9px 20px #c3cad6,-9px -9px 20px #ffffff' } },
  // trend: brutalism
  'brutalism': { name: 'Brutalist', vars: { '--bg': '#f5f0e8', '--bg2': '#efe7d9', '--card': '#ffffff', '--line': '#111111', '--text': '#111111', '--muted': '#444444', '--accent': '#ff3d00', '--accent2': '#ffb300', '--teal': '#00c2a8', '--amber': '#ffb300', '--grad': 'linear-gradient(100deg,#ff3d00,#ffb300 55%,#00c2a8)', '--radius': '0px', '--brutal': 'box-shadow:6px 6px 0 #111111;border:2px solid #111111' } },
  // trend: dark luxury (gold on black)
  'luxury-dark': { name: 'Dark Luxury', vars: { '--bg': '#0a0a0a', '--bg2': '#121212', '--card': '#161616', '--line': '#2a2a2a', '--text': '#f5f0e6', '--muted': '#9c927e', '--accent': '#d4af37', '--accent2': '#f0d98c', '--teal': '#d4af37', '--amber': '#f0d98c', '--grad': 'linear-gradient(100deg,#d4af37,#f0d98c 55%,#b8860b)', '--radius': '4px' } },
  'minimal-white': { name: 'Minimal White', vars: { '--bg': '#ffffff', '--bg2': '#f7f7f8', '--card': '#ffffff', '--line': '#e8e8ea', '--text': '#18181b', '--muted': '#71717a', '--accent': '#18181b', '--accent2': '#52525b', '--teal': '#18181b', '--amber': '#a1a1aa', '--grad': 'linear-gradient(100deg,#18181b,#52525b 55%,#18181b)', '--radius': '12px' } },
  'minimal-dark': { name: 'Minimal Dark', vars: { '--bg': '#09090b', '--bg2': '#111113', '--card': '#151517', '--line': '#27272a', '--text': '#fafafa', '--muted': '#a1a1aa', '--accent': '#fafafa', '--accent2': '#a1a1aa', '--teal': '#fafafa', '--amber': '#d4d4d8', '--grad': 'linear-gradient(100deg,#fafafa,#a1a1aa 55%,#fafafa)', '--radius': '12px' } },
  // trend: editorial serif
  'editorial': { name: 'Editorial', vars: { '--bg': '#faf8f4', '--bg2': '#f2eee5', '--card': '#ffffff', '--line': '#ddd6c8', '--text': '#1c1917', '--muted': '#6b6257', '--accent': '#9a3412', '--accent2': '#c2410c', '--teal': '#44403c', '--amber': '#b45309', '--grad': 'linear-gradient(100deg,#9a3412,#c2410c 55%,#44403c)', '--radius': '0px', '--serif': "font-family:'Playfair Display',Georgia,serif" } },
  // trend: cyberpunk neon
  'cyberpunk': { name: 'Cyberpunk', vars: { '--bg': '#0d0221', '--bg2': '#150a33', '--card': '#1b0f3d', '--line': '#3b1d6e', '--text': '#e8f6ff', '--muted': '#9d8fd0', '--accent': '#00f0ff', '--accent2': '#ff00e5', '--teal': '#00f0ff', '--amber': '#ffe600', '--grad': 'linear-gradient(100deg,#00f0ff,#ff00e5 55%,#ffe600)', '--radius': '6px', '--neon': 'text-shadow:0 0 18px rgba(0,240,255,.6)' } },
  'sunset': { name: 'Sunset Vibrant', vars: { '--bg': '#0d0a16', '--bg2': '#151024', '--card': '#1d1530', '--line': '#33254d', '--text': '#fff5f0', '--muted': '#c4a8c0', '--accent': '#ff5e62', '--accent2': '#ff9966', '--teal': '#ffb56b', '--amber': '#ffd86b', '--grad': 'linear-gradient(100deg,#ff5e62,#ff9966 55%,#ffd86b)', '--radius': '18px' } },
  'ocean-light': { name: 'Ocean Light', vars: { '--bg': '#f0f9ff', '--bg2': '#e0f2fe', '--card': '#ffffff', '--line': '#bae6fd', '--text': '#0c4a6e', '--muted': '#4b7b99', '--accent': '#0284c7', '--accent2': '#38bdf8', '--teal': '#0ea5e9', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#0284c7,#38bdf8 55%,#0ea5e9)', '--radius': '18px' } },
  'forest-dark': { name: 'Forest Dark', vars: { '--bg': '#0a120e', '--bg2': '#0f1a14', '--card': '#14221a', '--line': '#22382b', '--text': '#e7f2ea', '--muted': '#8fa89a', '--accent': '#34d399', '--accent2': '#a7f3d0', '--teal': '#34d399', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#34d399,#a7f3d0 55%,#fbbf24)', '--radius': '14px' } },
  'rose-elegant': { name: 'Rose Elegant', vars: { '--bg': '#fdf7f8', '--bg2': '#fbeef1', '--card': '#ffffff', '--line': '#f0dde2', '--text': '#38121c', '--muted': '#8a5a68', '--accent': '#d6336c', '--accent2': '#f783ac', '--teal': '#d6336c', '--amber': '#e8a13a', '--grad': 'linear-gradient(100deg,#d6336c,#f783ac 55%,#e8a13a)', '--radius': '18px' } },
  'midnight-violet': { name: 'Midnight Violet', vars: { '--bg': '#0d0a1a', '--bg2': '#141027', '--card': '#1b1533', '--line': '#2d2450', '--text': '#eae6ff', '--muted': '#a99fd0', '--accent': '#8b5cf6', '--accent2': '#c4b5fd', '--teal': '#a78bfa', '--amber': '#f0abfc', '--grad': 'linear-gradient(100deg,#8b5cf6,#c4b5fd 55%,#f0abfc)', '--radius': '16px' } },
  'ember-warm': { name: 'Ember Warm', vars: { '--bg': '#0d0b08', '--bg2': '#171310', '--card': '#201a14', '--line': '#3a2f24', '--text': '#f7efe4', '--muted': '#b39c80', '--accent': '#f59e0b', '--accent2': '#fbbf24', '--teal': '#f59e0b', '--amber': '#fcd34d', '--grad': 'linear-gradient(100deg,#f59e0b,#fcd34d 55%,#f97316)', '--radius': '16px' } },
  'graphite': { name: 'Graphite Mono', vars: { '--bg': '#0f0f0f', '--bg2': '#171717', '--card': '#1d1d1d', '--line': '#2e2e2e', '--text': '#f2f2f2', '--muted': '#9a9a9a', '--accent': '#e5e5e5', '--accent2': '#a3a3a3', '--teal': '#e5e5e5', '--amber': '#d4d4d4', '--grad': 'linear-gradient(100deg,#ffffff,#a3a3a3 55%,#ffffff)', '--radius': '10px' } },
  'sand-natural': { name: 'Sand Natural', vars: { '--bg': '#faf6ef', '--bg2': '#f1e9db', '--card': '#fffdf8', '--line': '#e2d5bf', '--text': '#3f3527', '--muted': '#8a7a63', '--accent': '#b7791f', '--accent2': '#d69e2e', '--teal': '#8b9d6b', '--amber': '#d69e2e', '--grad': 'linear-gradient(100deg,#b7791f,#d69e2e 55%,#8b9d6b)', '--radius': '14px' } },
  'sakura': { name: 'Sakura Pastel', vars: { '--bg': '#fdf2f6', '--bg2': '#fbe7ef', '--card': '#ffffff', '--line': '#f6d5e2', '--text': '#4a2430', '--muted': '#9d6b7c', '--accent': '#ec4899', '--accent2': '#f9a8d4', '--teal': '#ec4899', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#ec4899,#f9a8d4 55%,#fbbf24)', '--radius': '20px' } },
  'mint-fresh': { name: 'Mint Fresh', vars: { '--bg': '#f0fdfa', '--bg2': '#ccfbf1', '--card': '#ffffff', '--line': '#99f6e4', '--text': '#134e4a', '--muted': '#3d8a80', '--accent': '#14b8a6', '--accent2': '#2dd4bf', '--teal': '#14b8a6', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#14b8a6,#2dd4bf 55%,#0ea5e9)', '--radius': '18px' } },
  'cobalt-corp': { name: 'Cobalt Corporate', vars: { '--bg': '#f8fafc', '--bg2': '#eef2f7', '--card': '#ffffff', '--line': '#dbe4ee', '--text': '#0f172a', '--muted': '#5b6b84', '--accent': '#1d4ed8', '--accent2': '#3b82f6', '--teal': '#0ea5e9', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#1d4ed8,#3b82f6 55%,#0ea5e9)', '--radius': '10px' } },
  'lime-pop': { name: 'Lime Pop', vars: { '--bg': '#0c0f0a', '--bg2': '#141a0d', '--card': '#1c2414', '--line': '#33421f', '--text': '#f2ffe8', '--muted': '#a3c08c', '--accent': '#a3e635', '--accent2': '#d9f99d', '--teal': '#a3e635', '--amber': '#facc15', '--grad': 'linear-gradient(100deg,#a3e635,#d9f99d 55%,#facc15)', '--radius': '14px' } },
  'terracotta': { name: 'Terracotta', vars: { '--bg': '#fbf3ee', '--bg2': '#f5e5dc', '--card': '#fffaf6', '--line': '#e8cdbf', '--text': '#3d2218', '--muted': '#93644f', '--accent': '#c2410c', '--accent2': '#ea580c', '--teal': '#b45309', '--amber': '#d97706', '--grad': 'linear-gradient(100deg,#c2410c,#ea580c 55%,#b45309)', '--radius': '12px' } },
  'lavender': { name: 'Lavender Soft', vars: { '--bg': '#f8f7ff', '--bg2': '#efedfd', '--card': '#ffffff', '--line': '#ddd9f5', '--text': '#2e2a54', '--muted': '#736fa5', '--accent': '#7c6cf0', '--accent2': '#a78bfa', '--teal': '#7c6cf0', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#7c6cf0,#a78bfa 55%,#f0abfc)', '--radius': '18px' } },
  'noir-ivory': { name: 'Noir Ivory', vars: { '--bg': '#141414', '--bg2': '#1c1c1c', '--card': '#232323', '--line': '#333333', '--text': '#f5f0e1', '--muted': '#a89f8d', '--accent': '#e8dcc5', '--accent2': '#c9bda4', '--teal': '#e8dcc5', '--amber': '#d4c5a8', '--grad': 'linear-gradient(100deg,#e8dcc5,#c9bda4 55%,#e8dcc5)', '--radius': '6px' } },
  'bordeaux': { name: 'Bordeaux Wine', vars: { '--bg': '#16090d', '--bg2': '#200e14', '--card': '#2a1220', '--line': '#452034', '--text': '#fbeef2', '--muted': '#c29aa8', '--accent': '#e11d48', '--accent2': '#fb7185', '--teal': '#e11d48', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#e11d48,#fb7185 55%,#f59e0b)', '--radius': '12px' } },
  'teal-aqua': { name: 'Teal Aqua', vars: { '--bg': '#042f2e', '--bg2': '#083838', '--card': '#0d4444', '--line': '#115e5e', '--text': '#ecfeff', '--muted': '#8fd6d3', '--accent': '#2dd4bf', '--accent2': '#5eead4', '--teal': '#2dd4bf', '--amber': '#fcd34d', '--grad': 'linear-gradient(100deg,#2dd4bf,#5eead4 55%,#38bdf8)', '--radius': '16px' } },
  'amber-retro': { name: 'Amber Retro', vars: { '--bg': '#1c1206', '--bg2': '#271a0a', '--card': '#32220e', '--line': '#4a3414', '--text': '#fdeed0', '--muted': '#c9a876', '--accent': '#f59e0b', '--accent2': '#fbbf24', '--teal': '#f59e0b', '--amber': '#fcd34d', '--grad': 'linear-gradient(100deg,#f59e0b,#fcd34d 55%,#fb923c)', '--radius': '8px', '--retro': 'letter-spacing:.02em' } },
  'slate-blue': { name: 'Slate Blue', vars: { '--bg': '#0a0c10', '--bg2': '#101319', '--card': '#151a22', '--line': '#222a36', '--text': '#e6eaf2', '--muted': '#8b97ab', '--accent': '#5b8def', '--accent2': '#8fa8ff', '--teal': '#7ee2d0', '--amber': '#f2c14e', '--grad': 'linear-gradient(100deg,#5b8def,#8fa8ff 55%,#7ee2d0)', '--radius': '14px' } },
  'coral-tropic': { name: 'Coral Tropic', vars: { '--bg': '#fff7f2', '--bg2': '#ffece1', '--card': '#ffffff', '--line': '#ffd6c2', '--text': '#3c1505', '--muted': '#a05f3d', '--accent': '#ff6b3d', '--accent2': '#ff9f1c', '--teal': '#00c2a8', '--amber': '#ffd166', '--grad': 'linear-gradient(100deg,#ff6b3d,#ff9f1c 55%,#00c2a8)', '--radius': '20px' } },
  'evergreen': { name: 'Evergreen', vars: { '--bg': '#f1f7f3', '--bg2': '#e3efe8', '--card': '#ffffff', '--line': '#cde3d5', '--text': '#173b26', '--muted': '#5b826c', '--accent': '#15803d', '--accent2': '#22c55e', '--teal': '#16a34a', '--amber': '#ca8a04', '--grad': 'linear-gradient(100deg,#15803d,#22c55e 55%,#0d9488)', '--radius': '14px' } },
  'denim': { name: 'Denim', vars: { '--bg': '#101a2e', '--bg2': '#16233c', '--card': '#1c2c4a', '--line': '#2c4268', '--text': '#eef4ff', '--muted': '#93a9cc', '--accent': '#60a5fa', '--accent2': '#93c5fd', '--teal': '#38bdf8', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#60a5fa,#93c5fd 55%,#38bdf8)', '--radius': '12px' } },
  'plum-deep': { name: 'Plum Deep', vars: { '--bg': '#1c0d1f', '--bg2': '#26122b', '--card': '#301838', '--line': '#472450', '--text': '#f8eefc', '--muted': '#c39ecf', '--accent': '#c026d3', '--accent2': '#e879f9', '--teal': '#a21caf', '--amber': '#f0abfc', '--grad': 'linear-gradient(100deg,#c026d3,#e879f9 55%,#a78bfa)', '--radius': '16px' } },
  'canary': { name: 'Canary Bright', vars: { '--bg': '#fdfce8', '--bg2': '#faf7c8', '--card': '#ffffff', '--line': '#e8e3a0', '--text': '#3d3a08', '--muted': '#8a8420', '--accent': '#eab308', '--accent2': '#facc15', '--teal': '#ca8a04', '--amber': '#fde047', '--grad': 'linear-gradient(100deg,#eab308,#fde047 55%,#f97316)', '--radius': '12px' } },
  'steel': { name: 'Steel Grey', vars: { '--bg': '#0c0f14', '--bg2': '#12161d', '--card': '#181d26', '--line': '#2a3140', '--text': '#e8edf5', '--muted': '#8b96a8', '--accent': '#94a3b8', '--accent2': '#cbd5e1', '--teal': '#94a3b8', '--amber': '#d4a94e', '--grad': 'linear-gradient(100deg,#94a3b8,#cbd5e1 55%,#64748b)', '--radius': '8px' } },
  'berry': { name: 'Berry Magenta', vars: { '--bg': '#15060f', '--bg2': '#1f0a16', '--card': '#291020', '--line': '#421a31', '--text': '#fdeef6', '--muted': '#c493ad', '--accent': '#ec4899', '--accent2': '#f472b6', '--teal': '#db2777', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#ec4899,#f472b6 55%,#a855f7)', '--radius': '16px' } },
  'seafoam': { name: 'Seafoam', vars: { '--bg': '#f2fbf9', '--bg2': '#e2f6f2', '--card': '#ffffff', '--line': '#c8ebe4', '--text': '#1c4a42', '--muted': '#4e8a80', '--accent': '#0d9488', '--accent2': '#2dd4bf', '--teal': '#0d9488', '--amber': '#d97706', '--grad': 'linear-gradient(100deg,#0d9488,#2dd4bf 55%,#06b6d4)', '--radius': '18px' } },
  'chocolate': { name: 'Chocolate', vars: { '--bg': '#150f0a', '--bg2': '#1e1510', '--card': '#271b13', '--line': '#3d2b1f', '--text': '#f7ede1', '--muted': '#b79a7e', '--accent': '#d97706', '--accent2': '#f59e0b', '--teal': '#b45309', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#d97706,#f59e0b 55%,#92400e)', '--radius': '12px' } },
  'space': { name: 'Space Dark', vars: { '--bg': '#030712', '--bg2': '#0b1120', '--card': '#111a30', '--line': '#1e2a4a', '--text': '#e7ecff', '--muted': '#8ba0d8', '--accent': '#3b82f6', '--accent2': '#60a5fa', '--teal': '#22d3ee', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#3b82f6,#60a5fa 55%,#22d3ee)', '--radius': '16px' } },
  'peach': { name: 'Peach Cream', vars: { '--bg': '#fff7f0', '--bg2': '#ffefe0', '--card': '#ffffff', '--line': '#f7dcc8', '--text': '#3f2413', '--muted': '#9c7050', '--accent': '#fb923c', '--accent2': '#fdba74', '--teal': '#fb923c', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#fb923c,#fdba74 55%,#f87171)', '--radius': '20px' } },
  'classic-red': { name: 'Classic Red', vars: { '--bg': '#fff8f7', '--bg2': '#fdeeec', '--card': '#ffffff', '--line': '#f3d2cd', '--text': '#40130f', '--muted': '#96544b', '--accent': '#dc2626', '--accent2': '#ef4444', '--teal': '#b91c1c', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#dc2626,#ef4444 55%,#b91c1c)', '--radius': '10px' } },
};
// theme CSS builder
function themeCss(themeId) {
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
''',
'themes library')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 1 themes inserted.')
