import { z } from "zod";
const timestamp = z.string().datetime().max(40);
export const farmerHistoryQuerySchema = z
  .object({
    id: z.guid(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    beforeTime: timestamp.optional(),
    beforeId: z.guid().optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.beforeTime) === Boolean(value.beforeId),
    "Complete history cursor required",
  );
const status = z.enum(["draft", "pending-review", "verified", "inactive"]);
const snapshot = z.object({
  fullName: z.string().min(1).max(200),
  geographyId: z.guid(),
  geographyName: z.string().min(1).max(1000),
  status,
});
const changed = z
  .object({
    reason: z.string().min(8).max(500),
    previousVersion: z.number().int().positive().max(2147483646),
    resultVersion: z.number().int().positive().max(2147483647),
    duplicateRisk: z.boolean(),
    previous: snapshot,
    result: snapshot,
  })
  .refine(
    (value) => value.resultVersion === value.previousVersion + 1,
    "Invalid history revision",
  );
const base = {
  eventId: z.guid(),
  occurredAt: timestamp,
  actorAccountId: z.guid(),
};
export const farmerHistoryEventSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("registration"), change: z.null() }),
  z.object({
    ...base,
    action: z.enum(["correction", "verification"]),
    change: changed,
  }),
]);
export const farmerHistoryCursorSchema = z.object({
  beforeTime: timestamp,
  beforeId: z.guid(),
});
export const farmerHistoryPageSchema = z
  .object({
    accountId: z.guid(),
    farmerId: z.guid(),
    items: z.array(farmerHistoryEventSchema).max(100),
    nextCursor: farmerHistoryCursorSchema.nullable(),
  })
  .refine((value) => {
    const last = value.items[value.items.length - 1];
    return (
      new Set(value.items.map((event) => event.eventId)).size ===
        value.items.length &&
      (!value.nextCursor ||
        Boolean(
          last &&
          value.nextCursor.beforeId === last.eventId &&
          value.nextCursor.beforeTime === last.occurredAt,
        ))
    );
  }, "Invalid history page cursor or repeated event");

export type FarmerHistoryPage = z.infer<typeof farmerHistoryPageSchema>;
export type FarmerHistoryCursor = z.infer<typeof farmerHistoryCursorSchema>;
