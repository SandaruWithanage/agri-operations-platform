# ADR-0007 — Minimal encrypted field drafting and current-authority sync

Status: provisional implementation architecture. Initial timeout limits are technical defaults, not client-approved business requirements. Device/OS and Sinhala/mobile acceptance remain outstanding.

## Workflow and authority

Field sign-in/enrollment leads to a dedicated encrypted workspace. There is no separate volatile field registration form. A successful, current online session supplies account/device IDs, the enrolled public-key fingerprint, authorized configured location choices and a bounded local drafting window. NestJS derives the actor from the authenticated session and obtains choices under the signed PostgreSQL actor/RLS context. The cached context is drafting configuration, not a JWT or server credential. No server endpoint accepts it as authorization.

The initial drafting window is one hour, configurable through `PILOT_OFFLINE_SECONDS` from 60 to 86400 seconds. Local views lock on expiry, an unavailable/mismatched registered key, or known server rejection. A separate offline passphrase unlocks the vault; the default inactivity timeout is five minutes and the UI also locks when hidden. Sync always requires a current server session and rechecks account, approved device, permissions, assignments, core fields, mutation identity and duplicate risks. Client state and JWT role claims do not supply authoritative scopes.

Browser persistence approval and a prepared public application shell are required before new offline drafts can be edited. Unsupported/unprepared browsers retain recovery access without enabling new offline entry. A browser profile key proves browser-key possession; it does not prove OS encryption, device integrity or hardware attestation. Only the minimal dataset is cached until pilot device security is demonstrated.

## Data and recovery

Vaults are partitioned by trusted account/device UUIDs. The local catalog stores only those identifiers, verification time, a restrictive suspension flag and a per-device logout generation. Context refresh cannot clear suspension. Only a new successful online login can clear it, provided no newer local logout/rejection occurred while that login was in flight. Location references, incomplete working drafts, completed mutations and any retained write-failure snapshot are AES-256-GCM encrypted. New vaults use PBKDF2/SHA-256 with 600000 iterations, a random salt, and a 12–256 character offline passphrase. Legacy vaults without an iteration field retain their original 310000-iteration derivation so unsynchronized data is not made unreadable. Keys remain in memory while unlocked; passphrases and browser session/JWT/refresh secrets are not persisted.

Every edit autosaves a complete minimal snapshot, including unfinished name/location/notice fields. A revision check prevents another editor from silently overwriting it; the UI also uses an exclusive Web Lock for editing. A failed encrypted write retains an encrypted in-memory recovery copy. Retry is allowed only against the exact prior durable revision; conflicting versions require recovery/review. Pending/failed writes trigger a navigation warning. Do not describe unacknowledged keystrokes as durable: browser/process failure can still interrupt a write before the Saved on Device indicator.

Completing a draft first persists its stable farmer/mutation IDs and payload before removing the working copy. Interrupted completion is retryable. Pending sync preserves IDs after a lost response and relies on server transaction/idempotency checks. Authentication/network failures preserve pending data; conflicts and rejected submissions remain for review rather than being merged or overwritten. Only a server-confirmed synchronized copy can be removed through the local row-removal action.

Encrypted archive export remains available when the vault is locked and includes retained recovery ciphertext, but never the device private key or session credential. Cross-device archive import, privileged recovery/reassignment and safe whole-device deauthorization/erasure procedures are separate unfinished release work. Logical IndexedDB deletion is not a forensic device wipe. OS encryption, managed device handling, backups/recovery and actual pilot browser/storage testing remain necessary.

## Public application cache

The service worker caches only `/offline-workspace` marked as a public static shell, the public fallback and immutable `/_next/static/` JavaScript/CSS/font assets. Install requests omit credentials. Static cache keys omit request headers/query parameters. API/private JSON/cross-origin requests are not cached. The workspace shell must never render private server data; authenticated references and farmer drafts are loaded only in client code and stored separately under encryption.

Worker activation does not force a reload of open forms. An old/unprepared worker prevents new offline drafting until the public-shell handshake succeeds; saved drafts remain recoverable. Cache cleanup touches public application caches, not vault databases.
