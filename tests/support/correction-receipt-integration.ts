import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import pg from "pg";
import {
  TransactionActorContext,
  type VerifiedActor,
} from "../../apps/api/src/authorization/transaction-context";
export async function verifyCorrectionReceipt({
  owner,
  browser,
  accountId,
  otherAccountId,
  farmerId,
  mutationId,
  geographyId,
  hiddenGeographyId,
  actor,
  runtimeUrl,
  correctGrant,
  verifyGrant,
}: {
  owner: pg.Client;
  browser: (path: string, method: string) => Promise<Response>;
  accountId: string;
  otherAccountId: string;
  farmerId: string;
  mutationId: string;
  geographyId: string;
  hiddenGeographyId: string;
  actor: VerifiedActor;
  runtimeUrl: string;
  correctGrant: string;
  verifyGrant: string;
}) {
  if (
    new URL(runtimeUrl).pathname !== "/agri_test" ||
    (await owner.query("SELECT current_database() AS name")).rows[0].name !==
      "agri_test"
  )
    throw new Error("Disposable agri_test database required");
  const read = async () => {
    const response = await browser(
      `farmers/correction-receipt?id=${farmerId}`,
      "GET",
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  const original = await read();
  expect(original).toMatchObject({
    accountId,
    farmerId,
    receipt: { mutationId, version: 3 },
  });
  expect(original.receipt.occurredAt).toMatch(/\.\d{6}Z$/);
  expect(Object.keys(original.receipt).sort()).toEqual([
    "mutationId",
    "occurredAt",
    "version",
  ]);
  const foreignId = randomUUID();
  const historicalGrants: string[] = [];
  const raw = new pg.Client({ connectionString: runtimeUrl });
  await raw.connect();
  try {
    await owner.query(
      `INSERT INTO farm.farmer_change(id,farmer_id,actor_id,session_id,action,reason,payload_mac,previous_version,result_version,previous_name,result_name,previous_geography,result_geography,previous_status,result_status,duplicate_risk,occurred_at)
      SELECT $1,farmer_id,$2,session_id,action,reason,payload_mac,previous_version,result_version,previous_name,result_name,previous_geography,result_geography,previous_status,result_status,duplicate_risk,occurred_at+interval '1 minute' FROM farm.farmer_change WHERE id=$3`,
      [foreignId, otherAccountId, mutationId],
    );
    expect(await read()).toEqual(original);
    // Historical read/verify coverage must not substitute for correction coverage.
    for (const permission of ["farmer.read", "farmer.verify"]) {
      const grantId = randomUUID();
      historicalGrants.push(grantId);
      await owner.query(
        "INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,geography_id,starts_at) SELECT $1,$2,organization_id,$3,'organization',id,now()-interval '1 hour' FROM farm.geography WHERE id=$4",
        [grantId, accountId, permission, hiddenGeographyId],
      );
    }
    for (const column of ["previous_geography", "result_geography"] as const) {
      await owner.query(
        `UPDATE farm.farmer_change SET ${column}=$1 WHERE id=$2`,
        [hiddenGeographyId, mutationId],
      );
      expect(await read()).toEqual({ accountId, farmerId, receipt: null });
      await owner.query(
        `UPDATE farm.farmer_change SET ${column}=$1 WHERE id=$2`,
        [geographyId, mutationId],
      );
    }
    await expect(
      raw.query("SELECT * FROM farm.latest_own_correction($1)", [farmerId]),
    ).rejects.toMatchObject({ code: "42501" });
    const context = new TransactionActorContext(Buffer.alloc(32, 42));
    await expect(
      context.run(raw, actor, (db) =>
        db.query("SELECT * FROM farm.farmer_change", []),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    // Correction-only authority must work independently of verification grants.
    await owner.query(
      "UPDATE authz.permission_grant SET active=false WHERE id=$1",
      [verifyGrant],
    );
    expect(await read()).toEqual(original);
    await owner.query(
      "UPDATE authz.permission_grant SET active=true WHERE id=$1",
      [verifyGrant],
    );
    // A verifier cannot invoke the native receipt function after correction revocation.
    await owner.query(
      "UPDATE authz.permission_grant SET active=false WHERE id=$1",
      [correctGrant],
    );
    expect(
      (await browser(`farmers/correction-receipt?id=${farmerId}`, "GET"))
        .status,
    ).toBe(403);
    await expect(
      context.run(raw, actor, (db) =>
        db.query("SELECT * FROM farm.latest_own_correction($1)", [farmerId]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await owner.query(
      "UPDATE authz.permission_grant SET active=true WHERE id=$1",
      [correctGrant],
    );
    const rows = await context.run(raw, actor, (db) =>
      db.query("SELECT * FROM farm.latest_own_correction($1)", [farmerId]),
    );
    expect(rows.rows).toEqual([
      {
        mutation_id: mutationId,
        result_version: 3,
        occurred_at: original.receipt.occurredAt,
      },
    ]);
  } finally {
    await owner.query(
      "UPDATE authz.permission_grant SET active=true WHERE id=ANY($1::uuid[])",
      [[correctGrant, verifyGrant]],
    );
    for (const grantId of historicalGrants)
      await owner.query("DELETE FROM authz.permission_grant WHERE id=$1", [
        grantId,
      ]);
    await raw.end();
    await owner.query("DELETE FROM farm.farmer_change WHERE id=$1", [
      foreignId,
    ]);
    await owner.query(
      "UPDATE farm.farmer_change SET previous_geography=$1,result_geography=$1 WHERE id=$2",
      [geographyId, mutationId],
    );
  }
}
