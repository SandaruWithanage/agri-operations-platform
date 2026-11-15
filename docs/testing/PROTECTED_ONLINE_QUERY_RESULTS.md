# Protected online query verification — 15 November 2026

Synthetic fixtures only. This records the first TanStack Query migration (admin audit history), not completion of the frontend migration or production acceptance.

- Frozen-lockfile installation, formatting, ESLint, workspace type checks, structure checks and production builds passed.
- The combined backend/frontend suite passed **181 tests in 32 files**, including live PostgreSQL 17.11/PostGIS 3.5.7 authorization, migration and transaction checks.
- Nine history tests cover bilingual rendering without record persistence, exact microsecond cursors, denied next/latest-page cleanup, wrong-account replies, changed farmers, same-account authorization-epoch changes, late responses, cleared caches, StrictMode lifecycle replay and cancellation reaching fetch.
- The history view owns an ephemeral QueryClient rather than copying fetched snapshots into component state. Test inspection confirms old boundaries are empty after replacement/unmount, and a denied fresh request does not retain a successful prior snapshot. Late completion cannot restore the cleared boundary. No automatic retry hides authorization failures.
- Both compiled Chromium journeys passed: field approved-key/encrypted offline restart/recovery/idempotent retry and admin pagination/detail/history, English/Sinhala switching, rejected audit/scope/session cleanup and no browser farmer persistence.

Registry/detail and field online fetching still require migration. No persisted query cache, additional Dexie fields, offline queue, Redis or Zustand store is introduced. The existing parent lifecycle clears history on logout/hidden view/failure; server revocations are checked on each request, not delivered as live push notifications. See [integration and limits](../development/PROTECTED_ONLINE_QUERIES.md) and the [accepted ADR](../architecture/decisions/ADR-data-state-cache.md).
