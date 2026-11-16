import { z } from "zod";
import { farmerStatusSchema } from "./farmer.ts";
const uuid = z.guid().transform((value) => value.toLowerCase());
const statuses = z
  .array(farmerStatusSchema)
  .min(1)
  .max(16)
  .refine((list) => new Set(list).size === list.length);
/**
 * Per-project enrollment policy administration (PRJ-03B). Enrollment is default-deny; these contracts carry
 * only the administrator's chosen data. expectedVersion 0 creates the first policy; no client rule is encoded.
 */
export const enrollmentPolicySetSchema = z
  .object({
    mutationId: uuid,
    projectId: uuid,
    expectedVersion: z.number().int().min(0).max(2147483645),
    enabled: z.boolean(),
    eligibleFarmerStatuses: statuses,
  })
  .strict();
export const enrollmentPolicyQuerySchema = z
  .object({ projectId: uuid })
  .strict();
export const enrollmentPolicySchema = z.object({
  projectId: uuid,
  enabled: z.boolean(),
  eligibleFarmerStatuses: statuses,
  version: z.number().int().positive(),
});
export const enrollmentPolicyDetailSchema = z.object({
  accountId: uuid,
  projectId: uuid,
  /** null means no policy exists yet: enrollment is denied for this project. */
  policy: enrollmentPolicySchema.nullable(),
});
export const enrollmentPolicyResultSchema = z.object({
  projectId: uuid,
  version: z.number().int().positive(),
  replayed: z.boolean(),
});
export type EnrollmentPolicySet = z.input<typeof enrollmentPolicySetSchema>;
export type EnrollmentPolicyDetail = z.infer<
  typeof enrollmentPolicyDetailSchema
>;
export type EnrollmentPolicyResult = z.infer<
  typeof enrollmentPolicyResultSchema
>;
