// ═══════════════════════════════════════════════════════════════════════════
// test_tenant_isolation.mjs — the multi-tenant assertion suite.
//
//  A. STATIC: every SQL literal in backend/src/index.js passes the tenancy
//     lint (db/tenant.js#tenantSql) — no unscoped statement can be added
//     without either a workspace predicate or an explicit, reviewable
//     `/* tenant-scope: … */` exemption.
//  B. CONCURRENT TENANTS: 4 workspaces × parallel create/read/update/snapshot/
//     restore/delete on sites — no cross-tenant read, write, or delete; every
//     response carries only the caller's rows; final row counts add up.
//  C. IDOR SWEEP (sites sub-resources): every site route as another tenant is
//     404 and leaves the owner's data byte-identical.
//  D. STATE RESTORATION: regenerate → auto-checkpoint → restore → the exact
//     previous html/graph is back; restore is itself reversible; import/design
//     overwrite leave checkpoints; the version cap holds.
//  E. FAILURE RECOVERY / ATOMICITY: a batch that fails mid-way leaves no
//     partial state (site create without meta, delete without children);
//     a build that throws leaves the previous page intact; invalid bodies are
//     400s with the field name and change nothing.
//  F. LEAD FORM CONTINUITY (N8) + DRAFT SEPARATION (N7): settings save and
//     regenerate keep the lead URL and never publish a draft; publish_action
//     is the only publish path.
//  G. SILENT-CATCH LINT: no empty/no-op catch in backend/src/*.js outside the
//     documented allow-list (embedded client-side scripts).
// Prints `ISOLATION RESULTS: n passed, m failed` for run_all.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const { init, DB } = require(join(ROOT, 'tests', 'd1mock.js'));
await init(readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8'));
const workerMod = await import(pathToFileURL(join(ROOT, 'backend', 'src', 'index.js')).href);
const worker = workerMod.default;
const { tenantSql, Tenant } = await import(pathToFileURL(join(ROOT, 'backend', 'src', 'db', 'tenant.js')).href);
const { validateSiteBody } = await import(pathToFileURL(join(ROOT, 'backend', 'src', 'validators', 'brief.js')).href);

const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9, ENCRYPTION_KEY: 'test-secret' };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
const BASE = 'http://test.local';
let passed = 0, failed = 0;
const check = (name, ok, detail) => { if (ok) { passed++; console.log('  ✅', name); } else { failed++; console.log('  ❌', name, detail ? '— ' + String(detail).slice(0, 300) : ''); } };
async function call(method, path, body, token, headers) {
  const h = { 'Content-Type': 'application/json', Origin: 'http://app.local', ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  const noBody = body === undefined || body === null || method === 'GET' || method === 'HEAD';
  const r = await worker.fetch(new Request(BASE + '/api' + path, { method, headers: h, body: noBody ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }), env, ctx);
  let data = null; try { data = await r.json(); } catch (e) { data = null; }
  return { status: r.status, data };
}
const SRC = readFileSync(join(ROOT, 'backend', 'src', 'index.js'), 'utf8');

// ── A. static tenancy lint ──────────────────────────────────────────────
console.log('\n== A. Every SQL literal in index.js is tenant-scoped (or explicitly exempted) ==');
{
  const re = /\.prepare\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g;
  let m, total = 0; const bad = [], exempt = [];
  while ((m = re.exec(SRC))) {
    const sql = m[1] ?? m[2] ?? m[3]; total++;
    const v = tenantSql(sql);
    const ln = SRC.slice(0, m.index).split('\n').length;
    if (!v.ok) bad.push(ln + ': ' + sql.replace(/\s+/g, ' ').slice(0, 90));
    else if (v.reason === 'explicit exemption') exempt.push(ln);
  }
  check(`all ${total} SQL literals pass the tenancy lint`, bad.length === 0, bad.slice(0, 4).join(' | '));
  check('exemptions are few and public/cron/auth only (≤ 20)', exempt.length > 0 && exempt.length <= 20, exempt.length + ' exemptions');
  // the lint itself must reject the classic mistakes
  check('lint rejects DELETE FROM site_versions WHERE site_id=?', !tenantSql('DELETE FROM site_versions WHERE site_id=?').ok);
  check('lint rejects UPDATE sites SET html=? WHERE id=?', !tenantSql('UPDATE sites SET html=? WHERE id=?').ok);
  check('lint rejects INSERT INTO contacts without workspace_id', !tenantSql('INSERT INTO contacts (name,email) VALUES (?,?)').ok);
  check('lint accepts a site_id IN (SELECT … workspace_id) scope', tenantSql('SELECT id FROM site_versions WHERE site_id=? AND site_id IN (SELECT id FROM sites WHERE workspace_id=?)').ok);
  check('lint ignores non-tenant tables', tenantSql('SELECT * FROM workspaces WHERE id=?').ok);
  let threw = false; try { Tenant(env, 1).stmt('SELECT * FROM contacts WHERE id=?', 1); } catch (e) { threw = /Tenant-isolation violation/.test(e.message); }
  check('Tenant() refuses to prepare an unscoped statement', threw);
}

// ── B. concurrent tenants ───────────────────────────────────────────────
console.log('\n== B. Concurrent tenants: parallel site lifecycles never cross ==');
const TENANTS = [];
{
  const regs = await Promise.all([0, 1, 2, 3].map((i) => call('POST', '/auth/register', { name: 'T' + i, email: `iso${i}-${Date.now()}@x.com`, password: 'password123', workspace_name: 'W' + i })));
  check('4 tenants registered concurrently', regs.every((r) => r.status === 200 && r.data.token), regs.map((r) => r.status).join(','));
  for (const r of regs) TENANTS.push({ token: r.data.token, ws: r.data.workspace_id || (r.data.workspace && r.data.workspace.id) || null, sites: [] });
  // each tenant creates 3 sites in parallel — 12 concurrent POSTs
  const creates = await Promise.all(TENANTS.flatMap((t, ti) => [0, 1, 2].map((k) => call('POST', '/sites', { name: `T${ti} site ${k}`, html: `<!DOCTYPE html><html><body><h1>SECRET-T${ti}-${k}</h1></body></html>`, published: k === 0 }, t.token))));
  check('12 concurrent site creates succeed', creates.every((r) => r.status === 200 && r.data.id), creates.map((r) => r.status).join(','));
  creates.forEach((r, i) => TENANTS[Math.floor(i / 3)].sites.push(r.data));
  const lists = await Promise.all(TENANTS.map((t) => call('GET', '/sites', null, t.token)));
  check('each tenant lists exactly its own 3 sites', lists.every((r, i) => r.data.sites.length === 3 && r.data.sites.every((s) => /^T\d/.test(s.name) && s.name.startsWith('T' + i))), lists.map((r) => r.data.sites.length).join(','));
  check('the list carries design_id for every row (per-workspace meta query)', lists.every((r) => r.data.sites.every((s) => typeof s.design_id === 'string' && s.design_id)));
  // interleaved reads/updates/snapshots across tenants at once
  const ops = await Promise.all(TENANTS.flatMap((t, ti) => t.sites.flatMap((s) => [
    call('PATCH', `/sites/${s.id}`, { name: `T${ti} renamed ${s.id}` }, t.token),
    call('POST', `/sites/${s.id}/snapshots`, { label: 'cp-' + ti }, t.token),
    call('GET', `/sites/${s.id}`, null, t.token),
  ])));
  check('36 interleaved PATCH/snapshot/GET calls all succeed', ops.every((r) => r.status === 200), ops.filter((r) => r.status !== 200).map((r) => r.status).join(','));
  const reads = ops.filter((_, i) => i % 3 === 2);
  check('every concurrent read returns the caller\'s own content only', reads.every((r) => { const m = r.data.html.match(/SECRET-T(\d)/); return m && r.data.name.startsWith('T' + m[1]); }));
  const cps = ops.filter((_, i) => i % 3 === 1);
  check('every snapshot list contains only that site\'s checkpoints', cps.every((r) => r.data.snapshots.length === 1 && r.data.snapshots[0].label.startsWith('cp-')));
  // ownership in the DB
  const rows = await DB.prepare('SELECT s.workspace_id AS ws, COUNT(v.id) AS n FROM sites s LEFT JOIN site_versions v ON v.site_id=s.id GROUP BY s.workspace_id').all();
  check('DB: each workspace owns exactly 3 checkpoints (one per site)', rows.results.filter((r) => TENANTS.some((t) => t.sites[0].workspace_id === r.ws)).every((r) => r.n === 3), JSON.stringify(rows.results));
}

// ── B2. Build report is per-request, never a module global (audit B7) ────
console.log('\n== B2. Concurrent AI builds: each tenant gets ITS OWN build report ==');
{
  // Before the fix, generateSiteHtml wrote its report into module globals and
  // the route read them back after an await — with two builds in flight the
  // dental clinic received the plumber's industry/summary/brief facts.
  const briefs = ['Sunrise Dental Clinic — family dentist in Austin, teeth whitening, implants, emergency dentistry', 'Ironworks Plumbing — 24/7 emergency plumber in Leeds, boiler repair, drain unblocking'];
  const names = ['Sunrise Dental Clinic', 'Ironworks Plumbing'];
  const want = [/dent/i, /plumb/i];
  let crossed = 0, total = 0, withReport = 0;
  for (let round = 0; round < 4; round++) {
    const rs = await Promise.all([0, 1].map((i) => call('POST', '/sites', { name: names[i], description: briefs[i], build_with_ai: true, deterministic: true, design_id: 'sentinel' }, TENANTS[i].token)));
    rs.forEach((r, i) => { total++; const b = r.data && r.data.build; if (b && b.summary) withReport++; const hay = `${b && b.industry && b.industry.id} ${b && b.summary}`; if (!want[i].test(hay)) crossed++; });
  }
  check('every concurrent build response carries a build report', withReport === total, `${withReport}/${total}`);
  check('no build response carries another tenant\'s report (B7)', crossed === 0, `${crossed}/${total} crossed`);
  // Regenerate (PATCH build_with_ai) concurrently too — same per-request contract.
  const lists = await Promise.all([0, 1].map((i) => call('GET', '/sites', null, TENANTS[i].token)));
  const targets = lists.map((r, i) => r.data.sites.find((x) => x.name === names[i]));
  const ps = await Promise.all([0, 1].map((i) => call('PATCH', `/sites/${targets[i].id}`, { build_with_ai: true, description: briefs[i], deterministic: true }, TENANTS[i].token)));
  check('concurrent regenerates return each tenant\'s own report', ps.every((r, i) => r.status === 200 && r.data.build && want[i].test(`${r.data.build.industry && r.data.build.industry.id} ${r.data.build.summary}`)), ps.map((r) => r.status + ':' + (r.data.build && r.data.build.industry && r.data.build.industry.id)).join(','));
  check('no build-report module global remains in index.js', !/__LAST_BUILD_REPORT|__LAST_DESIGN_EXPLANATION/.test(readFileSync(new URL('../backend/src/index.js', import.meta.url), 'utf8')));
}

// ── C. IDOR sweep on site sub-resources ─────────────────────────────────
console.log('\n== C. Every site route as another tenant → 404, owner data untouched ==');
{
  const A = TENANTS[0], B = TENANTS[1];
  const sid = A.sites[0].id;
  const before = await call('GET', `/sites/${sid}`, null, A.token);
  const snaps = await call('GET', `/sites/${sid}/snapshots`, null, A.token);
  const vid = snaps.data.snapshots[0].id;
  const probes = [
    ['GET', `/sites/${sid}`], ['GET', `/sites/${sid}/html`], ['GET', `/sites/${sid}/snapshots`], ['GET', `/sites/${sid}/audit`], ['GET', `/sites/${sid}/test`],
    ['PATCH', `/sites/${sid}`, { name: 'pwned' }], ['PATCH', `/sites/${sid}`, { publish_action: 'unpublish' }], ['PATCH', `/sites/${sid}`, { html: '<h1>pwned</h1>' }],
    ['DELETE', `/sites/${sid}/snapshots`], ['POST', `/sites/${sid}/snapshots`, { label: 'pwned' }], ['POST', `/sites/${sid}/snapshots/${vid}/restore`, {}],
    ['POST', `/sites/${sid}/import`, {}], ['POST', `/sites/${sid}/visual`, { html: '<h1>pwned</h1>' }], ['POST', `/sites/${sid}/design`, { overwrite: true, brief: 'x' }],
    ['DELETE', `/sites/${sid}`],
  ];
  const results = [];
  for (const [m, p, body] of probes) results.push([m, p, await call(m, p, body, B.token)]);
  const leaks = results.filter(([, , r]) => r.status < 400 || JSON.stringify(r.data || '').includes('SECRET-T0'));
  check(`all ${probes.length} cross-tenant site probes are 404 with no content leak`, leaks.length === 0, leaks.map(([m, p, r]) => `${m} ${p} → ${r.status}`).join(' | '));
  // B's own snapshot id against A's site, and A's snapshot id against B's site
  const bsnap = (await call('POST', `/sites/${B.sites[0].id}/snapshots`, { label: 'b' }, B.token)).data.snapshots[0].id;
  const cross1 = await call('POST', `/sites/${sid}/snapshots/${bsnap}/restore`, {}, A.token);
  const cross2 = await call('POST', `/sites/${B.sites[0].id}/snapshots/${vid}/restore`, {}, B.token);
  check('a snapshot id from another site/tenant can never be restored', cross1.status === 404 && cross2.status === 404, cross1.status + '/' + cross2.status);
  const after = await call('GET', `/sites/${sid}`, null, A.token);
  check('owner\'s site is byte-identical after the sweep', after.status === 200 && after.data.html === before.data.html && after.data.name === before.data.name && after.data.published === before.data.published);
  const snapsAfter = await call('GET', `/sites/${sid}/snapshots`, null, A.token);
  check('owner\'s checkpoints survived the cross-tenant DELETE', snapsAfter.data.snapshots.length === snaps.data.snapshots.length);
  const del = await call('DELETE', `/sites/${sid}/snapshots`, null, B.token);
  check('cross-tenant DELETE /snapshots reports 404 (not ok:true)', del.status === 404 && !(del.data && del.data.ok));
  // form submissions (B13): a foreign submission id is a 404, not a silent ok
  const fA = await call('POST', '/forms', { name: 'fA', fields: [{ label: 'Email', type: 'email', required: true }] }, A.token);
  const sub = await worker.fetch(new Request(`${BASE}/api/public/forms/${fA.data.slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Email: 'lead@x.com' }) }), env, ctx);
  const subs = await call('GET', `/forms/${fA.data.id}/submissions`, null, A.token);
  const subId = subs.data && subs.data.submissions && subs.data.submissions[0] && subs.data.submissions[0].id;
  check('form submission recorded for the owner', sub.status === 200 && !!subId, String(sub.status));
  const fB = await call('POST', '/forms', { name: 'fB', fields: [] }, B.token);
  const delB = await call('DELETE', `/forms/${fB.data.id}/submissions/${subId}`, null, B.token);
  const delA2 = await call('DELETE', `/forms/${fA.data.id}/submissions/${subId}`, null, B.token);
  const stillThere = await call('GET', `/forms/${fA.data.id}/submissions`, null, A.token);
  check('B13: foreign submission delete → 404 and the row survives', delB.status === 404 && delA2.status === 404 && stillThere.data.submissions.length === 1, `${delB.status}/${delA2.status}/${stillThere.data.submissions.length}`);
  const delOwn = await call('DELETE', `/forms/${fA.data.id}/submissions/${subId}`, null, A.token);
  const delTwice = await call('DELETE', `/forms/${fA.data.id}/submissions/${subId}`, null, A.token);
  check('owner delete works once, second delete is 404 (no silent no-op)', delOwn.status === 200 && delTwice.status === 404);
}

// ── D. state restoration ────────────────────────────────────────────────
console.log('\n== D. State restoration: regenerate/edit/restore leave a reversible trail ==');
{
  const A = TENANTS[2];
  const built = await call('POST', '/sites', { name: 'Restore Co', description: 'Plumber in Banha, emergency callouts', build_with_ai: true, deterministic: true, design_id: 'sentinel', published: false }, A.token);
  check('a generated site builds', built.status === 200 && built.data.html.length > 5000, String(built.status));
  const id = built.data.id;
  const v1 = built.data.html;
  const regen = await call('PATCH', `/sites/${id}`, { build_with_ai: true, instructions: 'Add a big banner about the winter boiler offer', deterministic: true }, A.token);
  check('regenerate succeeds', regen.status === 200 && regen.data.html.length > 5000, String(regen.status));
  const list1 = await call('GET', `/sites/${id}/snapshots`, null, A.token);
  const auto = list1.data.snapshots.find((s) => s.label === 'before regenerate');
  check('S1: regenerate left an automatic "before regenerate" checkpoint', !!auto, JSON.stringify(list1.data.snapshots.map((s) => s.label)));
  const restored = await call('POST', `/sites/${id}/snapshots/${auto.id}/restore`, {}, A.token);
  const back = await call('GET', `/sites/${id}`, null, A.token);
  check('restoring it brings back the exact pre-regenerate html', restored.status === 200 && back.data.html === v1, `${(back.data.html || '').length} vs ${v1.length}`);
  const list2 = await call('GET', `/sites/${id}/snapshots`, null, A.token);
  check('restore itself is reversible (a "before restore" checkpoint exists)', list2.data.snapshots.some((s) => s.label === 'before restore'));
  const edit = await call('PATCH', `/sites/${id}`, { html: '<!DOCTYPE html><html><body><h1>manual edit</h1></body></html>' }, A.token);
  const list3 = await call('GET', `/sites/${id}/snapshots`, null, A.token);
  check('a manual html edit is checkpointed ("before edit")', edit.status === 200 && list3.data.snapshots.some((s) => s.label === 'before edit'));
  // version cap
  for (let i = 0; i < 45; i++) await call('POST', `/sites/${id}/snapshots`, { label: 'bulk-' + i }, A.token);
  const capped = await DB.prepare('SELECT COUNT(*) AS n FROM site_versions WHERE site_id=?').bind(id).first();
  check('the version history is capped at 40 per site', capped.n === 40, String(capped.n));
  // meta round trip after regenerate
  const meta = await call('GET', `/sites/${id}/html`, null, A.token);
  check('site meta survives regenerate (design, instructions, lead url)', meta.data.design_id === 'sentinel' && /winter boiler/.test(meta.data.instructions) && /\/api\/public\/webhook\//.test(meta.data.lead_url || ''), JSON.stringify({ d: meta.data.design_id, i: meta.data.instructions, l: meta.data.lead_url }));
  // delete removes children atomically
  const del = await call('DELETE', `/sites/${id}`, null, A.token);
  const orphans = await DB.prepare('SELECT (SELECT COUNT(*) FROM site_versions WHERE site_id=?) AS v, (SELECT COUNT(*) FROM site_meta WHERE site_id=?) AS m').bind(id, id).first();
  check('DELETE /sites/:id removes versions + meta in the same transaction', del.status === 200 && orphans.v === 0 && orphans.m === 0, JSON.stringify(orphans));
  const delAgain = await call('DELETE', `/sites/${id}`, null, A.token);
  check('a second DELETE is 404 (exactly one racing delete wins)', delAgain.status === 404);
}

// ── E. failure recovery / atomicity ─────────────────────────────────────
console.log('\n== E. Failure recovery: no partial state, invalid input changes nothing ==');
{
  const A = TENANTS[3];
  const t = Tenant(env, A.sites[0].workspace_id);
  // 1. a failing batch rolls back everything before it
  const before = (await DB.prepare('SELECT COUNT(*) AS n FROM site_versions').first()).n;
  let threw = false;
  try { await t.tx([t.siteVersionInsertStmt(A.sites[0].id, 'will-roll-back', '<p>x</p>', ''), DB.prepare('INSERT INTO no_such_table (x) VALUES (1)')]); } catch (e) { threw = true; }
  const after = (await DB.prepare('SELECT COUNT(*) AS n FROM site_versions').first()).n;
  check('a failed transactional unit leaves no partial rows', threw && after === before, `${before} → ${after}`);
  // 2. concurrent deletes of the same site: exactly one 200
  const victim = await call('POST', '/sites', { name: 'race', html: '<p>r</p>' }, A.token);
  const races = await Promise.all([1, 2, 3, 4].map(() => call('DELETE', `/sites/${victim.data.id}`, null, A.token)));
  check('4 concurrent DELETEs: exactly one wins, the rest are 404', races.filter((r) => r.status === 200).length === 1 && races.filter((r) => r.status === 404).length === 3, races.map((r) => r.status).join(','));
  // 3. invalid bodies are 400 with the field name and change nothing
  const s = A.sites[1];
  const snapshot = await call('GET', `/sites/${s.id}`, null, A.token);
  const badBodies = [
    [{ name: { a: 1 } }, /name/], [{ sections: 'hero' }, /sections/], [{ accent: 'red' }, /accent/], [{ font: 'comic' }, /font/],
    [{ plan: 'not-json' }, /plan/], [{ plan: { services: 'x' } }, /services/], [{ radius: 'lots' }, /radius/], [{ html: 12 }, /html/], [{ variant: 'x' }, /variant/],
  ];
  const outcomes = [];
  for (const [body, re] of badBodies) { const r = await call('PATCH', `/sites/${s.id}`, body, A.token); outcomes.push([r.status, re.test(String(r.data && r.data.error))]); }
  check('every malformed builder field is a 400 naming the field', outcomes.every(([st, named]) => st === 400 && named), JSON.stringify(outcomes));
  const unchanged = await call('GET', `/sites/${s.id}`, null, A.token);
  check('rejected requests changed nothing', unchanged.data.html === snapshot.data.html && unchanged.data.name === snapshot.data.name && unchanged.data.updated_at === snapshot.data.updated_at);
  const badCreate = await call('POST', '/sites', { name: 'x', plan: { __proto__: { admin: true }, contact: 'nope' } }, A.token);
  check('prototype-pollution keys are dropped and a wrong-typed plan.contact is rejected', badCreate.status === 400 && ({}).admin === undefined);
  const big = await call('POST', '/sites', { name: 'big', html: '<p>' + 'y'.repeat(700_000) + '</p>' }, A.token);
  check('oversized html is a 413 (not silently truncated)', big.status === 413, String(big.status));
  const v = validateSiteBody({ name: 'ok', sections: ['hero', 'unknown-thing'], three_d: 'FULL' }, 'create');
  check('validator normalises enums and warns on unknown section ids', v.ok && v.value.three_d === 'full' && v.warnings.some((w) => /unknown-thing/.test(w)), JSON.stringify(v));
  // 4. a build that throws leaves the previous page intact
  const target = A.sites[2];
  const pre = await call('GET', `/sites/${target.id}`, null, A.token);
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('provider exploded'); };
  const r = await call('PATCH', `/sites/${target.id}`, { build_with_ai: true, instructions: 'x', deterministic: false }, A.token);
  globalThis.fetch = prevFetch;
  const post = await call('GET', `/sites/${target.id}`, null, A.token);
  check('a regenerate whose provider fails still answers (deterministic floor) or leaves the page intact', (r.status === 200 && post.data.html.length > 1000) || (r.status >= 500 && post.data.html === pre.data.html), r.status + ' / ' + post.data.html.length);
}

// ── F. lead continuity (N8) + draft separation (N7) ─────────────────────
console.log('\n== F. Lead form continuity across saves + draft/published separation ==');
{
  const A = TENANTS[0];
  const wc = await call('GET', '/webchat', null, A.token);
  const expectLead = `${BASE}/api/public/webhook/${wc.data.public_token}`;
  const leadOf = (html) => { const m = String(html || '').match(/var NX_LEAD_URL=("(?:[^"\\]|\\.)*");/); return m ? JSON.parse(m[1]) : null; };
  const s = await call('POST', '/sites', { name: 'Lead Co', description: 'plumber', build_with_ai: true, deterministic: true, design_id: 'sentinel', published: false }, A.token);
  check('N8: a wizard build without webhook_url is still connected to the workspace inbox', leadOf(s.data.html) === expectLead && s.data.lead_url === expectLead, leadOf(s.data.html));
  const save = await call('PATCH', `/sites/${s.data.id}`, { build_with_ai: true, design_id: 'aurora', font: '', animation_level: 'balanced', deterministic: true }, A.token);
  check('N8: settings save keeps the lead URL', leadOf(save.data.html) === expectLead, leadOf(save.data.html));
  check('N7: settings save did not publish the draft', save.data.published === 0 && save.data.publish_changed === false, JSON.stringify({ p: save.data.published, c: save.data.publish_changed }));
  const forced = await call('PATCH', `/sites/${s.data.id}`, { build_with_ai: true, instructions: 'blue', published: true, deterministic: true }, A.token);
  check('N7: `published:true` smuggled into a regenerate is ignored with a warning', forced.data.published === 0 && Array.isArray(forced.data.input_warnings) && forced.data.input_warnings.some((w) => /publish_action/.test(w)), JSON.stringify(forced.data.input_warnings));
  const draft = await worker.fetch(new Request(`${BASE}/s/${s.data.slug}`), env, ctx);
  check('the draft is still not served publicly', draft.status === 404);
  const pub = await call('PATCH', `/sites/${s.data.id}`, { publish_action: 'publish' }, A.token);
  const live = await worker.fetch(new Request(`${BASE}/s/${s.data.slug}`), env, ctx);
  check('publish_action:"publish" publishes and the page is served', pub.data.published === 1 && pub.data.publish_changed === true && live.status === 200);
  const legacy = await call('PATCH', `/sites/${s.data.id}`, { published: false }, A.token);
  check('legacy publish-only body ({published:false}) still works when it is the only intent', legacy.data.published === 0 && legacy.data.publish_changed === true);
  // visitor submit after all those saves lands in the inbox
  const url = leadOf((await call('GET', `/sites/${s.data.id}`, null, A.token)).data.html);
  const submit = await worker.fetch(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Visitor', email: 'visitor@x.com', message: 'hello', event: 'site_lead' }) }), env, ctx);
  const inbox = await DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE workspace_id=? AND subject='Website form message'").bind(s.data.workspace_id).first();
  check('a visitor enquiry after 3 saves still creates the lead + inbox message', submit.status === 200 && inbox.n >= 1, submit.status + '/' + inbox.n);
  // /s/:slug POST is an actionable JSON 405, not an HTML 401
  const stray = await worker.fetch(new Request(`${BASE}/s/${s.data.slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), env, ctx);
  check('a form posting at /s/:slug gets an actionable JSON 405', stray.status === 405 && /not connected/.test(await stray.text()));
}

// ── G. silent-catch lint ────────────────────────────────────────────────
console.log('\n== G. No silent catch blocks in backend/src (structured logging only) ==');
{
  const dir = join(ROOT, 'backend', 'src');
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { if (f.isDirectory()) walk(join(d, f.name)); else if (f.name.endsWith('.js')) files.push(join(d, f.name)); } };
  walk(dir);
  // Client-side scripts embedded as template strings in index.js run in the
  // visitor's browser — their catches guard DOM/animation APIs and are allowed.
  const allowInline = [/^\s*const NX_SCRIPT = "/, /reveal|IntersectionObserver|matchMedia|requestAnimationFrame|getContext|scrollTo|localStorage|sessionStorage|clipboard|fonts\.ready/];
  const offenders = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    const re = /catch\s*(?:\((?:\w+)\))?\s*\{\s*\}/g;
    let m;
    while ((m = re.exec(src))) {
      const ln = src.slice(0, m.index).split('\n').length;
      const line = lines[ln - 1] || '';
      if (line.length > 2000) continue; // one-line embedded runtime bundles (NX_SCRIPT, SITE_JS…) — client side
      if (/\/\*[^*]*\*\//.test(line.slice(line.indexOf('catch')))) continue; // documented `catch (e) { /* reason */ }`
      if (allowInline.some((r) => r.test(line))) continue;
      offenders.push(file.replace(ROOT, '') + ':' + ln + ' ' + line.trim().slice(0, 80));
    }
    const re2 = /\.catch\(\s*\(\s*\)\s*=>\s*(?:\{\s*\}|null|undefined|0|''|false)\s*\)/g;
    while ((m = re2.exec(src))) {
      const ln = src.slice(0, m.index).split('\n').length;
      const line = lines[ln - 1] || '';
      if (line.length > 2000 || allowInline.some((r) => r.test(line))) continue;
      offenders.push(file.replace(ROOT, '') + ':' + ln + ' ' + line.trim().slice(0, 80));
    }
  }
  check(`no undocumented silent catch in ${files.length} backend modules`, offenders.length === 0, offenders.slice(0, 5).join(' | '));
  check('structured log module is wired (logSwallow/logFailure/logged used in index.js)', (SRC.match(/\blogSwallow\(|\blogFailure\(|\blogged\(/g) || []).length >= 40);
}

console.log('\n== H. Public site: CORS + frame-ancestors are a GRANT, never a reflection ==');
{
  // audit finding (site_probe): `/api/public/site/:slug` reflected ANY Origin
  // into Access-Control-Allow-Origin and `frame-ancestors`, so http://evil.example
  // could iframe a customer's page (clickjacking) and read it cross-origin.
  const reg = await call('POST', '/auth/register', { name: 'H', email: 'h' + Date.now() + '@t.io', password: 'password123' });
  const tok = reg.data.token;
  const site = await call('POST', '/sites', { name: 'H Site', html: '<!DOCTYPE html><html><body><h1>h</h1></body></html>', published: true }, tok);
  const slug = site.data.slug;
  const serve = async (hdrs, e) => worker.fetch(new Request(BASE + '/api/public/site/' + slug, { headers: hdrs }), e || env, ctx);
  const fa = (r) => (String(r.headers.get('Content-Security-Policy') || '').match(/frame-ancestors [^;]*/) || [''])[0];
  // permissive mode (no ALLOWED_ORIGINS): real http(s) origins are granted, junk never is
  let r = await serve({});
  check('no Origin → no CORS grant, X-Frame-Options SAMEORIGIN, frame-ancestors self only', !r.headers.get('Access-Control-Allow-Origin') && r.headers.get('X-Frame-Options') === 'SAMEORIGIN' && fa(r) === "frame-ancestors 'self'", fa(r));
  r = await serve({ Origin: 'null' });
  check('Origin: null (sandboxed/file://) is never granted', !r.headers.get('Access-Control-Allow-Origin') && fa(r) === "frame-ancestors 'self'", fa(r));
  r = await serve({ Origin: 'javascript:alert(1)' });
  check('non-http Origin is never granted', !r.headers.get('Access-Control-Allow-Origin') && !/javascript/.test(fa(r)), fa(r));
  r = await serve({ Origin: 'http://app.local' });
  check('dashboard origin granted in permissive mode (dev default)', r.headers.get('Access-Control-Allow-Origin') === 'http://app.local' && fa(r) === "frame-ancestors 'self' http://app.local" && !r.headers.get('X-Frame-Options') && r.headers.get('Vary') === 'Origin');
  // allow-list mode: only listed origins (exact or *.wildcard) are granted
  const envAL = { ...env, ALLOWED_ORIGINS: 'https://crm.example.com, https://*.pages.dev' };
  r = await serve({ Origin: 'http://evil.example' }, envAL);
  check('ALLOWED_ORIGINS set: evil origin gets NO cors and NO frame grant (page still 200)', r.status === 200 && !r.headers.get('Access-Control-Allow-Origin') && fa(r) === "frame-ancestors 'self'" && r.headers.get('X-Frame-Options') === 'SAMEORIGIN', fa(r));
  r = await serve({ Origin: 'https://crm.example.com' }, envAL);
  check('ALLOWED_ORIGINS set: listed origin granted', r.headers.get('Access-Control-Allow-Origin') === 'https://crm.example.com' && fa(r).endsWith('https://crm.example.com'));
  r = await serve({ Origin: 'https://crm.example.com.evil.net' }, envAL);
  check('ALLOWED_ORIGINS set: prefix-spoofed origin refused', !r.headers.get('Access-Control-Allow-Origin'), r.headers.get('Access-Control-Allow-Origin'));
  r = await serve({ Origin: 'https://nexus.pages.dev' }, envAL);
  check('ALLOWED_ORIGINS wildcard *.pages.dev grants a subdomain', r.headers.get('Access-Control-Allow-Origin') === 'https://nexus.pages.dev');
  r = await serve({ Origin: 'https://pages.dev' }, envAL);
  check('ALLOWED_ORIGINS wildcard never grants the bare apex', !r.headers.get('Access-Control-Allow-Origin'));
  r = await serve({ Origin: 'http://crm.example.com' }, envAL);
  check('ALLOWED_ORIGINS is scheme-exact (http ≠ https)', !r.headers.get('Access-Control-Allow-Origin'));
  // the unauthenticated /s/:slug route never grants anything
  const s = await worker.fetch(new Request(BASE + '/s/' + slug, { headers: { Origin: 'http://app.local' } }), env, ctx);
  check('/s/:slug ignores Origin entirely (SAMEORIGIN, no CORS)', s.status === 200 && s.headers.get('X-Frame-Options') === 'SAMEORIGIN' && !s.headers.get('Access-Control-Allow-Origin'));
}

console.log(`\nISOLATION RESULTS: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
