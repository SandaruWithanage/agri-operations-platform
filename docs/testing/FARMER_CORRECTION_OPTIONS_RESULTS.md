# Correction-location options verification

Verified on 16 November 2026 using synthetic records and a disposable local PostgreSQL 17/PostGIS 3.5 database. Node 22 was used to match GitHub CI.

- Frozen-lockfile installation, structure check, ESLint, Prettier, TypeScript and production builds passed.
- All 258 tests across 38 files passed, including the live NestJS/BFF/PostgreSQL integration and migration history/rollback checks.
- Both production Chromium flows passed: encrypted field draft/restart/sync/archive recovery and admin farmer/land/review/verification isolation.
- Correction-choice integration covers read-plus-correct source/destination coverage, revoked and inactive locations, bounded cursor pages/current versions, invalid queries, missing actor context and denied direct table access.
- Thirteen new transport tests cover query validation, reply sanitization/binding, requested bounds, malformed replies and cancellation.

The database build reports the existing Turborepo no-output warning for its validation-only task; validation succeeds. These automated results do not establish client business approval, native-speaker acceptance, pilot-device security or production operating readiness. The correction editor remains future work; see [the contract](../development/FARMER_CORRECTION_OPTIONS.md).
