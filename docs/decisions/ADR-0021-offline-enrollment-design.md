# ADR 0021 — Offline enrollment design (amended; NOT yet Accepted)

Status: **conditionally accepted as the technical direction; not Accepted; implementation not authorized.** It becomes Accepted only after (a) the owner records approval of field-officer enrollment authority in the decision register (DEC-12, section 7) and (b) owner/security review of this amended text. DEC-04 (eligibility, cycles, withdrawal, who may act) is still open, so nothing here is an approved client rule and no provisional rule may be described as client-approved.

## Review record

Architecture review, 16 Nov 2026 (recorded as supplied by the project owner): direction aligns with the approved PostgreSQL, Dexie, synchronization and database-enforced ABAC architecture. Required amendments, all addressed below: (1) duplicate-intent fingerprint lifecycle and future re-enrollment; (2) replay when the server committed but authorization was revoked before the response was recovered; (3) distinct handling of authentication failure, authorization denial, business conflict and uncertain outcomes; (4) encrypted synchronization metadata and account/device partition integrity; (5) Dexie migration safety, multi-tab behavior and archive compatibility; (6) explicit owner approval of field-officer enrollment authority.

Standing constraints from the review: preserve the existing vault; introduce no Redux, no second offline database, no Redis and no second synchronization engine; eligibility and project policy stay server-authoritative; do not enable offline enrollment for real officers; do not merge or deploy without the security evidence listed in section 8.

## Context

- Online enrollment, policy administration, BFF/client transport and admin screens exist (ADR 0019, ADR 0020). The database is authoritative: every enroll re-checks the actor, project scope on the farmer's _current_ geography, `farmer.read`, the enabled per-project policy and the farmer's status, idempotently by mutation ID. A replay re-authorizes and is refused with 42501 if the actor, session, grant or assignment is no longer current.
- The only offline store is the encrypted farmer vault (ADR 0007/0008): one Dexie database per account/device (name derived from both IDs), PBKDF2 passphrase unlock with idle lock, AES-256-GCM rows bound by additional data, a per-vault-salted unique fingerprint on farmer drafts, visible states `saved-on-device | pending-sync | synced | conflict | rejected`, an authenticated archive (envelope `version: 2`, strictly validated), cross-tab lock/logout broadcast (`BroadcastChannel`) and an exclusive Web Lock for editing.
- PRJ-04B/04C prove at database, BFF and admin-shell level that one officer cannot enroll into, read, withdraw or replay another officer's scope, and that the BFF never forwards browser-supplied identity.

## Decision

### 1. Intent, vault reuse and reference data (unchanged from the proposal)

An offline enrollment is a **queued intent, not a result**: `{mutationId, enrollmentId, projectId, farmerId}` plus display labels already in the vault; the UI says "pending — the server may refuse it". It lives in a new encrypted `enrollments` store **inside the existing per-account/device database** (same passphrase, idle lock, Web Lock and recovery). Reference data is server-issued and minimal: only projects in which the actor currently holds enrollment-create scope (id and name) and farmers already cached for that actor. Enrollment policies are administrator-only and never reach a device. A farmer must already exist on the server; dependency ordering for farmers still `pending-sync` is deferred (open question 2). Out of scope for v1: offline withdrawal, offline policy administration, bulk enrollment, cycles/effective dates, cross-device archive import.

### 2. Duplicate-intent fingerprint lifecycle and re-enrollment (review item 1)

- **Digest:** a per-vault-salted digest over a domain-separated string (`enrollment|projectId|farmerId`), never a bare hash, so it cannot collide with farmer-draft fingerprints and reveals nothing without the vault salt. It is the only derived value stored outside ciphertext besides the status.
- **Held only while unresolved.** The row carries the fingerprint (unique index) in `saved-on-device`, `pending-sync`, `conflict`, `rejected` and `unconfirmed` (section 3) until the officer explicitly **reviews and acknowledges** the outcome. Review and discard clear the field in the same transaction, which releases the unique slot (Dexie unique indexes ignore rows without the property). A new intent for the same pair after a refusal therefore always needs an explicit new action with a new `mutationId` and `enrollmentId` (OFF-02), never an automatic retry.
- **Cleared on `synced`.** A synced row is a local receipt ("accepted by the server at _time_"), **not** a claim that the farmer is still enrolled: an administrator may have withdrawn it. Keeping the fingerprint would wrongly block the re-enrollment that the server allows (ADR 0019: one _current_ row per farmer/project; a later enrollment after withdrawal is a new row). Duplicates after `synced` are decided only by the server (409 "already enrolled" → `conflict`).
- **Archive/import** recomputes the fingerprint under the importing vault's salt and only for unresolved rows; imported `synced` rows never hold one.

### 3. Outcome classes and local state (review items 2 and 3)

Four classes, never merged. The BFF passes through 400/401/403/404/409/429 and turns everything else into a generic 503, so the device sees only these signals; reasons stay generic in v1 (open question 3).

| Class                  | Signal                                                                                                         | Meaning                                                                                                     | Local result                                                                                                                                               | Retry                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Authentication failure | 401, expired/revoked session, unapproved device, account/device mismatch                                       | The server did not evaluate the request.                                                                    | Stays `pending-sync` with an encrypted `needs-sign-in` outcome; sync pauses; vault data untouched; nothing sent under another identity.                    | Automatic only after a new successful online sign-in for the **same** account/device partition.                         |
| Authorization denial   | 403 on an item **never previously sent or whose every earlier attempt was definitively refused**               | The database raised before any insert: definitively **not committed**.                                      | `rejected`, retained for review.                                                                                                                           | Never automatic.                                                                                                        |
| Business conflict      | 409 (policy not enabled, farmer not eligible, already enrolled, mutation conflict — indistinguishable at HTTP) | The server evaluated and refused; nothing new written.                                                      | `conflict`, retained for review; payload and IDs never rewritten.                                                                                          | Never automatic; a new intent needs explicit review.                                                                    |
| Uncertain outcome      | network failure, timeout, 429, 503/5xx, response not parseable                                                 | The request may or may not have committed.                                                                  | Stays `pending-sync`; the item is flagged **sent-once** (encrypted metadata) as soon as a request leaves the device.                                       | Same `mutationId`/`enrollmentId` with bounded backoff; flagged "outcome unknown" after the age bound (open question 4). |
| Invalid request        | 400                                                                                                            | The payload failed server validation (a client defect).                                                     | `rejected` with a defect marker; never retried.                                                                                                            | Never.                                                                                                                  |
| **Unconfirmed (new)**  | 403 on an item flagged **sent-once** with no confirmed response                                                | The server may have committed before access was revoked, and a replay is deliberately refused when revoked. | New local state `unconfirmed`: not synced, not rejected. Encrypted metadata keeps `enrollmentId`, `mutationId` and timestamps; the fingerprint stays held. | Never automatic.                                                                                                        |

**Revoked-after-commit replay (item 2).** The server will not be changed to return success to a revoked actor: replay re-authorization (ADR 0019) is what prevents revoked users from probing for records. Therefore the device **cannot** learn the truth and must not guess. `unconfirmed` shows the stable `enrollmentId` reference and says "the server may already have recorded this; ask an authorized administrator to check". An authorized administrator reconciles with the existing Enrollments detail (`enrollments/detail?id=`) or list filters, and the server journal/audit already record the mutation ID. The officer then discards with an explicit acknowledgement (clearing the fingerprint). No automatic resolution, no new intent for the pair until then, and the local state is never promoted to `synced` without a server confirmation.

### 4. Encrypted synchronization metadata and partition integrity (review item 4)

- **Plaintext columns are limited to** the opaque row id, the status enum and the fingerprint digest. Everything else — attempt count, first/last attempt times, sent-once flag, last outcome class, receipt version and timestamps, `needs-sign-in`, review acknowledgements, embedded `accountId`/`deviceId`/`schemaVersion` — lives **inside the AES-256-GCM ciphertext** so storage inspection cannot show who was enrolled where or when it was tried.
- **Binding:** the additional authenticated data for every enrollment row is `database-name : enrollment : row-id : revision : schema-version` (stronger than the current mutation rows, which bind only the row id). A row copied between rows, kinds, revisions or vaults fails authentication.
- **Partition check before every send:** the decrypted embedded account/device IDs must equal both the database name and the live server session (`auth/csrf` identity); any mismatch stops sync for that vault and flags it. Status in plaintext is an untrusted hint: editing it can at most re-send a request with the **same** IDs, which the server treats idempotently, and cannot create a new intent without the vault key. On unlock the effective state is recomputed from the encrypted metadata.

### 5. Dexie migration, multi-tab behavior and archive compatibility (review item 5)

- **Additive schema only:** Dexie version 4 adds the `enrollments` store; no existing store, index or row changes and no upgrade transform. Required test: open a populated version-3 database (farmer drafts, working copy, metadata, unique fingerprints) under fake-indexeddb, upgrade, and prove drafts decrypt byte-identically and farmer fingerprints still enforce uniqueness.
- **Staged release / rollback:** an older build cannot open a version-4 database (Dexie VersionError), so release in two steps — **R1** ships version 4 with an empty store and the feature off; **R2** enables writes. Rolling back below R1 is unsupported and documented; data is not lost but unreadable until R1 is redeployed, so device-recovery procedures must reference the encrypted archive export. This is a deployment note, not a claim of a tested downgrade.
- **Version change across tabs:** the vault currently has no `versionchange`/`blocked` handling. OFF-04A adds it (close the connection and ask for a reload; show "close other tabs" when an upgrade is blocked) and tests two connections at different versions. This gap exists for the farmer store today and is recorded, not hidden.
- **Multi-tab sync:** one sync leader per partition via an exclusive Web Lock (`ifAvailable`), state transitions as compare-and-set on the row revision inside one read-write Dexie transaction covering status and ciphertext, and reuse of the existing `agri-offline-access` broadcast for lock/logout. Server idempotency remains the safety net, not the coordination mechanism. Tests: two tabs sending the same item create one server row; a second tab observes the new state; lock/logout in one tab locks the other.
- **Archive:** the authenticated archive envelope is strictly `version: 2`, so existing readers fail closed on anything newer. Writers emit version 3 (new additional-data domain `agri-encrypted-archive-v3`, optional `enrollments` section) **only when enrollment rows exist**; readers accept 2 and 3. Tests: a version-2 archive opens in the new reader; a version-3 archive is rejected by a version-2 reader; import verifies partition binding, recomputes fingerprints (section 2) and never resurrects a fingerprint for `synced` rows. Cross-device import remains out of scope.

### 6. Server authority (unchanged)

No eligibility, policy, project scope or farmer-visibility decision is made on the device. Sync always requires a current session and approved device, and the database re-checks everything. A grant or assignment revoked while offline turns the item into `rejected` (never sent before) or `unconfirmed` (sent before), never into an unreviewed write. A farmer geography move while offline is a server refusal. Sync stops for an account/device mismatch. The local project list is cleared on the next context refresh.

### 7. Explicit owner approval of field-officer enrollment authority (review item 6)

Enrollment source `field_officer` exists in the API and the field BFF, but **no `enrollment.create`/`enrollment.withdraw` grant is seeded or provisioned for field officers**. The owner must record in the decision register (new item **DEC-12**, linked to DEC-02/DEC-04): whether field officers may create enrollments at all; under which project and geography scopes; whether a second approval is required; who may withdraw or reassign; and whether enrollment may be queued offline. Until a dated owner approval naming the approver role is recorded there, this ADR stays unaccepted, offline enrollment ships behind a feature flag that defaults off and is not enabled for real officers in any environment, and no document may describe these rules as client-approved.

### 8. Required evidence before merge, enablement or deployment

- All acceptance tests below, each mutation-checked where it asserts isolation or integrity (for example: swapping a row between partitions, altering AAD inputs and replaying a ciphertext under another row id must each fail authentication).
- Independent security review of the enrollment store, AAD binding, fingerprint lifecycle and outcome classification, recorded in the results page.
- Device evidence under DEC-07 (actual models/OS/browsers, offline window, lost-device and lost-passphrase recovery) before any real-officer enablement; synthetic Chromium results are not device approval.
- Recorded DEC-12 approval (section 7) and an explicit enablement record; deployment must not enable the feature flag otherwise.

## Acceptance tests required before merge

- **Storage (fake-indexeddb):** encrypted at rest; partitioned by account/device; AAD tamper and cross-row/cross-vault swap fail; revision-checked writes; interrupted-write recovery; idle/hidden lock; unique fingerprint held while unresolved and released on `synced`/acknowledged review; re-enrollment after a server-side withdrawal accepted; version-3 upgrade of a populated database; version-change handling across two connections.
- **Sync (unit + native):** lost response replays the same mutation ID with no second row or audit; each outcome class in section 3 including `unconfirmed` after revocation (server committed, then grant revoked, then recovery attempt); revoked grant/assignment/session while offline; farmer geography move while offline; one officer's queue cannot be sent under another account/device; partition mismatch stops sync.
- **A/B at BFF/browser level:** Officer A's queue never appears or syncs for Officer B on a shared profile; logout and device change preserve pending data without exposing it; multi-tab single-leader behavior.
- **Archive:** v2 archive opens in the new reader; v3 archive rejected by a v2 reader; binding and fingerprint recomputation on import.
- **Browser (Chromium, compiled):** go offline, queue, reload, unlock, reconnect and sync; conflict, rejected and unconfirmed review; English and Sinhala; 44px touch targets and contrast; navigation warning with unsaved writes.
- **Failure states and docs:** developer/setup guide, Dexie migration and staged-release notes, handover rows, decision register, roadmap and results page updated as each task lands.

## Remaining open questions

1. DEC-12: field-officer enrollment authority (section 7) — blocks acceptance.
2. May a farmer registered offline in the same session be enrolled before their registration syncs (dependency ordering, a "blocked" state)?
3. Should a refused enrollment tell the officer why (not enabled, not eligible, already enrolled), or stay generic (current proposal)?
4. Queue size, maximum age and the "outcome unknown" bound (technical defaults, not client rules).
5. Device security evidence under DEC-07 before widening the offline dataset (OFF-03/IAM/REC).

## Proposed task split (after acceptance; incremental, each with independent tests and evidence)

- **OFF-04A** — R1 release: Dexie version 4 with the empty store, version-change handling, encrypted enrollment store with AAD binding and fingerprint lifecycle, feature flag off.
- **OFF-04B** — Sync engine and outcome classification inside the existing sync path (no second engine), single-leader locking, `unconfirmed` handling.
- **OFF-04C** — Review/recovery UI (English/Sinhala), archive version 3, reconciliation guidance.
- **OFF-04D** — BFF/browser A/B coverage, Chromium journeys, security review and device evidence packaging.

None is started. Do not enable offline enrollment for real officers, and do not merge or deploy OFF-04 work without the evidence in section 8.
