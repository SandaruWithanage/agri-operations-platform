// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  farmerListQuerySchema,
  sameFarmerFilters,
} from "../packages/validation/src";
import { PilotClient } from "../packages/sync-client/src";
import {
  readReviewFilters,
  reviewFilterUrl,
} from "../apps/admin-web/lib/review-filters";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
it("accepts the four states and rejects authority inputs or contradictory review filters", () => {
  for (const status of ["draft", "pending-review", "verified", "inactive"])
    expect(farmerListQuerySchema.safeParse({ status }).success).toBe(true);
  expect(farmerListQuerySchema.parse({ reviewable: "true" })).toEqual({
    limit: 25,
    reviewable: "true",
  });
  for (const query of [
    { reviewable: "false" },
    { status: "deleted" },
    { reviewable: "true", status: "verified" },
    { actorId: accountId },
    { permission: "farmer.verify" },
    { status: ["draft", "verified"] },
  ])
    expect(farmerListQuerySchema.safeParse(query).success).toBe(false);
});
it("round-trips only enum review selections in a shareable view", () => {
  const url = new URL("https://admin.example.test/?existing=value#section");
  const target = reviewFilterUrl(url, {
    status: "pending-review",
    reviewable: "true",
  });
  expect(target).toBe(
    "/?existing=value&farmerStatus=pending-review&reviewable=true#section",
  );
  expect(readReviewFilters(new URL(target, url))).toEqual({
    status: "pending-review",
    reviewable: "true",
  });
  expect(
    readReviewFilters(new URL("https://admin.example.test/?reviewable=true")),
  ).toEqual({ status: "pending-review", reviewable: "true" });
  expect(reviewFilterUrl(new URL(target, url), {})).toBe(
    "/?existing=value#section",
  );
  for (const query of [
    "farmerStatus=bad",
    "reviewable=false",
    "farmerStatus=draft&reviewable=true",
    "farmerStatus=draft&farmerStatus=verified",
  ])
    expect(
      readReviewFilters(new URL(`https://admin.example.test/?${query}`)),
    ).toBeNull();
});
it("binds a filtered SDK page to the request instead of accepting silently unfiltered results", async () => {
  const filters = {
    status: "pending-review" as const,
    reviewable: "true" as const,
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ accountId, filters, items: [], nextCursor: null }),
    )
    .mockResolvedValueOnce(
      Response.json({ accountId, items: [], nextCursor: null }),
    );
  const client = new PilotClient(fetcher);
  expect((await client.farmers(undefined, undefined, filters)).filters).toEqual(
    filters,
  );
  const url = new URL(
    String(fetcher.mock.calls[0][0]),
    "https://admin.example.test",
  );
  expect(url.searchParams.get("status")).toBe("pending-review");
  expect(url.searchParams.get("reviewable")).toBe("true");
  await expect(
    client.farmers(undefined, undefined, filters),
  ).rejects.toMatchObject({ status: 503 });
  expect(sameFarmerFilters({}, undefined)).toBe(true);
});
it("rejects malformed filters before sending a request", async () => {
  const fetcher = vi.fn();
  await expect(
    new PilotClient(fetcher).farmers(undefined, undefined, {
      status: "verified",
      reviewable: "true",
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    new PilotClient(fetcher).farmers(undefined, undefined, {
      limit: 1,
    } as never),
  ).rejects.toMatchObject({ status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects rows that contradict the server's echoed status selection", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      accountId,
      filters: { status: "pending-review" },
      items: [
        {
          id: accountId,
          fullName: "Synthetic wrong state",
          geographyId: accountId,
          geographyName: "Synthetic village",
          status: "verified",
          createdAt: "2026-11-15T20:00:00.000Z",
          version: 2,
          duplicateRisk: false,
        },
      ],
      nextCursor: null,
    }),
  );
  await expect(
    new PilotClient(fetcher).farmers(undefined, undefined, {
      status: "pending-review",
    }),
  ).rejects.toMatchObject({ status: 503 });
});

it("omits undefined optional filter values from requests", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ accountId, items: [], nextCursor: null }),
    );
  await new PilotClient(fetcher).farmers(undefined, undefined, {
    status: undefined,
    reviewable: undefined,
  });
  expect(String(fetcher.mock.calls[0][0])).toBe("/api/pilot/farmers?limit=25");
});
