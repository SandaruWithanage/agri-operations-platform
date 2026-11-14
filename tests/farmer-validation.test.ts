import { describe, expect, it } from "vitest";
import { farmerRegistrationSchema } from "../packages/validation/src";

const minimal = {
  farmerId: "a6c453c7-1b60-4af4-b725-f9d0c9b73ebb",
  fullName: "ගොවි උදාහරණය",
  geographyId: "a94f379b-572c-44d4-b7ec-f0d4a898612c",
  privacyNoticeProvided: true,
};

describe("provisional farmer registration contract", () => {
  it("accepts minimal Sinhala and English names without optional identifiers, land or project", () => {
    expect(farmerRegistrationSchema.safeParse(minimal).success).toBe(true);
    expect(
      farmerRegistrationSchema.safeParse({
        ...minimal,
        fullName: "Example Farmer",
      }).success,
    ).toBe(true);
  });
  it("requires a real UUID for farmer and geography, a name and notice confirmation", () => {
    for (const change of [
      { farmerId: "not-a-uuid" },
      { geographyId: "" },
      { fullName: "  " },
      { privacyNoticeProvided: false },
    ]) {
      expect(
        farmerRegistrationSchema.safeParse({ ...minimal, ...change }).success,
      ).toBe(false);
    }
  });
  it("rejects untrusted creator, status and enrollment fields rather than assigning them from clients", () => {
    for (const change of [
      { creatorId: minimal.farmerId },
      { status: "verified" },
      { projectId: minimal.farmerId },
    ]) {
      expect(
        farmerRegistrationSchema.safeParse({ ...minimal, ...change }).success,
      ).toBe(false);
    }
  });
  it("validates optional identifiers and actual date format", () => {
    expect(
      farmerRegistrationSchema.safeParse({
        ...minimal,
        dateOfBirth: "not-a-date",
      }).success,
    ).toBe(false);
    expect(
      farmerRegistrationSchema.safeParse({
        ...minimal,
        phone: "0710000000",
        dateOfBirth: "2000-01-02",
      }).success,
    ).toBe(true);
  });
});

describe("possible duplicates", () => {
  it("reports matching identity, phone and name in the same geography without merging", async () => {
    const { findDuplicateRisks } = await import("../packages/validation/src");
    const input = {
      ...minimal,
      identityNumber: "abc-123",
      phone: "070 000 0000",
    };
    const candidate = {
      farmerId: "6af9f453-e454-41e2-8c3d-15644dc68628",
      fullName: "  ගොවි   උදාහරණය  ",
      geographyId: minimal.geographyId,
      identityNumber: "ABC123",
      phone: "070-000-0000",
    };
    expect(findDuplicateRisks(input, [candidate])).toEqual([
      {
        farmerId: candidate.farmerId,
        reasons: ["identity", "phone", "name-and-geography"],
      },
    ]);
    expect(candidate.fullName).toContain("  ");
  });
  it("does not match missing identifiers or names in another geography, or match itself", async () => {
    const { findDuplicateRisks } = await import("../packages/validation/src");
    expect(
      findDuplicateRisks(minimal, [
        {
          farmerId: minimal.farmerId,
          fullName: minimal.fullName,
          geographyId: minimal.geographyId,
        },
        {
          farmerId: "test",
          fullName: minimal.fullName,
          geographyId: "another",
          identityNumber: "",
          phone: "",
        },
      ]),
    ).toEqual([]);
  });
});
