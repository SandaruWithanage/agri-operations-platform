import { ForbiddenException } from "@nestjs/common";
import { z } from "zod";
import {
  TransactionActorContext,
  type ActorQuery,
  type VerifiedActor,
} from "../authorization/transaction-context";
import type { RegistrationSource } from "../authorization/registration-source";

const targetSchema = z.strictObject({
  projectId: z.uuid().transform((value) => value.toLowerCase()),
  geographyId: z.uuid().transform((value) => value.toLowerCase()),
});

/** Internal enrollment scope prerequisite, not eligibility or an HTTP capability grant.
 * Work must stay within the supplied DB transaction, with no external side effects.
 * Future record RLS/native writes must independently invoke the same predicate.
 */
export class ProjectScopePolicy {
  constructor(private readonly context: TransactionActorContext) {}

  read<T>(
    connection: ActorQuery,
    actor: VerifiedActor,
    input: unknown,
    work: (db: ActorQuery) => Promise<T>,
  ): Promise<T> {
    return this.run(connection, actor, input, "enrollment.read", null, work);
  }

  async create<T>(
    connection: ActorQuery,
    actor: VerifiedActor,
    source: RegistrationSource,
    input: unknown,
    work: (db: ActorQuery) => Promise<T>,
  ): Promise<T> {
    const trustedSource = z
      .enum(["administrator", "field_officer"])
      .parse(source);
    return this.run(
      connection,
      actor,
      input,
      "enrollment.create",
      trustedSource,
      work,
    );
  }

  private async run<T>(
    connection: ActorQuery,
    actor: VerifiedActor,
    input: unknown,
    permission: "enrollment.read" | "enrollment.create",
    source: RegistrationSource | null,
    work: (db: ActorQuery) => Promise<T>,
  ): Promise<T> {
    const target = targetSchema.parse(input);
    return this.context.run(connection, actor, async (db) => {
      const requireScope = async () => {
        const result = await db.query(
          "SELECT authz.allowed_project_geography($1,$2,$3,$4) AS permitted",
          [target.projectId, target.geographyId, permission, source],
        );
        if (
          (result.rows[0] as { permitted?: unknown } | undefined)?.permitted !==
          true
        )
          throw new ForbiddenException("Project scope denied");
      };
      await requireScope();
      const result = await work(db);
      await requireScope();
      return result;
    });
  }
}
