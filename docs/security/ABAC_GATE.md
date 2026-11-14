# ABAC and database security — implementation gate

**Status: not implemented.** Never allow real farmer data before this is validated.

- Use separate `schema_owner`, `migration` and `api_runtime` credentials.
- Runtime role must not be superuser or `BYPASSRLS`; use RLS with `FORCE` where appropriate.
- Every request's authenticated identity must be set in the same database transaction as protected queries.
- DB permissions / project-scoped & zone-scoped assignments are authoritative; UI hiding is not authorization.
- Deny by default; officer access to assigned farmers does not automatically imply access to NIC or other sensitive fields.
- New farmers must have carefully designed CREATE authorization even before their assignment exists.
- Offline replays must recheck current ABAC, idempotency keys and row versions.
- Include RLS SELECT / INSERT / UPDATE / DELETE and map / export / report test coverage.

**Do not connect Prisma or ordinary API routes to a privileged bootstrap connection.**
