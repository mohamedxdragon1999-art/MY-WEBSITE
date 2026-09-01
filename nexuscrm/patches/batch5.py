#!/usr/bin/env python3
"""Batch 5: settings — updated model lists, key clear UI + save logic, custom model default."""
import sys
P = 'NexusCRM_V4_Hardened.html'
s = open(P, encoding='utf-8').read()

def rep(old, new, count=1, tag=''):
    global s
    n = s.count(old)
    if n != count:
        print(f'❌ [{tag}] expected {count}, found {n}'); print('   OLD:', repr(old[:100])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

# ── Updated model lists (2025-era lineups) ──
rep("""const NVIDIA_MODELS=['meta/llama-3.1-405b-instruct','meta/llama-3.1-70b-instruct','meta/llama-3.1-8b-instruct','nvidia/llama-3.1-nemotron-70b-instruct','nvidia/nemotron-4-340b-instruct','mistralai/mixtral-8x22b-instruct-v0.1','mistralai/mistral-large-2-instruct','deepseek-ai/deepseek-r1','microsoft/phi-3-medium-128k-instruct','google/gemma-2-27b-it','meta/llama-3.2-90b-vision-instruct','qwen/qwen2-7b-instruct'];
const NVIDIA_NAMES={'meta/llama-3.1-405b-instruct':'Llama 3.1 405B — Most Powerful','meta/llama-3.1-70b-instruct':'Llama 3.1 70B — Best Quality','meta/llama-3.1-8b-instruct':'Llama 3.1 8B — Fastest (Free)','nvidia/llama-3.1-nemotron-70b-instruct':'Nemotron 70B — Best for Business','nvidia/nemotron-4-340b-instruct':'Nemotron 340B — Max Accuracy','mistralai/mixtral-8x22b-instruct-v0.1':'Mixtral 8x22B — Efficient','mistralai/mistral-large-2-instruct':'Mistral Large 2','deepseek-ai/deepseek-r1':'DeepSeek R1 — Reasoning','microsoft/phi-3-medium-128k-instruct':'Phi-3 Medium','google/gemma-2-27b-it':'Gemma 2 27B','meta/llama-3.2-90b-vision-instruct':'Llama 3.2 Vision 90B','qwen/qwen2-7b-instruct':'Qwen 2 7B'};""",
"""const NVIDIA_MODELS=['meta/llama-3.3-70b-instruct','meta/llama-3.1-405b-instruct','meta/llama-3.1-70b-instruct','meta/llama-3.1-8b-instruct','nvidia/llama-3.1-nemotron-70b-instruct','nvidia/nemotron-4-340b-instruct','deepseek-ai/deepseek-r1','deepseek-ai/deepseek-v3','mistralai/mistral-large-2-instruct','microsoft/phi-3-medium-128k-instruct','google/gemma-2-27b-it','meta/llama-3.2-90b-vision-instruct','meta/llama-3.2-3b-instruct','qwen/qwen2-7b-instruct'];
const NVIDIA_NAMES={'meta/llama-3.3-70b-instruct':'Llama 3.3 70B — Best Quality','meta/llama-3.1-405b-instruct':'Llama 3.1 405B — Most Powerful','meta/llama-3.1-70b-instruct':'Llama 3.1 70B — Great Balance','meta/llama-3.1-8b-instruct':'Llama 3.1 8B — Fastest (Free)','nvidia/llama-3.1-nemotron-70b-instruct':'Nemotron 70B — Best for Business','nvidia/nemotron-4-340b-instruct':'Nemotron 340B — Max Accuracy','deepseek-ai/deepseek-r1':'DeepSeek R1 — Reasoning','deepseek-ai/deepseek-v3':'DeepSeek V3 — Strong All-rounder','mistralai/mistral-large-2-instruct':'Mistral Large 2','microsoft/phi-3-medium-128k-instruct':'Phi-3 Medium','google/gemma-2-27b-it':'Gemma 2 27B','meta/llama-3.2-90b-vision-instruct':'Llama 3.2 Vision 90B','meta/llama-3.2-3b-instruct':'Llama 3.2 3B — Tiny & Fast','qwen/qwen2-7b-instruct':'Qwen 2 7B'};
const OPENAI_MODELS=['gpt-4o','gpt-4o-mini','gpt-4.1','gpt-4.1-mini','gpt-3.5-turbo','o3-mini'];""",
tag='model lists')

# ── OpenAI model select: use the list + show more options ──
rep("""<div class="form-group"><label>Model</label><select id="s-model-openai"><option value="gpt-4o-mini" ${s.model==='gpt-4o-mini'?'selected':''}>GPT-4o Mini (Fast, Affordable)</option><option value="gpt-4o" ${s.model==='gpt-4o'?'selected':''}>GPT-4o (Best Quality)</option><option value="gpt-3.5-turbo" ${s.model==='gpt-3.5-turbo'?'selected':''}>GPT-3.5 Turbo (Cheapest)</option></select></div>""",
"""<div class="form-group"><label>Model</label><select id="s-model-openai">${OPENAI_MODELS.map(m=>`<option value="${m}" ${s.model===m?'selected':''}>${m==='gpt-4o'?'GPT-4o (Best Quality)':m==='gpt-4o-mini'?'GPT-4o Mini (Fast, Affordable)':m==='gpt-4.1'?'GPT-4.1 (Latest, Best Coding)':m==='gpt-4.1-mini'?'GPT-4.1 Mini (Latest, Fast)':m==='gpt-3.5-turbo'?'GPT-3.5 Turbo (Cheapest)':'o3-mini (Reasoning)'}</option>`).join('')}</select></div>""",
tag='openai model select')

# ── Key rows: add Clear links + custom key set badge ──
rep("""              <div class="form-group"><label>OpenAI API Key ${s.openai_key_set?'<span class="badge badge-green">Set</span>':''}</label><input id="s-openai-key" type="password" placeholder="sk-..." value="${s.openai_key_set?'••••••••':''}"></div>""",
"""              <div class="form-group"><label>OpenAI API Key ${s.openai_key_set?'<span class="badge badge-green">Set</span>':'<span class="badge badge-gray">Not set</span>'} ${s.openai_key_set?'<a href="#" onclick="clearAIKey(event,\'s-openai-key\')" style="font-size:11px;color:var(--red);margin-left:6px">✕ clear</a>':''}</label><input id="s-openai-key" type="password" placeholder="sk-..." value="${s.openai_key_set?'••••••••':''}"></div>""",
tag='openai key row')
rep("""              <div class="form-group"><label>NVIDIA NIM API Key ${s.nvidia_key_set?'<span class="badge badge-green">Set</span>':''}</label><input id="s-nvidia-key" type="password" placeholder="nvapi-..." value="${s.nvidia_key_set?'••••••••':''}"></div>""",
"""              <div class="form-group"><label>NVIDIA NIM API Key ${s.nvidia_key_set?'<span class="badge badge-green">Set</span>':'<span class="badge badge-gray">Not set</span>'} ${s.nvidia_key_set?'<a href="#" onclick="clearAIKey(event,\'s-nvidia-key\')" style="font-size:11px;color:var(--red);margin-left:6px">✕ clear</a>':''}</label><input id="s-nvidia-key" type="password" placeholder="nvapi-..." value="${s.nvidia_key_set?'••••••••':''}"></div>""",
tag='nvidia key row')
rep("""              <div class="form-group"><label>API Key (optional)</label><input id="s-custom-key" type="password" placeholder="Leave empty for local models"></div>""",
"""              <div class="form-group"><label>API Key (optional) ${s.custom_key_set?'<span class="badge badge-green">Set</span>':''} ${s.custom_key_set?'<a href="#" onclick="clearAIKey(event,\'s-custom-key\')" style="font-size:11px;color:var(--red);margin-left:6px">✕ clear</a>':''}</label><input id="s-custom-key" type="password" placeholder="Leave empty for local models" value="${s.custom_key_set?'••••••••':''}"></div>""",
tag='custom key row')

# ── clearAIKey helper + saveAISettings with clear semantics ──
rep("""async function saveAISettings() {
  const provider=V('s-provider')?.value;
  const updates={provider,model:provider==='openai'?V('s-model-openai')?.value:provider==='nvidia'?V('s-model-nvidia')?.value:'',temperature:parseFloat(V('s-temp')?.value)||0.7,max_tokens:parseInt(V('s-tokens')?.value)||2048,system_prompt:V('s-system-prompt')?.value,proxy_url:(V('s-proxy-url')?.value||'').trim(),
    auto_score_new_contacts:!!V('s-auto-score')?.checked, daily_digest_enabled:!!V('s-digest-enabled')?.checked,
    daily_digest_hour_utc:parseInt(V('s-digest-hour')?.value)??13, daily_call_cap:parseInt(V('s-call-cap')?.value)||300};
  const okey=V('s-openai-key')?.value; if(okey&&okey!=='••••••••') updates.openai_key=okey;
  const nkey=V('s-nvidia-key')?.value; if(nkey&&nkey!=='••••••••') updates.nvidia_key=nkey;
  if(provider==='custom') { updates.custom_base_url=V('s-custom-url')?.value; const ck=V('s-custom-key')?.value; if(ck) updates.custom_key=ck; }
  try {
    await api('/ai/settings','PATCH',updates);
    STATE.aiVerified = null;
    updateAIStatus('unverified');
    toast('Settings saved — testing connection...','info',3000);
    await loadAISettings();
    await testAIConnection(true);
  }
  catch(e) { toast(e.message,'error'); }
}""",
"""// Marks a key field as "cleared" (input emptied) so Save removes the key.
function clearAIKey(e, inputId) {
  e.preventDefault();
  const el = V(inputId);
  if (el) { el.value = ''; el.dataset.cleared = '1'; el.focus(); }
}
function keyUpdate(updates, field, value, wasSet) {
  // value === mask and not cleared → unchanged (keep)
  // value === '' and cleared → send '' (erase server-side)
  // anything else → new key
  if (value && value !== '••••••••') updates[field] = value;
  else if (value === '' && wasSet) updates[field] = '';
}
async function saveAISettings() {
  const provider=V('s-provider')?.value;
  const oSet = STATE.aiSettings?.openai_key_set;
  const nSet = STATE.aiSettings?.nvidia_key_set;
  const cSet = STATE.aiSettings?.custom_key_set;
  const updates={provider,model:provider==='openai'?V('s-model-openai')?.value:provider==='nvidia'?V('s-model-nvidia')?.value:(V('s-model-custom')?.value||''),temperature:parseFloat(V('s-temp')?.value)||0.7,max_tokens:parseInt(V('s-tokens')?.value)||2048,system_prompt:V('s-system-prompt')?.value,proxy_url:(V('s-proxy-url')?.value||'').trim(),
    auto_score_new_contacts:!!V('s-auto-score')?.checked, daily_digest_enabled:!!V('s-digest-enabled')?.checked,
    daily_digest_hour_utc:parseInt(V('s-digest-hour')?.value)??13, daily_call_cap:parseInt(V('s-call-cap')?.value)||300};
  keyUpdate(updates, 'openai_key', V('s-openai-key')?.value || '', oSet);
  keyUpdate(updates, 'nvidia_key', V('s-nvidia-key')?.value || '', nSet);
  if (provider === 'custom') {
    updates.custom_base_url=V('s-custom-url')?.value;
    keyUpdate(updates, 'custom_key', V('s-custom-key')?.value || '', cSet);
  }
  try {
    await api('/ai/settings','PATCH',updates);
    STATE.aiVerified = null;
    updateAIStatus('unverified');
    toast('Settings saved — testing connection...','info',3000);
    await loadAISettings();
    await testAIConnection(true);
  }
  catch(e) { toast(e.message,'error'); }
}""",
tag='saveAISettings keys')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 5 done.')
