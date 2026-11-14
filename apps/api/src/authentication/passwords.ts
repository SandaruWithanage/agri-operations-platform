import { Algorithm, hash, verify } from "@node-rs/argon2";

// Isolated cryptographic primitive; account lookup, login throttling, MFA and sessions are not yet wired.
const options = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;
function validInput(password: string): boolean {
  return (
    typeof password === "string" &&
    Buffer.byteLength(password, "utf8") > 0 &&
    Buffer.byteLength(password, "utf8") <= 1024
  );
}
export async function hashPassword(password: string): Promise<string> {
  if (!validInput(password)) throw new Error("Invalid password length");
  return hash(password, options);
}
export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  if (!validInput(password) || encodedHash.length > 512) return false;
  // Bound work when reading a damaged or malicious encoded hash from storage.
  const parameters = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(
    encodedHash,
  );
  if (!parameters) return false;
  const [, memory, iterations, parallelism] = parameters.map(Number);
  if (
    memory < 8192 ||
    memory > 65536 ||
    iterations < 1 ||
    iterations > 5 ||
    parallelism < 1 ||
    parallelism > 4
  )
    return false;
  try {
    return await verify(encodedHash, password);
  } catch {
    return false;
  }
}
