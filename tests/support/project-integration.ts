import { verifyProjectEditing } from "./project-edit-integration";
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
export async function verifyProjectCatalog({
  owner,
  actor,
  geographyId,
  runtimeUrl,
  runtimeEnv,
  browser,
  fieldBrowser,
}: {
  owner: pg.Client;
  actor: VerifiedActor;
  geographyId: string;
  runtimeUrl: string;
  runtimeEnv: Record<string, string>;
  browser: Browser;
  fieldBrowser: Browser;
}) {
  expect(
    (await owner.query("SELECT current_database() AS name")).rows[0].name,
  ).toBe("agri_test");
  const organizationId = (
    await owner.query(
      "SELECT organization_id FROM farm.geography WHERE id=$1",
      [geographyId],
    )
  ).rows[0].organization_id;
  const value = {
    mutationId: randomUUID(),
    projectId: randomUUID(),
    organizationId,
    name: "Synthetic configurable project",
  };
  expect((await browser("projects/register", "POST", value)).status).toBe(403);
  expect(await (await browser("projects/organizations")).json()).toEqual({
    accountId: actor.accountId,
    organizations: [],
  });
  const createGrant = randomUUID(),
    readGrant = randomUUID(),
    unit = randomUUID();
  await owner.query(
    "INSERT INTO farm.organizational_unit(id,organization_id,name) VALUES($1,$2,'Synthetic catalog restriction')",
    [unit, organizationId],
  );
  await owner.query(
    "INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,registration_source,starts_at) VALUES($1,$2,$3,'project.create','organization','administrator',now()-interval '1 hour')",
    [createGrant, actor.accountId, organizationId],
  );
  for (const restriction of [
    "active=false",
    "starts_at=now()+interval '1 hour'",
    "starts_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'",
    "registration_source='field_officer'",
    `coverage='assigned',geography_id='${geographyId}'`,
    `geography_id='${geographyId}'`,
    `unit_id='${unit}'`,
  ]) {
    await owner.query(
      `UPDATE authz.permission_grant SET ${restriction} WHERE id=$1`,
      [createGrant],
    );
    expect((await browser("projects/register", "POST", value)).status).toBe(
      403,
    );
    expect(
      (await (await browser("projects/organizations")).json()).organizations,
    ).toEqual([]);
    await owner.query(
      "UPDATE authz.permission_grant SET active=true,starts_at=now()-interval '1 hour',expires_at=NULL,coverage='organization',geography_id=NULL,unit_id=NULL,registration_source='administrator' WHERE id=$1",
      [createGrant],
    );
  }
  const choices = await (await browser("projects/organizations")).json();
  expect(choices.organizations.map((row: { id: string }) => row.id)).toEqual([
    organizationId,
  ]);
  expect((await fieldBrowser("projects/register", "POST", value)).status).toBe(
    403,
  );
  for (const extra of [
    { accountId: actor.accountId },
    { source: "administrator" },
    { farmerId: randomUUID() },
    { projectType: "hardcoded" },
    { createdBy: actor.accountId },
  ])
    expect(
      (await browser("projects/register", "POST", { ...value, ...extra }))
        .status,
    ).toBe(400);
  const created = await browser("projects/register", "POST", value);
  expect(created.status).toBe(200);
  expect(await created.json()).toEqual({
    status: "synced",
    projectId: value.projectId,
    replayed: false,
  });
  expect(
    await (await browser("projects/register", "POST", value)).json(),
  ).toEqual({ status: "synced", projectId: value.projectId, replayed: true });
  expect(
    (await browser("projects/register", "POST", { ...value, active: true }))
      .status,
  ).toBe(409);
  expect(
    (
      await owner.query(
        "SELECT active,version,created_by FROM operations.project WHERE id=$1",
        [value.projectId],
      )
    ).rows,
  ).toEqual([{ active: false, version: 1, created_by: actor.accountId }]);
  expect(
    (
      await owner.query(
        "SELECT actor_id,session_id,action FROM operations.audit WHERE project_id=$1",
        [value.projectId],
      )
    ).rows,
  ).toEqual([
    {
      actor_id: actor.accountId,
      session_id: actor.sessionId,
      action: "project.create",
    },
  ]);
  expect(await (await browser("projects")).json()).toEqual({
    accountId: actor.accountId,
    items: [],
    nextCursor: null,
  });
  expect((await browser(`projects/detail?id=${value.projectId}`)).status).toBe(
    404,
  );
  await owner.query(
    "INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,starts_at) VALUES($1,$2,$3,'project.read','organization',now()-interval '1 hour')",
    [readGrant, actor.accountId, organizationId],
  );
  const second = {
    ...value,
    mutationId: randomUUID(),
    projectId: randomUUID(),
    name: "Synthetic second project",
    active: true,
  };
  expect((await browser("projects/register", "POST", second)).status).toBe(200);
  const otherOrganization = randomUUID(),
    hidden = randomUUID();
  await owner.query(
    "INSERT INTO farm.organization(id,name) VALUES($1,'Synthetic hidden catalog organization')",
    [otherOrganization],
  );
  await owner.query(
    "INSERT INTO operations.project(id,organization_id,name,created_by) VALUES($1,$2,'Synthetic hidden project',$3)",
    [hidden, otherOrganization, actor.accountId],
  );
  expect(
    (
      await browser("projects/register", "POST", {
        ...value,
        mutationId: randomUUID(),
        projectId: randomUUID(),
        organizationId: otherOrganization,
      })
    ).status,
  ).toBe(403);
  for (const id of [hidden, randomUUID()])
    expect((await browser(`projects/detail?id=${id}`)).status).toBe(404);
  const items: Array<{ id: string }> = [];
  let cursor: string | null = null;
  do {
    const page = await (
      await browser(`projects?limit=1${cursor ? `&after=${cursor}` : ""}`)
    ).json();
    expect(page).not.toHaveProperty("total");
    expect(page.items).toHaveLength(1);
    items.push(...page.items);
    cursor = page.nextCursor;
    expect(items.length).toBeLessThan(4);
  } while (cursor);
  expect(items.map((row) => row.id).sort()).toEqual(
    [value.projectId, second.projectId].sort(),
  );
  expect(JSON.stringify(items)).not.toContain(hidden);
  expect(JSON.stringify(items)).not.toContain("Synthetic hidden project");
  const detail = await (
    await browser(`projects/detail?id=${value.projectId}`)
  ).json();
  expect(detail).toMatchObject({
    accountId: actor.accountId,
    project: {
      id: value.projectId,
      organizationId,
      name: value.name,
      active: false,
      version: 1,
    },
  });
  expect(detail.project).not.toHaveProperty("createdBy");
  for (const path of [
    `projects?accountId=${actor.accountId}`,
    "projects?limit=101",
    "projects?limit=1&limit=2",
    `projects/organizations?organizationId=${organizationId}`,
  ])
    expect((await browser(path)).status).toBe(400);
  const raw = new pg.Client({ connectionString: runtimeUrl }),
    context = new TransactionActorContext(Buffer.alloc(32, 42));
  await raw.connect();
  try {
    expect((await raw.query("SELECT id FROM operations.project")).rows).toEqual(
      [],
    );
    await expect(
      raw.query(
        "SELECT * FROM operations.register_project($1,$2,$3,'Synthetic',false,'administrator')",
        [randomUUID(), randomUUID(), organizationId],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await context.run(raw, actor, (db) =>
          db.query("SELECT id FROM operations.project", []),
        )
      ).rows
        .map((row) => (row as { id: string }).id)
        .sort(),
    ).toEqual([value.projectId, second.projectId].sort());
    for (const sql of [
      "SELECT * FROM operations.audit",
      "SELECT * FROM operations.project_mutation",
      "SELECT key FROM authz.context_key",
      "SELECT created_by FROM operations.project",
      "UPDATE operations.project SET name='Synthetic unauthorized'",
      "INSERT INTO operations.project(id,organization_id,name) VALUES(gen_random_uuid(),gen_random_uuid(),'Synthetic')",
      "SELECT id FROM farm.farmer",
      "SELECT id FROM land.identification",
      "SET ROLE agri_project_function_owner",
    ])
      await expect(
        context.run(raw, actor, (db) => db.query(sql, [])),
      ).rejects.toMatchObject({ code: "42501" });
    await expect(
      context.run(raw, actor, (db) =>
        db.query(
          "SELECT * FROM operations.register_project($1,$2,$3,'  ',false,'administrator')",
          [randomUUID(), randomUUID(), organizationId],
        ),
      ),
    ).rejects.toMatchObject({ code: "22023" });
  } finally {
    await raw.end();
  }
  const concurrent = {
    ...value,
    mutationId: randomUUID(),
    projectId: randomUUID(),
  };
  const results = await Promise.all([
    browser("projects/register", "POST", concurrent),
    browser("projects/register", "POST", concurrent),
  ]);
  expect(results.map((row) => row.status)).toEqual([200, 200]);
  expect(
    (await Promise.all(results.map((row) => row.json())))
      .map((row) => row.replayed)
      .sort(),
  ).toEqual([false, true]);
  expect(
    (
      await owner.query(
        "SELECT count(*)::int AS n FROM operations.audit WHERE project_id=$1",
        [concurrent.projectId],
      )
    ).rows[0].n,
  ).toBe(1);
  const failing = {
    ...value,
    mutationId: randomUUID(),
    projectId: randomUUID(),
  };
  await owner.query(
    "CREATE FUNCTION operations.test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic project audit failure'; END $$; CREATE TRIGGER test_fail_audit BEFORE INSERT ON operations.audit FOR EACH ROW EXECUTE FUNCTION operations.test_fail_audit()",
  );
  try {
    const failure = await browser("projects/register", "POST", failing);
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain(
      "Synthetic project audit failure",
    );
    expect(
      (
        await owner.query("SELECT id FROM operations.project WHERE id=$1", [
          failing.projectId,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await owner.query(
          "SELECT id FROM operations.project_mutation WHERE id=$1",
          [failing.mutationId],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await owner.query(
      "DROP TRIGGER test_fail_audit ON operations.audit; DROP FUNCTION operations.test_fail_audit()",
    );
  }
  expect((await browser("projects/register", "POST", failing)).status).toBe(
    200,
  );
  await owner.query(
    "GRANT SELECT(id) ON operations.project_mutation TO agri_test_login_9",
  );
  try {
    await expect(createPilotRuntime(runtimeEnv)).rejects.toThrow(
      "least privilege",
    );
  } finally {
    await owner.query(
      "REVOKE SELECT(id) ON operations.project_mutation FROM agri_test_login_9",
    );
  }
  await owner.query("GRANT agri_project_function_owner TO agri_test_login_9");
  try {
    await expect(createPilotRuntime(runtimeEnv)).rejects.toThrow(
      "least privilege",
    );
  } finally {
    await owner.query(
      "REVOKE agri_project_function_owner FROM agri_test_login_9",
    );
  }
  const blocked = new pg.Client({ connectionString: runtimeUrl });
  await blocked.connect();
  let outcome: Promise<unknown> | undefined;
  const waitingMutation = randomUUID();
  try {
    const pid = (await blocked.query("SELECT pg_backend_pid() AS pid")).rows[0]
      .pid;
    await owner.query("BEGIN");
    await owner.query(
      "UPDATE authz.permission_grant SET expires_at=clock_timestamp()+interval '5 minutes' WHERE id=$1",
      [createGrant],
    );
    const signed = new TransactionActorContext(Buffer.alloc(32, 42));
    outcome = signed
      .run(blocked, actor, (db) =>
        db.query(
          "SELECT * FROM operations.register_project($1,$2,$3,'Synthetic blocked project',false,'administrator')",
          [waitingMutation, randomUUID(), organizationId],
        ),
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
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await owner.query(
      "UPDATE authz.permission_grant SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [createGrant],
    );
    await owner.query("COMMIT");
    expect(await outcome).toMatchObject({ code: "42501" });
    expect(
      (
        await owner.query(
          "SELECT id FROM operations.project_mutation WHERE id=$1",
          [waitingMutation],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await owner.query("ROLLBACK");
    await outcome;
    await blocked.end();
    await owner.query(
      "UPDATE authz.permission_grant SET expires_at=NULL WHERE id=$1",
      [createGrant],
    );
  }
  const missingProjectUrl = JSON.parse(runtimeEnv.PILOT_DATABASE_URLS);
  delete missingProjectUrl.agri_project_runtime;
  await expect(
    createPilotRuntime({
      ...runtimeEnv,
      PILOT_DATABASE_URLS: JSON.stringify(missingProjectUrl),
    }),
  ).rejects.toThrow("connection is missing");
  await owner.query(
    "UPDATE authz.permission_grant SET active=false WHERE id=$1",
    [createGrant],
  );
  expect((await browser("projects/register", "POST", value)).status).toBe(403);
  expect((await browser(`projects/detail?id=${value.projectId}`)).status).toBe(
    200,
  );
  await owner.query(
    "UPDATE authz.permission_grant SET registration_source='administrator' WHERE id=$1",
    [readGrant],
  );
  expect((await browser(`projects/detail?id=${value.projectId}`)).status).toBe(
    404,
  );
  await owner.query(
    "UPDATE authz.permission_grant SET active=false WHERE id=$1",
    [readGrant],
  );
  expect(await (await browser("projects")).json()).toEqual({
    accountId: actor.accountId,
    items: [],
    nextCursor: null,
  });
  await verifyProjectEditing({
    owner,
    actor,
    organizationId,
    geographyId,
    projectId: value.projectId,
    runtimeUrl,
    runtimeEnv,
    browser,
    fieldBrowser,
  });
}
