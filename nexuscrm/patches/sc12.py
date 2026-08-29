#!/usr/bin/env python3
"""Batch D (cycles 25-32): device preview, plan summary, design thumbnails, publish toggle, local parity."""
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

# ── C25: device preview toggle ──
rep("""function previewSiteById(id, html) {
  openModal(`<div class="modal-header"><div class="modal-title">👁 Preview</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body" style="padding:0"><iframe sandbox="allow-scripts allow-forms" style="width:100%;height:70vh;border:none;border-radius:0 0 12px 12px;background:#fff" srcdoc="${escAttr(html||'')}"></iframe></div>`,'modal-xl');
}""",
"""function previewSiteById(id, html) {
  openModal(`<div class="modal-header"><div class="modal-title">👁 Preview</div><div class="header-actions" style="display:flex;gap:6px">
    <button class="btn btn-secondary btn-sm" onclick="setPreviewWidth('100%')">🖥 Desktop</button>
    <button class="btn btn-secondary btn-sm" onclick="setPreviewWidth('420px')">📱 Mobile</button>
    <button class="btn btn-secondary btn-sm" onclick="setPreviewWidth('768px')">📟 Tablet</button>
  </div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body" style="padding:0"><iframe id="site-preview-frame" sandbox="allow-scripts allow-forms" style="width:100%;height:70vh;border:none;border-radius:0 0 12px 12px;background:#fff;transition:width .3s" srcdoc="${escAttr(html||'')}"></iframe></div>`,'modal-xl');
}
function setPreviewWidth(w) {
  const f = V('site-preview-frame');
  if (f) { f.style.width = w; f.style.margin = '0 auto'; f.style.display = 'block'; }
}""",
'device preview')

# ── C26: readable plan summary before building ──
rep("""function editScanPlan() {
  const r = window.__scanResult; if (!r) return;
  const planJson = JSON.stringify(r.plan || {}, null, 2);""",
"""function showPlanSummary() {
  const r = window.__scanResult; if (!r) return;
  const p = r.plan || {};
  const rows = [];
  if (p.hero_headline) rows.push(['Hero headline', p.hero_headline]);
  if (p.hero_sub) rows.push(['Hero subtitle', p.hero_sub]);
  if (Array.isArray(p.services) && p.services.length) rows.push(['Services', p.services.map(s => `${s.icon||''} ${s.title}: ${s.desc}`.trim()).join(' • ')]);
  if (Array.isArray(p.working_hours) && p.working_hours.length) rows.push(['Working hours', p.working_hours.join(' • ')]);
  if (p.contact && (p.contact.phone || p.contact.email)) rows.push(['Contact', `${p.contact.phone||''} ${p.contact.email||''} ${p.contact.address||''}`.trim()]);
  if (Array.isArray(p.faqs) && p.faqs.length) rows.push(['FAQs', p.faqs.map(f => f.q).join(' • ')]);
  if (Array.isArray(p.reviews) && p.reviews.length) rows.push(['Reviews', p.reviews.map(v => `${v.name}: ${v.text}`).join(' • ')]);
  if (Array.isArray(p.gallery_imgs) && p.gallery_imgs.length) rows.push(['Images', p.gallery_imgs.length + ' image(s)']);
  openModal(`<div class="modal-header"><div class="modal-title">📋 Content Plan — ${esc(p.site_name||'')}</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div style="display:flex;flex-direction:column;gap:10px;max-height:420px;overflow-y:auto">
        ${rows.map(([k,v])=>`<div class="card card-sm"><div style="font-weight:700;font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${esc(k)}</div><div style="font-size:13px;color:var(--text2);line-height:1.6">${esc(String(v).slice(0,400))}</div></div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="closeModal();approveScanAndBuild()">✅ Approve & Build</button>
        <button class="btn btn-secondary" onclick="closeModal();editScanPlan()">✎ Edit Plan (JSON)</button>
      </div>
    </div>`, 'modal-lg');
}
function editScanPlan() {
  const r = window.__scanResult; if (!r) return;
  const planJson = JSON.stringify(r.plan || {}, null, 2);""",
'plan summary')

rep("""      <button class="btn btn-primary" onclick="approveScanAndBuild()">✅ Approve & Build New Site</button>
      <button class="btn btn-secondary" onclick="editScanPlan()">✎ Review / Edit Plan</button>
      <button class="btn btn-secondary" onclick="doScanSite()">🔄 Rescan</button>""",
"""      <button class="btn btn-primary" onclick="showPlanSummary()">✅ Approve & Build New Site</button>
      <button class="btn btn-secondary" onclick="editScanPlan()">✎ Edit Plan (JSON)</button>
      <button class="btn btn-secondary" onclick="doScanSite()">🔄 Rescan</button>""",
'scan actions')

# ── C27: design picker thumbnails (colored swatches) ──
rep("""      <div class="form-group"><label>Design style</label><select id="ws-design">${__wsDesigns.map(d=>`<option value="${escAttr(d.id)}" ${(existing?.design_id||'sentinel')===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select></div>""",
"""      <div class="form-group"><label>Design style</label><select id="ws-design" onchange="designSwatch()">${__wsDesigns.map(d=>`<option value="${escAttr(d.id)}" ${(existing?.design_id||'sentinel')===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select>
      <div id="ws-design-swatch" style="display:flex;gap:6px;margin-top:6px"></div></div>""",
'design swatch ui')

rep("""let __wsDesigns = [];""",
"""let __wsDesigns = [];
const DESIGN_SWATCHES = { sentinel: ['#0b0e14', '#f7742a', '#2fb3a2'], aurora: ['#f7f9fc', '#4f46e5', '#06b6d4'], slate: ['#0a0c10', '#5b8def', '#7ee2d0'] };
function designSwatch() {
  const id = V('ws-design')?.value || 'sentinel';
  const colors = DESIGN_SWATCHES[id] || DESIGN_SWATCHES.sentinel;
  const box = V('ws-design-swatch'); if (!box) return;
  box.innerHTML = colors.map(c => `<span style="width:26px;height:26px;border-radius:8px;background:${c};border:2px solid var(--border);display:inline-block"></span>`).join('')
    + `<span style="font-size:11px;color:var(--text3);margin-left:6px">${esc((__wsDesigns.find(d=>d.id===id)||{}).name||id)}</span>`;
}
""",
'design swatch fn')

rep("""async function openAISiteBuilder(existing) {
  try { const d = await api('/ai/site-designs'); __wsDesigns = d.designs || []; } catch { __wsDesigns = [{ id: 'sentinel', name: 'Bold & Interactive' }]; }""",
"""async function openAISiteBuilder(existing) {
  try { const d = await api('/ai/site-designs'); __wsDesigns = d.designs || []; } catch { __wsDesigns = [{ id: 'sentinel', name: 'Bold & Interactive' }]; }
  setTimeout(() => designSwatch(), 60);""",
'design swatch init')

# ── C28: publish/unpublish toggle + local parity ──
rep("""            ${si.published?`<button class="btn btn-success btn-sm" onclick="copySiteLink('${escAttr(si.slug)}')">🔗 Copy Link</button>`:`<button class="btn btn-secondary btn-sm" onclick="publishSite(${si.id})">🚀 Publish</button>`}""",
"""            ${si.published?`<button class="btn btn-success btn-sm" onclick="copySiteLink('${escAttr(si.slug)}')">🔗 Copy Link</button><button class="btn btn-secondary btn-sm" onclick="unpublishSite(${si.id})">⏸ Unpublish</button>`:`<button class="btn btn-secondary btn-sm" onclick="publishSite(${si.id})">🚀 Publish</button>`}""",
'publish toggle')

rep("""async function publishSite(id) {""",
"""async function unpublishSite(id) {
  try { await api(`/sites/${id}`,'PATCH',{published:false}); toast('Site unpublished','info'); views.websites(); }
  catch(e){ toast(e.message,'error'); }
}
async function publishSite(id) {""",
'unpublish fn')

# ── C29-32: local parity for designs + graceful scan error ──
rep("""  if (rawPath === '/ai/tone-remix' && method === 'POST') {""",
"""  if (rawPath === '/ai/site-designs' && method === 'GET') {
    return { designs: [{ id: 'sentinel', name: 'Bold & Interactive (Sentinel style)' }, { id: 'aurora', name: 'Aurora (light, airy, gradient)' }, { id: 'slate', name: 'Slate (dark, minimal, elegant)' }] };
  }
  if (rawPath === '/ai/scan-site' && method === 'POST') {
    throw new Error('Website scanning needs the deployed backend (the worker fetches the site server-side). Use Build with AI + describe the business instead.');
  }
  if (rawPath === '/ai/tone-remix' && method === 'POST') {""",
'local designs/scan')

open(P, 'w', encoding='utf-8').write(s)
print('Frontend batch D done.')
