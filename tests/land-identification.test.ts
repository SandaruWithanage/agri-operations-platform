// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  landRegistrationSchema,
  landPointSchema,
} from "../packages/validation/src";
import { PilotClient } from "../packages/sync-client/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  landId = "06149451-4004-4a23-a5a2-64a24e485a82",
  geo = "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9";
const input = {
  mutationId: "c8a85c92-740b-48d5-99d0-1cda6c4cd31c",
  landId,
  geographyId: geo,
};
const csrfToken = `${"B".repeat(43)}.${"C".repeat(43)}`;
it("accepts an identification without GPS, label, area, farmer or ownership assumptions", () => {
  expect(landRegistrationSchema.parse(input)).toEqual({
    ...input,
    label: null,
    point: null,
    reportedAreaHectares: null,
  });
  expect(
    landRegistrationSchema.parse({
      ...input,
      label: " කෘත්‍රිම ඉඩම ",
      point: { longitude: 0, latitude: 0, accuracyM: 0 },
      reportedAreaHectares: 0,
    }),
  ).toMatchObject({
    label: "කෘත්‍රිම ඉඩම",
    point: { longitude: 0, latitude: 0, accuracyM: 0 },
    reportedAreaHectares: 0,
  });
});
it("validates finite WGS84 points and measured-accuracy metadata without deriving acreage", () => {
  expect(landPointSchema.parse({ longitude: 180, latitude: 90 })).toEqual({
    longitude: 180,
    latitude: 90,
    accuracyM: null,
  });
  for (const point of [
    { longitude: 181, latitude: 0 },
    { longitude: 0, latitude: -91 },
    { longitude: NaN, latitude: 0 },
    { longitude: 0, latitude: Infinity },
    { longitude: 0, latitude: 0, accuracyM: -1 },
    { longitude: 0, latitude: 0, altitude: 10 },
  ])
    expect(landPointSchema.safeParse(point).success).toBe(false);
});
it("rejects client authority, unimplemented associations and legal/survey fields", () => {
  for (const extra of [
    { organizationId: accountId },
    { createdBy: accountId },
    { farmerId: accountId },
    { ownerId: accountId },
    { surveyVerified: true },
    {
      boundary: [
        [80, 8],
        [81, 8],
        [80, 8],
      ],
    },
  ])
    expect(
      landRegistrationSchema.safeParse({ ...input, ...extra }).success,
    ).toBe(false);
});
it("bounds reported area storage precision without accepting invalid numbers", () => {
  for (const area of [-1, NaN, Infinity, 100000000, 0.00001])
    expect(
      landRegistrationSchema.safeParse({ ...input, reportedAreaHectares: area })
        .success,
    ).toBe(false);
  expect(
    landRegistrationSchema.parse({ ...input, reportedAreaHectares: 0.125 })
      .reportedAreaHectares,
  ).toBe(0.125);
});
it("retries an ambiguous land submission with exactly the original identifiers and normalized payload", async () => {
  const sent: unknown[] = [];
  const network = vi
    .fn()
    .mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.endsWith("auth/csrf"))
        return Response.json({ accountId, csrfToken });
      sent.push(JSON.parse(String(options?.body)));
      if (sent.length === 1) throw new Error("Synthetic lost land response");
      return Response.json({ status: "synced", landId, replayed: true });
    });
  const client = new PilotClient(network);
  await expect(client.registerLand(accountId, input)).rejects.toMatchObject({
    status: 503,
  });
  expect(await client.registerLand(accountId, input)).toEqual({
    status: "synced",
    landId,
    replayed: true,
  });
  expect(sent).toEqual([
    landRegistrationSchema.parse(input),
    landRegistrationSchema.parse(input),
  ]);
});
it("does not submit a land registration under another account session", async () => {
  const network = vi
    .fn()
    .mockResolvedValue(Response.json({ accountId: landId, csrfToken }));
  await expect(
    new PilotClient(network).registerLand(accountId, input),
  ).rejects.toMatchObject({ status: 401 });
  expect(network).toHaveBeenCalledOnce();
});
it("does not acknowledge another land identifier or expose an inconsistent detail", async () => {
  const network = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accountId, csrfToken }))
    .mockResolvedValueOnce(
      Response.json({ status: "synced", landId: accountId, replayed: false }),
    );
  await expect(
    new PilotClient(network).registerLand(accountId, input),
  ).rejects.toMatchObject({ status: 503 });
  const detail = vi.fn().mockResolvedValue(
    Response.json({
      accountId,
      land: {
        id: accountId,
        geographyId: geo,
        geographyName: "Synthetic village",
        label: null,
        point: null,
        reportedAreaHectares: null,
        version: 1,
        createdAt: "2026-11-15T00:00:00.000Z",
        identificationOnly: true,
      },
    }),
  );
  await expect(
    new PilotClient(detail).landIdentification(landId),
  ).rejects.toMatchObject({ status: 503 });
});

it.each(["list", "detail"] as const)(
  "cancels the %s land transport at fetch",
  async (kind) => {
    let sent!: AbortSignal;
    const network = vi
      .fn()
      .mockImplementation((_path: string, input: RequestInit) => {
        sent = input.signal as AbortSignal;
        return new Promise((_resolve, reject) =>
          sent.addEventListener("abort", () => reject(sent.reason), {
            once: true,
          }),
        );
      });
    const client = new PilotClient(network),
      controller = new AbortController();
    const result =
      kind === "list"
        ? client.land(undefined, controller.signal)
        : client.landIdentification(landId, controller.signal);
    const pending = expect(result).rejects.toMatchObject({ status: 503 });
    controller.abort();
    await pending;
    expect(sent.aborted).toBe(true);
    expect(network).toHaveBeenCalledOnce();
  },
);

it("binds a retained land submission to its original approved device before posting", async () => {
  const deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
  for (const sessionDevice of [undefined, landId]) {
    const network = vi
      .fn()
      .mockResolvedValue(
        Response.json({ accountId, csrfToken, deviceId: sessionDevice }),
      );
    await expect(
      new PilotClient(network).registerLand(accountId, input, deviceId),
    ).rejects.toMatchObject({ status: 401 });
    expect(network).toHaveBeenCalledOnce();
  }
  for (const invalid of ["invalid", ""]) {
    const network = vi.fn();
    await expect(
      new PilotClient(network).registerLand(accountId, input, invalid),
    ).rejects.toMatchObject({ status: 400 });
    expect(network).not.toHaveBeenCalled();
  }
});
it("cancels the land-create catalog fetch", async () => {
  const controller = new AbortController();
  let sent!: AbortSignal;
  const network = vi
    .fn()
    .mockImplementation((_path: string, options: RequestInit) => {
      sent = options.signal as AbortSignal;
      return new Promise((_resolve, reject) =>
        sent.addEventListener("abort", () => reject(sent.reason), {
          once: true,
        }),
      );
    });
  const pending = expect(
    new PilotClient(network).landGeographies(controller.signal),
  ).rejects.toMatchObject({ status: 503 });
  controller.abort();
  await pending;
  expect(sent.aborted).toBe(true);
});
const geometry = {
  mutationId: input.mutationId,
  landId,
  expectedVersion: 0,
  ring: [
    [80.2, 8.3],
    [80.201, 8.3],
    [80.201, 8.301],
    [80.2, 8.3],
  ],
  source: "gps_walk" as const,
};
it("records provisional geometry only under the matching account session and binds the result to the land", async () => {
  const wrongAccount = vi
    .fn()
    .mockResolvedValue(Response.json({ accountId: landId, csrfToken }));
  await expect(
    new PilotClient(wrongAccount).recordLandGeometry(accountId, geometry),
  ).rejects.toMatchObject({ status: 401 });
  expect(wrongAccount).toHaveBeenCalledOnce();
  await expect(
    new PilotClient(vi.fn()).recordLandGeometry(accountId, {
      ...geometry,
      source: "official_survey",
    } as never),
  ).rejects.toThrow();
  const result = {
    status: "synced",
    landId,
    version: 1,
    calculatedAreaM2: 12000.5,
    replayed: false,
  };
  const ok = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accountId, csrfToken }))
    .mockResolvedValueOnce(Response.json(result));
  expect(
    await new PilotClient(ok).recordLandGeometry(accountId, geometry),
  ).toEqual(result);
  const other = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accountId, csrfToken }))
    .mockResolvedValueOnce(Response.json({ ...result, landId: accountId }));
  await expect(
    new PilotClient(other).recordLandGeometry(accountId, geometry),
  ).rejects.toMatchObject({ status: 503 });
});
it("reads geometry for the requested land only and rejects malformed identifiers", async () => {
  await expect(
    new PilotClient(vi.fn()).landGeometry("not-a-uuid"),
  ).rejects.toMatchObject({ status: 400 });
  const wrong = vi.fn().mockResolvedValue(
    Response.json({
      accountId,
      landId: accountId,
      current: null,
      history: [],
    }),
  );
  await expect(
    new PilotClient(wrong).landGeometry(landId),
  ).rejects.toMatchObject({ status: 503 });
  const ok = vi
    .fn()
    .mockResolvedValue(
      Response.json({ accountId, landId, current: null, history: [] }),
    );
  expect(await new PilotClient(ok).landGeometry(landId, true)).toEqual({
    accountId,
    landId,
    current: null,
    history: [],
  });
  expect(String(ok.mock.calls[0][0])).toContain(
    `land/geometry?landId=${landId}&history=true`,
  );
});
