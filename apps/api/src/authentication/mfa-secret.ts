import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type ProtectedSecret = { nonce: Buffer; ciphertext: Buffer; tag: Buffer };
function associatedData(accountId: string, factorId: string): Buffer {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(accountId) || !uuid.test(factorId))
    throw new Error("Invalid factor identity");
  return Buffer.from(
    `agri-mfa-v1:${accountId.toLowerCase()}:${factorId.toLowerCase()}`,
    "ascii",
  );
}
/** Keys must be supplied by a deployment key manager; never store them in PostgreSQL. */
export function encryptMfaSecret(
  secret: Buffer,
  key: Buffer,
  accountId: string,
  factorId: string,
): ProtectedSecret {
  if (key.length !== 32 || secret.length < 20 || secret.length > 128)
    throw new Error("Invalid MFA key or secret");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(associatedData(accountId, factorId));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return { nonce, ciphertext, tag: cipher.getAuthTag() };
}
export function decryptMfaSecret(
  value: ProtectedSecret,
  key: Buffer,
  accountId: string,
  factorId: string,
): Buffer {
  if (
    key.length !== 32 ||
    value.nonce.length !== 12 ||
    value.tag.length !== 16 ||
    value.ciphertext.length < 20 ||
    value.ciphertext.length > 128
  )
    throw new Error("Invalid protected MFA secret");
  const cipher = createDecipheriv("aes-256-gcm", key, value.nonce);
  cipher.setAAD(associatedData(accountId, factorId));
  cipher.setAuthTag(value.tag);
  return Buffer.concat([cipher.update(value.ciphertext), cipher.final()]);
}
