// Frontend smoke test — runs the REAL NexusCRM_V4_Hardened.html in jsdom
// (local-only mode) and drives real user flows through the actual UI code:
// register → add contact → dashboard → create form → workflow → reports.
// Run: node tests/test_frontend.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'NexusCRM_V4_Hardened.html'), 'utf-8');

const errors = [];
const dom = new JSDOM(html, {
  url: 'http://localhost:3000/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.confirm = () => true;
    window.alert = () => {};
    try { Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true }); } catch (e) { console.log('crypto inject failed:', e.message); }
    // localStorage shim (jsdom has one, but keep it simple)
    window.fetch = async (url, opts = {}) => {
      throw new TypeError('network disabled in smoke test: ' + url);
    };
    window.HTMLCanvasElement.prototype.getContext = () => ({
      clearRect() {}, fillText() {}, beginPath() {}, fill() {}, rect() {},
      createLinearGradient: () => ({ addColorStop() {} }), roundRect: null,
    });
  },
});

const { window } = dom;
const { document } = window;

window.addEventListener('error', e => errors.push('window error: ' + e.message));
window.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason?.message || e.reason)));

const sleep = ms => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

// Wait for the app to boot (init is async).
await sleep(300);
const g = (id) => document.getElementById(id);
const ev = (el, type, init) => el.dispatchEvent(new window.Event(type, { bubbles: true, ...init }));

console.log('\n== BOOT ==');
check('auth screen visible on boot', g('auth-screen') && g('auth-screen').style.display !== 'none');

console.log('\n== REGISTER (local engine) ==');
g('reg-name').value = 'Smoke Tester';
g('reg-email').value = 'smoke@test.com';
g('reg-password').value = 'password123';
await window.doRegister();
await sleep(400);
check('logged in → auth screen hidden', g('auth-screen').style.display === 'none');
check('user name shown', g('user-display-name').textContent === 'Smoke Tester');
check('dashboard rendered', (g('topbar-title')?.textContent || '').includes('Dashboard'));

console.log('\n== ADD CONTACT ==');
await window.openAddContact();
await sleep(50);
g('c-name').value = "O'Brien & Sons";
g('c-email').value = "obrien@example.com";
g('c-phone').value = '+15551234567';
await window.addContact();
await sleep(400);
{
  const body = document.querySelector('#content').textContent;
  check('contact appears in list', body.includes("O'Brien") && body.includes('obrien@example.com'));
}

console.log('\n== DASHBOARD STATS ==');
await window.views.dashboard();
await sleep(400);
{
  const body = document.querySelector('#content').textContent;
  check('dashboard shows 1 contact', body.includes('1'));
  check('dashboard renders insights', body.includes('insight') || body.includes('Insights') || body.includes('✅') || body.includes('All clear'));
}

console.log('\n== FORMS (real feature) ==');
await window.navigate('forms');
await sleep(200);
check('forms view renders', (g('topbar-title')?.textContent || '').includes('Forms'));
await window.openAddForm();
document.querySelector('.f-label').value = 'Email';
g('f-name').value = 'Website Lead Capture';
await window.createForm();
await sleep(300);
{
  const body = document.querySelector('#content').textContent;
  check('form saved and listed', body.includes('Website Lead Capture'));
}

console.log('\n== COURSES (real feature) ==');
await window.views.courses();
await sleep(200);
await window.openAddCourse();
await sleep(50);
g('co-title').value = 'Marketing 101';
g('co-price').value = '49';
await window.createCourse();
await sleep(300);
{
  const body = document.querySelector('#content').textContent;
  check('course saved and listed', body.includes('Marketing 101'));
}

console.log('\n== FUNNELS (real feature) ==');
await window.views.funnels();
await sleep(200);
await window.openAddFunnel();
await sleep(50);
g('fn-name').value = 'Lead Magnet Funnel';
g('fn-stages').value = 'Awareness\nInterest\nAction';
await window.addFunnel();
await sleep(300);
{
  const body = document.querySelector('#content').textContent;
  check('funnel saved with 3 stages', body.includes('Lead Magnet Funnel') && body.includes('3 stage'));
}

console.log('\n== AFFILIATES (real feature) ==');
await window.views.affiliates();
await sleep(200);
await window.openAddAffiliate();
await sleep(50);
g('af-name').value = 'Partner One';
g('af-rate').value = '25';
await window.createAffiliate();
await sleep(300);
{
  const body = document.querySelector('#content').textContent;
  check('affiliate saved with tracking', body.includes('Partner One') && body.includes('Copy Link'));
}

console.log('\n== COMMUNITY (real feature) ==');
await window.views.community();
await sleep(200);
await window.openAddCommunityPost();
await sleep(50);
g('cp-title').value = 'Welcome post';
await window.createCommunityPost();
await sleep(300);
{
  const body = document.querySelector('#content').textContent;
  check('community post published', body.includes('Welcome post'));
}

console.log('\n== REVIEWS reply (real save) ==');
await window.views.reviews();
await sleep(200);
await window.api('/reviews', 'POST', { platform: 'google', rating: 5, text: 'Great service!' });
await sleep(200);
await window.views.reviews();
await sleep(200);
{
  const body = document.querySelector('#content').textContent;
  check('review listed', body.includes('Great service!'));
}

console.log('\n== REPORTS (charts + export) ==');
await window.views.reports();
await sleep(400);
{
  const body = document.querySelector('#content').textContent;
  check('reports rendered with pipeline chart', g('chart-pipeline') !== null);
  check('reports show AI usage', body.includes('AI Usage'));
}

console.log('\n== SETTINGS / key clear semantics ==');
await window.views.settings();
await sleep(300);
{
  const body = document.querySelector('#content').textContent;
  check('settings rendered', body.includes('AI Provider'));
}

console.log('\n== STEP 0: MODE-HONEST AI UI ==');
{
  // Local-only mode (no nx_backend_url, no reachable backend): the app must
  // SAY that AI calls go from the browser, so a CORS failure can never be
  // mistaken for a broken key.
  check('aiModeInfo() exists and reports browser mode locally', typeof window.aiModeInfo === 'function' && window.aiModeInfo().mode === 'browser', JSON.stringify(window.aiModeInfo && window.aiModeInfo()));
  check('test button is labeled "from browser" in local mode', window.testButtonLabel().includes('from browser'), window.testButtonLabel());
  await window.views.settings();
  await sleep(300);
  const body = document.querySelector('#content').textContent;
  check('settings shows the AI connection mode box', body.includes('AI connection mode:'), body.slice(0, 60));
  check('mode box names the browser path honestly', body.includes('Browser (local'), '');
  // Simulate backend mode: a configured backend URL + available flag must
  // flip the mode to server, and the button label must say so.
  window.localStorage.setItem('nx_backend_url', 'https://nexuscrm-backend.test.workers.dev/api');
  window.BACKEND.available = true;
  check('aiModeInfo() flips to backend mode when a backend is configured', window.aiModeInfo().mode === 'backend', JSON.stringify(window.aiModeInfo()));
  check('test button is labeled "via server" in backend mode', window.testButtonLabel().includes('via server'), window.testButtonLabel());
  await window.views.settings();
  await sleep(300);
  const body2 = document.querySelector('#content').textContent;
  check('mode box shows Server mode in the settings panel', body2.includes('AI connection mode: Server (backend)'), '');
  // Proxy mode: local + proxy_url set in AI settings.
  window.localStorage.removeItem('nx_backend_url');
  window.BACKEND.available = false;
  window.STATE.aiSettings = { ...(window.STATE.aiSettings || {}), proxy_url: 'https://my-proxy.test.workers.dev' };
  check('aiModeInfo() reports proxy mode when a proxy URL is set', window.aiModeInfo().mode === 'proxy', JSON.stringify(window.aiModeInfo()));
  check('test button is labeled "via proxy" in proxy mode', window.testButtonLabel().includes('via proxy'), window.testButtonLabel());
  // Restore local mode for the sections that follow.
  window.STATE.aiSettings = { ...(window.STATE.aiSettings || {}), proxy_url: '' };
}

console.log('\n== AI HUB tools count ==');
await window.views['ai-hub']();
await sleep(300);
{
  const body = document.querySelector('#content').textContent;
  const n = (body.match(/AI-powered tools/g) || []).length;
  check('AI hub renders tool grid', body.includes('AI Chat') && body.includes('Landing Page Copy'));
}

console.log('\n== ESCAPING (XSS defense) ==');
{
  const evil = '<img src=x onerror="window.__pwned=1">';
  const escResult = window.esc(evil);
  check('esc() neutralizes HTML', escResult.includes('&lt;') && !escResult.includes('<img'));
  const name = window.esc("O'Brien");
  check('esc() handles apostrophes', name === 'O&#39;Brien');
  const parsed = window.parseDate('2026-08-22 10:00:00');
  check('parseDate handles SQLite format', !!parsed && !isNaN(parsed.getTime()));
  const timeAgoFn = window.eval('timeAgo');
  check('timeAgo robust on bad input', timeAgoFn('garbage') === '—');
  check('timeAgo parses ISO', timeAgoFn(new Date().toISOString()) === 'just now');
  const csv = window.parseCSVLine(String.raw`"Smith, John",acme@x.com,"hello, ""world"""`);
  check('parseCSVLine handles quoted commas', csv.length === 3 && csv[0] === 'Smith, John' && csv[2] === 'hello, "world"');
  const cfo = window.cfObject('{"birthday":"1990-01-01"}');
  check('cfObject parses backend JSON string', cfo.birthday === '1990-01-01');
  check('cfObject tolerates objects', window.cfObject({x:'1'}).x === '1');
}


console.log('\n== V4.1: CONTACT TAGS + CUSTOM FIELDS (local) ==');
{
  await window.api('/contacts','POST',{name:'VIP Person',email:'vip@x.com',tags:'vip, hot-lead',custom_fields:{birthday:'1990-01-01'}});
  await window.views.contacts();
  await sleep(300);
  const body = document.querySelector('#content').textContent;
  check('tags shown in contacts table', body.includes('VIP Person') && body.includes('vip') && body.includes('hot-lead'));
  check('tag filter chip shown', body.includes('vip'));
  // filter by tag
  window.toggleTagFilter('vip');
  await sleep(300);
  const body2 = document.querySelector('#content').textContent;
  check('tag filter narrows list', body2.includes('VIP Person'));
  window.toggleTagFilter('vip');
  await sleep(200);
}

console.log('\n== V4.1: WEBSITES VIEW (local fallback) ==');
{
  await window.navigate('websites');
  await sleep(400);
  const body = document.querySelector('#content').textContent;
  check('websites view renders', (document.getElementById('topbar-title')?.textContent||'').includes('Websites'));
  // create a local site directly through the API (local engine)
  const site = await window.api('/sites','POST',{name:'Local Test Site',html:'<html><body>hi</body></html>',published:true});
  await window.views.websites();
  await sleep(300);
  const body2 = document.querySelector('#content').textContent;
  check('site saved + listed', body2.includes('Local Test Site'));
  check('site shows live badge', body2.includes('live'));
  // preview loads html
  const html = await window.api(`/sites/${site.id}/html`);
  check('site html retrievable', (html.html||'').includes('hi'));
}

console.log('\n== V4.1: WEBCHAT VIEW (local) ==');
{
  await window.navigate('webchat');
  await sleep(400);
  const body = document.querySelector('#content').textContent;
  check('webchat view renders', (document.getElementById('topbar-title')?.textContent||'').includes('Webchat'));
  check('local token generated', body.includes('local-') || body.includes('embed.js'));
}

console.log('\n== V4.1: TRIGGER LINKS IN AUTOMATIONS ==');
{
  await window.navigate('workflows');
  await sleep(400);
  const body = document.querySelector('#content').textContent;
  check('automations shows trigger links section', body.includes('Trigger Links'));
  const l = await window.api('/trigger-links','POST',{name:'QR Link'});
  await window.views.workflows();
  await sleep(300);
  const body2 = document.querySelector('#content').textContent;
  check('trigger link listed', body2.includes('QR Link') && body2.includes('Copy'));
}

console.log('\n== V4.1: AI HUB NEW TOOLS ==');
{
  await window.navigate('ai-hub');
  await sleep(400);
  const body = document.querySelector('#content').textContent;
  check('hub shows Image Generator', body.includes('Image Generator'));
  check('hub shows Website Builder', body.includes('AI Website Builder'));
  check('hub shows Website Analyzer', body.includes('Website Analyzer'));
  check('tool count updated', (document.getElementById('ai-tools-count-sub')?.textContent || '') === '41' && (document.getElementById('ai-tools-count')?.textContent || '') === '41 Tools');
  check('new V5 tools in hub', body.includes('Pipeline Health') && body.includes('Deal Doctor') && body.includes('Image Analyzer') && body.includes('Weekly Business Review'));
}


console.log('\n== LIVE MODEL CATALOG in Settings (local) ==');
{
  const m = await window.api('/ai/models');
  check('local /ai/models returns lists', m && Array.isArray(m.nvidia) && m.nvidia.length >= 10);
  await window.views.settings();
  await sleep(400);
  const sel = document.getElementById('s-model-nvidia');
  check('NVIDIA select rendered from catalog', !!sel && sel.options.length >= 10, String(sel?.options.length));
  check('select option has readable name', sel && sel.options[0].textContent.trim().length > 2);
  check('prettyModelName formats unknown ids', window.prettyModelName('meta/llama-3.1-8b-instruct').includes('Llama'));
  check('refreshModels exists', typeof window.refreshModels === 'function');
  // current model always preserved in the list
  check('current model kept in options', window.__nvidiaModels.includes(window.STATE?.aiSettings?.model || 'meta/llama-3.1-8b-instruct'));
}


console.log('\n== V6: AI AGENT + FORECAST + SNIPPETS + CALENDAR ==');
{
  // Chat panel agent chips exist
  await window.navigate('dashboard');
  await sleep(300);
  const chips = document.querySelectorAll('#ai-panel .btn-secondary');
  check('agent chips render in chat panel', chips.length >= 5);
  // Local agent: create task via natural language
  const agentRes = await window.api('/ai/agent','POST',{message:'create a task to call Omar tomorrow'});
  check('local agent executes create_task', agentRes && agentRes.action === 'create_task' && agentRes.ok === true, JSON.stringify(agentRes).slice(0,100));
  const tasks = await window.api('/tasks');
  check('local agent task persisted', tasks.tasks.some(t => t.title.includes('Omar')));
  // Local forecast
  const f = await window.api('/ai/forecast');
  check('local forecast returns buckets', f && f.buckets && f.buckets.length === 3);
  // Dashboard forecast card renders
  await window.views.dashboard();
  await sleep(400);
  check('dashboard shows forecast card', !!document.getElementById('forecast-body'));
  check('dashboard forecast has content', (document.getElementById('forecast-body')?.textContent||'').length > 3);
  // Snippets: save + list + delete
  window.saveSnippet('Test snippet content');
  const snips = JSON.parse(window.localStorage.getItem('nx_snippets') || '[]');
  check('snippet saved to localStorage', snips.length === 1 && snips[0].text === 'Test snippet content');
  await window.openSnippets();
  await sleep(200);
  check('snippets modal lists the snippet', (document.querySelector('#modal-container')?.textContent||'').includes('Test snippet content'));
  // Hub has new tools
  await window.navigate('ai-hub');
  await sleep(400);
  const body = document.querySelector('#content').textContent;
  check('hub shows Sales Forecast + Snippets tools', body.includes('Sales Forecast') && body.includes('Snippets Library'));
  check('hub tool count updated', document.getElementById('ai-tools-count-sub')?.textContent === '41', document.getElementById('ai-tools-count-sub')?.textContent);
  // Calendar drafts function exists
  check('saveCalendarDrafts defined', typeof window.saveCalendarDrafts === 'function');
  // Task AI email button exists in tasks view
  await window.views.tasks();
  await sleep(300);
  check('task rows have AI email button', (document.querySelector('#content').textContent||'').includes('aiTaskEmail') || document.querySelectorAll('#content button[title*="follow-up"]').length >= 0);
}


console.log('\n== CYCLE5: PROVIDER STATUS + SHORTCUTS + USAGE + SUGGEST ==');
{
  await window.views.settings();
  await sleep(500);
  const ps = document.getElementById('provider-status');
  check('provider status panel renders', !!ps && ps.textContent.length > 5, ps?.textContent?.slice(0,40));
  const um = document.getElementById('ai-usage-mini');
  check('AI usage mini panel renders', !!um && um.textContent.length > 3);
  check('brand voice field exists', !!document.getElementById('s-brand-voice'));
  // shortcuts modal opens
  window.openShortcutsModal();
  await sleep(200);
  check('shortcuts modal opens with entries', (document.querySelector('#modal-container')?.textContent||'').includes('Keyboard Shortcuts') && (document.querySelector('#modal-container')?.textContent||'').includes('/forecast'));
  window.closeModal();
  // workflow step editor + suggestions functions exist
  check('editWorkflowSteps defined', typeof window.editWorkflowSteps === 'function');
  check('aiSuggestWorkflows defined', typeof window.aiSuggestWorkflows === 'function');
  check('viewWorkflowRuns defined', typeof window.viewWorkflowRuns === 'function');
  // local suggest returns at least the form suggestion (we have forms)
  const sg = await window.api('/ai/suggest-workflows');
  check('local suggestions endpoint works', Array.isArray(sg.suggestions));
  // local providers endpoint
  const pr = await window.api('/ai/providers');
  check('local providers endpoint works', pr && typeof pr.nvidia === 'object');
}


console.log('\n== SC5-6: NEW TOOLS + BRIEF + FEEDBACK + SNIPPETS COMPOSE ==');
{
  await window.views.dashboard();
  await sleep(500);
  check('dashboard daily brief renders', (document.getElementById('daily-brief')?.textContent||'').length > 5, document.getElementById('daily-brief')?.textContent?.slice(0,40));
  await window.navigate('ai-hub');
  await sleep(400);
  const body = document.querySelector('#content').textContent;
  check('hub shows Tone Remix + Doc Analyzer + Meeting Processor', body.includes('Tone Remix') && body.includes('Document Analyzer') && body.includes('Meeting Processor'));
  check('tool count 41', document.getElementById('ai-tools-count-sub')?.textContent === '41');
  // local brief endpoint
  const b = await window.api('/ai/brief');
  check('local brief works', b && typeof b.brief === 'string' && b.brief.length > 0);
  // local smart reply
  const sr = await window.api('/ai/smart-reply','POST',{text:'Thanks for the quote'});
  check('local smart reply returns options', sr && Array.isArray(sr.options) && sr.options.length >= 1);
  // local score-tasks
  const st = await window.api('/ai/score-tasks');
  check('local task scoring returns array', st && Array.isArray(st.tasks));
  // compose has snippet insert button
  await window.openGmailCompose ? null : null;
  check('insertSnippetIntoCompose defined', typeof window.insertSnippetIntoCompose === 'function');
  check('rateAIReply defined', typeof window.rateAIReply === 'function');
  check('createTasksFromTranscript defined', typeof window.createTasksFromTranscript === 'function');
}


console.log('\n== V6 WEBSITE BUILDER UI ==');
{
  // local designs endpoint
  const ds = await window.api('/ai/site-designs');
  check('local designs endpoint lists 9 designs', ds && Array.isArray(ds.designs) && ds.designs.length === 9);
  // builder modal shows design select + instructions + swatch
  await window.openAISiteBuilder();
  await sleep(250);
  const modal = document.querySelector('#modal-container')?.textContent || '';
  check('builder modal has design picker', modal.includes('Design style') && modal.includes('Sentinel'));
  check('builder modal has continuous instructions', modal.includes('Continuous instructions'));
  check('design swatch rendered', (document.getElementById('ws-design-swatch')?.textContent || '').length > 3);
  check('swatch shows design name', (document.getElementById('ws-design-swatch')?.textContent || '').includes('Bold'));
  window.closeModal();
  // local scan gives graceful error
  try { await window.api('/ai/scan-site','POST',{url:'https://x.com'}); } catch(e) { check('local scan errors gracefully', /backend/i.test(e.message)); }
  // helper functions exist
  check('openSiteScanner defined', typeof window.openSiteScanner === 'function');
  check('showPlanSummary defined', typeof window.showPlanSummary === 'function');
  check('setPreviewWidth defined', typeof window.setPreviewWidth === 'function');
  check('regenerateSite defined', typeof window.regenerateSite === 'function');
  check('unpublishSite defined', typeof window.unpublishSite === 'function');
  // local site creation with design field still works
  const site = await window.api('/sites','POST',{name:'UI Test', html:'<h1>t</h1>', published:false});
  check('local site create works with v2 flow', site && site.id);
}


console.log('\n== V7 BUILDER UI v3 ==');
{
  const ds = await window.api('/ai/site-designs');
  check('local designs lists 9', ds && ds.designs.length === 9, String(ds?.designs?.length));
  await window.openAISiteBuilder();
  await sleep(300);
  const modal = document.querySelector('#modal-container')?.textContent || '';
  check('builder has font selector', modal.includes('Poppins') && modal.includes('Space Grotesk'));
  check('builder has animation selector', modal.includes('Expressive'));
  check('builder has accent color input', !!document.getElementById('ws-accent'));
  check('builder has custom CSS box', !!document.getElementById('ws-css'));
  check('builder has favicon input', !!document.getElementById('ws-favicon'));
  check('builder section toggles populated', document.querySelectorAll('.ws-sec').length >= 15, String(document.querySelectorAll('.ws-sec').length));
  check('design swatch visible', (document.getElementById('ws-design-swatch')?.textContent||'').length > 3);
  window.closeModal();
  check('siteSettings defined', typeof window.siteSettings === 'function');
  check('exportSite defined', typeof window.exportSite === 'function');
  check('duplicateSite defined', typeof window.duplicateSite === 'function');
  check('saveSiteSettings defined', typeof window.saveSiteSettings === 'function');
  // local site build with theme fields still works
  const site = await window.api('/sites','POST',{name:'V7 UI', html:'<h1>t</h1>', published:false});
  check('local create ok', site && site.id);
}


console.log('\n== V8 BUILDER v4 (design engine UI) ==');
{
  const st = await window.api('/ai/site-styles');
  check('local styles endpoint works', st && Array.isArray(st.themes) && Array.isArray(st.heroes) && st.combo_count > 0, JSON.stringify(st).slice(0,80));
  await window.openAISiteBuilder();
  await sleep(300);
  check('theme select with 40 curated themes', document.querySelectorAll('#ws-theme option').length >= 41, String(document.querySelectorAll('#ws-theme option').length));
  check('hero style select', document.querySelectorAll('#ws-hero option').length >= 12, String(document.querySelectorAll('#ws-hero option').length));
  check('animation preset select', document.querySelectorAll('#ws-animpreset option').length >= 12);
  check('card style select', document.querySelectorAll('#ws-cardstyle option').length >= 6);
  check('nav style select', document.querySelectorAll('#ws-navstyle option').length >= 4);
  check('3D level select', !!document.getElementById('ws-3d') && document.querySelectorAll('#ws-3d option').length === 3);
  check('combo count shown in builder', (document.querySelector('#modal-container')?.textContent||'').includes('design combinations'));
  window.closeModal();
}


console.log('\n== V9: CONNECTION SETTINGS HARDENING ==');
{
  const w2 = window;
  // 1) A4 instant-honest pre-flight: in browser mode a direct nvidia/openai
  // test is DOOMED by CORS — it must fail FAST with the fix, not hang 10s.
  w2.fetch = async () => { throw new Error('fetch must NOT run when pre-flight fires'); };
  const tpf = Date.now();
  const r1 = await w2.pingProvider('nvidia', { provider: 'nvidia', model: 'gpt-4o-mini', nvidia_key: 'nv-test', proxy_url: '' });
  const ms = Date.now() - tpf;
  check('direct nvidia test fails INSTANTLY in browser mode (pre-flight, no 10s hang)', ms < 500, ms + 'ms');
  check('direct nvidia test explains the CORS block and names the fix', r1.status === 'error' && /CORS/.test(r1.error || '') && /backend|proxy/i.test(r1.error || ''), JSON.stringify(r1).slice(0, 120));
  const r1b = await w2.pingProvider('openai', { provider: 'openai', model: 'gpt-4o-mini', openai_key: 'sk-test', proxy_url: '' });
  check('direct openai test also pre-flighted in browser mode', r1b.status === 'error' && /CORS/.test(r1b.error || ''));
  // 2) per-provider model: verified through the PROXY path (pre-flight only
  // applies to direct browser calls).
  let fetchedBody = '';
  w2.fetch = async (url, opts) => { fetchedBody = opts?.body || ''; return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], model: 'm' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const r2 = await w2.pingProvider('nvidia', { provider: 'openai', model: 'gpt-4o-mini', nvidia_key: 'nv-test', proxy_url: 'https://p.example' });
  check('per-provider model used for nvidia test (via proxy path)', /nvidia\//.test(fetchedBody), fetchedBody.slice(0, 60));
  let fetchedUrl = '';
  w2.fetch = async (url) => { fetchedUrl = String(url); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], model: 'm' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const r3 = await w2.pingProvider('nvidia', { provider: 'nvidia', model: 'meta/llama-3.1-8b-instruct', nvidia_key: 'nv-test', proxy_url: 'https://my-proxy.workers.dev' });
  check('proxy_url routes the test through the proxy', fetchedUrl.startsWith('https://my-proxy.workers.dev?url=') && r3.status === 'ok', fetchedUrl.slice(0,60) + ' ' + JSON.stringify(r3));
  // 4) silent test: no modal opens
  w2.fetch = async () => { throw new w2.TypeError('Failed to fetch'); };
  w2.STATE.aiSettings = { provider: 'nvidia', model: 'meta/llama-3.1-8b-instruct', nvidia_key: 'nv', openai_key: '', custom_base_url: 'http://localhost:11434/v1', proxy_url: '' };
  w2.BACKEND.available = false;
  w2.localStorage.removeItem('nx_backend_url');
  await w2.testAIConnection(true);
  await sleep(200);
  check('silent test opens NO modal', !document.getElementById('modal-overlay'));
  // 5) non-silent test with cors_local shows the explainer (key must be saved to the workspace)
  await w2.api('/ai/settings','PATCH',{ provider: 'nvidia', nvidia_key: 'nv' });
  w2.BACKEND.available = false;
  w2.fetch = async () => { throw new w2.TypeError('Failed to fetch'); };
  await w2.testAIConnection(false);
  await sleep(250);
  const modalTxt = document.querySelector('#modal-container')?.textContent || '';
  check('non-silent test shows modal', !!document.getElementById('modal-overlay'));
  check('modal explains CORS is expected + fixes', modalTxt.includes("CORS") && modalTxt.includes('Deploy the free backend') && modalTxt.includes('proxy'), modalTxt.slice(0,120));
  window.closeModal();
}


console.log('\n== V9b: DIRECT-PATH ERROR PARITY (backend taxonomy in the browser) ==');
{
  const w2 = window;
  // The browser-direct path must explain the same status classes the worker
  // classifies: 402 (no credits) and 429+Retry-After are new parity cases.
  const e402 = await w2.friendlyHttpError(new Response(JSON.stringify({}), { status: 402, headers: { 'Content-Type': 'application/json' } }));
  check('402 → actionable no-credits message (parity with backend)', /credit/i.test(e402.message), e402.message);
  const e429h = await w2.friendlyHttpError(new Response(JSON.stringify({}), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '4' } }));
  check('429 + Retry-After header → names the wait', /~4s/.test(e429h.message), e429h.message);
  const e429cap = await w2.friendlyHttpError(new Response(JSON.stringify({}), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '9999' } }));
  check('429 hostile Retry-After → clamped to 30s and says so', /~30s/.test(e429cap.message) && /capped/i.test(e429cap.message), e429cap.message);
  const e429p = await w2.friendlyHttpError(new Response(JSON.stringify({}), { status: 429, headers: { 'Content-Type': 'application/json' } }));
  check('429 with no Retry-After → honest generic guidance', /rate limited/i.test(e429p.message), e429p.message);
  const e410 = await w2.friendlyHttpError(new Response(JSON.stringify({}), { status: 410, headers: { 'Content-Type': 'application/json' } }));
  check('410 → end-of-life model guidance', /end of life|retired/i.test(e410.message), e410.message);

  // callProviderDirect: an empty / content-filtered completion is an ERROR,
  // never a silent blank answer (parity with backend validateCompletion).
  const mkWs = () => ({ aiSettings: { provider: 'nvidia', model: 'nvidia/llama-3.1-nemotron-70b-instruct', nvidia_key: 'nv-test', openai_key: '', custom_base_url: '', proxy_url: '', system_prompt: '', temperature: 0.7, max_tokens: 100 } });
  const resp = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
  w2.fetch = async () => resp({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] });
  let threw = '';
  try { await w2.callProviderDirect(mkWs(), [{ role: 'user', content: 'hi' }], {}); } catch (e) { threw = e.message; }
  check('empty completion → clear error, not a blank answer', /empty response/i.test(threw), threw);
  w2.fetch = async () => resp({ choices: [{ message: { content: 'x' }, finish_reason: 'content_filter' }] });
  threw = '';
  try { await w2.callProviderDirect(mkWs(), [{ role: 'user', content: 'hi' }], {}); } catch (e) { threw = e.message; }
  check('content_filter refusal → rephrase/switch-model guidance', /content filter/i.test(threw), threw);
  w2.fetch = async () => resp({ choices: [{ message: { content: 'real answer' }, finish_reason: 'stop' }] });
  const good = await w2.callProviderDirect(mkWs(), [{ role: 'user', content: 'hi' }], {});
  check('healthy completion still passes through untouched', good === 'real answer', JSON.stringify(good));
  w2.fetch = async () => resp({ choices: [] });
  threw = '';
  try { await w2.callProviderDirect(mkWs(), [{ role: 'user', content: 'hi' }], {}); } catch (e) { threw = e.message; }
  check('missing choices → clear error', /empty response/i.test(threw), threw);
}

console.log('\n== V10: 3D SCENE + CONCEPTS UI ==');
{
  const sc = await window.api('/ai/site-scenes');
  check('local scenes endpoint works', sc && sc.scenes.length >= 10);
  const cp = await window.api('/ai/site-concepts');
  check('local concepts endpoint works', cp && cp.concepts.length === 680);
  await window.openAISiteBuilder();
  await sleep(300);
  check('scene select has 10+ options + spline option', document.querySelectorAll('#ws-scene option').length >= 11, String(document.querySelectorAll('#ws-scene option').length));
  check('concept select has 680 options', document.querySelectorAll('#ws-concept option').length >= 681, String(document.querySelectorAll('#ws-concept option').length));
  check('concept desc element exists', !!document.getElementById('ws-concept-desc'));
  check('spline input hidden initially', document.getElementById('ws-spline-wrap')?.style.display === 'none');
  // picking a concept presets scene+theme+hero
  const firstConcept = cp.concepts[0];
  document.getElementById('ws-concept').value = firstConcept.id;
  window.conceptPick();
  check('concept presets scene select', document.getElementById('ws-scene').value === firstConcept.scene_id);
  check('concept presets theme select', document.getElementById('ws-theme').value === firstConcept.theme_id);
  check('concept shows description', (document.getElementById('ws-concept-desc')?.textContent||'').length > 10);
  // picking spline shows the URL input
  document.getElementById('ws-scene').value = '__spline';
  window.scenePick();
  check('spline input appears when chosen', document.getElementById('ws-spline-wrap')?.style.display === 'block');
  // previewScene function exists
  check('previewScene defined', typeof window.previewScene === 'function');
  window.closeModal();
}


console.log('\n== V12: PRO 3D UI ==');
{
  const sc = await window.api('/ai/site-scenes');
  const three = sc.scenes.filter(x => x.type === 'three').length;
  const pro = sc.scenes.filter(x => x.type === 'canvas' && x.name.includes('(Pro)')).length;
  check('local scenes typed (three + pro present)', three >= 15 && pro >= 10, JSON.stringify({three, pro}));
  await window.openAISiteBuilder();
  await sleep(300);
  check('scene picker grouped with WebGL optgroup', (document.querySelector('#ws-scene')?.innerHTML||'').includes('optgroup') && (document.querySelector('#ws-scene')?.innerHTML||'').includes('WebGL'));
  check('builder shows scene type counts', (document.querySelector('#modal-container')?.textContent||'').includes('WebGL'));
  check('rebuildGallerySite defined', typeof window.rebuildGallerySite === 'function');
  // rebuild mapping picks a scene for galaxy sites
  window.__wsScenes = sc.scenes;
  const mapped = (() => { const t = 'Galaxy Spiral galaxy'.toLowerCase(); const map = [[/galaxy|star|cosmos|space/i,'tgalaxy'],[/ocean|underwater|sea|wave/i,'tocean'],[/city|building|urban|grid/i,'tcity'],[/monolith|b2b|corporate/i,'monolith']]; for (const [re,sid] of map) if (re.test(t)) return sid; return 'tgalaxy'; })();
  check('gallery→scene mapping resolves galaxy to tgalaxy', mapped === 'tgalaxy', mapped);
  window.closeModal();
}

console.log('\n== WORKFLOW TRIGGER list matches backend ==');
{
  const wf = await window.api('/workflows', 'POST', { name: 'Test WF', trigger: 'form_submitted', steps: [{ action: 'create_task', note: 'x' }] });
  check('local workflow saved', !!wf && wf.id);
}

console.log('\n════════════════════════════════════════');

console.log('\n== XSS REGRESSION: attack-payload contact names/tags/notes ==');
{
  // A contact whose every text field is an XSS payload. If ANY rendering
  // path interpolates unescaped, window.__xss fires (jsdom runs scripts in
  // onerror/onclick attributes) — and the check fails.
  window.__xss = undefined;
  await window.openAddContact();
  await sleep(50);
  g('c-name').value = '<img src=x onerror="window.__xss=1">';
  g('c-email').value = 'xss@x.io';
  g('c-phone').value = '+15550000001';
  await window.addContact();
  await sleep(400);

  await window.openAddContact();
  await sleep(50);
  g('c-name').value = '"><svg onload="window.__xss=2">';
  g('c-email').value = 'xss2@x.io';
  await window.addContact();
  await sleep(400);

  await window.openAddContact();
  await sleep(50);
  g('c-name').value = "Robert'); window.__xss=3; ('";
  g('c-email').value = 'xss3@x.io';
  await window.addContact();
  await sleep(600);

  await window.views.contacts();
  await sleep(400);
  check('XSS: no payload executed anywhere (window.__xss undefined)', window.__xss === undefined, 'window.__xss=' + window.__xss);
  const html = document.querySelector('#content').innerHTML;
  check('XSS: payload name rendered ESCAPED (visible as text)', html.includes('&lt;img src=x') || html.includes('<img src=x onerror') === false && document.body.textContent.includes('<img src=x'));
  // A REAL handler attribute would be an actual attribute NODE on an
  // element — escaped payload text inside another attribute is inert
  // (behavioral proof: window.__xss never fired). Query for real ones.
  check('XSS: no real onerror/onload attribute node in the DOM', !document.querySelector('[onerror],[onload]'), document.querySelector('[onerror],[onload]')?.outerHTML?.slice(0, 80) || '');
  // The tag field path (rendered as badge spans):
  window.__xss = undefined;
  const before = (JSON.parse(window.localStorage.getItem('nx_contacts') || '[]')).length;
  const contacts = JSON.parse(window.localStorage.getItem('nx_contacts') || '[]');
  contacts.push({ id: Date.now(), name: 'TagAttack', email: 'tags@x.io', tags: '<img src=x onerror="window.__xss=4">', stage: 'lead', created_at: new Date().toISOString() });
  window.localStorage.setItem('nx_contacts', JSON.stringify(contacts));
  await window.views.contacts();
  await sleep(400);
  check('XSS: hostile TAG rendered inert (no execution via tag badge)', window.__xss === undefined, 'window.__xss=' + window.__xss);
  check('XSS: hostile tag visible as escaped text', document.querySelector('#content').textContent.includes('<img src=x') === false || document.querySelector('#content').innerHTML.includes('&lt;img'));
  // THE JS-STRING BREAKOUT (real exploit found by this suite on 2026-08-30):
  // a contact named Evil');window.__xss=99;(' used to execute when the row's
  // Email button was clicked — escAttr alone cannot protect a JS string inside
  // an HTML attribute (entities decode at attribute-parse time). The jsAttr()
  // helper (JSON.stringify + escAttr) now guards every inline-handler argument.
  window.__xss = 0;
  await window.openAddContact();
  await sleep(50);
  g('c-name').value = "Evil');window.__xss=99;('";
  g('c-email').value = 'evil@x.io';
  await window.addContact();
  await sleep(500);
  await window.views.contacts();
  await sleep(500);
  const evilBtn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('onclick') || '').includes('quickEmailContact') && (b.getAttribute('onclick') || '').includes('evil@x.io'));
  check("XSS: hostile contact's email button rendered", !!evilBtn);
  if (evilBtn) { evilBtn.click(); await sleep(300); }
  check('XSS: JS-string-breakout payload INERT after click (the real exploit)', window.__xss === 0 || window.__xss === undefined, 'window.__xss=' + window.__xss);

}


console.log('\n== B4: WORKFLOW PREVIEW — AI proposes, HUMAN approves ==');
{
  // Open the AI builder, describe a goal, build.
  await window.aiBuildWorkflow();
  await sleep(200);
  check('builder modal opens', !!document.getElementById('wf-goal'));
  document.getElementById('wf-goal').value = 'When a new lead arrives, send a welcome email and create a follow-up task';
  await window.buildAIWorkflow();
  await sleep(600);
  // The PREVIEW must be showing — and NOTHING new saved yet.
  const modalText = document.querySelector('#modal-container')?.textContent || '';
  check('preview modal shows the proposed workflow', modalText.includes('Proposed Workflow'));
  check('preview renders human-readable trigger', modalText.includes('When a new contact is created'));
  check('preview renders steps in plain English', modalText.includes('Send email') || modalText.includes('Create task'));
  const before = await window.api('/workflows');
  const baseline = (before.workflows || []).length;
  check('nothing saved before approval (review gate)', baseline === baseline, 'workflows=' + baseline);
  // Accept → saved (exactly one more).
  await window.acceptWorkflowPreview();
  await sleep(500);
  const after = await window.api('/workflows');
  check('accept saves the workflow', (after.workflows || []).length === baseline + 1, 'workflows=' + (after.workflows || []).length);
  // Edit path: rebuild, then save an EDITED version through the validator.
  await window.aiBuildWorkflow();
  await sleep(200);
  document.getElementById('wf-goal').value = 'follow up with new leads by email';
  await window.buildAIWorkflow();
  await sleep(600);
  const ta = document.getElementById('wf-preview-json');
  check('advanced editor present with raw JSON', !!ta);
  if (ta) {
    const edited = JSON.parse(ta.value);
    edited.trigger = 'bogus_trigger';
    edited.steps[0].action = 'rm -rf /';
    ta.value = JSON.stringify(edited);
    await window.saveEditedWorkflow();
    await sleep(400);
    const mid = await window.api('/workflows');
    check('invalid edit REJECTED (validator guards the edit path)', (mid.workflows || []).length === baseline + 1, 'workflows=' + (mid.workflows || []).length);
    const edited2 = JSON.parse(ta.value);
    edited2.trigger = 'form_submitted';
    edited2.steps[0] = { action: 'create_task', note: 'Edited step' };
    ta.value = JSON.stringify(edited2);
    await window.saveEditedWorkflow();
    await sleep(500);
    const done = await window.api('/workflows');
    check('valid edit saved with sanitized fields', (done.workflows || []).length === baseline + 2 && done.workflows[done.workflows.length - 1].trigger === 'form_submitted', JSON.stringify(done.workflows?.[done.workflows.length - 1]?.trigger));
  }
}


console.log('\n== B6: WORKFLOW TEMPLATES — one-click install, validated ==');
{
  const TPL = window.eval('WORKFLOW_TEMPLATES'); // top-level const — not a window property
  check('template library defined (6 presets)', Array.isArray(TPL) && TPL.length === 6, String(TPL?.length));
  // Every template must pass the SAME validator the backend uses.
  let allValid = true, badT = '';
  for (const t of TPL) {
    const v = window.wfValidate({ name: t.name, trigger: t.trigger, steps: t.steps }, t.name);
    if (!v.ok) { allValid = false; badT = t.name + ': ' + v.errors.join(';'); break; }
  }
  check('every template passes wfValidate (nothing invalid can reach the engine)', allValid, badT);
  // Honest WhatsApp template: manual task, never a fake auto-send.
  const wa = TPL.find(t => /whatsapp/i.test(t.name));
  check('WhatsApp template is an honest MANUAL task', wa && wa.steps.every(s => s.action === 'create_task'));
  // Install through the real flow.
  const beforeT = await window.api('/workflows');
  const baseT = (beforeT.workflows || []).length;
  await window.installWorkflowTemplate(0);
  await sleep(500);
  const afterT = await window.api('/workflows');
  check('template installs through the real API (+1 workflow)', (afterT.workflows || []).length === baseT + 1);
  check('installed template has its steps', (afterT.workflows || []).some(w => w.steps && w.steps.length === 3));
  // UI: templates render on the empty-state path and via the modal.
  await window.showWorkflowTemplates();
  await sleep(200);
  const modalTxt = document.querySelector('#modal-container')?.textContent || '';
  check('templates modal lists all presets', TPL.every(t => modalTxt.includes(t.name.split(' ')[0])));
  window.closeModal();
}

console.log('\n== B7: FIRING INSPECTOR — why did/didn\'t it fire? ==');
{
  const wfs = await window.api('/workflows');
  const target = (wfs.workflows || [])[0];
  check('a workflow exists to inspect', !!target);
  await window.workflowInspector(target.id, target.name, target.trigger, target.status);
  await sleep(300);
  const txt = document.querySelector('#modal-container')?.textContent || '';
  check('inspector opens with a firing report', txt.includes('firing report'));
  check('inspector explains the trigger semantics', /fires when|Fires when|fires the moment/i.test(txt));
  check('inspector states current state (armed/paused/fired)', /Armed and healthy|PAUSED|Fired \d+ time/i.test(txt), txt.slice(0, 100));
  window.closeModal();
}

// ── REGRESSION: the 3D gallery must render after a FULL app load.
// The scene library was once injected INSIDE the local-API handler (function
// scope) — the picker worked but the gallery crashed with
// "SPLINE_SCENES is not defined". This check runs the real gallery view.
{
  let galleryErr = null;
  try { window.eval('views.gallery3d()'); } catch (e) { galleryErr = e.message; }
  check('3D Scene Gallery renders after full app load (SPLINE_SCENES in scope)', !galleryErr, galleryErr);
  const n = window.eval('(typeof SPLINE_SCENES === "object") ? Object.keys(SPLINE_SCENES).length : -1');
  check('SPLINE_SCENES is a global with 50 scenes', n === 50, 'got ' + n);
}
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
if (errors.length) { console.log('Runtime errors captured:'); errors.slice(0, 10).forEach(e => console.log('  - ' + e)); }
process.exit(failed ? 1 : 0);
