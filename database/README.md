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

`database/migrations/manifest.json` is the explicit dependency order, including the separate session-reader grant script. Append new SQL files to the end. Git enforces LF line endings for SQL so Windows/Linux checkouts produce the same checksum. Never edit, remove or reorder an applied file. Unknown history, missing history entries, checksum changes and unexpected database names fail closed. Review all SQL: the runner rejects top-level transaction commands and requires dollar quoting for backslash literals. SQL files must not alter session/transaction controls or migration history and must use transaction-compatible PostgreSQL operations. This lightweight lexical check does not replace SQL review.

The private `agri_migrations.history` schema records file IDs, SHA-256 checksums, positions and database timestamps, with no PUBLIC grants. The same migration identity must own history on subsequent runs. Privileged database owners can still alter history; preserve deployment artifacts and audit access separately.

## Existing manually migrated databases

Automatic adoption is refused when `authn`, `authz`, `farm`, `land` or `operations` exists without tracked history. Do not delete data or insert fabricated history to bypass this check. Compare the deployed schema, roles and function ownership with the exact reviewed revision, rehearse backup/restore, and prepare a separately reviewed baseline/adoption migration. Disposable local/test databases can be recreated deliberately using their documented lifecycle. This command never resets a database.

## Recovery and release gates

Do not run draft reference SQL from uploaded documents. Do not add destructive down migrations for identity/farmer records. After a partial migration failure, inspect state under the controlled operator process and use a forward fix. The CLI suppresses PostgreSQL errors because SQL details can include sensitive data. Production release still requires ownership review, backup/restore and upgrade rehearsals, secret provisioning/rotation, deployment network/TLS checks and independent security review. Passing disposable database tests does not certify those operations.

## PostGIS land identification

Manifest entry 14 requires PostGIS available in the `public` schema and provisions independent `agri_land_function_owner`/`agri_land_runtime` groups. The API requires a ninth restricted LOGIN URL for that runtime; never assign the owner group to an application login. Apply migrations and provision the URL before deploying the new API. Existing registration/read behavior is retained. The Compose/CI PostGIS image is pinned to a verified digest; review and retest digest changes. See [land setup](../docs/development/LAND_IDENTIFICATION.md).

## Staff verification receipts

Manifest entry 15 adds an index and restricted own-verification receipt function, preserving existing farmer/audit records and role connections. Apply it before the updated verification API/UI. No business grants or new roles are seeded. See [staff verification setup](../docs/development/FARMER_VERIFICATION.md).

## Farmer review queue

Manifest entry 16 adds the status/UUID cursor index without changing rows, RLS or role grants. Apply it through the controlled runner, rehearsing index creation for the deployed volume. Existing runtime connections remain unchanged. See [queue setup](../docs/development/FARMER_REVIEW_QUEUE.md).

## Correction-location choices (manifest entry 17)

Apply entry 17 before deploying the correction-choice read endpoint. It adds a bounded function executable only by the existing farmer runtime, with current source and destination read/correct checks. It does not grant geography-table reads, business permissions or require new connection URLs. See [the API contract and verification limits](../docs/development/FARMER_CORRECTION_OPTIONS.md).

## Own correction receipts (manifest entry 18)

Apply entry 18 before deploying the correction receipt endpoint. It adds an indexed actor-bound function with current and historical read/correct coverage checks, using existing roles and URLs. No direct journal read privilege or business grant is added. See [receipt semantics and recovery limits](../docs/development/FARMER_CORRECTION_RECEIPTS.md).

## Configurable project catalog (manifest entry 19)

Apply entry 19 before deploying the project API. It adds the `operations` schema, FORCE RLS, configured-organization catalog records, actor-bound idempotency and atomic creation audit. Provision a tenth isolated LOGIN inheriting only `agri_project_runtime` and update `PILOT_DATABASE_URLS`; enabled startup fails closed if it is missing, owns functions, reads journals/keys or inherits another runtime role. The function-owner group is never an application identity. No projects, role names or business grants are seeded. Organization-wide create/read permissions remain explicit and separate; narrow geography/unit/source grants cannot widen to the entire catalog. See [setup, protocol and limits](../docs/development/PROJECT_CATALOG.md).

## Versioned project metadata editing (manifest entry 20)

Apply entry 20 before deploying project editing. It extends the existing project helper/RLS with organization-wide read-plus-update authority, adds a private change journal and version-linked audit, and preserves existing creation records/timestamps. The ten runtime connections remain unchanged; no new business grant is seeded. The runtime cannot update rows directly or read the private journal. Fixed mutation/row locks, current permission checks after waits and original-version checks prevent duplicated or stale changes. This edits name/catalog flag only; enrollment, organization transfers, operational lifecycle/closure rules and project-specific assignments remain separate work. See [upgrade and operation guidance](../docs/development/PROJECT_EDITING.md).

## Project/geography scope prerequisite (manifest entry 21)

Apply entry 21 before deploying the updated enabled runtime. Separate typed project permission/assignment rows and a fixed predicate enforce matching project AND geography/unit scope. Existing records/catalog grants and ten runtime connections are preserved. The new scope owner is NOLOGIN; direct scope-table access and scope-owner membership are forbidden to API logins and checked at startup. No grants, roles for business users, enrollment records or administration endpoints are seeded/exposed. The internal NestJS policy is a prerequisite; future enrollment record RLS/native commands must enforce it independently. See [provisioning boundaries and remaining work](../docs/development/PROJECT_SCOPES.md).
