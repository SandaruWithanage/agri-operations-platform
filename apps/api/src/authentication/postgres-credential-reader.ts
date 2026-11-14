export type Credential = {
  accountId: string;
  passwordHash: string;
  active: boolean;
};
export interface CredentialQuery {
  query(sql: string, parameters: string[]): Promise<{ rows: unknown[] }>;
}
/** Internal only; use a dedicated agri_credential_reader connection. */
export class PostgresCredentialReader {
  constructor(private readonly database: CredentialQuery) {}
  async find(loginName: string): Promise<Credential | null> {
    const result = await this.database.query(
      "SELECT * FROM authn.find_credential($1)",
      [loginName],
    );
    const row = result.rows[0] as
      | { account_id: string; password_hash: string; active: boolean }
      | undefined;
    return row
      ? {
          accountId: row.account_id,
          passwordHash: row.password_hash,
          active: row.active,
        }
      : null;
  }
}
