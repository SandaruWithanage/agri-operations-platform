import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** RFC 6238 TOTP primitive. Enrollment, encrypted persistence, throttling and MFA enforcement are not wired. */
export function createTotpSecret(): Buffer {
  return randomBytes(20);
}
function codeForCounter(secret: Buffer, counter: number): string {
  const value = Buffer.alloc(8);
  value.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(value).digest();
  const offset = digest[digest.length - 1] & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000,
  ).padStart(6, "0");
}
/** The caller must atomically persist the returned counter and reject reuse. */
export function verifyTotp(
  secret: Buffer,
  code: string,
  nowMs: number,
  lastUsedCounter: number,
): number | null {
  if (
    secret.length < 20 ||
    secret.length > 128 ||
    !/^\d{6}$/.test(code) ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < 30_000 ||
    !Number.isSafeInteger(lastUsedCounter) ||
    lastUsedCounter < -1
  )
    return null;
  const counter = Math.floor(nowMs / 30_000);
  const supplied = Buffer.from(code, "ascii");
  let accepted: number | null = null;
  for (const candidate of [counter - 1, counter, counter + 1]) {
    const valid = timingSafeEqual(
      supplied,
      Buffer.from(codeForCounter(secret, candidate), "ascii"),
    );
    if (valid && candidate > lastUsedCounter) accepted = candidate;
  }
  return accepted;
}
