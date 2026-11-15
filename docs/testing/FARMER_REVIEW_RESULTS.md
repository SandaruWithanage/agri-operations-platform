# Farmer review API verification — 15 November 2026

All fixtures are synthetic. This verifies a provisional online API; it does not complete the admin editor or establish client/production acceptance.

- 155 unit/integration tests passed with disposable PostgreSQL 17. Subsequent targeted integration checks also passed for direct native-function denial, runtime UPDATE/journal access denial and preserving Inactive status during correction.
- The live NestJS/BFF/database flow checks separate read/verify/correct permission requirements; original/destination coverage; strict bodies; stable identical retries; changed-payload and stale-version conflicts; preserved creator; version/audit/session linkage; duplicate-risk flagging; atomic audit-failure rollback/retry; competing edits with one success/one conflict; and current revocation before replay.
- BFF/SDK checks cover CSRF, response sanitization, actor changes, unchanged retained retry IDs/payloads, malformed acknowledgments and bounded versions.
- Formatting, ESLint, workspace type checks and production builds passed. The combined Chromium field/admin journeys passed, including compiled API startup, encrypted offline restart/recovery, scoped registry/pagination and session-rejection cleanup.
- Native manifest entry 12 adds only the version/index/change journal/restricted functions and policies. Existing names, statuses, creator IDs and registration sources are preserved during migration.

The admin detail view shows a bilingual possible-duplicate hint based on currently visible records. Its review/correction editor, audit-history permissions/viewing, full lifecycle/reassignment, client verification criteria, retention and tested mutation-key rotation remain release work. See [ADR-0009](../decisions/ADR-0009-online-farmer-review.md) and [API setup](../development/FARMER_REVIEW_API.md).
