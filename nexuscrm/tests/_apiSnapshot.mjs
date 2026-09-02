// Behavioural fingerprint of the live worker. Modularisation must not change a
// single byte of observable output. Any diff here is a regression, full stop.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export async function apiFingerprint() {
  const { init, DB } = await import(join(__dirname, 'd1mock.js'));
  await init(readFileSync(join(ROOT, 'backend', 'schema.sql'), 'utf8'));
  const worker = (await import(join(ROOT, 'backend', 'src', 'index.js'))).default;
  const env = { DB, API_IP_RATE_MAX: 1e9, API_TOKEN_RATE_MAX: 1e9 };
  const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
  globalThis.fetch = async () => new Response('x', { status: 200 });
  let TOK = null;
  const call = async (m, p, b) => {
    const h = { 'Content-Type': 'application/json', Origin: 'http://a' };
    if (TOK) h.Authorization = 'Bearer ' + TOK;
    const r = await worker.fetch(new Request('http://t.local/api' + p,
      { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }), env, ctx);
    return { status: r.status, text: await r.text() };
  };
  const out = {};
  const reg = await call('POST', '/auth/register', { email: 'fp@t.co', password: 'Password123!', name: 'FP' });
  TOK = JSON.parse(reg.text).token;
  out['auth/register.status'] = reg.status;

  // Deterministic builds across every direction — the core product surface.
  for (const d of ['signal-industrial', 'editorial-minimal', 'cinematic-immersive', 'luxury-art', 'bold-experimental', 'swiss-structured']) {
    const r = await call('POST', '/ai/build-site', { name: 'Fingerprint Co', description: 'A civil engineering contractor.', direction: d, deterministic: true });
    const j = JSON.parse(r.text);
    out[`build.${d}.status`] = r.status;
    out[`build.${d}.htmlLen`] = (j.html || '').length;
    out[`build.${d}.hash`] = hash(j.html || '');
    out[`build.${d}.pass`] = j.validation && j.validation.pass;
    out[`build.${d}.direction`] = j.direction;
  }
  // Persistence + public hosting.
  const saved = await call('POST', '/sites', { name: 'FP', html: '<html lang="en"><head><title>t</title></head><body><main><h1>x</h1></main></body></html>' });
  const sid = JSON.parse(saved.text).id;
  out['sites.create.status'] = saved.status;
  const got = await call('GET', `/sites/${sid}`);
  out['sites.read.status'] = got.status;
  const slug = JSON.parse(got.text).slug;
  await call('PATCH', `/sites/${sid}`, { published: true });
  const pubRes = await worker.fetch(new Request('http://t.local/s/' + slug), env, ctx);
  out['public.status'] = pubRes.status;
  out['public.contentType'] = pubRes.headers.get('content-type');
  // Error paths must stay identical too.
  for (const [m, p] of [['GET', '/nope'], ['GET', '/sites/99999'], ['POST', '/ai/build-site']]) {
    const r = await call(m, p, null);
    out[`err.${m}${p}`] = r.status;
  }
  const scenes = await call('GET', '/ai/site-scenes');
  out['scenes.count'] = (JSON.parse(scenes.text).scenes || []).length;
  return out;
}
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16); }
