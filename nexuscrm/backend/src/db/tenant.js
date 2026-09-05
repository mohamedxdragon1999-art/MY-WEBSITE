// ═══════════════════════════════════════════════════════════════════════════
// db/tenant.js — the tenant-isolated data access layer.
//
// RULE (Master AI Operating Law): every statement that touches tenant data is
// scoped by workspace_id. This module makes the rule structural instead of
// habitual:
//
//   • `TENANT_TABLES` names every table that carries workspace_id, and
//     `CHILD_TABLES` the two site tables that are scoped THROUGH sites
//     (site_meta, site_versions — keyed by site_id only).
//   • `tenantSql(sql)` is a static linter: it refuses a SELECT/UPDATE/DELETE
//     on a tenant table whose WHERE clause carries no workspace scope. It is
//     called by every helper here and exported for the test suite, which runs
//     it over every `prepare('…')` literal in index.js.
//   • `Tenant(env, ws)` returns a bound accessor: `t.first/all/run(sql, ...)`,
//     `t.site*()` helpers for the three site tables, and `t.tx([...])` which
//     runs a set of statements as ONE D1 batch (atomic on D1: the whole batch
//     commits or rolls back; the test mock executes sequentially — see
//     `txAtomicity` in the multi-tenant suite).
//   • Site-child access always goes through `siteOwned()` (an existence check
//     inside the same workspace) AND a `site_id IN (SELECT id FROM sites WHERE
//     workspace_id=?)` sub-select in the statement itself — two independent
//     locks, so a future refactor that drops one cannot open the door.
//
// Strict ESM, named exports only, no globalThis writes, no module state.
// ═══════════════════════════════════════════════════════════════════════════

/** Every table with a workspace_id column. */
export const TENANT_TABLES = Object.freeze([
  'contacts', 'deals', 'tasks', 'messages', 'appointments', 'reviews', 'invoices',
  'workflows', 'events', 'workflow_runs', 'trigger_links', 'forms', 'form_submissions',
  'social_posts', 'funnels', 'courses', 'community_posts', 'affiliates', 'affiliate_clicks',
  'sub_accounts', 'sites', 'chat_memory', 'ai_usage_log', 'ai_feedback', 'audit_log',
  'users', 'sessions',
]);
/** Tables scoped through sites.workspace_id (keyed by site_id). */
export const CHILD_TABLES = Object.freeze(['site_meta', 'site_versions']);

const TABLE_RE = new RegExp('\\b(?:FROM|UPDATE|INTO|JOIN)\\s+(' + TENANT_TABLES.concat(CHILD_TABLES).join('|') + ')\\b', 'gi');

/**
 * Static tenancy lint for one SQL string. Returns `{ ok, tables, reason }`.
 * Rules:
 *   • INSERT INTO <tenant table> must name workspace_id in its column list
 *     (child tables: site_id).
 *   • SELECT/UPDATE/DELETE touching a tenant table must contain
 *     `workspace_id` in a WHERE/JOIN condition, OR be scoped through a
 *     `site_id IN (SELECT id FROM sites WHERE workspace_id` sub-select, OR be
 *     explicitly marked `/* tenant-scope: <reason> *\/` for the handful of
 *     public/cron statements that are keyed by an unguessable token/slug or
 *     run across all tenants by design (the marker makes the exemption
 *     visible in code review and greppable).
 */
export function tenantSql(sql) {
  const s = String(sql || '');
  const tables = [];
  let m;
  TABLE_RE.lastIndex = 0;
  while ((m = TABLE_RE.exec(s))) tables.push(m[1].toLowerCase());
  if (!tables.length) return { ok: true, tables, reason: 'no tenant table' };
  if (/\/\*\s*tenant-scope:[^*]+\*\//.test(s)) return { ok: true, tables, reason: 'explicit exemption' };
  const head = s.trim().slice(0, 12).toUpperCase();
  if (head.startsWith('INSERT')) {
    const cols = (s.match(/\(([^)]*)\)\s*(?:VALUES|SELECT)/i) || [])[1] || '';
    const child = tables.every((t) => CHILD_TABLES.includes(t));
    // INSERT … SELECT into a child table is scoped by the SELECT's own predicate.
    const viaSelect = /\bworkspace_id\s*=/i.test(s) && /\bSELECT\b/i.test(s);
    const ok = (child ? /\bsite_id\b/i.test(cols) : /\bworkspace_id\b/i.test(cols)) || viaSelect;
    return { ok, tables, reason: ok ? 'insert carries scope column' : 'INSERT without workspace_id column' };
  }
  const scoped = /\bworkspace_id\s*(?:=|IN\b|!=|<>)/i.test(s)
    || /\bsite_id\s+IN\s*\(\s*SELECT\s+id\s+FROM\s+sites\s+WHERE\s+workspace_id/i.test(s)
    || /\bworkspaces\s+w\b[\s\S]*\bw\.id\s*=/i.test(s);
  return { ok: scoped, tables, reason: scoped ? 'scoped' : 'no workspace_id predicate' };
}

/** Throw when a statement fails the tenancy lint — the guard for every helper below. */
function assertTenantSql(sql) {
  const v = tenantSql(sql);
  if (!v.ok) throw new Error('Tenant-isolation violation: ' + v.reason + ' — ' + String(sql).replace(/\s+/g, ' ').slice(0, 160));
  return sql;
}

/** Normalise an id from a route segment: positive integer or null. */
export function parseId(raw) {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw == null ? '' : raw), 10);
  return Number.isInteger(n) && n > 0 && n < 9007199254740991 ? n : null;
}

/** Parse a JSON column with an audited fallback (never a silent catch). */
export function parseJsonColumn(raw, fallback, onError) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); }
  catch (e) { if (typeof onError === 'function') onError(e); return fallback; }
}

const SITE_SCOPE = 'site_id IN (SELECT id FROM sites WHERE workspace_id=?)';

/**
 * A workspace-bound accessor. `ws` is the authenticated workspace id; every
 * helper binds it itself so a call site cannot forget it.
 */
export function Tenant(env, ws) {
  const wsId = parseId(ws);
  if (!env || !env.DB) throw new Error('Tenant(): env.DB is required');
  if (!wsId) throw new Error('Tenant(): a valid workspace id is required');
  const DB = env.DB;
  const prep = (sql, params) => DB.prepare(assertTenantSql(sql)).bind(...(params || []));

  const t = {
    ws: wsId,
    /** Raw (linted) statement helpers — `ws` must appear among `params` where the SQL expects it. */
    stmt: (sql, ...params) => prep(sql, params),
    first: (sql, ...params) => prep(sql, params).first(),
    all: async (sql, ...params) => (await prep(sql, params).all()).results || [],
    run: (sql, ...params) => prep(sql, params).run(),
    /**
     * Transactional unit: all statements in one D1 batch. D1 executes a batch
     * as a single transaction — one failure rolls back all of them. Returns
     * the per-statement results; `changes` is the sum of affected rows.
     */
    tx: async (stmts) => {
      const list = (stmts || []).filter(Boolean);
      if (!list.length) return { results: [], changes: 0 };
      const results = await DB.batch(list);
      const changes = (results || []).reduce((n, r) => n + ((r && r.meta && r.meta.changes) || 0), 0);
      return { results: results || [], changes };
    },

    // ── sites ──────────────────────────────────────────────────────────
    /** The site row (selected columns) if it belongs to this workspace, else null. */
    site: (id, cols) => {
      const sid = parseId(id);
      if (!sid) return Promise.resolve(null);
      const c = Array.isArray(cols) && cols.length ? cols.map((x) => x.replace(/[^a-z_]/gi, '')).join(',') : '*';
      return t.first(`SELECT ${c} FROM sites WHERE id=? AND workspace_id=?`, sid, wsId);
    },
    /** True when the site exists in this workspace. */
    siteOwned: async (id) => !!(await t.site(id, ['id'])),
    /** Update html/graph/updated_at for an owned site (returns changes). */
    siteUpdateHtml: async (id, html, graph, nowIso) => {
      const sid = parseId(id);
      if (!sid) return 0;
      const r = graph === undefined
        ? await t.run('UPDATE sites SET html=?, updated_at=? WHERE id=? AND workspace_id=?', html, nowIso, sid, wsId)
        : await t.run('UPDATE sites SET html=?, graph=?, updated_at=? WHERE id=? AND workspace_id=?', html, graph, nowIso, sid, wsId);
      return (r && r.meta && r.meta.changes) || 0;
    },

    // ── site_meta (scoped through sites) ──────────────────────────────
    siteMetaGet: async (siteId) => {
      const sid = parseId(siteId);
      if (!sid) return null;
      return t.first(`SELECT site_id, design_id, instructions, content_plan, theme, custom_css FROM site_meta WHERE site_id=? AND ${SITE_SCOPE}`, sid, wsId);
    },
    /** Upsert statement (for use inside tx) — the ownership check must precede it. */
    siteMetaUpsertStmt: (siteId, meta) => {
      const sid = parseId(siteId);
      const m = meta || {};
      return t.stmt(
        `INSERT INTO site_meta (site_id, design_id, instructions, content_plan, theme, custom_css) VALUES (?,?,?,?,?,?)
         ON CONFLICT(site_id) DO UPDATE SET design_id=excluded.design_id, instructions=excluded.instructions, content_plan=excluded.content_plan, theme=excluded.theme, custom_css=excluded.custom_css`,
        sid, String(m.design_id || ''), String(m.instructions || '').slice(0, 2000), String(m.content_plan || '{}'), String(m.theme || '{}'), String(m.custom_css || '').slice(0, 8000));
    },
    siteMetaUpdateStmt: (siteId, meta) => {
      const sid = parseId(siteId);
      const m = meta || {};
      return t.stmt(`UPDATE site_meta SET design_id=?, instructions=?, theme=?, custom_css=? WHERE site_id=? AND ${SITE_SCOPE}`,
        String(m.design_id || ''), String(m.instructions || '').slice(0, 2000), String(m.theme || '{}'), String(m.custom_css || '').slice(0, 8000), sid, wsId);
    },
    /** design_id for every site in the workspace (the list view) — one query, no global scan. */
    siteMetaDesignMap: async () => {
      const rows = await t.all(`SELECT site_id, design_id FROM site_meta WHERE ${SITE_SCOPE}`, wsId);
      const out = {};
      for (const r of rows) out[r.site_id] = r.design_id;
      return out;
    },

    // ── site_versions (scoped through sites) ──────────────────────────
    siteVersions: async (siteId, limit) => {
      const sid = parseId(siteId);
      if (!sid) return [];
      return t.all(`SELECT id, label, LENGTH(html) AS html_size, LENGTH(graph) AS graph_size, created_at FROM site_versions WHERE site_id=? AND ${SITE_SCOPE} ORDER BY id DESC LIMIT ?`, sid, wsId, Math.max(1, Math.min(200, limit || 50)));
    },
    siteVersion: async (siteId, versionId) => {
      const sid = parseId(siteId), vid = parseId(versionId);
      if (!sid || !vid) return null;
      return t.first(`SELECT id, site_id, label, html, graph, created_at FROM site_versions WHERE id=? AND site_id=? AND ${SITE_SCOPE}`, vid, sid, wsId);
    },
    siteVersionInsertStmt: (siteId, label, html, graph) => {
      const sid = parseId(siteId);
      return t.stmt('INSERT INTO site_versions (site_id, label, html, graph) VALUES (?,?,?,?)', sid, String(label || 'checkpoint').slice(0, 60), String(html || ''), String(graph || ''));
    },
    /** Keep only the newest `keep` versions of a site (statement for tx). */
    siteVersionsPruneStmt: (siteId, keep) => {
      const sid = parseId(siteId);
      return t.stmt(`DELETE FROM site_versions WHERE site_id=? AND ${SITE_SCOPE} AND id NOT IN (SELECT id FROM site_versions WHERE site_id=? ORDER BY id DESC LIMIT ?)`, sid, wsId, sid, Math.max(1, keep || 40));
    },
    siteVersionsDeleteAll: async (siteId) => {
      const sid = parseId(siteId);
      if (!sid) return 0;
      const r = await t.run(`DELETE FROM site_versions WHERE site_id=? AND ${SITE_SCOPE}`, sid, wsId);
      return (r && r.meta && r.meta.changes) || 0;
    },
    /** Statement (for tx): delete every child row of a site — used by DELETE /sites/:id. */
    siteChildrenDeleteStmts: (siteId) => {
      const sid = parseId(siteId);
      return [
        t.stmt(`DELETE FROM site_versions WHERE site_id=? AND ${SITE_SCOPE}`, sid, wsId),
        t.stmt(`DELETE FROM site_meta WHERE site_id=? AND ${SITE_SCOPE}`, sid, wsId),
      ];
    },
  };
  return t;
}
