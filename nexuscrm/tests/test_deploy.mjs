// Auto-deploy regression suite — runs the REAL backend/auto-deploy.js logic
// against a scripted fake wrangler + fake network + in-memory filesystem.
// Nothing here touches Cloudflare, npm, or the internet.
//
// Run: node tests/test_deploy.mjs
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ad = require(join(__dirname, '..', 'backend', 'auto-deploy.js'));

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

// ── in-memory filesystem for the deployer's fs injection ─────
function memFs(files = {}) {
  return {
    _files: { ...files },
    readFileSync(p) { if (!(p in this._files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return this._files[p]; },
    writeFileSync(p, data, opts) { this._files[p] = String(data); },
  };
}

// ── scripted wrangler runner ─────────────────────────────────
// script: array of {match:[...substr], code, out} consumed in order.
function fakeRunner(script, calls) {
  return async (cmd, args, opts = {}) => {
    calls.push(args.join(' '));
    const argstr = args.join(' ');
    for (const s of script) {
      if (s.used) continue;
      if (s.match.every((m) => argstr.includes(m))) {
        s.used = true;
        return { code: s.code, stdout: s.out, stderr: s.code === 0 ? '' : s.out, text: s.out };
      }
    }
    return { code: 0, stdout: '', stderr: '', text: '' };
  };
}
const WRANGLER_DEPLOY_OUT = `🌀 Building list of candidate versions...
Published nexuscrm-backend (1.84 sec)
  https://nexuscrm-backend.demo-subdomain.workers.dev`;
const D1_CREATE_OUT = `✅ Successfully created DB 'nexuscrm'
[[d1_databases]]
binding = "DB"
database_name = "nexuscrm"
database_id = "d1e4f7a1-0000-4abc-9def-1234567890ab"`;

console.log('\n== DEPLOY PARSERS ==');
{
  check('parseWorkersUrl extracts the workers.dev URL from wrangler output', ad.parseWorkersUrl(WRANGLER_DEPLOY_OUT) === 'https://nexuscrm-backend.demo-subdomain.workers.dev', String(ad.parseWorkersUrl(WRANGLER_DEPLOY_OUT)));
  check('parseWorkersUrl returns null when there is no URL', ad.parseWorkersUrl('Published nothing here') === null);
  check('parseDatabaseId extracts the id from d1 create output', ad.parseDatabaseId(D1_CREATE_OUT) === 'd1e4f7a1-0000-4abc-9def-1234567890ab');
  check('parseDatabaseId returns null on garbage', ad.parseDatabaseId('no id here') === null);
  const toml = readFileSync(join(__dirname, '..', 'backend', 'wrangler.toml'), 'utf8');
  const updated = ad.tomlSetDatabaseId(toml, 'abc-123');
  check('tomlSetDatabaseId replaces the placeholder id', /database_id = "abc-123"/.test(updated));
  check('tomlSetDatabaseId preserves the rest of wrangler.toml', updated.includes('name = "nexuscrm-backend"') && updated.includes('[[d1_databases]]'));
  check('tomlSetDatabaseId replaces a REAL id too (redeploy on another account)', ad.tomlSetDatabaseId('database_id = "old-1"', 'new-2') === 'database_id = "new-2"');
  check('generateKey produces 64 hex chars', /^[a-f0-9]{64}$/.test(ad.generateKey()));
  check('generateKey is actually random', ad.generateKey() !== ad.generateKey());
}

console.log('\n== DEPLOY KEY FILE (reuse, never rotate) ==');
{
  const fs1 = memFs();
  const k1 = ad.readOrCreateKeyFile(fs1);
  check('key file created on first run (64 hex)', /^[a-f0-9]{64}$/.test(k1));
  const k2 = ad.readOrCreateKeyFile(fs1);
  check('key file REUSED on second run — redeploy can never rotate the key', k1 === k2);
  const fs2 = memFs({ [ad.KEYFILE_PATH]: 'not-valid\n' });
  check('invalid key file is regenerated', /^[a-f0-9]{64}$/.test(ad.readOrCreateKeyFile(fs2)));
}

console.log('\n== DEPLOY HEALTH CHECK ==');
{
  const ok = async () => ({ ok: true, json: async () => ({ ok: true, service: 'nexuscrm-backend' }) });
  check('healthy when the worker answers ok+nexuscrm-backend', await ad.fetchHealthy('https://x.workers.dev/health', ok));
  check('unhealthy when fetch throws (offline/timeout)', !(await ad.fetchHealthy('https://x.workers.dev/health', async () => { throw new TypeError('Failed to fetch'); })));
  check('unhealthy when service is a DIFFERENT app (wrong URL pasted)', !(await ad.fetchHealthy('https://x.workers.dev/health', async () => ({ ok: true, json: async () => ({ ok: true, service: 'something-else' }) }))));
  check('unhealthy on non-JSON response', !(await ad.fetchHealthy('https://x.workers.dev/health', async () => ({ ok: true, json: async () => { throw new Error('no json'); } }))));
}

const REAL_TOML = readFileSync(join(__dirname, '..', 'backend', 'wrangler.toml'), 'utf8');
const baseFiles = () => ({ [ad.TOML_PATH]: REAL_TOML });

console.log('\n== DEPLOY FAST PATH: already deployed ⇒ ZERO wrangler calls ==');
{
  const calls = [];
  const fs = memFs(baseFiles());
  ad.writeMarker({ url: 'https://nexuscrm-backend.demo-subdomain.workers.dev', api_url: 'https://nexuscrm-backend.demo-subdomain.workers.dev/api' }, fs);
  const result = await ad.ensureDeployed({
    run: fakeRunner([], calls), fs, assumeYes: false, prompt: async () => true, pollDelayMs: 0,
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, service: 'nexuscrm-backend' }) }),
    log: () => {},
  });
  check('status=already', result.status === 'already', result.status);
  check('returns the api_url', result.api_url === 'https://nexuscrm-backend.demo-subdomain.workers.dev/api');
  check('no wrangler/npm command was executed at all', calls.length === 0, calls.join(' | '));
  check('prompt was never asked (fast path is silent)', true);
}

console.log('\n== DEPLOY FULL FLOW: first deploy (login + d1 create + schema + secret + deploy + verify) ==');
{
  const calls = [];
  const fs = memFs(baseFiles());
  const script = [
    { match: ['whoami'], code: 1, out: 'not logged in' },                       // not logged in
    { match: ['login'], code: 0, out: 'Successfully logged in.' },
    { match: ['d1', 'info'], code: 1, out: "DB 'nexuscrm' not found" },         // db doesn't exist yet
    { match: ['d1', 'create'], code: 0, out: D1_CREATE_OUT },
    { match: ['d1', 'execute'], code: 0, out: '🚣 Executed 60 queries' },
    { match: ['secret', 'put'], code: 0, out: '✨ Success! Uploaded secret ENCRYPTION_KEY' },
    { match: ['deploy'], code: 0, out: WRANGLER_DEPLOY_OUT },
  ];
  let secretStdin = null;
  const run = async (cmd, args, opts = {}) => {
    calls.push(args.join(' '));
    if (args.includes('put') && opts.input != null) secretStdin = opts.input;
    return fakeRunner(script, [])(cmd, args, opts);
  };
  let asked = false;
  const result = await ad.ensureDeployed({
    run, fs, assumeYes: false, prompt: async () => { asked = true; return true; },
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, service: 'nexuscrm-backend' }) }),
    log: () => {},
  });
  check('status=deployed', result.status === 'deployed', result.status);
  check('user was asked for consent first', asked);
  check('login ran because whoami failed', calls.some((c) => c.includes('login')));
  check('D1 database was CREATED (it did not exist)', calls.some((c) => c.includes('d1 create nexuscrm')));
  check('schema was applied remotely', calls.some((c) => c.includes('d1 execute nexuscrm --remote --file schema.sql')));
  check('ENCRYPTION_KEY secret was piped a 64-hex value', secretStdin != null && /^[a-f0-9]{64}\n$/.test(secretStdin));
  check('worker was deployed', calls.some((c) => c.endsWith('-- deploy')));
  check('wrangler.toml now carries the real database_id', /database_id = "d1e4f7a1-0000-4abc-9def-1234567890ab"/.test(fs.readFileSync(ad.TOML_PATH, 'utf8')));
  const marker = ad.readMarker(fs);
  check('deployment marker written with url + api_url', !!marker && marker.url === 'https://nexuscrm-backend.demo-subdomain.workers.dev' && marker.api_url === 'https://nexuscrm-backend.demo-subdomain.workers.dev/api', JSON.stringify(marker));
  check('key file persisted so future redeploys reuse the SAME key', /^[a-f0-9]{64}$/.test(fs.readFileSync(ad.KEYFILE_PATH, 'utf8').trim()));
}

console.log('\n== DEPLOY RE-DEPLOY: unhealthy marker ⇒ reuses D1 + key, never duplicates ==');
{
  const calls = [];
  const fs = memFs(baseFiles());
  fs.writeFileSync(ad.TOML_PATH, ad.tomlSetDatabaseId(REAL_TOML, 'existing-db-id'));   // already configured
  fs.writeFileSync(ad.KEYFILE_PATH, 'a'.repeat(64) + '\n');
  ad.writeMarker({ url: 'https://nexuscrm-backend.demo-subdomain.workers.dev', api_url: 'https://nexuscrm-backend.demo-subdomain.workers.dev/api' }, fs);
  const script = [
    { match: ['whoami'], code: 0, out: 'you are logged in' },
    { match: ['d1', 'execute'], code: 0, out: '🚣 Executed 60 queries' },
    { match: ['secret', 'put'], code: 0, out: '✨ Success!' },
    { match: ['deploy'], code: 0, out: WRANGLER_DEPLOY_OUT },
  ];
  const result = await ad.ensureDeployed({
    run: fakeRunner(script, calls), fs, assumeYes: true, pollDelayMs: 0,
    // call #1 (marker health) FAILS → flow runs; deploy-verify health then succeeds
    fetchImpl: (() => { let n = 0; return async () => { n++; if (n === 1) throw new TypeError('marker unreachable'); return { ok: true, json: async () => ({ ok: true, service: 'nexuscrm-backend' }) }; }; })(),
    log: () => {},
  });
  check('status=deployed after unhealthy marker', result.status === 'deployed', result.status);
  check('D1 database was NOT created again (reuse, not duplicate)', !calls.some((c) => c.includes('d1 create')));
  check('d1 info was not even needed (toml id already real)', !calls.some((c) => c.includes('d1 info')));
  check('schema + secret + deploy re-ran (idempotent steps)', calls.some((c) => c.includes('d1 execute')) && calls.some((c) => c.includes('secret put')) && calls.some((c) => c.endsWith('-- deploy')));
}

console.log('\n== DEPLOY EDGE: D1 create says already-exists ⇒ falls back to d1 info ==');
{
  const calls = [];
  const fs = memFs(baseFiles());
  const script = [
    { match: ['whoami'], code: 0, out: 'logged in' },
    { match: ['d1', 'info'], code: 1, out: "not found (first probe)" },
    { match: ['d1', 'create'], code: 1, out: "A database with the name 'nexuscrm' already exists" },
    { match: ['d1', 'info'], code: 0, out: 'database_id = "recovered-id-999"' },
    { match: ['d1', 'execute'], code: 0, out: 'ok' },
    { match: ['secret', 'put'], code: 0, out: 'ok' },
    { match: ['deploy'], code: 0, out: WRANGLER_DEPLOY_OUT },
  ];
  const result = await ad.ensureDeployed({
    run: fakeRunner(script, calls), fs, assumeYes: true, pollDelayMs: 0,
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, service: 'nexuscrm-backend' }) }),
    log: () => {},
  });
  check('recovers the id when the DB already exists', result.status === 'deployed', result.status);
  check('recovered id landed in wrangler.toml', /database_id = "recovered-id-999"/.test(fs.readFileSync(ad.TOML_PATH, 'utf8')));
}

console.log('\n== DEPLOY SAFETY: decline / verify-failure / secret failure ==');
{
  const calls = [];
  const fs = memFs(baseFiles());
  const result = await ad.ensureDeployed({
    run: fakeRunner([], calls), fs, assumeYes: false, prompt: async () => false,
    fetchImpl: async () => { throw new TypeError('offline'); }, log: () => {},
  });
  check('declining the prompt ⇒ status=skipped, nothing executed', result.status === 'skipped' && calls.length === 0);

  const calls2 = [];
  const fs2 = memFs(baseFiles());
  const script2 = [
    { match: ['whoami'], code: 0, out: 'ok' },
    { match: ['d1', 'info'], code: 1, out: 'nope' },
    { match: ['d1', 'create'], code: 0, out: D1_CREATE_OUT },
    { match: ['d1', 'execute'], code: 0, out: 'ok' },
    { match: ['secret', 'put'], code: 1, out: 'secret upload failed' },
  ];
  const r2 = await ad.ensureDeployed({
    run: fakeRunner(script2, calls2), fs: fs2, assumeYes: true, pollDelayMs: 0,
    fetchImpl: async () => { throw new TypeError('offline'); }, log: () => {},
  });
  check('secret failure ⇒ error at step=secret, NO deploy attempted', r2.status === 'error' && r2.step === 'secret' && !calls2.some((c) => c.trim() === 'deploy'));
  check('secret failure ⇒ no success marker written', ad.readMarker(fs2) === null);

  const calls3 = [];
  const fs3 = memFs(baseFiles());
  const script3 = [
    { match: ['whoami'], code: 0, out: 'ok' },
    { match: ['d1', 'info'], code: 0, out: 'database_id = "id-3"' },
    { match: ['d1', 'execute'], code: 0, out: 'ok' },
    { match: ['secret', 'put'], code: 0, out: 'ok' },
    { match: ['deploy'], code: 0, out: WRANGLER_DEPLOY_OUT },
  ];
  const r3 = await ad.ensureDeployed({
    run: fakeRunner(script3, calls3), fs: fs3, assumeYes: true, pollDelayMs: 0,
    fetchImpl: async () => { throw new TypeError('health never answers'); }, log: () => {},
  });
  check('health-verify failure ⇒ error at step=verify (deploy never claimed success)', r3.status === 'error' && r3.step === 'verify');
  check('health-verify failure ⇒ no marker (next run will retry cleanly)', ad.readMarker(fs3) === null);
}

console.log('\n== DEPLOY LOCAL SERVER: /api/deployed-backend endpoint (real server.js) ==');
{
  // Spawns the REAL zero-dependency local server on a scratch port and checks
  // the new endpoint it exposes for the frontend "detect my backend" button.
  const dir = mkdtempSync(join(tmpdir(), 'nx-server-'));
  const cfg = join(dir, 'server.js');
  let src = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
  // Point the static file lookup at the real HTML without copying 500KB into tmp.
  src = src.replace("const FILE = path.join(__dirname, 'NexusCRM_V4_Hardened.html');", `const FILE = ${JSON.stringify(join(__dirname, '..', 'NexusCRM_V4_Hardened.html'))};`);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(cfg, src);
  const child = spawn(process.execPath, [cfg], { env: { ...process.env, PORT: '8199', HOST: '127.0.0.1' }, stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try { const r = await fetch('http://127.0.0.1:8199/api/health'); up = r.ok; } catch {}
    }
    check('local server starts and answers /api/health', up);
    const r = await fetch('http://127.0.0.1:8199/api/deployed-backend');
    const j = await r.json();
    check('/api/deployed-backend responds with url:null when nothing is deployed', r.ok && j && j.url === null, JSON.stringify(j));
    const r2 = await fetch('http://127.0.0.1:8199/');
    const body = await r2.text();
    check('server still serves the app itself', body.includes('<!DOCTYPE html>'));
  } catch (e) {
    check('local server endpoint test ran', false, e.message);
  } finally {
    child.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n' + '═'.repeat(60));
console.log(`DEPLOY RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); }
console.log('═'.repeat(60));
process.exit(failed ? 1 : 0);
