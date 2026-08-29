#!/usr/bin/env python3
"""Batch 4 (cycles 37-40): builder v4 design gallery — theme/hero/anim/card/nav/3D selects + local parity."""
import sys
P = 'NexusCRM_V4_Hardened.html'
s = open(P, encoding='utf-8').read()

def rep(old, new, tag, count=1):
    global s
    n = s.count(old)
    if n != count:
        print(f'❌ [{tag}] found {n}'); print('OLD:', repr(old[:100])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

# ── 1. Builder modal: add the 6 catalogs (theme, hero, anim, card, nav, 3D) ──
rep("""      <div class="form-row">
        <div class="form-group"><label>Font</label><select id="ws-font"><option value="system">System (fast)</option><option value="inter">Inter</option><option value="poppins">Poppins</option><option value="playfair">Playfair Display</option><option value="space">Space Grotesk</option><option value="dm">DM Sans</option></select></div>
        <div class="form-group"><label>Animation</label><select id="ws-anim"><option value="balanced">Balanced</option><option value="subtle">Subtle</option><option value="expressive">Expressive</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Accent color</label><input id="ws-accent" type="color" value="#f7742a"></div>
        <div class="form-group"><label>Corner style</label><select id="ws-radius"><option value="">Default</option><option value="sharp">Sharp</option><option value="round">Round</option></select></div>
      </div>""",
"""      <div class="form-row">
        <div class="form-group"><label>🎨 Theme (${__wsThemes.length} curated)</label><select id="ws-theme" onchange="themeSwatch()"><option value="">Design default</option>${__wsThemes.map(t=>`<option value="${escAttr(t.id)}">${esc(t.name)}</option>`).join('')}</select><div id="ws-theme-swatch" style="display:flex;gap:4px;margin-top:6px"></div></div>
        <div class="form-group"><label>🏠 Hero style</label><select id="ws-hero"><option value="">Design default</option>${__wsHeroes.map(h=>`<option value="${escAttr(h.id)}">${esc(h.name)}</option>`).join('')}</select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>✨ Entrance animation</label><select id="ws-animpreset"><option value="">Design default</option>${__wsAnims.map(a=>`<option value="${escAttr(a.id)}">${esc(a.name)}</option>`).join('')}</select></div>
        <div class="form-group"><label>🃏 Card style</label><select id="ws-cardstyle"><option value="">Design default</option>${__wsCards.map(c=>`<option value="${escAttr(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>🧭 Nav style</label><select id="ws-navstyle"><option value="">Design default</option>${__wsNavs.map(n=>`<option value="${escAttr(n.id)}">${esc(n.name)}</option>`).join('')}</select></div>
        <div class="form-group"><label>🧊 3D level</label><select id="ws-3d"><option value="off">Off</option><option value="light">Light (CSS 3D)</option><option value="full">Full (3D hero + particles)</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Font</label><select id="ws-font"><option value="system">System (fast)</option><option value="inter">Inter</option><option value="poppins">Poppins</option><option value="playfair">Playfair Display</option><option value="space">Space Grotesk</option><option value="dm">DM Sans</option></select></div>
        <div class="form-group"><label>Animation</label><select id="ws-anim"><option value="balanced">Balanced</option><option value="subtle">Subtle</option><option value="expressive">Expressive</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Accent color</label><input id="ws-accent" type="color" value="#f7742a"></div>
        <div class="form-group"><label>Corner style</label><select id="ws-radius"><option value="">Default</option><option value="sharp">Sharp</option><option value="round">Round</option></select></div>
      </div>
      <div style="font-size:11px;color:var(--text3);margin:-4px 0 8px">💡 ${__wsComboCount.toLocaleString()} possible design combinations — every build is unique.</div>""",
'builder v4 selects')

# ── 2. Load catalogs + swatch + collect + send ──
rep("""let __wsDesigns = [];""",
"""let __wsDesigns = [];
let __wsThemes = []; let __wsHeroes = []; let __wsAnims = []; let __wsCards = []; let __wsNavs = []; let __wsComboCount = 1;
function themeSwatch() {
  const id = V('ws-theme')?.value; const box = V('ws-theme-swatch'); if (!box) return;
  const t = __wsThemes.find(x => x.id === id);
  if (!t || !t.vars) { box.innerHTML = ''; return; }
  box.innerHTML = (t.vars.bg ? `<span style="width:22px;height:22px;border-radius:6px;background:${t.vars.bg};border:1px solid var(--border)" title="bg"></span>` : '')
    + (t.vars.accent ? `<span style="width:22px;height:22px;border-radius:6px;background:${t.vars.accent};border:1px solid var(--border)" title="accent"></span>` : '')
    + (t.vars.teal ? `<span style="width:22px;height:22px;border-radius:6px;background:${t.vars.teal};border:1px solid var(--border)" title="teal"></span>` : '')
    + `<span style="font-size:11px;color:var(--text3);margin-left:4px">${esc(t.name)}</span>`;
}""",
'catalog state + swatch')

rep("""async function openAISiteBuilder(existing) {
  try { const d = await api('/ai/site-designs'); __wsDesigns = d.designs || []; } catch { __wsDesigns = [{ id: 'sentinel', name: 'Bold & Interactive' }]; }""",
"""async function openAISiteBuilder(existing) {
  try { const d = await api('/ai/site-designs'); __wsDesigns = d.designs || []; } catch { __wsDesigns = [{ id: 'sentinel', name: 'Bold & Interactive' }]; }
  try {
    const st = await api('/ai/site-styles');
    __wsThemes = st.themes || []; __wsHeroes = st.heroes || []; __wsAnims = st.anims || [];
    __wsCards = st.cards || []; __wsNavs = st.navs || []; __wsComboCount = st.combo_count || 1;
  } catch { __wsThemes = []; __wsHeroes = []; __wsAnims = []; __wsCards = []; __wsNavs = []; }
  // cache theme vars for the swatch (backend sends vars too)
  try { const t = await api('/ai/site-styles'); } catch {}""",
'load catalogs')

# collect + send in buildSiteWithAI
rep("""  const font = V('ws-font')?.value || '';
  const anim = V('ws-anim')?.value || 'balanced';
  const accent = V('ws-accent')?.value || '';
  const radius = V('ws-radius')?.value || '';
  const customCss = V('ws-css')?.value?.trim() || '';
  const favicon = V('ws-favicon')?.value?.trim() || '';""",
"""  const font = V('ws-font')?.value || '';
  const anim = V('ws-anim')?.value || 'balanced';
  const accent = V('ws-accent')?.value || '';
  const radius = V('ws-radius')?.value || '';
  const customCss = V('ws-css')?.value?.trim() || '';
  const favicon = V('ws-favicon')?.value?.trim() || '';
  const themeId = V('ws-theme')?.value || '';
  const heroStyle = V('ws-hero')?.value || '';
  const animPreset = V('ws-animpreset')?.value || '';
  const cardStyle = V('ws-cardstyle')?.value || '';
  const navStyle = V('ws-navstyle')?.value || '';
  const threeD = V('ws-3d')?.value || 'off';""",
'collect catalog opts')

rep("""        font, animation_level:anim, accent, radius, custom_css:customCss, favicon, sections});""",
"""        font, animation_level:anim, accent, radius, custom_css:customCss, favicon, sections,
        theme_id:themeId, hero_style:heroStyle, anim_preset:animPreset, card_style:cardStyle, nav_style:navStyle, three_d:threeD});""",
'send catalog opts')

# ── 3. siteSettings modal: catalog selects + save ──
rep("""        <div class="form-group"><label>Design</label><select id="ss-design">${__wsDesigns.map(x=>`<option value="${escAttr(x.id)}" ${(th.design_id||r.design_id||'sentinel')===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>""",
"""        <div class="form-group"><label>Design</label><select id="ss-design">${__wsDesigns.map(x=>`<option value="${escAttr(x.id)}" ${(th.design_id||r.design_id||'sentinel')===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
        <div class="form-row">
          <div class="form-group"><label>Theme</label><select id="ss-theme"><option value="">Design default</option>${__wsThemes.map(x=>`<option value="${escAttr(x.id)}" ${th.theme_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Hero</label><select id="ss-hero"><option value="">Default</option>${__wsHeroes.map(x=>`<option value="${escAttr(x.id)}" ${th.hero_style===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Animation</label><select id="ss-animpreset"><option value="">Default</option>${__wsAnims.map(x=>`<option value="${escAttr(x.id)}" ${th.anim_preset===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Cards</label><select id="ss-cardstyle"><option value="">Default</option>${__wsCards.map(x=>`<option value="${escAttr(x.id)}" ${th.card_style===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Nav</label><select id="ss-navstyle"><option value="">Default</option>${__wsNavs.map(x=>`<option value="${escAttr(x.id)}" ${th.nav_style===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label>3D</label><select id="ss-3d"><option value="off" ${(th.three_d||'off')==='off'?'selected':''}>Off</option><option value="light" ${th.three_d==='light'?'selected':''}>Light</option><option value="full" ${th.three_d==='full'?'selected':''}>Full</option></select></div>
        </div>""",
'settings catalog selects')

rep("""  const body = {
    build_with_ai: true, published: true,
    design_id: V('ss-design')?.value || 'sentinel',
    font: V('ss-font')?.value || '', animation_level: V('ss-anim')?.value || 'balanced',
    accent: V('ss-accent')?.value || '', radius: V('ss-radius')?.value || '',
    instructions: V('ss-instr')?.value?.trim() || '',
    custom_css: V('ss-css')?.value?.trim() || '',
    sections: [...document.querySelectorAll('.ss-sec:checked')].map(x => x.value),
  };""",
"""  const body = {
    build_with_ai: true, published: true,
    design_id: V('ss-design')?.value || 'sentinel',
    font: V('ss-font')?.value || '', animation_level: V('ss-anim')?.value || 'balanced',
    accent: V('ss-accent')?.value || '', radius: V('ss-radius')?.value || '',
    instructions: V('ss-instr')?.value?.trim() || '',
    custom_css: V('ss-css')?.value?.trim() || '',
    sections: [...document.querySelectorAll('.ss-sec:checked')].map(x => x.value),
    theme_id: V('ss-theme')?.value || '', hero_style: V('ss-hero')?.value || '',
    anim_preset: V('ss-animpreset')?.value || '', card_style: V('ss-cardstyle')?.value || '',
    nav_style: V('ss-navstyle')?.value || '', three_d: V('ss-3d')?.value || 'off',
  };""",
'settings save catalogs')

# ── 4. local parity: /ai/site-styles ──
rep("""  if (rawPath === '/ai/site-designs' && method === 'GET') {""",
"""  if (rawPath === '/ai/site-styles' && method === 'GET') {
    return { themes: [], heroes: [{ id: 'split', name: 'Split (text + image)' }, { id: 'center', name: 'Centered' }, { id: 'mesh', name: 'Gradient mesh' }, { id: 'kinetic', name: 'Kinetic type' }], anims: [{ id: 'fadeup', name: 'Fade up' }, { id: 'zoom', name: 'Zoom in' }, { id: 'blur', name: 'Blur in' }, { id: 'clip', name: 'Clip up' }], cards: [{ id: 'standard', name: 'Standard' }, { id: 'glass', name: 'Glass' }, { id: 'lift3d', name: '3D lift' }], navs: [{ id: 'glass', name: 'Glass' }, { id: 'underline', name: 'Underline' }], three_d: [{ id: 'off', name: 'Off' }, { id: 'light', name: 'Light (CSS 3D)' }, { id: 'full', name: 'Full (3D hero + particles)' }], combo_count: 4 * 4 * 4 * 3 * 2 * 3 };
  }
  if (rawPath === '/ai/site-designs' && method === 'GET') {""",
'local styles')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 4 frontend done.')
