import { randomUUID } from "node:crypto";
import { digestSessionSecret } from "./session-cookie";

/** The connection must use agri_session_executor, with no direct access to authn tables. */
export interface SessionOperationQuery {
  query(sql: string, parameters: unknown[]): Promise<{ rows: unknown[] }>;
}
type SessionRow = { session_id: string; account_id: string };

/** Unwired storage component: callers must authenticate the BFF and enforce CSRF. */
export class PostgresSessionOperations {
  constructor(private readonly database: SessionOperationQuery) {}
  async use(
    secret: string,
    idleSeconds: number,
  ): Promise<{ sessionId: string; accountId: string } | null> {
    let digest: Buffer;
    try {
      digest = digestSessionSecret(secret);
    } catch {
      return null;
    }
    const result = await this.database.query(
      "SELECT * FROM authn.use_session($1, $2)",
      [digest, idleSeconds],
    );
    const row = result.rows[0] as SessionRow | undefined;
    return row
      ? { sessionId: row.session_id, accountId: row.account_id }
      : null;
  }
  async logout(secret: string): Promise<boolean> {
    let digest: Buffer;
    try {
      digest = digestSessionSecret(secret);
    } catch {
      return false;
    }
    const result = await this.database.query(
      "SELECT authn.logout_session($1, $2) AS done",
      [digest, randomUUID()],
    );
    return (result.rows[0] as { done?: unknown } | undefined)?.done === true;
  }
}
