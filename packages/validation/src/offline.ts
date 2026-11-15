import { z } from "zod";
export const workingRegistrationSchema = z
  .object({
    farmerId: z.string().uuid(),
    fullName: z.string().max(200),
    geographyId: z.union([z.string().uuid(), z.literal("")]),
    privacyNoticeProvided: z.boolean(),
  })
  .strict();
export type WorkingRegistration = z.infer<typeof workingRegistrationSchema>;
/** A cached drafting context, never a credential accepted by server endpoints. */
export const offlineReferenceContextSchema = z
  .object({
    accountId: z.string().uuid(),
    deviceId: z.string().uuid(),
    deviceKeyFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    verifiedAt: z.number().int().positive(),
    offlineUntil: z.number().int().positive(),
    geographies: z
      .array(
        z
          .object({ id: z.string().uuid(), label: z.string().min(1).max(1000) })
          .strict(),
      )
      .max(10000),
  })
  .strict()
  .refine(
    (value) =>
      value.offlineUntil > value.verifiedAt &&
      value.offlineUntil - value.verifiedAt <= 86_400_000,
    "Invalid offline drafting window",
  );
export type OfflineReferenceContext = z.infer<
  typeof offlineReferenceContextSchema
>;
