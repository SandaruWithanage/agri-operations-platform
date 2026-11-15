import { NotFoundException } from "@nestjs/common";
import {
  farmerListQuerySchema,
  farmerDetailQuerySchema,
  farmerPageSchema,
  farmerSummarySchema,
  type FarmerSummary,
} from "@agri/validation";
import {
  TransactionActorContext,
  type ActorQuery,
  type VerifiedActor,
} from "../authorization/transaction-context";
const projection = `f.id, f.version, f.full_name, f.geography_id, farm.farmer_geography_name(f.geography_id) AS geography_name, f.status, f.created_at,
  EXISTS(SELECT 1 FROM farm.farmer d WHERE d.id<>f.id AND d.geography_id=f.geography_id AND lower(btrim(d.full_name))=lower(btrim(f.full_name))) AS duplicate_risk`;

function project(value: unknown): FarmerSummary {
  const row = value as Record<string, unknown>;
  return farmerSummarySchema.parse({
    id: row.id,
    duplicateRisk: row.duplicate_risk,
    version: row.version,
    fullName: row.full_name,
    geographyId: row.geography_id,
    geographyName: row.geography_name,
    status: row.status,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  });
}
/** Current signed actor context plus an explicit read predicate and FORCE RLS. */
export class FarmerRegistryService {
  constructor(private readonly context: TransactionActorContext) {}
  async list(connection: ActorQuery, actor: VerifiedActor, input: unknown) {
    const query = farmerListQuerySchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      const rows = (
        await db.query(
          `SELECT ${projection} FROM farm.farmer f WHERE authz.allowed(f.geography_id,'farmer.read',NULL) AND ($1::uuid IS NULL OR f.id > $1::uuid) AND ($3::text IS NULL OR f.status=$3) AND (NOT $4::boolean OR (f.status='pending-review' AND authz.allowed(f.geography_id,'farmer.verify',NULL))) ORDER BY f.id LIMIT $2`,
          [
            query.after ?? null,
            query.limit + 1,
            query.status ?? null,
            query.reviewable === "true",
          ],
        )
      ).rows;
      const items = rows.slice(0, query.limit).map(project);
      return farmerPageSchema.parse({
        ...(query.status || query.reviewable
          ? {
              filters: {
                ...(query.status ? { status: query.status } : {}),
                ...(query.reviewable ? { reviewable: query.reviewable } : {}),
              },
            }
          : {}),
        accountId: actor.accountId,
        items,
        nextCursor:
          rows.length > query.limit ? items[items.length - 1].id : null,
      });
    });
  }
  async detail(connection: ActorQuery, actor: VerifiedActor, input: unknown) {
    const query = farmerDetailQuerySchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      const rows = (
        await db.query(
          `SELECT ${projection} FROM farm.farmer f WHERE f.id=$1 AND authz.allowed(f.geography_id,'farmer.read',NULL)`,
          [query.id],
        )
      ).rows;
      if (!rows.length) throw new NotFoundException("Farmer not available");
      const farmer = project(rows[0]);
      const permission = await db.query(
        "SELECT authz.allowed($1,'farmer.audit.read',NULL) AS permitted, authz.allowed($1,'farmer.verify',NULL) AS can_verify, authz.allowed($1,'farmer.correct',NULL) AS can_correct",
        [farmer.geographyId],
      );
      return {
        accountId: actor.accountId,
        farmer,
        access: {
          correct:
            (permission.rows[0] as { can_correct?: unknown })?.can_correct ===
            true,
          verify:
            (permission.rows[0] as { can_verify?: unknown })?.can_verify ===
            true,
          viewAudit:
            (permission.rows[0] as { permitted?: unknown })?.permitted === true,
        },
      };
    });
  }
}
