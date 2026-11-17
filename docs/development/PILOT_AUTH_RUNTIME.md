# Pilot API and BFF runtime

Status: integration implemented and tested with synthetic data; production validation remains incomplete. The default runtime is disabled (`ENABLE_PILOT_AUTH=false`). Missing enabled configuration fails startup. Do not use a migration/owner/superuser connection in the API.

## Database setup

Use the tracked runner described in [database/README.md](../../database/README.md), with a reviewed migration identity on a clean disposable database. Its manifest applies these files in order:

1. `20261115_authn_foundation/up.sql`
2. `20261115_authn_foundation/session-reader-grants.sql`
3. `20261115_session_operations/up.sql`
4. `20261115_totp_foundation/up.sql`
5. `20261115_z_session_issuance/up.sql`
6. `20261115_zz_credential_lookup/up.sql`
7. `20261115_zzz_login_throttle/up.sql`
   (and later `20261117_login_throttle_split_limits/up.sql`, which replaces its single-limit function)
8. `20261115_zzzz_farmer_abac/up.sql`
9. `20261115_zzzzz_registration_reference/up.sql`
10. `20261115_zzzzzz_device_proof/up.sql`
11. `20261115_zzzzzzz_farmer_registry/up.sql`
12. `20261115_zzzzzzzz_farmer_review/up.sql`
13. `20261115_zzzzzzzzz_farmer_audit/up.sql`
14. `20261115_zzzzzzzzzz_land_identification/up.sql`
15. `20261115_zzzzzzzzzzz_verification_receipt/up.sql`
16. `20261115_zzzzzzzzzzzz_farmer_review_queue/up.sql`
17. `20261115_zzzzzzzzzzzzz_correction_geographies/up.sql`
18. `20261116_farmer_correction_receipt/up.sql`
19. `20261116_project_catalog/up.sql`
20. `20261116_project_lifecycle/up.sql`
21. `20261116_project_scope/up.sql`

The farmer migration installs pgcrypto in a restricted schema and expects a clean installation. Existing installations need a reviewed migration adaptation. The runner tracks checksums and serializes applications; upgrade/restore rehearsals and production ownership review are still outstanding.

Provision separate LOGIN identities inheriting exactly one of these groups: `agri_credential_reader`, `agri_mfa_verifier`, `agri_login_throttle`, `agri_session_issuer`, `agri_session_executor`, `agri_session_reader`, `agri_farmer_runtime`, `agri_device_verifier`, `agri_land_runtime`, `agri_project_runtime`. Use interactive password assignment or a secret manager; never put passwords in SQL files or shell history. Runtime startup rejects superusers, BYPASSRLS, cross-group membership, missing group access, signing-key access (including column grants), direct registration/change/audit-journal access, owner/provisioner membership (including `agri_land_function_owner`, `agri_project_function_owner` and `agri_project_scope_owner`) and legacy issuer execution. Scope permission/assignment tables also remain private, including column privileges; project runtime startup requires migration 21 predicate execution. The new scope owner is NOLOGIN, not an additional API connection. See [scope setup and limits](PROJECT_SCOPES.md). Production connection URLs require `sslmode=verify-full`. Restrict the API at the network boundary to the BFFs and terminate HTTPS with a trusted deployment configuration.

Provision the context signing key into `authz.context_key` through a privileged secret-provisioning process. It must match `PILOT_ACTOR_KEY`. No API role can read that table. Create accounts with genuine Argon2id hashes, encrypted/enrolled MFA factors, approved account-bound devices and scoped permissions using a controlled bootstrap process. A self-service bootstrap/admin UI is not implemented. Do not use the synthetic fixture hashes from tests.

## Secret/configuration mapping

`PILOT_DATABASE_URLS` is a JSON object keyed by the ten group names above, each pointing to its dedicated LOGIN URL. `PILOT_MFA_KEYS` maps factor key IDs to canonical base64 AES-256 keys. `PILOT_THROTTLE_KEY`, `PILOT_CSRF_KEY`, `PILOT_ACTOR_KEY` and `PILOT_DEVICE_CHALLENGE_KEY` are distinct canonical base64 32-byte keys. The JWT private key is RSA PKCS8 PEM with at least 2048 bits; issuer, audience and key ID are explicit. JWT lifetime is 300–600 seconds. Idle expiration cannot exceed absolute expiration. Deployment-managed keys, rotation and recovery must be implemented and tested before production.

Each Next.js app uses server-only `PILOT_API_ORIGIN`, `PILOT_PUBLIC_ORIGIN` and `PILOT_INTERNAL_KEY`. The public origin must be an exact HTTPS origin. The API origin must be HTTPS; development can use HTTP only for localhost. Internal credentials must never use `NEXT_PUBLIC_` variables. The BFF's source is fixed by the app: field officer for field-pwa, administrator for admin-web; the database still checks the explicit source grant.

## Request flow

Browser routes under `/api/pilot/` support POST `auth/device-challenge`, POST `auth/login`, GET `auth/csrf`, POST `auth/logout`, GET `registration/geographies`, GET `registration/context` and POST `farmers/register`. No browser route exposes access-token minting. The BFF checks origin and request size, sends its internal credential to NestJS, keeps JWTs server-side, and sets only the opaque Secure/HttpOnly/SameSite host cookie. State-changing authenticated calls require a session-bound CSRF header. Responses use no-store caching and sanitized errors.

NestJS exposes `/pilot/` only behind the internal BFF credential. Disabled runtime returns 503. Sign-in requires MFA, an approved account-bound device record and a signature from its enrolled browser key. Follow [device enrollment](DEVICE_ENROLLMENT.md) before login; a copied device UUID alone no longer works. Possession of a non-exportable browser-profile key is not hardware attestation or proof of OS/device security. Real-device security validation remains required. The throttle uses the API socket's client address, never an untrusted forwarding header; therefore BFF requests share a network bucket. Production per-client propagation needs a signed/trusted proxy design and rate-limit tuning. Internal endpoints must not be publicly reachable, and request-body/header logging must exclude passwords, OTPs, session cookies and internal credentials.

## Verification and remaining work

The integration suite creates separate synthetic PostgreSQL LOGIN roles and drives BFF requests through a live NestJS HTTP server to the database. It verifies login, cookie protection, CSRF, authorized geography, registration and JWT rejection after logout. The HTTP test uses loopback transport; production TLS/proxy behavior is not proven by that test.

Remaining: account/device/MFA enrollment screens, archive import and replacement-device recovery, account/device administration and revocation workflows, manual-database adoption tooling, MFA recovery/key rotation, sensitive optional fields, farmer review/correction, deployment/backup/restore/load/security testing, Sinhala/device acceptance and independent security review. Do not treat passing component and integration tests as production approval.

## Field browser workflow

Sign in on the configured HTTPS field origin with an enrolled device key, account password and authenticator code. Both languages are available before sign-in. Registrations now run through the [encrypted offline workspace](OFFLINE_WORKSPACE.md); the sign-in page does not mount a separate volatile registration form.

The authenticated registration context binds current account/device identity, the enrolled key fingerprint, authorized configured locations and a server-configured local drafting window. It is cached drafting configuration, never accepted as server authorization. All synchronization uses the HttpOnly session/BFF path and fresh NestJS plus database ABAC/RLS checks. `PILOT_OFFLINE_SECONDS` defaults provisionally to 3600 and can be configured from 60 to 86400 seconds.

The workspace saves only minimal encrypted data; browser passwords, OTPs, CSRF/JWT/session/refresh secrets are never persisted. IndexedDB separately retains the non-exportable device signing key for online authentication. See the offline guide for persistence/shell prerequisites, locking, retry/rejection semantics and unfinished recovery/device operating requirements.

## Login throttling and client attribution (SEC-04, issue #64)

Every login attempt, successful or not, counts against two PostgreSQL buckets keyed by HMACs (no plaintext identifiers): one per **account** and one per **client**. Limits are separate: the account bucket is small (provisional pilot value 5 attempts per 15 minutes, blocked for 15 minutes) to stop guessing against one account; the client bucket is a broad abuse limit (provisional 100 per 15 minutes). An exhausted bucket is not extended by further refused attempts.

The API never uses its own socket address (which is the BFF's) as the client. The BFF derives the client only from `X-Forwarded-For` and only when `PILOT_TRUSTED_PROXY_HOPS` is set to the number of trusted reverse proxies in front of it: the entry that many positions from the right is used, entries to its left (which the caller controls) are ignored, and an absent, short or malformed chain yields no attribution. The BFF forwards it in `X-Agri-Client` on the login call only, the API accepts it only on a request that carries the internal BFF key, validates it as an IP literal and otherwise uses one shared `unattributed` client. A browser-supplied `X-Agri-Client` is never forwarded.

Trade-offs the owner must approve before any real-data pilot: with `PILOT_TRUSTED_PROXY_HOPS=0` every login shares the `unattributed` client bucket, so a flood of bad attempts can still lock all logins for the block period once the broad limit is reached (acceptable for local development only); many officers behind one NAT share one address and one client bucket; the numbers above are placeholders pending measurement. Production must run behind the approved proxy chain with the matching hop count, and the edge (reverse proxy) should add its own request-rate limit. Rate limits do not replace MFA or device proof. The open choices are laid out for the owner in [LOGIN_THROTTLE_DECISION_BRIEF.md](../security/LOGIN_THROTTLE_DECISION_BRIEF.md).

## HTTP hardening of the API and the web apps

**API (`apps/api/src/security/http-hardening.ts`).** The default body parsers are disabled and only a JSON parser exists (strict mode, 256 KB by default; form, text and raw bodies are never parsed). `X-Powered-By` is removed and every response carries `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy: default-src 'none'`, `Cross-Origin-Resource-Policy` and `Cache-Control: no-store`. CORS is off in production unless `API_CORS_ORIGINS` lists exact `https://` origins (the BFF calls the API server-to-server and needs no CORS); development keeps the two localhost origins. Concurrent requests are capped (`API_MAX_IN_FLIGHT`, default 256): beyond it requests get 503 with `Retry-After` instead of queueing against the database pool, and the slot is released for completed, aborted and timed-out requests. Request, header and keep-alive timeouts (30 s, 15 s, 5 s) and a header-count limit bound slow connections. Invalid configuration fails at start-up rather than being ignored. The API still listens on the interface Node chooses; bind it to the private network and never publish it, since the internal key is the only application-level gate.

**Web apps (`apps/*/next.config.ts`).** Every route gets a same-origin Content-Security-Policy (no foreign scripts, frames, plugins, `<base>` or form targets, and `connect-src 'self'` so the only network destination is the BFF), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP and CORP `same-origin`, a Permissions-Policy that allows geolocation only for the app's own pages (both apps need it: the field survey screen and the admin land form's "Use current GPS location") and denies camera, microphone and similar, and HSTS in production. `X-Powered-By` is removed. **Known weakness:** Next.js inline bootstrap scripts and styles require `'unsafe-inline'`, so the CSP does not give nonce-level protection against injected script; moving to nonces needs dynamic rendering and conflicts with the statically cached offline shell, so it is a recorded follow-up. A future map provider must add its declared origins deliberately (ADR 0023).

**Not covered here:** TLS termination, connection and request-rate limits, request timeouts and IP reputation at the public edge; DDoS protection; a web application firewall; dependency scanning; and any load test. These reduce common automated abuse; they do not make the system immune to attack.

## Abuse controls at the BFF (request flooding and oversize input)

Each BFF instance applies these checks before it calls the API, after the allow-list and origin checks (so cross-site requests cannot spend a victim's budget):

- **Rate limits per minute (provisional, per instance):** unauthenticated routes (login, device challenge) 30 per attributed client address, or 300 shared when no client could be attributed (see the trusted-proxy rule above); authenticated routes 240 reads and 60 writes per session. The session key is a hash of the opaque cookie (never the raw secret); a missing or malformed cookie gets the anonymous budget, never a session budget. Refused requests get 429 with `Retry-After` and make no API call. The key table is bounded (10,000), so key rotation by a bot cannot exhaust memory; it can reset other callers' counters, so the edge limit remains necessary. The counters live in one instance's memory; several instances need edge or shared-store limits for a global budget.
- **Body size:** 16 KB per request, except `land/geometry` (160 KB, enough for the 5,000-vertex ring the server accepts; a 16 KB cap would have rejected larger surveys). A declared `Content-Length` over the cap, or malformed, is refused without reading. The body is read and capped before the BFF makes any API call, so oversize or malformed input costs nothing upstream.
- **URL length:** requests with a URL over 2,048 characters are refused (414).

These limits reduce abuse; they do not make the service attack-proof. The public edge (reverse proxy) must also provide TLS, connection and request-rate limits and request timeouts.

**The handler must be a process-wide singleton (issue #72).** The limiter lives inside the BFF handler, so the Next.js route files use `createLazyBffHandler`, which builds the handler once per server process on first use and reuses it. An earlier version built a handler inside the per-request function, which gave every request an empty limiter, so no budget ever accumulated even though unit tests that reused one handler passed. A missing or invalid configuration answers 503 and is not cached. Because the state is per process, a serverless runtime that starts a new process per request, or several instances behind a load balancer, do not share budgets: an approved edge or shared-store limit is required before real deployment.
