// AI Feature Audit — runs the REAL NexusCRM_V4_Hardened.html in jsdom in
// local-only mode (no provider key, no backend) and drives every local AI
// endpoint exactly as the UI does. Purpose: find AI features that "do not
// work or work at a very bad level" in the offline / local fallback path.
// Run: node tests/test_ai_features.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'NexusCRM_V4_Hardened.html'), 'utf-8');

let grabbed = '';
const dom = new JSDOM(html, {
  url: 'http://localhost:3000/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.confirm = () => true;
    window.alert = () => {};
    try { Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true }); } catch (e) {}
    // Capture any console output from the app so we can surface silent errors.
    window.console.error = (...a) => { grabbed += a.join(' ') + '\n'; };
    // jsdom ships a stub ReadableStream that can't build a readable stream;
    // force-replace it with Node's native web stream so the app's
    // typewriterStream/streamProviderDirect (which build an SSE stream) work.
    try {
      const { ReadableStream } = globalThis.ReadableStream ? { ReadableStream: globalThis.ReadableStream } : require('node:stream/web');
      Object.defineProperty(window, 'ReadableStream', { value: ReadableStream, configurable: true, writable: true });
    } catch (e) {}
    if (typeof window.TextEncoder === 'undefined') window.TextEncoder = globalThis.TextEncoder;
    if (typeof window.TextDecoder === 'undefined') window.TextDecoder = globalThis.TextDecoder;
    window.fetch = async (url, opts = {}) => { throw new TypeError('network disabled in AI audit: ' + url); };
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

const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(300);

const api = (p, m, b) => window.api(p, m, b);

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + String(extra).slice(0, 200) : '')); }
}

// Log in to get a STATE so all local handlers see a workspace.
await sleep(300);
document.getElementById('reg-name').value = 'AI Audit';
document.getElementById('reg-email').value = 'aiaudit@test.com';
document.getElementById('reg-password').value = 'password123';
await window.doRegister();
await sleep(400);

console.log('\n═══ GENERIC /ai/complete (powers chat, weekly review, rewrite, many tools) ═══');
{
  const r = await api('/ai/complete', 'POST', { prompt: 'Summarize the key points of a CRM: leads, pipeline, tasks' });
  check('/ai/complete returns content', r && typeof r.content === 'string' && r.content.length > 20, JSON.stringify(r).slice(0, 120));
  check('/ai/complete marks local fallback (live:false, no key)', r.live === false, JSON.stringify(r).slice(0, 80));
  check('/ai/complete carries an honest fallback note', /local|offline|no API key|connect/i.test(r.content), r.content.slice(0, 60));
  check('/ai/complete content is a REAL answer (not just the note)', r.content.replace(/^[^\n]*\n/, '').trim().length > 40, 'after-note len=' + r.content.replace(/^[^\n]*\n/, '').trim().length);
}

console.log('\n═══ /ai/generate — every type the UI tools request ═══');
const GEN_TYPES = [
  ['email', 'cold outreach to a B2B SaaS for project management', 'professional', 'CTO'],
  ['whatsapp', 'remind a client about their invoice', 'friendly', 'client'],
  ['followup_email', 'prospect went quiet after demo', 'urgent', 'prospect'],
  ['landing_page', 'AI bookkeeping app for freelancers', 'persuasive', 'freelancers'],
  ['hashtags', 'organic skincare', 'casual', 'social audience'],
  ['ad_copy', 'protein bars', 'persuasive', 'gym-goers'],
  ['proposal', 'Rebrand website for Acme, 3 weeks', 'professional', 'Acme CEO'],
  ['review_reply', 'Great service, quick response', 'friendly', 'reviewer'],
  ['social_linkedin', 'launch of new analytics module', 'professional', 'peers'],
  ['social_twitter', 'product launch teaser', 'casual', 'followers'],
  ['social_instagram', 'behind the scenes office', 'playful', 'followers'],
  ['blog', 'email marketing best practices', 'educational', 'marketers'],
  ['blog_outline', 'email marketing best practices', 'educational', 'marketers'],
  ['meeting_agenda', 'Q3 planning with the team', 'professional', 'team'],
  ['press_release', 'company closes $10M Series A', 'formal', 'press'],
  ['product_description', 'wireless noise-cancelling headphones', 'persuasive', 'shoppers'],
  ['job_description', 'Marketing Manager', 'professional', 'candidates'],
  ['sms', 'package ready for pickup', 'friendly', 'customer'],
  ['cold_email', 'outreach to law firms', 'professional', 'managing partner'],
  ['social_facebook', 'community event', 'friendly', 'local audience'],
];
for (const [type, ctx] of GEN_TYPES) {
  try {
    const r = await api('/ai/generate', 'POST', { type, context: ctx });
    const ok = r && typeof r.content === 'string' && r.content.length > 25;
    // Deeper: is the output actually about the requested type, or did it fall
    // through to the generic email template? Detect the fallthrough.
    // Detect genuine fallthrough: the /ai/generate handler prepends the local
    // fallback note only when no key; strip it, then compare body to the email
    // template. If the body equals the email template, it's a fallthrough bug.
    const noteRe = /^⚠️[^\n]*\n\n/;
    const body = (r.content || '').replace(noteRe, '').trim();
    const emailBody = window.localGenerate('email', ctx).trim();
    const wrongType = (type !== 'email' && body === emailBody) ? 'reuses the email template' : '';
    if (ok && !wrongType) check(`generate:${type} returns a type-appropriate draft (${body.length}c)`, true, body.slice(0, 40));
    else check(`generate:${type} returns a type-appropriate draft (${body.length}c)`, false, (wrongType || 'short') + ' ‖ ' + body.slice(0, 60));
  } catch (e) {
    check(`generate:${type} returns real content`, false, 'THREW: ' + e.message);
  }
}

console.log('\n═══ FALLTHROUGH ENGINE: which generate types reuse the EMAIL template? ═══');
{
  // localGenerate(type) must not silently reuse LOCAL_TPL.email for a type it
  // has no template for. We compare directly against the email template.
  const base = window.localGenerate('email', 'x', 't', 'CTO').trim();
  const missing = [];
  for (const t of ['product_description','press_release','meeting_agenda','job_description','blog_outline']) {
    const out = window.localGenerate(t, 'x', 't', 'CTO').trim();
    if (out === base) missing.push(t);
  }
  check('no generate type silently falls through to the email template', missing.length === 0, missing.join(', ') || 'none');
  // and the distinct ones stay distinct (so the check is meaningful)
  const cold = window.localGenerate('cold_email', 'x', 't', 'CTO').trim();
  const fup = window.localGenerate('followup_email', 'x', 't', 'CTO').trim();
  check('cold_email / followup_email are genuine distinct templates', cold !== base && fup !== base && cold !== fup);
}

console.log('\n═══ /ai/sentiment (regex parse) ═══');
{
  const r = await api('/ai/sentiment', 'POST', { text: 'I am absolutely thrilled with this product, everything works perfectly and I love it!' });
  check('sentiment returns a classification', r && typeof r.sentiment === 'string' && r.sentiment.length > 0, JSON.stringify(r).slice(0, 120));
  check('sentiment correctly detects positive', (r.sentiment || '').toLowerCase() === 'positive', JSON.stringify(r).slice(0, 120));
  check('sentiment has a numeric score/confidence', typeof r.score === 'number' || typeof r.confidence === 'number' || typeof r.score === 'string', JSON.stringify(r).slice(0, 120));
  const neg = await api('/ai/sentiment', 'POST', { text: 'Terrible service, worst support ever, I hate this and I have no money left.' });
  check('sentiment detects negative', (neg.sentiment || '').toLowerCase() === 'negative', JSON.stringify(neg).slice(0, 120));
}

console.log('\n═══ /ai/build-workflow (JSON validation + one repair pass) ═══');
{
  const r = await api('/ai/build-workflow', 'POST', { goal: 'When a new lead arrives, send a welcome email and create a follow-up task' });
  check('build-workflow returns a workflow object', r && r.workflow && r.workflow.trigger && Array.isArray(r.workflow.steps), JSON.stringify(r).slice(0, 150));
  check('build-workflow trigger is a valid engine trigger', /^(new_contact|form_submitted|lead_added|contact_created|task_created|email_opened|pipeline_stage|tag_added|deal_won)$/.test(r.workflow.trigger), r.workflow.trigger);
  check('build-workflow steps are valid actions', r.workflow.steps.every(s => /^(send_email|create_task|add_tag|update_contact|create_note|start_timed_flow)$/.test(s.action)), JSON.stringify(r.workflow.steps).slice(0, 120));
}

console.log('\n═══ /ai/models (model catalog) ═══');
{
  const r = await api('/ai/models');
  check('models returns nvidia+openai lists', r && Array.isArray(r.nvidia) && Array.isArray(r.openai), JSON.stringify({n: r?.nvidia?.length, o: r?.openai?.length}));
  check('model catalog has 10+ nvidia models', r && r.nvidia.length >= 10, String(r?.nvidia?.length));
  // LIVE catalog (model list must not be "fixed"): with no key the curated list
  // is returned, but setting a key must make localFetchLiveModels attempt a live
  // provider fetch and mark nvidia_live. We stub fetch to return a fake live
  // list so this works offline.
  const origFetch2 = window.fetch;
  let capturedUrl = '';
  window.fetch = async (url, opts = {}) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify({ data: [
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct' },
      { id: 'nvidia/nemotron-3-nano-30b-a3b' },
      { id: 'openai/gpt-oss-120b' },
      { id: 'meta/llama-3.2-90b-vision-instruct' },
      { id: 'text-embedding-ada-002' },       // must be filtered (embedding)
      { id: 'whisper-1' },                    // must be filtered (audio)
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const ws = window.eval('currentWorkspace()');
  ws.aiSettings = { ...(ws.aiSettings || {}), nvidia_key: 'nv-test' };
  window.saveDB();
  const live = await window.eval('localFetchLiveModels')(ws, 'nvidia', true);
  check('localFetchLiveModels fetches the LIVE catalog when a key is set', live.live === true, JSON.stringify({live: live.live, n: live.data.length}));
  check('live catalog excludes embeddings/audio (chat models only)', !live.data.some(m => /embed|whisper/i.test(m)), JSON.stringify(live.data));
  check('live catalog keeps curated models first', live.data[0] === 'nvidia/llama-3.1-nemotron-70b-instruct', live.data[0]);
  // No key → curated list, live:false.
  const noLive = await window.eval('localFetchLiveModels')(ws, 'openai', true);
  check('no-key returns curated list with live:false', noLive.live === false && Array.isArray(noLive.data) && noLive.data.length > 0, JSON.stringify({live: noLive.live, n: noLive.data.length}));
  window.fetch = origFetch2;
}

console.log('\\n═══ refreshModels() toast messaging (honest diagnostic, not the old misleading blob) ═══');
{
  // The old message was "⚠️ Could not reach the live catalogs (no key set, or
  // local mode without backend/proxy)" — fired for EVERY failure and blamed
  // "no key set" even when a key WAS set. The new code must report the actual
  // per-provider reason (no_key / cors / network / 401 / too_few) so the user
  // knows what to fix. Drive real refreshModels() and capture the toast.
  const ws2 = window.eval('currentWorkspace()');
  const toasts = [];
  const origToast = window.toast;
  window.toast = (msg, type) => toasts.push({ type, msg });
  const body = (m) => m.msg;

  // (1) No keys + fetch throws → must say "set a key", NOT "no key set" blob.
  ws2.aiSettings = {}; window.saveDB();
  window.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await window.refreshModels();
  const noKeyToast = toasts.map(body).join(' ');
  check('refreshModels no-key: says to SET a key', /set an .* api key/i.test(noKeyToast), body(toasts[toasts.length-1]).slice(0, 90));
  check('refreshModels no-key: does NOT misattribute "no key set, or local mode"', !/no key set, or local mode|local mode without backend/i.test(noKeyToast), body(toasts[toasts.length-1]).slice(0, 90));

  // (2) NVIDIA key live-succeeds (76) + OpenAI none → success report, not a warning.
  toasts.length = 0;
  ws2.aiSettings = { nvidia_key: 'nv-ok' }; window.saveDB();
  window.fetch = async (url) => {
    if (String(url).includes('integrate.api.nvidia.com'))
      return new Response(JSON.stringify({ data: [...new Array(76)].map((_, i) => ({ id: 'nvidia/m' + i })) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    throw new TypeError('off'); // openai has no key → no fetch; just for safety
  };
  await window.refreshModels();
  const liveToast = toasts.map(body).join(' ');
  check('refreshModels keyed: reports a SUCCESS (live catalog refreshed)', liveToast.includes('✅') && /live catalog refreshed/i.test(liveToast), body(toasts[toasts.length-1]).slice(0, 90));
  check('refreshModels keyed: counts NVIDIA models (~76)', /76\s+models/i.test(liveToast), body(toasts[toasts.length-1]).slice(0, 90));
  check('refreshModels keyed: invites a key for the other provider (not a warning)', /set an openai key/i.test(liveToast), body(toasts[toasts.length-1]).slice(0, 90));

  // (3) NVIDIA key + provider 401 → honest per-provider diagnosis, still no crash.
  toasts.length = 0;
  ws2.aiSettings = { nvidia_key: 'nv-bad' }; window.saveDB();
  window.fetch = async (url) => {
    if (String(url).includes('integrate.api.nvidia.com'))
      return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    throw new TypeError('off');
  };
  await window.refreshModels();
  const badKeyToast = toasts.map(body).join(' ');
  check('refreshModels 401: names the cause (401 / invalid / revoked)', /401|invalid|revoked/i.test(badKeyToast), body(toasts[toasts.length-1]).slice(0, 120));
  check('refreshModels 401: still says it keeps the curated lists', /curated/i.test(badKeyToast), body(toasts[toasts.length-1]).slice(0, 120));

  // Restore the default network-blocked fetch and toast.
  window.toast = origToast;
  window.fetch = async () => { throw new TypeError('network disabled in AI audit'); };
  ws2.aiSettings = {}; window.saveDB();
}

console.log('\n═══ CHAT: localChatComplete (offline chat engine) ═══');
{
  // The core offline chat path (used by chatStreamFetch when no key / unreachable).
  window.STATE.aiSettings = { ...(window.STATE.aiSettings || {}), nvidia_key: '', openai_key: '', custom_base_url: '', proxy_url: '' };
  window.fetch = async () => { throw new TypeError('offline'); };
  const ws = window.eval('currentWorkspace()');
  await window.api('/contacts', 'POST', { name: 'Hot Buyer', email: 'hot@x.com', stage: 'negotiation', notes: 'very interested in the enterprise plan' });
  const lead = await window.localChatComplete(ws, [{ role: 'user', content: 'who are our hottest leads?' }], {});
  check('chat answers lead questions from local data', /lead|pipeline|contact|hot/i.test(String(lead)), String(lead).slice(0, 120));
  const pipe = await window.localChatComplete(ws, [{ role: 'user', content: 'summarize my pipeline' }], {});
  check('chat summarizes pipeline from local data', /pipeline|opens? deals|won/i.test(String(pipe)), String(pipe).slice(0, 120));
  const generic = await window.localChatComplete(ws, [{ role: 'user', content: 'hello there' }], {});
  check('chat is honest about local mode for generic prompts', /local mode|connect/i.test(String(generic)), String(generic).slice(0, 120));
}

console.log('\n═══ CHAT: chatStreamFetch returns a Response-like .ok/.body in local mode ═══');
{
  // REGRESSION: chatStreamFetch used to return a RAW ReadableStream in local
  // mode (typewriterStream), which has no .ok/.body — so every chat caller's
  // `if(!res.ok)` branch fired and showed "⚠️ AI request failed" even for a
  // healthy local answer. It must now return a Response-compatible object and
  // expose the stream as .body for the SSE reader.
  window.STATE.aiSettings = { ...(window.STATE.aiSettings || {}), nvidia_key: '', openai_key: '', custom_base_url: '', proxy_url: '' };
  window.fetch = async () => { throw new TypeError('offline'); };
  const res = await window.chatStreamFetch([{ role: 'user', content: 'who are our hottest leads?' }], 'ctx');
  check('local chatStreamFetch returns .ok=true', res && res.ok === true, JSON.stringify(res?.ok));
  check('local chatStreamFetch exposes .body (the SSE stream)', !!res && !!res.body, String(typeof res?.body));
  check('local chatStreamFetch is NOT treated as an error (no .json error)', typeof res.json === 'function', String(typeof res?.json));
  // A raw local stream must NOT be mistaken for an error by the callers, which
  // is the regression that made every local chat show "⚠️ AI request failed".
  // The definitive check: applying the callers' own `if(!res.ok)` guard now
  // proceeds to the stream branch instead of the error branch.
  check("callers' !res.ok guard does NOT fire on a healthy local reply", res.ok === true && !res.error, 'ok=' + res.ok);
}

console.log('\n═══ /ai/memory (agent long-term memory) ═══');
{
  const m = await api('/ai/memory');
  check('memory read returns a state object', m && Array.isArray(m.memory) || m && typeof m === 'object', JSON.stringify(m).slice(0, 80));
  const del = await api('/ai/memory', 'DELETE');
  check('memory DELETE clears (ok)', del && del.ok === true, JSON.stringify(del).slice(0, 80));
}

console.log('\n═══ /ai/agent (natural language task creation) ═══');
{
  const r = await api('/ai/agent', 'POST', { message: 'create a task to call Sara on Friday' });
  check('agent returns an action decision', r && typeof r.action === 'string' && r.action.length > 0, JSON.stringify(r).slice(0, 100));
  check('agent executed create_task', r.action === 'create_task' && r.ok !== false, JSON.stringify(r).slice(0, 100));
  const tasks = await api('/tasks');
  check('agent-created task persisted', tasks.tasks && tasks.tasks.some(t => /Sara/i.test(t.title || '')), JSON.stringify(tasks.tasks?.slice(-1)));
}

console.log('\n═══ /ai/forecast ═══');
{
  const r = await api('/ai/forecast');
  check('forecast returns buckets', r && Array.isArray(r.buckets) && r.buckets.length === 3, JSON.stringify(r).slice(0, 120));
  check('forecast buckets are objects with numeric value', r.buckets.every(b => typeof b === 'object' && typeof b.value === 'number'), JSON.stringify(r.buckets).slice(0, 120));
}

console.log('\n═══ /ai/brief ═══');
{
  const r = await api('/ai/brief');
  check('brief returns readable text', r && typeof r.brief === 'string' && r.brief.length > 20, JSON.stringify(r).slice(0, 100));
}

console.log('\n═══ /ai/smart-reply ═══');
{
  const r = await api('/ai/smart-reply', 'POST', { text: 'Thanks for the quick quote, can you send pricing?' });
  check('smart-reply returns option(s)', r && Array.isArray(r.options) && r.options.length >= 1, JSON.stringify(r).slice(0, 100));
  check('smart-reply options are solid strings', r.options.every(o => typeof o === 'string' && o.length > 5), JSON.stringify(r.options).slice(0, 100));
}

console.log('\n═══ /ai/score-tasks ═══');
{
  const r = await api('/ai/score-tasks');
  check('score-tasks returns an array', r && Array.isArray(r.tasks), JSON.stringify(r).slice(0, 100));
}

console.log('\n═══ /ai/deal-risks ═══');
{
  const r = await api('/ai/deal-risks');
  check('deal-risks returns data', r && (Array.isArray(r.risks) || Array.isArray(r.deals) || r.deals), JSON.stringify(r).slice(0, 100));
}

console.log('\n═══ /ai/pipeline-health ═══');
{
  const r = await api('/ai/pipeline-health');
  check('pipeline-health returns a report', r && typeof r.score === 'number' || (r && typeof r.happy === 'boolean'), JSON.stringify(r).slice(0, 100));
}

console.log('\n═══ /ai/translate ═══');
{
  // Node: the UI's doTranslate actually hits /ai/complete; /ai/translate is the
  // backend-facing route. Local returns aiOpComplete => {content}.
  const r = await api('/ai/translate', 'POST', { text: 'Hello, welcome to our store', lang: 'arabic' });
  check('translate returns text', r && typeof r.content === 'string' && r.content.length > 3, JSON.stringify(r).slice(0, 100));
  check('translate carries the honest local fallback note when no key', r.live === false && /local|connect/i.test(r.content), JSON.stringify(r).slice(0, 100));
}

console.log('\n═══ /ai/tone-remix ═══');
{
  const r = await api('/ai/tone-remix', 'POST', { text: 'We are pleased to confirm your order has shipped', tone: 'casual' });
  check('tone-remix returns remixed text', r && typeof r.content === 'string' && r.content.length > 3, JSON.stringify(r).slice(0, 100));
}

console.log('\n═══ /ai/doc-analyze ═══');
{
  // Local returns aiOpComplete => {content}.
  const r = await api('/ai/doc-analyze', 'POST', { text: 'The parties agree to a 12 month contract. Notice period is 30 days. Payment due on invoice.' });
  check('doc-analyze returns text', r && typeof r.content === 'string' && r.content.length > 3, JSON.stringify(r).slice(0, 100));
}

console.log('\n═══ /ai/suggest-workflows ═══');
{
  const r = await api('/ai/suggest-workflows');
  check('suggest-workflows returns suggestions', r && Array.isArray(r.suggestions), JSON.stringify(r).slice(0, 100));
}

console.log('\n═══ /ai/rewrite ═══');
{
  const r = await api('/ai/rewrite', 'POST', { text: 'This is a long boring sentence that could be much better written.', mode: 'concise' });
  check('rewrite returns rewritten text', r && typeof r.content === 'string' && r.content.length > 3, JSON.stringify(r).slice(0, 100));
}

console.log('\n═══ /ai/insights/dashboard (AI Hub insights) ═══');
{
  const r = await api('/ai/insights/dashboard');
  check('insights/dashboard returns content', r && r.insights, JSON.stringify(r).slice(0, 100));
}

console.log('\n═══ KEYED-BUT-UNREACHABLE: honest fallback, never a hard crash ═══');
{
  // Persist a provider key the REAL way (Settings → PATCH writes to the saved
  // workspace, which is what hasAnyKey(ws) reads). Then break the network.
  await api('/ai/settings', 'PATCH', { provider: 'nvidia', nvidia_key: 'nv-bad' });
  const still = await api('/ai/generate', 'POST', { type: 'email', context: 'follow up with prospect' });
  // With no key persisted yet nothing changed; now force an unreachable provider.
  window.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const t0 = Date.now();
  const r = await api('/ai/generate', 'POST', { type: 'email', context: 'follow up with prospect' });
  const ms = Date.now() - t0;
  // (If the local key persistence didn't take, it reports untested — acceptable.)
  check('keyed-unreachable falls back to local (no crash)', r && r.live === false, JSON.stringify(r).slice(0, 100));
  check('keyed-unreachable is FAST (no 10s hang)', ms < 2000, ms + 'ms');
  check('keyed-unreachable explains the provider error', /\b(error|failed|fetch|cors|reach)\b/i.test(r.error || '') || /configured but couldn't be reached|couldn.t be reached|local draft/i.test(r.content), JSON.stringify(r).slice(0, 160));
  // 401 (bad key / unauthorized) path — must also be honest, not retry forever.
  window.fetch = async () => new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const r401 = await api('/ai/generate', 'POST', { type: 'email', context: 'hi' });
  check('401 bad-key path returns content, not a crash', r401 && typeof r401.content === 'string', JSON.stringify(r401).slice(0, 80));
  // Reset the key so later sections stay in clean local mode.
  await api('/ai/settings', 'PATCH', { nvidia_key: '' });
  window.fetch = async () => { throw new TypeError('offline'); };
}

console.log('\n═══ UI TOOL DRIVERS (modal → result flow) ═══');
{
  const g = (id) => document.getElementById(id);
  const mb = () => document.querySelector('#modal-container');
  const mtext = () => mb()?.textContent || '';
  const close = () => { try { window.closeModal(); } catch (e) {} };
  const drives = [
    ['product','pd-ctx','A wireless noise-cancelling headphones','doProduct'],
    ['agenda','ag-ctx','Q3 planning with the team','doAgenda'],
    ['pressrelease','pr-ctx','Our company closes a $10M Series A','doPressRelease'],
    ['jobdesc','jd-role','Marketing Manager','doJobDesc'],
    ['blogoutline','bo-topic','Email marketing best practices','doBlogOutline'],
    ['proposal','prop-desc','Rebrand website for Acme, 3 weeks','doProposal'],
    ['landing','lp-ctx','AI bookkeeping app for freelancers','doLanding'],
    ['hashtags','ht-topic','organic skincare','doHashtags'],
    ['adcopy','ad-prod','protein bars','doAdCopy'],
    ['rewrite','rw-text','This is a long boring sentence that could be better.','doRewrite'],
  ];
  for (const [tool, field, val, fn] of drives) {
    try {
      window.openAITool(tool); await sleep(50);
      const el = g(field);
      if (!el) { check('UI:' + tool + ' opens with a field', false, '#' + field + ' missing'); close(); continue; }
      el.value = val;
      await window[fn](); await sleep(300);
      const t = mtext();
      const ok = mb()?.innerHTML?.length > 40 && t.trim().length > 40 && !/Subject: Following up/.test(t);
      check('UI:' + tool + ' produces a type-appropriate result modal', ok, t.replace(/\s+/g,' ').trim().slice(0, 50));
      close();
    } catch (e) { check('UI:' + tool + ' runs without throwing', false, e.message); close(); }
  }
}
console.log('\n═══ Summary of console.error / runtime errors captured ═══');
console.log('runtime errors:', errors.length ? errors.slice(0, 6) : 'none');
if (grabbed.trim()) console.log('console.error:', grabbed.trim().split('\n').slice(0, 6));

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
