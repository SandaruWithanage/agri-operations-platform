# ADR-0008 — Authenticated offline archive recovery

Status: provisional technical implementation. This extends ADR-0007; pilot device/OS, operational and Sinhala acceptance remain outstanding.

## Recovery boundary

An unlocked vault can export a version 2 archive. A fresh random AES-GCM IV seals the complete version 1 preservation snapshot, including its row identities, statuses and any retained encrypted write-failure snapshot. The existing vault key encrypts the envelope; its salt and bounded KDF iterations allow the original passphrase to derive that key. The archive binding is authenticated additional data. Device private keys, browser cookies and API tokens are excluded.

The reader limits input size, KDF work, record counts and field lengths. It authenticates the envelope and every inner encrypted record, validates the original account/device binding and strictly validates the minimal registration dataset before writing target records. It never imports historical geography references as current authority.

Recovery requires a current online session on an approved device, with the original account. A replacement device must complete normal independent enrollment; possession of an archive does not approve a device or authenticate an account. Cross-account transfer is not implemented. Server rejection during the authorization refresh suspends local access and preserves existing ciphertext.

## Preservation and synchronization

The target vault must contain no working drafts or mutations. All imported records are reencrypted with its independent key. One IndexedDB transaction adds the complete set or rolls it back; concurrent writes, a storage failure or locking cannot silently overwrite existing target data. The original file is never deleted.

Mutation and farmer UUIDs remain unchanged. Archived Synced is not treated as a new server confirmation: those records return to Saved on Device, as do pending/saved submissions. Conflicts and rejections remain for review. Sync revalidates current authorization and uses the original mutation IDs, including when the original server commit succeeded but its response was lost.

All distinct durable and unsaved incomplete versions are retained in separate encrypted recovery slots. Continuing one moves it atomically to the active working slot only if that slot is empty. Another version is never overwritten. Conflicting payloads with the same farmer UUID still require review; recovery does not merge them or grant update authority.

## Remaining limits

Locked export preserves the legacy version 1 ciphertext snapshot. Supported automatic import requires version 2: unlock the original vault and export again. Legacy-only archive recovery, lost-passphrase recovery, cross-account reassignment and administrative conflict correction remain separate work. Do not discard a legacy archive or wipe a device merely because automatic import refuses it.

The UI requires explicit file selection and acknowledgment that the original archive is retained. It clears archive/passphrase inputs after success or failure. The file is sensitive ciphertext and requires controlled handling. Logical IndexedDB removal does not establish forensic erasure, and this workflow does not certify OS encryption or backup operations.
