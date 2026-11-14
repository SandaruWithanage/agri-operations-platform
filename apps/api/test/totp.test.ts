// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTotpSecret, verifyTotp } from "../src/authentication/totp";
import {
  decryptMfaSecret,
  encryptMfaSecret,
} from "../src/authentication/mfa-secret";
const account = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const factor = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
describe("provisional MFA primitives", () => {
  it("checks the RFC 6238 SHA-1 vector and refuses replayed counters", () => {
    const secret = Buffer.from("12345678901234567890", "ascii");
    expect(verifyTotp(secret, "287082", 59_000, -1)).toBe(1);
    expect(verifyTotp(secret, "287082", 59_000, 1)).toBeNull();
    expect(verifyTotp(secret, "999999", 59_000, -1)).toBeNull();
    expect(verifyTotp(secret, "12345", 59_000, -1)).toBeNull();
  });
  it("encrypts factor secrets with authenticated identity binding", () => {
    const key = Buffer.alloc(32, 8);
    const secret = createTotpSecret();
    const protectedValue = encryptMfaSecret(secret, key, account, factor);
    expect(protectedValue.ciphertext.equals(secret)).toBe(false);
    expect(decryptMfaSecret(protectedValue, key, account, factor)).toEqual(
      secret,
    );
    expect(() =>
      decryptMfaSecret(protectedValue, key, factor, account),
    ).toThrow();
    const changed = { ...protectedValue, tag: Buffer.alloc(16) };
    expect(() => decryptMfaSecret(changed, key, account, factor)).toThrow();
  });
});
