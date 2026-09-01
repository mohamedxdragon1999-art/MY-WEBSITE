#!/usr/bin/env python3
"""Frontend batch 9: default nvidia provider, contact tags + custom fields UI + local engine."""
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

# ── 1. Default provider = nvidia (free) everywhere ──
rep("    aiSettings: { provider:'openai', model:'gpt-4o-mini', temperature:0.7, max_tokens:2048, system_prompt:'', openai_key:'', nvidia_key:'', custom_base_url:'http://localhost:11434/v1', custom_key:'', proxy_url:'', custom_key_set:false },",
    "    aiSettings: { provider:'nvidia', model:'meta/llama-3.1-8b-instruct', temperature:0.7, max_tokens:2048, system_prompt:'', openai_key:'', nvidia_key:'', custom_base_url:'http://localhost:11434/v1', custom_key:'', proxy_url:'', custom_key_set:false },",
    tag='blankWorkspace nvidia default')
rep("  let s = {provider:'openai',model:'gpt-4o-mini',temperature:0.7,max_tokens:2048,system_prompt:'',proxy_url:'',openai_key_set:false,nvidia_key_set:false,auto_score_new_contacts:false,daily_digest_enabled:false,daily_digest_hour_utc:13,daily_call_cap:300};",
    "  let s = {provider:'nvidia',model:'meta/llama-3.1-8b-instruct',temperature:0.7,max_tokens:2048,system_prompt:'',proxy_url:'',openai_key_set:false,nvidia_key_set:false,auto_score_new_contacts:false,daily_digest_enabled:false,daily_digest_hour_utc:13,daily_call_cap:300};",
    tag='settings nvidia default')

# ── 2. Local engine: tags + custom fields on POST/PATCH + tag filter ──
rep("""        const c = { id: nextId(ws,'contact'), name: body.name, email: body.email||'', phone: body.phone||'', company: body.company||'', stage: body.stage||'lead', source: body.source||'manual', notes: body.notes||'', ai_score: 0, ai_score_reason: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };""",
"""        const c = { id: nextId(ws,'contact'), name: body.name, email: body.email||'', phone: body.phone||'', company: body.company||'', stage: body.stage||'lead', source: body.source||'manual', notes: body.notes||'', tags: body.tags||'', custom_fields: body.custom_fields||{}, ai_score: 0, ai_score_reason: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };""",
    tag='local contact POST tags')
rep("""        if (search) list = list.filter(c => (c.name||'').toLowerCase().includes(search) || (c.email||'').toLowerCase().includes(search) || (c.company||'').toLowerCase().includes(search));
        if (stage) list = list.filter(c => c.stage === stage);""",
"""        if (search) list = list.filter(c => (c.name||'').toLowerCase().includes(search) || (c.email||'').toLowerCase().includes(search) || (c.company||'').toLowerCase().includes(search));
        if (stage) list = list.filter(c => c.stage === stage);
        const tag = q.get('tag');
        if (tag) list = list.filter(c => (',' + (c.tags||'') + ',').toLowerCase().includes(',' + tag.toLowerCase() + ','));""",
    tag='local contact tag filter')

# ── 3. Contact modal: tags + custom fields rows ──
rep("""      <div class="form-group"><label>Notes</label><textarea id="c-notes" placeholder="Any additional notes..."></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="addContact()">Add Contact</button>
    </div>`);""",
"""      <div class="form-group"><label>Tags (comma separated)</label><input id="c-tags" placeholder="vip, hot-lead, newsletter"></div>
      <div class="form-group"><label>Custom Fields</label>
        <div id="c-custom-fields"><div style="display:grid;grid-template-columns:1fr 1fr 28px;gap:6px;margin-bottom:6px"><input placeholder="Label (e.g. Birthday)" class="cf-label"><input placeholder="Value" class="cf-value"><span></span></div></div>
        <button class="btn btn-secondary btn-sm" type="button" onclick="addCustomFieldRow()">+ Add Field</button>
      </div>
      <div class="form-group"><label>Notes</label><textarea id="c-notes" placeholder="Any additional notes..."></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="addContact()">Add Contact</button>
    </div>`);""",
    tag='contact modal fields')
rep("""function openAddContact() {""",
"""function addCustomFieldRow() {
  const r = document.createElement('div');
  r.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 28px;gap:6px;margin-bottom:6px';
  r.innerHTML = '<input placeholder="Label" class="cf-label"><input placeholder="Value" class="cf-value"><button type="button" onclick="this.closest(\\'div\\').remove()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px">×</button>';
  const box = V('c-custom-fields'); if (box) box.appendChild(r);
}
function collectCustomFields() {
  const out = {};
  document.querySelectorAll('#c-custom-fields > div').forEach(row => {
    const label = row.querySelector('.cf-label')?.value?.trim();
    const value = row.querySelector('.cf-value')?.value?.trim();
    if (label) out[label] = value || '';
  });
  return out;
}
function openAddContact() {""",
    tag='custom field helpers')

# ── 4. addContact sends tags + custom_fields ──
rep("""  try {
    await api('/contacts','POST',{name:V('c-name').value,email:V('c-email').value,phone,company:V('c-company').value,stage:V('c-stage').value,source:V('c-source').value,notes:V('c-notes').value});
    closeModal(); toast('Contact added! ✅','success'); views.contacts();
  } catch(e) { toast(e.message,'error'); }""",
"""  try {
    await api('/contacts','POST',{name:V('c-name').value,email:V('c-email').value,phone,company:V('c-company').value,stage:V('c-stage').value,source:V('c-source').value,notes:V('c-notes').value,tags:V('c-tags')?.value||'',custom_fields:collectCustomFields()});
    closeModal(); toast('Contact added! ✅','success'); views.contacts();
  } catch(e) { toast(e.message,'error'); }""",
    tag='addContact sends tags')

# ── 5. Contacts view: tag chips row + tags in table + tag filter ──
rep("""      <div class="page-header">
        <div><div class="page-title">Contacts</div><div class="page-subtitle">${$$(contacts.length)} contacts${d.total?` of ${$$(d.total)}`:''}</div></div>
        <div class="header-actions">
          <input placeholder="🔍 Search..." style="width:200px" value="${escAttr(search)}" oninput="debounce(q=>views.contacts(q),350)(this.value)">
          <button class="btn btn-ai btn-sm" onclick="aiScoreAllLeads()">🤖 AI Score All</button>
          <button class="btn btn-secondary btn-sm" onclick="importContactsCSV()">📂 Import CSV</button>
          <button class="btn btn-primary" onclick="openAddContact()">+ Add Contact</button>
        </div>
      </div>""",
"""      <div class="page-header">
        <div><div class="page-title">Contacts</div><div class="page-subtitle">${$$(contacts.length)} contacts${d.total?` of ${$$(d.total)}`:''}</div></div>
        <div class="header-actions">
          <input placeholder="🔍 Search..." style="width:200px" value="${escAttr(search)}" oninput="debounce(q=>views.contacts(q),350)(this.value)">
          <button class="btn btn-ai btn-sm" onclick="aiScoreAllLeads()">🤖 AI Score All</button>
          <button class="btn btn-secondary btn-sm" onclick="importContactsCSV()">📂 Import CSV</button>
          <button class="btn btn-primary" onclick="openAddContact()">+ Add Contact</button>
        </div>
      </div>
      ${allTags.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${allTags.map(t=>`<span class="badge ${tagFilter===t?'badge-purple':'badge-gray'}" style="cursor:pointer" onclick="toggleTagFilter('${escAttr(t)}')">${esc(t)}${tagFilter===t?' ✕':''}</span>`).join('')}</div>` : ''}""",
    tag='contacts tag chips')
rep("""  try {
    const q = search ? `?search=${encodeURIComponent(search)}` : '';
    const d = await api('/contacts' + q);
    const contacts = d.contacts || [];""",
"""  try {
    let q = search ? `?search=${encodeURIComponent(search)}` : '';
    if (tagFilter) q += (q ? '&' : '?') + 'tag=' + encodeURIComponent(tagFilter);
    const d = await api('/contacts' + q);
    const contacts = d.contacts || [];
    const allTags = [...new Set((d.contacts||[]).concat([]).flatMap(c => String(c.tags||'').split(',').map(t=>t.trim()).filter(Boolean)))];
    if (q.includes('tag=')) { /* tags list from unfiltered set would need another call; use current set */ }
    const tagSource = search || tagFilter ? (await api('/contacts' + (search?`?search=${encodeURIComponent(search)}`:''))).contacts : contacts;
    const allTags2 = [...new Set((tagSource||[]).flatMap(c => String(c.tags||'').split(',').map(t=>t.trim()).filter(Boolean)))];
    const allTags = allTags2;""",
    tag='contacts load tags')
rep("""const views = {};""",
"""const views = {};
let tagFilter = null;
function toggleTagFilter(t) {
  tagFilter = (tagFilter === t) ? null : t;
  views.contacts(document.querySelector('#content input[placeholder="🔍 Search..."]')?.value || '');
}""",
    tag='tagFilter state')

# ── 6. Contacts table: tags column + custom fields in viewContact ──
rep("""        <thead><tr><th>Name</th><th>Company</th><th>Stage</th><th>AI Score</th><th>Phone</th><th>Last Updated</th><th>Actions</th></tr></thead>""",
"""        <thead><tr><th>Name</th><th>Company</th><th>Stage</th><th>Tags</th><th>AI Score</th><th>Phone</th><th>Last Updated</th><th>Actions</th></tr></thead>""",
    tag='contacts table header')
rep("""            <td>${esc(c.company||'—')}</td>
            <td>${stageBadge(c.stage)}</td>
            <td>${aiScoreBadge(c.ai_score)}</td>""",
"""            <td>${esc(c.company||'—')}</td>
            <td>${stageBadge(c.stage)}</td>
            <td>${String(c.tags||'').split(',').map(t=>t.trim()).filter(Boolean).slice(0,3).map(t=>`<span class="badge badge-purple" style="font-size:9px;margin-right:3px">${esc(t)}</span>`).join('')||'<span style="color:var(--text3);font-size:11px">—</span>'}</td>
            <td>${aiScoreBadge(c.ai_score)}</td>""",
    tag='contacts table tags cell')
rep("""          </tr>`).join('') : '<tr><td colspan="7"><div class="empty-state">No contacts found</div></td></tr>'}""",
"""          </tr>`).join('') : '<tr><td colspan="8"><div class="empty-state">No contacts found</div></td></tr>'}""",
    tag='contacts colspan')

# ── 7. viewContact: show tags + custom fields ──
rep("""        ${c.notes?`<div class="form-group"><label>Notes</label><div style="font-size:13px;color:var(--text2);line-height:1.6;background:var(--card2);padding:10px;border-radius:8px">${esc(c.notes)}</div></div>`:''}""",
"""        ${String(c.tags||'').split(',').map(t=>t.trim()).filter(Boolean).length?`<div class="form-group"><label>Tags</label><div>${String(c.tags||'').split(',').map(t=>t.trim()).filter(Boolean).map(t=>`<span class="badge badge-purple" style="margin-right:4px">${esc(t)}</span>`).join('')}</div></div>`:''}
        ${c.custom_fields && Object.keys(c.custom_fields).length?`<div class="form-group"><label>Custom Fields</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${Object.entries(c.custom_fields).map(([k,v])=>`<div style="background:var(--card2);padding:8px 10px;border-radius:8px;font-size:12px"><span style="color:var(--text3);font-weight:600">${esc(k)}:</span> ${esc(v)}</div>`).join('')}</div></div>`:''}
        ${c.notes?`<div class="form-group"><label>Notes</label><div style="font-size:13px;color:var(--text2);line-height:1.6;background:var(--card2);padding:10px;border-radius:8px">${esc(c.notes)}</div></div>`:''}""",
    tag='viewContact tags/custom fields')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 9 done.')
