#!/usr/bin/env python3
"""Backend patch 5 (v2): chat memory, pipeline health, image analysis, AI rate limits, richer context."""
import sys
P = 'backend/src/index.js'
s = open(P, encoding='utf-8').read()

def rep(old, new, tag):
    global s
    n = s.count(old)
    if n != 1:
        print(f'❌ [{tag}] found {n}'); print('OLD:', repr(old[:100])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

def insertBefore(anchor, block, tag):
    global s
    n = s.count(anchor)
    if n != 1:
        print(f'❌ [{tag}] anchor count {n}'); sys.exit(1)
    s = s.replace(anchor, block + anchor)
    print(f'  ✅ [{tag}]')

# ── 1. Richer workspace context ──
rep("""async function workspaceContextSummary(env, ws) {
  const [stats, hot, overdue, appts, recentContacts, openDeals, forms] = await Promise.all([
    computeStats(env, ws),
    env.DB.prepare('SELECT name, ai_score, stage FROM contacts WHERE workspace_id=? AND ai_score > 0 ORDER BY ai_score DESC LIMIT 3').bind(ws).all(),
    env.DB.prepare(`SELECT title, due_date FROM tasks WHERE workspace_id=? AND status='todo' AND due_date != '' AND due_date < date('now') LIMIT 5`).bind(ws).all(),
    env.DB.prepare(`SELECT title, date, time FROM appointments WHERE workspace_id=? AND status='scheduled' AND date >= date('now') ORDER BY date,time LIMIT 5`).bind(ws).all(),
    env.DB.prepare('SELECT name, stage FROM contacts WHERE workspace_id=? ORDER BY updated_at DESC LIMIT 5').bind(ws).all(),
    env.DB.prepare(`SELECT title, value, stage FROM deals WHERE workspace_id=? AND stage NOT IN ('won','lost') ORDER BY value DESC LIMIT 5`).bind(ws).all(),
    env.DB.prepare('SELECT name FROM forms WHERE workspace_id=? LIMIT 5').bind(ws).all(),
  ]);
  const fmt = n => '$' + Number(n || 0).toLocaleString();
  return `LIVE CRM DATA (use this — do not invent numbers): ${stats.contacts} contacts, ${stats.open_deals} open deals worth ${fmt(stats.pipeline_value)}, won revenue ${fmt(stats.won_revenue)}, ${stats.pending_tasks} pending tasks, ${stats.upcoming_appointments} upcoming appointments, ${stats.forms} forms. `
    + `Top open deals: ${openDeals.results.length ? openDeals.results.map(d => `${d.title} (${d.stage}, ${fmt(d.value)})`).join('; ') : 'none'}. `
    + `Hottest leads: ${hot.results.length ? hot.results.map(c => `${c.name} (score ${c.ai_score})`).join(', ') : 'none scored yet'}. `
    + `Overdue tasks: ${overdue.results.length ? overdue.results.map(t => t.title).join(', ') : 'none'}. `
    + `Upcoming appointments: ${appts.results.length ? appts.results.map(a => `${a.title} ${a.date} ${a.time}`).join('; ') : 'none'}. `
    + `Recent contacts: ${recentContacts.results.map(c => c.name).join(', ') || 'none'}.`
    + ` Forms: ${forms.results.map(f => f.name).join(', ') || 'none'}.`;
}""",
"""async function workspaceContextSummary(env, ws) {
  const [stats, hot, overdue, appts, recentContacts, openDeals, forms, subs, won, invoices, webchats, sites, links] = await Promise.all([
    computeStats(env, ws),
    env.DB.prepare('SELECT name, ai_score, stage FROM contacts WHERE workspace_id=? AND ai_score > 0 ORDER BY ai_score DESC LIMIT 3').bind(ws).all(),
    env.DB.prepare(`SELECT title, due_date FROM tasks WHERE workspace_id=? AND status='todo' AND due_date != '' AND due_date < date('now') LIMIT 5`).bind(ws).all(),
    env.DB.prepare(`SELECT title, date, time FROM appointments WHERE workspace_id=? AND status='scheduled' AND date >= date('now') ORDER BY date,time LIMIT 5`).bind(ws).all(),
    env.DB.prepare('SELECT name, stage FROM contacts WHERE workspace_id=? ORDER BY updated_at DESC LIMIT 5').bind(ws).all(),
    env.DB.prepare(`SELECT title, value, stage FROM deals WHERE workspace_id=? AND stage NOT IN ('won','lost') ORDER BY value DESC LIMIT 5`).bind(ws).all(),
    env.DB.prepare('SELECT name FROM forms WHERE workspace_id=? LIMIT 5').bind(ws).all(),
    env.DB.prepare('SELECT COUNT(*) n FROM sub_accounts WHERE workspace_id=?').bind(ws).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM deals WHERE workspace_id=? AND stage='won'`).bind(ws).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM invoices WHERE workspace_id=? AND status='paid'`).bind(ws).first(),
    env.DB.prepare("SELECT COUNT(*) n FROM messages WHERE workspace_id=? AND channel='webchat' AND created_at >= ?").bind(ws, new Date(Date.now() - 7 * 86400000).toISOString()).first(),
    env.DB.prepare('SELECT COUNT(*) n FROM sites WHERE workspace_id=?').bind(ws).first(),
    env.DB.prepare('SELECT COUNT(*) n FROM trigger_links WHERE workspace_id=?').bind(ws).first(),
  ]);
  const fmt = n => '$' + Number(n || 0).toLocaleString();
  return `LIVE CRM DATA (use this — do not invent numbers): ${stats.contacts} contacts, ${stats.open_deals} open deals worth ${fmt(stats.pipeline_value)}, won revenue ${fmt(stats.won_revenue)}, ${won.n} won deals, ${stats.pending_tasks} pending tasks, ${stats.upcoming_appointments} upcoming appointments, ${stats.forms} forms, ${subs.n} sub-accounts, ${invoices.n} paid invoices, ${sites.n} website(s), ${links.n} trigger link(s), ${webchats.n} webchat message(s) this week. `
    + `Top open deals: ${openDeals.results.length ? openDeals.results.map(d => `${d.title} (${d.stage}, ${fmt(d.value)})`).join('; ') : 'none'}. `
    + `Hottest leads: ${hot.results.length ? hot.results.map(c => `${c.name} (score ${c.ai_score})`).join(', ') : 'none scored yet'}. `
    + `Overdue tasks: ${overdue.results.length ? overdue.results.map(t => t.title).join(', ') : 'none'}. `
    + `Upcoming appointments: ${appts.results.length ? appts.results.map(a => `${a.title} ${a.date} ${a.time}`).join('; ') : 'none'}. `
    + `Recent contacts: ${recentContacts.results.map(c => c.name).join(', ') || 'none'}.`
    + ` Forms: ${forms.results.map(f => f.name).join(', ') || 'none'}.`;
}""",
'richer context')

# ── 2. Memory + pipeline health + image analysis helpers ──
insertBefore("// ── AI CHAT STREAMING (SSE, with error events + fallback) ────",
r'''// ── CHAT MEMORY (persistent, per-workspace conversation history) ──
// The AI remembers past conversations across sessions — the chat panel and
// Command Hub are no longer stateless. Memory is capped (last 30 messages)
// and can be cleared from the UI.
async function loadChatMemory(env, ws, limit) {
  const { results } = await env.DB.prepare(
    'SELECT role, content FROM chat_memory WHERE workspace_id=? ORDER BY id DESC LIMIT ?'
  ).bind(ws, Math.min(limit || 10, 30)).all();
  return results.reverse();
}
async function appendChatMemory(env, ws, role, content) {
  if (!content || !String(content).trim()) return;
  await env.DB.prepare('INSERT INTO chat_memory (workspace_id, role, content) VALUES (?,?,?)')
    .bind(ws, role === 'assistant' ? 'assistant' : 'user', String(content).slice(0, 4000)).run();
  await env.DB.prepare(
    `DELETE FROM chat_memory WHERE id NOT IN (SELECT id FROM chat_memory WHERE workspace_id=? ORDER BY id DESC LIMIT 30)`
  ).bind(ws).run();
}
async function clearChatMemory(env, ws) {
  await env.DB.prepare('DELETE FROM chat_memory WHERE workspace_id=?').bind(ws).run();
}

// ── AI PIPELINE HEALTH (structured 0-100 score + reasons) ──
async function aiPipelineHealth(env, ws) {
  const stats = await computeStats(env, ws);
  const [deals, overdueN, staleDeals, appts7, topDeal] = await Promise.all([
    env.DB.prepare(`SELECT title,value,stage,probability,close_date,created_at FROM deals WHERE workspace_id=? AND stage NOT IN ('won','lost')`).bind(ws).all(),
    env.DB.prepare(`SELECT COUNT(*) n FROM tasks WHERE workspace_id=? AND status='todo' AND due_date != '' AND due_date < date('now')`).bind(ws).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM deals WHERE workspace_id=? AND stage NOT IN ('won','lost') AND created_at < ?`).bind(ws, new Date(Date.now() - 30 * 86400000).toISOString()).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM appointments WHERE workspace_id=? AND status='scheduled' AND date >= date('now') AND date < date('now','+7 days')`).bind(ws).first(),
    env.DB.prepare(`SELECT title,value FROM deals WHERE workspace_id=? AND stage NOT IN ('won','lost') ORDER BY value DESC LIMIT 1`).bind(ws).first(),
  ]);
  let score = 60;
  const reasons = [];
  if (stats.open_deals === 0) { score -= 20; reasons.push('No open deals — pipeline is empty'); }
  else {
    const avg = stats.pipeline_value / stats.open_deals;
    if (avg >= 5000) { score += 10; reasons.push(`Healthy average deal size (${'$' + Math.round(avg).toLocaleString()})`); }
    else { score -= 5; reasons.push(`Average deal size is small (${'$' + Math.round(avg).toLocaleString()})`); }
    const withProb = deals.results.filter(d => (d.probability || 0) >= 50);
    if (withProb.length >= 2) { score += 8; reasons.push(`${withProb.length} deal(s) at ≥50% probability — close to winning`); }
    else reasons.push('Few deals above 50% probability');
    if (staleDeals.n > 0) { score -= Math.min(12, staleDeals.n * 4); reasons.push(`${staleDeals.n} deal(s) untouched for 30+ days — follow up or clean up`); }
  }
  if (overdueN.n > 0) { score -= Math.min(10, overdueN.n * 2); reasons.push(`${overdueN.n} overdue task(s)`); }
  else { score += 5; reasons.push('No overdue tasks'); }
  if (appts7.n >= 2) { score += 5; reasons.push(`${appts7.n} appointment(s) in the next 7 days`); }
  if (stats.won_revenue > 0) { score += 7; reasons.push(`Won ${'$' + stats.won_revenue.toLocaleString()} so far`); }
  if (topDeal) reasons.push(`Biggest open opportunity: ${topDeal.title} (${'$' + (topDeal.value || 0).toLocaleString()})`);
  score = Math.max(5, Math.min(99, Math.round(score)));
  return { score, verdict: score >= 80 ? 'Excellent' : score >= 60 ? 'Healthy' : score >= 40 ? 'Needs attention' : 'Critical', reasons: reasons.slice(0, 6) };
}

// ── AI IMAGE ANALYSIS (vision models, e.g. llama-3.2-90b-vision on NVIDIA) ──
async function aiAnalyzeImage(env, ws, body) {
  const url = String(body.url || '').trim();
  const imageData = String(body.image_data || '').trim(); // data URL or base64
  if (!url && !imageData) throw new Error('Provide an image URL or paste an image.');
  if (url && !/^https?:\/\//i.test(url)) throw new Error('The image URL must start with http(s).');
  if (imageData && imageData.length > 8_000_000) throw new Error('Image too large (max ~8 MB).');
  const w = await getWorkspace(env, ws);
  if (!(await withinDailyCap(env, ws, w.ai_daily_call_cap))) throw new Error('Daily AI call cap reached — raise it in Settings → AI Providers if needed.');
  const imageUrl = url || imageData;
  const question = String(body.question || 'Describe this image in detail. If there is text, transcribe it. Be specific and factual.').slice(0, 1000);
  const r = await callProvider(w, [{
    role: 'user',
    content: [
      { type: 'text', text: question },
      { type: 'image_url', image_url: { url: imageUrl } },
    ],
  }], { max_tokens: 800, timeoutMs: 60000 });
  await trackAIUsage(env, ws, 'analyze-image', r.provider, r.usage);
  return { content: r.content, provider: r.provider, model: r.model };
}

''',
'helpers block')

# ── 3. Memory wiring in handleChatStream (store only incoming user msgs) ──
rep("""  let messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const sysParts = [];
  if (body.context_data) sysParts.push(`Current app state: ${String(body.context_data).slice(0, 500)}`);
  try { sysParts.push(await workspaceContextSummary(env, ws)); } catch { }
  if (w.ai_system_prompt) sysParts.unshift(w.ai_system_prompt);
  if (sysParts.length) messages = [{ role: 'system', content: sysParts.join('\\n') }, ...messages.filter(m => m.role !== 'system')];""",
"""  let messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  // Remember the user messages that arrived in THIS request (for persistence).
  const incomingUserMsgs = messages.filter(m => m.role === 'user').map(m => String(m.content || ''));
  const sysParts = [];
  if (body.context_data) sysParts.push(`Current app state: ${String(body.context_data).slice(0, 500)}`);
  try { sysParts.push(await workspaceContextSummary(env, ws)); } catch { }
  if (w.ai_system_prompt) sysParts.unshift(w.ai_system_prompt);
  if (sysParts.length) messages = [{ role: 'system', content: sysParts.join('\\n') }, ...messages.filter(m => m.role !== 'system')];
  // Persistent memory: merge in up to 8 past messages from previous sessions
  // (unless the client explicitly opts out with memory:false).
  if (body.memory !== false) {
    try {
      const past = await loadChatMemory(env, ws, 8);
      if (past.length) {
        const existing = new Set(messages.filter(m => m.role !== 'system').map(m => m.content));
        const extra = past.filter(m => !existing.has(m.content));
        messages = [...messages, ...extra];
      }
    } catch { /* memory is best-effort */ }
  }
  // Persist only THIS turn's user messages (not the merged memory).
  for (const c of incomingUserMsgs) {
    if (c.trim()) await appendChatMemory(env, ws, 'user', c).catch(() => {});
  }""",
'memory load in chat')

# ── 4. AI rate limit + new routes (already-safe anchors) ──
rep("""  // AI ops share a daily-cap check (chat/stream checks its own above)
  const capOk = await withinDailyCap(env, auth.workspaceId, (await getWorkspace(env, auth.workspaceId)).ai_daily_call_cap);
  if (!capOk && path.startsWith('/ai/')) return err('Daily AI call cap reached for this workspace — raise it in Settings → AI Providers if needed.', 429, origin);""",
"""  // AI ops share a daily-cap check (chat/stream checks its own above)
  const capOk = await withinDailyCap(env, auth.workspaceId, (await getWorkspace(env, auth.workspaceId)).ai_daily_call_cap);
  if (!capOk && path.startsWith('/ai/')) return err('Daily AI call cap reached for this workspace — raise it in Settings → AI Providers if needed.', 429, origin);

  // Light anti-abuse limit on AI endpoints (per user) — generous, just stops
  // runaway loops and scripts hammering the API.
  const aiRl = await rateLimit(env, `ai:${auth.userId}`, 240, 1);
  if (!aiRl.ok && path.startsWith('/ai/')) return err('Too many AI requests — slow down a moment and try again.', 429, origin);""",
'ai rate limit')

rep("""  if (path === '/ai/analyze-site' && req.method === 'POST') {
    try { return json(await aiAnalyzeSite(env, auth.workspaceId, body), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }""",
"""  if (path === '/ai/analyze-site' && req.method === 'POST') {
    try { return json(await aiAnalyzeSite(env, auth.workspaceId, body), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/pipeline-health' && req.method === 'GET') {
    try { return json(await aiPipelineHealth(env, auth.workspaceId), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/analyze-image' && req.method === 'POST') {
    try { return json(await aiAnalyzeImage(env, auth.workspaceId, body), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/memory' && req.method === 'DELETE') {
    await clearChatMemory(env, auth.workspaceId);
    return json({ ok: true }, 200, origin);
  }
  if (path === '/ai/memory' && req.method === 'GET') {
    return json({ memory: await loadChatMemory(env, auth.workspaceId, 30) }, 200, origin);
  }""",
'ai new routes')

open(P, 'w', encoding='utf-8').write(s)
print('Backend patch 5 (v2) written.')
