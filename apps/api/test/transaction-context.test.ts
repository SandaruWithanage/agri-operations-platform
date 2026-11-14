// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { TransactionActorContext } from "../src/authorization/transaction-context";
const actor = {
  accountId: "a50456eb-af66-41f0-8c38-0bc827249cd2",
  sessionId: "11b492ca-bcb4-4662-91d9-88789a80a0c2",
};
describe("transaction-bound actor context", () => {
  it("binds a server-verified actor and session to the database transaction ID", async () => {
    const key = Buffer.alloc(32, 42);
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "12345" }] })
      .mockResolvedValueOnce({ rows: [] });
    await new TransactionActorContext(key).bind({ query }, actor);
    const signature = createHmac("sha256", key)
      .update(`${actor.accountId}:${actor.sessionId}:12345`)
      .digest("hex");
    expect(query.mock.calls[1][1]).toEqual([
      actor.accountId,
      actor.sessionId,
      signature,
    ]);
  });
  it("commits success and rolls back work errors on the same connection", async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => ({
      rows: sql.includes("txid_current") ? [{ id: "12345" }] : [],
    }));
    const context = new TransactionActorContext(Buffer.alloc(32, 42));
    await expect(context.run({ query }, actor, async () => "ok")).resolves.toBe(
      "ok",
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    await expect(
      context.run({ query }, actor, async () => {
        throw new Error("failure");
      }),
    ).rejects.toThrow("failure");
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
  it("rejects malformed identities and weak keys before setting context", async () => {
    expect(() => new TransactionActorContext(Buffer.alloc(16))).toThrow();
    const query = vi.fn();
    await expect(
      new TransactionActorContext(Buffer.alloc(32)).bind(
        { query },
        { ...actor, accountId: "invalid" },
      ),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
