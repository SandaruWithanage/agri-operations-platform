// @vitest-environment node
import "fake-indexeddb/auto";
import { webcrypto, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  RegistrationOutbox,
  vaultName,
  openArchive,
} from "../packages/sync-client/src";
const crypto = webcrypto as unknown as Crypto;
const pass = "synthetic-original-passphrase",
  nextPass = "synthetic-replacement-passphrase";
const accountId = randomUUID(),
  deviceId = randomUUID();
const geographyId = randomUUID();
const names: string[] = [],
  boxes: RegistrationOutbox[] = [];
function box(account = accountId, device = randomUUID()) {
  const name = vaultName(account, device);
  names.push(name);
  const value = new RegistrationOutbox(name, crypto);
  boxes.push(value);
  return value;
}
function context(device: string) {
  return {
    accountId,
    deviceId: device,
    deviceKeyFingerprint: "a".repeat(64),
    verifiedAt: Date.now(),
    offlineUntil: Date.now() + 3600000,
    geographies: [{ id: geographyId, label: "Synthetic village" }],
  };
}
const farmer = {
  farmerId: randomUUID(),
  fullName: "Synthetic recovery farmer",
  geographyId,
  privacyNoticeProvided: true as const,
};
async function fixture() {
  const source = box(accountId, deviceId);
  await source.initialize(pass);
  await source.writeContext(context(deviceId));
  const id = await source.saveDraft(farmer);
  await source.queue(id);
  await source.writeWorking(
    {
      farmerId: randomUUID(),
      fullName: "Synthetic unfinished",
      geographyId: "",
      privacyNoticeProvided: false,
    },
    0,
  );
  const targetDevice = randomUUID(),
    target = box(accountId, targetDevice);
  await target.initialize(nextPass);
  await target.writeContext(context(targetDevice));
  return {
    source,
    target,
    id,
    raw: await source.exportAuthenticatedArchive(),
    targetDevice,
  };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const value of boxes.splice(0)) value.close();
  for (const name of new Set(names.splice(0)))
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
});
it("restores stable mutation IDs and all incomplete versions under a new device key without importing old authority", async () => {
  const { source, target, id, raw, targetDevice } = await fixture();
  expect(raw).not.toContain(farmer.fullName);
  await target.importAuthenticatedArchive(raw, pass);
  expect(await target.list()).toEqual([{ id, status: "saved-on-device" }]);
  expect(await target.readDraft(id)).toEqual(farmer);
  expect((await target.readContext())?.deviceId).toBe(targetDevice);
  const recovered = await target.recoveredWorking();
  expect(recovered).toHaveLength(1);
  expect(await target.readWorking()).toBeNull();
  await target.activateRecovered(recovered[0].slot);
  expect((await target.readWorking())?.value.fullName).toBe(
    "Synthetic unfinished",
  );
  expect(await target.recoveredWorking()).toEqual([]);
  expect(await source.list()).toEqual([{ id, status: "pending-sync" }]);
  target.lock();
  await expect(target.unlock(pass)).rejects.toThrow();
  await target.unlock(nextPass);
  expect(await target.readDraft(id)).toEqual(farmer);
});
it("rejects wrong passphrases, truncated archives and envelope tampering before writing any rows", async () => {
  const { target, raw } = await fixture();
  const envelope = JSON.parse(raw);
  for (const candidate of [
    raw.slice(0, -20),
    JSON.stringify({
      ...envelope,
      database: vaultName(accountId, randomUUID()),
    }),
    JSON.stringify({
      ...envelope,
      ciphertext: envelope.ciphertext.slice(0, -10),
    }),
  ]) {
    await expect(
      target.importAuthenticatedArchive(candidate, pass),
    ).rejects.toThrow();
    expect(await target.list()).toEqual([]);
    expect(await target.recoveredWorking()).toEqual([]);
  }
  await expect(
    target.importAuthenticatedArchive(raw, "wrong-synthetic-passphrase"),
  ).rejects.toThrow();
  expect(await target.list()).toEqual([]);
});
it("refuses a different account and retains pre-existing target work", async () => {
  const { target, raw } = await fixture();
  await target.writeContext({
    ...context(randomUUID()),
    accountId: randomUUID(),
  });
  await expect(target.importAuthenticatedArchive(raw, pass)).rejects.toThrow(
    "Original account",
  );
  await target.writeContext(context(randomUUID()));
  const own = {
    ...farmer,
    farmerId: randomUUID(),
    fullName: "Synthetic existing",
  };
  const id = await target.saveDraft(own);
  await expect(target.importAuthenticatedArchive(raw, pass)).rejects.toThrow(
    "empty target",
  );
  expect(await target.readDraft(id)).toEqual(own);
  expect(await target.recoveredWorking()).toEqual([]);
});
it("rolls back the entire import on storage failure and permits a complete retry", async () => {
  const { target, raw, id } = await fixture();
  // Fail after mutation insertion, while writing the recovered draft table.
  const db = (
    target as unknown as { db: { working: { bulkAdd: () => Promise<void> } } }
  ).db;
  const write = vi
    .spyOn(db.working, "bulkAdd")
    .mockRejectedValueOnce(
      new DOMException("Synthetic quota", "QuotaExceededError"),
    );
  await expect(target.importAuthenticatedArchive(raw, pass)).rejects.toThrow(
    "Synthetic quota",
  );
  expect(await target.list()).toEqual([]);
  write.mockRestore();
  await target.importAuthenticatedArchive(raw, pass);
  expect(await target.readDraft(id)).toEqual(farmer);
});
it("retains both durable and unsaved recovery versions without overwriting the active draft", async () => {
  const { source, target } = await fixture();
  const stale = box(accountId, deviceId);
  await stale.unlock(pass);
  const original = (await stale.readWorking())!;
  await source.writeWorking(
    { ...original.value, fullName: "Synthetic durable newer" },
    1,
  );
  await expect(
    stale.writeWorking(
      { ...original.value, fullName: "Synthetic unsaved alternative" },
      1,
    ),
  ).rejects.toThrow();
  const raw = await stale.exportAuthenticatedArchive();
  await target.importAuthenticatedArchive(raw, pass);
  const drafts = await target.recoveredWorking();
  expect(drafts.map((row) => row.value.fullName).sort()).toEqual([
    "Synthetic durable newer",
    "Synthetic unsaved alternative",
  ]);
  await target.activateRecovered(drafts[0].slot);
  await expect(target.activateRecovered(drafts[1].slot)).rejects.toThrow(
    "Existing working",
  );
  expect(await target.recoveredWorking()).toHaveLength(1);
});
it("does not treat archived synchronization status as fresh confirmation", async () => {
  const { source, target, id } = await fixture();
  await source.syncPending(async () => ({ status: "synced" }));
  await target.importAuthenticatedArchive(
    await source.exportAuthenticatedArchive(),
    pass,
  );
  await expect(target.removeSynced(id)).rejects.toThrow("synchronized");
  expect((await target.list())[0].status).toBe("saved-on-device");
});
it("rejects legacy preservation archives and oversized input without replacing existing storage", async () => {
  const { source, target } = await fixture();
  await expect(
    target.importAuthenticatedArchive(
      await source.exportEncryptedArchive(),
      pass,
    ),
  ).rejects.toThrow();
  await expect(openArchive("x".repeat(10000001), pass, crypto)).rejects.toThrow(
    "size limit",
  );
  expect(await target.list()).toEqual([]);
});
