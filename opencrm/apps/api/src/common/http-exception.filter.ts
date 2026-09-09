import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";

/** Redact secrets from any string that might reach logs or HTTP responses. */
export function redactSecrets(input: unknown): unknown {
  if (typeof input === "string") return redactStr(input);
  if (Array.isArray(input)) return input.map(redactSecrets);
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (/api[-_]?key|password|secret|token|credential|authorization/i.test(k)) {
        out[k] = typeof v === "string" && v.length > 0 ? "***" : v;
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out;
  }
  return input;
}

function redactStr(s: string): string {
  return s
    .replace(/nvapi-[A-Za-z0-9_\-]{8,}/g, "nvapi-***")
    .replace(/sk-(ant-)?[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "JWT***");
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private logger = new Logger("HttpException");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();
    // body-parser (express json) errors are NOT HttpException — preserve their status (e.g. 413 entity.too.large).
    const rawStatus = (exception as any)?.status ?? (exception as any)?.statusCode;
    const isBodyParser =
      (exception as any)?.type === "entity.too.large" || (exception as any)?.type === "entity.parse.failed";
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : typeof rawStatus === "number" && rawStatus >= 400 && rawStatus < 600
          ? rawStatus
          : HttpStatus.INTERNAL_SERVER_ERROR;
    const rawResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : isBodyParser
          ? { statusCode: status, message: status === 413 ? "Payload too large" : "Invalid JSON body" }
          : "Internal server error";
    const safeResponse = redactSecrets(rawResponse);

    // HttpExceptions are thrown deliberately with curated messages — pass them through
    // (including intentional 5xx like 502 from URL fetching). Only UNKNOWN errors are masked.
    const toBody = (r: unknown) =>
      typeof r === "object" && r !== null ? r : { statusCode: status, message: r };
    const body =
      exception instanceof HttpException
        ? toBody(safeResponse)
        : { statusCode: 500, message: "Internal server error", path: req?.url };

    if (status >= 500) {
      const msg = exception instanceof Error ? exception.message : String(exception);
      const rid = req?.id ? ` [rid=${String(req.id).slice(0, 36)}]` : "";
      this.logger.error(`[${req?.method} ${req?.url}]${rid} ${redactStr(msg)}`);
    }
    res.status(status).json(body);
  }
}
