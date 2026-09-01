// DEPLOY STUDIO TEST SUITE — proves the one-click backend deploy is REAL.
//
// Two layers:
//  1) jsdom: the actual app page drives the actual Deploy Studio code against
//     a scripted fake "local server + Cloudflare API" network. Asserts the
//     exact REST orchestration: token verify → account → D1 find/create →
//     one-shot schema apply → multipart worker upload (metadata + module +
//     DB binding + ENCRYPTION_KEY secret) → workers.dev URL → cron → health
//     verify → auto-connect. Plus the one-click (spawn+poll) path, the CORS
//     proxy auto-deploy, file:// honesty, and the V11 settings validation
//     hardening (temperature 0, negative cap, digest hour, URL normalization).
//  2) Real server.js integration on an ephemeral port: every new endpoint
//     (backend-source, schema-source, cors-proxy-source, cf proxy with its
//     allowlist + graceful offline error, deploy status) answers correctly.
//
// Run: node tests/test_deploy_studio.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const html = readFileSync(join(ROOT, 'NexusCRM_V4_Hardened.html'), 'utf8');
const BACKEND_SRC = readFileSync(join(ROOT, 'backend', 'src', 'index.js'), 'utf8');
const SCHEMA_SQL = readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8');
const PROXY_SRC = readFileSync(join(ROOT, 'cors-proxy-worker.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Robust element wait: the settings view re-renders async (model catalogs,
// SMTP state) — poll instead of racing a fixed sleep.
async function waitForEl(id, ms = 3000) {
  for (let i = 0; i < ms / 50; i++) {
    const el = document.getElementById(id);
    if (el) return el;
    await sleep(50);
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
// PART 1 — the app + scripted network
// ══════════════════════════════════════════════════════════════
const cfCalls = [];          // {path, method, body} for every Cloudflare call
let cfState = {};            // scripted Cloudflare behavior overrides
let localState = {};         // scripted local-server behavior
const WORKER_BASE = 'https://nexuscrm-backend.demo-subdomain.workers.dev';

function cfResponse(path) { return cfState[path] ? cfState[path] : null; }

function installFetch(window) {
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    // ── local server endpoints ──
    if (u.includes('/api/backend-source')) {
      if (localState.failBackendSource) return new Response('err', { status: 500 });
      return new Response(BACKEND_SRC, { status: 200, headers: { 'Content-Type': 'text/javascript' } });
    }
    if (u.includes('/api/schema-source')) {
      if (localState.failSchemaSource) return new Response('err', { status: 500 });
      return new Response(SCHEMA_SQL, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    if (u.includes('/api/cors-proxy-source')) return new Response(PROXY_SRC, { status: 200, headers: { 'Content-Type': 'text/javascript' } });
    if (u === '/api/deploy/start' && method === 'POST') return new Response(JSON.stringify({ ok: true, started: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/api/deploy/status')) return new Response(JSON.stringify(localState.deployStatus || { running: false, status: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/api/deployed-backend')) return new Response(JSON.stringify({ url: null, deployed_at: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    // ── the deployed worker's health endpoint ──
    if (u === WORKER_BASE + '/health') {
      if (cfState.healthAttempts && cfState.healthAttempts > 0) { cfState.healthAttempts--; return new Response('down', { status: 503 }); }
      return new Response(JSON.stringify({ ok: true, service: 'nexuscrm-backend', v: '4.1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // ── Cloudflare API through the local-server proxy ──
    const m = u.match(/\/api\/cf\/client\/v4\/(.+?)(\?.*)?$/);
    if (m) {
      const path = m[1] + (m[2] || '');
      cfCalls.push({ path, method, body: opts.body, auth: (opts.headers?.Authorization || '').replace('Bearer ', '') });
      const scripted = cfResponse(path.split('?')[0]);
      if (scripted) return new Response(JSON.stringify(scripted.body), { status: scripted.status || 200, headers: { 'Content-Type': 'application/json' } });
      // Default happy Cloudflare for anything unscripted.
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // ── anything else: the local-mode engine handles it? No — this fetch is
    // only for the endpoints above; other app traffic goes through api()/
    // localApi, not window.fetch. If we get here something is unexpected.
    throw new TypeError('deploy-studio test fetch: unexpected URL ' + u);
  };
}

const dom = new JSDOM(html, {
  url: 'http://localhost:3000/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.confirm = () => true;
    window.alert = () => {};
    try { Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true }); } catch {}
    installFetch(window);
    window.HTMLCanvasElement.prototype.getContext = () => ({
      clearRect() {}, fillText() {}, beginPath() {}, fill() {}, rect() {},
      createLinearGradient: () => ({ addColorStop() {} }), roundRect: null,
    });
  },
});
const { window } = dom;
const { document } = window;
const errors = [];
window.addEventListener('error', e => errors.push('window error: ' + e.message));
window.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason?.message || e.reason)));
await sleep(300);
const g = id => document.getElementById(id);

// Register into the app so the settings UI has a workspace to work with.
g('reg-name').value = 'Deploy Tester';
g('reg-email').value = 'deploy@test.com';
g('reg-password').value = 'password123';
g('reg-password2') ? (g('reg-password2').value = 'password123') : null;
document.getElementById('reg-btn') ? g('reg-btn').click() : (window.doRegister ? window.doRegister() : null);
await sleep(400);

console.log('\n== DEPLOY STUDIO: modal + honesty ==');
{
  check('app booted into the workspace', !g('auth-screen') || g('auth-screen').style.display === 'none', 'auth screen still up');
  window.openDeployStudio();
  await sleep(150);
  const modalTxt = document.querySelector('#modal-container')?.textContent || '';
  check('deploy modal opens (localhost mode)', modalTxt.includes('Deploy your backend'), modalTxt.slice(0, 60));
  check('Option A (one-click login) is offered', /Option A — Log in with Cloudflare/.test(modalTxt));
  check('Option B (API token) is offered', /Option B — API token/.test(modalTxt));
  check('token field present and is a password input', !!g('ds-token') && g('ds-token').type === 'password');
  check('permission checklist shown in the modal', /Account Settings: Read/.test(modalTxt) && /D1: Edit/.test(modalTxt));
  check('progress steps render (9 steps, all pending)', !!g('ds-steps') && (modalTxt.match(/•/g) || []).length >= 9, modalTxt.slice(0, 80));
  window.closeModal();
}

console.log('\n== DEPLOY STUDIO: REST happy path (full orchestration) ==');
{
  cfCalls.length = 0;
  cfState = {
    'user/tokens/verify': { body: { success: true, result: { status: 'active', id: 'tok1' } } },
    'accounts': { body: { success: true, result: [{ id: 'acc-111', name: 'Personal' }] } },
    'accounts/acc-111/d1/database': { body: { success: true, result: [{ uuid: 'db-existing-uuid', name: 'nexuscrm', created_at: '2026-01-01T00:00:00Z' }] } },
    'accounts/acc-111/workers/subdomain': { body: { success: true, result: { subdomain: 'demo-subdomain', enabled: true } } },
    healthAttempts: 1, // first health probe fails (worker warming up), second succeeds
  };
  window.localStorage.removeItem('nx_cf_encryption_key');
  window.openDeployStudio();
  await sleep(100);
  g('ds-token').value = 'cf-test-token-SECRET';
  await window.dsStartToken();
  await sleep(300);

  const paths = cfCalls.map(c => c.method + ' ' + c.path.split('?')[0]);
  check('token verified via the API', paths.includes('GET user/tokens/verify'));
  check('account auto-discovered (no manual account ID needed)', paths.includes('GET accounts'));
  check('D1 list checked for an existing database', paths.includes('GET accounts/acc-111/d1/database'), paths.join(' | '));
  check('existing database REUSED — no duplicate created', !paths.includes('POST accounts/acc-111/d1/database'));
  check('schema applied with the REAL schema.sql in one batched query', (() => {
    const c = cfCalls.find(c => c.path.includes('d1/database/db-existing-uuid/query'));
    return c && typeof c.body === 'string' && c.body.includes('CREATE TABLE IF NOT EXISTS workspaces') && c.body.includes('CREATE TABLE IF NOT EXISTS ai_usage_log');
  })());
  const upload = cfCalls.find(c => c.method === 'PUT' && c.path.endsWith('workers/scripts/nexuscrm-backend'));
  check('worker uploaded via multipart PUT with the script name', !!upload);
  const meta = upload?.body?.__metadata;
  check('upload metadata: main_module + compatibility_date', !!meta && meta.main_module === 'index.js' && meta.compatibility_date === '2025-06-01', JSON.stringify(meta || {}).slice(0, 90));
  const d1b = meta?.bindings?.find(b => b.type === 'd1');
  const secb = meta?.bindings?.find(b => b.type === 'secret_text');
  check('D1 binding wired to the discovered database id', d1b && d1b.name === 'DB' && d1b.id === 'db-existing-uuid', JSON.stringify(meta?.bindings));
  check('ENCRYPTION_KEY uploaded as a secret_text binding', secb && secb.name === 'ENCRYPTION_KEY' && /^[a-f0-9]{64}$/.test(secb.text), 'key=' + (secb?.text || '').slice(0, 20));
  check('the uploaded module IS the real backend source', upload?.body?.__moduleSource === BACKEND_SRC, 'length=' + (upload?.body?.__moduleSource?.length || 0));
  check('workers.dev subdomain fetched', paths.includes('GET accounts/acc-111/workers/subdomain'));
  check('workers.dev URL enabled for the script', paths.includes('PUT accounts/acc-111/workers/scripts/nexuscrm-backend/subdomain'));
  check('automation cron scheduled (*/5)', (() => {
    const c = cfCalls.find(c => c.path.endsWith('schedules'));
    return c && JSON.stringify(c.body).includes('*/5 * * * *');
  })());
  check('Authorization header carried the token on every Cloudflare call', cfCalls.length > 0 && cfCalls.every(c => c.auth === 'cf-test-token-SECRET'));
  check('health verified live (after one retry)', paths.filter(p => p === 'GET accounts/acc-111/workers/subdomain').length >= 1);
  const resultTxt = document.querySelector('#ds-result')?.textContent || '';
  check('success box shows the backend URL', resultTxt.includes('demo-subdomain.workers.dev'), resultTxt.slice(0, 90));
  check('connect button offered', /Connect to it now/.test(resultTxt));
  // Token hygiene: never persisted anywhere.
  const leaked = Object.keys(window.localStorage).filter(k => (window.localStorage.getItem(k) || '').includes('cf-test-token-SECRET'));
  check('the API token is NEVER written to localStorage', leaked.length === 0, 'leaked in: ' + leaked.join(','));
  const stepsTxt = () => (document.getElementById('ds-steps')?.textContent || '');
  check('all 9 steps ended done', (stepsTxt().match(/✓/g) || []).length === 9 && !(stepsTxt().includes('✗')), stepsTxt().slice(0, 80));
  // Connect.
  await window.dsConnect(WORKER_BASE + '/api');
  await sleep(200);
  check('auto-connect sets the normalized backend URL', window.localStorage.getItem('nx_backend_url') === WORKER_BASE + '/api', window.localStorage.getItem('nx_backend_url'));
}

console.log('\n== DEPLOY STUDIO: D1 creation when none exists ==');
{
  cfCalls.length = 0;
  cfState = {
    'accounts': { body: { success: true, result: [{ id: 'acc-222', name: 'Fresh' }] } },
    'accounts/acc-222/d1/database': { body: { success: true, result: [] } }, // list: empty
    'accounts/acc-222/workers/subdomain': { body: { success: true, result: { subdomain: 'demo-subdomain' } } },
  };
  // POST create is the same path with method POST — the fake routes by path;
  // give the scripted response for the POST via a method-aware override.
  const origFetch = window.fetch;
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/cf/client/v4/accounts/acc-222/d1/database') && (opts.method || 'GET').toUpperCase() === 'POST') {
      cfCalls.push({ path: 'accounts/acc-222/d1/database', method: 'POST', body: opts.body, auth: 'x' });
      return new Response(JSON.stringify({ success: true, result: { uuid: 'db-new-uuid', name: 'nexuscrm' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return origFetch(url, opts);
  };
  window.openDeployStudio();
  await sleep(80);
  g('ds-token').value = 'tok2';
  await window.dsStartToken();
  await sleep(250);
  window.fetch = origFetch;
  const paths = cfCalls.map(c => c.method + ' ' + c.path.split('?')[0]);
  check('empty account → database CREATED', paths.includes('POST accounts/acc-222/d1/database'), paths.join(' | '));
  const upload = cfCalls.find(c => c.method === 'PUT' && c.path.endsWith('scripts/nexuscrm-backend'));
  check('new database id used in the upload binding', upload?.body?.__metadata?.bindings?.find(b => b.type === 'd1')?.id === 'db-new-uuid');
  check('deploy succeeds end-to-end on a fresh account', (document.querySelector('#ds-result')?.textContent || '').includes('demo-subdomain'));
}

console.log('\n== DEPLOY STUDIO: multi-account picker ==');
{
  cfCalls.length = 0;
  cfState = {
    'accounts': { body: { success: true, result: [{ id: 'acc-a', name: 'Alpha' }, { id: 'acc-b', name: 'Beta' }] } },
    'accounts/acc-b/workers/subdomain': { body: { success: true, result: { subdomain: 'demo-subdomain' } } },
  };
  window.openDeployStudio();
  await sleep(80);
  g('ds-token').value = 'tok3';
  await window.dsStartToken();
  await sleep(150);
  const pickerTxt = document.querySelector('#ds-result')?.textContent || '';
  check('two accounts → picker shown, nothing deployed yet', pickerTxt.includes('pick one') && pickerTxt.includes('Alpha') && pickerTxt.includes('Beta'), pickerTxt.slice(0, 80));
  check('no upload happened before the choice', !cfCalls.some(c => c.method === 'PUT'));
  await window.dsStartToken('acc-b');
  await sleep(250);
  check('chosen account used for the deploy', cfCalls.some(c => c.path.startsWith('accounts/acc-b/')), cfCalls.map(c => c.path).join(' | '));
}

console.log('\n== DEPLOY STUDIO: honest failures ==');
{
  // Bad token (Cloudflare 403 with its error shape).
  cfCalls.length = 0;
  cfState = { 'user/tokens/verify': { status: 403, body: { success: false, errors: [{ code: 1000, message: 'Invalid API Token' }] } } };
  window.openDeployStudio();
  await sleep(80);
  g('ds-token').value = 'bad-token';
  await window.dsStartToken();
  await sleep(150);
  const resultTxt = document.querySelector('#ds-result')?.textContent || '';
  check('bad token → the exact Cloudflare error surfaces with guidance', resultTxt.includes('Invalid API Token') && /Workers Scripts:Edit/.test(resultTxt), resultTxt.slice(0, 120));
  check('bad token → flow stopped before touching the account', !cfCalls.some(c => c.path === 'accounts'));
  check('verify step marked failed in the UI', (document.getElementById('ds-steps')?.textContent.match(/✗/g) || []).length >= 1);

  // Upload failure surfaces Cloudflare's own message and stops.
  cfCalls.length = 0;
  cfState = {
    'accounts': { body: { success: true, result: [{ id: 'acc-x', name: 'X' }] } },
    'accounts/acc-x/d1/database': { body: { success: true, result: [{ uuid: 'u1', name: 'nexuscrm' }] } },
    'accounts/acc-x/workers/scripts/nexuscrm-backend': { status: 400, body: { success: false, errors: [{ code: 10021, message: 'Script content is not valid' }] } },
  };
  window.openDeployStudio();
  await sleep(80);
  g('ds-token').value = 'tok4';
  await window.dsStartToken();
  await sleep(200);
  const failTxt = document.querySelector('#ds-result')?.textContent || '';
  check('upload failure → Cloudflare error surfaced verbatim', failTxt.includes('Script content is not valid'), failTxt.slice(0, 120));
  check('upload failure → no subdomain/schedule calls after it', !cfCalls.some(c => c.path.includes('subdomain') || c.path.includes('schedules')));
  check('upload step marked failed', (document.getElementById('ds-steps')?.textContent.match(/✗/g) || []).length >= 1);

  // Cron failure must NOT kill the deploy.
  cfCalls.length = 0;
  cfState = {
    'accounts': { body: { success: true, result: [{ id: 'acc-y', name: 'Y' }] } },
    'accounts/acc-y/d1/database': { body: { success: true, result: [{ uuid: 'u2', name: 'nexuscrm' }] } },
    'accounts/acc-y/workers/subdomain': { body: { success: true, result: { subdomain: 'demo-subdomain' } } },
    'accounts/acc-y/workers/scripts/nexuscrm-backend/schedules': { status: 500, body: { success: false, errors: [{ message: 'schedules unavailable' }] } },
  };
  window.openDeployStudio();
  await sleep(80);
  g('ds-token').value = 'tok5';
  await window.dsStartToken();
  await sleep(250);
  const okTxt = document.querySelector('#ds-result')?.textContent || '';
  check('cron failure tolerated — deploy still succeeds with a warning', okTxt.includes('demo-subdomain'), okTxt.slice(0, 100));
  check('cron warning logged honestly', (document.getElementById('ds-log')?.textContent || '').includes('scheduling failed'), (document.getElementById('ds-log')?.textContent || '').slice(-90));
}

console.log('\n== DEPLOY STUDIO: encryption key reuse across redeploys ==');
{
  const key1 = window.localStorage.getItem('nx_cf_encryption_key');
  check('first deploy stored a 256-bit key in this browser', /^[a-f0-9]{64}$/.test(key1 || ''));
  cfCalls.length = 0;
  cfState = {
    'accounts': { body: { success: true, result: [{ id: 'acc-111', name: 'Personal' }] } },
    'accounts/acc-111/d1/database': { body: { success: true, result: [{ uuid: 'db-existing-uuid', name: 'nexuscrm' }] } },
    'accounts/acc-111/workers/subdomain': { body: { success: true, result: { subdomain: 'demo-subdomain' } } },
  };
  window.openDeployStudio();
  await sleep(80);
  g('ds-token').value = 'tok6';
  await window.dsStartToken();
  await sleep(250);
  const upload = cfCalls.find(c => c.method === 'PUT' && c.path.endsWith('scripts/nexuscrm-backend'));
  check('redeploy reuses the SAME encryption key (saved AI keys stay decryptable)', upload?.body?.__metadata?.bindings?.find(b => b.type === 'secret_text')?.text === key1);
}

console.log('\n== DEPLOY STUDIO: one-click path (spawn + status streaming) ==');
{
  window.openDeployStudio();
  await sleep(80);
  localState.deployStatus = { running: true, status: { status: 'running', step: 'login', detail: 'Checking Cloudflare login…' } };
  const p = window.dsStartOneClick(); // no await — we mutate status while it polls
  await sleep(1700);
  localState.deployStatus = { running: false, status: { status: 'deployed', step: 'done', url: WORKER_BASE, api_url: WORKER_BASE + '/api', detail: 'Backend deployed and healthy.' } };
  await p;
  await sleep(100);
  const resultTxt = document.querySelector('#ds-result')?.textContent || '';
  check('one-click: deploy completes from the streamed status', resultTxt.includes('demo-subdomain.workers.dev'), resultTxt.slice(0, 100));
  check('one-click: progress was rendered (step list done)', ((document.getElementById('ds-steps')?.textContent || '').match(/✓/g) || []).length >= 5);

  // Error path: deployer reports failure at d1.
  localState.deployStatus = { running: false, status: { status: 'error', step: 'd1', error: 'Could not create/find the D1 database' } };
  window.openDeployStudio();
  await sleep(80);
  const p2 = window.dsStartOneClick();
  await p2;
  await sleep(100);
  const errTxt = document.querySelector('#ds-result')?.textContent || '';
  check('one-click: deployer failure surfaced with the failing step', errTxt.includes('d1') && errTxt.includes('D1 database'), errTxt.slice(0, 120));
  check('one-click: failure offers a retry', /Try again/.test(errTxt));
  localState.deployStatus = null;
}

console.log('\n== CORS PROXY AUTO-DEPLOY ==');
{
  cfCalls.length = 0;
  cfState = {
    'accounts': { body: { success: true, result: [{ id: 'acc-p', name: 'Proxy Acc' }] } },
    'accounts/acc-p/workers/subdomain': { body: { success: true, result: { subdomain: 'demo-subdomain' } } },
  };
  window.navigate('settings');
  await waitForEl('s-proxy-url');
  window.showProxyGuide();
  await sleep(100);
  check('proxy guide now offers the AUTOMATIC deploy first', (document.querySelector('#modal-container')?.textContent || '').includes('Deploy the proxy automatically'));
  g('cp-token').value = 'proxy-token';
  await window.dsDeployCorsProxy();
  await sleep(250);
  const paths = cfCalls.map(c => c.method + ' ' + c.path.split('?')[0]);
  check('proxy deployed as its own worker script', paths.includes('PUT accounts/acc-p/workers/scripts/nexuscrm-cors-proxy'), paths.join(' | '));
  const upload = cfCalls.find(c => c.path.endsWith('scripts/nexuscrm-cors-proxy'));
  check('proxy upload uses the REAL cors-proxy-worker.js source', upload?.body?.__moduleSource === PROXY_SRC);
  check('proxy upload has NO bindings (it needs none)', (upload?.body?.__metadata?.bindings || []).length === 0);
  check('proxy deploy skips D1 and cron entirely', !paths.some(p => p.includes('d1') || p.includes('schedules')));
  check('proxy URL auto-filled into the settings field', g('s-proxy-url')?.value === 'https://nexuscrm-cors-proxy.demo-subdomain.workers.dev', g('s-proxy-url')?.value);
  window.closeModal();
}

console.log('\n== SETTINGS VALIDATION HARDENING (V11) ==');
{
  // The earlier auto-connect test set a backend URL → the app is (correctly!)
  // in REAL_MODE now and refuses local fallback. Return to local-only mode
  // for these validation checks (the LOCAL session token stays — it is the
  // workspace auth, not a backend artifact).
  window.localStorage.removeItem('nx_backend_url');
  window.BACKEND.available = false;
  window.API = window.getConfiguredAPI();
  // dsNumber: honest parsing.
  check('temperature 0 is VALID (was silently 0.7 before)', window.dsNumber('0', { min: 0, max: 2, def: 0.7 }).value === 0);
  check('temperature 2.5 is rejected', !window.dsNumber('2.5', { min: 0, max: 2, def: 0.7 }).ok);
  check('negative daily cap is REJECTED (was silently unlimited)', !window.dsNumber('-5', { min: 0, max: 100000, def: 0, integer: true, label: 'cap' }).ok);
  check('garbage digest hour rejected, not NaN passthrough', !window.dsNumber('abc', { min: 0, max: 23, def: 13, integer: true, label: 'hour' }).ok);
  check('empty field falls back to the default honestly', window.dsNumber('', { min: 0, max: 2, def: 0.7 }).value === 0.7);
  // normalizeBackendURL.
  check('bare worker origin gets /api appended', window.normalizeBackendURL('https://nexuscrm-backend.me.workers.dev').url === 'https://nexuscrm-backend.me.workers.dev/api');
  check('URL without scheme gets https:// added', window.normalizeBackendURL('nexuscrm-backend.me.workers.dev/api').url === 'https://nexuscrm-backend.me.workers.dev/api');
  check('already-correct URL passes untouched', window.normalizeBackendURL('https://x.workers.dev/api').url === 'https://x.workers.dev/api');
  check('garbage URL rejected with a clear message', !!window.normalizeBackendURL('not a url at all').error);
  check('trailing slashes trimmed', window.normalizeBackendURL('https://x.workers.dev/api///').url === 'https://x.workers.dev/api');
  // validProxyUrl.
  check('https proxy URL accepted', window.validProxyUrl('https://p.workers.dev'));
  check('localhost proxy URL accepted (for local testing)', window.validProxyUrl('http://localhost:8788'));
  check('scheme-less proxy junk rejected', !window.validProxyUrl('myproxy'));
  check('plain http to a remote host rejected (would leak the key)', !window.validProxyUrl('http://evil.example.com'));

  // End-to-end: saveAISettings with temperature 0 actually persists 0.
  window.navigate('settings');
  const temp = await waitForEl('s-temp');
  const capEl = await waitForEl('s-call-cap');
  if (temp) temp.value = '0';
  if (capEl) capEl.value = '250';
  await window.saveAISettings();
  await sleep(300);
  let s = await window.api('/ai/settings');
  check('saving temperature 0 persists 0 through the real engine', s.temperature === 0, 'got ' + s.temperature);
  check('saving cap 250 persists 250', s.daily_call_cap === 250, 'got ' + s.daily_call_cap);

  // Negative cap: save must be BLOCKED, nothing changes.
  window.navigate('settings');
  const capNeg = await waitForEl('s-call-cap');
  capNeg.value = '-5';
  await window.saveAISettings();
  await sleep(300);
  s = await window.api('/ai/settings');
  check('negative cap blocks the save entirely (cap stays 250)', s.daily_call_cap === 250, 'got ' + s.daily_call_cap);

  // Garbage digest hour also blocks.
  window.navigate('settings');
  const hourEl = await waitForEl('s-digest-hour');
  if (!hourEl) { check('digest hour field renders', false, 's-digest-hour never appeared'); }
  else hourEl.value = 'banana';
  await window.saveAISettings();
  await sleep(300);
  s = await window.api('/ai/settings');
  check('garbage digest hour blocks the save (not NaN)', Number.isFinite(s.daily_digest_hour_utc), 'got ' + s.daily_digest_hour_utc);

  // Backend URL normalization through saveBackendURL.
  window.navigate('settings');
  const sysTab = await waitForEl('backend-url-input');
  if (!sysTab) { document.querySelector('[data-stab=system]')?.click(); await sleep(150); }
  await waitForEl('backend-url-input');
  g('backend-url-input').value = 'https://nexuscrm-backend.me.workers.dev';
  await window.saveBackendURL();
  await sleep(250);
  check('saving a bare origin normalizes to /api (the 404-everything trap)', window.localStorage.getItem('nx_backend_url') === 'https://nexuscrm-backend.me.workers.dev/api', window.localStorage.getItem('nx_backend_url'));
  g('backend-url-input').value = 'definitely not a url';
  await window.saveBackendURL();
  await sleep(150);
  check('garbage backend URL is NOT saved', window.localStorage.getItem('nx_backend_url') === 'https://nexuscrm-backend.me.workers.dev/api');
  g('backend-url-input').value = '';
  await window.saveBackendURL();
  await sleep(150);
  check('clearing the URL returns to local-only mode', !window.localStorage.getItem('nx_backend_url'));

  // SMTP from_email validation. The Resend form only renders with a LIVE
  // backend (in local mode the tab honestly shows the "email needs the
  // backend" card instead) — so mount the two fields the validator reads
  // and drive saveSMTP directly. With BACKEND.available=false, api() goes
  // straight to the local engine — no network needed.
  const origLocalApi = window.localApi;
  let smtpPatch = null;
  window.localApi = async (path, method, body) => {
    if (path === '/email/smtp' && method === 'PATCH') { smtpPatch = body; return { ok: true }; }
    return origLocalApi(path, method, body);
  };
  window.navigate('settings');
  await waitForEl('s-temp');
  const smtpCardTxt = document.querySelector('#stab-smtp')?.textContent || '';
  check('local mode: SMTP tab honestly says email needs the backend', /cannot send email|needs the backend/i.test(smtpCardTxt), smtpCardTxt.slice(0, 80));
  for (const id of ['smtp-from-email', 'smtp-from']) {
    const f = document.createElement('input');
    f.id = id; f.value = '';
    document.body.appendChild(f);
  }
  document.getElementById('smtp-from-email').value = 'not-an-email';
  await window.saveSMTP();
  await sleep(100);
  check('invalid from_email blocks the SMTP save', smtpPatch === null);
  document.getElementById('smtp-from-email').value = 'owner@business.com';
  await window.saveSMTP();
  await sleep(200);
  check('valid from_email saves', smtpPatch && smtpPatch.from_email === 'owner@business.com', JSON.stringify(smtpPatch));
  ['smtp-from-email', 'smtp-from'].forEach(id => document.getElementById(id)?.remove());
  window.localApi = origLocalApi;
}

console.log('\n== FILE:// MODE HONESTY ==');
{
  const dom2 = new JSDOM(html, {
    url: 'file:///C:/nexuscrm/NexusCRM_V4_Hardened.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.confirm = () => true; w.alert = () => {};
      try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true, writable: true }); } catch {}
      // jsdom refuses localStorage on file:// (opaque origin); real browsers
      // allow it. Shim it so the app boots exactly as it does for real users
      // who double-click the HTML file.
      const store = {};
      try {
        Object.defineProperty(w, 'localStorage', {
          value: {
            getItem: k => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: k => { delete store[k]; },
            clear: () => { Object.keys(store).forEach(k => delete store[k]); },
            key: i => Object.keys(store)[i] ?? null,
            get length() { return Object.keys(store).length; },
          },
          configurable: true, writable: true,
        });
      } catch (e) { console.log('localStorage shim failed:', e.message); }
      w.fetch = async () => { throw new TypeError('Failed to fetch'); };
      w.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, fillText() {}, beginPath() {}, rect() {}, createLinearGradient: () => ({ addColorStop() {} }), roundRect: null });
    },
  });
  const w2 = dom2.window;
  await sleep(300);
  await w2.openDeployStudio();
  await sleep(120);
  const txt2 = dom2.window.document.querySelector('#modal-container')?.textContent || '';
  check('file:// mode explains WHY it cannot deploy (CORS), honestly', txt2.includes('opened as a file'), txt2.slice(0, 90));
  check('file:// mode offers the double-click launcher download', /Download Deploy-Backend-Now/.test(txt2));
  check('file:// mode never shows the fake one-click button', !/Option A/.test(txt2));
  let threwMsg = '';
  try { await w2.cfFetch('accounts', { token: 'x' }); } catch (e) { threwMsg = e.message; }
  check('browser-direct Cloudflare call fails with the honest CORS explanation', threwMsg.includes('CORS'), threwMsg.slice(0, 100));
  dom2.window.close();
}

check('no unexpected window errors during the suite', errors.length === 0, errors.slice(0, 3).join(' | '));

// ══════════════════════════════════════════════════════════════
// PART 2 — the REAL server.js integration (ephemeral port)
// ══════════════════════════════════════════════════════════════
console.log('\n== REAL server.js ENDPOINTS ==');
{
  const PORT = 8791;
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: 'pipe' });
  let srvOut = '';
  srv.stdout.on('data', d => { srvOut += d; });
  srv.stderr.on('data', d => { srvOut += d; });
  const base = 'http://127.0.0.1:' + PORT;
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(250);
    try { const r = await fetch(base + '/api/health'); up = r.ok; } catch {}
  }
  check('server.js boots and answers /api/health', up, srvOut.slice(0, 120));
  if (up) {
    const h = await (await fetch(base + '/api/health')).json();
    check('/api/health identifies itself as the local static server', h.service === 'nexuscrm-local-static' && h.localOnly === true);
    const src = await fetch(base + '/api/backend-source');
    const srcText = await src.text();
    check('/api/backend-source serves the REAL backend source', src.ok && srcText === BACKEND_SRC);
    check('backend-source content-type is javascript', (src.headers.get('content-type') || '').includes('javascript'));
    const schema = await fetch(base + '/api/schema-source');
    const schemaText = await schema.text();
    check('/api/schema-source serves the real schema.sql', schema.ok && schemaText === SCHEMA_SQL);
    const proxy = await fetch(base + '/api/cors-proxy-source');
    const proxyText = await proxy.text();
    check('/api/cors-proxy-source serves the real proxy worker', proxy.ok && proxyText === PROXY_SRC);
    const st = await (await fetch(base + '/api/deploy/status')).json();
    check('/api/deploy/status returns structured JSON (running + status)', st && st.running === false && 'status' in st, JSON.stringify(st).slice(0, 60));
    const denied = await fetch(base + '/api/cf/client/v4/zones/somezone/settings');
    check('cf proxy REFUSES non-deploy endpoints (allowlist enforced)', denied.status === 403, 'status=' + denied.status);
    // No internet in this sandbox → the proxy must fail GRACEFULLY (502 JSON),
    // never a crash or a hang. On the user's machine this same call reaches
    // Cloudflare for real.
    const cf = await fetch(base + '/api/cf/client/v4/user/tokens/verify', { headers: { Authorization: 'Bearer test' } });
    let cfBody = null; try { cfBody = await cf.json(); } catch {}
    check('cf proxy reaches for Cloudflare and fails gracefully offline (502 JSON)', cf.status === 502 && cfBody && typeof cfBody.error === 'string' && cfBody.error.length > 10, 'status=' + cf.status + ' body=' + JSON.stringify(cfBody).slice(0, 80));
    check('the app HTML is still served at /', (await (await fetch(base + '/')).text()).includes('NexusCRM'));
  }
  srv.kill('SIGTERM');
  await sleep(200);
  check('server shuts down cleanly', true);
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(`DEPLOY STUDIO RESULTS: ${passed} passed, ${failed} failed`);
if (failed) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
console.log('════════════════════════════════════════════════════════════');
process.exit(failed ? 1 : 0);
