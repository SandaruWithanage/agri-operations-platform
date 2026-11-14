// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type KeyLike,
} from "jose";
import { AccessTokenVerifier } from "../src/authentication/access-token-verifier";
const issuer = "agri-auth";
const audience = "agri-api";
const sessionId = "c344ab8f-f9c8-48a7-8053-c83cf99c2a17";
let privateKey: KeyLike;
let verifier: AccessTokenVerifier;
beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const jwk = await exportJWK(keys.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  verifier = new AccessTokenVerifier(
    { issuer, audience, maxLifetimeSeconds: 600 },
    createLocalJWKSet({ keys: [jwk] }),
  );
});
function token(
  iss = issuer,
  aud = audience,
  subject = "synthetic-subject",
  exp = "5m",
  sid = sessionId,
) {
  return new SignJWT({ sid })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(privateKey);
}
describe("short-lived access token verification", () => {
  it("returns signed identity and session claims, not permissions", async () => {
    expect(await verifier.verify(await token())).toEqual({
      issuer,
      subject: "synthetic-subject",
      sessionId,
    });
  });
  it("rejects wrong issuer, audience, expiry, session and subject", async () => {
    for (const bad of [
      await token("wrong"),
      await token(issuer, "other"),
      await token(issuer, audience, "synthetic-subject", "-1s"),
      await token(issuer, audience, ""),
      await token(issuer, audience, "synthetic-subject", "5m", "invalid"),
      await token(issuer, audience, "synthetic-subject", "15m"),
    ]) {
      await expect(verifier.verify(bad)).rejects.toThrow();
    }
  });
  it("rejects a modified token and missing expiration", async () => {
    const signed = await token();
    const parts = signed.split(".");
    parts[1] = Buffer.from('{"sub":"spoofed"}').toString("base64url");
    await expect(verifier.verify(parts.join("."))).rejects.toThrow();
    const noExpiry = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("synthetic-subject")
      .setIssuedAt()
      .sign(privateKey);
    await expect(verifier.verify(noExpiry)).rejects.toThrow();
  });
  it("rejects a disallowed signing algorithm and future-issued token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const symmetric = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: "HS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("synthetic-subject")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(new Uint8Array(32));
    await expect(verifier.verify(symmetric)).rejects.toThrow();
    const future = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("synthetic-subject")
      .setIssuedAt(now + 60)
      .setExpirationTime(now + 360)
      .sign(privateKey);
    await expect(verifier.verify(future)).rejects.toThrow();
  });
  it("rejects insecure lifetime configuration", () => {
    expect(
      () =>
        new AccessTokenVerifier(
          { issuer, audience, maxLifetimeSeconds: 601 },
          async () => {
            throw new Error();
          },
        ),
    ).toThrow();
  });
});
