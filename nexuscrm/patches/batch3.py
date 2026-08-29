#!/usr/bin/env python3
"""Batch 3: AI bots chat fixes + Gmail XSS escaping + threadId + OAuth."""
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

# ── sendBotMsg: esc user text + error handling + dedupe ──
rep("""  const userDiv=document.createElement('div'); userDiv.className='chat-msg user';
  userDiv.innerHTML=`<div class="msg-avatar user-av">👤</div><div><div class="msg-bubble">${text}</div></div>`;""",
"""  const userDiv=document.createElement('div'); userDiv.className='chat-msg user';
  userDiv.innerHTML=`<div class="msg-avatar user-av">👤</div><div><div class="msg-bubble">${esc(text)}</div></div>`;""",
tag='sendBotMsg user esc')
rep("""  try {
    const res=await chatStreamFetch(BOT_STATE.messages.slice(-8), bot?.prompt||'');
    typing.remove();
    const aiDiv=document.createElement('div'); aiDiv.className='chat-msg assistant';
    aiDiv.innerHTML=`<div class="msg-avatar ai-av">${bot?.icon||'🤖'}</div><div><div class="msg-bubble streaming-text"></div></div>`;
    msgs.appendChild(aiDiv); msgs.scrollTop=msgs.scrollHeight;
    const bubble=aiDiv.querySelector('.msg-bubble');
    const reader=res.body.getReader(); const decoder=new TextDecoder(); let full='';
    while(true){const{done,value}=await reader.read();if(done)break;for(const line of decoder.decode(value).split('\\n')){if(!line.startsWith('data: '))continue;try{const d=JSON.parse(line.slice(6));if(d.delta&&bubble){full+=d.delta;bubble.innerHTML=full.replace(/\\n/g,'<br>');msgs.scrollTop=msgs.scrollHeight;}if(d.done&&bubble){bubble.classList.remove('streaming-text');BOT_STATE.messages.push({role:'assistant',content:full});}}catch{}}}
  } catch { typing.remove(); }
}""",
"""  try {
    const res=await chatStreamFetch(BOT_STATE.messages.slice(-8), bot?.prompt||'');
    typing.remove();
    if(!res.ok){let m='AI request failed';try{m=(await res.json()).error||m;}catch{}const eDiv=document.createElement('div');eDiv.className='chat-msg assistant';eDiv.innerHTML=`<div class="msg-avatar ai-av">${bot?.icon||'🤖'}</div><div><div class="msg-bubble">⚠️ ${esc(m)}</div></div>`;msgs.appendChild(eDiv);return;}
    const aiDiv=document.createElement('div'); aiDiv.className='chat-msg assistant';
    aiDiv.innerHTML=`<div class="msg-avatar ai-av">${bot?.icon||'🤖'}</div><div><div class="msg-bubble streaming-text"></div></div>`;
    msgs.appendChild(aiDiv); msgs.scrollTop=msgs.scrollHeight;
    const bubble=aiDiv.querySelector('.msg-bubble');
    const reader=res.body.getReader(); const decoder=new TextDecoder(); let full=''; let failed=false;
    while(true){const{done,value}=await reader.read();if(done)break;for(const line of decoder.decode(value).split('\\n')){if(!line.startsWith('data: '))continue;try{const d=JSON.parse(line.slice(6));if(d.delta&&bubble){full+=d.delta;bubble.innerHTML=esc(full).replace(/\\n/g,'<br>');msgs.scrollTop=msgs.scrollHeight;}if(d.done&&bubble){bubble.classList.remove('streaming-text');}if(d.error&&bubble){failed=true;bubble.textContent='⚠️ '+d.error;bubble.classList.remove('streaming-text');}}catch{}}}
    if(!failed){const last=BOT_STATE.messages[BOT_STATE.messages.length-1];if(last&&last.role==='assistant'&&last.content==='')BOT_STATE.messages[BOT_STATE.messages.length-1]={role:'assistant',content:full};else BOT_STATE.messages.push({role:'assistant',content:full});}
  } catch { typing.remove(); }
}""",
tag='sendBotMsg stream')

# ── Gmail list rendering: escape everything attacker-controlled ──
rep("""    const from = (hdrs.From || 'Unknown').replace(/<[^>]+>/,'').trim();
    const subj = hdrs.Subject || '(No subject)';
    const date = hdrs.Date ? new Date(hdrs.Date).toLocaleDateString([],{month:'short',day:'numeric'}) : '';
    const unread = m.labelIds?.includes('UNREAD');
    return `<div class="gmail-email-row ${unread?'unread':''}" onclick="openEmail('${m.id}')">
      <div style="width:8px;height:8px;border-radius:50%;background:${unread?'var(--accent)':'transparent'};flex-shrink:0"></div>
      <div class="gmail-from">${from}</div>
      <div class="gmail-subject">${subj}</div>
      <div class="gmail-time">${date}</div>
    </div>`;""",
"""    const from = esc((hdrs.From || 'Unknown').replace(/<[^>]+>/,'').trim());
    const subj = esc(hdrs.Subject || '(No subject)');
    const date = hdrs.Date ? new Date(hdrs.Date).toLocaleDateString([],{month:'short',day:'numeric'}) : '';
    const unread = m.labelIds?.includes('UNREAD');
    return `<div class="gmail-email-row ${unread?'unread':''}" onclick="openEmail('${m.id}')">
      <div style="width:8px;height:8px;border-radius:50%;background:${unread?'var(--accent)':'transparent'};flex-shrink:0"></div>
      <div class="gmail-from">${from}</div>
      <div class="gmail-subject">${subj}</div>
      <div class="gmail-time">${date}</div>
    </div>`;""",
tag='gmail panel list esc')

rep("""    const from = (hdrs.From||'Unknown').replace(/<[^>]+>/,'').trim();
    const subj = hdrs.Subject||'(No subject)';
    const date = hdrs.Date ? new Date(hdrs.Date).toLocaleDateString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    const unread = m.labelIds?.includes('UNREAD');
    return `
      <div class="gmail-email-row ${unread?'unread':''}" onclick="openEmail('${m.id}')">
        <div style="width:8px;height:8px;border-radius:50%;background:${unread?'var(--accent)':'transparent'};flex-shrink:0;margin-top:3px"></div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div class="gmail-from">${from}</div>
            <div class="gmail-time">${date}</div>
          </div>
          <div class="gmail-subject">${subj}</div>
          ${m.snippet?`<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">${m.snippet}</div>`:''}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px">
          <button class="btn btn-ai btn-sm" onclick="event.stopPropagation();aiReplyEmail('${from.replace(/'/g,'&apos;').replace(/\"/g,'&quot;')}','${subj.replace(/'/g,'&apos;').replace(/\"/g,'&quot;')}','${m.id}')" style="padding:3px 8px;font-size:10px">🤖</button>
        </div>
      </div>`;""",
"""    const fromRaw = (hdrs.From||'Unknown').replace(/<[^>]+>/,'').trim();
    const from = esc(fromRaw);
    const subjRaw = hdrs.Subject||'(No subject)';
    const subj = esc(subjRaw);
    const date = hdrs.Date ? new Date(hdrs.Date).toLocaleDateString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    const unread = m.labelIds?.includes('UNREAD');
    return `
      <div class="gmail-email-row ${unread?'unread':''}" onclick="openEmail('${m.id}')">
        <div style="width:8px;height:8px;border-radius:50%;background:${unread?'var(--accent)':'transparent'};flex-shrink:0;margin-top:3px"></div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div class="gmail-from">${from}</div>
            <div class="gmail-time">${date}</div>
          </div>
          <div class="gmail-subject">${subj}</div>
          ${m.snippet?`<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">${esc(m.snippet)}</div>`:''}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px">
          <button class="btn btn-ai btn-sm" onclick="event.stopPropagation();aiReplyEmail('${escAttr(fromRaw)}','${escAttr(subjRaw)}','${m.id}')" style="padding:3px 8px;font-size:10px">🤖</button>
        </div>
      </div>`;""",
tag='gmail full list esc')

# ── openEmail: escape headers, sanitize body, remember threadId ──
rep("""async function openEmail(id) {
  try {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
      headers: { Authorization: `Bearer ${STATE.gmailToken}` }
    });
    const m = await r.json();
    const hdrs = {};
    (m.payload?.headers || []).forEach(h => hdrs[h.name] = h.value);
    const from = hdrs.From || 'Unknown';
    const subj = hdrs.Subject || '(No subject)';
    const date = hdrs.Date || '';
    let body = '';
    const findBody = part => {
      if (!part) return;
      if (part.body?.data) {
        const text = atob(part.body.data.replace(/-/g,'+').replace(/_/g,'/'));
        if (part.mimeType?.includes('html')) body = text;
        else if (!body) body = `<pre style="white-space:pre-wrap;font-size:13px">${text}</pre>`;
      }
      if (part.parts) part.parts.forEach(findBody);
    };
    findBody(m.payload);
    // mark as read
    fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${STATE.gmailToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
    }).catch(()=>{});
    openModal(`
      <div class="modal-header">
        <div>
          <div class="modal-title" style="font-size:15px">${subj}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">From: ${from} &nbsp;•&nbsp; ${new Date(date).toLocaleString()}</div>
        </div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div style="display:flex;gap:8px;margin-bottom:14px">
          <button class="btn btn-secondary btn-sm" onclick="replyToEmail('${from}','${subj}','${id}')">↩ Reply</button>
          <button class="btn btn-ai btn-sm" onclick="aiReplyEmail('${from.replace(/'/g,'\\\\&apos;')}','${subj.replace(/'/g,'\\\\&apos;')}','${id}')">🤖 AI Reply</button>
          <button class="btn btn-secondary btn-sm" onclick="saveEmailToInbox('${id}','${from.replace(/'/g,'\\\\&apos;')}','${subj.replace(/'/g,'\\\\&apos;')}')">💾 Save to CRM</button>
        </div>
        <div style="background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:16px;max-height:400px;overflow-y:auto;font-size:13px;line-height:1.6">
          ${body || '<em style="color:var(--text3)">Could not render email body</em>'}
        </div>
      </div>`, 'modal-xl');
  } catch(e) { toast('Could not load email: ' + e.message, 'error'); }
}""",
"""async function openEmail(id) {
  try {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
      headers: { Authorization: `Bearer ${STATE.gmailToken}` }
    });
    const m = await r.json();
    const hdrs = {};
    (m.payload?.headers || []).forEach(h => hdrs[h.name] = h.value);
    const from = hdrs.From || 'Unknown';
    const subj = hdrs.Subject || '(No subject)';
    const date = hdrs.Date || '';
    STATE.currentGmailThreadId = m.threadId || id;
    let body = '';
    const findBody = part => {
      if (!part) return;
      if (part.body?.data) {
        const text = atob(part.body.data.replace(/-/g,'+').replace(/_/g,'/'));
        if (part.mimeType?.includes('html')) body = sanitizeHtml(text);
        else if (!body) body = `<pre style="white-space:pre-wrap;font-size:13px">${esc(text)}</pre>`;
      }
      if (part.parts) part.parts.forEach(findBody);
    };
    findBody(m.payload);
    // mark as read
    fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${STATE.gmailToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
    }).catch(()=>{});
    openModal(`
      <div class="modal-header">
        <div>
          <div class="modal-title" style="font-size:15px">${esc(subj)}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">From: ${esc(from)} &nbsp;•&nbsp; ${new Date(date).toLocaleString()}</div>
        </div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div style="display:flex;gap:8px;margin-bottom:14px">
          <button class="btn btn-secondary btn-sm" onclick="replyToEmail('${escAttr(from)}','${escAttr(subj)}','${id}')">↩ Reply</button>
          <button class="btn btn-ai btn-sm" onclick="aiReplyEmail('${escAttr(from)}','${escAttr(subj)}','${id}')">🤖 AI Reply</button>
          <button class="btn btn-secondary btn-sm" onclick="saveEmailToInbox('${id}','${escAttr(from)}','${escAttr(subj)}')">💾 Save to CRM</button>
        </div>
        <div style="background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:16px;max-height:400px;overflow-y:auto;font-size:13px;line-height:1.6">
          ${body || '<em style="color:var(--text3)">Could not render email body</em>'}
        </div>
      </div>`, 'modal-xl');
  } catch(e) { toast('Could not load email: ' + e.message, 'error'); }
}""",
tag='openEmail')

# ── reply/send: escape + use threadId for threading ──
rep("""function replyToEmail(from, subject, id) {
  const replyTo = from.match(/<(.+)>/)?.[1] || from;
  openModal(`
    <div class="modal-header"><div class="modal-title">↩ Reply</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-group"><label>To</label><input id="reply-to" value="${replyTo}"></div>
      <div class="form-group"><label>Subject</label><input id="reply-subject" value="Re: ${subject}"></div>
      <div class="form-group"><label>Message</label><textarea id="reply-body" rows="8" placeholder="Type your reply..."></textarea></div>
      <button class="btn btn-ai btn-sm" onclick="aiDraftReply('${from.replace(/'/g,'\\\\&apos;')}')" style="margin-bottom:8px">🤖 AI Draft Reply</button>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-gmail" onclick="sendGmailReply('${id}')">📧 Send Reply</button>
    </div>`);
}""",
"""function replyToEmail(from, subject, id) {
  const replyTo = from.match(/<(.+)>/)?.[1] || from;
  openModal(`
    <div class="modal-header"><div class="modal-title">↩ Reply</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-group"><label>To</label><input id="reply-to" value="${escAttr(replyTo)}"></div>
      <div class="form-group"><label>Subject</label><input id="reply-subject" value="Re: ${escAttr(subject)}"></div>
      <div class="form-group"><label>Message</label><textarea id="reply-body" rows="8" placeholder="Type your reply..."></textarea></div>
      <button class="btn btn-ai btn-sm" onclick="aiDraftReply('${escAttr(from)}')" style="margin-bottom:8px">🤖 AI Draft Reply</button>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-gmail" onclick="sendGmailReply('${id}')">📧 Send Reply</button>
    </div>`);
}""",
tag='replyToEmail')

rep("""async function sendGmailReply(threadId) {
  const to = V('reply-to')?.value;
  const subject = V('reply-subject')?.value;
  const body = V('reply-body')?.value;
  if (!to || !body) { toast('Fill in To and Message fields','error'); return; }""",
"""async function sendGmailReply(threadId) {
  const to = V('reply-to')?.value;
  const subject = V('reply-subject')?.value;
  const body = V('reply-body')?.value;
  if (!to || !body) { toast('Fill in To and Message fields','error'); return; }
  const thread = STATE.currentGmailThreadId || threadId;""",
tag='sendGmailReply thread')
rep("""      body: JSON.stringify({ raw: encoded, threadId })
    });
    if (!r.ok) throw new Error('Send failed');
    // Save to CRM messages""",
"""      body: JSON.stringify({ raw: encoded, threadId: thread })
    });
    if (!r.ok) throw new Error('Send failed');
    // Save to CRM messages""",
tag='sendGmailReply use thread')

# ── Gmail OAuth: popup token via postMessage (fixes the history.replaceState race) ──
rep("""  // Use popup approach
  const popup = window.open(`https://accounts.google.com/o/oauth2/auth?${params}`, 'gmail-oauth', 'width=500,height=600');
  const check = setInterval(() => {
    try {
      if (popup.closed) { clearInterval(check); return; }
      const hash = popup.location.hash;
      if (hash && hash.includes('access_token')) {
        const p = new URLSearchParams(hash.slice(1));
        const token = p.get('access_token');
        if (token) {
          STATE.gmailToken = token;
          localStorage.setItem('nx_gmail_token', token);
          popup.close();
          clearInterval(check);
          checkGmailConnection();
        }
      }
    } catch {}
  }, 500);
}""",
"""  // Use popup approach. The popup redirects back to this app's origin, so
  // it is same-origin and we can read its hash directly — but the app's own
  // init() also strips the hash, so the popup ALSO posts the token via
  // postMessage. Whichever arrives first wins.
  const popup = window.open(`https://accounts.google.com/o/oauth2/auth?${params}`, 'gmail-oauth', 'width=500,height=600');
  let done = false;
  const finish = (token) => {
    if (done || !token) return;
    done = true;
    clearInterval(check);
    window.removeEventListener('message', onMsg);
    STATE.gmailToken = token;
    localStorage.setItem('nx_gmail_token', token);
    try { popup && !popup.closed && popup.close(); } catch {}
    checkGmailConnection();
  };
  const onMsg = (e) => {
    if (e.data && e.data.type === 'gmail-token' && e.data.token) finish(e.data.token);
  };
  window.addEventListener('message', onMsg);
  const check = setInterval(() => {
    try {
      if (popup.closed) { clearInterval(check); window.removeEventListener('message', onMsg); return; }
      const hash = popup.location.hash;
      if (hash && hash.includes('access_token')) {
        const p = new URLSearchParams(hash.slice(1));
        finish(p.get('access_token'));
      }
    } catch {}
  }, 300);
}""",
tag='startGmailOAuth postMessage')

# ── init(): popup flow — post token to opener instead of racing it ──
rep("""  // OAuth callback handler (for Gmail popup flow)
  if (window.location.hash.includes('access_token')) {
    const p = new URLSearchParams(window.location.hash.slice(1));
    const token = p.get('access_token');
    if (token) {
      STATE.gmailToken = token;
      localStorage.setItem('nx_gmail_token', token);
      history.replaceState(null, '', window.location.pathname);
      toast('Gmail connected! ✅', 'success');
      checkGmailConnection();
    }
  }""",
"""  // OAuth callback handler (for Gmail popup flow). If this window IS the
  // popup, hand the token to the opener via postMessage and close — the
  // opener keeps its own state. Otherwise consume the hash directly.
  if (window.location.hash.includes('access_token')) {
    const p = new URLSearchParams(window.location.hash.slice(1));
    const token = p.get('access_token');
    if (token) {
      if (window.opener && !window.opener.closed) {
        try { window.opener.postMessage({ type: 'gmail-token', token }, window.location.origin); } catch {}
        window.close();
      } else {
        STATE.gmailToken = token;
        localStorage.setItem('nx_gmail_token', token);
        history.replaceState(null, '', window.location.pathname);
        toast('Gmail connected! ✅', 'success');
        checkGmailConnection();
      }
    }
  }""",
tag='init oauth')

# ── Gmail connect instructions: mention the redirect URI requirement ──
rep("""          <div>3. Go to <strong>Credentials</strong> → Create <strong>OAuth 2.0 Client ID</strong></div>
          <div>4. App type: <strong>Web Application</strong></div>
          <div>5. Add Authorized origin: <code style="background:var(--card2);padding:2px 6px;border-radius:4px">${window.location.origin}</code></div>
          <div>6. Copy your Client ID and paste below</div>""",
"""          <div>3. Go to <strong>Credentials</strong> → Create <strong>OAuth 2.0 Client ID</strong></div>
          <div>4. App type: <strong>Web Application</strong></div>
          <div>5. Add <strong>both</strong> of these (Google rejects the login if the redirect URI is missing):</div>
          <div>&nbsp;&nbsp;• Authorized JavaScript origin: <code style="background:var(--card2);padding:2px 6px;border-radius:4px">${window.location.origin}</code></div>
          <div>&nbsp;&nbsp;• Authorized redirect URI: <code style="background:var(--card2);padding:2px 6px;border-radius:4px">${window.location.origin}/oauth-callback</code></div>
          <div>6. Copy your Client ID and paste below</div>""",
tag='gmail instructions')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 3 done.')
