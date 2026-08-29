#!/usr/bin/env python3
"""Super-cycle 6 (cycles 19-23): dashboard brief, AI feedback, snippets in compose, voice→tasks, local parity."""
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

# ── C19: Dashboard daily brief card (above forecast) ──
rep("""      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="font-weight:700">📈 AI Sales Forecast</div>""",
"""      <div class="card" style="margin-bottom:20px;background:linear-gradient(135deg,rgba(124,58,237,.12),rgba(99,102,241,.06));border-color:rgba(124,58,237,.3)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-weight:700">☀️ Today's AI Brief</div>
          <button class="btn btn-secondary btn-sm" onclick="loadDailyBrief(true)">🔄</button>
        </div>
        <div id="daily-brief"><div class="loading"><div class="spinner"></div></div></div>
      </div>
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="font-weight:700">📈 AI Sales Forecast</div>""",
'dashboard brief card')

rep("""    api('/ai/forecast').then(f=>{""",
"""    loadDailyBrief(false);
    api('/ai/forecast').then(f=>{""",
'load brief on dashboard')

rep("""async function completeTask(id, cb) {""",
"""async function loadDailyBrief(force) {
  const el = V('daily-brief'); if (!el) return;
  try {
    const r = await api('/ai/brief');
    const b = r.brief || '';
    el.innerHTML = `<div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(b)}</div>`;
  } catch { el.innerHTML = ''; }
}
async function completeTask(id, cb) {""",
'loadDailyBrief fn')

# ── C22: Feedback buttons under assistant chat bubbles ──
rep("""  const metaLine = (meta && role === 'assistant') ? `<div style="font-size:9px;color:var(--text3);margin-top:2px">via ${esc(meta.provider||'AI')} • ${esc(meta.model||'')}</div>` : '';
  div.innerHTML = `${av}<div><div class="msg-bubble">${esc(text).replace(/\\n/g,'<br>')}</div>${metaLine}<div class="msg-time">${t}</div></div>`;""",
"""  const metaLine = (meta && role === 'assistant') ? `<div style="font-size:9px;color:var(--text3);margin-top:2px">via ${esc(meta.provider||'AI')} • ${esc(meta.model||'')}</div>` : '';
  const fb = (role === 'assistant') ? `<div style="display:flex;gap:6px;margin-top:3px"><button class="btn btn-secondary btn-sm" style="padding:1px 7px;font-size:10px" onclick="rateAIReply(1,'${escAttr(meta?.provider||'')}','${escAttr(meta?.model||'')}')" title="Helpful">👍</button><button class="btn btn-secondary btn-sm" style="padding:1px 7px;font-size:10px" onclick="rateAIReply(-1,'${escAttr(meta?.provider||'')}','${escAttr(meta?.model||'')}')" title="Not helpful">👎</button></div>` : '';
  div.innerHTML = `${av}<div><div class="msg-bubble">${esc(text).replace(/\\n/g,'<br>')}</div>${metaLine}${fb}<div class="msg-time">${t}</div></div>`;""",
'feedback buttons')

rep("""let lastPanelMeta = null;""",
"""let lastPanelMeta = null;
async function rateAIReply(rating, provider, model) {
  try {
    await api('/ai/feedback','POST',{ rating, provider, model, op: 'chat' });
    toast(rating === 1 ? 'Thanks — glad it helped! 💜' : 'Thanks — we\'ll use that to improve.','success',2500);
  } catch { /* best-effort */ }
}""",
'rateAIReply fn')

# ── C23: Snippets insert into compose ──
rep("""      <div class="form-group"><label>Message</label><textarea id="compose-body" rows="8" placeholder="Write your email..."></textarea></div>
      <button class="btn btn-ai btn-sm" onclick="aiComposeEmail()" style="margin-bottom:8px">🤖 AI Write Email</button>""",
"""      <div class="form-group"><label>Message</label><textarea id="compose-body" rows="8" placeholder="Write your email..."></textarea></div>
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap"><button class="btn btn-ai btn-sm" onclick="aiComposeEmail()">🤖 AI Write Email</button><button class="btn btn-secondary btn-sm" onclick="insertSnippetIntoCompose()">📌 Insert Snippet</button></div>""",
'compose snippet button')

rep("""async function aiComposeEmail() {""",
"""function insertSnippetIntoCompose() {
  const snips = getSnippets();
  if (!snips.length) { toast('No snippets saved yet — save some AI outputs first!','info'); return; }
  openModal(`<div class="modal-header"><div class="modal-title">📌 Insert Snippet</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body"><div style="max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:8px">
      ${snips.slice(0,10).map((x,i)=>`<div class="card card-sm" style="cursor:pointer" onclick="pickSnippet(${i})"><div style="font-size:12px;color:var(--text2);white-space:pre-wrap;max-height:70px;overflow:hidden">${esc(x.text.slice(0,200))}${x.text.length>200?'…':''}</div></div>`).join('')}
    </div></div>`,'modal-lg');
  window.__snippetPick = snips;
}
function pickSnippet(i) {
  const t = (window.__snippetPick||[])[i]?.text;
  if (t && V('compose-body')) V('compose-body').value = (V('compose-body').value ? V('compose-body').value + '\\n\\n' : '') + t;
  closeModal();
}
async function aiComposeEmail() {""",
'insert snippet fn')

# ── C20: Voice AI — "Create tasks from transcript" button + handler ──
rep("""          <button class="btn btn-ai btn-sm" onclick="aiSummarizeTranscript()">🤖 Summarize</button>""",
"""          <button class="btn btn-ai btn-sm" onclick="aiSummarizeTranscript()">🤖 Summarize</button>
          <button class="btn btn-primary btn-sm" onclick="createTasksFromTranscript()">✅ Create Tasks</button>""",
'voice create tasks button')

rep("""async function aiActionItems() {""",
"""async function createTasksFromTranscript() {
  const t = V('voice-transcript')?.value;
  if (!t) { toast('Paste or record a transcript first','error'); return; }
  toast('Creating tasks from your notes...','info',10000);
  try {
    const r = await api('/ai/agent','POST',{ message: `Turn these notes into tasks (one per action item, with due dates when mentioned): ${t.slice(0,4000)}` });
    toast('✅ ' + (r.reply || 'Tasks created!'),'success',7000);
  } catch(e) { toast('Failed: '+e.message,'error'); }
}
async function aiActionItems() {""",
'voice create tasks fn')

# ── local parity: /ai/brief + /ai/feedback ──
rep("""  if (rawPath === '/ai/providers') {""",
"""  if (rawPath === '/ai/brief') {
    const dueToday = ws.tasks.filter(t=>t.status==='todo' && t.due_date === new Date().toISOString().slice(0,10));
    const overdue = ws.tasks.filter(t=>t.status==='todo' && t.due_date && t.due_date < new Date().toISOString().slice(0,10)).length;
    const apptsToday = ws.appointments.filter(a=>a.status==='scheduled' && a.date === new Date().toISOString().slice(0,10));
    const st = computeStats(ws);
    const brief = `• ${dueToday.length ? 'Tasks due today: ' + dueToday.map(t=>t.title).join(', ') : 'No tasks due today'}\\n• ${apptsToday.length ? 'Appointments: ' + apptsToday.map(a=>a.title).join(' · ') : 'No appointments today'}\\n• ${st.pending_tasks} open tasks · ${st.open_deals} deals worth ${'$' + st.pipeline_value.toLocaleString()}${overdue ? ' · ⚠ ' + overdue + ' overdue' : ''}`;
    return { brief, data: {} };
  }
  if (rawPath === '/ai/feedback' && method === 'POST') {
    return { ok: true };
  }
  if (rawPath === '/ai/providers') {""",
'local brief/feedback')

open(P, 'w', encoding='utf-8').write(s)
print('Super-cycle 6 frontend done.')
