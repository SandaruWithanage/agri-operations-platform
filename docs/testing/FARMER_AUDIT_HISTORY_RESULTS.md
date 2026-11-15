# Farmer audit history verification — 15 November 2026

All fixtures are synthetic. This verifies the scoped read workflow, not client verification/retention policy or production certification.

- Frozen-lockfile installation, formatting, ESLint, workspace type checks and production builds passed.
- 167 unit/integration tests passed with disposable PostgreSQL 17. The migration test applies entry 13 after entry 12 with an existing farmer/registration event and verifies all original values remain unchanged.
- Live NestJS/BFF/PostgreSQL checks prove ordinary read/change permissions do not grant audit access; audit-only access works without correction/verification grants; native function and direct table access fail without permission; and audit-only row locking cannot authorize UPDATE or a change-function call.
- History pages preserve event order across identical timestamps and distinct microseconds inside one millisecond. Hidden historical scopes yield neither snapshot contents nor hidden-event counts/cursors. Adding/removing the historical assignment changes visibility on the next request. Revoking the current audit grant denies history, and revoking current read access makes the record unavailable.
- Startup tests reject accidental column-level signing-key access and direct audit/journal access on runtime LOGIN identities. Those identities retain only restricted function access to history.
- BFF/transport tests verify no-store sanitized output, strict paired cursors, scope/duplicate-parameter rejection, requested-farmer binding, malformed/repeated-event cursor rejection and preservation of complete timestamp strings.
- Component tests cover English/Sinhala, no farmer persistence, changed actors, late responses after selecting another record, clearing on access failure and parent-view hiding, and requesting history only after the server capability plus an explicit user action.
- Chromium passed field encrypted offline restart/recovery and the compiled admin list/detail/history/pagination journey, including language switching, audit-permission rejection cleanup and no admin farmer IndexedDB/localStorage storage. Browser adapters are synthetic; the separate live database flow verifies authoritative access.

The native function uses signed actor context, scoped permission checks and FORCE RLS, holds a read lock on the current record, has a fixed search path and no PUBLIC execution grant. The audit-only UPDATE visibility policy has `WITH CHECK(false)` and grants no write authority. The migration changes no historical events and adds no business permissions automatically.

Legacy registration events contain actor/time metadata only; original field snapshots are not reconstructed. Account UUIDs are audit references, and session identifiers/contact fields are not returned. Current configured geography labels are shown alongside stored historical geography IDs. Retention/redaction, a safe review/correction editor, lifecycle/reassignment, remaining Phase 1 domains and actual hosting/device/operational acceptance remain unfinished. See [ADR-0010](../decisions/ADR-0010-scoped-farmer-audit-history.md) and [setup](../development/FARMER_AUDIT_HISTORY.md).
