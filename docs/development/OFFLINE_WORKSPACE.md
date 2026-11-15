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

For a quota/storage failure, keep the page open and free space or export the encrypted archive before leaving. The export includes a retained in-memory recovery snapshot. A browser navigation warning is a safeguard, not protection against a killed process, OS reset, origin eviction or physical loss. Unlocked export creates a version 2 authenticated archive, which can be restored into an empty vault on an approved device using the same account and original archive passphrase. Locked export preserves version 1 ciphertext; automatic import does not accept it. Keep legacy files and unlock the original vault to export version 2 when possible. Lost-passphrase and legacy-only recovery still require a separate procedure.

Device revocation/server rejection blocks local access after it is learned; a disconnected device cannot learn a new server revocation immediately. Local windows are bounded and configurable. This is not remote forensic erasure. Do not delete unsynchronized drafts on deauthorization; follow controlled recovery/managed-device procedures before wiping. Pilot OS encryption, browser persistence behavior, local authentication policy and secure removal must still be demonstrated on actual devices.

## Restore an authenticated archive

1. On the original unlocked vault, choose **Export encrypted archive** and retain the file and its original offline passphrase securely. The file contains the complete authenticated snapshot, including incomplete and retained recovery versions. It contains no device private key or server session credential.
2. If replacing a device, complete normal operator approval/key enrollment first. Sign in online with the same account and prepare an empty vault with its own offline passphrase. Confirm the deployment/account before selecting an archive; an archive does not grant access to a different account or organization.
3. Open **Restore an authenticated archive**, select the version 2 file, enter its original passphrase and acknowledge retention of the original. The target must be empty; import refuses existing farmer work and rolls back on any storage failure. Inputs clear after the attempt. The original file is never removed.
4. Completed submissions retain their IDs. Use **Sync Now** to get a current server confirmation; a historical Synced label is not accepted as proof on the replacement vault. Conflicts/rejections remain for review.
5. Each incomplete version appears under **Recovered incomplete drafts**. Choose **Continue this draft** only when no active draft exists. Complete or safely retain the active draft before choosing another. Recovery does not merge different payloads sharing one farmer UUID.

Archives are bounded to 10 MB input, 5000 completed mutations and 100 stored incomplete slots; export also bounds its plaintext snapshot. Reduce synchronized local copies through the normal confirmed-removal action before reaching these limits. Never remove pending work to fit an archive. Keep the original device/files and seek controlled recovery if a limit or legacy format prevents automatic import.

## Verification

`pnpm test` with the disposable `agri_test` service verifies encrypted draft restart/recovery, legacy KDF/schema compatibility, quota/write recovery, parallel-editor rejection, current-authority synchronization and RLS. The live NestJS/BFF/PostgreSQL test loses a response after a committed registration, replays the same mutation, and verifies one server record; revoked coverage produces a retained Rejected entry.

`pnpm build` then `pnpm test:browser` tests Chromium public-shell/asset caching, process restart with connectivity disabled, incomplete-draft recovery, local locking, reauthentication, stable sync retry and synchronized local cleanup. The browser test supplies synthetic HTTP adapters and grants a native Chromium persistence permission to the isolated fixture context and uses native transport/connectivity emulation; the separate server/database test verifies authoritative behavior. Test certificates/permission setup do not certify a production deployment or actual mobile devices. See [ADR-0007](../decisions/ADR-0007-offline-drafting-and-sync.md) and [ADR-0008](../decisions/ADR-0008-authenticated-archive-recovery.md).
