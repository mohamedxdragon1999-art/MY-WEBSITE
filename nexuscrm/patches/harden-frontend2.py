# FRONTEND HARDENING BATCH 2 (cycles 59-63)
p = 'NexusCRM_V4_Hardened.html'
h = open(p).read()

# ── Cycle 59: client-side circuit breaker ──
old2 = "async function callProviderDirect(ws, messages, opts) {\n  nxOfflineCheck();\n  if (nxAIInFlight >= NX_AI_INFLIGHT_MAX)\n    throw new Error('Too many AI requests at once — let the current ones finish first.');\n  nxAIInFlight++;\n  try { return await callProviderDirectInner(ws, messages, opts); }\n  finally { nxAIInFlight--; }\n}"
new2 = """// HARDENING: client-side circuit breaker. Three consecutive failures on a
// provider open a 60s cooldown for THAT provider — the UI stops hammering a
// sick endpoint (and burning rate limit) and says so honestly instead.
const NX_CLIENT_BREAKER = {}; // provider -> { fails, until }
function nxClientBreakerOpen(provider) {
  const b = NX_CLIENT_BREAKER[provider];
  return !!(b && b.until && b.until > Date.now());
}
function nxNoteClientResult(provider, ok) {
  const b = NX_CLIENT_BREAKER[provider] || { fails: 0 };
  if (ok) { b.fails = 0; b.until = 0; }
  else { b.fails = (b.fails || 0) + 1; if (b.fails >= 3) { b.until = Date.now() + 60000; } }
  NX_CLIENT_BREAKER[provider] = b;
}
async function callProviderDirect(ws, messages, opts) {
  nxOfflineCheck();
  if (nxAIInFlight >= NX_AI_INFLIGHT_MAX)
    throw new Error('Too many AI requests at once — let the current ones finish first.');
  const prov = ws.aiSettings ? ws.aiSettings.provider : 'unknown';
  if (nxClientBreakerOpen(prov))
    throw new Error('The ' + prov + ' connection is cooling down after repeated failures (60s) — check the key/settings in AI Providers, then retry.');
  nxAIInFlight++;
  try {
    const out = await callProviderDirectInner(ws, messages, opts);
    nxNoteClientResult(prov, true);
    return out;
  } catch (e) {
    // auth/billing errors are NOT connection failures — never trip the breaker for them
    const soft = /401|403|unauthorized|quota|credits|billing/i.test(e.message || '');
    nxNoteClientResult(prov, soft);
    throw e;
  }
  finally { nxAIInFlight--; }
}"""
assert old2 in h, 'anchor cycle59'
h = h.replace(old2, new2)

# ── Cycle 60: stream usage capture ──
old3 = "        try {\n          const j = JSON.parse(payload);\n          const delta = j.choices?.[0]?.delta?.content;\n          if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({delta})}\\n\\n`));\n        } catch {}"
new3 = "          try {\n          const j = JSON.parse(payload);\n          const delta = j.choices?.[0]?.delta?.content;\n          if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({delta})}\\n\\n`));\n          // HARDENING: the final stream frame carries token usage on most\n          // providers — captured for honest accounting.\n          if (j && j.usage) {\n            try { ws.aiUsage.tokens_today = (ws.aiUsage.tokens_today||0) + (j.usage.total_tokens || ((j.usage.prompt_tokens||0)+(j.usage.completion_tokens||0))); } catch {}\n          }\n        } catch {}"
assert old3 in h, 'anchor cycle60'
h = h.replace(old3, new3)

# ── Cycle 62: key inputs strip stray whitespace on paste ──
old4 = "function clearAIKey(e, inputId) {"
new4 = """// HARDENING: keys pasted with a trailing newline/space (common when copying
// from a terminal) are silently trimmed on paste — the #1 cause of
// "valid key rejected" support tickets.
['s-openai-key','s-nvidia-key','s-custom-key'].forEach(function (id) {
  setTimeout(function () {
    const el = V(id);
    if (el && !el.dataset.trimmed) {
      el.dataset.trimmed = '1';
      el.addEventListener('paste', function () { setTimeout(function () { el.value = el.value.replace(/\\s+/g, ''); }, 0); });
    }
  }, 0);
});
function clearAIKey(e, inputId) {"""
assert old4 in h, 'anchor cycle62'
h = h.replace(old4, new4)

open(p, 'w').write(h)
print('✓ frontend cycles 59+60+62 applied')
