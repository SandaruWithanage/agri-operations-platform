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
8. `20261115_zzzz_farmer_abac/up.sql`
9. `20261115_zzzzz_registration_reference/up.sql`
10. `20261115_zzzzzz_device_proof/up.sql`

The farmer migration installs pgcrypto in a restricted schema and expects a clean installation. Existing installations need a reviewed migration adaptation. The runner tracks checksums and serializes applications; upgrade/restore rehearsals and production ownership review are still outstanding.

Provision separate LOGIN identities inheriting exactly one of these groups: `agri_credential_reader`, `agri_mfa_verifier`, `agri_login_throttle`, `agri_session_issuer`, `agri_session_executor`, `agri_session_reader`, `agri_farmer_runtime`, `agri_device_verifier`. Use interactive password assignment or a secret manager; never put passwords in SQL files or shell history. Runtime startup rejects superusers, BYPASSRLS, cross-group membership, missing group access, signing-key table access, owner/provisioner membership and legacy issuer execution. Production connection URLs require `sslmode=verify-full`. Restrict the API at the network boundary to the BFFs and terminate HTTPS with a trusted deployment configuration.

Provision the context signing key into `authz.context_key` through a privileged secret-provisioning process. It must match `PILOT_ACTOR_KEY`. No API role can read that table. Create accounts with genuine Argon2id hashes, encrypted/enrolled MFA factors, approved account-bound devices and scoped permissions using a controlled bootstrap process. A self-service bootstrap/admin UI is not implemented. Do not use the synthetic fixture hashes from tests.

## Secret/configuration mapping

`PILOT_DATABASE_URLS` is a JSON object keyed by the eight group names above, each pointing to its dedicated LOGIN URL. `PILOT_MFA_KEYS` maps factor key IDs to canonical base64 AES-256 keys. `PILOT_THROTTLE_KEY`, `PILOT_CSRF_KEY`, `PILOT_ACTOR_KEY` and `PILOT_DEVICE_CHALLENGE_KEY` are distinct canonical base64 32-byte keys. The JWT private key is RSA PKCS8 PEM with at least 2048 bits; issuer, audience and key ID are explicit. JWT lifetime is 300–600 seconds. Idle expiration cannot exceed absolute expiration. Deployment-managed keys, rotation and recovery must be implemented and tested before production.

Each Next.js app uses server-only `PILOT_API_ORIGIN`, `PILOT_PUBLIC_ORIGIN` and `PILOT_INTERNAL_KEY`. The public origin must be an exact HTTPS origin. The API origin must be HTTPS; development can use HTTP only for localhost. Internal credentials must never use `NEXT_PUBLIC_` variables. The BFF's source is fixed by the app: field officer for field-pwa, administrator for admin-web; the database still checks the explicit source grant.

## Request flow

Browser routes under `/api/pilot/` support POST `auth/device-challenge`, POST `auth/login`, GET `auth/csrf`, POST `auth/logout`, GET `registration/geographies` and POST `farmers/register`. No browser route exposes access-token minting. The BFF checks origin and request size, sends its internal credential to NestJS, keeps JWTs server-side, and sets only the opaque Secure/HttpOnly/SameSite host cookie. State-changing authenticated calls require a session-bound CSRF header. Responses use no-store caching and sanitized errors.

NestJS exposes `/pilot/` only behind the internal BFF credential. Disabled runtime returns 503. Sign-in requires MFA, an approved account-bound device record and a signature from its enrolled browser key. Follow [device enrollment](DEVICE_ENROLLMENT.md) before login; a copied device UUID alone no longer works. Possession of a non-exportable browser-profile key is not hardware attestation or proof of OS/device security. Real-device security validation remains required. The throttle uses the API socket's client address, never an untrusted forwarding header; therefore BFF requests share a network bucket. Production per-client propagation needs a signed/trusted proxy design and rate-limit tuning. Internal endpoints must not be publicly reachable, and request-body/header logging must exclude passwords, OTPs, session cookies and internal credentials.

## Verification and remaining work

The integration suite creates separate synthetic PostgreSQL LOGIN roles and drives BFF requests through a live NestJS HTTP server to the database. It verifies login, cookie protection, CSRF, authorized geography, registration and JWT rejection after logout. The HTTP test uses loopback transport; production TLS/proxy behavior is not proven by that test.

Remaining: account/device/MFA enrollment screens, durable authenticated device sync (the field registration screen currently uses online requests only), account/device administration and revocation workflows, manual-database adoption tooling, MFA recovery/key rotation, sensitive optional fields, farmer review/correction, deployment/backup/restore/load/security testing, Sinhala/device acceptance and independent security review. Do not treat passing component and integration tests as production approval.

## Field browser workflow

Open the field application on its configured HTTPS origin. Sign in with an already provisioned account, password, six-digit authenticator code and approved device UUID. Both languages are available before sign-in. The server supplies only currently authorized geographical choices; an empty result disables registration. No production account, fixed organization structure or sample credentials are shipped.

The field page now submits the minimal farmer registration through the BFF. It generates farmer and mutation UUIDs once, obtains fresh server-validated session/CSRF context on every attempt, and requires the original account on retry. A failed or ambiguous submission keeps the form values and freezes editing until that same request succeeds. No browser storage contains passwords, OTPs, CSRF tokens, JWTs, session secrets or registration records. IndexedDB stores the non-exportable device signing key for subsequent online login. Successful responses clear the form only after the server confirms the submitted farmer UUID. A different signed-in account cannot submit the retained request. Signing out is disabled while entries or an uncertain request remain; the page installs a browser navigation warning, which is a best-effort safeguard and cannot prevent a browser/process crash.

This is explicitly an **online** screen. The encrypted Dexie outbox remains a separate tested primitive and is not mounted into this workflow. Reloading or closing the page can lose unsubmitted form entries or the IDs needed for an uncertain request. Keep it open until confirmation. Durable draft autosave, account/device partitioning, device unlock/recovery, interrupted-session restoration and authenticated background/manual sync are required before this screen can be used as the offline pilot. Do not infer secure offline support from the PWA manifest or connection indicator. Sinhala copy still requires native-speaker acceptance testing.
