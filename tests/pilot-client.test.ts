// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PilotClient } from "../apps/field-pwa/lib/pilot-client";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const csrfToken = `${"B".repeat(43)}.${"C".repeat(43)}`;
const input = {
  mutationId: "f7e0c8bc-3dcb-4be7-ab63-d80f4099220a",
  farmer: {
    farmerId: "06149451-4004-4a23-a5a2-64a24e485a82",
    geographyId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
    fullName: "Synthetic farmer",
    privacyNoticeProvided: true as const,
  },
};
describe("browser registration transport", () => {
  it("reauthenticates on retry and sends the same mutation after an ambiguous network failure", async () => {
    const network = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ accountId, csrfToken }))
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(Response.json({ accountId, csrfToken }))
      .mockResolvedValueOnce(
        Response.json({ status: "synced", farmerId: input.farmer.farmerId }),
      );
    const client = new PilotClient(network);
    await expect(client.register(accountId, input)).rejects.toMatchObject({
      status: 503,
    });
    await client.register(accountId, input);
    expect(network.mock.calls.map((call) => call[0])).toEqual([
      "/api/pilot/auth/csrf",
      "/api/pilot/farmers/register",
      "/api/pilot/auth/csrf",
      "/api/pilot/farmers/register",
    ]);
    const options = network.mock.calls[1][1];
    expect(options.body).toBe(network.mock.calls[3][1].body);
    expect(options.credentials).toBe("same-origin");
    expect(options.cache).toBe("no-store");
    expect(options.headers["x-csrf-token"]).toBe(csrfToken);
    expect(options.headers.authorization).toBeUndefined();
  });
  it("never sends an old registration from another authenticated account", async () => {
    const network = vi
      .fn()
      .mockResolvedValue(
        Response.json({ accountId: input.farmer.farmerId, csrfToken }),
      );
    await expect(
      new PilotClient(network).register(accountId, input),
    ).rejects.toMatchObject({ status: 403 });
    expect(network).toHaveBeenCalledOnce();
  });
  it("preserves the error on a revoked session and rejects mismatched successful responses", async () => {
    const network = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const client = new PilotClient(network);
    await expect(client.register(accountId, input)).rejects.toMatchObject({
      status: 401,
    });
    network
      .mockResolvedValueOnce(Response.json({ accountId, csrfToken }))
      .mockResolvedValueOnce(
        Response.json({ status: "synced", farmerId: accountId }),
      );
    await expect(client.register(accountId, input)).rejects.toMatchObject({
      status: 503,
    });
  });
});

it("preserves pending sync on account/device/session changes and separates conflicts from rejected mutations", async () => {
  const deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
  const wrong = vi
    .fn()
    .mockResolvedValue(
      Response.json({ accountId, csrfToken, deviceId: accountId }),
    );
  await expect(
    new PilotClient(wrong).sendRegistration(
      accountId,
      deviceId,
      input.mutationId,
      input.farmer,
    ),
  ).rejects.toMatchObject({ status: 401 });
  expect(wrong).toHaveBeenCalledOnce();
  for (const [status, result] of [
    [403, "rejected"],
    [400, "rejected"],
    [409, "conflict"],
  ] as const) {
    const network = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ accountId, csrfToken, deviceId }))
      .mockResolvedValueOnce(new Response(null, { status }));
    expect(
      await new PilotClient(network).sendRegistration(
        accountId,
        deviceId,
        input.mutationId,
        input.farmer,
      ),
    ).toEqual({ status: result });
  }
  for (const status of [401, 429, 503]) {
    const network = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ accountId, csrfToken, deviceId }))
      .mockResolvedValueOnce(new Response(null, { status }));
    await expect(
      new PilotClient(network).sendRegistration(
        accountId,
        deviceId,
        input.mutationId,
        input.farmer,
      ),
    ).rejects.toMatchObject({ status });
  }
});

it("returns only account/device metadata from a cancellable online session identity read", async () => {
  const deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86",
    accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
  const network = vi.fn().mockResolvedValue(
    Response.json({
      accountId,
      deviceId,
      csrfToken: `${"B".repeat(43)}.${"C".repeat(43)}`,
      accessToken: "private",
      sessionId: "private",
    }),
  );
  expect(await new PilotClient(network).sessionIdentity()).toEqual({
    accountId,
    deviceId,
  });
  const legacy = vi.fn().mockResolvedValue(
    Response.json({
      accountId,
      csrfToken: `${"B".repeat(43)}.${"C".repeat(43)}`,
    }),
  );
  await expect(new PilotClient(legacy).sessionIdentity()).rejects.toMatchObject(
    { status: 401 },
  );
});

describe("enrollment and policy transport", () => {
  const deviceId = "0f3d9a43-92a1-4c0e-8a8d-5a34f3a2a111";
  const ids = {
    mutationId: "c8a85c92-740b-48d5-99d0-1cda6c4cd31c",
    enrollmentId: "06149451-4004-4a23-a5a2-64a24e485a82",
    projectId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
    farmerId: "a50456eb-af66-41f0-8c38-0bc827249cd2",
  };
  const session = () => Response.json({ accountId, csrfToken, deviceId });
  it("sends a CSRF-bound enrollment and rejects a mismatched acknowledgment", async () => {
    const network = vi
      .fn()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(
        Response.json({
          enrollmentId: ids.enrollmentId,
          version: 1,
          replayed: false,
        }),
      );
    const client = new PilotClient(network);
    expect(await client.enrollFarmer(accountId, ids, deviceId)).toMatchObject({
      version: 1,
    });
    expect(network.mock.calls[1][0]).toBe("/api/pilot/enrollments/enroll");
    expect(network.mock.calls[1][1].headers["x-csrf-token"]).toBe(csrfToken);
    const wrong = vi
      .fn()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(
        Response.json({
          enrollmentId: ids.projectId,
          version: 1,
          replayed: false,
        }),
      );
    await expect(
      new PilotClient(wrong).enrollFarmer(accountId, ids, deviceId),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("refuses another device or account and an incorrectly versioned policy result", async () => {
    const other = vi.fn().mockResolvedValueOnce(session());
    await expect(
      new PilotClient(other).enrollFarmer(
        accountId,
        ids,
        "1f3d9a43-92a1-4c0e-8a8d-5a34f3a2a111",
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(other).toHaveBeenCalledTimes(1);
    const policy = {
      mutationId: ids.mutationId,
      projectId: ids.projectId,
      expectedVersion: 1,
      enabled: true,
      eligibleFarmerStatuses: ["verified" as const],
    };
    const stale = vi
      .fn()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(
        Response.json({
          projectId: ids.projectId,
          version: 1,
          replayed: false,
        }),
      );
    await expect(
      new PilotClient(stale).setEnrollmentPolicy(accountId, policy, deviceId),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("binds policy and enrollment reads to the requested identifiers", async () => {
    const read = vi.fn().mockResolvedValueOnce(
      Response.json({
        accountId,
        projectId: ids.farmerId,
        policy: null,
      }),
    );
    await expect(
      new PilotClient(read).enrollmentPolicy(ids.projectId),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      new PilotClient(vi.fn()).enrollment("not-a-uuid"),
    ).rejects.toMatchObject({ status: 400 });
  });
});
