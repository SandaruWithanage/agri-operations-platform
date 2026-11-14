# Database layer - migration gate

This folder intentionally contains NO production schema or authorization policies yet.
The previously researched 57-table architecture is a **draft**, not a verified migration.

Before implementing real farmer records:

1. Lock the principal/account model and initial officer create/read scope rules.
2. Create versioned PostgreSQL + PostGIS migrations; use schema owners only in migrations.
3. Introduce `api_runtime` without `BYPASSRLS`, object grants, and `FORCE ROW LEVEL SECURITY`.
4. Implement transaction-local, authenticated identity context with an application trust boundary.
5. Write RLS tests for user A vs. B, direct SQL, writes, revocations, map markers, and reports.
6. Only then connect Prisma in the API using a reviewed runtime connection. M0 uses Prisma 6 CLI validation only; any major-version upgrade and adapter choice require review.

Never put migration/bootstrap credentials into the runtime API environment.
