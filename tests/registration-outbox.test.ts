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

it("opens a legacy version-one vault with its original KDF and preserves its pending mutation during upgrade", async () => {
  const name = `test-legacy-kdf-${cryptoApi.randomUUID()}`;
  databases.push(name);
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const material = await cryptoApi.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await cryptoApi.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const verifier = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode("agri-offline-vault-v1"),
  );
  const id = cryptoApi.randomUUID(),
    draftIv = cryptoApi.getRandomValues(new Uint8Array(12));
  const ciphertext = await cryptoApi.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: draftIv,
      additionalData: new TextEncoder().encode(id),
    },
    key,
    new TextEncoder().encode(JSON.stringify(sample)),
  );
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 10);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("config", { keyPath: "id" });
      request.result
        .createObjectStore("mutations", { keyPath: "id" })
        .createIndex("status", "status");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(["config", "mutations"], "readwrite");
    transaction.objectStore("config").add({ id: "vault", salt, iv, verifier });
    transaction
      .objectStore("mutations")
      .add({ id, status: "pending-sync", iv: draftIv, ciphertext });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  const upgraded = create(name).box;
  await upgraded.unlock(passphrase);
  expect(await upgraded.readDraft(id)).toEqual(sample);
  expect(await upgraded.list()).toEqual([{ id, status: "pending-sync" }]);
  await upgraded.recoverLegacyIndexes();
  expect(await upgraded.saveDraft(sample)).toBe(id);
});

it("reports in-flight progress without persisting a non-retryable state; lock/restart retains the same mutation", async () => {
  const { box, name } = create();
  await box.initialize(passphrase);
  const id = await box.saveDraft(sample);
  await box.queue(id);
  let finish!: (result: { status: "synced" }) => void;
  const progress = vi.fn(),
    sender = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const pending = box.syncPending(sender, progress);
  await vi.waitFor(() => expect(progress).toHaveBeenCalledWith(id));
  expect(await box.list()).toEqual([{ id, status: "pending-sync" }]);
  const archive = await box.exportEncryptedArchive();
  expect(archive).not.toContain('"status":"syncing"');
  box.lock();
  const rejected = expect(pending).rejects.toThrow("Vault locked");
  finish({ status: "synced" });
  await rejected;
  expect(progress).toHaveBeenLastCalledWith(null);
  const next = create(name).box;
  await next.unlock(passphrase);
  expect(await next.list()).toEqual([{ id, status: "pending-sync" }]);
  const retry = vi.fn().mockResolvedValue({ status: "synced" });
  await next.syncPending(retry);
  expect(retry).toHaveBeenCalledWith(id, sample);
  expect(await next.list()).toEqual([{ id, status: "synced" }]);
});
it("clears in-flight presentation after interruption and isolates failing display observers", async () => {
  const { box } = create();
  await box.initialize(passphrase);
  const id = await box.saveDraft(sample);
  await box.queue(id);
  const progress = vi.fn();
  await expect(
    box.syncPending(async () => {
      throw new Error("Synthetic network loss");
    }, progress),
  ).rejects.toThrow("Synthetic network loss");
  expect(progress.mock.calls).toEqual([[id], [null]]);
  expect(await box.list()).toEqual([{ id, status: "pending-sync" }]);
  await box.syncPending(
    async () => ({ status: "conflict" }),
    () => {
      throw new Error("Synthetic presentation failure");
    },
  );
  expect(await box.list()).toEqual([{ id, status: "conflict" }]);
  expect(await box.readDraft(id)).toEqual(sample);
});
