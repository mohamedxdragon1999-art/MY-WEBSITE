// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/xss_where3.mjs
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
// The earlier full-payload run showed onerror in ALL designs and directions. Find the field.
const mark = (k) => `<img src=x onerror="alert('${k}')">`;
const plans = {
  hero_headline: {hero_headline: mark('hero_headline')}, tagline: {tagline: mark('tagline')}, site_name: {site_name: mark('site_name')},
  marquee: {marquee_items:[mark('marquee')]}, why_us: {why_us:[mark('why_us')]}, stats: {stats:[{value:1,label:mark('stats')}]},
  about: {about: mark('about')}, faqs: {faqs:[{q:mark('faqq'),a:mark('faqa')}]}, working_hours:{working_hours:[mark('hours')]},
  contact: {contact:{phone:mark('phone'),email:mark('email'),address:mark('address')}}, reviews:{reviews:[{name:mark('rname'),text:mark('rtext'),stars:5}]},
  process: {process:[{title:mark('ptitle'),desc:mark('pdesc')}]}, services: {services:[{icon:mark('sicon'),title:mark('stitle'),desc:mark('sdesc')}]},
  lead: {lead_title:mark('lead_title'),lead_text:mark('lead_text')}, cta: {cta_primary:mark('cta_primary'),cta_secondary:mark('cta_secondary')}, footer:{footer_note:mark('footer')},
  gallery:{gallery_imgs:[mark('gallery')]}, hero_image:{hero_image:mark('hero_image')}, pricing:{pricing:[{name:mark('pname'),price:mark('pprice'),features:[mark('pfeat')]}]}, team:{team:[{name:mark('tname'),role:mark('trole'),bio:mark('tbio')}]}, timeline:{timeline:[{title:mark('tltitle'),desc:mark('tldesc')}]}, logos:{logos:[{name:mark('lname'),text:mark('ltext')}]}, video:{video_url:mark('video')},
};
for (const [route, extra, label] of [['/sites',{design_id:'sentinel'},'sentinel'],['/sites',{design_id:'aurora'},'aurora'],['/ai/agentic-build',{direction:'swiss-structured'},'direction swiss'],['/ai/agentic-build',{direction:'cinematic-immersive'},'direction cinematic']]) {
  const bad = [];
  for (const [k, plan] of Object.entries(plans)) {
    const body = route==='/sites' ? {name:'Probe', description:'x', build_with_ai:true, deterministic:true, plan, ...extra} : {name:'Probe', description:'x', deterministic:true, plan, ...extra};
    const s = await call('POST',route,body,token); const h = s.data?.html||'';
    const m = [...h.matchAll(/onerror="alert\('([a-z_]+)'\)"/g)].map(x=>x[1]); if (m.length) bad.push(...m);
  }
  console.log(`${label.padEnd(20)} raw-HTML plan fields: ${bad.length? '❌ '+[...new Set(bad)].join(', ') : '✅ none'}`);
}
process.exit(0);
