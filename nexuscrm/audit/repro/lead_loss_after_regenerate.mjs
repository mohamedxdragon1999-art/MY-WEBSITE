// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/lead_loss_after_regenerate.mjs
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { init, DB } = require((ROOT+'tests/d1mock.js'));
await init(readFileSync((ROOT+'backend/schema.sql'),'utf8'));
const worker = (await import(pathToFileURL(ROOT+'backend/src/index.js').href)).default;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9, ENCRYPTION_KEY: 'test-secret' }; const ctx = { waitUntil: (p) => Promise.resolve(p).catch(()=>{}) }; const BASE='http://test.local';
async function call(method, path, body, token){ const h={'Content-Type':'application/json',Origin:'http://app.local'}; if(token) h.Authorization='Bearer '+token; const r=await worker.fetch(new Request(BASE+'/api'+path,{method,headers:h,body:body?JSON.stringify(body):undefined}),env,ctx); return {status:r.status,data:await r.json().catch(()=>null)}; }
const token = (await call('POST','/auth/register',{name:'T',email:'t@x.com',password:'password123',workspace_name:'W'})).data.token;
const wc = (await call('GET','/webchat',null,token)).data; const webhook = BASE+'/api/public/webhook/'+wc.public_token;
// The runtime posts the enquiry form to the JS literal `var NX_LEAD_URL="…";`
const leadUrlOf = (html) => { const m = String(html||'').match(/var NX_LEAD_URL=("(?:[^"\\]|\\.)*"|'[^']*');/); if (!m) return null; try { return JSON.parse(m[1].replace(/^'|'$/g,'"')); } catch { return m[1]; } };
const target = async (id) => { const r = await call('GET','/sites/'+id,null,token); const u = leadUrlOf(r.data.html); return u === null ? '(no form js)' : u; };
const submit = async (id) => { const html=(await call('GET','/sites/'+id,null,token)).data.html; const url=leadUrlOf(html)||''; const r=await worker.fetch(new Request(url||BASE+'/s/x',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Lead',email:'lead@x.com',message:'hi',event:'site_lead'})}),env,ctx); return r.status; };
const s = await call('POST','/sites',{name:'X',description:'plumber',build_with_ai:true,deterministic:true,published:true,design_id:'sentinel',webhook_url:webhook},token);
console.log('1. created via wizard with webhook   → form posts to:', target(s.data.id) && await target(s.data.id) === webhook ? 'workspace webhook ✓' : await target(s.data.id), '| visitor submit →', await submit(s.data.id));
const before = ((r)=>Array.isArray(r)?r.length:(r.contacts||r.items||[]).length)((await call('GET','/contacts',null,token)).data);
await call('PATCH','/sites/'+s.data.id,{build_with_ai:true,published:true,design_id:'aurora',font:'',animation_level:'balanced'},token); // = saveSiteSettings body shape (no webhook_url)
console.log('2. after Site Settings save (design)  → form posts to:', JSON.stringify(await target(s.data.id)), '| visitor submit →', await submit(s.data.id));
await call('PATCH','/sites/'+s.data.id,{build_with_ai:true,instructions:'make it blue',published:true},token); // = doRegenerateSite
console.log('3. after "Regenerate with AI"         → form posts to:', JSON.stringify(await target(s.data.id)), '| visitor submit →', await submit(s.data.id));
const after = ((r)=>Array.isArray(r)?r.length:(r.contacts||r.items||[]).length)((await call('GET','/contacts',null,token)).data);
const inbox = (await DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE channel='webchat' AND direction='inbound' AND subject='Website form message'").first()).n;
console.log('contacts before/after the 3 visitor submissions:', before, '→', after, '(same visitor email → one contact) | inbox messages from the form:', inbox, inbox >= 3 ? '✅ every submission landed' : '❌ submissions lost');
process.exit(0);
