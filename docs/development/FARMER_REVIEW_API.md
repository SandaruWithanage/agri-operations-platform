# Farmer review/correction API

This is a provisional online API foundation. Follow [registry setup](FARMER_REGISTRY.md), apply native migration 12, and use synthetic data. The [bounded online staff verification UI](FARMER_VERIFICATION.md) now requires migration 15; [audit history](FARMER_AUDIT_HISTORY.md) is also available. Correction editing remains unfinished.

`POST /api/pilot/farmers/change` accepts one of these strict bodies through the same-origin BFF. The BFF derives the session; callers must not supply actor IDs, source scopes, roles or resulting status.

```json
{
  "mutationId": "c8a85c92-740b-48d5-99d0-1cda6c4cd31c",
  "farmerId": "06149451-4004-4a23-a5a2-64a24e485a82",
  "expectedVersion": 1,
  "action": "verification",
  "reason": "Synthetic staff record review"
}
```

A `correction` body additionally requires `fullName` and configured `geographyId`. It cannot change the creator, original registration source, privacy notice, arbitrary status, optional identity/contact fields, land or project enrollment.

Use `PilotClient.changeFarmer(accountId, input)` from `@agri/sync-client`. The account argument prevents sending a retained edit under a changed cookie session; it is not server authorization. The transport obtains a fresh session-bound CSRF token. JWTs and opaque session secrets remain server-only. The result contains `farmerId`, incremented `version`, `replayed` and `duplicateRisk`.

Keep the complete original payload and mutation ID across an uncertain network result. Retry it exactly; do not mint another ID, alter a retained retry, or increment the expected version speculatively. A 409 requires a current authorized read and explicit conflict review. Current permission revocation can deny an otherwise identical retry. The API is not a complete correction editor or an offline change queue. The bounded verification UI provides exact retry and a server receipt lookup without editable correction fields.

Provision `farmer.read` and the separate `farmer.verify`/`farmer.correct` grants through the controlled IAM process, with active scoped assignments as required. Nothing in the migration automatically grants these permissions or assigns permanent officer ownership. A correction requires both original and destination coverage. Inactive records are not automatically activated; Verified corrections return to Pending Review. Read [ADR-0009](../decisions/ADR-0009-online-farmer-review.md) for the provisional interpretation of verification and outstanding client decisions.

The migration adds a nonunique normalized-name/geography index, a row version, restricted definer update policies, an application-only change journal and linked audit events. It changes no names, geography, creator or existing status. Audit before/after names and reasons are personal information: preserve them under the organization's eventual reviewed retention/access procedures; runtime accounts cannot query the journal directly.

The disposable PostgreSQL integration test covers missing read/action permissions, direct-function denial, denial of direct runtime UPDATE/journal access, original/destination coverage, exact replay, altered retry/stale version conflicts, duplicate-risk flags, correction/verification status behavior, complete rollback on audit failure, concurrent edits and current revocation. BFF/SDK tests cover CSRF, strict bodies, actor changes, stable retries and malformed acknowledgments. Run the standard full checks and Chromium suite before review.
