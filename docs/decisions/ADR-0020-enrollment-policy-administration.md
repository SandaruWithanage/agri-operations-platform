# ADR 0020 — Enrollment policy administration

Status: implemented engineering slice (PRJ-03B). Builds on [ADR 0019](ADR-0019-provisional-project-enrollment.md); DEC-04 remains open and no client rule is encoded.

## Decision

Per-project enrollment policy (`operations.enrollment_policy`) is administered only through the fixed function `operations.set_enrollment_policy` (migration 23), never by direct table writes. Policy content stays data: an enabled flag and the farmer statuses eligible for that project.

- **Authority:** a dedicated organization-level `enrollment.policy` grant with administrator source, plus `project.read`. Catalog edit authority (`project.update`), enrollment grants and coordinator roles never imply it; no grant is seeded. Narrower grants never become organization-wide.
- **Concurrency/idempotency:** mutation advisory lock, then project-policy lock, `FOR UPDATE` on the row, optimistic `expectedVersion` (0 creates), and HMAC-bound replay that re-authorizes after every wait. Same ID with a different payload conflicts.
- **History/audit:** immutable `enrollment_policy_change` (old/new values per version) and `enrollment_policy_audit` (actor, session), private to the runtime login. A transition trigger allows only one version bump per update and blocks key changes.
- **Reads:** policy rows are visible only to administrators (RLS); the API returns 404 to everyone else so a missing and an unauthorized project look alike. A project without a policy reads as `null` (enrollment denied).

## Limits

No BFF/UI, no grant-administration interface (IAM-01), no policy deletion, no coexistence/cycle fields (DEC-04). Statuses mirror the farmer status vocabulary; adding a status needs a migration.
