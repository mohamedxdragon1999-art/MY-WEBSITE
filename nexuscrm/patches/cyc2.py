#!/usr/bin/env python3
"""Cycle 2: memory summarization, agent update_contact/add_contact_note, agent idempotency, webchat visitor memory."""
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

# ── 1. Memory summarization: when >30 messages, summarize the oldest into a summary string ──
rep("""async function appendChatMemory(env, ws, role, content) {
  if (!content || !String(content).trim()) return;
  await env.DB.prepare('INSERT INTO chat_memory (workspace_id, role, content) VALUES (?,?,?)')
    .bind(ws, role === 'assistant' ? 'assistant' : 'user', String(content).slice(0, 4000)).run();
  await env.DB.prepare(
    `DELETE FROM chat_memory WHERE id NOT IN (SELECT id FROM chat_memory WHERE workspace_id=? ORDER BY id DESC LIMIT 30)`
  ).bind(ws).run();
}""",
"""const MEMORY_SUMMARY_INFLIGHT = new Map(); // ws -> true (avoid parallel summarizes)
async function maybeSummarizeMemory(env, ws) {
  // If memory is filling up, condense the OLDEST messages into a running
  // summary (one AI call, once per burst) so long-term context survives
  // without unbounded storage.
  if (MEMORY_SUMMARY_INFLIGHT.get(ws)) return;
  const { results: all } = await env.DB.prepare(
    'SELECT id, role, content FROM chat_memory WHERE workspace_id=? ORDER BY id ASC'
  ).bind(ws).all();
  if (all.length <= 40) return;
  const w = await getWorkspace(env, ws);
  if (!providerPriority(w).length) return;
  const oldOnes = all.slice(0, all.length - 20);
  const summaryText = oldOnes.map(m => `${m.role}: ${String(m.content).slice(0, 200)}`).join('\\n').slice(0, 6000);
  MEMORY_SUMMARY_INFLIGHT.set(ws, true);
  try {
    const r = await callProvider(w, [{
      role: 'user',
      content: `Summarize this business chat history into a compact "memory" of the facts that still matter (names, decisions, promises, preferences, deadlines). Max 120 words, bullet points, present tense:\\n\\n${summaryText}`,
    }], { max_tokens: 250 });
    await trackAIUsage(env, ws, 'memory-summary', r.provider, r.usage);
    const oldSummary = await env.DB.prepare('SELECT ai_memory_summary FROM workspaces WHERE id=?').bind(ws).first();
    const merged = [oldSummary?.ai_memory_summary, r.content.trim()].filter(Boolean).join('\\n').slice(0, 2000);
    await env.DB.prepare('UPDATE workspaces SET ai_memory_summary=? WHERE id=?').bind(merged, ws).run();
    invalidateWorkspaceCache(ws);
    // drop the summarized rows (keep the newest 20)
    const keepIds = all.slice(all.length - 20).map(m => m.id);
    if (keepIds.length) {
      await env.DB.prepare('DELETE FROM chat_memory WHERE workspace_id=? AND id NOT IN (' + keepIds.map(() => '?').join(',') + ')')
        .bind(ws, ...keepIds).run();
    }
  } catch { /* best-effort */ }
  MEMORY_SUMMARY_INFLIGHT.delete(ws);
}
async function appendChatMemory(env, ws, role, content) {
  if (!content || !String(content).trim()) return;
  await env.DB.prepare('INSERT INTO chat_memory (workspace_id, role, content) VALUES (?,?,?)')
    .bind(ws, role === 'assistant' ? 'assistant' : 'user', String(content).slice(0, 4000)).run();
  await env.DB.prepare(
    `DELETE FROM chat_memory WHERE id NOT IN (SELECT id FROM chat_memory WHERE workspace_id=? ORDER BY id DESC LIMIT 30)`
  ).bind(ws).run();
  await maybeSummarizeMemory(env, ws);
}""",
'memory summarization')

# loadChatMemory: prepend the running summary as a system-style note
rep("""async function loadChatMemory(env, ws, limit) {
  const { results } = await env.DB.prepare(
    'SELECT role, content FROM chat_memory WHERE workspace_id=? ORDER BY id DESC LIMIT ?'
  ).bind(ws, Math.min(limit || 10, 30)).all();
  return results.reverse();
}""",
"""async function loadChatMemory(env, ws, limit) {
  const { results } = await env.DB.prepare(
    'SELECT role, content FROM chat_memory WHERE workspace_id=? ORDER BY id DESC LIMIT ?'
  ).bind(ws, Math.min(limit || 10, 30)).all();
  const msgs = results.reverse();
  // Prepend the long-term summary (if any) so old context stays available.
  const w = await getWorkspace(env, ws).catch(() => null);
  if (w?.ai_memory_summary) {
    msgs.unshift({ role: 'system', content: 'Long-term memory summary (older conversations):\\n' + String(w.ai_memory_summary).slice(0, 1500) });
  }
  return msgs;
}""",
'memory summary load')

# ── 2. Agent: more actions + idempotency ──
rep("const AGENT_ACTIONS = ['create_task', 'create_contact', 'create_deal', 'create_appointment', 'update_deal_stage', 'send_email', 'forecast', 'weekly_review', 'none'];",
"const AGENT_ACTIONS = ['create_task', 'create_contact', 'create_deal', 'create_appointment', 'update_deal_stage', 'update_contact', 'add_contact_note', 'send_email', 'forecast', 'weekly_review', 'none'];",
'agent actions')

rep("""- "send_email": params {contact_email (required), subject, body}""",
"""- "send_email": params {contact_email (required), subject, body}
- "update_contact": params {contact_email OR contact_name (to find them), plus any of: email, phone, company, tags, notes, stage}
- "add_contact_note": params {contact_email OR contact_name, note (required)} — appends to the contact's notes""",
'agent system prompt')

# add executor cases before the send_email case
rep("""  if (action === 'send_email') {
    const email = str(p.contact_email, 254).toLowerCase().trim();""",
"""  if (action === 'update_contact' || action === 'add_contact_note') {
    let contact = null;
    if (p.contact_email) contact = await env.DB.prepare('SELECT * FROM contacts WHERE workspace_id=? AND LOWER(email)=LOWER(?)').bind(ws, str(p.contact_email, 254).toLowerCase()).first();
    if (!contact && p.contact_name) contact = await env.DB.prepare('SELECT * FROM contacts WHERE workspace_id=? AND LOWER(name)=LOWER(?)').bind(ws, str(p.contact_name, 200)).first();
    if (!contact) return { ok: false, error: 'Contact not found — check the email or name.' };
    if (action === 'add_contact_note') {
      const note = str(p.note, 1000);
      if (!note) return { ok: false, error: 'Note text is required.' };
      const merged = [contact.notes, note].filter(Boolean).join('\\n').slice(0, 4000);
      await env.DB.prepare('UPDATE contacts SET notes=?, updated_at=? WHERE id=? AND workspace_id=?')
        .bind(merged, nowISO(), contact.id, ws).run();
      return { ok: true, note: `Note added to ${contact.name}` };
    }
    const updates = [];
    const vals = [];
    if (p.email !== undefined) { updates.push('email=?'); vals.push(str(p.email, 254).toLowerCase()); }
    if (p.phone !== undefined) { updates.push('phone=?'); vals.push(str(p.phone, 40)); }
    if (p.company !== undefined) { updates.push('company=?'); vals.push(str(p.company, 120)); }
    if (p.tags !== undefined) { updates.push('tags=?'); vals.push(str(p.tags, 300)); }
    if (p.notes !== undefined) { updates.push('notes=?'); vals.push(str(p.notes, 4000)); }
    if (p.stage !== undefined && isIn(p.stage, CONTACT_STAGES)) { updates.push('stage=?'); vals.push(p.stage); }
    if (!updates.length) return { ok: false, error: 'Nothing to update — provide email, phone, company, tags, notes or stage.' };
    vals.push(nowISO(), contact.id, ws);
    await env.DB.prepare(`UPDATE contacts SET ${updates.join(',')}, updated_at=? WHERE id=? AND workspace_id=?`)
      .bind(...vals).run();
    return { ok: true, note: `${contact.name} updated (${updates.join(', ')})` };
  }
  if (action === 'send_email') {
    const email = str(p.contact_email, 254).toLowerCase().trim();""",
'agent contact actions')

# idempotency: block identical agent requests within 60s
rep("""  const ctxSummary = await workspaceContextSummary(env, ws).catch(() => '');
  const r = await callProvider(w, [""",
"""  // Idempotency: the same command twice within 60s = a double-click, not a redo.
  const dedupeKey = `agent:${ws}:${await sha256hex(message)}`;
  const dup = await env.DB.prepare('SELECT count FROM rate_limits WHERE key=?').bind(dedupeKey).first();
  if (dup) return json({ reply: 'Already done that just now — check the result above. ✅', action: 'none', ok: true, duplicate: true }, 200, origin);
  await env.DB.prepare('INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=count+1')
    .bind(dedupeKey, nowISO()).run();
  const ctxSummary = await workspaceContextSummary(env, ws).catch(() => '');
  const r = await callProvider(w, [""",
'agent idempotency')

# sha256hex helper near crypto
rep("""function randomSlug(n = 10) {""",
"""async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
function randomSlug(n = 10) {""",
'sha256hex')

# ── 3. Webchat visitor memory: visitor_id in the widget → per-visitor continuity ──
rep("""  // Build the AI reply (uses the workspace's own AI settings + CRM context)
  const history = Array.isArray(body.history)
    ? body.history.slice(-8).map(m => ({ role: m.role, content: String(m.content || '').slice(0, 1000) }))
    : [];""",
"""  // Build the AI reply (uses the workspace's own AI settings + CRM context)
  let history = Array.isArray(body.history)
    ? body.history.slice(-8).map(m => ({ role: m.role, content: String(m.content || '').slice(0, 1000) }))
    : [];
  // Per-visitor memory: a returning visitor (same visitor_id cookie) gets
  // their previous messages merged in so the conversation feels continuous.
  const visitorId = String(body.visitor_id || '').slice(0, 64);
  if (visitorId && /^[a-zA-Z0-9-]{6,64}$/.test(visitorId)) {
    try {
      const { results: prev } = await env.DB.prepare(
        `SELECT body FROM messages WHERE workspace_id=? AND channel='webchat' AND contact_id IS NULL
         AND (subject LIKE ? OR subject='') AND body != ? ORDER BY id DESC LIMIT 10`
      ).bind(w.id, `__v_${visitorId}%`, message).all();
      if (prev.length) {
        const existing = new Set(history.map(m => m.content));
        for (const p of prev.reverse()) {
          if (!existing.has(p.body)) history.push({ role: p.body.startsWith('AI:') ? 'assistant' : 'user', content: p.body.replace(/^AI: /, '') });
        }
      }
    } catch { /* best-effort */ }
  }""",
'webchat visitor memory')

# store visitor messages with a marker so we can find them again
rep("""  await env.DB.prepare("INSERT INTO messages (workspace_id,channel,subject,body,direction) VALUES (?,?,'',?,'inbound')")
    .bind(w.id, 'webchat', message).run();""",
"""  const visitorSubject = visitorId ? `__v_${visitorId}` : '';
  await env.DB.prepare("INSERT INTO messages (workspace_id,channel,subject,body,direction) VALUES (?,?,?,?,'inbound')")
    .bind(w.id, 'webchat', visitorSubject, message).run();""",
'visitor marker')

open(P, 'w', encoding='utf-8').write(s)
print('Cycle 2 backend done.')
