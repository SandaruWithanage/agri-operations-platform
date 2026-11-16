import { randomBytes, randomUUID } from "node:crypto";
import { expect } from "vitest";
import pg from "pg";
import {
  TransactionActorContext,
  type VerifiedActor,
} from "../../apps/api/src/authorization/transaction-context";
import { ProjectEnrollmentService } from "../../apps/api/src/project/enrollment-service";

/**
 * Two-officer isolation matrix for enrollment (PRJ-04). Officer A is scoped to project 1 / geography A and
 * Officer B to project 2 / geography B, each with their own geography-assigned farmer.read. Synthetic data only.
 */
export async function verifyEnrollmentIsolation({
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
  const service = new ProjectEnrollmentService(
    new TransactionActorContext(Buffer.alloc(32, 42)),
  );
  const id = () => randomUUID();
  const geoA = id(),
    geoB = id(),
    project1 = id(),
    project2 = id(),
    farmerA = id(),
    farmerB = id();
  const accounts: VerifiedActor[] = [];
  const grants: string[] = [],
    farmerGrants: string[] = [],
    assignments: string[] = [],
    projectAssignments: string[] = [];
  const makeOfficer = async () => {
    const officer = { accountId: id(), sessionId: id() },
      device = id();
    await owner.query(
      "INSERT INTO authn.account(id,login_name,password_hash) VALUES($1,$2,'$argon2id$synthetic-isolation-only')",
      [officer.accountId, `synthetic-isolation-${officer.accountId}`],
    );
    await owner.query(
      "INSERT INTO authn.device(id,account_id,state,approved_at) VALUES($1,$2,'approved',now())",
      [device, officer.accountId],
    );
    await owner.query(
      "INSERT INTO authn.login_session(id,account_id,device_id,device_required,cookie_secret_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,$3,true,$4,now()+interval '1 hour',now()+interval '1 day')",
      [officer.sessionId, officer.accountId, device, randomBytes(32)],
    );
    accounts.push(officer);
    return officer;
  };
  const scope = async (
    officer: VerifiedActor,
    projectId: string,
    geographyId: string,
  ) => {
    for (const [permission, source] of [
      ["enrollment.read", null],
      ["enrollment.create", "field_officer"],
      ["enrollment.withdraw", "field_officer"],
    ] as const) {
      const grant = id();
      grants.push(grant);
      await owner.query(
        "INSERT INTO authz.project_permission_grant(id,account_id,organization_id,project_id,permission,registration_source,starts_at) VALUES($1,$2,$3,$4,$5,$6,now()-interval '1 hour')",
        [
          grant,
          officer.accountId,
          organizationId,
          projectId,
          permission,
          source,
        ],
      );
    }
    const projectAssignment = id(),
      assignment = id(),
      farmerGrant = id();
    projectAssignments.push(projectAssignment);
    assignments.push(assignment);
    farmerGrants.push(farmerGrant);
    await owner.query(
      "INSERT INTO authz.project_assignment(id,account_id,organization_id,project_id,geography_id,starts_at) VALUES($1,$2,$3,$4,$5,now()-interval '1 hour')",
      [
        projectAssignment,
        officer.accountId,
        organizationId,
        projectId,
        geographyId,
      ],
    );
    await owner.query(
      "INSERT INTO authz.assignment(id,account_id,organization_id,geography_id,starts_at) VALUES($1,$2,$3,$4,now()-interval '1 hour')",
      [assignment, officer.accountId, organizationId, geographyId],
    );
    await owner.query(
      "INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,geography_id,starts_at) VALUES($1,$2,$3,'farmer.read','assigned',$4,now()-interval '1 hour')",
      [farmerGrant, officer.accountId, organizationId, geographyId],
    );
  };
  const priorFarmerGrants = (
    await owner.query(
      "SELECT id FROM authz.permission_grant WHERE account_id=$1 AND permission='farmer.read' AND active",
      [actor.accountId],
    )
  ).rows.map((row) => row.id as string);
  const rowsFor = async (officer: VerifiedActor, filter = {}) =>
    (await service.list(db, officer, filter)).items.map((row) => row.id);
  const enroll = (
    officer: VerifiedActor,
    projectId: string,
    farmerId: string,
    extra: Record<string, unknown> = {},
  ) =>
    service.enroll(db, officer, "field_officer", {
      mutationId: id(),
      enrollmentId: id(),
      projectId,
      farmerId,
      ...extra,
    });
  const count = async (table: string, project: string[]) =>
    (
      await owner.query(
        `SELECT count(*)::int AS n FROM operations.${table} WHERE project_id=ANY($1::uuid[])`,
        [project],
      )
    ).rows[0].n as number;
  try {
    await owner.query(
      "UPDATE authz.permission_grant SET active=false WHERE id=ANY($1::uuid[])",
      [priorFarmerGrants],
    );
    for (const [geo, name] of [
      [geoA, "Synthetic isolation area A"],
      [geoB, "Synthetic isolation area B"],
    ])
      await owner.query(
        "INSERT INTO farm.geography(id,organization_id,name) VALUES($1,$2,$3)",
        [geo, organizationId, name],
      );
    for (const [project, name] of [
      [project1, "Synthetic isolation project 1"],
      [project2, "Synthetic isolation project 2"],
    ]) {
      await owner.query(
        "INSERT INTO operations.project(id,organization_id,name,active,created_by) VALUES($1,$2,$3,true,$4)",
        [project, organizationId, name, actor.accountId],
      );
      await owner.query(
        "INSERT INTO operations.enrollment_policy(project_id,enabled,eligible_farmer_statuses) VALUES($1,true,ARRAY['verified'])",
        [project],
      );
    }
    for (const [farmer, geo, name] of [
      [farmerA, geoA, "Synthetic Isolation Farmer A"],
      [farmerB, geoB, "Synthetic Isolation Farmer B"],
    ])
      await owner.query(
        "INSERT INTO farm.farmer(id,geography_id,full_name,privacy_notice_provided,registration_source,status,created_by) VALUES($1,$2,$3,true,'administrator','verified',$4)",
        [farmer, geo, name, actor.accountId],
      );
    const officerA = await makeOfficer(),
      officerB = await makeOfficer();
    await scope(officerA, project1, geoA);
    await scope(officerB, project2, geoB);

    // 1. Each officer enrolls only inside their own project and geography.
    const a = await enroll(officerA, project1, farmerA);
    const b = await enroll(officerB, project2, farmerB);
    expect([a.version, b.version]).toEqual([1, 1]);

    // 2. Every cross combination is an indistinguishable denial; nothing is written.
    for (const [officer, project, farmer] of [
      [officerA, project1, farmerB],
      [officerA, project2, farmerA],
      [officerA, project2, farmerB],
      [officerB, project2, farmerA],
      [officerB, project1, farmerB],
      [officerB, project1, farmerA],
    ] as const)
      await expect(enroll(officer, project, farmer)).rejects.toMatchObject({
        code: "42501",
      });
    expect(await count("enrollment", [project1, project2])).toBe(2);

    // 3. Reads show exactly one's own rows; filters for the other officer's project are empty.
    expect(await rowsFor(officerA)).toEqual([a.enrollmentId]);
    expect(await rowsFor(officerB)).toEqual([b.enrollmentId]);
    expect(await rowsFor(officerA, { projectId: project2 })).toEqual([]);
    expect(await rowsFor(officerB, { farmerId: farmerA })).toEqual([]);
    await expect(
      service.detail(db, officerB, { id: a.enrollmentId }),
    ).rejects.toThrow("Enrollment not available");
    await expect(
      service.detail(db, officerA, { id: b.enrollmentId }),
    ).rejects.toThrow("Enrollment not available");

    // 4. Withdrawals across officers are denied and leave the record untouched.
    for (const [officer, target] of [
      [officerB, a],
      [officerA, b],
    ] as const)
      await expect(
        service.withdraw(db, officer, "field_officer", {
          mutationId: id(),
          enrollmentId: target.enrollmentId,
          expectedVersion: 1,
        }),
      ).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await owner.query(
          "SELECT status FROM operations.enrollment WHERE id=ANY($1::uuid[]) ORDER BY id",
          [[a.enrollmentId, b.enrollmentId]],
        )
      ).rows.every((row) => row.status === "enrolled"),
    ).toBe(true);

    // 5. A mutation ID belongs to its actor: another officer reusing it cannot replay or read the result.
    await expect(
      service.enroll(db, officerB, "field_officer", {
        mutationId: (
          await owner.query(
            "SELECT id FROM operations.enrollment_mutation WHERE enrollment_id=$1",
            [a.enrollmentId],
          )
        ).rows[0].id,
        enrollmentId: a.enrollmentId,
        projectId: project1,
        farmerId: farmerA,
      }),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await count("enrollment", [project1, project2])).toBe(2);

    // 6. A farmer moving to another geography takes the record out of the old officer's scope immediately.
    await owner.query("UPDATE farm.farmer SET geography_id=$1 WHERE id=$2", [
      geoB,
      farmerA,
    ]);
    expect(await rowsFor(officerA)).toEqual([]);
    expect(await rowsFor(officerB)).toEqual([b.enrollmentId]);
    await expect(
      service.withdraw(db, officerA, "field_officer", {
        mutationId: id(),
        enrollmentId: a.enrollmentId,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "42501" });
    await owner.query("UPDATE farm.farmer SET geography_id=$1 WHERE id=$2", [
      geoA,
      farmerA,
    ]);
    expect(await rowsFor(officerA)).toEqual([a.enrollmentId]);

    // 7. Revoking one officer's session affects only that officer.
    await owner.query(
      "UPDATE authn.login_session SET revoked_at=clock_timestamp() WHERE id=$1",
      [officerA.sessionId],
    );
    expect(await rowsFor(officerA)).toEqual([]);
    await expect(enroll(officerA, project1, farmerA)).rejects.toMatchObject({
      code: "42501",
    });
    expect(await rowsFor(officerB)).toEqual([b.enrollmentId]);

    // 8. Audit attributes each action to its own officer only.
    expect(
      (
        await owner.query(
          "SELECT actor_id FROM operations.enrollment_audit WHERE project_id=ANY($1::uuid[]) ORDER BY project_id",
          [[project1, project2]],
        )
      ).rows
        .map((row) => row.actor_id)
        .sort(),
    ).toEqual([officerA.accountId, officerB.accountId].sort());
  } finally {
    await db.end();
    await owner.query("ROLLBACK").catch(() => undefined);
    const projects = [project1, project2];
    await owner.query(
      "DELETE FROM operations.enrollment_audit WHERE project_id=ANY($1::uuid[])",
      [projects],
    );
    await owner.query(
      "DELETE FROM operations.enrollment_mutation WHERE enrollment_id IN (SELECT id FROM operations.enrollment WHERE project_id=ANY($1::uuid[]))",
      [projects],
    );
    await owner.query(
      "DELETE FROM operations.enrollment WHERE project_id=ANY($1::uuid[])",
      [projects],
    );
    await owner.query(
      "DELETE FROM operations.enrollment_policy WHERE project_id=ANY($1::uuid[])",
      [projects],
    );
    await owner.query(
      "DELETE FROM authz.project_permission_grant WHERE id=ANY($1::uuid[])",
      [grants],
    );
    await owner.query(
      "DELETE FROM authz.project_assignment WHERE id=ANY($1::uuid[])",
      [projectAssignments],
    );
    await owner.query("DELETE FROM authz.assignment WHERE id=ANY($1::uuid[])", [
      assignments,
    ]);
    await owner.query(
      "DELETE FROM authz.permission_grant WHERE id=ANY($1::uuid[])",
      [farmerGrants],
    );
    await owner.query(
      "DELETE FROM farm.farmer_audit WHERE farmer_id=ANY($1::uuid[])",
      [[farmerA, farmerB]],
    );
    await owner.query("DELETE FROM farm.farmer WHERE id=ANY($1::uuid[])", [
      [farmerA, farmerB],
    ]);
    await owner.query(
      "DELETE FROM operations.project WHERE id=ANY($1::uuid[])",
      [projects],
    );
    await owner.query("DELETE FROM farm.geography WHERE id=ANY($1::uuid[])", [
      [geoA, geoB],
    ]);
    await owner.query(
      "UPDATE authz.permission_grant SET active=true WHERE id=ANY($1::uuid[])",
      [priorFarmerGrants],
    );
  }
}
