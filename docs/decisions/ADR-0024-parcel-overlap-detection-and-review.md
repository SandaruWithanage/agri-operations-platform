# ADR 0024 — Parcel overlap detection and review (PROPOSED design, not implemented)

Status: **design proposal for owner and independent security review (Gate G1). No code, migration, permission or grant accompanies it.** It covers P1-13 (owner decision Q55; SRS v0.9 FR-LAND-015, FR-LAND-016, FR-LAND-019, UAT-11, risk R-GPS-04). The owner decisions are provisional, not client-approved. DEC-09 (overlap tolerance, area policy) and DEC-02 (reviewer roles) are unresolved, so every number below is a placeholder.

## Context

- Provisional polygons exist (`land.land_geometry_version`, one current provisional version per land, Polygon only, SRID 4326, geodesic area). Reads are scoped by row-level security: an officer sees only polygons in their assigned geography with `land.geometry.read` and `land.read`.
- Nothing detects or records overlaps. FR-LAND-015 requires overlap area and the affected parcel identities only inside the reviewer's authorized scope; FR-LAND-016 requires overlapping parcels to be savable provisionally while the conflicted portion cannot become verified or allocatable without a permitted resolution.
- These two requirements pull in opposite directions. Detection must see **every** polygon (a hidden neighbour still creates a double-counted quota), yet the capturing officer must not learn **who or where** the hidden neighbour is.

## Decision (proposed)

### 1. Detect globally, disclose by scope

Overlap detection runs inside a fixed `SECURITY DEFINER` function owned by a restricted `NOLOGIN` role, in the same transaction as `land.record_geometry`. The function may read all current provisional polygons **within the same organization** (never across organizations). It stores candidate pairs, but **no runtime role can read the pair table directly**; every read goes through scope-aware fixed functions. The recording call's response is identical whether or not an overlap exists, so a capturer cannot probe for neighbours by calling the record endpoint.

### 2. Data model (additive, append-only where history matters)

| Table                              | Purpose and constraints                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `land.geometry_overlap`            | One row per unordered pair of **current provisional geometry versions** (`version_a < version_b` by id, unique pair). Stores estimated `overlap_m2` (geodesic, `ST_CollectionExtract(…,3)` of the intersection), detection time and state `open` or `closed`. FORCE RLS with no runtime read policy. |
| `land.geometry_overlap_resolution` | Append-only, effective-dated decisions: outcome (`shared_parcel`, `boundary_adjusted`, `duplicate_of`, `disputed`, `dismissed_sliver`), mandatory reason, reviewing account, previous resolution reference, HMAC idempotency journal and atomic audit.                                               |
| `land.geometry_overlap_audit`      | Who detected, viewed in detail, resolved or reopened.                                                                                                                                                                                                                                                |

When either side gets a new version, the pair is closed and detection reruns for the new version, so a resolution never silently applies to a changed boundary. An advisory lock on the organization serializes detection, so two officers recording overlapping polygons at the same moment each see the other (tested), and pair uniqueness prevents duplicates.

### 3. What each actor can see

| Actor                                                             | Sees                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capturing officer**                                             | For their own polygon only: `overlap_state` of `none`, `pending_review` or `resolved`. No neighbour identity, location, area or count. (See owner question 1.)                                          |
| **Reviewer with scope over both parcels** (`land.overlap.review`) | Both parcels' identities, the estimated overlap area and the resolution history.                                                                                                                        |
| **Reviewer with scope over one parcel only**                      | Their own parcel and the estimated overlap area, with the other side shown as "outside your scope". Escalation goes to a reviewer whose scope covers both.                                              |
| **Reviewer with `land.overlap.resolve`**                          | May resolve only pairs where their scope covers **both** sides, is not the account that captured either polygon (reviewer separation), and records a reason. Resolution is not a verification of title. |
| **Everyone else**                                                 | Nothing. Regional viewers cannot deduce another region's overlap totals through filters or aggregates (FR-LAND-019); aggregate endpoints return only totals over rows the caller could already read.    |

### 4. Area and quota

- An overlapping polygon is **saved provisionally**; nothing is rejected automatically (Q55).
- `conflicted_m2` for a polygon is the geodesic area of the **union** of its open (and `disputed`) overlap intersections, so three neighbours overlapping the same strip do not subtract it three times. A fixed function returns `allocatable_m2 = validated_area − conflicted_m2` for the caller's own polygon. No quota or report may use the raw polygon area while an overlap is open or disputed.
- A `shared_parcel` resolution records the legitimate co-cultivation case and apportions the overlap by an explicit, reviewed rule rather than counting it for both.
- The estimate is labelled provisional: spherical-excess or sliver noise below a tolerance (placeholder, to be set from DEC-09 and device trials) is closed automatically as `dismissed_sliver` and still audited.

### 5. Geometry handling and limits

Candidate search uses the GiST index on `boundary` (bounding-box prefilter) then exact `ST_Intersects`; only valid geometries are compared; intersections that return points, lines or collections are reduced with `ST_CollectionExtract(…,3)`; a per-detection cap (placeholder 200 candidates) bounds work, and exceeding it records a `needs_manual_review` state instead of silently truncating. Holes and multipart parcels are not stored today (alignment note GA-05); if added, detection fixtures must be extended first.

## Threats considered

| Threat                                                            | Control                                                                                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Probing neighbours by drawing a polygon and watching the response | Record response is identical with or without overlap; detail only through reviewer functions                           |
| Latency or error differences revealing a hidden neighbour         | Detection always runs; no overlap-dependent error path in the record call; side-channel residual risk noted for review |
| Officer infers a neighbour from the `pending_review` state        | Owner decision 1 below; the state reveals only that something overlaps, to the owner of the polygon                    |
| Reviewer sees parcels outside their scope                         | Pair functions redact the out-of-scope side; resolve requires scope over both                                          |
| Capturer clears their own overlap                                 | Reviewer separation enforced in the function, not the UI                                                               |
| Double counting through repeated or multi-way overlaps            | Union-based `conflicted_m2`; quota functions use `allocatable_m2` only                                                 |
| Stale resolution applied to a changed boundary                    | New version closes the pair; a resolution is bound to the exact version pair                                           |
| Concurrent captures missing each other                            | Organization advisory lock plus unique pair rows; two-session test                                                     |
| Aggregate or filter leaking another region's overlap totals       | Aggregates computed only over caller-readable rows                                                                     |
| Cross-organization detection                                      | Function restricts to the caller's organization                                                                        |
| Overlap marked fraud                                              | Language and states are neutral (`shared_parcel` is legitimate); no automatic penalty                                  |

## Required tests (before any acceptance)

Officer A/B with a hidden neighbour (A never learns B's identity, area or location; the record response is byte-identical with and without a neighbour), reviewer with one-sided and two-sided scope, reviewer separation, replay and changed payload, concurrency (two simultaneous overlapping recordings), union-based double counting with three neighbours, shared parcel apportionment, sliver dismissal, mixed-geometry intersection results (point, line, collection), version change closing a pair, cross-organization isolation, aggregate scope, revoked reviewer, and mutation checks on each denial.

## Open questions for the owner

1. **Officer-visible state.** Recommended default: the capturing officer sees only "pending review" on their own polygon, which confirms that something overlaps but nothing about it. The stricter alternative shows the officer nothing and routes the flag only to reviewers; it hides the existence of a neighbour from the officer but leaves them unaware that their submission needs action. Which is acceptable?
2. Which roles hold `land.overlap.review` and `land.overlap.resolve` (DEC-02), and is a second-person approval needed for `disputed` and `shared_parcel` outcomes?
3. Overlap tolerance and the sliver threshold (DEC-09), and how a `shared_parcel` apportions quota.
4. Should detection be limited to the same project or cycle, or the whole organization?

## Review status

Proposed. Not independently reviewed, not accepted and not implemented. Until the owner answers question 1 and the independent reviewer has assessed the disclosure model, no overlap migration or endpoint starts.
