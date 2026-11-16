import { z } from "zod";
const uuid = z.guid().transform((value) => value.toLowerCase());
/** Provisional explicit farmer/project enrollment contracts (ADR 0019, DEC-04 open). */
export const enrollmentCreateSchema = z
  .object({
    mutationId: uuid,
    enrollmentId: uuid,
    projectId: uuid,
    farmerId: uuid,
  })
  .strict();
export const enrollmentWithdrawSchema = z
  .object({
    mutationId: uuid,
    enrollmentId: uuid,
    expectedVersion: z.number().int().min(1).max(2147483645),
  })
  .strict();
export const enrollmentQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    after: uuid.optional(),
    projectId: uuid.optional(),
    farmerId: uuid.optional(),
    status: z.enum(["enrolled", "withdrawn"]).optional(),
  })
  .strict();
export const enrollmentDetailQuerySchema = z.object({ id: uuid }).strict();
export const enrollmentSummarySchema = z.object({
  id: uuid,
  organizationId: uuid,
  projectId: uuid,
  farmerId: uuid,
  status: z.enum(["enrolled", "withdrawn"]),
  version: z.number().int().positive(),
  enrolledAt: z.string().datetime(),
  withdrawnAt: z.string().datetime().nullable(),
});
export const enrollmentPageSchema = z.object({
  accountId: uuid,
  items: z.array(enrollmentSummarySchema).max(100),
  nextCursor: uuid.nullable(),
});
export const enrollmentDetailSchema = z.object({
  accountId: uuid,
  enrollment: enrollmentSummarySchema,
});
export const enrollmentResultSchema = z.object({
  enrollmentId: uuid,
  version: z.number().int().positive(),
  replayed: z.boolean(),
});
export type EnrollmentCreate = z.input<typeof enrollmentCreateSchema>;
export type EnrollmentWithdraw = z.input<typeof enrollmentWithdrawSchema>;
export type EnrollmentPage = z.infer<typeof enrollmentPageSchema>;
export type EnrollmentDetail = z.infer<typeof enrollmentDetailSchema>;
export type EnrollmentResult = z.infer<typeof enrollmentResultSchema>;
