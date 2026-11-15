import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { URL, fileURLToPath } from "node:url";
import pg from "pg";

export class MigrationError extends Error {}

/** Reject transaction control outside quoted SQL/function bodies; the runner owns transactions. */
export function validateTransactionalSql(sql) {
  let cursor = 0;
  let first = true;
  while (cursor < sql.length) {
    const tail = sql.slice(cursor);
    const whitespace = /^\s+/.exec(tail);
    if (whitespace) {
      cursor += whitespace[0].length;
      continue;
    }
    if (tail.startsWith("--")) {
      const end = tail.indexOf("\n");
      cursor += end === -1 ? tail.length : end + 1;
      continue;
    }
    if (tail.startsWith("/*")) {
      let depth = 1;
      cursor += 2;
      while (cursor < sql.length && depth) {
        if (sql.startsWith("/*", cursor)) {
          depth++;
          cursor += 2;
        } else if (sql.startsWith("*/", cursor)) {
          depth--;
          cursor += 2;
        } else cursor++;
      }
      if (depth) throw new MigrationError("Unclosed SQL comment");
      continue;
    }
    const dollar = /^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(tail);
    if (dollar) {
      const end = sql.indexOf(dollar[0], cursor + dollar[0].length);
      if (end === -1) throw new MigrationError("Unclosed SQL body");
      cursor = end + dollar[0].length;
      first = false;
      continue;
    }
    if (tail[0] === "'" || tail[0] === '"') {
      const quote = tail[0];
      cursor++;
      let closed = false;
      while (cursor < sql.length) {
        if (sql[cursor] === quote) {
          if (sql[cursor + 1] === quote) {
            cursor += 2;
            continue;
          }
          cursor++;
          closed = true;
          break;
        }
        if (sql[cursor] === "\\")
          throw new MigrationError(
            "Use dollar-quoted SQL for backslash literals",
          );
        cursor++;
      }
      if (!closed) throw new MigrationError("Unclosed SQL string");
      first = false;
      continue;
    }
    if (tail[0] === ";") {
      first = true;
      cursor++;
      continue;
    }
    const word = /^[a-zA-Z_][a-zA-Z0-9_$]*/.exec(tail);
    if (word) {
      if (
        first &&
        /^(BEGIN|COMMIT|ROLLBACK|START|SAVEPOINT|RELEASE|END|ABORT|PREPARE)$/i.test(
          word[0],
        )
      )
        throw new MigrationError("Migration SQL must not control transactions");
      cursor += word[0].length;
    } else cursor++;
    first = false;
  }
}

export async function loadMigrations(
  root = new URL("../database/migrations/", import.meta.url),
) {
  const paths = JSON.parse(
    await readFile(new URL("manifest.json", root), "utf8"),
  );
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    new Set(paths).size !== paths.length
  )
    throw new MigrationError("Invalid migration manifest");
  const discovered = (await readdir(root, { recursive: true })).filter((path) =>
    path.endsWith(".sql"),
  );
  if (
    discovered.length !== paths.length ||
    discovered.some((path) => !paths.includes(path))
  )
    throw new MigrationError("Migration manifest must include every SQL file");
  return Promise.all(
    paths.map(async (id) => {
      if (
        typeof id !== "string" ||
        !/^[0-9]{8}_[a-z0-9_]+\/[a-z-]+\.sql$/.test(id)
      )
        throw new MigrationError("Invalid migration path");
      const sql = await readFile(new URL(id, root), "utf8");
      validateTransactionalSql(sql);
      return {
        id,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}

/** Use one dedicated, idle connection. Never share it with application requests. */
export async function runMigrations(
  client,
  migrations,
  {
    apply = false,
    metadataSchema = "agri_migrations",
    protectedSchemas = ["authn", "authz", "farm", "land"],
  } = {},
) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(metadataSchema))
    throw new MigrationError("Invalid history schema");
  if (
    !migrations.length ||
    new Set(migrations.map((m) => m.id)).size !== migrations.length
  )
    throw new MigrationError("Invalid migration sequence");
  for (const migration of migrations) {
    validateTransactionalSql(migration.sql);
    if (
      createHash("sha256").update(migration.sql).digest("hex") !==
      migration.checksum
    )
      throw new MigrationError("Invalid migration checksum");
  }
  // Fixed namespace + database/schema key; both runners hold the lock for the entire sequence.
  const lock = [1095193161, `${metadataSchema}`];
  await client.query("SET lock_timeout = '10s'");
  await client.query("SET statement_timeout = '60s'");
  await client.query("SELECT pg_advisory_lock($1, hashtext($2))", lock);
  const table = `"${metadataSchema}".history`;
  try {
    const found = (
      await client.query("SELECT to_regclass($1) AS ledger", [table])
    ).rows[0].ledger;
    if (!found) {
      const existing = await client.query(
        "SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[])",
        [protectedSchemas],
      );
      if (existing.rowCount)
        throw new MigrationError(
          "Existing schema has no migration history; automatic adoption is refused",
        );
    } else {
      const ownership = await client.query(
        "SELECT c.relowner = (SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned FROM pg_class c WHERE c.oid=$1::regclass",
        [table],
      );
      if (!ownership.rows[0]?.owned)
        throw new MigrationError(
          "Migration history must belong to the migration identity",
        );
    }
    const history = found
      ? (
          await client.query(
            `SELECT position, id, checksum FROM ${table} ORDER BY position`,
          )
        ).rows
      : [];
    if (
      history.length > migrations.length ||
      history.some(
        (row, i) =>
          row.position !== i + 1 ||
          row.id !== migrations[i]?.id ||
          row.checksum !== migrations[i]?.checksum,
      )
    )
      throw new MigrationError(
        "Migration history differs from the reviewed manifest; no changes were applied",
      );
    const result = migrations.map((migration, i) => ({
      id: migration.id,
      status: i < history.length ? "applied" : "pending",
    }));
    if (!apply) return result;
    if (!found) {
      await client.query("BEGIN");
      try {
        await client.query(`CREATE SCHEMA "${metadataSchema}"`);
        await client.query(
          `REVOKE ALL ON SCHEMA "${metadataSchema}" FROM PUBLIC`,
        );
        await client.query(
          `CREATE TABLE ${table} (position integer PRIMARY KEY CHECK(position > 0), id text NOT NULL UNIQUE, checksum text NOT NULL CHECK(checksum ~ '^[0-9a-f]{64}$'), applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`,
        );
        await client.query(`REVOKE ALL ON TABLE ${table} FROM PUBLIC`);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    for (let i = history.length; i < migrations.length; i++) {
      const migration = migrations[i];
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO ${table} (position,id,checksum) VALUES ($1,$2,$3)`,
          [i + 1, migration.id, migration.checksum],
        );
        await client.query("COMMIT");
        result[i].status = "applied";
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return result;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", lock);
  }
}

async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !["--plan", "--apply"].includes(mode))
    throw new MigrationError("Use --plan or --apply");
  const raw = process.env.MIGRATION_DATABASE_URL;
  const expected = process.env.MIGRATION_DATABASE_NAME;
  if (!raw || !expected)
    throw new MigrationError(
      "Set MIGRATION_DATABASE_URL and MIGRATION_DATABASE_NAME through your secret environment",
    );
  const url = new URL(raw);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    decodeURIComponent(url.pathname.slice(1)) !== expected
  )
    throw new MigrationError(
      "Migration target does not match the expected database",
    );
  if (
    process.env.NODE_ENV === "production" &&
    url.searchParams.get("sslmode") !== "verify-full"
  )
    throw new MigrationError("Production migrations require verified TLS");
  const migrations = await loadMigrations();
  const client = new pg.Client({
    connectionString: raw,
    connectionTimeoutMillis: 5000,
    application_name: "agri-native-migrations",
  });
  try {
    await client.connect();
    for (const row of await runMigrations(client, migrations, {
      apply: mode === "--apply",
    }))
      console.log(`${row.status} ${row.id}`);
  } finally {
    await client.end();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // PostgreSQL details/connection URLs can contain sensitive values. Do not print them.
    console.error(
      error instanceof MigrationError
        ? error.message
        : "Migration failed. Inspect the database using the controlled operator procedure; SQL details were suppressed.",
    );
    process.exitCode = 1;
  });
}
