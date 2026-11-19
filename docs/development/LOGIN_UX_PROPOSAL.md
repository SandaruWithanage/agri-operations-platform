# GoviAxis login design proposal (username and password)

**Status: PROPOSED design, not implemented, not approved.** The owner changed the proposed login from the earlier flow (username, password, authenticator code and a typed device ID, "Option A") to a **username-and-password-only experience** (19 Nov 2026). This document updates the proposed design for the **admin** and **field** applications. It changes no code. **The shipped sign-in is unchanged and still requires an authenticator code and an approved device**, because the server enforces both; the interface must not drop those fields before the matching server policy is reviewed and approved. See the [authentication policy change proposal](../security/AUTHENTICATION_POLICY_CHANGE_PROPOSAL.md) for the policy, the risks and the approval path. The product name is GoviAxis; the full-name decision is tracked with PR #116, awaiting the owner's confirmation.

## 1. What changes for the person signing in

| Today (shipped)                                                        | Proposed ordinary sign-in                                                                                                                                       |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account name, password, authenticator code, approved device ID (typed) | **Username and Password.** Nothing else on the form                                                                                                             |
| Device found by the typed UUID                                         | **The device is found and verified automatically** (section 3)                                                                                                  |
| Authenticator code always                                              | **Only when the server asks**: privileged accounts and sensitive actions (policy section 6), shown as a second step after the password and device proof succeed |
| Two secondary buttons beside the primary one                           | One primary button; secondary actions are text links                                                                                                            |

## 2. Screen design (both apps)

**Admin web (desktop first, works at 390 px):** a card on the glass surface (solid fallback with more contrast), the GoviAxis mark and name, a language toggle (English, Sinhala), a heading "Sign in", a short line, then:

1. **Username** (single line, `autocomplete="username"`, no auto-capitalisation or spell-check).
2. **Password** (`autocomplete="current-password"`, a **Show password** toggle, paste allowed so password managers work).
3. **Sign in**, one primary button.
4. Text links below: "Device not set up? Request device approval" and "Need help signing in?". No "Check session and refresh" button on the sign-in card; session state is checked silently.

**Field PWA (phone first):** the same two fields and button, stacked, each control at least 44 px high with at least 8 px between controls, one compact status line above the form (online or offline, nothing else), and **no officer name, area, device model or fingerprint before sign-in**. The form is the first thing under the header, not below status cards (Stitch review S5 and S11).

**Both:** no architecture, build, environment or database wording; no claim about hardware keys, FIPS or attestation; no organisation list; no government identity text until the client supplies approved wording (Stitch review S2 to S4, S6).

## 3. Automatic device verification (no UUID typing)

The server rules in ADR-0006 do not change: the device must be approved, account-bound, and prove possession of its enrolled key by signing a server challenge. Only **how the browser finds its key** changes.

1. At **device enrollment** the browser already creates a non-exportable signing key and keeps it in IndexedDB. The proposal also records, in the same local store, the **device record it was enrolled for** (a non-secret identifier and a friendly label). No secret is added.
2. At sign-in, after the person submits username and password, the app finds the local device record **without asking**:
   - **one enrolled device record** on this browser: use it;
   - **none**: show "This device is not set up for GoviAxis yet" with the existing **Download device enrollment request** flow and no further detail;
   - **several** (a shared browser profile): show a list by friendly label, never a UUID, after the password check.
3. The BFF requests a challenge, the browser signs it with the stored key, and the server verifies the approved device record and signature **together with** the password. A missing or invalid proof fails closed with the same generic message as a wrong password (no hint of which part failed).
4. A UUID in local storage is not a credential: copying it gains nothing without the non-exportable key (unchanged from ADR-0006). The limits in policy section 3 still apply: it is not hardware attestation.
5. **Where the feature is not configured**, the form behaves as the server requires today.

## 4. States and messages

All messages are generic and fixed text; none reveals whether an account exists, is locked, or is privileged.

| State                                | Behaviour                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Idle                                 | Username and Password, Sign in                                                                                                                                                                                           |
| Submitting                           | Button disabled with "Signing in…"; announced to assistive technology; a visible, non-colour-only indicator                                                                                                              |
| Wrong credentials, or device failed  | "Sign-in failed. Check your username and password, or contact your administrator." Focus moves to the message; the password field is cleared; the username is kept                                                       |
| Too many attempts                    | "Too many attempts. Try again later." No time, count or account detail (D3 option B, SEC-A5)                                                                                                                             |
| **Additional verification required** | **Only after password and device proof succeed.** A second step with one field, "Authenticator code" (6 digits, `inputmode="numeric"`, `autocomplete="one-time-code"`), a Back action, and the same generic failure text |
| Device not set up                    | Section 3, shown only as the no-local-record case                                                                                                                                                                        |
| Service unavailable                  | "Access permissions could not be verified. Retry to continue." style wording for service errors, with a Retry action; no stack, host or status detail                                                                    |
| Field offline                        | "You are offline. Sign in needs a connection." The encrypted offline workspace unlock is a separate, existing flow and is not part of this form                                                                          |
| First visit with no session          | Silent: an anonymous "no session" response is not an error and shows no banner                                                                                                                                           |

## 5. Language and accessibility

- English and Sinhala from the first screen. Reuse the existing translations of **Account name** and **Password**; the new strings (Show password, Signing in, the generic failure and throttle messages, device-not-set-up, additional verification) are **pending native-speaker review** and must not ship as final until reviewed (unassigned). The brand stays in Latin script.
- Labels are visible (never placeholder-only), errors are associated with the field and announced, focus order is username, password, show toggle, Sign in, links; a visible focus ring; contrast at least 4.5:1 for text with a solid fallback under more-contrast and reduced-transparency; no information by colour alone; targets at least 44 px (field) with spacing; no horizontal scroll at 320 px.
- Password managers and paste are supported; no CAPTCHA, user-agent or fingerprint gate is added here, and none is a sole defence (SEC-AUDIT-01).

## 6. Security properties the design must keep

Opaque Secure HttpOnly session cookie and server-held tokens; CSRF on state changes; no secret in local storage; Argon2id; D3 option B throttling with separate client-level controls; origin and size checks; privacy-safe security events with no identifier or secret; audit of the method and policy version; authorization in PostgreSQL (the interface is convenience only). **No client input can lower the server's MFA requirement.**

## 7. Mapping to the current code (for the later implementation, not now)

`apps/admin-web/components/farmer-registry.tsx` and `apps/field-pwa/components/pilot-workspace.tsx` hold the sign-in forms with the `otp` and `deviceId` fields and the `prepareDevice(deviceId)` call; the shared auth shell and fields come from `@agri/ui`. The later change touches those forms, the BFF login route and the device-challenge route, and the server policy. It is **a production-affecting authentication change**: a separate reviewed PR needing the policy approval above and explicit merge approval.

## 8. Acceptance tests (to write with the implementation)

1. The ordinary form shows only Username and Password and one primary button, in both languages and both apps.
2. The authenticator field appears **only** after the server asks, never on first render, and a privileged account cannot sign in without it (server-enforced test).
3. No device UUID input exists; the right local device is used with one record, a label list with several, and the enrollment path with none.
4. Forged or omitted client fields cannot downgrade the requirement; every failure shows the same generic message and does not distinguish wrong password, missing device or lockout.
5. Autofill and paste work; show-password toggles; focus and announcements; 44 px targets and spacing; no sideways scroll at 320 px; contrast and solid fallbacks; the first anonymous visit shows no error banner.
6. No pre-auth identity, device detail or architecture text; the brand and full name come from `@agri/ui`.
7. Regression: with the server policy at today's setting, behaviour is unchanged.

## 9. Open items

The policy option and values (policy section 9); native-speaker review of the new strings; approved identity text; whether any role keeps MFA at every sign-in; shared-tablet rules; the final product-name confirmation (PR #116). **None of this is implemented, and no part has been independently reviewed.**
