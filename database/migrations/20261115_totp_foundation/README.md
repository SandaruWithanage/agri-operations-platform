# MFA factor storage and replay guard (provisional)

Apply transactionally after the authentication foundation and session-operations migrations in a disposable development database. Factor secrets are encrypted outside PostgreSQL with AES-256-GCM using a deployment-managed key; the database stores ciphertext, nonce, authentication tag and key identifier only. No encryption key is included here.

The NOLOGIN verifier role can call two restricted functions and cannot directly read or modify the factor table. The replay guard atomically locks a factor and account, checks active/enrolled state, bounds the TOTP time step and rejects reused counters. It **does not validate the OTP**: only a trusted authentication service that has already verified the password and TOTP may call it. No public endpoint or session issuance uses it yet. Enrollment, recovery, key rotation, privileged-role MFA policy, throttling and end-to-end authentication are still outstanding.

Lock order is factor then account. Coordinate this with future session and account-revocation workflows and handle deadlock retries. Apply ownership, roles and function grants in a single transaction. Use a reviewed forward fix or recovery procedure rather than dropping MFA data for routine rollback.
