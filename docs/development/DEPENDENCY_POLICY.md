# Latest stable dependency policy

The project owner requires latest stable releases. Review stable versions during maintenance, pin exact direct versions and commit the generated lockfile. Do not select alpha, beta, RC or development versions simply because a registry calls one `latest`. Preserve database and encrypted-draft formats, apply needed migrations deliberately and pass installation, peers, lint, formatting, typecheck, tests, builds and browser checks before merging. Dependabot schedules grouped weekly npm and GitHub Actions updates; it does not automatically merge them.

## Verified version selection — 16 November 2026

The current update selects stable Node 26.13.1 LTS, pnpm 12.21.0, NestJS 12.5.0/CLI 12.0.13, Next.js 16.4.6, React 19.3.1, TypeScript 7.0.2, Zod 4.6.7, Prisma 7.10.1, ESLint 10.15.0, Vitest 5.1.0, Vite 8.3.8, Playwright 1.65.1, Dexie 4.4.7, TanStack Query 5.107.1 and Zustand 5.1.0. Other direct packages are pinned to the stable versions verified in the same review. Prisma's `latest` registry tag points to 8.0.0-rc.33; stable 7.10.1 is selected instead.

Node's archive checksum was verified against its official release checksum list. The lockfile records npm package integrity. CI uses the selected Node/pnpm versions and current stable setup actions. Historical test reports describe the versions actually used then and are not rewritten to imply newer verification.

## Compiler and module compatibility

TypeScript 7 is the native project compiler, installed under the `typescript7` alias. Every workspace's `pnpm typecheck` uses `scripts/typecheck.mjs` to invoke that compiler. The validation package also emits its build using it. Turbo includes the wrapper, shared compiler settings, Node version and workspace settings in global cache dependencies.

Current stable `typescript-eslint` explicitly rejects the TypeScript 7 compiler API. Next.js and Nest CLI also consume the older JavaScript API. Stable TypeScript 6.0.3 remains installed as `typescript` solely for those tooling APIs; this follows the upstream side-by-side transition, not a project-compiler downgrade. `pnpm peers check` must remain clean. Use `pnpm typecheck`, rather than directly invoking the compatibility API's `tsc` shim. Remove this compatibility dependency when the latest tooling supports the TypeScript 7 API. Dependabot major updates for the canonical `typescript` dependency are held for that coordinated transition: its attempted 6-to-7 replacement fails the supported parser peer range. Review the `typescript7` compiler alias manually during stable-version maintenance; the bot currently normalizes alias tracking to the canonical package. This version-update rule does not suppress security audits or change the TypeScript 7 project checks.

The API uses NodeNext module resolution and an explicit source root. Shared validation is emitted as ESM, which Node 26 can load synchronously from the API's CommonJS output; browser bundlers still consume typed sources. Explicit `.ts` source imports are rewritten to `.js` during emission. Vite/Vitest use the modern Oxc transform with legacy Nest decorators and metadata enabled. Production browser checks exercise compiled API startup, not just transformed tests.

## Prisma and package installation

Prisma 7 reads its datasource URL from `database/prisma.config.ts`; `dotenv` retains documented local `database/.env` loading and the schema remains minimal. No native SQL history, domain schema, database role or migration key is changed. Validation still needs `DATABASE_URL` and does not connect to the database. Production migration deployment remains the native manifest runner's responsibility.

Prisma 7.10.1's preinstall script warns on Node 26 because its explicit support list ends at 24, despite its published engine range admitting newer versions. The warning is retained. Passing local/CI validation is compatibility evidence, not an upstream support guarantee; review future stable Prisma releases for an updated support list.

pnpm 12 explicitly permits install scripts only for the existing Prisma engine/CLI and esbuild packages. Strict peer checks remain enabled. The scoped minimatch override upgrades the TypeScript ESLint parser's dependency to stable 11.0.5 to address GHSA-g3hv-75wg-m249; review/remove it when the upstream parser selects a patched version directly. Lint and build checks exercise the resulting tooling.

## Security gates and remaining findings

CI checks all production advisory severities and high/critical findings across the complete dependency tree. Registry audits are dated advisory evidence, not a substitute for application security review. No advisory is hidden through an audit ignore list.

The full development tree currently retains the unpatched low-severity deepmerge finding GHSA-gcqx-w48m-w2h4 through Nest CLI's optional webpack checker peer. The application uses the TypeScript builder, and the dependency is excluded from the production audit. Track its upstream fix; do not describe the entire dependency tree as vulnerability-free or deploy development tooling as runtime dependencies.

PostgreSQL/PostGIS still use the existing pinned 17/3.5 image. A database major upgrade must include a backup/restore and role/RLS/migration rehearsal and a data-preserving volume transition. Do not replace the image against an existing data volume or delete that volume to satisfy the latest-version policy. Database/infrastructure modernization and real production acceptance remain separate work.
