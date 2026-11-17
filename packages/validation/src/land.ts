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
const ringCoordinateSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
// A closed [longitude, latitude] ring; the server never edits submitted coordinates.
const ringSchema = z
  .array(ringCoordinateSchema)
  .min(4)
  .max(5000)
  .refine(
    (ring) =>
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1],
    "Ring must be closed",
  );
// `official_survey` exists in the database vocabulary but is not accepted from clients.
export const landGeometrySourceSchema = z.enum(["gps_walk", "digitized"]);
export const landGeometryRecordSchema = z
  .object({
    mutationId: z.guid(),
    landId: z.guid(),
    expectedVersion: z.number().int().min(0).max(2147483645),
    ring: ringSchema,
    source: landGeometrySourceSchema,
    accuracyM: z
      .number()
      .finite()
      .min(0)
      .lt(1000000000)
      .nullable()
      .default(null),
  })
  .strict();
export const landGeometryQuerySchema = z
  .object({
    landId: z.guid(),
    history: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .strict();
export const landGeometryVersionSchema = z.object({
  id: z.guid(),
  landId: z.guid(),
  version: z.number().int().positive(),
  status: z.enum(["provisional", "superseded"]),
  source: z.enum(["gps_walk", "digitized", "official_survey"]),
  ring: ringSchema,
  accuracyM: z.number().finite().min(0).nullable(),
  vertexCount: z.number().int().min(4).max(5000),
  calculatedAreaM2: z.number().finite().positive(),
  createdAt: z.string().datetime(),
  // Always true: geometry is a location-identification aid, never a surveyed boundary or verified acreage.
  provisionalIdentificationOnly: z.literal(true),
});
export const landGeometryResultSchema = z.object({
  status: z.literal("synced"),
  landId: z.guid(),
  version: z.number().int().positive(),
  calculatedAreaM2: z.number().finite().positive(),
  replayed: z.boolean(),
});
export const landGeometryReadSchema = z.object({
  accountId: z.guid(),
  landId: z.guid(),
  current: landGeometryVersionSchema.nullable(),
  history: z.array(landGeometryVersionSchema).max(100),
});
export type LandGeometryRecord = z.input<typeof landGeometryRecordSchema>;
export type LandGeometryResult = z.infer<typeof landGeometryResultSchema>;
export type LandGeometryRead = z.infer<typeof landGeometryReadSchema>;

const degrees = (min: number, max: number) =>
  z.coerce.number().finite().min(min).max(max);
// A viewport cannot cross the antimeridian and is capped, so a bulk export is not a viewport.
export const maxViewportSpanDegrees = 5;
export const landViewportQuerySchema = z
  .object({
    west: degrees(-180, 180),
    south: degrees(-90, 90),
    east: degrees(-180, 180),
    north: degrees(-90, 90),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict()
  .refine(
    (v) =>
      v.west < v.east &&
      v.south < v.north &&
      v.east - v.west <= maxViewportSpanDegrees &&
      v.north - v.south <= maxViewportSpanDegrees,
    "Invalid viewport",
  );
export const landViewportSchema = z.object({
  accountId: z.guid(),
  bbox: z.object({
    west: z.number(),
    south: z.number(),
    east: z.number(),
    north: z.number(),
  }),
  polygons: z
    .array(
      z.object({
        landId: z.guid(),
        version: z.number().int().positive(),
        ring: ringSchema,
        calculatedAreaM2: z.number().finite().positive(),
        source: z.enum(["gps_walk", "digitized", "official_survey"]),
      }),
    )
    .max(200),
  points: z
    .array(
      z.object({
        landId: z.guid(),
        longitude: z.number().min(-180).max(180),
        latitude: z.number().min(-90).max(90),
        accuracyM: z.number().finite().min(0).nullable(),
      }),
    )
    .max(200),
  // Computed only over features the caller may see; never reveals how many hidden features exist.
  truncated: z.boolean(),
  provisionalIdentificationOnly: z.literal(true),
});
export type LandViewport = z.infer<typeof landViewportSchema>;
