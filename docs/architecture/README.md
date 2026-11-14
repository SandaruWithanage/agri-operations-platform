# Engineering structure

- `apps/admin-web`: online-first administrative interface, eventual ABAC-aware backend access.
- `apps/field-pwa`: field officer workflows; offline storage / sync not implemented in M0.
- `apps/api`: NestJS; health route only at this stage.
- `database`: future versioned SQL + Prisma integration; PostgreSQL is authoritative for integrity / RLS.
- `infrastructure`: local PostGIS Docker Compose.
- `docs/`: decisions, business unknowns, security checks, acceptance gates.

No production data paths exist in this scaffold. Do not confuse a passing health endpoint with database or authentication readiness.
