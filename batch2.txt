#!/usr/bin/env python3
"""Batch 2: chat UIs — SSE error handling, history dedupe, escaping, real-mode."""
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

# ── chatStreamFetch: in REAL_MODE always use the backend stream ──
rep("""async function chatStreamFetch(messages, contextData) {
  if (BACKEND.available === null) await pingBackend();
  if (BACKEND.available) {
    return fetch(API + '/ai/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Authorization:`Bearer ${STATE.token}` },
      body: JSON.stringify({ messages, context_data: contextData })
    });
  }
  const ws = currentWorkspace();""",
"""async function chatStreamFetch(messages, contextData) {
  if (REAL_MODE() || BACKEND.available) {
    return fetch(API + '/ai/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Authorization:`Bearer ${STATE.token}` },
      body: JSON.stringify({ messages, context_data: contextData })
    });
  }
  if (BACKEND.available === null) await pingBackend();
  if (BACKEND.available) {
    return fetch(API + '/ai/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Authorization:`Bearer ${STATE.token}` },
      body: JSON.stringify({ messages, context_data: contextData })
    });
  }
  const ws = currentWorkspace();""",
tag='chatStreamFetch real-mode')

# ── sendPanelMessage: error handling + history dedupe + esc ──
rep("""  try {
    const ctx = `User is on the ${STATE.view} page. User: ${STATE.user?.name}.`;
    const history = STATE.panelMessages.slice(-10);
    const res = await chatStreamFetch(history, ctx);
    typing.remove();
    const aiDiv = addPanelMsg('assistant', '');
    const bubble = aiDiv.querySelector('.msg-bubble');
    bubble.classList.add('streaming-text');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split('\\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.delta) { full += d.delta; bubble.innerHTML = full.replace(/\\n/g,'<br>'); msgs.scrollTop = msgs.scrollHeight; }
          if (d.done) { bubble.classList.remove('streaming-text'); STATE.panelMessages.push({role:'assistant',content:full}); }
          if (d.error) { bubble.textContent = '⚠️ ' + d.error; bubble.classList.remove('streaming-text'); }
        } catch {}
      }
    }
  } catch(e) {
    typing.remove();
    addPanelMsg('assistant', '⚠️ AI unavailable. Check Settings → AI Providers.');
  }
}""",
"""  try {
    const ctx = `User is on the ${STATE.view} page. User: ${STATE.user?.name}.`;
    const history = STATE.panelMessages.slice(-10);
    const res = await chatStreamFetch(history, ctx);
    typing.remove();
    if (!res.ok) {
      // Non-stream error (cap reached, provider down, auth…) — show it, don't hang.
      let msg = 'AI request failed';
      try { msg = (await res.json()).error || msg; } catch {}
      addPanelMsg('assistant', '⚠️ ' + msg);
      return;
    }
    const aiDiv = addPanelMsg('assistant', '', false); // display-only; no history entry yet
    const bubble = aiDiv.querySelector('.msg-bubble');
    bubble.classList.add('streaming-text');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let failed = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split('\\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.delta) { full += d.delta; bubble.innerHTML = esc(full).replace(/\\n/g,'<br>'); msgs.scrollTop = msgs.scrollHeight; }
          if (d.done) { bubble.classList.remove('streaming-text'); }
          if (d.error) { failed = true; bubble.textContent = '⚠️ ' + d.error; bubble.classList.remove('streaming-text'); }
        } catch {}
      }
    }
    if (failed) return;
    // Replace the placeholder history entry (no duplicate empty messages).
    const last = STATE.panelMessages[STATE.panelMessages.length - 1];
    if (last && last.role === 'assistant' && last.content === '') STATE.panelMessages[STATE.panelMessages.length - 1] = { role: 'assistant', content: full };
    else STATE.panelMessages.push({ role: 'assistant', content: full });
  } catch(e) {
    typing.remove();
    addPanelMsg('assistant', '⚠️ AI unavailable. Check Settings → AI Providers.');
  }
}""",
tag='sendPanelMessage')

# ── addPanelMsg: esc + optional push flag ──
rep("""function addPanelMsg(role, text) {
  STATE.panelMessages.push({ role, content: text });
  const msgs = V('panel-messages');
  const t = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  const av = role==='user' ? `<div class="msg-avatar user-av">👤</div>` : `<div class="msg-avatar ai-av">🧠</div>`;
  div.innerHTML = `${av}<div><div class="msg-bubble">${text.replace(/\\n/g,'<br>')}</div><div class="msg-time">${t}</div></div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}""",
"""function addPanelMsg(role, text, pushHistory=true) {
  if (pushHistory) STATE.panelMessages.push({ role, content: text });
  const msgs = V('panel-messages');
  const t = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  const av = role==='user' ? `<div class="msg-avatar user-av">👤</div>` : `<div class="msg-avatar ai-av">🧠</div>`;
  div.innerHTML = `${av}<div><div class="msg-bubble">${esc(text).replace(/\\n/g,'<br>')}</div><div class="msg-time">${t}</div></div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}""",
tag='addPanelMsg')

# ── sendHubMsg: same error/dedupe/esc treatment ──
rep("""  try {
    const ctx=`AI Hub context. User: ${STATE.user?.name}. Has Gmail: ${STATE.gmailConnected}.`;
    const res=await chatStreamFetch(HUB_STATE.messages.filter(m=>m.role!=='system').slice(-12), ctx);
    typing.remove();
    const aiDiv=addHubMsg('assistant',''); const bubble=aiDiv?.querySelector('.msg-bubble');
    if(bubble) bubble.classList.add('streaming-text');
    const reader=res.body.getReader(); const decoder=new TextDecoder(); let full='';
    while(true){const{done,value}=await reader.read();if(done)break;for(const line of decoder.decode(value).split('\\n')){if(!line.startsWith('data: '))continue;try{const d=JSON.parse(line.slice(6));if(d.delta&&bubble){full+=d.delta;bubble.innerHTML=full.replace(/\\n/g,'<br>');el.scrollTop=el.scrollHeight;}if(d.done&&bubble){bubble.classList.remove('streaming-text');HUB_STATE.messages.push({role:'assistant',content:full});}if(d.error&&bubble){bubble.textContent='⚠️ '+d.error;bubble.classList.remove('streaming-text');}}catch{}}}
  } catch(e) { typing.remove(); addHubMsg('assistant','⚠️ AI unavailable. Check Settings → AI Providers.'); }
}""",
"""  try {
    const ctx=`AI Hub context. User: ${STATE.user?.name}. Has Gmail: ${STATE.gmailConnected}.`;
    const res=await chatStreamFetch(HUB_STATE.messages.filter(m=>m.role!=='system').slice(-12), ctx);
    typing.remove();
    if(!res.ok){let m='AI request failed';try{m=(await res.json()).error||m;}catch{}addHubMsg('assistant','⚠️ '+m);return;}
    const aiDiv=addHubMsg('assistant','',false); const bubble=aiDiv?.querySelector('.msg-bubble');
    if(bubble) bubble.classList.add('streaming-text');
    const reader=res.body.getReader(); const decoder=new TextDecoder(); let full=''; let failed=false;
    while(true){const{done,value}=await reader.read();if(done)break;for(const line of decoder.decode(value).split('\\n')){if(!line.startsWith('data: '))continue;try{const d=JSON.parse(line.slice(6));if(d.delta&&bubble){full+=d.delta;bubble.innerHTML=esc(full).replace(/\\n/g,'<br>');el.scrollTop=el.scrollHeight;}if(d.done&&bubble){bubble.classList.remove('streaming-text');}if(d.error&&bubble){failed=true;bubble.textContent='⚠️ '+d.error;bubble.classList.remove('streaming-text');}}catch{}}}
    if(!failed){const last=HUB_STATE.messages[HUB_STATE.messages.length-1];if(last&&last.role==='assistant'&&last.content==='')HUB_STATE.messages[HUB_STATE.messages.length-1]={role:'assistant',content:full};else HUB_STATE.messages.push({role:'assistant',content:full});}
  } catch(e) { typing.remove(); addHubMsg('assistant','⚠️ AI unavailable. Check Settings → AI Providers.'); }
}""",
tag='sendHubMsg')

# ── addHubMsg: esc + push flag ──
rep("""function addHubMsg(role,text) {
  HUB_STATE.messages.push({role,content:text});
  const el=V('hub-messages'); if(!el) return null;
  const t=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const div=document.createElement('div'); div.className=`chat-msg ${role}`;
  const av=role==='user'?'<div class="msg-avatar user-av">👤</div>':'<div class="msg-avatar ai-av">🧠</div>';
  div.innerHTML=`${av}<div><div class="msg-bubble">${text.replace(/\\n/g,'<br>')}</div><div class="msg-time">${t}</div></div>`;
  el.appendChild(div); el.scrollTop=el.scrollHeight; return div;
}""",
"""function addHubMsg(role,text,pushHistory=true) {
  if(pushHistory) HUB_STATE.messages.push({role,content:text});
  const el=V('hub-messages'); if(!el) return null;
  const t=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const div=document.createElement('div'); div.className=`chat-msg ${role}`;
  const av=role==='user'?'<div class="msg-avatar user-av">👤</div>':'<div class="msg-avatar ai-av">🧠</div>';
  div.innerHTML=`${av}<div><div class="msg-bubble">${esc(text).replace(/\\n/g,'<br>')}</div><div class="msg-time">${t}</div></div>`;
  el.appendChild(div); el.scrollTop=el.scrollHeight; return div;
}""",
tag='addHubMsg')

# ── toast: escape the message (it's inserted via innerHTML) ──
rep("""  el.className = `toast ${type}`;
  el.innerHTML = `<span style="font-size:16px">${icons[type]||'💬'}</span><span style="flex:1">${msg}</span>""",
"""  el.className = `toast ${type}`;
  el.innerHTML = `<span style="font-size:16px">${icons[type]||'💬'}</span><span style="flex:1">${esc(msg)}</span>""",
tag='toast esc')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 2 done.')
