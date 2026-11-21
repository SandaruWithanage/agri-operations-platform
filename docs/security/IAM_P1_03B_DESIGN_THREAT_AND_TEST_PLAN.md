# IAM-01 P1-03b design, threat analysis and synthetic test plan

**Status: DESIGN ONLY, PROPOSED. Nothing here is implemented, activated or approved.** This extends [ADR 0022](../decisions/ADR-0022-dynamic-role-and-assignment-administration.md) (sections 3, 4, 8 and 11) with the detail the first write slices will need and with a test plan that can be run on a disposable stack with synthetic data. It is not independently reviewed, it does not satisfy Gate G1, and every value or class in it is provisional until the client permission matrix (DEC-02) exists.

## 1. Gating conditions (all must hold before any code for P1-03b2 or later)

1. The independent AppSec/PostgreSQL review of P1-03a ([review package](IAM_P1_03A_INDEPENDENT_REVIEW_PACKAGE.md)) is complete and its findings are resolved or accepted by the owner in writing. The review of the grant-audit plumbing (#131) is included or explicitly deferred.
2. DEC-02 owner decisions needed by the slice are answered: permission risk classes, number and independence of approvers, who may create roles, whether emergency elevation may skip dual approval (default: **no**), maximum temporary lifetime, bootstrap custody, MFA step-up scope.
3. The owner names the slice in writing and authorizes it. Opening a pull request is not authorization to merge, and CI success is not authorization.

**Stays inactive until then:** privileged role mutations, any `INSERT` privilege on `authz` tables for an IAM identity, materialized grants, access requests and approvals, and any change to an account's permissions. The current branches contain none of these: the P1-03a functions are read-only and the P1-03b1 plumbing has no writer.

## 2. Revised slicing (each separately gateable)

| Slice    | Adds                                                                                                                              | Writes authorization data? |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| P1-03b2  | Role and role-version creation (immutable versions), mutation journal, `iam.access_audit`. Touches only `iam` tables.             | **No**                     |
| P1-03b3  | Person link table, routine role binding, materialization into the four `authz` tables, delegation ceiling, verification function. | **Yes**                    |
| P1-03c   | Access requests, approval digests, dual approval for high risk, temporary grants, expiry.                                         | Yes                        |
| P1-03d/e | NestJS/BFF reads and writes, bilingual administrator screens.                                                                     | via the above              |

Splitting b2 from b3 puts the lowest-risk write path (catalog edits) behind its own review before any identity that can write authorization tables exists.

## 3. Design detail

- **One authority predicate.** Generalize `iam.can_read_roles` into `iam.holds(org, code)` (organization-wide, administrator source, active, windowed, signed actor re-checked after locks). Every administration function calls it, so there is one implementation to review. Codes are `role.read`, `role.create`, `role.update`, `permission.grant`, `user.role.assign`; each is data in the catalog and defaults to high risk when unclassified.
- **Mutation contract (ADR section 4).** Stable mutation UUID; HMAC of the canonical payload kept in a private journal (same id with a different payload is a conflict, same payload replays the stored result); `expected_version`; signed actor and scope re-validated **after** locks; audit and effect in one transaction; one generic denial message. The runtime identity gets `EXECUTE` only.
- **Person and account link (variation from the ADR text).** Use a link table `iam.account_person(account_id primary key, person_id, organization_id)` with the composite organization key, instead of a nullable column on `authn.account`. Several accounts may map to one person (needed so "distinct approvers" is checked on the person, ADR section 11 row 2) and `authn.account` is not altered. Needs owner agreement because it differs from the ADR.
- **Materialization (b3).** An active binding writes ordinary rows to `authz.permission_grant`, `authz.assignment`, `authz.project_permission_grant` and `authz.project_assignment` with `origin='role_binding'` and the binding id (columns exist from P1-03b1). Rows are never deleted; revoke or expiry sets `active=false` or `expires_at` on exactly the binding's rows. The IAM owner receives column-level `INSERT` only on those tables, and a trigger refuses any row written by that identity with `origin='direct'` or any update that touches a row whose origin is `direct`. This is the highest-risk privilege in the programme and the reason b3 is gated separately.
- **Delegation ceiling.** For every permission in the bound role version the grantor must hold, at the time of the call and after locks, an effective grant at an equal or wider scope: same organization (cross-organization is always refused), unit or geography coverage that contains the target (containment uses the same locked lineage evaluation as the existing predicates, organization boundary first, cycle detection fails closed), same or broader project, same registration source. A role version that adds a permission is evaluated as granting each added permission.
- **Verification function.** `iam.verify_materialization()` compares the expected rows for every active binding with the actual `origin='role_binding'` rows and returns extras and missing rows. It runs in tests, as a scheduled monitor query, and before releases.
- **Lock order** (to avoid deadlocks with hierarchy writers): organization, unit and geography lineage, then the per-account lock, then grant and assignment rows, then binding rows; never the reverse. The order is tested with a concurrent hierarchy writer.
- **Time.** All validity checks use the database clock (`clock_timestamp()`), never caller input.

## 4. Threat analysis (additions and refinements to ADR section 11; all design only)

| #   | Threat                                                                         | Proposed control                                                                                                                                      | Test ID       |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | Owner-role compromise widens through `INSERT` on authorization tables          | NOLOGIN owner, fixed functions only, column-level privileges, origin trigger, grant-change audit (#131), separate slice gate                          | T-14, T-15    |
| 2   | Audit or origin triggers disabled by an operator                               | Process control (custody, DEC-08); monitor query over `pg_trigger.tgenabled` for the four tables and the audit table; alert owner pending (OWNER-S5)  | T-16          |
| 3   | Binding and materialized rows drift apart                                      | One transaction under a per-account lock; `verify_materialization()` in tests, scheduled and pre-release                                              | T-12          |
| 4   | Deadlock or starvation between bindings and hierarchy writers                  | Fixed lock order; concurrent hierarchy-writer benchmark (measurement only; no threshold adopted before measurement)                                   | T-18          |
| 5   | Replay of a mutation or reuse of an approval                                   | HMAC journal; approvals bound to the payload digest, single use                                                                                       | T-08, T-09    |
| 6   | Silent widening by editing a role                                              | Immutable versions; a version move that adds permissions is a grant of each added permission                                                          | T-10          |
| 7   | Self-grant through a second account of the same person                         | Distinctness evaluated on the person; requester, approver and grantee comparisons by person                                                           | T-04          |
| 8   | Overflow: binding a role larger than the grantor's own authority               | Delegation ceiling evaluated after locks, including sibling, parent, child and cyclic hierarchies                                                     | T-05, T-06    |
| 9   | Enumeration of staff, roles or accounts                                        | Reads return nothing for both not-found and not-permitted; opaque ids and display names only                                                          | T-02          |
| 10  | Denial of service by very large roles or lists                                 | Bound permissions per version and page sizes (values provisional, from measurement); keyset pages                                                     | T-17          |
| 11  | Caller-controlled time, actor or source                                        | Database clock; actor only from the signed context; source from the route class, never from the browser                                               | T-03          |
| 12  | Emergency elevation used to bypass dual approval                               | Not authorized by default; any emergency path needs the owner's separate written authorization                                                        | (design gate) |
| 13  | Bootstrap abuse (first administrator)                                          | Single-use owner-only function, refuses to run when any binding exists, two-custodian procedure, audited, removed after use (owner decides procedure) | T-13          |
| 14  | Error text or timing reveals existence of accounts, organizations or privilege | One generic denial text; no distinguishing error codes for not-found versus not-permitted                                                             | T-02          |

## 5. Safe synthetic test plan

**Rules.** Disposable local stack only; synthetic identifiers and names only (no real farmer, staff, NIC, bank or credential data); no live infrastructure; no load or contention measurement without the owner's written authorization reference (SEC-AUDIT-01 S7); results are labelled local and synthetic, never production evidence. Each isolation or integrity test gets a mutation check that removes the guard and must fail the test.

| ID   | Case                                                                                                  | Expected result                                                      |
| ---- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| T-01 | Default deny: no actor, forged signature, spoofed actor, expired session, revoked device              | Every administration call refused with the generic error             |
| T-02 | Not-found, wrong organization and not-permitted are indistinguishable                                 | Identical result and error text                                      |
| T-03 | Caller supplies time, source or risk class                                                            | Ignored; database values used                                        |
| T-04 | Requester, approver or grantee is the same person through two accounts                                | Refused                                                              |
| T-05 | Grantor lacks one permission of the role, or holds it at a narrower scope                             | Refused, nothing written                                             |
| T-06 | Containment cases: sibling, parent, child, cross-organization, cyclic hierarchy                       | Only the contained case succeeds; cycles fail closed                 |
| T-07 | Routine bind succeeds and the existing predicates honour the materialized rows (Officer A/B matrix)   | Predicates unchanged; rows tagged with origin and binding id         |
| T-08 | Same mutation id, same payload                                                                        | Replays the stored result, no second effect                          |
| T-09 | Same mutation id, changed payload; stale `expected_version`                                           | Conflict; nothing written                                            |
| T-10 | Role edited after binding; version move that adds a permission                                        | Existing bindings unchanged; the move is treated as a grant          |
| T-11 | Revoke and expiry                                                                                     | Existing predicates deny immediately; rows kept, history queryable   |
| T-12 | Drift injected (manual row edit or deleted row)                                                       | `verify_materialization()` reports it                                |
| T-13 | Bootstrap function run twice, or with a binding present                                               | Second run refused; audit row written                                |
| T-14 | Runtime identity attempts a direct write to any `iam` or `authz` table                                | Denied (`42501`)                                                     |
| T-15 | IAM owner attempts to write `origin='direct'` or edit a direct row                                    | Refused by the trigger                                               |
| T-16 | Audit present for operator, migration and function-owner changes on all four tables; triggers enabled | Rows present; monitor query returns no disabled trigger              |
| T-17 | Oversized role version or page size                                                                   | Refused before any authority-dependent work                          |
| T-18 | Concurrent hierarchy writer during bind and revoke; authority re-checked after a lock wait            | No deadlock; a waiting call re-checks and is denied after revocation |
| T-19 | Failure after materialization starts (audit insert fails)                                             | Whole transaction rolls back                                         |
| T-20 | Legacy direct grants (`origin='direct'`)                                                              | Unchanged behaviour; audited                                         |

The P1-03a concurrency pattern (two real connections, `pg_stat_activity` proving the wait, backend ids read before any blocking statement) is the template for T-18.

## 6. Not done and not claimed

No P1-03b2 or later code exists. No threshold, approver count, risk class or lifetime is adopted. No measurement has been run. No independent review has occurred. Gate G1, DEC-02, hosting (OPS-04), incident ownership (OWNER-S5) and production security acceptance remain open. Issue #64 (login throttling and trusted client identity) is a **deployment blocker** tracked separately and is unaffected by this plan; PR #120 stays on hold.
