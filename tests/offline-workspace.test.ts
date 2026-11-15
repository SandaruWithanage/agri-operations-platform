// @vitest-environment node
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  DeviceKeys,
  deviceKeyFingerprint,
  OfflineWorkspace,
  RegistrationOutbox,
  VaultCatalog,
  vaultName,
} from "../packages/sync-client/src";
const cryptoApi = webcrypto as unknown as Crypto;
const names: string[] = [];
const closables: Array<{ close(): void }> = [];
const passphrase = "synthetic-offline-passphrase";
const farmer = {
  farmerId: "b94a097c-18d6-4cec-ae1b-66fce2b47e05",
  fullName: "Synthetic farmer",
  geographyId: "4e743f19-e3f7-4ed0-bdcc-29fe8e71ff0d",
  privacyNoticeProvided: true as const,
};
afterEach(async () => {
  for (const item of closables.splice(0)) item.close();
  for (const name of new Set(names.splice(0)))
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
});
async function setup() {
  const accountId = cryptoApi.randomUUID(),
    deviceId = cryptoApi.randomUUID();
  const keyName = `synthetic-keys-${deviceId}`,
    catName = `synthetic-cat-${deviceId}`;
  names.push(keyName, catName, vaultName(accountId, deviceId));
  const keys = new DeviceKeys(keyName, cryptoApi),
    catalog = new VaultCatalog(catName);
  closables.push(keys, catalog);
  const pub = await keys.prepare(deviceId);
  const context = {
    accountId,
    deviceId,
    deviceKeyFingerprint: await deviceKeyFingerprint(pub, cryptoApi),
    verifiedAt: Date.now(),
    offlineUntil: Date.now() + 3600000,
    geographies: [{ id: farmer.geographyId, label: "Synthetic village" }],
  };
  const workspace = new OfflineWorkspace(
    accountId,
    deviceId,
    keys,
    catalog,
    cryptoApi,
  );
  closables.push(workspace);
  return { workspace, keys, catalog, context, accountId, deviceId };
}
it("autosaves incomplete encrypted data and recovers after restart without requiring identity/contact data", async () => {
  const { workspace, keys, catalog, context, accountId, deviceId } =
    await setup();
  await workspace.unlock(passphrase, context);
  await workspace.capture({
    ...farmer,
    fullName: "Synthetic partial",
    geographyId: "",
    privacyNoticeProvided: false,
  });
  await workspace.lock();
  const next = new OfflineWorkspace(
    accountId,
    deviceId,
    keys,
    catalog,
    cryptoApi,
  );
  closables.push(next);
  await next.unlock(passphrase);
  expect(next.canCreate()).toBe(true);
  expect((await next.outbox.readWorking())?.value).toEqual({
    ...farmer,
    fullName: "Synthetic partial",
    geographyId: "",
    privacyNoticeProvided: false,
  });
  await next.capture(farmer);
  const id = await next.complete(farmer);
  expect(await next.outbox.readWorking()).toBeNull();
  expect(await next.outbox.list()).toEqual([{ id, status: "saved-on-device" }]);
  const archive = await next.outbox.exportEncryptedArchive();
  expect(archive).not.toContain(farmer.fullName);
  expect(archive).not.toContain(farmer.geographyId);
  expect(archive).not.toContain("privateKey");
});
it("rechecks account/device before sync, preserves pending data after unauthorized access, and persists the local suspension", async () => {
  const { workspace, keys, catalog, context, accountId, deviceId } =
    await setup();
  await workspace.unlock(passphrase, context);
  await workspace.capture(farmer);
  const id = await workspace.complete(farmer);
  const transport = {
    context: vi.fn().mockResolvedValue(context),
    sendRegistration: vi.fn().mockRejectedValue({ status: 401 }),
  };
  await expect(workspace.sync(transport)).rejects.toMatchObject({
    status: 401,
  });
  expect((await workspace.outbox.list())[0]).toEqual({
    id,
    status: "pending-sync",
  });
  expect(workspace.canCreate()).toBe(false);
  await workspace.lock();
  const next = new OfflineWorkspace(
    accountId,
    deviceId,
    keys,
    catalog,
    cryptoApi,
  );
  closables.push(next);
  await next.unlock(passphrase);
  expect(next.canCreate()).toBe(false);
  transport.context.mockResolvedValue({
    ...context,
    accountId: cryptoApi.randomUUID(),
  });
  await expect(next.sync(transport)).rejects.toMatchObject({ status: 401 });
  expect(transport.sendRegistration).toHaveBeenCalledOnce();
  await catalog.authorize(accountId, deviceId, await catalog.epoch(deviceId));
  transport.context.mockResolvedValue(context);
  transport.sendRegistration.mockResolvedValue({ status: "synced" });
  await next.sync(transport);
  expect((await next.outbox.list())[0]).toEqual({ id, status: "synced" });
  expect(transport.sendRegistration.mock.calls[1][2]).toBe(id);
  expect(next.canCreate()).toBe(true);
});
it("retains data on expiry, conflict and rejection and permits removal only after server confirmation", async () => {
  const { workspace, context } = await setup();
  await workspace.unlock(passphrase, context);
  await workspace.capture(farmer);
  const id = await workspace.complete(farmer);
  expect(workspace.canCreate(context.offlineUntil + 1)).toBe(false);
  await expect(workspace.outbox.removeSynced(id)).rejects.toThrow(
    "synchronized",
  );
  await workspace.sync({
    context: async () => context,
    sendRegistration: async () => ({ status: "conflict" }),
  });
  expect((await workspace.entries())[0].status).toBe("conflict");
  expect((await workspace.entries())[0].farmer).toEqual(farmer);
});
it("never overwrites a different-tab working draft and retains an encrypted recovery snapshot", async () => {
  const name = `synthetic-cas-${cryptoApi.randomUUID()}`;
  names.push(name);
  const one = new RegistrationOutbox(name, cryptoApi),
    two = new RegistrationOutbox(name, cryptoApi);
  closables.push(one, two);
  await one.initialize(passphrase);
  await two.unlock(passphrase);
  await one.writeWorking({ ...farmer, fullName: "First tab" }, 0);
  await expect(
    two.writeWorking({ ...farmer, fullName: "Second tab" }, 0),
  ).rejects.toThrow("another tab");
  expect(two.hasUnsavedRecovery).toBe(true);
  await expect(two.retryWorkingRecovery()).rejects.toThrow(
    "Another draft version",
  );
  expect((await one.readWorking())?.value.fullName).toBe("First tab");
  expect((await two.readWorking())?.value.fullName).toBe("Second tab");
  two.lock();
  await two.unlock(passphrase);
  expect((await two.readWorking())?.value.fullName).toBe("Second tab");
});

it("retries a failed device write after unlocking without overwriting a different-tab recovery", async () => {
  const name = `synthetic-quota-${cryptoApi.randomUUID()}`;
  names.push(name);
  const box = new RegistrationOutbox(name, cryptoApi);
  closables.push(box);
  await box.initialize(passphrase);
  const fail = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementationOnce(() => {
      throw new DOMException("Synthetic quota full", "QuotaExceededError");
    });
  await expect(box.writeWorking(farmer, 0)).rejects.toThrow();
  fail.mockRestore();
  expect(box.hasUnsavedRecovery).toBe(true);
  box.lock();
  await box.unlock(passphrase);
  expect((await box.readWorking())?.value).toEqual(farmer);
  expect(await box.retryWorkingRecovery()).toBe(1);
  expect(box.hasUnsavedRecovery).toBe(false);
  expect((await box.readWorking())?.value).toEqual(farmer);
});

it("retains an encrypted edit when inactivity locking wins the race with encryption", async () => {
  const name = `synthetic-lock-edit-${cryptoApi.randomUUID()}`;
  names.push(name);
  const box = new RegistrationOutbox(name, cryptoApi);
  closables.push(box);
  await box.initialize(passphrase);
  let started!: () => void;
  let release!: () => void;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const encrypt = cryptoApi.subtle.encrypt.bind(cryptoApi.subtle);
  const spy = vi
    .spyOn(cryptoApi.subtle, "encrypt")
    .mockImplementationOnce(async (algorithm, key, data) => {
      const result = await encrypt(algorithm, key, data);
      started();
      await gate;
      return result;
    });
  const saving = box.writeWorking(farmer, 0);
  await begun;
  box.lock();
  release();
  await expect(saving).rejects.toThrow("locked");
  spy.mockRestore();
  expect(box.hasUnsavedRecovery).toBe(true);
  await box.unlock(passphrase);
  expect((await box.readWorking())?.value).toEqual(farmer);
  await box.retryWorkingRecovery();
  expect(box.hasUnsavedRecovery).toBe(false);
});

it("does not let stale context or login completion undo a newer local suspension", async () => {
  const { catalog, context, accountId, deviceId } = await setup();
  await catalog.remember(context);
  const epoch = await catalog.epoch(deviceId);
  await catalog.suspend(accountId, deviceId);
  await catalog.remember(context);
  expect(await catalog.blocked(accountId, deviceId)).toBe(true);
  expect(await catalog.authorize(accountId, deviceId, epoch)).toBe(false);
  expect(
    await catalog.authorize(accountId, deviceId, await catalog.epoch(deviceId)),
  ).toBe(true);
  expect(await catalog.blocked(accountId, deviceId)).toBe(false);
});

it("requires current online authorization before importing and suspends local access on revocation", async () => {
  const { workspace, context, catalog, accountId, deviceId } = await setup();
  await workspace.unlock(passphrase, context);
  await workspace.capture(farmer);
  const saved = await workspace.outbox.readWorking();
  const transport = {
    context: vi.fn().mockRejectedValue({ status: 401 }),
    sendRegistration: vi.fn(),
  };
  await expect(
    workspace.importArchive(
      "not decrypted before authorization",
      "synthetic-archive-passphrase",
      transport,
    ),
  ).rejects.toMatchObject({ status: 401 });
  expect(await catalog.blocked(accountId, deviceId)).toBe(true);
  expect(workspace.canAccess()).toBe(false);
  expect(await workspace.outbox.readWorking()).toEqual(saved);
  expect(transport.sendRegistration).not.toHaveBeenCalled();
});
