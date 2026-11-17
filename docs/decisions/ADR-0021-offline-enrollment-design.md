# ADR 0021 — Offline enrollment design (amended; NOT yet Accepted)

Status: **conditionally accepted as the technical direction; not Accepted; implementation not authorized.** The owner has recorded a **provisional** Phase 1 pilot operating policy for DEC-12 (section 7), which is subject to client confirmation and independent security review and must not be described as final client-approved business policy. The ADR becomes Accepted only through the approval steps in section 9. DEC-04 (eligibility, cycles, withdrawal, who may act) is still open with the client, so no provisional rule here is a client-approved rule.

## Review record

Architecture review, 16 Nov 2026 (recorded as supplied by the project owner): direction aligns with the approved PostgreSQL, Dexie, synchronization and database-enforced ABAC architecture. Required amendments, all addressed below: (1) duplicate-intent fingerprint lifecycle and future re-enrollment; (2) replay when the server committed but authorization was revoked before the response was recovered; (3) distinct handling of authentication failure, authorization denial, business conflict and uncertain outcomes; (4) encrypted synchronization metadata and account/device partition integrity; (5) Dexie migration safety, multi-tab behavior and archive compatibility; (6) explicit owner approval of field-officer enrollment authority.

Standing constraints from the review: preserve the existing vault; introduce no Redux, no second offline database, no Redis and no second synchronization engine; eligibility and project policy stay server-authoritative; do not enable offline enrollment for real officers; do not merge or deploy without the security evidence listed in section 8.

Owner review, 16 Nov 2026 (recorded as supplied by the project owner): reviewed the merged amendments and supplied a **provisional** Phase 1 pilot operating policy for DEC-12, the offline farmer dependency, refusal reasons and queue limits (sections 7 and 10). It is subject to client confirmation and independent security review. The owner directed that offline enrollment must not be implemented or enabled until the required approvals are explicitly recorded, and that no merge or production-readiness claim be made.

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

Four classes, never merged. The BFF passes through 400/401/403/404/409/429 and turns everything else into a generic 503, so the device sees only these signals; officer-facing refusal messages are generic in v1 (section 7).

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

### 7. Field-officer enrollment authority — provisional owner recommendation (DEC-12; review item 6)

**Status of this section: provisional owner recommendation, not final client policy.** It is the proposed Phase 1 pilot operating policy, pending client confirmation (DEC-12/DEC-04) and independent security review. Until both are recorded, no field-officer enrollment grant exists in any environment and offline enrollment stays disabled.

1. Field officers may create farmer/project enrollments only when explicitly granted `enrollment.create`.
2. The permission is constrained by active organization, project and geographical assignments (the existing project grant and project/geography assignment scope; acceptance must prove an inactive organization, project or assignment is refused).
3. Current `farmer.read` and the current per-project enrollment policy must also authorize the operation, as they do online today.
4. Creating or registering a farmer never grants enrollment authority.
5. Authorized field officers may queue offline enrollment intents on approved organization devices, using only the existing encrypted vault.
6. At synchronization the server revalidates all permissions, farmer status, current geography and project policy; nothing decided on the device is trusted.
7. **Officers cannot withdraw enrollments in v1.** Withdrawal requires a separately authorized administrator holding `enrollment.withdraw`. Today the database would accept an `enrollment.withdraw` grant with a field-officer source, so this rule needs enforcement (prerequisite task ENR-AUTH-01, section 10); until then no such grant may be provisioned.
8. No additional manual approval step per enrollment in v1; eligibility and authorization remain mandatory.
9. Enrollment permissions are never seeded to all field officers. Grants must be explicit, scoped and audited; audited grant administration (IAM-01) or an equivalent documented, audited provisioning procedure is required before any real grant.

**Offline farmer dependency (provisional):** in v1 only farmers already confirmed by the server may be selected for offline enrollment. A farmer whose registration is still pending synchronization must synchronize successfully first. Dependent mutation ordering is deferred to a separate future ADR and must not be implemented implicitly.

**Refusal reasons (provisional):** field officers receive generic refusal messages that do not reveal confidential project policy or unauthorized record information. Authorized administrators may see detailed reasons and audit history only through properly scoped server endpoints. Local `rejected`, `conflict` and `unconfirmed` states stay distinct. Today the server does not persist refused attempts at all (a refusal rolls back its transaction), so administrator-visible reasons need new server work (prerequisite task ENR-AUDIT-01, section 10).

### 8. Required evidence before merge, enablement or deployment

- All acceptance tests below, each mutation-checked where it asserts isolation or integrity (for example: swapping a row between partitions, altering AAD inputs and replaying a ciphertext under another row id must each fail authentication).
- Independent security review of the enrollment store, AAD binding, fingerprint lifecycle and outcome classification, recorded in the results page.
- Device evidence under DEC-07 (actual models/OS/browsers, offline window, lost-device and lost-passphrase recovery) before any real-officer enablement; synthetic Chromium results are not device approval.
- Client confirmation of DEC-12 recorded in the decision register (section 9, A1), the prerequisite tasks of section 10 deployed, and an explicit owner enablement record (section 10, Gate E). Deployment must not enable the feature flag otherwise; the provisional owner recommendation alone is not sufficient.

## Acceptance tests required before merge

- **Storage (fake-indexeddb):** encrypted at rest; partitioned by account/device; AAD tamper and cross-row/cross-vault swap fail; revision-checked writes; interrupted-write recovery; idle/hidden lock; unique fingerprint held while unresolved and released on `synced`/acknowledged review; re-enrollment after a server-side withdrawal accepted; version-3 upgrade of a populated database; version-change handling across two connections.
- **Sync (unit + native):** lost response replays the same mutation ID with no second row or audit; each outcome class in section 3 including `unconfirmed` after revocation (server committed, then grant revoked, then recovery attempt); revoked grant/assignment/session while offline; farmer geography move while offline; one officer's queue cannot be sent under another account/device; partition mismatch stops sync.
- **A/B at BFF/browser level:** Officer A's queue never appears or syncs for Officer B on a shared profile; logout and device change preserve pending data without exposing it; multi-tab single-leader behavior.
- **Archive:** v2 archive opens in the new reader; v3 archive rejected by a v2 reader; binding and fingerprint recomputation on import.
- **Browser (Chromium, compiled):** go offline, queue, reload, unlock, reconnect and sync; conflict, rejected and unconfirmed review; English and Sinhala; 44px touch targets and contrast; navigation warning with unsaved writes.
- **Failure states and docs:** developer/setup guide, Dexie migration and staged-release notes, handover rows, decision register, roadmap and results page updated as each task lands.

## Remaining open questions

1. **Client confirmation** of the provisional DEC-12 policy and of DEC-04 eligibility/lifecycle rules (named client approver role and date). Blocks Accepted.
2. **Independent security review** of this design and, later, of the implementation. Blocks Accepted and, separately, enablement.
3. Device security evidence under DEC-07 (models/OS/browsers, ownership/management, offline window, lost-device and lost-passphrase recovery). Blocks enablement.
4. **Escalation channel for aged items.** An unsynchronized intent is encrypted on the device and invisible to the server by design, so "escalate for administrator review after 30 days" cannot be a server-side alert in v1. The provisional design shows a persistent escalated state with the enrollment reference and an instruction to contact an administrator, and includes the item in the recovery archive on request. Whether a server-visible signal (for example a reference-only heartbeat) is acceptable needs an owner/security decision.
5. Whether the engineering-proposed values marked "(proposed)" in section 10 are acceptable as configuration defaults.

## 9. Approval steps required before this ADR becomes Accepted

"Accepted" authorizes implementing OFF-04A–D behind a default-off flag. It does **not** authorize enablement for real officers (section 8, step E).

1. **A1 — Client confirmation.** Record in `docs/requirements/OPEN_DECISIONS.md` the client's confirmation or amendment of DEC-12 and the affected DEC-04 items, with date and approver role. Until then the policy stays labelled provisional.
2. **A2 — Independent security review.** A reviewer outside the implementation team reviews sections 2–5 and 8 (fingerprint lifecycle, outcome classification, encrypted metadata and AAD binding, partition checks, Dexie/archive migration) and the prerequisite designs. Findings are tracked; each is closed or explicitly risk-accepted by the owner. Recorded in a dated results page.
3. **A3 — Prerequisite designs approved.** The ENR-AUDIT-01 design (a short ADR addendum covering refusal logging that survives rollback, retention and scoped administrator endpoints) and the ENR-AUTH-01 approach are approved.
4. **A4 — Owner decision.** The owner changes the status line to Accepted in a reviewed commit that cites the A1–A3 dates and approvers. Nobody else changes it.

## 10. Implementation sequence and acceptance criteria (not started; follows acceptance)

Each task lands as its own pull request with independent tests and evidence, updates `PROJECT_HANDOVER.md`, the decision register, the results page and the roadmap, and is never merged without the evidence in section 8. Nothing enables the feature.

**Provisional queue and retry defaults** (configurable technical safeguards, not client-approved expiry rules):

- Maximum **100** unresolved enrollment intents per account/device vault; saving a new intent at capacity is refused with a clear message and nothing is deleted.
- Capacity warning at **80** unresolved intents _(proposed)_.
- Warning when any intent has been unresolved for **7 days**; **escalated state** after **30 days** (open question 4).
- **Never** auto-delete an unsynchronized intent because of age; age never bypasses current server authorization — an aged item is sent with its original IDs and the server decides.
- Retry is bounded: exponential backoff from 30 seconds to a 15-minute cap and at most 8 automatic attempts per unlocked session, then manual retry _(proposed)_; stable `mutationId`/`enrollmentId` are never regenerated.

**Prerequisites (separate branches and PRs, before OFF-04B enablement):**

- **ENR-AUTH-01 — Administrator-only withdrawal.** Enforce in PostgreSQL that `enrollment.withdraw` grants and withdrawal calls require the administrator source; keep the field BFF unable to reach withdrawal. _Acceptance:_ a field-officer-source withdraw grant is refused or inert; Officer A/B matrix extended; existing administrator withdrawal unchanged; migration notes and rollback limits documented.
- **ENR-AUDIT-01 — Administrator-visible refusal reasons and attempt history.** Durable server-side record of refused enroll attempts (including authorization denials as security events) that survives the rolled-back transaction, with enumerated reason codes, retention stated, and a scoped administrator endpoint under its own permission. Officer responses stay generic. _Acceptance:_ every refusal class writes one attempt record; officers cannot read it; replays do not duplicate it; Officer A/B isolation holds; no secrets or farmer PII beyond IDs are logged.
- **IAM-01 (or an audited provisioning procedure) — Explicit, scoped, audited enrollment grants.** _Acceptance:_ no grant is seeded; every grant change is audited with actor and scope; inactive organization/project/assignment is refused (DEC-12 item 2).

**OFF-04A — Encrypted enrollment store (R1 release, flag off).** Dexie version 4 with the empty/additive `enrollments` store; version-change/blocked handling; AAD-bound rows; fingerprint lifecycle; queue limits and warnings; confirmed-server-farmer-only selection. _Acceptance:_ populated v3 vault upgrades with farmer drafts decrypting byte-identically and unique fingerprints intact; AAD tamper and cross-row/cross-vault swaps fail (mutation-checked); capacity of 100 enforced with no deletion; two connections at different versions behave safely; nothing is exposed in the UI.

**OFF-04B — Sync classification inside the existing sync path (no second engine).** Outcome classes and states (`pending-sync`, `rejected`, `conflict`, `unconfirmed`, `synced`), single-leader locking, bounded retry, partition checks, generic officer messages. _Acceptance:_ every row of the section 3 table; lost response replays with no second row or audit; commit-then-revoke yields `unconfirmed`; revocation, farmer geography move, inactive organization/project/assignment and farmer-status change while offline are refused by the server; aged items are still authorized only by current server state; one officer's queue cannot be sent under another account/device.

**OFF-04C — Review/recovery UI and archive version 3 (English and Sinhala).** Per-item review for conflict, rejected and unconfirmed, 7-day and 30-day indicators, capacity warning, reconciliation guidance, authenticated archive v3 written only when enrollment rows exist. _Acceptance:_ v2 archives open in the new reader and v3 is rejected by a v2 reader; import verifies partition binding and recomputes fingerprints; 44 px touch targets, contrast and navigation warnings verified; no data ever shown that the server did not authorize.

**OFF-04D — BFF/browser A/B coverage, Chromium journeys and evidence packaging.** _Acceptance:_ shared-profile Officer A/B, multi-tab single-leader behavior, offline queue → reload → unlock → reconnect → sync, conflict/rejected/unconfirmed review in both languages, and the section 8 evidence compiled for security review.

**Gate E — Enablement for real officers (separate recorded decision).** Requires: A1–A4 complete; independent security review of the _implementation_; real-device acceptance under DEC-07; the prerequisites above deployed; a recorded owner enablement decision naming scopes and officers. Until then the flag stays off in every environment, and no document may claim production readiness or client approval.

## 11. DRAFT amendment A (17 Nov 2026): same-session dependent enrollment and refusal reasons — NOT part of the reviewed text

**Status: proposed amendment text for owner and independent security review. It does not change this ADR's status (still NOT Accepted), it is not implemented, and nothing here enables offline enrollment.** It responds to the owner's later provisional answers Q3 (an enrollment may be queued for a farmer newly registered offline in the same session, with dependency-aware sync) and Q4 (safe, actionable refusal reasons for currently authorized field officers), which differ from the earlier DEC-12 text (server-confirmed farmers only; generic officer messages). Those differences are recorded as conflicts SC-02 and SC-03 in the Phase 1 conflict register; **the owner must say which policy stands before this section can be reviewed.** The offline farmer dependency in section 7 is replaced by this section only if the owner chooses Q3.

### 11.1 Dependency model

- A queue item has a kind (`farmer.register` or `enrollment.create`) and, for an enrollment, an optional **single** `dependsOn` edge to a `farmer.register` item **in the same account/device partition**. The edge lives inside the encrypted payload; it is never a server concept and never crosses partitions. Maximum depth 1, no cycles, validated when the item is queued and again on unlock and archive import.
- The farmer UUID is generated on the device and is the canonical server identifier (as today), so the enrollment already carries the final `farmerId`. The edge only controls **ordering**.
- **Send order:** the parent is sent first. The child is sent only after the parent has a confirmed server receipt (`synced`). The server never trusts the order: it re-validates the child on its own (current session and device, current `farmer.read` on the farmer's current geography, project scope, enabled policy, farmer status).
- **Parent outcomes → child state:**

| Parent                                        | Child                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pending-sync`, `syncing`                     | `blocked-dependency` (waiting); no request is made                                                                             |
| `synced`                                      | released to `pending-sync`                                                                                                     |
| `conflict`, `rejected`                        | stays `blocked-dependency` with the parent reason shown; all data retained; a new intent needs explicit review                 |
| `unconfirmed` (possible commit, then revoked) | stays `blocked-dependency`; reconciliation by an authorized administrator, then explicit discard or re-queue                   |
| parent discarded by the officer               | child cannot be sent; the officer must discard or re-parent explicitly (a child is never silently promoted to "no dependency") |

- `blocked-dependency` is a new local state; it never means success or rejection. It counts toward the unresolved-intent limits (100, warning at 80, 7 and 30 day indicators) and is never auto-deleted.
- **Creation is not read access.** Registering a farmer does not grant `farmer.read`. A queued child for that farmer is accepted by the server only if the officer separately holds `farmer.read` in the farmer's geography and the project scope; otherwise it is refused (`rejected`). The UI must warn when the cached, non-authoritative permission hints suggest this will fail.

### 11.2 Refusal reasons (resolves SC-03 only after an owner choice)

- Option G (current DEC-12 text): officers always see a generic message; administrators see detailed reasons and history (ENR-AUDIT-01).
- Option S (owner Q4): officers see a **closed set of safe, actionable classes**, bilingual, for example `not authorized`, `not accepted now`, `already enrolled`, `try again later`. The server returns a class from an enumeration, never free text, rule names, thresholds, policy configuration or another record's data, and **only inside a response to a currently authorized request**. A revoked actor receives only `not authorized`. Whether `not accepted now` is acceptable (it hints that a project policy or eligibility rule exists) is a confidentiality decision for the owner and the security reviewer.
- Recommendation: keep Option G until the owner decides; if Option S is chosen, make the disclosure level a server-side, per-project configuration defaulting to generic.

### 11.3 Additional acceptance tests (added to section 10)

Parent commits then the reply is lost: child waits, parent replays with the same ID, then the child is sent; parent rejected or conflicting leaves the child blocked with data retained; parent `unconfirmed` leaves the child blocked and never sends it; restart, lock and multi-tab preserve edges and order; the edge cannot reference another partition, a missing parent or a cycle (import and unlock included); an officer without `farmer.read` gets a refused child while the parent still succeeds; tampering with the plaintext status cannot send a child before its parent; two officers cannot satisfy each other's dependencies; archive v3 round-trips edges; queue limits count blocked children; Staff UAT-01, 03 and 04.

### 11.4 Not decided here

Whether Q3 or the earlier confirmed-farmer-only rule stands; Option G versus S; whether dependent registration of farmer and enrollment should instead be a single atomic server command (a larger design change that would need its own review); and every approval in section 9. This draft does not authorize OFF-04A–D.

### 11.5 Security review notes on this draft (internal engineering review, 17 Nov 2026 — NOT independent)

| Threat                                                                                             | Mitigation required by this draft                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An attacker with local storage access edits the plaintext status to send a child before its parent | The dependency edge and states live inside authenticated ciphertext; the plaintext status is a hint recomputed on unlock. Even if the child is sent early, the server re-validates it and it is idempotent under the same ids, so no new intent can be created without the vault key. |
| A forged or edited edge points a child at a different farmer or another partition's parent         | The edge is bound by AAD to the row, kind, revision and schema; unlock and archive import check that the parent exists in the **same partition**, depth is 1 and there is no cycle, and reject orphans.                                                                               |
| The parent payload changes after the child was queued                                              | Payloads and ids are immutable after first send; a corrected parent is a **new** intent that needs explicit review, and the child must be re-parented explicitly (never silently).                                                                                                    |
| A child references a farmer the officer cannot read after registering them                         | Creating a farmer does not grant `farmer.read`; the server refuses the child (`rejected`). The cached permission hint is advisory only.                                                                                                                                               |
| Error text or state reveals why the parent failed to someone no longer authorized                  | A blocked child shows only its local state and the parent's local state; server-supplied reasons follow section 11.2 and are never retained for a revoked actor.                                                                                                                      |
| Queue exhaustion by many parents to push out legitimate children, or the reverse                   | Parents and children count toward the 100-intent limit; at capacity new intents are refused and nothing is deleted. Farmer registrations keep their own reviewed capacity.                                                                                                            |
| Replay of an exported archive onto another vault to forge a dependency order                       | Archive v3 binds to the database name and re-checks partition, edges and fingerprints on import; cross-device import stays out of scope.                                                                                                                                              |
| Race between two tabs sending parent and child                                                     | Single-leader sync per partition with compare-and-set transitions; server idempotency is the safety net, not the coordination mechanism.                                                                                                                                              |

These notes add no approval. The independent review (A2/G1) must still examine the dependency model, the reason-disclosure choice and the atomic single-command alternative.
