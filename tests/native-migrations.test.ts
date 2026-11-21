// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import pg from "pg";
import {
  loadMigrations,
  runMigrations,
  validateTransactionalSql,
} from "../scripts/native-migrations.mjs";

it("loads the explicit dependency order and rejects transaction-control SQL outside quoted bodies", async () => {
  const migrations = await loadMigrations();
  expect(migrations).toHaveLength(28);
  expect(migrations[1].id).toBe(
    "20261115_authn_foundation/session-reader-grants.sql",
  );
  for (const sql of [
    "COMMIT",
    "-- comment\nBEGIN;",
    "SELECT 1; /*outer /*inner*/ */ ROLLBACK;",
    "END;",
    "START TRANSACTION;",
  ])
    expect(() => validateTransactionalSql(sql)).toThrow(
      "must not control transactions",
    );
  expect(() =>
    validateTransactionalSql(
      "CREATE FUNCTION f() RETURNS void AS $fn$ BEGIN RETURN; END $fn$ LANGUAGE plpgsql; SELECT 'COMMIT;';",
    ),
  ).not.toThrow();
  expect(() => validateTransactionalSql("SELECT '\\'; COMMIT;")).toThrow();
  expect(() => validateTransactionalSql("/* open")).toThrow();
});

const url = process.env.DATABASE_TEST_URL;
const suite = url ? describe : describe.skip;
const schemas: string[] = [];
const connections: pg.Client[] = [];
async function connection() {
  if (!url || new URL(url).pathname !== "/agri_test")
    throw new Error("Requires dedicated agri_test database");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  connections.push(client);
  return client;
}
function fixture() {
  const history = `migration_test_${randomUUID().replaceAll("-", "")}`;
  const data = `migration_data_${randomUUID().replaceAll("-", "")}`;
  schemas.push(history, data);
  return {
    history,
    data,
    options: { apply: true, metadataSchema: history, protectedSchemas: [data] },
  };
}
function migration(id: string, sql: string) {
  return { id, sql, checksum: createHash("sha256").update(sql).digest("hex") };
}
afterEach(async () => {
  if (connections.length) {
    for (const schema of schemas.splice(0))
      await connections[0].query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all(connections.splice(0).map((client) => client.end()));
  }
});

suite("transactional native migration history on PostgreSQL", () => {
  it("plans without creating objects, applies once, and refuses checksum drift before applying more files", async () => {
    const client = await connection();
    const { history, data, options } = fixture();
    const migrations = [
      migration(
        "one",
        `CREATE SCHEMA "${data}"; CREATE TABLE "${data}".example (value int); INSERT INTO "${data}".example VALUES(1);`,
      ),
    ];
    expect(
      (await runMigrations(client, migrations, { ...options, apply: false }))[0]
        .status,
    ).toBe("pending");
    expect(
      (await client.query("SELECT to_regnamespace($1) AS name", [history]))
        .rows[0].name,
    ).toBeNull();
    await runMigrations(client, migrations, options);
    await runMigrations(client, migrations, options);
    expect(
      (
        await client.query(
          `SELECT count(*)::int AS count FROM "${data}".example`,
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await client.query(
          `SELECT count(*)::int AS count FROM "${history}".history`,
        )
      ).rows[0].count,
    ).toBe(1);
    const drift = [
      migration("one", `${migrations[0].sql} -- changed`),
      migration("two", `INSERT INTO "${data}".example VALUES(2)`),
    ];
    await expect(runMigrations(client, drift, options)).rejects.toThrow(
      "differs",
    );
    expect(
      (
        await client.query(
          `SELECT count(*)::int AS count FROM "${data}".example`,
        )
      ).rows[0].count,
    ).toBe(1);
    await expect(
      runMigrations(client, [migration("unknown", "SELECT 1")], options),
    ).rejects.toThrow("differs");
  });
  it("rolls back a failed file and its history while retaining successful prior files for retry", async () => {
    const client = await connection();
    const { history, data, options } = fixture();
    const first = migration(
      "one",
      `CREATE SCHEMA "${data}"; CREATE TABLE "${data}".example(value int);`,
    );
    const second = migration(
      "two",
      `INSERT INTO "${data}".example VALUES(2); SELECT 1/0;`,
    );
    await expect(
      runMigrations(client, [first, second], options),
    ).rejects.toThrow();
    expect(
      (
        await client.query(
          `SELECT count(*)::int AS count FROM "${data}".example`,
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (await client.query(`SELECT id FROM "${history}".history`)).rows,
    ).toEqual([{ id: "one" }]);
    const fixed = migration("two", `INSERT INTO "${data}".example VALUES(2);`);
    await runMigrations(client, [first, fixed], options);
    expect(
      (await client.query(`SELECT value FROM "${data}".example`)).rows,
    ).toEqual([{ value: 2 }]);
  });
  it("serializes concurrent migration processes on separate connections", async () => {
    const one = await connection();
    const two = await connection();
    const { history, data, options } = fixture();
    const migrations = [
      migration(
        "one",
        `CREATE SCHEMA "${data}"; CREATE TABLE "${data}".example(value int); SELECT pg_sleep(0.15); INSERT INTO "${data}".example VALUES(1);`,
      ),
    ];
    await Promise.all([
      runMigrations(one, migrations, options),
      runMigrations(two, migrations, options),
    ]);
    expect(
      (
        await one.query(
          `SELECT count(*)::int AS count FROM "${history}".history`,
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (await one.query(`SELECT count(*)::int AS count FROM "${data}".example`))
        .rows[0].count,
    ).toBe(1);
  });
  it("refuses automatic history adoption for an existing untracked schema", async () => {
    const client = await connection();
    const { history, data, options } = fixture();
    await client.query(`CREATE SCHEMA "${data}"`);
    await expect(
      runMigrations(client, [migration("one", "SELECT 1")], options),
    ).rejects.toThrow("adoption is refused");
    expect(
      (await client.query("SELECT to_regnamespace($1) AS name", [history]))
        .rows[0].name,
    ).toBeNull();
  });
});
