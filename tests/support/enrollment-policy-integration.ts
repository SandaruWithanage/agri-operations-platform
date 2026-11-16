import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import pg from "pg";
import {
  TransactionActorContext,
  type VerifiedActor,
} from "../../apps/api/src/authorization/transaction-context";
import { EnrollmentPolicyService } from "../../apps/api/src/project/enrollment-policy-service";

/** Synthetic-data scenarios for audited enrollment-policy administration (PRJ-03B). */
export async function verifyEnrollmentPolicyAdmin({
  owner,
  actor,
  organizationId,
  runtimeUrl,
}: {
  owner: pg.Client;
  actor: VerifiedActor;
  organizationId: string;
  runtimeUrl: string;
}) {
  const db = new pg.Client({ connectionString: runtimeUrl });
  await db.connect();
  const service = new EnrollmentPolicyService(
    new TransactionActorContext(Buffer.alloc(32, 42)),
  );
  const project = randomUUID(),
    readGrant = randomUUID(),
    updateGrant = randomUUID(),
    policyGrant = randomUUID();
  const set = (
    input: Record<string, unknown>,
    source: "administrator" | "field_officer" = "administrator",
  ) => service.set(db, actor, source, input);
  const body = (extra: Record<string, unknown> = {}) => ({
    mutationId: randomUUID(),
    projectId: project,
    expectedVersion: 0,
    enabled: true,
    eligibleFarmerStatuses: ["verified", "pending-review"],
    ...extra,
  });
  const count = async (table: string) =>
    (
      await owner.query(
        `SELECT count(*)::int AS n FROM operations.${table} WHERE project_id=$1`,
        [project],
      )
    ).rows[0].n as number;
  const grant = (id: string, permission: string, source: string | null) =>
    owner.query(
      "INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,registration_source,starts_at) VALUES($1,$2,$3,$4,'organization',$5,now()-interval '1 hour')",
      [id, actor.accountId, organizationId, permission, source],
    );
  try {
    await owner.query(
      "INSERT INTO operations.project(id,organization_id,name,active,created_by) VALUES($1,$2,'Synthetic policy project',true,$3)",
      [project, organizationId, actor.accountId],
    );
    // 1. Nothing granted: denied writes, no existence disclosure, nothing stored.
    await expect(set(body())).rejects.toMatchObject({ code: "42501" });
    await expect(
      service.detail(db, actor, { projectId: project }),
    ).rejects.toThrow();
    expect(await count("enrollment_policy")).toBe(0);

    // 2. Catalog authority never implies policy authority.
    await grant(readGrant, "project.read", null);
    await grant(updateGrant, "project.update", "administrator");
    await expect(set(body())).rejects.toMatchObject({ code: "42501" });
    await expect(
      service.detail(db, actor, { projectId: project }),
    ).rejects.toThrow();

    // 3. The dedicated grant allows an explicit, default-absent policy to be read as null and then created.
    await grant(policyGrant, "enrollment.policy", "administrator");
    expect(
      await service.detail(db, actor, { projectId: project }),
    ).toMatchObject({ projectId: project, policy: null });
    const first = body();
    expect(await set(first)).toEqual({
      projectId: project,
      version: 1,
      replayed: false,
    });
    expect(await set(first)).toEqual({
      projectId: project,
      version: 1,
      replayed: true,
    });
    expect(await count("enrollment_policy_change")).toBe(1);
    expect(await count("enrollment_policy_audit")).toBe(1);
    expect(
      (await service.detail(db, actor, { projectId: project })).policy,
    ).toEqual({
      projectId: project,
      enabled: true,
      eligibleFarmerStatuses: ["pending-review", "verified"],
      version: 1,
    });

    // 4. Conflicts, stale versions, no-ops and invalid input are rejected without side effects.
    await expect(set({ ...first, enabled: false })).rejects.toMatchObject({
      code: "23505",
    });
    await expect(set(body())).rejects.toMatchObject({ code: "40001" });
    await expect(
      set(body({ expectedVersion: 5, enabled: false })),
    ).rejects.toMatchObject({ code: "40001" });
    await expect(
      set(
        body({
          expectedVersion: 1,
          eligibleFarmerStatuses: ["verified", "pending-review"],
        }),
      ),
    ).rejects.toMatchObject({ code: "22023" });
    for (const bad of [
      { eligibleFarmerStatuses: [] },
      { eligibleFarmerStatuses: ["verified", "verified"] },
      { eligibleFarmerStatuses: ["unknown"] },
      { expectedVersion: -1 },
      { role: "administrator" },
    ])
      await expect(set(body(bad))).rejects.toThrow();
    await expect(
      set(body({ expectedVersion: 1, enabled: false }), "field_officer"),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await count("enrollment_policy_change")).toBe(1);

    // 5. A versioned edit keeps immutable history and one audit row per change.
    expect(
      await set(body({ expectedVersion: 1, enabled: false })),
    ).toMatchObject({ version: 2, replayed: false });
    expect(
      (
        await owner.query(
          "SELECT version,old_enabled,new_enabled FROM operations.enrollment_policy_change WHERE project_id=$1 ORDER BY version",
          [project],
        )
      ).rows,
    ).toEqual([
      { version: 1, old_enabled: null, new_enabled: true },
      { version: 2, old_enabled: true, new_enabled: false },
    ]);
    expect(await count("enrollment_policy_audit")).toBe(2);

    // 6. Runtime logins cannot write or read the private tables directly.
    for (const statement of [
      "UPDATE operations.enrollment_policy SET enabled=true",
      "DELETE FROM operations.enrollment_policy",
      "SELECT 1 FROM operations.enrollment_policy_change",
      "SELECT 1 FROM operations.enrollment_policy_audit",
    ])
      await expect(db.query(statement)).rejects.toMatchObject({
        code: "42501",
      });

    // 7. Revocation takes effect immediately for writes and reads.
    await owner.query(
      "UPDATE authz.permission_grant SET active=false WHERE id=$1",
      [policyGrant],
    );
    await expect(
      set(body({ expectedVersion: 2, enabled: true })),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      service.detail(db, actor, { projectId: project }),
    ).rejects.toThrow();
    // A replay never preserves a revoked grant either.
    await expect(set(first)).rejects.toMatchObject({ code: "42501" });
    expect(await count("enrollment_policy_change")).toBe(2);
  } finally {
    await db.end();
    await owner.query("ROLLBACK").catch(() => undefined);
    await owner.query(
      "DELETE FROM operations.enrollment_policy_audit WHERE project_id=$1",
      [project],
    );
    await owner.query(
      "DELETE FROM operations.enrollment_policy_change WHERE project_id=$1",
      [project],
    );
    await owner.query(
      "DELETE FROM operations.enrollment_policy WHERE project_id=$1",
      [project],
    );
    await owner.query(
      "DELETE FROM authz.permission_grant WHERE id=ANY($1::uuid[])",
      [[readGrant, updateGrant, policyGrant]],
    );
    await owner.query("DELETE FROM operations.audit WHERE project_id=$1", [
      project,
    ]);
    await owner.query("DELETE FROM operations.project WHERE id=$1", [project]);
  }
}
