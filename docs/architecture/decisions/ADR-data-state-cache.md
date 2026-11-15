# ADR — Data, state, caching and offline persistence

**Status: Accepted Architectural Decision.** Accepted by the project owner on 15 November 2026. Selection of these technologies does not mean every component is implemented, and does not approve provisional business rules or certify production readiness.

Read this ADR before selecting or changing data/state/cache/offline approaches. A conflicting requirement needs an explicit tradeoff and an updated/superseding ADR; do not silently replace the architecture. This decision supplements the existing hybrid authentication, ABAC/RLS and encrypted offline decisions in [the decisions directory](../../decisions/).

## Responsibilities and sources of truth

| Technology           | Responsibility                                                                                                                         | Implementation at acceptance                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL + PostGIS | Authoritative business/geospatial data, integrity, sessions, roles/permissions/assignments, ABAC/RLS, audit and offline reconciliation | PostgreSQL authentication, farmer workflows, audit and idempotency are implemented. Local PostGIS Compose is configured; land/GPS domain work is not yet implemented/verified on main. |
| Redis                | Optional distributed infrastructure: selected reference/configuration caches, measured aggregates/rate limits, future workers          | Not installed or required. Introduce only for a confirmed use case.                                                                                                                    |
| TanStack Query       | Online server-state fetching, cache identities, loading/error/mutation state, invalidation and synchronization                         | Not installed. Existing online fetching uses the typed BFF transport and local React state; M2 migration is required.                                                                  |
| Zustand              | Small, shared, non-sensitive UI state                                                                                                  | Not installed. Locale/preferences and UI coordination currently use local React state. Introduce only for actual shared UI needs.                                                      |
| Dexie.js + IndexedDB | Durable authorized offline drafts, reference data, pending mutations, synchronization/conflict/recovery state                          | Encrypted minimal farmer drafting, retries and archive recovery are implemented. Land/GPS offline records and full lifecycle/erasure acceptance remain unfinished.                     |

[Delivery status](../../development/PHASE_1_STATUS.md) tracks later progress. The table above records the acceptance baseline; an accepted design is not evidence of completed implementation. Keep one owner for each kind of state rather than maintaining competing copies.

## Compatibility and implementation gaps

There is no conflict with the selected hybrid session/JWT/BFF authentication, database ABAC/RLS, encrypted Dexie persistence or approved-device decisions. Existing PostgreSQL-backed shared login throttling is compatible with optional Redis; do not replace it just to install the selected infrastructure.

The concrete gaps are online server fetching/loading state still held in local React code instead of TanStack Query, and shared locale/UI coordination not yet using Zustand. Component-local form state remains appropriate. The next M2 integration must replace duplicated server-state handling rather than adding a competing cache beside it. Older M0/ADR implementation notes are historical snapshots; the current roadmap/inventory identify what is implemented now. No library or runtime migration is performed by accepting this document.

## PostgreSQL authority

PostgreSQL owns farmers/personal information, land/GPS, organizational/CBO structures, projects/enrollments, officer assignments, resources/inventory, sessions, roles/permissions/ABAC attributes, RLS, audit, approved plans/history and offline mutation reconciliation. Use Prisma for suitable application access; use reviewed native SQL for RLS, functions, complex constraints and critical transactions. Redis and frontend state must never substitute for database integrity or authorization.

Existing native idempotency journals reconcile submitted mutations. They are not a general business-event transactional outbox. Important business events must first be recorded atomically in a PostgreSQL outbox before any future worker/BullMQ handoff.

## Redis: optional infrastructure

Keep Redis optional, including for the first farmer registration workflow. Confirm and measure a use case before adding a dependency or sophisticated cache. Candidates at M3 or later include project-type/reference catalogs, administrative divisions, versioned forms/configuration, selected dashboard aggregates, shared rate limiting, notifications and report/background processing.

Use cache-aside with explicit TTLs, invalidation and relevant version/scope identities. Ordinary reference-cache failures fall back to PostgreSQL without breaking core operations. Design security-critical failure behavior separately and test it. The existing shared PostgreSQL login throttle remains authoritative until a replacement is explicitly designed and verified.

Redis is not the authority for farmer data, inventory, sessions or permissions. Do not globally cache authenticated API responses. Protected farmer records or protected aggregates require an explicitly reviewed authorization-aware caching strategy before caching. A reference table can be shared infrastructure data while an authorized reference response is scope-dependent: never reuse one user's filtered response for another user.

## TanStack Query: online server state

Use TanStack Query in both Next.js applications for farmer registries, projects, land, assignments, authorized dashboards, API mutation status and query invalidation/loading/errors. Continue using the typed same-origin BFF transport. Use structured query keys containing the relevant domain, record/filter/page identity and current authorization context. Locale belongs in an identity only when it affects server output; do not translate entered names automatically.

Sensitive queries must be isolated across authenticated users, sessions and permission-scope changes. Cancel in-flight work, clear/remove or invalidate protected cache entries and prevent late responses from restoring cleared data during logout, revocation, account/device/session/scope transitions and protected-view clearing. Default to no durable sensitive query-cache persistence. Test cross-user and cross-scope isolation and invalidation before replacing the current request-generation protections.

Cached data or capability hints never grant current authorization. Protected operations still revalidate current session and permissions in NestJS and PostgreSQL. Do not copy fetched business records into Zustand. TanStack mutation/network status is not a second durable offline mutation queue; Dexie retains the pending payload and stable ID until authoritative reconciliation.

## Zustand: shared UI state only

Use small, domain-specific Zustand stores for shared locale, sidebar/display preferences, modal/drawer coordination, temporary non-sensitive selections and multi-panel UI coordination. Keep single-component state local, and use URL search parameters for shareable filters/pagination where appropriate.

Do not store JWTs, session/refresh secrets, passwords, authoritative farmer/project records or duplicated TanStack Query results in Zustand. Persist only explicitly selected non-sensitive preferences, such as `en`/`si`; do not persist an entire store by default. English/Sinhala switching must remain consistent across views.

## Dexie: durable offline work

Dexie owns necessary authorized reference data, farmer/land drafts, GPS capture, pending mutations, synchronization and conflict/recovery information on field devices. PostgreSQL remains authoritative after sync. Use client-generated entity UUIDs, unique stable mutation UUIDs, server idempotency, record versions, safe retries, explicit pending/syncing/synced/rejected/conflict presentation, retention and recovery procedures. Do not silently overwrite conflicts or permanently discard unsynchronized work without safeguards.

Cache the minimum required data. IndexedDB does not supply application encryption by itself. Keep the approved-device, local unlock, application encryption, inactivity locking and recovery controls; never put authentication tokens in IndexedDB. Reauthenticate and reauthorize on the server during synchronization. The current minimal farmer-only offline policy remains in force until device/storage security and an expanded dataset are reviewed; this ADR does not automatically enable offline GPS or documents.

Do not replace existing durable queues with a query persister or a second mutation queue. Upgrades must preserve legacy encrypted drafts, IDs, failed-write recovery snapshots and pending submissions. A future per-mutation Syncing state needs interruption/restart behavior that returns safely to a retryable pending state rather than losing or duplicating work.

## Authentication and caching boundary

Retain PostgreSQL-backed sessions, Secure/HttpOnly cookies, short-lived BFF-to-NestJS JWTs, current-session checks, CSRF and database ABAC/RLS. Derive actor/scopes from authenticated server state. Never trust client account IDs or JWT role claims as authoritative permission sources. No frontend library or shared cache may override these controls or expose complete protected records/permissions across contexts.

## Timing and acceptance

- **M0:** monorepo/apps/shared packages and PostgreSQL/PostGIS foundations; document this architecture. M0 is complete. Do not restart it or add infrastructure merely because this ADR lists it.
- **M1:** PostgreSQL schemas, sessions/authentication, ABAC/RLS and automated authorization tests; suitable Prisma/native SQL integration remains the persistence boundary.
- **M2 (current):** adopt TanStack Query for online operations; introduce Zustand for confirmed shared UI needs; retain Dexie as the durable farmer workflow. Extend offline land/GPS only with explicit data/device controls and reconciliation tests.
- **M3:** consider Redis only after a confirmed/measured cache, rate-limit, aggregate or worker requirement. Optional Redis failures must be tested, and security-critical failures must have explicit behavior.
- **Later:** scale caching/background work from real workloads, security review and deployment evidence. Use a PostgreSQL transactional outbox for important worker events.

The [roadmap](../../development/ROADMAP.md) and existing [remaining-work backlog](../../development/PHASE_1_STATUS.md#remaining-engineering-work) identify follow-up tasks. Library integration must include TypeScript contracts, unit/integration tests, cache cancellation/invalidation and scope-change tests, offline retry/duplicate/conflict tests, and documented operational limits. Do not install every planned technology as part of this documentation decision.
