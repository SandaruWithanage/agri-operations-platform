# ADR-0001: M0 technical foundation

Status: Proposed for review • 14 November 2026

- One private GitHub monorepo for admin-web, field-pwa, NestJS API and shared packages.
- PostgreSQL + PostGIS; database-enforced ABAC with RLS, native SQL migration and reviewed functions.
- Prisma 7 planned once migration and DB runtime trust boundary are specified.
- Farmer records are separate from optional login accounts.
- Management zones, CBOs, project catalogs and role scopes are data-driven.
- Offline-first field application planned using local storage and an idempotent sync protocol.
- Map is for GPS identification and monitoring, not legal boundary surveys or payment-grade area.
- Farmer portal belongs to Phase 2.
- No finance/procurement business logic before client workflow confirmation.
