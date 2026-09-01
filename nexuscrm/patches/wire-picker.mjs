// One-shot wiring patch: Spline Community optgroup + scene-words input.
import { readFileSync, writeFileSync } from 'node:fs';
const P = 'NexusCRM_V4_Hardened.html';
let h = readFileSync(P, 'utf8');

// 1) insert the Spline Community optgroup before the WebGL optgroup
const optAnchor = `<option value="">None (static)</option><optgroup label="🎮 WebGL 3D (most beautiful — real 3D objects, lights, materials)">\${__wsScenes.filter(x=>x.type==='three').map(x=>`;
if (!h.includes(optAnchor)) { console.error('❌ optgroup anchor not found'); process.exit(1); }
h = h.replace(optAnchor,
  `<option value="">None (static)</option><optgroup label="🌀 Spline Community (50 brand-new — particles, liquid glass, gold text… all interactive)">\${__wsScenes.filter(x=>x.group==='spline').map(x=>\`<option value="\${escAttr(x.id)}">\${esc(x.name)}\${x.text?' ✍️':''}</option>\`).join('')}</optgroup><optgroup label="🎮 WebGL 3D (most beautiful — real 3D objects, lights, materials)">\${__wsScenes.filter(x=>x.type==='three'&&x.group!=='spline').map(x=>`);

// 2) label counts include the new group
const labAnchor = `🌌 3D Background Scene (\${__wsScenes.filter(x=>x.type==='three').length} WebGL • `;
if (!h.includes(labAnchor)) { console.error('❌ label anchor not found'); process.exit(1); }
h = h.replace(labAnchor, `🌌 3D Background Scene (\${__wsScenes.filter(x=>x.group==='spline').length} Spline Community • \${__wsScenes.filter(x=>x.type==='three'&&x.group!=='spline').length} WebGL • `);

// 3) scene-words input right after the preview-button row
const btnAnchor = `<span id="ws-scene-desc" style="font-size:11px;color:var(--text3)"></span></div></div>`;
if (!h.includes(btnAnchor)) { console.error('❌ button-row anchor not found'); process.exit(1); }
h = h.replace(btnAnchor, `<span id="ws-scene-desc" style="font-size:11px;color:var(--text3)"></span></div>
        <div class="form-group" id="ws-scene-text-wrap" style="display:none;margin-top:10px"><label>✍️ Scene words (any language — same animation)</label><input id="ws-scene-text" maxlength="30" placeholder="e.g. NEXUS or أهلاً" oninput="scenePick()"><div style="font-size:11px;color:var(--text3);margin-top:3px">This scene renders YOUR words in 3D — type anything, any language; the animation stays identical.</div></div></div>`);

// 4) scenePick(): toggle the words input + hint in the desc
const pickAnchor = `function scenePick() {
  const id = V('ws-scene')?.value || '';
  const wrap = V('ws-spline-wrap');
  if (wrap) wrap.style.display = id === '__spline' ? 'block' : 'none';
  const sc = __wsScenes.find(x => x.id === id);
  const d = V('ws-scene-desc');
  if (d) d.textContent = sc ? sc.desc : '';
}`;
if (!h.includes(pickAnchor)) { console.error('❌ scenePick anchor not found'); process.exit(1); }
h = h.replace(pickAnchor, `function scenePick() {
  const id = V('ws-scene')?.value || '';
  const wrap = V('ws-spline-wrap');
  if (wrap) wrap.style.display = id === '__spline' ? 'block' : 'none';
  const sc = __wsScenes.find(x => x.id === id);
  const d = V('ws-scene-desc');
  if (d) d.textContent = sc ? sc.desc : '';
  // Text scenes (✍️) render the owner's words — show the words input only for them.
  const tw = V('ws-scene-text-wrap');
  if (tw) tw.style.display = (sc && sc.text) ? 'block' : 'none';
}`);

writeFileSync(P, h);
console.log('✓ picker wired: Spline Community optgroup + scene-words input + scenePick toggle');
