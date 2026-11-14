# ADR-0005: Provisional farmer registration authorization

Status: implementation proof, 15 November 2026; client approval and production security review remain outstanding.

Use configurable organizations, units, geography, scoped permission grants and assignments. Each grant's geographic and organizational constraints intersect; separate valid grants may authorize a union. Organization-wide coverage must be explicit. Assigned coverage requires an active nonempty assignment. Creation source is constrained by the explicit grant. Creation does not confer ongoing read or update access.

The server derives account and session from verified authentication and binds them to the PostgreSQL transaction using a signed context. PostgreSQL verifies the signature, transaction binding, session/account/device state and scoped access independently. Runtime cannot read the signing key or become the NOLOGIN policy owner. Missing or forged context fails closed. Farmer row-level security is forced. Update/delete/review privileges are intentionally absent.

The registration function records a mutation MAC and audit atomically. Repeated authorized submissions with the same mutation and payload return the original ID; changed payloads conflict. A private exact-name/geography duplicate-risk record is retained for review without merging or revealing another farmer. API-side validation and authorization run in the same transaction as the protected function.

This is not a production registration workflow. Production role and key provisioning/rotation, sensitive optional fields, verification and correction policies, API/BFF wiring, durable client synchronization, device validation, operational recovery and independent security review remain required. The signing key must never be exposed to browsers. Hierarchy locking and per-geography registration serialization require performance testing before rollout.
