// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { PostgresSessionReader } from "../apps/api/src/authentication/postgres-session-reader";
import { SessionAccess } from "../apps/api/src/authentication/session-access";
import { PostgresSessionOperations } from "../apps/api/src/authentication/postgres-session-operations";
import { digestSessionSecret } from "../apps/api/src/authentication/session-cookie";
import { PostgresMfaVerifier } from "../apps/api/src/authentication/postgres-mfa-verifier";
import { encryptMfaSecret } from "../apps/api/src/authentication/mfa-secret";

const url = process.env.DATABASE_TEST_URL;
const suite = url ? describe : describe.skip;
const account = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const another = "334c8b84-4815-4e92-8103-237a15130f88";
const device = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const session = "11b492ca-bcb4-4662-91d9-88789a80a0c2";
let client: pg.Client;

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
      "INSERT INTO authn.account (id, login_name, password_hash) VALUES ($1, 'synthetic-a', '$argon2id$test'), ($2, 'synthetic-b', '$argon2id$test')",
      [account, another],
    );
    await client.query(
      "INSERT INTO authn.device (id, account_id, state, approved_at) VALUES ($1, $2, 'approved', now())",
      [device, account],
    );
  });
  afterAll(async () => {
    if (client) {
      await client.query("ROLLBACK");
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
  it("rejects revocation events associated with another account's device", async () => {
    await expectDenied(
      "INSERT INTO authn.revocation_event (id,target_account_id,device_id,kind) VALUES (gen_random_uuid(),$1,$2,'device')",
      [another, device],
      "23503",
    );
  });
});
