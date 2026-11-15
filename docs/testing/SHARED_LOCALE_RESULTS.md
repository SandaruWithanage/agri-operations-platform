# Shared locale verification — 15 November 2026

Synthetic fixtures only. Native-speaker, device and accessibility acceptance remain separate gates.

- Frozen-lockfile installation, format, ESLint, workspace type checks, structure and production builds passed.
- **219 tests in 34 files** passed, including live PostgreSQL/PostGIS authorization/migration checks and the existing encrypted offline recovery/idempotency suites.
- Ten preference tests cover shared consumers without form remount/value translation, legacy raw-string hydration without mount writes, malformed/unrelated preference rejection, cross-tab updates/removal/clear without echo writes, sessionStorage isolation, blocked reads/writes, independent minimal stores, server defaults without browser I/O, strict lifecycle cleanup and explicit same-language selection.
- The admin component regression confirms switching language does not fetch farmer records again. Farmer/detail/history and land controls continue to use the same language while keeping online records in TanStack Query.
- Both compiled Chromium journeys passed: actual same-origin cross-tab locale updates, bilingual farmer/land reads and denial cleanup, approved-device/offline restart recovery, bilingual Syncing, interrupted retry, acknowledged cleanup and authenticated archive recovery. Browser storage assertions still permit only the locale preference; private API responses and records do not enter the public HTTP cache.

The shared library pins Zustand 5.1.0, creates a store per workspace, persists only the validated raw `en`/`si` value under the existing key and exposes no business-data/credential fields. No database, IndexedDB or preference format migration is required. Different origins keep independent preferences. Redis remains absent; TanStack Query and Dexie retain their existing ownership. See [setup/behavior](../development/SHARED_LOCALE.md) and [the accepted architecture](../architecture/decisions/ADR-data-state-cache.md).
