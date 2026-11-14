import { createHash, randomBytes } from "node:crypto";

const cookieName = "__Host-agri_session";
const encodedSecret = /^[A-Za-z0-9_-]{43}$/;

/** Opaque secret for the browser and digest for PostgreSQL; never persist the secret itself. */
export function createSessionSecret(): { secret: string; digest: Buffer } {
  const secret = randomBytes(32).toString("base64url");
  return { secret, digest: digestSessionSecret(secret) };
}
export function digestSessionSecret(secret: string): Buffer {
  if (
    !encodedSecret.test(secret) ||
    Buffer.from(secret, "base64url").toString("base64url") !== secret
  )
    throw new Error("Invalid session secret");
  return createHash("sha256").update(secret, "ascii").digest();
}
/** Use only on HTTPS. BFF integration, expiry enforcement and server-side revocation are required. */
export function sessionCookie(secret: string, maxAgeSeconds: number): string {
  digestSessionSecret(secret);
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0)
    throw new Error("Invalid cookie lifetime");
  return `${cookieName}=${secret}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}
export function clearSessionCookie(): string {
  return `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}
