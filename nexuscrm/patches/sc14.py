#!/usr/bin/env python3
"""Batch C (cycles 25-36): builder v3 theme controls, site settings modal, export, duplicate."""
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

# ── 1. Builder modal v3: theme controls ──
rep("""      <div class="form-group"><label>Continuous instructions (optional — remembered for every regeneration)</label><textarea id="ws-instr" rows="2" placeholder="e.g. Always mention the free first consultation; keep a friendly tone; highlight the 24/7 emergency line.">${escAttr(existing?.instructions||'')}</textarea></div>
      <div class="form-group"><label>Publish immediately</label><label class="toggle-switch"><input type="checkbox" id="ws-pub" checked><span class="toggle-slider"></span></label></div>""",
"""      <div class="form-group"><label>Continuous instructions (optional — remembered for every regeneration)</label><textarea id="ws-instr" rows="2" placeholder="e.g. Always mention the free first consultation; keep a friendly tone; highlight the 24/7 emergency line.">${escAttr(existing?.instructions||'')}</textarea></div>
      <div class="form-row">
        <div class="form-group"><label>Font</label><select id="ws-font"><option value="system">System (fast)</option><option value="inter">Inter</option><option value="poppins">Poppins</option><option value="playfair">Playfair Display</option><option value="space">Space Grotesk</option><option value="dm">DM Sans</option></select></div>
        <div class="form-group"><label>Animation</label><select id="ws-anim"><option value="balanced">Balanced</option><option value="subtle">Subtle</option><option value="expressive">Expressive</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Accent color</label><input id="ws-accent" type="color" value="#f7742a"></div>
        <div class="form-group"><label>Corner style</label><select id="ws-radius"><option value="">Default</option><option value="sharp">Sharp</option><option value="round">Round</option></select></div>
      </div>
      <div class="form-group"><label>Sections (uncheck to hide)</label><div id="ws-sections" style="display:flex;flex-wrap:wrap;gap:6px"></div></div>
      <div class="form-group"><label>Custom CSS (advanced — appended to the design)</label><textarea id="ws-css" rows="2" placeholder="e.g. .nx-hero h1{letter-spacing:-.04em} .nx-card{border-radius:10px}"></textarea></div>
      <div class="form-group"><label>Favicon emoji</label><input id="ws-favicon" maxlength="4" value="🚀" style="max-width:90px"></div>
      <div class="form-group"><label>Publish immediately</label><label class="toggle-switch"><input type="checkbox" id="ws-pub" checked><span class="toggle-slider"></span></label></div>""",
'builder v3 controls')

# section toggles population
rep("""  setTimeout(() => designSwatch(), 60);""",
"""  setTimeout(() => designSwatch(), 60);
  setTimeout(() => {
    const box = V('ws-sections'); if (!box) return;
    const all = ['nav','hero','marquee','stats','services','why','about','process','parallax','gallery','reviews','pricing','team','timeline','logos','video','lead','faq','contact','map','footer'];
    box.innerHTML = all.map(sec => `<label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text2);background:var(--card2);padding:4px 8px;border-radius:8px;cursor:pointer"><input type="checkbox" class="ws-sec" value="${sec}" checked> ${sec}</label>`).join('');
  }, 80);""",
'section toggles init')

# buildSiteWithAI v3: collect all opts
rep("""  const pub = !!V('ws-pub')?.checked;
  const designId = V('ws-design')?.value || 'sentinel';
  const instructions = V('ws-instr')?.value?.trim() || '';
  let webhookUrl = '';""",
"""  const pub = !!V('ws-pub')?.checked;
  const designId = V('ws-design')?.value || 'sentinel';
  const instructions = V('ws-instr')?.value?.trim() || '';
  const font = V('ws-font')?.value || '';
  const anim = V('ws-anim')?.value || 'balanced';
  const accent = V('ws-accent')?.value || '';
  const radius = V('ws-radius')?.value || '';
  const customCss = V('ws-css')?.value?.trim() || '';
  const favicon = V('ws-favicon')?.value?.trim() || '';
  const sections = [...document.querySelectorAll('.ws-sec:checked')].map(x => x.value);
  let webhookUrl = '';""",
'collect theme opts')

rep("""      site = await api('/sites','POST',{name,description:desc,published:pub,design_id:designId,instructions,plan,webhook_url:webhookUrl,build_with_ai:true});""",
"""      site = await api('/sites','POST',{name,description:desc,published:pub,design_id:designId,instructions,plan,webhook_url:webhookUrl,build_with_ai:true,
        font, animation_level:anim, accent, radius, custom_css:customCss, favicon, sections});""",
'build sends theme')

# ── 2. Sites list: settings + duplicate + export buttons ──
rep("""            <button class="btn btn-secondary btn-sm" onclick="previewSite(${si.id})">👁 Preview</button>
            <button class="btn btn-ai btn-sm" onclick="regenerateSite(${si.id})">🔄 Regenerate</button>""",
"""            <button class="btn btn-secondary btn-sm" onclick="previewSite(${si.id})">👁 Preview</button>
            <button class="btn btn-secondary btn-sm" onclick="siteSettings(${si.id})">⚙️ Settings</button>
            <button class="btn btn-secondary btn-sm" onclick="exportSite(${si.id})">⬇️ Export</button>
            <button class="btn btn-secondary btn-sm" onclick="duplicateSite(${si.id})">📄 Copy</button>
            <button class="btn btn-ai btn-sm" onclick="regenerateSite(${si.id})">🔄 Regenerate</button>""",
'site action buttons')

# ── 3. siteSettings + export + duplicate implementations ──
rep("""async function regenerateSite(id) {""",
"""// ── Site settings: edit theme + instructions + custom css, then regenerate ──
async function siteSettings(id) {
  try {
    const r = await api(`/sites/${id}/html`);
    const d = await api('/sites');
    const site = (d.sites||[]).find(x => x.id === id);
    const th = r.theme || {};
    const secs = Array.isArray(th.sections) && th.sections.length ? th.sections : ['nav','hero','marquee','stats','services','why','about','process','parallax','gallery','reviews','pricing','team','timeline','logos','video','lead','faq','contact','map','footer'];
    const allSecs = ['nav','hero','marquee','stats','services','why','about','process','parallax','gallery','reviews','pricing','team','timeline','logos','video','lead','faq','contact','map','footer'];
    openModal(`<div class="modal-header"><div class="modal-title">⚙️ Site Settings — ${esc(site?.name||'')}</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        <div class="form-group"><label>Design</label><select id="ss-design">${__wsDesigns.map(x=>`<option value="${escAttr(x.id)}" ${(th.design_id||r.design_id||'sentinel')===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
        <div class="form-row">
          <div class="form-group"><label>Font</label><select id="ss-font"><option value="system">System</option><option value="inter">Inter</option><option value="poppins">Poppins</option><option value="playfair">Playfair Display</option><option value="space">Space Grotesk</option><option value="dm">DM Sans</option></select></div>
          <div class="form-group"><label>Animation</label><select id="ss-anim"><option value="balanced">Balanced</option><option value="subtle">Subtle</option><option value="expressive">Expressive</option></select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Accent</label><input id="ss-accent" type="color" value="${escAttr(th.accent||'#f7742a')}"></div>
          <div class="form-group"><label>Corners</label><select id="ss-radius"><option value="">Default</option><option value="sharp">Sharp</option><option value="round">Round</option></select></div>
        </div>
        <div class="form-group"><label>Sections</label><div style="display:flex;flex-wrap:wrap;gap:6px">${allSecs.map(sec=>`<label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text2);background:var(--card2);padding:4px 8px;border-radius:8px;cursor:pointer"><input type="checkbox" class="ss-sec" value="${sec}" ${secs.includes(sec)?'checked':''}> ${sec}</label>`).join('')}</div></div>
        <div class="form-group"><label>Continuous instructions</label><textarea id="ss-instr" rows="2">${escAttr(r.instructions||'')}</textarea></div>
        <div class="form-group"><label>Custom CSS</label><textarea id="ss-css" rows="2" placeholder=".nx-hero h1{...}">${escAttr(r.custom_css||'')}</textarea></div>
        <div class="ai-insight"><div class="ai-insight-text">Saving regenerates the whole site with these settings (keeps your content plan and images).</div></div>
      </div>
      <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="saveSiteSettings(${id})">💾 Save & Regenerate</button></div>`, 'modal-xl');
    // prefill
    V('ss-font').value = th.font || 'system';
    V('ss-anim').value = th.animation_level || 'balanced';
    V('ss-radius').value = th.radius || '';
    if (r.design_id && __wsDesigns.some(x=>x.id===r.design_id)) V('ss-design').value = r.design_id;
  } catch(e) { toast(e.message,'error'); }
}
async function saveSiteSettings(id) {
  const body = {
    build_with_ai: true, published: true,
    design_id: V('ss-design')?.value || 'sentinel',
    font: V('ss-font')?.value || '', animation_level: V('ss-anim')?.value || 'balanced',
    accent: V('ss-accent')?.value || '', radius: V('ss-radius')?.value || '',
    instructions: V('ss-instr')?.value?.trim() || '',
    custom_css: V('ss-css')?.value?.trim() || '',
    sections: [...document.querySelectorAll('.ss-sec:checked')].map(x => x.value),
  };
  toast('Regenerating with new settings...','info',20000);
  try {
    await api(`/sites/${id}`,'PATCH', body);
    closeModal(); toast('Site updated ✅','success',5000); views.websites();
  } catch(e) { toast('Update failed: '+e.message,'error'); }
}
// ── Export: download the site's HTML as a file ──
async function exportSite(id) {
  try {
    const r = await api(`/sites/${id}/html`);
    const d = await api('/sites');
    const site = (d.sites||[]).find(x => x.id === id);
    const blob = new Blob([r.html || ''], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (site?.name || 'website').replace(/[^a-z0-9-_]/gi, '-').toLowerCase() + '.html';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    toast('Website exported — you can host it anywhere! ⬇️','success',5000);
  } catch(e) { toast('Export failed: '+e.message,'error'); }
}
// ── Duplicate: copy the site (html + settings) under a new name ──
async function duplicateSite(id) {
  try {
    const r = await api(`/sites/${id}/html`);
    const d = await api('/sites');
    const site = (d.sites||[]).find(x => x.id === id);
    if (!site) return;
    const copy = await api('/sites','POST',{ name: (site.name||'Website') + ' (copy)', html: r.html, published: false });
    if (copy && copy.id) {
      // copy settings too
      await api(`/sites/${copy.id}`,'PATCH',{ design_id: r.design_id || 'sentinel', instructions: r.instructions || '', accent: (r.theme||{}).accent || '', font: (r.theme||{}).font || '', animation_level: (r.theme||{}).animation_level || '', radius: (r.theme||{}).radius || '', sections: (r.theme||{}).sections || undefined });
      toast('Site duplicated (draft) 📄','success'); views.websites();
    }
  } catch(e) { toast('Duplicate failed: '+e.message,'error'); }
}
async function regenerateSite(id) {""",
'site settings + export + duplicate')

open(P, 'w', encoding='utf-8').write(s)
print('Batch C frontend done.')
