import type { VerifiedToken } from "./access-token-verifier";

/** Values must be obtained from the authoritative session/account/device store on every request. */
export type StoredSession = {
  id: string;
  accountId: string;
  accountActive: boolean;
  revokedAt: number | null;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  deviceRequired: boolean;
  deviceApproved: boolean;
  deviceRevokedAt: number | null;
};
export interface SessionReader {
  findById(id: string): Promise<StoredSession | null>;
}
export interface TokenReader {
  verify(token: string): Promise<VerifiedToken>;
}

/** Not registered on endpoints; a real DB reader, idle renewal, MFA and CSRF are still required. */
export class SessionAccess {
  constructor(
    private readonly tokens: TokenReader,
    private readonly sessions: SessionReader,
    private readonly now: () => number = Date.now,
  ) {}
  async authenticate(
    token: string,
  ): Promise<{ accountId: string; sessionId: string }> {
    const verified = await this.tokens.verify(token);
    const session = await this.sessions.findById(verified.sessionId);
    const now = this.now();
    if (
      !Number.isFinite(now) ||
      !session ||
      session.id !== verified.sessionId ||
      session.accountId !== verified.subject ||
      session.accountActive !== true ||
      session.revokedAt !== null ||
      !Number.isFinite(session.idleExpiresAt) ||
      !Number.isFinite(session.absoluteExpiresAt) ||
      now >= session.idleExpiresAt ||
      now >= session.absoluteExpiresAt ||
      typeof session.deviceRequired !== "boolean" ||
      session.deviceRevokedAt !== null ||
      (session.deviceRequired && session.deviceApproved !== true)
    )
      throw new Error("Unauthorized");
    return { accountId: session.accountId, sessionId: session.id };
  }
}
