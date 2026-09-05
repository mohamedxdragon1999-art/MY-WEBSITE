// v0.0.1.1 OVERHAUL SUITE — pins the NEW behavior the overhaul added:
//   data-safety (heal + migrate + snapshot + headroom + flush-on-close),
//   modal accessibility (role/aria, focus restore, focus trap, Escape-close,
//   dynamic close-button labeling), the decorateA11y() pass, toasts announcing
//   to a live region, and the stream-stall watchdog.
//
// Run: node tests/test_overhaul.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTMLPATH = join(__dirname, '..', 'NexusCRM_V4_Hardened.html');
const html = readFileSync(HTMLPATH, 'utf-8');

const dom = new JSDOM(html, {
  url: 'http://localhost:3000/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.confirm = () => true;
    window.alert = () => {};
    try { Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true }); } catch (e) {}
    window.fetch = async () => { throw new TypeError('network disabled in overhaul: ' + url); };
    window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, fillText() {}, beginPath() {}, fill() {}, rect() {}, createLinearGradient: () => ({ addColorStop() {} }), roundRect: null });
  },
});
const { window } = dom;
const { document } = window;
const errors = [];
window.addEventListener('error', e => errors.push('window error: ' + e.message));
window.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason?.message || e.reason)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(300);

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + String(extra).slice(0, 200) : '')); }
}

console.log('\n═══ (A) DATA-SAFETY LAYER — constants & guards present in source ═══');
{
  check('schema version constant bumped to 2', /const\s+DB_SCHEMA_VERSION\s*=\s*2/.test(html));
  check('pre-migrate snapshot helper present', /function\s+snapshotDBForMigration/.test(html));
  check('workspace heal helper present', /function\s+healWorkspace/.test(html));
  check('serial heal+migrate+compact present', /function\s+migrateDB\(/.test(html));
  check('storage-footprint estimator present', /function\s+estimateDBBytes/.test(html));
  check('storage-headroom guard present', /function\s+checkStorageHeadroom/.test(html));
  check('immediate flush present', /function\s+flushSave\b/.test(html));
  check('pagehide+beforeunload flush guard attached', /__nx_flush_saved/.test(html) && /pagehide/.test(html) && /beforeunload/.test(html));
  check('esc is memoized (bounded cache)', /__escCache/.test(html));
  check('stream stall watchdog present (30s race)', /30000/.test(html) && /streamProviderDirect/.test(html) && /reader\.cancel/.test(html));
}

console.log('\n═══ (A2) F17 — browser SSE reader must not stall on frames that carry no delta ═══');
// Audit 2026-09-03 F17: a pull-based ReadableStream is only re-pulled after
// pull() enqueued something. The old reader forwarded only content deltas, so a
// role-only first chunk (NIM default), a reasoning chunk, a bare finish_reason or
// a lone `[DONE]` left the chat bubble spinning forever. Drive the REAL shipped
// reader with the 9 SSE shapes real providers send and require text + done.
{
  const extract = (name) => { const i = html.indexOf(`async function ${name}(`); const j = html.indexOf('\n}\n', i); return html.slice(i, j + 2); };
  const src = extract('streamProviderDirect');
  const g = { LOCAL_AI_RELAY: false, buildProviderRequest: () => ({ url: 'x', key: 'k', model: 'm', viaProxy: false }), friendlyFetchError: (e) => e,
    friendlyHttpError: async (r) => new Error('http ' + r.status), nxOfflineCheck: () => {}, nimMeta: () => ({ reasoning: false }) };
  const mk = new Function(...Object.keys(g), 'fetch', src.replace('async function streamProviderDirect', 'return async function streamProviderDirect'));
  const enc = new TextEncoder(), dec = new TextDecoder();
  const role = 'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n', c1 = 'data: {"choices":[{"delta":{"content":"Hi "}}]}\n\n',
    c2 = 'data: {"choices":[{"delta":{"content":"there"}}]}\n\n', fin = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    usage = 'data: {"choices":[],"usage":{"total_tokens":9}}\n\n', DONE = 'data: [DONE]\n\n', think = 'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}\n\n',
    empty = 'data: {"choices":[{"delta":{"content":""}}]}\n\n';
  const shapes = {
    'content, content, [DONE] separate': [c1, c2, DONE],
    'OpenAI: role | c1 | c2 | finish | [DONE]': [role, c1, c2, fin, DONE],
    'OpenAI stream_options: + usage frame': [role, c1, c2, fin, usage, DONE],
    'NIM: role | c1 | empty | c2 | finish+usage+[DONE] one packet': [role, c1, empty, c2, fin + DONE],
    'keep-alive comment between tokens': [c1, ': ping\n\n', c2, fin + DONE],
    'no [DONE] marker, EOF (vLLM/Ollama)': [c1, c2, fin],
    'everything in ONE packet': [role + c1 + c2 + fin + DONE],
    'reasoning chunk first (DeepSeek-R1 / Nemotron thinking)': [think, c1, c2, DONE],
    'inline <think> split across chunks': ['data: {"choices":[{"delta":{"content":"<thi"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"nk>plan</think>Hi "}}]}\n\n', c2, DONE],
  };
  for (const [label, chunks] of Object.entries(shapes)) {
    const fetch = async () => { let i = 0; const body = new ReadableStream({ async pull(c) { await new Promise(r => setTimeout(r, 3)); if (i < chunks.length) c.enqueue(enc.encode(chunks[i++])); else c.close(); } }); return { ok: true, status: 200, body }; };
    const streamProviderDirect = mk(...Object.values(g), fetch);
    const ws = { aiSettings: { provider: 'nvidia', nvidia_key: 'k' }, aiUsage: {} };
    const res = await streamProviderDirect(ws, [{ role: 'user', content: 'hi' }], '');
    const reader = res.body.getReader(); let full = '', gotDone = false, stalled = false, thinking = '';
    while (true) {
      const r = await Promise.race([reader.read(), new Promise(r2 => setTimeout(() => r2({ __t: true }), 1500))]);
      if (r.__t) { stalled = true; break; } if (r.done) break;
      for (const line of dec.decode(r.value).split('\n')) { if (!line.startsWith('data: ')) continue; const d = JSON.parse(line.slice(6)); if (d.delta) full += d.delta; if (d.thinking) thinking += d.thinking; if (d.done) gotDone = true; }
    }
    check('F17 no stall — ' + label, !stalled && gotDone && full === 'Hi there', `stalled=${stalled} done=${gotDone} text=${JSON.stringify(full)}`);
    if (label.startsWith('reasoning') || label.startsWith('inline')) check('F17 thinking relayed separately — ' + label, thinking.length > 0 && !full.includes('think'), `thinking=${JSON.stringify(thinking)}`);
  }
}

console.log('\n═══ (B) DATA-SAFETY — behavioral heal/migrate on a v1 DB ═══');
{
  const legacy = {
    users: [{ id: 'u1', email: 'a@b.com', salt: 's', passHash: 'h', name: 'A' }],
    workspaces: { u1: { contacts: [{ id: 1, name: 'Kept' }], deals: null, aiSettings: null, seq: null } },
    sessions: { tok: 'u1' },
  };
  const healed = window.healWorkspace(legacy.workspaces.u1);
  check('null deals healed to []', Array.isArray(healed.deals) && healed.deals.length === 0);
  check('null aiSettings healed to defaults', healed.aiSettings && typeof healed.aiSettings.model === 'string');
  check('null seq healed to {}', healed.seq && typeof healed.seq === 'object');
  check('absent arrays filled (tasks/aiMemory/invoices)', Array.isArray(healed.tasks) && Array.isArray(healed.aiMemory) && Array.isArray(healed.invoices));
  check('existing contact preserved', healed.contacts[0].name === 'Kept');
  // drive the real loadDB/migrateDB in a fresh pre-seeded DOM
  const mdom = new JSDOM(html, { url: 'http://localhost:3000/', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) {
    try { w.localStorage.setItem('nx_local_db_v1', JSON.stringify(legacy)); } catch (e) {}
    w.confirm = () => true; w.alert = () => {}; try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true, writable: true }); } catch (e) {}
    w.fetch = async () => { throw new TypeError('off'); };
    w.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, fillText() {}, beginPath() {}, fill() {}, rect() {}, createLinearGradient: () => ({ addColorStop() {} }), roundRect: null });
  } });
  await new Promise(r => setTimeout(r, 200));
  const mwin = mdom.window;
  const db = mwin.loadDB();
  check('loadDB stamps __v = 2', db.__v === 2, String(db.__v));
  check('migrate compacts malformed null fields', db.workspaces.u1.deals !== null);
  check('migrate snapshot written', typeof mwin.localStorage.getItem('nx_local_db_pre_migrate') === 'string');
  check('migrate heals absent arrays on load', Array.isArray(db.workspaces.u1.aiMemory));
  check('loadDB is idempotent (no data loss on refresh)', (() => { mwin.loadDB(); return mwin.loadDB().workspaces.u1.contacts[0].name === 'Kept'; })());
  // flushSave + headroom must not throw
  check('flushSave runs without throwing', (() => { try { mwin.flushSave(); return true; } catch (e) { return false; } })());
  check('checkStorageHeadroom runs without throwing', (() => { try { mwin.checkStorageHeadroom(); return true; } catch (e) { return false; } })());
}

console.log('\n═══ (C) MODAL ACCESSIBILITY ═══');
{
  // put focus on a page control so we can prove focus restoration
  const search = document.getElementById('global-search');
  if (search) search.focus();
  const focusBefore = document.activeElement;
  window.openModal('<div class="modal-title">A11y Modal</div><input id="m-field" placeholder="x"><button class="modal-close" onclick="window.closeModal()">×</button>');
  await sleep(120);
  const overlay = document.getElementById('modal-overlay');
  check('overlay opened', !!overlay);
  check('role=dialog', overlay && overlay.getAttribute('role') === 'dialog');
  check('aria-modal=true', overlay && overlay.getAttribute('aria-modal') === 'true');
  check('overlay has an accessible name (aria-label)', overlay && !!overlay.getAttribute('aria-label'));
  const closeBtn = overlay && overlay.querySelector('.modal-close');
  check('dynamically injected .modal-close got aria-label "Close dialog"', closeBtn && closeBtn.getAttribute('aria-label') === 'Close dialog');
  const field = overlay && overlay.querySelector('#m-field');
  check('first interactive control receives focus (focus landed in modal)', document.activeElement === field || (!!overlay && overlay.contains(document.activeElement)));
  check('focus did NOT stay on the page control behind the modal', document.activeElement !== focusBefore || !focusBefore);
  // Escape closes the modal
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(60);
  check('Escape closes the modal', !document.getElementById('modal-overlay'));
  // focus restored to the previously-focused control
  check('focus restored to prior control on close', document.activeElement === focusBefore || document.activeElement === search);
}

console.log('\n═══ (D) decorateA11y + toast live region ═══');
{
  window.decorateA11y();
  const sidebar = document.getElementById('sidebar');
  const main = document.getElementById('main');
  check('sidebar role=navigation + aria-label', sidebar && sidebar.getAttribute('role') === 'navigation' && !!sidebar.getAttribute('aria-label'));
  check('main role=main', main && main.getAttribute('role') === 'main');
  const labelled = [...document.querySelectorAll('[title]')].filter(el => el.hasAttribute('aria-label'));
  check('icon-only [title] controls labelled with aria-label', labelled.length > 0);
  check('live region #a11y-live created', !!document.getElementById('a11y-live'));
  window.toast('Overhaul announcement ✅', 'info', 4000);
  await sleep(80);
  const live = document.getElementById('a11y-live');
  check('toast announced to live region', live && live.textContent === 'Overhaul announcement ✅');
  check('live region holds plain text (inert)', live && live.children.length === 0);
  // decorateA11y idempotent
  window.decorateA11y(); window.decorateA11y();
  check('decorateA11y is idempotent (no duplicate #a11y-live)', document.querySelectorAll('#a11y-live').length === 1);
}

console.log('\n═══ (E) FRESH-LOGIN PATH runs decorateA11y ═══');
{
  // registering calls loginSuccess → decorateA11y. The topbar settings/AI icon
  // buttons carry only a title; after login they should now have aria-label.
  document.getElementById('reg-name').value = 'Overhaul';
  document.getElementById('reg-email').value = 'overhaul@test.com';
  document.getElementById('reg-password').value = 'password123';
  await window.doRegister();
  await sleep(250);
  const settingsBtn = [...document.querySelectorAll('[title="Settings"]')].find(el => el.hasAttribute('aria-label'));
  check('fresh login labelled the title-only Settings control', !!settingsBtn);
  const aiBtn = [...document.querySelectorAll('[title*="AI Assistant"]')].find(el => el.hasAttribute('aria-label'));
  check('fresh login labelled the AI Assistant control', !!aiBtn);
  check('auth screen hidden after login', document.getElementById('auth-screen').style.display === 'none');
}

console.log('\n═══ (F) NO RUNTIME ERRORS during overhaul ═══');
check('no window errors captured', errors.length === 0, errors.slice(0,3).join(' | '));

console.log('\n═════════════════════════════════════════════');
if (failed === 0) {
  console.log('✅ OVERHAUL SUITE: PASS — data-safety, modal a11y, decoration, and stream guard all pinned');
  console.log('RESULTS: ' + passed + ' passed, 0 failed');
  process.exit(0);
} else {
  console.log(`❌ OVERHAUL SUITE: ${passed} passed / ${failed} failed — ${failures.join(', ')}`);
  process.exit(1);
}
