// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/ai_body_xss2.mjs
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
const hostile = `<section class="nx-hero"><h1>Hi</h1><div id="nx-x" onclick="window.__ai_click=1">x</div><body onload="window.__ai_bodyload=1"><img src="data:," onerror="window.__ai_img=1"><a id="nx-l" class="btn btn-primary" href="javascript:window.__ai_js=1">Go</a></section>`;
globalThis.fetch = async () => new Response(JSON.stringify({choices:[{message:{content:hostile}}],usage:{total_tokens:10}}),{status:200,headers:{'Content-Type':'application/json'}});
for (const design of ['sentinel','template']) {
  const site = await call('POST','/sites',{name:'AI Body Test '+design, description:'test', build_with_ai:true, published:true, design_id:design},token);
  const pub = await worker.fetch(new Request(BASE+'/s/'+site.data.slug), env, ctx); const html = await pub.text();
  const vc = new VirtualConsole(); vc.on('jsdomError', ()=>{});
  const dom = new JSDOM(html, { runScripts:'dangerously', resources:'usable', virtualConsole: vc, pretendToBeVisual:true, beforeParse(w){ w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}}); w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}}; w.requestAnimationFrame=(f)=>setTimeout(f,0); w.HTMLCanvasElement.prototype.getContext=()=>null; w.scrollTo=()=>{}; } });
  await new Promise(r=>setTimeout(r,600));
  const w = dom.window; const d = w.document;
  const el = d.getElementById('nx-x'); if (el) el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  const a = d.getElementById('nx-l'); let jsHref = a && a.getAttribute('href');
  console.log(`[${design}] AI-body handler executed on click: ${w.__ai_click===1} | img onerror executed: ${w.__ai_img===1} | javascript: href kept: ${String(jsHref).startsWith('javascript:')} | onclick attr present in served HTML: ${/onclick="window\.__ai_click=1"/.test(html)}`);
}
process.exit(0);
