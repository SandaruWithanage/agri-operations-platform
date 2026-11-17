# ADR 0022 — Dynamic role, permission and assignment administration (PROPOSED design, not implemented)

Status: **design proposal for owner and independent security review (Gate G1). No code, migration, grant or role accompanies it.** It covers the IAM-01/IAM-02 part of the owner's staff Phase 1 guide (P1-03, owner decisions Q61–Q66). Those owner decisions are provisional and not client-approved; the client permission matrix (DEC-02) is still unknown, so nothing here fixes role names, counts or risk assignments. Implementation of any migration that creates, changes or materializes privileged grants waits for the review in section 10.

## Context (what exists today)

- Authority is evaluated by `authz.allowed` (farmer/land geography scope), `authz.allowed_project_geography` (project scope) and `operations.allowed_organization` (organization catalog/enrollment-policy scope). Each reads grant rows directly: `authz.permission_grant` (permission text, coverage `organization|assigned`, optional geography/unit, optional registration source, validity window, active flag), `authz.assignment`, `authz.project_permission_grant` and `authz.project_assignment`, always for the signed transaction actor and re-checked after lock waits.
- There is **no role concept**: grants are inserted directly by an operator. There is no person/account separation for staff, no catalog of permission names, no approval workflow, no grant administration API or UI, and no audit of grant changes beyond the rows themselves.
- Runtime identities are restricted logins; privileged work is done by `NOLOGIN` function owners with fixed `SECURITY DEFINER` functions, an HMAC idempotency journal and atomic audit (pattern used for enrollment and policy administration).

## Decision (proposed)

### 1. Roles are data that compile into the existing grants (no rewrite of the predicates)

Introduce configurable roles and bindings, but **materialize** an active binding into ordinary `authz.permission_grant` / `project_permission_grant` / assignment rows tagged with `origin='role_binding'` and the binding id. The three existing predicates, every RLS policy and every existing test keep working unchanged; direct grants stay valid with `origin='direct'` (legacy). Materialized rows are written only by the IAM function owner; revoking, expiring or version-moving a binding sets `active=false`/`expires_at` on exactly its rows, never deletes them, so history stays queryable.

### 2. Data model (additive; every table versioned where mutable)

| Table                                    | Purpose and constraints                                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `iam.permission_catalog`                 | Known permission names with EN/SI labels, scope kind (organization, unit/geography, project), allowed sources and a **risk class**. Reference data, not authority. A permission with no explicit class is treated as **high** (fail closed). Provisional classes are labelled provisional until DEC-02. |
| `iam.person`                             | Staff identity per organization, separate from `authn.account` (new nullable `person_id` on the account), from farmers and from contact-only coordinators. A contact record never confers access.                                                                                                       |
| `iam.role` / `iam.role_version`          | Organization-scoped role with EN/SI names. **Role versions are immutable**: a version lists its permissions, coverage kind and source. Editing a role creates a new version; nothing already bound changes silently.                                                                                    |
| `iam.role_binding`                       | Person/account ↔ role version with scope (organization, unit, geography and/or project, intersecting as today, never OR), validity window, status, version, who requested and who approved. Pinned to a role version; moving to a new version is an explicit, approved action.                          |
| `iam.access_request` / `access_approval` | Proposed bind, unbind, version move, temporary or emergency grant. The risk class is computed from the catalog **at request time and is immutable**; reclassifying requires its own approval. One approval row per approver, unique per request.                                                        |
| `iam.access_audit` (append-only)         | Actor, session, action, before/after identifiers, request and approval ids, reason. Written atomically with the change; runtime logins cannot read it directly.                                                                                                                                         |

New `NOLOGIN` function owner `agri_iam_owner` (never an API login, never a member of a runtime role); the startup privilege gate gains the new identity and the private tables, exactly as for enrollment.

### 3. Authority and delegation rules (enforced in PostgreSQL, not in the UI)

- Administration capabilities are ordinary catalog permissions evaluated by the same predicates: `role.create`, `role.update`, `permission.grant`, `user.role.assign`, `device.view`, `device.approve`, `device.revoke`, plus read permissions for the admin views.
- **No self-grant:** an account cannot create, approve or apply an access request that targets itself.
- **No overflow:** a grantor can bind a role only if every permission in it is within the grantor's own current effective permissions at an equal or wider scope, and the target scope lies within the grantor's `permission.grant` scope. Checked inside the transaction after locks.
- **Risk-based approval (provisional Q62):** routine requests may be applied by one authorized administrator. High-risk requests need **two distinct approvers**, both different from the requester and from the grantee, each holding the approval permission for that scope. Open question: whether the requester may be one of the two.
- **Temporary and emergency grants (Q63):** a temporary binding must carry `expires_at`; expiry takes effect through the existing predicates immediately. Emergency elevation needs justification, a short maximum lifetime, enhanced audit and an automatic follow-up independent review. Whether emergency may skip dual approval is **not assumed** (needs separate authorization).
- **Step-up MFA (Q66):** high-risk apply requires a fresh proof of a consumed TOTP counter bound to the session and purpose with a short expiry (reusing the existing counter-consumption function). The current rule that every pilot staff account uses MFA is **not weakened** (conflict SC-06).

### 4. Mutation contract

Every mutation is a fixed function: stable mutation UUID, HMAC of the canonical payload for replay (same id, different payload conflicts), optimistic `expected_version`, current-actor and scope re-validation **after** advisory and row locks, atomic audit and materialization in one transaction, and a deliberately generic error to non-authorized callers. Runtime logins get `EXECUTE` only and read-only RLS views scoped by explicit read permissions; no direct writes.

### 5. Staff lifecycle (Q64)

One staff identity persists across transfers: a transfer ends the old bindings (history retained), creates new ones through the normal requests, revokes server sessions as required and records the actor. Deactivation revokes sessions and devices through the existing revocation functions. Offline limits (cached vault access cannot be remotely revoked) stay disclosed, not solved here. No public self-registration; accounts are provisioned by an authorized administrator.

### 6. Bootstrap (the first administrator)

No role, binding or grant is seeded. The first administrator is provisioned out of band by an operator script that calls an owner-only function with audit, in the style of the existing device-enrollment tool, under a documented two-person custody procedure. The procedure and who may perform it are an owner decision (DEC-02, DEC-08).

### 7. API, BFF and UI

Administrator-source routes only (never exposed by the field BFF): list/read roles, versions, permissions and bindings within scope; create role; create version; request bind/unbind/version move; approve/reject; apply. Strict DTOs, CSRF, response binding, no browser-supplied actor, source or risk class. English/Sinhala screens on the existing online-draft boundary (fresh authorized read, reviewed version, explicit review, one fixed retry request, no browser persistence). Names of roles are data, never hardcoded.

### 8. Slicing (each its own PR with independent tests; none started)

| Slice  | Content                                                                                                                       | Gate             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| P1-03a | Catalog, person, role and role version tables, scoped read functions and views. No mutation, no materialization.              | G1 design review |
| P1-03b | Role/version creation and routine binding with materialization, delegation ceiling, journal, audit.                           | G1               |
| P1-03c | Access requests, dual approval for high risk, no-self-approval, temporary grants and expiry.                                  | G1               |
| P1-03d | NestJS services, BFF routes, TanStack reads.                                                                                  | after 03b/03c    |
| P1-03e | Bilingual admin screens.                                                                                                      | after 03d        |
| P1-26  | Step-up MFA, recovery, emergency elevation, access reviews (quarterly privileged, six-monthly ordinary), device lifecycle UI. | G1, DEC-02       |

### 9. Acceptance tests (mutation-checked where they assert isolation or integrity)

Direct-SQL and API denial by default; missing, forged and spoofed actor/source; wrong organization; no self-grant, no overflow above the grantor's own scope, no approval by the requester, grantee or a duplicate approver; risk class cannot be changed to dodge approval; role version pinning and explicit moves; materialized grants match the role/scope exactly and revoke/expiry make the existing predicates deny immediately; replay and changed-payload conflict; stale version; authorization re-checked after lock waits; audit rolled back with the change; legacy direct grants unchanged; Officer A/B isolation with role-derived grants; wrong-organization foreign keys rejected; English and Sinhala flows, keyboard and late-response cancellation.

### 10. Required before implementation

1. **G1 independent security review** of this design (privileged grants, delegation ceiling, materialization, bootstrap).
2. Owner decisions under DEC-02: risk classification of each permission, number and independence of approvers, whether emergency may skip dual approval, who may create roles, bootstrap custody, maximum temporary lifetimes, MFA step-up scope.
3. Confirmation that role and permission names stay configurable data and that no job title carries implicit authority.

## Consequences and risks

- Materialization keeps today's tested predicates, at the cost of a derived-data consistency requirement (binding rows and materialized rows must change in one transaction under a lock; reconciliation tests and a verification function are part of P1-03b).
- Role version pinning avoids silent privilege escalation but means role changes need an explicit migration of bindings.
- A permission mistakenly left unclassified is treated as high risk, which may slow administration but fails safe.
- Without client DEC-02 input, all risk classes and approver counts remain provisional defaults and must be labelled so in the UI.
