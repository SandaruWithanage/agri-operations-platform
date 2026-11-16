// @vitest-environment node
import { expect, it, vi } from "vitest";
import { projectRegistrationSchema } from "../packages/validation/src";
import { PilotClient } from "../packages/sync-client/src";
import { createBffHandler } from "../packages/auth-bff/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const projectId = "06149451-4004-4a23-a5a2-64a24e485a82",
  organizationId = "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9";
const input = {
  mutationId: "c8a85c92-740b-48d5-99d0-1cda6c4cd31c",
  projectId,
  organizationId,
  name: "Synthetic configured project",
};
const csrf = `${"B".repeat(43)}.${"C".repeat(43)}`;
const config = {
  apiOrigin: "https://api.example.test",
  publicOrigin: "https://admin.example.test",
  internalKey: "synthetic-internal-key-with-at-least-43-characters",
  source: "administrator" as const,
};
const project = {
  id: projectId,
  organizationId,
  organizationName: "Synthetic organization",
  name: input.name,
  active: false,
  version: 1,
  createdAt: "2026-11-16T00:00:00Z",
};
function request(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`${config.publicOrigin}/api/pilot/${path}`, {
    method,
    headers: {
      origin: config.publicOrigin,
      cookie: `__Host-agri_session=${"A".repeat(43)}`,
      "x-csrf-token": csrf,
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
function fetcher(result: unknown) {
  return vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only-jwt" }))
    .mockResolvedValueOnce(Response.json(result));
}
it("requires a configured organization and name, defaults the technical catalog flag to disabled and canonicalizes UUIDs", () => {
  expect(
    projectRegistrationSchema.parse({
      ...input,
      projectId: projectId.toUpperCase(),
      name: "  Synthetic  ",
    }),
  ).toEqual({ ...input, name: "Synthetic", active: false });
  expect(
    projectRegistrationSchema.parse({
      ...input,
      name: "සිංහල ව්‍යාපෘතිය",
      active: true,
    }).active,
  ).toBe(true);
  for (const change of [
    { name: "   " },
    { name: "x".repeat(201) },
    { active: "false" },
    { organizationId: "" },
    { source: "administrator" },
    { creatorId: accountId },
    { farmerId: accountId },
    { roles: ["admin"] },
    { projectType: "hardcoded" },
  ])
    expect(
      projectRegistrationSchema.safeParse({ ...input, ...change }).success,
    ).toBe(false);
});
it("keeps the same project and mutation IDs across lost acknowledgements with fresh authenticated device checks", async () => {
  const sent: string[] = [],
    network = vi
      .fn()
      .mockImplementation(async (path: string, options: RequestInit) => {
        if (path.endsWith("auth/csrf"))
          return Response.json({ accountId, deviceId, csrfToken: csrf });
        sent.push(String(options.body));
        if (sent.length === 1)
          throw new Error("Synthetic lost acknowledgement");
        expect(options.credentials).toBe("same-origin");
        expect(options.cache).toBe("no-store");
        return Response.json({ status: "synced", projectId, replayed: true });
      });
  const client = new PilotClient(network);
  await expect(
    client.registerProject(accountId, input, deviceId),
  ).rejects.toMatchObject({ status: 503 });
  expect(
    await client.registerProject(accountId, input, deviceId),
  ).toMatchObject({ projectId, replayed: true });
  expect(sent[0]).toBe(sent[1]);
  expect(JSON.parse(sent[0])).toEqual({ ...input, active: false });
  expect(network).toHaveBeenCalledTimes(4);
});
it.each(["accountId", "deviceId"] as const)(
  "does not post under another authenticated %s",
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
      new PilotClient(network).registerProject(accountId, input, deviceId),
    ).rejects.toMatchObject({ status: 401 });
    expect(network).toHaveBeenCalledOnce();
  },
);
it("refuses an invalid expected device without fetching, and never acknowledges another project", async () => {
  const invalid = vi.fn();
  await expect(
    new PilotClient(invalid).registerProject(accountId, input, ""),
  ).rejects.toMatchObject({ status: 400 });
  expect(invalid).not.toHaveBeenCalled();
  const network = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ accountId, deviceId, csrfToken: csrf }),
    )
    .mockResolvedValueOnce(
      Response.json({
        status: "synced",
        projectId: accountId,
        replayed: false,
      }),
    );
  await expect(
    new PilotClient(network).registerProject(accountId, input, deviceId),
  ).rejects.toMatchObject({ status: 503 });
});
it("requires CSRF before forwarding creation and forwards only strict normalized fields with a trusted source", async () => {
  const missing = vi.fn();
  expect(
    (
      await createBffHandler(
        config,
        missing,
      )(request("projects/register", "POST", input, { "x-csrf-token": "" }))
    ).status,
  ).toBe(403);
  expect(missing).not.toHaveBeenCalled();
  const network = fetcher({
    status: "synced",
    projectId,
    replayed: false,
    privateExtra: "synthetic-private",
  });
  const response = await createBffHandler(
    config,
    network,
  )(request("projects/register", "POST", input));
  expect(await response.json()).toEqual({
    status: "synced",
    projectId,
    replayed: false,
  });
  expect(JSON.parse(network.mock.calls[1][1].body)).toEqual({
    ...input,
    active: false,
  });
  expect(network.mock.calls[1][1].headers["x-agri-source"]).toBe(
    "administrator",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("sanitizes project projections, rejects scope injection and duplicate parameters, and validates response size/identity", async () => {
  const network = fetcher({
    accountId,
    items: [{ ...project, createdBy: accountId }],
    nextCursor: null,
    total: 500,
  });
  expect(
    await (
      await createBffHandler(config, network)(request("projects?limit=1"))
    ).json(),
  ).toEqual({ accountId, items: [project], nextCursor: null });
  for (const path of [
    "projects?limit=101",
    "projects?limit=1&limit=2",
    `projects?organizationId=${organizationId}`,
    `projects/organizations?accountId=${accountId}`,
  ]) {
    const net = fetcher({});
    expect((await createBffHandler(config, net)(request(path))).status).toBe(
      400,
    );
    expect(net).toHaveBeenCalledOnce();
  }
  expect(
    (
      await createBffHandler(
        config,
        fetcher({ accountId, items: [project, project], nextCursor: null }),
      )(request("projects?limit=1"))
    ).status,
  ).toBe(503);
  expect(
    (
      await createBffHandler(
        config,
        fetcher({ accountId, project }),
      )(request(`projects/detail?id=${accountId}`))
    ).status,
  ).toBe(503);
});
it.each(["list", "detail", "organizations"] as const)(
  "cancels %s reads and propagates aborted transport without restoring data",
  async (kind) => {
    const controller = new AbortController();
    let signal!: AbortSignal;
    const network = vi
      .fn()
      .mockImplementation((_path: string, options: RequestInit) => {
        signal = options.signal as AbortSignal;
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      });
    const client = new PilotClient(network),
      pending = expect(
        kind === "list"
          ? client.projects(undefined, controller.signal)
          : kind === "detail"
            ? client.project(projectId, controller.signal)
            : client.projectOrganizations(controller.signal),
      ).rejects.toMatchObject({ status: 503 });
    controller.abort();
    await pending;
    expect(signal.aborted).toBe(true);
  },
);
