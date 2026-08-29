#!/usr/bin/env python3
"""Super-cycle 5 (cycles 15-18): hub tools — tone remix, doc analyzer, smart-reply tool,
meeting processor; local parity for SC1-2 endpoints."""
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

# ── C15: New hub tools ──
rep("""  {id:'snippets',icon:'📌',name:'Snippets Library',desc:'Save and reuse your best AI outputs',badge:'Library'}
];""",
"""  {id:'snippets',icon:'📌',name:'Snippets Library',desc:'Save and reuse your best AI outputs',badge:'Library'},
  {id:'toneremix',icon:'🎭',name:'Tone Remix',desc:'Rewrite any text in a different tone',badge:'8 Tones'},
  {id:'docanalyze',icon:'📄',name:'Document Analyzer',desc:'Key points, decisions, action items from any text',badge:'Smart'},
  {id:'meetingprocess',icon:'🗒️',name:'Meeting Processor',desc:'Transcript → tasks & appointments created',badge:'Creates'}
];""",
'AI_TOOLS SC5')

rep("""    snippets:openSnippets,""",
"""    snippets:openSnippets,
    toneremix:()=>openModal(`<div class="modal-header"><div class="modal-title">🎭 Tone Remix</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body">
      <div class="form-group"><label>Text</label><textarea id="trm-text" rows="5" placeholder="Paste any text..."></textarea></div>
      <div class="form-group"><label>New tone</label><select id="trm-tone"><option>professional</option><option>friendly</option><option>casual</option><option>persuasive</option><option>urgent</option><option>empathetic</option><option>playful</option><option>formal</option></select></div>
    </div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doToneRemix()">🎭 Remix</button></div>`),
    docanalyze:()=>openModal(`<div class="modal-header"><div class="modal-title">📄 Document Analyzer</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body">
      <div class="form-group"><label>Paste document / notes</label><textarea id="da-text" rows="7" placeholder="Paste a contract, meeting notes, article..."></textarea></div>
    </div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doDocAnalyze()">📄 Analyze</button></div>`,'modal-lg'),
    meetingprocess:()=>openModal(`<div class="modal-header"><div class="modal-title">🗒️ Meeting Processor</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body">
      <div class="ai-insight" style="margin-bottom:12px"><div class="ai-insight-title">How it works</div><div class="ai-insight-text">Paste a meeting transcript. AI extracts action items and creates them as REAL tasks (with dates), plus any appointments mentioned.</div></div>
      <div class="form-group"><label>Transcript</label><textarea id="mp-text" rows="7" placeholder="Paste the meeting transcript here..."></textarea></div>
    </div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doMeetingProcess()">🗒️ Process</button></div>`,'modal-lg'),""",
'openAITool SC5')

rep("""// New V5 AI tool handlers""",
"""// ── SC5 tool handlers ──
async function doToneRemix() {
  const t = V('trm-text')?.value?.trim(); const tone = V('trm-tone')?.value || 'professional';
  if (!t) { toast('Paste some text first','error'); return; }
  toast('Remixing tone...','info',6000);
  try {
    const r = await api('/ai/tone-remix','POST',{ text: t, tone });
    closeModal();
    openModal(`<div class="modal-header"><div class="modal-title">🎭 ${esc(tone)} Version</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body"><textarea id="trm-out" style="width:100%;min-height:200px">${esc(r.content)}</textarea>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(V('trm-out').value);toast('Copied!','success')">📋 Copy</button><button class="btn btn-ai btn-sm" onclick="saveSnippet(V('trm-out').value)">📌 Save</button></div></div>`, 'modal-lg');
  } catch(e) { toast(e.message,'error'); }
}
async function doDocAnalyze() {
  const t = V('da-text')?.value?.trim();
  if (!t) { toast('Paste something first','error'); return; }
  toast('Analyzing document...','info',8000);
  try {
    const r = await api('/ai/doc-analyze','POST',{ text: t });
    closeModal();
    openModal(`<div class="modal-header"><div class="modal-title">📄 Analysis</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div>
      <button class="btn btn-ai btn-sm" style="margin-top:10px" onclick="saveSnippet('${escAttr(r.content)}')">📌 Save</button></div>`, 'modal-lg');
  } catch(e) { toast(e.message,'error'); }
}
async function doMeetingProcess() {
  const t = V('mp-text')?.value?.trim();
  if (!t) { toast('Paste the transcript first','error'); return; }
  toast('Processing meeting — creating tasks...','info',10000);
  try {
    // Ask the agent to parse the transcript into actions
    const r = await api('/ai/agent','POST',{ message: `Process this meeting transcript and create all action items as tasks (with sensible due dates), plus any appointments mentioned. Transcript: ${t.slice(0,4000)}` });
    closeModal();
    openModal(`<div class="modal-header"><div class="modal-title">🗒️ Meeting Processed</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        <div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.reply || 'Done!')}</div>
        ${(r.results||[]).map(x=>`<div style="font-size:12px;color:var(--green);margin-top:4px">✅ ${esc(x.note||x.action)}</div>`).join('')}
        <button class="btn btn-primary" style="margin-top:12px" onclick="closeModal();navigate('tasks')">View Tasks</button>
      </div>`, 'modal-lg');
  } catch(e) { toast('Meeting processing failed: '+e.message,'error'); }
}

// New V5 AI tool handlers""",
'SC5 handlers')

# ── C16: local parity for SC1-2 endpoints ──
rep("""  if (rawPath === '/ai/providers') {""",
"""  if (rawPath === '/ai/tone-remix' && method === 'POST') {
    return aiOpComplete(ws, `Rewrite this in a ${body.tone||'professional'} tone, keep the meaning: "${String(body.text||'').slice(0,3000)}"`, body);
  }
  if (rawPath === '/ai/doc-analyze' && method === 'POST') {
    return aiOpComplete(ws, `Analyze this document: key points, decisions, action items. ${String(body.text||'').slice(0,4000)}`, body);
  }
  if (rawPath === '/ai/smart-reply' && method === 'POST') {
    return { options: [localComplete('write a reply to: ' + String(body.text||'').slice(0,300))] };
  }
  if (root === 'ai' && parts[1] === 'contact-summary') {
    const c = ws.contacts.find(x=>x.id===parseInt(parts[2]));
    if (!c) throw new Error('Contact not found');
    return { summary: `Contact: ${c.name} (${c.stage}). ${c.notes ? 'Notes: ' + c.notes : ''} Connect an AI key + backend for a full AI-written relationship summary.` };
  }
  if (root === 'ai' && parts[1] === 'tag-suggest') {
    const c = ws.contacts.find(x=>x.id===parseInt(parts[2]));
    if (!c) throw new Error('Contact not found');
    const base = c.stage === 'lead' ? ['lead'] : [c.stage];
    return { tags: [...base, 'follow-up'].slice(0,5) };
  }
  if (rawPath === '/ai/score-tasks') {
    const todo = ws.tasks.filter(t=>t.status==='todo').map(t=>({ id: t.id, score: Math.max(20, 100 - (t.due_date ? Math.max(0,(new Date(t.due_date)-new Date())/86400000) : 30)), reason: t.due_date ? 'due ' + t.due_date : 'no due date' }));
    return { tasks: todo };
  }
  if (rawPath === '/ai/deal-risks') {
    const cutoff = Date.now() - 14*86400000;
    const risks = ws.deals.filter(d=>!['won','lost'].includes(d.stage) && d.created_at && new Date(d.created_at).getTime() < cutoff).map(d=>({ id:d.id, title:d.title, value:d.value, stage:d.stage, risk:'stale', note:'No movement in 14+ days', age_days: Math.floor((Date.now()-new Date(d.created_at).getTime())/86400000) }));
    return { risks: risks.slice(0,10) };
  }
  if (rawPath === '/ai/translate' && method === 'POST') {
    return aiOpComplete(ws, `Translate to ${body.language||'English'}. Return only the translation: "${String(body.text||'').slice(0,3000)}"`, body);
  }
  if (rawPath === '/ai/providers') {""",
'local SC1-2 parity')

open(P, 'w', encoding='utf-8').write(s)
print('Super-cycle 5 done.')
