# Protected online query verification — 15 November 2026

Synthetic fixtures only. This records the TanStack Query migration of admin registry/detail/audit reads, not completion of the frontend migration or production acceptance.

- Frozen-lockfile installation, formatting, ESLint, workspace type checks, structure checks and production builds passed.
- The combined backend/frontend suite passed **192 tests in 32 files**, including live PostgreSQL 17.11/PostGIS 3.5.7 authorization, migration and transaction checks.
- Nine history tests cover bilingual rendering without record persistence, exact microsecond cursors, denied next/latest-page cleanup, wrong-account replies, changed farmers, same-account authorization-epoch changes, late responses, cleared caches, StrictMode lifecycle replay and cancellation reaching fetch.
- Seventeen registry tests cover actor-bound records, both languages, direct detail identity binding, permission failures without retries, transport/account transitions, hidden-view/logout/unmount cleanup, late login/context/list/detail responses, cancelled fetches and StrictMode.
- The admin read views own ephemeral QueryClients rather than copying fetched records into component state. Test inspection confirms old boundaries are empty after replacement/unmount, and a denied fresh request does not retain a successful prior snapshot. Late completion cannot restore the cleared boundary. No automatic retry hides authorization failures.
- Both compiled Chromium journeys passed: field approved-key/encrypted offline restart/recovery/idempotent retry and admin pagination/detail/history, English/Sinhala switching, rejected audit/scope/session cleanup and no browser farmer persistence.

Field online fetching and future domain mutations still require migration. No persisted query cache, additional Dexie fields, offline queue, Redis or Zustand store is introduced. The existing parent lifecycle clears history on logout/hidden view/failure; server revocations are checked on each request, not delivered as live push notifications. See [integration and limits](../development/PROTECTED_ONLINE_QUERIES.md) and the [accepted ADR](../architecture/decisions/ADR-data-state-cache.md).
