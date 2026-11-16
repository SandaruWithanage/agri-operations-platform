// @vitest-environment node
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  enrollmentCreateSchema,
  enrollmentQuerySchema,
  enrollmentWithdrawSchema,
} from "../packages/validation/src";
import { ProjectEnrollmentService } from "../apps/api/src/project/enrollment-service";
import {
  TransactionActorContext,
  type ActorQuery,
} from "../apps/api/src/authorization/transaction-context";
import { PilotController } from "../apps/api/src/pilot/pilot.controller";
import type { PilotRuntime } from "../apps/api/src/pilot/contracts";

const actor = { accountId: randomUUID(), sessionId: randomUUID() };
const create = {
  mutationId: randomUUID(),
  enrollmentId: randomUUID(),
  projectId: randomUUID(),
  farmerId: randomUUID(),
};
const service = new ProjectEnrollmentService(
  new TransactionActorContext(Buffer.alloc(32, 42)),
);
function fixture(rows: unknown[] = []) {
  const query = vi.fn<ActorQuery["query"]>(async (sql: string) => {
    if (sql.includes("txid_current")) return { rows: [{ id: "123" }] };
    if (sql.includes("operations.")) return { rows };
    return { rows: [] };
  });
  return { query };
}
const statements = (db: ReturnType<typeof fixture>) =>
  db.query.mock.calls.filter(([sql]) => sql.includes("operations."));

it("accepts only strict, canonical contracts and rejects authority fields", () => {
  expect(
    enrollmentCreateSchema.parse({
      ...create,
      projectId: create.projectId.toUpperCase(),
    }).projectId,
  ).toBe(create.projectId);
  for (const extra of [
    { source: "administrator" },
    { accountId: actor.accountId },
    { organizationId: randomUUID() },
    { role: "administrator" },
    { status: "enrolled" },
  ])
    expect(() =>
      enrollmentCreateSchema.parse({ ...create, ...extra }),
    ).toThrow();
  expect(() =>
    enrollmentCreateSchema.parse({ ...create, farmerId: "x" }),
  ).toThrow();
  for (const expectedVersion of [0, -1, 1.5, 2147483646])
    expect(() =>
      enrollmentWithdrawSchema.parse({
        mutationId: create.mutationId,
        enrollmentId: create.enrollmentId,
        expectedVersion,
      }),
    ).toThrow();
  expect(enrollmentQuerySchema.parse({}).limit).toBe(25);
  for (const query of [
    { limit: 0 },
    { limit: 101 },
    { status: "all" },
    { x: 1 },
  ])
    expect(() => enrollmentQuerySchema.parse(query)).toThrow();
});

it.each(["administrator", "field_officer"] as const)(
  "enrolls through the fixed function with the trusted %s source",
  async (source) => {
    const db = fixture([
      { enrollment_id: create.enrollmentId, version: 1, replayed: false },
    ]);
    expect(await service.enroll(db, actor, source, create)).toEqual({
      enrollmentId: create.enrollmentId,
      version: 1,
      replayed: false,
    });
    const [call] = statements(db);
    expect(call[0]).toContain("operations.enroll_farmer");
    expect(call[1]).toEqual([
      create.mutationId,
      create.enrollmentId,
      create.projectId,
      create.farmerId,
      source,
    ]);
    expect(db.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  },
);

it("rejects an untrusted source or malformed input before touching the database", async () => {
  const db = fixture();
  await expect(
    service.enroll(db, actor, "browser" as never, create),
  ).rejects.toThrow();
  await expect(
    service.enroll(db, actor, "administrator", { ...create, role: "admin" }),
  ).rejects.toThrow();
  expect(db.query).not.toHaveBeenCalled();
});

it("rolls back and fails closed when the function returns nothing or invalid data", async () => {
  const empty = fixture([]);
  await expect(
    service.enroll(empty, actor, "administrator", create),
  ).rejects.toMatchObject({ status: 403 });
  expect(empty.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  const invalid = fixture([
    { enrollment_id: "x", version: 0, replayed: "yes" },
  ]);
  await expect(
    service.withdraw(invalid, actor, "administrator", {
      mutationId: create.mutationId,
      enrollmentId: create.enrollmentId,
      expectedVersion: 1,
    }),
  ).rejects.toThrow();
  expect(invalid.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
});

it("pages with a bounded keyset and treats unreadable detail as not found", async () => {
  const row = (n: number) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    organization_id: randomUUID(),
    project_id: create.projectId,
    farmer_id: create.farmerId,
    status: "enrolled",
    version: 1,
    enrolled_at: new Date("2026-11-16T00:00:00Z"),
    withdrawn_at: null,
  });
  const db = fixture([row(1), row(2), row(3)]);
  const page = await service.list(db, actor, { limit: 2 });
  expect(page.items.map((item) => item.id)).toEqual([row(1).id, row(2).id]);
  expect(page.nextCursor).toBe(row(2).id);
  expect(statements(db)[0][1]).toEqual([null, null, null, null, 3]);
  await expect(
    service.detail(fixture([]), actor, { id: randomUUID() }),
  ).rejects.toMatchObject({ status: 404 });
});

function controller(failure: unknown) {
  const runtime = {
    internalKey: "synthetic-internal-key",
    authenticate: async () => actor,
    assertCsrf: () => undefined,
    enrollFarmer: async () => {
      throw failure;
    },
  } as unknown as PilotRuntime;
  return new PilotController(runtime);
}
it.each([
  ["55000", 409],
  ["23505", 409],
  ["40001", 409],
  ["42501", 403],
  ["22023", 400],
])(
  "maps database code %s to HTTP %i without leaking details",
  async (code, status) => {
    await expect(
      controller({ code, message: "synthetic internal detail" }).enrollFarmer(
        "synthetic-internal-key",
        "Bearer synthetic",
        "administrator",
        "https://admin.example.test",
        "csrf",
        create,
      ),
    ).rejects.toMatchObject({ status });
  },
);
