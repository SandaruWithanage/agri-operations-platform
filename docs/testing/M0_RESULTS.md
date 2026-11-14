# M0 verification results

Verified 15 November 2026 (Asia/Colombo) in an isolated workspace from the supplied scaffold.

## Passed

- Node v24.22.1; pnpm 10.20.0; Docker Compose v2.40.3.
- Dependency installation and repeat `pnpm install --frozen-lockfile`.
- `pnpm check:structure`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`.
- `pnpm test`: 2 files, 2 tests passed. HTTP GET /health verifies liveness and explicit unimplemented readiness; language test verifies English/Sinhala switching, document language, persistence and remount recovery.
- `pnpm db:validate`: model-free Prisma schema is valid. First engine download failed; retry succeeded.
- `pnpm build`: all four build tasks pass (admin, field, API and schema validation). Prisma validation produces no artifacts, so Turbo reports a harmless missing-output warning.
- Docker Compose configuration validation.

## Incomplete verification and remaining work

- PostGIS image downloaded, but container creation failed with disk exhaustion under this environment's Docker storage driver. The task-downloaded image was removed to recover space. Database startup and PostGIS query remain unverified.
- CI workflow is configured for Node 22; local verification ran on Node 24. GitHub Actions has not run.
- PWA device installation/service worker lifecycle and offline fallback need browser/device verification. Offline domain storage and sync are intentionally absent.
- Sinhala copy needs fluent domain review.
- Initial GitHub access failed (connector 404; clone 403). After visibility changed to public, both access methods succeeded; the repository was empty, with no existing files or history to reconcile.
- The feature branch now contains the verified scaffold above an empty baseline commit prepared for main. Publishing the baseline requires approval because AGENTS.md prohibits direct pushes to main.

No authentication, RLS policies, domain database schema, farmer portal or real personal data were added.
