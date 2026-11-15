import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { z } from "zod";
export const deviceChallengeSchema = z
  .object({
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    expiresAt: z.number().int().positive(),
    mac: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export const deviceProofSchema = deviceChallengeSchema
  .extend({
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .strict();
export type DeviceProof = z.infer<typeof deviceProofSchema>;
const publicKeySchema = z
  .object({
    kty: z.literal("EC"),
    crv: z.literal("P-256"),
    x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    y: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export interface DeviceProofQuery {
  query(sql: string, parameters: unknown[]): Promise<{ rows: unknown[] }>;
}
function challengeText(
  origin: string,
  loginName: string,
  deviceId: string,
  proof: { nonce: string; expiresAt: number },
) {
  return JSON.stringify([
    "agri-device-login-v1",
    origin,
    loginName.trim(),
    deviceId.toLowerCase(),
    proof.nonce,
    proof.expiresAt,
  ]);
}
export function deviceSignatureText(
  origin: string,
  loginName: string,
  deviceId: string,
  proof: z.infer<typeof deviceChallengeSchema>,
) {
  return JSON.stringify([
    challengeText(origin, loginName, deviceId, proof),
    proof.mac,
  ]);
}
/** Separate least-privilege connection. Stores no private key or browser credential. */
export class DeviceProofs {
  private readonly origins: Set<string>;
  constructor(
    private readonly database: DeviceProofQuery,
    private readonly secret: Buffer,
    origins: readonly string[],
    private readonly now: () => number = Date.now,
  ) {
    if (
      secret.length !== 32 ||
      !origins.length ||
      origins.some((origin) => {
        const url = new URL(origin);
        return url.origin !== origin || url.protocol !== "https:";
      })
    )
      throw new Error("Invalid device challenge configuration");
    this.origins = new Set(origins);
  }
  issue(loginName: string, deviceId: string, origin: string) {
    if (!this.origins.has(origin)) throw new Error("Invalid credentials");
    const value = {
      nonce: randomBytes(32).toString("base64url"),
      expiresAt: Math.floor(this.now() / 1000) + 120,
    };
    const mac = createHmac("sha256", this.secret)
      .update(challengeText(origin, loginName, deviceId, value))
      .digest("base64url");
    return { ...value, mac };
  }
  async fingerprint(
    accountId: string,
    deviceId: string,
  ): Promise<string | null> {
    const result = await this.database.query(
      "SELECT * FROM authn.read_device_key($1,$2)",
      [accountId, deviceId],
    );
    const row = result.rows[0] as { public_jwk: unknown } | undefined;
    if (!row) return null;
    const key = publicKeySchema.parse(row.public_jwk);
    return createHash("sha256")
      .update(
        JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y }),
      )
      .digest("hex");
  }
  async verify(
    accountId: string,
    loginName: string,
    deviceId: string | null,
    origin: string,
    input: unknown,
  ): Promise<string | null> {
    const parsed = deviceProofSchema.safeParse(input);
    if (!parsed.success || !deviceId || !this.origins.has(origin)) return null;
    const proof = parsed.data;
    const now = Math.floor(this.now() / 1000);
    if (proof.expiresAt <= now || proof.expiresAt > now + 120) return null;
    const expected = createHmac("sha256", this.secret)
      .update(challengeText(origin, loginName, deviceId, proof))
      .digest();
    const supplied = Buffer.from(proof.mac, "base64url");
    if (
      supplied.length !== 32 ||
      supplied.toString("base64url") !== proof.mac ||
      !timingSafeEqual(expected, supplied)
    )
      return null;
    const result = await this.database.query(
      "SELECT * FROM authn.read_device_key($1,$2)",
      [accountId, deviceId],
    );
    const row = result.rows[0] as
      { key_id: string; public_jwk: unknown } | undefined;
    if (!row) return null;
    try {
      const jwk = publicKeySchema.parse(row.public_jwk);
      if (
        [jwk.x, jwk.y].some(
          (value) =>
            Buffer.from(value, "base64url").toString("base64url") !== value,
        )
      )
        return null;
      const signature = Buffer.from(proof.signature, "base64url");
      if (
        signature.length !== 64 ||
        signature.toString("base64url") !== proof.signature
      )
        return null;
      const key = createPublicKey({ key: jwk, format: "jwk" });
      if (
        !verify(
          "sha256",
          Buffer.from(deviceSignatureText(origin, loginName, deviceId, proof)),
          { key, dsaEncoding: "ieee-p1363" },
          signature,
        )
      )
        return null;
    } catch {
      return null;
    }
    const assertion = randomUUID();
    const recorded = await this.database.query(
      "SELECT authn.record_device_assertion($1,$2,$3,$4,$5,$6) AS ok",
      [
        assertion,
        accountId,
        deviceId,
        row.key_id,
        createHash("sha256").update(proof.nonce).digest(),
        new Date(proof.expiresAt * 1000),
      ],
    );
    return (recorded.rows[0] as { ok?: unknown } | undefined)?.ok === true
      ? assertion
      : null;
  }
}
