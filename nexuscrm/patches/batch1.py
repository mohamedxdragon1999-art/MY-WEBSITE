#!/usr/bin/env python3
"""Batch 1: core frontend fixes — helpers, backend detection, realFetch auth."""
import sys, re

P = 'NexusCRM_V4_Hardened.html'
s = open(P, encoding='utf-8').read()
orig = s

def rep(old, new, count=1, tag=''):
    global s
    n = s.count(old)
    if n != count:
        print(f'❌ [{tag}] expected {count} occurrence(s), found {n}')
        print('   OLD starts:', repr(old[:120]))
        sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

# ── P1: REAL_MODE helper (backend configured => never silently go local) ──
rep("""let API = getConfiguredAPI();
let WS_URL = API.replace('/api', '').replace('https:', 'wss:').replace('http:', 'ws:');""",
"""let API = getConfiguredAPI();
let WS_URL = API.replace('/api', '').replace('https:', 'wss:').replace('http:', 'ws:');
// A backend URL explicitly configured in Settings = the user is committed to
// the real server. In that mode we NEVER silently fall back to localStorage —
// data would diverge and the user would think they're synced when they're not.
const REAL_MODE = () => !!localStorage.getItem('nx_backend_url');""",
tag='REAL_MODE')

# ── P2: pingBackend — longer timeout + auto-re-ping when configured ──
rep("""async function pingBackend() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 1200);
    const r = await fetch(API + '/health', { signal: ctrl.signal });
    clearTimeout(t);
    BACKEND.available = !!r.ok;
  } catch { BACKEND.available = false; }
  BACKEND.checked = Date.now();
  return BACKEND.available;
}""",
"""let pingTimer = null;
async function pingBackend() {
  // Cloudflare Workers cold starts routinely take 1-5s — a 1.2s timeout used
  // to make the very first health check fail and derail the whole session
  // into local mode. 5s is the real-world-safe window.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 5000);
    const r = await fetch(API + '/health', { signal: ctrl.signal });
    clearTimeout(t);
    BACKEND.available = !!r.ok;
  } catch { BACKEND.available = false; }
  BACKEND.checked = Date.now();
  // If a backend is configured but down, quietly retry every 15s so the app
  // recovers on its own once the worker wakes up.
  if (REAL_MODE() && !BACKEND.available && !pingTimer) {
    pingTimer = setTimeout(() => { pingTimer = null; pingBackend(); }, 15000);
  }
  return BACKEND.available;
}""",
tag='pingBackend')

# ── P3: realFetch — never swallow auth errors; api() — real mode stays real ──
rep("""// ── UNIFIED api() — tries a real server.js if present, else local ──
async function realFetch(path, method, body) {
  const opts = { method, headers: { 'Content-Type':'application/json', ...(STATE.token?{Authorization:`Bearer ${STATE.token}`}:{}) } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  if (r.status === 401) { doLogout(); return null; }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Server error ${r.status}`);
  return data;
}
async function api(path, method='GET', body=null) {
  if (BACKEND.available === null) await pingBackend();
  if (BACKEND.available) {
    try { return await realFetch(path, method, body); }
    catch(e) {
      if (e instanceof TypeError) { await pingBackend(); if (!BACKEND.available) return localApi(path, method, body); }
      throw e;
    }
  }
  return localApi(path, method, body);
}""",
"""// ── UNIFIED api() — real backend if configured/detected, else local engine ──
async function realFetch(path, method, body) {
  const opts = { method, headers: { 'Content-Type':'application/json', ...(STATE.token?{Authorization:`Bearer ${STATE.token}`}:{}) } };
  if (body) opts.body = JSON.stringify(body);
  let r;
  try { r = await fetch(API + path, opts); }
  catch (e) {
    // Network failure — never silently pretend local mode is the backend.
    if (REAL_MODE()) throw new Error('Backend unreachable — check your connection and Settings → System → Backend URL.');
    throw e;
  }
  if (r.status === 401) {
    // On the login endpoint a 401 means "wrong credentials" — surface it.
    if (path === '/auth/login' || path === '/auth/register') {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || 'Invalid email or password');
    }
    doLogout();
    return null;
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Server error ${r.status}`);
  return data;
}
async function api(path, method='GET', body=null) {
  if (REAL_MODE()) return realFetch(path, method, body);
  if (BACKEND.available === null) await pingBackend();
  if (BACKEND.available) {
    try { return await realFetch(path, method, body); }
    catch(e) {
      if (e instanceof TypeError) { await pingBackend(); if (!BACKEND.available) return localApi(path, method, body); }
      throw e;
    }
  }
  return localApi(path, method, body);
}""",
tag='realFetch+api')

# ── P4: robust timeAgo + esc/escAttr/parseDate/sanitizeHtml/downloadCSV ──
rep("""const timeAgo = d => {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
};""",
"""// Tolerates ISO-8601 (2026-08-22T10:00:00.000Z) AND SQLite-style
// (2026-08-22 10:00:00) timestamps — Safari can't parse the latter natively.
function parseDate(d) {
  if (!d) return null;
  let t;
  if (typeof d === 'string' && /^\\d{4}-\\d{2}-\\d{2}[ T]/.test(d) && !d.includes('T')) t = new Date(d.replace(' ', 'T') + 'Z');
  else t = new Date(d);
  return isNaN(t.getTime()) ? null : t;
}
const timeAgo = d => {
  const t = parseDate(d);
  if (!t) return '—';
  const s = Math.floor((Date.now() - t.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
};
// ── OUTPUT ESCAPING (XSS protection) ─────────────────────────
// Every user/email-sourced value rendered into innerHTML or an onclick
// attribute MUST go through esc() / escAttr(). Email subject lines,
// sender names, contact fields and AI output are all attacker-controlled.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escAttr(s) { return esc(s); }
// Sanitize an HTML email body: strips scripts, event handlers, javascript:
// URLs and embedded objects — the rest renders safely.
function sanitizeHtml(h) {
  if (!h) return '';
  const doc = new DOMParser().parseFromString(String(h), 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form').forEach(n => n.remove());
  doc.querySelectorAll('*').forEach(n => {
    [...n.attributes].forEach(a => {
      const name = a.name.toLowerCase();
      const val = a.value.toLowerCase();
      if (name.startsWith('on') || (a.name === 'href' && /^\\s*javascript:/i.test(val)) || (a.name === 'src' && /^\\s*javascript:/i.test(val))) n.removeAttribute(a.name);
    });
  });
  return doc.body ? doc.body.innerHTML : '';
}
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(v => { const s = String(v == null ? '' : v); return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\\n');
  const blob = new Blob(['\\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
}
// Proper CSV line parser (handles quoted fields with commas/newlines).
function parseCSVLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}""",
tag='utils')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 1 done.')
