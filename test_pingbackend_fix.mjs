// Focused regression test for the local-server-detection fix, WITHOUT
// needing jsdom (which isn't installable here — see test_frontend.mjs for
// the full-DOM smoke test that needs it). This extracts the actual
// pingBackend() and realFetch() function source directly out of
// NexusCRM_V4_Hardened.html and executes it for real in an isolated
// Node vm context with a mocked fetch — so this tests the real shipped
// code, not a reimplementation of what it's supposed to do.
//
// Run: node test_pingbackend_fix.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'NexusCRM_V4_Hardened.html'), 'utf-8');

function extractFunction(name) {
  const m = html.match(new RegExp(`async function ${name}\\([^)]*\\) \\{`));
  if (!m) throw new Error(`Could not find function ${name} in the HTML — has it been renamed or removed?`);
  const start = m.index;
  let depth = 0, i = start;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

const pingBackendSrc = extractFunction('pingBackend');
const realFetchSrc = extractFunction('realFetch');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✅', msg); }
  else { fail++; console.log('  ❌ FAIL:', msg); }
}

function runScenario(label, fetchImpl, run) {
  console.log(`\n== ${label} ==`);
  const sandbox = {
    BACKEND: { available: null, checked: 0 },
    API: 'http://127.0.0.1:8080/api',
    STATE: { token: null },
    REAL_MODE: () => true,
    pingTimer: null,
    doLogout: () => { sandbox.__loggedOut = true; },
    fetch: fetchImpl,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
    Error,
    __loggedOut: false,
  };
  vm.createContext(sandbox);
  vm.runInContext(pingBackendSrc + '\n' + realFetchSrc, sandbox);
  return run(sandbox);
}

// ── Scenario 1: the exact bug — local static server.js answering /health ──
await runScenario(
  "Bundled local server.js's /health response must NOT be treated as a real backend",
  async (url) => {
    if (url.endsWith('/health')) {
      return new Response(JSON.stringify({ ok: true, service: 'nexuscrm-local-static', localOnly: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // Simulates server.js's catch-all: ANY other path gets the HTML file back with 200.
    return new Response('<!DOCTYPE html><html>...whole app...</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  },
  async (sandbox) => {
    await vm.runInContext('pingBackend()', sandbox);
    assert(sandbox.BACKEND.available === false, `BACKEND.available should be false when localOnly:true, got ${sandbox.BACKEND.available}`);

    // Even if something upstream still tried to route a real call here,
    // realFetch() itself must refuse to treat the HTML response as {}.
    let threw = false, msg = '';
    try { await vm.runInContext("realFetch('/contacts', 'GET')", sandbox); }
    catch (e) { threw = true; msg = e.message; }
    assert(threw, 'realFetch must throw on a non-JSON 200 response, not silently return {}');
    assert(/non-JSON/.test(msg), `error message should explain it's a non-JSON response, got: "${msg}"`);
    assert(sandbox.BACKEND.available === false, 'realFetch should also flip BACKEND.available to false on detecting this');
  }
);

// ── Scenario 2: a real deployed backend must still be detected correctly ──
await runScenario(
  'A real backend (no localOnly flag) must be detected as available',
  async (url) => {
    if (url.endsWith('/health')) {
      return new Response(JSON.stringify({ ok: true, service: 'nexuscrm-backend' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ contacts: [], total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
  async (sandbox) => {
    await vm.runInContext('pingBackend()', sandbox);
    assert(sandbox.BACKEND.available === true, `BACKEND.available should be true for a real backend, got ${sandbox.BACKEND.available}`);

    const data = await vm.runInContext("realFetch('/contacts', 'GET')", sandbox);
    assert(data && data.total === 0, 'realFetch should return real parsed JSON data for a genuine API response');
  }
);

// ── Scenario 3: real backend down entirely (connection refused) ──
await runScenario(
  'A configured backend that is completely unreachable must not silently look local',
  async () => { throw new TypeError('fetch failed'); },
  async (sandbox) => {
    await vm.runInContext('pingBackend()', sandbox);
    assert(sandbox.BACKEND.available === false, 'BACKEND.available should be false when the fetch itself throws');
  }
);

console.log(`\n${'='.repeat(50)}\n${pass} passed, ${fail} failed\n${'='.repeat(50)}`);
// pingBackend() schedules a real 15s retry timer on failure (by design,
// for the real app) — force immediate exit here rather than let the test
// process hang waiting on it.
process.exit(fail > 0 ? 1 : 0);
