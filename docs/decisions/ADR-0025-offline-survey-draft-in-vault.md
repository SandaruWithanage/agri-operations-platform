# ADR 0025 — Encrypted offline survey drafts in the existing vault (PROPOSED design, not implemented)

Status: **design proposal for independent cryptographic and security review (Gate G1). No code, migration or dependency accompanies it.** It covers P1-12a (SRS v0.9 FR-LAND-013 and NFR-OFF-03, architecture 6.2 step 4; alignment gap GA-02. Raw-track retention (FR-LAND-017, FR-DATA-005) is not decided here). The owner decisions it leans on are provisional, not client-approved. It does **not** accept ADR 0021 and does not enable offline enrollment.

## Context

- The walk-the-perimeter survey (`apps/field-pwa/lib/walk-survey.ts`, `WalkSurveyScreen`) keeps every captured point **in memory**. Closing, reloading or losing the tab discards the walk. Until this design is built, the screen must not be described as safe against interruption (GA-02).
- The field device already has an encrypted vault for farmer registrations: one IndexedDB (Dexie) database per account and device, AES-256-GCM with a non-extractable key derived from the officer's offline passphrase by PBKDF2-SHA-256 (600 000 iterations, 310 000 to 2 000 000 allowed). Each row stores `{id, revision, iv, ciphertext}` with a fresh random IV and additional authenticated data `dbName:id:revision`. Writes use optimistic revisions; an exclusive Web Lock prevents parallel editors; the vault locks after five minutes idle and when hidden; the offline window is bounded (60 to 86 400 s, default one hour) and server-configurable. Version 2 authenticated archives bound recovery at 10 MB, 5 000 completed mutations and 100 incomplete slots.
- A GPS track is more sensitive than a registration field: it identifies where a person's land is. It must never reach logs, URLs, analytics or unencrypted storage.
- Land GPS points are identification only, not a legal boundary or verified acreage (AGENTS.md). Nothing here changes that.

## Decision (proposed)

### 1. Scope: drafts only (P1-12a)

This ADR covers a durable, encrypted, resumable **draft** of an in-progress walk. Submitting geometry from a queued offline outbox (P1-12b) is **not** decided here: it needs an expected-version conflict policy against `land.record_geometry` and ADR 0021's gate for any offline mutation of authoritative data. Saving a survey stays **online-only** (`/land-survey`) until that is decided.

### 2. Storage: same vault, new table, immutable chunks

- Add an **additive** Dexie schema version to the existing per-account/device database with a `surveyDrafts` table. No new database, no new passphrase, no second key.
- A draft is a **header row** plus **immutable chunk rows**.
  - Chunk `{id: "<draftId>:c<n>", iv, ciphertext}` holds a bounded batch of points (latitude, longitude, accuracy, capture time, segment index). A chunk is written once and never rewritten, so write cost stays constant as the walk grows and a torn write cannot corrupt earlier points.
  - Header `{id: "<draftId>:h", revision, iv, ciphertext}` holds the land id, the land version the officer started from (`expected_version`), start time, chunk count, state (`walking`, `interrupted`, `reviewing`) and the segment list. It is the **commit marker**: a chunk counts only if the header at its revision names it. Orphan chunks (written, header not updated before a crash) are ignored on resume and deleted on the next successful write.
- **Authenticated binding:** additional authenticated data `dbName:survey:<draftId>:<kind>:<n>:<headerRevision>` where kind is `h` or `c`. The `survey` label domain-separates these rows from registration rows that share the key, and the draft id, kind, index and revision stop a chunk being swapped, reordered, replayed into another draft or rolled back to an older header.
- **Key reuse is a question for the reviewer, not a decision.** The vault key is a non-extractable PBKDF2-derived AES-GCM key, so a sub-key cannot be derived from it with HKDF. Reusing it with distinct AAD (above) is the practical option; the reviewer should confirm that, with random 96-bit IVs, the write budget below keeps the invocation count far below the safe bound for one key.
- **Write budget:** points are coalesced (proposed: at most one chunk per 5 s or 25 points, whichever is first); a draft is capped (proposed 2 000 points and 120 chunks); a vault holds at most a few drafts (proposed one per land and eight per vault). Hitting a cap stops capture with a visible message and leaves the draft intact for review or discard; it never silently drops points.
- **Plaintext limits:** the draft contains coordinates and timestamps only. No NIC, contact data, farmer name or document. The land is referenced by its opaque id.

### 3. Lifecycle

| Event                                          | Behaviour                                                                                                                                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start a walk                                   | Requires an unlocked vault, a valid account/device session and an unexpired offline window. The header is written before the first point is accepted as durable.                                                |
| Each batch                                     | Chunk written, then header revision incremented (optimistic check). The screen shows **Saved on device** only after the header commit; a failed write shows a warning and keeps the points in memory.           |
| Vault locks (idle, hidden, sign-out, expiry)   | The in-memory walk is cleared with the rest of the workspace; ciphertext stays. A walk in progress when the vault locks is marked `interrupted` at the last committed header.                                   |
| Reopen and unlock                              | The land survey lists interrupted drafts for **this account only** with land, point count and last capture time. The officer chooses **Continue** or **Discard** (explicit confirmation). Nothing auto-resumes. |
| Continue                                       | Resuming starts a **new segment**, reusing the engine's existing pause semantics, so the time gap is visible in the review and no straight line is invented across it.                                          |
| Offline window expires mid-walk                | Capture continues in memory with a prominent warning; the next successful online verification lets the vault write again. Points are never discarded because the window closed. (Open question Q2.)             |
| Successful online save                         | The draft is deleted only after the server confirms the saved version. A failed or unconfirmed save keeps it (consistent with #60).                                                                             |
| Discard                                        | Deletes header and chunks after confirmation. There is no remote erase of other devices.                                                                                                                        |
| Account switch, sign-out                       | Separate vault per account/device already isolates drafts; the survey workspace's account-epoch reset applies unchanged.                                                                                        |
| Device revoked or vault rejected by the server | Ciphertext is retained for controlled recovery; no new drafts are accepted (same rule as registrations).                                                                                                        |

### 4. What this does not change

- No server endpoint, migration, permission or grant. Existing `land.record_geometry` rules (HMAC idempotency, optimistic version, one current provisional polygon) apply when the officer later saves online.
- Saving a surveyed polygon is still online-only and still labelled provisional.
- The vault passphrase policy, KDF bounds, lock timers and recovery rules are unchanged. Lost-passphrase recovery remains unimplemented.

## Threats and mitigations

| Threat                                       | Mitigation (proposed)                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Another officer or account reads a draft     | Per account/device vault, key from that officer's passphrase; drafts listed only after unlock of that vault.                                                                         |
| Chunk swap, reorder, truncation or rollback  | AAD binds draft, kind, index and header revision; the header is the commit marker and carries the chunk count; revision only increases (optimistic check).                           |
| Torn write after crash                       | Chunk before header; orphans ignored and cleaned; header write is the single atomic commit per batch.                                                                                |
| Silent point loss                            | Caps are explicit and stop capture visibly; a failed write never marks points durable.                                                                                               |
| IV reuse                                     | Random 96-bit IV per row; chunk rows are written once and the header's rewrites are bounded by the write budget. Reviewer to confirm the bound.                                      |
| Plaintext leak via logs, errors or analytics | Points never logged or placed in URLs, error text or analytics; tests assert error paths contain no coordinates.                                                                     |
| Two tabs edit one draft                      | The existing exclusive Web Lock plus the header revision check; the loser sees a conflict and keeps its in-memory points for export or retry.                                        |
| Storage eviction or quota failure            | Existing persistence request and write-failure warning; a draft is not described as safe beyond what the browser guarantees. Actual-device persistence is a separate trial (DEC-07). |
| Draft treated as proof of a boundary         | Drafts carry the same provisional label; nothing here verifies area or location.                                                                                                     |
| Stale draft applied to a changed land        | The header stores the land version the walk started from; the existing optimistic version check rejects a save over a newer polygon and the officer is told to review.               |

## Questions for the reviewers and the owner

1. **Q1 (crypto reviewer):** is reusing the vault key for survey rows with a distinct AAD label acceptable at the proposed write budget, or must survey rows use a separately derived key?
2. **Q2 (owner):** when the offline window expires during a walk, should capture continue in memory (proposed) or stop? Which wins if both safety and data loss compete?
3. **Q3 (owner):** should interrupted drafts expire (proposed: warn after seven days, never auto-delete unsynchronized work, matching P1-27's seven-day controls) or persist until the officer discards?
4. **Q4 (reviewer):** version 2 archives do not carry survey drafts. Is excluding them from archives acceptable for 12a, with the limitation stated, or must the archive format be extended first (an ADR 0008 amendment)?
5. **Q5 (reviewer):** are the proposed caps (2 000 points, 120 chunks, 8 drafts) right for real parcel walks, or should they come from device trials?

## Required tests before code is accepted

- Round-trip and resume: kill the page mid-walk, reopen, unlock, continue; points, order and segments intact; resume starts a new segment.
- Integrity: tamper with, swap, reorder, drop or replay a chunk and an old header; each is rejected and reported, never partially applied.
- Torn writes: crash between chunk and header; orphan ignored and removed; no duplicate or lost points.
- Isolation: Officer A and Officer B vaults on one browser; B cannot list or open A's drafts; sign-out clears workspace state but retains ciphertext.
- Limits: point, chunk and draft caps stop capture visibly and keep the draft recoverable.
- Failure states: quota and write errors keep points in memory with a warning; the parallel-tab conflict path; expired window; revoked device.
- Privacy: no coordinates in logs, errors, URLs or telemetry.
- No server contract change, so no migration and no new permission.

## Not decided here

Queued offline geometry submission (P1-12b), per-point source and manual fills (GA-04), raw-evidence retention, archive format extension (Q4) and any change to ADR 0021. The independent review (Gate G1) and the owner's answers to Q2 and Q3 must precede code. This ADR is **not accepted**; it records a design for review.
