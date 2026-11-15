# ADR-0009 — Versioned online farmer record review and correction

Status: provisional implementation defaults, not client-approved verification criteria. The client still needs to confirm the evidence/review process, duplicate-risk disposition, reviewer separation, audit retention and status lifecycle.

## Scope and authority

This change adds the server/BFF/browser-transport protocol for online staff record review. The admin record screen remains read-only; a complete review/correction editor and audit-history screen are subsequent work. Offline registration remains the only supported offline mutation workflow.

A current authenticated session, `farmer.read` and a separate explicit `farmer.verify` or `farmer.correct` grant are required. Current assignments and coverage apply. A position, creating a farmer, knowing its UUID, or having a frontend session alone grants no change authority. NestJS checks read/action permissions; native SQL repeats the checks under FORCE RLS. A geography correction requires read and correction permission in both the original and destination geography. The runtime has no direct UPDATE or audit-journal read/write privileges.

For this provisional protocol, verification means **staff review of the minimal registration record**, not proof of government identity, tenure, land title or survey accuracy. NIC, phone, land and project enrollment remain optional. Verification is allowed only from Pending Review. A correction of a Verified record returns it to Pending Review. Correcting an Inactive record leaves it Inactive; no implicit reactivation occurs. Activation/deactivation/reassignment workflows are not introduced here.

## Versioning, retries and audit

Existing records receive version 1. Every accepted change requires its expected version, a stable client mutation UUID and a nonblank reason (currently 8–500 characters). Names remain 1–200 trimmed characters. These bounds are provisional technical validation defaults. Core identity/privacy constraints remain strict.

The database locks the record, rechecks current authorization, compares the expected version and increments it once. Stale or conflicting payloads return 409; no overwrite or automatic merge occurs. An identical mutation replay returns its original acknowledgment only after current permission checks. The browser transport checks the current account and CSRF token and never silently changes a retained payload or mutation ID.

Each accepted change creates an immutable application journal entry with trusted actor/session, reason, previous/result version, minimal before/after values, status transition, duplicate-risk flag and database timestamp. A linked farmer audit event is written in the same transaction. Audit failure rolls back the row, version and mutation journal. Runtime identities cannot write the farmer table directly or alter/delete audit history. Privileged database operators remain a separate operational trust boundary.

Exact normalized name/location matches flag a possible duplicate without merging records. A nonunique functional index supports this lookup. Registry responses calculate the current flag only from records visible under the caller's RLS; the detail screen shows a bilingual review hint. The flag is evidence for review, not a definitive identity match.

## Release limits

Apply migration 12 before deploying the new API/BFF contract; old registration/read deployments can coexist during migration, but the new API requires the version column. The current mutation MAC mechanism shares the existing protected actor-context key and its operational rotation limitations; a retained-key/versioned migration and tested rotation procedure are still release work. Do not rotate/delete that key casually or claim retries survive an untested key transition.

The protocol does not complete the client verification policy, full audit viewing/retention, lifecycle/reassignment or a safe admin editor. No production-readiness claim follows from passing these tests.
