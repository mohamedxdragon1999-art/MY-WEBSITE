// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/ai_conn_probe.mjs
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { init, DB } = require((ROOT+'tests/d1mock.js'));
await init(readFileSync((ROOT+'backend/schema.sql'),'utf8'));
const worker = (await import(pathToFileURL(ROOT+'backend/src/index.js').href)).default;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9, ENCRYPTION_KEY: 'test-secret' }; const ctx = { waitUntil: (p) => Promise.resolve(p).catch(()=>{}) }; const BASE='http://test.local';
let log = [];
globalThis.fetch = async (url, opts={}) => { log.push({url:String(url), auth:(opts.headers||{}).Authorization||''}); return new Response(JSON.stringify({choices:[{message:{content:'ok'}}], model:'m'}),{status:200,headers:{'Content-Type':'application/json'}}); };
async function call(method, path, body, token){ const h={'Content-Type':'application/json',Origin:'http://app.local'}; if(token) h.Authorization='Bearer '+token; const r=await worker.fetch(new Request(BASE+'/api'+path,{method,headers:h,body:body?JSON.stringify(body):undefined}),env,ctx); return {status:r.status,data:await r.json().catch(()=>null)}; }
const token = (await call('POST','/auth/register',{name:'T',email:'t@x.com',password:'password123',workspace_name:'W'})).data.token;
// 1. NVIDIA custom base URL is honoured by chat/complete but IGNORED by /ai/models and /ai/health?
const s1 = await call('PATCH','/ai/settings',{provider:'nvidia', nvidia_key:'nvapi-abcdefghijklmnop1234567890', nvidia_base_url:'https://nim.mycorp.example/v1', model:'meta/llama-3.1-8b-instruct'},token);
console.log('1. save nvidia settings + custom base URL →', s1.status, JSON.stringify(s1.data).slice(0,160));
log=[]; await call('POST','/ai/complete',{prompt:'hi'},token); console.log('   /ai/complete called:', log.map(l=>l.url).join(', '));
log=[]; await call('GET','/ai/models?refresh=1',null,token); console.log('   /ai/models  called:', log.map(l=>l.url).join(', ') || '(no outbound call)');
log=[]; const h = await call('GET','/ai/health?refresh=1',null,token); console.log('   /ai/health  called:', log.map(l=>l.url).join(', '), '→ nvidia:', JSON.stringify(h.data?.nvidia).slice(0,120));
// 2. Invalid base URL rejected at save?
const s2 = await call('PATCH','/ai/settings',{nvidia_base_url:'http://169.254.169.254/latest'},token); console.log('2. save metadata-IP base URL →', s2.status, JSON.stringify(s2.data).slice(0,120));
const s2b = await call('PATCH','/ai/settings',{nvidia_base_url:'http://[::ffff:169.254.169.254]/v1'},token); console.log('   save IPv4-mapped-IPv6 metadata base URL →', s2b.status, JSON.stringify(s2b.data).slice(0,120));
const s2c = await call('PATCH','/ai/settings',{nvidia_base_url:'http://2852039166/v1'},token); console.log('   save decimal-IP metadata base URL →', s2c.status, JSON.stringify(s2c.data).slice(0,120));
if (s2c.status===200) { log=[]; await call('POST','/ai/complete',{prompt:'hi'},token); console.log('   → /ai/complete now calls:', log.map(l=>l.url).join(', ') || '(none)'); }
const s2d = await call('PATCH','/ai/settings',{provider:'custom', custom_base_url:'http://169.254.169.254/latest', custom_key:'x'},token); console.log('   save custom provider = metadata IP →', s2d.status, JSON.stringify(s2d.data).slice(0,100));
if (s2d.status===200) { log=[]; const c = await call('POST','/ai/complete',{prompt:'hi'},token); console.log('   → /ai/complete calls:', log.map(l=>l.url+' auth='+l.auth.slice(0,12)).join(', ') || '(none)', '| status', c.status); }
// 3. Key masking in GET /ai/settings
const g = await call('GET','/ai/settings',null,token); console.log('3. GET /ai/settings exposes raw key?', JSON.stringify(g.data).includes('nvapi-abcdefghijklmnop'), '| keys in response:', Object.keys(g.data||{}).filter(k=>/key/.test(k)).join(','), '| nvidia_key value:', JSON.stringify(g.data?.nvidia_key));
// 4. Encryption at rest
const row = await DB.prepare('SELECT ai_nvidia_key, ai_custom_key FROM workspaces LIMIT 1').first(); console.log('4. at rest:', JSON.stringify(row).slice(0,120));
// 5. Provider error → what does the user see? bad key 401 from NVIDIA
await call('PATCH','/ai/settings',{provider:'nvidia', nvidia_base_url:'', custom_base_url:''},token);
globalThis.fetch = async () => new Response(JSON.stringify({error:{message:'Invalid API key', code:'invalid_api_key'}}),{status:401,headers:{'Content-Type':'application/json'}});
const e1 = await call('POST','/ai/complete',{prompt:'hi'},token); console.log('5. 401 from provider →', e1.status, JSON.stringify(e1.data).slice(0,200));
globalThis.fetch = async () => new Response(JSON.stringify({detail:'Model not found: meta/llama-3.1-8b-instruct'}),{status:404,headers:{'Content-Type':'application/json'}});
const e2 = await call('POST','/ai/complete',{prompt:'hi'},token); console.log('   404 model →', e2.status, JSON.stringify(e2.data).slice(0,200));
globalThis.fetch = async () => new Response('<html>Cloudflare 522</html>',{status:522,headers:{'Content-Type':'text/html'}});
const e3 = await call('POST','/ai/complete',{prompt:'hi'},token); console.log('   522 html →', e3.status, JSON.stringify(e3.data).slice(0,200));
globalThis.fetch = async () => new Response(JSON.stringify({error:{message:'Rate limit', type:'requests'}}),{status:429,headers:{'Content-Type':'application/json','Retry-After':'7'}});
const t0=Date.now(); const e4 = await call('POST','/ai/complete',{prompt:'hi'},token); console.log('   429 Retry-After:7 →', e4.status, JSON.stringify(e4.data).slice(0,160), `(took ${Date.now()-t0}ms — did the worker sleep 7s inside the request?)`);
process.exit(0);
