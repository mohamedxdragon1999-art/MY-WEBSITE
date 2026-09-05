// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/xss_plan_probe.mjs
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

// Payloads a hostile *scanned* website (or a prompt-injected model) can push into the content plan.
const P = {
  img: '<img src=x onerror=alert(1)>', a: '<a href="javascript:alert(2)">click</a>', svg: '<svg onload=alert(3)>', close: '"><script>alert(4)</script>',
  attr: 'x" onmouseover="alert(5)', style: '<style>body{display:none}</style>', ifr: '<iframe src="https://evil.example"></iframe>', meta: '<meta http-equiv="refresh" content="0;url=https://evil.example">',
};
const plan = { site_name: 'Evil '+P.img, tagline: P.svg, hero_headline: P.img, hero_sub: P.a, cta_primary: P.close, cta_secondary: P.attr, marquee_items: [P.img, P.svg], stats: [{value: 10, label: P.img}], services: [{icon: P.img, title: P.a, desc: P.svg}], why_us: [P.img], about: P.ifr + P.meta, process: [{title: P.img, desc: P.a}], gallery_imgs: ['javascript:alert(6)', 'https://ok.example/a.jpg" onerror="alert(7)'], reviews: [{name: P.img, text: P.svg, stars: 5}], lead_title: P.img, lead_text: P.a, faqs: [{q: P.img, a: P.svg}], working_hours: [P.img], contact: { phone: P.img, email: P.a, address: P.svg }, footer_note: P.style, favicon: P.close, hero_image: 'javascript:alert(8)' };
const checks = (h) => ({ onerror: /onerror\s*=/i.test(h), js_href: /href\s*=\s*["']?\s*javascript:/i.test(h), js_src: /src\s*=\s*["']?\s*javascript:/i.test(h), svg_onload: /<svg[^>]*onload/i.test(h), raw_script: /<script>alert\(4\)/.test(h), onmouseover: /onmouseover\s*=/i.test(h), meta_refresh: /<meta[^>]+http-equiv=["']?refresh/i.test(h), foreign_iframe: /<iframe[^>]+evil\.example/i.test(h), inline_style_tag_from_plan: /body\{display:none\}/.test(h) });
const fmt = (c) => Object.entries(c).filter(([k,v])=>v).map(([k])=>k).join(', ') || 'clean';
console.log('== Content-plan → generated site, DETERMINISTIC (no AI) ==');
for (const design of ['sentinel','aurora','slate','ocean','template']) {
  const s = await call('POST','/sites',{name:'Evil Co', description:'x', build_with_ai:true, deterministic:true, design_id: design, plan},token);
  const h = s.data?.html||''; console.log(`  design=${design.padEnd(9)} status=${s.status} size=${String(h.length).padStart(6)} → ${fmt(checks(h))}`);
}
for (const direction of ['signal-industrial','editorial-minimal','cinematic-immersive','luxury-art','bold-experimental','swiss-structured']) {
  const s = await call('POST','/ai/agentic-build',{name:'Evil Co', description:'x', deterministic:true, direction, plan},token);
  const h = s.data?.html||''; console.log(`  direction=${direction.padEnd(20)} status=${s.status} size=${String(h.length).padStart(6)} → ${fmt(checks(h))}`);
}
console.log('== name / description / instructions / custom_css / scene_text / spline_url / webhook_url / favicon fields ==');
const s2 = await call('POST','/sites',{name:'Evil "><img src=x onerror=alert(9)>', description:'<svg onload=alert(10)>', build_with_ai:true, deterministic:true, instructions: P.img, custom_css: '</style><script>alert(11)</script><style>', favicon: '"><img src=x onerror=alert(12)>', scene_id:'starfield', scene_text:"'; alert(13); '", spline_url: '"><script>alert(14)</script>', webhook_url: "');alert(15);//"},token);
const h2 = s2.data?.html||''; console.log('  status', s2.status, 'size', h2.length, '→', fmt(checks(h2)), '| alert(9) in title/markup:', /alert\(9\)/.test(h2), '| custom_css breakout <script>alert(11):', /<script>alert\(11\)/.test(h2), '| favicon breakout:', /alert\(12\)/.test(h2), '| scene_text injected raw:', /alert\(13\)/.test(h2), '| spline breakout:', /<script>alert\(14\)/.test(h2), "| webhook_url JS-string breakout fetch('');alert(15):", /alert\(15\)/.test(h2));
const i15 = h2.indexOf('alert(15)'); if (i15>0) console.log('  webhook context:', JSON.stringify(h2.slice(i15-30, i15+20)));
const i13 = h2.indexOf('alert(13)'); if (i13>0) console.log('  scene_text context:', JSON.stringify(h2.slice(i13-40, i13+20)));
console.log('== 3D scene text (text:true scene) ==');
const scenesR = await call('GET','/ai/site-scenes',null,token); const textScene = (scenesR.data.scenes||[]).find(s=>s.text);
if (textScene) { const s3 = await call('POST','/sites',{name:'T', description:'x', build_with_ai:true, deterministic:true, scene_id: textScene.id, scene_text: "</script><script>alert(16)</script>"},token); const h3=s3.data?.html||''; console.log(`  scene=${textScene.id} → </script> breakout present:`, /<\/script><script>alert\(16\)/.test(h3), '| JSON-escaped (safe):', /\\u003c\/script|<\\\/script>|\\"\/script/.test(h3) ); const k=h3.indexOf('alert(16)'); if(k>0) console.log('  context:', JSON.stringify(h3.slice(k-60,k+30))); }
process.exit(0);
