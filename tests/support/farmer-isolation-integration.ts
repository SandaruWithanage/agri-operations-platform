import { randomBytes, randomUUID } from "node:crypto";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";
import pg from "pg";
import {
  TransactionActorContext,
  type VerifiedActor,
} from "../../apps/api/src/authorization/transaction-context";
import { FarmerRegistrationService } from "../../apps/api/src/farmer/registration-service";
import { FarmerRegistryService } from "../../apps/api/src/farmer/registry-service";
import { FarmerChangeService } from "../../apps/api/src/farmer/change-service";
import { FarmerHistoryService } from "../../apps/api/src/farmer/history-service";

/**
 * Two-officer isolation matrix for farmers (UAT-02). Each officer holds their own create/read/correct/audit
 * grants and an assignment for exactly one geography. Synthetic data only; the main synthetic actor is unused.
 */
export async function verifyFarmerIsolation({
  owner,
  organizationId,
  runtimeUrl,
}: {
  owner: pg.Client;
  organizationId: string;
  runtimeUrl: string;
}) {
  const db = new pg.Client({ connectionString: runtimeUrl });
  await db.connect();
  const context = new TransactionActorContext(Buffer.alloc(32, 42));
  const registration = new FarmerRegistrationService(context),
    registry = new FarmerRegistryService(context),
    changes = new FarmerChangeService(context),
    history = new FarmerHistoryService(context);
  const id = () => randomUUID();
  const geoA = id(),
    geoB = id(),
    farmerA = id(),
    farmerB = id();
  const grants: string[] = [],
    assignments: string[] = [];
  const makeOfficer = async () => {
    const officer: VerifiedActor = { accountId: id(), sessionId: id() },
      device = id();
    await owner.query(
      "INSERT INTO authn.account(id,login_name,password_hash) VALUES($1,$2,'$argon2id$synthetic-farmer-isolation-only')",
      [officer.accountId, `synthetic-farmer-isolation-${officer.accountId}`],
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
    const assignment = id();
    assignments.push(assignment);
    await owner.query(
      "INSERT INTO authz.assignment(id,account_id,organization_id,geography_id,starts_at) VALUES($1,$2,$3,$4,now()-interval '1 hour')",
      [assignment, officer.accountId, organizationId, geography],
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
  const register = (
    officer: VerifiedActor,
    farmerId: string,
    geographyId: string,
    extra: {
      mutationId?: string;
      source?: "field_officer" | "administrator";
    } = {},
  ) =>
    registration.register(db, officer, extra.source ?? "field_officer", {
      mutationId: extra.mutationId ?? id(),
      farmer: {
        farmerId,
        geographyId,
        fullName: `Synthetic isolation ${farmerId.slice(0, 8)}`,
        privacyNoticeProvided: true,
      },
    });
  const visible = async (officer: VerifiedActor, filter = {}) =>
    (await registry.list(db, officer, filter)).items.map((row) => row.id);
  const total = async () =>
    (
      await owner.query(
        "SELECT count(*)::int AS n FROM farm.farmer WHERE geography_id=ANY($1::uuid[])",
        [[geoA, geoB]],
      )
    ).rows[0].n as number;
  try {
    for (const [geo, name] of [
      [geoA, "Synthetic farmer isolation area A"],
      [geoB, "Synthetic farmer isolation area B"],
    ])
      await owner.query(
        "INSERT INTO farm.geography(id,organization_id,name) VALUES($1,$2,$3)",
        [geo, organizationId, name],
      );
    const officerA = await makeOfficer(),
      officerB = await makeOfficer();
    await assign(officerA, geoA);
    await assign(officerB, geoB);
    await grant(officerA, "farmer.create", geoA, "field_officer");
    await grant(officerB, "farmer.create", geoB, "field_officer");

    // 1. Each officer registers only inside their own geography.
    expect(await register(officerA, farmerA, geoA)).toEqual({
      farmerId: farmerA,
      replayed: false,
    });
    expect(await register(officerB, farmerB, geoB)).toEqual({
      farmerId: farmerB,
      replayed: false,
    });

    // 2. Creating a farmer does not grant read: the creator sees nothing and a direct detail is "not available".
    expect(await visible(officerA)).toEqual([]);
    await expect(
      registry.detail(db, officerA, { id: farmerA }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // 3. Cross-geography and wrong-source creation is denied and writes nothing.
    await expect(register(officerA, id(), geoB)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(register(officerB, id(), geoA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      register(officerA, id(), geoA, { source: "administrator" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await total()).toBe(2);

    // 4. With separate read grants each officer sees exactly their own record; filters and details never leak.
    await grant(officerA, "farmer.read", geoA);
    await grant(officerB, "farmer.read", geoB);
    expect(await visible(officerA)).toEqual([farmerA]);
    expect(await visible(officerB)).toEqual([farmerB]);
    expect(await visible(officerA, { status: "pending-review" })).toEqual([
      farmerA,
    ]);
    expect(await visible(officerB, { reviewable: "true" })).toEqual([]);
    for (const [officer, other] of [
      [officerA, farmerB],
      [officerB, farmerA],
    ] as const)
      await expect(
        registry.detail(db, officer, { id: other }),
      ).rejects.toBeInstanceOf(NotFoundException);

    // 5. Direct SQL under the same signed actor sees only its own rows and cannot write.
    expect(
      (
        await context.run(db, officerB, (c) =>
          c.query("SELECT id FROM farm.farmer"),
        )
      ).rows.map((row) => row.id),
    ).toEqual([farmerB]);
    for (const statement of [
      "UPDATE farm.farmer SET full_name='Synthetic tampered'",
      "DELETE FROM farm.farmer",
    ])
      await expect(
        context.run(db, officerB, (c) => c.query(statement)),
      ).rejects.toMatchObject({ code: "42501" });

    // 5b. Private journals, audit, grant and identity tables are not readable through the runtime login at all,
    // so one officer cannot learn another's activity, mutations, permissions or account.
    for (const table of [
      "farm.registration_mutation",
      "farm.registration_risk",
      "farm.farmer_audit",
      "farm.farmer_change",
      "authz.permission_grant",
      "authz.assignment",
      "authz.context_key",
      "authn.account",
      "authn.login_session",
    ])
      await expect(
        context.run(db, officerB, (c) => c.query(`SELECT 1 FROM ${table}`)),
        table,
      ).rejects.toMatchObject({ code: "42501" });

    // 6. Corrections need the action permission on both source and destination coverage.
    await grant(officerA, "farmer.correct", geoA);
    await grant(officerB, "farmer.correct", geoB);
    const correction = (
      officer: VerifiedActor,
      farmerId: string,
      geographyId: string,
      version = 1,
    ) =>
      changes.change(db, officer, {
        mutationId: id(),
        farmerId,
        expectedVersion: version,
        action: "correction",
        fullName: "Synthetic corrected name",
        geographyId,
        reason: "Synthetic isolation correction",
      });
    await expect(correction(officerB, farmerA, geoA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(correction(officerA, farmerA, geoB)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      changes.change(db, officerB, {
        mutationId: id(),
        farmerId: farmerA,
        expectedVersion: 1,
        action: "verification",
        reason: "Synthetic cross verification",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (
        await owner.query(
          "SELECT full_name,version FROM farm.farmer WHERE id=$1",
          [farmerA],
        )
      ).rows[0].version,
    ).toBe(1);
    expect(await correction(officerA, farmerA, geoA)).toMatchObject({
      farmerId: farmerA,
      version: 2,
      replayed: false,
    });

    // 7. Audit history needs its own grant in the farmer's geography; another officer's grant never reaches it.
    await expect(
      history.history(db, officerA, { id: farmerA }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await grant(officerB, "farmer.audit.read", geoB);
    await expect(
      history.history(db, officerB, { id: farmerA }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // 8. A mutation ID belongs to its actor: reuse by another officer cannot replay or overwrite.
    const mutation = (
      await owner.query(
        "SELECT id FROM farm.registration_mutation WHERE farmer_id=$1",
        [farmerA],
      )
    ).rows[0].id as string;
    await expect(
      register(officerB, id(), geoB, { mutationId: mutation }),
    ).rejects.toThrow();
    expect(await total()).toBe(2);
    expect(
      (
        await owner.query(
          "SELECT actor_id FROM farm.registration_mutation WHERE id=$1",
          [mutation],
        )
      ).rows[0].actor_id,
    ).toBe(officerA.accountId);

    // 9. Revoking one officer's session affects only that officer.
    await owner.query(
      "UPDATE authn.login_session SET revoked_at=clock_timestamp() WHERE id=$1",
      [officerA.sessionId],
    );
    expect(await visible(officerA)).toEqual([]);
    await expect(register(officerA, id(), geoA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(await visible(officerB)).toEqual([farmerB]);

    // 10. Creator attribution is the registering officer only.
    expect(
      (
        await owner.query(
          "SELECT id,created_by FROM farm.farmer WHERE id=ANY($1::uuid[]) ORDER BY id",
          [[farmerA, farmerB]],
        )
      ).rows.every(
        (row) =>
          row.created_by ===
          (row.id === farmerA ? officerA.accountId : officerB.accountId),
      ),
    ).toBe(true);
  } finally {
    await db.end();
    await owner.query("ROLLBACK").catch(() => undefined);
    const farmers = [farmerA, farmerB];
    await owner.query(
      "DELETE FROM farm.farmer_audit WHERE farmer_id=ANY($1::uuid[])",
      [farmers],
    );
    await owner.query(
      "DELETE FROM farm.farmer_change WHERE farmer_id=ANY($1::uuid[])",
      [farmers],
    );
    await owner.query(
      "DELETE FROM farm.registration_risk WHERE mutation_id IN (SELECT id FROM farm.registration_mutation WHERE farmer_id=ANY($1::uuid[]))",
      [farmers],
    );
    await owner.query(
      "DELETE FROM farm.registration_mutation WHERE farmer_id=ANY($1::uuid[])",
      [farmers],
    );
    await owner.query("DELETE FROM farm.farmer WHERE id=ANY($1::uuid[])", [
      farmers,
    ]);
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
