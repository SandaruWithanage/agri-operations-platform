# M0 verification results

Verified 14 November 2026 (Asia/Colombo) in an isolated workspace from the supplied scaffold.

## Passed

- Node v24.22.1; pnpm 10.20.0; Docker Compose v2.40.3.
- Dependency installation and repeat `pnpm install --frozen-lockfile`.
- `pnpm check:structure`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`.
- `pnpm test`: 3 files, 5 tests passed. HTTP GET /health verifies liveness and explicit unimplemented readiness; language test verifies English/Sinhala switching, document language, persistence and remount recovery. The connection indicator test covers online/offline events. Service worker tests verify the public offline fallback and that API and cross-origin requests are not intercepted.
- `pnpm db:validate`: model-free Prisma schema is valid. First engine download failed; retry succeeded.
- `pnpm build`: all four build tasks pass (admin, field, API and schema validation). Prisma validation produces no artifacts, so Turbo reports a harmless missing-output warning.
- Docker Compose configuration validation and fresh-volume PostgreSQL 17/PostGIS 3.5 startup, including an actual PostGIS version query and a restart check.

## Incomplete verification and remaining work

- The original Debian-based PostGIS image exhausted this environment’s Docker storage. The Alpine image started successfully. A mounted bootstrap SQL file was inaccessible to the container’s PostgreSQL user, so Compose now uses the image’s built-in PostGIS initialization and checks extension readiness.
- CI workflow is configured for Node 22; local verification ran on Node 24. GitHub Actions has not run.
- PWA device installation/service worker lifecycle and offline fallback need browser/device verification. Offline domain storage and sync are intentionally absent.
- Sinhala copy needs fluent domain review.
- Initial GitHub access failed (connector 404; clone 403). After visibility changed to public, both access methods succeeded; the repository was empty, with no existing files or history to reconcile.
- The feature branch now contains the verified scaffold above an empty baseline commit prepared for main. The user approved publishing the empty baseline; GitHub write permission is still required.

No authentication, RLS policies, domain database schema, farmer portal or real personal data were added.
