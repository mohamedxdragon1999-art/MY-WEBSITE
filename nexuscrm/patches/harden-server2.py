# HARDENING BATCH 2 — server.js (cycles 41-50)
p='server.js'
h=open(p).read()
n0=len(h)

# ── Cycle 41+42: per-IP rate limiter + security headers helper ──
anchor="const server = http.createServer((req, res) => {"
assert anchor in h
guard='''
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
'''
h=h.replace(anchor, guard+anchor)

# apply headers + rate limit + URL cap inside the handler
old="""const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT);
"""
new="""const server = http.createServer((req, res) => {
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
"""
assert old in h
h=h.replace(old,new)

# CORS headers on relay responses so the app can call them cross-origin too
old2="""  if (url.pathname === '/api/ai-proxy') {
    let target = null;
    try { target = new URL(url.searchParams.get('url') || ''); } catch {}
    relayAI(req, res, target);
    return;
  }"""
new2="""  if (url.pathname === '/api/ai-proxy') {
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
  }"""
assert old2 in h
h=h.replace(old2,new2)

# ── Cycle 43 + 47: content-type validation + immediate destroy on oversized body ──
old3="""async function relayAI(req, res, target) {
  const problem = aiTargetAllowed(target);
  if (problem) return sendJSON(res, 403, { error: problem });
  if (!['GET', 'POST'].includes(req.method)) return sendJSON(res, 405, { error: 'Method not allowed.' });
  const chunks = [];
  let size = 0;
  let tooBig = false;
  req.on('data', (c) => { size += c.length; if (size > MAX_AI_BODY) { tooBig = true; } else chunks.push(c); });
  await new Promise((r) => req.on('end', r));
  if (tooBig) return sendJSON(res, 413, { error: 'Request too large for the AI relay (limit 512 KB) — shorten the prompt.' });"""
new3="""async function relayAI(req, res, target) {
  const problem = aiTargetAllowed(target);
  if (problem) return sendJSON(res, 403, { error: problem });
  if (!['GET', 'POST'].includes(req.method)) return sendJSON(res, 405, { error: 'Method not allowed.' });
  // ── Cycle 43: POST bodies must be provider-shaped (JSON). Multipart or
  // binary uploads are never legitimate here and are refused up front. ──
  if (req.method === 'POST') {
    const ct = String(req.headers['content-type'] || '');
    if (ct && !/^(application\\/json|text\\/plain|application\\/x-www-form-urlencoded)/i.test(ct)) {
      return sendJSON(res, 415, { error: 'Unsupported Content-Type for the AI relay — providers expect application/json.' });
    }
  }
  const chunks = [];
  let size = 0;
  let tooBig = false;
  // ── Cycle 47: stop READING the moment the cap is crossed — an endless
  // stream must not pin this connection open. Destroy the socket. ──
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_AI_BODY) { tooBig = true; req.destroy(); }
    else chunks.push(c);
  });
  await new Promise((r) => { req.on('end', r); req.on('close', r); });
  if (tooBig) { try { sendJSON(res, 413, { error: 'Request too large for the AI relay (limit 512 KB) — shorten the prompt.' }); } catch {} return; }"""
assert old3 in h
h=h.replace(old3,new3)

# ── Cycle 50: client-error safety net — a malformed request must never crash the server ──
old4="server.on('error', (e) => {"
new4="""// ── Cycle 50: malformed client input (bad HTTP) must never crash the
// process — respond 400 and keep serving everyone else. ──
server.on('clientError', (err, socket) => {
  try { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\\r\\nConnection: close\\r\\n\\r\\n'); } catch {}
});
process.on('uncaughtException', (e) => {
  console.error('[server] survived unexpected error:', e && e.message ? e.message : e);
});
process.on('unhandledRejection', (e) => {
  console.error('[server] survived unhandled rejection:', e && e.message ? e.message : e);
});
server.on('error', (e) => {"""
assert old4 in h
h=h.replace(old4,new4)

# CORS allow-origin on relay + health JSON responses (cross-origin file:// support)
h=h.replace("""function sendJSON(res, code, obj) {""","""function sendJSON(res, code, obj) {
  try { res.setHeader('Access-Control-Allow-Origin', '*'); } catch {}""")

open(p,'w').write(h)
print(f'✓ server.js hardening batch 2 applied ({n0} -> {len(h)} bytes)')
