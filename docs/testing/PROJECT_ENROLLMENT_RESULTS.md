# Project enrollment verification (PRJ-03A)

Date: 16 November 2026. Scope: native migration 22, `ProjectEnrollmentService`, API endpoints and startup least-privilege gate. Synthetic data only. This is engineering evidence under **provisional** rules (DEC-04 open), not client acceptance, a device test or a production-readiness claim.

## Local gate (disposable PostgreSQL 16 + PostGIS 3 cluster, `DATABASE_TEST_URL` set)

- Full suite: **424 tests across 55 files passed** (previous baseline 413/54; +11 unit tests and the native enrollment scenario inside the migration suite). Lint, format check, structure check and typecheck of every workspace passed; the API production build (`nest build`) passed.
- Not rerun for this change: Next.js builds and Chromium scenarios (no UI/BFF change; shared validation types typecheck). Branch/merged CI is separate evidence and is not claimed here. CI uses PostgreSQL 17/PostGIS 3.5; this local run used 16.

## Native scenarios exercised

No grants → denied, empty lists, 404 detail · project scope without `farmer.read` denied · `farmer.read` without scope denied · explicit enroll v1 with journal+audit · detail/list (keyset, status filter) · exact replay (no second row/audit) · changed intent under same mutation → 23505 · replay under another source denied · duplicate current enrollment → 23505 · uncovered/foreign/unknown farmer or project → indistinguishable 42501 · inactive farmer/project → 55000 · revoked `farmer.read` and expired enrollment read hide rows immediately · withdrawal needs its own grant, source, current version (40001) · replay · already-withdrawn → 55000 · re-enrollment creates a new row · runtime INSERT/UPDATE/DELETE and journal/audit reads → 42501 · owner role cannot DELETE or change immutable columns · no signed actor → empty/denied · farmer geography change committed while enrollment waits on the farmer lock → re-authorized and denied · two concurrent enrollments → exactly one succeeds · failed command leaves no journal/audit residue · startup rejects direct write, audit read, owner membership and a revoked execute grant.

Unit tests cover strict contracts (authority fields rejected), trusted-source binding, fail-closed empty/invalid results with rollback, bounded paging and the HTTP error mapping (55000/23505/40001 → 409, 42501 → 403, 22023 → 400).

## Upgrade rehearsal

A scratch database was migrated through entry 21 with the tracked runner, seeded with synthetic scope grants, then upgraded to entry 22: history 21 → 22 entries, seeded grant rows byte-identical, a repeated run unchanged, `enrollment.withdraw` grants accepted and still rejected without a source, unknown permissions rejected. Prior-history checksum/timestamp equality was **not** separately compared in this rehearsal; the existing runner enforces checksums. Fixture and roles were removed afterwards.

## Limits

Single-session synthetic actor; no load/capacity measurement; no multi-account cross-officer matrix beyond scope/farmer-visibility denials (Officer A versus B enrollment isolation is still an open acceptance item under PRJ-04); no BFF, browser, offline or real-device evidence.
