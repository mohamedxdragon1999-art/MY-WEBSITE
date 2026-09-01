#!/usr/bin/env python3
"""Frontend batch 10: Websites view (AI site builder), Image AI, Site Analyzer hub tools."""
import sys
P = 'NexusCRM_V4_Hardened.html'
s = open(P, encoding='utf-8').read()

def rep(old, new, count=1, tag=''):
    global s
    n = s.count(old)
    if n != count:
        print(f'❌ [{tag}] expected {count}, found {n}'); print('   OLD:', repr(old[:110])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

# ── 1. Sidebar: add Websites + Webchat nav items ──
rep("""  <div class="nav-item" data-view="funnels" onclick="navigate('funnels')"><span class="nav-icon">🔻</span><span class="nav-label">Funnels</span></div>
  <div class="nav-item" data-view="forms" onclick="navigate('forms')"><span class="nav-icon">📝</span><span class="nav-label">Forms</span></div>""",
"""  <div class="nav-item" data-view="funnels" onclick="navigate('funnels')"><span class="nav-icon">🔻</span><span class="nav-label">Funnels</span></div>
  <div class="nav-item" data-view="forms" onclick="navigate('forms')"><span class="nav-icon">📝</span><span class="nav-label">Forms</span></div>
  <div class="nav-item" data-view="websites" onclick="navigate('websites')"><span class="nav-icon">🌐</span><span class="nav-label">Websites</span><span class="nav-ai-badge">AI</span></div>
  <div class="nav-item" data-view="webchat" onclick="navigate('webchat')"><span class="nav-icon">💬</span><span class="nav-label">Webchat Widget</span></div>""",
tag='sidebar websites/webchat')

# ── 2. VIEW_TITLES ──
rep("""  social:'Social Media', funnels:'Funnels', forms:'Forms',""",
"""  social:'Social Media', funnels:'Funnels', forms:'Forms', websites:'🌐 Websites', webchat:'💬 Webchat Widget',""",
tag='view titles')

# ── 3. Websites view + handlers (insert before community view) ──
rep("""views.community = async function() {""",
r'''// ════════════════════════════════════════════════════════════
// WEBSITES — AI website builder + publishing
// ════════════════════════════════════════════════════════════
const SITE_LOCAL_HTML = (name, desc) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(name||'My Site')}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;color:#1e293b;line-height:1.6;background:#f8fafc}
header{background:linear-gradient(135deg,#4f46e5,#9333ea);color:#fff;padding:72px 20px;text-align:center;animation:fadeIn 1s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
header h1{margin:0 0 10px;font-size:42px}header p{font-size:18px;opacity:.92}
.btn{display:inline-block;margin-top:20px;padding:12px 28px;background:#fff;color:#4f46e5;font-weight:700;border-radius:8px;text-decoration:none;transition:.2s}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.15)}
section{max-width:900px;margin:0 auto;padding:48px 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;transition:.25s}
.card:hover{transform:translateY(-4px);box-shadow:0 10px 30px rgba(79,70,229,.12)}
footer{background:#0f172a;color:#94a3b8;text-align:center;padding:24px}</style></head><body>
<header><h1>${esc(name||'Welcome')}</h1><p>${esc(desc||'We build great things.')}</p><a class="btn" href="#contact">Get Started</a></header>
<section><h2>What we do</h2><div class="grid">
<div class="card"><h3>Service One</h3><p>Describe your first offering here.</p></div>
<div class="card"><h3>Service Two</h3><p>Describe your second offering here.</p></div>
<div class="card"><h3>Service Three</h3><p>Describe your third offering here.</p></div>
</div></section>
<section id="contact"><h2>Contact</h2><p>Email: <a href="mailto:hello@yourdomain.com">hello@yourdomain.com</a></p></section>
<footer>© ${new Date().getFullYear()} ${esc(name||'Your Brand')} — built with NexusCRM</footer></body></html>`;

views.websites = async function() {
  const d = await api('/sites').catch(()=>({sites:[]}));
  const sites = d.sites||[];
  const pubBase = API.replace(/\/+$/,'').replace(/\/api$/,'');
  content(`
    <div class="page-header"><div><div class="page-title">🌐 Websites</div><div class="page-subtitle">AI-built, published sites — hosted free on your backend</div></div><div class="header-actions">
      <button class="btn btn-ai" onclick="openAISiteBuilder()">🤖 Build with AI</button>
      <button class="btn btn-secondary" onclick="openSiteAnalyzer()">🔍 Analyze a Website</button>
    </div></div>
    ${sites.length ? `<div style="display:flex;flex-direction:column;gap:14px">${sites.map(si=>`
      <div class="card">
        <div style="display:flex;align-items:center;gap:14px">
          <div style="width:44px;height:44px;background:linear-gradient(135deg,var(--accent3),var(--green));border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🌐</div>
          <div style="flex:1">
            <div style="font-weight:700">${esc(si.name)} ${si.published?'<span class="badge badge-green">live</span>':'<span class="badge badge-gray">draft</span>'}</div>
            <div style="font-size:11px;color:var(--text3)">${si.html_size?`${Math.round(si.html_size/1024)} KB • `:''}${timeAgo(si.updated_at)}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" onclick="previewSite(${si.id})">👁 Preview</button>
            ${si.published?`<button class="btn btn-success btn-sm" onclick="copySiteLink('${escAttr(si.slug)}')">🔗 Copy Link</button>`:`<button class="btn btn-secondary btn-sm" onclick="publishSite(${si.id})">🚀 Publish</button>`}
            <button class="btn btn-danger btn-sm" onclick="deleteSite(${si.id})">✕</button>
          </div>
        </div>
      </div>`).join('')}</div>` : `
      <div class="empty-state"><div class="empty-icon">🌐</div><div class="empty-title">No websites yet</div><div class="empty-text">Describe your business in one sentence and AI will build you a complete, professional website — preview it here, then publish it at your own public link.</div><button class="btn btn-ai" style="margin-top:12px" onclick="openAISiteBuilder()">🤖 Build My Website with AI</button></div>`}
    <div class="ai-insight" style="margin-top:16px"><div class="ai-insight-title">💡 How it works</div><div class="ai-insight-text">1) Describe your business → AI writes the full HTML. 2) Preview it right here. 3) Publish → get a public URL like ${escAttr(pubBase)}/api/public/site/your-slug to share or embed anywhere. Websites need the deployed backend; in local-only mode you still get an AI-free starter template to preview.</div></div>
  `);
};
function openAISiteBuilder(existing) {
  openModal(`<div class="modal-header"><div class="modal-title">🤖 AI Website Builder</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Site name *</label><input id="ws-name" placeholder="e.g. Sarah's Photography" value="${escAttr(existing?.name||'')}"></div>
      <div class="form-group"><label>Describe your business *</label><textarea id="ws-desc" rows="4" placeholder="e.g. Portrait photography studio in Cairo — sessions for families, couples, and professionals, prices from $50, bookings via email"></textarea></div>
      <div class="form-group"><label>Publish immediately</label><label class="toggle-switch"><input type="checkbox" id="ws-pub" checked><span class="toggle-slider"></span></label></div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="buildSiteWithAI()">🤖 Generate Website</button></div>`, 'modal-lg');
}
async function buildSiteWithAI() {
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
}
async function previewSite(id) {
  try {
    const r = await api(`/sites/${id}/html`);
    previewSiteById(id, r.html);
  } catch(e) { toast(e.message,'error'); }
}
function previewSiteById(id, html) {
  openModal(`<div class="modal-header"><div class="modal-title">👁 Preview</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body" style="padding:0"><iframe sandbox="allow-scripts allow-forms" style="width:100%;height:70vh;border:none;border-radius:0 0 12px 12px;background:#fff" srcdoc="${escAttr(html||'')}"></iframe></div>`,'modal-xl');
}
async function publishSite(id) {
  try { await api(`/sites/${id}`,'PATCH',{published:true}); toast('Website published! 🚀','success'); views.websites(); }
  catch(e){ toast(e.message,'error'); }
}
async function deleteSite(id) {
  if(!confirm('Delete this website?')) return;
  try { await api(`/sites/${id}`,'DELETE'); toast('Deleted','success'); views.websites(); } catch(e){ toast(e.message,'error'); }
}
function copySiteLink(slug) {
  const pubBase = API.replace(/\/+$/,'').replace(/\/api$/,'');
  const link = pubBase + '/api/public/site/' + slug;
  navigator.clipboard?.writeText(link).then(()=>toast('Public link copied — share it anywhere! ✅','success')).catch(()=>toast(link,'info',9000));
}
// Website analyzer (audits any URL)
function openSiteAnalyzer() {
  openModal(`<div class="modal-header"><div class="modal-title">🔍 AI Website Analyzer</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="ai-insight" style="margin-bottom:12px"><div class="ai-insight-title">What it does</div><div class="ai-insight-text">Paste any URL (yours or a competitor's) — the AI audits SEO, message clarity, call-to-action strength, trust signals and structure, then gives you a scored verdict and the top 5 fixes ranked by impact.</div></div>
      <div class="form-group"><label>Website URL</label><input id="sa-url" placeholder="https://your-site.com"></div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doSiteAnalyze()">🔍 Analyze</button></div>`);
}
async function doSiteAnalyze() {
  const url = V('sa-url')?.value?.trim(); if (!url) { toast('Enter a URL','error'); return; }
  toast('Fetching & analyzing the site...','info',12000);
  try {
    const r = await api('/ai/analyze-site','POST',{url});
    closeModal();
    openModal(`<div class="modal-header"><div class="modal-title">🔍 Analysis: ${esc(url)}</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2);max-height:70vh;overflow-y:auto">${esc(r.content)}</div></div>`, 'modal-xl');
  } catch(e) { toast('Analysis failed: '+e.message,'error',7000); }
}

views.community = async function() {''',
tag='websites view')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 10 (part 1) done.')
