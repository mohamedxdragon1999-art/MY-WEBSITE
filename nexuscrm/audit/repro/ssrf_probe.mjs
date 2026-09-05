// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/ssrf_probe.mjs
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
let fetched = [];
globalThis.fetch = async (url, opts={}) => { const u=String(url); fetched.push(u + (opts.redirect?` redirect=${opts.redirect}`:'')); if(u.includes('api.openai.com')) return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}),{status:200,headers:{'Content-Type':'application/json'}}); return new Response('<html><head><title>Internal admin</title></head><body><h1>Metadata service</h1><p>'+ 'x'.repeat(200) +'</p></body></html>',{status:200,headers:{'Content-Type':'text/html'}}); };
async function call(method, path, body, token){ const h={'Content-Type':'application/json',Origin:'http://app.local'}; if(token) h.Authorization='Bearer '+token; const r=await worker.fetch(new Request(BASE+'/api'+path,{method,headers:h,body:body?JSON.stringify(body):undefined}),env,ctx); return {status:r.status,data:await r.json().catch(()=>null)}; }
const A = (await call('POST','/auth/register',{name:'A',email:'a@x.com',password:'password123',workspace_name:'WA'})).data.token;
const cases = [
  'http://169.254.169.254/latest/meta-data/',        // AWS metadata (dotted) — should block
  'http://2852039166/latest/meta-data/',              // 169.254.169.254 as decimal integer
  'http://0xA9FEA9FE/',                                // hex form
  'http://0251.0376.0251.0376/',                       // octal form
  'http://169.254.169.254.nip.io/',                    // DNS name → resolves to metadata IP (rebinding-style)
  'http://[::ffff:169.254.169.254]/',                  // IPv4-mapped IPv6
  'http://[0:0:0:0:0:ffff:a9fe:a9fe]/',                // IPv4-mapped IPv6 hex
  'http://metadata.google.internal/computeMetadata/v1/', // GCP metadata hostname
  'http://100.100.100.200/latest/meta-data/',          // Alibaba metadata
  'http://100.64.0.1/',                                // CGNAT range
  'http://127.1/',                                      // short loopback
  'http://0/',                                          // 0 → 0.0.0.0
  'http://localtest.me/',                              // public DNS → 127.0.0.1
  'http://[fe80::1]/',                                 // link-local v6 (should block)
  'http://10.0.0.1/',                                  // should block
];
for (const u of cases) {
  fetched = [];
  const r = await call('POST','/ai/scan-site',{url:u},A);
  const blocked = r.status===400 && /private\/internal/.test(r.data?.error||'');
  console.log(`${blocked?'✅ blocked':'❌ FETCHED'}  ${u}  → ${r.status} ${blocked?'':JSON.stringify(r.data).slice(0,80)} ${fetched.length?'| outbound: '+fetched[0]:''}`);
}
// Does scanner follow redirects (default) → public host 302 → 169.254.169.254?
fetched = [];
globalThis.fetch = async (url, opts={}) => { fetched.push(String(url)+' redirect='+(opts.redirect||'follow(default)')); return new Response('<html><head><title>t</title></head><body><p>'+ 'y'.repeat(200) +'</p></body></html>',{status:200,headers:{'Content-Type':'text/html'}}); };
await call('POST','/ai/scan-site',{url:'http://public.example.com/'},A);
console.log('redirect policy used by scanner fetch:', fetched[0]);
process.exit(0);
