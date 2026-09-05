// ═══════════════════════════════════════════════════════════════════════════
// observability/log.js — structured logging for the worker.
//
// Every catch block in backend/src either PROPAGATES the error or calls one
// of these helpers. There are no silent swallows: a fallback is a decision,
// and a decision leaves a record. Output is one JSON object per line so
// `wrangler tail` / Logpush can filter on `scope` and `level`.
//
// Secrets never reach a log line: messages are truncated, and values that
// look like API keys or bearer tokens are redacted before serialisation.
//
// Strict ESM, named exports only, no globalThis writes.
// ═══════════════════════════════════════════════════════════════════════════

const SECRET_RE = /\b(nvapi-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{12,}|re_[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,}|enc:v1:[A-Za-z0-9+/=]{16,})/g;

/** Redact anything that looks like a credential and cap the length. */
export function redact(value, max) {
  const s = value == null ? '' : (typeof value === 'string' ? value : safeString(value));
  return s.replace(SECRET_RE, (m) => m.slice(0, 6) + '…[redacted]').slice(0, max || 400);
}

function safeString(v) {
  try { return typeof v === 'object' ? JSON.stringify(v) : String(v); } catch (e) { return String(v); }
}

/** Normalise an unknown thrown value into { name, msg, code }. */
export function describeError(e) {
  if (e == null) return { name: 'Error', msg: 'unknown error' };
  if (typeof e !== 'object') return { name: 'Error', msg: redact(String(e)) };
  const out = { name: String(e.name || 'Error'), msg: redact(e.message || safeString(e)) };
  if (e.code !== undefined) out.code = redact(String(e.code), 60);
  if (e.kind !== undefined) out.kind = redact(String(e.kind), 60);
  if (e.status !== undefined) out.status = e.status;
  return out;
}

/** Emit one structured line. `level` ∈ debug | info | warn | error. */
export function nxLog(level, scope, fields) {
  const rec = { level, scope: String(scope || 'app').slice(0, 80), ts: new Date().toISOString() };
  if (fields && typeof fields === 'object') {
    for (const k of Object.keys(fields)) {
      if (fields[k] === undefined) continue;
      rec[k] = typeof fields[k] === 'string' ? redact(fields[k]) : fields[k];
    }
  }
  let line;
  try { line = JSON.stringify(rec); } catch (e) { line = JSON.stringify({ level, scope: rec.scope, ts: rec.ts, msg: 'unserialisable log record' }); }
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : (console.info || console.log);
  try { sink.call(console, line); } catch (e) { /* the console itself is unavailable — nothing further can be done */ }
  return rec;
}

/**
 * Record a DELIBERATE fallback: the error was caught, a documented default
 * takes over, and the request continues. Use this instead of an empty catch.
 *   logSwallow('sites.restore.graph', e, { siteId })
 */
export function logSwallow(scope, err, extra) {
  return nxLog('warn', scope, Object.assign({ swallowed: true, err: describeError(err) }, extra || {}));
}

/** Record a failure that was surfaced to the caller (500, SSE error…). */
export function logFailure(scope, err, extra) {
  return nxLog('error', scope, Object.assign({ err: describeError(err) }, extra || {}));
}

/** Wrap a promise so a rejection is logged (not lost) — for fire-and-forget work. */
export function logged(scope, promise, extra) {
  return Promise.resolve(promise).catch((e) => { logSwallow(scope, e, extra); return null; });
}
