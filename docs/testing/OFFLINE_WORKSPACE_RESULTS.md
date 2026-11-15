# Offline workspace verification — 15 November 2026

All fixtures are synthetic. This report concerns the minimal farmer name/location/privacy-notice workflow; it does not approve pilot devices or establish production readiness.

## Automated results

- Frozen-lockfile dependency installation passed.
- Formatting, ESLint, workspace TypeScript checks and repository structure checks passed.
- 135 unit/integration tests passed with a disposable PostgreSQL 17 instance, including current scoped authorization, revoked coverage rejection and response-loss/idempotent replay through the live NestJS/BFF/database path.
- Production builds passed for both Next.js applications, NestJS and Prisma schema validation.
- Chromium production-server journey passed: secure device-key persistence, public-shell offline process restart, incomplete-draft recovery, inactivity lock, reauthentication, truncated-response retry with stable IDs, synchronized local removal and no private HTTP caching.
- IndexedDB tests cover incomplete-draft restart, legacy schema/KDF compatibility, encryption-versus-lock races, quota recovery, concurrent-editor rejection, suspension persistence and stale-login/logout ordering.

## Limits

Chromium's native durable-storage permission is supplied to an isolated test profile. Synthetic HTTPS adapters exercise the UI without production credentials; separate PostgreSQL tests verify server authority. Native mobile storage persistence, device encryption/management, Sinhala usability and deployment/operational acceptance remain outstanding. Archive import and complete controlled deauthorization/recovery are not included in this change.

See [workspace setup](../development/OFFLINE_WORKSPACE.md) and [Phase 1 inventory](../development/PHASE_1_STATUS.md).
