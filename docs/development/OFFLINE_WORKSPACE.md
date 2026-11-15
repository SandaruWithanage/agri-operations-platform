# Field offline workspace

Follow [device enrollment](DEVICE_ENROLLMENT.md) and [pilot runtime setup](PILOT_AUTH_RUNTIME.md) first. Authentication remains disabled unless fully configured. Use synthetic data; production/pilot-device acceptance is unfinished.

## Prepare and use

1. Sign in online on the configured HTTPS field origin using the provisioned account, MFA and enrolled browser key. Open **encrypted offline workspace**. The sign-in page no longer accepts farmer registrations directly.
2. Select the account/device vault and choose a separate offline passphrase (12–256 characters). First setup requires current online account/device verification. The app asks the browser for persistent storage and verifies that its public offline shell is prepared. If approval/preparation is missing, new offline entry stays disabled. Install the PWA, close older app tabs and reopen while connected; contact the administrator if the readiness message persists.
3. Enter the farmer's name in either language, choose a configured authorized GN/village and confirm the privacy notice. Incomplete edits autosave encrypted on the device. Wait for **Saved on Device** before closing/restarting; saving/failed-write warnings mean the newest edit is not yet guaranteed durable. No NIC, contact data or supporting documents are stored offline.
4. Complete the registration locally. It appears as Saved on Device, then Pending Sync when queued. Connectivity and unlock trigger sync; **Sync Now** is also available. Sync uses a fresh session, exact account/device binding and current server/database authorization. If the session expires or is rejected, sign in again with the original account/device; local data is retained. A copied device ID is insufficient.
5. Synced, Conflict and Rejected states are explicit. A conflict/rejection does not overwrite or merge records. Administrative review/correction is still separate unfinished work. Remove a local copy only after it is Synced. Local copies are submission/recovery data, not a grant to read current server farmer records; ongoing server reads require separate authorization.

The default local drafting/view window is one hour from online verification; the server can configure 60–86400 seconds with `PILOT_OFFLINE_SECONDS`. Idle views lock after five minutes and when hidden. Expired/suspended/missing-key vaults retain ciphertext; reconnect and reauthenticate before viewing/editing, or export the encrypted archive for controlled recovery. No offline token bypasses synchronization authorization.

## Recovery limits

A wrong passphrase never resets/deletes a vault. Keep the offline passphrase safe; automated lost-passphrase recovery is not implemented. Each account/device has its own encrypted vault. An exclusive Web Lock prevents normal parallel editing; unsupported browsers allow recovery rather than new entry. Revision conflicts preserve both the durable record and an encrypted in-memory recovery snapshot. **Retry device save** retries the failed predecessor only; it does not overwrite a different tab's version.

For a quota/storage failure, keep the page open and free space or export the encrypted archive before leaving. The export includes a retained in-memory recovery snapshot. A browser navigation warning is a safeguard, not protection against a killed process, OS reset, origin eviction or physical loss. Archive import and controlled recovery to a replacement approved device are not yet implemented; exported ciphertext is preserved for that process. Do not claim the export button alone is a completed disaster-recovery procedure.

Device revocation/server rejection blocks local access after it is learned; a disconnected device cannot learn a new server revocation immediately. Local windows are bounded and configurable. This is not remote forensic erasure. Do not delete unsynchronized drafts on deauthorization; follow controlled recovery/managed-device procedures before wiping. Pilot OS encryption, browser persistence behavior, local authentication policy and secure removal must still be demonstrated on actual devices.

## Verification

`pnpm test` with the disposable `agri_test` service verifies encrypted draft restart/recovery, legacy KDF/schema compatibility, quota/write recovery, parallel-editor rejection, current-authority synchronization and RLS. The live NestJS/BFF/PostgreSQL test loses a response after a committed registration, replays the same mutation, and verifies one server record; revoked coverage produces a retained Rejected entry.

`pnpm build` then `pnpm test:browser` tests Chromium public-shell/asset caching, process restart with connectivity disabled, incomplete-draft recovery, local locking, reauthentication, stable sync retry and synchronized local cleanup. The browser test supplies synthetic HTTP adapters and grants a native Chromium persistence permission to the isolated fixture context and uses native transport/connectivity emulation; the separate server/database test verifies authoritative behavior. Test certificates/permission setup do not certify a production deployment or actual mobile devices. See [ADR-0007](../decisions/ADR-0007-offline-drafting-and-sync.md).
