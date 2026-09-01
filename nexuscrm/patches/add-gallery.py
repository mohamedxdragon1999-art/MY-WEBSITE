# 3D SCENE GALLERY — a first-class view for the 50-scene library.
import re
p='NexusCRM_V4_Hardened.html'
h=open(p).read()
n0=len(h)

# 1) nav item (right after the AI Command Hub item)
old_nav='''    <div class="nav-item ai-hub-nav" data-view="ai-hub" onclick="navigate('ai-hub')">
      <span class="nav-icon">🧠</span><span class="nav-label">AI Command Hub</span><span class="nav-ai-badge" id="ai-tools-count">25 Tools</span>
    </div>
  </div>'''
new_nav='''    <div class="nav-item ai-hub-nav" data-view="ai-hub" onclick="navigate('ai-hub')">
      <span class="nav-icon">🧠</span><span class="nav-label">AI Command Hub</span><span class="nav-ai-badge" id="ai-tools-count">25 Tools</span>
    </div>
    <div class="nav-item" data-view="gallery3d" onclick="navigate('gallery3d')" style="background:linear-gradient(135deg,rgba(139,92,246,.14),rgba(34,211,238,.08));border:1px solid rgba(139,92,246,.25)">
      <span class="nav-icon">✨</span><span class="nav-label">3D Scene Gallery</span><span class="nav-badge" style="display:inline-block">50</span>
    </div>
  </div>'''
assert old_nav in h
h=h.replace(old_nav,new_nav)

# 2) title
old_t="const VIEW_TITLES = {\n  dashboard:'Dashboard', 'ai-hub':'🧠 AI Command Hub',"
new_t="const VIEW_TITLES = {\n  dashboard:'Dashboard', 'ai-hub':'🧠 AI Command Hub', gallery3d:'✨ 3D Scene Gallery',"
assert old_t in h
h=h.replace(old_t,new_t)

# 3) the view + helpers — inserted right before previewScene (all dependencies exist there)
anchor='async function previewScene() {'
assert anchor in h
gallery = r'''// ═══════════════════════════════════════════════════════════════════
// 3D SCENE GALLERY — browse all 50 Spline-community-style WebGL scenes
// with a LIVE interactive preview. The same scene code that runs behind
// generated site heroes runs here, so what you see is exactly what ships.
// ═══════════════════════════════════════════════════════════════════
const NX_SCENE_FAMILIES = [
  { key:'particles', label:'Particles',   from:1,  to:8,  hue:'#8b5cf6' },
  { key:'liquid',    label:'Liquid & Glass', from:9,  to:16, hue:'#22d3ee' },
  { key:'type',      label:'Typography',  from:17, to:24, hue:'#f5b942' },
  { key:'orbs',      label:'Reactive Orbs', from:25, to:30, hue:'#c4b5fd' },
  { key:'boxes',     label:'Boxes & Cloners', from:31, to:35, hue:'#f472b6' },
  { key:'scroll',    label:'Scroll & Float', from:36, to:40, hue:'#34d399' },
  { key:'retro',     label:'Retrofuture', from:41, to:44, hue:'#fb7185' },
  { key:'web3',      label:'Web3',        from:45, to:47, hue:'#fbbf24' },
  { key:'signature', label:'Signature',   from:48, to:50, hue:'#a78bfa' },
];
function nxFamilyOf(sceneId) {
  const n = parseInt(String(sceneId || '').replace(/^sp/, ''), 10) || 0;
  return NX_SCENE_FAMILIES.find(f => n >= f.from && n <= f.to) || NX_SCENE_FAMILIES[NX_SCENE_FAMILIES.length - 1];
}
// Builds a complete, self-contained HTML document that boots a scene with
// three.js (CDN with onload fallback), reduced-motion exit, WebGL check and
// DPR clamp — the same boot contract used by generated sites.
function nxSceneIframeSrc(body, tick, userText, accentHex) {
  const accent = accentHex || '#8b5cf6';
  return '<!DOCTYPE html><html><head><style>html,body{margin:0;height:100%;background:#0b0e14;overflow:hidden}</style></head><body>'
    + '<div class="nx-scene-host" style="position:absolute;inset:0"></div>'
    + '<script src="https://unpkg.com/three@0.160.0/build/three.min.js" onerror="window.__nxThreeFail=1"><\/script>'
    + '<script>\n'
    + 'var host=document.querySelector(".nx-scene-host");\n'
    + 'var wantText=' + JSON.stringify(String(userText || '').slice(0, 30)) + ';\n'
    + 'window.NX_SCENE_TEXT=wantText;\n'
    + 'try{var c2=document.createElement("canvas");if(!(window.WebGLRenderingContext&&(c2.getContext("webgl")||c2.getContext("experimental-webgl")))){host.style.background="radial-gradient(circle at 30% 30%, rgba(139,92,246,.25), transparent 65%)";document.body.innerHTML="<div style=color:#94a3b8;font-family:sans-serif;padding:40px;text-align:center>WebGL preview needs a real browser</div>";}else{boot3();}}catch(e){document.body.innerHTML="<div style=color:#94a3b8;font-family:sans-serif;padding:40px;text-align:center>WebGL not available here</div>";}\n'
    + 'function boot3(){if(!window.THREE){setTimeout(boot3,120);if(window.__nxThreeFail){document.body.innerHTML="<div style=color:#94a3b8;font-family:sans-serif;padding:40px;text-align:center>Could not load the three.js renderer (offline?)</div>";return;}}\n'
    + 'if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches){host.style.background="radial-gradient(circle at 35% 35%, rgba(139,92,246,.2), transparent 70%)";return;}\n'
    + 'var THREE=window.THREE;var scene=new THREE.Scene();var cam=new THREE.PerspectiveCamera(55,host.offsetWidth/Math.max(1,host.offsetHeight),0.1,2000);\n'
    + 'var renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setSize(host.offsetWidth,host.offsetHeight);host.appendChild(renderer.domElement);renderer.domElement.style.cssText="position:absolute;inset:0;width:100%;height:100%";\n'
    + 'function resize(){renderer.setSize(host.offsetWidth,host.offsetHeight);cam.aspect=host.offsetWidth/Math.max(1,host.offsetHeight);cam.updateProjectionMatrix();}addEventListener("resize",resize,{passive:true});\n'
    + 'var ac=new THREE.Color("' + accent + '"),a2=new THREE.Color("#c4b5fd"),t3=new THREE.Color("#22d3ee");\n'
    + body.replace("'__NXTX__'", JSON.stringify(String(userText || '').slice(0, 30)))
    + '\nvar t0=performance.now();\n'
    + '(function anim(now){var t=(now-t0)/1000;' + tick + 'renderer.render(scene,cam);requestAnimationFrame(anim);})(t0);}\n'
    + '<\/script></body></html>';
}
let __nxGalleryScene = 'sp1';
let __nxGalleryFilter = 'all';
views.gallery3d = function () {
  const ids = Object.keys(SPLINE_SCENES || {});
  if (!ids.length) {
    content('<div class="empty-state"><div class="empty-icon">✨</div><div class="empty-title">Scene library not loaded</div><div class="empty-text">Reload the app.</div></div>');
    return;
  }
  const visible = ids.filter(id => __nxGalleryFilter === 'all' || nxFamilyOf(id).key === __nxGalleryFilter);
  const chips = [{ key:'all', label:'All 50', hue:'#8b5cf6' }, ...NX_SCENE_FAMILIES]
    .map(f => `<button class="btn" style="margin:2px 4px 2px 0;padding:5px 12px;font-size:12px;border:1px solid ${__nxGalleryFilter === f.key ? f.hue : 'var(--border)'};color:${__nxGalleryFilter === f.key ? f.hue : 'var(--text2)'};background:${__nxGalleryFilter === f.key ? 'rgba(139,92,246,.12)' : 'transparent'}" onclick="__nxGalleryFilter='${f.key}';views.gallery3d()">${f.label}</button>`).join('');
  const cards = visible.map(id => {
    const s = SPLINE_SCENES[id], fam = nxFamilyOf(id);
    return `<div class="card" style="padding:0;overflow:hidden;cursor:pointer;transition:transform .15s,border-color .15s" onmouseover="this.style.transform='translateY(-2px)';this.style.borderColor='${fam.hue}'" onmouseout="this.style.transform='';this.style.borderColor='var(--border)'" onclick="__nxGalleryPick('${id}')">
      <div style="height:64px;background:linear-gradient(135deg,${fam.hue}33,transparent 60%),radial-gradient(circle at 70% 20%, ${fam.hue}22, transparent 55%),#0b0e14;position:relative">
        <div style="position:absolute;inset:0;opacity:.5;background:radial-gradient(circle at 30% 70%, ${fam.hue}30 0 8px, transparent 9px),radial-gradient(circle at 60% 40%, ${fam.hue}26 0 5px, transparent 6px),radial-gradient(circle at 80% 75%, ${fam.hue}20 0 7px, transparent 8px)"></div>
        <div style="position:absolute;top:8px;left:10px;font-size:10px;font-weight:700;color:${fam.hue};letter-spacing:.4px">${fam.label.toUpperCase()}</div>
        ${s.text ? '<div style="position:absolute;top:8px;right:10px;font-size:10px" title="You can type your own words for this scene">✍️ editable text</div>' : ''}
      </div>
      <div style="padding:10px 12px">
        <div style="font-weight:700;font-size:13px;margin-bottom:3px">${esc(s.name)}</div>
        <div style="font-size:11px;color:var(--text3);line-height:1.45;min-height:31px">${esc((s.desc || '').slice(0, 88))}</div>
      </div></div>`;
  }).join('');
  content(`
  <div style="margin-bottom:14px">
    <div style="font-size:13px;color:var(--text2);margin-bottom:10px">50 professional real-time WebGL scenes rebuilt from the most-remixed Spline community designs — every one is <b>fully 3D, animated and mouse-interactive</b>, and runs behind your generated site heroes. Click any card for a live preview.</div>
    <div>${chips}</div>
  </div>
  <div class="card" style="padding:0;overflow:hidden;margin-bottom:16px;border:1px solid var(--border)">
    <div id="nx-gallery-stage" style="height:400px;background:#0b0e14;position:relative"></div>
    <div style="padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--border)">
      <div style="flex:1;min-width:220px">
        <div id="nx-gallery-name" style="font-weight:700"></div>
        <div id="nx-gallery-desc" style="font-size:12px;color:var(--text3);line-height:1.5"></div>
      </div>
      <div id="nx-gallery-textwrap" style="display:none;align-items:center;gap:8px">
        <span style="font-size:12px;color:var(--text2)">✍️ Your words</span>
        <input id="nx-gallery-text" maxlength="30" placeholder="Type any text…" style="width:170px" class="input" oninput="__nxGalleryTextChanged()">
      </div>
      <button class="btn" style="background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;border:none" onclick="__nxUseInBuilder()">🌐 Use in Site Builder</button>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:12px">${cards}</div>`);
  __nxGalleryPick(__nxGalleryScene in SPLINE_SCENES ? __nxGalleryScene : 'sp1');
};
function __nxGalleryTextChanged() {
  const stage = V('nx-gallery-stage');
  const cur = SPLINE_SCENES[__nxGalleryScene];
  if (!stage || !cur) return;
  const txt = (V('nx-gallery-text')?.value || '').slice(0, 30);
  stage.innerHTML = `<iframe sandbox="allow-scripts" style="width:100%;height:100%;border:none" srcdoc="${escAttr(nxSceneIframeSrc(cur.body, cur.tick, txt))}"></iframe>`;
}
function __nxGalleryPick(id) {
  __nxGalleryScene = id;
  const s = SPLINE_SCENES[id];
  if (!s) return;
  const nm = V('nx-gallery-name'), ds = V('nx-gallery-desc'), tw = V('nx-gallery-textwrap');
  if (nm) nm.textContent = s.name + (s.text ? '  ✍️' : '');
  if (ds) ds.textContent = s.desc || '';
  if (tw) tw.style.display = s.text ? 'flex' : 'none';
  __nxGalleryTextChanged();
}
function __nxUseInBuilder() {
  const id = __nxGalleryScene;
  try {
    window.__nxPendingScene = id;
    navigate('websites');
    setTimeout(() => {
      try {
        const sel = V('ws-scene');
        if (sel) {
          sel.value = id;
          if (typeof scenePick === 'function') scenePick(id);
          else sel.dispatchEvent(new Event('change'));
          toast('Scene "' + (SPLINE_SCENES[id]?.name || id) + '" selected — finish building your site below.', 'success', 5000);
          return;
        }
      } catch (e) {}
      toast('Scene "' + (SPLINE_SCENES[id]?.name || id) + '" — pick it in the 3D Scene step of the builder.', 'info', 6000);
    }, 350);
  } catch (e) { toast('Could not jump to the builder: ' + e.message, 'error'); }
}
'''
h=h.replace(anchor, gallery + anchor)
open(p,'w').write(h)
print(f'✓ 3D Scene Gallery added ({n0} -> {len(h)} bytes)')
