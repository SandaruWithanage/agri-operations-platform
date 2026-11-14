# Authentication storage foundation (provisional)

`up.sql` creates an isolated account, device, session and revocation-event foundation. It is not integrated with the API and does not implement login, MFA, CSRF, audited mutation procedures, ABAC, or farmer RLS. No schema access is granted to PUBLIC. The optional `session-reader-grants.sql` provisions a NOLOGIN role with only the columns needed for session checks; it grants no password-hash or cookie-secret access and has no login credentials. Apply with a dedicated migration identity to a disposable development database only. Establish reviewed ownership, least-privilege grants and rollback/backup procedures before any shared deployment.

The cookie is an independently generated secret; only its SHA-256 digest belongs in the database. A session UUID is an internal identifier used for signed access-token/session correlation and is not a cookie credential. Session revocation and its event must be recorded together in one transaction by a future restricted service. The table alone does not enforce event immutability or revocation history completeness.

There is intentionally no destructive `down.sql`: do not drop identity or session data as a routine rollback. A forward fix or a separately reviewed, backed-up recovery plan is required. Use synthetic data in tests.

## Run integration tests

Start an isolated PostgreSQL 17 database named `agri_test` with a synthetic superuser, then run `DATABASE_TEST_URL=postgresql://USER:PASSWORD@localhost:PORT/agri_test pnpm test`. The test refuses to run if `authn` already exists. Most checks roll back; concurrency checks commit synthetic fixtures, then drop the schema and roles created by the test. These tests are skipped when `DATABASE_TEST_URL` is unset; GitHub Actions supplies a disposable PostgreSQL service. Do not point the variable at any shared or production database.
