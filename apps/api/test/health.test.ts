// @vitest-environment node
import "reflect-metadata";
import { test, expect } from "vitest";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { AppModule } from "../src/app.module";
test("GET /health exposes liveness without claiming database or auth readiness", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    await app.init();
    const response = await request(app.getHttpServer()).get("/health");
    expect(response.status).toBe(200);
    const readiness = await request(app.getHttpServer()).get("/ready");
    expect(readiness.status).toBe(503);
    expect(readiness.body).toEqual({ status: "not-ready" });
    expect(readiness.headers["cache-control"]).toBe("no-store");
    const disabled = await request(app.getHttpServer())
      .post("/pilot/auth/login")
      .send({});
    expect(disabled.status).toBe(503);
    expect(disabled.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      status: "ok",
      db: "not-checked",
      auth: "not-checked",
    });
  } finally {
    await app.close();
  }
});
