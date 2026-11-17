import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect } from "vitest";
import {
  TransactionActorContext,
  type VerifiedActor,
} from "../../apps/api/src/authorization/transaction-context";
import { ProjectEnrollmentService } from "../../apps/api/src/project/enrollment-service";
import { createPilotRuntime } from "../../apps/api/src/pilot/runtime";

/** Native + service verification of provisional explicit enrollment (ADR 0019). Synthetic data only. */
export async function verifyProjectEnrollment({
  owner,
  actor,
  organizationId,
  geographyId,
  runtimeUrl,
  runtimeEnv,
}: {
  owner: pg.Client;
  actor: VerifiedActor;
  organizationId: string;
  geographyId: string;
  runtimeUrl: string;
  runtimeEnv: Record<string, string>;
}) {
  expect(
    (await owner.query("SELECT current_database() AS name")).rows[0].name,
  ).toBe("agri_test");
  const db = new pg.Client({ connectionString: runtimeUrl });
  await db.connect();
  const context = new TransactionActorContext(Buffer.alloc(32, 42));
  const service = new ProjectEnrollmentService(context);
  const id = () => randomUUID();
  const project = id(),
    otherProject = id(),
    foreignProject = id();
  const farmer = id(),
    inactiveFarmer = id(),
    uncoveredFarmer = id(),
    foreignFarmer = id();
  const uncoveredGeo = id(),
    foreignOrg = id(),
    foreignGeo = id();
  const readGrant = id(),
    createGrant = id(),
    withdrawGrant = id(),
    assignment = id(),
    farmerRead = id();
  const enroll = (
    input: Record<string, unknown>,
    source: "administrator" | "field_officer" = "administrator",
    identity = actor,
  ) => service.enroll(db, identity, source, input);
  const withdraw = (
    input: Record<string, unknown>,
    source: "administrator" | "field_officer" = "administrator",
  ) => service.withdraw(db, actor, source, input);
  const create = (extra: Record<string, unknown> = {}) => ({
    mutationId: id(),
    enrollmentId: id(),
    projectId: project,
    farmerId: farmer,
    ...extra,
  });
  const count = async (table: string, where = "true", params: unknown[] = []) =>
    (
      await owner.query(
        `SELECT count(*)::int AS n FROM operations.${table} WHERE ${where}`,
        params,
      )
    ).rows[0].n as number;
  // Existing farmer.read grants of the synthetic actor are suspended so each case is explicit.
  const priorFarmerGrants = (
    await owner.query(
      "SELECT id FROM authz.permission_grant WHERE account_id=$1 AND permission='farmer.read' AND active",
      [actor.accountId],
    )
  ).rows.map((row) => row.id as string);
  try {
    await owner.query(
      "UPDATE authz.permission_grant SET active=false WHERE id=ANY($1::uuid[])",
      [priorFarmerGrants],
    );
    await owner.query(
      "INSERT INTO farm.geography(id,organization_id,name) VALUES($1,$2,'Synthetic uncovered enrollment area')",
      [uncoveredGeo, organizationId],
    );
    await owner.query(
      "INSERT INTO farm.organization(id,name) VALUES($1,'Synthetic foreign enrollment organization')",
      [foreignOrg],
    );
    await owner.query(
      "INSERT INTO farm.geography(id,organization_id,name) VALUES($1,$2,'Synthetic foreign enrollment area')",
      [foreignGeo, foreignOrg],
    );
    for (const [projectId, org, active, name] of [
      [project, organizationId, true, "Synthetic enrollment project"],
      [otherProject, organizationId, true, "Synthetic unscoped project"],
      [
        foreignProject,
        foreignOrg,
        true,
        "Synthetic foreign enrollment project",
      ],
    ] as const)
      await owner.query(
        "INSERT INTO operations.project(id,organization_id,name,active,created_by) VALUES($1,$2,$3,$4,$5)",
        [projectId, org, name, active, actor.accountId],
      );
    // Only `project` has an enabled policy; `otherProject` and the foreign project stay default-deny.
    await owner.query(
      "INSERT INTO operations.enrollment_policy(project_id,enabled,eligible_farmer_statuses) VALUES($1,true,ARRAY['draft','pending-review','verified'])",
      [project],
    );
    for (const [farmerId, geo, name, status] of [
      [farmer, geographyId, "Synthetic Enrollment Farmer", "pending-review"],
      [inactiveFarmer, geographyId, "Synthetic Inactive Farmer", "inactive"],
      [uncoveredFarmer, uncoveredGeo, "Synthetic Uncovered Farmer", "verified"],
      [foreignFarmer, foreignGeo, "Synthetic Foreign Farmer", "verified"],
    ] as const)
      await owner.query(
        "INSERT INTO farm.farmer(id,geography_id,full_name,privacy_notice_provided,registration_source,status,created_by) VALUES($1,$2,$3,true,'administrator',$4,$5)",
        [farmerId, geo, name, status, actor.accountId],
      );

    // 1. Nothing is granted: no write, no hidden record, no existence disclosure.
    await expect(enroll(create())).rejects.toMatchObject({ code: "42501" });
    expect(await service.list(db, actor, { projectId: project })).toMatchObject(
      { items: [], nextCursor: null },
    );
    await expect(service.detail(db, actor, { id: id() })).rejects.toMatchObject(
      { status: 404 },
    );

    // 2. Project scope without farmer.read still denies; farmer.read without scope denies.
    await owner.query(
      "INSERT INTO authz.project_permission_grant(id,account_id,organization_id,project_id,permission,registration_source,starts_at) VALUES($1,$2,$3,$4,'enrollment.read',NULL,now()-interval '1 hour'),($5,$2,$3,$4,'enrollment.create','administrator',now()-interval '1 hour')",
      [readGrant, actor.accountId, organizationId, project, createGrant],
    );
    await owner.query(
      "INSERT INTO authz.project_assignment(id,account_id,organization_id,project_id,geography_id,starts_at) VALUES($1,$2,$3,$4,$5,now()-interval '1 hour')",
      [assignment, actor.accountId, organizationId, project, geographyId],
    );
    await expect(enroll(create())).rejects.toMatchObject({ code: "42501" });
    await owner.query(
      "INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,starts_at) VALUES($1,$2,$3,'farmer.read','organization',now()-interval '1 hour')",
      [farmerRead, actor.accountId, organizationId],
    );

    // 3. Explicit enrollment: trusted source, version 1, private journal + audit written atomically.
    const first = create();
    expect(await enroll(first)).toEqual({
      enrollmentId: first.enrollmentId,
      version: 1,
      replayed: false,
    });
    expect(
      await count("enrollment_mutation", "id=$1", [first.mutationId]),
    ).toBe(1);
    expect(
      (
        await owner.query(
          "SELECT action,record_version,actor_id FROM operations.enrollment_audit WHERE enrollment_id=$1",
          [first.enrollmentId],
        )
      ).rows,
    ).toEqual([
      {
        action: "enrollment.create",
        record_version: 1,
        actor_id: actor.accountId,
      },
    ]);
    expect(
      await service.detail(db, actor, { id: first.enrollmentId }),
    ).toMatchObject({
      accountId: actor.accountId,
      enrollment: {
        id: first.enrollmentId,
        projectId: project,
        farmerId: farmer,
        status: "enrolled",
        version: 1,
        withdrawnAt: null,
      },
    });
    expect(
      (await service.list(db, actor, { projectId: project })).items.map(
        (item) => item.id,
      ),
    ).toEqual([first.enrollmentId]);

    // 4. Exact replay is idempotent; changed intent under the same mutation conflicts.
    expect(await enroll(first)).toEqual({
      enrollmentId: first.enrollmentId,
      version: 1,
      replayed: true,
    });
    expect(await count("enrollment", "project_id=$1", [project])).toBe(1);
    expect(await count("enrollment_audit", "project_id=$1", [project])).toBe(1);
    await expect(
      enroll({ ...first, farmerId: inactiveFarmer }),
    ).rejects.toMatchObject({ code: "23505" });
    // Source is part of the intent: the same mutation cannot be replayed as another source.
    await expect(enroll(first, "field_officer")).rejects.toMatchObject({
      code: "42501",
    });
    // Duplicate current enrollment is rejected even with a fresh mutation/identifier.
    await expect(enroll(create())).rejects.toMatchObject({ code: "23505" });

    // 5. Targets outside the actor's current scope are indistinguishable denials.
    for (const target of [
      { farmerId: uncoveredFarmer },
      { farmerId: foreignFarmer },
      { farmerId: id() },
      { projectId: otherProject },
      { projectId: foreignProject },
      { projectId: id() },
    ])
      await expect(enroll(create(target))).rejects.toMatchObject({
        code: "42501",
      });
    // Provisional eligibility (DEC-04 open): an inactive farmer or project is not enrollable.
    await expect(
      enroll(create({ farmerId: inactiveFarmer })),
    ).rejects.toMatchObject({ code: "55000" });
    await owner.query(
      "UPDATE operations.project SET active=false WHERE id=$1",
      [project],
    );
    await expect(
      enroll(create({ farmerId: uncoveredFarmer })),
    ).rejects.toMatchObject({ code: "42501" });
    await owner.query("UPDATE operations.project SET active=true WHERE id=$1", [
      project,
    ]);
    // Default-deny policy: a disabled policy blocks enrollment; the catalog active flag never enables it.
    await owner.query(
      "UPDATE operations.enrollment_policy SET enabled=false,version=version+1 WHERE project_id=$1",
      [project],
    );
    await expect(enroll(create())).rejects.toMatchObject({ code: "55000" });
    await owner.query(
      "UPDATE operations.enrollment_policy SET enabled=true,version=version+1 WHERE project_id=$1",
      [project],
    );
    // The policy version used is recorded on each enrollment.
    expect(
      (
        await owner.query(
          "SELECT DISTINCT policy_version FROM operations.enrollment WHERE project_id=$1",
          [project],
        )
      ).rows,
    ).toEqual([{ policy_version: 1 }]);

    // 6. Each prerequisite is independently required and revocation takes effect immediately.
    await owner.query(
      "UPDATE authz.permission_grant SET active=false WHERE id=$1",
      [farmerRead],
    );
    await expect(
      enroll(create({ farmerId: inactiveFarmer })),
    ).rejects.toMatchObject({
      code: "42501",
    });
    expect(
      (await service.list(db, actor, { projectId: project })).items,
    ).toEqual([]);
    await expect(
      service.detail(db, actor, { id: first.enrollmentId }),
    ).rejects.toMatchObject({ status: 404 });
    await owner.query(
      "UPDATE authz.permission_grant SET active=true WHERE id=$1",
      [farmerRead],
    );
    await owner.query(
      "UPDATE authz.project_permission_grant SET expires_at=now()-interval '1 second',starts_at=now()-interval '1 hour' WHERE id=$1",
      [readGrant],
    );
    expect(
      (await service.list(db, actor, { projectId: project })).items,
    ).toEqual([]);
    await owner.query(
      "UPDATE authz.project_permission_grant SET expires_at=NULL WHERE id=$1",
      [readGrant],
    );

    // 7. Withdrawal needs its own permission, the current version and a trusted source.
    const withdrawal = {
      mutationId: id(),
      enrollmentId: first.enrollmentId,
      expectedVersion: 1,
    };
    await expect(withdraw(withdrawal)).rejects.toMatchObject({ code: "42501" });
    await owner.query(
      "INSERT INTO authz.project_permission_grant(id,account_id,organization_id,project_id,permission,registration_source,starts_at) VALUES($1,$2,$3,$4,'enrollment.withdraw','administrator',now()-interval '1 hour')",
      [withdrawGrant, actor.accountId, organizationId, project],
    );
    await expect(withdraw(withdrawal, "field_officer")).rejects.toMatchObject({
      code: "42501",
    });
    // ENR-AUTH-01: withdrawal is administrator-only in PostgreSQL. A new field-officer-source withdraw grant cannot
    // be created, and a legacy one (constraint temporarily removed, as it could pre-date the rule) stays inert.
    await expect(
      owner.query(
        "INSERT INTO authz.project_permission_grant(id,account_id,organization_id,project_id,permission,registration_source,starts_at) VALUES($1,$2,$3,$4,'enrollment.withdraw','field_officer',now()-interval '1 hour')",
        [id(), actor.accountId, organizationId, project],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const legacyGrant = id();
    await owner.query(
      "ALTER TABLE authz.project_permission_grant DROP CONSTRAINT project_permission_grant_withdraw_admin_check",
    );
    try {
      await owner.query(
        "INSERT INTO authz.project_permission_grant(id,account_id,organization_id,project_id,permission,registration_source,starts_at) VALUES($1,$2,$3,$4,'enrollment.withdraw','field_officer',now()-interval '1 hour')",
        [legacyGrant, actor.accountId, organizationId, project],
      );
      await expect(withdraw(withdrawal, "field_officer")).rejects.toMatchObject(
        { code: "42501" },
      );
      expect(
        (
          await owner.query(
            "SELECT status FROM operations.enrollment WHERE id=$1",
            [first.enrollmentId],
          )
        ).rows[0].status,
      ).toBe("enrolled");
      // Only the legacy field-officer grant remains active: neither source may withdraw with it.
      await owner.query(
        "UPDATE authz.project_permission_grant SET active=false WHERE id=$1",
        [withdrawGrant],
      );
      for (const source of ["field_officer", "administrator"] as const)
        await expect(withdraw(withdrawal, source)).rejects.toMatchObject({
          code: "42501",
        });
      await owner.query(
        "UPDATE authz.project_permission_grant SET active=true WHERE id=$1",
        [withdrawGrant],
      );
      // The runtime login can neither create a grant nor alter the guarding constraint.
      for (const statement of [
        "INSERT INTO authz.project_permission_grant(id,account_id,organization_id,project_id,permission,registration_source,starts_at) VALUES(gen_random_uuid(),'" +
          actor.accountId +
          "','" +
          organizationId +
          "','" +
          project +
          "','enrollment.withdraw','administrator',now())",
        "ALTER TABLE authz.project_permission_grant DROP CONSTRAINT project_permission_grant_withdraw_admin_check",
        "UPDATE authz.project_permission_grant SET registration_source='administrator'",
      ])
        await expect(
          context.run(db, actor, (c) => c.query(statement)),
        ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await owner.query(
        "DELETE FROM authz.project_permission_grant WHERE id=$1",
        [legacyGrant],
      );
      await owner.query(
        "ALTER TABLE authz.project_permission_grant ADD CONSTRAINT project_permission_grant_withdraw_admin_check CHECK(permission<>'enrollment.withdraw' OR registration_source='administrator') NOT VALID",
      );
    }
    await expect(
      withdraw({ ...withdrawal, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: "40001" });
    expect(await withdraw(withdrawal)).toEqual({
      enrollmentId: first.enrollmentId,
      version: 2,
      replayed: false,
    });
    expect(await withdraw(withdrawal)).toEqual({
      enrollmentId: first.enrollmentId,
      version: 2,
      replayed: true,
    });
    await expect(
      withdraw({ ...withdrawal, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      withdraw({
        mutationId: id(),
        enrollmentId: first.enrollmentId,
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "55000" });
    expect(
      (
        await owner.query(
          "SELECT action,record_version FROM operations.enrollment_audit WHERE enrollment_id=$1 ORDER BY record_version",
          [first.enrollmentId],
        )
      ).rows,
    ).toEqual([
      { action: "enrollment.create", record_version: 1 },
      { action: "enrollment.withdraw", record_version: 2 },
    ]);
    // Withdrawal is history: the row is retained and a later enrollment is a new row.
    expect(
      await service.detail(db, actor, { id: first.enrollmentId }),
    ).toMatchObject({ enrollment: { status: "withdrawn", version: 2 } });
    const again = create();
    expect(await enroll(again)).toMatchObject({ version: 1, replayed: false });
    expect(
      (
        await service.list(db, actor, {
          projectId: project,
          status: "enrolled",
        })
      ).items.map((item) => item.id),
    ).toEqual([again.enrollmentId]);
    const page = await service.list(db, actor, {
      projectId: project,
      limit: 1,
    });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe(page.items[0].id);
    await expect(service.list(db, actor, { limit: 101 })).rejects.toThrow();
    await expect(service.list(db, actor, { unknown: true })).rejects.toThrow();
    await expect(
      enroll({ ...create(), role: "administrator" }),
    ).rejects.toThrow();

    // 8. Runtime has read-only column access; journals, audit and scope remain private; owner cannot delete.
    for (const statement of [
      "INSERT INTO operations.enrollment(id,organization_id,project_id,farmer_id,status,enrolled_source) VALUES(gen_random_uuid(),'" +
        organizationId +
        "','" +
        project +
        "','" +
        farmer +
        "','enrolled','administrator')",
      "UPDATE operations.enrollment SET status='withdrawn'",
      "DELETE FROM operations.enrollment",
      "SELECT payload_mac FROM operations.enrollment_mutation",
      "SELECT 1 FROM operations.enrollment_audit",
      "SELECT enrolled_by FROM operations.enrollment",
    ])
      await expect(
        context.run(db, actor, (c) => c.query(statement)),
      ).rejects.toMatchObject({ code: "42501" });
    for (const statement of [
      "DELETE FROM operations.enrollment",
      "DELETE FROM operations.enrollment_audit",
      "DELETE FROM operations.enrollment_mutation",
      "UPDATE operations.enrollment SET project_id=project_id",
      "UPDATE operations.enrollment SET enrolled_by=enrolled_by",
    ])
      await expect(
        context.run(owner, actor, async (c) => {
          await c.query("SET LOCAL ROLE agri_enrollment_owner");
          return c.query(statement);
        }),
      ).rejects.toMatchObject({ code: "42501" });
    // Without a signed actor the table is empty and writes fail closed.
    expect(
      (await db.query("SELECT id FROM operations.enrollment")).rows,
    ).toEqual([]);
    await expect(
      db.query(
        "SELECT * FROM operations.enroll_farmer($1,$2,$3,$4,'administrator')",
        [id(), id(), project, farmer],
      ),
    ).rejects.toMatchObject({ code: "42501" });

    // 9. A farmer geography change that commits while enrollment waits is re-authorized.
    const racer = id();
    await owner.query(
      "INSERT INTO farm.farmer(id,geography_id,full_name,privacy_notice_provided,registration_source,status,created_by) VALUES($1,$2,'Synthetic Race Farmer',true,'administrator','verified',$3)",
      [racer, geographyId, actor.accountId],
    );
    const waiter = new pg.Client({ connectionString: runtimeUrl });
    await waiter.connect();
    let pending: Promise<unknown> | undefined;
    try {
      const pid = (await waiter.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid;
      await owner.query("BEGIN");
      await owner.query("UPDATE farm.farmer SET geography_id=$1 WHERE id=$2", [
        uncoveredGeo,
        racer,
      ]);
      pending = service
        .enroll(waiter, actor, "administrator", create({ farmerId: racer }))
        .then(
          () => "enrolled",
          (error: { code?: string }) => error.code,
        );
      let blocked = false;
      for (let attempt = 0; attempt < 80 && !blocked; attempt++) {
        blocked =
          (
            await owner.query(
              "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
              [pid],
            )
          ).rows[0]?.wait_event_type === "Lock";
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      await owner.query("COMMIT");
      expect(await pending).toBe("42501");
    } finally {
      await owner.query("ROLLBACK").catch(() => undefined);
      if (pending) await Promise.resolve(pending).catch(() => undefined);
      await waiter.end();
    }

    // 10. Concurrent equal-scope attempts create exactly one current enrollment.
    const rival = id();
    await owner.query(
      "INSERT INTO farm.farmer(id,geography_id,full_name,privacy_notice_provided,registration_source,status,created_by) VALUES($1,$2,'Synthetic Concurrent Farmer',true,'administrator','verified',$3)",
      [rival, geographyId, actor.accountId],
    );
    const peers = [
      new pg.Client({ connectionString: runtimeUrl }),
      new pg.Client({ connectionString: runtimeUrl }),
    ];
    await Promise.all(peers.map((peer) => peer.connect()));
    try {
      const outcomes = await Promise.all(
        peers.map((peer) =>
          service
            .enroll(peer, actor, "administrator", create({ farmerId: rival }))
            .then(
              () => "ok",
              (error: { code?: string }) => error.code,
            ),
        ),
      );
      expect(outcomes.sort()).toEqual(["23505", "ok"]);
      expect(
        await count("enrollment", "farmer_id=$1 AND status='enrolled'", [
          rival,
        ]),
      ).toBe(1);
    } finally {
      await Promise.all(peers.map((peer) => peer.end()));
    }

    // 11. A failed write leaves no journal/audit residue.
    const orphanMutation = id();
    await expect(
      enroll(create({ mutationId: orphanMutation, farmerId: inactiveFarmer })),
    ).rejects.toMatchObject({ code: "55000" });
    expect(await count("enrollment_mutation", "id=$1", [orphanMutation])).toBe(
      0,
    );
    expect(
      await count("enrollment_audit", "mutation_id=$1", [orphanMutation]),
    ).toBe(0);

    // 12. Startup refuses accidental write/journal/owner privileges and a missing migration.
    for (const [enable, disable] of [
      [
        "GRANT INSERT(status) ON operations.enrollment TO agri_test_login_9",
        "REVOKE INSERT(status) ON operations.enrollment FROM agri_test_login_9",
      ],
      [
        "GRANT SELECT(id) ON operations.enrollment_audit TO agri_test_login_9",
        "REVOKE SELECT(id) ON operations.enrollment_audit FROM agri_test_login_9",
      ],
      [
        "GRANT agri_enrollment_owner TO agri_test_login_9",
        "REVOKE agri_enrollment_owner FROM agri_test_login_9",
      ],
    ]) {
      await owner.query(enable);
      try {
        await expect(createPilotRuntime(runtimeEnv)).rejects.toThrow(
          "least privilege",
        );
      } finally {
        await owner.query(disable);
      }
    }
    await owner.query(
      "REVOKE EXECUTE ON FUNCTION operations.enroll_farmer(uuid,uuid,uuid,uuid,text) FROM agri_project_runtime",
    );
    try {
      await expect(createPilotRuntime(runtimeEnv)).rejects.toThrow(
        "Project enrollment migration",
      );
    } finally {
      await owner.query(
        "GRANT EXECUTE ON FUNCTION operations.enroll_farmer(uuid,uuid,uuid,uuid,text) TO agri_project_runtime",
      );
    }
  } finally {
    await db.end();
    await owner.query("ROLLBACK").catch(() => undefined);
    await owner.query(
      "DELETE FROM operations.enrollment_audit WHERE project_id=ANY($1::uuid[])",
      [[project, otherProject, foreignProject]],
    );
    await owner.query(
      "DELETE FROM operations.enrollment_mutation WHERE enrollment_id IN (SELECT id FROM operations.enrollment WHERE project_id=ANY($1::uuid[]))",
      [[project, otherProject, foreignProject]],
    );
    await owner.query(
      "DELETE FROM operations.enrollment WHERE project_id=ANY($1::uuid[])",
      [[project, otherProject, foreignProject]],
    );
    await owner.query(
      "DELETE FROM operations.enrollment_policy WHERE project_id=ANY($1::uuid[])",
      [[project, otherProject, foreignProject]],
    );
    await owner.query(
      "DELETE FROM authz.project_permission_grant WHERE id=ANY($1::uuid[])",
      [[readGrant, createGrant, withdrawGrant]],
    );
    await owner.query("DELETE FROM authz.project_assignment WHERE id=$1", [
      assignment,
    ]);
    await owner.query("DELETE FROM authz.permission_grant WHERE id=$1", [
      farmerRead,
    ]);
    await owner.query(
      "UPDATE authz.permission_grant SET active=true WHERE id=ANY($1::uuid[])",
      [priorFarmerGrants],
    );
    await owner.query(
      "DELETE FROM farm.farmer_audit WHERE farmer_id IN (SELECT id FROM farm.farmer WHERE full_name LIKE 'Synthetic %' AND created_by=$1 AND geography_id=ANY($2::uuid[]))",
      [actor.accountId, [geographyId, uncoveredGeo, foreignGeo]],
    );
    await owner.query(
      "DELETE FROM farm.farmer WHERE full_name IN ('Synthetic Enrollment Farmer','Synthetic Inactive Farmer','Synthetic Uncovered Farmer','Synthetic Foreign Farmer','Synthetic Race Farmer','Synthetic Concurrent Farmer') AND created_by=$1",
      [actor.accountId],
    );
    await owner.query(
      "DELETE FROM operations.audit WHERE project_id=ANY($1::uuid[])",
      [[project, otherProject, foreignProject]],
    );
    await owner.query(
      "DELETE FROM operations.project WHERE id=ANY($1::uuid[])",
      [[project, otherProject, foreignProject]],
    );
    await owner.query("DELETE FROM farm.geography WHERE id=ANY($1::uuid[])", [
      [uncoveredGeo, foreignGeo],
    ]);
    await owner.query("DELETE FROM farm.organization WHERE id=$1", [
      foreignOrg,
    ]);
  }
}
