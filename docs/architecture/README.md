# Platform architecture

The accepted [data/state/cache ADR](decisions/ADR-data-state-cache.md) defines the technology responsibilities and implementation timing. Read it with [project context](../PROJECT_CONTEXT.md), the existing [security/offline decisions](../decisions/), [delivery status](../development/PHASE_1_STATUS.md) and [roadmap](../development/ROADMAP.md). Accepted architecture and implemented behavior are separate claims.

## Applications and domains

- `apps/admin-web`: independent online administrative interface with scoped farmer list/detail and separately authorized audit history.
- `apps/field-pwa`: independent bilingual field interface, approved-browser key handling, encrypted minimal farmer drafts and idempotent current-authority synchronization.
- `apps/api`: NestJS authentication/session/device orchestration and domain services using trusted transaction actor context and restricted PostgreSQL identities.
- `database`: versioned native SQL owns advanced integrity, transactional functions, ABAC/RLS and audit. Prisma is available for suitable application-level access; its current schema remains intentionally minimal.
- `packages/ui`, `design-tokens`, `domain-types`, `validation`, `i18n` and `sync-client`: explicit shared presentation/contracts/localization/transport/offline boundaries.
- `infrastructure`: local PostgreSQL/PostGIS Compose. Production deployment/operations and actual pilot-device acceptance remain unfinished.

Domain services own their validation, transactions and persistence contracts. Cross-domain access uses explicit interfaces and scoped relationships. No organization zones, projects or business roles are fixed in application code. GPS identifies reported land locations; legal surveys and payment-grade acreage are outside this phase.

## State ownership

| Layer                                                            | Owner                         | Guardrail                                                                                                                                           |
| ---------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server business records, sessions, scopes, audit, reconciliation | PostgreSQL + PostGIS          | NestJS and database ABAC/RLS remain authoritative.                                                                                                  |
| Online fetched records, request/mutation state, invalidation     | TanStack Query, planned at M2 | Isolate auth contexts; cancel/purge protected caches; no sensitive persisted query cache. Current online views still use local React request state. |
| Shared locale/layout/temporary non-sensitive UI coordination     | Zustand, planned where needed | Keep component-only state local; no secrets or business-record copies.                                                                              |
| Durable field drafts, reference snapshots and pending mutations  | Dexie + IndexedDB             | Approved device, minimum dataset, encryption/local lock, recovery and server reauthorization. TanStack is not a second durable queue.               |
| Selected measured cache/rate-limit/worker infrastructure         | Optional Redis at M3+         | No global authenticated cache or authoritative sessions/permissions; database fallback for ordinary reference caches.                               |

The browser calls its same-origin Next.js BFF. Session cookies stay HttpOnly; short-lived API JWTs remain server-only. NestJS and PostgreSQL recheck current authorization for protected operations and synchronization. Frontend cache identities and capability hints improve isolation/UI behavior but do not grant access.

Important future worker events require a PostgreSQL transactional outbox before worker delivery. Existing idempotency journals and the Dexie outbox serve different purposes; neither implies a completed general business-event relay.

## Current gaps

TanStack Query and Zustand are accepted but not installed/integrated. Redis is optional and absent. The current PostgreSQL shared login throttle remains in use. Farmer offline persistence and encrypted archive recovery are implemented; offline GPS, full deauthorization/erasure, optional sensitive fields and actual device security still require work. Do not grow custom server-state infrastructure instead of completing the planned TanStack integration.

[M0_FOUNDATION.md](M0_FOUNDATION.md) is the historical M0 snapshot, not today's implementation inventory. Historical ADR implementation notes also describe their original milestone; use delivery status for current behavior. Passing development tests does not establish production operating conditions.
