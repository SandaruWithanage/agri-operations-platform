// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  SessionAccess,
  type StoredSession,
} from "../src/authentication/session-access";
const now = 1000;
const session: StoredSession = {
  id: "session",
  accountId: "account",
  accountActive: true,
  revokedAt: null,
  idleExpiresAt: 2000,
  absoluteExpiresAt: 3000,
  deviceRequired: true,
  deviceApproved: true,
  deviceRevokedAt: null,
};
const token = { issuer: "agri", subject: "account", sessionId: "session" };
function service(value: StoredSession | null) {
  return new SessionAccess(
    { verify: vi.fn().mockResolvedValue(token) },
    { findById: vi.fn().mockResolvedValue(value) },
    () => now,
  );
}
describe("authoritative session access checks", () => {
  it("allows a current account session on an approved device", async () => {
    expect(await service(session).authenticate("signed-token")).toEqual({
      accountId: "account",
      sessionId: "session",
    });
  });
  it("denies missing, revoked, expired and mismatched sessions", async () => {
    for (const value of [
      null,
      { ...session, revokedAt: 0 },
      { ...session, idleExpiresAt: now },
      { ...session, absoluteExpiresAt: now },
      { ...session, accountId: "other" },
      { ...session, id: "other" },
      { ...session, accountActive: false },
    ]) {
      await expect(service(value).authenticate("signed-token")).rejects.toThrow(
        "Unauthorized",
      );
    }
  });
  it("denies unapproved or revoked devices when a device is required", async () => {
    await expect(
      service({ ...session, deviceApproved: false }).authenticate(
        "signed-token",
      ),
    ).rejects.toThrow("Unauthorized");
    await expect(
      service({ ...session, deviceRevokedAt: 0 }).authenticate("signed-token"),
    ).rejects.toThrow("Unauthorized");
  });
  it("does not read a session when token verification fails", async () => {
    const findById = vi.fn();
    const access = new SessionAccess(
      { verify: vi.fn().mockRejectedValue(new Error("bad token")) },
      { findById },
    );
    await expect(access.authenticate("bad")).rejects.toThrow();
    expect(findById).not.toHaveBeenCalled();
  });
});
