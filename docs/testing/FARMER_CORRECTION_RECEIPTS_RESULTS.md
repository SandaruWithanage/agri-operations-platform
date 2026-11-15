# Correction receipt verification

Verified on 16 November 2026 using Node 22 and synthetic data in a dedicated local PostgreSQL 17/PostGIS 3.5 database.

- Frozen-lockfile installation, repository structure, lint, formatting, TypeScript and production builds passed.
- All 273 tests across 40 files passed. After SQL review strengthened independent permission checks, the final live database/migration run passed all 41 tests and lint/format checks passed again.
- The live request flow verifies own-actor correction receipts, no verification receipt substitution, omission of other actors and inaccessible historical scopes, unknown records, strict query parameters, absent receipts and revoked authority.
- Correction-only authority works without verification permission. Verification-only authority cannot use the native correction receipt function. Read/verification permission on historical locations does not substitute for correction permission. Missing signed actor context and direct journal SELECT remain denied.
- Seven transport tests cover sanitized no-store replies, record binding, absent/malformed receipts, invalid queries and cancellation. Eight component tests cover explicit reads, locale switching without persistence, authorization identity changes, cross-account denial, failure propagation, cancellation and late replies.
- Both production Chromium flows passed. The admin flow now checks correction receipt display, English/Sinhala switching, denial cleanup and hiding the action after capability revocation, alongside existing review/verification/land/history coverage. The field flow retains restart, encrypted drafts, safe sync and archive recovery coverage.

The existing validation-only database build task emits a Turborepo no-output warning and succeeds. These checks do not complete the correction editor, client/native-speaker approval, real-device validation, audit retention, deployment operations or independent security acceptance. See [receipt semantics](../development/FARMER_CORRECTION_RECEIPTS.md).
