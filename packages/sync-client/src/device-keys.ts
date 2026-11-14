import Dexie, { type Table } from "dexie";
export type DevicePublicKey = { kty: "EC"; crv: "P-256"; x: string; y: string };
type KeyRecord = {
  id: string;
  privateKey: CryptoKey;
  publicKey: DevicePublicKey;
};
class DeviceDatabase extends Dexie {
  keys!: Table<KeyRecord, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ keys: "id" });
  }
}
function publicPart(value: JsonWebKey): DevicePublicKey {
  if (
    value.kty !== "EC" ||
    value.crv !== "P-256" ||
    !value.x ||
    !value.y ||
    value.d
  )
    throw new Error("Invalid device public key");
  return { kty: "EC", crv: "P-256", x: value.x, y: value.y };
}
/** Organization enrollment is separate. This class cannot approve its own public key. */
export class DeviceKeys {
  private readonly db: DeviceDatabase;
  constructor(
    name = "agri-device-keys-v1",
    private readonly cryptoApi: Crypto = globalThis.crypto,
  ) {
    this.db = new DeviceDatabase(name);
  }
  private id(value: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      throw new Error("Invalid device identifier");
    return value.toLowerCase();
  }
  /** Never replace an existing key; retries return the same public enrollment request. */
  async prepare(deviceId: string): Promise<DevicePublicKey> {
    const id = this.id(deviceId);
    const existing = await this.db.keys.get(id);
    if (existing) return this.validate(existing).publicKey;
    const pair = await this.cryptoApi.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    );
    const publicKey = publicPart(
      await this.cryptoApi.subtle.exportKey("jwk", pair.publicKey),
    );
    try {
      await this.db.keys.add({ id, privateKey: pair.privateKey, publicKey });
    } catch (error) {
      if (!(error instanceof Dexie.ConstraintError)) throw error;
    }
    return this.validate((await this.db.keys.get(id))!).publicKey;
  }
  private validate(record: KeyRecord): KeyRecord {
    const key = record?.privateKey;
    if (
      !key ||
      key.type !== "private" ||
      key.extractable !== false ||
      key.algorithm.name !== "ECDSA" ||
      (key.algorithm as EcKeyAlgorithm).namedCurve !== "P-256" ||
      !key.usages.includes("sign")
    )
      throw new Error("Device key unavailable; do not reset existing storage");
    publicPart(record.publicKey);
    return record;
  }
  async sign(deviceId: string, message: string): Promise<string> {
    const record = await this.db.keys.get(this.id(deviceId));
    if (!record) throw new Error("Device key not enrolled on this browser");
    const signature = new Uint8Array(
      await this.cryptoApi.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        this.validate(record).privateKey,
        new TextEncoder().encode(message),
      ),
    );
    if (signature.length !== 64)
      throw new Error("Unsupported device signature encoding");
    return btoa(
      Array.from(signature, (byte) => String.fromCharCode(byte)).join(""),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
  }
  close() {
    this.db.close();
  }
}

/** RFC 7638 member order; rendered independently for administrator verification. */
export async function deviceKeyFingerprint(
  key: DevicePublicKey,
  cryptoApi: Crypto = globalThis.crypto,
): Promise<string> {
  const digest = await cryptoApi.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y }),
    ),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
