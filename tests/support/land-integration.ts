import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import pg from "pg";
import {
  TransactionActorContext,
  type VerifiedActor,
} from "../../apps/api/src/authorization/transaction-context";
import { createPilotRuntime } from "../../apps/api/src/pilot/runtime";
type Scenario = {
  owner: pg.Client;
  actor: VerifiedActor;
  geographyId: string;
  otherGeographyId: string;
  databaseUrl: string;
  runtimeUrl: string;
  runtimeEnv: Record<string, string>;
  browser: (path: string, method?: string, body?: unknown) => Promise<Response>;
};
export async function verifyLandIdentification({
  owner,
  actor,
  geographyId,
  otherGeographyId,
  databaseUrl,
  runtimeUrl,
  runtimeEnv,
  browser,
}: Scenario) {
  expect(new URL(databaseUrl).pathname).toBe("/agri_test");
  expect(
    (await owner.query("SELECT current_database() AS name")).rows[0].name,
  ).toBe("agri_test");
  const point = { longitude: 80.25, latitude: 8.3, accuracyM: 12.75 };
  const value = {
    mutationId: randomUUID(),
    landId: randomUUID(),
    geographyId,
    label: "Synthetic reported land",
    point,
    reportedAreaHectares: 0.125,
  };
  expect((await browser("land/register", "POST", value)).status).toBe(403);
  expect(await (await browser("land/geographies", "GET")).json()).toEqual({
    accountId: actor.accountId,
    geographies: [],
  });
  const createGrant = randomUUID(),
    readGrant = randomUUID();
  await owner.query(
    "INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,geography_id,registration_source,starts_at) SELECT $1,$2,organization_id,'land.create','assigned',id,'field_officer',now()-interval '1 hour' FROM farm.geography WHERE id=$3",
    [createGrant, actor.accountId, geographyId],
  );
  const choices = await (await browser("land/geographies", "GET")).json();
  expect(choices.geographies.map((row: { id: string }) => row.id)).toEqual([
    geographyId,
  ]);
  expect(
    (
      await browser("land/register", "POST", {
        ...value,
        geographyId: otherGeographyId,
      })
    ).status,
  ).toBe(403);
  for (const extra of [
    { organizationId: randomUUID() },
    { farmerId: randomUUID() },
    { surveyVerified: true },
    { registrationSource: "administrator" },
  ])
    expect(
      (await browser("land/register", "POST", { ...value, ...extra })).status,
    ).toBe(400);
  const created = await browser("land/register", "POST", value);
  expect(created.status).toBe(200);
  expect(await created.json()).toEqual({
    status: "synced",
    landId: value.landId,
    replayed: false,
  });
  expect(await (await browser("land/register", "POST", value)).json()).toEqual({
    status: "synced",
    landId: value.landId,
    replayed: true,
  });
  expect(
    (
      await browser("land/register", "POST", {
        ...value,
        label: "Synthetic altered retry",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await owner.query(
        "SELECT public.ST_SRID(point) AS srid,public.ST_X(point) AS longitude,public.ST_Y(point) AS latitude,created_by,version FROM land.identification WHERE id=$1",
        [value.landId],
      )
    ).rows[0],
  ).toEqual({
    srid: 4326,
    longitude: point.longitude,
    latitude: point.latitude,
    created_by: actor.accountId,
    version: 1,
  });
  expect(
    (
      await owner.query(
        "SELECT actor_id,session_id,action FROM land.audit WHERE land_id=$1",
        [value.landId],
      )
    ).rows,
  ).toEqual([
    {
      actor_id: actor.accountId,
      session_id: actor.sessionId,
      action: "registration",
    },
  ]);
  expect(await (await browser("land", "GET")).json()).toEqual({
    accountId: actor.accountId,
    items: [],
    nextCursor: null,
  });
  expect((await browser(`land/detail?id=${value.landId}`, "GET")).status).toBe(
    404,
  );
  await owner.query(
    "INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,geography_id,starts_at) SELECT $1,$2,organization_id,'land.read','assigned',id,now()-interval '1 hour' FROM farm.geography WHERE id=$3",
    [readGrant, actor.accountId, geographyId],
  );
  const visible = await (
    await browser(`land/detail?id=${value.landId}`, "GET")
  ).json();
  expect(visible).toMatchObject({
    accountId: actor.accountId,
    land: {
      id: value.landId,
      geographyId,
      label: value.label,
      point,
      reportedAreaHectares: 0.125,
      identificationOnly: true,
    },
  });
  expect(visible.land).not.toHaveProperty("createdBy");
  expect(visible.land).not.toHaveProperty("organizationId");
  const empty = { mutationId: randomUUID(), landId: randomUUID(), geographyId };
  expect((await browser("land/register", "POST", empty)).status).toBe(200);
  expect(
    (await (await browser(`land/detail?id=${empty.landId}`, "GET")).json())
      .land,
  ).toMatchObject({ label: null, point: null, reportedAreaHectares: null });
  const zero = {
    ...value,
    mutationId: randomUUID(),
    landId: randomUUID(),
    point: { longitude: 0, latitude: 0, accuracyM: 0 },
    reportedAreaHectares: 0,
  };
  expect((await browser("land/register", "POST", zero)).status).toBe(200);
  expect(
    (await (await browser(`land/detail?id=${zero.landId}`, "GET")).json()).land,
  ).toMatchObject({ point: zero.point, reportedAreaHectares: 0 });
  const hidden = randomUUID();
  await owner.query(
    "INSERT INTO land.identification(id,organization_id,geography_id,label,point,registration_source,created_by) SELECT $1,organization_id,id,'Synthetic restricted land point',public.ST_SetSRID(public.ST_MakePoint(81.987654,9.876543),4326),'administrator',$3 FROM farm.geography WHERE id=$2",
    [hidden, otherGeographyId, actor.accountId],
  );
  const pages = [];
  let cursor: string | null = null;
  do {
    const response = await browser(
      `land?limit=1${cursor ? `&after=${cursor}` : ""}`,
      "GET",
    );
    expect(response.status).toBe(200);
    const page = await response.json();
    pages.push(...page.items);
    cursor = page.nextCursor;
    if (cursor) expect(cursor).toBe(page.items[0].id);
    expect(pages.length).toBeLessThan(10);
  } while (cursor);
  expect(new Set(pages.map((row) => row.id))).toEqual(
    new Set([value.landId, empty.landId, zero.landId]),
  );
  expect(JSON.stringify(pages)).not.toContain(hidden);
  expect(JSON.stringify(pages)).not.toContain(
    "Synthetic restricted land point",
  );
  expect(JSON.stringify(pages)).not.toContain("81.987654");
  expect((await browser(`land/detail?id=${hidden}`, "GET")).status).toBe(404);
  expect((await browser(`land/detail?id=${randomUUID()}`, "GET")).status).toBe(
    404,
  );
  expect((await browser("land?limit=101", "GET")).status).toBe(400);
  expect(
    (await browser(`land?accountId=${actor.accountId}`, "GET")).status,
  ).toBe(400);
  const raw = new pg.Client({ connectionString: runtimeUrl });
  await raw.connect();
  const context = new TransactionActorContext(Buffer.alloc(32, 42));
  try {
    expect(
      (await raw.query("SELECT id FROM land.identification")).rowCount,
    ).toBe(0);
    await expect(
      raw.query(
        "SELECT * FROM land.register_identification($1,$2,$3,NULL,NULL,NULL,NULL,NULL,'field_officer')",
        [randomUUID(), randomUUID(), geographyId],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    for (const sql of [
      "SELECT * FROM land.audit",
      "SELECT * FROM land.registration_mutation",
      "UPDATE land.identification SET label='Synthetic direct write'",
      "SELECT id FROM farm.farmer",
    ])
      await expect(
        context.run(raw, actor, (db) => db.query(sql, [])),
      ).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await context.run(raw, actor, (db) =>
          db.query("SELECT id FROM land.identification", []),
        )
      ).rows
        .map((row) => (row as { id: string }).id)
        .sort(),
    ).toEqual([value.landId, empty.landId, zero.landId].sort());
    await expect(
      context.run(raw, actor, (db) =>
        db.query(
          "SELECT * FROM land.register_identification($1,$2,$3,NULL,NULL,NULL,NULL,NULL,'administrator')",
          [randomUUID(), randomUUID(), geographyId],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    for (const [longitude, latitude, accuracy, area] of [
      [181, 0, null, null],
      [0, 91, null, null],
      ["NaN", 0, null, null],
      [0, 0, -1, null],
      [null, null, 1, null],
      [0, 0, null, 0.00001],
    ])
      await expect(
        context.run(raw, actor, (db) =>
          db.query(
            "SELECT * FROM land.register_identification($1,$2,$3,NULL,$4,$5,$6,$7,'field_officer')",
            [
              randomUUID(),
              randomUUID(),
              geographyId,
              longitude,
              latitude,
              accuracy,
              area,
            ],
          ),
        ),
      ).rejects.toMatchObject({ code: "22023" });
  } finally {
    await raw.end();
  }
  const concurrent = {
    ...value,
    mutationId: randomUUID(),
    landId: randomUUID(),
  };
  const simultaneous = await Promise.all([
    browser("land/register", "POST", concurrent),
    browser("land/register", "POST", concurrent),
  ]);
  expect(simultaneous.map((result) => result.status)).toEqual([200, 200]);
  const acknowledgments = await Promise.all(
    simultaneous.map((result) => result.json()),
  );
  expect(acknowledgments.map((result) => result.replayed).sort()).toEqual([
    false,
    true,
  ]);
  expect(
    (
      await owner.query(
        "SELECT count(*)::int AS n FROM land.identification WHERE id=$1",
        [concurrent.landId],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await owner.query(
        "SELECT count(*)::int AS n FROM land.audit WHERE land_id=$1",
        [concurrent.landId],
      )
    ).rows[0].n,
  ).toBe(1);
  const failing = { ...value, mutationId: randomUUID(), landId: randomUUID() };
  await owner.query(
    "CREATE FUNCTION land.test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic land audit failure'; END $$; CREATE TRIGGER test_fail_audit BEFORE INSERT ON land.audit FOR EACH ROW EXECUTE FUNCTION land.test_fail_audit()",
  );
  try {
    expect((await browser("land/register", "POST", failing)).status).toBe(503);
    expect(
      (
        await owner.query("SELECT id FROM land.identification WHERE id=$1", [
          failing.landId,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await owner.query(
          "SELECT id FROM land.registration_mutation WHERE id=$1",
          [failing.mutationId],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await owner.query(
      "DROP TRIGGER test_fail_audit ON land.audit; DROP FUNCTION land.test_fail_audit()",
    );
  }
  expect((await browser("land/register", "POST", failing)).status).toBe(200);
  await owner.query("GRANT SELECT(id) ON land.audit TO agri_test_login_8");
  try {
    await expect(createPilotRuntime(runtimeEnv)).rejects.toThrow(
      "least privilege",
    );
  } finally {
    await owner.query("REVOKE SELECT(id) ON land.audit FROM agri_test_login_8");
  }
  await owner.query("GRANT agri_land_function_owner TO agri_test_login_8");
  try {
    await expect(createPilotRuntime(runtimeEnv)).rejects.toThrow(
      "least privilege",
    );
  } finally {
    await owner.query("REVOKE agri_land_function_owner FROM agri_test_login_8");
  }
  await owner.query(
    "UPDATE authz.permission_grant SET active=false WHERE id=$1",
    [createGrant],
  );
  expect((await browser("land/register", "POST", value)).status).toBe(403);
  expect((await browser(`land/detail?id=${value.landId}`, "GET")).status).toBe(
    200,
  );
  await owner.query(
    "UPDATE authz.permission_grant SET active=false WHERE id=$1",
    [readGrant],
  );
  expect(await (await browser("land", "GET")).json()).toEqual({
    accountId: actor.accountId,
    items: [],
    nextCursor: null,
  });
  expect((await browser(`land/detail?id=${value.landId}`, "GET")).status).toBe(
    404,
  );
  const wrongOrganization = randomUUID();
  await owner.query(
    "INSERT INTO farm.organization(id,name) VALUES($1,'Synthetic mismatched land organization')",
    [wrongOrganization],
  );
  try {
    await expect(
      owner.query(
        "INSERT INTO land.identification(id,organization_id,geography_id,registration_source,created_by) VALUES($1,$2,$3,'administrator',$4)",
        [randomUUID(), wrongOrganization, geographyId, actor.accountId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  } finally {
    await owner.query("DELETE FROM farm.organization WHERE id=$1", [
      wrongOrganization,
    ]);
  }
  // Geometry itself is a database invariant, even for privileged synthetic fixture inserts.
  for (const pointSql of [
    "public.ST_SetSRID(public.ST_MakePoint(181,8),4326)",
    "public.ST_SetSRID(public.ST_MakePoint(80,91),4326)",
  ])
    await expect(
      owner.query(
        `INSERT INTO land.identification(id,organization_id,geography_id,point,registration_source,created_by) SELECT $1,organization_id,id,${pointSql},'administrator',$3 FROM farm.geography WHERE id=$2`,
        [randomUUID(), geographyId, actor.accountId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
}
