# Proposed role and permission matrix (DEC-02) — DRAFT v2 for owner review

Status: **proposal, revised 18 Nov 2026 at the owner's request, before any provisional approval is recorded.** Nothing here is approved, seeded or enforced. **No roles are seeded, no grants are issued, no authorization code or migration changes, and Gate G1 (independent security review) and client approval are NOT complete.** Every decision stays provisional until the owner explicitly reviews it (OWNER-D2 in the [decision register](../requirements/OPEN_DECISIONS.md)). Real names, contact details and identity numbers are never recorded in this repository.

## 0. What changed in v2

| #   | Owner instruction                                                                                       | Where addressed                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Make the Field Officer `enrollment.withdraw` entry an explicit denial                                   | §5: the cell is now **DENY**; it is already enforced in PostgreSQL (§6)                                                                                    |
| 2   | Define scopes by operation without accidental broadening                                                | §3: required scope dimensions per operation and nine scope rules                                                                                           |
| 3   | Review sensitive permissions                                                                            | §4: audit records, device management, bulk export, inventory adjustment, privilege administration, plus verify, correct, overlap resolution and withdrawal |
| 4   | Apply least-privilege answers for verification, correction, project managers, coordinators, supervisors | §5 and §7: each applied and labelled as a recommendation, not an owner answer                                                                              |
| 5   | A farmer's creator cannot verify the record                                                             | §6 rule SD-1. **Not enforced in the database today**; it needs a reviewed future change and is listed as a required test                                   |
| 6   | Unapproved or unanswered cells stay denied                                                              | §1 and §5: every former "?" is now **DENY\*** (denied by default); a **P** cell is not a grant                                                             |
| 7   | Separate proposed capabilities from actual grants                                                       | §1: three layers, with the current state of each                                                                                                           |

## 1. Three layers, and what is true of each today

| Layer                             | What it is                                                                              | State today                                                                                | Who can change it                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **A. Proposed role capabilities** | This document: design intent for what each capability bundle _could_ be allowed to do   | Draft v2, under owner review                                                               | The owner, by review                                                       |
| **B. Owner approval record**      | Which cells the owner has approved provisionally (§9)                                   | **Empty: no approval is recorded by this document.** The owner records it after review     | The owner only                                                             |
| **C. Actual granted permissions** | Rows in `authz.permission_grant` and `authz.project_permission_grant` for real accounts | **None for real accounts.** Only synthetic test fixtures exist. This document creates none | A later, separately reviewed process after approval and independent review |

**A cell is effective only when all three hold:** it is proposed (A), the owner has approved it (B), and a grant has been issued through the reviewed process (C). In every other case the permission is denied. Reading **P** as "granted" is a mistake this document is written to prevent.

Roles are **capability bundles named for discussion**, not database enums and not job titles. No access follows from a title alone ([ADR 0022](../decisions/ADR-0022-dynamic-role-and-assignment-administration.md), FR-ORG-006 to FR-ORG-011).

Cell symbols:

| Symbol     | Meaning                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **P**      | **Proposed capability**, scoped to the holder's assignments. Not approved, not granted.                                                 |
| **DENY**   | Explicitly denied. Either a recorded provisional decision (cited) or a least-privilege default stated in the notes.                     |
| **DENY\*** | **Denied by default pending an owner answer.** A question exists in §8; until it is answered and approved, the permission stays denied. |

## 2. Permission catalog

### 2.1 Codes that exist in the database today (16, implemented)

`farmer.create`, `farmer.read`, `farmer.correct`, `farmer.verify`, `farmer.audit.read`, `land.create`, `land.read`, `land.geometry.create`, `land.geometry.read`, `project.create`, `project.read`, `project.update`, `enrollment.create`, `enrollment.read`, `enrollment.withdraw`, `enrollment.policy`.

`enrollment.policy.set` is only the audit action name, not a grant.

### 2.2 Planned codes (design only; names are proposals, none exists)

| Area                  | Codes (proposed)                                                                                            | Source                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Farmer corrections    | `farmer.correction.request` (request a correction without applying it)                                      | This v2, least privilege        |
| Inventory             | `inventory.read`, `inventory.catalog.manage`, `inventory.receive`, `inventory.transfer`, `inventory.adjust` | ADR 0026 (proposed)             |
| Land overlap review   | `overlap.review`, `overlap.resolve`                                                                         | ADR 0024 (proposed)             |
| Access administration | `role.create`, `role.update`, `permission.grant`, `user.role.assign`, `grant.approve`                       | FR-ORG-008, ADR 0022 (proposed) |
| Reporting             | `report.read`, `report.export`                                                                              | SRS reporting requirements      |
| Devices               | `device.approve`, `device.revoke`                                                                           | operator tooling only today     |

### 2.3 Risk classes (proposed)

| Class         | Permissions                                                                                                                                                                                  | Rule (Q62, proposed)                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Routine**   | `farmer.read`, `land.read`, `land.geometry.read`, `enrollment.read`, `project.read`, `inventory.read`, `inventory.receive`, `report.read`                                                    | Granted by an authorized administrator, audited                                                              |
| **Sensitive** | `farmer.create`, `farmer.correction.request`, `land.create`, `land.geometry.create`, `enrollment.create`, `farmer.correct`, `farmer.verify`, `inventory.transfer`, `overlap.review`          | Granted by an administrator within their own scope, audited; reviewed every six months                       |
| **High-risk** | `farmer.audit.read`, `enrollment.withdraw`, `enrollment.policy`, `device.approve`, `device.revoke`, `inventory.adjust`, `overlap.resolve`, `report.export`, every access-administration code | **Two distinct approvers**, no self-approval, risk class not changeable by the requester; reviewed quarterly |

## 3. Scope by operation

### 3.1 Scope rules (apply to every grant)

| #   | Rule                                                                                                                                                                                                                                                                                         | Why                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| S1  | Every grant carries an organization; nothing crosses organizations.                                                                                                                                                                                                                          | Existing composite foreign keys already enforce this.                                                              |
| S2  | Scope dimensions are **ANDed**. A grant for Zone A and Project 1 is never Zone A or Project 1 (FR-ORG-007).                                                                                                                                                                                  | Prevents accidental widening.                                                                                      |
| S3  | A **missing mandatory dimension is never a wildcard**. A grant lacking a dimension its operation requires is invalid and denies.                                                                                                                                                             | "Empty means everything" is the commonest way access widens by accident.                                           |
| S4  | The existing `organization` coverage mode (access across the whole organization) is proposed for **administrator-class, organization-level operations only**. Officer, supervisor, coordinator and storekeeper grants use `assigned` coverage.                                               | Today the database allows `organization` coverage on any permission, so this needs a reviewed constraint (future). |
| S5  | A grant covers **exactly the named geography, unit, project or location**. Whether it also covers child units is a rule the owner and reviewer must confirm (Q7); until then children are **not** covered.                                                                                   | Avoids assuming a hierarchy rule nobody has approved.                                                              |
| S6  | Scope comes from **current effective-dated assignments**. A transfer, expiry or suspension denies at once; history keeps the original actor (Q64).                                                                                                                                           | Old-region access must stop immediately.                                                                           |
| S7  | An operation that **touches two scopes** needs authority in **both**: correcting a farmer into another geography, a stock transfer between locations, approving a device for another account's scope. (The farmer correction function already checks the previous and the target geography.) | Prevents moving data or stock into or out of a scope you do not hold.                                              |
| S8  | Reading a record needs the **read** permission for that record's scope in addition to the operation's own permission. (Audit reads, verification and enrollment reads already require `farmer.read` today.)                                                                                  | A sensitive action never works on data you cannot see.                                                             |
| S9  | A grant can never exceed its grantor's own authority or scope (delegation ceiling), and a holder cannot widen their own scope.                                                                                                                                                               | FR-ORG-008: no grant exceeds the delegator.                                                                        |

### 3.2 Required scope dimensions by operation

Org is always required. **G** geography, **P** project, **L** inventory location.

| Operation                              | Org | G         | P         | L         | How the scope applies, and the widening hazard guarded                                                                                                          |
| -------------------------------------- | --- | --------- | --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `farmer.create`                        | ✓   | ✓         | —         | —         | Only in active authorized coverage. Creation grants no read, update, enrollment or ownership (PILOT-02).                                                        |
| `farmer.read`                          | ✓   | ✓         | —         | —         | The farmer's geography. Project membership does not widen it.                                                                                                   |
| `farmer.correction.request`            | ✓   | ✓         | —         | —         | Same geography as read. A request changes nothing.                                                                                                              |
| `farmer.correct`                       | ✓   | ✓         | —         | —         | Checked for the **old and new** geography when a correction moves a farmer (S7, already implemented).                                                           |
| `farmer.verify`                        | ✓   | ✓         | —         | —         | The farmer's geography, plus the creator rule SD-1.                                                                                                             |
| `farmer.audit.read`                    | ✓   | ✓         | —         | —         | The farmer's geography, plus `farmer.read` (already required). Never an export.                                                                                 |
| `land.read`, `land.geometry.read`      | ✓   | ✓         | —         | —         | The land's geography. Overlap detection sees everything in the organization **internally** but discloses only within scope (ADR 0024).                          |
| `land.create`, `land.geometry.create`  | ✓   | ✓         | —         | —         | The land's geography.                                                                                                                                           |
| `project.read`                         | ✓   | —         | ✓         | —         | The assigned project.                                                                                                                                           |
| `project.create`                       | ✓   | —         | —         | —         | Organization-level. Today accepted for the administrator source only.                                                                                           |
| `project.update`                       | ✓   | —         | ✓         | —         | The assigned project only. Today administrator-source only; a project-manager grant needs a reviewed rule change.                                               |
| `enrollment.read`, `enrollment.create` | ✓   | ✓         | ✓         | —         | Project grant **and** the farmer's geography **and** `farmer.read` (existing rule). A project grant alone never reaches farmers outside the holder's geography. |
| `enrollment.withdraw`                  | ✓   | ✓         | ✓         | —         | Same as enrollment, administrator source only (enforced).                                                                                                       |
| `enrollment.policy`                    | ✓   | —         | ✓         | —         | One project at a time; administrator source only today.                                                                                                         |
| `inventory.read`                       | ✓   | —         | —         | ✓         | Locations in scope only. Project filters narrow, never widen.                                                                                                   |
| `inventory.receive`                    | ✓   | —         | —         | ✓         | The **destination** location only.                                                                                                                              |
| `inventory.transfer`                   | ✓   | —         | —         | ✓✓        | **Source and destination** locations, held by **different** people: dispatch needs the source, receipt needs the destination (Q26).                             |
| `inventory.adjust`                     | ✓   | —         | —         | ✓         | The adjusted location, and the approver may **not** be its custodian.                                                                                           |
| `inventory.catalog.manage`             | ✓   | —         | —         | —         | Organization-level catalog; changes no balance.                                                                                                                 |
| `overlap.review`, `overlap.resolve`    | ✓   | ✓         | —         | —         | Parcels inside the reviewer's geography; the capturer of a parcel cannot resolve its overlap.                                                                   |
| `report.read`                          | ✓   | ✓         | ✓         | ✓         | Rows are filtered in the database by whichever of G, P, L the report's domain uses; a report can never return a row the same actor could not read directly.     |
| `report.export`                        | ✓   | ✓         | ✓         | ✓         | Same filter, plus purpose, row cap and two approvers (§4).                                                                                                      |
| `device.approve`, `device.revoke`      | ✓   | ✓         | —         | —         | The device's account scope. An approver cannot approve a device for their own account (§4).                                                                     |
| access administration                  | ✓   | per grant | per grant | per grant | Limited by the delegation ceiling (S9). Cannot change own roles.                                                                                                |

## 4. Review of sensitive permissions

| Permission                                                                                   | Why it is sensitive                                                                                                                | Proposed controls (all provisional)                                                                                                                                                                                                                                                                                                                                                                   | Approvals                                                                                           |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `farmer.audit.read` (farmer audit records)                                                   | Shows who changed which farmer, when and why: personal history and an insider-abuse trail.                                         | Read-only and scoped to the geography; needs `farmer.read` (already enforced); held by the reviewer or auditor and the administrator only; **never an export** and never held by officers for their own records; reading the trail should itself be logged (**not implemented today**).                                                                                                               | High-risk: two approvers to grant                                                                   |
| `device.approve`, `device.revoke` (device management)                                        | A device is the second factor of trust; a wrongly approved device defeats the controls around lost phones.                         | Approver is an administrator who is **not** the account holder; the device request's independent verification code is checked by a separate channel; approval is bound to one account and its scope; revocation is immediate and revokes the related sessions (Q64); both audited. Today this is operator tooling only.                                                                               | High-risk: approver is never the requester; owner to decide whether two approvers are required (Q9) |
| `report.export` (bulk exports)                                                               | One export can move a whole area's farmers out of the system with no further control.                                              | **Denied to every role by default.** If the owner approves it: two approvers, a stated purpose, an expiry, only the fields the purpose needs (no NIC or phone by default), a row cap, the same scope filter as reading, no caching, an audit row with the row count, and a time-limited download.                                                                                                     | High-risk: two approvers per grant and a recorded reason per export                                 |
| `inventory.adjust` (inventory adjustment)                                                    | Adjusting stock is the easiest way to hide a loss.                                                                                 | A separate person from the storekeeper who holds the location; a mandatory reason; recorded only as a **compensating** ledger entry linked to the original, never an edit; scoped to one location; cannot be used to make stock negative (ADR 0026).                                                                                                                                                  | High-risk: requester and approver are distinct accounts (Q24)                                       |
| Privilege administration (`role.*`, `permission.grant`, `user.role.assign`, `grant.approve`) | The power to grant power. A mistake here breaks every other control.                                                               | No self-grant or self-approval; the delegation ceiling (S9); an administrator cannot change their own roles; MFA stays mandatory; effective immediately with session revocation; temporary grants expire by themselves; emergency elevation needs stronger authentication and independent review (Q63); the first administrator is created by a controlled bootstrap, not by this process (ADR 0022). | High-risk: two distinct approvers (Q62); risk class cannot be changed by the requester              |
| `farmer.verify`                                                                              | Verification turns a pending record into a trusted one.                                                                            | A **separate capability** from creating and correcting; rule SD-1 (creator cannot verify); held by the supervisor only in this proposal.                                                                                                                                                                                                                                                              | Sensitive: administrator within scope, six-monthly review                                           |
| `farmer.correct`                                                                             | Correcting changes the identity data of a record; correcting a verified record returns it to pending review (already implemented). | Officers **request** corrections; applying them is held by the supervisor and the administrator only; reason mandatory (already enforced).                                                                                                                                                                                                                                                            | Sensitive                                                                                           |
| `overlap.resolve`                                                                            | Decides whose land a disputed boundary belongs to.                                                                                 | Separate from `overlap.review`; never the parcel's capturer; reason mandatory; effective-dated and append-only (ADR 0024).                                                                                                                                                                                                                                                                            | High-risk                                                                                           |
| `enrollment.withdraw`                                                                        | Ends a farmer's participation and can end their benefits.                                                                          | Administrator source only (enforced in PostgreSQL); reason and history kept; officers cannot withdraw (DEC-12, Q7).                                                                                                                                                                                                                                                                                   | High-risk                                                                                           |

## 5. Matrix v2 (proposed capabilities by role)

Columns: **Adm** administrator · **PM** project manager · **FO** field officer · **Sup** supervisor · **Sto** storekeeper or receiver · **Rev** reviewer or auditor · **Coo** zone or CBO coordinator (only if registered with an account).

**These are proposed capabilities, not grants.** Every **P** is subject to §1: owner approval, then a separate reviewed grant. Every **DENY\*** is denied until the owner answers the question named in §8.

| Permission                        | Adm    | PM     | FO       | Sup    | Sto    | Rev    | Coo    |
| --------------------------------- | ------ | ------ | -------- | ------ | ------ | ------ | ------ |
| `farmer.read`                     | P      | P      | P        | P      | DENY   | P      | DENY\* |
| `farmer.create`                   | P      | DENY   | P        | DENY\* | DENY   | DENY   | DENY\* |
| `farmer.correction.request`       | DENY   | DENY   | P        | DENY   | DENY   | DENY   | DENY\* |
| `farmer.correct`                  | P      | DENY   | DENY     | P      | DENY   | DENY   | DENY   |
| `farmer.verify`                   | DENY\* | DENY   | DENY     | P      | DENY   | DENY   | DENY   |
| `farmer.audit.read`               | P      | DENY   | DENY     | DENY\* | DENY   | P      | DENY   |
| `land.read`                       | P      | P      | P        | P      | DENY   | P      | DENY\* |
| `land.create`                     | P      | DENY   | P        | DENY   | DENY   | DENY   | DENY   |
| `land.geometry.read`              | P      | P      | P        | P      | DENY   | P      | DENY   |
| `land.geometry.create`            | P      | DENY   | P        | DENY   | DENY   | DENY   | DENY   |
| `project.read`                    | P      | P      | P        | P      | P      | P      | DENY\* |
| `project.create`                  | P      | DENY   | DENY     | DENY   | DENY   | DENY   | DENY   |
| `project.update`                  | P      | P      | DENY     | DENY   | DENY   | DENY   | DENY   |
| `enrollment.read`                 | P      | P      | P        | P      | DENY   | P      | DENY\* |
| `enrollment.create`               | P      | DENY   | P        | DENY   | DENY   | DENY   | DENY   |
| `enrollment.withdraw`             | P      | DENY   | **DENY** | DENY   | DENY   | DENY   | DENY   |
| `enrollment.policy`               | P      | DENY   | DENY     | DENY   | DENY   | DENY   | DENY   |
| `inventory.read`                  | P      | P      | DENY     | P      | P      | P      | DENY   |
| `inventory.catalog.manage`        | P      | DENY   | DENY     | DENY   | DENY   | DENY   | DENY   |
| `inventory.receive`               | DENY\* | DENY   | DENY     | DENY   | P      | DENY   | DENY   |
| `inventory.transfer`              | DENY   | DENY   | DENY     | DENY\* | P      | DENY   | DENY   |
| `inventory.adjust`                | DENY\* | DENY   | DENY     | DENY   | DENY\* | DENY   | DENY   |
| `overlap.review`                  | DENY\* | DENY   | DENY     | P      | DENY   | P      | DENY   |
| `overlap.resolve`                 | DENY\* | DENY   | DENY     | DENY\* | DENY   | DENY\* | DENY   |
| `report.read`                     | P      | P      | DENY     | P      | DENY   | P      | DENY\* |
| `report.export`                   | DENY\* | DENY\* | DENY     | DENY   | DENY   | DENY\* | DENY   |
| access administration             | P      | DENY   | DENY     | DENY   | DENY   | DENY   | DENY   |
| `device.approve`, `device.revoke` | P      | DENY   | DENY     | DENY   | DENY   | DENY   | DENY   |

### Notes on the revised cells

- **Field officer `enrollment.withdraw` is an explicit DENY.** This is a recorded provisional decision (Q7, DEC-12) and it is **already enforced in PostgreSQL**: only an administrator-source grant may carry `enrollment.withdraw` (a check constraint and the authorization function). The earlier "— (R)" notation is gone.
- **Verification (least privilege).** `farmer.verify` is a separate capability proposed for the **supervisor only**. The administrator is `DENY*` (an owner question, Q4), not granted by default, because holding every power in one role is what least privilege avoids. The creator cannot verify their own record (SD-1).
- **Corrections (least privilege).** Field officers get `farmer.correction.request` (a planned code) and **cannot** apply a correction. The supervisor and the administrator apply corrections. Administrators and supervisors hold `farmer.correct` directly, so they do not also need the request permission. A request is a new permission and therefore a future reviewed change.
- **Project managers (least privilege).** Read access plus `project.update` for their own project; **no** enrollment creation, no correction, no verification, no policy changes. Reading enrollments also needs `farmer.read` today (rule S8), so the project manager's `farmer.read` is scoped to the project's geography and is read-only. `project.update` today needs an administrator-source grant, so this cell needs a reviewed rule change.
- **Coordinators (least privilege).** The whole column is denied by default. A position alone grants nothing (PILOT-02). If the owner confirms that coordinators have accounts and want read access within their coverage, the `DENY*` cells for `farmer.read`, `land.read`, `project.read` and `enrollment.read` can be turned into **P** with `assigned` coverage. Otherwise the column is dropped.
- **Supervisors (least privilege).** They read, verify, request or apply corrections and review overlaps. They cannot create farmers or land, cannot capture geometry, cannot create enrollments and cannot export. Overlap resolution is not given by default.
- **Reviewer or auditor.** Read-only everywhere, including the audit trail. Reading the trail also needs `farmer.read`, which is why the reviewer's `farmer.read` is **P**.
- **Administrator.** Administers, but does not by default hold `farmer.verify`, `inventory.receive`, `inventory.adjust`, `overlap.resolve` or `report.export`.

## 6. Separation-of-duty rules (proposed) and whether the database enforces them today

| #     | Rule                                                                                                                                                                                                                                                                                         | Enforced in PostgreSQL today?                                                                                                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SD-1  | **The account that created a farmer (`created_by`) cannot verify that farmer.** Stronger proposal: nor can the account that made the most recent correction, because a correction returns a verified record to pending review. The check lives inside the verification function, not the UI. | **No.** `farm.change_farmer` verifies on `farmer.read` plus `farmer.verify` for the geography and does not compare the verifier with the creator. `farm.farmer.created_by` exists, so a check is feasible. It needs a reviewed future change; this document changes no code. |
| SD-2  | Field officers cannot withdraw enrollments.                                                                                                                                                                                                                                                  | **Yes.** Only an administrator-source grant may carry `enrollment.withdraw`.                                                                                                                                                                                                 |
| SD-3  | A requester can never approve their own grant, and no holder can grant authority they do not hold (FR-ORG-008, FR-ORG-009).                                                                                                                                                                  | No (IAM administration is design only).                                                                                                                                                                                                                                      |
| SD-4  | High-risk grants need two distinct approvers; the requester cannot change the risk class (Q62).                                                                                                                                                                                              | No (design only).                                                                                                                                                                                                                                                            |
| SD-5  | A dispatcher cannot confirm their own receipt of stock (Q26).                                                                                                                                                                                                                                | No (inventory not built).                                                                                                                                                                                                                                                    |
| SD-6  | The person who captured a parcel cannot resolve its overlap (ADR 0024).                                                                                                                                                                                                                      | No (design only).                                                                                                                                                                                                                                                            |
| SD-7  | The person who adjusts stock cannot be the custodian approving it (Q24).                                                                                                                                                                                                                     | No (design only).                                                                                                                                                                                                                                                            |
| SD-8  | Temporary grants carry a justification, a validity window and automatic expiry; emergency elevation needs stronger authentication and independent review (Q63).                                                                                                                              | Partly: grants already have `starts_at` and `expires_at`; the approval flow is design only.                                                                                                                                                                                  |
| SD-9  | MFA stays mandatory for all current accounts and is not weakened here (Q66 note).                                                                                                                                                                                                            | Yes for the current pilot accounts.                                                                                                                                                                                                                                          |
| SD-10 | Transfers, suspension and departure recalculate authorization and revoke sessions; history keeps the original actor (Q64).                                                                                                                                                                   | Partly (sessions and revocation exist); the staff lifecycle is design only.                                                                                                                                                                                                  |
| SD-11 | Access reviews: privileged grants quarterly, ordinary every six months, with documented retain, modify or revoke decisions (Q65).                                                                                                                                                            | No (design only).                                                                                                                                                                                                                                                            |

**Required acceptance test for SD-1 before any code is accepted:** Officer A creates a farmer; Officer A holds `farmer.verify` and tries to verify it and is **denied**; Supervisor B verifies it and is **allowed**; Officer A corrects a verified farmer and then tries to verify it and is **denied**; the same checks fail closed when called directly in SQL, not just through the API, and a mutation check that removes the comparison makes the test fail.

## 7. What the database enforces about scope today

- Grants are rows in `authz.permission_grant` (coverage `organization` or `assigned`, optional geography or unit, optional registration source, `starts_at` and `expires_at`) and `authz.project_permission_grant` (a required project, optional geography or unit; only `enrollment.read` and `enrollment.create`).
- There is **no inventory-location scope yet**; it arrives with ADR 0026 and must follow rules S2, S3 and S5.
- `coverage = 'organization'` is currently allowed for any permission, which is why rule S4 proposes a reviewed constraint.
- Scope, expiry and the actor are decided in PostgreSQL on every request. A hidden button is never a control.

## 8. Questions for the owner (every unanswered cell stays denied)

1. **Verification holder (Q1):** supervisors only (proposed), or also administrators (`farmer.verify` is `DENY*` for them)? Should the stronger SD-1 rule (no verification by the last corrector either) apply?
2. **Coordinators (Q2):** do coordinators have accounts in Phase 1? If not, the column is dropped.
3. **Project managers (Q3):** keep them read-only on enrollments (proposed), or may they create enrollments for their own project?
4. **Administrators (Q4):** do they also verify farmers, or is verification kept separate from administration?
5. **Exports (Q5):** is `report.export` authorized at all in the pilot, and for whom?
6. **Stock adjustment (Q6):** who may approve `inventory.adjust`, and is any role allowed to request it?
7. **Child units (Q7):** does a grant on a geography or unit cover its children? Until you answer, it does not (rule S5).
8. **Organization coverage (Q8):** do you agree that `organization` coverage is limited to administrator-class, organization-level operations (rule S4)?
9. **Devices (Q9):** does device approval need two approvers, or one administrator who is not the account holder plus the independent verification code?
10. **Named approvers (Q10):** who are the first system administrator, the two high-risk approvers, who may classify risk and who runs access reviews (see §10)?

## 9. Owner approval record (to be completed by the owner)

**This document records no approval.** The owner records a provisional decision per group below after review. A recorded approval is provisional, is not client approval, does not complete Gate G1, and still issues no grant.

| Cell group                                              | Proposed in v2 | Owner decision (Approve / Change / Reject) | Date | Notes |
| ------------------------------------------------------- | -------------- | ------------------------------------------ | ---- | ----- |
| Field officer capabilities                              | §5, column FO  | Pending                                    | —    | —     |
| Supervisor capabilities                                 | §5, column Sup | Pending                                    | —    | —     |
| Administrator capabilities                              | §5, column Adm | Pending                                    | —    | —     |
| Project manager capabilities                            | §5, column PM  | Pending                                    | —    | —     |
| Storekeeper capabilities                                | §5, column Sto | Pending                                    | —    | —     |
| Reviewer or auditor capabilities                        | §5, column Rev | Pending                                    | —    | —     |
| Coordinator capabilities                                | §5, column Coo | Pending                                    | —    | —     |
| Scope rules S1 to S9 and the operation scope table      | §3             | Pending                                    | —    | —     |
| Sensitive-permission controls                           | §4             | Pending                                    | —    | —     |
| Separation-of-duty rules SD-1 to SD-11 (including SD-1) | §6             | Pending                                    | —    | —     |

## 10. Named approvers (owner to supply, outside this repository)

| Decision                                       | Role or person responsible | Name (not recorded here) | Date confirmed |
| ---------------------------------------------- | -------------------------- | ------------------------ | -------------- |
| First system administrator (bootstrap)         | —                          | —                        | —              |
| Approver 1 for high-risk grants                | —                          | —                        | —              |
| Approver 2 for high-risk grants                | —                          | —                        | —              |
| Who may classify or reclassify risk            | —                          | —                        | —              |
| Who reviews access (quarterly and six-monthly) | —                          | —                        | —              |

## 11. What happens after review

1. The owner returns §9 and §10 with answers. Cells without an answer stay denied.
2. I record the approved cells as a provisional decision (not client-approved) and update ADR 0022's acceptance tests to cover exactly that matrix, including the denied cells and rule SD-1.
3. The independent reviewer examines ADR 0022 and the matrix together (Gate G1). Only then does IAM administration code start (P1-03a), and the SD-1 database change is made as its own reviewed migration with the tests in §6.
4. **No grant is seeded to a real account** until the owner and the client approve it and the reviewed grant process exists.

This document does not seed roles, issue grants, change authorization code, approve offline enrollment, or decide any production use.
