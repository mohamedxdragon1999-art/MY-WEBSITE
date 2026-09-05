// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/template_pii_scope.mjs
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
const markers = { phone:'07721 511814', email:'rcatkincontractor', owner:'Martin', town:'Eccleshall', postcode:'ST21 6HH', brand:'R C Atkin', addr:'Copmere', kb:'septic' };
const fullPlan = { site_name:'Nile Plumbing', business_type:'plumber', contact:{ phone:'+20 100 000 0000', email:'hello@nileplumbing.example', address:'12 Corniche, Banha, Egypt' }, working_hours:['Sat–Thu 9–6'], services:[{title:'Leak repair',desc:'Fast fixes',icon:'🔧'},{title:'Installs',desc:'New bathrooms',icon:'🚿'}], about:'Family plumbers in Banha since 2001.', hero_title:'Plumbing done right', hero_sub:'Same-day service', reviews:[{name:'A',text:'Great',stars:5}], faqs:[{q:'Do you do emergencies?',a:'Yes'}] };
async function count(label, body){
  const s = await call('POST','/sites', body, token); const pub = await worker.fetch(new Request(BASE+'/s/'+s.data.slug),env,ctx); const html = await pub.text();
  const hits = Object.entries(markers).map(([k,v])=>[k,(html.match(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'))||[]).length]).filter(([,n])=>n>0);
  console.log(label.padEnd(58), 'bytes', String(html.length).padStart(6), '→', hits.length? hits.map(([k,n])=>k+'×'+n).join(' '):'CLEAN');
  return html;
}
await count('template, NO plan (wizard "Build with AI", no scan)', {name:'Nile Plumbing', description:'plumber in Banha', build_with_ai:true, published:true, design_id:'template'});
await count('template, FULL customer plan (own phone/email/address)', {name:'Nile Plumbing', description:'plumber in Banha', build_with_ai:true, published:true, design_id:'template', plan: fullPlan});
await count('template, deterministic + full plan', {name:'Nile Plumbing', description:'plumber', build_with_ai:true, deterministic:true, published:true, design_id:'template', plan: fullPlan});
await count('sentinel (default), no plan — control', {name:'Nile Plumbing', description:'plumber in Banha', build_with_ai:true, published:true, design_id:'sentinel'});
await count('agentic-build default direction — control', {name:'Nile Plumbing', description:'plumber in Banha', build_with_ai:true, published:true, direction:'editorial-minimal'});
// where is design_id persisted? (for the exposure query)
const cols = await DB.prepare("PRAGMA table_info(sites)").all(); console.log('\nsites columns:', cols.results.map(c=>c.name).join(', '));
const meta = await DB.prepare("SELECT * FROM site_meta LIMIT 1").first(); console.log('site_meta sample keys:', meta? Object.keys(meta).join(', '):'(no rows)', meta? '| design_id=' + meta.design_id : '');
const rows = await DB.prepare("SELECT s.id, s.slug, s.published, m.design_id FROM sites s LEFT JOIN site_meta m ON m.site_id=s.id").all(); console.log('exposure query result on this run:', JSON.stringify(rows.results));
process.exit(0);
