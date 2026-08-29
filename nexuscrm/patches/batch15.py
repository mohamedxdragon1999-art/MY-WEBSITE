#!/usr/bin/env python3
"""Frontend batch 15: AI agent chat commands, forecast, voice notes, calendar drafts, entity AI, snippets."""
import sys
P = 'NexusCRM_V4_Hardened.html'
s = open(P, encoding='utf-8').read()

def rep(old, new, tag):
    global s
    n = s.count(old)
    if n != 1:
        print(f'❌ [{tag}] found {n}'); print('OLD:', repr(old[:100])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

# ── 1. Agent command chips in chat panel ──
rep("""  <div class="chat-input-area" style="padding:10px">
    <div class="chat-input-wrap" style="border-radius:12px">
      <textarea class="chat-input" id="panel-input" placeholder="Ask anything..." rows="1" onkeydown="panelKeydown(event)" oninput="autoResize(this)"></textarea>
    </div>
    <button class="btn btn-ai" onclick="sendPanelMessage()" style="padding:8px 14px;border-radius:10px;flex-shrink:0">➤</button>
  </div>""",
"""  <div class="chat-input-area" style="padding:10px">
    <div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap">
      <button class="btn btn-secondary" style="font-size:10px;padding:3px 8px" onclick="agentChip('/task ')">➕ Task</button>
      <button class="btn btn-secondary" style="font-size:10px;padding:3px 8px" onclick="agentChip('/contact ')">👤 Contact</button>
      <button class="btn btn-secondary" style="font-size:10px;padding:3px 8px" onclick="agentChip('/deal ')">🎯 Deal</button>
      <button class="btn btn-secondary" style="font-size:10px;padding:3px 8px" onclick="agentChip('/forecast')">💰 Forecast</button>
      <button class="btn btn-secondary" style="font-size:10px;padding:3px 8px" onclick="agentChip('/weekly')">🗓️ Weekly</button>
    </div>
    <div class="chat-input-wrap" style="border-radius:12px">
      <textarea class="chat-input" id="panel-input" placeholder="Ask anything… or use /task, /contact, /deal, /forecast" rows="1" onkeydown="panelKeydown(event)" oninput="autoResize(this)"></textarea>
    </div>
    <button class="btn btn-ai" onclick="sendPanelMessage()" style="padding:8px 14px;border-radius:10px;flex-shrink:0">➤</button>
  </div>""",
'agent chips')

# ── 2. Agent execution in sendPanelMessage + agentChip helper ──
rep("""function clearPanelChat() {""",
"""function agentChip(cmd) {
  const input = V('panel-input');
  if (!input) return;
  input.value = cmd;
  input.focus();
  if (cmd === '/forecast' || cmd === '/weekly') sendPanelMessage();
}
// Runs a natural-language command through the AI Agent (creates tasks,
// contacts, deals, appointments, sends email drafts, forecast, weekly review).
async function runAgentCommand(text) {
  const r = await api('/ai/agent', 'POST', { message: text });
  return r;
}
function clearPanelChat() {""",
'agentChip + runAgentCommand')

rep("""  try {
    const ctx = `User is on the ${STATE.view} page. User: ${STATE.user?.name}.`;
    const history = STATE.panelMessages.slice(-10);
    const res = await chatStreamFetch(history, ctx);""",
"""  try {
    // Agent mode: messages starting with "/" are CRM commands the AI executes.
    if (text.startsWith('/')) {
      const agentRes = await api('/ai/agent', 'POST', { message: text.slice(1) });
      typing.remove();
      const badge = agentRes.action && agentRes.action !== 'none'
        ? `<div style="font-size:10px;color:var(--green);font-weight:700;margin-top:4px">✅ ${esc(agentRes.action.replace(/_/g,' '))}</div>` : '';
      addPanelMsg('assistant', agentRes.reply || 'Done!');
      const last = STATE.panelMessages[STATE.panelMessages.length - 1];
      if (last && last.role === 'assistant') last.action = agentRes.action;
      return;
    }
    const ctx = `User is on the ${STATE.view} page. User: ${STATE.user?.name}.`;
    const history = STATE.panelMessages.slice(-10);
    const res = await chatStreamFetch(history, ctx);""",
'agent in sendPanelMessage')

# ── 3. AI Tools additions: forecast + snippets + calendar drafts ──
rep("""  {id:'weeklyreview',icon:'🗓️',name:'Weekly Business Review',desc:'Structured review of wins, gaps, next week',badge:'Weekly'}
];""",
"""  {id:'weeklyreview',icon:'🗓️',name:'Weekly Business Review',desc:'Structured review of wins, gaps, next week',badge:'Weekly'},
  {id:'forecast',icon:'📊',name:'Sales Forecast',desc:'30/60/90-day expected revenue from your pipeline',badge:'Live'},
  {id:'snippets',icon:'📌',name:'Snippets Library',desc:'Save and reuse your best AI outputs',badge:'Library'}
];""",
'AI_TOOLS forecast/snippets')

rep("""    weeklyreview:async()=>{""",
"""    forecast:async()=>{toast('Crunching your pipeline...','info',5000);try{const f=await api('/ai/forecast');closeModal();openModal(`<div class="modal-header"><div class="modal-title">📊 Sales Forecast</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">${f.buckets.map(b=>`<div class="card card-sm" style="text-align:center"><div style="font-size:11px;color:var(--text3);text-transform:uppercase;font-weight:600">${esc(b.label)}</div><div style="font-size:19px;font-weight:800;color:var(--green);margin-top:4px">${$$$(b.value)}</div><div style="font-size:10px;color:var(--text3)">${b.count} deal(s)</div></div>`).join('')}</div>
      <div style="font-size:14px;font-weight:700;margin-bottom:6px">Total expected: ${$$$(f.total_weighted)}</div>
      ${f.narrative?`<div class="ai-insight"><div class="ai-insight-title">🤖 AI Read</div><div class="ai-insight-text">${esc(f.narrative)}</div></div>`:''}
    </div>`);}catch(e){toast(e.message,'error');}},
    snippets:openSnippets,
    weeklyreview:async()=>{""",
'forecast tool')

# ── 4. Snippets library + save helpers ──
rep("""// New V5 AI tool handlers""",
"""// ── SNIPPETS LIBRARY (localStorage — your best AI outputs, reusable) ──
function getSnippets() { try { return JSON.parse(localStorage.getItem('nx_snippets') || '[]'); } catch { return []; } }
function saveSnippet(text) {
  const snips = getSnippets();
  snips.unshift({ id: Date.now(), text: String(text || '').slice(0, 4000), at: new Date().toISOString() });
  localStorage.setItem('nx_snippets', JSON.stringify(snips.slice(0, 50)));
  toast('Saved to Snippets 📌','success');
}
function openSnippets() {
  const snips = getSnippets();
  openModal(`<div class="modal-header"><div class="modal-title">📌 Snippets Library</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Save a new snippet</label><textarea id="snip-new" rows="3" placeholder="Paste any text you want to keep..."></textarea>
      <button class="btn btn-ai btn-sm" style="margin-top:8px" onclick="addSnippetNow()">📌 Save Snippet</button></div>
      <div style="font-size:12px;color:var(--text3);margin:14px 0 8px;font-weight:700">YOUR SNIPPETS (${snips.length})</div>
      <div style="max-height:340px;overflow-y:auto;display:flex;flex-direction:column;gap:8px">
        ${snips.length ? snips.map(x=>`<div class="card card-sm" style="padding:10px">
          <div style="font-size:12px;color:var(--text2);white-space:pre-wrap;max-height:90px;overflow-y:auto">${esc(x.text.slice(0,300))}${x.text.length>300?'…':''}</div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${escAttr(x.text)}');toast('Copied!','success')">📋 Copy</button>
            <button class="btn btn-danger btn-sm" onclick="deleteSnippet(${x.id})">✕</button>
          </div></div>`).join('') : '<div class="empty-state" style="padding:18px"><div class="empty-text">No snippets yet — use "Save to Snippets" on AI outputs.</div></div>'}
      </div>
    </div>`, 'modal-lg');
}
function addSnippetNow() {
  const t = V('snip-new')?.value?.trim();
  if (!t) { toast('Paste something first','error'); return; }
  saveSnippet(t);
  openSnippets();
}
function deleteSnippet(id) {
  const snips = getSnippets().filter(x => x.id !== id);
  localStorage.setItem('nx_snippets', JSON.stringify(snips));
  openSnippets();
}

// New V5 AI tool handlers""",
'snippets')

# ── 5. "Save to Snippets" in rewrite + email gen results ──
rep("""<div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div><button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="navigator.clipboard.writeText('${escAttr(r.content)}');toast('Copied!','success')">📋 Copy</button></div>`,'modal-lg');}catch(e){toast(e.message,'error');}}

// AI tool handlers""",
"""<div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div><div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${escAttr(r.content)}');toast('Copied!','success')">📋 Copy</button><button class="btn btn-ai btn-sm" onclick="saveSnippet('${escAttr(r.content)}')">📌 Save</button></div></div>`,'modal-lg');}catch(e){toast(e.message,'error');}}

// AI tool handlers""",
'rewrite save snippet')

rep("""<div class="modal-header"><div class="modal-title">📧 Email</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div></div>`);}catch(e){toast(e.message,'error');}}""",
"""<div class="modal-header"><div class="modal-title">📧 Email</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div><div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${escAttr(r.content)}');toast('Copied!','success')">📋 Copy</button><button class="btn btn-ai btn-sm" onclick="saveSnippet('${escAttr(r.content)}')">📌 Save</button></div></div>`);}catch(e){toast(e.message,'error');}}""",
'emailgen save snippet')

# ── 6. Voice notes (Web Speech API) in Voice AI view ──
rep("""        <div class="form-group"><label>Paste transcript / meeting notes</label><textarea id="voice-transcript" rows="7" placeholder="Paste transcript here..."></textarea></div>""",
"""        <div class="form-group"><label>Paste transcript / meeting notes — or record a voice note 🎙️</label><textarea id="voice-transcript" rows="7" placeholder="Paste transcript here, or click Record and speak..."></textarea></div>
        <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
          <button class="btn btn-gmail btn-sm" id="voice-record-btn" onclick="toggleVoiceRecord()">🎙️ Record Voice Note</button>
          <span id="voice-record-status" style="font-size:11px;color:var(--text3)">Works in Chrome/Edge (free, on-device speech recognition)</span>
        </div>""",
'voice record ui')

rep("""async function aiSummarizeTranscript() {""",
"""// ── VOICE NOTES → TRANSCRIPT → AI (free Web Speech API, Chrome/Edge) ──
let voiceRec = null;
function toggleVoiceRecord() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice recording needs Chrome or Edge','error'); return; }
  if (voiceRec && voiceRec.recording) { voiceRec.stop(); return; }
  voiceRec = new SR();
  voiceRec.lang = 'en-US';
  voiceRec.interimResults = false;
  voiceRec.maxAlternatives = 1;
  voiceRec.recording = true;
  const status = V('voice-record-status');
  const btn = V('voice-record-btn');
  if (status) status.textContent = '🔴 Listening… click again to stop';
  if (btn) btn.textContent = '⏹ Stop Recording';
  voiceRec.onresult = (e) => {
    const txt = e.results?.[0]?.[0]?.transcript || '';
    const ta = V('voice-transcript');
    if (ta && txt) { ta.value = (ta.value ? ta.value + '\\n' : '') + txt; toast('Voice note captured ✅','success'); }
  };
  voiceRec.onerror = (e) => { if (status) status.textContent = '⚠️ ' + (e.error === 'not-allowed' ? 'Microphone blocked — allow access and retry' : e.error); };
  voiceRec.onend = () => { voiceRec.recording = false; if (status) status.textContent = 'Works in Chrome/Edge (free, on-device speech recognition)'; if (btn) btn.textContent = '🎙️ Record Voice Note'; };
  try { voiceRec.start(); } catch { /* already started */ }
}
async function aiSummarizeTranscript() {""",
'voice record logic')

# ── 7. Content calendar → save as drafts ──
rep("""async function doCalendar(){const t=V('cal-topic')?.value;if(!t){toast('Enter topic','error');return;}toast('Building calendar...','info',10000);try{const r=await api('/ai/complete','POST',{prompt:`Create a 30-day social media content calendar for: "${t}". Format as Day 1, Day 2... with Platform, Post type, and Hook for each day.`,max_tokens:2000});closeModal();openModal(`<div class="modal-header"><div class="modal-title">📅 30-Day Calendar</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:12px;line-height:1.8;color:var(--text2);max-height:600px;overflow-y:auto">${esc(r.content)}</div></div>`,'modal-xl');}catch(e){toast(e.message,'error');}}""",
"""async function doCalendar(){const t=V('cal-topic')?.value;if(!t){toast('Enter topic','error');return;}toast('Building calendar...','info',10000);try{const r=await api('/ai/complete','POST',{prompt:`Create a 7-day social media content calendar for: "${t}". Format each day exactly as: "DAY 1 - [Platform] - [Post text/hook]". Use LinkedIn, Twitter/X, Instagram and Facebook across the week.`,max_tokens:1600});closeModal();window.__calContent=r.content;openModal(`<div class="modal-header"><div class="modal-title">📅 7-Day Calendar</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:12px;line-height:1.8;color:var(--text2);max-height:420px;overflow-y:auto">${esc(r.content)}</div><button class="btn btn-success" style="margin-top:12px;width:100%" onclick="saveCalendarDrafts()">💾 Save all as Social Drafts</button></div>`,'modal-xl');}catch(e){toast(e.message,'error');}}
async function saveCalendarDrafts() {
  const content = window.__calContent || '';
  const dayBlocks = content.split(/DAY\s*\d+/i).map(x => x.trim()).filter(Boolean);
  if (!dayBlocks.length) { toast('Nothing to save — generate the calendar first','error'); return; }
  let saved = 0;
  for (const block of dayBlocks) {
    const platform = (block.match(/linkedin/i) ? 'linkedin' : block.match(/twitter|x\b/i) ? 'twitter' : block.match(/instagram/i) ? 'instagram' : block.match(/facebook/i) ? 'facebook' : 'linkedin');
    const postText = block.replace(/^[-–—\s]*\[[^\]]*\]\s*/i, '').replace(/^[-–—\s]*/,'').slice(0, 2000);
    if (!postText) continue;
    try { await api('/social','POST',{platform, content: postText, status:'draft', ai_generated:1}); saved++; } catch {}
  }
  toast(`Saved ${saved} posts as social drafts ✅`,'success',6000);
  closeModal();
}""",
'calendar drafts')

# ── 8. Task row AI button + handler ──
rep("""          <td><button class="btn btn-danger btn-sm" onclick="deleteTask(${t.id})">✕</button></td>""",
"""          <td><div style="display:flex;gap:4px"><button class="btn btn-ai btn-sm" title="AI: write the follow-up email for this task" onclick="aiTaskEmail(${t.id},'${escAttr(t.title)}','${escAttr(t.description||'')}','${escAttr(t.contact_name||'')}')">🤖</button><button class="btn btn-danger btn-sm" onclick="deleteTask(${t.id})">✕</button></div></td>""",
'task AI button')

rep("""async function aiPrioritizeTasks() {""",
"""async function aiTaskEmail(id, title, desc, contactName) {
  toast('Writing your follow-up email...','info');
  try {
    const ctx = `Follow up on the task: "${title}". ${desc ? 'Details: ' + desc : ''}`;
    const r = await api('/ai/generate','POST',{type:'followup_email', context:ctx, target: contactName || undefined});
    openModal(`<div class="modal-header"><div class="modal-title">📧 Follow-up Email</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body"><textarea id="task-email-body" style="width:100%;min-height:180px">${esc(r.content)}</textarea></div>
      <div class="modal-footer" style="gap:8px">
        <button class="btn btn-ai btn-sm" onclick="saveSnippet(V('task-email-body').value)">📌 Save</button>
        <button class="btn btn-secondary" onclick="navigator.clipboard.writeText(V('task-email-body').value);toast('Copied!','success')">📋 Copy</button>
        <button class="btn btn-gmail" onclick="saveTaskEmailToCRM(${id})">💾 Save to CRM</button>
        <button class="btn btn-primary" onclick="closeModal()">Done</button>
      </div>`, 'modal-lg');
  } catch(e) { toast(e.message,'error'); }
}
async function saveTaskEmailToCRM(taskId) {
  const body = V('task-email-body')?.value;
  if (!body) { toast('Nothing to save','error'); return; }
  try {
    await api('/messages','POST',{channel:'email',subject:'Follow-up',body,direction:'outbound',ai_generated:1});
    toast('Saved to CRM Messages ✅','success'); closeModal();
  } catch(e) { toast(e.message,'error'); }
}
async function aiPrioritizeTasks() {""",
'task AI handler')

# ── 9. Deal detail AI status email button ──
rep("""          <button class="btn btn-ai btn-sm" onclick="scoreContact(${c.id})">🤖 AI Score</button>""",
"""          <button class="btn btn-ai btn-sm" onclick="scoreContact(${c.id})">🤖 AI Score</button>""",
'noop deal anchor (see below)')

# deal detail modal: add AI update button near Save Changes
rep("""      <div class="modal-footer">
        <button class="btn btn-danger" onclick="deleteDeal(${deal.id})">Delete</button>
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="updateDeal(${deal.id})">Save Changes</button>
      </div>`);""",
"""      <div class="modal-footer">
        <button class="btn btn-danger" onclick="deleteDeal(${deal.id})">Delete</button>
        <button class="btn btn-ai" onclick="aiDealUpdate(${deal.id})">📧 AI Update Email</button>
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="updateDeal(${deal.id})">Save Changes</button>
      </div>`);""",
'deal AI button')

rep("""async function updateDeal(id) {""",
"""async function aiDealUpdate(id) {
  try {
    const d2 = await api('/deals');
    const deal = (d2.deals||[]).find(x=>x.id===id); if(!deal) return;
    toast('Writing a status update email...','info');
    const r = await api('/ai/generate','POST',{type:'followup_email', context:`Status update on deal "${deal.title}" — currently at stage ${deal.stage}, value ${deal.value||0}, probability ${deal.probability||0}%.`, target: deal.contact_name || undefined});
    openModal(`<div class="modal-header"><div class="modal-title">📧 Deal Status Email</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body"><textarea id="deal-email-body" style="width:100%;min-height:160px">${esc(r.content)}</textarea></div>
      <div class="modal-footer" style="gap:8px">
        <button class="btn btn-ai btn-sm" onclick="saveSnippet(V('deal-email-body').value)">📌 Save</button>
        <button class="btn btn-secondary" onclick="navigator.clipboard.writeText(V('deal-email-body').value);toast('Copied!','success')">📋 Copy</button>
        <button class="btn btn-gmail" onclick="saveDealEmailToCRM()">💾 Save to CRM</button>
        <button class="btn btn-primary" onclick="closeModal()">Done</button>
      </div>`, 'modal-lg');
  } catch(e) { toast(e.message,'error'); }
}
async function saveDealEmailToCRM() {
  const body = V('deal-email-body')?.value;
  if (!body) { toast('Nothing to save','error'); return; }
  try {
    await api('/messages','POST',{channel:'email',subject:'Deal update',body,direction:'outbound',ai_generated:1});
    toast('Saved to CRM Messages ✅','success'); closeModal();
  } catch(e) { toast(e.message,'error'); }
}
async function updateDeal(id) {""",
'deal AI handler')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 15 done.')
