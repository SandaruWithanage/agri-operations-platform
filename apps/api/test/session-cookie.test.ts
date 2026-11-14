// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  clearSessionCookie,
  createSessionSecret,
  digestSessionSecret,
  sessionCookie,
} from "../src/authentication/session-cookie";
describe("opaque session cookies", () => {
  it("generates unique 256-bit secrets and stores only matching digests", () => {
    const first = createSessionSecret();
    const second = createSessionSecret();
    expect(first.secret).not.toBe(second.secret);
    expect(Buffer.from(first.secret, "base64url")).toHaveLength(32);
    expect(first.digest).toEqual(digestSessionSecret(first.secret));
    expect(first.digest).toHaveLength(32);
  });
  it("sets host-only secure httpOnly same-site cookies and clears them", () => {
    const { secret } = createSessionSecret();
    expect(sessionCookie(secret, 300)).toBe(
      `__Host-agri_session=${secret}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300`,
    );
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });
  it("rejects invalid inputs instead of allowing cookie-header injection", () => {
    expect(() => digestSessionSecret("bad; Path=/")).toThrow();
    expect(() => sessionCookie(createSessionSecret().secret, -1)).toThrow();
  });
});
