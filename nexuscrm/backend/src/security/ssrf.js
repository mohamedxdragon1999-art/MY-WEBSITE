// ═══════════════════════════════════════════════════════════════════════════
// security/ssrf.js — outbound-fetch guard for user-supplied URLs.
//
// The worker fetches URLs that tenants type in (website scanner, site
// analyzer). Every one of those fetches is an SSRF surface: a deployed worker
// can reach cloud metadata services (169.254.169.254, metadata.google.internal,
// 100.100.100.200), link-local, CGNAT and RFC-1918 ranges, and anything a
// public DNS name is pointed at (localtest.me → 127.0.0.1, *.nip.io).
//
// This module is the ONE place that decides whether a URL may be fetched:
//   • isBlockedHost(url)      — URL-level verdict (scheme, credentials, port,
//                               hostname, every IPv4/IPv6 encoding)
//   • isBlockedAddress(host)  — bare hostname / IP literal verdict
//   • safeFetch(url, opts)    — fetch with redirects followed MANUALLY so each
//                               hop is re-checked, a hard body cap enforced
//                               while streaming (not after buffering), and a
//                               wall-clock timeout
//   • readCapped(res, cap)    — streamed, bounded body read
//
// Strict ESM, named exports only, no globalThis writes, no worker state.
// ═══════════════════════════════════════════════════════════════════════════

/** Hostnames that resolve to the local machine or a cloud metadata service. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'metadata', 'metadata.google.internal', 'metadata.goog',
  'instance-data', 'instance-data.ec2.internal',
  'localtest.me', 'lvh.me', 'vcap.me', 'nip.io', 'sslip.io', 'xip.io',
  'kubernetes', 'kubernetes.default', 'kubernetes.default.svc',
  'consul', 'vault',
]);
/** Suffixes that are never public: search domains and wildcard-to-local DNS. */
const BLOCKED_SUFFIXES = [
  '.localhost', '.local', '.internal', '.localdomain', '.lan', '.home', '.corp', '.intranet',
  '.localtest.me', '.lvh.me', '.vcap.me', '.nip.io', '.sslip.io', '.xip.io', '.traefik.me',
  '.svc', '.cluster.local', '.ec2.internal', '.compute.internal', '.googleapis.internal',
  '.onion', '.i2p', '.arpa',
];
/** Ports a public website answers on. Anything else is a service probe. */
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

/**
 * Parse one dotted/legacy IPv4 literal into 4 octets. Accepts every form
 * inet_aton accepts (decimal `2852039166`, hex `0xA9FEA9FE`, octal
 * `0251.0376.0251.0376`, shorthand `127.1`) — the bypass forms attackers use
 * because the fetch stack normalises them but naïve regexes do not.
 * Returns null when the string is not an IPv4 literal.
 */
export function parseIPv4(host) {
  const s = String(host || '').trim();
  if (!s || !/^[0-9a-fx.]+$/i.test(s)) return null;
  const parts = s.split('.');
  if (parts.length < 1 || parts.length > 4 || parts.some((p) => p === '')) return null;
  const nums = [];
  for (const p of parts) {
    let n;
    if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p.slice(2), 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^[0-9]+$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }
  // Last component absorbs the remaining bytes (inet_aton semantics).
  const last = nums.pop();
  const width = 4 - nums.length;
  if (last >= Math.pow(256, width)) return null;
  if (nums.some((n) => n > 255)) return null;
  const out = nums.slice();
  for (let i = width - 1; i >= 0; i--) out.push(Math.floor(last / Math.pow(256, i)) % 256);
  return out.length === 4 ? out : null;
}

/** Is a 4-octet IPv4 address non-public (loopback, private, link-local, multicast…)? */
export function isPrivateIPv4(o) {
  if (!o || o.length !== 4) return true;
  const [a, b] = o;
  if (a === 0) return true;                       // 0.0.0.0/8 "this network"
  if (a === 10) return true;                      // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT (Alibaba metadata lives here)
  if (a === 127) return true;                     // loopback
  if (a === 169 && b === 254) return true;        // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 0 && o[2] === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && o[2] === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 168) return true;        // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a === 198 && b === 51 && o[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && o[2] === 113) return true;  // TEST-NET-3
  if (a >= 224) return true;                      // multicast + reserved + broadcast
  return false;
}

/**
 * Expand an IPv6 literal (with or without brackets, with or without an
 * embedded IPv4 tail, with or without a zone id) into 8 hextets. Returns null
 * when it is not IPv6.
 */
export function parseIPv6(host) {
  let s = String(host || '').trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!s.includes(':')) return null;
  s = s.split('%')[0]; // zone id (fe80::1%eth0)
  if (!/^[0-9a-f:.]+$/i.test(s)) return null;
  // Embedded IPv4 tail → two hextets.
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    s = s.slice(0, lastColon + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const dbl = s.split('::');
  if (dbl.length > 2) return null;
  const head = dbl[0] ? dbl[0].split(':') : [];
  const rest = dbl.length === 2 && dbl[1] ? dbl[1].split(':') : [];
  if (dbl.length === 1 && head.length !== 8) return null;
  if (dbl.length === 2 && head.length + rest.length > 7) return null;
  const fill = dbl.length === 2 ? new Array(8 - head.length - rest.length).fill('0') : [];
  const hex = head.concat(fill, rest);
  if (hex.length !== 8) return null;
  const out = [];
  for (const h of hex) {
    if (!/^[0-9a-f]{1,4}$/i.test(h)) return null;
    out.push(parseInt(h, 16));
  }
  return out;
}

/** Is an 8-hextet IPv6 address non-public? (unspecified, loopback, ULA, link-local, mapped-private…) */
export function isPrivateIPv6(h) {
  if (!h || h.length !== 8) return true;
  const allZero = h.every((x) => x === 0);
  if (allZero) return true;                                          // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) → judge the v4.
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
    return isPrivateIPv4([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff]);
  }
  // 64:ff9b::/96 NAT64 and 64:ff9b:1::/48 local-use NAT64 — embedded v4 again.
  if (h[0] === 0x64 && h[1] === 0xff9b) return isPrivateIPv4([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff]) || h[2] === 1;
  // 2002::/16 6to4 — the v4 is in hextets 1-2.
  if (h[0] === 0x2002) return isPrivateIPv4([h[1] >> 8, h[1] & 0xff, h[2] >> 8, h[2] & 0xff]);
  // 2001::/32 Teredo — client v4 is XORed in the last two hextets.
  if (h[0] === 0x2001 && h[1] === 0) return isPrivateIPv4([(h[6] ^ 0xffff) >> 8, (h[6] ^ 0xffff) & 0xff, (h[7] ^ 0xffff) >> 8, (h[7] ^ 0xffff) & 0xff]);
  if ((h[0] & 0xfe00) === 0xfc00) return true;   // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true;   // fe80::/10 link-local
  if ((h[0] & 0xffc0) === 0xfec0) return true;   // fec0::/10 site-local (deprecated)
  if ((h[0] & 0xff00) === 0xff00) return true;   // ff00::/8 multicast
  if (h[0] === 0x2001 && h[1] === 0xdb8) return true; // documentation
  if (h[0] === 0x100 && h[1] === 0) return true; // 100::/64 discard
  return false;
}

/**
 * Verdict for a bare hostname or IP literal (no scheme/port). True = blocked.
 * Unknown/unparseable → blocked (fail closed).
 */
export function isBlockedAddress(rawHost) {
  let host = String(rawHost || '').trim().toLowerCase().replace(/\.+$/, '');
  if (!host) return true;
  if (host.startsWith('[') || host.includes(':')) {
    const v6 = parseIPv6(host);
    return v6 ? isPrivateIPv6(v6) : true;
  }
  const v4 = parseIPv4(host);
  if (v4) return isPrivateIPv4(v4);
  // Anything that is only digits/dots/hex but failed to parse is not a hostname either.
  if (/^[0-9.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  for (const suf of BLOCKED_SUFFIXES) if (host.endsWith(suf)) return true;
  // A hostname must have a dot and a plausible TLD; single-label names resolve
  // via search domains (intranet hosts).
  if (!host.includes('.')) return true;
  if (!/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)*$/.test(host)) return true;
  // Hostnames that embed an IP literal (169-254-169-254.example, 127.0.0.1.xyz)
  // exist only to defeat guards like this one.
  if (/(^|[.-])(0|10|127|169[.-]254|192[.-]168|172[.-](1[6-9]|2\d|3[01]))([.-]\d{1,3}){2,3}([.-]|$)/.test(host)) return true;
  return false;
}

/**
 * Full URL verdict. True = must not be fetched. Fails closed on anything that
 * does not parse as an absolute http(s) URL.
 */
export function isBlockedHost(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '')); } catch (e) { return true; } // unparseable → blocked (the verdict IS the handling)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  if (u.username || u.password) return true;
  if (!ALLOWED_PORTS.has(u.port)) return true;
  return isBlockedAddress(u.hostname);
}

/** Streamed, bounded body read. Aborts the response once `cap` bytes arrive. */
export async function readCapped(res, cap, label) {
  const limit = Math.max(1, cap | 0);
  if (!res || !res.body || typeof res.body.getReader !== 'function') {
    const t = res && typeof res.text === 'function' ? await res.text() : '';
    if (t.length > limit) throw new Error(`${label || 'The response'} is too large (over ${Math.round(limit / 1e6)} MB).`);
    return t;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = '';
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      try { await reader.cancel(); } catch (e) { /* stream already closed — nothing to release */ }
      throw new Error(`${label || 'The response'} is too large (over ${Math.round(limit / 1e6)} MB).`);
    }
    out += dec.decode(value, { stream: true });
  }
  out += dec.decode();
  return out;
}

/**
 * fetch() for user-supplied URLs — returns the (bounded) body text.
 *   • the initial URL and EVERY redirect target are checked with isBlockedHost
 *   • at most `maxRedirects` hops (default 3), always re-issued as GET
 *   • ONE wall-clock timeout across all hops AND the body read
 *   • the body is read while streaming and cut off at `maxBytes`
 * Resolves `{ status, ok, url, hops, text, contentType }`.
 * Rejects with an Error whose `.code` is
 * 'blocked' | 'timeout' | 'redirects' | 'network' | 'too_large'.
 */
export async function safeFetch(rawUrl, opts) {
  const o = opts || {};
  const timeoutMs = o.timeoutMs || 15000;
  const maxRedirects = o.maxRedirects == null ? 3 : o.maxRedirects;
  const maxBytes = o.maxBytes || 3_000_000;
  const fetchImpl = o.fetch || globalThis.fetch;
  let url = String(rawUrl || '').trim();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const fail = (code, message) => { const e = new Error(message); e.code = code; return e; };
  try {
    for (let hop = 0; ; hop++) {
      if (isBlockedHost(url)) throw fail('blocked', hop === 0
        ? 'That URL points to a private/internal address — only public websites can be fetched.'
        : 'That website redirected to a private/internal address — fetch refused.');
      let res;
      try {
        res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers: o.headers || {} });
      } catch (e) {
        if (e && e.name === 'AbortError') throw fail('timeout', `The website took longer than ${Math.round(timeoutMs / 1000)}s to respond.`);
        throw fail('network', 'Could not fetch that website: ' + (e && e.message || 'network error'));
      }
      const status = res.status;
      if (status >= 300 && status < 400) {
        const loc = res.headers && res.headers.get ? res.headers.get('Location') : '';
        if (loc) {
          if (hop >= maxRedirects) throw fail('redirects', 'That website redirects too many times.');
          try { url = new URL(loc, url).href; } catch (e) { throw fail('network', 'That website sent an invalid redirect.'); } // converted into a typed failure
          try { if (res.body && res.body.cancel) await res.body.cancel(); } catch (e) { /* discarded redirect body */ }
          continue;
        }
      }
      let text = '';
      try {
        text = await readCapped(res, maxBytes, 'That website');
      } catch (e) {
        if (e && e.name === 'AbortError') throw fail('timeout', `The website took longer than ${Math.round(timeoutMs / 1000)}s to send its page.`);
        if (/too large/.test(String(e && e.message))) throw fail('too_large', e.message);
        throw fail('network', 'Could not read that website: ' + (e && e.message || 'read error'));
      }
      const contentType = res.headers && res.headers.get ? String(res.headers.get('Content-Type') || '') : '';
      return { status, ok: status >= 200 && status < 300, url, hops: hop, text, contentType };
    }
  } finally {
    clearTimeout(timer);
  }
}
