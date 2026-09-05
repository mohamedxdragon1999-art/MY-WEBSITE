// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/idor_sweep.mjs
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { init, DB } = require((ROOT+'tests/d1mock.js'));
await init(readFileSync((ROOT+'backend/schema.sql'),'utf8'));
const worker = (await import(pathToFileURL(ROOT+'backend/src/index.js').href)).default;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 }; const ctx = { waitUntil: (p) => Promise.resolve(p).catch(()=>{}) }; const BASE='http://test.local';
globalThis.fetch = async () => new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}),{status:200,headers:{'Content-Type':'application/json'}});
async function call(method, path, body, token){ const h={'Content-Type':'application/json',Origin:'http://app.local'}; if(token) h.Authorization='Bearer '+token; const r=await worker.fetch(new Request(BASE+'/api'+path,{method,headers:h,body:body?JSON.stringify(body):undefined}),env,ctx); return {status:r.status,data:await r.json().catch(()=>null)}; }
const A = (await call('POST','/auth/register',{name:'A',email:'a@x.com',password:'password123',workspace_name:'WA'})).data.token;
const B = (await call('POST','/auth/register',{name:'B',email:'b@x.com',password:'password123',workspace_name:'WB'})).data.token;
// Create one of everything in A
const mk = {
  contacts: {name:'C1', email:'c1@a.com'}, deals: {title:'D1', value: 100}, tasks: {title:'T1'}, messages: {channel:'email', body:'hi', subject:'s'}, appointments: {title:'Ap', date:'2030-01-01', time:'10:00'},
  reviews: {author:'R', rating:5, text:'good', reviewer_name:'R'}, invoices: {amount: 10, contact_id: 1, number:'INV-1', items:[{desc:'x', amount:10}]}, workflows: {name:'W', trigger:'new_contact', steps:[{type:'add_tag', tag:'x'}]},
  forms: {name:'F', fields:[{name:'email',type:'email'}]}, funnels: {name:'Fu'}, courses: {title:'Co', name:'Co'}, community: {title:'P', content:'c'}, affiliates: {name:'Af', email:'af@a.com'}, 'trigger-links': {name:'TL', redirect_url:'https://x.y'}, social: {platform:'twitter', content:'hi', scheduled_at:'2030-01-01T10:00:00Z'}, 'sub-accounts': {name:'SA'}, sites: {name:'S', html:'<p>a</p>'},
};
const ids = {}; const createFails = [];
for (const [root, body] of Object.entries(mk)) { const r = await call('POST', '/'+root, body, A); const id = r.data && (r.data.id || (r.data[Object.keys(r.data)[0]]||{}).id); if (r.status===200 && id) ids[root]=id; else createFails.push(root+':'+r.status+':'+JSON.stringify(r.data).slice(0,60)); }
console.log('created in A:', Object.keys(ids).join(', ')); if (createFails.length) console.log('could not create (skipped):', createFails.join(' | '));
// Sub-routes to try as B
const subs = ['', '/html', '/snapshots', '/runs', '/submissions', '/audit', '/test', '/visual', '/design', '/import', '/duplicate', '/send', '/publish', '/clicks', '/stats', '/enroll', '/members', '/leads', '/steps', '/complete'];
const leaks = [];
for (const [root, id] of Object.entries(ids)) {
  for (const sub of subs) for (const method of ['GET','PATCH','DELETE','POST']) {
    if (sub==='' && method==='POST') continue;
    const body = method==='GET'||method==='DELETE' ? null : (method==='PATCH' ? {name:'pwn', title:'pwn'} : {label:'x', name:'x'});
    const r = await call(method, `/${root}/${id}${sub}`, body, B);
    if (r.status === 200) leaks.push(`${method} /${root}/:id${sub} → 200 ${JSON.stringify(r.data).slice(0,70)}`);
  }
}
console.log('\nCross-tenant (B on A\'s ids) responses that returned 200:');
console.log(leaks.length ? leaks.map(l=>'  ❌ '+l).join('\n') : '  ✅ none');
// verify A's data still intact after the sweep
const after = {}; for (const [root,id] of Object.entries(ids)) { const r = await call('GET', `/${root}/${id}`, null, A); after[root]=r.status; }
console.log('\nA\'s records after sweep (GET status by A):', JSON.stringify(after));
process.exit(0);
