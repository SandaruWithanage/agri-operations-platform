import Dexie, { type Table } from "dexie";
import {
  farmerRegistrationSchema,
  type FarmerRegistration,
} from "@agri/validation";

/** Infrastructure only: callers must gate use on real authentication and device approval. */
export type LocalStatus =
  "saved-on-device" | "pending-sync" | "synced" | "conflict" | "rejected";
type Configuration = {
  id: "vault";
  salt: Uint8Array;
  iv: Uint8Array;
  verifier: ArrayBuffer;
};
type Mutation = {
  id: string;
  status: LocalStatus;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
};
export type SyncResult = { status: "synced" | "conflict" | "rejected" };
export type RegistrationSender = (
  mutationId: string,
  value: FarmerRegistration,
) => Promise<SyncResult>;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const checkText = "agri-offline-vault-v1";

class OutboxDatabase extends Dexie {
  config!: Table<Configuration, string>;
  mutations!: Table<Mutation, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ config: "id", mutations: "id,status" });
  }
}

/** Encrypted local primitive, not a device approval, authentication, or secure deletion system. */
export class RegistrationOutbox {
  private readonly db: OutboxDatabase;
  private key: CryptoKey | null = null;
  private syncing: Promise<void> | null = null;
  private epoch = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    name: string,
    private readonly crypto: Crypto = globalThis.crypto,
    private readonly idleMs = 300_000,
  ) {
    if (!Number.isFinite(idleMs) || idleMs <= 0)
      throw new Error("Invalid inactivity timeout");
    this.db = new OutboxDatabase(name);
  }
  private async derive(
    passphrase: string,
    salt: Uint8Array,
  ): Promise<CryptoKey> {
    if (passphrase.length < 12)
      throw new Error("Passphrase must be at least 12 characters");
    const material = await this.crypto.subtle.importKey(
      "raw",
      encoder.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return this.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: new Uint8Array(salt),
        iterations: 310_000,
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
  private unlocked(): CryptoKey {
    if (!this.key) throw new Error("Vault locked");
    this.armLock();
    return this.key;
  }
  async initialize(passphrase: string): Promise<void> {
    const epoch = this.epoch;
    if (await this.db.config.get("vault"))
      throw new Error("Vault already initialized");
    const salt = this.crypto.getRandomValues(new Uint8Array(16));
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const key = await this.derive(passphrase, salt);
    const verifier = await this.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(checkText),
    );
    if (this.epoch !== epoch) throw new Error("Vault locked");
    await this.db.config.add({ id: "vault", salt, iv, verifier });
    if (this.epoch !== epoch) throw new Error("Vault locked");
    this.key = key;
    this.armLock();
  }
  async unlock(passphrase: string): Promise<void> {
    this.lock();
    const epoch = this.epoch;
    const config = await this.db.config.get("vault");
    if (!config) throw new Error("Vault not initialized");
    const key = await this.derive(passphrase, config.salt);
    try {
      const plain = await this.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(config.iv) },
        key,
        config.verifier,
      );
      if (decoder.decode(plain) !== checkText) throw new Error();
    } catch {
      throw new Error("Unable to unlock vault");
    }
    if (this.epoch !== epoch) throw new Error("Vault locked");
    this.key = key;
    this.armLock();
  }
  private armLock(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.lock(), this.idleMs);
  }
  lock(): void {
    this.epoch += 1;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.key = null;
  }
  close(): void {
    this.lock();
    this.db.close();
  }
  async saveDraft(input: FarmerRegistration): Promise<string> {
    const key = this.unlocked();
    // Restrict offline data to the minimum until approved device security is demonstrated.
    const parsed = farmerRegistrationSchema.parse(input);
    if (
      Object.keys(parsed).some(
        (key) =>
          ![
            "farmerId",
            "fullName",
            "geographyId",
            "privacyNoticeProvided",
          ].includes(key),
      )
    )
      throw new Error("Only the minimal offline dataset is supported");
    const data = {
      farmerId: parsed.farmerId,
      fullName: parsed.fullName,
      geographyId: parsed.geographyId,
      privacyNoticeProvided: parsed.privacyNoticeProvided,
    };
    const id = this.crypto.randomUUID();
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await this.crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(id) },
      key,
      encoder.encode(JSON.stringify(data)),
    );
    if (this.key !== key) throw new Error("Vault locked");
    await this.db.mutations.add({
      id,
      status: "saved-on-device",
      iv,
      ciphertext,
    });
    return id;
  }
  async readDraft(id: string): Promise<FarmerRegistration> {
    const key = this.unlocked();
    const row = await this.db.mutations.get(id);
    if (!row) throw new Error("Draft not found");
    const plain = await this.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(row.iv),
        additionalData: encoder.encode(id),
      },
      key,
      row.ciphertext,
    );
    if (this.key !== key) throw new Error("Vault locked");
    return farmerRegistrationSchema.parse(JSON.parse(decoder.decode(plain)));
  }
  async list(): Promise<Array<{ id: string; status: LocalStatus }>> {
    this.unlocked();
    return (await this.db.mutations.toArray()).map(({ id, status }) => ({
      id,
      status,
    }));
  }
  async queue(id: string): Promise<void> {
    this.unlocked();
    await this.db.transaction("rw", this.db.mutations, async () => {
      const row = await this.db.mutations.get(id);
      if (!row || row.status !== "saved-on-device")
        throw new Error("Only a saved draft can be queued");
      await this.db.mutations.update(id, { status: "pending-sync" });
    });
  }
  /** Server must authorize, atomically deduplicate mutation IDs and check payload hashes. */
  syncPending(send: RegistrationSender): Promise<void> {
    this.unlocked();
    if (this.syncing) return this.syncing;
    this.syncing = this.performSync(send).finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }
  private async performSync(send: RegistrationSender): Promise<void> {
    for (const row of await this.db.mutations
      .where("status")
      .equals("pending-sync")
      .toArray()) {
      const key = this.unlocked();
      const payload = await this.readDraft(row.id);
      if (this.key !== key) throw new Error("Vault locked");
      const result = await send(row.id, payload);
      if (!["synced", "conflict", "rejected"].includes(result.status))
        throw new Error("Invalid sync response");
      if (this.key !== key) throw new Error("Vault locked");
      await this.db.transaction("rw", this.db.mutations, async () => {
        const current = await this.db.mutations.get(row.id);
        if (current?.status === "pending-sync")
          await this.db.mutations.update(row.id, { status: result.status });
      });
    }
  }
  async removeSynced(id: string): Promise<void> {
    this.unlocked();
    await this.db.transaction("rw", this.db.mutations, async () => {
      const row = await this.db.mutations.get(id);
      if (!row || row.status !== "synced")
        throw new Error("Only synchronized records can be removed");
      await this.db.mutations.delete(id);
    });
  }
}
