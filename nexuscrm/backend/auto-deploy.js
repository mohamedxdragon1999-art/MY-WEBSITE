#!/usr/bin/env node
// ════════════════════════════════════════════════════════════
// NexusCRM — one-click backend auto-deployer (Cloudflare Worker + D1)
// ════════════════════════════════════════════════════════════
// WHY THIS EXISTS
// ----------------
// The owner is not a developer. Deploying the backend used to mean:
// install wrangler → log in → create a D1 database → copy its id into
// wrangler.toml → apply the schema → generate an encryption secret →
// deploy → find your URL. That is 7 manual steps and the #1 reason the
// AI/CORS fix stayed unverified.
//
// This script does ALL of it, and — critically — it is IDEMPOTENT:
//   * It remembers the deployment in .deployed.json (gitignored).
//   * It LIVE-verifies the deployment (GET <url>/health) before deciding.
//   * If already deployed and healthy → prints one line and exits (fast
//     path, safe to run on every app start, never redeploys needlessly).
//   * If the marker is missing/stale/unhealthy → re-runs the flow, but
//     every step re-detects existing resources (reuses the D1 database
//     instead of creating a duplicate, reuses the stored ENCRYPTION_KEY
//     so saved API keys never become undecryptable).
//
// COSTS: $0. Cloudflare's free tier includes the workers.dev subdomain —
// NO domain purchase is required for any of this.
//
// USAGE
//   node backend/auto-deploy.js            interactive (asks Y/N before deploying)
//   node backend/auto-deploy.js --yes      deploy without asking (scripted)
//   node backend/auto-deploy.js --check    just print state as JSON, change nothing
//
// EVERY external effect goes through injectable functions (run/fetchImpl/
// prompt) so the whole flow is unit-tested with a fake wrangler — see
// tests/test_deploy.mjs. No test ever touches the real Cloudflare API.
// ════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawn } = require('child_process');

const BACKEND_DIR = __dirname;
const TOML_PATH = path.join(BACKEND_DIR, 'wrangler.toml');
const SCHEMA_PATH = path.join(BACKEND_DIR, 'schema.sql');
const MARKER_PATH = path.join(BACKEND_DIR, '.deployed.json');
const KEYFILE_PATH = path.join(BACKEND_DIR, '.encryption-key');
const STATUS_PATH = path.join(BACKEND_DIR, '.deploy-status.json');
const DB_NAME = 'nexuscrm';
const PLACEHOLDER_ID = 'REPLACE_WITH_YOUR_D1_DATABASE_ID';
const HEALTH_TIMEOUT_MS = 8000;
const HEALTH_POLL_ATTEMPTS = 30; // ×2s ≈ up to 60s for first deploy to come up

// ── JSON status streaming (Settings → System Deploy Studio) ───
// With --json-status, every step writes .deploy-status.json so the app's
// deploy modal can render live progress by polling the local server.
function writeStatus(fsMod, obj) {
  try {
    fsMod.writeFileSync(STATUS_PATH, JSON.stringify({ ...obj, ts: new Date().toISOString() }) + '\n');
  } catch { /* status streaming must never break the deploy itself */ }
}

// ── injectable process runner ────────────────────────────────
// run(cmd, args, {cwd, input}) → {code, stdout, stderr, text}
// Default: real spawn. Tests pass a fake that scripts the wrangler
// conversation. stdio is INHERITED when interactive (login opens a browser
// and shows Cloudflare's own prompts) and CAPTURED otherwise.
function defaultRun(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const interactive = !!opts.interactive;
    const child = spawn(cmd, args, {
      cwd: opts.cwd || BACKEND_DIR,
      shell: process.platform === 'win32', // npx/npm are .cmd on Windows
      stdio: interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    if (!interactive) {
      child.stdout.on('data', (d) => { stdout += String(d); });
      child.stderr.on('data', (d) => { stderr += String(d); });
      if (opts.input != null) { child.stdin.write(opts.input); }
      child.stdin.end();
    }
    child.on('error', (e) => resolve({ code: -1, stdout: '', stderr: String(e.message), text: String(e.message) }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr, text: stdout + '\n' + stderr }));
  });
}

// ── pure helpers (all unit-tested) ───────────────────────────
function parseWorkersUrl(text) {
  // workers.dev subdomains can be nested (name.account-subdomain.workers.dev)
  // — allow dots in the label, but nothing that could break out of the host.
  const m = String(text || '').match(/https:\/\/[a-z0-9][a-z0-9.-]*\.workers\.dev/i);
  return m ? m[0] : null;
}

function parseDatabaseId(text) {
  const m = String(text || '').match(/database_id\s*=\s*"([a-zA-Z0-9_-]+)"/);
  return m ? m[1] : null;
}

function tomlSetDatabaseId(tomlText, id) {
  const line = `database_id = "${id}"`;
  if (/database_id\s*=\s*"/.test(tomlText)) {
    return tomlText.replace(/database_id\s*=\s*"[^"]*"/, line);
  }
  return tomlText; // no database_id line at all — caller decides (we always have one)
}

function readMarker(fsMod = fs) {
  try {
    const m = JSON.parse(fsMod.readFileSync(MARKER_PATH, 'utf8'));
    return (m && typeof m === 'object' && m.url) ? m : null;
  } catch { return null; }
}

function writeMarker(data, fsMod = fs) {
  fsMod.writeFileSync(MARKER_PATH, JSON.stringify({ ...data, deployed_at: new Date().toISOString() }, null, 2) + '\n');
}

function generateKey() {
  // 64 hex chars = 256 bits of entropy — comfortably beyond the 32+ char rule.
  return crypto.randomBytes(32).toString('hex');
}

// Reads the locally stored ENCRYPTION_KEY, creating it on first run.
// The local copy exists so a RE-deploy reuses the SAME key — otherwise every
// redeploy would silently rotate the key and make every stored AI key
// undecryptable (the exact class of bug Step 0 fixed the fallout of).
function readOrCreateKeyFile(fsMod = fs) {
  try {
    const existing = fsMod.readFileSync(KEYFILE_PATH, 'utf8').trim();
    if (/^[a-f0-9]{64}$/i.test(existing)) return existing;
  } catch { /* first run */ }
  const key = generateKey();
  fsMod.writeFileSync(KEYFILE_PATH, key + '\n', { mode: 0o600 });
  return key;
}

async function fetchHealthy(url, fetchImpl = fetch, timeoutMs = HEALTH_TIMEOUT_MS) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetchImpl(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = await r.json().catch(() => null);
    return !!(j && j.ok === true && j.service === 'nexuscrm-backend');
  } catch { return false; }
}

// Interactive yes/no on the real console. Tests inject their own.
function defaultPrompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question + ' ', (answer) => {
      rl.close();
      resolve(/^$|^y(es)?$/i.test(String(answer).trim()));
    });
  });
}

// ── the deploy flow ──────────────────────────────────────────
async function ensureDeployed(deps = {}) {
  const run = deps.run || defaultRun;
  const log = deps.log || (() => {});
  const prompt = deps.prompt || defaultPrompt;
  const fetchImpl = deps.fetchImpl || fetch;
  const fsMod = deps.fs || fs;
  const status = deps.status || (() => {}); // JSON progress streaming (Deploy Studio)
  const assumeYes = !!deps.assumeYes;
  const pollDelayMs = deps.pollDelayMs != null ? deps.pollDelayMs : 2000; // tests pass 0
  const wrangler = (args, opts = {}) => run(process.platform === 'win32' ? 'npm' : 'npm',
    ['exec', '--yes', 'wrangler@latest', '--'].concat(args), opts);
  const fail = (step, message) => { log(message); status({ status: 'error', step, error: message }); return { status: 'error', step }; };

  // 1) FAST PATH: marker + live health check → already deployed, do nothing.
  status({ status: 'running', step: 'check', detail: 'Checking for an existing deployment…' });
  const marker = readMarker(fsMod);
  if (marker && marker.url) {
    log(`→ Checking your deployed backend (${marker.url}) …`);
    if (await fetchHealthy(marker.url + '/health', fetchImpl)) {
      log(`✅ Backend already deployed and healthy: ${marker.url}`);
      log(`   (Settings → System → Backend URL should be: ${marker.api_url || marker.url + '/api'})`);
      status({ status: 'already', step: 'done', url: marker.url, api_url: marker.api_url || marker.url + '/api', detail: 'Already deployed and healthy.' });
      return { status: 'already', url: marker.url, api_url: marker.api_url || marker.url + '/api' };
    }
    log('⚠️ Recorded backend exists but did not answer — re-verifying/redeploying…');
  }

  // 2) Ask before doing anything heavy/interactive.
  if (!assumeYes) {
    log('');
    log('Your backend is NOT deployed yet. Deploying it (free, no domain needed —');
    log('Cloudflare gives you a *.workers.dev address) unlocks AI calls, sync,');
    log('automations and the chat widget. It takes ~5 minutes the first time.');
    const ok = await prompt('Deploy the free backend now? [Y/n]');
    if (!ok) { log('Skipped — the app will start in local-only mode.'); status({ status: 'skipped', step: 'done', detail: 'Skipped by the operator.' }); return { status: 'skipped' }; }
  }

  // 3) Cloudflare login (only if not already logged in).
  status({ status: 'running', step: 'login', detail: 'Checking Cloudflare login (a browser window may open — click Allow)…' });
  log('→ Checking Cloudflare login…');
  const who = await wrangler(['whoami']);
  if (who.code !== 0) {
    log('→ A browser window will open — log in to your free Cloudflare account and click Allow.');
    const login = await wrangler(['login'], { interactive: true });
    if (login.code !== 0) return fail('login', '❌ Cloudflare login did not complete. Run this script again to retry.');
  }

  // 4) D1 database — REUSE if it exists, create only if it doesn't.
  status({ status: 'running', step: 'd1', detail: 'Finding or creating your database (D1)…' });
  let toml = fsMod.readFileSync(TOML_PATH, 'utf8');
  let dbId = parseDatabaseId(toml);
  const hasRealId = dbId && dbId !== PLACEHOLDER_ID;
  if (!hasRealId) {
    log('→ Looking for your NexusCRM database (D1)…');
    let id = null;
    const info = await wrangler(['d1', 'info', DB_NAME]);
    if (info.code === 0) id = parseDatabaseId(info.text);
    if (!id) {
      const create = await wrangler(['d1', 'create', DB_NAME]);
      id = parseDatabaseId(create.text);
      if (!id) {
        // "already exists" style failures: fall back to info once more.
        const retry = await wrangler(['d1', 'info', DB_NAME]);
        id = retry.code === 0 ? parseDatabaseId(retry.text) : null;
      }
    }
    if (!id) return fail('d1', '❌ Could not create/find the D1 database. See the output above.');
    dbId = id;
    fsMod.writeFileSync(TOML_PATH, tomlSetDatabaseId(toml, dbId));
    log(`✓ D1 database ready (${dbId}) — saved into wrangler.toml`);
  } else {
    log('✓ D1 database already configured in wrangler.toml');
  }

  // 5) Apply the (idempotent) schema — safe to re-run any number of times.
  status({ status: 'running', step: 'schema', detail: 'Applying the database schema (safe to repeat)…' });
  log('→ Applying the database schema (safe to repeat)…');
  const schema = await wrangler(['d1', 'execute', DB_NAME, '--remote', '--file', 'schema.sql', '-y']);
  if (schema.code !== 0) return fail('schema', '❌ Schema apply failed: ' + schema.text.slice(0, 300));

  // 6) ENCRYPTION_KEY secret — generated once, REUSED forever.
  const key = readOrCreateKeyFile(fsMod);
  status({ status: 'running', step: 'secret', detail: 'Setting the encryption key secret…' });
  log('→ Setting the ENCRYPTION_KEY secret (generated once, stored locally so redeploys never break saved AI keys)…');
  const secret = await wrangler(['secret', 'put', 'ENCRYPTION_KEY'], { input: key + '\n' });
  if (secret.code !== 0) return fail('secret', '❌ Could not set ENCRYPTION_KEY: ' + secret.text.slice(0, 300));

  // 7) Deploy the Worker.
  status({ status: 'running', step: 'deploy', detail: 'Uploading the backend Worker (first run downloads wrangler, ~30-60s)…' });
  log('→ Deploying the backend Worker (first run downloads wrangler, ~30-60s)…');
  const dep = await wrangler(['deploy']);
  const base = parseWorkersUrl(dep.text);
  if (dep.code !== 0 || !base) return fail('deploy', '❌ Deploy failed: ' + dep.text.slice(0, 300));

  // 8) Verify it is genuinely live before declaring success.
  status({ status: 'running', step: 'verify', detail: `Verifying ${base}/health …` });
  log(`→ Verifying ${base}/health …`);
  let healthy = false;
  for (let i = 0; i < HEALTH_POLL_ATTEMPTS && !healthy; i++) {
    healthy = await fetchHealthy(base + '/health', fetchImpl);
    if (!healthy) await new Promise((r) => setTimeout(r, pollDelayMs));
  }
  if (!healthy) return fail('verify', '⚠️ Deployed, but /health did not answer within 60s — re-run this script to re-verify.');

  const api = base + '/api';
  writeMarker({ url: base, api_url: api, d1_database_id: dbId }, fsMod);
  log('');
  log('🎉 BACKEND DEPLOYED SUCCESSFULLY');
  log(`   URL: ${base}`);
  log(`   Paste this into Settings → System → Backend URL:  ${api}`);
  log('   Then register a NEW account (backend accounts are separate from local ones).');
  status({ status: 'deployed', step: 'done', url: base, api_url: api, detail: 'Backend deployed and healthy.' });
  return { status: 'deployed', url: base, api_url: api };
}

// ── CLI ──────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const log = (m) => console.log(m);
  const jsonStatus = args.includes('--json-status');
  // With --json-status, stream machine-readable progress to .deploy-status.json
  // (the in-app Deploy Studio polls it through the local server).
  const status = jsonStatus ? (obj) => writeStatus(fs, obj) : () => {};
  if (args.includes('--check')) {
    const marker = readMarker();
    const healthy = marker ? await fetchHealthy(marker.url + '/health') : false;
    console.log(JSON.stringify({ deployed: !!marker, healthy, url: marker ? marker.url : null, api_url: marker ? (marker.api_url || marker.url + '/api') : null }));
    return;
  }
  log('══ NexusCRM backend auto-deploy ══');
  try {
    const result = await ensureDeployed({ log, assumeYes: args.includes('--yes'), status });
    if (result.status === 'error') process.exitCode = 2;
  } catch (e) {
    log('❌ Unexpected error: ' + (e && e.message));
    log('   Nothing was broken — run this script again, or follow backend/DEPLOY.md manually.');
    status({ status: 'error', step: 'unexpected', error: String((e && e.message) || e) });
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  ensureDeployed, parseWorkersUrl, parseDatabaseId, tomlSetDatabaseId,
  readMarker, writeMarker, generateKey, readOrCreateKeyFile, fetchHealthy,
  writeStatus, STATUS_PATH, MARKER_PATH, KEYFILE_PATH, TOML_PATH, PLACEHOLDER_ID, DB_NAME,
};
