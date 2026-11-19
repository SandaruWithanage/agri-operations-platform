# Authentication policy change proposal (username and password sign-in)

**Status: PROPOSED for review. Not approved, not implemented, not independently reviewed.** The owner changed the proposed sign-in experience to **username and password only** (19 Nov 2026). **Server-side MFA enforcement is not disabled or weakened by this document**, and none of it may be built, merged or deployed until the revised policy passes the required security review and the owner's explicit approval. Gate G1 and production security acceptance are not complete (OWNER-S6, S13; no qualified independent reviewer is assigned). This is a policy and design document: it contains no code, migration, configuration or grant change.

Related: [ADR-0004 pilot authentication](../decisions/ADR-0004-pilot-authentication.md), [ADR-0006 approved device possession](../decisions/ADR-0006-approved-device-possession.md), [pilot authentication runtime](../development/PILOT_AUTH_RUNTIME.md), [device enrollment](../development/DEVICE_ENROLLMENT.md), [login throttle decision brief](LOGIN_THROTTLE_DECISION_BRIEF.md) (D3 option B), [threat model](THREAT_MODEL_AUTOMATED_THREATS.md), [login design proposal](../development/LOGIN_UX_PROPOSAL.md).

## 1. The owner's direction

- Show **Username** and **Password** on the login screen.
- Remove the **authenticator-code field** from the proposed normal sign-in experience.
- Do not require users to type a **device UUID** on every login.
- **Preserve automatic cryptographic device verification** where configured.
- Keep secure sessions, password hashing, login abuse protection, authorization and auditing.
- Prepare a reviewed authentication-policy change covering the current MFA requirement, privileged accounts, financial actions and credential-theft risks.
- Do not disable existing server-side MFA enforcement or weaken security gates before the revised policy is reviewed and approved. Do not merge authentication-security changes without explicit approval.

## 2. What the system enforces today (verified in the repository)

| Control           | Today                                                                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password          | Argon2id hashes; verified in PostgreSQL by a dedicated credential-reader role                                                                                                                                                             |
| MFA               | **Required on every sign-in**: an authenticator code verified by a separate MFA-verifier role with encrypted factor keys (`PILOT_MFA_KEYS`)                                                                                               |
| Approved device   | **Required on every sign-in**: an approved, account-bound device record, and a **signature from that device's enrolled non-exportable browser key** over a server challenge. A copied device UUID alone does not work                     |
| Device UUID entry | The user types the UUID on the form and the browser finds its key from it                                                                                                                                                                 |
| Sessions          | Opaque Secure, HttpOnly, host-prefixed cookie; JWTs kept server-side by the BFF; CSRF token on state changes; revocation and current-session checks                                                                                       |
| Abuse protection  | PostgreSQL login throttle: per-client and per-account buckets (D2 limits provisional; D3 option B chosen for design, SEC-A5); BFF per-minute budgets                                                                                      |
| Recorded decision | ARCH-01 states MFA for **privileged** accounts and notes the pilot "conservatively requires MFA/approved devices on its accounts; do not weaken privileged controls while reviewing broader policy". This proposal is that broader review |

So the pilot is currently **stricter than ARCH-01**. The owner's change moves the ordinary experience toward ARCH-01 while keeping privileged controls.

## 3. What the device proof does and does not give

The device key makes a stolen **password alone** insufficient, because the attacker also needs a browser profile holding the enrolled key. That is a real second factor of the "something you have" kind, **but a weak one**, and it is not hardware attestation (ADR-0006 says so):

- A non-exportable key cannot be copied out of the browser, but **anything running in that origin or with that unlocked profile can use it** to sign a challenge: a cross-site-scripting flaw, malware on the device, or a person using the unlocked device.
- A shared or borrowed field tablet, or a stolen unlocked device plus a shoulder-surfed password, defeats it.
- Enrollment is a controlled operator workflow (two-person approval in the design), which is its main strength: an attacker cannot self-enrol a device.
- It has not been validated on real devices (still open).

An authenticator code adds a factor that is **not on the device**: it protects when the device or browser profile is compromised, and it blocks password-only replay from an attacker who has the device but not the phone.

## 4. Credential-theft analysis

| Threat                                                  | Today (password + code + device)            | Proposed ordinary sign-in (password + device)                          | Residual risk and mitigation                                                                            |
| ------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Phished or reused password, attacker on another machine | Blocked (needs code and device)             | Blocked (needs the enrolled device key)                                | Low. Keep enrollment controlled                                                                         |
| Credential stuffing and guessing                        | Throttled; needs code and device            | Throttled; needs the device key                                        | Low to medium. D3 option B budget; breached-password screening (option, section 7)                      |
| Keylogger or malware on the enrolled device             | Password and code can both be captured live | Password captured, and the malware can use the device key              | **Higher than today.** Step-up for privileged and sensitive actions; device hygiene; session limits     |
| Stolen unlocked device plus known password              | Blocked by the code                         | **Succeeds**                                                           | **Higher than today.** Device lock, fast revocation, step-up for sensitive actions, session idle limits |
| Shared tablet used by several officers                  | Code protects the account                   | Anyone with the password on that device                                | Per-account device binding (exists); an unshared-device rule in the field policy                        |
| XSS in the app origin                                   | Can use the key; cannot know the code       | Can use the key and the typed password                                 | CSP and no third-party scripts (existing hardening); step-up for sensitive actions                      |
| Session cookie theft                                    | HttpOnly mitigates                          | Same                                                                   | Unchanged                                                                                               |
| Insider with database access                            | Out of scope here                           | Out of scope here                                                      | RLS, least privilege, audit (existing)                                                                  |
| Password reset or recovery abuse                        | Needs a controlled process                  | Same, and must **not** become a bypass of the device and step-up rules | Recovery requires an operator and MFA of the approver                                                   |

**Conclusion of the analysis:** removing the code from ordinary sign-in is a **real reduction in protection** against a compromised or stolen device. It is acceptable only if privileged accounts and sensitive actions keep a factor that is not on the device, which is what the options below do.

## 5. Policy options

| Option                                                         | Description                                                                                                                                                                  | Assessment                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **P0** Keep today's policy                                     | Password, code and device for everyone                                                                                                                                       | Safest. The owner has chosen a simpler experience, so this is the fallback if review rejects P1      |
| **P1 (recommended for review)** Password + device; step-up MFA | Ordinary sign-in is username, password and automatic device proof. An authenticator code is **required** for privileged accounts and for named sensitive actions (section 6) | Meets the owner's experience for the common case and keeps a non-device factor where harm is highest |
| **P2** Password + device for everyone, no MFA at all           | No authenticator code anywhere                                                                                                                                               | **Not recommended**: no factor off the device for privileged accounts; contradicts ARCH-01           |
| **P3** Remembered-device MFA grace                             | Code at first sign-in on a device and again after a period                                                                                                                   | Smaller change but keeps the typing the owner wants removed; a possible refinement of P1             |

## 6. Proposed rules under P1 (for review; no value adopted)

1. **Privileged accounts always require MFA at sign-in**, with no exemption. "Privileged" is defined by **registered permission codes** (account and permission administration, device approval and enrollment, bulk export, audit access), never by a role name or the interface.
2. **Step-up MFA** (a fresh authenticator code, valid for a short time the owner and reviewer set) before: approving or enrolling a device, changing permissions or grants, changing an account's password or factors, bulk export, withdrawing an enrollment, and **any financial action**. **Financial settlement is not an approved Phase 1 feature and no such action exists**; if it is ever approved, step-up and dual approval are the starting position, not an afterthought.
3. **Device enrollment and recovery** always need MFA of the approving operator and the existing two-person approval; a recovery path is never a way around the device or step-up rules.
4. **Unknown or unreadable policy fails closed**: if the server cannot determine the requirement, it requires MFA.
5. **The server decides.** The client never states whether MFA applies, and a client claim to skip it is ignored. The interface learns that a code is needed only **after the password and device proof have been verified**, so the form cannot be used to discover which accounts exist or which are privileged.
6. **Login abuse protection** stays and follows D3 option B (only failures consume the account budget; cleared only after the whole required sequence succeeds, including any step-up and the device proof); independent client-level controls stay.
7. **Password rules**: Argon2id stays. Options for the reviewer: a minimum length and screening against known-breached passwords. **No number is adopted here.** Also to document and review: session idle and absolute lifetimes (verify the existing values and record them).
8. **Auditing and events**: every sign-in records the method used (password and device, with or without step-up) and the **policy version**; privacy-safe events as in SEC-A2 (`auth.login.failed`, `auth.mfa.failed`, `auth.device.rejected` and a new step-up event), with no identifier or secret in them.
9. **Field devices**: an unshared-device rule, fast revocation, and a lock or idle policy for the offline workspace, to be set with the owner.

## 7. How it would be built (not built; every step needs review and approval)

1. **Policy in the database**, evaluated server-side and defaulting to today's behaviour (MFA required). A reviewed, version-controlled migration; no change to any existing role or grant outside it; fail closed.
2. **API and BFF** return a generic "additional verification required" outcome only after password and device proof succeed; the BFF never trusts a client hint.
3. **UI** shows the authenticator field only when the server asks (see the login design). The UI change is **not shipped before** the server policy, because today the server rejects a sign-in without a code.
4. **Tests before merge**: privileged account cannot sign in without MFA; ordinary account signs in with password and device proof only; a client that omits or forges the MFA fields cannot downgrade a privileged account; unknown policy requires MFA; step-up required for each sensitive action and expires; no enumeration through timing or messages; D3 budget behaviour with the whole sequence; audit and event content; migration up, down and failure modes; rollback to P0 by one setting; mutation checks on each guard.
5. **Rollout**: staging with synthetic accounts first, then a pilot cohort, with a documented rollback. Production only after independent review.

## 8. Approval path (nothing below has happened)

1. This document reviewed by a **qualified independent AppSec reviewer** (not yet assigned).
2. The owner chooses an option and the open values (step-up lifetime, password rules, session lifetimes, which actions need step-up).
3. A separate implementation design and migration are reviewed; tests above pass on the exact head.
4. **Explicit merge approval** for each authentication-security change. Green CI alone is never authorization.

## 9. Decisions needed from the owner

1. Choose P1 (recommended for review), P3, or P0.
2. The list of sensitive actions that need step-up, and the short step-up lifetime.
3. Whether any ordinary role (for example the field officer role) must keep MFA at sign-in.
4. Password rules and session idle and absolute lifetimes.
5. Shared-device policy for field tablets.
6. Who reviews this independently, and who owns authentication incidents.

## 10. Not done, not claimed

No enforcement was changed, no MFA was disabled, no code or migration was written, and no real-device or adversarial testing was done. The residual risks in section 4 are analysis, not measured results. This is not Gate G1 approval or production security acceptance.
