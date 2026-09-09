/**
 * Fail-fast env checks — removes insecure defaults.
 * In tests, set ALLOW_INSECURE_TEST=1 to bypass (tests use ephemeral secrets).
 */

export function isTestBypass(): boolean {
  return process.env.ALLOW_INSECURE_TEST === "1" || process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined;
}

export function requireJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 16) return s;
  if (isTestBypass()) return "test-jwt-secret-0123456789abcdef";
  throw new Error(
    "FATAL: JWT_SECRET is missing or too short (>=16 chars required). Set it in apps/api/.env. Refusing to boot with insecure default.",
  );
}

export function requireIntegrationKey(): Buffer {
  const raw = process.env.INTEGRATION_KEY;
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  if (isTestBypass()) return Buffer.from("0123456789abcdef".repeat(4), "utf8").subarray(0, 32);
  throw new Error(
    "FATAL: INTEGRATION_KEY must be 64 hex chars (32 bytes for AES-256-GCM). Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\". Refusing to boot with default key.",
  );
}

export function requireDatabaseUrl(): string {
  const u = process.env.DATABASE_URL;
  if (u && u.length > 0) return u;
  if (isTestBypass()) return "file:./test.db";
  throw new Error("FATAL: DATABASE_URL is missing. Set it in apps/api/.env or packages/db/.env.");
}

export function parseCorsOrigins(): string[] | true {
  const raw = process.env.WEB_URL ?? "http://localhost:3001";
  const list = raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  // `true` would reflect any origin — never do that with credentials. Always use explicit list.
  return list.length > 0 ? list : ["http://localhost:3001"];
}
