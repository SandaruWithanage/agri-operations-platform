# Authenticated archive recovery verification — 15 November 2026

All fixtures are synthetic. This change extends the offline workspace; it does not certify production operations or pilot devices.

- 143 unit/integration tests passed against disposable PostgreSQL 17.
- The live NestJS/BFF/PostgreSQL flow commits a registration, loses its response, exports the pending mutation, removes the synthetic local vault, restores under a new local passphrase and replays the same mutation ID. The database contains one farmer. Revoked coverage still produces a retained Rejected submission.
- Archive tests verify same-account replacement-device rekeying, retention of durable and unsaved draft versions, exact mutation IDs, wrong-password/tampering/truncation rejection, nonempty-target refusal, atomic storage-failure rollback/retry, legacy-format refusal and bounded input. Historical Synced does not permit local removal before fresh server confirmation.
- The workspace test verifies online authorization precedes import and known revocation suspends local access without removing existing work.
- Chromium passed the existing secure-context/offline-restart/locking/reauthentication/idempotent-sync checks plus version 2 archive download, simulated local vault loss, restore under a different passphrase, passphrase-input clearing and incomplete-draft continuation.
- Formatting, ESLint, workspace TypeScript checks and production builds passed. No dependency or database migration changes are required.

The browser fixture uses synthetic HTTPS adapters and native persistence/connectivity emulation. Same-account cross-device data rekeying is covered by unit tests; actual replacement-device approval, OS security, storage behavior, Sinhala/native-speaker acceptance and operational recovery must still be demonstrated. Lost-passphrase recovery, legacy-only import, administrative conflict correction and forensic erasure remain unimplemented. See [ADR-0008](../decisions/ADR-0008-authenticated-archive-recovery.md) and [setup/recovery steps](../development/OFFLINE_WORKSPACE.md).
