# Project/geography scope foundation verification

Date: 16 November 2026. Scope: PRJ-04A, native migration 21 and the internal NestJS policy. Synthetic data only. This is engineering evidence, not enrollment delivery, an approved client permission matrix or production certification.

## Focused verification

The focused policy/native-migration group passed **54 tests across 3 files**, with a real disposable PostgreSQL 17/PostGIS database named `agri_test`. Twelve policy unit tests cover fixed action/source contracts, strict target IDs, trusted actor binding, boolean-only database acceptance, transaction rollback and final authorization.

The composed native integration exercises:

- Missing/unsigned actor context; missing grants/assignments; wrong/unknown/null target/action/source; unrelated catalog/farmer grants.
- Exact project and organization, geography and ancestor-unit AND matching, unrelated branches, hierarchy cycles and inactive geography; partial rows never combine.
- Compound foreign-key rejection, invalid source shapes and assignments without coverage.
- Direct restricted SQL under FORCE RLS using a synthetic test-only scope table, with two officers seeing different project rows and revoked sessions seeing none.
- Source-specific create checks without inferred read/admin authority; private scope-table denial and forbidden scope-owner membership.
- Revocation and expiry while waiting on either grant or assignment locks. Natural grant/session expiry while waiting on an assignment after the earlier grant/actor check.
- An actual transaction-local marker insert rolled back when the final NestJS scope check observes expiry.
- The NOLOGIN scope owner's UPDATE WITH CHECK denial, startup rejection of column privilege drift/owner membership and missing predicate execution.
- Existing pre-edit project/audit fields remain unchanged when migrations 20–21 are applied in the upgrade fixture.

Focused command: `pnpm exec vitest run tests/authn-migration.test.ts tests/project-scope-policy.test.ts tests/native-migrations.test.ts`, with the dedicated `DATABASE_TEST_URL`. Omitting the URL skips the database suites and does not prove this gate.

## Full repository validation

All local gates passed with the pinned Node 26.13.1/pnpm 12.21.0 toolchain:

- Frozen-lockfile installation, peer checks and structure checks.
- Production dependency audit: no known vulnerabilities. Full audit: the existing single low-severity development-only finding; no high-severity findings. No suppression or dependency change was introduced; see [dependency policy](../development/DEPENDENCY_POLICY.md).
- ESLint, Prettier and workspace TypeScript checks.
- **413 tests across 54 files**, including the real PostgreSQL suites.
- Both Next.js production builds, NestJS build and Prisma schema validation.
- Both Chromium regression scenarios: approved-device/encrypted offline recovery and bilingual administrator registry/project/farmer/land workflows.

A separate clean disposable-database rehearsal applied the first 20 tracked migrations, upgraded through entry 21, preserved all prior history/checksums/timestamps, and repeated the full manifest with unchanged history. It verified the restricted NOLOGIN scope owner, private tables and runtime-only predicate execution, then removed the disposable schemas/roles. This is not a production restore or untracked-schema adoption rehearsal.

Documentation link/task-ID checks and git diff checks passed. GitHub push/PR and merged-main CI results are recorded in workflow/PR history; local results do not imply those jobs or external acceptance have passed.

## Limits and next steps

No enrollment schema, HTTP/BFF/UI route, role administration, scope mutation audit/API, direct farmer-record scope intersection or offline enrollment synchronization is delivered. The native helper and NestJS policy are prerequisites; future enrollment RLS/native writes must enforce the predicate independently together with eligibility, relationships, versions, idempotency and audit. Source/device/proxy/production and client acceptance remain separate gates. See [setup/boundaries](../development/PROJECT_SCOPES.md), [ADR 0018](../decisions/ADR-0018-project-geography-scope-foundation.md) and [remaining tasks](../development/PROJECT_HANDOVER.md).
