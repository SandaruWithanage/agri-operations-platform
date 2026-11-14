# M0 architecture

Admin (port 3000) and field (3001) are independently deployable Next.js applications. API (4000) is NestJS. Only GET /health is exposed: it reports process liveness, not database or authentication readiness.

Shared packages: ui owns presentation primitives and application branding; design-tokens owns visual constants; domain-types owns transport-independent types; validation will own input contracts; i18n owns English/Sinhala copy; sync-client reserves the future offline boundary. No organizations, projects or roles are predefined.

The field manifest and production-only service worker provide a public offline fallback. They do not cache authenticated pages, API responses or farmer information. Dexie, queued writes, conflict handling and device testing remain future milestones. Installability varies by browser; verify icons and installation on target devices before rollout.

Prisma is configured without domain models. Native SQL initializes PostGIS on a fresh local volume. RLS, ABAC and authentication are intentionally absent; the API has no database connection. Docker's bootstrap account is privileged and must never become the runtime API account. See ../security/ABAC_GATE.md for future security requirements.

Future modules should own their services, validation contracts and persistence access. Cross-domain access must use explicit contracts, not shared mutable models. Sinhala copy requires review by a fluent domain user.
