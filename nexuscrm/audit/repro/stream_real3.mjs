// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/stream_real3.mjs
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
import { readFileSync } from 'node:fs';
const html = readFileSync(ROOT+'NexusCRM_V4_Hardened.html','utf8');
function extract(name){ const i = html.indexOf(`async function ${name}(`); const j = html.indexOf('\n}\n', i); return html.slice(i, j+2); }
const src = extract('streamProviderDirect');
globalThis.LOCAL_AI_RELAY = false; globalThis.buildProviderRequest = () => ({ url: 'x', key: 'k', model: 'm', viaProxy: false });
globalThis.friendlyFetchError = (e) => e; globalThis.friendlyHttpError = async (r) => new Error('http ' + r.status); globalThis.nxOfflineCheck = () => {}; globalThis.nimMeta = () => ({ reasoning: false }); // FE gained a NIM profile helper (v0.0.0.0.19)
eval(src.replace('async function streamProviderDirect', 'globalThis.streamProviderDirect = async function'));
const ws = { aiSettings: { provider:'nvidia', nvidia_key:'k' }, aiUsage: {} };
async function run(label, chunks, delay=10){
  globalThis.fetch = async () => { let i=0; const enc=new TextEncoder(); const body=new ReadableStream({ async pull(c){ await new Promise(r=>setTimeout(r,delay)); if(i>=chunks.length){c.close();return;} c.enqueue(enc.encode(chunks[i++])); } }); return { ok:true, status:200, body, headers:{get:()=>null} }; };
  const res = await streamProviderDirect(ws, [{role:'user',content:'hi'}], '');
  const reader = res.body.getReader(); const dec=new TextDecoder(); let full=''; let gotDone=false; let stalled=false;
  while(true){ const r = await Promise.race([reader.read(), new Promise(r2=>setTimeout(()=>r2({__t:true}),1500))]); if(r.__t){stalled=true;break;} if(r.done) break; for(const line of dec.decode(r.value).split('\n')){ if(!line.startsWith('data: ')) continue; const d=JSON.parse(line.slice(6)); if(d.delta) full+=d.delta; if(d.done) gotDone=true; } }
  console.log(`${stalled?'❌ STALL':'✅ ok   '} ${label.padEnd(78)} text="${full}" done=${gotDone}`);
}
const role = 'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n';
const c1 = 'data: {"choices":[{"delta":{"content":"Hi "}}]}\n\n', c2 = 'data: {"choices":[{"delta":{"content":"there"}}]}\n\n';
const fin = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n', DONE='data: [DONE]\n\n';
const empty = 'data: {"choices":[{"delta":{"content":""}}]}\n\n';
const usage = 'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":4,"total_tokens":9}}\n\n';
await run('A. test-suite shape: content, content, [DONE]  (all separate packets)', [c1,c2,DONE]);
await run('B. OpenAI: role | c1 | c2 | finish+[DONE] in ONE packet', [role,c1,c2,fin+DONE]);
await run('C. OpenAI: role | c1 | c2 | finish | [DONE]  (separate packets)', [role,c1,c2,fin,DONE]);
await run('D. OpenAI stream_options: role | c1 | c2 | finish | usage | [DONE] (sep.)', [role,c1,c2,fin,usage,DONE]);
await run('E. NIM: role | c1 | empty-content | c2 | finish+usage+[DONE] one packet', [role,c1,empty,c2,fin+DONE]);
await run('F. NIM: c1 | c2 | finish(usage) | [DONE] separate', [c1,c2,'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"total_tokens":9}}\n\n',DONE]);
await run('G. gateway keep-alive comment between tokens: c1 | ": ping" | c2 | fin+[DONE]', [c1,': ping\n\n',c2,fin+DONE]);
await run('H. no [DONE] marker (Ollama/vLLM-compat): c1 | c2 | finish | EOF', [c1,c2,fin]);
await run('I. everything in ONE packet (tiny reply): role+c1+c2+fin+[DONE]', [role+c1+c2+fin+DONE]);
process.exit(0);
