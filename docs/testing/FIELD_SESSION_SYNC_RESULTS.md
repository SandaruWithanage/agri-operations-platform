# Field session and sync-progress verification — 15 November 2026

Synthetic fixtures only; this is not production or pilot-device certification.

- Frozen-lockfile installation, formatting, ESLint, workspace type checks, structure and production builds passed.
- **209 tests in 33 files** passed, including live PostgreSQL 17.11/PostGIS 3.5.7 authorization/migration/transaction checks and existing encrypted recovery/replay coverage.
- Seven field-home component tests cover approved-device/sign-in behavior, bilingual errors, minimal cached identity metadata, cancellation and late responses after hiding, logout clearing, revoked session refresh without retry, client replacement and React strict lifecycle replay. Farmer/reference arrays and credentials are not placed in the session-display cache.
- New encrypted outbox tests hold a send in flight and prove the durable status remains pending, lock before acknowledgement, reopen/unlock the same database and retry the original mutation UUID/payload. Network interruption clears progress without losing data. A throwing display observer cannot change conflict reconciliation or delete the draft.
- Workspace integration confirms progress is forwarded around an authorized send and cleared after rejection; current account/device authorization, suspension, conflict preservation, working-draft recovery and archive behavior retain their existing tests.
- The compiled field Chromium journey holds a synthetic request while checking English/Sinhala Syncing, then interrupts and retries it. It also covers browser restart, encrypted draft recovery, inactivity locking, reauthentication, acknowledged cleanup, authenticated archive recovery and no private HTTP cache. The compiled admin journey remains part of the regression gate.

There is no database/IndexedDB schema change, persisted syncing state, extra offline dataset, query persister or second durable queue. Per-row Syncing is a transient overlay until the existing pending row receives a validated acknowledgement. No new server-side permissions are inferred from query state. See [implementation and remaining limits](../development/FIELD_SESSION_SYNC.md) and [the accepted architecture](../architecture/decisions/ADR-data-state-cache.md).
