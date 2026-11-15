// @vitest-environment node
import { expect, it, vi } from "vitest";
import { PilotClient } from "../packages/sync-client/src";
import {
  farmerHistoryQuerySchema,
  farmerHistoryPageSchema,
} from "../packages/validation/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  farmerId = "06149451-4004-4a23-a5a2-64a24e485a82";
const cursor = {
  beforeTime: "2026-11-15T12:00:00.123457Z",
  beforeId: "1d1ebede-c4a3-4d34-a6f5-5962cc403d0b",
};
it("preserves the full timestamp cursor and never returns non-public history fields", async () => {
  const event = {
    eventId: cursor.beforeId,
    actorAccountId: accountId,
    occurredAt: cursor.beforeTime,
    action: "registration",
    change: null,
  };
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      accountId,
      farmerId,
      items: [{ ...event, sessionId: "synthetic-private-extra" }],
      nextCursor: null,
    }),
  );
  expect(
    await new PilotClient(fetcher).farmerHistory(farmerId, cursor),
  ).toEqual({ accountId, farmerId, items: [event], nextCursor: null });
  const [url, options] = fetcher.mock.calls[0];
  expect(
    new URL(String(url), "https://admin.example.test").searchParams.get(
      "beforeTime",
    ),
  ).toBe(cursor.beforeTime);
  expect(options.credentials).toBe("same-origin");
  expect(options.cache).toBe("no-store");
});
it("rejects incomplete/untrusted scope cursors and bounded-query violations", () => {
  for (const value of [
    { id: farmerId, beforeTime: cursor.beforeTime },
    { id: farmerId, beforeId: cursor.beforeId },
    { id: farmerId, limit: 101 },
    { id: farmerId, accountId },
    { id: farmerId, beforeTime: "invalid", beforeId: cursor.beforeId },
  ])
    expect(farmerHistoryQuerySchema.safeParse(value).success).toBe(false);
});
it("rejects history belonging to a different farmer or inconsistent change revisions", async () => {
  const wrongFarmer = vi.fn().mockResolvedValue(
    Response.json({
      accountId,
      farmerId: accountId,
      items: [],
      nextCursor: null,
    }),
  );
  await expect(
    new PilotClient(wrongFarmer).farmerHistory(farmerId),
  ).rejects.toMatchObject({ status: 503 });
  const malformed = vi.fn().mockResolvedValue(
    Response.json({
      accountId,
      farmerId,
      items: [
        {
          eventId: cursor.beforeId,
          actorAccountId: accountId,
          occurredAt: cursor.beforeTime,
          action: "correction",
          change: null,
        },
      ],
      nextCursor: null,
    }),
  );
  await expect(
    new PilotClient(malformed).farmerHistory(farmerId),
  ).rejects.toMatchObject({ status: 503 });
});

it("rejects cursor metadata that could skip/repeat events", () => {
  const event = {
    eventId: cursor.beforeId,
    actorAccountId: accountId,
    occurredAt: cursor.beforeTime,
    action: "registration",
    change: null,
  };
  for (const page of [
    { accountId, farmerId, items: [], nextCursor: cursor },
    {
      accountId,
      farmerId,
      items: [event],
      nextCursor: { ...cursor, beforeId: farmerId },
    },
    { accountId, farmerId, items: [event, event], nextCursor: null },
  ])
    expect(farmerHistoryPageSchema.safeParse(page).success).toBe(false);
});
