import { z } from "zod";
export const farmerListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    after: z.string().uuid().optional(),
  })
  .strict();
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
  status: z.enum(["draft", "pending-review", "verified", "inactive"]),
  createdAt: z.string().datetime(),
});
export const farmerPageSchema = z.object({
  accountId: z.string().uuid(),
  items: z.array(farmerSummarySchema).max(100),
  nextCursor: z.string().uuid().nullable(),
});
export type FarmerSummary = z.infer<typeof farmerSummarySchema>;
export type FarmerPage = z.infer<typeof farmerPageSchema>;

export const farmerDetailSchema = z.object({
  access: z.object({ viewAudit: z.boolean() }).optional(),
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
