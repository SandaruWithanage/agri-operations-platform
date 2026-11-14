# Agricultural Operations Platform — M0

Development foundation only; no real farmer data, authentication, ABAC, or business schema.

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

Choose a local-only database password and update `.env` and `database/.env` consistently. Never commit populated environment files. Nest starts with default port 4000; to override it, export API_PORT in the shell (Nest does not automatically load its example environment file). Next.js loads its own `.env.local` files. Admin: http://localhost:3000; field: http://localhost:3001; liveness: http://localhost:4000/health.

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

The provisional authentication schema and database integration test are documented in `database/migrations/20261115_authn_foundation/README.md`. No runtime database grants or authentication endpoints are enabled.
