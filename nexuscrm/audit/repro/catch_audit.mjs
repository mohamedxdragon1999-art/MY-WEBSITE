// Portable repro (audit 2026-09-03). Run from anywhere: node nexuscrm/audit/repro/catch_audit.mjs
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
import { readFileSync } from 'node:fs';
process.chdir(ROOT); const files = ['backend/src/index.js', 'NexusCRM_V4_Hardened.html', 'server.js'];
const reEmptyCatch = /catch\s*(\(\s*[A-Za-z_$][\w$]*\s*\))?\s*\{\s*(\/\*[^]*?\*\/\s*|\/\/[^\n]*\n\s*)*\}/g;
const rePromiseSwallow = /\.catch\(\s*(?:\(\s*[A-Za-z_$]?[\w$]*\s*\)|[A-Za-z_$][\w$]*)?\s*=>\s*(?:\{\s*(?:\/\*[^]*?\*\/\s*)?\}|null|undefined|false|0|''|""|\[\])\s*\)/g;
const dbWrite = /\.run\(\)|\.batch\(|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+TABLE/i;
const net = /\bfetch\(|sendEmail|resend|webhook/i;
for (const f of files) {
  const src = readFileSync(f, 'utf8'); const lines = src.split('\n');
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;
  const seen = new Set(); const rows = [];
  const scan = (re, kind) => { let m; while ((m = re.exec(src))) { const ln = lineOf(m.index); if (lines[ln-1].length > 2000) continue; /* skip embedded one-line blobs */ if (seen.has(ln+kind)) continue; seen.add(ln+kind);
      const ctxB = lines.slice(Math.max(0, ln - 6), ln).join('\n'); const same = lines[ln-1];
      const w = dbWrite.test(ctxB) || dbWrite.test(same); const n = net.test(ctxB) || net.test(same);
      rows.push({ ln, kind, w, n, s: same.trim().slice(0, 170) }); } };
  scan(reEmptyCatch, 'catch{}'); scan(rePromiseSwallow, '.catch()');
  console.log(`\n===== ${f}: ${rows.length} swallows (excluding embedded blobs) — ${rows.filter(r=>r.w).length} near a DB write, ${rows.filter(r=>r.n).length} near network =====`);
  for (const r of rows.filter(r => r.w || r.n)) console.log(`${String(r.ln).padStart(6)} [${r.kind}]${r.w?' DB-WRITE':''}${r.n?' NET':''}  ${r.s}`);
}
