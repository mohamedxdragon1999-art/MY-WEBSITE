// ════════════════════════════════════════════════════════════
// NexusCRM — zero-dependency local server
// Serves the single-file app on http://127.0.0.1:8080 and opens
// your browser automatically. Launch it with Start-NexusCRM.bat
// (Windows) or:  node server.js
// ════════════════════════════════════════════════════════════
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

const PORT = process.env.PORT || 8080;
// Default stays loopback-only (nothing else on your machine/network can
// reach it). Set HOST=0.0.0.0 only in sandboxed/preview environments.
const HOST = process.env.HOST || '127.0.0.1';
const FILE = path.join(__dirname, 'NexusCRM_V4_Hardened.html');

// ── Deploy Studio plumbing ─────────────────────────────────────────
// The Settings → System "Deploy my backend" button drives the REAL
// deployment through these endpoints. api.cloudflare.com refuses browser
// CORS, so the app talks to this same-origin proxy instead — the only
// machine that ever sees the Cloudflare API token is the user's own.
const CF_API_BASE = 'https://api.cloudflare.com/client/v4/';
// Path prefixes the proxy will forward. Deliberately narrow: this proxy is
// for DEPLOYING NexusCRM, not a general-purpose relay.
const CF_ALLOWED_PREFIXES = [
  'user/tokens/verify',
  'accounts', // account list, d1 (list/create/query), workers (scripts, subdomain, schedules)
];
let deployChild = null; // the running auto-deploy process, if any

function readJSONSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function sendJSON(res, code, obj) {
  try { res.setHeader('Access-Control-Allow-Origin', '*'); } catch {}
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// Forward a browser request to api.cloudflare.com. Only GET/POST/PUT/PATCH
// with the path prefixes above; the Authorization header passes through
// untouched and is NEVER logged.
async function proxyCloudflare(req, res, cfPath) {
  const allowed = CF_ALLOWED_PREFIXES.some((p) => cfPath === p || cfPath.startsWith(p + '/') || cfPath.startsWith(p + '?'));
  if (!allowed) return sendJSON(res, 403, { error: 'This proxy only forwards Cloudflare deploy endpoints, not ' + cfPath });
  if (!['GET', 'POST', 'PUT', 'PATCH'].includes(req.method)) return sendJSON(res, 405, { error: 'Method not allowed' });
  // Read the request body fully before forwarding.
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  await new Promise((r) => req.on('end', r));
  const body = chunks.length ? Buffer.concat(chunks) : null;
  const headers = { 'Content-Type': req.headers['content-type'] || 'application/json' };
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), 30000); // Cloudflare calls must never hang forever
  try {
    const r = await fetch(CF_API_BASE + cfPath, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
      signal: ctrl.signal,
    });
    clearTimeout(killer);
    const text = await r.text();
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
    res.end(text);
  } catch (e) {
    clearTimeout(killer);
    const aborted = e && e.name === 'AbortError';
    sendJSON(res, 502, { error: aborted ? 'Cloudflare API timed out after 30s — check your internet connection and try again.' : 'Could not reach api.cloudflare.com — check your internet connection. (' + (e && e.message ? String(e.message).slice(0, 120) : 'network error') + ')' });
  }
}

// ── AI provider relay (the "failed to fetch" CORS fix, zero config) ──
// NVIDIA NIM, OpenAI and most other AI providers do NOT send CORS headers,
// so a browser page can never call them directly — the app used to require
// deploying a separate CORS proxy to work around it. But the app is ALREADY
// running behind this local server, so the server can relay those calls
// itself. The app detects this automatically (Settings → AI Providers keeps
// working with no proxy URL configured) and routes provider calls through
// /api/ai-proxy?url=… — same contract as the deployable CORS proxy worker.
// Hard rules, same spirit as the Cloudflare relay above:
//   * host allowlist (major AI providers + localhost Ollama/LM Studio)
//   * path suffix allowlist (chat/completions, completions, models, embeds)
//   * request body capped at 512 KB, JSON responses capped at 4 MB
//   * 120 s hard timeout (long enough for slow generations + streaming)
//   * the Authorization header is passed through and NEVER logged
const AI_ALLOWED_HOSTS = new Set([
  'integrate.api.nvidia.com', 'api.openai.com', 'api.anthropic.com',
  'openrouter.ai', 'api.groq.com', 'api.deepseek.com', 'api.mistral.ai',
  'api.x.ai', 'generativelanguage.googleapis.com', 'api.cohere.ai',
  'api.together.xyz', 'api.moonshot.ai', 'api.siliconflow.com',
  'api.electronhub.ai', 'api.arliai.com', 'api.g01.ai',
]);
const AI_ALLOWED_PATH = /\/(chat\/completions|completions|models|embeddings|messages)(\/|$|\?)/;
const AI_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);
const MAX_AI_BODY = 512 * 1024;
const MAX_AI_RESPONSE = 4 * 1024 * 1024;

function aiTargetAllowed(target) {
  if (!target) return 'Missing ?url= parameter.';
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return 'Only http(s) provider URLs are relayed.';
  const host = (target.hostname || '').toLowerCase();
  const isLocal = AI_LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
  if (!AI_ALLOWED_HOSTS.has(host) && !isLocal) {
    return `This relay only forwards known AI providers (${[...AI_ALLOWED_HOSTS].slice(0, 4).join(', ')}… and local Ollama/LM Studio), not ${host}.`;
  }
  // Local servers (Ollama/LM Studio) are same-machine — nothing to protect.
  if (!isLocal && !AI_ALLOWED_PATH.test(target.pathname)) {
    return 'This relay only forwards provider endpoints: chat/completions, completions, models, embeddings.';
  }
  return null; // allowed
}

async function relayAI(req, res, target) {
  const problem = aiTargetAllowed(target);
  if (problem) return sendJSON(res, 403, { error: problem });
  if (!['GET', 'POST'].includes(req.method)) return sendJSON(res, 405, { error: 'Method not allowed.' });
  // ── Cycle 43: POST bodies must be provider-shaped (JSON). Multipart or
  // binary uploads are never legitimate here and are refused up front. ──
  if (req.method === 'POST') {
    const ct = String(req.headers['content-type'] || '');
    if (ct && !/^(application\/json|text\/plain|application\/x-www-form-urlencoded)/i.test(ct)) {
      return sendJSON(res, 415, { error: 'Unsupported Content-Type for the AI relay — providers expect application/json.' });
    }
  }
  const chunks = [];
  let size = 0;
  let tooBig = false;
  // ── Cycle 47: the moment the cap is crossed: (1) respond 413 immediately
  // (the honest client gets its error), (2) stop buffering, (3) if the sender
  // keeps streaming for 2+ more seconds, kill the socket — an endless
  // stream can never pin this connection or grow memory. ──
  let capTimer = null;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_AI_BODY) {
      if (!tooBig) {
        tooBig = true;
        // Hard cut: if the sender is still streaming 5s after crossing the
        // cap (an endless stream, not a big-but-finite upload), respond and
        // drop the socket. Normal big uploads drain to 'end' below and get
        // a clean 413 without a connection reset.
        capTimer = setTimeout(() => {
          if (!res.headersSent) { try { sendJSON(res, 413, { error: 'Request too large for the AI relay (limit 512 KB) — shorten the prompt.' }); } catch {} }
          setTimeout(() => { try { req.destroy(); } catch {} }, 100);
        }, 5000);
      }
      return; // discard everything past the cap — memory stays bounded
    }
    chunks.push(c);
  });
  // Wait for the body to be fully received. 'close' alone is NOT a safe
  // completion signal on keep-alive sockets (it can fire before 'end' on a
  // reused connection, which would make us respond mid-upload → the client
  // sees ECONNRESET). Only treat close as completion once the stream has
  // actually ended or the socket is really gone.
  await new Promise((r) => {
    req.on('end', r);
    req.on('error', r);
    req.on('close', () => { if (req.readableEnded || req.destroyed) r(); });
  });
  if (tooBig) {
    if (capTimer) clearTimeout(capTimer);
    if (!res.headersSent) { try { sendJSON(res, 413, { error: 'Request too large for the AI relay (limit 512 KB) — shorten the prompt.' }); } catch {} }
    return;
  }
  const body = chunks.length ? Buffer.concat(chunks) : null;
  const headers = { 'Content-Type': req.headers['content-type'] || 'application/json' };
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;
  if (req.headers['x-api-key']) headers['x-api-key'] = req.headers['x-api-key'];
  if (req.headers['anthropic-version']) headers['anthropic-version'] = req.headers['anthropic-version'];
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === 'GET' ? undefined : body,
      signal: ctrl.signal,
    });
    clearTimeout(killer);
    const respHeaders = {
      'Content-Type': r.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
      'X-Nexus-Relay': 'local',
    };
    // SSE streams are piped through untouched so token-by-token streaming
    // keeps working through the relay; JSON is capped for safety.
    const isStream = (r.headers.get('content-type') || '').includes('text/event-stream');
    if (isStream) {
      res.writeHead(r.status, respHeaders);
      // Manual pipe with abort-on-close so a cancelled request doesn't leak.
      const reader = r.body.getReader();
      req.on('close', () => { try { reader.cancel(); } catch {} });
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } catch {}
      res.end();
      return;
    }
    const text = await r.text();
    if (text.length > MAX_AI_RESPONSE) {
      return sendJSON(res, 502, { error: 'Provider response exceeded the 4 MB relay cap.' });
    }
    res.writeHead(r.status, respHeaders);
    res.end(text);
  } catch (e) {
    clearTimeout(killer);
    const aborted = e && e.name === 'AbortError';
    sendJSON(res, aborted ? 504 : 502, {
      error: aborted
        ? 'The AI provider did not answer within 120 s — it may be under load. Try again, or pick a faster model in Settings.'
        : 'Could not reach the AI provider — check your internet connection. (' + String((e && e.message) || 'network error').slice(0, 120) + ')',
    });
  }
}


// Cached internet-connectivity probe (60s TTL, 3s timeout). Any HTTP answer
// from a well-known host proves outbound connectivity.
let __netCache = { at: 0, ok: null };
async function hasInternet() {
  if (__netCache.ok !== null && Date.now() - __netCache.at < 60000) return __netCache.ok;
  let ok = false;
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 3000);
    const r = await fetch('https://www.cloudflare.com/cdn-cgi/trace', { method: 'HEAD', signal: c.signal, cache: 'no-store' });
    clearTimeout(t);
    ok = r.status > 0; // ANY answer from the outside world proves connectivity
  } catch { ok = false; }
  __netCache = { at: Date.now(), ok };
  return ok;
}
// ═══ HARDENING BATCH 2 ═══════════════════════════════════════════
// ── Cycle 41: per-IP sliding-window rate limiter ─────────────────
// A malicious page open in the same browser (or anything on the LAN,
// since the server binds 0.0.0.0 when asked) must not be able to use
// this relay as a free high-volume AI gateway or hammer Cloudflare.
const RATE_WINDOW_MS = 60_000;
const RATE_LIMITS = { '/api/ai-proxy': 40, '/api/cf': 20, '/api/deploy/start': 6 };
const RATE_BUCKETS = new Map(); // ip:pathname -> timestamps
function withinRateLimit(ip, pathname) {
  const max = RATE_LIMITS[pathname];
  if (!max) return true;
  const key = ip + ':' + pathname;
  const now = Date.now();
  const arr = (RATE_BUCKETS.get(key) || []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (arr.length >= max) { RATE_BUCKETS.set(key, arr); return false; }
  arr.push(now); RATE_BUCKETS.set(key, arr);
  // opportunistic cleanup so the map can never grow unbounded
  if (RATE_BUCKETS.size > 5000) {
    for (const [k, v] of RATE_BUCKETS) if (!v.some((ts) => now - ts < RATE_WINDOW_MS)) RATE_BUCKETS.delete(k);
  }
  return true;
}
// ── Cycle 42: security headers on every response ─────────────────
// Deliberately NO X-Frame-Options / CSP frame-ancestors: the app is
// legitimately embedded in iframes (dashboard previews, hosted preview
// environments). nosniff + referrer + permissions policy still apply.
function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
}
const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);
  // ── Cycle 48: reject absurd URLs up front (memory + parse safety) ──
  if (!req.url || req.url.length > 8192) {
    res.writeHead(414, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'URL too long.' }));
    return;
  }
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT);
  const clientIp = (req.socket && req.socket.remoteAddress) || 'unknown';
  // ── Cycle 41: rate-limited endpoints ──
  if (RATE_LIMITS[url.pathname] && !withinRateLimit(clientIp, url.pathname)) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'Rate limit reached (' + RATE_LIMITS[url.pathname] + ' requests/min) — wait a moment and retry.' }));
    return;
  }
  // ── Cycle 49: CORS preflight for cross-origin app usage (file:// host) ──
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return;
  }

  // Health check (the app pings /api/health to detect a "backend" —
  // this local server only reports healthy, it does NOT provide the API).
  if (url.pathname === '/api/health') {
    // HONEST reporting: say whether THIS server can reach the internet at
    // all. The relay is useless without internet (e.g. sandboxed previews) —
    // the frontend uses this to tell the user the truth BEFORE a confusing
    // provider error ever appears.
    const net = await hasInternet();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, service: 'nexuscrm-local-static', localOnly: true, aiRelay: true, internet: net }));
    return;
  }

  // AI provider relay (see relayAI above). The app calls
  // /api/ai-proxy?url=<encoded provider endpoint>.
  if (url.pathname === '/api/ai-proxy') {
    // ── Cycle 44: cap the target URL length before parsing it ──
    const rawTarget = url.searchParams.get('url') || '';
    if (rawTarget.length > 2000) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Target URL too long.' }));
      return;
    }
    let target = null;
    try { target = new URL(rawTarget); } catch {}
    relayAI(req, res, target);
    return;
  }


  // Deployed-backend detection: if the launcher's auto-deployer already
  // deployed the Cloudflare backend (backend/.deployed.json), expose its URL
  // so the app's Settings → System can offer a one-click "use my backend"
  // button instead of the owner having to copy-paste anything.
  if (url.pathname === '/api/deployed-backend') {
    let out = { url: null, deployed_at: null };
    try {
      const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'backend', '.deployed.json'), 'utf8'));
      if (m && typeof m === 'object' && m.api_url) out = { url: m.api_url, deployed_at: m.deployed_at || null };
    } catch { /* not deployed yet — {url:null} is the honest answer */ }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(out));
    return;
  }

  // ── Deploy Studio endpoints (Settings → System "Deploy now") ──
  // The real backend source, served so the browser can upload it to
  // Cloudflare via the REST API (multipart module upload).
  if (url.pathname === '/api/backend-source') {
    fs.readFile(path.join(__dirname, 'backend', 'src', 'index.js'), (err, data) => {
      if (err) return sendJSON(res, 500, { error: 'Could not read backend/src/index.js — is the backend folder next to server.js?' });
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }
  if (url.pathname === '/api/cors-proxy-source') {
    fs.readFile(path.join(__dirname, 'cors-proxy-worker.js'), (err, data) => {
      if (err) return sendJSON(res, 500, { error: 'Could not read cors-proxy-worker.js — is it next to server.js?' });
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }
  // The D1 schema (applied to the database during deploy).
  if (url.pathname === '/api/schema-source') {
    fs.readFile(path.join(__dirname, 'backend', 'schema.sql'), (err, data) => {
      if (err) return sendJSON(res, 500, { error: 'Could not read backend/schema.sql — is the backend folder next to server.js?' });
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }

  // Same-origin passthrough to api.cloudflare.com (CORS makes direct
  // browser→Cloudflare calls impossible; this proxy is the fix). The app
  // calls /api/cf/client/v4/<rest> — mirror the real API layout, then strip
  // the client/v4/ prefix (CF_API_BASE already includes it).
  if (url.pathname.startsWith('/api/cf/')) {
    let cfPath = decodeURIComponent(url.pathname.slice('/api/cf/'.length)) + (url.search || '');
    if (cfPath.startsWith('client/v4/')) cfPath = cfPath.slice('client/v4/'.length);
    proxyCloudflare(req, res, cfPath);
    return;
  }

  // One-click deploy (wrangler path): spawn the battle-tested auto-deployer
  // with JSON status streaming. stdio is inherited so wrangler's login
  // prompt/browser flow is visible in the console that launched the app.
  if (url.pathname === '/api/deploy/start' && req.method === 'POST') {
    if (deployChild && !deployChild.killed) return sendJSON(res, 409, { error: 'A deploy is already running — watch its progress below.', already: true });
    const args = [path.join(__dirname, 'backend', 'auto-deploy.js'), '--yes', '--json-status'];
    try {
      deployChild = spawn(process.execPath, args, { cwd: __dirname, stdio: 'inherit' });
    } catch (e) {
      deployChild = null;
      return sendJSON(res, 500, { error: 'Could not start the deployer: ' + (e && e.message) });
    }
    deployChild.on('exit', () => { deployChild = null; });
    sendJSON(res, 200, { ok: true, started: true });
    return;
  }

  // Live progress from the deployer's status file (written every step).
  if (url.pathname === '/api/deploy/status') {
    let st = readJSONSafe(path.join(__dirname, 'backend', '.deploy-status.json'), null);
    // A status file claiming "running" while no deployer process is alive is
    // STALE (e.g. the console window was closed mid-deploy, or the machine
    // slept). Report it as an error after a grace period so the app's modal
    // never spins forever — honest failure beats an infinite spinner.
    if (st && st.status === 'running' && !(deployChild && !deployChild.killed)) {
      const age = st.ts ? Date.now() - new Date(st.ts).getTime() : Infinity;
      if (age > 90000) st = { status: 'error', step: st.step || 'unknown', error: 'The deployer stopped responding (its console window may have been closed, or the computer slept). Nothing is broken — start the deploy again.', ts: st.ts };
    }
    return sendJSON(res, 200, { running: !!(deployChild && !deployChild.killed), status: st });
  }

  // Anything else serves the app itself (single-file SPA).
  fs.readFile(FILE, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Could not read NexusCRM_V4_Hardened.html — make sure server.js sits next to it.');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  // Report the address we ACTUALLY bound. Hardcoding 127.0.0.1 in the banner was
  // misleading under Docker/WSL/custom hosts, where the server is reachable on a
  // different address and the printed URL simply does not work.
  const wildcard = HOST === '0.0.0.0' || HOST === '::';
  const shownHost = wildcard ? 'localhost' : HOST;
  const url = 'http://' + shownHost + ':' + PORT;
  const bindLine = wildcard
    ? '  │  Bound to ' + (HOST + ' (all interfaces)').padEnd(45) + '│\n'
    : '  │  Bound to ' + (HOST + ' (loopback only)').padEnd(45) + '│\n';
  const msg =
    '\n' +
    '  ┌────────────────────────────────────────────────────────┐\n' +
    '  │  🚀 NexusCRM is running!                               │\n' +
    '  │  Open:  ' + url.padEnd(47) + '│\n' +
    bindLine +
    (wildcard ? '' : '  │  Set HOST=0.0.0.0 for Docker/WSL/remote access.        │\n') +
    '  │  Local-only mode: data stays in this browser.          │\n' +
    '  │  For syncing + automations + AI streaming, deploy the  │\n' +
    '  │  backend (backend/DEPLOY.md) and set it in Settings.   │\n' +
    '  └────────────────────────────────────────────────────────┘\n';
  console.log(msg);
  try {
    if (process.platform === 'win32') exec('start "" ' + url);
    else if (process.platform === 'darwin') exec('open ' + url);
    else exec('xdg-open ' + url + ' || sensible-browser ' + url + ' || true');
  } catch { /* browser open failed — user can open manually */ }
});

// ── Cycle 50: malformed client input (bad HTTP) must never crash the
// process — respond 400 and keep serving everyone else. ──
server.on('clientError', (err, socket) => {
  try { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); } catch {}
});
process.on('uncaughtException', (e) => {
  console.error('[server] survived unexpected error:', e && e.message ? e.message : e);
});
process.on('unhandledRejection', (e) => {
  console.error('[server] survived unhandled rejection:', e && e.message ? e.message : e);
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('Port ' + PORT + ' is already in use — opening it in your browser instead.');
    const url = 'http://127.0.0.1:' + PORT;
    try {
      if (process.platform === 'win32') exec('start "" ' + url);
      else if (process.platform === 'darwin') exec('open ' + url);
      else exec('xdg-open ' + url);
    } catch {}
    process.exit(0);
  }
  console.error('Server error:', e.message);
  process.exit(1);
});
