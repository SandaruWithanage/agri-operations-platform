# Database backup and restore rehearsal

On 21 November 2026, the disposable PostgreSQL 17.11 / PostGIS 3.5 fixture applied all 26 tracked migrations from `2f98c7b`. It used synthetic account, farmer, geography, project and permission records.

- Exported the database as a custom-format logical archive. Exported database roles separately with `--roles-only --no-role-passwords`.
- Restored into a second empty database in the same test cluster. Reapplying the full native manifest with the restored migration owner left the history and fixture unchanged.
- Restored roles and the database into a fresh PostgreSQL cluster using the same PostGIS binaries. The fresh cluster listened only on a private Unix socket. The bootstrap restore operator and original migration owner were separate identities.
- Compared migration IDs, checksums and original timestamps, representative business rows, permission-grant values, and the PostGIS version. Checked migration history ownership, FORCE RLS on farmers and enrollments, denial of direct runtime key reads and enrollment updates, and empty farmer/project results under restricted roles without a signed actor.
- Removed the synthetic databases, new test roles, temporary cluster and backup artifacts after verification.

## Repeat on isolated staging

1. Identify the exact source revision, image, database, backup operator, key custodian and target. Confirm that the target is empty, isolated, and has compatible PostgreSQL and PostGIS versions. Disable application traffic to the target while restoring. Start timing with agreed RTO and RPO targets.
2. Export cluster roles separately from the custom-format database archive. Exclude role passwords, protect both archives in approved encrypted storage and record checksums in the release evidence. A physical snapshot or point-in-time recovery requires its own tested procedure.
3. Restore approved role definitions first. Review the global role list and bootstrap role collisions before applying it. Reprovision runtime credentials through the secret manager. Restore the archive into the empty database with ownership and grants preserved and use `pg_restore --exit-on-error --single-transaction`. Provision separate secret material under the matching key IDs so restored data and outstanding replays can be verified.
4. Compare row counts and representative synthetic records, role memberships, function and history ownership, RLS flags and effective grants. Run the plan with the restored migration owner and confirm the expected history. Prove current signed access works, denied requests remain denied, and committed idempotent requests replay. Validate API startup, readiness and key compatibility before opening traffic.
5. Record elapsed time, cutoff, recovery findings, and a rollback or forward-fix decision. Keep staging connected only after the deployment owner has reviewed the evidence. Remove temporary plaintext artifacts under the approved retention policy.

The local rehearsal covered logical database and role restoration. Staging still needs backup encryption and custody, actual runtime LOGIN provisioning, JWT/MFA and context key restoration, signed access and replay, measured recovery objectives, and operating owner acceptance. See [database operations](../../database/README.md) and the [living handover](PROJECT_HANDOVER.md).
