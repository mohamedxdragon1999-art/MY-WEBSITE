// ════════════════════════════════════════════════════════════
// NexusCRM — real backend (Cloudflare Worker + D1 + Resend)
// V4.1 — "hardened" release
// ════════════════════════════════════════════════════════════
// What changed in V4.1 (all review findings addressed):
//  * Timestamps are ISO-8601 UTC everywhere (schema defaults + JS writes),
//    so SQL comparisons like fire_at <= now work — delayed workflow steps
//    now fire on time instead of up to 24h late.
//  * Delayed workflow steps re-queue the REMAINING steps, so nothing
//    after a "wait N hours" step is silently dropped.
//  * Overdue-task reminders send once per task (reminder_sent flag) and
//    the daily digest sends once per day (digest_sent_date) — no spam.
//  * AI keys can be cleared (empty string = remove), multiple providers
//    can be configured at once, and the worker auto-falls back to the
//    next working provider with retries on 429/5xx.
//  * All AI calls (chat, generate, score, workflow emails, auto-score)
//    count toward the daily cap and track tokens in ai_usage_log.
//  * Real features added: forms (public embed + submissions), courses,
//    funnels, affiliates (public click tracking), community posts.
//  * Rate limiting: register/demo/login by IP, public endpoints by IP.
//  * Security: review replies persist (PATCH /reviews/:id), invoice
//    numbers can't collide, contact deletes cascade cleanly, expired
//    sessions and stale demo accounts get purged by the cron.
// ════════════════════════════════════════════════════════════

const SESSION_DAYS = 30;
const DEMO_SESSION_HOURS = 24;

const nowISO = () => new Date().toISOString();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── CORS ─────────────────────────────────────────────────────
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer-when-downgrade',
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}
function err(message, status, origin) {
  return json({ error: message }, status || 400, origin);
}
function pick(obj, keys) { const o = {}; keys.forEach(k => { if (obj[k] !== undefined) o[k] = obj[k]; }); return o; }
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
}

// ── CRYPTO ───────────────────────────────────────────────────
async function hashPassword(password, saltB64) {
  const enc = new TextEncoder();
  const salt = saltB64 ? b64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256
  );
  return { hash: bytesToB64(new Uint8Array(bits)), salt: bytesToB64(salt) };
}
async function verifyPassword(password, hashB64, saltB64) {
  const { hash } = await hashPassword(password, saltB64);
  return timingSafeEqual(hash, hashB64);
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function bytesToB64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function b64ToBytes(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

// ── SECRET-AT-REST ENCRYPTION (AES-256-GCM) ─────────────────
// AI provider keys and the Resend API key are the most sensitive things
// this database holds. Encrypting them with a secret that lives only in
// Worker Secrets (never in D1, never in source control) means a
// database-only leak exposes ciphertext, not usable keys.
// Requires `wrangler secret put ENCRYPTION_KEY` (see DEPLOY.md).
// If that secret isn't set, this degrades to storing plaintext rather
// than hard-failing the whole app — but /ai/settings and /email/smtp both
// report `encrypted: false` in that case so it's visible, not silent.
let _encKeyCache = null;
async function getEncryptionKey(env) {
  if (!env.ENCRYPTION_KEY) return null;
  if (_encKeyCache) return _encKeyCache;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.ENCRYPTION_KEY));
  _encKeyCache = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return _encKeyCache;
}
async function encryptSecret(env, plaintext) {
  if (!plaintext) return plaintext;
  const key = await getEncryptionKey(env);
  if (!key) return plaintext;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return 'enc:v1:' + bytesToB64(iv) + ':' + bytesToB64(new Uint8Array(ct));
}
async function decryptSecret(env, stored) {
  if (!stored || !stored.startsWith('enc:v1:')) return stored || '';
  const key = await getEncryptionKey(env);
  if (!key) throw new Error('This value is encrypted but ENCRYPTION_KEY is not configured on the backend — set it with `wrangler secret put ENCRYPTION_KEY` to decrypt it again.');
  const [, , ivB64, ctB64] = stored.split(':');
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(ivB64) }, key, b64ToBytes(ctB64));
    return new TextDecoder().decode(pt);
  } catch (e) { throw new Error('Failed to decrypt a stored key — ENCRYPTION_KEY may have changed since it was saved. Re-enter your API keys in Settings.'); }
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToB64(bytes).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));
}
// Natural-language date → ISO date. Understands "tomorrow", "today", "next
// friday", "in 3 days", "monday", and YYYY-MM-DD. Returns null if unsure.
function parseNaturalDate(str) {
  const raw = String(str || '').trim().toLowerCase();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const now = new Date();
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const iso = d => d.toISOString().slice(0, 10);
  if (raw === 'today') return iso(now);
  if (raw === 'tomorrow' || raw === 'tmr') return iso(new Date(now.getTime() + 86400000));
  if (raw === 'day after tomorrow') return iso(new Date(now.getTime() + 2 * 86400000));
  const inDays = raw.match(/^in\s+(\d+)\s+days?$/);
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
async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
function randomSlug(n = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const out = [];
  for (let i = 0; i < n; i++) out.push(chars[crypto.getRandomValues(new Uint8Array(1))[0] % chars.length]);
  return out.join('');
}

// ── AUTH MIDDLEWARE ──────────────────────────────────────────
async function requireAuth(req, env) {
  const authz = req.headers.get('Authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : null;
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.workspace_id, s.expires_at, u.name, u.email
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  ).bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  return { token, userId: row.user_id, workspaceId: row.workspace_id, name: row.name, email: row.email };
}

async function createSession(env, userId, workspaceId, hours) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + (hours || SESSION_DAYS * 24) * 3600 * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, workspace_id, expires_at) VALUES (?,?,?,?)')
    .bind(token, userId, workspaceId, expiresAt).run();
  return { token, expiresAt };
}

// ── VALIDATION ───────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(e) { return typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e); }
function isIn(v, list) { return list.includes(v); }
const CONTACT_STAGES = ['lead', 'prospect', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'customer', 'churned'];
const WORKFLOW_TRIGGERS = ['new_contact', 'deal_stage_change', 'appointment_booked', 'invoice_paid', 'form_submitted', 'trigger_link', 'webhook', 'manual'];
const WORKFLOW_ACTIONS = ['send_email', 'send_whatsapp', 'send_review_request', 'create_task', 'update_stage'];

// ── RATE LIMITING (sliding window in D1) ─────────────────────
async function rateLimit(env, key, max, windowMinutes) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMinutes * 60000).toISOString();
  const row = await env.DB.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?').bind(key).first();
  if (!row || row.window_start < cutoff) {
    await env.DB.prepare('INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=1, window_start=?')
      .bind(key, now.toISOString(), now.toISOString()).run();
    return { ok: true };
  }
  if (row.count >= max) return { ok: false, retryAfterMin: windowMinutes };
  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
  return { ok: true };
}
function clientIp(req) {
  return req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

// ── LOGIN THROTTLING (per-email brute force) ─────────────────
const MAX_FAILS = 8;
const LOCKOUT_MINUTES = 15;
async function checkThrottle(env, email) {
  const row = await env.DB.prepare('SELECT * FROM auth_throttle WHERE email=?').bind(email).first();
  if (row?.locked_until && new Date(row.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(row.locked_until) - new Date()) / 60000);
    return `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
  }
  return null;
}
async function recordFailedLogin(env, email) {
  const row = await env.DB.prepare('SELECT * FROM auth_throttle WHERE email=?').bind(email).first();
  if (!row) {
    await env.DB.prepare("INSERT INTO auth_throttle (email, fail_count, first_fail_at) VALUES (?,1,?)").bind(email, nowISO()).run();
    return;
  }
  const count = row.fail_count + 1;
  const lockedUntil = count >= MAX_FAILS ? new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString() : null;
  await env.DB.prepare('UPDATE auth_throttle SET fail_count=?, locked_until=? WHERE email=?').bind(count, lockedUntil, email).run();
}
async function clearThrottle(env, email) {
  await env.DB.prepare('DELETE FROM auth_throttle WHERE email=?').bind(email).run();
}

// ── AUTH HANDLERS ────────────────────────────────────────────
async function authRegister(env, body, origin, ip) {
  const name = (body.name || '').trim().slice(0, 120);
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!name || !email || !password) return err('All fields required', 400, origin);
  if (!isValidEmail(email)) return err('Enter a valid email address', 400, origin);
  if (password.length < 8) return err('Password must be at least 8 characters', 400, origin);
  if (password.length > 512) return err('Password is too long', 400, origin);

  const rl = await rateLimit(env, `reg:${ip}`, 20, 60);
  if (!rl.ok) return err('Too many accounts from this network — try again later.', 429, origin);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return err('An account with that email already exists', 409, origin);

  // Workspace + user in one shot; if the user insert fails, roll back the workspace row.
  let ws, user;
  try {
    ws = await env.DB.prepare('INSERT INTO workspaces (name, public_token) VALUES (?,?) RETURNING id')
      .bind(`${name}'s Workspace`, randomToken().slice(0, 24)).first();
    const { hash, salt } = await hashPassword(password);
    user = await env.DB.prepare(
      'INSERT INTO users (workspace_id, name, email, password_hash, password_salt) VALUES (?,?,?,?,?) RETURNING id'
    ).bind(ws.id, name, email, hash, salt).first();
  } catch (e) {
    if (ws?.id) await env.DB.prepare('DELETE FROM workspaces WHERE id = ?').bind(ws.id).run();
    throw e;
  }

  const session = await createSession(env, user.id, ws.id);
  return json({ token: session.token, user: { id: user.id, name, email, workspace_id: ws.id } }, 200, origin);
}

async function authLogin(env, body, origin, ip) {
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) return err('Enter email and password', 400, origin);

  const rl = await rateLimit(env, `login:${ip}`, 30, 15);
  if (!rl.ok) return err('Too many login attempts from this network — try again in 15 minutes.', 429, origin);

  const lockMsg = await checkThrottle(env, email);
  if (lockMsg) return err(lockMsg, 429, origin);

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user) { await recordFailedLogin(env, email); return err('Invalid email or password', 401, origin); }
  const ok = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!ok) { await recordFailedLogin(env, email); return err('Invalid email or password', 401, origin); }

  await clearThrottle(env, email);
  const session = await createSession(env, user.id, user.workspace_id);
  return json({ token: session.token, user: { id: user.id, name: user.name, email: user.email, workspace_id: user.workspace_id } }, 200, origin);
}

async function authLogout(env, auth, origin) {
  await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(auth.token).run();
  return json({ ok: true }, 200, origin);
}

async function authDemo(env, origin, ip) {
  const rl = await rateLimit(env, `demo:${ip}`, 10, 60);
  if (!rl.ok) return err('Too many demo workspaces from this network — try again later.', 429, origin);

  const stamp = Date.now();
  const email = `demo-${stamp}@nexuscrm.local`;
  const ws = await env.DB.prepare('INSERT INTO workspaces (name, public_token) VALUES (?,?) RETURNING id').bind('Demo Workspace', randomToken().slice(0, 24)).first();
  const { hash, salt } = await hashPassword(randomToken());
  const user = await env.DB.prepare(
    'INSERT INTO users (workspace_id, name, email, password_hash, password_salt) VALUES (?,?,?,?,?) RETURNING id'
  ).bind(ws.id, 'Demo User', email, hash, salt).first();
  const session = await createSession(env, user.id, ws.id, DEMO_SESSION_HOURS);
  return json({ token: session.token, user: { id: user.id, name: 'Demo User', email, workspace_id: ws.id } }, 200, origin);
}

function authMe(auth, origin) {
  return json({ user: { id: auth.userId, name: auth.name, email: auth.email, workspace_id: auth.workspaceId } }, 200, origin);
}

// ── EVENT LOG ────────────────────────────────────────────────
async function logEvent(env, ctx, workspaceId, type, contactId, payload) {
  const row = await env.DB.prepare(
    'INSERT INTO events (workspace_id, type, contact_id, payload) VALUES (?,?,?,?) RETURNING id'
  ).bind(workspaceId, type, contactId || null, JSON.stringify(payload || {})).first();
  ctx.waitUntil(processEvent(env, row.id).catch(e => console.error('event processing failed', e)));
}

// ── CONTACTS ─────────────────────────────────────────────────
async function handleContacts(env, ctx, req, auth, parts, query, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      let sql = 'SELECT * FROM contacts WHERE workspace_id = ?';
      const args = [ws];
      const search = (query.get('search') || '').toLowerCase();
      const stage = query.get('stage');
      const tag = query.get('tag');
      if (search) { sql += ' AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(company) LIKE ?)'; args.push(`%${search}%`, `%${search}%`, `%${search}%`); }
      if (stage) { sql += ' AND stage = ?'; args.push(stage); }
      if (tag) { sql += " AND (',' || tags || ',') LIKE ?"; args.push(`%,${tag},%`); }
      sql += ' ORDER BY updated_at DESC';
      const limit = Math.min(parseInt(query.get('limit')) || 1000, 2000);
      const offset = Math.max(parseInt(query.get('offset')) || 0, 0);
      sql += ' LIMIT ? OFFSET ?'; args.push(limit, offset);
      const { results } = await env.DB.prepare(sql).bind(...args).all();
      const total = await env.DB.prepare('SELECT COUNT(*) as n FROM contacts WHERE workspace_id = ?').bind(ws).first();
      return json({ contacts: results, total: total.n }, 200, origin);
    }
    if (req.method === 'POST') {
      if (!body.name) return err('Name is required', 400, origin);
      const c = await env.DB.prepare(
        `INSERT INTO contacts (workspace_id,name,email,phone,company,stage,source,notes,tags,custom_fields)
         VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *`
      ).bind(ws, body.name, body.email || '', body.phone || '', body.company || '', isIn(body.stage, CONTACT_STAGES) ? body.stage : 'lead', body.source || 'manual', body.notes || '',
        String(body.tags || '').slice(0, 500), sanitizeCustomFields(body.custom_fields)).first();
      await logEvent(env, ctx, ws, 'new_contact', c.id, { name: c.name, stage: c.stage });
      return json(c, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'GET') {
    const c = await env.DB.prepare('SELECT * FROM contacts WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!c) return err('Contact not found', 404, origin);
    const { results: deals } = await env.DB.prepare('SELECT title,stage,value FROM deals WHERE contact_id=? AND workspace_id=?').bind(id, ws).all();
    return json({ ...c, deals }, 200, origin);
  }
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM contacts WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Contact not found', 404, origin);
    const fields = ['name', 'email', 'phone', 'company', 'stage', 'source', 'notes', 'tags', 'custom_fields', 'ai_score', 'ai_score_reason'];
    const updates = { ...existing, ...pick(body, fields) };
    if (updates.stage && !isIn(updates.stage, CONTACT_STAGES)) updates.stage = existing.stage;
    updates.tags = String(updates.tags || '').slice(0, 500);
    updates.custom_fields = sanitizeCustomFields(updates.custom_fields);
    updates.updated_at = nowISO();
    await env.DB.prepare(
      `UPDATE contacts SET name=?,email=?,phone=?,company=?,stage=?,source=?,notes=?,tags=?,custom_fields=?,ai_score=?,ai_score_reason=?,updated_at=? WHERE id=? AND workspace_id=?`
    ).bind(updates.name, updates.email, updates.phone, updates.company, updates.stage, updates.source, updates.notes, updates.tags, updates.custom_fields, updates.ai_score, updates.ai_score_reason, updates.updated_at, id, ws).run();
    return json(updates, 200, origin);
  }
  if (req.method === 'DELETE') {
    // Cascade cleanly: remove the contact's tasks/messages/appointments/deals,
    // detach invoices/events (financial + history rows are kept, just unlinked).
    await env.DB.batch([
      env.DB.prepare('DELETE FROM tasks WHERE contact_id=? AND workspace_id=?').bind(id, ws),
      env.DB.prepare('DELETE FROM messages WHERE contact_id=? AND workspace_id=?').bind(id, ws),
      env.DB.prepare('DELETE FROM appointments WHERE contact_id=? AND workspace_id=?').bind(id, ws),
      env.DB.prepare('DELETE FROM deals WHERE contact_id=? AND workspace_id=?').bind(id, ws),
      env.DB.prepare('UPDATE invoices SET contact_id=NULL WHERE contact_id=? AND workspace_id=?').bind(id, ws),
      env.DB.prepare('UPDATE events SET contact_id=NULL WHERE contact_id=? AND workspace_id=?').bind(id, ws),
      env.DB.prepare('DELETE FROM contacts WHERE id=? AND workspace_id=?').bind(id, ws),
    ]);
    return json({ ok: true }, 200, origin);
  }
  return err('Not found', 404, origin);
}

// ── DEALS ────────────────────────────────────────────────────
async function handleDeals(env, ctx, req, auth, parts, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT d.*, c.name as contact_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id WHERE d.workspace_id=? ORDER BY d.created_at DESC`
      ).bind(ws).all();
      return json({ deals: results }, 200, origin);
    }
    if (req.method === 'POST') {
      if (!body.title) return err('Title is required', 400, origin);
      const d = await env.DB.prepare(
        `INSERT INTO deals (workspace_id,contact_id,title,value,stage,probability,close_date,notes) VALUES (?,?,?,?,?,?,?,?) RETURNING *`
      ).bind(ws, body.contact_id || null, body.title, Number(body.value) || 0, isIn(body.stage, CONTACT_STAGES) ? body.stage : 'lead', Math.max(0, Math.min(100, parseInt(body.probability) || 20)), body.close_date || '', body.notes || '').first();
      return json(d, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM deals WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Deal not found', 404, origin);
    const stageChanged = body.stage && body.stage !== existing.stage;
    const u = { ...existing, ...pick(body, ['title', 'contact_id', 'value', 'stage', 'probability', 'close_date', 'notes']) };
    await env.DB.prepare(
      `UPDATE deals SET title=?,contact_id=?,value=?,stage=?,probability=?,close_date=?,notes=? WHERE id=? AND workspace_id=?`
    ).bind(u.title, u.contact_id, Number(u.value) || 0, isIn(u.stage, CONTACT_STAGES) ? u.stage : existing.stage, Math.max(0, Math.min(100, parseInt(u.probability) || 0)), u.close_date, u.notes, id, ws).run();
    if (stageChanged) await logEvent(env, ctx, ws, 'deal_stage_change', u.contact_id, { deal_id: id, title: u.title, from: existing.stage, to: u.stage });
    return json({ ...u, stage: isIn(u.stage, CONTACT_STAGES) ? u.stage : existing.stage }, 200, origin);
  }
  if (req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM deals WHERE id=? AND workspace_id=?').bind(id, ws).run();
    return json({ ok: true }, 200, origin);
  }
  return err('Not found', 404, origin);
}

// ── TASKS ────────────────────────────────────────────────────
async function handleTasks(env, req, auth, parts, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT t.*, c.name as contact_name FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id WHERE t.workspace_id=? ORDER BY (t.due_date='') , t.due_date`
      ).bind(ws).all();
      return json({ tasks: results }, 200, origin);
    }
    if (req.method === 'POST') {
      if (!body.title) return err('Title is required', 400, origin);
      const t = await env.DB.prepare(
        `INSERT INTO tasks (workspace_id,contact_id,title,description,priority,due_date,status) VALUES (?,?,?,?,?,?,'todo') RETURNING *`
      ).bind(ws, body.contact_id || null, body.title, body.description || '', body.priority || 'medium', body.due_date || '').first();
      return json(t, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Task not found', 404, origin);
    const u = { ...existing, ...pick(body, ['title', 'description', 'priority', 'due_date', 'status', 'contact_id']) };
    await env.DB.prepare(`UPDATE tasks SET title=?,description=?,priority=?,due_date=?,status=?,contact_id=? WHERE id=? AND workspace_id=?`)
      .bind(u.title, u.description, u.priority, u.due_date, u.status, u.contact_id, id, ws).run();
    return json(u, 200, origin);
  }
  if (req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM tasks WHERE id=? AND workspace_id=?').bind(id, ws).run();
    return json({ ok: true }, 200, origin);
  }
  return err('Not found', 404, origin);
}

// ── MESSAGES ─────────────────────────────────────────────────
async function handleMessages(env, req, auth, body, origin) {
  const ws = auth.workspaceId;
  if (req.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT m.*, c.name as contact_name FROM messages m LEFT JOIN contacts c ON c.id=m.contact_id WHERE m.workspace_id=? ORDER BY m.created_at DESC`
    ).bind(ws).all();
    return json({ messages: results }, 200, origin);
  }
  if (req.method === 'POST') {
    const m = await env.DB.prepare(
      `INSERT INTO messages (workspace_id,contact_id,channel,subject,body,direction,ai_generated) VALUES (?,?,?,?,?,?,?) RETURNING *`
    ).bind(ws, body.contact_id || null, body.channel || 'email', body.subject || '', body.body || '', body.direction || 'outbound', body.ai_generated || 0).first();
    return json(m, 200, origin);
  }
  return err('Not found', 404, origin);
}

// ── APPOINTMENTS ─────────────────────────────────────────────
async function handleAppointments(env, ctx, req, auth, parts, query, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      const month = query.get('month');
      let sql = `SELECT a.*, c.name as contact_name FROM appointments a LEFT JOIN contacts c ON c.id=a.contact_id WHERE a.workspace_id=?`;
      const args = [ws];
      if (month) { sql += ' AND a.date LIKE ?'; args.push(`${month}%`); }
      sql += ' ORDER BY a.date, a.time';
      const { results } = await env.DB.prepare(sql).bind(...args).all();
      return json({ appointments: results }, 200, origin);
    }
    if (req.method === 'POST') {
      if (!body.title || !body.date) return err('Title and date required', 400, origin);
      const a = await env.DB.prepare(
        `INSERT INTO appointments (workspace_id,contact_id,title,date,time,duration,type,notes,status) VALUES (?,?,?,?,?,?,?,?,'scheduled') RETURNING *`
      ).bind(ws, body.contact_id || null, body.title, body.date, body.time || '09:00', parseInt(body.duration) || 60, body.type || 'call', body.notes || '').first();
      await logEvent(env, ctx, ws, 'appointment_booked', a.contact_id, { title: a.title, date: a.date, time: a.time });
      return json(a, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM appointments WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Appointment not found', 404, origin);
    const u = { ...existing, ...pick(body, ['title', 'date', 'time', 'duration', 'type', 'notes', 'status', 'contact_id']) };
    await env.DB.prepare(`UPDATE appointments SET title=?,date=?,time=?,duration=?,type=?,notes=?,status=?,contact_id=? WHERE id=? AND workspace_id=?`)
      .bind(u.title, u.date, u.time, u.duration, u.type, u.notes, u.status, u.contact_id, id, ws).run();
    return json(u, 200, origin);
  }
  return err('Not found', 404, origin);
}

// ── REVIEWS ──────────────────────────────────────────────────
async function handleReviews(env, req, auth, parts, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT r.*, c.name as contact_name FROM reviews r LEFT JOIN contacts c ON c.id=r.contact_id WHERE r.workspace_id=? ORDER BY r.id DESC`
      ).bind(ws).all();
      return json({ reviews: results }, 200, origin);
    }
    if (req.method === 'POST') {
      const r = await env.DB.prepare(
        `INSERT INTO reviews (workspace_id,platform,rating,text,status) VALUES (?,?,?,?,'pending') RETURNING *`
      ).bind(ws, body.platform || 'google', Math.max(1, Math.min(5, parseInt(body.rating) || 5)), body.text || '').first();
      return json(r, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM reviews WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Review not found', 404, origin);
    const u = { ...existing, ...pick(body, ['ai_reply', 'status', 'rating', 'text', 'platform', 'contact_id']) };
    await env.DB.prepare(`UPDATE reviews SET ai_reply=?,status=?,rating=?,text=?,platform=?,contact_id=? WHERE id=? AND workspace_id=?`)
      .bind(u.ai_reply || '', u.status || existing.status, u.rating, u.text, u.platform, u.contact_id, id, ws).run();
    return json(u, 200, origin);
  }
  return err('Not found', 404, origin);
}

// ── WORKFLOWS ────────────────────────────────────────────────
async function handleWorkflows(env, req, auth, parts, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM workflows WHERE workspace_id=?').bind(ws).all();
      return json({ workflows: results.map(w => ({ ...w, steps: JSON.parse(w.steps || '[]') })) }, 200, origin);
    }
    if (req.method === 'POST') {
      if (!body.name) return err('Name is required', 400, origin);
      const steps = sanitizeWorkflowSteps(body.steps || []);
      const w = await env.DB.prepare(
        `INSERT INTO workflows (workspace_id,name,trigger,status,steps) VALUES (?,?,?,'active',?) RETURNING *`
      ).bind(ws, body.name, isIn(body.trigger, WORKFLOW_TRIGGERS) ? body.trigger : 'manual', JSON.stringify(steps)).first();
      return json({ ...w, steps }, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM workflows WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Workflow not found', 404, origin);
    const u = { ...existing, ...pick(body, ['name', 'trigger', 'status']) };
    const steps = body.steps ? JSON.stringify(sanitizeWorkflowSteps(body.steps)) : existing.steps;
    await env.DB.prepare(`UPDATE workflows SET name=?,trigger=?,status=?,steps=? WHERE id=? AND workspace_id=?`)
      .bind(u.name, isIn(u.trigger, WORKFLOW_TRIGGERS) ? u.trigger : existing.trigger, u.status, steps, id, ws).run();
    return json({ ...u, steps: JSON.parse(steps) }, 200, origin);
  }
  return err('Not found', 404, origin);
}
function sanitizeWorkflowSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map(s => {
    const action = isIn(s?.action, WORKFLOW_ACTIONS) ? s.action : 'create_task';
    const note = typeof s?.note === 'string' ? s.note.slice(0, 500) : '';
    const delay = Math.max(0, Math.min(24 * 30, parseFloat(s?.delay_hours) || 0));
    const step = { action, note };
    if (delay > 0) step.delay_hours = delay;
    if (action === 'update_stage' && isIn(s?.stage, CONTACT_STAGES)) step.stage = s.stage;
    return step;
  });
}

// ── INVOICES ─────────────────────────────────────────────────
async function handleInvoices(env, ctx, req, auth, parts, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT i.*, c.name as contact_name FROM invoices i LEFT JOIN contacts c ON c.id=i.contact_id WHERE i.workspace_id=?`
      ).bind(ws).all();
      return json({ invoices: results.map(i => ({ ...i, items: JSON.parse(i.items || '[]') })) }, 200, origin);
    }
    if (req.method === 'POST') {
      const items = (body.items || []).map(it => ({ ...it, qty: Number(it.qty) || 0, price: Number(it.price) || 0 }));
      const subtotal = items.reduce((a, it) => a + (it.qty * it.price), 0);
      const tax = Math.max(0, Number(body.tax) || 0);
      const total = Math.round(subtotal * (1 + tax / 100) * 100) / 100;
      // Sequential numbering per workspace based on max id — never reuses
      // numbers after a deletion and can't collide with the UNIQUE index.
      const maxRow = await env.DB.prepare('SELECT COALESCE(MAX(id),0) as n FROM invoices WHERE workspace_id=?').bind(ws).first();
      const number = 'INV-' + (1000 + maxRow.n + 1);
      const inv = await env.DB.prepare(
        `INSERT INTO invoices (workspace_id,contact_id,number,items,tax,total,status,due_date) VALUES (?,?,?,?,?,?,'draft',?) RETURNING *`
      ).bind(ws, body.contact_id || null, number, JSON.stringify(items), tax, total, body.due_date || '').first();
      return json({ ...inv, items }, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM invoices WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Invoice not found', 404, origin);
    const wasUnpaid = existing.status !== 'paid';
    const u = { ...existing, ...pick(body, ['status', 'due_date']) };
    const paidAt = (body.status === 'paid' && !existing.paid_at) ? nowISO() : existing.paid_at;
    await env.DB.prepare(`UPDATE invoices SET status=?,due_date=?,paid_at=? WHERE id=? AND workspace_id=?`)
      .bind(u.status, u.due_date, paidAt, id, ws).run();
    if (wasUnpaid && body.status === 'paid') await logEvent(env, ctx, ws, 'invoice_paid', existing.contact_id, { invoice_id: id, number: existing.number, total: existing.total });
    return json({ ...u, paid_at: paidAt, items: JSON.parse(existing.items || '[]') }, 200, origin);
  }
  return err('Not found', 404, origin);
}

// ── SOCIAL ───────────────────────────────────────────────────
async function handleSocial(env, req, auth, parts, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM social_posts WHERE workspace_id=? ORDER BY id DESC').bind(ws).all();
      return json({ posts: results }, 200, origin);
    }
    if (req.method === 'POST') {
      const p = await env.DB.prepare(
        `INSERT INTO social_posts (workspace_id,platform,content,status,ai_generated) VALUES (?,?,?,?,?) RETURNING *`
      ).bind(ws, body.platform || 'linkedin', body.content || '', body.status === 'published' || body.status === 'scheduled' ? body.status : 'draft', body.ai_generated || 0).first();
      return json(p, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM social_posts WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Post not found', 404, origin);
    const u = { ...existing, ...pick(body, ['platform', 'content', 'status']) };
    await env.DB.prepare('UPDATE social_posts SET platform=?,content=?,status=? WHERE id=? AND workspace_id=?')
      .bind(u.platform, u.content, u.status, id, ws).run();
    return json(u, 200, origin);
  }
  if (req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM social_posts WHERE id=? AND workspace_id=?').bind(id, ws).run();
    return json({ ok: true }, 200, origin);
  }
  return err('Not found', 404, origin);
}

// ── SUB-ACCOUNTS ─────────────────────────────────────────────
async function handleSubAccounts(env, req, auth, parts, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM sub_accounts WHERE workspace_id=?').bind(ws).all();
      return json({ accounts: results }, 200, origin);
    }
    if (req.method === 'POST') {
      if (!body.name) return err('Name is required', 400, origin);
      const a = await env.DB.prepare(
        `INSERT INTO sub_accounts (workspace_id,name,email,plan,mrr,status) VALUES (?,?,?,?,?,'active') RETURNING *`
      ).bind(ws, body.name, body.email || '', body.plan || 'starter', Number(body.mrr) || 0).first();
      return json(a, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM sub_accounts WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Account not found', 404, origin);
    const u = { ...existing, ...pick(body, ['name', 'email', 'plan', 'mrr', 'status']) };
    await env.DB.prepare('UPDATE sub_accounts SET name=?,email=?,plan=?,mrr=?,status=? WHERE id=? AND workspace_id=?')
      .bind(u.name, u.email, u.plan, u.mrr, u.status, id, ws).run();
    return json(u, 200, origin);
  }
  if (req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM sub_accounts WHERE id=? AND workspace_id=?').bind(id, ws).run();
    return json({ ok: true }, 200, origin);
  }
  return err('Not found', 404, origin);
}

// ── FORMS (real lead-capture with public embed) ──────────────
async function handleForms(env, ctx, req, auth, parts, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT f.*, (SELECT COUNT(*) FROM form_submissions s WHERE s.form_id=f.id) as submissions
         FROM forms f WHERE f.workspace_id=? ORDER BY f.id DESC`
      ).bind(ws).all();
      return json({ forms: results }, 200, origin);
    }
    if (req.method === 'POST') {
      if (!body.name) return err('Name is required', 400, origin);
      const fields = Array.isArray(body.fields) ? body.fields.map(f => ({
        label: String(f.label || '').slice(0, 100),
        type: ['text', 'email', 'phone', 'textarea', 'number'].includes(f.type) ? f.type : 'text',
        required: !!f.required,
      })).filter(f => f.label) : [];
      const f = await env.DB.prepare(
        `INSERT INTO forms (workspace_id,name,slug,fields,success_message,active) VALUES (?,?,?,?,?,1) RETURNING *`
      ).bind(ws, body.name.slice(0, 120), randomSlug(), JSON.stringify(fields), (body.success_message || '').slice(0, 300)).first();
      return json({ ...f, fields, submissions: 0 }, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'GET' && parts[2] === 'submissions') {
    const f = await env.DB.prepare('SELECT * FROM forms WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!f) return err('Form not found', 404, origin);
    const { results } = await env.DB.prepare(
      `SELECT s.*, c.name as contact_name FROM form_submissions s LEFT JOIN contacts c ON c.id=s.contact_id WHERE s.form_id=? ORDER BY s.id DESC LIMIT 200`
    ).bind(id).all();
    return json({ submissions: results.map(s => ({ ...s, data: JSON.parse(s.data || '{}') })) }, 200, origin);
  }
  if (req.method === 'DELETE' && parts[2] === 'submissions') {
    await env.DB.prepare('DELETE FROM form_submissions WHERE id=? AND workspace_id=?').bind(parseInt(parts[3]), ws).run();
    return json({ ok: true }, 200, origin);
  }
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM forms WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Form not found', 404, origin);
    const u = { ...existing, ...pick(body, ['name', 'active', 'success_message']) };
    const fields = body.fields ? JSON.stringify(Array.isArray(body.fields) ? body.fields : []) : existing.fields;
    await env.DB.prepare('UPDATE forms SET name=?,active=?,success_message=?,fields=? WHERE id=? AND workspace_id=?')
      .bind(u.name, u.active ? 1 : 0, u.success_message, fields, id, ws).run();
    return json({ ...u, fields: JSON.parse(fields) }, 200, origin);
  }
  if (req.method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM form_submissions WHERE form_id=? AND workspace_id=?').bind(id, ws),
      env.DB.prepare('DELETE FROM forms WHERE id=? AND workspace_id=?').bind(id, ws),
    ]);
    return json({ ok: true }, 200, origin);
  }
  return err('Not found', 404, origin);
}

// ── PUBLIC FORM ENDPOINTS (no auth — used by embeds) ─────────
async function publicFormGet(env, slug, origin) {
  const f = await env.DB.prepare('SELECT * FROM forms WHERE slug=? AND active=1').bind(slug).first();
  if (!f) return err('Form not found or inactive', 404, origin);
  return json({ id: f.id, name: f.name, fields: JSON.parse(f.fields || '[]'), success_message: f.success_message }, 200, origin);
}
async function publicFormSubmit(env, ctx, slug, body, origin, ip) {
  const f = await env.DB.prepare('SELECT * FROM forms WHERE slug=? AND active=1').bind(slug).first();
  if (!f) return err('Form not found or inactive', 404, origin);
  const rl = await rateLimit(env, `form:${f.id}:${ip}`, 60, 60);
  if (!rl.ok) return err('Too many submissions from this network — try again later.', 429, origin);

  const fields = JSON.parse(f.fields || '[]');
  const data = {};
  for (const field of fields) {
    const v = (body[field.label] !== undefined ? body[field.label] : body[field.label.toLowerCase()]) || '';
    if (field.required && !String(v).trim()) return err(`"${field.label}" is required`, 400, origin);
    data[field.label] = String(v).slice(0, 1000);
  }
  // Auto-create a contact from recognizable fields, then fire workflows.
  const email = (data['Email'] || data['email'] || '').trim();
  const name = (data['Name'] || data['Full Name'] || data['name'] || 'Form Lead').trim().slice(0, 120);
  const phone = (data['Phone'] || data['phone'] || '').trim();
  let contactId = null;
  if (name) {
    const c = await env.DB.prepare(
      `INSERT INTO contacts (workspace_id,name,email,phone,source,notes) VALUES (?,?,?,?,'form',?) RETURNING id`
    ).bind(f.workspace_id, name, email, phone, `Submitted via form "${f.name}"`).first();
    contactId = c.id;
  }
  const sub = await env.DB.prepare(
    `INSERT INTO form_submissions (form_id,workspace_id,contact_id,data) VALUES (?,?,?,?) RETURNING id`
  ).bind(f.id, f.workspace_id, contactId, JSON.stringify(data)).first();
  await logEvent(env, ctx, f.workspace_id, 'form_submitted', contactId, { form_id: f.id, form_name: f.name });
  return json({ ok: true, id: sub.id, message: f.success_message }, 200, origin);
}
function formEmbedScript(form, baseUrl) {
  const safeName = String(form.name).replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-');
  const fields = JSON.parse(form.fields || '[]');
  const inputs = fields.map((f, i) => {
    const label = String(f.label).replace(/"/g, '&quot;');
    if (f.type === 'textarea') return `<label for="nx_f_${i}">${label}${f.required ? ' *' : ''}</label><textarea id="nx_f_${i}" name="${label}" ${f.required ? 'required' : ''}></textarea>`;
    return `<label for="nx_f_${i}">${label}${f.required ? ' *' : ''}</label><input type="${f.type === 'phone' ? 'tel' : f.type}" id="nx_f_${i}" name="${label}" ${f.required ? 'required' : ''}>`;
  }).join('');
  const success = String(form.success_message || 'Thanks! We will be in touch soon.').replace(/"/g, '&quot;');
  return `(function(){
  var HOST="${baseUrl}";
  var done=document.getElementById("nx-form-${form.id}");
  if(done)return;
  var wrap=document.createElement("div");wrap.id="nx-form-${form.id}";
  wrap.innerHTML='<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto;padding:18px;border:1px solid #e2e8f0;border-radius:12px;background:#fff"><form id="nxform_${form.id}">${inputs}<button type="submit" style="margin-top:10px;width:100%;padding:11px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">Submit</button></form><div id="nxmsg_${form.id}" style="margin-top:10px;font-size:13px;color:#0f766e;display:none">${success}</div></div>';
  var host=document.currentScript&&document.currentScript.parentNode||document.body;
  host.appendChild(wrap);
  var f=document.getElementById("nxform_${form.id}");
  f.addEventListener("submit",function(ev){ev.preventDefault();
    var data={};for(var i=0;i<f.elements.length;i++){var e=f.elements[i];if(e.name)data[e.name]=e.value;}
    var btn=f.querySelector("button");btn.disabled=true;btn.textContent="Sending...";
    fetch(HOST+"/api/public/forms/${form.id}",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)})
    .then(function(r){return r.json();})
    .then(function(j){if(j.ok){f.style.display="none";document.getElementById("nxmsg_${form.id}").style.display="block";}
      else{alert(j.error||"Submission failed");btn.disabled=false;btn.textContent="Submit";}})
    .catch(function(){alert("Could not reach the server — try again.");btn.disabled=false;btn.textContent="Submit";});
  });
})();`;
}

// ── COURSES ──────────────────────────────────────────────────
async function handleCourses(env, req, auth, parts, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM courses WHERE workspace_id=? ORDER BY id DESC').bind(ws).all();
      return json({ courses: results.map(c => ({ ...c, modules: JSON.parse(c.modules || '[]') })) }, 200, origin);
    }
    if (req.method === 'POST') {
      if (!body.title) return err('Title is required', 400, origin);
      const modules = Array.isArray(body.modules) ? body.modules : [];
      const c = await env.DB.prepare(
        `INSERT INTO courses (workspace_id,title,description,price,status,modules) VALUES (?,?,?,?,?,?) RETURNING *`
      ).bind(ws, body.title.slice(0, 200), body.description || '', Number(body.price) || 0, body.status === 'published' ? 'published' : 'draft', JSON.stringify(modules)).first();
      return json({ ...c, modules }, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM courses WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Course not found', 404, origin);
    const u = { ...existing, ...pick(body, ['title', 'description', 'price', 'status']) };
    const modules = body.modules ? JSON.stringify(body.modules) : existing.modules;
    await env.DB.prepare('UPDATE courses SET title=?,description=?,price=?,status=?,modules=? WHERE id=? AND workspace_id=?')
      .bind(u.title, u.description, u.price, u.status, modules, id, ws).run();
    return json({ ...u, modules: JSON.parse(modules) }, 200, origin);
  }
  if (req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM courses WHERE id=? AND workspace_id=?').bind(id, ws).run();
    return json({ ok: true }, 200, origin);
  }
  return err('Not found', 404, origin);
}

// ── FUNNELS ──────────────────────────────────────────────────
async function handleFunnels(env, req, auth, parts, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM funnels WHERE workspace_id=? ORDER BY id DESC').bind(ws).all();
      return json({ funnels: results.map(f => ({ ...f, stages: JSON.parse(f.stages || '[]') })) }, 200, origin);
    }
    if (req.method === 'POST') {
      if (!body.name) return err('Name is required', 400, origin);
      const stages = Array.isArray(body.stages) ? body.stages : [];
      const f = await env.DB.prepare(
        `INSERT INTO funnels (workspace_id,name,goal,stages) VALUES (?,?,?,?) RETURNING *`
      ).bind(ws, body.name.slice(0, 120), body.goal || '', JSON.stringify(stages)).first();
      return json({ ...f, stages }, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM funnels WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Funnel not found', 404, origin);
    const u = { ...existing, ...pick(body, ['name', 'goal']) };
    const stages = body.stages ? JSON.stringify(body.stages) : existing.stages;
    await env.DB.prepare('UPDATE funnels SET name=?,goal=?,stages=? WHERE id=? AND workspace_id=?')
      .bind(u.name, u.goal, stages, id, ws).run();
    return json({ ...u, stages: JSON.parse(stages) }, 200, origin);
  }
  if (req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM funnels WHERE id=? AND workspace_id=?').bind(id, ws).run();
    return json({ ok: true }, 200, origin);
  }
  return err('Not found', 404, origin);
}

// ── AFFILIATES (with public click tracking) ──────────────────
async function handleAffiliates(env, req, auth, parts, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM affiliates WHERE workspace_id=? ORDER BY id DESC').bind(ws).all();
      return json({ affiliates: results }, 200, origin);
    }
    if (req.method === 'POST') {
      if (!body.name) return err('Name is required', 400, origin);
      const a = await env.DB.prepare(
        `INSERT INTO affiliates (workspace_id,name,email,rate,token) VALUES (?,?,?,?,?) RETURNING *`
      ).bind(ws, body.name.slice(0, 120), body.email || '', Math.max(0, Math.min(100, Number(body.rate) || 20)), randomToken().slice(0, 24)).first();
      return json(a, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM affiliates WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Affiliate not found', 404, origin);
    const u = { ...existing, ...pick(body, ['name', 'email', 'rate', 'conversions']) };
    await env.DB.prepare('UPDATE affiliates SET name=?,email=?,rate=?,conversions=? WHERE id=? AND workspace_id=?')
      .bind(u.name, u.email, u.rate, u.conversions, id, ws).run();
    return json(u, 200, origin);
  }
  if (req.method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM affiliate_clicks WHERE affiliate_id=? AND workspace_id=?').bind(id, ws),
      env.DB.prepare('DELETE FROM affiliates WHERE id=? AND workspace_id=?').bind(id, ws),
    ]);
    return json({ ok: true }, 200, origin);
  }
  return err('Not found', 404, origin);
}
async function publicAffiliateGo(env, query, origin, ip) {
  const token = query.get('token') || '';
  const url = query.get('url') || '';
  const ref = (query.get('ref') || '').slice(0, 100);
  const a = await env.DB.prepare('SELECT * FROM affiliates WHERE token=?').bind(token).first();
  if (!a) return err('Invalid affiliate link', 404, origin);
  const rl = await rateLimit(env, `af:${a.id}:${ip}`, 200, 60);
  if (!rl.ok) return err('Rate limited', 429, origin);
  await env.DB.batch([
    env.DB.prepare('UPDATE affiliates SET clicks = clicks + 1 WHERE id=?').bind(a.id),
    env.DB.prepare('INSERT INTO affiliate_clicks (affiliate_id,workspace_id,ref) VALUES (?,?,?)').bind(a.id, a.workspace_id, ref),
  ]);
  if (url && /^https?:\/\//i.test(url)) return Response.redirect(url, 302);
  return json({ ok: true, clicks: 1 }, 200, origin);
}

// ── COMMUNITY ────────────────────────────────────────────────
async function handleCommunity(env, req, auth, parts, body, origin) {
  const ws = auth.workspaceId;
  if (parts.length === 1) {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM community_posts WHERE workspace_id=? ORDER BY id DESC').bind(ws).all();
      return json({ posts: results }, 200, origin);
    }
    if (req.method === 'POST') {
      if (!body.title) return err('Title is required', 400, origin);
      const p = await env.DB.prepare(
        `INSERT INTO community_posts (workspace_id,title,content) VALUES (?,?,?) RETURNING *`
      ).bind(ws, body.title.slice(0, 200), body.content || '').first();
      return json(p, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM community_posts WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Post not found', 404, origin);
    const u = { ...existing, ...pick(body, ['title', 'content']) };
    await env.DB.prepare('UPDATE community_posts SET title=?,content=? WHERE id=? AND workspace_id=?')
      .bind(u.title, u.content, id, ws).run();
    return json(u, 200, origin);
  }
  if (req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM community_posts WHERE id=? AND workspace_id=?').bind(id, ws).run();
    return json({ ok: true }, 200, origin);
  }
  return err('Not found', 404, origin);
}

// ── STATS ────────────────────────────────────────────────────
async function computeStats(env, ws) {
  const [contacts, openDeals, wonDeals, upcoming, pendingTasks, paidInvoices, subAccounts, forms] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) n FROM contacts WHERE workspace_id=?').bind(ws).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(value),0) v, COUNT(*) n FROM deals WHERE workspace_id=? AND stage NOT IN ('won','lost')`).bind(ws).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(value),0) v FROM deals WHERE workspace_id=? AND stage='won'`).bind(ws).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM appointments WHERE workspace_id=? AND status='scheduled' AND date >= date('now')`).bind(ws).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM tasks WHERE workspace_id=? AND status='todo'`).bind(ws).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(total),0) v FROM invoices WHERE workspace_id=? AND status='paid'`).bind(ws).first(),
    env.DB.prepare('SELECT COUNT(*) n FROM sub_accounts WHERE workspace_id=?').bind(ws).first(),
    env.DB.prepare('SELECT COUNT(*) n FROM forms WHERE workspace_id=?').bind(ws).first(),
  ]);
  return {
    contacts: contacts.n,
    pipeline_value: openDeals.v,
    open_deals: openDeals.n,
    won_revenue: wonDeals.v,
    upcoming_appointments: upcoming.n,
    pending_tasks: pendingTasks.n,
    revenue_collected: paidInvoices.v,
    sub_accounts: subAccounts.n,
    forms: forms.n,
  };
}

// ── AI: WORKSPACE SETTINGS ───────────────────────────────────
const WS_CACHE = new Map();
const WS_CACHE_TTL_MS = 3000;
async function getWorkspace(env, ws) {
  const cached = WS_CACHE.get(ws);
  if (cached && (Date.now() - cached.ts) < WS_CACHE_TTL_MS) return cached.data;
  const data = await env.DB.prepare('SELECT * FROM workspaces WHERE id=?').bind(ws).first();
  WS_CACHE.set(ws, { data, ts: Date.now() });
  return data;
}
function invalidateWorkspaceCache(ws) { WS_CACHE.delete(ws); }

const MODEL_LISTS = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-3.5-turbo', 'o3-mini'],
  nvidia: [
    // Catalog verified live against /v1/models on 2026-08-27. The old
    // meta/llama-3.1-*b-instruct defaults were retired (llama-3.1-8b hit
    // end-of-life 2026-08-26 → 410 Gone); deepseek-r1/v3, phi-3-medium,
    // gemma-2 and qwen2 are also gone from the catalog.
    'nvidia/llama-3.1-nemotron-70b-instruct', 'nvidia/nemotron-3-nano-30b-a3b',
    'nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-3-ultra-550b-a55b',
    'nvidia/llama-3.1-nemotron-ultra-253b-v1', 'nvidia/nemotron-4-340b-instruct',
    'deepseek-ai/deepseek-v4-flash-0731', 'deepseek-ai/deepseek-v4-pro-0813',
    'moonshotai/kimi-k3', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b',
    'google/gemma-3-12b-it', 'mistralai/mistral-large-2-instruct',
    'meta/llama-3.2-90b-vision-instruct', 'meta/llama-3.2-11b-vision-instruct',
  ],
  custom: [],
};

// ════════════════════════════════════════════════════════════
// LIVE MODEL CATALOG — real models from the providers, not placeholders.
//  * Fetches NVIDIA's OpenAI-compatible /v1/models with YOUR key, so when
//    NVIDIA adds/removes models the app reflects it automatically.
//  * Cached per workspace for 10 minutes (fast page loads).
//  * Non-chat endpoints (embed/rerank/tts/vision-gallery etc.) are filtered
//    out so the dropdown only shows models you can chat with.
//  * If the live fetch fails (no key / network / provider hiccup) it falls
//    back to the curated list — the app never breaks.
// ════════════════════════════════════════════════════════════
const MODELS_CACHE = new Map();          // `${provider}:${workspaceId}` -> { data, ts }
const MODELS_TTL_MS = 10 * 60 * 1000;    // 10 minutes
// Endpoints you can't CHAT with: embeddings, rerankers, guards, OCR/vision-only,
// TTS/ASR/translate, image/video generation, reward models, parsers, detectors.
// Verified against the live NVIDIA catalog 2026-08-27 — without these extras,
// ~12 dead-in-chat models (nvclip, riva-translate, kosmos-2, fuyu, vila, neva,
// deplot, diffusiongemma, muse-glimmer, ising-calibration, reward, detector…)
// leak into the dropdown and fail when picked.
const NON_CHAT_MODEL_RE = /embed|rerank|classify|tts|stt|asr|audio|video|guard|ocr|segmentation|image-gen|flux|sdxl|pixart|vlm|retrieval|clip|kosmos|fuyu|vila|neva|deplot|diffusion|glimmer|ising|calibration|riva|translate|reward|detect|synthetic|safety|moderation|whisper|music|speech|voice|parse/i;

async function fetchLiveModels(provider, w, refresh) {
  const cacheKey = `${provider}:${w.id}`;
  if (!refresh) {
    const cached = MODELS_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < MODELS_TTL_MS) return cached.data;
  }
  let live = null;
  let liveOk = false;
  const key = provider === 'nvidia' ? w.ai_nvidia_key : w.ai_openai_key;
  const url = provider === 'nvidia'
    ? 'https://integrate.api.nvidia.com/v1/models'
    : 'https://api.openai.com/v1/models';
  if (key) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) {
        const d = await r.json();
        const ids = (d.data || [])
          .map(m => String(m.id || ''))
          .filter(id => id && id.length < 120 && !NON_CHAT_MODEL_RE.test(id));
        // Sanity: only accept a real list (>=3 entries), capped for a sane dropdown.
        // Order: curated proven models first (catalog order), then the rest of the
        // live catalog alphabetically — so the dropdown leads with known-good picks
        // instead of whatever the provider lists first.
        if (ids.length >= 3) {
          const uniq = [...new Set(ids)];
          const curated = MODEL_LISTS[provider] || [];
          const rank = new Map(curated.map((m, i) => [m, i]));
          uniq.sort((a, b) => {
            const ra = rank.has(a) ? rank.get(a) : 1e6, rb = rank.has(b) ? rank.get(b) : 1e6;
            return ra !== rb ? ra - rb : a.localeCompare(b);
          });
          live = uniq.slice(0, 120);
          liveOk = true;
        }
      }
    } catch { /* live fetch failed — fall back to curated below */ }
  }
  const data = live || MODEL_LISTS[provider] || [];
  MODELS_CACHE.set(cacheKey, { data, live: liveOk, ts: Date.now() });
  return { data, live: liveOk };
}

async function handleAISettings(env, req, auth, body, origin) {
  const ws = auth.workspaceId;
  if (req.method === 'GET') {
    const w = await getWorkspace(env, ws);
    return json({
      provider: w.ai_provider, model: w.ai_model, temperature: w.ai_temperature, max_tokens: w.ai_max_tokens,
      system_prompt: w.ai_system_prompt, custom_base_url: w.ai_custom_base_url,
      openai_key_set: !!w.ai_openai_key, nvidia_key_set: !!w.ai_nvidia_key, custom_key_set: !!w.ai_custom_key,
      nvidia_base_url: w.ai_nvidia_base_url || '',
      daily_call_cap: w.ai_daily_call_cap,
      brand_voice: w.ai_brand_voice || '',
      auto_score_new_contacts: !!w.ai_auto_score_new_contacts,
      daily_digest_enabled: !!w.ai_daily_digest_enabled,
      daily_digest_hour_utc: w.ai_daily_digest_hour_utc,
      encrypted: !!env.ENCRYPTION_KEY,
    }, 200, origin);
  }
  if (req.method === 'PATCH') {
    const w = await getWorkspace(env, ws);
    const setOrKeep = (key, current) => (key in body ? body[key] : current);
    // Explicit semantics: undefined = keep, "" = clear, string = set.
    // Key fields go through setOrKeepKey instead — same keep/clear
    // semantics, but a real new value gets encrypted before it's ever
    // written to D1.
    const setOrKeepKey = async (key, current) => {
      if (!(key in body)) return current;
      const v = body[key];
      return v ? await encryptSecret(env, v) : '';
    };
    const u = {
      ai_provider: isIn(body.provider, ['openai', 'nvidia', 'custom']) ? body.provider : w.ai_provider,
      ai_model: setOrKeep('model', w.ai_model) ?? '',
      ai_temperature: Math.max(0, Math.min(2, Number(body.temperature) || w.ai_temperature)),
      ai_max_tokens: Math.max(1, Math.min(8192, parseInt(body.max_tokens) || w.ai_max_tokens)),
      ai_system_prompt: setOrKeep('system_prompt', w.ai_system_prompt) ?? '',
      ai_custom_base_url: setOrKeep('custom_base_url', w.ai_custom_base_url) ?? '',
      ai_openai_key: await setOrKeepKey('openai_key', w.ai_openai_key),
      ai_nvidia_key: await setOrKeepKey('nvidia_key', w.ai_nvidia_key),
      ai_custom_key: await setOrKeepKey('custom_key', w.ai_custom_key),
      ai_nvidia_base_url: setOrKeep('nvidia_base_url', w.ai_nvidia_base_url) ?? '',
      ai_daily_call_cap: (() => {
        const raw = body.daily_call_cap !== undefined ? parseInt(body.daily_call_cap) : w.ai_daily_call_cap;
        return Number.isFinite(raw) ? Math.max(0, Math.min(100000, raw)) : w.ai_daily_call_cap;
      })(),
      ai_brand_voice: body.brand_voice !== undefined ? String(body.brand_voice || '').slice(0, 1000) : w.ai_brand_voice,
      ai_auto_score_new_contacts: body.auto_score_new_contacts !== undefined ? (body.auto_score_new_contacts ? 1 : 0) : w.ai_auto_score_new_contacts,
      ai_daily_digest_enabled: body.daily_digest_enabled !== undefined ? (body.daily_digest_enabled ? 1 : 0) : w.ai_daily_digest_enabled,
      ai_daily_digest_hour_utc: Math.max(0, Math.min(23, parseInt(body.daily_digest_hour_utc) || w.ai_daily_digest_hour_utc)),
    };
    await env.DB.prepare(
      `UPDATE workspaces SET ai_provider=?,ai_model=?,ai_temperature=?,ai_max_tokens=?,ai_system_prompt=?,ai_custom_base_url=?,
       ai_openai_key=?,ai_nvidia_key=?,ai_custom_key=?,ai_nvidia_base_url=?,ai_daily_call_cap=?,ai_brand_voice=?,ai_auto_score_new_contacts=?,ai_daily_digest_enabled=?,ai_daily_digest_hour_utc=?
       WHERE id=?`
    ).bind(u.ai_provider, u.ai_model, u.ai_temperature, u.ai_max_tokens, u.ai_system_prompt, u.ai_custom_base_url,
      u.ai_openai_key, u.ai_nvidia_key, u.ai_custom_key, u.ai_nvidia_base_url, u.ai_daily_call_cap, u.ai_brand_voice, u.ai_auto_score_new_contacts,
      u.ai_daily_digest_enabled, u.ai_daily_digest_hour_utc, ws).run();
    invalidateWorkspaceCache(ws);
    HEALTH_CACHE.delete(ws);
    return json({ ok: true }, 200, origin);
  }
  return err('Not found', 404, origin);
}

// ── AI: PROVIDER LAYER (retry + multi-provider fallback + tokens) ──
// ════════════════════════════════════════════════════════════
// HARDENED PROVIDER LAYER (V5)
//  * Circuit breaker: a provider that fails 3x consecutively is put in a
//    60s cooldown and skipped — a sick provider can't drag every request.
//  * Smart routing: providers are ordered by (cooldown, recent failures),
//    then by user preference.
//  * Retries: exponential backoff with jitter on retryable errors only.
//  * Error taxonomy: precise, actionable messages for every failure class
//    (bad key / out of credits / model missing / rate limited / overloaded
//    / timeout / network / malformed response).
//  * Response validation: the reply must be OpenAI-shaped JSON with a real
//    content string — anything else is a "malformed response" error.
//  * Payload guards: total size caps so a giant paste can't blow limits.
// ════════════════════════════════════════════════════════════
const PROVIDER_HEALTH = new Map(); // provider -> { fails, cooldownUntil, lastErr, ok, reqs, lastOkAt }
const CB_THRESHOLD = 3;            // consecutive failures before cooldown
const CB_COOLDOWN_MS = 60000;      // 60s cooldown
// Snapshot of live provider health (used by /ai/providers + Settings UI).
function providerHealthSnapshot() {
  const now = Date.now();
  const out = {};
  for (const p of ['nvidia', 'openai', 'custom']) {
    const h = PROVIDER_HEALTH.get(p);
    out[p] = {
      status: h ? (h.cooldownUntil && h.cooldownUntil > now ? 'cooldown' : (h.fails > 0 ? 'degraded' : 'ok')) : 'untested',
      fails: h?.fails || 0,
      requests: h?.reqs || 0,
      successes: h?.ok || 0,
      last_error: h?.lastErr || null,
      cooldown_until: h?.cooldownUntil ? new Date(h.cooldownUntil).toISOString() : null,
      last_ok_at: h?.lastOkAt ? new Date(h.lastOkAt).toISOString() : null,
    };
  }
  return out;
}
const AI_TIMEOUT_MS = 30000;       // non-stream per-attempt timeout
const AI_STREAM_FIRST_BYTE_MS = 45000;
const MAX_PAYLOAD_CHARS = 60000;   // hard cap on serialized messages

function hasKeyFor(w, provider) {
  if (provider === 'openai') return !!w.ai_openai_key;
  if (provider === 'nvidia') return !!w.ai_nvidia_key;
  if (provider === 'custom') {
    if (!w.ai_custom_base_url) return false;
    return w.ai_custom_base_url !== 'http://localhost:11434/v1' || !!w.ai_custom_key || w.ai_provider === 'custom';
  }
  return false;
}
async function providerRequest(env, w, provider) {
  let url, key, model;
  if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions'; key = await decryptSecret(env, w.ai_openai_key); model = w.ai_model || 'gpt-4o-mini';
  } else if (provider === 'nvidia') {
    // Custom NVIDIA base URL: self-hosted NIM / regional endpoints. Empty = free build.nvidia.com.
    const nbase = String(w.ai_nvidia_base_url || '').trim();
    url = nbase ? (nbase.replace(/\/$/, '') + '/chat/completions') : 'https://integrate.api.nvidia.com/v1/chat/completions';
    key = await decryptSecret(env, w.ai_nvidia_key); model = w.ai_model || 'nvidia/llama-3.1-nemotron-70b-instruct';
  } else if (provider === 'custom') {
    url = (w.ai_custom_base_url || 'http://localhost:11434/v1').replace(/\/$/, '') + '/chat/completions';
    key = w.ai_custom_key ? await decryptSecret(env, w.ai_custom_key) : ''; model = w.ai_model || 'llama3.1';
  } else return null;
  // Model fallback chain: "a,b,c" means try a, then b, then c on this provider.
  const models = String(model || '').split(',').map(m => m.trim()).filter(Boolean);
  return { url, key, models: models.length ? models : [model], provider };
}
// Providers in the order they should be tried: healthy ones first, then
// cooled-down ones, always ending with the user's own preference order.
function providerPriority(w) {
  const pref = [];
  if (isIn(w.ai_provider, ['openai', 'nvidia', 'custom']) && hasKeyFor(w, w.ai_provider)) pref.push(w.ai_provider);
  ['openai', 'nvidia', 'custom'].forEach(p => { if (p !== w.ai_provider && hasKeyFor(w, p)) pref.push(p); });
  const now = Date.now();
  const healthy = pref.filter(p => !isProviderCooledDown(p, now));
  const cooling = pref.filter(p => isProviderCooledDown(p, now));
  return healthy.concat(cooling);
}
function isProviderCooledDown(p, now) {
  const h = PROVIDER_HEALTH.get(p);
  return !!(h && h.cooldownUntil && h.cooldownUntil > now);
}
function recordProviderSuccess(p) {
  const h = PROVIDER_HEALTH.get(p) || { fails: 0 };
  h.fails = 0; h.cooldownUntil = null; h.lastErr = null; h.lastOkAt = Date.now();
  h.ok = (h.ok || 0) + 1; h.reqs = (h.reqs || 0) + 1;
  PROVIDER_HEALTH.set(p, h);
}
function recordProviderFailure(p, message) {
  const h = PROVIDER_HEALTH.get(p) || { fails: 0 };
  h.fails = (h.fails || 0) + 1;
  h.lastErr = message;
  h.reqs = (h.reqs || 0) + 1;
  if (h.fails >= CB_THRESHOLD) h.cooldownUntil = Date.now() + CB_COOLDOWN_MS;
  PROVIDER_HEALTH.set(p, h);
}
// Circuit-breaker hygiene: model/account problems are NOT provider-health
// problems. A retired model (404/410), a bad key (401/403) or an empty
// wallet (402) must never cool down the whole provider — the provider is
// fine, and every OTHER model/key on it must keep working.
function isProviderHealthIssue(e) {
  if (!(e instanceof ProviderError)) return true;
  return !['model_not_found', 'bad_key', 'no_credits'].includes(e.kind);
}
function buildMessages(w, messages) {
  let msgs = messages;
  if (w.ai_system_prompt) msgs = [{ role: 'system', content: w.ai_system_prompt }, ...messages.filter(m => m.role !== 'system')];
  return msgs;
}
function guardPayload(messages) {
  // Cap total payload size (defense against giant pastes blowing limits).
  // Multimodal content (arrays of text/image parts, e.g. vision requests)
  // is kept as-is — only the length is measured.
  let total = 0;
  const out = [];
  for (const m of messages) {
    const raw = m.content;
    const isParts = Array.isArray(raw);
    const content = isParts ? raw : String(raw == null ? '' : raw);
    const len = isParts ? JSON.stringify(raw).length : content.length;
    total += len;
    if (total > MAX_PAYLOAD_CHARS) break;
    if (isParts) {
      // truncate long text parts inside multimodal arrays
      const parts = raw.map(p => p && p.type === 'text' ? { ...p, text: String(p.text || '').slice(0, 8000) } : p);
      out.push({ role: m.role === 'system' ? 'system' : (m.role === 'assistant' ? 'assistant' : 'user'), content: parts });
    } else {
      out.push({ role: m.role === 'system' ? 'system' : (m.role === 'assistant' ? 'assistant' : 'user'), content: String(content).slice(0, 8000) });
    }
  }
  if (!out.length) out.push({ role: 'user', content: 'Hello' });
  return out;
}
function providerPortal(provider) {
  return provider === 'nvidia' ? 'build.nvidia.com (free credits)' : provider === 'openai' ? 'platform.openai.com' : 'your custom server';
}
// Validation errors caused by the USER's input — routes map these to 400
// (not 502), so "bad URL" doesn't look like a server outage.
class UserError extends Error { constructor(message) { super(message); this.name = 'UserError'; } }
class ProviderError extends Error {
  constructor(message, { kind = 'unknown', status, retryable, provider } = {}) {
    super(message);
    this.kind = kind;      // no_key | bad_key | no_credits | model_not_found | rate_limited | overloaded | timeout | network | malformed | unknown
    this.status = status;
    this.retryable = retryable;
    this.provider = provider;
  }
}
function classifyHttpError(status, body, provider) {
  // NVIDIA (and some others) answer RFC-7807 style: { type, title, status, detail }
  const raw = body?.error?.message || body?.message || body?.detail || '';
  const msg = String(raw).slice(0, 300);
  if (status === 401 || status === 403) {
    return new ProviderError(msg || `Invalid or unauthorized API key for ${provider} — check it in Settings → AI Providers (${providerPortal(provider)}).`, { kind: 'bad_key', status, provider });
  }
  if (status === 402) {
    return new ProviderError(msg || `${provider} says the account has no credits left — top up or grab free credits at ${providerPortal(provider)}.`, { kind: 'no_credits', status, provider });
  }
  if (status === 404) {
    return new ProviderError(msg || `Model not found on ${provider} — check the model name in Settings → AI Providers (e.g. nvidia/llama-3.1-nemotron-70b-instruct works on the NVIDIA free tier).`, { kind: 'model_not_found', status, provider });
  }
  if (status === 410) {
    // NVIDIA returns 410 "Gone" when a model reaches end-of-life — the key is fine,
    // the model itself is retired. Not retryable; the user must pick another model.
    return new ProviderError(msg || `That model has reached its end of life on ${provider} — pick a different model in Settings → AI Providers (e.g. nvidia/llama-3.1-nemotron-70b-instruct).`, { kind: 'model_not_found', status, provider });
  }
  if (status === 429) {
    let retryAfter = (body?.error?.headers?.retry_after) || '';
    const ra = parseInt(retryAfter);
    if (!Number.isFinite(ra)) retryAfter = '';
    const delay = ra > 0 ? Math.min(ra, 30) : 0;
    return new ProviderError(msg || `Rate limited by ${provider}${retryAfter ? ` (retry in ~${retryAfter}s)` : ''} — retrying on another provider.`, { kind: 'rate_limited', status, retryable: true, provider, retryAfterMs: delay * 1000 });
  }
  if (status >= 500) {
    return new ProviderError(msg || `${provider} is overloaded or having issues (HTTP ${status}) — retrying.`, { kind: 'overloaded', status, retryable: true, provider });
  }
  if (status === 400) {
    return new ProviderError(msg || `${provider} rejected the request (HTTP 400) — the model may not accept this message format; try a different model.`, { kind: 'unknown', status, provider });
  }
  return new ProviderError(msg || `Provider error ${status}`, { status, provider });
}
function parseProviderJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
function validateCompletion(d, provider) {
  const content = d?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new ProviderError(`${provider} returned an unexpected or empty response (no text content). Try again or switch models.`, { kind: 'malformed', provider });
  }
  const usage = d.usage || {};
  return {
    content,
    usage: { tokens_in: usage.prompt_tokens || usage.input_tokens || 0, tokens_out: usage.completion_tokens || 0 },
  };
}
async function callProviderOnce(env, w, provider, messages, opts) {
  const req = await providerRequest(env, w, provider);
  if (!req) throw new ProviderError(`No key configured for ${provider}`, { kind: 'no_key', provider });
  const models = req.models || [req.model];
  let lastModelErr = null;
  // Try each model in the fallback chain; only model-level failures (404 /
  // 400 / malformed) fall through to the next model, other errors propagate.
  for (const model of models) {
    try {
      const body = {
        model,
        messages: guardPayload(buildMessages(w, messages)),
        temperature: Math.max(0, Math.min(2, opts?.temperature ?? w.ai_temperature ?? 0.7)),
        max_tokens: Math.max(1, Math.min(8192, opts?.max_tokens ?? w.ai_max_tokens ?? 1024)),
      };
      if (opts?.json_mode) body.response_format = { type: 'json_object' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts?.timeoutMs || AI_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(req.url, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(req.key ? { Authorization: `Bearer ${req.key}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch (e) {
    clearTimeout(t);
    const timeout = e.name === 'AbortError';
    throw new ProviderError(
      timeout ? `${provider} timed out after ${Math.round((opts?.timeoutMs || AI_TIMEOUT_MS) / 1000)}s — try again or switch models.` : `Could not reach ${provider}: ${e.message}`,
      { kind: timeout ? 'timeout' : 'network', retryable: true, provider }
    );
  }
  clearTimeout(t);
  if (!r.ok) {
    const b = parseProviderJson(await r.text().catch(() => ''));
    const e = classifyHttpError(r.status, b, provider);
    if (!e.retryable && isProviderHealthIssue(e)) recordProviderFailure(provider, e.message);
    throw e;
  }
  const d = parseProviderJson(await r.text().catch(() => ''));
  if (!d) {
    recordProviderFailure(provider, 'malformed JSON response');
    throw new ProviderError(`${provider} sent an unreadable response — try again or switch models.`, { kind: 'malformed', retryable: true, provider });
  }
    let result;
    try { result = validateCompletion(d, provider); }
    catch (e) {
      // malformed from THIS model — try the next one in the chain
      lastModelErr = e;
      recordProviderFailure(provider, e.message);
      continue;
    }
    recordProviderSuccess(provider);
    return { ...result, provider, model };
      } catch (e) {
        // only model-level errors advance the chain
        if (e instanceof ProviderError && (e.kind === 'model_not_found' || e.kind === 'unknown' || e.kind === 'malformed')) {
          lastModelErr = e;
          if (isProviderHealthIssue(e)) recordProviderFailure(provider, e.message);
          continue;
        }
        throw e;
      }
  }
  throw lastModelErr || new ProviderError(`All models failed on ${provider}`, { kind: 'unknown', provider });
}
// Non-streaming call: circuit-breaker aware, exponential backoff + jitter.
async function callProvider(env, w, messages, opts) {
  const list = providerPriority(w);
  if (!list.length) throw new ProviderError('No AI provider configured — add a free NVIDIA NIM key in Settings → AI Providers (build.nvidia.com).', { kind: 'no_key' });
  const errs = [];
  const attempted = new Set();
  for (const p of list) {
    if (attempted.has(p)) continue;
    attempted.add(p);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callProviderOnce(env, w, p, messages, opts);
      } catch (e) {
        errs.push(`${p}: ${e.message}`);
        if (e instanceof ProviderError && !e.retryable) { if (isProviderHealthIssue(e)) recordProviderFailure(p, e.message); break; }
        // Account/model errors: stop retrying THIS provider, but never cool it
        // down globally — PROVIDER_HEALTH is shared across workspaces.
        if (e instanceof ProviderError && (e.kind === 'bad_key' || e.kind === 'no_credits' || e.kind === 'model_not_found')) { break; }
        // retryable: exponential backoff with jitter, or respect Retry-After
        const raMs = (e instanceof ProviderError && e.retryAfterMs) || 0;
        if (raMs) await sleep(raMs);
        else if (attempt === 0) await sleep(300 + Math.random() * 250);
        else await sleep(600 + Math.random() * 400);
      }
    }
  }
  throw new Error('All AI providers failed — ' + [...new Set(errs)].join(' | '));
}
// Streaming: same routing + circuit breaker; errors before the first byte
// fall through to the next provider.
async function openProviderStream(env, w, messages, opts) {
  const list = providerPriority(w);
  if (!list.length) throw new ProviderError('No AI provider configured — add a free NVIDIA NIM key in Settings → AI Providers (build.nvidia.com).', { kind: 'no_key' });
  const errs = [];
  const attempted = new Set();
  for (const p of list) {
    if (attempted.has(p)) continue;
    attempted.add(p);
    const req = await providerRequest(env, w, p);
    for (const model of (req.models || [req.model])) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), opts?.timeoutMs || AI_STREAM_FIRST_BYTE_MS);
      let r;
      try {
        r = await fetch(req.url, {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', ...(req.key ? { Authorization: `Bearer ${req.key}` } : {}) },
          body: JSON.stringify({ model, messages: guardPayload(buildMessages(w, messages)), temperature: opts?.temperature ?? w.ai_temperature ?? 0.7, max_tokens: Math.max(1, Math.min(8192, opts?.max_tokens ?? w.ai_max_tokens ?? 1024)), stream: true }),
        });
      } catch (e) {
        clearTimeout(t);
        errs.push(`${p}/${model}: ${e.name === 'AbortError' ? 'timed out' : e.message}`);
        recordProviderFailure(p, e.name === 'AbortError' ? 'stream timeout' : e.message);
        continue;
      }
      clearTimeout(t);
      if (!r.ok || !r.body) {
        const b = parseProviderJson(await r.text().catch(() => ''));
        const e = classifyHttpError(r.status, b, p);
        errs.push(`${p}/${model}: ${e.message}`);
        if (e.kind === 'model_not_found' || e.kind === 'unknown') { if (isProviderHealthIssue(e)) recordProviderFailure(p, e.message); continue; } // try next model
        if (e.kind !== 'rate_limited' && e.kind !== 'overloaded' && e.kind !== 'timeout' && e.kind !== 'network' && isProviderHealthIssue(e)) recordProviderFailure(p, e.message);
        break; // provider-level error → next provider
      }
      recordProviderSuccess(p);
      return { res: r, provider: p, model };
    }
  }
  throw new Error('All AI providers failed to stream — ' + [...new Set(errs)].join(' | '));
}



// ── AI: CAP + USAGE ──────────────────────────────────────────
async function withinDailyCap(env, ws, cap) {
  // 0 (or negative) = unlimited — the default for solo users on free models.
  if (!cap || cap <= 0) return true;
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const row = await env.DB.prepare(
    'SELECT COUNT(*) n FROM ai_usage_log WHERE workspace_id=? AND created_at >= ?'
  ).bind(ws, cutoff).first();
  return row.n < cap;
}
async function trackAIUsage(env, ws, op, provider, tokens) {
  await env.DB.prepare('INSERT INTO ai_usage_log (workspace_id, op, provider, tokens_in, tokens_out) VALUES (?,?,?,?,?)')
    .bind(ws, op, provider || '', tokens?.tokens_in || 0, tokens?.tokens_out || 0).run();
}
async function aiUsage(env, ws) {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [total, today, conv, msgs, todayTokens, byOp] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) n FROM ai_usage_log WHERE workspace_id=?').bind(ws).first(),
    env.DB.prepare('SELECT COUNT(*) n FROM ai_usage_log WHERE workspace_id=? AND created_at >= ?').bind(ws, cutoff).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM ai_usage_log WHERE workspace_id=? AND op='chat'`).bind(ws).first(),
    env.DB.prepare('SELECT COUNT(*) n FROM messages WHERE workspace_id=?').bind(ws).first(),
    env.DB.prepare('SELECT COALESCE(SUM(tokens_in+tokens_out),0) n FROM ai_usage_log WHERE workspace_id=? AND created_at >= ?').bind(ws, cutoff).first(),
    env.DB.prepare('SELECT op, COUNT(*) n FROM ai_usage_log WHERE workspace_id=? AND created_at >= ? GROUP BY op ORDER BY n DESC').bind(ws, cutoff).all(),
  ]);
  return {
    total: total.n, today: today.n, conversations: conv.n, messages: msgs.n,
    tokens_today: todayTokens.n,
    by_op: byOp.results.map(r => ({ op: r.op, count: r.n })),
  };
}

// ── AI: WORKSPACE CONTEXT (makes chat data-aware) ────────────
async function workspaceContextSummary(env, ws) {
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
}

// ── AI: GENERATION PROMPTS (expanded ~3x coverage) ───────────
const GEN_PROMPTS = {
  email: (ctx, tone, target) => `Write a professional ${tone || 'business'} email about: ${ctx}. Include a subject line. Keep it under 250 words.`,
  cold_email: (ctx, tone, target) => `Write a short, high-converting cold outreach email${target ? ' to ' + target : ''} about: ${ctx}. Subject line + under 120 words, one clear call to action, no fluff.`,
  followup_email: (ctx, tone, target) => `Write a polite, short follow-up email${target ? ' to ' + target : ''} about: ${ctx}. Reference the previous conversation naturally, add value, keep it under 100 words, end with a soft call to action.`,
  whatsapp: (ctx, tone, target) => `Write a short, friendly WhatsApp message${target ? ' to ' + target : ''} about: ${ctx}. Keep it under 300 characters, conversational, 1-2 emoji max.`,
  sms: (ctx) => `Write a short SMS (under 160 characters) about: ${ctx}`,
  social_linkedin: (ctx, tone) => `Write a LinkedIn post about: ${ctx}. Tone: ${tone || 'professional'}. Start with a hook line, keep it under 300 words, end with a light question or CTA. No hashtags overload (max 3).`,
  social_twitter: (ctx) => `Write a tweet (under 280 characters) about: ${ctx}. Include 1-2 relevant hashtags.`,
  social_instagram: (ctx, tone) => `Write an Instagram caption${tone ? ' in a ' + tone + ' tone' : ''} about: ${ctx}. 3-6 relevant hashtags, under 150 words, engaging first line.`,
  social_facebook: (ctx, tone) => `Write a Facebook post about: ${ctx}. Tone: ${tone || 'friendly'}. Conversational, under 200 words, end with a question to drive comments.`,
  social_youtube: (ctx) => `Write a YouTube video description + 5 tags about: ${ctx}. Include a hook sentence, timestamps placeholder, and a CTA to subscribe.`,
  blog: (ctx, tone) => `Write a blog post about: ${ctx}. Tone: ${tone || 'professional'}. Include an H1-style title, intro hook, 4-6 H2 sections with practical substance, and a conclusion with a call to action. 600-900 words.`,
  blog_outline: (ctx) => `Create a detailed blog post outline for: ${ctx}. Title + 6-8 sections with 2-3 bullet points each and a suggested keyword for each section.`,
  ad_copy: (ctx) => `Write 3 ad copy variations for: ${ctx}. For each: Headline, Primary text, CTA. Different angles (benefit, urgency, social proof).`,
  landing_page: (ctx) => `Write complete landing page copy for: ${ctx}. Hero headline + subheadline, 3 benefit sections with bullets, social proof block, FAQ (4 questions), and final CTA section.`,
  product_description: (ctx) => `Write a compelling product description for: ${ctx}. Feature → benefit style, 3 short paragraphs, bullet list of key features, and a closing CTA sentence.`,
  proposal: (ctx) => `Write a professional business proposal for: ${ctx}. Include: Executive summary, scope, deliverables, timeline, investment, and next steps.`,
  review_reply: (ctx, tone) => `Write a warm, professional reply to this review: ${ctx}. Tone: ${tone || 'grateful'}. If the review is negative, apologize sincerely, take ownership, and invite the customer to reach out directly. Under 100 words.`,
  press_release: (ctx) => `Write a professional press release about: ${ctx}. Headline, dateline, 4-5 paragraphs (announcement, details, quote, about), and boilerplate.`,
  meeting_agenda: (ctx) => `Create a focused meeting agenda for: ${ctx}. Objective, attendees suggestion, 15-30 min schedule with timeboxes, and expected outcomes.`,
  job_description: (ctx) => `Write a complete job description for: ${ctx}. Title, role summary, 5-6 responsibilities, 5-6 requirements, nice-to-haves, and about-the-company paragraph.`,
  hashtags: (ctx) => `Generate 15 relevant, high-traffic hashtags for: ${ctx}. Mix of broad and niche. Return only the hashtags, comma-separated.`,
  email_sequence: (ctx) => `Create a ${'5'}-email nurture sequence for: ${ctx}. For each email: Subject line, send timing (Day X), and full body under 120 words. Separate emails with ---.`,
};

// ── AI: OPS ──────────────────────────────────────────────────
async function contactContext(env, ws, contactId) {
  if (!contactId) return '';
  const c = await env.DB.prepare('SELECT * FROM contacts WHERE id=? AND workspace_id=?').bind(contactId, ws).first();
  if (!c) return '';
  const { results: recent } = await env.DB.prepare(
    'SELECT channel, body, created_at FROM messages WHERE contact_id=? AND workspace_id=? ORDER BY created_at DESC LIMIT 3'
  ).bind(contactId, ws).all();
  let s = `Contact: ${c.name}, stage: ${c.stage}, company: ${c.company || 'n/a'}.`;
  if (c.notes) s += ` Notes: ${c.notes}.`;
  if (recent.length) s += ` Recent messages: ${recent.map(m => `[${m.channel}] ${m.body}`.slice(0, 200)).join(' | ')}`;
  return s;
}
async function aiOpGenerate(env, ws, body) {
  const { type, context, tone, target, contact_id } = body;
  const w = await getWorkspace(env, ws);
  if (!(await withinDailyCap(env, ws, w.ai_daily_call_cap))) throw new Error(`Daily AI call cap (${w.ai_daily_call_cap}) reached for this workspace — raise it in Settings → AI Providers if needed.`);
  const extraContext = contact_id ? await contactContext(env, ws, contact_id) : '';
  const promptFn = GEN_PROMPTS[type] || GEN_PROMPTS.email;
  const prompt = promptFn(context || 'a business update', tone, target) + (extraContext ? `\n\nContext about the recipient (use naturally, don't just repeat it): ${extraContext}` : '');
  const voice = String(w.ai_brand_voice || '').trim();
  const userMsg = voice ? `Write in this brand voice: ${voice}\n\n${prompt}` : prompt;
  const r = await callProvider(env, w, [{ role: 'user', content: userMsg }], { max_tokens: 1200 });
  await trackAIUsage(env, ws, 'generate', r.provider, r.usage);
  return { content: r.content, live: true, provider: r.provider, model: r.model };
}
async function aiOpComplete(env, ws, prompt, opts) {
  if (!String(prompt || '').trim()) throw new UserError('A prompt is required — tell the AI what to write.');
  const w = await getWorkspace(env, ws);
  if (!(await withinDailyCap(env, ws, w.ai_daily_call_cap))) throw new Error(`Daily AI call cap (${w.ai_daily_call_cap}) reached for this workspace — raise it in Settings → AI Providers if needed.`);
  let messages = [{ role: 'user', content: String(prompt || '').slice(0, 8000) }];
  const voice = String(w.ai_brand_voice || '').trim();
  if (opts?.include_context !== false) {
    const summary = await workspaceContextSummary(env, ws);
    messages.unshift({ role: 'system', content: `You are NexusCRM AI, an expert business assistant. Be concise, specific and actionable.${voice ? ' Match the brand voice: ' + voice : ''} ${summary}` });
  } else if (voice) {
    messages.unshift({ role: 'system', content: `Match the brand voice: ${voice}` });
  }
  const r = await callProvider(env, w, messages, opts);
  await trackAIUsage(env, ws, 'complete', r.provider, r.usage);
  return { content: r.content, live: true, provider: r.provider, model: r.model };
}
const REWRITE_MODES = {
  improve: 'Rewrite this to be clearer, more professional and more persuasive. Keep the same meaning and length.',
  shorten: 'Rewrite this to be much shorter — cut at least 40% while keeping every key point.',
  expand: 'Expand this with more useful detail, examples and a stronger closing. Keep the same core message.',
  professional: 'Rewrite this in a polished professional business tone.',
  friendly: 'Rewrite this in a warm, friendly, conversational tone.',
  persuasive: 'Rewrite this to be more persuasive and action-oriented, with a clear call to action.',
  simpler: 'Rewrite this in plain simple language a 12-year-old could understand. Keep all key information.',
  bullets: 'Rewrite this as clean bullet points with short bold lead-ins.',
};
async function aiOpRewrite(env, ws, body) {
  const { text, mode } = body;
  if (!text || !String(text).trim()) throw new Error('Text is required');
  const w = await getWorkspace(env, ws);
  if (!(await withinDailyCap(env, ws, w.ai_daily_call_cap))) throw new Error(`Daily AI call cap (${w.ai_daily_call_cap}) reached for this workspace.`);
  const instruction = REWRITE_MODES[mode] || REWRITE_MODES.improve;
  const r = await callProvider(env, w, [{ role: 'user', content: `${instruction}\n\nTEXT:\n${String(text).slice(0, 6000)}` }], { max_tokens: 2000 });
  await trackAIUsage(env, ws, 'rewrite', r.provider, r.usage);
  return { content: r.content, live: true, provider: r.provider, model: r.model };
}
async function aiOpSentiment(env, ws, text) {
  const w = await getWorkspace(env, ws);
  if (!(await withinDailyCap(env, ws, w.ai_daily_call_cap))) throw new Error(`Daily AI call cap (${w.ai_daily_call_cap}) reached for this workspace.`);
  const r = await callProvider(env, w, [{
    role: 'user',
    content: `Analyze the sentiment of this text. Respond ONLY with JSON: {"sentiment":"positive|negative|neutral","confidence":0-100,"tone":"one short phrase"}. Text: "${String(text || '').slice(0, 2000)}"`,
  }], { max_tokens: 80 });
  await trackAIUsage(env, ws, 'sentiment', r.provider, r.usage);
  try {
    const j = JSON.parse(r.content.match(/\{[\s\S]*\}/)?.[0] || '{}');
    return { sentiment: ['positive', 'negative', 'neutral'].includes(j.sentiment) ? j.sentiment : 'neutral', confidence: Math.max(0, Math.min(100, parseInt(j.confidence) || 50)), tone: j.tone || '' };
  } catch {
    return { sentiment: 'neutral', confidence: 50, tone: '' };
  }
}
async function aiOpScoreLead(env, ws, contactId) {
  const c = await env.DB.prepare('SELECT * FROM contacts WHERE id=? AND workspace_id=?').bind(contactId, ws).first();
  if (!c) throw new Error('Contact not found');
  const w = await getWorkspace(env, ws);
  if (!(await withinDailyCap(env, ws, w.ai_daily_call_cap))) throw new Error(`Daily AI call cap (${w.ai_daily_call_cap}) reached for this workspace.`);
  const r = await callProvider(env, w, [{
    role: 'user',
    content: `Score this sales lead from 0-100 (how likely to close) and give a one-sentence reason. Lead: stage=${c.stage}, has_email=${!!c.email}, has_phone=${!!c.phone}, notes="${String(c.notes || '').slice(0, 400)}". Respond ONLY with JSON: {"score": 0-100, "reason": "..."}`,
  }], { max_tokens: 120 });
  await trackAIUsage(env, ws, 'score', r.provider, r.usage);
  let score = 50, reason = '';
  try {
    const j = JSON.parse(r.content.match(/\{[\s\S]*\}/)?.[0] || '{}');
    score = Math.max(0, Math.min(100, parseInt(j.score) || 50));
    reason = String(j.reason || '').slice(0, 300);
  } catch {
    const m = r.content.match(/^(\d{1,3})[,\s-]+(.*)/s) || r.content.match(/\b(\d{1,3})\b[\s\S]*?\n?(.*)/);
    score = Math.max(0, Math.min(100, m ? parseInt(m[1]) : 50));
    reason = (m ? m[2].trim() : r.content.trim()).slice(0, 300);
  }
  await env.DB.prepare('UPDATE contacts SET ai_score=?, ai_score_reason=?, updated_at=? WHERE id=? AND workspace_id=?')
    .bind(score, reason, nowISO(), contactId, ws).run();
  return { score, reason, provider: r.provider };
}
async function aiOpBuildWorkflow(env, ws, goal) {
  const w = await getWorkspace(env, ws);
  if (!(await withinDailyCap(env, ws, w.ai_daily_call_cap))) throw new Error(`Daily AI call cap (${w.ai_daily_call_cap}) reached for this workspace.`);
  const r = await callProvider(env, w, [{
    role: 'user',
    content: `Design a CRM automation workflow for this goal: "${String(goal || '').slice(0, 800)}". Respond ONLY with JSON: {"name":"...","trigger":"new_contact|deal_stage_change|appointment_booked|invoice_paid|form_submitted|manual","steps":[{"action":"send_email|send_whatsapp|create_task|update_stage","note":"...","delay_hours":0}]}. Important: "send_whatsapp" cannot be auto-sent by any server (no public API) — instead use create_task with a note telling a human to send it. Keep 1-4 steps.`,
  }], { max_tokens: 600 });
  await trackAIUsage(env, ws, 'build-workflow', r.provider, r.usage);
  try {
    const wf = JSON.parse(r.content.match(/\{[\s\S]*\}/)?.[0] || '{}');
    if (!wf.steps || !Array.isArray(wf.steps) || !wf.steps.length) throw new Error('no steps');
    return {
      name: String(wf.name || '').slice(0, 120) || String(goal || '').slice(0, 48) || 'New Workflow',
      trigger: isIn(wf.trigger, WORKFLOW_TRIGGERS) ? wf.trigger : 'manual',
      steps: sanitizeWorkflowSteps(wf.steps),
      live: true,
    };
  } catch {
    return {
      name: String(goal || '').slice(0, 48) || 'New Workflow',
      trigger: 'manual',
      steps: [{ action: 'create_task', note: 'Review and follow up', delay_hours: 0 }],
      live: false,
    };
  }
}
async function aiInsightsDashboard(env, ws) {
  const stats = await computeStats(env, ws);
  const insights = [];
  if (stats.pending_tasks > 0) insights.push({ icon: '✅', title: `${stats.pending_tasks} open task${stats.pending_tasks === 1 ? '' : 's'}`, text: 'Keep momentum on active follow-ups.' });
  if (stats.open_deals > 0) insights.push({ icon: '💰', title: `${'$' + stats.pipeline_value.toLocaleString()} in open pipeline`, text: `Across ${stats.open_deals} active deal${stats.open_deals === 1 ? '' : 's'}.` });
  const { results: hot } = await env.DB.prepare('SELECT name, ai_score FROM contacts WHERE workspace_id=? AND ai_score > 0 ORDER BY ai_score DESC LIMIT 3').bind(ws).all();
  if (hot.length) insights.push({ icon: '🔥', title: 'Hottest leads', text: hot.map(c => `${c.name} (${c.ai_score})`).join(', ') });
  const { results: overdue } = await env.DB.prepare(`SELECT COUNT(*) n FROM tasks WHERE workspace_id=? AND status='todo' AND due_date != '' AND due_date < date('now')`).bind(ws).first();
  if (overdue.n > 0) insights.push({ icon: '⏰', title: `${overdue.n} overdue task${overdue.n === 1 ? '' : 's'}`, text: 'Consider bumping these or reassigning them.' });
  if (!insights.length) insights.push({ icon: '✅', title: 'All clear', text: 'No urgent items right now — nice work staying on top of things.' });
  return insights;
}
const HEALTH_CACHE = new Map();
async function aiHealth(env, ws) {
  const cached = HEALTH_CACHE.get(ws);
  if (cached && (Date.now() - cached.ts) < 30000) return cached.data;
  const w = await getWorkspace(env, ws);
  const [openai, nvidia, custom] = await Promise.all([pingProvider(env, 'openai', w), pingProvider(env, 'nvidia', w), pingProvider(env, 'custom', w)]);
  const data = { openai, nvidia, custom };
  HEALTH_CACHE.set(ws, { data, ts: Date.now() });
  return data;
}
async function pingProvider(env, provider, w) {
  const testW = { ...w, ai_provider: provider };
  // Health tests must use a model that ACTUALLY EXISTS on the tested
  // provider. The workspace's current model may belong to another provider
  // (e.g. gpt-4o-mini selected while testing NVIDIA) — using it would fail
  // with a false "model not found" even when the key is perfectly valid.
  const cur = String(w.ai_model || '');
  const looksNvidia = /^[a-z0-9_-]+\/[a-z0-9._-]+$/i.test(cur); // "meta/llama-..." style
  if (provider === 'nvidia') testW.ai_model = looksNvidia ? cur : 'nvidia/llama-3.1-nemotron-70b-instruct';
  if (provider === 'openai') testW.ai_model = looksNvidia ? 'gpt-4o-mini' : (cur || 'gpt-4o-mini');
  if (provider === 'custom') testW.ai_model = cur || 'llama3.1';
  const req = await providerRequest(env, testW, provider);
  if (!req || !hasKeyFor(w, provider)) return { status: 'no_key' };
  const t0 = Date.now();
  try {
    const r = await callProviderOnce(env, testW, provider, [{ role: 'user', content: 'Reply with the single word: ok' }], { max_tokens: 5 });
    return { status: 'ok', model: r.model, ms: Date.now() - t0 };
  } catch (e) { return { status: 'error', message: e.message, kind: e.kind || 'unknown', ms: Date.now() - t0 }; }
}

// ── EMAIL (real sending via Resend) ──────────────────────────
async function handleEmailSettings(env, req, auth, body, origin) {
  const ws = auth.workspaceId;
  if (req.method === 'GET') {
    const w = await getWorkspace(env, ws);
    return json({ resend_key_set: !!w.resend_api_key, from_email: w.resend_from_email, from_name: w.resend_from_name, encrypted: !!env.ENCRYPTION_KEY }, 200, origin);
  }
  if (req.method === 'PATCH') {
    const w = await getWorkspace(env, ws);
    const newKey = 'resend_key' in body ? (body.resend_key ? await encryptSecret(env, body.resend_key) : '') : w.resend_api_key;
    await env.DB.prepare('UPDATE workspaces SET resend_api_key=?, resend_from_email=?, resend_from_name=? WHERE id=?')
      .bind(newKey, body.from_email ?? w.resend_from_email, body.from_name ?? w.resend_from_name, ws).run();
    invalidateWorkspaceCache(ws);
    return json({ ok: true }, 200, origin);
  }
  return err('Not found', 404, origin);
}
async function sendEmailViaResend(env, w, { to, subject, body, html }) {
  if (!isValidEmail(to)) throw new Error(`"${to}" is not a valid recipient email address.`);
  if (!w.resend_api_key) throw new Error('No email provider configured — add a free Resend API key in Settings → Email to send real emails (resend.com, free tier is generous).');
  if (!w.resend_from_email) throw new Error('Add a "From" email in Settings → Email first (must be a domain you\'ve verified with Resend, or their onboarding@resend.dev for testing).');
  const key = await decryptSecret(env, w.resend_api_key);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: `${w.resend_from_name || 'NexusCRM'} <${w.resend_from_email}>`,
      to: [to],
      subject: String(subject || '(no subject)').slice(0, 300),
      html: html || `<pre style="font-family:inherit;white-space:pre-wrap">${String(body || '').replace(/</g, '&lt;')}</pre>`,
    }),
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || `Resend error ${r.status}`); }
  return r.json();
}
async function handleEmailSend(env, req, auth, body, origin) {
  const ws = auth.workspaceId;
  const w = await getWorkspace(env, ws);
  if (!body.to) return err('Recipient (to) is required', 400, origin);
  const result = await sendEmailViaResend(env, w, body);
  await env.DB.prepare('INSERT INTO messages (workspace_id,contact_id,channel,subject,body,direction) VALUES (?,?,?,?,?,?)')
    .bind(ws, body.contact_id || null, 'email', body.subject || '', body.body || '', 'outbound').run();
  return json({ ok: true, sent: true, id: result.id }, 200, origin);
}

// ── WORKFLOW EXECUTION ENGINE ────────────────────────────────
async function executeStep(env, ws, step, contact, eventPayload) {
  const action = step.action;
  if (action === 'create_task') {
    await env.DB.prepare("INSERT INTO tasks (workspace_id,contact_id,title,description,priority,status) VALUES (?,?,?,?,'medium','todo')")
      .bind(ws, contact?.id || null, step.note || 'Follow up', `Auto-created by workflow${contact ? ' for ' + contact.name : ''}.`).run();
    return { ok: true };
  }
  if (action === 'update_stage' && contact) {
    const stage = isIn(step.stage, CONTACT_STAGES) ? step.stage : 'qualified';
    await env.DB.prepare('UPDATE contacts SET stage=?, updated_at=? WHERE id=? AND workspace_id=?')
      .bind(stage, nowISO(), contact.id, ws).run();
    return { ok: true };
  }
  if (action === 'send_email' && contact?.email) {
    const w = await getWorkspace(env, ws);
    try {
      let content = step.note || 'Following up';
      // Use AI only if the cap allows and a provider is configured.
      if (providerPriority(w).length && (await withinDailyCap(env, ws, w.ai_daily_call_cap))) {
        try {
          const r = await callProvider(env, w, [{ role: 'user', content: `Write a short, friendly follow-up email to ${contact.name}. Context: ${step.note || 'automated follow-up'}.` }], { max_tokens: 300 });
          content = r.content;
          await trackAIUsage(env, ws, 'workflow-email', r.provider, r.usage);
        } catch { /* fall back to the plain note */ }
      }
      await sendEmailViaResend(env, w, { to: contact.email, subject: String(step.note || 'Following up').slice(0, 60), body: content });
      await env.DB.prepare("INSERT INTO messages (workspace_id,contact_id,channel,subject,body,direction,ai_generated) VALUES (?,?,?,?,?,'outbound',1)")
        .bind(ws, contact.id, 'email', String(step.note || 'Following up').slice(0, 60), content).run();
      return { ok: true };
    } catch (e) {
      await env.DB.prepare("INSERT INTO tasks (workspace_id,contact_id,title,description,priority,status) VALUES (?,?,?,?,'high','todo')")
        .bind(ws, contact.id, `⚠️ Automated email failed — send manually`, `Workflow tried to email ${contact.name} but: ${e.message}`).run();
      return { ok: false, error: e.message };
    }
  }
  if (action === 'send_review_request' && contact?.email) {
    const w = await getWorkspace(env, ws);
    try {
      let content = step.note || 'Thank you for choosing us! We would love your feedback. Could you take a minute to leave us a review? Here is the link: [YOUR REVIEW LINK]';
      if (providerPriority(w).length && (await withinDailyCap(env, ws, w.ai_daily_call_cap))) {
        try {
          const r = await callProvider(env, w, [{ role: 'user', content: `Write a short, warm email (under 90 words) asking ${contact.name} for a Google review after a completed service. Context: ${step.note || 'recently completed service'}. Mention that a review helps our small business.` }], { max_tokens: 200 });
          content = r.content;
          await trackAIUsage(env, ws, 'review-request', r.provider, r.usage);
        } catch { /* keep template */ }
      }
      await sendEmailViaResend(env, w, { to: contact.email, subject: 'We would love your feedback ⭐', body: content });
      await env.DB.prepare("INSERT INTO messages (workspace_id,contact_id,channel,subject,body,direction,ai_generated) VALUES (?,?,?,?,?,'outbound',1)")
        .bind(ws, contact.id, 'email', 'We would love your feedback ⭐', content).run();
      return { ok: true };
    } catch (e) {
      await env.DB.prepare("INSERT INTO tasks (workspace_id,contact_id,title,description,priority,status) VALUES (?,?,?,?,'high','todo')")
        .bind(ws, contact.id, `⭐ Send review request to ${contact.name}`, `Workflow tried to email a review request but: ${e.message}`).run();
      return { ok: false, error: e.message };
    }
  }
  if (action === 'send_whatsapp') {
    await env.DB.prepare("INSERT INTO tasks (workspace_id,contact_id,title,description,priority,status) VALUES (?,?,?,?,'medium','todo')")
      .bind(ws, contact?.id || null, `💚 Send WhatsApp${contact ? ' to ' + contact.name : ''}`, step.note || 'Automated workflow step — WhatsApp cannot be auto-sent, open the WhatsApp tab to send this.').run();
    return { ok: true, manual: true };
  }
  return { ok: false, error: 'unknown_action' };
}

// Executes a list of steps; any step with a delay re-queues itself AND the
// remaining steps as a delayed event (so nothing after it is ever dropped).
async function executeSteps(env, ws, steps, contact, eventPayload, wfId) {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.delay_hours) {
      const remaining = steps.slice(i + 1);
      await env.DB.prepare('INSERT INTO events (workspace_id,type,contact_id,payload,fire_at) VALUES (?,?,?,?,?)')
        .bind(ws, `__delayed_step__${wfId || 'wf'}`, contact?.id || null,
          JSON.stringify({ step, remaining, payload: eventPayload || {} }),
          new Date(Date.now() + step.delay_hours * 3600 * 1000).toISOString()).run();
      return; // the rest of the steps run when the delayed event fires
    }
    await executeStep(env, ws, step, contact, eventPayload);
  }
}

async function processEvent(env, eventId) {
  const ev = await env.DB.prepare('SELECT * FROM events WHERE id=?').bind(eventId).first();
  if (!ev || ev.processed) return;
  const isDelayed = ev.type.startsWith('__delayed_step__');

  if (isDelayed) {
    const payload = JSON.parse(ev.payload || '{}');
    let contact = null;
    if (ev.contact_id) contact = await env.DB.prepare('SELECT * FROM contacts WHERE id=?').bind(ev.contact_id).first();
    if (payload.step) await executeStep(env, ev.workspace_id, payload.step, contact, payload.payload || {});
    if (Array.isArray(payload.remaining) && payload.remaining.length) {
      await executeSteps(env, ev.workspace_id, payload.remaining, contact, payload.payload || {}, ev.type.split('__delayed_step__')[1]);
    }
    await env.DB.prepare('UPDATE events SET processed=1 WHERE id=?').bind(eventId).run();
    return;
  }

  const { results: workflows } = await env.DB.prepare(
    `SELECT * FROM workflows WHERE workspace_id=? AND trigger=? AND status='active'`
  ).bind(ev.workspace_id, ev.type).all();

  let contact = null;
  if (ev.contact_id) contact = await env.DB.prepare('SELECT * FROM contacts WHERE id=?').bind(ev.contact_id).first();

  // Auto lead-scoring — an opt-in workspace setting.
  if (ev.type === 'new_contact' && contact) {
    const w = await getWorkspace(env, ev.workspace_id);
    if (w.ai_auto_score_new_contacts && (await withinDailyCap(env, ev.workspace_id, w.ai_daily_call_cap))) {
      await aiOpScoreLead(env, ev.workspace_id, contact.id).catch(e => console.error('auto-score failed', e));
    }
  }

  for (const wf of workflows) {
    const steps = JSON.parse(wf.steps || '[]');
    try {
      await executeSteps(env, ev.workspace_id, steps, contact, JSON.parse(ev.payload || '{}'), wf.id);
      await env.DB.prepare('UPDATE workflows SET run_count=run_count+1, last_run=? WHERE id=?').bind(nowISO(), wf.id).run();
      await env.DB.prepare('INSERT INTO workflow_runs (workflow_id, workspace_id, event_type, status, detail) VALUES (?,?,?,?,?)')
        .bind(wf.id, ev.workspace_id, ev.type, 'ok', `fired by ${ev.type}${contact ? ' for ' + contact.name : ''}`).run();
    } catch (e) {
      await env.DB.prepare('INSERT INTO workflow_runs (workflow_id, workspace_id, event_type, status, detail) VALUES (?,?,?,?,?)')
        .bind(wf.id, ev.workspace_id, ev.type, 'error', String(e.message || 'unknown').slice(0, 500)).run();
    }
  }

  await env.DB.prepare('UPDATE events SET processed=1 WHERE id=?').bind(eventId).run();
}

// Cron safety-net sweep — catches delayed steps whose time has come, any
// event that didn't get processed inline, plus routine cleanup.
async function sweepEvents(env) {
  const { results } = await env.DB.prepare(
    'SELECT id FROM events WHERE processed=0 AND fire_at <= ? LIMIT 200'
  ).bind(nowISO()).all();
  for (const row of results) await processEvent(env, row.id).catch(e => console.error('sweep event failed', e));

  // Routine cleanup (cheap, idempotent):
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowISO()).run();
  // Purge demo workspaces older than 2 days (session expired at 24h anyway).
  const { results: oldDemos } = await env.DB.prepare(
    `SELECT w.id FROM workspaces w JOIN users u ON u.workspace_id=w.id
     WHERE u.email LIKE 'demo-%@nexuscrm.local' AND u.created_at < ?
     GROUP BY w.id HAVING COUNT(*)=1`
  ).bind(new Date(Date.now() - 2 * 86400000).toISOString()).all();
  for (const d of oldDemos) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM users WHERE workspace_id=?').bind(d.id),
      env.DB.prepare('DELETE FROM sessions WHERE workspace_id=?').bind(d.id),
      env.DB.prepare('DELETE FROM events WHERE workspace_id=?').bind(d.id),
      env.DB.prepare('DELETE FROM ai_usage_log WHERE workspace_id=?').bind(d.id),
      env.DB.prepare('DELETE FROM workspaces WHERE id=?').bind(d.id),
    ]).catch(e => console.error('demo purge failed', e));
  }
}

// ── TIME-BASED AUTOMATIONS ───────────────────────────────────
async function sendOverdueTaskReminders(env, ws) {
  const w = await getWorkspace(env, ws);
  if (!w.resend_from_email) return;
  const { results: overdue } = await env.DB.prepare(
    `SELECT * FROM tasks WHERE workspace_id=? AND status='todo' AND due_date != '' AND due_date < date('now') AND reminder_sent=0 LIMIT 50`
  ).bind(ws).all();
  if (!overdue.length) return;
  const userRow = await env.DB.prepare('SELECT email FROM users WHERE workspace_id=? LIMIT 1').bind(ws).first();
  if (!userRow) return;
  const body = `You have ${overdue.length} overdue task(s):\n\n` + overdue.map(t => `• ${t.title} (was due ${t.due_date})`).join('\n');
  try {
    await sendEmailViaResend(env, w, { to: userRow.email, subject: `⏰ ${overdue.length} overdue task${overdue.length === 1 ? '' : 's'} in NexusCRM`, body });
    // Mark reminded ONLY after the email actually went out.
    await env.DB.prepare('UPDATE tasks SET reminder_sent=1 WHERE id IN (' + overdue.map(() => '?').join(',') + ')')
      .bind(...overdue.map(t => t.id)).run();
  } catch (e) { console.error('overdue reminder failed', e); }
}

async function sendDailyDigest(env, ws) {
  const w = await getWorkspace(env, ws);
  if (!w.ai_daily_digest_enabled || !w.resend_from_email) return;
  const today = new Date().toISOString().slice(0, 10);
  if (w.digest_sent_date === today) return; // already sent today — no duplicates
  const userRow = await env.DB.prepare('SELECT email, name FROM users WHERE workspace_id=? LIMIT 1').bind(ws).first();
  if (!userRow) return;
  const stats = await computeStats(env, ws);
  const { results: hotLeads } = await env.DB.prepare('SELECT name, ai_score FROM contacts WHERE workspace_id=? AND ai_score>0 ORDER BY ai_score DESC LIMIT 5').bind(ws).all();
  const { results: overdue } = await env.DB.prepare(`SELECT title FROM tasks WHERE workspace_id=? AND status='todo' AND due_date != '' AND due_date < date('now')`).bind(ws).all();
  const { results: dueToday } = await env.DB.prepare(`SELECT title FROM appointments WHERE workspace_id=? AND date = date('now')`).bind(ws).all();

  const summaryData = { ...stats, hot_leads: hotLeads, overdue_tasks: overdue.map(t => t.title), appointments_today: dueToday.map(a => a.title) };
  let content;
  try {
    const r = await callProvider(env, w, [{ role: 'user', content:
      `Write a short, friendly daily business digest email (plain text, under 200 words) for ${userRow.name} from this CRM data: ${JSON.stringify(summaryData)}. Lead with the single most important thing today.` }], { max_tokens: 400 });
    await trackAIUsage(env, ws, 'digest', r.provider, r.usage);
    content = r.content;
  } catch { content = `Today: ${stats.pending_tasks} open tasks, $${stats.pipeline_value.toLocaleString()} pipeline, ${dueToday.length} appointment(s) today.`; }

  try {
    await sendEmailViaResend(env, w, { to: userRow.email, subject: `☀️ Your NexusCRM digest — ${new Date().toDateString()}`, body: content });
    await env.DB.prepare('UPDATE workspaces SET digest_sent_date=? WHERE id=?').bind(today, ws).run();
    invalidateWorkspaceCache(ws);
  } catch (e) { console.error('digest send failed', e); }
}

async function runHourlyJobs(env) {
  const hour = new Date().getUTCHours();
  const { results: workspaces } = await env.DB.prepare('SELECT id FROM workspaces').all();
  for (const w of workspaces) {
    await sendOverdueTaskReminders(env, w.id).catch(e => console.error(e));
    await sendAppointmentReminders(env, w.id).catch(e => console.error(e));
    const full = await getWorkspace(env, w.id);
    if (full.ai_daily_digest_enabled && full.ai_daily_digest_hour_utc === hour) {
      await sendDailyDigest(env, w.id).catch(e => console.error(e));
    }
  }
}

// ── CHAT MEMORY (persistent, per-workspace conversation history) ──
// The AI remembers past conversations across sessions — the chat panel and
// Command Hub are no longer stateless. Memory is capped (last 30 messages)
// and can be cleared from the UI.
async function loadChatMemory(env, ws, limit) {
  const { results } = await env.DB.prepare(
    'SELECT role, content FROM chat_memory WHERE workspace_id=? ORDER BY id DESC LIMIT ?'
  ).bind(ws, Math.min(limit || 10, 30)).all();
  const msgs = results.reverse();
  // Prepend the long-term summary (if any) so old context stays available.
  const w = await getWorkspace(env, ws).catch(() => null);
  if (w?.ai_memory_summary) {
    msgs.unshift({ role: 'system', content: 'Long-term memory summary (older conversations):\n' + String(w.ai_memory_summary).slice(0, 1500) });
  }
  return msgs;
}
const MEMORY_SUMMARY_INFLIGHT = new Map(); // ws -> true (avoid parallel summarizes)
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
  const summaryText = oldOnes.map(m => `${m.role}: ${String(m.content).slice(0, 200)}`).join('\n').slice(0, 6000);
  MEMORY_SUMMARY_INFLIGHT.set(ws, true);
  try {
    const r = await callProvider(env, w, [{
      role: 'user',
      content: `Summarize this business chat history into a compact "memory" of the facts that still matter (names, decisions, promises, preferences, deadlines). Max 120 words, bullet points, present tense:\n\n${summaryText}`,
    }], { max_tokens: 250 });
    await trackAIUsage(env, ws, 'memory-summary', r.provider, r.usage);
    const oldSummary = await env.DB.prepare('SELECT ai_memory_summary FROM workspaces WHERE id=?').bind(ws).first();
    const merged = [oldSummary?.ai_memory_summary, r.content.trim()].filter(Boolean).join('\n').slice(0, 2000);
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
  const r = await callProvider(env, w, [{
    role: 'user',
    content: [
      { type: 'text', text: question },
      { type: 'image_url', image_url: { url: imageUrl } },
    ],
  }], { max_tokens: 800, timeoutMs: 60000 });
  await trackAIUsage(env, ws, 'analyze-image', r.provider, r.usage);
  return { content: r.content, provider: r.provider, model: r.model };
}

// ── AI CHAT STREAMING (SSE, with error events + fallback) ────
async function handleChatStream(env, req, auth, body, origin) {
  const ws = auth.workspaceId;
  const w = await getWorkspace(env, ws);
  const cap = await withinDailyCap(env, ws, w.ai_daily_call_cap);
  if (!cap) return err(`Daily AI call cap (${w.ai_daily_call_cap}) reached for this workspace — raise it in Settings → AI Providers if needed.`, 429, origin);

  let messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  // Remember the user messages that arrived in THIS request (for persistence).
  const incomingUserMsgs = messages.filter(m => m.role === 'user').map(m => String(m.content || ''));
  const sysParts = [];
  if (body.context_data) sysParts.push(`Current app state: ${String(body.context_data).slice(0, 500)}`);
  try { sysParts.push(await workspaceContextSummary(env, ws)); } catch { }
  if (w.ai_system_prompt) sysParts.unshift(w.ai_system_prompt);
  if (sysParts.length) messages = [{ role: 'system', content: sysParts.join('\n') }, ...messages.filter(m => m.role !== 'system')];
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
  }

  let streamRes;
  try {
    streamRes = await openProviderStream(env, w, messages, { max_tokens: 1500 });
  } catch (e) {
    // Emit the failure as an SSE error event so the UI can show it.
    const encoder2 = new TextEncoder();
    const errStream = new ReadableStream({
      start(c) {
        c.enqueue(encoder2.encode(`data: ${JSON.stringify({ error: e.message || 'AI provider unavailable' })}\n\n`));
        c.enqueue(encoder2.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        c.close();
      },
    });
    return new Response(errStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...corsHeaders(origin) } });
  }

  // Count the call now that the stream is actually open.
  await trackAIUsage(env, ws, 'chat', streamRes.provider, {});

  const reader = streamRes.res.body.getReader();
  const decoder = new TextDecoder(); const encoder = new TextEncoder();
  let buf = '';
  let fullText = '';
  let metaSent = false;
  const stream = new ReadableStream({
    start(controller) {
      // Announce which provider + model is answering (UI shows it).
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ meta: { provider: streamRes.provider, model: streamRes.model } })}\n\n`));
      // SSE keep-alive every 15s so proxies never drop a long generation.
      const ka = setInterval(() => {
        try { controller.enqueue(encoder.encode(': ping\n\n')); } catch { clearInterval(ka); }
      }, 15000);
      this.__ka = ka;
    },
    cancel() { if (this.__ka) clearInterval(this.__ka); },
    async pull(controller) {
      let value, done;
      try { ({ value, done } = await reader.read()); }
      catch { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`)); controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)); controller.close(); return; }
      if (done) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        // Save the finished reply to persistent memory (best-effort).
        if (fullText.trim()) appendChatMemory(env, ws, 'assistant', fullText).catch(() => {});
        controller.close(); return;
      }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          // Terminate NOW on the provider's end-of-stream marker. Waiting for
          // EOF instead stalls the pull-based stream (a pull that returns
          // without enqueuing is never re-invoked) → the SSE connection never
          // closes and leaks worker time on every chat.
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          if (fullText.trim()) appendChatMemory(env, ws, 'assistant', fullText).catch(() => {});
          controller.close(); return;
        }
        try {
          const j = JSON.parse(payload);
          const delta = j.choices?.[0]?.delta?.content;
          if (delta) { fullText += delta; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`)); }
        } catch { }
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...corsHeaders(origin) } });
}


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

// Fill missing plan fields with sensible defaults so the AI always has
// complete material, even when the scan found little.
function normalizePlan(plan, name, desc) {
  const p = plan && typeof plan === 'object' ? { ...plan } : {};
  const biz = name || 'Our Business';
  p.site_name = String(p.site_name || name || 'Our Website').slice(0, 120);
  p.tagline = String(p.tagline || '').slice(0, 100) || `${biz} — trusted local service`;
  p.hero_headline = String(p.hero_headline || '').slice(0, 100) || `${biz}: quality you can rely on`;
  p.hero_sub = String(p.hero_sub || '').slice(0, 200) || (desc ? desc.split('.')[0] + '.' : 'Professional service, done right.');
  p.cta_primary = String(p.cta_primary || 'Get a free quote').slice(0, 40);
  p.cta_secondary = String(p.cta_secondary || 'Our services').slice(0, 40);
  if (!Array.isArray(p.marquee_items) || !p.marquee_items.length) p.marquee_items = ['Trusted locally', 'Fast response', 'Fair pricing', 'Quality guaranteed', 'Friendly service'];
  if (!Array.isArray(p.stats) || !p.stats.length) p.stats = [{ value: 10, label: 'Years experience' }, { value: 500, label: 'Happy clients' }, { value: 100, label: '% Satisfaction' }];
  if (!Array.isArray(p.services) || !p.services.length) p.services = [{ icon: '🛠️', title: 'Professional service', desc: 'Reliable, high-quality work — every time.' }, { icon: '⚡', title: 'Fast turnaround', desc: 'Quick response and on-time delivery.' }, { icon: '🤝', title: 'Fair pricing', desc: 'Transparent quotes, no surprises.' }];
  if (!Array.isArray(p.why_us) || !p.why_us.length) p.why_us = ['Licensed and insured', 'Upfront, honest pricing', 'Local and trusted', 'Work guaranteed'];
  p.about = String(p.about || '').slice(0, 600) || `${biz} has been serving the local community with professional service and honest advice. Every job is done right the first time — and backed by a real guarantee.`;
  if (!Array.isArray(p.process) || !p.process.length) p.process = [{ title: 'Contact us', desc: 'Call, email or use the form — we reply fast.' }, { title: 'Free quote', desc: 'A clear, no-obligation price before we start.' }, { title: 'We do the work', desc: 'Professional service with minimum disruption.' }, { title: 'Guaranteed', desc: 'Every job is finished right and backed by a guarantee.' }];
  if (!Array.isArray(p.gallery_imgs) || !p.gallery_imgs.length) p.gallery_imgs = [];
  if (!Array.isArray(p.reviews) || !p.reviews.length) p.reviews = [{ name: 'A Happy Client', text: 'Brilliant service from start to finish — highly recommended!', stars: 5 }];
  p.lead_title = String(p.lead_title || '').slice(0, 80) || 'Ready to get started?';
  p.lead_text = String(p.lead_text || '').slice(0, 200) || 'Contact us today for a free, friendly quote.';
  if (!Array.isArray(p.faqs) || !p.faqs.length) p.faqs = [{ q: 'How fast do you respond?', a: 'We usually reply within a few hours on business days.' }, { q: 'Do you provide guarantees?', a: 'Yes — every job is backed by a written guarantee.' }, { q: 'How do I get a quote?', a: 'Call, email or use the form and we will send a clear quote.' }];
  if (!Array.isArray(p.working_hours) || !p.working_hours.length) p.working_hours = ['Mon - Fri 9:00 - 17:00'];
  p.contact = p.contact && typeof p.contact === 'object' ? p.contact : {};
  p.footer_note = String(p.footer_note || '').slice(0, 120) || biz;
  if (!Array.isArray(p.pricing) || !p.pricing.length) p.pricing = [];
  if (!Array.isArray(p.team) || !p.team.length) p.team = [];
  if (!Array.isArray(p.timeline) || !p.timeline.length) p.timeline = [];
  if (!Array.isArray(p.logos) || !p.logos.length) p.logos = [];
  p.video_url = String(p.video_url || '').slice(0, 300);
  p.favicon = String(p.favicon || '🚀').slice(0, 8);
  return p;
}
// Build a full site: DESIGN CSS + AI-written content HTML (with the class
// vocabulary) + the interactive JS. Deterministic shell, AI fills content.
async function generateSiteHtml(env, ws, opts) {
  const w = await getWorkspace(env, ws);
  const designId = isValidDesignId(opts.design_id) ? opts.design_id : 'sentinel';
  const name = String(opts.name || 'My Website').slice(0, 120);
  const plan = normalizePlan(opts.plan, name, String(opts.description || ''));
  const desc = String(opts.description || '').slice(0, 800);
  const instructions = String(opts.instructions || '').slice(0, 1500);
  const themeOpts = {
    accent: opts.accent, accent2: opts.accent2, radius: opts.radius,
    font: opts.font, animation_level: opts.animation_level,
  };
  const styleOpts = {
    theme_id: SITE_THEMES[opts.theme_id] ? opts.theme_id : '',
    hero_style: HERO_STYLES[opts.hero_style] ? opts.hero_style : '',
    anim_preset: ANIM_PRESETS[opts.anim_preset] ? opts.anim_preset : '',
    card_style: CARD_STYLES[opts.card_style] ? opts.card_style : '',
    nav_style: NAV_STYLES[opts.nav_style] ? opts.nav_style : '',
    three_d: THREE_D_LEVELS[opts.three_d] ? opts.three_d : 'off',
  };
  const sceneId = SITE_SCENES[opts.scene_id] ? opts.scene_id : '';
  const splineUrl = String(opts.spline_url || '').trim();
  const scene = sceneId ? SITE_SCENES[sceneId] : null;
  const threeScene = isThreeScene(sceneId);
  const sceneHint = scene ? `\n3D BACKGROUND: a live ${threeScene ? 'WebGL 3D' : '3D canvas'} scene ("${scene.name}") is rendered behind the hero — keep hero text readable with enough padding; do NOT add background images or busy gradients to the hero.` : (splineUrl ? '\n3D BACKGROUND: a Spline 3D scene is embedded behind the hero (interactive 3D object) — keep hero text readable.' : '');
  const heroHint = styleOpts.hero_style && HERO_STYLES[styleOpts.hero_style] ? ('\nHero layout instruction: ' + HERO_STYLES[styleOpts.hero_style].prompt + '.') : '';
  const cardHint = styleOpts.card_style ? `\nCard style: ${styleOpts.card_style} (use the standard .nx-card markup; the design applies the look).` : '';
  const navHint = styleOpts.nav_style ? `\nNav style: ${styleOpts.nav_style} (standard .nx-nav markup; the design applies the look).` : '';
  const themeHint = styleOpts.theme_id ? `\nTheme: ${SITE_THEMES[styleOpts.theme_id].name} (colors are automatic — do not hardcode colors).` : '';
  const sections = Array.isArray(opts.sections) && opts.sections.length ? opts.sections : (() => {
    const auto = ['nav', 'hero', 'marquee', 'stats', 'services', 'why', 'about', 'process', 'parallax', 'reviews', 'lead', 'faq', 'contact', 'footer'];
    if (Array.isArray(plan.gallery_imgs) && plan.gallery_imgs.length) auto.splice(9, 0, 'gallery');
    if (Array.isArray(plan.pricing) && plan.pricing.length) auto.splice(auto.indexOf('reviews'), 0, 'pricing');
    if (Array.isArray(plan.team) && plan.team.length) auto.splice(auto.indexOf('reviews'), 0, 'team');
    if (Array.isArray(plan.timeline) && plan.timeline.length) auto.splice(auto.indexOf('reviews'), 0, 'timeline');
    if (Array.isArray(plan.logos) && plan.logos.length) auto.splice(auto.indexOf('reviews'), 0, 'logos');
    if (plan.video_url) auto.splice(auto.indexOf('reviews'), 0, 'video');
    if (plan.contact && plan.contact.address) auto.push('map');
    return auto;
  })();
  const sectionList = (sections || []).length ? sections.join(', ') : 'nav, hero, marquee, stats, services, why, about, process, parallax, gallery, reviews, lead, faq, contact, footer';
  const customCss = String(opts.custom_css || '').replace(/<\/style>/gi, '').replace(/<script/gi, '').slice(0, 8000);
  // Build the content instruction payload
  let contentSpec;
  if (plan) {
    contentSpec = `CONTENT PLAN (approved by the owner — use it, keep facts exact): ${JSON.stringify(plan)}`;
  } else {
    contentSpec = `Business: "${name}". About: ${desc || 'A professional local business.'}`;
  }
  const webhookUrl = opts.webhook_url || '';
  const css = resolveDesignCss(designId, themeOpts)
    + (styleOpts.theme_id ? '\n' + themeCss(styleOpts.theme_id) : '')
    + '\n' + componentStylesCss(styleOpts)
    + (scene ? '\n/* 3d scene */\n.nx-scene-host{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none}.nx-hero{position:relative;overflow:hidden}.nx-hero .container,.nx-hero .nx-hero-inner{position:relative;z-index:2}' : '')
    + (splineUrl ? '\n/* spline */\n.nx-hero{position:relative;overflow:hidden}.nx-hero .container,.nx-hero .nx-hero-inner{position:relative;z-index:2}spline-viewer{display:block}' : '')
    + (customCss ? '\n/* custom */\n' + customCss : '');
  const js = SITE_JS.replace('__WEBHOOK_URL__', webhookUrl)
    + componentScriptsJs(styleOpts)
    + (scene ? (threeScene ? threeSceneScript(scene) : sceneBootstrapJs(sceneId)) : '');
  // font loading (preconnect + stylesheet + swap), only when a font is chosen
  const FONT_URLS = { inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap', poppins: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;900&display=swap', playfair: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;800&family=Inter:wght@400;600&display=swap', space: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap', dm: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;900&display=swap' };
  const fontHtml = FONT_URLS[themeOpts.font] ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="${FONT_URLS[themeOpts.font]}" rel="stylesheet">` : '';
  let body = '';
  if (providerPriority(w).length && (await withinDailyCap(env, ws, w.ai_daily_call_cap))) {
    try {
      const r = await callProvider(env, w, [{
        role: 'user',
        content: `You are a senior web designer generating the BODY of a modern landing page. The site's complete CSS is provided — USE ONLY ITS CLASSES (do not invent classes; do not output any <style> or <script>; output ONLY the body inner HTML). The page's JavaScript already provides: scroll reveal via [data-reveal] (add it to major blocks, with optional data-delay="1|2|3"), count-up stats via <b data-count="N">, marquee via .nx-marquee > .nx-marquee-track > spans, card tilt/glare via .nx-card, FAQ accordion via .nx-faq-item > .nx-faq-q + .nx-faq-a, gallery lightbox via .nx-gallery img, testimonial strip via .nx-tstrip > .nx-review, contact form via .nx-form with inputs name/email/phone/message and a submit button, sticky nav via .nx-nav with .nx-menu-btn and .nx-nav-links (anchors #home #services #about #process #gallery #reviews #faq #contact).
INCLUDE ONLY THESE SECTIONS, IN THIS EXACT ORDER: ${sectionList}.
Section vocabulary:
- nav: .nx-nav > .container.nx-nav-inner (brand, .nx-menu-btn, .nx-nav-links with anchors)
- hero: .nx-hero with .nx-badge, h1 (use .grad-text on a keyword), p.lead, .nx-hero-actions (a.btn.btn-primary + a.btn.btn-ghost), optional .nx-hero-img img
- marquee: .nx-marquee > .nx-marquee-track > 5-6 spans
- stats: .nx-stats of 3-4 .nx-stat (b data-count + span)
- services: .nx-grid.g3 of .nx-card (div.ic emoji, h3, p)
- why: .nx-split with .nx-check bullets (b + text)
- about: .nx-split with h2 + paragraphs + optional img
- process: .nx-steps of 4 .nx-step (span.n + h3 + p)
- parallax: .nx-parallax with h2, p, a.btn.btn-primary
- gallery: .nx-gallery with real image URLs (add alt + loading="lazy")
- reviews: .nx-tstrip of .nx-review (.stars "★★★★★", p, .who)
- lead: .nx-lead with h2, p, a.btn.btn-primary
- faq: .nx-faq of 3-5 .nx-faq-item (.nx-faq-q + .nx-faq-a)
- pricing: .nx-grid.g3 of .nx-card pricing (h3 plan name, b price, ul features, a.btn.btn-primary "Choose") — mark the popular one with class "popular" style text
- team: .nx-grid.g2 of .nx-card (div.ic emoji avatar, h3 name, p role + bio)
- timeline: .nx-steps of milestones (span.n number, h3, p)
- logos: .nx-grid.g3 of .nx-card (h3 client name, p one-liner)
- newsletter: .nx-lead with form.nx-form containing only input name="email" + button (subscribe)
- video: .nx-parallax containing an iframe (youtube embed, loading="lazy", title="Video")
- map: .nx-split containing iframe (google maps embed from the address, loading="lazy", title="Map")
- contact: .nx-contact-grid (.nx-cinfo with phone/email/address/working hours + .nx-form with inputs name/email/phone/message)
- footer: .nx-footer
${contentSpec}
${instructions ? 'OWNER INSTRUCTIONS (follow strictly): ' + instructions : ''}${heroHint}${cardHint}${navHint}${themeHint}${sceneHint}
Rules:
- Use EXACTLY the plan's facts: working hours, phone, email, address, services, reviews, FAQs. Never invent contact details or services.
- Keep every paragraph under 45 words. One idea per paragraph.
- Section headings must use h2 with class sec-title inside .container; one h1 only (in the hero).
- Hero headline ≤ 12 words; sub ≤ 25 words; buttons ≤ 3 words each.
- Use the plan's gallery_imgs (real URLs) for .nx-hero-img, .nx-gallery and .nx-split images when present; add alt text to every img.
- Marquee: 5-6 short items that build trust.
- Stats: 3-4 believable numbers with data-count.
- Lead magnet + parallax CTA must reference the SAME primary action as the hero CTA.
- FAQ answers 20-40 words.
- If the plan's field is empty, write tasteful generic copy that fits the business type — never lorem ipsum.
- Output ONLY the body HTML.`,
      }], { max_tokens: 4500 });
      body = r.content || '';
      await trackAIUsage(env, ws, 'build-site', r.provider, r.usage);
    } catch { body = ''; }
  }
  if (!body || !body.includes('<')) {
    // deterministic fallback so a site ALWAYS builds
    body = `<nav class="nx-nav"><div class="container nx-nav-inner">
      <div class="nx-brand">${escHtml(name)}</div>
      <button class="nx-menu-btn">☰</button>
      <ul class="nx-nav-links"><li><a href="#home">Home</a></li><li><a href="#services">Services</a></li><li><a href="#about">About</a></li><li><a href="#contact">Contact</a></li></ul>
    </div></nav>
    <section class="nx-hero" id="home"><div class="container nx-hero-inner">
      <div data-reveal><span class="nx-badge"><span class="dot"></span> Trusted local service</span>
      <h1>Welcome to <span class="grad-text">${escHtml(name)}</span></h1>
      <p class="lead">${escHtml(desc || 'Professional service, done right.')}</p>
      <div class="nx-hero-actions"><a class="btn btn-primary" href="#contact">Get a free quote</a><a class="btn btn-ghost" href="#services">Our services</a></div></div>
    </div></section>
    <div class="nx-marquee"><div class="nx-marquee-track"><span>Quality you can trust</span><span>Fast response</span><span>Local experts</span><span>Fair pricing</span><span>Satisfaction guaranteed</span></div></div>
    <section class="section" id="services"><div class="container">
      <div data-reveal><span class="eyebrow">What we do</span><h2 class="sec-title">Our <span class="grad-text">services</span></h2></div>
      <div class="nx-grid g3"><div class="nx-card" data-reveal><div class="ic">🛠️</div><h3>Professional service</h3><p>Reliable, high-quality work every time.</p></div><div class="nx-card" data-reveal data-delay="1"><div class="ic">⚡</div><h3>Fast turnaround</h3><p>Quick response and on-time delivery.</p></div><div class="nx-card" data-reveal data-delay="2"><div class="ic">🤝</div><h3>Fair pricing</h3><p>Transparent quotes with no surprises.</p></div></div>
    </div></section>
    <section class="section" id="contact"><div class="container"><div class="nx-contact-grid">
      <div class="nx-cinfo" data-reveal>
        <div><div><b>Contact us</b><span>${(plan && plan.contact && plan.contact.phone) || ''} ${(plan && plan.contact && plan.contact.email) || ''}</span></div></div>
        <div><div><b>Working hours</b><span>${Array.isArray(plan && plan.working_hours) ? plan.working_hours.join(', ') : 'Mon - Fri 9am - 5pm'}</span></div></div>
      </div>
      <form class="nx-form"><input name="name" placeholder="Your name" required><input name="email" type="email" placeholder="Email" required><input name="phone" placeholder="Phone"><textarea name="message" placeholder="How can we help?" required></textarea><button class="btn btn-primary" type="submit">Send message</button><div class="ok">✅ Thanks! We'll get back to you shortly.</div></form>
    </div></div></section>
    <footer class="nx-footer"><div class="container">© ${new Date().getFullYear()} ${escHtml(name)}</div></footer>`;
  }
  // strip any stray style/script the model may have emitted
  body = body.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  // 3D background scene host + spline embed injected before everything
  if (scene) body = '<div class="nx-scene-host" data-scene="' + sceneId + '" data-type="' + (threeScene ? 'three' : 'canvas') + '"></div>' + body;
  if (splineUrl) body = splineEmbedHtml(splineUrl) + body;
  // ensure lazy loading + alt on every image
  body = body.replace(/<img(?![^>]*loading=)[^>]*>/gi, (tag) => tag.replace(/^<img/, '<img loading="lazy"'));
  // hero image should load eagerly — flip the first image back
  body = body.replace(/<img loading="lazy"([^>]*class="[^"]*nx-hero-img[^"]*")/i, '<img$1');
  const ogTitle = escHtml(name);
  const metaDesc = escHtml(String((plan && plan.meta_desc) || desc || name)).slice(0, 200);
  const ogImage = escHtml(String((plan && plan.gallery_imgs && plan.gallery_imgs[0]) || '')) || '';
  // LocalBusiness JSON-LD (real structured data for SEO) when we have contact info
  const c = (plan && plan.contact) || {};
  const h = (plan && plan.working_hours) || [];
  let jsonLd = '';
  if (c.phone || c.email || c.address) {
    const hoursObj = {};
    h.forEach((line, i) => { hoursObj['day' + (i + 1)] = line; });
    jsonLd = `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'LocalBusiness',
      name, description: String(metaDesc).slice(0, 180),
      telephone: c.phone || '', email: c.email || '',
      address: c.address ? { '@type': 'PostalAddress', streetAddress: c.address } : undefined,
      openingHours: h.length ? h : undefined,
      image: ogImage || undefined,
    }).replace(/</g, '\u003c')}<\/script>`;
  }
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ogTitle}</title>
<meta name="description" content="${metaDesc}">
<meta property="og:title" content="${ogTitle}"><meta property="og:type" content="website">${ogImage ? `<meta property="og:image" content="${ogImage}">` : ''}
<meta name="theme-color" content="#0b0e14">
<link rel="icon" href="${emojiFavicon(String((opts.favicon || (plan && plan.favicon)) || '🚀').slice(0, 4))}">
${fontHtml}
${jsonLd}
<style>${css}</style>
</head><body>
${body}
<script>${js}</script>
</body></html>`;
}
function escHtml(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── WEBSITES (AI-built, published sites) ─────────────────────
// ════════════════════════════════════════════════════════════
// WEBSITE ENGINE V2 — design systems, scanner, rebuild, instructions
// Design DNA learned from a production template: TopBar → Nav → Hero →
// Marquee → Stats → Services → Why Us → About → Process → Parallax →
// Gallery → Reviews → Lead Magnet → FAQ → Contact → Footer, with
// scroll-reveal, count-up stats, cursor spotlight, card tilt, magnetic
// buttons, marquee, film grain, gradient hairlines and reduced-motion
// support. The AI writes ONLY the content HTML against a fixed design
// CSS + interactive JS, so every generated site looks professional and
// stays consistent — never a generic AI soup page.
// ════════════════════════════════════════════════════════════
// Extra per-design touches (composed onto the base design's CSS).
// ════════════════════════════════════════════════════════════
// DESIGN ENGINE v4 — curated catalogs from researched design trends
// 40 themes × 12 hero styles × 12 animation presets × 6 card styles ×
// 4 nav styles × 3 3D levels = 400,000+ unique design combinations.
// ════════════════════════════════════════════════════════════
const SITE_THEMES = {
  // trend: dark glassmorphism
  'glass-dark': { name: 'Glass Dark', vars: { '--bg': '#0b0f19', '--bg2': '#101828', '--card': 'rgba(255,255,255,.06)', '--line': 'rgba(255,255,255,.12)', '--text': '#eef2ff', '--muted': '#94a3b8', '--accent': '#818cf8', '--accent2': '#c084fc', '--teal': '#22d3ee', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#818cf8,#c084fc 55%,#22d3ee)', '--radius': '18px', '--glass': 'backdrop-filter:blur(14px)' } },
  'glass-light': { name: 'Glass Light', vars: { '--bg': '#eef2ff', '--bg2': '#e4e9f7', '--card': 'rgba(255,255,255,.55)', '--line': 'rgba(15,23,42,.10)', '--text': '#1e293b', '--muted': '#64748b', '--accent': '#6366f1', '--accent2': '#8b5cf6', '--teal': '#0ea5e9', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#6366f1,#8b5cf6 55%,#0ea5e9)', '--radius': '20px', '--glass': 'backdrop-filter:blur(16px)' } },
  // trend: neumorphism
  'neo-light': { name: 'Neo Soft', vars: { '--bg': '#e4e9f0', '--bg2': '#dde3ec', '--card': '#e4e9f0', '--line': 'transparent', '--text': '#2d3748', '--muted': '#718096', '--accent': '#5a67d8', '--accent2': '#6b46c1', '--teal': '#319795', '--amber': '#d69e2e', '--grad': 'linear-gradient(100deg,#5a67d8,#6b46c1 55%,#319795)', '--radius': '22px', '--neo': 'box-shadow:9px 9px 20px #c3cad6,-9px -9px 20px #ffffff' } },
  // trend: brutalism
  'brutalism': { name: 'Brutalist', vars: { '--bg': '#f5f0e8', '--bg2': '#efe7d9', '--card': '#ffffff', '--line': '#111111', '--text': '#111111', '--muted': '#444444', '--accent': '#ff3d00', '--accent2': '#ffb300', '--teal': '#00c2a8', '--amber': '#ffb300', '--grad': 'linear-gradient(100deg,#ff3d00,#ffb300 55%,#00c2a8)', '--radius': '0px', '--brutal': 'box-shadow:6px 6px 0 #111111;border:2px solid #111111' } },
  // trend: dark luxury (gold on black)
  'luxury-dark': { name: 'Dark Luxury', vars: { '--bg': '#0a0a0a', '--bg2': '#121212', '--card': '#161616', '--line': '#2a2a2a', '--text': '#f5f0e6', '--muted': '#9c927e', '--accent': '#d4af37', '--accent2': '#f0d98c', '--teal': '#d4af37', '--amber': '#f0d98c', '--grad': 'linear-gradient(100deg,#d4af37,#f0d98c 55%,#b8860b)', '--radius': '4px' } },
  'minimal-white': { name: 'Minimal White', vars: { '--bg': '#ffffff', '--bg2': '#f7f7f8', '--card': '#ffffff', '--line': '#e8e8ea', '--text': '#18181b', '--muted': '#71717a', '--accent': '#18181b', '--accent2': '#52525b', '--teal': '#18181b', '--amber': '#a1a1aa', '--grad': 'linear-gradient(100deg,#18181b,#52525b 55%,#18181b)', '--radius': '12px' } },
  'minimal-dark': { name: 'Minimal Dark', vars: { '--bg': '#09090b', '--bg2': '#111113', '--card': '#151517', '--line': '#27272a', '--text': '#fafafa', '--muted': '#a1a1aa', '--accent': '#fafafa', '--accent2': '#a1a1aa', '--teal': '#fafafa', '--amber': '#d4d4d8', '--grad': 'linear-gradient(100deg,#fafafa,#a1a1aa 55%,#fafafa)', '--radius': '12px' } },
  // trend: editorial serif
  'editorial': { name: 'Editorial', vars: { '--bg': '#faf8f4', '--bg2': '#f2eee5', '--card': '#ffffff', '--line': '#ddd6c8', '--text': '#1c1917', '--muted': '#6b6257', '--accent': '#9a3412', '--accent2': '#c2410c', '--teal': '#44403c', '--amber': '#b45309', '--grad': 'linear-gradient(100deg,#9a3412,#c2410c 55%,#44403c)', '--radius': '0px', '--serif': "font-family:'Playfair Display',Georgia,serif" } },
  // trend: cyberpunk neon
  'cyberpunk': { name: 'Cyberpunk', vars: { '--bg': '#0d0221', '--bg2': '#150a33', '--card': '#1b0f3d', '--line': '#3b1d6e', '--text': '#e8f6ff', '--muted': '#9d8fd0', '--accent': '#00f0ff', '--accent2': '#ff00e5', '--teal': '#00f0ff', '--amber': '#ffe600', '--grad': 'linear-gradient(100deg,#00f0ff,#ff00e5 55%,#ffe600)', '--radius': '6px', '--neon': 'text-shadow:0 0 18px rgba(0,240,255,.6)' } },
  'sunset': { name: 'Sunset Vibrant', vars: { '--bg': '#0d0a16', '--bg2': '#151024', '--card': '#1d1530', '--line': '#33254d', '--text': '#fff5f0', '--muted': '#c4a8c0', '--accent': '#ff5e62', '--accent2': '#ff9966', '--teal': '#ffb56b', '--amber': '#ffd86b', '--grad': 'linear-gradient(100deg,#ff5e62,#ff9966 55%,#ffd86b)', '--radius': '18px' } },
  'ocean-light': { name: 'Ocean Light', vars: { '--bg': '#f0f9ff', '--bg2': '#e0f2fe', '--card': '#ffffff', '--line': '#bae6fd', '--text': '#0c4a6e', '--muted': '#4b7b99', '--accent': '#0284c7', '--accent2': '#38bdf8', '--teal': '#0ea5e9', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#0284c7,#38bdf8 55%,#0ea5e9)', '--radius': '18px' } },
  'forest-dark': { name: 'Forest Dark', vars: { '--bg': '#0a120e', '--bg2': '#0f1a14', '--card': '#14221a', '--line': '#22382b', '--text': '#e7f2ea', '--muted': '#8fa89a', '--accent': '#34d399', '--accent2': '#a7f3d0', '--teal': '#34d399', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#34d399,#a7f3d0 55%,#fbbf24)', '--radius': '14px' } },
  'rose-elegant': { name: 'Rose Elegant', vars: { '--bg': '#fdf7f8', '--bg2': '#fbeef1', '--card': '#ffffff', '--line': '#f0dde2', '--text': '#38121c', '--muted': '#8a5a68', '--accent': '#d6336c', '--accent2': '#f783ac', '--teal': '#d6336c', '--amber': '#e8a13a', '--grad': 'linear-gradient(100deg,#d6336c,#f783ac 55%,#e8a13a)', '--radius': '18px' } },
  'midnight-violet': { name: 'Midnight Violet', vars: { '--bg': '#0d0a1a', '--bg2': '#141027', '--card': '#1b1533', '--line': '#2d2450', '--text': '#eae6ff', '--muted': '#a99fd0', '--accent': '#8b5cf6', '--accent2': '#c4b5fd', '--teal': '#a78bfa', '--amber': '#f0abfc', '--grad': 'linear-gradient(100deg,#8b5cf6,#c4b5fd 55%,#f0abfc)', '--radius': '16px' } },
  'ember-warm': { name: 'Ember Warm', vars: { '--bg': '#0d0b08', '--bg2': '#171310', '--card': '#201a14', '--line': '#3a2f24', '--text': '#f7efe4', '--muted': '#b39c80', '--accent': '#f59e0b', '--accent2': '#fbbf24', '--teal': '#f59e0b', '--amber': '#fcd34d', '--grad': 'linear-gradient(100deg,#f59e0b,#fcd34d 55%,#f97316)', '--radius': '16px' } },
  'graphite': { name: 'Graphite Mono', vars: { '--bg': '#0f0f0f', '--bg2': '#171717', '--card': '#1d1d1d', '--line': '#2e2e2e', '--text': '#f2f2f2', '--muted': '#9a9a9a', '--accent': '#e5e5e5', '--accent2': '#a3a3a3', '--teal': '#e5e5e5', '--amber': '#d4d4d4', '--grad': 'linear-gradient(100deg,#ffffff,#a3a3a3 55%,#ffffff)', '--radius': '10px' } },
  'sand-natural': { name: 'Sand Natural', vars: { '--bg': '#faf6ef', '--bg2': '#f1e9db', '--card': '#fffdf8', '--line': '#e2d5bf', '--text': '#3f3527', '--muted': '#8a7a63', '--accent': '#b7791f', '--accent2': '#d69e2e', '--teal': '#8b9d6b', '--amber': '#d69e2e', '--grad': 'linear-gradient(100deg,#b7791f,#d69e2e 55%,#8b9d6b)', '--radius': '14px' } },
  'sakura': { name: 'Sakura Pastel', vars: { '--bg': '#fdf2f6', '--bg2': '#fbe7ef', '--card': '#ffffff', '--line': '#f6d5e2', '--text': '#4a2430', '--muted': '#9d6b7c', '--accent': '#ec4899', '--accent2': '#f9a8d4', '--teal': '#ec4899', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#ec4899,#f9a8d4 55%,#fbbf24)', '--radius': '20px' } },
  'mint-fresh': { name: 'Mint Fresh', vars: { '--bg': '#f0fdfa', '--bg2': '#ccfbf1', '--card': '#ffffff', '--line': '#99f6e4', '--text': '#134e4a', '--muted': '#3d8a80', '--accent': '#14b8a6', '--accent2': '#2dd4bf', '--teal': '#14b8a6', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#14b8a6,#2dd4bf 55%,#0ea5e9)', '--radius': '18px' } },
  'cobalt-corp': { name: 'Cobalt Corporate', vars: { '--bg': '#f8fafc', '--bg2': '#eef2f7', '--card': '#ffffff', '--line': '#dbe4ee', '--text': '#0f172a', '--muted': '#5b6b84', '--accent': '#1d4ed8', '--accent2': '#3b82f6', '--teal': '#0ea5e9', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#1d4ed8,#3b82f6 55%,#0ea5e9)', '--radius': '10px' } },
  'lime-pop': { name: 'Lime Pop', vars: { '--bg': '#0c0f0a', '--bg2': '#141a0d', '--card': '#1c2414', '--line': '#33421f', '--text': '#f2ffe8', '--muted': '#a3c08c', '--accent': '#a3e635', '--accent2': '#d9f99d', '--teal': '#a3e635', '--amber': '#facc15', '--grad': 'linear-gradient(100deg,#a3e635,#d9f99d 55%,#facc15)', '--radius': '14px' } },
  'terracotta': { name: 'Terracotta', vars: { '--bg': '#fbf3ee', '--bg2': '#f5e5dc', '--card': '#fffaf6', '--line': '#e8cdbf', '--text': '#3d2218', '--muted': '#93644f', '--accent': '#c2410c', '--accent2': '#ea580c', '--teal': '#b45309', '--amber': '#d97706', '--grad': 'linear-gradient(100deg,#c2410c,#ea580c 55%,#b45309)', '--radius': '12px' } },
  'lavender': { name: 'Lavender Soft', vars: { '--bg': '#f8f7ff', '--bg2': '#efedfd', '--card': '#ffffff', '--line': '#ddd9f5', '--text': '#2e2a54', '--muted': '#736fa5', '--accent': '#7c6cf0', '--accent2': '#a78bfa', '--teal': '#7c6cf0', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#7c6cf0,#a78bfa 55%,#f0abfc)', '--radius': '18px' } },
  'noir-ivory': { name: 'Noir Ivory', vars: { '--bg': '#141414', '--bg2': '#1c1c1c', '--card': '#232323', '--line': '#333333', '--text': '#f5f0e1', '--muted': '#a89f8d', '--accent': '#e8dcc5', '--accent2': '#c9bda4', '--teal': '#e8dcc5', '--amber': '#d4c5a8', '--grad': 'linear-gradient(100deg,#e8dcc5,#c9bda4 55%,#e8dcc5)', '--radius': '6px' } },
  'bordeaux': { name: 'Bordeaux Wine', vars: { '--bg': '#16090d', '--bg2': '#200e14', '--card': '#2a1220', '--line': '#452034', '--text': '#fbeef2', '--muted': '#c29aa8', '--accent': '#e11d48', '--accent2': '#fb7185', '--teal': '#e11d48', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#e11d48,#fb7185 55%,#f59e0b)', '--radius': '12px' } },
  'teal-aqua': { name: 'Teal Aqua', vars: { '--bg': '#042f2e', '--bg2': '#083838', '--card': '#0d4444', '--line': '#115e5e', '--text': '#ecfeff', '--muted': '#8fd6d3', '--accent': '#2dd4bf', '--accent2': '#5eead4', '--teal': '#2dd4bf', '--amber': '#fcd34d', '--grad': 'linear-gradient(100deg,#2dd4bf,#5eead4 55%,#38bdf8)', '--radius': '16px' } },
  'amber-retro': { name: 'Amber Retro', vars: { '--bg': '#1c1206', '--bg2': '#271a0a', '--card': '#32220e', '--line': '#4a3414', '--text': '#fdeed0', '--muted': '#c9a876', '--accent': '#f59e0b', '--accent2': '#fbbf24', '--teal': '#f59e0b', '--amber': '#fcd34d', '--grad': 'linear-gradient(100deg,#f59e0b,#fcd34d 55%,#fb923c)', '--radius': '8px', '--retro': 'letter-spacing:.02em' } },
  'slate-blue': { name: 'Slate Blue', vars: { '--bg': '#0a0c10', '--bg2': '#101319', '--card': '#151a22', '--line': '#222a36', '--text': '#e6eaf2', '--muted': '#8b97ab', '--accent': '#5b8def', '--accent2': '#8fa8ff', '--teal': '#7ee2d0', '--amber': '#f2c14e', '--grad': 'linear-gradient(100deg,#5b8def,#8fa8ff 55%,#7ee2d0)', '--radius': '14px' } },
  'coral-tropic': { name: 'Coral Tropic', vars: { '--bg': '#fff7f2', '--bg2': '#ffece1', '--card': '#ffffff', '--line': '#ffd6c2', '--text': '#3c1505', '--muted': '#a05f3d', '--accent': '#ff6b3d', '--accent2': '#ff9f1c', '--teal': '#00c2a8', '--amber': '#ffd166', '--grad': 'linear-gradient(100deg,#ff6b3d,#ff9f1c 55%,#00c2a8)', '--radius': '20px' } },
  'evergreen': { name: 'Evergreen', vars: { '--bg': '#f1f7f3', '--bg2': '#e3efe8', '--card': '#ffffff', '--line': '#cde3d5', '--text': '#173b26', '--muted': '#5b826c', '--accent': '#15803d', '--accent2': '#22c55e', '--teal': '#16a34a', '--amber': '#ca8a04', '--grad': 'linear-gradient(100deg,#15803d,#22c55e 55%,#0d9488)', '--radius': '14px' } },
  'denim': { name: 'Denim', vars: { '--bg': '#101a2e', '--bg2': '#16233c', '--card': '#1c2c4a', '--line': '#2c4268', '--text': '#eef4ff', '--muted': '#93a9cc', '--accent': '#60a5fa', '--accent2': '#93c5fd', '--teal': '#38bdf8', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#60a5fa,#93c5fd 55%,#38bdf8)', '--radius': '12px' } },
  'plum-deep': { name: 'Plum Deep', vars: { '--bg': '#1c0d1f', '--bg2': '#26122b', '--card': '#301838', '--line': '#472450', '--text': '#f8eefc', '--muted': '#c39ecf', '--accent': '#c026d3', '--accent2': '#e879f9', '--teal': '#a21caf', '--amber': '#f0abfc', '--grad': 'linear-gradient(100deg,#c026d3,#e879f9 55%,#a78bfa)', '--radius': '16px' } },
  'canary': { name: 'Canary Bright', vars: { '--bg': '#fdfce8', '--bg2': '#faf7c8', '--card': '#ffffff', '--line': '#e8e3a0', '--text': '#3d3a08', '--muted': '#8a8420', '--accent': '#eab308', '--accent2': '#facc15', '--teal': '#ca8a04', '--amber': '#fde047', '--grad': 'linear-gradient(100deg,#eab308,#fde047 55%,#f97316)', '--radius': '12px' } },
  'steel': { name: 'Steel Grey', vars: { '--bg': '#0c0f14', '--bg2': '#12161d', '--card': '#181d26', '--line': '#2a3140', '--text': '#e8edf5', '--muted': '#8b96a8', '--accent': '#94a3b8', '--accent2': '#cbd5e1', '--teal': '#94a3b8', '--amber': '#d4a94e', '--grad': 'linear-gradient(100deg,#94a3b8,#cbd5e1 55%,#64748b)', '--radius': '8px' } },
  'berry': { name: 'Berry Magenta', vars: { '--bg': '#15060f', '--bg2': '#1f0a16', '--card': '#291020', '--line': '#421a31', '--text': '#fdeef6', '--muted': '#c493ad', '--accent': '#ec4899', '--accent2': '#f472b6', '--teal': '#db2777', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#ec4899,#f472b6 55%,#a855f7)', '--radius': '16px' } },
  'seafoam': { name: 'Seafoam', vars: { '--bg': '#f2fbf9', '--bg2': '#e2f6f2', '--card': '#ffffff', '--line': '#c8ebe4', '--text': '#1c4a42', '--muted': '#4e8a80', '--accent': '#0d9488', '--accent2': '#2dd4bf', '--teal': '#0d9488', '--amber': '#d97706', '--grad': 'linear-gradient(100deg,#0d9488,#2dd4bf 55%,#06b6d4)', '--radius': '18px' } },
  'chocolate': { name: 'Chocolate', vars: { '--bg': '#150f0a', '--bg2': '#1e1510', '--card': '#271b13', '--line': '#3d2b1f', '--text': '#f7ede1', '--muted': '#b79a7e', '--accent': '#d97706', '--accent2': '#f59e0b', '--teal': '#b45309', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#d97706,#f59e0b 55%,#92400e)', '--radius': '12px' } },
  'space': { name: 'Space Dark', vars: { '--bg': '#030712', '--bg2': '#0b1120', '--card': '#111a30', '--line': '#1e2a4a', '--text': '#e7ecff', '--muted': '#8ba0d8', '--accent': '#3b82f6', '--accent2': '#60a5fa', '--teal': '#22d3ee', '--amber': '#fbbf24', '--grad': 'linear-gradient(100deg,#3b82f6,#60a5fa 55%,#22d3ee)', '--radius': '16px' } },
  'peach': { name: 'Peach Cream', vars: { '--bg': '#fff7f0', '--bg2': '#ffefe0', '--card': '#ffffff', '--line': '#f7dcc8', '--text': '#3f2413', '--muted': '#9c7050', '--accent': '#fb923c', '--accent2': '#fdba74', '--teal': '#fb923c', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#fb923c,#fdba74 55%,#f87171)', '--radius': '20px' } },
  'classic-red': { name: 'Classic Red', vars: { '--bg': '#fff8f7', '--bg2': '#fdeeec', '--card': '#ffffff', '--line': '#f3d2cd', '--text': '#40130f', '--muted': '#96544b', '--accent': '#dc2626', '--accent2': '#ef4444', '--teal': '#b91c1c', '--amber': '#f59e0b', '--grad': 'linear-gradient(100deg,#dc2626,#ef4444 55%,#b91c1c)', '--radius': '10px' } },
};
// theme CSS builder
function themeCss(themeId) {
  const t = SITE_THEMES[themeId];
  if (!t) return '';
  const vars = Object.entries(t.vars).map(([k, v]) => `${k}:${v}`).join(';');
  // glass/neo/brutal special treatments on cards + nav
  let extra = '';
  if (themeId === 'glass-dark' || themeId === 'glass-light') {
    extra = `.nx-card,.nx-stat,.nx-step,.nx-review,.nx-lead{background:var(--card);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--line)}.nx-nav{background:rgba(255,255,255,.06);backdrop-filter:blur(18px)}`;
  }
  if (themeId === 'neo-light') {
    extra = `.nx-card,.nx-stat,.nx-step,.nx-review{background:var(--card);box-shadow:9px 9px 20px #c3cad6,-9px -9px 20px #ffffff;border:none}.nx-nav{background:rgba(228,233,240,.9);backdrop-filter:blur(14px)}`;
  }
  if (themeId === 'brutalism') {
    extra = `.nx-card,.nx-stat,.nx-step,.nx-review,.btn,.nx-lead,.nx-form input,.nx-form textarea{border:2px solid #111;box-shadow:6px 6px 0 #111;border-radius:0}.btn-primary{background:#ff3d00;color:#fff}.nx-card:hover,.nx-stat:hover{transform:translate(-3px,-3px);box-shadow:9px 9px 0 #111}`;
  }
  if (themeId === 'luxury-dark' || themeId === 'noir-ivory') {
    extra = `.sec-title,.nx-hero h1{font-weight:700;letter-spacing:-.01em}.nx-brand em{font-style:normal}.nx-stat b{color:var(--accent)}`;
  }
  if (themeId === 'cyberpunk') {
    extra = `.nx-card{border:1px solid rgba(0,240,255,.3);box-shadow:0 0 24px -8px rgba(0,240,255,.25)}.nx-card:hover{box-shadow:0 0 36px -6px rgba(255,0,229,.4)}.grad-text,.nx-hero h1{text-shadow:0 0 18px rgba(0,240,255,.5)}`;
  }
  if (themeId === 'editorial') {
    extra = `body{font-family:'Playfair Display',Georgia,serif}h1,h2,h3{font-family:'Playfair Display',Georgia,serif;font-weight:800}.nx-card p,.nx-faq-a{font-family:system-ui,sans-serif}`;
  }
  return `:root{${vars}}${extra}`;
}
// ════════════════════════════════════════════════════════════
// COMPONENT STYLE CATALOGS (hero / animation / card / nav / 3D)
// ════════════════════════════════════════════════════════════
const HERO_STYLES = {
  split:        { name: 'Split (text + image)', css: '', prompt: '.nx-hero-inner two-column grid' },
  center:       { name: 'Centered', css: `.nx-hero{text-align:center}.nx-hero-inner{display:block}.nx-hero p.lead{margin-left:auto;margin-right:auto}.nx-hero-actions{justify-content:center}`, prompt: '.nx-hero-inner single column, centered' },
  glass:        { name: 'Glass panel', css: `.nx-hero-inner{background:rgba(255,255,255,.05);border:1px solid var(--line);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-radius:calc(var(--radius) + 8px);padding:56px 48px;box-shadow:0 40px 90px -40px rgba(0,0,0,.6)}`, prompt: '.nx-hero-inner glass card panel' },
  mesh:         { name: 'Gradient mesh', css: `.nx-hero::before{content:"";position:absolute;inset:-20%;z-index:0;background:radial-gradient(40% 45% at 20% 30%,rgba(247,116,42,.28),transparent 60%),radial-gradient(35% 40% at 80% 20%,rgba(47,179,162,.25),transparent 60%),radial-gradient(45% 50% at 60% 85%,rgba(91,141,239,.22),transparent 60%);filter:blur(30px);animation:meshDrift 16s ease-in-out infinite alternate}.nx-hero>*{position:relative;z-index:2}@keyframes meshDrift{0%{transform:translate3d(0,0,0) scale(1)}100%{transform:translate3d(3%,-3%,0) scale(1.08)}}`, prompt: '.nx-hero-inner (gradient mesh blobs behind)' },
  tilt3d:       { name: '3D tilt card', css: `.nx-3d-wrap{perspective:1100px}.nx-3d-card{transform-style:preserve-3d;transition:transform .25s var(--ease);will-change:transform}.nx-3d-card>*{transform:translateZ(34px)}`, prompt: '.nx-hero-inner with a .nx-3d-wrap > .nx-3d-card around the hero image (if present)' },
  particles:    { name: 'Particle field', css: `#nx-particles{position:absolute;inset:0;z-index:0;pointer-events:none}.nx-hero>*{position:relative;z-index:2}`, prompt: '.nx-hero-inner (a canvas#nx-particles sits behind automatically)' },
  parallax:     { name: 'Layered parallax', css: `.nx-pl{position:absolute;inset:0;overflow:hidden;z-index:0;pointer-events:none}.nx-pl i{position:absolute;display:block;border-radius:50%;will-change:transform}.nx-hero>*{position:relative;z-index:2}`, prompt: '.nx-hero-inner (parallax layer divs .nx-pl with <i> orbs behind)' },
  marqueebg:    { name: 'Marquee background', css: `.nx-hero{overflow:hidden}.nx-hero-bg-marquee{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:none;z-index:0;opacity:.08;font-weight:900;white-space:nowrap;font-size:clamp(80px,16vw,220px);color:var(--accent)}.nx-hero-bg-marquee span{animation:heroMarquee 30s linear infinite}.nx-hero>*{position:relative;z-index:2}@keyframes heroMarquee{to{transform:translateX(-50%)}}`, prompt: '.nx-hero-bg-marquee div with the business name repeated, then .nx-hero-inner' },
  kinetic:      { name: 'Kinetic type', css: `.nx-kinetic{display:inline-block}.nx-kinetic b{display:inline-block;animation:kin 3.2s var(--ease) infinite;opacity:0}.nx-kinetic b:nth-child(2){animation-delay:.22s}.nx-kinetic b:nth-child(3){animation-delay:.44s}.nx-kinetic b:nth-child(4){animation-delay:.66s}.nx-kinetic b:nth-child(5){animation-delay:.88s}.nx-kinetic b:nth-child(6){animation-delay:1.1s}.nx-kinetic b:nth-child(7){animation-delay:1.32s}.nx-kinetic b:nth-child(8){animation-delay:1.54s}@keyframes kin{0%{opacity:0;transform:translateY(18px) rotate(4deg)}30%{opacity:1;transform:none}75%{opacity:1}100%{opacity:0}}`, prompt: 'hero h1 headline with .nx-kinetic wrapping each word in <b>' },
  splitimage:   { name: 'Split + framed image', css: `.nx-hero-img img{border:1px solid var(--line);border-radius:var(--radius);box-shadow:0 40px 90px -30px rgba(0,0,0,.5)}.nx-hero-img::after{content:"";position:absolute;inset:14px -14px -14px 14px;border:2px solid var(--accent);border-radius:var(--radius);opacity:.5;z-index:-1}`, prompt: '.nx-hero-inner with .nx-hero-img (image with decorative frame)' },
  badgehero:    { name: 'Badge compact', css: `.nx-hero{padding:80px 0 60px}.nx-hero-inner{grid-template-columns:1fr;text-align:center}.nx-hero p.lead{margin:0 auto 26px}.nx-hero-actions{justify-content:center}.nx-hero h1{font-size:clamp(34px,5vw,54px)}`, prompt: '.nx-hero-inner single column centered with .nx-badge' },
  minimal:      { name: 'Minimal', css: `.nx-hero{padding:120px 0 80px}.nx-hero-inner{display:block}.nx-hero h1{font-size:clamp(40px,7vw,76px);letter-spacing:-.04em;max-width:900px}.nx-hero p.lead{font-size:19px;max-width:560px}.nx-badge{display:none}`, prompt: '.nx-hero-inner single column, huge headline, no badge' },
};
const ANIM_PRESETS = {
  fadeup:   { name: 'Fade up', css: `[data-reveal]{transform:translateY(26px)}` },
  fade:     { name: 'Fade', css: `[data-reveal]{transform:none}` },
  slideleft:{ name: 'Slide left', css: `[data-reveal]{transform:translateX(-40px)}` },
  slideright:{ name: 'Slide right', css: `[data-reveal]{transform:translateX(40px)}` },
  zoom:     { name: 'Zoom in', css: `[data-reveal]{transform:scale(.9)}` },
  blur:     { name: 'Blur in', css: `[data-reveal]{transform:translateY(18px);filter:blur(8px)}[data-reveal].in{filter:blur(0)}` },
  flip:     { name: 'Flip up', css: `[data-reveal]{transform:perspective(900px) rotateX(24deg);transform-origin:bottom}` },
  rise:     { name: 'Rise + fade', css: `[data-reveal]{transform:translateY(60px);transition-duration:.9s}` },
  pop:      { name: 'Pop', css: `[data-reveal]{transform:scale(.82) translateY(20px)}` },
  drift:    { name: 'Drift', css: `[data-reveal]{transform:translate(18px,22px)}` },
  clip:     { name: 'Clip up', css: `[data-reveal]{clip-path:inset(0 0 100% 0);transform:none;transition:clip-path .8s var(--ease)}[data-reveal].in{clip-path:inset(0 0 0 0)}` },
  none:     { name: 'None (instant)', css: `[data-reveal]{opacity:1;transform:none;transition:none}` },
};
const CARD_STYLES = {
  standard: { name: 'Standard', css: '' },
  glass:    { name: 'Glass', css: `.nx-card,.nx-stat,.nx-step,.nx-review{background:rgba(255,255,255,.06);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--line)}` },
  neo:      { name: 'Neumorphic', css: `.nx-card,.nx-stat,.nx-step,.nx-review{background:var(--bg2);border:none;box-shadow:8px 8px 18px rgba(0,0,0,.22),-8px -8px 18px rgba(255,255,255,.04)}` },
  border:   { name: 'Gradient border', css: `.nx-card,.nx-stat,.nx-step,.nx-review{border:1px solid transparent;background:linear-gradient(var(--card),var(--card)) padding-box,var(--grad) border-box}` },
  lift3d:   { name: '3D lift', css: `.nx-card,.nx-stat,.nx-step{transform-style:preserve-3d}.nx-card:hover,.nx-stat:hover,.nx-step:hover{transform:perspective(900px) translateZ(22px) translateY(-8px) rotateX(2deg) rotateY(-2deg)}` },
  minimal:  { name: 'Minimal', css: `.nx-card,.nx-stat,.nx-step,.nx-review{background:transparent;border:none;border-bottom:1px solid var(--line);border-radius:0}` },
};
const NAV_STYLES = {
  glass:  { name: 'Glass', css: `.nx-nav{background:rgba(11,14,20,.6);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}` },
  solid:  { name: 'Solid', css: `.nx-nav{background:var(--bg2);backdrop-filter:none}` },
  underline: { name: 'Underline', css: `.nx-nav-links a{position:relative}.nx-nav-links a::after{content:"";position:absolute;left:0;right:0;bottom:-4px;height:2px;background:var(--grad);transform:scaleX(0);transition:transform .25s var(--ease)}.nx-nav-links a:hover::after{transform:scaleX(1)}` },
  pill:   { name: 'Pill CTA', css: `.nx-nav-links .nx-nav-cta a,.nx-nav-links a[data-cta]{background:var(--grad);color:#fff;padding:8px 18px;border-radius:999px;font-weight:700}.nx-nav-links a[data-cta]:hover{color:#fff;transform:translateY(-2px)}` },
};
const THREE_D_LEVELS = {
  off:   { name: 'Off', css: '', js: '' },
  light: { name: 'Light (CSS 3D)', css: `.nx-hero-img img,.nx-3d-card,.nx-card,.nx-stat{transform-style:preserve-3d}`, js: '' },
  full:  { name: 'Full (3D hero + particles)', css: `#nx-particles{position:absolute;inset:0;z-index:0;pointer-events:none}.nx-hero>*{position:relative;z-index:2}.nx-orb-3d{position:absolute;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle at 30% 30%,var(--accent2),var(--accent) 60%,transparent);filter:blur(6px);opacity:.5;animation:orbSpin 14s linear infinite;will-change:transform;z-index:0}.nx-hero{overflow:hidden}@keyframes orbSpin{0%{transform:rotate(0) translateX(60px) rotate(0)}100%{transform:rotate(360deg) translateX(60px) rotate(-360deg)}}`, js: `
  // 3D hero scene: inject canvas + orb automatically (no external libs)
  var mm3=function(q){try{return (typeof matchMedia!=='undefined')?matchMedia(q).matches:false;}catch(e){return false;}};
  var R3=mm3('(prefers-reduced-motion: reduce)');
  var heroEl=document.querySelector('.nx-hero');
  if(heroEl&&!R3){
    var orb=document.createElement('div');orb.className='nx-orb-3d';orb.style.top='12%';orb.style.right='8%';heroEl.appendChild(orb);
    var canvas=document.createElement('canvas');canvas.id='nx-particles';heroEl.appendChild(canvas);
    var pc=canvas;
    if(pc.getContext){
      var ctx=pc.getContext('2d'),W,H,pts=[];
      function ps(){W=pc.width=pc.offsetWidth;H=pc.height=pc.offsetHeight;pts=[];var n=Math.min(70,Math.floor(W/18));for(var i=0;i<n;i++)pts.push({x:Math.random()*W,y:Math.random()*H,r:Math.random()*2+0.6,vx:(Math.random()-.5)*.4,vy:(Math.random()-.5)*.4});}
      ps();addEventListener('resize',ps,{passive:true});
      (function loop(){ctx.clearRect(0,0,W,H);for(var i=0;i<pts.length;i++){var p=pts[i];p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>W)p.vx*=-1;if(p.y<0||p.y>H)p.vy*=-1;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle='rgba(120,160,255,.5)';ctx.fill();}requestAnimationFrame(loop);})();
    }
  }` },
};
// build the extra CSS for chosen component styles
function componentStylesCss(opts) {
  const parts = [];
  const hero = HERO_STYLES[opts.hero_style];
  if (hero && hero.css) parts.push('/* hero:' + opts.hero_style + ' */\n' + hero.css);
  const anim = ANIM_PRESETS[opts.anim_preset];
  if (anim && anim.css) parts.push('/* anim:' + opts.anim_preset + ' */\n' + anim.css);
  const card = CARD_STYLES[opts.card_style];
  if (card && card.css) parts.push('/* card:' + opts.card_style + ' */\n' + card.css);
  const nav = NAV_STYLES[opts.nav_style];
  if (nav && nav.css) parts.push('/* nav:' + opts.nav_style + ' */\n' + nav.css);
  const t3 = THREE_D_LEVELS[opts.three_d];
  if (t3 && t3.css) parts.push('/* 3d:' + opts.three_d + ' */\n' + t3.css);
  return parts.join('\n');
}
// Builds the scene bootstrap: canvas, theme colors, resize, pointer, loop.
function sceneBootstrapJs(sceneId) {
  const scene = SITE_SCENES[sceneId];
  if (!scene) return '';
  const fn = scene.fn || '';
  return `(function(){
var mm=function(q){try{return (typeof matchMedia!=='undefined')?matchMedia(q).matches:false;}catch(e){return false;}};
if(mm('(prefers-reduced-motion: reduce)'))return;
var host=document.querySelector('.nx-scene-host');if(!host)return;
var cv=document.createElement('canvas');cv.id='nx-scene-canvas';
cv.style.cssText='position:absolute;inset:0;width:100%;height:100%';
host.appendChild(cv);
var ctx=cv.getContext('2d');if(!ctx)return;
var D=Math.min(window.devicePixelRatio||1,2),W,H,t0=performance.now();
function sz(){W=cv.width=Math.round(host.offsetWidth*D);H=cv.height=Math.round(host.offsetHeight*D);}
sz();addEventListener('resize',sz,{passive:true});
var cs=getComputedStyle(document.documentElement);
function gv(n,d){var v=cs.getPropertyValue(n).trim();return v||d;}
var C={a:gv('--accent','#f7742a'),a2:gv('--accent2','#ffb24d'),t:gv('--teal','#2fb3a2'),amber:gv('--amber','#fbbf24')};
function hex2rgb(h){h=String(h).replace('#','');if(h.length===3)h=h.split('').map(function(c){return c+c;}).join('');var n=parseInt(h,16);if(isNaN(n))return [247,116,42];return [(n>>16)&255,(n>>8)&255,n&255];}
${M3_BOOT}
var SCENE=function(ctx,W,H,t,C,mx,my){${fn}};
var mx=-1,my=-1;
addEventListener('pointermove',function(e){mx=e.clientX*D;my=e.clientY*D;},{passive:true});
(function loop(now){var t=(now-t0)/1000;ctx.clearRect(0,0,W,H);try{SCENE(ctx,W,H,t,C,mx,my);}catch(e){}requestAnimationFrame(loop);})(performance.now());
})();`;
}
function componentScriptsJs(opts) {
  const t3 = THREE_D_LEVELS[opts.three_d];
  return (t3 && t3.js) || '';
}

// ════════════════════════════════════════════════════════════
// 3D SCENE ENGINE — 30 real, working 3D background scenes.
// Each scene is a compact canvas draw function (no external libs,
// GPU-friendly, theme-aware, reduced-motion safe). The builder injects
// a bootstrap that creates the canvas, reads the site's accent colors
// and runs the chosen scene behind the hero / site background.
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// THREE.JS SCENES — 40 professional WebGL 3D scenes (the pro tier).
// Each scene provides {body, tick}; the worker wraps them in a guarded
// Three.js boot (CDN, WebGL check, theme colors, reduced-motion, resize).
// Techniques inspired by researched award sites (galaxies, planets,
// oceans, cities, particle worlds, abstract sculptures).
// ════════════════════════════════════════════════════════════
const THREE_SCENES = {
tgalaxy:{name:'Galaxy Spiral (WebGL)',theme:'space',type:'three',body:`var geo=new THREE.BufferGeometry(),N=9000,pos=new Float32Array(N*3),col=new Float32Array(N*3);
for(var i=0;i<N;i++){var r=Math.pow(Math.random(),0.85)*62;var a=i*0.18;var x=Math.cos(a)*r,z=Math.sin(a)*r,y=(Math.random()-0.5)*1.3*(1-r/70);
pos[i*3]=x;pos[i*3+1]=y;pos[i*3+2]=z;var c=ac.clone().lerp(a2,r/70);col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var g=new THREE.Points(geo,new THREE.PointsMaterial({size:0.34,vertexColors:true,transparent:true,opacity:0.92,depthWrite:false,blending:THREE.AdditiveBlending}));
scene.add(g);cam.position.set(0,16,34);cam.lookAt(0,0,0);`,tick:`g.rotation.y+=0.0009;cam.position.x=Math.sin(t*0.08)*3;cam.lookAt(0,0,0);`},
tgalaxy2:{name:'Galaxy Arms (WebGL)',theme:'midnight-violet',type:'three',body:`var geo=new THREE.BufferGeometry(),N=7000,pos=new Float32Array(N*3),col=new Float32Array(N*3);
for(var i=0;i<N;i++){var a=i*0.7,tw=Math.floor(i/1400)%2,aa=a+tw*Math.PI;var r=Math.pow(Math.random(),0.8)*58;var x=Math.cos(aa)*r,z=Math.sin(aa)*r,y=(Math.random()-0.5)*0.9;
pos[i*3]=x;pos[i*3+1]=y;pos[i*3+2]=z;var c=ac.clone().lerp(a2,r/60);col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var g=new THREE.Points(geo,new THREE.PointsMaterial({size:0.3,vertexColors:true,transparent:true,opacity:0.9,depthWrite:false,blending:THREE.AdditiveBlending}));
scene.add(g);cam.position.set(0,12,30);cam.lookAt(0,0,0);`,tick:`g.rotation.y+=0.001;cam.position.y=12+Math.sin(t*0.15)*2;cam.lookAt(0,0,0);`},
tplanet:{name:'Planet & Ring (WebGL)',theme:'teal-aqua',type:'three',body:`var R=6;
var p=new THREE.Mesh(new THREE.SphereGeometry(R,48,48),new THREE.MeshStandardMaterial({color:ac,roughness:0.35,metalness:0.15}));
scene.add(p);
var rg=new THREE.Mesh(new THREE.RingGeometry(R*1.5,R*2.3,64),new THREE.MeshBasicMaterial({color:a2,side:THREE.DoubleSide,transparent:true,opacity:0.32}));rg.rotation.x=1.15;scene.add(rg);
var m=new THREE.Mesh(new THREE.SphereGeometry(1.1,24,24),new THREE.MeshStandardMaterial({color:t3,roughness:0.6}));scene.add(m);
scene.add(new THREE.AmbientLight(0xffffff,0.45));var l=new THREE.DirectionalLight(0xffffff,1.3);l.position.set(18,12,14);scene.add(l);
cam.position.set(0,5,22);`,tick:`p.rotation.y+=0.004;m.position.set(Math.cos(t*0.35)*11,0,Math.sin(t*0.35)*11);`},
tplanet2:{name:'Lava Planet (WebGL)',theme:'sunset',type:'three',body:`var R=6;
var p=new THREE.Mesh(new THREE.SphereGeometry(R,48,48),new THREE.MeshStandardMaterial({color:0x3a1608,roughness:0.9,metalness:0.05,flatShading:true}));
scene.add(p);
var glow=new THREE.Mesh(new THREE.SphereGeometry(R*1.02,32,32),new THREE.MeshBasicMaterial({color:ac,transparent:true,opacity:0.16,blending:THREE.AdditiveBlending}));scene.add(glow);
scene.add(new THREE.AmbientLight(0xffaa66,0.5));var l=new THREE.PointLight(ac,1.4,40);l.position.set(10,6,12);scene.add(l);
cam.position.set(0,4,20);`,tick:`p.rotation.y+=0.0025;glow.rotation.y+=0.0025;l.intensity=1.2+Math.sin(t*2)*0.3;`},
tplanet3:{name:'Ice Planet (WebGL)',theme:'glass-light',type:'three',body:`var R=6;
var p=new THREE.Mesh(new THREE.SphereGeometry(R,48,48),new THREE.MeshStandardMaterial({color:0xcfe8ff,roughness:0.2,metalness:0.4}));
scene.add(p);
var h=new THREE.Mesh(new THREE.SphereGeometry(R*1.01,32,32),new THREE.MeshStandardMaterial({color:ac2,emissive:ac2,emissiveIntensity:0.3,transparent:true,opacity:0.25}));scene.add(h);
scene.add(new THREE.AmbientLight(0xffffff,0.5));var l=new THREE.DirectionalLight(0xffffff,1.4);l.position.set(14,10,12);scene.add(l);
cam.position.set(0,5,20);`,tick:`p.rotation.y+=0.003;h.rotation.y+=0.003;`},
tcity:{name:'3D City Night (WebGL)',theme:'graphite',type:'three',body:`var g=new THREE.Group(),N=110;
for(var i=0;i<N;i++){var w=0.8+Math.random()*1.7,h=2+Math.random()*9,d=0.8+Math.random()*1.7;
var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color:0x141a26,roughness:0.85}));
m.position.set((Math.random()-0.5)*42,h/2,(Math.random()-0.5)*42);g.add(m);
if(Math.random()<0.55){var win=new THREE.Mesh(new THREE.PlaneGeometry(w*0.6,h*0.6),new THREE.MeshBasicMaterial({color:new THREE.Color().setHSL(0.1+Math.random()*0.06,0.9,0.5),transparent:true,opacity:0.85}));win.position.set(0,h/2+0.02,0);win.rotation.y=Math.PI/4;m.add(win);}}
scene.add(g);scene.add(new THREE.AmbientLight(0x8899ff,0.3));var l=new THREE.DirectionalLight(0xffffff,0.8);l.position.set(20,30,12);scene.add(l);
cam.position.set(0,17,30);cam.lookAt(0,0,0);`,tick:`g.rotation.y+=0.0012;`},
tcity2:{name:'Floating Islands (WebGL)',theme:'forest-dark',type:'three',body:`var g=new THREE.Group();
for(var i=0;i<7;i++){var r=2+Math.random()*3;
var rock=new THREE.Mesh(new THREE.ConeGeometry(r*0.9,r*2.4,7),new THREE.MeshStandardMaterial({color:0x3a4a3a,flatShading:true}));rock.position.y=-r*0.6;
var top=new THREE.Mesh(new THREE.CylinderGeometry(r,r*1.05,0.7,8),new THREE.MeshStandardMaterial({color:0x67c267,flatShading:true}));top.position.y=0.35;
var is=new THREE.Group();is.add(rock);is.add(top);
is.position.set((Math.random()-0.5)*30,Math.random()*4,(Math.random()-0.5)*30);is.rotation.y=Math.random()*3;g.add(is);}
scene.add(g);scene.add(new THREE.AmbientLight(0xaaddcc,0.5));var l=new THREE.DirectionalLight(0xffffff,1);l.position.set(12,20,8);scene.add(l);
cam.position.set(0,10,26);cam.lookAt(0,0,0);`,tick:`g.rotation.y+=0.0008;g.children.forEach(function(c,i){c.position.y+=Math.sin(t*0.7+i*2)*0.004;});`},
tocean:{name:'3D Ocean (WebGL)',theme:'teal-aqua',type:'three',body:`var geo=new THREE.PlaneGeometry(60,60,64,64);geo.rotateX(-Math.PI/2);
var m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:ac,roughness:0.25,metalness:0.5,flatShading:true}));scene.add(m);
scene.add(new THREE.AmbientLight(0xffffff,0.4));var l=new THREE.DirectionalLight(0xffffff,1.2);l.position.set(10,20,10);scene.add(l);
cam.position.set(0,9,20);cam.lookAt(0,0,0);`,tick:`var p=m.geometry.attributes.position;for(var i=0;i<p.count;i++){var x=p.getX(i),z=p.getZ(i);p.setY(i,Math.sin(x*0.28+t*1.2)*Math.cos(z*0.28+t*0.85)*0.9);}p.needsUpdate=true;m.geometry.computeVertexNormals();`},
tocean2:{name:'Wave Field (WebGL)',theme:'ocean-light',type:'three',body:`var geo=new THREE.PlaneGeometry(60,60,80,80);geo.rotateX(-Math.PI/2);
var m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:ac2,wireframe:false,roughness:0.3,metalness:0.4,flatShading:true}));scene.add(m);
scene.add(new THREE.AmbientLight(0xffffff,0.5));var l=new THREE.DirectionalLight(0xffffff,1.1);l.position.set(-8,14,10);scene.add(l);
cam.position.set(0,12,24);cam.lookAt(0,0,0);`,tick:`var p=m.geometry.attributes.position;for(var i=0;i<p.count;i++){var x=p.getX(i),z=p.getZ(i);p.setY(i,Math.sin(x*0.4+t*2.2)*Math.cos(z*0.3+t*1.4)*1.1+Math.sin(x*0.12-t*1.1)*0.6);}p.needsUpdate=true;m.geometry.computeVertexNormals();`},
tterrain:{name:'3D Mountains (WebGL)',theme:'forest-dark',type:'three',body:`var geo=new THREE.PlaneGeometry(80,80,70,70);geo.rotateX(-Math.PI/2);
var pos=geo.attributes.position;for(var i=0;i<pos.count;i++){var x=pos.getX(i),z=pos.getZ(i);var y=Math.sin(x*0.12)*Math.cos(z*0.12)*3+Math.sin(x*0.32+z*0.27)*1.6+Math.sin(x*0.05)*2;pos.setY(i,Math.max(0,y));}geo.computeVertexNormals();
var m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0x3d5a3d,roughness:0.9,flatShading:true}));scene.add(m);
scene.add(new THREE.AmbientLight(0xffffff,0.45));var l=new THREE.DirectionalLight(0xfff2cc,1.2);l.position.set(20,24,12);scene.add(l);
scene.fog=new THREE.Fog(0x0a120e,30,90);cam.position.set(0,14,30);cam.lookAt(0,2,0);`,tick:`cam.position.x=Math.sin(t*0.06)*6;cam.lookAt(0,2,0);`},
tterrain2:{name:'Lava Fields (WebGL)',theme:'sunset',type:'three',body:`var geo=new THREE.PlaneGeometry(70,70,60,60);geo.rotateX(-Math.PI/2);
var pos=geo.attributes.position;for(var i=0;i<pos.count;i++){var x=pos.getX(i),z=pos.getZ(i);pos.setY(i,Math.sin(x*0.15)*Math.cos(z*0.15)*2.4+Math.sin(x*0.4+z*0.35)*1);}geo.computeVertexNormals();
var m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0x2a1206,roughness:0.95,flatShading:true}));scene.add(m);
scene.add(new THREE.AmbientLight(0xff8844,0.4));var l=new THREE.PointLight(ac,1.6,50);l.position.set(0,6,0);scene.add(l);
cam.position.set(0,13,26);cam.lookAt(0,0,0);`,tick:`l.intensity=1.3+Math.sin(t*1.6)*0.5;m.rotation.y+=0.001;`},
tshapes:{name:'Abstract Sculpture (WebGL)',theme:'midnight-violet',type:'three',body:`var tk=new THREE.Mesh(new THREE.TorusKnotGeometry(2.6,0.8,120,20),new THREE.MeshStandardMaterial({color:ac,metalness:0.6,roughness:0.2}));tk.position.set(-7,0,0);scene.add(tk);
var ico=new THREE.Mesh(new THREE.IcosahedronGeometry(2.6,1),new THREE.MeshStandardMaterial({color:a2,metalness:0.5,roughness:0.25,flatShading:true}));ico.position.set(7,0,0);scene.add(ico);
var oct=new THREE.Mesh(new THREE.OctahedronGeometry(2.2,0),new THREE.MeshStandardMaterial({color:t3,metalness:0.5,roughness:0.25,flatShading:true}));oct.position.set(0,0,7);scene.add(oct);
var dod=new THREE.Mesh(new THREE.DodecahedronGeometry(2.4,0),new THREE.MeshStandardMaterial({color:ac2,metalness:0.5,roughness:0.3,flatShading:true}));dod.position.set(0,0,-7);scene.add(dod);
scene.add(new THREE.AmbientLight(0xffffff,0.5));var l=new THREE.DirectionalLight(0xffffff,1.4);l.position.set(10,14,10);scene.add(l);
cam.position.set(0,3,16);cam.lookAt(0,0,0);`,tick:`tk.rotation.x+=0.004;tk.rotation.y+=0.006;ico.rotation.x+=0.005;ico.rotation.y-=0.007;oct.rotation.x-=0.006;oct.rotation.z+=0.005;dod.rotation.y+=0.008;dod.rotation.x+=0.003;
[tk,ico,oct,dod].forEach(function(s,i){s.position.y=Math.sin(t*0.7+i*1.5)*0.5;});`},
tshapes2:{name:'Golden Shapes (WebGL)',theme:'luxury-dark',type:'three',body:`var mats=[new THREE.MeshStandardMaterial({color:ac,metalness:0.85,roughness:0.15}),new THREE.MeshStandardMaterial({color:ac2,metalness:0.85,roughness:0.15}),new THREE.MeshStandardMaterial({color:0xffffff,metalness:0.9,roughness:0.1})];
var shapes=[];
for(var i=0;i<9;i++){var g=[new THREE.TorusGeometry(1.5,0.5,20,40),new THREE.IcosahedronGeometry(1.6,0),new THREE.OctahedronGeometry(1.7,0),new THREE.BoxGeometry(2.4,2.4,2.4)][i%4];
var m=new THREE.Mesh(g,mats[i%3]);var a=i/9*Math.PI*2;m.position.set(Math.cos(a)*6,0,Math.sin(a)*6);scene.add(m);shapes.push(m);}
scene.add(new THREE.AmbientLight(0xffffff,0.4));var l=new THREE.PointLight(0xffffff,1.6,30);l.position.set(0,8,0);scene.add(l);
cam.position.set(0,7,14);cam.lookAt(0,0,0);`,tick:`shapes.forEach(function(s,i){s.rotation.x+=0.005*(i%3+1);s.rotation.y+=0.006*(i%2+1);s.position.y=Math.sin(t*0.6+i)*0.4;});`},
tparticles:{name:'Particle Tornado (WebGL)',theme:'cyberpunk',type:'three',body:`var geo=new THREE.BufferGeometry(),N=4500,pos=new Float32Array(N*3),col=new Float32Array(N*3);
for(var i=0;i<N;i++){var p=i/N,a=p*22,r=p*16,x=Math.cos(a)*r,y=p*26-13,z=Math.sin(a)*r;
x+=(Math.random()-0.5)*0.8;y+=(Math.random()-0.5)*0.8;z+=(Math.random()-0.5)*0.8;
pos[i*3]=x;pos[i*3+1]=y;pos[i*3+2]=z;var c=ac.clone().lerp(a2,p);col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var g=new THREE.Points(geo,new THREE.PointsMaterial({size:0.28,vertexColors:true,transparent:true,opacity:0.95,depthWrite:false,blending:THREE.AdditiveBlending}));
scene.add(g);cam.position.set(0,4,22);cam.lookAt(0,0,0);`,tick:`g.rotation.y+=0.004;`},
tparticles2:{name:'Particle Sphere (WebGL)',theme:'space',type:'three',body:`var geo=new THREE.BufferGeometry(),N=2600,pos=new Float32Array(N*3),col=new Float32Array(N*3);
for(var i=0;i<N;i++){var th=Math.random()*Math.PI*2,ph=Math.acos(2*Math.random()-1),r=9;
pos[i*3]=r*Math.sin(ph)*Math.cos(th);pos[i*3+1]=r*Math.cos(ph);pos[i*3+2]=r*Math.sin(ph)*Math.sin(th);
var c=ac.clone().lerp(t3,Math.random());col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var g=new THREE.Points(geo,new THREE.PointsMaterial({size:0.22,vertexColors:true,transparent:true,opacity:0.9,depthWrite:false,blending:THREE.AdditiveBlending}));
scene.add(g);cam.position.set(0,0,20);`,tick:`g.rotation.x+=0.0015;g.rotation.y+=0.002;`},
tparticles3:{name:'Helix Particles (WebGL)',theme:'teal-aqua',type:'three',body:`var geo=new THREE.BufferGeometry(),N=3000,pos=new Float32Array(N*3),col=new Float32Array(N*3);
for(var i=0;i<N;i++){var p=i/N,a=p*14,y=p*30-15,r=6;
for(var s2=0;s2<2;s2++){var x=(s2?Math.cos(a+Math.PI):Math.cos(a))*r,z=(s2?Math.sin(a+Math.PI):Math.sin(a))*r;
var c=ac.clone().lerp(t3,p);col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;pos[i*3]=x;pos[i*3+1]=y;pos[i*3+2]=z;}}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var g=new THREE.Points(geo,new THREE.PointsMaterial({size:0.25,vertexColors:true,transparent:true,opacity:0.9,depthWrite:false,blending:THREE.AdditiveBlending}));
scene.add(g);cam.position.set(0,2,24);cam.lookAt(0,0,0);`,tick:`g.rotation.y+=0.0035;`},
tgrid:{name:'Grid World (WebGL)',theme:'cyberpunk',type:'three',body:`var g=new THREE.GridHelper(70,36,ac,a2);g.position.y=-0.1;scene.add(g);
var cubes=[];for(var i=0;i<40;i++){var m=new THREE.Mesh(new THREE.BoxGeometry(0.8,0.8,0.8),new THREE.MeshStandardMaterial({color:i%3===0?ac:i%3===1?a2:t3,emissive:i%3===0?ac:new THREE.Color(0x000000),emissiveIntensity:0.4,metalness:0.4,roughness:0.4}));m.position.set((Math.random()-0.5)*50,0.5,(Math.random()-0.5)*50);m.rotation.set(Math.random(),Math.random(),Math.random());scene.add(m);cubes.push(m);}
scene.add(new THREE.AmbientLight(0xffffff,0.4));var l=new THREE.DirectionalLight(0xffffff,0.9);l.position.set(10,16,8);scene.add(l);
cam.position.set(0,16,26);cam.lookAt(0,0,0);`,tick:`cubes.forEach(function(m,i){m.rotation.x+=0.004*(i%3+1);m.rotation.y+=0.005*(i%2+1);m.position.y=0.5+Math.sin(t*0.8+i)*0.15;});g.material.opacity=0.55;`},
twireglobe:{name:'Wireframe Globe (WebGL)',theme:'slate-blue',type:'three',body:`var g=new THREE.Group(),R=8;
for(var i=0;i<=14;i++){var phi=(i/14)*Math.PI;var pts=[];for(var j=0;j<=60;j++){var th=(j/60)*Math.PI*2;pts.push(new THREE.Vector3(R*Math.sin(phi)*Math.cos(th),R*Math.cos(phi),R*Math.sin(phi)*Math.sin(th)));}
var lg=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:ac,transparent:true,opacity:0.45}));g.add(lg);}
for(var j2=0;j2<=16;j2++){var th2=(j2/16)*Math.PI*2;var pts2=[];for(var i2=0;i2<=60;i2++){var phi2=(i2/60)*Math.PI;pts2.push(new THREE.Vector3(R*Math.sin(phi2)*Math.cos(th2),R*Math.cos(phi2),R*Math.sin(phi2)*Math.sin(th2)));}
var lg2=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts2),new THREE.LineBasicMaterial({color:a2,transparent:true,opacity:0.3}));g.add(lg2);}
scene.add(g);cam.position.set(0,4,20);cam.lookAt(0,0,0);`,tick:`g.rotation.y+=0.002;g.rotation.x=Math.sin(t*0.2)*0.08;`},
tplanetrings:{name:'Ring Planet (WebGL)',theme:'cyberpunk',type:'three',body:`var R=5;
var p=new THREE.Mesh(new THREE.SphereGeometry(R,40,40),new THREE.MeshStandardMaterial({color:ac,roughness:0.5,metalness:0.3}));scene.add(p);
for(var i=0;i<3;i++){var rg=new THREE.Mesh(new THREE.RingGeometry(R*(1.4+i*0.35),R*(1.5+i*0.35),64),new THREE.MeshBasicMaterial({color:i===1?a2:ac,side:THREE.DoubleSide,transparent:true,opacity:0.35-i*0.08}));rg.rotation.x=1.25+i*0.1;scene.add(rg);}
scene.add(new THREE.AmbientLight(0xffffff,0.5));var l=new THREE.DirectionalLight(0xffffff,1.3);l.position.set(12,8,10);scene.add(l);
cam.position.set(0,3,18);`,tick:`p.rotation.y+=0.003;scene.rotation.y+=0.0006;`},
tnebula:{name:'Nebula Clouds (WebGL)',theme:'midnight-violet',type:'three',body:`var tex=(function(){var c2=document.createElement('canvas');c2.width=c2.height=64;var x=c2.getContext('2d');var gr=x.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,'rgba(255,255,255,0.9)');gr.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=gr;x.fillRect(0,0,64,64);return new THREE.CanvasTexture(c2);})();
var g=new THREE.Group();
for(var i=0;i<26;i++){var sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,color:i%2?ac.clone().multiplyScalar(1.6):a2.clone().multiplyScalar(1.6),transparent:true,opacity:0.16+Math.random()*0.12,blending:THREE.AdditiveBlending,depthWrite:false}));sp.scale.set(8+Math.random()*16,8+Math.random()*16,1);sp.position.set((Math.random()-0.5)*34,(Math.random()-0.5)*22,(Math.random()-0.5)*20);g.add(sp);}
scene.add(g);cam.position.set(0,0,24);`,tick:`g.rotation.y+=0.0005;g.children.forEach(function(s,i){s.position.y+=Math.sin(t*0.3+i)*0.01;});`},
tmeteors:{name:'Meteor Shower (WebGL)',theme:'space',type:'three',body:`var geo=new THREE.BufferGeometry(),N=300,pos=new Float32Array(N*3);
for(var i=0;i<N;i++){pos[i*3]=(Math.random()-0.5)*80;pos[i*3+1]=(Math.random()-0.5)*50;pos[i*3+2]=(Math.random()-0.5)*40;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
var stars=new THREE.Points(geo,new THREE.PointsMaterial({color:0xffffff,size:0.25,transparent:true,opacity:0.8}));scene.add(stars);
var tail=new THREE.BufferGeometry();var tp=new Float32Array(6);tail.setAttribute('position',new THREE.BufferAttribute(tp,3));
var line=new THREE.Line(tail,new THREE.LineBasicMaterial({color:ac,transparent:true,opacity:0.9}));scene.add(line);
cam.position.set(0,2,26);`,tick:`var x=t*22%90-45;var p=line.geometry.attributes.position;p.setX(0,x);p.setY(0,28);p.setZ(0,0);p.setX(1,x-8);p.setY(1,25.5);p.setZ(1,0);p.needsUpdate=true;stars.rotation.y+=0.0004;`},
tstarfield:{name:'Deep Starfield (WebGL)',theme:'space',type:'three',body:`var geo=new THREE.BufferGeometry(),N=2200,pos=new Float32Array(N*3);
for(var i=0;i<N;i++){pos[i*3]=(Math.random()-0.5)*120;pos[i*3+1]=(Math.random()-0.5)*80;pos[i*3+2]=(Math.random()-0.5)*80;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
var g=new THREE.Points(geo,new THREE.PointsMaterial({color:0xffffff,size:0.3,transparent:true,opacity:0.85,depthWrite:false}));scene.add(g);
cam.position.set(0,0,30);`,tick:`g.rotation.y+=0.0003;g.rotation.x=Math.sin(t*0.05)*0.05;`},
tblackhole:{name:'Black Hole (WebGL)',theme:'space',type:'three',body:`var core=new THREE.Mesh(new THREE.SphereGeometry(1.6,32,32),new THREE.MeshBasicMaterial({color:0x000000}));scene.add(core);
var disk=new THREE.Mesh(new THREE.RingGeometry(3,9,64),new THREE.MeshBasicMaterial({color:ac,side:THREE.DoubleSide,transparent:true,opacity:0.5}));disk.rotation.x=1.3;scene.add(disk);
var geo=new THREE.BufferGeometry(),N=1200,pos=new Float32Array(N*3);
for(var i=0;i<N;i++){var a=Math.random()*6.28,r=3+Math.random()*9;pos[i*3]=Math.cos(a)*r;pos[i*3+1]=(Math.random()-0.5)*0.8;pos[i*3+2]=Math.sin(a)*r;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
var g=new THREE.Points(geo,new THREE.PointsMaterial({color:a2,size:0.18,transparent:true,opacity:0.8,blending:THREE.AdditiveBlending,depthWrite:false}));scene.add(g);
cam.position.set(0,7,16);cam.lookAt(0,0,0);`,tick:`disk.rotation.z+=0.006;g.rotation.y+=0.008;core.scale.setScalar(1+Math.sin(t*3)*0.05);`},
taurora:{name:'Aurora Ribbons (WebGL)',theme:'lavender',type:'three',body:`var g=new THREE.Group();
for(var i=0;i<5;i++){var geo=new THREE.PlaneGeometry(50,1.6,40,1);var m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:i%2?ac:a2,transparent:true,opacity:0.22-i*0.03,side:THREE.DoubleSide,depthWrite:false}));m.position.y=-3+i*1.5;m.rotation.z=0.1;g.add(m);}
scene.add(g);cam.position.set(0,2,22);cam.lookAt(0,0,0);`,tick:`g.children.forEach(function(m,i){var p=m.geometry.attributes.position;for(var v=0;v<p.count;v++){var x=p.getX(v);p.setY(v,Math.sin(x*0.3+t*(0.8+i*0.2)+i*2)*1.6);}p.needsUpdate=true;});g.rotation.y=Math.sin(t*0.1)*0.2;`},
ttunnel:{name:'3D Tunnel (WebGL)',theme:'cyberpunk',type:'three',body:`var g=new THREE.Group();
for(var i=0;i<30;i++){var rg=new THREE.Mesh(new THREE.RingGeometry(7,7.8,48),new THREE.MeshBasicMaterial({color:i%3===0?ac:i%3===1?a2:t3,side:THREE.DoubleSide,transparent:true,opacity:0.5}));rg.position.z=-i*3;g.add(rg);}
scene.add(g);cam.position.set(0,0,0);`,tick:`g.children.forEach(function(r,i){r.position.z=((r.position.z+0.5)%90)-45;});g.rotation.z+=0.003;`},
tcubes3d:{name:'Floating Cubes (WebGL)',theme:'glass-dark',type:'three',body:`var g=new THREE.Group();
for(var i=0;i<26;i++){var s2=0.5+Math.random()*1.2;var m=new THREE.Mesh(new THREE.BoxGeometry(s2,s2,s2),new THREE.MeshStandardMaterial({color:i%3===0?ac:i%3===1?a2:t3,metalness:0.6,roughness:0.25}));m.position.set((Math.random()-0.5)*24,(Math.random()-0.5)*14,(Math.random()-0.5)*14);m.rotation.set(Math.random()*3,Math.random()*3,0);g.add(m);}
scene.add(g);scene.add(new THREE.AmbientLight(0xffffff,0.5));var l=new THREE.DirectionalLight(0xffffff,1.2);l.position.set(10,12,10);scene.add(l);
cam.position.set(0,2,24);`,tick:`g.children.forEach(function(m,i){m.rotation.x+=0.003*(i%3+1);m.rotation.y+=0.004*(i%2+1);m.position.y+=Math.sin(t*0.6+i)*0.004;});g.rotation.y+=0.0015;`},
twaves3d:{name:'Ribbon Waves (WebGL)',theme:'teal-aqua',type:'three',body:`var g=new THREE.Group();
for(var i=0;i<12;i++){var geo=new THREE.PlaneGeometry(60,1.4,50,1);var m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:i%2?ac:a2,transparent:true,opacity:0.16,side:THREE.DoubleSide,depthWrite:false}));m.rotation.x=-Math.PI/2.4;m.position.y=-4+i*0.75;g.add(m);}
scene.add(g);cam.position.set(0,8,24);cam.lookAt(0,0,0);`,tick:`g.children.forEach(function(m,i){var p=m.geometry.attributes.position;for(var v=0;v<p.count;v++){var x=p.getX(v);p.setY(v,Math.sin(x*0.15+t*(0.7+i*0.12)+i*2)*1.2);}p.needsUpdate=true;});`},
tdna:{name:'DNA Helix 3D (WebGL)',theme:'teal-aqua',type:'three',body:`var g=new THREE.Group();
for(var i=0;i<36;i++){var y=-8+i*0.45;var a=i*0.35;
var r1=new THREE.Mesh(new THREE.SphereGeometry(0.28,12,12),new THREE.MeshStandardMaterial({color:ac}));r1.position.set(Math.cos(a)*3,y,Math.sin(a)*3);g.add(r1);
var r2=new THREE.Mesh(new THREE.SphereGeometry(0.28,12,12),new THREE.MeshStandardMaterial({color:a2}));r2.position.set(Math.cos(a+Math.PI)*3,y,Math.sin(a+Math.PI)*3);g.add(r2);
var bar=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,6.1,6),new THREE.MeshStandardMaterial({color:t3,transparent:true,opacity:0.5}));bar.position.set(0,y,0);g.add(bar);}
scene.add(g);scene.add(new THREE.AmbientLight(0xffffff,0.5));var l=new THREE.DirectionalLight(0xffffff,1.2);l.position.set(8,10,10);scene.add(l);
cam.position.set(0,0,14);`,tick:`g.rotation.y+=0.006;`},
tsolarsystem:{name:'Solar System (WebGL)',theme:'space',type:'three',body:`var sun=new THREE.Mesh(new THREE.SphereGeometry(2.6,32,32),new THREE.MeshBasicMaterial({color:0xffdd77}));scene.add(sun);
var glow=new THREE.Mesh(new THREE.SphereGeometry(3,24,24),new THREE.MeshBasicMaterial({color:0xffaa44,transparent:true,opacity:0.18,blending:THREE.AdditiveBlending}));scene.add(glow);
var planets=[];
for(var i=0;i<6;i++){var r=6+i*2.2;var pr=0.4+i*0.22;var col=i%2?ac:a2;if(i===3)col=t3;
var m=new THREE.Mesh(new THREE.SphereGeometry(pr,20,20),new THREE.MeshStandardMaterial({color:col,roughness:0.5,metalness:0.2}));
planets.push({m:m,r:r,s:Math.random()*6.28,v:0.4+i*0.12});scene.add(m);
var orbit=new THREE.Line(new THREE.BufferGeometry().setFromPoints((function(){var p=[];for(var j=0;j<=64;j++){var a=j/64*6.28;p.push(new THREE.Vector3(Math.cos(a)*r,0,Math.sin(a)*r));}return p;})()),new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.12}));scene.add(orbit);}
scene.add(new THREE.AmbientLight(0xffffff,0.35));var l=new THREE.DirectionalLight(0xffffff,1.1);l.position.set(12,8,10);scene.add(l);
cam.position.set(0,10,24);cam.lookAt(0,0,0);`,tick:`sun.rotation.y+=0.002;glow.scale.setScalar(1+Math.sin(t*1.5)*0.05);planets.forEach(function(p){p.s+=0.01*p.v;var x=Math.cos(p.s)*p.r,z=Math.sin(p.s)*p.r;p.m.position.set(x,Math.sin(t+p.s)*0.4,z);p.m.rotation.y+=0.02;});`},
tcity3:{name:'Neon City (WebGL)',theme:'cyberpunk',type:'three',body:`var g=new THREE.Group(),N=90;
for(var i=0;i<N;i++){var w=0.9+Math.random()*1.6,h=2+Math.random()*8,d=0.9+Math.random()*1.6;
var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color:0x0e1220,roughness:0.7,metalness:0.5}));
m.position.set((Math.random()-0.5)*40,h/2,(Math.random()-0.5)*40);g.add(m);
if(Math.random()<0.6){var edge=new THREE.Mesh(new THREE.BoxGeometry(w+0.04,h+0.04,d+0.04),new THREE.MeshBasicMaterial({color:Math.random()<0.5?ac:a2,transparent:true,opacity:0.5,wireframe:true}));m.add(edge);}}
scene.add(g);scene.add(new THREE.AmbientLight(0x334488,0.5));var l=new THREE.PointLight(ac,1,40);l.position.set(0,18,0);scene.add(l);
cam.position.set(0,16,28);cam.lookAt(0,0,0);`,tick:`g.rotation.y+=0.0015;l.intensity=0.8+Math.sin(t*1.8)*0.4;`},
tvolcano:{name:'Volcano 3D (WebGL)',theme:'sunset',type:'three',body:`var cone=new THREE.Mesh(new THREE.ConeGeometry(4,6,12),new THREE.MeshStandardMaterial({color:0x3a2416,flatShading:true}));cone.position.y=-1;scene.add(cone);
var rock=new THREE.Mesh(new THREE.CylinderGeometry(5.5,7,3,12),new THREE.MeshStandardMaterial({color:0x2a1a10,flatShading:true}));rock.position.y=-4;scene.add(rock);
var lava=new THREE.Mesh(new THREE.CircleGeometry(1.2,12),new THREE.MeshBasicMaterial({color:ac,transparent:true,opacity:0.9}));lava.rotation.x=-Math.PI/2;lava.position.y=2;scene.add(lava);
var glow=new THREE.PointLight(ac,2,18);glow.position.y=2;scene.add(glow);
scene.add(new THREE.AmbientLight(0xffaa77,0.4));
var geo=new THREE.BufferGeometry(),N=500,pos=new Float32Array(N*3);geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
var pts=new THREE.Points(geo,new THREE.PointsMaterial({color:a2,size:0.3,transparent:true,opacity:0.9,blending:THREE.AdditiveBlending,depthWrite:false}));scene.add(pts);
cam.position.set(0,6,16);cam.lookAt(0,2,0);`,tick:`glow.intensity=1.4+Math.sin(t*3)*0.7;
var p=pts.geometry.attributes.position;for(var i=0;i<N;i++){var y=p.getY(i);if(y<0||Math.random()<0.02){p.setX(i,(Math.random()-0.5)*1.4);p.setZ(i,(Math.random()-0.5)*1.4);p.setY(i,2);}p.setY(i,y+0.12);p.setX(i,p.getX(i)+(Math.random()-0.5)*0.06);p.setZ(i,p.getZ(i)+(Math.random()-0.5)*0.06);}p.needsUpdate=true;`},
tmeteors2:{name:'Comet Trail (WebGL)',theme:'midnight-violet',type:'three',body:`var geo=new THREE.BufferGeometry(),N=200,pos=new Float32Array(N*3);
for(var i=0;i<N;i++){pos[i*3]=(Math.random()-0.5)*100;pos[i*3+1]=(Math.random()-0.5)*60;pos[i*3+2]=(Math.random()-0.5)*60;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
var stars=new THREE.Points(geo,new THREE.PointsMaterial({color:0xffffff,size:0.22,transparent:true,opacity:0.7}));scene.add(stars);
var trail=new THREE.BufferGeometry();var tp=new Float32Array(40*3);trail.setAttribute('position',new THREE.BufferAttribute(tp,3));
var line=new THREE.Line(trail,new THREE.LineBasicMaterial({color:ac,transparent:true,opacity:0.8}));scene.add(line);
cam.position.set(0,4,28);`,tick:`var cx=Math.cos(t*0.25)*24,cz=Math.sin(t*0.25)*24,cy=10+Math.sin(t*0.4)*4;
var p=line.geometry.attributes.position;for(var i=39;i>0;i--){p.setX(i,p.getX(i-1));p.setY(i,p.getY(i-1));p.setZ(i,p.getZ(i-1));}
p.setX(0,cx);p.setY(0,cy);p.setZ(0,cz);p.needsUpdate=true;`},
trose:{name:'Rose Curves (WebGL)',theme:'rose-elegant',type:'three',body:`var pts=[];
for(var i=0;i<400;i++){var a=i/400*Math.PI*2;var r=8*Math.cos(a*4);var x=Math.cos(a)*r,y=Math.sin(a)*r,z=(i/400-0.5)*4;
pts.push(new THREE.Vector3(x,y,z));}
var geo=new THREE.BufferGeometry().setFromPoints(pts);
var line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:ac,transparent:true,opacity:0.9}));scene.add(line);
scene.add(new THREE.AmbientLight(0xffffff,0.6));
cam.position.set(0,0,22);cam.lookAt(0,0,0);`,tick:`line.rotation.y+=0.004;line.rotation.x=Math.sin(t*0.3)*0.2;`},
tmeshfield:{name:'Mesh Field (WebGL)',theme:'graphite',type:'three',body:`var geo=new THREE.PlaneGeometry(70,70,50,50);geo.rotateX(-Math.PI/2);
var m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:ac,wireframe:true,transparent:true,opacity:0.35}));scene.add(m);
scene.add(new THREE.AmbientLight(0xffffff,0.6));
cam.position.set(0,14,26);cam.lookAt(0,0,0);`,tick:`var p=m.geometry.attributes.position;for(var i=0;i<p.count;i++){var x=p.getX(i),z=p.getZ(i);p.setY(i,Math.sin(x*0.15+t*1.2)*Math.cos(z*0.15+t*0.9)*1.2);}p.needsUpdate=true;m.rotation.y+=0.0008;`},
torbits:{name:'Orbital Rings (WebGL)',theme:'slate-blue',type:'three',body:`var g=new THREE.Group();
for(var i=0;i<8;i++){var r=3+i*1.6;var rg=new THREE.Mesh(new THREE.RingGeometry(r-0.08,r+0.08,64),new THREE.MeshBasicMaterial({color:i%2?ac:a2,side:THREE.DoubleSide,transparent:true,opacity:0.6}));rg.rotation.x=Math.PI/2+i*0.22;rg.rotation.z=i*0.4;g.add(rg);}
scene.add(g);scene.add(new THREE.AmbientLight(0xffffff,0.5));var l=new THREE.PointLight(0xffffff,1.2,30);l.position.set(0,6,0);scene.add(l);
cam.position.set(0,4,16);`,tick:`g.children.forEach(function(r,i){r.rotation.z+=0.002*(i%3+1);});g.rotation.y+=0.0012;`},
tabstract:{name:'Abstract Flow (WebGL)',theme:'midnight-violet',type:'three',body:`var pts=[];
for(var i=0;i<600;i++){var a=i*0.15;var r=Math.sin(i*0.02)*6;pts.push(new THREE.Vector3(Math.cos(a)*r,Math.sin(i*0.04)*4,Math.sin(a)*r));}
var geo=new THREE.BufferGeometry().setFromPoints(pts);
var line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:ac,transparent:true,opacity:0.85}));scene.add(line);
var pts2=[];for(var j=0;j<400;j++){var a2=j*0.2;var r2=Math.cos(j*0.03)*7;pts2.push(new THREE.Vector3(Math.cos(a2)*r2,Math.cos(j*0.05)*5,Math.sin(a2)*r2));}
var geo2=new THREE.BufferGeometry().setFromPoints(pts2);
var line2=new THREE.Line(geo2,new THREE.LineBasicMaterial({color:a2,transparent:true,opacity:0.6}));scene.add(line2);
cam.position.set(0,4,20);cam.lookAt(0,0,0);`,tick:`line.rotation.y+=0.004;line.rotation.x+=0.001;line2.rotation.y-=0.003;line2.rotation.x+=0.002;`},
tprisms:{name:'Light Prisms (WebGL)',theme:'lavender',type:'three',body:`var g=new THREE.Group();
for(var i=0;i<7;i++){var m=new THREE.Mesh(new THREE.ConeGeometry(1.2,2.6,4),new THREE.MeshStandardMaterial({color:i%2?ac:a2,metalness:0.7,roughness:0.15,flatShading:true}));var a=i/7*6.28;m.position.set(Math.cos(a)*8,0,Math.sin(a)*8);g.add(m);}
var core=new THREE.Mesh(new THREE.OctahedronGeometry(1.8,0),new THREE.MeshStandardMaterial({color:t3,metalness:0.7,roughness:0.15,flatShading:true}));g.add(core);
scene.add(g);scene.add(new THREE.AmbientLight(0xffffff,0.5));var l=new THREE.PointLight(0xffffff,1.5,30);l.position.set(0,7,0);scene.add(l);
cam.position.set(0,5,18);cam.lookAt(0,0,0);`,tick:`g.children.forEach(function(m,i){m.rotation.y+=0.006;m.rotation.x+=0.002;m.position.y=Math.sin(t*0.7+i)*0.4;});`},
tbiome:{name:'Biome Blobs (WebGL)',theme:'mint-fresh',type:'three',body:`var g=new THREE.Group();
for(var i=0;i<9;i++){var r=1.2+Math.random()*2;var m=new THREE.Mesh(new THREE.SphereGeometry(r,28,28),new THREE.MeshStandardMaterial({color:[ac,a2,t3][i%3],roughness:0.4,metalness:0.2,flatShading:true}));m.position.set((Math.random()-0.5)*20,(Math.random()-0.5)*10,(Math.random()-0.5)*10);g.add(m);}
scene.add(g);scene.add(new THREE.AmbientLight(0xffffff,0.55));var l=new THREE.DirectionalLight(0xffffff,1.1);l.position.set(10,12,8);scene.add(l);
cam.position.set(0,2,22);`,tick:`g.children.forEach(function(m,i){m.position.y+=Math.sin(t*0.5+i*1.3)*0.006;m.rotation.x+=0.002;m.rotation.y+=0.003;});g.rotation.y+=0.001;`},
tscifi:{name:'Sci-Fi Grid (WebGL)',theme:'cyberpunk',type:'three',body:`var grid=new THREE.GridHelper(80,40,ac,a2);grid.position.y=-3;scene.add(grid);
var geo=new THREE.BufferGeometry(),N=1500,pos=new Float32Array(N*3),col=new Float32Array(N*3);
for(var i=0;i<N;i++){pos[i*3]=(Math.random()-0.5)*50;pos[i*3+1]=Math.random()*18-3;pos[i*3+2]=(Math.random()-0.5)*50;var c=Math.random()<0.7?ac:a2;col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var g=new THREE.Points(geo,new THREE.PointsMaterial({size:0.16,vertexColors:true,transparent:true,opacity:0.85,blending:THREE.AdditiveBlending,depthWrite:false}));scene.add(g);
scene.add(new THREE.AmbientLight(0x334477,0.4));
cam.position.set(0,8,26);cam.lookAt(0,0,0);`,tick:`g.rotation.y+=0.002;grid.material.opacity=0.5+Math.sin(t)*0.15;`},
tcarousel:{name:'3D Carousel (WebGL)',theme:'sunset',type:'three',body:`var g=new THREE.Group();
for(var i=0;i<8;i++){var m=new THREE.Mesh(new THREE.BoxGeometry(2,3,0.4),new THREE.MeshStandardMaterial({color:[ac,a2,t3][i%3],metalness:0.5,roughness:0.3}));var a=i/8*6.28;m.position.set(Math.cos(a)*7,0,Math.sin(a)*7);m.rotation.y=-a;g.add(m);}
var hub=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,4,12),new THREE.MeshStandardMaterial({color:ac2,metalness:0.6}));g.add(hub);
scene.add(g);scene.add(new THREE.AmbientLight(0xffffff,0.5));var l=new THREE.DirectionalLight(0xffffff,1.2);l.position.set(10,12,8);scene.add(l);
cam.position.set(0,4,20);cam.lookAt(0,0,0);`,tick:`g.rotation.y+=0.004;g.children.forEach(function(m,i){if(i<8)m.position.y=Math.sin(t*0.8+i)*0.4;});`},
tgrid2:{name:'Checker World (WebGL)',theme:'graphite',type:'three',body:`var g=new THREE.Group();
for(var x=-4;x<=4;x++)for(var z=-4;z<=4;z++){var m=new THREE.Mesh(new THREE.BoxGeometry(1.8,1+((x+z)%3===0?0.8:0),1.8),new THREE.MeshStandardMaterial({color:(x+z)%2===0?0x333a44:0x22262e,roughness:0.8,metalness:0.3}));m.position.set(x*2,0.5,z*2);g.add(m);}
scene.add(g);scene.add(new THREE.AmbientLight(0xffffff,0.5));var l=new THREE.DirectionalLight(0xffffff,1);l.position.set(10,14,8);scene.add(l);
cam.position.set(0,12,20);cam.lookAt(0,0,0);`,tick:`g.rotation.y+=0.0012;`},
tribbon:{name:'Infinite Ribbon (WebGL)',theme:'ocean-light',type:'three',body:`var N=400,pts=[];
for(var i=0;i<N;i++)pts.push(new THREE.Vector3((i/N-0.5)*40,0,0));
var geo=new THREE.BufferGeometry().setFromPoints(pts);
var line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:ac,transparent:true,opacity:0.9}));scene.add(line);
var line2=new THREE.Line(geo.clone(),new THREE.LineBasicMaterial({color:a2,transparent:true,opacity:0.6}));scene.add(line2);
cam.position.set(0,3,20);cam.lookAt(0,0,0);`,tick:`var p=line.geometry.attributes.position;var p2=line2.geometry.attributes.position;
for(var i=0;i<N;i++){var x=(i/N-0.5)*40;var y=Math.sin(x*0.5+t*2)*2.2+Math.sin(x*0.22-t)*1.2;var y2=Math.cos(x*0.4+t*1.5)*2;var z=Math.sin(x*0.3+t*1.2)*0.6;var z2=Math.cos(x*0.2-t*0.8)*0.8;
p.setY(i,y);p.setZ(i,z);p2.setY(i,y2);p2.setZ(i,z2);}
p.needsUpdate=true;p2.needsUpdate=true;`},
};

// Three.js boot wrapper — guarded loader + theme colors + resize + reduced-motion.
const THREE_BOOT_HEAD = `(function(){
var mm=function(q){try{return (typeof matchMedia!=='undefined')?matchMedia(q).matches:false;}catch(e){return false;}};
if(mm('(prefers-reduced-motion: reduce)'))return;
var host=document.querySelector('.nx-scene-host');if(!host)return;
try{var _c=document.createElement('canvas');if(!(window.WebGLRenderingContext&&(_c.getContext('webgl')||_c.getContext('experimental-webgl')))){host.style.background='radial-gradient(circle at 30% 30%, rgba(120,120,160,.16), transparent 65%)';return;}}catch(e){return;}
function boot(){
var THREE=window.THREE;
var scene=new THREE.Scene();
var cam=new THREE.PerspectiveCamera(55,host.offsetWidth/Math.max(1,host.offsetHeight),0.1,2000);
var renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
renderer.setSize(host.offsetWidth,host.offsetHeight);
host.appendChild(renderer.domElement);
renderer.domElement.style.cssText='position:absolute;inset:0;width:100%;height:100%';
function resize(){var w=host.offsetWidth,h=host.offsetHeight;renderer.setSize(w,h);cam.aspect=w/Math.max(1,h);cam.updateProjectionMatrix();}
addEventListener('resize',resize,{passive:true});
var cs=getComputedStyle(document.documentElement);
function tc(n,d){var v=cs.getPropertyValue(n).trim();return v||d;}
var ac=new THREE.Color(tc('--accent','#f7742a'));var a2=new THREE.Color(tc('--accent2','#ffb24d'));var t3=new THREE.Color(tc('--teal','#2fb3a2'));
/*BODY*/
var t0=performance.now();
(function anim(now){var t=(now-t0)/1000;/*TICK*/renderer.render(scene,cam);requestAnimationFrame(anim);})(t0);
}
if(window.THREE)boot();else{var s=document.createElement('script');s.src='https://unpkg.com/three@0.160.0/build/three.min.js';s.onload=boot;document.head.appendChild(s);}
})();`;
function threeSceneScript(scene){return THREE_BOOT_HEAD.replace('/*BODY*/',scene.body).replace('/*TICK*/',scene.tick);}
// mini-3D engine helpers exposed to canvas scenes (perspective + rotation)
const M3 = {
  rot: function(x,y,z,rx,ry,rz){var cx=Math.cos(rx),sx=Math.sin(rx),cy=Math.cos(ry),sy=Math.sin(ry),cz=Math.cos(rz),sz=Math.sin(rz);
    var x1=x*cy+z*sy,y1=y,z1=-x*sy+z*cy;
    var x2=x1,y2=y1*cz-z1*sz,z2=y1*sz+z1*cz;
    var x3=x2*cy?0:0; // noop (kept for clarity)
    return [x2*1,y2,z2];},
  proj: function(x,y,z,cx,cy,f){f=f||300;var s=f/(f+z);return [cx+x*s,cy+y*s,s];},
};
// build the mini-3D helper block that canvas scenes can use
const M3_BOOT = `
function rot3(x,y,z,rx,ry,rz){var cx=Math.cos(rx),sx=Math.sin(rx),cy=Math.cos(ry),sy=Math.sin(ry),cz=Math.cos(rz),sz=Math.sin(rz);
var x1=x*cy+z*sy,y1=y,z1=-x*sy+z*cy;
var y2=y1*cz-z1*sz,z2=y1*sz+z1*cz;
return [x1,y2,z2];}
function proj3(x,y,z,cx,cy){var s=300/(300+z);return [cx+x*s,cy+y*s,s];}
function dot3(x,y,z,r,c,a){var p=proj3(x,y,z,W/2,H/2);if(p[2]<=0.02)return;var al=a*(p[2]>1?1:p[2]);ctx.beginPath();ctx.arc(p[0],p[1],Math.max(0.3,r*p[2]),0,6.2832);ctx.fillStyle='rgba('+c[0]+','+c[1]+','+c[2]+','+al+')';ctx.fill();}
function line3(x1,y1,z1,x2,y2,z2,c,a,w){var p=proj3(x1,y1,z1,W/2,H/2),q=proj3(x2,y2,z2,W/2,H/2);if(p[2]<=0.02||q[2]<=0.02)return;ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.strokeStyle='rgba('+c[0]+','+c[1]+','+c[2]+','+(a*Math.min(1,(p[2]+q[2])/2))+')';ctx.lineWidth=(w||1)*(p[2]+q[2])/2;ctx.stroke();}
function mesh3(pts,faces,c,a,w,rot){var R=rot||[0,0,0];var P=[];for(var i=0;i<pts.length;i++){var r=rot3(pts[i][0],pts[i][1],pts[i][2],R[0],R[1],R[2]);P.push(proj3(r[0],r[1],r[2],W/2,H/2));}
for(var f2=0;f2<faces.length;f2++){var fc=faces[f2];ctx.beginPath();for(var j=0;j<fc.length;j++){var q=P[fc[j]];if(j===0)ctx.moveTo(q[0],q[1]);else ctx.lineTo(q[0],q[1]);}ctx.closePath();ctx.fillStyle='rgba('+c[0]+','+c[1]+','+c[2]+','+(a||0.1)+')';ctx.fill();if(w){ctx.strokeStyle='rgba('+c[0]+','+c[1]+','+c[2]+','+w+')';ctx.lineWidth=1*D;ctx.stroke();}}}`;

// ════════════════════════════════════════════════════════════
// REAL 3D WEBSITE GALLERY — 30 sites found via research (2024-2026),
// each with its URL, creator, standout 3D technique, and what to
// "steal" from it. Opens the real site in a new tab.
// ════════════════════════════════════════════════════════════
const SITE_GALLERY = [
  { name: 'Oryzo', url: 'https://oryzo.ai', creator: 'Lusion', year: 2026, technique: 'Inertial 3D product render + Z-depth scroll', steal: 'Sell one object with weight, inertia and depth.' },
  { name: 'IVRESS', url: 'https://ivress.com', creator: 'Utsubo', year: 2026, technique: 'WebGPU + WebGL fallback (one shader codebase)', steal: 'Keep a fallback so 3D never breaks on old devices.' },
  { name: 'Lacoste Ace Breaker', url: 'https://www.lacoste.com', creator: 'Lacoste', year: 2026, technique: 'Branded Three.js arcade micro-game', steal: 'A micro-game as a campaign hook.' },
  { name: 'Shopify Editions', url: 'https://www.shopify.com/editions', creator: 'Shopify', year: 2026, technique: 'Scroll-sequenced 3D product reveal', steal: 'Scroll as the narrative device.' },
  { name: 'Hubtown', url: 'https://hubtown.com', creator: 'Unseen Studio', year: 2026, technique: '3D hero monolith + mouse-reveal', steal: '3D to dignify a B2B brand.' },
  { name: 'Sleep Well Creative', url: 'https://sleepwellcreative.com', creator: 'Sleep Well Creative', year: 2026, technique: 'Scroll-driven illustrated 3D narrative', steal: 'Editorial storytelling in a 3D scene.' },
  { name: 'Explore Primland', url: 'https://explore.ownprimland.com', creator: 'Primland', year: 2026, technique: 'Cinematic 3D landscape flythrough', steal: 'A place made explorable from the air.' },
  { name: 'Cartier Watches & Wonders', url: 'https://www.cartier.com/watchesandwonders', creator: 'Immersive Garden', year: 2026, technique: 'Six scrollable 3D rooms, one per watch', steal: 'One room per item — a catalog as an exhibition.' },
  { name: 'Bruno Simon Portfolio', url: 'https://bruno-simon.com', creator: 'Bruno Simon', year: 2024, technique: 'Interactive 3D driving world as navigation', steal: 'Turn navigation into a playable world.' },
  { name: 'Active Theory', url: 'https://activetheory.net', creator: 'Active Theory', year: 2025, technique: 'Gamified 3D environment — you navigate through', steal: 'Sections as locations, not scroll stops.' },
  { name: 'Resn', url: 'https://resn.co.nz', creator: 'Resn', year: 2025, technique: 'Surreal interactive universe with floating elements', steal: 'Unpredictable navigation keeps attention.' },
  { name: 'Species in Pieces', url: 'http://species-in-pieces.com', creator: 'Bryan James', year: 2024, technique: '30 endangered species from morphing triangular fragments', steal: 'Abstract geometric identity systems.' },
  { name: 'Nomadic Tribe', url: 'https://nomadictribe.com', creator: 'Merci-Michel', year: 2024, technique: 'Cinematic scroll-based storytelling across landscapes', steal: 'Landscape transitions as story beats.' },
  { name: 'DeepSee Commerce', url: 'https://deepsee.commerce', creator: 'DeepSee', year: 2025, technique: 'Underwater iceberg 3D scene, scroll-descended with depth fog', steal: 'Depth fog + light scattering for atmosphere.' },
  { name: 'Iventions', url: 'https://ivensions.com', creator: 'SERIOUS.BUSINESS', year: 2025, technique: 'Spotlight-driven 3D storytelling (WebGL + GSAP)', steal: 'One spotlight object per section.' },
  { name: 'fromanother', url: 'https://fromanother.com', creator: 'fromanother', year: 2025, technique: 'Custom GLSL shaders — identity that refracts like glass', steal: 'The shader IS the brand identity.' },
  { name: 'Mat Voyce', url: 'https://matvoyce.tv', creator: 'Uncommon Studio', year: 2025, technique: 'Kinetic typography pushed to the edge (GSAP)', steal: 'Choreograph every transition.' },
  { name: 'Ricardo Chance Portfolio', url: 'https://www.ricardochance.com', creator: 'Ricardo Chance', year: 2025, technique: 'WebGL gallery — Site of the Day', steal: 'Let the work live in 3D space.' },
  { name: 'United Carriers', url: 'https://unitedcarriers.com', creator: 'United Carriers', year: 2024, technique: '3D logistics visualization — Site of the Day', steal: 'Make an industrial brand feel engineered.' },
  { name: 'Dat.City', url: 'https://dat.city', creator: 'Dat.City', year: 2024, technique: '3D data city visualization', steal: 'Turn data into a walkable 3D city.' },
  { name: 'Jay Ransijn', url: 'https://jayransijn.com', creator: 'Jay Ransijn', year: 2024, technique: 'Interactive 3D game portfolio', steal: 'Portfolio as a playable level.' },
  { name: 'Quantales', url: 'https://quantales.in', creator: 'Quantales', year: 2024, technique: 'Interactive animated story in 3D', steal: '3D scenes between story chapters.' },
  { name: '4x4 Builder', url: 'https://4x4builder.com', creator: '4x4', year: 2024, technique: '3D vehicle configurator', steal: 'Configure products in 3D.' },
  { name: 'Terrain Rider', url: 'https://terrainrider.com', creator: 'Terrain Rider', year: 2024, technique: '3D terrain traversal', steal: 'Perspective terrain builds speed.' },
  { name: 'Face Flight', url: 'https://face-flight.com', creator: 'Face Flight', year: 2024, technique: '3D facial mapping flight', steal: 'Unexpected subjects make 3D memorable.' },
  { name: 'SneakerSketch', url: 'https://mause.nl/sneakersketch', creator: 'Mause', year: 2024, technique: '3D sneaker sketching tool', steal: 'Let users draw on 3D objects.' },
  { name: 'Expeditione', url: 'https://expeditione.fun', creator: 'Expeditione', year: 2025, technique: 'Interactive 3D encyclopedia', steal: '3D objects as knowledge.' },
  { name: 'Kleines Atrium', url: 'https://kleinesatrium.de', creator: 'Christopher Löw', year: 2024, technique: 'Immersive 3D garden experience', steal: 'Nature scenes soothe and impress.' },
  { name: 'Design the Next iPhone', url: 'https://neal.fun/design-the-next-iphone/', creator: 'Neal.fun', year: 2024, technique: '3D product designer in the browser', steal: 'Fun 3D tools go viral.' },
  { name: 'WebGL Jewelry', url: 'https://webgi-jewelry.vercel.app', creator: 'Pixotronics', year: 2024, technique: 'Photoreal 3D jewelry viewer', steal: 'Material realism sells luxury.' },
  { name: 'Lacoste Ace Breaker', url: 'https://www.lacoste.com', creator: 'Lacoste', year: 2026, technique: 'Branded Three.js arcade micro-game', steal: 'A micro-game as a campaign hook.' },
  { name: 'IVRESS', url: 'https://ivress.com', creator: 'Utsubo', year: 2026, technique: 'WebGPU + WebGL fallback', steal: 'One shader codebase, both backends.' },
  { name: 'Shopify Editions', url: 'https://www.shopify.com/editions', creator: 'Shopify', year: 2026, technique: 'Scroll-sequenced 3D product reveal', steal: 'Scroll as the narrative device.' },
  { name: 'Hubtown', url: 'https://hubtown.com', creator: 'Unseen Studio', year: 2026, technique: '3D hero monolith + mouse-reveal', steal: '3D to dignify a B2B brand.' },
  { name: 'Sleep Well Creative', url: 'https://sleepwellcreative.com', creator: 'Sleep Well Creative', year: 2026, technique: 'Scroll-driven 3D narrative', steal: 'Editorial storytelling in 3D.' },
  { name: 'Cartier Watches & Wonders', url: 'https://www.cartier.com/watchesandwonders', creator: 'Immersive Garden', year: 2026, technique: 'Six scrollable 3D rooms', steal: 'One room per item — a catalog as an exhibition.' },
  { name: 'Active Theory', url: 'https://activetheory.net', creator: 'Active Theory', year: 2025, technique: 'Gamified 3D environment', steal: 'Sections as locations.' },
  { name: 'Resn', url: 'https://resn.co.nz', creator: 'Resn', year: 2025, technique: 'Surreal interactive universe', steal: 'Unpredictable navigation.' },
  { name: 'Nomadic Tribe', url: 'https://nomadictribe.com', creator: 'Merci-Michel', year: 2024, technique: 'Scroll-based cinematic storytelling', steal: 'Landscapes as story beats.' },
  { name: 'DeepSee Commerce', url: 'https://deepsee.commerce', creator: 'DeepSee', year: 2025, technique: 'Underwater iceberg 3D + depth fog', steal: 'Depth fog + light scattering.' },
  { name: 'Iventions', url: 'https://ivensions.com', creator: 'SERIOUS.BUSINESS', year: 2025, technique: 'Spotlight-driven 3D storytelling', steal: 'One spotlight object per section.' },
  { name: 'fromanother', url: 'https://fromanother.com', creator: 'fromanother', year: 2025, technique: 'Custom GLSL shaders as identity', steal: 'The shader IS the brand.' },
  { name: 'Mat Voyce', url: 'https://matvoyce.tv', creator: 'Uncommon Studio', year: 2025, technique: 'Kinetic typography (GSAP)', steal: 'Choreograph every transition.' },
  { name: 'Ricardo Chance', url: 'https://www.ricardochance.com', creator: 'Ricardo Chance', year: 2025, technique: 'WebGL gallery — Site of the Day', steal: 'Let the work live in 3D space.' },
  { name: 'United Carriers', url: 'https://unitedcarriers.com', creator: 'United Carriers', year: 2024, technique: '3D logistics visualization', steal: 'Industrial brands feel engineered.' },
  { name: 'Dat.City', url: 'https://dat.city', creator: 'Dat.City', year: 2024, technique: '3D data city', steal: 'Data as a walkable city.' },
  { name: 'Jay Ransijn', url: 'https://jayransijn.com', creator: 'Jay Ransijn', year: 2024, technique: 'Interactive 3D game portfolio', steal: 'Portfolio as a playable level.' },
  { name: 'Quantales', url: 'https://quantales.in', creator: 'Quantales', year: 2024, technique: 'Interactive animated 3D story', steal: '3D scenes between chapters.' },
  { name: '4x4 Builder', url: 'https://4x4builder.com', creator: '4x4', year: 2024, technique: '3D vehicle configurator', steal: 'Configure products in 3D.' },
  { name: 'Terrain Rider', url: 'https://terrainrider.com', creator: 'Terrain Rider', year: 2024, technique: '3D terrain traversal', steal: 'Perspective builds speed.' },
  { name: 'Face Flight', url: 'https://face-flight.com', creator: 'Face Flight', year: 2024, technique: '3D facial mapping flight', steal: 'Unexpected subjects in 3D.' },
  { name: 'SneakerSketch', url: 'https://mause.nl/sneakersketch', creator: 'Mause', year: 2024, technique: '3D sneaker sketching', steal: 'Draw on 3D objects.' },
  { name: 'Expeditione', url: 'https://expeditione.fun', creator: 'Expeditione', year: 2025, technique: 'Interactive 3D encyclopedia', steal: '3D objects as knowledge.' },
  { name: 'Kleines Atrium', url: 'https://kleinesatrium.de', creator: 'Christopher Löw', year: 2024, technique: 'Immersive 3D garden', steal: 'Nature scenes soothe.' },
  { name: 'Design the Next iPhone', url: 'https://neal.fun/design-the-next-iphone/', creator: 'Neal.fun', year: 2024, technique: '3D product designer in browser', steal: 'Fun 3D tools go viral.' },
  { name: 'GalTech Vision', url: 'https://galtechvision.com', creator: 'GalTech', year: 2025, technique: '3D product visualization', steal: 'Hero product in 3D.' },
  { name: 'BTC War', url: 'https://btcwar.net', creator: 'BTC War', year: 2024, technique: '3D battle visualization', steal: 'Conflict as 3D spectacle.' },
  { name: 'Arcana Tarot', url: 'https://arcanatarotreading.com', creator: 'Arcana', year: 2024, technique: 'WebGL card gallery', steal: 'Mystery through 3D lighting.' },
  { name: 'Unfor Portfolio', url: 'https://unfor-dev.vercel.app', creator: 'Unfor', year: 2025, technique: '3D portfolio — Site of the Day', steal: 'Motion earns attention.' },
  { name: 'Oimachi', url: 'https://oimachi.com', creator: 'Oimachi', year: 2026, technique: 'Developer Award 3D build', steal: 'Tight choreography wins awards.' },
  { name: 'Cipher', url: 'https://cipher.agency', creator: 'Magnetism', year: 2026, technique: 'Developer Award + SOTD 3D', steal: 'Direction beats decoration.' },
  { name: 'LIKOVA', url: 'https://likova.com', creator: 'Vide Infra', year: 2026, technique: '3D agency site — Developer Award', steal: 'Let 3D carry the story.' },
  { name: 'Michael Gatt', url: 'https://michaelgatt.co', creator: 'Synchronized Studio', year: 2026, technique: '3D portfolio — SOTD', steal: 'Personal work in 3D space.' },
  { name: 'PX PUSH', url: 'https://pxpush.com', creator: 'Lewis Webber', year: 2026, technique: '3D creative site — Developer Award', steal: 'Bold 3D typography.' },
  { name: 'HAOQI.DESIGN', url: 'https://haoqi.design', creator: 'curiosity-wen', year: 2026, technique: '3D design portfolio — SOTD', steal: 'Interactions earn attention.' },
  { name: 'Mosby\'s Files', url: 'https://mosbysfiles.com', creator: 'Tubik', year: 2026, technique: '3D storytelling — Developer Award', steal: 'Files as 3D objects.' },
  { name: 'Revelatio Studio', url: 'https://revelatio.studio', creator: 'Revelatio', year: 2026, technique: '3D studio site — SOTD', steal: 'Reveal as the motif.' },
  { name: 'Studio K95', url: 'https://studiok95.com', creator: 'Studio K95', year: 2026, technique: '3D portfolio — SOTD', steal: 'Precision in motion.' },
  { name: 'NOTHIN\'', url: 'https://nothin.co', creator: 'Thomas Carré', year: 2026, technique: '3D minimal site — Developer Award', steal: 'Nothing extra = everything.' },
  { name: 'Produx Design', url: 'https://produx.design', creator: 'Prødux', year: 2026, technique: '3D product design site — SOTD', steal: 'Product in orbit.' },
  { name: 'Vero New-York', url: 'https://vero.newyork', creator: 'Rodéo studio', year: 2026, technique: '3D fashion site — SOTD', steal: 'Fabric physics in 3D.' },
  { name: 'Alethia', url: 'https://alethia.co', creator: 'hellohello', year: 2026, technique: '3D storytelling — SOTD', steal: 'Light as narrative.' },
  { name: 'Serotoninn', url: 'https://serotoninn.com', creator: 'BL/S®', year: 2026, technique: '3D e-commerce — Honors + SOTD', steal: 'Product worlds, not pages.' },
  { name: 'Noomo Showcase', url: 'https://noomo.co', creator: 'Noomo', year: 2026, technique: '3D agency showcase — SOTD', steal: 'Work as a gallery.' },
  { name: '2xA Studio', url: 'https://2xastudio.com', creator: '2xA', year: 2026, technique: '3D creative studio — SOTD', steal: 'Bold geometry.' },
  { name: 'CIAO ENERGY', url: 'https://ciao.energy', creator: 'Skaald', year: 2026, technique: '3D brand launch — SOTD', steal: 'Launch with a world.' },
  { name: 'Paul Kalkbrenner', url: 'https://paulkalkbrenner.net', creator: 'HOLOGRAPHIK', year: 2026, technique: '3D artist site — Honorable Mention', steal: 'Music visuals in 3D.' },
  { name: 'Neoconda', url: 'https://neoconda.com', creator: 'Parentheses', year: 2026, technique: '3D narrative — Honorable Mention', steal: 'Serpentine motion.' },
  { name: 'Rechroma', url: 'https://rechroma.com', creator: 'elio', year: 2026, technique: '3D color site — Honorable Mention', steal: 'Color as 3D material.' },
  { name: 'Made With GSAP', url: 'https://madewithgsap.com', creator: 'Florent Roux-Durraffourt', year: 2026, technique: '3D motion gallery — Developer Award', steal: 'Motion gallery = inspiration.' },
  { name: 'WebGL Gallery', url: 'https://experiments.ricardochance.com/webgl-gallery', creator: 'Ricardo Chance', year: 2025, technique: 'WebGL experiment gallery', steal: 'Experiment publicly.' },
  { name: 'Pirates in the Sea', url: 'https://adapt-three-js-water-bmff.bolt.host', creator: 'Adapt', year: 2024, technique: 'Three.js water scene', steal: 'Water shaders sell stories.' },
  { name: 'FacetLab', url: 'https://4cs.co.za/diamond-polishing-game/', creator: '4Cs', year: 2024, technique: '3D diamond polishing game', steal: 'Learn through 3D play.' },
  { name: 'JT\'s Portfolio', url: 'https://jaimetorrealba.com', creator: 'Jaime Torrealba', year: 2024, technique: '3D portfolio', steal: 'Depth shows skill.' },
  { name: 'AL Noble Perfume', url: 'https://al-noble-v2.vercel.app', creator: 'AL Noble', year: 2024, technique: '3D perfume storytelling', steal: 'Luxury = material + light.' },
];

const SITE_SCENES = {
  starfield: { name: 'Starfield 3D', theme: 'space', desc: 'A deep-space star tunnel flying toward you — perfect for tech, space and startup sites.', fn: `var stars=[];for(var i=0;i<160;i++)stars.push({x:Math.random()*2-1,y:Math.random()*2-1,z:Math.random()});var ac=hex2rgb(C.a);function draw(){ctx.fillStyle='rgba(0,0,0,0)';for(var i=0;i<stars.length;i++){var s=stars[i];s.z-=0.004;if(s.z<=0){s.x=Math.random()*2-1;s.y=Math.random()*2-1;s.z=1;}var px=(s.x/s.z)*W*0.4+W/2;var py=(s.y/s.z)*H*0.4+H/2;if(px<0||px>W||py<0||py>H)continue;var r=(1-s.z)*2.2*D;var al=(1-s.z);ctx.beginPath();ctx.arc(px,py,r,0,6.2832);ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+al+')';ctx.fill();}}draw();` },
  particles: { name: 'Particle Field', theme: 'glass-dark', desc: 'Floating glowing particles drifting in 3D space.', fn: `var ps=[];for(var i=0;i<90;i++)ps.push({x:Math.random()*W,y:Math.random()*H,z:Math.random()*3});var ac=hex2rgb(C.a);function draw(){for(var i=0;i<ps.length;i++){var p=ps[i];p.y-=0.3*D*(p.z*0.4+0.3);p.x+=Math.sin(t*0.6+i)*0.2*D;p.z+=0.002;if(p.y<-10||p.z>3.4){p.y=H+10;p.z=Math.random();}var r=(0.5+p.z*1.2)*D;ctx.beginPath();ctx.arc(p.x,p.y,r,0,6.2832);ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.25+p.z*0.2)+')';ctx.fill();}}draw();` },
  grid: { name: '3D Grid Floor', theme: 'cyberpunk', desc: 'A retro-futuristic wireframe grid floor with perspective depth.', fn: `var gs=44;var off=t*0.5;ctx.strokeStyle='rgba('+hex2rgb(C.a).join(',')+',0.5)';ctx.lineWidth=1*D;for(var i=-1;i<=Math.ceil(W/gs)+1;i++){var x=(i*gs)%W;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+gs*2,H*0.7);ctx.stroke();}for(var j=0;j<=Math.ceil(H*0.7/gs);j++){var y=H*0.7-j*gs+off%gs;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y+gs*3);ctx.stroke();}` },
  orbs: { name: 'Floating Orbs', theme: 'midnight-violet', desc: 'Soft glowing 3D orbs bobbing in space.', fn: `var os=[];for(var i=0;i<8;i++)os.push({x:Math.random()*W,y:Math.random()*H,r:(40+Math.random()*90)*D,a:Math.random()*6.28,s:(0.3+Math.random()*0.7)});var ac=hex2rgb(C.a2||C.a);function draw(){for(var i=0;i<os.length;i++){var o=os[i];o.a+=0.008*o.s;var x=o.x+Math.sin(o.a)*60*D;var y=o.y+Math.cos(o.a*0.8)*40*D;var g=ctx.createRadialGradient(x,y,0,x,y,o.r);g.addColorStop(0,'rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.35)');g.addColorStop(1,'rgba('+ac[0]+','+ac[1]+','+ac[2]+',0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,o.r,0,6.2832);ctx.fill();}}draw();` },
  rain: { name: '3D Rain', theme: 'slate-blue', desc: 'Falling light streaks like digital rain with depth.', fn: `var rs=[];for(var i=0;i<110;i++)rs.push({x:Math.random()*W,y:Math.random()*H,l:(30+Math.random()*60)*D,v:(3+Math.random()*6)*D});var ac=hex2rgb(C.a);function draw(){ctx.lineWidth=1*D;for(var i=0;i<rs.length;i++){var r=rs[i];r.y+=r.v;if(r.y>H+50){r.y=-50;r.x=Math.random()*W;}var g=ctx.createLinearGradient(r.x,r.y,r.x,r.y+r.l);g.addColorStop(0,'rgba('+ac[0]+','+ac[1]+','+ac[2]+',0)');g.addColorStop(1,'rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.45)');ctx.strokeStyle=g;ctx.beginPath();ctx.moveTo(r.x,r.y);ctx.lineTo(r.x-r.l*0.2,r.y+r.l);ctx.stroke();}}draw();` },
  snow: { name: 'Snowfall', theme: 'glass-light', desc: 'Gentle 3D snow drifting down.', fn: `var sn=[];for(var i=0;i<80;i++)sn.push({x:Math.random()*W,y:Math.random()*H,r:(1+Math.random()*2.4)*D,v:(0.4+Math.random()*0.9)*D,w:Math.random()*6.28});function draw(){for(var i=0;i<sn.length;i++){var s=sn[i];s.y+=s.v;s.w+=0.02;s.x+=Math.sin(s.w)*0.5*D;if(s.y>H+8){s.y=-8;s.x=Math.random()*W;}ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,6.2832);ctx.fillStyle='rgba(255,255,255,'+(0.5+Math.random()*0.2)+')';ctx.fill();}}draw();` },
  bubbles: { name: 'Rising Bubbles', theme: 'teal-aqua', desc: 'Translucent 3D bubbles rising with light.', fn: `var bs=[];for(var i=0;i<26;i++)bs.push({x:Math.random()*W,y:Math.random()*H,r:(3+Math.random()*16)*D,v:(0.6+Math.random()*1.4)*D});var ac=hex2rgb(C.t);function draw(){for(var i=0;i<bs.length;i++){var b=bs[i];b.y-=b.v;b.x+=Math.sin(t*0.8+i)*0.3*D;if(b.y<-20){b.y=H+20;b.x=Math.random()*W;}ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,6.2832);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.5)';ctx.lineWidth=1*D;ctx.stroke();ctx.beginPath();ctx.arc(b.x-b.r*0.3,b.y-b.r*0.3,b.r*0.16,0,6.2832);ctx.fillStyle='rgba(255,255,255,0.7)';ctx.fill();}}draw();` },
  fireflies: { name: 'Fireflies', theme: 'forest-dark', desc: 'Warm glowing dots drifting like fireflies at night.', fn: `var fs=[];for(var i=0;i<45;i++)fs.push({x:Math.random()*W,y:Math.random()*H,p:Math.random()*6.28,s:(0.5+Math.random()*1.2)});var ac=hex2rgb(C.amber||C.a);function draw(){for(var i=0;i<fs.length;i++){var f=fs[i];f.p+=0.01*f.s;var x=f.x+Math.sin(f.p)*30*D;var y=f.y+Math.cos(f.p*0.7)*20*D;var tw=0.4+Math.sin(f.p*2)*0.35;var g=ctx.createRadialGradient(x,y,0,x,y,8*D);g.addColorStop(0,'rgba('+ac[0]+','+ac[1]+','+ac[2]+','+tw+')');g.addColorStop(1,'rgba('+ac[0]+','+ac[1]+','+ac[2]+',0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,8*D,0,6.2832);ctx.fill();}}draw();` },
  aurora: { name: 'Aurora Waves', theme: 'lavender', desc: 'Smooth flowing aurora light bands across the sky.', fn: `var ac=hex2rgb(C.a),ac2=hex2rgb(C.a2||C.t);function draw(){for(var b=0;b<3;b++){ctx.beginPath();ctx.moveTo(0,H);for(var x=0;x<=W;x+=8){var y=H*0.5+Math.sin(x*0.004+t*(0.4+b*0.2)+b*2)*H*0.12+Math.sin(x*0.011-t*0.3+b)*H*0.05;ctx.lineTo(x,y);}ctx.lineTo(W,H);ctx.closePath();var col=b%2?ac:ac2;var g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'rgba('+col[0]+','+col[1]+','+col[2]+',0.16)');g.addColorStop(1,'rgba('+col[0]+','+col[1]+','+col[2]+',0)');ctx.fillStyle=g;ctx.fill();}}draw();` },
  lava: { name: 'Lava Lamp', theme: 'sunset', desc: 'Blobby 3D orbs morphing like a lava lamp.', fn: `var ac=hex2rgb(C.a),ac2=hex2rgb(C.a2);function draw(){for(var b=0;b<5;b++){var x=W*(0.2+0.6*Math.sin(t*0.3+b*1.7));var y=H*(0.3+0.4*Math.sin(t*0.5+b*2.3));var r=(40+Math.sin(t*0.4+b*3)*14)*D*(0.6+b*0.12);var g=ctx.createRadialGradient(x,y,0,x,y,r);var col=b%2?ac:ac2;g.addColorStop(0,'rgba('+col[0]+','+col[1]+','+col[2]+',0.28)');g.addColorStop(1,'rgba('+col[0]+','+col[1]+','+col[2]+',0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,6.2832);ctx.fill();}}draw();` },
  cubes: { name: '3D Cubes', theme: 'cyberpunk', desc: 'Rotating wireframe cubes floating in space.', fn: `var cs=[];for(var i=0;i<7;i++)cs.push({x:Math.random()*W,y:Math.random()*H,s:(30+Math.random()*50)*D,rx:Math.random()*6.28,ry:Math.random()*6.28,v:0.003+Math.random()*0.008});var ac=hex2rgb(C.a);function cube(x,y,s,rx,ry){ctx.save();ctx.translate(x,y);ctx.rotate(rx);ctx.rotateY?0:0;var h=s/2;ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.55)';ctx.lineWidth=1*D;ctx.strokeRect(-h,-h,s,s);ctx.strokeRect(-h+ry*40*D,-h+rx*40*D,s,s);ctx.restore();}function draw(){for(var i=0;i<cs.length;i++){var c=cs[i];c.rx+=c.v;c.ry+=c.v*1.4;cube(c.x,c.y,c.s,c.rx,c.ry);}}draw();` },
  helix: { name: 'Helix', theme: 'space', desc: 'A rotating 3D helix of glowing points.', fn: `var ac=hex2rgb(C.a2||C.a);function draw(){var n=60;for(var i=0;i<n;i++){var a=i/n*6.2832+t*0.8;var r=(0.18+0.06*Math.sin(a*3))*Math.min(W,H);var x=W/2+Math.cos(a)*r;var y=H/2+Math.sin(a*2)*H*0.2+i*H/n;if(y>H||y<0)continue;var g=ctx.createRadialGradient(x,y,0,x,y,5*D);g.addColorStop(0,'rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.9)');g.addColorStop(1,'rgba('+ac[0]+','+ac[1]+','+ac[2]+',0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,5*D,0,6.2832);ctx.fill();}}draw();` },
  tunnel: { name: 'Light Tunnel', theme: 'midnight-violet', desc: 'Flying through a spinning tunnel of rings.', fn: `var ac=hex2rgb(C.a);function draw(){var n=16;for(var i=0;i<n;i++){var z=((t*0.6+i/n)%1);var r=(0.15+z*1.1)*Math.min(W,H);var cx=W/2+Math.cos(z*6.28+t*0.4)*(W*0.12);var cy=H/2+Math.sin(z*6.28+t*0.3)*(H*0.12);ctx.beginPath();ctx.ellipse(cx,cy,r,r*0.35,0,0,6.2832);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.08+z*0.4)+')';ctx.lineWidth=(1+z*3)*D;ctx.stroke();}}draw();` },
  matrix: { name: 'Matrix Rain', theme: 'cyberpunk', desc: 'Classic digital rain in the site accent color.', fn: `var col=[];for(var i=0;i<Math.ceil(W/18);i++)col.push(Math.random()*H);var ac=hex2rgb(C.a);ctx.font=(12*D)+'px monospace';function draw(){for(var i=0;i<col.length;i++){var x=i*18*D;var y=col[i];ctx.fillStyle='rgba(0,0,0,0.12)';ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.5)';ctx.fillText(String.fromCharCode(0x30A0+Math.floor(Math.random()*96)),x,y);if(y>H||Math.random()>0.975)col[i]=Math.random()*-40;else col[i]+=14*D;}}draw();` },
  hexgrid: { name: 'Hex Grid', theme: 'cyberpunk', desc: 'A 3D honeycomb grid receding into the distance.', fn: `var ac=hex2rgb(C.a);var s=26*D;ctx.lineWidth=1*D;function hex(x,y,r){ctx.beginPath();for(var i=0;i<6;i++){var a=i/6*6.2832;var px=x+Math.cos(a)*r,py=y+Math.sin(a)*r;if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.closePath();}function draw(){for(var row=0;row<14;row++){var z=row/14;var y=H-40*D-row*s*0.8;var sc=0.2+z*1.1;var o=((t*0.5*(z*2+0.5))% (s*1.5));for(var cx=-1;cx<Math.ceil(W/(s*1.5))+1;cx++){var x=cx*s*1.5+o+(row%2?s*0.75:0);hex(x,y,s*sc);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.06+z*0.4)+')';ctx.stroke();}}}draw();` },
  rings: { name: 'Expanding Rings', theme: 'space', desc: 'Rings expanding from the center like a radar.', fn: `var ac=hex2rgb(C.a2||C.a);function draw(){var n=5;for(var i=0;i<n;i++){var ph=(t*0.5+i/n)%1;var r=ph*Math.max(W,H)*0.5;ctx.beginPath();ctx.arc(W/2,H/2,r,0,6.2832);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.5*(1-ph))+')';ctx.lineWidth=2*D;ctx.stroke();}}draw();` },
  waves: { name: '3D Wave Grid', theme: 'ocean-light', desc: 'An undulating 3D particle wave grid.', fn: `var ac=hex2rgb(C.a);var gw=Math.ceil(W/26),gh=Math.ceil(H/26);function draw(){for(var xi=0;xi<gw;xi++){for(var yi=0;yi<gh;yi++){var x=xi*26*D,y=yi*26*D;var z=Math.sin(x*0.01+t*1.2)*Math.cos(y*0.01+t*0.9)*14*D;ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.5)';ctx.fillRect(x+z*0.5,y+z*0.5,2*D,2*D);}}}draw();` },
  confetti: { name: 'Confetti', theme: 'canary', desc: 'Falling colorful confetti — great for launches.', fn: `var cn=[];for(var i=0;i<90;i++)cn.push({x:Math.random()*W,y:Math.random()*H,r:(2+Math.random()*4)*D,v:(1+Math.random()*2.5)*D,rot:Math.random()*6.28,vr:(Math.random()-0.5)*0.1,cols:[[255,99,132],[54,162,235],[255,205,86],[75,192,192],[153,102,255]]});function draw(){for(var i=0;i<cn.length;i++){var c=cn[i];c.y+=c.v;c.rot+=c.vr;if(c.y>H+8){c.y=-8;c.x=Math.random()*W;}var col=c.cols[i%c.cols.length];ctx.save();ctx.translate(c.x,c.y);ctx.rotate(c.rot);ctx.fillStyle='rgba('+col[0]+','+col[1]+','+col[2]+',0.8)';ctx.fillRect(-c.r,-c.r*0.5,c.r*2,c.r);ctx.restore();}}draw();` },
  embers: { name: 'Embers Rising', theme: 'ember-warm', desc: 'Warm embers floating upward like a fire.', fn: `var es=[];for(var i=0;i<50;i++)es.push({x:Math.random()*W,y:Math.random()*H,r:(1+Math.random()*3)*D,v:(0.5+Math.random()*1.2)*D,w:Math.random()*6.28});var ac=hex2rgb(C.a);function draw(){for(var i=0;i<es.length;i++){var e=es[i];e.y-=e.v;e.w+=0.03;e.x+=Math.sin(e.w)*0.4*D;if(e.y<-8){e.y=H+8;e.x=Math.random()*W;}var tw=0.4+Math.sin(e.w*3)*0.3;ctx.beginPath();ctx.arc(e.x,e.y,e.r,0,6.2832);ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+tw+')';ctx.fill();}}draw();` },
  constellation: { name: 'Constellation', theme: 'midnight-violet', desc: 'Stars connected by lines like a constellation map.', fn: `var st=[];for(var i=0;i<42;i++)st.push({x:Math.random()*W,y:Math.random()*H,p:Math.random()*6.28});var ac=hex2rgb(C.a);function draw(){for(var i=0;i<st.length;i++){var a=st[i];a.p+=0.004;var x=a.x+Math.sin(a.p)*8*D,y=a.y+Math.cos(a.p)*8*D;ctx.beginPath();ctx.arc(x,y,1.6*D,0,6.2832);ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.8)';ctx.fill();for(var j=i+1;j<st.length;j++){var b=st[j];var dx=x-b.x,dy=y-b.y;if(dx*dx+dy*dy<120*120*D*D){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(b.x,b.y);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.12)';ctx.lineWidth=0.6*D;ctx.stroke();}}}}draw();` },
  galaxy: { name: 'Galaxy Spiral', theme: 'space', desc: 'A rotating spiral galaxy of stars.', fn: `var ac=hex2rgb(C.a),ac2=hex2rgb(C.a2||C.t);function draw(){var n=140;for(var i=0;i<n;i++){var a=i/n*8+t*0.5;var r=Math.pow(i/n,0.8)*Math.min(W,H)*0.45;var x=W/2+Math.cos(a)*r;var y=H/2+Math.sin(a)*r*0.55;var tw=0.3+Math.sin(i*0.4+t*3)*0.25;var col=i%3?ac:ac2;ctx.fillStyle='rgba('+col[0]+','+col[1]+','+col[2]+','+tw+')';ctx.fillRect(x,y,1.6*D,1.6*D);}}draw();` },
  shapes: { name: 'Floating Shapes', theme: 'minimal-dark', desc: 'Minimal 3D geometric shapes rotating slowly.', fn: `var sh=[];for(var i=0;i<10;i++)sh.push({x:Math.random()*W,y:Math.random()*H,s:(10+Math.random()*30)*D,v:(0.2+Math.random()*0.6),k:Math.floor(Math.random()*3)});var ac=hex2rgb(C.a2||C.a);function draw(){for(var i=0;i<sh.length;i++){var o=sh[i];o.y-=o.v;if(o.y<-40){o.y=H+40;o.x=Math.random()*W;}var a=t*(0.3+o.s*0.01)+i;ctx.save();ctx.translate(o.x,o.y);ctx.rotate(a);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.5)';ctx.lineWidth=1.2*D;if(o.k===0)ctx.strokeRect(-o.s/2,-o.s/2,o.s,o.s);else if(o.k===1){ctx.beginPath();ctx.arc(0,0,o.s/2,0,6.2832);ctx.stroke();}else{ctx.beginPath();ctx.moveTo(0,-o.s/2);ctx.lineTo(o.s/2,o.s/2);ctx.lineTo(-o.s/2,o.s/2);ctx.closePath();ctx.stroke();}ctx.restore();}}draw();` },
  beam: { name: 'Light Beams', theme: 'glass-dark', desc: 'Rotating volumetric light beams.', fn: `var ac=hex2rgb(C.a),ac2=hex2rgb(C.a2||C.t);function draw(){ctx.save();ctx.translate(W/2,H/2);for(var i=0;i<4;i++){ctx.rotate(t*0.15+i*1.57);var g=ctx.createLinearGradient(0,0,0,H*0.7);var col=i%2?ac:ac2;g.addColorStop(0,'rgba('+col[0]+','+col[1]+','+col[2]+',0.10)');g.addColorStop(1,'rgba('+col[0]+','+col[1]+','+col[2]+',0)');ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-W*0.25,H*0.7);ctx.lineTo(W*0.25,H*0.7);ctx.closePath();ctx.fill();}ctx.restore();}draw();` },
  gridtunnel: { name: 'Grid Tunnel', theme: 'cyberpunk', desc: 'Flying through an endless wireframe grid tunnel.', fn: `var ac=hex2rgb(C.a);function draw(){var n=10;for(var i=0;i<n;i++){var z=((t*0.5+i/n)%1);var r=(0.05+z*1.2)*Math.min(W,H);ctx.beginPath();ctx.rect(W/2-r,H/2-r*0.6,r*2,r*1.2);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.05+z*0.4)+')';ctx.lineWidth=(0.5+z*2.5)*D;ctx.stroke();}}draw();` },
  dotswave: { name: 'Dots Wave', theme: 'mint-fresh', desc: 'A flowing wave made of dots responding to time.', fn: `var ac=hex2rgb(C.a);function draw(){var rows=8,cols=Math.ceil(W/34);for(var r=0;r<rows;r++){for(var c=0;c<cols;c++){var x=c*34*D;var y=H*0.5+(r-rows/2)*20*D+Math.sin(x*0.01+t*1.6+r)*14*D;ctx.beginPath();ctx.arc(x,y,(2.2-r*0.15)*D,0,6.2832);ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.7-r*0.07)+')';ctx.fill();}}}draw();` },
  ripple: { name: 'Pointer Ripples', theme: 'teal-aqua', desc: 'Interactive ripples that follow your cursor.', fn: `var rings=[];var ac=hex2rgb(C.t);function draw(){if(mx>=0){rings.push({x:mx,y:my,r:0,a:0.6});}for(var i=rings.length-1;i>=0;i--){var rg=rings[i];rg.r+=2.2*D;rg.a*=0.97;if(rg.a<0.02){rings.splice(i,1);continue;}ctx.beginPath();ctx.arc(rg.x,rg.y,rg.r,0,6.2832);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+rg.a+')';ctx.lineWidth=2*D;ctx.stroke();}if(rings.length>24)rings.shift();}draw();` },
  sparkle: { name: 'Sparkles', theme: 'sakura', desc: 'Twinkling sparkles scattered across the view.', fn: `var sp=[];for(var i=0;i<70;i++)sp.push({x:Math.random()*W,y:Math.random()*H,p:Math.random()*6.28,s:(0.5+Math.random()*1.5)});var ac=hex2rgb(C.a2||C.a);function draw(){for(var i=0;i<sp.length;i++){var s=sp[i];s.p+=0.02*s.s;var tw=0.3+Math.sin(s.p*3)*0.4;if(tw<0.15)tw=0.15;ctx.save();ctx.translate(s.x,s.y);ctx.rotate(s.p);ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+tw+')';ctx.fillRect(-2*D,-2*D,4*D,4*D);ctx.restore();}}draw();` },
  smoke: { name: 'Smoke Drift', theme: 'graphite', desc: 'Soft smoke-like blobs drifting slowly.', fn: `var sm=[];for(var i=0;i<12;i++)sm.push({x:Math.random()*W,y:Math.random()*H,r:(40+Math.random()*70)*D,v:(0.15+Math.random()*0.4)*D,w:Math.random()*6.28});function draw(){for(var i=0;i<sm.length;i++){var s=sm[i];s.y-=s.v;s.w+=0.004;s.x+=Math.sin(s.w)*0.3*D;if(s.y<-s.r){s.y=H+s.r;s.x=Math.random()*W;}var g=ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,s.r);g.addColorStop(0,'rgba(200,200,220,0.06)');g.addColorStop(1,'rgba(200,200,220,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,6.2832);ctx.fill();}}draw();` },
  synthwave: { name: 'Synthwave', theme: 'cyberpunk', desc: 'Iconic synthwave sun + grid horizon.', fn: `var ac=hex2rgb(C.a),ac2=hex2rgb(C.a2||C.a);function draw(){var cx=W/2,cy=H*0.42;var g=ctx.createLinearGradient(0,cy-H*0.3,0,cy);g.addColorStop(0,'rgba('+ac[0]+','+ac[1]+','+ac[2]+',0)');g.addColorStop(1,'rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.4)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,H*0.32,Math.PI,0);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();ctx.fill();ctx.strokeStyle='rgba('+ac2[0]+','+ac2[1]+','+ac2[2]+',0.5)';ctx.lineWidth=1.4*D;for(var i=0;i<8;i++){var y=H*0.75+i*14*D;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}}draw();` },
  morph: { name: 'Morph Blobs', theme: 'rose-elegant', desc: 'Organic morphing gradient blobs.', fn: `var ac=hex2rgb(C.a),ac2=hex2rgb(C.a2||C.t);function blob(x,y,r,col){ctx.beginPath();var n=12;for(var i=0;i<=n;i++){var a=i/n*6.2832;var rr=r*(1+0.18*Math.sin(a*3+t*0.8)+0.1*Math.sin(a*5-t*0.5));var px=x+Math.cos(a)*rr,py=y+Math.sin(a)*rr*0.7;if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.closePath();var g=ctx.createRadialGradient(x,y,0,x,y,r*1.2);g.addColorStop(0,'rgba('+col[0]+','+col[1]+','+col[2]+',0.22)');g.addColorStop(1,'rgba('+col[0]+','+col[1]+','+col[2]+',0)');ctx.fillStyle=g;ctx.fill();}function draw(){blob(W*0.3+Math.sin(t*0.4)*W*0.08,H*0.4,H*0.3,ac);blob(W*0.7+Math.cos(t*0.35)*W*0.08,H*0.6,H*0.26,ac2);}draw();` },
};
// ════════════════════════════════════════════════════════════
// SCENE ENGINE v2 — 25 new 3D scenes inspired by REAL award-winning
// techniques (searched 2024-2026). Each description credits the site
// that popularized the technique. Pure canvas, no libraries.
// ════════════════════════════════════════════════════════════
const SITE_SCENES_V2 = {
  globe: { name: '3D Globe', theme: 'slate-blue', desc: 'Rotating dot-matrix globe with latitude rings — inspired by the WebGL Globe data visualizations.', fn: `var ac=hex2rgb(C.a);var R=Math.min(W,H)*0.28;function dot(la,lo){var phi=la*Math.PI/180,th=lo*Math.PI/180+t*0.12;var x=W/2+R*Math.cos(phi)*Math.sin(th);var y=H/2-R*Math.sin(phi)*0.9;var z=Math.cos(phi)*Math.cos(th);if(z<0)return;ctx.beginPath();ctx.arc(x,y,(0.8+z*1.4)*D,0,6.2832);ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.25+z*0.5)+')';ctx.fill();}function draw(){for(var la=-70;la<=70;la+=10)for(var lo=0;lo<360;lo+=10)dot(la,lo);for(var i=0;i<8;i++){ctx.beginPath();ctx.ellipse(W/2,H/2,R*Math.cos(i/8*Math.PI)*0.9,R*0.18,0,0,6.2832);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.15)';ctx.stroke();}}draw();` },
  terrain: { name: '3D Terrain', theme: 'forest-dark', desc: 'Rolling wireframe terrain that scrolls toward you — inspired by flythrough landscape sites like Explore Primland.', fn: `var ac=hex2rgb(C.a);var gs=Math.max(10,Math.floor(W/22));function draw(){for(var y=0;y<gs;y++){var z=((y+Math.floor(t*3))%gs)/gs;var yy=H*0.15+z*H*0.8;ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.08+z*0.35)+')';ctx.lineWidth=1*D;ctx.beginPath();for(var x=0;x<=W;x+=8*D){var elev=Math.sin(x*0.008+t*0.8+z*4)*Math.cos(x*0.004-t*0.4+z*3)*22*D*(0.4+z);ctx.lineTo(x,yy-elev);}ctx.stroke();}}draw();` },
  ocean: { name: '3D Ocean', theme: 'teal-aqua', desc: 'A shaded 3D water surface with moving waves — inspired by Three.js ocean demos.', fn: `var ac=hex2rgb(C.t);var gs=Math.max(8,Math.floor(W/40));function draw(){for(var y=0;y<gs;y++){for(var x=0;x<gs;x++){var px=x/(gs-1)*W,py=y/(gs-1)*H*0.5+H*0.35;var h=Math.sin(px*0.02+t*1.4+y)*Math.cos(py*0.02+t*1.1+x)*12*D;var z=0.5+Math.sin(x+y+t)*0.3;ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.1+z*0.4)+')';ctx.fillRect(px,py-h,3*D,3*D);}}}draw();` },
  fragments: { name: 'Morphing Fragments', theme: 'midnight-violet', desc: 'Triangular fragments that morph and reassemble — inspired by Species in Pieces.', fn: `var ac=hex2rgb(C.a);var fs=[];for(var i=0;i<60;i++)fs.push({x:Math.random()*W,y:Math.random()*H,s:(8+Math.random()*22)*D,p:Math.random()*6.28,v:(0.2+Math.random()*0.7)});function draw(){for(var i=0;i<fs.length;i++){var f=fs[i];f.p+=0.01*f.v;var tx=W/2+(f.x-W/2)*0.94+Math.sin(f.p)*14*D;var ty=H/2+(f.y-H/2)*0.94+Math.cos(f.p*1.3)*14*D;var s=f.s*(0.7+Math.sin(f.p*2)*0.3);ctx.save();ctx.translate(tx,ty);ctx.rotate(f.p);ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(s*0.9,s*0.6);ctx.lineTo(-s*0.9,s*0.6);ctx.closePath();ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.2+Math.sin(f.p)*0.15)+')';ctx.fill();ctx.restore();}}draw();` },
  zparallax: { name: 'Z-Depth Parallax', theme: 'space', desc: 'Layers of dots moving at different depths for real parallax — inspired by Oryzo’s inertial 3D technique.', fn: `var ac=hex2rgb(C.a);var ls=[];for(var i=0;i<3;i++)ls.push({z:0.2+i*0.35,pts:[]});for(var l=0;l<ls.length;l++){var n=40-l*10;for(var i=0;i<n;i++)ls[l].pts.push({x:Math.random()*W,y:Math.random()*H,p:Math.random()*6.28});}function draw(){for(var l=0;l<ls.length;l++){var layer=ls[l];var driftX=Math.sin(t*0.3+l)*18*D*layer.z*3;var driftY=Math.cos(t*0.25+l)*12*D*layer.z*3;for(var i=0;i<layer.pts.length;i++){var p=layer.pts[i];p.p+=0.01;var x=p.x+driftX+Math.sin(p.p)*8*D*layer.z;var y=p.y+driftY+Math.cos(p.p*1.2)*8*D*layer.z;ctx.beginPath();ctx.arc(x,y,(0.8+layer.z*2)*D,0,6.2832);ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.15+layer.z*0.5)+')';ctx.fill();}}}draw();` },
  scrollmesh: { name: 'Scroll-Mesh', theme: 'cyberpunk', desc: 'A grid that reacts to scroll velocity — inspired by scroll-sequenced reveals like Shopify Editions.', fn: `var ac=hex2rgb(C.a);var lastY=0;var gs=Math.max(8,Math.floor(W/32));function draw(){var vel=Math.abs(scrollY-lastY);lastY=scrollY;var w=Math.min(1,vel/40);for(var y=0;y<gs;y++){ctx.beginPath();for(var x=0;x<=gs;x++){var px=x/gs*W,py=y/gs*H*0.4+H*0.3;var h=Math.sin(x*0.5+y*0.5+t*2)*10*D*w;ctx.lineTo(px,py-h);}ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.1+w*0.4)+')';ctx.lineWidth=1.4*D;ctx.stroke();}}draw();` },
  monolith: { name: '3D Monolith', theme: 'graphite', desc: 'A rotating monolith that reveals on cursor — inspired by Hubtown’s 3D hero.', fn: `var ac=hex2rgb(C.a);var s=Math.min(W,H)*0.22;var ox=W/2,oy=H*0.55;function draw(){var rot=t*0.3;var mr=mx>=0?(mx-W/2)/W*0.5:0;rot+=mr;ctx.save();ctx.translate(ox,oy);ctx.rotate(rot*0.4);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.3+Math.sin(rot*2)*0.15)+')';ctx.lineWidth=1.6*D;ctx.strokeRect(-s,-s*1.8,s*2,s*3.6);ctx.strokeRect(-s*1.2,-s*1.9,s*2.4,s*3.8);ctx.strokeRect(-s*0.8,-s*1.7,s*1.6,s*3.4);ctx.restore();}draw();` },
  flythrough: { name: 'Landscape Flythrough', theme: 'forest-dark', desc: 'Scrolling terrain with perspective — inspired by Explore Primland’s aerial flythrough.', fn: `var ac=hex2rgb(C.a);var gs=Math.max(14,Math.floor(W/16));function draw(){var horizon=H*0.35;for(var i=0;i<gs;i++){var z=((i+Math.floor(t*5))%gs)/gs;var y=horizon+(1-z)*(H-horizon);var scl=0.3+z;ctx.beginPath();for(var x=-1;x<=gs+1;x++){var px=x/gs*W;var elev=Math.sin(x*0.35+z*7+t*1.2)*Math.cos(x*0.2-z*4)*14*D*scl;ctx.lineTo(px,y-elev);}ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.06+z*0.3)+')';ctx.lineWidth=(0.5+z*2)*D;ctx.stroke();}}draw();` },
  prisms: { name: 'Light Prisms', theme: 'lavender', desc: 'Refracting light prisms — inspired by fromanother’s shapeshifting shader identity.', fn: `var ac=hex2rgb(C.a),ac2=hex2rgb(C.a2||C.t);var pr=[];for(var i=0;i<6;i++)pr.push({x:Math.random()*W,y:Math.random()*H,s:(30+Math.random()*50)*D,ph:Math.random()*6.28});function draw(){for(var i=0;i<pr.length;i++){var p=pr[i];p.ph+=0.01;var x=p.x+Math.sin(p.ph)*10*D,y=p.y+Math.cos(p.ph*0.7)*8*D;var g=ctx.createLinearGradient(x-p.s,y-p.s,x+p.s,y+p.s);var col=i%2?ac:ac2;g.addColorStop(0,'rgba('+col[0]+','+col[1]+','+col[2]+',0.34)');g.addColorStop(1,'rgba(255,255,255,0.04)');ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(x,y-p.s);ctx.lineTo(x+p.s*0.8,y+p.s*0.5);ctx.lineTo(x-p.s*0.8,y+p.s*0.5);ctx.closePath();ctx.fill();}}draw();` },
  depthfog: { name: 'Depth Fog', theme: 'glass-dark', desc: 'Particles fading in depth fog with a cursor light — inspired by DeepSee Commerce’s underwater scene.', fn: `var ac=hex2rgb(C.a);var ps=[];for(var i=0;i<110;i++)ps.push({x:Math.random()*W,y:Math.random()*H,z:Math.random()});function draw(){var lx=mx>=0?mx:W/2,ly=my>=0?my:H/2;for(var i=0;i<ps.length;i++){var p=ps[i];p.y-=0.25*D*(1-p.z);p.z+=0.0015;if(p.y<-8){p.y=H+8;p.z=Math.random();}var dx=p.x-lx,dy=p.y-ly;var near=Math.max(0,1-Math.sqrt(dx*dx+dy*dy)/220);var fog=0.15+p.z*0.45+near*0.4;ctx.beginPath();ctx.arc(p.x,p.y,(0.6+p.z*2)*D,0,6.2832);ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+fog+')';ctx.fill();}}draw();` },
  ringworld: { name: 'Ring World', theme: 'cyberpunk', desc: 'A planet with a rotating ring of lights — inspired by sci-fi 3D worlds.', fn: `var ac=hex2rgb(C.a),ac2=hex2rgb(C.a2||C.t);var R=Math.min(W,H)*0.2;var cx=W/2,cy=H/2;function draw(){var g=ctx.createRadialGradient(cx-R*0.4,cy-R*0.4,R*0.2,cx,cy,R*1.2);g.addColorStop(0,'rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.3)');g.addColorStop(1,'rgba('+ac[0]+','+ac[1]+','+ac[2]+',0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,R,0,6.2832);ctx.fill();ctx.beginPath();ctx.ellipse(cx,cy,R*1.5,R*0.45,0,0,6.2832);ctx.strokeStyle='rgba('+ac2[0]+','+ac2[1]+','+ac2[2]+',0.5)';ctx.lineWidth=2*D;ctx.stroke();for(var i=0;i<24;i++){var a=i/24*6.2832+t*0.5;var x=cx+Math.cos(a)*R*1.5;var y=cy+Math.sin(a)*R*0.45;ctx.beginPath();ctx.arc(x,y,2.4*D,0,6.2832);ctx.fillStyle='rgba('+ac2[0]+','+ac2[1]+','+ac2[2]+',0.9)';ctx.fill();}}draw();` },
  meteor: { name: 'Meteor Storm', theme: 'space', desc: 'Meteors streaking across a starfield — inspired by space 3D experiences.', fn: `var ac=hex2rgb(C.a);var st=[];for(var i=0;i<70;i++)st.push({x:Math.random()*W,y:Math.random()*H,r:(0.6+Math.random()*1.4)*D});var ms=[];for(var i=0;i<4;i++)ms.push({x:Math.random()*W,y:Math.random()*H*0.3,v:(6+Math.random()*5)*D,ph:Math.random()*6.28});function draw(){for(var i=0;i<st.length;i++){var s=st[i];ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,6.2832);ctx.fillStyle='rgba(255,255,255,'+(0.3+Math.sin(t*3+i)*0.2)+')';ctx.fill();}for(var i=0;i<ms.length;i++){var m=ms[i];m.x+=m.v;m.y+=m.v*0.3;if(m.x>W+60){m.x=-60;m.y=Math.random()*H*0.4;m.v=6+Math.random()*5*D;}var len=40*D;var g=ctx.createLinearGradient(m.x,m.y,m.x-len,m.y-len*0.3);g.addColorStop(0,'rgba(255,255,255,0.9)');g.addColorStop(1,'rgba(255,255,255,0)');ctx.strokeStyle=g;ctx.lineWidth=1.6*D;ctx.beginPath();ctx.moveTo(m.x,m.y);ctx.lineTo(m.x-len,m.y-len*0.3);ctx.stroke();}}draw();` },
  planets: { name: 'Mini Solar System', theme: 'space', desc: 'Orbiting planets around a glowing sun — inspired by Three.js solar-system demos.', fn: `var ac=hex2rgb(C.a),ac2=hex2rgb(C.a2||C.t);var cx=W/2,cy=H/2;var ps=[];for(var i=0;i<6;i++)ps.push({r:(40+i*22)*D,s:Math.random()*6.28,v:(0.2+Math.random()*0.5),size:(2+i*0.6)*D});function draw(){var g=ctx.createRadialGradient(cx,cy,0,cx,cy,24*D);g.addColorStop(0,'rgba('+ac2[0]+','+ac2[1]+','+ac2[2]+',0.9)');g.addColorStop(1,'rgba('+ac2[0]+','+ac2[1]+','+ac2[2]+',0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,24*D,0,6.2832);ctx.fill();for(var i=0;i<ps.length;i++){var p=ps[i];p.s+=0.008*p.v;var x=cx+Math.cos(p.s)*p.r,y=cy+Math.sin(p.s)*p.r*0.7;ctx.beginPath();ctx.arc(x,y,p.size,0,6.2832);ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.85)';ctx.fill();ctx.strokeStyle='rgba(255,255,255,0.14)';ctx.beginPath();ctx.ellipse(cx,cy,p.r,p.r*0.7,0,0,6.2832);ctx.stroke();}}draw();` },
  dna: { name: 'DNA Helix', theme: 'teal-aqua', desc: 'A rotating DNA double helix — inspired by biotech 3D sites.', fn: `var ac=hex2rgb(C.t);function draw(){var n=42;for(var i=0;i<n;i++){var a=i/n*6.2832+t*0.9;var y=i/n*H+H*0.08;var rx=Math.min(W*0.3,90*D);var x1=W/2+Math.cos(a)*rx;var x2=W/2+Math.cos(a+Math.PI)*rx;var z=Math.sin(a);var g=ctx.createRadialGradient(x1,y,0,x1,y,5*D);g.addColorStop(0,'rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.5+z*0.4)+')');g.addColorStop(1,'rgba('+ac[0]+','+ac[1]+','+ac[2]+',0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x1,y,5*D,0,6.2832);ctx.fill();ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.2+z*0.3)+')';ctx.lineWidth=1*D;ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.stroke();}}draw();` },
  city: { name: '3D City Skyline', theme: 'graphite', desc: 'A glowing city skyline with windows — inspired by isometric 3D city sites.', fn: `var ac=hex2rgb(C.a);var b=[];for(var i=0;i<Math.ceil(W/26);i++)b.push({x:i*26*D,h:(30+Math.random()*90)*D,w:(14+Math.random()*14)*D});function draw(){for(var i=0;i<b.length;i++){var bl=b[i];ctx.fillStyle='rgba(15,18,25,0.9)';ctx.fillRect(bl.x,H-bl.h,bl.w,bl.h);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.5)';ctx.lineWidth=1*D;ctx.strokeRect(bl.x,H-bl.h,bl.w,bl.h);for(var wy=0;wy<bl.h-8;wy+=10*D){for(var wx=0;wx<bl.w-4;wx+=8*D){if(Math.random()<0.25){ctx.fillStyle='rgba(255,220,120,0.7)';ctx.fillRect(bl.x+wx+2,H-bl.h+wy+4,3*D,4*D);}}}}ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.06)';ctx.fillRect(0,H-6*D,W,6*D);}draw();` },
  volcano: { name: 'Volcano Eruption', theme: 'sunset', desc: 'Erupting lava particles from a peak — inspired by particle physics 3D demos.', fn: `var ac=hex2rgb(C.a);var ps=[];function spawn(){ps.push({x:W/2+(Math.random()-0.5)*20*D,y:H*0.7,r:(2+Math.random()*3)*D,vx:(Math.random()-0.5)*1.2*D,vy:-(2+Math.random()*3)*D,life:1});}function draw(){if(Math.random()<0.25)spawn();for(var i=ps.length-1;i>=0;i--){var p=ps[i];p.x+=p.vx;p.y+=p.vy;p.vy-=0.03*D;p.life-=0.008;if(p.life<=0||p.y>H+20){ps.splice(i,1);continue;}ctx.beginPath();ctx.arc(p.x,p.y,p.r*p.life,0,6.2832);ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(p.life*0.8)+')';ctx.fill();}ctx.fillStyle='rgba(30,20,12,0.9)';ctx.beginPath();ctx.moveTo(W/2-50*D,H);ctx.lineTo(W/2-16*D,H*0.7);ctx.lineTo(W/2+16*D,H*0.7);ctx.lineTo(W/2+50*D,H);ctx.closePath();ctx.fill();}draw();` },
  galaxyarms: { name: 'Galaxy Arms', theme: 'midnight-violet', desc: 'A two-armed spiral galaxy with dust — inspired by astrophysics 3D scenes.', fn: `var ac=hex2rgb(C.a),ac2=hex2rgb(C.a2||C.t);function draw(){var n=200;for(var i=0;i<n;i++){var a=i/n*12+t*0.4;var r=Math.pow(i/n,0.7)*Math.min(W,H)*0.4;for(var arm=0;arm<2;arm++){var aa=a+arm*Math.PI;var x=W/2+Math.cos(aa)*r;var y=H/2+Math.sin(aa)*r*0.6;var tw=0.2+Math.sin(i*0.6+t*2)*0.15;var col=i%5===0?ac2:ac;ctx.fillStyle='rgba('+col[0]+','+col[1]+','+col[2]+','+tw+')';ctx.fillRect(x,y,(0.8+Math.sin(i)*0.6)*D,(0.8+Math.sin(i)*0.6)*D);}}}draw();` },
  lighthouses: { name: 'Beacon Lights', theme: 'space', desc: 'Rotating beacon beams from the horizon — inspired by lighthouse 3D scenes.', fn: `var ac=hex2rgb(C.a);function draw(){ctx.save();ctx.translate(W/2,H*0.75);for(var i=0;i<3;i++){ctx.rotate(t*0.2+i*2.1);var g=ctx.createLinearGradient(0,0,0,-H*0.9);g.addColorStop(0,'rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.16)');g.addColorStop(1,'rgba('+ac[0]+','+ac[1]+','+ac[2]+',0)');ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-W*0.12,-H*0.9);ctx.lineTo(W*0.12,-H*0.9);ctx.closePath();ctx.fill();}ctx.restore();}draw();` },
  citynight: { name: 'Night City Particles', theme: 'denim', desc: 'A cityscape of glowing particle windows in the dark — inspired by night-city 3D scenes.', fn: `var ac=hex2rgb(C.a2||C.a);var wins=[];if(!wins.length)for(var i=0;i<90;i++)wins.push({x:Math.random()*W,y:Math.random()*H*0.8,s:(2+Math.random()*4)*D,p:Math.random()*6.28});function draw(){for(var i=0;i<wins.length;i++){var w=wins[i];w.p+=0.02;var tw=0.35+Math.sin(w.p)*0.35;ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+tw+')';ctx.fillRect(w.x,w.y,w.s,w.s*0.7);}}draw();` },
  wireplanet: { name: 'Wire Planet', theme: 'midnight-violet', desc: 'A wireframe planet with orbiting rings — inspired by 3D globe wireframe scenes.', fn: `var ac=hex2rgb(C.a);var R=Math.min(W,H)*0.24;var cx=W/2,cy=H/2;function draw(){var tilt=0.3;for(var i=0;i<9;i++){ctx.beginPath();ctx.ellipse(cx,cy,R*Math.cos(i/9*Math.PI)*0.8,R*0.18,0,0,6.2832);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.12+i*0.03)+')';ctx.lineWidth=1*D;ctx.stroke();}ctx.beginPath();ctx.ellipse(cx,cy,R*1.5,R*0.5,tilt,0,6.2832);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.4)';ctx.lineWidth=1.6*D;ctx.stroke();}draw();` },
  orrery: { name: 'Orrery', theme: 'slate-blue', desc: 'A mechanical orrery of orbiting rings — inspired by kinetic 3D scenes.', fn: `var ac=hex2rgb(C.a);var cx=W/2,cy=H/2;function draw(){for(var i=0;i<5;i++){var r=(30+i*24)*D;ctx.beginPath();ctx.ellipse(cx,cy,r,r*0.75,i*0.2,0,6.2832);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.1+i*0.07)+')';ctx.lineWidth=1*D;ctx.stroke();var a=t*(0.4+i*0.12)+i;var x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r*0.75;ctx.beginPath();ctx.arc(x,y,2.2*D,0,6.2832);ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.9)';ctx.fill();}}draw();` },
  wavefront: { name: 'Wavefront', theme: 'ocean-light', desc: 'An animated wavefront surface with shading — inspired by ocean shader sites.', fn: `var ac=hex2rgb(C.a);var gs=Math.max(10,Math.floor(W/24));function draw(){for(var y=0;y<gs;y++){ctx.beginPath();for(var x=0;x<=gs;x++){var px=x/gs*W;var py=H*0.5+(y-gs/2)*(H*0.5/gs);var z=Math.sin(px*0.01+t*1.3+y*0.8)*Math.cos(py*0.015+t*0.9)*16*D;ctx.lineTo(px,py+z);}ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.08+y/gs*0.3)+')';ctx.lineWidth=1.2*D;ctx.stroke();}}draw();` },
  constellation3d: { name: 'Constellation 3D', theme: 'space', desc: 'Stars forming a 3D wireframe constellation sphere — inspired by astronomy sites.', fn: `var ac=hex2rgb(C.a);var R=Math.min(W,H)*0.3;var st=[];for(var i=0;i<36;i++){var th=Math.random()*6.28,ph=Math.acos(2*Math.random()-1);st.push({x:Math.cos(th)*Math.sin(ph),y:Math.cos(ph),z:Math.sin(th)*Math.sin(ph)});}function draw(){for(var i=0;i<st.length;i++){var p=st[i];var rot=t*0.25;var xr=p.x*Math.cos(rot)-p.z*Math.sin(rot);var zr=p.x*Math.sin(rot)+p.z*Math.cos(rot);var x=W/2+xr*R,y=H/2-p.y*R*0.9;if(zr<0)continue;ctx.beginPath();ctx.arc(x,y,(0.8+zr*1.2)*D,0,6.2832);ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.25+zr*0.5)+')';ctx.fill();for(var j=i+1;j<st.length;j++){var q=st[j];var dx=xr-q.x,dy=p.y-q.y;if(dx*dx+dy*dy<0.25){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(W/2+q.x*R,H/2-q.y*R*0.9);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.08)';ctx.stroke();}}}}draw();` },
  tunnelrings: { name: 'Tunnel Rings', theme: 'cyberpunk', desc: 'Rings rushing past as you fly through — inspired by racing 3D scenes.', fn: `var ac=hex2rgb(C.a);function draw(){var n=14;for(var i=0;i<n;i++){var z=((t*1.2+i/n)%1);var r=(0.08+z*1.3)*Math.min(W,H);var cx=W/2+Math.sin(z*12)*W*0.08,cy=H/2+Math.cos(z*10)*H*0.08;ctx.beginPath();ctx.ellipse(cx,cy,r,r*0.5,0,0,6.2832);ctx.strokeStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.05+z*0.4)+')';ctx.lineWidth=(0.5+z*3)*D;ctx.stroke();}}draw();` },
  waves3d: { name: '3D Wave Field', theme: 'teal-aqua', desc: 'A full 3D wave field rendered as a dot matrix — inspired by wave shader demos.', fn: `var ac=hex2rgb(C.t);var gs=Math.max(12,Math.floor(W/28));function draw(){for(var y=0;y<gs;y++){for(var x=0;x<gs;x++){var px=x/gs*W,py=y/gs*H;var h=Math.sin(px*0.02+t*1.6+y*0.7)*Math.cos(py*0.02-t*1.2+x*0.3)*10*D;var shade=0.5+Math.sin(x+y+t)*0.25;ctx.beginPath();ctx.arc(px,py-h,2*D,0,6.2832);ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.15+shade*0.4)+')';ctx.fill();}}}draw();` },
  // ── PRO CANVAS SCENES — true 3D projection (perspective + rotation + depth) ──
  p3cube: { name: '3D Cube Cluster (Pro)', theme: 'graphite', desc: 'A cluster of wireframe cubes tumbling in true 3D perspective — real 3D→2D projection with depth.', fn: `var ac=hex2rgb(C.a);var cubes=[];for(var i=0;i<10;i++)cubes.push({x:(Math.random()-0.5)*40,y:(Math.random()-0.5)*24,z:(Math.random()-0.5)*20,rx:Math.random()*3,ry:Math.random()*3,vx:(Math.random()-0.5)*0.02,vy:(Math.random()-0.5)*0.02,s:1.2+Math.random()*2});
function cube3(x,y,z,s,rx,ry){var p=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(function(v){return [v[0]*s,v[1]*s,v[2]*s];});
var f=[[0,1,2,3],[4,5,6,7],[0,1,5,4],[2,3,7,6],[0,3,7,4],[1,2,6,5]];mesh3(p,f,ac,0.05,0.7,[rx,ry,t*0.2]);}
function draw(){for(var i=0;i<cubes.length;i++){var c=cubes[i];c.rx+=c.vx;c.ry+=c.vy;cube3(c.x,c.y,c.z,c.s,c.rx,c.ry);}}draw();` },
  p3sphere: { name: '3D Wire Sphere (Pro)', theme: 'slate-blue', desc: 'A rotating wireframe sphere built from real 3D latitude/longitude rings with perspective.', fn: `var ac=hex2rgb(C.a);var R=Math.min(W,H)*0.26;
function ring(y,r,ry,rz){var pts=[];for(var i=0;i<=40;i++){var a=i/40*6.2832;pts.push([Math.cos(a)*r,y,Math.sin(a)*r]);}for(var i=0;i<pts.length-1;i++)line3(pts[i][0],pts[i][1],pts[i][2],pts[i+1][0],pts[i+1][1],pts[i+1][2],ac,0.4,1);}
function draw(){var ry=t*0.3;for(var i=0;i<10;i++){var phi=i/10*Math.PI;var y=Math.cos(phi)*R,r=Math.sin(phi)*R;var R2=[ry,0,0];for(var p2=0;p2<20;p2++){var a=p2/20*6.2832;var x=Math.cos(a)*r,yy=y,z=Math.sin(a)*r;var q=rot3(x,yy,z,0,ry,0);var q2=rot3(x,yy,z,Math.PI/2,ry,0);dot3(q[0],q[1],q[2],2,ac,0.5);}}for(var j=0;j<12;j++){var th=j/12*6.2832;var pts=[];for(var k=0;k<=36;k++){var a2=k/36*6.2832;pts.push(rot3(Math.cos(a2)*R,Math.sin(a2)*R*0,0,0,0,0));}for(var k=0;k<pts.length-1;k++){var p1=rot3(Math.cos(k/36*6.2832)*R,0,Math.sin(k/36*6.2832)*R,0,ry,0);var p2=rot3(Math.cos((k+1)/36*6.2832)*R,0,Math.sin((k+1)/36*6.2832)*R,0,ry,0);line3(p1[0],p1[1],p1[2],p2[0],p2[1],p2[2],ac,0.25,0.8);}}draw();` },
  p3torus: { name: '3D Torus (Pro)', theme: 'midnight-violet', desc: 'A rotating 3D torus knot of glowing dots in perspective — real depth.', fn: `var ac=hex2rgb(C.a),ac2=hex2rgb(C.a2||C.t);function draw(){var n=220;for(var i=0;i<n;i++){var u=i/n*6.2832*3+t*0.4;var r=14+Math.sin(u*2)*5;var x=Math.cos(u)*r*0.8,y=Math.sin(u*2)*6,z=Math.sin(u)*r*0.8;var q=rot3(x,y,z,Math.sin(t*0.2)*0.4,t*0.5,0);var col=i%3?ac:ac2;dot3(q[0],q[1],q[2],2.4,col,0.8);}}draw();` },
  p3galaxy: { name: '3D Galaxy (Pro)', theme: 'space', desc: 'A spiral galaxy of stars rotated in true 3D with perspective and depth fade.', fn: `var ac=hex2rgb(C.a),ac2=hex2rgb(C.a2||C.t);function draw(){var n=500;for(var i=0;i<n;i++){var a=i*0.35;var r=Math.pow(i/n,0.8)*Math.min(W,H)*0.42;var x=Math.cos(a)*r,y=(Math.random()-0.5)*2*(1-r/(W*0.5)),z=Math.sin(a)*r;var q=rot3(x,y,z,t*0.12,0.35,0);var col=i%4===0?ac2:ac;dot3(q[0],q[1],q[2],1.8,col,0.8);}}draw();` },
  p3terrain: { name: '3D Terrain Mesh (Pro)', theme: 'forest-dark', desc: 'A shaded 3D terrain mesh rotating in perspective — real vertex displacement + height shading.', fn: `var ac=hex2rgb(C.a);var gs=22;function draw(){var R=[t*0.1,-0.5,0];for(var gy=0;gy<gs;gy++){for(var gx=0;gx<gs;gx++){var px=(gx/gs-0.5)*44,py=(gy/gs-0.5)*30;var h=Math.sin(px*0.25+t)*Math.cos(py*0.25+t*0.8)*3+Math.sin(px*0.6+py*0.4)*1.2;var q=rot3(px,h,py,R[0],R[1],R[2]);var shade=0.35+Math.max(0,Math.sin(px*0.25+t)*0.3);dot3(q[0],q[1],q[2],1.6,ac,shade);}}}draw();` },
  p3city: { name: '3D City Blocks (Pro)', theme: 'graphite', desc: 'A true-3D city of shaded blocks with lit windows rotating in perspective.', fn: `var ac=hex2rgb(C.a),ac2=hex2rgb(C.a2||C.a);var b=[];for(var i=0;i<26;i++)b.push({x:(Math.random()-0.5)*36,z:(Math.random()-0.5)*36,w:1+Math.random()*1.6,h:2+Math.random()*7,d:1+Math.random()*1.6});
function box3(cx,cy,cz,w,h,d,R){var pts=[[-w/2,-h/2,-d/2],[w/2,-h/2,-d/2],[w/2,h/2,-d/2],[-w/2,h/2,-d/2],[-w/2,-h/2,d/2],[w/2,-h/2,d/2],[w/2,h/2,d/2],[-w/2,h/2,d/2]].map(function(v){return [cx+v[0],cy+v[1],cz+v[2]];});var f=[[0,1,2,3],[4,5,6,7],[0,1,5,4],[2,3,7,6],[0,3,7,4],[1,2,6,5]];mesh3(pts,f,ac,0.12,0.5,R);}
function draw(){var R=[t*0.08,0,0];for(var i=0;i<b.length;i++){var bl=b[i];box3(bl.x,bl.h/2-8,bl.z,bl.w,bl.h,bl.d,R);}}draw();` },
  p3dna: { name: '3D DNA (Pro)', theme: 'teal-aqua', desc: 'A true-3D DNA double helix with connecting rungs — rotating in perspective.', fn: `var ac=hex2rgb(C.t),ac2=hex2rgb(C.a2||C.t);function draw(){var n=30;for(var i=0;i<n;i++){var a=i/n*6.2832*3+t*0.7;var y=i/n*36-18;var x=Math.cos(a)*6,z=Math.sin(a)*6;var x2=Math.cos(a+Math.PI)*6,z2=Math.sin(a+Math.PI)*6;var q=rot3(x,y,z,0.3,t*0.2,0);var q2=rot3(x2,y,z2,0.3,t*0.2,0);dot3(q[0],q[1],q[2],2.2,ac,0.9);dot3(q2[0],q2[1],q2[2],2.2,ac2,0.9);line3(q[0],q[1],q[2],q2[0],q2[1],q2[2],ac,0.25,0.8);}}draw();` },
  p3tunnel: { name: '3D Perspective Tunnel (Pro)', theme: 'cyberpunk', desc: 'Rings flying at you through real perspective projection.', fn: `var ac=hex2rgb(C.a);function draw(){var n=16;for(var i=0;i<n;i++){var z=((t*1.4+i/n)%1)*80-10;var r=(0.06+z*0.5)*Math.min(W,H)*0.9;var cx=W/2+Math.sin(z*0.4)*20*D,cy=H/2+Math.cos(z*0.3)*16*D;var a=0.12+(1-Math.abs(z)/90)*0.5;var col=i%3?ac:hex2rgb(C.a2||C.a);ctx.beginPath();ctx.ellipse(cx,cy,r,r*0.42,0,0,6.2832);ctx.strokeStyle='rgba('+col[0]+','+col[1]+','+col[2]+','+a+')';ctx.lineWidth=(0.4+Math.abs(z)/90*3)*D;ctx.stroke();}}draw();` },
  p3globe: { name: '3D Globe Pro (Pro)', theme: 'slate-blue', desc: 'A true-3D globe with rotating surface dots — real sphere projection.', fn: `var ac=hex2rgb(C.a);var R=Math.min(W,H)*0.24;function draw(){var ry=t*0.25;for(var i=0;i<600;i++){var th=Math.random()*6.2832,ph=Math.acos(2*Math.random()-1);var x=Math.sin(ph)*Math.cos(th)*R,y=Math.cos(ph)*R*0.9,z=Math.sin(ph)*Math.sin(th)*R;var q=rot3(x,y,z,0.3,ry,0);if(q[2]<0)continue;var a2=0.2+(q[2]/R)*0.5;dot3(q[0],q[1],q[2],1.6,ac,a2);}}draw();` },
  p3shapes: { name: '3D Floating Shapes (Pro)', theme: 'rose-elegant', desc: 'Real-3D geometric solids (cube, pyramid, octahedron) rotating in perspective with face fills.', fn: `var ac=hex2rgb(C.a),ac2=hex2rgb(C.a2||C.t),ac3=hex2rgb(C.t);
function makeBox(x,y,z,s){var pts=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(function(v){return [x+v[0]*s,y+v[1]*s,z+v[2]*s];});var f=[[0,1,2,3],[4,5,6,7],[0,1,5,4],[2,3,7,6],[0,3,7,4],[1,2,6,5]];return {pts:pts,f:f};}
function makePyr(x,y,z,s){var pts=[[-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1],[0,2.2,0]].map(function(v){return [x+v[0]*s,y+v[1]*s,z+v[2]*s];});var f=[[0,1,4],[1,2,4],[2,3,4],[3,0,4],[0,1,2,3]];return {pts:pts,f:f};}
function makeOct(x,y,z,s){var pts=[[0,1.4,0],[1,0,0],[0,0,1],[-1,0,0],[0,0,-1],[0,-1.4,0]].map(function(v){return [x+v[0]*s,y+v[1]*s,z+v[2]*s];});var f=[[0,1,2],[0,2,3],[0,3,4],[0,4,1],[5,2,1],[5,3,2],[5,4,3],[5,1,4]];return {pts:pts,f:f};}
var items=[makeBox(-14,0,0,2.4),makePyr(0,0,0,2.2),makeOct(14,0,0,2)];
function draw(){var cols=[ac,ac2,ac3];for(var i=0;i<items.length;i++){var it=items[i];var R=[t*(0.4+i*0.1),t*(0.3+i*0.08),0];var yOff=Math.sin(t*0.6+i*2)*2;var pts=it.pts.map(function(v){return [v[0],v[1]+yOff,v[2]];});var P=[];for(var j=0;j<pts.length;j++){var r=rot3(pts[j][0],pts[j][1],pts[j][2],R[0],R[1],R[2]);P.push(proj3(r[0],r[1],r[2],W/2,H/2));}
var zs=P.map(function(p){return p[2];});var faces=it.f.map(function(f2,fi){return {f:f2,z:zs[f2[0]]+zs[f2[1]]+zs[f2[2]],fi:fi};}).sort(function(a,b){return a.z-b.z;});
for(var k=0;k<faces.length;k++){var fc=faces[k].f;ctx.beginPath();for(var m=0;m<fc.length;m++){var q=P[fc[m]];if(m===0)ctx.moveTo(q[0],q[1]);else ctx.lineTo(q[0],q[1]);}ctx.closePath();ctx.fillStyle='rgba('+cols[i][0]+','+cols[i][1]+','+cols[i][2]+',0.16)';ctx.fill();ctx.strokeStyle='rgba('+cols[i][0]+','+cols[i][1]+','+cols[i][2]+',0.75)';ctx.lineWidth=1.2*D;ctx.stroke();}}}draw();` },
  p3system: { name: '3D Solar System (Pro)', theme: 'space', desc: 'Orbiting planets around a sun in true 3D perspective with depth fade.', fn: `var ac=hex2rgb(C.a),ac2=hex2rgb(C.a2||C.t);var ps=[{r:8,s:0,v:0.6,c:ac},{r:13,s:2,v:0.4,c:ac2},{r:18,s:4,v:0.3,c:hex2rgb(C.t)},{r:23,s:1,v:0.22,c:ac}];function draw(){var R=[0.3,t*0.15,0];dot3(0,0,0,6,ac2,1);for(var i=0;i<ps.length;i++){var p=ps[i];p.s+=0.01*p.v;var x=Math.cos(p.s)*p.r,y=Math.sin(p.s*1.4)*1.5,z=Math.sin(p.s)*p.r;var q=rot3(x,y,z,R[0],R[1],R[2]);dot3(q[0],q[1],q[2],2.2,p.c,0.9);ctx.beginPath();ctx.ellipse(W/2,H/2,p.r,p.r*0.85,0,0,6.2832);ctx.strokeStyle='rgba(255,255,255,0.07)';ctx.lineWidth=1*D;ctx.stroke();}}draw();` },
};

// merge v2 scenes in
Object.assign(SITE_SCENES, SITE_SCENES_V2);
// unified scene lookup: canvas scenes + WebGL scenes
Object.assign(SITE_SCENES, THREE_SCENES);
function sceneInfo(id){return SITE_SCENES[id]||null;}
function isThreeScene(id){return !!(THREE_SCENES[id]);}
// scene → recommended theme (for concept packs)
const SCENE_THEME = {};
Object.keys(SITE_SCENES).forEach(function(id){ SCENE_THEME[id] = SITE_SCENES[id].theme; });
// ════════════════════════════════════════════════════════════
// 170 PROFESSIONAL 3D WEBSITE CONCEPTS — 17 industries × 10 scene
// style packs. Every concept is a unique combination of a 3D background
// scene, a curated theme palette and a hero layout — generated as data,
// so the AI can use any of them and every build stays unique.
// ════════════════════════════════════════════════════════════
const CONCEPT_INDUSTRIES = [
  'SaaS', 'AI Startup', 'Crypto & Web3', 'Gaming', 'Creative Agency', 'Restaurant & Café',
  'Fitness & Gym', 'Real Estate', 'Fashion', 'Music & Artist', 'Travel', 'Education',
  'Healthcare', 'Automotive', 'Photography', 'Events', 'Consulting',
];
const CONCEPT_PACKS = [
  { scene: 'starfield', hero: 'center' }, { scene: 'grid', hero: 'split' }, { scene: 'aurora', hero: 'center' },
  { scene: 'galaxy', hero: 'minimal' }, { scene: 'tunnel', hero: 'glass' }, { scene: 'synthwave', hero: 'badgehero' },
  { scene: 'particles', hero: 'split' }, { scene: 'orbs', hero: 'glass' }, { scene: 'waves', hero: 'splitimage' },
  { scene: 'helix', hero: 'kinetic' }, { scene: 'globe', hero: 'center' }, { scene: 'terrain', hero: 'minimal' },
  { scene: 'fragments', hero: 'kinetic' }, { scene: 'zparallax', hero: 'split' }, { scene: 'monolith', hero: 'glass' },
  { scene: 'flythrough', hero: 'center' }, { scene: 'prisms', hero: 'badgehero' }, { scene: 'depthfog', hero: 'splitimage' },
  { scene: 'ringworld', hero: 'center' }, { scene: 'planets', hero: 'minimal' },
  { scene: 'tgalaxy', hero: 'center' }, { scene: 'tplanet', hero: 'split' }, { scene: 'tocean', hero: 'splitimage' },
  { scene: 'tshapes', hero: 'glass' }, { scene: 'tcity', hero: 'minimal' }, { scene: 'tgrid', hero: 'badgehero' },
  { scene: 'twireglobe', hero: 'center' }, { scene: 'tnebula', hero: 'kinetic' }, { scene: 'tterrain', hero: 'split' },
  { scene: 'tsolarsystem', hero: 'minimal' }, { scene: 'tparticles', hero: 'split' }, { scene: 'ttunnel', hero: 'glass' },
  { scene: 'tmeteors', hero: 'center' }, { scene: 'taurora', hero: 'kinetic' }, { scene: 'tcubes3d', hero: 'splitimage' },
  { scene: 'tcity2', hero: 'center' }, { scene: 'tscifi', hero: 'badgehero' }, { scene: 'tblackhole', hero: 'minimal' },
  { scene: 'tparticles2', hero: 'split' }, { scene: 'tvolcano', hero: 'center' },
];
function buildConcepts() {
  const out = [];
  let n = 1;
  for (const ind of CONCEPT_INDUSTRIES) {
    for (const pack of CONCEPT_PACKS) {
      const sc = SITE_SCENES[pack.scene];
      const theme = (sc && (SCENE_THEME[pack.scene] || sc.theme)) || 'space';
      const desc = String(sc && (sc.desc || (sc.name + ' scene'))).toLowerCase();
      out.push({
        id: 'c' + (n++),
        name: (sc && sc.name ? sc.name : pack.scene) + ' ' + ind,
        industry: ind,
        scene_id: pack.scene,
        theme_id: theme,
        hero_style: pack.hero,
        desc: `${ind} website with a ${desc} in the ${theme} palette.`,
      });
    }
  }
  return out;
}
const SITE_CONCEPTS = buildConcepts();
// Spline 3D embed (any public scene): viewer script + element
function splineEmbedHtml(url) {
  return `<script type="module" src="https://unpkg.com/@splinetool/viewer@1.9.12/build/spline-viewer.js"></script>
<spline-viewer url="${escHtml(url)}" style="position:absolute;inset:0;width:100%;height:100%;z-index:0" loading="lazy"></spline-viewer>`;
}

const DESIGN_EXTRAS = {
  ocean: `/* ocean: airy coastal blue */
:root{--bg:#f3f8fc;--bg2:#e8f1fa;--card:#ffffff;--line:#dbe7f3;--text:#0b1f33;--muted:#4c6a85;--accent:#0e7490;--accent2:#22d3ee;--teal:#0e7490;--amber:#f59e0b;--grad:linear-gradient(100deg,#0e7490,#22d3ee 55%,#5eead4);--radius:18px}
body::before{background:radial-gradient(50vw 50vw at 90% -10%,rgba(34,211,238,.12),transparent 60%),radial-gradient(45vw 45vw at 0% 105%,rgba(14,116,144,.08),transparent 60%)}
.nx-hero::before{background:radial-gradient(circle,rgba(34,211,238,.16),transparent 65%)}`,
  forest: `/* forest: deep green, premium */
:root{--bg:#0a120e;--bg2:#0f1a14;--card:#14221a;--line:#22382b;--text:#e7f2ea;--muted:#8fa89a;--accent:#34d399;--accent2:#a7f3d0;--teal:#34d399;--amber:#fbbf24;--grad:linear-gradient(100deg,#34d399,#a7f3d0 55%,#fbbf24);--radius:14px}
body::before{background:radial-gradient(55vw 55vw at 8% -5%,rgba(52,211,153,.10),transparent 60%),radial-gradient(50vw 50vw at 105% 108%,rgba(251,191,36,.06),transparent 60%)}
.nx-nav{background:rgba(10,18,14,.85)}`,
  rose: `/* rose: elegant light */
:root{--bg:#fdf7f8;--bg2:#fbeef1;--card:#ffffff;--line:#f0dde2;--text:#38121c;--muted:#8a5a68;--accent:#d6336c;--accent2:#f783ac;--teal:#d6336c;--amber:#e8a13a;--grad:linear-gradient(100deg,#d6336c,#f783ac 55%,#e8a13a);--radius:18px}
body::before{background:radial-gradient(50vw 50vw at 90% -10%,rgba(214,51,108,.10),transparent 60%),radial-gradient(45vw 45vw at 0% 105%,rgba(232,161,58,.08),transparent 60%)}
.nx-hero::before{background:radial-gradient(circle,rgba(214,51,108,.12),transparent 65%)}
.btn-primary{box-shadow:0 14px 30px -10px rgba(214,51,108,.45)}`,
  midnight: `/* midnight: deep violet, dramatic */
:root{--bg:#0d0a1a;--bg2:#141027;--card:#1b1533;--line:#2d2450;--text:#eae6ff;--muted:#a99fd0;--accent:#8b5cf6;--accent2:#c4b5fd;--teal:#a78bfa;--amber:#f0abfc;--grad:linear-gradient(100deg,#8b5cf6,#c4b5fd 55%,#f0abfc);--radius:16px}
body::before{background:radial-gradient(55vw 55vw at 8% -5%,rgba(139,92,246,.14),transparent 60%),radial-gradient(50vw 50vw at 105% 108%,rgba(192,132,252,.10),transparent 60%)}
.nx-nav{background:rgba(13,10,26,.85)}
.nx-hero::before{background:radial-gradient(circle,rgba(139,92,246,.18),transparent 65%)}`,
  ember: `/* ember: warm amber, inviting */
:root{--bg:#0d0b08;--bg2:#171310;--card:#201a14;--line:#3a2f24;--text:#f7efe4;--muted:#b39c80;--accent:#f59e0b;--accent2:#fbbf24;--teal:#f59e0b;--amber:#fcd34d;--grad:linear-gradient(100deg,#f59e0b,#fcd34d 55%,#f97316);--radius:16px}
body::before{background:radial-gradient(55vw 55vw at 8% -5%,rgba(245,158,11,.12),transparent 60%),radial-gradient(50vw 50vw at 105% 108%,rgba(249,115,22,.08),transparent 60%)}
.nx-nav{background:rgba(13,11,8,.85)}
.btn-primary{box-shadow:0 14px 34px -10px rgba(245,158,11,.5)}`,
  graphite: `/* graphite: monochrome minimal */
:root{--bg:#0f0f0f;--bg2:#171717;--card:#1d1d1d;--line:#2e2e2e;--text:#f2f2f2;--muted:#9a9a9a;--accent:#e5e5e5;--accent2:#a3a3a3;--teal:#e5e5e5;--amber:#d4d4d4;--grad:linear-gradient(100deg,#ffffff,#a3a3a3 55%,#ffffff);--radius:10px}
body::before{background:radial-gradient(55vw 55vw at 8% -5%,rgba(255,255,255,.05),transparent 60%)}
.btn-primary{background:linear-gradient(135deg,#ffffff,#c7c7c7);color:#0f0f0f;box-shadow:0 14px 30px -12px rgba(0,0,0,.7)}
.nx-marquee span::after{content:"◆";color:#a3a3a3}`,
};
// Theme overrides appended after any design's CSS (accent, font, radius, animation).
function themeOverridesCss(opts) {
  const parts = [];
  const accent = String(opts.accent || '').trim();
  const accent2 = String(opts.accent2 || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(accent)) {
    const a2 = /^#[0-9a-fA-F]{6}$/.test(accent2) ? accent2 : accent;
    parts.push(`:root{--accent:${accent};--accent2:${a2};--teal:${accent};--grad:linear-gradient(100deg,${accent},${a2} 55%,${a2})}`);
  }
  const radius = opts.radius;
  if (radius === 'sharp') parts.push(':root{--radius:8px}');
  if (radius === 'round') parts.push(':root{--radius:24px}');
  const font = String(opts.font || '').trim();
  const FONTS = {
    inter: ["'Inter'", 'Inter', 'sans-serif'],
    poppins: ["'Poppins'", 'Poppins', 'sans-serif'],
    playfair: ["'Playfair Display'", 'Playfair Display', 'Georgia, serif'],
    space: ["'Space Grotesk'", 'Space Grotesk', 'sans-serif'],
    dm: ["'DM Sans'", 'DM Sans', 'sans-serif'],
  };
  if (FONTS[font]) parts.push(`body{font-family:${FONTS[font][0]},${FONTS[font][1]},${FONTS[font][2]}}`);
  const anim = opts.animation_level;
  if (anim === 'subtle') parts.push('[data-reveal]{transform:translateY(14px);transition-duration:.45s}.nx-hero-img img{animation:none}.nx-marquee-track{animation-duration:40s}');
  if (anim === 'expressive') parts.push('[data-reveal]{transform:translateY(40px) scale(.985);transition-duration:.9s}.nx-hero-img img{animation-duration:5s}.nx-card:hover{transform:translateY(-10px) rotate(-.4deg)}.nx-marquee-track{animation-duration:18s}.nx-stat b{transition:transform .3s}.nx-stat:hover b{transform:scale(1.08)}');
  return parts.join('\n');
}
function isValidDesignId(id) { return !!(SITE_DESIGNS[id] || DESIGN_EXTRAS[id]); }
function resolveDesignCss(designId, opts) {
  const d = SITE_DESIGNS[designId] || SITE_DESIGNS.sentinel;
  let css = d.css || '';
  const extra = DESIGN_EXTRAS[designId];
  if (extra) css += '\n' + extra;
  css += '\n' + themeOverridesCss(opts || {});
  return css;
}
// Favicon from an emoji (data URI, no external request).
function emojiFavicon(emoji) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${emoji}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
const SITE_DESIGNS = {
  sentinel: {
    name: 'Bold & Interactive (Sentinel style)',
    css: `/* design: sentinel */
:root{--bg:#0b0e14;--bg2:#11151f;--card:#161b28;--line:#232a3d;--text:#e8ecf4;--muted:#93a0b8;--accent:#f7742a;--accent2:#ffb24d;--teal:#2fb3a2;--amber:#ffcf6e;--grad:linear-gradient(100deg,#f7742a 8%,#ffcf6e 45%,#2fb3a2 85%);--radius:16px;--ease:cubic-bezier(.2,.7,.2,1)}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.65;overflow-x:hidden}
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(60vw 60vw at 8% -5%,rgba(247,116,42,.09),transparent 60%),radial-gradient(55vw 55vw at 105% 108%,rgba(47,179,162,.10),transparent 60%)}
main,header,section,footer{position:relative;z-index:1}
a{color:var(--teal);text-decoration:none}
img{max-width:100%;height:auto;display:block}
.container{max-width:1120px;margin:0 auto;padding:0 22px}
.section{padding:88px 0}
.section+section::before{content:"";position:absolute;top:0;left:50%;transform:translateX(-50%);width:min(220px,40%);height:1px;background:linear-gradient(90deg,transparent,var(--teal),transparent);opacity:.5}
.eyebrow{display:inline-flex;align-items:center;gap:8px;color:var(--teal);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin-bottom:12px}
.eyebrow::before{content:"";width:26px;height:2px;background:linear-gradient(90deg,var(--teal),transparent);border-radius:2px}
h1,h2,h3{line-height:1.15;letter-spacing:-.02em}
.sec-title{font-size:clamp(28px,4vw,42px);font-weight:800;margin-bottom:14px}
.grad-text{background:var(--grad);background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:sheen 8s linear infinite}
@keyframes sheen{to{background-position:220% 50%}}
.btn{display:inline-flex;align-items:center;gap:8px;padding:13px 26px;border-radius:12px;font-weight:700;font-size:14px;border:none;cursor:pointer;transition:transform .25s var(--ease),box-shadow .25s,filter .25s;text-decoration:none}
.btn-primary{background:linear-gradient(135deg,#ffb24d,var(--accent) 55%,#c2551a);color:#1a120b;box-shadow:0 14px 34px -10px rgba(247,116,42,.55),inset 0 1px 0 rgba(255,255,255,.3)}
.btn-primary:hover{transform:translateY(-3px);box-shadow:0 22px 50px -12px rgba(247,116,42,.7),0 6px 20px -6px rgba(47,179,162,.5)}
.btn-ghost{background:transparent;border:1px solid var(--line);color:var(--text)}
.btn-ghost:hover{border-color:var(--teal);background:rgba(47,179,162,.1);transform:translateY(-3px)}
/* nav */
.nx-nav{position:sticky;top:0;z-index:50;background:rgba(11,14,20,.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line);transition:box-shadow .3s}
.nx-nav.scrolled{box-shadow:0 10px 40px -12px rgba(0,0,0,.6)}
.nx-nav-inner{display:flex;align-items:center;justify-content:space-between;padding:15px 0;gap:14px}
.nx-brand{font-size:19px;font-weight:800;letter-spacing:-.02em}
.nx-brand em{font-style:normal;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.nx-nav-links{display:flex;gap:22px;list-style:none;align-items:center}
.nx-nav-links a{color:var(--muted);font-size:14px;font-weight:600;transition:color .2s}
.nx-nav-links a:hover{color:var(--teal)}
.nx-menu-btn{display:none;background:none;border:1px solid var(--line);color:var(--text);border-radius:10px;padding:8px 12px;font-size:18px;cursor:pointer}
/* hero */
.nx-hero{position:relative;padding:110px 0 90px;overflow:hidden}
#nx-spot{position:fixed;width:520px;height:520px;border-radius:50%;pointer-events:none;z-index:0;background:radial-gradient(circle,rgba(247,116,42,.10),transparent 65%);transform:translate(-50%,-50%);mix-blend-mode:screen;will-change:transform}
.nx-hero-inner{display:grid;grid-template-columns:1.1fr .9fr;gap:50px;align-items:center;position:relative;z-index:2}
.nx-hero h1{font-size:clamp(36px,6vw,64px);font-weight:900;margin-bottom:18px}
.nx-hero p.lead{font-size:clamp(16px,2vw,19px);color:var(--muted);max-width:520px;margin-bottom:28px}
.nx-hero-actions{display:flex;gap:12px;flex-wrap:wrap}
.nx-hero-img{position:relative}
.nx-hero-img img{border-radius:var(--radius);box-shadow:0 40px 90px -30px rgba(0,0,0,.8);animation:float 7s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
.nx-badge{display:inline-flex;align-items:center;gap:8px;background:rgba(47,179,162,.12);border:1px solid rgba(47,179,162,.3);color:var(--teal);border-radius:30px;padding:7px 14px;font-size:12px;font-weight:700;margin-bottom:20px}
.nx-badge .dot{width:8px;height:8px;border-radius:50%;background:var(--teal);box-shadow:0 0 10px var(--teal);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
/* marquee */
.nx-marquee{overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:18px 0;background:var(--bg2)}
.nx-marquee-track{display:flex;gap:44px;white-space:nowrap;animation:marquee 26s linear infinite;will-change:transform}
.nx-marquee span{font-size:15px;font-weight:700;color:var(--muted);display:inline-flex;align-items:center;gap:44px}
.nx-marquee span::after{content:"✦";color:var(--accent)}
@keyframes marquee{to{transform:translateX(-50%)}}
/* stats */
.nx-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:18px}
.nx-stat{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px;text-align:center;position:relative;overflow:hidden;transition:transform .25s var(--ease),border-color .25s,box-shadow .25s}
.nx-stat::after{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:var(--grad);opacity:0;transition:opacity .25s}
.nx-stat:hover{transform:translateY(-5px);border-color:rgba(47,179,162,.4);box-shadow:0 22px 44px -22px rgba(0,0,0,.7)}
.nx-stat:hover::after{opacity:1}
.nx-stat b{font-size:clamp(26px,3.4vw,38px);font-weight:900;display:block;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.nx-stat span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-weight:700}
/* cards */
.nx-grid{display:grid;gap:22px}
.g2{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.g3{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.nx-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:28px;position:relative;overflow:hidden;transition:transform .3s var(--ease),border-color .3s,box-shadow .3s;will-change:transform}
.nx-card::before{content:"";position:absolute;inset:0;border-radius:inherit;background:radial-gradient(420px circle at var(--gx,50%) var(--gy,50%),rgba(255,178,77,.14),transparent 60%);opacity:0;transition:opacity .3s;pointer-events:none}
.nx-card:hover{transform:translateY(-6px);border-color:rgba(247,116,42,.45);box-shadow:0 30px 60px -28px rgba(0,0,0,.85)}
.nx-card:hover::before{opacity:1}
.nx-card .ic{font-size:34px;margin-bottom:14px;transition:transform .45s var(--ease)}
.nx-card:hover .ic{transform:translateY(-4px) rotate(-6deg) scale(1.1)}
.nx-card h3{font-size:18px;margin-bottom:8px}
.nx-card p{color:var(--muted);font-size:14px}
.nx-num{position:absolute;top:16px;right:20px;font-size:44px;font-weight:900;color:rgba(255,255,255,.05)}
/* why / about split */
.nx-split{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:center}
.nx-check{display:flex;gap:10px;align-items:flex-start;margin:10px 0;color:var(--muted)}
.nx-check b{color:var(--text)}
.nx-check::before{content:"✓";flex-shrink:0;width:22px;height:22px;border-radius:50%;background:rgba(47,179,162,.16);color:var(--teal);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800}
/* process steps */
.nx-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:20px;counter-reset:step}
.nx-step{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px;position:relative;transition:transform .25s var(--ease),border-color .25s}
.nx-step:hover{transform:translateY(-5px);border-color:var(--teal)}
.nx-step .n{font-size:40px;font-weight:900;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;display:block;margin-bottom:10px}
/* parallax band */
.nx-parallax{background:linear-gradient(135deg,rgba(247,116,42,.14),rgba(47,179,162,.12)),var(--bg2);padding:80px 0;text-align:center;position:relative;overflow:hidden}
.nx-parallax h2{font-size:clamp(26px,4vw,40px);font-weight:900;margin-bottom:14px}
.nx-parallax p{color:var(--muted);max-width:640px;margin:0 auto 24px}
/* gallery */
.nx-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.nx-gallery img{aspect-ratio:4/3;object-fit:cover;border-radius:12px;border:1px solid var(--line);cursor:zoom-in;transition:transform .6s var(--ease),filter .4s;width:100%}
.nx-gallery img:hover{transform:scale(1.04);filter:saturate(1.15)}
/* reviews */
.nx-tstrip{display:flex;gap:18px;overflow-x:auto;padding:8px 2px 18px;scroll-snap-type:x mandatory;scrollbar-width:none}
.nx-tstrip::-webkit-scrollbar{display:none}
.nx-review{min-width:280px;flex:0 0 280px;scroll-snap-align:start;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:24px}
.nx-review .stars{color:var(--amber);margin-bottom:10px;letter-spacing:2px}
.nx-review p{font-size:14px;color:var(--muted);font-style:italic;margin-bottom:14px}
.nx-review .who{font-size:13px;font-weight:700}
.nx-review .who span{color:var(--text3,#64748b);font-weight:500}
/* lead magnet */
.nx-lead{background:var(--card);border:1px solid var(--line);border-radius:calc(var(--radius) + 6px);padding:48px;text-align:center;position:relative;overflow:hidden}
.nx-lead::before{content:"";position:absolute;top:-60px;right:-60px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(247,116,42,.25),transparent 70%)}
.nx-lead h2{font-size:clamp(24px,3.4vw,36px);font-weight:900;margin-bottom:10px}
.nx-lead p{color:var(--muted);max-width:520px;margin:0 auto 22px}
/* faq */
.nx-faq{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.nx-faq-q{width:100%;text-align:left;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;font-size:15px;font-weight:700;color:var(--text);cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;transition:border-color .2s}
.nx-faq-q:hover{border-color:var(--teal)}
.nx-faq-q .arr{transition:transform .3s var(--ease);color:var(--teal)}
.nx-faq-item.open .arr{transform:rotate(45deg)}
.nx-faq-a{max-height:0;overflow:hidden;transition:max-height .35s var(--ease);color:var(--muted);font-size:14px}
.nx-faq-item.open .nx-faq-a{max-height:300px;padding:4px 20px 16px}
/* contact */
.nx-contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start}
.nx-cinfo{display:flex;flex-direction:column;gap:14px}
.nx-cinfo div{display:flex;gap:12px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.nx-cinfo b{display:block;font-size:13px;margin-bottom:2px}
.nx-cinfo span{color:var(--muted);font-size:14px}
.nx-form{display:flex;flex-direction:column;gap:14px}
.nx-form input,.nx-form textarea{background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:13px 16px;color:var(--text);font-size:14px;font-family:inherit;outline:none;transition:border-color .2s,box-shadow .2s}
.nx-form input:focus,.nx-form textarea:focus{border-color:var(--teal);box-shadow:0 0 0 3px rgba(47,179,162,.2)}
.nx-form textarea{min-height:120px;resize:vertical}
.nx-form .ok{color:var(--teal);font-size:14px;font-weight:700;display:none}
/* footer */
.nx-footer{border-top:1px solid var(--line);padding:34px 0;text-align:center;color:var(--muted);font-size:13px;background:var(--bg2)}
.nx-footer a{color:var(--teal)}
/* reveal + back-to-top */
[data-reveal]{opacity:0;transform:translateY(26px);transition:opacity .7s var(--ease),transform .7s var(--ease)}
[data-reveal].in{opacity:1;transform:none}
[data-reveal][data-delay="1"]{transition-delay:.1s}[data-reveal][data-delay="2"]{transition-delay:.2s}[data-reveal][data-delay="3"]{transition-delay:.3s}
#nx-top{position:fixed;bottom:22px;right:22px;width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#c2551a);color:#fff;border:none;font-size:18px;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .3s,transform .3s;z-index:60;box-shadow:0 10px 30px -8px rgba(247,116,42,.6)}
#nx-top.show{opacity:1;pointer-events:auto}
#nx-top:hover{transform:translateY(-3px)}
.nx-lightbox{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:90;display:none;align-items:center;justify-content:center;padding:30px;cursor:zoom-out}
.nx-lightbox img{max-width:92vw;max-height:88vh;border-radius:12px}
@media(max-width:820px){.nx-hero-inner,.nx-split,.nx-contact-grid{grid-template-columns:1fr}.nx-hero{padding:70px 0 56px}.nx-nav-links{display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg2);border-bottom:1px solid var(--line);flex-direction:column;padding:14px 22px;gap:14px}.nx-nav-links.open{display:flex}.nx-menu-btn{display:block}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}[data-reveal]{opacity:1;transform:none}#nx-spot{display:none}}`,
  },
  aurora: {
    name: 'Aurora (light, airy, gradient)',
    css: `/* design: aurora */
:root{--bg:#f7f9fc;--bg2:#eef2f9;--card:#ffffff;--line:#e2e8f0;--text:#0f172a;--muted:#5b6b84;--accent:#4f46e5;--accent2:#7c3aed;--teal:#06b6d4;--amber:#f59e0b;--grad:linear-gradient(100deg,#4f46e5,#7c3aed 50%,#06b6d4);--radius:16px;--ease:cubic-bezier(.2,.7,.2,1)}
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.65;overflow-x:hidden}
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(50vw 50vw at 90% -10%,rgba(124,58,237,.10),transparent 60%),radial-gradient(45vw 45vw at 0% 105%,rgba(6,182,212,.10),transparent 60%)}
main,header,section,footer{position:relative;z-index:1}
a{color:var(--accent);text-decoration:none}img{max-width:100%;height:auto;display:block}
.container{max-width:1120px;margin:0 auto;padding:0 22px}.section{padding:88px 0}
.eyebrow{display:inline-flex;align-items:center;gap:8px;color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin-bottom:12px}
.sec-title{font-size:clamp(28px,4vw,42px);font-weight:900;margin-bottom:14px;letter-spacing:-.02em}
.grad-text{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.btn{display:inline-flex;align-items:center;gap:8px;padding:13px 26px;border-radius:999px;font-weight:700;font-size:14px;border:none;cursor:pointer;transition:transform .25s var(--ease),box-shadow .25s;text-decoration:none}
.btn-primary{background:var(--grad);color:#fff;box-shadow:0 14px 30px -10px rgba(79,70,229,.5)}
.btn-primary:hover{transform:translateY(-3px);box-shadow:0 20px 40px -12px rgba(79,70,229,.6)}
.btn-ghost{background:#fff;border:1px solid var(--line);color:var(--text);box-shadow:0 4px 14px -6px rgba(15,23,42,.08)}
.btn-ghost:hover{border-color:var(--accent);transform:translateY(-3px)}
.nx-nav{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.8);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.nx-nav-inner{display:flex;align-items:center;justify-content:space-between;padding:15px 0;gap:14px}
.nx-brand{font-size:19px;font-weight:900;letter-spacing:-.02em}.nx-brand em{font-style:normal;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.nx-nav-links{display:flex;gap:22px;list-style:none}.nx-nav-links a{color:var(--muted);font-size:14px;font-weight:600}
.nx-nav-links a:hover{color:var(--accent)}.nx-menu-btn{display:none;background:none;border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:18px;cursor:pointer}
.nx-hero{padding:104px 0 84px;position:relative;overflow:hidden}
.nx-hero::before{content:"";position:absolute;top:-140px;left:50%;transform:translateX(-50%);width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(124,58,237,.14),transparent 65%);filter:blur(10px)}
.nx-hero-inner{display:grid;grid-template-columns:1.1fr .9fr;gap:50px;align-items:center;position:relative;z-index:2}
.nx-hero h1{font-size:clamp(36px,6vw,60px);font-weight:900;margin-bottom:18px;letter-spacing:-.03em}
.nx-hero p.lead{color:var(--muted);font-size:18px;max-width:520px;margin-bottom:28px}
.nx-hero-actions{display:flex;gap:12px;flex-wrap:wrap}
.nx-hero-img img{border-radius:24px;box-shadow:0 40px 80px -30px rgba(79,70,229,.35);animation:float 7s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
.nx-badge{display:inline-flex;align-items:center;gap:8px;background:rgba(79,70,229,.08);border:1px solid rgba(79,70,229,.25);color:var(--accent);border-radius:30px;padding:7px 14px;font-size:12px;font-weight:800;margin-bottom:20px}
.nx-marquee{overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:16px 0;background:#fff}
.nx-marquee-track{display:flex;gap:44px;white-space:nowrap;animation:marquee 30s linear infinite}
.nx-marquee span{font-weight:700;color:var(--muted);display:inline-flex;align-items:center;gap:44px}
.nx-marquee span::after{content:"✦";color:var(--accent)}
@keyframes marquee{to{transform:translateX(-50%)}}
.nx-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px}
.nx-stat{background:#fff;border:1px solid var(--line);border-radius:20px;padding:26px;text-align:center;box-shadow:0 8px 24px -14px rgba(15,23,42,.12);transition:transform .25s var(--ease),box-shadow .25s}
.nx-stat:hover{transform:translateY(-5px);box-shadow:0 18px 40px -18px rgba(79,70,229,.25)}
.nx-stat b{font-size:clamp(26px,3.4vw,38px);font-weight:900;display:block;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.nx-stat span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-weight:700}
.nx-grid{display:grid;gap:20px}.g2{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}.g3{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.nx-card{background:#fff;border:1px solid var(--line);border-radius:20px;padding:28px;transition:transform .3s var(--ease),box-shadow .3s,border-color .3s;will-change:transform}
.nx-card:hover{transform:translateY(-6px);box-shadow:0 26px 50px -22px rgba(79,70,229,.28);border-color:rgba(124,58,237,.3)}
.nx-card .ic{font-size:34px;margin-bottom:14px}.nx-card h3{font-size:18px;margin-bottom:8px}.nx-card p{color:var(--muted);font-size:14px}
.nx-split{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:center}
.nx-check{display:flex;gap:10px;align-items:flex-start;margin:10px 0;color:var(--muted)}
.nx-check::before{content:"✓";flex-shrink:0;width:22px;height:22px;border-radius:50%;background:rgba(79,70,229,.12);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800}
.nx-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:20px}
.nx-step{background:#fff;border:1px solid var(--line);border-radius:20px;padding:26px;transition:transform .25s var(--ease),box-shadow .25s}
.nx-step:hover{transform:translateY(-5px);box-shadow:0 18px 40px -18px rgba(79,70,229,.2)}
.nx-step .n{font-size:40px;font-weight:900;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;display:block;margin-bottom:10px}
.nx-parallax{background:linear-gradient(135deg,rgba(79,70,229,.12),rgba(6,182,212,.12)),#fff;padding:80px 0;text-align:center}
.nx-parallax h2{font-size:clamp(26px,4vw,40px);font-weight:900;margin-bottom:14px}.nx-parallax p{color:var(--muted);max-width:640px;margin:0 auto 24px}
.nx-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.nx-gallery img{aspect-ratio:4/3;object-fit:cover;border-radius:16px;cursor:zoom-in;transition:transform .5s var(--ease)}
.nx-gallery img:hover{transform:scale(1.04)}
.nx-tstrip{display:flex;gap:16px;overflow-x:auto;padding:8px 2px 18px;scroll-snap-type:x mandatory;scrollbar-width:none}
.nx-tstrip::-webkit-scrollbar{display:none}
.nx-review{min-width:280px;flex:0 0 280px;scroll-snap-align:start;background:#fff;border:1px solid var(--line);border-radius:20px;padding:24px;box-shadow:0 8px 24px -14px rgba(15,23,42,.1)}
.nx-review .stars{color:var(--amber);margin-bottom:10px;letter-spacing:2px}.nx-review p{font-size:14px;color:var(--muted);font-style:italic;margin-bottom:14px}.nx-review .who{font-size:13px;font-weight:800}
.nx-lead{background:var(--grad);border-radius:28px;padding:52px;text-align:center;color:#fff;position:relative;overflow:hidden}
.nx-lead h2{font-size:clamp(24px,3.4vw,36px);font-weight:900;margin-bottom:10px}.nx-lead p{opacity:.9;max-width:520px;margin:0 auto 22px}
.nx-lead .btn-primary{background:#fff;color:var(--accent);box-shadow:0 14px 30px -10px rgba(0,0,0,.3)}
.nx-faq{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.nx-faq-q{width:100%;text-align:left;background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;font-size:15px;font-weight:700;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;transition:border-color .2s}
.nx-faq-q:hover{border-color:var(--accent)}.nx-faq-q .arr{transition:transform .3s var(--ease);color:var(--accent)}
.nx-faq-item.open .arr{transform:rotate(45deg)}
.nx-faq-a{max-height:0;overflow:hidden;transition:max-height .35s var(--ease);color:var(--muted);font-size:14px}
.nx-faq-item.open .nx-faq-a{max-height:300px;padding:4px 20px 16px}
.nx-contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start}
.nx-cinfo{display:flex;flex-direction:column;gap:14px}
.nx-cinfo div{display:flex;gap:12px;align-items:flex-start;background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.nx-cinfo b{display:block;font-size:13px;margin-bottom:2px}.nx-cinfo span{color:var(--muted);font-size:14px}
.nx-form{display:flex;flex-direction:column;gap:14px}
.nx-form input,.nx-form textarea{background:#fff;border:1px solid var(--line);border-radius:12px;padding:13px 16px;font-size:14px;font-family:inherit;outline:none;transition:border-color .2s,box-shadow .2s}
.nx-form input:focus,.nx-form textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(79,70,229,.15)}
.nx-form textarea{min-height:120px;resize:vertical}.nx-form .ok{color:var(--teal);font-size:14px;font-weight:800;display:none}
.nx-footer{border-top:1px solid var(--line);padding:34px 0;text-align:center;color:var(--muted);font-size:13px;background:#fff}
[data-reveal]{opacity:0;transform:translateY(26px);transition:opacity .7s var(--ease),transform .7s var(--ease)}
[data-reveal].in{opacity:1;transform:none}
[data-reveal][data-delay="1"]{transition-delay:.1s}[data-reveal][data-delay="2"]{transition-delay:.2s}[data-reveal][data-delay="3"]{transition-delay:.3s}
#nx-top{position:fixed;bottom:22px;right:22px;width:44px;height:44px;border-radius:50%;background:var(--grad);color:#fff;border:none;font-size:18px;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .3s;z-index:60}
#nx-top.show{opacity:1;pointer-events:auto}
.nx-lightbox{position:fixed;inset:0;background:rgba(15,23,42,.85);z-index:90;display:none;align-items:center;justify-content:center;padding:30px;cursor:zoom-out}
.nx-lightbox img{max-width:92vw;max-height:88vh;border-radius:12px}
@media(max-width:820px){.nx-hero-inner,.nx-split,.nx-contact-grid{grid-template-columns:1fr}.nx-hero{padding:70px 0 56px}.nx-nav-links{display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border-bottom:1px solid var(--line);flex-direction:column;padding:14px 22px;gap:14px}.nx-nav-links.open{display:flex}.nx-menu-btn{display:block}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}[data-reveal]{opacity:1;transform:none}}`,
  },
  slate: {
    name: 'Slate (dark, minimal, elegant)',
    css: `/* design: slate */
:root{--bg:#0a0c10;--bg2:#101319;--card:#151a22;--line:#222a36;--text:#e6eaf2;--muted:#8b97ab;--accent:#5b8def;--accent2:#8fa8ff;--teal:#7ee2d0;--amber:#f2c14e;--grad:linear-gradient(100deg,#5b8def,#8fa8ff 55%,#7ee2d0);--radius:14px;--ease:cubic-bezier(.2,.7,.2,1)}
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.65;overflow-x:hidden}
main,header,section,footer{position:relative;z-index:1}
a{color:var(--accent);text-decoration:none}img{max-width:100%;height:auto;display:block}
.container{max-width:1120px;margin:0 auto;padding:0 22px}.section{padding:88px 0}
.eyebrow{color:var(--teal);font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;margin-bottom:12px;display:block}
.sec-title{font-size:clamp(28px,4vw,42px);font-weight:800;margin-bottom:14px;letter-spacing:-.02em}
.grad-text{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.btn{display:inline-flex;align-items:center;gap:8px;padding:13px 26px;border-radius:10px;font-weight:700;font-size:14px;border:none;cursor:pointer;transition:transform .25s var(--ease),box-shadow .25s,background .25s;text-decoration:none}
.btn-primary{background:var(--accent);color:#0a0c10}
.btn-primary:hover{transform:translateY(-3px);box-shadow:0 18px 36px -14px rgba(91,141,239,.6)}
.btn-ghost{background:transparent;border:1px solid var(--line);color:var(--text)}
.btn-ghost:hover{border-color:var(--accent);transform:translateY(-3px)}
.nx-nav{position:sticky;top:0;z-index:50;background:rgba(10,12,16,.85);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.nx-nav-inner{display:flex;align-items:center;justify-content:space-between;padding:15px 0;gap:14px}
.nx-brand{font-size:19px;font-weight:800}.nx-brand em{font-style:normal;color:var(--accent)}
.nx-nav-links{display:flex;gap:22px;list-style:none}.nx-nav-links a{color:var(--muted);font-size:14px;font-weight:600}.nx-nav-links a:hover{color:var(--text)}
.nx-menu-btn{display:none;background:none;border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:18px;cursor:pointer;color:var(--text)}
.nx-hero{padding:110px 0 90px;text-align:center;position:relative;overflow:hidden}
.nx-hero::before{content:"";position:absolute;top:-160px;left:50%;transform:translateX(-50%);width:760px;height:760px;border-radius:50%;background:radial-gradient(circle,rgba(91,141,239,.16),transparent 65%)}
.nx-hero h1{font-size:clamp(36px,6vw,62px);font-weight:900;margin:0 auto 18px;max-width:800px;letter-spacing:-.03em}
.nx-hero p.lead{color:var(--muted);font-size:18px;max-width:560px;margin:0 auto 30px}
.nx-hero-actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.nx-badge{display:inline-flex;align-items:center;gap:8px;background:rgba(126,226,208,.1);border:1px solid rgba(126,226,208,.3);color:var(--teal);border-radius:30px;padding:7px 14px;font-size:12px;font-weight:700;margin-bottom:20px}
.nx-marquee{overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:16px 0}
.nx-marquee-track{display:flex;gap:44px;white-space:nowrap;animation:marquee 34s linear infinite}
.nx-marquee span{color:var(--muted);font-weight:600;display:inline-flex;align-items:center;gap:44px}
.nx-marquee span::after{content:"—";color:var(--accent)}
@keyframes marquee{to{transform:translateX(-50%)}}
.nx-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px}
.nx-stat{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px;text-align:center;transition:transform .25s var(--ease),border-color .25s}
.nx-stat:hover{transform:translateY(-5px);border-color:rgba(91,141,239,.4)}
.nx-stat b{font-size:clamp(26px,3.4vw,38px);font-weight:900;display:block;color:var(--accent)}
.nx-stat span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;font-weight:700}
.nx-grid{display:grid;gap:20px}.g2{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}.g3{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.nx-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:28px;transition:transform .3s var(--ease),border-color .3s}
.nx-card:hover{transform:translateY(-6px);border-color:rgba(91,141,239,.5)}
.nx-card .ic{font-size:34px;margin-bottom:14px}.nx-card h3{font-size:18px;margin-bottom:8px}.nx-card p{color:var(--muted);font-size:14px}
.nx-split{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:center}
.nx-check{display:flex;gap:10px;align-items:flex-start;margin:10px 0;color:var(--muted)}
.nx-check::before{content:"✓";flex-shrink:0;width:22px;height:22px;border-radius:50%;background:rgba(126,226,208,.14);color:var(--teal);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800}
.nx-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:20px}
.nx-step{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px;transition:transform .25s var(--ease),border-color .25s}
.nx-step:hover{transform:translateY(-5px);border-color:var(--accent)}
.nx-step .n{font-size:40px;font-weight:900;color:var(--accent);display:block;margin-bottom:10px}
.nx-parallax{background:linear-gradient(135deg,rgba(91,141,239,.14),rgba(126,226,208,.1)),var(--bg2);padding:80px 0;text-align:center}
.nx-parallax h2{font-size:clamp(26px,4vw,40px);font-weight:900;margin-bottom:14px}.nx-parallax p{color:var(--muted);max-width:640px;margin:0 auto 24px}
.nx-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.nx-gallery img{aspect-ratio:4/3;object-fit:cover;border-radius:12px;cursor:zoom-in;transition:transform .5s var(--ease)}
.nx-gallery img:hover{transform:scale(1.04)}
.nx-tstrip{display:flex;gap:16px;overflow-x:auto;padding:8px 2px 18px;scroll-snap-type:x mandatory;scrollbar-width:none}
.nx-tstrip::-webkit-scrollbar{display:none}
.nx-review{min-width:280px;flex:0 0 280px;scroll-snap-align:start;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:24px}
.nx-review .stars{color:var(--amber);margin-bottom:10px;letter-spacing:2px}.nx-review p{font-size:14px;color:var(--muted);font-style:italic;margin-bottom:14px}.nx-review .who{font-size:13px;font-weight:700}
.nx-lead{background:var(--card);border:1px solid var(--line);border-radius:calc(var(--radius) + 6px);padding:48px;text-align:center}
.nx-lead h2{font-size:clamp(24px,3.4vw,36px);font-weight:900;margin-bottom:10px}.nx-lead p{color:var(--muted);max-width:520px;margin:0 auto 22px}
.nx-faq{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.nx-faq-q{width:100%;text-align:left;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;font-size:15px;font-weight:700;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;transition:border-color .2s}
.nx-faq-q:hover{border-color:var(--accent)}.nx-faq-q .arr{transition:transform .3s var(--ease);color:var(--accent)}
.nx-faq-item.open .arr{transform:rotate(45deg)}
.nx-faq-a{max-height:0;overflow:hidden;transition:max-height .35s var(--ease);color:var(--muted);font-size:14px}
.nx-faq-item.open .nx-faq-a{max-height:300px;padding:4px 20px 16px}
.nx-contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start}
.nx-cinfo{display:flex;flex-direction:column;gap:14px}
.nx-cinfo div{display:flex;gap:12px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.nx-cinfo b{display:block;font-size:13px;margin-bottom:2px}.nx-cinfo span{color:var(--muted);font-size:14px}
.nx-form{display:flex;flex-direction:column;gap:14px}
.nx-form input,.nx-form textarea{background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:13px 16px;color:var(--text);font-size:14px;font-family:inherit;outline:none;transition:border-color .2s}
.nx-form input:focus,.nx-form textarea:focus{border-color:var(--accent)}
.nx-form textarea{min-height:120px;resize:vertical}.nx-form .ok{color:var(--teal);font-size:14px;font-weight:800;display:none}
.nx-footer{border-top:1px solid var(--line);padding:34px 0;text-align:center;color:var(--muted);font-size:13px}
[data-reveal]{opacity:0;transform:translateY(26px);transition:opacity .7s var(--ease),transform .7s var(--ease)}
[data-reveal].in{opacity:1;transform:none}
[data-reveal][data-delay="1"]{transition-delay:.1s}[data-reveal][data-delay="2"]{transition-delay:.2s}[data-reveal][data-delay="3"]{transition-delay:.3s}
#nx-top{position:fixed;bottom:22px;right:22px;width:44px;height:44px;border-radius:50%;background:var(--accent);color:#0a0c10;border:none;font-size:18px;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .3s;z-index:60}
#nx-top.show{opacity:1;pointer-events:auto}
.nx-lightbox{position:fixed;inset:0;background:rgba(10,12,16,.88);z-index:90;display:none;align-items:center;justify-content:center;padding:30px;cursor:zoom-out}
.nx-lightbox img{max-width:92vw;max-height:88vh;border-radius:12px}
@media(max-width:820px){.nx-hero-inner,.nx-split,.nx-contact-grid{grid-template-columns:1fr}.nx-hero{padding:70px 0 56px}.nx-nav-links{display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg2);border-bottom:1px solid var(--line);flex-direction:column;padding:14px 22px;gap:14px}.nx-nav-links.open{display:flex}.nx-menu-btn{display:block}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}[data-reveal]{opacity:1;transform:none}}`,
  },
};
// Interactive engine injected into every generated site (compact; reduced-motion aware)
const SITE_JS = `(function(){
var mm=function(q){try{return (typeof matchMedia!=='undefined')?matchMedia(q).matches:false;}catch(e){return false;}};
var R=mm('(prefers-reduced-motion: reduce)');
/* scroll reveal */
var els=document.querySelectorAll('[data-reveal]');
if(R){els.forEach(function(e){e.classList.add('in');});}
else if('IntersectionObserver' in window){
  var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target);}});},{threshold:.06,rootMargin:'70px 0px 70px 0px'});
  els.forEach(function(e){io.observe(e);});
}
/* count-up */
var cels=document.querySelectorAll('[data-count]');
if(cels.length){
  var cio=new IntersectionObserver(function(es){es.forEach(function(x){if(!x.isIntersecting)return;cio.unobserve(x.target);var el=x.target,t=+el.getAttribute('data-count');if(R){el.textContent=t;return;}var st=performance.now(),dur=760;function tick(n){var p=Math.min(1,(n-st)/dur);el.textContent=Math.round(t*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(tick);}requestAnimationFrame(tick);});},{threshold:.3});
  cels.forEach(function(e){cio.observe(e);});
}
/* sticky nav glass */
var nav=document.querySelector('.nx-nav');
if(nav){var onS=function(){nav.classList.toggle('scrolled',scrollY>30);};addEventListener('scroll',onS,{passive:true});onS();}
/* mobile menu */
var mb=document.querySelector('.nx-menu-btn'),nl=document.querySelector('.nx-nav-links');
if(mb&&nl){mb.addEventListener('click',function(){nl.classList.toggle('open');});
  nl.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){nl.classList.remove('open');});});}
/* smooth anchors */
document.querySelectorAll('a[href^="#"]').forEach(function(a){a.addEventListener('click',function(e){var id=a.getAttribute('href');if(id.length<2)return;var t=document.querySelector(id);if(t){e.preventDefault();t.scrollIntoView({behavior:R?'auto':'smooth'});}});});
/* FAQ accordion */
document.querySelectorAll('.nx-faq-q').forEach(function(q){q.addEventListener('click',function(){q.parentElement.classList.toggle('open');});});
/* gallery lightbox */
var gl=document.querySelectorAll('.nx-gallery img');
if(gl.length){var lb=document.createElement('div');lb.className='nx-lightbox';var li=document.createElement('img');lb.appendChild(li);document.body.appendChild(lb);
  gl.forEach(function(img){img.addEventListener('click',function(){li.src=img.getAttribute('src');lb.style.display='flex';});});
  lb.addEventListener('click',function(){lb.style.display='none';});}
/* back to top */
var bt=document.createElement('button');bt.id='nx-top';bt.textContent='↑';bt.setAttribute('aria-label','Back to top');document.body.appendChild(bt);
addEventListener('scroll',function(){bt.classList.toggle('show',scrollY>500);},{passive:true});
bt.addEventListener('click',function(){scrollTo({top:0,behavior:R?'auto':'smooth'});});
/* cursor spotlight (fine pointers only) */
if(!R&&mm('(pointer:fine)')){
  var sp=document.createElement('div');sp.id='nx-spot';document.body.appendChild(sp);
  var x=innerWidth/2,y=innerHeight/2,cx=x,cy=y,raf=0;
  addEventListener('pointermove',function(e){x=e.clientX;y=e.clientY;if(!raf)raf=requestAnimationFrame(function(){raf=0;cx+=(x-cx)*.16;cy+=(y-cy)*.16;sp.style.left=cx+'px';sp.style.top=cy+'px';});},{passive:true});
}
/* card tilt + glare */
if(!R&&mm('(pointer:fine)')){
  document.querySelectorAll('.nx-card,.nx-stat').forEach(function(c){c.addEventListener('pointermove',function(e){var r=c.getBoundingClientRect();c.style.setProperty('--gx',((e.clientX-r.left)/r.width*100)+'%');c.style.setProperty('--gy',((e.clientY-r.top)/r.height*100)+'%');});});
}
/* countdown timer: <span data-countdown="2026-01-01"> */
document.querySelectorAll('[data-countdown]').forEach(function(el){
  var end = new Date(el.getAttribute('data-countdown')).getTime();
  if (isNaN(end)) return;
  function tick(){var d=end-Date.now();if(d<=0){el.textContent='Offer ends soon!';return;}
    var days=Math.floor(d/864e5),hrs=Math.floor(d%864e5/36e5),min=Math.floor(d%36e5/6e4),sec=Math.floor(d%6e4/1e3);
    el.textContent=days+'d '+hrs+'h '+min+'m '+sec+'s';}
  tick();setInterval(tick,1000);
});
/* typing effect: <span data-type="Text to type"> */
document.querySelectorAll('[data-type]').forEach(function(el){
  var txt=el.getAttribute('data-type'),i=0;
  function type(){if(i<=txt.length){el.textContent=txt.slice(0,i++);setTimeout(type,R?1:42);}}
  type();
});
/* gallery lightbox: Esc closes */
document.addEventListener('keydown',function(e){if(e.key==='Escape'){var lb=document.querySelector('.nx-lightbox');if(lb)lb.style.display='none';}});
/* active nav link highlight */
var secs=document.querySelectorAll('section[id]');
if(secs.length){addEventListener('scroll',function(){
  var y=scrollY+120,cur='';
  secs.forEach(function(s){if(s.offsetTop<=y)cur=s.id;});
  document.querySelectorAll('.nx-nav-links a').forEach(function(a){var h=a.getAttribute('href');a.style.color=(h==='#'+cur)?'var(--accent)':'';});
},{passive:true});}
/* testimonial auto-scroll (gentle, pauses on hover) */
var ts=document.querySelector('.nx-tstrip');
if(ts&&!R){var tmr=setInterval(function(){if(ts.matches(':hover'))return;if(ts.scrollLeft+ts.clientWidth>=ts.scrollWidth-10){ts.scrollTo({left:0,behavior:'smooth'});}else{ts.scrollBy({left:320,behavior:'smooth'});}},4200);}
/* contact form → workspace inbox + lead workflow */
var f=document.querySelector('.nx-form');
if(f){var ok=f.querySelector('.ok');f.addEventListener('submit',function(e){e.preventDefault();
  var btn=f.querySelector('button[type=submit]');if(btn)btn.disabled=true;
  var data={};f.querySelectorAll('input,textarea').forEach(function(i){if(i.name)data[i.name]=i.value;});
  data.event='site_lead';
  fetch('__WEBHOOK_URL__',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
  .then(function(r){return r.json();}).then(function(j){
    if(j.ok){f.style.display='none';if(ok)ok.style.display='block';}
    else{alert(j.error||'Could not send — try again.');if(btn)btn.disabled=false;}
  }).catch(function(){alert('Could not reach the server.');if(btn)btn.disabled=false;});
});}
})();`;

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
    const r = await callProvider(env, w, [{
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
      const metas = await env.DB.prepare('SELECT site_id, design_id FROM site_meta').all().catch(() => ({ results: [] }));
      const metaMap = {};
      metas.results.forEach(m => { metaMap[m.site_id] = m.design_id; });
      return json({ sites: results.map(x => ({ ...x, design_id: metaMap[x.id] || 'sentinel' })) }, 200, origin);
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
      const designId = isValidDesignId(body.design_id) ? body.design_id : 'sentinel';
      if (body.build_with_ai) {
        // Modern path: design system + optional scanned plan + instructions
        const w = await getWorkspace(env, ws);
        html = await generateSiteHtml(env, ws, {
          name: body.name,
          description: body.description || '',
          design_id: designId,
          plan: body.plan || null,
          instructions: body.instructions || '',
          webhook_url: String(body.webhook_url || ''),
          accent: body.accent, accent2: body.accent2, font: body.font, radius: body.radius,
          animation_level: body.animation_level, sections: body.sections,
          custom_css: body.custom_css, favicon: body.favicon,
          theme_id: body.theme_id, hero_style: body.hero_style, anim_preset: body.anim_preset,
          card_style: body.card_style, nav_style: body.nav_style, three_d: body.three_d,
          scene_id: body.scene_id, spline_url: body.spline_url,
        });
      } else {
        html = String(body.html || '');
      }
      const site = await env.DB.prepare(
        `INSERT INTO sites (workspace_id,name,slug,html,published) VALUES (?,?,?,?,?) RETURNING *`
      ).bind(ws, body.name.slice(0, 120), slug, html, body.published ? 1 : 0).first();
      // store design + instructions + content plan + theme in site_meta
      const themeJson = JSON.stringify({
        accent: body.accent || '', accent2: body.accent2 || '', font: body.font || '',
        radius: body.radius || '', animation_level: body.animation_level || '',
        sections: Array.isArray(body.sections) ? body.sections : null,
        favicon: body.favicon || '',
        theme_id: body.theme_id || '', hero_style: body.hero_style || '', anim_preset: body.anim_preset || '',
        card_style: body.card_style || '', nav_style: body.nav_style || '', three_d: body.three_d || '',
        scene_id: body.scene_id || '', spline_url: body.spline_url || '', concept_id: body.concept_id || '',
      });
      await env.DB.prepare(
        `INSERT INTO site_meta (site_id, design_id, instructions, content_plan, theme, custom_css) VALUES (?,?,?,?,?,?)
         ON CONFLICT(site_id) DO UPDATE SET design_id=?, instructions=?, content_plan=?, theme=?, custom_css=?`
      ).bind(site.id, designId, String(body.instructions || '').slice(0, 2000), JSON.stringify(body.plan || {}), themeJson, String(body.custom_css || '').slice(0, 8000),
        designId, String(body.instructions || '').slice(0, 2000), JSON.stringify(body.plan || {}), themeJson, String(body.custom_css || '').slice(0, 8000)).run();
      // fix the webhook URL inside the html (needs the request origin)
      const origin = (body.webhook_url) ? String(body.webhook_url) : '';
      if (origin) {
        const fixed = html.replace('__WEBHOOK_URL__', origin);
        if (fixed !== html) {
          await env.DB.prepare('UPDATE sites SET html=? WHERE id=? AND workspace_id=?').bind(fixed, site.id, ws).run();
          html = fixed;
        }
      }
      return json({ ...site, html }, 200, origin);
    }
  }
  const id = parseInt(parts[1]);
  if (req.method === 'GET' && parts[2] === 'html') {
    const site = await env.DB.prepare('SELECT * FROM sites WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!site) return err('Site not found', 404, origin);
    const meta = await env.DB.prepare('SELECT design_id, instructions, content_plan, theme, custom_css FROM site_meta WHERE site_id=?').bind(id).first().catch(() => null);
    let plan = null; try { plan = meta && meta.content_plan ? JSON.parse(meta.content_plan) : null; } catch { }
    let theme = {}; try { theme = meta && meta.theme ? JSON.parse(meta.theme) : {}; } catch { }
    return json({ html: site.html, design_id: meta?.design_id || 'sentinel', instructions: meta?.instructions || '', plan, theme, custom_css: meta?.custom_css || '' }, 200, origin);
  }
  if (req.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM sites WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!existing) return err('Site not found', 404, origin);
    const u = { ...existing, ...pick(body, ['name', 'published', 'html']) };
    if (body.build_with_ai) {
      const meta = await env.DB.prepare('SELECT design_id, instructions, content_plan, theme, custom_css FROM site_meta WHERE site_id=?').bind(id).first().catch(() => null);
      let theme = {}; try { theme = meta && meta.theme ? JSON.parse(meta.theme) : {}; } catch { }
      const newTheme = { ...theme };
      ['accent', 'accent2', 'font', 'radius', 'animation_level', 'favicon', 'theme_id', 'hero_style', 'anim_preset', 'card_style', 'nav_style', 'three_d', 'scene_id', 'spline_url', 'concept_id'].forEach(k => { if (body[k] !== undefined) newTheme[k] = body[k]; });
      if (body.sections !== undefined) newTheme.sections = Array.isArray(body.sections) ? body.sections : null;
      const customCss = body.custom_css !== undefined ? String(body.custom_css).slice(0, 8000) : (meta ? meta.custom_css || '' : '');
      u.html = await generateSiteHtml(env, ws, {
        name: u.name,
        description: body.description || '',
        design_id: (meta && isValidDesignId(meta.design_id)) ? meta.design_id : (isValidDesignId(body.design_id) ? body.design_id : 'sentinel'),
        plan: (() => { try { return meta && meta.content_plan ? JSON.parse(meta.content_plan) : null; } catch { return null; } })(),
        instructions: (body.instructions !== undefined ? body.instructions : (meta ? meta.instructions : '')) || '',
        accent: newTheme.accent, accent2: newTheme.accent2, font: newTheme.font, radius: newTheme.radius,
        animation_level: newTheme.animation_level, sections: newTheme.sections,
        custom_css: customCss, favicon: newTheme.favicon,
        theme_id: newTheme.theme_id, hero_style: newTheme.hero_style, anim_preset: newTheme.anim_preset,
        card_style: newTheme.card_style, nav_style: newTheme.nav_style, three_d: newTheme.three_d,
        scene_id: newTheme.scene_id, spline_url: newTheme.spline_url,
      });
      if (body.instructions !== undefined || body.design_id || body.accent !== undefined || body.font !== undefined || body.sections !== undefined || body.custom_css !== undefined) {
        const designId2 = isValidDesignId(body.design_id) ? body.design_id : (meta && isValidDesignId(meta.design_id) ? meta.design_id : 'sentinel');
        await env.DB.prepare('UPDATE site_meta SET design_id=?, instructions=?, theme=?, custom_css=? WHERE site_id=?')
          .bind(designId2,
            String(body.instructions !== undefined ? body.instructions : (meta ? meta.instructions : '')).slice(0, 2000),
            JSON.stringify(newTheme), customCss, id).run();
      }
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

// ════════════════════════════════════════════════════════════
// WEBSITE SCANNER — reads an existing website and extracts everything
// needed to rebuild it: title, headings, text, images, phone, email,
// working hours, address, services, socials, nav links.
// ════════════════════════════════════════════════════════════
const SCAN_CACHE = new Map();
const SCAN_TTL_MS = 10 * 60 * 1000;
function decodeEntities(str) {
  return String(str || '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, '\u2019').replace(/&ldquo;/g, '\u201c').replace(/&rdquo;/g, '\u201d').replace(/&ndash;/g, '\u2013').replace(/&mdash;/g, '\u2014')
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCharCode(parseInt(n)); } catch { return m; } });
}
function stripTags(html) {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
function absolutize(url, base) {
  try { return new URL(url, base).href; } catch { return null; }
}
function extractWorkingHours(text) {
  const out = [];
  const t = String(text || '');
  if (/24\/7|24 hours|open 24|always open/i.test(t)) out.push('Open 24/7');
  // "Monday to Friday 8am - 6pm" / "Mon-Fri 8:00 to 17:00" ranges
  const rangeRe = /((?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:day)?(?:s)?)\s*(?:[-–—]|to)\s*((?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:day)?(?:s)?)\s*[:.]?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–—to]+\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/gi;
  const cap = (s) => s ? s.replace(/\s+/g, '') : s;
  let m;
  while ((m = rangeRe.exec(t)) && out.length < 8) {
    out.push(`${cap(m[1])}-${cap(m[2])} ${m[3]} - ${m[4]}`);
  }
  // single-day "Friday 8am to 6pm"
  const dayRe = /((?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:day)?(?:s)?)\s*[-–—:]?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–—to]+\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/gi;
  while ((m = dayRe.exec(t)) && out.length < 8) {
    out.push(`${cap(m[1])} ${m[2]} - ${m[3]}`);
  }
  const range = t.match(/(?:open|hours?)[^.\n]{0,60}/i);
  if (!out.length && range) out.push(range[0].replace(/\s+/g, ' ').trim().slice(0, 80));
  return [...new Set(out)].slice(0, 8);
}
function extractPhones(text) {
  const out = [];
  const re = /(?:(?:\+?\d{1,3}[\s\-]?)?(?:\(\d{2,4}\)[\s\-]?)?\d{3,4}[\s\-]?\d{3,4}(?:[\s\-]?\d{2,4})?)/g;
  let m;
  while ((m = re.exec(text)) && out.length < 6) {
    const p = m[0].trim();
    if (p.length >= 7 && p.length <= 18 && !/^\d{3}$/.test(p)) out.push(p);
  }
  return [...new Set(out)];
}
function extractEmails(text) {
  const out = [];
  const re = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  let m;
  while ((m = re.exec(text)) && out.length < 6) out.push(m[0].toLowerCase());
  return [...new Set(out)];
}
// SSRF guard: never fetch private/loopback/link-local targets.
function isBlockedHost(u) {
  try {
    const host = new URL(u).hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (/^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\.|^0\./.test(host)) return true;
    if (host === '[::1]' || host === '::1') return true;
    const ipv6 = host.replace(/^\[/, '').replace(/\]$/, '');
    if (/^fe80:/i.test(ipv6) || /^fc/i.test(ipv6) || /^fd/i.test(ipv6)) return true;
  } catch { return true; }
  return false;
}
async function scanWebsite(env, ws, url) {
  const cleanUrl = String(url || '').trim();
  if (!/^https?:\/\//i.test(cleanUrl) || cleanUrl.length > 500) throw new UserError('Enter a valid http(s) URL');
  if (isBlockedHost(cleanUrl)) throw new UserError('That URL points to a private/internal address — only public websites can be scanned.');
  const cached = SCAN_CACHE.get(cleanUrl);
  if (cached && (Date.now() - cached.ts) < SCAN_TTL_MS) return cached.data;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try { res = await fetch(cleanUrl, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' } }); }
  catch (e) { clearTimeout(t); throw new Error('Could not fetch that website: ' + e.message); }
  clearTimeout(t);
  if (!res.ok) throw new Error(`The website returned HTTP ${res.status} — check the URL.`);
  const html = await res.text().catch(() => '');
  if (!html || html.length < 80) throw new Error('The website returned no readable content.');
  if (html.length > 3_000_000) throw new Error('That website is too large to scan (over 3 MB of HTML).');
  const text = stripTags(html);
  if (text.replace(/\s+/g, '').length < 30) throw new Error('The website returned no readable text content.');
  // structured extraction
  const title = decodeEntities((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || '');
  const metaDesc = decodeEntities((html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1]?.trim() || '');
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].slice(0, 3).map(m => stripTags(m[1]).slice(0, 150)).filter(Boolean);
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].slice(0, 12).map(m => stripTags(m[1]).slice(0, 150)).filter(Boolean);
  const h3s = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].slice(0, 12).map(m => stripTags(m[1]).slice(0, 150)).filter(Boolean);
  // paragraphs (dedupe, cap)
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => stripTags(m[1]).replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 40 && p.length <= 600)
    .slice(0, 20);
  const uniqueParas = [...new Set(paras)];
  // images (dedupe by URL, prefer larger-ish)
  const imgs = [];
  const seenImgs = new Set();
  for (const m of html.matchAll(/<img[^>]*>/gi)) {
    const tag = m[0];
    const src = (tag.match(/src=["']([^"']+)["']/i) || [])[1];
    const alt = (tag.match(/alt=["']([^"']*)["']/i) || [])[1] || '';
    const abs = absolutize(src, cleanUrl);
    if (!abs || !/^https?:\/\//i.test(abs) || seenImgs.has(abs)) continue;
    if (/\.(svg|ico|png|jpg|jpeg|webp|gif|avif)(\?|$)/i.test(abs) || abs.includes('image')) {
      seenImgs.add(abs);
      imgs.push({ url: abs, alt: alt.slice(0, 120) });
      if (imgs.length >= 12) break;
    }
  }
  // links
  const links = [];
  const seenLinks = new Set();
  for (const m of html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    const abs = absolutize(href, cleanUrl);
    const label = stripTags(m[2]).replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!abs || !/^https?:\/\//i.test(abs)) continue;
    const host = new URL(abs).hostname.replace(/^www\./, '');
    if (host && host !== new URL(cleanUrl).hostname.replace(/^www\./, '') && !seenLinks.has(abs)) {
      seenLinks.add(abs);
      links.push({ url: abs, label });
      if (links.length >= 10) break;
    }
  }
  const socials = links.filter(l => /facebook|instagram|twitter|x\.com|linkedin|tiktok|youtube|wa\.me|whatsapp/i.test(l.url)).slice(0, 6);
  const phones = extractPhones(text);
  const emails = extractEmails(text);
  const hours = extractWorkingHours(text);
  const address = (text.match(/(?:address|located at|find us|visit us)[:.\s]+([^.\n]{10,90})/i) || [])[1]?.trim() || '';
  const navLabels = [...html.matchAll(/<nav[\s\S]*?<\/nav>/gi)].slice(0, 1).map(n => stripTags(n[0])).join(' | ').slice(0, 200);
  const extracted = {
    url: cleanUrl, title, meta_desc: metaDesc,
    headings: { h1: h1s, h2: h2s, h3: h3s },
    paragraphs: uniqueParas.slice(0, 12),
    images: imgs, links, socials,
    phone: phones[0] || '', phones, email: emails[0] || '', emails,
    working_hours: hours, address, nav: navLabels,
  };
  // AI content plan — what the new site should contain, in the right order
  let plan = null;
  const w = await getWorkspace(env, ws);
  if (providerPriority(w).length && (await withinDailyCap(env, ws, w.ai_daily_call_cap))) {
    try {
      const r = await callProvider(env, w, [{
        role: 'user',
        content: `You are rebuilding a client's old, ugly website into a modern, high-converting one. From the extracted data below, produce a CONTENT PLAN as JSON only:
{"site_name":"...","tagline":"one punchy line","hero_headline":"...","hero_sub":"one sentence","cta_primary":"...","cta_secondary":"...","marquee_items":["3-5 short value phrases"],"stats":[{"value":number,"label":"..."} up to 4],"services":[{"icon":"emoji","title":"...","desc":"one sentence"} up to 6],"why_us":["3-5 bullet points"],"about":"2-3 sentences","process":[{"title":"...","desc":"..."} 4 steps],"gallery_imgs":["2-6 image urls from the images list"],"reviews":[{"name":"...","text":"...","stars":5} 0-3],"lead_title":"...","lead_text":"...","faqs":[{"q":"...","a":"..."} 3-5],"working_hours":["..."],"contact":{"phone":"...","email":"...","address":"..."},"footer_note":"..."}
Rules: use the EXTRACTED content (real working hours, real phone/email, real services, real text) — modernize the wording but never invent services or contact details not in the data. Use images only from the images list. If something is missing, use "" or []. EXTRACTED DATA: ${JSON.stringify(extracted).slice(0, 9000)}`,
      }], { max_tokens: 2200 });
      await trackAIUsage(env, ws, 'scan-plan', r.provider, r.usage);
      try { plan = JSON.parse(r.content.match(/\{[\s\S]*\}/)?.[0] || 'null'); } catch { plan = null; }
    } catch { plan = null; }
  }
  const data = { extracted, plan, scanned_at: new Date().toISOString() };
  SCAN_CACHE.set(cleanUrl, { data, ts: Date.now() });
  return data;
}

// ── AI WEBSITE ANALYZER (audit any public URL) ───────────────
async function aiAnalyzeSite(env, ws, body) {
  const url = String(body.url || '').trim();
  if (!/^https?:\/\//i.test(url) || url.length > 500) throw new UserError('Enter a valid http(s) URL');
  // SSRF guard (same as scanWebsite): never let this endpoint be aimed at
  // loopback/private/link-local/metadata addresses from inside the account.
  if (isBlockedHost(url)) throw new UserError('That URL points to a private/internal address — only public websites can be analyzed.');
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
  const r = await callProvider(env, w, [{
    role: 'user',
    content: `Act as an expert website auditor. Analyze this page text (title/URL: ${url}):\n"${text || '(no readable text extracted)'}"\nGive: 1) Overall verdict (score /10), 2) What the page does well, 3) Specific problems: SEO (title/meta/h1/headings), clarity of message, call-to-action strength, trust signals, structure, 4) Top 5 concrete fixes ranked by impact, 5) Suggested headline that would convert better. Be specific and blunt.`,
  }], { max_tokens: 1000 });
  await trackAIUsage(env, ws, 'analyze-site', r.provider, r.usage);
  return { url, content: r.content };
}

// ── WEBCHAT WIDGET (public AI chat, lands in your inbox) ─────
function webchatEmbedScript(token, baseUrl) {
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
  // Persistent per-visitor id (stored in their browser) → the AI remembers
  // returning visitors across sessions.
  var vid=null;
  try{vid=localStorage.getItem("nxw_vid");}catch(e){}
  if(!vid){vid="v"+Date.now().toString(36)+Math.random().toString(36).slice(2,10);try{localStorage.setItem("nxw_vid",vid);}catch(e){}}

  function sendMsg(){
    if(busy)return;
    var t=inp.value.trim();if(!t)return;inp.value="";
    bubble("user",t);history.push({role:"user",content:t});
    var typing=bubble("assistant","…");busy=true;
    fetch(base+"/api/public/webchat/"+token+"/message",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:t,history:history.slice(-8),visitor_id:vid})})
    .then(function(r){if(!r.ok){busy=false;typing.textContent="⚠️ "+(r.status===429?"Too many messages — try again shortly.":"Service unavailable.");return;}
      var reader=r.body.getReader(),dec=new TextDecoder(),full="";
      function finish(){typing.textContent=full||"(no reply)";history.push({role:"assistant",content:full});busy=false;}
      function timedRead(){return Promise.race([reader.read(),new Promise(function(res2){setTimeout(function(){res2({__nxTimeout:true});},45000);})]);}
      function pump(){return timedRead().then(function(x){
        if(x.__nxTimeout){finish();return;}
        if(x.done){finish();return;}
        var chunk=dec.decode(x.value,{stream:true}).split("\\n");
        var finished=false;
        for(var i=0;i<chunk.length;i++){var line=chunk[i].trim();if(line.indexOf("data: ")!==0)continue;try{var d=JSON.parse(line.slice(6));if(d.delta)full+=d.delta;if(d.done){finished=true;break;}}catch(e){}}
        typing.textContent=full||"…";
        if(finished){finish();return;}
        return pump();});}
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

async function handleWebchatSettings(env, req, auth, origin) {
  const ws = auth.workspaceId;
  const w = await getWorkspace(env, ws);
  if (req.method === 'GET') {
    const { results } = await env.DB.prepare(
      "SELECT m.*, c.name as contact_name FROM messages m LEFT JOIN contacts c ON c.id=m.contact_id WHERE m.workspace_id=? AND m.channel='webchat' ORDER BY m.id DESC LIMIT 100"
    ).bind(ws).all();
    return json({ public_token: w.public_token || '', conversations: results.reverse() }, 200, origin);
  }
  if (req.method === 'POST') {
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
  const rl = await rateLimit(env, `wc:${w.id}:${ip}`, 240, 60);
  if (!rl.ok) return err('Too many messages — try again later.', 429, origin);
  const message = String(body.message || '').slice(0, 500);
  if (!message.trim()) return err('Message is required', 400, origin);
  // Per-visitor identity for conversation continuity (validated, safe).
  const visitorId = String(body.visitor_id || '').slice(0, 64);
  const visitorOk = /^[a-zA-Z0-9-]{6,64}$/.test(visitorId);
  const visitorSubject = visitorOk ? `__v_${visitorId}` : '';
  await env.DB.prepare("INSERT INTO messages (workspace_id,channel,subject,body,direction) VALUES (?,?,?,?,'inbound')")
    .bind(w.id, 'webchat', visitorSubject, message).run();

  // Daily AI cap: never let the widget burn past the workspace's limit.
  const cap = await withinDailyCap(env, w.id, w.ai_daily_call_cap);
  if (!cap) return sseText('Thanks for your message! We have reached our daily chat limit, but we will reply to you as soon as possible.', origin);

  // Build the AI reply (uses the workspace's own AI settings + CRM context)
  let history = Array.isArray(body.history)
    ? body.history.slice(-8).map(m => ({ role: m.role, content: String(m.content || '').slice(0, 1000) }))
    : [];
  // Per-visitor memory: a returning visitor (same visitor_id cookie) gets
  // their previous messages merged in so the conversation feels continuous.
  if (visitorOk) {
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
  }
  let ctx;
  try { ctx = await workspaceContextSummary(env, w.id); } catch { ctx = ''; }
  const sysParts = [];
  if (w.ai_system_prompt) sysParts.push(w.ai_system_prompt);
  if (w.ai_brand_voice) sysParts.push('Brand voice (match it in replies): ' + w.ai_brand_voice);
  if (ctx) sysParts.push('LIVE BUSINESS DATA (use it if relevant): ' + ctx);
  sysParts.push('You are a friendly website chat assistant. Be concise (under 120 words), helpful, and honest when you do not know something. Never invent prices or facts not given.');
  const messages = [
    { role: 'system', content: sysParts.join('\n') },
    ...history.filter(m => m.role === 'user' || m.role === 'assistant'),
  ];

  let streamRes;
  try {
    streamRes = await openProviderStream(env, w, messages, { max_tokens: 600 });
  } catch (e) {
    // fallback: static polite reply without AI
    return sseText("Thanks for your message! We'll get back to you as soon as possible.", origin);
  }
  await trackAIUsage(env, w.id, 'webchat', streamRes.provider, {});
  const reader = streamRes.res.body.getReader();
  const decoder = new TextDecoder(); const encoder = new TextEncoder();
  let buf = '';
  // The AI reply must land in the CRM inbox too (the promise: "conversations
  // land in your inbox"), and it powers per-visitor memory on return visits
  // (history merge treats bodies starting with "AI: " as assistant turns).
  let fullText = '';
  const saveReply = () => {
    if (!fullText.trim()) return;
    env.DB.prepare("INSERT INTO messages (workspace_id,channel,subject,body,direction,ai_generated) VALUES (?, 'webchat', ?, ?, 'outbound', 1)")
      .bind(w.id, visitorSubject, ('AI: ' + fullText.trim()).slice(0, 4000))
      .run().catch(() => {});
  };
  const stream = new ReadableStream({
    async pull(controller) {
      let value, done;
      try { ({ value, done } = await reader.read()); }
      catch { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)); controller.close(); return; }
      if (done) { saveReply(); controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)); controller.close(); return; }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          // Close on [DONE] — see the same fix in the chat pump: waiting for
          // EOF stalls the stream and leaks the connection.
          saveReply();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close(); return;
        }
        try {
          const j = JSON.parse(payload);
          const delta = j.choices?.[0]?.delta?.content;
          if (delta) { fullText += delta; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`)); }
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
    await sendEmailViaResend(env, w, { to: userRow.email, subject: `📅 ${due.length} appointment${due.length === 1 ? '' : 's'} tomorrow in NexusCRM`, body });
    await env.DB.prepare('UPDATE appointments SET reminder_sent=1 WHERE id IN (' + due.map(() => '?').join(',') + ')')
      .bind(...due.map(a => a.id)).run();
  } catch (e) { console.error('appointment reminder failed', e); }
}

// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// AI ON DATA — summaries, replies, tags, scores, risks (Super-cycle 2)
// ════════════════════════════════════════════════════════════
// Daily AI brief — a compact "what to focus on today" (dashboard card).
async function aiDailyBrief(env, ws) {
  const w = await getWorkspace(env, ws);
  const stats = await computeStats(env, ws);
  const [dueToday, overdueN, hot, apptsToday] = await Promise.all([
    env.DB.prepare(`SELECT title FROM tasks WHERE workspace_id=? AND status='todo' AND due_date = date('now') LIMIT 5`).bind(ws).all(),
    env.DB.prepare(`SELECT COUNT(*) n FROM tasks WHERE workspace_id=? AND status='todo' AND due_date != '' AND due_date < date('now')`).bind(ws).first(),
    env.DB.prepare('SELECT name, ai_score FROM contacts WHERE workspace_id=? AND ai_score > 0 ORDER BY ai_score DESC LIMIT 3').bind(ws).all(),
    env.DB.prepare(`SELECT title, time FROM appointments WHERE workspace_id=? AND status='scheduled' AND date = date('now') ORDER BY time`).bind(ws).all(),
  ]);
  const base = {
    due_today: dueToday.results.map(t => t.title),
    overdue: overdueN.n,
    hot_leads: hot.results.map(c => c.name),
    appointments_today: apptsToday.results.map(a => `${a.title} @ ${a.time}`),
    pipeline: stats.pipeline_value,
    open_deals: stats.open_deals,
    pending_tasks: stats.pending_tasks,
  };
  let content = '';
  if (providerPriority(w).length) {
    try {
      const r = await callProvider(env, w, [{ role: 'user', content: `Write a punchy "Today's Brief" (max 80 words, bullet points) for a small-business owner from this data. Lead with the single most important thing. ${JSON.stringify(base)}` }], { max_tokens: 250 });
      content = r.content;
      await trackAIUsage(env, ws, 'brief', r.provider, r.usage);
    } catch { }
  }
  if (!content) {
    content = `• ${base.due_today.length ? 'Tasks due today: ' + base.due_today.join(', ') : 'No tasks due today'}
• ${base.appointments_today.length ? 'Appointments: ' + base.appointments_today.join(' · ') : 'No appointments today'}
• ${base.pending_tasks} open tasks · ${base.open_deals} deals worth ${'$' + Number(base.pipeline).toLocaleString()}${base.overdue ? ' · ⚠ ' + base.overdue + ' overdue' : ''}`;
  }
  return { brief: content, data: base };
}
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
  const r = await callProvider(env, w, [{
    role: 'user',
    content: `Write a compact "relationship summary" for this contact (max 120 words): who they are, where they stand, what's next. Use only this data: ${JSON.stringify(data)}`,
  }], { max_tokens: 300 });
  await trackAIUsage(env, ws, 'contact-summary', r.provider, r.usage);
  return { summary: r.content };
}
async function aiSmartReply(env, ws, text) {
  const w = await getWorkspace(env, ws);
  const r = await callProvider(env, w, [{
    role: 'user',
    content: `Here is an incoming message: "${String(text || '').slice(0, 2000)}". Write exactly 3 short reply options (max 40 words each), numbered 1-3: 1) professional, 2) friendly/short, 3) if the message is positive make it enthusiastic / if negative make it empathetic & solution-oriented. Plain text, no preamble.`,
  }], { max_tokens: 300 });
  await trackAIUsage(env, ws, 'smart-reply', r.provider, r.usage);
  const options = r.content.split(/^\s*\d[.)]\s*/m).map(x => x.trim()).filter(Boolean).slice(0, 3);
  return { options: options.length >= 2 ? options : [r.content.trim()] };
}
async function aiSuggestTags(env, ws, contactId) {
  const c = await env.DB.prepare('SELECT * FROM contacts WHERE id=? AND workspace_id=?').bind(contactId, ws).first();
  if (!c) throw new Error('Contact not found');
  const w = await getWorkspace(env, ws);
  const r = await callProvider(env, w, [{
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
  const r = await callProvider(env, w, [{
    role: 'user',
    content: `Rank these tasks by urgency/importance (1 = do first). Reply ONLY as JSON array of {id:number,score:0-100,reason:"under 10 words"}: ${JSON.stringify(tasks.map(t => ({ id: t.id, title: t.title, priority: t.priority, due: t.due_date || 'none' })))}`,
  }], { max_tokens: 600 });
  await trackAIUsage(env, ws, 'task-score', r.provider, r.usage);
  let ranked = [];
  try { ranked = JSON.parse(r.content.match(/\[[\s\S]*\]/)?.[0] || '[]'); } catch { }
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

// AI AGENT — the chat can DO things in your CRM, not just talk.
// The model replies with a single JSON action from a SAFE whitelist;
// the worker executes it server-side, then answers with a confirmation.
// ════════════════════════════════════════════════════════════
const AGENT_ACTIONS = ['create_task', 'create_contact', 'create_deal', 'create_appointment', 'update_deal_stage', 'update_contact', 'add_contact_note', 'complete_task', 'update_deal', 'find_contact', 'remember', 'send_email', 'forecast', 'weekly_review', 'none'];
const AGENT_SYSTEM = `You are the AI assistant inside NexusCRM, a small-business CRM. The user may ask you to DO something in their CRM. You may perform EXACTLY ONE action. Reply ONLY with a JSON object (no markdown, no other text): {"action":"...","params":{...},"reply":"one short, friendly sentence confirming what you did or answering the question"}.
The user may also ask for a SEQUENCE of things — if so, reply with {"steps":[{"action":"...","params":{...}},...],"reply":"..."} (up to 3 steps, actions from the same list). Prefer a sequence over calling the agent again.
Allowed actions:
- "create_task": params {title (required), description?, due_date? (natural date like "tomorrow" or "next friday" or YYYY-MM-DD), priority? (low|medium|high|urgent)}
- "complete_task": params {task_id OR task_title} — marks it done
- "update_deal": params {deal_id OR deal_title, value? (number), probability? (0-100), title?}
- "find_contact": params {name or email} — returns the contact's details
- "remember": params {fact (required)} — stores a fact about the user/business for future conversations
- "update_contact": params {contact_email OR contact_name (to find them), plus any of: email, phone, company, tags, notes, stage}
- "add_contact_note": params {contact_email OR contact_name, note (required)} — appends to the contact's notes
- "create_contact": params {name (required), email?, phone?, company?, tags? (comma separated)}
- "create_deal": params {title (required), value? (number), stage? (lead|prospect|qualified|proposal|negotiation|won|lost)}
- "create_appointment": params {title (required), date (YYYY-MM-DD), time? (HH:MM)}
- "update_deal_stage": params {deal_id? (number) OR deal_title? (string), stage (required)}
- "send_email": params {contact_email (required), subject, body}
- "update_contact": params {contact_email OR contact_name (to find them), plus any of: email, phone, company, tags, notes, stage}
- "add_contact_note": params {contact_email OR contact_name, note (required)} — appends to the contact's notes
- "forecast": params {} — returns the 30/60/90 day sales forecast
- "weekly_review": params {} — returns a structured weekly business review
- "none": params {} — for questions or when no action is needed; put your answer in "reply"
Rules: never invent data the user did not imply; never delete anything; keep "reply" under 40 words; if the request is ambiguous, ask a clarifying question via "none".`;

async function executeAgentAction(env, ctx, ws, action, params, origin) {
  const p = params || {};
  const str = (v, n) => String(v == null ? '' : v).slice(0, n || 300);
  if (action === 'create_task') {
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
    const apptDate = parseNaturalDate(p.date);
    if (!str(p.title).trim() || !apptDate) return { ok: false, error: 'Appointment needs a title and a date (e.g. tomorrow, next friday, or YYYY-MM-DD).' };
    const a = await env.DB.prepare(
      `INSERT INTO appointments (workspace_id,title,date,time,status) VALUES (?,?,?,?,'scheduled') RETURNING *`
    ).bind(ws, str(p.title, 200), apptDate, /^\d{2}:\d{2}$/.test(p.time || '') ? p.time : '09:00').first();
    await logEvent(env, ctx, ws, 'appointment_booked', null, { title: a.title, date: a.date, time: a.time });
    return { ok: true, note: `Appointment "${a.title}" booked for ${apptDate} at ${a.time}` };
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
  if (action === 'update_contact' || action === 'add_contact_note') {
    let contact = null;
    if (p.contact_email) contact = await env.DB.prepare('SELECT * FROM contacts WHERE workspace_id=? AND LOWER(email)=LOWER(?)').bind(ws, str(p.contact_email, 254).toLowerCase()).first();
    if (!contact && p.contact_name) contact = await env.DB.prepare('SELECT * FROM contacts WHERE workspace_id=? AND LOWER(name)=LOWER(?)').bind(ws, str(p.contact_name, 200)).first();
    if (!contact) return { ok: false, error: 'Contact not found — check the email or name.' };
    if (action === 'add_contact_note') {
      const note = str(p.note, 1000);
      if (!note) return { ok: false, error: 'Note text is required.' };
      const merged = [contact.notes, note].filter(Boolean).join('\n').slice(0, 4000);
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
        await sendEmailViaResend(env, w, { to: email, subject, body });
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
      const r = await callProvider(env, w, [{ role: 'user', content: `Write a structured weekly business review (under 220 words) from: ${JSON.stringify({ ...stats, ai_usage: usage })}. Sections: Wins, Gaps, Top 3 focus items for next week, one bold growth idea. Be specific.` }], { max_tokens: 600 });
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
      const r = await callProvider(env, w, [{
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
  // Idempotency: the same command twice within 60s = a double-click, not a redo.
  const dedupeKey = `agent:${ws}:${await sha256hex(message)}`;
  const dup = await env.DB.prepare('SELECT count FROM rate_limits WHERE key=?').bind(dedupeKey).first();
  if (dup) return json({ reply: 'Already done that just now — check the result above. ✅', action: 'none', ok: true, duplicate: true }, 200, origin);
  await env.DB.prepare('INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=count+1')
    .bind(dedupeKey, nowISO()).run();
  const ctxSummary = await workspaceContextSummary(env, ws).catch(() => '');
  const voice2 = String(w.ai_brand_voice || '').trim();
  let factsLine = '';
  try { const f = JSON.parse(w.agent_facts || '[]'); if (f.length) factsLine = '\n\nFACTS THE USER TOLD YOU (remember them): ' + f.join(' | '); } catch { }
  const r = await callProvider(env, w, [
    { role: 'system', content: AGENT_SYSTEM + (ctxSummary ? '\n\nLIVE CRM DATA: ' + ctxSummary : '') + (voice2 ? '\n\nBrand voice for written outputs: ' + voice2 : '') + factsLine },
    { role: 'user', content: message },
  ], { max_tokens: 900 });
  await trackAIUsage(env, ws, 'agent', r.provider, r.usage);
  let parsed = null;
  try { parsed = JSON.parse((r.content || '').match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch { }
  // Multi-step sequences: {"steps":[{action,params},...]} runs up to 3 safe actions in order.
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
  return json({ reply: finalReply, action, ok: result.ok, result }, 200, origin);
}

// ── MAIN ROUTER ───────────────────────────────────────────────
async function router(req, env, ctx) {
  const origin = req.headers.get('Origin') || '*';
  const ip = clientIp(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) });

  const url = new URL(req.url);
  let path = url.pathname;
  if (path.startsWith('/api')) path = path.slice(4);
  const parts = path.split('/').filter(Boolean);
  const root = parts[0];
  const query = url.searchParams;

  // ── PUBLIC ENDPOINTS (no auth — CORS for any origin) ──
  if (root === 'public') {
    // GET /public/forms/:slug — form definition (public, no auth)
    if (parts[1] === 'forms' && parts.length === 3 && req.method === 'GET') return publicFormGet(env, parts[2], origin);
    // GET /public/forms/:id/embed.js — embeddable widget script
    if (parts[1] === 'forms' && parts[3] === 'embed.js' && parts.length === 4 && req.method === 'GET') {
      const f = await env.DB.prepare('SELECT * FROM forms WHERE id=? AND active=1').bind(parseInt(parts[2])).first();
      if (!f) return err('Form not found', 404, origin);
      const script = formEmbedScript(f, new URL(req.url).origin);
      return new Response(script, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders(origin) } });
    }
    // POST /public/forms/:slug — submission (public, no auth)
    if (parts[1] === 'forms' && parts.length === 3 && req.method === 'POST') {
      let body = {}; try { body = await req.json(); } catch { }
      return publicFormSubmit(env, ctx, parts[2], body, origin, ip);
    }
    // GET /public/affiliate/go?token=..&url=..&ref=.. — click tracking
    if (parts[1] === 'affiliate' && parts[2] === 'go' && req.method === 'GET') return publicAffiliateGo(env, query, origin, ip);
    // GET /public/trigger/:slug — trigger link click → fires workflows
    if (parts[1] === 'trigger' && parts.length === 3 && req.method === 'GET') return publicTriggerClick(env, ctx, parts[2], query, origin, ip);
    // GET /public/site/:slug — published website
    if (parts[1] === 'site' && parts.length === 3 && req.method === 'GET') return publicSiteGet(env, parts[2], origin);
    // POST /public/webhook/:token — receive external events (Zapier-style).
    // body: {event (optional string), contact_id?, payload}. Fires workflows
    // with trigger "webhook" (or "webhook_<event>" for event-specific ones).
    if (parts[1] === 'webhook' && parts.length === 3 && req.method === 'POST') {
      let b = {}; try { b = await req.json(); } catch { }
      const w = await env.DB.prepare('SELECT * FROM workspaces WHERE public_token=?').bind(parts[2]).first();
      if (!w) return err('Webhook not found', 404, origin);
      const rl = await rateLimit(env, `wh:${w.id}:${ip}`, 300, 60);
      if (!rl.ok) return err('Rate limited', 429, origin);
      const event = String(b.event || 'webhook').slice(0, 60).replace(/[^a-z0-9_-]/gi, '') || 'webhook';
      const payload = b.payload && typeof b.payload === 'object' ? b.payload : { data: b.data || null };
      const ev = await env.DB.prepare(
        "INSERT INTO events (workspace_id,type,payload) VALUES (?,?,?) RETURNING id"
      ).bind(w.id, `webhook_${event}`, JSON.stringify({ webhook_event: event, ...payload }).slice(0, 4000)).first();
      // also log a plain 'webhook' event so generic webhook-triggered workflows fire
      await env.DB.prepare(
        "INSERT INTO events (workspace_id,type,payload) VALUES (?,?,?)"
      ).bind(w.id, 'webhook', JSON.stringify({ webhook_event: event, ...payload }).slice(0, 4000)).run();
      // Site lead forms: auto-create a contact so leads land in the CRM.
      if (event === 'site_lead' || b.event === 'site_lead') {
        const name = String(b.name || '').slice(0, 120);
        const email = String(b.email || '').toLowerCase().slice(0, 254);
        const phone = String(b.phone || '').slice(0, 40);
        if (name || email) {
          let contact = null;
          if (email && isValidEmail(email)) contact = await env.DB.prepare('SELECT id FROM contacts WHERE workspace_id=? AND LOWER(email)=LOWER(?)').bind(w.id, email).first();
          if (!contact) {
            const c = await env.DB.prepare('INSERT INTO contacts (workspace_id,name,email,phone,source,notes) VALUES (?,?,?,?,?,\'Website lead form\') RETURNING id')
              .bind(w.id, name || (email ? email.split('@')[0] : 'Website Lead'), email, phone, 'website').first();
            contact = c;
          }
          await env.DB.prepare("INSERT INTO messages (workspace_id,contact_id,channel,subject,body,direction) VALUES (?,?,?,'Website form message',?,'inbound')")
            .bind(w.id, contact.id, 'webchat', String(b.message || '').slice(0, 1000)).run();
          await logEvent(env, ctx, w.id, 'new_contact', contact.id, { name: contact.name, source: 'website' });
        }
      }
      ctx.waitUntil((async () => {
        await processEvent(env, ev.id).catch(() => {});
        const ev2 = await env.DB.prepare("SELECT id FROM events WHERE workspace_id=? AND type='webhook' ORDER BY id DESC LIMIT 1").bind(w.id).first();
        if (ev2) await processEvent(env, ev2.id).catch(() => {});
      })());
      return json({ ok: true, event }, 200, origin);
    }
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
  }

  // Body size guard — reject oversized payloads before parsing.
  const contentLen = parseInt(req.headers.get('Content-Length') || '0');
  if (contentLen > 1_500_000) return err('Request body too large', 413, origin);
  let body = {};
  if (['POST', 'PATCH'].includes(req.method)) {
    try { body = await req.json(); } catch { body = {}; }
  }

  if (path === '/health') return json({ ok: true, service: 'nexuscrm-backend', v: '4.1' }, 200, origin);
  if (path === '/auth/register' && req.method === 'POST') return authRegister(env, body, origin, ip);
  if (path === '/auth/login' && req.method === 'POST') return authLogin(env, body, origin, ip);
  if (path === '/auth/demo' && req.method === 'POST') return authDemo(env, origin, ip);

  const auth = await requireAuth(req, env);
  if (!auth) return err('Unauthorized — please sign in again.', 401, origin);

  if (path === '/auth/me') return authMe(auth, origin);
  if (path === '/auth/logout' && req.method === 'POST') return authLogout(env, auth, origin);
  if (root === 'contacts') return handleContacts(env, ctx, req, auth, parts, query, body, origin);
  if (root === 'deals') return handleDeals(env, ctx, req, auth, parts, body, origin);
  if (root === 'tasks') return handleTasks(env, req, auth, parts, body, origin);
  if (root === 'messages') return handleMessages(env, req, auth, body, origin);
  if (root === 'appointments') return handleAppointments(env, ctx, req, auth, parts, query, body, origin);
  if (root === 'reviews') return handleReviews(env, req, auth, parts, body, origin);
  if (root === 'workflows' && parts[2] === 'runs' && req.method === 'GET') {
    const wf = await env.DB.prepare('SELECT id FROM workflows WHERE id=? AND workspace_id=?').bind(parseInt(parts[1]), auth.workspaceId).first();
    if (!wf) return err('Workflow not found', 404, origin);
    const { results } = await env.DB.prepare(
      'SELECT id,event_type,status,detail,created_at FROM workflow_runs WHERE workflow_id=? ORDER BY id DESC LIMIT 30'
    ).bind(parseInt(parts[1])).all();
    return json({ runs: results }, 200, origin);
  }
  if (root === 'workflows') return handleWorkflows(env, req, auth, parts, body, origin);
  if (root === 'invoices') return handleInvoices(env, ctx, req, auth, parts, body, origin);
  if (root === 'social') return handleSocial(env, req, auth, parts, body, origin);
  if (root === 'sub-accounts') return handleSubAccounts(env, req, auth, parts, body, origin);
  if (root === 'forms') return handleForms(env, ctx, req, auth, parts, body, origin);
  if (root === 'courses') return handleCourses(env, req, auth, parts, body, origin);
  if (root === 'funnels') return handleFunnels(env, req, auth, parts, body, origin);
  if (root === 'affiliates') return handleAffiliates(env, req, auth, parts, body, origin);
  if (root === 'community') return handleCommunity(env, req, auth, parts, body, origin);
  if (root === 'trigger-links') return handleTriggerLinks(env, req, auth, parts, body, origin);
  if (root === 'sites') return handleSites(env, req, auth, parts, body, origin);
  if (path === '/webchat') return handleWebchatSettings(env, req, auth, origin);
  if (path === '/stats') return json(await computeStats(env, auth.workspaceId), 200, origin);

  if (path === '/email/smtp') return handleEmailSettings(env, req, auth, body, origin);
  if (path === '/email/send' && req.method === 'POST') {
    try { return await handleEmailSend(env, req, auth, body, origin); }
    catch (e) { return err(e.message, 400, origin); }
  }

  if (path === '/ai/settings') return handleAISettings(env, req, auth, body, origin);
  if (path === '/ai/models' && req.method === 'GET') {
    const w = await getWorkspace(env, auth.workspaceId);
    const refresh = query.get('refresh') === '1';
    const [nvidia, openai] = await Promise.all([
      fetchLiveModels('nvidia', w, refresh),
      fetchLiveModels('openai', w, refresh),
    ]);
    return json({
      nvidia: nvidia.data, openai: openai.data, custom: [],
      live: nvidia.live || openai.live,
      nvidia_live: nvidia.live, openai_live: openai.live,   // per-provider honesty for the UI
    }, 200, origin);
  }
  if (path === '/ai/usage') return json(await aiUsage(env, auth.workspaceId), 200, origin);
  if (path === '/ai/health') return json(await aiHealth(env, auth.workspaceId), 200, origin);
  if (path === '/ai/insights/dashboard') return json({ insights: await aiInsightsDashboard(env, auth.workspaceId) }, 200, origin);
  if (path === '/ai/chat/stream' && req.method === 'POST') return handleChatStream(env, req, auth, body, origin);

  // AI ops share a daily-cap check (chat/stream checks its own above)
  const capOk = await withinDailyCap(env, auth.workspaceId, (await getWorkspace(env, auth.workspaceId)).ai_daily_call_cap);
  if (!capOk && path.startsWith('/ai/')) return err('Daily AI call cap reached for this workspace — raise it in Settings → AI Providers if needed.', 429, origin);

  // Light anti-abuse limit on AI endpoints (per user) — generous, just stops
  // runaway loops and scripts hammering the API.
  const aiRl = await rateLimit(env, `ai:${auth.userId}`, 240, 1);
  if (!aiRl.ok && path.startsWith('/ai/')) return err('Too many AI requests — slow down a moment and try again.', 429, origin);

  if (path === '/ai/complete' && req.method === 'POST') {
    try { return json(await aiOpComplete(env, auth.workspaceId, body.prompt, body), 200, origin); }
    catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (path === '/ai/generate' && req.method === 'POST') {
    try { return json(await aiOpGenerate(env, auth.workspaceId, body), 200, origin); }
    catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (path === '/ai/rewrite' && req.method === 'POST') {
    try { return json(await aiOpRewrite(env, auth.workspaceId, body), 200, origin); }
    catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (path === '/ai/build-site' && req.method === 'POST') {
    try { return json(await aiBuildSite(env, auth.workspaceId, body), 200, origin); }
    catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (path === '/ai/analyze-site' && req.method === 'POST') {
    try { return json(await aiAnalyzeSite(env, auth.workspaceId, body), 200, origin); }
    catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (path === '/ai/scan-site' && req.method === 'POST') {
    try { return json(await scanWebsite(env, auth.workspaceId, body.url), 200, origin); }
    catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (path === '/ai/site-scenes' && req.method === 'GET') {
    const list = Object.entries(SITE_SCENES).map(([id, v]) => ({ id, name: v.name, theme: v.theme, desc: v.desc, type: isThreeScene(id) ? 'three' : 'canvas' }));
    return json({ scenes: list }, 200, origin);
  }
  if (root === 'ai' && parts[1] === 'site-scenes' && parts[3] === 'code' && parts[2] && req.method === 'GET') {
    const sc = sceneInfo(parts[2]);
    if (!sc) return err('Scene not found', 404, origin);
    if (isThreeScene(parts[2])) return json({ id: parts[2], name: sc.name, type: 'three', body: sc.body, tick: sc.tick }, 200, origin);
    return json({ id: parts[2], name: sc.name, type: 'canvas', fn: sc.fn, theme: sc.theme }, 200, origin);
  }
  if (path === '/ai/site-concepts' && req.method === 'GET') {
    return json({ concepts: SITE_CONCEPTS }, 200, origin);
  }
  if (path === '/ai/site-gallery' && req.method === 'GET') {
    const unique = [...new Map(SITE_GALLERY.map(si => [si.name, si])).values()];
    return json({ sites: unique, spline_library: 'https://docs.spline.design/designing-in-3-d/3d-library' }, 200, origin);
  }
  if (path === '/ai/site-styles' && req.method === 'GET') {
    const cat = (obj) => Object.entries(obj).map(([id, v]) => ({ id, name: v.name }));
    const themeCat = Object.entries(SITE_THEMES).map(([id, v]) => ({ id, name: v.name, vars: v.vars }));
    return json({ themes: themeCat, heroes: cat(HERO_STYLES), anims: cat(ANIM_PRESETS), cards: cat(CARD_STYLES), navs: cat(NAV_STYLES), three_d: cat(THREE_D_LEVELS), combo_count: Object.keys(SITE_THEMES).length * Object.keys(HERO_STYLES).length * Object.keys(ANIM_PRESETS).length * Object.keys(CARD_STYLES).length * Object.keys(NAV_STYLES).length * Object.keys(THREE_D_LEVELS).length }, 200, origin);
  }
  if (path === '/ai/site-designs' && req.method === 'GET') {
    const all = {};
    Object.entries(SITE_DESIGNS).forEach(([id, d]) => { all[id] = d.name; });
    Object.entries(DESIGN_EXTRAS).forEach(([id]) => { if (!all[id]) all[id] = id.charAt(0).toUpperCase() + id.slice(1); });
    return json({ designs: Object.entries(all).map(([id, name]) => ({ id, name })) }, 200, origin);
  }
  if (path === '/ai/pipeline-health' && req.method === 'GET') {
    try { return json(await aiPipelineHealth(env, auth.workspaceId), 200, origin); }
    catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (path === '/ai/analyze-image' && req.method === 'POST') {
    try { return json(await aiAnalyzeImage(env, auth.workspaceId, body), 200, origin); }
    catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (path === '/ai/memory' && req.method === 'DELETE') {
    await clearChatMemory(env, auth.workspaceId);
    return json({ ok: true }, 200, origin);
  }
  if (path === '/ai/memory' && req.method === 'GET') {
    return json({ memory: await loadChatMemory(env, auth.workspaceId, 30) }, 200, origin);
  }
  if (path === '/ai/providers' && req.method === 'GET') {
    return json(providerHealthSnapshot(), 200, origin);
  }
  if (root === 'ai' && parts[1] === 'contact-summary' && parts[2] && req.method === 'GET') {
    try { return json(await aiContactSummary(env, auth.workspaceId, parseInt(parts[2])), 200, origin); }
    catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (root === 'ai' && parts[1] === 'tag-suggest' && parts[2] && req.method === 'GET') {
    try { return json(await aiSuggestTags(env, auth.workspaceId, parseInt(parts[2])), 200, origin); }
    catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (path === '/ai/smart-reply' && req.method === 'POST') {
    try { return json(await aiSmartReply(env, auth.workspaceId, body.text), 200, origin); }
    catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (path === '/ai/score-tasks' && req.method === 'GET') {
    try { return json(await aiScoreTasks(env, auth.workspaceId), 200, origin); }
    catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (path === '/ai/deal-risks' && req.method === 'GET') {
    return json(await aiDealRisks(env, auth.workspaceId), 200, origin);
  }
  if (path === '/ai/brief' && req.method === 'GET') {
    return json(await aiDailyBrief(env, auth.workspaceId), 200, origin);
  }
  if (path === '/ai/feedback' && req.method === 'POST') {
    const rating = parseInt(body.rating);
    if (rating !== 1 && rating !== -1) return err('Rating must be 1 or -1', 400, origin);
    await env.DB.prepare('INSERT INTO ai_feedback (workspace_id, rating, op, provider, model) VALUES (?,?,?,?,?)')
      .bind(auth.workspaceId, rating, String(body.op || '').slice(0, 60), String(body.provider || '').slice(0, 40), String(body.model || '').slice(0, 80)).run();
    return json({ ok: true }, 200, origin);
  }
  if (path === '/ai/translate' && req.method === 'POST') {
    try {
      const w = await getWorkspace(env, auth.workspaceId);
      if (!(await withinDailyCap(env, auth.workspaceId, w.ai_daily_call_cap))) return err('Daily AI call cap reached.', 429, origin);
      const lang = String(body.language || 'English').slice(0, 40);
      const r = await callProvider(env, w, [{ role: 'user', content: `Translate to ${lang}. Return ONLY the translated text: "${String(body.text || '').slice(0, 4000)}"` }], { max_tokens: 1000 });
      await trackAIUsage(env, auth.workspaceId, 'translate', r.provider, r.usage);
      return json({ content: r.content }, 200, origin);
    } catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (path === '/ai/tone-remix' && req.method === 'POST') {
    try {
      const w = await getWorkspace(env, auth.workspaceId);
      if (!(await withinDailyCap(env, auth.workspaceId, w.ai_daily_call_cap))) return err('Daily AI call cap reached.', 429, origin);
      const tone = String(body.tone || 'professional').slice(0, 30);
      const r = await callProvider(env, w, [{ role: 'user', content: `Rewrite this in a ${tone} tone. Keep the meaning and length similar. Return only the rewrite:\n\n${String(body.text || '').slice(0, 4000)}` }], { max_tokens: 1500 });
      await trackAIUsage(env, auth.workspaceId, 'tone-remix', r.provider, r.usage);
      return json({ content: r.content }, 200, origin);
    } catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (path === '/ai/doc-analyze' && req.method === 'POST') {
    try {
      const w = await getWorkspace(env, auth.workspaceId);
      if (!(await withinDailyCap(env, auth.workspaceId, w.ai_daily_call_cap))) return err('Daily AI call cap reached.', 429, origin);
      const r = await callProvider(env, w, [{ role: 'user', content: `Analyze this document. Give: 1) Key points (5 max), 2) Decisions made, 3) Action items with owner+deadline if mentioned, 4) Open questions. Be concise.\n\n${String(body.text || '').slice(0, 6000)}` }], { max_tokens: 800 });
      await trackAIUsage(env, auth.workspaceId, 'doc-analyze', r.provider, r.usage);
      return json({ content: r.content }, 200, origin);
    } catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (path === '/ai/suggest-workflows' && req.method === 'GET') {
    const ws = auth.workspaceId;
    const [wfCount, contacts7, dealsStale, forms, noReply] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) n FROM workflows WHERE workspace_id=?').bind(ws).first(),
      env.DB.prepare('SELECT COUNT(*) n FROM contacts WHERE workspace_id=? AND created_at >= ?').bind(ws, new Date(Date.now() - 7 * 86400000).toISOString()).first(),
      env.DB.prepare(`SELECT COUNT(*) n FROM deals WHERE workspace_id=? AND stage NOT IN ('won','lost') AND created_at < ?`).bind(ws, new Date(Date.now() - 14 * 86400000).toISOString()).first(),
      env.DB.prepare('SELECT COUNT(*) n FROM forms WHERE workspace_id=?').bind(ws).first(),
      env.DB.prepare(`SELECT COUNT(*) n FROM messages WHERE workspace_id=? AND direction='inbound' AND created_at >= ?`).bind(ws, new Date(Date.now() - 7 * 86400000).toISOString()).first(),
    ]);
    const suggestions = [];
    if (contacts7.n >= 3 && wfCount.n === 0) {
      suggestions.push({ title: 'Welcome new contacts', why: `You added ${contacts7.n} contacts in the last 7 days but have no workflows yet.`, trigger: 'new_contact', steps: [{ action: 'create_task', note: 'Follow up with the new contact within 24 hours' }, { action: 'update_stage', note: 'Move to prospect', stage: 'prospect' }] });
    }
    if (dealsStale.n > 0) {
      suggestions.push({ title: 'Re-engage stale deals', why: `${dealsStale.n} deal(s) untouched for 14+ days.`, trigger: 'manual', steps: [{ action: 'create_task', note: `Re-engage a stale deal and update it`, priority: 'high' }] });
    }
    if (forms.n > 0) {
      suggestions.push({ title: 'Follow up form leads fast', why: 'You have forms — leads expect a fast response.', trigger: 'form_submitted', steps: [{ action: 'create_task', note: 'Call this form lead within 1 hour — speed wins deals', priority: 'high' }] });
    }
    if (noReply.n >= 3) {
      suggestions.push({ title: 'Inbound message follow-up', why: `${noReply.n} inbound messages this week — make sure nobody waits.`, trigger: 'manual', steps: [{ action: 'create_task', note: 'Reply to unanswered inbound messages today' }] });
    }
    return json({ suggestions: suggestions.slice(0, 4) }, 200, origin);
  }
  if (path === '/ai/agent' && req.method === 'POST') {
    return aiAgentHandler(env, ctx, auth.workspaceId, body, origin);
  }
  if (path === '/ai/forecast' && req.method === 'GET') {
    return json(await computeForecast(env, auth.workspaceId), 200, origin);
  }
  if (path === '/ai/sentiment' && req.method === 'POST') {
    try { return json(await aiOpSentiment(env, auth.workspaceId, body.text), 200, origin); }
    catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (root === 'ai' && parts[1] === 'score-lead') {
    try { return json(await aiOpScoreLead(env, auth.workspaceId, parseInt(parts[2])), 200, origin); }
    catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }
  if (path === '/ai/build-workflow' && req.method === 'POST') {
    try { return json({ workflow: await aiOpBuildWorkflow(env, auth.workspaceId, body.goal) }, 200, origin); }
    catch (e) { return err(e.message, e instanceof UserError ? 400 : 502, origin); }
  }

  return err(`No handler for ${req.method} ${path}`, 404, origin);
}

// Test hook (used by the automated test suite; harmless in production).
globalThis.__nxTest = { resetProviderHealth: () => { PROVIDER_HEALTH.clear(); HEALTH_CACHE.clear(); } };

export default {
  async fetch(req, env, ctx) {
    try { return await router(req, env, ctx); }
    catch (e) {
      console.error('Unhandled error:', e);
      return json({ error: e.message || 'Internal error' }, 500, req.headers.get('Origin') || '*');
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await sweepEvents(env);
      if (new Date().getUTCMinutes() < 5) await runHourlyJobs(env);
    })());
  },
};
