# AI HARDENING — frontend cycles (browser)
import re
p='NexusCRM_V4_Hardened.html'
h=open(p).read()
n0=len(h)

# ── Cycle 16: export NEVER contains API keys (local mode scrub) ──
old="""    } else {
      payload = { app:'NexusCRM', exported_at:new Date().toISOString(), version:1, source:'local', data: loadDB() };
    }"""
new="""    } else {
      // HARDENING: API keys are NEVER written into export files. The local
      // database holds them (that is what makes local AI work), but a backup
      // file that travels by email/chat must not. Keys are replaced with a
      // marker + an explicit note telling the owner to re-add them.
      const db = JSON.parse(JSON.stringify(loadDB()));
      let scrubbed = 0;
      (db.workspaces || []).forEach(ws => {
        if (ws.aiSettings) ['openai_key','nvidia_key','custom_key'].forEach(k => {
          if (ws.aiSettings[k]) { ws.aiSettings[k] = '__removed_from_export__'; scrubbed++; }
        });
      });
      payload = { app:'NexusCRM', exported_at:new Date().toISOString(), version:1, source:'local',
        note: scrubbed ? 'For safety, '+scrubbed+' API key(s) were removed from this export. Re-add them in Settings → AI Providers after restoring.' : undefined,
        data: db };
      if (scrubbed) toast('Export ready — API keys are never included in backups for safety. Re-add them after restoring on another device.', 'info', 7000);
    }"""
assert old in h
h=h.replace(old,new)

# ── Cycle 17+18: save-time validation — base URLs + key shapes ──
old2="""  const updates={provider,model:provider==='openai'?V('s-model-openai')?.value:provider==='nvidia'?V('s-model-nvidia')?.value:(V('s-model-custom')?.value||''),"""
new2="""  // HARDENING: base URL + key shape validation at save time (mirrors the
  // backend's own guards — both ends refuse the same bad input).
  const checkBaseUrl = (val, label) => {
    const s = String(val || '').trim().replace(/\\/+$/, '');
    if (!s) return { ok: true, url: '' };
    let u; try { u = new URL(s); } catch { return { ok:false, msg: label+' is not a valid URL' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok:false, msg: label+' must start with http:// or https://' };
    if (u.username || u.password) return { ok:false, msg: label+' must not contain credentials — use the API key field' };
    if (s.length > 300) return { ok:false, msg: label+' is too long (max 300 characters)' };
    return { ok: true, url: s };
  };
  const checkKey = (val, label) => {
    const s = String(val || '');
    if (!s) return { ok: true };
    if (/\\s/.test(s)) return { ok:false, msg: label+' contains spaces or line breaks — paste the key exactly as the provider shows it' };
    if (s.length < 8 || s.length > 500) return { ok:false, msg: label+' does not look like a real key (expected 8–500 characters)' };
    return { ok: true };
  };
  for (const [id, label] of [['s-openai-key','OpenAI key'],['s-nvidia-key','NVIDIA key'],['s-custom-key','Custom key']]) {
    const v = V(id)?.value || '';
    const masked = v.includes('•') || v.includes('*');
    if (!masked) { const c = checkKey(v, label); if (!c.ok) { toast('Settings NOT saved — '+c.msg+'.', 'error', 6000); return; } }
  }
  const customUrl = V('s-custom-url')?.value;
  if (provider === 'custom' && customUrl) {
    const c = checkBaseUrl(customUrl, 'Custom base URL');
    if (!c.ok) { toast('Settings NOT saved — '+c.msg+'.', 'error', 6000); return; }
  }
  const nvUrl = V('s-nvidia-url')?.value;
  if (provider === 'nvidia' && nvUrl) {
    const c = checkBaseUrl(nvUrl, 'NVIDIA base URL');
    if (!c.ok) { toast('Settings NOT saved — '+c.msg+'.', 'error', 6000); return; }
  }
  const updates={provider,model:provider==='openai'?V('s-model-openai')?.value:provider==='nvidia'?V('s-model-nvidia')?.value:(V('s-model-custom')?.value||''),"""
assert old2 in h
h=h.replace(old2,new2)

# ── Cycle 19: buildProviderRequest — sanitize key + model at the boundary ──
old3="""  return { url, key, model, direct, viaProxy: !!(s.proxy_url || useLocalRelay), relay: useLocalRelay ? 'local' : (s.proxy_url ? 'configured' : null) };"""
new3="""  // HARDENING: the key rides in an Authorization header — strip any
  // whitespace/control characters (header injection becomes impossible), and
  // clean the model string the same way the backend does.
  const cleanKey = key ? String(key).replace(/[\\r\\n\\t ]+/g, '') : key;
  const cleanModel = String(model || '').replace(/[\\u0000-\\u001f\\u007f]/g, '').slice(0, 200);
  return { url, key: cleanKey, model: cleanModel, direct, viaProxy: !!(s.proxy_url || useLocalRelay), relay: useLocalRelay ? 'local' : (s.proxy_url ? 'configured' : null) };"""
assert old3 in h
h=h.replace(old3,new3)

# ── Cycles 20-22: callProviderDirect — offline pre-flight, in-flight cap, bounded retry, usage capture, history cap ──
old4="""async function callProviderDirect(ws, messages, opts) {
  const s = ws.aiSettings;
  const req = buildProviderRequest(s);
  if (!req) throw new Error('no_key');
  if (s.system_prompt) messages = [{ role:'system', content:s.system_prompt }, ...messages.filter(m=>m.role!=='system')];
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 25000);
  let r;
  try {
    r = await fetch(req.url, {
      method:'POST', signal: ctrl.signal,
      headers: { 'Content-Type':'application/json', ...(req.key?{Authorization:`Bearer ${req.key}`}:{}) },
      body: JSON.stringify({ model: req.model, messages, temperature: opts?.temperature ?? s.temperature ?? 0.7, max_tokens: opts?.max_tokens ?? s.max_tokens ?? 1024 })
    });
  } catch(e) { clearTimeout(t); throw friendlyFetchError(e, req); }
  clearTimeout(t);
  if (!r.ok) throw await friendlyHttpError(r);
  const d = await r.json();"""
new4="""// HARDENING: in-flight ceiling — a stuck UI or a runaway loop must not stack
// dozens of simultaneous provider calls (each holds a 25s timer + socket).
const NX_AI_INFLIGHT_MAX = 4;
let nxAIInFlight = 0;
// HARDENING: offline pre-flight — no point burning a 25s timeout when the
// browser already knows there is no network. Instant, honest error instead.
function nxOfflineCheck() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    throw new Error('You are offline — reconnect to the internet and try again.');
}
async function callProviderDirect(ws, messages, opts) {
  nxOfflineCheck();
  if (nxAIInFlight >= NX_AI_INFLIGHT_MAX)
    throw new Error('Too many AI requests at once — let the current ones finish first.');
  nxAIInFlight++;
  try { return await callProviderDirectInner(ws, messages, opts); }
  finally { nxAIInFlight--; }
}
async function callProviderDirectInner(ws, messages, opts) {
  const s = ws.aiSettings;
  const req = buildProviderRequest(s);
  if (!req) throw new Error('no_key');
  if (s.system_prompt) messages = [{ role:'system', content:s.system_prompt }, ...messages.filter(m=>m.role!=='system')];
  // HARDENING: pathological histories are trimmed to the last 60 messages
  // (the newest user request always survives) — parity with the backend.
  if (Array.isArray(messages) && messages.length > 60) messages = messages.slice(messages.length - 60);
  // HARDENING: bounded retry — exactly ONE retry, only for failures that are
  // actually worth retrying (429 with short Retry-After, 5xx, network blips).
  // Auth/billing/NOT-FOUND errors fail fast; the user sees the real reason.
  let r = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 25000);
    try {
      r = await fetch(req.url, {
        method:'POST', signal: ctrl.signal,
        headers: { 'Content-Type':'application/json', ...(req.key?{Authorization:`Bearer ${req.key}`}:{}) },
        body: JSON.stringify({ model: req.model, messages, temperature: opts?.temperature ?? s.temperature ?? 0.7, max_tokens: opts?.max_tokens ?? s.max_tokens ?? 1024 })
      });
      clearTimeout(t);
      const retryableStatus = r.status === 429 || r.status >= 500;
      if (retryableStatus && attempt === 0) {
        const ra = parseFloat(r.headers?.get?.('Retry-After') || '0');
        await new Promise(res => setTimeout(res, Number.isFinite(ra) && ra > 0 && ra <= 5 ? ra * 1000 : 900 + Math.random() * 600));
        continue;
      }
      break;
    } catch(e) {
      clearTimeout(t);
      if (attempt === 0) { await new Promise(res => setTimeout(res, 700 + Math.random() * 500)); continue; }
      throw friendlyFetchError(e, req);
    }
  }
  if (!r) throw new Error('The provider could not be reached.');
  if (!r.ok) throw await friendlyHttpError(r);
  const d = await r.json();
  // HARDENING: token usage is captured from every live response (shown in
  // the AI Usage card — honest accounting of what the provider charged).
  try { if (d?.usage) { (ws.aiUsage = ws.aiUsage || { calls: 0, tokens: 0 }).tokens += (d.usage.total_tokens || ((d.usage.prompt_tokens||0) + (d.usage.completion_tokens||0))); ws.aiUsage.calls++; } } catch {}"""
assert old4 in h
h=h.replace(old4,new4)

# ── Cycles 23-24: streamProviderDirect — offline check + pre-first-byte retry + SSE line cap ──
old5="""async function streamProviderDirect(ws, messages, contextData) {
  const s = ws.aiSettings;
  const req = buildProviderRequest(s);
  if (!req) throw new Error('no_key');
  const sys = contextData ? `Context: ${contextData}` : (s.system_prompt || '');
  if (sys) messages = [{ role:'system', content: sys }, ...messages.filter(m=>m.role!=='system')];

  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 45000);
  let r;
  try {
    r = await fetch(req.url, {
      method:'POST', signal: ctrl.signal,
      headers: { 'Content-Type':'application/json', ...(req.key?{Authorization:`Bearer ${req.key}`}:{}) },
      body: JSON.stringify({ model: req.model, messages, temperature: s.temperature ?? 0.7, max_tokens: s.max_tokens ?? 1024, stream: true })
    });
  } catch(e) { clearTimeout(t); throw friendlyFetchError(e, req); }
  clearTimeout(t);
  if (!r.ok || !r.body) throw await friendlyHttpError(r);"""
new5="""async function streamProviderDirect(ws, messages, contextData) {
  nxOfflineCheck();
  const s = ws.aiSettings;
  const req = buildProviderRequest(s);
  if (!req) throw new Error('no_key');
  const sys = contextData ? `Context: ${contextData}` : (s.system_prompt || '');
  if (sys) messages = [{ role:'system', content: sys }, ...messages.filter(m=>m.role!=='system')];
  if (Array.isArray(messages) && messages.length > 60) messages = messages.slice(messages.length - 60);

  // HARDENING: ONE retry before the first byte — a 5xx blip or a network
  // hiccup on connect does not kill the stream. Once bytes flow, no retry
  // (replaying a half-streamed answer would duplicate text in the chat).
  let r = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 45000);
    try {
      r = await fetch(req.url, {
        method:'POST', signal: ctrl.signal,
        headers: { 'Content-Type':'application/json', ...(req.key?{Authorization:`Bearer ${req.key}`}:{}) },
        body: JSON.stringify({ model: req.model, messages, temperature: s.temperature ?? 0.7, max_tokens: s.max_tokens ?? 1024, stream: true })
      });
      clearTimeout(t);
      const retryableStatus = r.status === 429 || r.status >= 500;
      if (retryableStatus && attempt === 0) { await new Promise(res => setTimeout(res, 900 + Math.random() * 600)); continue; }
      break;
    } catch(e) {
      clearTimeout(t);
      if (attempt === 0) { await new Promise(res => setTimeout(res, 700 + Math.random() * 500)); continue; }
      throw friendlyFetchError(e, req);
    }
  }
  if (!r) throw new Error('The provider could not be reached.');
  if (!r.ok || !r.body) throw await friendlyHttpError(r);"""
assert old5 in h
h=h.replace(old5,new5)

# SSE line-buffer cap: a single pathological line must not grow unbounded.
old6="""      buf = lines.pop(); // keep any partial trailing line for the next chunk"""
new6="""      // HARDENING: a hostile/broken stream sending one giant line with no
      // newline would grow this buffer forever. Cap it — if a partial line
      // exceeds 1 MB, drop its head (SSE payloads here are tiny JSON deltas).
      if (buf && buf.length > 1048576) buf = buf.slice(-1024);
      buf = lines.pop(); // keep any partial trailing line for the next chunk"""
assert old6 in h
h=h.replace(old6,new6)

open(p,'w').write(h)
print(f'✓ frontend hardening cycles applied ({n0} -> {len(h)} bytes)')
