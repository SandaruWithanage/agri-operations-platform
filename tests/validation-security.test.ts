// @vitest-environment node
import { expect, it } from "vitest";
import {
  farmerRegistrationSchema,
  farmerCorrectionGeographiesSchema,
  offlineReferenceContextSchema,
  workingRegistrationSchema,
} from "../packages/validation/src";
const id = "12345678-1234-0123-0123-123456789abc";
it("preserves previously accepted PostgreSQL UUID formats across core and durable draft validators", () => {
  const record = {
    farmerId: id,
    fullName: "Synthetic preserved draft",
    geographyId: id,
    privacyNoticeProvided: true,
  };
  expect(farmerRegistrationSchema.parse(record)).toEqual(record);
  expect(
    workingRegistrationSchema.parse({
      ...record,
      geographyId: "",
      privacyNoticeProvided: false,
    }),
  ).toMatchObject({ farmerId: id, geographyId: "" });
  for (const invalid of ["not-an-id", id + "x", id.slice(1)])
    expect(
      farmerRegistrationSchema.safeParse({ ...record, farmerId: invalid })
        .success,
    ).toBe(false);
  expect(
    farmerRegistrationSchema.safeParse({ ...record, accountId: id }).success,
  ).toBe(false);
});
it("rejects oversized invalid configured collections before producing per-item issue floods", () => {
  const result = offlineReferenceContextSchema.safeParse({
    accountId: id,
    deviceId: id,
    deviceKeyFingerprint: "a".repeat(64),
    verifiedAt: 1,
    offlineUntil: 60001,
    geographies: Array(10001).fill(null),
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues.length).toBeLessThan(10);
    expect(result.error.issues.some((issue) => issue.code === "too_big")).toBe(
      true,
    );
  }
});
it("retains bounded correction pages and excludes private reply fields", () => {
  const page = {
    accountId: id,
    farmerId: id,
    farmerVersion: 1,
    sourceGeographyId: id,
    geographies: [{ id, name: "Synthetic village", internal: "private" }],
    nextCursor: null,
    sessionId: "private",
  };
  const result = farmerCorrectionGeographiesSchema.parse(page);
  expect(result.geographies).toEqual([{ id, name: "Synthetic village" }]);
  expect("sessionId" in result).toBe(false);
});
