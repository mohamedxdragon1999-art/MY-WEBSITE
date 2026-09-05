// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/template_pii4.mjs
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
const s = await call('POST','/sites',{name:'Bella Bakery', description:'An artisan bakery in Brighton', build_with_ai:true, deterministic:true, design_id:'template'},token);
const h = s.data.html;
// static (no-JS) view of the markup: which visible text nodes (outside <script>/<style>) contain the R C Atkin identity?
const noScript = h.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
const text = noScript.replace(/<[^>]+>/g,'\n').split('\n').map(s=>s.trim()).filter(Boolean);
const hits = text.filter(t => /Martin|septic|Staffordshire|07721|Eccleshall|R C Atkin|drain|soakaway/i.test(t));
console.log('visible text lines mentioning the R C Atkin business:', hits.length);
console.log(hits.slice(0,12).map(x=>'  • '+x.slice(0,140)).join('\n'));
// attributes (placeholders, aria, alt, title) too
const attrHits = [...noScript.matchAll(/(placeholder|alt|title|aria-label)="([^"]*(?:Martin|septic|07721|Staffordshire|Atkin|drain)[^"]*)"/gi)].map(m=>m[1]+'="'+m[2].slice(0,100)+'"');
console.log('attribute hits:', attrHits.length, attrHits.slice(0,6));
process.exit(0);
