// ════════════════════════════════════════════════════════════
// NexusCRM — zero-dependency local server
// Serves the single-file app on http://127.0.0.1:8080 and opens
// your browser automatically. Launch it with Start-NexusCRM.bat
// (Windows) or:  node server.js
// ════════════════════════════════════════════════════════════
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 8080;
// Default stays loopback-only (nothing else on your machine/network can
// reach it). Set HOST=0.0.0.0 only in sandboxed/preview environments.
const HOST = process.env.HOST || '127.0.0.1';
const FILE = path.join(__dirname, 'NexusCRM_V4_Hardened.html');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT);

  // Health check (the app pings /api/health to detect a "backend" —
  // this local server only reports healthy, it does NOT provide the API).
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, service: 'nexuscrm-local-static', localOnly: true }));
    return;
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
  const msg =
    '\n' +
    '  ┌────────────────────────────────────────────────────────┐\n' +
    '  │  🚀 NexusCRM is running!                               │\n' +
    '  │  Open:  http://127.0.0.1:' + String(PORT).padEnd(46) + '│\n' +
    '  │  (Your browser should open automatically)              │\n' +
    '  │  Local-only mode: data stays in this browser.          │\n' +
    '  │  For syncing + automations + AI streaming, deploy the  │\n' +
    '  │  backend (backend/DEPLOY.md) and set it in Settings.   │\n' +
    '  └────────────────────────────────────────────────────────┘\n';
  console.log(msg);
  const url = 'http://127.0.0.1:' + PORT;
  try {
    if (process.platform === 'win32') exec('start "" ' + url);
    else if (process.platform === 'darwin') exec('open ' + url);
    else exec('xdg-open ' + url + ' || sensible-browser ' + url + ' || true');
  } catch { /* browser open failed — user can open manually */ }
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
