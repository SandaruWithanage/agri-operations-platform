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
const projection = `id, full_name, geography_id, farm.farmer_geography_name(geography_id) AS geography_name, status, created_at`;
function project(value: unknown): FarmerSummary {
  const row = value as Record<string, unknown>;
  return farmerSummarySchema.parse({
    id: row.id,
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
          `SELECT ${projection} FROM farm.farmer WHERE authz.allowed(geography_id,'farmer.read',NULL) AND ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2`,
          [query.after ?? null, query.limit + 1],
        )
      ).rows;
      const items = rows.slice(0, query.limit).map(project);
      return farmerPageSchema.parse({
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
          `SELECT ${projection} FROM farm.farmer WHERE id=$1 AND authz.allowed(geography_id,'farmer.read',NULL)`,
          [query.id],
        )
      ).rows;
      if (!rows.length) throw new NotFoundException("Farmer not available");
      return { accountId: actor.accountId, farmer: project(rows[0]) };
    });
  }
}
