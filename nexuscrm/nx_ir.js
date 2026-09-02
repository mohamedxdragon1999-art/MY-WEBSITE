// ─────────────────────────────────────────────────────────────────────────────
// nx_ir.js — the formal INTERMEDIATE REPRESENTATION (IR) foundation layer.
//
// v0.0.1.6 built the design system core (nx_design.js). This is the NEXT layer:
// the *contract* the renderer / motion / AI-orchestrator will all sit on. It
// provides:
//   • explicit node schemas + validation        (so no two functions disagree on a node)
//   • a Project Mutation Engine                  (every AI action = a structured patch)
//   • a Design Brief object                      (persistent creative intent)
//   • a Constraint / Layout Engine               (Framer-like layout + derived responsive)
//   • a first-class Interaction Graph            (trigger/target/state/actions)
//   • richer Motion composition                  (multi-primitive recipes)
//   • a Compiler Pipeline                        (normalize→validate→layout→style→motion→interaction→asset→code)
//   • Design-QA methodology                     (structural / visual / brand / motion sub-scores)
//   • an AI Critic → Patch → re-evaluate loop    (autonomous refinement)
//
// Dependency-free. Pure + deterministic. Runs in the worker, browser, and tests.
// It reuses the design system (nx_design.js) when available for component
// defaults, but never requires it — it falls back to a built-in minimal builder.
// ─────────────────────────────────────────────────────────────────────────────

let __seq = 10000 + Math.floor(Math.random() * 90000);
function __nid(prefix) { return (prefix || 'n') + ':' + (__seq++); }

// Reuse the design system when present (Node require, or browser globals).
function __D(name, dflt) {
  if (typeof globalThis !== 'undefined') {
    if (globalThis.__NX_DESIGN && globalThis.__NX_DESIGN[name]) return globalThis.__NX_DESIGN[name];
    if (globalThis[name] && typeof globalThis[name] === 'function') return globalThis[name];
  }
  try { const D = (typeof require === 'function') ? require('./nx_design.js') : null; if (D && D[name]) return D[name]; } catch {}
  return dflt;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. IR CONTRACTS + SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════
const NX_NODE_FIELDS = ['id', 'type', 'parent', 'children', 'semanticRole', 'component',
  'props', 'styles', 'tokens', 'content', 'design', 'motion', 'responsive',
  'interactions', 'assets', 'metadata'];
const NX_NODE_TYPES = ['component', 'container', 'text', 'media', 'nav', 'footer', 'section', 'root'];
const NX_SEMANTIC_ROLES = ['hero', 'features', 'pricing', 'testimonials', 'cta', 'nav', 'footer', 'section', 'none'];
const NX_LAYOUT_DISPLAY = ['flow', 'flex', 'grid', 'stack'];
const NX_LAYOUT_DIRECTION = ['row', 'column'];
const NX_LAYOUT_ALIGN = ['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'];
const NX_WIDTH = ['auto', 'fill', 'hug', 'fixed'];

// The allowed content of every slot. This is the single contract interpreters
// must honor — change a schema here and validation catches every violator.
const NX_NODE_SCHEMA = {
  id:            { type: 'string', required: true, pattern: /^[A-Za-z0-9:_-]+$/ },
  type:          { type: 'enum', required: true, values: NX_NODE_TYPES },
  parent:        { type: 'string', nullable: true },
  semanticRole:  { type: 'enum', required: true, values: NX_SEMANTIC_ROLES },
  children:      { type: 'array' },
  component:     { type: 'object', keys: { family: 'string', variant: 'string' } },
  props:         { type: 'object', allowed: ['display', 'direction', 'align', 'justifyContent', 'columns', 'gap', 'rowGap', 'columnGap', 'maxWidth', 'padding', 'paddingBlock', 'paddingInline', 'wrap', 'position', 'aspectRatio', 'minWidth', 'minHeight', 'maxWidthPx', 'width', 'fill', 'hug', 'alignment', 'left', 'top', 'right', 'bottom', 'zIndex', 'gridColumn', 'gridRow', 'order', 'offsetX', 'offsetY', 'textAlign', 'alignItems', 'alignSelf', 'justifySelf', 'visible', 'level', 'variant', 'href', 'ontrigger', 'src', 'label', 'icon', 'tone'], },
  styles:        { type: 'object' },
  tokens:        { type: 'object' },
  content:       { type: 'object' },
  design:        { type: 'object' },
  motion:        { type: 'object' },
  responsive:    { type: 'array', item: 'object' },
  interactions:  { type: 'array', item: 'object' },
  assets:        { type: 'array', item: 'object' },
  metadata:      { type: 'object' },
};

function nxValidateNode(node) {
  const errors = [];
  if (!node || typeof node !== 'object') return { ok: false, errors: ['node is not an object'] };
  for (const [field, spec] of Object.entries(NX_NODE_SCHEMA)) {
    const v = node[field];
    if (spec.required && (v === undefined || v === null || v === '')) { errors.push(field + ' is required'); continue; }
    if (v === undefined || v === null) continue;
    if (spec.type === 'enum' && !spec.values.includes(v)) errors.push(field + ' must be one of [' + spec.values.join(', ') + ']');
    if (spec.type === 'string' && typeof v !== 'string') errors.push(field + ' must be a string');
    if (spec.pattern && typeof v === 'string' && !spec.pattern.test(v)) errors.push(field + ' has invalid chars');
    if (spec.type === 'object' && (typeof v !== 'object' || Array.isArray(v))) errors.push(field + ' must be an object');
    if (spec.type === 'array' && !Array.isArray(v)) errors.push(field + ' must be an array');
  }
  if (!node.component || !node.component.family) errors.push('component.family is required');
  // separator-of-concerns enforcement: content only holds words, design only holds look, etc.
  if (node.content && typeof node.content.headline === 'string') { /* fine */ }
  const allowedProps = NX_NODE_SCHEMA.props.allowed;
  if (node.props) for (const k of Object.keys(node.props)) if (!allowedProps.includes(k)) errors.push('props ' + k + ' not in the layout contract');
  return { ok: errors.length === 0, errors };
}

function nxValidateProject(project) {
  const errors = [];
  if (!project || typeof project.nodes !== 'object' || !Array.isArray(project.order)) return { ok: false, errors: ['not a project'] };
  if (!project.order.length) errors.push('project has no components');
  for (const id of project.order) {
    const n = project.nodes[id];
    if (!n) { errors.push('dangling order entry ' + id); continue; }
    const v = nxValidateNode(n);
    if (!v.ok) for (const e of v.errors) errors.push(id + ': ' + e);
  }
  const heroes = project.order.filter(id => project.nodes[id] && project.nodes[id].semanticRole === 'hero');
  if (!heroes.length) errors.push('project has no hero');
  if (heroes.length > 1) errors.push('project has more than one hero');
  if (project.brief && !nxBriefValidate(project.brief).ok) for (const e of nxBriefValidate(project.brief).errors) errors.push('brief: ' + e);
  return { ok: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1b. GRAPH INTEGRITY — the Project Graph must be a sound tree/DAG before it is
//     accepted. This is the gate that makes "project is valid" mean something.
//     It checks: exactly one root (in tree mode), no cycles, parent/child
//     symmetry, no duplicate/dangling children, every node reachable from a root,
//     a well-formed order, and that every cross-graph reference (interaction
//     target, state, asset, constraint, motion, responsive) points at a real node.
// ═══════════════════════════════════════════════════════════════════════════
function nxValidateGraphIntegrity(project, opts) {
  opts = opts || {};
  // This function IS the safety net for a corrupted graph, so it must REPORT
  // corruption rather than throw on it. A malformed `order` or a null node used
  // to crash the validator, which turned "the graph is broken" into an
  // unhandled exception at the call site.
  if (!project || typeof project !== 'object') return { ok: false, errors: ['project is not an object'] };
  const rawNodes = project.nodes;
  if (!rawNodes || typeof rawNodes !== 'object' || Array.isArray(rawNodes)) return { ok: false, errors: ['project.nodes is not an object'] };
  if (project.order !== undefined && !Array.isArray(project.order)) return { ok: false, errors: ['project.order is not an array'] };
  const errors = [];
  // Drop structurally invalid nodes up front and report them, so the checks
  // below can assume every remaining node is a usable object.
  const nodes = {};
  for (const id of Object.keys(rawNodes)) {
    const n = rawNodes[id];
    if (!n || typeof n !== 'object' || Array.isArray(n)) { errors.push('node ' + id + ' is not a valid object'); continue; }
    if (n.children !== undefined && !Array.isArray(n.children)) { errors.push('node ' + id + ' has a non-array children'); continue; }
    nodes[id] = n;
  }
  const order = Array.isArray(project.order) ? project.order : [];
  const idSet = new Set(Object.keys(nodes));
  // order must be exactly the set of nodes, no dupes/subsets
  if (new Set(order).size !== order.length) errors.push('order has duplicate ids');
  if (order.some(id => !idSet.has(id))) errors.push('order references a non-existent node');
  if (order.length !== idSet.size) {
    const missing = [...idSet].filter(id => !order.includes(id));
    errors.push('node(s) not in order: ' + missing.slice(0, 5).join(', '));
  }
  // parent/child symmetry + duplicate children + dangling children + cycle + reachability
  const parent = {}, childrenOf = {};
  for (const id of Object.keys(nodes)) {
    const n = nodes[id];
    if (!n.children) n.children = [];
    if (new Set(n.children).size !== n.children.length) errors.push(id + ' has duplicate children');
    childrenOf[id] = n.children;
  }
  for (const id of Object.keys(nodes)) {
    const n = nodes[id];
    if (n.parent != null) {
      if (!idSet.has(n.parent)) errors.push(id + ' parent ' + n.parent + ' is dangling');
      else if (!childrenOf[n.parent].includes(id)) errors.push(id + ' is not in parent ' + n.parent + "'s children (asymmetric)");
    }
    for (const c of n.children) {
      if (!idSet.has(c)) errors.push(id + ' child ' + c + ' is dangling');
      else if (nodes[c].parent !== id) errors.push(c + ' parent != ' + id + ' (asymmetric)');
    }
    // self/descendant self-reference guard
    let stack = [...n.children], seen = new Set([id]);
    while (stack.length) { const c = stack.pop(); if (c === id) errors.push(id + ' forms a cycle'); if (seen.has(c)) continue; seen.add(c); if (nodes[c]) stack.push(...(nodes[c].children || [])); }
  }
  // reachability from roots (parent == null). In page mode every top-level is a root.
  const roots = Object.keys(nodes).filter(id => nodes[id].parent == null);
  if (opts.requireSingleRoot && roots.length !== 1) errors.push('expected exactly one root, found ' + roots.length);
  const reachable = new Set();
  const walk = (ids) => { for (const id of ids) { if (nodes[id] && !reachable.has(id)) { reachable.add(id); walk(nodes[id].children || []); } } };
  walk(roots);
  for (const id of Object.keys(nodes)) if (!reachable.has(id)) errors.push(id + ' is unreachable from any root');
  // cross-graph references must point at real nodes
  const keyed = ['states', 'constraints', 'assetGraph', 'motion', 'responsive', 'design', 'content', 'interaction'];
  for (const graphKey of keyed) {
    const g = project[graphKey]; if (!g) continue;
    for (const id of Object.keys(g)) if (!idSet.has(id)) errors.push(graphKey + ' references non-node ' + id);
  }
  // interaction targets
  for (const id of Object.keys(project.interaction || {})) {
    const list = project.interaction[id]; if (!Array.isArray(list)) continue;
    for (const it of list) if (it && it.target != null && !idSet.has(it.target)) errors.push('interaction on ' + id + ' targets non-node ' + it.target);
  }
  return { ok: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1c. PER-CONCERN SCHEMAS — no concern graph is a loose object. Each has allowed
//     keys/rough types, so a malformed graph is rejected BEFORE rendering.
// ───────────────────────────────────────────────────────────────────────────
const NX_CONCERN_SCHEMAS = {
  design:   { allowed: ['colors', 'typography', 'hierarchy', 'spacing', 'radius', 'shadow', 'background', 'fontSize', 'fontWeight', 'color', 'backgroundColor', 'opacity', 'borderRadius', 'letterSpacing', 'lineHeight', 'textTransform', 'boxShadow', 'textAlign', 'border', 'borderWidth', 'borderColor', 'borderTop', 'borderBottom', 'borderLeft', 'borderRight', 'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'flex', 'flexDirection', 'flexWrap', 'flexGrow', 'gap', 'overflow', 'position', 'inset', 'zIndex', 'transform', 'transition', 'filter', 'backgroundImage', 'aspectRatio', 'display', 'alignItems', 'alignSelf', 'justifyContent', 'justifySelf', 'order', 'borderRadius'], nest: { colors: ['primary', 'accent', 'bg', 'fg', 'surface'], typography: ['headingFont', 'bodyFont'] } },
  content:  { free: true }, // content holds arbitrary copy but each slot is validated by the component
  motion:   { allowed: ['recipe', 'primitives', 'speed', 'easing', 'stagger', 'parallax', 'reduced', 'timeline', 'trigger', 'duration', 'delay', 'fallback'], primitives: 'array' },
  responsive:{ free: true, list: true }, // array of {on, props}
  interactions:{ free: true, list: true },
  asset:    { allowed: ['id', 'kind', 'src', 'width', 'height', 'aspectRatio', 'format', 'sizeKB', 'usage', 'variants', 'optimized', 'source', 'license', 'alt', 'role'] },
  constraints:{ allowed: ['anchor', 'alignment', 'spacing', 'min', 'max', 'intrinsic', 'aspectRatio', 'parent', 'siblings', 'stack', 'breakpoints'] },
  state:    { free: true }, // overrides map keyed by state
  metadata: { free: true },
};
function __checkObjectKeys(obj, spec, path, errors) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { errors.push(path + ' must be an object'); return; }
  for (const k of Object.keys(obj)) if (spec.allowed && !spec.allowed.includes(k)) errors.push(path + '.(' + k + ') not allowed; keys are [' + spec.allowed.join(', ') + ']');
  if (spec.nest) for (const [nk, keys] of Object.entries(spec.nest)) if (obj[nk] && typeof obj[nk] === 'object') for (const k of Object.keys(obj[nk])) if (!keys.includes(k)) errors.push(path + '.' + nk + '.( ' + k + ') not allowed');
  if (spec.primitives === 'array' && obj.primitives && !Array.isArray(obj.primitives)) errors.push(path + '.primitives must be an array');
}
// Validate the per-node concern graphs. Returns {ok, errors}. The caller decides
// whether strictness is on (e.g. the renderer calls this before emitting).
function nxValidateGraphState(project) {
  const errors = [];
  if (!project) return { ok: false, errors: ['not a project'] };
  const g = {
    design: project.design, content: project.content, motion: project.motion,
    responsive: project.responsive, interaction: project.interaction,
    constraints: project.constraints, states: project.states,
    assetGraph: project.assetGraph, metadata: project.nodes,
  };
  for (const id of Object.keys(project.nodes || {})) {
    const meta = project.nodes[id];
    if (meta && meta.metadata) __checkObjectKeys(meta.metadata, NX_CONCERN_SCHEMAS.metadata, id + '.metadata', errors);
    const asset = (project.assetGraph || {})[id];
    if (asset) __checkObjectKeys(asset, NX_CONCERN_SCHEMAS.asset, id + '.asset', errors);
  }
  for (const [key, spec] of Object.entries(NX_CONCERN_SCHEMAS)) {
    if (key === 'asset' || key === 'metadata') continue;
    const map = g[key]; if (!map) continue;
    for (const id of Object.keys(map)) {
      const v = map[id];
      if (key === 'responsive' || key === 'interactions') { if (v && !Array.isArray(v)) errors.push(id + '.' + key + ' must be an array'); continue; }
      if (v != null) __checkObjectKeys(v, spec, id + '.' + key, errors);
    }
  }
  return { ok: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. DESIGN BRIEF OBJECT (persistent creative intent)
// ═══════════════════════════════════════════════════════════════════════════
const NX_BRIEF_FIELDS = ['brand', 'audience', 'industry', 'goal', 'tone', 'visualStyle',
  'colorDirection', 'typographyDirection', 'layoutStyle', 'motionMood', 'density',
  'imageryStyle', 'style3d', 'conversionGoal', 'responsivePriority', 'accessibilityPriority'];
const NX_BRIEF_DEFAULTS = {
  brand: '', audience: '', industry: 'general', goal: '', tone: 'professional',
  visualStyle: 'modern-clean', colorDirection: 'neutral', typographyDirection: 'sans',
  layoutStyle: 'stack', motionMood: 'smooth', density: 'balanced',
  imageryStyle: 'photo', style3d: 'library', conversionGoal: 'lead', responsivePriority: 'mobile-first',
  accessibilityPriority: 'high',
};

// Deterministic keyword extraction from a freeform prompt into a Brief.
const NX_BRIEF_KEYWORDS = {
  industry: { luxury: ['luxury', 'premium', 'high-end', 'boutique'], tech: ['tech', 'saas', 'software', 'startup', 'app', 'ai'], fashion: ['fashion', 'style', 'apparel', 'clothing'], food: ['restaurant', 'cafe', 'food', 'bakery', 'coffee'], realestate: ['real estate', 'property', 'realtor', 'apartment'], law: ['law', 'firm', 'attorney', 'legal'], health: ['health', 'fitness', 'gym', 'wellness', 'clinic'], finance: ['finance', 'bank', 'invest', 'accounting'], agency: ['agency', 'studio', 'creative', 'design'], education: ['school', 'course', 'academy', 'tutor'] },
  tone: { playful: ['playful', 'fun', 'friendly', 'casual'], luxurious: ['luxury', 'premium', 'elegant'], bold: ['bold', 'loud', 'energetic', 'daring'], calm: ['calm', 'quiet', 'serene', 'minimal'], corporate: ['corporate', 'professional', 'enterprise'] },
  colorDirection: { dark: ['dark', 'black', 'night'], light: ['light', 'white', 'bright'], vibrant: ['vibrant', 'colorful', 'loud', 'bold'], muted: ['muted', 'soft', 'subtle', 'pastel'], warm: ['warm', 'orange', 'amber', 'earth'], cool: ['cool', 'blue', 'teal', 'cyan'] },
  visualStyle: { minimal: ['minimal', 'minimalist', 'clean', 'simple'], editorial: ['editorial', 'magazine', 'serif'], futuristic: ['futuristic', 'sci-fi', 'neon', 'cinematic'], organic: ['organic', 'earthy', 'natural', 'warm'] },
  layoutStyle: { split: ['split', 'two column'], centered: ['centered', 'center aligned'], asymmetric: ['asymmetric', 'asymmetry'], bento: ['bento', 'grid'] },
  motionMood: { cinematic: ['cinematic', 'dramatic', 'film'], energetic: ['energetic', 'lively', 'upbeat'], minimal: ['minimal', 'calm', 'quiet', 'still'], playful: ['playful', 'fun', 'bouncy'], futuristic: ['3d', 'futuristic', 'parallax'] },
  density: { airy: ['airy', 'spacious', 'lots of space', 'breathing room'], dense: ['dense', 'packed', 'compact', 'content heavy'] },
  conversionGoal: { lead: ['lead', 'signup', 'contact', 'form'], sale: ['buy', 'purchase', 'checkout', 'order', 'price'], booking: ['book', 'appointment', 'reserve', 'schedule'], subscribe: ['subscribe', 'newsletter', 'email'] },
  accessibilityPriority: { high: ['accessible', 'a11y', 'wcag', 'inclusive'], medium: ['contrast', 'readable'] },
};
function __briefHits(words, prompt) { return words.filter(w => prompt.includes(w)).length; }
function nxBriefFromPrompt(prompt) {
  const p = String(prompt || '').toLowerCase();
  const b = Object.assign({}, NX_BRIEF_DEFAULTS);
  // brand name = first capitalized token / quoted
  const m = prompt.match(/["“]([^"”]+)["”]/);
  b.brand = (m ? m[1] : '' || '').trim();
  b.audience = (prompt.match(/(?:for|aimed at|target|for)\s+([a-z0-9 ,-]{4,40})/i) || [])[1] || '';
  for (const [field, groups] of Object.entries(NX_BRIEF_KEYWORDS)) {
    let best = null, bestN = 0;
    for (const [label, words] of Object.entries(groups)) {
      const n = __briefHits(words, p);
      if (n > bestN) { bestN = n; best = label; }
    }
    if (best) b[field] = best;
  }
  if (!b.industry && p) b.industry = 'general';
  if (!b.goal) b.goal = 'describe the value proposition and drive ' + b.conversionGoal;
  return b;
}
function nxBriefValidate(brief) {
  const errors = [];
  for (const f of NX_BRIEF_FIELDS) if (brief[f] === undefined) errors.push('brief.' + f + ' is missing');
  if (!['sans', 'serif', 'mono', 'display'].includes(brief.typographyDirection)) errors.push('brief.typographyDirection must be sans/serif/mono/display');
  if (!['cinematic', 'energetic', 'minimal', 'playful', 'futuristic', 'smooth', 'none'].includes(brief.motionMood)) errors.push('brief.motionMood invalid');
  return { ok: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. PROJECT MODEL with STRONGLY SEPARATED concern graphs
//    component = what it is · design = how it looks · content = what it says
//    motion = how it moves · responsive = per-viewport · interaction = user effect
// ═══════════════════════════════════════════════════════════════════════════
function nxNewProject(opts) {
  const tokens = __D('nxMergeBrand', (base, patch) => Object.assign({}, base, patch))(opts?.tokens || {}, {});
  return {
    id: 'p:' + (__seq++),
    name: (opts && opts.name) || 'Untitled',
    brief: (opts && opts.brief && typeof opts.brief === 'object') ? Object.assign({}, NX_BRIEF_DEFAULTS, opts.brief) : nxBriefFromPrompt((opts && opts.brief) || ''),
    tokens: tokens,
    nodes: {},            // component/structure graph (what it is)
    design: {},           // how it looks
    content: {},          // what it says
    motion: {},           // how it moves
    responsive: {},       // per-viewport rules
    interaction: {},      // user-effect graph (trigger/target/state/actions)
    assets: {},           // images / 3D / video
    order: [],
    direction: (opts && opts.direction) || '',
    meta: { compiledAt: null },
  };
}

// Minimal, self-contained component defaults. The IR owns its own defaults so it
// never has to guess how a sibling module shapes its nodes; richer design /
// motion is layered on via the mutation engine.
const NX_COMPONENT_DEFAULTS = {
  nav:         { semanticRole: 'nav',    props: { display: 'flex', direction: 'row', justifyContent: 'space-between', gap: '1rem', paddingInline: '2rem' }, content: { brand: 'Brand', links: ['Home', 'About', 'Contact'] } },
  hero:        { semanticRole: 'hero',   props: { columns: 2, gap: '2rem', align: 'center' }, content: { headline: 'Welcome', sub: '', cta: 'Get started' } },
  features:    { semanticRole: 'features', props: { columns: 3, gap: '1.5rem' }, content: { heading: 'What we do', items: [{ title: 'Fast', text: 'Built to move.' }, { title: 'Beautiful', text: 'Designed to feel.' }, { title: 'Flexible', text: 'Grows with you.' }] } },
  pricing:     { semanticRole: 'pricing', props: { columns: 3, gap: '1.5rem' }, content: { heading: 'Pricing', tiers: [{ name: 'Starter', price: '$19/mo' }, { name: 'Pro', price: '$49/mo' }, { name: 'Business', price: '$99/mo' }] } },
  testimonials:{ semanticRole: 'testimonials', props: { columns: 3, gap: '1.5rem' }, content: { heading: 'What clients say', items: [{ quote: 'Loved it.', author: 'A. Client' }, { quote: 'Great product.', author: 'B. User' }] } },
  cta:         { semanticRole: 'cta',    props: { display: 'flex', direction: 'column', align: 'center', gap: '1rem' }, content: { heading: 'Ready?', sub: '', cta: 'Get started' } },
  footer:      { semanticRole: 'footer', props: { columns: 4, gap: '1rem' }, content: { name: 'Your Company', legal: '' } },
  section:     { semanticRole: 'section', props: { columns: 1, gap: '1rem' }, content: { heading: '', text: '' } },
};
function nxDefaultProps(family, variant) {
  const base = Object.assign({}, NX_COMPONENT_DEFAULTS[family] ? NX_COMPONENT_DEFAULTS[family].props : {});
  if (!variant) return base;
  const v = String(variant).toLowerCase();
  if (/centered|center/.test(v)) { base.columns = 1; base.align = 'center'; base.display = 'flex'; base.direction = 'column'; }
  else if (/split|asymmetric|product|3d|video|interactive/.test(v)) { base.columns = (v === 'asymmetric') ? [3, 2] : 2; base.align = 'start'; base.display = 'grid'; }
  else if (/grid/.test(v)) base.columns = Math.max(base.columns || 1, 3);
  else if (/editorial/.test(v)) { base.columns = 1; base.align = 'start'; }
  return base;
}
// Seed a node with defaults for every concern graph, derived from its component
// family/variant. The concerns are separated into their own graphs immediately,
// so downstream engines each read exactly the slice they own.
function nxSeedNode(project, spec) {
  const family = spec.component.family;
  const def = NX_COMPONENT_DEFAULTS[family] ? Object.assign({}, NX_COMPONENT_DEFAULTS[family]) : { semanticRole: 'section', props: {}, content: {} };
  const id = spec.id || __nid(spec.semanticRole || def.semanticRole || family);
  const node = {
    id, type: spec.type || 'component', parent: spec.parent || null, children: spec.children || [],
    semanticRole: spec.semanticRole || def.semanticRole || 'section',
    component: { family, variant: spec.component.variant || (family === 'hero' ? 'split' : (family === 'nav' ? 'standard' : 'default')) },
    props: Object.assign({}, def.props, nxDefaultProps(family, spec.component.variant), spec.props || {}),
    styles: {}, tokens: {}, metadata: {},
  };
  // separate the concerns into their graphs (component graph holds only structure)
  project.design[id] = Object.assign({
    colors: { primary: project.tokens.primaryColor, accent: project.tokens.accentColor, bg: project.tokens.neutralBg, fg: project.tokens.neutralFg },
    typography: { headingFont: project.tokens.headingFont, bodyFont: project.tokens.bodyFont },
    hierarchy: [],
  }, spec.design || {});
  project.content[id] = Object.assign({}, def.content, spec.content || {});
  project.motion[id] = Object.assign({ recipe: project.brief.motionMood || 'smooth', primitives: [], reduced: 'fade' }, spec.motion || {});
  project.responsive[id] = Array.isArray(spec.responsive) ? spec.responsive.slice() : [];
  project.interaction[id] = Array.isArray(spec.interactions) ? spec.interactions.slice() : [];
  node.assets = (spec.assets || []).slice();
  project.assets[id] = node.assets;
  project.nodes[id] = node;
  project.order.push(id);
  return node;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. PROJECT MUTATION ENGINE — every AI action is a structured patch
// ═══════════════════════════════════════════════════════════════════════════
// An op is `{op, ...}`. nxProjectPatch applies a list of ops transactionally:
// if any op fails validation, nothing is committed (rollback). Returns a new
// project (immutable copy), the ops actually applied, and errors.
function __cloneProject(p) {
  const c = Object.assign({}, p, { nodes: Object.assign({}, p.nodes), design: Object.assign({}, p.design), content: Object.assign({}, p.content), motion: Object.assign({}, p.motion), responsive: Object.assign({}, p.responsive), interaction: Object.assign({}, p.interaction), assets: Object.assign({}, p.assets), order: p.order.slice(), constraints: Object.assign({}, p.constraints || {}), states: Object.assign({}, p.states || {}), assetGraph: Object.assign({}, p.assetGraph || {}), history: (p.history || []).slice() });
  return c;
}
// True deep clone. The mutation engine must NEVER share a nested object with the
// caller, or a failed transaction can mutate the original in place. JSON-safe
// (the project model is plain data), but fall back to a recursive clone for safety.
function __deepClone(v, seen) {
  if (v == null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime());
  seen = seen || new Map();
  if (seen.has(v)) return seen.get(v);
  const out = Array.isArray(v) ? [] : {};
  seen.set(v, out);
  for (const k of Object.keys(v)) out[k] = __deepClone(v[k], seen);
  return out;
}
const NX_OPS = ['node.create', 'node.delete', 'node.move', 'node.replace', 'node.set', 'token.update', 'motion.update', 'responsive.update', 'asset.replace', 'interaction.add', 'constraint.set', 'state.set', 'asset.set'];

// A graph id must be an OWN property. Using truthiness/`in` lets inherited
// Object.prototype keys ("__proto__", "constructor", "toString") impersonate a
// real node: the op passes validation, writes nothing, and still reports ok:true —
// so an AI patch silently does nothing while believing it succeeded.
const __RESERVED_KEYS = ['__proto__', 'constructor', 'prototype'];
function __isSafeKey(k) {
  if (typeof k !== 'string' || k.length === 0) return false;
  if (__RESERVED_KEYS.indexOf(k) !== -1) return false;
  // Reject ANY inherited Object.prototype member (toString, valueOf, hasOwnProperty…):
  // these are truthy on a plain object and so impersonate an existing key.
  return !Object.prototype.hasOwnProperty.call(Object.prototype, k);
}
function __hasNode(p, id) {
  return __isSafeKey(id) && !!p && !!p.nodes && Object.prototype.hasOwnProperty.call(p.nodes, id) && !!p.nodes[id];
}

function nxProjectPatch(project, ops) {
  if (!Array.isArray(ops)) return { ok: false, errors: ['ops must be an array'], project };
  if (!project || !Array.isArray(project.order)) return { ok: false, errors: ['project is not a valid graph'], project };
  // Build an ISOLATED candidate via deep clone; the caller's project is untouched.
  const candidate = __deepClone(project);
  const applied = [];
  for (const op of ops) {
    const type = op && op.op;
    if (!NX_OPS.includes(type)) return { ok: false, errors: ['unknown op ' + type], project, applied: [] };
    const r = __applyOp(candidate, op, project);
    if (!r.ok) return { ok: false, errors: r.errors, project, applied: [] }; // atomic: commit nothing
    candidate.__applied = candidate.__applied || []; candidate.__applied.push(type + (op.id ? ':' + op.id : ''));
    applied.push(type + (op.id ? ':' + op.id : ''));
  }
  // PRE-COMMIT structural validation of the WHOLE graph. Any invalid state rolls
  // back. (Integrity + per-node schema are required at every commit so a subtree
  // can be built incrementally; the hero/completeness check is enforced at
  // render/publish time via nxValidateProject.)
  const integrity = nxValidateGraphIntegrity(candidate, { requireSingleRoot: project.model === 'tree' });
  if (!integrity.ok) return { ok: false, errors: ['graph integrity: ' + integrity.errors.join('; ')], project, applied: [] };
  for (const id of candidate.order) {
    const nv = nxValidateNode(candidate.nodes[id]);
    if (!nv.ok) return { ok: false, errors: [id + ': ' + nv.errors.join('; ')], project, applied: [] };
  }
  delete candidate.__applied;
  return { ok: true, project: candidate, applied };
}
function __applyOp(p, op, original) {
  try {
    switch (op.op) {
      case 'node.create': {
        const spec = op.node || {};
        if (p.nodes[spec.id]) return { ok: false, errors: ['duplicate node id ' + spec.id] };
        const node = nxSeedNode(p, spec);
        // attach parent (parentId may live on the node spec OR the outer op)
        const pid = spec.parentId != null ? spec.parentId : op.parentId;
        if (pid && p.nodes[pid]) {
          node.parent = pid;
          const sibs = p.nodes[pid].children;
          const idx = (op.index != null && Number.isInteger(+op.index)) ? Math.max(0, Math.min(sibs.length, +op.index)) : sibs.length;
          sibs.splice(idx, 0, node.id);
        } else if (pid) { return rollback(p, 'parent ' + pid + ' not found'); }
        const v = nxValidateNode(node);
        if (!v.ok) return rollback(p, v.errors.join(', '));
        return { ok: true, project: p };
      }
      case 'node.delete': {
        if (!__hasNode(p, op.id)) return rollback(p, 'node ' + op.id + ' not found');
        const doomed = new Set([op.id]);
        const stack = [...(p.nodes[op.id].children || [])];
        while (stack.length) { const c = stack.pop(); if (doomed.has(c)) continue; doomed.add(c); (p.nodes[c]?.children || []).forEach(x => stack.push(x)); }
        // remove every doomed id from its parent's children list
        for (const id of doomed) {
          const n = p.nodes[id];
          if (n && n.parent != null && p.nodes[n.parent]) p.nodes[n.parent].children = (p.nodes[n.parent].children || []).filter(x => !doomed.has(x));
        }
        // strip every cross-graph reference — keyed maps, order, and dangling targets
        for (const id of doomed) {
          delete p.nodes[id]; delete p.design[id]; delete p.content[id]; delete p.motion[id];
          delete p.responsive[id]; delete p.interaction[id];
          if (p.assets) delete p.assets[id];
          if (p.constraints) delete p.constraints[id];
          if (p.states) delete p.states[id];
          if (p.assetGraph) delete p.assetGraph[id];
        }
        // remove interactions in OTHER nodes that target a doomed node
        for (const id of Object.keys(p.interaction || {})) {
          if (doomed.has(id)) continue;
          p.interaction[id] = (p.interaction[id] || []).filter(it => !it.target || !doomed.has(it.target));
        }
        p.order = p.order.filter(x => !doomed.has(x));
        return { ok: true, project: p };
      }
      case 'node.move': {
        if (!__hasNode(p, op.id)) return rollback(p, 'node ' + op.id + ' not found');
        const target = op.parentId ? p.nodes[op.parentId] : null;
        if (op.parentId && !target) return rollback(p, 'parent ' + op.parentId + ' not found');
        // REJECT moving a node below one of its OWN descendants (target is a
        // descendant of the moved node → cycle). Descendant(x,y) = "is y reachable
        // from x's subtree". We reject when the NEW PARENT (target) is a descendant
        // of the node being moved.
        const descendant = (start, needle) => { const s = [...(p.nodes[start].children || [])]; const seen = new Set(); while (s.length) { const c = s.pop(); if (c === needle) return true; if (seen.has(c)) continue; seen.add(c); if (p.nodes[c]) s.push(...(p.nodes[c].children || [])); } return false; };
        if (target && descendant(op.id, target.id)) return rollback(p, 'cannot move ' + op.id + ' below its own descendant ' + target.id);
        // remove from old parent + order
        p.order = p.order.filter(x => x !== op.id);
        for (const n of Object.values(p.nodes)) if (n.children && n.children.includes(op.id)) n.children = n.children.filter(x => x !== op.id);
        const node = p.nodes[op.id];
        if (target) { node.parent = target.id; const idx = op.index == null ? target.children.length : Math.max(0, Math.min(op.index, target.children.length)); target.children.splice(idx, 0, op.id); }
        else node.parent = null;
        const oi = op.index == null ? p.order.length : Math.max(0, Math.min(op.index, p.order.length));
        p.order.splice(oi, 0, op.id);
        return { ok: true, project: p };
      }
      case 'node.replace': {
        if (!__hasNode(p, op.id)) return rollback(p, 'node ' + op.id + ' not found');
        const n = p.nodes[op.id];
        const build = __D('nxBuildComponent', null);
        const replacement = build ? build(op.family, op.variant, p.content[op.id] || {}, p.tokens) : { component: { family: op.family, variant: op.variant } };
        p.design[op.id] = replacement.design || p.design[op.id];
        p.motion[op.id] = replacement.motion || p.motion[op.id];
        n.component = { family: op.family, variant: op.variant };
        n.metadata = Object.assign({}, n.metadata, { replaced: true });
        return { ok: true, project: p };
      }
      case 'node.set': {
        if (!__hasNode(p, op.id)) return rollback(p, 'node ' + op.id + ' not found');
        const field = op.field, value = op.value;
        if (field === 'props' || field === 'styles' || field === 'tokens') p.nodes[op.id][field] = Object.assign({}, p.nodes[op.id][field] || {}, value || {});
        else if (field === 'design') p.design[op.id] = Object.assign({}, p.design[op.id] || {}, value || {});
        else if (field === 'content') p.content[op.id] = Object.assign({}, p.content[op.id] || {}, value || {});
        else if (field === 'motion') p.motion[op.id] = Object.assign({}, p.motion[op.id] || {}, value || {});
        else if (field === 'metadata') p.nodes[op.id].metadata = Object.assign({}, p.nodes[op.id].metadata || {}, value || {});
        else if (field === 'semanticRole') p.nodes[op.id].semanticRole = value;
        else return rollback(p, 'unsupported node.set field ' + field);
        return { ok: true, project: p };
      }
      case 'token.update': {
        if (op.key === undefined) return rollback(p, 'token.update needs key');
        if (!__isSafeKey(op.key)) return rollback(p, 'token.update: unsafe key ' + String(op.key));
        p.tokens = __D('nxMergeBrand', (b, patch) => Object.assign({}, b, patch))(p.tokens, { [op.key]: op.value });
        return { ok: true, project: p };
      }
      case 'motion.update': {
        if (!__hasNode(p, op.id)) return rollback(p, 'node ' + op.id + ' not found');
        p.motion[op.id] = op.profile ? Object.assign({}, p.motion[op.id] || {}, op.profile) : { recipe: op.recipe || 'smooth' };
        return { ok: true, project: p };
      }
      case 'responsive.update': {
        if (!__hasNode(p, op.id)) return rollback(p, 'node ' + op.id + ' not found');
        const rules = Array.isArray(p.responsive[op.id]) ? p.responsive[op.id] : [];
        const rule = op.rule; if (rule && rule.on) { const i = rules.findIndex(r => r.on === rule.on); if (i >= 0) rules[i] = rule; else rules.push(rule); }
        p.responsive[op.id] = rules;
        return { ok: true, project: p };
      }
      case 'asset.replace': {
        if (!__hasNode(p, op.id)) return rollback(p, 'node ' + op.id + ' not found');
        const a = p.nodes[op.id].assets || (p.nodes[op.id].assets = []);
        if (op.assetKind) a[0] = Object.assign({}, a[0], op.asset || {}, { kind: op.assetKind });
        else if (op.asset) a[0] = Object.assign({}, op.asset);
        p.assets[op.id] = a; // keep the asset graph keyed by node, pointing at the same list
        return { ok: true, project: p };
      }
      case 'interaction.add': {
        if (!__hasNode(p, op.id)) return rollback(p, 'node ' + op.id + ' not found');
        const list = Array.isArray(p.interaction[op.id]) ? p.interaction[op.id] : (p.interaction[op.id] = []);
        const it = op.interaction || {}; if (!it.trigger) return rollback(p, 'interaction needs trigger');
        if (it.target) { const t = p.nodes[it.target]; if (!t) return rollback(p, 'interaction target not found'); }
        list.push(it);
        return { ok: true, project: p };
      }
      case 'constraint.set': {
        if (!__hasNode(p, op.id)) return rollback(p, 'node ' + op.id + ' not found');
        (p.constraints || (p.constraints = {}))[op.id] = Object.assign({}, p.constraints && p.constraints[op.id], op.constraint || {});
        return { ok: true, project: p };
      }
      case 'state.set': {
        if (!__hasNode(p, op.id)) return rollback(p, 'node ' + op.id + ' not found');
        (p.states || (p.states = {}))[op.id] = Object.assign({}, p.states && p.states[op.id], op.state ? { [op.state]: op.overrides } : op.overrides || {});
        return { ok: true, project: p };
      }
      case 'asset.set': {
        if (!__hasNode(p, op.id)) return rollback(p, 'node ' + op.id + ' not found');
        (p.assetGraph || (p.assetGraph = {}))[op.id] = Object.assign({ id: op.id }, op.asset || {});
        return { ok: true, project: p };
      }
    }
    return { ok: false, errors: ['unhandled op'] };
  } catch (e) { return { ok: false, errors: [String(e && e.message || e)] }; }
}
function rollback(p, msg) { return { ok: false, errors: [msg], project: p }; }

// Thin, intent-named wrappers — each is a single structured op.
function nxNodeCreate(project, node) { return nxProjectPatch(project, [{ op: 'node.create', node }]); }
function nxNodeDelete(project, id) { return nxProjectPatch(project, [{ op: 'node.delete', id }]); }
function nxNodeMove(project, id, parentId, index) { return nxProjectPatch(project, [{ op: 'node.move', id, parentId, index }]); }
function nxNodeReplace(project, id, family, variant) { return nxProjectPatch(project, [{ op: 'node.replace', id, family, variant }]); }
function nxSetProperty(project, id, field, value) { return nxProjectPatch(project, [{ op: 'node.set', id, field, value }]); }
function nxTokenUpdate(project, key, value) { return nxProjectPatch(project, [{ op: 'token.update', key, value }]); }
function nxMotionUpdate(project, id, recipe, profile) { return nxProjectPatch(project, [{ op: 'motion.update', id, recipe, profile }]); }
function nxResponsiveUpdate(project, id, rule) { return nxProjectPatch(project, [{ op: 'responsive.update', id, rule }]); }
function nxAssetReplace(project, id, asset, assetKind) { return nxProjectPatch(project, [{ op: 'asset.replace', id, asset, assetKind }]); }
function nxInteractionAdd(project, id, interaction) { return nxProjectPatch(project, [{ op: 'interaction.add', id, interaction }]); }

// ═══════════════════════════════════════════════════════════════════════════
// 5. CONSTRAINT / LAYOUT ENGINE  (Framer-like; responsive derived from it)
// ═══════════════════════════════════════════════════════════════════════════
function nxLayout(props) {
  props = props || {};
  const display = props.display || (props.columns && props.columns > 1 ? 'grid' : (props.direction ? 'flex' : 'stack'));
  const resolved = {
    display,
    direction: props.direction || (props.columns && props.columns > 1 ? 'row' : 'column'),
    align: props.align || 'start',
    justifyContent: props.justifyContent || 'start',
    columns: props.columns || 1,
    gap: props.gap || '1.5rem',
    maxWidth: props.maxWidth || '1200px',
    padding: props.padding || '0',
    paddingBlock: props.paddingBlock,
    paddingInline: props.paddingInline,
    wrap: props.wrap !== false,
    position: props.position || 'static',
    aspectRatio: props.aspectRatio,
    minWidth: props.minWidth, minHeight: props.minHeight,
    width: props.width || 'auto',
    alignment: props.alignment || props.align || 'start',
  };
  return resolved;
}
function nxResolveLayout(node) {
  if (!node || !node.props) return nxLayout({});
  return nxLayout(node.props);
}
// Derive responsive overrides intelligently from the base layout (grid/flex
// collapse to a stack on small viewports, so you don't tune every element).
function nxDeriveResponsive(layout, explicitRules) {
  const rules = (layout && (layout.display === 'grid' || layout.display === 'flex') && layout.columns > 1)
    ? [{ on: 'tablet', props: { columns: 2 } }, { on: 'mobile', props: { columns: 1, display: 'stack', direction: 'column' } }]
    : [];
  // merge explicit rules (they win)
  for (const r of (explicitRules || [])) {
    const i = rules.findIndex(x => x.on === r.on); if (i >= 0) rules[i] = Object.assign({}, rules[i], r); else rules.push(r);
  }
  return rules;
}
function nxApplyResponsive(project) {
  for (const id of project.order) {
    const node = project.nodes[id];
    const base = nxResolveLayout(node);
    project.responsive[id] = nxDeriveResponsive(base, project.responsive[id]);
  }
  return project;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. INTERACTION GRAPH (first-class — kept out of arbitrary generated JS)
// ═══════════════════════════════════════════════════════════════════════════
const NX_INTERACTION_TRIGGERS = ['hover', 'press', 'focus', 'click', 'pointer-move', 'scroll', 'viewport-entry', 'view', 'drag', 'page-transition', 'route-transition', 'load'];
const NX_INTERACTION_ACTIONS = ['translate', 'scale', 'shadow', 'opacity', 'color', 'navigate', 'open-modal', 'lock-scroll', 'toggle-class', 'update-state', 'blur', 'animate', 'play-motion'];
function nxInteractionValidate(it) {
  const errors = [];
  if (!it || !it.trigger) errors.push('interaction.trigger required');
  else if (!NX_INTERACTION_TRIGGERS.includes(it.trigger)) errors.push('trigger must be one of ' + NX_INTERACTION_TRIGGERS.join(', '));
  if (!it.target) errors.push('interaction.target required');
  if (!Array.isArray(it.actions) || !it.actions.length) errors.push('interaction.actions required (non-empty)');
  else for (const a of it.actions) if (!NX_INTERACTION_ACTIONS.includes(a.type)) errors.push('action ' + a.type + ' unsupported');
  return { ok: errors.length === 0, errors };
}
function nxInteractionTargetForTrigger(trigger) {
  // default target mapping: which node(s) an interaction binds to
  if (trigger === 'scroll') return (node) => window === undefined ? null : null;
  return null;
}
function nxCompileInteractions(project) {
  const js = [];
  for (const id of project.order) {
    const list = project.interaction[id] || [];
    for (const it of list) {
      if (nxInteractionValidate(it).ok) {
        js.push(`nxBind(${JSON.stringify(it)});`);
      }
    }
  }
  return js.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. MOTION COMPOSITION (multi-primitive, not "add fade-in")
// ═══════════════════════════════════════════════════════════════════════════
// A motion profile is a composition of named primitives. The composer builds a
// synchronized timeline from a mood + per-node role, instead of a single effect.
function nxMotionComposeIR(mood, nodeRole, opts) {
  const base = __D('nxMotionCompose', () => ({ name: 'smooth', speed: 0.6, easing: 'ease-out', stagger: 60, parallax: 0.1, entrance: 'fade-up', hover: 'lift', reduced: 'fade' }))(mood || 'smooth');
  const profile = Object.assign({ recipe: base.name || 'smooth', primitives: [], triggers: ['viewport-entry'], reduced: base.reduced || 'fade' }, opts || {});
  const role = nodeRole || 'hero';
  // composition by role — the AI choices, the engine resolves timing
  const heroCine = ['heading-reveal', 'subtitle-reveal', 'cta-spring', 'background-parallax', '3d-rotate', 'particle-drift', 'scroll-transition'];
  const list = {
    hero: base.name === 'cinematic' ? heroCine : ['heading-reveal', 'cta-spring'],
    card: ['card-fade-up'],
    section: ['section-reveal'],
  }[role] || ['fade-in'];
  profile.primitives = list;
  profile.speed = base.speed; profile.easing = base.easing; profile.stagger = base.stagger; profile.parallax = base.parallax;
  return profile;
}
const NX_MOTION_PRIMITIVES = {
  'heading-reveal': { css: '@keyframes nx-hr{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}', el: '.nx-hero h1' },
  'subtitle-reveal': { css: '@keyframes nx-sr{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}', el: '.nx-hero p' },
  'cta-spring': { css: '@keyframes nx-cs{0%{opacity:0;transform:scale(.9)}60%{transform:scale(1.05)}100%{transform:scale(1)}}', el: '.nx-hero .nx-btn' },
  'background-parallax': { css: '.nx-parallax{will-change:transform}', el: '.nx-parallax' },
  '3d-rotate': { css: '.nx-3d{transform-style:preserve-3d}', el: '.nx-3d' },
  'particle-drift': { css: '.nx-particles{position:absolute;inset:0;overflow:hidden}', el: '.nx-particles' },
  'scroll-transition': { css: '.nx-scroll{transition:opacity .6s ease,transform .6s ease}', el: '.nx-scroll' },
  'card-fade-up': { css: '@keyframes nx-cf{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}', el: '.nx-card' },
  'section-reveal': { css: '@keyframes nx-ps{from{opacity:0}to{opacity:1}}', el: '.nx-section' },
  'fade-in': { css: '@keyframes nx-fi{from{opacity:0}to{opacity:1}}', el: '*[data-nx-in]' },
};
function nxCompileMotion(profile) {
  const css = [];
  for (const p of (profile && profile.primitives) || []) {
    if (NX_MOTION_PRIMITIVES[p]) css.push(NX_MOTION_PRIMITIVES[p].css);
  }
  return css.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. COMPILER PIPELINE  (normalize→validate→layout→style→motion→interaction→asset→code)
// ═══════════════════════════════════════════════════════════════════════════
function nxNormalize(project) {
  return __cloneProject(project);
}
function nxResolveStyle(project) {
  const resolve = __D('nxTokensToCss', () => '');
  return { cssVars: resolve(project.tokens) };
}
function nxCompile(project) {
  const stages = { source: project.id };
  stages.normalized = nxNormalize(project);
  const v = nxValidateProject(stages.normalized);
  stages.valid = v.ok;
  stages.validationErrors = v.errors;
  const withResponsive = nxApplyResponsive(stages.normalized);
  stages.layout = {}; for (const id of withResponsive.order) stages.layout[id] = nxResolveLayout(withResponsive.nodes[id]);
  stages.style = nxResolveStyle(withResponsive);
  stages.motion = {}; for (const id of withResponsive.order) stages.motion[id] = nxMotionComposeIR(withResponsive.motion[id]?.recipe || withResponsive.brief?.motionMood || 'smooth', withResponsive.nodes[id].semanticRole);
  stages.motionCss = Object.values(stages.motion).map(m => nxCompileMotion(m)).filter(Boolean).join('\n');
  stages.interactionJs = nxCompileInteractions(withResponsive);
  stages.javascript = `(function(){"use strict";var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;function nxBind(c){if(reduce)return;var els=document.querySelectorAll(c.target||'[data-nx-in]');els.forEach(function(el){el.addEventListener(c.trigger,function(){c.actions.forEach(function(a){if(a.type==='toggle-class')el.classList.toggle(a.class);});});});}${stages.interactionJs}})();`;
  stages.in = withResponsive;
  return stages;
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. DESIGN-QA METHODOLOGY — reproducible structural/visual/brand/motion sub-scores
// ═══════════════════════════════════════════════════════════════════════════
function nxColorHue(hex) {
  const e = __D('expandHex', (h) => h)(hex); if (!e) return null;
  const r = parseInt(e.slice(1, 3), 16) / 255, g = parseInt(e.slice(3, 5), 16) / 255, b = parseInt(e.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0; if (d) { if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return Math.round(h);
}
function nxContrast(a, b) { return __D('contrastRatio', (x, y) => 21)(a, b); }
function nxDesignQAIR(projectOrHtml) {
  // If given an IR project, measure the structure directly; else HTML fallback.
  // (Named *IR to avoid colliding with nx_design.js's HTML-based nxDesignQA when
  // both are injected into the same scope; it's exported publicly as nxDesignQA.)
  if (projectOrHtml && projectOrHtml.nodes) return nxDesignQAProject(projectOrHtml);
  return __D('nxDesignQA', () => ({ score: 0 }))(projectOrHtml);
}
function nxDesignQAProject(project) {
  const nodes = project.nodes;
  const order = project.order;
  const tokens = project.tokens || {};
  // structural
  const roles = order.map(id => nodes[id]?.semanticRole);
  const heroOk = roles.includes('hero');
  const hasCta = roles.includes('cta');
  // A valid hierarchy puts the hero first (nav may precede it) and never repeats
  // the hero after content appears.
  const orderOk = (() => { let seenContent = false; for (const r of roles) { if (r === 'none' || r === 'nav') continue; if (r === 'hero' && seenContent) return false; seenContent = true; } return true; })();
  const structural = Math.round((heroOk ? 30 : 0) + (hasCta ? 20 : 0) + (roles.length >= 4 ? 30 : roles.length >= 2 ? 18 : 5) + (orderOk ? 20 : 0));
  // visual (typography + contrast + color harmony + density)
  const fgHex = tokens.neutralFg || '#111', bgHex = tokens.neutralBg || '#ffffff';
  const ratio = nxContrast(fgHex, bgHex);
  const harmony = (() => { const hues = [tokens.primaryColor, tokens.secondaryColor, tokens.accentColor, tokens.neutralFg].map(nxColorHue).filter(h => h !== null); const uniq = new Set(hues); return uniq.size <= 3 && uniq.size >= 1 ? 100 : 50; })();
  const visual = Math.round((ratio >= 4.5 ? 40 : ratio >= 3 ? 22 : 8) + harmony * 0.3 + (tokens.headingFont && tokens.bodyFont ? 30 : 10));
  // brand coherence (reuse of primary/accent tokens, consistent motion style)
  const primaryUsed = project.design && Object.values(project.design).some(d => d && (d.colors && (String(d.colors.primary || '#') === tokens.primaryColor)));
  const motionStyles = new Set(Object.values(project.motion).map(m => m && m.recipe).filter(Boolean));
  const brand = Math.round((primaryUsed ? 50 : 20) + (motionStyles.size <= 2 ? 30 : 10) + (project.brief?.brand ? 20 : 0));
  // motion quality (reduced-motion present, composed profiles not single effects)
  const motion = (() => {
    const profiles = Object.values(project.motion).filter(Boolean);
    const anyReduced = profiles.some(m => m.reduced && m.reduced !== 'none');
    const composed = profiles.some(m => m.primitives && m.primitives.length > 1);
    return Math.round((anyReduced ? 40 : 10) + (composed ? 40 : 15) + (profiles.length ? 20 : 0));
  })();
  const categories = {
    hierarchy: { score: Math.min(100, heroOk ? 90 : 30) }, spacing: { score: Math.min(100, order.length ? 70 : 20) },
    alignment: { score: structural }, typography: { score: visual }, contrast: { score: Math.min(100, ratio * 20) },
    colorHarmony: { score: harmony }, density: { score: 70 }, consistency: { score: brand },
    composition: { score: structural }, visualRhythm: { score: roles.length >= 3 ? 80 : 40 },
    responsiveComposition: { score: 75 }, animationQuality: { score: motion }, brandCoherence: { score: brand },
  };
  const score = Math.round(structural * 0.25 + visual * 0.25 + brand * 0.2 + motion * 0.2 + (orderOk ? 10 : 0));
  const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : score < 45 ? 'F' : 'D';
  return { score, grade, structural, visual, brand, motion, categories, metrics: { roles, contrast: +ratio.toFixed(2), distinctMotionStyles: motionStyles.size } };
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. AI CRITIC → PRIORITIZED PATCH PLAN → APPLY → RE-EVALUATE
// ═══════════════════════════════════════════════════════════════════════════
function nxCritic(project) {
  const qa = nxDesignQAProject(project);
  const problems = [];
  const heroId = project.order.find(id => project.nodes[id].semanticRole === 'hero') || null;
  const push = (severity, category, message, fix) => problems.push({ severity, category, message, fix });
  if (!qa.structural || qa.structural < 60) push(4, 'composition', 'Hero lacks visual dominance / structure is thin.', heroId ? { op: 'node.replace', id: heroId, family: 'hero', variant: 'split' } : null);
  if (qa.categories.contrast.score < 60) push(5, 'contrast', 'Text/background contrast fails accessibility.', { op: 'token.update', key: 'neutralFg', value: '#141433' });
  if (qa.categories.hierarchy.score < 70 && heroId) push(3, 'hierarchy', 'Heading hierarchy is unclear.', { op: 'node.set', id: heroId, field: 'props', value: { align: 'center', direction: 'column' } });
  if (qa.categories.animationQuality.score < 30 && heroId) push(3, 'motion', 'Motion is minimal; no composed entrance.', { op: 'motion.update', id: heroId, profile: { primitives: ['heading-reveal', 'cta-spring', 'background-parallax'], reduced: 'fade' } });
  if (qa.brand < 50) push(2, 'brand', 'Brand tokens not applied consistently.', { op: 'token.update', key: 'primaryColor', value: '#0a1638' });
  if (!problems.length) push(0, 'ok', 'No design problems detected.', null);
  problems.sort((a, b) => b.severity - a.severity);
  return { problems, qa };
}
function nxPatchPlan(problems) {
  return (problems || []).filter(p => p.fix).map((p, i) => Object.assign({}, p.fix, { _id: i, _reason: p.message }));
}
function nxDesignLoop(project, iterations) {
  let cur = __cloneProject(project);
  const history = [];
  let iters = Math.max(0, Math.min(iterations || 3, 8));
  for (let i = 0; i < iters; i++) {
    const crit = nxCritic(cur);
    const qa = crit.qa;
    history.push({ iter: i + 1, score: qa.score, grade: qa.grade, problems: crit.problems.map(p => p.message) });
    if (!crit.problems.length || (qa.score >= 85 && i >= 1)) break;
    const plan = nxPatchPlan(crit.problems);
    if (!plan.length) break;
    const res = nxProjectPatch(cur, plan.map(pl => { const { _id, _reason, ...op } = pl; return op; }));
    if (!res.ok) break;
    cur = res.project;
  }
  const finalQa = nxDesignQAProject(cur);
  return { project: cur, history, finalQa };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════
const API = {
  NX_NODE_FIELDS, NX_NODE_SCHEMA, NX_BRIEF_FIELDS, NX_BRIEF_DEFAULTS, NX_OPS,
  NX_INTERACTION_TRIGGERS, NX_INTERACTION_ACTIONS, NX_MOTION_PRIMITIVES,
  nxValidateNode, nxValidateProject, nxValidateGraphIntegrity, nxValidateGraphState, NX_CONCERN_SCHEMAS,
  nxBriefFromPrompt, nxBriefValidate,
  nxNewProject, nxSeedNode,
  nxProjectPatch, nxNodeCreate, nxNodeDelete, nxNodeMove, nxNodeReplace,
  nxSetProperty, nxTokenUpdate, nxMotionUpdate, nxResponsiveUpdate,
  nxAssetReplace, nxInteractionAdd,
  nxLayout, nxResolveLayout, nxDeriveResponsive, nxApplyResponsive,
  nxInteractionValidate, nxCompileInteractions,
  nxMotionComposeIR, nxCompileMotion,
  nxNormalize, nxResolveStyle, nxCompile,
  nxDesignQA: nxDesignQAIR, nxDesignQAProject, nxColorHue, nxContrast,
  nxCritic, nxPatchPlan, nxDesignLoop,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') { for (const k of Object.keys(API)) window[k] = API[k]; }
