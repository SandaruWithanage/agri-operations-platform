# ADR-0004: Provisional hybrid pilot authentication

Status: project-owner implementation decision, 15 November 2026. Client approval and security review are still required.

NestJS will own local authentication, using Argon2id for passwords and PostgreSQL-backed sessions. Browsers will receive opaque session identifiers in Secure, HttpOnly, SameSite cookies; Next.js will act as backend-for-frontend. The BFF will use signed, short-lived JWT access tokens for NestJS calls, initially configurable between five and ten minutes. Browser localStorage and IndexedDB must not contain session secrets, access tokens, or refresh tokens.

Implement CSRF protection for state-changing cookie requests, idle and absolute session expiry, server-side logout and revocation, privileged-account MFA, and account/device revocation history. Every protected API request must check current session, account, device and authorization state; JWT role or scope claims are not authoritative. Derive actor identity from trusted server-side state, never from client-provided account identifiers. PostgreSQL-enforced ABAC/RLS remains mandatory.

Approved officers may unlock restricted local data offline after online authentication, using a separate local unlock mechanism. Reauthenticate and reauthorize before synchronization; offline access never bypasses current server permissions. Support provider interfaces and possible OIDC migration later. No external identity provider is required for the pilot.

## Implementation status

A provisional native SQL migration creates an isolated authentication schema, accounts, devices, hashed-cookie sessions and revocation events without PUBLIC access. It has passed basic tests on a disposable PostgreSQL instance, with a separately provisioned, column-restricted session-reader role; it does not grant login credentials or enforce a complete revocation audit workflow. A standalone Argon2id password helper generates salted hashes and bounds verification work, but login, throttling, account recovery and MFA are not implemented. A standalone access-token verifier checks asymmetric signature, configured issuer and audience, subject, session ID, expiry, issued-at and bounded token lifetime. An unwired session-checking component supports an injected PostgreSQL session reader; integration tests use a restricted role and verify denied credential reads and current account/session/device revocation. A separate session-bound CSRF token helper checks exact allowed origins and HMACs, but is not wired into the BFF. These components are **not registered on a route** and They do not enforce sessions, revocation, devices, permissions, MFA or CSRF in any endpoint. Production authentication is not implemented. Key issuance, rotation, secure deployment, Argon2id enrollment, sessions and cookie/BFF integration remain open implementation work.

Before pilot usage, add automated tests for idle and absolute expiration, logout, revoked sessions and devices, MFA enforcement, CSRF, token signing/rotation and end-to-end offline resynchronization. Security review, session-store recovery, local unlock recovery, device encryption and device-deauthorization procedures remain required.

Protected operations must validate session state and authorization transactionally, or otherwise address revocation races between a session check and the protected database action.
