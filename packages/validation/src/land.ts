import { z } from "zod";
export const landPointSchema = z
  .object({
    longitude: z.number().finite().min(-180).max(180),
    latitude: z.number().finite().min(-90).max(90),
    accuracyM: z
      .number()
      .finite()
      .min(0)
      .lt(1000000000)
      .nullable()
      .default(null),
  })
  .strict();
export const landRegistrationSchema = z
  .object({
    mutationId: z.guid(),
    landId: z.guid(),
    geographyId: z.guid(),
    label: z.string().trim().min(1).max(200).nullable().default(null),
    point: landPointSchema.nullable().default(null),
    reportedAreaHectares: z
      .number()
      .finite()
      .min(0)
      .lt(100000000)
      .multipleOf(0.0001)
      .nullable()
      .default(null),
  })
  .strict();
export const landQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    after: z.guid().optional(),
  })
  .strict();
export const landDetailQuerySchema = z.object({ id: z.guid() }).strict();
export const landIdentificationSchema = z.object({
  id: z.guid(),
  geographyId: z.guid(),
  geographyName: z.string().min(1).max(1000),
  label: z.string().min(1).max(200).nullable(),
  point: landPointSchema.nullable(),
  reportedAreaHectares: z.number().finite().min(0).lt(100000000).nullable(),
  createdAt: z.string().datetime(),
  version: z.number().int().positive(),
  identificationOnly: z.literal(true),
});
export const landPageSchema = z.object({
  accountId: z.guid(),
  items: z.array(landIdentificationSchema).max(100),
  nextCursor: z.guid().nullable(),
});
export const landDetailSchema = z.object({
  accountId: z.guid(),
  land: landIdentificationSchema,
});
export const landRegistrationResultSchema = z.object({
  status: z.literal("synced"),
  landId: z.guid(),
  replayed: z.boolean(),
});
export const landGeographiesSchema = z.object({
  accountId: z.guid(),
  geographies: z
    .array(z.object({ id: z.guid(), name: z.string().min(1).max(1000) }))
    .max(10000),
});
export type LandRegistration = z.input<typeof landRegistrationSchema>;
export type LandPage = z.infer<typeof landPageSchema>;
export type LandDetail = z.infer<typeof landDetailSchema>;
export type LandRegistrationResult = z.infer<
  typeof landRegistrationResultSchema
>;
export type LandGeographies = z.infer<typeof landGeographiesSchema>;
