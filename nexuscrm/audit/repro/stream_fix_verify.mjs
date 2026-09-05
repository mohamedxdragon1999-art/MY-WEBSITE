// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/stream_fix_verify.mjs
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
import { readFileSync } from 'node:fs';
const html = readFileSync(ROOT+'NexusCRM_V4_Hardened.html','utf8');
function extract(name){ const i = html.indexOf(`async function ${name}(`); const j = html.indexOf('\n}\n', i); return html.slice(i, j+2); }
const src = extract('streamProviderDirect');
// 2026-09-05: the candidate fix (pull() loops until it forwards a frame; `[DONE]`
// ends the stream) is now SHIPPED in the HTML, so this script verifies the real
// reader instead of patching it in memory. Guard: the shipped code must contain
// the loop, otherwise the F17 stall regressed.
if (!/while \(sent === 0\)/.test(src) || !/if \(payload === '\[DONE\]'\) \{ finish\(\); return; \}/.test(src)) { console.log('❌ F17 fix missing from streamProviderDirect'); process.exit(1); }
globalThis.LOCAL_AI_RELAY = false; globalThis.buildProviderRequest = () => ({ url: 'x', key: 'k', model: 'm', viaProxy: false });
globalThis.friendlyFetchError = (e) => e; globalThis.friendlyHttpError = async (r) => new Error('http ' + r.status); globalThis.nxOfflineCheck = () => {}; globalThis.nimMeta = () => ({ reasoning: false }); // FE gained a NIM profile helper (v0.0.0.0.19)
eval(src.replace('async function streamProviderDirect', 'globalThis.streamProviderDirect = async function'));
const ws = { aiSettings: { provider:'nvidia', nvidia_key:'k' }, aiUsage: {} };
async function run(label, chunks, delay=10){
  globalThis.fetch = async () => { let i=0; const enc=new TextEncoder(); const body=new ReadableStream({ async pull(c){ await new Promise(r=>setTimeout(r,delay)); if(i>=chunks.length){c.close();return;} c.enqueue(enc.encode(chunks[i++])); } }); return { ok:true, status:200, body, headers:{get:()=>null} }; };
  const res = await streamProviderDirect(ws, [{role:'user',content:'hi'}], '');
  const reader = res.body.getReader(); const dec=new TextDecoder(); let full=''; let gotDone=false; let stalled=false; const t0=Date.now();
  while(true){ const r = await Promise.race([reader.read(), new Promise(r2=>setTimeout(()=>r2({__t:true}),1500))]); if(r.__t){stalled=true;break;} if(r.done) break; for(const line of dec.decode(r.value).split('\n')){ if(!line.startsWith('data: ')) continue; const d=JSON.parse(line.slice(6)); if(d.delta) full+=d.delta; if(d.done) gotDone=true; } }
  console.log(`${stalled?'❌ STALL':'✅ ok   '} ${label.padEnd(70)} text="${full}" done=${gotDone} ${Date.now()-t0}ms`);
}
const role = 'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n', c1 = 'data: {"choices":[{"delta":{"content":"Hi "}}]}\n\n', c2 = 'data: {"choices":[{"delta":{"content":"there"}}]}\n\n', fin = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n', DONE='data: [DONE]\n\n', empty='data: {"choices":[{"delta":{"content":""}}]}\n\n', usage='data: {"choices":[],"usage":{"total_tokens":9}}\n\n';
console.log('SHIPPED streamProviderDirect reader (NexusCRM_V4_Hardened.html):');
await run('A. content, content, [DONE] separate', [c1,c2,DONE]);
await run('C. OpenAI role | c1 | c2 | finish | [DONE]', [role,c1,c2,fin,DONE]);
await run('D. + usage chunk', [role,c1,c2,fin,usage,DONE]);
await run('E. NIM role | c1 | empty | c2 | finish+usage+[DONE]', [role,c1,empty,c2,fin+DONE]);
await run('G. keep-alive comments between tokens', [c1,': ping\n\n',c2,fin+DONE]);
await run('H. no [DONE] marker, EOF', [c1,c2,fin]);
await run('I. all in one packet', [role+c1+c2+fin+DONE]);
process.exit(0);
