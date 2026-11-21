# IAM-01 P1-03a independent-review package (PR #130)

**Status: prepared for an independent AppSec/PostgreSQL reviewer (Gate G1). Not a review, not an approval, not production acceptance.** No reviewer is assigned. The change stays unmerged until that review and the owner's explicit authorization. Passing tests, including the CI database suite, do not replace the review. Everything below is stated as built on the branch `claude/iam-01-catalog-foundation`; items I did not verify are labelled.

Scope of the change: migration `20261120_iam_catalog_foundation` (manifest entry 27). Design: [ADR 0022](../decisions/ADR-0022-dynamic-role-and-assignment-administration.md) (PROPOSED). The stacked follow-up [#131](https://github.com/SandaruWithanage/agri-operations-platform/pull/131) (grant audit plumbing, entry 28) is a separate change that depends on this one; it has no writer and is listed in section 9 so the reviewer can decide whether to review it together.

## 1. What the change is, and what it is not

Adds the `iam` schema: `permission_catalog`, `person`, `role`, immutable `role_version` and `role_version_permission`; two NOLOGIN identities (`agri_iam_owner`, `agri_iam_runtime`); FORCE RLS; three bounded read functions (`list_roles`, `get_role_version`, `list_permissions`) and one authority function (`can_read_roles`). **Not** present: any write function, grant materialization, account or person link, API connection, LOGIN role, seeded row, or change to the three existing predicates (`authz.allowed`, `authz.allowed_project_geography`, `operations.allowed_organization`).

## 2. SECURITY DEFINER functions and signed-actor validation

As-built inventory (queried from a freshly migrated PostgreSQL 16, 21 Nov 2026):

| Function                                          | Owner              | SECURITY DEFINER | `search_path` | EXECUTE held by                            |
| ------------------------------------------------- | ------------------ | ---------------- | ------------- | ------------------------------------------ |
| `iam.can_read_roles(uuid)`                        | `agri_iam_owner`   | yes              | `pg_catalog`  | owner, `agri_iam_runtime` (PUBLIC revoked) |
| `iam.list_roles(uuid,uuid,integer)`               | `agri_iam_owner`   | yes              | `pg_catalog`  | `agri_iam_runtime` (PUBLIC revoked)        |
| `iam.get_role_version(uuid,uuid,integer)`         | `agri_iam_owner`   | yes              | `pg_catalog`  | `agri_iam_runtime` (PUBLIC revoked)        |
| `iam.list_permissions(uuid,uuid,integer)`         | `agri_iam_owner`   | yes              | `pg_catalog`  | `agri_iam_runtime` (PUBLIC revoked)        |
| `iam.reject_change()` (trigger; SECURITY INVOKER) | migration identity | no               | `pg_catalog`  | migration identity only                    |

- Every object reference inside the definer bodies is schema-qualified and `search_path` is pinned to `pg_catalog`, so a caller cannot redirect name resolution.
- **Signed actor.** `can_read_roles` calls the existing `authz.actor()`, which returns NULL unless the transaction carries `agri.actor`, `agri.session` and a 64-hex HMAC-SHA256 over `actor:session:txid_current()` that matches `authz.context_key` (compared without early exit), the login session exists, belongs to the actor and is not revoked or expired, the account is active, and an approved, unrevoked device is bound where one is required. A forged signature, a spoofed actor id or an unsigned call yields NULL and therefore no rows (tested). `can_read_roles` re-reads `authz.actor()` after each lock wait and requires it to be unchanged.
- **Authority granted by `can_read_roles`:** an active grant row with `permission='role.read'`, `coverage='organization'`, `geography_id` and `unit_id` NULL, `registration_source='administrator'`, `starts_at <= now`, not expired, for the signed actor and exactly the requested organization. A narrower or differently sourced grant never becomes organization-wide read access (same rule as `operations.allowed_organization`).
- **Return behaviour.** Not-found and not-permitted both return no rows or `false`; page size outside 1 to 100 raises `22023` before any authority check (this reveals nothing about data).
- **Open reviewer question.** `list_permissions` returns the global catalog to any organization's `role.read` holder; the catalog is reference data, not per-organization. Confirm that is acceptable once real permission names exist.
- **Open reviewer question.** `can_read_roles` is directly executable by the runtime identity and returns whether the signed actor holds `role.read` for a given organization. It reveals only the caller's own authority.

## 3. Organization isolation, FORCE RLS and unauthorized access

- All five tables: `ENABLE` and `FORCE ROW LEVEL SECURITY`; a single `SELECT` policy `USING (true)` for `agri_iam_owner` only. No policy exists for any other role, so a role without a policy sees zero rows, and the runtime identity holds no table privilege at all. Tables are owned by the migration identity (as in earlier entries), not by the function owner; FORCE RLS binds the table owner, but **superusers and BYPASSRLS roles are outside RLS by definition** (process control, DEC-08).
- Isolation is enforced by the functions, not by RLS predicates on the data: every read filters `organization_id = p_org` after `can_read_roles(p_org)`. `get_role_version` joins `role.organization_id = p_org`, so a role id from another organization returns nothing.
- Tested unauthorized cases (one integration test): no grant; grant for another organization (reads that organization only, never this one); narrower `assigned` grant with unit; wrong source (`field_officer`); wrong permission (`role.update`); expired grant; inactive grant; forged signature; spoofed actor; direct table `SELECT` by the runtime identity on all five tables (`42501`).
- **Not tested here:** a LOGIN pool using these functions (none exists), `SET ROLE` escape attempts beyond the NOLOGIN design, behaviour of a BYPASSRLS operator.

## 4. `UPDATE(active)` on `authz.permission_grant` for the IAM function owner

- **Why it exists.** `can_read_roles` locks the actor's candidate grant rows with `FOR SHARE`, as the existing predicates do, so a revocation waits for in-flight readers and a reader that waited re-checks the row. PostgreSQL requires an UPDATE privilege on a table before it will take a row lock on it.
- **Evidence (21 Nov 2026, disposable PostgreSQL 16).** With the grant removed, `list_roles` fails with `permission denied for table permission_grant` (the catalog test and the concurrency test both fail). So the grant is **necessary for the lock-based design, not for reading**.
- **Risk.** It is a column-level UPDATE privilege on one column of a table every authorization predicate reads. The owner is NOLOGIN, has no LOGIN descendants and is reachable only through four fixed functions that never issue an UPDATE; the other function owners (policy, project, enrollment) already hold the identical privilege. The privilege would let a compromise of the owner role (for example a future function with a bug, or a role membership change) deactivate grants.
- **Alternative if the reviewer rejects it.** Read the grant rows without `FOR SHARE`. Then no UPDATE privilege is needed, but revocations no longer wait for readers and a reader would not re-check a row it waited on; the effect is a short window in which a revoked grant is still honoured by an in-flight read-only call. The reviewer should decide which risk is preferable for read-only functions. A second option is a dedicated lock-only function owned by an identity that already holds the privilege.

## 5. Lock contention, concurrent revocation and transaction behaviour

- **Locks taken.** `FOR SHARE` on the actor's grant rows for one organization, in `ORDER BY g.id` (stable order, so two readers cannot deadlock each other); plus the existing `authz.actor()` locks (session, account, device rows `FOR SHARE`). `farm.organization` is read without a lock (organization existence is guaranteed by the foreign keys). No hierarchy or unit-tree locks are taken in this slice.
- **Evidence from one new integration test with two parts, on real connections** (committed state, `pg_stat_activity` used to prove the wait): (1) a transaction that read under the grant holds it: a concurrent `UPDATE ... SET active=false` waits until the reader commits, and the next transaction is denied; (2) a read that must wait behind an uncommitted revocation re-checks the updated row after the lock is released and is denied. Removing `FOR SHARE` makes the test fail at part (1); ignoring `active` after the wait makes it and the catalog test fail.
- **Not measured.** No load test, no statement/lock timeout is configured for these functions (the runtime pool does not exist yet; the pilot runtimes use a 10 s statement timeout), no contention measurement with a concurrent hierarchy writer (this slice takes no hierarchy locks). Readers hold the share lock for their transaction, so a long caller transaction delays revocation of that grant; a `lock_timeout` for the future runtime pool is a recommendation, not a built control.
- **One unexplained test failure.** After I fixed a bug in my own concurrency test (it asked a blocked connection for its backend id), I ran the integration suite 13 times: one run failed a different test ("composes the real pilot runtime…") at about 3.6 s and the other 12 passed. I did not capture that error and the cause is not identified; the earlier 39-test runs on this branch all passed. The CI database suite should be watched for flakiness.

## 6. Migration idempotency, rollback, ownership and future compatibility

- **Not idempotent by design.** The file creates a schema and two roles. Re-running the SQL manually fails (`already exists`). The migration tool records a SHA-256 history, takes an advisory lock, runs each file in one transaction and refuses checksum drift; PostgreSQL rolls back `CREATE ROLE` with the transaction. **I did not run a mid-file failure experiment for this specific file**; the tool's rollback is covered by its own tests.
- **Roles are cluster-global.** The migration identity needs CREATEROLE (earlier entries already require it); a second database in the same cluster cannot create the same roles. There is no down migration (policy: no destructive down migrations); removal would be a new reviewed forward migration.
- **Restricted ownership.** Functions are altered to `agri_iam_owner`; tables stay with the migration identity. The owner's standing `CREATE` on schema `iam` is revoked at the end of the migration (a later slice must re-grant it in its own reviewed file). The runtime identity holds `USAGE` on `iam` only; it no longer holds `USAGE` on `authz` or `EXECUTE` on `authz.actor()` (both were removed in this round after an experiment showed the suite passes without them; each has a mutation check).
- **Future schema compatibility.** The three predicates select named columns or `g.*` into a record, so additive columns on `authz` tables are safe (the follow-up adds `origin` and `binding_id`). `permission_catalog.permission_id` is the stable identity the ADR addendum needs for a later move from text permissions to ids. Existing grants stay valid with no migration of data. Role versions are immutable, so later bindings can pin them.
- **Not verified:** upgrade and restore rehearsal (OPS-03) for the new schema, and a run with a non-superuser migration identity.

## 7. Mutation checks and test evidence

**Seventeen checks on the migration, each makes the named test fail.** First round (12, catalog test): narrower grant accepted; any registration source accepted; any organization accepted; expiry ignored; inactive ignored; `list_roles` not organization-filtered; page size unchecked; role-version organization unchecked; default risk class `routine`; runtime table access granted; role-version permission update allowed; truncate allowed. This round (5): row lock (`FOR SHARE`) removed (the concurrency test fails, the catalog test passes); `active` ignored after a lock wait (both tests fail); runtime given `USAGE` on `authz`; runtime given `EXECUTE` on `authz.actor()`; owner keeps `CREATE` on `iam`. The migration was restored byte-for-byte after each run. **Not a mutation but an experiment:** removing `UPDATE(active)` breaks both tests (section 4).

**Actual test evidence.**

- Local, disposable PostgreSQL 16 with PostGIS, synthetic data only: the full integration suite (`tests/authn-migration.test.ts`) passes with the new concurrency test, the catalog test and the privilege assertions (40 tests in this branch).
- GitHub CI: the `validate` job provides a PostGIS service and `DATABASE_TEST_URL`, so the database suite runs there. The owner confirmed (21 Nov 2026) that the CI database suite passed all 39 tests at the earlier head. Runs: `44804575555` (head `4108a6f`) and `44864945426` (head `a2a16a0`), both `validate` success. **The concurrency test and the privilege tightening are newer than those runs and have only local evidence until CI runs the new head.**
- Without a database the suite skips these tests (reported as skipped, not passed).

## 8. What this package does not claim

No independent review, no load or contention measurement, no LOGIN pool, no non-superuser migration run, no restore rehearsal, no review of Sinhala/UI (none exists), no production acceptance. Risk classes and defaults in the catalog are provisional until the client permission matrix (DEC-02). Gate G1 remains open.

## 9. Scope decisions for the reviewer

1. Accept or reject the `UPDATE(active)` grant, or choose the lock-free read (section 4).
2. Review [#131](https://github.com/SandaruWithanage/agri-operations-platform/pull/131) (append-only grant-change audit and `origin` columns on four existing authorization tables) with this change or after it.
3. Confirm that `list_permissions` may expose the global catalog and that `can_read_roles` may be directly executable.
4. State which further evidence is required before any mutation slice (see the [P1-03b design, threat and test plan](IAM_P1_03B_DESIGN_THREAT_AND_TEST_PLAN.md)).
