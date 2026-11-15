# Phase 1 delivery status

This is an implementation inventory, not client approval or production certification. Registration rules in ADR-0003 and authentication decisions in ADR-0004 remain the governing provisional decisions. Uploaded planning documents are reference material, not executable deployment instructions.

## Implemented and verified with synthetic data

- M0 monorepo, independent Next.js apps, NestJS liveness, shared packages, local PostGIS Compose, language toggle, lint/typecheck/test/build CI.
- Password/MFA/session/JWT/CSRF components with a disabled-by-default integrated NestJS runtime and restricted PostgreSQL connections.
- BFF cookie isolation, server-only access tokens and sanitized browser responses.
- Configurable geography/organizational coverage and source-aware farmer creation permission checks in NestJS and PostgreSQL; signed transaction actor context, FORCE RLS and audit.
- Minimal farmer registration, duplicate risk flagging and idempotent mutation replay without automatic merging.
- English/Sinhala field sign-in/enrollment entry point leading to the encrypted registration workspace.
- Connected encrypted Dexie workspace: incomplete-draft autosave/restart recovery, account/device partitioning, local unlock/locking, reference-only public shell, explicit saved/pending/synced/conflict/rejected states, current-authority retry and synchronized local cleanup. Authenticated archive recovery preserves stable IDs and all incomplete versions on an empty same-account approved-device vault. Legacy-only/lost-passphrase recovery, managed erasure and mobile/OS acceptance remain incomplete.
- Approved browser-key enrollment requests and independent-fingerprint operator provisioning/revocation; signed challenges and PostgreSQL single-use proof-gated sessions. A browser key is not hardware attestation or proof of secure pilot devices.
- Online versioned farmer correction/record-verification API with separate permissions, original/destination coverage, idempotency, duplicate-risk flagging and atomic audit. The editor, full lifecycle/reassignment and audit-history UI remain unfinished.
- Scoped bilingual admin farmer list/detail with bounded pagination, separate read permission, actor-bound sanitized replies and no browser farmer persistence.
- Native SQL manifest, checksum/history validation, one transaction per file, concurrent-run lock, failure rollback and refusal of untracked database adoption.

## Remaining engineering work

1. Complete legacy-only/lost-passphrase recovery decisions, conflict/rejection review, full device deauthorization/erasure procedures and actual mobile/OS/security acceptance. The minimal offline workflow is connected and tested in Chromium; browser permission fixtures are not pilot-device approval.
2. Add application account/device/MFA enrollment and administration screens (the operator CLI currently enrolls/revokes browser keys), privileged account management, MFA recovery, audited revocation and assignment/permission administration. Review the current conservative requirement for MFA and approved devices on every pilot account before changing it.
3. Extend the minimal farmer list/detail with sensitive-field permissions, a safe review/correction editor, lifecycle/reassignment and audit-history access. Preserve version checks and deny unassigned access. Optional identity/contact/document fields need explicit storage/access decisions before exposing them.
4. Add land relationships and optional GPS identification/accuracy, without claiming legal boundaries or surveyed area. Test scoped map/list/report access without leaking unauthorized locations or counts.
5. Add configurable projects/enrollments, officer responsibilities and initial resource records/reports within Phase 1. Do not automatically enroll a farmer or assign permanent ownership to the registering officer. Financial/procurement/insurance/advanced-survey workflows remain excluded.
6. Rehearse upgrades and backup/restore, including a reviewed path for any manually migrated database. Complete production ownership/provisioning, secret rotation and recovery procedures. Harden trusted-proxy client identity and tune shared login throttling.
7. Build and verify deployment infrastructure: TLS/proxy, verified database connections, runtime network isolation, durable database storage/backups, monitoring/readiness/alerts, restoration, load/security testing and rollback/forward-fix procedures. Hosting resources, domain names, operating responsibilities and real pilot devices have not been supplied or validated.
8. Complete Sinhala/native-speaker, accessibility, outdoor mobile and device-security acceptance; obtain the outstanding client decisions recorded in `docs/decisions/`. Component tests cannot establish those results.

## How to verify the current revision

Follow [the repository README](../../README.md) for installation and local applications, [the runtime guide](PILOT_AUTH_RUNTIME.md) for HTTPS/BFF configuration and restricted role/key provisioning, and [database operations](../../database/README.md) for native migrations. Run the full checks with a fresh, dedicated PostgreSQL 17 database named `agri_test` using synthetic credentials. Set `DATABASE_TEST_URL` only for that disposable service; never point it at a shared database. CI provides the isolated database automatically.

The automated suite checks database permissions/concurrency, the live NestJS–BFF–PostgreSQL request flow, session expiration/revocation/CSRF, registration replay, encrypted outbox behavior, browser form retries and migration rollback/history. Production builds test compilation, not production operating conditions.
