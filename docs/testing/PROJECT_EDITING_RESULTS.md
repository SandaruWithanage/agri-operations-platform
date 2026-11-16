# Project editing verification — 16 November 2026

Synthetic local `agri_test` PostgreSQL 17/PostGIS 3.5 database, Node 26.13.1 and pnpm 12.21.0 with the pinned stable toolchain. No production data, credentials or devices were used.

## Evidence

- Full automated suite: **401 tests in 53 files passed**. Focused edit/contracts/catalog regression group: **27 tests in three files passed**. The final native group passed **42 tests in two files**, including both permission-expiry wait paths.
- Migration 20 preserves pre-existing creation rows/audit fields and timestamps. Existing creation audit gains version 1/null change reference. A separate pristine-fixture rehearsal applied all 20 tracked migrations, repeated with unchanged history/timestamps, checked FORCE RLS and denied direct runtime UPDATE, then removed only rehearsal schemas/new NOLOGIN roles. This does not establish production adoption or backup/restore readiness.
- Live BFF/NestJS/PostgreSQL checks prove separate read/update authority, no creation-derived privilege, wrong-source/narrow/unit/geography/cross-organization/future/expired/inactive grant denial, hidden/missing target behavior and strict immutable/actor-field rejection.
- Native tests prove exact replay, original-outcome acknowledgement after a newer edit, one change for simultaneous identical requests, one winner for competing versions, stale-version/no-op rejection, preserved organization/creator/time and private before/after/version audit. Forced audit failure rolls back the row and journal and exposes no SQL error; the unchanged request can retry after repair.
- Both a fresh edit held on the project row and an identical replay held on its mutation lock are denied if update permission expires before release. No unauthorized change or new journal entry appears. Revoked read/update rights also block reconciliation.
- Restricted SQL denies unsigned mutations, direct writes and private change-name/journal reads. Startup rejects direct journal-column privileges and an unavailable edit-function execute grant. Enabled startup requires the migration's executable edit function; ten isolated runtime connections remain unchanged.
- Contract/UI tests cover required version/explicit flag/name, canonical identifiers, exact acknowledgement version/target, CSRF, account/device binding, sanitized results, explicit review, locked retained values, changed organization/account/device, conflicting versions, late replies, fixed mounted target, no automatic reconnect submission and no browser record persistence.
- Production builds and both Chromium scenarios passed. Admin checks now include bilingual name/flag editing, navigation lock/reopen, a lost acknowledgement, identical retry after the current version advanced and authoritative project-detail refresh. Existing farmer/land/catalog creation and encrypted field restart/sync/archive scenarios still pass.
- Frozen dependency installation, peer checks, repository structure, lint, formatting and type-checks passed. Production audit remains clean; the previously documented unpatched low-severity development-only advisory remains, with the high-severity gate passing and no suppression.

## Limits

This edits catalog metadata only. Enrollment, operational lifecycle/closure rules, project-specific/intersecting assignments, resources and reports remain separate work. Tab/browser termination can lose working values and retry IDs. A separate own-edit receipt, durable online/project offline recovery, audit-history/read-retention administration, retained-key rotation, native-speaker/device testing and production deployment/acceptance remain unfinished. See [setup and operation](../development/PROJECT_EDITING.md) and [ADR 0017](../decisions/ADR-0017-versioned-project-editing.md).
