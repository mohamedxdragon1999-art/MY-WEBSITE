/**
 * Wave 2 e2e — auth me/change-password, contacts search+update,
 * funnel rename/clone/create-page/rename-page/delete-page/delete.
 * Isolated SQLite file (separate from backend.e2e-spec.ts).
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

const TEST_DB = "file:C:/Users/moham/AppData/Local/Temp/opencode/opencrm-test-wave2.db";

function uniq(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

describe("OpenCRM Wave 2 (management APIs)", () => {
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

  it("responses carry X-Request-Id", async () => {
    const res = await request(app.getHttpServer()).get("/api/contacts").expect(401);
    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("auth: me returns safe profile, change-password rotates credentials", async () => {
    const email = uniq("w2me");
    const signup = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ email, password: "password123", firstName: "W", lastName: "Two", agencyName: "W2" })
      .expect(201);
    const token = signup.body.accessToken;

    await request(app.getHttpServer()).get("/api/auth/me").expect(401);
    const me = await request(app.getHttpServer()).get("/api/auth/me").set("Authorization", `Bearer ${token}`).expect(200);
    expect(me.body.email).toBe(email);
    expect(me.body.passwordHash).toBeUndefined();

    await request(app.getHttpServer())
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "wrongpass1", newPassword: "newpassword456" })
      .expect(401);
    await request(app.getHttpServer())
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "password123", newPassword: "short" })
      .expect(400);
    await request(app.getHttpServer())
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "password123", newPassword: "newpassword456" })
      .expect(201);

    await request(app.getHttpServer()).post("/api/auth/login").send({ email, password: "password123" }).expect(401);
    await request(app.getHttpServer()).post("/api/auth/login").send({ email, password: "newpassword456" }).expect(201);
  });

  it("contacts: search, pagination, update, cross-user 404", async () => {
    const t1 = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: uniq("w2c1"), password: "password123", firstName: "A", lastName: "B", agencyName: "W2C1" }).expect(201)).body.accessToken;
    const t2 = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: uniq("w2c2"), password: "password123", firstName: "C", lastName: "D", agencyName: "W2C2" }).expect(201)).body.accessToken;
    const auth1 = (r: any) => r.set("Authorization", `Bearer ${t1}`);

    const a = await auth1(request(app.getHttpServer()).post("/api/contacts")).send({ email: uniq("ada"), firstName: "Ada" }).expect(201);
    await auth1(request(app.getHttpServer()).post("/api/contacts")).send({ email: uniq("grace"), firstName: "Grace" }).expect(201);

    const search = await auth1(request(app.getHttpServer()).get("/api/contacts").query({ q: "Ada" })).expect(200);
    expect(search.body.length).toBe(1);
    expect(search.body[0].id).toBe(a.body.id);

    const page1 = await auth1(request(app.getHttpServer()).get("/api/contacts").query({ take: 1, skip: 0 })).expect(200);
    expect(page1.body.length).toBe(1);

    await auth1(request(app.getHttpServer()).patch(`/api/contacts/${a.body.id}`)).send({}).expect(400);
    const updated = await auth1(request(app.getHttpServer()).patch(`/api/contacts/${a.body.id}`)).send({ lastName: "Lovelace", phone: "123" }).expect(200);
    expect(updated.body.lastName).toBe("Lovelace");

    await request(app.getHttpServer()).patch(`/api/contacts/${a.body.id}`).set("Authorization", `Bearer ${t2}`).send({ lastName: "X" }).expect(404);
  });

  it("funnels: rename, create-page, rename-page, clone, delete-page guard, delete", async () => {
    const token = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: uniq("w2f"), password: "password123", firstName: "F", lastName: "W", agencyName: "W2F" }).expect(201)).body.accessToken;
    const auth = (r: any) => r.set("Authorization", `Bearer ${token}`);

    const funnel = await auth(request(app.getHttpServer()).post("/api/funnels")).send({ name: "Original" }).expect(201);
    const fid = funnel.body.id;
    const firstPageId = funnel.body.pages[0].id;

    await auth(request(app.getHttpServer()).patch(`/api/funnels/${fid}`)).send({ name: "" }).expect(400);
    const renamed = await auth(request(app.getHttpServer()).patch(`/api/funnels/${fid}`)).send({ name: "Renamed" }).expect(200);
    expect(renamed.body.name).toBe("Renamed");

    const p2 = await auth(request(app.getHttpServer()).post(`/api/funnels/${fid}/pages`)).send({ title: "Second" }).expect(201);
    expect(p2.body.title).toBe("Second");
    const rnp = await auth(request(app.getHttpServer()).patch(`/api/funnels/page/${p2.body.id}`)).send({ title: "Second v2" }).expect(200);
    expect(rnp.body.title).toBe("Second v2");

    // Cannot delete the only page — but with 2 pages, deleting one works.
    const del1 = await auth(request(app.getHttpServer()).delete(`/api/funnels/page/${p2.body.id}`)).expect(200);
    expect(del1.body.ok).toBe(true);
    // Now only one page left: guard trips.
    await auth(request(app.getHttpServer()).delete(`/api/funnels/page/${firstPageId}`)).expect(400);

    const clone = await auth(request(app.getHttpServer()).post(`/api/funnels/${fid}/clone`)).expect(201);
    expect(clone.body.name).toMatch(/\(Copy\)/);
    expect(clone.body.pages.length).toBe(1);

    const other = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: uniq("w2f2"), password: "password123", firstName: "G", lastName: "H", agencyName: "W2F2" }).expect(201)).body.accessToken;
    await request(app.getHttpServer()).delete(`/api/funnels/${fid}`).set("Authorization", `Bearer ${other}`).expect(404);

    const del = await auth(request(app.getHttpServer()).delete(`/api/funnels/${fid}`)).expect(200);
    expect(del.body.ok).toBe(true);
    await auth(request(app.getHttpServer()).get(`/api/funnels/page/${firstPageId}`)).expect(404);
  });
});
