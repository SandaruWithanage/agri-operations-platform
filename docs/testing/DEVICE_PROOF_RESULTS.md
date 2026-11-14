# Approved-device implementation verification

Verification uses synthetic data only. It does not establish production approval.

## Automated checks

- 124 unit/integration/UI tests pass with a dedicated PostgreSQL 17 `agri_test` service. Coverage includes signature/challenge binding, wrong/missing key, replay, expiry after an account-lock wait, single-use assertion concurrency, session/audit rollback, copied-ID/legacy-issuer denial, key revocation, database RLS denial, least-privilege operator enrollment/revocation, and the existing authentication/registration/outbox suite.
- Chromium 156 on Linux passes the HTTPS browser smoke: public enrollment download/fingerprint, non-exportable private key, persistence across a full browser-process restart, signed login, and stable registration retry after a lost response. HTTP adapters are synthetic in this browser check; the separate live NestJS/BFF/PostgreSQL integration verifies authoritative behavior. Temporary test TLS trust does not prove production TLS.
- Frozen-lockfile installation, ESLint, Prettier, workspace type checks, Prisma validation and both Next.js/NestJS production builds pass.
- GitHub Actions includes the existing checks plus installation of Playwright Chromium and `pnpm test:browser` after build.

## Disposable upgrade and database restore rehearsal

A separate PostgreSQL 17 container was initialized with the first nine tracked migrations and a synthetic active legacy session. Applying the appended device migration revoked that session and created exactly one revocation event. Rerunning the ten-file manifest changed neither the history count nor audit count. A separate restricted operator LOGIN enrolled a generated public key successfully.

A PostgreSQL 17 custom-format `pg_dump` was restored with `pg_restore --exit-on-error` to another empty database in that same disposable cluster, preserving owners and grants. Verification confirmed ten history entries, the legacy revocation and enrollment audit data, `agri_authn_function_owner` ownership and fixed `pg_catalog` search paths on the security-definer device functions, FORCE RLS on farmer records, and denial of legacy issuer execution. The restricted operator could retry the restored enrollment and revoke the device; key/device audit and revoked state persisted correctly. The container and synthetic dump were removed after verification.

This rehearsal reuses cluster-level roles; it is not a proof of restoring a new host, role credentials, deployment secret keys, off-site backups, WAL/PITR, retention, recovery objectives or actual production data. Those operating procedures and rehearsals remain release requirements. No shared database was migrated.

## Still outstanding

Durable field draft autosave/unlock/recovery and authenticated outbox synchronization remain unconnected. Account/MFA/device administration screens, remaining farmer review/land/project/resource workflows, deployment hardening, trusted-proxy throttling, privileged recovery/rotation procedures, Sinhala/mobile/OS-security acceptance and independent security review remain unfinished. See the [Phase 1 inventory](../development/PHASE_1_STATUS.md).
