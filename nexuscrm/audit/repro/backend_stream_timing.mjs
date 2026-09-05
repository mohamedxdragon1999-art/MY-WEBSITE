// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/backend_stream_timing.mjs
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { init, DB } = require((ROOT+'tests/d1mock.js'));
await init(readFileSync((ROOT+'backend/schema.sql'),'utf8'));
const worker = (await import(pathToFileURL(ROOT+'backend/src/index.js').href)).default;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(()=>{}) };
const BASE='http://test.local';
globalThis.fetch = async () => new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}),{status:200,headers:{'Content-Type':'application/json'}});
async function call(method, path, body, token){ const h={'Content-Type':'application/json',Origin:'http://app.local'}; if(token) h.Authorization='Bearer '+token; const r=await worker.fetch(new Request(BASE+'/api'+path,{method,headers:h,body:body?JSON.stringify(body):undefined}),env,ctx); return {status:r.status,data:await r.json().catch(()=>null)}; }
const reg = await call('POST','/auth/register',{name:'T',email:'t@x.com',password:'password123',workspace_name:'W'});
const token = reg.data.token;
await call('PATCH','/ai/settings',{provider:'nvidia',nvidia_key:'nvapi-testkey12345',model:'nvidia/llama-3.1-nemotron-70b-instruct'},token);
const wc = await call('GET','/webchat',null,token); const pubTok = wc.data.public_token;
// Realistic NVIDIA NIM sequence, each SSE event in its own network chunk, 20ms apart
const events = ['data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n','data: {"choices":[{"delta":{"content":"Hi "}}]}\n\n','data: {"choices":[{"delta":{"content":"there"}}]}\n\n','data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"total_tokens":9}}\n\n','data: [DONE]\n\n'];
function fakeUpstream(){ globalThis.fetch = async () => { let i=0; const enc=new TextEncoder(); const body=new ReadableStream({ async pull(c){ await new Promise(r=>setTimeout(r,20)); if(i>=events.length){c.close();return;} c.enqueue(enc.encode(events[i++])); } }); return new Response(body,{status:200,headers:{'Content-Type':'text/event-stream'}}); }; }
async function timeline(label, res, limitMs){
  const reader = res.body.getReader(); const dec=new TextDecoder(); const t0=Date.now(); const log=[];
  while(true){ const r = await Promise.race([reader.read(), new Promise(r2=>setTimeout(()=>r2({__timeout:true}),limitMs))]); if(r.__timeout){ log.push(`+${Date.now()-t0}ms ❌ NO MORE DATA (watchdog ${limitMs}ms)`); break;} if(r.done){ log.push(`+${Date.now()-t0}ms <stream end>`); break;} const txt=dec.decode(r.value); log.push(`+${Date.now()-t0}ms ${JSON.stringify(txt.trim().slice(0,70))}`); if(/"done":true/.test(txt)) { /* keep reading to see close */ } }
  console.log(`\n=== ${label} ===\n` + log.join('\n'));
}
fakeUpstream();
await timeline('/ai/chat/stream (authenticated CRM chat; has 15s keepalive)', await worker.fetch(new Request(BASE+'/api/ai/chat/stream',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://app.local',Authorization:'Bearer '+token},body:JSON.stringify({messages:[{role:'user',content:'hello'}],memory:false})}),env,ctx), 40000);
fakeUpstream();
await timeline('/public/webchat/:token/message (visitor widget; NO keepalive)', await worker.fetch(new Request(BASE+`/api/public/webchat/${pubTok}/message`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://site.example'},body:JSON.stringify({message:'hello',visitor_id:'v1'})}),env,ctx), 20000);
process.exit(0);
