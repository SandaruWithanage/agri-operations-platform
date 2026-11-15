# Scoped online land directory

The admin application now includes **Farmers / Reported land** navigation. Sign in with the normal approved-device/MFA flow, then select Reported land. The initial page is still the farmer registry; no land request is made until land is selected. This is an online read workflow, not land capture or a legal survey system.

## Setup and permissions

Follow [land backend setup](LAND_IDENTIFICATION.md) and [pilot runtime provisioning](PILOT_AUTH_RUNTIME.md): apply migration 14, configure the ninth independently restricted land connection, enable the approved HTTPS/BFF runtime and grant current scoped `land.read` permissions through the controlled IAM process. There are no new migrations, automatic permission grants or new environment variables in this UI change. Farmer read/create and land create alone do not authorize reading land.

Navigation is available to authenticated users without frontend role assumptions. NestJS and FORCE RLS determine the returned records. An unauthorized/unknown detail has the same unavailable response. A list contains only current authorized rows, with no global or hidden totals. The existing live database tests exercise those boundaries; the screen does not infer access from creation or ownership.

## Behavior

- English/Sinhala switching applies to navigation, directory, metadata and failures; entered labels remain unchanged.
- Bounded UUID cursor pages show configured geography, nullable label and whether a GPS point was reported. Detail is fetched separately and shows the authorized record ID, reported latitude/longitude/accuracy/area and registration time. Missing fields differ from valid zero values.
- A visible notice states that points/areas do not establish ownership, boundaries or verified acreage. Coordinates are not sent to external map/tile providers or analytics. There is no external-map link, export or aggregate count.
- Typed, discriminated farmer/land adapters share the existing authentication shell. TanStack Query owns the records; the selected domain/cursor is component-local UI state. Domain/account/device/lifecycle/page keys separate reads. Switching records/domains, refreshing, hiding, logout, access failure and unmount cancel or clear previous work. Late responses cannot restore it.
- The typed land transport forwards cancellation alongside its request timeout. No records or coordinates are stored in localStorage, IndexedDB, a query persister or the public HTTP cache. Locale remains the only optional browser preference. A cached read is never an authorization grant.

After a protected view is hidden or a request fails, use Check session and refresh for a fresh read. Server-side revocation is enforced on the next request; no live authorization push channel is implemented. The directory's cursor/domain are in-memory selections and reset on page reload.

## Remaining land work

Capture/GPS acquisition, map/search, farmer/land relationships, correction/version conflict flows and offline land reconciliation remain separate tasks. The current minimal farmer-only Dexie policy is unchanged. No farmer association, ownership, project enrollment or survey verification is inferred. Real-device, Sinhala/native-speaker, accessibility and production operating acceptance remain incomplete.

See [ADR-0011](../decisions/ADR-0011-reported-land-identification.md), [the state architecture](../architecture/decisions/ADR-data-state-cache.md) and [protected query integration](PROTECTED_ONLINE_QUERIES.md).
