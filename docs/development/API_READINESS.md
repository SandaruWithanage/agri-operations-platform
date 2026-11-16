# API liveness and dependency readiness

`GET /health` is process liveness. It stays available when the optional pilot runtime is disabled and reports that database/authentication were not checked. Do not restart a healthy API solely because a dependency is temporarily unavailable.

`GET /ready` is a separate deployment dependency probe. It returns HTTP 200 with `{"status":"ready"}` only when the configured pilot runtime can query every one of its ten configured restricted database connections, each on a primary with transactions not configured read-only. Disabled runtime, unavailable connection, read-only target, failed probe, deadline or shutdown returns HTTP 503 with `{"status":"not-ready"}`. Responses prohibit HTTP caching and contain no connection URLs, account data, credentials or dependency diagnostics. It is not exposed through the browser BFF.

The probe performs only `SELECT`, without actor context or business-record reads/writes. Runtime startup's least-privilege checks remain unchanged. No owner connection or new database grant is required. Each SQL probe has a 1.5-second client query timeout, and the public batch answer is bounded to two seconds. Existing pool acquisition/server timeouts still apply underneath; a response timeout does not pretend to cancel outstanding PostgreSQL work.

Concurrent requests share one batch. Positive and negative answers are retained in memory for two seconds using a monotonic clock. If a timed-out batch is still settling, new requests share its failed answer rather than enqueue another batch. A late success cannot rewrite the timed-out result. Readiness is stopped before pool shutdown; Nest handles SIGTERM/SIGINT through enabled shutdown hooks.

Configure a reverse proxy/orchestrator to route application traffic only after `/ready` succeeds. A reasonable starting probe interval is five seconds with a request timeout longer than two seconds, adjusted from measured deployment behavior. Restrict direct API network exposure to the intended proxy and monitoring network. Infrastructure is not deployed automatically by this change.

## Limits and acceptance

Readiness is dependency connectivity evidence, not an authenticated business transaction, migration-history/schema certification, MFA-key decryption check, independent authorization audit or production-readiness score. Startup validates the configured runtime/roles; apply and verify migrations separately through the manifest runner before rollout. A cached positive result can precede a dependency failure by up to two seconds. Session, permission and RLS checks still apply on every protected action.

Unit tests cover all-success, empty/failed/throwing dependencies, cache expiry, concurrent request sharing, deadline/no-overlap behavior, late settlement and shutdown. HTTP/live integration covers disabled runtime and the configured ten-role synthetic PostGIS request flow. The production browser check also verifies compiled disabled readiness and no-store behavior. Actual proxy/TLS routing, network isolation, rollout/load limits and operator acceptance remain deployment work.
