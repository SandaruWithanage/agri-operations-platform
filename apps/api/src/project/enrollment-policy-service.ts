import { NotFoundException } from "@nestjs/common";
import { z } from "zod";
import {
  enrollmentPolicySetSchema,
  enrollmentPolicyQuerySchema,
  enrollmentPolicyDetailSchema,
  enrollmentPolicyResultSchema,
} from "@agri/validation";
import {
  TransactionActorContext,
  type ActorQuery,
  type VerifiedActor,
} from "../authorization/transaction-context";
import type { RegistrationSource } from "../authorization/registration-source";

function output<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid enrollment policy projection");
  return parsed.data;
}

/**
 * Enrollment-policy administration. PostgreSQL decides authority (organization-level `enrollment.policy`
 * administrator grant, re-checked after every lock wait) and keeps the journal, history and audit; this
 * service validates input, pins the trusted source and maps bounded results.
 */
export class EnrollmentPolicyService {
  constructor(private readonly context: TransactionActorContext) {}

  async set(
    connection: ActorQuery,
    actor: VerifiedActor,
    source: RegistrationSource,
    input: unknown,
  ) {
    const value = enrollmentPolicySetSchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      const result = await db.query(
        "SELECT * FROM operations.set_enrollment_policy($1,$2,$3,$4,$5,$6)",
        [
          value.mutationId,
          value.projectId,
          value.expectedVersion,
          value.enabled,
          value.eligibleFarmerStatuses,
          source,
        ],
      );
      const row = result.rows[0] as
        | { project_id?: unknown; version?: unknown; replayed?: unknown }
        | undefined;
      return output(enrollmentPolicyResultSchema, {
        projectId: row?.project_id,
        version: row?.version,
        replayed: row?.replayed,
      });
    });
  }

  async detail(connection: ActorQuery, actor: VerifiedActor, input: unknown) {
    const query = enrollmentPolicyQuerySchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      // Non-administrators cannot distinguish a missing project from an unauthorized one.
      const admin = await db.query(
        "SELECT operations.enrollment_policy_admin($1) AS permitted",
        [query.projectId],
      );
      if ((admin.rows[0] as { permitted?: unknown })?.permitted !== true)
        throw new NotFoundException("Enrollment policy not available");
      const result = await db.query(
        "SELECT project_id,enabled,eligible_farmer_statuses,version FROM operations.enrollment_policy WHERE project_id=$1",
        [query.projectId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return output(enrollmentPolicyDetailSchema, {
        accountId: actor.accountId,
        projectId: query.projectId,
        policy: row
          ? {
              projectId: row.project_id,
              enabled: row.enabled,
              eligibleFarmerStatuses: row.eligible_farmer_statuses,
              version: row.version,
            }
          : null,
      });
    });
  }
}
