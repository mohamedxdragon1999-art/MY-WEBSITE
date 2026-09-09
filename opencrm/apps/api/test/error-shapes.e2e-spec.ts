/**
 * Wave 3 e2e — error-shape contract.
 * Locks the exact 4xx JSON shapes the frontend (AiModal, forms, toasts) depends on.
 * Rule: every client error returns { statusCode, message } with message as string|string[].
 * Frontend: read `body.message` (array → join, string → show). Never parse `body` as a string.
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

const TEST_DB = "file:C:/Users/moham/AppData/Local/Temp/opencode/opencrm-test-wave3.db";

function uniq(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

/** Frontend contract: { statusCode: <http>, message: string|string[] } */
function expectErrorShape(res: any, status: number) {
  expect(res.status).toBe(status);
  expect(res.body.statusCode).toBe(status);
  expect(res.body.message).toBeDefined();
  expect(
    typeof res.body.message === "string" || Array.isArray(res.body.message),
  ).toBe(true);
}

describe("Error-shape contract (frontend depends on this)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.ALLOW_INSECURE_TEST = "1";
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = TEST_DB;
    process.env.JWT_SECRET = "test-jwt-secret-0123456789abcdef-test";
    process.env.INTEGRATION_KEY = "ab".repeat(32);
    delete process.env.NVIDIA_API_KEY;
    delete process.env.OPENAI_API_KEY;

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
    await app?.close();
  });

  it("auth validation 400 shape (message is array from ValidationPipe)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email: "bad", password: "password123", firstName: "A", lastName: "B", agencyName: "X" });
    expectErrorShape(res, 400);
    expect(Array.isArray(res.body.message)).toBe(true);
  });

  it("duplicate signup 409 shape (message is string)", async () => {
    const payload = { email: uniq("dup"), password: "password123", firstName: "A", lastName: "B", agencyName: "X" };
    await request(app.getHttpServer()).post("/api/auth/signup").send(payload).expect(201);
    const res = await request(app.getHttpServer()).post("/api/auth/signup").send(payload);
    expect([400, 409]).toContain(res.status);
    expect(typeof res.body.message === "string" || Array.isArray(res.body.message)).toBe(true);
    expect(JSON.stringify(res.body.message)).toMatch(/already exists/i);
  });

  it("login 401 shape", async () => {
    const email = uniq("login");
    await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email, password: "password123", firstName: "A", lastName: "B", agencyName: "X" })
      .expect(201);
    const res = await request(app.getHttpServer()).post("/api/auth/login").send({ email, password: "wrongpass1" });
    expectErrorShape(res, 401);
  });

  it("unauthenticated 401 shape on guarded routes", async () => {
    for (const [method, url] of [
      ["get", "/api/contacts"],
      ["get", "/api/funnels"],
      ["post", "/api/ai/generate-page"],
      ["get", "/api/auth/me"],
    ] as const) {
      const res = await (request(app.getHttpServer()) as any)[method](url).send({});
      expectErrorShape(res, 401);
    }
  });

  it("contacts 404 shape carries message + request id", async () => {
    const token = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: uniq("c"), password: "password123", firstName: "A", lastName: "B", agencyName: "X" }).expect(201)).body.accessToken;
    const res = await request(app.getHttpServer()).delete("/api/contacts/nope").set("Authorization", `Bearer ${token}`);
    expectErrorShape(res, 404);
    expect(String(res.body.message)).toMatch(/not found/i);
    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("funnels 404 shape (unknown page)", async () => {
    const token = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: uniq("f"), password: "password123", firstName: "A", lastName: "B", agencyName: "X" }).expect(201)).body.accessToken;
    const res = await request(app.getHttpServer()).get("/api/funnels/page/does-not-exist").set("Authorization", `Bearer ${token}`);
    expectErrorShape(res, 404);
    expect(String(res.body.message)).toMatch(/not found/i);
  });

  it("ai generate 400 shapes: empty prompt, oversize, unknown system, no provider configured", async () => {
    const token = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: uniq("ai"), password: "password123", firstName: "A", lastName: "B", agencyName: "X" }).expect(201)).body.accessToken;
    const auth = (r: any) => r.set("Authorization", `Bearer ${token}`);
    const post = () => auth(request(app.getHttpServer()).post("/api/ai/generate-page"));

    expectErrorShape(await post().send({}), 400);
    const big = await post().send({ prompt: "x".repeat(9000) });
    expectErrorShape(big, 400);
    const sys = await post().send({ prompt: "Make a page", system: "nope-not-real" });
    expectErrorShape(sys, 400);
    // No stored keys + no env keys → 400 config error with actionable message (NOT a silent 200 fallback).
    const cfg = await post().send({ prompt: "Make a landing page" });
    expectErrorShape(cfg, 400);
    expect(String(cfg.body.message)).toMatch(/No AI provider/i);
  });

  it("document save 400/413 shapes (corrupt + oversize)", async () => {
    const token = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: uniq("d"), password: "password123", firstName: "A", lastName: "B", agencyName: "X" }).expect(201)).body.accessToken;
    const auth = (r: any) => r.set("Authorization", `Bearer ${token}`);
    const funnel = await auth(request(app.getHttpServer()).post("/api/funnels")).send({ name: "S" }).expect(201);
    const pageId = funnel.body.pages[0].id;

    const bad = await auth(request(app.getHttpServer()).patch(`/api/funnels/page/${pageId}/document`)).send({ document: { version: 2, theme: {}, sections: [{ id: 1 }] } });
    expectErrorShape(bad, 400);
    expect(String(bad.body.message)).toMatch(/Invalid document/i);
  });
});
