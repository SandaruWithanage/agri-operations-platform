# Proposed role and permission matrix (DEC-02) — DRAFT for owner review

Status: **proposal. Nothing here is approved, seeded or enforced.** It answers the owner's request of 18 Nov 2026 (OWNER-D2 in the [decision register](../requirements/OPEN_DECISIONS.md)) to draft a role and permission matrix for review. It is not client-approved and has not had the independent security review (Gate G1). **No grant is seeded to any real account**, and no code, migration or permission changes with this document. The final matrix and the named approvers are the owner's and the client's to supply.

## How to read this

- Roles are **capability bundles named for discussion**, not database enums and not job titles. The principle the owner adopted is that roles are configurable data with scoped permissions and audited approvals; no access follows from a title alone ([ADR 0022](../decisions/ADR-0022-dynamic-role-and-assignment-administration.md), FR-ORG-006 to FR-ORG-011).
- Every grant is **scoped**: organization AND project AND geography (AND stock location once inventory exists). Scope clauses are conjunctive; a Zone-A-and-Project-1 grant is never Zone-A-or-Project-1 (FR-ORG-007).
- Each cell uses one symbol:

| Symbol | Meaning                                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------- |
| **R**  | Matches a **recorded provisional owner decision** (cited in the notes). Still not client-approved.   |
| **P**  | **Proposed** least-privilege grant, scoped to the holder's assignments. Needs the owner's yes or no. |
| **?**  | A judgement the owner must make. No proposal is offered because the sources do not decide it.        |
| —      | No grant.                                                                                            |

## 1. Permission catalog

### 1.1 Codes that exist in the database today (implemented)

`farmer.create`, `farmer.read`, `farmer.correct`, `farmer.verify`, `farmer.audit.read`, `land.create`, `land.read`, `land.geometry.create`, `land.geometry.read`, `project.create`, `project.read`, `project.update`, `enrollment.create`, `enrollment.read`, `enrollment.withdraw`, `enrollment.policy`.

### 1.2 Planned codes (design only; names are proposals)

| Area                       | Codes (proposed)                                                                                            | Source                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Inventory (P1-18 to P1-20) | `inventory.read`, `inventory.catalog.manage`, `inventory.receive`, `inventory.transfer`, `inventory.adjust` | ADR 0026 (proposed)             |
| Land overlap review        | `overlap.review`, `overlap.resolve`                                                                         | ADR 0024 (proposed)             |
| Access administration      | `role.create`, `role.update`, `permission.grant`, `user.role.assign`, `grant.approve`                       | FR-ORG-008, ADR 0022 (proposed) |
| Reporting                  | `report.read`, `report.export`                                                                              | SRS reporting requirements      |
| Devices                    | `device.approve`, `device.revoke`                                                                           | existing operator tooling only  |

## 2. Risk classes (proposed)

| Class         | Examples                                                                                                        | Approval rule (Q62, proposed)                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Routine**   | `farmer.read`, `land.read`, `enrollment.read`, `project.read`, `inventory.read`, `inventory.receive`            | Granted by an authorized administrator, audited.                                                                        |
| **Sensitive** | `farmer.create`, `land.create`, `land.geometry.create`, `enrollment.create`, `farmer.correct`, `farmer.verify`  | Granted by an authorized administrator within their own scope, audited; reviewed every six months.                      |
| **High-risk** | `enrollment.withdraw`, `inventory.adjust`, `overlap.resolve`, `report.export`, every access-administration code | **Two distinct approvers**, no requester self-approval, risk class not changeable by the requester. Reviewed quarterly. |

## 3. Matrix (capability bundles × permission)

Columns: **Adm** administrator · **PM** project manager · **FO** field officer · **Sup** supervisor · **Sto** storekeeper/receiver · **Rev** reviewer/auditor · **Coo** zone or CBO coordinator (only if registered with an account).

| Permission                   | Adm | PM  | FO    | Sup | Sto | Rev | Coo |
| ---------------------------- | --- | --- | ----- | --- | --- | --- | --- |
| `farmer.read`                | P   | P   | P     | P   | —   | ?   | ?   |
| `farmer.create`              | P   | —   | R     | ?   | —   | —   | ?   |
| `farmer.correct`             | P   | —   | ?     | P   | —   | —   | —   |
| `farmer.verify`              | ?   | —   | —     | ?   | —   | —   | —   |
| `farmer.audit.read`          | P   | —   | —     | —   | —   | P   | —   |
| `land.read`                  | P   | P   | P     | P   | —   | P   | ?   |
| `land.create`                | P   | —   | P     | ?   | —   | —   | —   |
| `land.geometry.read`         | P   | P   | P     | P   | —   | P   | —   |
| `land.geometry.create`       | P   | —   | P     | —   | —   | —   | —   |
| `project.read`               | P   | P   | P     | P   | P   | P   | P   |
| `project.create` / `.update` | P   | P   | —     | —   | —   | —   | —   |
| `enrollment.read`            | P   | P   | P     | P   | —   | P   | ?   |
| `enrollment.create`          | P   | ?   | R     | ?   | —   | —   | —   |
| `enrollment.withdraw`        | R   | —   | — (R) | —   | —   | —   | —   |
| `enrollment.policy`          | P   | ?   | —     | —   | —   | —   | —   |
| `inventory.read`             | P   | P   | —     | P   | P   | P   | —   |
| `inventory.catalog.manage`   | P   | —   | —     | —   | —   | —   | —   |
| `inventory.receive`          | ?   | —   | —     | —   | P   | —   | —   |
| `inventory.transfer`         | —   | —   | —     | ?   | P   | —   | —   |
| `inventory.adjust`           | ?   | —   | —     | —   | ?   | —   | —   |
| `overlap.review`             | ?   | —   | —     | P   | —   | P   | —   |
| `overlap.resolve`            | ?   | —   | —     | ?   | —   | ?   | —   |
| `report.read`                | P   | P   | —     | P   | —   | P   | ?   |
| `report.export`              | ?   | ?   | —     | —   | —   | ?   | —   |
| access-administration codes  | P   | —   | —     | —   | —   | —   | —   |
| `device.approve` / `.revoke` | P   | —   | —     | —   | —   | —   | —   |

`— (R)` means a recorded decision that the role is **denied**: Q7 and the DEC-12 recommendation say field officers cannot withdraw enrollments; only an administrator with an explicit `enrollment.withdraw` may. The Adm entry is the recorded provisional default.

### Notes on what the database enforces today

`project.create`, `project.update` and `enrollment.policy` are currently accepted only for the **administrator** grant source (migration `20261116_enrollment_policy_admin`). Granting them to a project-manager bundle therefore needs a reviewed change to that rule, not just a grant; the **P** and **?** cells for those rows describe the proposed end state. `enrollment.policy.set` is only the audit action name, not a grant.

### Notes on the cells that are recorded decisions (R)

- **FO `farmer.create`** (PILOT-02): officers create only within active authorized coverage; a coordinator needs an account, an active assignment and explicit permission, and creation grants no implicit read, update, enrollment or ownership.
- **FO `enrollment.create`** (DEC-12): only when **explicitly granted**, constrained by active organization, project and geography, never seeded to all field officers; offline enrollment stays disabled (ADR 0021 not accepted).
- **Adm `enrollment.withdraw`** (Q7, FR-ORG-015): provisional administrator default; other roles later only by separate reviewed grants, with reasons and history kept.

## 4. Separation-of-duty rules (proposed)

1. A requester can never approve their own grant, and no holder can grant authority they do not hold (FR-ORG-008, FR-ORG-009).
2. High-risk grants need **two distinct approvers**, and risk classification cannot be changed by the requester (Q62).
3. A dispatcher cannot confirm their own receipt of stock; the receiver is a different account (Q26).
4. The person who captured a parcel cannot resolve its overlap; reviewer roles are separate from capturers (ADR 0024).
5. Temporary grants carry a justification, a validity window and automatic expiry; emergency elevation needs stronger authentication, short duration and independent review (Q63, FR-ORG-010).
6. MFA stays mandatory for all current accounts; it is not weakened here (Q66 note).
7. Transfers, suspension and departure recalculate authorization and revoke sessions; history keeps the original actor (Q64, FR-ORG-011).
8. Access reviews: privileged grants quarterly, ordinary every six months, with documented retain, modify or revoke decisions (Q65).

## 5. Named approvers (owner to supply)

| Decision                                       | Role or person responsible | Name (not recorded here) | Date confirmed |
| ---------------------------------------------- | -------------------------- | ------------------------ | -------------- |
| First system administrator (bootstrap)         | —                          | —                        | —              |
| Approver 1 for high-risk grants                | —                          | —                        | —              |
| Approver 2 for high-risk grants                | —                          | —                        | —              |
| Who may classify or reclassify risk            | —                          | —                        | —              |
| Who reviews access (quarterly and six-monthly) | —                          | —                        | —              |

Do not record real names, contact details or identity numbers in this repository; keep the filled list in the owner's controlled records and reference it here.

## 6. Questions for the owner

1. Approve, change or reject each **P** cell; answer each **?** cell. Cells you leave unanswered stay denied.
2. Who may **verify** a farmer (`farmer.verify`): administrators, supervisors, or a separate verifier role? May the creator verify their own record?
3. May field officers **correct** farmer records, or only request a correction?
4. Should project managers be able to create enrollments, or only read them?
5. Are zone or CBO coordinators registered with accounts in Phase 1? If not, that column is dropped.
6. Which of `report.export` and `inventory.adjust` are authorized in the pilot, and for whom?
7. Do supervisors get any write on land beyond reading, or is review always by a separate role?

## 7. What happens after review

1. The owner returns the matrix with answers and the named approvers.
2. I record the approved cells as a provisional decision (not client-approved) and update ADR 0022's acceptance tests to cover exactly that matrix, including the denied cells.
3. The independent reviewer examines ADR 0022 and the matrix together (Gate G1). Only then does IAM administration code start (P1-03a), and still no grant is seeded to a real account until the owner and client approve it.

This draft does not grant access, does not approve offline enrollment, and does not decide any production use.
