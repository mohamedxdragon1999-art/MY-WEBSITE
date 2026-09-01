// ADVERSARIAL HTTP-LAYER SECURITY: authorization, multi-tenant isolation (IDOR),
// forged tokens, SQL injection, prototype pollution, oversized payloads, stored XSS.
//
// These are the failures that matter most in a hosted builder: one tenant reading
// or editing another tenant's site. Each finding is recorded rather than thrown so
// the suite reports EVERY hole in one run.
//
// Run: node tests/test_api_security.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const { init, DB } = await import(join(__dirname, 'd1mock.js'));
await init(readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8'));
const worker = (await import(join(ROOT, 'backend', 'src', 'index.js'))).default;
const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
globalThis.fetch = async () => new Response('x', { status: 200 });
const iss = []; const rec = (s, m) => iss.push(s + ' :: ' + m);

const call=async(m,p,b,t,extra={})=>{const h={'Content-Type':'application/json',Origin:'http://app.local',...extra};
 if(t)h.Authorization='Bearer '+t;
 const r=await worker.fetch(new Request('http://test.local/api'+p,{method:m,headers:h,body:(b!==null&&b!==undefined&&m!=='GET'&&m!=='HEAD')?JSON.stringify(b):undefined}),env,ctx);
 let d=null;try{d=await r.json()}catch{};return{status:r.status,data:d}};

// two separate tenants
const A=await call('POST','/auth/register',{email:'a@t.co',password:'Password123!',name:'A'});
const B=await call('POST','/auth/register',{email:'b@t.co',password:'Password123!',name:'B'});
const tA=A.data.token||A.data.accessToken, tB=B.data.token||B.data.accessToken;
const siteA=await call('POST','/sites',{name:'A site',html:'<html>SECRET-A</html>'},tA);
const idA=siteA.data?.id||siteA.data?.site?.id;

// 1. IDOR: tenant B must never read/modify/delete tenant A's site
// Sanity: these endpoints must work for the OWNER, otherwise "tenant B is blocked"
// would pass vacuously against routes that 404 for everyone.
for(const [m,path] of [['GET',`/sites/${idA}`],['GET',`/sites/${idA}/html`],['GET',`/sites/${idA}/test`],['GET',`/sites/${idA}/snapshots`]]){
  const own=await call(m,path,null,tA);
  if(own.status!==200) rec('VACUOUS',`owner ${m} ${path} -> ${own.status}; cross-tenant check would be meaningless`);
}
for(const [m,path,body] of [['GET',`/sites/${idA}`,null],['GET',`/sites/${idA}/html`,null],
  ['GET',`/sites/${idA}/test`,null],['GET',`/sites/${idA}/snapshots`,null],
  ['PATCH',`/sites/${idA}`,{name:'hacked'}],['DELETE',`/sites/${idA}`,null],
  ['POST',`/sites/${idA}/snapshots`,{label:'x'}],['POST',`/sites/${idA}/import`,{}]]){
  const r=await call(m,path,body,tB);
  if(r.status<400) rec('IDOR',`tenant B ${m} ${path} -> ${r.status} (should be 403/404)`);
  if(JSON.stringify(r.data||'').includes('SECRET-A')) rec('LEAK',`tenant B read tenant A content via ${m} ${path}`);
}
// 2. unauthenticated access
for(const [m,path] of [['GET','/sites'],['POST','/sites'],['GET',`/sites/${idA}`],['GET','/ai/site-scenes']]){
  const r=await call(m,path,m==='GET'?null:{name:'x'},null);
  if(r.status<400 && path!=='/ai/site-scenes') rec('AUTHZ',`unauthenticated ${m} ${path} -> ${r.status}`);
}
// 3. forged / malformed tokens
for(const bad of ['','null','undefined','Bearer','a.b.c','../../etc/passwd',
  'eyJhbGciOiJub25lIn0.eyJ3b3Jrc3BhY2VJZCI6MX0.','x'.repeat(5000)]){
  const r=await call('GET','/sites',null,bad);
  if(r.status<400) rec('AUTHZ',`forged token accepted: ${bad.slice(0,24)} -> ${r.status}`);
}
// 4. SQL injection through ids and body
for(const inj of ["1' OR '1'='1","1; DROP TABLE sites;--","' UNION SELECT * FROM users--",'{"$ne":null}']){
  const r=await call('GET',`/sites/${encodeURIComponent(inj)}`,null,tA);
  if(r.status===200 && r.data && r.data.length>1) rec('SQLI',`id injection returned rows: ${inj}`);
  const r2=await call('POST','/sites',{name:inj,html:'<p>x</p>'},tA);
  if(r2.status>=500) rec('SQLI',`injection in body caused 500: ${inj}`);
}
// verify tables survived
const still=await call('GET','/sites',null,tA);
if(still.status>=500) rec('SQLI','sites table appears damaged after injection attempts');

// 5. oversized / malformed payloads must not 500
for(const [label,body] of [['huge-name',{name:'x'.repeat(1_000_00),html:'<p>x</p>'}],
  ['huge-html',{name:'n',html:'<p>'+'y'.repeat(2_000_000)+'</p>'}],
  ['null-body',null],['array-body',[1,2,3]],['nested',{name:{a:{b:{c:1}}}}],
  ['proto',JSON.parse('{"name":"x","__proto__":{"admin":true}}')]]){
  const r=await call('POST','/sites',body,tA);
  if(r.status>=500) rec('ROBUST',`${label} -> HTTP ${r.status}`);
}
if(({}).admin!==undefined) rec('SECURITY','prototype pollution via JSON body');

// 6. XSS stored+served
// Storing a name verbatim and returning it in JSON is CORRECT — JSON is not HTML,
// and the client escapes on render. What must never happen is the API serving that
// name back inside an HTML response where it would execute.
const x=await call('POST','/sites',{name:'<script>alert(1)</script>',html:'<p>ok</p>'},tA);
const xid=x.data?.id||x.data?.site?.id;
if(xid){
  const got=await call('GET',`/sites/${xid}`,null,tA);
  if(got.status!==200) rec('XSS',`owner cannot read the site back (HTTP ${got.status}) — check is vacuous`);
  const h={'Content-Type':'application/json',Origin:'http://app.local',Authorization:'Bearer '+tA};
  const raw=await worker.fetch(new Request(`http://test.local/api/sites/${xid}/html`,{headers:h}),env,ctx);
  const ctype=String(raw.headers.get('content-type')||'');
  const bodyTxt=await raw.text();
  if(/^text\/html/i.test(ctype) && bodyTxt.includes('<script>alert(1)</script>'))
    rec('XSS',`the untrusted site NAME was echoed into an executable HTML response`);
}

let passed = 0, failed = 0; const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const of = (tag) => iss.filter((i) => i.startsWith(tag + ' ::'));
console.log('\n== HTTP layer security ==');
check('no cross-tenant IDOR on any site route', of('IDOR').length === 0, of('IDOR').slice(0, 3).join(' | '));
check('no tenant can read another tenant\'s content', of('LEAK').length === 0, of('LEAK').slice(0, 3).join(' | '));
check('protected routes reject unauthenticated access', of('AUTHZ').filter(x => x.includes('unauthenticated')).length === 0, of('AUTHZ').slice(0, 3).join(' | '));
check('forged/malformed bearer tokens are rejected', of('AUTHZ').filter(x => x.includes('forged')).length === 0, of('AUTHZ').slice(0, 3).join(' | '));
check('no SQL injection via path ids or body', of('SQLI').length === 0, of('SQLI').slice(0, 3).join(' | '));
check('oversized/malformed payloads never 500', of('ROBUST').length === 0, of('ROBUST').slice(0, 3).join(' | '));
check('no prototype pollution via JSON body', of('SECURITY').length === 0, of('SECURITY').join(' | '));
check('cross-tenant probes are not vacuous (owner can reach the routes)', of('VACUOUS').length === 0, of('VACUOUS').slice(0, 3).join(' | '));
check('untrusted site names are never echoed into executable HTML', of('XSS').length === 0, of('XSS').join(' | '));
const total = passed + failed;
console.log('\n────────────────────────────────────────');
console.log((failed === 0 ? 'ALL PASSED' : 'FAILURES') + ' — ' + passed + '/' + total + ' passing');
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
