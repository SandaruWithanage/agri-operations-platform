# Administrator registration verification — 16 November 2026

Synthetic local PostgreSQL 17/PostGIS 3.5 service; Node 26.13.1, pnpm 12.21.0 and the pinned stable toolchain. No production records or credentials were used.

## Results

- Frozen dependency installation, peer validation, repository structure, lint and workspace type-checks passed.
- Full automated suite: **340 tests across 47 files passed**, including the database-backed NestJS/BFF integration and encrypted offline retry/recovery tests.
- Focused registration/reference/shared-field regression group: **28 tests across five files passed**. Coverage includes core-only fields and notice validation, configured locations, exact request replay, Sinhala switching, incomplete values, account/device/transport/visibility/inactivity locks, coverage revocation, denied submissions, conflicts, explicit identity-bound discard, cancelled late discard, late acknowledgements and no automatic reconnect submission.
- Native administrator registration assertions check Pending Review, trusted administrator source/creator, notice confirmation, atomic registration audit and no read access from creation alone. Existing native tests reject field-officer source escalation, missing permission, invalid notice and unauthorized geography.
- Production API, validation, Prisma schema validation and both Next.js builds passed.
- Both Chromium scenarios passed. The admin scenario registers a minimal synthetic farmer, switches locale, locks/reopens on navigation, loses a successful acknowledgement and retries the identical payload. A create-only outcome refresh shows no records rather than exposing submitted data. It verifies no admin farmer data in IndexedDB/localStorage. The field scenario continues to prove encrypted offline restart, fixed-ID synchronization and archive recovery after extracting the shared form.
- Production dependency audit: no known vulnerabilities. The full development tree retains the previously documented unpatched low-severity `deepmerge` advisory through the Nest CLI optional webpack-checker peer; the configured high-severity audit gate passes. No finding is suppressed.

## Limits

The administrator draft is tab-only and cannot recover unsent values or retained request IDs after browser/tab termination. A leave-page guard is not durable storage. Create-only accounts need an authorized administrator to investigate an uncertain outcome after that loss. There is no administrator offline queue, new permission, optional sensitive-field collection, automatic ownership/project enrollment, production deployment, native-speaker review or real-device acceptance in this change. See [the provisional decision](../decisions/ADR-0014-online-admin-registration.md) and [operator/setup guidance](../development/ADMIN_FARMER_REGISTRATION.md).
