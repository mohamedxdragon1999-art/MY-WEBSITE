#!/usr/bin/env python3
"""Batch 4: contacts/WA/reviews escaping, real saveReviewReply, CSV, bulk WA, logout, backup nudge."""
import sys
P = 'NexusCRM_V4_Hardened.html'
s = open(P, encoding='utf-8').read()

def rep(old, new, count=1, tag=''):
    global s
    n = s.count(old)
    if n != count:
        print(f'❌ [{tag}] expected {count}, found {n}'); print('   OLD:', repr(old[:100])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

# ── Contacts table: escape data, escape onclick attrs ──
rep("""          ${contacts.length ? contacts.map(c=>`<tr>
            <td><div style="display:flex;align-items:center;gap:8px">
              <div style="width:30px;height:30px;background:linear-gradient(135deg,var(--accent),var(--accent2));border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${(c.name[0]||'?').toUpperCase()}</div>
              <div><div style="font-weight:600">${c.name}</div><div style="font-size:11px;color:var(--text3)">${c.email||''}</div></div></div></td>
            <td>${c.company||'—'}</td>
            <td>${stageBadge(c.stage)}</td>
            <td>${aiScoreBadge(c.ai_score)}</td>
            <td>${c.phone ? `<a href="${waLink(c.phone)}" target="_blank" style="color:var(--green);text-decoration:none" title="Open WhatsApp chat">💚 ${c.phone}</a>` : '—'}</td>
            <td style="font-size:11px;color:var(--text3)">${timeAgo(c.updated_at)}</td>
            <td><div style="display:flex;gap:4px">
              <button class="btn btn-secondary btn-sm" onclick="viewContact(${c.id})">View</button>
              <button class="btn btn-ai btn-sm" onclick="scoreContact(${c.id})">🤖</button>
              ${c.email?`<button class="btn btn-gmail btn-sm" onclick="quickEmailContact('${c.email}','${c.name}')">📧</button>`:''}
              <button class="btn btn-danger btn-sm" onclick="deleteContact(${c.id})">✕</button>
            </div></td>
          </tr>`).join('') : '<tr><td colspan="7"><div class="empty-state">No contacts found</div></td></tr>'}""",
"""          ${contacts.length ? contacts.map(c=>`<tr>
            <td><div style="display:flex;align-items:center;gap:8px">
              <div style="width:30px;height:30px;background:linear-gradient(135deg,var(--accent),var(--accent2));border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${esc((c.name[0]||'?')).toUpperCase()}</div>
              <div><div style="font-weight:600">${esc(c.name)}</div><div style="font-size:11px;color:var(--text3)">${esc(c.email||'')}</div></div></div></td>
            <td>${esc(c.company||'—')}</td>
            <td>${stageBadge(c.stage)}</td>
            <td>${aiScoreBadge(c.ai_score)}</td>
            <td>${c.phone ? `<a href="${waLink(c.phone)}" target="_blank" style="color:var(--green);text-decoration:none" title="Open WhatsApp chat">💚 ${esc(c.phone)}</a>` : '—'}</td>
            <td style="font-size:11px;color:var(--text3)">${timeAgo(c.updated_at)}</td>
            <td><div style="display:flex;gap:4px">
              <button class="btn btn-secondary btn-sm" onclick="viewContact(${c.id})">View</button>
              <button class="btn btn-ai btn-sm" onclick="scoreContact(${c.id})">🤖</button>
              ${c.email?`<button class="btn btn-gmail btn-sm" onclick="quickEmailContact('${escAttr(c.email)}','${escAttr(c.name)}')">📧</button>`:''}
              <button class="btn btn-danger btn-sm" onclick="deleteContact(${c.id})">✕</button>
            </div></td>
          </tr>`).join('') : '<tr><td colspan="7"><div class="empty-state">No contacts found</div></td></tr>'}""",
tag='contacts table esc')

# ── viewContact: escape every field ──
rep("""    const c = await api(`/contacts/${id}`);
    openModal(`
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:44px;height:44px;background:linear-gradient(135deg,var(--accent),var(--accent2));border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;flex-shrink:0">${c.name[0].toUpperCase()}</div>
          <div><div class="modal-title">${c.name}</div><div style="font-size:12px;color:var(--text2)">${c.email||''} ${c.phone?'• '+c.phone:''} ${c.company?'• '+c.company:''}</div></div>
        </div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="grid grid-3" style="margin-bottom:16px">
          <div class="card card-sm"><div class="stat-label">Stage</div>${stageBadge(c.stage)}</div>
          <div class="card card-sm"><div class="stat-label">AI Score</div>${c.ai_score?aiScoreBadge(c.ai_score):'<span style="color:var(--text3);font-size:12px">Not scored</span>'}</div>
          <div class="card card-sm"><div class="stat-label">Deals</div><div style="font-weight:700">${c.deals?.length||0}</div></div>
        </div>
        ${c.ai_score_reason?`<div class="ai-insight" style="margin-bottom:14px"><div class="ai-insight-title">🤖 AI Analysis</div><div class="ai-insight-text">${c.ai_score_reason}</div></div>`:''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
          ${c.phone?`<a href="${waLink(c.phone,'Hi '+c.name)}" target="_blank" class="btn btn-success btn-sm">💚 WhatsApp</a>`:''}
          ${c.email?`<button class="btn btn-gmail btn-sm" onclick="closeModal();quickEmailContact('${c.email}','${c.name}')">📧 Email</button>`:''}
          <button class="btn btn-ai btn-sm" onclick="scoreContact(${c.id})">🤖 AI Score</button>
          <button class="btn btn-secondary btn-sm" onclick="closeModal();openAddDeal(${c.id},'${c.name}')">+ Deal</button>
        </div>
        ${c.notes?`<div class="form-group"><label>Notes</label><div style="font-size:13px;color:var(--text2);line-height:1.6;background:var(--card2);padding:10px;border-radius:8px">${c.notes}</div></div>`:''}
        ${c.deals?.length?`<div style="font-weight:600;margin-bottom:8px;font-size:13px">Deals (${c.deals.length})</div>${c.deals.map(d=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">${d.title} ${stageBadge(d.stage)} <span style="color:var(--green);font-weight:700">${$$$(d.value)}</span></div>`).join('')}`:''}
      </div>`, 'modal-lg');""",
"""    const c = await api(`/contacts/${id}`);
    openModal(`
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:44px;height:44px;background:linear-gradient(135deg,var(--accent),var(--accent2));border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;flex-shrink:0">${esc((c.name[0]||'?')).toUpperCase()}</div>
          <div><div class="modal-title">${esc(c.name)}</div><div style="font-size:12px;color:var(--text2)">${esc(c.email||'')} ${c.phone?'• '+esc(c.phone):''} ${c.company?'• '+esc(c.company):''}</div></div>
        </div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="grid grid-3" style="margin-bottom:16px">
          <div class="card card-sm"><div class="stat-label">Stage</div>${stageBadge(c.stage)}</div>
          <div class="card card-sm"><div class="stat-label">AI Score</div>${c.ai_score?aiScoreBadge(c.ai_score):'<span style="color:var(--text3);font-size:12px">Not scored</span>'}</div>
          <div class="card card-sm"><div class="stat-label">Deals</div><div style="font-weight:700">${c.deals?.length||0}</div></div>
        </div>
        ${c.ai_score_reason?`<div class="ai-insight" style="margin-bottom:14px"><div class="ai-insight-title">🤖 AI Analysis</div><div class="ai-insight-text">${esc(c.ai_score_reason)}</div></div>`:''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
          ${c.phone?`<a href="${waLink(c.phone,'Hi '+c.name)}" target="_blank" class="btn btn-success btn-sm">💚 WhatsApp</a>`:''}
          ${c.email?`<button class="btn btn-gmail btn-sm" onclick="closeModal();quickEmailContact('${escAttr(c.email)}','${escAttr(c.name)}')">📧 Email</button>`:''}
          <button class="btn btn-ai btn-sm" onclick="scoreContact(${c.id})">🤖 AI Score</button>
          <button class="btn btn-secondary btn-sm" onclick="closeModal();openAddDeal(${c.id},'${escAttr(c.name)}')">+ Deal</button>
        </div>
        ${c.notes?`<div class="form-group"><label>Notes</label><div style="font-size:13px;color:var(--text2);line-height:1.6;background:var(--card2);padding:10px;border-radius:8px">${esc(c.notes)}</div></div>`:''}
        ${c.deals?.length?`<div style="font-weight:600;margin-bottom:8px;font-size:13px">Deals (${c.deals.length})</div>${c.deals.map(d=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">${esc(d.title)} ${stageBadge(d.stage)} <span style="color:var(--green);font-weight:700">${$$$(d.value)}</span></div>`).join('')}`:''}
      </div>`, 'modal-lg');""",
tag='viewContact esc')

# ── WhatsApp contact list: escape name in onclick + display ──
rep("""          ${contacts.length ? contacts.map(c=>`
            <div class="nav-item" style="margin:0 0 2px;padding:10px;border:1px solid var(--border);border-radius:8px" onclick="selectWAContact(${c.id},'${c.name.replace(/'/g,"'")}','${waPhone(c.phone)}')"> 
              <div style="width:28px;height:28px;background:linear-gradient(135deg,var(--accent),var(--accent2));border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${c.name[0].toUpperCase()}</div>
              <div><div style="font-size:13px;font-weight:600">${c.name}</div><div style="font-size:11px;color:var(--text3)">${c.phone||'No phone'}</div></div>
            </div>`).join('') : '<div class="empty-state" style="padding:20px"><div class="empty-text">No contacts yet</div></div>'}""",
"""          ${contacts.length ? contacts.map(c=>`
            <div class="nav-item" style="margin:0 0 2px;padding:10px;border:1px solid var(--border);border-radius:8px" onclick="selectWAContact(${c.id},'${escAttr(c.name)}','${waPhone(c.phone)}')"> 
              <div style="width:28px;height:28px;background:linear-gradient(135deg,var(--accent),var(--accent2));border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${esc((c.name[0]||'?')).toUpperCase()}</div>
              <div><div style="font-size:13px;font-weight:600">${esc(c.name)}</div><div style="font-size:11px;color:var(--text3)">${esc(c.phone||'No phone')}</div></div>
            </div>`).join('') : '<div class="empty-state" style="padding:20px"><div class="empty-text">No contacts yet</div></div>'}""",
tag='wa list esc')

# ── Reviews: escape text in button, real saveReviewReply ──
rep("""            ${!r.ai_reply?`<button class="btn btn-ai btn-sm" onclick="aiReplyReview(${r.id},'${(r.text||'').replace(/'/g,'\\\\&apos;')}')">\\n🤖 AI Reply</button>`:''}""",
"""            ${!r.ai_reply?`<button class="btn btn-ai btn-sm" onclick="aiReplyReview(${r.id},'${escAttr(r.text||'')}')">\\n🤖 AI Reply</button>`:''}""",
tag='review reply esc')

rep("""async function saveReviewReply(id) { closeModal(); toast('Reply saved! ✅ Copy it to your review platform.','success'); views.reviews(); }""",
"""async function saveReviewReply(id) {
  const reply = V('ai-rv-reply')?.value?.trim();
  if (!reply) { toast('Write a reply first','error'); return; }
  try {
    await api(`/reviews/${id}`,'PATCH',{ ai_reply: reply, status: 'responded' });
    closeModal();
    toast('Reply saved to the review! ✅','success');
    views.reviews();
  } catch(e) { toast('Could not save reply: '+e.message,'error'); }
}""",
tag='saveReviewReply real')

# ── CSV import: use the real CSV parser ──
rep("""  const lines = raw.trim().split('\\n');
  const headers = lines[0].split(',').map(h=>h.trim().toLowerCase());
  let imported = 0, errors = 0;
  for (let i=1; i<lines.length; i++) {
    const vals = lines[i].split(',').map(v=>v.trim());
    const obj = {};
    headers.forEach((h,idx)=>obj[h]=vals[idx]||'');
    if (!obj.name) continue;
    try { await api('/contacts','POST',obj); imported++; }
    catch { errors++; }
  }""",
"""  const lines = raw.trim().split(/\\r?\\n/);
  const headers = parseCSVLine(lines[0] || '').map(h=>h.trim().toLowerCase());
  let imported = 0, errors = 0;
  for (let i=1; i<lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCSVLine(lines[i]).map(v=>v.trim());
    const obj = {};
    headers.forEach((h,idx)=>obj[h]=vals[idx]||'');
    if (!obj.name) continue;
    try { await api('/contacts','POST',obj); imported++; }
    catch { errors++; }
  }""",
tag='csv parser')

# ── Bulk WhatsApp: no more mass window.open (popup blocker) — show a link list ──
rep("""  toast(`Launching campaign for ${contacts.length} contacts...`,'info',5000);
  contacts.forEach((c,i)=>setTimeout(()=>window.open(waLink(c.phone, tpl.replace(/\\{name\\}/g,c.name)),'_blank'),i*1800));
}""",
"""  // Popup blockers kill mass window.open calls — instead show one modal with
  // one pre-filled wa.me link per contact; the user clicks each one.
  const links = contacts.map(c => ({
    name: c.name,
    href: waLink(c.phone, tpl.replace(/\\{name\\}/g, c.name)),
  }));
  openModal(`<div class="modal-header"><div class="modal-title">📢 Campaign Ready — ${links.length} messages</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div style="font-size:12px;color:var(--text2);margin-bottom:12px">Click each contact to open WhatsApp with the message pre-filled, then press Send. This keeps you in full control and avoids popup blockers.</div>
      <div style="max-height:420px;overflow-y:auto;display:flex;flex-direction:column;gap:6px">
        ${links.map(l=>`<a href="${l.href}" target="_blank" class="btn btn-secondary btn-sm" style="justify-content:space-between">💚 ${esc(l.name)}<span style="font-size:10px;color:var(--text3)">open →</span></a>`).join('')}
      </div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Close</button></div>`, 'modal-lg');
}""",
tag='bulk WA modal')

# ── doLogout: close websocket + clean state ──
rep("""function doLogout() {
  STATE.token = null; STATE.user = null; STATE.aiSettings = null;
  localStorage.removeItem('nx_token'); localStorage.removeItem('nx_user');
  V('auth-screen').style.display = 'flex';
  V('user-display-name').textContent = 'Loading...';
}""",
"""function doLogout() {
  STATE.token = null; STATE.user = null; STATE.aiSettings = null;
  localStorage.removeItem('nx_token'); localStorage.removeItem('nx_user');
  try { if (ws) { ws.onclose = null; ws.close(); } } catch {}
  ws = null;
  V('auth-screen').style.display = 'flex';
  V('user-display-name').textContent = 'Loading...';
}""",
tag='doLogout ws')

# ── Backup nudge: only nudge in local mode ──
rep("""function dashboardBackupNudge() {
  if (sessionStorage.getItem('nx_backup_nudge_dismissed')) return '';""",
"""function dashboardBackupNudge() {
  // With a real backend the data is in D1 — the local-storage nudge is moot.
  if (REAL_MODE()) return '';
  if (sessionStorage.getItem('nx_backup_nudge_dismissed')) return '';""",
tag='backup nudge gate')

# ── Invoice modal: contact picker ──
rep("""function openAddInvoice() {
  openModal(`<div class="modal-header"><div class="modal-title">New Invoice</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div id="inv-rows"><div style="display:grid;grid-template-columns:1fr 60px 90px 28px;gap:8px;margin-bottom:6px"><input placeholder="Item description" class="inv-desc"><input type="number" value="1" min="1" class="inv-qty" style="width:100%"><input type="number" value="0" min="0" class="inv-price" style="width:100%"><span></span></div></div>
      <button class="btn btn-secondary btn-sm" onclick="addInvRow()" style="margin-bottom:12px">+ Add Line</button>
      <div class="form-row"><div class="form-group"><label>Tax %</label><input id="inv-tax" type="number" value="0" min="0" max="100"></div><div class="form-group"><label>Due Date</label><input id="inv-due" type="date"></div></div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createInvoice()">Create Invoice</button></div>`, 'modal-lg');
}""",
"""async function openAddInvoice() {
  let contacts = [];
  try { const d = await api('/contacts?limit=2000'); contacts = d.contacts || []; } catch {}
  openModal(`<div class="modal-header"><div class="modal-title">New Invoice</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Bill To (contact)</label><select id="inv-contact"><option value="">— No contact —</option>${contacts.map(c=>`<option value="${c.id}">${escAttr(c.name)}${c.email?' — '+escAttr(c.email):''}</option>`).join('')}</select></div>
      <div id="inv-rows"><div style="display:grid;grid-template-columns:1fr 60px 90px 28px;gap:8px;margin-bottom:6px"><input placeholder="Item description" class="inv-desc"><input type="number" value="1" min="1" class="inv-qty" style="width:100%"><input type="number" value="0" min="0" class="inv-price" style="width:100%"><span></span></div></div>
      <button class="btn btn-secondary btn-sm" onclick="addInvRow()" style="margin-bottom:12px">+ Add Line</button>
      <div class="form-row"><div class="form-group"><label>Tax %</label><input id="inv-tax" type="number" value="0" min="0" max="100"></div><div class="form-group"><label>Due Date</label><input id="inv-due" type="date"></div></div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createInvoice()">Create Invoice</button></div>`, 'modal-lg');
}""",
tag='invoice contact picker')

rep("""  try { await api('/invoices','POST',{items,tax:parseFloat(V('inv-tax').value)||0,due_date:V('inv-due').value}); closeModal(); toast('Invoice created!','success'); views.invoices(); } catch(e) { toast(e.message,'error'); }""",
"""  const contactId = V('inv-contact')?.value ? parseInt(V('inv-contact').value) : null;
  try { await api('/invoices','POST',{items,contact_id:contactId,tax:parseFloat(V('inv-tax').value)||0,due_date:V('inv-due').value}); closeModal(); toast('Invoice created!','success'); views.invoices(); } catch(e) { toast(e.message,'error'); }""",
tag='createInvoice contact')

# ── ai-hub chat header: fix custom provider label ──
rep("""<div><div style="color:#fff;font-weight:700;font-size:15px">AI Chat</div><div style="color:rgba(255,255,255,.7);font-size:11px">${s?`${s.provider==='nvidia'?'NVIDIA NIM':'OpenAI'} • ${s.model||'Default'}`:''}</div></div>""",
"""<div><div style="color:#fff;font-weight:700;font-size:15px">AI Chat</div><div style="color:rgba(255,255,255,.7);font-size:11px">${s?`${s.provider==='nvidia'?'NVIDIA NIM':s.provider==='custom'?'Custom AI':'OpenAI'} • ${s.model||'Default'}`:''}</div></div>""",
tag='hub label custom')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 4 done.')
