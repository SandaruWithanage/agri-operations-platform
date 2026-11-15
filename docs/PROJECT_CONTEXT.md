# Project context — Agricultural Operations Platform

Last confirmed from planning discussion: 14 November 2026. This is a working handoff for Codex, not a contract or approved production SRS.

## Repository and design

- GitHub: https://github.com/SandaruWithanage/agri-operations-platform
- Figma: https://www.figma.com/design/GJZ8HcRYzqy8EIpvQuP6Iu
- Repository existed with initial README/commit according to owner, but the ChatGPT GitHub connector returned 404/zero accessible repositories. Codex must verify its own access before editing.

## Mission

A Sri Lankan organization coordinates numerous farmers across Ginisiriya (Gliricidia biomass) and potential maize, coconut, equipment, and other projects. Office administrators manage centrally; field officers visit farms and register farmers/land while offline. Some zone/CBO coordinators have accounts; others exist as contact/organization records only. Farmers get their own interface later, in Phase 2. Interface must be accessible and support Sinhala and English.

## Confirmed decisions

- Single managing organization with multiple projects; external buyers, suppliers, banks, CBOs may still exist as counterparties.
- Phase 1 users: office admins and field officers, with optionally authenticated coordinators. Farmers are records, not login accounts at launch.
- Officers register farmers in person and must work without an internet connection.
- Dynamic organization hierarchy, project catalog, scoped roles, and configurable assignments. Never hardcode number of zones, GN areas, CBOs, project codes, or access scopes.
- Database-centered ABAC using PostgreSQL RLS plus permissions, relationship checks and role bindings. Use restrictive runtime DB role, explicit actor transaction context, scoped compound permissions, write policies and security tests.
- Initial GIS provides GPS markers, farmer and project identification, optional location-accuracy metadata, and reported area. No legal boundary verification, polygon surveying, or payment-grade automatic acreage measurement in Phase 1.
- Admin interface desktop-first; field-officer PWA/mobile-first with high-contrast forms and explicit offline state; restrained or no glassmorphism on field forms. Future farmer portal should be especially simple.
- English/Sinhala visible toggle; locale preference persistent; farmer-entered names and official documents are not automatically translated.

## Accepted data/state architecture

The project owner accepted [PostgreSQL/PostGIS, optional Redis, TanStack Query, Zustand and Dexie with separate responsibilities](architecture/decisions/ADR-data-state-cache.md) on 15 November 2026. Read that ADR before related choices. TanStack Query is integrated for admin audit-history reads; registry/detail and field integration remain unfinished. Zustand is selected but not yet integrated; Redis is optional and absent. This does not approve provisional business rules or establish production readiness. The [current roadmap](development/ROADMAP.md) and [implementation inventory](development/PHASE_1_STATUS.md) govern implementation timing and remaining work.

## Architectural direction (provisional)

- Monorepo: pnpm workspaces + Turborepo; apps `admin-web`, `field-pwa`, `api`.
- Frontend: Next.js, TypeScript, Tailwind and shared design system; NestJS API.
- Database: PostgreSQL + PostGIS, Prisma where appropriate, reviewed native SQL for RLS, functions, grants, complex transactions, and constraints. Pin verified stable versions; do not assume a draft schema has been executed.
- Offline: IndexedDB/Dexie for PWA, persistent outbox, client-generated UUIDs, idempotent server mutations, row version checks, conflicts requiring review, device registrations and secure local data handling.
- Other domains to support structurally: people/contacts, farmer registry, organizational units, geography, CBOs, projects/enrollments/cultivation cycles, parcels/plots/land relationships, assignments, agreement documents, planting-material distribution/inventory, plans/targets, reports, sync, audit.
- Avoid microservices and a generic arbitrary-SQL policy DSL. Use strong typed relational core and versioned optional custom forms.

## Identified real-world nuances

- A farmer can have multiple parcels and enrollments; land owner, tenant, cultivator, and manager may differ; cross-project cultivation can coexist where allowed.
- Organization hierarchy and administrative geography are separate. An officer may have scoped responsibility by direct farmer, project, zone, or CBO assignment. Define whether each scope is AND/OR; do not broaden combined scopes accidentally.
- Some coordinators may have no login. Model person separately from account and role binding.
- The provided Sinhala buyback agreement discusses project-specific contracts, inputs, loans, insurance, buyback and settlements; those are not universal requirements across projects.
- The 2026/27 Anuradhapura Ginisiriya plan has an unresolved farmer-count inconsistency: four category rows total 2,760 while printed grand total says 2,700. Treat as flagged source data; do not silently correct or promote to approved baseline.
- Planning target example of 200,000 kg/day from a power plant was illustrative and remains unconfirmed.

## Not yet confirmed — keep configurable / mark TBD

- Legal identity of managing organization and actual external parties.
- Land tenure/evidence requirements and whether multiple farmers share parcels.
- Precise authority of zone/GN/CBO coordinators; detailed ABAC permission matrix and officer-create rules.
- Harvest collection, quality testing, transport, procurement, financing and payment responsibilities.
- Agreement granularity (farmer/project/season), inventory accounting rules, approval workflows.
- Farmer count and field-officer device ownership, offline session lifetime, hosting and support model.

## Milestone progression

M0: inspect repo; establish monorepo, local PostgreSQL/PostGIS, dev scripts, NestJS health endpoint, bilingual UI shell, CI. Run lint, typecheck, tests, builds and open PR.
M1: implement foundation SQL/Prisma migrations, person/account model, restricted db roles, ABAC/RLS read and write policies, grants, assignment-scoped negative tests. Never blindly apply draft reference scripts.
M2: one end-to-end workflow: officer registration of farmer + land GPS offline; persist across restart; sync safely; prevent duplicates; validate active authorization; show record on admin screen.
M3: project enrollment, scoped officer assignment, resources, contracts, basic reports; refine client workflows.

## Test gates

- Officer A cannot query another officer's restricted farmer, parcel, or project through direct restricted DB role.
- No trusted actor context fails closed; owner/bypass roles are not used for API queries.
- Zone+project access cannot turn into Zone OR Project access.
- Sensitive IDs and contact fields have separate permissions.
- Offline retry is idempotent; conflicting updates aren't silently overwritten; revoked assignments are rechecked on sync.
- No unauthorized farmer GPS markers or counts leak via maps/reports.
- Device-local data survives normal app restart and can be synchronized when reconnected.

## Design handoff

Use the Figma as initial screen reference, not a complete tested component system. Current screens include admin overview, farmer registry, land GPS map, farmer 360 profile, enrollment, officer offline home, Sinhala registration/land capture/review/saved offline states and language toggles. Use accessible high-contrast solid surfaces; subtle frosted effects only on nonessential desktop overlays.
