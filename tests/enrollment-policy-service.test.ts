// @vitest-environment node
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  enrollmentPolicySetSchema,
  enrollmentPolicyQuerySchema,
} from "../packages/validation/src";
import { EnrollmentPolicyService } from "../apps/api/src/project/enrollment-policy-service";
import {
  TransactionActorContext,
  type ActorQuery,
} from "../apps/api/src/authorization/transaction-context";

const actor = { accountId: randomUUID(), sessionId: randomUUID() };
const value = {
  mutationId: randomUUID(),
  projectId: randomUUID(),
  expectedVersion: 0,
  enabled: true,
  eligibleFarmerStatuses: ["verified"],
};
const service = new EnrollmentPolicyService(
  new TransactionActorContext(Buffer.alloc(32, 42)),
);
function fixture(rows: unknown[]) {
  const query = vi.fn<ActorQuery["query"]>(async (sql: string) => {
    if (sql.includes("txid_current")) return { rows: [{ id: "123" }] };
    if (sql.includes("operations.")) return { rows };
    return { rows: [] };
  });
  return { query } as unknown as ActorQuery & { query: typeof query };
}

it("accepts only strict, de-duplicated, known statuses and never trusted fields", () => {
  expect(enrollmentPolicySetSchema.parse(value)).toMatchObject({
    expectedVersion: 0,
  });
  for (const bad of [
    { eligibleFarmerStatuses: [] },
    { eligibleFarmerStatuses: ["verified", "verified"] },
    { eligibleFarmerStatuses: ["other"] },
    { expectedVersion: -1 },
    { enabled: "yes" },
    { source: "administrator" },
    { actorId: randomUUID() },
  ])
    expect(
      enrollmentPolicySetSchema.safeParse({ ...value, ...bad }).success,
    ).toBe(false);
  expect(enrollmentPolicyQuerySchema.safeParse({}).success).toBe(false);
});

it("passes the trusted source and parsed values to the fixed function only", async () => {
  const db = fixture([
    { project_id: value.projectId, version: 1, replayed: false },
  ]);
  expect(await service.set(db, actor, "administrator", value)).toEqual({
    projectId: value.projectId,
    version: 1,
    replayed: false,
  });
  const call = db.query.mock.calls.find(([sql]) =>
    String(sql).includes("set_enrollment_policy"),
  );
  expect(call?.[1]).toEqual([
    value.mutationId,
    value.projectId,
    0,
    true,
    ["verified"],
    "administrator",
  ]);
});

it("rejects malformed database projections and hides unauthorized projects", async () => {
  await expect(
    service.set(
      fixture([{ project_id: "x", version: 0 }]),
      actor,
      "administrator",
      value,
    ),
  ).rejects.toThrow();
  await expect(
    service.detail(fixture([{ permitted: false }]), actor, {
      projectId: value.projectId,
    }),
  ).rejects.toThrow("Enrollment policy not available");
});
