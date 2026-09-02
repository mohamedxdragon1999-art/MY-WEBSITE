#!/usr/bin/env python3
"""Frontend batch 13: new AI tools (pipeline health, deal doctor, icebreaker, subjects,
SEO keywords, call script, brand names, image analysis, weekly review) + memory controls."""
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

# ── 1. AI_TOOLS entries ──
rep("""  {id:'siteanalyze',icon:'🔍',name:'Website Analyzer',desc:'Audit any URL: SEO, copy, CTAs, fixes',badge:'Scored'}
];""",
"""  {id:'siteanalyze',icon:'🔍',name:'Website Analyzer',desc:'Audit any URL: SEO, copy, CTAs, fixes',badge:'Scored'},
  {id:'pipelinehealth',icon:'📈',name:'Pipeline Health',desc:'0-100 score of your pipeline with reasons',badge:'Live'},
  {id:'dealdoctor',icon:'🩺',name:'Deal Doctor',desc:'Diagnose a stuck deal: next best action',badge:'Per Deal'},
  {id:'icebreaker',icon:'🧊',name:'Contact Icebreaker',desc:'Personalized opener for any contact',badge:'Personal'},
  {id:'subjects',icon:'✉️',name:'Subject Lines (A/B)',desc:'5 email subject variants that get opened',badge:'A/B'},
  {id:'seokeys',icon:'🔑',name:'SEO Keywords',desc:'High-intent keywords for any topic',badge:'SEO'},
  {id:'callscript',icon:'📞',name:'Cold Call Script',desc:'Step-by-step phone script with objection handles',badge:'Sales'},
  {id:'brandname',icon:'🏷️',name:'Brand Name Generator',desc:'Names + taglines + domain suggestions',badge:'Branding'},
  {id:'imageanalysis',icon:'🖼️',name:'Image Analyzer',desc:'Describe / OCR any image (vision AI)',badge:'Vision'},
  {id:'weeklyreview',icon:'🗓️',name:'Weekly Business Review',desc:'Structured review of wins, gaps, next week',badge:'Weekly'}
];""",
'AI_TOOLS new entries')

# ── 2. openAITool registry handlers ──
rep("""    chat:()=>{V('hub-input')?.focus();}
  };""",
"""    pipelinehealth:async()=>{toast('Analyzing your pipeline...','info',6000);try{const r=await api('/ai/pipeline-health');closeModal();openModal(`<div class="modal-header"><div class="modal-title">📈 Pipeline Health</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body">
      <div style="text-align:center;padding:16px 0"><div style="font-size:56px;font-weight:800;background:linear-gradient(135deg,${r.score>=70?'var(--green)':r.score>=45?'var(--yellow)':'var(--red)'},var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent">${r.score}/100</div><div style="font-size:15px;font-weight:700;margin-top:4px">${esc(r.verdict)}</div></div>
      <div style="display:flex;flex-direction:column;gap:8px">${(r.reasons||[]).map(x=>`<div style="display:flex;gap:8px;font-size:13px;color:var(--text2)"><span style="color:var(--accent)">▸</span>${esc(x)}</div>`).join('')}</div>
      <button class="btn btn-ai btn-sm" style="margin-top:14px" onclick="closeModal();aiAnalyzePipeline()">🤖 Get AI Action Plan</button>
    </div>`);}catch(e){toast(e.message,'error');}},
    dealdoctor:()=>openModal(`<div class="modal-header"><div class="modal-title">🩺 Deal Doctor</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Deal title or description</label><textarea id="dd-deal" rows="4" placeholder="e.g. Acme website redesign — stuck at proposal stage for 3 weeks, decision-maker went quiet"></textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doDealDoctor()">🩺 Diagnose</button></div>`),
    icebreaker:()=>openModal(`<div class="modal-header"><div class="modal-title">🧊 Contact Icebreaker</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Who are you reaching out to?</label><textarea id="ib-ctx" rows="3" placeholder="e.g. Owner of a dental clinic, met at a networking event, they mentioned wanting more patients"></textarea></div><div class="form-group"><label>Channel</label><select id="ib-ch"><option>Email</option><option>WhatsApp</option><option>LinkedIn DM</option><option>Cold call</option></select></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doIcebreaker()">🧊 Write It</button></div>`),
    subjects:()=>openModal(`<div class="modal-header"><div class="modal-title">✉️ Subject Lines (A/B)</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Email topic</label><textarea id="sb-ctx" rows="3" placeholder="e.g. Follow-up after a product demo for a marketing agency"></textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doSubjects()">✉️ Generate 5</button></div>`),
    seokeys:()=>openModal(`<div class="modal-header"><div class="modal-title">🔑 SEO Keywords</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Topic / business</label><input id="sk-topic" placeholder="e.g. wedding photography in Cairo"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doSeoKeys()">🔑 Generate</button></div>`),
    callscript:()=>openModal(`<div class="modal-header"><div class="modal-title">📞 Cold Call Script</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Who are you calling + offer</label><textarea id="cs-ctx" rows="3" placeholder="e.g. Calling restaurant owners to offer a free website audit + online ordering setup"></textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doCallScript()">📞 Write Script</button></div>`),
    brandname:()=>openModal(`<div class="modal-header"><div class="modal-title">🏷️ Brand Name Generator</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>What does your business do?</label><textarea id="bn-ctx" rows="3" placeholder="e.g. eco-friendly cleaning products for homes"></textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doBrandNames()">🏷️ Generate</button></div>`),
    imageanalysis:()=>openModal(`<div class="modal-header"><div class="modal-title">🖼️ Image Analyzer (Vision AI)</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body">
      <div class="ai-insight" style="margin-bottom:12px"><div class="ai-insight-title">How it works</div><div class="ai-insight-text">Paste a public image URL or upload one — the vision model describes it, reads any text (OCR), and answers your question. Needs a vision-capable model (NVIDIA: meta/llama-3.2-90b-vision-instruct).</div></div>
      <div class="form-group"><label>Image URL</label><input id="ia-url" placeholder="https://.../image.jpg"></div>
      <div style="text-align:center;font-size:11px;color:var(--text3);margin:6px 0">— or upload —</div>
      <div class="form-group"><label>Upload image</label><input type="file" id="ia-file" accept="image/*"></div>
      <div class="form-group"><label>Question</label><input id="ia-q" value="Describe this image. If there is text, transcribe it."></div>
      <div id="ia-preview"></div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doImageAnalysis()">🖼️ Analyze</button></div>`,'modal-lg'),
    weeklyreview:async()=>{toast('Compiling your weekly review...','info',8000);try{const [s,u]=await Promise.all([api('/stats'),api('/ai/usage')]);const r=await api('/ai/complete','POST',{prompt:`Write a structured weekly business review based on these numbers: ${JSON.stringify({...s,ai_usage:u})}. Sections: 1) Wins this week, 2) Gaps / what needs attention, 3) Focus for next week (3 items, ranked), 4) One bold suggestion to grow faster. Be specific and blunt, under 250 words.`});openModal(`<div class="modal-header"><div class="modal-title">🗓️ Weekly Review</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div></div>`,'modal-lg');}catch(e){toast(e.message,'error');}},
    chat:()=>{V('hub-input')?.focus();}
  };""",
'openAITool new handlers')

# ── 3. Handler implementations ──
rep("""// AI tool handlers
async function doEmailGen()""",
"""// New V5 AI tool handlers
async function doDealDoctor(){const t=V('dd-deal')?.value;if(!t){toast('Describe the deal','error');return;}toast('Diagnosing...','info');try{const r=await api('/ai/complete','POST',{prompt:`You are a top sales strategist. Diagnose this deal: "${t}". Give: 1) Why it's likely stuck, 2) The single most probable reason the decision-maker is hesitating, 3) Your exact recommended next move (what to say/do this week), 4) A realistic timeline, 5) When to walk away. Be specific, under 220 words.`});closeModal();openModal(`<div class="modal-header"><div class="modal-title">🩺 Deal Diagnosis</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div></div>`,'modal-lg');}catch(e){toast(e.message,'error');}}
async function doIcebreaker(){const t=V('ib-ctx')?.value;const ch=V('ib-ch')?.value;if(!t){toast('Describe the person','error');return;}toast('Writing...','info');try{const r=await api('/ai/complete','POST',{prompt:`Write a personalized icebreaker for a ${ch} outreach to: "${t}". Requirements: 30-60 words, reference something specific from their world, no generic flattery, one natural question at the end, human tone (no corporate speak). Give 2 options.`});closeModal();openModal(`<div class="modal-header"><div class="modal-title">🧊 Icebreakers</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div><button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="navigator.clipboard.writeText('${escAttr(r.content)}');toast('Copied!','success')">📋 Copy</button></div>`,'modal-lg');}catch(e){toast(e.message,'error');}}
async function doSubjects(){const t=V('sb-ctx')?.value;if(!t){toast('Describe the email topic','error');return;}toast('Writing subjects...','info');try{const r=await api('/ai/complete','POST',{prompt:`Write 5 email subject lines for: "${t}". Mix styles: curiosity, direct value, personal, urgency (classy), and question. Max 9 words each, no clickbait lies, no ALL CAPS. Number them 1-5.`});closeModal();openModal(`<div class="modal-header"><div class="modal-title">✉️ Subject Lines (A/B)</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:2;color:var(--text2)">${esc(r.content)}</div><button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="navigator.clipboard.writeText('${escAttr(r.content)}');toast('Copied!','success')">📋 Copy</button></div>`);}catch(e){toast(e.message,'error');}}
async function doSeoKeys(){const t=V('sk-topic')?.value;if(!t){toast('Enter a topic','error');return;}toast('Researching keywords...','info',8000);try{const r=await api('/ai/complete','POST',{prompt:`Generate 15 high-intent SEO keywords for: "${t}". Group into: 1) Buyer-intent keywords, 2) Informational keywords, 3) Long-tail local keywords. For each: keyword + search intent in 3 words. Format as a clean list.`});closeModal();openModal(`<div class="modal-header"><div class="modal-title">🔑 SEO Keywords</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.9;color:var(--text2)">${esc(r.content)}</div><button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="navigator.clipboard.writeText('${escAttr(r.content)}');toast('Copied!','success')">📋 Copy</button></div>`,'modal-lg');}catch(e){toast(e.message,'error');}}
async function doCallScript(){const t=V('cs-ctx')?.value;if(!t){toast('Describe the call','error');return;}toast('Writing script...','info',8000);try{const r=await api('/ai/complete','POST',{prompt:`Write a complete cold call script for: "${t}". Structure: 1) Opening line (7 seconds, non-salesy), 2) Permission question, 3) Problem discovery questions (3), 4) Value statement, 5) The ask, 6) 3 objection comebacks verbatim (price, not interested, call me later), 7) Voicemail script. Natural spoken language.`});closeModal();openModal(`<div class="modal-header"><div class="modal-title">📞 Cold Call Script</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2);max-height:70vh;overflow-y:auto">${esc(r.content)}</div></div>`,'modal-xl');}catch(e){toast(e.message,'error');}}
async function doBrandNames(){const t=V('bn-ctx')?.value;if(!t){toast('Describe the business','error');return;}toast('Generating names...','info',8000);try{const r=await api('/ai/complete','POST',{prompt:`Generate 10 brand name ideas for: "${t}". For each: name, 6-word tagline, and domain suggestion (.com if likely available, else .co/.io). Mix: descriptive, abstract, founder-style. Mark 3 favorites with ★.`});closeModal();openModal(`<div class="modal-header"><div class="modal-title">🏷️ Brand Names</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.9;color:var(--text2)">${esc(r.content)}</div></div>`,'modal-lg');}catch(e){toast(e.message,'error');}}
function iaFileToDataUrl(file, cb) {
  const reader = new FileReader();
  reader.onload = () => cb(reader.result);
  reader.onerror = () => toast('Could not read that image','error');
  reader.readAsDataURL(file);
}
async function doImageAnalysis(){
  const file = V('ia-file')?.files?.[0];
  let imageData = '';
  if (file) {
    toast('Reading image...','info',4000);
    imageData = await new Promise((res) => iaFileToDataUrl(file, res));
    if (V('ia-preview')) V('ia-preview').innerHTML = `<img src="${imageData}" style="max-width:100%;max-height:180px;border-radius:8px;border:1px solid var(--border)">`;
  }
  const url = V('ia-url')?.value?.trim() || '';
  const q = V('ia-q')?.value?.trim() || 'Describe this image. If there is text, transcribe it.';
  if (!url && !imageData) { toast('Add an image URL or upload an image','error'); return; }
  toast('AI is analyzing the image (vision models are slower)...','info',15000);
  try {
    const r = await api('/ai/analyze-image','POST',{ url, image_data: imageData, question: q });
    closeModal();
    openModal(`<div class="modal-header"><div class="modal-title">🖼️ Analysis</div><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body"><div style="display:flex;gap:12px">
        <div style="flex-shrink:0">${imageData?`<img src="${imageData}" style="max-width:160px;border-radius:8px;border:1px solid var(--border)">`:url?`<img src="${escAttr(url)}" style="max-width:160px;border-radius:8px;border:1px solid var(--border)">`:''}</div>
        <div style="flex:1;white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div>
      </div></div>`, 'modal-xl');
  } catch(e) {
    toast('Image analysis failed: '+e.message+' (tip: use a vision model like meta/llama-3.2-90b-vision-instruct)', 'error', 9000);
  }
}

// AI tool handlers
async function doEmailGen()""",
'new handlers')

# ── 4. Chat panel: memory indicator + clear-memory button ──
rep("""      <button onclick="clearPanelChat()" style="background:rgba(255,255,255,.18);border:none;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;font-weight:600">Clear</button>""",
"""      <button onclick="clearPanelChat()" style="background:rgba(255,255,255,.18);border:none;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;font-weight:600">Clear</button>
      <button onclick="clearAIMemory()" title="Forget AI memory (past conversations)" style="background:rgba(255,255,255,.18);border:none;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;font-weight:600">🧠 Forget</button>""",
'panel forget button')

rep("""function clearPanelChat() {
  STATE.panelMessages = []; STATE.panelConvId = null;
  V('panel-messages').innerHTML = '';
  addPanelMsg('assistant', '💬 Cleared. How can I help?');
}""",
"""function clearPanelChat() {
  STATE.panelMessages = []; STATE.panelConvId = null;
  V('panel-messages').innerHTML = '';
  addPanelMsg('assistant', '💬 Cleared. How can I help?');
}
async function clearAIMemory() {
  if (!confirm('Forget everything the AI remembers about your past conversations? (Current chat stays.)')) return;
  try { await api('/ai/memory','DELETE'); toast('AI memory cleared 🧠','success'); }
  catch(e) { toast('Could not clear memory: '+e.message,'error'); }
}""",
'clearAIMemory fn')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 13 done.')
