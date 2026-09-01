'use strict';
// ══════════════════════════════════════════════════════════════════════════
// nx_history.js — VALIDATION HISTORY ACROSS GENERATIONS (§7)
//
// Per-page pass/fail is not enough to catch a SLOW regression: a checker that
// silently gets worse, or a prompt pattern that consistently breaks one rule,
// looks fine one page at a time. This records every generation and reports the
// distribution — how many pages needed 0 / 1 / 2+ repair iterations, how many
// exhausted the budget and shipped with unresolved blockers, and which rules
// fire most often.
//
// Bounded in-memory ring buffer: safe in a Worker, no storage dependency, and
// it can never grow without limit.
// ══════════════════════════════════════════════════════════════════════════
const NX_HISTORY_LIMIT = 200;
const __entries = [];

function nxRecordGeneration(rec) {
  const e = {
    at: new Date().toISOString(),
    direction: String((rec && rec.direction) || ''),
    name: String((rec && rec.name) || '').slice(0, 80),
    pass: !!(rec && rec.pass),
    iterations: Math.max(0, (rec && rec.iterations) || 0),
    repaired: !!(rec && rec.repaired),
    shippedWithBlockers: !!(rec && rec.shippedWithBlockers),
    blockingRules: (rec && rec.blockingRules) || [],
    warningCount: (rec && rec.warningCount) || 0,
    repairs: (rec && rec.repairs) || [],
  };
  __entries.push(e);
  while (__entries.length > NX_HISTORY_LIMIT) __entries.shift();
  return e;
}

function nxHistory(limit) {
  const n = Math.max(1, Math.min(NX_HISTORY_LIMIT, limit || 50));
  return __entries.slice(-n);
}

// Aggregate view — this is what surfaces a drift you would never see per-page.
function nxHistoryStats() {
  const total = __entries.length;
  if (!total) return { total: 0, cleanFirstPass: 0, needed1: 0, needed2plus: 0, shippedWithBlockers: 0, passRate: null, topRules: [], topRepairs: [] };
  // iterations === 1 means the first measurement already passed (no repair).
  const clean = __entries.filter(e => e.iterations <= 1 && !e.repaired).length;
  const one = __entries.filter(e => e.repaired && e.iterations === 2).length;
  const many = __entries.filter(e => e.repaired && e.iterations > 2).length;
  const blocked = __entries.filter(e => e.shippedWithBlockers).length;
  const ruleCount = {}, repairCount = {};
  for (const e of __entries) {
    for (const r of e.blockingRules) ruleCount[r] = (ruleCount[r] || 0) + 1;
    for (const r of e.repairs) { const k = String(r).split(':')[0]; repairCount[k] = (repairCount[k] || 0) + 1; }
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([rule, count]) => ({ rule, count }));
  return {
    total,
    cleanFirstPass: clean,
    needed1: one,
    needed2plus: many,
    shippedWithBlockers: blocked,
    passRate: Math.round(((total - blocked) / total) * 100),
    topRules: top(ruleCount),
    topRepairs: top(repairCount),
  };
}

function nxHistoryReset() { __entries.length = 0; }

module.exports = { nxRecordGeneration, nxHistory, nxHistoryStats, nxHistoryReset, NX_HISTORY_LIMIT };
