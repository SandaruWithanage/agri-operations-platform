# ADR-0002: M0 database tooling and offline shell

Status: provisional development decision, not a client requirement.

Use Prisma 6 CLI for schema validation only. No client is generated and no domain models or API database connection exist. Reassess the Prisma major version and adapter at M1 before persistence implementation. Native SQL currently enables only PostGIS in fresh local Docker volumes.

The field PWA caches only a static public offline fallback. Domain data storage, authenticated offline sessions and synchronization remain M2 work. Persist only the interface language in localStorage.

Remote repository inspection is blocked by GitHub permissions. The prepared foundation is an isolated local commit from the supplied archive, not a verified diff against main. Inspect main and reconcile all existing files before publishing it.
