# Project and geography authorization foundation

Migration **21**, `20261116_project_scope/up.sql`, prepares a separate authorization prerequisite for future enrollment. It does not expose enrollment, assignment administration or a new browser workflow. Organization-wide catalog grants still grant catalog metadata access only. Farmer registration remains independent of enrollment.

## Upgrade and operator boundaries

1. Rehearse/apply all manifest migrations through entry 22 using the [controlled runner](../../database/README.md), before deploying the updated enabled API. Existing project/farmer/land records and historical migrations are preserved.
2. Keep the same ten isolated runtime LOGINs. The new `agri_project_scope_owner` is **NOLOGIN**, not an eleventh API connection. Never grant its membership to application users. Startup checks the restricted predicate execution and rejects any direct/column scope-table access or owner membership.
3. Review scope provisioning with the IAM owner. There is no business-role seed, broad default grant or exposed administration endpoint. Do not use the tables as a substitute for the unfinished audited authorization-management workflow.
4. Apply grants/assignments only through an authorized provisioning process. Both records reference a real configured project and the same organization/account; optional geographical and unit restrictions use typed organization-matching foreign keys. Keep credentials and real personal information out of checked-in fixtures.

## Predicate semantics

`authz.allowed_project_geography(project_id, geography_id, permission, source)` returns a boolean under signed actor context. It discloses no target metadata. Missing/unknown targets and denied contexts all return false.

- `enrollment.read` requires a null source. `enrollment.create` requires a matching trusted `administrator` or `field_officer` source; browser-supplied source/actor/role values are never authoritative.
- A current permission grant **and** a current project assignment must match the actor, organization and exact project. A grant without an assignment, a position without permission or a catalog grant cannot authorize a target.
- Every geography/unit constraint in each row must match the same target. Unit scope includes configured descendants; geography and management hierarchy remain distinct. Each assignment must specify geography or unit. Two partly matching rows do not become an OR scope.
- Geography must be active and in the project's organization. Cyclic ancestry fails closed. Project enabled flags do not establish enrollment eligibility.
- Relevant rows are locked for the transaction; current session/account/device and both time windows are checked after lock acquisition. The final clock check matters when a grant expires while waiting for an assignment lock.

The internal NestJS [policy](../../apps/api/src/project/scope-policy.ts) validates strict project/geography IDs, fixes the permission in read/create methods, binds only a verified server actor, and checks before and after the supplied database callback. Future endpoints must authenticate through the existing session/JWT/BFF path. Future native commands and record RLS must independently enforce this predicate plus target relationships, eligibility, version, idempotency and audit; no authorization decision may be reused across transactions or sync requests.

## Verification and remaining work

Unit tests cover strict input, fixed permissions, boolean-only acceptance, trusted actor binding, failure rollback and final reauthorization. Native PostgreSQL integration tests cover missing context, current grants/assignments, project/geography/unit AND intersections, sibling projects/branches, cross-organization foreign keys, source, hierarchy cycles, expiry/revocation/lock waits, direct restricted RLS, isolated officers and startup privilege drift. See [results](../testing/PROJECT_SCOPE_RESULTS.md).

Migration 22 adds the `enrollment.withdraw` action and the first enrollment records on this foundation ([PROJECT_ENROLLMENT.md](PROJECT_ENROLLMENT.md)). PRJ-04A is this bounded foundation. PRJ-04 remains partial: complete role/binding administration, direct farmer/record relationship intersections, actual enrollment record RLS/NestJS/BFF/UI, audited scope mutation and sync reauthorization remain. Agree provisional enrollment eligibility/transition rules before implementing PRJ-03. Device/client/production acceptance remains separate. See [ADR 0018](../decisions/ADR-0018-project-geography-scope-foundation.md) and the [handover](PROJECT_HANDOVER.md).
