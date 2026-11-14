# Agricultural Operations Platform

Development foundation and provisional pilot registration. The repository contains tested hybrid authentication, PostgreSQL ABAC/RLS, server BFFs and an English/Sinhala online field registration screen. Authentication is disabled by default. Offline device integration, administration, remaining Phase 1 domains and production validation are unfinished. See [delivery status](docs/development/PHASE_1_STATUS.md) for the current inventory. Use synthetic data during development.

## Setup

Use Node.js 22+ and Corepack (pnpm 10.20.0), plus Docker Compose v2.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/admin-web/.env.example apps/admin-web/.env.local
cp apps/field-pwa/.env.example apps/field-pwa/.env.local
cp database/.env.example database/.env
pnpm db:up
pnpm dev
```

Choose a local-only database password and update `.env` and `database/.env` consistently. Never commit populated environment files. Nest starts with default port 4000; to override it, export API_PORT in the shell (Nest does not automatically load its example environment file; Turbo passes the API runtime variables only to the API dev task). Next.js loads its own `.env.local` files. Admin: http://localhost:3000; field: http://localhost:3001; liveness: http://localhost:4000/health.

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

See [architecture](docs/architecture/M0_FOUNDATION.md), [security gate](docs/security/ABAC_GATE.md), and [open decisions](docs/requirements/OPEN_DECISIONS.md). CI uses the frozen lockfile and runs structure, formatting, lint, types, tests and builds. Application build outputs and all populated environment files are ignored.

## Pilot runtime and native migrations

Follow [database operations](database/README.md) for `pnpm db:migrate:plan` and `pnpm db:migrate`. These commands require a separate migration identity and an exact expected database name through the process environment; they do not automatically load `.env`. The tracked runner refuses checksum drift and automatic adoption of a manually migrated database.

Follow [the pilot runtime guide](docs/development/PILOT_AUTH_RUNTIME.md) to provision restricted database connections, independent signing/encryption keys, accounts, MFA, approved devices and scoped grants. Set `ENABLE_PILOT_AUTH=true` only after completing that configuration. Missing configuration fails closed. Use HTTPS origins for the field/admin BFFs and secure session cookies. Do not put server keys into `NEXT_PUBLIC_` variables. The unconfigured local shell remains usable for layout/language development; sign-in returns service unavailable until the runtime is configured.

The field screen prepares public device enrollment requests and signs login challenges using its non-exportable browser key. Follow [device enrollment and revocation](docs/development/DEVICE_ENROLLMENT.md) for independent administrator approval; a device UUID alone cannot sign in. The device-proof migration revokes existing sessions and requires an eighth runtime connection plus a separate challenge-signing key.

The field screen supports online sign-in, authorized geography selection and minimal farmer registration with same-account/idempotent retries. It currently preserves entries only in the open page. The encrypted Dexie primitive is tested separately; device persistence, offline unlock/recovery and authenticated outbox synchronization are still being integrated. Do not use the online form as an offline pilot.

For the Chromium device-key/retry smoke check, follow [browser test setup](docs/development/DEVICE_ENROLLMENT.md#automated-browser-check), then run `pnpm test:browser` after building. CI also runs it.

For database integration tests, supply `DATABASE_TEST_URL` pointing only to a fresh isolated PostgreSQL 17 database named `agri_test`, then run `pnpm test`. The suite refuses an existing authentication schema and cleans up its synthetic fixtures/roles. Without that variable, database tests are skipped; CI supplies a disposable service. Never use a shared/production database for tests.
