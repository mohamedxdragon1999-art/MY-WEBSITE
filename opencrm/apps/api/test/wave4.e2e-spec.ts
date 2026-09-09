/**
 * Wave 4 e2e — public form capture, page version history, AI usage caps, envelopes.
 * Isolated SQLite file (opencrm-test-wave4.db).
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
import { createEmptyDocument, newId } from "@opencrm/shared";

const TEST_DB = "file:C:/Users/moham/AppData/Local/Temp/opencode/opencrm-test-wave4.db";

function uniq(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

function docWithHeading(text: string): any {
  const doc: any = createEmptyDocument();
  doc.sections = [
    { id: newId("s"), name: "Hero", fullWidth: true, styles: {}, rows: [{ id: newId("r"), styles: {}, columns: [{ id: newId("c"), widthPercent: 100, styles: {}, blocks: [{ id: newId("b"), type: "heading", styles: {}, hidden: false, props: { text, level: "h1" } }] }] }] },
  ];
  return doc;
}

describe("OpenCRM Wave 4 (forms, versions, metering, envelopes)", () => {
  let app: INestApplication;

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
    delete process.env.AI_DAILY_CAP;
    await app?.close();
  });

  it("public forms: valid submit creates a contact; honeypot fakes success; garbage 400; unknown page 404", async () => {
    const token = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: uniq("form"), password: "password123", firstName: "F", lastName: "O", agencyName: "Forms" }).expect(201)).body.accessToken;
    const auth = (r: any) => r.set("Authorization", `Bearer ${token}`);
    const funnel = await auth(request(app.getHttpServer()).post("/api/funnels")).send({ name: "Form Site" }).expect(201);
    const pageId = funnel.body.pages[0].id;

    const mail = uniq("lead");
    await request(app.getHttpServer()).post(`/api/public/forms/${pageId}/submit`).send({ fields: { name: "Lead Person", email: mail } }).expect(200);

    const list = await auth(request(app.getHttpServer()).get("/api/contacts")).expect(200);
    const lead = (list.body as any[]).find((c) => c.email === mail);
    expect(lead).toBeDefined();
    expect(lead.source).toBe(`form:${pageId}`);
    expect(lead.firstName).toBe("Lead");

    const before = (list.body as any[]).length;
    await request(app.getHttpServer()).post(`/api/public/forms/${pageId}/submit`).send({ fields: { email: uniq("bot") }, website: "http://spam.example" }).expect(200);
    const after = await auth(request(app.getHttpServer()).get("/api/contacts")).expect(200);
    expect((after.body as any[]).length).toBe(before); // honeypot stored nothing

    await request(app.getHttpServer()).post(`/api/public/forms/${pageId}/submit`).send({ fields: {} }).expect(400);
    await request(app.getHttpServer()).post(`/api/public/forms/${pageId}/submit`).send({ fields: { email: "not-an-email" } }).expect(400);
    await request(app.getHttpServer()).post("/api/public/forms/does-not-exist/submit").send({ fields: { email: uniq("x") } }).expect(404);
  });

  it("versions: save v1/v2 → list → get v1 → restore v1 → cap at 20", async () => {
    const token = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: uniq("ver"), password: "password123", firstName: "V", lastName: "E", agencyName: "Vers" }).expect(201)).body.accessToken;
    const auth = (r: any) => r.set("Authorization", `Bearer ${token}`);
    const funnel = await auth(request(app.getHttpServer()).post("/api/funnels")).send({ name: "Versioned" }).expect(201);
    const pageId = funnel.body.pages[0].id;
    const patch = (doc: any) => auth(request(app.getHttpServer()).patch(`/api/funnels/page/${pageId}/document`)).send({ document: doc });

    await patch(docWithHeading("v1")).expect(200);
    await patch(docWithHeading("v2")).expect(200);

    const versions = await auth(request(app.getHttpServer()).get(`/api/funnels/page/${pageId}/versions`)).expect(200);
    expect(versions.body.length).toBe(2);
    expect(versions.body[0].document).toBeUndefined(); // list is light: no full docs
    expect(versions.body[0].bytes).toBeGreaterThan(0);

    const v1id = versions.body[1].id;
    const v1 = await auth(request(app.getHttpServer()).get(`/api/funnels/page/${pageId}/versions/${v1id}`)).expect(200);
    expect(v1.body.document.sections[0].rows[0].columns[0].blocks[0].props.text).toBe("v1");
    await auth(request(app.getHttpServer()).get(`/api/funnels/page/${pageId}/versions/nope`)).expect(404);

    await auth(request(app.getHttpServer()).post(`/api/funnels/page/${pageId}/restore/${v1id}`)).expect(201);
    const reread = await auth(request(app.getHttpServer()).get(`/api/funnels/page/${pageId}`)).expect(200);
    expect(reread.body.document.sections[0].rows[0].columns[0].blocks[0].props.text).toBe("v1");

    for (let i = 0; i < 22; i++) {
      await patch(docWithHeading(`bulk-${i}`)).expect(200);
    }
    const capped = await auth(request(app.getHttpServer()).get(`/api/funnels/page/${pageId}/versions`)).expect(200);
    expect(capped.body.length).toBeLessThanOrEqual(20);
  });

  it("ai usage: metered, capped per day (429), usage endpoint reports", async () => {
    const token = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: uniq("use"), password: "password123", firstName: "U", lastName: "S", agencyName: "Usage" }).expect(201)).body.accessToken;
    const auth = (r: any) => r.set("Authorization", `Bearer ${token}`);

    const fresh = await auth(request(app.getHttpServer()).get("/api/ai/usage")).expect(200);
    expect(fresh.body.used).toBe(0);
    expect(fresh.body.cap).toBeGreaterThan(0);
    expect(fresh.body.resetsAt).toBeDefined();

    // Save a fake key so generate reaches the (stubbed) upstream call.
    await auth(request(app.getHttpServer()).post("/api/ai/config/keys")).send({ provider: "custom", keys: [{ apiKey: "usage-meter-test-key-123", baseUrl: "https://api.openai.com" }] }).expect(201);

    const realFetch = global.fetch;
    const validDoc = JSON.stringify({ version: 2, theme: {}, sections: [] });
    (global as any).fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content: validDoc } }] }) });
    try {
      process.env.AI_DAILY_CAP = "1";
      const first = await auth(request(app.getHttpServer()).post("/api/ai/generate-page")).send({ prompt: "Meter me", provider: "custom", model: "gpt-test" }).expect(200);
      expect(first.body.document).toBeDefined();

      const used = await auth(request(app.getHttpServer()).get("/api/ai/usage")).expect(200);
      expect(used.body.used).toBe(1);
      expect(used.body.remaining).toBe(0);

      const capped = await auth(request(app.getHttpServer()).post("/api/ai/generate-page")).send({ prompt: "Over cap", provider: "custom", model: "gpt-test" });
      expect(capped.status).toBe(429);
      expect(String(capped.body.message)).toMatch(/daily cap/i);
    } finally {
      (global as any).fetch = realFetch;
      delete process.env.AI_DAILY_CAP;
    }
  });

  it("envelopes: opt-in metadata, defaults stay bare arrays", async () => {
    const token = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: uniq("env"), password: "password123", firstName: "E", lastName: "N", agencyName: "Env" }).expect(201)).body.accessToken;
    const auth = (r: any) => r.set("Authorization", `Bearer ${token}`);
    await auth(request(app.getHttpServer()).post("/api/contacts")).send({ email: uniq("e1") }).expect(201);
    await auth(request(app.getHttpServer()).post("/api/contacts")).send({ email: uniq("e2") }).expect(201);

    const bare = await auth(request(app.getHttpServer()).get("/api/contacts")).expect(200);
    expect(Array.isArray(bare.body)).toBe(true);

    const env = await auth(request(app.getHttpServer()).get("/api/contacts").query({ envelope: "1", take: 1 })).expect(200);
    expect(env.body.total).toBe(2);
    expect(env.body.items.length).toBe(1);
    expect(env.body.skip).toBe(0);
    expect(env.body.take).toBe(1);

    await auth(request(app.getHttpServer()).post("/api/funnels")).send({ name: "Env Funnel" }).expect(201);
    const fbare = await auth(request(app.getHttpServer()).get("/api/funnels")).expect(200);
    expect(Array.isArray(fbare.body)).toBe(true);
    const fenv = await auth(request(app.getHttpServer()).get("/api/funnels").query({ envelope: "1" })).expect(200);
    expect(fenv.body.total).toBe(1);
    expect(Array.isArray(fenv.body.items)).toBe(true);
  });
});
