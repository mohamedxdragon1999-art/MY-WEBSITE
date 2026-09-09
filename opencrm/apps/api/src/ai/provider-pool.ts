import { Injectable, Logger } from "@nestjs/common";

/**
 * ProviderPool — supports up to 10 API keys per provider (rotation).
 *
 * Each pool entry:
 * - key: the actual API key
 * - baseUrl: endpoint URL (optional override)
 * - active: whether to try this key
 * - fails: consecutive failures count, reset on success
 * - cooldownUntil: ms epoch when we back off
 *
 * Rotation logic:
 * - If the current key starts failing (on_auth, rate limits etc.), we send the same request
 *   to the next key, up to 10 keys deep.
 * - A key is excluded from rotation until its cooldown expires, so we get "forever-unsticky."
 */

interface KeyEntry {
  apiKey: string;
  baseUrl?: string;
  provider: string;
  active: boolean;
  fails: number;
  cooldownUntil: number;
  label: string; // e.g., "key 1 / 5"
  lastError?: string;
  lastAttempt?: number;
}

export const MAX_FAILS_PER_KEY = 4;
export const COOLDOWN_BASE_MS = 30 * 1000; // 30s for first failure, up to 5min after repeated fails

const POOLS: Record<string, KeyEntry[]> = {}; // in-memory cache (per-process; could be persisted via Prisma)

function now() { return Date.now(); }

function keyOf(provider: string, subAccountId: string) { return `${provider}:${subAccountId}`; }

function getPool_KEY(subId: string, provider: string): KeyEntry[] {
  const k = keyOf(provider, subId);
  if (!POOLS[k]) POOLS[k] = [];
  return POOLS[k];
}

@Injectable()
export class ProviderPoolService {
  private logger = new Logger("ProviderPool");

  /** Add/rotate keys. When provider keys is non-empty array those become the pool (up to 10). */
  setKeys(subAccountId: string, provider: string, keys: { apiKey: string; baseUrl?: string; label?: string }[]): void {
    if (!Array.isArray(keys) || keys.length === 0) throw new Error("no-key: empty key list");
    const pool = keys.slice(0, 10).map((k, i) => ({
      apiKey: k.apiKey,
      baseUrl: k.baseUrl,
      provider,
      active: true,
      fails: 0,
      cooldownUntil: now(),
      label: k.label ?? `Key ${String(i + 1).padStart(2, "0")}`,
    }));
    POOLS[keyOf(provider, subAccountId)] = pool;
  }

  /** Try each key up to pool depth. Returns successful response from whichever key worked. */
  async chat<T>(
    subAccountId: string,
    provider: string,
    call: (key: KeyEntry) => Promise<T>,
    fallbackAction?: () => Promise<T>,
  ): Promise<{ result: T; keyUsed: KeyEntry }> {
    const pool = getPool_KEY(subAccountId, provider);
    if (pool.length === 0) {
      throw new Error(`No keys set for provider ${provider}. Add at least one key.`);
    }
    let tried = 0;
    for (const entry of pool) {
      if (!entry.active) continue;
      if (entry.cooldownUntil > now()) {
        this.logger.log(`skip ${entry.label} (cooldown until ${new Date(entry.cooldownUntil).toISOString()})`);
        continue;
      }
      try {
        const result = await call(entry);
        entry.fails = 0;
        entry.cooldownUntil = now();
        entry.lastError = undefined;
        entry.lastAttempt = now();
        return { result, keyUsed: entry };
      } catch (e: any) {
        entry.fails++;
        entry.lastAttempt = now();
        entry.lastError = e?.message ?? "unknown";
        const status = entryStatus(e);
        // Advance cooldown: 30s, 1 min, 2 min, 5 min
        const wpSeconds = Math.min(300, 30 * Math.pow(2, entry.fails - 1));
        entry.cooldownUntil = now() + wpSeconds * 1000;
        this.logger.warn(`[pool] ${entry.label} failed (${entry.fails}): cooldown ${wpSeconds}s`);
        if (entry.fails >= MAX_FAILS_PER_KEY) entry.active = false;
        if (status === 401) break; // No point trying other keys with invalid auth
      }
    }
    if (fallbackAction) {
      this.logger.log(`All keys failed — local fallback engaged`);
      const result = await fallbackAction();
      return { result, keyUsed: pool[0] ?? ({} as KeyEntry) };
    }
    throw new Error(`All ${pool.length} provider keys failed or exceeded max retries`);
  }

  /** Mirror the last 10 tries for audit visibility */
  getPool(subAccountId: string, provider: string) {
    return getPool_KEY(subAccountId, provider).map((e) => ({
      label: e.label,
      apiKey: e.apiKey,
      baseUrl: e.baseUrl,
      baseURL: (e as any).baseUrl,
      fails: e.fails,
      lastError: e.lastError,
      lastAttempt: e.lastAttempt,
      cooldownUntil: e.cooldownUntil,
      active: e.active,
    }));
  }

  /** Mirror the last 10 tries for audit visibility */
  getLog(subAccountId: string, provider: string) {
    return getPool_KEY(subAccountId, provider)
      .sort((a, b) => (b.lastAttempt ?? 0) - (a.lastAttempt ?? 0))
      .slice(0, 10)
      .map(e => ({
        label: e.label,
        baseUrl: e.baseUrl,
        fails: e.fails,
        lastError: e.lastError,
        lastAttempt: e.lastAttempt,
        cooldownUntil: e.cooldownUntil > now() ? new Date(e.cooldownUntil).toISOString() : "(n/a)",
      }));
  }
}

function entryStatus(e: any): number {
  const m = String(e?.message ?? "").match(/HTTP (\d+)/);
  return m ? Number(m[1]) ?? 0 : 0;
}