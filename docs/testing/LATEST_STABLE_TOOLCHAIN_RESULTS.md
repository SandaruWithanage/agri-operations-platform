# Stable toolchain modernization verification

Verified on 16 November 2026 with Node 26.13.1 LTS, pnpm 12.21.0, TypeScript 7.0.2 project checks, the separately required TypeScript 6.0.3 tooling API and the stable application dependencies recorded in [the version policy](../development/DEPENDENCY_POLICY.md).

- Frozen installation, strict peer checks, repository structure, ESLint 10, Prettier, all workspace type checks and production builds passed.
- All 281 tests in 42 files passed under Vitest 5.1.0/Vite 8.3.8, including real NestJS 12/BFF/PostgreSQL ABAC/RLS, MFA/session/CSRF/revocation and device proofs, encrypted Dexie draft/restart/outbox/archive compatibility and protected admin query/mutation behavior.
- Three new validation tests preserve previously accepted PostgreSQL UUID forms in core/draft schemas, prove oversized invalid reference collections do not generate per-item issue floods and retain sanitized bounded correction replies under Zod 4.6.7.
- Both production browser workflows passed with Playwright 1.65.1/Chromium headless shell 1255. A final admin browser run additionally verifies that ESM validation errors retain the API's Zod error identity when loaded from compiled CommonJS, preserving invalid-input handling.
- Prisma 7.10.1 validates the unchanged minimal schema through `database/prisma.config.ts`; no connection, data reset, domain-model expansion or native SQL history change is performed by validation.
- Production dependency audit: zero known findings. Full dependency audit: zero critical/high/moderate findings, with one unpatched low development-only deepmerge advisory through Nest CLI's optional webpack checker peer. No audit-ignore list is used. CI now runs production/all-tree audit gates and peer checks.

Prisma's preinstall support-list warning on Node 26 remains visible and is documented; the published engine range admits newer Node versions, but local checks do not create an upstream support guarantee. PostgreSQL/PostGIS image major-version modernization is separate from npm changes and must preserve existing data volumes and rehearse migrations/restore. Client/native-speaker/device/security/production operating acceptance and the feature backlog remain incomplete.
