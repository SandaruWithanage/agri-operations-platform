import { openArchive, sealArchive } from "./vault-archive";
import { deriveVaultKey } from "./vault-crypto";
import Dexie, { type Table } from "dexie";
import {
  farmerRegistrationSchema,
  type FarmerRegistration,
  workingRegistrationSchema,
  type WorkingRegistration,
  offlineReferenceContextSchema,
  type OfflineReferenceContext,
} from "@agri/validation";

/** Infrastructure only: callers must gate use on real authentication and device approval. */
export type LocalStatus =
  "saved-on-device" | "pending-sync" | "synced" | "conflict" | "rejected";
type Configuration = {
  id: "vault";
  salt: Uint8Array;
  iv: Uint8Array;
  verifier: ArrayBuffer;
  iterations?: number;
};
type Mutation = {
  id: string;
  status: LocalStatus;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  fingerprint?: string;
};
export type SyncResult = { status: "synced" | "conflict" | "rejected" };
export type RegistrationSender = (
  mutationId: string,
  value: FarmerRegistration,
) => Promise<SyncResult>;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const checkText = "agri-offline-vault-v1";

type EncryptedValue = {
  id: string;
  revision: number;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
};
class OutboxDatabase extends Dexie {
  config!: Table<Configuration, string>;
  mutations!: Table<Mutation, string>;
  working!: Table<EncryptedValue, string>;
  metadata!: Table<EncryptedValue, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ config: "id", mutations: "id,status" });
    this.version(2).stores({
      config: "id",
      mutations: "id,status,&fingerprint",
    });
    this.version(3).stores({
      config: "id",
      mutations: "id,status,&fingerprint",
      working: "id",
      metadata: "id",
    });
  }
}

/** Encrypted local primitive, not a device approval, authentication, or secure deletion system. */
export class RegistrationOutbox {
  private readonly db: OutboxDatabase;
  private key: CryptoKey | null = null;
  private syncing: Promise<void> | null = null;
  private epoch = 0;
  private recovery: EncryptedValue | null = null;
  private workingAttempt = 0;
  private lockListener: (() => void) | undefined;
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
  get isUnlocked(): boolean {
    return this.key !== null;
  }
  get hasUnsavedRecovery(): boolean {
    return this.recovery !== null;
  }
  onLock(listener: () => void): void {
    this.lockListener = listener;
  }
  async isInitialized(): Promise<boolean> {
    return Boolean(await this.db.config.get("vault"));
  }
  touch(): void {
    this.unlocked();
  }
  private async derive(
    passphrase: string,
    salt: Uint8Array,
    iterations = 600_000,
  ): Promise<CryptoKey> {
    return deriveVaultKey(this.crypto, passphrase, salt, iterations);
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
    await this.db.config.add({
      id: "vault",
      salt,
      iv,
      verifier,
      iterations: 600_000,
    });
    if (this.epoch !== epoch) throw new Error("Vault locked");
    this.key = key;
    this.armLock();
  }
  async unlock(passphrase: string): Promise<void> {
    this.lock();
    const epoch = this.epoch;
    const config = await this.db.config.get("vault");
    if (!config) throw new Error("Vault not initialized");
    const key = await this.derive(
      passphrase,
      config.salt,
      config.iterations ?? 310_000,
    );
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
    const wasUnlocked = this.key !== null;
    this.epoch += 1;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.key = null;
    if (wasUnlocked) this.lockListener?.();
  }
  close(): void {
    this.lock();
    this.db.close();
  }
  private async encryptValue(
    id: string,
    revision: number,
    value: unknown,
  ): Promise<EncryptedValue> {
    const key = this.unlocked();
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await this.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode(`${this.db.name}:${id}:${revision}`),
      },
      key,
      encoder.encode(JSON.stringify(value)),
    );
    if (this.key !== key) throw new Error("Vault locked");
    return { id, revision, iv, ciphertext };
  }
  private async decryptValue(row: EncryptedValue): Promise<unknown> {
    const key = this.unlocked();
    const plain = await this.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(row.iv),
        additionalData: encoder.encode(
          `${this.db.name}:${row.id}:${row.revision}`,
        ),
      },
      key,
      row.ciphertext,
    );
    if (this.key !== key) throw new Error("Vault locked");
    return JSON.parse(decoder.decode(plain));
  }
  async writeContext(input: OfflineReferenceContext): Promise<void> {
    const value = offlineReferenceContextSchema.parse(input);
    const row = await this.encryptValue("references", 1, value);
    const key = this.unlocked();
    await this.db.transaction("rw", this.db.metadata, async () => {
      if (this.key !== key) throw new Error("Vault locked");
      await this.db.metadata.put(row);
    });
  }
  async readContext(): Promise<OfflineReferenceContext | null> {
    this.unlocked();
    const row = await this.db.metadata.get("references");
    return row
      ? offlineReferenceContextSchema.parse(await this.decryptValue(row))
      : null;
  }
  async readWorking(): Promise<{
    value: WorkingRegistration;
    revision: number;
  } | null> {
    this.unlocked();
    const row = this.recovery ?? (await this.db.working.get("current"));
    return row
      ? {
          value: workingRegistrationSchema.parse(await this.decryptValue(row)),
          revision: row.revision,
        }
      : null;
  }
  /** Optimistic revision checks prevent another tab from silently overwriting a draft. */
  async writeWorking(
    input: WorkingRegistration,
    expectedRevision: number,
  ): Promise<number> {
    const value = workingRegistrationSchema.parse(input);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new Error("Invalid draft revision");
    const attempt = ++this.workingAttempt;
    const key = this.unlocked();
    const revision = expectedRevision + 1;
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await this.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode(`${this.db.name}:current:${revision}`),
      },
      key,
      encoder.encode(JSON.stringify(value)),
    );
    const row: EncryptedValue = { id: "current", revision, iv, ciphertext };
    try {
      await this.db.transaction("rw", this.db.working, async () => {
        if (this.key !== key) throw new Error("Vault locked");
        const current = await this.db.working.get("current");
        if ((current?.revision ?? 0) !== expectedRevision)
          throw new Error("Draft changed in another tab; recovery retained");
        await this.db.working.put(row);
      });
      if (attempt === this.workingAttempt) this.recovery = null;
      return row.revision;
    } catch (error) {
      if (attempt === this.workingAttempt) this.recovery = row;
      throw error;
    }
  }
  /** Retry only the failed write's exact predecessor, never overwrite another editor's version. */
  async retryWorkingRecovery(): Promise<number> {
    const key = this.unlocked();
    const recovery = this.recovery;
    if (!recovery) return (await this.db.working.get("current"))?.revision ?? 0;
    const current = await this.db.working.get("current");
    if (
      current?.revision === recovery.revision &&
      JSON.stringify(await this.decryptValue(current)) ===
        JSON.stringify(await this.decryptValue(recovery))
    ) {
      if (this.recovery === recovery) this.recovery = null;
      return current.revision;
    }
    if ((current?.revision ?? 0) !== recovery.revision - 1)
      throw new Error(
        "Another draft version exists; export recovery before resolving",
      );
    await this.db.transaction("rw", this.db.working, async () => {
      if (this.key !== key) throw new Error("Vault locked");
      const latest = await this.db.working.get("current");
      if ((latest?.revision ?? 0) !== recovery.revision - 1)
        throw new Error("Another draft version exists; recovery retained");
      await this.db.working.put(recovery);
    });
    if (this.recovery === recovery) this.recovery = null;
    return recovery.revision;
  }
  /** Persists the mutation before removing the working copy; interrupted completion is safe to retry. */
  async completeWorking(
    input: FarmerRegistration,
    expectedRevision: number,
  ): Promise<string> {
    if (this.recovery) throw new Error("Unsaved recovery requires attention");
    const working = await this.readWorking();
    const parsed = farmerRegistrationSchema.parse(input);
    if (
      !working ||
      working.revision !== expectedRevision ||
      JSON.stringify(farmerRegistrationSchema.parse(working.value)) !==
        JSON.stringify(parsed)
    )
      throw new Error("Working draft changed");
    const id = await this.saveDraft(parsed);
    const key = this.unlocked();
    await this.db.transaction(
      "rw",
      this.db.working,
      this.db.mutations,
      async () => {
        if (this.key !== key) throw new Error("Vault locked");
        const current = await this.db.working.get("current");
        if (!current || current.revision !== expectedRevision)
          throw new Error("Working draft changed; mutation retained");
        await this.db.working.delete("current");
      },
    );
    return id;
  }
  /** Encrypted recovery archive only. Includes no passphrase, device private key or session credential. */
  async exportEncryptedArchive(): Promise<string> {
    if (!(await this.isInitialized()))
      throw new Error("No encrypted vault to export");
    const value = await this.db.transaction(
      "r",
      this.db.config,
      this.db.mutations,
      this.db.working,
      this.db.metadata,
      async () => ({
        version: 1,
        database: this.db.name,
        config: await this.db.config.toArray(),
        mutations: await this.db.mutations.toArray(),
        working: await this.db.working.toArray(),
        metadata: await this.db.metadata.toArray(),
        recovery: this.recovery,
      }),
    );
    return JSON.stringify(value, (_key, value) =>
      value instanceof ArrayBuffer || value instanceof Uint8Array
        ? {
            bytes: Array.from(
              new Uint8Array(
                value instanceof ArrayBuffer
                  ? value
                  : value.buffer.slice(
                      value.byteOffset,
                      value.byteOffset + value.byteLength,
                    ),
              ),
            ),
          }
        : value,
    );
  }
  /** Fully authenticated archive. Locked export above remains a preservation-only legacy format. */
  async exportAuthenticatedArchive(): Promise<string> {
    const key = this.unlocked();
    const raw = await this.exportEncryptedArchive();
    const sealed = await sealArchive(raw, key, this.crypto);
    if (this.key !== key) throw new Error("Vault locked");
    return sealed;
  }
  async recoveredWorking(): Promise<
    Array<{ slot: string; value: WorkingRegistration }>
  > {
    const result = [];
    for (const row of await this.db.working.toArray()) {
      if (row.id.startsWith("recovered-"))
        result.push({
          slot: row.id,
          value: workingRegistrationSchema.parse(await this.decryptValue(row)),
        });
    }
    return result;
  }
  async activateRecovered(slot: string): Promise<WorkingRegistration> {
    const key = this.unlocked();
    if (!slot.startsWith("recovered-") || this.recovery)
      throw new Error("Working draft requires attention");
    const original = await this.db.working.get(slot);
    if (!original) throw new Error("Recovery draft missing");
    const value = workingRegistrationSchema.parse(
      await this.decryptValue(original),
    );
    const row = await this.encryptValue("current", 1, value);
    await this.db.transaction("rw", this.db.working, async () => {
      if (this.key !== key || (await this.db.working.get("current")))
        throw new Error("Existing working draft retained");
      const latest = await this.db.working.get(slot);
      if (!latest || latest.revision !== original.revision)
        throw new Error("Recovery draft changed");
      await this.db.working.add(row);
      await this.db.working.delete(slot);
    });
    return value;
  }
  /** Empty-target-only atomic import; original archive is never altered or removed. */
  async importAuthenticatedArchive(
    raw: string,
    sourcePassphrase: string,
  ): Promise<void> {
    const key = this.unlocked();
    const context = await this.readContext();
    if (!context) throw new Error("Verified target context required");
    const archive = await openArchive(raw, sourcePassphrase, this.crypto);
    if (archive.accountId !== context.accountId)
      throw new Error("Original account required");
    const config = await this.db.config.get("vault");
    if (!config) throw new Error("Vault not initialized");
    const mutations: Mutation[] = [];
    for (const item of archive.mutations) {
      const iv = this.crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await this.crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: encoder.encode(item.id) },
        key,
        encoder.encode(JSON.stringify(item.farmer)),
      );
      mutations.push({
        id: item.id,
        iv,
        ciphertext,
        // Old Synced is not evidence of a fresh server confirmation on this device.
        status: ["conflict", "rejected"].includes(item.status)
          ? item.status
          : "saved-on-device",
        fingerprint: await this.fingerprint(item.farmer.farmerId, config.salt),
      });
    }
    const working: EncryptedValue[] = [];
    for (const item of archive.working)
      working.push(
        await this.encryptValue(
          `recovered-${this.crypto.randomUUID()}`,
          1,
          item,
        ),
      );
    await this.db.transaction(
      "rw",
      this.db.config,
      this.db.mutations,
      this.db.working,
      this.db.metadata,
      async () => {
        if (this.key !== key || this.recovery)
          throw new Error("Vault locked or recovery pending");
        if (
          (await this.db.mutations.count()) ||
          (await this.db.working.count())
        )
          throw new Error("Import requires an empty target vault");
        const latest = await this.db.config.get("vault");
        const references = await this.db.metadata.get("references");
        if (
          !latest ||
          !references ||
          JSON.stringify(Array.from(latest.salt)) !==
            JSON.stringify(Array.from(config.salt))
        )
          throw new Error("Target vault changed");
        await this.db.mutations.bulkAdd(mutations);
        await this.db.working.bulkAdd(working);
      },
    );
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
    const config = await this.db.config.get("vault");
    if (!config) throw new Error("Vault not initialized");
    // Older records are retained for recovery; never bypass them when deduplicating.
    if (
      (await this.db.mutations
        .filter((row) => row.fingerprint === undefined)
        .count()) > 0
    )
      throw new Error("Legacy drafts require recovery before saving");
    const fingerprint = await this.fingerprint(data.farmerId, config.salt);
    const existing = await this.db.mutations
      .where("fingerprint")
      .equals(fingerprint)
      .first();
    if (existing) return this.verifyRetry(existing.id, data);
    const id = this.crypto.randomUUID();
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await this.crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(id) },
      key,
      encoder.encode(JSON.stringify(data)),
    );
    if (this.key !== key) throw new Error("Vault locked");
    try {
      await this.db.mutations.add({
        id,
        status: "saved-on-device",
        iv,
        ciphertext,
        fingerprint,
      });
    } catch (error) {
      if (!(error instanceof Dexie.ConstraintError)) throw error;
      const winner = await this.db.mutations
        .where("fingerprint")
        .equals(fingerprint)
        .first();
      if (!winner) throw error;
      return this.verifyRetry(winner.id, data);
    }
    return id;
  }
  private async fingerprint(
    farmerId: string,
    salt: Uint8Array,
  ): Promise<string> {
    const bytes = new Uint8Array(salt.length + encoder.encode(farmerId).length);
    bytes.set(salt);
    bytes.set(encoder.encode(farmerId), salt.length);
    const digest = await this.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }
  private async verifyRetry(
    id: string,
    data: FarmerRegistration,
  ): Promise<string> {
    const existing = await this.readDraft(id);
    if (JSON.stringify(existing) !== JSON.stringify(data))
      throw new Error("Farmer UUID already has a different saved draft");
    return id;
  }
  /** Upgrade old encrypted entries after unlocking; never delete or replace existing data. */
  async recoverLegacyIndexes(): Promise<void> {
    const key = this.unlocked();
    const config = await this.db.config.get("vault");
    if (!config) throw new Error("Vault not initialized");
    const legacy = await this.db.mutations
      .filter((row) => row.fingerprint === undefined)
      .toArray();
    for (const row of legacy) {
      const draft = await this.readDraft(row.id);
      const fingerprint = await this.fingerprint(draft.farmerId, config.salt);
      if (this.key !== key) throw new Error("Vault locked");
      // A duplicate legacy UUID raises a constraint error and preserves both rows for review.
      await this.db.mutations.update(row.id, { fingerprint });
    }
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
