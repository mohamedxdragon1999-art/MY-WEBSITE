import { randomUUID } from "crypto";

/** Adds `X-Request-Id` to every response (reuses client value when valid) for log correlation. */
export function RequestIdMiddleware(req: any, res: any, next: () => void) {
  const incoming = String(req.headers?.["x-request-id"] ?? "").slice(0, 64);
  const id = /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader("x-request-id", id);
  next();
}
