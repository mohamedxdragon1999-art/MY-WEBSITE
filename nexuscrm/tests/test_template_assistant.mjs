// NexusCRM — the generated site's BUILT-IN ASSISTANT (v0.0.0.0.19).
//
// Before this unit the template chat had a dead brain: every "knowledge"
// function it relied on (smallTalk, obMathAnswer, SENTINEL_KB, …) was undefined
// in the shipped bundle, so under mode:'custom' most questions fell through to
// a bare "How can I help?" — with a random "Sure — " opener glued on. The header
// also advertised an on-device Qwen model and, on browsers without WebGPU, the
// FIRST message triggered a ~400 MB GGUF download from Hugging Face.
//
// This suite EXECUTES the served page in jsdom (real runtime, real config) and
// pins the visitor-facing behaviour:
//   A. honest defaults — no model download, no misleading status line
//   B. answers come from the site's own facts (hours, phone, coverage, owner FAQ)
//   C. no guessing — unknown facts hand the visitor to the owner, never invent
//   D. every reply is a real sentence (no bare fallbacks, no random openers)
//   E. arithmetic / small talk / follow-ups behave
//   F. the empty brief (no phone, no hours, no owner) still degrades honestly
//
// Run: node tests/test_template_assistant.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const { init, DB } = require('./d1mock.js');
await init(readFileSync(join(__dirname, '..', 'backend', 'schema.sql'), 'utf8'));
const worker = (await import(join(__dirname, '..', 'backend', 'src', 'index.js'))).default;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => { }) };

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', Origin: 'http://app.local' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await worker.fetch(new Request('http://test.local/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  let data = null; try { data = await res.json(); } catch { }
  return { status: res.status, data };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Boot a served page with the runtime executing; stub what jsdom lacks.
function boot(html, url) {
  const vc = new VirtualConsole(); const errors = []; const fetches = [];
  vc.on('jsdomError', (e) => errors.push(String(e && (e.message || e)).slice(0, 200)));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', virtualConsole: vc, url: url || 'https://site.example.com/', beforeParse(w) {
      w.matchMedia = () => ({ matches: true, addEventListener() { }, addListener() { } });
      w.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe(el) { try { this.cb([{ isIntersecting: true, target: el }]); } catch { } } unobserve() { } disconnect() { } };
      w.requestAnimationFrame = () => 0; w.cancelAnimationFrame = () => { };
      w.HTMLCanvasElement.prototype.getContext = () => null;
      w.fetch = (u, init) => { fetches.push({ url: String(u), init }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); };
      w.scrollTo = () => { };
    },
  });
  return { w: dom.window, d: dom.window.document, errors, fetches };
}
const text = (d, sel) => Array.from(d.querySelectorAll(sel)).map((e) => e.textContent.replace(/\s+/g, ' ').trim());
// Wait for the runtime's own busy flag instead of guessing a delay: a long
// answer types out word by word and the send path ignores input while busy.
async function ask(page, q) {
  const n0 = page.d.querySelectorAll('#chatBody .msg.bot').length;
  page.w.eval('sendChat(' + JSON.stringify(q) + ')');
  for (let i = 0; i < 100; i++) { await sleep(60); if (!page.w.eval('chatBusy') && page.d.querySelectorAll('#chatBody .msg.bot').length > n0) break; }
  await sleep(40);
  const m = text(page.d, '#chatBody .msg.bot');
  return m[m.length - 1] || '';
}

console.log('\n== SETUP: build two template sites through the real route ==');
let token, rich, sparse;
{
  const r = await call('POST', '/auth/register', { name: 'A', email: 'assistant-' + Date.now() + '@example.com', password: 'password123' });
  token = r.data && r.data.token;
  check('register ok', !!token);
  const base = { build_with_ai: true, deterministic: true, design_id: 'template', webhook_url: 'https://hooks.example.com/w/lead' };
  const a = await call('POST', '/sites', Object.assign({}, base, { name: 'Bob Plumbing', description: 'Family plumbing business in Stafford since 2009. Owner Bob Smith. Open Mon-Fri 8am-6pm. 4.9 stars on Google from 120 reviews. Emergency callouts 24/7. Fully insured. Call 01785 123456 or bob@bobplumbing.co.uk' }), token);
  const b = await call('POST', '/sites', Object.assign({}, base, { name: 'Nile Plumbing', description: 'Plumber in Banha' }), token);
  check('rich brief builds', a.status === 200 && String(a.data && a.data.html || '').length > 50000, String(a.data && a.data.error || '').slice(0, 80));
  check('sparse brief builds', b.status === 200 && String(b.data && b.data.html || '').length > 50000, String(b.data && b.data.error || '').slice(0, 80));
  rich = boot(a.data.html, 'https://bob.example.com/');
  sparse = boot(b.data.html, 'https://nile.example.com/');
  await sleep(250);
  check('rich page executes with zero runtime errors', rich.errors.length === 0, rich.errors.slice(0, 2).join(' | '));
  check('sparse page executes with zero runtime errors', sparse.errors.length === 0, sparse.errors.slice(0, 2).join(' | '));
}

console.log('\n== A. Honest defaults: nothing downloads, nothing is oversold ==');
{
  const st = text(rich.d, '.chat-head .st')[0] || '';
  check('status line describes the built-in assistant, not an unloaded LLM', /Instant answers/.test(st) && !/Qwen|CPU|loads on first message/i.test(st), st);
  const ai = rich.w.eval('AICFG');
  check('default provider is the built-in brain (offline), not webllm', ai && ai.provider === 'offline', JSON.stringify(ai));
  const presets = rich.w.eval('PRESETS');
  check('the built-in assistant is a first-class preset', !!(presets && presets.offline && presets.offline.offline === true));
  rich.w.eval('openChat()'); await sleep(80);
  const before = rich.fetches.length;
  const reply = await ask(rich, 'hello');
  const modelDownloads = rich.fetches.filter((f) => /huggingface|\.gguf|esm\.run|jsdelivr/i.test(f.url));
  check('first message triggers NO model download and NO CDN import', modelDownloads.length === 0 && rich.fetches.length === before, rich.fetches.map((f) => f.url).join(','));
  check('greeting answers instantly', reply.length > 20, reply.slice(0, 100));
  const src = String(rich.w.eval('sendChat.toString()'));
  check('CPU GGUF fallback is opt-in (allowCpuDownload===true), never automatic', /allowCpuDownload===true/.test(src));
  check('no ephemeral chat state is persisted on a plain visit', !Object.keys(rich.w.localStorage).some((k) => /_ai$|_cfg$/.test(k)), Object.keys(rich.w.localStorage).join(','));
}

console.log('\n== B. Answers come from THIS site\'s facts ==');
{
  const g = text(rich.d, '#chatBody .msg.bot')[0] || '';
  check('greeting names the business, the industry noun and the owner', /Bob Plumbing/.test(g) && /a plumbing (business|company)/.test(g) && /reach Bob/.test(g), g.slice(0, 160));
  check('greeting grammar: never "We\u2019re a plumbing in"', !/a plumbing in/.test(g));
  const chips = text(rich.d, '#chatBody .chat-sugg button');
  check('starter chips are questions, not a button label with "?" appended', chips.length >= 3 && chips.every((c) => /\?$/.test(c)) && !chips.some((c) => /^Get a free quote\?$/i.test(c)), chips.join(' | '));
  const hours = await ask(rich, 'what are your opening hours?');
  check('hours question → the real hours', /8am-6pm/.test(hours), hours);
  const phone = await ask(rich, 'phone number?');
  check('phone question → the real number', /01785 123456/.test(phone), phone);
  const email = await ask(rich, 'whats your email');
  check('email question → the real address', /bob@bobplumbing\.co\.uk/.test(email), email);
  const owner = await ask(rich, 'who is the owner?');
  check('owner question → Bob, plumbing business, Stafford (no hours answer)', /Bob/.test(owner) && /Stafford/.test(owner) && !/8am/.test(owner), owner);
  const svc = await ask(rich, 'do you do bathrooms?');
  check('service question → that service card, confirmed', /^Yes/.test(svc) && /Bathrooms & kitchens/.test(svc), svc);
  const covered = await ask(rich, 'do you cover Stafford?');
  check('coverage question (inside area) → yes', /^Yes/.test(covered) && /Stafford/.test(covered), covered);
  const faq = await ask(rich, 'Do you charge a call-out fee?');
  check('owner FAQ question → the owner\u2019s exact answer', /no surprises on the invoice/.test(faq), faq);
  const fast = await ask(rich, 'how fast can you get here');
  check('speed question → the owner\u2019s speed FAQ, not hours', /arrival time/.test(fast), fast);
  const urgent = await ask(rich, 'I need someone urgently, my pipe burst');
  check('emergency → phone first + the 24/7 fact from the brief', /01785 123456/.test(urgent) && /24\/7/i.test(urgent), urgent);
}

console.log('\n== C. No guessing: unknown facts are handed to the owner ==');
{
  const price = await ask(rich, 'how much does a boiler service cost?');
  check('price question with no price list → says so, names the service, points to the owner', /boilers & heating/i.test(price) && /won\u2019t guess/.test(price) && /01785 123456/.test(price) && !/8am/.test(price), price);
  check('price reply carries no invented figure', !/£\s?\d|\$\s?\d|\d+\s?(?:EGP|GBP|USD)/.test(price), price);
  const stone = await ask(rich, 'do you cover Stone?');
  check('coverage question (outside listed area) → cannot confirm, not "yes"', /can\u2019t confirm Stone/.test(stone) && !/^Yes/.test(stone), stone);
  const septic = await ask(rich, 'tell me about septic tanks');
  check('off-topic service → honest "nothing written down" + what IS offered', /septic tanks/.test(septic) && /won\u2019t guess/.test(septic) && /Emergency repairs/.test(septic), septic);
  const insured = await ask(rich, 'are you insured?');
  check('insurance (in the brief as a differentiator) → confirmed from the brief', /^Yes/.test(insured) && /insured/i.test(insured), insured);
  const dbs = await ask(rich, 'are your staff DBS checked?');
  check('credential NOT in the brief → not asserted', !/^Yes/.test(dbs) && /won\u2019t guess|can confirm/.test(dbs), dbs);
  const cancel = await ask(rich, 'can I cancel a booking?');
  check('policy not written down → says so, no invented policy', /policy/.test(cancel) && /won\u2019t guess/.test(cancel), cancel);
}

console.log('\n== D. Every reply is a real sentence ==');
{
  const all = text(rich.d, '#chatBody .msg.bot');
  check('no bare "How can I help?" fallback anywhere', !all.some((t) => /^(Sure \u2014 |Of course \u2014 |Good question \u2014 |Happy to help\. )?How can I help\?$/.test(t)), all.filter((t) => /How can I help\?$/.test(t)).join(' | '));
  check('no random openers injected', !all.some((t) => /^(Sure|Of course|Good question) \u2014 /.test(t)));
  check('every reply ends with punctuation and is ≥ 30 chars', all.every((t) => t.replace(/How do I get in touch\?$/, '').trim().length >= 30 && /[.!?)]\s*(How do I get in touch\?)?$/.test(t)), all.filter((t) => !/[.!?)]\s*(How do I get in touch\?)?$/.test(t)).join(' | ').slice(0, 200));
  check('no template placeholders leak ({P}, {owner}, {{…}})', !all.some((t) => /\{[A-Za-z{]/.test(t)));
  check('markdown bold is rendered, not shown as **', !rich.d.querySelector('#chatBody .msg.bot') || !all.some((t) => /\*\*/.test(t)));
  const chipSets = Array.from(rich.d.querySelectorAll('#chatBody .chat-sugg')).map((s) => Array.from(s.querySelectorAll('button')).map((b) => b.textContent.trim()));
  check('follow-up chips never repeat a question already asked in this conversation', chipSets.slice(1).every((set) => !set.some((c) => /^what are your opening hours\?$/i.test(c))), JSON.stringify(chipSets.slice(-2)));
  check('quick-book chip is on its own line, not glued to the last word', Array.from(rich.d.querySelectorAll('#chatBody .msg.bot .quick-book')).every((b) => b.previousSibling && b.previousSibling.nodeName === 'BR'));
}

console.log('\n== E. Arithmetic, small talk, follow-ups ==');
{
  const math = await ask(rich, 'what is 12*7?');
  check('arithmetic is evaluated without Function()/eval', /84/.test(math), math);
  const pct = await ask(rich, 'what is 15% of 240');
  check('percentages work', /36/.test(pct), pct);
  const thanks = await ask(rich, 'thanks!');
  check('thanks → warm close, no fact dump', /welcome/i.test(thanks) && !/8am/.test(thanks), thanks);
  const bot = await ask(rich, 'are you a bot?');
  check('identity question → honest: automated, works from written facts', /automated/.test(bot) && /Bob/.test(bot), bot);
  await ask(rich, 'do you do boilers?');
  const follow = await ask(rich, 'how much?');
  check('elliptical follow-up ("how much?") is resolved against the previous topic', /boilers & heating/i.test(follow) && /01785 123456/.test(follow), follow);
  const src = String(rich.w.eval('nxMath.toString()') + rich.w.eval('nxEvalMath.toString()'));
  check('the calculator never compiles strings', !/new Function|\beval\(/.test(src));
}

console.log('\n== F. The sparse brief degrades honestly (no phone, no hours, no owner) ==');
{
  sparse.w.eval('openChat()'); await sleep(80);
  const g = text(sparse.d, '#chatBody .msg.bot')[0] || '';
  check('greeting has no owner line when no owner is known', /Nile Plumbing/.test(g) && !/reach\s+directly/.test(g) && !/reach our team directly/.test(g), g);
  const hours = await ask(sparse, 'what are your opening hours?');
  check('no hours on file → says so and offers the contact form (no invented hours)', /don\u2019t have opening hours/.test(hours) && /contact form/.test(hours) && !/\d\s*(am|pm)/.test(hours), hours);
  const price = await ask(sparse, 'how much does it cost?');
  check('no prices on file → no figure invented', !/£\s?\d|\$\s?\d|\d+\s?(EGP|GBP)/.test(price) && /contact form/.test(price), price);
  const urgent = await ask(sparse, 'my pipe burst');
  check('emergency with no phone → contact form, no fake number', /contact form/.test(urgent) && !/\d{4,}/.test(urgent), urgent);
  const owner = await ask(sparse, 'who runs this?');
  check('unknown owner → describes the business, never invents a name', /Nile Plumbing/.test(owner) && !/Bob|Martin/.test(owner), owner);
  const faqs = text(sparse.d, '#faqList .faq-q');
  check('FAQ entries that promise a phone call are not shipped without a phone number', !faqs.some((q) => /how fast/i.test(q)), faqs.join(' | '));
  const cover = await ask(sparse, 'do you cover Cairo?');
  check('coverage question → cannot confirm (no yes without evidence)', /can\u2019t confirm Cairo/.test(cover), cover);
  check('sparse page still zero runtime errors after the conversation', sparse.errors.length === 0, sparse.errors.slice(0, 2).join(' | '));
}

console.log('\n── ' + (failed ? 'FAILURES' : 'ALL PASSED') + ' — ' + passed + '/' + (passed + failed) + ' passing');
failures.forEach((f) => console.log('   ✗ ' + f));
console.log('ROUTE_COVERAGE_JSON: ' + JSON.stringify(['POST /api/auth/register', 'POST /api/sites']));
process.exit(failed ? 1 : 0);
