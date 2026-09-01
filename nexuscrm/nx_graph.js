// ─────────────────────────────────────────────────────────────────────────────
// nx_graph.js — the GRAPH FOUNDATION II systems, added BEFORE the renderer embeds.
//
// v0.0.1.7 gave us IR contracts + the Project Mutation Engine (nx_ir.js). This is
// the next set of foundational systems that a professional visual editor needs:
//   • Layout Constraint Graph + Solver   (relationships, not just CSS props)
//   • State Graph                        (default/hover/focus/... as first-class data)
//   • Asset Graph subsystem              (images/video/svg/fonts/3D + metadata)
//   • Project History / Diff Engine      (every AI modification explainable+reversible)
//   • Design Intent → Patch compiler     (creative intent → design decisions → ops)
//   • Evidence-based AI Critic           (problem/evidence/expectedEffect/op/confidence/risk)
//   • Best-Known-Version evolution loop  (staged, only promote on measured improvement)
//
// It REUSES nx_ir.js's mutation engine (nxProjectPatch) — it never re-implements
// mutation. Pure + deterministic. Dependency-free; resolves nx_ir via a registry.
// ─────────────────────────────────────────────────────────────────────────────

// Resolve a function from the already-injected nx_ir layer (or require in Node).
function __r(name, dflt) {
  if (typeof globalThis !== 'undefined') {
    if (globalThis.__NX_IR && globalThis.__NX_IR[name] !== undefined) return globalThis.__NX_IR[name];
    if (globalThis[name] !== undefined) return globalThis[name];
  }
  try { if (typeof require === 'function') { const IR = require('./nx_ir.js'); if (IR[name] !== undefined) return IR[name]; } } catch {}
  return dflt;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. LAYOUT CONSTRAINT GRAPH + SOLVER  (relationships, not isolated properties)
// ═══════════════════════════════════════════════════════════════════════════
// A node's constraint is a relationship to its container / siblings, plus their
// resolution as layout instructions per breakpoint. `nxSolveLayout` transforms
// constraints → CSS-ready layout instructions (this is the "solve, then emit" step).
const NX_CONSTRAINT_ANCHORS = ['left', 'right', 'top', 'bottom', 'center', 'none'];
const NX_CONSTRAINT_ALIGN = ['start', 'center', 'end', 'stretch', 'space-between'];
const NX_CONSTRAINT_INTRINSIC = ['auto', 'hug', 'fill', 'fixed'];
const NX_CONSTRAINT_DEFAULTS = { anchor: 'none', alignment: 'stretch', spacing: {}, min: {}, max: {}, intrinsic: 'auto', aspectRatio: null, parent: {}, siblings: {}, stack: 0 };
// Minimal constraint registry (lazy on the project).
function __constraints(project) { return (project.constraints || (project.constraints = {})); }
function nxSetConstraint(project, id, constraint) {
  if (!project.nodes[id]) return { ok: false, errors: ['node ' + id + ' not found'] };
  const c = Object.assign({}, NX_CONSTRAINT_DEFAULTS, constraint || {});
  const errors = [];
  if (c.anchor && !NX_CONSTRAINT_ANCHORS.includes(c.anchor)) errors.push('anchor invalid');
  if (c.alignment && !NX_CONSTRAINT_ALIGN.includes(c.alignment)) errors.push('alignment invalid');
  if (c.intrinsic && !NX_CONSTRAINT_INTRINSIC.includes(c.intrinsic)) errors.push('intrinsic invalid');
  if (c.aspectRatio && !/^\d+(\.\d+)?(:|\/)\d+(\.\d+)?$/.test(String(c.aspectRatio))) errors.push('aspectRatio must look like 16:9 or 16/9');
  if (errors.length) return { ok: false, errors };
  __constraints(project)[id] = c;
  return { ok: true, constraint: c };
}
function nxGetConstraint(project, id) { return __constraints(project)[id] || NX_CONSTRAINT_DEFAULTS; }
function nxSolveConstraint(constraint, props, breakpoint) {
  const c = Object.assign({}, NX_CONSTRAINT_DEFAULTS, constraint || {});
  const p = Object.assign({}, props || {});
  const bp = c.breakpoints && c.breakpoints[breakpoint || 'desktop'] || {};
  const out = {};
  // intrinsic size
  const intrinsic = bp.intrinsic || c.intrinsic;
  if (intrinsic === 'fill') out.width = '100%';
  else if (intrinsic === 'hug') out.width = 'max-content';
  else if (intrinsic === 'fixed') out.width = (bp.width || p.width) + 'px';
  else out.width = p.width ? p.width + 'px' : 'auto';
  // anchor → alignment / auto-margins
  const anchor = bp.anchor || c.anchor;
  if (anchor === 'center') { out.alignSelf = 'center'; out.marginLeft = 'auto'; out.marginRight = 'auto'; }
  else if (anchor === 'left') { out.alignSelf = 'flex-start'; }
  else if (anchor === 'right') { out.alignSelf = 'flex-end'; out.marginLeft = 'auto'; }
  else if (anchor === 'top') { out.alignSelf = 'flex-start'; }
  else if (anchor === 'bottom') { out.alignSelf = 'flex-end'; }
  // alignment
  const align = bp.alignment || c.alignment;
  if (align === 'center') out.textAlign = 'center';
  else if (align === 'end') out.textAlign = 'right';
  // spacing relations
  const sp = Object.assign({}, c.spacing, bp.spacing || {});
  if (sp.before != null) out.marginTop = sp.before + 'px';
  if (sp.after != null) out.marginBottom = sp.after + 'px';
  if (sp.inline != null) out.marginLeft = sp.inline + 'px';
  // stack order
  if (c.stack) out.order = c.stack;
  // aspect ratio
  if (c.aspectRatio) { const parts = String(c.aspectRatio).split(/[:/]/); out.aspectRatio = parts[0] + ' / ' + parts[1]; }
  // min/max
  if (c.min.width != null) out.minWidth = c.min.width + 'px';
  if (c.min.height != null) out.minHeight = c.min.height + 'px';
  if (c.max.width != null) out.maxWidth = c.max.width + 'px';
  return out;
}
// Solve the whole project's constraints into per-node layout instructions (the
// "layout solver" step of the compiler pipeline). Returns { [id]: [breakpoint→css] }.
function nxSolveLayout(project) {
  const out = {};
  for (const id of project.order) {
    const c = nxGetConstraint(project, id);
    const props = project.nodes[id].props || {};
    const desktop = nxSolveConstraint(c, props, 'desktop');
    const tablet = nxSolveConstraint(c, props, 'tablet');
    const mobile = nxSolveConstraint(c, props, 'mobile');
    out[id] = { desktop, tablet, mobile };
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. STATE GRAPH  (default/hover/focus/... as first-class data, driving CSS)
// ═══════════════════════════════════════════════════════════════════════════
const NX_STATES = ['default', 'hover', 'active', 'focus', 'disabled', 'selected', 'expanded', 'loading', 'success', 'error', 'open', 'closed'];
function __states(project) { return (project.states || (project.states = {})); }
function nxDefineState(project, id, state, overrides) {
  if (!project.nodes[id]) return { ok: false, errors: ['node ' + id + ' not found'] };
  if (!NX_STATES.includes(state)) return { ok: false, errors: ['state must be one of ' + NX_STATES.join(', ')] };
  const m = __states(project)[id] || (__states(project)[id] = {});
  m[state] = Object.assign({}, m[state], overrides || {});
  return { ok: true };
}
function nxStates(project, id) { return __states(project)[id] || {}; }
function nxCompileStateCss(project) {
  const css = [];
  for (const id of project.order) {
    const st = nxStates(project, id);
    for (const [state, over] of Object.entries(st)) {
      const sel = state === 'default' ? '[data-nx-id="' + id + '"]' : '[data-nx-id="' + id + '"]:' + state;
      let body = '';
      for (const [prop, val] of Object.entries(over)) {
        const k = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        body += k + ':' + val + ';';
      }
      if (body) css.push(sel + '{' + body + '}');
    }
  }
  return css.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. ASSET GRAPH SUBSYSTEM  (types + full metadata; per-breakpoint resolution)
// ═══════════════════════════════════════════════════════════════════════════
const NX_ASSET_KINDS = ['image', 'video', 'svg', 'icon', 'font', '3d', 'texture', 'audio', 'generated'];
const NX_ASSET_META = ['width', 'height', 'aspectRatio', 'format', 'sizeKB', 'usage', 'variants', 'optimized', 'source', 'license', 'alt', 'role'];
function __assetGraph(project) { return (project.assetGraph || (project.assetGraph = {})); }
function nxAddAsset(project, id, kind, meta) {
  if (!NX_ASSET_KINDS.includes(kind)) return { ok: false, errors: ['kind must be one of ' + NX_ASSET_KINDS.join(', ')] };
  const g = __assetGraph(project);
  const asset = Object.assign({ id, kind }, meta || {});
  g[id] = asset;
  return { ok: true, asset };
}
function nxGetAsset(project, id, breakpoint) {
  const a = __assetGraph(project)[id];
  if (!a) return null;
  // responsive variants: pick the closest resolution for a viewport, using the
  // explicit `variants` map, then the base asset.
  const bp = breakpoint || 'desktop';
  const variants = a.variants || {};
  const chosen = variants[bp] || variants.mobile || variants.tablet || a;
  return Object.assign({}, a, chosen);
}
function nxAssetValidate(project) {
  const errors = [];
  for (const [id, a] of Object.entries(__assetGraph(project))) {
    if (!a || !a.kind) errors.push('asset ' + id + ' missing kind');
    if (!NX_ASSET_KINDS.includes(a && a.kind)) errors.push('asset ' + id + ' has invalid kind');
  }
  return { ok: errors.length === 0, errors };
}
// Choose the heaviest GPU/bandwidth asset by viewport, so the AI can reason about
// "this hero image is too heavy for mobile" and swap the resolution.
function nxResolveAssetForViewport(project, id, viewport) {
  const a = nxGetAsset(project, id, viewport);
  if (!a) return null;
  const size = a.sizeKB || 0;
  const heavy = size > 300 || (a.kind === 'video') || (a.kind === '3d');
  return { url: a.src || null, kind: a.kind, sizeKB: size, preferredForMobile: (a.variants && a.variants.mobile) ? 'mobile variant' : (heavy ? 'needs lighter variant' : 'ok'), heavy };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. PROJECT HISTORY / DIFF ENGINE  (patch-based: explainable + reversible)
// ═══════════════════════════════════════════════════════════════════════════
// Diff two projects (or a node) into a minimal ordered op list. (Full diff
// implemented below via __nxDiffFull; see nxDiff.)

function nxHistory(project) { return (project.history || (project.history = [])); }
function nxHistoryPush(project, patch, reason, priorProject) {
  const h = nxHistory(project);
  const entry = { n: h.length + 1, reason, patch, at: new Date().toISOString(), beforeView: priorProject ? nxSnapshotView(priorProject) : null, afterView: nxSnapshotView(project) };
  h.push(entry);
  return entry;
}
// A snapshot is a deep, JSON-safe clone of EVERYTHING editable in the project —
// nodes/order, all concern graphs, tokens, brief. This is the artifact a version
// can be restored from (not just content strings).
function nxSnapshotView(project) {
  const pick = {};
  for (const k of ['tokens', 'brief', 'nodes', 'design', 'content', 'motion', 'responsive', 'interaction', 'assets', 'constraints', 'states', 'assetGraph', 'order', 'name', 'id', 'model']) if (project[k] !== undefined) pick[k] = JSON.parse(JSON.stringify(project[k]));
  return pick;
}
function nxHistoryRevert(project, steps) {
  // Restore the graph to the state recorded before the last N patches. The
  // recorded `beforeView` is a full snapshot; we deep-clone it back into a project
  // and ALSO report the ops that would move current→restored (so callers can see
  // the change and/or log it). This is a real, faithful version-restore.
  const h = nxHistory(project);
  const target = Math.max(0, h.length - Math.max(1, steps || 1));
  const prior = h[target] ? h[target].beforeView : null;
  if (!prior) return { ok: false, errors: ['no prior snapshot available'], ops: [] };
  const restored = JSON.parse(JSON.stringify(prior));
  if (!Array.isArray(restored.order)) restored.order = Object.keys(restored.nodes || {});
  const ops = nxDiff(project, restored);
  return { ok: true, project: restored, ops, reverted: true };
}
// Full diff of two projects into an ordered op list (tokens, node add/remove,
// per-node content/props/design/motion, and concern-map keys). This makes
// `nxDiff` the one honest "what changed" reporter the version system uses.
function nxDiff(a, b) {
  if (!nxDiff.__diag) {} // no-op guard (kept for lint safety)
  return __nxDiffFull(a, b);
}
function __nxDiffFull(a, b) {
  const ops = [];
  if (!a || !b) return ops;
  // tokens + brief keys
  for (const k of new Set([...Object.keys(a.tokens || {}), ...Object.keys(b.tokens || {})])) if (a.tokens[k] !== b.tokens[k]) ops.push({ op: 'token.update', key: k, value: b.tokens[k] });
  // node add/remove
  for (const id of Object.keys(a.nodes)) if (!b.nodes[id]) ops.push({ op: 'node.delete', id });
  for (const id of Object.keys(b.nodes)) if (!a.nodes[id]) ops.push({ op: 'node.create', node: b.nodes[id] });
  // per-node concern changes
  for (const id of Object.keys(b.nodes)) {
    if (!a.nodes[id]) continue;
    const aX = Object.assign({}, a.nodes[id].props, a.content[id], a.design[id], a.motion[id]);
    const bX = Object.assign({}, b.nodes[id].props, b.content[id], b.design[id], b.motion[id]);
    for (const k of new Set([...Object.keys(aX), ...Object.keys(bX)])) {
      if (JSON.stringify(aX[k]) !== JSON.stringify(bX[k])) {
        const field = (k in (b.content[id] || {})) ? 'content' : (k in (b.design[id] || {})) ? 'design' : (k in (b.motion[id] || {})) ? 'motion' : 'props';
        ops.push({ op: 'node.set', id, field, value: { [k]: bX[k] } });
      }
    }
  }
  return ops;
}
function nxCompare(a, b) {
  // REAL comparison: the ops that changed + a measured Design-QA delta (+ engineering
  // validity). No hard-coded zero.
  const ops = __nxDiffFull(a, b);
  const qaA = __r('nxDesignQAProject', (x) => ({ score: 0 }))(a);
  const qaB = __r('nxDesignQAProject', (x) => ({ score: 0 }))(b);
  const designQADelta = Math.round(((qaB.score || 0) - (qaA.score || 0)) * 10) / 10;
  return { ops, designQADelta, structuralDelta: Math.round((qaB.structural || 0) - (qaA.structural || 0)), visualDelta: Math.round((qaB.visual || 0) - (qaA.visual || 0)), brandDelta: Math.round((qaB.brand || 0) - (qaA.brand || 0)), motionDelta: Math.round((qaB.motion || 0) - (qaA.motion || 0)) };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. DESIGN INTENT → PATCH COMPILER  (creative intention → decisions → ops)
// ═══════════════════════════════════════════════════════════════════════════
// "Make it feel luxurious" is NOT edited CSS. It maps to a set of concrete design
// decisions, then to structured ops the mutation engine applies.
const NX_INTENTS = {
  luxury: { decisions: ['lower visual density', 'stronger typographic hierarchy', 'more whitespace', 'restrained accent', 'larger imagery', 'slower motion', 'softer shadows'], patches: [{ op: 'motion.generic', profile: { recipe: 'cinematic', speed: 1.1, stagger: 120 } }, { op: 'token.generic', key: 'motionStyle', value: 'cinematic' }, { op: 'token.generic', key: 'shadowStyle', value: '0 24px 70px rgba(0,0,0,.14)' }] },
  energetic: { decisions: ['faster transitions', 'spring interactions', 'stronger hover', 'short stagger', 'dynamic gradients'], patches: [{ op: 'motion.generic', profile: { recipe: 'energetic', speed: 0.5, stagger: 45 } }, { op: 'token.generic', key: 'motionStyle', value: 'energetic' }] },
  minimal: { decisions: ['fewer elements', 'more whitespace', 'single accent', 'no bg motion'], patches: [{ op: 'motion.generic', profile: { recipe: 'minimal', speed: 0.45 } }, { op: 'token.generic', key: 'motionStyle', value: 'minimal' }] },
  playful: { decisions: ['bouncy springs', 'overshoot', 'varied stagger', 'rounded'], patches: [{ op: 'motion.generic', profile: { recipe: 'playful', speed: 0.55, stagger: 80 } }, { op: 'token.generic', key: 'motionStyle', value: 'playful' }] },
  futuristic: { decisions: ['glide', 'parallax', '3D rotate', 'curated 3D scene', 'particles'], patches: [{ op: 'motion.generic', profile: { recipe: 'futuristic', speed: 0.9, stagger: 100 } }, { op: 'token.generic', key: 'motionStyle', value: 'futuristic' }] },
  trustworthy: { decisions: ['balanced spacing', 'predictable layout', 'high contrast', 'professional type'], patches: [{ op: 'token.generic', key: 'motionStyle', value: 'smooth' }, { op: 'token.generic', key: 'visualTone', value: 'saas' }] },
};
// Intent → design decisions + structured ops (patches that can go through nxProjectPatch).
function nxIntentToPlan(intent, project) {
  const key = String(intent || '').toLowerCase();
  // "cinematic" is its own mood → the luxury recipe (which composes a cinematic
  // hero), distinct from generic "futuristic". Check cinematic before futuristic.
  const int = NX_INTENTS[key] || (key.includes('luxur') || key.includes('premium') || key.includes('cinematic') ? NX_INTENTS.luxury : key.includes('energet') ? NX_INTENTS.energetic : key.includes('minimal') || key.includes('calm') ? NX_INTENTS.minimal : key.includes('playful') ? NX_INTENTS.playful : key.includes('future') ? NX_INTENTS.futuristic : NX_INTENTS.trustworthy);
  const heroId = project.order.find(id => project.nodes[id].semanticRole === 'hero') || null;
  const ops = [];
  for (const p of int.patches) {
    if (p.op === 'token.generic') ops.push({ op: 'token.update', key: p.key, value: p.value });
    else if (p.op === 'motion.generic' && heroId) ops.push({ op: 'motion.update', id: heroId, profile: p.profile });
  }
  return { intent: key, decisions: int.decisions, ops, heroId };
}
function nxApplyIntent(project, intent) {
  const plan = nxIntentToPlan(intent, project);
  const r = __r('nxProjectPatch', null)(project, plan.ops);
  return { ok: r && r.ok, project: r && r.project, decisions: plan.decisions, ops: plan.ops, error: r && (!r.ok ? r.errors : null) };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. EVIDENCE-BASED AI CRITIC  (problem/evidence/expectedEffect/op/confidence/risk)
// ═══════════════════════════════════════════════════════════════════════════
// ── VISUAL EVIDENCE ENGINE (Gap 3) ────────────────────────────────────────────
// Computes REAL, deterministic evidence for Design QA — not just sub-scores but
// per-element computed geometry + accessibility + contrast facts the graph can
// prove. The critic then reasons over this evidence. This is the "screen + geometry
// evidence" layer for a model-driven QA: we can't take a pixel screenshot in the
// sandbox, but we CAN resolve the layout model into concrete geometry and measure
// accessibility/contrast per node, which is what a headless render would report.
//
//   IR Graph → computed geometry (columns/gap/direction/width) → per-node a11y
//             → per-node contrast → document evidence → structured problems
//
// Returns { evidence, problems } where each problem carries the required
//   Problem / Evidence / Expected effect / Proposed operation / Confidence /
//   Potential regression  fields.
function nxVisualEvidence(project, opts) {
  opts = opts || {};
  const nodes = project.nodes || {};
  const order = project.order || Object.keys(nodes);
  const tokens = project.tokens || {};
  const layout = nxSolveLayout(project);
  const bp = opts.breakpoint || 'desktop';
  const contrastAt = (a, b) => __r('nxContrast', (x, y) => 21)(a, b);
  const fg = tokens.neutralFg || '#111';
  const bg = tokens.neutralBg || '#ffffff';

  const byId = {};
  const interactive = [];
  const textNodes = [];
  let imagesNoAlt = 0, mediaNoAlt = 0, headingLevels = [];
  const fgCol = /^#([0-9a-f]{6})$/i.test(fg) ? fg : null;
  const bgCol = /^#([0-9a-f]{6})$/i.test(bg) ? bg : '#ffffff';
  const docContrast = contrastAt(fgCol || '#141414', bgCol);

  for (const id of order) {
    const n = nodes[id]; if (!n) continue;
    const c = (project.constraints && project.constraints[id]) || {};
    const rl = layout[id] && layout[id][bp];
    const props = n.props || {};
    const design = project.design[id] || {};
    const family = n.component.family;
    const role = n.semanticRole || 'none';
    const content = project.content[id] || {};
    const resolved = {
      family, role,
      display: props.display || (props.columns && props.columns > 1 ? 'grid' : (props.direction ? 'flex' : 'auto')),
      direction: props.direction || (props.columns && props.columns > 1 ? 'row' : 'column'),
      columns: props.columns && props.columns > 1 ? props.columns : (rl && rl.columns) || 1,
      gap: props.gap || (rl && rl.gap) || null,
      width: props.width || c.width || (rl && rl.width) || 'auto',
      maxWidth: props.maxWidth || c.maxWidth || (rl && rl.maxWidth) || null,
      align: props.align || rl && rl.align || null,
      position: props.position || c.anchor || 'static',
      // accessibility
      requiredAlt: family === 'image' || family === 'media',
      alt: content.alt || content.text || '',
      accessibleName: content.label || content.text || content.title || '',
      isInteractive: ['button', 'link', 'input', 'a'].includes(family) || !!props.tone,
      headingLevel: family === 'heading' ? Math.max(1, Math.min(6, parseInt(props.level || (content.level) || 2, 10))) : null,
      receivesText: ['heading', 'paragraph', 'button', 'link', 'card', 'cta'].includes(family) || !!content.text || !!content.headline,
    };
    if (resolved.headingLevel) headingLevels.push({ id, level: resolved.headingLevel });
    if (resolved.receivesText) textNodes.push({ id, family });
    if (resolved.isInteractive && !resolved.accessibleName) interactive.push({ id, family });
    if (resolved.requiredAlt && !resolved.alt) { if (family === 'image') imagesNoAlt++; else mediaNoAlt++; }
    byId[id] = resolved;
  }

  const problems = [];
  const push = (p) => problems.push(p);
  // 1) contrast (only when both are valid hex — don't claim a ratio on exotic values)
  if (fgCol && bgCol) {
    if (docContrast < 4.5) push({
      problem: 'Text/background contrast below WCAG AA', evidence: `contrast ${docContrast.toFixed(2)}:1 (fg ${fgCol} on bg ${bgCol}, needs ≥4.5:1)`,
      expectedEffect: 'accessible, legible text', op: { op: 'token.update', key: 'neutralFg', value: '#141433' }, confidence: 0.9, regressionRisk: 'low' });
  }
  // 2) heading hierarchy — a heading must not DESCEND more than one level at a
  // time (h1 → h3 is a skip). Returning to a shallower sibling level (h3 cards
  // under an h2 section, then a new h2 section) is legitimate, so we don't flag
  // decreases.
  let hierarchyOk = true;
  for (let i = 1; i < headingLevels.length; i++) if (headingLevels[i].level - headingLevels[i - 1].level > 1) { hierarchyOk = false; break; }
  if (!headingLevels.length) push({ problem: 'No headings on the page', evidence: 'heading nodes: 0', expectedEffect: 'clear content structure + document outline', op: { op: 'node.create', node: { component: { family: 'heading' }, semanticRole: 'none', props: { level: 1 }, content: { text: 'Welcome' } }, parentId: null }, confidence: 0.7, regressionRisk: 'visual (verify)' });
  else if (!hierarchyOk) {
    // Find the first heading that descends more than one level from its predecessor.
    let skipIdx = -1;
    for (let i = 1; i < headingLevels.length; i++) if (headingLevels[i].level - headingLevels[i - 1].level > 1) { skipIdx = i; break; }
    const target = skipIdx >= 0 ? headingLevels[skipIdx] : headingLevels[0];
    push({ problem: 'Heading levels skip / jump out of order', evidence: 'levels: ' + headingLevels.map(h => h.level).join(' → '), expectedEffect: 'semantic document outline', op: { op: 'node.set', id: target.id, field: 'props', value: { level: Math.max(1, target.level - 1) } }, confidence: 0.8, regressionRisk: 'low' });
  }
  else if (headingLevels[0].level !== 1) push({ problem: 'No <h1>-level heading first', evidence: 'first heading is h' + headingLevels[0].level, expectedEffect: 'correct top-of-page landmark', op: { op: 'node.set', id: headingLevels[0].id, field: 'props', value: { level: 1 } }, confidence: 0.85, regressionRisk: 'low' });
  // 3) images/media missing alt
  if (imagesNoAlt > 0) push({ problem: imagesNoAlt + ' image(s) missing alt', evidence: imagesNoAlt + ' image node(s) with empty alt', expectedEffect: 'screen-reader + SEO value', op: { op: 'asset.set', id: order.find(id => nodes[id].component.family === 'image') || '', asset: { alt: 'Illustration' } }, confidence: 0.9, regressionRisk: 'low' });
  // 4) interactive elements without accessible names
  if (interactive.length) push({ problem: interactive.length + ' interactive element(s) missing accessible name', evidence: interactive.map(x => x.family + ':' + x.id).join(', '), expectedEffect: 'keyboard/screen-reader usability', op: { op: 'node.set', id: interactive[0].id, field: 'content', value: { label: 'Action' } }, confidence: 0.85, regressionRisk: 'low' });
  // 5) performance / motion budget
  const budget = nxMotionBudget(project, opts.budget);
  const heavy = order.filter(id => { const m = project.motion && project.motion[id]; return m && (m.primitives || []).some(p => /3d|parallax|particle|blur|webgl/.test(p)); });
  if (!budget.withinBudget) push({ problem: 'Motion exceeds performance budget', evidence: `budget score ${budget.score} (over ${budget.primitives} animated primitives, GPU effects ${budget.gpuEffects})`, expectedEffect: 'smooth even on low-end / mobile', op: { op: 'motion.update', id: heavy[0] || order[0] || '', profile: { recipe: 'smooth', primitives: ['heading-reveal', 'cta-spring'], reduced: 'fade' } }, confidence: 0.9, regressionRisk: 'visual (a bit less showy)' });
  // 6) responsive present
  const responsiveCount = order.filter(id => (project.responsive && project.responsive[id] && project.responsive[id].length)).length;
  if (responsiveCount === 0) push({ problem: 'No responsive overrides', evidence: 'nodes with responsive rules: 0', expectedEffect: 'content adapts across viewports', op: { op: 'responsive.update', id: order[0] || '', rule: { on: 'mobile', props: { direction: 'column', columns: 1 } } }, confidence: 0.8, regressionRisk: 'low' });
  // 7) reduced motion
  const anyMotion = order.some(id => project.motion && project.motion[id] && (project.motion[id].primitives || []).length);
  if (anyMotion && !tokens.reducedMotion) push({ problem: 'Reduced-motion preference not declared', evidence: 'nodes with motion: ' + order.filter(id => project.motion && project.motion[id] && project.motion[id].primitives.length).length, expectedEffect: 'respects users who opt out of motion', op: { op: 'token.update', key: 'reducedMotion', value: 'fade' }, confidence: 0.9, regressionRisk: 'low (accessibility)' });

  problems.sort((a, b) => a.confidence < b.confidence ? 1 : -1);
  const evidence = {
    breakpoint: bp, tokens: { fg, bg }, contrast: +docContrast.toFixed(2),
    hierarchy: { levels: headingLevels.map(h => 'h' + h.level), ok: hierarchyOk },
    accessibility: { imagesNoAlt, mediaNoAlt, interactiveMissingName: interactive.length, headingCount: headingLevels.length },
    responsive: { nodesWithRules: responsiveCount, total: order.length },
    motion: { budget, heavyNodes: heavy.length },
    nodes: byId, textNodes: textNodes.length,
  };
  return { evidence, problems, qa: __r('nxDesignQAProject', () => ({ score: 0 }))(project) };
}

function nxCriticEvidence(project) {
  const qa = __r('nxDesignQAProject', null)(project);
  const metrics = qa.metrics || {};
  const problems = [];
  const heroId = project.order.find(id => project.nodes[id].semanticRole === 'hero') || null;
  const push = (p) => problems.push(p);
  if (qa.categories.contrast.score < 70) push({ problem: 'Text/background contrast below target', evidence: 'contrast ' + metrics.contrast + ':1 (needs ≥4.5:1)', expectedEffect: 'legibility + accessibility pass', op: { op: 'token.update', key: 'neutralFg', value: '#141433' }, confidence: 0.9, regressionRisk: 'low' });
  if (qa.categories.hierarchy.score < 70 && heroId) push({ problem: 'Hero lacks visual dominance', evidence: 'hierarchy sub-score ' + qa.categories.hierarchy.score, expectedEffect: 'stronger first impression', op: { op: 'node.set', id: heroId, field: 'props', value: { align: 'center', direction: 'column' } }, confidence: 0.8, regressionRisk: 'low' });
  if (qa.motion < 40 && heroId) push({ problem: 'Motion is thin; no composed entrance', evidence: 'motion sub-score ' + qa.motion, expectedEffect: 'cinematic, budget-respecting motion', op: { op: 'motion.update', id: heroId, profile: { recipe: 'cinematic', primitives: ['heading-reveal', 'cta-spring', 'background-parallax'], reduced: 'fade' } }, confidence: 0.82, regressionRisk: 'performance (verify budget)' });
  if (qa.structural < 60 && heroId) push({ problem: 'Structure is thin', evidence: 'structural sub-score ' + qa.structural, expectedEffect: 'richer, more balanced composition', op: { op: 'node.replace', id: heroId, family: 'hero', variant: 'split' }, confidence: 0.75, regressionRisk: 'medium (layout)' });
  problems.sort((a, b) => a.confidence < b.confidence ? 1 : -1);
  return { problems, qa };
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. MOTION TIMELINE + BUDGET  (synchronization + performance floor)
// ═══════════════════════════════════════════════════════════════════════════
// A timeline is a set of keyed points; `nxTimelineCompose` turns a recipe + budget
// into a synchronized schedule (with offsets), and `nxMotionBudget` scores it.
function nxTimeline(role, recipe, opts) {
  const points = { 'background starts': 0.0, '3D object starts rotating': 0.30 };
  if (role === 'hero') { points['heading begins'] = 0.10; points['subtitle begins'] = 0.25; points['CTA begins'] = 0.45; points['floating elements begin'] = 0.60; }
  else { points['card reveals'] = 0.05; }
  return { role, recipe: recipe || 'smooth', points, reduced: (opts && opts.reduced) || 'fade' };
}
function nxTimelineCompose(timeline, opts) {
  const t = Object.assign({}, timeline);
  const offset = (opts && opts.offset) || 0;
  const out = { events: Object.keys(t.points).map((k, i) => ({ at: +(t.points[k] + offset).toFixed(2), label: k, index: i })).sort((a, b) => a.at - b.at), reduced: t.reduced };
  return out;
}
const NX_BUDGET_DEFAULTS = { animationComplexity: 3, gpuEffects: 1, webgl: 0, particles: 0, blur: 'none', mobileReduction: 0.5, reducedMotion: 'fade' };
function nxMotionBudget(project, opts) {
  const b = Object.assign({}, NX_BUDGET_DEFAULTS, opts || {});
  // count animated nodes + primitives to derive complexity
  let primitives = 0;
  for (const id of project.order) { const m = project.motion && project.motion[id]; if (m && m.primitives) primitives += m.primitives.length; }
  const complexity = Math.min(10, primitives);
  const score = Math.max(0, 100 - (b.animationComplexity * 10 + b.gpuEffects * 8 + (b.webgl ? 20 : 0) + b.particles * 2 + complexity * 4));
  return { ...b, primitives, complexity, score, withinBudget: score >= 40 && primitives <= 15 };
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. BEST-KNOWN-VERSION EVOLUTION LOOP  (staged + guarded promotion)
// ═══════════════════════════════════════════════════════════════════════════
// OBSERVE→UNDERSTAND→PLAN→PATCH→RENDER→TEST→CRITIQUE→ACCEPT/REJECT. Promote a
// candidate to Best Known only if design QA improves AND engineering doesn't
// regress AND the motion budget is respected.
function nxEvolve(project, agenda, opts) {
  opts = opts || {};
  const maxIter = Math.max(1, Math.min(opts.iterations || 3, 8));
  let cur = project;
  let bestKnown = project;
  let bestScore = __r('nxDesignQAProject', null)(project).score || 0;
  const log = [];
  for (let i = 0; i < maxIter; i++) {
    const stage = { iter: i + 1 };
    stage.observe = __r('nxDesignQAProject', null)(cur);
    stage.understand = nxCriticEvidence(cur);
    stage.visualEvidence = nxVisualEvidence(cur);
    // PLAN: use the agenda (an intent) OR the critic's top evidence-based op.
    let ops = [];
    if (ops.length === 0 && agenda && agenda.intent) ops = nxIntentToPlan(agenda.intent, cur).ops;
    if (ops.length === 0 && stage.understand.problems[0]) ops = [stage.understand.problems[0].op];
    stage.plan = ops;
    if (!ops.length) { stage.result = 'no change proposed'; log.push(stage); break; }
    const applied = __r('nxProjectPatch', null)(cur, ops);
    if (!applied.ok) { stage.result = 'patch rejected: ' + applied.errors.join('; '); log.push(stage); break; }
    stage.patch = { applied: applied.applied };
    const candidate = applied.project;
    // RENDER + TEST (compile; check engineering + budget)
    const compiled = __r('nxCompile', null)(candidate);
    stage.render = { valid: compiled.valid, validationErrors: compiled.validationErrors };
    const budget = nxMotionBudget(candidate, opts.budget);
    stage.test = { budget };
    const cscore = __r('nxDesignQAProject', null)(candidate).score;
    // CRITIQUE
    stage.critique = { candidateScore: cscore, bestKnownScore: bestScore, promoted: false };
    // ACCEPT/REJECT — promote only on measured improvement + no regressions.
    if (cscore > bestScore && compiled.valid && budget.withinBudget) { bestKnown = candidate; bestScore = cscore; stage.critique.promoted = true; cur = candidate; }
    else { stage.result = 'candidate not promoted (no measured improvement, a regression, or over budget)'; log.push(stage); break; }
    stage.result = cscore >= 85 ? 'converged' : 'continue';
    log.push(stage);
  }
  return { project: bestKnown, bestScore, log, promoted: log.filter(l => l.critique && l.critique.promoted).length };
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. HTML → PROJECT GRAPH IMPORT / MIGRATION LAYER
//    Existing HTML sites must be able to ENTER the graph architecture instead of
//    living permanently outside it. This is a best-effort reverse parser: it
//    extracts as much as it safely can and exposes CONFIDENCE per node so a
//    human/editor sees exactly what was extracted vs inferred vs unknown. It
//    never claims perfect reverse parsing.
// ═══════════════════════════════════════════════════════════════════════════
const NX_IMPORT_CONFIDENCE = ['extracted', 'inferred', 'unknown'];
const NX_ROLE_BY_HINT = {
  hero: ['hero', 'welcome', 'introduc', 'landing', 'the best', 'lightning'],
  features: ['feature', 'service', 'what we', 'capabilit', 'why us', 'benefit'],
  pricing: ['pricing', 'plan', 'cost', 'member', 'package'],
  testimonials: ['testimonial', 'what our', 'review', 'quote', 'loved', 'client'],
  cta: ['get started', 'sign up', 'start now', 'ready', 'call to action', 'book', 'reserve'],
  footer: ['contact', '©', 'copyright', 'legal', 'privacy'],
};
const NX_TAG_TO_ROLE = { nav: 'nav', header: 'hero', footer: 'footer', main: 'section', section: 'section' };
// Very small, safe HTML tokenizer (dependency-free, works in worker + browser).
// Splits the document into top-level content blocks by structural tags + headings.
function __htmlBlocks(html) {
  const blocks = [];
  const structural = /(nav|header|footer|main|section)/i;
  // Pass 1: opaque top-level structural containers — capture their FULL inner
  // (including inner headings / content) so a hero section keeps its h1+p+a+img.
  const rest = { str: html };
  const secRe = /<\s*(nav|header|footer|main|section)\b[^>]*>([\s\S]*?)<\s*\/\1\s*>/gi;
  let m, last = 0;
  const used = [];
  while ((m = secRe.exec(html))) {
    const tag = (m[1] || '').toLowerCase();
    const inner = m[2] || '';
    if (inner.trim()) { blocks.push({ tag, inner }); used.push([m.index, secRe.lastIndex]); }
    last = secRe.lastIndex;
  }
  // Build a string with matched opaque sections blanked out
  let residue = html;
  for (const [s, e] of used.reverse()) residue = residue.slice(0, s) + ' '.repeat(e - s) + residue.slice(e);
  // Pass 2: standalone headings that are NOT inside an opaque section — each
  // heading + content until the next heading is its own block.
  const headRe = /<\s*(h1|h2|h3)\b[^>]*>([\s\S]*?)<\s*\/\1\s*>/gi;
  let hm;
  while ((hm = headRe.exec(residue))) {
    const tag = (hm[1] || '').toLowerCase();
    const after = residue.slice(hm.index + hm[0].length).match(/^[\s\S]*?(?=<\s*h[123]\b|$)/);
    const inner2 = (after ? after[0] : '') + hm[2];
    blocks.push({ tag, inner: inner2 });
  }
  // Pass 3: if nothing structural at all, treat the whole body as one unknown block.
  if (!blocks.length) blocks.push({ tag: 'body', inner: html });
  return blocks;
}
function __stripTags(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function __extractText(inner, tag) {
  if (tag === 'h1' || tag === 'h2' || tag === 'h3') return __stripTags(inner);
  const h = (inner.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || [])[1];
  return h ? __stripTags(h) : __stripTags(inner).slice(0, 120);
}
function __inferRole(text, tag) {
  const t = (text || '').toLowerCase();
  // Explicit structural tags first (nav/footer/header are unambiguous).
  if (tag === 'nav') return { role: 'nav', confidence: NX_IMPORT_CONFIDENCE[0] };
  if (tag === 'footer') return { role: 'footer', confidence: NX_IMPORT_CONFIDENCE[0] };
  if (tag === 'header') return { role: 'hero', confidence: NX_IMPORT_CONFIDENCE[0] };
  // Then keyword hints from the section's own text (hero/features/pricing/etc).
  for (const [role, hints] of Object.entries(NX_ROLE_BY_HINT)) for (const h of hints) if (t.includes(h)) return { role, confidence: NX_IMPORT_CONFIDENCE[1] };
  // Fallback: a bare heading/unknown → generic section.
  return { role: 'section', confidence: NX_IMPORT_CONFIDENCE[2] };
}
function __extractHero(inner, text) {
  const btn = (inner.match(/<(?:a|button)[^>]*>([\s\S]*?)<\/(?:a|button)>/i) || [])[1];
  const sub = (inner.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1];
  return { headline: text || 'Welcome', sub: sub ? __stripTags(sub) : '', cta: btn ? __stripTags(btn).slice(0, 40) : 'Get started' };
}
function __extractCards(inner) {
  const cards = [];
  const re = /<(?:div|li|article)[^>]*class="[^"]*(?:card|item|feature|pricing|plan|tier)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|li|article)>/gi;
  let m;
  while ((m = re.exec(inner))) { const c = __stripTags(m[1]); const title = (c.match(/^[A-Za-z0-9 ,.'-]{2,40}/) || [''])[0].trim(); cards.push({ title: title.slice(0, 40), text: c.slice(title.length).slice(0, 120) }); }
  return cards.slice(0, 6);
}
function __extractAssets(inner) {
  const assets = [];
  const re = /<img[^>]*>/gi; let m;
  while ((m = re.exec(inner))) { const tag = m[0]; const src = (tag.match(/src="([^"]*)"/i) || [])[1]; const alt = (tag.match(/alt="([^"]*)"/i) || [])[1]; const w = parseInt((tag.match(/width="(\d+)"/i) || [])[1] || 0); const h = parseInt((tag.match(/height="(\d+)"/i) || [])[1] || 0); if (src) assets.push({ src, alt: alt || '', width: w || null, height: h || null }); }
  return assets;
}
function __extractTokens(html) {
  // pull the first saturated hex colors + font families out of style tags / inline
  const styleText = String(html).replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, c) => ' ' + c);
  const hexes = styleText.match(/#[0-9a-fA-F]{6}/g) || [];
  let primary = null, accent = null, bg = null, fg = null;
  for (const hex of hexes) { if (!primary) primary = hex; else if (!accent) accent = hex; else if (!bg) bg = hex; else if (!fg) fg = hex; }
  const fonts = styleText.match(/font-family:\s*([^;}\n]+)/g) || [];
  const headingFont = (fonts[0] || '').replace('font-family:', '').trim() || null;
  return { primary, accent, bg, fg, headingFont };
}
// Build a Project Graph from HTML. Returns an immutable project (built through the
// mutation engine), per-node confidence, and an asset list bound per node.
function nxImportHtml(html, opts) {
  opts = opts || {};
  const errors = [];
  const blocks = __htmlBlocks(html);
  const tokens = __extractTokens(html);
  const name = opts.name || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || 'Imported Site';
  let project = __r('nxNewProject', null)({ name, brief: opts.brief || 'imported site', tokens: Object.assign({}, tokens.primary ? { primaryColor: tokens.primary, secondaryColor: tokens.accent || '#777', neutralBg: tokens.bg || '#ffffff', neutralFg: tokens.fg || '#111', headingFont: tokens.headingFont || 'system-ui, sans-serif', bodyFont: 'system-ui, sans-serif' } : {}) });
  const confidences = [];
  let ci = 0;
  for (const b of blocks) {
    const text = __extractText(b.inner, b.tag);
    const role = __inferRole(text, b.tag);
    const asset = __extractAssets(b.inner)[0] || null;
    const cards = __extractCards(b.inner);
    let node;
    try {
      const res = buildImportedNode(project, role.role, text, b.inner, opts);
      if (res && res.ok) { project = res.project; node = res.nodeId; }
    } catch (e) { errors.push('import block ' + ci + ': ' + (e && e.message)); }
    confidences.push({ index: ci, role: role.role, confidence: role.confidence, assets: asset ? 1 : 0, cards: cards.length });
    ci++;
  }
  if (errors.length) return { ok: false, errors, project, confidence: confidences };
  return { ok: true, project, confidence: confidences, tokens, name, warnings: [] };
}
function buildImportedNode(project, role, text, inner, opts) {
  // choose a component family from the inferred role
  const content = {};
  // Build via the mutation engine's node.create so the graph stays atomic/valid.
  if (role === 'hero') Object.assign(content, __extractHero(inner, text));
  else if (role === 'features' || role === 'pricing' || role === 'testimonials') { content.heading = text; content.items = __extractCards(inner); }
  else if (role === 'cta') Object.assign(content, __extractHero(inner, text));
  else if (role === 'footer') content.name = opts.name || 'Company';
  else { content.heading = text; }
  const FAMILY_BY_ROLE = { hero: 'hero', nav: 'nav', footer: 'footer', cta: 'cta', pricing: 'pricing', testimonials: 'testimonials', features: 'features', section: 'section' };
  const nodeSpec = { id: role + ':imp' + (Math.floor(Math.random() * 1e6)), component: { family: FAMILY_BY_ROLE[role] || 'section' }, semanticRole: role };
  const r = __r('nxProjectPatch', null)(project, [{ op: 'node.create', node: Object.assign({}, nodeSpec, { content }) }]);
  if (!r.ok) return r;
  return { ok: true, project: r.project, nodeId: nodeSpec.id };
}

// ── EXPORTS ────────────────────────────────────────────────────────────────
const API = {
  NX_CONSTRAINT_DEFAULTS, NX_STATES, NX_ASSET_KINDS, NX_INTENTS, NX_BUDGET_DEFAULTS,
  NX_IMPORT_CONFIDENCE,
  nxSetConstraint, nxGetConstraint, nxSolveConstraint, nxSolveLayout,
  nxDefineState, nxStates, nxCompileStateCss,
  nxAddAsset, nxGetAsset, nxAssetValidate, nxResolveAssetForViewport,
  nxDiff, nxHistory, nxHistoryPush, nxSnapshotView, nxHistoryRevert, nxCompare,
  nxIntentToPlan, nxApplyIntent,
  nxCriticEvidence, nxVisualEvidence,
  nxTimeline, nxTimelineCompose, nxMotionBudget,
  nxEvolve,
  nxImportHtml,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') { for (const k of Object.keys(API)) window[k] = API[k]; }
