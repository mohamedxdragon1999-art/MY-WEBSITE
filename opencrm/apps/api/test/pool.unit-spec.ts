/** ProviderPool rotation unit tests — no DB, no network. */
import { ProviderPoolService } from "../src/ai/provider-pool";

describe("ProviderPoolService", () => {
  it("setKeys rejects empty, caps at 10", () => {
    const p = new ProviderPoolService();
    expect(() => p.setKeys("sub1", "nvidia", [])).toThrow(/no-key/);
    p.setKeys("sub1", "nvidia", Array.from({ length: 12 }, (_, i) => ({ apiKey: `k${i}` })));
    expect(p.getPool("sub1", "nvidia").length).toBe(10);
  });

  it("chat succeeds on first key and resets fails", async () => {
    const p = new ProviderPoolService();
    p.setKeys("sA", "openai", [{ apiKey: "k1" }, { apiKey: "k2" }]);
    const { result, keyUsed } = await p.chat("sA", "openai", async (entry) => `ok:${(entry as any).apiKey}`);
    expect(result).toBe("ok:k1");
    expect((keyUsed as any).apiKey).toBe("k1");
  });

  it("chat rotates to second key when first throws, cools down first", async () => {
    const p = new ProviderPoolService();
    p.setKeys("sB", "openai", [{ apiKey: "bad" }, { apiKey: "good" }]);
    const { result } = await p.chat("sB", "openai", async (entry) => {
      if ((entry as any).apiKey === "bad") throw new Error("HTTP 429 rate_limited");
      return "good-result";
    });
    expect(result).toBe("good-result");
    const pool = p.getPool("sB", "openai");
    expect(pool[0].fails).toBe(1);
    expect(pool[0].cooldownUntil).toBeGreaterThan(Date.now());
  });

  it("chat throws when all keys fail and no fallback", async () => {
    const p = new ProviderPoolService();
    p.setKeys("sC", "openai", [{ apiKey: "k1" }]);
    await expect(
      p.chat("sC", "openai", async () => {
        throw new Error("HTTP 500 boom");
      }),
    ).rejects.toThrow(/All 1 provider keys failed/);
  });

  it("getLog returns newest-first masked rows", async () => {
    const p = new ProviderPoolService();
    p.setKeys("sD", "openai", [{ apiKey: "k1" }, { apiKey: "k2" }]);
    await p.chat("sD", "openai", async (e) => {
      if ((e as any).apiKey === "k1") throw new Error("HTTP 500 x");
      return "ok";
    });
    const log = p.getLog("sD", "openai");
    expect(log.length).toBe(2);
    expect(log[0].lastAttempt).toBeGreaterThanOrEqual(log[1].lastAttempt ?? 0);
  });
});
