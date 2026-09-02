#!/usr/bin/env python3
"""Super-cycle 2 (cycles 5-9): AI on data — contact summary, smart replies, tag suggest, task score, deal risk, translate, tone remix, doc analyze."""
import sys
P = 'backend/src/index.js'
s = open(P, encoding='utf-8').read()

def rep(old, new, tag, count=1):
    global s
    n = s.count(old)
    if n != count:
        print(f'❌ [{tag}] found {n}'); print('OLD:', repr(old[:110])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

# ── C5: Contact summary ──
rep("""// ── AI AGENT — the chat can DO things in your CRM, not just talk.""",
"""// ════════════════════════════════════════════════════════════
// AI ON DATA — summaries, replies, tags, scores, risks (Super-cycle 2)
// ════════════════════════════════════════════════════════════
async function aiContactSummary(env, ws, contactId) {
  const c = await env.DB.prepare('SELECT * FROM contacts WHERE id=? AND workspace_id=?').bind(contactId, ws).first();
  if (!c) throw new Error('Contact not found');
  const [msgs, deals, tasks, appts] = await Promise.all([
    env.DB.prepare('SELECT channel, subject, body, direction, created_at FROM messages WHERE contact_id=? AND workspace_id=? ORDER BY created_at DESC LIMIT 6').bind(contactId, ws).all(),
    env.DB.prepare('SELECT title, value, stage, probability FROM deals WHERE contact_id=? AND workspace_id=?').bind(contactId, ws).all(),
    env.DB.prepare("SELECT title, status, due_date FROM tasks WHERE contact_id=? AND workspace_id=? ORDER BY id DESC LIMIT 5").bind(contactId, ws).all(),
    env.DB.prepare('SELECT title, date, time, status FROM appointments WHERE contact_id=? AND workspace_id=? ORDER BY id DESC LIMIT 4').bind(contactId, ws).all(),
  ]);
  const w = await getWorkspace(env, ws);
  const data = {
    name: c.name, company: c.company, stage: c.stage, tags: c.tags, notes: c.notes, ai_score: c.ai_score,
    messages: msgs.results.map(m => `[${m.direction}] ${m.body}`.slice(0, 200)),
    deals: deals.results.map(d => `${d.title} (${d.stage}, $${d.value || 0}, ${d.probability || 0}%)`),
    tasks: tasks.results.map(t => `${t.title} [${t.status}]`),
    appointments: appts.results.map(a => `${a.title} ${a.date} ${a.time}`),
  };
  const r = await callProvider(w, [{
    role: 'user',
    content: `Write a compact "relationship summary" for this contact (max 120 words): who they are, where they stand, what's next. Use only this data: ${JSON.stringify(data)}`,
  }], { max_tokens: 300 });
  await trackAIUsage(env, ws, 'contact-summary', r.provider, r.usage);
  return { summary: r.content };
}
async function aiSmartReply(env, ws, text) {
  const w = await getWorkspace(env, ws);
  const r = await callProvider(w, [{
    role: 'user',
    content: `Here is an incoming message: "${String(text || '').slice(0, 2000)}". Write exactly 3 short reply options (max 40 words each), numbered 1-3: 1) professional, 2) friendly/short, 3) if the message is positive make it enthusiastic / if negative make it empathetic & solution-oriented. Plain text, no preamble.`,
  }], { max_tokens: 300 });
  await trackAIUsage(env, ws, 'smart-reply', r.provider, r.usage);
  const options = r.content.split(/^\\s*\\d[.)]\\s*/m).map(x => x.trim()).filter(Boolean).slice(0, 3);
  return { options: options.length >= 2 ? options : [r.content.trim()] };
}
async function aiSuggestTags(env, ws, contactId) {
  const c = await env.DB.prepare('SELECT * FROM contacts WHERE id=? AND workspace_id=?').bind(contactId, ws).first();
  if (!c) throw new Error('Contact not found');
  const w = await getWorkspace(env, ws);
  const r = await callProvider(w, [{
    role: 'user',
    content: `Suggest 3-5 short tags (single words or hyphenated, lowercase) for this contact based on: name=${c.name}, company=${c.company || 'unknown'}, stage=${c.stage}, notes="${String(c.notes || '').slice(0, 400)}". Reply ONLY as a comma-separated list.`,
  }], { max_tokens: 60 });
  await trackAIUsage(env, ws, 'tag-suggest', r.provider, r.usage);
  const tags = r.content.split(',').map(t => t.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(Boolean).slice(0, 5);
  return { tags };
}
async function aiScoreTasks(env, ws) {
  const { results: tasks } = await env.DB.prepare(
    "SELECT id,title,description,priority,due_date,created_at FROM tasks WHERE workspace_id=? AND status='todo' ORDER BY (due_date='') , due_date LIMIT 30"
  ).bind(ws).all();
  if (!tasks.length) return { tasks: [] };
  const w = await getWorkspace(env, ws);
  const r = await callProvider(w, [{
    role: 'user',
    content: `Rank these tasks by urgency/importance (1 = do first). Reply ONLY as JSON array of {id:number,score:0-100,reason:"under 10 words"}: ${JSON.stringify(tasks.map(t => ({ id: t.id, title: t.title, priority: t.priority, due: t.due_date || 'none' })))}`,
  }], { max_tokens: 600, json_mode: false });
  await trackAIUsage(env, ws, 'task-score', r.provider, r.usage);
  let ranked = [];
  try { ranked = JSON.parse(r.content.match(/\\[[\\s\\S]*\\]/)?.[0] || '[]'); } catch { }
  return { tasks: Array.isArray(ranked) ? ranked.slice(0, 30) : [] };
}
async function aiDealRisks(env, ws) {
  const cutoff14 = new Date(Date.now() - 14 * 86400000).toISOString();
  const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const { results: stale } = await env.DB.prepare(
    `SELECT id,title,value,stage,probability,created_at FROM deals WHERE workspace_id=? AND stage NOT IN ('won','lost') AND created_at < ? ORDER BY created_at ASC`
  ).bind(ws, cutoff14).all();
  const risks = stale.slice(0, 8).map(d => ({
    id: d.id, title: d.title, value: d.value, stage: d.stage,
    age_days: Math.floor((Date.now() - new Date(d.created_at).getTime()) / 86400000),
    risk: 'stale',
    note: 'No movement in 14+ days — follow up or update the deal.',
  }));
  const { results: lowProb } = await env.DB.prepare(
    `SELECT id,title,value,stage,probability FROM deals WHERE workspace_id=? AND stage NOT IN ('won','lost') AND probability < 15 AND created_at < ? LIMIT 5`
  ).bind(ws, cutoff30).all();
  lowProb.forEach(d => risks.push({ id: d.id, title: d.title, value: d.value, stage: d.stage, age_days: null, risk: 'low_probability', note: 'Below 15% probability for over a month — reconsider or disqualify.' }));
  return { risks: risks.slice(0, 10) };
}

""",
'AI-on-data engines')

# ── C6-9 routes ──
rep("""  if (path === '/ai/suggest-workflows' && req.method === 'GET') {""",
"""  if (root === 'ai' && parts[1] === 'contact-summary' && parts[2] && req.method === 'GET') {
    try { return json(await aiContactSummary(env, auth.workspaceId, parseInt(parts[2])), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }
  if (root === 'ai' && parts[1] === 'tag-suggest' && parts[2] && req.method === 'GET') {
    try { return json(await aiSuggestTags(env, auth.workspaceId, parseInt(parts[2])), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/smart-reply' && req.method === 'POST') {
    try { return json(await aiSmartReply(env, auth.workspaceId, body.text), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/score-tasks' && req.method === 'GET') {
    try { return json(await aiScoreTasks(env, auth.workspaceId), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/deal-risks' && req.method === 'GET') {
    return json(await aiDealRisks(env, auth.workspaceId), 200, origin);
  }
  if (path === '/ai/translate' && req.method === 'POST') {
    try {
      const w = await getWorkspace(env, auth.workspaceId);
      if (!(await withinDailyCap(env, auth.workspaceId, w.ai_daily_call_cap))) return err('Daily AI call cap reached.', 429, origin);
      const lang = String(body.language || 'English').slice(0, 40);
      const r = await callProvider(w, [{ role: 'user', content: `Translate to ${lang}. Return ONLY the translated text: "${String(body.text || '').slice(0, 4000)}"` }], { max_tokens: 1000 });
      await trackAIUsage(env, auth.workspaceId, 'translate', r.provider, r.usage);
      return json({ content: r.content }, 200, origin);
    } catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/tone-remix' && req.method === 'POST') {
    try {
      const w = await getWorkspace(env, auth.workspaceId);
      if (!(await withinDailyCap(env, auth.workspaceId, w.ai_daily_call_cap))) return err('Daily AI call cap reached.', 429, origin);
      const tone = String(body.tone || 'professional').slice(0, 30);
      const r = await callProvider(w, [{ role: 'user', content: `Rewrite this in a ${tone} tone. Keep the meaning and length similar. Return only the rewrite:\n\n${String(body.text || '').slice(0, 4000)}` }], { max_tokens: 1500 });
      await trackAIUsage(env, auth.workspaceId, 'tone-remix', r.provider, r.usage);
      return json({ content: r.content }, 200, origin);
    } catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/doc-analyze' && req.method === 'POST') {
    try {
      const w = await getWorkspace(env, auth.workspaceId);
      if (!(await withinDailyCap(env, auth.workspaceId, w.ai_daily_call_cap))) return err('Daily AI call cap reached.', 429, origin);
      const r = await callProvider(w, [{ role: 'user', content: `Analyze this document. Give: 1) Key points (5 max), 2) Decisions made, 3) Action items with owner+deadline if mentioned, 4) Open questions. Be concise.\n\n${String(body.text || '').slice(0, 6000)}` }], { max_tokens: 800 });
      await trackAIUsage(env, auth.workspaceId, 'doc-analyze', r.provider, r.usage);
      return json({ content: r.content }, 200, origin);
    } catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/suggest-workflows' && req.method === 'GET') {""",
'AI-on-data routes')

open(P, 'w', encoding='utf-8').write(s)
print('Super-cycle 2 done.')
