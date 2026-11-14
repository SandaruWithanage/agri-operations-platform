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
    expect(response.body).toEqual({
      status: "ok",
      db: "not-connected",
      auth: "not-implemented",
    });
  } finally {
    await app.close();
  }
});
