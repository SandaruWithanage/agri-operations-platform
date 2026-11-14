import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** A session-bound CSRF primitive, not yet registered in the BFF or any endpoint. */
export class CsrfTokens {
  private readonly allowedOrigins: Set<string>;
  constructor(
    private readonly secret: Buffer,
    allowedOrigins: readonly string[],
  ) {
    if (secret.byteLength < 32 || allowedOrigins.length === 0)
      throw new Error("Invalid CSRF configuration");
    for (const origin of allowedOrigins) {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.origin !== origin)
        throw new Error("CSRF origins must be exact HTTPS origins");
    }
    this.allowedOrigins = new Set(allowedOrigins);
  }
  private mac(sessionId: string, nonce: string): Buffer {
    return createHmac("sha256", this.secret)
      .update("agri-csrf-v1\0")
      .update(sessionId)
      .update("\0")
      .update(nonce)
      .digest();
  }
  issue(sessionId: string): string {
    if (!sessionId) throw new Error("Session required");
    const nonce = randomBytes(32).toString("base64url");
    return `${nonce}.${this.mac(sessionId, nonce).toString("base64url")}`;
  }
  /** Call only after session authentication; validate every cookie-authenticated unsafe request. */
  assertValid(
    sessionId: string,
    origin: string | undefined,
    token: string | undefined,
  ): void {
    if (
      !sessionId ||
      !origin ||
      !this.allowedOrigins.has(origin) ||
      !token ||
      !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(token)
    )
      throw new Error("CSRF validation failed");
    const [nonce, signature] = token.split(".");
    const supplied = Buffer.from(signature, "base64url");
    const expected = this.mac(sessionId, nonce);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new Error("CSRF validation failed");
  }
}
