# Explicit farmer/project enrollment (PRJ-03A)

Migration **22**, `20261116_project_enrollment/up.sql`, adds the first explicit enrollment slice: native PostgreSQL commands, FORCE-RLS reads and NestJS API endpoints. There is **no BFF route, admin screen, offline workflow, report/export/map exposure or scope-administration interface yet**. All eligibility rules are **provisional** while DEC-04 is open; see [ADR 0019](../decisions/ADR-0019-provisional-project-enrollment.md).

## Upgrade and operator boundaries

1. Rehearse/apply all manifest migrations through entry 22 with the [controlled runner](../../database/README.md) before deploying the updated enabled API. Existing grants, assignments, projects and farmers are preserved; the permission CHECK constraints only widen.
2. Keep the same ten isolated runtime LOGINs. `agri_enrollment_owner` is **NOLOGIN**; never grant its membership to an application login. Startup rejects owner membership, direct `operations.enrollment` writes, journal/audit access and a missing execute grant.
3. Provision scopes only through the reviewed privileged process. For each actor and project: `enrollment.read` (null source), `enrollment.create` and `enrollment.withdraw` (trusted `administrator` or `field_officer` source) plus a matching project assignment ([scope guide](PROJECT_SCOPES.md)), **and** a current `farmer.read` grant covering the farmer's geography. Nothing is seeded.

## Behaviour

| Action                                  | Requirements                                                                                                                                                                                                 | Result                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST pilot/enrollments/enroll`         | CSRF, trusted source header, `enrollment.read`+`enrollment.create` on the farmer's **current** geography, `farmer.read`; enabled project policy; active project; farmer status in the policy's eligible list | New row (`enrolled`, version 1), private idempotency journal and audit row in one transaction. Exact retry replays; changed payload → 409               |
| `POST pilot/enrollments/withdraw`       | CSRF, source, `enrollment.read`+`enrollment.withdraw`, `farmer.read`, original `expectedVersion`                                                                                                             | `enrolled → withdrawn`, version +1, audit. Stale version → 409; already withdrawn → 409. A later enrollment is a **new row**                            |
| `GET pilot/enrollments`, `…/detail?id=` | Rows filtered by RLS (`enrollment.read` scope **and** `farmer.read` per row); keyset `after`, `limit ≤ 100`, optional `projectId`/`farmerId`/`status`; no totals                                             | IDs/status/version/timestamps only. Unreadable and missing records are indistinguishable (404); no farmer names, actor IDs or journal data are returned |

HTTP mapping: 403 denied, 409 duplicate/idempotency/version/provisional-eligibility conflict, 400 invalid input. SQLSTATE `55000` marks provisional state conflicts.

## Authority model

`operations.enrollment_permitted()` is the single visibility authority for policies and commands: it resolves the farmer's current geography (the farmer is visible to the NOLOGIN owner only where `authz.allowed(...,'farmer.read')`) and calls `authz.allowed_project_geography()`. Writes occur only in `enroll_farmer`/`withdraw_enrollment`, which serialize the mutation and farmer/project pair, lock the farmer (`FOR SHARE`, so a concurrent correction cannot change geography unnoticed) and enrollment (`FOR UPDATE`), then re-verify actor and scope after every wait. A trigger permits only `enrolled → withdrawn` as defense in depth.

## Known limitations

- Enrollment is disabled for every project until an administrator holding the organization-level `enrollment.policy` grant creates and enables a policy (`POST pilot/enrollment-policies/set`, `GET pilot/enrollment-policies?projectId=`); both are administrator-source only, versioned (`expectedVersion` 0 creates), idempotent and audited. No grant is seeded. The BFF exposes the same routes (`enrollments/enroll|withdraw|detail`, `enrollments`, `enrollment-policies[/set]`) with CSRF, same-origin checks, strict bodies and responses re-validated against the request; the typed `PilotClient` mirrors them. Administrators with the policy grant can manage a project's policy from the project detail screen (English/Sinhala, online-only draft with explicit review and a fixed retry request). Enrollment list/enroll/withdraw screens and the offline outbox do not exist yet.
- DEC-04 unresolved: active-project requirement, per-project eligible statuses, unrestricted coexistence, re-enrollment as a new row and the absence of cycles/effective dates are engineering defaults, not client rules.
- No BFF/UI/offline/sync, bulk enrollment, role or scope administration, reports, exports or maps (RPT-01 must recheck scopes and must not count enrollments from privileged queries).
- Per-row predicate evaluation takes a short organizational-unit lock; list capacity is bounded but unmeasured (OPS-05).
- Evidence is synthetic PostgreSQL/PostGIS 16 locally and does not cover production, devices or client acceptance. See [results](../testing/PROJECT_ENROLLMENT_RESULTS.md).
