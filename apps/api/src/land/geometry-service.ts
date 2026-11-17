import { ForbiddenException, NotFoundException } from "@nestjs/common";
import {
  landGeometryQuerySchema,
  landGeometryReadSchema,
  landGeometryRecordSchema,
  landGeometryResultSchema,
  landGeometryVersionSchema,
} from "@agri/validation";
import {
  TransactionActorContext,
  type ActorQuery,
  type VerifiedActor,
} from "../authorization/transaction-context";
import type { RegistrationSource } from "../authorization/registration-source";

const columns = `id,land_id,version,status,source,public.ST_AsGeoJSON(boundary,9)::jsonb AS geojson,accuracy_m,vertex_count,calculated_area_m2::double precision AS calculated_area_m2,created_at`;
function project(value: unknown) {
  const row = value as Record<string, unknown>;
  const rings = (row.geojson as { coordinates?: unknown[] } | null)
    ?.coordinates;
  const result = landGeometryVersionSchema.safeParse({
    id: row.id,
    landId: row.land_id,
    version: row.version,
    status: row.status,
    source: row.source,
    ring: Array.isArray(rings) ? rings[0] : undefined,
    accuracyM: row.accuracy_m,
    vertexCount: row.vertex_count,
    calculatedAreaM2: row.calculated_area_m2,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    provisionalIdentificationOnly: true,
  });
  if (!result.success) throw new Error("Invalid land geometry projection");
  return result.data;
}

export class LandGeometryService {
  constructor(private readonly context: TransactionActorContext) {}

  async record(
    connection: ActorQuery,
    actor: VerifiedActor,
    source: RegistrationSource,
    input: unknown,
  ) {
    const value = landGeometryRecordSchema.parse(input);
    if (source !== "field_officer" && source !== "administrator")
      throw new Error("Invalid registration source");
    return this.context.run(connection, actor, async (db) => {
      let result;
      try {
        result = await db.query(
          "SELECT * FROM land.record_geometry($1,$2,$3,$4::jsonb,$5,$6,NULL,$7)",
          [
            value.mutationId,
            value.landId,
            value.expectedVersion,
            JSON.stringify(value.ring),
            value.source,
            value.accuracyM,
            source,
          ],
        );
      } catch (error) {
        // The database is the authority: map only its documented denial to 403.
        if ((error as { code?: string }).code === "42501")
          throw new ForbiddenException("Land geometry denied");
        throw error;
      }
      const row = result.rows[0] as Record<string, unknown> | undefined;
      const parsed = landGeometryResultSchema.safeParse({
        status: "synced",
        landId: row?.out_land,
        version: row?.out_version,
        calculatedAreaM2:
          row?.out_area === undefined ? undefined : Number(row.out_area),
        replayed: row?.out_replayed,
      });
      if (!parsed.success) throw new Error("Invalid land geometry result");
      return parsed.data;
    });
  }

  async read(connection: ActorQuery, actor: VerifiedActor, input: unknown) {
    const query = landGeometryQuerySchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      // Row-level security decides visibility; a land with no visible geometry is indistinguishable from a hidden one.
      const rows = (
        await db.query(
          `SELECT ${columns} FROM land.geometry_version WHERE land_id=$1 ORDER BY version DESC LIMIT 100`,
          [query.landId],
        )
      ).rows.map(project);
      if (!rows.length)
        throw new NotFoundException("Land geometry not available");
      return landGeometryReadSchema.parse({
        accountId: actor.accountId,
        landId: query.landId,
        current: rows.find((row) => row.status === "provisional") ?? null,
        history: query.history ? rows : [],
      });
    });
  }
}
