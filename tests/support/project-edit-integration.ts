import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import pg from "pg";
import {
  TransactionActorContext,
  type VerifiedActor,
} from "../../apps/api/src/authorization/transaction-context";
import { createPilotRuntime } from "../../apps/api/src/pilot/runtime";
type Browser = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<Response>;
export async function verifyProjectEditing({
  owner,
  actor,
  organizationId,
  geographyId,
  projectId,
  runtimeUrl,
  runtimeEnv,
  browser,
  fieldBrowser,
}: {
  owner: pg.Client;
  actor: VerifiedActor;
  organizationId: string;
  geographyId: string;
  projectId: string;
  runtimeUrl: string;
  runtimeEnv: Record<string, string>;
  browser: Browser;
  fieldBrowser: Browser;
}) {
  const original = (
    await owner.query(
      "SELECT organization_id,created_by,created_at::text,name,active,version FROM operations.project WHERE id=$1",
      [projectId],
    )
  ).rows[0];
  const input = {
    mutationId: randomUUID(),
    projectId,
    expectedVersion: 1,
    name: "Synthetic edited catalog project",
    active: true,
  };
  const post = (value: unknown) => browser("projects/change", "POST", value);
  expect((await post(input)).status).toBe(404);
  const readGrant = randomUUID(),
    updateGrant = randomUUID(),
    unit = randomUUID(),
    otherOrg = randomUUID();
  await owner.query(
    "INSERT INTO farm.organization(id,name) VALUES($1,'Synthetic edit isolation organization')",
    [otherOrg],
  );
  await owner.query(
    "INSERT INTO farm.organizational_unit(id,organization_id,name) VALUES($1,$2,'Synthetic edit unit')",
    [unit, organizationId],
  );
  await owner.query(
    "INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,starts_at) VALUES($1,$2,$3,'project.read','organization',now()-interval '1 hour')",
    [readGrant, actor.accountId, organizationId],
  );
  expect(
    (await (await browser(`projects/detail?id=${projectId}`)).json()).access
      .edit,
  ).toBe(false);
  expect((await post(input)).status).toBe(403);
  await owner.query(
    "INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,registration_source,starts_at) VALUES($1,$2,$3,'project.update','organization','administrator',now()-interval '1 hour')",
    [updateGrant, actor.accountId, organizationId],
  );
  for (const restriction of [
    "active=false",
    "starts_at=now()+interval '1 hour'",
    "starts_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'",
    "registration_source=NULL",
    "registration_source='field_officer'",
    `coverage='assigned',geography_id='${geographyId}'`,
    `geography_id='${geographyId}'`,
    `unit_id='${unit}'`,
    `organization_id='${otherOrg}'`,
  ]) {
    await owner.query(
      `UPDATE authz.permission_grant SET ${restriction} WHERE id=$1`,
      [updateGrant],
    );
    expect((await post(input)).status).toBe(403);
    expect(
      (await (await browser(`projects/detail?id=${projectId}`)).json()).access
        .edit,
    ).toBe(false);
    await owner.query(
      "UPDATE authz.permission_grant SET active=true,starts_at=now()-interval '1 hour',expires_at=NULL,coverage='organization',geography_id=NULL,unit_id=NULL,registration_source='administrator',organization_id=$2 WHERE id=$1",
      [updateGrant, organizationId],
    );
  }
  expect(
    (await (await browser(`projects/detail?id=${projectId}`)).json()).access
      .edit,
  ).toBe(true);
  expect(
    (await (await fieldBrowser(`projects/detail?id=${projectId}`)).json())
      .access.edit,
  ).toBe(false);
  expect((await fieldBrowser("projects/change", "POST", input)).status).toBe(
    403,
  );
  await owner.query(
    "UPDATE authz.permission_grant SET active=false WHERE id=$1",
    [readGrant],
  );
  expect((await post(input)).status).toBe(404);
  await owner.query(
    "UPDATE authz.permission_grant SET active=true WHERE id=$1",
    [readGrant],
  );
  for (const extra of [
    { organizationId: otherOrg },
    { createdBy: actor.accountId },
    { accountId: actor.accountId },
    { source: "administrator" },
    { version: 2 },
    { expectedVersion: 0 },
    { expectedVersion: 2147483647 },
    { active: undefined },
    { name: "   " },
  ])
    expect((await post({ ...input, ...extra })).status).toBe(400);
  expect(
    (await post({ ...input, name: original.name, active: original.active }))
      .status,
  ).toBe(400);
  expect((await post(input)).status).toBe(200);
  expect(await (await post(input)).json()).toEqual({
    projectId,
    version: 2,
    replayed: true,
  });
  expect(
    (await post({ ...input, name: "Synthetic changed retry" })).status,
  ).toBe(409);
  expect((await post({ ...input, mutationId: randomUUID() })).status).toBe(409);
  const current = (
    await owner.query(
      "SELECT organization_id,created_by,created_at::text,name,active,version FROM operations.project WHERE id=$1",
      [projectId],
    )
  ).rows[0];
  expect(current).toEqual({
    ...original,
    name: input.name,
    active: true,
    version: 2,
  });
  expect(
    (
      await owner.query(
        "SELECT expected_version,version,old_name,new_name,old_active,new_active FROM operations.project_change WHERE id=$1",
        [input.mutationId],
      )
    ).rows,
  ).toEqual([
    {
      expected_version: 1,
      version: 2,
      old_name: original.name,
      new_name: input.name,
      old_active: original.active,
      new_active: true,
    },
  ]);
  expect(
    (
      await owner.query(
        "SELECT action,record_version,change_id FROM operations.audit WHERE project_id=$1 ORDER BY record_version",
        [projectId],
      )
    ).rows,
  ).toEqual([
    { action: "project.create", record_version: 1, change_id: null },
    {
      action: "project.update",
      record_version: 2,
      change_id: input.mutationId,
    },
  ]);
  const next = {
    ...input,
    mutationId: randomUUID(),
    expectedVersion: 2,
    name: "Synthetic second edit",
    active: false,
  };
  expect(await (await post(next)).json()).toEqual({
    projectId,
    version: 3,
    replayed: false,
  });
  expect(await (await post(input)).json()).toEqual({
    projectId,
    version: 2,
    replayed: true,
  });
  expect(
    (await (await browser(`projects/detail?id=${projectId}`)).json()).project,
  ).toMatchObject({ name: next.name, active: false, version: 3 });
  const concurrent = {
    ...input,
    mutationId: randomUUID(),
    expectedVersion: 3,
    name: "Synthetic concurrent edit",
  };
  const same = await Promise.all([post(concurrent), post(concurrent)]);
  expect(same.map((row) => row.status)).toEqual([200, 200]);
  expect(
    (await Promise.all(same.map((row) => row.json())))
      .map((row) => row.replayed)
      .sort(),
  ).toEqual([false, true]);
  const competing = [
    {
      ...input,
      mutationId: randomUUID(),
      expectedVersion: 4,
      name: "Synthetic competing A",
      active: false,
    },
    {
      ...input,
      mutationId: randomUUID(),
      expectedVersion: 4,
      name: "Synthetic competing B",
      active: false,
    },
  ];
  const responses = await Promise.all(competing.map(post));
  expect(responses.map((row) => row.status).sort()).toEqual([200, 409]);
  expect(
    (
      await owner.query(
        "SELECT count(*)::int AS n FROM operations.project_change WHERE project_id=$1",
        [projectId],
      )
    ).rows[0].n,
  ).toBe(4);
  const beforeFailure = (
    await owner.query(
      "SELECT name,active,version FROM operations.project WHERE id=$1",
      [projectId],
    )
  ).rows[0];
  expect(beforeFailure.version).toBe(5);
  const failing = {
    ...input,
    mutationId: randomUUID(),
    expectedVersion: 5,
    name: "Synthetic audited edit",
    active: false,
  };
  await owner.query(
    "CREATE FUNCTION operations.test_fail_edit_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic edit audit failure'; END $$; CREATE TRIGGER test_fail_edit_audit BEFORE INSERT ON operations.audit FOR EACH ROW WHEN(NEW.action='project.update') EXECUTE FUNCTION operations.test_fail_edit_audit()",
  );
  try {
    const result = await post(failing);
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("Synthetic edit audit failure");
    expect(
      (
        await owner.query(
          "SELECT name,active,version FROM operations.project WHERE id=$1",
          [projectId],
        )
      ).rows[0],
    ).toEqual(beforeFailure);
    expect(
      (
        await owner.query(
          "SELECT id FROM operations.project_change WHERE id=$1",
          [failing.mutationId],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await owner.query(
      "DROP TRIGGER test_fail_edit_audit ON operations.audit; DROP FUNCTION operations.test_fail_edit_audit()",
    );
  }
  expect(await (await post(failing)).json()).toEqual({
    projectId,
    version: 6,
    replayed: false,
  });
  const raw = new pg.Client({ connectionString: runtimeUrl }),
    context = new TransactionActorContext(Buffer.alloc(32, 42));
  await raw.connect();
  const sql = "SELECT * FROM operations.change_project($1,$2,$3,$4,$5,$6)";
  try {
    await expect(
      raw.query(sql, [
        randomUUID(),
        projectId,
        6,
        "Synthetic direct",
        true,
        "administrator",
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    for (const query of [
      "SELECT * FROM operations.project_change",
      "SELECT new_name FROM operations.project_change",
      "UPDATE operations.project SET active=true",
      "UPDATE operations.project SET organization_id=organization_id",
    ])
      await expect(
        context.run(raw, actor, (db) => db.query(query, [])),
      ).rejects.toMatchObject({ code: "42501" });
    await expect(
      context.run(raw, actor, (db) =>
        db.query(sql, [
          randomUUID(),
          projectId,
          6,
          "Synthetic direct",
          true,
          "field_officer",
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await owner.query(
      "UPDATE authz.permission_grant SET active=false WHERE id=$1",
      [readGrant],
    );
    await expect(
      context.run(raw, actor, (db) =>
        db.query(sql, [
          randomUUID(),
          projectId,
          6,
          "Synthetic direct",
          true,
          "administrator",
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await owner.query(
      "UPDATE authz.permission_grant SET active=true WHERE id=$1",
      [readGrant],
    );
    // Both a fresh edit waiting on its row and a replay waiting on its mutation must reauthorize.
    for (const kind of ["row", "replay"] as const) {
      await owner.query(
        "UPDATE authz.permission_grant SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",
        [updateGrant],
      );
      await owner.query("BEGIN");
      if (kind === "row")
        await owner.query(
          "SELECT id FROM operations.project WHERE id=$1 FOR UPDATE",
          [projectId],
        );
      else
        await owner.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('agri-project-change:'||$1::text,0))",
          [input.mutationId],
        );
      let outcome: Promise<unknown> | undefined;
      const mutation = kind === "row" ? randomUUID() : input.mutationId;
      try {
        const pid = (await raw.query("SELECT pg_backend_pid() AS pid")).rows[0]
          .pid;
        outcome = context
          .run(raw, actor, (db) =>
            db.query(sql, [
              mutation,
              projectId,
              kind === "row" ? 6 : input.expectedVersion,
              kind === "row" ? "Synthetic waiting edit" : input.name,
              true,
              "administrator",
            ]),
          )
          .then(
            () => null,
            (error) => error,
          );
        let waiting = false;
        for (let attempt = 0; attempt < 50; attempt++) {
          waiting = (
            await owner.query(
              "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting",
              [pid],
            )
          ).rows[0].waiting;
          if (waiting) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBe(true);
        let expired = false;
        for (let attempt = 0; attempt < 80; attempt++) {
          expired = (
            await owner.query(
              "SELECT clock_timestamp()>expires_at AS expired FROM authz.permission_grant WHERE id=$1",
              [updateGrant],
            )
          ).rows[0].expired;
          if (expired) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(expired).toBe(true);
        await owner.query("COMMIT");
        expect(await outcome).toMatchObject({ code: "42501" });
        expect(
          (
            await owner.query(
              "SELECT id FROM operations.project_change WHERE id=$1",
              [mutation],
            )
          ).rowCount,
        ).toBe(kind === "row" ? 0 : 1);
      } finally {
        await owner.query("ROLLBACK");
        await outcome;
        await owner.query(
          "UPDATE authz.permission_grant SET expires_at=NULL WHERE id=$1",
          [updateGrant],
        );
      }
    }
    await owner.query(
      "UPDATE authz.permission_grant SET active=false WHERE id=$1",
      [updateGrant],
    );
    expect((await post(input)).status).toBe(403);
    await expect(
      context.run(raw, actor, (db) =>
        db.query(sql, [
          input.mutationId,
          projectId,
          1,
          input.name,
          true,
          "administrator",
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await raw.end();
  }
  await owner.query(
    "GRANT SELECT(new_name) ON operations.project_change TO agri_test_login_9",
  );
  try {
    await expect(createPilotRuntime(runtimeEnv)).rejects.toThrow(
      "least privilege",
    );
  } finally {
    await owner.query(
      "REVOKE SELECT(new_name) ON operations.project_change FROM agri_test_login_9",
    );
  }
  await owner.query(
    "UPDATE authz.permission_grant SET active=false WHERE id=$1",
    [readGrant],
  );
  expect((await browser(`projects/detail?id=${projectId}`)).status).toBe(404);
  await owner.query(
    "REVOKE EXECUTE ON FUNCTION operations.change_project(uuid,uuid,integer,text,boolean,text) FROM agri_project_runtime",
  );
  try {
    await expect(createPilotRuntime(runtimeEnv)).rejects.toThrow(
      "Project editing migration",
    );
  } finally {
    await owner.query(
      "GRANT EXECUTE ON FUNCTION operations.change_project(uuid,uuid,integer,text,boolean,text) TO agri_project_runtime",
    );
  }
}
