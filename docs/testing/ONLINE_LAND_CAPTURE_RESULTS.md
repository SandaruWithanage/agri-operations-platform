# Online land capture verification — 16 November 2026

Synthetic PostgreSQL 17/PostGIS 3.5 database, Node 26.13.1 and pnpm 12.21.0 with the current pinned stable toolchain. No production records, credentials or physical-device coordinates were used.

## Evidence

- Full suite: **363 tests in 49 files passed**, including native land permission/idempotency/audit and NestJS/BFF/PostgreSQL integration tests.
- Focused land/form/transport and administrator-registration regression group: **55 tests in five files passed**. The common online-creation controls retain the existing account/device/visibility/transport/inactivity, exact retry, late-response, explicit-discard, conflict and no-automatic-reconnect tests.
- Land-specific checks cover independent creation catalogs, account/device transitions around reference reads, cancellation, revoked coverage, missing/wrong/invalid expected devices before POST, optional metadata, zero values, partial/out-of-range coordinates, orphan accuracy, invalid area/precision, immutable replay, Sinhala preservation and create-without-read refresh.
- GPS checks prove explicit fresh high-accuracy requests with a ten-second timeout, no automatic tracking, permission/invalid/insecure failures, cancellation and late callbacks after edits or locking. Missing GPS does not block registration; reported area is never inferred.
- Lint, formatting, workspace type-checks and production builds passed. No dependency version, native migration or database grant is added by this feature.
- Both Chromium scenarios passed. The admin flow uses synthetic browser location permission/coordinates, checks explicit GPS and language switching, hides/reopens the tab draft, loses the first acknowledgement, retries the identical request and refreshes an empty create-only land directory. It also reruns farmer registry/review/verification/correction/registration and checks no admin data in IndexedDB/localStorage. The field flow still proves encrypted offline process restart, exact synchronization retry and archive recovery.

The real-browser check required an explicit label association for the land-location selector; the final flow passes using the user-facing label. A bounded GPS wait prevents an unavailable browser location from leaving CI waiting indefinitely.

## Limits

The synthetic browser's geolocation permission is not physical-device or GPS-quality acceptance. Land remains reported identification only, without ownership, legal boundaries, verified acreage, point containment, farmer/project relationships, maps, correction or offline GPS. Tab-only values/IDs can be lost on reload or termination; the notice and leave-page guard do not implement durable recovery. Broader production, native-speaker, accessibility, operational and client acceptance remain unfinished. See [operator/setup guidance](../development/ONLINE_LAND_CAPTURE.md) and [ADR 0015](../decisions/ADR-0015-online-land-capture.md).
