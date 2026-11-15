# ADR-0012 — Bounded online staff verification and own receipts

Status: provisional implementation of [ADR-0009](ADR-0009-online-farmer-review.md), not client-approved verification criteria. Reviewer separation, evidence/duplicate disposition and audit retention remain decisions for the client. No identity, tenure, survey or project-eligibility certification is introduced.

## Bounded action

The admin detail view exposes verification only after the server's current `access.verify` hint. Pending Review plus an explicit checkbox acknowledging the displayed name/location and any duplicate warning is required in the UI. Hints are not authorization: NestJS and the native change function still recheck read/action permissions, coverage, session and version. No role names or officer ownership are inferred.

This step has no editable correction fields or free-text notes. Confirmation submits a fixed locale-independent audit reason: `Staff reviewed the displayed farmer name and configured geography.` This gives the existing required reason an explicit bounded meaning without inventing stronger evidence. Locale changes do not alter a retained retry. The reason is an implementation default for this action, not a universal client-approved review process.

TanStack Query owns online mutation status. A stable intent UUID, original version and exact payload are retained for an explicit retry after an uncertain response; automatic retries and optimistic status changes are disabled. A 409 requires a fresh read and explicit review. Success clears protected query/mutation state and loads the authoritative record. No browser query persister, record store, offline verification queue or new Dexie field is added.

## Outcome recovery

Pending/uncertain submissions install a before-unload warning and explain the recovery path. Hiding, navigating, logout or account/transport changes clear private state; a late acknowledgement cannot restore it. A sent request may still commit on the server after the view closes. This is an online action, not durable browser drafting.

Migration 15 adds a restricted indexed `farm.latest_own_verification(uuid)` function and no business grants. The authenticated receipt endpoint requires current `farmer.read` and `farmer.verify`, locks the current row while selecting, and returns only the actor's latest verification whose historical/result geography is currently permitted. Other actors, corrections and hidden scopes contribute no receipt or counts. Unknown and unavailable farmers share the ordinary read-unavailable response. Missing verification permission is denied.

The receipt contains only mutation UUID, result version and database time, bound to the requested farmer and current account. It does not expose session IDs, contact data, reason or before/after names. A receipt may predate later changes; it is not proof of the record's current status. After reopening an uncertain operation, users check their receipt and fresh record rather than assuming failure or automatically issuing another action. Database version/state guards prevent duplicate verification when an earlier in-flight request eventually commits.

## Limits

Correction drafting/editor recovery, lifecycle/reassignment, retention/redaction, configurable client verification criteria and production/device/native-speaker/accessibility acceptance remain unfinished. Existing server audit/idempotency and key-rotation limitations still apply. The field's encrypted minimal-data outbox remains unchanged. Follow [setup and checks](../development/FARMER_VERIFICATION.md).
