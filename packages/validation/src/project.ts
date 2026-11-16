import { z } from "zod";
const uuid = z.guid().transform((value) => value.toLowerCase());
export const projectRegistrationSchema = z
  .object({
    mutationId: uuid,
    projectId: uuid,
    organizationId: uuid,
    name: z.string().trim().min(1).max(200),
    active: z.boolean().default(false),
  })
  .strict();
export const projectQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    after: uuid.optional(),
  })
  .strict();
export const projectDetailQuerySchema = z.object({ id: uuid }).strict();
export const projectSummarySchema = z.object({
  id: uuid,
  organizationId: uuid,
  organizationName: z.string().min(1).max(1000),
  name: z.string().min(1).max(200),
  active: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
});
export const projectPageSchema = z.object({
  accountId: uuid,
  items: z.array(projectSummarySchema).max(100),
  nextCursor: uuid.nullable(),
});
export const projectDetailSchema = z.object({
  accountId: uuid,
  project: projectSummarySchema,
});
export const projectRegistrationResultSchema = z.object({
  status: z.literal("synced"),
  projectId: uuid,
  replayed: z.boolean(),
});
export const projectOrganizationsSchema = z.object({
  accountId: uuid,
  organizations: z
    .array(z.object({ id: uuid, name: z.string().min(1).max(1000) }))
    .max(10000),
});
export type ProjectRegistration = z.input<typeof projectRegistrationSchema>;
export type ProjectPage = z.infer<typeof projectPageSchema>;
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type ProjectRegistrationResult = z.infer<
  typeof projectRegistrationResultSchema
>;
export type ProjectOrganizations = z.infer<typeof projectOrganizationsSchema>;

export const projectOrganizationsQuerySchema = z.object({}).strict();
