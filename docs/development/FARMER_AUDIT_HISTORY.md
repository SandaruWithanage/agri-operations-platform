# Farmer audit history

Follow [registry setup](FARMER_REGISTRY.md) and apply native migration 13 through the migration runner. Use synthetic data for development.

## Provision and use

Grant `farmer.read` and the separate `farmer.audit.read` permission through the controlled IAM process, with current active assignments where required. No new business permissions are automatically granted. Read-only auditors do not need `farmer.correct` or `farmer.verify`; those permissions alone do not grant audit access.

Open an authorized farmer detail in the admin application and select **Show record history**. English/Sinhala controls display registration, verification and correction events, responsible account references and authorized change snapshots. **Older events** pages backward; **Latest events** reloads the current first page. Read permission, audit permission, session and assignments are rechecked on each request. There is no global or hidden-event count. Registration events do not contain original field snapshots; the UI states that limit.

A correction/verification history event is visible only if the auditor currently has read and audit permission in the farmer's current geography and both snapshot geographies. A move does not expose previously restricted names/locations. A historical assignment/grant revocation hides affected events without disclosing their contents. A current read revocation denies the whole record.

## Protocol

`GET /api/pilot/farmers/history?id=<uuid>&limit=25` returns the trusted request account ID, farmer ID, authorized events and an optional cursor. `beforeTime` and `beforeId` must be supplied together. Limits are 1–100. No account ID, organization scope, role or arbitrary filtering is accepted from the client. The shared browser transport is `PilotClient.farmerHistory(id, cursor?)`.

Preserve the returned cursor timestamp exactly, including all six fractional digits. Do not convert it through JavaScript Date; use Date only for localized display. Events sort newest first by timestamp and UUID. No-store BFF responses strip internal session fields and unknown properties. Responsible actor UUIDs are exposed only to authorized auditors; account names and contact details are not queried by this workflow.

## Verification and limits

The disposable PostgreSQL/NestJS/BFF flow tests separate permissions, read-only auditing, direct native-function/table denial, denial of writes with audit-only privileges, microsecond/tied-timestamp pagination, hidden historical scopes, assignment/grant revocation and unknown/unavailable records. Component/transport tests cover both languages, changed actors, late responses, complete cursor values, sanitization and clearing on access failure/hiding. Chromium exercises history paging, language switching and audit-permission rejection cleanup in the production admin build using synthetic HTTP adapters; separate database tests prove authorization.

The history view adds no browser farmer persistence. Optional identity/contact fields, review/correction editing, full lifecycle/reassignment, retention/redaction, privileged administration, hosting and real-device/operational acceptance remain unfinished. See [ADR-0010](../decisions/ADR-0010-scoped-farmer-audit-history.md).
