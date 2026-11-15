# ADR-0010 — Separately authorized farmer audit history

Status: provisional technical implementation. Client verification criteria, retention, identity/contact access, full lifecycle and the review/correction editor remain outstanding.

## Permission boundary

Ordinary `farmer.read`, registration and change permissions do not grant audit access. A current authenticated session requires `farmer.read` and `farmer.audit.read` in the record's current geography. The application does not automatically grant either permission, assign roles or make a registering officer an owner.

NestJS checks the current RLS-visible record and explicit audit permission. Native SQL repeats the checks under signed transaction context and FORCE RLS. Historical correction/verification snapshots require both read and audit permission in their original and resulting geographies. A revoked historical assignment hides that event; the response contains neither its values nor a hidden-event count. Current permissions are checked for every page.

A read-only auditor needs no correction or verification permission. PostgreSQL's `FOR SHARE` read lock also applies UPDATE visibility. The definer role therefore has an audit-only UPDATE visibility policy with `WITH CHECK(false)`: it permits the lock but cannot authorize a write. Existing change policies still require their action permissions. Tests explicitly deny direct UPDATE and change-function execution for an audit-only actor. Runtime accounts retain no direct audit/journal table privileges. Startup rejects accidental table or column access to those journals, as well as column-level signing-key grants.

The function locks the current farmer row while checking and reading history, preventing an intervening geography move from changing the current coverage boundary inside the transaction. Authorization functions retain their existing assignment/grant locks. The definer has a fixed `pg_catalog` search path and PUBLIC execution is revoked.

## Projection and pagination

The response includes event ID, action, timestamp and responsible account UUID. The UUID is an audit reference; account names/contact data and session IDs are not exposed. Changes additionally show reason, before/after name, configured geography label, status, revision and duplicate-risk flag. Labels come from current configured records; the stored geography UUID is the historical reference. Arbitrary JSON fields and other internal data are stripped at the BFF/browser boundaries.

Legacy registration audit events captured actor/time only. Their original field values are not reconstructed from current records. Those metadata-only events require current record read/audit permission. The view describes this limit and does not claim a complete historical baseline.

Pages use descending `(occurred_at, id)` keyset order, with bounded limits and no total/hidden counts. PostgreSQL timestamps preserve six fractional digits in the cursor rather than passing through JavaScript Date truncation. This prevents skipped or repeated events within one millisecond. The UI uses localized dates for display while retaining the complete cursor value.

## Browser behavior and remaining work

The bilingual history view appears only after a server-derived capability and an explicit user action. That capability is an affordance, not authorization. The endpoint remains authoritative if a caller bypasses the UI. Farmer data/history stays in memory; no browser farmer storage or service-worker cache is added. Failed requests, hiding, sign-out and record/account changes clear views; late responses cannot repopulate them.

Apply migration 13 before deploying the history API. It adds an index, restricted definer function and permission policies without changing historical events. Audit retention/redaction and privileged operator procedures still require reviewed operational decisions. This change does not introduce edit controls or establish production certification.
