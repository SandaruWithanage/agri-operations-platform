# ADR-0002: M0 database tooling and offline shell

Status: provisional development decision, not a client requirement.

Use Prisma 6 CLI for schema validation only. No client is generated and no domain models or API database connection exist. Reassess the Prisma major version and adapter at M1 before persistence implementation. The PostGIS container initializes the extension on fresh local Docker volumes. A native SQL reference is retained for future reviewed migrations.

The field PWA caches only a static public offline fallback. Domain data storage, authenticated offline sessions and synchronization remain M2 work. Persist only the interface language in localStorage.

Initial GitHub access was blocked. After the repository became public, inspection confirmed that it contained no commits or branches. The prepared foundation was placed above an empty local baseline commit so the full M0 change can be reviewed in a pull request against main.
