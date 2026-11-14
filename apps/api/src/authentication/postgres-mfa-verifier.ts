import { decryptMfaSecret } from "./mfa-secret";
import { verifyTotp } from "./totp";

type Factor = {
  factor_id: string;
  key_id: string;
  nonce: Buffer;
  ciphertext: Buffer;
  auth_tag: Buffer;
  last_used_counter: string;
};
export interface MfaQuery {
  query(sql: string, parameters: unknown[]): Promise<{ rows: unknown[] }>;
}
export interface MfaKeyProvider {
  getKey(keyId: string): Promise<Buffer>;
}

/** Internal only. Call after password verification, on a dedicated agri_mfa_verifier connection. */
export class PostgresMfaVerifier {
  constructor(
    private readonly database: MfaQuery,
    private readonly keys: MfaKeyProvider,
    private readonly now: () => number = Date.now,
  ) {}
  async verify(accountId: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    const result = await this.database.query(
      "SELECT * FROM authn.read_mfa_factor($1)",
      [accountId],
    );
    const factor = result.rows[0] as Factor | undefined;
    if (!factor) return false;
    const previous = Number(factor.last_used_counter);
    if (!Number.isSafeInteger(previous)) return false;
    const key = await this.keys.getKey(factor.key_id);
    let secret: Buffer;
    try {
      secret = decryptMfaSecret(
        {
          nonce: factor.nonce,
          ciphertext: factor.ciphertext,
          tag: factor.auth_tag,
        },
        key,
        accountId,
        factor.factor_id,
      );
    } catch {
      return false;
    }
    let counter: number | null;
    try {
      counter = verifyTotp(secret, code, this.now(), previous);
    } finally {
      secret.fill(0);
    }
    if (counter === null) return false;
    const consumed = await this.database.query(
      "SELECT authn.consume_mfa_counter($1,$2,$3) AS ok",
      [accountId, factor.factor_id, counter],
    );
    return (consumed.rows[0] as { ok?: unknown } | undefined)?.ok === true;
  }
}
