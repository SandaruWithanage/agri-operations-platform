# ADR 0017 — Versioned project catalog editing

Status: implemented provisional technical workflow, supplementing ADR 0016. The catalog-enabled flag remains metadata; client-approved project lifecycle, enrollment and closure rules are separate decisions.

## Scope and authority

Online editing changes only project name and catalog-enabled flag. Organization, UUID, original creator and creation timestamp remain unchanged. An edit neither enrolls/withdraws farmers nor changes officer assignments, permissions, resources or cultivation cycles. There is no deletion or organization-transfer endpoint.

Current organization-wide `project.read` (null source) and separate `project.update` (trusted administrator source) are both required. Creation alone grants no update authority. The existing strict organization-wide grant shape applies: null geography/unit constraints and valid active/time windows. Assigned, geography/unit-limited, wrong-source and cross-organization grants fail closed. Project-specific/intersecting assignments remain future work, not an implicit widening of these catalog grants.

NestJS checks the readable target and update grant, then the fixed native function checks again under signed transaction actor context and FORCE RLS. The runtime cannot directly update rows or read private change/audit journals. The function owner receives only the columns needed for editing; organization/creator/time are not writable through it. Detail capabilities are hints derived from the trusted application source and current grants; they never replace server authorization.

## Versioning, replay and audit

Migration 20 adds a private typed change journal with actor, target organization, old/new metadata, original/outcome versions and a domain-separated payload MAC. A mutation lock serializes identical IDs; the target row lock serializes edits to the project. Permissions/session validity are rechecked after waiting. A fresh request must match the current version and change at least one value. Different requests against the same original version cannot silently overwrite each other. Integer version limits are explicit.

Exact retries reconcile against the original actor-bound journal and return the original outcome version, even if a later authorized edit has advanced the record. They still require current read/update authority. Changed retries conflict. PostgreSQL atomically updates metadata/version, inserts the journal and writes audit; audit failure rolls everything back. Existing creation records/audit timestamps are preserved, with creation audit version 1 and no change reference. New update audit rows reference the precise project/version/journal entry through a compound FK. Original creator/time are preserved.

The existing shared-context-key MAC rotation/retention limitation remains production work. This does not introduce a business-event worker outbox or an audit-history read grant.

## Online state and recovery

The bilingual admin editor uses the existing isolated TanStack Query mutation/reference boundary. The mounted draft captures a minimal original target, organization and reviewed version; refreshing parent/source props does not retarget an edit. Only name/flag are editable, and changed values require explicit review. One draft remains open across farmer, land and project operations. The original version and mutation ID are fixed at first submission; there is no optimistic update, automatic rebase, reconnect submission or offline edit queue.

Hiding, navigation, logout, inactivity, transport changes or denial removes form values from the DOM and clears fetched/mutation state, retaining only locked tab memory. Reopening checks original account/device, current target/organization and current editing capability. A moved organization prevents restoration of old values. A newer version does not rebase the retained intent; an uncertain submitted request may still reconcile, while a stale new edit conflicts on the server. Explicit local discard checks original identity, requires confirmation and cannot cancel a committed or running request.

Success reloads the authoritative project detail in the project domain. Tab/browser termination may lose unsent values and retry IDs despite the leave-page warning. Durable online recovery, project offline data, own-edit outcome discovery, audit retention/read administration and real-device/native-speaker/production acceptance remain unfinished. No browser token or business-record persistence is added.
