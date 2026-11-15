# ADR-0011 — Scoped reported land identification

Status: provisional minimal backend contract. Legal tenure, farmer/land relationship types/cardinality, administrative boundary datasets, map hosting, land correction and offline GPS acceptance remain client/implementation decisions.

## Data boundary

A land identification is a reported record in a configured geography, with a client UUID, trusted creator/application source, server registration time and version 1. Label, WGS84 point, reported accuracy and reported area in hectares are optional. The API can create a record without GPS, label or area. Latitude/longitude bounds and numeric precision are technical storage constraints, not proof of survey quality.

PostGIS stores a two-dimensional SRID 4326 point. The database rejects invalid coordinate ranges, empty/non-point/wrong-SRID geometry, invalid accuracy and invalid reported area. Numeric area is reported to at most four decimal places; no area is inferred from a point. The same point can be reported by more than one record: coordinates are not assumed to be unique legal parcel identifiers, and no automatic merge occurs.

The configured geography controls authorization. This workflow does not verify point containment within a GN/village boundary; authoritative boundary datasets and a containment/review policy have not been supplied. Coordinates, accuracy and area remain reported identification data, not legal boundaries/title, verified acreage or payment-grade measurements.

No farmer association, ownership/tenancy, officer ownership or project enrollment is inferred. The strict input rejects those unsupported claims. Typed, configurable farmer/land relationships remain separate work; this initial domain is not a complete parcel/tenure schema.

## Authorization and transactions

The `land` schema has a dedicated restricted runtime group and a separate NOLOGIN `agri_land_function_owner`. That role owns database functions, not property rights. NestJS and native SQL require current `land.create` permission and active configured coverage, using the trusted application's registration source. Reading requires separate `land.read`; creating a record grants no read rights.

Signed session-derived actor context and FORCE RLS govern queries. The native function derives organization from configured geography, enforced with a compound FK. It writes the identification, actor-bound mutation MAC and actor/session audit atomically. Stable exact retries return the original acknowledgment only after current permissions are checked. Changed retries conflict; audit failure rolls back all three records. Runtime identities cannot insert/update rows directly, query private journals or assume the function-owner role. Startup rejects extra owner membership and direct journal privileges.

Add a ninth restricted LOGIN connection for `agri_land_runtime`; do not reuse the farmer or migration connection. Apply migration 14 before deploying the API. The migration runner now treats an untracked `land` schema as protected, just like the existing authentication/farmer domains.

## State-management alignment

This follows the [accepted data/state/cache ADR](../architecture/decisions/ADR-data-state-cache.md): PostgreSQL/PostGIS owns the domain and critical transactions, and the shared BFF/browser transport has strict typed projections. No Redis cache or competing client record store is introduced.

This step provides online API contracts only. The future online land UI must use TanStack Query with authorization-aware identities/invalidation. Durable field land/GPS drafts belong in Dexie after the minimum-data/device policy and recovery protocol are reviewed; current offline farmer drafts remain farmer-only. The decision to use Dexie does not itself approve additional sensitive offline fields.

## Verification and limits

Use the pinned official PostgreSQL 17/PostGIS 3.5 image for Compose and CI. Local verification used PostgreSQL 17.11/PostGIS 3.5.7. Tests cover source/scope permissions, separate create/read, hidden coordinates/IDs, zero/null values, exact/concurrent replay, changed payloads, missing actor context, direct-write/journal denial, organization/geometry constraints, audit rollback and revocation.

Land relationships, GPS capture/map UI, spatial search, corrections/version conflicts, offline storage/sync, client data-quality decisions and real-device/deployment acceptance are not completed by this backend foundation. The existing mutation-key rotation limitation also applies to land MACs; a tested retained-key rotation procedure remains production work.
