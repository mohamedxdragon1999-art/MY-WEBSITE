#!/usr/bin/env python3
"""Batch 6: real implementations for funnels, forms, courses, affiliates, community, reports."""
import sys
P = 'NexusCRM_V4_Hardened.html'
s = open(P, encoding='utf-8').read()

def repBlock(start, end, new, tag):
    """Replace everything from start (inclusive) to end (inclusive of end) with new."""
    global s
    i = s.find(start)
    if i < 0:
        print(f'❌ [{tag}] start anchor not found: {start[:60]!r}'); sys.exit(1)
    j = s.find(end, i + len(start))
    if j < 0:
        print(f'❌ [{tag}] end anchor not found: {end[:60]!r}'); sys.exit(1)
    j += len(end)
    s = s[:i] + new + s[j:]
    print(f'  ✅ [{tag}]')

# ══════════════ FUNNELS — real CRUD ══════════════
repBlock(
"views.funnels = function() {",
"async function aiOptimizeFunnel(name) { toast('Analyzing...','info'); try{const r=await api('/ai/complete','POST',{prompt:`Give 5 specific optimizations for a \"${name}\" to increase conversions. Include what to change, why, and expected impact.`}); openModal(`<div class=\"modal-header\"><div class=\"modal-title\">🤖 ${name} Tips</div><button class=\"modal-close\" onclick=\"closeModal()\">×</button></div><div class=\"modal-body\"><div style=\"white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)\">${r.content}</div></div>`, 'modal-lg');} catch(e){toast(e.message,'error');} }\n",
r'''views.funnels = async function() {
  const d = await api('/funnels').catch(()=>({funnels:[]}));
  const funnels = d.funnels||[];
  content(`
    <div class="page-header"><div><div class="page-title">🔻 Funnels</div><div class="page-subtitle">${funnels.length} saved funnel${funnels.length===1?'':'s'}</div></div><div class="header-actions">
      <button class="btn btn-ai" onclick="aiDesignFunnel()">🤖 AI Design Funnel</button>
      <button class="btn btn-primary" onclick="openAddFunnel()">+ New Funnel</button>
    </div></div>
    ${funnels.length ? `<div style="display:flex;flex-direction:column;gap:14px">${funnels.map(f=>`
      <div class="card">
        <div style="display:flex;align-items:center;gap:14px">
          <div style="width:44px;height:44px;background:linear-gradient(135deg,var(--orange),var(--accent3));border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🔻</div>
          <div style="flex:1">
            <div style="font-weight:700">${esc(f.name)}</div>
            <div style="font-size:12px;color:var(--text2)">${esc(f.goal||'No goal set')}</div>
            <div style="font-size:11px;color:var(--text3)">${(f.stages||[]).length} stage(s)</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary btn-sm" onclick="viewFunnel(${f.id})">View</button>
            <button class="btn btn-ai btn-sm" onclick="aiOptimizeFunnel('${escAttr(f.name)}')">🤖 Optimize</button>
            <button class="btn btn-danger btn-sm" onclick="deleteFunnel(${f.id})">✕</button>
          </div>
        </div>
        ${(f.stages||[]).length ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--border)">${f.stages.map((st,i)=>`<div class="badge badge-orange" style="padding:5px 10px">${i+1}. ${esc(st.name||'Stage')}</div>`).join('')}</div>`:''}
      </div>`).join('')}</div>` : `
      <div class="empty-state"><div class="empty-icon">🔻</div><div class="empty-title">No funnels yet</div><div class="empty-text">Design your first funnel — AI drafts the stages and copy for you, and it's saved here for real.</div><button class="btn btn-ai" style="margin-top:12px" onclick="aiDesignFunnel()">🤖 Design a Funnel with AI</button></div>`}
  `);
};
function openAddFunnel() {
  openModal(`<div class="modal-header"><div class="modal-title">New Funnel</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Funnel Name *</label><input id="fn-name" placeholder="e.g. Lead Magnet Funnel"></div>
      <div class="form-group"><label>Goal</label><select id="fn-goal2"><option>Generate leads</option><option>Book demos</option><option>Sell product</option><option>Run webinar</option></select></div>
      <div class="form-group"><label>Stages (one per line)</label><textarea id="fn-stages" rows="5" placeholder="Awareness&#10;Interest&#10;Decision&#10;Action"></textarea></div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="addFunnel()">Save Funnel</button></div>`);
}
async function addFunnel() {
  const name=V('fn-name')?.value?.trim(); if(!name){toast('Enter a name','error');return;}
  const stages=(V('fn-stages')?.value||'').split('\n').map(x=>x.trim()).filter(Boolean).map(n=>({name:n,copy:''}));
  try { await api('/funnels','POST',{name,goal:V('fn-goal2')?.value,stages}); closeModal(); toast('Funnel saved! ✅','success'); views.funnels(); }
  catch(e){ toast(e.message,'error'); }
}
async function viewFunnel(id) {
  try {
    const d = await api('/funnels');
    const f = (d.funnels||[]).find(x=>x.id===id); if(!f) return;
    openModal(`<div class="modal-header"><div class="modal-title">🔻 ${esc(f.name)}</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        <div style="font-size:12px;color:var(--text2);margin-bottom:12px">Goal: ${esc(f.goal||'—')}</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${(f.stages||[]).map((st,i)=>`<div class="card card-sm"><div style="font-weight:700;font-size:13px;margin-bottom:4px">${i+1}. ${esc(st.name||'Stage')}</div>${st.copy?`<div style="font-size:12px;color:var(--text2);white-space:pre-wrap">${esc(st.copy)}</div>`:'<div style="font-size:11px;color:var(--text3)">No copy saved yet</div>'}</div>`).join('') || '<div class="empty-state"><div class="empty-text">No stages</div></div>'}
        </div>
      </div>`,'modal-lg');
  } catch(e){ toast(e.message,'error'); }
}
async function deleteFunnel(id) {
  if(!confirm('Delete this funnel?')) return;
  try { await api(`/funnels/${id}`,'DELETE'); toast('Deleted','success'); views.funnels(); } catch(e){ toast(e.message,'error'); }
}
async function aiDesignFunnel() { openModal(`<div class="modal-header"><div class="modal-title">🤖 AI Funnel Designer</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Product/Service</label><input id="fn-product" placeholder="What are you selling?"></div><div class="form-group"><label>Goal</label><select id="fn-goal"><option>Generate leads</option><option>Book demos</option><option>Sell product</option><option>Run webinar</option></select></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doFunnel()">✨ Design</button></div>`); }
async function doFunnel() { const p=V('fn-product')?.value; const g=V('fn-goal')?.value; if(!p){toast('Enter product','error');return;} toast('AI designing funnel...','info'); try{const r=await api('/ai/complete','POST',{prompt:`Design a complete sales funnel to ${g} for: "${p}". Respond with the funnel name on the first line, then one stage per line as "STAGE NAME: one-line copy for that stage". 4-6 stages.`}); closeModal(); const lines=(r.content||'').split('\n').map(x=>x.trim()).filter(Boolean); const name=lines[0]?.slice(0,80)||`${p} Funnel`; const stages=lines.slice(1).map(l=>{const i=l.indexOf(':');return i>0?{name:l.slice(0,i).trim().slice(0,60),copy:l.slice(i+1).trim().slice(0,400)}:{name:l.slice(0,60),copy:''};}).filter(x=>x.name); const saved=await api('/funnels','POST',{name,goal:g,stages}); toast(`Funnel "${name}" designed and saved! ✅`,'success'); views.funnels(); } catch(e){toast(e.message,'error');} }
async function aiOptimizeFunnel(name) { toast('Analyzing...','info'); try{const r=await api('/ai/complete','POST',{prompt:`Give 5 specific optimizations for a "${name}" funnel to increase conversions. Include what to change, why, and expected impact.`}); openModal(`<div class="modal-header"><div class="modal-title">🤖 ${esc(name)} Tips</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div></div>`, 'modal-lg');} catch(e){toast(e.message,'error');} }
''',
'funnels')

# ══════════════ FORMS — real lead-capture with public embed ══════════════
repBlock(
"views.forms = function() {",
"async function doForm() { const p=V('form-purpose')?.value; if(!p){toast('Enter purpose','error');return;} toast('Designing...','info'); try{const r=await api('/ai/complete','POST',{prompt:`Design an optimized lead capture form for: \"${p}\". Include all fields with labels, types, placeholders, submit button text, and thank you message.`}); closeModal(); openModal(`<div class=\"modal-header\"><div class=\"modal-title\">📝 Form Design</div><button class=\"modal-close\" onclick=\"closeModal()\">×</button></div><div class=\"modal-body\"><div style=\"white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)\">${r.content}</div></div>`);} catch(e){toast(e.message,'error');} }\n",
r'''views.forms = async function() {
  const d = await api('/forms').catch(()=>({forms:[]}));
  const forms = d.forms||[];
  content(`
    <div class="page-header"><div><div class="page-title">📝 Forms</div><div class="page-subtitle">${forms.length} form${forms.length===1?'':'s'} • submissions land in your CRM and can trigger automations</div></div><div class="header-actions">
      <button class="btn btn-ai" onclick="aiCreateForm()">🤖 AI Build Form</button>
      <button class="btn btn-primary" onclick="openAddForm()">+ New Form</button>
    </div></div>
    ${forms.length ? `<div style="display:flex;flex-direction:column;gap:14px">${forms.map(f=>`
      <div class="card">
        <div style="display:flex;align-items:center;gap:14px">
          <div style="width:44px;height:44px;background:linear-gradient(135deg,var(--accent),var(--accent3));border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">📝</div>
          <div style="flex:1">
            <div style="font-weight:700">${esc(f.name)} ${f.active?'':'<span class="badge badge-gray">inactive</span>'}</div>
            <div style="font-size:12px;color:var(--text2)">${(f.fields||[]).length} field(s) • ${f.submissions||0} submission(s)</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" onclick="viewFormSubmissions(${f.id})">📥 Submissions</button>
            <button class="btn btn-secondary btn-sm" onclick="showFormEmbed(${f.id})">🔗 Embed</button>
            <button class="btn btn-danger btn-sm" onclick="deleteForm(${f.id})">✕</button>
          </div>
        </div>
      </div>`).join('')}</div>` : `
      <div class="empty-state"><div class="empty-icon">📝</div><div class="empty-title">No forms yet</div><div class="empty-text">Create a lead-capture form, embed it on your website with one line of code, and every submission becomes a contact — plus it can trigger automations.</div><button class="btn btn-primary" style="margin-top:12px" onclick="openAddForm()">+ Create Form</button></div>`}
  `);
};
function openAddForm() {
  openModal(`<div class="modal-header"><div class="modal-title">New Form</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Form Name *</label><input id="f-name" placeholder="e.g. Lead Capture — Website"></div>
      <div class="form-group"><label>Fields</label>
        <div id="f-fields"><div style="display:grid;grid-template-columns:1fr 110px 36px;gap:6px;margin-bottom:6px"><input placeholder="Field label (e.g. Email)" class="f-label"><select class="f-type"><option value="text">Text</option><option value="email">Email</option><option value="phone">Phone</option><option value="textarea">Textarea</option><option value="number">Number</option></select><span></span></div></div>
        <button class="btn btn-secondary btn-sm" onclick="addFormFieldRow()">+ Add Field</button>
      </div>
      <div class="form-group"><label>Success message</label><input id="f-success" placeholder="Thanks! We will be in touch soon."></div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createForm()">Create Form</button></div>`);
}
function addFormFieldRow() {
  const r=document.createElement('div');
  r.style.cssText='display:grid;grid-template-columns:1fr 110px 36px;gap:6px;margin-bottom:6px';
  r.innerHTML='<input placeholder="Field label" class="f-label"><select class="f-type"><option value="text">Text</option><option value="email">Email</option><option value="phone">Phone</option><option value="textarea">Textarea</option><option value="number">Number</option></select><button type="button" onclick="this.closest(\'div\').remove()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px">×</button>';
  V('f-fields').appendChild(r);
}
async function createForm() {
  const name=V('f-name')?.value?.trim(); if(!name){toast('Enter a name','error');return;}
  const fields=[...document.querySelectorAll('#f-fields > div')].map(r=>({label:r.querySelector('.f-label')?.value?.trim()||'',type:r.querySelector('.f-type')?.value||'text',required:true})).filter(f=>f.label);
  if(!fields.length){toast('Add at least one field','error');return;}
  try { await api('/forms','POST',{name,fields,success_message:V('f-success')?.value}); closeModal(); toast('Form created! ✅','success'); views.forms(); }
  catch(e){ toast(e.message,'error'); }
}
async function deleteForm(id) {
  if(!confirm('Delete this form and all its submissions?')) return;
  try { await api(`/forms/${id}`,'DELETE'); toast('Deleted','success'); views.forms(); } catch(e){ toast(e.message,'error'); }
}
async function viewFormSubmissions(id) {
  try {
    const d = await api(`/forms/${id}/submissions`);
    const subs = d.submissions||[];
    openModal(`<div class="modal-header"><div class="modal-title">📥 Submissions (${subs.length})</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        ${subs.length ? subs.map(s=>`<div class="card card-sm" style="margin-bottom:10px">
          <div style="font-size:11px;color:var(--text3);margin-bottom:6px">${timeAgo(s.created_at)} ${s.contact_name?`• contact: ${esc(s.contact_name)}`:''}</div>
          <div style="font-size:13px;line-height:1.7">${Object.entries(s.data||{}).map(([k,v])=>`<div><span style="color:var(--text3);font-weight:600">${esc(k)}:</span> ${esc(v)}</div>`).join('')||'<span style="color:var(--text3)">empty</span>'}</div>
        </div>`).join('') : '<div class="empty-state"><div class="empty-text">No submissions yet — embed the form on your site first.</div></div>'}
      </div>`, 'modal-lg');
  } catch(e){ toast(e.message,'error'); }
}
function showFormEmbed(id) {
  const base = API.replace(/\/+$/,'');
  const script = `<script src="${base}/public/forms/${id}/embed.js" defer></script>`;
  openModal(`<div class="modal-header"><div class="modal-title">🔗 Embed This Form</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="ai-insight" style="margin-bottom:12px"><div class="ai-insight-title">How it works</div><div class="ai-insight-text">Paste this one line into any website (WordPress, Wix, plain HTML, landing page). The form renders itself, submits to your backend, creates a contact, and can fire automations. Works only with the deployed backend — in local-only mode there is no public URL.</div></div>
      <textarea readonly style="width:100%;min-height:70px;font-family:monospace;font-size:12px;background:var(--bg);color:var(--text2);border:1px solid var(--border);border-radius:6px;padding:8px" onclick="this.select()">${esc(script)}</textarea>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${escAttr(script)}');toast('Copied!','success')">📋 Copy</button></div>
    </div>`);
}
async function aiCreateForm() { openModal(`<div class="modal-header"><div class="modal-title">🤖 AI Form Builder</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Form purpose</label><input id="form-purpose" placeholder="e.g. Capture leads for a marketing agency"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doForm()">✨ Design Form</button></div>`); }
async function doForm() { const p=V('form-purpose')?.value; if(!p){toast('Enter purpose','error');return;} toast('Designing...','info'); try{const r=await api('/ai/complete','POST',{prompt:`Design an optimized lead capture form for: "${p}". Respond ONLY as JSON: {"name":"...","fields":[{"label":"...","type":"text|email|phone|textarea|number"}...],"success_message":"..."}. 4-7 fields, include Name and Email.`}); closeModal(); let parsed=null; try{parsed=JSON.parse((r.content||'').match(/\{[\s\S]*\}/)?.[0]||'{}');}catch{} if(parsed&&parsed.fields&&parsed.fields.length){await api('/forms','POST',{name:parsed.name||`${p} Form`,fields:parsed.fields,success_message:parsed.success_message||''}); toast('AI form created! ✅','success'); views.forms();} else {openModal(`<div class="modal-header"><div class="modal-title">📝 Form Design</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div></div>`);} } catch(e){toast(e.message,'error');} }
''',
'forms')

# ══════════════ COURSES — real CRUD with AI outlines ══════════════
repBlock(
"views.courses = async function() {",
"async function doCourse() { const t=V('co-topic')?.value; if(!t){toast('Enter topic','error');return;} toast('Building outline...','info',8000); try{const r=await api('/ai/complete','POST',{prompt:`Create a detailed 8-module online course outline for: \"${t}\" targeting: ${V('co-aud')?.value||'general audience'}. Include module titles, 4 lessons per module, and learning outcomes. Format clearly.`,max_tokens:2000}); closeModal(); openModal(`<div class=\"modal-header\"><div class=\"modal-title\">🎓 Course Outline</div><button class=\"modal-close\" onclick=\"closeModal()\">×</button></div><div class=\"modal-body\"><div style=\"white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2);max-height:600px;overflow-y:auto\">${r.content}</div></div>`, 'modal-xl');} catch(e){toast(e.message,'error');} }\n",
r'''views.courses = async function() {
  const d = await api('/courses').catch(()=>({courses:[]}));
  const courses = d.courses||[];
  content(`
    <div class="page-header"><div><div class="page-title">🎓 Courses</div><div class="page-subtitle">${courses.length} course${courses.length===1?'':'s'} • sell knowledge to your audience</div></div><div class="header-actions">
      <button class="btn btn-ai" onclick="aiCourseOutline()">🤖 AI Course Outline</button>
      <button class="btn btn-primary" onclick="openAddCourse()">+ New Course</button>
    </div></div>
    ${courses.length ? `<div style="display:flex;flex-direction:column;gap:14px">${courses.map(c=>`
      <div class="card">
        <div style="display:flex;align-items:center;gap:14px">
          <div style="width:44px;height:44px;background:linear-gradient(135deg,var(--ai),var(--ai2));border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🎓</div>
          <div style="flex:1">
            <div style="font-weight:700">${esc(c.title)} <span class="badge ${c.status==='published'?'badge-green':'badge-gray'}">${esc(c.status)}</span></div>
            <div style="font-size:12px;color:var(--text2)">${esc(c.description||'')}</div>
            <div style="font-size:11px;color:var(--text3)">${(c.modules||[]).length} module(s) • ${$$$(c.price)}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-secondary btn-sm" onclick="viewCourse(${c.id})">View</button>
            <button class="btn btn-secondary btn-sm" onclick="toggleCourseStatus(${c.id},'${escAttr(c.status)}')">${c.status==='published'?'Unpublish':'Publish'}</button>
            <button class="btn btn-danger btn-sm" onclick="deleteCourse(${c.id})">✕</button>
          </div>
        </div>
      </div>`).join('')}</div>` : `
      <div class="empty-state"><div class="empty-icon">🎓</div><div class="empty-title">No courses yet</div><div class="empty-text">Create your first online course to start selling knowledge</div><button class="btn btn-ai" style="margin-top:12px" onclick="aiCourseOutline()">🤖 Build Course Outline with AI</button></div>`}
  `);
};
function openAddCourse() {
  openModal(`<div class="modal-header"><div class="modal-title">New Course</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Course Title *</label><input id="co-title" placeholder="e.g. Social Media Marketing Masterclass"></div>
      <div class="form-group"><label>Description</label><textarea id="co-desc" rows="3" placeholder="What will students learn?"></textarea></div>
      <div class="form-row"><div class="form-group"><label>Price ($)</label><input id="co-price" type="number" min="0" value="49"></div><div class="form-group"><label>Status</label><select id="co-status"><option value="draft">Draft</option><option value="published">Published</option></select></div></div>
      <button class="btn btn-ai btn-sm" onclick="aiFillCourseOutline()">🤖 Generate outline with AI</button>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createCourse()">Save Course</button></div>`, 'modal-lg');
}
async function createCourse() {
  const title=V('co-title')?.value?.trim(); if(!title){toast('Enter a title','error');return;}
  try { await api('/courses','POST',{title,description:V('co-desc')?.value,price:parseFloat(V('co-price')?.value)||0,status:V('co-status')?.value||'draft',modules:[]}); closeModal(); toast('Course created! ✅','success'); views.courses(); }
  catch(e){ toast(e.message,'error'); }
}
async function aiFillCourseOutline() {
  const title=V('co-title')?.value?.trim(); if(!title){toast('Enter a title first','error');return;}
  toast('Generating outline...','info',8000);
  try {
    const r=await api('/ai/complete','POST',{prompt:`Create a detailed course outline for: "${title}". Respond ONLY as JSON: {"modules":[{"title":"...","lessons":[{"title":"...","summary":"one line"}]}...]} with 6-8 modules and 3-4 lessons each.`});
    const parsed=JSON.parse((r.content||'').match(/\{[\s\S]*\}/)?.[0]||'{}');
    if(parsed.modules&&parsed.modules.length){ V('co-desc').value = V('co-desc')?.value || `Complete course on ${title}.`; window._courseModules = parsed.modules; toast(`${parsed.modules.length} modules generated — now click Save Course ✅`,'success',5000); }
    else toast('Could not parse the outline — try again.','error');
  } catch(e){ toast(e.message,'error'); }
}
async function viewCourse(id) {
  try {
    const d = await api('/courses');
    const c = (d.courses||[]).find(x=>x.id===id); if(!c) return;
    openModal(`<div class="modal-header"><div class="modal-title">🎓 ${esc(c.title)}</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        <div style="font-size:12px;color:var(--text2);margin-bottom:12px">${esc(c.description||'')} • ${$$$(c.price)} • ${esc(c.status)}</div>
        ${(c.modules||[]).length ? c.modules.map((m,i)=>`<div class="card card-sm" style="margin-bottom:10px"><div style="font-weight:700;font-size:13px">Module ${i+1}: ${esc(m.title)}</div>${(m.lessons||[]).map(l=>`<div style="font-size:12px;color:var(--text2);margin-top:4px">• ${esc(l.title)}${l.summary?` <span style="color:var(--text3)">— ${esc(l.summary)}</span>`:''}</div>`).join('')}</div>`).join('') : '<div class="empty-state"><div class="empty-text">No outline yet — open the course and generate one with AI.</div></div>'}
      </div>`, 'modal-lg');
  } catch(e){ toast(e.message,'error'); }
}
async function toggleCourseStatus(id,status) {
  try { await api(`/courses/${id}`,'PATCH',{status:status==='published'?'draft':'published'}); views.courses(); } catch(e){ toast(e.message,'error'); }
}
async function deleteCourse(id) {
  if(!confirm('Delete this course?')) return;
  try { await api(`/courses/${id}`,'DELETE'); toast('Deleted','success'); views.courses(); } catch(e){ toast(e.message,'error'); }
}
async function aiCourseOutline() { openModal(`<div class="modal-header"><div class="modal-title">🤖 Course Outline Builder</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Course topic</label><input id="co-topic" placeholder="e.g. Social Media Marketing for Small Business"></div><div class="form-group"><label>Target audience</label><input id="co-aud" placeholder="e.g. beginners with no experience"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doCourse()">✨ Build & Save</button></div>`); }
async function doCourse() { const t=V('co-topic')?.value; if(!t){toast('Enter topic','error');return;} toast('Building outline...','info',8000); try{const r=await api('/ai/complete','POST',{prompt:`Create a detailed course outline for: "${t}" targeting: ${V('co-aud')?.value||'general audience'}. Respond ONLY as JSON: {"title":"...","modules":[{"title":"...","lessons":[{"title":"...","summary":"..."}]}...]} — 6-8 modules, 3-4 lessons each.`}); const parsed=JSON.parse((r.content||'').match(/\{[\s\S]*\}/)?.[0]||'{}'); if(parsed.modules&&parsed.modules.length){const saved=await api('/courses','POST',{title:parsed.title||t,description:`Course on ${t} (AI outline)`,price:0,status:'draft',modules:parsed.modules}); closeModal(); toast('Course saved with AI outline! ✅','success'); views.courses();} else {closeModal(); openModal(`<div class="modal-header"><div class="modal-title">🎓 Outline</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;color:var(--text2)">${esc(r.content)}</div></div>`, 'modal-xl');} } catch(e){toast(e.message,'error');} }
''',
'courses')

# ══════════════ AFFILIATES — real tracking ══════════════
repBlock(
"views.affiliates = function() {",
"async function aiAffiliateSetup() { toast('Generating...','info'); try{const r=await api('/ai/complete','POST',{prompt:'Complete guide for launching an affiliate program: commission structure, recruitment strategy, tracking setup, resources to provide, and first 90-day plan.'}); openModal(`<div class=\"modal-header\"><div class=\"modal-title\">🤝 Affiliate Setup Guide</div><button class=\"modal-close\" onclick=\"closeModal()\">×</button></div><div class=\"modal-body\"><div style=\"white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)\">${r.content}</div></div>`, 'modal-lg');} catch(e){toast(e.message,'error');} }\n",
r'''views.affiliates = async function() {
  const d = await api('/affiliates').catch(()=>({affiliates:[]}));
  const affiliates = d.affiliates||[];
  const totalClicks = affiliates.reduce((a,x)=>a+(x.clicks||0),0);
  const pubBase = API.replace(/\/+$/,'').replace(/\/api$/,'');
  content(`
    <div class="page-header"><div><div class="page-title">🤝 Affiliates</div><div class="page-subtitle">${affiliates.length} affiliate(s) • ${totalClicks} tracked click(s)</div></div><div class="header-actions">
      <button class="btn btn-ai" onclick="aiAffiliateEmail()">🤖 Recruit Email</button>
      <button class="btn btn-primary" onclick="openAddAffiliate()">+ Add Affiliate</button>
    </div></div>
    ${affiliates.length ? `<div class="table-wrap"><table><thead><tr><th>Affiliate</th><th>Commission</th><th>Clicks</th><th>Conversions</th><th>Tracking Link</th><th>Actions</th></tr></thead><tbody>
      ${affiliates.map(a=>`<tr>
        <td><div style="font-weight:600">${esc(a.name)}</div><div style="font-size:11px;color:var(--text3)">${esc(a.email||'')}</div></td>
        <td>${a.rate||0}%</td>
        <td>${a.clicks||0}</td>
        <td>${a.conversions||0}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="copyAffiliateLink('${escAttr(a.token)}')">📋 Copy Link</button></td>
        <td><button class="btn btn-danger btn-sm" onclick="deleteAffiliate(${a.id})">✕</button></td>
      </tr>`).join('')}
    </tbody></table></div>
    <div class="ai-insight" style="margin-top:16px"><div class="ai-insight-title">How tracking works</div><div class="ai-insight-text">Share the affiliate's link (opens with a click counter + optional redirect). Every click is logged and shown here. Works with the deployed backend — in local-only mode there's no public tracking URL.</div></div>` : `
      <div class="empty-state"><div class="empty-icon">🤝</div><div class="empty-title">No affiliates yet</div><div class="empty-text">Add affiliates, share their tracking links, and watch referrals roll in.</div><button class="btn btn-primary" style="margin-top:12px" onclick="openAddAffiliate()">+ Add Affiliate</button></div>`}
  `);
};
function openAddAffiliate() {
  openModal(`<div class="modal-header"><div class="modal-title">Add Affiliate</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-row"><div class="form-group"><label>Name *</label><input id="af-name" placeholder="Partner name"></div><div class="form-group"><label>Email</label><input id="af-email" type="email"></div></div>
      <div class="form-group"><label>Commission %</label><input id="af-rate" type="number" min="0" max="100" value="20"></div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createAffiliate()">Create</button></div>`);
}
async function createAffiliate() {
  const name=V('af-name')?.value?.trim(); if(!name){toast('Enter a name','error');return;}
  try { await api('/affiliates','POST',{name,email:V('af-email')?.value,rate:parseFloat(V('af-rate')?.value)||20}); closeModal(); toast('Affiliate created — copy their tracking link! ✅','success'); views.affiliates(); }
  catch(e){ toast(e.message,'error'); }
}
async function deleteAffiliate(id) {
  if(!confirm('Delete this affiliate and their click history?')) return;
  try { await api(`/affiliates/${id}`,'DELETE'); toast('Deleted','success'); views.affiliates(); } catch(e){ toast(e.message,'error'); }
}
function copyAffiliateLink(token) {
  const pubBase = API.replace(/\/+$/,'').replace(/\/api$/,'');
  const link = pubBase + '/api/public/affiliate/go?token=' + encodeURIComponent(token) + '&ref=website';
  navigator.clipboard?.writeText(link).then(()=>toast('Tracking link copied — share it with your affiliate! ✅','success')).catch(()=>toast(link,'info',9000));
}
async function aiAffiliateEmail() { try{const r=await api('/ai/generate','POST',{type:'email',context:'recruiting new affiliate partners for a SaaS business',tone:'persuasive'}); openModal(`<div class="modal-header"><div class="modal-title">🤖 Affiliate Recruitment Email</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div></div>`);} catch(e){toast(e.message,'error');} }
async function aiAffiliateSetup() { toast('Generating...','info'); try{const r=await api('/ai/complete','POST',{prompt:'Complete guide for launching an affiliate program: commission structure, recruitment strategy, tracking setup, resources to provide, and first 90-day plan.'}); openModal(`<div class="modal-header"><div class="modal-title">🤝 Affiliate Setup Guide</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div></div>`, 'modal-lg');} catch(e){toast(e.message,'error');} }
''',
'affiliates')

# ══════════════ COMMUNITY — real posts ══════════════
repBlock(
"views.community = function() {",
"async function aiCommunityPost() {\n  try {\n    const r = await api('/ai/complete', 'POST', { prompt: 'Give me 5 creative community engagement post ideas for a B2B SaaS business. Include the hook, content, and expected engagement driver for each.' });\n    openModal(`<div class=\"modal-header\"><div class=\"modal-title\">🤖 Community Post Ideas</div><button class=\"modal-close\" onclick=\"closeModal()\">×</button></div><div class=\"modal-body\"><div style=\"white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)\">${r.content}</div></div>`);\n  } catch(e) { toast(e.message, 'error'); }\n}\n",
r'''views.community = async function() {
  const d = await api('/community').catch(()=>({posts:[]}));
  const posts = d.posts||[];
  content(`
    <div class="page-header"><div><div class="page-title">👥 Community</div><div class="page-subtitle">${posts.length} post(s) — engage with your audience</div></div><div class="header-actions">
      <button class="btn btn-ai" onclick="aiCommunityPost()">🤖 AI Post Idea</button>
      <button class="btn btn-primary" onclick="openAddCommunityPost()">+ New Post</button>
    </div></div>
    ${posts.length ? `<div style="display:flex;flex-direction:column;gap:14px">${posts.map(p=>`
      <div class="card">
        <div style="display:flex;align-items:flex-start;gap:12px">
          <div style="flex:1">
            <div style="font-weight:700">${esc(p.title)}</div>
            <div style="font-size:12px;color:var(--text3);margin:3px 0 6px">${timeAgo(p.created_at)}</div>
            <div style="font-size:13px;color:var(--text2);line-height:1.6;white-space:pre-wrap">${esc(p.content||'')}</div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="deleteCommunityPost(${p.id})">✕</button>
        </div>
      </div>`).join('')}</div>` : `
      <div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">No posts yet</div><div class="empty-text">Manage discussions, posts, and member engagement from one place</div><button class="btn btn-primary" style="margin-top:12px" onclick="openAddCommunityPost()">+ Create Post</button></div>`}
  `);
};
function openAddCommunityPost() {
  openModal(`<div class="modal-header"><div class="modal-title">New Community Post</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Title *</label><input id="cp-title" placeholder="Post title"></div>
      <div class="form-group"><label>Content</label><textarea id="cp-body" rows="6" placeholder="What do you want to share?"></textarea></div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createCommunityPost()">Publish</button></div>`);
}
async function createCommunityPost() {
  const title=V('cp-title')?.value?.trim(); if(!title){toast('Enter a title','error');return;}
  try { await api('/community','POST',{title,content:V('cp-body')?.value}); closeModal(); toast('Posted! ✅','success'); views.community(); }
  catch(e){ toast(e.message,'error'); }
}
async function deleteCommunityPost(id) {
  if(!confirm('Delete this post?')) return;
  try { await api(`/community/${id}`,'DELETE'); toast('Deleted','success'); views.community(); } catch(e){ toast(e.message,'error'); }
}
async function aiCommunityPost() {
  try {
    const r = await api('/ai/complete', 'POST', { prompt: 'Give me 5 creative community engagement post ideas for a B2B SaaS business. Include the hook, content, and expected engagement driver for each.' });
    openModal(`<div class="modal-header"><div class="modal-title">🤖 Community Post Ideas</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div></div>`);
  } catch(e) { toast(e.message, 'error'); }
}
''',
'community')

# ══════════════ REPORTS — charts + CSV export ══════════════
repBlock(
"views.reports = async function() {",
"};\nasync function aiExecutiveReport()",
r'''views.reports = async function() {
  const [s,u,deals,tasks]=await Promise.allSettled([api('/stats'),api('/ai/usage'),api('/deals'),api('/tasks')]);
  const stats=s.value||{}; const usage=u.value||{};
  const dealList=deals.value?.deals||[]; const taskList=tasks.value?.tasks||[];
  const stages=['lead','prospect','qualified','proposal','negotiation','won','lost'];
  const stageCounts=stages.map(st=>({st,count:dealList.filter(d=>d.stage===st).length,value:dealList.filter(d=>d.stage===st).reduce((a,d)=>a+(d.value||0),0)}));
  content(`
    <div class="page-header"><div><div class="page-title">📈 Reports</div></div><div class="header-actions">
      <button class="btn btn-secondary" onclick="exportReportsCSV()">⬇️ Export CSV</button>
      <button class="btn btn-ai" onclick="aiExecutiveReport()">🤖 Executive Report</button>
    </div></div>
    <div class="grid grid-4" style="margin-bottom:20px">
      <div class="stat-card"><div class="stat-label">Contacts</div><div class="stat-value">${$$(stats.contacts||0)}</div></div>
      <div class="stat-card green"><div class="stat-label">Pipeline Value</div><div class="stat-value">${$$$(stats.pipeline_value||0)}</div></div>
      <div class="stat-card purple"><div class="stat-label">Revenue Won</div><div class="stat-value">${$$$(stats.won_revenue||0)}</div></div>
      <div class="stat-card cyan"><div class="stat-label">Open Deals</div><div class="stat-value">${$$(stats.open_deals||0)}</div></div>
    </div>
    <div class="grid grid-2" style="margin-bottom:20px">
      <div class="card">
        <div style="font-weight:700;margin-bottom:12px">📊 Pipeline by Stage</div>
        <canvas id="chart-pipeline" height="180" style="width:100%"></canvas>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">${stageCounts.filter(x=>x.count).map(x=>`<span class="badge badge-blue">${x.st} · ${x.count} · ${$$$(x.value)}</span>`).join('')||'<span style="font-size:12px;color:var(--text3)">No deals yet</span>'}</div>
      </div>
      <div class="card">
        <div style="font-weight:700;margin-bottom:12px">✅ Tasks by Status</div>
        <canvas id="chart-tasks" height="180" style="width:100%"></canvas>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
          <span class="badge badge-yellow">todo · ${taskList.filter(t=>t.status==='todo').length}</span>
          <span class="badge badge-green">done · ${taskList.filter(t=>t.status==='done').length}</span>
        </div>
      </div>
    </div>
    <div class="grid grid-2">
      <div class="card"><div style="font-weight:700;margin-bottom:12px">🤖 AI Usage</div>
        ${[['Total AI Calls',$$(usage.total||0),'var(--ai2)'],['Today',$$(usage.today||0),'var(--text)'],['Tokens Today',$$(usage.tokens_today||0),'var(--text)'],['Conversations',$$(usage.conversations||0),'var(--text)'],['CRM Messages',$$(usage.messages||0),'var(--text)']].map(([l,v,c])=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text2);font-size:13px">${l}</span><span style="font-weight:700;color:${c}">${v}</span></div>`).join('')}
      </div>
      <div class="card"><div style="font-weight:700;margin-bottom:12px">📉 Business</div>
        ${[['Pending Tasks',$$(stats.pending_tasks||0),'var(--text)'],['Upcoming Appts',$$(stats.upcoming_appointments||0),'var(--text)'],['Invoices Paid',$$$(stats.revenue_collected||0),'var(--green)'],['Sub-Accounts',$$(stats.sub_accounts||0),'var(--text)'],['Forms',$$(stats.forms||0),'var(--text)']].map(([l,v,c])=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text2);font-size:13px">${l}</span><span style="font-weight:700;color:${c}">${v}</span></div>`).join('')}
      </div>
    </div>`);
  setTimeout(()=>{
    drawBarChart('chart-pipeline', stageCounts.filter(x=>x.count).map(x=>x.st), stageCounts.filter(x=>x.count).map(x=>x.count), '#6366f1');
    drawBarChart('chart-tasks', ['todo','done'], [taskList.filter(t=>t.status==='todo').length, taskList.filter(t=>t.status==='done').length], '#10b981');
  }, 50);
};
function drawBarChart(canvasId, labels, values, color) {
  const cv = V(canvasId); if (!cv) return;
  const ctx = cv.getContext('2d');
  const w = cv.width = cv.clientWidth || 600;
  const h = cv.height = 200;
  ctx.clearRect(0,0,w,h);
  const max = Math.max(1, ...values);
  const pad = 36, bw = (w - pad*2) / Math.max(1,labels.length) * 0.55;
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  values.forEach((v,i)=>{
    const bh = Math.max(4, (v/max) * (h - 70));
    const x = pad + i * ((w-pad*2)/labels.length) + ((w-pad*2)/labels.length - bw)/2;
    const y = h - 40 - bh;
    const g = ctx.createLinearGradient(0, y, 0, h-40);
    g.addColorStop(0, color); g.addColorStop(1, color + '55');
    ctx.fillStyle = g;
    ctx.beginPath();
    const r = 5;
    ctx.roundRect ? ctx.roundRect(x, y, bw, bh, r) : ctx.rect(x, y, bw, bh);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0'; ctx.fillText(String(v), x + bw/2, y - 6);
    ctx.fillStyle = '#94a3b8'; ctx.fillText(String(labels[i]||''), x + bw/2, h - 24);
  });
}
async function exportReportsCSV() {
  const [contacts, deals, tasks, invoices] = await Promise.allSettled([api('/contacts?limit=2000'), api('/deals'), api('/tasks'), api('/invoices')]);
  const rows = [['Type','Name','Detail','Stage/Status','Value','Date']];
  (contacts.value?.contacts||[]).forEach(c=>rows.push(['Contact', c.name, c.email||c.phone||c.company||'', c.stage||'', '', c.created_at||'']));
  (deals.value?.deals||[]).forEach(d=>rows.push(['Deal', d.title, d.contact_name||'', d.stage||'', d.value||0, d.created_at||'']));
  (tasks.value?.tasks||[]).forEach(t=>rows.push(['Task', t.title, t.description||'', t.status||'', '', t.due_date||'']));
  (invoices.value?.invoices||[]).forEach(i=>rows.push(['Invoice', i.number, i.contact_name||'', i.status||'', i.total||0, i.created_at||'']));
  downloadCSV('nexuscrm-report-'+new Date().toISOString().slice(0,10)+'.csv', rows);
  toast('Report exported ✅','success');
}
''',
'reports')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 6 done.')
