// ═══════════════════════════════════════════════════════════════════
// AURORA OVERHAUL — v0.0.1.0 feature layer (non-AI)
// 1) Appearance system: 6 accent themes, light/dark, density, motion —
//    persisted in localStorage, applied as CSS variables.
// 2) Dashboard upgrades: today strip + quick actions, KPI history with
//    real sparklines (built from actual visit snapshots — no fake data),
//    getting-started checklist for empty workspaces.
// 3) Command palette upgrade: recent views + appearance actions.
// 4) Keyboard shortcuts: ? overlay, Ctrl+Shift+L/A/D.
// Every function is defensive — Aurora never breaks the app beneath it.
// ═══════════════════════════════════════════════════════════════════
const AURORA_ACCENTS = {
  indigo:  { label: 'Indigo',  a: '#6d7cff', b: '#a78bfa' },
  violet:  { label: 'Violet',  a: '#8b5cf6', b: '#ec4899' },
  cyan:    { label: 'Cyan',    a: '#06b6d4', b: '#3b82f6' },
  emerald: { label: 'Emerald', a: '#10b981', b: '#06b6d4' },
  amber:   { label: 'Amber',   a: '#f59e0b', b: '#ef4444' },
  rose:    { label: 'Rose',    a: '#f43f5e', b: '#a855f7' },
};
const AURORA_DEFAULTS = { accent: 'indigo', theme: 'dark', density: 'comfortable', motion: 'on' };
function auroraLoadState() {
  try {
    const s = JSON.parse(localStorage.getItem('nx_aurora') || '{}');
    return Object.assign({}, AURORA_DEFAULTS, s && typeof s === 'object' ? s : {});
  } catch (e) { return Object.assign({}, AURORA_DEFAULTS); }
}
window.AURORA = {
  state: auroraLoadState(),
  apply() {
    const s = this.state;
    const attrs = { accent: s.accent, theme: s.theme, density: s.density, motion: s.motion };
    for (const k of Object.keys(attrs)) {
      const v = String(attrs[k] || '');
      if (document.documentElement) document.documentElement.setAttribute('data-' + k, v);
      if (document.body) document.body.setAttribute('data-' + k, v);
    }
  },
  set(patch) {
    this.state = Object.assign({}, this.state, patch || {});
    try { localStorage.setItem('nx_aurora', JSON.stringify(this.state)); } catch (e) {}
    this.apply();
    return this.state;
  },
  toggleTheme() { const t = this.state.theme === 'light' ? 'dark' : 'light'; this.set({ theme: t }); toast(t === 'light' ? '☀️ Light mode — easy on bright rooms' : '🌙 Dark mode — back to the deep space look', 'success'); return t; },
  toggleDensity() { const d = this.state.density === 'compact' ? 'comfortable' : 'compact'; this.set({ density: d }); toast(d === 'compact' ? '📏 Compact density — more data per screen' : '🛋️ Comfortable density — more breathing room', 'info'); return d; },
  toggleMotion() { const m = this.state.motion === 'off' ? 'on' : 'off'; this.set({ motion: m }); toast(m === 'off' ? '🧊 Motion off — static, minimal, fastest' : '✨ Motion on — aurora drift + animations', 'info'); return m; },
  setAccent(a) {
    if (!AURORA_ACCENTS[a]) return false;
    this.set({ accent: a });
    toast('🎨 Accent set to ' + AURORA_ACCENTS[a].label, 'success');
    return true;
  },
  cycleAccent() {
    const keys = Object.keys(AURORA_ACCENTS);
    const i = keys.indexOf(this.state.accent);
    const next = keys[(i + 1) % keys.length];
    this.setAccent(next);
    return next;
  },
  reset() { this.state = Object.assign({}, AURORA_DEFAULTS); try { localStorage.removeItem('nx_aurora'); } catch (e) {} this.apply(); toast('🎨 Appearance reset to defaults', 'info'); },
};

// ── SHORTCUTS OVERLAY ──────────────────────────────────────────
function auroraShortcutsModal() {
  const rows = [
    ['Ctrl + K', 'Command palette — search everything, run any action'],
    ['?', 'This shortcuts overlay'],
    ['Ctrl + Shift + L', 'Toggle light / dark mode'],
    ['Ctrl + Shift + A', 'Cycle accent color (6 themes)'],
    ['Ctrl + Shift + D', 'Toggle compact density'],
    ['Ctrl + J', 'Toggle AI assistant panel'],
    ['Ctrl + /', 'AI assistant help'],
    ['Esc', 'Close modal / panels'],
  ];
  openModal(`
    <div style="font-size:17px;font-weight:800;margin-bottom:14px">⌨️ Keyboard Shortcuts</div>
    ${rows.map(([k, d]) => `
      <div class="aurora-shortcut-row">
        <span style="color:var(--text2)">${esc(d)}</span>
        <span class="aurora-kbd">${esc(k)}</span>
      </div>`).join('')}
    <div style="margin-top:14px;font-size:11px;color:var(--text3)">Aurora appearance lives in Settings → Appearance & Ergonomics.</div>
  `);
}
document.addEventListener('keydown', (e) => {
  const t = e.target;
  const typing = !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));
  if (e.ctrlKey && e.shiftKey && !typing && !e.metaKey && !e.altKey) {
    const k = String(e.key || '').toLowerCase();
    if (k === 'l') { e.preventDefault(); AURORA.toggleTheme(); return; }
    if (k === 'a') { e.preventDefault(); AURORA.cycleAccent(); return; }
    if (k === 'd') { e.preventDefault(); AURORA.toggleDensity(); return; }
  }
  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === '?') { e.preventDefault(); auroraShortcutsModal(); }
});

// ── RECENT VIEWS (feeds the command palette) ───────────────────
const __auroraOrigNavigate = navigate;
navigate = function (v) {
  try {
    const key = String(v || '');
    if (key && key !== 'find') {
      let r = JSON.parse(localStorage.getItem('nx_recent_views') || '[]');
      if (!Array.isArray(r)) r = [];
      r = [key].concat(r.filter(function (x) { return x !== key; })).slice(0, 6);
      localStorage.setItem('nx_recent_views', JSON.stringify(r));
    }
    if (String(v) === 'gallery3d') { try { localStorage.setItem('nx_seen_gallery', '1'); } catch (e) {} }
  } catch (e) {}
  return __auroraOrigNavigate.apply(this, arguments);
};

// ── COMMAND PALETTE UPGRADE: recents + appearance actions ──────
const __auroraOrigCommands = nxCommands;
nxCommands = function () {
  const extra = [
    ['🌗', 'Toggle light / dark mode', 'Aurora', function () { AURORA.toggleTheme(); }],
    ['🌈', 'Cycle accent color', 'Aurora — 6 themes', function () { AURORA.cycleAccent(); }],
    ['📏', 'Toggle compact density', 'Aurora', function () { AURORA.toggleDensity(); }],
    ['⌨️', 'Keyboard shortcuts', 'Help', function () { auroraShortcutsModal(); }],
  ];
  let recents = [];
  try {
    const titles = (typeof VIEW_TITLES === 'object' && VIEW_TITLES) ? VIEW_TITLES : {};
    recents = (JSON.parse(localStorage.getItem('nx_recent_views') || '[]') || [])
      .filter(function (x) { return typeof x === 'string' && x && x !== 'find' && x !== 'dashboard'; })
      .slice(0, 4)
      .map(function (v) { return ['🕘', (titles[v] || v) + '', 'Recently viewed', function () { navigate(v); }]; });
  } catch (e) {}
  return [].concat(recents, extra, __auroraOrigCommands())
    .map(function (x) { return { icon: x[0], title: x[1], sub: x[2], run: x[3] }; });
};

// ── DASHBOARD UPGRADES ─────────────────────────────────────────
const AURORA_KPI_KEY = 'nx_kpi_history';
function auroraKpiHistory() {
  try { const h = JSON.parse(localStorage.getItem(AURORA_KPI_KEY) || '[]'); return Array.isArray(h) ? h : []; } catch (e) { return []; }
}
function auroraSparkSvg(points, id) {
  // points: numbers (oldest → newest). Pure SVG, no libs.
  const w = 120, h = 28, pad = 2;
  const min = Math.min.apply(null, points), max = Math.max.apply(null, points);
  const span = (max - min) || 1;
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const coords = points.map(function (p, i) {
    const x = pad + i * step;
    const y = h - pad - ((p - min) / span) * (h - pad * 2);
    return [x, y];
  });
  const line = coords.map(function (c, i) { return (i === 0 ? 'M' : 'L') + c[0].toFixed(1) + ' ' + c[1].toFixed(1); }).join(' ');
  const area = line + ' L' + (w - pad) + ' ' + h + ' L' + pad + ' ' + h + ' Z';
  const last = coords[coords.length - 1];
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">'
    + '<defs><linearGradient id="auroraSparkFill-' + id + '" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="var(--accent)" stop-opacity=".5"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>'
    + '</linearGradient></defs>'
    + '<path class="area" d="' + area + '" fill="url(#auroraSparkFill-' + id + ')"/>'
    + '<path d="' + line + '"/>'
    + '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.6" fill="var(--accent)"/>'
    + '</svg>';
}
function auroraDeltaHtml(cur, prev) {
  if (typeof cur !== 'number' || typeof prev !== 'number' || Number.isNaN(cur) || Number.isNaN(prev)) return '';
  if (prev === 0 && cur === 0) return '<span class="aurora-delta flat">— steady</span>';
  if (prev === 0) return '<span class="aurora-delta up">▲ new activity</span>';
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const r = Math.round(Math.abs(pct * 10) / 10);
  if (pct > 0.5) return '<span class="aurora-delta up">▲ ' + r + '% vs last visit</span>';
  if (pct < -0.5) return '<span class="aurora-delta down">▼ ' + r + '% vs last visit</span>';
  return '<span class="aurora-delta flat">— steady</span>';
}
function auroraTodayStrip() {
  const d = new Date();
  const dateStr = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `
    <div class="aurora-today">
      <div>
        <div class="aurora-today-date">📆 ${esc(dateStr)}</div>
        <div class="aurora-today-sub">Local time ${esc(timeStr)} · quick actions on the right</div>
      </div>
      <div class="aurora-today-actions">
        <button class="btn btn-primary btn-sm" onclick="openAddContact()">＋ Contact</button>
        <button class="btn btn-secondary btn-sm" onclick="navigate('pipeline');try{window.__pendingDealOpen=true}catch(e){}">＋ Deal</button>
        <button class="btn btn-secondary btn-sm" onclick="navigate('tasks');try{window.__pendingTaskOpen=true}catch(e){}">＋ Task</button>
        <button class="btn btn-secondary btn-sm" onclick="exportAllData()">💾 Backup</button>
        <button class="btn btn-secondary btn-sm" onclick="navigate('gallery3d')">✨ 3D</button>
      </div>
    </div>`;
}
function auroraChecklistHtml(db) {
  const contacts = (db.contacts || []).length > 0;
  const deals = (db.deals || []).length > 0;
  const tasks = (db.tasks || []).length > 0;
  let seenGallery = false;
  try { seenGallery = localStorage.getItem('nx_seen_gallery') === '1'; } catch (e) {}
  const steps = [
    ['👤', 'Add your first contact', contacts, "openAddContact()"],
    ['💰', 'Create your first deal', deals, "navigate('pipeline');try{window.__pendingDealOpen=true}catch(e){}"],
    ['✅', 'Create your first task', tasks, "navigate('tasks');try{window.__pendingTaskOpen=true}catch(e){}"],
    ['✨', 'Explore the 3D Scene Gallery', seenGallery, "navigate('gallery3d')"],
  ];
  const done = steps.filter(function (s) { return s[2]; }).length;
  return `
    <div class="aurora-checklist">
      <div class="aurora-checklist-title">🚀 Getting started — ${done} of ${steps.length} done</div>
      ${steps.map(function (s) {
        return '<div class="aurora-check-item' + (s[2] ? ' done' : '') + '" onclick="' + s[3] + '">'
          + '<span class="box">' + (s[2] ? '✓' : '') + '</span><span>' + s[0] + ' ' + s[1] + '</span></div>';
      }).join('')}
    </div>`;
}
function auroraEnhanceDashboard(stats) {
  const c = V('content');
  if (!c) return;
  // 1) record a real KPI snapshot (deduped within 90s)
  let hist = auroraKpiHistory();
  if (stats && typeof stats.contacts === 'number') {
    const pt = {
      t: Date.now(), c: Number(stats.contacts) || 0,
      p: Number(stats.pipeline_value) || 0, w: Number(stats.won_revenue) || 0,
      a: Number(stats.upcoming_appointments) || 0, k: Number(stats.pending_tasks) || 0,
    };
    if (hist.length && Date.now() - hist[hist.length - 1].t < 90000) hist[hist.length - 1] = pt;
    else hist.push(pt);
    hist = hist.slice(-80);
    try { localStorage.setItem(AURORA_KPI_KEY, JSON.stringify(hist)); } catch (e) {}
  }
  // 2) today strip + quick actions
  const first = c.firstElementChild;
  const strip = document.createElement('div');
  strip.innerHTML = auroraTodayStrip();
  c.insertBefore(strip.firstElementChild, first);
  // 3) getting-started checklist for a fresh workspace
  let db = { contacts: [], deals: [], tasks: [] };
  try { db = nxDb(); } catch (e) {}
  const emptyWorkspace = (db.contacts || []).length === 0 && (db.deals || []).length === 0;
  if (emptyWorkspace) {
    const cl = document.createElement('div');
    cl.innerHTML = auroraChecklistHtml(db);
    c.insertBefore(cl.firstElementChild, c.children[1] || null);
  }
  // 4) sparklines — only when real history exists (≥2 visits)
  const metricByLabel = { 'Total Contacts': 'c', 'Pipeline Value': 'p', 'Revenue Won': 'w', 'Appointments': 'a' };
  c.querySelectorAll('.stat-card').forEach(function (card, idx) {
    const labelEl = card.querySelector('.stat-label');
    const metric = labelEl ? metricByLabel[String(labelEl.textContent || '').trim()] : null;
    if (!metric) return;
    const series = hist.map(function (h) { return h[metric]; }).filter(function (v) { return typeof v === 'number'; });
    const holder = document.createElement('div');
    holder.className = 'aurora-spark';
    if (series.length >= 2) {
      const cur = series[series.length - 1], prev = series[series.length - 2];
      holder.innerHTML = auroraSparkSvg(series, metric + idx) + auroraDeltaHtml(cur, prev);
    } else {
      holder.innerHTML = '<span class="aurora-trend-hint">📈 Trend chart appears after your next visit — every visit records a real snapshot.</span>';
    }
    card.appendChild(holder);
  });
}
const __auroraOrigDashboard = views.dashboard;
views.dashboard = async function () {
  await __auroraOrigDashboard.apply(this, arguments);
  let stats = null;
  try { stats = await api('/stats'); } catch (e) { stats = null; }
  try { auroraEnhanceDashboard(stats); } catch (e) { /* Aurora never breaks the dashboard */ }
};

// ── SETTINGS: Appearance & Ergonomics card ─────────────────────
function auroraAppearanceCardHtml() {
  const s = AURORA.state;
  const swatches = Object.keys(AURORA_ACCENTS).map(function (k) {
    const a = AURORA_ACCENTS[k];
    return '<div class="aurora-swatch' + (s.accent === k ? ' active' : '') + '" title="' + esc(a.label) + '" '
      + 'style="background:linear-gradient(135deg,' + a.a + ',' + a.b + ')" '
      + 'data-aurora-accent="' + esc(k) + '"></div>';
  }).join('');
  const seg = function (group, opts) {
    return opts.map(function (o) {
      const active = s[group] === o[0];
      return '<button class="btn btn-sm ' + (active ? 'btn-primary' : 'btn-secondary') + '" data-aurora-opt="' + esc(group) + '" data-aurora-val="' + esc(o[0]) + '">' + o[1] + '</button>';
    }).join('');
  };
  return `
    <div class="card" id="aurora-appearance" style="margin-top:20px">
      <div style="font-size:16px;font-weight:800;margin-bottom:4px">🎨 Appearance & Ergonomics</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:14px">Aurora design system — pick your accent, mode, density and motion. Saved on this device instantly.</div>
      <div class="aurora-row">
        <div><div class="aurora-row-label">Accent color</div><div class="aurora-row-sub">Recolors buttons, charts, highlights everywhere</div></div>
      </div>
      <div class="aurora-swatches">${swatches}</div>
      <div class="aurora-row">
        <div><div class="aurora-row-label">Mode</div><div class="aurora-row-sub">Dark (default) or light for bright rooms · <span class="aurora-kbd">Ctrl+Shift+L</span></div></div>
        <div style="display:flex;gap:6px">${seg('theme', [['dark', '🌙 Dark'], ['light', '☀️ Light']])}</div>
      </div>
      <div class="aurora-row">
        <div><div class="aurora-row-label">Density</div><div class="aurora-row-sub">Compact fits more data per screen · <span class="aurora-kbd">Ctrl+Shift+D</span></div></div>
        <div style="display:flex;gap:6px">${seg('density', [['comfortable', '🛋️ Comfortable'], ['compact', '📏 Compact']])}</div>
      </div>
      <div class="aurora-row">
        <div><div class="aurora-row-label">Motion</div><div class="aurora-row-sub">Aurora background drift + entrance animations</div></div>
        <div style="display:flex;gap:6px">${seg('motion', [['on', '✨ On'], ['off', '🧊 Off']])}</div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px">
        <button class="btn btn-secondary btn-sm" onclick="AURORA.reset();auroraRefreshAppearanceCard()">↺ Reset to defaults</button>
      </div>
    </div>`;
}
function auroraBindAppearanceCard() {
  const card = document.getElementById('aurora-appearance');
  if (!card) return;
  card.querySelectorAll('[data-aurora-accent]').forEach(function (el) {
    el.addEventListener('click', function () { AURORA.setAccent(el.getAttribute('data-aurora-accent')); auroraRefreshAppearanceCard(); });
  });
  card.querySelectorAll('[data-aurora-opt]').forEach(function (el) {
    el.addEventListener('click', function () {
      const g = el.getAttribute('data-aurora-opt'), v = el.getAttribute('data-aurora-val');
      if (g === 'theme') AURORA.set({ theme: v });
      else if (g === 'density') AURORA.set({ density: v });
      else if (g === 'motion') AURORA.set({ motion: v });
      auroraRefreshAppearanceCard();
    });
  });
}
function auroraRefreshAppearanceCard() {
  const card = document.getElementById('aurora-appearance');
  if (!card) return;
  card.outerHTML = auroraAppearanceCardHtml();
  auroraBindAppearanceCard();
}
const __auroraOrigSettings = views.settings;
views.settings = async function () {
  await __auroraOrigSettings.apply(this, arguments);
  try {
    const c = V('content');
    if (c) { c.insertAdjacentHTML('beforeend', auroraAppearanceCardHtml()); auroraBindAppearanceCard(); }
  } catch (e) { /* Aurora never breaks Settings */ }
};

// apply the persisted appearance immediately (auth screen included)
AURORA.apply();
