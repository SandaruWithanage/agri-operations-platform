import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { expect } from "vitest";
import {
  TransactionActorContext,
  type VerifiedActor,
} from "../../apps/api/src/authorization/transaction-context";
import { ProjectScopePolicy } from "../../apps/api/src/project/scope-policy";
import { createPilotRuntime } from "../../apps/api/src/pilot/runtime";

export async function verifyProjectScopes({
  owner,
  actor,
  organizationId,
  geographyId,
  projectId,
  otherProjectId,
  runtimeUrl,
  runtimeEnv,
}: {
  owner: pg.Client;
  actor: VerifiedActor;
  organizationId: string;
  geographyId: string;
  projectId: string;
  otherProjectId: string;
  runtimeUrl: string;
  runtimeEnv: Record<string, string>;
}) {
  expect(
    (await owner.query("SELECT current_database() AS name")).rows[0].name,
  ).toBe("agri_test");
  const db = new pg.Client({ connectionString: runtimeUrl });
  await db.connect();
  const context = new TransactionActorContext(Buffer.alloc(32, 42)),
    policy = new ProjectScopePolicy(context);
  const root = randomUUID(),
    child = randomUUID(),
    unrelated = randomUUID(),
    otherGeo = randomUUID();
  const foreignOrg = randomUUID(),
    foreignGeo = randomUUID(),
    foreignProject = randomUUID();
  const originalUnit = (
    await owner.query("SELECT unit_id FROM farm.geography WHERE id=$1", [
      geographyId,
    ])
  ).rows[0].unit_id;
  await owner.query(
    "INSERT INTO farm.organizational_unit(id,organization_id,name) VALUES($1,$2,'Synthetic scope root'),($3,$2,'Synthetic unrelated unit')",
    [root, organizationId, unrelated],
  );
  await owner.query(
    "INSERT INTO farm.organizational_unit(id,organization_id,parent_id,name) VALUES($1,$2,$3,'Synthetic scope child')",
    [child, organizationId, root],
  );
  await owner.query("UPDATE farm.geography SET unit_id=$1 WHERE id=$2", [
    child,
    geographyId,
  ]);
  await owner.query(
    "INSERT INTO farm.geography(id,organization_id,unit_id,name) VALUES($1,$2,$3,'Synthetic different coverage')",
    [otherGeo, organizationId, unrelated],
  );
  await owner.query(
    "INSERT INTO farm.organization(id,name) VALUES($1,'Synthetic foreign scope organization')",
    [foreignOrg],
  );
  await owner.query(
    "INSERT INTO farm.geography(id,organization_id,name) VALUES($1,$2,'Synthetic foreign geography')",
    [foreignGeo, foreignOrg],
  );
  await owner.query(
    "INSERT INTO operations.project(id,organization_id,name,created_by) VALUES($1,$2,'Synthetic foreign scope project',$3)",
    [foreignProject, foreignOrg, actor.accountId],
  );
  const grant = randomUUID(),
    assignment = randomUUID();
  const permitted = async (
    project: string | null = projectId,
    geo: string | null = geographyId,
    permission: string | null = "enrollment.read",
    source: string | null = null,
    identity = actor,
  ) =>
    (
      await context.run(db, identity, (c) =>
        c.query(
          "SELECT authz.allowed_project_geography($1,$2,$3,$4) AS permitted",
          [project, geo, permission, source],
        ),
      )
    ).rows[0] as { permitted: boolean };
  const allowed = async (...args: Parameters<typeof permitted>) =>
    (await permitted(...args)).permitted;
  try {
    expect(
      (
        await db.query(
          "SELECT authz.allowed_project_geography($1,$2,'enrollment.read',NULL) AS permitted",
          [projectId, geographyId],
        )
      ).rows[0].permitted,
    ).toBe(false);
    // Existing organization catalog/farmer/land grants and geography assignments never substitute.
    expect(await allowed()).toBe(false);
    await owner.query(
      "INSERT INTO authz.project_permission_grant(id,account_id,organization_id,project_id,permission,starts_at) VALUES($1,$2,$3,$4,'enrollment.read',now()-interval '1 hour')",
      [grant, actor.accountId, organizationId, projectId],
    );
    expect(await allowed()).toBe(false);
    await owner.query(
      "INSERT INTO authz.project_assignment(id,account_id,organization_id,project_id,geography_id,unit_id,starts_at) VALUES($1,$2,$3,$4,$5,$6,now()-interval '1 hour')",
      [
        assignment,
        actor.accountId,
        organizationId,
        projectId,
        geographyId,
        root,
      ],
    );
    expect(await allowed()).toBe(true);
    for (const [project, geo] of [
      [otherProjectId, geographyId],
      [projectId, otherGeo],
      [foreignProject, geographyId],
      [projectId, foreignGeo],
      [randomUUID(), geographyId],
      [projectId, randomUUID()],
      [null, geographyId],
      [projectId, null],
    ])
      expect(await allowed(project, geo)).toBe(false);
    for (const [permission, source] of [
      [null, null],
      ["project.read", null],
      ["enrollment.read", "administrator"],
      ["enrollment.create", null],
      ["enrollment.create", "field_officer"],
      ["enrollment.create", "unknown"],
    ])
      expect(await allowed(projectId, geographyId, permission, source)).toBe(
        false,
      );
    for (const table of [
      "project_permission_grant",
      "project_assignment",
    ] as const) {
      const id = table === "project_assignment" ? assignment : grant;
      for (const restriction of [
        "active=false",
        "starts_at=now()+interval '1 hour'",
        "starts_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'",
        `project_id='${otherProjectId}'`,
        `geography_id='${otherGeo}'`,
        `unit_id='${unrelated}'`,
      ]) {
        await owner.query(
          `UPDATE authz.${table} SET ${restriction} WHERE id=$1`,
          [id],
        );
        expect(await allowed()).toBe(false);
        await owner.query(
          `UPDATE authz.${table} SET active=true,starts_at=now()-interval '1 hour',expires_at=NULL,project_id=$2,geography_id=$3,unit_id=$4 WHERE id=$1`,
          [
            id,
            projectId,
            table === "project_assignment" ? geographyId : null,
            table === "project_assignment" ? root : null,
          ],
        );
      }
    }
    // Two partially matching assignments cannot be combined into one geography+unit match.
    const split = randomUUID();
    await owner.query(
      "UPDATE authz.project_assignment SET unit_id=$1 WHERE id=$2",
      [unrelated, assignment],
    );
    await owner.query(
      "INSERT INTO authz.project_assignment(id,account_id,organization_id,project_id,geography_id,unit_id,starts_at) VALUES($1,$2,$3,$4,$5,$6,now()-interval '1 hour')",
      [split, actor.accountId, organizationId, projectId, otherGeo, root],
    );
    expect(await allowed()).toBe(false);
    await owner.query("DELETE FROM authz.project_assignment WHERE id=$1", [
      split,
    ]);
    await owner.query(
      "UPDATE authz.project_assignment SET unit_id=$1 WHERE id=$2",
      [root, assignment],
    );
    // Unit-only assignment covers descendants, never unrelated branches; hierarchy cycles fail closed.
    await owner.query(
      "UPDATE authz.project_assignment SET geography_id=NULL WHERE id=$1",
      [assignment],
    );
    expect(await allowed()).toBe(true);
    expect(await allowed(projectId, otherGeo)).toBe(false);
    await owner.query(
      "UPDATE farm.organizational_unit SET parent_id=$1 WHERE id=$2",
      [child, root],
    );
    expect(await allowed()).toBe(false);
    await owner.query(
      "UPDATE farm.organizational_unit SET parent_id=NULL WHERE id=$1",
      [root],
    );
    await owner.query("UPDATE farm.geography SET active=false WHERE id=$1", [
      geographyId,
    ]);
    expect(await allowed()).toBe(false);
    await owner.query("UPDATE farm.geography SET active=true WHERE id=$1", [
      geographyId,
    ]);
    // Composite foreign keys prohibit forged organization/project/geography/unit combinations.
    for (const table of ["project_permission_grant", "project_assignment"])
      for (const change of ["project_id", "geography_id"])
        await expect(
          owner.query(`UPDATE authz.${table} SET ${change}=$1 WHERE id=$2`, [
            change === "project_id" ? foreignProject : foreignGeo,
            table === "project_assignment" ? assignment : grant,
          ]),
        ).rejects.toMatchObject({ code: "23503" });
    await expect(
      owner.query(
        "UPDATE authz.project_assignment SET geography_id=NULL,unit_id=NULL WHERE id=$1",
        [assignment],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      owner.query(
        "UPDATE authz.project_permission_grant SET registration_source='administrator' WHERE id=$1",
        [grant],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    // A synthetic RLS fixture proves direct SQL uses the same predicate; it is not an enrollment schema.
    await owner.query(
      "CREATE TABLE operations.test_scope_record(project_id uuid,geography_id uuid); ALTER TABLE operations.test_scope_record ENABLE ROW LEVEL SECURITY; ALTER TABLE operations.test_scope_record FORCE ROW LEVEL SECURITY; CREATE POLICY scope_read ON operations.test_scope_record FOR SELECT TO agri_project_runtime USING(authz.allowed_project_geography(project_id,geography_id,'enrollment.read',NULL)); GRANT SELECT ON operations.test_scope_record TO agri_project_runtime",
    );
    await owner.query(
      "INSERT INTO operations.test_scope_record VALUES($1,$2),($1,$3),($4,$2)",
      [projectId, geographyId, otherGeo, otherProjectId],
    );
    expect(
      (await db.query("SELECT * FROM operations.test_scope_record")).rows,
    ).toEqual([]);
    const readRows = () =>
      policy.read(db, actor, { projectId, geographyId }, (c) =>
        c.query("SELECT * FROM operations.test_scope_record"),
      );
    expect((await readRows()).rows).toEqual([
      { project_id: projectId, geography_id: geographyId },
    ]);
    const otherActor = { accountId: randomUUID(), sessionId: randomUUID() },
      otherDevice = randomUUID();
    await owner.query(
      "INSERT INTO authn.account(id,login_name,password_hash) VALUES($1,$2,'$argon2id$synthetic-scope-only')",
      [otherActor.accountId, `synthetic-scope-${otherActor.accountId}`],
    );
    await owner.query(
      "INSERT INTO authn.device(id,account_id,state,approved_at) VALUES($1,$2,'approved',now())",
      [otherDevice, otherActor.accountId],
    );
    await owner.query(
      "INSERT INTO authn.login_session(id,account_id,device_id,device_required,cookie_secret_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,$3,true,$4,now()+interval '1 hour',now()+interval '1 day')",
      [
        otherActor.sessionId,
        otherActor.accountId,
        otherDevice,
        randomBytes(32),
      ],
    );
    expect(
      await allowed(
        projectId,
        geographyId,
        "enrollment.read",
        null,
        otherActor,
      ),
    ).toBe(false);
    await owner.query(
      "INSERT INTO authz.project_permission_grant(id,account_id,organization_id,project_id,permission,starts_at) VALUES(gen_random_uuid(),$1,$2,$3,'enrollment.read',now()-interval '1 hour')",
      [otherActor.accountId, organizationId, otherProjectId],
    );
    await owner.query(
      "INSERT INTO authz.project_assignment(id,account_id,organization_id,project_id,geography_id,starts_at) VALUES(gen_random_uuid(),$1,$2,$3,$4,now()-interval '1 hour')",
      [otherActor.accountId, organizationId, otherProjectId, geographyId],
    );
    expect(
      (
        await context.run(db, otherActor, (c) =>
          c.query("SELECT * FROM operations.test_scope_record"),
        )
      ).rows,
    ).toEqual([{ project_id: otherProjectId, geography_id: geographyId }]);
    expect((await readRows()).rows).toEqual([
      { project_id: projectId, geography_id: geographyId },
    ]);
    await owner.query(
      "UPDATE authn.login_session SET revoked_at=clock_timestamp() WHERE id=$1",
      [otherActor.sessionId],
    );
    expect(
      (
        await context.run(db, otherActor, (c) =>
          c.query("SELECT * FROM operations.test_scope_record"),
        )
      ).rows,
    ).toEqual([]);
    await owner.query(
      "INSERT INTO authz.project_permission_grant(id,account_id,organization_id,project_id,permission,registration_source,starts_at) VALUES(gen_random_uuid(),$1,$2,$3,'enrollment.create','field_officer',now()-interval '1 hour')",
      [actor.accountId, organizationId, projectId],
    );
    expect(
      await policy.create(
        db,
        actor,
        "field_officer",
        { projectId, geographyId },
        async () => "scope prerequisite only",
      ),
    ).toBe("scope prerequisite only");
    await expect(
      policy.create(
        db,
        actor,
        "administrator",
        { projectId, geographyId },
        async () => true,
      ),
    ).rejects.toMatchObject({ status: 403 });
    // Bypassing NestJS still cannot read/write scope tables or assume the NOLOGIN owner.
    for (const sql of [
      "SELECT id FROM authz.project_assignment",
      "SELECT account_id FROM authz.project_permission_grant",
      "UPDATE authz.project_assignment SET active=false",
      "SET ROLE agri_project_scope_owner",
    ])
      await expect(
        context.run(db, actor, (c) => c.query(sql)),
      ).rejects.toMatchObject({ code: "42501" });
    // Recheck after a lock wait: both grant and assignment revocation/expiry must be current.
    for (const table of [
      "project_permission_grant",
      "project_assignment",
    ] as const)
      for (const restriction of [
        "active=false",
        "expires_at=clock_timestamp()-interval '1 second'",
      ]) {
        const id = table === "project_assignment" ? assignment : grant;
        let pending: Promise<boolean> | undefined;
        try {
          await owner.query("BEGIN");
          await owner.query(
            `UPDATE authz.${table} SET active=true WHERE id=$1`,
            [id],
          );
          const pid = (await db.query("SELECT pg_backend_pid() AS pid")).rows[0]
            .pid;
          pending = allowed();
          let waiting = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            waiting = (
              await owner.query(
                "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting",
                [pid],
              )
            ).rows[0].waiting;
            if (waiting) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(waiting).toBe(true);
          await owner.query(
            `UPDATE authz.${table} SET ${restriction} WHERE id=$1`,
            [id],
          );
          await owner.query("COMMIT");
          expect(await pending).toBe(false);
        } finally {
          await owner.query("ROLLBACK");
          await pending;
          await owner.query(
            `UPDATE authz.${table} SET active=true,expires_at=NULL WHERE id=$1`,
            [id],
          );
        }
      }
    // A grant/session can expire AFTER its own lock was acquired, while waiting on assignment.
    const sessionBefore = (
      await owner.query(
        "SELECT idle_expires_at FROM authn.login_session WHERE id=$1",
        [actor.sessionId],
      )
    ).rows[0].idle_expires_at;
    for (const mode of ["grant", "session"] as const) {
      let pending: Promise<boolean> | undefined;
      try {
        if (mode === "grant")
          await owner.query(
            "UPDATE authz.project_permission_grant SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE id=$1",
            [grant],
          );
        else
          await owner.query(
            "UPDATE authn.login_session SET idle_expires_at=clock_timestamp()+interval '500 milliseconds' WHERE id=$1",
            [actor.sessionId],
          );
        await owner.query("BEGIN");
        await owner.query(
          "UPDATE authz.project_assignment SET active=true WHERE id=$1",
          [assignment],
        );
        const pid = (await db.query("SELECT pg_backend_pid() AS pid")).rows[0]
          .pid;
        pending = allowed();
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          waiting = (
            await owner.query(
              "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting",
              [pid],
            )
          ).rows[0].waiting;
          if (waiting) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 600));
        await owner.query("COMMIT");
        expect(await pending).toBe(false);
      } finally {
        await owner.query("ROLLBACK");
        await pending;
        await owner.query(
          "UPDATE authz.project_permission_grant SET expires_at=NULL WHERE id=$1",
          [grant],
        );
        await owner.query(
          "UPDATE authn.login_session SET idle_expires_at=$1 WHERE id=$2",
          [sessionBefore, actor.sessionId],
        );
      }
    }
    // The final NestJS check rolls back transaction-local writes if authorization expires during work.
    await owner.query(
      "CREATE TABLE operations.test_scope_effect(value text); GRANT INSERT ON operations.test_scope_effect TO agri_project_runtime",
    );
    await owner.query(
      "UPDATE authz.project_permission_grant SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE id=$1",
      [grant],
    );
    try {
      await expect(
        policy.read(db, actor, { projectId, geographyId }, async (c) => {
          await c.query(
            "INSERT INTO operations.test_scope_effect VALUES('Synthetic rollback marker')",
          );
          await c.query("SELECT pg_sleep(0.6)");
          return "must not be returned";
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (await owner.query("SELECT * FROM operations.test_scope_effect")).rows,
      ).toEqual([]);
    } finally {
      await owner.query(
        "UPDATE authz.project_permission_grant SET expires_at=NULL WHERE id=$1",
        [grant],
      );
      await owner.query("DROP TABLE operations.test_scope_effect");
    }
    await expect(
      context.run(owner, actor, async (c) => {
        await c.query("SET LOCAL ROLE agri_project_scope_owner");
        return c.query("UPDATE operations.project SET id=id WHERE id=$1", [
          projectId,
        ]);
      }),
    ).rejects.toMatchObject({ code: "42501" });
    // Startup rejects accidental column privileges and scope-owner inheritance.
    for (const [enable, disable] of [
      [
        "GRANT SELECT(account_id) ON authz.project_permission_grant TO agri_test_login_9",
        "REVOKE SELECT(account_id) ON authz.project_permission_grant FROM agri_test_login_9",
      ],
      [
        "GRANT UPDATE(active) ON authz.project_assignment TO agri_test_login_9",
        "REVOKE UPDATE(active) ON authz.project_assignment FROM agri_test_login_9",
      ],
      [
        "GRANT agri_project_scope_owner TO agri_test_login_9",
        "REVOKE agri_project_scope_owner FROM agri_test_login_9",
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
      "REVOKE EXECUTE ON FUNCTION authz.allowed_project_geography(uuid,uuid,text,text) FROM agri_project_runtime",
    );
    try {
      await expect(createPilotRuntime(runtimeEnv)).rejects.toThrow(
        "Project scope migration",
      );
    } finally {
      await owner.query(
        "GRANT EXECUTE ON FUNCTION authz.allowed_project_geography(uuid,uuid,text,text) TO agri_project_runtime",
      );
    }
  } finally {
    await db.end();
    await owner.query("DROP TABLE IF EXISTS operations.test_scope_record");
    await owner.query(
      "UPDATE farm.geography SET active=true,unit_id=$1 WHERE id=$2",
      [originalUnit, geographyId],
    );
  }
}
