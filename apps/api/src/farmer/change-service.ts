import { ForbiddenException } from "@nestjs/common";
import { farmerChangeSchema, farmerChangeResultSchema } from "@agri/validation";
import {
  TransactionActorContext,
  type ActorQuery,
  type VerifiedActor,
} from "../authorization/transaction-context";
export class FarmerChangeService {
  constructor(private readonly context: TransactionActorContext) {}
  async change(connection: ActorQuery, actor: VerifiedActor, input: unknown) {
    const value = farmerChangeSchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      // Check current read/action authorization in the service. Native SQL rechecks
      // both source and destination coverage and independently enforces FORCE RLS.
      const scope = await db.query(
        "SELECT geography_id FROM farm.farmer WHERE id=$1",
        [value.farmerId],
      );
      const geography = (
        scope.rows[0] as { geography_id?: unknown } | undefined
      )?.geography_id;
      if (typeof geography !== "string")
        throw new ForbiddenException("Change denied");
      const permission =
        value.action === "verification" ? "farmer.verify" : "farmer.correct";
      const allowed = await db.query(
        "SELECT authz.allowed($1,'farmer.read',NULL) AND authz.allowed($1,$2,NULL) AND authz.allowed($3,'farmer.read',NULL) AND authz.allowed($3,$2,NULL) AS permitted",
        [
          geography,
          permission,
          value.action === "correction" ? value.geographyId : geography,
        ],
      );
      if ((allowed.rows[0] as { permitted?: unknown })?.permitted !== true)
        throw new ForbiddenException("Change denied");
      const result = await db.query(
        "SELECT * FROM farm.change_farmer($1,$2,$3,$4,$5,$6,$7)",
        [
          value.mutationId,
          value.farmerId,
          value.expectedVersion,
          value.action,
          value.action === "correction" ? value.fullName : null,
          value.action === "correction" ? value.geographyId : null,
          value.reason,
        ],
      );
      const row = result.rows[0] as {
        farmer_id?: unknown;
        version?: unknown;
        replayed?: unknown;
        duplicate_risk?: unknown;
      };
      const parsed = farmerChangeResultSchema.safeParse({
        farmerId: row?.farmer_id,
        version: row?.version,
        replayed: row?.replayed,
        duplicateRisk: row?.duplicate_risk,
      });
      if (!parsed.success) throw new Error("Invalid change result");
      return parsed.data;
    });
  }
}
