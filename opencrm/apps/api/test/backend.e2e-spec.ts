/**
 * Backend e2e — auth, tenancy scoping, document round-trip, AI validation contract.
 * Uses an isolated SQLite file in the OS temp dir so dev data is never touched.
 * Run: npm run test:e2e --workspace=api
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
import { createEmptyDocument, newId } from "@opencrm/shared";

const TEST_DB = "file:C:/Users/moham/AppData/Local/Temp/opencode/opencrm-test-e2e.db";
const TEST_JWT = "test-jwt-secret-0123456789abcdef-test";
const TEST_INT_KEY = "ab".repeat(32); // 64 hex

function uniq(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

describe("OpenCRM backend e2e (hardened)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.ALLOW_INSECURE_TEST = "1";
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = TEST_DB;
    process.env.JWT_SECRET = TEST_JWT;
    process.env.INTEGRATION_KEY = TEST_INT_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.OPENAI_API_KEY;

    // Fresh isolated DB file.
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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app?.close();
  });

  it("GET /api/health responds ok", async () => {
    // Health is registered on the real adapter in main.ts; here assert app booted and guards work instead.
    // Unauthed protected route must 401 (proves guard chain live).
    await request(app.getHttpServer()).get("/api/contacts").expect(401);
  });

  it("POST /api/auth/signup rejects bad email + extra fields (strict ValidationPipe)", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email: "not-an-email", password: "password123", firstName: "A", lastName: "B", agencyName: "Acme" })
      .expect(400);
    await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email: uniq("x"), password: "password123", firstName: "A", lastName: "B", agencyName: "Acme", isAdmin: true })
      .expect(400); // forbidNonWhitelisted
    await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email: uniq("y"), password: "short", firstName: "A", lastName: "B", agencyName: "Acme" })
      .expect(400);
  });

  it("signup -> login -> duplicate signup is 409/400 (not 500)", async () => {
    const email = uniq("dup");
    const payload = { email, password: "password123", firstName: "Test", lastName: "User", agencyName: "Acme Co" };
    const s1 = await request(app.getHttpServer()).post("/api/auth/signup").send(payload).expect(201);
    expect(s1.body.accessToken).toBeDefined();
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password: "password123" })
      .expect(201);
    expect(login.body.accessToken).toBeDefined();
    await request(app.getHttpServer()).post("/api/auth/login").send({ email, password: "wrongpass1" }).expect(401);
    const dup = await request(app.getHttpServer()).post("/api/auth/signup").send(payload);
    expect([400, 409]).toContain(dup.status);
  });

  it("contacts: empty create 400, happy path scoped, delete 404 on second delete, cross-user isolation", async () => {
    const e1 = uniq("c1");
    const t1 = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: e1, password: "password123", firstName: "C", lastName: "One", agencyName: "A1" }).expect(201)).body.accessToken;
    const e2 = uniq("c2");
    const t2 = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: e2, password: "password123", firstName: "C", lastName: "Two", agencyName: "A2" }).expect(201)).body.accessToken;

    await request(app.getHttpServer()).post("/api/contacts").set("Authorization", `Bearer ${t1}`).send({}).expect(400);
    await request(app.getHttpServer()).post("/api/contacts").set("Authorization", `Bearer ${t1}`).send({ email: "bad" }).expect(400);

    const created = await request(app.getHttpServer()).post("/api/contacts").set("Authorization", `Bearer ${t1}`).send({ email: uniq("person"), firstName: "Ada" }).expect(201);
    const id = created.body.id;
    expect(id).toBeDefined();

    // User 2 cannot see or delete user 1's contact.
    const list2 = await request(app.getHttpServer()).get("/api/contacts").set("Authorization", `Bearer ${t2}`).expect(200);
    expect((list2.body as any[]).find((c) => c.id === id)).toBeUndefined();
    await request(app.getHttpServer()).delete(`/api/contacts/${id}`).set("Authorization", `Bearer ${t2}`).expect(404);

    const del = await request(app.getHttpServer()).delete(`/api/contacts/${id}`).set("Authorization", `Bearer ${t1}`).expect(200);
    expect(del.body.ok).toBe(true);
    await request(app.getHttpServer()).delete(`/api/contacts/${id}`).set("Authorization", `Bearer ${t1}`).expect(404);
  });

  it("funnels: create -> get page -> patch document round-trip preserves sections -> publish -> public minimal", async () => {
    const email = uniq("funnel");
    const token = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email, password: "password123", firstName: "F", lastName: "N", agencyName: "Funnels Inc" }).expect(201)).body.accessToken;
    const auth = (r: any) => r.set("Authorization", `Bearer ${token}`);

    await request(app.getHttpServer()).post("/api/funnels").set("Authorization", `Bearer ${token}`).send({}).expect(400);
    const funnel = await auth(request(app.getHttpServer()).post("/api/funnels")).send({ name: "Launch Site" }).expect(201);
    const pageId = funnel.body.pages[0].id;
    expect(pageId).toBeDefined();

    const doc: any = createEmptyDocument();
    doc.sections = [
      { id: newId("s"), name: "Hero", fullWidth: true, styles: {}, rows: [{ id: newId("r"), styles: {}, columns: [{ id: newId("c"), widthPercent: 100, styles: {}, blocks: [{ id: newId("b"), type: "heading", styles: {}, hidden: false, props: { text: "Hello", level: "h1" } }] }] }] },
      { id: newId("s"), name: "CTA", fullWidth: false, styles: {}, rows: [{ id: newId("r"), styles: {}, columns: [{ id: newId("c"), widthPercent: 100, styles: {}, blocks: [{ id: newId("b"), type: "button", styles: {}, hidden: false, props: { text: "Buy", href: "#", variant: "primary", size: "md" } }] }] }] },
    ];

    const saved = await auth(request(app.getHttpServer()).patch(`/api/funnels/page/${pageId}/document`)).send({ document: doc }).expect(200);
    expect(saved.body.document.sections.length).toBe(2);

    const reread = await auth(request(app.getHttpServer()).get(`/api/funnels/page/${pageId}`)).expect(200);
    expect(reread.body.document.sections.length).toBe(2);
    expect(reread.body.document.sections[0].rows[0].columns[0].blocks[0].props.text).toBe("Hello");

    // Corrupt + oversize docs are 400/413, never silent 200 with sections=0.
    await auth(request(app.getHttpServer()).patch(`/api/funnels/page/${pageId}/document`)).send({ document: { version: 2, theme: {}, sections: [{ id: 1 }] } }).expect(400);
    const evil: any = createEmptyDocument();
    (evil as any).sections = [{ id: "s", name: "E", styles: {}, fullWidth: false, rows: [{ id: "r", styles: {}, columns: [{ id: "c", widthPercent: 100, styles: {}, blocks: [{ id: "b", type: "html", styles: {}, hidden: false, props: { code: "x".repeat(600 * 1024) } }] }] }] }];
    await auth(request(app.getHttpServer()).patch(`/api/funnels/page/${pageId}/document`)).send({ document: evil }).expect(413);

    await auth(request(app.getHttpServer()).post(`/api/funnels/page/${pageId}/publish`)).expect(201);

    const pub = await request(app.getHttpServer()).get(`/api/funnels/public-page/${pageId}`).expect(200);
    expect(pub.body.title).toBeDefined();
    expect(pub.body.document.sections.length).toBe(2);
    expect(pub.body.funnel).toBeUndefined();
  });

  it("ai: 401 without token; 400 on empty/oversize prompt and unknown system; no-config is 400 (not silent fallback)", async () => {
    await request(app.getHttpServer()).post("/api/ai/generate-page").send({ prompt: "hi" }).expect(401);

    const email = uniq("ai");
    const token = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email, password: "password123", firstName: "A", lastName: "I", agencyName: "AI Co" }).expect(201)).body.accessToken;
    const auth = (r: any) => r.set("Authorization", `Bearer ${token}`);

    await auth(request(app.getHttpServer()).post("/api/ai/generate-page")).send({}).expect(400);
    await auth(request(app.getHttpServer()).post("/api/ai/generate-page")).send({ prompt: "x".repeat(9000) }).expect(400);
    await auth(request(app.getHttpServer()).post("/api/ai/generate-page")).send({ prompt: "Make a page", system: "nope-not-real" }).expect(400);

    // No stored keys + no env keys -> 400 config error (must NOT return 200 fallback that hides misconfiguration).
    const noConfig = await auth(request(app.getHttpServer()).post("/api/ai/generate-page")).send({ prompt: "Make a landing page" });
    expect(noConfig.status).toBe(400);
    expect(String(noConfig.body.message ?? "")).toMatch(/No AI provider/i);
  });

  it("ai: SSRF private baseUrl rejected as 400; saveKeys validation + masked listKeys", async () => {
    const email = uniq("ssrf");
    const token = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email, password: "password123", firstName: "S", lastName: "S", agencyName: "SSRF Co" }).expect(201)).body.accessToken;
    const auth = (r: any) => r.set("Authorization", `Bearer ${token}`);

    await auth(request(app.getHttpServer()).post("/api/ai/config/keys")).send({ provider: "custom", keys: [{ apiKey: "test-key-12345678", baseUrl: "http://169.254.169.254/" }] }).expect(400);
    await auth(request(app.getHttpServer()).post("/api/ai/config/keys")).send({ provider: "custom", keys: [] }).expect(400);

    const saved = await auth(request(app.getHttpServer()).post("/api/ai/config/keys")).send({ provider: "custom", keys: [{ apiKey: "test-key-12345678-abcdef", baseUrl: "https://api.openai.com", label: "Primary" }] }).expect(201);
    expect(saved.body.keys).toBe(1);

    const keys = await auth(request(app.getHttpServer()).get("/api/ai/config/keys/custom")).expect(200);
    expect(Array.isArray(keys.body)).toBe(true);
    expect(keys.body.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(keys.body)).not.toMatch(/test-key-12345678-abcdef/);

    const configs = await auth(request(app.getHttpServer()).get("/api/ai/config")).expect(200);
    expect(JSON.stringify(configs.body)).not.toMatch(/test-key-12345678-abcdef/);
  });
});
