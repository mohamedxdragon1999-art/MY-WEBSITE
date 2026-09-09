/**
 * Wave 5 e2e — import-url (success/fallback/SSRF/502) + thin-doc retry + sanitize repair.
 * global.fetch is stubbed: real network is never touched.
 */
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import { json, urlencoded } from "express";
import * as path from "path";
import * as fs from "fs";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { HttpExceptionFilter } from "../src/common/http-exception.filter";
import { RequestIdMiddleware } from "../src/common/request-id.middleware";

const TEST_DB = "file:C:/Users/moham/AppData/Local/Temp/opencode/opencrm-test-wave5.db";
const SITE = "https://bakery.example/";

const SITE_HTML = `<!doctype html><html><head><title>Golden Crust Bakery | Portland</title>
<meta name="description" content="Sourdough and croissants baked fresh daily in Portland."></head>
<body><main><h1>Fresh sourdough every morning</h1><h2>Wholesale program</h2>
<p>Our wood-fired oven runs before dawn so your loaf is still warm at opening time every single day.</p>
<img src="/img/loaf.jpg" alt="Fresh loaf"><a href="/order">Order ahead</a></main></body></html>`;

function sectionsDoc(n: number, label: string): string {
  const sections = Array.from({ length: n }, (_, i) => ({
    id: `s_${i}`, name: `S${i}`, styles: {}, fullWidth: false,
    rows: [{ id: `r_${i}`, styles: {}, columns: [{ id: `c_${i}`, widthPercent: 100, styles: {}, blocks: [
      { id: `b_${i}`, type: "heading", styles: {}, hidden: false, props: { text: `${label} ${i}`, level: "h2" } },
    ] }] }],
  }));
  return JSON.stringify({ version: 2, theme: {}, sections });
}

function uniq(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

describe("OpenCRM Wave 5 (import-url, retry, repair)", () => {
  let app: INestApplication;
  let chatCalls = 0;
  let chatBehavior: "doc5" | "thin-then-full" | "garbage" | "messy" = "doc5";
  const realFetch = global.fetch;

  const MESSY = JSON.stringify({
    version: 2, theme: {},
    sections: [{ name: "X", styles: { fontSize: 9999 }, rows: [{ columns: [
      { widthPercent: 70, blocks: [{ type: "heading", props: { text: "Repaired" } }, { type: "nope", props: {} }] },
      { widthPercent: 70, blocks: [] },
    ] }] }],
  });

  beforeAll(async () => {
    process.env.ALLOW_INSECURE_TEST = "1";
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = TEST_DB;
    process.env.JWT_SECRET = "test-jwt-secret-0123456789abcdef-test";
    process.env.INTEGRATION_KEY = "ab".repeat(32);
    delete process.env.NVIDIA_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_DAILY_CAP;

    try {
      const fsPath = TEST_DB.replace(/^file:/, "");
      if (fs.existsSync(fsPath)) fs.unlinkSync(fsPath);
    } catch { /* ignore */ }

    const schema = path.join(__dirname, "..", "..", "..", "packages", "db", "prisma", "schema.prisma");
    execSync(`npx prisma db push --schema="${schema}" --accept-data-loss`, {
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: TEST_DB },
    });

    // Stub network: site pages + OpenAI-compatible chat endpoint.
    (global as any).fetch = async (url: string) => {
      const u = String(url);
      if (u.includes("chat/completions")) {
        chatCalls++;
        const content =
          chatBehavior === "garbage" ? "NOT JSON AT ALL" :
          chatBehavior === "messy" ? MESSY :
          chatBehavior === "thin-then-full" ? (chatCalls === 1 ? sectionsDoc(2, "Thin") : sectionsDoc(6, "Full")) :
          sectionsDoc(5, "Imported");
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content } }] }) };
      }
      if (u.startsWith("https://bakery.example/")) {
        return { ok: true, status: 200, headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/html" : null) }, text: async () => SITE_HTML };
      }
      if (u.startsWith("https://gone.example/")) {
        return { ok: false, status: 404, headers: { get: () => "text/html" }, text: async () => "nope" };
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    };

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ bodyParser: false });
    app.setGlobalPrefix("api");
    app.use(json({ limit: "1mb" }));
    app.use(urlencoded({ extended: true, limit: "1mb" }));
    app.use(RequestIdMiddleware);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  }, 120000);

  afterAll(async () => {
    (global as any).fetch = realFetch;
    await app?.close();
  });

  async function authed() {
    const token = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: uniq("w5"), password: "password123", firstName: "W", lastName: "F", agencyName: "W5" }).expect(201)).body.accessToken;
    await request(app.getHttpServer()).post("/api/ai/config/keys").set("Authorization", `Bearer ${token}`).send({ provider: "custom", keys: [{ apiKey: "wave5-test-key-12345678", baseUrl: "https://api.openai.com" }] }).expect(201);
    return (r: any) => r.set("Authorization", `Bearer ${token}`);
  }

  it("import-url: AI recreation carries source + full page", async () => {
    chatBehavior = "doc5";
    const auth = await authed();
    const res = await auth(request(app.getHttpServer()).post("/api/ai/import-url")).send({ url: SITE, provider: "custom", model: "gpt-test" }).expect(200);
    expect(res.body.document.sections.length).toBeGreaterThanOrEqual(4);
    expect(res.body.source.title).toMatch(/Golden Crust/);
    expect(res.body.source.url).toBe(SITE);
    expect(res.body.fallback).toBeUndefined();
  });

  it("import-url: AI garbage → deterministic synthesis from the real brief", async () => {
    chatBehavior = "garbage";
    const auth = await authed();
    const res = await auth(request(app.getHttpServer()).post("/api/ai/import-url")).send({ url: SITE, provider: "custom", model: "gpt-test" }).expect(200);
    expect(res.body.fallback).toBe(true);
    expect(JSON.stringify(res.body.document)).toMatch(/sourdough/i);
    expect(res.body.source.title).toMatch(/Golden Crust/);
  });

  it("import-url: SSRF + validation errors are 400 without network", async () => {
    const auth = await authed();
    await auth(request(app.getHttpServer()).post("/api/ai/import-url")).send({ url: "http://169.254.169.254/" }).expect(400);
    await auth(request(app.getHttpServer()).post("/api/ai/import-url")).send({ url: "file:///etc/passwd" }).expect(400);
    await auth(request(app.getHttpServer()).post("/api/ai/import-url")).send({}).expect(400);
    await request(app.getHttpServer()).post("/api/ai/import-url").send({ url: SITE }).expect(401);
  });

  it("import-url: dead site → 502, not a silent fallback", async () => {
    const auth = await authed();
    const res = await auth(request(app.getHttpServer()).post("/api/ai/import-url")).send({ url: "https://gone.example/", provider: "custom" });
    expect(res.status).toBe(502);
    expect(res.body.statusCode).toBe(502);
  });

  it("generate: thin 2-section page triggers one expansion retry", async () => {
    chatBehavior = "thin-then-full";
    chatCalls = 0;
    const auth = await authed();
    const res = await auth(request(app.getHttpServer()).post("/api/ai/generate-page")).send({ prompt: "Plumbing website", provider: "custom", model: "gpt-test" }).expect(200);
    expect(res.body.document.sections.length).toBeGreaterThanOrEqual(4);
    expect(chatCalls).toBe(2);
  });

  it("generate: messy output is repaired, not discarded", async () => {
    chatBehavior = "messy";
    const auth = await authed();
    const res = await auth(request(app.getHttpServer()).post("/api/ai/generate-page")).send({ prompt: "Store website", provider: "custom", model: "gpt-test" }).expect(200);
    expect(res.body.fallback).toBeUndefined();
    const cols = res.body.document.sections[0].rows[0].columns;
    expect(cols.reduce((a: number, c: any) => a + c.widthPercent, 0)).toBeCloseTo(100, 5);
    expect(JSON.stringify(res.body.document)).toMatch(/Repaired/);
  });
});
