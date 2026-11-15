import type { RegistrationSource } from "../authorization/registration-source";
import { ForbiddenException } from "@nestjs/common";
import { z } from "zod";
import {
  TransactionActorContext,
  type ActorQuery,
  type VerifiedActor,
} from "../authorization/transaction-context";

// Server-side validation is intentionally strict. Sensitive optional fields require separate storage and permissions.
export const registrationEnvelopeSchema = z
  .object({
    mutationId: z.guid(),
    farmer: z
      .object({
        farmerId: z.guid(),
        geographyId: z.guid(),
        fullName: z.string().trim().min(1).max(200),
        privacyNoticeProvided: z.literal(true),
      })
      .strict(),
  })
  .strict();
export type { RegistrationSource } from "../authorization/registration-source";

/** Server registration component. Actor and source must be derived from verified server-side state. */
export class FarmerRegistrationService {
  constructor(private readonly context: TransactionActorContext) {}
  async register(
    connection: ActorQuery,
    actor: VerifiedActor,
    source: RegistrationSource,
    input: unknown,
  ): Promise<{ farmerId: string; replayed: boolean }> {
    const value = registrationEnvelopeSchema.parse(input);
    if (source !== "field_officer" && source !== "administrator")
      throw new Error("Invalid registration source");
    return this.context.run(connection, actor, async (transaction) => {
      const permission = await transaction.query(
        "SELECT authz.allowed($1,'farmer.create',$2) AS permitted",
        [value.farmer.geographyId, source],
      );
      if (
        (permission.rows[0] as { permitted?: unknown } | undefined)
          ?.permitted !== true
      )
        throw new ForbiddenException("Registration denied");
      const result = await transaction.query(
        "SELECT * FROM farm.register_farmer($1,$2,$3,$4,$5,$6)",
        [
          value.mutationId,
          value.farmer.farmerId,
          value.farmer.geographyId,
          value.farmer.fullName,
          value.farmer.privacyNoticeProvided,
          source,
        ],
      );
      const row = result.rows[0] as
        { farmer_id?: unknown; replayed?: unknown } | undefined;
      if (
        typeof row?.farmer_id !== "string" ||
        typeof row.replayed !== "boolean"
      )
        throw new Error("Invalid registration result");
      return { farmerId: row.farmer_id, replayed: row.replayed };
    });
  }
}
