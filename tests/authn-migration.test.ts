import { verifyProjectCatalog } from "./support/project-integration";
import { ReadinessController } from "../apps/api/src/readiness.controller";
import { verifyCorrectionReceipt } from "./support/correction-receipt-integration";
import { verifyLandIdentification } from "./support/land-integration";
// @vitest-environment node
import "fake-indexeddb/auto";
import { verifyCorrectionOptions } from "./support/correction-options-integration";
import { RegistrationOutbox, vaultName } from "../packages/sync-client/src";
import { PilotClient } from "../apps/field-pwa/lib/pilot-client";
import { readFileSync } from "node:fs";
import { createHmac, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { PostgresSessionReader } from "../apps/api/src/authentication/postgres-session-reader";
import { SessionAccess } from "../apps/api/src/authentication/session-access";
import { TransactionActorContext } from "../apps/api/src/authorization/transaction-context";
import { createPilotRuntime } from "../apps/api/src/pilot/runtime";
import { NestFactory } from "@nestjs/core";
import { PilotController } from "../apps/api/src/pilot/pilot.controller";
import { PILOT_RUNTIME } from "../apps/api/src/pilot/contracts";
import { createBffHandler } from "../packages/auth-bff/src";
import { FarmerRegistrationService } from "../apps/api/src/farmer/registration-service";
import { PostgresSessionOperations } from "../apps/api/src/authentication/postgres-session-operations";
import { PostgresSessionIssuer } from "../apps/api/src/authentication/postgres-session-issuer";
import { digestSessionSecret } from "../apps/api/src/authentication/session-cookie";
import { PostgresMfaVerifier } from "../apps/api/src/authentication/postgres-mfa-verifier";
import { encryptMfaSecret } from "../apps/api/src/authentication/mfa-secret";
import { PostgresCredentialReader } from "../apps/api/src/authentication/postgres-credential-reader";
import { LoginCoordinator } from "../apps/api/src/authentication/login-coordinator";
import { PostgresLoginLimiter } from "../apps/api/src/authentication/postgres-login-limiter";
import {
  hashPassword,
  verifyPassword,
} from "../apps/api/src/authentication/passwords";

import {
  DeviceProofs,
  deviceSignatureText,
} from "../apps/api/src/authentication/device-proof";
import {
  enrollDevice,
  revokeDevice,
  assertProvisioner,
} from "../scripts/device-enrollment.mjs";
import { createHash } from "node:crypto";
const devicePair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const deviceJwk = devicePair.publicKey.export({ format: "jwk" });
const keyId = "16b1bd24-775a-4da4-8bc0-f0376bd0fd22";
const proofId = "159802f9-fcdd-4a4f-8337-cb2445c13213";
const proofId2 = "6a602c36-47b6-493d-8ede-20b89f94c4e5";
const origin = "https://field.example.test";
const challengeKey = Buffer.alloc(32, 7);
function signedProof(service: DeviceProofs) {
  const challenge = service.issue("synthetic-a", device, origin);
  return {
    ...challenge,
    signature: sign(
      "sha256",
      Buffer.from(
        deviceSignatureText(origin, "synthetic-a", device, challenge),
      ),
      { key: devicePair.privateKey, dsaEncoding: "ieee-p1363" },
    ).toString("base64url"),
  };
}
const url = process.env.DATABASE_TEST_URL;
const suite = url ? describe : describe.skip;
const account = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const another = "334c8b84-4815-4e92-8103-237a15130f88";
const device = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const session = "11b492ca-bcb4-4662-91d9-88789a80a0c2";
let client: pg.Client;
let committedForConcurrency = false;
let projectUpgrade: {
  before: unknown;
  after: unknown;
  version: number;
  change: unknown;
} | null = null;
let upgradeResult: { revoked: boolean; audit: number } | null = null;
let historyUpgradeResult: {
  before: unknown;
  after: unknown;
  indexed: boolean;
} | null = null;

suite("provisional authentication migration on PostgreSQL", () => {
  beforeAll(async () => {
    if (!url || new URL(url).pathname !== "/agri_test")
      throw new Error("Requires dedicated agri_test database");
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query("BEGIN");
    const present = await client.query(
      "SELECT to_regnamespace('authn') AS namespace",
    );
    if (present.rows[0].namespace !== null)
      throw new Error(
        "Refusing to run against a database with an authn schema",
      );
    await client.query(
      readFileSync(
        "database/migrations/20261115_authn_foundation/up.sql",
        "utf8",
      ),
    );
    await client.query(
      readFileSync(
        "database/migrations/20261115_authn_foundation/session-reader-grants.sql",
        "utf8",
      ),
    );
    await client.query(
      readFileSync(
        "database/migrations/20261115_session_operations/up.sql",
        "utf8",
      ),
    );
    await client.query(
      readFileSync(
        "database/migrations/20261115_totp_foundation/up.sql",
        "utf8",
      ),
    );
    await client.query(
      readFileSync(
        "database/migrations/20261115_z_session_issuance/up.sql",
        "utf8",
      ),
    );
    await client.query(
      readFileSync(
        "database/migrations/20261115_zz_credential_lookup/up.sql",
        "utf8",
      ),
    );
    await client.query(
      readFileSync(
        "database/migrations/20261115_zzz_login_throttle/up.sql",
        "utf8",
      ),
    );
    await client.query(
      readFileSync(
        "database/migrations/20261115_zzzz_farmer_abac/up.sql",
        "utf8",
      ),
    );
    await client.query(
      readFileSync(
        "database/migrations/20261115_zzzzz_registration_reference/up.sql",
        "utf8",
      ),
    );
    const legacyAccount = randomUUID();
    const legacyDevice = randomUUID();
    const legacySession = randomUUID();
    await client.query(
      "INSERT INTO authn.account(id,login_name,password_hash) VALUES($1,'synthetic-upgrade','$argon2id$synthetic')",
      [legacyAccount],
    );
    await client.query(
      "INSERT INTO authn.device(id,account_id,state,approved_at) VALUES($1,$2,'approved',now())",
      [legacyDevice, legacyAccount],
    );
    await client.query(
      "INSERT INTO authn.login_session(id,account_id,device_id,device_required,cookie_secret_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,$3,true,$4,now()+interval '1 hour',now()+interval '2 hours')",
      [legacySession, legacyAccount, legacyDevice, Buffer.alloc(32, 60)],
    );
    await client.query(
      readFileSync(
        "database/migrations/20261115_zzzzzz_device_proof/up.sql",
        "utf8",
      ),
    );
    await client.query(
      readFileSync(
        "database/migrations/20261115_zzzzzzz_farmer_registry/up.sql",
        "utf8",
      ),
    );
    await client.query(
      readFileSync(
        "database/migrations/20261115_zzzzzzzz_farmer_review/up.sql",
        "utf8",
      ),
    );
    const upgradeOrg = randomUUID(),
      upgradeGeo = randomUUID(),
      upgradeFarmer = randomUUID();
    await client.query(
      "INSERT INTO farm.organization(id,name) VALUES($1,'Synthetic history upgrade organization')",
      [upgradeOrg],
    );
    await client.query(
      "INSERT INTO farm.geography(id,organization_id,name) VALUES($1,$2,'Synthetic history upgrade village')",
      [upgradeGeo, upgradeOrg],
    );
    await client.query(
      "INSERT INTO farm.farmer(id,geography_id,full_name,privacy_notice_provided,registration_source,created_by) VALUES($1,$2,'Synthetic pre-history farmer',true,'administrator',$3)",
      [upgradeFarmer, upgradeGeo, legacyAccount],
    );
    const inspectUpgrade = async () => ({
      farmer: (
        await client.query(
          "SELECT id,full_name,geography_id,status,created_by,created_at::text,version FROM farm.farmer WHERE id=$1",
          [upgradeFarmer],
        )
      ).rows[0],
      audit: (
        await client.query(
          "SELECT id,farmer_id,actor_id,action,occurred_at::text FROM farm.farmer_audit WHERE farmer_id=$1",
          [upgradeFarmer],
        )
      ).rows,
    });
    const beforeHistory = await inspectUpgrade();
    await client.query(
      readFileSync(
        "database/migrations/20261115_zzzzzzzzz_farmer_audit/up.sql",
        "utf8",
      ),
    );
    historyUpgradeResult = {
      before: beforeHistory,
      after: await inspectUpgrade(),
      indexed: (
        await client.query(
          "SELECT to_regclass('farm.farmer_audit_timeline_idx') IS NOT NULL AS present",
        )
      ).rows[0].present,
    };
    await client.query(
      readFileSync(
        "database/migrations/20261115_zzzzzzzzzz_land_identification/up.sql",
        "utf8",
      ),
    );
    await client.query(
      readFileSync(
        "database/migrations/20261115_zzzzzzzzzzz_verification_receipt/up.sql",
        "utf8",
      ),
    );
    await client.query(
      readFileSync(
        "database/migrations/20261115_zzzzzzzzzzzz_farmer_review_queue/up.sql",
        "utf8",
      ),
    );
    await client.query(
      readFileSync(
        "database/migrations/20261115_zzzzzzzzzzzzz_correction_geographies/up.sql",
        "utf8",
      ),
    );
    await client.query(
      readFileSync(
        "database/migrations/20261116_farmer_correction_receipt/up.sql",
        "utf8",
      ),
    );
    await client.query(
      readFileSync(
        "database/migrations/20261116_project_catalog/up.sql",
        "utf8",
      ),
    );
    const upgradeProject = randomUUID();
    await client.query(
      "INSERT INTO operations.project(id,organization_id,name,created_by) VALUES($1,$2,'Synthetic pre-edit project',$3)",
      [upgradeProject, upgradeOrg, legacyAccount],
    );
    await client.query(
      "INSERT INTO operations.audit(project_id,actor_id,session_id,action) VALUES($1,$2,$3,'project.create')",
      [upgradeProject, legacyAccount, legacySession],
    );
    const snapshot = async () => ({
      project: (
        await client.query("SELECT * FROM operations.project WHERE id=$1", [
          upgradeProject,
        ])
      ).rows,
      audit: (
        await client.query(
          "SELECT id,project_id,actor_id,session_id,action,occurred_at FROM operations.audit WHERE project_id=$1",
          [upgradeProject],
        )
      ).rows,
    });
    const projectBefore = await snapshot();
    await client.query(
      readFileSync(
        "database/migrations/20261116_project_lifecycle/up.sql",
        "utf8",
      ),
    );

    const upgradeAudit = (
      await client.query(
        "SELECT record_version,change_id FROM operations.audit WHERE project_id=$1",
        [upgradeProject],
      )
    ).rows[0];
    projectUpgrade = {
      before: projectBefore,
      after: await snapshot(),
      version: upgradeAudit.record_version,
      change: upgradeAudit.change_id,
    };
    await client.query("DELETE FROM operations.audit WHERE project_id=$1", [
      upgradeProject,
    ]);
    await client.query("DELETE FROM operations.project WHERE id=$1", [
      upgradeProject,
    ]);
    expect(await inspectUpgrade()).toEqual(historyUpgradeResult.after);
    await client.query("DELETE FROM farm.farmer_audit WHERE farmer_id=$1", [
      upgradeFarmer,
    ]);
    await client.query("DELETE FROM farm.farmer WHERE id=$1", [upgradeFarmer]);
    await client.query("DELETE FROM farm.geography WHERE id=$1", [upgradeGeo]);
    await client.query("DELETE FROM farm.organization WHERE id=$1", [
      upgradeOrg,
    ]);
    upgradeResult = (
      await client.query(
        "SELECT revoked_at IS NOT NULL AS revoked,(SELECT count(*)::int FROM authn.revocation_event WHERE session_id=$1) AS audit FROM authn.login_session WHERE id=$1",
        [legacySession],
      )
    ).rows[0];
    await client.query(
      "DELETE FROM authn.revocation_event WHERE session_id=$1",
      [legacySession],
    );
    await client.query("DELETE FROM authn.login_session WHERE id=$1", [
      legacySession,
    ]);
    await client.query("DELETE FROM authn.device WHERE id=$1", [legacyDevice]);
    await client.query("DELETE FROM authn.account WHERE id=$1", [
      legacyAccount,
    ]);
    await client.query(
      "INSERT INTO authn.account (id, login_name, password_hash) VALUES ($1, 'synthetic-a', '$argon2id$test'), ($2, 'synthetic-b', '$argon2id$test')",
      [account, another],
    );
    await client.query(
      "INSERT INTO authn.device (id, account_id, state, approved_at) VALUES ($1, $2, 'approved', now())",
      [device, account],
    );
    await client.query(
      "INSERT INTO authn.device_key(id,device_id,account_id,public_jwk) VALUES($1,$2,$3,$4)",
      [keyId, device, account, deviceJwk],
    );
    await client.query(
      "INSERT INTO authn.device_assertion(id,account_id,device_id,key_id,challenge_hash,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '25 seconds'),($6,$2,$3,$4,$7,clock_timestamp()+interval '25 seconds')",
      [
        proofId,
        account,
        device,
        keyId,
        Buffer.alloc(32, 28),
        proofId2,
        Buffer.alloc(32, 29),
      ],
    );
  });
  beforeEach(async () => {
    if (client)
      await client.query(
        "UPDATE authn.device_assertion SET created_at=clock_timestamp(),expires_at=clock_timestamp()+interval '25 seconds' WHERE id=ANY($1::uuid[]) AND used_at IS NULL",
        [[proofId, proofId2]],
      );
  });
  afterAll(async () => {
    if (client) {
      if (committedForConcurrency) {
        await client.query("ROLLBACK");
        await client.query(
          "DROP SCHEMA operations, land, farm, authz, authz_crypto, authn CASCADE",
        );
        await client.query(
          "DROP OWNED BY agri_project_function_owner,agri_project_runtime,agri_land_function_owner,agri_land_runtime",
        );
        await client.query(
          "DROP ROLE IF EXISTS agri_test_untrusted, agri_session_reader, agri_session_executor, agri_mfa_verifier, agri_session_issuer, agri_credential_reader, agri_login_throttle, agri_farmer_runtime, agri_policy_owner, agri_authn_function_owner, agri_test_login_0, agri_test_login_1, agri_test_login_2, agri_test_login_3, agri_test_login_4, agri_test_login_5, agri_test_login_6, agri_test_login_7, agri_device_verifier, agri_device_provisioner, agri_land_function_owner, agri_land_runtime, agri_test_login_8, agri_project_function_owner, agri_project_runtime, agri_test_login_9",
        );
      } else await client.query("ROLLBACK");
      await client.end();
    }
  });
  async function expectDenied(
    query: string,
    params: unknown[] = [],
    code = "23514",
  ) {
    await client.query("SAVEPOINT invalid_write");
    try {
      await expect(client.query(query, params)).rejects.toMatchObject({ code });
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT invalid_write");
    }
  }
  it("revokes and audits pre-proof sessions during the device-proof migration", () => {
    expect(upgradeResult).toEqual({ revoked: true, audit: 1 });
  });
  it("adds the history migration without changing existing farmer or registration audit values", () => {
    expect(historyUpgradeResult).not.toBeNull();
    expect(historyUpgradeResult!.after).toEqual(historyUpgradeResult!.before);
    expect(historyUpgradeResult!.indexed).toBe(true);
  });
  it("adds project editing without changing existing creation records or audit timestamps", () => {
    expect(projectUpgrade).not.toBeNull();
    expect(projectUpgrade!.after).toEqual(projectUpgrade!.before);
    expect(projectUpgrade!.version).toBe(1);
    expect(projectUpgrade!.change).toBeNull();
  });
  it("stores an opaque cookie digest with a bounded session and device ownership", async () => {
    await client.query(
      "INSERT INTO authn.login_session (id, account_id, device_id, cookie_secret_hash, idle_expires_at, absolute_expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 hour',now()+interval '1 day')",
      [session, account, device, Buffer.alloc(32, 9)],
    );
    const result = await client.query(
      "SELECT octet_length(cookie_secret_hash) AS size FROM authn.login_session WHERE id=$1",
      [session],
    );
    expect(result.rows[0].size).toBe(32);
    await expectDenied(
      "INSERT INTO authn.login_session (id, account_id, device_id, cookie_secret_hash, idle_expires_at, absolute_expires_at) VALUES (gen_random_uuid(),$1,$2,$3,now()+interval '1 hour',now()+interval '1 day')",
      [another, device, Buffer.alloc(32, 8)],
      "23503",
    );
  });
  it("rejects invalid password hash prefixes, devices, session lifetime and short cookie digests", async () => {
    await expectDenied(
      "INSERT INTO authn.account (id,login_name,password_hash) VALUES (gen_random_uuid(),'bad','plain')",
    );
    await expectDenied(
      "INSERT INTO authn.device (id,account_id,state) VALUES (gen_random_uuid(),$1,'approved')",
      [account],
    );
    await expectDenied(
      "INSERT INTO authn.login_session (id,account_id,cookie_secret_hash,idle_expires_at,absolute_expires_at) VALUES (gen_random_uuid(),$1,$2,now()+interval '2 days',now()+interval '1 day')",
      [account, Buffer.alloc(32, 7)],
    );
    await expectDenied(
      "INSERT INTO authn.login_session (id,account_id,cookie_secret_hash,idle_expires_at,absolute_expires_at) VALUES (gen_random_uuid(),$1,$2,now()+interval '1 hour',now()+interval '1 day')",
      [account, Buffer.alloc(2)],
    );
  });
  it("prevents PUBLIC from reading identity and session data", async () => {
    await client.query("CREATE ROLE agri_test_untrusted NOLOGIN");
    await client.query("SAVEPOINT access_check");
    try {
      await client.query("SET LOCAL ROLE agri_test_untrusted");
      await expect(
        client.query("SELECT * FROM authn.account"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT access_check");
    }
  });
  it("reads current session state with the restricted role but cannot read credentials or write", async () => {
    await client.query(
      "UPDATE authn.login_session SET device_required = true WHERE id = $1",
      [session],
    );
    await client.query("SAVEPOINT reader_check");
    try {
      await client.query("SET LOCAL ROLE agri_session_reader");
      const reader = new PostgresSessionReader(client);
      const access = new SessionAccess(
        {
          verify: async () => ({
            issuer: "synthetic",
            subject: account,
            sessionId: session,
          }),
        },
        reader,
      );
      expect(await access.authenticate("synthetic-token")).toEqual({
        accountId: account,
        sessionId: session,
      });
      await expectDenied(
        "SELECT password_hash FROM authn.account",
        [],
        "42501",
      );
      await expectDenied(
        "SELECT cookie_secret_hash FROM authn.login_session",
        [],
        "42501",
      );
      await expectDenied(
        "UPDATE authn.account SET active = false",
        [],
        "42501",
      );
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT reader_check");
    }
  });
  it("denies a session after database session, account or device revocation", async () => {
    await client.query(
      "UPDATE authn.login_session SET device_required = true WHERE id = $1",
      [session],
    );
    for (const statement of [
      "UPDATE authn.login_session SET revoked_at = now() WHERE id = '11b492ca-bcb4-4662-91d9-88789a80a0c2'",
      "UPDATE authn.account SET active = false, disabled_at = now() WHERE id = 'a50456eb-af66-41f0-8c38-0bc827249cd2'",
      "UPDATE authn.device SET state = 'revoked', revoked_at = now() WHERE id = '38f0dbdd-85db-4c75-bced-066e8ea54b86'",
    ]) {
      await client.query("SAVEPOINT revoke_check");
      try {
        await client.query(statement);
        await client.query("SET LOCAL ROLE agri_session_reader");
        const reader = new PostgresSessionReader(client);
        const access = new SessionAccess(
          {
            verify: async () => ({
              issuer: "synthetic",
              subject: account,
              sessionId: session,
            }),
          },
          reader,
        );
        await expect(access.authenticate("synthetic-token")).rejects.toThrow(
          "Unauthorized",
        );
      } finally {
        await client.query("ROLLBACK TO SAVEPOINT revoke_check");
      }
    }
  });
  it("restricts session operations to the function role and validates opaque cookie digests", async () => {
    await client.query("SAVEPOINT operations_check");
    try {
      await client.query("SET LOCAL ROLE agri_test_untrusted");
      await expectDenied(
        "SELECT * FROM authn.use_session($1, 60)",
        [Buffer.alloc(32, 9)],
        "42501",
      );
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT operations_check");
    }
    await client.query("SAVEPOINT executor_check");
    try {
      await client.query(
        "SET LOCAL SESSION AUTHORIZATION agri_session_executor",
      );
      await expectDenied("SELECT * FROM authn.login_session", [], "42501");
      await expectDenied("SET ROLE agri_authn_function_owner", [], "42501");
      const valid = await client.query(
        "SELECT * FROM authn.use_session($1, 60)",
        [Buffer.alloc(32, 9)],
      );
      expect(valid.rows).toEqual([
        { session_id: session, account_id: account },
      ]);
      expect(
        (
          await client.query("SELECT * FROM authn.use_session($1, 60)", [
            Buffer.alloc(32, 1),
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await client.query("SELECT * FROM authn.use_session($1, 0)", [
            Buffer.alloc(32, 9),
          ])
        ).rowCount,
      ).toBe(0);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT executor_check");
    }
  });
  it("denies cookie use when the account or device is revoked or the session is expired", async () => {
    for (const statement of [
      "UPDATE authn.account SET active = false, disabled_at = now() WHERE id = 'a50456eb-af66-41f0-8c38-0bc827249cd2'",
      "UPDATE authn.device SET state = 'revoked', revoked_at = now() WHERE id = '38f0dbdd-85db-4c75-bced-066e8ea54b86'",
      "UPDATE authn.login_session SET created_at = now() - interval '2 hours', idle_expires_at = now() - interval '1 hour' WHERE id = '11b492ca-bcb4-4662-91d9-88789a80a0c2'",
    ]) {
      await client.query("SAVEPOINT cookie_revoke_check");
      try {
        await client.query(statement);
        await client.query("SET LOCAL ROLE agri_session_executor");
        expect(
          (
            await client.query("SELECT * FROM authn.use_session($1, 60)", [
              Buffer.alloc(32, 9),
            ])
          ).rowCount,
        ).toBe(0);
      } finally {
        await client.query("ROLLBACK TO SAVEPOINT cookie_revoke_check");
      }
    }
  });
  it("logs out atomically with exactly one audit event and rejects subsequent use", async () => {
    await client.query("SAVEPOINT logout_check");
    try {
      await client.query("SET LOCAL ROLE agri_session_executor");
      const event = "53004ba7-621a-4a84-952a-132d74e89baa";
      expect(
        (
          await client.query("SELECT authn.logout_session($1, $2) AS done", [
            Buffer.alloc(32, 9),
            event,
          ])
        ).rows[0].done,
      ).toBe(true);
      expect(
        (
          await client.query("SELECT authn.logout_session($1, $2) AS done", [
            Buffer.alloc(32, 9),
            event,
          ])
        ).rows[0].done,
      ).toBe(false);
      expect(
        (
          await client.query("SELECT * FROM authn.use_session($1, 60)", [
            Buffer.alloc(32, 9),
          ])
        ).rowCount,
      ).toBe(0);
      await client.query("RESET ROLE");
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM authn.revocation_event WHERE id=$1",
            [event],
          )
        ).rows[0].count,
      ).toBe(1);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT logout_check");
    }
  });
  it("rolls back logout when the audit event cannot be written", async () => {
    await client.query("SAVEPOINT atomic_logout_check");
    try {
      const duplicate = "0aad95c6-341d-42ca-a188-2c56400c157f";
      await client.query(
        "INSERT INTO authn.revocation_event (id,target_account_id,kind) VALUES ($1,$2,'account')",
        [duplicate, account],
      );
      await client.query("SET LOCAL ROLE agri_session_executor");
      await expectDenied(
        "SELECT authn.logout_session($1,$2)",
        [Buffer.alloc(32, 9), duplicate],
        "23505",
      );
      const stillActive = await client.query(
        "SELECT * FROM authn.use_session($1, 60)",
        [Buffer.alloc(32, 9)],
      );
      expect(stillActive.rows).toEqual([
        { session_id: session, account_id: account },
      ]);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT atomic_logout_check");
    }
  });
  it("uses an opaque cookie through the restricted adapter and revokes it on logout", async () => {
    await client.query("SAVEPOINT adapter_check");
    try {
      const opaque = Buffer.alloc(32, 17).toString("base64url");
      const id = "ca9e0ac0-afd8-40ef-b253-fc939933ae12";
      await client.query(
        "INSERT INTO authn.login_session (id,account_id,device_id,device_required,cookie_secret_hash,idle_expires_at,absolute_expires_at) VALUES ($1,$2,$3,true,$4,now()+interval '1 hour',now()+interval '1 day')",
        [id, account, device, digestSessionSecret(opaque)],
      );
      await client.query(
        "SET LOCAL SESSION AUTHORIZATION agri_session_executor",
      );
      const operations = new PostgresSessionOperations(client);
      expect(await operations.use(opaque, 120)).toEqual({
        sessionId: id,
        accountId: account,
      });
      expect(await operations.use("not-a-cookie", 120)).toBeNull();
      expect(await operations.logout(opaque)).toBe(true);
      expect(await operations.use(opaque, 120)).toBeNull();
      expect(await operations.logout(opaque)).toBe(false);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT adapter_check");
    }
  });
  it("allows the restricted MFA verifier to consume a current counter once", async () => {
    const factor = "7206b2ec-f547-47a5-8f5a-ad8c8dfd0c75";
    await client.query("SAVEPOINT mfa_check");
    try {
      await client.query(
        "INSERT INTO authn.mfa_factor (id,account_id,key_id,nonce,ciphertext,auth_tag,enrolled_at) VALUES ($1,$2,'synthetic',$3,$4,$5,now())",
        [
          factor,
          account,
          Buffer.alloc(12, 1),
          Buffer.alloc(20, 2),
          Buffer.alloc(16, 3),
        ],
      );
      await client.query("SET LOCAL SESSION AUTHORIZATION agri_mfa_verifier");
      await expectDenied("SELECT * FROM authn.mfa_factor", [], "42501");
      await expectDenied("SET ROLE agri_authn_function_owner", [], "42501");
      const stored = await client.query(
        "SELECT * FROM authn.read_mfa_factor($1)",
        [account],
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0].factor_id).toBe(factor);
      const counter = (
        await client.query(
          "SELECT floor(extract(epoch from clock_timestamp()) / 30)::bigint AS counter",
        )
      ).rows[0].counter;
      expect(
        (
          await client.query(
            "SELECT authn.consume_mfa_counter($1,$2,$3) AS ok",
            [account, factor, counter],
          )
        ).rows[0].ok,
      ).toBe(true);
      expect(
        (
          await client.query(
            "SELECT authn.consume_mfa_counter($1,$2,$3) AS ok",
            [account, factor, counter],
          )
        ).rows[0].ok,
      ).toBe(false);
      expect(
        (
          await client.query(
            "SELECT authn.consume_mfa_counter($1,$2,$3) AS ok",
            [account, factor, Number(counter) + 10],
          )
        ).rows[0].ok,
      ).toBe(false);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT mfa_check");
    }
  });
  it("refuses MFA verification for an inactive account or disabled factor", async () => {
    const factor = "7206b2ec-f547-47a5-8f5a-ad8c8dfd0c75";
    await client.query("SAVEPOINT mfa_denied_check");
    try {
      await client.query(
        "INSERT INTO authn.mfa_factor (id,account_id,key_id,nonce,ciphertext,auth_tag,enrolled_at) VALUES ($1,$2,'synthetic',$3,$4,$5,now())",
        [factor, account, Buffer.alloc(12), Buffer.alloc(20), Buffer.alloc(16)],
      );
      await client.query(
        "UPDATE authn.account SET active=false, disabled_at=now() WHERE id=$1",
        [account],
      );
      await client.query("SET LOCAL ROLE agri_mfa_verifier");
      expect(
        (
          await client.query("SELECT * FROM authn.read_mfa_factor($1)", [
            account,
          ])
        ).rowCount,
      ).toBe(0);
      const counter = (
        await client.query(
          "SELECT floor(extract(epoch from clock_timestamp()) / 30)::bigint AS counter",
        )
      ).rows[0].counter;
      expect(
        (
          await client.query(
            "SELECT authn.consume_mfa_counter($1,$2,$3) AS ok",
            [account, factor, counter],
          )
        ).rows[0].ok,
      ).toBe(false);
      await client.query("RESET ROLE");
      await client.query(
        "UPDATE authn.account SET active=true, disabled_at=NULL WHERE id=$1",
        [account],
      );
      await client.query(
        "UPDATE authn.mfa_factor SET disabled_at=now() WHERE id=$1",
        [factor],
      );
      await client.query("SET LOCAL ROLE agri_mfa_verifier");
      expect(
        (
          await client.query("SELECT * FROM authn.read_mfa_factor($1)", [
            account,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await client.query(
            "SELECT authn.consume_mfa_counter($1,$2,$3) AS ok",
            [account, factor, counter],
          )
        ).rows[0].ok,
      ).toBe(false);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT mfa_denied_check");
    }
  });
  it("verifies an encrypted MFA factor and atomically prevents OTP replay", async () => {
    const factorId = "7206b2ec-f547-47a5-8f5a-ad8c8dfd0c75";
    const secret = Buffer.from("12345678901234567890", "ascii");
    const key = Buffer.alloc(32, 8);
    const encrypted = encryptMfaSecret(secret, key, account, factorId);
    const now = Date.now();
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
    const mac = createHmac("sha1", secret).update(counter).digest();
    const offset = mac[mac.length - 1] & 15;
    const code = String(
      (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000,
    ).padStart(6, "0");
    await client.query("SAVEPOINT mfa_adapter_check");
    try {
      await client.query(
        "INSERT INTO authn.mfa_factor (id,account_id,key_id,nonce,ciphertext,auth_tag,enrolled_at) VALUES ($1,$2,'synthetic',$3,$4,$5,now())",
        [
          factorId,
          account,
          encrypted.nonce,
          encrypted.ciphertext,
          encrypted.tag,
        ],
      );
      await client.query("SET LOCAL SESSION AUTHORIZATION agri_mfa_verifier");
      const verifier = new PostgresMfaVerifier(
        client,
        { getKey: async () => key },
        () => now,
      );
      expect(await verifier.verify(account, code)).toBe(true);
      expect(await verifier.verify(account, code)).toBe(false);
      expect(await verifier.verify(account, "invalid")).toBe(false);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT mfa_adapter_check");
    }
  });
  it("issues an approved-device session and audit event without exposing tables to the issuer", async () => {
    const id = "8a6506ba-f6d6-4c30-ad86-b41084050591";
    const event = "6af9f453-e454-41e2-8c3d-15644dc68628";
    await client.query("SAVEPOINT issue_check");
    try {
      await client.query("SET LOCAL SESSION AUTHORIZATION agri_session_issuer");
      await expectDenied(
        "SELECT password_hash FROM authn.account",
        [],
        "42501",
      );
      await expectDenied(
        "SELECT * FROM authn.use_session($1,60)",
        [Buffer.alloc(32, 18)],
        "42501",
      );
      const issued = await client.query(
        "SELECT authn.issue_device_session($1,$2,$3,$4,true,$5,60,3600,$6) AS ok",
        [id, event, account, device, Buffer.alloc(32, 18), proofId],
      );
      expect(issued.rows[0].ok).toBe(true);
      await client.query("RESET SESSION AUTHORIZATION");
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM authn.session_issuance_event WHERE id=$1 AND session_id=$2",
            [event, id],
          )
        ).rows[0].count,
      ).toBe(1);
      await client.query(
        "SET LOCAL SESSION AUTHORIZATION agri_session_executor",
      );
      expect(
        (
          await client.query("SELECT * FROM authn.use_session($1,60)", [
            Buffer.alloc(32, 18),
          ])
        ).rows,
      ).toEqual([{ session_id: id, account_id: account }]);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT issue_check");
    }
  });
  it("issues a secure opaque cookie only after the restricted issuer reports success", async () => {
    await client.query("SAVEPOINT issuance_adapter");
    try {
      await client.query("SET LOCAL SESSION AUTHORIZATION agri_session_issuer");
      // The surrounding test transaction is rolled back; a production adapter must commit first.
      const issuer = new PostgresSessionIssuer({
        executeCommitted: (sql, parameters) => client.query(sql, parameters),
      });
      const issued = await issuer.issue(
        {
          accountId: account,
          deviceId: device,
          deviceRequired: true,
          deviceAssertionId: proofId,
        },
        { idleSeconds: 60, absoluteSeconds: 3600 },
      );
      expect(issued.cookie).toContain("Secure; HttpOnly; SameSite=Lax");
      await expect(
        issuer.issue(
          {
            accountId: another,
            deviceId: device,
            deviceRequired: true,
            deviceAssertionId: proofId,
          },
          { idleSeconds: 60, absoluteSeconds: 3600 },
        ),
      ).rejects.toThrow("denied");
      await expect(
        issuer.issue(
          {
            accountId: account,
            deviceId: device,
            deviceRequired: true,
            deviceAssertionId: proofId,
          },
          { idleSeconds: 60, absoluteSeconds: 30 },
        ),
      ).rejects.toThrow("lifetime");
      await client.query("RESET SESSION AUTHORIZATION");
      const record = await client.query(
        "SELECT cookie_secret_hash FROM authn.login_session WHERE id=$1",
        [issued.sessionId],
      );
      const raw = issued.cookie.split(";")[0].split("=")[1];
      expect(record.rows[0].cookie_secret_hash).toEqual(
        digestSessionSecret(raw),
      );
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT issuance_adapter");
    }
  });
  it("rejects unauthorized devices, invalid lifetimes and inactive accounts during issuance", async () => {
    const id = "8a6506ba-f6d6-4c30-ad86-b41084050591";
    const event = "6af9f453-e454-41e2-8c3d-15644dc68628";
    await client.query("SAVEPOINT issue_reject");
    try {
      await client.query("SET LOCAL ROLE agri_session_issuer");
      for (const params of [
        [id, event, another, device, true, Buffer.alloc(32, 18), 60, 3600],
        [id, event, account, null, true, Buffer.alloc(32, 18), 60, 3600],
        [id, event, account, device, true, Buffer.alloc(32, 18), 3601, 3600],
        [id, event, account, device, true, Buffer.alloc(32, 18), 60, 2592001],
      ]) {
        expect(
          (
            await client.query(
              "SELECT authn.issue_device_session($1,$2,$3,$4,$5,$6,$7,$8,$9) AS ok",
              [...params, proofId],
            )
          ).rows[0].ok,
        ).toBe(false);
      }
      await client.query("RESET ROLE");
      await client.query(
        "UPDATE authn.account SET active=false, disabled_at=now() WHERE id=$1",
        [account],
      );
      await client.query("SET LOCAL ROLE agri_session_issuer");
      expect(
        (
          await client.query(
            "SELECT authn.issue_device_session($1,$2,$3,$4,true,$5,60,3600,$6) AS ok",
            [id, event, account, device, Buffer.alloc(32, 18), proofId],
          )
        ).rows[0].ok,
      ).toBe(false);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT issue_reject");
    }
  });
  it("rolls back session issuance when the audit event cannot be inserted", async () => {
    const first = "8a6506ba-f6d6-4c30-ad86-b41084050591";
    const second = "e2c8203b-9dfd-430f-92f2-ddfe95e59e0c";
    const event = "6af9f453-e454-41e2-8c3d-15644dc68628";
    await client.query("SAVEPOINT issuance_atomic");
    try {
      await client.query("SET LOCAL ROLE agri_session_issuer");
      expect(
        (
          await client.query(
            "SELECT authn.issue_device_session($1,$2,$3,$4,true,$5,60,3600,$6) AS ok",
            [first, event, account, device, Buffer.alloc(32, 18), proofId],
          )
        ).rows[0].ok,
      ).toBe(true);
      await expectDenied(
        "SELECT authn.issue_device_session($1,$2,$3,$4,true,$5,60,3600,$6)",
        [second, event, account, device, Buffer.alloc(32, 19), proofId2],
        "23505",
      );
      await client.query("RESET ROLE");
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM authn.login_session WHERE id=$1",
            [second],
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT issuance_atomic");
    }
  });
  it("connects password, MFA, issued session and logout using synthetic PostgreSQL data", async () => {
    const factorId = "7206b2ec-f547-47a5-8f5a-ad8c8dfd0c75";
    const secret = Buffer.from("12345678901234567890", "ascii");
    const key = Buffer.alloc(32, 8);
    const encrypted = encryptMfaSecret(secret, key, account, factorId);
    const now = Date.now();
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
    const mac = createHmac("sha1", secret).update(counter).digest();
    const offset = mac[mac.length - 1] & 15;
    const code = String(
      (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000,
    ).padStart(6, "0");
    const queryAs =
      (role: string) => async (sql: string, params: unknown[]) => {
        await client.query(`SET LOCAL ROLE ${role}`);
        try {
          return await client.query(sql, params);
        } finally {
          await client.query("RESET ROLE");
        }
      };
    await client.query("SAVEPOINT integrated_login");
    try {
      await client.query(
        "UPDATE authn.account SET password_hash=$1 WHERE id=$2",
        [await hashPassword("synthetic-password"), account],
      );
      await client.query(
        "INSERT INTO authn.mfa_factor (id,account_id,key_id,nonce,ciphertext,auth_tag,enrolled_at) VALUES ($1,$2,'synthetic',$3,$4,$5,now())",
        [
          factorId,
          account,
          encrypted.nonce,
          encrypted.ciphertext,
          encrypted.tag,
        ],
      );
      const credentials = new PostgresCredentialReader({
        query: queryAs("agri_credential_reader"),
      });
      const mfa = new PostgresMfaVerifier(
        { query: queryAs("agri_mfa_verifier") },
        { getKey: async () => key },
        () => now,
      );
      // This test uses an enclosing rollback transaction and synthetic throttle key; production must use committed queries and managed secrets.
      const issuer = new PostgresSessionIssuer({
        executeCommitted: queryAs("agri_session_issuer"),
      });
      const coordinator = await LoginCoordinator.create(
        credentials,
        { verify: verifyPassword },
        mfa,
        new PostgresLoginLimiter(
          { query: queryAs("agri_login_throttle") },
          Buffer.alloc(32, 5),
          { limit: 5, windowSeconds: 60, blockSeconds: 60 },
        ),
        issuer,
        { idleSeconds: 60, absoluteSeconds: 3600 },
        new DeviceProofs(
          { query: queryAs("agri_device_verifier") },
          challengeKey,
          [origin],
        ),
      );
      const proofs = new DeviceProofs(
        { query: queryAs("agri_device_verifier") },
        challengeKey,
        [origin],
      );
      const result = await coordinator.login({
        loginName: "synthetic-a",
        password: "synthetic-password",
        otp: code,
        deviceId: device,
        trustedClientKey: "synthetic",
        trustedOrigin: origin,
        deviceProof: signedProof(proofs),
      });
      const raw = result.cookie.split(";")[0].split("=")[1];
      const operations = new PostgresSessionOperations({
        query: queryAs("agri_session_executor"),
      });
      expect(await operations.use(raw, 60)).toEqual({
        sessionId: result.sessionId,
        accountId: account,
      });
      expect(await operations.logout(raw)).toBe(true);
      expect(await operations.use(raw, 60)).toBeNull();
      await expect(
        coordinator.login({
          loginName: "synthetic-a",
          password: "synthetic-password",
          otp: code,
          deviceId: device,
          trustedClientKey: "synthetic",
          trustedOrigin: origin,
          deviceProof: signedProof(proofs),
        }),
      ).rejects.toThrow("Invalid credentials");
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT integrated_login");
    }
  });
  it("requires an unused current device assertion, rejects legacy issuance and audits key revocation", async () => {
    await client.query("SAVEPOINT device_security");
    try {
      await client.query("SET LOCAL ROLE agri_session_issuer");
      await expectDenied(
        "SELECT authn.issue_session($1,$2,$3,$4,true,$5,60,3600)",
        [randomUUID(), randomUUID(), account, device, Buffer.alloc(32, 21)],
        "42501",
      );
      await expectDenied("SELECT * FROM authn.device_key", [], "42501");
      const issue = (assertion: string | null) =>
        client.query(
          "SELECT authn.issue_device_session($1,$2,$3,$4,true,$5,60,3600,$6) AS ok",
          [
            randomUUID(),
            randomUUID(),
            account,
            device,
            Buffer.from(randomUUID().replaceAll("-", "")),
            assertion,
          ],
        );
      expect((await issue(null)).rows[0].ok).toBe(false);
      expect((await issue(proofId)).rows[0].ok).toBe(true);
      expect((await issue(proofId)).rows[0].ok).toBe(false);
      await client.query("RESET ROLE");
      await client.query(
        "UPDATE authn.device_assertion SET created_at=clock_timestamp()-interval '60 seconds',expires_at=clock_timestamp()-interval '40 seconds' WHERE id=$1",
        [proofId2],
      );
      await client.query("SET LOCAL ROLE agri_session_issuer");
      expect((await issue(proofId2)).rows[0].ok).toBe(false);
      await client.query("RESET ROLE");
      await expectDenied(
        "UPDATE authn.device_key SET public_jwk=$1 WHERE id=$2",
        [{ ...deviceJwk, x: "A".repeat(43) }, keyId],
        "42501",
      );
      await expectDenied(
        "DELETE FROM authn.device_key WHERE id=$1",
        [keyId],
        "42501",
      );
      await client.query(
        "UPDATE authn.device_key SET revoked_at=clock_timestamp() WHERE id=$1",
        [keyId],
      );
      expect(
        (
          await client.query("SELECT state FROM authn.device WHERE id=$1", [
            device,
          ])
        ).rows[0].state,
      ).toBe("revoked");
      expect(
        (
          await client.query(
            "SELECT kind FROM authn.device_key_event WHERE key_id=$1 ORDER BY created_at",
            [keyId],
          )
        ).rows.map((row) => row.kind),
      ).toEqual(["enrolled", "revoked"]);
      await client.query("SET LOCAL ROLE agri_device_verifier");
      expect(
        (
          await client.query("SELECT * FROM authn.read_device_key($1,$2)", [
            account,
            device,
          ])
        ).rows,
      ).toEqual([]);
      await expectDenied("SELECT * FROM authn.device_assertion", [], "42501");
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT device_security");
    }
  });
  it("rejects reused challenges, wrong account/device and key revocation between verification and session issuance", async () => {
    await client.query("SAVEPOINT device_replay");
    try {
      const query = async (sql: string, parameters: unknown[]) => {
        await client.query("SET LOCAL ROLE agri_device_verifier");
        try {
          return await client.query(sql, parameters);
        } finally {
          await client.query("RESET ROLE");
        }
      };
      const proofs = new DeviceProofs({ query }, challengeKey, [origin]);
      const proof = signedProof(proofs);
      expect(
        await proofs.verify(another, "synthetic-a", device, origin, proof),
      ).toBeNull();
      const assertion = await proofs.verify(
        account,
        "synthetic-a",
        device,
        origin,
        proof,
      );
      expect(assertion).not.toBeNull();
      expect(
        await proofs.verify(account, "synthetic-a", device, origin, proof),
      ).toBeNull();
      await client.query(
        "UPDATE authn.device_key SET revoked_at=clock_timestamp() WHERE id=$1",
        [keyId],
      );
      await client.query("SET LOCAL ROLE agri_session_issuer");
      expect(
        (
          await client.query(
            "SELECT authn.issue_device_session($1,$2,$3,$4,true,$5,60,3600,$6) AS ok",
            [
              randomUUID(),
              randomUUID(),
              account,
              device,
              Buffer.alloc(32, 30),
              assertion,
            ],
          )
        ).rows[0].ok,
      ).toBe(false);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT device_replay");
    }
  });
  it("restricts credential lookup to the dedicated role without direct table access", async () => {
    await client.query("SAVEPOINT credential_check");
    try {
      await client.query(
        "SET LOCAL SESSION AUTHORIZATION agri_credential_reader",
      );
      await expectDenied("SELECT * FROM authn.account", [], "42501");
      const reader = new PostgresCredentialReader(client);
      expect((await reader.find("synthetic-a"))?.accountId).toBe(account);
      expect(await reader.find("missing-synthetic")).toBeNull();
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT credential_check");
    }
  });
  it("applies shared account and client login limits without storing plaintext identifiers", async () => {
    await client.query("SAVEPOINT throttle_check");
    try {
      await client.query("SET LOCAL SESSION AUTHORIZATION agri_login_throttle");
      await expectDenied(
        "SELECT * FROM authn.login_attempt_bucket",
        [],
        "42501",
      );
      const limiter = new PostgresLoginLimiter(client, Buffer.alloc(32, 4), {
        limit: 2,
        windowSeconds: 60,
        blockSeconds: 60,
      });
      expect(
        await limiter.consume("synthetic-account", "synthetic-client"),
      ).toBe(true);
      expect(
        await limiter.consume("synthetic-account", "synthetic-client"),
      ).toBe(true);
      expect(
        await limiter.consume("synthetic-account", "synthetic-client"),
      ).toBe(false);
      expect(await limiter.consume("synthetic-account", "another-client")).toBe(
        false,
      );
      expect(await limiter.consume("another-account", "synthetic-client")).toBe(
        false,
      );
      await client.query("RESET SESSION AUTHORIZATION");
      const rows = await client.query(
        "SELECT bucket_key, attempts FROM authn.login_attempt_bucket",
      );
      expect(rows.rows.length).toBeGreaterThanOrEqual(2);
      expect(
        rows.rows.every(
          (row) =>
            Buffer.isBuffer(row.bucket_key) && row.bucket_key.length === 32,
        ),
      ).toBe(true);
      expect(JSON.stringify(rows.rows)).not.toContain("synthetic-account");
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT throttle_check");
    }
  });
  it("enforces signed actor context, create coverage, separate read permissions and audit", async () => {
    const org = "89e38d6a-ec4a-4be1-b231-fae3afe5cb18";
    const parent = "5eae9367-9fc0-409c-9fb7-9da145d6261b";
    const child = "e6f93f91-39ea-4f47-a71e-38436eedb217";
    const otherUnit = "a52a419a-4de2-40f9-8aba-a1238f5b9c1d";
    const geoA = "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9";
    const geoB = "6c6a87de-b5c4-4ffe-acf0-7ebdb09d421f";
    const farmer = "1d1ebede-c4a3-4d34-a6f5-5962cc403d0b";
    const secret = Buffer.alloc(32, 42);
    await client.query("SAVEPOINT farmer_policy_check");
    try {
      await client.query("INSERT INTO authz.context_key (key) VALUES ($1)", [
        secret,
      ]);
      await client.query(
        "INSERT INTO farm.organization (id,name) VALUES ($1,'Synthetic organization')",
        [org],
      );
      await client.query(
        "INSERT INTO farm.organizational_unit (id,organization_id,name) VALUES ($1,$2,'Parent')",
        [parent, org],
      );
      await client.query(
        "INSERT INTO farm.organizational_unit (id,organization_id,parent_id,name) VALUES ($1,$2,$3,'Child')",
        [child, org, parent],
      );
      await client.query(
        "INSERT INTO farm.organizational_unit (id,organization_id,name) VALUES ($1,$2,'Other unit')",
        [otherUnit, org],
      );
      await client.query(
        "INSERT INTO farm.geography (id,organization_id,unit_id,name) VALUES ($1,$3,$4,'Village A'),($2,$3,$4,'Village B')",
        [geoA, geoB, org, child],
      );
      await client.query(
        "INSERT INTO authz.permission_grant (id,account_id,organization_id,permission,coverage,geography_id,unit_id,registration_source,starts_at) VALUES (gen_random_uuid(),$1,$2,'farmer.create','assigned',$3,$4,'field_officer',now()-interval '1 hour')",
        [account, org, geoA, parent],
      );
      await client.query(
        "INSERT INTO authz.assignment (id,account_id,organization_id,geography_id,unit_id,starts_at) VALUES (gen_random_uuid(),$1,$2,$3,$4,now()-interval '1 hour')",
        [account, org, geoA, parent],
      );
      const context = new TransactionActorContext(secret);
      await client.query("SET LOCAL SESSION AUTHORIZATION agri_farmer_runtime");
      expect((await client.query("SELECT * FROM farm.farmer")).rowCount).toBe(
        0,
      );
      await expectDenied(
        "INSERT INTO farm.farmer (id,geography_id,full_name,privacy_notice_provided,registration_source) VALUES ($1,$2,'Synthetic',true,'field_officer')",
        [farmer, geoA],
        "42501",
      );
      await context.bind(client, { accountId: account, sessionId: session });
      await client.query("SELECT set_config('agri.signature',$1,true)", [
        "0".repeat(64),
      ]);
      await expectDenied(
        "SELECT * FROM farm.register_farmer(gen_random_uuid(),gen_random_uuid(),$1,'Synthetic',true,'field_officer')",
        [geoA],
        "42501",
      );
      await context.bind(client, { accountId: account, sessionId: session });
      await client.query("SELECT set_config('agri.actor',$1,true)", [another]);
      await expectDenied(
        "SELECT * FROM farm.register_farmer(gen_random_uuid(),gen_random_uuid(),$1,'Synthetic',true,'field_officer')",
        [geoA],
        "42501",
      );
      await context.bind(client, { accountId: account, sessionId: session });
      await expectDenied("SELECT key FROM authz.context_key", [], "42501");
      await expectDenied("SET ROLE agri_policy_owner", [], "42501");
      await expectDenied(
        "SELECT * FROM farm.register_farmer(gen_random_uuid(),gen_random_uuid(),$1,'Synthetic',true,'field_officer')",
        [geoB],
        "42501",
      );
      await expectDenied(
        "SELECT * FROM farm.register_farmer(gen_random_uuid(),gen_random_uuid(),$1,'Synthetic',true,'administrator')",
        [geoA],
        "42501",
      );
      await expectDenied(
        "INSERT INTO farm.farmer (id,geography_id,full_name,privacy_notice_provided,registration_source,created_by) VALUES (gen_random_uuid(),$1,'Synthetic',true,'field_officer',$2)",
        [geoA, another],
        "42501",
      );
      await expectDenied(
        "SELECT * FROM farm.register_farmer(gen_random_uuid(),gen_random_uuid(),$1,'Synthetic',false,'field_officer')",
        [geoA],
        "42501",
      );
      await client.query("RESET SESSION AUTHORIZATION");
      await client.query(
        "UPDATE authz.permission_grant SET unit_id=$1 WHERE permission='farmer.create' AND account_id=$2",
        [otherUnit, account],
      );
      await client.query("SET LOCAL SESSION AUTHORIZATION agri_farmer_runtime");
      await expectDenied(
        "SELECT * FROM farm.register_farmer(gen_random_uuid(),gen_random_uuid(),$1,'Synthetic',true,'field_officer')",
        [geoA],
        "42501",
      );
      await client.query("RESET SESSION AUTHORIZATION");
      await client.query(
        "UPDATE authz.permission_grant SET unit_id=$1 WHERE permission='farmer.create' AND account_id=$2",
        [parent, account],
      );
      await client.query("SET LOCAL SESSION AUTHORIZATION agri_farmer_runtime");
      const mutation = "66e8c5d4-96a2-4351-b7a2-011e692959e2";
      const registration =
        "SELECT * FROM farm.register_farmer($1,$2,$3,$4,true,'field_officer')";
      expect(
        (
          await client.query(registration, [
            mutation,
            farmer,
            geoA,
            "Synthetic farmer",
          ])
        ).rows,
      ).toEqual([{ farmer_id: farmer, replayed: false }]);
      expect(
        (
          await client.query(registration, [
            mutation,
            farmer,
            geoA,
            "Synthetic farmer",
          ])
        ).rows,
      ).toEqual([{ farmer_id: farmer, replayed: true }]);
      await expectDenied(
        registration,
        [mutation, farmer, geoA, "Changed name"],
        "23505",
      );
      const duplicateMutation = "53aad38e-a6b2-481b-b9f9-1814d9fd0cb7";
      const duplicateFarmer = "ac01b3e0-835f-46d0-882e-08f8f2e895d6";
      expect(
        (
          await client.query(registration, [
            duplicateMutation,
            duplicateFarmer,
            geoA,
            "Synthetic farmer",
          ])
        ).rows,
      ).toEqual([{ farmer_id: duplicateFarmer, replayed: false }]);
      await expectDenied("SELECT * FROM farm.registration_risk", [], "42501");
      expect((await client.query("SELECT * FROM farm.farmer")).rowCount).toBe(
        0,
      );
      await expectDenied(
        "UPDATE farm.farmer SET status='verified'",
        [],
        "42501",
      );
      await client.query("RESET SESSION AUTHORIZATION");
      expect(
        (
          await client.query(
            "SELECT reason FROM farm.registration_risk WHERE mutation_id=$1",
            [duplicateMutation],
          )
        ).rows,
      ).toEqual([{ reason: "name_and_geography" }]);
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM farm.farmer_audit WHERE farmer_id=$1 AND actor_id=$2",
            [farmer, account],
          )
        ).rows[0].count,
      ).toBe(1);
      await client.query(
        "INSERT INTO authz.permission_grant (id,account_id,organization_id,permission,coverage,geography_id,unit_id,starts_at) VALUES (gen_random_uuid(),$1,$2,'farmer.read','assigned',$3,$4,now()-interval '1 hour')",
        [account, org, geoA, parent],
      );
      await client.query("SET LOCAL SESSION AUTHORIZATION agri_farmer_runtime");
      expect(
        (await client.query("SELECT id FROM farm.farmer ORDER BY id")).rows,
      ).toEqual([{ id: farmer }, { id: duplicateFarmer }]);
      await client.query("RESET SESSION AUTHORIZATION");
      await client.query(
        "UPDATE authz.assignment SET active=false WHERE account_id=$1",
        [account],
      );
      await client.query("SET LOCAL SESSION AUTHORIZATION agri_farmer_runtime");
      expect((await client.query("SELECT id FROM farm.farmer")).rowCount).toBe(
        0,
      );
      await client.query("RESET SESSION AUTHORIZATION");
      await client.query(
        "INSERT INTO authz.permission_grant (id,account_id,organization_id,permission,coverage,registration_source,starts_at) VALUES (gen_random_uuid(),$1,$2,'farmer.create','organization','administrator',now()-interval '1 hour')",
        [account, org],
      );
      await client.query("SET LOCAL SESSION AUTHORIZATION agri_farmer_runtime");
      const registered = await client.query<{ farmer_id: string }>(
        "SELECT * FROM farm.register_farmer(gen_random_uuid(),gen_random_uuid(),$1,'Synthetic admin registration',true,'administrator')",
        [geoB],
      );
      expect(registered.rowCount).toBe(1);
      // Creating within the organization does not grant read access to the result.
      expect(
        (
          await client.query("SELECT id FROM farm.farmer WHERE id=$1", [
            registered.rows[0].farmer_id,
          ])
        ).rowCount,
      ).toBe(0);
      await client.query("RESET SESSION AUTHORIZATION");
      expect(
        (
          await client.query(
            "SELECT status,registration_source,created_by,privacy_notice_provided FROM farm.farmer WHERE id=$1",
            [registered.rows[0].farmer_id],
          )
        ).rows,
      ).toEqual([
        {
          status: "pending-review",
          registration_source: "administrator",
          created_by: account,
          privacy_notice_provided: true,
        },
      ]);
      expect(
        (
          await client.query(
            "SELECT actor_id,action FROM farm.farmer_audit WHERE farmer_id=$1",
            [registered.rows[0].farmer_id],
          )
        ).rows,
      ).toEqual([{ actor_id: account, action: "registration" }]);
      await client.query(
        "UPDATE farm.organizational_unit SET parent_id=$1 WHERE id=$2",
        [child, parent],
      );
      await client.query("SET LOCAL SESSION AUTHORIZATION agri_farmer_runtime");
      await expectDenied(
        "SELECT * FROM farm.register_farmer(gen_random_uuid(),gen_random_uuid(),$1,'Synthetic',true,'administrator')",
        [geoB],
        "42501",
      );
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT farmer_policy_check");
    }
  });
  it("rejects revocation events associated with another account's device", async () => {
    await expectDenied(
      "INSERT INTO authn.revocation_event (id,target_account_id,device_id,kind) VALUES (gen_random_uuid(),$1,$2,'device')",
      [another, device],
      "23503",
    );
  });
  it("rechecks expiration after waiting for an account lock", async () => {
    // The schema and roles were created only in this dedicated synthetic test database.
    await client.query("COMMIT");
    committedForConcurrency = true;
    const other = new pg.Client({ connectionString: url });
    await other.connect();
    let pending: Promise<pg.QueryResult> | undefined;
    try {
      await client.query(
        "UPDATE authn.login_session SET idle_expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",
        [session],
      );
      await client.query("BEGIN");
      await client.query("UPDATE authn.account SET active=active WHERE id=$1", [
        account,
      ]);
      const pid = (await other.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid;
      await other.query("SET SESSION AUTHORIZATION agri_session_executor");
      pending = other.query("SELECT * FROM authn.use_session($1,60)", [
        Buffer.alloc(32, 9),
      ]);
      let blocked = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const state = await client.query(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
          [pid],
        );
        if (state.rows[0]?.wait_event_type === "Lock") {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await client.query("COMMIT");
      expect((await pending).rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      if (pending) await pending.catch(() => undefined);
      await other.end();
    }
  }, 15000);
  it("denies session use when account revocation commits while the check waits", async () => {
    const other = new pg.Client({ connectionString: url });
    await other.connect();
    let pending: Promise<pg.QueryResult> | undefined;
    try {
      await client.query(
        "UPDATE authn.login_session SET idle_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1",
        [session],
      );
      await client.query("BEGIN");
      await client.query(
        "UPDATE authn.account SET active=false, disabled_at=now() WHERE id=$1",
        [account],
      );
      const pid = (await other.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid;
      await other.query("SET SESSION AUTHORIZATION agri_session_executor");
      pending = other.query("SELECT * FROM authn.use_session($1,60)", [
        Buffer.alloc(32, 9),
      ]);
      let blocked = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const state = await client.query(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
          [pid],
        );
        if (state.rows[0]?.wait_event_type === "Lock") {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      await client.query("COMMIT");
      expect((await pending).rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      if (pending) await pending.catch(() => undefined);
      await other.end();
    }
  }, 15000);
  it("enforces the same login limit under concurrent database requests", async () => {
    const first = new pg.Client({ connectionString: url });
    const second = new pg.Client({ connectionString: url });
    await Promise.all([first.connect(), second.connect()]);
    try {
      await Promise.all([
        first.query("SET SESSION AUTHORIZATION agri_login_throttle"),
        second.query("SET SESSION AUTHORIZATION agri_login_throttle"),
      ]);
      const query =
        "SELECT authn.consume_login_attempt($1,$2,1,60,60) AS allowed";
      const args = [Buffer.alloc(32, 21), Buffer.alloc(32, 22)];
      const results = await Promise.all([
        first.query(query, args),
        second.query(query, args),
      ]);
      expect(results.map((value) => value.rows[0].allowed).sort()).toEqual([
        false,
        true,
      ]);
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  }, 15000);
  it("holds assignment authorization through a transaction and denies the next transaction after revocation", async () => {
    const org = "89e38d6a-ec4a-4be1-b231-fae3afe5cb18";
    const unit = "5eae9367-9fc0-409c-9fb7-9da145d6261b";
    const geo = "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9";
    const farmer = "1d1ebede-c4a3-4d34-a6f5-5962cc403d0b";
    const assignment = "3d4ebf75-28cb-40e2-bb0d-4196564a96d4";
    const secret = Buffer.alloc(32, 42);
    await client.query(
      "UPDATE authn.account SET active=true, disabled_at=NULL WHERE id=$1",
      [account],
    );
    await client.query(
      "UPDATE authn.login_session SET idle_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1",
      [session],
    );
    await client.query("INSERT INTO authz.context_key (key) VALUES ($1)", [
      secret,
    ]);
    await client.query(
      "INSERT INTO farm.organization (id,name) VALUES ($1,'Synthetic organization')",
      [org],
    );
    await client.query(
      "INSERT INTO farm.organizational_unit (id,organization_id,name) VALUES ($1,$2,'Synthetic unit')",
      [unit, org],
    );
    await client.query(
      "INSERT INTO farm.geography (id,organization_id,unit_id,name) VALUES ($1,$2,$3,'Synthetic village')",
      [geo, org, unit],
    );
    await client.query(
      "INSERT INTO authz.permission_grant (id,account_id,organization_id,permission,coverage,geography_id,starts_at) VALUES (gen_random_uuid(),$1,$2,'farmer.read','assigned',$3,now()-interval '1 hour')",
      [account, org, geo],
    );
    await client.query(
      "INSERT INTO authz.assignment (id,account_id,organization_id,geography_id,starts_at) VALUES ($1,$2,$3,$4,now()-interval '1 hour')",
      [assignment, account, org, geo],
    );
    await client.query(
      "INSERT INTO farm.farmer (id,geography_id,full_name,privacy_notice_provided,registration_source,created_by) VALUES ($1,$2,'Synthetic',true,'field_officer',$3)",
      [farmer, geo, account],
    );
    const worker = new pg.Client({ connectionString: url });
    const revoker = new pg.Client({ connectionString: url });
    await Promise.all([worker.connect(), revoker.connect()]);
    let pending: Promise<pg.QueryResult> | undefined;
    try {
      await worker.query("SET SESSION AUTHORIZATION agri_farmer_runtime");
      await worker.query("BEGIN");
      const context = new TransactionActorContext(secret);
      await context.bind(worker, { accountId: account, sessionId: session });
      expect((await worker.query("SELECT id FROM farm.farmer")).rows).toEqual([
        { id: farmer },
      ]);
      const previous = (
        await worker.query(
          "SELECT current_setting('agri.signature') AS signature",
        )
      ).rows[0].signature;
      await worker.query("COMMIT");
      await worker.query("BEGIN");
      await worker.query(
        "SELECT set_config('agri.actor',$1,true),set_config('agri.session',$2,true),set_config('agri.signature',$3,true)",
        [account, session, previous],
      );
      expect((await worker.query("SELECT id FROM farm.farmer")).rowCount).toBe(
        0,
      );
      await worker.query("COMMIT");
      await worker.query("BEGIN");
      await context.bind(worker, { accountId: account, sessionId: session });
      expect((await worker.query("SELECT id FROM farm.farmer")).rows).toEqual([
        { id: farmer },
      ]);
      const pid = (await revoker.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      pending = revoker.query(
        "UPDATE authz.assignment SET active=false WHERE id=$1",
        [assignment],
      );
      let blocked = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const state = await client.query(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
          [pid],
        );
        if (state.rows[0]?.wait_event_type === "Lock") {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      await worker.query("COMMIT");
      await pending;
      await worker.query("BEGIN");
      await context.bind(worker, { accountId: account, sessionId: session });
      expect((await worker.query("SELECT id FROM farm.farmer")).rowCount).toBe(
        0,
      );
      await worker.query("COMMIT");
    } finally {
      await worker.query("ROLLBACK");
      if (pending) await pending.catch(() => undefined);
      await Promise.all([worker.end(), revoker.end()]);
    }
  }, 15000);
  it("serializes concurrent retries and duplicate-risk checks in PostgreSQL", async () => {
    const geo = "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9";
    const org = "89e38d6a-ec4a-4be1-b231-fae3afe5cb18";
    const assignment = "3d4ebf75-28cb-40e2-bb0d-4196564a96d4";
    const first = new pg.Client({ connectionString: url });
    const second = new pg.Client({ connectionString: url });
    await Promise.all([first.connect(), second.connect()]);
    let pending: Promise<pg.QueryResult> | undefined;
    const context = new TransactionActorContext(Buffer.alloc(32, 42));
    const register =
      "SELECT * FROM farm.register_farmer($1,$2,$3,$4,true,'field_officer')";
    const begin = async (connection: pg.Client) => {
      await connection.query("BEGIN");
      await context.bind(connection, {
        accountId: account,
        sessionId: session,
      });
    };
    try {
      await client.query(
        "UPDATE authz.assignment SET active=true WHERE id=$1",
        [assignment],
      );
      await client.query(
        "INSERT INTO authz.permission_grant (id,account_id,organization_id,permission,coverage,geography_id,registration_source,starts_at) VALUES (gen_random_uuid(),$1,$2,'farmer.create','assigned',$3,'field_officer',now()-interval '1 hour')",
        [account, org, geo],
      );
      await Promise.all([
        first.query("SET SESSION AUTHORIZATION agri_farmer_runtime"),
        second.query("SET SESSION AUTHORIZATION agri_farmer_runtime"),
      ]);
      await begin(first);
      await begin(second);
      const mutation = "296a00be-4265-40f2-bb28-0e15a391fd16";
      const farmerId = "26710056-4b42-4558-a47f-1f533dd50a97";
      const args = [mutation, farmerId, geo, "Concurrent synthetic name"];
      expect((await first.query(register, args)).rows).toEqual([
        { farmer_id: farmerId, replayed: false },
      ]);
      pending = second.query(register, args);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await first.query("COMMIT");
      expect((await pending).rows).toEqual([
        { farmer_id: farmerId, replayed: true },
      ]);
      pending = undefined;
      await second.query("COMMIT");
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM farm.farmer_audit WHERE farmer_id=$1",
            [farmerId],
          )
        ).rows[0].count,
      ).toBe(1);
      await begin(first);
      await begin(second);
      const firstMutation = "a4e3fd42-76c8-4c42-8fa5-2b9174c0649f";
      const secondMutation = "5bafc91a-8cf5-4097-b43d-2798d0c628d6";
      const firstFarmer = "8626b371-6eb1-41b5-b6bf-95008f83e8ff";
      const secondFarmer = "c93eb8f3-ff96-42b7-a1dc-c7403efcf02c";
      await first.query(register, [
        firstMutation,
        firstFarmer,
        geo,
        "Concurrent duplicate synthetic",
      ]);
      pending = second.query(register, [
        secondMutation,
        secondFarmer,
        geo,
        "Concurrent duplicate synthetic",
      ]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await first.query("COMMIT");
      await pending;
      pending = undefined;
      await second.query("COMMIT");
      expect(
        (
          await client.query(
            "SELECT reason FROM farm.registration_risk WHERE mutation_id=$1",
            [secondMutation],
          )
        ).rows,
      ).toEqual([{ reason: "name_and_geography" }]);
    } finally {
      await first.query("ROLLBACK");
      await second.query("ROLLBACK");
      if (pending) await pending.catch(() => undefined);
      await Promise.all([first.end(), second.end()]);
    }
  }, 15000);
  it("registers and safely replays a farmer through the server service and restricted database role", async () => {
    const geo = "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9";
    const assignment = "3d4ebf75-28cb-40e2-bb0d-4196564a96d4";
    const farmerId = "06149451-4004-4a23-a5a2-64a24e485a82";
    const mutationId = "f7e0c8bc-3dcb-4be7-ab63-d80f4099220a";
    const connection = new pg.Client({ connectionString: url });
    await connection.connect();
    try {
      await connection.query("SET SESSION AUTHORIZATION agri_farmer_runtime");
      const service = new FarmerRegistrationService(
        new TransactionActorContext(Buffer.alloc(32, 42)),
      );
      const actor = { accountId: account, sessionId: session };
      const input = {
        mutationId,
        farmer: {
          farmerId,
          geographyId: geo,
          fullName: "Synthetic through service",
          privacyNoticeProvided: true,
        },
      };
      expect(
        await service.register(connection, actor, "field_officer", input),
      ).toEqual({ farmerId, replayed: false });
      expect(
        await service.register(connection, actor, "field_officer", input),
      ).toEqual({ farmerId, replayed: true });
      await expect(
        service.register(connection, actor, "field_officer", {
          ...input,
          accountId: another,
        }),
      ).rejects.toThrow();
      await expect(
        service.register(connection, actor, "field_officer", {
          ...input,
          farmer: { ...input.farmer, fullName: "Changed" },
        }),
      ).rejects.toMatchObject({ code: "23505" });
      await client.query(
        "UPDATE authz.assignment SET active=false WHERE id=$1",
        [assignment],
      );
      await expect(
        service.register(connection, actor, "field_officer", input),
      ).rejects.toThrow("Registration denied");
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM farm.farmer_audit WHERE farmer_id=$1",
            [farmerId],
          )
        ).rows[0].count,
      ).toBe(1);
    } finally {
      await connection.end();
    }
  }, 15000);
  it("composes the real pilot runtime with separated LOGIN roles and revokes issued JWT access on logout", async () => {
    const groups = [
      "agri_credential_reader",
      "agri_mfa_verifier",
      "agri_login_throttle",
      "agri_session_issuer",
      "agri_session_executor",
      "agri_session_reader",
      "agri_farmer_runtime",
      "agri_device_verifier",
      "agri_land_runtime",
      "agri_project_runtime",
    ];
    const mappings: Record<string, string> = {};
    for (let i = 0; i < groups.length; i++) {
      await client.query(
        `CREATE ROLE agri_test_login_${i} LOGIN INHERIT PASSWORD 'synthetic-local-password' IN ROLE ${groups[i]}`,
      );
      const mapped = new URL(url!);
      mapped.username = `agri_test_login_${i}`;
      mapped.password = "synthetic-local-password";
      mappings[groups[i]] = mapped.toString();
    }
    const key = Buffer.alloc(32, 8);
    const secret = Buffer.from("12345678901234567890", "ascii");
    const factor = "7206b2ec-f547-47a5-8f5a-ad8c8dfd0c75";
    const encrypted = encryptMfaSecret(secret, key, account, factor);
    await client.query(
      "UPDATE authn.account SET active=true,disabled_at=NULL,password_hash=$1 WHERE id=$2",
      [await hashPassword("synthetic-password"), account],
    );
    await client.query(
      "UPDATE authz.assignment SET active=true WHERE account_id=$1",
      [account],
    );
    await client.query(
      "INSERT INTO authn.mfa_factor (id,account_id,key_id,nonce,ciphertext,auth_tag,enrolled_at) VALUES ($1,$2,'synthetic',$3,$4,$5,now())",
      [factor, account, encrypted.nonce, encrypted.ciphertext, encrypted.tag],
    );
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const env = {
      NODE_ENV: "test",
      ENABLE_PILOT_AUTH: "true",
      PILOT_INTERNAL_KEY: "synthetic-internal-key-with-at-least-43-characters",
      PILOT_DATABASE_URLS: JSON.stringify(mappings),
      PILOT_MFA_KEYS: JSON.stringify({ synthetic: key.toString("base64") }),
      PILOT_THROTTLE_KEY: Buffer.alloc(32, 5).toString("base64"),
      PILOT_CSRF_KEY: Buffer.alloc(32, 6).toString("base64"),
      PILOT_ACTOR_KEY: Buffer.alloc(32, 42).toString("base64"),
      PILOT_DEVICE_CHALLENGE_KEY: challengeKey.toString("base64"),
      PILOT_JWT_PRIVATE_KEY: pair.privateKey,
      PILOT_JWT_KID: "synthetic",
      PILOT_JWT_ISSUER: "synthetic-auth",
      PILOT_JWT_AUDIENCE: "synthetic-api",
      PILOT_ORIGINS: "https://field.example.test",
    };
    await expect(
      createPilotRuntime({
        ...env,
        PILOT_DATABASE_URLS: JSON.stringify({
          ...mappings,
          agri_credential_reader: url,
        }),
      }),
    ).rejects.toThrow("least privilege");
    await client.query(
      "GRANT INSERT(id) ON authn.login_session TO agri_test_login_0",
    );
    try {
      await expect(createPilotRuntime(env)).rejects.toThrow("least privilege");
    } finally {
      await client.query(
        "REVOKE INSERT(id) ON authn.login_session FROM agri_test_login_0",
      );
    }
    await client.query("GRANT agri_device_provisioner TO agri_test_login_0");
    try {
      await expect(createPilotRuntime(env)).rejects.toThrow("least privilege");
    } finally {
      await client.query(
        "REVOKE agri_device_provisioner FROM agri_test_login_0",
      );
    }
    await client.query(
      "GRANT SELECT(key) ON authz.context_key TO agri_test_login_6",
    );
    try {
      await expect(createPilotRuntime(env)).rejects.toThrow("least privilege");
    } finally {
      await client.query(
        "REVOKE SELECT(key) ON authz.context_key FROM agri_test_login_6",
      );
    }
    await client.query(
      "GRANT SELECT(id) ON farm.farmer_audit TO agri_test_login_6",
    );
    try {
      await expect(createPilotRuntime(env)).rejects.toThrow("least privilege");
    } finally {
      await client.query(
        "REVOKE SELECT(id) ON farm.farmer_audit FROM agri_test_login_6",
      );
    }
    const runtime = (await createPilotRuntime(env))!;
    let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
    try {
      const now = Date.now();
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
      const mac = createHmac("sha1", secret).update(counter).digest();
      const offset = mac[mac.length - 1] & 15;
      const code = String(
        (mac.readUInt32BE(offset) & 0x7fffffff) % 1000000,
      ).padStart(6, "0");
      app = await NestFactory.create(
        {
          module: class RuntimeTestModule {},
          controllers: [PilotController, ReadinessController],
          providers: [{ provide: PILOT_RUNTIME, useValue: runtime }],
        },
        { logger: false },
      );
      await app.listen(0, "127.0.0.1");
      const readiness = await fetch(`${await app.getUrl()}/ready`);
      expect(readiness.status).toBe(200);
      expect(readiness.headers.get("cache-control")).toBe("no-store");
      expect(await readiness.json()).toEqual({ status: "ready" });
      const handler = createBffHandler({
        apiOrigin: await app.getUrl(),
        publicOrigin: "https://field.example.test",
        internalKey: env.PILOT_INTERNAL_KEY,
        source: "field_officer",
        allowInsecureLocal: true,
      });
      const adminHandler = createBffHandler({
        apiOrigin: await app.getUrl(),
        publicOrigin: "https://field.example.test",
        internalKey: env.PILOT_INTERNAL_KEY,
        source: "administrator",
        allowInsecureLocal: true,
      });
      let cookieHeader = "";
      let csrfValue = "";
      const browser = (
        path: string,
        method = "GET",
        data?: unknown,
        application: "field_officer" | "administrator" = "field_officer",
      ) =>
        (application === "administrator" ? adminHandler : handler)(
          new Request(`https://field.example.test/api/pilot/${path}`, {
            method,
            headers: {
              origin: "https://field.example.test",
              ...(cookieHeader ? { cookie: cookieHeader } : {}),
              ...(csrfValue ? { "x-csrf-token": csrfValue } : {}),
              ...(data !== undefined
                ? { "content-type": "application/json" }
                : {}),
            },
            body: data !== undefined ? JSON.stringify(data) : undefined,
          }),
        );
      const challengeResponse = await browser("auth/device-challenge", "POST", {
        loginName: "synthetic-a",
        deviceId: device,
      });
      expect(challengeResponse.status).toBe(200);
      const challenge = await challengeResponse.json();
      const deviceProof = {
        ...challenge,
        signature: sign(
          "sha256",
          Buffer.from(
            deviceSignatureText(origin, "synthetic-a", device, challenge),
          ),
          { key: devicePair.privateKey, dsaEncoding: "ieee-p1363" },
        ).toString("base64url"),
      };
      const login = await browser("auth/login", "POST", {
        loginName: "synthetic-a",
        password: "synthetic-password",
        otp: code,
        deviceId: device,
        deviceProof,
      });
      expect(login.status).toBe(200);
      expect(await login.json()).toEqual({ signedIn: true });
      cookieHeader = login.headers.get("set-cookie")!.split(";")[0];
      const opaque = cookieHeader.split("=")[1];
      const csrfResponse = await browser("auth/csrf");
      expect(csrfResponse.status).toBe(200);
      const csrf = (await csrfResponse.json()) as {
        csrfToken: string;
        accountId: string;
      };
      expect(csrf.accountId).toBe(account);
      csrfValue = csrf.csrfToken;
      const token = await runtime.token(opaque);
      const identity = await runtime.authenticate(token.accessToken);
      expect(identity.accountId).toBe(account);
      runtime.assertCsrf(
        identity,
        "https://field.example.test",
        csrf.csrfToken,
      );
      expect(() =>
        runtime.assertCsrf(
          identity,
          "https://attacker.example.test",
          csrf.csrfToken,
        ),
      ).toThrow();
      const contextResponse = await browser("registration/context");
      expect(contextResponse.status).toBe(200);
      const drafting = await contextResponse.json();
      expect(drafting.accountId).toBe(account);
      expect(drafting.deviceId).toBe(device);
      expect(drafting.offlineUntil - drafting.verifiedAt).toBe(3600000);
      expect(drafting.deviceKeyFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(drafting)).not.toContain("accessToken");
      const locationsResponse = await browser("registration/geographies");
      expect(locationsResponse.status).toBe(200);
      const locations = (await locationsResponse.json()) as Array<{
        id: string;
        name: string;
      }>;
      expect(
        locations.some(
          (value) => value.id === "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
        ),
      ).toBe(true);
      const farmerId = "fd3151bd-8736-4540-bb6e-a083019906bc";
      const registration = {
        mutationId: "c8a85c92-740b-48d5-99d0-1cda6c4cd31c",
        farmer: {
          farmerId,
          geographyId: locations[0].id,
          fullName: "Synthetic runtime registration",
          privacyNoticeProvided: true,
        },
      };
      const registered = await browser(
        "farmers/register",
        "POST",
        registration,
      );
      expect(registered.status).toBe(200);
      expect(await registered.json()).toEqual({
        status: "synced",
        farmerId,
        replayed: false,
      });
      const dbName = vaultName(account, device);
      let outbox = new RegistrationOutbox(dbName);
      const fetcher: typeof fetch = async (path, init) =>
        handler(
          new Request(`https://field.example.test${String(path)}`, {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init?.headers)),
              origin,
              cookie: cookieHeader,
            },
          }),
        );
      const transport = new PilotClient(fetcher);
      const draft = {
        ...registration.farmer,
        farmerId: randomUUID(),
        fullName: "Synthetic offline retry",
      };
      try {
        await outbox.initialize("synthetic-offline-integration-passphrase");
        await outbox.writeContext(await transport.context());
        const mutation = await outbox.saveDraft(draft);
        await outbox.queue(mutation);
        let lost = true;
        const dropped: typeof fetch = async (path, init) => {
          const response = await fetcher(path, init);
          if (
            String(path).endsWith("farmers/register") &&
            response.ok &&
            lost
          ) {
            lost = false;
            throw new Error("Lost response after commit");
          }
          return response;
        };
        const retryClient = new PilotClient(dropped);
        await expect(
          outbox.syncPending((id, value) =>
            retryClient.sendRegistration(account, device, id, value),
          ),
        ).rejects.toMatchObject({ status: 503 });
        expect((await outbox.list())[0].status).toBe("pending-sync");
        const archive = await outbox.exportAuthenticatedArchive();
        outbox.close();
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(dbName);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
        outbox = new RegistrationOutbox(dbName);
        await outbox.initialize("synthetic-recovered-integration-passphrase");
        await outbox.writeContext(await transport.context());
        await outbox.importAuthenticatedArchive(
          archive,
          "synthetic-offline-integration-passphrase",
        );
        expect(await outbox.list()).toEqual([
          { id: mutation, status: "saved-on-device" },
        ]);
        await outbox.queue(mutation);
        await outbox.syncPending((id, value) =>
          transport.sendRegistration(account, device, id, value),
        );
        expect((await outbox.list())[0].status).toBe("synced");
        expect(
          (
            await client.query(
              "SELECT count(*)::int AS count FROM farm.farmer WHERE id=$1",
              [draft.farmerId],
            )
          ).rows[0].count,
        ).toBe(1);
        const denied = {
          ...draft,
          farmerId: randomUUID(),
          fullName: "Synthetic revoked coverage",
        };
        const deniedId = await outbox.saveDraft(denied);
        await outbox.queue(deniedId);
        await client.query(
          "UPDATE authz.assignment SET active=false WHERE account_id=$1",
          [account],
        );
        await outbox.syncPending((id, value) =>
          transport.sendRegistration(account, device, id, value),
        );
        expect(
          (await outbox.list()).find((row) => row.id === deniedId)?.status,
        ).toBe("rejected");
        expect(
          (
            await client.query(
              "SELECT count(*)::int AS count FROM farm.farmer WHERE id=$1",
              [denied.farmerId],
            )
          ).rows[0].count,
        ).toBe(0);
        await client.query(
          "UPDATE authz.assignment SET active=true WHERE account_id=$1",
          [account],
        );
      } finally {
        outbox.close();
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(dbName);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      }
      await client.query(
        "UPDATE authz.permission_grant SET active=false WHERE account_id=$1 AND permission='farmer.read'",
        [account],
      );
      // Creation alone never grants existing-record read access.
      const unreadable = await browser("farmers", "GET");
      expect(unreadable.status).toBe(200);
      expect(await unreadable.json()).toEqual({
        accountId: account,
        items: [],
        nextCursor: null,
      });
      const unavailable = await browser(`farmers/detail?id=${farmerId}`, "GET");
      const nonexistent = await browser(
        `farmers/detail?id=${randomUUID()}`,
        "GET",
      );
      expect(unavailable.status).toBe(404);
      expect(nonexistent.status).toBe(404);
      expect(await unavailable.json()).toEqual(await nonexistent.json());
      const readGrant = randomUUID();
      await client.query(
        `INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,geography_id,starts_at)
        SELECT $1,$2,organization_id,'farmer.read','assigned',id,now()-interval '1 hour' FROM farm.geography WHERE id=$3`,
        [readGrant, account, locations[0].id],
      );
      const hiddenId = randomUUID();
      const otherGeo = randomUUID();
      await client.query(
        "INSERT INTO farm.geography(id,organization_id,name) SELECT $1,organization_id,'Synthetic uncovered village' FROM farm.geography WHERE id=$2",
        [otherGeo, locations[0].id],
      );
      await client.query(
        "INSERT INTO farm.farmer(id,geography_id,full_name,privacy_notice_provided,registration_source,created_by) VALUES($1,$2,'Synthetic forbidden registry record',true,'administrator',$3)",
        [hiddenId, otherGeo, account],
      );
      const scopedConnection = new pg.Client({
        connectionString: mappings.agri_farmer_runtime,
      });
      await scopedConnection.connect();
      try {
        const labels = await new TransactionActorContext(
          Buffer.alloc(32, 42),
        ).run(scopedConnection, identity, (db) =>
          db.query(
            "SELECT farm.farmer_geography_name($1) AS visible, farm.farmer_geography_name($2) AS hidden",
            [locations[0].id, otherGeo],
          ),
        );
        expect(labels.rows[0]).toEqual({
          visible: locations[0].name,
          hidden: null,
        });
      } finally {
        await scopedConnection.end();
      }
      const pages = [];
      let after: string | null = null;
      do {
        const page = await browser(
          `farmers?limit=1${after ? `&after=${after}` : ""}`,
          "GET",
        );
        expect(page.status).toBe(200);
        const result = await page.json();
        expect(result.items.length).toBeLessThanOrEqual(1);
        pages.push(result);
        if (result.nextCursor)
          expect(result.nextCursor).toBe(result.items[0].id);
        after = result.nextCursor;
        expect(pages.length).toBeLessThan(20);
      } while (after);
      const visibleRows = pages.flatMap((page) => page.items);
      expect(new Set(visibleRows.map((row) => row.id)).size).toBe(
        visibleRows.length,
      );
      expect(visibleRows.some((row) => row.id === farmerId)).toBe(true);
      expect(JSON.stringify(pages)).not.toContain(hiddenId);
      expect(JSON.stringify(pages)).not.toContain(
        "Synthetic forbidden registry record",
      );
      expect(JSON.stringify(pages)).not.toContain(
        "Synthetic uncovered village",
      );
      expect(
        visibleRows.every((row) => row.geographyName === locations[0].name),
      ).toBe(true);
      expect(
        (await browser(`farmers/detail?id=${hiddenId}`, "GET")).status,
      ).toBe(404);
      const visible = await browser(`farmers/detail?id=${farmerId}`, "GET");
      expect(visible.status).toBe(200);
      expect((await visible.json()).farmer.fullName).toBe(
        registration.farmer.fullName,
      );
      expect((await browser("farmers?limit=101", "GET")).status).toBe(400);
      expect(
        (await browser(`farmers?accountId=${account}`, "GET")).status,
      ).toBe(400);
      const verification = {
        mutationId: randomUUID(),
        farmerId,
        expectedVersion: 1,
        action: "verification",
        reason: "Synthetic record reviewed in person",
      };
      expect(
        (await browser("farmers/change", "POST", verification)).status,
      ).toBe(403);
      const rawChanges = new pg.Client({
        connectionString: mappings.agri_farmer_runtime,
      });
      await rawChanges.connect();
      try {
        const signed = new TransactionActorContext(Buffer.alloc(32, 42));
        await expect(
          signed.run(rawChanges, identity, (db) =>
            db.query(
              "SELECT * FROM farm.change_farmer($1,$2,1,'verification',NULL,NULL,'Synthetic native denied review')",
              [randomUUID(), farmerId],
            ),
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          signed.run(rawChanges, identity, (db) =>
            db.query("SELECT * FROM farm.farmer_change", []),
          ),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await rawChanges.end();
      }
      expect(
        (await browser(`farmers/verification-receipt?id=${farmerId}`, "GET"))
          .status,
      ).toBe(403);
      expect(
        await (await browser("farmers?reviewable=true", "GET")).json(),
      ).toEqual({
        accountId: account,
        filters: { reviewable: "true" },
        items: [],
        nextCursor: null,
      });
      const statusFixtures = new Map<string, string>();
      for (const state of ["draft", "pending-review", "verified", "inactive"]) {
        const id = randomUUID();
        statusFixtures.set(state, id);
        await client.query(
          "INSERT INTO farm.farmer(id,geography_id,full_name,privacy_notice_provided,registration_source,created_by,status) VALUES($1,$2,$3,true,'administrator',$4,$5)",
          [id, locations[0].id, `Synthetic queue ${state}`, account, state],
        );
      }
      for (const [state, id] of statusFixtures) {
        const response = await browser(`farmers?status=${state}`, "GET");
        expect(response.status).toBe(200);
        const page = await response.json();
        expect(page.filters).toEqual({ status: state });
        expect(page.items.some((row: { id: string }) => row.id === id)).toBe(
          true,
        );
        expect(
          page.items.every((row: { status: string }) => row.status === state),
        ).toBe(true);
        expect(JSON.stringify(page)).not.toContain(hiddenId);
        expect("total" in page).toBe(false);
      }
      for (const id of statusFixtures.values()) {
        await client.query("DELETE FROM farm.farmer_audit WHERE farmer_id=$1", [
          id,
        ]);
        await client.query("DELETE FROM farm.farmer WHERE id=$1", [id]);
      }
      for (const query of [
        "status=unknown",
        "reviewable=false",
        "status=verified&reviewable=true",
        "status=draft&status=verified",
      ])
        expect((await browser(`farmers?${query}`, "GET")).status).toBe(400);
      expect(
        (await browser(`farmers/correction-geographies?id=${farmerId}`, "GET"))
          .status,
      ).toBe(403);
      const verifyGrant = randomUUID(),
        correctGrant = randomUUID();
      await client.query(
        `INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,geography_id,starts_at)
        SELECT $1,$2,organization_id,'farmer.verify','assigned',id,now()-interval '1 hour' FROM farm.geography WHERE id=$3`,
        [verifyGrant, account, locations[0].id],
      );
      expect(
        (await (await browser(`farmers/detail?id=${farmerId}`, "GET")).json())
          .access.verify,
      ).toBe(true);
      expect(
        await (
          await browser(`farmers/verification-receipt?id=${farmerId}`, "GET")
        ).json(),
      ).toEqual({ accountId: account, farmerId, receipt: null });
      const reviewPages = [];
      let reviewCursor: string | null = null;
      do {
        const response = await browser(
          `farmers?limit=1&status=pending-review&reviewable=true${reviewCursor ? `&after=${reviewCursor}` : ""}`,
          "GET",
        );
        expect(response.status).toBe(200);
        const page = await response.json();
        expect(page.filters).toEqual({
          status: "pending-review",
          reviewable: "true",
        });
        expect(page.items.length).toBeLessThanOrEqual(1);
        expect(
          page.items.every(
            (row: { status: string }) => row.status === "pending-review",
          ),
        ).toBe(true);
        reviewPages.push(page);
        reviewCursor = page.nextCursor;
        expect(reviewPages.length).toBeLessThan(20);
      } while (reviewCursor);
      expect(
        reviewPages
          .flatMap((page) => page.items)
          .some((row) => row.id === farmerId),
      ).toBe(true);
      expect(JSON.stringify(reviewPages)).not.toContain(hiddenId);
      expect(
        (await browser(`farmers/correction-geographies?id=${farmerId}`, "GET"))
          .status,
      ).toBe(403);
      const verified = await browser("farmers/change", "POST", verification);
      expect(verified.status).toBe(200);
      expect(await verified.json()).toEqual({
        farmerId,
        version: 2,
        replayed: false,
        duplicateRisk: false,
      });
      const pendingAfterVerification = await (
        await browser("farmers?status=pending-review&reviewable=true", "GET")
      ).json();
      expect(
        pendingAfterVerification.items.some(
          (row: { id: string }) => row.id === farmerId,
        ),
      ).toBe(false);
      expect(
        (
          await (await browser("farmers?status=verified", "GET")).json()
        ).items.some((row: { id: string }) => row.id === farmerId),
      ).toBe(true);
      const ownReceipt = await (
        await browser(`farmers/verification-receipt?id=${farmerId}`, "GET")
      ).json();
      expect(ownReceipt).toMatchObject({
        accountId: account,
        farmerId,
        receipt: { mutationId: verification.mutationId, version: 2 },
      });
      expect(ownReceipt.receipt.occurredAt).toMatch(/\.\d{6}Z$/);
      expect(Object.keys(ownReceipt.receipt).sort()).toEqual([
        "mutationId",
        "occurredAt",
        "version",
      ]);
      // Inject a synthetic other-actor journal fixture, then remove it before subsequent assertions.
      const otherReceipt = randomUUID();
      await client.query(
        `INSERT INTO farm.farmer_change SELECT $1,farmer_id,$2,session_id,action,reason,payload_mac,previous_version,result_version,previous_name,result_name,previous_geography,result_geography,previous_status,result_status,duplicate_risk,occurred_at+interval '1 second' FROM farm.farmer_change WHERE id=$3`,
        [otherReceipt, another, verification.mutationId],
      );
      expect(
        await (
          await browser(`farmers/verification-receipt?id=${farmerId}`, "GET")
        ).json(),
      ).toEqual(ownReceipt);
      await client.query("DELETE FROM farm.farmer_change WHERE id=$1", [
        otherReceipt,
      ]);
      await client.query(
        "UPDATE farm.farmer_change SET previous_geography=$1,result_geography=$1 WHERE id=$2",
        [otherGeo, verification.mutationId],
      );
      expect(
        await (
          await browser(`farmers/verification-receipt?id=${farmerId}`, "GET")
        ).json(),
      ).toEqual({ accountId: account, farmerId, receipt: null });
      await client.query(
        "UPDATE farm.farmer_change SET previous_geography=$1,result_geography=$1 WHERE id=$2",
        [locations[0].id, verification.mutationId],
      );
      expect(
        (await browser(`farmers/verification-receipt?id=${hiddenId}`, "GET"))
          .status,
      ).toBe(404);
      expect(
        (
          await browser(
            `farmers/verification-receipt?id=${randomUUID()}`,
            "GET",
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await browser(
            `farmers/verification-receipt?id=${farmerId}&accountId=${another}`,
            "GET",
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await browser(
            `farmers/verification-receipt?id=${farmerId}&id=${farmerId}`,
            "GET",
          )
        ).status,
      ).toBe(400);
      expect(
        await (await browser("farmers/change", "POST", verification)).json(),
      ).toEqual({ farmerId, version: 2, replayed: true, duplicateRisk: false });
      expect(
        (
          await browser("farmers/change", "POST", {
            ...verification,
            reason: "Synthetic changed retry reason",
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await browser("farmers/change", "POST", {
            ...verification,
            mutationId: randomUUID(),
          })
        ).status,
      ).toBe(409);
      expect(
        (await browser(`farmers/correction-receipt?id=${farmerId}`, "GET"))
          .status,
      ).toBe(403);
      await client.query(
        `INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,geography_id,starts_at)
        SELECT $1,$2,organization_id,'farmer.correct','assigned',id,now()-interval '1 hour' FROM farm.geography WHERE id=$3`,
        [correctGrant, account, locations[0].id],
      );
      expect(
        (await (await browser(`farmers/detail?id=${farmerId}`, "GET")).json())
          .access.correct,
      ).toBe(true);
      await verifyCorrectionOptions({
        owner: client,
        browser,
        accountId: account,
        farmerId,
        sourceGeographyId: locations[0].id,
        sourceCorrectGrant: correctGrant,
        actor: identity,
        runtimeUrl: mappings.agri_farmer_runtime,
      });
      for (const query of [
        "limit=101",
        "limit=0",
        `accountId=${another}`,
        `id=${farmerId}`,
        "source=administrator",
      ])
        expect(
          (
            await browser(
              `farmers/correction-geographies?id=${farmerId}&${query}`,
              "GET",
            )
          ).status,
        ).toBe(400);
      expect(
        (await browser(`farmers/correction-geographies?id=${hiddenId}`, "GET"))
          .status,
      ).toBe(404);
      expect(
        (
          await browser(
            `farmers/correction-geographies?id=${randomUUID()}`,
            "GET",
          )
        ).status,
      ).toBe(404);
      const rawUpdate = new pg.Client({
        connectionString: mappings.agri_farmer_runtime,
      });
      await rawUpdate.connect();
      try {
        await expect(
          new TransactionActorContext(Buffer.alloc(32, 42)).run(
            rawUpdate,
            identity,
            (db) =>
              db.query(
                "UPDATE farm.farmer SET full_name='Synthetic bypass attempt' WHERE id=$1",
                [farmerId],
              ),
          ),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await rawUpdate.end();
      }
      expect(
        await (
          await browser(`farmers/correction-receipt?id=${farmerId}`, "GET")
        ).json(),
      ).toEqual({ accountId: account, farmerId, receipt: null });
      for (const query of [
        `id=${farmerId}&accountId=${another}`,
        `id=${farmerId}&id=${farmerId}`,
      ])
        expect(
          (await browser(`farmers/correction-receipt?${query}`, "GET")).status,
        ).toBe(400);
      for (const id of [hiddenId, randomUUID()])
        expect(
          (await browser(`farmers/correction-receipt?id=${id}`, "GET")).status,
        ).toBe(404);
      const correction = {
        mutationId: randomUUID(),
        farmerId,
        expectedVersion: 2,
        action: "correction",
        fullName: "Synthetic corrected farmer",
        geographyId: locations[0].id,
        reason: "Synthetic spelling correction following review",
      };
      expect(
        (
          await browser("farmers/change", "POST", {
            ...correction,
            geographyId: otherGeo,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await browser("farmers/change", "POST", {
            ...correction,
            creatorId: account,
          })
        ).status,
      ).toBe(400);
      expect(
        await (await browser("farmers/change", "POST", correction)).json(),
      ).toEqual({
        farmerId,
        version: 3,
        replayed: false,
        duplicateRisk: false,
      });
      expect(
        (
          await client.query(
            "SELECT version,status,created_by FROM farm.farmer WHERE id=$1",
            [farmerId],
          )
        ).rows[0],
      ).toEqual({ version: 3, status: "pending-review", created_by: account });
      expect(
        await (
          await browser(`farmers/verification-receipt?id=${farmerId}`, "GET")
        ).json(),
      ).toEqual(ownReceipt);
      expect(
        (
          await (
            await browser(
              `farmers/correction-geographies?id=${farmerId}`,
              "GET",
            )
          ).json()
        ).farmerVersion,
      ).toBe(3);
      await verifyCorrectionReceipt({
        owner: client,
        browser,
        accountId: account,
        otherAccountId: another,
        farmerId,
        mutationId: correction.mutationId,
        correctGrant,
        verifyGrant,
        geographyId: locations[0].id,
        hiddenGeographyId: otherGeo,
        actor: identity,
        runtimeUrl: mappings.agri_farmer_runtime,
      });
      const changeAudit = await client.query(
        "SELECT actor_id,session_id,action,previous_version,result_version,previous_status,result_status FROM farm.farmer_change WHERE farmer_id=$1 ORDER BY result_version",
        [farmerId],
      );
      expect(changeAudit.rows).toEqual([
        {
          actor_id: account,
          session_id: identity.sessionId,
          action: "verification",
          previous_version: 1,
          result_version: 2,
          previous_status: "pending-review",
          result_status: "verified",
        },
        {
          actor_id: account,
          session_id: identity.sessionId,
          action: "correction",
          previous_version: 2,
          result_version: 3,
          previous_status: "verified",
          result_status: "pending-review",
        },
      ]);
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM farm.farmer_audit WHERE farmer_id=$1",
            [farmerId],
          )
        ).rows[0].n,
      ).toBe(3);
      const duplicateName = visibleRows.find(
        (row) => row.id !== farmerId,
      )!.fullName;
      const duplicateChange = {
        ...correction,
        mutationId: randomUUID(),
        expectedVersion: 3,
        fullName: duplicateName,
      };
      expect(
        await (await browser("farmers/change", "POST", duplicateChange)).json(),
      ).toEqual({ farmerId, version: 4, replayed: false, duplicateRisk: true });
      const failureChange = {
        ...correction,
        mutationId: randomUUID(),
        expectedVersion: 4,
        fullName: "Synthetic audit failure retry",
      };
      await client.query(
        "CREATE FUNCTION farm.test_fail_change_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='correction' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail_change_audit BEFORE INSERT ON farm.farmer_audit FOR EACH ROW EXECUTE FUNCTION farm.test_fail_change_audit()",
      );
      try {
        expect(
          (await browser("farmers/change", "POST", failureChange)).status,
        ).toBe(503);
        expect(
          (
            await client.query("SELECT version FROM farm.farmer WHERE id=$1", [
              farmerId,
            ])
          ).rows[0].version,
        ).toBe(4);
        expect(
          (
            await client.query(
              "SELECT id FROM farm.farmer_change WHERE id=$1",
              [failureChange.mutationId],
            )
          ).rowCount,
        ).toBe(0);
      } finally {
        await client.query(
          "DROP TRIGGER test_fail_change_audit ON farm.farmer_audit; DROP FUNCTION farm.test_fail_change_audit()",
        );
      }
      expect(
        await (await browser("farmers/change", "POST", failureChange)).json(),
      ).toEqual({
        farmerId,
        version: 5,
        replayed: false,
        duplicateRisk: false,
      });
      const competing = await Promise.all(
        ["Synthetic competing one", "Synthetic competing two"].map((fullName) =>
          browser("farmers/change", "POST", {
            ...correction,
            mutationId: randomUUID(),
            expectedVersion: 5,
            fullName,
          }),
        ),
      );
      expect(competing.map((result) => result.status).sort()).toEqual([
        200, 409,
      ]);
      expect(
        (
          await client.query("SELECT version FROM farm.farmer WHERE id=$1", [
            farmerId,
          ])
        ).rows[0].version,
      ).toBe(6);
      await client.query(
        "UPDATE farm.farmer SET status='inactive' WHERE id=$1",
        [farmerId],
      );
      const inactiveCorrection = {
        ...correction,
        mutationId: randomUUID(),
        expectedVersion: 6,
        fullName: "Synthetic inactive correction",
      };
      expect(
        (await browser("farmers/change", "POST", inactiveCorrection)).status,
      ).toBe(200);
      expect(
        (
          await client.query(
            "SELECT status,version FROM farm.farmer WHERE id=$1",
            [farmerId],
          )
        ).rows[0],
      ).toEqual({ status: "inactive", version: 7 });
      expect(
        (
          await browser("farmers/change", "POST", {
            ...verification,
            mutationId: randomUUID(),
            expectedVersion: 7,
          })
        ).status,
      ).toBe(409);
      await client.query(
        "UPDATE authz.permission_grant SET active=false WHERE id=$1",
        [correctGrant],
      );
      expect(
        (await browser("farmers/change", "POST", failureChange)).status,
      ).toBe(403);
      expect(
        (await browser(`farmers/history?id=${farmerId}`, "GET")).status,
      ).toBe(403);
      const nativeHistory = new pg.Client({
        connectionString: mappings.agri_farmer_runtime,
      });
      await nativeHistory.connect();
      try {
        const signed = new TransactionActorContext(Buffer.alloc(32, 42));
        await expect(
          signed.run(nativeHistory, identity, (db) =>
            db.query("SELECT * FROM farm.farmer_history($1,NULL,NULL,25)", [
              farmerId,
            ]),
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          signed.run(nativeHistory, identity, (db) =>
            db.query("SELECT * FROM farm.farmer_audit", []),
          ),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await nativeHistory.end();
      }
      await client.query(
        "UPDATE authz.permission_grant SET active=false WHERE id=$1",
        [verifyGrant],
      );
      expect(
        (await browser(`farmers/verification-receipt?id=${farmerId}`, "GET"))
          .status,
      ).toBe(403);
      expect(
        await (await browser("farmers?reviewable=true", "GET")).json(),
      ).toEqual({
        accountId: account,
        filters: { reviewable: "true" },
        items: [],
        nextCursor: null,
      });
      expect(
        (await browser(`farmers/correction-geographies?id=${farmerId}`, "GET"))
          .status,
      ).toBe(403);
      expect(
        (await browser(`farmers/correction-receipt?id=${farmerId}`, "GET"))
          .status,
      ).toBe(403);
      const rawReceipt = new pg.Client({
        connectionString: mappings.agri_farmer_runtime,
      });
      await rawReceipt.connect();
      try {
        await expect(
          rawReceipt.query("SELECT * FROM farm.latest_own_verification($1)", [
            farmerId,
          ]),
        ).rejects.toMatchObject({ code: "42501" });
        const signed = new TransactionActorContext(Buffer.alloc(32, 42));
        await expect(
          signed.run(rawReceipt, identity, (db) =>
            db.query("SELECT * FROM farm.latest_own_correction($1)", [
              farmerId,
            ]),
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          signed.run(rawReceipt, identity, (db) =>
            db.query("SELECT * FROM farm.latest_own_verification($1)", [
              farmerId,
            ]),
          ),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await rawReceipt.end();
      }
      const auditGrant = randomUUID();
      await client.query(
        `INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,geography_id,starts_at)
        SELECT $1,$2,organization_id,'farmer.audit.read','assigned',id,now()-interval '1 hour' FROM farm.geography WHERE id=$3`,
        [auditGrant, account, locations[0].id],
      );
      expect(
        (await (await browser(`farmers/detail?id=${farmerId}`, "GET")).json())
          .access,
      ).toEqual({ viewAudit: true, verify: false, correct: false });
      const auditOnly = new pg.Client({ connectionString: url });
      await auditOnly.connect();
      try {
        await auditOnly.query("SET SESSION AUTHORIZATION agri_policy_owner");
        const signed = new TransactionActorContext(Buffer.alloc(32, 42));
        await expect(
          signed.run(auditOnly, identity, (db) =>
            db.query(
              "UPDATE farm.farmer SET full_name='Synthetic audit-only bypass' WHERE id=$1",
              [farmerId],
            ),
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          signed.run(auditOnly, identity, (db) =>
            db.query(
              "SELECT * FROM farm.change_farmer($1,$2,7,'verification',NULL,NULL,'Synthetic audit-only review attempt')",
              [randomUUID(), farmerId],
            ),
          ),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await auditOnly.end();
      }
      // Distinct microseconds inside one millisecond, plus timestamp ties, must not skip events.
      await client.query(
        `WITH ordered AS (SELECT id,row_number() OVER(ORDER BY id) AS n FROM farm.farmer_audit WHERE farmer_id=$1)
        UPDATE farm.farmer_audit a SET occurred_at='2026-11-15T12:00:00.123456Z'::timestamptz+((o.n/2)::integer)*interval '1 microsecond' FROM ordered o WHERE a.id=o.id`,
        [farmerId],
      );
      const expectedEvents = (
        await client.query(
          "SELECT id FROM farm.farmer_audit WHERE farmer_id=$1 ORDER BY occurred_at DESC,id DESC",
          [farmerId],
        )
      ).rows.map((row) => row.id);
      const historyEvents = [];
      let historyCursor: { beforeTime: string; beforeId: string } | null = null;
      do {
        const params = new URLSearchParams({
          id: farmerId,
          limit: "1",
          ...(historyCursor ?? {}),
        });
        const response = await browser(`farmers/history?${params}`, "GET");
        expect(response.status).toBe(200);
        const page = await response.json();
        expect(page.accountId).toBe(account);
        expect(page.farmerId).toBe(farmerId);
        historyEvents.push(...page.items);
        historyCursor = page.nextCursor;
        if (historyCursor) {
          expect(historyCursor.beforeTime).toMatch(/\.\d{6}Z$/);
          expect(historyCursor.beforeId).toBe(page.items[0].eventId);
        }
        expect(historyEvents.length).toBeLessThan(20);
      } while (historyCursor);
      expect(historyEvents.map((event) => event.eventId)).toEqual(
        expectedEvents,
      );
      expect(new Set(historyEvents.map((event) => event.eventId)).size).toBe(
        expectedEvents.length,
      );
      expect(
        historyEvents.find((event) => event.action === "registration").change,
      ).toBeNull();
      expect(
        historyEvents.find((event) => event.change?.resultVersion === 3).change
          .previous.fullName,
      ).toBe(registration.farmer.fullName);
      expect(JSON.stringify(historyEvents)).not.toContain(identity.sessionId);
      const hiddenEvent = (
        await client.query(
          "SELECT id FROM farm.farmer_audit WHERE change_id=$1",
          [correction.mutationId],
        )
      ).rows[0].id;
      await client.query(
        "UPDATE farm.farmer_change SET previous_geography=$1,previous_name='Synthetic restricted historical name' WHERE id=$2",
        [otherGeo, correction.mutationId],
      );
      const filteredHistory = await (
        await browser(`farmers/history?id=${farmerId}`, "GET")
      ).json();
      expect(filteredHistory.items).toHaveLength(expectedEvents.length - 1);
      expect(JSON.stringify(filteredHistory)).not.toContain(
        "Synthetic restricted historical name",
      );
      expect(JSON.stringify(filteredHistory)).not.toContain(hiddenEvent);
      expect(filteredHistory.nextCursor).toBeNull();
      const oldAssignment = randomUUID();
      await client.query(
        "INSERT INTO authz.assignment(id,account_id,organization_id,geography_id,starts_at) SELECT $1,$2,organization_id,id,now()-interval '1 hour' FROM farm.geography WHERE id=$3",
        [oldAssignment, account, otherGeo],
      );
      for (const permission of ["farmer.read", "farmer.audit.read"])
        await client.query(
          "INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,geography_id,starts_at) SELECT gen_random_uuid(),$1,organization_id,$2,'assigned',id,now()-interval '1 hour' FROM farm.geography WHERE id=$3",
          [account, permission, otherGeo],
        );
      expect(
        JSON.stringify(
          await (await browser(`farmers/history?id=${farmerId}`, "GET")).json(),
        ),
      ).toContain("Synthetic restricted historical name");
      await client.query(
        "UPDATE authz.assignment SET active=false WHERE id=$1",
        [oldAssignment],
      );
      expect(
        JSON.stringify(
          await (await browser(`farmers/history?id=${farmerId}`, "GET")).json(),
        ),
      ).not.toContain("Synthetic restricted historical name");
      expect(
        (await browser(`farmers/history?id=${hiddenId}`, "GET")).status,
      ).toBe(404);
      expect(
        (await browser(`farmers/history?id=${randomUUID()}`, "GET")).status,
      ).toBe(404);
      expect(
        (
          await browser(
            `farmers/history?id=${farmerId}&beforeId=${randomUUID()}`,
            "GET",
          )
        ).status,
      ).toBe(400);
      expect(
        (await browser(`farmers/history?id=${farmerId}&limit=101`, "GET"))
          .status,
      ).toBe(400);
      await client.query(
        "UPDATE authz.permission_grant SET active=false WHERE id=$1",
        [auditGrant],
      );
      expect(
        (await browser(`farmers/history?id=${farmerId}`, "GET")).status,
      ).toBe(403);
      expect(
        (await (await browser(`farmers/detail?id=${farmerId}`, "GET")).json())
          .access,
      ).toMatchObject({ viewAudit: false });
      await verifyProjectCatalog({
        owner: client,
        actor: identity,
        geographyId: locations[0].id,
        runtimeUrl: mappings.agri_project_runtime,
        runtimeEnv: env,
        browser: (path, method, body) =>
          browser(path, method, body, "administrator"),
        fieldBrowser: browser,
      });
      await verifyLandIdentification({
        owner: client,
        actor: identity,
        geographyId: locations[0].id,
        otherGeographyId: otherGeo,
        databaseUrl: url!,
        runtimeUrl: mappings.agri_land_runtime,
        runtimeEnv: env,
        browser,
      });
      await client.query(
        "UPDATE authz.permission_grant SET active=false WHERE id=$1",
        [readGrant],
      );
      expect(await (await browser("farmers", "GET")).json()).toEqual({
        accountId: account,
        items: [],
        nextCursor: null,
      });
      expect(
        (await browser(`farmers/detail?id=${farmerId}`, "GET")).status,
      ).toBe(404);
      expect(
        (await browser(`farmers/history?id=${farmerId}`, "GET")).status,
      ).toBe(404);
      expect(
        (await browser(`farmers/verification-receipt?id=${farmerId}`, "GET"))
          .status,
      ).toBe(404);
      expect(
        (await browser(`farmers/correction-geographies?id=${farmerId}`, "GET"))
          .status,
      ).toBe(404);
      expect(
        (await browser(`farmers/correction-receipt?id=${farmerId}`, "GET"))
          .status,
      ).toBe(404);
      const logout = await browser("auth/logout", "POST");
      expect(logout.status).toBe(200);
      expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
      await expect(runtime.authenticate(token.accessToken)).rejects.toThrow();
      await expect(runtime.token(opaque)).rejects.toThrow();
    } finally {
      await app?.close();
      await runtime.close();
    }
  }, 30000);

  it("enrolls only the operator-selected account/device and never replaces an enrolled key", async () => {
    const deviceId = randomUUID();
    const pendingDevice = randomUUID();
    await client.query(
      "INSERT INTO authn.device(id,account_id,state) VALUES($1,$2,'pending')",
      [pendingDevice, account],
    );
    await client.query(
      "INSERT INTO authn.device(id,account_id,state,approved_at) VALUES($1,$2,'approved',clock_timestamp())",
      [deviceId, account],
    );
    const publicKey = deviceJwk;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          crv: publicKey.crv,
          kty: publicKey.kty,
          x: publicKey.x,
          y: publicKey.y,
        }),
      )
      .digest("hex");
    const request = { version: 1, origin, deviceId, publicKey, fingerprint };
    await expect(assertProvisioner(client)).rejects.toThrow("least-privilege");
    await client.query("SET SESSION AUTHORIZATION agri_device_provisioner");
    try {
      await assertProvisioner(client);
      await expect(
        client.query(
          "INSERT INTO authn.device_key(id,device_id,account_id,public_jwk) VALUES($1,$2,$3,$4)",
          [randomUUID(), pendingDevice, account, deviceJwk],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        client.query("SELECT password_hash FROM authn.account"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        enrollDevice(client, request, {
          accountId: another,
          origin,
          fingerprint,
        }),
      ).rejects.toThrow("approved device");
      await expect(
        enrollDevice(client, request, {
          accountId: account,
          origin,
          fingerprint: "0".repeat(64),
        }),
      ).rejects.toThrow("fingerprint");
      expect(
        await enrollDevice(client, request, {
          accountId: account,
          origin,
          fingerprint,
        }),
      ).toBe("enrolled");
      expect(
        await enrollDevice(client, request, {
          accountId: account,
          origin,
          fingerprint,
        }),
      ).toBe("already-enrolled");
      const other = generateKeyPairSync("ec", {
        namedCurve: "prime256v1",
      }).publicKey.export({ format: "jwk" });
      const otherFingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            crv: other.crv,
            kty: other.kty,
            x: other.x,
            y: other.y,
          }),
        )
        .digest("hex");
      await expect(
        enrollDevice(
          client,
          { ...request, publicKey: other, fingerprint: otherFingerprint },
          { accountId: account, origin, fingerprint: otherFingerprint },
        ),
      ).rejects.toThrow("cannot be replaced");
      expect(await revokeDevice(client, { accountId: account, deviceId })).toBe(
        "revoked",
      );
      expect(await revokeDevice(client, { accountId: account, deviceId })).toBe(
        "already-revoked",
      );
    } finally {
      await client.query("RESET SESSION AUTHORIZATION");
    }
    expect(
      (
        await client.query(
          "SELECT kind FROM authn.device_key_event e JOIN authn.device_key k ON k.id=e.key_id WHERE k.device_id=$1 ORDER BY e.created_at",
          [deviceId],
        )
      ).rows.map((row) => row.kind),
    ).toEqual(["enrolled", "revoked"]);
  });
  it("expires device assertions after an account-lock wait and rolls back session plus audit", async () => {
    const assertion = randomUUID();
    const sessionId = randomUUID();
    const event = randomUUID();
    await client.query(
      "INSERT INTO authn.device_assertion(id,account_id,device_id,key_id,challenge_hash,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 second')",
      [assertion, account, device, keyId, Buffer.alloc(32, 33)],
    );
    const worker = new pg.Client({ connectionString: url });
    await worker.connect();
    let pending:
      | Promise<{ error?: { code?: string }; value?: pg.QueryResult }>
      | undefined;
    try {
      const pid = (await worker.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid;
      await worker.query("SET SESSION AUTHORIZATION agri_session_issuer");
      await client.query("BEGIN");
      await client.query(
        "SELECT id FROM authn.account WHERE id=$1 FOR UPDATE",
        [account],
      );
      pending = worker
        .query(
          "SELECT authn.issue_device_session($1,$2,$3,$4,true,$5,60,3600,$6) AS ok",
          [sessionId, event, account, device, Buffer.alloc(32, 34), assertion],
        )
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      let blocked = false;
      for (let i = 0; i < 40; i++) {
        if (
          (
            await client.query(
              "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
              [pid],
            )
          ).rows[0]?.wait_event_type === "Lock"
        ) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await client.query("COMMIT");
      expect((await pending).error?.code).toBe("42501");
      expect(
        (
          await client.query("SELECT id FROM authn.login_session WHERE id=$1", [
            sessionId,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await client.query(
            "SELECT id FROM authn.session_issuance_event WHERE id=$1",
            [event],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await client.query(
            "SELECT used_at FROM authn.device_assertion WHERE id=$1",
            [assertion],
          )
        ).rows[0].used_at,
      ).toBeNull();
    } finally {
      await client.query("ROLLBACK");
      if (pending) await pending;
      await worker.end();
    }
  }, 15000);
  it("consumes one assertion once under concurrency and device key revocation blocks existing sessions and RLS", async () => {
    const assertion = randomUUID();
    await client.query(
      "INSERT INTO authn.device_assertion(id,account_id,device_id,key_id,challenge_hash,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '25 seconds')",
      [assertion, account, device, keyId, Buffer.alloc(32, 35)],
    );
    const first = new pg.Client({ connectionString: url });
    const second = new pg.Client({ connectionString: url });
    await Promise.all([first.connect(), second.connect()]);
    const sessions = [randomUUID(), randomUUID()];
    const hashes = [Buffer.alloc(32, 36), Buffer.alloc(32, 37)];
    try {
      await Promise.all([
        first.query("SET SESSION AUTHORIZATION agri_session_issuer"),
        second.query("SET SESSION AUTHORIZATION agri_session_issuer"),
      ]);
      const results = await Promise.all(
        [first, second].map((worker, i) =>
          worker.query(
            "SELECT authn.issue_device_session($1,$2,$3,$4,true,$5,60,3600,$6) AS ok",
            [sessions[i], randomUUID(), account, device, hashes[i], assertion],
          ),
        ),
      );
      expect(results.map((result) => result.rows[0].ok).sort()).toEqual([
        false,
        true,
      ]);
      const winner = results.findIndex((result) => result.rows[0].ok);
      await first.query("RESET SESSION AUTHORIZATION");
      await first.query("SET SESSION AUTHORIZATION agri_session_executor");
      expect(
        (
          await first.query("SELECT * FROM authn.use_session($1,60)", [
            hashes[winner],
          ])
        ).rowCount,
      ).toBe(1);
      await client.query(
        "UPDATE authn.device_key SET revoked_at=clock_timestamp() WHERE id=$1",
        [keyId],
      );
      expect(
        (
          await first.query("SELECT * FROM authn.use_session($1,60)", [
            hashes[winner],
          ])
        ).rowCount,
      ).toBe(0);
      await first.query("RESET SESSION AUTHORIZATION");
      await first.query("SET SESSION AUTHORIZATION agri_farmer_runtime");
      const context = new TransactionActorContext(Buffer.alloc(32, 42));
      const actor = await context.run(
        first,
        { accountId: account, sessionId: sessions[winner] },
        async (db) =>
          (await db.query("SELECT authz.actor() AS actor", [])).rows[0].actor,
      );
      expect(actor).toBeNull();
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  }, 15000);
});
