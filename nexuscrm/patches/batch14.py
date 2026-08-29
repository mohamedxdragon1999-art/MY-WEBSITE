#!/usr/bin/env python3
"""Frontend batch 14: LIVE model dropdowns in Settings (from backend catalog)."""
import sys
P = 'NexusCRM_V4_Hardened.html'
s = open(P, encoding='utf-8').read()

def rep(old, new, tag):
    global s
    n = s.count(old)
    if n != 1:
        print(f'❌ [{tag}] found {n}'); print('OLD:', repr(old[:100])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

# ── 1. Pretty-name helper + OPENAI_NAMES next to the existing model consts ──
rep("""const OPENAI_MODELS=['gpt-4o','gpt-4o-mini','gpt-4.1','gpt-4.1-mini','gpt-3.5-turbo','o3-mini'];""",
"""const OPENAI_MODELS=['gpt-4o','gpt-4o-mini','gpt-4.1','gpt-4.1-mini','gpt-3.5-turbo','o3-mini'];
const OPENAI_NAMES={'gpt-4o':'GPT-4o (Best Quality)','gpt-4o-mini':'GPT-4o Mini (Fast, Affordable)','gpt-4.1':'GPT-4.1 (Latest)','gpt-4.1-mini':'GPT-4.1 Mini (Latest, Fast)','gpt-3.5-turbo':'GPT-3.5 Turbo (Cheapest)','o3-mini':'o3-mini (Reasoning)'};
// Human-friendly name for ANY model id (including live catalog entries the
// curated maps don't know): "meta/llama-3.1-8b-instruct" → "Llama 3.1 8B Instruct (meta)".
function prettyModelName(id) {
  const known = NVIDIA_NAMES[id] || OPENAI_NAMES[id];
  if (known) return known;
  const parts = String(id || '').split('/');
  const org = parts.length > 1 ? parts[0] : '';
  const base = (parts[parts.length - 1] || id)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  return org ? `${base} (${org})` : base;
}""",
'prettyModelName')

# ── 2. Settings view: fetch live catalog before rendering ──
rep("""views.settings = async function() {
  let s = {provider:'nvidia',model:'meta/llama-3.1-8b-instruct',temperature:0.7,max_tokens:2048,system_prompt:'',proxy_url:'',openai_key_set:false,nvidia_key_set:false,auto_score_new_contacts:false,daily_digest_enabled:false,daily_digest_hour_utc:13,daily_call_cap:0};
  try { s = await api('/ai/settings') || s; } catch {}""",
"""views.settings = async function() {
  let s = {provider:'nvidia',model:'meta/llama-3.1-8b-instruct',temperature:0.7,max_tokens:2048,system_prompt:'',proxy_url:'',openai_key_set:false,nvidia_key_set:false,auto_score_new_contacts:false,daily_digest_enabled:false,daily_digest_hour_utc:13,daily_call_cap:0};
  try { s = await api('/ai/settings') || s; } catch {}
  // LIVE model catalog from the backend (fetched from NVIDIA/OpenAI with
  // your key — always current, never a hardcoded placeholder list).
  let liveModels = null;
  try { liveModels = await api('/ai/models').catch(() => null); } catch {}
  let nvidiaModels = (liveModels && Array.isArray(liveModels.nvidia) && liveModels.nvidia.length) ? liveModels.nvidia : NVIDIA_MODELS;
  let openaiModels = (liveModels && Array.isArray(liveModels.openai) && liveModels.openai.length) ? liveModels.openai : OPENAI_MODELS;
  // Never drop the user's currently-selected model from the dropdown even if
  // it isn't in the live list (it still works — it was set deliberately).
  if (s.model && !nvidiaModels.includes(s.model)) nvidiaModels = [s.model, ...nvidiaModels];
  if (s.model && !openaiModels.includes(s.model)) openaiModels = [s.model, ...openaiModels];
  window.__nvidiaModels = nvidiaModels;
  window.__openaiModels = openaiModels;
  const modelsLive = !!(liveModels && liveModels.nvidia && liveModels.nvidia.length > 3);""",
'live models fetch')

# ── 3. OpenAI select from live list ──
rep("""<div class="form-group"><label>Model</label><select id="s-model-openai">${OPENAI_MODELS.map(m=>`<option value="${m}" ${s.model===m?'selected':''}>${m==='gpt-4o'?'GPT-4o (Best Quality)':m==='gpt-4o-mini'?'GPT-4o Mini (Fast, Affordable)':m==='gpt-4.1'?'GPT-4.1 (Latest, Best Coding)':m==='gpt-4.1-mini'?'GPT-4.1 Mini (Latest, Fast)':m==='gpt-3.5-turbo'?'GPT-3.5 Turbo (Cheapest)':'o3-mini (Reasoning)'}</option>`).join('')}</select></div>""",
"""<div class="form-group"><label>Model</label><select id="s-model-openai">${openaiModels.map(m=>`<option value="${m}" ${s.model===m?'selected':''}>${prettyModelName(m)}</option>`).join('')}</select></div>
              <div style="font-size:11px;color:var(--text3)">${modelsLive ? `✅ Live catalog from OpenAI (${openaiModels.length} models)` : 'Showing fallback list — add your OpenAI key to load the live catalog'}</div>""",
'openai select live')

# ── 4. NVIDIA select from live list ──
rep("""<div class="form-group"><label>Model</label><select id="s-model-nvidia">${NVIDIA_MODELS.map(m=>`<option value="${m}" ${s.model===m?'selected':''}>${NVIDIA_NAMES[m]||m}</option>`).join('')}</select></div>""",
"""<div class="form-group"><label>Model</label><select id="s-model-nvidia">${nvidiaModels.map(m=>`<option value="${m}" ${s.model===m?'selected':''}>${prettyModelName(m)}</option>`).join('')}</select></div>
              <div style="font-size:11px;color:var(--text3)">${modelsLive ? `✅ Live catalog from NVIDIA NIM (${nvidiaModels.length} models — updates automatically as NVIDIA adds/removes them)` : 'Showing fallback list — add your NVIDIA key to load the LIVE catalog'}</div>""",
'nvidia select live')

# ── 5. Refresh button in the AI card action row ──
rep("""              <button class="btn btn-primary" onclick="saveAISettings()">Save Settings</button>
              <button class="btn btn-secondary" onclick="testAIConnection()">🧪 Test Connection</button>
              <button class="btn btn-ai" onclick="navigate('ai-hub')">🧠 Open AI Hub</button>""",
"""              <button class="btn btn-primary" onclick="saveAISettings()">Save Settings</button>
              <button class="btn btn-secondary" onclick="testAIConnection()">🧪 Test Connection</button>
              <button class="btn btn-secondary" onclick="refreshModels()">🔄 Refresh Models</button>
              <button class="btn btn-ai" onclick="navigate('ai-hub')">🧠 Open AI Hub</button>""",
'refresh models button')

# ── 6. refreshModels handler ──
rep("""// Marks a key field as "cleared" (input emptied) so Save removes the key.""",
"""// Force a fresh live model catalog fetch from the providers.
async function refreshModels() {
  toast('Fetching the latest models from NVIDIA/OpenAI...','info',6000);
  try {
    const r = await api('/ai/models?refresh=1');
    const n = (r.nvidia||[]).length;
    toast(`Live model catalog refreshed — ${n} NVIDIA models available ✅`,'success',5000);
    views.settings();
  } catch(e) { toast('Could not refresh models: '+e.message,'error'); }
}
// Marks a key field as "cleared" (input emptied) so Save removes the key.""",
'refreshModels fn')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 14 done.')
