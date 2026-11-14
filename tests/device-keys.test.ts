// @vitest-environment node
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { DeviceKeys } from "../packages/sync-client/src/device-keys";
import { PilotClient } from "../apps/field-pwa/lib/pilot-client";
import { DeviceProofs } from "../apps/api/src/authentication/device-proof";
const cryptoApi = webcrypto as unknown as Crypto;
const device = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const account = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const origin = "https://field.example.test";
const names: string[] = [];
const handles: DeviceKeys[] = [];
function store(name = `synthetic-keys-${cryptoApi.randomUUID()}`) {
  names.push(name);
  const keys = new DeviceKeys(name, cryptoApi);
  handles.push(keys);
  return { name, keys };
}
afterEach(async () => {
  for (const keys of handles.splice(0)) keys.close();
  for (const name of new Set(names.splice(0)))
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
});
it("persists a non-exportable signing key across restart and never replaces it on repeated enrollment", async () => {
  const first = store();
  const publicKey = await first.keys.prepare(device);
  first.keys.close();
  const second = store(first.name);
  expect(await second.keys.prepare(device)).toEqual(publicKey);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(first.name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const row = await new Promise<{
      privateKey: CryptoKey;
      publicKey: JsonWebKey;
    }>((resolve, reject) => {
      const request = db.transaction("keys").objectStore("keys").get(device);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(row.privateKey.extractable).toBe(false);
    await expect(
      cryptoApi.subtle.exportKey("jwk", row.privateKey),
    ).rejects.toThrow();
    expect(row.publicKey.d).toBeUndefined();
  } finally {
    db.close();
  }
  expect(await second.keys.sign(device, "test")).toMatch(/^[A-Za-z0-9_-]{86}$/);
});
it("does not silently generate a missing key at login and concurrent preparation keeps one stable key", async () => {
  const { keys, name } = store();
  await expect(keys.sign(device, "test")).rejects.toThrow("not enrolled");
  const other = store(name).keys;
  const [one, two] = await Promise.all([
    keys.prepare(device),
    other.prepare(device),
  ]);
  expect(one).toEqual(two);
});
it("uses browser WebCrypto through PilotClient and validates the resulting proof with the real server verifier", async () => {
  const { keys } = store();
  const publicKey = await keys.prepare(device);
  const database = {
    query: vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ key_id: device, public_jwk: publicKey }],
      })
      .mockResolvedValue({ rows: [{ ok: true }] }),
  };
  const verifier = new DeviceProofs(database, Buffer.alloc(32, 7), [origin]);
  const network = vi
    .fn()
    .mockImplementation(async (path: string, options: RequestInit) => {
      const input = JSON.parse(String(options.body));
      if (path.endsWith("device-challenge"))
        return Response.json(
          verifier.issue(input.loginName, input.deviceId, origin),
        );
      expect(input.accountId).toBeUndefined();
      expect(
        await verifier.verify(
          account,
          input.loginName,
          input.deviceId,
          origin,
          input.deviceProof,
        ),
      ).not.toBeNull();
      return Response.json({ signedIn: true });
    });
  const client = new PilotClient(network, {
    devices: () => keys,
    origin: () => origin,
  });
  const request = await client.prepareDevice(device);
  expect(request).toEqual({
    version: 1,
    deviceId: device,
    origin,
    publicKey,
    fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  await client.login({
    loginName: "synthetic",
    deviceId: device,
    password: "synthetic",
    otp: "123456",
  });
  expect(network).toHaveBeenCalledTimes(2);
});
