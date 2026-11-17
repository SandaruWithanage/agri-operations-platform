# GitHub Copilot review guidance: Agricultural Operations Platform

Read `AGENTS.md`, `docs/development/PROJECT_HANDOVER.md`, and `docs/architecture/decisions/ADR-data-state-cache.md` before reviewing a pull request. They describe the current design and the distinction between proposed requirements, implemented behavior, and real-client acceptance.

## What to prioritize

Review the **actual changed diff** and directly relevant callers, tests, migrations and public interfaces. Focus on actionable correctness and security problems before style:

1. **Server authorization:** per-request verified actor and approved device; PostgreSQL roles, FORCE RLS, geography/project scope, grants and authorization revocation; no owner/organization data crossing. Never substitute hidden UI controls for server access enforcement.
2. **Browser/BFF security:** cookie and JWT handling, CSRF, origin and proxy trust, rate limits that remain effective across requests and server instances, sensitive data in caches/logs, cross-account stale responses or reused React Query state. Confirm status and failure mappings fail closed.
3. **Database migrations:** immutable audit and idempotency journals, safe migrations with restrictive grants, transaction isolation, optimistic locking, rollback/recovery and uniqueness; note any direct-write or privilege escalation path.
4. **Offline recovery:** Dexie encrypted vault and passphrase/device key custody, sync queue durability, crash/reload/restart recovery, no lost unacknowledged submissions, same mutation ID + immutable payload on retries, cross-tab/account isolation, reauthorization on sync.
5. **Land/GIS:** bounded geometries and pagination; server-calculated geodesic areas, foreground GPS limits, invalid/self-intersecting polygons, ambiguous save outcomes and false claims of legal boundaries, ownership or verified acreage.
6. **Field and admin UX:** semantic labels, accessibility, keyboard focus, English/Sinhala parity, mobile touch targets, useful loading/error states and role-aware navigation. An aesthetically nicer UI is never permission to remove hardening or clear unsynced drafts.

## Review output

- Report **only reproducible, evidence-supported** defects with affected file/line, why it fails, concrete trigger, severity and minimal regression test.
- Distinguish verified problems from speculative or already documented limitations. Look for existing related issues before suggesting a duplicate.
- Separate successful CI evidence from physical-device, independent security, client/legal or production acceptance. A green workflow is not production sign-off.
- Do not ask for production credentials, real farmer/NIC data, unrestricted logs or broad exception handling. Use synthetic test records.
- Respect historical ADR decisions and the two-phase scope: Phase 1 internal admin and field staff, Phase 2 farmer self-service. Do not silently widen permissions or implement unapproved offline project enrollment.
- Prefer small, noninterfering fixes. The author may be actively working with another coding agent; do not rewrite unrelated modules or auto-merge.
