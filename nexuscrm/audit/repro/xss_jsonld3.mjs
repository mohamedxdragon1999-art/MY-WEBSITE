// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/xss_jsonld3.mjs
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
const { JSDOM, VirtualConsole } = require((ROOT+'node_modules/jsdom'));
async function jsdomExec(h){ let fired=[]; const dom = new JSDOM(h, { runScripts:'dangerously', pretendToBeVisual:true, virtualConsole: new VirtualConsole(), beforeParse(w){ w.alert=(m)=>fired.push(String(m)); w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}}); w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}}; w.requestAnimationFrame=(f)=>setTimeout(f,0); w.scrollTo=()=>{}; w.HTMLCanvasElement.prototype.getContext=()=>null; } }); await new Promise(r=>setTimeout(r,700)); return { fired, pwned: !!dom.window.document.getElementById('pwned') }; }
// quote-free payloads (JSON.stringify leaves them byte-identical; the HTML tokenizer closes <script> at the first </script>)
const payloads = {
  'script tag':  '</script><script>alert(document.domain)</script><i id=pwned></i>',
  'img onerror': '</script><img src=x onerror=alert(1)><i id=pwned></i>',
  'svg onload':  '</script><svg onload=alert(2)><i id=pwned></i>',
};
for (const [pl, payload] of Object.entries(payloads)) {
  for (const [field, extra] of [['plan.contact.phone', {plan:{contact:{phone:payload}}}], ['plan.contact.address', {plan:{contact:{address:payload}}}], ['plan.working_hours[0]', {plan:{contact:{phone:'1'},working_hours:[payload]}}], ['site name', {name:'A '+payload, plan:{contact:{phone:'1'}}}]]) {
    const s = await call('POST','/sites',{name:'Probe Co', description:'x', build_with_ai:true, deterministic:true, design_id:'sentinel', ...extra},token); const h = s.data?.html||'';
    const r = await jsdomExec(h);
    console.log(`${r.fired.length||r.pwned?'❌ EXECUTES':'✅'}  ${pl.padEnd(12)} via ${field.padEnd(22)} alert=${JSON.stringify(r.fired)} injected-element=${r.pwned}`);
  }
}
// also check the /ai/agentic-build direction path + template path (do they also emit JSON-LD from plan?)
for (const [label, body] of [['agentic direction', {name:'Probe', description:'x', deterministic:true, direction:'swiss-structured', plan:{contact:{phone:payloads['img onerror']}}}], ['template design', {name:'Probe', description:'x', build_with_ai:true, deterministic:true, design_id:'template', plan:{contact:{phone:payloads['img onerror']}}}]]) {
  const s = await call('POST', label==='agentic direction'?'/ai/agentic-build':'/sites', body, token); const h=s.data?.html||''; const r = await jsdomExec(h);
  console.log(`${r.fired.length||r.pwned?'❌ EXECUTES':'✅'}  ${label.padEnd(18)} alert=${JSON.stringify(r.fired)} injected-element=${r.pwned}`);
}
process.exit(0);
