// ─────────────────────────────────────────────────────────────────────────────
// nx_render.js — GRAPH RENDERER + RUNTIME + CANVAS PROTOCOL  (v0.0.1.9)
//
// The Project Graph is the canonical, editable source of truth. This module is a
// real compiler pipeline:
//
//   PROJECT GRAPH → RENDERING MODEL (recursive, children-driven) → CODE (HTML/CSS/JS)
//                    └→ RUNTIME (states/interactions/motion timelines)
//                    └→ CANVAS (every edit → structured patch → new project → re-render)
//
// It is NOT role-specific: rendering is driven by a **component renderer registry**
// and the node graph's `children`. New families plug in without touching core.
// There is no `if role === hero` chain.
//
// Dependency-free. Reuses nx_ir (mutation/validation/integrity), nx_graph
// (constraints/states/assets/motion), nx_design (tokens/motion) via __NX_DEPS.
// ─────────────────────────────────────────────────────────────────────────────
function __dep(key, name, dflt) {
  if (typeof globalThis !== 'undefined') {
    if (globalThis.__NX_DEPS && globalThis.__NX_DEPS[key] && globalThis.__NX_DEPS[key][name] !== undefined) return globalThis.__NX_DEPS[key][name];
    if (globalThis[name] !== undefined && typeof globalThis[name] === 'function') return globalThis[name];
  }
  try {
    if (typeof require === 'function') {
      const m = key === 'design' ? require('./nx_design.js') : key === 'ir' ? require('./nx_ir.js') : require('./nx_graph.js');
      if (m && m[name] !== undefined) return m[name];
    }
  } catch {}
  return dflt;
}
const __patch = (p, ops) => __dep('ir', 'nxProjectPatch', () => ({ ok: false, errors: ['no mutation engine'] }))(p, ops);
const __integrity = (p) => __dep('ir', 'nxValidateGraphIntegrity', () => ({ ok: true, errors: [] }))(p);
const __stateSchema = (p) => __dep('ir', 'nxValidateGraphState', () => ({ ok: true, errors: [] }))(p);
const __nodeSchema = (p, id) => (__dep('ir', 'nxValidateNode', () => ({ ok: true, errors: [] }))(p.nodes[id]));
const __solveLayout = (p) => __dep('graph', 'nxSolveLayout', () => ({}))(p);
const __getAssert = (p, id, bp) => __dep('graph', 'nxResolveAssetForViewport', () => null)(p, id, bp);
const __budget = (p, o) => __dep('graph', 'nxMotionBudget', () => ({ score: 100, withinBudget: true }))(p, o);
const __tokensCss = (b) => __dep('design', 'nxTokensToCss', () => '')(b);
const __motionCss = (recipe) => __dep('design', 'nxMotionToCss', () => '')(recipe);
const __mergeBrand = (a, b) => __dep('design', 'nxMergeBrand', (x, y) => Object.assign({}, x, y))(a, b);

function __esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function __escAttr(s) { return __esc(s).replace(/'/g, '&#39;'); }
function __styleKeys(props) { const k = []; for (const key of Object.keys(props)) k.push(key.replace(/([A-Z])/g, '-$1').toLowerCase()); return k; }
function __kebab(s) { return s.replace(/([A-Z])/g, '-$1').toLowerCase(); }

// ─────────────────────────────────────────────────────────────────────────────
// 1. COMPONENT RENDERER REGISTRY  (family → element + structure + children factory)
//    New families are added here; the recursive renderer knows nothing about roles.
// ─────────────────────────────────────────────────────────────────────────────
// ── INLINE SVG BANK (real, meaningful visual assets — not external requests) ──
// Keyed by icon name; content-driven so the AI/editor picks the icon, the
// registry resolves a crisp, themed glyph. No network, no emoji fallbacks.
function __svg(name, size) {
  size = size || 24;
  const s = 'viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  const paths = {
    'bolt': '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/>',
    'robot': '<rect x="4" y="8" width="16" height="10" rx="2"/><path d="M12 8V4M8 13h.01M16 13h.01"/><circle cx="12" cy="3" r="1"/>',
    'shield': '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
    'chart': '<path d="M3 21h18M7 17V9M12 17V5M17 17v-7"/>',
    'globe': '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18"/>',
    'layers': '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
    'filter': '<path d="M3 5h18M6 12h12M9 19h6"/>',
    'cursor': '<path d="M4 4l7 16 2-7 7-2L4 4z"/>',
    'sparkles': '<path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"/>',
    'zap': '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/>',
    'check': '<path d="M4 12l5 5 11-11"/>',
    'star': '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9L6.6 20l1-6.1L3.2 9.5l6.1-.9L12 3z"/>',
    'quote': '<path d="M7 7h4v6c0 3-1.5 5-4.5 6M13 7h4v6c0 3-1.5 5-4.5 6"/>',
    'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
    'cpu': '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M6 2v2M18 2v2M6 20v2M18 20v2"/>',
    'database': '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    'lock': '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    'play': '<path d="M8 5l11 7-11 7V5z"/>',
    'mail': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  };
  const body = paths[name] || paths['sparkles'];
  return '<svg ' + s + ' aria-hidden="true" ' + (name ? 'data-icon="' + name + '"' : '') + '>' + body + '</svg>';
}
// Avatar placeholder (deterministic initial + themed ring, no external asset).
function __avatar(content) {
  const name = (content && content.author) || '';
  const init = name.trim() ? name.trim()[0].toUpperCase() : '·';
  return '<span class="nx-avatar-inner" aria-hidden="true">' + init + '</span>';
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT RENDERER REGISTRY  (family → element + structure + children factory)
//    The renderer is registry-driven: a node's `component.family` selects the
//    element + presentation, and its `children` (a real sub-graph) drive nesting.
//    There is NO `if role === hero` chain. `role` is semantic metadata only.
// ─────────────────────────────────────────────────────────────────────────────
const NX_COMPONENT_DEFS = {
  section:   { tag: 'section' },
  container: { tag: 'div' },
  stack:     { tag: 'div', fallback: 'section' },
  grid:      { tag: 'div', fallback: 'section' },
  heading:   { tag: 'h2', leaf: true, text: (n) => n.content.text },
  paragraph: { tag: 'p', leaf: true, text: (n) => n.content.text },
  eyebrow:   { tag: 'p', leaf: true, text: (n) => n.content.text },
  icon:      { tag: 'span', leaf: true, render: (v) => __svg(v.content && v.content.name, v.content && v.content.size || 22) },
  image:     { tag: 'img', leaf: true, void: true, src: (n) => (n.asset && n.asset.url) || n.content.src, alt: (n) => n.content.alt || n.content.text },
  media:     { tag: 'figure' },
  nav:       { tag: 'nav' },
  hero:      { tag: 'section' },
  features:  { tag: 'section' },
  pricing:   { tag: 'section' },
  testimonials: { tag: 'section' },
  benefit:   { tag: 'section' },
  logos:     { tag: 'section' },
  cta:       { tag: 'section' },
  footer:    { tag: 'footer' },
  button:    { tag: 'button', leaf: true, text: (n) => n.content.label },
  text:      { tag: 'span', leaf: true, text: (n) => n.content.text },
  divider:   { tag: 'hr', leaf: true, void: true },
  badge:     { tag: 'span', leaf: true, text: (n) => n.content.text },
  stat:      { tag: 'div' },
  statValue: { tag: 'span', leaf: true, text: (n) => n.content.text },
  statLabel: { tag: 'span', leaf: true, text: (n) => n.content.text },
  avatar:    { tag: 'span', leaf: true, render: (v) => __avatar(v.content) },
  logostrip: { tag: 'div' },
  quote:     { tag: 'blockquote', leaf: true, text: (n) => n.content.text },
  card:      { tag: 'div' },
  marquee:   { tag: 'section' },
  stats:     { tag: 'section' },
  services:  { tag: 'section' },
  gallery:   { tag: 'section' },
  faq:       { tag: 'section' },
  contact:   { tag: 'section' },
  process:   { tag: 'section' },
};

// ─────────────────────────────────────────────────────────────────────────────
// CHILDREN FACTORIES — a component is NOT a hardcoded string. Each factory turns
// its content into a REAL nested sub-graph (icon → heading → paragraph → …),
// so every piece is independently editable and the renderer just walks children.
// ─────────────────────────────────────────────────────────────────────────────
const __btn = (label, tone, extra) => {
  const props = Object.assign({ tone: tone || 'primary' }, (extra && extra.props) || {});
  const out = { family: 'button', content: { label }, props };
  if (extra) { const rest = Object.assign({}, extra); delete rest.props; Object.assign(out, rest); }
  return out;
};
function __sectionHeader(eyebrow, heading, sub, center) {
  const c = center !== false;
  return {
    family: 'stack', role: 'section-header',
    props: { display: 'flex', direction: 'column', gap: '0.95rem', alignItems: 'center', maxWidth: 680, textAlign: 'center' },
    design: { textAlign: 'center', margin: '0 auto 0', paddingBottom: '0.5rem' },
    children: [
      eyebrow ? { family: 'eyebrow', content: { text: eyebrow }, props: { textAlign: 'center' }, design: { fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--nx-accent,#3b82f6)', textAlign: 'center', margin: '0 auto 0' } } : null,
      { family: 'heading', content: { text: heading || '' }, props: { level: 2, textAlign: 'center' }, design: { fontSize: 'clamp(1.8rem,4vw,2.6rem)', fontWeight: 800, lineHeight: 1.12, letterSpacing: '-0.02em', color: 'var(--nx-fg,#f5f5f7)', textAlign: 'center' } },
      sub ? { family: 'paragraph', content: { text: sub }, props: { textAlign: 'center' }, design: { fontSize: 17, lineHeight: 1.6, color: 'var(--nx-muted,#9aa3b2)', textAlign: 'center', maxWidth: 560 } } : null,
    ].filter(Boolean),
  };
}
// A polished "product window" — a real dashboard-style composition built fully
// from graph nodes (no fixed heights, no nested HTML strings).
function __productWindow(product) {
  const stats = (product && product.stats) || [{ v: '$128k', l: 'Revenue' }, { v: '64k', l: 'Leads' }, { v: '23.4k', l: 'Tasks run' }];
  const steps = (product && product.steps) || ['Enrich lead from form → CRM', 'Draft reply with AI copilot', 'Route to owner + set follow-up'];
  return {
    family: 'media', role: 'hero-visual', props: { display: 'flex', direction: 'column', alignItems: 'center', width: '100%' },
    design: { margin: '0', width: '100%' },
    children: [{
      family: 'container', role: 'app-window', props: { display: 'flex', direction: 'column', width: '100%', maxWidth: 600 },
      design: { backgroundColor: '#0d1526', border: '1px solid rgba(255,255,255,.10)', borderRadius: 18, boxShadow: '0 40px 90px rgba(0,0,0,.5)', overflow: 'hidden' },
      children: [
        { family: 'container', role: 'app-chrome', props: { display: 'flex', direction: 'row', alignItems: 'center', gap: '0.55rem', padding: '0.85rem 1.1rem' }, design: { borderBottom: '1px solid rgba(255,255,255,.07)' },
          children: [
            { family: 'container', role: 'window-dots', props: { display: 'flex', direction: 'row', gap: '0.35rem', alignItems: 'center' }, children: [
              { family: 'container', role: 'dot', design: { width: '10px', height: '10px', backgroundColor: '#ff5f57', borderRadius: 999 } },
              { family: 'container', role: 'dot', design: { width: '10px', height: '10px', backgroundColor: '#febc2e', borderRadius: 999 } },
              { family: 'container', role: 'dot', design: { width: '10px', height: '10px', backgroundColor: '#28c840', borderRadius: 999 } },
            ] },
            { family: 'text', content: { text: 'app.meridian.ai' }, design: { fontSize: 12, color: 'rgba(245,245,247,.5)', marginLeft: '.6rem', fontWeight: 600 } },
          ] },
        { family: 'grid', role: 'app-stat-grid', props: { display: 'grid', columns: 3, gap: '0.8rem', padding: '1.2rem 1.1rem 0.4rem' },
          children: stats.map((s, i) => ({
            family: 'container', role: 'app-stat', props: { display: 'flex', direction: 'column', gap: '0.2rem', padding: '0.9rem' },
            design: { backgroundColor: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12 },
            children: [
              { family: 'statValue', content: { text: s.v }, design: { fontSize: 22, fontWeight: 800, color: i === 0 ? '#ff8a3c' : 'var(--nx-fg,#f5f5f7)', lineHeight: 1.1 } },
              { family: 'statLabel', content: { text: s.l }, design: { fontSize: 12, color: 'var(--nx-muted,#9aa3b2)', letterSpacing: '.02em' } },
            ],
          })) },
        { family: 'container', role: 'app-flow', props: { display: 'flex', direction: 'column', gap: '0.6rem', padding: '0.8rem 1.1rem 1.2rem' },
          children: [
            { family: 'stack', role: 'section-header', props: { display: 'flex', direction: 'column', gap: '0.2rem' }, design: { margin: '0' },
              children: [
                { family: 'eyebrow', content: { text: 'Live automation' }, design: { fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700, color: 'rgba(245,245,247,.55)' } },
              ] },
            ...steps.map((t, i) => ({
              family: 'container', role: 'flow-row', props: { display: 'flex', direction: 'row', alignItems: 'center', gap: '0.55rem', padding: '0.6rem 0.8rem' },
              design: { backgroundColor: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10, color: '#7ee2b8' },
              children: [
                { family: 'icon', content: { name: 'check' }, design: { color: '#7ee2b8', flex: 'none' } },
                { family: 'text', content: { text: t }, design: { fontSize: 13, color: 'var(--nx-fg,#f5f5f7)' } },
                { family: 'badge', content: { text: i === 0 ? '· running' : 'done' }, design: { marginLeft: 'auto', fontSize: 11, color: '#7ee2b8', backgroundColor: 'rgba(126,226,184,.12)', borderRadius: 999, padding: '.18rem .6rem', fontWeight: 600 } },
              ],
            })),
          ] },
        { family: 'container', role: 'app-toolbar', props: { display: 'flex', direction: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '0.8rem', padding: '0.9rem 1.1rem' }, design: { borderTop: '1px solid rgba(255,255,255,.07)' },
          children: [
            { family: 'text', content: { text: '● 12,438 runs this week' }, design: { fontSize: 12, color: 'rgba(245,245,247,.6)' } },
            __btn('Open studio', 'secondary', { design: { fontSize: 13, padding: '.55rem .9rem' } }),
          ] },
      ],
    }],
  };
}
// A trust/metrics card for the benefit split (built from nodes, no fixed heights).
function __metricCard() {
  return { family: 'media', role: 'benefit-visual', props: { display: 'flex', direction: 'column', alignItems: 'center' },
    children: [{
      family: 'container', role: 'metric-card', props: { display: 'flex', direction: 'column', gap: '0.9rem', width: '100%', maxWidth: 460 },
      design: { backgroundColor: '#0d1526', border: '1px solid rgba(255,255,255,.10)', borderRadius: 18, padding: '1.4rem', boxShadow: '0 40px 90px rgba(0,0,0,.4)' },
      children: [
        { family: 'grid', role: 'metric-top', props: { display: 'grid', columns: 2, gap: '1rem' },
          children: [
            { family: 'container', role: 'metric-block', props: { display: 'flex', direction: 'column', gap: '0.2rem' }, children: [
              { family: 'eyebrow', content: { text: 'Time saved' }, design: { fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, color: 'rgba(245,245,247,.5)' } },
              { family: 'statValue', content: { text: '11.2 hrs' }, design: { fontSize: 30, fontWeight: 800, color: '#ff8a3c', lineHeight: 1 } },
              { family: 'statLabel', content: { text: 'per person / week' }, design: { fontSize: 12, color: 'var(--nx-muted,#9aa3b2)' } },
            ] },
            { family: 'container', role: 'metric-block', props: { display: 'flex', direction: 'column', gap: '0.2rem' }, children: [
              { family: 'eyebrow', content: { text: 'Error rate' }, design: { fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, color: 'rgba(245,245,247,.5)' } },
              { family: 'statValue', content: { text: '↓ 92%' }, design: { fontSize: 30, fontWeight: 800, color: '#7ee2b8', lineHeight: 1 } },
              { family: 'statLabel', content: { text: 'across automated flows' }, design: { fontSize: 12, color: 'var(--nx-muted,#9aa3b2)' } },
            ] },
          ] },
        { family: 'container', role: 'metric-bar', props: { display: 'flex', direction: 'column', gap: '0.5rem' },
          children: [
            { family: 'container', role: 'row', props: { display: 'flex', direction: 'row', alignItems: 'center', justifyContent: 'space-between' }, children: [
              { family: 'text', content: { text: 'Automation coverage' }, design: { fontSize: 13, color: 'var(--nx-muted,#9aa3b2)' } },
              { family: 'text', content: { text: '96%' }, design: { fontSize: 13, fontWeight: 700, color: 'var(--nx-fg,#f5f5f7)' } },
            ] },
            { family: 'container', role: 'bar-track', props: { display: 'flex', direction: 'row', width: '100%' }, design: { backgroundColor: 'rgba(255,255,255,.08)', borderRadius: 999, overflow: 'hidden', height: '8px' },
              children: [{ family: 'container', role: 'bar-fill', props: { width: '96%' }, design: { backgroundColor: '#ff6b1a', borderRadius: 999, height: '8px' } }] },
          ] },
      ],
    }] };
}

const NX_CHILDREN = {
  hero: (c, t) => {
    const v = (t && t.variant) || '';
    const centered = /3d|cinematic|centered|centrifuge/.test(v);
    const eyebrow = c.eyebrow || 'AI Automation Platform';
    const headline = c.headline || 'Automate the work. Amplify what your team can build.';
    const sub = c.sub || 'Meridian turns busywork into autonomous workflows, so your team ships faster with fewer errors and full visibility into every process.';
    const actions = { family: 'stack', role: 'hero-actions', props: { display: 'flex', direction: 'row', gap: '0.8rem', alignItems: 'center' }, children: [ __btn(c.cta || 'Start free', 'primary'), __btn(c.secondary || 'Watch the demo', 'secondary') ] };
    const visual = __productWindow(c);
    if (centered) {
      return [
        { family: 'stack', role: 'hero-stage', props: { display: 'flex', direction: 'column', alignItems: 'center', gap: '1.35rem', textAlign: 'center' },
          children: [
            { family: 'eyebrow', content: { text: eyebrow }, design: { fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--nx-accent,#3b82f6)', textAlign: 'center' } },
            { family: 'heading', content: { text: headline }, props: { level: 1, textAlign: 'center' }, design: { fontSize: 'clamp(2.1rem,5vw,3.7rem)', fontWeight: 800, lineHeight: 1.04, letterSpacing: '-0.03em', textAlign: 'center' } },
            { family: 'paragraph', content: { text: sub }, props: { textAlign: 'center' }, design: { fontSize: 18, lineHeight: 1.6, color: 'var(--nx-muted,#9aa3b2)', textAlign: 'center', maxWidth: 640 } },
            actions, visual,
          ] },
      ];
    }
    return [
      { family: 'grid', role: 'hero-content', props: { display: 'grid', columns: 2, gap: '3rem', alignItems: 'center' },
        children: [
          { family: 'stack', role: 'hero-copy', props: { display: 'flex', direction: 'column', gap: '1.35rem' },
            children: [
              { family: 'eyebrow', content: { text: eyebrow }, design: { fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--nx-accent,#3b82f6)' } },
              { family: 'heading', content: { text: headline }, props: { level: 1 }, design: { fontSize: 'clamp(2.1rem,4.6vw,3.6rem)', fontWeight: 800, lineHeight: 1.06, letterSpacing: '-0.03em', maxWidth: '15ch' } },
              { family: 'paragraph', content: { text: sub }, design: { fontSize: 18, lineHeight: 1.6, color: 'var(--nx-muted,#9aa3b2)', maxWidth: 560 } },
              __btn(c.cta || 'Start free', 'primary'),
              { family: 'stack', role: 'hero-actions', props: { display: 'flex', direction: 'row', gap: '0.8rem', alignItems: 'center' }, children: [ __btn(c.secondary || 'Watch the demo', 'secondary') ] },
              { family: 'container', role: 'hero-trust', props: { display: 'flex', direction: 'row', gap: '1.4rem', alignItems: 'center' },
                children: [
                  { family: 'container', role: 'trust-item', props: { display: 'flex', direction: 'row', gap: '0.4rem', alignItems: 'center' }, children: [ { family: 'icon', content: { name: 'star' }, design: { color: '#ffb020' } }, { family: 'text', content: { text: '4.9/5' }, design: { fontSize: 14, fontWeight: 600, color: 'var(--nx-fg,#f5f5f7)' } } ] },
                  { family: 'text', content: { text: '·' }, design: { color: 'rgba(245,245,247,.3)' } },
                  { family: 'container', role: 'trust-item', props: { display: 'flex', direction: 'row', gap: '0.4rem', alignItems: 'center' }, children: [ { family: 'icon', content: { name: 'shield' }, design: { color: '#7ee2b8' } }, { family: 'text', content: { text: 'SOC 2 Type II' }, design: { fontSize: 14, fontWeight: 600, color: 'var(--nx-fg,#f5f5f7)' } } ] },
                ] },
            ] },
          visual,
        ] },
    ];
  },

  features: (c, t) => [
    { family: 'stack', role: 'features-inner', props: { display: 'flex', direction: 'column', gap: '3rem' },
      children: [
        __sectionHeader(c.eyebrow || 'Platform', c.heading || 'Everything you need to run work on autopilot', c.sub || 'Connect the tools you already use and let Meridian orchestrate the busywork — from first touch to revenue.'),
        { family: 'grid', role: 'features-grid', props: { display: 'grid', columns: (c.items || []).length || 3, gap: '1.4rem' },
          children: (c.items || []).map(it => ({
            family: 'card', role: 'feature', props: { display: 'flex', direction: 'column', gap: '0.9rem' },
            design: { backgroundColor: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 18, padding: '1.7rem' },
            children: [
              { family: 'container', role: 'feature-icon', props: { display: 'flex', direction: 'row', alignItems: 'center', justifyContent: 'center' }, design: { backgroundColor: 'rgba(255,107,26,.13)', color: '#ff8a3c', borderRadius: 14, padding: '0.75rem', marginBottom: '0.4rem', width: '48px' }, children: [ { family: 'icon', content: { name: it.icon || 'sparkles' } } ] },
              { family: 'heading', content: { text: it.title || '' }, props: { level: 3 }, design: { fontSize: 19, fontWeight: 700, lineHeight: 1.25, color: 'var(--nx-fg,#f5f5f7)' } },
              { family: 'paragraph', content: { text: it.text || '' }, design: { fontSize: 15, lineHeight: 1.6, color: 'var(--nx-muted,#9aa3b2)' } },
            ],
          })) },
      ] },
  ],

  benefit: (c, t) => [
    { family: 'stack', role: 'benefit-inner', props: { display: 'flex', direction: 'column', gap: '3rem' },
      children: [
        { family: 'grid', role: 'benefit-split', props: { display: 'grid', columns: 2, gap: '3rem', alignItems: 'center' },
          children: [
            { family: 'stack', role: 'benefit-copy', props: { display: 'flex', direction: 'column', gap: '1.3rem' },
              children: [
                { family: 'eyebrow', content: { text: c.eyebrow || 'Why Meridian' }, design: { fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--nx-accent,#3b82f6)' } },
                { family: 'heading', content: { text: c.heading || 'Built to move at the speed of your roadmap' }, props: { level: 2 }, design: { fontSize: 'clamp(1.8rem,4vw,2.6rem)', fontWeight: 800, lineHeight: 1.12, letterSpacing: '-0.02em', color: 'var(--nx-fg,#f5f5f7)' } },
                { family: 'paragraph', content: { text: c.sub || '' }, design: { fontSize: 17, lineHeight: 1.6, color: 'var(--nx-muted,#9aa3b2)' } },
                { family: 'stack', role: 'benefit-checks', props: { display: 'flex', direction: 'column', gap: '0.9rem' },
                  children: (c.checks || ['Launch automations in minutes, not sprints', 'Human-in-the-loop approvals where you need them', 'Dashboards that surface risk before it compounds']).map(chk => ({
                    family: 'container', role: 'check-row', props: { display: 'flex', direction: 'row', gap: '0.7rem', alignItems: 'center' },
                    children: [ { family: 'icon', content: { name: 'check' }, design: { color: '#7ee2b8', flex: 'none' } }, { family: 'text', content: { text: chk }, design: { fontSize: 16, color: 'var(--nx-fg,#f5f5f7)' } } ],
                  })) },
                __btn(c.cta || 'Explore the platform', 'secondary'),
              ] },
            __metricCard(),
          ] },
      ] },
  ],

  logos: (c, t) => [
    { family: 'stack', role: 'logos-inner', props: { display: 'flex', direction: 'column', gap: '1.6rem' },
      children: [
        { family: 'eyebrow', content: { text: c.eyebrow || 'Trusted by teams shipping the future' }, props: { textAlign: 'center' }, design: { fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--nx-muted,#9aa3b2)', textAlign: 'center' } },
        { family: 'container', role: 'logo-row', props: { display: 'flex', direction: 'row', gap: '2.6rem', alignItems: 'center', justifyContent: 'center', wrap: true },
          children: (c.items || ['NORTHBEAM', 'static', 'OPTIC', 'Helios', 'VERTEX', 'aperture']).map(n => ({ family: 'text', content: { text: n }, design: { fontSize: 16, fontWeight: 700, letterSpacing: '0.04em', color: 'rgba(245,245,247,.5)' } })) },
      ] },
  ],

  testimonials: (c, t) => [
    { family: 'stack', role: 'testimonials-inner', props: { display: 'flex', direction: 'column', gap: '3rem' },
      children: [
        __sectionHeader(c.eyebrow || 'Loved by builders', c.heading || 'Teams run their best work on Meridian', c.sub || ''),
        { family: 'grid', role: 'testimonials-grid', props: { display: 'grid', columns: (c.items || []).length || 3, gap: '1.4rem' },
          children: (c.items || []).map(it => ({
            family: 'card', role: 'quote', props: { display: 'flex', direction: 'column', gap: '1rem' },
            design: { backgroundColor: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 18, padding: '1.7rem' },
            children: [
              { family: 'icon', content: { name: 'quote' }, design: { color: 'rgba(255,107,26,.6)', fontSize: 30 } },
              { family: 'quote', content: { text: it.quote || '' }, design: { fontSize: 16, lineHeight: 1.6, color: 'var(--nx-fg,#f5f5f7)', margin: '0' } },
              { family: 'container', role: 'quote-author', props: { display: 'flex', direction: 'row', gap: '0.8rem', alignItems: 'center' },
                children: [
                  { family: 'avatar', content: { author: it.author || '' }, design: { backgroundColor: 'rgba(255,107,26,.2)', color: '#ff8a3c', borderRadius: 999, padding: '0.55rem 0.7rem', fontWeight: 700 } },
                  { family: 'container', role: 'author-block', props: { display: 'flex', direction: 'column', gap: '0.1rem' }, children: [
                    { family: 'text', content: { text: it.author || '' }, design: { fontSize: 14, fontWeight: 700, color: 'var(--nx-fg,#f5f5f7)' } },
                    { family: 'text', content: { text: it.role || '' }, design: { fontSize: 12, color: 'var(--nx-muted,#9aa3b2)' } },
                  ] },
                ] },
            ],
          })) },
      ] },
  ],

  pricing: (c, t) => {
    const tiers = (c.tiers || []).map((tr, i) => ({
      family: 'card', role: 'plan', props: { display: 'flex', direction: 'column', gap: '1.1rem' },
      design: Object.assign({ backgroundColor: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 20, padding: '1.9rem' }, (i === 1 ? { border: '1px solid rgba(255,107,26,.6)', boxShadow: '0 20px 60px rgba(255,107,26,.16)', backgroundColor: 'rgba(255,107,26,.04)' } : {})),
      children: [
        (tr.popular || i === 1) ? { family: 'badge', content: { text: 'Most popular' }, props: { alignSelf: 'flex-start' }, design: { alignSelf: 'flex-start', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, color: '#0a0b0d', backgroundColor: '#ff7a3d', borderRadius: 999, padding: '.3rem .7rem' } } : null,
        { family: 'heading', content: { text: tr.name || 'Plan' }, props: { level: 3 }, design: { fontSize: 20, fontWeight: 700, color: 'var(--nx-fg,#f5f5f7)' } },
        { family: 'stack', role: 'plan-price', props: { display: 'flex', direction: 'row', gap: '0.4rem', alignItems: 'baseline' }, children: [
          { family: 'text', content: { text: tr.price || '' }, design: { fontSize: 42, fontWeight: 800, color: 'var(--nx-fg,#f5f5f7)', lineHeight: 1 } },
          { family: 'text', content: { text: tr.unit || '/mo' }, design: { fontSize: 14, color: 'var(--nx-muted,#9aa3b2)' } },
        ] },
        { family: 'paragraph', content: { text: tr.desc || '' }, design: { fontSize: 14, color: 'var(--nx-muted,#9aa3b2)', lineHeight: 1.5 } },
        { family: 'stack', role: 'plan-features', props: { display: 'flex', direction: 'column', gap: '0.6rem' },
          children: (tr.features || []).map(f => ({ family: 'container', role: 'feature-row', props: { display: 'flex', direction: 'row', gap: '0.6rem', alignItems: 'center' }, children: [ { family: 'icon', content: { name: 'check' }, design: { color: '#7ee2b8', flex: 'none' } }, { family: 'text', content: { text: f }, design: { fontSize: 14, color: 'var(--nx-fg,#f5f5f7)' } } ] })) },
        { family: 'divider', design: { borderColor: 'rgba(255,255,255,.08)', margin: '.2rem 0' } },
        __btn(tr.cta || 'Choose ' + (tr.name || 'plan'), i === 1 ? 'primary' : 'secondary', { props: { width: '100%' } }),
      ].filter(Boolean),
    }));
    return [
      { family: 'stack', role: 'pricing-inner', props: { display: 'flex', direction: 'column', gap: '3rem' },
        children: [
          __sectionHeader(c.eyebrow || 'Pricing', c.heading || 'Start free, scale as you automate', c.sub || ''),
          { family: 'grid', role: 'pricing-grid', props: { display: 'grid', columns: (c.tiers || []).length || 3, gap: '1.4rem', alignItems: 'stretch' },
            children: tiers },
        ] },
    ];
  },

  cta: (c, t) => [
    { family: 'container', role: 'cta-inner', props: { display: 'flex', direction: 'column', alignItems: 'center', gap: '1.4rem', width: '100%', maxWidth: 720, textAlign: 'center' },
      design: { backgroundColor: 'rgba(255,107,26,.10)', border: '1px solid rgba(255,107,26,.28)', borderRadius: 24, padding: 'clamp(2rem,5vw,3.4rem)', textAlign: 'center', boxShadow: '0 30px 80px rgba(255,107,26,.12)' },
      children: [
        { family: 'eyebrow', content: { text: c.eyebrow || 'Get started' }, design: { fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700, color: '#ff8a3c' } },
        { family: 'heading', content: { text: c.heading || 'Ready to put your workflow on autopilot?' }, props: { level: 2, textAlign: 'center' }, design: { fontSize: 'clamp(1.9rem,4.5vw,3rem)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em', textAlign: 'center', color: 'var(--nx-fg,#f5f5f7)' } },
        { family: 'paragraph', content: { text: c.sub || '' }, props: { textAlign: 'center' }, design: { fontSize: 17, lineHeight: 1.6, color: 'var(--nx-muted,#9aa3b2)', textAlign: 'center', maxWidth: 540 } },
        { family: 'stack', role: 'cta-actions', props: { display: 'flex', direction: 'row', gap: '0.8rem', alignItems: 'center', justifyContent: 'center' }, children: [ __btn(c.cta || 'Start free', 'primary'), __btn(c.secondary || 'Talk to sales', 'ghost') ] },
        { family: 'text', content: { text: c.note || 'Free 14-day trial · No credit card required' }, design: { fontSize: 13, color: 'var(--nx-muted,#9aa3b2)' } },
      ] },
  ],

  nav: (c, t) => [
    { family: 'container', role: 'nav-inner', props: { display: 'flex', direction: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem', maxWidth: 'var(--nx-max-width,1200px)', padding: '0 clamp(1rem,4vw,2rem)' },
      children: [
        { family: 'container', role: 'nav-brand', props: { display: 'flex', direction: 'row', gap: '0.6rem', alignItems: 'center' }, children: [
          { family: 'icon', content: { name: 'bolt' }, design: { color: '#ff8a3c', fontSize: 22 } },
          { family: 'text', content: { text: c.brand || 'Meridian' }, design: { fontWeight: 800, fontSize: 20, letterSpacing: '-0.01em', color: 'var(--nx-fg,#fff)' } },
        ] },
        { family: 'container', role: 'nav-links', props: { display: 'flex', direction: 'row', gap: '1.4rem', alignItems: 'center' }, design: { display: 'flex' }, children: (c.links || ['Product', 'Solutions', 'Pricing', 'Resources']).map(l => ({ family: 'text', content: { text: l }, design: { fontSize: 15, color: 'var(--nx-muted,#aab3c0)', fontWeight: 500 } })) },
        __btn(c.cta || 'Get started', 'primary', { design: { fontSize: 14, padding: '.6rem 1.1rem' } }),
      ] },
  ],

  footer: (c, t) => [
    { family: 'container', role: 'footer-inner', props: { display: 'flex', direction: 'column', gap: '2.4rem', maxWidth: 'var(--nx-max-width,1200px)', padding: '0 clamp(1rem,4vw,2rem)' },
      children: [
        { family: 'grid', role: 'footer-grid', props: { display: 'grid', columns: 4, gap: '2.4rem' },
          children: [
            { family: 'stack', role: 'footer-brand', props: { display: 'flex', direction: 'column', gap: '0.7rem' }, children: [
              { family: 'container', role: 'brand-row', props: { display: 'flex', direction: 'row', gap: '0.6rem', alignItems: 'center' }, children: [ { family: 'icon', content: { name: 'bolt' }, design: { color: '#ff8a3c' } }, { family: 'text', content: { text: c.name || 'Meridian' }, design: { fontWeight: 800, fontSize: 18, color: 'var(--nx-fg,#fff)' } } ] },
              { family: 'paragraph', content: { text: c.tagline || 'Autonomous workflows for the teams building what\'s next.' }, design: { fontSize: 14, color: 'var(--nx-muted,#9aa3b2)', lineHeight: 1.6 } },
            ] },
            ...[{ h: 'Product', links: ['Workflows', 'AI Copilot', 'Integrations', 'Pricing'] }, { h: 'Company', links: ['About', 'Careers', 'Blog', 'Press'] }, { h: 'Resources', links: ['Docs', 'Support', 'Community', 'Security'] }].map(col => ({
              family: 'stack', role: 'footer-col', props: { display: 'flex', direction: 'column', gap: '0.7rem' },
              children: [
                { family: 'eyebrow', content: { text: col.h }, design: { fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, color: 'rgba(245,245,247,.5)' } },
                ...col.links.map(l => ({ family: 'text', content: { text: l }, design: { fontSize: 14, color: 'var(--nx-muted,#9aa3b2)' } })),
              ],
            })),
          ] },
        { family: 'container', role: 'footer-legal', props: { display: 'flex', direction: 'row', justifyContent: 'space-between', gap: '1rem', wrap: true }, design: { borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: '1.4rem' },
          children: [
            { family: 'text', content: { text: '© ' + new Date().getFullYear() + ' ' + (c.name || 'Meridian') + '. All rights reserved.' }, design: { fontSize: 13, color: 'var(--nx-muted,#8a93a2)' } },
            { family: 'container', role: 'legal-links', props: { display: 'flex', direction: 'row', gap: '1.4rem' }, children: ['Privacy', 'Terms', 'Status'].map(l => ({ family: 'text', content: { text: l }, design: { fontSize: 13, color: 'var(--nx-muted,#8a93a2)' } })) },
          ] },
      ] },
  ],
  // ── MARQUEE: an endlessly scrolling ticker of the client's capabilities ──
  marquee: (c, t) => [
    { family: 'container', role: 'marquee-track', props: { display: 'flex', direction: 'row', wrap: false },
      children: (function () {
        const items = (c.items || ['Septic Tanks', 'Soakaways', 'CCTV Surveys', 'Drain Jetting', 'Groundworks', 'Security Gates']);
        // The template's marquee loops seamlessly by translating -50%, which
        // requires the item set to be duplicated. We emit the set twice so the
        // ticker reads as continuous rather than running off the end.
        const render = (k) => items.map(it => ({ family: 'text', content: { text: it }, design: { fontSize: '.82rem', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--nx-muted,#97A3BA)', fontWeight: 500 }, } ));
        return render(0).concat(render(1));
      }()) },
  ],

  // ── STATS: a 4-up metric band with the orange left-border accent ──
  stats: (c, t) => [
    { family: 'stack', role: 'stats-inner', props: { display: 'flex', direction: 'column', gap: '2.6rem' },
      children: [
        __sectionHeader(c.eyebrow || 'By the numbers', c.heading || 'Decades of trusted, lasting work', c.sub || 'Right across the region, on systems built to perform for decades.'),
        { family: 'grid', role: 'stats-grid', props: { display: 'grid', columns: 4, gap: '1.5rem' },
          children: (c.items || [{ v: '40+', l: 'Years of experience' }, { v: '2,400', l: 'Systems installed' }, { v: '5.0', l: 'Google rating' }, { v: '100%', l: 'Compliance assured' }]).map(it => ({
            family: 'container', role: 'stat-card', props: { display: 'flex', direction: 'column', gap: '0.2rem' },
            children: [
              { family: 'statValue', content: { text: it.v }, design: { fontSize: 'clamp(2.5rem,5vw,3.6rem)', fontWeight: 700, lineHeight: 1, letterSpacing: '-.03em', color: 'var(--nx-secondary,#FF5F00)' } },
              { family: 'statLabel', content: { text: it.l }, design: { fontSize: '.65rem', letterSpacing: '.17em', textTransform: 'uppercase', color: 'var(--nx-muted,#97A3BA)', marginTop: '12px' } },
            ],
          })) },
      ] },
  ],

  // ── SERVICES: conic-border hover cards ──
  services: (c, t) => [
    { family: 'stack', role: 'services-inner', props: { display: 'flex', direction: 'column', gap: '3rem' },
      children: [
        __sectionHeader(c.eyebrow || 'What we do', c.heading || 'Engineering for the long run', c.sub || 'Every system installed is built to perform for decades \u2014 quietly, reliably, and in full compliance.'),
        { family: 'grid', role: 'services-grid', props: { display: 'grid', columns: 3, gap: '1.6rem' },
          children: (c.items || [
            { icon: 'database', tag: 'Off-mains', title: 'Septic Tank Install', text: 'Full groundworks and heavy-duty tank installation for homes and businesses, built to last.' },
            { icon: 'filter', tag: 'Drainage', title: 'Soakaways & Drainage Fields', text: 'Correctly sized and consented drainage fields that keep treating effluent for decades.' },
            { icon: 'zap', tag: 'Clearing', title: 'Drain Jetting & CCTV', text: 'High-pressure jetting and CCTV inspection that clears blockages and proves the result.' },
            { icon: 'layers', tag: 'Civil', title: 'Groundworks & Surfacing', text: 'Site preparation, excavation, and durable surfacing to complete the job end-to-end.' },
            { icon: 'shield', tag: 'Security', title: 'Gates & Barriers', text: 'Fabricated and fitted security gates and barriers, engineered for everyday use.' },
            { icon: 'clock', tag: '24/7', title: 'Emergency Call-Out', text: 'Short-notice and round-the-clock response when a system fails and it cannot wait.' },
          ]).map(it => ({
            family: 'card', role: 'service-card', props: { display: 'flex', direction: 'column', gap: '0.6rem' },
            children: [
              { family: 'container', role: 'feature-icon', props: { display: 'flex', direction: 'row' }, design: { width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(255,95,0,.13)', color: 'var(--nx-secondary,#FF5F00)', marginBottom: '.6rem' }, children: [ { family: 'icon', content: { name: it.icon || 'bolt' } } ] },
              { family: 'badge', content: { text: it.tag || '' }, props: { alignSelf: 'flex-start' }, design: { alignSelf: 'flex-start', fontSize: '.6rem', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--nx-secondary,#FF5F00)' } },
              { family: 'heading', content: { text: it.title || '' }, props: { level: 3 }, design: { fontSize: '1.2rem', textTransform: 'uppercase', letterSpacing: '-.01em', color: 'var(--nx-fg,#EEF2F8)' } },
              { family: 'paragraph', content: { text: it.text || '' }, design: { fontSize: '.85rem', color: 'var(--nx-muted,#97A3BA)', margin: '0' } },
            ],
          })) },
      ] },
  ],

  // ── PROCESS: 4 numbered steps ──
  process: (c, t) => [
    { family: 'stack', role: 'process-inner', props: { display: 'flex', direction: 'column', gap: '3rem' },
      children: [
        __sectionHeader(c.eyebrow || 'How it works', c.heading || 'From enquiry to a system that lasts', c.sub || 'A clear, proven process with no surprises \u2014 you talk to the owner at every step.'),
        { family: 'grid', role: 'process-grid', props: { display: 'grid', columns: 4, gap: '1.6rem' },
          children: (c.items || [
            { n: '01', title: 'Free site visit', text: 'Martin assesses your site, access, and existing system with no obligation.' },
            { n: '02', title: 'Fixed quote', text: 'A clear, all-inclusive price with no hidden extras, in writing.' },
            { n: '03', title: 'Expert install', text: 'Groundworks and installation by a family team that cares about the detail.' },
            { n: '04', title: 'Decades of support', text: 'Backed by compliance paperwork and help whenever you need it.' },
          ]).map(it => ({
            family: 'container', role: 'process-step', props: { display: 'flex', direction: 'column', gap: '0.6rem' },
            children: [
              { family: 'badge', content: { text: it.n || '01' }, props: { alignSelf: 'flex-start' }, design: { alignSelf: 'flex-start', fontSize: '.65rem', fontWeight: 700, color: 'var(--nx-secondary,#FF5F00)' } },
              { family: 'heading', content: { text: it.title || '' }, props: { level: 3 }, design: { fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '-.01em', color: 'var(--nx-fg,#EEF2F8)', margin: '.2rem 0 .5rem' } },
              { family: 'paragraph', content: { text: it.text || '' }, design: { fontSize: '.85rem', color: 'var(--nx-muted,#97A3BA)', margin: '0' } },
            ],
          })) },
      ] },
  ],

  // ── FAQ: accordion items ──
  faq: (c, t) => [
    { family: 'stack', role: 'faq-inner', props: { display: 'flex', direction: 'column', gap: '3rem' },
      children: [
        __sectionHeader(c.eyebrow || 'Common questions', c.heading || 'Frequently asked', c.sub || 'Straight answers to the questions we hear most.'),
        { family: 'stack', role: 'faq-list', props: { display: 'flex', direction: 'column', gap: '0.9rem' },
          children: (c.items || [
            { q: 'How long does a septic tank installation take?', a: 'A typical residential install takes 3\u20135 days depending on ground conditions and access. We give you a clear schedule up front.' },
            { q: 'Do I need consent or a permit?', a: 'Most systems need the relevant environmental consent. We handle the paperwork and ensure everything is fully compliant.' },
            { q: 'What areas do you cover?', a: 'We cover Staffordshire, Shropshire, Derbyshire and Cheshire, working across the region from our base near Eccleshall.' },
            { q: 'Do you offer emergency call-outs?', a: 'Yes \u2014 for drainage and system failures we offer short-notice and 24/7 emergency response across our coverage area.' },
          ]).map(it => ({
            family: 'container', role: 'faq-item', props: { display: 'flex', direction: 'column', gap: '0.6rem' },
            children: [
              { family: 'heading', content: { text: it.q || '' }, props: { level: 4 }, design: { fontSize: '1.05rem', margin: '0', padding: '1.3rem 1.4rem 0.4rem', color: 'var(--nx-fg,#EEF2F8)' } },
              { family: 'paragraph', content: { text: it.a || '' }, design: { fontSize: '.9rem', color: 'var(--nx-muted,#97A3BA)', margin: '0', padding: '0 1.4rem 1.3rem' } },
            ],
          })) },
      ] },
  ],

  // ── CONTACT: split form + info card ──
  contact: (c, t) => [
    { family: 'grid', role: 'contact-grid', props: { display: 'grid', columns: 2, gap: '3rem', alignItems: 'start' },
      children: [
        { family: 'stack', role: 'contact-form', props: { display: 'flex', direction: 'column', gap: '1.2rem' },
          children: [
            __sectionHeader(c.eyebrow || 'Get in touch', c.heading || 'Request a free quote', c.sub || 'Tell us about your project and we\u2019ll be in touch to arrange a free site visit.'),
            ...(c.fields || [{ label: 'Full name', ph: 'John Smith' }, { label: 'Phone', ph: '07700 900000' }, { label: 'Email', ph: 'you@email.com' }]).map(f => ({
              family: 'container', role: 'contact-field', props: { display: 'flex', direction: 'column', gap: '0.4rem' },
              children: [
                { family: 'text', content: { text: f.label || '' }, design: { fontSize: '.75rem', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--nx-muted,#97A3BA)' } },
                { family: 'text', content: { text: f.ph || '' }, design: { fontSize: '.95rem', color: 'var(--nx-fg,#EEF2F8)', background: 'var(--nx-bg,#060912)', border: '1px solid var(--nx-line-2,rgba(255,255,255,.13))', borderRadius: '9px', padding: '.85rem 1rem' } },
              ],
            })),
            __btn(c.cta || 'Submit request', 'primary', { props: { width: '100%' }, design: { width: '100%', padding: '.95rem 1rem' } }),
          ] },
        { family: 'container', role: 'contact-card', props: { display: 'flex', direction: 'column', gap: '0.9rem' },
          children: [
            { family: 'badge', content: { text: 'Direct to the owner' }, props: { alignSelf: 'flex-start' }, design: { alignSelf: 'flex-start', fontSize: '.6rem', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--nx-secondary,#FF5F00)' } },
            { family: 'heading', content: { text: c.phoneTitle || 'Speak to Martin directly' }, props: { level: 3 }, design: { fontSize: '1.25rem', margin: '0 0 .3rem', color: 'var(--nx-fg,#EEF2F8)' } },
            { family: 'paragraph', content: { text: c.phone || '07721 511814' }, design: { fontSize: '1rem', color: 'var(--nx-secondary,#FF5F00)', fontWeight: 700, margin: '0' } },
            { family: 'paragraph', content: { text: c.note || 'Base & coverage: Staffs \u00b7 Shrops \u00b7 Derbys \u00b7 Cheshire \u2014 short-notice & 24/7 emergency.' }, design: { fontSize: '.9rem', color: 'var(--nx-muted,#97A3BA)', margin: '0' } },
            { family: 'divider' },
            { family: 'paragraph', content: { text: c.email || 'info@meridian.app' }, design: { fontSize: '.9rem', color: 'var(--nx-fg,#EEF2F8)', margin: '0' } },
          ] },
      ] },
  ],

};

const NX_LEAF_TAGS = { heading: ['h1','h2','h3'], paragraph: 'p', button: 'button', image: 'img' }; // informational

// ─────────────────────────────────────────────────────────────────────────────
// 2. BUILD COMPONENTS AS REAL GRAPHS (atomic, via the mutation engine)
//    nxSeedComponent emits the whole subtree as node.create ops with parentId, so
//    a Hero is genuinely a graph (hero → copy → heading/paragraph/button + visual)
//    enforced by the integrity gate at commit time.
// ─────────────────────────────────────────────────────────────────────────────
function __kid(project, prefix) { return (prefix || 'n') + ':' + (1000000 + Math.floor(Math.random() * 9000000)); }
function __flattenChildren(spec, parentId, project) {
  const out = [];
  const id = spec.id || __kid(project, (spec.family || 'n').slice(0, 3));
  // Children are NOT page sections: their semanticRole is always 'none'. The
  // original spec.role (e.g. 'hero-copy') is preserved as content.role for
  // inspection/editing, while the renderer keys behavior off `family`.
  const content = Object.assign({}, spec.content);
  if (spec.role) content.role = spec.role;
  // Presentational styling lives in the node's DESIGN sheet (a first-class concern),
  // not in the layout-contract `props`. Factories may pass `design` on a child spec
  // and it is carried into the graph so it survives serialization + re-render.
  const node = { id, component: { family: spec.family, variant: spec.variant || '' }, semanticRole: 'none', props: Object.assign({}, spec.props), content };
  if (spec.design) node.design = Object.assign({}, spec.design);
  out.push({ op: 'node.create', node, parentId });
  for (const k of (spec.children || [])) out.push(...__flattenChildren(k, id, project));
  return out;
}
// Build a component as a REAL nested graph atomically (one patch → one atomic
// commit): a Hero is hero → copy(grid) → heading/paragraph/button + visual(media).
function nxSeedComponent(project, family, variant, content, role) {
  const rootId = __kid(project, (family || 'n').slice(0, 3));
  const ops = [{ op: 'node.create', node: { id: rootId, component: { family, variant: variant || '' }, semanticRole: role || family, props: Object.assign({}, __defaultProps(family, variant)), content: Object.assign({}, content) } }];
  const factory = NX_CHILDREN[family];
  if (factory) {
    const kids = factory(content || {}, { variant, family });
    for (const k of kids) ops.push(...__flattenChildren(k, rootId, project));
  }
  return __patch(project, ops);
}
function __defaultProps(family, variant) {
  if (family === 'hero') return /3d|cinematic|centered/.test(variant || '') ? { display: 'flex', direction: 'column', align: 'center', gap: '1.25rem', columns: 0 } : { display: 'grid', columns: 2, gap: '2rem', align: 'center' };
  if (family === 'grid') return { display: 'grid', columns: 3, gap: '1.5rem' };
  if (family === 'stack') return { display: 'flex', direction: 'column', gap: '1rem' };
  if (family === 'container') return { display: 'flex', direction: 'row', gap: '1rem' };
  if (family === 'nav') return { display: 'flex', direction: 'row', justifyContent: 'space-between', gap: '1rem' };
  if (family === 'cta') return { display: 'flex', direction: 'column', align: 'center', gap: '1rem' };
  if (family === 'footer') return { display: 'flex', direction: 'row', justifyContent: 'space-between', gap: '1rem' };
  if (family === 'heading') return { level: 2 };
  return {};
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. RENDERING MODEL (recursive). Binds each node to its resolved presentation
//    per breakpoint; preserves parent/children so the renderer can nest.
// ─────────────────────────────────────────────────────────────────────────────
function nxRenderTree(project) {
  const layout = __solveLayout(project);
  const nodes = {};
  for (const id of project.order) {
    const n = project.nodes[id];
    if (!n) continue;
    const role = n.semanticRole;
    nodes[id] = {
      id, role, family: n.component.family, variant: n.component.variant || '',
      parent: n.parent, children: (n.children || []).slice(),
      type: n.type || 'component',
      props: Object.assign({}, n.props),
      constraints: layout[id] || { desktop: {}, tablet: {}, mobile: {} },
      design: Object.assign({}, project.design[id]),
      content: Object.assign({}, project.content[id]),
      motion: Object.assign({}, project.motion[id]),
      states: Object.assign({}, __dep('graph', 'nxStates', () => ({}))(project, id)),
      interactions: (project.interaction[id] || []).slice(),
      asset: __getAssert(project, id, 'desktop'),
    };
  }
  return { project, order: project.order.slice(), nodes, layout };
}
function __rootIds(project) { return project.order.filter(id => !project.nodes[id] || project.nodes[id].parent == null); }
function nxRenderNode(project, id, bp, tree) {
  bp = bp || 'desktop';
  // Tree is threaded through the whole render pass so we solve layout exactly
  // ONCE per document (nxRenderTree was being re-called for every child → O(n²)
  // layout solves on a real page).
  tree = tree || nxRenderTree(project);
  const rn = tree.nodes[id];
  if (!rn) return '';
  const view = nxResolveNodeView(project, rn, bp);
  return __renderRec(project, id, bp, view, tree);
}
function nxResolveNodeView(project, rn, bp) {
  bp = bp || 'desktop';
  const con = (rn.constraints && rn.constraints[bp]) || {};
  const prop = rn.props || {};
  const responsive = project.responsive[rn.id] || [];
  const rule = responsive.find(r => r.on === bp);
  const rp = (rule && rule.props) || {};
  // merged view: constraint css + inherited props, with responsive overrides winning
  const view = {
    id: rn.id, family: rn.family, role: rn.role, type: rn.type,
    children: rn.children, content: rn.content, design: rn.design,
    props: Object.assign({}, prop, rp),
    constraint: con,
    hidden: rp.visible === false || rp.hidden === true,
    states: rn.states, interactions: rn.interactions, motion: rn.motion, asset: rn.asset,
    breakpoint: bp,
  };
  return view;
}
function __attrHtml(view, bp) {
  const isHidden = view.hidden;
  const style = [];
  const c = view.constraint || {};
  if (c.width) style.push('width:' + c.width);
  if (c.height) style.push('height:' + c.height);
  if (c.maxWidth) style.push('max-width:' + c.maxWidth);
  if (c.minWidth) style.push('min-width:' + c.minWidth);
  if (c.marginLeft) style.push('margin-left:' + c.marginLeft);
  if (c.marginRight) style.push('margin-right:' + c.marginRight);
  if (c.marginTop) style.push('margin-top:' + c.marginTop);
  if (c.marginBottom) style.push('margin-bottom:' + c.marginBottom);
  if (c.aspectRatio) style.push('aspect-ratio:' + c.aspectRatio);
  if (c.alignSelf) style.push('align-self:' + c.alignSelf);
  if (c.textAlign) style.push('text-align:' + c.textAlign);
  const p = view.props || {};
  // 'stack' is the model's internal layout concept; it compiles to flex-column.
  const disp = p.display === 'stack' ? 'flex' : p.display;
  if (disp) style.push('display:' + disp);
  if (p.direction) style.push('flex-direction:' + p.direction);
  if (p.columns && p.display === 'grid') style.push('grid-template-columns:repeat(' + p.columns + ',minmax(0,1fr))');
  if (p.align) style.push('align-items:' + p.align);
  if (p.justifyContent) style.push('justify-content:' + p.justifyContent);
  if (p.gap) style.push('gap:' + p.gap);
  if (p.padding) style.push('padding:' + p.padding);
  if (p.left != null) style.push('left:' + (typeof p.left === 'number' ? p.left + 'px' : p.left));
  if (p.top != null) style.push('top:' + (typeof p.top === 'number' ? p.top + 'px' : p.top));
  if (p.right != null) style.push('right:' + (typeof p.right === 'number' ? p.right + 'px' : p.right));
  if (p.bottom != null) style.push('bottom:' + (typeof p.bottom === 'number' ? p.bottom + 'px' : p.bottom));
  if (p.zIndex != null) style.push('z-index:' + p.zIndex);
  if (p.width) style.push('width:' + (typeof p.width === 'number' ? p.width + 'px' : p.width));
  if (p.maxWidth) style.push('max-width:' + (typeof p.maxWidth === 'number' ? p.maxWidth + 'px' : p.maxWidth));
  if (p.minWidth) style.push('min-width:' + (typeof p.minWidth === 'number' ? p.minWidth + 'px' : p.minWidth));
  if (p.minHeight) style.push('min-height:' + (typeof p.minHeight === 'number' ? p.minHeight + 'px' : p.minHeight));
  // ── DESIGN-LEVEL presentation (typography + color + effects + radius) ──
  // These come from the node's design sheet, so a property-panel change to color /
  // font / weight / radius actually shows up in the rendered output (previously it
  // was dropped, so "set property → nothing appeared" was real). Layout keys already
  // emitted above are skipped. Structured presets (colors/typography/hierarchy)
  // are object-valued and are omitted here — they are handled by the token layer —
  // while flat presentation keys (backgroundColor, color, fontSize, fontWeight,
  // opacity, borderRadius, letterSpacing, lineHeight, textTransform, …) emit CSS.
  const d = view.design || {};
  const skip = new Set(['display','flex-direction','grid-template-columns','grid-column','grid-row','align-items','justify-content','gap','padding','align-self','justify-self']);
  const unitFor = { 'font-size': 'px', 'border-radius': 'px', 'letter-spacing': 'px', 'line-height': '', 'opacity': '', 'width': 'px', 'height': 'px', 'min-width': 'px', 'min-height': 'px', 'max-width': 'px', 'margin-top': 'px', 'margin-bottom': 'px', 'margin-left': 'px', 'margin-right': 'px', 'gap': 'px', 'aspect-ratio': '', 'flex': '' };
  for (const k of Object.keys(d)) {
    const v = d[k];
    if (v == null || v === '') continue;
    if (typeof v === 'object') continue; // structured presets — not inline CSS
    if (k === 'backgroundColor' || k === 'background') { style.push('background:' + v); continue; }
    const ks = __kebab(k);
    if (skip.has(ks)) continue;
    const unit = unitFor[ks] !== undefined ? unitFor[ks] : '';
    style.push(ks + ':' + v + (typeof v === 'number' ? unit : ''));
  }
  const styleAttr = style.length ? ' style="' + style.join(';') + '"' : '';
  const cls = ['nx-' + view.family];
  // Semantic role becomes a class so the design system can target section chrome
  // (hero-copy / section-header / features-grid / logo-row / flow-row / footer-col …)
  // with its own treatments. The role is authored IN THE GRAPH, so this stays fully
  // graph-authoritative — never a hardcoded HTML string. Nested children carry
  // `semanticRole:'none'` (their role lives in content.role), so we resolve the
  // classifying role from semanticRole, falling back to content.role, then only
  // add the class when it's a real marker distinct from the family.
  const roleCls = (view.role && view.role !== 'none') ? view.role : (view.content && view.content.role);
  if (roleCls && roleCls !== 'section' && roleCls !== view.family) cls.push('nx-role-' + roleCls);
  if (Object.keys(view.states).length) cls.push('nx-stated');
  const tone = (view.props && view.props.tone) ? ' data-nx-tone="' + __escAttr(view.props.tone) + '"' : '';
  const hiddenAttr = isHidden ? ' hidden' : '';
  return ' class="' + cls.join(' ') + '" data-nx-id="' + __escAttr(view.id) + '"' + tone + styleAttr + hiddenAttr;
}
function __renderRec(project, id, bp, viewIn, tree) {
  tree = tree || nxRenderTree(project);
  const view = viewIn || nxResolveNodeView(project, tree.nodes[id], bp);
  let def = NX_COMPONENT_DEFS[view.family] || NX_COMPONENT_DEFS.section;
  const attrs = __attrHtml(view, bp);
  const childrenHtml = (view.children || []).map(cid => { const cv = tree.nodes[cid]; return cv ? __renderRec(project, cid, bp, null, tree) : ''; }).join('');
  const content = __leafContent(view);
  // heading family maps level → the right tag (h1/h2/h3…), not a fixed tag.
  let tag = def.tag;
  if (view.family === 'heading') { const lv = parseInt((view.props && view.props.level) || 2, 10); tag = 'h' + Math.max(1, Math.min(6, lv)); def = { leaf: true, void: false }; }
  // void leaf (img / hr): self-closing element, with src/alt only where applicable
  if (def.leaf && def.void) {
    const srcAttr = def.src ? ' src="' + __escAttr(def.src(view) || '') + '"' : '';
    const altAttr = def.alt ? ' alt="' + __escAttr(def.alt(view) || '') + '"' : '';
    const lazy = def.src ? ' loading="lazy"' : '';
    return '<' + tag + srcAttr + altAttr + lazy + attrs + '>';
  }
  // a family may supply a custom inner render (icon SVG / avatar glyph) instead of text
  const inner = def.render ? def.render(view) : (def.leaf ? content : childrenHtml);
  return '<' + tag + attrs + '>' + inner + '</' + tag + '>';
}
function __leafContent(view) {
  const def = NX_COMPONENT_DEFS[view.family];
  if (def && def.text) return __esc(def.text(view) || '');
  return __esc(view.content.text || '');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. COMPILER PIPELINE → DOCUMENT (recursive; validates before emitting)
// ─────────────────────────────────────────────────────────────────────────────
function nxRenderDocument(project, opts) {
  opts = opts || {};
  const bp = opts.breakpoint || 'desktop';
  const tokens = __mergeBrand({}, project.tokens);
  const integrity = __integrity(project);
  const schema = __stateSchema(project);
  // structural + schema soundness determines whether the graph RENDERS.
  const nodeErrors = project.order.map(id => (__nodeSchema(project, id).errors || []).map(e => id + ': ' + e)).flat();
  const errors = [...integrity.errors, ...schema.errors, ...nodeErrors];
  // page READINESS (completeness) is a separate gate — a structural subtree can
  // render fine without a hero; only a full page publish requires completeness.
  const complete = __dep('ir', 'nxValidateProject', () => ({ ok: true, errors: [] }))(project);
  // Solve the render tree ONCE and thread it through the whole pass (was being
  // re-solved for every node → O(n²) layout solves on a real page).
  const tree = nxRenderTree(project);
  const roots = __rootIds(project);
  const main = roots.map(id => nxRenderNode(project, id, bp, tree)).join('');
  // per-node inline CSS for states (real runtime toggles) + component layout css
  const stateCss = __dep('graph', 'nxCompileStateCss', () => '')(project);
  const budget = __budget(project, opts.budget);
  // Performance-aware motion: when the budget is exceeded (or we're rendering a
  // mobile/tablet viewport), heavy GPU primitives are stripped from the runtime
  // motion spec and neutralized in CSS. This is real, testable behavior.
  const reduceHeavy = (budget && !budget.withinBudget) || bp !== 'desktop';
  const css = __tokensCss(tokens) + '\n' + __componentCss() + '\n' + __motionCss(tokens.motionStyle) + '\n' + stateCss + '\n' + __responsiveRulesCss(project) + '\n' + __responsiveCss() + '\n' + __budgetCss(budget, bp) + (budget && !budget.withinBudget ? '\n/* motion budget: ' + budget.score + ' — ' + budget.complexity + ' primitives (heavy effects reduced) */' : '');
  const js = nxRuntimeScript(project, { budget, reduceHeavy });
  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + __escAttr(project.name) + '</title><style>' + css + '</style></head><body>' + main + '<script>' + js + '</script></body></html>';
  return { html, css, js, valid: integrity.ok && schema.ok && nodeErrors.length === 0, validationErrors: errors, pageReady: complete.ok, tree, budget };
}
function __componentCss() {
  // The compiled design language — the builder's own version of the reference
  // dark-cinematic "R C Atkin" system. Shared surfaces/tokens come from the design
  // tokens layer (so token overrides flow through); per-node specifics live in each
  // node's graph (design sheet + props). This provides the coherent visual grammar:
  // grain, aurora heroes, marquee, panel surfaces, conic-border service cards,
  // Space Grotesk headings / Inter body / JetBrains Mono eyebrows, orange accent,
  // section rhythm, shimmer, and the hover/motion polish. Everything is
  // token-driven so a brand direction swap recolors the whole page.
  return ':root{' +
    '--nx-space-1:0.25rem;--nx-space-2:0.5rem;--nx-space-3:0.75rem;--nx-space-4:1rem;' +
    '--nx-space-5:1.5rem;--nx-space-6:2rem;--nx-space-7:3rem;--nx-space-8:4rem;' +
    '--nx-surface:var(--nx-panel,#0D1322);--nx-surface-2:rgba(255,255,255,.03);' +
    '--nx-border:var(--nx-line,rgba(255,255,255,.07));--nx-border-2:var(--nx-line-2,rgba(255,255,255,.13));' +
    '--nx-accent-glow:0 24px 64px -16px rgba(255,95,0,.45);' +
    '--nx-gradient:linear-gradient(135deg,var(--nx-secondary,#FF5F00) 0%,#ff7a1f 100%);' +
    '--nx-grad-text:linear-gradient(100deg,var(--nx-secondary,#FF5F00) 10%,var(--nx-amber,#FFB23E) 50%,var(--nx-secondary,#FF5F00) 90%);' +
    '--nx-html-bg:var(--nx-bg,#060912);' +
    '--nx-container:var(--nx-max-width,1200px);--nx-r:var(--nx-radius,14px);--nx-r-sm:9px;--nx-r-lg:20px;' +
    '--nx-ease:cubic-bezier(.22,1,.36,1);' +
    '}' +
    '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}' +
    'html{scroll-behavior:smooth;background:var(--nx-html-bg,#060912);-webkit-text-size-adjust:100%}' +
    'body{margin:0;background:var(--nx-bg,#060912);color:var(--nx-fg,#EEF2F8);font-family:var(--nx-body-font,Inter,system-ui,sans-serif);line-height:1.6;overflow-x:hidden;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}' +
    'body::after{content:\"\";position:fixed;inset:0;z-index:2;pointer-events:none;opacity:.03;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns=%270%27 width=%27160%27 height=%27160%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%27.85%27 numOctaves=%272%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E")}' +
    '::selection{background:var(--nx-secondary,#FF5F00);color:#07090F}' +
    'img,svg{display:block;max-width:100%}' +
    'img{max-width:100%}a{color:inherit;text-decoration:none}ul{list-style:none}button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}' +
    'input,textarea,select{font-family:inherit}' +
    '::-webkit-scrollbar{width:10px;height:10px}' +
    '::-webkit-scrollbar-track{background:var(--nx-bg-2,#080C16)}' +
    '::-webkit-scrollbar-thumb{background:var(--nx-panel-2,#121A2C);border:2px solid var(--nx-bg-2,#080C16);border-radius:20px}' +
    '::-webkit-scrollbar-thumb:hover{background:var(--nx-secondary,#FF5F00)}' +
    'h1,h2,h3,h4,h5,h6{font-family:var(--nx-heading-font,\'Space Grotesk\',Inter,system-ui,sans-serif);color:var(--nx-fg,#EEF2F8);line-height:1.08;margin:0 0 .5em;font-weight:700;letter-spacing:-.02em}' +
    'p{margin:0 0 1em}' +
    '.nx-media{width:100%;min-width:0}' +
    '.nx-content{padding:0}' +
    '.nx-section,.nx-features,.nx-pricing,.nx-testimonials,.nx-logos,.nx-benefit,.nx-cta{max-width:var(--nx-container,1200px);margin:0 auto;padding:clamp(4.5rem,9vw,8.25rem) clamp(1.25rem,5vw,3rem)}' +
    '.nx-hero{position:relative;overflow:hidden;width:100%}' +
    '.nx-benefit,.nx-cta{position:relative}' +
    '.nx-nav{width:100%;position:fixed;top:0;left:0;right:0;z-index:150;background:rgba(8,11,18,.35);backdrop-filter:blur(14px);border-bottom:1px solid var(--nx-line,rgba(255,255,255,.05));transition:background .35s,box-shadow .35s}' +
    '.nx-nav:hover,.nx-nav:focus-within{background:rgba(8,11,18,.82);box-shadow:0 12px 44px -20px #000}' +
    '.nx-nav .nx-role-nav-links > *{position:relative;padding:9px 14px;font-size:13.5px;font-weight:500;color:var(--nx-muted,#97A3BA);border-radius:7px;transition:color .25s}' +
    '.nx-nav .nx-role-nav-links > *::after{content:\"\";position:absolute;left:14px;right:14px;bottom:4px;height:2px;background:var(--nx-secondary,#FF5F00);transform:scaleX(0);transform-origin:left;transition:transform .35s var(--nx-ease);border-radius:2px}' +
    '.nx-nav .nx-role-nav-links > *:hover{color:#fff}' +
    '.nx-nav .nx-role-nav-links > *:hover::after{transform:scaleX(1)}' +
    '.nx-eyebrow{display:inline-flex;align-items:center;gap:11px;font-family:var(--nx-mono-font,\'JetBrains Mono\',monospace);text-transform:uppercase;letter-spacing:.28em;font-weight:600;font-size:11px;color:var(--nx-secondary,#FF5F00);margin:0 0 18px}' +
    '.nx-eyebrow::before{content:\"\";width:28px;height:1px;background:linear-gradient(90deg,var(--nx-secondary,#FF5F00),transparent)}' +
    '.nx-eyebrow[style*="text-align:center"]::after{content:\"\";width:28px;height:1px;background:linear-gradient(270deg,var(--nx-secondary,#FF5F00),transparent)}' +
    '.nx-role-section-header{max-width:680px;margin:0 auto clamp(2.4rem,5vw,3.9rem);text-align:center}' +
    '.nx-role-section-header .nx-heading{font-size:clamp(1.75rem,4.6vw,3.1rem);font-weight:700;text-transform:uppercase;letter-spacing:-.025em;line-height:1.08;margin:0}' +
    '.nx-role-section-header .nx-paragraph{color:var(--nx-muted,#97A3BA);margin-top:16px;font-size:clamp(15px,1.6vw,17px);max-width:60ch;margin-inline:auto}' +
    '.nx-hero::before{content:\"\";position:absolute;inset:-2px;pointer-events:none;z-index:0;background:' +
      'radial-gradient(38vw 34vw at 16% 24%,rgba(255,125,45,.22),transparent 65%),' +
      'radial-gradient(34vw 30vw at 82% 30%,rgba(91,141,239,.16),transparent 65%),' +
      'radial-gradient(30vw 30vw at 66% 62%,rgba(255,178,62,.18),transparent 65%)}' +
    '.nx-hero::after{content:\"\";position:absolute;inset:-2px;pointer-events:none;z-index:0;background-image:linear-gradient(to right,rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,.04) 1px,transparent 1px);background-size:54px 54px;mask-image:radial-gradient(ellipse 72% 62% at 62% 40%,#000 30%,transparent 80%);animation:gridpan 30s linear infinite}' +
    '.nx-hero>*{position:relative;z-index:1}' +
    '.nx-hero .nx-heading{font-size:clamp(2.1rem,4.3vw,3.6rem);font-weight:700;text-transform:uppercase;letter-spacing:-.03em;line-height:1.02;margin:0;max-width:15ch}' +
    '.nx-hero .nx-paragraph{color:var(--nx-muted,#97A3BA);font-size:clamp(15px,1.7vw,18px);max-width:54ch;margin-top:20px}' +
    '.nx-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:.9rem 1.7rem;border-radius:var(--nx-r-sm,9px);font-weight:700;font-size:.78rem;letter-spacing:.13em;text-transform:uppercase;line-height:1;border:none;cursor:pointer;transition:transform .35s var(--nx-ease),box-shadow .35s var(--nx-ease),background .3s,color .3s,border-color .3s;overflow:hidden;white-space:nowrap;isolation:isolate;z-index:1}' +
    '.nx-btn[data-nx-tone=primary]{background:var(--nx-gradient,linear-gradient(135deg,#FF5F00,#ff7a1f));color:#0a0d14;box-shadow:0 12px 32px -10px rgba(255,95,0,.45)}' +
    '.nx-btn[data-nx-tone=primary]::after{content:\"\";position:absolute;inset:0;background:linear-gradient(120deg,transparent 30%,rgba(255,255,255,.5),transparent 70%);transform:translateX(-130%);transition:transform .8s var(--nx-ease);z-index:-1}' +
    '.nx-btn[data-nx-tone=primary]:hover{transform:translateY(-3px);box-shadow:0 22px 48px -12px rgba(255,95,0,.45)}' +
    '.nx-btn[data-nx-tone=primary]:hover::after{transform:translateX(130%)}' +
    '.nx-btn[data-nx-tone=secondary],.nx-btn[data-nx-tone=ghost]{background:rgba(255,255,255,.03);color:var(--nx-fg,#EEF2F8);border:1px solid var(--nx-line-2,rgba(255,255,255,.13))}' +
    '.nx-btn[data-nx-tone=secondary]:hover,.nx-btn[data-nx-tone=ghost]:hover{transform:translateY(-3px);border-color:var(--nx-secondary,#FF5F00);background:rgba(255,95,0,.12);color:#fff}' +
    '.nx-btn:active{transform:translateY(-1px) scale(.97)}' +
    '.nx-card{position:relative;background:var(--nx-panel,#0D1322);border:1px solid var(--nx-line,rgba(255,255,255,.07));border-radius:var(--nx-r-lg,20px);padding:1.9rem;transition:transform .45s var(--nx-ease),box-shadow .45s,border-color .3s;color:var(--nx-fg,#EEF2F8)}' +
    '.nx-card:hover{transform:translateY(-5px);border-color:var(--nx-line-2,rgba(255,255,255,.13));box-shadow:0 30px 80px -30px rgba(0,0,0,.9)}' +
    '.nx-card h3{font-size:1.2rem;text-transform:uppercase;letter-spacing:-.01em}' +
    '.nx-card p{color:var(--nx-muted,#97A3BA);font-size:.9rem;line-height:1.6}' +
    '.nx-role-feature-icon{display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:12px;background:rgba(255,95,0,.13);color:var(--nx-secondary,#FF5F00);margin-bottom:.6rem}' +
    '.nx-logos{border-block:1px solid rgba(255,255,255,.05);background:var(--nx-bg-2,#080C16);overflow:hidden;padding:0}' +
    '.nx-role-logo-row{display:flex;gap:3rem;align-items:center;justify-content:center;flex-wrap:wrap;padding:24px 0;margin:0}' +
    '.nx-role-logo-row > *{font-weight:700;letter-spacing:.1em;text-transform:uppercase;font-size:.95rem;color:var(--nx-dim,#65708A);white-space:nowrap}' +
    '.nx-stat{position:relative;padding:1.75rem 1.5rem 1.75rem 1.75rem;border-left:2px solid var(--nx-secondary,#FF5F00);background:var(--nx-panel,#0D1322);border-radius:var(--nx-r-sm,9px);transition:transform .45s var(--nx-ease);overflow:hidden}' +
    '.nx-stat:hover{transform:translateX(6px)}' +
    '.nx-stat .nx-statValue{font-family:var(--nx-heading-font,\'Space Grotesk\',sans-serif);font-size:clamp(2.5rem,5vw,3.6rem);font-weight:700;line-height:1;letter-spacing:-.03em}' +
    '.nx-stat .nx-statLabel{font-family:var(--nx-mono-font,\'JetBrains Mono\',monospace);font-size:.65rem;letter-spacing:.17em;text-transform:uppercase;color:var(--nx-muted,#97A3BA);margin-top:12px;display:block}' +
    '.nx-muted{color:var(--nx-muted,#97A3BA)}' +
    '.nx-icon{display:inline-flex;align-items:center;justify-content:center;line-height:0}' +
    '.nx-icon svg{vertical-align:middle}' +
    '.nx-avatar{display:inline-flex;align-items:center;justify-content:center;font-weight:700}' +
    '.nx-badge{display:inline-flex;align-items:center;gap:.3rem;font-family:var(--nx-mono-font,\'JetBrains Mono\',monospace);font-size:.6rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;padding:.3rem .7rem;border-radius:999px;background:rgba(255,95,0,.12);color:var(--nx-secondary,#FF5F00);border:1px solid var(--nx-line-2,rgba(255,255,255,.13))}' +
    '.nx-divider{height:1px;border:0;background:var(--nx-line,rgba(255,255,255,.07));margin:1rem 0}' +
    '.nx-quote{margin:0;font-size:1rem;line-height:1.6;color:var(--nx-fg,#EEF2F8)}' +
    '.nx-quote::before{content:"\\201C";color:var(--nx-secondary,#FF5F00)}' +
    '.nx-quote::after{content:"\\201D";color:var(--nx-secondary,#FF5F00)}' +
    '.nx-footer{width:100%;background:var(--nx-bg-2,#080C16);border-top:1px solid var(--nx-line,rgba(255,255,255,.05));margin-top:2rem}' +
    '.nx-footer .nx-role-footer-col .nx-eyebrow{color:var(--nx-dim,#65708A);letter-spacing:.2em;font-size:.7rem;margin:0 0 .6rem}' +
    '.nx-footer .nx-role-footer-col > *{color:var(--nx-muted,#97A3BA);font-size:.9rem;margin-bottom:.4rem;transition:color .2s}' +
    '.nx-footer .nx-role-footer-col > *:hover{color:#fff}' +
    '.nx-role-flow-row{display:flex;align-items:center;gap:.55rem;padding:.6rem .8rem;background:rgba(255,255,255,.03);border:1px solid var(--nx-line,rgba(255,255,255,.06));border-radius:10px}' +
    '.nx-role-app-window{background:var(--nx-panel,#0D1322);border:1px solid var(--nx-line-2,rgba(255,255,255,.10));border-radius:18px;box-shadow:0 40px 90px rgba(0,0,0,.5);overflow:hidden}' +
    '.nx-role-metric-card{background:var(--nx-panel,#0D1322);border:1px solid var(--nx-line-2,rgba(255,255,255,.10));border-radius:18px;padding:1.4rem;box-shadow:0 40px 90px rgba(0,0,0,.4)}' +
    // ── MARQUEE (scrolling ticker, template style) ──
    '.nx-marquee{width:100%;background:var(--nx-bg-2,#080C16);border-block:1px solid var(--nx-line-2,rgba(255,255,255,.05));overflow:hidden;padding:0;position:relative}' +
    '.nx-marquee::before,.nx-marquee::after{content:"";position:absolute;top:0;bottom:0;width:120px;z-index:2;pointer-events:none}' +
    '.nx-marquee::before{left:0;background:linear-gradient(90deg,var(--nx-bg-2,#080C16),transparent)}' +
    '.nx-marquee::after{right:0;background:linear-gradient(270deg,var(--nx-bg-2,#080C16),transparent)}' +
    '.nx-role-marquee-track{display:flex;width:max-content;animation:scrollX 38s linear infinite;padding:16px 0;margin:0}' +
    '.nx-marquee:hover .nx-role-marquee-track{animation-play-state:paused}' +
    '.nx-role-marquee-track > *{display:inline-flex;align-items:center;gap:12px;padding:0 34px;font-family:var(--nx-mono-font,\'JetBrains Mono\',monospace);font-size:.82rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--nx-muted,#97A3BA);white-space:nowrap}' +
    // ── STATS band ──
    '.nx-stats{max-width:var(--nx-container,1200px);margin:0 auto;padding:clamp(3.25rem,6vw,5.1rem) clamp(1.25rem,5vw,3rem)}' +
    '.nx-role-stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin:0}' +
    '@media (max-width:760px){.nx-role-stats-grid{grid-template-columns:repeat(2,1fr);gap:18px}}' +
    '.nx-role-stat-card{position:relative;padding:1.75rem 1.5rem 1.75rem 1.75rem;border-left:2px solid var(--nx-secondary,#FF5F00);background:var(--nx-panel,#0D1322);border-radius:var(--nx-r-sm,9px);overflow:hidden;transition:transform .45s var(--nx-ease)}' +
    '.nx-role-stat-card::before{content:"";position:absolute;inset:0;background:linear-gradient(120deg,rgba(255,95,0,.12),transparent 50%);opacity:0;transition:opacity .5s}' +
    '.nx-role-stat-card:hover::before{opacity:1}.nx-role-stat-card:hover{transform:translateX(6px)}' +
    // ── SERVICES matrix (conic-gradient hover border) ──
    '.nx-services{max-width:var(--nx-container,1200px);margin:0 auto;padding:clamp(4.5rem,9vw,8.25rem) clamp(1.25rem,5vw,3rem);background:linear-gradient(180deg,var(--nx-bg,#060912),var(--nx-bg-2,#080C16))}' +
    '.nx-role-services-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;margin:0}' +
    '@media (max-width:960px){.nx-role-services-grid{grid-template-columns:repeat(2,1fr)}}' +
    '@media (max-width:640px){.nx-role-services-grid{grid-template-columns:1fr}}' +
    '.nx-role-service-card{position:relative;background:var(--nx-panel,#0D1322);border-radius:var(--nx-r-lg,20px);overflow:hidden;transition:transform .5s var(--nx-ease),box-shadow .5s;will-change:transform}' +
    '.nx-role-service-card::before{content:"";position:absolute;inset:0;border-radius:var(--nx-r-lg,20px);padding:1px;background:conic-gradient(from var(--ang,0deg),transparent 0 75%,var(--nx-secondary,#FF5F00) 90%,transparent 100%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:0;transition:opacity .4s;pointer-events:none;z-index:3}' +
    '.nx-role-service-card:hover::before{opacity:1;animation:spinAng 4s linear infinite}' +
    '.nx-role-service-card:hover{transform:translateY(-6px);box-shadow:0 30px 60px -28px rgba(255,95,0,.4)}' +
    '@property --ang{syntax:\'<angle>\';initial-value:0deg;inherits:false}' +
    '.nx-role-service-card .nx-heading{font-size:1.2rem;text-transform:uppercase;letter-spacing:-.01em}' +
    '.nx-role-service-card .nx-paragraph{color:var(--nx-muted,#97A3BA);font-size:.85rem;margin-top:16px}' +
    // ── PROCESS steps ──
    '.nx-process{max-width:var(--nx-container,1200px);margin:0 auto;padding:clamp(4.5rem,9vw,8.25rem) clamp(1.25rem,5vw,3rem)}' +
    '.nx-role-process-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:26px;margin:0;position:relative}' +
    '@media (max-width:900px){.nx-role-process-grid{grid-template-columns:repeat(2,1fr)}}' +
    '@media (max-width:560px){.nx-role-process-grid{grid-template-columns:1fr}}' +
    '.nx-role-process-step{position:relative;padding:1.7rem;background:var(--nx-panel,#0D1322);border:1px solid var(--nx-line,rgba(255,255,255,.07));border-radius:var(--nx-r-lg,20px)}' +
    '.nx-role-process-step .nx-badge{font-size:.6rem;margin-bottom:.7rem}' +
    '.nx-role-process-step .nx-heading{font-size:1.1rem;text-transform:uppercase;margin:.2rem 0 .5rem}' +
    '.nx-role-process-step .nx-paragraph{color:var(--nx-muted,#97A3BA);font-size:.85rem}' +
    // ── FAQ accordion ──
    '.nx-faq{max-width:var(--nx-container,1200px);margin:0 auto;padding:clamp(4.5rem,9vw,8.25rem) clamp(1.25rem,5vw,3rem)}' +
    '.nx-role-faq-list{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:.9rem}' +
    '.nx-role-faq-item{background:var(--nx-panel,#0D1322);border:1px solid var(--nx-line,rgba(255,255,255,.07));border-radius:var(--nx-r,14px);overflow:hidden}' +
    '.nx-role-faq-item .nx-paragraph{color:var(--nx-muted,#97A3BA);font-size:.9rem;margin:0;padding:0 1.4rem 1.3rem}' +
    // ── CONTACT ──
    '.nx-contact{max-width:var(--nx-container,1200px);margin:0 auto;padding:clamp(4.5rem,9vw,8.25rem) clamp(1.25rem,5vw,3rem)}' +
    '.nx-role-contact-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:clamp(2rem,4vw,3.5rem);margin:0;align-items:start}' +
    '@media (max-width:900px){.nx-role-contact-grid{grid-template-columns:1fr}}' +
    '.nx-role-contact-card{background:var(--nx-panel,#0D1322);border:1px solid var(--nx-line,rgba(255,255,255,.07));border-radius:var(--nx-r-lg,20px);padding:1.7rem;color:var(--nx-fg,#EEF2F8)}' +
    '.nx-role-contact-card .nx-heading{font-size:1.25rem;margin-bottom:.3rem}' +
    '.nx-role-contact-card .nx-paragraph{color:var(--nx-muted,#97A3BA);font-size:.9rem}' +
    '.nx-role-contact-field{display:flex;flex-direction:column;gap:.4rem;margin-bottom:1rem}' +
    '.nx-role-contact-field label{font-family:var(--nx-mono-font,\'JetBrains Mono\',monospace);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--nx-muted,#97A3BA)}' +
    '.nx-role-contact-field input,.nx-role-contact-field textarea{background:var(--nx-bg,#060912);border:1px solid var(--nx-line-2,rgba(255,255,255,.13));border-radius:var(--nx-r-sm,9px);padding:.85rem 1rem;color:var(--nx-fg,#EEF2F8);font-size:.95rem;transition:border-color .3s}' +
    '.nx-role-contact-field input:focus,.nx-role-contact-field textarea:focus{outline:none;border-color:var(--nx-secondary,#FF5F00)}' +
    '.nx-stated{transition:transform .2s ease,opacity .2s ease,box-shadow .2s ease}' +
    '.nx-stated[data-nx-state=active]{transform:scale(.98)}' +
    '[data-nx-motion],[data-nx-entered]{transition:opacity .7s cubic-bezier(.16,1,.3,1),transform .7s cubic-bezier(.16,1,.3,1)}' +
    '[data-nx-motion]{opacity:0;transform:translateY(24px)}' +
    '[data-nx-entered]{opacity:1;transform:none}' +
    '@keyframes gridpan{to{background-position:54px 54px}}' +
    '@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-26px)}}' +
    '@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.4)}}' +
    '@keyframes shimmer{to{background-position:200% center}}' +
    '@keyframes lineUp{to{transform:translateY(0);opacity:1}}' +
    '@keyframes twBlink{0%,49%{opacity:1}50%,100%{opacity:0}}' +
    '@keyframes scrollX{to{transform:translateX(-50%)}}' +
    '@keyframes spinAng{to{--ang:360deg}}' +
    '';
}
// Compile the graph's per-node responsive authoring into real CSS media queries,
// keyed by data-nx-id, so the browser honors each node's authored reflow. This is
// what makes responsive genuinely GRAPH-authoritative — the global media query is
// only a safety net; the per-node rules compiled here are the source of truth.
function __propsToCss(p) {
  const out = [];
  const px = (k, v) => out.push(k + ':' + (typeof v === 'number' ? v + 'px' : v));
  if (p.display) out.push('display:' + (p.display === 'stack' ? 'flex' : p.display));
  if (p.direction) out.push('flex-direction:' + p.direction);
  if (p.columns && (p.display === 'grid' || (!p.display && p.columns > 1))) out.push('grid-template-columns:repeat(' + p.columns + ',minmax(0,1fr))');
  if (p.align) out.push('align-items:' + p.align);
  if (p.justifyContent) out.push('justify-content:' + p.justifyContent);
  if (p.gap) px('gap', p.gap);
  if (p.padding) px('padding', p.padding);
  if (p.width != null) px('width', p.width);
  if (p.maxWidth) px('max-width', p.maxWidth);
  if (p.wrap !== undefined) out.push('flex-wrap:' + (p.wrap ? 'wrap' : 'nowrap'));
  if (p.textAlign) out.push('text-align:' + p.textAlign);
  if (p.marginLeft != null) px('margin-left', p.marginLeft);
  if (p.marginRight != null) px('margin-right', p.marginRight);
  if (p.marginTop != null) px('margin-top', p.marginTop);
  if (p.marginBottom != null) px('margin-bottom', p.marginBottom);
  if (p.left != null) px('left', p.left);
  if (p.top != null) px('top', p.top);
  if (p.visible === false || p.hidden === true) return 'display:none!important'; // hide wins over display:flex
  return out.join(';');
}
function __responsiveRulesCss(project) {
  if (!project || !project.responsive) return '';
  const BP = { tablet: 980, mobile: 720 }; // px (max-width); matches the global safety net
  const perNode = {};
  for (const id of project.order) {
    const rules = project.responsive[id] || [];
    for (const r of rules) {
      if (!r || !r.on || !r.props) continue;
      const w = BP[r.on]; if (!w) continue;
      const css = __propsToCss(r.props);
      if (!css) continue;
      perNode[w] = perNode[w] || [];
      // Inline styles beat stylesheet rules, so the authored reflow must be
      // !important to genuinely override the per-breakpoint inline style.
      perNode[w].push('[data-nx-id="' + id.replace(/"/g, '\\"') + '"]{' + css.replace(/;/g, '!important;') + '}');
    }
  }
  let out = '';
  for (const w of Object.keys(perNode).sort((a, b) => b - a)) {
    out += '@media (max-width:' + w + 'px){' + perNode[w].join('') + '}';
  }
  return out;
}
function __responsiveCss() {
  // Global responsive backstop. Per-node reflow is authored in the GRAPH
  // (nxApplyResponsive writes columns:1/display:stack rules per node); this
  // media query is a safety net so nothing overflows even on 320px.
  return '@media (max-width:720px){' +
    '.nx-hero{padding:clamp(3rem,12vw,4rem) 1.2rem}' +
    '.nx-section,.nx-features,.nx-pricing,.nx-testimonials,.nx-benefit,.nx-cta,.nx-logos{padding:clamp(3rem,10vw,4rem) 1rem}' +
    '.nx-grid{grid-template-columns:1fr!important}' +
    '.nx-stack,.nx-grid,.nx-container{grid-template-columns:1fr!important}' +
    '.nx-hero::before{background:radial-gradient(80% 60% at 50% 0%,rgba(255,107,26,.16),transparent 60%)}' +
    '}' +
    '@media (max-width:980px){.nx-hero .nx-grid,.nx-benefit-split{grid-template-columns:1fr!important}.nx-footer-grid{grid-template-columns:1fr 1fr!important}}' +
    '@media (prefers-reduced-motion: reduce){.nx-stated,[data-nx-motion],[data-nx-entered],.nx-btn,.nx-card{transition:none!important;animation:none!important;transform:none!important;opacity:1!important}[data-nx-motion]{opacity:1;transform:none}}';
}

// Return the runtime script that makes states/interactions/motion REAL in a
// browser, and available to a deterministic test harness.
function nxRuntimeScript(project, opts) {
  opts = opts || {};
  // Reduced-motion is detected at RUNTIME (matchMedia), not baked from a token —
  // the token's 'fade'/'cinematic' are motion moods, not reduced-motion flags.
  const data = JSON.stringify({
    states: project.states || {}, interactions: project.interaction || {},
    motion: nxRuntimeMotionSpec(project, opts),
    reducePref: 'runtime',
    heavyCut: !!(opts && opts.reduceHeavy),
  });
  return "(function(){'use strict';" + NX_RUNTIME_LIB + "var nx=new NXRuntime(" + data + ");window.NXRuntime=nx;if(document.readyState!=='loading')nx.start();else document.addEventListener('DOMContentLoaded',function(){nx.start();});})();";
}
// Primitives that are GPU/bandwidth-heavy (3D transforms, parallax, particles,
// blur, WebGL). These are stripped when the motion budget is exceeded or the
// viewport is mobile/tablet, so motion stays "cinematic but performance-safe".
// Responsive is GRAPH-AUTHORITATIVE: every node that lays out multiple columns gets
// an explicit responsive rule stored in the graph (so the graph, not a global CSS
// fallback, is the source of truth for how the layout reflows). This is what makes
// `response` a first-class graph concern and is what the evidence engine measures.
function __authorResponsive(project) {
  const ir = (globalThis.__NX_DEPS && globalThis.__NX_DEPS.ir) || globalThis.__NX_IR;
  const apply = (ir && ir.nxApplyResponsive) || ((p) => p);
  return apply(project);
}

const NX_HEAVY_PRIMITIVES = new Set(['3d', '3d-rotate', 'particle-drift', 'background-parallax', 'scroll-transition', 'blur', 'webgl', 'canvas', 'confetti', 'tilt']);
function nxRuntimeMotionSpec(project, opts) {
  opts = opts || {};
  const reduceHeavy = !!opts.reduceHeavy;
  const spec = [];
  for (const id of project.order) {
    const m = project.motion[id]; if (!m) continue;
    const recipe = m.recipe || 'smooth';
    const role = project.nodes[id].semanticRole || 'none';
    const tl = __dep('graph', 'nxTimeline', () => ({ points: {} }))(role, recipe);
    const prims = m.primitives || [];
    const wasHeavy = prims.some(p => NX_HEAVY_PRIMITIVES.has(p));
    // When heavy motion is cut, keep light primitives so the entrance still reads
    // as choreographed, but drop the GPU-costly effects entirely.
    const primitives = reduceHeavy ? prims.filter(p => !NX_HEAVY_PRIMITIVES.has(p)) : prims;
    spec.push({ id, role, points: tl.points, primitives, duration: m.duration || 1, reducedHeavy: reduceHeavy, wasHeavy });
  }
  return spec;
}
// Performance-safe motion CSS. When the budget is exceeded (or on mobile), heavy
// GPU effects are neutralized rather than left to starve low-end devices. This is
// the "cinematic but performance-safe" guarantee, not just a commented warning.
function __budgetCss(budget, bp) {
  if ((budget && budget.withinBudget) && bp === 'desktop') return '';
  return '@media (max-width:720px){.nx-parallax,.nx-3d,.nx-particles,.nx-blur,[data-nx-heavy]{transform:none!important;animation:none!important;filter:none!important;opacity:1!important;will-change:auto}}' +
    (bp !== 'desktop' ? '.nx-parallax,.nx-3d,.nx-particles,[data-nx-heavy]{transform:none!important;animation:none!important;filter:none!important}' : '');
}
// The runtime library. Deterministic + testable: `setProgress`, `setState`,
// `fire` operate on live elements; `start` wires real browser events.
const NX_RUNTIME_LIB = `
function NXRuntime(cfg){var self=this;this.cfg=cfg;this.els={};this.byId={};this.mo=new MutationObserver(function(){self.__index();}).observe?null:null;
this.__index=function(){this.byId={};var nodes=(document.querySelectorAll('[data-nx-id]')||[]);for(var i=0;i<nodes.length;i++){var id=nodes[i].getAttribute('data-nx-id');if(id)this.byId[id]=nodes[i];}};
this.start=function(){this.__index();this.reduce=(this.cfg.reducePref==='runtime')?(typeof window!=='undefined'&&window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches):(this.cfg.reducePref!==false);this.__bindStates();this.__bindInteractions();this.__bindMotion();};
this.el=function(id){if(!this.byId[id])this.__index();return this.byId[id]||null;};
this.setState=function(id,state){var el=this.el(id);if(el)el.setAttribute('data-nx-state',state);return this;};
this.copyStyle=function(id,styles){var el=this.el(id);if(!el)return this;for(var k in styles)el.style[k]=styles[k];return this;};
this.transform=function(id,x,y,s,r){var el=this.el(id);if(el)el.style.transform='translate('+(x||0)+'px,'+(y||0)+'px) scale('+(s||1)+') rotate('+(r||0)+'deg)';return this;};
this.__bindStates=function(){var self=this;var st=this.cfg.states||{};for(var id in st){var el=this.byId[id];if(!el)continue;var map=st[id];if(map.hover){el.addEventListener('mouseenter',function(){self.setState(id,'hover');});el.addEventListener('mouseleave',function(){self.setState(id,'default');});}if(map.focus){el.addEventListener('focus',function(){self.setState(id,'focus');});el.addEventListener('blur',function(){self.setState(id,'default');});}if(map.active){el.addEventListener('mousedown',function(){self.setState(id,'active');});el.addEventListener('mouseup',function(){self.setState(id,'default');});}}};
this.__bindInteractions=function(){var self=this;var its=this.cfg.interactions||{};for(var id in its){var list=its[id];for(var j=0;j<list.length;j++){var it=list[j];var src=this.byId[id];if(!src)continue;var trig=it.trigger||'click';var hand=function(ev){self.fire(id,it,ev);};src.addEventListener(trig,hand,{passive:false});}}};
this.fire=function(srcId,it,ev){var self=this;var target=this.byId[it.target||srcId];var acts=(it.actions||[]);for(var i=0;i<acts.length;i++){var a=acts[i],t=it.target||srcId;switch(a.type){
case 'translate':this.transform(t,a.x||0,a.y||0);break;
case 'scale':this.transform(t,0,0,typeof a.value==='number'?a.value:1.05);break;
case 'opacity':this.copyStyle(t,{opacity:a.value!=null?a.value:(a.to!=null?a.to:0.5)});break;
case 'color':this.copyStyle(t,{color:a.value});break;
case 'shadow':this.copyStyle(t,{boxShadow:a.value});break;
case 'toggle-class':{var el=this.el(t);if(el)el.classList.toggle(a.klass);}break;
case 'update-state':{this.setState(t,a.value);}break;
case 'navigate':{if(a.url)window.location.href=a.url;}break;
case 'open-modal':{var d=document.createElement('div');d.className='nx-modal';d.innerHTML=(a.html||'<div style="padding:2rem">&#8230;</div>');document.body.appendChild(d);}break;
case 'lock-scroll':{document.body.style.overflow='hidden';}break;
case 'blur':{var el=this.el(t);if(el){el.style.filter='blur('+(a.value||4)+'px)';}}break;
case 'animate':{var el=this.el(t);if(el&&el.animate)el.animate([{opacity:0,transform:'translateY(14px)'},{opacity:1,transform:'none'}],{duration:a.duration||500,easing:'ease-out'});}break;
case 'play-motion':{if(this.cfg.motion&&this.cfg.motion.length){this.setProgress(1);}}break;
} } };
this.setProgress=function(p){p=Math.max(0,Math.min(1,p||0));var specs=this.cfg.motion||[];for(var i=0;i<specs.length;i++){var s=specs[i];for(var k in s.points){if(p>=s.points[k]){var el=this.byId[s.id]||this.byId[s.id];if(el)el.setAttribute('data-nx-motion',k);}}if(p>0.15){var e=this.byId[s.id];if(e)e.setAttribute('data-nx-entered','true');}}return this;};
this.__bindMotion=function(){var self=this;var specs=this.cfg.motion||[];if(this.reduce){return;}var io=null;if(typeof IntersectionObserver!=='undefined'){for(var i=0;i<specs.length;i++){var s=specs[i];var el=this.byId[s.id];if(!el)continue;io=new IntersectionObserver(function(entries){entries.forEach(function(en){if(en.isIntersecting)self.advanceFor(en.target);});},{threshold:0.2});io.observe(el);}}};
this.advanceFor=function(el){var id=el&&el.getAttribute?el.getAttribute('data-nx-id'):null;if(id)this.setProgress(1);};
};
`;

// ─────────────────────────────────────────────────────────────────────────────
// 5. CANVAS INTERACTION PROTOCOL — every edit is a structured patch.
// ├─ real group / ungroup / multi-select (graph ops)
// └─ drag → SEMANTIC constraint, not pixel offsets
// ─────────────────────────────────────────────────────────────────────────────
const NX_CANVAS_ACTIONS = ['select', 'hover', 'drag', 'resize', 'reparent', 'duplicate', 'delete', 'multiSelect', 'group', 'ungroup', 'setProperty', 'setConstraint', 'setBreakpoint'];
function __node(project, id) { return project.nodes[id]; }
function nxCanvasAction(project, action, payload) {
  payload = payload || {}; const id = payload.id; const isNode = x => project.nodes[x];
  if (action === 'select' || action === 'hover') return { ok: true, ops: [], description: action + ' ' + id };
  if (action === 'drag') {
    if (!isNode(id)) return { ok: false, ops: [], errors: ['not a node'] };
    return nxDragToPatch(project, id, payload.dx || 0, payload.dy || 0, payload);
  }
  if (action === 'resize') {
    if (!isNode(id)) return { ok: false, ops: [], errors: ['not a node'] };
    const w = payload.width, h = payload.height;
    return { ok: true, ops: [{ op: 'node.set', id, field: 'props', value: { width: w, height: h, intrinsic: 'fixed' } }], description: 'resize ' + id + ' to ' + w + 'x' + h };
  }
  if (action === 'reparent') {
    if (!isNode(id) || !isNode(payload.newParent)) return { ok: false, ops: [], errors: ['bad ids'] };
    return { ok: true, ops: [{ op: 'node.move', id, parentId: payload.newParent, index: payload.index }], description: 'reparent ' + id + ' → ' + payload.newParent };
  }
  if (action === 'duplicate') {
    if (!isNode(id)) return { ok: false, ops: [], errors: ['not a node'] };
    const dup = __cloneSubtree(project, id);
    if (!dup.ops.length) return { ok: false, ops: [], errors: ['nothing to duplicate'] };
    return { ok: true, ops: dup.ops, copyId: dup.root, description: 'duplicate ' + id + ' → ' + dup.root + ' (deep, same parent)' };
  }
  if (action === 'delete') { if (!isNode(id)) return { ok: false, ops: [], errors: ['not a node'] }; return { ok: true, ops: [{ op: 'node.delete', id }], description: 'delete ' + id }; }
  if (action === 'multiSelect') { return { ok: true, ops: [], selected: (payload.ids || []).slice(), description: 'select ' + (payload.ids || []).length + ' nodes' }; }
  if (action === 'group') return ngGroup(project, payload.ids || [id]);
  if (action === 'ungroup') return ngUngroup(project, id);
  if (action === 'setProperty') { if (!isNode(id)) return { ok: false, ops: [], errors: ['not a node'] }; return { ok: true, ops: [{ op: 'node.set', id, field: payload.field, value: payload.value }], description: 'set ' + id + '.' + payload.field }; }
  if (action === 'setConstraint') { if (!isNode(id)) return { ok: false, ops: [], errors: ['not a node'] }; return { ok: true, ops: [{ op: 'constraint.set', id, constraint: payload.constraint }], description: 'constraint ' + id }; }
  if (action === 'setBreakpoint') { if (!isNode(id)) return { ok: false, ops: [], errors: ['not a node'] }; return { ok: true, ops: [{ op: 'responsive.update', id, rule: { on: payload.breakpoint, props: payload.value } }], description: 'breakpoint ' + id + '@' + payload.breakpoint }; }
  return { ok: false, ops: [], errors: ['unknown canvas action ' + action] };
}
// Deep-duplicate a node AND its whole subtree, under the SAME parent, with fresh
// ids and preserved content/design/motion/responsive/interactions (so a duplicated
// hero/card is a faithful copy, not a root-level shell). `index` keeps the copy
// adjacent to the source so the layout reads as "duplicated next to it".
function __cloneSubtree(project, rootId) {
  if (!project.nodes[rootId]) return { root: null, ops: [] };
  const idMap = {};
  const collect = (id) => { idMap[id] = __kid(project, (project.nodes[id].component.family || 'n').slice(0, 3)); for (const c of (project.nodes[id].children || [])) collect(c); };
  collect(rootId);
  const ops = [];
  const emit = (oldId) => {
    const src = project.nodes[oldId];
    // Remap only parents that live INSIDE the copied subtree; an external parent
    // (the copied root's parent) is preserved as-is, so the copy stays in-place.
    const parent = src.parent != null ? (idMap[src.parent] || src.parent) : null;
    const node = { id: idMap[oldId], component: { family: src.component.family, variant: src.component.variant }, semanticRole: src.semanticRole };
    if (src.props) node.props = JSON.parse(JSON.stringify(src.props));
    if (project.content[oldId]) node.content = JSON.parse(JSON.stringify(project.content[oldId]));
    if (project.design[oldId]) node.design = JSON.parse(JSON.stringify(project.design[oldId]));
    if (project.motion[oldId]) node.motion = JSON.parse(JSON.stringify(project.motion[oldId]));
    if (project.responsive[oldId]) node.responsive = JSON.parse(JSON.stringify(project.responsive[oldId]));
    if (project.interaction[oldId]) node.interactions = JSON.parse(JSON.stringify(project.interaction[oldId]));
    if (project.assets && project.assets[oldId]) node.assets = JSON.parse(JSON.stringify(project.assets[oldId]));
    // Insert the copy right after the source among its siblings (so "duplicate"
    // reads as a visual copy placed beside the original, not appended at the end).
    let index;
    if (src.parent != null && project.nodes[src.parent]) {
      const si = (project.nodes[src.parent].children || []).indexOf(oldId);
      if (si >= 0) index = si + 1;
    }
    ops.push({ op: 'node.create', node, parentId: parent, index });
    for (const c of (src.children || [])) emit(c);
  };
  emit(rootId);
  return { root: idMap[rootId], ops };
}
// Group the selected nodes under a new real container node (preserving order,
// layout) — a genuine graph operation, not a UI mask.
function ngGroup(project, ids) {
  const valid = ids.filter(id => project.nodes[id]);
  if (valid.length < 2) return { ok: false, ops: [], errors: ['need ≥2 nodes to group'] };
  const first = valid[0];
  const parent = project.nodes[first].parent;
  const ops = [];
  const groupId = 'grp:' + (1000000 + Math.floor(Math.random() * 9000000));
  ops.push({ op: 'node.create', node: { id: groupId, component: { family: 'container', variant: 'group' }, semanticRole: 'none', props: { display: 'flex', direction: 'row', gap: '1rem' } }, parentId: parent });
  let index = project.order.indexOf(first);
  for (const id of valid) { ops.push({ op: 'node.move', id, parentId: groupId }); }
  return { ok: true, ops, description: 'grouped ' + valid.length + ' nodes under ' + groupId, groupId };
}
// Ungroup a container: move its children back to the container's parent in order,
// preserving order/layout/constraints/states. Returns a real patch.
function ngUngroup(project, id) {
  if (!project.nodes[id]) return { ok: false, ops: [], errors: ['not a node'] };
  const node = project.nodes[id];
  const children = (node.children || []).slice();
  if (!children.length) return { ok: false, ops: [], errors: ['no children to ungroup'] };
  const parent = node.parent; const ops = [];
  for (const cid of children) ops.push({ op: 'node.move', id: cid, parentId: parent || null });
  ops.push({ op: 'node.delete', id });
  return { ok: true, ops, description: 'ungrouped ' + children.length + ' nodes from ' + id };
}
// Drag → semantic layout change. Reads the parent's display model and the node's
// current constraint; emits a constraint.set (spacing/anchor/alignment) or a
// props position change, NOT accumulated pixel offsets.
function nxDragToPatch(project, id, dx, dy, opts) {
  opts = opts || {};
  const node = project.nodes[id];
  const parent = node.parent ? project.nodes[node.parent] : null;
  const pdisp = parent ? (parent.props && parent.props.display) : null;
  const pdir = parent ? (parent.props && parent.props.direction) : null;
  const c = project.constraints && project.constraints[id];
  // Preserve the existing constraint (intrinsic/fill/max/anchor/...); only the
  // spacing/anchor the drag affects is updated. (Previously a drag replaced the
  // whole constraint with {anchor, spacing}, silently wiping intrinsic/fill/max.)
  const base = Object.assign({}, c || {});
  const mk = (sp) => { const next = Object.assign({}, base); next.spacing = Object.assign({}, base.spacing || {}, sp); next.anchor = base.anchor || 'none'; return next; };
  if (pdisp === 'absolute' || (node.props && node.props.position === 'absolute')) {
    const px = (node.props && node.props.left != null) ? node.props.left : (c && c.left != null ? c.left : 0);
    const py = (node.props && node.props.top != null) ? node.props.top : (c && c.top != null ? c.top : 0);
    return { ok: true, ops: [{ op: 'node.set', id, field: 'props', value: { position: 'absolute', left: (+px || 0) + dX(dx), top: (+py || 0) + dY(dy) } }], description: 'absolute reposition ' + id };
  }
  if (pdisp === 'grid' || (pdisp === 'flex' && pdir === 'row') || (pdisp === 'flex' && (!pdir || pdir === 'row'))) {
    // horizontal move → spacing/alignment; vertical → alignSelf
    const sp = Object.assign({}, c && c.spacing);
    sp.inline = Math.max(0, (sp.inline || 0) + dX(dx));
    return { ok: true, ops: [{ op: 'constraint.set', id, constraint: mk(sp) }], description: 'constraint drag (inline spacing) ' + id };
  }
  if (pdisp === 'flex' && pdir === 'column') {
    const sp = Object.assign({}, c && c.spacing);
    sp.before = Math.max(0, (sp.before || 0) + dY(dy));
    sp.after = Math.max(0, (sp.after || 0) - dY(dy));
    return { ok: true, ops: [{ op: 'constraint.set', id, constraint: mk(sp) }], description: 'constraint drag (flow spacing) ' + id };
  }
  // default: spacing on the incremental axis
  const sp = Object.assign({}, c && c.spacing);
  sp.before = Math.max(0, (sp.before || 0) + dY(dy));
  return { ok: true, ops: [{ op: 'constraint.set', id, constraint: mk(sp) }], description: 'constraint drag ' + id };
  function dX(n) { return Math.round(opts.snap ? Math.round(n / (opts.snap || 16)) * (opts.snap || 16) : n); }
  function dY(n) { return Math.round(opts.snap ? Math.round(n / (opts.snap || 16)) * (opts.snap || 16) : n); }
}
function nxCanvasApply(project, action, payload) {
  const r = nxCanvasAction(project, action, payload);
  if (!r.ok || !r.ops.length) return r;
  const applied = __patch(project, r.ops);
  return { ...r, ...applied, ok: r.ok && applied.ok, ops: r.ops };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. LIVE CANVAS CONTROLLER — a real design surface over a live DOM element.
// ─────────────────────────────────────────────────────────────────────────────
function nxCanvas(project, opts) {
  opts = opts || {};
  // PROJECT ADOPTION: nxProjectPatch is IMMUTABLE — it returns a NEW project. The
  // controller MUST adopt that new project after every mutation, or the canvas
  // keeps re-rendering the stale original. (This was the bug that made the canvas
  // look live in smoke tests while never actually changing.)
  const controller = {
    project, mode: 'design', breakpoint: opts.breakpoint || 'desktop',
    selected: null, hovered: null, selectedSet: new Set(), root: null,
    // Apply an action, adopt the returned (new) project, redraw, and pass through.
    _apply(action, payload) {
      const r = nxCanvasApply(this.project, action, payload);
      if (r.project && r.ok) this.project = r.project;
      if (this.root) this.redraw();
      return r;
    },
    setMode(m) { this.mode = m; return this; },
    setBreakpoint(bp) { this.breakpoint = bp; if (this.root) this.redraw(); return this; },
    redraw(root) { if (root) this.root = root; if (this.root) { const doc = nxRenderDocument(this.project, { breakpoint: this.breakpoint }); const body = doc.html.match(/<body[^>]*>([\s\S]*)<\/body>/i); this.root.innerHTML = body ? body[1] : doc.html; } return this; },
    select(id) { this.selected = id; this._apply('select', { id }); return this; },
    hover(id) { this.hovered = id; this._apply('hover', { id }); return this; },
    drag(id, dx, dy, more) { return this._apply('drag', { id, dx, dy, snap: (more && more.snap) }); },
    resize(id, w, h) { return this._apply('resize', { id, width: w, height: h }); },
    setProperty(id, field, value) { return this._apply('setProperty', { id, field, value }); },
    setConstraint(id, constraint) { return this._apply('setConstraint', { id, constraint }); },
    setBreakpoint(id, bp, value) { return this._apply('setBreakpoint', { id, breakpoint: bp, value }); },
    duplicate(id) { return this._apply('duplicate', { id }); },
    _delete(id) { return this._apply('delete', { id }); },
    group(ids) { return this._apply('group', { ids }); },
    ungroup(id) { return this._apply('ungroup', { id }); },
    multiSelect(ids) { this.selectedSet = new Set(ids); this._apply('multiSelect', { ids }); return this; },
    // Overlay a real design surface on a live DOM element (the canvas is the graph,
    // not the DOM — DOM is derived). Overlay helper for real browsers.
    mount(container) { this.root = container || document.body; this.redraw(); return this; },
    idOf(el) { return el && el.getAttribute ? el.getAttribute('data-nx-id') : null; },
  };
  return controller;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. GRAPH-FIRST SITE BUILDER — the AI Director feeds creative intent + a brief
//    into this deterministic builder, which composes a real Project Graph
//    (nav/hero/features/pricing/testimonials/cta/footer as nested sub-graphs),
//    sets constraints, a motion timeline, interactions and assets, then renders
//    it. The graph IS the editable artifact; HTML is only its compiled output.
// ─────────────────────────────────────────────────────────────────────────────
function nxBuildSiteGraph(opts) {
  opts = opts || {};
  // Reference-template design route: the graph (blade order + words) drives the
  // exact template shell/CSS/runtime. `design:'template'` opts in; `words` is the
  // graph-authored copy (per-blade slot arrays, or {name,config}). Everything else
  // (tests, other designs) keeps the graph-native pipeline untouched.
  if (opts.design === 'template') {
    const t = __nxBuildTemplateGraph({ words: opts.words });
    return { project: t.project, heroId: t.project.order[0] || null, compiled: t.compiled };
  }
  const ir = (globalThis.__NX_DEPS && globalThis.__NX_DEPS.ir) || globalThis.__NX_IR;
  const patch = (p, ops) => ir.nxProjectPatch(p, ops);
  if (!ir || !ir.nxNewProject) throw new Error('nx_ir not available');
  // Honor explicit brand direction (opt tokens OR direct primary/accent/mood).
  const tokenOverrides = Object.assign({}, opts.tokens || {});
  if (opts.primary) tokenOverrides.primaryColor = opts.primary;
  if (opts.accent) tokenOverrides.secondaryColor = opts.accent;
  if (opts.motionStyle) tokenOverrides.motionStyle = opts.motionStyle;
  // Declared reduced-motion preference is part of the theme (so the evidence engine +
  // accessibility QA see it) — the renderer emits the preference regardless.
  if (!tokenOverrides.reducedMotion) tokenOverrides.reducedMotion = 'fade';
  // A dark brand (very dark primary / explicit dark flag) should carry a dark
  // background + light foreground so the theme is coherent, not text-on-white.
  const likeDark = opts.dark === true || /^#(0[0-9a-f]|1[0-9a-f])/i.test(tokenOverrides.primaryColor || '');
  if (likeDark) { if (!tokenOverrides.neutralBg) tokenOverrides.neutralBg = tokenOverrides.primaryColor || '#0a0b0d'; if (!tokenOverrides.neutralFg) tokenOverrides.neutralFg = '#f5f5f7'; }
  let project = ir.nxNewProject({ name: opts.name || 'My Website', brief: opts.brief || 'a modern website', tokens: tokenOverrides });
  const accent = project.tokens.secondaryColor || opts.accent || '#f7742a';
  const primary = project.tokens.primaryColor || opts.primary || '#0a1638';
  const steps = {
    nav: ['standard', { brand: opts.name || 'Meridian', links: ['Product', 'Solutions', 'Pricing', 'Resources'], cta: 'Get started' }],
    hero: [opts.heroVariant || 'split', {
      eyebrow: 'AI Automation Platform',
      headline: opts.headline || 'Automate the work. Amplify what your team can build.',
      sub: opts.sub || 'Meridian turns busywork into autonomous workflows — so your team ships faster, with fewer errors, and full visibility into every process.',
      cta: opts.cta || 'Start free', secondary: 'Watch the demo',
      stats: [{ v: '$128k', l: 'Revenue automated' }, { v: '64k', l: 'Leads enriched' }, { v: '23.4k', l: 'Tasks run' }],
      steps: ['Enrich lead from form to CRM', 'Draft reply with AI copilot', 'Route to owner and schedule follow-up'],
    }],
    logos: ['row', { eyebrow: 'Trusted by teams shipping the future', items: ['NORTHBEAM', 'static', 'OPTIC', 'Helios', 'VERTEX', 'aperture'] }],
    features: ['grid', {
      eyebrow: 'Platform', heading: opts.featuresHeading || 'Everything you need to run work on autopilot',
      sub: 'Connect the tools you already use and let Meridian orchestrate the busywork — from first touch to revenue.',
      items: opts.features || [
        { icon: 'bolt', title: 'Workflow automation', text: 'Chain approvals, alerts, and handoffs across 4,000+ apps in minutes — no engineering time required.' },
        { icon: 'robot', title: 'AI copilot', text: 'Draft, summarize, and route work with an assistant that learns your team\'s language and context.' },
        { icon: 'chart', title: 'Real-time analytics', text: 'Watch every process run live, with anomaly detection that surfaces risk before it becomes an outage.' },
        { icon: 'shield', title: 'Enterprise security', text: 'SOC 2 Type II, SSO/SCIM, and granular roles — trust baked in from day one.' },
        { icon: 'zap', title: 'Lightning fast', text: 'Spin up a workflow in minutes with a visual builder and 200+ curated, production-ready templates.' },
        { icon: 'globe', title: 'Global scale', text: 'Run in 12 regions with sub-second latency and a 99.99% uptime SLA, all managed for you.' },
      ],
    }],
    benefit: ['split', {
      eyebrow: 'Why Meridian', heading: 'Built to move at the speed of your roadmap',
      sub: 'Stop stitching tools together. Meridian gives your team a single system of execution with the guardrails to move fast.',
      checks: ['Launch automations in minutes, not sprints', 'Human-in-the-loop approvals where you need them', 'Dashboards that surface risk before it compounds'],
      cta: 'Explore the platform',
    }],
    testimonials: ['grid', {
      eyebrow: 'Loved by builders', heading: 'Teams run their best work on Meridian',
      items: opts.testimonials || [
        { quote: 'We automated 80% of our operations in the first quarter. Our team finally spends time on the work that moves the needle.', author: 'Sara Onwudiwe', role: 'COO, Northbeam' },
        { quote: 'The AI copilot is the first automation tool that actually understood how our team works.', author: 'Marcus Chen', role: 'Head of RevOps, Optic' },
        { quote: 'Implementation took an afternoon, not a quarter. The ROI was obvious within weeks.', author: 'Priya Raman', role: 'Founder, Helios Labs' },
      ],
    }],
    pricing: ['grid', {
      eyebrow: 'Pricing', heading: 'Start free, scale as you automate', sub: 'No hidden fees. Upgrade, downgrade, or cancel anytime.',
      tiers: opts.tiers || [
        { name: 'Starter', price: '$19', unit: '/mo', desc: 'For small teams automating their first workflows.', features: ['Up to 5 active workflows', '1,000 task runs / month', '4,000+ app integrations', 'Community support'], cta: 'Start free' },
        { name: 'Growth', price: '$49', unit: '/mo', desc: 'For scaling teams that need AI and deeper control.', features: ['Unlimited workflows', '50,000 task runs / month', 'AI copilot included', 'Advanced analytics', 'Priority support'], cta: 'Start free', popular: true },
        { name: 'Scale', price: '$99', unit: '/mo', desc: 'For orgs that need governance and enterprise-grade security.', features: ['Everything in Growth', '500,000 task runs / month', 'SSO / SCIM', 'Granular roles and audit logs', 'Dedicated success manager'], cta: 'Contact sales' },
      ],
    }],
    cta: ['centered', {
      eyebrow: 'Get started', heading: opts.ctaHeading || 'Ready to put your workflow on autopilot?',
      sub: 'Join 12,000+ teams already automating the busywork with Meridian.',
      cta: opts.cta || 'Start free', secondary: 'Talk to sales', note: 'Free 14-day trial · No credit card required',
    }],
    footer: ['columns', { name: opts.name || 'Meridian', tagline: 'Autonomous workflows for the teams building what\'s next.' }],
    marquee: ['ticker', { items: ['Autonomous Workflows', 'AI Copilot', 'Real-time Analytics', 'Enterprise Security', '4,000+ Integrations', '99.99% Uptime'] }],
    stats: ['grid', { eyebrow: 'By the numbers', heading: 'Built to move at the speed of your roadmap', sub: 'Real outcomes across the teams running their best work on Meridian.', items: [{ v: '$128k', l: 'Revenue automated' }, { v: '64k', l: 'Leads enriched' }, { v: '99.99%', l: 'Uptime SLA' }, { v: '12', l: 'Global regions' }] }],
    services: ['matrix', {
      eyebrow: 'Platform', heading: 'Everything you need to run work on autopilot', sub: 'Connect the tools you already use and let Meridian orchestrate the busywork \u2014 from first touch to revenue.',
      items: [
        { icon: 'bolt', tag: 'Automation', title: 'Workflow automation', text: 'Chain approvals, alerts, and handoffs across 4,000+ apps in minutes \u2014 no engineering time required.' },
        { icon: 'robot', tag: 'AI', title: 'AI copilot', text: 'Draft, summarize, and route work with an assistant that learns your team\'s language and context.' },
        { icon: 'chart', tag: 'Insights', title: 'Real-time analytics', text: 'Watch every process run live, with anomaly detection that surfaces risk before it becomes an outage.' },
        { icon: 'shield', tag: 'Security', title: 'Enterprise security', text: 'SOC 2 Type II, SSO/SCIM, and granular roles \u2014 trust baked in from day one.' },
        { icon: 'zap', tag: 'Speed', title: 'Lightning fast', text: 'Spin up a workflow in minutes with a visual builder and 200+ curated, production-ready templates.' },
        { icon: 'globe', tag: 'Scale', title: 'Global scale', text: 'Run in 12 regions with sub-second latency and a 99.99% uptime SLA, all managed for you.' },
      ],
    }],
    process: ['steps', { eyebrow: 'How it works', heading: 'From idea to automation in four steps', sub: 'A clear, proven process with no surprises.', items: [{ n: '01', title: 'Map your process', text: 'We map the work your team does every day and find where automation pays off.' }, { n: '02', title: 'Build the workflow', text: 'Connect the tools you already use and wire up the steps in minutes.' }, { n: '03', title: 'Run it live', text: 'Go live with guardrails, human-in-the-loop approvals, and dashboards.' }, { n: '04', title: 'Scale with confidence', text: 'Grow usage with enterprise security, audit logs, and 24/7 monitoring.' }] }],
    faq: ['accordion', { eyebrow: 'Common questions', heading: 'Frequently asked', sub: 'Straight answers to the questions we hear most.', items: [{ q: 'How long does setup take?', a: 'Most teams go live in under an afternoon. Connecting your apps and wiring a first workflow takes minutes, not sprints.' }, { q: 'Do I need engineering to build workflows?', a: 'No \u2014 the visual builder is designed for operators, with 200+ production-ready templates to start from.' }, { q: 'Is my data secure?', a: 'Yes. SOC 2 Type II, SSO/SCIM, granular roles, full audit logs, and encryption in transit and at rest.' }, { q: 'What does it cost to scale?', a: 'Start free, then upgrade as you grow. Upgrade, downgrade, or cancel anytime with no hidden fees.' }] }],
    contact: ['split', { eyebrow: 'Get in touch', heading: 'Ready to put your workflow on autopilot?', sub: 'Talk to the team and arrange a walkthrough of the platform.', cta: 'Start free', phoneTitle: 'Talk to a specialist', phone: '+1 (555) 010-2400', note: 'Free 14-day trial \u00b7 No credit card required', email: 'hello@meridian.app', fields: [{ label: 'Full name', ph: 'John Smith' }, { label: 'Work email', ph: 'you@company.com' }, { label: 'Company', ph: 'Acme Inc.' }] }],
  };
  // semanticRole is constrained by the IR to the page-section enum; the new
  // template-matched sections are rendered by their `family` (marquee/stats/…),
  // and their role class (nx-role-*) still comes from the family-driven markup,
  // so they register under the generic 'section' role here.
  const roleOf = { nav: 'nav', hero: 'hero', logos: 'section', features: 'features', benefit: 'section', testimonials: 'testimonials', pricing: 'pricing', cta: 'cta', footer: 'footer', marquee: 'section', stats: 'section', services: 'section', process: 'section', gallery: 'section', faq: 'section', contact: 'section' };
  for (const fam of ['nav', 'hero', 'logos', 'features', 'benefit', 'testimonials', 'pricing', 'cta', 'footer', 'marquee', 'stats', 'services', 'process', 'faq', 'contact']) {
    const [var_, content] = steps[fam];
    const r = nxSeedComponent(project, fam, var_, content, roleOf[fam]);
    if (!r.ok) throw new Error('build ' + fam + ': ' + r.errors.join(';'));
    project = r.project;
  }
  const heroId = project.order.find(id => project.nodes[id].semanticRole === 'hero');
  // constraints (Framer-like layout relationships)
  project = patch(project, [
    { op: 'constraint.set', id: heroId, constraint: { anchor: 'center', intrinsic: 'fill', max: { width: 1200 } } },
    { op: 'motion.update', id: heroId, profile: { recipe: opts.motionStyle || 'cinematic', primitives: ['heading-reveal', 'subtitle-reveal', 'cta-spring', 'background-parallax', '3d-rotate'], duration: 1.4 } },
  ]).project;
  // interaction: hero CTA scales on select (click/press) → runtime behavior
  const heroBtn = project.order.find(id => project.nodes[id].component.family === 'button') || null;
  if (heroBtn) project = patch(project, [{ op: 'interaction.add', id: heroBtn, interaction: { trigger: 'click', target: heroBtn, actions: [{ type: 'scale', value: 1.08 }, { type: 'update-state', value: 'active' }] } }]).project;
  // Responsive is authored INTO the graph (grids/columns reflow on mobile), so the
  // graph — not just a global CSS fallback — is the source of truth for reflow.
  // Deliberate per-node reflow choices (the composition actually changes shape):
  //   • nav text links hide on mobile (brand + CTA stay), so the nav never overflows;
  //   • the hero dashboard stat grid stacks to one column;
  //   • the hero visual / metric card shrink to the viewport.
  const byRole = {};
  for (const id of project.order) { const r = project.content[id] && project.content[id].role; if (r) byRole[r] = id; }
  const respOps = [];
  if (byRole['nav-links']) respOps.push({ op: 'responsive.update', id: byRole['nav-links'], rule: { on: 'mobile', props: { display: 'flex', direction: 'row', visible: false } } });
  if (byRole['app-stat-grid']) respOps.push({ op: 'responsive.update', id: byRole['app-stat-grid'], rule: { on: 'mobile', props: { display: 'grid', columns: 1, gap: '0.8rem' } } });
  if (byRole['app-toolbar']) respOps.push({ op: 'responsive.update', id: byRole['app-toolbar'], rule: { on: 'mobile', props: { display: 'flex', direction: 'column', alignItems: 'flex-start', gap: '0.8rem' } } });
  if (byRole['hero-actions']) respOps.push({ op: 'responsive.update', id: byRole['hero-actions'], rule: { on: 'mobile', props: { display: 'flex', direction: 'column', alignItems: 'stretch', gap: '0.8rem' } } });
  if (byRole['cta-actions']) respOps.push({ op: 'responsive.update', id: byRole['cta-actions'], rule: { on: 'mobile', props: { display: 'flex', direction: 'column', alignItems: 'stretch', gap: '0.8rem' } } });
  if (byRole['benefit-checks']) respOps.push({ op: 'responsive.update', id: byRole['benefit-checks'], rule: { on: 'mobile', props: { visible: true } } });
  // Hero trust row wraps + centers on narrow viewports so the 4.9/5 · SOC 2 marks
  // never spill off-screen (this was a real mobile overflow).
  if (byRole['hero-trust']) respOps.push({ op: 'responsive.update', id: byRole['hero-trust'], rule: { on: 'mobile', props: { wrap: true, gap: '0.7rem', justifyContent: 'center' } } });
  if (byRole['hero-copy']) respOps.push({ op: 'responsive.update', id: byRole['hero-copy'], rule: { on: 'mobile', props: { alignItems: 'center', textAlign: 'center' } } });
  // New template-matched sections author their own reflow into the graph: the
  // services + process matrices collapse to 1 col on mobile, contact stacks, and
  // the stats band goes 2-up (its CSS does the 2-up; the graph keeps columns real).
  if (byRole['services-grid']) respOps.push({ op: 'responsive.update', id: byRole['services-grid'], rule: { on: 'mobile', props: { display: 'grid', columns: 1, gap: '1.4rem' } } });
  if (byRole['process-grid']) respOps.push({ op: 'responsive.update', id: byRole['process-grid'], rule: { on: 'mobile', props: { display: 'grid', columns: 1, gap: '1.4rem' } } });
  if (byRole['contact-grid']) respOps.push({ op: 'responsive.update', id: byRole['contact-grid'], rule: { on: 'mobile', props: { display: 'grid', columns: 1, gap: '2rem' } } });
  if (byRole['faq-list']) respOps.push({ op: 'responsive.update', id: byRole['faq-list'], rule: { on: 'mobile', props: { gap: '0.7rem' } } });
  if (respOps.length) project = patch(project, respOps).project;
  project = __authorResponsive(project);
  return { project, heroId, compiled: nxRenderDocument(project) };
}


// ── REFERENCE-TEMPLATE DESIGN LIBRARY (graph-driven) ──────────────────────────
// The template library is a separate sibling module (nx_template.js). When the
// build opts for the reference design (opts.design === 'template'), the Project
// Graph still drives the site: each of the template's 21 blades is a graph node
// whose content carries the WORDS. The design shell, CSS and runtime script come
// verbatim from the library. These wrappers keep the client API surface stable.
function __tpl() {
  // Baked artifacts (backend / hardened HTML) register the library inline as
  // globalThis.NX_TEMPLATE_LIB; the test harness wires it via __NX_DEPS.template;
  // the standalone workspace module is loaded via require('./nx_template.js').
  if (typeof globalThis !== 'undefined' && globalThis.NX_TEMPLATE_LIB) {
    const tm = globalThis.NX_TEMPLATE_LIB;
    if (tm && tm.nxBuildTemplateSite) return tm;
  }
  if (typeof globalThis !== 'undefined' && globalThis.__NX_DEPS && globalThis.__NX_DEPS.template) {
    const tm = globalThis.__NX_DEPS.template;
    return typeof tm === 'object' && tm.nxBuildTemplateSite ? tm : null;
  }
  try { if (typeof require === 'function') { const m = require('./nx_template.js'); if (m && m.nxBuildTemplateSite) return m; } } catch {}
  return null;
}
function nxTemplateProject(words) { const m = __tpl(); if (!m) throw new Error('nx_template not available'); return m.nxTemplateProject(words); }
function nxRenderTemplateNode(project, id) { const m = __tpl(); if (!m) throw new Error('nx_template not available'); return m.nxRenderTemplateNode(project, id); }
function nxRenderTemplateDocument(project, opts) { const m = __tpl(); if (!m) throw new Error('nx_template not available'); return m.nxRenderTemplateDocument(project, opts); }
function nxBuildTemplateSite(words, opts) { const m = __tpl(); if (!m) throw new Error('nx_template not available'); return m.nxBuildTemplateSite(words, opts); }
function nxPlanToWords(plan) { const m = __tpl(); if (!m) throw new Error('nx_template not available'); return m.nxPlanToWords(plan); }
function nxBuildTemplateSiteFromPlan(plan) { const m = __tpl(); if (!m) throw new Error('nx_template not available'); return m.nxBuildTemplateSiteFromPlan(plan); }
// Route: when the design system IS the reference template, nxBuildSiteGraph
// composes the graph (blade order = graph order, words = graph content) and
// compiles it through the template renderer.
function __nxBuildTemplateGraph(opts) {
  const words = opts && opts.words;
  return __tpl().nxBuildTemplateSite(words || null);
}

// ── EXPORTS ──────────────────────────────────────────────────────────────────
const API = {
  NX_CANVAS_ACTIONS, NX_COMPONENT_DEFS, NX_CHILDREN, NX_HEAVY_PRIMITIVES,
  nxRenderTree, nxRenderNode, nxResolveNodeView, nxRenderDocument,
  nxRuntimeScript, nxRuntimeMotionSpec, nxSeedComponent, nxBuildSiteGraph,
  // Reference-template design library (graph-driven). The Project Graph is the
  // real runtime; the template library supplies the exact shell + CSS + runtime
  // script, and every word is graph content. nxBuildSiteGraph passes through
  // when opts.design !== 'template' so the graph-native design stays untouched.
  nxTemplateProject, nxRenderTemplateNode, nxRenderTemplateDocument, nxBuildTemplateSite,
  nxPlanToWords, nxBuildTemplateSiteFromPlan,
  nxCanvasAction, nxCanvasApply, nxCanvas, nxDragToPatch,
  ngGroup, ngUngroup,
  // backward-compat alias: render a single (sub)tree node
  nxNodeHtml: (project, nodeOrId, tokens) => nxRenderNode(project, typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id, 'desktop'),
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') { for (const k of Object.keys(API)) window[k] = API[k]; }
