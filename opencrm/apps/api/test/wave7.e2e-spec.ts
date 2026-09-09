/**
 * Wave 7 e2e — page meta + self-hosted image uploads.
 * Uploads land in the real apps/api/uploads dir under random test sub-accounts;
 * afterAll deletes everything it created via the API.
 */
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import { json, urlencoded } from "express";
import { join } from "path";
import * as path from "path";
import * as fs from "fs";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { HttpExceptionFilter } from "../src/common/http-exception.filter";
import { RequestIdMiddleware } from "../src/common/request-id.middleware";

const TEST_DB = "file:C:/Users/moham/AppData/Local/Temp/opencode/opencrm-test-wave7.db";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function uniq(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

describe("OpenCRM Wave 7 (meta, uploads)", () => {
  let app: INestApplication;
  const tokens: string[] = [];

  beforeAll(async () => {
    process.env.ALLOW_INSECURE_TEST = "1";
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = TEST_DB;
    process.env.JWT_SECRET = "test-jwt-secret-0123456789abcdef-test";
    process.env.INTEGRATION_KEY = "ab".repeat(32);
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
    (app as any).useStaticAssets(join(__dirname, "..", "uploads"), { prefix: "/api/uploads/", redirect: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  }, 120000);

  afterAll(async () => {
    // Remove every file this suite uploaded.
    const server = app?.getHttpServer();
    if (server) {
      for (const t of tokens) {
        try {
          const list = await request(server).get("/api/uploads").set("Authorization", `Bearer ${t}`);
          for (const f of list.body?.items ?? []) {
            await request(server).delete(`/api/uploads/${f.name}`).set("Authorization", `Bearer ${t}`);
          }
        } catch { /* best-effort */ }
      }
    }
    await app?.close();
  });

  async function authed() {
    const token = (await request(app.getHttpServer()).post("/api/auth/signup").send({ email: uniq("w7"), password: "password123", firstName: "W", lastName: "S", agencyName: "W7" }).expect(201)).body.accessToken;
    tokens.push(token);
    return (r: any) => r.set("Authorization", `Bearer ${token}`);
  }

  it("meta: update title/slug/description, validation, uniqueness, scoping, public surface", async () => {
    const auth = await authed();
    const funnel = await auth(request(app.getHttpServer()).post("/api/funnels")).send({ name: "Meta Site" }).expect(201);
    const pageId = funnel.body.pages[0].id;
    const p2 = await auth(request(app.getHttpServer()).post(`/api/funnels/${funnel.body.id}/pages`)).send({ title: "Second" }).expect(201);

    const upd = await auth(request(app.getHttpServer()).patch(`/api/funnels/page/${pageId}/meta`)).send({ title: "Acme Plumbing", slug: "acme-plumbing", description: "24/7 plumbers." }).expect(200);
    expect(upd.body).toMatchObject({ title: "Acme Plumbing", slug: "acme-plumbing" });
    expect(upd.body.seo.description).toBe("24/7 plumbers.");

    await auth(request(app.getHttpServer()).patch(`/api/funnels/page/${pageId}/meta`)).send({ slug: "Bad Slug!!" }).expect(400);
    await auth(request(app.getHttpServer()).patch(`/api/funnels/page/${pageId}/meta`)).send({ title: "" }).expect(400);
    await auth(request(app.getHttpServer()).patch(`/api/funnels/page/${pageId}/meta`)).send({}).expect(400);
    await auth(request(app.getHttpServer()).patch(`/api/funnels/page/${p2.body.id}/meta`)).send({ slug: "acme-plumbing" }).expect(409);

    const other = await authed();
    await other(request(app.getHttpServer()).patch(`/api/funnels/page/${pageId}/meta`)).send({ title: "Hijack" }).expect(404);

    const pub = await request(app.getHttpServer()).get(`/api/funnels/public-page/${pageId}`).expect(200);
    expect(pub.body.title).toBe("Acme Plumbing");
    expect(pub.body.slug).toBe("acme-plumbing");
    expect(pub.body.seo.description).toBe("24/7 plumbers.");
    expect(pub.body.document).toBeDefined();
  });

  it("uploads: auth, type-sniffing, serve, list, delete, size cap", async () => {
    const auth = await authed();
    await request(app.getHttpServer()).post("/api/uploads/image").attach("file", PNG, "a.png").expect(401);
    await auth(request(app.getHttpServer()).post("/api/uploads/image")).attach("file", Buffer.from("MZ\x90\x00evil-binary-payload!!"), "evil.png").expect(400);
    await auth(request(app.getHttpServer()).post("/api/uploads/image")).send({}).expect(400);

    const up = await auth(request(app.getHttpServer()).post("/api/uploads/image")).attach("file", PNG, "pixel.png").expect(201);
    expect(up.body.url).toMatch(/^\/api\/uploads\//);
    expect(up.body.name).toMatch(/\.png$/);

    const got = await auth(request(app.getHttpServer()).get(up.body.url)).expect(200);
    expect(got.headers["content-type"]).toMatch(/image\/png/);

    const list = await auth(request(app.getHttpServer()).get("/api/uploads")).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].name).toBe(up.body.name);

    await auth(request(app.getHttpServer()).delete(`/api/uploads/${up.body.name}`)).expect(200);
    await auth(request(app.getHttpServer()).delete(`/api/uploads/${up.body.name}`)).expect(404);
    // Traversal must never succeed (client may normalize to 404, server guard gives 400).
    const trav = await auth(request(app.getHttpServer()).delete("/api/uploads/..%2f..%2fevil.png"));
    expect([400, 404]).toContain(trav.status);

    const big = Buffer.alloc(6 * 1024 * 1024, 1);
    const over = await auth(request(app.getHttpServer()).post("/api/uploads/image")).attach("file", big, "big.png");
    expect([400, 413]).toContain(over.status);
  });
});
