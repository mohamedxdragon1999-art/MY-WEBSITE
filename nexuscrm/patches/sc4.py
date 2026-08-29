#!/usr/bin/env python3
"""Super-cycle 4 (cycles 10-14): frontend for AI-on-data + agent quick actions."""
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

# ── C10: Contact detail — AI Summary + Tag Suggest buttons ──
rep("""          ${c.email?`<button class="btn btn-gmail btn-sm" onclick="closeModal();quickEmailContact('${escAttr(c.email)}','${escAttr(c.name)}')">📧 Email</button>`:''}
          <button class="btn btn-ai btn-sm" onclick="scoreContact(${c.id})">🤖 AI Score</button>
          <button class="btn btn-secondary btn-sm" onclick="closeModal();openAddDeal(${c.id},'${escAttr(c.name)}')">+ Deal</button>""",
"""          ${c.email?`<button class="btn btn-gmail btn-sm" onclick="closeModal();quickEmailContact('${escAttr(c.email)}','${escAttr(c.name)}')">📧 Email</button>`:''}
          <button class="btn btn-ai btn-sm" onclick="scoreContact(${c.id})">🤖 AI Score</button>
          <button class="btn btn-ai btn-sm" onclick="contactAISummary(${c.id},'${escAttr(c.name)}')">📋 AI Summary</button>
          <button class="btn btn-secondary btn-sm" onclick="contactAITags(${c.id},'${escAttr(c.name)}')">🏷️ AI Tags</button>
          <button class="btn btn-secondary btn-sm" onclick="closeModal();openAddDeal(${c.id},'${escAttr(c.name)}')">+ Deal</button>""",
'contact AI buttons')

rep("""async function aiTaskEmail(id, title, desc, contactName) {""",
"""// ── C10: Contact AI Summary + Tag Suggestions ──
async function contactAISummary(id, name) {
  toast(`AI analyzing ${name}'s history...`,'info',8000);
  try {
    const r = await api(`/ai/contact-summary/${id}`);
    openModal(`<div class="modal-header"><div class="modal-title">📋 Relationship Summary — ${esc(name)}</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body"><div class="ai-insight"><div class="ai-insight-text" style="white-space:pre-wrap;line-height:1.8">${esc(r.summary)}</div></div></div>`,'modal-lg');
  } catch(e) { toast('Summary failed: '+e.message,'error'); }
}
async function contactAITags(id, name) {
  toast('Suggesting tags...','info',6000);
  try {
    const r = await api(`/ai/tag-suggest/${id}`);
    const tags = r.tags || [];
    if (!tags.length) { toast('No tag suggestions — try again.','info'); return; }
    openModal(`<div class="modal-header"><div class="modal-title">🏷️ Suggested Tags — ${esc(name)}</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${tags.map(t=>`<span class="badge badge-purple" style="padding:6px 12px;font-size:12px">${esc(t)}</span>`).join('')}</div>
        <button class="btn btn-primary" onclick="applySuggestedTags(${id},'${escAttr(tags.join(','))}')">✅ Apply These Tags</button>
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      </div>`);
  } catch(e) { toast('Tag suggest failed: '+e.message,'error'); }
}
async function applySuggestedTags(id, tags) {
  try {
    await api(`/contacts/${id}`,'PATCH',{ tags });
    closeModal(); toast('Tags applied ✅','success');
  } catch(e) { toast(e.message,'error'); }
}
async function aiTaskEmail(id, title, desc, contactName) {""",
'contact AI handlers')

# ── C11: Messages view — Smart Reply button per inbound row ──
rep("""          <td>${esc(m.subject||'—')}</td>
          <td style="font-size:12px;color:var(--text2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((m.body||'').slice(0,80))}</td>""",
"""          <td>${esc(m.subject||'—')}${m.direction==='inbound'?` <button class="btn btn-ai btn-sm" style="padding:2px 8px;font-size:10px" title="AI Smart Reply" onclick="event.stopPropagation();smartReplyFor('${escAttr((m.body||'').slice(0,300))}')">🤖</button>`:''}</td>
          <td style="font-size:12px;color:var(--text2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((m.body||'').slice(0,80))}</td>""",
'messages smart reply button')

rep("""function viewCRMMessage(id) {""",
"""async function smartReplyFor(text) {
  toast('Drafting reply options...','info',6000);
  try {
    const r = await api('/ai/smart-reply','POST',{ text });
    const opts = r.options || [];
    window.__smartReplies = opts;
    openModal(`<div class="modal-header"><div class="modal-title">🤖 Smart Replies</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        <div style="display:flex;flex-direction:column;gap:10px">
          ${opts.map((o,i)=>`<div class="card card-sm" style="cursor:pointer" onclick="useSmartReply(${i})"><div style="font-size:12px;color:var(--text3);margin-bottom:4px">Option ${i+1} — click to use</div><div style="font-size:13px;color:var(--text2);white-space:pre-wrap">${esc(o)}</div></div>`).join('')}
        </div>
      </div>`,'modal-lg');
  } catch(e) { toast('Smart reply failed: '+e.message,'error'); }
}
function useSmartReply(i) {
  const t = (window.__smartReplies||[])[i];
  if (!t) { closeModal(); return; }
  if (STATE.gmailToken) { openGmailCompose(); setTimeout(()=>{ if(V('compose-body')) V('compose-body').value = t; },150); }
  else { navigator.clipboard?.writeText(t).then(()=>toast('Reply copied — paste it into your email! 📋','success')); }
  closeModal();
}
function viewCRMMessage(id) {""",
'smart reply handlers')

# ── C12: Tasks — AI rank column + data-id on rows ──
rep("""        <thead><tr><th style="width:30px"></th><th>Task</th><th>Contact</th><th>Priority</th><th>Due Date</th><th>Actions</th></tr></thead>""",
"""        <thead><tr><th style="width:30px"></th><th>Task</th><th>Contact</th><th>Priority</th><th>AI Rank</th><th>Due Date</th><th>Actions</th></tr></thead>""",
'tasks header AI rank')

rep("""        <tbody>${tasks.length ? tasks.map(t=>`<tr data-status="${t.status}" style="${t.status==='done'?'opacity:.55':''}">  """,
"""        <tbody>${tasks.length ? tasks.map(t=>`<tr data-status="${t.status}" data-id="${t.id}" style="${t.status==='done'?'opacity:.55':''}">  """,
'tasks row data-id')

rep("""          <td>${priorityBadge(t.priority)}</td>
          <td style="font-size:12px">${t.due_date||'—'}</td>""",
"""          <td>${priorityBadge(t.priority)}</td>
          <td class="ai-rank-cell" style="font-size:12px">—</td>
          <td style="font-size:12px">${t.due_date||'—'}</td>""",
'tasks AI rank cell')

rep("""  } catch(e) { content(`<div class="card"><p>Error: ${e.message}</p></div>`); }
};
function filterTasks(status,tabEl) {""",
"""    api('/ai/score-tasks').then(r=>{
      const map = {};
      (r.tasks||[]).forEach(x => { if (x && x.id) map[x.id] = x; });
      window.__taskScores = map;
      document.querySelectorAll('#tasks-table tbody tr[data-id]').forEach(row => {
        const cell = row.querySelector('.ai-rank-cell');
        const sc = map[parseInt(row.getAttribute('data-id'))];
        if (cell && sc) cell.innerHTML = `<span class="badge ${sc.score>=70?'badge-red':sc.score>=40?'badge-yellow':'badge-gray'}" title="${esc(sc.reason||'')}">${sc.score}</span>`;
      });
    }).catch(()=>{});
  } catch(e) { content(`<div class="card"><p>Error: ${e.message}</p></div>`); }
};
function filterTasks(status,tabEl) {""",
'tasks AI score load')

# ── C13: Pipeline — risk badge on stale deals ──
rep("""          <button class="btn btn-ai btn-sm" onclick="aiAnalyzePipeline()">🤖 AI Analyze</button>
          <button class="btn btn-primary" onclick="openAddDeal()">+ Add Deal</button>""",
"""          <button class="btn btn-ai btn-sm" onclick="aiAnalyzePipeline()">🤖 AI Analyze</button>
          <button class="btn btn-secondary btn-sm" onclick="showDealRisks()">🚨 AI Risks</button>
          <button class="btn btn-primary" onclick="openAddDeal()">+ Add Deal</button>""",
'pipeline risks button')

rep("""function dragDeal(e,id) { dragId=id; e.dataTransfer.effectAllowed='move'; }""",
"""async function showDealRisks() {
  toast('Scanning for risky deals...','info',5000);
  try {
    const r = await api('/ai/deal-risks');
    const risks = r.risks || [];
    if (!risks.length) { toast('No risky deals found 🎉','success'); return; }
    openModal(`<div class="modal-header"><div class="modal-title">🚨 Deal Risks</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        ${risks.map(x=>`<div class="card card-sm" style="margin-bottom:8px;display:flex;align-items:center;gap:10px">
          <span class="badge ${x.risk==='stale'?'badge-red':'badge-yellow'}">${x.risk==='stale'?`${x.age_days}d stale`:'low %'}</span>
          <div style="flex:1"><div style="font-weight:600;font-size:13px">${esc(x.title)}</div><div style="font-size:11px;color:var(--text3)">${esc(x.note)}</div></div>
          <button class="btn btn-secondary btn-sm" onclick="closeModal();openDealDetail(${x.id})">Open</button>
        </div>`).join('')}
      </div>`, 'modal-lg');
  } catch(e) { toast(e.message,'error'); }
}
function dragDeal(e,id) { dragId=id; e.dataTransfer.effectAllowed='move'; }""",
'deal risks handler')

# ── C14: Agent quick actions under assistant replies + remember chip ──
rep("""      <button class="btn btn-secondary" style="font-size:10px;padding:3px 8px" onclick="agentChip('/weekly')">🗓️ Weekly</button>""",
"""      <button class="btn btn-secondary" style="font-size:10px;padding:3px 8px" onclick="agentChip('/weekly')">🗓️ Weekly</button>
      <button class="btn btn-secondary" style="font-size:10px;padding:3px 8px" onclick="agentChip('/remember ')">🧠 Remember</button>""",
'remember chip')

rep("""        const badge = agentRes.action && agentRes.action !== 'none'
          ? `<div style="font-size:10px;color:var(--green);font-weight:700;margin-top:4px">✅ ${esc(agentRes.action.replace(/_/g,' '))}</div>` : '';
        addPanelMsg('assistant', (agentRes.reply || 'Done!') + badge);""",
"""        const badge = agentRes.action && agentRes.action !== 'none'
          ? `<div style="font-size:10px;color:var(--green);font-weight:700;margin-top:4px">✅ ${esc(agentRes.action.replace(/_/g,' '))}</div>` : '';
        addPanelMsg('assistant', (agentRes.reply || 'Done!') + badge);
        if (agentRes.action === 'remember') { STATE.panelMessages = STATE.panelMessages.filter(m => m !== (STATE.panelMessages[STATE.panelMessages.length-1])); }""",
'remember chip dedupe')

open(P, 'w', encoding='utf-8').write(s)
print('Super-cycle 4 done.')
