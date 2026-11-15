# Scoped farmer review queue

The admin farmer list now supports English/Sinhala status and verification-eligibility filters. This is an additional read view, not a role assignment, permanent officer ownership rule or automatic verification/enrollment workflow.

## Setup

Apply native migration **16** with the controlled migration identity. It adds the `(status,id)` read index and changes no farmer values, audit history, RLS policies or business grants. Rehearse/schedule index creation for the deployed data volume as with the existing index migrations. The queue uses existing columns and the same nine restricted runtime connections; no new environment variable is required.

Use [registry provisioning](FARMER_REGISTRY.md) and explicit current `farmer.read` grants/assignments. The additional eligibility view requires current `farmer.verify` for each included row. Read/create/correct/audit permission alone does not grant verification. The [verification action](FARMER_VERIFICATION.md) independently rechecks authority, expected version and state when submitted.

## Workflow

- Registration status selects All, Draft, Pending Review, Verified or Inactive. Only records currently readable by the account are candidates.
- Only pending records I may verify further restricts the view to Pending Review and current verification coverage. Selecting it sets Pending Review; selecting another status clears it. An account without verification coverage gets an empty eligible queue, not broader read access.
- Changing filters resets the cursor to page one and clears/cancels the preceding request. Pagination retains the same filters. Revoked read/verification assignments are rechecked on each fresh request.
- A verified record leaves the pending queue on the next read. Use All statuses or Verified to reopen it and check an uncertain result's server receipt. Reopening never sends another mutation automatically.
- Duplicate warnings still consider all currently readable matching records, not only the selected status. No cross-scope duplicate data, hidden/global totals or automatic merging is added.

## Sharing and state

The URL uses only `farmerStatus=<state>` and optional `reviewable=true`. It never adds names, record IDs, actor scopes, credentials or cursor IDs. Eligibility-only links normalize to Pending Review. Selections replace the current history entry; bookmarks/reloads and Back/Forward to existing entries restore filters with a fresh read. Invalid, duplicate or contradictory shared selections load no records until explicitly reset or replaced.

Filters are component-local view state, not a business-record store in Zustand. TanStack Query keys include current account/device/lifecycle, domain, filters, page size and cursor. Late responses cannot restore an earlier filter/account view. Locale changes update labels without changing server-state identity. No query persister, Redis cache or Dexie format/data change is introduced.

## API and transport

`GET /api/pilot/farmers?status=pending-review&reviewable=true&limit=25&after=<uuid>` accepts the existing bounded cursor fields plus these optional filters. `reviewable=true` alone also implies Pending Review. Omit the flag to disable it; other values, unknown statuses, scopes and contradictory selections are rejected. The browser transport is `client.farmers(after, signal, filters)`.

NestJS applies parameterized status and eligibility predicates alongside explicit read checks; database `authz.allowed` and FORCE RLS supply current authority. No frontend filtering is used to mask an unrestricted response. Filtered responses include `filters` matching the request, in addition to the existing account/items/cursor projection. Unfiltered responses retain their previous shape for compatibility.

BFF/SDK boundaries reject missing/mismatched filter identity and rows contradicting the echoed status instead of displaying a silently unfiltered page. Responses remain no-store; no global/hidden totals are returned. A filter is never evidence of permission for a later operation.

Run the normal frozen install/format/lint/types/full tests/build/browser gates with a fresh disposable PostGIS test database. Tests cover all statuses, read-only eligibility denial, scoped cursor pages, revocation, malformed/contradictory filters, response binding, bookmarks/history, pagination reset and late-response cancellation. Correction drafting/editor recovery, remaining Phase 1 domains and production/native-speaker/accessibility/device acceptance remain unfinished.
