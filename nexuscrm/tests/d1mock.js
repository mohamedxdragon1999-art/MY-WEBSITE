// D1-compatible mock with automatic engine selection:
//   1. Node's built-in node:sqlite  (Node >= 22.5 — real SQLite, zero deps)
//   2. sql.js                       (any Node — WASM SQLite, `npm install sql.js`)
// Drop-in replacement for both — same exact exported interface:
//   env.DB.prepare(sql).bind(...).first()/.all()/.run()
//   env.DB.batch([stmt, stmt, ...])
//   env.DB._raw(sql) / ._runRaw(sql)  — test-only raw-SQL helpers
//
// The node:sqlite path is preserved verbatim from the shipped V4.1 mock;
// the sql.js path is the fallback for environments where node:sqlite is
// unavailable (e.g. Node 20), using the documented test dependency instead.
let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { /* older Node */ }
const USE_NODE_SQLITE = !!DatabaseSync;

let db = null;        // node:sqlite handle
let sqldb = null;     // sql.js handle

async function init(schemaSql) {
  if (USE_NODE_SQLITE) {
    db = new DatabaseSync(':memory:');
    db.exec(schemaSql);
    return db;
  }
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  sqldb = new SQL.Database();
  sqldb.run(schemaSql);
  return sqldb;
}

// ── node:sqlite statements (shipped implementation) ─────────
class Stmt {
  constructor(sql) { this.sql = sql; this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() {
    try { return db.prepare(this.sql).get(...this.params) ?? null; }
    catch (e) { throw new Error(`D1 first() failed: ${e.message} | SQL: ${this.sql}`); }
  }
  async all() {
    try { return { results: db.prepare(this.sql).all(...this.params) }; }
    catch (e) { throw new Error(`D1 all() failed: ${e.message} | SQL: ${this.sql}`); }
  }
  async run() {
    try {
      const info = db.prepare(this.sql).run(...this.params);
      return { meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
    } catch (e) { throw new Error(`D1 run() failed: ${e.message} | SQL: ${this.sql}`); }
  }
}

// ── sql.js statements (same interface, WASM engine) ─────────
class SqlJsStmt {
  constructor(sql) { this.sql = sql; this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() {
    const stmt = sqldb.prepare(this.sql);
    try {
      if (this.params.length) stmt.bind(this.params);
      return stmt.step() ? stmt.getAsObject() : null;
    } catch (e) {
      throw new Error(`D1 first() failed: ${e.message} | SQL: ${this.sql}`);
    } finally { stmt.free(); }
  }
  async all() {
    const stmt = sqldb.prepare(this.sql);
    const results = [];
    try {
      if (this.params.length) stmt.bind(this.params);
      while (stmt.step()) results.push(stmt.getAsObject());
      return { results };
    } catch (e) {
      throw new Error(`D1 all() failed: ${e.message} | SQL: ${this.sql}`);
    } finally { stmt.free(); }
  }
  async run() {
    try {
      sqldb.run(this.sql, this.params.length ? this.params : undefined);
      return { meta: { changes: sqldb.getRowsModified(), last_row_id: null } };
    } catch (e) { throw new Error(`D1 run() failed: ${e.message} | SQL: ${this.sql}`); }
  }
}

const DB = {
  prepare(sql) { return USE_NODE_SQLITE ? new Stmt(sql) : new SqlJsStmt(sql); },
  async batch(stmts) {
    const out = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  },
  // test-only helpers — API-compatible with the sql.js shape:
  //   [{ columns: [...], values: [[...]] }]
  _raw(sql) {
    if (USE_NODE_SQLITE) {
      const rows = db.prepare(sql).all();
      if (!rows.length) return [];
      const columns = Object.keys(rows[0]);
      const values = rows.map(r => columns.map(c => r[c]));
      return [{ columns, values }];
    }
    return sqldb.exec(sql); // sql.js exec() returns exactly this shape
  },
  _runRaw(sql) { USE_NODE_SQLITE ? db.exec(sql) : sqldb.run(sql); },
  _dump() { return null; }, // binary snapshot export — not needed for these tests
};

module.exports = { init, DB, db, engine: USE_NODE_SQLITE ? 'node:sqlite' : 'sql.js' };
