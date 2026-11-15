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
  accountId: z.string().uuid(),
  farmer: farmerSummarySchema,
});
export type FarmerDetail = z.infer<typeof farmerDetailSchema>;
