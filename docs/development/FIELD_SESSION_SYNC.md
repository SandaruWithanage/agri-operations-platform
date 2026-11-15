# Field session queries and synchronization progress

This implements two M2 items from the [accepted state architecture](../architecture/decisions/ADR-data-state-cache.md). PostgreSQL remains authoritative, and Dexie remains the sole durable offline queue. No database or IndexedDB schema migration is required.

## Online session display

The field home screen uses the same pinned TanStack Query version as admin (5.90.21), with a per-mounted, non-persisted QueryClient. Only account/device identity metadata enters this cache; authorized geography references, farmer records, passwords, JWTs and session secrets do not. The pre-authentication query uses a local read revision in its isolated boundary because identity is not known until the server responds. Every explicit session check clears the prior result and starts a fresh server request. No cache is shared across transport instances or server requests.

The transport consumes cancellation and checks the signal after completion. Hidden views, logout, unmount and transport replacement cancel/clear session work; late responses cannot restore signed-in display. Login finishing after a cleared view cannot restart a check. Session checking/loading/error state belongs to TanStack Query rather than a second component-held context. There are no automatic query retries, persisted queries or paused offline requests. No live revocation push channel is implemented; current authority is checked on each request.

The field home still directs registration into the encrypted offline workspace. This integration does not mount a volatile registration form or put Dexie reconciliation into a query mutation queue. Offline verified references remain encrypted in Dexie and are refreshed/revalidated by the existing workspace protocol, independently of the home-screen display query.

## Per-registration Syncing state

During an actual outbox send and acknowledgement write, the selected row displays **Syncing… / සමමුහුර්ත කරමින්…**. The durable row remains `pending-sync` until a validated server result is stored. This is intentional: a process restart, network loss, lock or interrupted acknowledgement leaves an immediately retryable pending mutation with its original UUID and encrypted payload. No persisted `syncing` state or stale-state migration is introduced.

An optional primitive progress observer reports the current mutation ID or null; it never receives the farmer payload. Display-observer exceptions cannot change reconciliation. It clears on success, conflict, rejection or failure. Existing single-flight/idempotency behavior remains in force, with current account/device/assignment checks before synchronization and on the server.

The UI rejects progress from an old/locked model generation and clears it on lock. Snapshot reloads also have a sequence guard so an older pending read cannot replace a newer acknowledgement. Saved, pending, synced, conflict and rejected states retain their existing meaning, retention and recovery rules. Only server-confirmed synced copies can be removed.

## Verification and limits

Run the normal frozen install/format/lint/typecheck/tests/build/browser commands. Focused checks cover cancellation, hidden/transport/strict lifecycle transitions, minimal cache contents, logout/revocation, in-flight durable pending status, interruption, lock/restart with the same mutation ID, and observer failure isolation. The browser journey holds a synthetic network response to assert both language variants of Syncing, then interrupts and retries the same registration.

Land capture/offline GPS, legacy-only/lost-passphrase recovery, managed device erasure, native-speaker/real-device acceptance and production operations remain incomplete. Zustand now provides the [shared locale preference](SHARED_LOCALE.md) without holding field records; Redis remains optional and absent. See [delivery status](PHASE_1_STATUS.md).
