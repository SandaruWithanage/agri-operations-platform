# ADR-0006 — Approved browser device possession

Status: provisional implementation architecture; physical pilot-device acceptance remains outstanding. This implements the user's approved-device requirement without changing configurable farmer registration or authorization rules.

## Decision

A copied device UUID cannot authorize a new login. Each browser profile/origin generates a P-256 signing key using WebCrypto with a non-exportable private `CryptoKey` persisted in IndexedDB. Public enrollment requests contain the device UUID, HTTPS origin, public JWK and SHA-256 public-key fingerprint. A separate operator must verify the fingerprint with the physical device through the organization's approved independent channel and enroll it against the independently selected account and an already approved account-bound device record.

The server issues a stateless 120-second HMAC challenge bound to exact HTTPS origin, normalized login name and device UUID. The browser signs the challenge using ECDSA/SHA-256 with fixed 64-byte IEEE P1363 encoding. Only after checking password, server challenge, enrolled public key and signature does the authentication service record a single-use PostgreSQL assertion; MFA must also succeed. Session issuance consumes that assertion atomically with session creation and its audit event. Assertions expire within 30 seconds, including lock-wait time. These lifetimes are initial technical limits, not client-approved offline lifetime requirements.

New sessions require the restricted `issue_device_session` function. The legacy issuer is no longer executable by runtime identities. Existing sessions are revoked and audited when the migration is applied. Device keys are immutable; recovery/replacement requires a new device record and independent enrollment. Key revocation atomically revokes the associated device and records both key and device audit events; session use, JWT session validation and signed RLS actor checks all consult current device state.

## Trust boundaries and limits

Device verification and device provisioning use different restricted NOLOGIN groups and separate LOGIN identities. Provisioning credentials must never be present in API/Next.js processes. No public endpoint enrolls or approves its own device key. No password, OTP, session secret, refresh token or access JWT is stored in IndexedDB/localStorage. Logout retains the device key for subsequent online authentication; it grants no access without password, MFA and current account/device approval.

A non-exportable WebCrypto key proves possession of a browser-profile key. It is not hardware attestation, full-disk encryption, a local screen lock, resistance to a compromised browser/OS, or an offline unlock mechanism. Same-origin malicious JavaScript can invoke a signing key even when it cannot export it. HTTPS, deployment security headers, XSS controls, OS/device management, independent enrollment verification and real-device tests remain release requirements. Do not treat the possession protocol as proof that those controls have been demonstrated.

English/Sinhala field UI supports preparing the public request, showing its verification code and signing login challenges. Offline draft autosave/unlock/recovery and authorized synchronization are separate unfinished work. Browser key persistence is tested with WebCrypto/fake IndexedDB and with a real Chromium persistent-profile process restart over a local test HTTPS origin. The browser smoke uses synthetic HTTP adapters; separate tests exercise the real NestJS/BFF/PostgreSQL runtime. Pilot mobile-device, OS-security and browser acceptance still require the actual approved hardware/configuration.
