import { randomUUID } from "node:crypto";
import { createSessionSecret, sessionCookie } from "./session-cookie";

/** Must resolve only after the statement's transaction has committed successfully. */
export interface CommittedSessionQuery {
  executeCommitted(
    sql: string,
    parameters: unknown[],
  ): Promise<{ rows: unknown[] }>;
}
/** Populate only after server-side credential and required MFA verification; never from a request body. */
export type AuthenticatedAccount = {
  accountId: string;
  deviceId: string | null;
  deviceRequired: boolean;
  deviceAssertionId: string;
};
export type SessionLifetime = { idleSeconds: number; absoluteSeconds: number };

export class SessionIssuanceDeniedError extends Error {
  constructor() {
    super("Session issuance denied");
  }
}

/** Unwired internal component; authentication, MFA policy and rate limiting must precede issuance. */
export class PostgresSessionIssuer {
  constructor(private readonly database: CommittedSessionQuery) {}
  async issue(
    account: AuthenticatedAccount,
    lifetime: SessionLifetime,
  ): Promise<{ sessionId: string; cookie: string }> {
    const { idleSeconds, absoluteSeconds } = lifetime;
    if (
      !Number.isSafeInteger(idleSeconds) ||
      !Number.isSafeInteger(absoluteSeconds) ||
      idleSeconds < 1 ||
      absoluteSeconds < idleSeconds ||
      absoluteSeconds > 2_592_000
    )
      throw new Error("Invalid session lifetime");
    const { secret, digest } = createSessionSecret();
    const sessionId = randomUUID();
    const result = await this.database
      .executeCommitted(
        "SELECT authn.issue_device_session($1,$2,$3,$4,$5,$6,$7,$8,$9) AS ok",
        [
          sessionId,
          randomUUID(),
          account.accountId,
          account.deviceId,
          account.deviceRequired,
          digest,
          idleSeconds,
          absoluteSeconds,
          account.deviceAssertionId,
        ],
      )
      .catch((error: unknown) => {
        if ((error as { code?: string })?.code === "42501")
          throw new SessionIssuanceDeniedError();
        throw error;
      });
    if ((result.rows[0] as { ok?: unknown } | undefined)?.ok !== true)
      throw new SessionIssuanceDeniedError();
    return { sessionId, cookie: sessionCookie(secret, absoluteSeconds) };
  }
}
