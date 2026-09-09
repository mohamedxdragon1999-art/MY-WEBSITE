import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "path";
import helmet from "helmet";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { RequestIdMiddleware } from "./common/request-id.middleware";
import { parseCorsOrigins, requireDatabaseUrl, requireIntegrationKey, requireJwtSecret } from "./common/env-check";

async function bootstrap() {
  // Fail fast on insecure/missing config (bypassed only in tests via ALLOW_INSECURE_TEST=1).
  requireJwtSecret();
  requireIntegrationKey();
  requireDatabaseUrl();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: false, bodyParser: false });
  app.setGlobalPrefix("api");
  // 1MB framework cap so the service-level 500KB PageDocument check returns the actionable 413 message.
  app.use(json({ limit: "1mb" }));
  app.use(urlencoded({ extended: true, limit: "1mb" }));
  // Self-hosted image library (see UploadsController). Multer never touches disk; only
  // magic-byte-verified images land here, scoped per sub-account.
  // redirect:false — otherwise the static middleware 301s the exact /api/uploads path
  // (a real directory) and shadows the controller's GET list endpoint.
  app.useStaticAssets(join(__dirname, "..", "uploads"), { prefix: "/api/uploads/", redirect: false });
  app.use(RequestIdMiddleware);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  const origins = parseCorsOrigins();
  app.enableCors({ origin: origins as string[], credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  const http = app.getHttpAdapter();
  http.getInstance().get("/api/health", (req: any, res: any) =>
    res.json({ ok: true, time: Date.now(), version: process.env.npm_package_version ?? "0.0.0.21" }),
  );

  await app.listen(Number(process.env.API_PORT ?? 4000));
  console.log(`API running on http://localhost:${process.env.API_PORT ?? 4000}/api`);
}
bootstrap();
