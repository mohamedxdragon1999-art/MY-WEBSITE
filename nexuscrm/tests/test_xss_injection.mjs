// v0.0.1.1 XSS-INJECTION SUITE (targets the NEW accessibility render paths).
//
// The a11y overhaul reads `title` attributes and copies them into aria-label,
// injects dialog markup on openModal, and announces toasts into a live region.
// Screen-reader plumbing is the right place to silently reintroduce HTML — this
// suite proves the new code NEVER turns user-controlled text into executable
// markup. It verifies (on actual DOM nodes, not substring heuristics):
//   • user data rendered through esc() stays escaped in list + modal output.
//   • decorateA11y copies a hostile `title` into a plain aria-label STRING
//     (setAttribute) and never creates an <img onerror> / executes anything.
//   • toast() escapes user text for display AND populates the live region via
//     textContent (inert), never innerHTML.
//   • .modal-close gets a safe "Close dialog" accessible name.
//
// Run: node tests/test_xss_injection.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'NexusCRM_V4_Hardened.html'), 'utf-8');

const XSS = '<img src=x onerror="window.__xss=1"><svg onload="window.__xss=1">';
const XSS2 = '"><script>window.__xss=2</script><img src=x onerror="window.__xss=2">';
// For a title ATTRIBUTE we must not carry a double-quote (that would break out of
// the attribute — an artifact of how this test builds HTML, not of the app).
const XSS_TITLE = '<img src=x onerror=window.__xss=1>';

const dom = new JSDOM(html, {
  url: 'http://localhost:3000/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.confirm = () => true;
    window.alert = () => {};
    try { Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true }); } catch (e) {}
    window.fetch = async () => { throw new TypeError('network disabled in XSS audit: ' + url); };
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

// ── Register + create a contact whose every field is hostile ─────────
document.getElementById('reg-name').value = 'XSS Audit';
document.getElementById('reg-email').value = 'xss@test.com';
document.getElementById('reg-password').value = 'password123';
await window.doRegister();
await sleep(300);
const contact = await window.api('/contacts', 'POST', { name: XSS, email: XSS2, company: XSS2, phone: XSS2, notes: XSS2, tags: XSS });
check('contact created with hostile payload', contact && contact.id);
check('no payload executed on creation (window.__xss undefined)', typeof window.__xss === 'undefined');
await sleep(120);

// render the contacts list (as the contacts view does)
await window.navigate('contacts');
await sleep(400);
const contentHtml = document.getElementById('content').innerHTML;

console.log('\n═══ ESCAPING OF USER DATA IN LIST RENDER ═══');
check('hostile name rendered as ESCAPED text (&lt;img present, not a real <img>)', contentHtml.includes('&lt;img'));
check('no <img onerror> element in the rendered list', document.querySelectorAll('#content img[onerror]').length === 0);
check('no onerror/onload attribute node in the list', document.querySelectorAll('#content [onerror], #content [onload]').length === 0);
check('no <script> element in the list', document.querySelectorAll('#content script').length === 0);
check('window.__xss still undefined after render', typeof window.__xss === 'undefined');

console.log('\n═══ modal a11y decoration must not inject ═══');
{
  // A modal whose markup carries a hostile `title` (no embedded quote → stays
  // inside the attribute value) on an empty icon-only control. decorateA11y
  // copies it to aria-label via setAttribute — must be inert.
  window.openModal('<div class="modal-title">Modal</div><button class="modal-close" onclick="window.closeModal()">×</button><div title="' + XSS_TITLE + '" style="width:20px"></div>');
  await sleep(150);
  const overlay = document.getElementById('modal-overlay');
  check('modal overlay opened', !!overlay);
  check('modal overlay exposed as role=dialog + aria-modal', overlay && overlay.getAttribute('role') === 'dialog' && overlay.getAttribute('aria-modal') === 'true');
  const closeBtn = overlay ? overlay.querySelector('.modal-close') : null;
  check('.modal-close got accessible name "Close dialog"', closeBtn && closeBtn.getAttribute('aria-label') === 'Close dialog');
  check('decorateA11y did NOT create an <img> from the hostile title', overlay && overlay.querySelectorAll('img').length === 0);
  check('no onerror/onload attribute node in the modal', overlay && overlay.querySelectorAll('[onerror],[onload]').length === 0);
  const icon = overlay ? overlay.querySelector('div[title]') : null;
  check('the icon-only control has aria-label', icon && icon.hasAttribute('aria-label'));
  check('aria-label holds the literal payload as a STRING (inert, still announced)', icon && icon.getAttribute('aria-label') === XSS_TITLE);
  check('window.__xss undefined after modal a11y decoration', typeof window.__xss === 'undefined');
  window.closeModal();
}

console.log('\n═══ toast() → live region must be textContent-inert ═══');
{
  window.toast(XSS, 'warning', 5000);
  await sleep(120);
  const toasts = document.querySelectorAll('#toast-container .toast');
  check('toast rendered', toasts.length >= 1);
  const lastToast = toasts[toasts.length - 1];
  check('toast text is escaped in the DOM (payload visible as text)', lastToast && lastToast.textContent.includes('<img'));
  check('toast created no live <img onerror> node', document.querySelector('#toast-container img[onerror]') === null);
  check('window.__xss undefined after hostile toast', typeof window.__xss === 'undefined');
  const live = document.getElementById('a11y-live');
  check('live region auto-created for the announcement', !!live);
  check('live region populated with plain TEXT (no child elements)', live && live.children.length === 0);
  check('announced text === the exact string (inert)', live && live.textContent === XSS);
  check('live region never used innerHTML (no element injection)', live && !live.querySelector('img'));
  check('window.__xss undefined after live-region announcement', typeof window.__xss === 'undefined');
}

console.log('\n═══ decorateA11y: [title] controls labeled as inert strings ═══');
{
  // Isolate the [title]-copy logic with a control we own.
  const probe = document.createElement('span');
  probe.setAttribute('title', XSS_TITLE);
  probe.textContent = ''; // empty text → eligible for labelling
  document.body.appendChild(probe);
  window.decorateA11y();
  check('empty-text [title] control labelled with aria-label', probe.hasAttribute('aria-label') && probe.getAttribute('aria-label') === XSS_TITLE);
  check('empty-text [title] control got role=button', probe.getAttribute('role') === 'button');
  probe.remove();

  const sidebar = document.getElementById('sidebar');
  const main = document.getElementById('main');
  check('sidebar has role=navigation + label', sidebar && sidebar.getAttribute('role') === 'navigation');
  check('main has role=main', main && main.getAttribute('role') === 'main');
  check('no onerror/onload nodes created anywhere', document.querySelectorAll('img[onerror], [onload]').length === 0);
  check('no script nodes added by decoration', document.querySelectorAll('script').length <= 1);
  check('window.__xss undefined end-to-end', typeof window.__xss === 'undefined');
  // decorateA11y is idempotent
  const liveCountBefore = document.querySelectorAll('#a11y-live').length;
  window.decorateA11y(); window.decorateA11y();
  check('decorateA11y idempotent (one #a11y-live only)', document.querySelectorAll('#a11y-live').length === liveCountBefore && liveCountBefore === 1);
}

console.log('\n═════════════════════════════════════════════');
if (failed === 0) {
  console.log('✅ XSS-INJECTION SUITE: PASS — every new a11y render path keeps user data inert');
  console.log('RESULTS: ' + passed + ' passed, 0 failed');
  process.exit(0);
} else {
  console.log(`❌ XSS-INJECTION SUITE: ${passed} passed / ${failed} failed — ${failures.join(', ')}`);
  process.exit(1);
}
