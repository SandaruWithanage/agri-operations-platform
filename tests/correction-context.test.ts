// @vitest-environment node
import { expect, it, vi } from "vitest";
import { PilotClient } from "../packages/sync-client/src";
import {
  beforeGeography,
  readCorrectionContext,
} from "../apps/admin-web/lib/correction-context";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const source = {
  id: "06149451-4004-4a23-a5a2-64a24e485a82",
  fullName: "Synthetic draft",
  geographyId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
  version: 1,
};
const otherGeo = "c8a85c92-740b-48d5-99d0-1cda6c4cd31c";
function setup() {
  const client = new PilotClient();
  const current = {
    ...source,
    geographyName: "Synthetic village",
    createdAt: "2026-11-16T00:00:00Z",
    status: "pending-review" as const,
    duplicateRisk: false,
  };
  vi.spyOn(client, "sessionIdentity").mockResolvedValue({
    accountId,
    deviceId,
  });
  vi.spyOn(client, "farmer").mockResolvedValue({
    accountId,
    farmer: current,
    access: { viewAudit: false, correct: true },
  });
  const page = {
    accountId,
    farmerId: source.id,
    farmerVersion: 1,
    sourceGeographyId: source.geographyId,
    geographies: [{ id: source.geographyId, name: "Synthetic village" }],
    nextCursor: null,
  };
  vi.spyOn(client, "farmerCorrectionGeographies").mockResolvedValue(page);
  return { client, current, page, signal: new AbortController().signal };
}
it("uses an unsigned UUID predecessor with no underflow or lost bits", () => {
  expect(
    beforeGeography("00000000-0000-0000-0000-000000000000"),
  ).toBeUndefined();
  expect(beforeGeography("00000000-0000-0000-0000-000000000001")).toBe(
    "00000000-0000-0000-0000-000000000000",
  );
  expect(beforeGeography("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF")).toBe(
    "ffffffff-ffff-ffff-ffff-fffffffffffe",
  );
  expect(() => beforeGeography("invalid")).toThrow();
});
it("binds fresh context, current record and choices without requiring creation authority", async () => {
  const f = setup();
  expect(
    await readCorrectionContext(
      f.client,
      { accountId, deviceId },
      source,
      undefined,
      f.signal,
    ),
  ).toEqual({ current: f.current, choices: f.page });
  expect(f.client.farmerCorrectionGeographies).toHaveBeenCalledOnce();
});
it.each([
  { accountId: deviceId, deviceId },
  { accountId, deviceId: accountId },
])("denies changed account/device before reading records", async (owner) => {
  const f = setup();
  await expect(
    readCorrectionContext(f.client, owner, source, undefined, f.signal),
  ).rejects.toMatchObject({ status: 401 });
  expect(f.client.farmer).not.toHaveBeenCalled();
});
it("does not disclose a draft through a missing correction capability", async () => {
  const f = setup();
  vi.mocked(f.client.farmer).mockResolvedValue({
    accountId,
    farmer: f.current,
    access: { viewAudit: false, correct: false },
  });
  await expect(
    readCorrectionContext(
      f.client,
      { accountId, deviceId },
      source,
      undefined,
      f.signal,
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(f.client.farmerCorrectionGeographies).not.toHaveBeenCalled();
});
it.each([{ farmerVersion: 2 }, { sourceGeographyId: otherGeo }])(
  "rejects a mixed-version or mixed-location read",
  async (change) => {
    const f = setup();
    vi.mocked(f.client.farmerCorrectionGeographies).mockResolvedValue({
      ...f.page,
      ...change,
    });
    await expect(
      readCorrectionContext(
        f.client,
        { accountId, deviceId },
        source,
        undefined,
        f.signal,
      ),
    ).rejects.toMatchObject({ status: 503 });
  },
);
it("rechecks original coverage before exposing a draft after the record moves", async () => {
  const f = setup();
  vi.mocked(f.client.farmer).mockResolvedValue({
    accountId,
    farmer: { ...f.current, geographyId: otherGeo, version: 2 },
    access: { viewAudit: false, correct: true },
  });
  vi.mocked(f.client.farmerCorrectionGeographies)
    .mockResolvedValueOnce({
      ...f.page,
      farmerVersion: 2,
      sourceGeographyId: otherGeo,
      geographies: [{ id: otherGeo, name: "Synthetic new village" }],
    })
    .mockResolvedValueOnce({
      ...f.page,
      farmerVersion: 2,
      sourceGeographyId: otherGeo,
    });
  const value = await readCorrectionContext(
    f.client,
    { accountId, deviceId },
    source,
    undefined,
    f.signal,
  );
  expect(value.current.version).toBe(2);
  expect(f.client.farmerCorrectionGeographies).toHaveBeenLastCalledWith(
    source.id,
    beforeGeography(source.geographyId),
    f.signal,
  );
});
it("retains the denial when the old location is missing from the authorized proof page", async () => {
  const f = setup();
  vi.mocked(f.client.farmer).mockResolvedValue({
    accountId,
    farmer: { ...f.current, geographyId: otherGeo, version: 2 },
    access: { viewAudit: false, correct: true },
  });
  vi.mocked(f.client.farmerCorrectionGeographies).mockResolvedValue({
    ...f.page,
    farmerVersion: 2,
    sourceGeographyId: otherGeo,
    geographies: [{ id: otherGeo, name: "Synthetic other village" }],
  });
  await expect(
    readCorrectionContext(
      f.client,
      { accountId, deviceId },
      source,
      undefined,
      f.signal,
    ),
  ).rejects.toMatchObject({ status: 403 });
});
it("rejects aborted reads even when a transport ignores cancellation", async () => {
  const f = setup(),
    controller = new AbortController();
  controller.abort();
  await expect(
    readCorrectionContext(
      f.client,
      { accountId, deviceId },
      source,
      undefined,
      controller.signal,
    ),
  ).rejects.toBeTruthy();
  expect(f.client.farmer).not.toHaveBeenCalled();
});

it.each([{ accountId: deviceId }, { farmerId: deviceId }])(
  "rejects a page bound to another account or record",
  async (change) => {
    const f = setup();
    vi.mocked(f.client.farmerCorrectionGeographies).mockResolvedValue({
      ...f.page,
      ...change,
    });
    await expect(
      readCorrectionContext(
        f.client,
        { accountId, deviceId },
        source,
        undefined,
        f.signal,
      ),
    ).rejects.toMatchObject({ status: 401 });
  },
);
