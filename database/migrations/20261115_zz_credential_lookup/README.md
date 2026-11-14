# Credential lookup foundation (provisional)

Apply transactionally after the previous authentication migrations in a disposable development database. The NOLOGIN credential-reader role may call only the lookup function; it cannot read or change the account table directly. The function returns a password hash to a trusted authentication service and must never be exposed to browsers. Credentials and login roles are not provisioned here.

Lookup alone does not provide safe login. The caller must rate-limit, perform a constant-work dummy password verification for missing accounts, return generic failures, require appropriate MFA, check account/device state again during issuance and protect all database connections. Account identifiers for session issuance must come from this trusted lookup, not from client input. Security review and runtime provisioning remain required.
