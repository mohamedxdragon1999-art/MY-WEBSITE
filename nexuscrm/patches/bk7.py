#!/usr/bin/env python3
"""Backend patch 7: AI Agent (natural-language CRM actions) + Sales Forecast."""
import sys
P = 'backend/src/index.js'
s = open(P, encoding='utf-8').read()

def insertBefore(anchor, block, tag):
    global s
    n = s.count(anchor)
    if n != 1:
        print(f'❌ [{tag}] anchor count {n}'); sys.exit(1)
    s = s.replace(anchor, block + anchor)
    print(f'  ✅ [{tag}]')

def rep(old, new, tag):
    global s
    n = s.count(old)
    if n != 1:
        print(f'❌ [{tag}] found {n}'); print('OLD:', repr(old[:100])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

# ── 1. Agent + forecast engines (before MAIN ROUTER) ──
insertBefore("// ── MAIN ROUTER ───────────────────────────────────────────────",
r'''// ════════════════════════════════════════════════════════════
// AI AGENT — the chat can DO things in your CRM, not just talk.
// The model replies with a single JSON action from a SAFE whitelist;
// the worker executes it server-side, then answers with a confirmation.
// ════════════════════════════════════════════════════════════
const AGENT_ACTIONS = ['create_task', 'create_contact', 'create_deal', 'create_appointment', 'update_deal_stage', 'send_email', 'forecast', 'weekly_review', 'none'];
const AGENT_SYSTEM = `You are the AI assistant inside NexusCRM, a small-business CRM. The user may ask you to DO something in their CRM. You may perform EXACTLY ONE action. Reply ONLY with a JSON object (no markdown, no other text): {"action":"...","params":{...},"reply":"one short, friendly sentence confirming what you did or answering the question"}.
Allowed actions:
- "create_task": params {title (required), description?, due_date? (YYYY-MM-DD), priority? (low|medium|high|urgent)}
- "create_contact": params {name (required), email?, phone?, company?, tags? (comma separated)}
- "create_deal": params {title (required), value? (number), stage? (lead|prospect|qualified|proposal|negotiation|won|lost)}
- "create_appointment": params {title (required), date (YYYY-MM-DD), time? (HH:MM)}
- "update_deal_stage": params {deal_id? (number) OR deal_title? (string), stage (required)}
- "send_email": params {contact_email (required), subject, body}
- "forecast": params {} — returns the 30/60/90 day sales forecast
- "weekly_review": params {} — returns a structured weekly business review
- "none": params {} — for questions or when no action is needed; put your answer in "reply"
Rules: never invent data the user did not imply; never delete anything; keep "reply" under 40 words; if the request is ambiguous, ask a clarifying question via "none".`;

async function executeAgentAction(env, ctx, ws, action, params, origin) {
  const p = params || {};
  const str = (v, n) => String(v == null ? '' : v).slice(0, n || 300);
  if (action === 'create_task') {
    if (!str(p.title).trim()) return { ok: false, error: 'Task title is required.' };
    const t = await env.DB.prepare(
      `INSERT INTO tasks (workspace_id,title,description,priority,due_date,status) VALUES (?,?,?,?,'todo') RETURNING *`
    ).bind(ws, str(p.title, 200), str(p.description, 1000), isIn(p.priority, ['low', 'medium', 'high', 'urgent']) ? p.priority : 'medium', /^\d{4}-\d{2}-\d{2}$/.test(p.due_date) ? p.due_date : '').first();
    return { ok: true, note: `Task "${t.title}" created` };
  }
  if (action === 'create_contact') {
    if (!str(p.name).trim()) return { ok: false, error: 'Contact name is required.' };
    const c = await env.DB.prepare(
      `INSERT INTO contacts (workspace_id,name,email,phone,company,tags,source) VALUES (?,?,?,?,?,?,'ai-agent') RETURNING *`
    ).bind(ws, str(p.name, 120), str(p.email, 254), str(p.phone, 40), str(p.company, 120), str(p.tags, 300)).first();
    await logEvent(env, ctx, ws, 'new_contact', c.id, { name: c.name, stage: c.stage });
    return { ok: true, note: `Contact "${c.name}" added` };
  }
  if (action === 'create_deal') {
    if (!str(p.title).trim()) return { ok: false, error: 'Deal title is required.' };
    const d = await env.DB.prepare(
      `INSERT INTO deals (workspace_id,title,value,stage,probability) VALUES (?,?,?,?,20) RETURNING *`
    ).bind(ws, str(p.title, 200), Math.max(0, Number(p.value) || 0), isIn(p.stage, CONTACT_STAGES) ? p.stage : 'lead').first();
    return { ok: true, note: `Deal "${d.title}" ($${Number(d.value || 0).toLocaleString()}) created` };
  }
  if (action === 'create_appointment') {
    if (!str(p.title).trim() || !/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) return { ok: false, error: 'Appointment needs a title and a date (YYYY-MM-DD).' };
    const a = await env.DB.prepare(
      `INSERT INTO appointments (workspace_id,title,date,time,status) VALUES (?,?,?,?,'scheduled') RETURNING *`
    ).bind(ws, str(p.title, 200), p.date, /^\d{2}:\d{2}$/.test(p.time || '') ? p.time : '09:00').first();
    await logEvent(env, ctx, ws, 'appointment_booked', null, { title: a.title, date: a.date, time: a.time });
    return { ok: true, note: `Appointment "${a.title}" booked for ${a.date} at ${a.time}` };
  }
  if (action === 'update_deal_stage') {
    const stage = isIn(p.stage, CONTACT_STAGES) ? p.stage : null;
    if (!stage) return { ok: false, error: 'Invalid deal stage.' };
    let deal = null;
    if (p.deal_id) deal = await env.DB.prepare('SELECT * FROM deals WHERE id=? AND workspace_id=?').bind(parseInt(p.deal_id), ws).first();
    if (!deal && p.deal_title) deal = await env.DB.prepare('SELECT * FROM deals WHERE workspace_id=? AND LOWER(title)=LOWER(?) LIMIT 1').bind(ws, str(p.deal_title, 200)).first();
    if (!deal) return { ok: false, error: 'Deal not found — check the title or id.' };
    const from = deal.stage;
    await env.DB.prepare('UPDATE deals SET stage=? WHERE id=? AND workspace_id=?').bind(stage, deal.id, ws).run();
    if (stage !== from) await logEvent(env, ctx, ws, 'deal_stage_change', deal.contact_id, { deal_id: deal.id, title: deal.title, from, to: stage });
    return { ok: true, note: `Deal "${deal.title}" moved to ${stage}` };
  }
  if (action === 'send_email') {
    const email = str(p.contact_email, 254).toLowerCase().trim();
    if (!isValidEmail(email)) return { ok: false, error: 'A valid contact email is required.' };
    let contact = await env.DB.prepare('SELECT * FROM contacts WHERE workspace_id=? AND LOWER(email)=LOWER(?)').bind(ws, email).first();
    if (!contact) {
      contact = await env.DB.prepare('INSERT INTO contacts (workspace_id,name,email,source) VALUES (?,?,?,\'ai-agent\') RETURNING *')
        .bind(ws, email.split('@')[0], email).first();
    }
    const subject = str(p.subject, 200) || 'No subject';
    const body = str(p.body, 4000);
    const w = await getWorkspace(env, ws);
    let sent = false;
    if (w.resend_api_key && w.resend_from_email) {
      try {
        await sendEmailViaResend(w, { to: email, subject, body });
        sent = true;
      } catch { /* fall through to saving as a draft message */ }
    }
    await env.DB.prepare("INSERT INTO messages (workspace_id,contact_id,channel,subject,body,direction,ai_generated) VALUES (?,?,?,'email',?,?,'outbound',1)")
      .bind(ws, contact.id, subject, body).run();
    return { ok: true, note: sent ? `Email sent to ${email}` : `Email drafted for ${email} (connect Resend in Settings to auto-send)` };
  }
  if (action === 'forecast') {
    const f = await computeForecast(env, ws);
    return { ok: true, note: `30-day: ${fmtMoney(f.buckets[0].value)}, 60-day: ${fmtMoney(f.buckets[1].value)}, 90-day: ${fmtMoney(f.buckets[2].value)}. ${f.narrative}` };
  }
  if (action === 'weekly_review') {
    const w = await getWorkspace(env, ws);
    const stats = await computeStats(env, ws);
    const usage = await aiUsage(env, ws);
    try {
      const r = await callProvider(w, [{ role: 'user', content: `Write a structured weekly business review (under 220 words) from: ${JSON.stringify({ ...stats, ai_usage: usage })}. Sections: Wins, Gaps, Top 3 focus items for next week, one bold growth idea. Be specific.` }], { max_tokens: 600 });
      await trackAIUsage(env, ws, 'weekly-review', r.provider, r.usage);
      return { ok: true, note: r.content };
    } catch { return { ok: false, error: 'Could not generate the review right now.' }; }
  }
  return { ok: false, error: 'Unknown action.' };
}

// ════════════════════════════════════════════════════════════
// SALES FORECAST — 30/60/90-day expected revenue from the pipeline
// (value × probability weighting; date-aware when close dates exist).
// ════════════════════════════════════════════════════════════
const FORECAST_CACHE = new Map();
const FORECAST_TTL_MS = 5 * 60 * 1000;
function fmtMoney(n) { return '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
async function computeForecast(env, ws) {
  const cached = FORECAST_CACHE.get(ws);
  if (cached && (Date.now() - cached.ts) < FORECAST_TTL_MS) return cached.data;
  const { results: deals } = await env.DB.prepare(
    `SELECT value, probability, close_date FROM deals WHERE workspace_id=? AND stage NOT IN ('won','lost')`
  ).bind(ws).all();
  const buckets = [
    { label: 'Next 30 days', days: 30, value: 0, count: 0 },
    { label: '31-60 days', days: 60, value: 0, count: 0 },
    { label: '61-90 days', days: 90, value: 0, count: 0 },
  ];
  const now = new Date();
  for (const d of deals) {
    const value = Number(d.value || 0);
    const prob = Math.max(0, Math.min(1, (Number(d.probability) || 0) / 100));
    const weighted = value * prob;
    let bucket = 2;
    if (d.close_date && /^\d{4}-\d{2}-\d{2}$/.test(d.close_date)) {
      const days = Math.floor((new Date(d.close_date + 'T00:00:00Z') - now) / 86400000);
      if (days <= 30) bucket = 0; else if (days <= 60) bucket = 1; else if (days <= 90) bucket = 2; else continue;
    } else {
      // no close date → estimate by probability
      if (prob >= 0.8) bucket = 0; else if (prob >= 0.5) bucket = 1; else bucket = 2;
    }
    buckets[bucket].value += weighted;
    buckets[bucket].count += 1;
  }
  const total = buckets.reduce((a, b) => a + b.value, 0);
  // AI narrative (best-effort, cached)
  let narrative = '';
  const w = await getWorkspace(env, ws);
  if (providerPriority(w).length) {
    try {
      const r = await callProvider(w, [{
        role: 'user',
        content: `Here is a sales forecast: 30 days ${fmtMoney(buckets[0].value)} (${buckets[0].count} deals), 31-60 ${fmtMoney(buckets[1].value)} (${buckets[1].count}), 61-90 ${fmtMoney(buckets[2].value)} (${buckets[2].count}), total ${fmtMoney(total)}. Write exactly 2 punchy sentences: what it means and the single best action to improve it. No fluff.`,
      }], { max_tokens: 120 });
      narrative = r.content.trim();
      await trackAIUsage(env, ws, 'forecast', r.provider, r.usage);
    } catch { /* narrative optional */ }
  }
  const data = { buckets, total_weighted: Math.round(total), narrative };
  FORECAST_CACHE.set(ws, { data, ts: Date.now() });
  return data;
}
async function aiAgentHandler(env, ctx, ws, body, origin) {
  const message = String(body.message || '').slice(0, 2000).trim();
  if (!message) return err('Message is required', 400, origin);
  const w = await getWorkspace(env, ws);
  if (!(await withinDailyCap(env, ws, w.ai_daily_call_cap))) return err('Daily AI call cap reached — raise it in Settings → AI Providers if needed.', 429, origin);
  const ctxSummary = await workspaceContextSummary(env, ws).catch(() => '');
  const r = await callProvider(w, [
    { role: 'system', content: AGENT_SYSTEM + (ctxSummary ? '\n\nLIVE CRM DATA: ' + ctxSummary : '') },
    { role: 'user', content: message },
  ], { max_tokens: 700 });
  await trackAIUsage(env, ws, 'agent', r.provider, r.usage);
  let parsed = null;
  try { parsed = JSON.parse((r.content || '').match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch { }
  const action = parsed && isIn(parsed.action, AGENT_ACTIONS) ? parsed.action : 'none';
  const reply = String(parsed?.reply || r.content || '').slice(0, 1000);
  if (action === 'none' || !parsed) return json({ reply, action: 'none', ok: true }, 200, origin);
  const result = await executeAgentAction(env, ctx, ws, action, parsed.params, origin).catch(e => ({ ok: false, error: e.message }));
  const finalReply = result.ok ? (reply || result.note || 'Done!') : `${reply || 'I could not complete that.'} (${result.error})`;
  return json({ reply: finalReply, action, ok: result.ok, result }, 200, origin);
}

''',
'agent + forecast')

# ── 2. Routes ──
rep("""  if (path === '/ai/memory' && req.method === 'GET') {
    return json({ memory: await loadChatMemory(env, auth.workspaceId, 30) }, 200, origin);
  }""",
"""  if (path === '/ai/memory' && req.method === 'GET') {
    return json({ memory: await loadChatMemory(env, auth.workspaceId, 30) }, 200, origin);
  }
  if (path === '/ai/agent' && req.method === 'POST') {
    return aiAgentHandler(env, ctx, auth.workspaceId, body, origin);
  }
  if (path === '/ai/forecast' && req.method === 'GET') {
    return json(await computeForecast(env, auth.workspaceId), 200, origin);
  }""",
'ai agent/forecast routes')

open(P, 'w', encoding='utf-8').write(s)
print('Backend patch 7 done.')
