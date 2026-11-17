// @vitest-environment node
import "reflect-metadata";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import {
  Body,
  Controller,
  Get,
  Post,
  type INestApplication,
} from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import {
  applyHttpHardening,
  hardeningFromEnv,
  type HardeningOptions,
} from "../src/security/http-hardening";

let release: () => void = () => undefined;
@Controller("t")
class TestController {
  @Post("echo")
  echo(@Body() body: unknown) {
    return { received: body ?? null };
  }
  @Get("slow")
  slow() {
    return new Promise((resolve) => {
      release = () => resolve({ done: true });
    });
  }
  @Get("fast")
  fast() {
    return { ok: true };
  }
}
const base: HardeningOptions = {
  production: true,
  corsOrigins: [],
  maxBodyBytes: 262144,
  maxInFlight: 256,
  requestTimeoutMs: 30000,
  headersTimeoutMs: 15000,
  keepAliveTimeoutMs: 5000,
};
let app: INestApplication | undefined;
async function start(over: Partial<HardeningOptions> = {}) {
  const created = await NestFactory.create<NestExpressApplication>(
    { module: class TestModule {}, controllers: [TestController] },
    { bodyParser: false, logger: false },
  );
  const handle = applyHttpHardening(created, { ...base, ...over });
  await created.init();
  app = created;
  return { app: created, handle, http: request(created.getHttpServer()) };
}
afterEach(async () => {
  release();
  await app?.close();
  app = undefined;
});

describe("API HTTP hardening", () => {
  it("sets defensive headers and hides the framework banner", async () => {
    const { http: api } = await start();
    const response = await api.get("/t/fast");
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["content-security-policy"]).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.headers["cross-origin-resource-policy"]).toBe(
      "same-origin",
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    // Error responses carry the headers too.
    expect(
      (await api.get("/t/missing")).headers["x-content-type-options"],
    ).toBe("nosniff");
  });

  it("accepts only bounded JSON bodies", async () => {
    const { http: api } = await start({ maxBodyBytes: 2048 });
    const ok = await api.post("/t/echo").send({ a: 1 });
    expect(ok.body).toEqual({ received: { a: 1 } });
    expect(
      (await api.post("/t/echo").send({ filler: "x".repeat(4000) })).status,
    ).toBe(413);
    // Other content types are never parsed, so they cannot reach a handler as data.
    const form = await api.post("/t/echo").type("form").send("a=1&b=2");
    expect(form.body).toEqual({ received: null });
    const text = await api.post("/t/echo").type("text/plain").send("hello");
    expect(text.body).toEqual({ received: null });
    // Malformed JSON and bare primitives (strict mode) are refused.
    expect(
      (await api.post("/t/echo").type("json").send("{not json")).status,
    ).toBe(400);
    expect(
      (await api.post("/t/echo").type("json").send('"just a string"')).status,
    ).toBe(400);
  });

  it("enables CORS only for configured origins, and not at all by default in production", async () => {
    const closed = await start();
    const denied = await closed.http
      .get("/t/fast")
      .set("Origin", "https://evil.example.test");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    expect(
      (
        await closed.http
          .options("/t/echo")
          .set("Origin", "https://evil.example.test")
          .set("Access-Control-Request-Method", "POST")
      ).headers["access-control-allow-origin"],
    ).toBeUndefined();
    await app?.close();
    const open = await start({ corsOrigins: ["https://app.example.test"] });
    expect(
      (await open.http.get("/t/fast").set("Origin", "https://app.example.test"))
        .headers["access-control-allow-origin"],
    ).toBe("https://app.example.test");
    expect(
      (
        await open.http
          .get("/t/fast")
          .set("Origin", "https://evil.example.test")
      ).headers["access-control-allow-origin"],
    ).toBeUndefined();
  });

  it("sheds load beyond the in-flight cap and releases the slot for completed and aborted requests", async () => {
    const { app: nest, handle, http: api } = await start({ maxInFlight: 1 });
    await nest.listen(0, "127.0.0.1");
    const port = (nest.getHttpServer().address() as AddressInfo).port;
    const held = new Promise<number>((resolve, reject) => {
      http
        .get({ port, host: "127.0.0.1", path: "/t/slow" }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        })
        .on("error", reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handle.inFlight()).toBe(1);
    const shed = await api.get("/t/fast");
    expect(shed.status).toBe(503);
    expect(shed.headers["retry-after"]).toBe("1");
    release();
    expect(await held).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(handle.inFlight()).toBe(0);
    expect((await api.get("/t/fast")).status).toBe(200);
    // A client that hangs up mid-request does not leak its slot.
    const aborted = http.get({ port, host: "127.0.0.1", path: "/t/slow" });
    aborted.on("error", () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handle.inFlight()).toBe(1);
    aborted.destroy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handle.inFlight()).toBe(0);
  });

  it("bounds connection and request time", async () => {
    const { app: nest } = await start({
      requestTimeoutMs: 20000,
      headersTimeoutMs: 8000,
      keepAliveTimeoutMs: 3000,
    });
    const server = nest.getHttpServer();
    expect(server.requestTimeout).toBe(20000);
    expect(server.headersTimeout).toBe(8000);
    expect(server.keepAliveTimeout).toBe(3000);
    expect(server.maxHeadersCount).toBe(64);
  });
});

describe("hardening configuration", () => {
  it("defaults to no CORS in production and local origins in development", () => {
    expect(hardeningFromEnv({ NODE_ENV: "production" }).corsOrigins).toEqual(
      [],
    );
    expect(hardeningFromEnv({}).corsOrigins).toEqual([
      "http://localhost:3000",
      "http://localhost:3001",
    ]);
    expect(
      hardeningFromEnv({
        NODE_ENV: "production",
        API_CORS_ORIGINS: "https://a.example.test, https://b.example.test:8443",
      }).corsOrigins,
    ).toEqual(["https://a.example.test", "https://b.example.test:8443"]);
  });
  it("rejects unsafe values instead of ignoring them", () => {
    for (const env of [
      { API_CORS_ORIGINS: "*" },
      { API_CORS_ORIGINS: "https://a.example.test/path" },
      { NODE_ENV: "production", API_CORS_ORIGINS: "http://a.example.test" },
      { API_MAX_IN_FLIGHT: "0" },
      { API_MAX_IN_FLIGHT: "x" },
      { API_MAX_BODY_BYTES: "10" },
      { API_MAX_BODY_BYTES: "99999999" },
      { API_REQUEST_TIMEOUT_MS: "2000", API_HEADERS_TIMEOUT_MS: "9000" },
    ])
      expect(() => hardeningFromEnv(env)).toThrow(
        "Invalid API hardening configuration",
      );
  });
});
