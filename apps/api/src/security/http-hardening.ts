import type { Server } from "node:http";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";

/**
 * Defensive HTTP settings for the internal API. The API is only reached by the BFF with the internal key, so it
 * should expose as little as possible: no framework banner, JSON only, bounded bodies and connections, no CORS in
 * production, and a cap on concurrent requests so floods cannot exhaust the database pool. These settings reduce
 * abuse; they are not a substitute for the TLS, connection and rate limits of the public edge.
 */
export type HardeningOptions = {
  production: boolean;
  /** Browser origins allowed to call the API directly. Empty means CORS is not enabled at all. */
  corsOrigins: string[];
  maxBodyBytes: number;
  maxInFlight: number;
  requestTimeoutMs: number;
  headersTimeoutMs: number;
  keepAliveTimeoutMs: number;
};

const integer = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) => {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new Error("Invalid API hardening configuration");
  return parsed;
};

export function hardeningFromEnv(
  env: Record<string, string | undefined>,
): HardeningOptions {
  const production = env.NODE_ENV === "production";
  const configured = (env.API_CORS_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  // Exact origins only: no wildcards or paths, and plain http only outside production.
  const originPattern = production
    ? /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i
    : /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;
  for (const origin of configured)
    if (!originPattern.test(origin))
      throw new Error("Invalid API hardening configuration");
  const corsOrigins =
    configured.length > 0
      ? configured
      : production
        ? []
        : ["http://localhost:3000", "http://localhost:3001"];
  const requestTimeoutMs = integer(
    env.API_REQUEST_TIMEOUT_MS,
    30_000,
    1000,
    120_000,
  );
  const headersTimeoutMs = integer(
    env.API_HEADERS_TIMEOUT_MS,
    15_000,
    1000,
    60_000,
  );
  if (headersTimeoutMs > requestTimeoutMs)
    throw new Error("Invalid API hardening configuration");
  return {
    production,
    corsOrigins,
    maxBodyBytes: integer(env.API_MAX_BODY_BYTES, 262_144, 1024, 1_048_576),
    maxInFlight: integer(env.API_MAX_IN_FLIGHT, 256, 1, 10_000),
    requestTimeoutMs,
    headersTimeoutMs,
    keepAliveTimeoutMs: integer(
      env.API_KEEP_ALIVE_TIMEOUT_MS,
      5_000,
      1000,
      60_000,
    ),
  };
}

export function applyHttpHardening(
  app: NestExpressApplication,
  options: HardeningOptions,
) {
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  // Shed load instead of queueing it: a flood cannot hold unbounded work against the database pool.
  let inFlight = 0;
  app.use((_request: Request, response: Response, next: NextFunction) => {
    if (inFlight >= options.maxInFlight) {
      response.setHeader("Retry-After", "1");
      response.status(503).json({ message: "Service unavailable" });
      return;
    }
    inFlight += 1;
    // `close` fires for completed, aborted and timed-out requests alike, so the counter cannot leak.
    response.once("close", () => {
      inFlight -= 1;
    });
    next();
  });
  // Only a size-capped JSON parser exists: no urlencoded, text or raw bodies.
  app.useBodyParser("json", { limit: options.maxBodyBytes, strict: true });
  if (options.corsOrigins.length > 0)
    app.enableCors({
      origin: options.corsOrigins,
      methods: ["GET", "POST"],
      credentials: false,
      maxAge: 600,
    });
  const server = app.getHttpServer() as Server;
  server.requestTimeout = options.requestTimeoutMs;
  server.headersTimeout = options.headersTimeoutMs;
  server.keepAliveTimeout = options.keepAliveTimeoutMs;
  server.maxHeadersCount = 64;
  server.maxRequestsPerSocket = 1000;
  return {
    inFlight: () => inFlight,
  };
}
