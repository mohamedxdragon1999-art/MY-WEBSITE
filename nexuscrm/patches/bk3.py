#!/usr/bin/env python3
"""Backend patch 3: webchat widget fixes — close button, regenerate fix, daily cap, history caps."""
import sys
P = 'backend/src/index.js'
s = open(P, encoding='utf-8').read()

def repBlock(start, end, new, tag):
    global s
    i = s.find(start)
    if i < 0:
        print(f'❌ [{tag}] start anchor not found'); sys.exit(1)
    j = s.find(end, i + len(start))
    if j < 0:
        print(f'❌ [{tag}] end anchor not found'); sys.exit(1)
    j += len(end)
    s = s[:i] + new + s[j:]
    print(f'  ✅ [{tag}]')

# ── 1. Rewrite the widget script: close button, cleaner code, no unused vars ──
repBlock(
"function webchatEmbedScript(token, baseUrl) {",
"async function handleWebchatSettings(env, req, auth, origin) {",
r'''function webchatEmbedScript(token, baseUrl) {
  return `(function(){
  if (document.getElementById("nx-webchat-${token.slice(0,8)}")) return;
  var token="${token}";
  var base="${baseUrl}";
  var root=document.createElement("div");
  root.id="nx-webchat-${token.slice(0,8)}";
  root.style.cssText="position:fixed;bottom:20px;right:20px;z-index:999999;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
  root.innerHTML='<div id="nxw-btn" role="button" aria-label="Open chat" style="width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;cursor:pointer;box-shadow:0 6px 24px rgba(99,102,241,.5);user-select:none">💬</div>'+
  '<div id="nxw-panel" style="display:none;position:absolute;bottom:74px;right:0;width:340px;max-width:calc(100vw - 40px);height:440px;background:#fff;border-radius:14px;box-shadow:0 12px 48px rgba(0,0,0,.25);overflow:hidden;flex-direction:column">'+
  '<div style="display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:12px 12px 12px 16px;font-weight:700;font-size:14px"><span>👋 Chat with us</span><button id="nxw-x" aria-label="Close chat" style="background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:8px;width:28px;height:28px;font-size:15px;cursor:pointer;line-height:1">✕</button></div>'+
  '<div id="nxw-msgs" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f8fafc"></div>'+
  '<div style="display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#fff"><input id="nxw-in" placeholder="Type a message..." style="flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:9px 12px;font-size:13px;outline:none"><button id="nxw-send" style="background:#4f46e5;color:#fff;border:none;border-radius:8px;padding:0 14px;cursor:pointer">➤</button></div></div>';
  (document.body||document.documentElement).appendChild(root);
  var btn=root.querySelector("#nxw-btn"),panel=root.querySelector("#nxw-panel"),msgs=root.querySelector("#nxw-msgs"),inp=root.querySelector("#nxw-in"),send=root.querySelector("#nxw-send"),xbtn=root.querySelector("#nxw-x");
  function bubble(role,text){var d=document.createElement("div");d.style.cssText="max-width:85%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;"+(role==="user"?"align-self:flex-end;background:#4f46e5;color:#fff;border-bottom-right-radius:2px":"align-self:flex-start;background:#fff;color:#1e293b;border:1px solid #e2e8f0;border-bottom-left-radius:2px");d.textContent=text;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;return d;}
  function open(){panel.style.display="flex";btn.style.display="none";inp.focus();}
  function close(){panel.style.display="none";btn.style.display="flex";}
  btn.onclick=open;
  xbtn.onclick=function(e){e.stopPropagation();close();};
  var history=[],busy=false;
  function sendMsg(){
    if(busy)return;
    var t=inp.value.trim();if(!t)return;inp.value="";
    bubble("user",t);history.push({role:"user",content:t});
    var typing=bubble("assistant","…");busy=true;
    fetch(base+"/api/public/webchat/"+token+"/message",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:t,history:history.slice(-8)})})
    .then(function(r){if(!r.ok){busy=false;typing.textContent="⚠️ "+(r.status===429?"Too many messages — try again shortly.":"Service unavailable.");return;}
      var reader=r.body.getReader(),dec=new TextDecoder(),full="";
      function pump(){return reader.read().then(function(x){if(x.done){typing.textContent=full||"(no reply)";history.push({role:"assistant",content:full});busy=false;return;}
        var chunk=dec.decode(x.value,{stream:true}).split("\\n");
        for(var i=0;i<chunk.length;i++){var line=chunk[i].trim();if(line.indexOf("data: ")!==0)continue;try{var d=JSON.parse(line.slice(6));if(d.delta)full+=d.delta;if(d.done)break;}catch(e){}}
        typing.textContent=full||"…";return pump();});}
      return pump();})
    .catch(function(){busy=false;typing.textContent="Could not reach the server.";});
  }
  send.onclick=sendMsg;
  inp.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();sendMsg();}});
})();`;
}

// Small helper: build an SSE response that streams plain text.
function sseText(text, origin) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ delta: text })}\n\n`));
      c.enqueue(enc.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      c.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', ...corsHeaders(origin) } });
}

async function handleWebchatSettings(env, req, auth, origin) {''',
'widget script rewrite')

# ── 2. Regenerate token on ANY POST (frontend api() can't set custom headers) ──
old = """  if (req.method === 'POST' && req.headers.get('X-Regenerate') === '1') {
    const token = randomToken().slice(0, 24);"""
new = """  if (req.method === 'POST') {
    const token = randomToken().slice(0, 24);"""
n = s.count(old)
if n != 1:
    print('❌ regenerate condition not found (count', n, ')'); sys.exit(1)
s = s.replace(old, new)
print('  ✅ regenerate on any POST')

# ── 3. Daily cap enforcement + history length caps in publicWebchatMessage ──
old2 = """  await env.DB.prepare("INSERT INTO messages (workspace_id,channel,subject,body,direction) VALUES (?,?,'',?,'inbound')")
    .bind(w.id, 'webchat', message).run();

  // Build the AI reply (uses the workspace's own AI settings + CRM context)
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];"""
new2 = """  await env.DB.prepare("INSERT INTO messages (workspace_id,channel,subject,body,direction) VALUES (?,?,'',?,'inbound')")
    .bind(w.id, 'webchat', message).run();

  // Daily AI cap: never let the widget burn past the workspace's limit.
  const cap = await withinDailyCap(env, w.id, w.ai_daily_call_cap);
  if (!cap) return sseText('Thanks for your message! We have reached our daily chat limit, but we will reply to you as soon as possible.', origin);

  // Build the AI reply (uses the workspace's own AI settings + CRM context)
  const history = Array.isArray(body.history)
    ? body.history.slice(-8).map(m => ({ role: m.role, content: String(m.content || '').slice(0, 1000) }))
    : [];"""
n2 = s.count(old2)
if n2 != 1:
    print('❌ history block not found (count', n2, ')'); sys.exit(1)
s = s.replace(old2, new2)
print('  ✅ daily cap + history caps')

# ── 4. Use sseText for the provider-failure fallback too ──
old3 = """  } catch (e) {
    // fallback: static polite reply without AI
    const enc = new TextEncoder();
    const fallback = `Thanks for your message! We'll get back to you as soon as possible.`;
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ delta: fallback })}\\n\\n`));
        c.enqueue(enc.encode(`data: ${JSON.stringify({ done: true })}\\n\\n`));
        c.close();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', ...corsHeaders(origin) } });
  }"""
new3 = """  } catch (e) {
    // fallback: static polite reply without AI
    return sseText("Thanks for your message! We'll get back to you as soon as possible.", origin);
  }"""
n3 = s.count(old3)
if n3 != 1:
    print('❌ fallback block not found (count', n3, ')'); sys.exit(1)
s = s.replace(old3, new3)
print('  ✅ sseText fallback')

open(P, 'w', encoding='utf-8').write(s)
print('Backend patch 3 done.')
