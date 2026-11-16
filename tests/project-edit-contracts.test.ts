// @vitest-environment node
import { expect, it, vi } from "vitest";
import { projectChangeSchema } from "../packages/validation/src";
import { PilotClient } from "../packages/sync-client/src";
import { createBffHandler } from "../packages/auth-bff/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86",
  projectId = "06149451-4004-4a23-a5a2-64a24e485a82";
const input = {
  mutationId: "c8a85c92-740b-48d5-99d0-1cda6c4cd31c",
  projectId,
  expectedVersion: 1,
  name: "Synthetic edited project",
  active: false,
};
const csrf = `${"B".repeat(43)}.${"C".repeat(43)}`,
  origin = "https://admin.example.test";
const config = {
  apiOrigin: "https://api.example.test",
  publicOrigin: origin,
  internalKey: "synthetic-internal-key-with-at-least-43-characters",
  source: "administrator" as const,
};
function request(body: unknown, token = csrf) {
  return new Request(`${origin}/api/pilot/projects/change`, {
    method: "POST",
    headers: {
      origin,
      cookie: `__Host-agri_session=${"A".repeat(43)}`,
      "content-type": "application/json",
      "x-csrf-token": token,
    },
    body: JSON.stringify(body),
  });
}
it("requires a version, explicit boolean and name, rejecting immutable/actor fields", () => {
  expect(
    projectChangeSchema.parse({
      ...input,
      name: "  Synthetic  ",
      projectId: projectId.toUpperCase(),
    }),
  ).toMatchObject({ name: "Synthetic", projectId });
  for (const extra of [
    { expectedVersion: 0 },
    { expectedVersion: 2147483647 },
    { expectedVersion: "1" },
    { active: undefined },
    { name: "  " },
    { organizationId: deviceId },
    { createdBy: accountId },
    { source: "administrator" },
    { version: 2 },
  ])
    expect(projectChangeSchema.safeParse({ ...input, ...extra }).success).toBe(
      false,
    );
});
it.each(["accountId", "deviceId"] as const)(
  "rejects changed %s before POST",
  async (key) => {
    const network = vi.fn().mockResolvedValue(
      Response.json({
        accountId,
        deviceId,
        [key]: projectId,
        csrfToken: csrf,
      }),
    );
    await expect(
      new PilotClient(network).changeProject(accountId, input, deviceId),
    ).rejects.toMatchObject({ status: 401 });
    expect(network).toHaveBeenCalledOnce();
  },
);
it("preserves a fixed payload on retry and validates the exact outcome version", async () => {
  const network = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ accountId, deviceId, csrfToken: csrf }),
    )
    .mockRejectedValueOnce(new Error("Synthetic lost acknowledgement"))
    .mockResolvedValueOnce(
      Response.json({ accountId, deviceId, csrfToken: csrf }),
    )
    .mockResolvedValueOnce(
      Response.json({ projectId, version: 2, replayed: true }),
    );
  const client = new PilotClient(network);
  await expect(
    client.changeProject(accountId, input, deviceId),
  ).rejects.toMatchObject({ status: 503 });
  expect(await client.changeProject(accountId, input, deviceId)).toEqual({
    projectId,
    version: 2,
    replayed: true,
  });
  expect(network.mock.calls[1][1].body).toBe(network.mock.calls[3][1].body);
  const wrong = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ accountId, deviceId, csrfToken: csrf }),
    )
    .mockResolvedValueOnce(
      Response.json({ projectId, version: 3, replayed: true }),
    );
  await expect(
    new PilotClient(wrong).changeProject(accountId, input, deviceId),
  ).rejects.toMatchObject({ status: 503 });
});
it("requires CSRF and strips private fields from a valid acknowledgement", async () => {
  const missing = vi.fn();
  expect(
    (await createBffHandler(config, missing)(request(input, ""))).status,
  ).toBe(403);
  expect(missing).not.toHaveBeenCalled();
  const network = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only-jwt" }))
    .mockResolvedValueOnce(
      Response.json({
        projectId,
        version: 2,
        replayed: false,
        oldName: "private-extra",
      }),
    );
  const result = await createBffHandler(config, network)(request(input));
  expect(await result.json()).toEqual({
    projectId,
    version: 2,
    replayed: false,
  });
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(network.mock.calls[1][1].headers["x-agri-source"]).toBe(
    "administrator",
  );
});
it.each([
  { projectId: accountId, version: 2, replayed: false },
  { projectId, version: 3, replayed: true },
])("rejects an inconsistent upstream acknowledgement %j", async (result) => {
  const network = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only-jwt" }))
    .mockResolvedValueOnce(Response.json(result));
  expect((await createBffHandler(config, network)(request(input))).status).toBe(
    503,
  );
});
