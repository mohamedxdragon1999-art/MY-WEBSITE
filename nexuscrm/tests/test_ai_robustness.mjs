// AI-feature robustness suite — company-grade adversarial/property/golden
// testing for the automation brain (workflow builder) and sentiment,
// with ZERO new npm dependencies (randomized-loop property tests instead
// of fast-check, per the project rule).
//
// Covers the BACKEND worker (via HTTP with a scripted fake provider) and the
// FRONTEND's local builders (via jsdom).
//
// Run: node tests/test_ai_robustness.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { init, DB } = require('./d1mock.js');
await init(readFileSync(join(__dirname, '..', 'backend', 'schema.sql'), 'utf8'));

const worker = (await import(join(__dirname, '..', 'backend', 'src', 'index.js'))).default;
const internals = (await import(join(__dirname, '..', 'backend', 'src', 'index.js'))).__internals;

const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 }; // limits tested explicitly in test_fuzz.mjs
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
const BASE = 'http://test.local';

// ── Scripted fake AI provider ────────────────────────────────
// Each AI call pops the next scripted reply (last one repeats).
// aiCalls counts provider POSTs so tests can assert call-count caps.
let aiScript = [];
let aiCalls = 0;
let aiFailHard = false; // provider completely down (network error)
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('api.openai.com') || u.includes('integrate.api.nvidia.com') || u.includes('localhost:11434')) {
    aiCalls++;
    if (aiFailHard) throw new TypeError('fetch failed — provider unreachable');
    const content = aiScript.length > 1 ? aiScript.shift() : aiScript[0];
    return new Response(JSON.stringify({
      choices: [{ message: { content: content ?? 'FAKE_AI_RESPONSE' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('<html><body>ok</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
};

// ── Helpers ──────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 160) : '')); }
}

async function call(method, path, body, token) {
  const r = await worker.fetch(new Request(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === null || body === undefined ? undefined : JSON.stringify(body),
  }), env, ctx);
  let data = null;
  try { data = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, data };
}

// Deterministic PRNG so property-test failures are reproducible.
let seed = 0xC0FFEE;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));
function randStr(len) { let s = ''; const CH = 'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"{}[]:,\\/_-'; while (s.length < len) s += CH[Math.floor(rnd() * CH.length)]; return s; }

// ── Boot: one workspace with an AI key + some data for context ──
const reg = await call('POST', '/auth/register', { name: 'Robo Tester', email: 'robo@test.io', password: 'password123' });
const token = reg.data?.token;
check('workspace registered for robustness suite', !!token);
await call('PATCH', '/ai/settings', { provider: 'nvidia', nvidia_key: 'nvapi-test-key-123456' }, token);
for (let i = 0; i < 3; i++) await call('POST', '/contacts', { name: 'Contact ' + i, email: 'c' + i + '@x.io' }, token);

// ══════════════════════════════════════════════════════════════
console.log('\n== GOLDEN: workflow builder happy path (full vocabulary prompt) ==');
{
  aiCalls = 0; aiFailHard = false;
  aiScript = [JSON.stringify({
    name: 'Welcome sequence',
    trigger: 'trigger_link',
    steps: [
      { action: 'send_email', note: 'Welcome email', delay_hours: 2 },
      { action: 'send_review_request', note: 'Ask for a review' },
    ],
  })];
  const r = await call('POST', '/ai/build-workflow', { goal: 'when someone clicks my trigger link, welcome them and ask for a review' }, token);
  const wf = r.data?.workflow;
  check('golden: workflow returned', r.status === 200 && !!wf);
  check('golden: AI result is live:true (real AI, not fallback)', wf?.live === true);
  check('golden: trigger_link trigger preserved (was hidden from old prompt)', wf?.trigger === 'trigger_link');
  check('golden: send_review_request action preserved (was hidden from old prompt)', wf?.steps?.some(s => s.action === 'send_review_request'));
  check('golden: exactly ONE provider call when the first reply is valid', aiCalls === 1, 'aiCalls=' + aiCalls);
  check('golden: delay_hours preserved', wf?.steps?.[0]?.delay_hours === 2);
}

// ══════════════════════════════════════════════════════════════
console.log('\n== REPAIR: one correction pass when the AI returns junk ==');
{
  aiCalls = 0; aiFailHard = false;
  aiScript = [
    'Sure! Here is a workflow: first send an email, then create a task. Hope that helps!', // no JSON at all
    JSON.stringify({ name: 'Fixed', trigger: 'new_contact', steps: [{ action: 'create_task', note: 'Follow up' }] }),
  ];
  const r = await call('POST', '/ai/build-workflow', { goal: 'follow up with new leads' }, token);
  const wf = r.data?.workflow;
  check('repair: junk → repaired on 2nd call', r.status === 200 && wf?.live === true && wf?.name === 'Fixed');
  check('repair: exactly TWO provider calls (original + one repair, no loops)', aiCalls === 2, 'aiCalls=' + aiCalls);
}

// ══════════════════════════════════════════════════════════════
console.log('\n== REPAIR CAP: junk twice → honest fallback, still bounded ==');
{
  aiCalls = 0; aiFailHard = false;
  aiScript = ['I cannot answer that.', 'Still no JSON, sorry!'];
  const r = await call('POST', '/ai/build-workflow', { goal: 'email new customers a welcome and create a task' }, token);
  const wf = r.data?.workflow;
  check('cap: no third call after failed repair (max 2 provider calls)', aiCalls === 2, 'aiCalls=' + aiCalls);
  check('cap: returns a VALID fallback workflow, not an error', r.status === 200 && Array.isArray(wf?.steps) && wf.steps.length >= 1);
  check('cap: fallback is honest (live:false)', wf?.live === false);
  check('cap: fallback explains WHY (reason present)', typeof wf?.reason === 'string' && wf.reason.length > 0, wf?.reason);
  check('cap: keyword fallback still designed the goal (send_email present)', wf?.steps?.some(s => s.action === 'send_email'));
}

// ══════════════════════════════════════════════════════════════
console.log('\n== PROVIDER DOWN: network failure → graceful keyword fallback ==');
{
  aiCalls = 0; aiFailHard = true;
  const r = await call('POST', '/ai/build-workflow', { goal: 'when an invoice is paid, create a task to say thanks' }, token);
  const wf = r.data?.workflow;
  check('down: no 500 — endpoint still answers', r.status === 200);
  check('down: honest live:false + reason', wf?.live === false && !!wf?.reason);
  check('down: keyword fallback picked invoice_paid trigger', wf?.trigger === 'invoice_paid');
  check('down: task step present from keywords', wf?.steps?.some(s => s.action === 'create_task'));
  aiFailHard = false;
}

// ══════════════════════════════════════════════════════════════
console.log('\n== ADVERSARIAL: malicious/absurd drafts are neutralized by the validator ==');
{
  const adversarial = [
    { label: 'unknown trigger', draft: { name: 'X', trigger: 'DROP TABLE users;--', steps: [{ action: 'create_task', note: 'ok' }] }, expectTrigger: 'manual' },
    { label: 'unknown action', draft: { name: 'X', trigger: 'manual', steps: [{ action: 'rm -rf /', note: 'evil' }] }, expectOk: false },
    { label: '50 steps flood', draft: { name: 'X', trigger: 'manual', steps: Array.from({ length: 50 }, () => ({ action: 'create_task', note: 'spam' })) }, expectMax: 6 },
    { label: 'negative delay', draft: { name: 'X', trigger: 'manual', steps: [{ action: 'create_task', note: 'ok', delay_hours: -500 }] }, expectOk: false },
    { label: 'absurd delay', draft: { name: 'X', trigger: 'manual', steps: [{ action: 'create_task', note: 'ok', delay_hours: 999999 }] }, expectOk: false },
    { label: 'update_stage without stage', draft: { name: 'X', trigger: 'manual', steps: [{ action: 'update_stage', note: 'ok' }] }, expectOk: false },
    { label: 'steps is a string', draft: { name: 'X', trigger: 'manual', steps: 'not-an-array' }, expectOk: false },
    { label: 'null draft', draft: null, expectOk: false },
    { label: 'prototype pollution attempt', draft: { name: 'X', trigger: 'manual', steps: [{ action: 'create_task', note: 'ok', __proto__: { x: 1 } }] }, expectOk: true },
    { label: 'note way too long', draft: { name: 'X', trigger: 'manual', steps: [{ action: 'create_task', note: 'A'.repeat(50000) }] }, expectOk: true, noteMax: 500 },
  ];
  for (const a of adversarial) {
    let v;
    try { v = internals.validateWorkflowDraft(a.draft, 'goal'); } catch (e) { check('adversarial "' + a.label + '": validator never throws', false, e.message); continue; }
    if (a.expectTrigger !== undefined) check('adversarial "' + a.label + '": trigger coerced to ' + a.expectTrigger, v.workflow.trigger === a.expectTrigger);
    if (a.expectOk !== undefined) check('adversarial "' + a.label + '": ok=' + a.expectOk, v.ok === a.expectOk, 'errors=' + JSON.stringify(v.errors).slice(0, 80));
    if (a.expectMax !== undefined) check('adversarial "' + a.label + '": steps capped at ' + a.expectMax, v.workflow.steps.length <= a.expectMax);
    if (a.noteMax !== undefined) check('adversarial "' + a.label + '": note truncated to ' + a.noteMax, v.workflow.steps.every(s => s.note.length <= a.noteMax));
    // Even a rejected draft must yield a SAVEABLE workflow (no crash downstream).
    check('adversarial "' + a.label + '": sanitized workflow still structurally valid',
      Array.isArray(v.workflow.steps) && internals.WORKFLOW_TRIGGERS.includes(v.workflow.trigger) &&
      v.workflow.steps.every(s => internals.WORKFLOW_ACTIONS.includes(s.action)));
  }
}

// ══════════════════════════════════════════════════════════════
console.log('\n== PROPERTY: 400 random drafts — validator is total and crash-free ==');
{
  const garbageKinds = ['valid-ish', 'wrong types', 'random strings', 'nested junk'];
  let accepted = 0, rejected = 0, crashes = 0;
  let invariantHeld = true;
  for (let i = 0; i < 400; i++) {
    const kind = pick(garbageKinds);
    let draft;
    if (kind === 'valid-ish') {
      draft = {
        name: randStr(randInt(0, 30)),
        trigger: pick([...internals.WORKFLOW_TRIGGERS, 'garbage', '', undefined, randStr(8)]),
        steps: Array.from({ length: randInt(0, 9) }, () => ({
          action: pick([...internals.WORKFLOW_ACTIONS, 'hack', randStr(6)]),
          note: randStr(randInt(0, 600)),
          delay_hours: pick([randInt(-100, 900), undefined, 'later', null, 3.5]),
          stage: pick([...internals.CONTACT_STAGES, 'zzz']),
        })),
      };
    } else if (kind === 'wrong types') {
      draft = pick([{ name: 42, trigger: {}, steps: 7 }, [1, 2, 3], 'string', { steps: { 0: 'x', length: 1 } }]);
    } else if (kind === 'random strings') {
      draft = randStr(randInt(0, 80));
    } else {
      draft = { name: { deep: [randStr(20)] }, trigger: [randStr(5)], steps: randStr(30) };
    }
    let v;
    try { v = internals.validateWorkflowDraft(draft, 'goal ' + i); }
    catch (e) { crashes++; invariantHeld = false; continue; }
    if (v.ok) accepted++; else rejected++;
    // TOTALITY INVARIANT: whatever comes out must always be safe to persist.
    const w = v.workflow;
    if (!internals.WORKFLOW_TRIGGERS.includes(w.trigger)) invariantHeld = false;
    if (!Array.isArray(w.steps)) invariantHeld = false;
    if (w.steps.some(s => !internals.WORKFLOW_ACTIONS.includes(s.action))) invariantHeld = false;
    if (w.steps.some(s => s.delay_hours !== undefined && (s.delay_hours < 0 || s.delay_hours > 720))) invariantHeld = false;
    if (w.steps.some(s => s.note !== undefined && s.note.length > 500)) invariantHeld = false;
    if (typeof w.name !== 'string' || !w.name.length) invariantHeld = false;
  }
  check('property: validator never crashes on 400 random inputs', crashes === 0, crashes + ' crashes');
  check('property: output is ALWAYS persist-safe (trigger/action/delay/note/name)', invariantHeld);
  check('property: both accept and reject paths were exercised', accepted > 0 && rejected > 0, 'accepted=' + accepted + ' rejected=' + rejected);
}

// ══════════════════════════════════════════════════════════════
console.log('\n== PROPERTY: 300 random goals — keyword fallback always yields a valid workflow ==');
{
  const goalWords = ['new lead', 'contact', 'deal', 'stage', 'won', 'pipeline', 'appointment', 'book', 'meeting', 'invoice', 'paid', 'payment', 'form', 'survey', 'trigger link', 'webhook', 'zapier', 'whatsapp', 'review', 'testimonial', 'email', 'welcome', 'task', 'follow up', 'call', 'remind', 'prospect', 'qualify', 'proposal', 'randomword', ''];
  let invariantHeld = true, nonManualTriggers = new Set();
  for (let i = 0; i < 300; i++) {
    const n = randInt(1, 6);
    const goal = Array.from({ length: n }, () => pick(goalWords)).join(' ');
    let wf;
    try { wf = internals.localWorkflowFallback(goal, 'test'); }
    catch (e) { invariantHeld = false; check('property: fallback crash on goal "' + goal.slice(0, 40) + '"', false, e.message); break; }
    if (!internals.WORKFLOW_TRIGGERS.includes(wf.trigger)) invariantHeld = false;
    if (!Array.isArray(wf.steps) || wf.steps.length < 1 || wf.steps.length > 6) invariantHeld = false;
    if (wf.steps.some(s => !internals.WORKFLOW_ACTIONS.includes(s.action))) invariantHeld = false;
    if (wf.live !== false || typeof wf.reason !== 'string') invariantHeld = false;
    nonManualTriggers.add(wf.trigger);
  }
  check('property: 300 random goals → always a structurally-valid honest fallback', invariantHeld);
  check('property: fallback recognizes more than just "manual" (keywords work)', nonManualTriggers.size >= 4, [...nonManualTriggers].join(','));
}

// ══════════════════════════════════════════════════════════════
console.log('\n== VOCAB COMPLETENESS: the prompt teaches the FULL engine vocabulary ==');
{
  const prompt = internals.buildWorkflowPrompt('test goal', { contacts: 5, openDeals: 2, pendingTasks: 1, stages: 'lead, won' });
  for (const t of internals.WORKFLOW_TRIGGERS) {
    check('prompt mentions trigger "' + t + '"', prompt.includes(t));
  }
  for (const a of internals.WORKFLOW_ACTIONS) {
    check('prompt mentions action "' + a + '"', prompt.includes(a));
  }
  check('prompt includes CRM context (grounding)', prompt.includes('5 contacts') && prompt.includes('lead, won'));
  check('prompt includes at least one worked example', prompt.includes('EXAMPLE 1') && prompt.includes('EXAMPLE 2'));
  check('prompt explains the WhatsApp constraint (no public API)', /whatsapp/i.test(prompt) && /cannot be auto-sent/i.test(prompt));
}

// ══════════════════════════════════════════════════════════════
console.log('\n== SENTIMENT: honest degradation + clamping ==');
{
  aiCalls = 0; aiFailHard = false;
  aiScript = [JSON.stringify({ sentiment: 'positive', confidence: 87, tone: 'warm and enthusiastic' })];
  const r = await call('POST', '/ai/sentiment', { text: 'I love this product, amazing support!' }, token);
  check('sentiment: valid AI verdict passes through (live:true)', r.data?.sentiment === 'positive' && r.data?.live === true);
  check('sentiment: confidence preserved', r.data?.confidence === 87);

  aiScript = ['Sorry, I cannot do sentiment analysis.'];
  const r2 = await call('POST', '/ai/sentiment', { text: 'meh' }, token);
  check('sentiment: garbage reply → neutral, NOT presented as AI verdict', r2.data?.sentiment === 'neutral');
  check('sentiment: garbage reply is labeled live:false with a reason', r2.data?.live === false && typeof r2.data?.reason === 'string');

  // Confidence clamping property: 200 random confidence values all land in 0-100.
  let clampHeld = true;
  for (let i = 0; i < 200; i++) {
    const c = pick([randInt(-500, 500), null, 'NaN', undefined, 3.7]);
    aiScript = [JSON.stringify({ sentiment: 'neutral', confidence: c, tone: 'x' })];
    const rr = await call('POST', '/ai/sentiment', { text: 'test' }, token);
    const out = rr.data?.confidence;
    if (!Number.isInteger(out) || out < 0 || out > 100) clampHeld = false;
    if (!['positive', 'negative', 'neutral'].includes(rr.data?.sentiment)) clampHeld = false;
  }
  check('sentiment: property — 200 random confidence inputs always clamp to an int in 0-100', clampHeld);

  aiScript = [JSON.stringify({ sentiment: 'positive', confidence: 50, tone: 'x'.repeat(5000) })];
  const r3 = await call('POST', '/ai/sentiment', { text: 'test' }, token);
  check('sentiment: runaway tone string truncated to 200 chars', r3.data?.tone?.length <= 200, 'len=' + r3.data?.tone?.length);
}

// ══════════════════════════════════════════════════════════════
console.log('\n== CAP + CAP-FREE: daily-limit honesty and usage tracking ==');
{
  // trackAIUsage must record both the original and the repair attempt.
  aiCalls = 0; aiFailHard = false;
  aiScript = ['junk reply', 'junk reply'];
  await call('POST', '/ai/build-workflow', { goal: 'anything at all' }, token);
  const usage = await call('GET', '/ai/usage', null, token);
  const ops = JSON.stringify(usage.data || {});
  check('usage: build-workflow recorded', /build-workflow/.test(ops));
  check('usage: failed attempt recorded too (build-workflow-retry)', /build-workflow-retry/.test(ops));
}

// ══════════════════════════════════════════════════════════════
console.log('\n== FRONTEND PARITY: local builders + validation in the real HTML ==');
{
  const { JSDOM } = await import('jsdom');
  const html = readFileSync(join(__dirname, '..', 'NexusCRM_V4_Hardened.html'), 'utf-8');
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.confirm = () => true;
      window.alert = () => {};
      try { Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true }); } catch {}
      window.fetch = async () => { throw new TypeError('network disabled'); };
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, fillText() {}, beginPath() {}, fill() {}, rect() {}, createLinearGradient: () => ({ addColorStop() {} }), roundRect: null });
    },
  });
  const { window } = dom;
  await new Promise(r => setTimeout(r, 300));

  // Top-level `const` in a classic script doesn't become a window property —
  // grab the references through page-context eval instead.
  const WF_TRIGGERS = window.eval('WF_TRIGGERS');
  const WF_ACTIONS = window.eval('WF_ACTIONS');

  check('frontend: localBuildWorkflow exists', typeof window.localBuildWorkflow === 'function');
  check('frontend: wfValidate exists', typeof window.wfValidate === 'function');
  check('frontend: vocab lists defined (8 triggers, 5 actions)', WF_TRIGGERS?.length === 8 && WF_ACTIONS?.length === 5, (WF_TRIGGERS?.length) + '/' + (WF_ACTIONS?.length));
  check('frontend: localBuildWorkflow maps WhatsApp to a HUMAN task (honest)', (() => {
    const wf = window.localBuildWorkflow('whatsapp follow up when a new lead arrives');
    return wf.steps.some(s => s.action === 'create_task' && /whatsapp/i.test(s.note));
  })());
  check('frontend: localBuildWorkflow knows trigger_link', window.localBuildWorkflow('when a trigger link is clicked, email them').trigger === 'trigger_link');
  check('frontend: localBuildWorkflow knows webhook', window.localBuildWorkflow('zapier webhook integration follow up').trigger === 'webhook');

  // Property: 300 random goals through the REAL frontend function.
  const words = ['new lead', 'contact', 'deal', 'stage', 'appointment', 'invoice', 'paid', 'form', 'trigger link', 'webhook', 'zapier', 'whatsapp', 'review', 'email', 'task', 'follow up', 'call', 'prospect', 'xyz', ''];
  let held = true;
  for (let i = 0; i < 300; i++) {
    const goal = Array.from({ length: randInt(1, 5) }, () => pick(words)).join(' ');
    const wf = window.localBuildWorkflow(goal);
    if (!WF_TRIGGERS.includes(wf.trigger) || !Array.isArray(wf.steps) || wf.steps.length < 1 || wf.steps.length > 6) { held = false; break; }
    if (wf.steps.some(s => !WF_ACTIONS.includes(s.action))) { held = false; break; }
  }
  check('frontend: property — 300 random goals always produce a valid workflow', held);

  // Property: wfValidate matches backend invariants on 200 random drafts.
  let vheld = true;
  for (let i = 0; i < 200; i++) {
    const draft = { name: randStr(10), trigger: pick([...WF_TRIGGERS, 'bad']), steps: Array.from({ length: randInt(0, 8) }, () => ({ action: pick([...WF_ACTIONS, 'bad']), note: randStr(20), delay_hours: randInt(-50, 900) })) };
    let v;
    try { v = window.wfValidate(draft, 'g'); } catch { vheld = false; break; }
    if (!WF_TRIGGERS.includes(v.workflow.trigger)) { vheld = false; break; }
    if (v.workflow.steps.some(s => !WF_ACTIONS.includes(s.action))) { vheld = false; break; }
  }
  check('frontend: property — wfValidate outputs always persist-safe (200 random drafts)', vheld);

  window.close();
}

// ══════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════════════════════════');
console.log(`AI ROBUSTNESS RESULTS: ${passed} passed, ${failed} failed`);
if (failed) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
console.log('════════════════════════════════════════════════════════════');
process.on('exit', () => { try { console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify([...(globalThis.__NX_ROUTE_LOG || [])])); } catch {} });
process.exit(failed ? 1 : 0);

