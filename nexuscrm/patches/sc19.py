#!/usr/bin/env python3
"""Harden AI connection settings: per-provider model, CORS classification, silent test, better guidance."""
import sys
P = 'NexusCRM_V4_Hardened.html'
s = open(P, encoding='utf-8').read()

def rep(old, new, tag, count=1):
    global s
    n = s.count(old)
    if n != count:
        print(f'❌ [{tag}] found {n}'); print('OLD:', repr(old[:110])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

# ── 1. pingProvider: per-provider model + kind classification ──
rep("""async function pingProvider(provider, s) {
  // Build against a synthetic per-provider settings object so all three
  // providers can be tested in parallel regardless of which one is "active".
  const testS = { ...s, provider };
  if (provider === 'custom' && s.provider !== 'custom') return { status:'no_key' };
  const req = buildProviderRequest(testS);
  if (!req) return { status:'no_key' };

  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 10000);
  try {
    const r = await fetch(req.url, {
      method:'POST', signal: ctrl.signal,
      headers: { 'Content-Type':'application/json', ...(req.key?{Authorization:`Bearer ${req.key}`}:{}) },
      body: JSON.stringify({ model: req.model, messages:[{role:'user',content:'Reply with the single word: ok'}], max_tokens:5 })
    });
    clearTimeout(t);
    if (r.ok) { const d = await r.json().catch(()=>({})); return { status:'ok', model: d?.model || req.model }; }
    return { status:'error', message: (await friendlyHttpError(r)).message };
  } catch(e) {
    clearTimeout(t);
    return { status:'error', message: friendlyFetchError(e, req).message };
  }
}""",
"""async function pingProvider(provider, s) {
  // Build against a synthetic per-provider settings object so all three
  // providers can be tested in parallel regardless of which one is "active".
  const testS = { ...s, provider };
  if (provider === 'custom' && s.provider !== 'custom') return { status:'no_key' };
  // Per-provider model: never test NVIDIA with an OpenAI model (or vice
  // versa) — that produced false "model not found" errors with valid keys.
  const cur = String(s.model || '');
  const looksNvidia = /^[a-z0-9_-]+\/[a-z0-9._-]+$/i.test(cur);
  if (provider === 'nvidia') testS.model = looksNvidia ? cur : 'meta/llama-3.1-8b-instruct';
  if (provider === 'openai') testS.model = looksNvidia ? 'gpt-4o-mini' : (cur || 'gpt-4o-mini');
  if (provider === 'custom') testS.model = cur || 'llama3.1';
  const req = buildProviderRequest(testS);
  if (!req) return { status:'no_key' };

  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 10000);
  try {
    const r = await fetch(req.url, {
      method:'POST', signal: ctrl.signal,
      headers: { 'Content-Type':'application/json', ...(req.key?{Authorization:`Bearer ${req.key}`}:{}) },
      body: JSON.stringify({ model: req.model, messages:[{role:'user',content:'Reply with the single word: ok'}], max_tokens:5 })
    });
    clearTimeout(t);
    if (r.ok) { const d = await r.json().catch(()=>({})); return { status:'ok', model: d?.model || req.model }; }
    return { status:'error', message: (await friendlyHttpError(r)).message, kind:'http' };
  } catch(e) {
    clearTimeout(t);
    // Classify the browser-blocked case (local-only mode + NVIDIA/OpenAI):
    // this is EXPECTED, not a key problem — the UI explains it separately.
    const corsLocal = (e instanceof TypeError) && !req.viaProxy && (provider === 'nvidia' || provider === 'openai') && !REAL_MODE() && !BACKEND.available;
    return { status:'error', message: friendlyFetchError(e, req).message, kind: corsLocal ? 'cors_local' : 'network' };
  }
}""",
'pingProvider hardened')

# ── 2. testAIConnection: silent mode no-modal + smart CORS explainer ──
rep("""async function testAIConnection(silent) {
  if (!silent) toast('Testing AI connection — actually calling the provider...','info',4000);
  try {
    const r=await api('/ai/health');
    const provider = STATE.aiSettings?.provider || 'openai';
    const current = r[provider];
    if (current) {
      if (current.status === 'ok') { STATE.aiVerified = { provider, status:'ok', at: Date.now() }; updateAIStatus('ok'); }
      else if (current.status === 'no_key') { STATE.aiVerified = null; updateAIStatus('none'); }
      else { STATE.aiVerified = { provider, status:'error', at: Date.now() }; updateAIStatus('error'); }
    }
    const lines=Object.entries(r).map(([k,v])=>{
      let line = `${k}: ${v.status==='ok'?'✅ Connected'+(v.model?` (${v.model})`:''):v.status==='no_key'?'🔑 No key configured':'❌ '+(v.message||'Failed')}`;
      if (v.status==='error' && /model|not found|404/i.test(v.message||'')) line += '  → try switching the model to meta/llama-3.1-8b-instruct (free tier) or gpt-4o-mini.';
      if (v.status==='error' && /unauthorized|invalid|401|403/i.test(v.message||'')) line += '  → double-check the key (NVIDIA keys start with nvapi-).';
      if (v.status==='error' && /rate|429|quota|credit/i.test(v.message||'')) line += '  → rate-limited or out of free credits; NVIDIA gives 1,000 free credits at build.nvidia.com — wait a bit and retry.';
      return line;
    });
    openModal(`<div class="modal-header"><div class="modal-title">🧪 Connection Test</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="font-size:12px;color:var(--text3);margin-bottom:10px">Each provider was sent a real 1-token test request — this isn't just checking whether a key is saved.</div>${lines.map(l=>`<div style="padding:9px 0;border-bottom:1px solid var(--border);font-size:13px">${esc(l)}</div>`).join('')}</div>`);
  } catch(e) { toast('Test failed: '+e.message,'error'); updateAIStatus('error'); }
}""",
"""async function testAIConnection(silent) {
  if (!silent) toast('Testing AI connection — actually calling the provider...','info',4000);
  try {
    const r=await api('/ai/health');
    const provider = STATE.aiSettings?.provider || 'openai';
    const current = r[provider];
    if (current) {
      if (current.status === 'ok') { STATE.aiVerified = { provider, status:'ok', at: Date.now() }; updateAIStatus('ok'); }
      else if (current.status === 'no_key') { STATE.aiVerified = null; updateAIStatus('none'); }
      else { STATE.aiVerified = { provider, status:'error', at: Date.now() }; updateAIStatus('error'); }
    }
    // Silent mode (auto-run after saving): update the dot + a small toast —
    // never pop a modal after every Save.
    if (silent) {
      const st = r[provider] || {};
      if (st.status === 'ok') toast(`AI connection OK ✅ (${st.model || provider})`,'success',4000);
      else if (st.status === 'error' && st.kind === 'cors_local') toast('⚠️ Local mode can\'t reach NVIDIA/OpenAI from the browser (CORS). Deploy the free backend or add the CORS proxy — see below.','warning',8000);
      else if (st.status === 'error') toast('AI connection issue: ' + (st.message || '').slice(0, 90),'warning',7000);
      else toast('AI provider configured — run Test Connection for details','info',4000);
      return;
    }
    const localOnly = !REAL_MODE() && !BACKEND.available;
    const anyCorsLocal = (r.nvidia && r.nvidia.kind === 'cors_local') || (r.openai && r.openai.kind === 'cors_local');
    const lines=Object.entries(r).map(([k,v])=>{
      let line = `${k}: ${v.status==='ok'?'✅ Connected'+(v.model?` (${v.model})`:''):v.status==='no_key'?'🔑 No key configured':'❌ '+(v.message||'Failed')}`;
      if (v.status==='error' && v.kind === 'cors_local') line += '  → expected in local mode (browser CORS). See the explainer below 👇';
      if (v.status==='error' && /model|not found|404/i.test(v.message||'')) line += '  → try switching the model to meta/llama-3.1-8b-instruct (free tier) or gpt-4o-mini.';
      if (v.status==='error' && /unauthorized|invalid|401|403/i.test(v.message||'')) line += '  → double-check the key (NVIDIA keys start with nvapi-).';
      if (v.status==='error' && /rate|429|quota|credit/i.test(v.message||'')) line += '  → rate-limited or out of free credits; NVIDIA gives 1,000 free credits at build.nvidia.com — wait a bit and retry.';
      return line;
    });
    const corsExplainer = (localOnly && anyCorsLocal) ? `
      <div class="ai-insight" style="border-color:var(--yellow);margin:14px 0 4px">
        <div class="ai-insight-title">⚠️ "Couldn't reach the provider" in local mode = normal, not a broken key</div>
        <div class="ai-insight-text" style="font-size:12px;line-height:1.7">Browsers are <b>blocked by CORS</b> from calling NVIDIA/OpenAI directly — this is enforced by the browser itself and happens to every browser-only app, no matter how valid your key is. Two real fixes, both free:<br>
        <b>1) Deploy the free backend (recommended, ~15 min)</b> — AI calls then go server-to-server and CORS disappears entirely. <button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="closeModal();navigate('settings');setTimeout(()=>document.querySelector('[data-stab=system]')?.click(),50)">⚙️ Go to Backend Setup</button><br>
        <b>2) Add the CORS proxy</b> — paste your proxy URL in the Connection box below, Save, then Test again. <button class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="closeModal();showProxyGuide()">🛠️ Show me the proxy</button></div>
      </div>` : '';
    openModal(`<div class="modal-header"><div class="modal-title">🧪 Connection Test</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="font-size:12px;color:var(--text3);margin-bottom:10px">Each provider was sent a real 1-token test request — this isn't just checking whether a key is saved.</div>${lines.map(l=>`<div style="padding:9px 0;border-bottom:1px solid var(--border);font-size:13px">${esc(l)}</div>`).join('')}${corsExplainer}</div>`);
  } catch(e) { toast('Test failed: '+e.message,'error'); updateAIStatus('error'); }
}""",
'testAIConnection hardened')

# ── 3. Connection card: clearer guidance + deploy CTA + note that proxy applies to local only ──
rep("""            <div class="form-group"><label>CORS Proxy URL (optional)</label><input id="s-proxy-url" value="${s.proxy_url||''}" placeholder="https://your-proxy.workers.dev"></div>
            <div style="font-size:12px;color:var(--text2);margin-bottom:12px">Leave empty to call the provider directly (works for local Custom servers with CORS enabled; will usually fail for OpenAI/NVIDIA from a browser).</div>
            <button class="btn btn-secondary" onclick="showProxyGuide()">🛠️ Show me how (copy-paste proxy code)</button>""",
"""            <div class="form-group"><label>CORS Proxy URL (optional)</label><input id="s-proxy-url" value="${s.proxy_url||''}" placeholder="https://your-proxy.workers.dev"></div>
            <div style="font-size:12px;color:var(--text2);margin-bottom:12px">Paste your proxy URL here, hit <b>Save Settings</b>, then <b>Test Connection</b> — the test (and chat) will route through it, which fixes the browser CORS block. Leave empty to call the provider directly (works for local Custom servers with CORS enabled).</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-primary btn-sm" onclick="saveAISettings()">💾 Save & Test</button>
              <button class="btn btn-secondary btn-sm" onclick="showProxyGuide()">🛠️ Get proxy code (free, 2 min)</button>
              <button class="btn btn-ai btn-sm" onclick="navigate('settings');setTimeout(()=>document.querySelector('[data-stab=system]')?.click(),50)">⚡ Deploy free backend instead</button>
            </div>""",
'connection card guidance')

open(P, 'w', encoding='utf-8').write(s)
print('Frontend connection hardening done.')
