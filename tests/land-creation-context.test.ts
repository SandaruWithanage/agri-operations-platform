import { afterEach, expect, it, vi } from "vitest";
import { PilotClient } from "../packages/sync-client/src";
import { readLandCreationContext } from "../apps/admin-web/lib/land-creation-context";
const owner = {
    accountId: "a50456eb-af66-41f0-8c38-0bc827249cd2",
    deviceId: "38f0dbdd-85db-4c75-bced-066e8ea54b86",
  },
  geography = {
    id: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
    name: "Synthetic land scope",
  };
function setup() {
  const client = new PilotClient();
  vi.spyOn(client, "sessionIdentity").mockResolvedValue(owner);
  vi.spyOn(client, "landGeographies").mockResolvedValue({
    accountId: owner.accountId,
    geographies: [geography],
  });
  return { client, signal: new AbortController().signal };
}
afterEach(() => vi.restoreAllMocks());
it("uses only land-create choices with original-device checks before and after the catalog", async () => {
  const f = setup();
  expect(
    await readLandCreationContext(f.client, owner, geography.id, f.signal),
  ).toEqual({ geographies: [{ id: geography.id, label: geography.name }] });
  expect(f.client.sessionIdentity).toHaveBeenCalledTimes(2);
  expect(f.client.landGeographies).toHaveBeenCalledWith(f.signal);
});
it("rejects a device change during the catalog request", async () => {
  const f = setup();
  vi.mocked(f.client.sessionIdentity)
    .mockResolvedValueOnce(owner)
    .mockResolvedValueOnce({ ...owner, deviceId: geography.id });
  await expect(
    readLandCreationContext(f.client, owner, undefined, f.signal),
  ).rejects.toMatchObject({ status: 401 });
});
it("rejects a catalog belonging to another account", async () => {
  const f = setup();
  vi.mocked(f.client.landGeographies).mockResolvedValue({
    accountId: geography.id,
    geographies: [geography],
  });
  await expect(
    readLandCreationContext(f.client, owner, undefined, f.signal),
  ).rejects.toMatchObject({ status: 401 });
});
it("preserves an empty fresh form but refuses a selected location outside current land-create scope", async () => {
  const f = setup();
  vi.mocked(f.client.landGeographies).mockResolvedValue({
    accountId: owner.accountId,
    geographies: [],
  });
  expect(
    await readLandCreationContext(f.client, owner, undefined, f.signal),
  ).toEqual({ geographies: [] });
  await expect(
    readLandCreationContext(f.client, owner, geography.id, f.signal),
  ).rejects.toMatchObject({ status: 403 });
});
it("rejects a cancelled late catalog before returning private choices", async () => {
  const f = setup(),
    controller = new AbortController();
  vi.mocked(f.client.landGeographies).mockImplementation(async () => {
    controller.abort();
    return { accountId: owner.accountId, geographies: [geography] };
  });
  await expect(
    readLandCreationContext(f.client, owner, undefined, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
