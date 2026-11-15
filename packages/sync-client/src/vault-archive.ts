import {
  encryptedArchiveContentsSchema,
  encryptedArchiveEnvelopeSchema,
  farmerRegistrationSchema,
  workingRegistrationSchema,
  offlineReferenceContextSchema,
  type FarmerRegistration,
  type WorkingRegistration,
} from "@agri/validation";
import { deriveVaultKey } from "./vault-crypto";
import { vaultName } from "./vault-catalog";
import type { LocalStatus } from "./registration-outbox";
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const maxArchive = 10_000_000;
function encode(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
function aad(database: string) {
  return encoder.encode(`agri-encrypted-archive-v2:${database}`);
}
export async function sealArchive(
  raw: string,
  key: CryptoKey,
  crypto: Crypto,
): Promise<string> {
  if (raw.length > 6_000_000) throw new Error("Archive size limit exceeded");
  const data = encryptedArchiveContentsSchema.parse(JSON.parse(raw));
  const config = data.config[0];
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(data.database) },
    key,
    encoder.encode(raw),
  );
  const result = JSON.stringify({
    format: "agri-encrypted-archive",
    version: 2,
    database: data.database,
    salt: config.salt,
    iterations: config.iterations ?? 310000,
    iv: { bytes: Array.from(iv) },
    ciphertext: encode(ciphertext),
  });
  if (result.length > maxArchive)
    throw new Error("Archive size limit exceeded");
  return result;
}
export type ArchiveRecovery = {
  accountId: string;
  deviceId: string;
  mutations: Array<{
    id: string;
    status: LocalStatus;
    farmer: FarmerRegistration;
  }>;
  working: WorkingRegistration[];
};
/** Decrypt and validate the entire archive before callers may perform any durable write. */
export async function openArchive(
  raw: string,
  passphrase: string,
  crypto: Crypto = globalThis.crypto,
): Promise<ArchiveRecovery> {
  if (raw.length > maxArchive) throw new Error("Archive size limit exceeded");
  const envelope = encryptedArchiveEnvelopeSchema.parse(JSON.parse(raw));
  const key = await deriveVaultKey(
    crypto,
    passphrase,
    new Uint8Array(envelope.salt.bytes),
    envelope.iterations,
  );
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(envelope.iv.bytes),
      additionalData: aad(envelope.database),
    },
    key,
    decode(envelope.ciphertext),
  );
  if (plain.byteLength > 6_000_000)
    throw new Error("Archive size limit exceeded");
  const data = encryptedArchiveContentsSchema.parse(
    JSON.parse(decoder.decode(plain)),
  );
  const config = data.config[0];
  if (
    data.database !== envelope.database ||
    JSON.stringify(config.salt) !== JSON.stringify(envelope.salt) ||
    (config.iterations ?? 310000) !== envelope.iterations
  )
    throw new Error("Archive binding mismatch");
  const accountId = data.database.slice(21, 57),
    deviceId = data.database.slice(58);
  if (vaultName(accountId, deviceId) !== data.database)
    throw new Error("Archive binding mismatch");
  const verifier = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(config.iv.bytes) },
    key,
    new Uint8Array(config.verifier.bytes),
  );
  if (decoder.decode(verifier) !== "agri-offline-vault-v1")
    throw new Error("Archive verifier mismatch");
  async function value(row: (typeof data.working)[number]) {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(row.iv.bytes),
        additionalData: encoder.encode(
          `${data.database}:${row.id}:${row.revision}`,
        ),
      },
      key,
      new Uint8Array(row.ciphertext.bytes),
    );
    return JSON.parse(decoder.decode(plain));
  }
  const reference = data.metadata[0];
  if (reference.id !== "references")
    throw new Error("Invalid archive references");
  const context = offlineReferenceContextSchema.parse(await value(reference));
  if (context.accountId !== accountId || context.deviceId !== deviceId)
    throw new Error("Archive account mismatch");
  const mutations: ArchiveRecovery["mutations"] = [];
  const ids = new Set<string>(),
    farmers = new Set<string>();
  for (const row of data.mutations) {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(row.iv.bytes),
        additionalData: encoder.encode(row.id),
      },
      key,
      new Uint8Array(row.ciphertext.bytes),
    );
    const farmer = farmerRegistrationSchema.parse(
      JSON.parse(decoder.decode(plain)),
    );
    // Strictly reject sensitive/non-minimal payloads even if otherwise valid registrations.
    workingRegistrationSchema.strict().parse(farmer);
    if (ids.has(row.id) || farmers.has(farmer.farmerId))
      throw new Error("Duplicate archive identifiers");
    ids.add(row.id);
    farmers.add(farmer.farmerId);
    mutations.push({ id: row.id, status: row.status, farmer });
  }
  const working: WorkingRegistration[] = [];
  for (const row of [
    ...data.working,
    ...(data.recovery ? [data.recovery] : []),
  ]) {
    const draft = workingRegistrationSchema.parse(await value(row));
    if (
      !working.some(
        (previous) => JSON.stringify(previous) === JSON.stringify(draft),
      )
    )
      working.push(draft);
  }
  return { accountId, deviceId, mutations, working };
}
