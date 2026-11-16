# ADR 0021 — Offline enrollment design (PROPOSED, not implemented)

Status: **proposal for owner/security approval. No code accompanies this record.** It follows AGENTS.md ("explain the proposed approach and acceptance tests before implementing significant work") and the handover's precondition that Officer A/B isolation and sync reauthorization precede any offline enrollment. DEC-04 (eligibility, cycles, withdrawal, who may act) is still open, so nothing here is an approved client rule.

## Context

- Online enrollment, policy administration, the BFF/client transport and admin screens exist (ADR 0019, ADR 0020). The database is authoritative: every enroll re-checks the actor, project scope on the farmer's _current_ geography, `farmer.read`, the enabled per-project policy and the farmer's status, idempotently by mutation ID.
- The only offline store is the encrypted farmer-registration vault (ADR 0007/0008): per account/device partitions, passphrase unlock with idle lock, AES-256-GCM, stable mutation IDs, visible saved/pending/synced/conflict/rejected states, an authenticated recovery archive, and sync that always rechecks current server authority.
- PRJ-04B proves at the database/API level that one officer cannot enroll into, read, withdraw or replay another officer's scope.

## Decision (proposed)

1. **An offline enrollment is a queued intent, not a result.** Only `{mutationId, enrollmentId, projectId, farmerId}` is stored, plus display labels already held in the vault. The UI always says "pending — the server may refuse it". No policy, eligibility or scope is decided on the device.
2. **Reuse the existing vault, do not create a second one.** Add an encrypted `enrollments` store to the same account/device-partitioned database (new Dexie version, existing passphrase, idle lock, Web Lock and recovery behavior). A unique fingerprint over `(farmerId, projectId)` blocks queueing the same pair twice. Stable IDs are generated once and reused for every retry.
3. **Reference data is server-issued and minimal.** The online session returns, under the signed actor/RLS context, only the projects in which the actor currently holds enrollment-create scope (id and name) and the actor's already-cached farmers. Policies are administrator-only and are never sent to field devices.
4. **Farmers must already exist on the server.** An enrollment may be queued only for a farmer the server has confirmed. Enrolling a farmer who is still `pending-sync` (dependency ordering and a "blocked" state) is explicitly deferred; it is listed as an open question rather than guessed.
5. **Sync outcomes (server response → local state):** success or exact replay → `synced`; authorization denial (403) → `rejected`, retained, never auto-retried; policy not enabled, farmer not eligible, already enrolled or mutation conflict (409) → `conflict`, retained for review; network/timeout/5xx/401 → stays `pending` with the same IDs. No outcome silently becomes a new mutation; a new intent requires explicit review (OFF-02 rules). Responses stay generic in the first version so a field device does not learn policy configuration; machine-readable reasons are an open question.
6. **Reauthorization at sync.** Sync needs a current session, approved device, and the database's own checks. A grant or assignment revoked while offline therefore turns the item into `rejected`, not into a write. Sync stops for an account/device mismatch. The local project list is cleared on the next context refresh.
7. **Out of scope for v1:** offline withdrawal (needs the current record version), offline policy administration, bulk enrollment, cycles/effective dates, cross-device archive import.
8. **Bounds and recovery:** a maximum queue size and age warning (technical defaults, not client rules), included in the authenticated recovery archive with a format version bump; legacy farmer-only archives keep opening.

## Acceptance tests required before merge

- **Storage (fake-indexeddb):** encrypted at rest, partitioned by account/device, unique fingerprint, revision-checked writes, interrupted write recovery, idle/hidden lock, legacy vault upgrade with farmer drafts untouched.
- **Sync (unit + native):** lost response replays the same mutation ID with no second row or audit; each outcome in decision 5; revoked grant/assignment/session while offline → rejected with no write; farmer geography move while offline → rejected; one officer's queue cannot be sent under another account/device.
- **A/B at BFF/browser level:** Officer A's queue never appears or syncs for Officer B on a shared browser profile; logout/device change preserve pending data without exposing it.
- **Browser (Chromium, compiled):** go offline, queue, reload, unlock, reconnect and sync; conflict and rejected review; Sinhala and English; 44px touch targets and contrast; navigation warning with unsaved writes.
- **Failure states and docs:** developer/setup guide, migration notes for the Dexie version bump, handover task rows and results page updated.

## Open questions for the owner / client

1. May field officers enroll at all, or only administrators (DEC-02/DEC-04)?
2. May a farmer registered offline in the same session be enrolled before their registration syncs (dependency ordering)?
3. Should a refused enrollment tell the officer why (not enabled, not eligible, already enrolled), or stay generic?
4. Queue size and maximum age before an item is flagged.
5. Device security evidence still required by ADR 0007 before widening the offline dataset (OFF-03/IAM/REC).

## Proposed task split (if approved)

OFF-04A encrypted enrollment store and Dexie migration; OFF-04B sync engine and outcome mapping; OFF-04C review/recovery UI and archive; OFF-04D BFF/browser A/B and Chromium journeys. Each lands separately with its own evidence; none is started.
