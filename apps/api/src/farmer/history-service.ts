import { ForbiddenException, NotFoundException } from "@nestjs/common";
import {
  farmerHistoryQuerySchema,
  farmerHistoryPageSchema,
} from "@agri/validation";
import {
  TransactionActorContext,
  type ActorQuery,
  type VerifiedActor,
} from "../authorization/transaction-context";
/** An explicit history grant and RLS-visible record are required before native history access. */
export class FarmerHistoryService {
  constructor(private readonly context: TransactionActorContext) {}
  async history(connection: ActorQuery, actor: VerifiedActor, input: unknown) {
    const query = farmerHistoryQuerySchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      const scope = await db.query(
        "SELECT geography_id FROM farm.farmer WHERE id=$1",
        [query.id],
      );
      const geography = (
        scope.rows[0] as { geography_id?: unknown } | undefined
      )?.geography_id;
      if (typeof geography !== "string")
        throw new NotFoundException("Farmer not available");
      const access = await db.query(
        "SELECT authz.allowed($1,'farmer.audit.read',NULL) AS permitted",
        [geography],
      );
      if ((access.rows[0] as { permitted?: unknown })?.permitted !== true)
        throw new ForbiddenException("History denied");
      const rows = (
        await db.query("SELECT * FROM farm.farmer_history($1,$2,$3,$4)", [
          query.id,
          query.beforeTime ?? null,
          query.beforeId ?? null,
          query.limit + 1,
        ])
      ).rows;
      const items = rows.slice(0, query.limit).map((value) => {
        const row = value as Record<string, unknown>;
        return {
          eventId: row.event_id,
          action: row.action,
          occurredAt: row.occurred_at,
          actorAccountId: row.actor_id,
          change: row.change,
        };
      });
      const last = items[items.length - 1];
      const result = farmerHistoryPageSchema.safeParse({
        accountId: actor.accountId,
        farmerId: query.id,
        items,
        nextCursor:
          rows.length > query.limit
            ? { beforeTime: last.occurredAt, beforeId: last.eventId }
            : null,
      });
      if (!result.success) throw new Error("Invalid history result");
      return result.data;
    });
  }
}
