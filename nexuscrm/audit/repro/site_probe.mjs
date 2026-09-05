// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/site_probe.mjs
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
globalThis.fetch = async () => new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}),{status:200,headers:{'Content-Type':'application/json'}});
async function call(method, path, body, token, rawOut=false){ const h={'Content-Type':'application/json',Origin:'http://app.local'}; if(token) h.Authorization='Bearer '+token; const r=await worker.fetch(new Request(BASE+'/api'+path,{method,headers:h,body:body?JSON.stringify(body):undefined}),env,ctx); if(rawOut) return r; return {status:r.status,data:await r.json().catch(()=>null)}; }
const A = (await call('POST','/auth/register',{name:'A',email:'a@x.com',password:'password123',workspace_name:'WA'})).data.token;
const B = (await call('POST','/auth/register',{name:'B',email:'b@x.com',password:'password123',workspace_name:'WB'})).data.token;

// 1. Create a deterministic site in workspace A
const s = await call('POST','/sites',{name:'Probe Co', description:'A plumbing business in Leeds', build_with_ai:true, deterministic:true},A);
console.log('1. POST /sites deterministic →', s.status, 'id=', s.data?.id, 'slug=', s.data?.slug, 'html len=', (s.data?.html||'').length);
const id = s.data.id;

// 2. Snapshot, then Design Studio overwrite — does the "before design studio" backup get written?
await call('POST',`/sites/${id}/snapshots`,{label:'manual'},A);
const before = (await call('GET',`/sites/${id}/snapshots`,null,A)).data.snapshots.length;
const d = await call('POST',`/sites/${id}/design`,{brief:'plumbers', overwrite:true},A);
const after = (await call('GET',`/sites/${id}/snapshots`,null,A)).data.snapshots.length;
console.log(`2. Design Studio overwrite: status=${d.status} saved=${d.data?.saved}; snapshots before=${before} after=${after} → ${after>before?'✅ backup written':'❌ NO BACKUP written (INSERT into site_versions uses non-existent column "note" and error is swallowed)'}`);

// 3. Cross-tenant: workspace B tries to wipe A's version history
const wipe = await call('DELETE',`/sites/${id}/snapshots`,null,B);
const left = (await call('GET',`/sites/${id}/snapshots`,null,A)).data.snapshots.length;
console.log(`3. B → DELETE /sites/${id}/snapshots: status=${wipe.status} ${JSON.stringify(wipe.data)}; A's snapshots left=${left} → ${left===0?'❌ IDOR: another workspace deleted the version history':'✅ blocked'}`);

// 4. Cross-tenant GET/POST snapshots and restore
console.log('4. B GET snapshots →', (await call('GET',`/sites/${id}/snapshots`,null,B)).status, '| B POST snapshot →', (await call('POST',`/sites/${id}/snapshots`,{label:'x'},B)).status, '| B PATCH →', (await call('PATCH',`/sites/${id}`,{name:'pwn'},B)).status, '| B visual →', (await call('POST',`/sites/${id}/visual`,{html:'<h1>pwn</h1>'},B)).status, '| B import →', (await call('POST',`/sites/${id}/import`,{},B)).status);

// 5. Publish + serve. Both public routes.
// N7 contract: a PATCH that carries settings keys (html/name/…) can no longer
// flip `published` on the side — publishing is an explicit `publish_action`.
const pub = await call('PATCH',`/sites/${id}`,{html:'<!DOCTYPE html><html><body><h1>Hi</h1><script>alert(document.domain)</script></body></html>'},A);
const smug = await call('PATCH',`/sites/${id}`,{name:'A site',published:true},A);
console.log(`   settings PATCH (rename) with published:true smuggled in → published=${smug.data.published} ${smug.data.published ? '❌ N7 regression: a settings save flipped the draft live' : '✅ ignored (N7) — ' + (smug.data.input_warnings || []).join('; ')}`);
const pubOk = await call('PATCH',`/sites/${id}`,{publish_action:'publish'},A);
console.log(`   explicit publish_action → published=${pubOk.data.published}`);
const slug = pubOk.data.slug || pub.data.slug;
const r1 = await worker.fetch(new Request(`${BASE}/s/${slug}`),env,ctx);
const r2 = await worker.fetch(new Request(`${BASE}/api/public/site/${slug}`,{headers:{Origin:'http://evil.example'}}),env,ctx);
console.log('5. /s/:slug →', r1.status, Object.fromEntries(r1.headers), '\n   /api/public/site/:slug →', r2.status, Object.fromEntries(r2.headers));
console.log('   script preserved in served html:', (await r1.text()).includes('<script>alert'));
// Origin-grant contract (was: EVERY origin — even `null`/`*` — reflected into
// ACAO + frame-ancestors). Now: without ALLOWED_ORIGINS the worker is in
// permissive dev mode (any REAL http(s) origin is granted, junk never); with
// ALLOWED_ORIGINS set, only listed origins are granted — evil gets the page
// but no grant. /s/:slug always SAMEORIGIN.
{
  const hdr = (r) => ({ acao: r.headers.get('access-control-allow-origin'), xfo: r.headers.get('x-frame-options'), fa: (r.headers.get('content-security-policy') || '').match(/frame-ancestors[^;]*/)?.[0] || '' });
  const s1 = hdr(r1);
  console.log(`   /s/:slug framing: ${s1.xfo === 'SAMEORIGIN' && !s1.acao ? '✅ SAMEORIGIN, no ACAO' : '❌ ' + JSON.stringify(s1)}`);
  const junk = hdr(await worker.fetch(new Request(`${BASE}/api/public/site/${slug}`,{headers:{Origin:'null'}}),env,ctx));
  console.log(`   Origin: null → ${!junk.acao && /frame-ancestors 'self'$/.test(junk.fa.trim()) ? '✅ never granted' : '❌ granted: ' + JSON.stringify(junk)}`);
  const envStrict = { ...env, ALLOWED_ORIGINS: 'https://crm.example.com, https://*.pages.dev' };
  const evil = await worker.fetch(new Request(`${BASE}/api/public/site/${slug}`,{headers:{Origin:'http://evil.example'}}),envStrict,ctx);
  const he = hdr(evil);
  console.log(`   ALLOWED_ORIGINS set, evil origin → ${evil.status === 200 && !he.acao && !/evil/.test(he.fa) ? '✅ page served, no grant' : '❌ ' + evil.status + ' ' + JSON.stringify(he)}`);
  const good = hdr(await worker.fetch(new Request(`${BASE}/api/public/site/${slug}`,{headers:{Origin:'https://crm.example.com'}}),envStrict,ctx));
  console.log(`   ALLOWED_ORIGINS set, listed origin → ${good.acao === 'https://crm.example.com' && /crm\.example\.com/.test(good.fa) ? '✅ granted' : '❌ ' + JSON.stringify(good)}`);
  const spoof = hdr(await worker.fetch(new Request(`${BASE}/api/public/site/${slug}`,{headers:{Origin:'https://crm.example.com.evil.example'}}),envStrict,ctx));
  console.log(`   ALLOWED_ORIGINS set, prefix-spoof origin → ${!spoof.acao ? '✅ refused' : '❌ granted'}`);
}

// 6. Slug edge cases against /s/
for (const bad of ['../../etc/passwd', "x' OR '1'='1", slug.toUpperCase()]) { const r = await worker.fetch(new Request(`${BASE}/s/${encodeURIComponent(bad)}`),env,ctx); console.log(`6. /s/${bad} →`, r.status); }

// 7. Unpublish → served?
await call('PATCH',`/sites/${id}`,{publish_action:'unpublish'},A);
console.log('7. after unpublish /s/:slug →', (await worker.fetch(new Request(`${BASE}/s/${slug}`),env,ctx)).status, '| /api/public/site →', (await worker.fetch(new Request(`${BASE}/api/public/site/${slug}`),env,ctx)).status);

// 8. PATCH preserves html when only toggling published? (u = {...existing, ...pick(body,[name,published,html])})
const g = await call('GET',`/sites/${id}`,null,A);
console.log('8. html retained after publish toggles: len=', (g.data.html||'').length);

// 9. Restore of a snapshot belonging to ANOTHER site (v.site_id !== id) and a foreign site id
const sB = await call('POST','/sites',{name:'B site', html:'<p>b</p>'},B);
await call('POST',`/sites/${sB.data.id}/snapshots`,{label:'b1'},B);
const bSnap = (await call('GET',`/sites/${sB.data.id}/snapshots`,null,B)).data.snapshots[0].id;
console.log('9. A restores B\'s snapshot onto A\'s site →', (await call('POST',`/sites/${id}/snapshots/${bSnap}/restore`,{},A)).status, '| A restores B snapshot onto B site →', (await call('POST',`/sites/${sB.data.id}/snapshots/${bSnap}/restore`,{},A)).status);

// 10. Oversized html on POST (no cap on POST? PATCH caps 400k)
const big = '<p>' + 'x'.repeat(1_200_000) + '</p>';
const bigRes = await call('POST','/sites',{name:'Big', html: big},A);
console.log('10. POST /sites with 1.2MB html →', bigRes.status, 'stored len=', (bigRes.data?.html||'').length);

// 11. AI path: fake provider returns body with <script> and onerror handler → is it sanitized?
globalThis.fetch = async () => new Response(JSON.stringify({choices:[{message:{content:'<section class="nx-hero"><h1>Hello</h1><img src=x onerror="alert(1)"><a href="javascript:alert(2)">x</a><script>alert(3)</script><iframe src="https://evil.example"></iframe></section>'}}]}),{status:200,headers:{'Content-Type':'application/json'}});
await call('PATCH','/ai/settings',{provider:'openai',openai_key:'sk-test1234567890abcdef',model:'gpt-4o-mini'},A);
const ai = await call('POST','/sites',{name:'AI Co', description:'test', build_with_ai:true},A);
const h = ai.data?.html || '';
console.log('11. AI-generated site: status', ai.status, '| onerror kept:', /onerror=/i.test(h), '| javascript: href kept:', /javascript:/i.test(h), '| <script>alert(3) kept:', /<script>alert\(3\)/.test(h), '| foreign iframe kept:', /iframe src="https:\/\/evil/.test(h), '| ai body used:', h.includes('<h1>Hello</h1>'));
process.exit(0);
