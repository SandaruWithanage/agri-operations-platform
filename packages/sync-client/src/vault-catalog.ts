import Dexie, { type Table } from "dexie";
import {
  offlineReferenceContextSchema,
  type OfflineReferenceContext,
} from "@agri/validation";
export type VaultReference = {
  id: string;
  accountId: string;
  deviceId: string;
  lastVerifiedAt: number;
  blocked?: boolean;
};
class CatalogDatabase extends Dexie {
  vaults!: Table<VaultReference, string>;
  control!: Table<{ deviceId: string; version: number }, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ vaults: "id" });
    this.version(2).stores({ vaults: "id", control: "deviceId" });
  }
}
export function vaultName(accountId: string, deviceId: string): string {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(accountId) || !uuid.test(deviceId))
    throw new Error("Invalid vault binding");
  return `agri-registration-v1-${accountId.toLowerCase()}-${deviceId.toLowerCase()}`;
}
/** Index contains identifiers only; farmer drafts/references remain encrypted in the bound vault. */
export class VaultCatalog {
  private readonly db: CatalogDatabase;
  constructor(name = "agri-offline-catalog-v1") {
    this.db = new CatalogDatabase(name);
  }
  async remember(input: OfflineReferenceContext): Promise<void> {
    const value = offlineReferenceContextSchema.parse(input);
    const id = vaultName(value.accountId, value.deviceId);
    await this.db.transaction("rw", this.db.vaults, async () => {
      const existing = await this.db.vaults.get(id);
      await this.db.vaults.put({
        id,
        accountId: value.accountId,
        deviceId: value.deviceId,
        lastVerifiedAt: value.verifiedAt,
        blocked: existing?.blocked ?? false,
      });
    });
  }
  async epoch(deviceId: string): Promise<number> {
    return (await this.db.control.get(deviceId.toLowerCase()))?.version ?? 0;
  }
  /** Only a completed online login may clear a suspension, unless logout won the race. */
  async authorize(
    accountId: string,
    deviceId: string,
    expectedEpoch: number,
  ): Promise<boolean> {
    const id = vaultName(accountId, deviceId);
    return this.db.transaction(
      "rw",
      this.db.vaults,
      this.db.control,
      async () => {
        if ((await this.epoch(deviceId)) !== expectedEpoch) return false;
        await this.db.vaults.update(id, { blocked: false });
        return true;
      },
    );
  }
  async blocked(accountId: string, deviceId: string): Promise<boolean> {
    return (
      (await this.db.vaults.get(vaultName(accountId, deviceId)))?.blocked ===
      true
    );
  }
  async suspend(accountId: string, deviceId: string): Promise<void> {
    const id = vaultName(accountId, deviceId);
    await this.db.transaction(
      "rw",
      this.db.vaults,
      this.db.control,
      async () => {
        const existing = await this.db.vaults.get(id);
        await this.db.control.put({
          deviceId: deviceId.toLowerCase(),
          version: (await this.epoch(deviceId)) + 1,
        });
        await this.db.vaults.put({
          id,
          accountId,
          deviceId,
          lastVerifiedAt: existing?.lastVerifiedAt ?? 0,
          blocked: true,
        });
      },
    );
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("agri-offline-access");
      channel.postMessage({ accountId, deviceId, state: "suspended" });
      channel.close();
    }
  }
  async list(): Promise<VaultReference[]> {
    return this.db.vaults.filter((value) => value.lastVerifiedAt > 0).toArray();
  }
  close() {
    this.db.close();
  }
}
