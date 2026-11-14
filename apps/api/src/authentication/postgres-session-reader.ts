import type { SessionReader, StoredSession } from "./session-access";

type Row = {
  id: string;
  account_id: string;
  account_active: boolean;
  session_revoked: boolean;
  idle_expires_ms: number;
  absolute_expires_ms: number;
  device_required: boolean;
  device_approved: boolean | null;
  device_revoked: boolean;
};
/** Supply only a pool connected with the dedicated restricted session-reader role. */
export interface SessionQuery {
  query(sql: string, parameters: string[]): Promise<{ rows: Row[] }>;
}
export class PostgresSessionReader implements SessionReader {
  constructor(private readonly database: SessionQuery) {}
  async findById(id: string): Promise<StoredSession | null> {
    const result = await this.database.query(
      `SELECT s.id, s.account_id, a.active AS account_active,
      (s.revoked_at IS NOT NULL) AS session_revoked,
      (extract(epoch from s.idle_expires_at) * 1000)::float8 AS idle_expires_ms,
      (extract(epoch from s.absolute_expires_at) * 1000)::float8 AS absolute_expires_ms,
      s.device_required, (d.state = 'approved') AS device_approved,
      (d.revoked_at IS NOT NULL) AS device_revoked
      FROM authn.login_session AS s
      JOIN authn.account AS a ON a.id = s.account_id
      LEFT JOIN authn.device AS d ON d.id = s.device_id AND d.account_id = s.account_id
      WHERE s.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      accountId: row.account_id,
      accountActive: row.account_active,
      revokedAt: row.session_revoked ? 0 : null,
      idleExpiresAt: row.idle_expires_ms,
      absoluteExpiresAt: row.absolute_expires_ms,
      deviceRequired: row.device_required,
      deviceApproved: row.device_approved === true,
      deviceRevokedAt: row.device_revoked ? 0 : null,
    };
  }
}
