import { z } from "zod";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import {
  enrollmentCreateSchema,
  enrollmentWithdrawSchema,
  enrollmentQuerySchema,
  enrollmentDetailQuerySchema,
  enrollmentSummarySchema,
  enrollmentPageSchema,
  enrollmentDetailSchema,
  enrollmentResultSchema,
} from "@agri/validation";
import {
  TransactionActorContext,
  type ActorQuery,
  type VerifiedActor,
} from "../authorization/transaction-context";
import type { RegistrationSource } from "../authorization/registration-source";

const projection =
  "id,organization_id,project_id,farmer_id,status,version,enrolled_at,withdrawn_at";
const sources = z.enum(["administrator", "field_officer"]);
function output<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid enrollment projection");
  return parsed.data;
}
const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : value;
function summary(row: Record<string, unknown>) {
  return output(enrollmentSummarySchema, {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    farmerId: row.farmer_id,
    status: row.status,
    version: row.version,
    enrolledAt: iso(row.enrolled_at),
    withdrawnAt: row.withdrawn_at === null ? null : iso(row.withdrawn_at),
  });
}

/**
 * Provisional explicit enrollment (ADR 0019). Authorization and eligibility are enforced by
 * PostgreSQL (RLS + fixed functions) under the signed transaction actor; this service only
 * validates input, fixes the trusted source and maps the bounded results. It never trusts
 * browser-supplied actor, role, source or organization values.
 */
export class ProjectEnrollmentService {
  constructor(private readonly context: TransactionActorContext) {}

  async enroll(
    connection: ActorQuery,
    actor: VerifiedActor,
    source: RegistrationSource,
    input: unknown,
  ) {
    const value = enrollmentCreateSchema.parse(input);
    const trusted = sources.parse(source);
    return this.context.run(connection, actor, async (db) => {
      const result = await db.query(
        "SELECT * FROM operations.enroll_farmer($1,$2,$3,$4,$5)",
        [
          value.mutationId,
          value.enrollmentId,
          value.projectId,
          value.farmerId,
          trusted,
        ],
      );
      return this.result(result.rows[0]);
    });
  }

  async withdraw(
    connection: ActorQuery,
    actor: VerifiedActor,
    source: RegistrationSource,
    input: unknown,
  ) {
    const value = enrollmentWithdrawSchema.parse(input);
    const trusted = sources.parse(source);
    return this.context.run(connection, actor, async (db) => {
      const result = await db.query(
        "SELECT * FROM operations.withdraw_enrollment($1,$2,$3,$4)",
        [value.mutationId, value.enrollmentId, value.expectedVersion, trusted],
      );
      return this.result(result.rows[0]);
    });
  }

  async list(connection: ActorQuery, actor: VerifiedActor, input: unknown) {
    const query = enrollmentQuerySchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      // Row-level security applies the project-scope and farmer.read predicates to every row.
      const result = await db.query(
        `SELECT ${projection} FROM operations.enrollment
          WHERE ($1::uuid IS NULL OR id>$1::uuid)
            AND ($2::uuid IS NULL OR project_id=$2::uuid)
            AND ($3::uuid IS NULL OR farmer_id=$3::uuid)
            AND ($4::text IS NULL OR status=$4::text)
          ORDER BY id LIMIT $5`,
        [
          query.after ?? null,
          query.projectId ?? null,
          query.farmerId ?? null,
          query.status ?? null,
          query.limit + 1,
        ],
      );
      const items = result.rows
        .slice(0, query.limit)
        .map((row) => summary(row as Record<string, unknown>));
      return output(enrollmentPageSchema, {
        accountId: actor.accountId,
        items,
        nextCursor:
          result.rows.length > query.limit ? items[items.length - 1].id : null,
      });
    });
  }

  async detail(connection: ActorQuery, actor: VerifiedActor, input: unknown) {
    const query = enrollmentDetailQuerySchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      const result = await db.query(
        `SELECT ${projection} FROM operations.enrollment WHERE id=$1`,
        [query.id],
      );
      // Unreadable and missing records are indistinguishable.
      if (!result.rows.length)
        throw new NotFoundException("Enrollment not available");
      return output(enrollmentDetailSchema, {
        accountId: actor.accountId,
        enrollment: summary(result.rows[0] as Record<string, unknown>),
      });
    });
  }

  private result(row: unknown) {
    const value = row as
      | { enrollment_id?: unknown; version?: unknown; replayed?: unknown }
      | undefined;
    if (!value) throw new ForbiddenException("Enrollment denied");
    return output(enrollmentResultSchema, {
      enrollmentId: value.enrollment_id,
      version: value.version,
      replayed: value.replayed,
    });
  }
}
