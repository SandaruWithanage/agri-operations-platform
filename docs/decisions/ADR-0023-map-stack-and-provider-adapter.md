# ADR 0023 — Map stack and replaceable provider adapter (PROPOSED design, not implemented)

Status: **design proposal for owner and independent security review (Gate G1). No dependency, code or configuration accompanies it.** It covers the map-stack decision that the staff Phase 1 guide requires before a provider is introduced (P1-10, owner decisions Q48, Q51–Q54). Those decisions are provisional owner choices, not client-approved. Tile licensing, official boundary sources and the area tolerance (DEC-09) are **unresolved**, so this ADR deliberately does not select a tile vendor or approve any tile service.

## Context (what exists today)

- PostGIS stores provisional land polygons (migration 25) and reported points. Authorized reads exist: single-land geometry and a bounded viewport endpoint (P1-09b/c, P1-10a). Visibility is decided by PostgreSQL row-level security; the BFF and client only re-validate.
- There is no map component, no basemap, no map library and no tile source in the repository.
- The client requires a replaceable basemap with licensed offline packages and no unauthorized caching of public or commercial tile services (owner decision Q51), foreground GPS capture with visible accuracy (Q52–Q54) and accessible non-drag alternatives.

## Decision (proposed)

### 1. Separate three things that are easy to conflate

| Layer                  | Source                                                                                                              | Authority                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Basemap**            | Replaceable provider (licensed tiles, licensed offline package, or a local synthetic style)                         | None. Decorative context only; carries no farmer or land data. |
| **Operational layers** | Only the authorized endpoints (`land/viewport`, `land/geometry`), rendered client-side as GeoJSON from the response | PostgreSQL RLS. The map never derives access from tiles.       |
| **Drawing/edit state** | Local draft, then the existing audited record endpoint                                                              | The server validates every ring; the client is a convenience.  |

**Farm data is never served as map tiles** (no vector-tile or raster server for land, polygons, counts or heatmaps). A tile endpoint is a second, cache-friendly path around row-level security and makes hidden-feature leakage through zoom levels, tile boundaries and aggregates hard to rule out. Operational layers are drawn only from authorized, bounded JSON responses.

### 2. Frontend library

Use an **open-source, WebGL-optional renderer** behind our own adapter, with **MapLibre GL JS** as the proposed default (BSD-licensed, no vendor token required, supports vector and raster styles and offline PMTiles through a protocol handler). The library is imported only by a client component loaded lazily on map routes, so non-map screens carry no map bundle. Selection is confirmed or replaced at the review of this ADR; the adapter (below) keeps the choice reversible.

### 3. Provider adapter contract

A small TypeScript interface in a package (for example `packages/map-adapter`), with no provider names in application code:

- `style(): MapStyleDescriptor` — style URL or inline style, attribution text, minimum and maximum zoom, and the **declared egress origins** (hosts the browser will contact).
- `capabilities` — `online`, `offlinePackage`, `maySaveForOffline` (**false unless the licence terms recorded for that provider explicitly allow it**).
- `attribution` — mandatory text rendered by the map UI whenever the style is shown.

Adapters shipped first: **(a) local synthetic** — a blank style with a coordinate graticule and no network egress, used for development, unit tests and CI; **(b) licensed provider** — added only after DEC-09 records the licence and permitted use. Configuration chooses the adapter by environment; absence of configuration selects (a), never a public tile server.

### 4. Privacy and egress

- Tile requests reveal the viewed area to whoever serves tiles. A third-party tile host must therefore **never** receive an account identifier, session token, farmer or land identifier, or any application parameter. Requests carry only the tile coordinates the library generates and no cookies (cross-origin, `credentials: omit`).
- The content-security policy for map routes lists only the adapter's declared origins in `connect-src` and `img-src`; nothing else is added dynamically. A provider with no declared origin cannot be enabled.
- Where the privacy review requires it, tiles are proxied through the deployment's own origin, so the browser never contacts the vendor directly. This is a deployment choice behind the same adapter.
- No analytics or error-reporting payload may include map centre, zoom or bounding box together with an identity.

### 5. Caching and offline

- **No browser or service-worker caching of third-party tiles** unless the adapter declares `maySaveForOffline` from a recorded licence. The service worker's runtime cache excludes tile origins by default; this is tested.
- Offline basemaps are **licensed offline packages** (for example PMTiles files) delivered through the existing offline vault flow, versioned and removable, with the licence and expiry recorded. Offline operational data (drafts, cached viewport results) lives in the encrypted Dexie store defined by the accepted data/state/cache ADR, scoped by account, and is cleared on logout like other offline data.
- Offline polygon editing and conflict review are a separate design that builds on ADR 0021's principles (server validates, never silent overwrite) and is **not** approved or implemented here.

### 6. Authorization and leakage rules the map UI must keep

- Features come only from authorized endpoints; the UI never requests a wider box to "pre-load" and never merges results across accounts.
- Pan, zoom and filter changes cancel the previous request (the client already passes an `AbortSignal`); a stale response that arrives after a newer one is discarded by request sequence number, so an old, wider result cannot replace a newer one.
- Counts, clusters and "N more" badges use only returned features and the server's `truncated` flag; nothing is computed from data the caller cannot see.
- On logout, session revocation or account switch the map clears its layers, drafts held only in memory and any viewport cache before another account can render.
- Polygons are labelled provisional identification, never a surveyed boundary or verified acreage; the UI never styles a provisional polygon as verified.

### 7. Accessibility and field use

- Every map action has a non-drag alternative: keyboard pan and zoom, add or move vertices by **typed coordinates** or step buttons, a vertex list with focusable rows, and a text summary of nearby features with their authorized labels.
- Targets meet the large-touch-target requirement; contrast is checked on basemap, polygon fill and selection states; Sinhala and English labels for all controls; offline, stale and accuracy states are shown in text, not colour alone.
- Walk-the-perimeter capture (P1-11) is a separate UX on top of this adapter: explicit start, foreground only, visible accuracy, pause and resume, jump and gap warnings. Browser background-location limits are disclosed, not worked around.

## Consequences and costs

- One new runtime dependency (the map library) in the web apps only, with a lazy boundary; expected bundle and memory impact must be measured on the approved sample devices before field release.
- A synthetic basemap means screenshots and tests never depend on a licensed vendor.
- Not serving tiles for farm data costs some rendering efficiency at very large feature counts; the bounded viewport limits make this acceptable for Phase 1.

## Alternatives considered

- **Server-rendered vector or raster tiles of farm data** — rejected for the reason in section 1 (second authorization path, aggregate and boundary leakage).
- **Embedding a commercial map SDK directly** — rejected as the default: licence terms, token handling and offline rights are unresolved and would leak into application code.
- **Leaflet or OpenLayers** — viable; not chosen as default because of weaker vector-style and offline-package support, but the adapter permits swapping.

## Threats considered

| Threat                                             | Control                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Hidden pins, polygons or counts via bbox or tiles  | No tile endpoint for farm data; viewport reads are RLS-scoped; counts only from returned rows          |
| Stale or wider response replacing a newer one      | Abort on pan/zoom plus request sequence guard                                                          |
| Vendor learns user identity or farm location       | Cross-origin requests omit credentials and carry no application parameters; optional same-origin proxy |
| Unlicensed caching of third-party tiles            | Service-worker exclusion by default; `maySaveForOffline` only from a recorded licence                  |
| Enabling an arbitrary tile host                    | Provider needs declared origins; CSP built from them; unset configuration selects the synthetic style  |
| Previous account's layers visible after switch     | Clear layers, drafts and viewport cache on logout/revocation/account change; tested                    |
| Provisional polygon read as a legal survey         | Mandatory "provisional" labelling and no verified styling                                              |
| Drag-only editing excludes users or fails in glare | Typed-coordinate and step-button alternatives required                                                 |

## Open questions for the owner and reviewers

1. DEC-09: which basemap sources and licences are acceptable, and may any tiles be saved offline?
2. Is a same-origin tile proxy required, or is direct vendor contact acceptable with the controls above?
3. Approved sample devices and dataset for measuring map performance and GPS accuracy.
4. Confirmation of MapLibre GL JS as the default renderer.

## Review status

Proposed. Not reviewed independently, not accepted, and not implemented. Acceptance, if given, is recorded by the owner and the independent reviewer in this file and in `docs/development/PROJECT_HANDOVER.md`; until then the map UI (P1-10c) does not start.
