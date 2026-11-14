// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/authentication/passwords";
describe("Argon2id password primitive", () => {
  it("uses random salts and verifies the right password only", async () => {
    const first = await hashPassword("synthetic-password-one");
    const second = await hashPassword("synthetic-password-one");
    expect(first.startsWith("$argon2id$")).toBe(true);
    expect(first).not.toBe(second);
    expect(await verifyPassword("synthetic-password-one", first)).toBe(true);
    expect(await verifyPassword("synthetic-password-two", first)).toBe(false);
  });
  it("rejects malformed hashes, other algorithms and unbounded inputs", async () => {
    await expect(hashPassword("")).rejects.toThrow();
    await expect(hashPassword("a".repeat(1025))).rejects.toThrow();
    expect(await verifyPassword("synthetic", "$argon2id$invalid")).toBe(false);
    expect(await verifyPassword("synthetic", "$2b$invalid")).toBe(false);
    expect(
      await verifyPassword(
        "synthetic",
        "$argon2id$v=19$m=100000000,t=2,p=1$abc$xyz",
      ),
    ).toBe(false);
  });
});
