# Reported land identification API

This is an online backend foundation, not the completed farmer/land workflow or a legal survey system. Use synthetic data and read [ADR-0011](../decisions/ADR-0011-reported-land-identification.md).

## Setup

1. Use PostgreSQL 17 with PostGIS 3.5 installed in `public`. The Compose and CI images are pinned to a verified digest. Managed providers must make that extension available; the migration does not relocate a differently installed extension.
2. Apply native migration 14 through the controlled migration runner. It creates the `land` schema, `agri_land_function_owner` and `agri_land_runtime`, typed identification/mutation/audit records, indexes and restricted functions/RLS. The owner is a technical database role; never assign it to application logins or business accounts.
3. Provision a ninth independent LOGIN inheriting only `agri_land_runtime`, and add its URL to `PILOT_DATABASE_URLS`. Follow [runtime provisioning](PILOT_AUTH_RUNTIME.md), including verified database TLS in production. Deploy the new API only after the migration and connection are ready. No permission grants are seeded automatically.
4. Through the controlled IAM process, grant scoped `land.create` with the appropriate registration source and active assignments. Grant `land.read` separately for existing record/location access. Farmer permissions do not grant land access, and creation does not grant read access.

## Online directory

The admin [Reported land directory](LAND_DIRECTORY.md) provides bilingual scoped list/detail reads. It shares the authenticated shell with the farmer registry and uses TanStack Query with cancellation and no persistent records. Capture/maps, relationships and offline land storage remain unfinished.

## Protocol

- `GET /api/pilot/land/geographies`: authorized configured creation choices, bound to the current account and trusted application source.
- `POST /api/pilot/land/register`: strict body with `mutationId`, `landId`, `geographyId`; optional `label`, `point` and `reportedAreaHectares`. Session/CSRF/source checks occur at the BFF and NestJS boundaries; native SQL rechecks current authority.
- `GET /api/pilot/land?limit=25&after=<uuid>`: bounded UUID keyset pages of currently readable records, with no global/hidden count.
- `GET /api/pilot/land/detail?id=<uuid>`: unavailable and nonexistent records share a 404. Only authorized point coordinates and reported metadata are returned.

```json
{
  "mutationId": "c8a85c92-740b-48d5-99d0-1cda6c4cd31c",
  "landId": "06149451-4004-4a23-a5a2-64a24e485a82",
  "geographyId": "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
  "label": "Synthetic reported land",
  "point": { "longitude": 80.25, "latitude": 8.3, "accuracyM": 12.75 },
  "reportedAreaHectares": 0.125
}
```

Point/label/area can be omitted or null. A point requires both longitude and latitude; accuracy is optional. Zero coordinates, zero reported accuracy and zero reported area are valid technical values. Organization, creator, time, source, farmer/owner/project IDs, polygons and survey verification are not accepted from callers. Values identify reported land only; the configured geography is not a claim that spatial containment was checked.

Use the shared `PilotClient.registerLand`, `land`, `landIdentification` and `landGeographies` transport methods. Preserve entity/mutation IDs across uncertain network results. The registration response acknowledges `status: synced`, ID and replay status; it does not confer read permission. Future Next.js views must use the accepted TanStack Query ownership/cancellation rules, not a second custom record cache or a Zustand business-data store.

## Offline and operational limits

This API does not add land data to Dexie or the public HTTP cache. The existing minimal farmer-only offline policy remains in force. Farmer/land links, configurable relationships, capture/map/search UI, land correction and offline GPS reconciliation are separate tasks. Reported coordinates/accuracy/area are not legal boundary/title evidence or verified acreage.

Run integration checks only against a fresh disposable `agri_test` database with PostGIS, then run the normal lint/format/typecheck/tests/build/browser checks. CI uses the same pinned official image. This workspace's rootless VFS storage required a locally flattened copy of that official root filesystem/runtime configuration to fit; the local fixture ran PostgreSQL 17.11/PostGIS 3.5.7. Production/CI image definitions remain the official pinned image. That storage workaround is not a production deployment instruction.
