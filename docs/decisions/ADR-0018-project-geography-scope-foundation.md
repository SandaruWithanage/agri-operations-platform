# ADR 0018 — Project and geography scope prerequisite

Status: implemented engineering foundation under provisional pilot authorization rules; not a client-approved enrollment permission matrix. Enrollment records, eligibility and administration are not implemented by this decision.

## Decision

Keep existing organization-wide project catalog grants separate from future enrollment authorization. Migration 21 adds typed `authz.project_permission_grant` and `authz.project_assignment` rows. Both reference the same account, project and organization. Composite foreign keys reject project/geography/unit references from another organization. No organization, project, business role, assignment or grant is seeded.

The bounded predicate `authz.allowed_project_geography(project, geography, permission, source)` requires **an explicit permission AND a matching project assignment**. Both rows must be active and current. All non-null geography and organizational-unit restrictions within each row intersect; an organizational unit covers descendants through the configured hierarchy. Alternative complete grant/assignment pairs may authorize a target, but pieces of two nonmatching rows never combine. An assignment needs geography, unit or both; there is no implicit whole-organization fallback. This conservative prerequisite can be extended only with explicit policy and tests.

The first supported action identifiers are `enrollment.read` (null source) and `enrollment.create` (trusted administrator or field-officer application source). Action identifiers are technical contracts, not a hardcoded business-role list. Existing catalog/farmer/land grants and generic geographical assignments do not satisfy this predicate. An account or coordinator position alone grants nothing.

## Enforcement

The helper resolves a current signed transaction actor, locks project/geography identity, serializes hierarchy changes, and locks candidate grants and assignments in stable ID order. It checks the actor and both validity windows after obtaining all relevant locks. Missing, inactive, cross-organization, cyclic-hierarchy or unsupported action/source contexts fail closed.

A separate restricted NOLOGIN `agri_project_scope_owner` resolves project identity under FORCE RLS, without requiring unrelated catalog read/edit grants. A SELECT policy and UPDATE USING policy allow row locking; the UPDATE WITH CHECK is false, so actual project changes fail. Only the fixed security-definer predicate is callable by the existing project runtime. Private scope tables and owner membership remain forbidden to every API login. Enabled startup rejects missing predicate execution and accidental scope-table privileges. The ten runtime connections stay unchanged.

NestJS `ProjectScopePolicy` fixes the requested action through separate read/create methods, validates only project/geography target IDs, binds the server-verified actor, and checks scope before and after transaction-local database work. It has no HTTP endpoint and is not yet called by an enrollment workflow. Its callback must not perform external side effects or publish results before completion. Future enrollment native functions and record RLS must independently recheck the same predicate; the service wrapper alone cannot replace RLS or eligibility checks.

## Deliberate limits

- Project catalog flags are metadata. This predicate does not invent active-project eligibility, verification prerequisites, cycles or enrollment transitions.
- Farmer/direct-record scope intersections, role/binding administration, scope mutation audit/API/UI and offline enrollment synchronization remain pending. Do not treat the new tables as a production administration interface.
- Provisioning remains a reviewed privileged operation; never expose that identity in NestJS. No runtime writes to scope rows are granted.
- The conservative requirement for an explicit scoped assignment is provisional and does not settle the client matrix or administrator exceptions.
- Synthetic direct-RLS fixtures verify predicate behavior; they are not a deployed enrollment schema or production security review.

Update: [ADR 0019](ADR-0019-provisional-project-enrollment.md) adds `enrollment.withdraw` and the first provisional enrollment records.

See [implementation/setup](../development/PROJECT_SCOPES.md), the [living task register](../development/PROJECT_HANDOVER.md) and [remaining client decisions](../requirements/OPEN_DECISIONS.md).
