// @vitest-environment node
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";
import { RegistrationOutbox } from "../packages/sync-client/src";

const cryptoApi = webcrypto as unknown as Crypto;
const passphrase = "synthetic-test-passphrase";
const sample = {
  farmerId: "b94a097c-18d6-4cec-ae1b-66fce2b47e05",
  fullName: "Synthetic farmer",
  geographyId: "4e743f19-e3f7-4ed0-bdcc-29fe8e71ff0d",
  privacyNoticeProvided: true as const,
};
const databases: string[] = [];
const openOutboxes: RegistrationOutbox[] = [];
function create(name = `test-${cryptoApi.randomUUID()}`, idle = 300_000) {
  databases.push(name);
  const box = new RegistrationOutbox(name, cryptoApi, idle);
  openOutboxes.push(box);
  return { box, name };
}
afterEach(async () => {
  for (const box of openOutboxes.splice(0)) box.close();
  for (const name of new Set(databases.splice(0)))
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
});

describe("encrypted registration outbox prototype", () => {
  it("persists the minimal draft as ciphertext and requires unlock after restart", async () => {
    const { box, name } = create();
    await box.initialize(passphrase);
    const id = await box.saveDraft(sample);
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<unknown>((resolve, reject) => {
      const request = raw
        .transaction("mutations")
        .objectStore("mutations")
        .get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(JSON.stringify(record)).not.toContain(sample.fullName);
    expect(JSON.stringify(record)).not.toContain(sample.geographyId);
    raw.close();
    box.close();
    const next = create(name).box;
    await expect(next.readDraft(id)).rejects.toThrow("locked");
    await expect(next.unlock("wrong-passphrase-value")).rejects.toThrow(
      "Unable to unlock",
    );
    await next.unlock(passphrase);
    expect(await next.readDraft(id)).toEqual(sample);
  });
  it("safely retries the same local farmer UUID and rejects a changed payload", async () => {
    const { box } = create();
    await box.initialize(passphrase);
    const [first, second] = await Promise.all([
      box.saveDraft(sample),
      box.saveDraft(sample),
    ]);
    expect(first).toBe(second);
    expect(await box.list()).toHaveLength(1);
    await expect(
      box.saveDraft({ ...sample, fullName: "Different synthetic name" }),
    ).rejects.toThrow("different saved draft");
    expect(await box.readDraft(first)).toEqual(sample);
  });
  it("preserves legacy entries until their encrypted indexes are recovered", async () => {
    const { box, name } = create();
    await box.initialize(passphrase);
    const id = await box.saveDraft(sample);
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = raw.transaction("mutations", "readwrite");
      const store = tx.objectStore("mutations");
      const request = store.get(id);
      request.onsuccess = () => {
        const row = request.result;
        delete row.fingerprint;
        store.put(row);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    raw.close();
    await expect(box.saveDraft(sample)).rejects.toThrow(
      "Legacy drafts require recovery",
    );
    expect(await box.readDraft(id)).toEqual(sample);
    await box.recoverLegacyIndexes();
    expect(await box.saveDraft(sample)).toBe(id);
    expect(await box.list()).toHaveLength(1);
  });
  it("does not silently discard optional offline data or allow unsafe deletion", async () => {
    const { box } = create();
    await box.initialize(passphrase);
    await expect(
      box.saveDraft({ ...sample, phone: "0700000000" }),
    ).rejects.toThrow("minimal offline");
    const id = await box.saveDraft(sample);
    await expect(box.removeSynced(id)).rejects.toThrow("Only synchronized");
    await box.queue(id);
    await expect(box.removeSynced(id)).rejects.toThrow("Only synchronized");
    expect((await box.list())[0].status).toBe("pending-sync");
  });
  it("retains pending after network interruption, retries with the same id and only removes after acknowledgment", async () => {
    const { box } = create();
    await box.initialize(passphrase);
    const id = await box.saveDraft(sample);
    await box.queue(id);
    const fail = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(box.syncPending(fail)).rejects.toThrow("offline");
    expect((await box.list())[0].status).toBe("pending-sync");
    const send = vi.fn().mockResolvedValue({ status: "synced" });
    await box.syncPending(send);
    expect(send).toHaveBeenCalledExactlyOnceWith(id, sample);
    expect((await box.list())[0].status).toBe("synced");
    await box.removeSynced(id);
    expect(await box.list()).toEqual([]);
  });
  it.each(["conflict", "rejected"] as const)(
    "retains %s data for review",
    async (status) => {
      const { box } = create();
      await box.initialize(passphrase);
      const id = await box.saveDraft(sample);
      await box.queue(id);
      await box.syncPending(async () => ({ status }));
      expect((await box.list())[0].status).toBe(status);
      await expect(box.removeSynced(id)).rejects.toThrow();
      expect(await box.readDraft(id)).toEqual(sample);
    },
  );
  it("does not mark a response synced if the vault locked during the request", async () => {
    const { box } = create();
    await box.initialize(passphrase);
    const id = await box.saveDraft(sample);
    await box.queue(id);
    let release!: (value: { status: "synced" }) => void;
    let sent!: () => void;
    const started = new Promise<void>((resolve) => {
      sent = resolve;
    });
    const response = new Promise<{ status: "synced" }>((resolve) => {
      release = resolve;
    });
    const pending = box.syncPending(async () => {
      sent();
      return response;
    });
    await started;
    box.lock();
    release({ status: "synced" });
    await expect(pending).rejects.toThrow("locked");
    await box.unlock(passphrase);
    expect((await box.list())[0].status).toBe("pending-sync");
  });
  it("locks after inactivity", async () => {
    const { box } = create(undefined, 40);
    await box.initialize(passphrase);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await expect(box.list()).rejects.toThrow("locked");
  });
});
