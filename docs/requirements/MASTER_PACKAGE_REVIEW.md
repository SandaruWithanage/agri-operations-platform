# Master package review and implementation sequence

The 14 November 2026 master project package is a working handoff, not an approved SRS. Its file checksums passed. The package contains potentially confidential source documents and photographs; they are not copied into this repository.

The working requirements confirm the M0 architecture and recommend M1 database identity and authorization, M2 offline farmer/land capture and secure sync, and M3 operational modules. Phase 2 farmer access, procurement, transport and finance remain deferred unless separately approved. The SQL in the package is a design reference, not an executable or production-reviewed migration.

## Current delivery

M0 provides application shells, a health endpoint, a language preference, local PostGIS, and CI. The current field app only displays a public offline fallback; it does not store or synchronize farmer records. No identity provider, runtime database connection, ABAC policies, or business data schema are implemented.

## Dependent decisions before pilot workflows

The project owner has since supplied provisional registration fields, scope and offline rules. See [ADR-0003](../decisions/ADR-0003-provisional-farmer-registration.md); client sign-off remains outstanding.

- Validate provisional core fields with the client and decide duplicate matching and disclosure thresholds.
- Validate the provisional officer-create authority and approve detailed coordinator, CBO, project and geographic permission matrices. Treat undefined access as denied; combined constraints must intersect.
- Specify approved-device enrollment, offline retention, lost-device response and key recovery; initially limit offline data to the provisional minimum.
- Confirm GPS accuracy and consent, land relationships, and pilot acceptance criteria.
- Confirm hosting, backup, retention, support and security review before real-data use.

The source plan has a printed total of 2,700 and category sum of 2,760; retain the discrepancy for client review. A buyback agreement is a project-specific example, not approval for a finance or procurement module.

## Next implementation gates

1. Review a small, versioned M1 database migration with least-privilege runtime role, trusted transaction-local actor context, deny-by-default read and write RLS, and adversarial tests on a disposable database.
2. Build an M2 vertical slice with approved field definitions, durable offline storage, idempotent sync, conflict detection and current authorization checks. Test revocation, retries, restart and device behavior.
3. Add approved M3 workflows and access-scoped reports iteratively, with audit trails and domain-specific acceptance tests.

These are proposed gates; no client approval or security review is implied by this document.
