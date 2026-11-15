// @vitest-environment node
import { expect, it, vi } from "vitest";
import { PilotClient } from "../packages/sync-client/src";
import { createBffHandler } from "../packages/auth-bff/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  farmerId = "06149451-4004-4a23-a5a2-64a24e485a82",
  mutationId = "c8a85c92-740b-48d5-99d0-1cda6c4cd31c";
const receipt = {
  accountId,
  farmerId,
  receipt: {
    mutationId,
    version: 3,
    occurredAt: "2026-11-16T00:00:00.123456Z",
  },
};
const config = {
  apiOrigin: "https://api.example.test",
  publicOrigin: "https://admin.example.test",
  internalKey: "synthetic-internal-key-with-at-least-43-characters",
  source: "administrator" as const,
};
const req = (query: string) =>
  new Request(
    `${config.publicOrigin}/api/pilot/farmers/correction-receipt?${query}`,
    { headers: { cookie: `__Host-agri_session=${"A".repeat(43)}` } },
  );
const upstream = (result: unknown) =>
  vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "private" }))
    .mockResolvedValueOnce(Response.json(result));
it("sanitizes correction receipts in client and BFF and prohibits caching", async () => {
  const extra = {
    ...receipt,
    sessionId: "private",
    receipt: { ...receipt.receipt, reason: "private", fullName: "private" },
  };
  const network = vi.fn().mockResolvedValue(Response.json(extra));
  expect(
    await new PilotClient(network).farmerCorrectionReceipt(farmerId),
  ).toEqual(receipt);
  expect(String(network.mock.calls[0][0])).toContain(
    "farmers/correction-receipt",
  );
  const response = await createBffHandler(
    config,
    upstream(extra),
  )(req(`id=${farmerId}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(receipt);
});
it("returns no receipt without inventing a successful mutation", async () => {
  const absent = { accountId, farmerId, receipt: null };
  expect(
    await new PilotClient(
      vi.fn().mockResolvedValue(Response.json(absent)),
    ).farmerCorrectionReceipt(farmerId),
  ).toEqual(absent);
  expect(
    await (
      await createBffHandler(config, upstream(absent))(req(`id=${farmerId}`))
    ).json(),
  ).toEqual(absent);
});
it.each([
  { ...receipt, farmerId: accountId },
  { ...receipt, receipt: { ...receipt.receipt, version: 1 } },
  { ...receipt, receipt: { ...receipt.receipt, mutationId: "invalid" } },
])("rejects mismatched or malformed receipts", async (invalid) => {
  await expect(
    new PilotClient(
      vi.fn().mockResolvedValue(Response.json(invalid)),
    ).farmerCorrectionReceipt(farmerId),
  ).rejects.toMatchObject({ status: 503 });
  expect(
    (await createBffHandler(config, upstream(invalid))(req(`id=${farmerId}`)))
      .status,
  ).toBe(503);
});
it("rejects invalid IDs, duplicate parameters and caller scopes", async () => {
  const network = vi.fn();
  await expect(
    new PilotClient(network).farmerCorrectionReceipt("invalid"),
  ).rejects.toMatchObject({ status: 400 });
  expect(network).not.toHaveBeenCalled();
  for (const query of [
    `id=invalid`,
    `id=${farmerId}&id=${farmerId}`,
    `id=${farmerId}&accountId=${accountId}`,
    `id=${farmerId}&scope=all`,
  ]) {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ accessToken: "private" }));
    expect((await createBffHandler(config, fetcher)(req(query))).status).toBe(
      400,
    );
    expect(
      fetcher.mock.calls.every(
        ([url]) => !String(url).includes("correction-receipt"),
      ),
    ).toBe(true);
  }
});
it("cancels receipt reads", async () => {
  let forwarded!: AbortSignal;
  const network = vi
    .fn()
    .mockImplementation((_url: string, init: RequestInit) => {
      forwarded = init.signal as AbortSignal;
      return new Promise((_resolve, reject) =>
        forwarded.addEventListener("abort", () => reject(forwarded.reason), {
          once: true,
        }),
      );
    });
  const controller = new AbortController();
  const pending = expect(
    new PilotClient(network).farmerCorrectionReceipt(
      farmerId,
      controller.signal,
    ),
  ).rejects.toMatchObject({ status: 503 });
  controller.abort();
  await pending;
  expect(forwarded.aborted).toBe(true);
});
