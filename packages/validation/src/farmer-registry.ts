import { z } from "zod";
import { farmerStatusSchema } from "./farmer";
const filterFields = {
  status: farmerStatusSchema.optional(),
  reviewable: z.literal("true").optional(),
};
const compatibleReview = (value: { status?: string; reviewable?: string }) =>
  value.reviewable !== "true" ||
  value.status === undefined ||
  value.status === "pending-review";
export const farmerListFiltersSchema = z
  .object(filterFields)
  .strict()
  .refine(compatibleReview, "Reviewable records must be Pending Review");
export type FarmerListFilters = z.infer<typeof farmerListFiltersSchema>;
export function sameFarmerFilters(
  expected: FarmerListFilters,
  actual: FarmerListFilters = {},
) {
  return (
    expected.status === actual.status &&
    expected.reviewable === actual.reviewable
  );
}
export const farmerListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    after: z.string().uuid().optional(),
    ...filterFields,
  })
  .strict()
  .refine(compatibleReview, "Reviewable records must be Pending Review");
export const farmerDetailQuerySchema = z
  .object({ id: z.string().uuid() })
  .strict();
/** Explicit public projection. Unknown server fields are stripped at the BFF/browser boundary. */
export const farmerSummarySchema = z.object({
  duplicateRisk: z.boolean(),
  version: z.number().int().positive().max(2147483647),
  id: z.string().uuid(),
  fullName: z.string().min(1).max(200),
  geographyId: z.string().uuid(),
  geographyName: z.string().min(1).max(1000),
  status: farmerStatusSchema,
  createdAt: z.string().datetime(),
});
export const farmerPageSchema = z
  .object({
    filters: farmerListFiltersSchema.optional(),
    accountId: z.string().uuid(),
    items: z.array(farmerSummarySchema).max(100),
    nextCursor: z.string().uuid().nullable(),
  })
  .superRefine((page, context) => {
    if (
      page.items.some(
        (item) =>
          (page.filters?.status && item.status !== page.filters.status) ||
          (page.filters?.reviewable === "true" &&
            item.status !== "pending-review"),
      )
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Page does not match its filters",
        path: ["items"],
      });
  });
export type FarmerSummary = z.infer<typeof farmerSummarySchema>;
export type FarmerPage = z.infer<typeof farmerPageSchema>;

export const farmerDetailSchema = z.object({
  access: z
    .object({
      viewAudit: z.boolean(),
      verify: z.boolean().optional(),
      correct: z.boolean().optional(),
    })
    .optional(),
  accountId: z.string().uuid(),
  farmer: farmerSummarySchema,
});
export type FarmerDetail = z.infer<typeof farmerDetailSchema>;

export const farmerChangeSchema = z.discriminatedUnion("action", [
  z
    .object({
      mutationId: z.string().uuid(),
      farmerId: z.string().uuid(),
      expectedVersion: z.number().int().positive().max(2147483646),
      action: z.literal("verification"),
      reason: z.string().trim().min(8).max(500),
    })
    .strict(),
  z
    .object({
      mutationId: z.string().uuid(),
      farmerId: z.string().uuid(),
      expectedVersion: z.number().int().positive().max(2147483646),
      action: z.literal("correction"),
      fullName: z.string().trim().min(1).max(200),
      geographyId: z.string().uuid(),
      reason: z.string().trim().min(8).max(500),
    })
    .strict(),
]);
export const farmerChangeResultSchema = z.object({
  farmerId: z.string().uuid(),
  version: z.number().int().positive().max(2147483647),
  replayed: z.boolean(),
  duplicateRisk: z.boolean(),
});
export type FarmerChange = z.infer<typeof farmerChangeSchema>;
export type FarmerChangeResult = z.infer<typeof farmerChangeResultSchema>;

export const farmerVerificationReceiptSchema = z.object({
  accountId: z.string().uuid(),
  farmerId: z.string().uuid(),
  receipt: z
    .object({
      mutationId: z.string().uuid(),
      version: z.number().int().min(2).max(2147483647),
      occurredAt: z.string().datetime(),
    })
    .nullable(),
});
export type FarmerVerificationReceipt = z.infer<
  typeof farmerVerificationReceiptSchema
>;

export const farmerCorrectionGeographiesQuerySchema = z
  .object({
    id: z.string().uuid(),
    after: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const farmerCorrectionGeographiesSchema = z
  .object({
    accountId: z.string().uuid(),
    farmerId: z.string().uuid(),
    farmerVersion: z.number().int().positive().max(2147483647),
    sourceGeographyId: z.string().uuid(),
    geographies: z
      .array(
        z.object({ id: z.string().uuid(), name: z.string().min(1).max(1000) }),
      )
      .max(100),
    nextCursor: z.string().uuid().nullable(),
  })
  .superRefine((page, context) => {
    if (
      new Set(page.geographies.map((item) => item.id)).size !==
        page.geographies.length ||
      (page.nextCursor !== null &&
        page.geographies[page.geographies.length - 1]?.id !== page.nextCursor)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid correction choices page",
      });
  });
export type FarmerCorrectionGeographies = z.infer<
  typeof farmerCorrectionGeographiesSchema
>;

// The receipt shape is shared; each endpoint enforces its own action permission.
export const farmerCorrectionReceiptSchema = farmerVerificationReceiptSchema;
export type FarmerCorrectionReceipt = z.infer<
  typeof farmerCorrectionReceiptSchema
>;
