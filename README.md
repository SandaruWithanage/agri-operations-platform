# Agricultural Operations Platform

Development foundation and provisional pilot registration. The repository contains tested hybrid authentication, PostgreSQL ABAC/RLS, server BFFs and an English/Sinhala encrypted offline registration workspace. Authentication is disabled by default. Complete device recovery/erasure, administration, remaining Phase 1 domains and production validation are unfinished. See [delivery status](docs/development/PHASE_1_STATUS.md) for the current inventory. Use synthetic data during development.

## Setup

Use Node.js 26.13.1 (`.node-version`), pnpm 12.21.0 and Docker Compose v2. Node 26 does not bundle Corepack; install pnpm explicitly. See the [stable-version policy and compatibility notes](docs/development/DEPENDENCY_POLICY.md).

```sh
npm install --global pnpm@12.21.0
pnpm install --frozen-lockfile
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/admin-web/.env.example apps/admin-web/.env.local
cp apps/field-pwa/.env.example apps/field-pwa/.env.local
cp database/.env.example database/.env
pnpm db:up
pnpm dev
```

Choose a local-only database password and update `.env` and `database/.env` consistently. Never commit populated environment files. Nest starts with default port 4000; to override it, export API_PORT in the shell (Nest does not automatically load its example environment file; Turbo passes the API runtime variables only to the API dev task). Next.js loads its own `.env.local` files. Admin: http://localhost:3000; field: http://localhost:3001; liveness: http://localhost:4000/health. Dependency readiness: http://localhost:4000/ready (503 when the pilot runtime is disabled); see [probe semantics](docs/development/API_READINESS.md).

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm db:validate
pnpm build
pnpm --filter @agri/admin-web start
pnpm --filter @agri/field-pwa start
pnpm --filter @agri/api start
pnpm db:down
```

Build requires DATABASE_URL (copy database/.env.example to database/.env or export a local URL). It validates Prisma configuration without connecting to a database. The PostGIS image initializes the extension on fresh Docker volumes; readiness checks both PostgreSQL and PostGIS. If an old volume was initialized without PostGIS, use a reviewed local migration or create a fresh disposable volume; verify with `docker compose --env-file .env -f infrastructure/compose.yaml exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT PostGIS_Version();"'`. `db:down` retains local data.

See [current architecture](docs/architecture/README.md), the [accepted data/state/cache ADR](docs/architecture/decisions/ADR-data-state-cache.md), the [roadmap](docs/development/ROADMAP.md), [security gate](docs/security/ABAC_GATE.md), and [open decisions](docs/requirements/OPEN_DECISIONS.md). CI uses the frozen lockfile and runs structure, formatting, lint, types, tests and builds. Application build outputs and all populated environment files are ignored.

## Pilot runtime and native migrations

Follow [database operations](database/README.md) for `pnpm db:migrate:plan` and `pnpm db:migrate`. These commands require a separate migration identity and an exact expected database name through the process environment; they do not automatically load `.env`. The tracked runner refuses checksum drift and automatic adoption of a manually migrated database.

Follow [the pilot runtime guide](docs/development/PILOT_AUTH_RUNTIME.md) to provision restricted database connections, independent signing/encryption keys, accounts, MFA, approved devices and scoped grants. Set `ENABLE_PILOT_AUTH=true` only after completing that configuration. Missing configuration fails closed. Use HTTPS origins for the field/admin BFFs and secure session cookies. Do not put server keys into `NEXT_PUBLIC_` variables. The unconfigured local shell remains usable for layout/language development; sign-in returns service unavailable until the runtime is configured.

The field screen prepares public device enrollment requests and signs login challenges using its non-exportable browser key. Follow [device enrollment and revocation](docs/development/DEVICE_ENROLLMENT.md) for independent administrator approval; a device UUID alone cannot sign in. The device-proof migration revokes existing sessions and requires an eighth runtime connection plus a separate challenge-signing key. Land identification adds a ninth, independently restricted `agri_land_runtime` connection.

Field registrations use the [encrypted offline workspace](docs/development/OFFLINE_WORKSPACE.md). It autosaves incomplete minimal drafts, survives a prepared-browser restart offline, and revalidates account/device/permissions during synchronization. Browser persistence approval, a prepared public shell and local unlock are required. Authenticated archives can restore all saved/incomplete versions into an empty same-account vault after normal approved-device sign-in. Legacy-only/lost-passphrase recovery, managed erasure and production/mobile/OS acceptance remain unfinished; do not treat passing Chromium checks as pilot approval.

Both applications use [shared English/Sinhala UI preferences](docs/development/SHARED_LOCALE.md), with the existing locale-only browser preference and no business records in Zustand.

The field home uses [cancellable session queries and per-registration Syncing presentation](docs/development/FIELD_SESSION_SYNC.md); encrypted pending submissions retain their stable IDs across interrupted sends and retries.

The [configurable project catalog](docs/development/PROJECT_CATALOG.md) supports bilingual list/detail and online creation with explicit organization-wide create/read grants, native audit and exact retries. Apply migration 19 and provision the tenth restricted runtime connection before deploying this version. Catalog creation does not enroll farmers or assign officers.

The admin app provides [online reported land capture](docs/development/ONLINE_LAND_CAPTURE.md) with optional explicit GPS, safe fixed-request retry and separate create/read authority. It also provides a [scoped farmer registry](docs/development/FARMER_REGISTRY.md). It lists only records permitted by explicit read grants and assignments; creation alone grants no read access. A separately authorized [audit history view](docs/development/FARMER_AUDIT_HISTORY.md) is available. A bounded [staff verification action](docs/development/FARMER_VERIFICATION.md) is now available with explicit confirmation, stable retry and server receipt recovery. A [scoped review queue](docs/development/FARMER_REVIEW_QUEUE.md) filters status and current verification eligibility with shareable view selections. A [minimal online administrator registration form](docs/development/ADMIN_FARMER_REGISTRATION.md) checks create coverage and retains fixed retries independently of farmer-read access. A [bounded online correction editor](docs/development/FARMER_CORRECTION_EDITOR.md) retains locked tab drafts, rechecks account/device/source access and retries immutable requests. Unsent correction values do not survive closing/reloading the tab; remaining Phase 1 domains and production acceptance are unfinished.

The [reported land identification API](docs/development/LAND_IDENTIFICATION.md) uses PostGIS with separate creation/read permissions. GPS, accuracy and reported hectares are optional. The admin [Reported land directory](docs/development/LAND_DIRECTORY.md) provides bilingual scoped list/detail viewing with no browser record persistence. Farmer relationships, capture/map UI and offline GPS are still under development; identification points are not legal surveys.

For the Chromium field/admin browser checks, follow [browser test setup](docs/development/DEVICE_ENROLLMENT.md#automated-browser-check), then run `pnpm test:browser` after building. CI also runs it.

For database integration tests, supply `DATABASE_TEST_URL` pointing only to a fresh isolated PostgreSQL 17/PostGIS 3.5 database named `agri_test`, then run `pnpm test`. The suite refuses an existing authentication schema and cleans up its synthetic fixtures/roles. Without that variable, database tests are skipped; CI supplies a disposable service. Never use a shared/production database for tests.
