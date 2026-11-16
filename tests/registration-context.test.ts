import { afterEach, expect, it, vi } from "vitest";
import { PilotClient } from "../packages/sync-client/src";
import { readRegistrationContext } from "../apps/admin-web/lib/registration-context";
const owner = {
  accountId: "a50456eb-af66-41f0-8c38-0bc827249cd2",
  deviceId: "38f0dbdd-85db-4c75-bced-066e8ea54b86",
};
const geography = {
  id: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
  label: "Synthetic configured village",
};
function setup() {
  const client = new PilotClient();
  vi.spyOn(client, "sessionIdentity").mockResolvedValue(owner);
  const context = {
    ...owner,
    deviceKeyFingerprint: "a".repeat(64),
    verifiedAt: 1,
    offlineUntil: 60001,
    geographies: [geography],
  };
  vi.spyOn(client, "context").mockResolvedValue(context);
  return { client, context };
}
afterEach(() => vi.restoreAllMocks());
it("returns only currently authorized create references, excluding offline/session metadata", async () => {
  const f = setup();
  expect(await readRegistrationContext(f.client, owner, geography.id)).toEqual({
    geographies: [geography],
  });
  expect(f.client.sessionIdentity).toHaveBeenCalledBefore(f.client.context);
});
it.each(["accountId", "deviceId"] as const)(
  "rejects a different session %s before loading references",
  async (key) => {
    const f = setup();
    vi.mocked(f.client.sessionIdentity).mockResolvedValue({
      ...owner,
      [key]: geography.id,
    });
    await expect(
      readRegistrationContext(f.client, owner),
    ).rejects.toMatchObject({ status: 401 });
    expect(f.client.context).not.toHaveBeenCalled();
  },
);
it.each(["accountId", "deviceId"] as const)(
  "rejects a %s transition between session and reference reads",
  async (key) => {
    const f = setup();
    vi.mocked(f.client.context).mockResolvedValue({
      ...f.context,
      [key]: geography.id,
    });
    await expect(
      readRegistrationContext(f.client, owner),
    ).rejects.toMatchObject({ status: 401 });
  },
);
it("allows an empty new form but refuses to reopen a selected geography outside current coverage", async () => {
  const f = setup();
  vi.mocked(f.client.context).mockResolvedValue({
    ...f.context,
    geographies: [],
  });
  expect(await readRegistrationContext(f.client, owner)).toEqual({
    geographies: [],
  });
  await expect(
    readRegistrationContext(f.client, owner, geography.id),
  ).rejects.toMatchObject({ status: 403 });
});
it("rejects late reference data after its request was canceled", async () => {
  const f = setup(),
    controller = new AbortController();
  vi.mocked(f.client.context).mockImplementation(async () => {
    controller.abort();
    return f.context;
  });
  await expect(
    readRegistrationContext(f.client, owner, undefined, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
