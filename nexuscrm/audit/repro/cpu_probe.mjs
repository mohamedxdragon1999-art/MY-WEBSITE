// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/cpu_probe.mjs
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
globalThis.fetch = async () => new Response(JSON.stringify({choices:[{message:{content:'<section class="nx-hero"><h1>Hello</h1><p class="lead">World</p></section>'}}]}),{status:200,headers:{'Content-Type':'application/json'}});
async function measure(label, fn){ // warm + 3 runs, report min CPU (user+sys) and wall
  await fn(); const rows=[]; for (let i=0;i<3;i++){ const c0=process.cpuUsage(); const t0=performance.now(); const r=await fn(); const c=process.cpuUsage(c0); rows.push({cpu:(c.user+c.system)/1000, wall:performance.now()-t0, status:r.status, bytes:(r.data&&r.data.html||'').length}); }
  const best=rows.reduce((a,b)=>a.cpu<b.cpu?a:b); console.log(label.padEnd(58), 'CPU', best.cpu.toFixed(0).padStart(5),'ms  wall', best.wall.toFixed(0).padStart(5),'ms  status', best.status, ' html', best.bytes, 'B'); }
await measure('POST /sites deterministic (sentinel, no AI key)', ()=>call('POST','/sites',{name:'S', description:'Plumber in Cairo', build_with_ai:true, deterministic:true, design_id:'sentinel'},token));
await measure('POST /sites deterministic (template design)', ()=>call('POST','/sites',{name:'S', description:'Plumber in Cairo', build_with_ai:true, deterministic:true, design_id:'template'},token));
await call('PATCH','/ai/settings',{provider:'nvidia', nvidia_key:'nvapi-abcdefghijklmnop1234567890'},token);
await measure('POST /sites with (stubbed, instant) AI body', ()=>call('POST','/sites',{name:'S', description:'Plumber in Cairo', build_with_ai:true, design_id:'sentinel'},token));
await measure('POST /ai/agentic-build (stubbed AI)', ()=>call('POST','/ai/agentic-build',{name:'S', description:'Plumber in Cairo'},token));
await measure('GET /s/:slug (public serve)', async()=>{ const r=await worker.fetch(new Request(BASE+'/s/'+((await call('GET','/sites',null,token)).data[0]||{}).slug),env,ctx); return {status:r.status,data:{html:await r.text()}}; });
await measure('POST /ai/complete (stubbed provider)', ()=>call('POST','/ai/complete',{prompt:'hi'},token));
await measure('GET /contacts (baseline CRUD)', ()=>call('GET','/contacts',null,token));
console.log('\nReference: Cloudflare Workers CPU limit = 10 ms/request on the Free plan (docs/README promise "free tier"), 30 s default on Paid.');
process.exit(0);
