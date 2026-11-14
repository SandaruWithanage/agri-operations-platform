# ADR-0003: Provisional pilot farmer registration

Status: provisional implementation direction supplied by the project owner, 14 November 2026; not client-approved business requirements.

## Core contract

Require full name in Sinhala or English, a configured village or GN record, UUID, creator, registration source and time, and confirmation that the privacy notice was provided. Creator, source, timestamp and initial status must be assigned or verified by a trusted server, never taken from an untrusted registration payload. Phone, identity document, address, birth date, communication language, CBO, land, projects and documents are optional. Keep configurable field definitions separate from these core invariants. Statuses are draft, pending-review, verified and inactive. Duplicate detection flags possible matches, never merges automatically, and must not leak otherwise inaccessible information. Project enrollment and ongoing officer ownership are not implied by registration.

## Authorization decision

An administrator needs explicit permission. A field officer needs explicit create permission and an active assignment covering the geography or organization; creation does not confer permission to read or update existing farmers. A coordinator needs an account, active assignment and explicit permission. Organizational hierarchy and permissions remain data-driven. API authorization and PostgreSQL RLS must both enforce the rules, including denial on missing trusted actor context and scope intersection. Audit registration, verification, correction and reassignment.

## Offline direction

Only approved devices may collect necessary data. The initial offline dataset is limited to name, geography, client UUID and privacy-notice confirmation while device security is evaluated. Client-generated mutation UUIDs must be stable across retries. IndexedDB/Dexie storage requires authenticated access, inactivity locking, encryption and a device security policy. Device encryption, local key protection, loss recovery, deauthorization, and safe erasure need actual-device validation; browser deletion alone does not establish secure erasure. Never delete unsynced information without explicit recovery safeguards.

Sync must revalidate fields, current device status, assignments and permissions, detect duplicate risks, use server-side atomic idempotency keyed by mutation ID and payload hash, and expose conflicts and rejected records without silently overwriting. Cache only explicitly authorized records; do not store scans or unnecessary sensitive documents offline.

## Delivery status and remaining decisions

This branch provides shared input validation, candidate duplicate-risk signals, an isolated encrypted outbox prototype, and a provisional application-side permission evaluator tested against synthetic authorization scenarios. The evaluator is not wired to an endpoint and assumes all input is obtained from trusted database state; it cannot enforce database access. It is **not connected to the field app or a server**. The outbox is not a substitute for authentication, device encryption, device registration, RLS, signed/trusted sync responses, secure deletion or backup/recovery. Do not use it for real farmer data until those controls and device tests exist. The prototype uses a caller-supplied passphrase; key management, passphrase recovery, auto-lock policy, offline session lifetime and approved-device controls require security review and operational decisions.

To complete the workflow: select and integrate an identity/session provider, establish trusted database transaction context and runtime role, implement and adversarially test policies and migrations, add server-side idempotency and audit, implement field UI and reviewed translations, and run device/revocation/conflict recovery tests. Decide exact review and correction transitions, duplicate matching and disclosure rules, device-loss response, and who approves any configurable field. Client acceptance remains outstanding.
