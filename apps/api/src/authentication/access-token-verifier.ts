import { jwtVerify, type JWTVerifyGetKey } from "jose";

/** Cryptographic claims only. Session, account and device must still be checked in PostgreSQL. */
export type VerifiedToken = {
  issuer: string;
  subject: string;
  sessionId: string;
};
export type AccessTokenConfig = {
  issuer: string;
  audience: string;
  maxLifetimeSeconds: number;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Not registered on an endpoint: token verification alone is not authorization. */
export class AccessTokenVerifier {
  constructor(
    private readonly config: AccessTokenConfig,
    private readonly keySet: JWTVerifyGetKey,
  ) {
    if (
      !config.issuer.trim() ||
      !config.audience.trim() ||
      !Number.isInteger(config.maxLifetimeSeconds) ||
      config.maxLifetimeSeconds <= 0 ||
      config.maxLifetimeSeconds > 600
    )
      throw new Error("Invalid access-token configuration");
  }
  async verify(token: string): Promise<VerifiedToken> {
    const { payload } = await jwtVerify(token, this.keySet, {
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: ["RS256", "ES256"],
      requiredClaims: ["sub", "sid", "iat", "exp"],
    });
    if (
      typeof payload.sub !== "string" ||
      !payload.sub.trim() ||
      typeof payload.sid !== "string" ||
      !uuid.test(payload.sid)
    )
      throw new Error("Invalid token identity");
    if (
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.iat > Math.floor(Date.now() / 1000) ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > this.config.maxLifetimeSeconds
    )
      throw new Error("Invalid token lifetime");
    return {
      issuer: this.config.issuer,
      subject: payload.sub,
      sessionId: payload.sid,
    };
  }
}
