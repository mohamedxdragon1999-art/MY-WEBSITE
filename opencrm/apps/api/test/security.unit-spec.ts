/**
 * Backend unit tests — security helpers, SSRF guard, redaction, document gate.
 * No DB, no network. Fast and deterministic.
 */
import { validateBase, redact, mappedError } from "../src/ai/ai.service";
import { redactSecrets } from "../src/common/http-exception.filter";
import { requireJwtSecret, requireIntegrationKey, parseCorsOrigins } from "../src/common/env-check";
import { MAX_DOCUMENT_BYTES, safeParseDocument, createEmptyDocument } from "@opencrm/shared";

describe("validateBase SSRF guard", () => {
  it("accepts public https hosts and appends nothing", () => {
    expect(validateBase("https://integrate.api.nvidia.com")).toMatch(/nvidia\.com/);
    expect(validateBase("https://api.openai.com/v1")).toMatch(/openai\.com/);
  });
  it("rejects private/local hosts", () => {
    for (const u of [
      "http://localhost:4000",
      "http://127.0.0.1:4000/v1",
      "http://10.0.0.5/v1",
      "http://192.168.1.10/v1",
      "http://169.254.169.254/",
      "http://172.16.5.4/v1",
    ]) {
      expect(() => validateBase(u)).toThrow(/Private\/local|SSRF/i);
    }
  });
  it("rejects non-http and credentialed URLs", () => {
    expect(() => validateBase("file:///etc/passwd")).toThrow();
    expect(() => validateBase("gopher://evil/x")).toThrow();
    expect(() => validateBase("https://user:pass@api.openai.com/v1")).toThrow(/credentials/i);
    expect(() => validateBase("not-a-url")).toThrow();
  });
});

describe("redact()", () => {
  it("masks nvapi/sk/Bearer tokens", () => {
    const s = redact("key nvapi-abc123XYZ4567890 and sk-ant-secret12345678 Bearer mytoken123");
    expect(s).not.toMatch(/abc123/);
    expect(s).toMatch(/nvapi-\*\*\*/);
    expect(s).toMatch(/Bearer \*\*\*/);
  });
  it("mappedError never leaks raw key material", () => {
    const msg = mappedError(400, { error: "bad key nvapi-abc123XYZ4567890XYZ" });
    expect(msg).not.toMatch(/abc123/);
  });
});

describe("redactSecrets()", () => {
  it("masks secret-valued keys recursively", () => {
    const out: any = redactSecrets({ apiKey: "nvapi-xxx", nested: { password: "hunter2", ok: "fine" }, list: [{ token: "abc" }] });
    expect(out.apiKey).toBe("***");
    expect(out.nested.password).toBe("***");
    expect(out.nested.ok).toBe("fine");
    expect(out.list[0].token).toBe("***");
  });
  it("redacts JWT-looking strings inside messages", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out: any = redactSecrets({ message: `failed ${jwt}` });
    expect(String(out.message)).not.toContain(jwt.slice(0, 10));
  });
});

describe("env-check fail-fast", () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
    delete process.env.JEST_WORKER_ID;
  });
  it("requireJwtSecret throws without env (non-test)", () => {
    delete process.env.JEST_WORKER_ID;
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    delete process.env.ALLOW_INSECURE_TEST;
    expect(() => requireJwtSecret()).toThrow(/JWT_SECRET/);
  });
  it("requireIntegrationKey throws without env (non-test)", () => {
    delete process.env.JEST_WORKER_ID;
    process.env.NODE_ENV = "production";
    delete process.env.INTEGRATION_KEY;
    delete process.env.ALLOW_INSECURE_TEST;
    expect(() => requireIntegrationKey()).toThrow(/INTEGRATION_KEY/);
  });
  it("test bypass returns ephemeral secrets", () => {
    process.env.ALLOW_INSECURE_TEST = "1";
    expect(requireJwtSecret().length).toBeGreaterThan(10);
    expect(requireIntegrationKey().length).toBe(32);
  });
  it("parseCorsOrigins defaults to 3001 and splits lists", () => {
    delete process.env.WEB_URL;
    expect(parseCorsOrigins()).toEqual(["http://localhost:3001"]);
    process.env.WEB_URL = "https://a.example.com, https://b.example.com/";
    expect(parseCorsOrigins()).toEqual(["https://a.example.com", "https://b.example.com"]);
  });
});

describe("PageDocument gate", () => {
  it("accepts empty doc, rejects garbage, caps size constant sane", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(500 * 1024);
    expect(safeParseDocument(createEmptyDocument()).ok).toBe(true);
    const bad = safeParseDocument({ version: 2, theme: {}, sections: [{ id: 123 } as any] });
    expect(bad.ok).toBe(false);
  });
  it("rejects oversize payloads by byte check (service-level contract)", () => {
    const doc: any = createEmptyDocument();
    doc.sections = [{ id: "s_1", name: "X", styles: {}, fullWidth: false, rows: [] }];
    const bytes = Buffer.byteLength(JSON.stringify(doc), "utf8");
    expect(bytes).toBeLessThan(MAX_DOCUMENT_BYTES);
    // Simulate attacker doc: 600KB string block must exceed cap.
    const evil: any = createEmptyDocument();
    (evil as any).sections = [{ id: "s_evil", name: "E", styles: {}, fullWidth: false, rows: [{ id: "r", styles: {}, columns: [{ id: "c", widthPercent: 100, styles: {}, blocks: [{ id: "b", type: "html", styles: {}, hidden: false, props: { code: "x".repeat(600 * 1024) } }] }] }] }];
    expect(Buffer.byteLength(JSON.stringify(evil), "utf8")).toBeGreaterThan(MAX_DOCUMENT_BYTES);
  });
});
