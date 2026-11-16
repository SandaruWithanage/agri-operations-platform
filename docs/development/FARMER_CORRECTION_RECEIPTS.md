# Own farmer correction receipts

Staff with current read and correction permission can explicitly check their latest visible correction from the farmer detail view in English or Sinhala. The optional server `access.correct` hint controls presentation only. Both NestJS and PostgreSQL independently recheck permission on every receipt request. The [bounded online correction editor](FARMER_CORRECTION_EDITOR.md) is separate from this receipt read; there is no offline correction queue.

`GET /pilot/farmers/correction-receipt?id=<farmer UUID>` returns authenticated account ID, requested farmer ID and a nullable receipt containing mutation UUID, resulting version and database timestamp. The same-origin BFF route is under `/api/pilot/`; `PilotClient.farmerCorrectionReceipt` validates/sanitizes the response and supports cancellation. Unknown or unreadable farmers return the ordinary read-unavailable response; missing correction permission is denied. Caller account/scope parameters and duplicate query parameters are rejected.

Migration 18 adds `farm.latest_own_correction(uuid)` and an action-specific actor/farmer/time index. The restricted runtime gets function execution, not journal-table access. It locks the current farmer while checking read/correct coverage and considers only this actor's correction entries with currently permitted previous and resulting geographies. Other actors and verification entries contribute no receipt or counts. Apply the migration before deploying the endpoint. No new role, connection URL or business grant is required.

Receipts omit names, reasons, session IDs and other journal fields. UI reads use account/authorization/record-bound TanStack Query keys with no persistence; authorization changes/unmount cancel reads and prevent late responses from populating a cleared view. Parent logout, hidden-view and denied-read cleanup still applies. Only an explicit click fetches a receipt. Locale changes do not create additional reads.

## Interpreting an uncertain submission

The receipt describes a past accepted action, not the current farmer state or evidence that no other changes exist. Refresh the farmer and inspect the resulting version before deciding on another change. No receipt can mean absent history or unavailable historical coverage, and an in-flight request could still commit. Do not treat a null receipt as proof of failure or automatically create a replacement mutation.

The existing change protocol remains versioned and idempotent: keep the same mutation ID and exact payload for a known retry, and never overwrite a version conflict. This receipt does not recover unsent drafts. The bounded tab-memory editor now preserves and locks unsent values and handles conflicts/retries; durable online crash recovery, native-speaker acceptance, retention and production key rotation remain separate work.
