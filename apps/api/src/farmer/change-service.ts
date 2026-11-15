import { ForbiddenException, NotFoundException } from "@nestjs/common";
import {
  farmerCorrectionGeographiesQuerySchema,
  farmerCorrectionGeographiesSchema,
  farmerChangeSchema,
  farmerChangeResultSchema,
  farmerDetailQuerySchema,
  farmerVerificationReceiptSchema,
  farmerCorrectionReceiptSchema,
} from "@agri/validation";
import {
  TransactionActorContext,
  type ActorQuery,
  type VerifiedActor,
} from "../authorization/transaction-context";
export class FarmerChangeService {
  constructor(private readonly context: TransactionActorContext) {}
  async correctionGeographies(
    connection: ActorQuery,
    actor: VerifiedActor,
    input: unknown,
  ) {
    const query = farmerCorrectionGeographiesQuerySchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      const source = (
        await db.query(
          "SELECT geography_id FROM farm.farmer WHERE id=$1 AND authz.allowed(geography_id,'farmer.read',NULL)",
          [query.id],
        )
      ).rows[0] as { geography_id?: unknown } | undefined;
      if (typeof source?.geography_id !== "string")
        throw new NotFoundException("Farmer not available");
      const permission = await db.query(
        "SELECT authz.allowed($1,'farmer.correct',NULL) AS permitted",
        [source.geography_id],
      );
      if ((permission.rows[0] as { permitted?: unknown })?.permitted !== true)
        throw new ForbiddenException("Correction choices denied");
      const row = (
        await db.query("SELECT * FROM farm.correction_geographies($1,$2,$3)", [
          query.id,
          query.after ?? null,
          query.limit,
        ])
      ).rows[0] as
        | {
            current_version?: unknown;
            source_geography?: unknown;
            geographies?: unknown;
            next_cursor?: unknown;
          }
        | undefined;
      return farmerCorrectionGeographiesSchema.parse({
        accountId: actor.accountId,
        farmerId: query.id.toLowerCase(),
        farmerVersion: row?.current_version,
        sourceGeographyId: row?.source_geography,
        geographies: row?.geographies,
        nextCursor: row?.next_cursor,
      });
    });
  }
  async verificationReceipt(
    connection: ActorQuery,
    actor: VerifiedActor,
    input: unknown,
  ) {
    const query = farmerDetailQuerySchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      const row = (
        await db.query(
          "SELECT geography_id FROM farm.farmer WHERE id=$1 AND authz.allowed(geography_id,'farmer.read',NULL)",
          [query.id],
        )
      ).rows[0] as { geography_id?: unknown } | undefined;
      if (typeof row?.geography_id !== "string")
        throw new NotFoundException("Farmer not available");
      const permission = await db.query(
        "SELECT authz.allowed($1,'farmer.verify',NULL) AS permitted",
        [row.geography_id],
      );
      if ((permission.rows[0] as { permitted?: unknown })?.permitted !== true)
        throw new ForbiddenException("Verification receipt denied");
      const result = (
        await db.query("SELECT * FROM farm.latest_own_verification($1)", [
          query.id,
        ])
      ).rows[0] as
        | {
            mutation_id?: unknown;
            result_version?: unknown;
            occurred_at?: unknown;
          }
        | undefined;
      return farmerVerificationReceiptSchema.parse({
        accountId: actor.accountId,
        farmerId: query.id,
        receipt: result
          ? {
              mutationId: result.mutation_id,
              version: result.result_version,
              occurredAt: result.occurred_at,
            }
          : null,
      });
    });
  }
  async correctionReceipt(
    connection: ActorQuery,
    actor: VerifiedActor,
    input: unknown,
  ) {
    const query = farmerDetailQuerySchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      const row = (
        await db.query(
          "SELECT geography_id FROM farm.farmer WHERE id=$1 AND authz.allowed(geography_id,'farmer.read',NULL)",
          [query.id],
        )
      ).rows[0] as { geography_id?: unknown } | undefined;
      if (typeof row?.geography_id !== "string")
        throw new NotFoundException("Farmer not available");
      const permission = await db.query(
        "SELECT authz.allowed($1,'farmer.correct',NULL) AS permitted",
        [row.geography_id],
      );
      if ((permission.rows[0] as { permitted?: unknown })?.permitted !== true)
        throw new ForbiddenException("Correction receipt denied");
      const result = (
        await db.query("SELECT * FROM farm.latest_own_correction($1)", [
          query.id,
        ])
      ).rows[0] as
        | {
            mutation_id?: unknown;
            result_version?: unknown;
            occurred_at?: unknown;
          }
        | undefined;
      return farmerCorrectionReceiptSchema.parse({
        accountId: actor.accountId,
        farmerId: query.id,
        receipt: result
          ? {
              mutationId: result.mutation_id,
              version: result.result_version,
              occurredAt: result.occurred_at,
            }
          : null,
      });
    });
  }
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
