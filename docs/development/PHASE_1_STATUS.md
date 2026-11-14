# Phase 1 delivery status

This is an implementation inventory, not client approval or production certification. Registration rules in ADR-0003 and authentication decisions in ADR-0004 remain the governing provisional decisions. Uploaded planning documents are reference material, not executable deployment instructions.

## Implemented and verified with synthetic data

- M0 monorepo, independent Next.js apps, NestJS liveness, shared packages, local PostGIS Compose, language toggle, lint/typecheck/test/build CI.
- Password/MFA/session/JWT/CSRF components with a disabled-by-default integrated NestJS runtime and restricted PostgreSQL connections.
- BFF cookie isolation, server-only access tokens and sanitized browser responses.
- Configurable geography/organizational coverage and source-aware farmer creation permission checks in NestJS and PostgreSQL; signed transaction actor context, FORCE RLS and audit.
- Minimal farmer registration, duplicate risk flagging and idempotent mutation replay without automatic merging.
- English/Sinhala online field sign-in and registration; same-account retry with stable IDs and retained form values after an interrupted request.
- Encrypted Dexie outbox primitive: restart/unlock, minimal payload, distinct saved/pending/synced/conflict/rejected states and retry tests. **It is not connected to the field screen.**
- Approved browser-key enrollment requests and independent-fingerprint operator provisioning/revocation; signed challenges and PostgreSQL single-use proof-gated sessions. A browser key is not hardware attestation or proof of secure pilot devices.
- Native SQL manifest, checksum/history validation, one transaction per file, concurrent-run lock, failure rollback and refusal of untracked database adoption.

## Remaining engineering work

1. Connect durable incomplete-draft autosave and the encrypted outbox to an approved-device field workspace. Partition local data by trusted account/device; demonstrate local unlock, inactivity locking, restart recovery, revoked-device handling and explicit safe cleanup. Cache only authorized task references. Add manual/background sync, current-session authorization, conflict/rejection resolution and real-device browser tests. Online form data currently lives only in the open page; do not use it as an offline pilot.
2. Add application account/device/MFA enrollment and administration screens (the operator CLI currently enrolls/revokes browser keys), privileged account management, MFA recovery, audited revocation and assignment/permission administration. Review the current conservative requirement for MFA and approved devices on every pilot account before changing it.
3. Implement farmer list/detail with separate read and sensitive-field permissions, review/verification/correction/reassignment and audit history. Preserve version checks and deny unassigned access. Optional identity/contact/document fields need explicit storage/access decisions before exposing them.
4. Add land relationships and optional GPS identification/accuracy, without claiming legal boundaries or surveyed area. Test scoped map/list/report access without leaking unauthorized locations or counts.
5. Add configurable projects/enrollments, officer responsibilities and initial resource records/reports within Phase 1. Do not automatically enroll a farmer or assign permanent ownership to the registering officer. Financial/procurement/insurance/advanced-survey workflows remain excluded.
6. Rehearse upgrades and backup/restore, including a reviewed path for any manually migrated database. Complete production ownership/provisioning, secret rotation and recovery procedures. Harden trusted-proxy client identity and tune shared login throttling.
7. Build and verify deployment infrastructure: TLS/proxy, verified database connections, runtime network isolation, durable database storage/backups, monitoring/readiness/alerts, restoration, load/security testing and rollback/forward-fix procedures. Hosting resources, domain names, operating responsibilities and real pilot devices have not been supplied or validated.
8. Complete Sinhala/native-speaker, accessibility, outdoor mobile and device-security acceptance; obtain the outstanding client decisions recorded in `docs/decisions/`. Component tests cannot establish those results.

## How to verify the current revision

Follow [the repository README](../../README.md) for installation and local applications, [the runtime guide](PILOT_AUTH_RUNTIME.md) for HTTPS/BFF configuration and restricted role/key provisioning, and [database operations](../../database/README.md) for native migrations. Run the full checks with a fresh, dedicated PostgreSQL 17 database named `agri_test` using synthetic credentials. Set `DATABASE_TEST_URL` only for that disposable service; never point it at a shared database. CI provides the isolated database automatically.

The automated suite checks database permissions/concurrency, the live NestJS–BFF–PostgreSQL request flow, session expiration/revocation/CSRF, registration replay, encrypted outbox behavior, browser form retries and migration rollback/history. Production builds test compilation, not production operating conditions.
