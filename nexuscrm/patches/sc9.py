#!/usr/bin/env python3
"""Super-cycle A part 3: frontend Websites v2 — design picker, scan & approve flow, instructions."""
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

# ── 1. Websites view: new buttons + design display ──
rep("""    <div class="page-header"><div><div class="page-title">🌐 Websites</div><div class="page-subtitle">AI-built, published sites — hosted free on your backend</div></div><div class="header-actions">
      <button class="btn btn-ai" onclick="openAISiteBuilder()">🤖 Build with AI</button>
      <button class="btn btn-secondary" onclick="openSiteAnalyzer()">🔍 Analyze a Website</button>
    </div></div>""",
"""    <div class="page-header"><div><div class="page-title">🌐 Websites</div><div class="page-subtitle">AI-built, published sites — hosted free on your backend</div></div><div class="header-actions">
      <button class="btn btn-ai" onclick="openAISiteBuilder()">🤖 Build with AI</button>
      <button class="btn btn-gmail" onclick="openSiteScanner()">🔍 Scan & Rebuild a Website</button>
      <button class="btn btn-secondary" onclick="openSiteAnalyzer()">🔬 Analyze a URL</button>
    </div></div>""",
'websites header buttons')

rep("""            <div style="font-weight:700">${esc(si.name)} ${si.published?'<span class="badge badge-green">live</span>':'<span class="badge badge-gray">draft</span>'}</div>
            <div style="font-size:11px;color:var(--text3)">${si.html_size?`${Math.round(si.html_size/1024)} KB • `:''}${timeAgo(si.updated_at)}</div>""",
"""            <div style="font-weight:700">${esc(si.name)} ${si.published?'<span class="badge badge-green">live</span>':'<span class="badge badge-gray">draft</span>'} ${si.design_id?`<span class="badge badge-purple" style="font-size:9px">${esc(si.design_id)}</span>`:''}</div>
            <div style="font-size:11px;color:var(--text3)">${si.html_size?`${Math.round(si.html_size/1024)} KB • `:''}${timeAgo(si.updated_at)}</div>""",
'websites list design badge')

rep("""            <button class="btn btn-secondary btn-sm" onclick="previewSite(${si.id})">👁 Preview</button>""",
"""            <button class="btn btn-secondary btn-sm" onclick="previewSite(${si.id})">👁 Preview</button>
            <button class="btn btn-ai btn-sm" onclick="regenerateSite(${si.id})">🔄 Regenerate</button>""",
'websites regenerate button')

# ── 2. Builder modal v2: design picker + instructions ──
rep("""function openAISiteBuilder(existing) {
  openModal(`<div class="modal-header"><div class="modal-title">🤖 AI Website Builder</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Site name *</label><input id="ws-name" placeholder="e.g. Sarah's Photography" value="${escAttr(existing?.name||'')}"></div>
      <div class="form-group"><label>Describe your business *</label><textarea id="ws-desc" rows="4" placeholder="e.g. Portrait photography studio in Cairo — sessions for families, couples, and professionals, prices from $50, bookings via email"></textarea></div>
      <div class="form-group"><label>Publish immediately</label><label class="toggle-switch"><input type="checkbox" id="ws-pub" checked><span class="toggle-slider"></span></label></div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="buildSiteWithAI()">🤖 Generate Website</button></div>`, 'modal-lg');
}""",
"""let __wsDesigns = [];
async function openAISiteBuilder(existing) {
  try { const d = await api('/ai/site-designs'); __wsDesigns = d.designs || []; } catch { __wsDesigns = [{ id: 'sentinel', name: 'Bold & Interactive' }]; }
  if (!__wsDesigns.length) __wsDesigns = [{ id: 'sentinel', name: 'Bold & Interactive' }];
  openModal(`<div class="modal-header"><div class="modal-title">🤖 AI Website Builder</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Site name *</label><input id="ws-name" placeholder="e.g. Sarah's Photography" value="${escAttr(existing?.name||'')}"></div>
      <div class="form-group"><label>Describe your business *</label><textarea id="ws-desc" rows="3" placeholder="e.g. Portrait photography studio in Cairo — sessions for families, couples, and professionals, prices from $50, bookings via email"></textarea></div>
      <div class="form-group"><label>Design style</label><select id="ws-design">${__wsDesigns.map(d=>`<option value="${escAttr(d.id)}" ${(existing?.design_id||'sentinel')===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Continuous instructions (optional — remembered for every regeneration)</label><textarea id="ws-instr" rows="2" placeholder="e.g. Always mention the free first consultation; keep a friendly tone; highlight the 24/7 emergency line.">${escAttr(existing?.instructions||'')}</textarea></div>
      <div class="form-group"><label>Publish immediately</label><label class="toggle-switch"><input type="checkbox" id="ws-pub" checked><span class="toggle-slider"></span></label></div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="buildSiteWithAI()">🤖 Generate Website</button></div>`, 'modal-lg');
}""",
'builder modal v2')

# ── 3. buildSiteWithAI v2: sends design/instructions/webhook_url ──
rep("""async function buildSiteWithAI() {
  const name = V('ws-name')?.value?.trim(); const desc = V('ws-desc')?.value?.trim();
  if (!name) { toast('Enter a site name','error'); return; }
  if (!desc) { toast('Describe your business','error'); return; }
  toast('AI is building your website — this takes a few seconds...','info',15000);
  const pub = !!V('ws-pub')?.checked;
  try {
    let site;
    try {
      const r = await api('/ai/build-site','POST',{name,description:desc});
      site = await api('/sites','POST',{name,html:r.html,published:pub});
    } catch (e) {
      // local mode (or AI down): starter template still works
      site = { id: 0, slug: 'local-' + Math.random().toString(36).slice(2,8), html: SITE_LOCAL_HTML(name, desc), published: false, name };
      toast('AI unavailable — saved a starter template instead. Connect the backend + an AI key for AI-built sites.','warning',7000);
    }
    closeModal();
    if (site.id || (site.slug && site.slug.startsWith('local-'))) {
      toast(`Website "${name}" is ready! ${pub?'Published ✅':'Saved as draft'}`,'success',5000);
      views.websites();
      setTimeout(()=>{ if (site.id) previewSiteById(site.id, site.html); else previewSiteById(null, site.html); }, 300);
    } else { toast('Could not save the site — try again.','error'); }
  } catch(e) { toast('Website build failed: '+e.message,'error',7000); }
}""",
"""async function buildSiteWithAI() {
  const name = V('ws-name')?.value?.trim(); const desc = V('ws-desc')?.value?.trim();
  if (!name) { toast('Enter a site name','error'); return; }
  if (!desc) { toast('Describe your business','error'); return; }
  toast('AI is building your website — this takes a few seconds...','info',15000);
  const pub = !!V('ws-pub')?.checked;
  const designId = V('ws-design')?.value || 'sentinel';
  const instructions = V('ws-instr')?.value?.trim() || '';
  const webhookUrl = (REAL_MODE() || BACKEND.available) ? (API.replace(/\\/+$/,'').replace(/\\/api$/,'') + '/api/public/webhook/' + (window.__webchatToken || '')) : '';
  try {
    let site;
    try {
      const plan = window.__pendingPlan || null;
      site = await api('/sites','POST',{name,description:desc,published:pub,design_id:designId,instructions,plan,webhook_url:webhookUrl,build_with_ai:true});
      window.__pendingPlan = null;
    } catch (e) {
      site = { id: 0, slug: 'local-' + Math.random().toString(36).slice(2,8), html: SITE_LOCAL_HTML(name, desc), published: false, name };
      toast('AI unavailable — saved a starter template instead. Connect the backend + an AI key for AI-built sites.','warning',7000);
    }
    closeModal();
    if (site.id || (site.slug && site.slug.startsWith('local-'))) {
      toast(`Website "${name}" is ready! ${pub?'Published ✅':'Saved as draft'}`,'success',5000);
      views.websites();
      setTimeout(()=>{ if (site.id) previewSiteById(site.id, site.html); else previewSiteById(null, site.html); }, 300);
    } else { toast('Could not save the site — try again.','error'); }
  } catch(e) { toast('Website build failed: '+e.message,'error',7000); }
}""",
'buildSiteWithAI v2')

# ── 4. Regenerate site ──
rep("""async function publishSite(id) {""",
"""async function regenerateSite(id) {
  try {
    const r = await api(`/sites/${id}/html`);
    // reopen the builder prefilled with name + stored instructions/design
    const d = await api('/sites');
    const site = (d.sites||[]).find(x => x.id === id);
    window.__regenerateSiteId = id;
    openModal(`<div class="modal-header"><div class="modal-title">🔄 Regenerate — ${esc(site?.name||'')}</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        <div class="ai-insight" style="margin-bottom:12px"><div class="ai-insight-title">Regenerate with the same design + content plan</div><div class="ai-insight-text">The AI rebuilds the site using its saved design, content plan and your continuous instructions — useful after you change the instructions below.</div></div>
        <div class="form-group"><label>Continuous instructions (saved with this site)</label><textarea id="rg-instr" rows="3">${escAttr(r.instructions||'')}</textarea></div>
        <div class="form-group"><label>New instruction to add (optional)</label><input id="rg-add" placeholder="e.g. Add a section about our awards"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doRegenerateSite(${id})">🔄 Regenerate</button></div>`, 'modal-lg');
  } catch(e) { toast(e.message,'error'); }
}
async function doRegenerateSite(id) {
  const instr = V('rg-instr')?.value?.trim() || '';
  const add = V('rg-add')?.value?.trim() || '';
  const final = add ? (instr ? instr + '\\n' + add : add) : instr;
  toast('Regenerating with your instructions...','info',20000);
  try {
    await api(`/sites/${id}`,'PATCH',{ build_with_ai: true, instructions: final, published: true });
    closeModal(); toast('Website regenerated ✅','success',5000); views.websites();
  } catch(e) { toast('Regenerate failed: '+e.message,'error'); }
}
async function publishSite(id) {""",
'regenerate site')

# ── 5. Scanner UI + approve flow ──
rep("""// Website analyzer (audits any URL)""",
"""// ════════════════════════════════════════════════════════════
// WEBSITE SCANNER — scan an existing client site → approve content → rebuild modern
// ════════════════════════════════════════════════════════════
function openSiteScanner() {
  openModal(`<div class="modal-header"><div class="modal-title">🔍 Scan & Rebuild a Website</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="ai-insight" style="margin-bottom:12px"><div class="ai-insight-title">How it works</div><div class="ai-insight-text">1) Paste your client's OLD website URL. 2) The AI reads it — services, working hours, phone, email, images, text — and plans a modern rebuild. 3) You approve or tweak the plan. 4) We generate a brand-new, animated, mobile-friendly site with their real content.</div></div>
      <div class="form-group"><label>Client website URL</label><input id="scan-url" placeholder="https://their-old-website.com" onkeydown="if(event.key==='Enter')doScanSite()"></div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px">Needs the deployed backend (the worker fetches the site server-side).</div>
      <div id="scan-status"></div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-gmail" onclick="doScanSite()">🔍 Scan Website</button></div>`);
}
async function doScanSite() {
  const url = V('scan-url')?.value?.trim();
  if (!url) { toast('Enter the website URL','error'); return; }
  const st = V('scan-status');
  if (st) st.innerHTML = '<div class="loading"><div class="spinner"></div>Fetching & analyzing the site — takes ~10-20s...</div>';
  try {
    const r = await api('/ai/scan-site','POST',{ url });
    const ex = r.extracted || {}; const plan = r.plan || {};
    window.__scanResult = r;
    if (!st) return;
    const planHtml = plan.site_name ? `
      <div style="margin-top:10px;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.3);border-radius:10px;padding:12px;font-size:12px;color:var(--green)">✅ AI content plan ready — site "<b>${esc(plan.site_name)}</b>" (${(plan.services||[]).length} services, ${(plan.faqs||[]).length} FAQs, hours: ${esc((plan.working_hours||[]).join(', ')||'—')})</div>` : '';
    st.innerHTML = `<div style="font-size:13px;line-height:1.7;color:var(--text2);max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:12px">
      <div style="font-weight:700;margin-bottom:6px">📄 Found: ${esc(ex.title||'untitled site')}</div>
      <div>🕒 Hours: ${esc((ex.working_hours||[]).join(', ')||'—')}</div>
      <div>📞 Phone: ${esc(ex.phone||'—')} • ✉️ Email: ${esc(ex.email||'—')}</div>
      <div>🖼️ Images: ${(ex.images||[]).length} • 📝 Paragraphs: ${(ex.paragraphs||[]).length} • Links: ${(ex.links||[]).length}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:4px">${esc((ex.paragraphs||[]).slice(0,2).join(' ').slice(0,220))}</div>
      ${planHtml}
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="approveScanAndBuild()">✅ Approve & Build New Site</button>
      <button class="btn btn-secondary" onclick="editScanPlan()">✎ Review / Edit Plan</button>
      <button class="btn btn-secondary" onclick="doScanSite()">🔄 Rescan</button>
    </div>`;
  } catch(e) {
    if (st) st.innerHTML = `<div style="color:var(--red);font-size:13px;margin-top:8px">⚠️ ${esc(e.message)}</div>`;
  }
}
function approveScanAndBuild() {
  const r = window.__scanResult;
  if (!r) return;
  window.__pendingPlan = r.plan || null;
  closeModal();
  openAISiteBuilder({ name: (r.plan && r.plan.site_name) || (r.extracted && r.extracted.title) || 'Rebuilt Website' });
}
function editScanPlan() {
  const r = window.__scanResult; if (!r) return;
  const planJson = JSON.stringify(r.plan || {}, null, 2);
  openModal(`<div class="modal-header"><div class="modal-title">✎ Review Content Plan</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="ai-insight" style="margin-bottom:10px"><div class="ai-insight-title">Approve or edit</div><div class="ai-insight-text">This is what the new site will contain. Edit the JSON if anything is wrong (e.g. fix the phone number or hours), then click Approve. Facts must stay accurate — the AI copies them exactly.</div></div>
      <textarea id="plan-edit" style="width:100%;min-height:340px;font-family:monospace;font-size:11px;background:var(--bg);color:var(--text2);border:1px solid var(--border);border-radius:8px;padding:10px">${escAttr(planJson)}</textarea>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveEditedPlan()">✅ Approve Plan</button></div>`, 'modal-xl');
}
function saveEditedPlan() {
  try {
    const parsed = JSON.parse(V('plan-edit')?.value || '{}');
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid JSON');
    window.__scanResult.plan = parsed;
    window.__pendingPlan = parsed;
    closeModal();
    openAISiteBuilder({ name: parsed.site_name || 'Rebuilt Website' });
  } catch(e) { toast('Plan is not valid JSON: '+e.message,'error'); }
}

// Website analyzer (audits any URL)""",
'scanner UI')

open(P, 'w', encoding='utf-8').write(s)
print('SC-A frontend done.')
