import { ForbiddenException, NotFoundException } from "@nestjs/common";
import {
  landRegistrationSchema,
  landRegistrationResultSchema,
  landQuerySchema,
  landDetailQuerySchema,
  landIdentificationSchema,
  landPageSchema,
  landGeographiesSchema,
} from "@agri/validation";
import {
  TransactionActorContext,
  type ActorQuery,
  type VerifiedActor,
} from "../authorization/transaction-context";
import type { RegistrationSource } from "../authorization/registration-source";
const projection = `id,geography_id,land.geography_name(geography_id) AS geography_name,label,public.ST_X(point) AS longitude,public.ST_Y(point) AS latitude,accuracy_m,reported_area_hectares::double precision AS reported_area_hectares,created_at,version`;
function project(value: unknown) {
  const row = value as Record<string, unknown>;
  const result = landIdentificationSchema.safeParse({
    id: row.id,
    geographyId: row.geography_id,
    geographyName: row.geography_name,
    label: row.label,
    point:
      row.longitude === null && row.latitude === null
        ? null
        : {
            longitude: row.longitude,
            latitude: row.latitude,
            accuracyM: row.accuracy_m,
          },
    reportedAreaHectares: row.reported_area_hectares,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    version: row.version,
    identificationOnly: true,
  });
  if (!result.success) throw new Error("Invalid land projection");
  return result.data;
}
export class LandIdentificationService {
  constructor(private readonly context: TransactionActorContext) {}
  async register(
    connection: ActorQuery,
    actor: VerifiedActor,
    source: RegistrationSource,
    input: unknown,
  ) {
    const value = landRegistrationSchema.parse(input);
    if (source !== "field_officer" && source !== "administrator")
      throw new Error("Invalid registration source");
    return this.context.run(connection, actor, async (db) => {
      const permission = await db.query(
        "SELECT authz.allowed($1,'land.create',$2) AS permitted",
        [value.geographyId, source],
      );
      if ((permission.rows[0] as { permitted?: unknown })?.permitted !== true)
        throw new ForbiddenException("Land registration denied");
      const result = await db.query(
        "SELECT * FROM land.register_identification($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          value.mutationId,
          value.landId,
          value.geographyId,
          value.label,
          value.point?.longitude ?? null,
          value.point?.latitude ?? null,
          value.point?.accuracyM ?? null,
          value.reportedAreaHectares,
          source,
        ],
      );
      const row = result.rows[0] as
        { land_id?: unknown; replayed?: unknown } | undefined;
      const parsed = landRegistrationResultSchema.safeParse({
        status: "synced",
        landId: row?.land_id,
        replayed: row?.replayed,
      });
      if (!parsed.success) throw new Error("Invalid land registration result");
      return parsed.data;
    });
  }
  async list(connection: ActorQuery, actor: VerifiedActor, input: unknown) {
    const query = landQuerySchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      const rows = (
        await db.query(
          `SELECT ${projection} FROM land.identification WHERE authz.allowed(geography_id,'land.read',NULL) AND ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT $2`,
          [query.after ?? null, query.limit + 1],
        )
      ).rows;
      const items = rows.slice(0, query.limit).map(project);
      return landPageSchema.parse({
        accountId: actor.accountId,
        items,
        nextCursor:
          rows.length > query.limit ? items[items.length - 1].id : null,
      });
    });
  }
  async detail(connection: ActorQuery, actor: VerifiedActor, input: unknown) {
    const query = landDetailQuerySchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      const rows = (
        await db.query(
          `SELECT ${projection} FROM land.identification WHERE id=$1 AND authz.allowed(geography_id,'land.read',NULL)`,
          [query.id],
        )
      ).rows;
      if (!rows.length)
        throw new NotFoundException("Land identification not available");
      return { accountId: actor.accountId, land: project(rows[0]) };
    });
  }
  async geographies(
    connection: ActorQuery,
    actor: VerifiedActor,
    source: RegistrationSource,
  ) {
    return this.context.run(connection, actor, async (db) => {
      const rows = (
        await db.query("SELECT * FROM land.registration_geographies($1)", [
          source,
        ])
      ).rows;
      const result = landGeographiesSchema.safeParse({
        accountId: actor.accountId,
        geographies: rows,
      });
      if (!result.success) throw new Error("Invalid land geographies");
      return result.data;
    });
  }
}
