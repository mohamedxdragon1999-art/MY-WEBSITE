// ══════════════════════════════════════════════════════════════════════════
// security/crypto.js — password hashing, constant-time compare, secret-at-rest
// encryption, and token generation.
//
// Extracted as a whole domain INCLUDING its module-private key cache. Moving
// the functions but leaving the cache behind in index.js would have split one
// piece of state across two modules — the exact coupling this refactor exists
// to remove. The cache is now genuinely private: nothing outside this file can
// read or reset it.
//
// Strict ESM, named exports only.
// ══════════════════════════════════════════════════════════════════════════

export function bytesToB64(bytes) { return btoa(String.fromCharCode(...bytes)); }
export function b64ToBytes(b64) { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }

/** Compare two strings without leaking length-independent timing. */
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** PBKDF2-SHA256, 100k iterations. Returns base64 hash + salt. */
export async function hashPassword(password, saltB64) {
  const enc = new TextEncoder();
  const salt = saltB64 ? b64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256,
  );
  return { hash: bytesToB64(new Uint8Array(bits)), salt: bytesToB64(salt) };
}

export async function verifyPassword(password, hashB64, saltB64) {
  const { hash } = await hashPassword(password, saltB64);
  return timingSafeEqual(hash, hashB64);
}

// ── SECRET-AT-REST ENCRYPTION (AES-256-GCM) ─────────────────
// AI provider keys and the Resend API key are the most sensitive things this
// database holds. Encrypting them with a secret that lives only in Worker
// Secrets (never in D1, never in source control) means a database-only leak
// exposes ciphertext, not usable keys.
// Requires `wrangler secret put ENCRYPTION_KEY` (see DEPLOY.md).
// If that secret isn't set this degrades to plaintext rather than hard-failing
// the app — but /ai/settings and /email/smtp both report `encrypted: false`, so
// it is visible rather than silent.
let _encKeyCache = null;   // module-private: not reachable from outside

async function getEncryptionKey(env) {
  if (!env.ENCRYPTION_KEY) return null;
  if (_encKeyCache) return _encKeyCache;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.ENCRYPTION_KEY));
  _encKeyCache = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return _encKeyCache;
}

export async function encryptSecret(env, plaintext) {
  if (!plaintext) return plaintext;
  const key = await getEncryptionKey(env);
  if (!key) return plaintext;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return 'enc:v1:' + bytesToB64(iv) + ':' + bytesToB64(new Uint8Array(ct));
}

export async function decryptSecret(env, stored) {
  if (!stored || !stored.startsWith('enc:v1:')) return stored || '';
  const key = await getEncryptionKey(env);
  if (!key) throw new Error('This value is encrypted but ENCRYPTION_KEY is not configured on the backend — set it with `wrangler secret put ENCRYPTION_KEY`.');
  const [, , ivB64, ctB64] = stored.split(':');
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(ivB64) }, key, b64ToBytes(ctB64));
    return new TextDecoder().decode(pt);
  } catch (e) {
    throw new Error('Failed to decrypt a stored key — ENCRYPTION_KEY may have changed since it was saved. Re-enter your API key in Settings.');
  }
}

/** URL-safe 256-bit session token. */
export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToB64(bytes).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c]));
}
