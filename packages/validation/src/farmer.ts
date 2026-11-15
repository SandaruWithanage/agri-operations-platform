import { z } from "zod";

/** Provisional pilot core. Server must independently validate and authorize all values. */
const optionalText = (max: number) => z.string().trim().max(max).optional();
const identifier = z.guid();

export const farmerRegistrationSchema = z
  .object({
    farmerId: identifier,
    fullName: z.string().trim().min(1).max(200),
    geographyId: identifier,
    privacyNoticeProvided: z.literal(true),
    identityNumber: optionalText(80),
    phone: optionalText(40),
    alternateContact: optionalText(200),
    address: optionalText(500),
    dateOfBirth: z.string().date().optional(),
    preferredLanguage: z.enum(["en", "si"]).optional(),
    cboId: identifier.optional(),
  })
  .strict();

export type FarmerRegistration = z.infer<typeof farmerRegistrationSchema>;
export const farmerStatusSchema = z.enum([
  "draft",
  "pending-review",
  "verified",
  "inactive",
]);
export type FarmerStatus = z.infer<typeof farmerStatusSchema>;

/** Signals possible duplicates only; never grants access or merges records. */
export type DuplicateCandidate = {
  farmerId: string;
  fullName: string;
  geographyId: string;
  identityNumber?: string | null;
  phone?: string | null;
};
export type DuplicateRisk = {
  farmerId: string;
  reasons: Array<"identity" | "phone" | "name-and-geography">;
};
const normalizeName = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
const normalizeIdentifier = (value?: string | null) =>
  value?.normalize("NFKC").replace(/[\s-]/gu, "").toUpperCase() ?? "";
const normalizePhone = (value?: string | null) =>
  value?.replace(/[\s()-]/gu, "") ?? "";

/** Compare only against records the server is permitted to inspect; returning matches requires separate disclosure authorization. */
export function findDuplicateRisks(
  input: FarmerRegistration,
  candidates: readonly DuplicateCandidate[],
): DuplicateRisk[] {
  const inputName = normalizeName(input.fullName);
  const inputIdentity = normalizeIdentifier(input.identityNumber);
  const inputPhone = normalizePhone(input.phone);
  const risks: DuplicateRisk[] = [];
  for (const candidate of candidates) {
    if (candidate.farmerId === input.farmerId) continue;
    const reasons: DuplicateRisk["reasons"] = [];
    if (
      inputIdentity &&
      inputIdentity === normalizeIdentifier(candidate.identityNumber)
    )
      reasons.push("identity");
    if (inputPhone && inputPhone === normalizePhone(candidate.phone))
      reasons.push("phone");
    if (
      inputName &&
      inputName === normalizeName(candidate.fullName) &&
      input.geographyId === candidate.geographyId
    )
      reasons.push("name-and-geography");
    if (reasons.length) risks.push({ farmerId: candidate.farmerId, reasons });
  }
  return risks;
}
