// COMMAND PALETTE TESTS — the Ctrl+K upgrade: fuzzy search across
// contacts/deals/tasks + 27 actions, keyboard navigation, XSS-proof
// rendering, result caps. Extracts the real palette code from the shipped
// HTML and exercises it with stubs (no browser needed).
//
// Run: node tests/test_cmdk.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'NexusCRM_V4_Hardened.html'), 'utf8');

// extract the palette engine + handleGlobalSearch from the shipped file
const engine = html.slice(html.indexOf('const NX_CMDK_MAX'), html.indexOf('function handleGlobalSearch'));
const hs = html.indexOf('function handleGlobalSearch');
let depth = 0, end = hs;
for (let i = html.indexOf('{', hs); i < html.length; i++) {
  if (html[i] === '{') depth++;
  else if (html[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
}
const handle = html.slice(hs, end);

const els = {};
const mkEl = () => ({ style: {}, innerHTML: '', value: '', blur() {}, focus() {}, select() {}, getAttribute: () => () => '', querySelectorAll: () => [] });
const escFn = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sb = {
  console,
  V: (id) => els[id] || (els[id] = mkEl()),
  esc: escFn,
  toast: () => {},
  navigate: () => {},
  views: { contacts: () => {} },
  document: { querySelectorAll: () => [], querySelector: () => null },
  loadDB: () => ({
    contacts: [
      { id: 1, name: 'Mohamed Ali', email: 'mo@x.io', company: 'Acme' },
      { id: 2, name: 'Sarah<img onerror=alert(1)>', email: 's@x.io' },
    ],
    deals: [{ id: 1, title: 'Big deal', value: 5000, stage: 'proposal' }],
    tasks: [{ id: 1, title: 'Call client', status: 'todo' }],
  }),
};
sb.window = sb;
vm.createContext(sb);
vm.runInContext(engine + handle, sb);
vm.runInContext('globalThis.__gi=()=>__cmdkItems; globalThis.__gs=()=>__cmdkSel;', sb);

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const items = () => sb.__gi() || [];

check('fuzzy matcher scores real subsequence matches', sb.nxFuzzy('moh', 'Mohamed Ali') > 0);
check('fuzzy matcher rejects non-matches', sb.nxFuzzy('zzz', 'Mohamed Ali') === -1);

els['global-search'] = mkEl(); els['global-search'].value = '';
sb.nxRenderCmdk();
check('empty query shows the 12 quick actions', items().length === 12 && els['cmdk'].innerHTML.includes('Quick actions'));

sb.handleGlobalSearch({ key: 'ArrowDown', preventDefault() {} });
check('ArrowDown moves the selection down', sb.__gs() === 1);
sb.handleGlobalSearch({ key: 'ArrowUp', preventDefault() {} });
check('ArrowUp moves the selection back up', sb.__gs() === 0);
sb.handleGlobalSearch({ key: 'ArrowUp', preventDefault() {} });
check('ArrowUp wraps around to the last item from the top', sb.__gs() === 11);

els['global-search'].value = 'mohamed'; sb.nxRenderCmdk();
check('contacts are found by fuzzy query', items().some((i) => i.title === 'Mohamed Ali'));
check('data results are grouped under "Your data"', els['cmdk'].innerHTML.includes('Your data'));

els['global-search'].value = 'sarah'; sb.nxRenderCmdk();
check('XSS-poisoned contact names are escaped in the rendered palette', els['cmdk'].innerHTML.includes('&lt;img onerror=') && !els['cmdk'].innerHTML.includes('<img onerror='));

els['global-search'].value = 'invo'; sb.nxRenderCmdk();
check('action search finds Invoices', items().some((i) => i.title === 'Invoices'));
els['global-search'].value = '3d'; sb.nxRenderCmdk();
check('the 3D Scene Gallery is reachable through the palette', items().some((i) => i.title === '3D Scene Gallery'));
els['global-search'].value = 'depl'; sb.nxRenderCmdk();
check('deploy backend is reachable through the palette', items().some((i) => i.title === 'Deploy my backend'));

let ran = false; sb.navigate = () => { ran = true; };
sb.handleGlobalSearch({ key: 'Enter', preventDefault() {} });
check('Enter runs the selected action', ran);
sb.handleGlobalSearch({ key: 'Escape' });
check('Escape closes the palette', els['cmdk'].style.display === 'none');

const big = [];
for (let i = 0; i < 50; i++) big.push({ id: i, name: 'Contact ' + i, email: 'c' + i + '@x.io' });
sb.loadDB = () => ({ contacts: big, deals: [], tasks: [] });
els['global-search'].value = 'contact'; sb.nxRenderCmdk();
check('data results are hard-capped at 8', items().filter((i) => i.group === 'Your data').length <= 8);
check('command results are hard-capped at 6', items().filter((i) => i.group === 'Actions').length <= 6);
check('palette markup exists in the shipped HTML', html.includes('id="cmdk"') && html.includes('NX_CMDK_MAX'));
check('Ctrl+K opens the palette (not just focus)', /key === 'k'[\s\S]{0,120}nxRenderCmdk/.test(html));

console.log('\n' + '═'.repeat(56));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('FAILED:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(failed ? 1 : 0);
