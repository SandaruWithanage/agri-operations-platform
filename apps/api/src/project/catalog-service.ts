import { z } from "zod";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import {
  projectChangeSchema,
  projectChangeResultSchema,
  projectRegistrationSchema,
  projectRegistrationResultSchema,
  projectQuerySchema,
  projectDetailQuerySchema,
  projectSummarySchema,
  projectPageSchema,
  projectOrganizationsSchema,
} from "@agri/validation";
import {
  TransactionActorContext,
  type ActorQuery,
  type VerifiedActor,
} from "../authorization/transaction-context";
import type { RegistrationSource } from "../authorization/registration-source";
const projection =
  "id,organization_id,operations.organization_name(organization_id) AS organization_name,name,active,version,created_at";
function output<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid project projection");
  return parsed.data;
}
function project(row: Record<string, unknown>) {
  return output(projectSummarySchema, {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    name: row.name,
    active: row.active,
    version: row.version,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  });
}
export class ProjectCatalogService {
  constructor(private readonly context: TransactionActorContext) {}
  async register(
    connection: ActorQuery,
    actor: VerifiedActor,
    source: RegistrationSource,
    input: unknown,
  ) {
    const value = projectRegistrationSchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      const permission = await db.query(
        "SELECT operations.allowed_organization($1,'project.create',$2) AS permitted",
        [value.organizationId, source],
      );
      if ((permission.rows[0] as { permitted?: unknown })?.permitted !== true)
        throw new ForbiddenException("Project creation denied");
      const result = await db.query(
        "SELECT * FROM operations.register_project($1,$2,$3,$4,$5,$6)",
        [
          value.mutationId,
          value.projectId,
          value.organizationId,
          value.name,
          value.active,
          source,
        ],
      );
      const row = result.rows[0] as
        { project_id?: unknown; replayed?: unknown } | undefined;
      return output(projectRegistrationResultSchema, {
        status: "synced",
        projectId: row?.project_id,
        replayed: row?.replayed,
      });
    });
  }
  async list(connection: ActorQuery, actor: VerifiedActor, input: unknown) {
    const query = projectQuerySchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      const result = await db.query(
        `SELECT ${projection} FROM operations.project WHERE operations.allowed_organization(organization_id,'project.read',NULL) AND ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT $2`,
        [query.after ?? null, query.limit + 1],
      );
      const items = result.rows
        .slice(0, query.limit)
        .map((row) => project(row as Record<string, unknown>));
      return output(projectPageSchema, {
        accountId: actor.accountId,
        items,
        nextCursor:
          result.rows.length > query.limit ? items[items.length - 1].id : null,
      });
    });
  }
  async detail(
    connection: ActorQuery,
    actor: VerifiedActor,
    input: unknown,
    source: RegistrationSource,
  ) {
    const query = projectDetailQuerySchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      const result = await db.query(
        `SELECT ${projection} FROM operations.project WHERE id=$1 AND operations.allowed_organization(organization_id,'project.read',NULL)`,
        [query.id],
      );
      if (!result.rows.length)
        throw new NotFoundException("Project not available");
      const value = project(result.rows[0] as Record<string, unknown>);
      const permission = await db.query(
        "SELECT operations.allowed_organization($1,'project.update',$2) AS permitted",
        [value.organizationId, source],
      );
      return {
        accountId: actor.accountId,
        project: value,
        access: {
          edit:
            (permission.rows[0] as { permitted?: unknown })?.permitted === true,
        },
      };
    });
  }
  async change(
    connection: ActorQuery,
    actor: VerifiedActor,
    source: RegistrationSource,
    input: unknown,
  ) {
    const value = projectChangeSchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      const target = await db.query(
        "SELECT organization_id FROM operations.project WHERE id=$1",
        [value.projectId],
      );
      if (!target.rows.length)
        throw new NotFoundException("Project not available");
      const organization = (target.rows[0] as { organization_id: unknown })
        .organization_id;
      const permission = await db.query(
        "SELECT operations.allowed_organization($1,'project.update',$2) AS permitted",
        [organization, source],
      );
      if ((permission.rows[0] as { permitted?: unknown })?.permitted !== true)
        throw new ForbiddenException("Project change denied");
      const result = await db.query(
        "SELECT * FROM operations.change_project($1,$2,$3,$4,$5,$6)",
        [
          value.mutationId,
          value.projectId,
          value.expectedVersion,
          value.name,
          value.active,
          source,
        ],
      );
      const row = result.rows[0] as
        | { project_id?: unknown; version?: unknown; replayed?: unknown }
        | undefined;
      return output(projectChangeResultSchema, {
        projectId: row?.project_id,
        version: row?.version,
        replayed: row?.replayed,
      });
    });
  }
  async organizations(
    connection: ActorQuery,
    actor: VerifiedActor,
    source: RegistrationSource,
  ) {
    return this.context.run(connection, actor, async (db) => {
      const rows = (
        await db.query("SELECT * FROM operations.creation_organizations($1)", [
          source,
        ])
      ).rows;
      return output(projectOrganizationsSchema, {
        accountId: actor.accountId,
        organizations: rows,
      });
    });
  }
}
