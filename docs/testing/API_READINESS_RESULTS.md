# API readiness verification

Verified on 16 November 2026 using Node 22 and a disposable synthetic PostgreSQL 17/PostGIS 3.5 service.

- Frozen installation, repository structure, lint, formatting, TypeScript and production builds passed. Final lint/format checks were repeated after resolving the driver's per-query-timeout type declaration gap.
- All 278 tests across 41 files passed, including an HTTP readiness check on the real nine-role API runtime and disabled-runtime HTTP status/body/no-store assertions.
- Five readiness tests cover all/empty/failed/throwing dependencies, concurrent probe sharing, monotonic cache expiry, timeout without overlapping batches, late settlement, shutdown and sanitized controller failures.
- Both production Chromium workflows passed. The admin fixture also starts the compiled API with the runtime disabled and verifies `/ready` returns the sanitized non-cacheable 503 while `/health` remains available.

The SQL probe reads primary/read-only transaction state without accessing business records. Automated connectivity and process tests do not prove production schema correctness, database failover, proxy/TLS behavior, load capacity, backup restoration, key management or real-device acceptance. See [probe semantics and deployment limits](../development/API_READINESS.md).
