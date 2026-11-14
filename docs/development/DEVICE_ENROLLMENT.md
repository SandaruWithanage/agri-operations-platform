# Approved device enrollment and revocation

The browser must prove possession of its registered key before a new session is issued. This implements a controlled operator workflow; there is no self-approval endpoint. See [ADR-0006](../decisions/ADR-0006-approved-device-possession.md) for the exact protocol and limits.

## Upgrade order

1. Back up and rehearse on a disposable/staging database. Review pending migrations with `pnpm db:migrate:plan`.
2. Apply `20261115_zzzzzz_device_proof/up.sql` through the tracked runner. **This revokes and audits all existing sessions.** It also removes runtime execution of the legacy session-issuance function. Do not promise uninterrupted login during this change.
3. Provision an eighth separate runtime LOGIN inheriting only `agri_device_verifier`. Add its connection URL to `PILOT_DATABASE_URLS`. Provision an independent base64 32-byte `PILOT_DEVICE_CHALLENGE_KEY`. Keep all runtime roles separate from `agri_authn_function_owner`, `agri_policy_owner` and the new `agri_device_provisioner`; startup rejects these memberships, privileged LOGIN flags and legacy-issuer execution privileges.
4. Give each authorized operator a separately controlled LOGIN inheriting only `agri_device_provisioner`. That group can enroll/revoke keys but cannot create accounts, approve a device, read password hashes, replace keys, alter key history or issue sessions. Account/MFA setup and initial approval of a device record still require the existing controlled bootstrap process; the app administration UI is unfinished.
5. Enroll approved browser profiles as below. Deploy the matching API/BFF/browser revision and validate login, revocation and current database permissions before opening the pilot. Missing keys/proof/configuration fail closed. Do not restore legacy issuer access as an upgrade workaround.

## Enroll a browser profile

Give the user an approved, account-bound device UUID through the organization's controlled process. On the configured HTTPS field origin, enter the device ID and choose **Download device enrollment request** (Sinhala labels are also available). The browser creates a non-exportable signing key and downloads only public enrollment data. Repeating preparation reuses the existing key. The screen shows a 64-character verification code independently of the downloaded file.

The operator must compare that code with the actual approved device through an independently verified channel, confirm the account/device association and exact HTTPS origin, and then run from the repository root:

```sh
pnpm device:enroll --account ACCOUNT_UUID --request /controlled/path/agri-device-enrollment.json --origin https://field.example.org --fingerprint INDEPENDENTLY_VERIFIED_SHA256_HEX
```

Supply `DEVICE_PROVISION_DATABASE_URL` and `DEVICE_PROVISION_DATABASE_NAME` through a protected operator environment/secret manager; the command does not load `.env`. Use the separate operator LOGIN above and verified TLS (`NODE_ENV=production`, URL `sslmode=verify-full`) in production. Never put credentials in the command, a request file or source control. The account and fingerprint arguments must come from the independent verification, not be blindly copied from an untrusted request. The example origin is a placeholder, not a deployment destination.

The command validates public-key shape/curve, exact origin and fingerprint, checks the already approved device belongs to the active target account, and inserts the immutable key with database audit records. Identical retries return `already-enrolled`; different keys are refused. It never approves a pending device, creates an account or overwrites an existing key. SQL/connection error details are suppressed from CLI output.

After approval, sign in using password, authenticator code and that device ID on the same browser profile/origin. The private key signs the server challenge automatically. Missing/cleared/corrupt key storage fails rather than silently generating a replacement during login. Downloaded public requests are not backups of the private key and cannot be imported to impersonate the device.

## Lost, compromised or retired device

```sh
pnpm device:revoke --account ACCOUNT_UUID --device DEVICE_UUID
```

Use the independently selected target account/device and the protected operator connection. Revocation is atomic and audited; repeat calls return `already-revoked`. All existing sessions on that device fail the current device-state checks at both API and database/RLS boundaries. Outstanding possession assertions also fail. This does not remotely erase a disconnected browser or discard unsynchronized drafts. Remote local-data handling/recovery is part of the unfinished offline workflow.

Never reactivate a revoked device or replace its immutable public key. Provision a new device record/key after the appropriate identity/device review. Account/MFA recovery and secure local recovery/deletion require separate operating procedures before production. Operator credentials are privileged; maintain named identities, access logs and organizational approval outside this CLI.

## Automated browser check

After dependency installation and `pnpm build`, install the test browser with `pnpm exec playwright install --with-deps chromium`, then run `pnpm test:browser`. CI runs these steps. An existing local Chromium can be selected with `BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:browser`.

The smoke test starts its own field production server on an ephemeral port, generates a temporary self-signed HTTPS certificate, and uses synthetic HTTP adapters for authentication and registration. It verifies public-only enrollment export/fingerprint, blocked private-key export, key persistence across two separate browser processes, signed login and identical retry after a simulated lost registration response. It cleans up its temporary profile/certificate and server. Certificate verification is disabled only in this synthetic browser test. This does not validate production TLS or real mobile devices; the separate API/database suite verifies current authorization, session issuance/revocation and transaction behavior.
