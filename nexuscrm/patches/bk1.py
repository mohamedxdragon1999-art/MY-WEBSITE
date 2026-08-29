#!/usr/bin/env python3
"""Backend V4.1 patch 1: security headers, triggers/actions, public tokens, contacts tags/custom fields."""
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

# ── 1. Security headers on all responses ──
rep("""function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}""",
"""function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer-when-downgrade',
  };
}""",
tag='security headers')

# ── 2. New triggers & actions ──
rep("const WORKFLOW_TRIGGERS = ['new_contact', 'deal_stage_change', 'appointment_booked', 'invoice_paid', 'form_submitted', 'manual'];",
    "const WORKFLOW_TRIGGERS = ['new_contact', 'deal_stage_change', 'appointment_booked', 'invoice_paid', 'form_submitted', 'trigger_link', 'manual'];",
    tag='trigger_link trigger')
rep("const WORKFLOW_ACTIONS = ['send_email', 'send_whatsapp', 'create_task', 'update_stage'];",
    "const WORKFLOW_ACTIONS = ['send_email', 'send_whatsapp', 'send_review_request', 'create_task', 'update_stage'];",
    tag='send_review_request action')

# ── 3. public_token on workspace creation ──
rep("""    ws = await env.DB.prepare('INSERT INTO workspaces (name) VALUES (?) RETURNING id')
      .bind(`${name}'s Workspace`).first();""",
"""    ws = await env.DB.prepare('INSERT INTO workspaces (name, public_token) VALUES (?,?) RETURNING id')
      .bind(`${name}'s Workspace`, randomToken().slice(0, 24)).first();""",
tag='register public_token')
rep("""  const ws = await env.DB.prepare('INSERT INTO workspaces (name) VALUES (?) RETURNING id').bind('Demo Workspace').first();""",
"""  const ws = await env.DB.prepare('INSERT INTO workspaces (name, public_token) VALUES (?,?) RETURNING id').bind('Demo Workspace', randomToken().slice(0, 24)).first();""",
tag='demo public_token')

# ── 4. Contacts: tags + custom_fields + tag filter ──
rep("""      const search = (query.get('search') || '').toLowerCase();
      const stage = query.get('stage');
      if (search) { sql += ' AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(company) LIKE ?)'; args.push(`%${search}%`, `%${search}%`, `%${search}%`); }
      if (stage) { sql += ' AND stage = ?'; args.push(stage); }""",
"""      const search = (query.get('search') || '').toLowerCase();
      const stage = query.get('stage');
      const tag = query.get('tag');
      if (search) { sql += ' AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(company) LIKE ?)'; args.push(`%${search}%`, `%${search}%`, `%${search}%`); }
      if (stage) { sql += ' AND stage = ?'; args.push(stage); }
      if (tag) { sql += " AND (',' || tags || ',') LIKE ?"; args.push(`%,${tag},%`); }""",
tag='contacts tag filter')
rep("""      const c = await env.DB.prepare(
        `INSERT INTO contacts (workspace_id,name,email,phone,company,stage,source,notes)
         VALUES (?,?,?,?,?,?,?,?) RETURNING *`
      ).bind(ws, body.name, body.email || '', body.phone || '', body.company || '', isIn(body.stage, CONTACT_STAGES) ? body.stage : 'lead', body.source || 'manual', body.notes || '').first();""",
"""      const c = await env.DB.prepare(
        `INSERT INTO contacts (workspace_id,name,email,phone,company,stage,source,notes,tags,custom_fields)
         VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *`
      ).bind(ws, body.name, body.email || '', body.phone || '', body.company || '', isIn(body.stage, CONTACT_STAGES) ? body.stage : 'lead', body.source || 'manual', body.notes || '',
        String(body.tags || '').slice(0, 500), sanitizeCustomFields(body.custom_fields)).first();""",
tag='contacts POST tags')
rep("""    const fields = ['name', 'email', 'phone', 'company', 'stage', 'source', 'notes', 'ai_score', 'ai_score_reason'];
    const updates = { ...existing, ...pick(body, fields) };
    if (updates.stage && !isIn(updates.stage, CONTACT_STAGES)) updates.stage = existing.stage;
    updates.updated_at = nowISO();
    await env.DB.prepare(
      `UPDATE contacts SET name=?,email=?,phone=?,company=?,stage=?,source=?,notes=?,ai_score=?,ai_score_reason=?,updated_at=? WHERE id=? AND workspace_id=?`
    ).bind(updates.name, updates.email, updates.phone, updates.company, updates.stage, updates.source, updates.notes, updates.ai_score, updates.ai_score_reason, updates.updated_at, id, ws).run();""",
"""    const fields = ['name', 'email', 'phone', 'company', 'stage', 'source', 'notes', 'tags', 'custom_fields', 'ai_score', 'ai_score_reason'];
    const updates = { ...existing, ...pick(body, fields) };
    if (updates.stage && !isIn(updates.stage, CONTACT_STAGES)) updates.stage = existing.stage;
    updates.tags = String(updates.tags || '').slice(0, 500);
    updates.custom_fields = sanitizeCustomFields(updates.custom_fields);
    updates.updated_at = nowISO();
    await env.DB.prepare(
      `UPDATE contacts SET name=?,email=?,phone=?,company=?,stage=?,source=?,notes=?,tags=?,custom_fields=?,ai_score=?,ai_score_reason=?,updated_at=? WHERE id=? AND workspace_id=?`
    ).bind(updates.name, updates.email, updates.phone, updates.company, updates.stage, updates.source, updates.notes, updates.tags, updates.custom_fields, updates.ai_score, updates.ai_score_reason, updates.updated_at, id, ws).run();""",
tag='contacts PATCH tags')

# ── 5. sanitizeCustomFields helper (place near pick()) ──
rep("""function pick(obj, keys) { const o = {}; keys.forEach(k => { if (obj[k] !== undefined) o[k] = obj[k]; }); return o; }""",
"""function pick(obj, keys) { const o = {}; keys.forEach(k => { if (obj[k] !== undefined) o[k] = obj[k]; }); return o; }
// Custom fields arrive as an object {label: value} — store only plain
// string values, capped, so the column can never hold garbage.
function sanitizeCustomFields(cf) {
  if (!cf || typeof cf !== 'object' || Array.isArray(cf)) return '{}';
  const out = {};
  for (const [k, v] of Object.entries(cf)) {
    const key = String(k).slice(0, 60).trim();
    if (!key) continue;
    out[key] = String(v == null ? '' : v).slice(0, 500);
  }
  return JSON.stringify(out);
}
function parseCustomFields(cf) {
  try { const p = JSON.parse(cf || '{}'); return p && typeof p === 'object' ? p : {}; }
  catch { return {}; }
}""",
tag='custom fields helpers')

open(P, 'w', encoding='utf-8').write(s)
print('Backend patch 1 done.')
