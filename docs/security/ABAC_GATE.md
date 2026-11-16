# ABAC and database security — implementation gate

**Status (16 Nov 2026): partially implemented; the real-data gate is NOT satisfied.** Never allow real farmer data before this is validated.

Delivered and tested with synthetic data (see the [handover](../development/PROJECT_HANDOVER.md) and `docs/testing/` results): separate owner/migration/runtime identities, FORCE RLS on core tables, signed per-transaction actor context that fails closed, scoped create/read/verify/correct with atomic audit, approved-device sessions, and Officer A/B isolation for enrollment. Still required before any real data: independent security review (ACC-01), device and recovery evidence (DEC-07, REC-03), configurable role/permission administration and recovery (IAM-01/02), key rotation (SEC-03), trusted-proxy hardening (SEC-04), production hosting/backup proof (OPS-03/04) and client/legal approvals. The checklist below remains the acceptance gate.

- Use separate `schema_owner`, `migration` and `api_runtime` credentials.
- Runtime role must not be superuser or `BYPASSRLS`; use RLS with `FORCE` where appropriate.
- Every request's authenticated identity must be set in the same database transaction as protected queries.
- DB permissions / project-scoped & zone-scoped assignments are authoritative; UI hiding is not authorization.
- Deny by default; officer access to assigned farmers does not automatically imply access to NIC or other sensitive fields.
- New farmers must have carefully designed CREATE authorization even before their assignment exists.
- Offline replays must recheck current ABAC, idempotency keys and row versions.
- Include RLS SELECT / INSERT / UPDATE / DELETE and map / export / report test coverage.

**Do not connect Prisma or ordinary API routes to a privileged bootstrap connection.**
