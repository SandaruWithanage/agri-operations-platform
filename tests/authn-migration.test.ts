// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

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
  it("rejects revocation events associated with another account's device", async () => {
    await expectDenied(
      "INSERT INTO authn.revocation_event (id,target_account_id,device_id,kind) VALUES (gen_random_uuid(),$1,$2,'device')",
      [another, device],
      "23503",
    );
  });
});
