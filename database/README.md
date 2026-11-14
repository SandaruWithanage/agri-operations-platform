# Database operations

Prisma validates the intentionally minimal ORM schema (`pnpm db:validate`). Native SQL migrations implement authentication, ABAC/RLS and registration. The migration tooling does not provision credentials or application data.

## Apply native migrations

Provide a dedicated migration identity through `MIGRATION_DATABASE_URL` in the process environment or a secret manager. Set `MIGRATION_DATABASE_NAME` to the exact target database name as an independent target check. Neither value is printed. Do not reuse any API runtime login. The current migrations create NOLOGIN roles and extensions and transfer function ownership, so the migration identity requires reviewed provisioning privileges. Runtime identities must never inherit that identity. Production connections require `NODE_ENV=production` and `sslmode=verify-full`.

Run from the repository root:

```sh
pnpm db:migrate:plan
pnpm db:migrate
pnpm db:migrate:plan
```

`plan` checks the complete recorded history and lists applied/pending files without creating a history schema. `migrate` takes a PostgreSQL advisory lock, checks the append-only manifest/checksums, then applies each pending file and its history entry in the same transaction. A failed file rolls back; earlier successful files remain recorded. Two processes cannot apply a migration twice. A connection/process failure releases the session lock. Lock wait is bounded to 10 seconds; each SQL execution is bounded to 60 seconds. Migrations that need longer must receive a reviewed runner change before execution.

`database/migrations/manifest.json` is the explicit dependency order, including the separate session-reader grant script. Append new SQL files to the end. Never edit, remove or reorder an applied file. Unknown history, missing history entries, checksum changes and unexpected database names fail closed. Review all SQL: the runner rejects top-level transaction commands and requires dollar quoting for backslash literals. SQL files must not alter session/transaction controls or migration history and must use transaction-compatible PostgreSQL operations. This lightweight lexical check does not replace SQL review.

The private `agri_migrations.history` schema records file IDs, SHA-256 checksums, positions and database timestamps, with no PUBLIC grants. The same migration identity must own history on subsequent runs. Privileged database owners can still alter history; preserve deployment artifacts and audit access separately.

## Existing manually migrated databases

Automatic adoption is refused when `authn`, `authz` or `farm` exists without tracked history. Do not delete data or insert fabricated history to bypass this check. Compare the deployed schema, roles and function ownership with the exact reviewed revision, rehearse backup/restore, and prepare a separately reviewed baseline/adoption migration. Disposable local/test databases can be recreated deliberately using their documented lifecycle. This command never resets a database.

## Recovery and release gates

Do not run draft reference SQL from uploaded documents. Do not add destructive down migrations for identity/farmer records. After a partial migration failure, inspect state under the controlled operator process and use a forward fix. The CLI suppresses PostgreSQL errors because SQL details can include sensitive data. Production release still requires ownership review, backup/restore and upgrade rehearsals, secret provisioning/rotation, deployment network/TLS checks and independent security review. Passing disposable database tests does not certify those operations.
