// AURORA OVERHAUL tests — v0.0.1.0 non-AI upgrade suite.
// Boots the REAL NexusCRM_V4_Hardened.html in jsdom (local-only mode,
// network disabled) and drives the Aurora layer end-to-end:
// appearance system + persistence, dashboard today-strip / checklist /
// real KPI sparklines, command-palette upgrade (recents + actions),
// shortcuts overlay, and the CSS design-system layer.
// Run: node tests/test_aurora.mjs
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
    try { Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true }); } catch (e) {}
    window.fetch = async (url) => { throw new TypeError('network disabled: ' + url); };
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

await sleep(300);
const g = id => document.getElementById(id);
const LS = k => { try { return JSON.parse(window.localStorage.getItem(k)); } catch (e) { return null; } };

console.log('\n== A1: BOOT & DEFAULTS ==');
check('AURORA object exposed', typeof window.AURORA === 'object' && window.AURORA !== null);
check('default state (indigo/dark/comfortable/motion on)',
  window.AURORA.state.accent === 'indigo' && window.AURORA.state.theme === 'dark' &&
  window.AURORA.state.density === 'comfortable' && window.AURORA.state.motion === 'on',
  JSON.stringify(window.AURORA.state));
check('appearance applied to <html> at boot',
  document.documentElement.getAttribute('data-accent') === 'indigo' &&
  document.documentElement.getAttribute('data-theme') === 'dark');

console.log('\n== A2: CSS DESIGN-SYSTEM LAYER ==');
{
  const style = document.getElementById('aurora-css');
  const css = style ? style.textContent : '';
  check('aurora-css style block present in <head>', !!style && !!css);
  check('6 user-pickable accent themes defined',
    ['violet', 'cyan', 'emerald', 'amber', 'rose'].every(a => css.includes('html[data-accent="' + a + '"]')));
  check('light-mode token overrides exist', css.includes('html[data-theme="light"]'));
  check('compact density mode exists', css.includes('html[data-density="compact"]'));
  check('motion-off kill switch exists', css.includes('html[data-motion="off"]'));
  check('aurora background drift animation exists', css.includes('@keyframes auroraDrift'));
  check('staggered view entrance animation exists', css.includes('@keyframes auroraRise'));
  check('glass/backdrop-filter upgrade present', css.includes('backdrop-filter'));
  check('prefers-reduced-motion respected', css.includes('@media (prefers-reduced-motion:reduce)'));
  check('sparkline + checklist + today-strip component styles present',
    css.includes('.aurora-spark') && css.includes('.aurora-checklist') && css.includes('.aurora-today'));
}

console.log('\n== A3: APPEARANCE PERSISTENCE ==');
window.AURORA.setAccent('emerald');
check('accent switch applies live', document.documentElement.getAttribute('data-accent') === 'emerald');
check('accent persists to localStorage', LS('nx_aurora')?.accent === 'emerald');
window.AURORA.toggleTheme();
check('light mode applies + persists', document.documentElement.getAttribute('data-theme') === 'light' && LS('nx_aurora')?.theme === 'light');
window.AURORA.toggleDensity();
check('compact density applies + persists', document.documentElement.getAttribute('data-density') === 'compact' && LS('nx_aurora')?.density === 'compact');
window.AURORA.set({ theme: 'dark', density: 'comfortable', accent: 'indigo' });
check('restore defaults works', document.documentElement.getAttribute('data-theme') === 'dark' && document.documentElement.getAttribute('data-accent') === 'indigo');

console.log('\n== A4: LOGIN + DASHBOARD (today strip, checklist, first-visit hint) ==');
g('reg-name').value = 'Aurora Tester';
g('reg-email').value = 'aurora@test.com';
g('reg-password').value = 'password123';
await window.doRegister();
await sleep(500);
check('logged in', g('auth-screen').style.display === 'none');
await window.navigate('dashboard');
await sleep(500);
check('today strip rendered with live date', !!document.querySelector('.aurora-today') && /📆/.test(document.querySelector('.aurora-today').textContent));
check('quick actions: contact / deal / task / backup / 3D',
  ['＋ Contact', '＋ Deal', '＋ Task', '💾 Backup', '✨ 3D'].every(t => document.querySelector('.aurora-today')?.textContent.includes(t)));
check('getting-started checklist for empty workspace',
  !!document.querySelector('.aurora-checklist') && document.querySelector('.aurora-checklist').textContent.includes('Getting started'));
check('checklist steps are honest (0 of 4 done)', document.querySelector('.aurora-checklist').textContent.includes('0 of 4'));
check('first visit shows trend hint (no fake sparkline yet)',
  document.querySelector('.aurora-spark')?.textContent.includes('next visit'));
{
  const hist = LS('nx_kpi_history');
  check('real KPI snapshot recorded on dashboard visit',
    Array.isArray(hist) && hist.length >= 1 && typeof hist[0].c === 'number' && typeof hist[0].p === 'number',
    JSON.stringify(hist));
}

console.log('\n== A5: SECOND VISIT → REAL SPARKLINES ==');
{
  // age the first snapshot past the 90s dedupe window, then revisit
  const hist = LS('nx_kpi_history') || [];
  if (hist.length) { hist[0].t = Date.now() - 120000; window.localStorage.setItem('nx_kpi_history', JSON.stringify(hist)); }
  await window.views.dashboard();
  await sleep(500);
  const spark = document.querySelector('.aurora-spark svg');
  check('sparkline SVG renders with 2+ real snapshots', !!spark, 'no svg in first stat card');
  check('sparkline has real polyline path', !!spark && /d="M/.test(spark.innerHTML));
  const hist2 = LS('nx_kpi_history');
  check('history now holds 2 snapshots', Array.isArray(hist2) && hist2.length === 2, JSON.stringify(hist2));
  check('delta badge vs last visit rendered', !!document.querySelector('.aurora-delta'));
  check('checklist still present (still empty workspace)', !!document.querySelector('.aurora-checklist'));
}

console.log('\n== A6: SETTINGS → APPEARANCE & ERGONOMICS CARD ==');
await window.navigate('settings');
await sleep(600);
{
  const card = document.getElementById('aurora-appearance');
  check('appearance card renders in Settings', !!card);
  check('6 accent swatches offered', card && card.querySelectorAll('[data-aurora-accent]').length === 6);
  check('mode / density / motion segmented controls present',
    card && card.querySelectorAll('[data-aurora-opt]').length === 6);
  const swatch = card.querySelector('[data-aurora-accent="amber"]');
  swatch.dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(50);
  check('clicking a swatch switches accent + persists',
    document.documentElement.getAttribute('data-accent') === 'amber' && LS('nx_aurora')?.accent === 'amber');
  const lightBtn = document.querySelector('#aurora-appearance [data-aurora-opt="theme"][data-aurora-val="light"]');
  lightBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(50);
  check('light-mode button works from Settings', document.documentElement.getAttribute('data-theme') === 'light');
  window.AURORA.set({ theme: 'dark', accent: 'indigo' });
}

console.log('\n== A7: COMMAND PALETTE UPGRADE (recents + Aurora actions) ==');
await window.navigate('contacts');
await sleep(300);
await window.navigate('tasks');
await sleep(300);
{
  const inp = g('global-search');
  inp.value = '';
  window.nxRenderCmdk();
  const box = g('cmdk');
  const txt = box?.textContent || '';
  check('palette lists recently viewed views', txt.includes('Recently viewed') && txt.includes('Contacts'));
  check('palette offers Aurora actions (theme / accent / density / shortcuts)',
    ['light / dark', 'accent', 'density', 'shortcuts'].every(t => txt.toLowerCase().includes(t)));
  inp.value = 'accent';
  window.nxRenderCmdk();
  check('fuzzy search finds Aurora actions', (g('cmdk')?.textContent || '').toLowerCase().includes('accent'));
  window.nxCloseCmdk();
  check('recents persisted', (LS('nx_recent_views') || []).includes('contacts'));
}

console.log('\n== A8: SHORTCUTS OVERLAY + HOTKEYS ==');
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }));
await sleep(100);
{
  const modal = document.getElementById('modal-overlay');
  const txt = modal?.textContent || '';
  check('? key opens shortcuts overlay', txt.includes('Keyboard Shortcuts'));
  check('overlay documents the new Aurora hotkeys',
    txt.includes('Ctrl + Shift + L') && txt.includes('Ctrl + Shift + A') && txt.includes('Ctrl + Shift + D'));
  window.closeModal();
}
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'L', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
await sleep(50);
check('Ctrl+Shift+L toggles theme', document.documentElement.getAttribute('data-theme') === 'light');
window.AURORA.set({ theme: 'dark' });

console.log('\n== A9: VERSION ==');
check('sidebar shows v0.0.1.9 — Graph-First Project Graph (the real runtime)', (g('sidebar')?.textContent || document.body.textContent).includes('v0.0.1.9'));

console.log('\n== A10: ZERO RUNTIME ERRORS ==');
check('no uncaught window errors during the whole flow', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
