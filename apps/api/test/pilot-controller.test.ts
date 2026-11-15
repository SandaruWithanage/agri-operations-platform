// @vitest-environment node
import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NestFactory } from "@nestjs/core";
import { ForbiddenException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { PilotController } from "../src/pilot/pilot.controller";
import { PILOT_RUNTIME, type PilotRuntime } from "../src/pilot/contracts";
import { createPilotRuntime } from "../src/pilot/runtime";
import { registrationEnvelopeSchema } from "../src/farmer/registration-service";
const key = "synthetic-internal-key-with-more-than-43-characters";
const secret = "A".repeat(43);
const actor = {
  accountId: "a50456eb-af66-41f0-8c38-0bc827249cd2",
  sessionId: "11b492ca-bcb4-4662-91d9-88789a80a0c2",
};
const input = {
  mutationId: "f7e0c8bc-3dcb-4be7-ab63-d80f4099220a",
  farmer: {
    farmerId: "06149451-4004-4a23-a5a2-64a24e485a82",
    geographyId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
    fullName: "Synthetic",
    privacyNoticeProvided: true,
  },
};
let app: INestApplication;
function fake(): PilotRuntime {
  return {
    internalKey: key,
    deviceChallenge: vi.fn().mockReturnValue({
      nonce: "A".repeat(43),
      expiresAt: 1,
      mac: "B".repeat(43),
    }),
    login: vi.fn().mockResolvedValue({ cookie: "synthetic" }),
    csrf: vi.fn().mockResolvedValue({
      csrfToken: "synthetic",
      accountId: actor.accountId,
      deviceId: "38f0dbdd-85db-4c75-bced-066e8ea54b86",
    }),
    token: vi.fn().mockResolvedValue({ accessToken: "synthetic" }),
    logout: vi.fn(),
    authenticate: vi.fn().mockResolvedValue(actor),
    assertCsrf: vi.fn(),
    register: vi.fn().mockImplementation(async (_actor, _source, value) => {
      registrationEnvelopeSchema.parse(value);
      return { farmerId: input.farmer.farmerId, replayed: false };
    }),
    geographies: vi.fn().mockResolvedValue([]),
    context: vi.fn().mockResolvedValue({}),
    close: vi.fn(),
  };
}
async function start(runtime: PilotRuntime | null) {
  app = await NestFactory.create(
    {
      module: class TestModule {},
      controllers: [PilotController],
      providers: [{ provide: PILOT_RUNTIME, useValue: runtime }],
    },
    { logger: false },
  );
  await app.init();
  return request(app.getHttpServer());
}
afterEach(async () => {
  await app?.close();
});
describe("pilot internal routes", () => {
  it("keeps authentication disabled without explicit configuration", async () => {
    expect(await createPilotRuntime({})).toBeNull();
    await expect(
      createPilotRuntime({ ENABLE_PILOT_AUTH: "true" }),
    ).rejects.toThrow("incomplete");
    const http = await start(null);
    expect((await http.post("/pilot/auth/login").send({})).status).toBe(503);
  });
  it("rejects missing internal credentials and invalid login bodies", async () => {
    const runtime = fake();
    const http = await start(runtime);
    expect((await http.post("/pilot/auth/login").send({})).status).toBe(401);
    expect(
      (
        await http
          .post("/pilot/auth/login")
          .set("x-agri-bff-key", key)
          .send({ accountId: actor.accountId })
      ).status,
    ).toBe(400);
    expect(runtime.login).not.toHaveBeenCalled();
  });
  it("uses the socket client key, ignoring forged forwarded headers", async () => {
    const runtime = fake();
    const http = await start(runtime);
    const response = await http
      .post("/pilot/auth/login")
      .set("x-agri-bff-key", key)
      .set("x-forwarded-for", "attacker")
      .send({
        loginName: "synthetic",
        password: "synthetic-password",
        otp: "123456",
        deviceId: "38f0dbdd-85db-4c75-bced-066e8ea54b86",
        deviceProof: {
          nonce: "A".repeat(43),
          expiresAt: 1,
          mac: "B".repeat(43),
          signature: "C".repeat(86),
        },
      });
    expect(response.status).toBe(200);
    expect(vi.mocked(runtime.login).mock.calls[0][1]).not.toBe("attacker");
    expect(
      (
        await http
          .post("/pilot/auth/token")
          .set("x-agri-bff-key", key)
          .set("x-agri-session", secret)
      ).status,
    ).toBe(200);
  });
  it("checks server identity and CSRF before registering, and rejects spoofed actor fields", async () => {
    const runtime = fake();
    const http = await start(runtime);
    const send = (body: unknown) =>
      http
        .post("/pilot/farmers/register")
        .set("x-agri-bff-key", key)
        .set("authorization", "Bearer synthetic")
        .set("x-agri-source", "field_officer")
        .set("x-agri-origin", "https://field.example.test")
        .set("x-csrf-token", "synthetic")
        .send(body);
    expect((await send(input)).status).toBe(200);
    expect(runtime.register).toHaveBeenCalledWith(
      actor,
      "field_officer",
      input,
    );
    expect((await send({ ...input, accountId: "spoofed" })).status).toBe(400);
    vi.mocked(runtime.assertCsrf).mockImplementation(() => {
      throw new ForbiddenException();
    });
    expect((await send(input)).status).toBe(403);
  });
  it("sanitizes storage errors and reports conflicts without database details", async () => {
    const runtime = fake();
    const http = await start(runtime);
    vi.mocked(runtime.register)
      .mockRejectedValueOnce({ code: "23505", detail: "private data" })
      .mockRejectedValueOnce(new Error("private database details"));
    const send = () =>
      http
        .post("/pilot/farmers/register")
        .set("x-agri-bff-key", key)
        .set("authorization", "Bearer synthetic")
        .set("x-agri-source", "field_officer")
        .send(input);
    expect((await send()).status).toBe(409);
    const response = await send();
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain("private");
  });
});
