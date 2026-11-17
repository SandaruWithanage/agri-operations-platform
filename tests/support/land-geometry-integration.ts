import { randomBytes, randomUUID } from "node:crypto";
import { expect } from "vitest";
import pg from "pg";
import {
  TransactionActorContext,
  type VerifiedActor,
} from "../../apps/api/src/authorization/transaction-context";

type Ring = unknown;
/** Native scenarios for the provisional land polygon store (P1-09a). Synthetic coordinates only. */
export async function verifyLandGeometry({
  owner,
  organizationId,
  runtimeUrl,
}: {
  owner: pg.Client;
  organizationId: string;
  runtimeUrl: string;
}) {
  const db = new pg.Client({ connectionString: runtimeUrl });
  const db2 = new pg.Client({ connectionString: runtimeUrl });
  await db.connect();
  await db2.connect();
  const context = new TransactionActorContext(Buffer.alloc(32, 42));
  const id = () => randomUUID();
  const geoA = id(),
    geoB = id(),
    landA = id(),
    landB = id();
  const grants: string[] = [],
    assignments: string[] = [];
  const makeOfficer = async () => {
    const officer: VerifiedActor = { accountId: id(), sessionId: id() },
      device = id();
    await owner.query(
      "INSERT INTO authn.account(id,login_name,password_hash) VALUES($1,$2,'$argon2id$synthetic-geometry-only')",
      [officer.accountId, `synthetic-geometry-${officer.accountId}`],
    );
    await owner.query(
      "INSERT INTO authn.device(id,account_id,state,approved_at) VALUES($1,$2,'approved',now())",
      [device, officer.accountId],
    );
    await owner.query(
      "INSERT INTO authn.login_session(id,account_id,device_id,device_required,cookie_secret_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,$3,true,$4,now()+interval '1 hour',now()+interval '1 day')",
      [officer.sessionId, officer.accountId, device, randomBytes(32)],
    );
    return officer;
  };
  const assign = async (officer: VerifiedActor, geography: string) => {
    const row = id();
    assignments.push(row);
    await owner.query(
      "INSERT INTO authz.assignment(id,account_id,organization_id,geography_id,starts_at) VALUES($1,$2,$3,$4,now()-interval '1 hour')",
      [row, officer.accountId, organizationId, geography],
    );
  };
  const grant = async (
    officer: VerifiedActor,
    permission: string,
    geography: string,
    source: string | null = null,
  ) => {
    const row = id();
    grants.push(row);
    await owner.query(
      "INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,geography_id,registration_source,starts_at) VALUES($1,$2,$3,$4,'assigned',$5,$6,now()-interval '1 hour')",
      [row, officer.accountId, organizationId, permission, geography, source],
    );
  };
  // A ~110 m square near 8.3 N, 80.2 E (counter-clockwise) and the same square clockwise.
  const square: Ring = [
    [80.2, 8.3],
    [80.201, 8.3],
    [80.201, 8.301],
    [80.2, 8.301],
    [80.2, 8.3],
  ];
  const clockwise: Ring = [
    [80.2, 8.3],
    [80.2, 8.301],
    [80.201, 8.301],
    [80.201, 8.3],
    [80.2, 8.3],
  ];
  const record = (
    officer: VerifiedActor,
    land: string,
    expected: number,
    ring: Ring,
    extra: {
      mutation?: string;
      source?: string;
      accuracy?: number | null;
      registration?: string;
      client?: pg.Client;
    } = {},
  ) =>
    context.run(extra.client ?? db, officer, (c) =>
      c.query(
        "SELECT * FROM land.record_geometry($1,$2,$3,$4::jsonb,$5,$6,NULL,$7)",
        [
          extra.mutation ?? id(),
          land,
          expected,
          JSON.stringify(ring),
          extra.source ?? "gps_walk",
          extra.accuracy === undefined ? 5 : extra.accuracy,
          extra.registration ?? "field_officer",
        ],
      ),
    );
  const versionsSeenBy = async (officer: VerifiedActor) =>
    (
      await context.run(db, officer, (c) =>
        c.query(
          "SELECT land_id,version,status FROM land.geometry_version ORDER BY land_id,version",
        ),
      )
    ).rows.map((row) => `${row.land_id}:${row.version}:${row.status}`);
  const count = async (table: string, land: string) =>
    (
      await owner.query(
        `SELECT count(*)::int AS n FROM land.${table} WHERE land_id=$1`,
        [land],
      )
    ).rows[0].n as number;
  try {
    for (const [geo, name] of [
      [geoA, "Synthetic geometry area A"],
      [geoB, "Synthetic geometry area B"],
    ])
      await owner.query(
        "INSERT INTO farm.geography(id,organization_id,name) VALUES($1,$2,$3)",
        [geo, organizationId, name],
      );
    const officerA = await makeOfficer(),
      officerB = await makeOfficer();
    for (const [land, geo] of [
      [landA, geoA],
      [landB, geoB],
    ])
      await owner.query(
        "INSERT INTO land.identification(id,organization_id,geography_id,registration_source,created_by) VALUES($1,$2,$3,'administrator',$4)",
        [land, organizationId, geo, officerA.accountId],
      );
    await assign(officerA, geoA);
    await assign(officerB, geoB);

    // 1. Nothing is granted: the land is invisible, so nothing can be recorded or read.
    await expect(record(officerA, landA, 0, square)).rejects.toMatchObject({
      code: "42501",
    });
    expect(await versionsSeenBy(officerA)).toEqual([]);

    // 2. land.read alone does not allow recording; land.geometry.create alone cannot see the land.
    await grant(officerA, "land.read", geoA);
    await grant(officerB, "land.read", geoB);
    await expect(record(officerA, landA, 0, square)).rejects.toMatchObject({
      code: "42501",
    });
    await grant(officerA, "land.geometry.create", geoA, "field_officer");
    await grant(officerB, "land.geometry.create", geoB, "field_officer");

    // 3. A records a counter-clockwise polygon; the geodesic area matches an independent recomputation.
    const first = await record(officerA, landA, 0, clockwise);
    expect(first.rows[0]).toMatchObject({
      out_land: landA,
      out_version: 1,
      out_replayed: false,
    });
    const expectedArea = (
      await owner.query(
        "SELECT round(public.ST_Area(public.ST_GeomFromText('POLYGON((80.2 8.3,80.201 8.3,80.201 8.301,80.2 8.301,80.2 8.3))',4326)::public.geography)::numeric,2) AS area",
      )
    ).rows[0].area;
    expect(first.rows[0].out_area).toBe(expectedArea);
    expect(Number(expectedArea)).toBeGreaterThan(12000);
    expect(Number(expectedArea)).toBeLessThan(12400);
    // Stored orientation is normalized to counter-clockwise without changing any coordinate.
    expect(
      (
        await owner.query(
          "SELECT public.ST_IsPolygonCCW(boundary) AS ccw,vertex_count FROM land.geometry_version WHERE land_id=$1",
          [landA],
        )
      ).rows[0],
    ).toEqual({ ccw: true, vertex_count: 5 });

    // 4. Exact replay is idempotent; a changed payload under the same mutation ID conflicts.
    const mutation = (
      await owner.query(
        "SELECT id FROM land.geometry_mutation WHERE land_id=$1",
        [landA],
      )
    ).rows[0].id as string;
    const replay = await record(officerA, landA, 0, clockwise, { mutation });
    expect(replay.rows[0]).toMatchObject({
      out_version: 1,
      out_replayed: true,
    });
    expect(await count("geometry_version", landA)).toBe(1);
    expect(await count("geometry_audit", landA)).toBe(1);
    await expect(
      record(officerA, landA, 0, square, { mutation }),
    ).rejects.toMatchObject({ code: "23505" });

    // 5. Invalid geometry never becomes a version (the caller is authorized, so the shape error is reported).
    const many = Array.from({ length: 5001 }, (_, k) => [
      80 + k * 1e-6,
      8 + (k % 2) * 1e-6,
    ]);
    many.push(many[0]);
    const invalid: Array<[string, Ring]> = [
      [
        "bowtie",
        [
          [80, 8],
          [80.001, 8.001],
          [80.001, 8],
          [80, 8.001],
          [80, 8],
        ],
      ],
      [
        "unclosed",
        [
          [80.2, 8.3],
          [80.201, 8.3],
          [80.201, 8.301],
          [80.2, 8.301],
        ],
      ],
      [
        "three points",
        [
          [80.2, 8.3],
          [80.201, 8.3],
          [80.2, 8.3],
        ],
      ],
      [
        "collinear zero area",
        [
          [80, 8],
          [80.1, 8],
          [80.2, 8],
          [80, 8],
        ],
      ],
      [
        "identical points",
        [
          [80, 8],
          [80, 8],
          [80, 8],
          [80, 8],
        ],
      ],
      [
        "latitude out of range",
        [
          [80, 91],
          [81, 91],
          [81, 90],
          [80, 91],
        ],
      ],
      [
        "longitude out of range",
        [
          [181, 8],
          [182, 8],
          [182, 9],
          [181, 8],
        ],
      ],
      [
        "string coordinate",
        [
          ["80", 8],
          [81, 8],
          [81, 9],
          ["80", 8],
        ],
      ],
      [
        "three-element point",
        [
          [80, 8, 1],
          [81, 8, 1],
          [81, 9, 1],
          [80, 8, 1],
        ],
      ],
      [
        "null coordinate",
        [
          [null, 8],
          [81, 8],
          [81, 9],
          [null, 8],
        ],
      ],
      ["object not array", { type: "Polygon" }],
      [
        "overflowing number",
        [
          [Infinity, 8],
          [81, 8],
          [81, 9],
          [Infinity, 8],
        ],
      ],
      ["more than 5000 vertices", many],
      [
        "absurdly large area",
        [
          [0, 0],
          [60, 0],
          [60, 60],
          [0, 60],
          [0, 0],
        ],
      ],
    ];
    for (const [label, ring] of invalid)
      await expect(
        record(officerA, landA, 1, ring),
        label,
      ).rejects.toMatchObject({ code: "22023" });
    await expect(
      record(officerA, landA, 1, square, { accuracy: -1 }),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      record(officerA, landA, 1, square, { source: "satellite" }),
    ).rejects.toMatchObject({ code: "22023" });
    expect(await count("geometry_version", landA)).toBe(1);
    // An outsider learns nothing from shape errors: another officer's land is simply denied.
    await expect(record(officerB, landA, 1, [[1, 1]])).rejects.toMatchObject({
      code: "42501",
    });

    // 6. Optimistic versioning: stale and future expectations conflict; a new version supersedes the old one.
    for (const expected of [0, 2, 5])
      await expect(
        record(officerA, landA, expected, square),
      ).rejects.toMatchObject({ code: "40001" });
    const second = await record(officerA, landA, 1, square, {
      source: "digitized",
    });
    expect(second.rows[0]).toMatchObject({
      out_version: 2,
      out_replayed: false,
    });
    expect(
      (
        await owner.query(
          "SELECT version,status FROM land.geometry_version WHERE land_id=$1 ORDER BY version",
          [landA],
        )
      ).rows,
    ).toEqual([
      { version: 1, status: "superseded" },
      { version: 2, status: "provisional" },
    ]);
    // Two concurrent writers with the same expectation: exactly one wins, the other conflicts.
    const settled = await Promise.allSettled([
      record(officerA, landA, 2, square, { client: db }),
      record(officerA, landA, 2, clockwise, { client: db2 }),
    ]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = settled.find((r) => r.status === "rejected") as
      PromiseRejectedResult | undefined;
    expect(lost?.reason).toMatchObject({ code: "40001" });
    expect(await count("geometry_version", landA)).toBe(3);
    expect(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM land.geometry_version WHERE land_id=$1 AND status='provisional'",
          [landA],
        )
      ).rows[0].n,
    ).toBe(1);

    // 7. Source and scope: the grant's source must match, and another officer's land is out of scope.
    await expect(
      record(officerA, landA, 3, square, { registration: "administrator" }),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(record(officerB, landA, 3, square)).rejects.toMatchObject({
      code: "42501",
    });
    expect((await record(officerB, landB, 0, square)).rows[0].out_version).toBe(
      1,
    );

    // 8. Creating geometry does not grant reading it; reading needs land.geometry.read AND land.read.
    expect(await versionsSeenBy(officerA)).toEqual([]);
    await grant(officerA, "land.geometry.read", geoA);
    await grant(officerB, "land.geometry.read", geoB);
    expect(await versionsSeenBy(officerA)).toEqual([
      `${landA}:1:superseded`,
      `${landA}:2:superseded`,
      `${landA}:3:provisional`,
    ]);
    expect(await versionsSeenBy(officerB)).toEqual([`${landB}:1:provisional`]);
    const geojson = await context.run(db, officerA, (c) =>
      c.query(
        "SELECT public.ST_AsGeoJSON(boundary)::jsonb->>'type' AS type FROM land.geometry_version WHERE land_id=$1 AND version=3",
        [landA],
      ),
    );
    expect(geojson.rows[0].type).toBe("Polygon");

    // 9. Runtime logins cannot write geometry or read the private journal and audit directly.
    for (const statement of [
      "UPDATE land.geometry_version SET status='provisional'",
      "DELETE FROM land.geometry_version",
      "INSERT INTO land.geometry_version(land_id,geography_id,version,boundary,source,status,vertex_count,calculated_area_m2,registration_source) VALUES(gen_random_uuid(),gen_random_uuid(),1,public.ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 0))',4326),'gps_walk','provisional',4,1,'administrator')",
      "SELECT 1 FROM land.geometry_mutation",
      "SELECT 1 FROM land.geometry_audit",
    ])
      await expect(
        context.run(db, officerB, (c) => c.query(statement)),
        statement,
      ).rejects.toMatchObject({ code: "42501" });

    // 10. Table-level integrity holds even for the database owner: immutable rows, valid geometry, same geography.
    await expect(
      owner.query(
        "UPDATE land.geometry_version SET boundary=public.ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 0))',4326) WHERE land_id=$1 AND version=3",
        [landA],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      owner.query(
        "UPDATE land.geometry_version SET status='provisional' WHERE land_id=$1 AND version=1",
        [landA],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      owner.query(
        "INSERT INTO land.geometry_version(land_id,geography_id,version,boundary,source,status,vertex_count,calculated_area_m2,registration_source,created_by) VALUES($1,$2,9,public.ST_GeomFromText('POLYGON((0 0,1 1,1 0,0 1,0 0))',4326),'gps_walk','provisional',5,1,'administrator',$3)",
        [landA, geoA, officerA.accountId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      owner.query(
        "INSERT INTO land.geometry_version(land_id,geography_id,version,boundary,source,status,vertex_count,calculated_area_m2,registration_source,created_by) VALUES($1,$2,9,public.ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 0))',4326),'gps_walk','superseded',4,1,'administrator',$3)",
        [landA, geoB, officerA.accountId],
      ),
    ).rejects.toMatchObject({ code: "23503" });

    // 11. Revoking one officer's session affects only that officer.
    await owner.query(
      "UPDATE authn.login_session SET revoked_at=clock_timestamp() WHERE id=$1",
      [officerA.sessionId],
    );
    expect(await versionsSeenBy(officerA)).toEqual([]);
    await expect(record(officerA, landA, 3, square)).rejects.toMatchObject({
      code: "42501",
    });
    expect(await versionsSeenBy(officerB)).toEqual([`${landB}:1:provisional`]);

    // 12. Audit attributes each recorded version to its own officer, one row per version.
    expect(await count("geometry_audit", landA)).toBe(3);
    expect(
      (
        await owner.query(
          "SELECT DISTINCT actor_id FROM land.geometry_audit WHERE land_id=$1",
          [landA],
        )
      ).rows.map((row) => row.actor_id),
    ).toEqual([officerA.accountId]);
    expect(
      (
        await owner.query(
          "SELECT actor_id FROM land.geometry_audit WHERE land_id=$1",
          [landB],
        )
      ).rows.map((row) => row.actor_id),
    ).toEqual([officerB.accountId]);
  } finally {
    await db.end();
    await db2.end();
    await owner.query("ROLLBACK").catch(() => undefined);
    const lands = [landA, landB];
    await owner.query(
      "DELETE FROM land.geometry_audit WHERE land_id=ANY($1::uuid[])",
      [lands],
    );
    await owner.query(
      "DELETE FROM land.geometry_mutation WHERE land_id=ANY($1::uuid[])",
      [lands],
    );
    await owner.query(
      "ALTER TABLE land.geometry_version DISABLE TRIGGER geometry_transition_guard",
    );
    await owner.query(
      "DELETE FROM land.geometry_version WHERE land_id=ANY($1::uuid[])",
      [lands],
    );
    await owner.query(
      "ALTER TABLE land.geometry_version ENABLE TRIGGER geometry_transition_guard",
    );
    await owner.query(
      "DELETE FROM land.identification WHERE id=ANY($1::uuid[])",
      [lands],
    );
    await owner.query(
      "DELETE FROM authz.permission_grant WHERE id=ANY($1::uuid[])",
      [grants],
    );
    await owner.query("DELETE FROM authz.assignment WHERE id=ANY($1::uuid[])", [
      assignments,
    ]);
    await owner.query("DELETE FROM farm.geography WHERE id=ANY($1::uuid[])", [
      [geoA, geoB],
    ]);
  }
}
