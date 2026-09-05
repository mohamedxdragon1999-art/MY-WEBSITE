// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/webchat_inbox.mjs
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
const token = (await call('POST','/auth/register',{name:'T',email:'t@x.com',password:'password123',workspace_name:'W'})).data.token;
await call('PATCH','/ai/settings',{provider:'nvidia',nvidia_key:'nvapi-testkey12345',model:'nvidia/llama-3.1-nemotron-70b-instruct'},token);
const pubTok = (await call('GET','/webchat',null,token)).data.public_token;
const events = ['data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n','data: {"choices":[{"delta":{"content":"Hi "}}]}\n\n','data: {"choices":[{"delta":{"content":"there"}}]}\n\n','data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"total_tokens":9}}\n\n','data: [DONE]\n\n'];
globalThis.fetch = async () => { let i=0; const enc=new TextEncoder(); const body=new ReadableStream({ async pull(c){ await new Promise(r=>setTimeout(r,20)); if(i>=events.length){c.close();return;} c.enqueue(enc.encode(events[i++])); } }); return new Response(body,{status:200,headers:{'Content-Type':'text/event-stream'}}); };
const res = await worker.fetch(new Request(BASE+`/api/public/webchat/${pubTok}/message`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://site.example'},body:JSON.stringify({message:'hello',visitor_id:'v1'})}),env,ctx);
// Emulate the shipped widget: read until 45s watchdog (shortened to 3s here), then stop reading.
const reader=res.body.getReader(); const dec=new TextDecoder(); let full='';
while(true){ const r=await Promise.race([reader.read(), new Promise(r2=>setTimeout(()=>r2({t:true}),3000))]); if(r.t||r.done) break; for(const l of dec.decode(r.value).split('\n')){ if(l.startsWith('data: ')){ try{const d=JSON.parse(l.slice(6)); if(d.delta) full+=d.delta;}catch{} } } }
await new Promise(r=>setTimeout(r,300));
const rows = await DB.prepare("SELECT body, direction, ai_generated FROM messages WHERE channel='webchat' ORDER BY id").all();
console.log('visitor saw:', JSON.stringify(full));
console.log('inbox rows:', JSON.stringify(rows.results));
console.log(rows.results.some(m=>String(m.body).startsWith('AI: ')) ? '✅ AI reply saved to inbox' : '❌ AI reply NEVER saved to inbox (saveReply() lives inside pull(), which is never re-invoked after the finish_reason chunk)');
process.exit(0);
