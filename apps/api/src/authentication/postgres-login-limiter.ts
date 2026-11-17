import { createHmac } from "node:crypto";
export interface ThrottleQuery {
  query(sql: string, parameters: unknown[]): Promise<{ rows: unknown[] }>;
}
export type ThrottlePolicy = {
  /** Attempts per window on one account (credential guessing). */
  accountLimit: number;
  /** Attempts per window from one attributed client (broad abuse limit, much larger than the account limit). */
  clientLimit: number;
  windowSeconds: number;
  blockSeconds: number;
};
/** Use a dedicated agri_login_throttle connection; key material comes from a secret manager. */
export class PostgresLoginLimiter {
  constructor(
    private readonly database: ThrottleQuery,
    private readonly key: Buffer,
    private readonly policy: ThrottlePolicy,
  ) {
    if (
      key.length < 32 ||
      !Number.isInteger(policy.accountLimit) ||
      policy.accountLimit < 1 ||
      policy.accountLimit > 20 ||
      !Number.isInteger(policy.clientLimit) ||
      policy.clientLimit < policy.accountLimit ||
      policy.clientLimit > 10000 ||
      !Number.isInteger(policy.windowSeconds) ||
      policy.windowSeconds < 60 ||
      policy.windowSeconds > 3600 ||
      !Number.isInteger(policy.blockSeconds) ||
      policy.blockSeconds < 60 ||
      policy.blockSeconds > 86400
    )
      throw new Error("Invalid login throttle configuration");
  }
  async consume(loginName: string, trustedClientKey: string): Promise<boolean> {
    if (!loginName || !trustedClientKey) return false;
    const digest = (domain: string, value: string) =>
      createHmac("sha256", this.key)
        .update(domain)
        .update("\0")
        .update(value, "utf8")
        .digest();
    const result = await this.database.query(
      "SELECT authn.consume_login_attempt_v2($1,$2,$3,$4,$5,$6) AS allowed",
      [
        digest("account", loginName),
        digest("client", trustedClientKey),
        this.policy.accountLimit,
        this.policy.clientLimit,
        this.policy.windowSeconds,
        this.policy.blockSeconds,
      ],
    );
    return (
      (result.rows[0] as { allowed?: unknown } | undefined)?.allowed === true
    );
  }
}
