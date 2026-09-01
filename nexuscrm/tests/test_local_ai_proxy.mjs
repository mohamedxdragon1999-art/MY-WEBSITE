// LOCAL AI RELAY TESTS — spawns the REAL server.js and a mock AI provider
// on 127.0.0.1, then proves the relay's full contract: allowlist enforcement,
// path restrictions, header forwarding, streaming (SSE) piping, response
// caps, health reporting, and that keys never appear in logs/errors.
//
// Run: node tests/test_local_ai_proxy.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

// ── Mock AI provider (upstream) ──────────────────────────────
const UP_PORT = 42000 + Math.floor(Math.random() * 3000);
let upstreamLogs = [];
const upstream = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    upstreamLogs.push({ url: req.url, auth: req.headers['authorization'] || '', body });
    if (req.url.startsWith('/v1/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-large' }, { id: 'mock-small' }] }));
      return;
    }
    if (req.url.startsWith('/v1/chat/completions')) {
      if (req.headers['authorization'] !== 'Bearer nvapi-mock-key-123456') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'bad key' } }));
        return;
      }
      if (body.length > 600 * 1024) { // relay cap is 512KB → upstream never sees this
        res.writeHead(413); res.end('{}'); return;
      }
      if ((JSON.parse(body || '{}').stream)) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const frames = ['data: {"choices":[{"delta":{"content":"Hel"}}]}', 'data: {"choices":[{"delta":{"content":"lo st"}}]}', 'data: {"choices":[{"delta":{"content":"ream"}}]}', 'data: [DONE]'];
        frames.forEach((f, i) => setTimeout(() => { res.write(f + '\n\n'); if (i === frames.length - 1) res.end(); }, 5));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'mock answer' } }], usage: { total_tokens: 42 } }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
});
await new Promise((r) => upstream.listen(UP_PORT, '127.0.0.1', r));

// ── Spawn the real relay/server ──────────────────────────────
const RELAY_PORT = UP_PORT + 1;
const proc = spawn(process.execPath, [join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT: String(RELAY_PORT), HOST: '127.0.0.1', NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
proc.stdout.on('data', (d) => (serverOut += d));
proc.stderr.on('data', (d) => (serverOut += d));
// wait for the listener — and PROVE this child actually bound the port
// (a stale orphaned server on the same port would otherwise answer with
// OLD code and poison every assertion in this suite).
let bound = false;
for (let i = 0; i < 60 && !bound; i++) {
  if (/already in use/.test(serverOut)) break;
  try { await fetch(`http://127.0.0.1:${RELAY_PORT}/api/health`, { signal: AbortSignal.timeout(500) }); bound = true; }
  catch { await sleep(150); }
}
if (!bound) {
  console.log('  ❌ spawned server did not bind port ' + RELAY_PORT + ' — orphaned process? Log: ' + serverOut.slice(-160));
  proc.kill();
  upstream.close();
  process.exit(1);
}

const RELAY = (path) => `http://127.0.0.1:${RELAY_PORT}${path}`;
const prox = (target) => RELAY('/api/ai-proxy?url=' + encodeURIComponent(target));

console.log('\n════════ LOCAL AI RELAY: health & mode ════════');
{
  const r = await fetch(RELAY('/api/health'));
  const j = await r.json().catch(() => ({}));
  check('GET /api/health responds', r.status === 200);
  check('health reports aiRelay: true (frontend auto-detects it)', j.aiRelay === true, JSON.stringify(j).slice(0, 120));
  check('health honestly reports internet availability (boolean)', typeof j.internet === 'boolean', JSON.stringify(j).slice(0, 120));
}

console.log('\n════════ LOCAL AI RELAY: allowlist enforcement ════════');
{
  const r = await fetch(prox('https://evil.example.com/v1/chat/completions'));
  const t = await r.text();
  check('unknown host is refused', r.status === 403 || r.status === 400, 'status=' + r.status);
  check('refusal names the allowlist honestly', /only forwards known AI providers/i.test(t), t.slice(0, 100));
  const r2 = await fetch(prox('https://integrate.api.nvidia.com/v1/secret-admin-panel'));
  const t2 = await r2.text();
  check('allowed host + DISALLOWED path is refused', (r2.status === 403 || r2.status === 400) && !t2.includes('secret-admin'), 'status=' + r2.status);
  const r3 = await fetch(RELAY('/api/ai-proxy?url=' + encodeURIComponent('file:///etc/passwd')));
  check('non-http(s) scheme refused without crashing', r3.status >= 400);
}

console.log('\n════════ LOCAL AI RELAY: real forwarding (mock provider on localhost) ════════');
{
  const target = `http://127.0.0.1:${UP_PORT}/v1/chat/completions`;
  const r = await fetch(prox(target), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nvapi-mock-key-123456' },
    body: JSON.stringify({ model: 'mock-large', messages: [{ role: 'user', content: 'hi' }] }),
  });
  const j = await r.json().catch(() => ({}));
  check('POST forwards through the relay to the local provider', r.status === 200 && j.choices?.[0]?.message?.content === 'mock answer', 'status=' + r.status);
  check('Authorization header survives the hop intact', upstreamLogs.some((l) => l.auth === 'Bearer nvapi-mock-key-123456'));
  const r401 = await fetch(prox(target), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
    body: JSON.stringify({ model: 'm', messages: [] }),
  });
  check('upstream 401 passes through as an error response (not a masked 200)', r401.status === 401, 'status=' + r401.status);

  const rm = await fetch(prox(`http://127.0.0.1:${UP_PORT}/v1/models`), { headers: { Authorization: 'Bearer nvapi-mock-key-123456' } });
  const jm = await rm.json().catch(() => ({}));
  check('GET /v1/models forwards (live model catalogs work locally)', rm.status === 200 && jm.data?.length === 2, 'status=' + rm.status);
}

console.log('\n════════ LOCAL AI RELAY: streaming (SSE) pipe ════════');
{
  const target = `http://127.0.0.1:${UP_PORT}/v1/chat/completions`;
  const r = await fetch(prox(target), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nvapi-mock-key-123456' },
    body: JSON.stringify({ model: 'mock-large', messages: [{ role: 'user', content: 'hi' }], stream: true }),
  });
  check('stream request accepted with event-stream content type', r.status === 200 && /event-stream/.test(r.headers.get('content-type') || ''), 'ct=' + r.headers.get('content-type'));
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let all = '';
  while (true) { const { done, value } = await reader.read(); if (done) break; all += dec.decode(value); }
  const deltas = [...all.matchAll(/"delta":\{"content":"([^"]+)"\}/g)].map((m) => m[1]).join('');
  check('SSE frames arrive in order, chunk by chunk', deltas === 'Hello stream', 'got: ' + JSON.stringify(deltas));
  check('stream terminates with [DONE]', all.includes('[DONE]'));
}

console.log('\n════════ LOCAL AI RELAY: body size cap ════════');
{
  const target = `http://127.0.0.1:${UP_PORT}/v1/chat/completions`;
  const big = JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'x'.repeat(600 * 1024) }] });
  let r = null;
  try {
    r = await fetch(prox(target), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nvapi-mock-key-123456' },
      body: big,
    });
  } catch (e) {
    console.log('  ⚠️ body-cap fetch error:', e.cause?.code || e.message);
    console.log('  ⚠️ server log tail:', JSON.stringify(serverOut.slice(-400)));
    r = await fetch(prox(target), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big }); // one retry on a fresh connection
  }
  check('request bodies over 512 KB are refused before forwarding', r.status === 413 || r.status === 400, 'status=' + r.status);
  const sawBig = upstreamLogs.some((l) => l.body.length > 550 * 1024);
  check('the oversized body never reached the upstream', !sawBig);
}

console.log('\n════════ LOCAL AI RELAY: key hygiene ════════');
{
  await sleep(200);
  check('API keys never appear in server logs', !serverOut.includes('nvapi-mock-key-123456'), serverOut.slice(-200));
  check('server log output stays small (bounded)', serverOut.length < 20000, serverOut.length + ' bytes');
}

console.log('\n════════ LOCAL AI RELAY: hardening batch 2 (cycles 41-50) ════════');
{
  const target = `http://127.0.0.1:${UP_PORT}/v1/chat/completions`;
  const rh = await fetch(RELAY('/api/health'));
  check('security headers present (nosniff, referrer, permissions-policy)',
    rh.headers.get('x-content-type-options') === 'nosniff' && !!rh.headers.get('referrer-policy') && !!rh.headers.get('permissions-policy'));
  const opt = await fetch(prox(target), { method: 'OPTIONS' });
  check('OPTIONS preflight → 204 with CORS headers', opt.status === 204 && (opt.headers.get('access-control-allow-methods') || '').includes('POST'));
  const ct = await fetch(prox(target), { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: '<b>x</b>' });
  check('non-JSON POST content-type refused with 415', ct.status === 415, 'status=' + ct.status);
  const lu = await fetch(prox('https://api.openai.com/v1/chat/completions?' + 'x'.repeat(2100)));
  check('relay target URLs over 2000 chars refused', lu.status === 400 || lu.status === 414, 'status=' + lu.status);
  const big = await fetch(RELAY('/api/ai-proxy?url=' + 'y'.repeat(9000)));
  check('absurd request URLs refused with 414', big.status === 414, 'status=' + big.status);
  const mk = await fetch(prox(target), { method: 'PUT' });
  check('PUT method refused with 405', mk.status === 405, 'status=' + mk.status);
  let got429 = false;
  for (let i = 0; i < 45; i++) {
    const r = await fetch(prox(target), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (r.status === 429) {
      got429 = true;
      const t = await r.text();
      check('rate-limit response names the limit + sends Retry-After', /Rate limit reached \(40/.test(t) && r.headers.get('retry-after') === '60');
      break;
    }
  }
  check('41st+ rapid relay call in a minute is rate-limited (429)', got429);
}

console.log('\n════════ LOCAL AI RELAY: static frontend served ════════');
{
  const r = await fetch(RELAY('/'));
  const t = await r.text();
  check('GET / serves the app HTML', r.status === 200 && t.includes('<!DOCTYPE html>'));
  check('served HTML contains the 50-scene library', (t.match(/sp\d+/g) || []).length >= 50, 'sp-hits=' + (t.match(/sp\d+/g) || []).length);
}

proc.kill();
upstream.close();
await sleep(150);

console.log('\n' + '═'.repeat(56));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('FAILED:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
