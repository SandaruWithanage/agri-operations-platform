# Login throttle: owner decision brief (issue #64, SEC-04)

Status: **brief for owner decision. No code, migration or configuration changes here.** Every number below is a provisional placeholder, not a measurement and not client-approved. This brief records what must be decided before a real-data pilot and what to measure afterwards; it does not claim the login path is production-ready.

## What already exists (implemented, PR #66 and #68)

- Two PostgreSQL buckets per login attempt, keyed by HMACs (no plaintext identifiers): one per **account** (placeholder 5 per 15 minutes, blocked 15 minutes) and one per **client** (placeholder 100 per 15 minutes). An exhausted bucket is not extended by further refused attempts.
- Client identity only from `X-Forwarded-For` through `PILOT_TRUSTED_PROXY_HOPS` (the entry that many positions from the right); anything else is one shared `unattributed` client. The API never uses the BFF's own socket address.
- BFF request limits and body caps; API hardening. See [PILOT_AUTH_RUNTIME.md](../development/PILOT_AUTH_RUNTIME.md).

## Decisions needed

### D1. Proxy topology and hop count (blocks real-data use)

The client address is only as trustworthy as the chain that produced it. Choose the real chain and set the matching hop count:

| Option                                 | `PILOT_TRUSTED_PROXY_HOPS` | Consequence                                                                                                       |
| -------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| One reverse proxy you control in front | 1                          | Simplest. The proxy must overwrite, not append, any client-supplied `X-Forwarded-For`.                            |
| CDN or WAF plus your reverse proxy     | 2                          | Offers edge DDoS and bot filtering; each extra hop must be trusted and counted exactly.                           |
| No proxy (development only)            | 0                          | Every login shares the `unattributed` client bucket, so one flood can lock **all** logins once 100 attempts land. |

**Recommendation:** decide the hosting provider first (OPS-04), then set the count to the number of hops you control. A wrong count either ignores real clients (too high) or trusts a caller-controlled value (too low), so it needs a deployment test with a forged header. **Proposed safety step (needs your approval, small code change):** a production start that has the BFF origin configured but `PILOT_TRUSTED_PROXY_HOPS` unset should refuse to start, so the unsafe default cannot reach production by omission.

### D2. Account and client limits

- **Account limit (placeholder 5 per 15 minutes):** low on purpose against password guessing, but it also lets anyone who knows an officer's login name lock that officer out for 15 minutes with five bad tries. The trade-off is inherent; MFA and device proof still stand behind the password.
- **Client limit (placeholder 100 per 15 minutes):** many officers behind one office NAT share it. Illustration only (not data): 30 officers each failing twice is 60, under 100, but a morning log-in rush with weak connectivity and retries could approach it.
- **How to measure (after approval):** a repeatable test against a disposable stack using synthetic accounts: concurrent logins from one address, from several addresses, floods of random account names, recovery after the block, and the lock-out of a legitimate officer. Record observed behaviour and set the numbers from it. Until then, leave the placeholders and say so.

### D3. Should a successful login consume the account budget?

Today **every** attempt counts, successful or not. Consequence: an officer who legitimately signs in and out five times in 15 minutes (shared phone, repeated device checks) locks their own account.

| Option                                                          | Effect                                                                                                                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Keep (every attempt counts)                                  | Strictest against guessing; harms legitimate repeat sign-ins.                                                                                                                 |
| B. Only failures count, a success clears the account's failures | Removes the self-lockout; guessing is still limited to five failures per window per account. **Recommended**, but it changes security logic and needs a migration and review. |
| C. B plus a short progressive delay after repeated failures     | Slows guessing without a hard lock; more moving parts to test.                                                                                                                |

### D4. Edge request limit

A BFF limit protects one process (it is per instance, not shared). A limit at the reverse proxy or CDN protects every instance and stops floods before they reach Node. **Decision:** which component enforces it, and on which routes (login stricter than reads). Suggested starting point to confirm by measurement, not fact: login path in the order of single digits per minute per address with a small burst; ordinary API paths higher.

### D5. Recovery

A locked account waits out the block. **Decide** whether an administrator may clear it earlier (audited, never self-service) and how an officer is told to contact them. Whatever is chosen must not create an account-enumeration signal (for example a different message for a locked or unknown account); check that when the unlock path is built.

## Acceptance once decided

- D1: deployment test shows a forged `X-Forwarded-For` cannot change the throttle identity or budget through the real chain.
- D2: measured limits recorded in the runtime guide with the test that produced them.
- D3: if B or C is chosen, a migration with the native tests (failure counting, success clearing, no extension while blocked) and an Officer A/B check that one account's behaviour never affects another's.
- D4/D5: edge configuration and the unlock procedure documented and tested; no new account-enumeration signal.
- Issue #64 closes only after these, not before. Passing CI does not establish production login availability.

## Not decided here

Hosting provider (OPS-04), CDN choice, actual numbers, whether the account bucket should be shared across a lost-device recovery path, and any change to MFA or device-proof rules.
