#!/usr/bin/env python3
"""Backend V4.1 patch 2: trigger links, sites, webchat, analyze-site, review_request, reminders."""
import sys
P = 'backend/src/index.js'
s = open(P, encoding='utf-8').read()

def rep(old, new, count=1, tag=''):
    global s
    n = s.count(old)
    if n != count:
        print(f'❌ [{tag}] expected {count}, found {n}'); print('   OLD:', repr(old[:120])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

# ════════════════════════════════════════════════════════════
# INSERT NEW FEATURE BLOCKS just before the MAIN ROUTER
# ════════════════════════════════════════════════════════════
new_blocks = r'''
// ── TRIGGER LINKS (trackable links that fire workflows) ─────
async function handleTriggerLinks(env, req, auth, parts, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM trigger_links WHERE workspace_id=? ORDER BY id DESC').bind(ws).all();
      return json({ links: results }, 200, origin);
    }
    if (req.method === 'POST') {
      if (!body.name) return err('Name is required', 400, origin);
      let slug = randomSlug(10);
      // keep retrying a unique slug
      for (let i = 0; i < 5; i++) {
        const clash = await env.DB.prepare('SELECT id FROM trigger_links WHERE slug=?').bind(slug).first();
        if (!clash) break;
        slug = randomSlug(10);
      }
      const l = await env.DB.prepare(
        `INSERT INTO trigger_links (workspace_id,name,slug,redirect_url) VALUES (?,?,?,?) RETURNING *`
      ).bind(ws, body.name.slice(0, 120), slug, String(body.redirect_url || '').slice(0, 500)).first();
      return json(l, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM trigger_links WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Link not found', 404, origin);
    const u = { ...existing, ...pick(body, ['name', 'redirect_url']) };
    await env.DB.prepare('UPDATE trigger_links SET name=?,redirect_url=? WHERE id=? AND workspace_id=?')
      .bind(u.name, u.redirect_url, id, ws).run();
    return json(u, 200, origin);
  }
  if (req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM trigger_links WHERE id=? AND workspace_id=?').bind(id, ws).run();
    return json({ ok: true }, 200, origin);
  }
  return err('Not found', 404, origin);
}
async function publicTriggerClick(env, ctx, slug, query, origin, ip) {
  const l = await env.DB.prepare('SELECT * FROM trigger_links WHERE slug=?').bind(slug).first();
  if (!l) return err('Link not found', 404, origin);
  const rl = await rateLimit(env, `tl:${l.id}:${ip}`, 120, 10);
  if (!rl.ok) return err('Rate limited', 429, origin);
  await env.DB.batch([
    env.DB.prepare('UPDATE trigger_links SET clicks = clicks + 1 WHERE id=?').bind(l.id),
    env.DB.prepare("INSERT INTO events (workspace_id,type,payload) VALUES (?, 'trigger_link', ?)")
      .bind(l.workspace_id, JSON.stringify({ link_id: l.id, link_name: l.name, ref: (query.get('ref') || '').slice(0, 100) })),
  ]);
  // fire matching workflows immediately
  const ev = await env.DB.prepare("SELECT id FROM events WHERE workspace_id=? AND type='trigger_link' ORDER BY id DESC LIMIT 1").bind(l.workspace_id).first();
  if (ev) ctx.waitUntil(processEvent(env, ev.id).catch(() => {}));
  const url = l.redirect_url;
  if (url && /^https?:\/\//i.test(url)) return Response.redirect(url, 302);
  return json({ ok: true, click: 1 }, 200, origin);
}

// ── WEBSITES (AI-built, published sites) ─────────────────────
const SITE_FALLBACK_HTML = (name, desc) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${String(name || 'My Site').replace(/</g, '&lt;')}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;color:#1e293b;line-height:1.6}
header{background:linear-gradient(135deg,#4f46e5,#9333ea);color:#fff;padding:70px 20px;text-align:center}
header h1{margin:0 0 10px;font-size:42px}header p{font-size:18px;opacity:.9}
.btn{display:inline-block;margin-top:20px;padding:12px 28px;background:#fff;color:#4f46e5;font-weight:700;border-radius:8px;text-decoration:none}
section{max-width:900px;margin:0 auto;padding:48px 20px}h2{font-size:28px;margin-top:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px}
.card{border:1px solid #e2e8f0;border-radius:12px;padding:24px}
.card h3{margin-top:0}footer{background:#0f172a;color:#94a3b8;text-align:center;padding:24px}</style>
</head><body>
<header><h1>${String(name || 'Welcome').replace(/</g, '&lt;')}</h1><p>${String(desc || 'We build great things.').replace(/</g, '&lt;')}</p><a class="btn" href="#contact">Get Started</a></header>
<section><h2>What we do</h2><div class="grid">
<div class="card"><h3>Service One</h3><p>Describe your first offering here — swap this text in the editor.</p></div>
<div class="card"><h3>Service Two</h3><p>Describe your second offering here.</p></div>
<div class="card"><h3>Service Three</h3><p>Describe your third offering here.</p></div>
</div></section>
<section><h2>Why choose us</h2><p>Add a short paragraph about your strengths, experience, and what makes you different.</p></section>
<section id="contact"><h2>Contact</h2><p>Email: <a href="mailto:hello@yourdomain.com">hello@yourdomain.com</a></p></section>
<footer>© ${new Date().getFullYear()} ${String(name || 'Your Brand').replace(/</g, '&lt;')} — built with NexusCRM</footer>
</body></html>`;

async function aiBuildSite(env, ws, body) {
  const name = String(body.name || '').slice(0, 120) || 'My Website';
  const desc = String(body.description || '').slice(0, 800) || 'A modern business website';
  const w = await getWorkspace(env, ws);
  if (!(await withinDailyCap(env, ws, w.ai_daily_call_cap))) throw new Error(`Daily AI call cap (${w.ai_daily_call_cap}) reached — raise it in Settings → AI Providers if needed.`);
  let html;
  try {
    const r = await callProvider(w, [{
      role: 'user',
      content: `Create a complete, modern, responsive single-page business website in plain HTML. Rules: ONLY inline CSS in a <style> tag, NO external resources (no CDN, no fonts, no JS frameworks — a tiny bit of vanilla JS is allowed), professional color palette, great typography, subtle CSS animations, sections: hero with headline+subheadline+CTA, services/features (3-6 cards), about, testimonials (2-3), contact with a simple form (action="#") showing email + phone. Site name: "${name}". About: ${desc}. Return ONLY the full HTML document starting with <!DOCTYPE html>.`,
    }], { max_tokens: 4000 });
    html = r.content || '';
    await trackAIUsage(env, ws, 'build-site', r.provider, r.usage);
  } catch (e) {
    html = SITE_FALLBACK_HTML(name, desc);
  }
  // Only keep the first HTML document if the model added chatter around it.
  const docStart = html.indexOf('<!DOCTYPE html>');
  const docEnd = html.lastIndexOf('</html>');
  if (docStart >= 0 && docEnd > docStart) html = html.slice(docStart, docEnd + 7);
  if (!html.includes('<!DOCTYPE html>') && !html.startsWith('<html')) html = SITE_FALLBACK_HTML(name, desc);
  if (html.length > 400000) html = html.slice(0, 400000);
  return { name, html };
}
async function handleSites(env, req, auth, parts, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT id,workspace_id,name,slug,published,created_at,updated_at, LENGTH(html) as html_size FROM sites WHERE workspace_id=? ORDER BY id DESC'
      ).bind(ws).all();
      return json({ sites: results }, 200, origin);
    }
    if (req.method === 'POST') {
      if (!body.name) return err('Name is required', 400, origin);
      let html = String(body.html || '');
      let slug = randomSlug(10);
      for (let i = 0; i < 5; i++) {
        const clash = await env.DB.prepare('SELECT id FROM sites WHERE slug=?').bind(slug).first();
        if (!clash) break;
        slug = randomSlug(10);
      }
      if (body.build_with_ai) {
        const built = await aiBuildSite(env, ws, body);
        html = built.html;
      }
      const site = await env.DB.prepare(
        `INSERT INTO sites (workspace_id,name,slug,html,published) VALUES (?,?,?,?,?) RETURNING *`
      ).bind(ws, body.name.slice(0, 120), slug, html, body.published ? 1 : 0).first();
      return json({ ...site, html }, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'GET' && parts[2] === 'html') {
    const site = await env.DB.prepare('SELECT * FROM sites WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!site) return err('Site not found', 404, origin);
    return json({ html: site.html }, 200, origin);
  }
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM sites WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Site not found', 404, origin);
    const u = { ...existing, ...pick(body, ['name', 'published', 'html']) };
    if (body.build_with_ai) {
      const built = await aiBuildSite(env, ws, { name: u.name, description: body.description || '' });
      u.html = built.html;
    }
    await env.DB.prepare('UPDATE sites SET name=?,published=?,html=?,updated_at=? WHERE id=? AND workspace_id=?')
      .bind(u.name, u.published ? 1 : 0, String(u.html || '').slice(0, 400000), nowISO(), id, ws).run();
    return json({ ...u, html: u.html }, 200, origin);
  }
  if (req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM sites WHERE id=? AND workspace_id=?').bind(id, ws).run();
    return json({ ok: true }, 200, origin);
  }
  return err('Not found', 404, origin);
}
async function publicSiteGet(env, slug, origin) {
  const site = await env.DB.prepare('SELECT * FROM sites WHERE slug=? AND published=1').bind(slug).first();
  if (!site) return err('Site not found or not published', 404, origin);
  return new Response(site.html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders(origin) },
  });
}

// ── AI WEBSITE ANALYZER (audit any public URL) ───────────────
async function aiAnalyzeSite(env, ws, body) {
  const url = String(body.url || '').trim();
  if (!/^https?:\/\//i.test(url) || url.length > 500) throw new Error('Enter a valid http(s) URL');
  const w = await getWorkspace(env, ws);
  if (!(await withinDailyCap(env, ws, w.ai_daily_call_cap))) throw new Error(`Daily AI call cap (${w.ai_daily_call_cap}) reached — raise it in Settings → AI Providers if needed.`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  let res;
  try { res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'NexusCRM-SiteChecker/1.0' } }); }
  catch (e) { clearTimeout(t); throw new Error('Could not fetch that URL: ' + e.message); }
  clearTimeout(t);
  if (!res.ok) throw new Error(`The site returned HTTP ${res.status} — check the URL.`);
  const raw = await res.text().catch(() => '');
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim()
    .slice(0, 8000);
  const r = await callProvider(w, [{
    role: 'user',
    content: `Act as an expert website auditor. Analyze this page text (title/URL: ${url}):\n"${text || '(no readable text extracted)'}"\nGive: 1) Overall verdict (score /10), 2) What the page does well, 3) Specific problems: SEO (title/meta/h1/headings), clarity of message, call-to-action strength, trust signals, structure, 4) Top 5 concrete fixes ranked by impact, 5) Suggested headline that would convert better. Be specific and blunt.`,
  }], { max_tokens: 1000 });
  await trackAIUsage(env, ws, 'analyze-site', r.provider, r.usage);
  return { url, content: r.content };
}

// ── WEBCHAT WIDGET (public AI chat, lands in your inbox) ─────
function webchatEmbedScript(token, baseUrl) {
  const POST = `${baseUrl}/api/public/webchat/${token}/message`;
  return `(function(){
  if (document.getElementById("nx-webchat-${token.slice(0,8)}")) return;
  var token="${token}";
  var base="${baseUrl}";
  var els={};
  var root=document.createElement("div");
  root.id="nx-webchat-${token.slice(0,8)}";
  root.style.cssText="position:fixed;bottom:20px;right:20px;z-index:999999;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
  root.innerHTML='<div id="nxw-btn" style="width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;cursor:pointer;box-shadow:0 6px 24px rgba(99,102,241,.5);user-select:none">💬</div>'+
  '<div id="nxw-panel" style="display:none;position:absolute;bottom:74px;right:0;width:340px;max-width:calc(100vw - 40px);height:440px;background:#fff;border-radius:14px;box-shadow:0 12px 48px rgba(0,0,0,.25);overflow:hidden;flex-direction:column">'+
  '<div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:12px 16px;font-weight:700;font-size:14px">👋 Chat with us</div>'+
  '<div id="nxw-msgs" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f8fafc"></div>'+
  '<div style="display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#fff"><input id="nxw-in" placeholder="Type a message..." style="flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:9px 12px;font-size:13px;outline:none"><button id="nxw-send" style="background:#4f46e5;color:#fff;border:none;border-radius:8px;padding:0 14px;cursor:pointer">➤</button></div></div>';
  (document.body||document.documentElement).appendChild(root);
  var btn=root.querySelector("#nxw-btn"),panel=root.querySelector("#nxw-panel"),msgs=root.querySelector("#nxw-msgs"),inp=root.querySelector("#nxw-in"),send=root.querySelector("#nxw-send");
  function bubble(role,text){var d=document.createElement("div");d.style.cssText="max-width:85%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;"+(role==="user"?"align-self:flex-end;background:#4f46e5;color:#fff;border-bottom-right-radius:2px":"align-self:flex-start;background:#fff;color:#1e293b;border:1px solid #e2e8f0;border-bottom-left-radius:2px");d.textContent=text;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;return d;}
  function open(){panel.style.display="flex";btn.style.display="none";inp.focus();}
  function close(){panel.style.display="none";btn.style.display="flex";}
  btn.onclick=open;
  panel.querySelector("div").style.cursor="default";
  var history=[];
  function sendMsg(){
    var t=inp.value.trim();if(!t)return;inp.value="";
    bubble("user",t);history.push({role:"user",content:t});
    var typing=bubble("assistant","…");
    fetch(base+"/api/public/webchat/"+token+"/message",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:t,history:history.slice(-8)})})
    .then(function(r){if(!r.ok){typing.textContent="⚠️ "+(r.status===429?"Too many messages — try again shortly.":"Service unavailable.");return;}
      var reader=r.body.getReader(),dec=new TextDecoder(),full="";
      function pump(){return reader.read().then(function(x){if(x.done){typing.textContent=full||"(no reply)";history.push({role:"assistant",content:full});return;}
        var chunk=dec.decode(x.value,{stream:true}).split("\\n");
        for(var i=0;i<chunk.length;i++){var line=chunk[i].trim();if(line.indexOf("data: ")!==0)continue;try{var d=JSON.parse(line.slice(6));if(d.delta)full+=d.delta;if(d.done)break;}catch(e){}}
        typing.textContent=full||"…";return pump();});}
      return pump();})
    .catch(function(){typing.textContent="Could not reach the server.";});
  }
  send.onclick=sendMsg;
  inp.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();sendMsg();}});
})();`;
}
async function handleWebchatSettings(env, req, auth, origin) {
  const ws = auth.workspaceId;
  const w = await getWorkspace(env, ws);
  if (req.method === 'GET') {
    const { results } = await env.DB.prepare(
      "SELECT m.*, c.name as contact_name FROM messages m LEFT JOIN contacts c ON c.id=m.contact_id WHERE m.workspace_id=? AND m.channel='webchat' ORDER BY m.id DESC LIMIT 100"
    ).bind(ws).all();
    return json({ public_token: w.public_token || '', conversations: results.reverse() }, 200, origin);
  }
  if (req.method === 'POST' && req.headers.get('X-Regenerate') === '1') {
    const token = randomToken().slice(0, 24);
    await env.DB.prepare('UPDATE workspaces SET public_token=? WHERE id=?').bind(token, ws).run();
    invalidateWorkspaceCache(ws);
    return json({ public_token: token }, 200, origin);
  }
  return err('Not found', 404, origin);
}
async function publicWebchatMessage(env, token, body, origin, ip) {
  const w = await env.DB.prepare('SELECT * FROM workspaces WHERE public_token=?').bind(token).first();
  if (!w) return err('Widget not found', 404, origin);
  const rl = await rateLimit(env, `wc:${w.id}:${ip}`, 60, 60);
  if (!rl.ok) return err('Too many messages — try again later.', 429, origin);
  const message = String(body.message || '').slice(0, 500);
  if (!message.trim()) return err('Message is required', 400, origin);

  await env.DB.prepare("INSERT INTO messages (workspace_id,channel,subject,body,direction) VALUES (?,?,'',?,'inbound')")
    .bind(w.id, 'webchat', message).run();

  // Build the AI reply (uses the workspace's own AI settings + CRM context)
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  let ctx;
  try { ctx = await workspaceContextSummary(env, w.id); } catch { ctx = ''; }
  const sysParts = [];
  if (w.ai_system_prompt) sysParts.push(w.ai_system_prompt);
  if (ctx) sysParts.push('LIVE BUSINESS DATA (use it if relevant): ' + ctx);
  sysParts.push('You are a friendly website chat assistant. Be concise (under 120 words), helpful, and honest when you do not know something. Never invent prices or facts not given.');
  const messages = [
    { role: 'system', content: sysParts.join('\n') },
    ...history.filter(m => m.role === 'user' || m.role === 'assistant'),
  ];

  let streamRes;
  try {
    streamRes = await openProviderStream(w, messages, { max_tokens: 600 });
  } catch (e) {
    // fallback: static polite reply without AI
    const enc = new TextEncoder();
    const fallback = `Thanks for your message! We'll get back to you as soon as possible.`;
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ delta: fallback })}\n\n`));
        c.enqueue(enc.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        c.close();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', ...corsHeaders(origin) } });
  }
  await trackAIUsage(env, w.id, 'webchat', streamRes.provider, {});
  const reader = streamRes.res.body.getReader();
  const decoder = new TextDecoder(); const encoder = new TextEncoder();
  let buf = '';
  const stream = new ReadableStream({
    async pull(controller) {
      let value, done;
      try { ({ value, done } = await reader.read()); }
      catch { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)); controller.close(); return; }
      if (done) { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)); controller.close(); return; }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload);
          const delta = j.choices?.[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
        } catch { }
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', ...corsHeaders(origin) } });
}

// ── APPOINTMENT 24h REMINDERS ────────────────────────────────
async function sendAppointmentReminders(env, ws) {
  const w = await getWorkspace(env, ws);
  if (!w.resend_from_email) return;
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { results: due } = await env.DB.prepare(
    `SELECT * FROM appointments WHERE workspace_id=? AND status='scheduled' AND date=? AND reminder_sent=0 LIMIT 20`
  ).bind(ws, tomorrow).all();
  if (!due.length) return;
  const userRow = await env.DB.prepare('SELECT email FROM users WHERE workspace_id=? LIMIT 1').bind(ws).first();
  if (!userRow) return;
  const body = `Reminder: you have ${due.length} appointment(s) tomorrow:\n\n` +
    due.map(a => `• ${a.title} at ${a.time}${a.contact_id ? '' : ''}`).join('\n');
  try {
    await sendEmailViaResend(w, { to: userRow.email, subject: `📅 ${due.length} appointment${due.length === 1 ? '' : 's'} tomorrow in NexusCRM`, body });
    await env.DB.prepare('UPDATE appointments SET reminder_sent=1 WHERE id IN (' + due.map(() => '?').join(',') + ')')
      .bind(...due.map(a => a.id)).run();
  } catch (e) { console.error('appointment reminder failed', e); }
}

'''

anchor = "// ── MAIN ROUTER ───────────────────────────────────────────────"
n = s.count(anchor)
if n != 1:
    print('❌ router anchor count', n); sys.exit(1)
s = s.replace(anchor, new_blocks + anchor)
print('  ✅ inserted feature blocks')

# ── executeStep: send_review_request action ──
rep("""  if (action === 'send_whatsapp') {""",
"""  if (action === 'send_review_request' && contact?.email) {
    const w = await getWorkspace(env, ws);
    try {
      let content = step.note || 'Thank you for choosing us! We would love your feedback. Could you take a minute to leave us a review? Here is the link: [YOUR REVIEW LINK]';
      if (providerPriority(w).length && (await withinDailyCap(env, ws, w.ai_daily_call_cap))) {
        try {
          const r = await callProvider(w, [{ role: 'user', content: `Write a short, warm email (under 90 words) asking ${contact.name} for a Google review after a completed service. Context: ${step.note || 'recently completed service'}. Mention that a review helps our small business.` }], { max_tokens: 200 });
          content = r.content;
          await trackAIUsage(env, ws, 'review-request', r.provider, r.usage);
        } catch { /* keep template */ }
      }
      await sendEmailViaResend(w, { to: contact.email, subject: 'We would love your feedback ⭐', body: content });
      await env.DB.prepare("INSERT INTO messages (workspace_id,contact_id,channel,subject,body,direction,ai_generated) VALUES (?,?,?,?,?,'outbound',1)")
        .bind(ws, contact.id, 'email', 'We would love your feedback ⭐', content).run();
      return { ok: true };
    } catch (e) {
      await env.DB.prepare("INSERT INTO tasks (workspace_id,contact_id,title,description,priority,status) VALUES (?,?,?,?,'high','todo')")
        .bind(ws, contact.id, `⭐ Send review request to ${contact.name}`, `Workflow tried to email a review request but: ${e.message}`).run();
      return { ok: false, error: e.message };
    }
  }
  if (action === 'send_whatsapp') {""",
tag='review_request action')

# ── runHourlyJobs: appointment reminders + body-size guard ──
rep("""  for (const w of workspaces) {
    await sendOverdueTaskReminders(env, w.id).catch(e => console.error(e));
    const full = await getWorkspace(env, w.id);
    if (full.ai_daily_digest_enabled && full.ai_daily_digest_hour_utc === hour) {
      await sendDailyDigest(env, w.id).catch(e => console.error(e));
    }
  }""",
"""  for (const w of workspaces) {
    await sendOverdueTaskReminders(env, w.id).catch(e => console.error(e));
    await sendAppointmentReminders(env, w.id).catch(e => console.error(e));
    const full = await getWorkspace(env, w.id);
    if (full.ai_daily_digest_enabled && full.ai_daily_digest_hour_utc === hour) {
      await sendDailyDigest(env, w.id).catch(e => console.error(e));
    }
  }""",
tag='appointment reminders')

# ── router: public routes + authed routes + body size guard ──
rep("""  let body = {};
  if (['POST', 'PATCH'].includes(req.method)) {
    try { body = await req.json(); } catch { body = {}; }
  }""",
"""  // Body size guard — reject oversized payloads before parsing.
  const contentLen = parseInt(req.headers.get('Content-Length') || '0');
  if (contentLen > 1_500_000) return err('Request body too large', 413, origin);
  let body = {};
  if (['POST', 'PATCH'].includes(req.method)) {
    try { body = await req.json(); } catch { body = {}; }
  }""",
tag='body guard')

rep("""    // GET /public/affiliate/go?token=..&url=..&ref=.. — click tracking
    if (parts[1] === 'affiliate' && parts[2] === 'go' && req.method === 'GET') return publicAffiliateGo(env, query, origin, ip);
  }""",
"""    // GET /public/affiliate/go?token=..&url=..&ref=.. — click tracking
    if (parts[1] === 'affiliate' && parts[2] === 'go' && req.method === 'GET') return publicAffiliateGo(env, query, origin, ip);
    // GET /public/trigger/:slug — trigger link click → fires workflows
    if (parts[1] === 'trigger' && parts.length === 3 && req.method === 'GET') return publicTriggerClick(env, ctx, parts[2], query, origin, ip);
    // GET /public/site/:slug — published website
    if (parts[1] === 'site' && parts.length === 3 && req.method === 'GET') return publicSiteGet(env, parts[2], origin);
    // GET /public/webchat/:token/embed.js — chat widget script
    if (parts[1] === 'webchat' && parts[3] === 'embed.js' && parts.length === 4 && req.method === 'GET') {
      const w = await env.DB.prepare('SELECT * FROM workspaces WHERE public_token=?').bind(parts[2]).first();
      if (!w) return err('Widget not found', 404, origin);
      const script = webchatEmbedScript(parts[2], new URL(req.url).origin);
      return new Response(script, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders(origin) } });
    }
    // POST /public/webchat/:token/message — widget chat message → AI reply (SSE)
    if (parts[1] === 'webchat' && parts[3] === 'message' && parts.length === 4 && req.method === 'POST') {
      let b = {}; try { b = await req.json(); } catch { }
      return publicWebchatMessage(env, parts[2], b, origin, ip);
    }
  }""",
tag='public routes')

rep("""  if (root === 'community') return handleCommunity(env, req, auth, parts, body, origin);
  if (path === '/stats') return json(await computeStats(env, auth.workspaceId), 200, origin);""",
"""  if (root === 'community') return handleCommunity(env, req, auth, parts, body, origin);
  if (root === 'trigger-links') return handleTriggerLinks(env, req, auth, parts, body, origin);
  if (root === 'sites') return handleSites(env, req, auth, parts, body, origin);
  if (path === '/webchat') return handleWebchatSettings(env, req, auth, origin);
  if (path === '/stats') return json(await computeStats(env, auth.workspaceId), 200, origin);""",
tag='authed routes')

rep("""  if (path === '/ai/rewrite' && req.method === 'POST') {
    try { return json(await aiOpRewrite(env, auth.workspaceId, body), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }""",
"""  if (path === '/ai/rewrite' && req.method === 'POST') {
    try { return json(await aiOpRewrite(env, auth.workspaceId, body), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/build-site' && req.method === 'POST') {
    try { return json(await aiBuildSite(env, auth.workspaceId, body), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/analyze-site' && req.method === 'POST') {
    try { return json(await aiAnalyzeSite(env, auth.workspaceId, body), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }""",
tag='ai site routes')

open(P, 'w', encoding='utf-8').write(s)
print('Backend patch 2 done.')
