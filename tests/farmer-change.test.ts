// @vitest-environment node
import { expect, it, vi } from "vitest";
import { farmerChangeSchema } from "../packages/validation/src";
import { PilotClient } from "../packages/sync-client/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const input = {
  mutationId: "c8a85c92-740b-48d5-99d0-1cda6c4cd31c",
  farmerId: "06149451-4004-4a23-a5a2-64a24e485a82",
  expectedVersion: 1,
  action: "verification" as const,
  reason: "Synthetic record review",
};
const csrfToken = `${"B".repeat(43)}.${"C".repeat(43)}`;
it("validates core corrections and rejects caller authority, missing reasons and unsafe versions", () => {
  expect(farmerChangeSchema.parse(input)).toEqual(input);
  for (const candidate of [
    { ...input, accountId },
    { ...input, reason: "" },
    { ...input, expectedVersion: 0 },
    { ...input, expectedVersion: 2147483647 },
    { ...input, fullName: "Synthetic unexpected verification payload" },
    { ...input, action: "correction", fullName: " ", geographyId: accountId },
  ])
    expect(farmerChangeSchema.safeParse(candidate).success).toBe(false);
});
it("preserves the exact mutation after a lost response and checks the acknowledged version", async () => {
  const network = vi
    .fn()
    .mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith("auth/csrf"))
        return Response.json({ accountId, csrfToken });
      expect(JSON.parse(String(init?.body))).toEqual(input);
      if (network.mock.calls.length === 2)
        throw new Error("Synthetic lost response");
      return Response.json({
        farmerId: input.farmerId,
        version: 2,
        replayed: true,
        duplicateRisk: false,
      });
    });
  const api = new PilotClient(network);
  await expect(api.changeFarmer(accountId, input)).rejects.toMatchObject({
    status: 503,
  });
  expect(await api.changeFarmer(accountId, input)).toEqual({
    farmerId: input.farmerId,
    version: 2,
    replayed: true,
    duplicateRisk: false,
  });
  expect(
    network.mock.calls.filter(([path]) =>
      String(path).endsWith("farmers/change"),
    ),
  ).toHaveLength(2);
});
it("does not submit a retained change through another account's cookie session", async () => {
  const network = vi
    .fn()
    .mockResolvedValue(Response.json({ accountId: input.farmerId, csrfToken }));
  await expect(
    new PilotClient(network).changeFarmer(accountId, input),
  ).rejects.toMatchObject({ status: 401 });
  expect(network).toHaveBeenCalledOnce();
});
it("does not acknowledge a malformed or unexpected server revision", async () => {
  const network = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accountId, csrfToken }))
    .mockResolvedValueOnce(
      Response.json({
        farmerId: input.farmerId,
        version: 10,
        replayed: false,
        duplicateRisk: false,
      }),
    );
  await expect(
    new PilotClient(network).changeFarmer(accountId, input),
  ).rejects.toMatchObject({ status: 503 });
});

it("binds a verification receipt to the requested record and strips journal extras", async () => {
  const receipt = {
    mutationId: input.mutationId,
    version: 2,
    occurredAt: "2026-11-15T20:00:00.123456Z",
  };
  const network = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        accountId,
        farmerId: input.farmerId,
        receipt: { ...receipt, sessionId: "synthetic-private" },
        actorEmail: "synthetic-private",
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ accountId, farmerId: accountId, receipt }),
    );
  expect(
    await new PilotClient(network).farmerVerificationReceipt(input.farmerId),
  ).toEqual({ accountId, farmerId: input.farmerId, receipt });
  await expect(
    new PilotClient(network).farmerVerificationReceipt(input.farmerId),
  ).rejects.toMatchObject({ status: 503 });
});
it("cancels receipt reads at the fetch boundary", async () => {
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
  const controller = new AbortController();
  const result = expect(
    new PilotClient(network).farmerVerificationReceipt(
      input.farmerId,
      controller.signal,
    ),
  ).rejects.toMatchObject({ status: 503 });
  controller.abort();
  await result;
  expect(signal.aborted).toBe(true);
});

it("binds an online retained correction to the expected approved device", async () => {
  const deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
  for (const actualDevice of [undefined, input.farmerId]) {
    const network = vi
      .fn()
      .mockResolvedValue(
        Response.json({ accountId, csrfToken, deviceId: actualDevice }),
      );
    await expect(
      new PilotClient(network).changeFarmer(accountId, input, deviceId),
    ).rejects.toMatchObject({ status: 401 });
    expect(network).toHaveBeenCalledOnce();
  }
  const network = vi.fn();
  await expect(
    new PilotClient(network).changeFarmer(accountId, input, "invalid"),
  ).rejects.toMatchObject({ status: 400 });
  expect(network).not.toHaveBeenCalled();
});
