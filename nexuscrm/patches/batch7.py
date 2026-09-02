#!/usr/bin/env python3
"""Batch 7: local engine additions, new AI tools, expanded templates."""
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

def repBlock(start, end, new, tag):
    global s
    i = s.find(start)
    if i < 0:
        print(f'❌ [{tag}] start anchor not found: {start[:60]!r}'); sys.exit(1)
    j = s.find(end, i + len(start))
    if j < 0:
        print(f'❌ [{tag}] end anchor not found: {end[:60]!r}'); sys.exit(1)
    j += len(end)
    s = s[:i] + new + s[j:]
    print(f'  ✅ [{tag}]')

# ── blankWorkspace: new collections ──
rep("""    aiSettings: { provider:'openai', model:'gpt-4o-mini', temperature:0.7, max_tokens:2048, system_prompt:'', openai_key:'', nvidia_key:'', custom_base_url:'http://localhost:11434/v1', custom_key:'', proxy_url:'' },
    smtp: { host:'', port:587, user:'', pass:'', from:'' },
    aiUsage: { total:0, today:0, todayDate:'', conversations:0, messages:0 },
    seq: {}
  };""",
"""    aiSettings: { provider:'openai', model:'gpt-4o-mini', temperature:0.7, max_tokens:2048, system_prompt:'', openai_key:'', nvidia_key:'', custom_base_url:'http://localhost:11434/v1', custom_key:'', proxy_url:'', custom_key_set:false },
    smtp: { host:'', port:587, user:'', pass:'', from:'' },
    aiUsage: { total:0, today:0, todayDate:'', conversations:0, messages:0, tokens_today:0 },
    forms: [], formSubmissions: [], courses: [], funnels: [], affiliates: [], community: [],
    seq: {}
  };""",
tag='blankWorkspace')

# ── localApi: reviews PATCH ──
rep("""  // ── REVIEWS ──
  if (root === 'reviews') {
    if (method === 'GET') return { reviews: [...ws.reviews].reverse().map(r=>withContactName(ws,r)) };
    if (method === 'POST') {
      const r = { id: nextId(ws,'review'), platform: body.platform||'google', rating: body.rating||5, text: body.text||'', contact_id: null, ai_reply:'', status:'pending' };
      ws.reviews.push(r); saveDB(); return r;
    }
  }""",
"""  // ── REVIEWS ──
  if (root === 'reviews') {
    if (method === 'GET') return { reviews: [...ws.reviews].reverse().map(r=>withContactName(ws,r)) };
    if (method === 'POST') {
      const r = { id: nextId(ws,'review'), platform: body.platform||'google', rating: body.rating||5, text: body.text||'', contact_id: null, ai_reply:'', status:'pending' };
      ws.reviews.push(r); saveDB(); return r;
    }
    const rid = parseInt(parts[1]);
    if (method === 'PATCH') {
      const r = ws.reviews.find(x=>x.id===rid); if (!r) throw new Error('Review not found');
      Object.assign(r, body); saveDB(); return r;
    }
  }""",
tag='local reviews PATCH')

# ── localApi: social PATCH + sub-accounts PATCH/DELETE ──
rep("""  // ── SOCIAL ──
  if (root === 'social') {
    if (method === 'GET') return { posts: [...ws.social].reverse() };
    if (method === 'POST') {
      const p = { id: nextId(ws,'social'), platform: body.platform||'linkedin', content: body.content||'', status:'draft', ai_generated: body.ai_generated||0, created_at: new Date().toISOString() };
      ws.social.push(p); saveDB(); return p;
    }
  }

  // ── SUB-ACCOUNTS ──
  if (root === 'sub-accounts') {
    if (method === 'GET') return { accounts: ws.subAccounts };
    if (method === 'POST') {
      if (!body.name) throw new Error('Name is required');
      const a = { id: nextId(ws,'sub'), name: body.name, email: body.email||'', plan: body.plan||'starter', mrr: body.mrr||0, status:'active' };
      ws.subAccounts.push(a); saveDB(); return a;
    }
  }""",
"""  // ── SOCIAL ──
  if (root === 'social') {
    if (method === 'GET') return { posts: [...ws.social].reverse() };
    if (method === 'POST') {
      const p = { id: nextId(ws,'social'), platform: body.platform||'linkedin', content: body.content||'', status: body.status||'draft', ai_generated: body.ai_generated||0, created_at: new Date().toISOString() };
      ws.social.push(p); saveDB(); return p;
    }
    const pid = parseInt(parts[1]);
    if (method === 'PATCH') { const p = ws.social.find(x=>x.id===pid); if(!p) throw new Error('Post not found'); Object.assign(p, body); saveDB(); return p; }
  }

  // ── SUB-ACCOUNTS ──
  if (root === 'sub-accounts') {
    if (method === 'GET') return { accounts: ws.subAccounts };
    if (method === 'POST') {
      if (!body.name) throw new Error('Name is required');
      const a = { id: nextId(ws,'sub'), name: body.name, email: body.email||'', plan: body.plan||'starter', mrr: body.mrr||0, status:'active' };
      ws.subAccounts.push(a); saveDB(); return a;
    }
    const sid = parseInt(parts[1]);
    if (method === 'PATCH') { const a = ws.subAccounts.find(x=>x.id===sid); if(!a) throw new Error('Account not found'); Object.assign(a, body); saveDB(); return a; }
    if (method === 'DELETE') { ws.subAccounts = ws.subAccounts.filter(x=>x.id!==sid); saveDB(); return { ok:true }; }
  }

  // ── FORMS (local mode: full CRUD; public embed needs the backend) ──
  if (root === 'forms') {
    if (method === 'GET') {
      if (parts.length === 1) return { forms: [...ws.forms].reverse().map(f=>({...f, submissions: ws.formSubmissions.filter(x=>x.form_id===f.id).length})) };
      if (parts[2] === 'submissions') {
        const fid = parseInt(parts[1]);
        return { submissions: ws.formSubmissions.filter(x=>x.form_id===fid).reverse() };
      }
    }
    if (method === 'POST') {
      if (!body.name) throw new Error('Name is required');
      const f = { id: nextId(ws,'form'), name: body.name, slug: 'local-'+Math.random().toString(36).slice(2,10), fields: body.fields||[], success_message: body.success_message||'Thanks!', active: 1, created_at: new Date().toISOString() };
      ws.forms.push(f); saveDB(); return { ...f, submissions: 0 };
    }
    const fid2 = parseInt(parts[1]);
    if (method === 'DELETE' && parts[2] === 'submissions') { ws.formSubmissions = ws.formSubmissions.filter(x=>x.id!==parseInt(parts[3])); saveDB(); return { ok:true }; }
    if (method === 'PATCH') { const f = ws.forms.find(x=>x.id===fid2); if(!f) throw new Error('Form not found'); Object.assign(f, body); saveDB(); return f; }
    if (method === 'DELETE') { ws.forms = ws.forms.filter(x=>x.id!==fid2); ws.formSubmissions = ws.formSubmissions.filter(x=>x.form_id!==fid2); saveDB(); return { ok:true }; }
  }

  // ── COURSES / FUNNELS / AFFILIATES / COMMUNITY (local CRUD) ──
  if (root === 'courses') {
    if (method === 'GET') return { courses: [...ws.courses].reverse() };
    if (method === 'POST') {
      if (!body.title) throw new Error('Title is required');
      const c = { id: nextId(ws,'course'), title: body.title, description: body.description||'', price: body.price||0, status: body.status||'draft', modules: body.modules||[], created_at: new Date().toISOString() };
      ws.courses.push(c); saveDB(); return c;
    }
    const cid = parseInt(parts[1]);
    if (method === 'PATCH') { const c = ws.courses.find(x=>x.id===cid); if(!c) throw new Error('Course not found'); Object.assign(c, body); saveDB(); return c; }
    if (method === 'DELETE') { ws.courses = ws.courses.filter(x=>x.id!==cid); saveDB(); return { ok:true }; }
  }
  if (root === 'funnels') {
    if (method === 'GET') return { funnels: [...ws.funnels].reverse() };
    if (method === 'POST') {
      if (!body.name) throw new Error('Name is required');
      const f = { id: nextId(ws,'funnel'), name: body.name, goal: body.goal||'', stages: body.stages||[], created_at: new Date().toISOString() };
      ws.funnels.push(f); saveDB(); return f;
    }
    const fid3 = parseInt(parts[1]);
    if (method === 'PATCH') { const f = ws.funnels.find(x=>x.id===fid3); if(!f) throw new Error('Funnel not found'); Object.assign(f, body); saveDB(); return f; }
    if (method === 'DELETE') { ws.funnels = ws.funnels.filter(x=>x.id!==fid3); saveDB(); return { ok:true }; }
  }
  if (root === 'affiliates') {
    if (method === 'GET') return { affiliates: [...ws.affiliates].reverse() };
    if (method === 'POST') {
      if (!body.name) throw new Error('Name is required');
      const a = { id: nextId(ws,'affiliate'), name: body.name, email: body.email||'', rate: body.rate||20, token: 'local-'+Math.random().toString(36).slice(2,16), clicks: 0, conversions: 0, created_at: new Date().toISOString() };
      ws.affiliates.push(a); saveDB(); return a;
    }
    const aid = parseInt(parts[1]);
    if (method === 'PATCH') { const a = ws.affiliates.find(x=>x.id===aid); if(!a) throw new Error('Affiliate not found'); Object.assign(a, body); saveDB(); return a; }
    if (method === 'DELETE') { ws.affiliates = ws.affiliates.filter(x=>x.id!==aid); saveDB(); return { ok:true }; }
  }
  if (root === 'community') {
    if (method === 'GET') return { posts: [...ws.community].reverse() };
    if (method === 'POST') {
      if (!body.title) throw new Error('Title is required');
      const p = { id: nextId(ws,'community'), title: body.title, content: body.content||'', created_at: new Date().toISOString() };
      ws.community.push(p); saveDB(); return p;
    }
    const pid2 = parseInt(parts[1]);
    if (method === 'PATCH') { const p = ws.community.find(x=>x.id===pid2); if(!p) throw new Error('Post not found'); Object.assign(p, body); saveDB(); return p; }
    if (method === 'DELETE') { ws.community = ws.community.filter(x=>x.id!==pid2); saveDB(); return { ok:true }; }
  }""",
tag='local new routes')

# ── localApi: ai/settings clear semantics + custom_key_set + ai/usage tokens + ai/models + ai/rewrite ──
rep("""    if (method === 'PATCH') {
      const s = ws.aiSettings;
      ['provider','model','temperature','max_tokens','system_prompt','custom_base_url','proxy_url','auto_score_new_contacts','daily_digest_enabled','daily_digest_hour_utc','daily_call_cap'].forEach(k => { if (body[k]!==undefined) s[k]=body[k]; });
      if (body.openai_key) s.openai_key = body.openai_key;
      if (body.nvidia_key) s.nvidia_key = body.nvidia_key;
      if (body.custom_key) s.custom_key = body.custom_key;
      saveDB(); return { ok:true };
    }
  }
  if (rawPath === '/ai/usage') return { ...ws.aiUsage };""",
"""    if (method === 'PATCH') {
      const s = ws.aiSettings;
      ['provider','model','temperature','max_tokens','system_prompt','custom_base_url','proxy_url','auto_score_new_contacts','daily_digest_enabled','daily_digest_hour_utc','daily_call_cap'].forEach(k => { if (body[k]!==undefined) s[k]=body[k]; });
      // Explicit clear semantics: "" removes the key, undefined keeps it.
      if ('openai_key' in body) s.openai_key = body.openai_key||'';
      if ('nvidia_key' in body) s.nvidia_key = body.nvidia_key||'';
      if ('custom_key' in body) s.custom_key = body.custom_key||'';
      saveDB(); return { ok:true };
    }
  }
  if (rawPath === '/ai/models' && method === 'GET') {
    return { openai: OPENAI_MODELS, nvidia: NVIDIA_MODELS, custom: [] };
  }
  if (rawPath === '/ai/rewrite' && method === 'POST') {
    return aiOpComplete(ws, `Rewrite this text: "${String(body.text||'').slice(0,3000)}" — improve it to be clearer and more professional. Return only the rewritten text.`, body);
  }
  if (rawPath === '/ai/usage') return { ...ws.aiUsage, tokens_today: ws.aiUsage.tokens_today||0, by_op: [] };""",
tag='local ai settings/models/rewrite/usage')

# ── LOCAL_TPL: facebook + a few new types ──
rep("""  social_instagram: (ctx) => `✨ ${ctx||'Behind the scenes'} ✨\\nGrateful for this journey and the people who make it possible. More to come!\\n.\\n.\\n#smallbusiness #growth`,""",
"""  social_instagram: (ctx) => `✨ ${ctx||'Behind the scenes'} ✨\\nGrateful for this journey and the people who make it possible. More to come!\\n.\\n.\\n#smallbusiness #growth`,
  social_facebook: (ctx,tone) => `📣 ${ctx||'Big news from our team'}!\\n\\nWe wanted to share something we've been working on — ${ctx||'an update worth your attention'}. What do you think? Drop a comment and let's talk! 👇\\n\\n#business #growth`,
  cold_email: (ctx,tone,target) => `Subject: Quick idea for ${target||'your team'}\\n\\nHi${target?' '+target:''},\\n\\nI noticed ${ctx||'you might be facing a challenge we solve'}. I'd love to share a 10-minute walkthrough — no pressure at all.\\n\\nWorth a quick chat this week?\\n\\nBest regards`,
  followup_email: (ctx,tone,target) => `Subject: Following up\\n\\nHi${target?' '+target:''},\\n\\nCircling back on ${ctx||'our last conversation'} — wanted to keep the ball rolling. Happy to jump on a call whenever suits you.\\n\\nThanks!`,
  landing_page: (ctx) => `# ${ctx||'Your Product'}\\n\\nThe simplest way to ${ctx||'solve your problem'} — no clutter, no learning curve.\\n\\n## What you get\\n- Instant setup\\n- Proven results\\n- Support that answers\\n\\n[ Get Started ]`,
  hashtags: (ctx) => `#${(ctx||'business').toLowerCase().replace(/[^a-z0-9]+/g,'')} #growth #smallbusiness #marketing #tips #success #entrepreneur #startup #productivity #automation #digital #strategy #results #community #learn`,""",
tag='local templates')

# ── AI_TOOLS: add new tools ──
rep("""  {id:'research',icon:'🔍',name:'Market Research',desc:'Deep competitive analysis and opportunity discovery',badge:'Deep Research'}
];""",
"""  {id:'research',icon:'🔍',name:'Market Research',desc:'Deep competitive analysis and opportunity discovery',badge:'Deep Research'},
  {id:'landing',icon:'🚀',name:'Landing Page Copy',desc:'Full high-converting landing page copy',badge:'Conversion'},\n  {id:'product',icon:'📦',name:'Product Description',desc:'Feature→benefit descriptions that sell',badge:'E-commerce'},\n  {id:'hashtags',icon:'#️⃣',name:'Hashtag Generator',desc:'15 relevant hashtags for any topic',badge:'15 Tags'},\n  {id:'agenda',icon:'🗓️',name:'Meeting Agenda',desc:'Time-boxed agendas with outcomes',badge:'Focused'},\n  {id:'blogoutline',icon:'📑',name:'Blog Outline',desc:'Structured outlines with keywords',badge:'SEO'},\n  {id:'pressrelease',icon:'📰',name:'Press Release',desc:'Professional announcements with quotes',badge:'PR'},\n  {id:'jobdesc',icon:'💼',name:'Job Description',desc:'Complete JD with responsibilities & requirements',badge:'HR'},\n  {id:'rewrite',icon:'✨',name:'Text Improver',desc:'Polish, shorten or expand any text',badge:'8 Modes'}
];""",
tag='AI_TOOLS new')

# ── openAITool registry: add handlers ──
rep("""    emailseq:aiEmailSequence,research:()=>openModal(`<div class="modal-header"><div class="modal-title">🔍 Market Research</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Research topic</label><input id="res-topic" placeholder="e.g. Email marketing software market analysis"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doResearch()">🔍 Research</button></div>`),
    chat:()=>{V('hub-input')?.focus();}
  };""",
"""    emailseq:aiEmailSequence,research:()=>openModal(`<div class="modal-header"><div class="modal-title">🔍 Market Research</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Research topic</label><input id="res-topic" placeholder="e.g. Email marketing software market analysis"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doResearch()">🔍 Research</button></div>`),
    landing:()=>openModal(`<div class="modal-header"><div class="modal-title">🚀 Landing Page</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Product / offer</label><textarea id="lp-ctx" rows="3" placeholder="What are you selling? To whom?"></textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doLanding()">✨ Write Copy</button></div>`),
    product:()=>openModal(`<div class="modal-header"><div class="modal-title">📦 Product Description</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Product</label><textarea id="pd-ctx" rows="3" placeholder="Describe the product and its features"></textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doProduct()">✨ Write</button></div>`),
    hashtags:()=>openModal(`<div class="modal-header"><div class="modal-title">#️⃣ Hashtags</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Topic</label><input id="ht-topic" placeholder="e.g. organic skincare"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doHashtags()">✨ Generate</button></div>`),
    agenda:()=>openModal(`<div class="modal-header"><div class="modal-title">🗓️ Meeting Agenda</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Meeting purpose</label><textarea id="ag-ctx" rows="3" placeholder="e.g. Q3 planning with the team"></textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doAgenda()">✨ Build Agenda</button></div>`),
    blogoutline:()=>openModal(`<div class="modal-header"><div class="modal-title">📑 Blog Outline</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Topic</label><input id="bo-topic" placeholder="e.g. Email marketing best practices"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doBlogOutline()">✨ Outline</button></div>`),
    pressrelease:()=>openModal(`<div class="modal-header"><div class="modal-title">📰 Press Release</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Announcement</label><textarea id="pr-ctx" rows="3" placeholder="What are you announcing?"></textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doPressRelease()">✨ Write</button></div>`),
    jobdesc:()=>openModal(`<div class="modal-header"><div class="modal-title">💼 Job Description</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Role</label><input id="jd-role" placeholder="e.g. Marketing Manager"></div><div class="form-group"><label>Company & context</label><textarea id="jd-ctx" rows="3" placeholder="About the company, team, location..."></textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doJobDesc()">✨ Write</button></div>`),
    rewrite:()=>openModal(`<div class="modal-header"><div class="modal-title">✨ Text Improver</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Text</label><textarea id="rw-text" rows="6" placeholder="Paste the text you want improved..."></textarea></div><div class="form-group"><label>Mode</label><select id="rw-mode"><option value="improve">Improve (clearer, more professional)</option><option value="shorten">Shorten (cut 40%+)</option><option value="expand">Expand (more detail)</option><option value="professional">Professional tone</option><option value="friendly">Friendly tone</option><option value="persuasive">Persuasive</option><option value="simpler">Plain language</option><option value="bullets">Bullet points</option></select></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-ai" onclick="doRewrite()">✨ Rewrite</button></div>`),
    chat:()=>{V('hub-input')?.focus();}
  };""",
tag='openAITool new')

# ── new tool handlers (insert before "// AI tool handlers") ──
rep("""// AI tool handlers
async function doEmailGen()""",
"""// New AI tool handlers
async function doLanding(){const t=V('lp-ctx')?.value;if(!t){toast('Describe your offer','error');return;}toast('Writing...','info');try{const r=await api('/ai/generate','POST',{type:'landing_page',context:t});closeModal();openModal(`<div class="modal-header"><div class="modal-title">🚀 Landing Page Copy</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2);max-height:600px;overflow-y:auto">${esc(r.content)}</div></div>`,'modal-xl');}catch(e){toast(e.message,'error');}}
async function doProduct(){const t=V('pd-ctx')?.value;if(!t){toast('Describe the product','error');return;}toast('Writing...','info');try{const r=await api('/ai/generate','POST',{type:'product_description',context:t});closeModal();openModal(`<div class="modal-header"><div class="modal-title">📦 Product Description</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div></div>`,'modal-lg');}catch(e){toast(e.message,'error');}}
async function doHashtags(){const t=V('ht-topic')?.value;if(!t){toast('Enter a topic','error');return;}try{const r=await api('/ai/generate','POST',{type:'hashtags',context:t});closeModal();openModal(`<div class="modal-header"><div class="modal-title">#️⃣ Hashtags</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:14px;line-height:2;color:var(--text2)">${esc(r.content)}</div><button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="navigator.clipboard.writeText('${escAttr(r.content)}');toast('Copied!','success')">📋 Copy All</button></div>`);}catch(e){toast(e.message,'error');}}
async function doAgenda(){const t=V('ag-ctx')?.value;if(!t){toast('Enter the meeting purpose','error');return;}toast('Building...','info');try{const r=await api('/ai/generate','POST',{type:'meeting_agenda',context:t});closeModal();openModal(`<div class="modal-header"><div class="modal-title">🗓️ Agenda</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div></div>`,'modal-lg');}catch(e){toast(e.message,'error');}}
async function doBlogOutline(){const t=V('bo-topic')?.value;if(!t){toast('Enter a topic','error');return;}toast('Outlining...','info');try{const r=await api('/ai/generate','POST',{type:'blog_outline',context:t});closeModal();openModal(`<div class="modal-header"><div class="modal-title">📑 Blog Outline</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div></div>`,'modal-lg');}catch(e){toast(e.message,'error');}}
async function doPressRelease(){const t=V('pr-ctx')?.value;if(!t){toast('What are you announcing?','error');return;}toast('Writing...','info',8000);try{const r=await api('/ai/generate','POST',{type:'press_release',context:t});closeModal();openModal(`<div class="modal-header"><div class="modal-title">📰 Press Release</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2);max-height:600px;overflow-y:auto">${esc(r.content)}</div></div>`,'modal-xl');}catch(e){toast(e.message,'error');}}
async function doJobDesc(){const role=V('jd-role')?.value;const ctx=V('jd-ctx')?.value;if(!role){toast('Enter the role','error');return;}toast('Writing...','info',8000);try{const r=await api('/ai/generate','POST',{type:'job_description',context:`${role}. ${ctx||''}`});closeModal();openModal(`<div class="modal-header"><div class="modal-title">💼 ${esc(role)}</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div></div>`,'modal-lg');}catch(e){toast(e.message,'error');}}
async function doRewrite(){const t=V('rw-text')?.value;const m=V('rw-mode')?.value;if(!t){toast('Paste some text','error');return;}toast('Rewriting...','info');try{const r=await api('/ai/rewrite','POST',{text:t,mode:m});closeModal();openModal(`<div class="modal-header"><div class="modal-title">✨ Improved Text</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:var(--text2)">${esc(r.content)}</div><button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="navigator.clipboard.writeText('${escAttr(r.content)}');toast('Copied!','success')">📋 Copy</button></div>`,'modal-lg');}catch(e){toast(e.message,'error');}}

// AI tool handlers
async function doEmailGen()""",
tag='new tool handlers')

# ── dynamic AI tool count badge ──
rep("""      <span class="nav-icon">🧠</span><span class="nav-label">AI Command Hub</span><span class="nav-ai-badge">16 Tools</span>""",
"""      <span class="nav-icon">🧠</span><span class="nav-label">AI Command Hub</span><span class="nav-ai-badge" id="ai-tools-count">25 Tools</span>""",
tag='hub badge')
rep("""        <div class="page-subtitle">16 AI-powered tools • All free • All in one place</div>""",
"""        <div class="page-subtitle"><span id="ai-tools-count-sub">25</span> AI-powered tools • All free • All in one place</div>""",
tag='hub subtitle')
rep("""views['ai-hub'] = async function() {
  const usage=await api('/ai/usage').catch(()=>null);""",
"""views['ai-hub'] = async function() {
  const usage=await api('/ai/usage').catch(()=>null);
  if (V('ai-tools-count')) V('ai-tools-count').textContent = AI_TOOLS.length + ' Tools';
  if (V('ai-tools-count-sub')) V('ai-tools-count-sub').textContent = AI_TOOLS.length;""",
tag='hub count dynamic')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 7 done.')
