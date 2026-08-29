#!/usr/bin/env python3
"""Batch 8: escaping sweep for AI output + user lists; init() real-mode recovery."""
import re, sys
P = 'NexusCRM_V4_Hardened.html'
s = open(P, encoding='utf-8').read()

def rep(old, new, count=1, tag=''):
    global s
    n = s.count(old)
    if n != count:
        print(f'❌ [{tag}] expected {count}, found {n}'); print('   OLD:', repr(old[:100])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

# ── Escape AI output everywhere it's rendered into innerHTML ──
n_before = s.count('${r.content}')
s = s.replace('${r.content}', '${esc(r.content)}')
print(f'  ✅ esc(r.content) sweep: {n_before} spots')
n2 = s.count('${r.content.slice(0,150)}')
s = s.replace('${r.content.slice(0,150)}', '${esc(r.content.slice(0,150))}')
print(f'  ✅ esc(r.content.slice): {n2} spots')
# quickSavePost clipboard handler embeds r.content into an onclick attr:
n3 = s.count("navigator.clipboard.writeText('${r.content.replace(/'/g,\"\\\\'\")}')")
s = s.replace("navigator.clipboard.writeText('${r.content.replace(/'/g,\"\\\\'\")}')", "navigator.clipboard.writeText('${escAttr(r.content)}')")
print(f'  ✅ quickSavePost clipboard: {n3} spots')

# ── inbox list: escape message fields ──
rep("""        <tbody>${msgs.length ? msgs.map(m=>`<tr style="cursor:pointer" onclick="viewCRMMessage(${m.id})">
          <td style="font-weight:600">${m.contact_name||'—'}</td>
          <td><span class="badge ${m.channel==='whatsapp'?'badge-green':m.channel==='sms'?'badge-yellow':'badge-blue'}">${m.channel}</span></td>
          <td>${m.subject||'—'}</td>
          <td style="font-size:12px;color:var(--text2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(m.body||'').slice(0,80)}</td>""",
"""        <tbody>${msgs.length ? msgs.map(m=>`<tr style="cursor:pointer" onclick="viewCRMMessage(${m.id})">
          <td style="font-weight:600">${esc(m.contact_name||'—')}</td>
          <td><span class="badge ${m.channel==='whatsapp'?'badge-green':m.channel==='sms'?'badge-yellow':'badge-blue'}">${esc(m.channel)}</span></td>
          <td>${esc(m.subject||'—')}</td>
          <td style="font-size:12px;color:var(--text2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((m.body||'').slice(0,80))}</td>""",
tag='inbox esc')

# ── tasks list: escape title/description ──
rep("""          <td><input type="checkbox" ${t.status==='done'?'checked':''} onchange="toggleTask(${t.id},this)" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)"></td>
          <td><div style="font-weight:${t.status!=='done'?'600':'400'}">${t.title}</div><div style="font-size:11px;color:var(--text3)">${t.description||''}</div></td>
          <td style="font-size:12px;color:var(--text2)">${t.contact_name||'—'}</td>""",
"""          <td><input type="checkbox" ${t.status==='done'?'checked':''} onchange="toggleTask(${t.id},this)" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)"></td>
          <td><div style="font-weight:${t.status!=='done'?'600':'400'}">${esc(t.title)}</div><div style="font-size:11px;color:var(--text3)">${esc(t.description||'')}</div></td>
          <td style="font-size:12px;color:var(--text2)">${esc(t.contact_name||'—')}</td>""",
tag='tasks esc')

# ── dashboard deal/task lists ──
rep("""      const r=(d.deals||[]).filter(x=>!['won','lost'].includes(x.stage)).slice(0,5);
      el.innerHTML = r.length ? r.map(d=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)">
        <div><div style="font-weight:600;font-size:13px">${d.title}</div><div style="font-size:11px;color:var(--text3)">${d.contact_name||'No contact'}</div></div>""",
"""      const r=(d.deals||[]).filter(x=>!['won','lost'].includes(x.stage)).slice(0,5);
      el.innerHTML = r.length ? r.map(d=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)">
        <div><div style="font-weight:600;font-size:13px">${esc(d.title)}</div><div style="font-size:11px;color:var(--text3)">${esc(d.contact_name||'No contact')}</div></div>""",
tag='dash deals esc')
rep("""      el.innerHTML = r.length ? r.map(t=>`<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <input type="checkbox" onchange="completeTask(${t.id},this)" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)">
        <div style="flex:1"><div style="font-size:13px">${t.title}</div><div style="font-size:11px;color:var(--text3)">${t.due_date||'No due date'}</div></div>""",
"""      el.innerHTML = r.length ? r.map(t=>`<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <input type="checkbox" onchange="completeTask(${t.id},this)" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)">
        <div style="flex:1"><div style="font-size:13px">${esc(t.title)}</div><div style="font-size:11px;color:var(--text3)">${esc(t.due_date||'No due date')}</div></div>""",
tag='dash tasks esc')

# ── calendar: escape appointment fields ──
rep("""            <div style="flex:1">
              <div style="font-size:13px;font-weight:600">${a.title}</div>
              <div style="font-size:11px;color:var(--text3)">${a.time} • ${a.duration||60}min • ${a.contact_name||'No contact'} • ${a.type||'call'}</div>
            </div>""",
"""            <div style="flex:1">
              <div style="font-size:13px;font-weight:600">${esc(a.title)}</div>
              <div style="font-size:11px;color:var(--text3)">${esc(a.time)} • ${a.duration||60}min • ${esc(a.contact_name||'No contact')} • ${esc(a.type||'call')}</div>
            </div>""",
tag='calendar esc')

# ── social recent posts: escape content ──
rep("""            <div style="font-size:12px;color:var(--text2)">${(p.content||'').slice(0,100)}${p.content?.length>100?'...':''}</div>""",
"""            <div style="font-size:12px;color:var(--text2)">${esc((p.content||'').slice(0,100))}${p.content?.length>100?'...':''}</div>""",
tag='social posts esc')

# ── sub-accounts rows ──
rep("""    ${accounts.length?accounts.map(a=>`<tr><td style="font-weight:600">${a.name}</td><td>${a.email||'—'}</td><td><span class="badge badge-blue">${a.plan}</span></td><td style="color:var(--green);font-weight:700">${$$$(a.mrr)}</td><td><span class="badge badge-green">${a.status}</span></td></tr>`).join(''):'<tr><td colspan="5"><div class="empty-state">No sub-accounts yet</div></td></tr>'}""",
"""    ${accounts.length?accounts.map(a=>`<tr><td style="font-weight:600">${esc(a.name)}</td><td>${esc(a.email||'—')}</td><td><span class="badge badge-blue">${esc(a.plan)}</span></td><td style="color:var(--green);font-weight:700">${$$$(a.mrr)}</td><td><span class="badge badge-green">${esc(a.status)}</span></td></tr>`).join(''):'<tr><td colspan="5"><div class="empty-state">No sub-accounts yet</div></td></tr>'}""",
tag='subaccounts esc')

# ── invoices rows ──
rep("""      <tbody>${invs.length ? invs.map(i=>`<tr>
        <td style="font-weight:600">${i.number}</td>
        <td>${i.contact_name||'—'}</td>
        <td style="font-weight:700;color:var(--green)">${$$$(i.total)}</td>
        <td><span class="badge ${i.status==='paid'?'badge-green':i.status==='draft'?'badge-gray':'badge-yellow'}">${i.status}</span></td>
        <td style="font-size:12px">${i.due_date||'—'}</td>""",
"""      <tbody>${invs.length ? invs.map(i=>`<tr>
        <td style="font-weight:600">${esc(i.number)}</td>
        <td>${esc(i.contact_name||'—')}</td>
        <td style="font-weight:700;color:var(--green)">${$$$(i.total)}</td>
        <td><span class="badge ${i.status==='paid'?'badge-green':i.status==='draft'?'badge-gray':'badge-yellow'}">${esc(i.status)}</span></td>
        <td style="font-size:12px">${esc(i.due_date||'—')}</td>""",
tag='invoices esc')

# ── reviews list: escape text/contact ──
rep("""            <div style="font-weight:600;margin-bottom:4px">${r.contact_name||'Anonymous'}</div>
            <div style="font-size:13px;color:var(--text2);line-height:1.6">${r.text||'No review text'}</div>
            ${r.ai_reply?`<div class="ai-insight" style="margin-top:10px;padding:10px"><div class="ai-insight-title">🤖 Reply:</div><div class="ai-insight-text">${r.ai_reply}</div></div>`:''}""",
"""            <div style="font-weight:600;margin-bottom:4px">${esc(r.contact_name||'Anonymous')}</div>
            <div style="font-size:13px;color:var(--text2);line-height:1.6">${esc(r.text||'No review text')}</div>
            ${r.ai_reply?`<div class="ai-insight" style="margin-top:10px;padding:10px"><div class="ai-insight-title">🤖 Reply:</div><div class="ai-insight-text">${esc(r.ai_reply)}</div></div>`:''}""",
tag='reviews esc')

# ── workflow list: escape name ──
rep("""              <div style="font-weight:700">${w.name}</div>
              <div style="font-size:12px;color:var(--text2)">Trigger: ${w.trigger.replace(/_/g,' ')}</div>""",
"""              <div style="font-weight:700">${esc(w.name)}</div>
              <div style="font-size:12px;color:var(--text2)">Trigger: ${esc(w.trigger.replace(/_/g,' '))}</div>""",
tag='workflows esc')

# ── pipeline kanban: escape deal title/contact ──
rep("""                <div style="font-size:13px;font-weight:600;margin-bottom:3px">${deal.title}</div>""",
"""                <div style="font-size:13px;font-weight:600;margin-bottom:3px">${esc(deal.title)}</div>""",
tag='kanban title esc')
rep("""                  <span>👤 ${deal.contact_name||'No contact'}</span>""",
"""                  <span>👤 ${esc(deal.contact_name||'No contact')}</span>""",
tag='kanban contact esc')

# ── contacts search input value esc ──
rep("""          <input placeholder="🔍 Search..." style="width:200px" value="${search}" oninput="debounce(q=>views.contacts(q),350)(this.value)">""",
"""          <input placeholder="🔍 Search..." style="width:200px" value="${escAttr(search)}" oninput="debounce(q=>views.contacts(q),350)(this.value)">""",
tag='contacts search esc')

# ── init(): in REAL_MODE, a temporarily-down backend must NOT log the user out ──
rep("""    // verify token is still valid
    try {
      await api('/auth/me');
      connectWS();
      loadAISettings();
      checkGmailConnection();
      navigate('dashboard');
    } catch {
      doLogout();
    }""",
"""    // verify token is still valid
    try {
      await api('/auth/me');
      connectWS();
      loadAISettings();
      checkGmailConnection();
      navigate('dashboard');
    } catch (e) {
      // With a configured backend that's briefly unreachable (cold start,
      // deploy, network), don't log the user out and don't fall back to a
      // phantom local DB — keep the session and retry shortly.
      if (REAL_MODE() && !localStorage.getItem('nx_token')) { doLogout(); return; }
      if (REAL_MODE()) {
        toast('Backend is waking up — retrying…','warning',5000);
        V('auth-screen').style.display = 'none';
        V('user-display-name').textContent = STATE.user?.name || '...';
        setTimeout(init, 10000);
        return;
      }
      doLogout();
    }""",
tag='init real-mode recovery')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 8 done.')
