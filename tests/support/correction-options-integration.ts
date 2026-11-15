import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import pg from "pg";
import {
  TransactionActorContext,
  type VerifiedActor,
} from "../../apps/api/src/authorization/transaction-context";
export async function verifyCorrectionOptions({
  owner,
  browser,
  accountId,
  farmerId,
  sourceGeographyId,
  sourceCorrectGrant,
  actor,
  runtimeUrl,
}: {
  owner: pg.Client;
  browser: (path: string, method: string) => Promise<Response>;
  accountId: string;
  farmerId: string;
  sourceGeographyId: string;
  sourceCorrectGrant: string;
  actor: VerifiedActor;
  runtimeUrl: string;
}) {
  if (
    new URL(runtimeUrl).pathname !== "/agri_test" ||
    (await owner.query("SELECT current_database() AS name")).rows[0].name !==
      "agri_test"
  )
    throw new Error("Disposable agri_test database required");
  const geographies: Array<{ id: string; name: string; kind: string }> = [],
    grants: string[] = [];
  const allowed = new Map<string, string>();
  const sourceName = (
    await owner.query("SELECT name FROM farm.geography WHERE id=$1", [
      sourceGeographyId,
    ])
  ).rows[0].name;
  const get = async (query = "") => {
    const response = await browser(
      `farmers/correction-geographies?id=${farmerId}${query}`,
      "GET",
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  const raw = new pg.Client({ connectionString: runtimeUrl });
  await raw.connect();
  try {
    for (const [kind, permissions, active] of [
      ["read-only", ["farmer.read"], true],
      ["correct-only", ["farmer.correct"], true],
      ["create-only", ["farmer.create"], true],
      ["allowed", ["farmer.read", "farmer.correct"], true],
      ["inactive", ["farmer.read", "farmer.correct"], false],
    ] as const) {
      const id = randomUUID(),
        name = `Synthetic correction ${kind}`;
      geographies.push({ id, name, kind });
      await owner.query(
        "INSERT INTO farm.geography(id,organization_id,name,active) SELECT $1,organization_id,$2,$3 FROM farm.geography WHERE id=$4",
        [id, name, active, sourceGeographyId],
      );
      for (const permission of permissions) {
        const grant = randomUUID();
        grants.push(grant);
        await owner.query(
          "INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,geography_id,registration_source,starts_at) SELECT $1,$2,organization_id,$3,'organization',id,CASE WHEN $3='farmer.create' THEN 'administrator' ELSE NULL END,now()-interval '1 hour' FROM farm.geography WHERE id=$4",
          [grant, accountId, permission, id],
        );
        if (kind === "allowed") allowed.set(permission, grant);
      }
    }
    const first = await get("&limit=1");
    expect(first).toMatchObject({
      accountId,
      farmerId,
      farmerVersion: 2,
      sourceGeographyId,
    });
    expect(first.geographies).toHaveLength(1);
    expect(first.nextCursor).toBe(first.geographies[0].id);
    const second = await get(`&limit=1&after=${first.nextCursor}`);
    expect(second.geographies).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.farmerVersion).toBe(first.farmerVersion);
    expect(second.sourceGeographyId).toBe(first.sourceGeographyId);
    const visible = [...first.geographies, ...second.geographies];
    expect(visible.map((row) => row.id)).toEqual(
      [
        sourceGeographyId,
        geographies.find((row) => row.kind === "allowed")!.id,
      ].sort(),
    );
    expect(
      visible.some(
        (row) => row.id === sourceGeographyId && row.name === sourceName,
      ),
    ).toBe(true);
    for (const item of geographies.filter((row) => row.kind !== "allowed")) {
      expect(JSON.stringify(visible)).not.toContain(item.id);
      expect(JSON.stringify(visible)).not.toContain(item.name);
    }
    expect("total" in first).toBe(false);
    await owner.query(
      "UPDATE authz.permission_grant SET active=false WHERE id=$1",
      [allowed.get("farmer.correct")],
    );
    expect((await get()).geographies).toEqual([
      { id: sourceGeographyId, name: sourceName },
    ]);
    await owner.query(
      "UPDATE authz.permission_grant SET active=true WHERE id=$1",
      [allowed.get("farmer.correct")],
    );
    await owner.query(
      "UPDATE authz.permission_grant SET active=false WHERE id=$1",
      [allowed.get("farmer.read")],
    );
    expect((await get()).geographies).toEqual([
      { id: sourceGeographyId, name: sourceName },
    ]);
    const signed = new TransactionActorContext(Buffer.alloc(32, 42));
    await expect(
      raw.query("SELECT * FROM farm.correction_geographies($1,NULL,1)", [
        farmerId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      signed.run(raw, actor, (db) =>
        db.query("SELECT id FROM farm.geography", []),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      signed.run(raw, actor, (db) =>
        db.query("SELECT * FROM farm.correction_geographies($1,NULL,101)", [
          farmerId,
        ]),
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await owner.query(
      "UPDATE authz.permission_grant SET active=false WHERE id=$1",
      [sourceCorrectGrant],
    );
    expect(
      (await browser(`farmers/correction-geographies?id=${farmerId}`, "GET"))
        .status,
    ).toBe(403);
    await expect(
      signed.run(raw, actor, (db) =>
        db.query("SELECT * FROM farm.correction_geographies($1,NULL,1)", [
          farmerId,
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await raw.end();
    await owner.query(
      "UPDATE authz.permission_grant SET active=true WHERE id=$1",
      [sourceCorrectGrant],
    );
    for (const id of grants)
      await owner.query("DELETE FROM authz.permission_grant WHERE id=$1", [id]);
    for (const row of geographies)
      await owner.query("DELETE FROM farm.geography WHERE id=$1", [row.id]);
  }
}
