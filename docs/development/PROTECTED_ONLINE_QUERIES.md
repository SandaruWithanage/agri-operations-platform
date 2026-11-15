# Protected online query integration

Read the [accepted data/state/cache ADR](../architecture/decisions/ADR-data-state-cache.md). This is the first incremental TanStack Query integration: the admin farmer audit-history view. Registry/detail and field online operations still require migration. PostgreSQL remains authoritative, and cached capabilities never confer permission.

## Implemented boundary

The admin app pins `@tanstack/react-query` to 5.90.21. Each mounted history boundary owns an in-memory QueryClient. Changing the transport, account, farmer or authorization epoch replaces the boundary; logout, hidden-view clearing and failed parent requests unmount it. Cleanup cancels outstanding work and clears its cache. No shared server singleton, dehydration, query persister, localStorage/IndexedDB record cache or query mutation queue is used.

Keys include the protected domain, account, authorization epoch, explicit read revision, farmer ID, bounded page size and exact microsecond cursor. The epoch is a local lifecycle counter, not a session credential or caller-selected backend scope. Responses must match the expected account and farmer before entering the cache. Each explicit page/latest action has a new read revision and rechecks server authority; previous-page snapshots are not displayed while a new request is pending or denied. The previous unobserved query is immediately eligible for collection.

Queries have zero stale time and zero inactive retention, no automatic retries, and no focus/reconnect refetch. Online reads use `networkMode: always`: unavailable connectivity returns a visible failure rather than pausing a hidden request for later. This deliberately favors a fresh authorized read over page-cache reuse while a server-issued permission-context version is unavailable. These settings are not a blanket policy for future public/reference queries.

TanStack Query owns history records, loading and error state. Component state contains only the selected cursor/read revision. The typed BFF transport combines query cancellation with its existing 15-second timeout. The query function consumes the cancellation signal and checks it again before returning; an adapter that resolves late cannot restore cleared data. The browser receives no JWT or session secret.

## Incremental migration and limits

Continue with registry/detail and field online references/mutations, using tested account/session/device/scope boundaries rather than extending a shared unscoped cache. The current history boundary observes explicit parent lifecycle changes; it does not receive push notifications of server-side permission revocation. Each read remains checked by NestJS and database ABAC/RLS, and denial clears the protected parent view. A future server authorization-context revision or push/poll protocol needs its own contract and tests.

Dexie continues to own encrypted durable drafts and stable mutation IDs. No existing outbox format, pending registration, archive/recovery behavior or minimal farmer-only storage policy is changed. Zustand remains planned for shared non-sensitive UI state, and Redis remains absent and conditional on a confirmed need.

Run the normal installation/format/lint/typecheck/unit/integration/build/browser checks. Component tests cover account and same-account epoch transitions, exact cursors, denied latest-page reloads, cleared caches, late responses, cancellation reaching fetch and React strict lifecycle replay. Existing live PostgreSQL/BFF tests establish current authority; browser adapters alone do not establish security or production readiness.
