/** Shared bounded KDF for local vaults and authenticated recovery archives. */
export async function deriveVaultKey(
  crypto: Crypto,
  passphrase: string,
  salt: Uint8Array,
  iterations = 600_000,
): Promise<CryptoKey> {
  if (passphrase.length < 12 || passphrase.length > 256)
    throw new Error("Passphrase must be 12 to 256 characters");
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 310_000 ||
    iterations > 2_000_000
  )
    throw new Error("Invalid vault derivation policy");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new Uint8Array(salt),
      iterations,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
