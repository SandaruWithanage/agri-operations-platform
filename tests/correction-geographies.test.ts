// @vitest-environment node
import { expect, it, vi } from "vitest";
import { PilotClient } from "../packages/sync-client/src";
import { createBffHandler } from "../packages/auth-bff/src";
const farmerId = "06149451-4004-4a23-a5a2-64a24e485a82";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const geographyId = "c8a85c92-740b-48d5-99d0-1cda6c4cd31c";
const page = {
  accountId,
  farmerId,
  farmerVersion: 2,
  sourceGeographyId: geographyId,
  geographies: [{ id: geographyId, name: "Synthetic configured village" }],
  nextCursor: null,
};
const config = {
  apiOrigin: "https://api.example.test",
  publicOrigin: "https://admin.example.test",
  internalKey: "synthetic-internal-key-with-at-least-43-characters",
  source: "administrator" as const,
};
function request(query: string) {
  return new Request(
    `${config.publicOrigin}/api/pilot/farmers/correction-geographies?${query}`,
    {
      headers: { cookie: `__Host-agri_session=${"A".repeat(43)}` },
    },
  );
}
it("returns bounded record-bound choices and strips private upstream extras", async () => {
  const network = vi.fn().mockResolvedValue(
    Response.json({
      ...page,
      sessionId: "private",
      geographies: [{ ...page.geographies[0], internal: "private" }],
    }),
  );
  expect(
    await new PilotClient(network).farmerCorrectionGeographies(farmerId),
  ).toEqual(page);
  expect(String(network.mock.calls[0][0])).toContain("limit=50");
  const upstream = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "private" }))
    .mockResolvedValueOnce(Response.json({ ...page, sessionId: "private" }));
  const response = await createBffHandler(
    config,
    upstream,
  )(request(`id=${farmerId}&limit=1`));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(page);
});
it("rejects invalid client IDs and cursors before fetching", async () => {
  const network = vi.fn();
  const api = new PilotClient(network);
  await expect(
    api.farmerCorrectionGeographies("invalid"),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    api.farmerCorrectionGeographies(farmerId, "invalid"),
  ).rejects.toMatchObject({ status: 400 });
  expect(network).not.toHaveBeenCalled();
});
it.each([
  `id=${farmerId}&limit=101`,
  `id=${farmerId}&limit=0`,
  `id=${farmerId}&accountId=${accountId}`,
  `id=${farmerId}&id=${farmerId}`,
  `id=${farmerId}&after=invalid`,
])(
  "rejects invalid BFF query %s before forwarding domain reads",
  async (query) => {
    const upstream = vi
      .fn()
      .mockResolvedValue(Response.json({ accessToken: "private" }));
    expect(
      (await createBffHandler(config, upstream)(request(query))).status,
    ).toBe(400);
    expect(
      upstream.mock.calls.every(
        ([url]) => !String(url).includes("correction-geographies"),
      ),
    ).toBe(true);
  },
);
it.each([
  { ...page, farmerId: accountId },
  { ...page, nextCursor: accountId },
  { ...page, geographies: [page.geographies[0], page.geographies[0]] },
  { ...page, farmerVersion: 0 },
])(
  "rejects malformed or mismatched replies in both transports",
  async (invalid) => {
    await expect(
      new PilotClient(
        vi.fn().mockResolvedValue(Response.json(invalid)),
      ).farmerCorrectionGeographies(farmerId),
    ).rejects.toMatchObject({ status: 503 });
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ accessToken: "private" }))
      .mockResolvedValueOnce(Response.json(invalid));
    expect(
      (await createBffHandler(config, upstream)(request(`id=${farmerId}`)))
        .status,
    ).toBe(503);
  },
);
it("enforces the requested BFF page size", async () => {
  const invalid = {
    ...page,
    geographies: [
      ...page.geographies,
      { id: accountId, name: "Synthetic second village" },
    ],
  };
  const upstream = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "private" }))
    .mockResolvedValueOnce(Response.json(invalid));
  expect(
    (
      await createBffHandler(
        config,
        upstream,
      )(request(`id=${farmerId}&limit=1`))
    ).status,
  ).toBe(503);
});
it("propagates cancellation to the fetch boundary", async () => {
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
    new PilotClient(network).farmerCorrectionGeographies(
      farmerId,
      undefined,
      controller.signal,
    ),
  ).rejects.toMatchObject({ status: 503 });
  controller.abort();
  await pending;
  expect(forwarded.aborted).toBe(true);
});
