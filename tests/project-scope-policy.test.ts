// @vitest-environment node
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { ProjectScopePolicy } from "../apps/api/src/project/scope-policy";
import {
  TransactionActorContext,
  type ActorQuery,
} from "../apps/api/src/authorization/transaction-context";

const actor = { accountId: randomUUID(), sessionId: randomUUID() };
const target = { projectId: randomUUID(), geographyId: randomUUID() };
const policy = new ProjectScopePolicy(
  new TransactionActorContext(Buffer.alloc(32, 42)),
);
function fixture(permissions: unknown[] = [true, true]) {
  const query = vi.fn<ActorQuery["query"]>(async (sql: string) => {
    if (sql.includes("txid_current")) return { rows: [{ id: "123" }] };
    if (sql.includes("allowed_project_geography"))
      return { rows: [{ permitted: permissions.shift() }] };
    return { rows: [] };
  });
  return { query };
}
it.each(["read", "administrator", "field_officer"] as const)(
  "checks the fixed %s permission before and after transaction-local work",
  async (kind) => {
    const db = fixture(),
      work = vi.fn().mockResolvedValue("synthetic result");
    const result =
      kind === "read"
        ? await policy.read(db, actor, target, work)
        : await policy.create(db, actor, kind, target, work);
    expect(result).toBe("synthetic result");
    expect(work).toHaveBeenCalledWith(db);
    const checks = db.query.mock.calls.filter(([sql]) =>
      sql.includes("allowed_project_geography"),
    );
    expect(checks).toHaveLength(2);
    for (const check of checks)
      expect(check[1]).toEqual([
        target.projectId,
        target.geographyId,
        kind === "read" ? "enrollment.read" : "enrollment.create",
        kind === "read" ? null : kind,
      ]);
    expect(db.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  },
);
it.each([false, null, undefined, "true", 1])(
  "denies a non-boolean database authorization result: %s",
  async (permitted) => {
    const db = fixture([permitted]),
      work = vi.fn();
    await expect(policy.read(db, actor, target, work)).rejects.toMatchObject({
      status: 403,
    });
    expect(work).not.toHaveBeenCalled();
    expect(db.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  },
);
it("rolls back completed database work when final scope/session authorization is lost", async () => {
  const db = fixture([true, false]),
    work = vi.fn().mockResolvedValue("not released");
  await expect(policy.read(db, actor, target, work)).rejects.toMatchObject({
    status: 403,
  });
  expect(work).toHaveBeenCalledOnce();
  expect(db.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
});
it("rolls back query failures and never returns partial work", async () => {
  const db = fixture();
  await expect(
    policy.create(db, actor, "field_officer", target, async () => {
      throw new Error("synthetic failure");
    }),
  ).rejects.toThrow("synthetic failure");
  expect(db.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
});
it("rejects injected account/source/permission/scope fields and invalid IDs before opening a transaction", async () => {
  for (const extra of [
    { accountId: actor.accountId },
    { source: "administrator" },
    { permission: "project.read" },
    { organizationId: randomUUID() },
    { geographyId: "invalid" },
  ]) {
    const db = fixture(),
      work = vi.fn();
    await expect(
      policy.read(db, actor, { ...target, ...extra }, work),
    ).rejects.toThrow();
    expect(db.query).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  }
});
it("normalizes target UUIDs while retaining the trusted actor transaction", async () => {
  const db = fixture();
  await policy.read(
    db,
    actor,
    {
      projectId: target.projectId.toUpperCase(),
      geographyId: target.geographyId.toUpperCase(),
    },
    async () => undefined,
  );
  const bind = db.query.mock.calls.find(([sql]) => sql.includes("set_config"));
  expect(bind?.[1]).toEqual([
    actor.accountId,
    actor.sessionId,
    expect.stringMatching(/^[0-9a-f]{64}$/),
  ]);
});
