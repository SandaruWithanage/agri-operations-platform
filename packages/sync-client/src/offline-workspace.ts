import {
  offlineReferenceContextSchema,
  farmerRegistrationSchema,
  type OfflineReferenceContext,
  type WorkingRegistration,
  type FarmerRegistration,
} from "@agri/validation";
import {
  RegistrationOutbox,
  type LocalStatus,
  type SyncResult,
} from "./registration-outbox";
import { DeviceKeys, deviceKeyFingerprint } from "./device-keys";
import { VaultCatalog, vaultName } from "./vault-catalog";
export interface OfflineTransport {
  context(): Promise<OfflineReferenceContext>;
  sendRegistration(
    accountId: string,
    deviceId: string,
    mutationId: string,
    farmer: FarmerRegistration,
  ): Promise<SyncResult>;
}
export class OfflineAuthorizationRequired extends Error {
  readonly status = 401;
}
export class OfflineWorkspace {
  readonly outbox: RegistrationOutbox;
  private references: OfflineReferenceContext | null = null;
  private revision = 0;
  private tail: Promise<void> = Promise.resolve();
  private keyMatches = false;
  private error: unknown = null;
  private blocked = false;
  private listener: (() => void) | undefined;
  constructor(
    readonly accountId: string,
    readonly deviceId: string,
    private readonly keys: DeviceKeys,
    private readonly catalog: VaultCatalog,
    cryptoApi: Crypto = globalThis.crypto,
    idleMs = 300000,
  ) {
    this.outbox = new RegistrationOutbox(
      vaultName(accountId, deviceId),
      cryptoApi,
      idleMs,
    );
    this.outbox.onLock(() => {
      this.references = null;
      this.keyMatches = false;
      this.listener?.();
    });
  }
  private binding(value: OfflineReferenceContext) {
    const parsed = offlineReferenceContextSchema.parse(value);
    if (
      parsed.accountId.toLowerCase() !== this.accountId.toLowerCase() ||
      parsed.deviceId.toLowerCase() !== this.deviceId.toLowerCase()
    )
      throw new OfflineAuthorizationRequired(
        "Reauthenticate with the original account and device",
      );
    return parsed;
  }
  private async matches(value: OfflineReferenceContext): Promise<boolean> {
    try {
      const key = await this.keys.publicKey(this.deviceId);
      return (
        key !== null &&
        (await deviceKeyFingerprint(key)) === value.deviceKeyFingerprint
      );
    } catch {
      return false;
    }
  }
  async unlock(
    passphrase: string,
    fresh?: OfflineReferenceContext,
  ): Promise<void> {
    await this.tail.catch(() => {});
    this.tail = Promise.resolve();
    if (!(await this.outbox.isInitialized())) {
      if (!fresh)
        throw new Error(
          "Online verification required to initialize this device vault",
        );
      const verified = this.binding(fresh);
      if (!(await this.matches(verified)))
        throw new Error("Approved device key unavailable");
      await this.outbox.initialize(passphrase);
    } else await this.outbox.unlock(passphrase);
    if (fresh) await this.refresh(fresh);
    this.references = await this.outbox.readContext();
    if (this.references) {
      this.binding(this.references);
      this.keyMatches = await this.matches(this.references);
    }
    try {
      await this.outbox.retryWorkingRecovery();
      this.error = null;
    } catch (error) {
      this.error = error;
    }
    const working = await this.outbox.readWorking();
    this.revision = working?.revision ?? 0;
    if (working && !this.outbox.hasUnsavedRecovery) {
      const parsed = farmerRegistrationSchema.safeParse(working.value);
      if (parsed.success) {
        const existing = (await this.entries()).find(
          (row) => JSON.stringify(row.farmer) === JSON.stringify(parsed.data),
        );
        if (existing) {
          await this.outbox.completeWorking(parsed.data, this.revision);
          this.revision = 0;
        }
      }
    }
    this.blocked = await this.catalog.blocked(this.accountId, this.deviceId);
  }
  async refresh(fresh: OfflineReferenceContext): Promise<void> {
    const verified = this.binding(fresh);
    await this.outbox.writeContext(verified);
    this.references = verified;
    this.keyMatches = await this.matches(verified);
    await this.catalog.remember(verified);
    this.blocked = await this.catalog.blocked(this.accountId, this.deviceId);
  }
  onLock(listener: () => void): void {
    this.listener = listener;
  }
  get context(): OfflineReferenceContext | null {
    return this.references;
  }
  get saveError(): unknown {
    return this.error;
  }
  get isUnlocked(): boolean {
    return this.outbox.isUnlocked;
  }
  canAccess(now = Date.now()): boolean {
    const value = this.references;
    return (
      this.outbox.isUnlocked &&
      !this.blocked &&
      this.keyMatches &&
      value !== null &&
      now >= value.verifiedAt - 30000 &&
      now < value.offlineUntil
    );
  }
  canCreate(now = Date.now()): boolean {
    return (
      this.canAccess(now) &&
      !this.outbox.hasUnsavedRecovery &&
      (this.references?.geographies.length ?? 0) > 0
    );
  }
  /** Every edit carries a complete minimal snapshot. Serialize saves to retain the latest successful revision. */
  capture(value: WorkingRegistration): Promise<void> {
    this.tail = this.tail
      .catch(() => {})
      .then(async () => {
        this.revision = await this.outbox.writeWorking(value, this.revision);
        this.error = null;
      })
      .catch((error) => {
        this.error = error;
        throw error;
      });
    return this.tail;
  }
  async retryLocalSave(): Promise<void> {
    await this.tail.catch(() => {});
    this.tail = Promise.resolve();
    this.revision = await this.outbox.retryWorkingRecovery();
    this.error = null;
  }
  async flush(): Promise<void> {
    await this.tail;
    if (this.error) throw this.error;
  }
  async complete(value: FarmerRegistration): Promise<string> {
    await this.flush();
    if (
      !this.canCreate() ||
      !this.references?.geographies.some(
        (option) => option.id === value.geographyId,
      )
    )
      throw new Error(
        "Online authorization refresh required before completing this draft",
      );
    const id = await this.outbox.completeWorking(value, this.revision);
    this.revision = 0;
    return id;
  }
  async entries(): Promise<
    Array<{ id: string; status: LocalStatus; farmer: FarmerRegistration }>
  > {
    const rows = await this.outbox.list();
    const result = [];
    for (const row of rows)
      result.push({ ...row, farmer: await this.outbox.readDraft(row.id) });
    return result;
  }
  async sync(
    transport: OfflineTransport,
    progress?: (mutationId: string | null) => void,
  ): Promise<void> {
    await this.flush();
    try {
      const current = this.binding(await transport.context());
      await this.refresh(current);
      if (this.blocked || !this.keyMatches)
        throw new OfflineAuthorizationRequired(
          "Approved device key unavailable; recovery data retained",
        );
      for (const row of await this.outbox.list())
        if (row.status === "saved-on-device") await this.outbox.queue(row.id);
      await this.outbox.syncPending(
        (id, value) =>
          transport.sendRegistration(this.accountId, this.deviceId, id, value),
        progress,
      );
    } catch (error) {
      if ([401, 403].includes((error as { status?: number })?.status ?? 0)) {
        this.blocked = true;
        await this.catalog.suspend(this.accountId, this.deviceId);
      }
      throw error;
    }
  }
  async importArchive(
    raw: string,
    passphrase: string,
    transport: OfflineTransport,
  ): Promise<void> {
    await this.flush();
    try {
      await this.refresh(this.binding(await transport.context()));
      if (!this.canAccess())
        throw new OfflineAuthorizationRequired(
          "Current approved device login required",
        );
      await this.outbox.importAuthenticatedArchive(raw, passphrase);
    } catch (error) {
      if ([401, 403].includes((error as { status?: number })?.status ?? 0)) {
        this.blocked = true;
        await this.catalog.suspend(this.accountId, this.deviceId);
      }
      throw error;
    }
  }

  async activateRecovered(slot: string): Promise<WorkingRegistration> {
    await this.flush();
    if (!this.canCreate())
      throw new OfflineAuthorizationRequired(
        "Current drafting window required",
      );
    const value = await this.outbox.activateRecovered(slot);
    this.revision = 1;
    return value;
  }
  async lock(): Promise<void> {
    try {
      await this.flush();
    } finally {
      this.outbox.lock();
    }
  }
  close(): void {
    this.references = null;
    this.keyMatches = false;
    this.outbox.close();
  }
}
