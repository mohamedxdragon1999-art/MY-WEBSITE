#!/usr/bin/env python3
"""Super-cycle 2b: routes for AI-on-data endpoints."""
import sys
P = 'backend/src/index.js'
s = open(P, encoding='utf-8').read()
old = """  if (path === '/ai/suggest-workflows' && req.method === 'GET') {"""
new = """  if (root === 'ai' && parts[1] === 'contact-summary' && parts[2] && req.method === 'GET') {
    try { return json(await aiContactSummary(env, auth.workspaceId, parseInt(parts[2])), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }
  if (root === 'ai' && parts[1] === 'tag-suggest' && parts[2] && req.method === 'GET') {
    try { return json(await aiSuggestTags(env, auth.workspaceId, parseInt(parts[2])), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/smart-reply' && req.method === 'POST') {
    try { return json(await aiSmartReply(env, auth.workspaceId, body.text), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/score-tasks' && req.method === 'GET') {
    try { return json(await aiScoreTasks(env, auth.workspaceId), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/deal-risks' && req.method === 'GET') {
    return json(await aiDealRisks(env, auth.workspaceId), 200, origin);
  }
  if (path === '/ai/translate' && req.method === 'POST') {
    try {
      const w = await getWorkspace(env, auth.workspaceId);
      if (!(await withinDailyCap(env, auth.workspaceId, w.ai_daily_call_cap))) return err('Daily AI call cap reached.', 429, origin);
      const lang = String(body.language || 'English').slice(0, 40);
      const r = await callProvider(w, [{ role: 'user', content: `Translate to ${lang}. Return ONLY the translated text: "${String(body.text || '').slice(0, 4000)}"` }], { max_tokens: 1000 });
      await trackAIUsage(env, auth.workspaceId, 'translate', r.provider, r.usage);
      return json({ content: r.content }, 200, origin);
    } catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/tone-remix' && req.method === 'POST') {
    try {
      const w = await getWorkspace(env, auth.workspaceId);
      if (!(await withinDailyCap(env, auth.workspaceId, w.ai_daily_call_cap))) return err('Daily AI call cap reached.', 429, origin);
      const tone = String(body.tone || 'professional').slice(0, 30);
      const r = await callProvider(w, [{ role: 'user', content: `Rewrite this in a ${tone} tone. Keep the meaning and length similar. Return only the rewrite:\\n\\n${String(body.text || '').slice(0, 4000)}` }], { max_tokens: 1500 });
      await trackAIUsage(env, auth.workspaceId, 'tone-remix', r.provider, r.usage);
      return json({ content: r.content }, 200, origin);
    } catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/doc-analyze' && req.method === 'POST') {
    try {
      const w = await getWorkspace(env, auth.workspaceId);
      if (!(await withinDailyCap(env, auth.workspaceId, w.ai_daily_call_cap))) return err('Daily AI call cap reached.', 429, origin);
      const r = await callProvider(w, [{ role: 'user', content: `Analyze this document. Give: 1) Key points (5 max), 2) Decisions made, 3) Action items with owner+deadline if mentioned, 4) Open questions. Be concise.\\n\\n${String(body.text || '').slice(0, 6000)}` }], { max_tokens: 800 });
      await trackAIUsage(env, auth.workspaceId, 'doc-analyze', r.provider, r.usage);
      return json({ content: r.content }, 200, origin);
    } catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/suggest-workflows' && req.method === 'GET') {"""
n = s.count(old)
if n != 1:
    print('❌ anchor count', n); sys.exit(1)
s = s.replace(old, new)
open(P, 'w', encoding='utf-8').write(s)
print('routes added')
