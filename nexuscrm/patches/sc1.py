#!/usr/bin/env python3
"""Super-cycle 1 (cycles 1-4): Agent core v2 — multi-step plans, natural dates,
task completion, deal updates, facts memory, find contact."""
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

# ── C1: Natural date parser (tomorrow / next friday / in 3 days / YYYY-MM-DD) ──
rep("""async function sha256hex(s) {""",
"""// Natural-language date → ISO date. Understands "tomorrow", "today", "next
// friday", "in 3 days", "monday", and YYYY-MM-DD. Returns null if unsure.
function parseNaturalDate(str) {
  const raw = String(str || '').trim().toLowerCase();
  if (!raw) return null;
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) return raw;
  const now = new Date();
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const iso = d => d.toISOString().slice(0, 10);
  if (raw === 'today') return iso(now);
  if (raw === 'tomorrow' || raw === 'tmr') return iso(new Date(now.getTime() + 86400000));
  if (raw === 'day after tomorrow') return iso(new Date(now.getTime() + 2 * 86400000));
  const inDays = raw.match(/^in\\s+(\\d+)\\s+days?$/);
  if (inDays) return iso(new Date(now.getTime() + parseInt(inDays[1]) * 86400000));
  const dayIdx = dayNames.findIndex(d => raw.includes(d));
  if (dayIdx >= 0) {
    let diff = (dayIdx - now.getDay() + 7) % 7;
    if (diff === 0) diff = 7; // "friday" = next friday, not today
    if (raw.includes('next') && diff < 7) diff += 7;
    return iso(new Date(now.getTime() + diff * 86400000));
  }
  return null;
}
async function sha256hex(s) {""",
'natural dates')

# ── C2: Facts memory (remember X) — add workspaces.agent_facts column usage ──
rep("""const AGENT_ACTIONS = ['create_task', 'create_contact', 'create_deal', 'create_appointment', 'update_deal_stage', 'update_contact', 'add_contact_note', 'send_email', 'forecast', 'weekly_review', 'none'];""",
"""const AGENT_ACTIONS = ['create_task', 'create_contact', 'create_deal', 'create_appointment', 'update_deal_stage', 'update_contact', 'add_contact_note', 'complete_task', 'update_deal', 'find_contact', 'remember', 'send_email', 'forecast', 'weekly_review', 'none'];""",
'agent actions v2')

rep("""Allowed actions:
- "create_task": params {title (required), description?, due_date? (YYYY-MM-DD), priority? (low|medium|high|urgent)}""",
"""The user may also ask for a SEQUENCE of things — if so, reply with {"steps":[{"action":"...","params":{...}},...],"reply":"..."} (up to 3 steps, actions from the same list). Prefer a sequence over calling the agent again.
Allowed actions:
- "create_task": params {title (required), description?, due_date? (natural date like "tomorrow" or "next friday" or YYYY-MM-DD), priority? (low|medium|high|urgent)}
- "complete_task": params {task_id OR task_title} — marks it done
- "update_deal": params {deal_id OR deal_title, value? (number), probability? (0-100), title?}
- "find_contact": params {name or email} — returns the contact's details
- "remember": params {fact (required)} — stores a fact about the user/business for future conversations
- "update_contact": params {contact_email OR contact_name (to find them), plus any of: email, phone, company, tags, notes, stage}
- "add_contact_note": params {contact_email OR contact_name, note (required)} — appends to the contact's notes""",
'agent system v2')

# ── C3: Executor — new actions + natural date in create_task/create_appointment ──
rep("""  if (action === 'create_task') {
    if (!str(p.title).trim()) return { ok: false, error: 'Task title is required.' };
    const t = await env.DB.prepare(
      `INSERT INTO tasks (workspace_id,title,description,priority,due_date,status) VALUES (?,?,?,?,?,'todo') RETURNING *`
    ).bind(ws, str(p.title, 200), str(p.description, 1000), isIn(p.priority, ['low', 'medium', 'high', 'urgent']) ? p.priority : 'medium', /^\\d{4}-\\d{2}-\\d{2}$/.test(p.due_date) ? p.due_date : '').first();
    return { ok: true, note: `Task "${t.title}" created` };
  }""",
"""  if (action === 'create_task') {
    if (!str(p.title).trim()) return { ok: false, error: 'Task title is required.' };
    const due = parseNaturalDate(p.due_date);
    const t = await env.DB.prepare(
      `INSERT INTO tasks (workspace_id,title,description,priority,due_date,status) VALUES (?,?,?,?,?,'todo') RETURNING *`
    ).bind(ws, str(p.title, 200), str(p.description, 1000), isIn(p.priority, ['low', 'medium', 'high', 'urgent']) ? p.priority : 'medium', due || '').first();
    return { ok: true, note: `Task "${t.title}" created${due ? ' (due ' + due + ')' : ''}` };
  }
  if (action === 'complete_task') {
    let task = null;
    if (p.task_id) task = await env.DB.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=?').bind(parseInt(p.task_id), ws).first();
    if (!task && p.task_title) task = await env.DB.prepare('SELECT * FROM tasks WHERE workspace_id=? AND LOWER(title)=LOWER(?) LIMIT 1').bind(ws, str(p.task_title, 200)).first();
    if (!task) return { ok: false, error: 'Task not found — check the title or id.' };
    await env.DB.prepare('UPDATE tasks SET status=? WHERE id=? AND workspace_id=?').bind('done', task.id, ws).run();
    return { ok: true, note: `Task "${task.title}" marked done ✅` };
  }
  if (action === 'update_deal') {
    let deal = null;
    if (p.deal_id) deal = await env.DB.prepare('SELECT * FROM deals WHERE id=? AND workspace_id=?').bind(parseInt(p.deal_id), ws).first();
    if (!deal && p.deal_title) deal = await env.DB.prepare('SELECT * FROM deals WHERE workspace_id=? AND LOWER(title)=LOWER(?) LIMIT 1').bind(ws, str(p.deal_title, 200)).first();
    if (!deal) return { ok: false, error: 'Deal not found — check the title or id.' };
    const updates = [];
    const vals = [];
    if (p.value !== undefined) { updates.push('value=?'); vals.push(Math.max(0, Number(p.value) || 0)); }
    if (p.probability !== undefined) { updates.push('probability=?'); vals.push(Math.max(0, Math.min(100, parseInt(p.probability) || 0))); }
    if (p.title !== undefined) { updates.push('title=?'); vals.push(str(p.title, 200)); }
    if (!updates.length) return { ok: false, error: 'Nothing to update — provide value, probability or title.' };
    vals.push(deal.id, ws);
    await env.DB.prepare(`UPDATE deals SET ${updates.join(',')} WHERE id=? AND workspace_id=?`).bind(...vals).run();
    return { ok: true, note: `Deal "${deal.title}" updated (${updates.join(', ')})` };
  }
  if (action === 'find_contact') {
    const q = str(p.name || p.email || '', 200);
    let contact = null;
    if (p.email) contact = await env.DB.prepare('SELECT * FROM contacts WHERE workspace_id=? AND LOWER(email)=LOWER(?)').bind(ws, str(p.email, 254).toLowerCase()).first();
    if (!contact && q) contact = await env.DB.prepare('SELECT * FROM contacts WHERE workspace_id=? AND LOWER(name) LIKE ? LIMIT 1').bind(ws, '%' + q.toLowerCase() + '%').first();
    if (!contact) return { ok: false, error: 'No contact found for that name/email.' };
    return { ok: true, note: `${contact.name} — ${contact.email || 'no email'}, ${contact.phone || 'no phone'}, ${contact.company || 'no company'}, stage ${contact.stage}, tags: ${contact.tags || 'none'}` };
  }
  if (action === 'remember') {
    const fact = str(p.fact, 1000);
    if (!fact) return { ok: false, error: 'Nothing to remember.' };
    const w0 = await getWorkspace(env, ws);
    let facts = [];
    try { facts = JSON.parse(w0.agent_facts || '[]'); } catch { }
    facts.push(fact);
    facts = facts.slice(-40);
    await env.DB.prepare('UPDATE workspaces SET agent_facts=? WHERE id=?').bind(JSON.stringify(facts), ws).run();
    invalidateWorkspaceCache(ws);
    return { ok: true, note: `Got it — I'll remember: ${fact}` };
  }""",
'agent executor v2')

# create_appointment natural date
rep("""  if (action === 'create_appointment') {
    if (!str(p.title).trim() || !/^\\d{4}-\\d{2}-\\d{2}$/.test(p.date || '')) return { ok: false, error: 'Appointment needs a title and a date (YYYY-MM-DD).' };""",
"""  if (action === 'create_appointment') {
    const apptDate = parseNaturalDate(p.date);
    if (!str(p.title).trim() || !apptDate) return { ok: false, error: 'Appointment needs a title and a date (e.g. tomorrow, next friday, or YYYY-MM-DD).' };""",
'appointment natural date')

rep("""    const a = await env.DB.prepare(
      `INSERT INTO appointments (workspace_id,title,date,time,status) VALUES (?,?,?,?,'scheduled') RETURNING *`
    ).bind(ws, str(p.title, 200), p.date, /^\\d{2}:\\d{2}$/.test(p.time || '') ? p.time : '09:00').first();
    await logEvent(env, ctx, ws, 'appointment_booked', null, { title: a.title, date: a.date, time: a.time });
    return { ok: true, note: `Appointment "${a.title}" booked for ${a.date} at ${a.time}` };""",
"""    const a = await env.DB.prepare(
      `INSERT INTO appointments (workspace_id,title,date,time,status) VALUES (?,?,?,?,'scheduled') RETURNING *`
    ).bind(ws, str(p.title, 200), apptDate, /^\\d{2}:\\d{2}$/.test(p.time || '') ? p.time : '09:00').first();
    await logEvent(env, ctx, ws, 'appointment_booked', null, { title: a.title, date: a.date, time: a.time });
    return { ok: true, note: `Appointment "${a.title}" booked for ${apptDate} at ${a.time}` };""",
'appointment date bind')

# ── C4: Multi-step sequence execution + facts injection in aiAgentHandler ──
rep("""  const action = parsed && isIn(parsed.action, AGENT_ACTIONS) ? parsed.action : 'none';
  const reply = String(parsed?.reply || r.content || '').slice(0, 1000);
  if (action === 'none' || !parsed) return json({ reply, action: 'none', ok: true }, 200, origin);
  const result = await executeAgentAction(env, ctx, ws, action, parsed.params, origin).catch(e => ({ ok: false, error: e.message }));
  const finalReply = result.ok ? (reply || result.note || 'Done!') : `${reply || 'I could not complete that.'} (${result.error})`;
  return json({ reply: finalReply, action, ok: result.ok, result }, 200, origin);""",
"""  // Multi-step sequences: {"steps":[{action,params},...]} runs up to 3 safe actions in order.
  if (parsed && Array.isArray(parsed.steps) && parsed.steps.length) {
    const steps = parsed.steps.slice(0, 3);
    const results = [];
    let okAll = true;
    for (const step of steps) {
      const act = isIn(step?.action, AGENT_ACTIONS) ? step.action : 'none';
      if (act === 'none') continue;
      const res = await executeAgentAction(env, ctx, ws, act, step.params || {}, origin).catch(e => ({ ok: false, error: e.message }));
      results.push({ action: act, ok: res.ok, note: res.note || res.error });
      if (!res.ok) { okAll = false; break; }
    }
    const summary = results.map(r => r.note || r.error).filter(Boolean).join(' · ');
    return json({ reply: String(parsed.reply || summary || 'Done!').slice(0, 1000), action: 'sequence', ok: okAll, results }, 200, origin);
  }
  const action = parsed && isIn(parsed.action, AGENT_ACTIONS) ? parsed.action : 'none';
  const reply = String(parsed?.reply || r.content || '').slice(0, 1000);
  if (action === 'none' || !parsed) return json({ reply, action: 'none', ok: true }, 200, origin);
  const result = await executeAgentAction(env, ctx, ws, action, parsed.params, origin).catch(e => ({ ok: false, error: e.message }));
  const finalReply = result.ok ? (reply || result.note || 'Done!') : `${reply || 'I could not complete that.'} (${result.error})`;
  return json({ reply: finalReply, action, ok: result.ok, result }, 200, origin);""",
'agent sequences')

# facts injected into agent system prompt
rep("""  const voice2 = String(w.ai_brand_voice || '').trim();
  const r = await callProvider(w, [
    { role: 'system', content: AGENT_SYSTEM + (ctxSummary ? '\\n\\nLIVE CRM DATA: ' + ctxSummary : '') + (voice2 ? '\\n\\nBrand voice for written outputs: ' + voice2 : '') },
    { role: 'user', content: message },
  ], { max_tokens: 700 });""",
"""  const voice2 = String(w.ai_brand_voice || '').trim();
  let factsLine = '';
  try { const f = JSON.parse(w.agent_facts || '[]'); if (f.length) factsLine = '\\n\\nFACTS THE USER TOLD YOU (remember them): ' + f.join(' | '); } catch { }
  const r = await callProvider(w, [
    { role: 'system', content: AGENT_SYSTEM + (ctxSummary ? '\\n\\nLIVE CRM DATA: ' + ctxSummary : '') + (voice2 ? '\\n\\nBrand voice for written outputs: ' + voice2 : '') + factsLine },
    { role: 'user', content: message },
  ], { max_tokens: 900 });""",
'agent facts injection')

open(P, 'w', encoding='utf-8').write(s)
print('Super-cycle 1 done.')
