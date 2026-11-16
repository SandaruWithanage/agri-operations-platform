# ADR 0019 — Provisional explicit farmer/project enrollment

Status: implemented engineering slice under **provisional** pilot rules. DEC-04 (eligibility, cycles, coexistence, withdrawal, approval and closure) is still open with the client; nothing here is an approved requirement.

## Decision

Add an explicit, versioned `operations.enrollment` record linking one farmer to one project (migration 22). Enrollment is a separate command; farmer registration, land capture and project creation never create one. Registering a farmer, holding a catalog grant or holding a coordinator position confers no enrollment right.

Provisional rules, each isolated in one function so the client can change them without re-architecting:

- A farmer may hold enrollments in several projects. At most one `enrolled` row exists per farmer and project (partial unique index). After withdrawal, a later enrollment is a **new row** (history is preserved, rows are never reopened).
- Creating an enrollment requires an **active** project (catalog flag used as a conservative guard, not as authorization) and a farmer that is **not inactive**. No verified-farmer prerequisite, cycle, effective-date or approval step is invented.
- Withdrawal is allowed regardless of project/farmer status, needs the original row version and moves only `enrolled → withdrawn`.
- Cycles/seasons are deliberately absent; a nullable cycle reference can be added later without rewriting rows.

## Authorization

Every action needs **both** (a) the PRJ-04A project scope predicate for the farmer's **current** geography and (b) current `farmer.read` visibility of that farmer. Action identifiers: `enrollment.read` (null source), `enrollment.create` and the new `enrollment.withdraw` (trusted administrator/field-officer source). Migration 22 extends the scope grant CHECK and predicate to accept `enrollment.withdraw`; no grant is seeded. Withdrawal also requires `enrollment.read`.

A new restricted NOLOGIN `agri_enrollment_owner` owns the fixed functions. It sees projects/geographies only through identity/lock policies and sees farmers only where `authz.allowed(geography,'farmer.read')` holds. It is never an API login (the tenth project runtime identity is reused; no eleventh connection). Runtime has `SELECT` on a narrow column list via FORCE RLS and no direct INSERT/UPDATE/DELETE. Writes happen only through `operations.enroll_farmer` and `operations.withdraw_enrollment`, which re-verify actor and scope after acquiring locks (mutation advisory lock, farmer/project pair lock, farmer `FOR SHARE`, enrollment `FOR UPDATE`).

## Integrity, idempotency, audit

Typed FKs: `(project_id, organization_id)` to the project, farmer to farmer; the scope predicate rejects a farmer whose geography belongs to another organization. A private mutation journal stores an HMAC of the canonical payload; an equal retry replays the original result after fresh reauthorization, a different payload under the same mutation ID conflicts. An enrollment audit row (actor, session, action, resulting version, mutation) is written atomically. Journal/audit/scope tables are unreachable by runtime.

## Deliberate limits

- DEC-04 unresolved; defaults above are provisional and labelled as such in docs and API errors.
- No UI, BFF, offline enrollment, cycles, bulk enrollment, role/scope administration, reports/exports/maps (enrollment is excluded from every aggregate until RPT-01).
- Reads call the scope predicate per row, which takes a short hierarchy lock; list queries are bounded (limit ≤ 100) and capacity is unmeasured (OPS-05).
- Lock order across farmer correction and enrollment is documented but only exercised by focused concurrency tests, not load tests.
- The M0 scaffold archive supplied by the owner is a historical reference only; it adds no enrollment requirement (its open decisions are superseded by the current register).

See [PROJECT_ENROLLMENT.md](../development/PROJECT_ENROLLMENT.md), [ADR 0018](ADR-0018-project-geography-scope-foundation.md) and the [handover](../development/PROJECT_HANDOVER.md).
